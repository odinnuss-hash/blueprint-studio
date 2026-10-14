// Kartendaten aus einem Spielstand: alle Gebaeude (Position, Drehung, Klasse), Baender/Rohre/Schienen als Linien,
// Stromleitungen, Ressourcen-Knoten, Spieler. Ergebnis ist kompakt (JSON-Kopf + Float32-Feld) fuer die Kartenansicht.

import { readSave, readLightweight } from './sav.mjs';
import { readProps, readVectorAfter } from './sbp.mjs';

const RX_SPLINE = /^Build_(ConveyorBelt|Pipeline|PipeHyper|RailroadTrack)/;
const RX_KEEP = /^(Build_|BP_ResourceNode|BP_FrackingSatellite|BP_FrackingCore|Char_Player_C|BP_DropPod)/;

const yawDeg = (q) => Math.atan2(2 * (q[3] * q[2] + q[0] * q[1]), 1 - 2 * (q[1] * q[1] + q[2] * q[2])) * 180 / Math.PI;
function rotVec(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
const kurz = (p) => { const m = /\.([A-Za-z0-9_]+)$/.exec(p || ''); return m ? m[1] : (p || ''); };

/** Hermite-Kurve zwischen Spline-Punkten in 2D-Polylinie (Weltkoordinaten) umrechnen */
function splineLinie(o) {
  const pts = o.spline.map((p) => {
    const w = rotVec(o.rot, p.slice(0, 3));
    const a = p.length >= 9 ? rotVec(o.rot, p.slice(3, 6)) : null, l = p.length >= 9 ? rotVec(o.rot, p.slice(6, 9)) : null;
    return { p: [w[0] + o.pos[0], w[1] + o.pos[1], w[2] + o.pos[2]], a, l };
  });
  const out = [pts[0].p[0], pts[0].p[1]];
  for (let i = 1; i < pts.length; i++) {
    const A = pts[i - 1], B = pts[i];
    const len = Math.hypot(B.p[0] - A.p[0], B.p[1] - A.p[1]);
    const steps = A.l && B.a && len > 200 ? Math.min(12, Math.ceil(len / 400)) : 1;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      if (steps === 1) { out.push(B.p[0], B.p[1]); continue; }
      const t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      out.push(h00 * A.p[0] + h10 * A.l[0] + h01 * B.p[0] + h11 * B.a[0], h00 * A.p[1] + h10 * A.l[1] + h01 * B.p[1] + h11 * B.a[1]);
    }
  }
  return out.map((v) => Math.round(v));
}

function zweiPunkte(body, o) {
  const txt = body.toString('latin1', o.dBody, o.dEnd);
  const a = txt.indexOf('\x0a\x00\x00\x00Locations\x00');
  if (a < 0) return null;
  const b = txt.indexOf('\x0a\x00\x00\x00Locations\x00', a + 10);
  const p1 = readVectorAfter(body, o.dBody + a, o.dEnd), p2 = b > 0 ? readVectorAfter(body, o.dBody + b, o.dEnd) : null;
  return p1 && p2 ? [Math.round(p1[0]), Math.round(p1[1]), Math.round(p2[0]), Math.round(p2[1])] : null;
}

export function kartenDaten(buf) {
  const t0 = Date.now();
  const save = readSave(buf, { props: false });
  const { header, body, objects } = save;
  const klassen = [], kIdx = new Map();
  const ki = (c) => { let i = kIdx.get(c); if (i === undefined) { i = klassen.length; klassen.push(c); kIdx.set(c, i); } return i; };
  const werte = []; // x, y, z, yaw, klasse, quelle(0 Objekt, 1 Leichtbau)
  const linien = []; // [klasse, x1, y1, x2, y2, …]
  const leitungen = []; // x1, y1, x2, y2 …
  const spieler = [];
  let leicht = 0;
  for (const o of objects) {
    if (o.kind !== 1) continue;
    if (/LightweightBuildableSubsystem$/.test(o.typePath)) {
      leicht += readLightweight(body, o, (tp, rot, pos) => werte.push(pos[0], pos[1], pos[2], yawDeg(rot), ki(kurz(tp)), 1));
      continue;
    }
    const cls = kurz(o.typePath);
    if (!RX_KEEP.test(cls)) continue;
    if (cls === 'Char_Player_C') { spieler.push([Math.round(o.pos[0]), Math.round(o.pos[1]), Math.round(o.pos[2])]); continue; }
    if (RX_SPLINE.test(cls)) {
      readProps(body, o);
      if (o.spline?.length > 1) { linien.push([ki(cls), ...splineLinie(o)]); continue; }
    }
    if (cls === 'Build_PowerLine_C') { const l = zweiPunkte(body, o); if (l) leitungen.push(...l); continue; }
    werte.push(o.pos[0], o.pos[1], o.pos[2], yawDeg(o.rot), ki(cls), 0);
  }
  const n = werte.length / 6;
  // nach Hoehe sortieren (oben liegende Teile zuletzt zeichnen)
  const ord = Array.from({ length: n }, (_, i) => i).sort((a, b) => werte[a * 6 + 2] - werte[b * 6 + 2]);
  const f = new Float32Array(n * 6);
  ord.forEach((s, i) => { for (let k = 0; k < 6; k++) f[i * 6 + k] = werte[s * 6 + k]; });
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) { const x = f[i * 6], y = f[i * 6 + 1]; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const meta = {
    name: header.saveName, sitzung: header.sessionName, datum: header.saveDate, spielzeit: header.playedSeconds,
    version: header.saveVersion, build: header.buildVersion, kreativ: !!header.isCreative, mods: header.mods,
    anzahl: n, leichtbau: leicht, klassen, linien, leitungen, spieler,
    grenzen: n ? [minX, minY, maxX, maxY] : null, dauer: Date.now() - t0,
  };
  return { meta, werte: f };
}

/** Binaerpaket: uint32 Laenge JSON, JSON (UTF-8), Auffuellung auf 4 Byte, Float32-Feld */
export function packen({ meta, werte }) {
  const j = Buffer.from(JSON.stringify(meta), 'utf8');
  const pad = (4 - ((4 + j.length) % 4)) % 4;
  const head = Buffer.alloc(4); head.writeUInt32LE(j.length);
  return Buffer.concat([head, j, Buffer.alloc(pad), Buffer.from(werte.buffer, werte.byteOffset, werte.byteLength)]);
}
