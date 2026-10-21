// Welche Blaupausen enthalten Wasserextraktoren? Mit Fundamenten darunter? Stammen sie aus dem Spiel (Designer) oder aus Karte→Blaupause?
import fs from 'node:fs';
import path from 'node:path';
import { readBlueprint } from '../../app/lib/sbp.mjs';
const dateien = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/^_Duplikate$/i.test(e.name)) walk(p); } else if (/\.sbp$/i.test(e.name) && fs.statSync(p).size < 3e6) dateien.push(p); } };
for (const a of process.argv.slice(2)) walk(a);
for (const f of dateien) {
  const roh = fs.readFileSync(f);
  let bp; try { bp = readBlueprint(roh, { props: false }); } catch { continue; }
  const ents = bp.objects.filter((o) => o.kind === 'entity');
  const wp = ents.filter((o) => /WaterPump/.test(o.cls));
  if (!wp.length) continue;
  const fund = ents.filter((o) => /Foundation/.test(o.cls)).length;
  const z = wp.map((o) => Math.round(o.pos[2]));
  console.log(`${path.relative(process.argv[2], f)}  Extraktoren ${wp.length}  Fundamente ${fund}  z ${[...new Set(z)].slice(0, 4)}  Objekte ${ents.length}  v${bp.header.saveVersion}`);
}
