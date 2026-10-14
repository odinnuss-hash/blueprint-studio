// Updates: beim Start (höchstens alle 6 h, abschaltbar) und auf Knopfdruck auf GitHub nach einer neuen
// Version suchen, Änderungen zeigen und auf Wunsch installieren. Danach lädt die Seite neu – main.js erkennt
// die neue Version und startet den Server selbst neu.
import { frage } from './dialog.js';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Release-Text (Markdown) einfach und sicher darstellen: Überschriften, Listen, fett, Code
function notizenHtml(md) {
  const zeilen = esc(md || '').replace(/\r/g, '').split('\n');
  let html = '', liste = false;
  const inline = (t) => t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const z of zeilen) {
    const li = /^\s*[-*]\s+(.*)$/.exec(z), h = /^#{1,6}\s+(.*)$/.exec(z);
    if (li) { if (!liste) { html += '<ul>'; liste = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (liste) { html += '</ul>'; liste = false; }
    if (h) html += `<h4>${inline(h[1])}</h4>`;
    else if (z.trim()) html += `<p>${inline(z)}</p>`;
  }
  if (liste) html += '</ul>';
  return html || '<p class="muted">Keine Beschreibung.</p>';
}

export class UpdateUI {
  constructor(app) { this.app = app; this.info = null; }

  /** still = beim Start: nur den Knopf oben einblenden, keine Meldungen bei Fehlern */
  async pruefen({ still = false, neu = false } = {}) {
    let j;
    try { j = await (await fetch('/api/update' + (neu ? '?neu=1' : ''), { cache: 'no-store' })).json(); }
    catch (e) { if (!still) this.app.toast('Update-Prüfung fehlgeschlagen: ' + e.message, 'err'); return null; }
    this.info = j;
    const knopf = $('btn-update');
    if (knopf) { knopf.hidden = !j.verfuegbar; if (j.verfuegbar) knopf.title = `Neue Version ${j.neu} verfügbar`; }
    if (!still) {
      if (j.verfuegbar) this.zeigen();
      else if (j.fehler || j.hinweis) this.app.toast(j.fehler || j.hinweis, j.fehler ? 'err' : 'ok');
      else this.app.toast(`Blueprint Studio ist aktuell (${j.aktuell}).`, 'ok');
    }
    return j;
  }

  zeigen() {
    const j = this.info; if (!j?.verfuegbar) return;
    let d = $('dlg-update');
    if (!d) { d = document.createElement('dialog'); d.id = 'dlg-update'; d.className = 'dlg-gross'; document.body.appendChild(d); d.addEventListener('keydown', (e) => e.stopPropagation()); }
    const datum = j.datum ? new Date(j.datum).toLocaleDateString(document.documentElement.lang || 'de-DE') : '';
    d.innerHTML = `<form method="dialog" class="dlg">
      <h2>Update verfügbar</h2>
      <p>Version <b data-no-i18n>${esc(j.neu)}</b>${datum ? ` vom <span data-no-i18n>${esc(datum)}</span>` : ''} – installiert ist <b data-no-i18n>${esc(j.aktuell)}</b>.</p>
      <div class="up-notizen" data-no-i18n>${notizenHtml(j.notizen)}</div>
      <p class="hint">Deine Einstellungen, Blaupausen, 3D-Modelle und Icons bleiben erhalten. Ersetzte Programmdateien werden vorher im Ordner <code>userdata\\update-sicherung</code> gesichert.${j.seite ? ` <a href="${esc(j.seite)}" target="_blank" rel="noopener">Seite des Updates öffnen</a>` : ''}</p>
      <p class="muted" id="up-status"></p>
      <div class="dlg-actions"><button type="button" class="btn" id="up-spaeter">Später</button><button type="button" class="btn primary" id="up-los">Jetzt aktualisieren</button></div>
    </form>`;
    $('up-spaeter').addEventListener('click', () => d.close());
    $('up-los').addEventListener('click', () => this.installieren());
    d.showModal();
  }

  async installieren() {
    if (this.app.dirty?.() && !(await frage({ art: 'warnung', titel: 'Ungespeicherte Änderungen', text: 'Die App lädt nach dem Update neu – nicht gespeicherte Änderungen an der offenen Blaupause gehen verloren.', ok: 'Trotzdem aktualisieren' }))) return;
    const los = $('up-los'), st = $('up-status');
    los.disabled = true; $('up-spaeter').disabled = true; st.textContent = 'Lade und installiere das Update …';
    try {
      const r = await fetch('/api/update', { method: 'POST', headers: { 'X-BS': '1' } });
      const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status);
      st.textContent = j.text;
      if (j.neu) { this.app.dirty = () => false; setTimeout(() => location.reload(), 1200); }
      else { los.disabled = false; $('up-spaeter').disabled = false; }
    } catch (e) { st.textContent = 'Update fehlgeschlagen: ' + e.message; los.disabled = false; $('up-spaeter').disabled = false; }
  }
}
