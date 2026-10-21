// Rohrpumpe: Komponenten, Rohr-Anschlüsse (lokal, mit Richtung der Rohrtangente), Strom (aus Kabel-Endpunkten), Lage (Neigung)
import fs from 'node:fs';
import path from 'node:path';
import { readBlueprint, readVectorAfter } from '../../app/lib/sbp.mjs';
const qRot = (q, v) => { const [x, y, z, w] = q; const [vx, vy, vz] = v; const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz; return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; };
const inv = (q) => [-q[0], -q[1], -q[2], q[3]];
const dateien = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/^_Duplikate$/i.test(e.name)) walk(p); } else if (/\.sbp$/i.test(e.name) && fs.statSync(p).size < 2e6) dateien.push(p); } };
walk(process.argv[2]);
const zaehl = (o, k) => { o[k] = (o[k] || 0) + 1; };
const anschl = {}, strom = {}, komp = {}, lage = {};
let pumpen = 0;
for (const f of dateien) {
  let bp; try { bp = readBlueprint(fs.readFileSync(f)); } catch { continue; }
  const byInst = new Map(bp.objects.map((o) => [o.instance, o]));
  const pu = bp.objects.filter((o) => o.kind === 'entity' && /PipelinePump/.test(o.cls));
  if (!pu.length) continue;
  pumpen += pu.length;
  for (const p of pu) {
    const up = qRot(p.rot, [0, 0, 1]); zaehl(lage, `${p.cls.replace(/^Build_|_C$/g, '')} oben=[${up.map((v) => Math.round(v * 10) / 10)}]`);
    for (const c of bp.objects.filter((o) => o.kind === 'component' && o.parent === p.instance)) zaehl(komp, `${p.cls.replace(/^Build_|_C$/g, '')}.${c.instance.split('.').pop()} ${c.typePath.split('.').pop()}`);
  }
  // Rohre, die an Pumpen hängen
  for (const r of bp.objects.filter((o) => o.kind === 'entity' && /Pipeline(MK2)?(_NoIndicator)?_C$/.test(o.cls) && o.spline?.length >= 2)) {
    for (const k of bp.objects.filter((o) => o.kind === 'component' && o.parent === r.instance)) {
      const d = bp.body.toString('latin1', k.dBody, k.dEnd);
      const m = /mConnectedComponent[\s\S]*?Persistent_Level\x00[\s\S]{4}(Persistent_Level:PersistentLevel\.[^\x00]+)/.exec(d);
      if (!m) continue;
      const ziel = byInst.get(m[1]); const geb = ziel && byInst.get(ziel.parent);
      if (!geb || !/PipelinePump/.test(geb.cls)) continue;
      const ende = /Connection0$/.test(k.instance) ? 0 : r.spline.length - 1, sp = r.spline[ende];
      const welt = qRot(r.rot, sp.slice(0, 3)).map((v, i) => v + r.pos[i]);
      const t = ende === 0 ? sp.slice(6, 9) : sp.slice(3, 6).map((v) => -v); // zeigt vom Anschluss weg ins Rohr
      const lok = qRot(inv(geb.rot), welt.map((v, i) => v - geb.pos[i])).map((v) => Math.round(v / 5) * 5);
      const dl = qRot(inv(geb.rot), qRot(r.rot, t)); const n = Math.hypot(...dl) || 1;
      zaehl(anschl, `${ziel.instance.split('.').pop()} [${lok}] Richtung [${dl.map((v) => Math.round(v / n * 10) / 10)}]`);
    }
  }
  for (const l of bp.objects.filter((o) => o.kind === 'entity' && /PowerLine/.test(o.cls))) {
    const txt = bp.body.toString('latin1', l.dBody, l.dEnd);
    const i1 = txt.indexOf('Locations\x00'); if (i1 < 0) continue;
    const i2 = txt.indexOf('Locations\x00', i1 + 10);
    const L = [readVectorAfter(bp.body, l.dBody + i1, l.dEnd), i2 > 0 ? readVectorAfter(bp.body, l.dBody + i2, l.dEnd) : null];
    const refs = [...txt.matchAll(/Persistent_Level:PersistentLevel\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g)].slice(-2);
    refs.forEach((m, j) => {
      const geb = byInst.get('Persistent_Level:PersistentLevel.' + m[1]);
      if (!geb || !/PipelinePump/.test(geb.cls) || !L[j]) return;
      zaehl(strom, `${m[2]} [${qRot(inv(geb.rot), L[j].map((v, i) => v - geb.pos[i])).map((v) => Math.round(v / 5) * 5)}]`);
    });
  }
}
const top = (o, n = 6) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `  ${v}× ${k}`).join('\n');
console.log(`Pumpen: ${pumpen}\nKomponenten:\n${top(komp, 10)}\nLage:\n${top(lage)}\nRohr-Anschlüsse:\n${top(anschl, 10)}\nStrom:\n${top(strom)}`);
