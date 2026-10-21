// Einrichtungs-Assistent (erster Start, jederzeit aus den Einstellungen): Sprache, Ordner, Spielstand,
// 3D-Darstellung (Kästen oder echte Spielmodelle per FModel – mit Schritt-für-Schritt-Anleitung), Extras.
import { frage } from './dialog.js';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const post = async (p, b) => { const r = await fetch('/api/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' }, body: JSON.stringify(b || {}) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.fehler || r.status); return j; };
const get = async (p) => { const r = await fetch('/api/' + p, { cache: 'no-store' }); const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status); return j; };
const SPRACHEN = [['de', 'Deutsch', 'Standard'], ['en', 'English', ''], ['fr', 'Français', ''], ['ja', '日本語', '']];
const REGEX = {
  props: 'Buildable/.*/Build_[^/]*\\.uasset$',
  modelle: 'Buildable/(Factory|Building)/.*/SM_[^/]*\\.uasset$',
  icons: 'IconDesc',
};

export class AssistentUI {
  constructor(app) { this.app = app; this.schritt = 0; }

  get schritte() {
    const s = ['sprache', 'ordner', 'spielstand', 'darstellung'];
    if (this.wahl.modelle3d === 'modelle') s.push('fmodel');
    s.push('extras', 'fertig');
    return s;
  }

  async zeigen() {
    const c = this.app.cfg || await get('config');
    this.wahl = { sprache: c.sprache || 'de', saveDir: c.saveDir, gameDir: c.gameDir, bibliothek: (c.bibliotheken || [])[0] || '', megaprints: (c.megaprints || [])[0] || '',
      spielSitzung: c.spielSitzung || '', modelle3d: c.modelle3d || (c.modelleVorhanden ? 'modelle' : 'kaesten') };
    this.schritt = 0;
    try { if (sessionStorage.getItem('bs.sprachwechsel')) { sessionStorage.removeItem('bs.sprachwechsel'); this.schritt = 1; } } catch { /* egal */ }
    let d = $('dlg-assistent');
    if (!d) {
      d = document.createElement('dialog'); d.id = 'dlg-assistent';
      d.innerHTML = `<form method="dialog" class="as">
        <div class="as-kopf"><img src="icon.png" alt="" width="34" height="34"><div><h2>Einrichtung</h2><div class="as-pfad" id="as-pfad"></div></div></div>
        <div class="as-inhalt" id="as-inhalt"></div>
        <div class="as-fuss"><button type="button" class="btn" id="as-spaeter">Später</button><span class="grow"></span>
          <button type="button" class="btn" id="as-zurueck">Zurück</button><button type="button" class="btn primary" id="as-weiter">Weiter</button></div>
      </form>`;
      document.body.appendChild(d);
      $('as-zurueck').addEventListener('click', () => { if (this.schritt > 0) { this.schritt--; this.zeichnen(); } });
      $('as-weiter').addEventListener('click', () => this.weiter());
      $('as-spaeter').addEventListener('click', () => this.schliessen(false));
      d.addEventListener('cancel', (e) => { e.preventDefault(); this.schliessen(false); });
      d.addEventListener('keydown', (e) => e.stopPropagation());
    }
    this.zeichnen();
    if (!d.open) d.showModal();
  }

  async schliessen(fertig) {
    if (!fertig && !(await frage({ art: 'warnung', titel: 'Einrichtung später fortsetzen?', text: 'Du kannst den Assistenten jederzeit unter Einstellungen → „Einrichtungs-Assistent“ erneut starten.', ok: 'Später', abbrechen: 'Weiter einrichten' }))) return;
    $('dlg-assistent').close();
    post('einrichtung/gesehen').catch(() => {});
  }

