// Welche Freischaltung ein Plan braucht: höchste Meilenstein-Stufe (Rezepte und Gebäude) plus Alternativrezepte, M.A.M. usw.
// Grundlage: Katalog (freischaltungen = Schematics mit typ, stufe, rezepte). Gleiche Regel wie im Baukasten (lib/baukasten.mjs).
const RANG = { Start: 0, 'HUB-Upgrade': 1, Meilenstein: 2, 'M.A.M.-Forschung': 3, Festplatte: 4, 'AWESOME-Shop': 5 };
const MEILENSTEIN = new Set(['Start', 'HUB-Upgrade', 'Meilenstein']);
const cache = new WeakMap();
function karte(kat) {
  if (cache.has(kat)) return cache.get(kat);
  const frei = {};
  for (const sc of kat.freischaltungen || []) {
    if (!(sc.typ in RANG)) continue;
    for (const r of sc.rezepte || []) { const alt = frei[r]; if (!alt || RANG[sc.typ] < RANG[alt.typ] || (RANG[sc.typ] === RANG[alt.typ] && (sc.stufe ?? 0) < (alt.stufe ?? 0))) frei[r] = { typ: sc.typ, stufe: sc.stufe ?? 0, name: sc.name }; }
  }
  cache.set(kat, frei); return frei;
}
/** schritte: [{ rezept, gebaeude }] → { stufe: { stufe, name } | null, extra: [{ typ, name }] } */
export function benoetigt(kat, schritte) {
  const frei = karte(kat), gefunden = new Map();
  const dazu = (f) => { if (f) gefunden.set(f.typ + '|' + f.name, f); };
  for (const s of schritte) { dazu(frei[s.rezept]); const g = kat.gebaeude?.[s.gebaeude]; if (g?.rezept) dazu(frei[g.rezept]); }
  const l = [...gefunden.values()], ms = l.filter((f) => MEILENSTEIN.has(f.typ));
  const top = ms.reduce((a, b) => (!a || b.stufe > a.stufe ? b : a), null);
  return {
    stufe: top ? { stufe: top.stufe, name: top.typ === 'Meilenstein' ? top.name : '' } : null,
    extra: l.filter((f) => !MEILENSTEIN.has(f.typ)).map((f) => ({ typ: f.typ === 'Festplatte' ? 'Alternativrezept (Festplatte)' : f.typ, name: f.name.replace(/^Alternativ:\s*/, '') })).sort((a, b) => a.typ.localeCompare(b.typ) || a.name.localeCompare(b.name, 'de')),
  };
}
/** Kurzer Text: „Stufe 6 (Industrielle Fertigung); Eisendraht, …“ */
export function benoetigtText(b) {
  if (!b.stufe && !b.extra.length) return '';
  return `${b.stufe ? `Stufe ${b.stufe.stufe}${b.stufe.name ? ` (${b.stufe.name})` : ''}` : ''}${b.extra.length ? `${b.stufe ? '; ' : ''}${b.extra.slice(0, 6).map((x) => x.name).join(', ')}${b.extra.length > 6 ? ' …' : ''}` : ''}`;
}
