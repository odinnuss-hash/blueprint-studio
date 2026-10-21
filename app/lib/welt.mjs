// Welt-Ansicht (Test): Gelände in voller Auflösung als Kacheln mit Detailstufen + Bauteile eines Spielstands mit voller Drehung.
//
// Gelände: werkzeuge/gelaende --export … --raster 100 → userdata/gelaende/hoehen1m.{bin,json} (Int16 dm, 1 m Raster, ganze Karte
// 7113 × 6097 Punkte, gemessen 21.10.2026). Kachel = 128 × 128 Quads, Detailstufe k = Punktabstand 2^k m (k = 0 … 6).
// Bauteile: wie lib/karte.mjs, aber mit Quaternion, Skalierung, Trägerlänge und Splines (Bänder, Rohre, Schienen) in 3D.
import fs from 'node:fs';
import { readSave, readLightweight } from './sav.mjs';
import { readProps } from './sbp.mjs';

export const KACHEL = 128;
const LEER = -32768;

export function ladeHoehen(stamm) {
  const kopf = JSON.parse(fs.readFileSync(stamm + '.json', 'utf8'));
  const b = fs.readFileSync(stamm + '.bin');
  return { kopf, d: new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2) };
}

/** Kachel (tx, ty) der Detailstufe lod: (KACHEL+1)² Höhen in dm (LEER = keine Landschaft) */
export function kachel(h, lod, tx, ty) {
  const { breite: W, hoehe: H } = h.kopf, s = 1 << lod, n = KACHEL + 1, out = new Int16Array(n * n);
  const gx0 = tx * KACHEL * s, gy0 = ty * KACHEL * s;
  for (let j = 0; j < n; j++) {
    const gy = gy0 + j * s;
    for (let i = 0; i < n; i++) {
      const gx = gx0 + i * s;
      out[j * n + i] = gx >= 0 && gy >= 0 && gx < W && gy < H ? h.d[gy * W + gx] : LEER;
    }
  }
  return out;
}

const RX_SPLINE = /^Build_(ConveyorBelt|Pipeline|PipeHyper|RailroadTrack)/;
const kurz = (p) => { const m = /\.([A-Za-z0-9_]+)$/.exec(p || ''); return m ? m[1] : (p || ''); };
function rotVec(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
/** Spline (Hermite) als 3D-Polylinie in Weltkoordinaten */
function spline3d(o) {
  const pts = o.spline.map((p) => {
    const w = rotVec(o.rot, p.slice(0, 3));
    return { p: [w[0] + o.pos[0], w[1] + o.pos[1], w[2] + o.pos[2]], a: p.length >= 9 ? rotVec(o.rot, p.slice(3, 6)) : null, l: p.length >= 9 ? rotVec(o.rot, p.slice(6, 9)) : null };
  });
  const out = [...pts[0].p];
  for (let i = 1; i < pts.length; i++) {
    const A = pts[i - 1], B = pts[i], len = Math.hypot(B.p[0] - A.p[0], B.p[1] - A.p[1], B.p[2] - A.p[2]);
    const steps = A.l && B.a && len > 200 ? Math.min(16, Math.ceil(len / 300)) : 1;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t, h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      for (let c = 0; c < 3; c++) out.push(steps === 1 ? B.p[c] : h00 * A.p[c] + h10 * A.l[c] + h01 * B.p[c] + h11 * B.a[c]);
    }
  }
  return out.map((v) => Math.round(v));
}
/** Trägerlänge aus Leichtbau-Zusatzdaten (BuildableBeamLightweightData{BeamLength}): Wert 9 Byte nach „FloatProperty“ */
function beamLaenge(typed) {
  if (!typed) return 0;
  const i = typed.indexOf('BeamLength\0', 0, 'latin1'); if (i < 0) return 0;
  const f = typed.indexOf('FloatProperty\0', i, 'latin1'); if (f < 0 || f + 14 + 9 + 4 > typed.length) return 0;
  const v = typed.readFloatLE(f + 14 + 9); return v > 0 && v < 1e6 ? v : 0;
}

