// Wie speichert das Spiel Rohre mit Ecken? Rohre mit ≥ 3 Spline-Punkten aus echten Blaupausen ausgeben (lokal, gerundet)
import fs from 'node:fs';
import path from 'node:path';
import { readBlueprint } from '../../app/lib/sbp.mjs';
const dateien = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.sbp$/i.test(e.name) && fs.statSync(p).size < 2e6) dateien.push(p); } };
walk(process.argv[2]);
let n = 0; const punkte = {}; const laengen = [];
for (const f of dateien) {
  let bp; try { bp = readBlueprint(fs.readFileSync(f)); } catch { continue; }
  for (const o of bp.objects.filter((x) => x.kind === 'entity' && /Pipeline(MK2)?(_NoIndicator)?_C$/.test(x.cls) && x.spline)) {
    punkte[o.spline.length] = (punkte[o.spline.length] || 0) + 1;
    const l = o.spline.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - o.spline[i][0], p[1] - o.spline[i][1], p[2] - o.spline[i][2]), 0); laengen.push(l);
    if (o.spline.length >= 3 && n < 6) {
      n++;
      console.log(`\n${path.basename(f)} ${o.cls}`);
      for (const p of o.spline) console.log('  P', p.slice(0, 3).map(Math.round), ' A', p.slice(3, 6).map(Math.round), ' L', p.slice(6, 9).map(Math.round));
    }
  }
}
laengen.sort((a, b) => a - b);
console.log('\nPunkte je Rohr:', JSON.stringify(punkte), '| Länge: Median', Math.round(laengen[laengen.length >> 1]), 'cm, Max', Math.round(laengen[laengen.length - 1]), 'cm');
