// Produktionsplaner – Optimierer (läuft im Browser und im Server).
//
// Statt Rezept für Rezept aufzulösen (planer-rechner.js) wird die ganze Fabrik als lineares Programm gerechnet:
//   Unbekannte: Maschinen je Rezept (Bruch), Zulieferung je Rohstoff/vorhandenem Item, Überschuss je Item.
//   Je Item:    Herstellung − Verbrauch + Zulieferung − Überschuss = Ziel
//   Damit gehen Kreisläufe (z. B. recycelter Kunststoff/Gummi), mehrere Produkte und Nebenprodukte sauber auf.
// Rechenwege (plan.modus):
//   'optimal' – Ziele erreichen mit möglichst wenig Rohstoffen (knappe Erze zählen mehr, siehe WELT_MAX)
//   'maximum' – so viel wie möglich von den Zielen (im Verhältnis ihrer Mengen) aus den Zulieferungen unter „Vorhanden“
// Rezepte: Standardrezepte + die erlaubten Alternativrezepte (plan.alternativen: Liste von Rezept-IDs oder 'alle').
// Ergebnis in derselben Form wie rechne() – Anzeige und Blaupausen-Bau bleiben gleich.
import { PRODUKTION, istRohstoff, auswerten, rezepteJeItem } from './planer-rechner.js';

// Gewinnbare Menge je Rohstoff auf der ganzen Karte (pro Minute, alle Knoten mit Miner Mk.3 bei 250 %) – nur als
// Gewichtung: wer knapp ist, kostet mehr. Wasser praktisch unbegrenzt.
const WELT_MAX = {
  Desc_OreIron_C: 92100, Desc_Stone_C: 69300, Desc_Coal_C: 42300, Desc_OreCopper_C: 36900, Desc_OreGold_C: 15000,
  Desc_RawQuartz_C: 13500, Desc_LiquidOil_C: 12600, Desc_OreBauxite_C: 12300, Desc_NitrogenGas_C: 12000,
  Desc_Sulfur_C: 10800, Desc_SAM_C: 10200, Desc_OreUranium_C: 2100, Desc_Water_C: 1e7,
};
const gewicht = (item) => 1e4 / (WELT_MAX[item] || 1000);

/**
 * Simplex (zwei Phasen): min c·x, A·x = b, x ≥ 0. Liefert { x, wert } oder { fehler }.
 * Tabellenverfahren mit Schutz gegen Rundungsfehler, die sich über viele Schritte aufschaukeln:
 *  - rechte Seite minimal nach unten verschoben (Überschuss-/Schlupfspalten nehmen das auf) → keine entarteten Ecken
 *  - Austauschzeile: kleinster Quotient, bei Gleichstand der größte Pivot; zu kleine Pivots werden nicht genommen
 *  - alle 30 Schritte wird die Tabelle aus den Ursprungsdaten neu berechnet (Basis bleibt, Gauß mit Spaltenpivot)
 */
