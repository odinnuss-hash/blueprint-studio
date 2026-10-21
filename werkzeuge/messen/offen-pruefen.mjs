// Offene Band-/Rohr-Enden und Merger-/Kreuzungs-Belegung
import fs from 'node:fs';
import { readBlueprint } from '../../app/lib/sbp.mjs';
const bp = readBlueprint(fs.readFileSync(process.argv[2]));
const byInst = new Map(bp.objects.map((o) => [o.instance, o]));
const offen = [], merger = {};
for (const c of bp.objects.filter((o) => o.kind === 'component' && /FactoryConnection|PipeConnection/.test(o.typePath))) {
  const p = byInst.get(c.parent); if (!p) continue;
  const d = bp.body.toString('latin1', c.dBody, c.dEnd);
  const verb = /mConnectedComponent[\s\S]*?Persistent_Level\x00[\s\S]{4}Persistent_Level/.test(d);
  const k = p.cls.replace(/^Build_|_C$/g, '');
  if (/ConveyorBelt|ConveyorLift|Pipeline(MK2)?(_NoIndicator)?$/.test(k) && !verb) offen.push(`${k} ${c.instance.split('.').pop()} @${p.pos.map((v) => Math.round(v / 100))}`);
  if (/Merger/.test(k)) { (merger[p.instance] ||= []).push(c.instance.split('.').pop() + (verb ? '+' : '-')); }
}
console.log('offene Leitungsenden:', offen.length); offen.forEach((x) => console.log('  ' + x));
const mm = Object.values(merger).map((l) => l.sort().join(' ')); const z = {}; mm.forEach((s) => { z[s] = (z[s] || 0) + 1; });
console.log('Merger-Belegung:', JSON.stringify(z));