  zeichnen() {
    const S = this.schritte, id = S[this.schritt];
    const namen = { sprache: 'Sprache', ordner: 'Ordner', spielstand: 'Spielstand', darstellung: '3D-Darstellung', fmodel: 'Spielmodelle', extras: 'Extras', fertig: 'Fertig' };
    $('as-pfad').innerHTML = S.map((s, i) => `<span class="${i === this.schritt ? 'akt' : i < this.schritt ? 'ok' : ''}">${i + 1}. ${namen[s]}</span>`).join('<i>›</i>');
    $('as-zurueck').disabled = this.schritt === 0;
    $('as-weiter').textContent = id === 'fertig' ? 'Los geht’s' : 'Weiter';
    $('as-spaeter').hidden = id === 'fertig';
    this['s_' + id]($('as-inhalt'));
    $('as-inhalt').scrollTop = 0;
  }

  async weiter() {
    const id = this.schritte[this.schritt];
    try {
      if (id === 'ordner') {
        this.ordnerLesen();
        if (!this.pfadOk?.save?.ok || !this.pfadOk?.game?.ok) {
          if (!(await frage({ art: 'warnung', titel: 'Ordner unvollständig', text: 'Spielstand-Ordner oder Satisfactory-Installation wurden nicht gefunden. Ohne sie funktionieren Katalog und Blaupausen nicht vollständig.', ok: 'Trotzdem weiter', abbrechen: 'Zurück' }))) return;
        }
        await post('config', { saveDir: this.wahl.saveDir, gameDir: this.wahl.gameDir, bibliotheken: this.wahl.bibliothek ? [this.wahl.bibliothek] : [], megaprints: this.wahl.megaprints ? [this.wahl.megaprints] : [] });
        this.app.cfg = await get('config');
      }
      if (id === 'spielstand') await post('config', { spielSitzung: this.wahl.spielSitzung });
      if (id === 'darstellung') await post('config', { modelle3d: this.wahl.modelle3d });
      if (id === 'fertig') {
        await post('config', { eingerichtet: true });
        $('dlg-assistent').close(); post('einrichtung/gesehen').catch(() => {});
        this.app.toast('Einrichtung abgeschlossen – viel Spaß mit Blueprint Studio!', 'ok');
        if (this.modelleGeholt && !this.app.dirty?.()) { setTimeout(() => location.reload(), 800); return; } // neue Modelle/Icons laden
        await this.app.init();
        return;
      }
      this.schritt++; this.zeichnen();
    } catch (e) { this.app.toast(e.message, 'err'); }
  }

  // ------------------------------------------------------------ 1. Sprache
  s_sprache(el) {
    el.innerHTML = `<h3>Willkommen bei Blueprint Studio</h3>
      <p>Satisfactory-Blaupausen ansehen, bearbeiten, ordnen – und Bereiche aus Spielständen als Blaupause herauskopieren. Dieser Assistent richtet alles in wenigen Schritten ein.</p>
      <p class="as-frage">Sprache der App</p>
      <div class="as-karten">${SPRACHEN.map(([k, n, z]) => `<button type="button" class="as-karte${this.wahl.sprache === k ? ' gewaehlt' : ''}" data-spr="${k}"><b>${n}</b>${z ? `<small>${z}</small>` : ''}</button>`).join('')}</div>
      <p class="hint">Auch die Namen der Gebäude und Gegenstände kommen dann in dieser Sprache aus deinem Spiel.</p>`;
    el.querySelectorAll('[data-spr]').forEach((b) => b.addEventListener('click', async () => {
      this.wahl.sprache = b.dataset.spr;
      await this.app.spracheSetzen?.(b.dataset.spr);
      this.zeichnen();
    }));
  }

