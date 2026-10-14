import { eingabe } from './dialog.js';
// Dialog „Duplikate & Papierkorb“: verschobene Duplikate zuruecklegen, geloeschte Blaupausen wiederherstellen.
// Endgueltig geloescht wird hier nichts – das bleibt Handarbeit (Windows-Papierkorb bzw. Ordner _Duplikate).
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const datum = (t) => new Date(t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
async function post(p, b) { const r = await fetch('/api/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' }, body: JSON.stringify(b || {}) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.fehler || r.status); return j; }

export class PapierkorbUI {
  constructor(app) {
    this.app = app; this.tab = 'dup'; this.d = null;
    $('o-papierkorb').addEventListener('click', () => this.zeigen());
    $('pk-ok').addEventListener('click', () => $('dlg-papierkorb').close());
    $('pk-bin').addEventListener('click', () => post('papierkorb/oeffnen').catch(() => {}));
    $('pk-t-dup').addEventListener('click', () => this.setTab('dup'));
    $('pk-t-del').addEventListener('click', () => this.setTab('del'));
    $('pk-suche').addEventListener('input', () => this.render());
  }
  setTab(t) {
    this.tab = t;
    for (const [id, k] of [['pk-t-dup', 'dup'], ['pk-t-del', 'del']]) { $(id).classList.toggle('on', k === t); $(id).setAttribute('aria-selected', k === t); }
    this.render();
  }
  async zeigen() { $('dlg-papierkorb').showModal(); await this.laden(); }
  async laden() {
    $('pk-liste').innerHTML = '<div class="muted pad">Lese …</div>';
    try { this.d = await (await fetch('/api/papierkorb', { cache: 'no-store' })).json(); this.render(); }
    catch (e) { $('pk-liste').innerHTML = `<div class="err pad">${esc(e.message)}</div>`; }
  }
  render() {
    if (!this.d) return;
    const q = $('pk-suche').value.trim().toLowerCase();
    $('pk-t-dup').textContent = `Duplikate (${this.d.duplikate.length})`;
    $('pk-t-del').textContent = `Gelöscht (${this.d.geloescht.length})`;
    if (this.tab === 'dup') {
      const L = this.d.duplikate.filter((x) => !q || x.name.toLowerCase().includes(q) || x.dir.toLowerCase().includes(q));
      $('pk-hint').textContent = 'Duplikate liegen im Unterordner „_Duplikate“ neben ihrem alten Ordner. „Zurücklegen“ verschiebt sie wieder dorthin. Endgültig löschen: den Ordner _Duplikate im Explorer leeren.';
      $('pk-liste').innerHTML = L.slice(0, 500).map((x, k) => `<div class="pk-row"><div class="pk-txt"><b>${esc(x.name)}</b><div class="m">${esc(x.ort)} · ${esc(x.dir || 'Hauptordner')} · ${datum(x.zeit)} · ${(x.groesse / 1024).toFixed(0)} KB${x.frei ? '' : ' · Name im Ordner schon vergeben'}</div></div>
        <button type="button" class="btn small" data-k="${k}">Zurücklegen</button></div>`).join('') + (L.length > 500 ? `<div class="muted pad">… und ${L.length - 500} weitere (Suche benutzen)</div>` : '') || '<div class="muted pad">Keine Duplikate verschoben.</div>';
      $('pk-liste').querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', async () => {
        const x = L[+b.dataset.k];
        let neu = null;
        if (!x.frei) { neu = await eingabe({ art: 'warnung', titel: 'Name schon vergeben', text: `„${x.name}“ gibt es im Ordner schon. Unter welchem Namen zurücklegen?`, wert: x.name + '_2', ok: 'Zurücklegen' }); if (!neu) return; }
        try { await post('papierkorb/zuruecklegen', { oi: x.oi, dir: x.dir, name: x.name, neu }); this.app.toast(`„${neu || x.name}“ zurückgelegt.`, 'ok'); this.app.ordnen.data = null; await this.laden(); this.app.loadList(); }
        catch (e) { this.app.toast(e.message, 'err'); }
      }));
    } else {
      const L = this.d.geloescht.filter((x) => !q || x.name.toLowerCase().includes(q));
      $('pk-hint').textContent = 'Gelöschte Blaupausen liegen im Windows-Papierkorb (dort „Wiederherstellen“) oder – falls das nicht ging – in userdata\\papierkorb (hier „Wiederherstellen“).';
      $('pk-liste').innerHTML = L.map((x) => `<div class="pk-row${x.wiederhergestellt ? ' done' : ''}"><div class="pk-txt"><b>${esc(x.name)}</b><div class="m">${esc(x.ort)} · gelöscht ${datum(x.zeit)} · ${x.pk ? 'userdata\\papierkorb' : 'Windows-Papierkorb'}${x.wiederhergestellt ? ' · wiederhergestellt' : ''}</div></div>
        ${x.pk && !x.wiederhergestellt ? `<button type="button" class="btn small" data-i="${x.i}">Wiederherstellen</button>` : ''}</div>`).join('') || '<div class="muted pad">Noch nichts gelöscht.</div>';
      $('pk-liste').querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', async () => {
        try { await post('papierkorb/wiederherstellen', { i: +b.dataset.i }); this.app.toast('Wiederhergestellt.', 'ok'); await this.laden(); this.app.loadList(); this.app.ablage.laden(); }
        catch (e) { this.app.toast(e.message, 'err'); }
      }));
    }
  }
}
