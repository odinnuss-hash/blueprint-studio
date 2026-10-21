// Reihenabstand: freier Abstand zwischen Maschinenkörpern benachbarter Reihen (gleiche Höhe, Überlappung quer zur Reihe)
import fs from 'node:fs';
import path from 'node:path';
import { readBlueprint } from '../../app/lib/sbp.mjs';
import { GEO } from '../../app/lib/fabrik.mjs';
const qRot = (q, v) => { const [x, y, z, w] = q; const [vx, vy, vz] = v; const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz; return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; };
const inv = (q) => [-q[0], -q[1], -q[2], q[3]];
const dateien = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/^_Duplikate$/i.test(e.name)) walk(p); } else if (/\.sbp$/i.test(e.name) && fs.statSync(p).size < 4e6) dateien.push(p); } };
walk(process.argv[2]);
const luecke = {}; const z = (k) => { luecke[k] = (luecke[k] || 0) + 1; };
for (const f of dateien) {
  let bp; try { bp = readBlueprint(fs.readFileSync(f), { props: false }); } catch { continue; }
  const m = bp.objects.filter((o) => o.kind === 'entity' && GEO[o.cls]);
  for (const a of m) {
    const ha = (GEO[a.cls].box[3] - GEO[a.cls].box[2]) / 2;
    let best = null;
    for (const b of m) {
      if (b === a) continue;
      const l = qRot(inv(a.rot), b.pos.map((v, i) => v - a.pos[i]));
      if (Math.abs(l[2]) > 100 || Math.abs(l[0]) > 300 || l[1] <= 0) continue; // vor der Maschine (+Y), etwa gleiche Spur
      const yb = Math.abs(qRot(inv(a.rot), qRot(b.rot, [0, 1, 0]))[1]) > 0.7; // b gleich ausgerichtet?
      const hb = ((yb ? GEO[b.cls].box[3] - GEO[b.cls].box[2] : GEO[b.cls].box[1] - GEO[b.cls].box[0])) / 2;
      const g = l[1] - ha - hb;
      if (g < -50) continue; // gleiche Reihe/überlappend
      if (!best || g < best) best = g;
    }
    if (best != null && best < 6000) z(Math.round(best / 100));
  }
}
const n = Object.values(luecke).reduce((s, v) => s + v, 0);
console.log('freier Abstand zwischen Maschinen benachbarter Reihen (m → Anzahl), n =', n);
console.log(Object.entries(luecke).sort((a, b) => +a[0] - +b[0]).map(([k, v]) => `${k}:${v}`).join('  '));