  // ------------------------------------------------------------ 2. Ordner
  s_ordner(el) {
    const feld = (id, titel, wert, hinweis, pflicht) => `<div class="as-feld"><label for="${id}">${titel}${pflicht ? ' <span class="muted">(nötig)</span>' : ' <span class="muted">(optional)</span>'}</label>
      <div class="as-zeile"><input id="${id}" type="text" spellcheck="false" autocomplete="off" value="${esc(wert)}"><button type="button" class="btn small" data-waehlen="${id}">Wählen …</button></div>
      <div class="as-status" id="${id}-st">${hinweis || ''}</div></div>`;
    el.innerHTML = `<h3>Wo liegt was?</h3>
      <p>Die App hat die üblichen Orte schon gesucht. Bitte prüfen – grüner Haken = gefunden.</p>
      ${feld('as-save', 'Spielstand-Ordner (enthält deine .sav-Dateien und „blueprints“)', this.wahl.saveDir, '', true)}
      ${feld('as-game', 'Satisfactory-Installationsordner (enthält „CommunityResources“)', this.wahl.gameDir, '', true)}
      <div class="as-gefunden" id="as-spiele"></div>
      ${feld('as-lib', 'Eigene Blaupausen-Sammlung außerhalb des Spiels', this.wahl.bibliothek, 'z. B. ein Ordner mit heruntergeladenen Blaupausen – erscheint links unter „Bibliothek“')}
      ${feld('as-mp', 'Megaprints (.cbp von satisfactory-calculator.com)', this.wahl.megaprints, 'erscheinen auf der Karte')}`;
    el.querySelectorAll('[data-waehlen]').forEach((b) => b.addEventListener('click', async () => {
      const inp = $(b.dataset.waehlen);
      try { const r = await post('ordner-waehlen', { titel: inp.closest('.as-feld').querySelector('label').textContent, start: inp.value }); if (r.pfad) { inp.value = r.pfad; this.ordnerPruefen(); } }
      catch (e) { this.app.toast(e.message, 'err'); }
    }));
    ['as-save', 'as-game'].forEach((id) => $(id).addEventListener('change', () => this.ordnerPruefen()));
    this.ordnerPruefen();
  }
  ordnerLesen() { this.wahl.saveDir = $('as-save').value.trim(); this.wahl.gameDir = $('as-game').value.trim(); this.wahl.bibliothek = $('as-lib').value.trim(); this.wahl.megaprints = $('as-mp').value.trim(); }
  async ordnerPruefen() {
    this.ordnerLesen();
    try {
      const r = await post('einrichtung/pfade', { saveDir: this.wahl.saveDir, gameDir: this.wahl.gameDir });
      this.pfadOk = r;
      const st = (x) => `<span class="${x.ok ? 'st-ok' : 'st-nein'}">${x.ok ? '✓' : '✕'}</span> ${esc(x.text)}`;
      $('as-save-st').innerHTML = st(r.save); $('as-game-st').innerHTML = st(r.game);
      if (!this.wahl.saveDir && r.standardSave) { $('as-save').value = r.standardSave; return this.ordnerPruefen(); }
      const andere = r.spiele.filter((g) => g !== this.wahl.gameDir);
      $('as-spiele').innerHTML = andere.length ? `Gefunden: ${andere.map((g) => `<button type="button" class="linkbtn" data-spiel="${esc(g)}">${esc(g)}</button>`).join(' · ')}` : (!r.game.ok ? 'Automatisch nichts gefunden – bitte mit „Wählen …“ den Ordner angeben (Steam: Rechtsklick auf Satisfactory → Verwalten → Lokale Dateien durchsuchen).' : '');
      $('as-spiele').querySelectorAll('[data-spiel]').forEach((b) => b.addEventListener('click', () => { $('as-game').value = b.dataset.spiel; this.ordnerPruefen(); }));
    } catch (e) { this.app.toast(e.message, 'err'); }
  }

