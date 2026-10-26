// Sonderzeichen-Schilder: Schilder mit frei gewählten Zeichen (Zeichenliste lib/symbol-db, Unicode-Zeichen der Spielschrift)
// als Blaupause – je Eintrag ein Schild, als Raster angeordnet (Wand wie die Pixel-Art: Fläche nach −Y, Spalten nach −X).
import { createBlueprint, readBlueprint } from './sbp.mjs';
import { makeHead, i32 } from './vorlagen.mjs';
import { zerlege, setzeSchildTexte } from './eigenschaften.mjs';
import { i32 as i32b } from './vorlagen.mjs';
import { setzeBilder } from './plantafel.mjs';

// Schildarten: Klasse, Breite, Höhe (cm), Textfeld für das Zeichen, Layout. Layouts nach Probe im Spiel (26.10.2026):
// 4x1_1 zeigt nur Text (ohne Bildfeld; 4x1_2 … 4x1_6 haben ein Bildfeld, leer = weißes Quadrat); 1x1_3 zeigt „Other_Text“ groß
// (wie die Ziffern der Vorlage „Alternate Prod Sign“), 1x1_0/1x1_1 haben ein Bildfeld, 1x1_2 zeigt „Name“ nur klein.
export const SYMBOL_SCHILDER = {
  breit: ['Build_StandaloneWidgetSign_SmallVeryWide_C', 400, 50, 'Name', 'BPW_Sign4x1_1', { Name: '', Label: '' }],
  mittel: ['Build_StandaloneWidgetSign_Small_C', 200, 50, 'Name', 'BPW_Sign4x1_1', { Name: '', Label: '' }],
  quadrat: ['Build_StandaloneWidgetSign_Square_Small_C', 100, 100, 'Other_Text', 'BPW_Sign1x1_3', { Name: '', Other_Text: '' }],
  klein: ['Build_StandaloneWidgetSign_Square_Tiny_C', 50, 50, 'Other_Text', 'BPW_Sign1x1_3', { Name: '', Other_Text: '' }],
};
// Werte der Schild-Vorlage, die das Aussehen verfälschen (gemessen 26.10.2026: Vorlage mit Leuchten 3, Glanz 1 und Lack „Chrom“
// zeigt schwarzen Hintergrund im Spiel hell-lila) – ohne sie gelten die Standardwerte des Spiels
const WEG = new Set(['mEmissive', 'mGlossiness', 'mColorSlot', 'mCustomizationData', 'mLastEditedBy', 'BuiltBy']);
const fstr = (t) => (t === '' ? i32b(0) : Buffer.concat([i32b(t.length + 1), Buffer.from(t + '\0', 'latin1')]));
/** Eigenschaften entfernen und optional das Layout (BPW_Sign…) ersetzen */
export function schildBereinigen(d, layout = null) {
  const z = zerlege(d, true), teile = []; let p0 = 0;
  for (const p of z.props) {
    if (WEG.has(p.name)) { teile.push(d.subarray(p0, p.start)); p0 = p.end; continue; }
    if (layout && p.name === 'mSoftActivePrefabLayout') {
      const wert = Buffer.concat([fstr('/Game/FactoryGame/Interface/UI/InGame/Signs/SignLayouts/' + layout), fstr(layout + '_C'), fstr('')]);
      const kopf = Buffer.from(d.subarray(p.start, p.valStart)); kopf.writeInt32LE(wert.length, p.sizePos - p.start);
      teile.push(d.subarray(p0, p.start), kopf, wert); p0 = p.end;
    }
  }
  teile.push(d.subarray(p0));
  return Buffer.concat(teile);
}
export const LAYOUTS = { breit: ['BPW_Sign4x1_0', 'BPW_Sign4x1_1', 'BPW_Sign4x1_2', 'BPW_Sign4x1_3', 'BPW_Sign4x1_4', 'BPW_Sign4x1_5', 'BPW_Sign4x1_6'], quadrat: ['BPW_Sign1x1_0', 'BPW_Sign1x1_1', 'BPW_Sign1x1_2', 'BPW_Sign1x1_3'] };
const farbe = (v, d) => (Array.isArray(v) && v.length >= 3 && v.every((x) => Number.isFinite(+x)) ? [+v[0], +v[1], +v[2], 1].map((x) => Math.min(1, Math.max(0, x))) : d);

