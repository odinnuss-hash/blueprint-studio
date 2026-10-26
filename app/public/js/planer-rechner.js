// Produktionsplaner – Rechenkern (ohne Oberfläche, läuft im Browser und im Server).
//
// Eingabe: Ziele (Item + Menge/min), Rezeptwahl je Item, vorhandene Zulieferungen (Item + Menge/min).
// Verfahren: Bedarf schrittweise auflösen – solange ein Item fehlt, werden Maschinen seines gewählten Rezepts
// ergänzt. Nebenprodukte zählen als Angebot (z. B. Schweres Ölrückstand), deshalb wird bis zum Gleichgewicht
// wiederholt. Rohstoffe (Kategorie „Ressource“) werden nicht hergestellt, sondern als Zulieferung ausgewiesen.

export const PRODUKTION = ['Build_SmelterMk1_C', 'Build_ConstructorMk1_C', 'Build_AssemblerMk1_C', 'Build_FoundryMk1_C', 'Build_ManufacturerMk1_C',
  'Build_OilRefinery_C', 'Build_Blender_C', 'Build_Packager_C', 'Build_HadronCollider_C', 'Build_QuantumEncoder_C', 'Build_Converter_C'];
const EPS = 1e-7;

/** Alle Rezepte, die in Fertigungsgebäuden laufen, nach Produkt gruppiert */
export function rezepteJeItem(kat) {
  const out = {};
  for (const [id, r] of Object.entries(kat.rezepte || {})) {
    const geb = (r.gebaeude || []).find((g) => PRODUKTION.includes(g));
    if (!geb) continue;
    for (const p of r.produkte || []) (out[p.item] ||= []).push(id);
  }
  return out;
}

export const istRohstoff = (kat, item) => kat.items[item]?.kategorie === 'Ressource';
// Entpacken: Umfüllanlage macht aus einem abgefüllten Item wieder Flüssigkeit + leeren Behälter
const entpacken = (r) => /Packager/.test(r.gebaeude?.[0] || '') && r.produkte.some((p) => /FluidCanister|GasTank/.test(p.item)) && !r.zutaten.some((z) => /FluidCanister|GasTank/.test(z.item));

/** Standard-Rezept für ein Item (kein Alternativrezept, kein Entpacken, kein Kreislauf) */
export function standardRezept(kat, item, liste) {
  const ids = (liste || rezepteJeItem(kat))[item] || [];
  const name = kat.items[item]?.name;
  const wertung = (id) => {
    const r = kat.rezepte[id];
    let w = 0;
    if (r.alternativ) w += 100;
    if (entpacken(r)) w += 1000; // Entpacken nur, wenn es sonst nichts gibt (sonst Kreislauf Abfüllen ↔ Entpacken)
    if (/Converter/.test(r.gebaeude[0])) w += 80;
    if (r.zutaten.some((z) => z.item === item)) w += 200;
    if (r.produkte[0].item !== item) w += 20; // nur Nebenprodukt
    if (r.name === name) w -= 5;
    w += r.zutaten.length;
    return w;
  };
  const sortiert = [...ids].sort((a, b) => wertung(a) - wertung(b));
  // Kreisläufe vermeiden: ein Rezept, dessen Zutaten (über die jeweils besten Rezepte) wieder dieses Item brauchen, nur als letzte Wahl
  const kreis = (id) => {
    const gesehen = new Set([item]);
    const offen = kat.rezepte[id].zutaten.map((z) => z.item);
    let tiefe = 0;
    while (offen.length && tiefe++ < 400) {
      const it = offen.pop();
      if (it === item) return true;
      if (gesehen.has(it) || kat.items[it]?.kategorie === 'Ressource') continue;
      gesehen.add(it);
      const kand = (liste || rezepteJeItem(kat))[it] || [];
      const best = [...kand].sort((a, b) => (kat.rezepte[a].alternativ - kat.rezepte[b].alternativ) || (entpacken(kat.rezepte[a]) - entpacken(kat.rezepte[b])))[0];
      if (best) offen.push(...kat.rezepte[best].zutaten.map((z) => z.item));
    }
    return false;
  };
  return sortiert.find((id) => !kreis(id)) || sortiert[0] || null;
}

/**
 * plan = { ziele: [{ item, menge }], wahl: { item: rezeptId }, vorhanden: [{ item, menge }] }
 * Ergebnis: { schritte, rohstoffe, vorhanden, ueberschuss, kanten, ziele, warnungen }
 */
