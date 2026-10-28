// Separater Startbereich. Keine Savegame- oder Renderer-Änderungen.
import { designAnwenden, gespeichertesDesign } from './design.js';
import { einstellungenGestalten } from './einstellungen-design.js';
const STILE = ['werkhalle', 'atlas', 'kommandobruecke', 'industrial', 'immersive'];
const NAMEN = ['Werkhalle', 'Atlas', 'Kommandobrücke', 'Industrial Precision', 'Immersive Command'];
const AUSSCHNITTE = {
  immersive: [[900,140,730,230],[900,390,730,230],[900,650,730,230]],
  industrial: [[30,200,530,440],[580,200,510,440],[1115,200,530,440]],
  werkhalle: [[30,200,530,440],[580,200,510,440],[1115,200,530,440]],
  atlas: [[1000,145,650,240],[145,145,835,530],[1000,480,650,220]],
  kommandobruecke: [[900,140,730,230],[900,390,730,230],[900,650,730,230]],
};
export class Startseite {
  constructor(app) {
    this.app = app;
    this.stil = gespeichertesDesign();
    if (!STILE.includes(this.stil)) this.stil = 'kommandobruecke';
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/startseite/startseite.css'; document.head.append(css);
    this.root = document.createElement('main'); this.root.id = 'bs-startseite'; this.root.hidden = true;
    document.getElementById('view-editor').before(this.root);
    this.tab = document.createElement('button'); this.tab.type = 'button'; this.tab.className = 'seg'; this.tab.textContent = 'Start';
    this.tab.setAttribute('role', 'tab'); this.tab.setAttribute('aria-controls', this.root.id); this.tab.setAttribute('aria-selected', 'false');
    document.getElementById('mode-editor').before(this.tab);
    const original = app.setMode.bind(app);
    app.setMode = (mode) => {
      const home = mode === 'start';
      // Original verwaltet sämtliche bestehenden Ansichten und deren Initialisierung.
      original(home ? 'start' : mode);
      this.root.hidden = !home; this.tab.classList.toggle('on', home); this.tab.setAttribute('aria-selected', String(home));
      document.body.classList.toggle('bs-home-open', home);
      if (home) { this.render(); void this.karteLaden(); }
    };
    this.tab.addEventListener('click', () => app.setMode('start'));
    this.root.addEventListener('click', e => {
      const button = e.target.closest('[data-home-mode]');
      if (button?.dataset.homeMode === 'bibliothek') { app.setMode('editor'); app.ablage.grossesFenster(); }
      else if (button) app.setMode(button.dataset.homeMode);
      if (e.target.closest('[data-home-settings]')) document.getElementById('btn-settings').click();
    });
    const label = document.createElement('label'); label.className = 'label'; label.htmlFor = 'set-startseite'; label.textContent = 'App-Design · gesamte Oberfläche';
    const select = document.createElement('select'); select.id = 'set-startseite';
    STILE.forEach((s,i) => select.add(new Option(NAMEN[i], s))); select.value = this.stil;
    const note = document.createElement('p'); note.className = 'muted'; note.textContent = 'Wird sofort auf diesem Gerät gespeichert. Alle Designs öffnen dieselben Werkzeuge.';
    document.getElementById('set-sprache').after(label, select, note);
    select.addEventListener('change', () => {
      this.stil = STILE.includes(select.value) ? select.value : 'kommandobruecke';
      try { designAnwenden(this.stil, true); } catch { designAnwenden(this.stil); app.toast('Design konnte nicht dauerhaft gespeichert werden.', 'err'); }
      this.render();
    });
    window.addEventListener('bs-design', e => { this.stil = e.detail; select.value = this.stil; this.render(); if (this.app.area === 'editor' && this.app.scene?.bounds) this.app.render?.(); });
    einstellungenGestalten(select);
    // Nach Ersteinrichtung bzw. Rückkehr aus Einstellungen erneut auf Kartenkacheln prüfen.
    for (const id of ['dlg-einrichtung', 'dlg-assistent', 'dlg-settings']) document.getElementById(id)?.addEventListener('close', () => { if (!this.root.hidden) void this.karteLaden(); });
  }
  starten() { if (!this.gestartet) { this.gestartet = true; this.app.setMode('start'); } }
  bild(index) {
    const box = AUSSCHNITTE[this.stil][index].join(' ');
    return `<svg class="home-art" viewBox="${box}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><image href="/startseite/${this.stil === 'industrial' ? 'werkhalle' : this.stil === 'immersive' ? 'kommandobruecke' : this.stil}.png" width="1672" height="941" /></svg>`;
  }
  render() {
    this.root.dataset.stil = this.stil;
    const title = {immersive:'Deine Welt. Dein Plan.',industrial:'Deine nächste große Idee.',werkhalle:'Deine nächste große Idee.',atlas:'Raum für deine Fabrik.',kommandobruecke:'Deine Welt. Dein Plan.'}[this.stil];
    const tiles = [['bibliothek','Blaupausen','Ordner öffnen · verwalten · bearbeiten'],['welt','Weltkarte 3D','Deine Welt erkunden und gestalten'],['karte','Taktische Karte','Die Welt in 2D · auswählen · übertragen']];
    this.root.innerHTML = `<header class="home-intro"><span class="home-eyebrow">BLUEPRINT STUDIO / ${NAMEN[STILE.indexOf(this.stil)]}</span><h1>${title}</h1><p>Wähle deinen Arbeitsbereich.</p></header><div class="home-tiles">${tiles.map(([mode,title,sub],i)=>`<button class="home-tile home-${mode}" type="button" data-home-mode="${mode}">${this.bild(i)}${i===2?'<div class="home-real-map" aria-hidden="true"></div>':''}<span class="home-caption"><span><strong>${title}</strong><small>${sub}</small></span><span class="home-arrow" aria-hidden="true">↗</span></span></button>`).join('')}</div><footer class="home-shortcuts"><button type="button" data-home-mode="editor"><span>◇</span><strong>Blaupausen-Editor</strong><small>Öffnen und bearbeiten</small></button><button type="button" data-home-mode="planer"><span>⌘</span><strong>Produktionsplaner</strong><small>Produktionsketten planen</small></button><button type="button" data-home-settings><span>⚙</span><strong>Einstellungen</strong><small>Design und App anpassen</small></button></footer>`;
    this.zeigeKarte();
  }
  zeigeKarte() {
    const slot = this.root.querySelector('.home-real-map');
    if (!slot || !this.kartenBilder) return;
    // Quadratische Spielkarte ohne Verzerrung; schmale Bildkacheln zeigen einen mittigen Ausschnitt.
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 2 2'); svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    this.kartenBilder.forEach((img, i) => {
      const tile = document.createElementNS(ns, 'image'); tile.setAttribute('href', img.src);
      tile.setAttribute('x', String(i % 2)); tile.setAttribute('y', String(Math.floor(i / 2)));
      tile.setAttribute('width', '1'); tile.setAttribute('height', '1'); svg.append(tile);
    });
    slot.replaceChildren(svg); slot.classList.add('ready');
  }
  async karteLaden() {
    if (this.laden || this.kartenBilder) return;
    this.laden = true;
    try {
      const r = await fetch('/api/karte/liste', {cache:'no-store'});
      if (!r.ok || !(await r.json()).kartenbild) return;
      const bilder = await Promise.all([[0,0],[1,0],[0,1],[1,1]].map(([x,y]) => new Promise((resolve,reject) => {
        const img = new Image(); img.alt = ''; img.onload = () => resolve(img); img.onerror = reject;
        img.src = `/api/karte/kachel/Map_${x}-${y}`;
      })));
      this.kartenBilder = bilder; this.zeigeKarte();
    } catch { /* Entwurfsbild bleibt bei fehlenden/unvollständigen Spieldaten sichtbar. */ }
    finally { this.laden = false; }
  }
}
