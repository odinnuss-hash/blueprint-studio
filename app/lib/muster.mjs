// Blaupause als Muster: Objekte samt Daten laden und mit neuer Lage/Drehung kopieren (neue Instanznamen).
// Genutzt von der Welt-Ansicht (Blaupausen setzen → Spielstand). Gleiche Logik wie im Straßen-Prototyp (Testkopie, strasse.mjs).
import fs from 'node:fs';
import { readBlueprint } from './sbp.mjs';

const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const fstr = (s) => (s ? Buffer.concat([i32(s.length + 1), Buffer.from(s + '\0', 'latin1')]) : i32(0));
const f32s = (a) => { const b = Buffer.alloc(a.length * 4); a.forEach((v, i) => b.writeFloatLE(v, i * 4)); return b; };
export const qmul = ([ax, ay, az, aw], [bx, by, bz, bw]) => [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
export const qrot = (q, [x, y, z]) => { const [qx, qy, qz, qw] = q, t = qmul(qmul(q, [x, y, z, 0]), [-qx, -qy, -qz, qw]); return [t[0], t[1], t[2]]; };
export const qz = (a) => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];

/** Blaupause laden: { bp, objs: [{ o, data }], version } */
export function ladeMuster(datei) { // Pfad oder Inhalt der Blaupause
  const bp = readBlueprint(Buffer.isBuffer(datei) ? datei : fs.readFileSync(datei), { props: false });
  const objs = bp.objects.map((o) => ({ o, data: Buffer.from(bp.body.subarray(o.dStart, o.dEnd)) }));
  return { bp, objs, version: bp.header.saveVersion };
}

let nr = 2147000000 - Math.floor(Math.random() * 5e7);
/** Alle Objekte eines Musters (filter) mit neuer Lage/Drehung (trafo); Instanznamen gleich lang ersetzen (auch in den Daten und bei Komponenten) */
export function kopiere(m, filter, trafo) {
  const namen = new Map(), out = [];
  for (const { o } of m.objs) if (o.kind === 'entity' && filter(o)) {
    const mm = /^(.*_)(\d+)$/.exec(o.instance); const z = String(nr--);
    namen.set(o.instance, mm ? mm[1] + (z.length >= mm[2].length ? z.slice(-mm[2].length) : z.padStart(mm[2].length, '1')) : o.instance);
  }
  // Schnellweg (große Bereiche mit Tausenden Teilen): Namen nicht einzeln in jedem Objekt suchen, sondern hinter jedem
  // „PersistentLevel.“ das Namenswort nachschlagen. Nur wenn alle Namen diese Form haben, sonst die einfache Suche.
  const PL = 'PersistentLevel.', kurz = new Map();
  for (const [a, b] of namen) { const i = a.indexOf(PL); if (i >= 0 && b.indexOf(PL) === i) kurz.set(a.slice(i + PL.length), b.slice(i + PL.length)); }
  const schnell = kurz.size === namen.size;
  const wortEnde = (s, e) => { while (e < s.length) { const c = s.charCodeAt(e); if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95)) break; e++; } return e; };
  const neu = (inst) => {
    if (schnell) {
      const i = inst.indexOf(PL); if (i < 0) return inst;
      const a = i + PL.length, e = wortEnde(inst, a), b = kurz.get(inst.slice(a, e));
      return b ? inst.slice(0, a) + b + inst.slice(e) : inst;
    }
    for (const [a, b] of namen) if (inst === a || inst.startsWith(a + '.')) return b + inst.slice(a.length);
    return inst;
  };
  const ersetzeNamen = (d) => {
    if (!schnell) { for (const [a, b] of namen) { const ab = Buffer.from(a, 'latin1'), bb = Buffer.from(b, 'latin1'); let p = d.indexOf(ab); while (p >= 0) { bb.copy(d, p); p = d.indexOf(ab, p + ab.length); } } return; }
    const s = d.toString('latin1');
    for (let p = s.indexOf(PL); p >= 0; p = s.indexOf(PL, p + PL.length)) {
      const a = p + PL.length, e = wortEnde(s, a), b = kurz.get(s.slice(a, e));
      if (b) d.write(b, a, 'latin1');
    }
  };
  // Spielstände ab 1.0 verlangen Objekt-Flags im Kopf; Blaupausen vor 1.0 (Format < 46) haben keine → Werte wie im Spiel ergänzen
  // (gemessen: Bauteile 8; Komponenten 262152 für Inventar/Strominfo/Schienen, sonst 2097152)
  const flags = (o) => (m.bp.hasFlags ? o.flags : o.kind === 'entity' ? 8 : /Inventory|PowerInfo|Railroad|TrainPlatform/.test(o.typePath) ? 262152 : 2097152);
  for (const { o, data } of m.objs) {
    const besitzer = o.kind === 'entity' ? o.instance : o.parent;
    if (!namen.has(besitzer)) continue;
    const d = Buffer.from(data);
    ersetzeNamen(d);
    let head;
    if (o.kind === 'entity') {
      const { pos, rot } = trafo(o);
      head = Buffer.concat([i32(1), fstr(o.typePath), fstr(o.root), fstr(neu(o.instance)), i32(flags(o)), i32(o.needTransform), f32s([...rot, ...pos, ...o.scale]), i32(o.placedInLevel)]);
    } else head = Buffer.concat([i32(0), fstr(o.typePath), fstr(o.root), fstr(neu(o.instance)), i32(flags(o)), fstr(neu(o.parent))]);
    out.push({ head, data: d, cls: o.cls, ver: m.version });
  }
  return out;
}
