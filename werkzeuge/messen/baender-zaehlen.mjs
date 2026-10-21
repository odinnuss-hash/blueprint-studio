import fs from 'node:fs';
import { readBlueprint } from '../../app/lib/sbp.mjs';
for (const f of process.argv.slice(2)) {
  const bp = readBlueprint(fs.readFileSync(f)); const z = {};
  for (const o of bp.objects.filter((o) => o.kind === 'entity' && /Conveyor(Belt|Lift)Mk|Pipeline(MK2)?(_NoIndicator)?_C$/.test(o.cls))) { const k = o.cls.replace(/^Build_|_C$/g, ''); z[k] = (z[k] || 0) + 1; }
  console.log(f.split('/').pop(), JSON.stringify(z));
}
