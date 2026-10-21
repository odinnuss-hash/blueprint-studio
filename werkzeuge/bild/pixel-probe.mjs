// Pixel-Art-Probe (Format 1.2 / v60, Vorlage „Quadratisches Schild 0,5 m“ aus der Vorlagen-Bibliothek):
// zwei Felder 32 × 16 Pixel – oben Farbverlauf (Farbton × Helligkeit), unten Graustufen 0…100 % in 16 Stufen.
// Feld A: Bildfarben (sRGB) → linear umgerechnet, Feld B: Bildfarben direkt. Im Spiel prüfen, welches dem Bild entspricht.
//
// Aufruf: node werkzeuge/bild/pixel-probe.mjs  (Ziel-Spielstand: BS_SITZUNG oder Einstellung „Spielstand“)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBlueprint, readBlueprint } from '../../app/lib/sbp.mjs';
import { makeHead, i32 } from '../../app/lib/vorlagen.mjs';
import { zerlege, propListe, setzeSchildTexte } from '../../app/lib/eigenschaften.mjs';
import { loadKatalog } from '../../app/lib/katalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'userdata');
const EINST = JSON.parse(fs.readFileSync(path.join(DATA, 'einstellungen.json'), 'utf8'));
const SITZUNG = process.env.BS_SITZUNG || EINST.spielSitzung;
if (!SITZUNG) throw new Error('Kein Ziel-Spielstand: BS_SITZUNG setzen');
const lib = JSON.parse(fs.readFileSync(path.join(DATA, 'vorlagen-cache.json'), 'utf8'));
const kat = loadKatalog(path.join(EINST.gameDir, 'CommunityResources', 'Docs', 'de.json'), path.join(DATA, 'katalog-cache-de.json'));
const V = String(lib.basis.saveVersion);

const PIXEL = 'Build_StandaloneWidgetSign_Square_Tiny_C', TEXT = 'Build_StandaloneWidgetSign_SmallVeryWide_C';
const vorlage = (cls) => { const t = lib.vorlagen[V]?.[cls]; if (!t) throw new Error(`Keine Vorlage ${cls} (v${V})`); return { ...t, typePath: lib.pfade[cls], data: Buffer.from(t.data, 'base64') }; };
const tPixel = vorlage(PIXEL), tText = vorlage(TEXT);

/** Schild-Daten: Farben (alle drei gleich), Texte, Symbole aus, Leuchten */
function schildDaten(t, farbe, texte = { Name: '', Other_Text: '' }, leuchten = 0) {
  let d = setzeSchildTexte(t.data, texte);
  d = Buffer.from(d);
  const z = zerlege(d, true);
  for (const p of z.props) {
    if (/^m(Foreground|Background|Auxilary)Color$/.test(p.name) && p.size === 16) (p.name === 'mForegroundColor' && texte.Name ? [1, 1, 1, 1] : [...farbe, 1]).forEach((v, i) => d.writeFloatLE(v, p.valStart + i * 4));
    if (p.name === 'mEmissive' && p.size === 4) d.writeFloatLE(leuchten, p.valStart);
    if (p.name === 'mPrefabIconElementSaveData') { // alle Symbole aus (IconID −1)
      const n = d.readInt32LE(p.valStart); let q = p.valStart + 4;
      for (let k = 0; k < n; k++) { const l = propListe(d, q); const id = l.props.find((x) => x.name === 'IconID'); if (id && id.size === 4) d.writeInt32LE(-1, id.valStart); q = l.noneEnd; }
    }
  }
  return d;
}
const sRGBzuLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hsv = (h, s, v) => { const f = (n) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)]; };

let nr = 2147480000 - Math.floor(Math.random() * 4e7);
const objs = [];
const setze = (t, farbe, pos, yaw, texte, leuchten) => {
  const inst = `Persistent_Level:PersistentLevel.${t.typePath.split('.').pop()}_${nr--}`;
  const a = (yaw * Math.PI) / 360, d = schildDaten(t, farbe, texte, leuchten);
  objs.push({ head: makeHead({ typePath: t.typePath, instance: inst, flags: t.flags, hasFlags: lib.basis.hasFlags, rot: [0, 0, Math.sin(a), Math.cos(a)], pos, placed: t.placed }), data: Buffer.concat([i32(d.length), d]) });
};
// Bild 32 × 16: oben 8 Zeilen Farbverlauf, unten 8 Zeilen Graustufen (16 Stufen à 2 Spalten)
const B = 32, H = 16, P = 50;
const bild = (x, y) => (y < 8 ? hsv(x / B, y < 4 ? 1 : 1 - (y - 4) / 5, y < 4 ? 0.4 + y * 0.2 : 1) : (() => { const g = Math.floor(x / 2) / 15; return [g, g, g]; })());
// Schilder zeigen nach −Y; wer davor steht, hat −X rechts → Bildspalten laufen nach −X (sonst spiegelverkehrt)
for (const [feld, x0, umrechnen] of [['A', 0, true], ['B', -2000, false]]) {
  for (let x = 0; x < B; x++) for (let y = 0; y < H; y++) {
    const c = bild(x, y).map((v) => (umrechnen ? sRGBzuLinear(v) : v));
    setze(tPixel, c, [x0 - x * P, 0, 100 + (H - 1 - y) * P + 25], 180);
  }
  setze(tText, [0.02, 0.02, 0.025], [x0 - (B * P) / 2 + 25, 0, 100 + H * P + 120], 180, { Name: feld === 'A' ? 'A: Farben umgerechnet (linear)' : 'B: Farben direkt' }, 0);
}
// Kopf: Baukosten aus dem Katalog
const kosten = {};
for (const [cls, n] of [[PIXEL, 2 * B * H], [TEXT, 2]]) for (const [item, m] of kat.gebaeude[cls]?.kosten || []) kosten[item] = (kosten[item] || 0) + m * n;
const rezepte = [PIXEL, TEXT].map((c) => kat.pfade.rezepte[kat.gebaeude[c]?.rezept]).filter(Boolean);
const datei = createBlueprint(lib.basis, objs, { costs: Object.entries(kosten).filter(([it]) => kat.pfade.items[it]).map(([item, amount]) => ({ path: kat.pfade.items[item], amount })), recipes: rezepte, dimensions: [4, 4, 4] });
readBlueprint(datei); // Gegenprobe
const ziel = path.join(EINST.saveDir, 'blueprints', SITZUNG, 'TEST_Pixel_Farbprobe.sbp');
fs.writeFileSync(ziel, datei);
console.log(`${objs.length} Schilder → ${ziel}`);
