import { frage, eingabe, ungespeichert } from './dialog.js';
// Ablage-Leiste (unten im Bereich „Blaupause“) und Namensvorschlag (rechts oben).
//  - Blaupause aus der Liste links auf einen Ordner ziehen  -> aus dem Spiel nehmen, im Ordner ablegen
//  - Schalter bei einer Blaupause / beim Ordner              -> ins Spiel holen (aktiv) bzw. wieder ablegen
//  - Blaupause zwischen Ordnern ziehen                       -> umsortieren
//  - Blaupause aus der Ablage auf die Liste links ziehen     -> aktivieren

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TYP = 'application/x-bs-blaupause';
const ICON_DEL = '<svg class="fa" width="12" height="12" viewBox="0 0 448 512" fill="currentColor" aria-hidden="true"><path d="M135.2 17.7C140.6 6.8 151.7 0 163.8 0L284.2 0c12.1 0 23.2 6.8 28.6 17.7L320 32l96 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 96C14.3 96 0 81.7 0 64S14.3 32 32 32l96 0 7.2-14.3zM32 128l384 0 0 320c0 35.3-28.7 64-64 64L96 512c-35.3 0-64-28.7-64-64l0-320zm96 64c-8.8 0-16 7.2-16 16l0 224c0 8.8 7.2 16 16 16s16-7.2 16-16l0-224c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16l0 224c0 8.8 7.2 16 16 16s16-7.2 16-16l0-224c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16l0 224c0 8.8 7.2 16 16 16s16-7.2 16-16l0-224c0-8.8-7.2-16-16-16z"/></svg>';
// Font Awesome Free 6.7.2 – folder / folder-open (CC BY 4.0, fontawesome.com/license/free)
const ICON_ZU = '<svg class="fa ab-ico" width="13" height="13" viewBox="0 0 512 512" fill="currentColor" aria-hidden="true"><path d="M64 480H448c35.3 0 64-28.7 64-64V160c0-35.3-28.7-64-64-64H288c-10.1 0-19.6-4.7-25.6-12.8L243.2 57.6C231.1 41.5 212.1 32 192 32H64C28.7 32 0 60.7 0 96V416c0 35.3 28.7 64 64 64z"/></svg>';
const ICON_AUF = '<svg class="fa ab-ico" width="14" height="13" viewBox="0 0 576 512" fill="currentColor" aria-hidden="true"><path d="M88.7 223.8L0 375.8 0 96C0 60.7 28.7 32 64 32l117.5 0c17 0 33.3 6.7 45.3 18.7l26.5 26.5c12 12 28.3 18.7 45.3 18.7L416 96c35.3 0 64 28.7 64 64l0 32-336 0c-22.8 0-43.8 12.1-55.3 31.8zm27.6 16.1C122.1 230 132.6 224 144 224l400 0c11.5 0 22 6.1 27.7 16.1s5.7 22.2-.1 32.1l-112 192C453.9 474 443.4 480 432 480L32 480c-11.5 0-22-6.1-27.7-16.1s-5.7-22.2 .1-32.1l112-192z"/></svg>';

async function post(pfad, body) {
  const r = await fetch('/api/' + pfad, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.fehler || r.status);
  return j;
}
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };

export class AblageUI {
  constructor(app) {
    this.app = app;
    this.daten = null;
    this.offen = new Set(JSON.parse(lsGet('ablage-offen') || '[]'));
    this.aktuell = lsGet('ablage-ordner') || null;
    this.zu = lsGet('ablage-zu') === '1';
    this.vorschlag = null;
  }

