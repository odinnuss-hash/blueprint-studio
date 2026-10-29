// Produktionsplaner: Ziele eingeben (was, wie viel pro Minute), vorhandene Zulieferungen, Rezepte wählen.
// Ergebnis als Graph (Rohstoffe -> Fertigungsschritte -> Ziel) und als Liste; daraus wird später die Blaupause erzeugt.

import { rechne, rezeptOptionen, istRohstoff, rezepteJeItem, standardRezept, PRODUKTION, vorstufen } from './planer-rechner.js';
import { rechneOptimal } from './planer-optimierer.js';
import { bildwahl, itemBild } from './bildwahl.js';
import { tileHtml, fmt, ICONS, iconFile } from './katalog.js';
import { eingabe, frage, auswahl } from './dialog.js';
import { benoetigt, benoetigtText } from './freischaltung.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SPEICHER = 'bs.planer';
const WELT_SPEICHER = 'bs.planer.welt'; // mehrere Fabriken: { fabriken: [{ name, plan }], aktiv, miner, takt }
// Kraftwerke für den Welt-Plan: Leistung (MW bei 100 %), Kühlwasser (m³/min), mögliche Brennstoffe
const KRAFT_ARTEN = {
  Build_GeneratorCoal_C: { name: 'Kohlegenerator', mw: 75, wasser: 45, fuels: ['Desc_Coal_C', 'Desc_CompactedCoal_C', 'Desc_PetroleumCoke_C'] },
  Build_GeneratorFuel_C: { name: 'Treibstoffgenerator', mw: 250, wasser: 0, fuels: ['Desc_LiquidFuel_C', 'Desc_LiquidTurboFuel_C', 'Desc_LiquidBiofuel_C', 'Desc_RocketFuel_C', 'Desc_IonizedFuel_C'] },
  Build_GeneratorNuclear_C: { name: 'Atomkraftwerk', mw: 2500, wasser: 240, fuels: ['Desc_NuclearFuelRod_C', 'Desc_PlutoniumFuelRod_C', 'Desc_FicsoniumFuelRod_C'] },
  Build_GeneratorBiomass_Automated_C: { name: 'Biomasse-Brenner', mw: 30, wasser: 0, fuels: ['Desc_Biofuel_C', 'Desc_GenericBiomass_C'] },
  Build_GeneratorGeoThermal_C: { name: 'Geothermie-Generator', mw: 200, wasser: 0, fuels: [] },
};
const KRAFT_ABFALL = { Desc_NuclearFuelRod_C: ['Desc_NuclearWaste_C', 50], Desc_PlutoniumFuelRod_C: ['Desc_PlutoniumWaste_C', 10] };
const LEER = () => ({ ziele: [], vorhanden: [], wahl: {}, band: 5, stockwerke: 1 });
// ------------------------------------------------------------ Stil-Wahl mit kleinem Bild (Plan-Tafel, Blaupause)
// Bilder: vorerst Skizzen – sobald Spiel-Bilder da sind, liegen sie unter public/bilder/ (STIL_BILD auf <img> umstellen)
const skizze = (inhalt) => `<svg viewBox="0 0 120 70" class="stil-bild" aria-hidden="true"><rect width="120" height="70" rx="4" fill="#1b1f26"/>${inhalt}</svg>`;
const STIL_BILD = {
  tafelEinfach: skizze([0, 1, 2].map((c) => `<rect x="${8 + c * 37}" y="8" width="31" height="5" fill="#f5a623"/>` + [0, 1, 2, 3, 4, 5, 6].map((r) => `<rect x="${8 + c * 37}" y="${17 + r * 6.5}" width="31" height="4.5" fill="${['#5a3a12', '#1d2b4a', '#1d2b4a', '#16422a'][r % 4]}"/>`).join('')).join('')),
  tafelOptimiert: skizze([0, 1].map((c) => { const x = 10 + c * 54; return `<rect x="${x}" y="8" width="46" height="6" fill="#5a3a12"/><rect x="${x}" y="17" width="22" height="32" fill="#16422a"/><circle cx="${x + 11}" cy="29" r="7" fill="#9fd3a8"/>`
    + [0, 1, 2].map((i) => `<rect x="${x + 24}" y="${17 + i * 11}" width="22" height="5" fill="#1d2b4a"/>` + [0, 1, 2, 3].map((k) => `<rect x="${x + 24 + k * 5.6}" y="${23 + i * 11}" width="4.6" height="4" fill="#ddd"/>`).join('')).join('')
    + [0, 1, 2, 3].map((k) => `<rect x="${x + k * 5.6}" y="52" width="4.6" height="5" fill="#ddd"/>`).join(''); }).join('')),
  bpEinfach: skizze([0, 1, 2].map((r) => `<rect x="10" y="${10 + r * 19}" width="74" height="4" fill="#4a5568"/>` + [0, 1, 2, 3, 4].map((k) => `<rect x="${12 + k * 14}" y="${15 + r * 19}" width="10" height="9" fill="#f5a623"/>`).join('')).join('') + '<rect x="92" y="8" width="5" height="56" fill="#6b9bd2"/><rect x="100" y="8" width="5" height="56" fill="#6b9bd2"/>'),
  bpEtagen: skizze([0, 1, 2].map((r) => `<rect x="14" y="${58 - r * 22}" width="70" height="3" fill="#8a94a6"/>` + [0, 1, 2, 3].map((k) => `<rect x="${18 + k * 16}" y="${47 - r * 22}" width="11" height="10" fill="${['#f5a623', '#e07b39', '#c9b458'][r]}"/>`).join('')).join('') + '<rect x="94" y="10" width="4" height="50" fill="#6b9bd2"/><rect x="101" y="18" width="4" height="42" fill="#6b9bd2"/>'),
  bpOptimiert: skizze('<rect x="8" y="40" width="104" height="22" fill="#3a4250"/><rect x="8" y="12" width="104" height="22" fill="#3a4250"/>' + [0, 1, 2, 3, 4, 5].map((k) => `<rect x="${12 + k * 16}" y="${44}" width="12" height="12" fill="#f5a623"/><rect x="${12 + k * 16}" y="16" width="12" height="12" fill="#e07b39"/>`).join('') + '<rect x="56" y="34" width="8" height="6" fill="#6b9bd2"/><text x="60" y="8" font-size="6" fill="#9fd3a8" text-anchor="middle">MASTER CLASS</text>'),
};
function stilWahl(id, optionen, aktuell) {
  return `<div class="stil-wahl" id="${id}" role="radiogroup">${optionen.map((o) => `<button type="button" role="radio" class="stil-karte${o.wert === aktuell ? ' on' : ''}" data-wert="${o.wert}" aria-checked="${o.wert === aktuell}">${o.bild}<b>${o.titel}</b><small>${o.text}</small></button>`).join('')}</div>`;
}
function stilWahlBinden(root, id, aenderung) {
  const g = root.querySelector('#' + id);
  g.querySelectorAll('.stil-karte').forEach((b) => b.addEventListener('click', () => {
    if (b.disabled) return;
    g.querySelectorAll('.stil-karte').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
    aenderung?.(b.dataset.wert);
  }));
}
const stilWert = (root, id) => root.querySelector(`#${id} .stil-karte.on`)?.dataset.wert;
function stilSperren(root, id, wert, grund, statt) {
  const b = root.querySelector(`#${id} [data-wert="${wert}"]`); if (!b) return;
  b.disabled = true; b.title = grund; b.querySelector('small').textContent = grund;
  if (b.classList.contains('on')) root.querySelector(`#${id} [data-wert="${statt}"]`)?.click();
}

// Gebäude mit Reihen-Bauplan: Anschlüsse [Band ein, Rohr ein, Band aus, Rohr aus] (wie lib/fabrik.mjs GEO)
const ANSCHLUSS = {
  Build_SmelterMk1_C: [1, 0, 1, 0], Build_ConstructorMk1_C: [1, 0, 1, 0], Build_AssemblerMk1_C: [2, 0, 1, 0], Build_FoundryMk1_C: [2, 0, 1, 0],
  Build_ManufacturerMk1_C: [4, 0, 1, 0], Build_OilRefinery_C: [1, 1, 1, 1], Build_Blender_C: [2, 2, 1, 1], Build_Packager_C: [1, 1, 1, 1], Build_Converter_C: [2, 0, 1, 1], Build_HadronCollider_C: [2, 1, 1, 0], Build_QuantumEncoder_C: [3, 1, 1, 1],
};
const kurzGeb = (g) => g.replace(/^Build_/, '').replace(/Mk1_C$|_C$/, '');

export class PlanerUI {
  constructor(app) {
    this.app = app;
    this.plan = LEER();
    try { const s = JSON.parse(localStorage.getItem(SPEICHER) || 'null'); if (s?.ziele) this.plan = { ...this.plan, ...s }; } catch { /* egal */ }
    // Welt-Planer: mehrere Fabriken; der bisherige Einzelplan wird zur ersten Fabrik
    try { this.welt = JSON.parse(localStorage.getItem(WELT_SPEICHER) || 'null'); } catch { this.welt = null; }
    if (!this.welt?.fabriken?.length) this.welt = { fabriken: [{ name: 'Fabrik 1', plan: this.plan }], aktiv: 0 };
    this.welt.aktiv = Math.min(this.welt.aktiv || 0, this.welt.fabriken.length - 1);
    this.welt.miner ||= 3; this.welt.takt ||= 250;
    this.plan = { ...LEER(), ...this.welt.fabriken[this.welt.aktiv].plan };
    this.ansicht = { x: 0, y: 0, z: 1 };
    this.ergebnis = null;
    this.gebaut = false;
  }
  get kat() { return this.app.kat; }
  speichern() {
    if (this.grundlage) return;
    this.welt.fabriken[this.welt.aktiv].plan = this.plan;
    try { localStorage.setItem(SPEICHER, JSON.stringify(this.plan)); localStorage.setItem(WELT_SPEICHER, JSON.stringify(this.welt)); } catch { /* egal */ }
  }
  // ------------------------------------------------------------ Mehrere Fabriken
  fabrikListe() {
    const sel = $('pl-fabrik'); if (!sel) return;
    sel.innerHTML = this.welt.fabriken.map((f, i) => `<option value="${i}"${i === this.welt.aktiv ? ' selected' : ''}>${esc(f.name)}</option>`).join('');
    $('pl-fabrik-weg').disabled = this.welt.fabriken.length < 2;
  }
  fabrikWechseln(i) {
    if (this.grundlage) { this.app.toast('Erst „Zurück zu meinem Plan“ wählen.', 'err'); this.fabrikListe(); return; }
    this.speichern();
    this.welt.aktiv = i; this.plan = { ...LEER(), ...this.welt.fabriken[i].plan };
    this.eingepasst = false; this.speichern(); this.fabrikListe();
    $('pl-modus').value = this.plan.modus || 'einfach'; $('pl-takt').value = String(this.plan.takt || 100); this.modusHinweis();
    this.zeichneEingaben(); this.rechnen();
    if (this.seiteArt === 'welt') this.seiteZeichnen();
  }
  async fabrikNeu() {
    const name = await eingabe({ titel: 'Neue Fabrik', wert: `Fabrik ${this.welt.fabriken.length + 1}`, ok: 'Anlegen' }); if (!name) return;
    this.speichern();
    this.welt.fabriken.push({ name: name.slice(0, 60), plan: { ...LEER(), modus: this.plan.modus, alternativen: this.plan.alternativen } });
    this.fabrikWechseln(this.welt.fabriken.length - 1);
  }
  async fabrikUmbenennen() {
    const f = this.welt.fabriken[this.welt.aktiv];
    const name = await eingabe({ titel: 'Fabrik umbenennen', wert: f.name, ok: 'Umbenennen' }); if (!name) return;
    f.name = name.slice(0, 60); this.speichern(); this.fabrikListe(); if (this.seiteArt === 'welt') this.seiteZeichnen();
  }
  async fabrikLoeschen() {
    if (this.welt.fabriken.length < 2) return;
    const f = this.welt.fabriken[this.welt.aktiv];
    if (!(await frage({ art: 'loeschen', titel: `„${f.name}“ löschen?`, text: 'Die Fabrik wird aus dem Welt-Plan entfernt (ihre Ziele und Zulieferungen).', ok: 'Löschen' }))) return;
    this.welt.fabriken.splice(this.welt.aktiv, 1);
    this.welt.aktiv = Math.max(0, this.welt.aktiv - 1); this.plan = { ...LEER(), ...this.welt.fabriken[this.welt.aktiv].plan };
    this.fabrikWechseln(this.welt.aktiv);
  }
  /** Ergebnis einer beliebigen Fabrik (ohne die aktive Anzeige zu ändern) */
  ergebnisVon(plan) {
    if (!plan.ziele?.some((z) => z.item && z.menge > 0)) return null;
    try { return (plan.modus || 'einfach') === 'einfach' ? rechne(this.kat, plan) : rechneOptimal(this.kat, plan); } catch { return null; }
  }

  show() {
    if (!this.gebaut) this.aufbauen();
    if (!this.kat) { $('pl-info').innerHTML = '<p class="muted">Spieldaten fehlen – bitte in den Einstellungen den Satisfactory-Ordner angeben.</p>'; return; }
    this.itemListe();
    this.zeichneEingaben();
    this.rechnen();
  }

