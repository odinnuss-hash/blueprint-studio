// Ablage-Ordnerstruktur bearbeiten (Einstellungen): Hauptgruppen (1–9 …) und Untergruppen (1_1 …) umbenennen,
// hinzufügen, entfernen. Vorgabe = aktuelle Struktur + eigene nummerierte Ordner aus der Ablage.
import { frage } from './dialog.js';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sortiert = (L) => L.sort((a, b) => a.code.localeCompare(b.code, 'de', { numeric: true }));

export class StrukturUI {
  constructor(app) { this.app = app; }

  async zeigen() {
    const cfg = this.app.cfg;
    // aktuelle Struktur + eigene nummerierte Ordner der Ablage (z. B. „6_4_Deko“)
    const L = (cfg.struktur || []).map(([code, name]) => ({ code, name, alt: code }));
    try { if (!this.app.ablage.daten) await this.app.ablage.laden(); } catch { /* egal */ }
    for (const [code, name, eigen] of this.app.ablage.gruppenListe?.() || []) if (eigen && !L.some((x) => x.code === code)) L.push({ code, name, alt: code, eigen: true });
    this.liste = sortiert(L);
    let d = $('dlg-struktur');
    if (!d) {
      d = document.createElement('dialog'); d.id = 'dlg-struktur'; d.className = 'dlg-gross';
      d.innerHTML = `<form method="dialog" class="dlg">
        <h2>Ablage-Ordnerstruktur</h2>
        <p class="hint">Hauptgruppen haben eine Nummer (<code>7</code>), Untergruppen Haupt- und Unternummer (<code>7_3</code>). Die Nummer steht vorne im Blaupausen-Namen, der Name wird zum Ordner in der Ablage. Beim Umbenennen werden vorhandene Ordner mit umbenannt – ihr Inhalt bleibt erhalten. Entfernte Einträge löschen keine Ordner.</p>
        <div class="st-liste" id="st-liste"></div>
        <div class="st-knoepfe"><button type="button" class="btn small" id="st-haupt">+ Hauptgruppe</button><span class="grow"></span><button type="button" class="btn small" id="st-standard">Vorgabe wiederherstellen</button></div>
        <p class="err" id="st-fehler" hidden></p>
        <div class="dlg-actions"><button type="button" class="btn" id="st-abbr">Abbrechen</button><button type="button" class="btn primary" id="st-ok">Speichern</button></div>
      </form>`;
      document.body.appendChild(d);
      $('st-abbr').addEventListener('click', () => d.close());
      $('st-ok').addEventListener('click', () => this.speichern());
      $('st-haupt').addEventListener('click', () => {
        const n = Math.max(0, ...this.liste.filter((x) => !x.code.includes('_')).map((x) => +x.code)) + 1;
        this.liste.push({ code: String(n), name: '', neu: true }); this.zeichnen(true);
      });
      $('st-standard').addEventListener('click', async () => {
        if (!(await frage({ art: 'warnung', titel: 'Vorgabe wiederherstellen?', text: 'Die Liste wird auf die mitgelieferte Struktur zurückgesetzt. Erst mit „Speichern“ wird etwas geändert.', ok: 'Zurücksetzen' }))) return;
        this.liste = sortiert((cfg.strukturStandard || []).map(([code, name]) => ({ code, name, alt: code }))); this.zeichnen();
      });
      d.addEventListener('keydown', (e) => e.stopPropagation());
    }
    $('st-fehler').hidden = true;
    this.zeichnen();
    d.showModal();
  }

  zeichnen(fokusLetzter) {
    const S = $('st-liste');
    S.innerHTML = this.liste.map((x, i) => {
      const unter = x.code.includes('_');
      return `<div class="st-zeile${unter ? ' unter' : ' haupt'}" data-i="${i}">
        <input type="text" class="st-code" value="${esc(x.code)}" aria-label="Nummer" spellcheck="false">
        <input type="text" class="st-name" value="${esc(x.name)}" placeholder="${unter ? 'Name der Untergruppe' : 'Name der Hauptgruppe'}" aria-label="Name" spellcheck="false">
        ${x.eigen ? '<span class="ab-eigen" title="Eigener Ordner aus der Ablage">eigen</span>' : ''}
        ${unter ? '' : `<button type="button" class="btn small st-unter" title="Untergruppe hinzufügen">+ Unter</button>`}
        <button type="button" class="ab-del st-weg" title="Eintrag entfernen" aria-label="Entfernen">✕</button></div>`;
    }).join('');
    S.querySelectorAll('.st-zeile').forEach((z) => {
      const x = this.liste[+z.dataset.i];
      z.querySelector('.st-code').addEventListener('input', (e) => { x.code = e.target.value.trim(); });
      z.querySelector('.st-code').addEventListener('change', () => { sortiert(this.liste); this.zeichnen(); });
      z.querySelector('.st-name').addEventListener('input', (e) => { x.name = e.target.value; });
      z.querySelector('.st-weg').addEventListener('click', () => { this.liste = this.liste.filter((y) => y !== x); this.zeichnen(); });
      z.querySelector('.st-unter')?.addEventListener('click', () => {
        const n = Math.max(0, ...this.liste.filter((y) => y.code.startsWith(x.code + '_')).map((y) => +y.code.split('_')[1])) + 1;
        const neu = { code: `${x.code}_${n}`, name: '', neu: true };
        this.liste.push(neu); sortiert(this.liste); this.zeichnen();
        S.querySelector(`.st-zeile[data-i="${this.liste.indexOf(neu)}"] .st-name`)?.focus();
      });
    });
    if (fokusLetzter) S.querySelector('.st-zeile:last-child .st-name')?.focus();
  }

  async speichern() {
    const f = $('st-fehler');
    try {
      const r = await fetch('/api/struktur', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bs': '1' }, body: JSON.stringify({ liste: this.liste.map((x) => [x.code, x.name]) }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status);
      $('dlg-struktur').close();
      this.app.toast(`Struktur gespeichert (${j.eintraege} Einträge${j.umbenannt ? `, ${j.umbenannt} Ordner umbenannt` : ''}).`, 'ok');
      this.app.cfg = await (await fetch('/api/config')).json();
      this.app.einstellungenStruktur?.();
      await this.app.ablage.laden();
    } catch (e) { f.textContent = e.message; f.hidden = false; }
  }
}