  init() {
    $('ab-toggle').addEventListener('click', () => { this.zu = !this.zu; lsSet('ablage-zu', this.zu ? '1' : '0'); this.layout(); });
    $('ab-reload').addEventListener('click', () => this.laden());
    $('ab-neu').addEventListener('click', () => this.neuerOrdner());
    $('ab-auf').addEventListener('click', () => this.alleKlappen(true));
    $('ab-zu').addEventListener('click', () => this.alleKlappen(false));
    $('nv-ok').addEventListener('click', () => this.umbenennen());
    $('nv-ablegen').addEventListener('click', () => this.ablegenVorschlag());
    $('nv-del').addEventListener('click', () => { const bp = this.app.bp; if (bp) this.loeschen(bp.ablage ? { ordner: bp.ablage, name: bp.name } : { session: bp.session || $('session').value, name: bp.name }); });
    this.felderEinrichten();
    // Liste links: Ziehen erlauben + Ablage-Eintraege annehmen (= aktivieren)
    const liste = $('bp-list');
    liste.addEventListener('dragstart', (e) => {
      const it = e.target.closest('.item[data-name]'); if (!it) return;
      const name = it.dataset.name;
      const mark = this.app.markierte();
      const namen = mark.length > 1 && mark.includes(name) ? mark : [name];
      if (namen.length === 1 && !this.app.listSel.has(name)) this.app.listAuswahl([name]);
      e.dataTransfer.setData(TYP, JSON.stringify({ session: $('session').value, name, namen }));
      e.dataTransfer.effectAllowed = 'move';
      if (namen.length > 1) {
        // Ziehbild mit Anzahl
        const g = document.createElement('div'); g.className = 'drag-anzahl'; g.textContent = `${namen.length} Blaupausen`;
        document.body.appendChild(g); e.dataTransfer.setDragImage(g, 10, 10); setTimeout(() => g.remove(), 0);
      }
      document.body.classList.add('ab-ziehen');
    });
    liste.addEventListener('contextmenu', (e) => {
      const it = e.target.closest('.item[data-name]'); if (!it) return;
      e.preventDefault();
      const mark = this.app.markierte();
      if (mark.length > 1 && mark.includes(it.dataset.name)) this.loeschenMehrere($('session').value, mark);
      else this.loeschen({ session: $('session').value, name: it.dataset.name });
    });
    // Tasten in der Liste (nur bei mehreren markierten, sonst gelten die Editor-Tasten): Entf = löschen, Esc = Markierung aufheben
    liste.addEventListener('keydown', (e) => {
      const mark = this.app.markierte(); if (mark.length < 2) return;
      if (e.key === 'Delete') { e.preventDefault(); e.stopPropagation(); this.loeschenMehrere($('session').value, mark); }
      else if (e.key === 'Escape') { e.stopPropagation(); this.app.listAuswahl(this.app.bp && !this.app.bp.ablage ? [this.app.bp.name] : []); }
    });
    $('bp-multi-del').addEventListener('click', () => this.loeschenMehrere($('session').value, this.app.markierte()));
    $('bp-multi-weg').addEventListener('click', () => this.app.listAuswahl(this.app.bp && !this.app.bp.ablage ? [this.app.bp.name] : []));
    liste.addEventListener('dragover', (e) => { if (this.ziehtAblage(e)) { e.preventDefault(); liste.classList.add('drop'); } });
    liste.addEventListener('dragleave', () => liste.classList.remove('drop'));
    liste.addEventListener('drop', (e) => {
      liste.classList.remove('drop');
      const d = this.daten_(e); if (!d?.von) return;
      e.preventDefault(); this.schalten(d.von, [d.name], true);
    });
    document.addEventListener('dragend', () => { document.body.classList.remove('ab-ziehen'); document.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop')); });
    this.layout();
    this.laden();
  }
  /** Alle Ordner der Ablage auf- oder zuklappen */
  alleKlappen(auf) {
    this.alleZu = !auf;
    this.offen = auf && this.knoten ? new Set([...this.knoten.values()].filter((k) => k.kinder.length).map((k) => k.rel)) : new Set();
    lsSet('ablage-offen', JSON.stringify([...this.offen]));
    if (this.zu) { this.zu = false; lsSet('ablage-zu', '0'); this.layout(); }
    this.render();
  }
  ziehtAblage(e) { return [...e.dataTransfer.types].includes(TYP) && document.body.classList.contains('ab-von-ablage'); }
  daten_(e) { try { return JSON.parse(e.dataTransfer.getData(TYP)); } catch { return null; } }
  layout() {
    $('ablage').classList.toggle('zu', this.zu);
    $('ab-toggle').setAttribute('aria-expanded', String(!this.zu));
    requestAnimationFrame(() => this.app.render?.());
  }

  // ------------------------------------------------------------ Daten
  async laden() {
    try {
      const r = await fetch('/api/ablage', { cache: 'no-store' });
      this.daten = await r.json();
      if (!r.ok) throw new Error(this.daten.fehler);
      this.render();
    } catch (e) { $('ab-tree').innerHTML = `<div class="err pad">${esc(e.message)}</div>`; }
  }

  /** Baum: Hauptgruppen -> Untergruppen (aus dem Schema) + alle vorhandenen Ordner */
  baum() {
    const D = this.daten, knoten = new Map();
    const add = (rel, titel, code) => {
      if (knoten.has(rel)) return knoten.get(rel);
      const teile = rel.split('/');
      const k = { rel, titel: titel || teile[teile.length - 1], code: code || null, kinder: [], eltern: teile.length > 1 ? teile.slice(0, -1).join('/') : null };
      knoten.set(rel, k);
      return k;
    };
    for (const [code] of D.gruppen) {
      const rel = D.ordnerFuer[code];
      add(rel, rel.split('/').pop(), code);
    }
    for (const rel of D.struktur || []) if (!knoten.has(rel)) add(rel).thema = true;
    for (const rel of Object.keys(D.ordner)) add(rel);
    // eigene Ordner, die wie das Schema mit einer Nummer beginnen („2_7 Wasseraufbereitung“) wie Schema-Ordner behandeln
    for (const k of knoten.values()) {
      if (k.code || k.thema) continue;
      // Nummer vorne, danach Leerzeichen, Unterstrich oder Bindestrich: „6_4 Deko“, „6_4_Deko“, „6_4-Deko“, auch nur „6_4“
      const m = /^(\d+(?:_\d+)?)(?:[ _-]+(.+))?$/.exec(k.titel);
      if (m) { k.eigenCode = m[1]; k.eigenTitel = (m[2] || m[1]).replace(/_/g, ' '); }
    }
    // Eltern sicherstellen und verknuepfen
    for (const k of [...knoten.values()]) {
      let e = k.eltern, kind = k;
      while (e) { const p = add(e); if (!p.kinder.includes(kind)) p.kinder.push(kind); kind = p; e = p.eltern; }
    }
    const zahl = (k) => {
      const eigene = D.ordner[k.rel] || [];
      let n = eigene.length, a = eigene.filter((x) => x.aktiv).length;
      for (const c of k.kinder) { const z = zahl(c); n += z.n; a += z.a; }
      k.n = n; k.a = a; return { n, a };
    };
    const wurzeln = [...knoten.values()].filter((k) => !k.eltern).sort((a, b) => a.rel.localeCompare(b.rel, 'de', { numeric: true }));
    for (const w of wurzeln) zahl(w);
    // Reihenfolge: nummerierte Ordner (Schema und eigene) nach Nummer, danach Themen/eigene ohne Nummer alphabetisch
    const nr = (k) => (k.code || k.eigenCode ? 0 : 1);
    for (const k of knoten.values()) k.kinder.sort((a, b) => nr(a) - nr(b) || a.titel.localeCompare(b.titel, 'de', { numeric: true }));
    return { wurzeln, knoten };
  }

  render() {
    const { wurzeln, knoten } = this.baum();
    this.knoten = knoten;
    if (this.aktuell && !knoten.has(this.aktuell)) this.aktuell = null;
    const zeile = (k, tiefe) => {
      const hatKinder = k.kinder.length > 0, auf = this.offen.has(k.rel) || (!this.alleZu && (this.aktuell || '').startsWith(k.rel + '/'));
      const schalter = k.n ? `<input type="checkbox" class="ab-sw" data-rel="${esc(k.rel)}" ${k.a === k.n ? 'checked' : ''} ${k.a && k.a < k.n ? 'data-teil="1"' : ''} title="${k.a}/${k.n} im Spiel – Klick: alle ${k.a === k.n ? 'ablegen' : 'ins Spiel holen'}" aria-label="Alle in ${esc(k.titel)} ${k.a === k.n ? 'ablegen' : 'aktivieren'}">` : '<span class="ab-sw-leer"></span>';
      let h = `<div class="ab-row${k.rel === this.aktuell ? ' on' : ''}${k.n ? '' : ' leer'}" role="treeitem" aria-expanded="${hatKinder ? auf : ''}" data-rel="${esc(k.rel)}" style="--t:${tiefe}">
        <button type="button" class="ab-chev" data-auf="${esc(k.rel)}" ${hatKinder ? '' : 'disabled'} aria-label="${auf ? 'Zuklappen' : 'Aufklappen'}">${hatKinder ? (auf ? '▾' : '▸') : ''}</button>
        <span class="ab-name">${k.rel === this.aktuell ? ICON_AUF : ICON_ZU} ${k.code ? `<b>${esc(k.code)}</b> ` : k.eigenCode ? `<b>${esc(k.eigenCode)}</b> ` : ''}${esc(k.code ? k.titel.replace(new RegExp(`^${k.code}[ _-]*`), '') : k.eigenCode ? k.eigenTitel : k.titel)}${!k.code && !k.thema ? ' <span class="ab-eigen" title="Eigener Ordner">eigen</span>' : ''}</span>
        <span class="ab-zahl">${k.n ? `${k.a}/${k.n}` : ''}</span>${schalter}</div>`;
      if (hatKinder && auf) for (const c of k.kinder) h += zeile(c, tiefe + 1);
      return h;
    };
    $('ab-tree').innerHTML = wurzeln.map((w) => zeile(w, 0)).join('');
    $('ab-tree').querySelectorAll('.ab-sw[data-teil]').forEach((c) => { c.indeterminate = true; });
    this.bindBaum();
    this.renderDateien();
  }

  bindBaum() {
    const T = $('ab-tree');
    T.querySelectorAll('.ab-row').forEach((row) => {
      const rel = row.dataset.rel;
      row.addEventListener('click', (e) => {
        if (e.target.closest('.ab-sw')) return;
        this.alleZu = false;
        if (e.target.closest('.ab-chev')) { if (this.offen.has(rel)) this.offen.delete(rel); else this.offen.add(rel); lsSet('ablage-offen', JSON.stringify([...this.offen])); this.render(); return; }
        this.aktuell = rel; lsSet('ablage-ordner', rel); this.offen.add(rel); this.render();
      });
      row.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes(TYP)) { e.preventDefault(); row.classList.add('drop'); } });
      row.addEventListener('dragleave', () => row.classList.remove('drop'));
      row.addEventListener('drop', (e) => { row.classList.remove('drop'); const d = this.daten_(e); if (!d) return; e.preventDefault(); this.ablegen(d, rel); });
    });
    T.querySelectorAll('.ab-sw').forEach((c) => c.addEventListener('change', () => {
      const k = this.knoten.get(c.dataset.rel);
      this.ordnerSchalten(k, c.checked);
    }));
  }

  renderDateien() {
    const F = $('ab-files');
    if (!this.aktuell) { F.innerHTML = '<div class="muted pad">Links einen Ordner wählen. Blaupausen aus der Liste links auf einen Ordner ziehen, um sie abzulegen.</div>'; return; }
    const k = this.knoten.get(this.aktuell);
    const L = this.daten.ordner[this.aktuell] || [];
    const unter = k.kinder.filter((c) => c.n).map((c) => `<button type="button" class="ab-chip" data-rel="${esc(c.rel)}">${esc(c.titel)} <span>${c.a}/${c.n}</span></button>`).join('');
    const kannWeg = !k.code && !k.thema && !L.length && !k.kinder.length;
    F.innerHTML = `<div class="ab-fhead"><b>${esc(this.aktuell)}</b><span class="muted">${L.filter((x) => x.aktiv).length} von ${L.length} im Spiel</span><span class="grow"></span>
      ${L.length ? `<button type="button" class="btn small" data-alle="1">Alle ins Spiel</button><button type="button" class="btn small" data-alle="0">Alle ablegen</button>` : ''}
      <button type="button" class="btn small" id="ab-unter">+ Unterordner</button>${kannWeg ? '<button type="button" class="btn small" id="ab-weg">Ordner entfernen</button>' : ''}</div>
      ${unter ? `<div class="ab-chips">${unter}</div>` : ''}
      <div class="ab-list">${L.map((x) => { const falsch = x.aktiv && !(this.daten.spielSitzungen || []).includes(x.session); return `<div class="ab-file${x.aktiv ? ' aktiv' : ''}${falsch ? ' falsch' : ''}" draggable="true" data-name="${esc(x.name)}">
        <label class="ab-schalter" title="${falsch ? `Liegt im Ordner „${esc(x.session)}“ – das ist kein Spielstand, das Spiel sieht sie dort nicht. Klick: zurück in die Ablage, dann neu ins Spiel holen.` : x.aktiv ? 'Im Spiel (Spielstand ' + esc(x.session) + ') – Klick: ablegen' : 'Abgelegt – Klick: ins Spiel holen'}"><input type="checkbox" ${x.aktiv ? 'checked' : ''} aria-label="${esc(x.name)} im Spiel"><span class="sl"></span></label>
        <span class="n" title="${esc(x.name)}">${esc(x.name)}</span><span class="m">${falsch ? '⚠ nicht im Spiel · ' + esc(x.session) : x.aktiv ? 'im Spiel · ' + esc(x.session) : 'abgelegt'}</span>
        <button type="button" class="linkbtn" data-open="1">ansehen</button><button type="button" class="ab-del" data-del="1" title="Löschen (in den Papierkorb)" aria-label="${esc(x.name)} löschen">${ICON_DEL}</button></div>`; }).join('') || '<div class="muted pad">Leer – Blaupausen hierher ziehen.</div>'}</div>`;
    F.querySelectorAll('.ab-chip').forEach((b) => b.addEventListener('click', () => { this.aktuell = b.dataset.rel; lsSet('ablage-ordner', b.dataset.rel); this.render(); }));
    F.querySelectorAll('[data-alle]').forEach((b) => b.addEventListener('click', () => this.schalten(this.aktuell, L.map((x) => x.name), b.dataset.alle === '1')));
    $('ab-unter').addEventListener('click', () => this.neuerOrdner(this.aktuell));
    $('ab-weg')?.addEventListener('click', () => this.ordnerEntfernen(this.aktuell));
    F.querySelectorAll('.ab-file').forEach((row) => {
      const name = row.dataset.name, x = L.find((y) => y.name === name);
      row.querySelector('input').addEventListener('change', (e) => this.schalten(this.aktuell, [name], e.target.checked));
      row.querySelector('[data-open]').addEventListener('click', () => this.ansehen(this.aktuell, x));
      row.querySelector('[data-del]').addEventListener('click', () => this.loeschen(x.aktiv ? { session: x.session, name } : { ordner: this.aktuell, name }));
      row.addEventListener('dblclick', () => this.ansehen(this.aktuell, x));
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData(TYP, JSON.stringify({ von: this.aktuell, name }));
        e.dataTransfer.effectAllowed = 'move';
        document.body.classList.add('ab-ziehen', 'ab-von-ablage');
      });
      row.addEventListener('dragend', () => document.body.classList.remove('ab-von-ablage'));
    });
  }

  // ------------------------------------------------------------ Aktionen
  async nachher(msg) {
    await this.laden();
    await this.app.loadList();
    if (msg) this.app.toast(msg, 'ok');
  }
  async ablegen(d, nach) {
    if (!d.von && d.namen?.length > 1) return this.ablegenMehrere(d.session, d.namen, nach);
    try {
      if (d.von) { if (d.von === nach) return; await post('ablage/ablegen', { von: d.von, name: d.name, nach }); return this.nachher(`„${d.name}“ nach ${nach.split('/').pop()} verschoben.`); }
      if (this.app.bp && this.app.bp.name === d.name && !this.app.bp.ablage && this.app.dirty() && !(await ungespeichert('Trotzdem ablegen?'))) return;
      const erg = await post('ablage/ablegen', { session: d.session, name: d.name, nach });
      if (erg.kopiert) { this.aktuell = nach; lsSet('ablage-ordner', nach); return this.nachher(`„${d.name}“ aus der Bibliothek in ${nach.split('/').pop()} kopiert (Original bleibt in der Bibliothek).`); }
      if (this.app.bp && this.app.bp.name === d.name && !this.app.bp.ablage) { this.app.bp.nurAnsicht = true; this.app.bp.ablage = nach; this.app.updateStatus(); $('pathtext').textContent = `Ablage · ${nach} · ${d.name} (nur ansehen – zum Bearbeiten ins Spiel holen)`; }
      this.aktuell = nach; lsSet('ablage-ordner', nach);
      await this.nachher(`„${d.name}“ abgelegt in ${nach.split('/').pop()} – nicht mehr im Spiel.`);
    } catch (e) { this.app.toast(e.message, 'err'); }
  }
  async schalten(ordner, namen, aktiv) {
    if (!namen.length) return;
    const session = aktiv ? await this.app.zielSitzung() : null;
    if (aktiv && !session) { this.render(); return; }
    try {
      const r = await post('ablage/schalten', { ordner, namen, aktiv, session });
      const f = r.fehler?.length ? ` ${r.fehler.length} nicht möglich: ${r.fehler.map((x) => x.name + ' – ' + x.fehler).join('; ')}` : '';
      await this.nachher(null);
      this.app.toast(`${r.ok} ${aktiv ? `ins Spiel geholt (Spielstand ${session})` : 'abgelegt'}.${f}`, f ? 'err' : 'ok');
    } catch (e) { this.app.toast(e.message, 'err'); }
  }
  ordnerSchalten(k, aktiv) {
    const namen = [];
    const sammeln = (kn) => { if (this.daten.ordner[kn.rel]?.length) namen.push([kn.rel, this.daten.ordner[kn.rel].map((x) => x.name)]); kn.kinder.forEach(sammeln); };
    sammeln(k);
    (async () => {
      let ok = 0; const fehler = [];
      const session = aktiv ? await this.app.zielSitzung() : null;
      if (aktiv && !session) { this.render(); return; }
      for (const [rel, n] of namen) {
        try { const r = await post('ablage/schalten', { ordner: rel, namen: n, aktiv, session }); ok += r.ok; fehler.push(...(r.fehler || [])); } catch (e) { fehler.push({ name: rel, fehler: e.message }); }
      }
      await this.nachher(null);
      this.app.toast(`${ok} ${aktiv ? `ins Spiel geholt (Spielstand ${session})` : 'abgelegt'}.${fehler.length ? ` ${fehler.length} nicht möglich (z. B. ${fehler[0].name}: ${fehler[0].fehler}).` : ''}`, fehler.length ? 'err' : 'ok');
    })();
  }
  /** Mehrere Blaupausen aus der Liste links auf einen Ablage-Ordner (Spiel: verschieben, Bibliothek: kopieren) */
  async ablegenMehrere(session, namen, nach) {
    const bp = this.app.bp;
    const offen = bp && !bp.ablage && namen.includes(bp.name);
    if (offen && this.app.dirty() && !(await ungespeichert('Trotzdem ablegen?'))) return;
    let ok = 0, kopiert = false; const fehler = [];
    for (const name of namen) {
      try { const r = await post('ablage/ablegen', { session, name, nach }); ok++; if (r.kopiert) kopiert = true; }
      catch (e) { fehler.push(`${name}: ${e.message}`); }
    }
    if (offen && !kopiert && ok) { bp.nurAnsicht = true; bp.ablage = nach; this.app.updateStatus(); }
    this.aktuell = nach; lsSet('ablage-ordner', nach); this.app.listSel.clear();
    await this.nachher(null);
    const ziel = nach.split('/').pop();
    const msg = kopiert ? `${ok} Blaupausen aus der Bibliothek in ${ziel} kopiert (Originale bleiben in der Bibliothek).` : `${ok} Blaupausen abgelegt in ${ziel} – nicht mehr im Spiel.`;
    this.app.toast(msg + (fehler.length ? ` ${fehler.length} nicht möglich: ${fehler.slice(0, 3).join('; ')}${fehler.length > 3 ? ' …' : ''}` : ''), fehler.length ? 'err' : 'ok');
  }
  /** Mehrere Blaupausen löschen (eine Rückfrage, alle in den Papierkorb) */
  async loeschenMehrere(session, namen) {
    if (!namen.length) return;
    if (namen.length === 1) return this.loeschen({ session, name: namen[0] });
    const liste = namen.slice(0, 50).concat(namen.length > 50 ? [`… und ${namen.length - 50} weitere`] : []);
    if (!(await frage({ art: 'loeschen', titel: `${namen.length} Blaupausen löschen?`, liste, text: 'Sie werden in den Papierkorb verschoben und können dort wiederhergestellt werden.', ok: `${namen.length} löschen` }))) return;
    let ok = 0, ziel = 'Papierkorb'; const fehler = [];
    for (const name of namen) {
      try { const r = await post('loeschen', { session, name }); ok++; ziel = r.ziel; } catch (e) { fehler.push(`${name}: ${e.message}`); }
    }
    const bp = this.app.bp;
    if (bp && !bp.ablage && namen.includes(bp.name)) {
      this.app.bp = null; this.app.scene = null; this.app.sel = new Set();
      $('empty').hidden = false; $('nv').hidden = true; this.app.render(); this.app.renderInspector?.(); this.app.renderCosts?.();
    }
    this.app.listSel.clear();
    await this.nachher(null);
    this.app.toast(`${ok} Blaupausen gelöscht (${ziel === 'Papierkorb' ? 'im Papierkorb' : 'verschoben nach ' + ziel}).` + (fehler.length ? ` ${fehler.length} nicht möglich: ${fehler.slice(0, 3).join('; ')}` : ''), fehler.length ? 'err' : 'ok');
  }
  /** Loeschen = in den Windows-Papierkorb (dort wiederherstellbar) */
  async loeschen(ziel) {
    if (!(await frage({ art: 'loeschen', titel: `„${ziel.name}“ löschen?`, text: 'Die Blaupause wird in den Papierkorb verschoben und kann dort wiederhergestellt werden.', ok: 'Löschen' }))) return;
    try {
      const r = await post('loeschen', ziel);
      const bp = this.app.bp;
      if (bp && bp.name === ziel.name && ((ziel.session && !bp.ablage) || (ziel.ordner && bp.ablage === ziel.ordner))) {
        this.app.bp = null; this.app.scene = null; this.app.sel = new Set();
        $('empty').hidden = false; $('nv').hidden = true; this.app.render(); this.app.renderInspector?.(); this.app.renderCosts?.();
      }
      await this.nachher(`„${ziel.name}“ gelöscht (${r.ziel === 'Papierkorb' ? 'im Papierkorb' : 'verschoben nach ' + r.ziel}).`);
    } catch (e) { this.app.toast(e.message, 'err'); }
  }

  async neuerOrdner(eltern) {
    const name = await eingabe({ art: 'ordner', titel: eltern ? 'Neuer Unterordner' : 'Eigener Ordner', text: eltern ? `in „${eltern.split('/').pop()}“` : 'Name des neuen Ordners in der Ablage', platzhalter: 'z. B. 2_7 Wasseraufbereitung', hinweis: 'Mit Nummer vorne (z. B. 2_7 …) wird er wie die übrigen Ordner einsortiert.', ok: 'Anlegen' });
    if (!name) return;
    if (/[\\/:*?"<>|]/.test(name)) { this.app.toast('Ein Ordnername darf \\ / : * ? " < > | nicht enthalten.', 'err'); return; }
    const rel = eltern ? `${eltern}/${name.trim()}` : name.trim();
    try { await post('ablage/ordner', { ordner: rel }); this.aktuell = rel; lsSet('ablage-ordner', rel); if (eltern) this.offen.add(eltern); await this.laden(); }
    catch (e) { this.app.toast(e.message, 'err'); }
  }
  async ordnerEntfernen(rel) {
    try { await post('ablage/ordner', { ordner: rel, entfernen: true }); this.aktuell = null; await this.laden(); this.app.toast('Ordner entfernt.', 'ok'); }
    catch (e) { this.app.toast(e.message, 'err'); }
  }
  async ansehen(ordner, x) {
    if (x.aktiv) { if ($('session').value !== x.session) { $('session').value = x.session; await this.app.loadList(); } return this.app.openBlueprint(x.name); }
    if (this.app.dirty() && !(await ungespeichert('Trotzdem eine andere Blaupause öffnen?'))) return;
    $('loading').hidden = false;
    try {
      const r = await fetch(`/api/blueprint?ablage=${encodeURIComponent(ordner)}&name=${encodeURIComponent(x.name)}`, { cache: 'no-store' });
      const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status);
      this.app.bp = j; this.app.openScene();
      $('pathtext').textContent = `Ablage · ${ordner} · ${x.name} (nur ansehen – zum Bearbeiten ins Spiel holen)`;
    } catch (e) { this.app.toast('Konnte nicht geöffnet werden: ' + e.message, 'err'); }
    finally { $('loading').hidden = true; }
  }

  // ------------------------------------------------------------ Namensvorschlag (rechts)
  async zeigeVorschlag() {
    const bp = this.app.bp;
    const box = $('nv');
    if (!bp || bp.neu || bp.kartenAusschnitt) { box.hidden = true; return; }
    box.hidden = false;
    $('nv-alt').textContent = bp.name;
    $('nv-neu').value = ''; this.felderSetzen(''); $('nv-grund').textContent = 'Vorschlag wird ermittelt …'; $('nv-len').textContent = '';
    $('nv-ok').disabled = true; $('nv-ablegen').disabled = true;
    const q = bp.ablage ? `ablage=_&ordner=${encodeURIComponent(bp.ablage)}` : `session=${encodeURIComponent(bp.session || $('session').value)}`;
    const ich = bp;
    try {
      const r = await fetch(`/api/vorschlag?${q}&name=${encodeURIComponent(bp.name)}`, { cache: 'no-store' });
      const v = await r.json(); if (!r.ok) throw new Error(v.fehler || r.status);
      if (this.app.bp !== ich) return;
      this.vorschlag = v;
      $('nv-neu').value = v.neu; this.felderSetzen(v.neu);
      $('nv-grund').innerHTML = `${esc(v.grund)}${v.beispiele ? ` · lernt aus ${v.beispiele.toLocaleString('de-DE')} deiner Namen` : ''}<br>Ordner: <b>${esc(v.ordner.split('/').pop())}</b>`;
      $('nv-ablegen').textContent = bp.ablage ? 'Hierhin verschieben' : 'Ablegen';
      $('nv-ablegen').title = `In „${v.ordner}“ ${bp.ablage ? 'verschieben' : 'ablegen (aus dem Spiel nehmen)'}`;
      $('nv-ablegen').disabled = bp.ablage === v.ordner;
      this.laengeZeigen();
      this.zielOrdner();
    } catch (e) { $('nv-grund').textContent = 'Kein Vorschlag: ' + e.message; }
  }
  // ------------------------------------------------------------ Name in drei Feldern: Kategorie _ Unterkategorie _ Name
  /** Kategorien/Unterkategorien: Schema plus eigene Ordner mit Nummer (z. B. „2_7 Wasseraufbereitung“) */
  gruppenListe() {
    const L = (this.daten?.gruppen || []).map(([c, t]) => [c, t]);
    const da = new Set(L.map(([c]) => c));
    this.eigeneOrdner = {};
    for (const k of this.knoten?.values() || []) {
      if (!k.eigenCode) continue;
      this.eigeneOrdner[k.eigenCode] ||= k.rel;
      if (!da.has(k.eigenCode)) { L.push([k.eigenCode, k.eigenTitel, true]); da.add(k.eigenCode); }
    }
    return L.sort((a, b) => a[0].localeCompare(b[0], 'de', { numeric: true }));
  }
  felderSetzen(name) {
    const m = /^([^_\s]{1,3})_([^_\s]{1,3})_(.*)$/.exec(name || '');
    $('nv-kat').value = m ? m[1] : ''; $('nv-unt').value = m ? m[2] : ''; $('nv-name').value = m ? m[3] : (name || '');
    this.felderZusammen(false);
  }
  /** Felder -> fertiger Name (Unterstriche setzt die App) */
  felderZusammen(eingabe = true) {
    const sauber = (s) => s.trim().replace(/\s+/g, '_').replace(/^_+|_+$/g, '');
    const k = sauber($('nv-kat').value), u = sauber($('nv-unt').value), n = sauber($('nv-name').value).replace(/_{2,}/g, '_');
    const name = [k, u, n].filter(Boolean).join('_');
    $('nv-neu').value = name;
    $('nv-ergebnis').textContent = name || '–';
    const gn = Object.fromEntries(this.gruppenListe());
    const kette = [gn[k], gn[`${k}_${u}`]].filter(Boolean).join(' › ');
    $('nv-ergebnis').title = kette ? `${kette}` : 'So heißt die Blaupause danach';
    this.laengeZeigen();
    if (eingabe) this.zielOrdner();
  }
  /** Ablage-Ordner passend zu Kategorie/Unterkategorie (Vorschlag des Servers, solange der Code gleich bleibt) */
  zielOrdner() {
    const v = this.vorschlag; if (!v) return null;
    const k = $('nv-kat').value.trim(), u = $('nv-unt').value.trim(), code = k && u ? `${k}_${u}` : k;
    const vcode = (/^(\d_\d)_/.exec(v.neu || '') || [])[1];
    const fuer = this.daten?.ordnerFuer || {};
    this.gruppenListe();
    const eigen = this.eigeneOrdner || {};
    const ziel = code === vcode ? v.ordner : (fuer[code] || eigen[code] || fuer[k] || eigen[k] || v.ordner);
    const bp = this.app.bp;
    const gn = Object.fromEntries(this.gruppenListe());
    const kette = [gn[k], gn[code]].filter(Boolean).join(' › ');
    $('nv-grund').innerHTML = `${kette ? `<span class="nv-kette">${esc(kette)}</span><br>` : ''}${esc(v.grund)}${v.beispiele ? ` · lernt aus ${v.beispiele.toLocaleString('de-DE')} deiner Namen` : ''}<br>Ordner: <b>${esc(ziel.split('/').pop())}</b>`;
    $('nv-ablegen').title = `In „${ziel}“ ${bp?.ablage ? 'verschieben' : 'ablegen (aus dem Spiel nehmen)'}`;
    $('nv-ablegen').disabled = !bp || bp.ablage === ziel;
    return ziel;
  }
  felderEinrichten() {
    const pop = $('nv-pop');
    let feld = null, akt = -1;
    const eintraege = () => {
      const G = this.gruppenListe();
      if (feld === 'kat') return G.filter(([c]) => !c.includes('_')).map(([c, t, eigen]) => ({ wert: c, text: t, eigen }));
      const k = $('nv-kat').value.trim();
      return G.filter(([c]) => c.startsWith(k + '_')).map(([c, t, eigen]) => ({ wert: c.split('_')[1], text: t, eigen }));
    };
    const zeigen = () => {
      if (!feld) { pop.hidden = true; return; }
      const inp = $(feld === 'kat' ? 'nv-kat' : 'nv-unt');
      const q = inp.value.trim().toLowerCase();
      const alle = eintraege();
      // beim Tippen filtern (Nummer oder Text), sonst alles zeigen
      const L = this.filtern ? alle.filter((e) => e.wert.toLowerCase().startsWith(q) || e.text.toLowerCase().includes(q)) : alle;
      const gn = Object.fromEntries(this.gruppenListe());
      const kopf = feld === 'kat' ? 'Kategorie wählen' : `Unterkategorie von ${esc($('nv-kat').value.trim())} ${esc(gn[$('nv-kat').value.trim()] || '')}`;
      pop.innerHTML = `<div class="kopf">${kopf}</div>` + (L.length ? L.map((e, i) => `<button type="button" role="option" data-wert="${esc(e.wert)}" class="${i === akt ? 'akt' : ''}${e.wert === inp.value.trim() ? ' gewaehlt' : ''}"><b>${esc(e.wert)}</b><span>${esc(e.text)}${e.eigen ? ' <span class="ab-eigen">eigen</span>' : ''}</span></button>`).join('')
        : `<div class="leer">${feld === 'unt' && !gn[$('nv-kat').value.trim()] ? 'Erst eine Kategorie wählen – oder selbst etwas eintragen.' : 'Keine passende – eigener Eintrag wird übernommen.'}</div>`);
      pop.hidden = false;
      inp.setAttribute('aria-expanded', 'true');
      pop.querySelectorAll('button[data-wert]').forEach((b) => b.addEventListener('mousedown', (e) => { e.preventDefault(); waehlen(b.dataset.wert); }));
      pop.querySelector('.akt')?.scrollIntoView({ block: 'nearest' });
    };
    const zu = () => { pop.hidden = true; feld = null; akt = -1; ['nv-kat', 'nv-unt'].forEach((id) => $(id).setAttribute('aria-expanded', 'false')); };
    const waehlen = (wert) => {
      const war = feld;
      $(war === 'kat' ? 'nv-kat' : 'nv-unt').value = wert;
      if (war === 'kat') {
        // passt die Unterkategorie nicht mehr zur neuen Kategorie: leeren und gleich die Auswahl dafür zeigen
        const G = this.gruppenListe().map(([c]) => c);
        if (!G.includes(`${wert}_${$('nv-unt').value.trim()}`)) $('nv-unt').value = '';
        this.felderZusammen();
        zu(); $('nv-unt').focus(); return;
      }
      this.felderZusammen(); zu(); $('nv-name').focus();
    };
    for (const [id, art] of [['nv-kat', 'kat'], ['nv-unt', 'unt']]) {
      const inp = $(id);
      const oeffnen = () => { feld = art; akt = -1; this.filtern = false; zeigen(); };
      inp.addEventListener('focus', () => { oeffnen(); inp.select(); });
      inp.addEventListener('click', () => { if (pop.hidden) oeffnen(); });
      inp.addEventListener('input', () => { feld = art; this.filtern = true; akt = 0; zeigen(); this.felderZusammen(); });
      inp.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== $('nv-kat') && document.activeElement !== $('nv-unt')) zu(); }, 120));
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        const n = pop.querySelectorAll('button[data-wert]').length;
        if (e.key === 'ArrowDown') { e.preventDefault(); if (pop.hidden) oeffnen(); akt = Math.min(n - 1, akt + 1); zeigen(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); akt = Math.max(0, akt - 1); zeigen(); }
        else if (e.key === 'Enter') { e.preventDefault(); const b = pop.querySelectorAll('button[data-wert]')[akt]; if (!pop.hidden && b) waehlen(b.dataset.wert); else this.umbenennen(); }
        else if (e.key === 'Escape') { zu(); }
        else if (e.key === 'Tab') zu();
      });
    }
    $('nv-name').addEventListener('input', () => this.felderZusammen());
    $('nv-name').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.umbenennen(); });
  }
  laengeZeigen() {
    const v = $('nv-neu').value.trim(), max = this.vorschlag?.maxLen || 32;
    const ok = /^\d_\d_/.test(v) && v.length <= max && !/[\\/:*?"<>|]/.test(v);
    $('nv-len').textContent = `${v.length}/${max}`;
    $('nv-len').classList.toggle('bad', !ok);
    $('nv-ok').disabled = !v || v === this.app.bp?.name || /[\\/:*?"<>|]/.test(v);
  }
  async umbenennen() {
    const bp = this.app.bp, neu = $('nv-neu').value.trim();
    if (!bp || !neu || neu === bp.name) return;
    if (this.app.dirty() && !(await ungespeichert('Erst umbenennen? Die Änderungen bleiben offen.'))) return;
    try {
      await post('umbenennen', bp.ablage ? { ordner: bp.ablage, name: bp.name, neu } : { session: bp.session || $('session').value, name: bp.name, neu });
      bp.name = neu;
      const ziel = this.app.cfg?.umbenennenEinsortieren !== false ? this.zielOrdner() : null;
      if (ziel && bp.ablage !== ziel) {
        // gleich in den passenden Ablage-Ordner (Bibliothek: kopieren, Spiel: ablegen, Ablage: verschieben)
        if (bp.ablage) { await post('ablage/ablegen', { von: bp.ablage, name: neu, nach: ziel }); bp.ablage = ziel; }
        else {
          const erg = await post('ablage/ablegen', { session: bp.session || $('session').value, name: neu, nach: ziel });
          if (!erg.kopiert) { bp.nurAnsicht = true; bp.ablage = ziel; this.app.updateStatus(); }
        }
        this.aktuell = ziel; lsSet('ablage-ordner', ziel);
        this.app.toast(`Umbenannt in „${neu}“ und einsortiert in ${ziel.split('/').pop()}.`, 'ok');
      } else this.app.toast(`Umbenannt in „${neu}“.`, 'ok');
      await this.nachher(null);
      $('nv-alt').textContent = neu; this.laengeZeigen();
      this.zielOrdner();
      this.app.renderList();
    } catch (e) { this.app.toast(e.message, 'err'); }
  }
  async ablegenVorschlag() {
    const bp = this.app.bp, v = this.vorschlag; if (!bp || !v) return;
    const ziel = this.zielOrdner();
    if (bp.ablage) return this.ablegen({ von: bp.ablage, name: bp.name }, ziel).then(() => { bp.ablage = ziel; this.zeigeVorschlag(); });
    await this.ablegen({ session: bp.session || $('session').value, name: bp.name }, ziel);
    this.zeigeVorschlag();
  }
}
