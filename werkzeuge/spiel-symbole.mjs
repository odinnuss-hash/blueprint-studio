// Symbole der Spiel-Kategorien einmalig festlegen.
//   vorbereiten: neuen Spielstand anlegen, in dem alle Hauptgruppen als Kategorien (mit ihren Unterkategorien) vorhanden sind –
//                im Spiel laden, je Kategorie ein Symbol wählen („Ändern“), speichern.
//   lesen:       Symbole aus diesem Spielstand in die Einstellungen übernehmen (settings.spielSymbole) – die App nutzt sie
//                künftig für neu angelegte Kategorien.
// Aufruf: node werkzeuge/spiel-symbole.mjs vorbereiten "<Spielstand.sav>" "<Neuer Name>"
//         node werkzeuge/spiel-symbole.mjs lesen "<Spielstand.sav>"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSavHeader } from '../app/lib/sav.mjs';
import { kategorienSchreiben, kategorienLesen, SYMBOL_STANDARD } from '../app/lib/spielkategorien.mjs';
import { GRUPPEN_STANDARD, GRUPPEN_NEU } from '../app/lib/ordnen.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EINST = path.join(ROOT, 'userdata', 'einstellungen.json');
const [, , modus, quelle, neuName] = process.argv;
if (!['vorbereiten', 'lesen'].includes(modus) || !quelle || !fs.existsSync(quelle)) { console.error('Aufruf: spiel-symbole.mjs vorbereiten|lesen "<Spielstand.sav>" ["<Neuer Name>"]'); process.exit(1); }
const settings = JSON.parse(fs.readFileSync(EINST, 'utf8'));
const struktur = (settings.struktur || GRUPPEN_STANDARD).slice();
for (const hg of GRUPPEN_NEU) if (!struktur.some(([c]) => c === hg || c.startsWith(hg + '_'))) struktur.push(...GRUPPEN_STANDARD.filter(([c]) => c === hg || c.startsWith(hg + '_')));
const NAME = Object.fromEntries(struktur);
const haupt = struktur.filter(([c]) => !c.includes('_'));
const buf = fs.readFileSync(quelle);

if (modus === 'lesen') {
  const k = kategorienLesen(buf);
  const neu = {};
  // je Hauptgruppen-Nummer merken (sprachunabhängig)
  for (const c of k) { const g = haupt.find(([, n]) => n === c.name); if (!c.undef && g && c.icon >= 0) neu[g[0]] = c.icon; }
  for (const [code, n] of haupt) console.log(`  ${code} ${n}: ${neu[code] ?? '–'}${neu[code] === SYMBOL_STANDARD ? ' (Haus = Vorgabe)' : ''}`);
  settings.spielSymbole = { ...(settings.spielSymbole || {}), ...neu };
  fs.writeFileSync(EINST, JSON.stringify(settings, null, 2));
  console.log(`${Object.keys(neu).length} Symbole in den Einstellungen gespeichert.`);
  process.exit(0);
}

const ziel = path.join(path.dirname(quelle), String(neuName || 'Symbole').replace(/\.sav$/i, '') + '.sav');
if (fs.existsSync(ziel)) { console.error('Ziel gibt es schon: ' + ziel); process.exit(1); }
const header = readSavHeader(buf);
const sitzung = path.join(settings.saveDir, 'blueprints', header.sessionName);
const namen = fs.existsSync(sitzung) ? fs.readdirSync(sitzung).filter((f) => /\.sbp$/i.test(f)).map((f) => f.slice(0, -4)) : [];
const zuordnung = [];
for (const n of namen) { const m = /^(\d+)_(\d+)_/.exec(n); if (m && NAME[`${m[1]}_${m[2]}`]) zuordnung.push({ name: n, kategorie: NAME[m[1]], unterkategorie: NAME[`${m[1]}_${m[2]}`], kSort: +m[1], uSort: +m[2] }); }
const rang = {};
for (const [c, n] of struktur) { if (c.includes('_')) rang[`${NAME[c.split('_')[0]]}/${n}`] = +c.split('_')[1]; else rang[n] = +c; }
const anlegen = haupt.map(([c, n]) => ({ kategorie: n, unterkategorien: struktur.filter(([u]) => u.startsWith(c + '_')).map(([, u]) => u) }));
const symbole = Object.fromEntries(Object.entries(settings.spielSymbole || {}).map(([c, id]) => [NAME[c] ?? c, id]));
const r = kategorienSchreiben(buf, header, { zuordnung, vorhanden: new Set(namen), symbole, rang, anlegen });
let aus = r.ausgabe;
if (header.headerVersion >= 14) { const n = path.basename(ziel, '.sav'), alt = 4 + aus.readInt32LE(12); if (/^[\x00-\x7f]*$/.test(n)) aus = Buffer.concat([aus.subarray(0, 12), Buffer.from(Int32Array.of(n.length + 1).buffer), Buffer.from(n + '\0', 'latin1'), aus.subarray(12 + alt)]); }
fs.writeFileSync(ziel, aus);
console.log(`Geschrieben: ${ziel}`);
for (const c of r.kategorien) console.log(`  ${c.undef ? '(Unbestimmt)' : c.name} [${c.icon}]: ${c.subs.length} Unterkategorien, ${c.subs.reduce((a, s) => a + s.anzahl, 0)} Blaupausen`);
