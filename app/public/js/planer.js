// Produktionsplaner: Ziele eingeben (was, wie viel pro Minute), vorhandene Zulieferungen, Rezepte wählen.
// Ergebnis als Graph (Rohstoffe -> Fertigungsschritte -> Ziel) und als Liste; daraus wird später die Blaupause erzeugt.

import { rechne, rezeptOptionen, istRohstoff, rezepteJeItem, standardRezept, PRODUKTION, vorstufen } from './planer-rechner.js';
import { bildwahl, itemBild } from './bildwahl.js';
import { tileHtml, fmt, ICONS, iconFile } from './katalog.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SPEICHER = 'bs.planer';
// Gebäude mit Reihen-Bauplan: Anschlüsse [Band ein, Rohr ein, Band aus, Rohr aus] (wie lib/fabrik.mjs GEO)
const ANSCHLUSS = {
  Build_SmelterMk1_C: [1, 0, 1, 0], Build_ConstructorMk1_C: [1, 0, 1, 0], Build_AssemblerMk1_C: [2, 0, 1, 0], Build_FoundryMk1_C: [2, 0, 1, 0],
  Build_ManufacturerMk1_C: [4, 0, 1, 0], Build_OilRefinery_C: [1, 1, 1, 1], Build_Blender_C: [2, 2, 1, 1], Build_Packager_C: [1, 1, 1, 1], Build_Converter_C: [2, 0, 1, 1],
};
const kurzGeb = (g) => g.replace(/^Build_/, '').replace(/Mk1_C$|_C$/, '');

export class PlanerUI {
  constructor(app) {
    this.app = app;
    this.plan = { ziele: [], vorhanden: [], wahl: {}, band: 5, stockwerke: 1 };
    try { const s = JSON.parse(localStorage.getItem(SPEICHER) || 'null'); if (s?.ziele) this.plan = { ...this.plan, ...s }; } catch { /* egal */ }
    this.ansicht = { x: 0, y: 0, z: 1 };
    this.ergebnis = null;
    this.gebaut = false;
  }
  get kat() { return this.app.kat; }
  speichern() { if (this.grundlage) return; try { localStorage.setItem(SPEICHER, JSON.stringify(this.plan)); } catch { /* egal */ } }

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
    $('pl-fit').addEventListener('click', () => this.einpassen());
    document.querySelectorAll('[name=pl-ansicht]').forEach((r) => r.addEventListener('change', () => this.zeichneErgebnis()));
    $('pl-bp').addEventListener('click', () => this.stufeWaehlen());
    $('pl-mc').addEventListener('click', () => this.masterclassWahl());
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

