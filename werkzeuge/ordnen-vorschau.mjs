// Ordnen-Trockenlauf für einen Sortier-Ordner: Namensvorschlag + Zielordner in der Ablage, wie „Einsortieren“ in der App
// (vorschlagGelernt mit dem Lernmodell aus allen schon benannten Blaupausen + eigenen Korrekturen). Ändert nichts.
// Aufruf:  node werkzeuge/ordnen-vorschau.mjs "<Sortier-Ordner>"   →  userdata/ordnen-vorschau-<datum>.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKatalog } from '../app/lib/katalog.mjs';
import { scannen, lernen, vorschlagGelernt, ablageOrdner, pass, setGruppen, setPraefixe, GRUPPE_NAME, MAXLEN } from '../app/lib/ordnen.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'userdata');
const ziel = process.argv[2];
if (!ziel || !fs.existsSync(ziel)) { console.error('Sortier-Ordner fehlt oder existiert nicht.'); process.exit(1); }
const json = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const settings = json(path.join(DATA, 'einstellungen.json'), {});
setGruppen(settings.struktur || null); setPraefixe(settings.namensPraefixe);
const docs = path.join(settings.gameDir, 'CommunityResources', 'Docs', `${settings.sprache || 'de'}.json`);
const kat = loadKatalog(docs, path.join(DATA, `katalog-cache-${settings.sprache || 'de'}.json`));

const bpRoot = path.join(settings.saveDir, 'blueprints');
const orte = [{ ort: 'Spiel', root: bpRoot, ohneWurzel: true }, ...(settings.bibliotheken || []).filter((b) => fs.existsSync(b)).map((root) => ({ ort: 'Bibliothek', root }))];
const { eintraege } = scannen(orte, kat, path.join(DATA, 'ordnen-cache.json'), console.log);
// Lernmodell wie getModell() im Server
const eigene = Object.fromEntries(Object.entries(json(path.join(DATA, 'ordnen-eigene.json'), {})).map(([id, v]) => [id, { ...v, alt: id.split('|').pop() }]));
for (const k of json(path.join(DATA, 'namen-gelernt.json'), [])) eigene['k|' + k.alt] = k;
const modell = lernen(eintraege, eigene);

const zielAbs = path.resolve(ziel);
const istSortieren = (e) => e.ort === 'Bibliothek' && path.resolve(e.root, e.dir).toLowerCase().startsWith(zielAbs.toLowerCase());
// schon vorhandene Namen in der Ablage (Kollisionen anzeigen)
const ablageNamen = new Set(eintraege.filter((e) => e.ort === 'Spiel' && e.dir.startsWith('_Ablage')).map((e) => e.alt.toLowerCase()));
const liste = [];
for (const e of eintraege.filter(istSortieren)) {
  // Lücke in pass(): "2025_10_10 12_12_46" sieht wie ein Schema-Name aus (Code "2025_10" gibt es aber nicht) → wie unbenannt behandeln
  const unecht = pass(e.alt) && !GRUPPE_NAME[(/^\d+_\d+/.exec(e.alt) || [''])[0]];
  const v = vorschlagGelernt(unecht ? { ...e, alt: 'unbenannt' } : e, e.m, modell);
  if (unecht) v.grund += ' (Zeitstempel-Name)';
  liste.push({
    datei: path.relative(zielAbs, path.join(e.root, e.dir, e.alt)), alt: e.alt, neu: v.neu, code: v.code, gruppe: GRUPPE_NAME[v.code] || '',
    ordner: ablageOrdner(v.code, v.neu), grund: v.grund, gelernt: !!v.gelernt, doppelt: !!v.doppelt, ok: pass(v.neu),
    nameSchonInAblage: ablageNamen.has(String(v.neu).toLowerCase()), n: e.m.n, dim: e.m.dim, prod: e.m.prod?.[0]?.name || null, fehler: e.m.fehler || null,
  });
}
// gleiche neue Namen innerhalb des Plans
const zaehl = {}; for (const r of liste) zaehl[r.neu.toLowerCase()] = (zaehl[r.neu.toLowerCase()] || 0) + 1;
for (const r of liste) r.nameMehrfach = zaehl[r.neu.toLowerCase()] > 1;
const proGruppe = {}; for (const r of liste) proGruppe[r.code] = (proGruppe[r.code] || 0) + 1;
const bericht = {
  zeit: new Date().toISOString(), ordner: zielAbs, maxLen: MAXLEN, lernBeispiele: modell.anzahl, anzahl: liste.length,
  gelernt: liste.filter((r) => r.gelernt).length, schonSchema: liste.filter((r) => r.grund === 'passt schon zum Schema').length,
  vermutlichDoppelt: liste.filter((r) => r.doppelt).length, unklar_9_9: proGruppe['9_9'] || 0,
  nameSchonInAblage: liste.filter((r) => r.nameSchonInAblage).length, nameMehrfach: liste.filter((r) => r.nameMehrfach).length,
  proGruppe, liste,
};
const datei = path.join(DATA, `ordnen-vorschau-${bericht.zeit.slice(0, 10)}.json`);
fs.writeFileSync(datei, JSON.stringify(bericht, null, 1));
console.log(JSON.stringify({ ...bericht, liste: undefined, bericht: datei }, null, 1));
