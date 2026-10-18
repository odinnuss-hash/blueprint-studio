// Duplikate in einem Sortier-Ordner finden – gegen sich selbst und gegen die schon einsortierten Blaupausen im Spiel (_Ablage + Sitzungen).
// Kandidaten: gleiche Bauteil-Signatur UND Form-Fingerabdruck >= 99 % (wie "Ordnen"), oder byte-gleiche Datei.
// Verschoben wird nur, was byte-gleich ist oder in ALLEN Bauteilen (Art, Lage, Drehung, Inhalt) übereinstimmt; der Rest wird nur gemeldet.
// Aufruf:  node werkzeuge/duplikate-pruefen.mjs "<Sortier-Ordner>" [--anwenden]
//   ohne --anwenden: nur Bericht (userdata/duplikate-<datum>.json)
//   mit  --anwenden: Duplikate (+ .sbpcfg) alle nach <Ordner>\_Duplikate verschieben (gleiche Namen → " (2)" …; nichts wird gelöscht)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readBlueprint } from '../app/lib/sbp.mjs';
import { merkmale, aehnlichkeit, istNichtssagend, istMojibake } from '../app/lib/ordnen.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ziel = process.argv[2];
const anwenden = process.argv.includes('--anwenden');
if (!ziel || !fs.existsSync(ziel)) { console.error('Sortier-Ordner fehlt oder existiert nicht.'); process.exit(1); }
const settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'userdata', 'einstellungen.json'), 'utf8'));
const bpRoot = path.join(settings.saveDir, 'blueprints');
const SKIP = /^_(archiv|pakete|duplikate)$/i;

function sammeln(root, ort) {
  const out = [];
  const walk = (rel) => {
    let l = []; try { l = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of l) {
      const r = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) { if (!SKIP.test(e.name)) walk(r); }
      else if (e.name.toLowerCase().endsWith('.sbp')) out.push({ ort, root, rel: r, dir: rel, name: e.name.slice(0, -4) });
    }
  };
  walk('');
  return out;
}
const liste = [...sammeln(ziel, 'sortieren'), ...(fs.existsSync(bpRoot) ? sammeln(bpRoot, 'spiel') : [])];
// kompletter Inhalts-Abdruck (wie der Form-Fingerabdruck in ordnen.mjs, aber über ALLE Bauteile, nicht nur 128)
const fnv = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
function vollerAbdruck(bp) {
  const os = bp.objects.filter((o) => (o.cls || '').startsWith('Build_') && o.pos);
  if (!os.length) return '';
  const med = (k) => { const a = os.map((o) => o.pos[k]).sort((p, q) => p - q); return Math.round(a[a.length >> 1] / 400) * 400; };
  const c = [med(0), med(1), med(2)];
  const l = os.map((o) => {
    let inhalt = '';
    if (bp.body && o.dBody != null && o.dEnd > o.dBody) inhalt = String(fnv(bp.body.toString('latin1', o.dBody, o.dEnd).replace(/_C_\d+/g, '_C_#').replace(/\.[A-Za-z]+_\d+/g, '.#')));
    const [x, y, z, w] = o.rot || [0, 0, 0, 1];
    const yaw = Math.round(Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * 12 / Math.PI);
    return o.cls + ':' + Math.round((o.pos[0] - c[0]) / 100) + ',' + Math.round((o.pos[1] - c[1]) / 100) + ',' + Math.round((o.pos[2] - c[2]) / 100) + ':' + yaw + ':' + inhalt;
  }).sort();
  return crypto.createHash('md5').update(l.join('\n')).digest('hex');
}
let i = 0;
for (const e of liste) {
  const buf = fs.readFileSync(path.join(e.root, e.rel));
  e.md5 = crypto.createHash('md5').update(buf).digest('hex');
  e.size = buf.length;
  try { const bp = readBlueprint(buf); e.m = merkmale(bp, null); e.voll = vollerAbdruck(bp); } catch (err) { e.m = null; e.fehler = err.message; }
  if (++i % 250 === 0) console.log(`  ${i}/${liste.length} gelesen …`);
}
// Wer bleibt? Spiel (schon einsortiert) vor Sortieren; dann besserer Name (Schema, kein "(2)", nicht nichtssagend), dann flacherer Pfad
const note = (e) => (e.ort === 'spiel' ? 100 : 0) + (/^\d+_\d+_/.test(e.name) ? 8 : 0) + (istNichtssagend(e.name.replace(/\(\d+\)$/, '').trim()) ? 0 : 4)
  + (/\(\d+\)$|[_ ]\d$/.test(e.name) ? 0 : 2) + (istMojibake(e.name) ? 0 : 2) - e.dir.split(path.sep).length * 0.1;
