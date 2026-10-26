// Plan-Tafel: Ablaufplan einer Fabrik als Blaupause aus 4-m-Beschriftungsschildern (eine Wand zum Aufstellen an der Baustelle).
// Spalten = Fertigungsstufen (Rohstoffe → Stufe 1 … → Ergebnis), je Fertigungsschritt eine „Karte“:
// Kopf (Anzahl × Maschine, Takt), Rezept, Eingänge, Ausgänge pro Minute – je Art eigene Farbe.
// Bauweise wie die Pixel-Art (lib/pixelbild.mjs, im Spiel geprüft): Fläche nach −Y, Spalten nach −X (von vorn gelesen links → rechts).
import { createBlueprint, readBlueprint } from './sbp.mjs';
import { makeHead, i32 } from './vorlagen.mjs';
import { zerlege, propListe, setzeSchildTexte } from './eigenschaften.mjs';

const SCHILD = 'Build_StandaloneWidgetSign_SmallVeryWide_C'; // 4 × 0,5 m, Textfelder „Name“ (Zeile) und „Label“ (kleines Feld)
const BREITE = 400, HOEHE = 50, SPALTE = 420, ZEILE = 56, KARTE_ABSTAND = 34, MAX_ZEILEN = 46, MAX_SPALTEN = 21;
// höchstens 7 Spalten nebeneinander (29,4 m, passt in jeden Blaupausen-Designer ab 32 m); weitere Spalten in einer Reihe darunter
const JE_REIHE = 7, REIHEN_ABSTAND = 120;
// Farben je Zeilenart: [Schrift, Hintergrund] (Werte 0–1, direkt wie bei der Pixel-Art)
const FARBEN = {
  titel: [[0.02, 0.02, 0.025, 1], [0.96, 0.6, 0.12, 1]],
  stufe: [[0.02, 0.02, 0.025, 1], [0.85, 0.85, 0.82, 1]],
  kopf: [[1, 1, 1, 1], [0.33, 0.2, 0.06, 1]],
  rezept: [[0.9, 0.9, 0.9, 1], [0.1, 0.1, 0.12, 1]],
  ein: [[1, 1, 1, 1], [0.04, 0.16, 0.36, 1]],
  aus: [[1, 1, 1, 1], [0.04, 0.3, 0.1, 1]],
  roh: [[1, 1, 1, 1], [0.3, 0.16, 0.05, 1]],
  info: [[1, 1, 1, 1], [0.18, 0.18, 0.2, 1]],
};
const zahl = (v) => (Math.round(v * 100) / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 });

/**
 * Plan aus Fertigungsschritten: schritte = [{ rezept, anzahl, takt (%) }]. Liefert Stufen (Spalten) mit Karten,
 * Rohstoffe (Netto-Bedarf von außen), Ergebnis (Netto-Überschuss) und Strom.
 */
export function planAusSchritten(kat, schritte) {
  const S = [];
  for (const s of schritte || []) {
    const r = kat.rezepte[s.rezept]; if (!r) continue;
    const anzahl = Math.max(1, Math.round(+s.anzahl || 1)), takt = Math.min(250, Math.max(1, +s.takt || 100)), f = anzahl * takt / 100;
    const geb = s.gebaeude || r.gebaeude?.[0];
    S.push({ rezept: s.rezept, name: r.name, geb, anzahl, takt, ein: r.zutaten.map((z) => ({ item: z.item, menge: z.proMin * f })), aus: r.produkte.map((p) => ({ item: p.item, menge: p.proMin * f })) });
  }
  // Stufe je Schritt: 1 + höchste Stufe der Schritte, die seine Eingänge herstellen (Kreisläufe: höchstens n Runden)
  const hersteller = new Map(); S.forEach((s, i) => s.aus.forEach((a) => { if (!hersteller.has(a.item)) hersteller.set(a.item, []); hersteller.get(a.item).push(i); }));
  const stufe = S.map(() => 1);
  for (let runde = 0; runde < S.length; runde++) {
    let geaendert = false;
    S.forEach((s, i) => { const m = 1 + Math.max(0, ...s.ein.flatMap((e) => (hersteller.get(e.item) || []).filter((j) => j !== i).map((j) => stufe[j]))); if (m > stufe[i] && m <= S.length) { stufe[i] = m; geaendert = true; } });
    if (!geaendert) break;
  }
  const bilanz = {}; for (const s of S) { for (const e of s.ein) bilanz[e.item] = (bilanz[e.item] || 0) - e.menge; for (const a of s.aus) bilanz[a.item] = (bilanz[a.item] || 0) + a.menge; }
  const roh = Object.entries(bilanz).filter(([, v]) => v < -1e-6).map(([item, v]) => ({ item, menge: -v })).sort((a, b) => b.menge - a.menge);
  const ergebnis = Object.entries(bilanz).filter(([, v]) => v > 1e-6).map(([item, v]) => ({ item, menge: v })).sort((a, b) => b.menge - a.menge);
  const strom = S.reduce((a, s) => a + (kat.gebaeude[s.geb]?.werte?.strom || 0) * s.anzahl * Math.pow(s.takt / 100, 1.321928), 0);
  const stufen = []; S.forEach((s, i) => { (stufen[stufe[i] - 1] ||= []).push(s); });
  return { stufen: stufen.filter(Boolean), roh, ergebnis, strom, maschinen: S.reduce((a, s) => a + s.anzahl, 0) };
}

