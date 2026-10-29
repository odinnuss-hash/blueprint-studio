// Blueprint Studio – Oberflaeche
import { buildScene, computeGeometry, computeLevels, sortScene, sceneBounds, rotateZ, yawOf, newObj, setCls, qRot } from './scene.js';
import { FORMEN, generate, teileFuer, teilLabel, tauschVarianten } from './generator.js';
import { View2D } from './view2d.js';
import { View3D } from './view3d.js';
import { View3DGL } from './view3dgl.js';
import { Ordnen } from './ordnen.js';
import { Startseite } from './startseite.js';
import { Karte } from './karte.js';
import { AblageUI } from './ablage.js';
import { EinrichtungUI } from './einrichtung.js';
import { PapierkorbUI } from './papierkorb.js';
import { materialCheck } from './material.js';
import { StrukturUI } from './struktur.js';
import { AssistentUI } from './assistent.js';
import { UpdateUI } from './update.js';
import { PlanerUI } from './planer.js';
import { Tour } from './tour.js';
import { SymbolUI } from './symbole.js';
import { selectMitBildern, bauteilBild } from './bildwahl.js';
import { i18nStart, SPRACHEN, t, aktuelleSprache } from './i18n.js';
// Kompass: 8 Richtungen je Sprache (N, NO, O, SO, S, SW, W, NW)
const RICHTUNGEN = { de: ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'], en: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], fr: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'], ja: ['北', '北東', '東', '南東', '南', '南西', '西', '北西'] };
import { Katalog, tileHtml, dims, powerText, extraText, fmt, ICONS } from './katalog.js';
import { frage, ungespeichert, auswahl, eingabe } from './dialog.js';
import { gebietAn } from './gebiete.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const m1 = (cm) => (Math.round(cm / 10) / 10).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

async function api(path, body) {
  const opt = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bs': '1' }, body: JSON.stringify(body) };
  const r = await fetch('/api/' + path, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.fehler || `Fehler ${r.status}`);
  return j;
}

// W/A/S/D: [vor, seitlich] (e.code = Tastenposition, unabhängig vom Tastaturlayout)
const FAHR = { KeyW: [1, 0], KeyS: [-1, 0], KeyA: [0, -1], KeyD: [0, 1] };
// Abgelöstes Ablage-Fenster (Welt): gleiche Seite mit ?fenster=ablage – zeigt nur die Ablage-Kacheln und meldet die Wahl über diesen Kanal
const NUR_ABLAGE = new URLSearchParams(location.search).get('fenster') === 'ablage';
const ABLAGE_KANAL = 'bs-ablage-wahl';
const APP_VERSION = '1.7.1'; // muss zur Server-Version passen – sonst laeuft noch ein alter Server

class App {
  constructor() {
    this.sel = new Set(); this.level = -1; this.snap = 100; this.zRef = 0;
    this.scene = null; this.bp = null; this.kat = null; this.mode = '2d';
    this.listSel = new Set(); this.listAnker = null; // Mehrfachauswahl in der Blaupausen-Liste (Strg/Umschalt)
    this.undoStack = []; this.redoStack = []; this.nextNew = -1; this.availCache = new Map(); this.avail = {};
    this.view2d = new View2D($('cv'), this);
    this.view3d = null;
    if (View3DGL.supported()) { try { this.view3d = new View3DGL($('cv3'), this); this.gl3d = true; } catch (e) { console.warn('WebGL:', e); } }
    if (!this.view3d) this.view3d = new View3D($('cv'), this);
    this.view = this.view2d; this.view.attach();
    this.katalog = new Katalog(this);
    this.ordnen = new Ordnen(this);
    this.karte = new Karte(this);
    this.ablage = new AblageUI(this);
    this.ablage.init();
    this.einrichtung = new EinrichtungUI(this);
    this.papierkorb = new PapierkorbUI(this);
    this.struktur = new StrukturUI(this);
    this.assistent = new AssistentUI(this);
    this.update = new UpdateUI(this);
    this.planer = new PlanerUI(this);
    this.tour = new Tour(this);
    this.symbole = new SymbolUI(this);
    this.bindUi();
    if (!NUR_ABLAGE) this.startseite = new Startseite(this);
    new ResizeObserver(() => this.render()).observe($('canvaswrap'));
    setInterval(() => fetch('/api/heartbeat', { method: 'POST', headers: { 'x-bs': '1' } }).catch(() => {}), 5000);
    fetch('/api/heartbeat', { method: 'POST', headers: { 'x-bs': '1' } }).catch(() => {});
    // Fenster geschlossen → Server beendet sich gleich mit (sendBeacon kommt auch beim Schließen noch an)
    const abmelden = () => { try { navigator.sendBeacon('/api/fenster-zu', ''); } catch { /* egal */ } };
    if (!NUR_ABLAGE) { window.addEventListener('pagehide', abmelden); window.addEventListener('beforeunload', abmelden); }
    this.init();
  }

  async init() {
    try {
      this.cfg = await api('config');
      if (this.cfg.version !== APP_VERSION) { await this.updateNeustart(); return; }
      this.spendenZeigen();
      if (!this.i18nAn) { this.i18nAn = true; await i18nStart(this.cfg.sprache); }
      if (NUR_ABLAGE) this.einrichtungGeprueft = true;
      if (!this.einrichtungGeprueft) { this.einrichtungGeprueft = true; this.einrichtung.beimStart(); if (this.cfg.updatePruefen !== false) setTimeout(() => this.update.pruefen({ still: true }), 4000); }
      $('st-version').textContent = `Blueprint Studio ${this.cfg.version} · © 2026 ODINnuss`;
      ICONS.clear(); for (const f of this.cfg.icons || []) ICONS.add(f);
      this.fillSessions();
      this.ablageLayout();
      this.modellWahlAnwenden();
      this.startseite?.starten();
      if (!this.cfg.blueprintDirOk) this.toast('Kein Blaupausen-Ordner gefunden – bitte in den Einstellungen prüfen.', 'err');
    } catch (e) { this.toast('Server nicht erreichbar: ' + e.message, 'err'); }
    // Ablage-Fenster: Katalog wird für die 3D-Vorschau der Kacheln gebraucht (kacheln3d.js)
    if (NUR_ABLAGE) { try { this.kat = await api('katalog'); } catch (e) { this.toast(e.message, 'err'); } this.nurAblageStart(); return; }
    try { this.kat = await api('katalog'); this.katalog.setData(this.kat); if (this.area === 'planer') this.planer.show(); if (this.bp) this.openScene(); this.initGenerator(); }
    catch (e) { this.toast(e.message, 'err'); }
  }

  /** Abgelöstes Ablage-Fenster: Kacheln im Auswahl-Modus, Klick → Hauptfenster (Welt) */
  nurAblageStart() {
    if (this.nurAblageLaeuft) return;
    this.nurAblageLaeuft = true;
    document.body.classList.add('nur-ablage');
    document.title = 'Ablage – Blueprint Studio';
    this.ablage.offenLassen = true; // eigenes Fenster: nach der Wahl offen bleiben für die nächste
    const kanal = new BroadcastChannel(ABLAGE_KANAL);
    this.ablage.grossesFenster((q) => {
      kanal.postMessage({ art: 'setzen', q: { ablage: q.ablage, session: q.session, name: q.name } });
      this.toast(`„${q.name}“ an die Welt übergeben – dort in die Ansicht zeigen und klicken.`, 'ok');
      try { window.opener?.focus(); } catch { /* anderes Fenster */ }
    });
    // Esc schließt hier nicht das Fenster-Innere; geschlossen wird über das Fenster selbst
    $('dlg-ablage').addEventListener('cancel', (e) => e.preventDefault());
  }

  /** Oberflaeche ist neuer als der laufende Server (Update eingespielt, App nicht neu gestartet) */
  /** Spiel-Sitzung fuer Aktionen, die das Spiel betreffen (Bibliotheks-Ordner zaehlen nicht) */
  spielSession() {
    const S = (this.cfg.spielSitzungen || []).map((x) => x.name);
    if (S.includes(this.cfg.spielSitzung)) return this.cfg.spielSitzung;
    const v = $('session').value;
    if (S.includes(v)) return v;
    if (S.includes(this.letzteSpielSession)) return this.letzteSpielSession;
    return S[0] || '';
  }
  istSpielstand(name) { return (this.cfg.spielSitzungen || []).some((x) => x.name === name); }
  /** Spielstand für „Ins Spiel holen“: aus den Einstellungen – sonst nachfragen (mit „merken“) */
  async zielSitzung() {
    const S = this.cfg.spielSitzungen || [];
    if (S.some((x) => x.name === this.cfg.spielSitzung)) return this.cfg.spielSitzung;
    if (!S.length) { this.toast('Keine Spielstände gefunden – bitte in den Einstellungen den Spielstand-Ordner prüfen.', 'err'); return null; }
    const datum = (t) => new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const r = await auswahl({
      titel: 'In welchen Spielstand?', text: 'Das Spiel zeigt Blaupausen nur in dem Spielstand, in dessen Blaupausen-Ordner sie liegen.',
      optionen: S.map((x) => ({ wert: x.name, text: x.name, info: `zuletzt gespielt ${datum(x.zuletzt)} · ${x.blaupausen} Blaupausen` })),
      vorwahl: this.letzteZiel || S[0].name, merken: 'Als Standard merken (änderbar in den Einstellungen)', ok: 'Ins Spiel holen',
    });
    if (!r) return null;
    this.letzteZiel = r.wert;
    if (r.merken) { try { await api('config', { spielSitzung: r.wert }); this.cfg.spielSitzung = r.wert; } catch { /* egal */ } }
    return r.wert;
  }

  /** Spenden-Link oben rechts zeigen, wenn der Herausgeber einen gesetzt hat (app/update.json) */
  spendenZeigen() { const a = $('btn-spenden'); if (!a) return; a.hidden = !this.cfg?.spenden; if (this.cfg?.spenden) a.href = this.cfg.spenden; }
  async updateNeustart() {
    this.toast(`Update auf ${APP_VERSION} erkannt – der Server wird neu gestartet …`, 'ok');
    try {
      const r = await fetch('/api/neustart', { method: 'POST', headers: { 'X-BS': '1' } });
      if (!r.ok) throw new Error(r.status);
      for (let i = 0; i < 20; i++) {
        await new Promise((res) => setTimeout(res, 700));
        try { const j = await (await fetch('/api/ping', { cache: 'no-store' })).json(); if (j.version === APP_VERSION) { location.reload(); return; } } catch { /* startet noch */ }
      }
      throw new Error('Zeitüberschreitung');
    } catch {
      this.toast('Bitte Blueprint Studio einmal komplett schließen und neu starten – es läuft noch der alte Server.', 'err');
    }
  }

