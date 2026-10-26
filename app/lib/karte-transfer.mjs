import {readSavHeader, readSave, readLightweight} from './sav.mjs';
import {bereichAlsBlaupause} from './extrahieren.mjs';
import {ladeMuster as ladeTransferMuster, kopiere as kopiereTransfer} from './muster.mjs';
import {musterUmrechnen, UMRECHNEN_AB} from './umrechnen.mjs';
import {objekteEinfuegen} from './spielstand-einfuegen.mjs';
import {spielstandAendern} from './spielstand-aendern.mjs';
import {leichtbauUebertragen} from './leichtbau-transfer.mjs';
import {zerlege} from './eigenschaften.mjs';

/** Farbpalette (mColorSlots_Data im BP_BuildableSubsystem) aus der Quelle ins Ziel übernehmen; null = nichts zu tun */
function paletteUebernehmen(quellDaten, zielDaten, name) {
  const finde = (sv) => sv.objects.find((o) => /.BP_BuildableSubsystem_C$/.test(o.typePath) && o.dBody !== undefined);
  const qs = readSave(quellDaten, { props: false }), zs = readSave(zielDaten, { props: false });
  if (qs.header.saveVersion !== zs.header.saveVersion) throw Object.assign(new Error('Farbpalette: Quelle und Ziel stammen aus verschiedenen Spielversionen – bitte beide im aktuellen Spiel speichern.'), { status: 422 });
  const qo = finde(qs), zo = finde(zs); if (!qo || !zo || zo.level !== zs.levels.length - 1) return null;
  const qd = qs.body.subarray(qo.dBody, qo.dEnd), zd = zs.body.subarray(zo.dBody, zo.dEnd);
  const qz = zerlege(qd, qo.kind === 1), zz = zerlege(zd, zo.kind === 1);
  const qp = qz.props.find((p) => p.name === 'mColorSlots_Data'), zp = zz.props.find((p) => p.name === 'mColorSlots_Data');
  const teil = qp ? qd.subarray(qp.start, qp.end) : Buffer.alloc(0);
  const neu = zp ? Buffer.concat([zd.subarray(0, zp.start), teil, zd.subarray(zp.end)]) : Buffer.concat([zd.subarray(0, zz.noneStart), teil, zd.subarray(zz.noneStart)]);
  if (neu.equals(zd)) return null;
  return spielstandAendern(zielDaten, { ersetzen: new Map([[zo.pathName, neu]]), speichername: name }).ausgabe;
}

/** Reiner Transfer im Speicher: Dateischreiben und Originalschutz übernimmt der Server. */
export function uebertrageBereich(quellDaten,zielDaten,b,{lib:l,kat:k,ohne:ohneSet=new Set(),name,frei=false,palette=false,log=()=>{}}) {
  let daten=zielDaten;
  const r = bereichAlsBlaupause(quellDaten, b, { lib: l, kat: k, ohne: ohneSet, log, weltkoordinaten: true, leichtbauAlsAkteure: false });
  if (r.info.falscheVersion) throw Object.assign(new Error(`${r.info.falscheVersion} Objekte besitzen ein abweichendes Format. Quelle bitte im aktuellen Spiel neu speichern; es wird nichts unvollständig übertragen.`), { status: 422 });
  const sv = readSavHeader(daten).saveVersion, m = ladeTransferMuster(r.datei);
  if (m.version > sv) throw Object.assign(new Error(`Die Quelle stammt aus einer neueren Spielversion (Format ${m.version}) als das Ziel (Format ${sv}).`), { status: 422 });
  if (m.version < sv) {
    if (m.version < UMRECHNEN_AB || sv < 60) throw Object.assign(new Error(`Quelle (Format ${m.version}) und Ziel (Format ${sv}) passen nicht zusammen.`), { status: 422 });
    try { musterUmrechnen(m); } catch (x) { throw Object.assign(new Error(`Der Bereich ließ sich nicht ins Format des Ziels umrechnen (${x.message}).`), { status: 422 }); }
  }
  const [cx, cy, cz] = r.info.verschiebung;
  const objs = kopiereTransfer(m, () => true, (o) => ({ pos: [o.pos[0] + cx, o.pos[1] + cy, o.pos[2] + cz], rot: o.rot }));
  const info = { ...r.info, entfernt: 0 };
  if (frei) { // im Ziel dieselbe Auswahl-Logik wie beim Herauskopieren
    const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    const zMin = Number.isFinite(b.z0) ? b.z0 : -Infinity, zMax = Number.isFinite(b.z1) ? b.z1 : Infinity, poly = b.poly;
    const imPoly = (x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
    const drin = (p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1 && p[2] >= zMin && p[2] <= zMax && (!poly || imPoly(p[0], p[1]));
    const s = readSave(daten, { props: false }), haupt = s.levels.length - 1, loeschen = [];
    for (const o of s.objects) {
      if (o.kind !== 1 || o.level !== haupt || o.dBody === undefined) continue;
      const cls = o.typePath.split('.').pop();
      if (cls.startsWith('Build_') && !/^Build_(PowerLine_C|.*Hologram|BlueprintDesigner)/.test(cls) && !ohneSet.has(cls) && drin(o.pos)) loeschen.push({ a: o.pathName });
    }
    const lw = s.objects.find((o) => /LightweightBuildableSubsystem$/.test(o.typePath)), nr = {};
    if (lw) readLightweight(s.body, lw, (tp, rot, pos) => { const i = nr[tp] = (nr[tp] ?? -1) + 1; if (!ohneSet.has(tp.split('.').pop()) && drin(pos)) loeschen.push({ l: tp, i }); });
    if (loeschen.length) { const a = spielstandAendern(daten, { loeschen, speichername: name }); daten = a.ausgabe; info.entfernt = loeschen.length; }
  }
  const e = objekteEinfuegen(daten, objs, { musterVersion: m.version, speichername: name });
  daten = e.ausgabe; info.eingefuegt = e.info.eingefuegt;
  const lw = leichtbauUebertragen(quellDaten, daten, b, { ohne: ohneSet, speichername: name });
  daten = lw.ausgabe; info.leichtbau = lw.info.leichtbau;
  if (palette) { const p = paletteUebernehmen(quellDaten, daten, name); if (p) { daten = p; info.palette = true; } }
  return {ausgabe:daten,info};
}