// Gruppen: byte-gleich ODER (Signatur gleich und Fingerabdruck >= 99 %)
const parent = liste.map((_, k) => k);
const find = (k) => (parent[k] === k ? k : (parent[k] = find(parent[k])));
const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
const nachMd5 = new Map(), nachSig = new Map();
liste.forEach((e, k) => {
  if (nachMd5.has(e.md5)) union(nachMd5.get(e.md5), k); else nachMd5.set(e.md5, k);
  if (e.m && e.m.n > 0 && e.m.sk?.length) { const s = e.m.sig; if (!nachSig.has(s)) nachSig.set(s, []); nachSig.get(s).push(k); }
});
for (const ks of nachSig.values()) for (let a = 0; a < ks.length; a++) for (let b = a + 1; b < ks.length; b++)
  if (find(ks[a]) !== find(ks[b]) && aehnlichkeit(liste[ks[a]].m.sk, liste[ks[b]].m.sk) >= 0.99) union(ks[a], ks[b]);
const gruppen = new Map();
liste.forEach((e, k) => { const r = find(k); if (!gruppen.has(r)) gruppen.set(r, []); gruppen.get(r).push(e); });
const dups = [], gruppenBericht = [], fastGleich = [];
for (const g of gruppen.values()) {
  if (g.length < 2 || !g.some((e) => e.ort === 'sortieren')) continue;
  g.sort((a, b) => note(b) - note(a));
  const keep = g[0];
  const andere = g.slice(1).filter((e) => e.ort === 'sortieren');
  const gleich = (e) => e.md5 === keep.md5 || (e.voll && e.voll === keep.voll);
  const weg = andere.filter(gleich);
  for (const e of andere.filter((x) => !gleich(x))) fastGleich.push({ datei: e.rel, aehnlichWie: `${keep.ort}:${keep.rel}` });
  if (!weg.length) continue;
  gruppenBericht.push({ behalten: `${keep.ort}:${keep.rel}`, duplikate: weg.map((e) => ({ datei: e.rel, byteGleich: e.md5 === keep.md5 })) });
  for (const e of weg) dups.push({ e, keep });
}
const fehler = liste.filter((e) => e.ort === 'sortieren' && !e.m).map((e) => ({ datei: e.rel, fehler: e.fehler }));
const bericht = {
  zeit: new Date().toISOString(), ordner: ziel, angewendet: anwenden,
  gelesen: { sortieren: liste.filter((e) => e.ort === 'sortieren').length, spiel: liste.filter((e) => e.ort === 'spiel').length },
  duplikate: dups.length, davonByteGleich: dups.filter((d) => d.e.md5 === d.keep.md5).length, davonGegenSpiel: dups.filter((d) => d.keep.ort === 'spiel').length,
  fastGleichNichtVerschoben: fastGleich, unlesbar: fehler, gruppen: gruppenBericht,
};
if (anwenden) {
  let ok = 0; const probleme = [];
  for (const { e } of dups) {
    const zielDir = path.join(ziel, '_Duplikate');
    fs.mkdirSync(zielDir, { recursive: true });
    let n = e.name, k = 2;
    while (fs.existsSync(path.join(zielDir, n + '.sbp'))) n = `${e.name} (${k++})`;
    try {
      fs.renameSync(path.join(ziel, e.rel), path.join(zielDir, n + '.sbp'));
      const cfg = path.join(ziel, e.rel) + 'cfg';
      if (fs.existsSync(cfg)) fs.renameSync(cfg, path.join(zielDir, n + '.sbpcfg'));
      ok++;
    } catch (err) { probleme.push({ datei: e.rel, fehler: err.message }); }
  }
  bericht.verschoben = ok; bericht.probleme = probleme;
}
const datei = path.join(ROOT, 'userdata', `duplikate-${anwenden ? 'verschoben' : 'trockenlauf'}-${bericht.zeit.slice(0, 10)}.json`);
fs.writeFileSync(datei, JSON.stringify(bericht, null, 1));
console.log(JSON.stringify({ ...bericht, gruppen: bericht.gruppen.length, fastGleichNichtVerschoben: fastGleich.length, unlesbar: fehler.length, bericht: datei }, null, 1));