/**
 * Spielstand → { meta, werte: Float32Array (je Bauteil 12: x, y, z, qx, qy, qz, qw, sx, sy, sz, Klasse, Länge), linien: [[Klasse, x,y,z, …]] }
 */
export function weltDaten(buf) {
  const t0 = Date.now();
  const { header, body, objects, levels } = readSave(buf, { props: false });
  const haupt = levels.length - 1, refs = [], lwTypen = [], lwIdx = new Map(); // Verweise für Stufe 4 (ändern): nur Haupt-Level
  const klassen = [], kIdx = new Map();
  const ki = (c) => { let i = kIdx.get(c); if (i === undefined) { i = klassen.length; klassen.push(c); kIdx.set(c, i); } return i; };
  const werte = [], linien = [], spieler = [];
  let leicht = 0;
  for (const o of objects) {
    if (o.kind !== 1) continue;
    if (/LightweightBuildableSubsystem$/.test(o.typePath)) {
      // Leichtbau: Transform als double (Drehung, Position, Skalierung) – readLightweight liefert Drehung + Position
      const zaehl = new Map();
      leicht += readLightweight(body, o, (tp, rot, pos, swatch, proxy, typed) => {
        werte.push(pos[0], pos[1], pos[2], ...rot, 1, 1, 1, ki(kurz(tp)), beamLaenge(typed));
        let t = lwIdx.get(tp); if (t === undefined) { t = lwTypen.length; lwTypen.push(tp); lwIdx.set(tp, t); }
        const i = zaehl.get(tp) || 0; zaehl.set(tp, i + 1); refs.push(o.level === haupt ? [t, i] : null);
      });
      continue;
    }
    const cls = kurz(o.typePath);
    if (cls === 'Char_Player_C') { spieler.push(o.pos.map(Math.round)); continue; }
    if (!/^Build_/.test(cls) || cls === 'Build_PowerLine_C') continue;
    if (RX_SPLINE.test(cls) || /Beam/.test(cls)) readProps(body, o);
    if (o.spline?.length > 1) { linien.push([ki(cls), ...spline3d(o)]); continue; }
    werte.push(o.pos[0], o.pos[1], o.pos[2], ...o.rot, ...(o.scale || [1, 1, 1]), ki(cls), o.length || 0);
    refs.push(o.level === haupt ? o.pathName : null);
  }
  const meta = { refs, lwTypen, name: header.saveName || header.sessionName, sitzung: header.sessionName, version: header.saveVersion, anzahl: werte.length / 12, leichtbau: leicht, klassen, linien, spieler, dauer: Date.now() - t0 };
  return { meta, werte: new Float32Array(werte) };
}

/**
 * Blaupause (readBlueprint) → gleiches Format wie weltDaten, Lage relativ zum Ursprung der Blaupause (Boden des Designers).
 * Für Stufe 3 der Welt-Ansicht (Blaupausen setzen): die App zeigt sie als Vorschau und verschiebt/dreht sie selbst.
 */
export function blaupauseDaten(bp, name) {
  const klassen = [], kIdx = new Map();
  const ki = (c) => { let i = kIdx.get(c); if (i === undefined) { i = klassen.length; klassen.push(c); kIdx.set(c, i); } return i; };
  const werte = [], linien = [];
  let z0 = Infinity;
  for (const o of bp.objects) {
    if (o.kind !== 'entity' || !/^Build_/.test(o.cls) || o.cls === 'Build_PowerLine_C') continue;
    z0 = Math.min(z0, o.pos[2]);
    if (o.spline?.length > 1) { linien.push([ki(o.cls), ...spline3d(o)]); continue; }
    werte.push(o.pos[0], o.pos[1], o.pos[2], ...o.rot, ...(o.scale || [1, 1, 1]), ki(o.cls), o.length || 0);
  }
  const meta = { name, version: bp.header.saveVersion, anzahl: werte.length / 12, klassen, linien, unten: Number.isFinite(z0) ? z0 : 0 };
  return { meta, werte: new Float32Array(werte) };
}