/**
 * Bildfelder setzen: bilder = { Icon: Nr, Other_Icon: Nr } (−1 = kein Bild). Nummern aus der Symbol-Bibliothek des Spiels
 * (IconLibrary.mIconData: ID → Item/Gebäude, ausgelesen mit werkzeuge/gelaende --json). Ab Spiel 1.1 steht die Nummer zusätzlich
 * in mGlobalPrefabIconElementSaveData (Struktur Bibliothek + IconID, die Zahl als letzter Wert vor dem abschließenden „None“).
 */
export function setzeBilder(d, bilder) {
  for (const p of zerlege(d, true).props) {
    if (p.name !== 'mPrefabIconElementSaveData' && p.name !== 'mGlobalPrefabIconElementSaveData') continue;
    const n = d.readInt32LE(p.valStart); let q = p.valStart + 4;
    for (let k = 0; k < n; k++) {
      const l = propListe(d, q), en = l.props.find((x) => x.name === 'ElementName'), id = l.props.find((x) => x.name === 'IconID');
      const name = en ? d.toString('latin1', en.valStart + 4, en.valStart + 3 + d.readInt32LE(en.valStart)) : '';
      if (id && name in bilder) { const nr = bilder[name] ?? -1; if (id.size === 4) d.writeInt32LE(nr, id.valStart); else if (id.size > 13) d.writeInt32LE(nr, id.end - 13); }
      q = l.noneEnd;
    }
  }
  return d;
}
/** Schild-Vorlage vorbereiten: Symbole aus, Stellen für Farben merken */
function schildVorlage(t) {
  const d = Buffer.from(t.data, 'base64'), z = zerlege(d, true), farbe = {};
  for (const p of z.props) {
    if (p.size === 16 && /^m(Foreground|Background|Auxilary)Color$/.test(p.name)) farbe[p.name] = true;
    if (p.name === 'mPrefabIconElementSaveData') { const n = d.readInt32LE(p.valStart); let q = p.valStart + 4; for (let k = 0; k < n; k++) { const l = propListe(d, q); const id = l.props.find((x) => x.name === 'IconID'); if (id && id.size === 4) d.writeInt32LE(-1, id.valStart); q = l.noneEnd; } }
  }
  if (!farbe.mForegroundColor || !farbe.mBackgroundColor) throw Object.assign(new Error('Schild-Vorlage ohne Farbwerte'), { status: 422 });
  return d;
}
/** Daten eines Schilds: Text, kleines Feld, Farben je Art */
function schildDaten(muster, text, label, art, bild = -1) {
  const d = setzeBilder(setzeSchildTexte(muster, { Name: text, Label: label }), { Icon: bild, Other_Icon: -1 });
  const [vorne, hinten] = FARBEN[art] || FARBEN.info;
  for (const p of zerlege(d, true).props) {
    if (p.size !== 16) continue;
    const f = p.name === 'mForegroundColor' ? vorne : p.name === 'mBackgroundColor' || p.name === 'mAuxilaryColor' ? hinten : null;
    if (f) f.forEach((v, i) => d.writeFloatLE(v, p.valStart + i * 4));
  }
  return d;
}

/**
 * Plan-Tafel bauen. titel: Überschrift, plan: Ergebnis von planAusSchritten. Liefert { datei, info }.
 */