  // ------------------------------------------------------------ 3. Spielstand
  async s_spielstand(el) {
    el.innerHTML = '<p class="muted">Lese Spielstände …</p>';
    let S = [];
    try { S = await get('spielsitzungen'); } catch { /* */ }
    const datum = (t) => new Date(t).toLocaleDateString('de-DE');
    el.innerHTML = `<h3>In welchen Spielstand sollen Blaupausen?</h3>
      <p>Das Spiel zeigt Blaupausen nur aus dem Ordner seines Spielstands (<code>blueprints\\&lt;Spielstand&gt;</code>). Wenn du Blaupausen aus der Ablage „ins Spiel holst“, landen sie hier.</p>
      <div class="bf-optionen">${[{ name: '', t: 'Jedes Mal fragen', i: 'beim Aktivieren eine Auswahl zeigen' }, ...S.map((x) => ({ name: x.name, t: x.name, i: `zuletzt gespielt ${datum(x.zuletzt)} · ${x.spielstaende} Speicherstände · ${x.blaupausen} Blaupausen` }))]
        .map((o) => `<label class="bf-option"><input type="radio" name="as-sp" value="${esc(o.name)}" ${o.name === this.wahl.spielSitzung ? 'checked' : ''}><span class="bf-o-text"><b>${esc(o.t)}</b><small>${esc(o.i)}</small></span></label>`).join('')}</div>
      ${S.length ? '' : '<p class="hint">Keine Spielstände gefunden – Spielstand-Ordner im vorigen Schritt prüfen. Du kannst das auch später in den Einstellungen festlegen.</p>'}`;
    el.querySelectorAll('[name=as-sp]').forEach((r) => r.addEventListener('change', () => { this.wahl.spielSitzung = r.value; }));
  }

