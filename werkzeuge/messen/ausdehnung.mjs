import fs from 'node:fs';
import { readBlueprint } from '../../app/lib/sbp.mjs';
const bp = readBlueprint(fs.readFileSync(process.argv[2]));
const r = {};
for (const o of bp.objects.filter((o) => o.kind === 'entity' && !/Foundation|PowerLine/.test(o.cls))) {
  const k = o.cls.replace(/^Build_|_C$/g, ''); const pts = o.spline ? o.spline.map((p) => p.slice(0, 3).map((v, i) => v + o.pos[i])) : [o.pos];
  for (const p of pts) { const e = (r[k] ||= { y0: 1e9, y1: -1e9, x0: 1e9, x1: -1e9, n: 0 }); e.y0 = Math.min(e.y0, p[1]); e.y1 = Math.max(e.y1, p[1]); e.x0 = Math.min(e.x0, p[0]); e.x1 = Math.max(e.x1, p[0]); }
  r[k].n++;
}
for (const [k, e] of Object.entries(r)) console.log(k.padEnd(36), 'n', String(e.n).padStart(3), 'x', Math.round(e.x0 / 100), '..', Math.round(e.x1 / 100), ' y', Math.round(e.y0 / 100), '..', Math.round(e.y1 / 100), 'm');
const m = bp.objects.filter((o) => o.kind === 'entity' && /OilRefinery|Blender|Packager|Constructor|Assembler/.test(o.cls)).map((o) => `${o.cls.replace(/^Build_|_C$/g, '')}@${Math.round(o.pos[0] / 100)},${Math.round(o.pos[1] / 100)}`);
console.log(m.join(' '));
