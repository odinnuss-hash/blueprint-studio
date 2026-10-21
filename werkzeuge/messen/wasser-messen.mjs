// Wasserextraktor: Stromanschluss (lokal, aus Kabel-Endpunkten), Komponenten, Abstände benachbarter Extraktoren
import fs from 'node:fs';
import path from 'node:path';
import { readBlueprint, readVectorAfter } from '../../app/lib/sbp.mjs';
const qRot = (q, v) => { const [x, y, z, w] = q; const [vx, vy, vz] = v; const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz; return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; };
const inv = (q) => [-q[0], -q[1], -q[2], q[3]];
const dateien = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.sbp$/i.test(e.name)) dateien.push(p); } };
walk(process.argv[2]);
const strom = {}, abst = {}, komp = new Set();
for (const f of dateien) {
  let bp; try { bp = readBlueprint(fs.readFileSync(f)); } catch { continue; }
  const byInst = new Map(bp.objects.map((o) => [o.instance, o]));
  const wp = bp.objects.filter((o) => o.kind === 'entity' && /WaterPump/.test(o.cls));
  for (const o of bp.objects) if (o.kind === 'component' && wp.some((w) => w.instance === o.parent)) komp.add(o.instance.split('.').pop() + ' ' + o.typePath.split('.').pop());
  for (const a of wp) { const d = wp.filter((b) => b !== a).map((b) => Math.round(Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1]))).sort((x, y) => x - y)[0]; if (d) abst[d] = (abst[d] || 0) + 1; }
  for (const l of bp.objects.filter((o) => o.kind === 'entity' && /PowerLine/.test(o.cls))) {
    const txt = bp.body.toString('latin1', l.dBody, l.dEnd);
    const i1 = txt.indexOf('Locations\x00'); if (i1 < 0) continue;
    const i2 = txt.indexOf('Locations\x00', i1 + 10);
    const A = readVectorAfter(bp.body, l.dBody + i1, l.dEnd), B = i2 > 0 ? readVectorAfter(bp.body, l.dBody + i2, l.dEnd) : null;
    const refs = [...txt.matchAll(/Persistent_Level:PersistentLevel\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g)].slice(-2);
    refs.forEach((m, j) => {
      const geb = byInst.get('Persistent_Level:PersistentLevel.' + m[1]);
      if (!geb || !/WaterPump/.test(geb.cls)) return;
      const L = j === 0 ? A : B; if (!L) return;
      const welt = L;
      const lok = qRot(inv(geb.rot), welt.map((v, i) => v - geb.pos[i])).map((v) => Math.round(v / 5) * 5);
      const k = `${m[2]} [${lok}]`; strom[k] = (strom[k] || 0) + 1;
    });
  }
}
console.log('Komponenten:', [...komp].join(' | '));
console.log('Strom (lokal):', Object.entries(strom).sort((a, b) => b[1] - a[1]).slice(0, 6));
console.log('nächster Nachbar (cm):', Object.entries(abst).sort((a, b) => b[1] - a[1]).slice(0, 8));
