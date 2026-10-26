// Sonderzeichen-Schilder: Zeichen aus der Liste der Spielschrift (lib/symbol-db, aus satisfactory-symbol-db, gemeinfrei)
// anklicken, zu Schild-Texten zusammenstellen (je Zeile ein Schild) und als Blaupause speichern.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = (c) => c.toString(16).toUpperCase().padStart(4, '0');
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

export class SymbolUI {
  constructor(app) {
    this.app = app; this.daten = null; this.quelle = 'auswahl'; this.gruppe = 0;
    $('gen-symbole')?.addEventListener('click', () => this.zeigen());
  }
  async zeigen() {
    if (!this.daten) { try { this.daten = await (await fetch('/api/symbole')).json(); } catch (e) { this.app.toast('Zeichenliste: ' + e.message, 'err'); return; } }
    let d = $('dlg-symbole');
    if (!d) { d = document.createElement('dialog'); d.id = 'dlg-symbole'; d.className = 'dlg-symbole'; document.body.appendChild(d); }
    const sessions = (this.app.cfg?.sessions || []).filter((x) => !x.lib).map((x) => x.name);
    const ziel = this.app.spielSession?.() || sessions[0] || '';
    d.innerHTML = `<form method="dialog" class="dlg"><h2>Sonderzeichen-Schilder</h2>
      <p class="hint">Zeichen anklicken – sie landen im Textfeld. <b>Jede Zeile wird ein Schild.</b> Gezeigt werden die Zeichen, die die Schrift im Spiel kennt; die Vorschau hier nutzt die Schrift deines Rechners und kann etwas anders aussehen.</p>
      <div class="sy-raster">
        <div><div class="seggroup" role="group" aria-label="Zeichenliste"><button type="button" class="seg" data-q="auswahl">Auswahl</button><button type="button" class="seg" data-q="alle">Alle</button></div>
          <div class="sy-gruppen" id="sy-gruppen"></div></div>
        <div><textarea id="sy-text" class="sy-text" spellcheck="false" placeholder="z. B. ▲ ▼ ◀ ▶ oder ╔══╗ …" data-no-i18n></textarea>
          <div class="sy-opt"><button type="button" class="btn small" id="sy-gruppe-alle" title="Jedes Zeichen der gewählten Gruppe als eigenes Schild (Raster)">Ganze Gruppe als Raster</button><button type="button" class="btn small" id="sy-leeren">Leeren</button><span class="grow"></span><span class="muted" id="sy-zahl"></span></div>
          <div class="sy-zeichen" id="sy-zeichen"></div>
          <div class="sy-vorschau" id="sy-vorschau"></div></div>
      </div>
      <div class="sy-opt">
        <label>Schild <select id="sy-schild"><option value="breit">Beschriftungsschild 4 m</option><option value="mittel">Beschriftungsschild 2 m</option><option value="quadrat">Quadratisch 1 m</option><option value="klein">Quadratisch 0,5 m</option></select></label>
        <label>Spalten <input id="sy-spalten" type="number" min="1" max="40" value="1" style="width:64px"></label>
        <label>Schrift <input id="sy-vorne" type="color" value="#ffffff"></label>
        <label>Hintergrund <input id="sy-hinten" type="color" value="#05050a"></label>
      </div>
      <div class="pl-bp-grid"><label for="sy-name">Name</label><input id="sy-name" type="text" maxlength="32" value="7_3_Sonderzeichen" spellcheck="false" data-no-i18n>
        <label for="sy-ziel">Sitzung</label><select id="sy-ziel" data-no-i18n>${sessions.map((x) => `<option${x === ziel ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
      <div class="dlg-actions"><button type="button" class="btn" value="nein">Schließen</button><button type="button" class="btn primary" id="sy-ok">Als Blaupause speichern</button></div></form>`;
    d.querySelector('[value=nein]').addEventListener('click', () => d.close());
    d.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => { this.quelle = b.dataset.q; this.gruppe = 0; this.gruppen(); }));
    $('sy-text').addEventListener('input', () => this.vorschau());
    for (const id of ['sy-vorne', 'sy-hinten']) $(id).addEventListener('input', () => this.vorschau());
    $('sy-leeren').addEventListener('click', () => { $('sy-text').value = ''; this.vorschau(); });
    $('sy-gruppe-alle').addEventListener('click', () => {
      const g = this.daten[this.quelle][this.gruppe]; if (!g) return;
      $('sy-text').value = g.points.map((c) => String.fromCodePoint(c)).join('\n');
      $('sy-schild').value = 'quadrat'; $('sy-spalten').value = String(Math.min(16, Math.ceil(Math.sqrt(g.points.length))));
      this.vorschau();
    });
    $('sy-ok').addEventListener('click', () => this.speichern(d));
    this.gruppen(); this.vorschau(); d.showModal();
  }
  gruppen() {
    const L = this.daten[this.quelle] || [];
    document.querySelectorAll('#dlg-symbole [data-q]').forEach((b) => b.classList.toggle('on', b.dataset.q === this.quelle));
    $('sy-gruppen').innerHTML = L.map((g, i) => `<button type="button" data-g="${i}" class="${i === this.gruppe ? 'on' : ''}"><span data-no-i18n>${esc(g.name)}</span><small class="muted">${g.points.length}</small></button>`).join('');
    $('sy-gruppen').querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => { this.gruppe = +b.dataset.g; this.gruppen(); }));
    const g = L[this.gruppe];
    $('sy-zeichen').innerHTML = g ? g.points.map((c) => `<button type="button" data-c="${c}" title="U+${hex(c)}" data-no-i18n>${esc(String.fromCodePoint(c))}</button>`).join('') : '';
    $('sy-zeichen').querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => {
      const t = $('sy-text'), z = String.fromCodePoint(+b.dataset.c), a = t.selectionStart ?? t.value.length, e = t.selectionEnd ?? a;
      t.value = t.value.slice(0, a) + z + t.value.slice(e); t.focus(); t.selectionStart = t.selectionEnd = a + z.length; this.vorschau();
    }));
  }
  texte() { return $('sy-text').value.split('\n').map((x) => x.replace(/\r/g, '')).filter((x) => x.trim().length); }
  vorschau() {
    const T = this.texte(), v = $('sy-vorne').value, h = $('sy-hinten').value;
    $('sy-zahl').textContent = `Anzahl Schilder: ${T.length}`;
    // Zeichen, die die Spielschrift nicht kennt, erscheinen im Spiel als „?“ (gemessen 26.10.2026: ✔ ✖ ⌂)
    this.bekannt ||= new Set((this.daten?.alle || []).flatMap((g) => g.points));
    const fremd = [...new Set([...T.join('')].filter((z) => z.trim() && !this.bekannt.has(z.codePointAt(0))))];
    if (fremd.length) $('sy-zahl').textContent += ` · ⚠ Unbekannt (im Spiel „?“): ${fremd.slice(0, 12).join(' ')}`;
    $('sy-vorschau').innerHTML = T.slice(0, 60).map((x) => `<span style="color:${v};background:${h}" data-no-i18n>${esc(x)}</span>`).join('');
  }
  async speichern(d) {
    const texte = this.texte(); if (!texte.length) { this.app.toast('Bitte zuerst Zeichen wählen.', 'err'); return; }
    const body = { session: $('sy-ziel').value, name: $('sy-name').value.trim(), texte, schild: $('sy-schild').value, spalten: +$('sy-spalten').value || 1, vorne: rgb($('sy-vorne').value), hinten: rgb($('sy-hinten').value) };
    try {
      const r = await fetch('/api/symbolschild/blaupause', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' }, body: JSON.stringify(body) });
      const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status);
      this.app.toast(`„${j.name}“ in „${j.session}“ gespeichert: ${j.info.schilder} × ${j.info.schild} (${j.info.breite} × ${j.info.hoehe} m).`, 'ok');
      d.close(); if ($('session').value === j.session) this.app.loadList();
    } catch (e) { this.app.toast(e.message, 'err'); }
  }
}
