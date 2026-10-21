// Gebäude-Blaupause analysieren: Version, Ausdehnung, Etagen (Böden nach Höhe), Bauteile je Etage, Wände/Türen/Fenster, Treppen/Aufzüge
import fs from 'node:fs';
import { readBlueprint, readCfg } from '../../app/lib/sbp.mjs';
const f = process.argv[2];
const bp = readBlueprint(fs.readFileSync(f), { props: false });
let cfg = {}; try { cfg = readCfg(fs.readFileSync(f + 'cfg')); } catch { /* */ }
const ents = bp.objects.filter((o) => o.kind === 'entity');
const k = (o) => o.cls.replace(/^Build_|_C$/g, '');
const xs = ents.map((o) => o.pos[0]), ys = ents.map((o) => o.pos[1]), zs = ents.map((o) => o.pos[2]);
console.log(`v${bp.header.saveVersion}, ${ents.length} Objekte, Ausdehnung ${Math.round((Math.max(...xs) - Math.min(...xs)) / 100)} × ${Math.round((Math.max(...ys) - Math.min(...ys)) / 100)} × ${Math.round((Math.max(...zs) - Math.min(...zs)) / 100)} m, Beschreibung: ${cfg.description || '-'}`);
const alle = {}; for (const o of ents) alle[k(o)] = (alle[k(o)] || 0) + 1;
console.log('Bauteile:', Object.entries(alle).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}×${n}`).join(', '));
// Böden = Fundamente/Glasböden/Decken nach Höhe
const boden = ents.filter((o) => /Foundation|Ramp|Floor|Catwalk|Roof/.test(o.cls) && !/Ramp/.test(o.cls));
const ebenen = {};
for (const o of boden) { const z = Math.round(o.pos[2] / 50) * 50; (ebenen[z] ||= []).push(o); }
console.log('\nBöden nach Höhe (z cm → Anzahl, Klassen, x/y-Ausdehnung m):');
for (const [z, l] of Object.entries(ebenen).sort((a, b) => +a[0] - +b[0])) {
  const c = {}; for (const o of l) c[k(o)] = (c[k(o)] || 0) + 1;
  const lx = l.map((o) => o.pos[0]), ly = l.map((o) => o.pos[1]);
  console.log(`  z ${String(z).padStart(6)}: ${String(l.length).padStart(4)}  ${Object.entries(c).map(([a, b]) => a + '×' + b).join(', ').slice(0, 90)}  ${Math.round((Math.max(...lx) - Math.min(...lx)) / 100) + 8}×${Math.round((Math.max(...ly) - Math.min(...ly)) / 100) + 8} m`);
}
// Wände je Höhe
const waende = ents.filter((o) => /Wall|Door|Window|Gate/.test(o.cls));
const wz = {}; for (const o of waende) { const z = Math.round(o.pos[2] / 50) * 50; wz[z] = (wz[z] || 0) + 1; }
console.log('\nWände nach Höhe:', Object.entries(wz).sort((a, b) => +a[0] - +b[0]).map(([z, n]) => `${z}:${n}`).join('  '));
const t = ents.filter((o) => /Stair|Elevator|Ladder|Lift/.test(o.cls)); console.log('Treppen/Aufzüge:', t.map((o) => `${k(o)}@${Math.round(o.pos[2])}`).slice(0, 20).join(', '));