  // ------------------------------------------------------------ Aufbau
  aufbauen() {
    this.gebaut = true;
    $('pl-ziel-neu').addEventListener('click', async () => {
      const id = await this.itemWahl('Was soll herauskommen?');
      if (!id) return;
      this.plan.ziele.push({ item: id, menge: 10 }); this.speichern(); this.zeichneEingaben(); this.rechnen();
      document.querySelector('.pl-zeile[data-liste="ziele"]:last-child .pl-menge')?.select();
    });
    $('pl-vorh-neu').addEventListener('click', async () => {
      const id = await this.itemWahl('Was wird angeliefert?', null, true);
      if (!id) return;
      this.plan.vorhanden.push({ item: id, menge: 60 }); this.speichern(); this.zeichneEingaben(); this.rechnen();
      document.querySelector('.pl-zeile[data-liste="vorhanden"]:last-child .pl-menge')?.select();
    });
    $('pl-zuruecksetzen').addEventListener('click', () => { this.plan.wahl = {}; this.speichern(); this.rechnen(); });
    $('pl-takt').value = String(this.plan.takt || 100);
    $('pl-takt').addEventListener('change', (e) => { this.plan.takt = +e.target.value; this.speichern(); this.rechnen(); });
    $('pl-modus').value = this.plan.modus || 'einfach';
    $('pl-modus').addEventListener('change', (e) => { this.plan.modus = e.target.value; this.speichern(); this.modusHinweis(); this.rechnen(); });
    $('pl-alt').addEventListener('click', () => this.alternativenWahl());
    this.modusHinweis();
    $('pl-fit').addEventListener('click', () => this.einpassen());
    document.querySelectorAll('[name=pl-ansicht]').forEach((r) => r.addEventListener('change', () => this.zeichneErgebnis()));
    $('pl-bp').addEventListener('click', () => this.stufeWaehlen());
    // Baukasten (Test): Plan übergeben (gleicher Browser) und Reißbrett öffnen
    $('pl-baukasten')?.addEventListener('click', () => {
      const r = this.ergebnis || this.rechnen?.();
      if (!this.plan.ziele?.some((z) => z.item && z.menge > 0)) { this.app.toast('Erst ein Ziel eingeben.', 'err'); return; }
      try { localStorage.setItem('bs-baukasten-uebergabe', JSON.stringify({ zeit: Date.now(), name: this.welt?.fabriken?.[this.welt.aktiv]?.name || 'Planer', plan: { ziele: this.plan.ziele, vorhanden: this.plan.vorhanden, wahl: r?.wahl || this.plan.wahl, modus: this.plan.modus, alternativen: this.plan.alternativen, takt: this.plan.takt } })); } catch { /* egal */ }
      if (this.app.baukastenOeffnen) this.app.baukastenOeffnen(true); else window.open('baukasten.html?planer=1', 'bs-baukasten');
    });
    $('pl-tafel').addEventListener('click', () => this.plantafelDialog());
    $('pl-mc').addEventListener('click', () => this.masterclassWahl());
    // Master Class ist privat (eigene Sammlung): Knopf nur zeigen, wenn Vorlagen vorhanden sind
    $('pl-mc').hidden = true;
    fetch('/api/masterclass').then((x) => x.json()).then((j) => {
      this.mcListe = j.eintraege || []; $('pl-mc').hidden = !this.mcListe.length;
      if (this.mcRezeptKarte().size) { $('pl-mcrz-zeile').hidden = false; $('pl-mcrz').checked = this.plan.mcRezepte !== false; if (this.plan.mcRezepte !== false) this.rechnen(); }
    }).catch(() => {});
    $('pl-mcrz').addEventListener('change', (e) => { this.plan.mcRezepte = e.target.checked; this.speichern(); this.rechnen(); });
    $('pl-aus-spielstand').addEventListener('click', () => this.seite('produktion'));
    $('pl-fabrik').addEventListener('change', (e) => this.fabrikWechseln(+e.target.value));
    $('pl-fabrik-neu').addEventListener('click', () => this.fabrikNeu());
    $('pl-fabrik-name').addEventListener('click', () => this.fabrikUmbenennen());
    $('pl-fabrik-weg').addEventListener('click', () => this.fabrikLoeschen());
    this.fabrikListe();
    document.querySelectorAll('.pl-wz[data-seite]').forEach((b) => b.addEventListener('click', () => this.seite(b.dataset.seite)));
    // Klick ins Leere (Graph, Liste, rechte Spalte) schließt das Seitenfeld; links (Eingaben) bleibt es offen
    document.addEventListener('pointerdown', (e) => {
      if (!this.seiteArt || $('view-planer').hidden || $('pl-seite').contains(e.target)) return;
      if (e.target.closest('.pl-stage, #pl-info')) this.seite(this.seiteArt);
    });
    $('pl-auto').addEventListener('click', () => { this.plan.layout = {}; this.speichern(); this.zeichneGraph(); this.einpassen(); });
    // Graph: Hintergrund ziehen = Ansicht verschieben, Kasten ziehen = Kasten verschieben, Kasten klicken = Rezept wählen
    const svg = $('pl-svg');
    let zug = null;
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const kn = e.target.closest('.pl-knoten');
      if (kn) {
        const k = this.knoten?.get(kn.dataset.key);
        zug = { art: 'knoten', key: kn.dataset.key, schritt: kn.dataset.schritt, bp: !!e.target.closest('.pl-bp-knopf'), x: e.clientX, y: e.clientY, kx: k?.x || 0, ky: k?.y || 0, bewegt: false };
      } else zug = { art: 'ansicht', x: e.clientX, y: e.clientY, ax: this.ansicht.x, ay: this.ansicht.y };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', (e) => {
      if (!zug) return;
      const dx = e.clientX - zug.x, dy = e.clientY - zug.y;
      if (zug.art === 'ansicht') { this.ansicht.x = zug.ax + dx; this.ansicht.y = zug.ay + dy; this.transform(); return; }
      if (!zug.bewegt && Math.hypot(dx, dy) < 4) return;
      zug.bewegt = true;
      svg.classList.add('zieht');
      (this.plan.layout ||= {})[zug.key] = [Math.round(zug.kx + dx / this.ansicht.z), Math.round(zug.ky + dy / this.ansicht.z)];
      if (!this.rafZug) this.rafZug = requestAnimationFrame(() => { this.rafZug = 0; this.zeichneGraph(); });
    });
    const ende = () => {
      if (!zug) return;
      svg.classList.remove('zieht');
      if (zug.art === 'knoten') {
        if (zug.bewegt) this.speichern();
        else if (zug.schritt !== undefined) { if (zug.bp) this.blaupauseDialog(+zug.schritt); else this.schrittWaehlen(+zug.schritt); }
      }
      zug = null;
    };
    svg.addEventListener('pointerup', ende);
    svg.addEventListener('pointercancel', () => { zug = null; svg.classList.remove('zieht'); });
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const f = Math.exp(-e.deltaY * 0.0015), z = Math.min(3, Math.max(0.2, this.ansicht.z * f));
      this.ansicht.x = mx - (mx - this.ansicht.x) * (z / this.ansicht.z); this.ansicht.y = my - (my - this.ansicht.y) * (z / this.ansicht.z); this.ansicht.z = z;
      this.transform();
    }, { passive: false });
  }

  /** Datalist mit allen Items, die hergestellt oder angeliefert werden können */
  itemListe() {
    if (this.namen) return;
    const herstellbar = rezepteJeItem(this.kat);
    this.namen = new Map(); this.ids = new Map();
    const opts = [];
    for (const [id, it] of Object.entries(this.kat.items)) {
      if (!herstellbar[id] && !istRohstoff(this.kat, id)) continue;
      this.namen.set(id, it.name); this.ids.set(it.name.toLowerCase(), id);
      opts.push(it.name);
    }
    opts.sort((a, b) => a.localeCompare(b, 'de'));
    $('pl-items').innerHTML = opts.map((n) => `<option value="${esc(n)}">`).join('');
  }
  chip(z) { return `<span class="pl-rz-chip" title="${esc(this.itemName(z.item))}">${itemBild(this.kat, z.item, 'mini')}<span data-no-i18n>${fmt(z.proMin, 1)} ${esc(this.itemName(z.item))}</span></span>`; }
  itemName(id) { return this.kat.items[id]?.name || id; }
  einheit(id) { return this.kat.items[id]?.form === 'Flüssig' || this.kat.items[id]?.form === 'Gas' ? 'm³/min' : '/min'; }
  itemTile(id, gross) {
    const it = this.kat.items[id];
    const icon = it && iconFile(it.icon);
    const img = icon && ICONS.has(icon) ? `<img src="icons/${encodeURI(icon)}" alt="" loading="lazy" onerror="this.remove()">` : '';
    return `<span class="tile pl-tile${gross ? ' gross' : ''}" data-no-i18n>${esc((it?.name || id).slice(0, 2).toUpperCase())}${img}</span>`;
  }

  /** Bildauswahl aller Items, gruppiert nach dem Gebäude, das sie (standardmäßig) herstellt */
  itemWahl(titel, aktuell = null, zulieferung = false) {
    if (!this.wahlEintraege) {
      const liste = rezepteJeItem(this.kat), gName = (g) => this.kat.gebaeude[g]?.name || kurzGeb(g);
      this.wahlEintraege = [];
      for (const [id, it] of Object.entries(this.kat.items)) {
        const roh = istRohstoff(this.kat, id);
        if (!liste[id] && !roh) continue;
        const r = roh ? null : this.kat.rezepte[standardRezept(this.kat, id, liste)];
        const geb = r?.gebaeude.find((g) => PRODUKTION.includes(g));
        const fl = it.form === 'Flüssig' || it.form === 'Gas';
        this.wahlEintraege.push({ id, name: it.name, gruppe: roh ? 'Rohstoffe' : /FICSMAS/i.test(it.name) ? 'FICSMAS (Event)' : gName(geb), bild: itemBild(this.kat, id), marke: fl ? (it.form === 'Gas' ? 'Gas' : 'flüssig') : '',
          suche: `${it.beschreibung || ''}`, wert: it.sinkPunkte || 0 });
      }
      this.wahlEintraege.sort((a, b) => a.wert - b.wert || a.name.localeCompare(b.name, 'de'));
      this.wahlReihe = ['Rohstoffe', ...PRODUKTION.map(gName), 'FICSMAS (Event)'];
    }
    return bildwahl({ titel, eintraege: this.wahlEintraege, aktuell, gruppenReihe: this.wahlReihe,
      hinweis: zulieferung ? 'Was kommt schon fertig an (z. B. vom Band nebenan)? Klick auf ein Bild wählt es aus.' : 'Klick auf ein Bild wählt es aus. Gruppiert nach dem Gebäude, das es herstellt; innerhalb grob nach Aufwand sortiert.' });
  }

  zeichneEingaben(fokusLetzter, art = 'ziele') {
    const zeile = (liste, x, i) => `<div class="pl-zeile" data-liste="${liste}" data-i="${i}">
        <button type="button" class="pl-tile-knopf" title="Aus Bildern wählen">${x.item ? this.itemTile(x.item) : '<span class="tile pl-tile leer"></span>'}</button>
        <input type="text" class="pl-item" list="pl-items" value="${esc(x.item ? this.itemName(x.item) : '')}" placeholder="${liste === 'ziele' ? 'Was soll herauskommen?' : 'Was wird angeliefert?'}" spellcheck="false" data-no-i18n-value>
        <input type="number" class="pl-menge" min="0" step="any" value="${x.menge}" title="Menge pro Minute">
        <button type="button" class="ab-del pl-weg" title="Entfernen" aria-label="Entfernen">✕</button></div>`;
    $('pl-ziele').innerHTML = this.plan.ziele.map((x, i) => zeile('ziele', x, i)).join('') || '<p class="muted">Noch kein Ziel – unten „+ Ziel“.</p>';
    $('pl-vorhanden').innerHTML = this.plan.vorhanden.map((x, i) => zeile('vorhanden', x, i)).join('') || '<p class="muted">Nichts – alle Rohstoffe werden als Zulieferung ausgewiesen.</p>';
    document.querySelectorAll('.pl-zeile').forEach((z) => {
      const liste = this.plan[z.dataset.liste], x = liste[+z.dataset.i];
      z.querySelector('.pl-item').addEventListener('change', (e) => {
        const id = this.ids.get(e.target.value.trim().toLowerCase());
        if (!id) { e.target.classList.add('fehler'); return; }
        e.target.classList.remove('fehler'); x.item = id; this.speichern(); this.zeichneEingaben(); this.rechnen();
      });
      z.querySelector('.pl-tile-knopf').addEventListener('click', async () => {
        const id = await this.itemWahl(z.dataset.liste === 'ziele' ? 'Was soll herauskommen?' : 'Was wird angeliefert?', x.item, z.dataset.liste !== 'ziele');
        if (!id) return;
        x.item = id; this.speichern(); this.zeichneEingaben(); this.rechnen();
      });
      z.querySelector('.pl-menge').addEventListener('input', (e) => { x.menge = Math.max(0, +e.target.value || 0); this.speichern(); clearTimeout(this.tRechne); this.tRechne = setTimeout(() => this.rechnen(), 250); });
      z.querySelector('.pl-weg').addEventListener('click', () => { liste.splice(+z.dataset.i, 1); this.speichern(); this.zeichneEingaben(); this.rechnen(); });
    });
    if (fokusLetzter) document.querySelector(`.pl-zeile[data-liste="${art}"]:last-child .pl-item`)?.focus();
  }

  /** Hinweis zum Rechenweg und Zahl der erlaubten Alternativrezepte */
  modusHinweis() {
    const m = this.plan.modus || 'einfach', a = this.plan.alternativen;
    const n = a === 'alle' ? Object.values(this.kat?.rezepte || {}).filter((r) => r.alternativ).length : (a || []).length;
    $('pl-modus-hilfe').textContent = m === 'einfach' ? 'Je Item das gewählte Rezept (Tabelle) – wie bisher.'
      : m === 'optimal' ? `Rechnet die ganze Fabrik auf einmal mit möglichst wenig Rohstoffen (knappe Erze zählen mehr). Kreisläufe und Nebenprodukte gehen auf. Erlaubte Alternativrezepte: ${n}.`
        : `So viel wie möglich von den Zielen (im Verhältnis ihrer Mengen) aus den Zulieferungen unter „Vorhanden“. Erlaubte Alternativrezepte: ${n}.`;
    $('pl-alt').hidden = m === 'einfach';
  }
  /** Erlaubte Alternativrezepte wählen (für „Optimal“ und „Maximum“) */
  alternativenWahl() {
    const alle = Object.entries(this.kat.rezepte).filter(([, r]) => r.alternativ).sort((a, b) => a[1].name.localeCompare(b[1].name));
    const an = this.plan.alternativen === 'alle' ? new Set(alle.map(([id]) => id)) : new Set(this.plan.alternativen || []);
    let d = $('dlg-pl-alt');
    if (!d) { d = document.createElement('dialog'); d.id = 'dlg-pl-alt'; d.className = 'dlg-gross'; document.body.appendChild(d); }
    d.innerHTML = `<form method="dialog" class="dlg"><h2>Alternativrezepte</h2>
      <p class="muted">Angehakte Rezepte darf der Optimierer nutzen (z. B. die, die du im Spiel freigeschaltet hast). Er nimmt nur die, die sich lohnen.</p>
      <div class="pl-alt-kopf"><input type="search" id="pl-alt-suche" placeholder="Suchen …" aria-label="Suchen"><button type="button" class="btn small" id="pl-alt-alle">Alle</button><button type="button" class="btn small" id="pl-alt-keine">Keine</button></div>
      <div class="pl-alt-liste">${alle.map(([id, r]) => `<label class="check" data-n="${esc((r.name + ' ' + r.produkte.map((p) => this.itemName(p.item)).join(' ')).toLowerCase())}"><input type="checkbox" value="${esc(id)}"${an.has(id) ? ' checked' : ''}> <span data-no-i18n>${esc(r.name.replace(/^Alternativ: /, ''))}</span> <small class="muted" data-no-i18n>${esc(r.produkte.map((p) => this.itemName(p.item)).join(', '))} · ${esc(this.kat.gebaeude[r.gebaeude[0]]?.name || '')}</small></label>`).join('')}</div>
      <div class="dlg-actions"><button type="button" class="btn" value="nein">Abbrechen</button><button type="button" class="btn primary" id="pl-alt-ok">Übernehmen</button></div></form>`;
    const boxen = () => [...d.querySelectorAll('.pl-alt-liste input')];
    d.querySelector('#pl-alt-suche').addEventListener('input', (e) => { const q = e.target.value.toLowerCase(); d.querySelectorAll('.pl-alt-liste label').forEach((l) => { l.hidden = q && !l.dataset.n.includes(q); }); });
    d.querySelector('#pl-alt-alle').addEventListener('click', () => boxen().forEach((b) => { if (!b.closest('label').hidden) b.checked = true; }));
    d.querySelector('#pl-alt-keine').addEventListener('click', () => boxen().forEach((b) => { if (!b.closest('label').hidden) b.checked = false; }));
    d.querySelector('[value=nein]').addEventListener('click', () => d.close());
    d.querySelector('#pl-alt-ok').addEventListener('click', () => {
      const ids = boxen().filter((b) => b.checked).map((b) => b.value);
      this.plan.alternativen = ids.length === alle.length ? 'alle' : ids;
      this.speichern(); d.close(); this.modusHinweis(); this.rechnen();
    });
    d.showModal();
  }

  /** Item → { rezept, mc } aus den eigenen Master-Class-Fabriken (Hauptprodukt des Rezepts). Bei mehreren: Fabrik, die ein Ziel herstellt, dann die mit mehr Maschinen. */
  mcRezeptKarte() {
    const karte = new Map(); if (!this.kat || !this.mcListe?.length) return karte;
    const ziele = new Set((this.plan.ziele || []).map((z) => z.item));
    for (const e of this.mcListe) {
      if (e.art !== 'Fabrik') continue;
      const zielFabrik = (e.end || []).some((it) => ziele.has(it)) ? 1000 : 0;
      for (const [id, n] of Object.entries(e.rezepte || {})) {
        const r = this.kat.rezepte[id]; if (!r) continue;
        const it = r.produkte[0].item, wert = zielFabrik + n, alt = karte.get(it);
        if (!alt || wert > alt.wert) karte.set(it, { rezept: id, mc: e.name, wert });
      }
    }
    return karte;
  }
  /** Plan für die Rechnung: Master-Class-Rezepte als Vorgabe (eigene Wahl geht vor), im Optimierer als erlaubte Alternativen */
  planMitMc() {
    if (this.plan.mcRezepte === false) return this.plan;
    const karte = this.mcRezeptKarte(); if (!karte.size) return this.plan;
    const wahl = {}; for (const [it, x] of karte) wahl[it] = x.rezept;
    const altMc = [...karte.values()].map((x) => x.rezept).filter((id) => this.kat.rezepte[id]?.alternativ);
    const alternativen = this.plan.alternativen === 'alle' ? 'alle' : [...new Set([...(this.plan.alternativen || []), ...altMc])];
    return { ...this.plan, wahl: { ...wahl, ...this.plan.wahl }, alternativen };
  }
  rechnen() {
    if (!this.kat) return;
    const ziele = this.plan.ziele.filter((z) => z.item && z.menge > 0);
    if (!ziele.length) { this.ergebnis = null; this.zeichneErgebnis(); return; }
    const plan = this.planMitMc();
    this.ergebnis = (this.plan.modus || 'einfach') === 'einfach' ? rechne(this.kat, plan) : rechneOptimal(this.kat, plan);
    if (this.seiteArt === 'welt') { const d = this.spDaten?.['welt|' + this.spielstandId]; if (d) this.seiteWelt(d); }
    if (this.seiteArt === 'bau') { const d = this.spDaten?.['bau|' + this.spielstandId]; if (d) this.seiteBau(d); }
    this.zeichneErgebnis();
  }

  // ------------------------------------------------------------ Ergebnis
  zeichneErgebnis() {
    const r = this.ergebnis, info = $('pl-info');
    if (!r) { info.innerHTML = '<p class="muted">Links ein Ziel eingeben, z. B. „Modularer Rahmen“ 10 pro Minute.</p>'; $('pl-g').innerHTML = ''; $('pl-status').textContent = '–'; return; }
    const menge = (it, v) => `${fmt(v, 2)} ${this.einheit(it)}`;
    const liste = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([it, v]) => `<li>${this.itemTile(it)}<span data-no-i18n>${esc(this.itemName(it))}</span><b>${menge(it, v)}</b></li>`).join('');
    const maschinen = {};
    for (const s of r.schritte) maschinen[s.gebaeude] = (maschinen[s.gebaeude] || 0) + s.anzahl;
    info.innerHTML = `
      <div class="label">Zulieferung (Input)</div><ul class="pl-liste">${liste({ ...r.rohstoffe, ...r.fehlt })}${liste(r.vorhanden)}</ul>
      <div class="label">Ergebnis (Output)</div><ul class="pl-liste">${r.ziele.map((z) => `<li>${this.itemTile(z.item)}<span data-no-i18n>${esc(this.itemName(z.item))}</span><b>${menge(z.item, z.menge)}</b></li>`).join('')}</ul>
      ${Object.keys(r.ueberschuss).length ? `<div class="label">Nebenprodukte / Überschuss</div><ul class="pl-liste">${liste(r.ueberschuss)}</ul>` : ''}
      <div class="label">Maschinen</div><ul class="pl-liste">${Object.entries(maschinen).map(([g, n]) => `<li>${tileHtml(this.kat.gebaeude[g], g)}<span data-no-i18n>${esc(this.kat.gebaeude[g]?.name || g)}</span><b>${n}×</b></li>`).join('')}</ul>
      <p class="muted">Strombedarf ca. <b>${fmt(r.strom, 0)} MW</b></p>
      ${(() => { const b = benoetigt(this.kat, r.schritte); return b.stufe || b.extra.length ? `<div class="label">Freischaltung</div><p class="pl-frei">${b.stufe ? `Braucht <b>Stufe ${b.stufe.stufe}</b>${b.stufe.name ? ` <span data-no-i18n>(${esc(b.stufe.name)})</span>` : ''}` : ''}${b.extra.length ? `<br><span class="muted">außerdem:</span> <span data-no-i18n>${b.extra.map((x) => esc(x.name)).join(', ')}</span>` : ''}</p>` : ''; })()}
      ${r.warnungen.map((w) => `<p class="err">${esc(w)}</p>`).join('')}`;
    $('pl-status').textContent = `${r.schritte.length} Fertigungsschritte · ${r.schritte.reduce((a, s) => a + s.anzahl, 0)} Maschinen · ${fmt(r.strom, 0)} MW${r.shards ? ` · ${r.shards} Power-Shards` : ''}`;
    const tabelle = document.querySelector('[name=pl-ansicht]:checked')?.value === 'liste';
    $('pl-svg').style.display = tabelle ? 'none' : ''; $('pl-tabelle').hidden = !tabelle; // SVG kennt .hidden nicht
    if (tabelle) this.zeichneTabelle(); else this.zeichneGraph();
  }

  zeichneTabelle() {
    const r = this.ergebnis;
    $('pl-tabelle').innerHTML = `<table class="pl-tab"><thead><tr><th>Schritt</th><th>Rezept</th><th>Maschinen</th><th>Takt</th><th>Input</th><th>Output</th><th></th></tr></thead><tbody>
      ${r.schritte.map((s, i) => `<tr><td>${s.ebene + 1}</td><td>${this.rezeptSelect(s, i)}</td><td>${s.anzahl}× <span data-no-i18n>${esc(this.kat.gebaeude[s.gebaeude]?.name || s.gebaeude)}</span></td><td>${fmt(s.takt, 1)} %</td>
        <td>${s.zutaten.map((z) => `<span class="pl-chip" data-no-i18n>${esc(this.itemName(z.item))} ${fmt(z.proMin, 1)}</span>`).join(' ')}</td>
        <td>${s.produkte.map((z) => `<span class="pl-chip" data-no-i18n>${esc(this.itemName(z.item))} ${fmt(z.proMin, 1)}</span>`).join(' ')}</td>
        <td><button type="button" class="btn small" data-bp="${i}" title="Diese Stufe als Blaupause bauen">Blaupause …</button></td></tr>`).join('')}</tbody></table>`;
    $('pl-tabelle').querySelectorAll('[data-bp]').forEach((b) => b.addEventListener('click', () => this.blaupauseDialog(+b.dataset.bp)));
    $('pl-tabelle').querySelectorAll('select[data-item]').forEach((sel) => sel.addEventListener('change', () => { this.plan.wahl[sel.dataset.item] = sel.value; this.speichern(); this.rechnen(); }));
  }
  rezeptSelect(s) {
    const haupt = this.kat.rezepte[s.rezept].produkte[0].item;
    const opt = rezeptOptionen(this.kat, haupt), mc = this.mcRezeptKarte().get(haupt)?.rezept;
    return `<select data-item="${haupt}" data-no-i18n>${opt.map((o) => `<option value="${o.id}"${o.id === s.rezept ? ' selected' : ''}>${esc(o.name)}${o.alternativ ? ' (alt.)' : ''}${o.id === mc ? ' · Master Class' : ''}</option>`).join('')}</select>`;
  }

  /** Graph: Spalten = Ebenen (Zulieferung, Fertigungsschritte, Ergebnis), Kanten = Materialfluss */
  zeichneGraph() {
    const r = this.ergebnis, W = 220, H = 70, GX = 90, GY = 22;
    const knoten = new Map();
    const spalten = [];
    const setze = (key, spalte, daten) => { (spalten[spalte] ||= []).push(key); knoten.set(key, { ...daten, spalte }); };
    const maxE = Math.max(0, ...r.schritte.map((s) => s.ebene));
    for (const it of new Set([...Object.keys(r.rohstoffe), ...Object.keys(r.fehlt)])) setze(`roh:${it}`, 0, { art: 'roh', item: it });
    for (const it of Object.keys(r.vorhanden)) setze(`vorhanden:${it}`, 0, { art: 'vorhanden', item: it });
    r.schritte.forEach((s, i) => setze(i, s.ebene + 1, { art: 'schritt', s, i }));
    for (const z of r.ziele) setze(`ziel:${z.item}`, maxE + 2, { art: 'ziel', item: z.item, menge: z.menge });
    for (const it of Object.keys(r.ueberschuss)) setze(`rest:${it}`, maxE + 2, { art: 'rest', item: it, menge: r.ueberschuss[it] });
    const hoehe = Math.max(...spalten.map((c) => c?.length || 0));
    const lay = this.plan.layout || {};
    const sKey = (key) => (typeof key === 'number' ? `s:${r.schritte[key].rezept}` : key); // stabil, auch wenn sich die Reihenfolge ändert
    spalten.forEach((c, x) => (c || []).forEach((key, y) => {
      const k = knoten.get(key); k.key = sKey(key);
      const l = lay[k.key];
      if (l) { k.x = l[0]; k.y = l[1]; } else { k.x = x * (W + GX); k.y = (y + (hoehe - c.length) / 2) * (H + GY); }
    }));
    this.knoten = new Map([...knoten.values()].map((k) => [k.key, k]));
    const kanten = r.kanten.map((e) => {
      const a = knoten.get(e.von), b = knoten.get(e.nach);
      if (!a || !b) return '';
      const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, mx = (x1 + x2) / 2;
      const breite = Math.max(1.5, Math.min(9, Math.sqrt(e.menge) / 2));
      const fl = this.einheit(e.item) !== '/min';
      return `<g class="pl-kante${fl ? ' fluessig' : ''}"><path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" stroke-width="${breite}"/>
        <text x="${mx}" y="${(y1 + y2) / 2 - 4}" text-anchor="middle" data-no-i18n>${esc(this.itemName(e.item))} ${fmt(e.menge, 1)}</text></g>`;
    }).join('');
    const box = [...knoten.entries()].map(([key, k]) => {
      let titel, zeile2, klasse = k.art, extra = '';
      if (k.art === 'schritt') {
        const s = k.s;
        titel = s.name; zeile2 = `${s.anzahl}× ${this.kat.gebaeude[s.gebaeude]?.name || kurzGeb(s.gebaeude)} · ${fmt(s.takt, 1)} %`;
        extra = `data-schritt="${k.i}"`;
        if (s.alternativ) klasse += ' alt';
        if (this.gebautMarke(s, k.i)) { klasse += ' gebaut'; zeile2 = '▣ als Blaupause gebaut · ' + zeile2; }
      } else if (k.art === 'vorhanden') {
        // grün = Zulieferung deckt den Bedarf, orange = Rest muss zusätzlich zugeliefert werden
        const m = r.vorhanden[k.item], f = r.fehlt[k.item], genutzt = r.kanten.filter((e) => e.von === k.key).reduce((a, e) => a + e.menge, 0);
        titel = this.itemName(k.item);
        if (f) { klasse += ' teil'; zeile2 = `vorhanden ${fmt(m, 1)} · fehlt ${fmt(f, 1)} ${this.einheit(k.item)}`; }
        else if (genutzt < 0.01) { klasse += ' ungenutzt'; zeile2 = `nicht gebraucht · ${fmt(m, 1)} ${this.einheit(k.item)}`; }
        else { klasse += ' gesichert'; zeile2 = `Input gesichert · ${fmt(genutzt, 1)} von ${fmt(m, 1)} ${this.einheit(k.item)}`; }
      } else if (k.art === 'roh') {
        const m = r.rohstoffe[k.item] || r.fehlt[k.item];
        titel = this.itemName(k.item);
        if (r.fehlt[k.item]) { klasse += ' fehlt'; zeile2 = `fehlt – zuliefern · ${fmt(m, 1)} ${this.einheit(k.item)}`; } else zeile2 = `Zulieferung · ${fmt(m, 1)} ${this.einheit(k.item)}`;
      } else { titel = this.itemName(k.item); zeile2 = `${k.art === 'ziel' ? 'Ergebnis' : 'Überschuss'} · ${fmt(k.menge, 1)} ${this.einheit(k.item)}`; }
      const item = k.art === 'schritt' ? this.kat.rezepte[k.s.rezept].produkte[0].item : k.item;
      return `<g class="pl-knoten ${klasse}" transform="translate(${k.x},${k.y})" data-key="${esc(k.key)}" ${extra}>
        <rect width="${W}" height="${H}" rx="8"/>
        <foreignObject x="8" y="8" width="${W - 16}" height="${H - 16}"><div xmlns="http://www.w3.org/1999/xhtml" class="pl-kn">${this.itemTile(item, true)}<div><b data-no-i18n>${esc(titel)}</b><small>${esc(zeile2)}</small></div></div></foreignObject>
        ${k.art === 'schritt' ? `<g class="pl-bp-knopf${this.baubar(k.s) ? ' aus' : ''}" transform="translate(${W - 26},4)"><title>${this.baubar(k.s) ? esc(this.baubar(k.s)) : 'Blaupause dieser Stufe'}</title><rect width="22" height="22" rx="5"/><text x="11" y="16" text-anchor="middle">▣</text></g>` : ''}</g>`;
    }).join('');
    $('pl-g').innerHTML = `<g class="pl-kanten">${kanten}</g>${box}`;
    const alle = [...knoten.values()];
    this.groesse = { x: Math.min(...alle.map((k) => k.x)), y: Math.min(...alle.map((k) => k.y)) };
    this.groesse.w = Math.max(...alle.map((k) => k.x + W)) - this.groesse.x; this.groesse.h = Math.max(...alle.map((k) => k.y + H)) - this.groesse.y;
    if (!this.eingepasst) { this.einpassen(); this.eingepasst = true; } else this.transform();
  }
  einpassen() {
    const svg = $('pl-svg'), r = svg.getBoundingClientRect();
    if (!this.groesse || !r.width) return;
    const z = Math.min(1.2, Math.max(0.2, Math.min((r.width - 40) / this.groesse.w, (r.height - 40) / this.groesse.h)));
    this.ansicht = { z, x: (r.width - this.groesse.w * z) / 2 - (this.groesse.x || 0) * z, y: (r.height - this.groesse.h * z) / 2 - (this.groesse.y || 0) * z };
    this.transform();
  }
  transform() { $('pl-g').setAttribute('transform', `translate(${this.ansicht.x},${this.ansicht.y}) scale(${this.ansicht.z})`); }

  /** Klick auf einen Schritt im Graph: Rezept wählen */
  schrittWaehlen(i) {
    const s = this.ergebnis.schritte[i];
    const haupt = this.kat.rezepte[s.rezept].produkte[0].item;
    const opt = rezeptOptionen(this.kat, haupt), mcK = this.mcRezeptKarte();
    let d = $('dlg-pl-rezept');
    if (!d) { d = document.createElement('dialog'); d.id = 'dlg-pl-rezept'; d.className = 'dlg-gross'; document.body.appendChild(d); }
    const zeile = (o) => `<label class="pl-rz${o.id === s.rezept ? ' on' : ''}"><input type="radio" name="pl-rz" value="${o.id}"${o.id === s.rezept ? ' checked' : ''}>
      ${itemBild(this.kat, o.produkte[0].item, 'mittel')}
      <span><b data-no-i18n>${esc(o.name)}</b>${o.alternativ ? ' <span class="pl-alt">Alternativ</span>' : ''}${mcK.get(haupt)?.rezept === o.id ? ` <span class="pl-alt pl-mc-marke" title="So gebaut in deiner Master-Class-Fabrik „${esc(mcK.get(haupt).mc)}“">Master Class</span>` : ''}<small data-no-i18n>${esc(this.kat.gebaeude[o.gebaeude.find((g) => /^Build_/.test(g))]?.name || '')}</small>
      <span class="pl-rz-fluss">${o.zutaten.map((z) => this.chip(z)).join('<i>+</i>')}<i>→</i>${o.produkte.map((p) => this.chip(p)).join('<i>+</i>')}</span></span></label>`;
    d.innerHTML = `<form method="dialog" class="dlg"><h2>Rezept für <span data-no-i18n>${esc(this.itemName(haupt))}</span></h2>
      <p class="hint">Werte je Maschine bei 100 % Takt. Alternativrezepte müssen im Spiel freigeschaltet sein (Festplatten aus Absturzstellen).</p>
      <div class="pl-rz-liste">${opt.map(zeile).join('')}</div>
      <div class="dlg-actions"><button type="button" class="btn" id="pl-rz-bp" title="Diese Fertigungsstufe als Maschinenreihe mit Verteilern, Sammlern, Fundament und Schildern bauen">Blaupause dieser Stufe …</button><span style="flex:1"></span><button type="button" class="btn" value="nein">Abbrechen</button><button type="submit" class="btn primary">Übernehmen</button></div></form>`;
    d.querySelector('[value=nein]').addEventListener('click', () => d.close());
    d.querySelector('#pl-rz-bp').addEventListener('click', () => { d.close(); this.blaupauseDialog(i); });
    d.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = d.querySelector('input[name=pl-rz]:checked')?.value;
      if (v) { this.plan.wahl[haupt] = v; this.speichern(); this.rechnen(); }
      d.close();
    });
    d.showModal();
  }

  // ------------------------------------------------------------ Blaupause (Stufe 2: eine Fertigungsstufe als Reihe)
  /** Gehört Schritt s (Index i) zu der Blaupause, deren Grundlage gerade angezeigt wird? */
  gebautMarke(s, i) {
    const g = this.grundlage;
    if (!g) return false;
    if (g.schritt) return g.schritt.rezept === s.rezept;
    if (this.baubar(s)) return false;
    if (g.bis) { const j = this.ergebnis.schritte.findIndex((x) => x.rezept === g.bis); return j >= 0 && vorstufen(this.ergebnis, j).has(i); }
    return !!g.kette;
  }
  /** Toolbar „Blaupause erstellen …“: was soll gebaut werden? (ganze Fabrik / Teilfabrik bis … / einzelne Stufe) */
  async stufeWaehlen() {
    const r = this.ergebnis;
    let mc = [];
    try { mc = (await (await fetch('/api/masterclass')).json()).eintraege || []; } catch { /* ohne */ }
    const zielItems = new Set(r.ziele.map((z) => z.item)), stufenItems = new Set(r.schritte.map((x) => x.produkte[0].item));
    const haupt = (e) => (e.end?.length ? e.end : Object.keys(e.aus));
    const mcPasst = mc.filter((e) => e.art === 'Fabrik' && haupt(e).some((it) => zielItems.has(it)));
    const mcTeil = mc.filter((e) => e.art === 'Fabrik' && !mcPasst.includes(e) && haupt(e).some((it) => stufenItems.has(it)));
    this.mcListe = mc;
    if (!r?.schritte.length) { this.app.toast('Erst ein Ziel eingeben.', 'err'); return; }
    let d = $('dlg-pl-wahl');
    if (!d) { d = document.createElement('dialog'); d.id = 'dlg-pl-wahl'; d.className = 'bw-dlg'; document.body.appendChild(d); }
    const baubar = r.schritte.filter((x) => !this.baubar(x)).length;
    const geb = (s) => `${s.anzahl}× ${this.kat.gebaeude[s.gebaeude]?.name || kurzGeb(s.gebaeude)}`;
    const karte = (art, i, s, info, aus) => `<button type="button" class="bw-karte${aus ? ' aus' : ''}" data-art="${art}" data-i="${i}" title="${esc(aus || info)}"${aus ? ' disabled' : ''}>
        ${itemBild(this.kat, s.produkte[0].item)}<span class="bw-name" data-no-i18n>${esc(s.name)}</span><span class="bw-info">${esc(aus ? 'geht noch nicht' : info)}</span></button>`;
    const reihe = [...r.schritte.keys()].sort((a, b) => r.schritte[b].ebene - r.schritte[a].ebene); // Endprodukte zuerst
    const bisKarten = reihe.map((i) => {
      const s = r.schritte[i], v = vorstufen(r, i), nb = [...v].filter((k) => !this.baubar(r.schritte[k])).length;
      return karte('bis', i, s, v.size > 1 ? `mit ${v.size - 1} Vorstufe${v.size > 2 ? 'n' : ''} · ${[...v].reduce((a, k) => a + r.schritte[k].anzahl, 0)} Maschinen` : 'keine Vorstufen', nb ? '' : this.baubar(s));
    }).join('');
    const einzelKarten = reihe.map((i) => karte('einzeln', i, r.schritte[i], geb(r.schritte[i]), this.baubar(r.schritte[i]))).join('');
    const ziele = r.ziele.map((z) => this.itemName(z.item)).join(', ');
    d.innerHTML = `<div class="bw">
      <div class="bw-kopf"><h2>Was soll als Blaupause gebaut werden?</h2><button type="button" class="bw-zu" aria-label="Schließen">✕</button></div>
      <div class="bw-liste pl-wahl">
        <p class="hint pl-hinweis-funktional"><b>Funktionale Blaupausen:</b> Der Planer baut alles verbunden und lauffähig – Bänder, Verteiler, Strom –, aber schlicht auf einer Ebene, nicht als schönes oder platzsparendes Aufbau-Design.${mcPasst.length || mcTeil.length ? ' Für passende Fabriken gibt es im nächsten Schritt den Stil „Optimiert“ (fertige Master-Class-Vorlage).' : ''}</p>
        <h3 class="bw-g">1 · Ganze Fabrik – wie im Graph</h3>
        <button type="button" class="pl-wahl-gross" data-art="kette"${baubar ? '' : ' disabled'}>
          ${itemBild(this.kat, r.ziele[0].item, 'mittel')}
          <span><b>Alles bis zum Ergebnis: <span data-no-i18n>${esc(ziele)}</span></b>
          <small>${baubar} von ${r.schritte.length} Stufen · ${r.schritte.filter((x) => !this.baubar(x)).reduce((a, x) => a + x.anzahl, 0)} Maschinen · Reihen untereinander, mit Bändern und Förderliften verbunden. Rohstoffe kommen links an, das Ergebnis geht links hinaus. Flüssigkeiten laufen rechts in Rohren, ungenutzte feste Nebenprodukte gehen in eine AWESOME-Senke.</small></span></button>
        <h3 class="bw-g">2 · Teilfabrik – nur bis zu einer Stufe</h3>
        <p class="hint">Die gewählte Stufe samt allem, was ihr zuliefert. Ihr Produkt kommt als Ausgang heraus – z. B. erst die Eisenplatten-Produktion bauen und den Rest später.</p>
        <div class="bw-grid">${bisKarten}</div>
        <h3 class="bw-g">3 · Einzelne Stufe – eine Maschinenreihe</h3>
        <p class="hint">Nur diese Maschinen mit Verteilern, Sammlern, Strom und Schildern; Ein- und Ausgänge sind freie Bänder.</p>
        <div class="bw-grid">${einzelKarten}</div>
      </div>
      <div class="bw-fuss"><span class="muted bw-zahl">Ausgegraut = geht noch nicht – Maus darüber zeigt den Grund.</span><button type="button" class="btn small bw-abbr">Abbrechen</button></div></div>`;
    d.querySelector('.bw-zu').addEventListener('click', () => d.close());
    d.querySelector('.bw-abbr').addEventListener('click', () => d.close());
    d.onclick = (e) => { if (e.target === d) d.close(); };
    d.querySelectorAll('[data-art]').forEach((el) => el.addEventListener('click', () => {
      d.close();
      const art = el.dataset.art;
      this.blaupauseDialog(art === 'kette' ? 'kette' : +el.dataset.i, art);
    }));
    d.showModal();
  }
  baubar(s) {
    const a = ANSCHLUSS[s.gebaeude];
    if (!a) return 'Für dieses Gebäude gibt es noch keinen Reihen-Bauplan.';
    const fl = (it) => this.einheit(it) !== '/min';
    const n = (l, f) => l.filter((z) => fl(z.item) === f).length;
    if (n(s.zutaten, false) > a[0] || n(s.zutaten, true) > a[1] || n(s.produkte, false) > a[2] || n(s.produkte, true) > a[3]) return 'Die Zutaten/Produkte passen nicht auf die Anschlüsse dieses Gebäudes.';
    return '';
  }
  /** Zusammenfassung als Blaupausen-Beschreibung: Ziel, Freischaltung, Zulieferung, Überschuss, Maschinen, Strom */
  bpZusammenfassung(r, schritte, einzel) {
    const z = (v) => fmt(v, v < 10 ? 1 : 0), nm = (it) => this.itemName(it), e = (it) => (this.einheit(it) === '/min' ? '/min' : ' m³/min');
    const liste = (l, n = 6) => l.slice(0, n).map(([it, m]) => `${z(m)}${e(it)} ${nm(it)}`).join(', ') + (l.length > n ? ` (+${l.length - n})` : '');
    const zeilen = [];
    // Bilanz der gewählten Stufen: was hinein muss, was herauskommt
    const ein = {}, aus = {};
    for (const s of schritte) { for (const q of s.zutaten) ein[q.item] = (ein[q.item] || 0) + q.proMin; for (const q of s.produkte) aus[q.item] = (aus[q.item] || 0) + q.proMin; }
    for (const it of Object.keys(ein)) { const k = Math.min(ein[it], aus[it] || 0); ein[it] -= k; if (aus[it] != null) aus[it] -= k; }
    const sortiert = (o) => Object.entries(o).filter(([, m]) => m > 1e-6).sort((a, b) => b[1] - a[1]);
    if (einzel) zeilen.push(schritte.length === 1 ? `${einzel.anzahl}× ${this.kat.gebaeude[einzel.gebaeude]?.name || einzel.gebaeude}: ${einzel.name}` : `${t('Bis')} ${einzel.name}`);
    else zeilen.push(`${t('Ziel:')} ${r.ziele.map((x) => `${z(x.menge)}${e(x.item)} ${nm(x.item)}`).join(', ')}`);
    const fr = benoetigtText(benoetigt(this.kat, schritte)); if (fr) zeilen.push(`${t('Braucht:')} ${fr}`);
    const zu = sortiert(ein); if (zu.length) zeilen.push(`${t('Zulieferung:')} ${liste(zu)}`);
    const ab = sortiert(aus); if (ab.length) zeilen.push(`${t(einzel ? 'Ausgang:' : 'Ergebnis/Überschuss:')} ${liste(ab)}`);
    const masch = {}; for (const s of schritte) { const n = this.kat.gebaeude[s.gebaeude]?.name || s.gebaeude; masch[n] = (masch[n] || 0) + s.anzahl; }
    zeilen.push(`${t('Maschinen:')} ${Object.entries(masch).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, k]) => `${k}× ${n}`).join(', ')}`);
    const mw = schritte.reduce((a, s) => a + (this.kat.gebaeude[s.gebaeude]?.werte?.strom || 0) * s.anzahl * Math.pow((s.takt || 100) / 100, 1.321928), 0);
    if (mw) zeilen.push(t(`Strom: ca. ${fmt(mw, 0)} MW`));
    return zeilen.join('\n').slice(0, 1500);
  }
  blaupauseDialog(i, art = 'einzeln') {
    if (!this.mcListe) { // Master-Class-Vorlagen einmal laden (für den Stil „Optimiert“)
      this.mcListe = [];
      fetch('/api/masterclass').then((x) => x.json()).then((j) => { this.mcListe = j.eintraege || []; }).catch(() => {}).finally(() => this.blaupauseDialog(i, art));
      return;
    }
    const r = this.ergebnis;
    const bis = art === 'bis' ? r.schritte[i] : null;
    const kette = i === 'kette' || !!bis;
    const s = kette ? null : r.schritte[i];
    const umfang = bis ? vorstufen(r, i) : null;
    const baubare = r.schritte.filter((x, k) => !this.baubar(x) && (!umfang || umfang.has(k)));
    const grund = kette ? (baubare.length ? '' : 'Keine der Stufen lässt sich als Reihe bauen.') : this.baubar(s);
    let d = $('dlg-pl-bp');
    if (!d) { d = document.createElement('dialog'); d.id = 'dlg-pl-bp'; d.className = 'dlg-gross'; document.body.appendChild(d); }
    const sessions = (this.app.cfg?.sessions || []).filter((x) => !x.lib).map((x) => x.name);
    const ziel = this.bpZiel || this.app.spielSession?.() || sessions[0] || '';
    const zl = (l) => l.map((z) => `${fmt(z.proMin, 2)} ${this.einheit(z.item)} <span data-no-i18n>${esc(this.itemName(z.item))}</span>`).join(', ');
    let titel, beschreibung, aufbau, vorschlag;
    if (bis) {
      const teil = [...umfang].map((k) => r.schritte[k]);
      const nicht = teil.filter((x) => this.baubar(x));
      titel = `Teilfabrik bis ${bis.name}`;
      beschreibung = `${baubare.length} Stufen (${baubare.reduce((a, x) => a + x.anzahl, 0)} Maschinen): <span data-no-i18n>${teil.map((x) => esc(x.name)).join(', ')}</span> → Ausgang ${zl(bis.produkte)}`
        + (nicht.length ? `<br><span class="err">Nicht gebaut (kein Reihen-Bauplan): ${nicht.map((x) => esc(x.name)).join(', ')} – dafür entstehen freie Bänder mit Schild.</span>` : '');
      aufbau = 'Aufbau wie bei der ganzen Fabrik, nur mit dieser Stufe und ihren Vorstufen: Reihen untereinander, Verbindungen über die Logistik-Spalte mit Förderliften, Rohstoffe links rein, das Produkt der gewählten Stufe links hinaus. Strom: alle Reihen verkabelt.';
      vorschlag = `Planer_bis_${bis.name}`;
    } else if (kette) {
      const zz = r.ziele.map((z) => ({ item: z.item, proMin: z.menge }));
      const roh = Object.entries({ ...r.rohstoffe, ...r.fehlt, ...r.vorhanden }).map(([item, proMin]) => ({ item, proMin }));
      titel = 'ganze Kette';
      beschreibung = `${baubare.length} von ${r.schritte.length} Stufen (${baubare.reduce((a, x) => a + x.anzahl, 0)} Maschinen) · Zulieferung ${zl(roh)} → Ergebnis ${zl(zz)}`
        + (baubare.length < r.schritte.length ? `<br><span class="err">Nicht gebaut (kein Reihen-Bauplan): ${r.schritte.filter((x) => this.baubar(x)).map((x) => esc(x.name)).join(', ')} – dafür entstehen freie Bänder mit Schild.</span>` : '');
      aufbau = 'Aufbau: jede Stufe als eigene Reihe, die Reihen übereinander (Rohstoffseite zuerst). Alle Ein- und Ausgänge liegen links; daneben eine Logistik-Spalte: je Verbindung eine Spur – am Ausgang zweigt ein Splitter ab, ein Förderlift hebt auf 16 m, das Band läuft zur Zielreihe und ein Lift senkt es auf die Verteilerleitung. Rohstoffe kommen ganz links an (Schild „EINGANG“), das Ergebnis geht dort hinaus (Schild „AUSGANG“). Strom: alle Reihen verkabelt, ein Mast an dein Netz genügt.';
      vorschlag = `Planer_Kette_${r.ziele.map((z) => this.itemName(z.item)).join('_')}`;
    } else {
      titel = s.name;
      beschreibung = `${s.anzahl}× <span data-no-i18n>${esc(this.kat.gebaeude[s.gebaeude]?.name || s.gebaeude)}</span> in einer Reihe · Eingang ${zl(s.zutaten)} → Ausgang ${zl(s.produkte)}`;
      aufbau = 'Aufbau: Maschinen direkt nebeneinander, Verteiler (Splitter) vor jeder Maschine – bei mehreren Zutaten je Zutat eine eigene Leitung, jede weitere 4 m weiter außen und 2 m höher (Rohre immer über den Bändern), die Zuführungen laufen darüber hinweg –, Sammler (Merger) dahinter, Förderbänder verbunden, 8×1-Fundamente, je ein Schild am Eingang und am Ausgang. Vor jeder Maschine steht außerhalb der Leitungen ein Strommast, alles ist verkabelt – du musst nur noch einen Mast an dein Netz anschließen. Höher liegende Verteiler schweben (Stützen setzt du bei Bedarf selbst).';
      vorschlag = `Planer_${this.itemName(s.produkte[0].item)}_${fmt(s.produkte[0].proMin, 0)}`;
    }
    vorschlag = vorschlag.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').slice(0, 80);
    const zusammenfassung = this.bpZusammenfassung(r, kette ? (bis ? [...umfang].map((k) => r.schritte[k]) : r.schritte) : [s], kette && !bis ? null : (bis || s));
    // Stil „Optimiert“: fertige Master-Class-Vorlage, die das Ergebnis herstellt (nur wenn eigene Master-Class-Vorlagen da sind)
    const hauptMc = (e) => (e.end?.length ? e.end : Object.keys(e.aus || {}));
    const mcItems = new Set(kette ? (bis ? [bis.produkte[0].item] : r.ziele.map((z) => z.item)) : []);
    const mcPassend = (this.mcListe || []).filter((e) => e.art === 'Fabrik' && hauptMc(e).some((it) => mcItems.has(it)));
    const mcInfo = (e) => hauptMc(e).filter((it) => mcItems.has(it)).map((it) => `${fmt(e.aus[it], 1)} ${this.einheit(it)} ${this.itemName(it)}`).join(', ');
    const wasser = (kette ? baubare : [s]).some((x) => x.zutaten.some((z) => z.item === 'Desc_Water_C'));
    const wasserZeile = wasser ? `<label for="pl-bp-wasser">Wasser</label><label class="pl-bp-check"><input type="checkbox" id="pl-bp-wasser"${this.plan.wasser ? ' checked' : ''}> Wasserextraktoren mitbauen (je 120 m³/min, mit Strom – stehen dann auf dem Fundament, das geht im Spiel nur über Blaupausen)</label>` : '';
    d.innerHTML = `<form method="dialog" class="dlg"><h2>Blaupause: <span data-no-i18n>${esc(titel)}</span></h2>
      <p>${beschreibung}</p>
      ${grund && !mcPassend.length ? `<p class="err">${esc(grund)}</p>` : `
      ${kette ? `<div class="pl-bp-grid"><span class="label">Stil</span>${stilWahl('pl-bp-stil', [
        { wert: 'einfach', titel: 'Einfach', text: grund || 'Funktional auf einer Ebene – Reihen nebeneinander', bild: STIL_BILD.bpEinfach },
        { wert: 'etagen', titel: 'Etagen', text: grund || 'Je Fertigungsebene ein Boden übereinander, Förderlifte dazwischen – kompakte Grundfläche', bild: STIL_BILD.bpEtagen },
        ...(mcPassend.length ? [{ wert: 'optimiert', titel: 'Optimiert', text: 'Fertige Master-Class-Fabrik, unverändert übernommen (eigene Mengen)', bild: STIL_BILD.bpOptimiert }] : [])], grund ? 'optimiert' : (this.plan.bpStil === 'etagen' ? 'etagen' : 'einfach'))}
        ${mcPassend.length ? `<label for="pl-bp-mc" class="pl-bp-mcz">Vorlage</label><select id="pl-bp-mc" class="pl-bp-mcz" data-no-i18n>${mcPassend.map((e) => `<option value="${e.id}">${esc(e.name)} – ${esc(mcInfo(e))}</option>`).join('')}</select>` : ''}</div>` : ''}
      <p class="hint pl-bp-einfach">${esc(aufbau)} Alle Maschinen laufen mit 100 % – die Zulieferung begrenzt die Menge.</p>
      <p class="hint pl-hinweis-funktional pl-bp-einfach"><b>Funktionale Blaupause:</b> verbunden und lauffähig, aber schlicht gebaut – kein schönes Aufbau-Design. Mit „Etagen“ liegen die Fertigungsebenen übereinander (je Boden 4 m über der höchsten Maschine); Förderlifte gehen im Spiel bis 48 m.</p>
      <p class="hint pl-bp-optimiert" hidden>Die Master-Class-Vorlage wird 1:1 kopiert – mit ihren eigenen Mengen (siehe Auswahl), nicht mit denen deines Plans.</p>
      <div class="pl-bp-grid">
        <label for="pl-bp-band" class="pl-bp-einfach">Förderband höchstens</label><select id="pl-bp-band" class="pl-bp-einfach">${[1, 2, 3, 4, 5, 6].map((m) => `<option value="${m}"${m === (this.plan.band || 6) ? ' selected' : ''}>Mk.${m} (${[0, 60, 120, 270, 480, 780, 1200][m]}/min)</option>`).join('')}</select>
        ${wasserZeile}
        <label for="pl-bp-name">Name</label><input id="pl-bp-name" type="text" value="${esc((kette ? this.bpNameKette : this.bpName) || vorschlag)}" spellcheck="false">
        <label for="pl-bp-ziel">Speichern in</label><select id="pl-bp-ziel">${sessions.map((x) => `<option${x === ziel ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <label for="pl-bp-beschr" class="pl-bp-einfach">Beschreibung</label><textarea id="pl-bp-beschr" class="pl-bp-einfach" rows="6" style="font:inherit;font-size:13px;line-height:1.4;resize:vertical" maxlength="1500" spellcheck="false" data-no-i18n title="Erscheint im Spiel bei der Blaupause">${esc(zusammenfassung)}</textarea>
      </div>
      <p class="muted" id="pl-bp-info"></p>`}
      <div class="dlg-actions"><button type="button" class="btn" value="nein">Schließen</button>${grund && !mcPassend.length ? '' : '<button type="button" class="btn" id="pl-bp-3d">In 3D ansehen</button><button type="button" class="btn primary" id="pl-bp-ok">Als Blaupause speichern</button>'}</div></form>`;
    d.querySelector('[value=nein]').addEventListener('click', () => d.close());
    const planDaten = () => ({ ziele: this.plan.ziele, vorhanden: this.plan.vorhanden, wahl: this.ergebnis.wahl, layout: this.plan.layout || {}, modus: this.plan.modus, alternativen: this.plan.alternativen, takt: this.plan.takt });
    const daten = () => ({ ...(kette ? { kette: true, bis: bis ? bis.rezept : undefined, plan: planDaten(), etagen: stilWert(d, 'pl-bp-stil') === 'etagen' } : { schritt: { rezept: s.rezept, maschinen: s.maschinen } }), bandMax: +$('pl-bp-band').value, wasser: !!$('pl-bp-wasser')?.checked });
    const post = async (url, body) => {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' }, body: JSON.stringify(body) });
      const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status); return j;
    };
    const infoText = (i2) => (i2.reihen ? `${i2.objekte} Objekte · ${i2.reihen} Reihen · ${i2.maschinen} Maschinen · ${i2.verbindungen} Verbindungen (${i2.lifte} Förderlifte) · ${i2.eingaenge} Zulieferungen · ${i2.masten} Strommasten · ${i2.fundamente} Fundamente · ca. ${i2.groesse[0]} × ${i2.groesse[1]} m` : '') || `${i2.objekte} Objekte · ${i2.maschinen} Maschinen im Abstand ${i2.abstand / 100} m · ${i2.leitungen > 1 ? i2.leitungen + ' Verteilerleitungen · ' : ''}${i2.masten ? i2.masten + ' Strommasten · ' : ''} Bänder Mk.${i2.bandEin} (Eingang) / Mk.${i2.bandAus} (Ausgang) · ${i2.fundamente} Fundamente · ca. ${i2.groesse[0]} × ${i2.groesse[1]} m`;
    if (grund && !mcPassend.length) { d.showModal(); return; }
    const optimiert = () => mcPassend.length && stilWert(d, 'pl-bp-stil') === 'optimiert';
    const mcGewaehlt = () => mcPassend.find((e) => e.id === $('pl-bp-mc')?.value) || mcPassend[0];
    let nameAngepasst = false;
    const stilZeigen = () => {
      const o = optimiert();
      d.querySelectorAll('.pl-bp-einfach').forEach((el) => { el.hidden = o; });
      d.querySelectorAll('.pl-bp-optimiert, .pl-bp-mcz').forEach((el) => { el.hidden = !o; });
      if (!nameAngepasst) $('pl-bp-name').value = o ? ('MC_' + mcGewaehlt().name).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').slice(0, 80) : ((kette ? this.bpNameKette : this.bpName) || vorschlag);
    };
    if (kette) {
      stilWahlBinden(d, 'pl-bp-stil', (w) => { if (w !== 'optimiert') { this.plan.bpStil = w; this.speichern(); } stilZeigen(); });
      if (grund) { stilSperren(d, 'pl-bp-stil', 'einfach', grund, 'optimiert'); stilSperren(d, 'pl-bp-stil', 'etagen', grund, 'optimiert'); }
      $('pl-bp-mc')?.addEventListener('change', stilZeigen);
      $('pl-bp-name').addEventListener('input', () => { nameAngepasst = true; });
      stilZeigen();
    }
    $('pl-bp-band').addEventListener('change', (e) => { this.plan.band = +e.target.value; this.speichern(); });
    $('pl-bp-wasser')?.addEventListener('change', (e) => { this.plan.wasser = e.target.checked; this.speichern(); });
    $('pl-bp-name').addEventListener('input', (e) => { if (kette) this.bpNameKette = e.target.value; else this.bpName = e.target.value; });
    $('pl-bp-ziel').addEventListener('change', (e) => { this.bpZiel = e.target.value; });
    $('pl-bp-3d').addEventListener('click', async (e) => {
      if (optimiert()) { d.close(); this.mcListe ||= mcPassend; this.masterclassVorschau(mcGewaehlt()); return; }
      const b = e.currentTarget; b.disabled = true;
      try {
        const j = await post('/api/planer/vorschau', daten());
        if (this.app.dirty?.() && !confirm('Ungespeicherte Änderungen in der geöffneten Blaupause verwerfen?')) return;
        d.close();
        this.app.bp = j; this.app.setMode('editor'); this.app.openScene();
        if (this.app.mode !== '3d') $('v3d').click();
        $('pathtext').textContent = `Planer-Vorschau · ${titel} · ${infoText(j.info)} (nur ansehen – speichern im Planer)`;
        for (const w of j.info.warnungen || []) this.app.toast(w, 'err');
      } catch (err) { this.app.toast(err.message, 'err'); } finally { b.disabled = false; }
    });
    $('pl-bp-ok').addEventListener('click', async (e) => {
      const name = $('pl-bp-name').value.trim(), session = $('pl-bp-ziel').value;
      if (!name || /[\\/:*?"<>|]/.test(name)) { this.app.toast('Bitte einen gültigen Namen angeben (ohne \\ / : * ? " < > |).', 'err'); return; }
      const b = e.currentTarget; b.disabled = true; b.textContent = 'Wird erstellt …';
      if (optimiert()) {
        try {
          await post('/api/masterclass/kopieren', { id: mcGewaehlt().id, session, name });
          $('pl-bp-info').innerHTML = `Master-Class-Vorlage „${esc(mcGewaehlt().name)}“ als „${esc(name)}“ nach „${esc(session)}“ kopiert.`;
          this.app.toast(`Blaupause „${name}“ gespeichert.`, 'ok'); if ($('session').value === session) this.app.loadList();
        } catch (err) { this.app.toast(err.message, 'err'); } finally { b.disabled = false; b.textContent = 'Als Blaupause speichern'; }
        return;
      }
      try {
        const j = await post('/api/planer/blaupause', { ...daten(), session, name, plan: planDaten(), beschreibung: $('pl-bp-beschr')?.value.trim() || '' });
        $('pl-bp-info').innerHTML = `Gespeichert: ${esc(infoText(j.info))} · <a href="#" id="pl-bp-open">in „Blaupause“ öffnen</a>${(j.info.warnungen || []).map((w) => `<br><span class="err">${esc(w)}</span>`).join('')}`;
        $('pl-bp-open').addEventListener('click', async (ev) => { ev.preventDefault(); d.close(); this.app.setMode('editor'); $('session').value = session; await this.app.loadList(); this.app.openBlueprint(name); });
        this.app.zaehlerAktualisieren?.(); if ($('session').value === session) this.app.loadList();
        this.app.toast(`Blaupause „${name}“ gespeichert.`, 'ok');
      } catch (err) { this.app.toast(err.message, 'err'); } finally { b.disabled = false; b.textContent = 'Als Blaupause speichern'; }
    });
    d.showModal();
  }

  // ------------------------------------------------------------ Grundlage einer Planer-Blaupause ansehen
  async grundlageZeigen(id, bpName) {
    let j;
    try {
      const r = await fetch(`/api/planer/herkunft?id=${encodeURIComponent(id)}`, { headers: { 'X-BS': '1' } });
      j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status);
    } catch (e) { this.app.toast(`Planer-Grundlage nicht gefunden: ${e.message}`, 'err'); return; }
    if (!this.grundlage) this.eigenerPlan = this.plan;
    this.grundlage = { ...j, bpName };
    this.plan = { band: 6, stockwerke: 1, ...JSON.parse(JSON.stringify(j.plan)) };
    this.plan.layout ||= {};
    this.eingepasst = false;
    this.app.setMode('planer');
    this.zeigeGrundlageLeiste();
  }
  zeigeGrundlageLeiste() {
    const el = $('pl-grundlage');
    if (!this.grundlage) { el.hidden = true; el.innerHTML = ''; return; }
    const g = this.grundlage;
    el.hidden = false;
    el.innerHTML = `<span>Grundlage der Blaupause <b data-no-i18n>„${esc(g.bpName || g.name)}“</b>${g.datum ? ` vom ${new Date(g.datum).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}` : ''} – die gebaute Stufe ist markiert. Änderungen hier werden nicht gespeichert.</span>
      <button type="button" class="btn small" id="pl-gl-nehmen">Als meinen Plan übernehmen</button><button type="button" class="btn small primary" id="pl-gl-zurueck">Zurück zu meinem Plan</button>`;
    $('pl-gl-zurueck').addEventListener('click', () => { this.plan = this.eigenerPlan || this.plan; this.grundlage = null; this.eigenerPlan = null; this.eingepasst = false; this.zeigeGrundlageLeiste(); this.show(); });
    $('pl-gl-nehmen').addEventListener('click', () => { this.grundlage = null; this.eigenerPlan = null; this.speichern(); this.zeigeGrundlageLeiste(); this.show(); this.app.toast('Plan übernommen.', 'ok'); });
  }

  // ------------------------------------------------------------ Master Class: Vorlage ansehen / ins Spiel kopieren
  async masterclassVorschau(e) {
    try {
      const r = await fetch(`/api/masterclass/vorschau?id=${e.id}`); const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status);
      this.app.bp = j; this.app.setMode('editor'); this.app.openScene(); if (this.app.mode !== '3d') $('v3d').click();
      $('pathtext').textContent = `Master Class · ${e.name} (nur ansehen – kopieren im Planer)`;
    } catch (err) { this.app.toast(err.message, 'err'); }
  }
  masterclassDialog(id) {
    const e = (this.mcListe || []).find((x) => x.id === id);
    if (!e) return;
    let d = $('dlg-pl-mc');
    if (!d) { d = document.createElement('dialog'); d.id = 'dlg-pl-mc'; d.className = 'dlg-gross'; document.body.appendChild(d); }
    const sessions = (this.app.cfg?.sessions || []).filter((x) => !x.lib).map((x) => x.name);
    const ziel = this.bpZiel || this.app.spielSession?.() || sessions[0] || '';
    const liste = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([it, m]) => `<li>${itemBild(this.kat, it)}<span data-no-i18n>${esc(this.itemName(it))}</span><b>${fmt(m, 1)} ${this.einheit(it)}</b></li>`).join('');
    d.innerHTML = `<form method="dialog" class="dlg"><h2>Master Class: <span data-no-i18n>${esc(e.name)}</span></h2>
      ${e.beschreibung ? `<p data-no-i18n style="white-space:pre-line">${esc(e.beschreibung)}</p>` : ''}
      <p class="muted">${e.objekte} Objekte · ca. ${e.groesse[0]} × ${e.groesse[1]} × ${e.groesse[2]} m · ${Object.entries(e.maschinen).map(([c, n]) => `${n}× ${esc(this.kat.gebaeude[c]?.name || c)}`).join(', ')}</p>
      <div class="pl-mc-spalten"><div><div class="label">Endprodukte (ca., bei 100 %)</div><ul class="pl-liste">${liste(Object.fromEntries((e.end || []).map((it) => [it, e.aus[it]])))}</ul>${Object.keys(e.aus).length > (e.end || []).length ? `<div class="label">Weitere Überschüsse (ca.)</div><ul class="pl-liste">${liste(Object.fromEntries(Object.entries(e.aus).filter(([it]) => !(e.end || []).includes(it))))}</ul>` : ''}</div><div><div class="label">Zulieferung</div><ul class="pl-liste">${liste(e.ein)}</ul></div></div>
      <p class="hint">Die Mengen sind aus Rezepten × Maschinenzahl gerechnet (Übertaktung nicht berücksichtigt). Die Vorlage wird unverändert übernommen.</p>
      <div class="pl-bp-grid"><label for="pl-mc-name">Name</label><input id="pl-mc-name" type="text" value="${esc(('MC_' + e.name).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_'))}" spellcheck="false">
      <label for="pl-mc-ziel">Kopieren nach</label><select id="pl-mc-ziel">${sessions.map((x) => `<option${x === ziel ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
      <div class="dlg-actions"><button type="button" class="btn" value="nein">Schließen</button>${(e.end || []).length ? '<button type="button" class="btn" id="pl-mc-alsziel" title="Die Endprodukte dieser Fabrik als Ziele in den Planer übernehmen">Als Ziel übernehmen</button>' : ''}<button type="button" class="btn" id="pl-mc-3d">In 3D ansehen</button><button type="button" class="btn primary" id="pl-mc-ok">Ins Spiel kopieren</button></div></form>`;
    $('pl-mc-alsziel')?.addEventListener('click', () => {
      if (this.grundlage) { this.app.toast('Erst „Zurück zu meinem Plan“ wählen.', 'err'); return; }
      this.plan.ziele = e.end.map((it) => ({ item: it, menge: Math.round(e.aus[it] * 100) / 100 }));
      this.plan.vorhanden = []; this.speichern(); d.close(); this.app.setMode('planer'); this.zeichneEingaben(); this.rechnen();
      this.app.toast(`Ziele aus „${e.name}“ übernommen.`, 'ok');
    });
    d.querySelector('[value=nein]').addEventListener('click', () => d.close());
    $('pl-mc-3d').addEventListener('click', async () => {
      try {
        const r = await fetch(`/api/masterclass/vorschau?id=${id}`); const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status);
        d.close(); this.app.bp = j; this.app.setMode('editor'); this.app.openScene(); if (this.app.mode !== '3d') $('v3d').click();
        $('pathtext').textContent = `Master Class · ${e.name} (nur ansehen – kopieren im Planer)`;
      } catch (err) { this.app.toast(err.message, 'err'); }
    });
    $('pl-mc-ok').addEventListener('click', async () => {
      const name = $('pl-mc-name').value.trim(), session = $('pl-mc-ziel').value;
      try {
        const r = await fetch('/api/masterclass/kopieren', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' }, body: JSON.stringify({ id, session, name }) });
        const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status);
        this.app.toast(`„${name}“ nach „${session}“ kopiert.`, 'ok'); d.close();
        if ($('session').value === session) this.app.loadList();
      } catch (err) { this.app.toast(err.message, 'err'); }
    });
    d.showModal();
  }

  // ------------------------------------------------------------ Infos aus dem Spielstand (Seitenfeld links im Planer)
  // Symbole oben links: Produktion, Strom, Vorräte, Rohstoff-Knoten. Ein Spielstand für alle Felder; Daten werden je Feld einmal geholt.
  /** Feld öffnen/schließen (art: 'produktion' | 'strom' | 'vorraete' | 'knoten') */
  async seite(art) {
    const s = $('pl-seite');
    this.seiteArt = this.seiteArt === art ? null : art;
    document.querySelectorAll('.pl-wz[data-seite]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.seite === this.seiteArt));
    s.hidden = !this.seiteArt; if (!this.seiteArt) return;
    if (!this.spListe) {
      try { this.spListe = ((await fetch('/api/karte/liste', { cache: 'no-store' }).then((r) => r.json())).spielstaende || []).sort((a, b) => b.geaendert - a.geaendert); } catch { this.spListe = []; }
      const sitz = this.app.spielSession?.();
      this.spielstandId ||= (this.spListe.find((x) => x.sitzung === sitz) || this.spListe[0])?.id;
    }
    this.seiteZeichnen();
  }
  /** Daten für das aktuelle Feld holen (einmal je Spielstand) */
  async seiteDaten(art) {
    const id = this.spielstandId; if (!id) return null;
    this.spDaten ||= {}; const k = art + '|' + id;
    if (this.spDaten[k]) return this.spDaten[k];
    const url = { bau: '/api/vorraete?id=', welt: '/api/welt/punkte?id=', produktion: '/api/planer/spielstand?id=', strom: '/api/planer/spielstand?id=', vorraete: '/api/vorraete?id=', knoten: '/api/welt/punkte?id=' }[art] + encodeURIComponent(id);
    const r = await fetch(url, { cache: 'no-store' }); const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status);
    this.spDaten[k] = j; if (art === 'bau') this.spDaten['vorraete|' + id] = j; if (art === 'vorraete') this.spDaten['bau|' + id] = j; if (art === 'welt') this.spDaten['knoten|' + id] = j; if (art === 'knoten') this.spDaten['welt|' + id] = j; if (art === 'produktion') this.spDaten['strom|' + id] = j; if (art === 'strom') this.spDaten['produktion|' + id] = j;
    return j;
  }
  async seiteZeichnen() {
    const s = $('pl-seite'), art = this.seiteArt; if (!art) return;
    const titel = { bau: 'Bauliste', welt: 'Welt-Plan', produktion: 'Produktion im Spielstand', strom: 'Strom & Kraftwerke', vorraete: 'Vorräte', knoten: 'Rohstoff-Knoten' }[art];
    const liste = this.spListe || [];
    s.innerHTML = `<div class="pl-seite-kopf"><b>${titel}</b><button type="button" class="btn small" id="pls-zu" aria-label="Schließen">✕</button></div>
      <select id="pls-stand" aria-label="Spielstand" data-no-i18n>${liste.map((x) => `<option value="${esc(x.id)}"${x.id === this.spielstandId ? ' selected' : ''}>${esc(x.name)}${x.sitzung ? ' · ' + esc(x.sitzung) : ''}</option>`).join('')}</select>
      <div id="pls-inhalt"><p class="muted">Spielstand wird gelesen …</p></div>`;
    $('pls-zu').addEventListener('click', () => this.seite(art));
    $('pls-stand').addEventListener('change', (e) => { this.spielstandId = e.target.value; this.seiteZeichnen(); });
    if (!liste.length) { $('pls-inhalt').innerHTML = '<p class="muted">Keine Spielstände gefunden.</p>'; return; }
    let d; try { d = await this.seiteDaten(art); } catch (e) { $('pls-inhalt').innerHTML = `<p class="err">Fehler: ${esc(e.message)}</p>`; return; }
    if (this.seiteArt !== art) return;
    ({ bau: () => this.seiteBau(d), welt: () => this.seiteWelt(d), produktion: () => this.seiteProduktion(d), strom: () => this.seiteStrom(d), vorraete: () => this.seiteVorraete(d), knoten: () => this.seiteKnoten(d) })[art]();
  }
  /** Haken = sofort als Zulieferung übernehmen (ersetzt Einträge desselben Items), Haken weg = Zulieferung entfernen */
  hakenBinden() {
    $('pls-inhalt').querySelectorAll('input[data-it]').forEach((c) => c.addEventListener('change', () => {
      const it = c.dataset.it;
      this.plan.vorhanden = this.plan.vorhanden.filter((v) => v.item !== it);
      if (c.checked) this.plan.vorhanden.push({ item: it, menge: Math.round(+c.dataset.m * 10) / 10 });
      this.speichern(); this.zeichneEingaben(); this.rechnen();
    }));
  }
  /** Sortierung nach Item-Name (wie im Spiel angezeigt) */
  nachName(a, b) { return this.itemName(a).localeCompare(this.itemName(b), 'de'); }
  /** Lieferungen automatisch: braucht Fabrik B ein Zwischenprodukt, das Fabrik A übrig hat, und deckt A den Bedarf ganz, wird es in B als Zulieferung eingetragen (B stellt es dann nicht mehr selbst her). Bis nichts mehr passt. */
  lieferungenAutomatisch(d) {
    this.speichern();
    const W = this.welt; let neu = 0;
    for (let runde = 0; runde < 6; runde++) {
      const erg = W.fabriken.map((f) => this.ergebnisVon(f.plan));
      const rest = erg.map((e) => { const a = {}; if (!e) return a; for (const z of e.ziele) a[z.item] = (a[z.item] || 0) + z.menge; for (const [it, m] of Object.entries(e.ueberschuss)) a[it] = (a[it] || 0) + m; return a; });
      // schon vergebene Lieferungen von den Überschüssen abziehen
      W.fabriken.forEach((f, j) => { for (const v of f.plan.vorhanden || []) for (let i = 0; i < rest.length; i++) if (i !== j && rest[i][v.item] > 0) { const m = Math.min(rest[i][v.item], v.menge); rest[i][v.item] -= m; break; } });
      let geaendert = false;
      W.fabriken.forEach((f, j) => {
        const e = erg[j]; if (!e) return;
        const bedarf = {}; for (const st of e.schritte) for (const z of st.zutaten) if (!istRohstoff(this.kat, z.item)) bedarf[z.item] = (bedarf[z.item] || 0) + z.proMin;
        const selbst = new Set(e.schritte.flatMap((st) => st.produkte.map((p) => p.item)));
        for (const [it, m] of Object.entries(bedarf)) {
          if (!selbst.has(it) || (f.plan.vorhanden || []).some((v) => v.item === it) || e.ziele.some((z) => z.item === it)) continue;
          const i = rest.findIndex((a, k) => k !== j && a[it] >= m - 0.01); if (i < 0) continue;
          (f.plan.vorhanden ||= []).push({ item: it, menge: Math.round(m * 10) / 10 }); rest[i][it] -= m; neu++; geaendert = true;
        }
      });
      if (!geaendert) break;
    }
    this.plan = { ...this.plan, ...W.fabriken[W.aktiv].plan };
    this.speichern(); this.zeichneEingaben(); this.rechnen(); this.seiteWelt(d);
    this.app.toast(neu ? `${neu} Lieferungen zwischen Fabriken eingetragen.` : 'Keine passenden Überschüsse gefunden (eine Fabrik muss den Bedarf ganz decken).', neu ? 'ok' : undefined);
  }
  /** Welt-Plan als Datei speichern */
  weltExport() {
    this.speichern();
    const blob = new Blob([JSON.stringify({ art: 'blueprint-studio-weltplan', version: 1, welt: this.welt }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Welt-Plan.bsplan'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  /** Welt-Plan aus Datei laden (ersetzt den aktuellen nach Rückfrage) */
  weltImport(d) {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.bsplan,.json';
    inp.addEventListener('change', async () => {
      const f = inp.files?.[0]; if (!f) return;
      let j; try { j = JSON.parse(await f.text()); } catch { this.app.toast('Die Datei ist kein Welt-Plan.', 'err'); return; }
      if (j?.art !== 'blueprint-studio-weltplan' || !Array.isArray(j.welt?.fabriken) || !j.welt.fabriken.length) { this.app.toast('Die Datei ist kein Welt-Plan.', 'err'); return; }
      if (!(await frage({ art: 'warnung', titel: 'Welt-Plan ersetzen?', text: `„${f.name}“ mit ${j.welt.fabriken.length} Fabrik(en) ersetzt deinen aktuellen Welt-Plan. Vorher am besten exportieren.`, ok: 'Ersetzen' }))) return;
      this.welt = { miner: 3, takt: 250, ...j.welt, aktiv: 0 };
      this.plan = { ...LEER(), ...this.welt.fabriken[0].plan }; this.fabrikListe(); this.fabrikWechseln(0);
      this.app.toast('Welt-Plan geladen.', 'ok');
    });
    inp.click();
  }
  /** Welt-Plan: alle Fabriken, Rohstoffbedarf gegen das, was die Knoten der Karte hergeben, Strom */
  seiteWelt(d) {
    const W = this.welt, mk = W.miner, takt = W.takt / 100;
    this.speichern();
    const erg = W.fabriken.map((f) => ({ f, e: this.ergebnisVon(f.plan) }));
    // Rohstoffbedarf aller Fabriken
    const bedarf = {}; let mw = 0, masch = 0;
    for (const { e } of erg) if (e) { for (const [it, m] of Object.entries(e.rohstoffe)) bedarf[it] = (bedarf[it] || 0) + m; mw += e.strom; masch += e.schritte.reduce((a, x) => a + x.anzahl, 0); }
    // was die Knoten hergeben: alle bzw. nur freie (mit Spielstand)
    const BASIS = [60, 120, 240][mk - 1], menge = (art, res, rein) => { const r = [0.5, 1, 2][rein] ?? 1; if (art === 'gasquelle') return 60 * r * takt; if (res === 'Desc_LiquidOil_C') return 120 * r * takt; return Math.min(1200, BASIS * r * takt); };
    const welt = {}, frei = {};
    for (const p of d.p) {
      const art = d.arten[p[0]]; if ((art !== 'knoten' && art !== 'gasquelle') || p[4] < 0 || p[5] < 0) continue;
      const res = d.ressourcen[p[4]], m = menge(art, res, p[5]);
      welt[res] = (welt[res] || 0) + m; if (p[6] !== 1) frei[res] = (frei[res] || 0) + m;
    }
    const balken = (v, max) => { const q = max ? v / max : 0; return `<span class="pl-balken"><i style="width:${Math.min(100, q * 100).toFixed(1)}%" class="${q > 1 ? 'zu' : q > 0.8 ? 'knapp' : ''}"></i></span><small>${max ? fmt(q * 100, 0) + ' %' : '–'}</small>`; };
    const roh = Object.keys({ ...bedarf, ...welt }).filter((it) => it !== 'Desc_Water_C' && (bedarf[it] || 0) > 0.5).sort((a, b) => (bedarf[b] || 0) / (welt[b] || 1e9) - (bedarf[a] || 0) / (welt[a] || 1e9));
    const st = this.spDaten?.['strom|' + this.spielstandId]?.strom;
    // geplante Kraftwerke: Leistung, Brennstoff, Kühlwasser, Abfall
    W.kraftwerke ||= [];
    const kw = W.kraftwerke.map((k) => {
      const g = KRAFT_ARTEN[k.gen] || KRAFT_ARTEN.Build_GeneratorCoal_C, t = (k.takt || 100) / 100, n = Math.max(0, +k.anzahl || 0);
      const mw = g.mw * t * n, e = this.kat.items[k.fuel]?.energieMJ, fl = this.einheit(k.fuel) !== '/min';
      const fuel = g.fuels.length && e ? mw * 60 / (e * (fl ? 1000 : 1)) : 0;
      return { ...k, g, mw, verbrauch: fuel, wasser: g.wasser * t * n, abfall: KRAFT_ABFALL[k.fuel] ? fuel * KRAFT_ABFALL[k.fuel][1] : 0 };
    });
    const kwMW = kw.reduce((a, k) => a + k.mw, 0);
    for (const k of kw) if (k.fuel && istRohstoff(this.kat, k.fuel)) bedarf[k.fuel] = (bedarf[k.fuel] || 0) + k.verbrauch;
    // Lieferwege: „Vorhanden“ jeder Fabrik aus Zielen/Überschüssen anderer Fabriken decken (der Reihe nach); Rest = offen bzw. von außen
    W.band ||= 6;
    const BAND = [60, 120, 270, 480, 780, 1200][W.band - 1], ROHR = 600;
    const fluessig = (it) => this.einheit(it) !== '/min';
    const transport = (it, m) => fluessig(it) ? `${Math.ceil(m / ROHR - 1e-9)}× Rohr Mk.2` : `${Math.ceil(m / BAND - 1e-9)}× Band Mk.${W.band}`;
    const rest = erg.map(({ e }) => { const a = {}; if (!e) return a; for (const z of e.ziele) a[z.item] = (a[z.item] || 0) + z.menge; for (const [it, m] of Object.entries(e.ueberschuss)) a[it] = (a[it] || 0) + m; return a; });
    const wege = [], offen = [];
    erg.forEach(({ f }, j) => {
      for (const v of f.plan.vorhanden || []) {
        if (!(v.menge > 0) || !v.item) continue;
        let fehlt = v.menge;
        for (let i = 0; i < erg.length && fehlt > 0.01; i++) {
          if (i === j || !(rest[i][v.item] > 0.01)) continue;
          const m = Math.min(fehlt, rest[i][v.item]); rest[i][v.item] -= m; fehlt -= m; wege.push({ von: i, nach: j, item: v.item, menge: m });
        }
        if (fehlt > 0.01) offen.push({ nach: j, item: v.item, menge: fehlt });
      }
    });
    // Kraftwerke nehmen Brennstoff aus den Überschüssen der Fabriken; Rest = von außen
    for (const k of kw) {
      if (!k.fuel || istRohstoff(this.kat, k.fuel)) continue;
      let fehlt = k.verbrauch;
      for (let i = 0; i < erg.length && fehlt > 0.01; i++) { if (!(rest[i][k.fuel] > 0.01)) continue; const m = Math.min(fehlt, rest[i][k.fuel]); rest[i][k.fuel] -= m; fehlt -= m; wege.push({ von: i, nach: -1, item: k.fuel, menge: m }); }
      if (fehlt > 0.01) offen.push({ nach: -1, item: k.fuel, menge: fehlt });
    }
    // was keine andere Fabrik abnimmt (Endprodukte, Überschüsse)
    const uebrig = []; rest.forEach((a, i) => { for (const [it, m] of Object.entries(a)) if (m > 0.05) uebrig.push({ von: i, item: it, menge: m, ziel: !!erg[i].e?.ziele.some((z) => z.item === it) }); });
    const fname = (i) => i < 0 ? '<span>Kraftwerke</span>' : `<span data-no-i18n>${esc(W.fabriken[i].name)}</span>`;
    const itemZ = (it) => `<span class="pl-seite-item">${itemBild(this.kat, it, 'mini')}<span data-no-i18n>${esc(this.itemName(it))}</span></span>`;
    const lieferHtml = `<div class="label">Lieferwege – wer beliefert wen</div>
      ${wege.length ? `<table class="rz pl-seite-tab"><thead><tr><th>von → nach</th><th>Item</th><th class="mat-n">/min</th><th>Transport</th></tr></thead><tbody>${wege.map((w) => `<tr><td>${fname(w.von)} → ${fname(w.nach)}</td><td>${itemZ(w.item)}</td><td class="mat-n">${fmt(w.menge, 1)}</td><td>${transport(w.item, w.menge)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Noch keine Lieferungen zwischen Fabriken.</p>'}
      ${offen.length ? `<div class="label">Zulieferung von außen</div><table class="rz pl-seite-tab"><tbody>${offen.map((o) => `<tr><td>→ ${fname(o.nach)}</td><td>${itemZ(o.item)}</td><td class="mat-n">${fmt(o.menge, 1)}</td><td class="${istRohstoff(this.kat, o.item) ? 'muted' : 'mat-kiste'}">${istRohstoff(this.kat, o.item) ? 'Rohstoff' : 'keine Fabrik liefert'}</td></tr>`).join('')}</tbody></table>` : ''}
      ${uebrig.length ? `<div class="label">Nicht abgenommen (Endprodukte, Überschüsse)</div><table class="rz pl-seite-tab"><tbody>${uebrig.map((x, k) => `<tr><td>${fname(x.von)}</td><td>${itemZ(x.item)}</td><td class="mat-n">${fmt(x.menge, 1)}</td><td><button type="button" class="btn small" data-liefer="${k}" title="Diese Menge als Zulieferung in eine andere Fabrik eintragen">liefern an …</button></td></tr>`).join('')}</tbody></table>` : ''}`;
    $('pls-inhalt').innerHTML = `<div class="pl-seite-opt"><label>Miner <select id="plw-mk">${[1, 2, 3].map((m) => `<option value="${m}"${m === mk ? ' selected' : ''}>Mk.${m}</option>`).join('')}</select></label><label>Takt <select id="plw-takt">${[100, 150, 200, 250].map((t) => `<option value="${t}"${t === W.takt ? ' selected' : ''}>${t} %</option>`).join('')}</select></label><label>Bänder <select id="plw-band">${[1, 2, 3, 4, 5, 6].map((b) => `<option value="${b}"${b === W.band ? ' selected' : ''}>Mk.${b}</option>`).join('')}</select></label></div>
      <div class="label">Fabriken</div>
      <table class="rz pl-seite-tab"><thead><tr><th>Fabrik</th><th>Ziele</th><th class="mat-n">Masch.</th><th class="mat-n">MW</th></tr></thead><tbody>${erg.map(({ f, e }, i) => `<tr class="${i === W.aktiv ? 'pl-aktiv' : ''}"><td><a href="#" data-fabrik="${i}" data-no-i18n>${esc(f.name)}</a></td><td>${(f.plan.ziele || []).filter((z) => z.item && z.menge > 0).map((z) => `<span class="pl-seite-item" title="${esc(this.itemName(z.item))}">${itemBild(this.kat, z.item, 'mini')}${fmt(z.menge, 1)}</span>`).join(' ') || '<span class="muted">–</span>'}</td><td class="mat-n">${e ? e.schritte.reduce((a, x) => a + x.anzahl, 0) : '–'}</td><td class="mat-n">${e ? fmt(e.strom, 0) : '–'}</td></tr>`).join('')}
        <tr class="pl-summe"><td>Summe</td><td></td><td class="mat-n">${masch}</td><td class="mat-n">${fmt(mw, 0)}</td></tr></tbody></table>
      <div class="pl-knoepfe"><button type="button" class="btn small" id="plw-neu">+ Fabrik</button><button type="button" class="btn small" id="plw-auto" title="Zwischenprodukte, die eine andere Fabrik übrig hat, als Zulieferung eintragen (nur wenn deren Überschuss den Bedarf ganz deckt)">Lieferungen automatisch</button><button type="button" class="btn small" id="plw-export" title="Welt-Plan als Datei speichern (.bsplan)">Exportieren</button><button type="button" class="btn small" id="plw-import" title="Welt-Plan aus einer Datei laden (ersetzt den aktuellen)">Importieren</button></div>
      <div class="label">Rohstoffe aller Fabriken</div>
      <table class="rz pl-seite-tab"><thead><tr><th>Rohstoff</th><th class="mat-n">Bedarf</th><th>von der Karte</th>${d.mitSpielstand ? '<th>von freien Knoten</th>' : ''}</tr></thead><tbody>${roh.map((it) => `<tr><td><span class="pl-seite-item">${itemBild(this.kat, it, 'mini')}<span data-no-i18n>${esc(this.itemName(it))}</span></span></td><td class="mat-n">${fmt(bedarf[it] || 0, 0)}</td><td title="${fmt(welt[it] || 0, 0)} /min möglich">${balken(bedarf[it] || 0, welt[it])}</td>${d.mitSpielstand ? `<td title="${fmt(frei[it] || 0, 0)} /min an freien Knoten">${balken(bedarf[it] || 0, frei[it])}</td>` : ''}</tr>`).join('')}</tbody></table>
      <p class="hint">Karte = alle Knoten mit Miner Mk.${mk} bzw. Pumpen bei ${W.takt} % (Bandgrenze 1 200/min).${d.mitSpielstand ? ' Freie Knoten laut gewähltem Spielstand.' : ''} Wasser unbegrenzt. Lieferungen zwischen Fabriken zählen in der empfangenden Fabrik als „Vorhanden“ – unten mit „liefern an …“ eintragen.</p>
      ${lieferHtml}
      <div class="label">Kraftwerke (geplant)</div>
      ${kw.length ? `<table class="rz pl-seite-tab pl-kw-tab"><tbody>${kw.map((k, i) => `<tr><td><select data-kw="${i}" data-f="gen">${Object.entries(KRAFT_ARTEN).map(([g, a]) => `<option value="${g}"${g === k.gen ? ' selected' : ''}>${esc(this.kat.gebaeude[g]?.name || a.name)}</option>`).join('')}</select>${k.g.fuels.length ? `<select data-kw="${i}" data-f="fuel" data-no-i18n>${k.g.fuels.map((f) => `<option value="${f}"${f === k.fuel ? ' selected' : ''}>${esc(this.itemName(f))}</option>`).join('')}</select>` : ''}</td><td><input type="number" min="0" max="999" value="${k.anzahl}" data-kw="${i}" data-f="anzahl" style="width:56px">×</td><td><select data-kw="${i}" data-f="takt">${[100, 150, 200, 250].map((t) => `<option value="${t}"${t === (k.takt || 100) ? ' selected' : ''}>${t} %</option>`).join('')}</select></td><td class="mat-n">${fmt(k.mw, 0)} MW${k.fuel && k.verbrauch ? `<br><small class="muted">${fmt(k.verbrauch, 1)} ${this.einheit(k.fuel)}</small>` : ''}</td><td><button type="button" class="btn small" data-kw-weg="${i}" aria-label="Entfernen">✕</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Noch keine Kraftwerke geplant.</p>'}
      <button type="button" class="btn small" id="plw-kw-neu">+ Kraftwerk</button>
      ${kw.some((k) => k.wasser || k.abfall) ? `<p class="hint">Kühlwasser ${fmt(kw.reduce((a, k) => a + k.wasser, 0), 0)} m³/min${kw.some((k) => k.abfall) ? ` · Atommüll ${fmt(kw.reduce((a, k) => a + k.abfall, 0), 1)} /min` : ''}.</p>` : ''}
      <div class="label">Strom</div>
      <div class="k-kv"><span>Bedarf aller Fabriken</span><b>${fmt(mw, 0)} MW</b>${kw.length ? `<span>Geplante Kraftwerke</span><b class="${kwMW - mw < 0 ? 'mat-fehlt' : 'mat-ok'}">${fmt(kwMW, 0)} MW (${kwMW - mw >= 0 ? '+' : ''}${fmt(kwMW - mw, 0)} MW)</b>` : ''}${st ? `<span>Reserve im Spielstand</span><b class="${st.erzeugt - st.verbraucht - mw < 0 ? 'mat-fehlt' : 'mat-ok'}">${fmt(st.erzeugt - st.verbraucht, 0)} MW → danach ${fmt(st.erzeugt - st.verbraucht - mw, 0)} MW</b>` : '<span class="muted">Reserve</span><b class="muted">Feld „Strom“ einmal öffnen</b>'}</div>`;
    $('pls-inhalt').querySelectorAll('[data-fabrik]').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); this.fabrikWechseln(+a.dataset.fabrik); }));
    $('plw-neu').addEventListener('click', () => this.fabrikNeu());
    $('plw-kw-neu').addEventListener('click', () => { W.kraftwerke.push({ gen: 'Build_GeneratorFuel_C', fuel: 'Desc_LiquidFuel_C', anzahl: 10, takt: 100 }); this.speichern(); this.seiteWelt(d); });
    $('pls-inhalt').querySelectorAll('[data-kw]').forEach((el) => el.addEventListener('change', () => {
      const k = W.kraftwerke[+el.dataset.kw], f = el.dataset.f; k[f] = f === 'gen' || f === 'fuel' ? el.value : +el.value;
      if (f === 'gen') k.fuel = KRAFT_ARTEN[k.gen].fuels[0] || null;
      this.speichern(); this.seiteWelt(d);
    }));
    $('pls-inhalt').querySelectorAll('[data-kw-weg]').forEach((b) => b.addEventListener('click', () => { W.kraftwerke.splice(+b.dataset.kwWeg, 1); this.speichern(); this.seiteWelt(d); }));
    $('plw-auto').addEventListener('click', () => this.lieferungenAutomatisch(d));
    $('plw-export').addEventListener('click', () => this.weltExport());
    $('plw-import').addEventListener('click', () => this.weltImport(d));
    $('plw-band').addEventListener('change', (e) => { W.band = +e.target.value; this.speichern(); this.seiteWelt(d); });
    $('pls-inhalt').querySelectorAll('[data-liefer]').forEach((b) => b.addEventListener('click', async () => {
      const x = uebrig[+b.dataset.liefer], ziele = W.fabriken.map((f, i) => ({ wert: String(i), text: f.name })).filter((o) => +o.wert !== x.von);
      if (!ziele.length) { this.app.toast('Erst eine zweite Fabrik anlegen.'); return; }
      const w = await auswahl({ titel: `${this.itemName(x.item)} liefern an`, text: `${fmt(x.menge, 1)} ${this.einheit(x.item)} aus „${W.fabriken[x.von].name}“ – wird in der gewählten Fabrik als Zulieferung eingetragen.`, ok: 'Eintragen', optionen: ziele });
      if (!w) return;
      const t = +w.wert, plan = t === W.aktiv ? this.plan : W.fabriken[t].plan;
      plan.vorhanden ||= []; const v = plan.vorhanden.find((y) => y.item === x.item);
      if (v) v.menge = Math.round((v.menge + x.menge) * 10) / 10; else plan.vorhanden.push({ item: x.item, menge: Math.round(x.menge * 10) / 10 });
      this.speichern();
      if (t === W.aktiv) { this.zeichneEingaben(); this.rechnen(); } else this.seiteWelt(d);
      this.app.toast(`Lieferung eingetragen: ${this.itemName(x.item)} → ${W.fabriken[t].name}.`, 'ok');
    }));
    $('plw-mk').addEventListener('change', (e) => { W.miner = +e.target.value; this.speichern(); this.seiteWelt(d); });
    $('plw-takt').addEventListener('change', (e) => { W.takt = +e.target.value; this.speichern(); this.seiteWelt(d); });
  }
  /** Bauliste der aktiven Fabrik: Schritte zum Abhaken (gebaut), Maschinen und Baukosten gegen Inventar + Dimensionslager */
  /** Plan-Tafel: Ablaufplan als Schild-Wand bauen und in einer Spiel-Sitzung speichern; gemerkt je Fabrik (plan.tafeln) */
  async plantafelDialog() {
    const r = this.ergebnis; if (!r?.schritte?.length) { this.app.toast('Erst ein Ziel eingeben – dann gibt es einen Plan.', 'err'); return; }
    let d = $('dlg-pl-tafel');
    if (!d) { d = document.createElement('dialog'); d.id = 'dlg-pl-tafel'; document.body.appendChild(d); }
    const sessions = (this.app.cfg?.sessions || []).filter((x) => !x.lib).map((x) => x.name);
    const ziel = this.bpZiel || this.app.spielSession?.() || sessions[0] || '';
    const fabrik = this.welt?.fabriken?.[this.welt.aktiv]?.name || 'Fabrik';
    const vorschlag = ('Plan_' + fabrik).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').slice(0, 32);
    d.innerHTML = `<form method="dialog" class="dlg"><h2>Plan-Tafel</h2>
      <p class="hint">Baut den Ablaufplan dieser Fabrik als Schilder-Wand: Rohstoffe, je Stufe die Maschinen mit Rezept, Ein- und Ausgängen pro Minute (mit Bildern), Ergebnis und Strom. Im Spiel als Blaupause an der Baustelle aufstellen.</p>
      <div class="pl-bp-grid"><label for="pl-tafel-titel">Überschrift</label><input id="pl-tafel-titel" type="text" maxlength="60" value="${esc(fabrik)}" data-no-i18n>
      <label for="pl-tafel-name">Name der Blaupause</label><input id="pl-tafel-name" type="text" maxlength="32" value="${esc(vorschlag)}" spellcheck="false" data-no-i18n>
      <span class="label">Stil</span>${stilWahl('pl-tafel-stil', [
        { wert: 'einfach', titel: 'Einfach', text: 'Zeilen aus 4-m-Schildern – schlicht, schnell zu lesen', bild: STIL_BILD.tafelEinfach },
        { wert: 'optimiert', titel: 'Optimiert', text: 'Karten mit großen Bildern und Ziffern-Anzeigen', bild: STIL_BILD.tafelOptimiert }], this.plan.tafelStil || 'optimiert')}
      <label for="pl-tafel-ziel">Sitzung</label><select id="pl-tafel-ziel" data-no-i18n>${sessions.map((x) => `<option${x === ziel ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
      <div class="dlg-actions"><button type="button" class="btn" value="nein">Abbrechen</button><button type="button" class="btn primary" id="pl-tafel-ok">Tafel erstellen</button></div></form>`;
    d.querySelector('[value=nein]').addEventListener('click', () => d.close());
    stilWahlBinden(d, 'pl-tafel-stil', (w) => { this.plan.tafelStil = w; this.speichern(); });
    try {
      const st = await (await fetch('/api/planer/plantafel/stile')).json();
      if (st.optimiertFehlt?.length) stilSperren(d, 'pl-tafel-stil', 'optimiert', `Es fehlen Schild-Vorlagen: ${st.optimiertFehlt.join(', ')} – im Spiel je ein solches Schild in einer Blaupause speichern.`, 'einfach');
    } catch { /* beide bleiben wählbar */ }
    $('pl-tafel-ok').addEventListener('click', async () => {
      const name = $('pl-tafel-name').value.trim(), session = $('pl-tafel-ziel').value, titel = $('pl-tafel-titel').value.trim();
      const schritte = r.schritte.map((st) => ({ rezept: st.rezept, gebaeude: st.gebaeude, anzahl: st.anzahl, takt: Math.round(st.takt * 10) / 10 }));
      try {
        const res = await fetch('/api/planer/plantafel', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' }, body: JSON.stringify({ session, name, titel, schritte, stil: stilWert(d, 'pl-tafel-stil') }) });
        const j = await res.json(); if (!res.ok) throw new Error(j.fehler || res.status);
        const t = this.plan.tafeln ||= []; t.unshift({ session, name, datum: j.datum }); t.splice(8); this.speichern();
        this.app.toast(`Plan-Tafel „${name}“ in „${session}“ gespeichert: ${j.info.schilder} Schilder, ${j.info.breite} × ${j.info.hoehe} m.`, 'ok');
        d.close(); if (this.seiteArt === 'bau') this.tafelnZeigen(); if ($('session').value === session) this.app.loadList();
      } catch (e) { this.app.toast(e.message, 'err'); }
    });
    d.showModal();
  }
  /** Liste der Plan-Tafeln dieser Fabrik mit „im Spiel“ (an = im Spiel-Ordner, aus = in der App beiseitegelegt) */
  async tafelnZeigen() {
    const el = $('pl-tafeln'); if (!el) return;
    const liste = this.plan.tafeln || [];
    if (!liste.length) { el.innerHTML = '<p class="muted">Noch keine – „Plan-Tafel …“ oben erstellt eine.</p>'; return; }
    let st = liste.map((x) => ({ ...x, status: '?' }));
    try { st = await (await fetch('/api/planer/plantafel/status', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' }, body: JSON.stringify({ liste }) })).json(); } catch { /* ohne Status */ }
    el.innerHTML = st.map((x, i) => `<label class="check pl-tafel" title="${x.status === 'fehlt' ? 'Datei nicht mehr vorhanden' : 'Haken = im Spiel sichtbar (Blaupause in der Sitzung), ohne Haken = in der App beiseitegelegt'}"><input type="checkbox" data-tafel="${i}"${x.status === 'an' ? ' checked' : ''}${x.status === 'fehlt' ? ' disabled' : ''}> <span data-no-i18n>${esc(x.name)}</span> <small class="muted" data-no-i18n>${esc(x.session)} · ${new Date(liste[i].datum).toLocaleDateString('de-DE')}</small>${x.status === 'fehlt' ? ' <small class="muted">(fehlt)</small>' : ''}</label>`).join('')
      + '<p class="hint">Haken = im Spiel (Blaupause in der Sitzung). Ohne Haken legt die App die Tafel beiseite; das Spiel sieht sie erst nach dem Neuladen nicht mehr.</p>';
    el.querySelectorAll('input[data-tafel]').forEach((c) => c.addEventListener('change', async () => {
      const x = liste[+c.dataset.tafel];
      try { const res = await fetch('/api/planer/plantafel/schalten', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' }, body: JSON.stringify({ session: x.session, name: x.name, an: c.checked }) }); const j = await res.json(); if (!res.ok) throw new Error(j.fehler || res.status); }
      catch (e) { this.app.toast(e.message, 'err'); c.checked = !c.checked; }
    }));
  }
  seiteBau(v) {
    const r = this.ergebnis; if (!r) { $('pls-inhalt').innerHTML = '<p class="muted">Erst ein Ziel eingeben.</p>'; return; }
    const gebaut = this.plan.gebaut ||= {};
    const masch = {}, kosten = {};
    for (const st of r.schritte) { masch[st.gebaeude] = (masch[st.gebaeude] || 0) + st.anzahl; for (const [it, n] of this.kat.gebaeude[st.gebaeude]?.kosten || []) kosten[it] = (kosten[it] || 0) + n * st.anzahl; }
    const fertig = r.schritte.filter((st) => gebaut[st.rezept]).length;
    const da = (it) => (v?.inventar?.[it] || 0) + (v?.lager?.[it] || 0);
    $('pls-inhalt').innerHTML = `<p class="hint">Reihenfolge von den Rohstoffen zum Ziel. <b>Haken</b> = gebaut. Takt und Shards stellst du im Spiel an den Maschinen ein.</p>
      <div class="pl-bau-fortschritt"><span class="pl-balken"><i style="width:${r.schritte.length ? (fertig / r.schritte.length * 100).toFixed(1) : 0}%"></i></span> ${fertig} von ${r.schritte.length} Schritten gebaut</div>
      <table class="rz pl-seite-tab"><thead><tr><th></th><th>Schritt</th><th class="mat-n">Masch.</th><th class="mat-n">Takt</th><th class="mat-n">Shards</th></tr></thead><tbody>${r.schritte.map((st) => `<tr class="${gebaut[st.rezept] ? 'pl-gebaut' : ''}"><td><input type="checkbox" data-bau="${esc(st.rezept)}"${gebaut[st.rezept] ? ' checked' : ''}></td><td><span class="pl-seite-item">${itemBild(this.kat, this.kat.rezepte[st.rezept].produkte[0].item, 'mini')}<span data-no-i18n>${esc(st.name)}</span></span><br><small class="muted" data-no-i18n>${esc(this.kat.gebaeude[st.gebaeude]?.name || st.gebaeude)}</small></td><td class="mat-n">${st.anzahl}</td><td class="mat-n">${fmt(st.takt, 1)} %</td><td class="mat-n">${st.shards || ''}</td></tr>`).join('')}</tbody></table>
      <div class="label">Maschinen</div>
      <div class="k-kv">${Object.entries(masch).map(([g, n]) => `<span data-no-i18n>${esc(this.kat.gebaeude[g]?.name || g)}</span><b>${n}×</b>`).join('')}${r.shards ? `<span>Power-Shards</span><b>${r.shards}</b>` : ''}</div>
      <div class="label">Baukosten der Maschinen</div>
      <table class="rz pl-seite-tab"><thead><tr><th>Material</th><th class="mat-n">Benötigt</th>${v ? '<th class="mat-n">Inventar + Lager</th>' : ''}</tr></thead><tbody>${Object.entries(kosten).sort((a, b) => this.nachName(a[0], b[0])).map(([it, n]) => `<tr><td>${itemBild(this.kat, it, 'mini')} <span data-no-i18n>${esc(this.itemName(it))}</span></td><td class="mat-n">${fmt(n, 0)}</td>${v ? `<td class="mat-n ${da(it) >= n ? 'mat-ok' : 'mat-fehlt'}">${fmt(da(it), 0)}</td>` : ''}</tr>`).join('')}</tbody></table>
      <p class="hint">Ohne Bänder, Rohre, Fundamente und Strommasten.${v ? ' Vorräte aus dem gewählten Spielstand (Inventar + Dimensionslager).' : ''}</p>
      <div class="label">Plan-Tafeln dieser Fabrik</div><div id="pl-tafeln" class="pl-tafeln"></div>`;
    this.tafelnZeigen();
    $('pls-inhalt').querySelectorAll('input[data-bau]').forEach((c) => c.addEventListener('change', () => { gebaut[c.dataset.bau] = c.checked; if (!c.checked) delete gebaut[c.dataset.bau]; this.speichern(); this.seiteBau(v); }));
  }
  seiteProduktion(d) {
    const gem = this.seiteGem, alle = this.seiteAlle, vorhanden = new Set(this.plan.vorhanden.map((v) => v.item));
    const zeilen = Object.entries(d.items).map(([it, e]) => { const her = gem ? e.herGem : e.her, ver = gem ? e.verGem : e.ver; return { it, her, ver, rest: Math.round((her - ver) * 10) / 10 }; })
      .filter((z) => alle || z.rest > 0.05).sort((a, b) => this.nachName(a.it, b.it));
    $('pls-inhalt').innerHTML = `<div class="pl-seite-opt"><label class="check"><input type="checkbox" id="pls-gem"${gem ? ' checked' : ''}> gemessene Auslastung</label><label class="check"><input type="checkbox" id="pls-alle"${alle ? ' checked' : ''}> alle Items</label></div>
      <p class="hint">${d.maschinen.toLocaleString('de-DE')} Maschinen, ${d.extraktoren.toLocaleString('de-DE')} Miner/Pumpen. Überschuss = hergestellt − verbraucht (Fabriken und Kraftwerke).</p>
      <p class="hint"><b>Haken</b> = Überschuss als Zulieferung übernehmen, Haken weg = wieder entfernen.</p>
      <table class="rz pl-seite-tab"><thead><tr><th></th><th>Item</th><th class="mat-n">Her</th><th class="mat-n">Verbr.</th><th class="mat-n">Überschuss</th></tr></thead><tbody>${zeilen.map((z) => `<tr><td>${z.rest > 0.05 ? `<input type="checkbox" data-it="${esc(z.it)}" data-m="${z.rest}"${vorhanden.has(z.it) ? ' checked' : ''}>` : ''}</td><td><span class="pl-seite-item">${itemBild(this.kat, z.it, 'mini')}<span data-no-i18n>${esc(this.itemName(z.it))}</span></span></td><td class="mat-n">${fmt(z.her, 0)}</td><td class="mat-n">${fmt(z.ver, 0)}</td><td class="mat-n ${z.rest < -0.05 ? 'mat-fehlt' : z.rest > 0.05 ? 'mat-ok' : ''}">${fmt(z.rest, 1)}</td></tr>`).join('')}</tbody></table>`;
    $('pls-gem').addEventListener('change', (e) => { this.seiteGem = e.target.checked; this.seiteProduktion(d); });
    $('pls-alle').addEventListener('change', (e) => { this.seiteAlle = e.target.checked; this.seiteProduktion(d); });
    this.hakenBinden();
  }
  seiteStrom(d) {
    const st = d.strom || {}, gem = this.seiteGem, erz = gem ? st.erzeugtGem : st.erzeugt, ver = gem ? st.verbrauchtGem : st.verbraucht;
    $('pls-inhalt').innerHTML = `<div class="pl-seite-opt"><label class="check"><input type="checkbox" id="pls-gem"${gem ? ' checked' : ''}> gemessene Auslastung</label></div>
      <div class="k-kv"><span>Erzeugt</span><b>${fmt(erz, 0)} MW</b><span>Verbraucht (Maschinen, Miner, Pumpen)</span><b>${fmt(ver, 0)} MW</b><span>Reserve</span><b class="${erz - ver < 0 ? 'mat-fehlt' : 'mat-ok'}">${fmt(erz - ver, 0)} MW</b></div>
      <div class="label">Kraftwerke</div>
      ${Object.entries(d.kraftwerke || {}).map(([g, k]) => `<div class="pl-seite-kw"><b data-no-i18n>${esc(this.kat.gebaeude[g]?.name || g.replace(/^Build_|_C$/g, ''))}</b> <span>${k.anzahl}× · ${fmt(k.mw, 0)} MW</span>${Object.entries(k.brennstoffe).map(([f, m]) => `<div class="pl-seite-item">${itemBild(this.kat, f, 'mini')}<span data-no-i18n>${esc(this.itemName(f))}</span> <span class="muted">${fmt(m, 1)} ${this.einheit(f)}</span></div>`).join('')}</div>`).join('') || '<p class="muted">Keine Kraftwerke.</p>'}
      <p class="hint">Geothermie als Mittelwert, Alien Power Augmenter ohne Netz-Bonus.</p>`;
    $('pls-gem').addEventListener('change', (e) => { this.seiteGem = e.target.checked; this.seiteStrom(d); });
  }
  seiteVorraete(d) {
    const its = new Set([...Object.keys(d.inventar), ...Object.keys(d.lager), ...Object.keys(d.kisten)]);
    const zeilen = [...its].map((it) => ({ it, inv: d.inventar[it] || 0, lag: d.lager[it] || 0, ki: d.kisten[it] || 0 })).sort((a, b) => this.nachName(a.it, b.it));
    $('pls-inhalt').innerHTML = `<p class="hint">Stückzahlen (keine Mengen pro Minute) – Inventar, Dimensionslager und ${d.kistenAnzahl} Kisten/Uploader beim letzten Speichern.</p>
      <table class="rz pl-seite-tab"><thead><tr><th>Item</th><th class="mat-n">Inventar</th><th class="mat-n">Lager</th><th class="mat-n">Kisten</th></tr></thead><tbody>${zeilen.map((z) => `<tr><td><span class="pl-seite-item">${itemBild(this.kat, z.it, 'mini')}<span data-no-i18n>${esc(this.itemName(z.it))}</span></span></td><td class="mat-n">${fmt(z.inv, 0)}</td><td class="mat-n">${fmt(z.lag, 0)}</td><td class="mat-n">${fmt(z.ki, 0)}</td></tr>`).join('')}</tbody></table>`;
  }
  seiteKnoten(d) {
    // freie Knoten je Rohstoff und Reinheit; mögliche Menge bei Miner Mk.3 / Pumpen mit 250 % Takt (Bandgrenze Mk.6 = 1 200/min)
    const MAX = (art, res, rein) => { const r = [0.5, 1, 2][rein] ?? 1; if (art === 'gasquelle') return 60 * r * 2.5; if (res === 'Desc_LiquidOil_C') return 120 * r * 2.5; return Math.min(1200, 240 * r * 2.5); };
    const je = new Map();
    for (const p of d.p) {
      const art = d.arten[p[0]]; if (art !== 'knoten' && art !== 'gasquelle' || p[4] < 0) continue;
      const res = d.ressourcen[p[4]], e = je.get(res) || { frei: [0, 0, 0], belegt: [0, 0, 0], menge: 0 };
      if (p[5] >= 0) { if (p[6] === 1) e.belegt[p[5]]++; else { e.frei[p[5]]++; e.menge += MAX(art, res, p[5]); } }
      je.set(res, e);
    }
    const zeilen = [...je].sort((a, b) => this.nachName(a[0], b[0]));
    const vorhanden = new Set(this.plan.vorhanden.map((v) => v.item));
    $('pls-inhalt').innerHTML = `<p class="hint">Freie Knoten (unrein / normal / rein) und was sie mit Miner Mk.3 bzw. Pumpen bei 250 % hergäben. <b>Haken</b> = als Zulieferung übernehmen (Haken weg = entfernen) – passt zum Rechenweg „Maximum“.</p>
      <table class="rz pl-seite-tab"><thead><tr><th></th><th>Rohstoff</th><th class="mat-n">frei</th><th class="mat-n">belegt</th><th class="mat-n">bis /min</th></tr></thead><tbody>${zeilen.map(([res, e]) => `<tr><td>${e.menge > 0 ? `<input type="checkbox" data-it="${esc(res)}" data-m="${e.menge}"${vorhanden.has(res) ? ' checked' : ''}>` : ''}</td><td><span class="pl-seite-item">${itemBild(this.kat, res, 'mini')}<span data-no-i18n>${esc(this.itemName(res))}</span></span></td><td class="mat-n">${e.frei.join(' / ')}</td><td class="mat-n">${e.belegt.join(' / ')}</td><td class="mat-n">${fmt(e.menge, 0)}</td></tr>`).join('')}</tbody></table>
      ${d.mitSpielstand ? '' : '<p class="hint">Ohne Spielstand-Abgleich – alle Knoten gelten als frei.</p>'}`;
    this.hakenBinden();
  }

  // ------------------------------------------------------------ Master Class als Ziel-Auswahl (nach Stufe/Art)
  async masterclassWahl() {
    let mc;
    try { const r = await fetch('/api/masterclass'); mc = await r.json(); if (!r.ok) throw new Error(mc.fehler || r.status); } catch (e) { this.app.toast(`Master Class: ${e.message}`, 'err'); return; }
    this.mcListe = mc.eintraege || [];
    let d = $('dlg-pl-mcwahl');
    if (!d) { d = document.createElement('dialog'); d.id = 'dlg-pl-mcwahl'; d.className = 'bw-dlg'; document.body.appendChild(d); }
    let bis = 99, suche = '';
    const haupt = (e) => (e.end?.length ? e.end : Object.keys(e.aus || {}));
    const karte = (e) => `<button type="button" class="bw-karte" data-mc="${e.id}" title="${esc(e.beschreibung || e.name)}">
      ${haupt(e)[0] ? itemBild(this.kat, haupt(e)[0]) : `<span class="tile bw-item">${esc(e.art.slice(0, 2).toUpperCase())}</span>`}
      <span class="bw-name" data-no-i18n>${esc(e.name)}</span>
      <span class="bw-info">${e.art === 'Fabrik' ? esc(haupt(e).slice(0, 2).map((it) => `${fmt(e.aus[it], 1)} ${this.itemName(it)}`).join(', ')) : `${e.objekte} Teile · ${e.groesse[0]}×${e.groesse[1]} m`}</span>
      ${e.art === 'Fabrik' ? `<span class="bw-marke">${e.mc ? 'MC · ' : ''}Stufe ${e.stufe ?? '?'}</span>` : ''}</button>`;
    const zeichne = () => {
      const q = suche.toLowerCase();
      const passt = (e) => (!q || `${e.name} ${e.beschreibung} ${haupt(e).map((it) => this.itemName(it)).join(' ')}`.toLowerCase().includes(q));
      const fab = this.mcListe.filter((e) => e.art === 'Fabrik' && (e.stufe ?? 0) <= bis && passt(e)).sort((a, b) => (a.stufe - b.stufe) || a.name.localeCompare(b.name));
      const gruppen = {};
      for (const e of fab) (gruppen[`Stufe ${e.stufe ?? '?'}`] ||= []).push(e);
      const sonst = this.mcListe.filter((e) => e.art !== 'Fabrik' && passt(e));
      const arten = {};
      for (const e of sonst) (arten[e.art] ||= []).push(e);
      d.querySelector('.bw-liste').innerHTML = (fab.length ? Object.entries(gruppen).map(([g, l]) => `<h3 class="bw-g">Fabriken · ${g}</h3><div class="bw-grid">${l.map(karte).join('')}</div>`).join('') : '<p class="muted">Keine Fabrik bis zu dieser Stufe.</p>')
        + Object.entries(arten).map(([a, l]) => `<h3 class="bw-g">${a === 'Bahn' ? 'Bahn & Signale' : a === 'Fundament' ? 'Fundamente' : a}</h3><div class="bw-grid">${l.map(karte).join('')}</div>`).join('');
      d.querySelectorAll('.bw-liste [data-mc]').forEach((el) => el.addEventListener('click', () => { d.close(); this.masterclassDialog(el.dataset.mc); }));
      d.querySelector('.bw-zahl').textContent = `${fab.length + sonst.length} von ${this.mcListe.length} Vorlagen`;
    };
    const stufen = [...new Set(this.mcListe.filter((e) => e.art === 'Fabrik').map((e) => e.stufe ?? 0))].sort((a, b) => a - b);
    d.innerHTML = `<div class="bw">
      <div class="bw-kopf"><h2>Master Class – fertige Vorlagen</h2><input type="search" class="bw-suche" placeholder="Suchen (Name, Produkt) …" spellcheck="false"><button type="button" class="bw-zu" aria-label="Schließen">✕</button></div>
      <p class="hint bw-hinweis">Lehrbuchgetreu aufgebaute Blaupausen. Klick auf eine Vorlage: Details, in 3D ansehen, ins Spiel kopieren oder ihre Endprodukte als Ziel übernehmen. Die Stufe richtet sich nach dem höchsten nötigen Meilenstein.</p>
      <div class="bw-gruppen"><span class="muted" style="align-self:center">Bis Stufe:</span>${stufen.map((s2) => `<button type="button" class="bw-chip" data-bis="${s2}">${s2}</button>`).join('')}<button type="button" class="bw-chip on" data-bis="99">alle</button></div>
      <div class="bw-liste"></div>
      <div class="bw-fuss"><span class="muted bw-zahl"></span>
        <button type="button" class="btn small" id="mc-neu" title="Die Master-Class-Ordner (Standard: blueprints\\Sortieren\\Tschukki und Ablage „10 Master Class“) neu einlesen">Neu einlesen</button>
        <button type="button" class="btn small" id="mc-ablage" title="Alle Vorlagen in die Ablage unter „10 Master Class“ einsortieren – nach Thema, mit der Stufe im Namen (S7_…). Originale aus dem Quellordner werden verschoben, fehlende aus dem Abdruck angelegt.">In Ablage einsortieren</button>
        <a class="btn small" id="mc-export" href="/api/masterclass/export" download title="Alle Vorlagen als eine Datei speichern – zum Mitnehmen auf einen anderen Rechner">Paket speichern</a>
        <label class="btn small" title="Ein gespeichertes Master-Class-Paket (.bsmc) laden">Paket laden<input type="file" id="mc-import" accept=".bsmc,application/json" hidden></label>
        <button type="button" class="btn small bw-abbr">Schließen</button></div></div>`;
    d.querySelector('.bw-zu').addEventListener('click', () => d.close());
    d.querySelector('.bw-abbr').addEventListener('click', () => d.close());
    d.onclick = (ev) => { if (ev.target === d) d.close(); };
    d.querySelector('.bw-suche').addEventListener('input', (ev) => { suche = ev.target.value; zeichne(); });
    d.querySelectorAll('[data-bis]').forEach((c) => c.addEventListener('click', () => { bis = +c.dataset.bis; d.querySelectorAll('[data-bis]').forEach((x) => x.classList.toggle('on', x === c)); zeichne(); }));
    $('mc-neu').addEventListener('click', async () => {
      try { const r = await fetch('/api/masterclass?neu=1'); const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status); this.mcListe = j.eintraege; zeichne(); this.app.toast(`${j.eintraege.length} Vorlagen eingelesen.`, 'ok'); } catch (e) { this.app.toast(e.message, 'err'); }
    });
    $('mc-ablage').addEventListener('click', async () => {
      try {
        const r = await fetch('/api/masterclass/ablegen', { method: 'POST', headers: { 'X-BS': '1' } });
        const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status);
        this.app.toast(`Ablage „10 Master Class“: ${j.verschoben} verschoben, ${j.angelegt} neu angelegt, ${j.vorhanden} schon vorhanden${j.fehler.length ? ` – ${j.fehler.length} Fehler: ${j.fehler[0]}` : ''}.`, j.fehler.length ? 'err' : 'ok');
      } catch (e) { this.app.toast(e.message, 'err'); }
    });
    $('mc-import').addEventListener('change', async (ev) => {
      const f = ev.target.files[0]; if (!f) return;
      try {
        const r = await fetch('/api/masterclass/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' }, body: await f.text() });
        const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status);
        this.app.toast(`Paket geladen: ${j.neu} neue Vorlagen (insgesamt ${j.gesamt}).`, 'ok');
        const r2 = await fetch('/api/masterclass'); this.mcListe = (await r2.json()).eintraege; zeichne();
      } catch (e) { this.app.toast(e.message, 'err'); }
    });
    zeichne();
    d.showModal();
  }
}
