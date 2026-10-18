// Kategorien der Blaupausen in einem Sortier-Ordner gegenprüfen (ändert nichts).
// Je Blaupause drei unabhängige Meinungen zur Gruppe:
//   inhalt  – Regeln nur aus dem Inhalt (Bauteil-Mix, Maschinen), Name ignoriert
//   vorbild – die ähnlichsten schon abgelegten Blaupausen in der Spiel-Ablage (Bauteil-Mix + Größe, Mehrheit)
//   wort    – Wörter im Namen, wie du sie in der Ablage benutzt hast
// Ausgabe: userdata/kategorien-pruefung.json (alle) + kompakte Liste der Auffälligen auf der Konsole bzw. --alle für alle.
// Aufruf: node werkzeuge/kategorien-pruefen.mjs "<Sortier-Ordner>" [--alle]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKatalog } from '../app/lib/katalog.mjs';
import { scannen, vorschlag, setGruppen, setPraefixe, GRUPPE_NAME, GRUPPEN_STANDARD, GRUPPEN_NEU } from '../app/lib/ordnen.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'userdata');
const ziel = path.resolve(process.argv[2] || '');
if (!fs.existsSync(ziel)) { console.error('Ordner fehlt'); process.exit(1); }
const s = JSON.parse(fs.readFileSync(path.join(DATA, 'einstellungen.json'), 'utf8'));
const st = (s.struktur || GRUPPEN_STANDARD).slice();
for (const hg of GRUPPEN_NEU) if (!st.some(([c]) => c === hg || c.startsWith(hg + '_'))) st.push(...GRUPPEN_STANDARD.filter(([c]) => c === hg || c.startsWith(hg + '_')));
setGruppen(st); setPraefixe(s.namensPraefixe);
const kat = loadKatalog(path.join(s.gameDir, 'CommunityResources', 'Docs', 'de.json'), path.join(DATA, 'katalog-cache-de.json'));
const { eintraege } = scannen([{ ort: 'Spiel', root: path.join(s.saveDir, 'blueprints'), ohneWurzel: true }, { ort: 'Bibliothek', root: path.dirname(ziel) }], kat, path.join(DATA, 'ordnen-cache.json'));
const codeVon = (n) => (/^\d+_\d+/.exec(n) || [''])[0];
const rel = path.basename(ziel);
const pruef = eintraege.filter((e) => e.ort === 'Bibliothek' && e.dir.split('/')[0] === rel && e.m.n > 0);
const vorbilder = eintraege.filter((e) => e.ort === 'Spiel' && e.dir.startsWith('_Ablage') && e.m.n > 0 && GRUPPE_NAME[codeVon(e.alt)]);

// Bauteil-Mix als normierter Vektor über Katalog-Kategorien
const vek = (m) => { const v = {}; let q = 0; for (const [k, n] of Object.entries(m.cat)) { v[k] = n; q += n * n; } q = Math.sqrt(q) || 1; for (const k in v) v[k] /= q; return v; };
const cos = (a, b) => { let x = 0; for (const k in a) if (b[k]) x += a[k] * b[k]; return x; };
const nah = (a, b) => Math.max(a, b) / Math.max(1, Math.min(a, b));
for (const e of [...pruef, ...vorbilder]) e.v = vek(e.m);
// Wörter → Gruppe aus der Ablage
const STOPP = new Set(['test', 'teil', 'neu', 'alt', 'groß', 'gross', 'klein', 'links', 'rechts', 'mitte', 'variante', 'version', 'gerade', 'kurve', 'ecke', 'ende', 'oben', 'unten']);
const worte = (n) => n.replace(/^\d+_\d+_/, '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').split(/[^a-z]+/).filter((w) => w.length >= 4 && !STOPP.has(w));
const wortGruppen = new Map();
for (const e of vorbilder) for (const w of new Set(worte(e.alt))) { const m = wortGruppen.get(w) || {}; m[codeVon(e.alt)] = (m[codeVon(e.alt)] || 0) + 1; wortGruppen.set(w, m); }

const kurz = (k) => k.replace(/^Organisation\//, '').replace(/^Transport\//, 'T:').replace(/^Produktion\//, 'P:').replace(/^Energie\//, 'E:').replace(/^Wände\//, 'W:');
const out = [];
for (const e of pruef) {
  const code = codeVon(e.alt);
  const inhalt = vorschlag({ alt: 'unbenannt', dir: '' }, e.m).code;
  // Vorbilder: ähnlicher Mix (cos ≥ 0,9) und ähnliche Teilezahl (Faktor ≤ 3)
  const nn = vorbilder.map((b) => [b, cos(e.v, b.v)]).filter(([b, c]) => c >= 0.9 && nah(e.m.n, b.m.n) <= 3).sort((a, b) => b[1] - a[1]).slice(0, 7);
  const z = {}; for (const [b] of nn) z[codeVon(b.alt)] = (z[codeVon(b.alt)] || 0) + 1;
  const [vb, vbN] = Object.entries(z).sort((a, b) => b[1] - a[1])[0] || [null, 0];
  const wz = {}; for (const w of worte(e.alt)) { const m = wortGruppen.get(w); if (!m) continue; const t = Object.values(m).reduce((a, b) => a + b, 0); for (const [c, n] of Object.entries(m)) wz[c] = (wz[c] || 0) + n / t; }
  const [wort, wortS] = Object.entries(wz).sort((a, b) => b[1] - a[1])[0] || [null, 0];
  const top = Object.entries(e.m.cat).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${kurz(k)} ${Math.round(n / e.m.n * 100)}%`).join(', ');
  const r = { id: e.id, datei: `${e.dir}/${e.alt}`, name: e.alt, code, n: e.m.n, dim: e.m.dim, top, masch: Object.entries(e.m.masch).map(([k, n]) => `${n}×${k}`).join(' '), prod: e.m.prod?.[0]?.name || '',
    inhalt, vorbild: vb && vbN >= 3 && vbN / nn.length >= 0.6 ? vb : null, vorbildWie: nn.slice(0, 2).map(([b, c]) => `${b.alt} (${Math.round(c * 100)}%)`), wort: wortS >= 1 ? wort : null };
  const andere = [r.inhalt, r.vorbild, r.wort].filter((c) => c && c !== code);
  r.auffaellig = andere.length > 0 && (r.vorbild && r.vorbild !== code || r.wort && r.wort !== code || (r.inhalt !== code && r.inhalt[0] !== code[0]));
  out.push(r);
}
fs.writeFileSync(path.join(DATA, 'kategorien-pruefung.json'), JSON.stringify(out, null, 1));
const zeige = process.argv.includes('--alle') ? out : out.filter((r) => r.auffaellig);
console.log(`geprüft ${out.length}, Vorbilder ${vorbilder.length}, auffällig ${out.filter((r) => r.auffaellig).length}`);
for (const r of zeige) console.log([r.code, r.name, r.n, r.dim.join('x'), r.top, r.masch, r.prod, `I:${r.inhalt}`, `V:${r.vorbild || '-'}`, `W:${r.wort || '-'}`].join(' | '));
