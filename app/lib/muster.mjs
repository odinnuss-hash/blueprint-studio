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
export function ladeMuster(datei) {
  const bp = readBlueprint(fs.readFileSync(datei), { props: false });
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
  const neu = (inst) => { for (const [a, b] of namen) if (inst === a || inst.startsWith(a + '.')) return b + inst.slice(a.length); return inst; };
  for (const { o, data } of m.objs) {
    const besitzer = o.kind === 'entity' ? o.instance : o.parent;
    if (!namen.has(besitzer)) continue;
    const d = Buffer.from(data);
    for (const [a, b] of namen) { const ab = Buffer.from(a, 'latin1'), bb = Buffer.from(b, 'latin1'); let p = d.indexOf(ab); while (p >= 0) { bb.copy(d, p); p = d.indexOf(ab, p + ab.length); } }
    let head;
    if (o.kind === 'entity') {
      const { pos, rot } = trafo(o);
      head = Buffer.concat([i32(1), fstr(o.typePath), fstr(o.root), fstr(neu(o.instance)), ...(m.bp.hasFlags ? [i32(o.flags)] : []), i32(o.needTransform), f32s([...rot, ...pos, ...o.scale]), i32(o.placedInLevel)]);
    } else head = Buffer.concat([i32(0), fstr(o.typePath), fstr(o.root), fstr(neu(o.instance)), ...(m.bp.hasFlags ? [i32(o.flags)] : []), fstr(neu(o.parent))]);
    out.push({ head, data: d, cls: o.cls, ver: m.version });
  }
  return out;
}
