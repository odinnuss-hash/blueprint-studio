// Gemeinsames Design für Hauptfenster, Nebenfenster und eingebettete Hilfe.
export const DESIGNS = ['werkhalle', 'atlas', 'kommandobruecke', 'industrial', 'immersive'];
const KEY = 'bs-startseite-stil';
export function gespeichertesDesign() {
  try { const v = localStorage.getItem(KEY); if (DESIGNS.includes(v)) return v; } catch {}
  return 'kommandobruecke';
}
function dokument(doc, stil) {
  doc.documentElement.dataset.design = stil;
  if (!doc.querySelector('link[data-bs-design]')) {
    const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = '/design.css'; link.dataset.bsDesign = '1'; doc.head.append(link);
    const extra = doc.createElement('link'); extra.rel = 'stylesheet'; extra.href = '/industrial.css'; doc.head.append(extra);
  }
}
export function designAnwenden(stil, speichern = false) {
  if (!DESIGNS.includes(stil)) stil = 'kommandobruecke';
  if (speichern) localStorage.setItem(KEY, stil);
  dokument(document, stil);
  try { const doc = document.getElementById('hilfe-frame')?.contentDocument; if (doc?.head) dokument(doc, stil); } catch {}
  window.dispatchEvent(new CustomEvent('bs-design', {detail:stil}));
  return stil;
}
designAnwenden(gespeichertesDesign());
document.getElementById('hilfe-frame')?.addEventListener('load', () => designAnwenden(gespeichertesDesign()));
window.addEventListener('storage', e => { if (e.key === KEY) designAnwenden(gespeichertesDesign()); });
