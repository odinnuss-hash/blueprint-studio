// Förderbänder: steilste Steigung (Grad) je Band aus echten Blaupausen (Sehne zwischen Spline-Punkten) und
// Zuleitungen von gestapelten Leitungen: Splitter höher als der Maschinenanschluss → Höhe, waagerechte Strecke, Punkte
import fs from 'node:fs';
import path from 'node:path';
import { readBlueprint } from '../../app/lib/sbp.mjs';
const dateien = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/^_Duplikate$/i.test(e.name)) walk(p); } else if (/\.sbp$/i.test(e.name) && fs.statSync(p).size < 4e6) dateien.push(p); } };
walk(process.argv[2]);
const winkel = {}; let n = 0;
const beispiele = [];
for (const f of dateien) {
  let bp; try { bp = readBlueprint(fs.readFileSync(f)); } catch { continue; }
  for (const o of bp.objects.filter((o) => o.kind === 'entity' && /ConveyorBeltMk/.test(o.cls) && o.spline?.length >= 2)) {
    const sp = o.spline; let max = 0;
    // fein abtasten (Hermite) für die echte steilste Stelle
    for (let i = 0; i + 1 < sp.length; i++) {
      const a = sp[i], b = sp[i + 1]; const P0 = a.slice(0, 3), P1 = b.slice(0, 3), T0 = a.length >= 9 ? a.slice(6, 9) : P1.map((v, k) => v - P0[k]), T1 = b.length >= 9 ? b.slice(3, 6) : P1.map((v, k) => v - P0[k]);
      let prev = P0;
      for (let s = 1; s <= 20; s++) {
        const t = s / 20, h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
        const p = [0, 1, 2].map((k) => h00 * P0[k] + h10 * T0[k] + h01 * P1[k] + h11 * T1[k]);
        const dz = p[2] - prev[2], dh = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
        if (dh + Math.abs(dz) > 5) max = Math.max(max, Math.atan2(Math.abs(dz), dh) * 180 / Math.PI);
        prev = p;
      }
    }
    const k = Math.min(90, Math.round(max / 5) * 5); winkel[k] = (winkel[k] || 0) + 1; n++;
    const lp = sp[sp.length - 1], dz = Math.abs(lp[2] - sp[0][2]), dh = Math.hypot(lp[0] - sp[0][0], lp[1] - sp[0][1]);
    if (dz >= 150 && dz <= 450 && dh < 1200 && beispiele.length < 12 && max > 25) beispiele.push(`${path.basename(f).slice(0, 40)}: Höhe ${Math.round(dz)} auf ${Math.round(dh)} cm, Punkte ${sp.length}, steilste ${Math.round(max)}°`);
  }
}
console.log('Bänder:', n);
console.log('steilste Stelle je Band (Grad → Anzahl):', Object.entries(winkel).sort((a, b) => +a[0] - +b[0]).map(([k, v]) => `${k}°:${v}`).join('  '));
console.log(beispiele.join('\n'));
