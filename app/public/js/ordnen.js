import { frage } from './dialog.js';
// Ordnen: alle Blaupausen (Spiel-Ordner + Bibliotheken) nach einheitlichem Schema benennen.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);
const AKTION = { umbenennen: 'Umbenennen', einsortieren: 'Einsortieren', duplikat: 'Duplikat', loeschen: 'Löschen', gleich: 'passt schon' };
const BAD = /[\\/:*?"<>|]/;
const FARBEN = ['#e8a33d', '#f2d04b', '#5b9bd5', '#8a7a66', '#6b7380', '#3fb6a8', '#9aa0a8'];
const vorschauCache = new Map();
function ladeVorschau(id) {
  if (!vorschauCache.has(id)) vorschauCache.set(id, fetch('/api/ordnen/vorschau?id=' + encodeURIComponent(id)).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return vorschauCache.get(id);
}
function zeichneVorschau(cv, d) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
  ctx.fillStyle = '#101215'; ctx.fillRect(0, 0, W, H);
  if (!d || (!d.boxes.length && !d.lines.length)) { ctx.fillStyle = '#666'; ctx.font = '11px sans-serif'; ctx.fillText('leer', 6, 14); return; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (const b of d.boxes) add(b[0], b[1]);
  for (const l of d.lines) for (let i = 1; i < l.length; i += 2) add(l[i], l[i + 1]);
  const pad = 6, sc = Math.min((W - 2 * pad) / Math.max(4, x1 - x0 + 4), (H - 2 * pad) / Math.max(4, y1 - y0 + 4));
  const ox = W / 2 - ((x0 + x1) / 2) * sc, oy = H / 2 - ((y0 + y1) / 2) * sc;
  const boxes = d.boxes.slice().sort((a, b) => a[6] - b[6]);
  for (const [x, y, w, h, yaw, c] of boxes) {
    ctx.save(); ctx.translate(ox + x * sc, oy + y * sc); ctx.rotate(yaw);
    ctx.fillStyle = FARBEN[c] || '#999'; ctx.globalAlpha = 0.85;
    ctx.fillRect(-w * sc / 2, -h * sc / 2, Math.max(1, w * sc), Math.max(1, h * sc));
    ctx.restore();
  }
  ctx.globalAlpha = 1; ctx.lineWidth = Math.max(1, 1.2 * sc);
  for (const l of d.lines) { ctx.strokeStyle = FARBEN[l[0]]; ctx.beginPath(); for (let i = 1; i < l.length; i += 2) { const px = ox + l[i] * sc, py = oy + l[i + 1] * sc; if (i === 1) ctx.moveTo(px, py); else ctx.lineTo(px, py); } ctx.stroke(); }
}

// Kurze Erklärung zu jedem Eintrag von „Anzeigen“
const ORDNEN_FILTER = {
  offen: 'Zu erledigen: alle Blaupausen, für die es einen Vorschlag gibt (umbenennen, einsortieren, Duplikat, löschen).',
  umbenennen: 'Nur Umbenennen: Der Name passt nicht zum Namensschema – vorgeschlagen ist ein Name mit Gruppen-Nummern.',
  einsortieren: 'Nur Einsortieren: Der Name passt, aber die Blaupause liegt nicht im Ordner ihrer Gruppe.',
  duplikat: 'Nur Duplikate: gleicher Inhalt wie eine andere Blaupause – wird nach _Duplikate verschoben, nicht gelöscht.',
  loeschen: 'Nur Löschen: zum Löschen vorgemerkt – kommt in den Papierkorb und lässt sich wiederherstellen.',
  inhalt: 'Name aus Inhalt: Der Name wurde aus den Gebäuden in der Blaupause geraten – bitte prüfen und bei Bedarf ändern.',
  doppelt: 'Duplikate & Ähnliche: gleiche oder fast gleiche Blaupausen nebeneinander mit Vorschau – zum Vergleichen, bevor etwas wegkommt.',
  fehler: 'Ungültige Namen: Der neue Name passt nicht zum Schema (unbekannte Gruppe, über 32 Zeichen oder Zeichen, die das Spiel nicht erlaubt) – bitte im Feld korrigieren.',
  gleich: 'Passen schon: Name und Ordner stimmen – hier ist nichts zu tun.',
  alle: 'Alle: jede gefundene Blaupause, auch die, die schon passen.',
};

export class Ordnen {
  constructor(app) {
    this.app = app;
    this.data = null; this.rows = []; this.sel = new Set(); this.edit = new Map();
    this.f = { gruppe: '', ort: '', ordner: '', art: 'offen', q: '' };
    this.saveT = 0;
    $('o-load').addEventListener('click', () => this.load(true));
    $('o-struktur').addEventListener('click', () => this.app.struktur.zeigen());
    $('o-apply').addEventListener('click', () => this.apply());
    $('o-uebernehmen').addEventListener('click', () => this.uebernehmen());
    $('o-protokoll').addEventListener('click', () => this.protokoll());
    $('o-all').addEventListener('change', (e) => this.selectAll(e.target.checked));
    const artText = () => { $('o-art-text').textContent = ORDNEN_FILTER[$('o-art').value] || ''; };
    $('o-art').addEventListener('change', artText); artText();
    for (const id of ['o-ort', 'o-ordner', 'o-art']) $(id).addEventListener('change', () => { this.f.ort = $('o-ort').value; this.f.ordner = $('o-ordner').value; this.f.art = $('o-art').value; this.render(); });
    $('o-suche').addEventListener('input', () => { this.f.q = $('o-suche').value.trim().toLowerCase(); clearTimeout(this.qt); this.qt = setTimeout(() => this.render(), 150); });
    $('o-body').addEventListener('input', (e) => this.onEdit(e));
    $('o-body').addEventListener('change', (e) => this.onChange(e));
    $('o-body').addEventListener('click', (e) => this.onClick(e));
    this.io = new IntersectionObserver((ents) => {
      for (const en of ents) {
        if (!en.isIntersecting) continue;
        const cv = en.target; this.io.unobserve(cv);
        ladeVorschau(cv.dataset.id).then((d) => zeichneVorschau(cv, d));
      }
    }, { root: null, rootMargin: '200px' });
  }

  async show() {
    if (!this.data) await this.load(false);
    else this.render();
  }

  async load(force) {
    $('o-status').textContent = 'Lese alle Blaupausen … (beim ersten Mal ca. 20–60 Sekunden)';
    $('o-load').disabled = true;
    try {
      const r = await fetch('/api/ordnen', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.fehler || r.status);
      this.data = j; this.rows = j.eintraege; this.byId = new Map(this.rows.map((x) => [x.id, x]));
      this.edit = new Map(); this.sel = new Set();
      // Vorauswahl: alles, was umbenannt oder als Duplikat verschoben werden soll
      for (const x of this.rows) if (x.aktion !== 'gleich' && !x.fehler) this.sel.add(x.id);
      this.renderLegend(); this.fillFilters(); this.render();
      if (force) this.app.toast(`${this.rows.length} Blaupausen eingelesen.`, 'ok');
    } catch (e) { $('o-status').textContent = 'Fehler: ' + e.message; }
    finally { $('o-load').disabled = false; }
  }

  neuVon(x) { return this.edit.has(x.id) ? this.edit.get(x.id).neu : x.neu; }
  aktionVon(x) { return this.edit.has(x.id) ? this.edit.get(x.id).aktion : x.aktion; }
  /** Aktion für „Umbenennen“ in der Auswahl: gleicher Name → nur einsortieren (Bibliothek) bzw. nichts zu tun */
  basisAktion(x, neu) {
    if (neu !== x.alt) return 'umbenennen';
    return x.aktion === 'einsortieren' || (x.aktion === 'umbenennen' && x.ort === 'Bibliothek') ? 'einsortieren' : 'gleich';
  }
  ok(x) {
    const n = this.neuVon(x);
    const code = (/^\d+_\d+/.exec(n) || [''])[0]; // Code muss eine Gruppe sein (nicht z. B. „2025_10“ aus einem Zeitstempel)
    return ['duplikat', 'loeschen'].includes(this.aktionVon(x)) || (/^\d+_\d+_/.test(n) && this.data.gruppen.some(([c]) => c === code) && n.length <= this.data.maxLen && !BAD.test(n) && n.trim() === n);
  }

  renderLegend() {
    const cnt = {};
    for (const x of this.rows) if (x.aktion !== 'duplikat') { cnt[x.code] = (cnt[x.code] || 0) + 1; cnt[x.code[0]] = (cnt[x.code[0]] || 0) + 1; }
    $('o-legend').innerHTML = `<button type="button" class="lg${this.f.gruppe ? '' : ' on'}" data-g="">Alle Gruppen <span>${this.rows.length}</span></button>` + this.data.gruppen.map(([c, n]) => {
      const haupt = c.length === 1;
      return `<button type="button" class="lg${haupt ? ' haupt' : ''}${this.f.gruppe === c ? ' on' : ''}" data-g="${c}"><b>${c}</b> ${esc(n)} <span>${cnt[c] || ''}</span></button>`;
    }).join('');
    $('o-legend').querySelectorAll('.lg').forEach((b) => b.addEventListener('click', () => { this.f.gruppe = b.dataset.g; this.renderLegend(); this.render(); }));
  }
  fillFilters() {
    const ordner = [...new Set(this.rows.map((x) => `${x.ort}|${x.dir}`))].sort((a, b) => a.localeCompare(b, 'de'));
    $('o-ordner').innerHTML = '<option value="">Alle Ordner</option>' + ordner.map((o) => { const [ort, d] = o.split('|'); return `<option value="${esc(o)}">${esc(ort)}: ${esc(d || '(Hauptordner)')}</option>`; }).join('');
    $('o-ordner').value = this.f.ordner;
    const orte = this.data.orte.map((o) => `${o.ort}: ${o.root}`).join(' · ');
    $('o-orte').textContent = orte;
  }

  filtered() {
    const f = this.f;
    return this.rows.filter((x) => {
      if (f.gruppe && !(f.gruppe.length === 1 ? this.neuVon(x)[0] === f.gruppe : this.neuVon(x).startsWith(f.gruppe + '_'))) return false;
      if (f.ort && x.ort !== f.ort) return false;
      if (f.ordner && `${x.ort}|${x.dir}` !== f.ordner) return false;
      const a = this.aktionVon(x);
      if (f.art === 'offen' && a === 'gleich') return false;
      if (f.art === 'umbenennen' && a !== 'umbenennen') return false;
      if (f.art === 'duplikat' && a !== 'duplikat') return false;
      if (f.art === 'einsortieren' && a !== 'einsortieren') return false;
      if (f.art === 'loeschen' && a !== 'loeschen') return false;
      if (f.art === 'doppelt' && a !== 'duplikat' && !x.aehnlich) return false;
      if (f.art === 'inhalt' && x.grund !== 'aus Inhalt') return false;
      if (f.art === 'gleich' && a !== 'gleich') return false;
      if (f.art === 'fehler' && this.ok(x)) return false;
      if (f.q && !(x.alt.toLowerCase().includes(f.q) || this.neuVon(x).toLowerCase().includes(f.q) || (x.prod || '').toLowerCase().includes(f.q))) return false;
      return true;
    });
  }

  render() {
    if (!this.data) return;
    const list = this.filtered();
    this.visible = list;
    const MAX = 600;
    const rows = list.slice(0, MAX).map((x) => {
      const neu = this.neuVon(x), akt = this.aktionVon(x), ok = this.ok(x);
      const info = [`${x.n} Teile`, x.dim ? `${x.dim[0]}×${x.dim[1]}×${x.dim[2]} m` : '', x.prod ? '→ ' + x.prod : '', x.gleiche ? `gleich wie ${x.gleiche} weitere` : '', x.dupVon ? `Duplikat von „${x.dupVon}“` : '', x.aehnlich && !x.dupVon ? `${x.aehnlich.pct} % ähnlich wie „${x.aehnlich.alt}“ (${x.aehnlich.ort}: ${x.aehnlich.dir || '–'})` : ''].filter(Boolean).join(' · ');
      const anderer = x.dupId || x.aehnlich?.id;
      const thumbs = anderer ? `<div class="o-thumbs" title="links: diese Blaupause · rechts: ${esc(x.dupVon || x.aehnlich?.alt)}"><canvas class="o-th" width="128" height="88" data-id="${esc(x.id)}"></canvas><canvas class="o-th" width="128" height="88" data-id="${esc(anderer)}"></canvas></div>` : '';
      return `<tr data-id="${esc(x.id)}" class="${akt}${ok ? '' : ' bad'}">
        <td><input type="checkbox" class="o-chk" ${this.sel.has(x.id) ? 'checked' : ''} ${akt === 'gleich' ? 'disabled' : ''} aria-label="Auswählen"></td>
        <td class="o-ort">${esc(x.ort)}<br><span>${esc(x.dir || '–')}</span></td>
        <td class="o-alt">${esc(x.alt)}</td>
        <td class="o-neu">${akt === 'duplikat' ? `<span class="o-dup">→ ${x.ort === 'Bibliothek' ? esc([(x.dir || '').split('/')[0]].filter((s) => s.startsWith('_')).concat('_Duplikate').join('/')) : 'Unterordner _Duplikate'}</span>` : akt === 'loeschen' ? `<span class="o-dup o-weg">→ Windows-Papierkorb</span>` : `<input type="text" class="o-in" value="${esc(neu)}" maxlength="40" spellcheck="false" aria-label="Neuer Name für ${esc(x.alt)}"><span class="o-len">${neu.length}/${this.data.maxLen}</span>${this.zielText(x, neu, akt)}`}</td>
        <td><select class="o-akt" aria-label="Aktion"><option value="umbenennen"${['umbenennen', 'einsortieren', 'gleich'].includes(akt) ? ' selected' : ''}>${AKTION[['einsortieren', 'gleich'].includes(akt) ? akt : 'umbenennen']}</option><option value="duplikat"${akt === 'duplikat' ? ' selected' : ''}>Duplikat → _Duplikate</option><option value="loeschen"${akt === 'loeschen' ? ' selected' : ''}>Löschen → Papierkorb</option></select></td>
        <td class="o-vs">${thumbs}</td>
        <td class="o-info">${esc(x.grund)}${x.eigen || this.edit.has(x.id) ? ' · <b>geändert</b>' : ''}<br><span>${esc(info)}</span></td>
        <td><button type="button" class="tool o-view" title="Ansehen (2D/3D)" aria-label="Ansehen">👁</button></td>
      </tr>`;
    }).join('');
    $('o-body').innerHTML = rows || '<tr><td colspan="8" class="muted" style="padding:20px">Nichts gefunden.</td></tr>';
    $('o-body').querySelectorAll('canvas.o-th').forEach((cv) => this.io.observe(cv));
    const nSel = [...this.sel].filter((id) => this.byId.get(id) && this.aktionVon(this.byId.get(id)) !== 'gleich').length;
    const bad = [...this.sel].filter((id) => !this.ok(this.byId.get(id))).length;
    $('o-apply').textContent = `Ausgewählte anwenden (${nSel})`;
    $('o-apply').disabled = !nSel || bad > 0;
    const stat = { umbenennen: 0, einsortieren: 0, duplikat: 0, loeschen: 0, gleich: 0 };
    for (const x of this.rows) stat[this.aktionVon(x)]++;
    $('o-status').textContent = `${list.length} von ${this.rows.length} angezeigt${list.length > MAX ? ` (erste ${MAX} – Filter nutzen)` : ''} · ${stat.umbenennen} umbenennen · ${stat.einsortieren} einsortieren · ${stat.duplikat} Duplikate${stat.loeschen ? ` · ${stat.loeschen} löschen` : ''} · ${stat.gleich} passen schon${bad ? ` · ${bad} ausgewählte Namen ungültig` : ''}`;
    const ue = this.data.uebernehmbar || 0;
    $('o-uebernehmen').textContent = `In Ablage übernehmen (${ue})`; $('o-uebernehmen').disabled = !ue;
    $('o-all').checked = list.length > 0 && list.every((x) => this.aktionVon(x) === 'gleich' || this.sel.has(x.id));
  }

  /** Zielordner der Vorsortierung (nur Bibliothek) unter dem Namen anzeigen */
  zielText(x, neu, akt) {
    if (x.ziel == null || akt === 'gleich') return '';
    const code = (/^\d+_\d+/.exec(neu) || [''])[0];
    const ziel = code === x.code ? x.ziel : `Ordner der Gruppe ${code || '?'}`;
    return `<span class="o-ziel" title="Vorsortierung in der Bibliothek – „In Ablage übernehmen“ bringt sie danach in den Spielordner">→ ${esc(ziel)}</span>`;
  }

  selectAll(on) {
    for (const x of this.visible || []) { if (this.aktionVon(x) === 'gleich') continue; if (on) this.sel.add(x.id); else this.sel.delete(x.id); }
    this.render();
  }
  rowOf(e) { const tr = e.target.closest('tr[data-id]'); return tr ? this.byId.get(tr.dataset.id) : null; }
  remember(x) {
    clearTimeout(this.saveT);
    this.pending = this.pending || {};
    this.pending[x.id] = this.edit.get(x.id) || null;
    this.saveT = setTimeout(() => { const p = this.pending; this.pending = {}; fetch('/api/ordnen/merken', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bs': '1' }, body: JSON.stringify(p) }).catch(() => {}); }, 600);
  }
  onEdit(e) {
    if (!e.target.classList.contains('o-in')) return;
    const x = this.rowOf(e); if (!x) return;
    const v = e.target.value;
    this.edit.set(x.id, { neu: v, aktion: this.basisAktion(x, v) });
    if (v !== x.alt) this.sel.add(x.id);
    const tr = e.target.closest('tr');
    tr.classList.toggle('bad', !this.ok(x));
    tr.querySelector('.o-len').textContent = `${v.length}/${this.data.maxLen}`;
    this.remember(x);
    const bad = [...this.sel].filter((id) => !this.ok(this.byId.get(id))).length;
    $('o-apply').disabled = bad > 0;
  }
  onChange(e) {
    const x = this.rowOf(e); if (!x) return;
    if (e.target.classList.contains('o-chk')) { if (e.target.checked) this.sel.add(x.id); else this.sel.delete(x.id); this.render(); return; }
    if (e.target.classList.contains('o-akt')) {
      const a = e.target.value;
      this.edit.set(x.id, { neu: this.neuVon(x), aktion: a === 'umbenennen' ? this.basisAktion(x, this.neuVon(x)) : a });
      this.remember(x); this.sel.add(x.id); this.render();
    }
  }
  onClick(e) {
    if (!e.target.classList.contains('o-view')) return;
    const x = this.rowOf(e); if (x) this.app.openFromOrdnen(x);
  }

  async apply() {
    const liste = [...this.sel].map((id) => this.byId.get(id)).filter((x) => x && this.aktionVon(x) !== 'gleich').map((x) => ({ id: x.id, neu: this.neuVon(x), aktion: this.aktionVon(x) }));
    if (!liste.length) return;
    const n = (a) => liste.filter((x) => x.aktion === a).length;
    const teile = [n('umbenennen') && `${n('umbenennen')} umbenennen`, n('einsortieren') && `${n('einsortieren')} einsortieren`, n('duplikat') && `${n('duplikat')} Duplikate nach „_Duplikate“`, n('loeschen') && `${n('loeschen')} in den Windows-Papierkorb`].filter(Boolean);
    if (!(await frage({ art: n('loeschen') ? 'warnung' : undefined, titel: 'Änderungen ausführen?', text: teile.join(' · ') + '.', hinweis: 'Bibliotheks-Blaupausen werden dabei im Eingangsordner (z. B. _sortieren) nach der Ablage-Struktur vorsortiert. Umbenennen, Einsortieren und Duplikate lassen sich über „Protokoll“ rückgängig machen, Gelöschtes über den Windows-Papierkorb. Tipp: Das Spiel dabei schließen oder im Hauptmenü lassen.', ok: 'Ausführen' }))) return;
    $('o-apply').disabled = true;
    try {
      const r = await fetch('/api/ordnen/anwenden', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bs': '1' }, body: JSON.stringify({ liste }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.fehler || r.status);
      this.app.toast(`${j.ok} erledigt${j.geloescht ? `, ${j.geloescht} gelöscht` : ''}${j.fehler.length ? `, ${j.fehler.length} Fehler (siehe Konsole)` : ''}.`, j.fehler.length ? 'err' : 'ok');
      if (j.fehler.length) console.warn('Ordnen-Fehler', j.fehler);
      await this.load(false);
      this.app.afterOrdnen?.();
    } catch (e) { this.app.toast('Fehler: ' + e.message, 'err'); }
  }

  /** Vorsortiertes aus der Bibliothek in die Ablage im Spielordner verschieben */
  async uebernehmen() {
    const n = this.data?.uebernehmbar || 0;
    if (!n) return;
    if (!(await frage({ titel: 'In die Ablage übernehmen?', text: `${n} vorsortierte Blaupausen aus der Bibliothek in die Ablage im Spielordner verschieben (gleiche Ordnerstruktur).`, hinweis: 'Gibt es einen Namen dort schon, bleibt die Blaupause in der Bibliothek liegen und wird gemeldet. Leer gewordene Ordner im Eingang werden entfernt.', ok: 'Übernehmen' }))) return;
    $('o-uebernehmen').disabled = true;
    try {
      const r = await fetch('/api/ordnen/uebernehmen', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bs': '1' }, body: '{}' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.fehler || r.status);
      this.app.toast(`${j.ok} in die Ablage übernommen${j.fehler.length ? `, ${j.fehler.length} liegen geblieben (Name schon in der Ablage – siehe Konsole)` : ''}.`, j.fehler.length ? 'err' : 'ok');
      if (j.fehler.length) console.warn('Übernehmen – liegen geblieben', j.fehler);
      await this.load(false);
      this.app.afterOrdnen?.();
    } catch (e) { this.app.toast('Fehler: ' + e.message, 'err'); }
  }

  async protokoll() {
    const r = await fetch('/api/ordnen/protokoll', { cache: 'no-store' }).then((x) => x.json()).catch(() => []);
    if (!r.length) { this.app.toast('Noch keine Umbenennungen durchgeführt.'); return; }
    const d = $('dlg-protokoll');
    $('prot-list').innerHTML = r.map((b) => `<div class="prot-row"><span>${new Date(b.zeit).toLocaleString('de-DE')}</span><span>${b.anzahl} Dateien</span>${b.zurueck ? '<span class="muted">rückgängig gemacht</span>' : `<button type="button" class="btn" data-z="${esc(b.zeit)}">Rückgängig</button>`}</div>`).join('');
    $('prot-list').querySelectorAll('button[data-z]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await frage({ art: 'warnung', titel: 'Rückgängig machen?', text: 'Die alten Namen dieses Vorgangs werden wiederhergestellt.', ok: 'Rückgängig machen' }))) return;
      const j = await fetch('/api/ordnen/rueckgaengig', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bs': '1' }, body: JSON.stringify({ zeit: b.dataset.z }) }).then((x) => x.json());
      this.app.toast(`${j.ok ?? 0} Dateien zurückbenannt${j.fehler?.length ? `, ${j.fehler.length} Fehler` : ''}.`, j.fehler?.length ? 'err' : 'ok');
      d.close(); await this.load(false); this.app.afterOrdnen?.();
    }));
    d.showModal();
  }
}