export function rechne(kat, plan) {
  const liste = rezepteJeItem(kat);
  const wahl = { ...(plan.wahl || {}) };
  const maschinen = {}; // rezeptId -> Anzahl (Bruch)
  const ziele = (plan.ziele || []).filter((z) => z.item && z.menge > 0);
  const vorhanden = {};
  for (const v of plan.vorhanden || []) if (v.item && v.menge > 0) vorhanden[v.item] = (vorhanden[v.item] || 0) + v.menge;
  const warnungen = [];

  const bilanz = () => {
    const b = {};
    for (const [it, m] of Object.entries(vorhanden)) b[it] = (b[it] || 0) + m;
    for (const z of ziele) b[z.item] = (b[z.item] || 0) - z.menge;
    for (const [id, n] of Object.entries(maschinen)) {
      const r = kat.rezepte[id];
      for (const p of r.produkte) b[p.item] = (b[p.item] || 0) + p.proMin * n;
      for (const z of r.zutaten) b[z.item] = (b[z.item] || 0) - z.proMin * n;
    }
    return b;
  };

  let runden = 0;
  for (; runden < 2000; runden++) {
    const b = bilanz();
    // fehlendes, herstellbares Item mit dem größten Mangel
    let ziel = null, mangel = 0;
    for (const [it, v] of Object.entries(b)) {
      if (v >= -EPS || istRohstoff(kat, it)) continue;
      if (vorhanden[it] != null) continue; // zugeliefert: nicht selbst herstellen – ein Rest erscheint als „fehlt“ (zusätzlich zuliefern)
      if (!wahl[it]) wahl[it] = standardRezept(kat, it, liste);
      if (!wahl[it]) continue; // nicht herstellbar -> Zulieferung
      if (-v > mangel) { mangel = -v; ziel = it; }
    }
    if (!ziel || mangel < 1e-6) break;
    const id = wahl[ziel], r = kat.rezepte[id];
    const p = r.produkte.find((x) => x.item === ziel);
    maschinen[id] = (maschinen[id] || 0) + mangel / p.proMin;
    if (!Number.isFinite(maschinen[id]) || maschinen[id] > 1e6) { runden = 2000; break; }
  }
  if (runden >= 2000) warnungen.push('Die Rechnung ist nicht ganz aufgegangen (Kreislauf in den Rezepten) – Werte sind Näherungen.');
  return auswerten(kat, plan, maschinen, wahl, warnungen, liste);
}

