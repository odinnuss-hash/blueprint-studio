// Blaupausen-Kategorien im Spiel testweise setzen: schreibt die Gruppen der Blaupausen im Sitzungsordner (Code im Namen,
// z. B. 1_1_…) als Kategorie/Unterkategorie in einen NEUEN Spielstand – das Original bleibt unverändert.
// Die App macht das selbst beim Holen ins Spiel (app/lib/spielkategorien.mjs); dieses Werkzeug ist zum Ausprobieren.
// Aufruf: node werkzeuge/kategorien-ins-spiel.mjs "<Spielstand.sav>" "<Neuer Name>"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSavHeader } from '../app/lib/sav.mjs';
import { kategorienSchreiben } from '../app/lib/spielkategorien.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [, , quelle, neuName] = process.argv;
if (!quelle || !neuName || !fs.existsSync(quelle)) { console.error('Aufruf: kategorien-ins-spiel.mjs "<Spielstand.sav>" "<Neuer Name>"'); process.exit(1); }
const ziel = path.join(path.dirname(quelle), neuName.replace(/\.sav$/i, '') + '.sav');
if (fs.existsSync(ziel)) { console.error('Ziel gibt es schon – anderen Namen wählen: ' + ziel); process.exit(1); }
const settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'userdata', 'einstellungen.json'), 'utf8'));
const GRUPPE = Object.fromEntries(settings.struktur || []);

const buf = fs.readFileSync(quelle);
const header = readSavHeader(buf);
const sitzung = path.join(settings.saveDir, 'blueprints', header.sessionName);
const namen = fs.existsSync(sitzung) ? fs.readdirSync(sitzung).filter((f) => /\.sbp$/i.test(f)).map((f) => f.slice(0, -4)) : [];
const zuordnung = [];
for (const n of namen) {
  const m = /^(\d+)_(\d+)_/.exec(n);
  if (!m || !GRUPPE[`${m[1]}_${m[2]}`]) continue;
  zuordnung.push({ name: n, kategorie: GRUPPE[m[1]] || m[1], unterkategorie: GRUPPE[`${m[1]}_${m[2]}`], kSort: +m[1], uSort: +m[2] });
}
const r = kategorienSchreiben(buf, header, { zuordnung, vorhanden: new Set(namen), leerWeg: new Set((settings.struktur || []).filter(([c]) => !c.includes('_')).map(([, n]) => n)), symbole: Object.fromEntries(Object.entries(settings.spielSymbole || {}).map(([c, id]) => [GRUPPE[c] ?? c, id])) });
// angezeigten Spielstandnamen im Kopf ersetzen (Kopfversion ≥ 14: Name direkt nach den drei Versionsnummern)
let aus = r.ausgabe;
if (header.headerVersion >= 14) {
  const alt = 4 + aus.readInt32LE(12), n = path.basename(ziel, '.sav');
  if (/^[\x00-\x7f]*$/.test(n)) aus = Buffer.concat([aus.subarray(0, 12), Buffer.from(Int32Array.of(n.length + 1).buffer), Buffer.from(n + '\0', 'latin1'), aus.subarray(12 + alt)]);
}
fs.writeFileSync(ziel, aus);
console.log(`Geschrieben: ${ziel} (Sitzung „${header.sessionName}“, ${zuordnung.length} von ${namen.length} zugeordnet)`);
for (const c of r.kategorien) console.log(`  ${c.undef ? '(Unbestimmt)' : c.name} [Symbol ${c.icon}]: ${c.subs.map((s) => `${s.name} (${s.anzahl})`).join(', ')}`);
