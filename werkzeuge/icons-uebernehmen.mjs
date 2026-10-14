// Blueprint Studio – Icons aus einem FModel-Export in die App uebernehmen (ohne Fremdpakete).
//
// Aufruf:  node werkzeuge/icons-uebernehmen.mjs ["<FModel-Export>\Output\Exports"]
//
// Kopiert genau die Icons, die der Gebaeude-/Item-Katalog braucht (mSmallIcon / mPersistentBigIcon
// aus CommunityResources\Docs\de.json), flach nach app\public\icons\<Name>.png.
// Meldet fehlende Icons – diese in FModel per Regex-Suche nachholen (siehe Hilfe -> FModel).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
// Export-Ordner: Parameter – sonst aus den Einstellungen (fmodelExport) – sonst werkzeuge\\FModel\\Output\\Exports
function exportOrdner(ROOT) {
  if (process.argv[2]) return process.argv[2];
  try { const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'userdata', 'einstellungen.json'), 'utf8')); if (s.fmodelExport) return s.fmodelExport; if (s.fmodel) return path.join(s.fmodel, 'Output', 'Exports'); } catch { /* Standard */ }
  return path.join(ROOT, 'werkzeuge', 'FModel', 'Output', 'Exports');
}
const SRC = exportOrdner(ROOT);
const DST = path.join(ROOT, 'app', 'public', 'icons');

let gameDir = '';
try { gameDir = JSON.parse(fs.readFileSync(path.join(ROOT, 'userdata', 'einstellungen.json'), 'utf8')).gameDir || gameDir; } catch { /* Standard */ }
const docs = ['de.json', 'en-US.json'].map((f) => path.join(gameDir, 'CommunityResources', 'Docs', f)).find((f) => fs.existsSync(f));
if (!docs) { console.error('Spieldaten (CommunityResources\\Docs\\de.json) nicht gefunden in', gameDir); process.exit(1); }
const raw = fs.readFileSync(docs);
const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le').slice(1) : raw.toString('utf8');
const need = new Set([...text.matchAll(/"m(?:PersistentBigIcon|SmallIcon)"\s*:\s*"Texture2D ([^".]*)\./g)].map((m) => m[1].split('/').pop()));

if (!fs.existsSync(SRC)) { console.error('Export-Ordner nicht gefunden:', SRC); process.exit(1); }
const have = new Map();
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.toLowerCase().endsWith('.png')) have.set(e.name.slice(0, -4), p); } };
walk(SRC);
fs.mkdirSync(DST, { recursive: true });
let n = 0;
const fehlt = [];
for (const name of need) {
  const p = have.get(name);
  if (!p) { fehlt.push(name); continue; }
  fs.copyFileSync(p, path.join(DST, name + '.png')); n++;
}
console.log(`${n} von ${need.size} Icons nach ${DST} kopiert.`);
if (fehlt.length) {
  console.log(`\n${fehlt.length} fehlen im Export. In FModel (Packages > Search, Regex an) suchen und als Textur exportieren:`);
  console.log('/(' + fehlt.sort().join('|') + ')\\.uasset$');
}
