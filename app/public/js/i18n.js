// Mehrsprachigkeit: Deutsch ist die Ausgangssprache im Quelltext. Für en/fr/ja übersetzt dieses Modul alle
// sichtbaren Texte der Oberfläche (auch später eingefügte) anhand von i18n/<sprache>.json:
//   - exakte Treffer ("Speichern" -> "Save")
//   - Muster mit Platzhaltern ("„{0}“ löschen?" -> "Delete “{0}”?")
// Nutzerdaten (Blaupausen-Namen, Ordner, Pfade) werden nicht angefasst.
export const SPRACHEN = { de: 'Deutsch', en: 'English', fr: 'Français', ja: '日本語' };
let sprache = 'de';
let woerter = null;
let muster = [];
const cache = new Map();
const SCHUTZ = 'script,style,code,pre,textarea,[data-no-i18n],#bp-list .n,#ab-tree .ab-name,#ab-files .n,#pathtext,#session,#nv-alt,#nv-ergebnis,.k-name,.insp-name,#k-bp-name';
const ATTR = ['title', 'placeholder', 'aria-label'];

export const aktuelleSprache = () => sprache;
if (typeof window !== "undefined") window.bsT = (s) => t(s); // für Tests

/** Text übersetzen (für Code, der Texte selbst zusammensetzt) */
export function t(s) {
  if (!woerter || s == null) return s;
  const roh = String(s);
  if (cache.has(roh)) return cache.get(roh);
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(roh);
  const kern = m[2].replace(/\s+/g, ' ');
  let erg = null;
  if (kern && /[A-Za-zÄÖÜäöüß]/.test(kern)) {
    if (Object.prototype.hasOwnProperty.call(woerter, kern)) erg = woerter[kern];
    else {
      const mitPunkt = kern.includes(' · ');
      for (const [re, ziel, punkt] of muster) {
        if (mitPunkt && !punkt) continue; // zusammengesetzte Texte erst zerlegen (siehe unten)
        const x = re.exec(kern);
        if (x) { erg = ziel.replace(/\{(\d+)\}/g, (_, i) => exakt(x[+i + 1] ?? '')); break; }
      }
      // zusammengesetzte Texte: „A · B · C“ teilweise übersetzen, „2. Ordner“ (Nummer vorne)
      if (erg == null && kern.includes(' · ')) { const teile = kern.split(' · '); const neu = teile.map((x) => t(x)); if (neu.some((x, i) => x !== teile[i])) erg = neu.join(' · '); }
      if (erg == null) { const n = /^(\d+[.)]\s+)(.+)$/.exec(kern); if (n && woerter[n[2]] != null) erg = n[1] + woerter[n[2]]; }
    }
  }
  const out = erg == null ? roh : m[1] + erg + m[3];
  if (cache.size > 20000) cache.clear();
  cache.set(roh, out);
  return out;
}

/** nur exakte Treffer (für eingesetzte Werte in Mustern – Namen bleiben unverändert) */
function exakt(v) { const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(v); const k = m[2].replace(/\s+/g, ' '); return Object.prototype.hasOwnProperty.call(woerter, k) ? m[1] + woerter[k] + m[3] : v; }
const geschuetzt = (el) => !!el && !!el.closest(SCHUTZ) && !el.closest('.ab-eigen');
function textKnoten(n) {
  const p = n.parentElement;
  if (!p || geschuetzt(p)) return;
  const neu = t(n.data);
  if (neu !== n.data) n.data = neu;
}
function attribute(el) {
  if (geschuetzt(el) && !el.matches('button,[role=button]')) return;
  for (const a of ATTR) { const v = el.getAttribute?.(a); if (v) { const neu = t(v); if (neu !== v) el.setAttribute(a, neu); } }
  if (el.tagName === 'OPTGROUP' && el.label && !el.closest('#session')) { const neu = t(el.label); if (neu !== el.label) el.label = neu; }
}
function baum(wurzel) {
  if (wurzel.nodeType === 3) { textKnoten(wurzel); return; }
  if (wurzel.nodeType !== 1) return;
  attribute(wurzel);
  const w = document.createTreeWalker(wurzel, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n; while ((n = w.nextNode())) { if (n.nodeType === 3) textKnoten(n); else attribute(n); }
}

/** Sprache aktivieren: Wörterbuch laden, Seite übersetzen und neue Inhalte laufend mitübersetzen */
export async function i18nStart(lang) {
  sprache = SPRACHEN[lang] ? lang : 'de';
  document.documentElement.lang = sprache;
  if (sprache === 'de') return;
  try { woerter = await (await fetch(`i18n/${sprache}.json`, { cache: 'no-cache' })).json(); } catch { woerter = null; return; }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  muster = Object.entries(woerter).filter(([k]) => /\{\d+\}/.test(k))
    .sort((a, b) => b[0].replace(/\{\d+\}/g, '').length - a[0].replace(/\{\d+\}/g, '').length)
    .map(([k, v]) => [new RegExp('^' + esc(k).replace(/\\\{(\d+)\\\}/g, '([\\s\\S]+?)') + '$'), v, k.includes(' · ')]);
  document.title = t(document.title);
  baum(document.body);
  new MutationObserver((liste) => {
    for (const m of liste) {
      if (m.type === 'characterData') textKnoten(m.target);
      else if (m.type === 'attributes') attribute(m.target);
      else for (const n of m.addedNodes) baum(n);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTR, 'label'] });
}