  // ------------------------------------------------------------ 4. Darstellung
  s_darstellung(el) {
    const da = this.app.cfg?.modelleVorhanden;
    el.innerHTML = `<h3>Wie sollen Gebäude in 3D aussehen?</h3>
      <div class="as-karten zwei">
        <button type="button" class="as-karte gross${this.wahl.modelle3d === 'kaesten' ? ' gewaehlt' : ''}" data-m="kaesten"><b>Einfache Kästen</b><small>sofort fertig, nichts zu tun · sehr schnell, auch bei riesigen Blaupausen</small><span class="as-bild kaesten"></span></button>
        <button type="button" class="as-karte gross${this.wahl.modelle3d === 'modelle' ? ' gewaehlt' : ''}" data-m="modelle"><b>Echte Spielmodelle</b><small>${da ? 'Modelle sind bereits vorhanden ✓' : 'einmalig ca. 5–15 Minuten: die App holt die Modelle automatisch aus deinem eigenen Spiel (alternativ von Hand mit FModel)'}</small><span class="as-bild modelle"></span></button>
      </div>
      <p class="hint">Warum nicht einfach mitgeliefert? Modelle und Icons gehören Coffee Stain Studios und dürfen nicht weitergegeben werden – sie kommen deshalb aus deiner eigenen Spielinstallation. Umschalten geht später jederzeit mit dem Knopf „Modelle“ in der 3D-Ansicht.</p>`;
    el.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { this.wahl.modelle3d = b.dataset.m; this.zeichnen(); }));
  }

  // ------------------------------------------------------------ 5. FModel
  async s_fmodel(el) {
    clearTimeout(this.jobTimer);
    el.innerHTML = '<p class="muted">Prüfe …</p>';
    let m; try { m = await get('einrichtung/modelle'); } catch (e) { el.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    const fertig = m.modelle && m.icons > 100;
    el.innerHTML = `<h3>Spielmodelle aus deinem Spiel holen</h3>
      ${fertig ? `<p><span class="st-ok">✓</span> 3D-Modelle und ${m.icons} Icons sind bereits vorhanden. Du kannst diesen Schritt überspringen – nach einem großen Spiel-Update hier einfach neu holen.</p>` : ''}
      ${this.autoBox(m)}
      <details class="as-manuell"${m.windows ? '' : ' open'}><summary>Manuell mit FModel (falls die Automatik nicht klappt)</summary>
        <p>Fünf Schritte – die App erledigt Download und Umrechnung, du klickst in FModel nur die Exporte an. Jeder Wert hat einen <b>Kopieren</b>-Knopf.</p>${this.fmodelSchritte(m)}</details>`;
    el.querySelectorAll('[data-kopie]').forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.kopie); b.textContent = 'Kopiert ✓'; setTimeout(() => { b.textContent = 'Kopieren'; }, 1500); } catch { this.app.toast('Kopieren nicht möglich – bitte markieren und Strg+C.', 'err'); }
    }));
    el.querySelectorAll('[data-akt]').forEach((b) => b.addEventListener('click', async () => {
      const alt = b.textContent; b.disabled = true; b.textContent = 'Läuft …';
      try {
        const r = await post('einrichtung/aktion', { aktion: b.dataset.akt });
        this.app.toast(r.text, 'ok');
        if (b.dataset.akt !== 'fmodelStarten') { const aus = r.ausgabe; await this.s_fmodel(el); if (aus) { $('as-ausgabe').hidden = false; $('as-ausgabe').textContent = aus; } } else { b.disabled = false; b.textContent = alt; }
      } catch (e) { this.app.toast(e.message, 'err'); b.disabled = false; b.textContent = alt; }
    }));
    el.querySelector('[data-neu]')?.addEventListener('click', () => this.s_fmodel(el));
    el.querySelector('#as-auto-los')?.addEventListener('click', async () => {
      try { await post('einrichtung/job', { art: 'automatisch' }); } catch (e) { this.app.toast(e.message, 'err'); return; }
      this.jobVerfolgen(el);
    });
    if (m.job?.laeuft || m.job?.ok === false) this.jobVerfolgen(el, m.job);
  }

  autoBox(m) {
    const st = (ok, ja, nein) => `<span class="${ok ? 'st-ok' : 'st-nein'}">${ok ? '✓' : '○'}</span> ${ok ? ja : nein}`;
    if (!m.windows) return `<div class="as-auto"><h4>Automatisch</h4><p class="muted">Die Automatik ist für Windows gedacht. Auf diesem System bitte das .NET 10 SDK selbst installieren oder FModel verwenden.</p></div>`;
    return `<div class="as-auto" id="as-auto">
      <h4>Automatisch (empfohlen)</h4>
      <p>Die App holt Bauteil-Daten, 3D-Modelle und Icons selbst aus deiner Satisfactory-Installation – ohne FModel. Beim ersten Mal installiert sie dazu das kostenlose <b>.NET 10 SDK</b> von Microsoft (Windows fragt evtl. nach Erlaubnis) und baut ein kleines Hilfsprogramm. Dauer einmalig ca. 5–15 Minuten, danach deutlich schneller.</p>
      <ul class="as-pruef"><li>${st(m.sdk, '.NET 10 SDK installiert', '.NET 10 SDK wird bei Bedarf installiert')}</li><li>${st(m.extraktorGebaut, 'Hilfsprogramm gebaut', 'Hilfsprogramm wird beim ersten Mal gebaut')}</li><li>Spielordner: <code data-no-i18n>${esc(m.gameDir || '–')}</code></li></ul>
      <div class="as-auto-reihe"><button type="button" class="btn primary" id="as-auto-los">${m.modelle ? 'Modelle neu holen' : 'Modelle automatisch holen'}</button><span class="muted" id="as-auto-schritt"></span><span class="muted" id="as-auto-zahl" data-no-i18n></span></div>
      <div class="as-balken" id="as-balken" hidden><i></i></div>
      <pre class="as-ausgabe" id="as-auto-log" hidden data-no-i18n></pre>
    </div>`;
  }

  async jobVerfolgen(el, start) {
    clearTimeout(this.jobTimer);
    const los = $('as-auto-los'), schritt = $('as-auto-schritt'), balken = $('as-balken'), logEl = $('as-auto-log');
    if (!los) return;
    const zeigen = (j) => {
      los.disabled = !!j.laeuft;
      logEl.hidden = !(j.log?.length); logEl.textContent = (j.log || []).join('\n'); logEl.scrollTop = logEl.scrollHeight;
      if (j.laeuft) {
        schritt.textContent = `Schritt ${j.nr}/${j.von}: ${j.schritt}`;
        balken.hidden = false; balken.classList.toggle('unbestimmt', !j.fortschritt);
        balken.firstElementChild.style.width = j.fortschritt ? `${Math.round(100 * j.fortschritt[0] / Math.max(1, j.fortschritt[1]))}%` : '';
        $('as-auto-zahl').textContent = j.fortschritt ? `${j.fortschritt[0]} / ${j.fortschritt[1]}` : '';
      } else {
        balken.hidden = true; $('as-auto-zahl').textContent = '';
        schritt.innerHTML = j.ok ? `<span class="st-ok">✓</span> ${esc(j.text)}` : j.ok === false ? `<span class="err">${esc(j.text)}</span>` : '';
      }
    };
    if (start) zeigen(start);
    const runde = async () => {
      let j; try { j = await get('einrichtung/job'); } catch { this.jobTimer = setTimeout(runde, 2000); return; }
      if (!$('as-auto-log')) return; // Schritt verlassen
      zeigen(j);
      if (j.laeuft) { this.jobTimer = setTimeout(runde, 1000); return; }
      if (j.ok) {
        this.app.toast(j.text, 'ok');
        try { this.app.cfg = await get('config'); this.wahl.modelle3d = 'modelle'; await post('config', { modelle3d: 'modelle' }); } catch { /* egal */ }
        this.modelleGeholt = true;
        const log = logEl.textContent; await this.s_fmodel(el);
        const l2 = $('as-auto-log'); if (l2) { l2.hidden = false; l2.textContent = log; l2.scrollTop = l2.scrollHeight; }
        const s2 = $('as-auto-schritt'); if (s2) s2.innerHTML = `<span class="st-ok">✓</span> ${esc(j.text)}`;
      }
    };
    runde();
  }
  fmodelSchritte(m) {
    const k = (wert) => `<span class="as-kopie"><code>${esc(wert)}</code><button type="button" class="btn small" data-kopie="${esc(wert)}">Kopieren</button></span>`;
    const st = (ok, ja, nein) => `<span class="${ok ? 'st-ok' : 'st-nein'}">${ok ? '✓' : '○'}</span> ${ok ? ja : nein}`;
    const ex = m.exportDa;
    return `<ol class="as-schritte">
      <li><b>.NET-Desktop-Laufzeit 10</b> (braucht FModel): ${m.windows ? st(m.dotnet, 'installiert', 'fehlt') + (m.dotnet ? '' : ' <button type="button" class="btn small primary" data-akt="dotnet">Installieren</button>') : 'nur unter Windows'}</li>
      <li><b>FModel</b>: ${st(!!m.fmodel, esc(m.fmodel || ''), 'noch nicht heruntergeladen')} ${m.fmodel ? '<button type="button" class="btn small" data-akt="fmodelStarten">FModel starten</button>' : '<button type="button" class="btn small primary" data-akt="fmodel">Herunterladen</button>'}</li>
      <li><b>In FModel einrichten</b> (einmalig, beim ersten Start):
        <ol>
          <li>Fenster „Directory Selector“: <i>Add undetected game</i> → Name ${k('Satisfactory')} Ordner ${k(m.gameDir)} → blaues <b>+</b> → <b>OK</b></li>
          <li>UE-Version: ${k('GAME_UE5_6')} <span class="muted">(Satisfactory 1.2 – bei einer anderen Spielversion die passende wählen)</span></li>
          <li>Menü <i>Settings → General</i>: <i>Output Directory</i> ${k(m.fmodelDir + '\\Output')} · <i>Keep Directory Structure</i> an · <i>Local Mapping File</i> an ${k(m.usmap)}</li>
          <li><i>Settings → Models</i>: <i>Mesh Format</i> = <b>glTF 2.0 (binary)</b> · <i>Texture Format</i> = <b>PNG</b> → <b>OK</b></li>
          <li>Reiter <i>Archives</i> → <b>Load</b></li>
        </ol></li>
      <li><b>Exportieren</b> – Menü <i>Packages → Search</i> (<kbd>Strg</kbd>+<kbd>Umschalt</kbd>+<kbd>F</kbd>), rechts im Suchfeld das <b>Regex</b>-Symbol einschalten:
        <ol>
          <li>Bauteil-Daten: ${k(REGEX.props)} → <kbd>Enter</kbd> → ersten Treffer anklicken, <kbd>Strg</kbd>+<kbd>A</kbd> → Rechtsklick → <i>Export → Properties (json)</i></li>
          <li>3D-Modelle: ${k(REGEX.modelle)} → alle markieren → Rechtsklick → <i>Export → Model</i></li>
          <li>Icons (Regex <b>aus</b>): ${k(REGEX.icons)} → alle markieren → Rechtsklick → <i>Export → Texture</i></li>
          <li>Unten rechts erscheint eine <b>Warteschlange</b> (gelb) → anklicken → <b>Export</b>. Warten, bis der Zähler fertig ist.</li>
        </ol>
        <div class="as-status">Im Export-Ordner ${k(m.export)}: ${ex.json} Bauteil-Daten · ${ex.glb} Modelle · ${ex.icons} Icons <button type="button" class="linkbtn" data-neu="1">neu zählen</button></div></li>
      <li><b>In die App übernehmen</b>: ${st(m.modelle, 'Modelle vorhanden', 'noch nicht übernommen')} · ${m.icons} Icons
        <button type="button" class="btn small primary" data-akt="uebernehmen" ${ex.glb || ex.json || ex.icons ? '' : 'disabled title="Erst in FModel exportieren"'}>Übernehmen</button></li>
    </ol>
    <pre class="as-ausgabe" id="as-ausgabe" hidden></pre>`;
  }

  // ------------------------------------------------------------ 6. Extras
  async s_extras(el) {
    el.innerHTML = '<p class="muted">Prüfe …</p>';
    let j; try { j = await get('einrichtung'); } catch (e) { el.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    const zeig = j.liste.filter((x) => ['kartenbild', 'verknuepfung', 'browser', 'node'].includes(x.id));
    el.innerHTML = `<h3>Extras</h3><p>Alles freiwillig – ein Klick lädt bzw. legt an.</p>
      <div class="ein-liste">${zeig.map((x) => `<div class="ein-row ${x.status}"><span class="ein-st">${x.status === 'ok' ? '✓' : x.status === 'fehler' ? '✕' : '!'}</span>
        <div class="ein-txt"><b>${esc(x.titel)}</b><div class="m">${esc(x.text)}</div></div>
        <div class="ein-act">${x.aktion ? `<button type="button" class="btn small${x.status === 'ok' ? '' : ' primary'}" data-akt="${x.aktion}">${esc(x.aktionText)}</button>` : ''}</div></div>`).join('')}</div>
      <p class="hint">Kartenbild: Hintergrund der Weltkarte und der Welt-Ansicht (von GitHub).</p>`;
    el.querySelectorAll('[data-akt]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'Läuft …';
      try { const r = await post('einrichtung/aktion', { aktion: b.dataset.akt }); this.app.toast(r.text, 'ok'); } catch (e) { this.app.toast(e.message, 'err'); }
      this.s_extras(el);
    }));
  }

  // ------------------------------------------------------------ 7. Fertig
  async s_fertig(el) {
    let j = null; try { j = await get('einrichtung'); } catch { /* */ }
    const zeile = (ok, t) => `<li><span class="${ok ? 'st-ok' : 'st-nein'}">${ok ? '✓' : '○'}</span> ${t}</li>`;
    const L = j?.liste || [];
    const st = (id) => L.find((x) => x.id === id)?.status === 'ok';
    el.innerHTML = `<h3>Fertig eingerichtet</h3><ul class="as-summe">
      ${zeile(st('saves'), 'Spielstand-Ordner')}${zeile(st('spiel'), 'Spieldaten (Katalog)')}
      ${zeile(true, `3D-Darstellung: ${this.wahl.modelle3d === 'modelle' ? 'echte Spielmodelle' + (st('modelle') ? '' : ' (noch nicht übernommen – geht später im Assistenten)') : 'einfache Kästen'}`)}
      ${zeile(st('kartenbild'), 'Kartenbild')}</ul>
      <p>Tipps: Links eine Blaupause öffnen, unten einsortieren, mit <b>Hilfe</b> oben alles nachlesen. Diesen Assistenten findest du wieder unter <b>Einstellungen → Einrichtungs-Assistent</b>.</p>`;
  }
}