  // ------------------------------------------------------------ Bibliothek
  fillSessions() {
    this.sessionsZeichnen(localStorageGet('session'));
    this.loadList();
  }
  /** Ordner-Auswahl (mit Anzahl je Ordner) aufbauen; wunsch = Ordner, der gewählt sein soll */
  sessionsZeichnen(wunsch) {
    const s = $('session');
    const last = wunsch;
    const SP = new Set((this.cfg.spielSitzungen || []).map((x) => x.name));
    const istSp = (x) => SP.has(x.name.split('/')[0]);
    const spielAlle = this.cfg.sessions.filter((x) => !x.lib), lib = this.cfg.sessions.filter((x) => x.lib);
    const staende = spielAlle.filter(istSp), spiel = spielAlle.filter((x) => !istSp(x));
    const gruppen = new Map();
    for (const x of lib) { if (!gruppen.has(x.bibliothek)) gruppen.set(x.bibliothek, []); gruppen.get(x.bibliothek).push(x); }
    s.innerHTML = (staende.length ? `<optgroup label="Spielstände (das Spiel liest diese)">${staende.map((x) => `<option value="${esc(x.name)}">${'\u00a0\u00a0'.repeat(x.tiefe || 0)}${esc(x.label || x.name)} (${x.count})</option>`).join('')}</optgroup>` : '')
      + (spiel.length ? `<optgroup label="Weitere Ordner unter blueprints">${spiel.map((x) => `<option value="${esc(x.name)}">${'\u00a0\u00a0'.repeat(x.tiefe || 0)}${esc(x.label || x.name)} (${x.count})</option>`).join('')}</optgroup>` : '')
      + [...gruppen].map(([b, L]) => `<optgroup label="Bibliothek: ${esc(b)}">${L.map((x) => `<option value="${esc(x.name)}">${'\u00a0\u00a0'.repeat(x.tiefe)}${esc(x.label)} (${x.count})</option>`).join('')}</optgroup>`).join('')
      || '<option value="">– keine –</option>';
    if (last && this.cfg.sessions.some((x) => x.name === last)) s.value = last;
  }
  /** Ablage unten oder links, mit Breite/Höhe aus den Einstellungen */
  ablageLayout(vorschau) {
    const c = { ...this.cfg, ...(vorschau || {}) };
    const v = $('view-editor');
    v.classList.toggle('ab-links', c.ablageLage === 'links');
    v.style.setProperty('--ab-breite', (c.ablageBreite || 420) + 'px');
    v.style.setProperty('--ab-hoehe', (c.ablageHoehe || 260) + 'px');
    this.render?.();
  }
  ablageWerteZeigen() {
    $('set-ablage-breite-w').textContent = $('set-ablage-breite').value + ' px';
    $('set-ablage-hoehe-w').textContent = $('set-ablage-hoehe').value + ' px';
  }
  /** Rand der Ablage mit der Maus ziehen */
  ablageGriff() {
    const g = $('ab-griff');
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault(); g.setPointerCapture(e.pointerId); g.classList.add('zieht'); document.body.classList.add('ab-groesse');
      const links = this.cfg.ablageLage === 'links';
      const start = links ? e.clientX : e.clientY;
      const basis = links ? (this.cfg.ablageBreite || 420) : (this.cfg.ablageHoehe || 260);
      const zug = (ev) => {
        const d = (links ? ev.clientX : ev.clientY) - start;
        if (links) this.cfg.ablageBreite = Math.max(220, Math.min(1200, Math.min(window.innerWidth - 500, basis + d)));
        else this.cfg.ablageHoehe = Math.max(120, Math.min(900, Math.min(window.innerHeight - 260, basis - d)));
        this.ablageLayout();
      };
      const los = () => {
        g.removeEventListener('pointermove', zug); g.removeEventListener('pointerup', los); g.removeEventListener('pointercancel', los);
        g.classList.remove('zieht'); document.body.classList.remove('ab-groesse');
        api('config', links ? { ablageBreite: this.cfg.ablageBreite } : { ablageHoehe: this.cfg.ablageHoehe }).catch(() => {});
      };
      g.addEventListener('pointermove', zug); g.addEventListener('pointerup', los); g.addEventListener('pointercancel', los);
    });
    g.addEventListener('dblclick', () => {
      const links = this.cfg.ablageLage === 'links';
      if (links) this.cfg.ablageBreite = 420; else this.cfg.ablageHoehe = 260;
      this.ablageLayout();
      api('config', links ? { ablageBreite: 420 } : { ablageHoehe: 260 }).catch(() => {});
    });
    // Einstellungen: Vorschau beim Schieben
    const vorschau = () => { this.ablageWerteZeigen(); if ($('dlg-settings').open) this.ablageLayout({ ablageLage: document.querySelector('[name=set-ablage-lage]:checked')?.value, ablageBreite: +$('set-ablage-breite').value, ablageHoehe: +$('set-ablage-hoehe').value }); };
    ['set-ablage-breite', 'set-ablage-hoehe'].forEach((id) => $(id).addEventListener('input', vorschau));
    document.querySelectorAll('[name=set-ablage-lage]').forEach((r) => r.addEventListener('change', vorschau));
    $('dlg-settings').addEventListener('close', () => this.ablageLayout()); // Abbrechen = zurück auf gespeicherte Werte
  }
  /** 3D: Kästen oder echte Spielmodelle (Einstellung aus dem Assistenten) */
  modellWahlAnwenden() {
    if (!this.gl3d) return;
    const b = $('t-models'), da = !!this.cfg.modelleVorhanden;
    b.disabled = !da;
    b.title = da ? 'Echte Spielmodelle statt Kästen anzeigen' : 'Keine Spielmodelle vorhanden – im Einrichtungs-Assistenten (Einstellungen) aus dem eigenen Spiel holen';
    const soll = da && this.cfg.modelle3d === 'modelle';
    if (this.modellWahl !== this.cfg.modelle3d || (!da && this.view3d.useModels)) {
      this.modellWahl = this.cfg.modelle3d;
      if (this.view3d.useModels !== soll) this.view3d.setModels(soll);
    }
    b.setAttribute('aria-pressed', String(!!this.view3d.useModels));
  }
  einstellungenStruktur() {
    const S = this.cfg.struktur || [];
    $('set-struktur-info').textContent = `${S.filter(([c]) => !c.includes('_')).length} Hauptgruppen, ${S.filter(([c]) => c.includes('_')).length} Untergruppen`;
  }
  /** Anzahl je Ordner neu einlesen (nach Verschieben, Löschen, Speichern … und wenn das Fenster wieder aktiv wird) */
  async zaehlerAktualisieren() {
    let neu;
    try { neu = await api('sitzungen'); } catch { return; }
    if (!Array.isArray(neu) || !this.cfg) return;
    const alt = this.cfg.sessions || [];
    const gleich = alt.length === neu.length && alt.every((x, i) => x.name === neu[i].name);
    this.cfg.sessions = neu;
    const s = $('session');
    if (gleich) {
      // nur die Zahlen tauschen – Auswahl und offene Liste bleiben unberührt
      const map = new Map(neu.map((x) => [x.name, x]));
      for (const o of s.options) { const x = map.get(o.value); if (x) o.textContent = o.textContent.replace(/\(\d+\)$/, `(${x.count})`); }
    } else {
      const v = s.value;
      this.sessionsZeichnen(v);
      if (s.value !== v) this.loadList();
    }
  }
  async loadList() {
    const session = $('session').value;
    const libEintrag = this.cfg.sessions.find((x) => x.lib && x.name === session);
    if (libEintrag) { const [, ri, rel] = /^lib:(\d+):(.*)$/.exec(session); $('pathtext').textContent = [this.cfg.bibliotheken[+ri], ...(rel ? rel.split('/') : [])].join('\\'); }
    else $('pathtext').textContent = session ? `${this.cfg.blueprintDir}\\${session.replace(/\//g, '\\')}` : this.cfg.blueprintDir;
    if (session && !libEintrag) this.letzteSpielSession = session;
    if (session !== this.listSession) { this.listSel.clear(); this.listAnker = null; this.listSession = session; }
    const nr = (this.ladeNr = (this.ladeNr || 0) + 1);
    const liste = session ? await api('blueprints?session=' + encodeURIComponent(session)).catch(() => []) : [];
    if (nr !== this.ladeNr) return; // inzwischen wurde ein anderer Ordner gewählt – ältere Antwort verwerfen
    this.list = liste;
    const da = new Set(this.list.map((b) => b.name));
    for (const n of [...this.listSel]) if (!da.has(n)) this.listSel.delete(n);
    this.renderList();
    this.zaehlerAktualisieren();
  }
  renderList() {
    const q = $('suche').value.trim().toLowerCase();
    const items = this.list.filter((b) => !q || b.name.toLowerCase().includes(q) || b.beschreibung.toLowerCase().includes(q));
    this.sichtbar = items;
    $('bp-count').textContent = `(${items.length.toLocaleString('de-DE')})`;
    const L = $('bp-list');
    if (!this.listeEingerichtet) {
      this.listeEingerichtet = true;
      // ein Klick-Handler für alle Einträge; weitere Einträge beim Scrollen nachladen (schnell auch bei tausenden Blaupausen)
      L.addEventListener('click', (e) => { const el = e.target.closest('.item[data-name]'); if (el) this.listKlick(el.dataset.name, e); });
      L.addEventListener('scroll', () => { if (L.scrollTop + L.clientHeight > L.scrollHeight - 600) this.listeNachladen(); });
    }
    this.listeGezeigt = 0;
    L.innerHTML = items.length ? '' : '<div class="muted">Keine Blaupausen gefunden.</div>';
    // geöffnete Blaupause soll sichtbar sein: so weit laden, dass sie drin ist
    const cur = this.bp && this.bp.name, ci = cur ? items.findIndex((b) => b.name === cur) : -1;
    this.listeNachladen(Math.max(300, ci + 50));
    this.markierungZeigen();
  }
  listeNachladen(bis) {
    const items = this.sichtbar || [], L = $('bp-list');
    const ende = Math.min(items.length, bis || this.listeGezeigt + 300);
    if (ende <= this.listeGezeigt) return;
    const cur = this.bp && this.bp.name;
    L.insertAdjacentHTML('beforeend', items.slice(this.listeGezeigt, ende).map((b) => {
      const c = b.farbe ? `rgb(${b.farbe.slice(0, 3).map((v) => Math.round(Math.pow(Math.max(0, v), 1 / 2.2) * 255)).join(',')})` : '#444';
      return `<button type="button" class="item row${b.name === cur ? ' on' : ''}${this.listSel.has(b.name) ? ' mark' : ''}" draggable="true" title="Klick: öffnen · Strg+Klick: dazu markieren · Umschalt+Klick: Bereich markieren · Ziehen auf einen Ablage-Ordner: ablegen · Rechtsklick: löschen" data-name="${esc(b.name)}"><span class="swatch" style="background:${c}"></span>
        <span style="display:flex;flex-direction:column;gap:2px;min-width:0"><span class="n">${esc(b.name)}</span>
        <span class="m">${(b.size / 1024).toLocaleString('de-DE', { maximumFractionDigits: 0 })} KB · ${new Date(b.mtime).toLocaleDateString('de-DE')}${b.beschreibung ? ' · ' + esc(b.beschreibung.split('\n')[0].slice(0, 40)) : ''}</span></span></button>`;
    }).join(''));
    this.listeGezeigt = ende;
  }
  /** Sichtbare Namen der Liste (gefiltert, auch noch nicht nachgeladene) in Anzeige-Reihenfolge */
  listNamen() { return (this.sichtbar || []).map((b) => b.name); }
  /** Markierte Blaupausen (in Listen-Reihenfolge) */
  markierte() { const s = this.listSel; return this.listNamen().filter((n) => s.has(n)); }
  listKlick(name, e) {
    const ctrl = e.ctrlKey || e.metaKey;
    const namen = this.listNamen();
    if (e.shiftKey && this.listAnker && namen.includes(this.listAnker)) {
      const a = namen.indexOf(this.listAnker), b = namen.indexOf(name);
      if (!ctrl) this.listSel.clear();
      namen.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((n) => this.listSel.add(n));
      this.markierungZeigen(); return;
    }
    if (ctrl || e.shiftKey) {
      // die gerade geoeffnete Blaupause zaehlt beim ersten Strg-Klick mit
      if (!this.listSel.size && this.bp && !this.bp.ablage && namen.includes(this.bp.name)) this.listSel.add(this.bp.name);
      if (this.listSel.has(name)) this.listSel.delete(name); else this.listSel.add(name);
      this.listAnker = name; this.markierungZeigen(); return;
    }
    this.listSel = new Set([name]); this.listAnker = name; this.markierungZeigen();
    this.openBlueprint(name);
  }
  listAuswahl(namen) { this.listSel = new Set(namen); this.markierungZeigen(); }
  markierungZeigen() {
    $('bp-list').querySelectorAll('.item[data-name]').forEach((el) => el.classList.toggle('mark', this.listSel.has(el.dataset.name)));
    const n = this.markierte().length;
    const sichtbar = (this.sichtbar || []).length.toLocaleString('de-DE');
    $('bp-count').textContent = n > 1 ? `(${sichtbar} · ${n} markiert)` : `(${sichtbar})`;
    $('bp-multi').hidden = n < 2;
    if (n > 1) { $('bp-multi-text').textContent = `${n} markiert`; $('bp-multi').title = 'Markierte zusammen auf einen Ablage-Ordner ziehen · Rechtsklick oder Entf: löschen · Esc: Markierung aufheben'; }
  }

  async openBlueprint(name) {
    if (this.dirty() && !(await ungespeichert('Trotzdem eine andere Blaupause öffnen?'))) return;
    const session = $('session').value;
    $('loading').hidden = false;
    try {
      this.bp = await api(`blueprint?session=${encodeURIComponent(session)}&name=${encodeURIComponent(name)}`);
      localStorageSet('session', session);
      this.openScene();
    } catch (e) { this.toast('Konnte nicht geöffnet werden: ' + e.message, 'err'); }
    finally { $('loading').hidden = true; }
  }
  openScene() {
    this.scene = buildScene(this.bp, this.kat);
    this.scene.bounds = sceneBounds(this.scene);
    this.zRef = this.scene.bounds ? this.scene.bounds.z0 : 0;
    this.sel = new Set(); this.undoStack = []; this.redoStack = [];
    this.level = -1;
    const soll = this.startAnsicht();
    if (soll !== this.mode) this.setView(soll, false);
    this.view3d.fitted = this.mode === '3d';
    $('empty').hidden = true;
    this.renderLevels(); this.updateHidden(); this.renderList(); this.renderParts(); this.updateStatus(); this.renderInspector(); this.renderCosts();
    this.fit();
    if (this.kat) this.katalog.renderCards();
    $('gen-insert').disabled = false;
    if (this.kat) this.refreshAvail();
    this.ablage.zeigeVorschlag();
  }

  // ------------------------------------------------------------ Vorlagen (welche Bauteile erzeugt/getauscht werden koennen)
  async availFor(ver) {
    const key = String(ver || 'basis');
    if (!this.availCache.has(key)) {
      this.availCache.set(key, api('vorlagen' + (ver ? '?version=' + ver : '')).then((r) => { this.basisVersion = r.basisVersion; return r.verfuegbar; })
        .catch((e) => { this.availCache.delete(key); this.toast('Vorlagen: ' + e.message, 'err'); return {}; }));
    }
    return this.availCache.get(key);
  }
  async refreshAvail() {
    const ver = this.bp && !this.bp.neu ? this.bp.kopf.saveVersion : null;
    this.avail = await this.availFor(ver);
    this.renderInspector();
  }

  // ------------------------------------------------------------ Bauteile-Liste
  classCounts() {
    const c = {};
    if (this.scene) for (const o of this.scene.objs) if (!o.removed) c[o.cls] = (c[o.cls] || 0) + 1;
    return c;
  }
  renderParts() {
    if (!this.scene) { $('parts-list').innerHTML = '<div class="muted">Keine Blaupause geöffnet.</div>'; return; }
    const q = $('parts-suche').value.trim().toLowerCase();
    const counts = this.classCounts();
    const rows = Object.entries(counts).map(([cls, n]) => ({ cls, n, g: this.kat?.gebaeude?.[cls], name: this.kat?.gebaeude?.[cls]?.name || cls }))
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.cls.toLowerCase().includes(q))
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'de'));
    $('parts-list').innerHTML = rows.map((r) => `<button type="button" class="item row" data-cls="${esc(r.cls)}">${tileHtml(r.g, r.cls)}
      <span style="display:flex;flex-direction:column;gap:2px;min-width:0"><span class="n">${esc(r.name)}</span><span class="m">${r.n}× · ${esc(r.g ? r.g.unterkategorie || r.g.kategorie : 'unbekannt')}</span></span></button>`).join('');
    $('parts-list').querySelectorAll('.item').forEach((el) => el.addEventListener('click', (e) => this.selectClass(el.dataset.cls, false, e.shiftKey)));
  }
  selectClass(cls, switchView, add) {
    const ids = this.scene.objs.filter((o) => !o.removed && o.cls === cls).map((o) => o.i);
    this.setSel(add ? [...this.sel, ...ids] : ids);
    if (switchView) this.setMode('editor');
  }

  // ------------------------------------------------------------ Ebenen
  renderLevels() {
    const L = this.scene?.levels || [];
    const el = $('levels');
    el.hidden = L.length < 2;
    const cur = this.level, n = L.length;
    const kurz = n > 10;
    const btn = (k) => `<button type="button" class="seg${kurz ? ' num' : ''}${cur === k ? ' on' : ''}" data-l="${k}" aria-pressed="${cur === k}" aria-label="Ebene ${k + 1}" title="Ebene ${k + 1} · Fundamenthöhe ${m1(L[k])} m">${kurz ? k + 1 : 'Ebene ' + (k + 1)}</button>`;
    const gap = '<span class="seg gap" aria-hidden="true">…</span>';
    let html = '';
    if (n <= 10) html = L.map((_, k) => btn(k)).join('');
    else {
      // kompakt: erste · Fenster um die aktuelle (±5) · letzte
      const c = cur < 0 ? 0 : cur;
      const a = Math.max(1, c - 5), b = Math.min(n - 2, c + 5);
      html = `<span class="seg gap lvlabel">Ebene</span><button type="button" class="seg nav" data-step="-1" title="Ebene tiefer" aria-label="Ebene tiefer"${cur <= 0 ? ' disabled' : ''}>‹</button>` + btn(0) + (a > 1 ? gap : '');
      for (let k = a; k <= b; k++) html += btn(k);
      html += (b < n - 2 ? gap : '') + btn(n - 1)
        + `<button type="button" class="seg nav" data-step="1" title="Ebene höher" aria-label="Ebene höher"${cur >= n - 1 ? ' disabled' : ''}>›</button>`
        + `<select class="lvsel" aria-label="Ebene wählen"><option value="">Ebene …</option>${L.map((z, k) => `<option value="${k}"${cur === k ? ' selected' : ''}>Ebene ${k + 1} (${m1(z)} m)</option>`).join('')}</select>`;
    }
    html += `<button type="button" class="seg${cur < 0 ? ' on' : ''}" data-l="-1" aria-pressed="${cur < 0}">Alle</button>`;
    el.innerHTML = html;
    const go = (k) => { this.level = k; this.renderLevels(); this.updateStatus(); this.render(); };
    el.querySelectorAll('.seg[data-l]').forEach((b) => b.addEventListener('click', () => go(+b.dataset.l)));
    el.querySelectorAll('.seg[data-step]').forEach((b) => b.addEventListener('click', () => go(Math.max(0, Math.min(n - 1, (cur < 0 ? 0 : cur) + +b.dataset.step)))));
    el.querySelector('.lvsel')?.addEventListener('change', (e) => { if (e.target.value !== '') go(+e.target.value); });
  }

  // ------------------------------------------------------------ Auswahl
  setSel(ids) { this.sel = new Set(ids); this.afterSel(); }
  toggleSel(i) { if (this.sel.has(i)) this.sel.delete(i); else this.sel.add(i); this.afterSel(); }
  afterSel() { this.renderInspector(); this.updateTools(); this.render(); this.stiftInfo(); }
  /** 3D-Stift ein/aus (frei umranden = auswählen) */
  stiftSetzen(an) {
    if (!this.gl3d) return;
    this.view3d.setStift(an);
    $('t-stift').setAttribute('aria-pressed', String(!!an));
    $('stift-info').hidden = !an;
    this.stiftInfo();
  }
  stiftInfo() {
    const b = $('stift-del'); if (!b) return;
    const n = this.sel.size;
    b.disabled = !n || !!this.bp?.nurAnsicht;
    b.textContent = n ? `${n} löschen` : 'Auswahl löschen';
  }

  // ------------------------------------------------------------ Bearbeiten (mit Rueckgaengig)
  snapshot(ids) { return ids.map((i) => { const o = this.scene.byId.get(i); return [i, o.p.slice(), o.q.slice(), o.removed, o.cls]; }); }
  restore(snap) {
    for (const [i, p, q, rem, cls] of snap) {
      const o = this.scene.byId.get(i); o.p = p.slice(); o.q = q.slice(); o.removed = rem;
      if (cls !== o.cls) setCls(o, cls, this.kat); else computeGeometry(o);
    }
  }
  commit(ids, fn, label) {
    const before = this.snapshot(ids);
    fn();
    for (const i of ids) computeGeometry(this.scene.byId.get(i));
    const after = this.snapshot(ids);
    this.undoStack.push({ before, after, label }); this.redoStack = [];
    this.afterEdit();
  }
  afterEdit() {
    sortScene(this.scene); computeLevels(this.scene);
    this.updateStatus(); this.renderInspector(); this.renderParts(); this.renderCosts(); this.updateTools(); this.render();
  }
  undo() { const c = this.undoStack.pop(); if (!c) return; this.restore(c.before); this.redoStack.push(c); this.afterEdit(); this.toast(`Rückgängig: ${c.label}`); }
  redo() { const c = this.redoStack.pop(); if (!c) return; this.restore(c.after); this.undoStack.push(c); this.afterEdit(); this.toast(`Wiederholt: ${c.label}`); }
  selIds() { return [...this.sel].filter((i) => { const o = this.scene.byId.get(i); return o && !o.removed; }); }

  moveSel(dx, dy, dz) {
    const ids = this.selIds(); if (!ids.length) return;
    this.commit(ids, () => { for (const i of ids) { const o = this.scene.byId.get(i); o.p = [o.p[0] + dx, o.p[1] + dy, o.p[2] + dz]; } },
      `${ids.length} Objekt(e) verschoben`);
  }
  rotateSel(deg) {
    const ids = this.selIds(); if (!ids.length) return;
    let cx = 0, cy = 0;
    for (const i of ids) { const o = this.scene.byId.get(i); cx += o.p[0]; cy += o.p[1]; }
    cx /= ids.length; cy /= ids.length;
    // Drehpunkt aufs Raster legen, damit Fundamente im Raster bleiben
    const s = Math.min(this.snap, 100); cx = Math.round(cx / s) * s; cy = Math.round(cy / s) * s;
    const a = deg * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
    this.commit(ids, () => {
      for (const i of ids) {
        const o = this.scene.byId.get(i), x = o.p[0] - cx, y = o.p[1] - cy;
        o.p = [cx + x * c - y * sn, cy + x * sn + y * c, o.p[2]].map((v) => Math.round(v * 10) / 10);
        o.q = rotateZ(o.q, deg);
      }
    }, `${ids.length} Objekt(e) um ${deg > 0 ? '+' : ''}${deg}° gedreht`);
  }
  /** Auswahl (oder alles) um X/Y/Z drehen; mit „auf Boden“ bleibt die Unterkante gleich */
  rotateAxis(axis, deg, alle, boden = true) {
    const ids = alle || !this.sel.size ? this.alleIds() : this.selIds();
    if (!ids.length) return;
    const { c, z0 } = this.drehMitte(ids);
    this.commit(ids, () => this.drehKern(ids, axis, deg, c, boden ? z0 : null), `${ids.length} Objekt(e) um ${axis.toUpperCase()} ${deg > 0 ? '+' : ''}${deg}° gedreht`);
    this.scene.bounds = sceneBounds(this.scene);
    if (alle || !this.sel.size) this.fit();
  }
  alleIds() { return this.scene.objs.filter((o) => !o.removed && o.kind !== 'none').map((o) => o.i); }
  /** Drehpunkt (Mitte der Teile, aufs Raster gelegt) und Unterkante */
  drehMitte(ids) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const i of ids) { const o = this.scene.byId.get(i); x0 = Math.min(x0, o.bb[0]); x1 = Math.max(x1, o.bb[2]); y0 = Math.min(y0, o.bb[1]); y1 = Math.max(y1, o.bb[3]); z0 = Math.min(z0, o.zMin); z1 = Math.max(z1, o.zMax); }
    const s = Math.min(this.snap, 100);
    return { c: [Math.round((x0 + x1) / 2 / s) * s, Math.round((y0 + y1) / 2 / s) * s, Math.round((z0 + z1) / 2 / s) * s], z0 };
  }
  /** Teile um Achse x/y/z und Punkt c drehen; boden = Unterkante, auf die danach wieder gesetzt wird (null = nicht) */
  drehKern(ids, axis, deg, c, boden) {
    const h = deg * Math.PI / 360, sn = Math.sin(h);
    const r = axis === 'x' ? [sn, 0, 0, Math.cos(h)] : axis === 'y' ? [0, sn, 0, Math.cos(h)] : [0, 0, sn, Math.cos(h)];
    const mul = (a, b) => { const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b; const q = [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz]; const l = Math.hypot(...q) || 1; return q.map((v) => Math.round((v / l) * 1e6) / 1e6); };
    for (const i of ids) {
      const o = this.scene.byId.get(i);
      const v = qRot(r, [o.p[0] - c[0], o.p[1] - c[1], o.p[2] - c[2]]);
      o.p = [c[0] + v[0], c[1] + v[1], c[2] + v[2]].map((x) => Math.round(x * 10) / 10);
      o.q = mul(r, o.q);
      computeGeometry(o);
    }
    if (boden != null && axis !== 'z') {
      let nz = Infinity; for (const i of ids) nz = Math.min(nz, this.scene.byId.get(i).zMin);
      const dz = Math.round((boden - nz) * 10) / 10;
      if (Math.abs(dz) > 0.05) for (const i of ids) { const o = this.scene.byId.get(i); o.p = [o.p[0], o.p[1], Math.round((o.p[2] + dz) * 10) / 10]; computeGeometry(o); }
    }
  }
  // ------------------------------------------------------------ Mit der Maus drehen/kippen (ganze Blaupause oder Auswahl)
  mausDrehenSetzen(an) {
    this.mausDreh = !!an;
    if (this.mausDreh && this.mode !== '3d') $('v3d').click();
    this.view3d.mausDreh = this.mausDreh; $('t-mausdreh').setAttribute('aria-pressed', this.mausDreh);
    if (this.mausDreh) this.toast('Mit der Maus drehen: links ziehen – waagerecht = drehen, senkrecht = kippen (15°-Schritte, Strg = 1°). Rechte Maustaste = umsehen.');
  }
  /** Zug beginnt: Teile, Drehpunkt und Ausgangslage für ein einziges Rückgängig merken */
  mausDrehStart() {
    if (!this.scene) return false;
    const ids = this.sel.size ? this.selIds() : this.alleIds(); if (!ids.length) return false;
    const { c, z0 } = this.drehMitte(ids);
    this.mausZug = { ids, c, z0, before: this.snapshot(ids), z: 0, k: 0, rz: 0, rk: 0 };
    return true;
  }
  /** dx/dy in Pixeln; achseKippen: 'x' oder 'y' (Achse quer zur Blickrichtung), vz: Vorzeichen */
  mausDrehen(dx, dy, fein, achseKippen, vz) {
    const Z = this.mausZug; if (!Z) return;
    const schritt = fein ? 1 : 15;
    Z.z += dx * 0.5; Z.k += dy * 0.5;
    let n = Math.trunc(Z.z / schritt); if (n) { Z.z -= n * schritt; this.drehKern(Z.ids, 'z', n * schritt, Z.c, null); Z.rz += n * schritt; }
    n = Math.trunc(Z.k / schritt); if (n) { Z.k -= n * schritt; this.drehKern(Z.ids, achseKippen, vz * n * schritt, Z.c, Z.z0); Z.rk += vz * n * schritt; Z.achse = achseKippen; }
    if (Z.rz || Z.rk) { $('st-changes').textContent = `Drehen ${Z.rz > 0 ? '+' : ''}${Z.rz}°${Z.rk ? ` · Kippen um ${Z.achse.toUpperCase()} ${Z.rk > 0 ? '+' : ''}${Z.rk}°` : ''}`; this.render(); }
  }
  mausDrehEnde() {
    const Z = this.mausZug; this.mausZug = null; if (!Z || (!Z.rz && !Z.rk)) return;
    const after = this.snapshot(Z.ids);
    this.undoStack.push({ before: Z.before, after, label: `${Z.ids.length} Objekt(e) mit der Maus gedreht` }); this.redoStack = [];
    this.scene.bounds = sceneBounds(this.scene);
    this.afterEdit();
  }
  openKippen() {
    if (!this.scene) return;
    $('kip-scope').textContent = this.sel.size ? `${this.selIds().length} ausgewählte Objekte` : 'die ganze Blaupause (nichts ausgewählt)';
    $('dlg-kippen').showModal();
  }
  // ------------------------------------------------------------ Ausblenden (nur Ansicht, wird nicht gespeichert)
  hideSel() {
    const ids = this.selIds(); if (!ids.length) return;
    for (const i of ids) this.scene.byId.get(i).hidden = true;
    this.sel = new Set(); this.afterSel(); this.updateHidden();
    this.toast(`${ids.length} Objekt(e) ausgeblendet – „Alle einblenden“ oder Umschalt+H holt sie zurück.`);
  }
  showAll() {
    if (!this.scene) return;
    let n = 0; for (const o of this.scene.objs) if (o.hidden) { o.hidden = false; n++; }
    this.updateHidden(); this.render();
    if (n) this.toast(`${n} Objekt(e) wieder eingeblendet.`);
  }
  isolateSel() {
    const ids = new Set(this.selIds()); if (!ids.size) return;
    for (const o of this.scene.objs) o.hidden = !ids.has(o.i) && !o.removed;
    this.updateHidden(); this.render();
  }
  updateHidden() {
    const n = this.scene ? this.scene.objs.filter((o) => o.hidden && !o.removed).length : 0;
    $('t-showall').hidden = !n; $('t-showall').textContent = `${n} ausgeblendet · alle zeigen`;
    this.updateStatus();
  }
  deleteSel() {
    const ids = this.selIds(); if (!ids.length) return;
    const weg = new Set(ids);
    // Konstruktion bleibt am Boden: fehlt danach das unterste Teil, rutscht alles zusammen nach unten
    let dz = 0; const rest = [];
    if (this.cfg?.nachrutschen !== false) {
      let vorher = Infinity, nachher = Infinity;
      for (const o of this.scene.objs) {
        if (o.removed || o.kind === 'none' || !Number.isFinite(o.zMin)) continue;
        vorher = Math.min(vorher, o.zMin);
        if (!weg.has(o.i)) { nachher = Math.min(nachher, o.zMin); rest.push(o.i); }
      }
      if (Number.isFinite(vorher) && Number.isFinite(nachher) && nachher - vorher > 1) dz = vorher - nachher;
    }
    const label = `${ids.length} Objekt(e) entfernt` + (dz ? `, Rest ${(-dz / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 })} m abgesenkt` : '');
    this.commit(dz ? [...ids, ...rest] : ids, () => {
      for (const i of ids) this.scene.byId.get(i).removed = true;
      if (dz) for (const i of rest) { const o = this.scene.byId.get(i); o.p = [o.p[0], o.p[1], o.p[2] + dz]; }
    }, label);
    this.sel = new Set(); this.afterSel();
    if (dz) this.toast(`${label} – das neue unterste Teil steht wieder am Boden (Strg+Z macht beides rückgängig).`, 'ok');
  }

  changes() {
    const edits = {}, remove = [], swap = {}, add = [], stufe = {};
    if (!this.scene) return { edits, remove, swap, add, stufe, moved: 0, n: 0 };
    let moved = 0;
    for (const o of this.scene.objs) {
      if (o.isNew) { if (!o.removed) add.push({ cls: o.cls, pos: o.p, rot: o.q }); continue; }
      if (o.removed) { remove.push(o.i); continue; }
      if (o.cls !== o.cls0 && this.mkVarianten(o.cls0).includes(o.cls)) {
        stufe[o.i] = o.cls;
        const dp = o.p.some((v, k) => Math.abs(v - o.p0[k]) > 0.05), dq = o.q.some((v, k) => Math.abs(v - o.q0[k]) > 1e-6);
        if (dp || dq) edits[o.i] = { pos: o.p, rot: o.q };
        continue;
      }
      if (o.cls !== o.cls0) { swap[o.i] = { cls: o.cls, pos: o.p, rot: o.q }; continue; }
      const dp = o.p.some((v, k) => Math.abs(v - o.p0[k]) > 0.05), dq = o.q.some((v, k) => Math.abs(v - o.q0[k]) > 1e-6);
      if (dp || dq) { edits[o.i] = { pos: o.p, rot: o.q }; moved++; }
    }
    const nSwap = Object.keys(swap).length + Object.keys(stufe).length;
    const n = this.bp?.neu ? add.length : moved + remove.length + nSwap + add.length;
    return { edits, remove, swap, add, stufe, moved, nSwap, n };
  }
  dirty() { return this.changes().n > 0; }

  // ------------------------------------------------------------ Speichern
  openSave() {
    const c = this.changes();
    const neu = !!this.bp.neu;
    $('save-summary').textContent = neu ? `Neue Blaupause mit ${c.add.length} Bauteilen.`
      : `${c.moved} verschoben/gedreht · ${c.nSwap} getauscht · ${c.add.length} neu · ${c.remove.length} entfernt.`;
    $('save-ow-row').hidden = neu;
    document.querySelector('input[name=mode][value=copy]').checked = true;
    $('save-desc').value = neu ? (this.bp.beschreibung || '') : '';
    const taken = new Set((this.list || []).map((b) => b.name.toLowerCase()));
    const unique = (base) => { let n = base, k = 2; while (taken.has(n.toLowerCase())) n = `${base}_${k++}`; return n; };
    $('save-name').value = unique(neu ? this.bp.name : this.bp.name + '_bearbeitet');
    $('save-error').hidden = true;
    $('dlg-save').showModal();
    $('save-name').focus(); $('save-name').select();
  }
  async doSave() {
    const mode = document.querySelector('input[name=mode]:checked').value;
    const c = this.changes();
    const session = this.bp.session || $('session').value;
    const body = this.bp.neu
      ? { session, newName: $('save-name').value.trim(), add: c.add, beschreibung: $('save-desc').value.trim() }
      : { session, name: this.bp.name, quelleId: this.bp.quelleId || undefined, ablage: this.bp.ablage || undefined, mode, newName: $('save-name').value.trim(), edits: c.edits, remove: c.remove, swap: c.swap, add: c.add, stufe: c.stufe };
    $('save-ok').disabled = true;
    try {
      const r = await api(this.bp.neu ? 'create' : 'save', body);
      if (this.bp.neu) { this.bp = null; if ($('session').value !== session) $('session').value = session; }
      $('dlg-save').close();
      this.toast(mode === 'overwrite' ? `Gespeichert. Sicherung: ${r.sicherung}` : `Als „${r.name}“ gespeichert.`, 'ok');
      const ausOrdnen = !!this.bp?.quelleId;
      this.scene = null; this.bp = null;
      if (ausOrdnen && r.id) { this.ordnen.data = null; await this.openFromOrdnen({ id: r.id }); return; }
      if (r.ablage) { await this.ablage.laden?.(); await this.ablage.ansehen(r.ablage, { name: r.name }); return; } // aus der Ablage: dort bleiben
      await this.loadList();
      await this.openBlueprint(r.name);
    } catch (e) { $('save-error').textContent = e.message; $('save-error').hidden = false; }
    finally { $('save-ok').disabled = false; }
  }

  // ------------------------------------------------------------ Inspektor
  renderInspector() {
    const box = $('insp-body');
    if (!this.scene) { box.className = 'insp-empty'; box.textContent = 'Keine Blaupause geöffnet.'; return; }
    const ids = this.selIds();
    const k = this.kat, iname = (i) => esc(k?.items?.[i]?.name || i);
    if (!ids.length) {
      const counts = {};
      for (const o of this.scene.objs) if (!o.removed && o.g) counts[o.g.kategorie] = (counts[o.g.kategorie] || 0) + 1;
      const b = this.scene.bounds;
      box.className = '';
      box.innerHTML = `<div class="insp-title">${esc(this.bp.name)}</div>
        ${this.bp.beschreibung ? `<div class="insp-sub" style="white-space:pre-line">${esc(this.bp.beschreibung)}</div>` : ''}
        ${/Plan #[0-9a-f]{8}/.test(this.bp.beschreibung || '') ? '<button type="button" class="btn section" id="insp-plan" title="Den Produktionsplan anzeigen, aus dem diese Blaupause erzeugt wurde">Planer-Grundlage ansehen</button>' : ''}
        <div class="section">
          <div class="kv"><span class="k">Objekte</span><span class="v mono">${this.scene.objs.filter((o) => !o.removed).length}</span></div>
          ${b ? `<div class="kv"><span class="k">Ausdehnung</span><span class="v mono">${m1(b.x1 - b.x0)} × ${m1(b.y1 - b.y0)} × ${m1(b.z1 - b.z0)} m</span></div>` : ''}
          <div class="kv"><span class="k">Ebenen</span><span class="v mono">${this.scene.levels.length || 1}</span></div>
          <div class="kv"><span class="k">Spielversion</span><span class="v mono">${esc(this.bp.kopf.engine ? this.bp.kopf.engine.replace('++FactoryGame+', '') : 'Save ' + this.bp.kopf.saveVersion)}</span></div>
        </div>
        <div class="section"><div class="label">Nach Kategorie</div>${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c, n]) => `<div class="typecount"><span>${esc(c)}</span><span class="mono">${n}</span></div>`).join('')}</div>
        <div class="hint section">Objekt anklicken, um Details zu sehen.</div>`;
      $('insp-plan')?.addEventListener('click', () => this.planer.grundlageZeigen(/Plan #([0-9a-f]{8})/.exec(this.bp.beschreibung)[1], this.bp.name));
      return;
    }
    if (ids.length > 1) {
      const counts = {};
      for (const i of ids) { const o = this.scene.byId.get(i); counts[o.name] = (counts[o.name] || 0) + 1; }
      box.className = '';
      box.innerHTML = `<div class="insp-title">${ids.length} Objekte</div><div class="insp-sub">Mehrfachauswahl</div>
        <div class="section">${Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([n, c]) => `<div class="typecount"><span>${esc(n)}</span><span class="mono">${c}×</span></div>`).join('')}</div>
        <div class="hint section">Pfeiltasten / Ziehen: verschieben · Q/E: drehen · Bild ↑/↓: Höhe · Entf: entfernen</div>
        ${this.swapPossible(ids) ? '<button type="button" class="btn section" id="insp-swap">Bauteile tauschen …</button>' : ''}`;
      $('insp-swap')?.addEventListener('click', () => this.openSwap());
      return;
    }
    const o = this.scene.byId.get(ids[0]), g = o.g;
    const rz = o.r && k?.rezepte?.[o.r];
    const yaw = ((yawOf(o.q) % 360) + 360) % 360;
    box.className = '';
    box.innerHTML = `<div style="display:flex;gap:10px;align-items:center">${tileHtml(g, o.cls)}<div><div class="insp-title">${esc(o.name)}</div>
        <div class="insp-sub">${g ? esc(g.kategorie + ' › ' + g.unterkategorie) : 'nicht in den Spieldaten – vermutlich aus einer Mod'}</div></div></div>
      <div class="insp-cls" style="margin-top:4px">${esc(o.cls)}${o.isNew ? '<span class="badge-new">neu</span>' : o.cls !== o.cls0 ? '<span class="badge-new">getauscht</span>' : ' · Nr. ' + o.i}</div>
      <div class="grid3">
        <div class="cell"><div class="k">X (m)</div><div class="v">${m1(o.p[0])}</div></div>
        <div class="cell"><div class="k">Y (m)</div><div class="v">${m1(o.p[1])}</div></div>
        <div class="cell"><div class="k">Z (m)</div><div class="v">${m1(o.p[2])}</div></div>
      </div>
      <div class="section">
        <div class="kv"><span class="k">Drehung</span><span class="v mono">${fmt(yaw, 1)}°</span></div>
        <div class="kv"><span class="k">Maße (B × T × H)</span><span class="v mono">${o.kind === 'path' ? 'Länge ' + m1(pathLen(o.path)) + ' m' : esc(dims(g))}</span></div>
        ${g && powerText(g) !== '—' ? `<div class="kv"><span class="k">Strom</span><span class="v mono">${esc(powerText(g))}</span></div>` : ''}
        ${g && extraText(g) ? `<div class="kv"><span class="k">Leistung</span><span class="v">${esc(extraText(g))}</span></div>` : ''}
        ${o.r ? `<div class="kv"><span class="k">Rezept</span><span class="v">${esc(rz ? rz.name : o.r)}${rz && rz.alternativ ? ' <span class="alt">(Alt.)</span>' : ''}</span></div>` : ''}
        ${rz ? `<div class="kv"><span class="k">pro Minute</span><span class="v" style="font-size:12px">${rz.zutaten.map((z) => fmt(z.proMin) + ' ' + iname(z.item)).join(' + ')}<br>→ ${rz.produkte.map((z) => fmt(z.proMin) + ' ' + iname(z.item)).join(' + ')}</span></div>` : ''}
        ${o.w ? `<div class="kv"><span class="k">Farbmuster</span><span class="v">${esc(o.w.replace('SwatchDesc_', '').replace('Slot', 'Slot '))}</span></div>` : ''}
        ${g && g.stufe != null ? `<div class="kv"><span class="k">Stufe</span><span class="v">${g.stufe} · ${esc(g.freischaltung || '')}</span></div>` : ''}
      </div>
      ${g && g.kosten.length ? `<div class="section"><div class="label">Baukosten (Stück)</div>${g.kosten.map(([i, a]) => `<div class="costrow"><span>${iname(i)}</span><span>${a}</span></div>`).join('')}</div>` : ''}
      ${this.swapPossible(ids) ? '<button type="button" class="btn primary section" id="insp-swap">Material / Variante / Mk-Stufe …</button>' : ''}
      ${g ? `<button type="button" class="btn section" id="insp-kat">Im Katalog zeigen</button>` : ''}`;
    $('insp-swap')?.addEventListener('click', () => this.openSwap());
    const b = $('insp-kat');
    if (b) b.addEventListener('click', () => { this.katalog.state.sel = o.cls; this.katalog.state.cat = g.kategorie; this.katalog.state.tier = 9; this.katalog.renderAll(); this.setMode('katalog'); });
  }
  renderCosts() {
    $('costs-check').disabled = !this.bp;
    if (!this.bp) { $('costs').innerHTML = ''; this.kostenSumme = []; return; }
    const k = this.kat, sum = {};
    for (const [i, a] of this.bp.kopf.kosten) sum[i] = (sum[i] || 0) + a;
    let changed = false;
    if (this.scene && k) {
      const skip = /ConveyorBelt|ConveyorLift|Pipeline|PowerLine|Railroad|Hyper|Wire/;
      const addCost = (cls, sign) => { const g = k.gebaeude[cls]; if (!g || skip.test(cls)) return; changed = true; for (const [it, n] of g.kosten) sum[it] = (sum[it] || 0) + sign * n; };
      for (const o of this.scene.objs) {
        if (o.isNew) { if (!o.removed) addCost(o.cls, 1); continue; }
        if (o.removed) { if (!o.sp && !o.lt) addCost(o.cls0, -1); continue; }
        if (o.cls !== o.cls0) { addCost(o.cls0, -1); addCost(o.cls, 1); }
      }
    }
    this.kostenSumme = Object.entries(sum).filter(([, a]) => a > 0);
    $('costs').innerHTML = Object.entries(sum).filter(([, a]) => a > 0).map(([i, a]) => `<div class="costrow"><span>${esc(k?.items?.[i]?.name || i)}</span><span>${a.toLocaleString('de-DE')}</span></div>`).join('') || '<div class="muted">—</div>';
    $('costs-hint').textContent = changed ? 'Neu berechnet (wird beim Speichern in die Blaupause geschrieben).' : 'Aus dem Blaupausen-Kopf gelesen.';
  }

  // ------------------------------------------------------------ Status / Werkzeuge
  updateStatus() {
    if (!this.scene) return;
    const vis = this.scene.objs.filter((o) => !o.removed && !o.hidden && (this.level < 0 || !this.scene.levels.length || o.level === this.level)).length;
    $('st-count').textContent = `${vis} von ${this.scene.objs.filter((o) => !o.removed).length} Objekten sichtbar`;
    $('st-view').textContent = (this.mode === '3d' ? '3D' : '2D Draufsicht') + (this.level >= 0 && this.scene.levels.length ? ` · Ebene ${this.level + 1}` : '');
    const c = this.changes();
    const n = c.n;
    $('st-changes').textContent = this.bp?.neu ? `Neue Blaupause · ${c.add.length} Bauteile – nicht gespeichert`
      : n ? `${c.moved} geändert · ${c.nSwap} getauscht · ${c.add.length} neu · ${c.remove.length} entfernt – nicht gespeichert` : 'Keine Änderungen';
    $('st-changes').classList.toggle('dirty', n > 0);
    $('btn-save').disabled = n === 0 || !!this.bp?.nurAnsicht;
    document.title = (n ? '● ' : '') + (this.bp ? this.bp.name + ' – ' : '') + 'Blueprint Studio';
  }
  updateTools() {
    const has = this.scene && this.selIds().length > 0;
    for (const id of ['t-rotl', 't-rotr', 't-up', 't-down', 't-del']) $(id).disabled = !has;
    $('t-kippen').disabled = !this.scene;
    $('t-hide').disabled = !has; $('t-isolate').disabled = !has;
    $('t-undo').disabled = !this.undoStack.length;
  }
  onModelsState(state, n, msg) {
    const b = $('t-models');
    if (state === 'laedt') b.textContent = 'Modelle …';
    else if (state === 'bereit') { b.textContent = 'Modelle'; b.title = `Echte Spielmodelle (${n} Bauteil-Typen) statt Kästen anzeigen`; }
    else if (state === 'fehlt') { b.textContent = 'Modelle'; b.disabled = true; b.title = 'Keine aufbereiteten Modelle gefunden (siehe LIESMICH: Modelle).'; }
    this.spielKnopf();
  }
  /** Knopf „Spieloptik“: nur mit Modellen, die Material-Daten haben (Extraktor ab 1.6) */
  spielKnopf() {
    const b = $('t-spiel'); if (!b || !this.gl3d) return;
    const v = this.view3d, moeglich = !!v.spielTex, an = moeglich && v.useModels && v.spielOptik;
    b.hidden = !(this.mode === '3d' && this.gl3d);
    b.disabled = !moeglich || !v.useModels;
    b.setAttribute('aria-pressed', String(an));
    b.title = moeglich ? 'Spieloptik: Lackfarben, Metall, Aufkleber und Schatten wie im Spiel (aus = Kategoriefarben)'
      : 'Spieloptik braucht neu geholte Modelle: Einstellungen → Einrichtung & Diagnose → „Modelle aus dem Spiel holen“';
  }
  setCursor(x, y) { $('st-cursor').textContent = `X ${m1(x)} · Y ${m1(y)} m`; }
  setDragInfo(dx, dy) { $('st-cursor').textContent = dx == null ? '' : `Verschieben: ${m1(dx)} / ${m1(dy)} m`; }

  // ------------------------------------------------------------ Ansichten
  render() { if (this.mode !== 'katalog') this.view.render(); }
  fit() {
    if (!this.scene) return;
    const b = sceneBounds(this.scene, this.sel.size ? this.sel : null) || this.scene.bounds;
    this.view.fit(b);
  }
  /** Ansicht beim Öffnen einer Blaupause: Einstellung „Immer 2D/3D“ oder zuletzt benutzte. */
  startAnsicht() {
    const a = this.cfg?.ansicht;
    if (a === '2d' || a === '3d') return a;
    const z = localStorageGet('ansicht');
    return z === '3d' && this.view3d ? '3d' : z === '2d' ? '2d' : this.mode;
  }
  setView(v, merken = true) {
    if (merken) localStorageSet('ansicht', v);
    if (v === this.mode) return;
    this.view.detach();
    this.mode = v; this.view = v === '3d' ? this.view3d : this.view2d;
    $('cv').hidden = v === '3d' && !!this.gl3d;
    this.view.attach();
    $('t-models').hidden = !(v === '3d' && this.gl3d);
    this.spielKnopf();
    $('t-stift').hidden = !(v === '3d' && this.gl3d);
    this.stiftSetzen(v === '3d' && this.gl3d && this.stiftAn);
    $('v2d').classList.toggle('on', v === '2d'); $('v3d').classList.toggle('on', v === '3d');
    $('v2d').setAttribute('aria-pressed', v === '2d'); $('v3d').setAttribute('aria-pressed', v === '3d');
    if (v === '3d' && this.scene && !this.view3d.fitted) { this.view3d.fitted = true; this.view3d.fit(this.scene.bounds); }
    this.updateStatus(); this.render();
  }
  setMode(m) {
    this.area = m;
    document.body.dataset.bereich = m; // Planer, Welt, Karte: Blaupausen-Knöpfe der Kopfzeile ausgeblendet (app.css)
    this.tour?.bereich(m);
    for (const v of ['editor', 'katalog', 'ordnen', 'karte', 'welt', 'planer', 'baukasten', 'hilfe']) {
      $('view-' + v).hidden = v !== m;
      $('mode-' + v).classList.toggle('on', v === m); $('mode-' + v).setAttribute('aria-selected', v === m);
    }
    if (m === 'katalog' && this.kat) this.katalog.renderCards();
    if (m === 'ordnen') this.ordnen.show();
    if (m === 'karte') this.karte.show();
    if (m === 'welt') this.weltZeigen();
    if (m === 'planer') this.planer.show();
    if (m === 'hilfe' && $('hilfe-frame').src === 'about:blank') $('hilfe-frame').src = this.hilfeDatei();
    if (m === 'baukasten' && $('baukasten-frame').getAttribute('src') === 'about:blank') $('baukasten-frame').src = 'baukasten.html?eingebettet=1';
    if (m === 'editor') requestAnimationFrame(() => this.render());
  }
  // ------------------------------------------------------------ Welt-Ansicht (3D mit Gelände)
  async weltZeigen() {
    try {
      if (!this.welt) {
        const { Welt3D } = await import('./welt3d.js');
        this.welt = new Welt3D($('w-canvas'), this);
        $('w-laden').addEventListener('click', async () => {
          const id = $('w-spielstand').value; if (!id) return;
          $('w-laden').disabled = true; $('w-laden').textContent = 'Wird geladen …';
          try {
            const m = await this.welt.ladeSpielstand(id);
            this.toast(`${m.name}: ${m.anzahl.toLocaleString('de-DE')} Bauteile${m.linien.length ? `, ${m.linien.length} Bänder/Rohre/Schienen` : ''}.`, 'ok');
            $('w-canvas').focus();
          } catch (e) { this.toast(e.message, 'err'); }
          finally { $('w-laden').disabled = false; $('w-laden').textContent = 'Laden'; }
        });
        $('w-reset').addEventListener('click', async () => {
          const w = this.welt, offen = w.gesetzt.length || w.geloescht?.size || w.delta?.size;
          if (offen && !await frage({ art: 'warnung', titel: 'Welt zurücksetzen?', text: 'Gesetzte Blaupausen und Änderungen, die noch nicht in einen Spielstand gespeichert sind, gehen verloren.', ok: 'Zurücksetzen', abbrechen: 'Abbrechen' })) return;
          w.zuruecksetzen(); $('w-spielstand').value = '';
          this.toast('Welt zurückgesetzt – kein Spielstand geladen.', 'ok'); $('w-canvas').focus();
        });
        $('w-bild').addEventListener('change', (e) => { this.welt.bildAn = e.target.checked; this.welt.zeichne(); });
        $('w-maus').checked = this.welt.mausUmkehren;
        $('w-stift').addEventListener('click', () => { const an = !this.welt.stift; this.welt.stiftSetzen(an); $('w-stift').setAttribute('aria-pressed', an); $('w-canvas').focus(); if (an) this.toast('Stift an: mit gedrückter linker Maustaste umranden. Umsehen mit der rechten Maustaste.'); });
        $('w-ego').addEventListener('click', () => { const an = !this.welt.ego?.an; this.welt.egoSetzen(an); this.weltEgoStatus(this.welt); $('w-canvas').focus(); });
        $('w-punkte').addEventListener('click', () => { const an = !this.welt.punkteAn; this.welt.punkteSetzen(an); $('w-punkte').setAttribute('aria-pressed', an); });
        $('w-punkte-menue-knopf').addEventListener('click', () => this.weltPunkteMenue());
        $('w-tiefe').addEventListener('change', (e) => { this.welt.lassoTiefe = Math.max(0, +e.target.value || 0); });
        $('w-leistung').addEventListener('change', (e) => { this.welt.leistungSetzen(e.target.checked, true); this.weltLeistungStatus(this.welt); });
        $('w-maus').addEventListener('change', (e) => { this.welt.mausUmkehren = e.target.checked; try { localStorage.setItem('bs-welt-maus-umkehren', e.target.checked ? '1' : '0'); } catch { /* egal */ } });
        this.weltBlaupausenVerdrahten();
        // Liste aktuell halten: beim Aufklappen, wenn das Fenster wieder aktiv wird (z. B. nach dem Spielen), alle 30 s
        $('w-spielstand').addEventListener('pointerdown', () => this.weltListe());
        $('w-spielstand').addEventListener('focus', () => this.weltListe());
        window.addEventListener('focus', () => { if (!$('view-welt').hidden) this.weltListe(); });
        setInterval(() => { if (!$('view-welt').hidden && document.visibilityState === 'visible') this.weltListe(); }, 30000);
      }
      await this.weltListe(true);
      await this.welt.start();
      this.welt.zeichne();
    } catch (e) { $('w-fehler').hidden = false; $('w-fehler').textContent = e.message; }
  }
  /** Spielstände für die Welt-Ansicht neu einlesen (neue erscheinen, gelöschte verschwinden; die Auswahl bleibt) */
  async weltListe(sofort = false) {
    if (!sofort && this.weltListeZeit && Date.now() - this.weltListeZeit < 3000) return; // nicht bei jedem Klick neu
    this.weltListeZeit = Date.now();
    let j; try { j = await (await fetch('/api/karte/liste', { cache: 'no-store' })).json(); } catch { return; }
    const sel = $('w-spielstand'), alt = sel.value, l = j.spielstaende || [];
    const html = '<option value="">– nur Gelände –</option>' + l.map((x) => `<option value="${esc(x.id)}">${esc(x.sitzung)} · ${esc(x.name)}</option>`).join('');
    if (sel.dataset.liste === html) return; // unverändert – offenes Aufklappmenü nicht stören
    sel.dataset.liste = html; sel.innerHTML = html;
    sel.value = l.some((x) => x.id === alt) ? alt : '';
  }
  /** Spielstand direkt in der Welt-Ansicht öffnen (Knopf „In 3D öffnen“ auf der Karte) */
  async weltOeffnen(id) {
    this.setMode('welt'); // lädt die Welt-Ansicht; warten, bis die Spielstand-Liste da ist
    for (let i = 0; i < 100 && !(this.welt && $('w-spielstand').options.length > 1); i++) await new Promise((r) => setTimeout(r, 100));
    if (![...$('w-spielstand').options].some((o) => o.value === id)) await this.weltListe(true);
    if (![...$('w-spielstand').options].some((o) => o.value === id)) return;
    $('w-spielstand').value = id; $('w-laden').click();
  }
  /** Stufe 3: Blaupausen aus Ablage und Spiel-Sitzungen zur Auswahl, Setzen, Liste, Speichern als neue Spielstand-Datei */
  async weltBlaupausenVerdrahten() {
    const wahl = new Map(), opts = [];
    try {
      const ab = await (await fetch('/api/ablage', { cache: 'no-store' })).json();
      for (const [ordner, liste] of Object.entries(ab.ordner || {})) for (const x of liste) { const l = `${x.name} · ${ordner}`; wahl.set(l, { ablage: ordner, name: x.name }); opts.push(l); }
      for (const sitz of ab.spielSitzungen || []) {
        const r = await fetch('/api/blueprints?session=' + encodeURIComponent(sitz), { cache: 'no-store' }); if (!r.ok) continue; // Sitzung ohne Blaupausen-Ordner
        const bl = await r.json();
        for (const x of Array.isArray(bl) ? bl : []) { const l = `${x.name} · Spiel: ${sitz}`; wahl.set(l, { session: sitz, name: x.name }); opts.push(l); }
      }
    } catch (e) { this.toast('Blaupausen-Liste: ' + e.message, 'err'); }
    $('w-bp-liste').innerHTML = opts.map((l) => `<option value="${esc(l)}"></option>`).join('');
    const pruefe = () => { $('w-bp-setzen').disabled = !wahl.has($('w-bp').value); };
    $('w-bp').addEventListener('input', pruefe);
    const setzen = async (q) => {
      try { const m = await this.welt.waehleBlaupause(q); this.toast(`${m.name}: ${m.anzahl + m.linien.length} Bauteile – in die Ansicht zeigen und klicken zum Absetzen.`, 'ok'); $('w-canvas').focus(); }
      catch (e) { this.toast(e.message, 'err'); }
    };
    const gewaehlt = (q) => { $('w-bp').value = [...wahl].find(([, v]) => v.name === q.name && v.ablage === q.ablage && v.session === q.session)?.[0] || ''; pruefe(); setzen(q); };
    $('w-bp-ablage').addEventListener('click', () => this.ablage.grossesFenster(gewaehlt));
    $('w-bp-fenster').addEventListener('click', () => {
      const f = window.open('/?fenster=ablage', 'bs-ablage', 'popup,width=1100,height=900');
      if (!f) this.toast('Das Fenster wurde blockiert – bitte Pop-ups für die App erlauben.', 'err'); else f.focus();
    });
    if (!this.ablageKanal) {
      this.ablageKanal = new BroadcastChannel(ABLAGE_KANAL);
      this.ablageKanal.addEventListener('message', (e) => {
        if (e.data?.art !== 'setzen' || !e.data.q?.name) return;
        if (this.area !== 'welt') { this.toast('Zum Setzen bitte die Welt-Ansicht öffnen.', 'err'); return; }
        window.focus(); gewaehlt(e.data.q);
      });
    }
    $('w-bp-setzen').addEventListener('click', async () => {
      const q = wahl.get($('w-bp').value); if (!q) return;
      $('w-bp-setzen').disabled = true;
      try { const m = await this.welt.waehleBlaupause(q); this.toast(`${m.name}: ${m.anzahl + m.linien.length} Bauteile – in die Ansicht zeigen und klicken zum Absetzen.`, 'ok'); $('w-canvas').focus(); }
      catch (e) { this.toast(e.message, 'err'); } finally { pruefe(); }
    });
    $('w-speichern').addEventListener('click', async () => {
      const w = this.welt, id = $('w-spielstand').value, name = $('w-neu-name').value.trim();
      if (!w.objekte || !id) { this.toast('Bitte zuerst oben einen Spielstand laden – die Blaupausen kommen in eine Kopie davon.', 'err'); return; }
      if (!name) { this.toast('Bitte einen Namen für den neuen Spielstand eingeben.', 'err'); $('w-neu-name').focus(); return; }
      let ueberschreiben = false;
      try {
        const da = await (await fetch(`/api/welt/spielstand-da?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`, { cache: 'no-store' })).json();
        if (da.da) {
          ueberschreiben = await frage({ art: 'warnung', titel: `„${name}“ überschreiben?`, text: `Den Spielstand „${name}“ gibt es schon${da.original ? ' – es ist der gerade geladene Spielstand' : ''}. Die alte Datei wird vorher gesichert (userdata\\spielstand-sicherung) und lässt sich von dort zurückholen. Im Spiel diesen Stand dabei nicht geladen haben.`, ok: 'Überschreiben', abbrechen: 'Anderen Namen wählen' });
          if (!ueberschreiben) { $('w-neu-name').focus(); $('w-neu-name').select(); return; }
        }
      } catch { /* Prüfung nicht möglich – der Server lehnt Doppel ohne Freigabe ohnehin ab */ }
      $('w-speichern').disabled = true;
      try {
        const setzungen = w.gesetzt.map((g) => ({ ...g.quelle, x: g.x, y: g.y, z: g.z, dreh: g.dreh, kx: g.kx || 0, ky: g.ky || 0 })), { loeschen, verschieben } = w.aenderungen();
        $('w-speichern').textContent = 'Wird gespeichert …';
        const r = await api('welt/spielstand', { id, name, setzungen, loeschen, verschieben, ueberschreiben }), i = r.info;
        const teile = [i.blaupausen ? `${i.blaupausen} Blaupausen (${i.eingefuegt.toLocaleString('de-DE')} Objekte)` : '', i.verschoben ? `${i.verschoben} verschoben` : '', (i.akteureGeloescht || 0) + (i.leichtbauGeloescht || 0) ? `${i.akteureGeloescht + i.leichtbauGeloescht} gelöscht${i.kabelGeloescht ? ` (+${i.kabelGeloescht} Kabel)` : ''}` : ''].filter(Boolean);
        this.weltListe(true); // neuer Spielstand gleich in der Liste
        this.toast(`Neuer Spielstand „${r.name}“ gespeichert: ${teile.join(', ')}. Im Spiel laden zum Prüfen.${i.sicherung ? ` Alte Datei gesichert: ${i.sicherung}` : ''}`, 'ok');
      } catch (e) { this.toast(e.message, 'err'); } finally { $('w-speichern').disabled = false; $('w-speichern').textContent = 'In Spielstand speichern'; }
    });
    this.weltSetzenStatus(this.welt);
  }
  weltSetzenStatus(w) {
    const el = $('w-gesetzt'); if (!el || !w) return;
    el.innerHTML = w.gesetzt.map((g, i) => `<div class="w-g${w.gSel === i ? ' gewaehlt' : ''}"><button type="button" class="linkbtn w-g-name" data-wahl="${i}" title="${esc(g.quelle.name)} – anklicken zum Auswählen">${i + 1}. ${esc(g.quelle.name)} · ${g.dreh}°</button><button type="button" class="btn small" data-weg="${i}" title="${esc(g.quelle.name)} entfernen" aria-label="${esc(g.quelle.name)} entfernen">✕</button></div>`).join('')
      + (w.setzen ? `<div class="hint">Setzt gerade: <b>${esc(w.setzen.quelle.name)}</b> · ${w.setzen.dreh}°${w.setzen.dz ? ` · ${w.setzen.dz > 0 ? '+' : ''}${w.setzen.dz / 100} m` : ''} – Esc = fertig</div>` : '');
    el.querySelectorAll('[data-weg]').forEach((b) => b.addEventListener('click', () => { w.entferne(+b.dataset.weg); this.weltGMenue(w, null); }));
    el.querySelectorAll('[data-wahl]').forEach((b) => b.addEventListener('click', () => w.gWaehle(+b.dataset.wahl)));
    this.weltAendernStatus(w);
  }
  /** kleines Menü an der Maus für eine gesetzte Blaupause (i = null: schließen) */
  weltGMenue(w, i, x = null, y = null) {
    let m = $('w-gmenue');
    if (i == null || !w.gesetzt[i]) { if (m) m.hidden = true; this.weltSetzenStatus(w); return; }
    if (!m) { m = document.createElement('div'); m.id = 'w-gmenue'; m.className = 'w-gmenue'; $('w-canvas').parentElement.appendChild(m); }
    const g = w.gesetzt[i];
    const feld = (k, wert, schritt, titel) => `<label title="${titel}">${k} <input type="number" step="${schritt}" data-gf="${k}" value="${wert}"></label>`;
    m.innerHTML = `<b title="${esc(g.quelle.name)}">${esc(g.quelle.name)}</b><span class="muted">Pfeile/Bild/R/Entf</span>
      <div class="w-gfelder">${feld('X', (g.x / 100).toFixed(1), 0.5, 'Lage X in m')}${feld('Y', (g.y / 100).toFixed(1), 0.5, 'Lage Y in m')}${feld('Z', (g.z / 100).toFixed(1), 0.5, 'Höhe in m')}${feld('°', g.dreh, 5, 'Drehung um die Hochachse')}${feld('↻X', g.kx || 0, 5, 'Kippen um X (vor/zurück)')}${feld('↻Y', g.ky || 0, 5, 'Kippen um Y (seitlich)')}<label title="Schrittweite der Pfeiltasten (Umschalt = 8 m)">Raster <select data-graster>${[50, 100, 200, 400, 800].map((r) => `<option value="${r}"${r === (w.raster || 100) ? ' selected' : ''}>${r / 100} m</option>`).join('')}</select></label></div>
      <button type="button" class="btn small" data-g="schieben">Verschieben</button><button type="button" class="btn small" data-g="drehen">Drehen 90°</button><button type="button" class="btn small" data-g="weg">Löschen</button><button type="button" class="btn small" data-g="zu" aria-label="Schließen">✕</button>`;
    if (x != null) { const r = m.parentElement.getBoundingClientRect(); m.style.left = `${Math.min(Math.max(8, x - r.left + 12), r.width - 260)}px`; m.style.top = `${Math.min(Math.max(8, y - r.top + 12), r.height - 120)}px`; }
    m.hidden = false;
    m.querySelectorAll('[data-gf]').forEach((f) => f.addEventListener('change', () => {
      const v = parseFloat(f.value); if (!Number.isFinite(v)) return;
      const k = f.dataset.gf; if (k === 'X') g.x = Math.round(v * 100); else if (k === 'Y') g.y = Math.round(v * 100); else if (k === 'Z') g.z = Math.round(v * 100);
      else if (k === '°') g.dreh = ((v % 360) + 360) % 360; else if (k === '↻X') g.kx = Math.max(-180, Math.min(180, v)); else if (k === '↻Y') g.ky = Math.max(-180, Math.min(180, v));
      w.gesetztNeu();
    }));
    m.querySelector('[data-graster]')?.addEventListener('change', (e) => { w.raster = +e.target.value; });
    m.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.g;
      if (a === 'schieben') w.gVerschieben(i); else if (a === 'drehen') w.gTaste({ key: 'r', shiftKey: false }); else if (a === 'weg') { w.entferne(i); m.hidden = true; } else w.gAufheben();
      w.cv.focus({ preventScroll: true });
    }));
    this.weltSetzenStatus(w);
  }
  /** Inhalt des schwebenden Maschinen-Felds in der Welt */
  weltMaschineHtml(j) {
    const it = (id) => esc(this.kat?.items?.[id]?.name || id), zahl = (v) => v.toLocaleString('de-DE', { maximumFractionDigits: 2 });
    const fl = (id) => /Flüssig|Gas/.test(this.kat?.items?.[id]?.form || '');
    const zeilen = (l) => (l || []).map((x) => `<span data-no-i18n>${it(x.item)}</span><b>${zahl(x.proMin)} ${fl(x.item) ? 'm³/min' : '/min'}</b>`).join('');
    const kopf = [j.takt != null ? `Takt ${zahl(j.takt)} %` : '', j.boost ? `Somersloop +${j.boost} %` : '', j.auslastung != null ? `Auslastung ${j.auslastung} %` : '', j.pausiert ? 'angehalten' : '', j.reinheit ? `Knoten ${j.reinheit}` : '', j.mw != null ? `${zahl(j.mw)} MW` : ''].filter(Boolean);
    return `<b class="w-maschine-name" data-no-i18n>${esc(j.name)}</b>${j.rezept ? `<div class="w-maschine-rezept"><span>Rezept</span> <b data-no-i18n>${esc(j.rezept)}</b>${j.alternativ && !/^Alternativ/.test(j.rezept) ? ' <small class="muted">(Alternative)</small>' : ''}</div>` : ''}
      ${kopf.length ? `<div class="muted">${kopf.join(' · ')}</div>` : ''}
      ${j.ein?.length ? `<div class="w-maschine-teil">Eingang</div><div class="k-kv">${zeilen(j.ein)}</div>` : ''}
      ${j.aus?.length ? `<div class="w-maschine-teil">Ausgang</div><div class="k-kv">${zeilen(j.aus)}</div>` : ''}
      ${!j.rezept && !j.ein?.length && !j.aus?.length ? '<div class="muted">Kein Rezept eingestellt.</div>' : ''}`;
  }
  weltAendernStatus(w) {
    const el = $('w-aendern'); if (!el || !w) return;
    const O = w.objekte, nA = w.auswahl?.size || 0, nG = w.geloescht?.size || 0, nV = [...(w.delta?.keys() || [])].filter((i) => !w.geloescht.has(i)).length;
    let html = '';
    if (nA && O) {
      const arten = new Map(); for (const i of w.auswahl) { const c = w.klasseVon(i); arten.set(c, (arten.get(c) || 0) + 1); }
      const kat = this.kat?.gebaeude || {}, B = w.bewegung;
      const liste = [...arten].sort((a, b) => b[1] - a[1]), mehr = liste.length > 6 ? ` … (${nA.toLocaleString('de-DE')} Teile)` : '';
      html += `<div class="hint">Ausgewählt: <b>${liste.slice(0, 6).map(([c, n]) => `${n > 1 ? n + '× ' : ''}${esc(kat[c]?.name || c.replace(/^Build_|_C$/g, ''))}`).join(', ')}${mehr}</b>${B ? ` · ${(B.t[0] / 100).toFixed(0)} / ${(B.t[1] / 100).toFixed(0)} / ${(B.t[2] / 100).toFixed(0)} m, ${Math.round(B.a * 180 / Math.PI)}°` : ''}</div>`;
    }
    if (nV || nG) html += `<div class="w-g"><span>Änderungen: ${nV} verschoben, ${nG} gelöscht</span><button type="button" class="btn small" id="w-verwerfen">Verwerfen</button></div>`;
    el.innerHTML = html;
    $('w-verwerfen')?.addEventListener('click', () => w.aenderungenVerwerfen());
    $('w-speichern-feld').hidden = !(w.gesetzt.length || nV || nG || w.bewegung);
    if (!nA) this.weltAuswahlMenue(w);
  }
  /** kleines Feld über dem umrandeten Bereich: als Blaupause speichern, löschen, abbrechen (ohne x: schließen) */
  weltAuswahlMenue(w, x = null, y0 = 0, y1 = 0) {
    let m = $('w-amenue');
    if (x == null || !w?.auswahl?.size) { if (m) m.hidden = true; return; }
    if (!m) { m = document.createElement('div'); m.id = 'w-amenue'; m.className = 'w-gmenue w-amenue'; $('w-canvas').parentElement.appendChild(m); }
    m.innerHTML = `<b>${w.auswahl.size.toLocaleString('de-DE')} Teile ausgewählt</b>
      <button type="button" class="btn primary small" data-a="bp" title="Die ausgewählten Teile (wie im geladenen Spielstand) als neue Blaupause speichern">Als Blaupause speichern …</button><button type="button" class="btn small" data-a="weg" title="Ausgewählte Teile löschen (erst beim Speichern in der neuen Datei wirksam)">Löschen</button><button type="button" class="btn small" data-a="zu">Abbrechen</button>`;
    m.hidden = false;
    const r = m.parentElement.getBoundingClientRect(), b = m.offsetWidth, h = m.offsetHeight;
    const oben = y0 - h - 10 >= 8 ? y0 - h - 10 : Math.min(y1 + 10, r.height - h - 8); // über dem Bereich, sonst darunter
    m.style.left = `${Math.min(Math.max(8, x - b / 2), r.width - b - 8)}px`; m.style.top = `${Math.max(8, oben)}px`;
    m.querySelectorAll('[data-a]').forEach((k) => k.addEventListener('click', () => {
      const a = k.dataset.a; m.hidden = true;
      if (a === 'bp') this.weltAuswahlSpeichern(w); else if (a === 'weg') w.auswahlLoeschen(); else w.auswahlAufheben();
      w.cv.focus({ preventScroll: true });
    }));
  }
  /** Welt: ausgewählte Teile als Blaupause speichern (Spiel-Sitzung wählen, Name) */
  async weltAuswahlSpeichern(w) {
    const { akteure, leicht } = w.auswahlRefs();
    const sessions = (this.cfg?.sessions || []).filter((x) => !x.lib).map((x) => x.name);
    if (!sessions.length) { this.toast('Keine Spiel-Sitzung zum Speichern gefunden.', 'err'); return; }
    const ziel = await auswahl({ titel: 'Blaupause speichern in', text: `${(akteure.length + leicht.length).toLocaleString('de-DE')} Teile, so wie sie im geladenen Spielstand stehen.`, ok: 'Weiter', vorwahl: this.spielSession() || sessions[0], optionen: sessions.map((s) => ({ wert: s, text: s })) });
    if (!ziel) return;
    const name = await eingabe({ titel: 'Name der Blaupause', wert: 'Welt_Auswahl', ok: 'Speichern' });
    if (!name) return;
    if (/[\\/:*?"<>|]/.test(name)) { this.toast('Bitte einen gültigen Namen angeben (ohne \\ / : * ? " < > |).', 'err'); return; }
    try {
      const r = await fetch('/api/welt/auswahl-blaupause', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' }, body: JSON.stringify({ id: $('w-spielstand').value, akteure, leicht, session: ziel.wert, name }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status);
      const i = j.info, fehlt = Object.entries(i.fehlend || {});
      this.zaehlerAktualisieren?.();
      this.toast(`Blaupause „${name}“ gespeichert: ${i.gebaeude} Gebäude, ${i.leichtbau} Leichtbau-Teile, ${i.bestandteile} Anschlüsse/Bestandteile.${fehlt.length ? ` Ohne Vorlage übersprungen: ${fehlt.map(([c, n]) => n + '× ' + c.replace(/^Build_|_C$/g, '')).join(', ')}.` : ''}`, fehlt.length ? 'err' : 'ok');
    } catch (e) { this.toast(e.message, 'err'); }
  }
  /** Menü: welche Kartenpunkte (Zahlen offen/alle, wenn ein Spielstand geladen ist) */
  async weltPunkteMenue() {
    const w = this.welt; let m = $('w-punkte-menue');
    if (m && !m.hidden) { m.hidden = true; return; }
    if (!m) { m = document.createElement('div'); m.id = 'w-punkte-menue'; m.className = 'w-punkte-menue'; $('w-canvas').parentElement.appendChild(m); }
    if (!w.punkteAn) { w.punkteSetzen(true); $('w-punkte').setAttribute('aria-pressed', true); }
    if (!w.punkte) await w.punkteHolen();
    const { filterMenue, zahlenJeGruppe, filterLaden } = await import('./kartenpunkte.js');
    w.punkteFilter ||= filterLaden();
    filterMenue(m, w.punkteFilter, () => w.zeichne(), w.punkte ? zahlenJeGruppe(w.punkte) : {}, w.punkte, this.kat);
    m.hidden = false;
  }
  weltPunkteStatus(w) { const m = $('w-punkte-menue'); if (m && !m.hidden) { m.hidden = true; this.weltPunkteMenue(); } }
  weltEgoStatus(w) {
    $('w-ego').setAttribute('aria-pressed', !!w.ego?.an);
    if (w.ego?.an && w.ego.wartet) this.toast('Ego-Modus: in die Welt klicken = Startpunkt. Dann W A S D gehen (Umschalt = schneller), Leertaste / C = höher / tiefer schweben, Maus = umsehen, Esc = zurück.');
  }
  weltLeistungStatus(w) {
    $('w-leistung').checked = !!w.leistung;
    if (w.leistungAuto) { w.leistungAuto = false; this.toast(`Großer Spielstand (${Math.round(w.saetze.spielstand.dreiecke / 1e6)} Mio. Dreiecke): Leistungsmodus eingeschaltet. Ausschalten oben links mit dem Blitz.`, 'ok'); }
  }
  /** Kompass unten rechts: Rose dreht sich mit der Blickrichtung, darunter Richtung und Biom an der Kameraposition */
  weltKompass(w) {
    const pfeil = $('w-k-pfeil'); if (!pfeil) return;
    const rose = pfeil.ownerSVGElement;
    if (!rose.dataset.fertig) {
      // Himmelsrichtungen in der eingestellten Sprache (N, O/E, S, W/O)
      const rn = RICHTUNGEN[aktuelleSprache()] || RICHTUNGEN.de; rose.querySelectorAll('text').forEach((tx, i) => { tx.textContent = rn[i * 2]; tx.setAttribute('data-no-i18n', ''); });
      const g = rose.querySelector('.w-k-striche'); let h = '';
      for (let a = 0; a < 360; a += 10) { if (a % 90 === 0) continue; const r = (a * Math.PI) / 180, gross = a % 30 === 0, i = gross ? 37 : 40; h += `<line class="${gross ? 'gross' : ''}" x1="${(Math.sin(r) * i).toFixed(1)}" y1="${(-Math.cos(r) * i).toFixed(1)}" x2="${(Math.sin(r) * 44).toFixed(1)}" y2="${(-Math.cos(r) * 44).toFixed(1)}"/>`; }
      g.innerHTML = h; rose.dataset.fertig = '1';
    }
    // Spielwelt: +X = Osten, +Y = Süden; Blickrichtung (cos yaw, sin yaw) → Kurs 0° = Norden, im Uhrzeigersinn. Norden bleibt oben, der Pfeil dreht.
    const kurs = ((w.yaw + 90) % 360 + 360) % 360, rk = Math.round(kurs) % 360;
    if (this._kursAlt !== rk) {
      this._kursAlt = rk;
      pfeil.setAttribute('transform', `rotate(${kurs.toFixed(1)})`);
      const namen = RICHTUNGEN[aktuelleSprache()] || RICHTUNGEN.de;
      $('w-k-grad').textContent = `${namen[Math.round(kurs / 45) % 8]} ${rk}°`;
    }
    const b = $('w-k-biom'), name = gebietAn(w.eye[0], w.eye[1]);
    if (b.textContent !== (name || '')) b.textContent = name || '';
    b.hidden = !name;
  }
  weltStatus(w) {
    this.weltKompass(w);
    const el = $('w-status'); if (!el) return;
    const z = Math.round(w.eye[2] / 100), b = Math.round(w.boden() / 100);
    el.innerHTML = `<span>Position</span><b>${Math.round(w.eye[0] / 100)} / ${Math.round(w.eye[1] / 100)} m</b><span>Höhe</span><b>${z} m (${z - b} m über Grund)</b>`
      + `<span>Gelände-Kacheln</span><b>${w.zahlKacheln || 0}${w.laden.size ? ` (+${w.laden.size} laden)` : ''}</b>${w.objekte ? `<span>Bauteile</span><b>${w.objekte.meta.anzahl.toLocaleString('de-DE')}</b>` : ''}`
      + (w.leistung && w.zellenStatus ? `<span>Leistungsmodus</span><b>${w.zellenStatus.gez} von ${w.zellenStatus.alle} Zellen im Bild, ${w.zellenStatus.nah} nah, ${w.zellenStatus.mittel || 0} vereinfacht</b>` : '');
  }
  /** Baukasten-Reiter öffnen; mitPlan: den aktuellen Planer-Plan dort als Reihen aufbauen (Übergabe liegt im Browser-Speicher) */
  baukastenOeffnen(mitPlan = false) {
    this.setMode('baukasten');
    if (mitPlan) $('baukasten-frame').src = 'baukasten.html?eingebettet=1&planer=1&t=' + Date.now();
  }
  showHelp(anker) { this.setMode('hilfe'); $('hilfe-frame').src = this.hilfeDatei() + (anker ? '#' + anker : ''); }
  hilfeDatei() { const l = this.cfg?.sprache; return l && l !== 'de' && this.cfg.hilfeSprachen?.includes(l) ? `hilfe.${l}.html` : 'hilfe.html'; }
  /** Sprache wechseln: speichern und neu laden (alle Texte werden dann in der neuen Sprache aufgebaut) */
  async spracheSetzen(l) {
    if (!SPRACHEN[l] || l === this.cfg?.sprache) return;
    await api('config', { sprache: l });
    try { sessionStorage.setItem('bs.sprachwechsel', '1'); } catch { /* egal */ }
    location.reload();
  }

  // ------------------------------------------------------------ aus „Ordnen“ ansehen
  async openFromOrdnen(x) {
    if (this.dirty() && !(await ungespeichert('Trotzdem eine andere Blaupause öffnen?'))) return;
    $('loading').hidden = false;
    try {
      const r = await fetch('/api/blueprint-datei?id=' + encodeURIComponent(x.id), { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.fehler || r.status);
      this.bp = j;
      this.setMode('editor');
      this.openScene();
      $('pathtext').textContent = j.herkunft + ' · ' + j.name;
      this.toast(`„${j.name}“ geöffnet (${j.herkunft}). Speichern legt Kopien im selben Ordner an. Zurück über „Ordnen“.`);
    } catch (e) { this.toast('Konnte nicht geöffnet werden: ' + e.message, 'err'); }
    finally { $('loading').hidden = true; }
  }
  async afterOrdnen() {
    try { this.cfg = await api('config'); this.fillSessions(); } catch { /* egal */ }
  }

  // ------------------------------------------------------------ Bauteile tauschen
  /** Mk-Stufen fuer Baender/Lifte/Rohre (gleiche Familie, nur Klasse + Rezept aendern sich) */
  mkVarianten(cls) {
    if (!this.kat) return [];
    const m = /^Build_(ConveyorBelt|ConveyorLift)Mk(\d)_C$/.exec(cls);
    if (m) return [1, 2, 3, 4, 5, 6].map((n) => `Build_${m[1]}Mk${n}_C`).filter((c) => c !== cls && this.kat.gebaeude[c]);
    const p = /^Build_Pipeline(MK2)?(_NoIndicator)?_C$/.exec(cls);
    if (p) { const c = `Build_Pipeline${p[1] ? '' : 'MK2'}${p[2] || ''}_C`; return this.kat.gebaeude[c] ? [c] : []; }
    const pp = /^Build_PipelinePump(Mk2)?_C$/i.exec(cls);
    if (pp) { const c = pp[1] ? 'Build_PipelinePump_C' : 'Build_PipelinePumpMk2_C'; return this.kat.gebaeude[c] ? [c] : []; }
    return [];
  }
  swapPossible(ids) {
    if (!this.kat || !ids.length) return false;
    const seen = new Set();
    for (const i of ids) { const o = this.scene.byId.get(i); if (!o || seen.has(o.cls)) continue; seen.add(o.cls); if ((o.sp || o.lt) ? this.mkVarianten(o.cls).length : tauschVarianten(o.cls, this.kat, this.avail).length) return true; }
    return false;
  }
  openSwap() {
    const ids = this.selIds(), groups = new Map();
    for (const i of ids) { const o = this.scene.byId.get(i); if ((o.sp || o.lt) && !this.mkVarianten(o.cls).length) continue; if (!groups.has(o.cls)) groups.set(o.cls, []); groups.get(o.cls).push(i); }
    const rows = [...groups].map(([cls, list]) => ({ cls, list, vars: this.mkVarianten(cls).length ? this.mkVarianten(cls) : tauschVarianten(cls, this.kat, this.avail), mk: this.mkVarianten(cls).length > 0 })).filter((r) => r.vars.length);
    $('swap-rows').innerHTML = rows.map((r, k) => `<div class="swaprow"><div class="swap-akt">${bauteilBild(this.kat, r.cls)}<div><span class="n">${esc(teilLabel(this.kat, r.cls))}</span><br><span class="muted">${r.list.length}× · jetzt</span></div><span class="swap-pfeil">→</span></div>
      <select data-k="${k}" aria-label="Neue Variante für ${esc(teilLabel(this.kat, r.cls))}"><option value="">– nicht tauschen –</option>${r.vars.map((v) => `<option value="${esc(v)}">${esc(teilLabel(this.kat, v))}${this.avail[v] === 'abgeleitet' ? ' (abgeleitet)' : ''}</option>`).join('')}</select></div>`).join('');
    this.swapRows = rows;
    $('swap-rows').querySelectorAll('select').forEach((sel) => selectMitBildern(sel, this.bildOpt(`Tauschen: ${teilLabel(this.kat, rows[+sel.dataset.k].cls)}`)));
    $('swap-error').hidden = true;
    $('dlg-swap').showModal();
  }
  /** Optionen für die Bildauswahl von Bauteilen (Tauschen, Formen) */
  bildOpt(titel) {
    return {
      titel, bild: (c) => bauteilBild(this.kat, c),
      gruppe: (c) => this.kat.gebaeude[c]?.unterkategorie || this.kat.gebaeude[c]?.kategorie || '',
      marke: (c) => ((this.avail || this.genAvail || {})[c] === 'abgeleitet' ? 'abgeleitet' : ''),
      hinweis: 'Klick auf ein Bild wählt es aus. „abgeleitet“ = Vorlage aus einem verwandten Bauteil erzeugt.',
    };
  }
  applySwap() {
    const plan = [];
    $('swap-rows').querySelectorAll('select').forEach((sel) => { if (sel.value) plan.push([this.swapRows[+sel.dataset.k], sel.value]); });
    if (!plan.length) { $('dlg-swap').close(); return; }
    const ids = plan.flatMap(([r]) => r.list);
    this.commit(ids, () => { for (const [r, cls] of plan) for (const i of r.list) setCls(this.scene.byId.get(i), cls, this.kat); },
      `${ids.length} Bauteil(e) getauscht`);
    $('dlg-swap').close();
    this.toast(`${ids.length} Bauteil(e) getauscht – zum Übernehmen speichern.`, 'ok');
  }

  // ------------------------------------------------------------ Formen-Generator
  async initGenerator() {
    if (!this.kat) return;
    if (!this.genReady) {
      $('gen-form').innerHTML = Object.entries(FORMEN).map(([k, f]) => `<option value="${k}">${esc(f.name)}</option>`).join('');
      this.genReady = true;
    }
    this.genAvail = await this.availFor(null);
    this.renderGenParams();
  }
  renderGenParams() {
    const f = FORMEN[$('gen-form').value], av = this.genAvail || {};
    $('gen-params').innerHTML = f.params.map((p) => {
      const id = 'gp-' + p.k;
      if (p.typ === 'zahl') return `<div class="genrow"><label for="${id}">${esc(p.label)}</label><input type="number" id="${id}" min="${p.min}" max="${p.max}" value="${p.std}"></div>`;
      if (p.typ === 'wahl') return `<div class="genrow"><label for="${id}">${esc(p.label)}</label><select id="${id}" class="gen-wahl">${p.optionen.map(([w, t]) => `<option value="${esc(w)}" ${w === p.std ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;
      if (p.typ === 'bild') return `<div class="genrow"><label for="${id}">${esc(p.label)}</label><input type="file" id="${id}" accept="image/*"></div>`;
      if (p.typ === 'janein') return`<div class="genrow check"><input type="checkbox" id="${id}" ${p.std ? 'checked' : ''}><label for="${id}">${esc(p.label)}</label></div>`;
      const opts = teileFuer(p.filter, this.kat, av);
      const std = opts.includes(p.std) ? p.std : (p.leer ? '' : opts[0]);
      return `<div class="genrow"><label for="${id}">${esc(p.label)}</label><select id="${id}">${p.leer ? `<option value="">${esc(p.leer)}</option>` : ''}${opts.map((c) => `<option value="${esc(c)}" ${c === std ? 'selected' : ''}>${esc(teilLabel(this.kat, c))}${av[c] === 'abgeleitet' ? ' *' : ''}</option>`).join('')}</select></div>`;
    }).join('');
    $('gen-params').querySelectorAll('input, select').forEach((el) => el.addEventListener('change', () => this.genPreviewUpdate()));
    $('gen-params').querySelectorAll('select:not(.gen-wahl)').forEach((sel) => selectMitBildern(sel, this.bildOpt(sel.closest('.genrow')?.querySelector('label')?.textContent || 'Bauteil wählen')));
    $('gen-params').querySelectorAll('input[type=number]').forEach((el) => el.addEventListener('input', () => this.genInfo()));
    // Bild für Pixel-Art laden (bleibt beim Umschalten der Form erhalten)
    $('gp-bild')?.addEventListener('change', (e) => {
      const datei = e.target.files?.[0]; if (!datei) return;
      const img = new Image();
      img.onload = () => { this.pixelBild = img; this.pixelName = datei.name.replace(/\.[^.]+$/, ''); this.genInfo(); if (this.bp?.formVorschau === 'pixel' || this.bp?.neu) this.genNew(true); };
      img.onerror = () => this.toast('Das Bild lässt sich nicht lesen.', 'err');
      img.src = URL.createObjectURL(datei);
    });
    // Formen vom Server (Pixel-Art): Vorschau öffnen statt einfügen, eigener Speichern-Knopf
    $('gen-new').textContent = f.server ? 'In 3D ansehen' : 'Als neue Blaupause öffnen';
    $('gen-insert').hidden = !!f.server; $('gen-raum-save').hidden = !f.server;
    $('gen-hint').textContent = f.server === 'pixel'
        ? 'Je Pixel ein quadratisches Schild in der Bildfarbe. Kleine Bilder mit klaren Farben (Logos, Pixel-Art) wirken am besten; die Breite bestimmt die Pixelzahl (höchstens 20 000 Pixel).'
        : $('gen-form').value === 'grundriss'
          ? 'Grundriss auf ein Raster zeichnen (z. B. in Paint, ein Kästchen = ein Fundament 8 × 8 m): schwarze Linien = Wand, blau = Fenster, rot = Tür, Lücke = offener Durchgang. „Breite (Fundamente)“ = Anzahl Kästchen über die Bildbreite. Das Kontrollbild zeigt, was erkannt wurde (grün = Boden).'
          : 'Teile, die in deinen Blaupausen vorkommen, werden exakt übernommen; andere Materialvarianten werden daraus abgeleitet.';
    this.genInfo();
  }
  /**
   * Grundriss erkennen: 8-m-Raster mit n Zellen über die Bildbreite legen; jede Rasterkante als W (Wand, dunkel), F (Fenster, blau),
   * T (Tür, rot) oder offen. Innen = Zellen, die man von außen nicht ohne gezeichnete Kante erreicht. → { n, m, kanten, innen, bild }
   */
  grundrissPlan(n) {
    const img = this.pixelBild; if (!img) return null;
    if (this.planCache?.img === img && this.planCache.n === n) return this.planCache.plan;
    const sk = Math.min(1, 2000 / img.naturalWidth), W = Math.round(img.naturalWidth * sk), H = Math.round(img.naturalHeight * sk);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(img, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    const art = (x, y) => { // Farbe eines Bildpunkts → W/F/T oder null
      x = Math.max(0, Math.min(W - 1, Math.round(x))); y = Math.max(0, Math.min(H - 1, Math.round(y)));
      const o = (y * W + x) * 4, r = d[o], gg = d[o + 1], b = d[o + 2];
      if (b > 110 && b > r + 50 && b > gg + 30) return 'F';
      if (r > 130 && r > gg + 60 && r > b + 60) return 'T';
      if (Math.max(r, gg, b) < 110) return 'W';
      return null;
    };
    const cw = W / n, m = Math.max(1, Math.round(H / cw)), ch = H / m, band = Math.max(2, cw * 0.12);
    const kante = (x0, y0, x1, y1, quer) => { // entlang der Kante 13 Stellen, je Stelle quer ±band nach Farbe suchen
      const z = {}; let treffer = 0;
      for (let k = 0; k <= 12; k++) {
        const t = 0.15 + (0.7 * k) / 12, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        let a = null; for (let q = -band; q <= band && !a; q++) a = quer === 'y' ? art(x, y + q) : art(x + q, y);
        if (a) { treffer++; z[a] = (z[a] || 0) + 1; }
      }
      return treffer >= 8 ? Object.entries(z).sort((p, q) => q[1] - p[1])[0][0] : null;
    };
    const kanten = {};
    for (let j = 0; j <= m; j++) for (let i = 0; i < n; i++) { const a = kante(i * cw, j * ch, (i + 1) * cw, j * ch, 'y'); if (a) kanten[`h,${i},${j}`] = a; }
    for (let i = 0; i <= n; i++) for (let j = 0; j < m; j++) { const a = kante(i * cw, j * ch, i * cw, (j + 1) * ch, 'x'); if (a) kanten[`v,${i},${j}`] = a; }
    // von außen fluten: über offene Kanten in Nachbarzellen; was nicht erreicht wird, ist innen
    const aussen = new Set(), stapel = [];
    const rein = (i, j) => { const k = `${i},${j}`; if (!aussen.has(k)) { aussen.add(k); stapel.push([i, j]); } };
    for (let i = 0; i < n; i++) { if (!kanten[`h,${i},0`]) rein(i, 0); if (!kanten[`h,${i},${m}`]) rein(i, m - 1); }
    for (let j = 0; j < m; j++) { if (!kanten[`v,0,${j}`]) rein(0, j); if (!kanten[`v,${n},${j}`]) rein(n - 1, j); }
    while (stapel.length) {
      const [i, j] = stapel.pop();
      if (i > 0 && !kanten[`v,${i},${j}`]) rein(i - 1, j);
      if (i < n - 1 && !kanten[`v,${i + 1},${j}`]) rein(i + 1, j);
      if (j > 0 && !kanten[`h,${i},${j}`]) rein(i, j - 1);
      if (j < m - 1 && !kanten[`h,${i},${j + 1}`]) rein(i, j + 1);
    }
    const innen = new Set();
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) if (!aussen.has(`${i},${j}`)) innen.add(`${i},${j}`);
    const plan = { n, m, kanten, innen, bild: c, cw, ch };
    this.planCache = { img, n, plan };
    return plan;
  }
  /** Kontrollbild: Grundriss mit Raster, erkannten Kanten (schwarz/blau/rot) und Innenflächen */
  grundrissKontrolle(plan) {
    const max = 280, sk = max / plan.bild.width, c = document.createElement('canvas');
    c.width = max; c.height = Math.round(plan.bild.height * sk); c.className = 'gen-pixel gen-plan';
    const g = c.getContext('2d'); g.globalAlpha = 0.35; g.drawImage(plan.bild, 0, 0, c.width, c.height); g.globalAlpha = 1;
    const cw = plan.cw * sk, ch = plan.ch * sk;
    g.fillStyle = 'rgba(80,180,120,.35)';
    for (const k of plan.innen) { const [i, j] = k.split(',').map(Number); g.fillRect(i * cw, j * ch, cw, ch); }
    g.strokeStyle = 'rgba(128,128,128,.35)'; g.lineWidth = 1;
    for (let i = 0; i <= plan.n; i++) { g.beginPath(); g.moveTo(i * cw, 0); g.lineTo(i * cw, plan.m * ch); g.stroke(); }
    for (let j = 0; j <= plan.m; j++) { g.beginPath(); g.moveTo(0, j * ch); g.lineTo(plan.n * cw, j * ch); g.stroke(); }
    g.lineWidth = 3;
    for (const [k, a] of Object.entries(plan.kanten)) {
      const [r, i, j] = k.split(','); g.strokeStyle = a === 'F' ? '#3a7bff' : a === 'T' ? '#e0302a' : '#111'; g.beginPath();
      if (r === 'h') { g.moveTo(+i * cw, +j * ch); g.lineTo((+i + 1) * cw, +j * ch); } else { g.moveTo(+i * cw, +j * ch); g.lineTo(+i * cw, (+j + 1) * ch); }
      g.stroke();
    }
    return c;
  }
  /** Pixel-Art: Bild auf die gewählte Breite verkleinern → { b, h, px:[[r,g,b,a]…] } (null ohne Bild) */
  pixelDaten() {
    const img = this.pixelBild; if (!img) return null;
    const v = this.genValues(), b = v.breite, h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * b));
    const c = document.createElement('canvas'); c.width = b; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, b, h);
    const d = g.getImageData(0, 0, b, h).data, px = [];
    for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2], d[i + 3]]);
    return { b, h, px, canvas: c };
  }
  genValues() {
    const f = FORMEN[$('gen-form').value], v = {};
    for (const p of f.params) {
      const el = $('gp-' + p.k);
      v[p.k] = p.typ === 'zahl' ? Math.max(p.min, Math.min(p.max, parseInt(el.value, 10) || p.std)) : p.typ === 'janein' ? el.checked : el.value;
    }
    if ($('gen-form').value === 'grundriss') v.plan = this.grundrissPlan(v.breite);
    return v;
  }
  genObjects() { return generate($('gen-form').value, this.genValues(), this.kat).filter((o) => o.cls); }
  genInfo() {
    if (FORMEN[$('gen-form').value].server === 'pixel') {
      const p = this.pixelDaten(), v = this.genValues();
      if (!p) { $('gen-info').textContent = 'Bitte ein Bild wählen (PNG, JPG, GIF …).'; return []; }
      const m = { tiny: 0.5, small: 1, square: 2 }[v.groesse], sichtbar = p.px.filter((x) => !v.transparent || x[3] >= 128).length;
      $('gen-info').innerHTML = `${p.b} × ${p.h} Pixel · ${m1(p.b * m * 100)} × ${m1(p.h * m * 100)} m · ${sichtbar} Schilder${p.b * p.h > 20000 ? ' <span class="err">– zu viele, Breite verkleinern</span>' : ''}<br>`;
      p.canvas.className = 'gen-pixel';
      $('gen-info').appendChild(p.canvas);
      return [];
    }
    const objs = this.genObjects(), cnt = {};
    for (const o of objs) cnt[o.cls] = (cnt[o.cls] || 0) + 1;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const o of objs) { x0 = Math.min(x0, o.pos[0]); x1 = Math.max(x1, o.pos[0]); z0 = Math.min(z0, o.pos[2]); z1 = Math.max(z1, o.pos[2]); }
    $('gen-info').innerHTML = objs.length ? `${objs.length} Bauteile · ca. ${m1(x1 - x0 + 800)} m breit${z1 - z0 > 100 ? ` · ${m1(z1 - z0)} m hoch` : ''}<br>` +
      Object.entries(cnt).map(([c, n]) => `${n}× ${esc(teilLabel(this.kat, c))}`).join('<br>') : 'Keine Bauteile – Parameter prüfen.';
    if ($('gen-form').value === 'grundriss') { // Kontrollbild: was wurde im Grundriss erkannt?
      const plan = this.pixelBild && this.planCache?.img === this.pixelBild ? this.planCache.plan : null;
      if (!this.pixelBild) $('gen-info').textContent = 'Bitte ein Grundriss-Bild wählen: schwarze Linien = Wand, blau = Fenster, rot = Tür, Lücke = offen.';
      else if (plan) {
        if (!plan.innen.size) $('gen-info').insertAdjacentHTML('afterbegin', `<span class="err">${esc('Keine geschlossene Außenwand erkannt – Breite (Fundamente) an das Raster der Zeichnung anpassen.')}</span><br>`);
        $('gen-info').appendChild(this.grundrissKontrolle(plan));
      }
    }
    return objs;
  }
  genPreviewUpdate() { this.genInfo(); if (this.bp?.neu || (this.bp?.formVorschau && this.bp.formVorschau === FORMEN[$('gen-form').value].server)) this.genNew(true); }
  /** Pixel-Art: Vorschau vom Server (Schilder in 3D) */
  pixelBody() { const p = this.pixelDaten(), v = this.genValues(); return p && { bild: { b: p.b, h: p.h, px: p.px }, groesse: v.groesse, lage: v.lage, leuchten: v.leuchten, transparentWeg: v.transparent, quelle: this.pixelName }; }
  async pixelVorschau(silent) {
    const body = this.pixelBody(); if (!body) { this.toast('Bitte zuerst ein Bild wählen.', 'err'); return; }
    if (!silent && this.dirty() && !(await ungespeichert('Trotzdem die Vorschau öffnen?'))) return;
    try {
      const r = await fetch('/api/pixelbild/vorschau', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' }, body: JSON.stringify(body) });
      const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status);
      const keepView = silent && this.scene;
      this.bp = { ...j, formVorschau: 'pixel' }; this.setMode('editor'); this.openScene();
      if (keepView) this.render();
      $('pathtext').textContent = `Pixel-Art · ${j.info.pixel} Schilder, ${j.info.breite} × ${j.info.hoehe} m (nur ansehen – speichern über „Als Blaupause speichern“)`;
    } catch (e) { this.toast(e.message, 'err'); }
  }
  async pixelSpeichern() {
    const body = this.pixelBody(); if (!body) { this.toast('Bitte zuerst ein Bild wählen.', 'err'); return; }
    const session = $('session').value;
    const name = await eingabe({ art: 'ordner', titel: 'Pixel-Art speichern', text: `in „${session}“`, wert: `8_5_${(this.pixelName || 'Bild').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40)}_${body.bild.b}x${body.bild.h}`, ok: 'Speichern' });
    if (!name) return;
    if (/[\\/:*?"<>|]/.test(name)) { this.toast('Ein Name darf \\ / : * ? " < > | nicht enthalten.', 'err'); return; }
    try {
      const r = await fetch('/api/pixelbild/blaupause', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' }, body: JSON.stringify({ ...body, session, name }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status);
      await this.loadList(); await this.openBlueprint(name);
      this.toast(`Pixel-Art „${name}“ gespeichert (${j.info.pixel} Schilder).`, 'ok');
    } catch (e) { this.toast(e.message, 'err'); }
  }
  async genNew(silent) {
    const srv = FORMEN[$('gen-form').value].server;
    if (srv === 'pixel') return this.pixelVorschau(silent);
    if (!silent && this.dirty() && !(await ungespeichert('Trotzdem eine neue Blaupause aus der Form öffnen?'))) return;
    const objs = this.genObjects();
    if (!objs.length) { this.toast('Keine Bauteile – Parameter prüfen.', 'err'); return; }
    const formName = FORMEN[$('gen-form').value].name.split(' (')[0].replace(/[^\p{L}\p{N}]+/gu, '_');
    const v = this.genValues();
    const groesse = v.durchmesser ? `${v.durchmesser}` : v.plan ? `${v.plan.n}x${v.plan.m}` : `${v.breite}x${v.laenge}`;
    const mat = (teilLabel(this.kat, v.boden || '').split(' · ')[1] || '').replace(/[^\p{L}\p{N}]+/gu, '');
    const keepView = silent && this.scene;
    this.bp = { neu: true, session: $('session').value, name: `BS_${formName}_${groesse}${mat ? '_' + mat : ''}`, beschreibung: `Erstellt mit Blueprint Studio: ${FORMEN[$('gen-form').value].name}`,
      kopf: { kosten: [], rezepte: [], saveVersion: this.basisVersion, engine: null }, klassen: [], objekte: [], komponenten: 0 };
    this.scene = buildScene(this.bp, this.kat);
    this.nextNew = -1;
    for (const o of objs) { const n = newObj(this.nextNew--, o.cls, o.pos, o.rot, this.kat); this.scene.objs.push(n); this.scene.byId.set(n.i, n); }
    sortScene(this.scene); computeLevels(this.scene);
    this.scene.bounds = sceneBounds(this.scene); this.zRef = this.scene.bounds?.z0 || 0;
    this.sel = new Set(); this.undoStack = []; this.redoStack = []; this.level = -1;
    this.avail = this.genAvail || {};
    $('empty').hidden = true; this.setMode('editor');
    this.renderLevels(); this.renderList(); this.renderParts(); this.updateStatus(); this.renderInspector(); this.renderCosts(); this.updateTools();
    if (keepView) this.render(); else this.fit();
  }
  genInsert() {
    if (!this.scene) return;
    const objs = this.genObjects();
    if (!objs.length) return;
    // an der Bildmitte einsetzen, auf 8-m-Raster
    let cx, cy;
    if (this.mode === '3d') { [cx, cy] = this.view3d.target; } else { cx = this.view2d.cx; cy = this.view2d.cy; }
    cx = Math.round(cx / 800) * 800; cy = Math.round(cy / 800) * 800;
    const z = this.scene.bounds ? Math.round(this.scene.bounds.z1 / 100) * 100 : 0;
    const ids = [];
    for (const o of objs) {
      const n = newObj(this.nextNew--, o.cls, [o.pos[0] + cx, o.pos[1] + cy, o.pos[2] + z], o.rot, this.kat);
      n.removed = true; // fuer Rueckgaengig: Zustand "vorher" = nicht vorhanden
      this.scene.objs.push(n); this.scene.byId.set(n.i, n); ids.push(n.i);
    }
    this.commit(ids, () => { for (const i of ids) this.scene.byId.get(i).removed = false; }, `${ids.length} Bauteile eingefügt`);
    this.setSel(ids);
    this.toast(`${ids.length} Bauteile oben auf der Blaupause eingefügt und ausgewählt – mit Pfeiltasten/Ziehen platzieren.`, 'ok');
  }

  // ------------------------------------------------------------ Meldungen
  toast(msg, kind) {
    const t = $('toast'); t.textContent = msg; t.className = 'toast' + (kind ? ' ' + kind : ''); t.hidden = false;
    clearTimeout(this.tt); this.tt = setTimeout(() => { t.hidden = true; }, kind === 'err' ? 7000 : 3500);
  }

  // ------------------------------------------------------------ Bedienelemente
  bindUi() {
    $('session').addEventListener('change', () => this.loadList());
    $('suche').addEventListener('input', () => this.renderList());
    $('parts-suche').addEventListener('input', () => this.renderParts());
    const tab = (name) => {
      for (const t of ['bp', 'parts', 'gen', 'library']) { $('tab-' + t).classList.toggle('on', t === name); $('tab-' + t).setAttribute('aria-selected', t === name); $('pane-' + t).hidden = t !== name; }
    };
    $('tab-bp').addEventListener('click', () => tab('bp'));
    $('tab-parts').addEventListener('click', () => { tab('parts'); this.renderParts(); });
    $('tab-gen').addEventListener('click', () => { tab('gen'); this.initGenerator(); });
    $('tab-library').addEventListener('click', () => tab('library'));
    window.addEventListener('bs-design', e => { if (!['industrial', 'immersive'].includes(e.detail) && !$('pane-library').hidden) tab('bp'); });
    $('gen-form').addEventListener('change', () => this.renderGenParams());
    $('gen-new').addEventListener('click', () => this.genNew());
    $('gen-insert').addEventListener('click', () => this.genInsert());
    $('gen-raum-save').addEventListener('click', () => this.pixelSpeichern());
    $('swap-cancel').addEventListener('click', () => $('dlg-swap').close());
    $('swap-ok').addEventListener('click', () => this.applySwap());
    $('mode-editor').addEventListener('click', () => this.setMode('editor'));
    $('mode-katalog').addEventListener('click', () => this.setMode('katalog'));
    $('mode-ordnen').addEventListener('click', () => this.setMode('ordnen'));
    $('mode-karte').addEventListener('click', () => this.setMode('karte'));
    $('mode-welt').addEventListener('click', () => this.setMode('welt'));
    $('mode-planer').addEventListener('click', () => this.setMode('planer'));
    $('mode-hilfe').addEventListener('click', () => this.setMode('hilfe'));
    $('mode-baukasten').addEventListener('click', () => this.setMode('baukasten'));
    $('st-version').addEventListener('click', (e) => { e.preventDefault(); this.showHelp('zur-app'); });
    $('o-help').addEventListener('click', (e) => { e.preventDefault(); this.showHelp('schema'); });
    $('v2d').addEventListener('click', () => this.setView('2d'));
    $('v3d').addEventListener('click', () => this.setView('3d'));
    $('t-models').setAttribute('aria-pressed', String(!!(this.gl3d && this.view3d.useModels)));
    $('t-stift').addEventListener('click', () => { this.stiftAn = !this.stiftAn; this.stiftSetzen(this.stiftAn); });
    $('stift-aus').addEventListener('click', () => { this.stiftAn = false; this.stiftSetzen(false); });
    $('stift-del').addEventListener('click', () => this.deleteSel());
    $('t-models').addEventListener('click', () => {
      const on = !this.view3d.useModels;
      $('t-models').setAttribute('aria-pressed', String(on));
      this.view3d.setModels(on);
      this.spielKnopf();
    });
    $('t-spiel').addEventListener('click', () => { this.view3d.setSpielOptik(!this.view3d.spielOptik); this.spielKnopf(); });
    $('snap').addEventListener('change', () => { this.snap = +$('snap').value; });
    $('t-rotl').addEventListener('click', () => this.rotateSel(-90));
    $('t-rotr').addEventListener('click', () => this.rotateSel(90));
    $('t-kippen').addEventListener('click', () => this.openKippen());
    $('t-mausdreh').addEventListener('click', () => this.mausDrehenSetzen(!this.mausDreh));
    $('t-hide').addEventListener('click', () => this.hideSel());
    $('t-isolate').addEventListener('click', () => this.isolateSel());
    $('t-showall').addEventListener('click', () => this.showAll());
    const kip = (deg) => { const ax = document.querySelector('input[name=kip-axis]:checked').value; this.rotateAxis(ax, deg, !this.sel.size, $('kip-boden').checked); };
    $('dlg-kippen').querySelectorAll('button[data-deg]').forEach((b) => b.addEventListener('click', () => kip(+b.dataset.deg)));
    $('kip-custom').addEventListener('click', () => { const d = parseFloat($('kip-deg').value); if (Number.isFinite(d) && d) kip(d); });
    $('t-up').addEventListener('click', () => this.moveSel(0, 0, 100));
    $('t-down').addEventListener('click', () => this.moveSel(0, 0, -100));
    $('t-del').addEventListener('click', () => this.deleteSel());
    $('t-undo').addEventListener('click', () => this.undo());
    $('t-fit').addEventListener('click', () => this.fit());
    $('t-help').addEventListener('click', () => { $('help').hidden = !$('help').hidden; });
    $('btn-save').addEventListener('click', () => this.openSave());
    $('costs-check').addEventListener('click', () => materialCheck(this, this.kostenSumme || [], this.bp?.name, $('session').value));
    $('save-cancel').addEventListener('click', () => $('dlg-save').close());
    $('save-ok').addEventListener('click', () => this.doSave());
    $('save-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.doSave(); } });
    // immer den Blaupausen-Hauptordner (SaveGames\blueprints) öffnen – nicht den gerade gewählten Spielstand
    $('btn-folder').addEventListener('click', () => api('open-folder', {}).catch((e) => this.toast(e.message, 'err')));
    // Ablage (Ordnerleiste) ein-/ausblenden – gemerkt im Browser
    const ablageSicht = (an) => {
      $('view-editor').classList.toggle('ab-versteckt', !an);
      $('btn-ablage').setAttribute('aria-pressed', String(an));
      $('btn-ablage-t').textContent = an ? 'Ablage ausblenden' : 'Ablage einblenden';
      $('btn-ablage').title = an ? 'Ablage (Ordnerleiste) ausblenden' : 'Ablage (Ordnerleiste) einblenden';
      $('btn-ablage-gross').hidden = an; // ausgeblendet: großes Fenster direkt aus der Kopfzeile
      try { localStorage.setItem('bs-ablage-sichtbar', an ? '1' : '0'); } catch { /* egal */ }
      if (this.area === 'editor') requestAnimationFrame(() => this.render());
    };
    let ablageAn = true; try { ablageAn = localStorage.getItem('bs-ablage-sichtbar') !== '0'; } catch { /* egal */ }
    ablageSicht(ablageAn);
    $('btn-ablage').addEventListener('click', () => { ablageAn = !ablageAn; ablageSicht(ablageAn); if (ablageAn && this.area !== 'editor') this.setMode('editor'); });
    $('btn-ablage-gross').addEventListener('click', () => { if (this.area !== 'editor') this.setMode('editor'); this.ablage.grossesFenster(); });
    $('btn-settings').addEventListener('click', () => { $('set-save').value = this.cfg.saveDir; $('set-sprache').value = this.cfg.sprache || 'de'; $('set-game').value = this.cfg.gameDir; $('set-lib').value = (this.cfg.bibliotheken || []).join('\n'); $('set-rutschen').checked = this.cfg.nachrutschen !== false; $('set-einsortieren').checked = this.cfg.umbenennenEinsortieren !== false; $('set-spielstand').innerHTML = '<option value="">Jedes Mal fragen</option>' + (this.cfg.spielSitzungen || []).map((x) => `<option value="${esc(x.name)}">${esc(x.name)} (zuletzt ${new Date(x.zuletzt).toLocaleDateString('de-DE')})</option>`).join(''); $('set-spielstand').value = this.cfg.spielSitzung || ''; $('set-ansicht').value = this.cfg.ansicht || 'zuletzt'; document.querySelectorAll('[name=set-ablage-lage]').forEach((r) => { r.checked = r.value === (this.cfg.ablageLage || 'unten'); }); $('set-ablage-breite').value = this.cfg.ablageBreite || 420; $('set-ablage-hoehe').value = this.cfg.ablageHoehe || 260; this.ablageWerteZeigen(); $('set-mp').value = (this.cfg.megaprints || []).join('\n'); $('set-praefixe').value = (this.cfg.namensPraefixe || []).join(', '); $('set-update-auto').checked = this.cfg.updatePruefen !== false; $('set-update-repo').value = this.cfg.updateRepo || ''; $('set-update-repo').placeholder = this.cfg.updateRepoStandard || 'Besitzer/Repository'; $('set-update-status').textContent = `Installiert: ${this.cfg.version}`; this.einstellungenStruktur(); $('set-status').textContent = `Spieldaten: ${this.cfg.docs || 'nicht gefunden'}`; $('dlg-settings').showModal(); });
    $('set-cancel').addEventListener('click', () => $('dlg-settings').close());
    $('set-struktur').addEventListener('click', () => this.struktur.zeigen());
    $('btn-update')?.addEventListener('click', () => this.update.zeigen());
    $('set-update-pruefen').addEventListener('click', async () => {
      const b = $('set-update-pruefen'); b.disabled = true; $('set-update-status').textContent = 'Suche …';
      try { await api('config', { updateRepo: $('set-update-repo').value }); const j = await this.update.pruefen({ neu: true, still: true });
        $('set-update-status').textContent = !j ? 'Prüfung fehlgeschlagen.' : j.verfuegbar ? `Neue Version ${j.neu} verfügbar.` : (j.fehler || j.hinweis || `Aktuell (${j.aktuell}).`);
        if (j?.verfuegbar) this.update.zeigen(); }
      finally { b.disabled = false; }
    });
    $('set-ok').addEventListener('click', async () => {
      const spr = $('set-sprache').value, sprNeu = spr !== (this.cfg.sprache || 'de');
      try { await api('config', { saveDir: $('set-save').value, gameDir: $('set-game').value, bibliotheken: $('set-lib').value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean), nachrutschen: $('set-rutschen').checked, umbenennenEinsortieren: $('set-einsortieren').checked, namensPraefixe: $('set-praefixe').value.split(/[,;]/).map((x) => x.trim()).filter(Boolean), updatePruefen: $('set-update-auto').checked, updateRepo: $('set-update-repo').value, spielSitzung: $('set-spielstand').value, ansicht: $('set-ansicht').value, ablageLage: document.querySelector('[name=set-ablage-lage]:checked')?.value || 'unten', ablageBreite: +$('set-ablage-breite').value, ablageHoehe: +$('set-ablage-hoehe').value, megaprints: $('set-mp').value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) }); this.karte.liste = null; this.ordnen.data = null; $('dlg-settings').close(); if (sprNeu) { await api('config', { sprache: spr }); location.reload(); return; } this.toast('Einstellungen gespeichert.', 'ok'); await this.init(); }
      catch (e) { $('set-status').textContent = e.message; }
    });
    window.addEventListener('beforeunload', (e) => { if (this.dirty()) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('keydown', (e) => { this.fahrSchnell = e.shiftKey; this.onKey(e); });
    window.addEventListener('keyup', (e) => { this.fahrSchnell = e.shiftKey; if (FAHR[e.code] && this.fahrt?.has(e.code)) this.fahrTaste(e.code, false); });
    window.addEventListener('blur', () => { this.fahrt?.clear(); });
    this.ablageGriff();
    // Zurück aus dem Spiel/Explorer: Liste, Ordner-Zahlen und Ablage neu einlesen (höchstens alle 3 s)
    let zuletzt = 0;
    const auffrischen = () => {
      if (document.hidden || !this.cfg || Date.now() - zuletzt < 3000 || document.querySelector('dialog[open]')) return;
      zuletzt = Date.now();
      this.loadList(); this.ablage.laden?.();
    };
    window.addEventListener('focus', auffrischen);
    document.addEventListener('visibilitychange', auffrischen);
  }
  /** W/A/S/D in der 3D-Ansicht: Kamera fährt waagerecht in Blickrichtung bzw. seitlich */
  fahrTaste(code, an) {
    if (!this.fahrt) this.fahrt = new Set();
    if (an) this.fahrt.add(code); else this.fahrt.delete(code);
    if (!this.fahrt.size || this.fahrRaf) return;
    let zuletzt = performance.now();
    const schritt = () => {
      const jetzt = performance.now();
      const dt = Math.max(0, Math.min(0.25, (jetzt - zuletzt) / 1000)); zuletzt = jetzt;
      const v3 = this.view3d;
      if (!this.fahrt.size || this.mode !== '3d' || !this.scene || !v3) { this.fahrRaf = 0; v3?.render?.(); return; }
      const cam = v3.camera();
      let fx = cam.f[0], fy = cam.f[1]; const fl = Math.hypot(fx, fy) || 1; fx /= fl; fy /= fl;
      const rx = cam.r[0], ry = cam.r[1];
      let vor = 0, seit = 0;
      for (const c of this.fahrt) { const [a, b] = FAHR[c]; vor += a; seit += b; }
      const tempo = Math.max(400, v3.dist * 0.7) * (this.fahrSchnell ? 3 : 1) * dt;
      v3.target[0] += (fx * vor + rx * seit) * tempo;
      v3.target[1] += (fy * vor + ry * seit) * tempo;
      if (v3.requestRender) v3.requestRender(true); else v3.render();
      this.fahrRaf = requestAnimationFrame(schritt);
    };
    this.fahrRaf = requestAnimationFrame(schritt);
  }
  onKey(e) {
    if (this.area === 'start') return;
    if (e.target.closest('input, select, textarea, dialog')) return;
    if (!$('view-katalog').hidden) return;
    const ctrl = e.ctrlKey || e.metaKey, k = e.key;
    if (ctrl && (k === 'z' || k === 'Z')) { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if (ctrl && (k === 'y' || k === 'Y')) { e.preventDefault(); this.redo(); return; }
    if (ctrl && (k === 's' || k === 'S')) { e.preventDefault(); if (!$('btn-save').disabled) this.openSave(); return; }
    if (!this.scene) return;
    // 3D: mit W/A/S/D vor/zurück/seitlich fahren (gedrückt halten, Umschalt = schneller)
    if (!ctrl && !e.altKey && this.mode === '3d' && FAHR[e.code]) { e.preventDefault(); this.fahrTaste(e.code, true); return; }
    if (ctrl && (k === 'a' || k === 'A')) { e.preventDefault(); this.setSel(this.scene.objs.filter((o) => !o.removed && o.kind !== 'none' && (this.level < 0 || !this.scene.levels.length || o.level === this.level)).map((o) => o.i)); return; }
    const step = e.shiftKey ? 800 : this.snap;
    const map = { ArrowLeft: [-step, 0, 0], ArrowRight: [step, 0, 0], ArrowUp: [0, -step, 0], ArrowDown: [0, step, 0], PageUp: [0, 0, 100], PageDown: [0, 0, -100] };
    if (map[k] && this.sel.size) { e.preventDefault(); this.moveSel(...map[k]); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this.deleteSel(); return; }
    if (k === 'h' && !e.shiftKey) { this.hideSel(); return; }
    if (k === 'H' || (k === 'h' && e.shiftKey)) { this.showAll(); return; }
    if (k === 'i' || k === 'I') { this.isolateSel(); return; }
    if (k === 'q' || k === 'Q') { this.rotateSel(-90); return; }
    if (k === 'e' || k === 'E') { this.rotateSel(90); return; }
    if ((k === 'p' || k === 'P') && this.mode === '3d' && this.gl3d) { this.stiftAn = !this.stiftAn; this.stiftSetzen(this.stiftAn); return; }
    if (k === 'Escape') { if (this.stiftAn && !this.sel.size) { this.stiftAn = false; this.stiftSetzen(false); return; } this.setSel([]); return; }
    if (k === 'f' || k === 'F') { this.fit(); return; }
    if (k === '2') this.setView('2d');
    if (k === '3') this.setView('3d');
  }
}

function pathLen(p) { let l = 0; for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1], p[i][2] - p[i - 1][2]); return l; }
function localStorageGet(k) { try { return localStorage.getItem('bs.' + k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem('bs.' + k, v); } catch { /* egal */ } }

window.app = new App();