export function bauePlantafel({ lib, kat, titel, plan, symbole = {} }) {
  const V = String(lib.basis?.saveVersion), t = lib.vorlagen?.[V]?.[SCHILD];
  if (!t || !lib.pfade?.[SCHILD]) throw Object.assign(new Error(`Für „${kat.gebaeude[SCHILD]?.name || SCHILD}“ gibt es keine Vorlage im aktuellen Spielformat – bitte eine Blaupause mit diesem Schild im Spiel speichern.`), { status: 422 });
  if (!plan?.stufen?.length) throw Object.assign(new Error('Der Plan hat keine Fertigungsschritte.'), { status: 400 });
  const muster = schildVorlage(t), nm = (it) => kat.items[it]?.name || it;
  // Bild je Item bzw. Gebäude (Build_X_C ↔ Desc_X_C); ohne Zuordnung kein Bild
  const bildItem = (it) => symbole[it] ?? -1, bildGeb = (g) => symbole[String(g || '').replace(/^Build_/, 'Desc_')] ?? -1;
  const fl = (it) => /Flüssig|Gas/.test(kat.items[it]?.form || '');
  const menge = (x) => `${zahl(x.menge)}${fl(x.item) ? ' m³' : ''} ${nm(x.item)}`;
  // Spalten als Zeilenlisten: [{ text, label, art }] bzw. Abstand { luecke: true }
  const spalten = [];
  const neueSpalte = (kopf) => { const s = [{ text: kopf, label: '', art: 'stufe' }]; spalten.push(s); return s; };
  let roh = neueSpalte('ROHSTOFFE (pro Minute)');
  for (const r of plan.roh) roh.push({ text: menge(r), label: '', art: 'roh', bild: bildItem(r.item) });
  let nr = 0;
  plan.stufen.forEach((schritte, si) => {
    let sp = neueSpalte(`STUFE ${si + 1}`);
    for (const s of schritte) {
      const karte = [{ text: `${s.anzahl}× ${kat.gebaeude[s.geb]?.name || s.geb}${s.takt !== 100 ? ` · ${zahl(s.takt)} %` : ''}`, label: String(++nr), art: 'kopf', bild: bildGeb(s.geb) }, { text: s.name, label: '', art: 'rezept', bild: bildItem(s.aus[0]?.item) },
        ...s.ein.map((e) => ({ text: `rein ${menge(e)}`, label: '', art: 'ein', bild: bildItem(e.item) })), ...s.aus.map((a) => ({ text: `raus ${menge(a)}`, label: '', art: 'aus', bild: bildItem(a.item) }))];
      if (sp.length > 1 && sp.length + karte.length + 1 > MAX_ZEILEN) sp = neueSpalte(`STUFE ${si + 1} (Forts.)`);
      if (sp.length > 1) sp.push({ luecke: true });
      sp.push(...karte);
    }
  });
  const erg = neueSpalte('ERGEBNIS (pro Minute)');
  for (const e of plan.ergebnis) erg.push({ text: menge(e), label: '', art: 'aus', bild: bildItem(e.item) });
  erg.push({ luecke: true }, { text: `${plan.maschinen} Maschinen`, label: '', art: 'info' }, { text: `Strom ca. ${zahl(Math.round(plan.strom))} MW`, label: '', art: 'info' });
  if (spalten.length > MAX_SPALTEN) throw Object.assign(new Error(`Der Plan braucht ${spalten.length} Spalten – höchstens ${MAX_SPALTEN} passen auf eine Tafel.`), { status: 422 });
  // Höhe: längste Spalte + Titelzeile; Titel über den ersten beiden Spalten
  const hoeheZ = (sp) => sp.reduce((h, z) => h + (z.luecke ? KARTE_ABSTAND : ZEILE), 0);
  const reihen = Math.ceil(spalten.length / JE_REIHE), HR = Math.max(...spalten.map(hoeheZ)) + REIHEN_ABSTAND; // Höhe je Reihe
  const H = reihen * HR - REIHEN_ABSTAND + ZEILE * 1.5;
  const typePath = lib.pfade[SCHILD], rot = [0, 0, 1, 0];
  let inst = 2147480000 - Math.floor(Math.random() * 4e7);
  const proReihe = Math.min(JE_REIHE, spalten.length), objs = [], x0 = ((proReihe - 1) * SPALTE) / 2;
  const setze = (sx, z, text, label, art, bild) => {
    const d = schildDaten(muster, text, label, art, bild);
    objs.push({ head: makeHead({ typePath, instance: `Persistent_Level:PersistentLevel.${SCHILD}_${inst--}`, flags: t.flags, hasFlags: lib.basis.hasFlags, rot, pos: [x0 - sx * SPALTE, 0, z], placed: t.placed }), data: Buffer.concat([i32(d.length), d]) });
  };
  setze(0, H - HOEHE / 2, 'ABLAUFPLAN', '', 'titel');
  if (spalten.length > 1) setze(1, H - HOEHE / 2, String(titel || '').slice(0, 60), '', 'titel');
  spalten.forEach((sp, i) => {
    const sx = i % JE_REIHE; let z = H - ZEILE * 1.5 - HOEHE / 2 - Math.floor(i / JE_REIHE) * HR;
    for (const zl of sp) { if (zl.luecke) { z -= KARTE_ABSTAND; continue; } setze(sx, z, zl.text, zl.label, zl.art, zl.bild); z -= ZEILE; }
  });
  const kosten = {}; for (const [item, m] of kat.gebaeude[SCHILD]?.kosten || []) kosten[item] = m * objs.length;
  const rp = kat.pfade.rezepte[kat.gebaeude[SCHILD]?.rezept];
  const breite = proReihe * SPALTE;
  const datei = createBlueprint(lib.basis, objs, { costs: Object.entries(kosten).filter(([it]) => kat.pfade.items[it]).map(([item, amount]) => ({ path: kat.pfade.items[item], amount })), recipes: rp ? [rp] : [], dimensions: [Math.max(1, Math.ceil(breite / 800)), 1, Math.max(1, Math.ceil(H / 800))] });
  readBlueprint(datei); // Selbstprüfung
  return { datei, info: { schilder: objs.length, spalten: spalten.length, breite: breite / 100, hoehe: Math.round(H) / 100, schritte: nr } };
}
