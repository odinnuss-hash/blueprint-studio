// Kabel: welche Teile sind verbunden, wie viele Kabel je Mast
import fs from 'node:fs';
import { readBlueprint } from '../../app/lib/sbp.mjs';
const bp = readBlueprint(fs.readFileSync(process.argv[2]));
const je = {}, cls = new Map(bp.objects.map((o) => [o.instance.split('.').pop(), o.cls]));
for (const l of bp.objects.filter((o) => o.kind === 'entity' && /PowerLine/.test(o.cls))) {
  const txt = bp.body.toString('latin1', l.dBody, l.dEnd);
  for (const m of [...txt.matchAll(/Persistent_Level:PersistentLevel\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g)].slice(-2)) { const k = (cls.get(m[1]) || m[1]).replace(/^Build_|_C$/g, '') + ':' + m[1].slice(-4); je[k] = (je[k] || 0) + 1; }
}
const pump = Object.entries(je).filter(([k]) => /Pump/.test(k)), mast = Object.entries(je).filter(([k]) => /PowerPole/.test(k));
console.log('Pumpen mit Kabel:', pump.length, '| Masten max. Kabel:', Math.max(...mast.map(([, v]) => v)), '| Masten:', mast.length);
