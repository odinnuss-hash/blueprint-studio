// Woher bekommen Maschinen in echten Blaupausen Strom? Gegenstück des Kabels (Klasse) und dessen Lage lokal zur Maschine
import fs from 'node:fs';
import path from 'node:path';
import { readBlueprint } from '../../app/lib/sbp.mjs';
const qRot = (q, v) => { const [x, y, z, w] = q; const [vx, vy, vz] = v; const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz; return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; };
const inv = (q) => [-q[0], -q[1], -q[2], q[3]];
const MASCH = /^Build_(SmelterMk1|ConstructorMk1|AssemblerMk1|FoundryMk1|ManufacturerMk1|OilRefinery|Blender|Packager)_C$/;
const dateien = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/^_Duplikate$/i.test(e.name)) walk(p); } else if (/\.sbp$/i.test(e.name) && fs.statSync(p).size < 4e6) dateien.push(p); } };
walk(process.argv[2]);
const art = {}, lage = {};
const z = (o, k) => { o[k] = (o[k] || 0) + 1; };
for (const f of dateien) {
  let bp; try { bp = readBlueprint(fs.readFileSync(f)); } catch { continue; }
  const byInst = new Map(bp.objects.map((o) => [o.instance.split('.').pop(), o]));
  for (const l of bp.objects.filter((o) => o.kind === 'entity' && /PowerLine/.test(o.cls))) {
    const txt = bp.body.toString('latin1', l.dBody, l.dEnd);
    const refs = [...txt.matchAll(/Persistent_Level:PersistentLevel\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g)].slice(-2).map((m) => byInst.get(m[1]));
    if (refs.length < 2 || !refs[0] || !refs[1]) continue;
    for (const [m, g] of [[refs[0], refs[1]], [refs[1], refs[0]]]) {
      if (!MASCH.test(m.cls) || MASCH.test(g.cls)) continue;
      const k = m.cls.replace(/^Build_|Mk1|_C$/g, ''), gk = g.cls.replace(/^Build_|_C$/g, '');
      z(art, `${k} ← ${gk}`);
      const p = qRot(inv(m.rot), g.pos.map((v, i) => v - m.pos[i])).map((v) => Math.round(v / 100) * 100);
      z(lage, `${k} ← ${gk.replace(/PowerPole|Mk\d/g, (s) => s)} [${p}]`);
    }
  }
}
const top = (o, re, n) => Object.entries(o).filter(([k]) => re.test(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `  ${String(v).padStart(4)}× ${k}`).join('\n');
for (const k of ['Smelter', 'Constructor', 'Assembler', 'Foundry', 'Manufacturer', 'OilRefinery', 'Blender', 'Packager']) console.log(`=== ${k}\n${top(art, new RegExp('^' + k + ' '), 4)}\n${top(lage, new RegExp('^' + k + ' '), 4)}`);
