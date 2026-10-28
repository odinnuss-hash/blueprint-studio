// Dialog „Einrichtung – Voraussetzungen“ (beim ersten Start und aus den Einstellungen)
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ZEICHEN = { ok: '✓', warnung: '!', fehler: '✕' };

export class EinrichtungUI {
  constructor(app) {
    this.app = app;
    $('ein-neu').addEventListener('click', () => this.laden());
    $('ein-ok').addEventListener('click', () => { this.gesehen(); $('dlg-einrichtung').close(); });
    $('dlg-einrichtung').addEventListener('cancel', () => this.gesehen());
    $('set-pruefen').addEventListener('click', () => { $('dlg-settings').close(); this.zeigen(); });
    $('set-assistent').addEventListener('click', () => { $('dlg-settings').close(); this.app.assistent.zeigen(); });
    $('set-modelle')?.addEventListener('click', () => { $('dlg-settings').close(); this.app.assistent.zeigen('fmodel'); });
  }
  async beimStart() {
    try {
      const j = await (await fetch('/api/einrichtung', { cache: 'no-store' })).json();
      if (j.ersterStart && !this.app.cfg?.eingerichtet) { this.app.assistent.zeigen(); return; }
      if (!j.pflichtOk) { this.render(j); $('ein-intro').textContent = j.ersterStart ? 'Willkommen! Blueprint Studio prüft einmalig, ob alles da ist. Fehlendes lässt sich – wo erlaubt – direkt nachinstallieren.' : 'Es fehlt etwas Wichtiges:'; $('dlg-einrichtung').showModal(); }
    } catch { /* egal */ }
  }
  async zeigen() { $('dlg-einrichtung').showModal(); await this.laden(); }
  async laden(still = false) {
    clearTimeout(this.timer);
    if (!still) $('ein-liste').innerHTML = '<div class="muted">Prüfe …</div>';
    try {
      const j = await (await fetch('/api/einrichtung', { cache: 'no-store' })).json();
      this.render(j);
      // läuft ein Job (z. B. Gelände erzeugen), Liste nachladen, bis er fertig ist; dann Ergebnis melden
      const laeuft = j.liste.some((x) => /^wird erzeugt/.test(x.text));
      if (laeuft && $('dlg-einrichtung').open) { this.jobLief = true; this.timer = setTimeout(() => this.laden(true), 2000); }
      else if (this.jobLief) {
        this.jobLief = false;
        const s = await (await fetch('/api/einrichtung/job', { cache: 'no-store' })).json();
        if (s && !s.laeuft) this.app.toast(s.ok ? s.text : (s.fehler || s.text || 'Fehlgeschlagen.'), s.ok ? 'ok' : 'err');
      }
    } catch (e) { $('ein-liste').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  }
  render(j) {
    $('ein-liste').innerHTML = j.liste.map((x) => `<div class="ein-row ${x.status}">
      <span class="ein-st" aria-label="${x.status === 'ok' ? 'in Ordnung' : x.status === 'fehler' ? 'Fehler' : 'Hinweis'}">${ZEICHEN[x.status]}</span>
      <div class="ein-txt"><b>${esc(x.titel)}</b>${x.pflicht ? ' <span class="muted">(nötig)</span>' : ''}<div class="m">${esc(x.text)}</div></div>
      <div class="ein-act">${x.aktion ? `<button type="button" class="btn small${x.status === 'ok' ? '' : ' primary'}" data-akt="${x.aktion}">${esc(x.aktionText)}</button>` : ''}
        ${x.hilfe && x.status !== 'ok' ? `<button type="button" class="btn small" data-hilfe="${x.hilfe}">Anleitung</button>` : ''}
        ${x.link && x.status !== 'ok' && !x.aktion ? `<a class="btn small" href="${esc(x.link)}" target="_blank" rel="noopener">Webseite</a>` : ''}</div></div>`).join('');
    $('ein-liste').querySelectorAll('[data-akt]').forEach((b) => b.addEventListener('click', () => this.aktion(b)));
    $('ein-liste').querySelectorAll('[data-hilfe]').forEach((b) => b.addEventListener('click', () => { $('dlg-einrichtung').close(); this.app.showHelp(b.dataset.hilfe); }));
  }
  async aktion(b) {
    const alt = b.textContent; b.disabled = true; b.textContent = 'Läuft …';
    try {
      const r = await fetch('/api/einrichtung/aktion', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' }, body: JSON.stringify({ aktion: b.dataset.akt }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status);
      this.app.toast(j.text, 'ok');
      if (b.dataset.akt !== 'verknuepfung') { this.app.karte.liste = null; }
      await this.laden();
    } catch (e) { this.app.toast(e.message, 'err'); b.disabled = false; b.textContent = alt; }
  }
  gesehen() { fetch('/api/einrichtung/gesehen', { method: 'POST', headers: { 'X-BS': '1' } }).catch(() => {}); }
}
