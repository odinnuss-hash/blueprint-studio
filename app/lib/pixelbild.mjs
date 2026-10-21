// Pixel-Art aus einem Bild: je Pixel ein quadratisches Schild, Farbe = Hintergrundfarbe (Format 1.2, Vorlage aus der Vorlagen-Bibliothek).
//
// Gemessen/geprüft (20.10.2026): Pixel-Art in Community-Blaupausen = „Quadratisches Schild“ (Tiny 0,5 m, Small 1 m, Square 2 m),
// Farbe in mBackgroundColor. Im Spiel geprüft: Bildfarben DIREKT übernehmen (keine sRGB→linear-Umrechnung). Vorlage (v60) hat
// Symbol + Hintergrund-Symbol + Text + Leuchten 3 → für Pixel: Symbole −1, Texte leer, Vorder-/Hinter-/Zusatzfarbe gleich.
// Wand: Fläche zeigt nach −Y (Drehung 180°); wer davor steht, hat −X rechts → Bildspalten laufen nach −X (sonst spiegelverkehrt).
// Boden: Fläche zeigt nach oben (+Y → +Z, Drehung 90° um X).
import { createBlueprint, readBlueprint } from './sbp.mjs';
import { makeHead, i32 } from './vorlagen.mjs';
import { zerlege, propListe, setzeSchildTexte } from './eigenschaften.mjs';

export const PIXEL_GROESSE = { tiny: ['Build_StandaloneWidgetSign_Square_Tiny_C', 50], small: ['Build_StandaloneWidgetSign_Square_Small_C', 100], square: ['Build_StandaloneWidgetSign_Square_C', 200] };
export const MAX_PIXEL = 20000;

/** Schild-Daten für ein Pixel (Vorlage einmal vorbereitet, je Pixel nur die Farbwerte) */
function pixelVorlage(t, leuchten) {
  let d = Buffer.from(setzeSchildTexte(Buffer.from(t.data, 'base64'), { Name: '', Other_Text: '' }));
  const z = zerlege(d, true), farbStellen = [];
  for (const p of z.props) {
    if (/^m(Foreground|Background|Auxilary)Color$/.test(p.name) && p.size === 16) farbStellen.push(p.valStart);
    if (p.name === 'mEmissive' && p.size === 4) d.writeFloatLE(leuchten ? 3 : 0, p.valStart);
    if (p.name === 'mPrefabIconElementSaveData') {
      const n = d.readInt32LE(p.valStart); let q = p.valStart + 4;
      for (let k = 0; k < n; k++) { const l = propListe(d, q); const id = l.props.find((x) => x.name === 'IconID'); if (id && id.size === 4) d.writeInt32LE(-1, id.valStart); q = l.noneEnd; }
    }
  }
  if (!farbStellen.length) throw Object.assign(new Error('Schild-Vorlage ohne Farbwerte'), { status: 422 });
  return { d, farbStellen };
}

/**
 * Pixel-Art bauen. bild = { b, h, px: [[r,g,b,a] …] (0–255, zeilenweise von oben) }, groesse: tiny|small|square,
 * lage: wand|boden, leuchten, transparentWeg. lib = Vorlagen-Bibliothek, kat = Katalog. Liefert { datei, info }.
 */
export function bauePixelbild({ lib, kat, bild, groesse = 'tiny', lage = 'wand', leuchten = false, transparentWeg = true }) {
  const [cls, P] = PIXEL_GROESSE[groesse] || PIXEL_GROESSE.tiny;
  const { b, h, px } = bild || {};
  if (!(b > 0 && h > 0) || !Array.isArray(px) || px.length !== b * h) throw Object.assign(new Error('Ungültige Bilddaten'), { status: 400 });
  if (b * h > MAX_PIXEL) throw Object.assign(new Error(`Zu viele Pixel (${b * h}) – höchstens ${MAX_PIXEL}. Bitte eine kleinere Breite wählen.`), { status: 422 });
  const V = String(lib.basis?.saveVersion);
  const t = lib.vorlagen?.[V]?.[cls];
  if (!t || !lib.pfade?.[cls]) throw Object.assign(new Error(`Für „${kat.gebaeude[cls]?.name || cls}“ gibt es keine Vorlage im aktuellen Spielformat – bitte eine Blaupause mit diesem Schild im Spiel speichern.`), { status: 422 });
  const typePath = lib.pfade[cls];
  const { d: muster, farbStellen } = pixelVorlage(t, leuchten);
  const rot = lage === 'boden' ? [Math.SQRT1_2, 0, 0, Math.SQRT1_2] : [0, 0, 1, 0]; // Boden: Fläche nach oben, Wand: Fläche nach −Y
  let nr = 2147480000 - Math.floor(Math.random() * 4e7);
  const objs = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < b; x++) {
    const [r, g, bl, a = 255] = px[y * b + x];
    if (transparentWeg && a < 128) continue;
    const d = Buffer.from(muster);
    for (const s of farbStellen) [r / 255, g / 255, bl / 255, 1].forEach((v, i) => d.writeFloatLE(v, s + i * 4));
    // Wand: Spalten nach −X, Zeilen von oben nach unten (Boden z = 0). Boden: wie die Wand umgelegt – Spalten nach −X, oben im Bild = +Y
    // (lesbar, wenn man nach +Y blickt; im Spiel geprüft 20.10.2026: oben = −Y war gespiegelt)
    const pos = lage === 'boden' ? [-(x - (b - 1) / 2) * P, -(y - (h - 1) / 2) * P, 5] : [-(x - (b - 1) / 2) * P, 0, (h - 1 - y) * P + P / 2];
    const inst = `Persistent_Level:PersistentLevel.${cls}_${nr--}`;
    objs.push({ head: makeHead({ typePath, instance: inst, flags: t.flags, hasFlags: lib.basis.hasFlags, rot, pos, placed: t.placed }), data: Buffer.concat([i32(d.length), d]) });
  }
  if (!objs.length) throw Object.assign(new Error('Keine sichtbaren Pixel (alles transparent?)'), { status: 422 });
  const kosten = {};
  for (const [item, m] of kat.gebaeude[cls]?.kosten || []) kosten[item] = m * objs.length;
  const rp = kat.pfade.rezepte[kat.gebaeude[cls]?.rezept];
  const datei = createBlueprint(lib.basis, objs, { costs: Object.entries(kosten).filter(([it]) => kat.pfade.items[it]).map(([item, amount]) => ({ path: kat.pfade.items[item], amount })), recipes: rp ? [rp] : [], dimensions: [4, 4, 4] });
  readBlueprint(datei); // Selbstprüfung
  return { datei, info: { pixel: objs.length, breite: (b * P) / 100, hoehe: (h * P) / 100, schild: kat.gebaeude[cls]?.name || cls } };
}