  rechnen() {
    if (!this.kat) return;
    const ziele = this.plan.ziele.filter((z) => z.item && z.menge > 0);
    if (!ziele.length) { this.ergebnis = null; this.zeichneErgebnis(); return; }
    this.ergebnis = rechne(this.kat, this.plan);
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
      ${r.warnungen.map((w) => `<p class="err">${esc(w)}</p>`).join('')}`;
    $('pl-status').textContent = `${r.schritte.length} Fertigungsschritte · ${r.schritte.reduce((a, s) => a + s.anzahl, 0)} Maschinen · ${fmt(r.strom, 0)} MW`;
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
    const opt = rezeptOptionen(this.kat, haupt);
    return `<select data-item="${haupt}" data-no-i18n>${opt.map((o) => `<option value="${o.id}"${o.id === s.rezept ? ' selected' : ''}>${esc(o.name)}${o.alternativ ? ' (alt.)' : ''}</option>`).join('')}</select>`;
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
      } else if (k.art === 'roh' || k.art === 'vorhanden') {
        const m = r.rohstoffe[k.item] || r.fehlt[k.item] || r.vorhanden[k.item];
        titel = this.itemName(k.item); zeile2 = `${k.art === 'vorhanden' ? 'vorhanden' : 'Zulieferung'} · ${fmt(m, 1)} ${this.einheit(k.item)}`;
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
    const opt = rezeptOptionen(this.kat, haupt);
    let d = $('dlg-pl-rezept');
    if (!d) { d = document.createElement('dialog'); d.id = 'dlg-pl-rezept'; d.className = 'dlg-gross'; document.body.appendChild(d); }
    const zeile = (o) => `<label class="pl-rz${o.id === s.rezept ? ' on' : ''}"><input type="radio" name="pl-rz" value="${o.id}"${o.id === s.rezept ? ' checked' : ''}>
      ${itemBild(this.kat, o.produkte[0].item, 'mittel')}
      <span><b data-no-i18n>${esc(o.name)}</b>${o.alternativ ? ' <span class="pl-alt">Alternativ</span>' : ''}<small data-no-i18n>${esc(this.kat.gebaeude[o.gebaeude.find((g) => /^Build_/.test(g))]?.name || '')}</small>
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
        ${mcPasst.length || mcTeil.length ? `<h3 class="bw-g">Master Class – fertige Lehrbuch-Fabriken</h3>
        <p class="hint">Vollständige, sauber aufgebaute Fabriken aus deiner Master-Class-Sammlung, die ${mcPasst.length ? 'dein Ergebnis' : 'Zwischenprodukte deines Plans'} herstellen. Werden 1:1 übernommen.</p>
        <div class="bw-grid">${[...mcPasst, ...mcTeil].map((e) => `<button type="button" class="bw-karte" data-mc="${e.id}" title="${esc(e.beschreibung || e.name)}">${itemBild(this.kat, haupt(e)[0])}<span class="bw-name" data-no-i18n>${esc(e.name)}</span><span class="bw-info">${esc(haupt(e).slice(0, 2).map((it) => `${fmt(e.aus[it], 1)} ${this.itemName(it)}`).join(', '))}</span>${e.mc ? '<span class="bw-marke">MC</span>' : ''}</button>`).join('')}</div>` : ''}
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
      <div class="bw-fuss"><span class="muted bw-zahl">Ausgegraut = geht noch nicht (Flüssigkeiten/Rohre, Nebenprodukte) – Maus darüber zeigt den Grund.</span><button type="button" class="btn small bw-abbr">Abbrechen</button></div></div>`;
    d.querySelector('.bw-zu').addEventListener('click', () => d.close());
    d.querySelector('.bw-abbr').addEventListener('click', () => d.close());
    d.onclick = (e) => { if (e.target === d) d.close(); };
    d.querySelectorAll('[data-mc]').forEach((el) => el.addEventListener('click', () => { d.close(); this.masterclassDialog(el.dataset.mc); }));
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
  blaupauseDialog(i, art = 'einzeln') {
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
      aufbau = 'Aufbau: Verteiler (Splitter) vor jeder Maschine – bei mehreren Zutaten je Zutat eine eigene Leitung, jede weitere 8 m weiter außen und 3 m höher, die Zuführbänder laufen darüber hinweg –, Sammler (Merger) dahinter, Förderbänder verbunden, 8×1-Fundamente, je ein Schild am Eingang und am Ausgang. Neben jeder Maschine steht ein Strommast, alles ist verkabelt – du musst nur noch einen Mast an dein Netz anschließen. Höher liegende Verteiler schweben (Stützen setzt du bei Bedarf selbst).';
      vorschlag = `Planer_${this.itemName(s.produkte[0].item)}_${fmt(s.produkte[0].proMin, 0)}`;
    }
    vorschlag = vorschlag.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').slice(0, 80);
    d.innerHTML = `<form method="dialog" class="dlg"><h2>Blaupause: <span data-no-i18n>${esc(titel)}</span></h2>
      <p>${beschreibung}</p>
      ${grund ? `<p class="err">${esc(grund)}</p>` : `
      <p class="hint">${esc(aufbau)} Alle Maschinen laufen mit 100 % – die Zulieferung begrenzt die Menge.</p>
      <div class="pl-bp-grid">
        <label for="pl-bp-band">Förderband höchstens</label><select id="pl-bp-band">${[1, 2, 3, 4, 5, 6].map((m) => `<option value="${m}"${m === (this.plan.band || 6) ? ' selected' : ''}>Mk.${m} (${[0, 60, 120, 270, 480, 780, 1200][m]}/min)</option>`).join('')}</select>
        <label for="pl-bp-name">Name</label><input id="pl-bp-name" type="text" value="${esc((kette ? this.bpNameKette : this.bpName) || vorschlag)}" spellcheck="false">
        <label for="pl-bp-ziel">Speichern in</label><select id="pl-bp-ziel">${sessions.map((x) => `<option${x === ziel ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>
      </div>
      <p class="muted" id="pl-bp-info"></p>`}
      <div class="dlg-actions"><button type="button" class="btn" value="nein">Schließen</button>${grund ? '' : '<button type="button" class="btn" id="pl-bp-3d">In 3D ansehen</button><button type="button" class="btn primary" id="pl-bp-ok">Als Blaupause speichern</button>'}</div></form>`;
    d.querySelector('[value=nein]').addEventListener('click', () => d.close());
    const planDaten = () => ({ ziele: this.plan.ziele, vorhanden: this.plan.vorhanden, wahl: this.ergebnis.wahl, layout: this.plan.layout || {} });
    const daten = () => (kette ? { kette: true, bis: bis ? bis.rezept : undefined, plan: planDaten(), bandMax: +$('pl-bp-band').value } : { schritt: { rezept: s.rezept, maschinen: s.maschinen }, bandMax: +$('pl-bp-band').value });
    const post = async (url, body) => {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' }, body: JSON.stringify(body) });
      const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status); return j;
    };
    const infoText = (i2) => (i2.reihen ? `${i2.objekte} Objekte · ${i2.reihen} Reihen · ${i2.maschinen} Maschinen · ${i2.verbindungen} Verbindungen (${i2.lifte} Förderlifte) · ${i2.eingaenge} Zulieferungen · ${i2.masten} Strommasten · ${i2.fundamente} Fundamente · ca. ${i2.groesse[0]} × ${i2.groesse[1]} m` : '') || `${i2.objekte} Objekte · ${i2.maschinen} Maschinen im Abstand ${i2.abstand / 100} m · ${i2.leitungen > 1 ? i2.leitungen + ' Verteilerleitungen · ' : ''}${i2.masten ? i2.masten + ' Strommasten · ' : ''} Bänder Mk.${i2.bandEin} (Eingang) / Mk.${i2.bandAus} (Ausgang) · ${i2.fundamente} Fundamente · ca. ${i2.groesse[0]} × ${i2.groesse[1]} m`;
    if (grund) { d.showModal(); return; }
    $('pl-bp-band').addEventListener('change', (e) => { this.plan.band = +e.target.value; this.speichern(); });
    $('pl-bp-name').addEventListener('input', (e) => { if (kette) this.bpNameKette = e.target.value; else this.bpName = e.target.value; });
    $('pl-bp-ziel').addEventListener('change', (e) => { this.bpZiel = e.target.value; });
    $('pl-bp-3d').addEventListener('click', async (e) => {
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
      try {
        const j = await post('/api/planer/blaupause', { ...daten(), session, name, plan: planDaten() });
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