/** Aus Maschinenzahlen je Rezept (Bruch) das Ergebnis bilden: Schritte, Rohstoffe, Überschuss, Kanten, Strom (auch für planer-optimierer.js) */
export function auswerten(kat, plan, maschinen, wahl, warnungen = [], liste = rezepteJeItem(kat)) {
  const ziele = (plan.ziele || []).filter((z) => z.item && z.menge > 0);
  const vorhanden = {};
  for (const v of plan.vorhanden || []) if (v.item && v.menge > 0) vorhanden[v.item] = (vorhanden[v.item] || 0) + v.menge;
  const bilanz = () => {
    const b = {};
    for (const [it, m] of Object.entries(vorhanden)) b[it] = (b[it] || 0) + m;
    for (const z of ziele) b[z.item] = (b[z.item] || 0) - z.menge;
    for (const [id, n] of Object.entries(maschinen)) {
      const r = kat.rezepte[id];
      for (const p of r.produkte) b[p.item] = (b[p.item] || 0) + p.proMin * n;
      for (const z of r.zutaten) b[z.item] = (b[z.item] || 0) - z.proMin * n;
    }
    return b;
  };
  const b = bilanz();
  const rohstoffe = {}, ueberschuss = {}, fehlt = {};
  for (const [it, v] of Object.entries(b)) {
    if (v < -1e-3) { if (istRohstoff(kat, it)) rohstoffe[it] = -v; else fehlt[it] = -v; }
    else if (v > 1e-3) ueberschuss[it] = v;
  }
  // vorhandene Zulieferungen, die nicht (ganz) gebraucht werden, sind kein „Überschuss“ der Fabrik
  for (const [it, m] of Object.entries(vorhanden)) if (ueberschuss[it]) { ueberschuss[it] = Math.max(0, ueberschuss[it] - m); if (ueberschuss[it] < 1e-6) delete ueberschuss[it]; }

  // Schritte in Fertigungsreihenfolge (Tiefe ab den Zielen)
  const ids = Object.keys(maschinen).filter((id) => maschinen[id] > 1e-9);
  const tiefe = {};
  const herstellerVon = (it) => ids.filter((id) => kat.rezepte[id].produkte.some((p) => p.item === it));
  const besuche = (id, t, pfad = new Set()) => {
    if (pfad.has(id)) return;
    if ((tiefe[id] ?? -1) >= t) return;
    tiefe[id] = t;
    pfad.add(id);
    for (const z of kat.rezepte[id].zutaten) for (const h of herstellerVon(z.item)) besuche(h, t + 1, pfad);
    pfad.delete(id);
  };
  for (const z of ziele) for (const h of herstellerVon(z.item)) besuche(h, 0);
  for (const id of ids) if (tiefe[id] === undefined) tiefe[id] = 0;
  const maxT = Math.max(0, ...Object.values(tiefe));
  const schritte = ids.map((id) => {
    const r = kat.rezepte[id], n = maschinen[id];
    // Übertakten (plan.takt 100–250 %): weniger Maschinen, je angefangene 50 % über 100 % eine Power-Shard pro Maschine
    const ziel = Math.min(250, Math.max(100, +plan.takt || 100)) / 100;
    const anzahl = Math.max(1, Math.ceil(n / ziel - 1e-6)), takt = (n / anzahl) * 100;
    return {
      rezept: id, name: r.name, gebaeude: r.gebaeude.find((g) => PRODUKTION.includes(g)), alternativ: !!r.alternativ,
      maschinen: n, anzahl, takt, shards: takt > 100.001 ? anzahl * Math.ceil((takt - 100) / 50 - 1e-9) : 0, ebene: maxT - tiefe[id],
      zutaten: r.zutaten.map((z) => ({ item: z.item, proMin: z.proMin * n })),
      produkte: r.produkte.map((p) => ({ item: p.item, proMin: p.proMin * n })),
      optionen: (liste[r.produkte[0].item] || []).length,
    };
  }).sort((a, b) => a.ebene - b.ebene || a.name.localeCompare(b.name));

  // Kanten: Mengen anteilig vom Hersteller zum Verbraucher verteilen
  const quellen = {}, senken = {};
  const add = (map, it, knoten, m) => { if (m > 1e-9) (map[it] ||= []).push({ knoten, m }); };
  for (const [it, m] of Object.entries(vorhanden)) add(quellen, it, `vorhanden:${it}`, m);
  for (const [it, m] of Object.entries(rohstoffe)) add(quellen, it, `roh:${it}`, m);
  for (const [it, m] of Object.entries(fehlt)) add(quellen, it, `roh:${it}`, m);
  schritte.forEach((s, i) => { for (const p of s.produkte) add(quellen, p.item, i, p.proMin); for (const z of s.zutaten) add(senken, z.item, i, z.proMin); });
  for (const z of ziele) add(senken, z.item, `ziel:${z.item}`, z.menge);
  for (const [it, m] of Object.entries(ueberschuss)) add(senken, it, `rest:${it}`, m);
  const kanten = [];
  for (const [it, qs] of Object.entries(quellen)) {
    const ss = senken[it] || [];
    const summeQ = qs.reduce((a, q) => a + q.m, 0);
    if (summeQ <= 0) continue;
    for (const q of qs) for (const s of ss) {
      const m = (q.m / summeQ) * s.m;
      if (m > 1e-6) kanten.push({ von: q.knoten, nach: s.knoten, item: it, menge: m });
    }
  }
  const strom = schritte.reduce((a, s) => a + (kat.gebaeude[s.gebaeude]?.werte?.strom || 0) * s.anzahl * Math.pow(s.takt / 100, 1.321928), 0);
  const shards = schritte.reduce((a, s) => a + s.shards, 0);
  return { schritte, rohstoffe, fehlt, vorhanden, ueberschuss, kanten, ziele, wahl, strom, shards, warnungen };
}

/** Rezepte, aus denen der Nutzer für ein Item wählen kann */
export function rezeptOptionen(kat, item) {
  return (rezepteJeItem(kat)[item] || []).map((id) => ({ id, ...kat.rezepte[id] }))
    .sort((a, b) => (a.alternativ - b.alternativ) || a.name.localeCompare(b.name));
}

/** Stufe i und alle Stufen, die ihr (direkt oder indirekt) zuliefern – für „Teilfabrik bis …“ */
export function vorstufen(ergebnis, i) {
  const set = new Set([i]), offen = [i];
  while (offen.length) {
    const n = offen.pop();
    for (const k of ergebnis.kanten) if (k.nach === n && typeof k.von === 'number' && !set.has(k.von)) { set.add(k.von); offen.push(k.von); }
  }
  return set;
}