export function simplex(A, b, c) {
  const m = A.length, n = c.length, W = n + m + 1, PIV = 1e-7, RK = 1e-7;
  // Ursprungstabelle: [A | Hilfsvariablen | rechte Seite], Zeilen mit negativer rechter Seite umgedreht
  const M0 = A.map((row, i) => { const bi = b[i] - 1e-6 * (1 + (i * 7919) % 97) / 97, s = bi < 0 ? -1 : 1; const r = new Float64Array(W); for (let j = 0; j < n; j++) r[j] = s * row[j]; r[n + i] = 1; r[W - 1] = s * bi; return r; });
  const T = M0.map((r) => Float64Array.from(r));
  let basis = Array.from({ length: m }, (_, i) => n + i);
  const umformen = (zr, sp) => {
    const rz = T[zr], p = rz[sp]; for (let j = 0; j < W; j++) rz[j] /= p;
    for (let i = 0; i < m; i++) { if (i === zr) continue; const ri = T[i], f = ri[sp]; if (f !== 0) { for (let j = 0; j < W; j++) ri[j] -= f * rz[j]; ri[sp] = 0; } }
  };
  const neuBerechnen = () => {
    for (let i = 0; i < m; i++) T[i].set(M0[i]);
    const frei = new Array(m).fill(true), nb = new Array(m).fill(-1);
    for (const sp of basis) {
      let zr = -1, g = 1e-10; for (let i = 0; i < m; i++) if (frei[i] && Math.abs(T[i][sp]) > g) { g = Math.abs(T[i][sp]); zr = i; }
      if (zr < 0) continue;
      frei[zr] = false; nb[zr] = sp; umformen(zr, sp);
    }
    for (let i = 0; i < m; i++) if (nb[i] < 0) { nb[i] = n + i; if (Math.abs(T[i][n + i]) > 1e-10) umformen(i, n + i); }
    basis = nb;
    for (let i = 0; i < m; i++) if (T[i][W - 1] < 0 && T[i][W - 1] > -1e-7) T[i][W - 1] = 0;
  };
  const lauf = (kosten, erlaubt, nullReicht = false) => {
    const cb = new Float64Array(m);
    for (let schritt = 0; schritt < 20000; schritt++) {
      if (schritt && schritt % 30 === 0) neuBerechnen();
      for (let i = 0; i < m; i++) cb[i] = kosten[basis[i]];
      let wert = 0; for (let i = 0; i < m; i++) wert += cb[i] * T[i][W - 1];
      if (nullReicht && wert < 1e-9) return 'ok';
      const inBasis = new Set(basis);
      let sp = -1, min = -RK;
      for (let j = 0; j < erlaubt; j++) {
        if (inBasis.has(j)) continue;
        let r = kosten[j]; for (let i = 0; i < m; i++) { const t = T[i][j]; if (t) r -= cb[i] * t; }
        if (r < min) { min = r; sp = j; }
      }
      if (sp < 0) return 'ok';
      let best = Infinity;
      for (let i = 0; i < m; i++) if (T[i][sp] > PIV) { const q = Math.max(0, T[i][W - 1]) / T[i][sp]; if (q < best) best = q; }
      if (best === Infinity) return 'unbegrenzt';
      let zr = -1, g = 0;
      for (let i = 0; i < m; i++) if (T[i][sp] > PIV && Math.max(0, T[i][W - 1]) / T[i][sp] <= best * (1 + 1e-9) + 1e-12 && T[i][sp] > g) { g = T[i][sp]; zr = i; }
      umformen(zr, sp); basis[zr] = sp;
    }
    return 'abbruch';
  };
  // Phase 1: Hilfsvariablen auf 0 bringen
  const k1 = new Float64Array(n + m); for (let i = 0; i < m; i++) k1[n + i] = 1;
  if (lauf(k1, n + m, true) !== 'ok') return { fehler: 'abbruch' };
  neuBerechnen();
  let summe = 0; for (let i = 0; i < m; i++) if (basis[i] >= n) summe += Math.max(0, T[i][W - 1]);
  if (summe > 1e-3) return { fehler: 'unloesbar' }; // die Verschiebung oben ergibt höchstens ~1e-4
  // Phase 2: eigentliches Ziel; übrig gebliebene Hilfsvariablen (überzählige Zeilen, Wert ~0) dürfen nicht wieder hinein
  const k2 = new Float64Array(n + m); for (let j = 0; j < n; j++) k2[j] = c[j];
  const st = lauf(k2, n); if (st !== 'ok') return { fehler: st };
  neuBerechnen();
  const x = new Float64Array(n); for (let i = 0; i < m; i++) if (basis[i] < n) x[basis[i]] = Math.max(0, T[i][W - 1]);
  let wert = 0; for (let j = 0; j < n; j++) wert += c[j] * x[j];
  return { x, wert };
}

/** Rezepte, die der Optimierer nutzen darf: Standard + erlaubte Alternativen (+ gewählte), ohne Umwandler (Converter) */
export function erlaubteRezepte(kat, plan) {
  const alt = plan.alternativen === 'alle' ? null : new Set(plan.alternativen || []);
  const gewaehlt = new Set(Object.values(plan.wahl || {}));
  const out = [];
  for (const [id, r] of Object.entries(kat.rezepte || {})) {
    const geb = (r.gebaeude || []).find((g) => PRODUKTION.includes(g)); if (!geb) continue;
    if (/Converter/.test(geb) && !gewaehlt.has(id) && !(alt && alt.has(id))) continue;
    if (r.alternativ && alt && !alt.has(id) && !gewaehlt.has(id)) continue;
    out.push(id);
  }
  return out;
}