/** texte: [string] (je Eintrag ein Schild, Zeilenumbrüche erlaubt), schild: breit|mittel|quadrat|klein, spalten, vorne/hinten [r,g,b] 0–1 */
export function baueSymbolschilder({ lib, kat, texte, schild = 'breit', spalten = 1, vorne, hinten, layout = null, layouts = null }) {
  const [cls, B, H, feld, standardLayout, felder] = SYMBOL_SCHILDER[schild] || SYMBOL_SCHILDER.breit;
  const liste = (Array.isArray(texte) ? texte : []).map((t) => String(t ?? '').slice(0, 400)).filter((t) => t.length).slice(0, 400);
  if (!liste.length) throw Object.assign(new Error('Keine Zeichen gewählt.'), { status: 400 });
  const V = String(lib.basis?.saveVersion), t = lib.vorlagen?.[V]?.[cls];
  if (!t || !lib.pfade?.[cls]) throw Object.assign(new Error(`Für „${kat.gebaeude[cls]?.name || cls}“ gibt es keine Vorlage im aktuellen Spielformat – bitte eine Blaupause mit diesem Schild im Spiel speichern.`), { status: 422 });
  const fV = farbe(vorne, [1, 1, 1, 1]), fH = farbe(hinten, [0.02, 0.02, 0.025, 1]);
  const muster = Buffer.from(t.data, 'base64'), sp = Math.max(1, Math.min(40, Math.round(+spalten || 1))), zeilen = Math.ceil(liste.length / sp);
  const abstandX = B + 10, abstandZ = H + 10, typePath = lib.pfade[cls];
  let inst = 2147480000 - Math.floor(Math.random() * 4e7);
  const objs = liste.map((text, i) => {
    const texteNeu = { ...felder, [feld]: text };
    const lay = (layouts && layouts[i]) || (typeof layout === 'string' && /^BPW_Sign\d+x\d+_\d+$/.test(layout) ? layout : standardLayout);
    const d = setzeBilder(schildBereinigen(setzeSchildTexte(muster, texteNeu), lay), { Icon: -1, Other_Icon: -1, Background: -1 });
    for (const p of zerlege(d, true).props) {
      if (p.size !== 16) continue;
      const f = p.name === 'mForegroundColor' ? fV : p.name === 'mBackgroundColor' || p.name === 'mAuxilaryColor' ? fH : null;
      if (f) f.forEach((v, k) => d.writeFloatLE(v, p.valStart + k * 4));
    }
    const x = i % sp, y = Math.floor(i / sp);
    const pos = [-(x - (sp - 1) / 2) * abstandX, 0, (zeilen - 1 - y) * abstandZ + H / 2];
    return { head: makeHead({ typePath, instance: `Persistent_Level:PersistentLevel.${cls}_${inst--}`, flags: t.flags, hasFlags: lib.basis.hasFlags, rot: [0, 0, 1, 0], pos, placed: t.placed }), data: Buffer.concat([i32(d.length), d]) };
  });
  const kosten = {}; for (const [item, m] of kat.gebaeude[cls]?.kosten || []) kosten[item] = m * objs.length;
  const rp = kat.pfade.rezepte[kat.gebaeude[cls]?.rezept];
  const datei = createBlueprint(lib.basis, objs, { costs: Object.entries(kosten).filter(([it]) => kat.pfade.items[it]).map(([item, amount]) => ({ path: kat.pfade.items[item], amount })), recipes: rp ? [rp] : [], dimensions: [Math.max(1, Math.ceil(sp * abstandX / 800)), 1, Math.max(1, Math.ceil(zeilen * abstandZ / 800))] });
  readBlueprint(datei); // Selbstprüfung
  return { datei, info: { schilder: objs.length, breite: Math.round(sp * abstandX) / 100, hoehe: Math.round(zeilen * abstandZ) / 100, schild: kat.gebaeude[cls]?.name || cls } };
}