/** Fabrik optimal rechnen (plan wie bei rechne(), dazu modus und alternativen) */
export function rechneOptimal(kat, plan) {
  const maximum = plan.modus === 'maximum';
  const ziele = (plan.ziele || []).filter((z) => z.item && z.menge > 0);
  const vorhanden = {}; for (const v of plan.vorhanden || []) if (v.item && v.menge > 0) vorhanden[v.item] = (vorhanden[v.item] || 0) + v.menge;
  // zugelieferte (nicht-Roh-)Items werden nicht selbst hergestellt – ein Rest erscheint als „fehlt“ (zusätzlich zuliefern)
  const zugeliefert = new Set(Object.keys(vorhanden).filter((it) => !istRohstoff(kat, it)));
  const rez = erlaubteRezepte(kat, plan).filter((id) => !zugeliefert.has(kat.rezepte[id].produkte[0].item));
  // alle beteiligten Items
  const items = new Set([...ziele.map((z) => z.item), ...Object.keys(vorhanden)]);
  for (const id of rez) { const r = kat.rezepte[id]; for (const p of r.produkte) items.add(p.item); for (const z of r.zutaten) items.add(z.item); }
  const liste = [...items], idx = new Map(liste.map((it, i) => [it, i]));
  const hergestellt = new Set(); for (const id of rez) for (const p of kat.rezepte[id].produkte) hergestellt.add(p.item);
  // Spalten: Rezepte | Zulieferung (Rohstoffe, Vorhandenes, nicht Herstellbares) | Überschuss je Item | [Faktor k]
  const spalten = [], kosten = [];
  for (const id of rez) { spalten.push({ art: 'rezept', id }); kosten.push(0.001 * (1 + (kat.gebaeude[kat.rezepte[id].gebaeude.find((g) => PRODUKTION.includes(g))]?.werte?.strom || 0) / 100)); }
  const zuliefer = [];
  for (const it of liste) {
    const roh = istRohstoff(kat, it), v = vorhanden[it];
    if (v != null) { zuliefer.push({ it, max: v }); spalten.push({ art: 'vorhanden', it }); kosten.push(-0.0001); } // Vorhandenes zuerst nutzen
    if (roh && !maximum) { spalten.push({ art: 'roh', it }); kosten.push(gewicht(it)); }
    if (roh && maximum && it === 'Desc_Water_C' && v == null) { spalten.push({ art: 'roh', it }); kosten.push(gewicht(it)); }
    if (!roh && (!hergestellt.has(it) || zugeliefert.has(it)) && !maximum) { spalten.push({ art: 'fehlt', it }); kosten.push(1e4); } // nicht herstellbar → muss angeliefert werden
  }
  for (const it of liste) { spalten.push({ art: 'rest', it }); kosten.push(1e-6); } // Überschuss fast kostenlos: keine Maschinen nur zum Umwandeln von Resten
  if (maximum) { spalten.push({ art: 'k' }); kosten.push(-1000); }
  const n = spalten.length, zeilenItems = liste.length;
  const A = [], b = [];
  for (let i = 0; i < zeilenItems; i++) { A.push(new Float64Array(n)); b.push(0); }
  spalten.forEach((s, j) => {
    if (s.art === 'rezept') { const r = kat.rezepte[s.id]; for (const p of r.produkte) A[idx.get(p.item)][j] += p.proMin; for (const z of r.zutaten) A[idx.get(z.item)][j] -= z.proMin; }
    else if (s.art === 'rest') A[idx.get(s.it)][j] = -1;
    else if (s.art === 'k') { for (const z of ziele) A[idx.get(z.item)][j] -= z.menge; }
    else A[idx.get(s.it)][j] = 1;
  });
  if (!maximum) for (const z of ziele) b[idx.get(z.item)] += z.menge;
  // Obergrenzen als eigene Zeilen mit Schlupf-Spalte: Vorhandenes (Zulieferung + Schlupf = Menge); im Maximum-Modus
  // zusätzlich der Faktor (≤ 1e6), damit es ohne begrenzende Zulieferung nicht unendlich wird
  const kSp = spalten.findIndex((s) => s.art === 'k');
  const grenzen = zuliefer.map(({ it, max }) => [spalten.findIndex((s) => s.art === 'vorhanden' && s.it === it), max]);
  if (maximum) grenzen.push([kSp, 1e6]);
  const N = n + grenzen.length, A2 = [], b2 = [];
  for (let i = 0; i < zeilenItems; i++) { const r = new Float64Array(N); r.set(A[i]); A2.push(r); b2.push(b[i]); }
  grenzen.forEach(([j, max], k) => { const r = new Float64Array(N); r[j] = 1; r[n + k] = 1; A2.push(r); b2.push(max); });
  const c2 = [...kosten, ...new Array(grenzen.length).fill(0)];
  const erg = simplex(A2, b2, c2);
  const warnungen = [];
  if (erg.fehler) {
    warnungen.push(erg.fehler === 'unloesbar' ? 'Mit diesen Rezepten und Zulieferungen lässt sich das Ziel nicht erreichen.' : `Die Optimierung ist nicht aufgegangen (${erg.fehler}).`);
    return { ...auswerten(kat, plan, {}, plan.wahl || {}, warnungen), optimiert: false };
  }
  const maschinen = {};
  spalten.forEach((s, j) => { if (s.art === 'rezept' && erg.x[j] > 1e-4) maschinen[s.id] = Math.round(erg.x[j] * 1e5) / 1e5; }); // Reste der Verschiebung weg
  // Planziele im Maximum-Modus: erreichte Mengen eintragen
  let planAus = plan, faktor = null;
  if (maximum) {
    faktor = erg.x[kSp];
    if (faktor >= 1e6 - 1) warnungen.push('Unter „Vorhanden“ fehlen begrenzende Zulieferungen – für „Maximum“ bitte die verfügbaren Rohstoffe/Items mit Menge angeben.');
    planAus = { ...plan, ziele: ziele.map((z) => ({ ...z, menge: z.menge * faktor })) };
  }
  // gewählte Rezepte je Item (für die Anzeige der Auswahl)
  const wahl = { ...(plan.wahl || {}) };
  for (const id of Object.keys(maschinen)) { const h = kat.rezepte[id].produkte[0].item; if (!wahl[h]) wahl[h] = id; }
  const ergebnis = auswerten(kat, planAus, maschinen, wahl, warnungen, rezepteJeItem(kat));
  return { ...ergebnis, optimiert: true, faktor, alternativeGenutzt: Object.keys(maschinen).filter((id) => kat.rezepte[id].alternativ) };
}
