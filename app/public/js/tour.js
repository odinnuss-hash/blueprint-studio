// Einführung je Bereich: hebt ein Bedienelement nach dem anderen hervor (Rest abgedunkelt und unscharf) und erklärt es kurz.
// Beim ersten Besuch eines Bereichs erscheint ein kleines Angebot; jederzeit neu startbar über den Knopf „Einführung“ oben.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GESEHEN = 'bs.tour.gesehen';

// Schritte: [CSS-Selektor, Titel, Text]; fehlt ein Element oder ist es unsichtbar, wird der Schritt übersprungen
const TOUREN = {
  editor: ['Blaupausen-Editor', [
    ['#session', 'Spielstand (Sitzung)', 'Blaupausen gehören im Spiel zu einer Sitzung. Hier wählst du, wessen Blaupausen links erscheinen.'],
    ['#bp-list', 'Deine Blaupausen', 'Klick öffnet eine Blaupause, Strg + Klick markiert mehrere (z. B. zum Löschen in den Papierkorb). Oben drüber suchst du nach Namen.'],
    ['#tab-gen', 'Formen-Generator', 'Erzeugt neue Blaupausen aus Formen – Wände, Kuppeln, Pixel-Art aus einem Bild, Gebäude aus einem Grundriss.'],
    ['#ab-body', 'Ablage', 'Deine Ordner für Blaupausen. Blaupausen hierher ziehen sortiert sie ein; die Ordner erscheinen im Spiel als Kategorien.'],
    ['.ed-ablage', 'Ablage und Ordner', 'Ordner öffnet den Blaupausen-Ordner im Explorer; daneben die Ablage ein- und ausblenden oder als großes Fenster öffnen.'],
    ['#v3d', '2D und 3D', 'Umschalten zwischen Draufsicht und 3D-Ansicht mit echten Spielmodellen.'],
    ['#view-editor .toolbar', 'Werkzeuge', 'Drehen, Kippen, Anheben, Ausblenden, Löschen und Rückgängig wirken auf die Auswahl. „Maus-Drehen“: links ziehen dreht (waagerecht) oder kippt (senkrecht).'],
    ['#canvaswrap', 'Ansicht', 'Klick wählt ein Teil, Umschalt + Klick nimmt weitere dazu, Ziehen im Leeren zieht einen Rahmen. Mausrad zoomt, rechte Maustaste verschiebt die Ansicht.'],
    ['#inspector', 'Details', 'Größe, Teile und Baukosten der Blaupause. „Material prüfen“ vergleicht die Baukosten mit den Vorräten in deinem Spielstand.'],
    ['#btn-save', 'Speichern', 'Änderungen werden erst hier gespeichert – das Original wird vorher gesichert.'],
  ]],
  katalog: ['Gebäude-Katalog', [
    ['#k-suche', 'Suche', 'Gebäude oder Material suchen.'],
    ['#k-cats', 'Kategorien', 'Wie im Baumenü des Spiels.'],
    ['#k-tiers', 'Freigeschaltet bis Stufe', 'Zeigt nur, was bis zu dieser Stufe freigeschaltet ist.'],
    ['#k-cards', 'Gebäude', 'Klick auf eine Karte zeigt rechts Maße, Baukosten und Anschlüsse.'],
  ]],
  ordnen: ['Ordnen', [
    ['#o-hilfe-box', 'So funktioniert Ordnen', 'Die App liest alle Blaupausen, schlägt Namen nach dem Namensschema vor und zeigt, was einsortiert, umbenannt oder als Duplikat entfernt werden kann. Nichts passiert, bevor du „Ausgewählte anwenden“ drückst.'],
    ['#o-legend', 'Namensschema', 'Die Gruppen-Nummern vorne im Namen (z. B. 2_1_…) bestimmen den Ablage-Ordner. Die Legende zeigt, welche Nummer wofür steht.'],
    ['#o-struktur', 'Ordnerstruktur', 'Hier bearbeitest du die Gruppen und Untergruppen der Ablage – danach rechnet Ordnen die Vorschläge neu.'],
    ['#o-art', 'Was anzeigen?', '„Zu erledigen“ zeigt alle Vorschläge. Einzeln filterbar: Umbenennen, Einsortieren, Duplikate, Löschen – oder „Passen schon“ zur Kontrolle.'],
    ['#o-ort', 'Wo suchen?', 'Spiel-Ordner (die Blaupausen deiner Sitzungen), Bibliothek (deine Sammlung außerhalb des Spiels) oder beides.'],
    ['#o-body', 'Vorschläge', 'Je Zeile: alter und neuer Name, die Aktion und der Grund. Den neuen Namen kannst du anklicken und ändern. Häkchen = wird beim Anwenden ausgeführt.'],
    ['#o-apply', 'Anwenden', 'Führt die angehakten Vorschläge aus. Gelöschtes landet im Papierkorb, nichts geht endgültig verloren.'],
    ['#o-protokoll', 'Protokoll / Rückgängig', 'Jeder Durchgang wird protokolliert und lässt sich zurücknehmen.'],
    ['#o-papierkorb', 'Duplikate & Papierkorb', 'Gleiche Blaupausen unter verschiedenen Namen finden und den Papierkorb der App leeren oder wiederherstellen.'],
    ['#o-uebernehmen', 'In Ablage übernehmen', 'Vorsortierte Blaupausen aus der Bibliothek in die Ablage im Spielordner verschieben – dann sind sie im Spiel sichtbar.'],
  ]],
  karte: ['Karte', [
    ['#k-liste', 'Spielstände', 'Spielstand wählen – er erscheint als Draufsicht mit allen Bauten.'],
    ['#k-eb-knopf', 'Ebenen', 'Fundamente, Bänder, Rohre usw. ein- und ausblenden.'],
    ['#k-bauteil', 'Hervorheben', 'Bauteil suchen (z. B. „Konstruktor“) – alles andere wird abgedunkelt.'],
    ['.k-hoehe', 'Höhe', 'Nur einen Höhenbereich zeigen, etwa eine Etage einer großen Fabrik.'],
    ['.k-punkte-gruppe', 'Kartenpunkte', 'Rohstoff-Knoten, Absturzstellen, Slugs, Somersloops … mit Zustand aus dem Spielstand. ▾ wählt, was erscheint.'],
    ['.k-mp-gruppe', 'Megaprints', 'Megaprints (Exporte von satisfactory-calculator.com) suchen und auf der Karte anzeigen.'],
    ['.k-werkzeug', 'Bereich wählen', 'Rechteck oder Stift: Bereich markieren. Rechts kannst du ihn dann als Blaupause speichern oder an dieselbe Stelle in einen anderen Spielstand übertragen.'],
    ['#k-3d', 'In 3D öffnen', 'Zeigt den Spielstand in der Welt-Ansicht mit Gelände.'],
    ['#k-info', 'Infos', 'Daten zum Spielstand, Gebäude nach Art (anhaken = hervorheben) und die Aktionen für einen markierten Bereich.'],
  ]],
  welt: ['Welt', [
    ['#w-spielstand', 'Spielstand laden', 'Spielstand wählen und „Laden“ – ohne Spielstand siehst du nur das Gelände.'],
    ['#w-canvas', 'Fliegen', 'In die Ansicht klicken, dann W A S D fliegen, Leertaste / C hoch und runter, Umschalt schneller, Maus ziehen = umsehen.'],
    ['.w-werkzeuge', 'Werkzeuge', 'Alle Werkzeuge der Welt-Ansicht liegen in dieser Leiste.'],
    ['#w-stift', 'Stift', 'Bereich umranden – auch verdeckte Teile im Inneren werden gewählt – und als Blaupause speichern.'],
    ['#w-bp-ablage', 'Blaupausen setzen', 'Blaupause aus der Ablage wählen; sie hängt an der Maus. Klick setzt ab, R dreht, gesetzte lassen sich anklicken und genau einstellen.'],
    ['#w-ego', 'Ego-Modus', 'Startpunkt anklicken und auf Augenhöhe durch deine Fabriken gehen. Esc bringt dich zurück.'],
    ['label:has(#w-leistung)', 'Leistungsmodus', 'Für sehr große Spielstände: Ferne vereinfacht, weiter weg als Quader. Schaltet sich bei Bedarf selbst ein.'],
    ['#w-punkte', 'Kartenpunkte', 'Rohstoff-Knoten, Absturzstellen und Sammelobjekte in 3D.'],
    ['#w-neu-name', 'Speichern', 'Gesetztes und Geändertes kommt in eine neue Spielstand-Datei – das Original bleibt unverändert.'],
  ]],
  planer: ['Planer', [
    ['#pl-ziele', 'Ziel', 'Was die Fabrik pro Minute herstellen soll.'],
    ['#pl-vorhanden', 'Vorhanden', 'Was schon angeliefert wird – das stellt die Fabrik nicht mehr selbst her.'],
    ['#pl-modus', 'Rechenweg', 'Einfach, Optimal (möglichst wenig Rohstoffe) oder Maximum aus „Vorhanden“.'],
    ['#pl-takt', 'Übertakten', 'Weniger Maschinen, dafür Power-Shards.'],
    ['#pl-alt', 'Alternativrezepte', 'Welche Alternativrezepte der Planer nutzen darf – am besten die, die du im Spiel freigeschaltet hast.'],
    ['.pl-werkzeuge', 'Felder', 'Welt-Plan, Bauliste und Infos aus dem Spielstand (Produktion, Strom, Vorräte, Knoten). Klick öffnet links ein Feld.'],
    ['#pl-svg', 'Graph', 'Der Fertigungsweg. Kästen lassen sich verschieben, ein Klick auf ein Item wählt sein Rezept.'],
    ['#pl-bp', 'Als Blaupause bauen', 'Eine Fertigungsstufe als fertige Blaupause mit Maschinen, Bändern und Strom bauen.'],
    ['#pl-fabrik', 'Fabriken', 'Mehrere Fabriken planen; der Welt-Plan rechnet sie zusammen.'],
  ]],
};

export class Tour {
  constructor(app) {
    this.app = app; this.aktiv = null;
    try { this.gesehen = new Set(JSON.parse(localStorage.getItem(GESEHEN) || '[]')); } catch { this.gesehen = new Set(); }
    $('btn-tour')?.addEventListener('click', () => this.starten(this.app.area || 'editor'));
    // Startbereich (vor dem ersten Bereichswechsel): Angebot erst, wenn die App steht
    setTimeout(() => { if (!document.body.dataset.bereich) this.bereich(this.app.area || 'editor'); }, 1500);
    window.addEventListener('resize', () => this.zeigen());
    document.addEventListener('keydown', (e) => {
      if (!this.aktiv) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.ende(); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.weiter(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); this.weiter(-1); }
    }, true);
  }
  merken(b) { this.gesehen.add(b); try { localStorage.setItem(GESEHEN, JSON.stringify([...this.gesehen])); } catch { /* egal */ } }
  /** Beim Wechsel in einen Bereich: beim ersten Mal ein kleines Angebot zeigen */
  bereich(b) {
    $('tour-angebot')?.remove();
    $('btn-tour').hidden = !TOUREN[b];
    if (!TOUREN[b] || this.gesehen.has(b) || this.aktiv) return;
    const d = document.createElement('div'); d.id = 'tour-angebot'; d.className = 'tour-angebot';
    d.innerHTML = `<b>Neu hier?</b> Kurze Einführung zu „${esc(TOUREN[b][0])}“ – zeigt die wichtigsten Funktionen nacheinander.
      <div class="tour-knoepfe"><button type="button" class="btn small primary" data-t="los">Einführung starten</button><button type="button" class="btn small" data-t="nein">Nein, danke</button></div>
      <small class="muted">Später jederzeit über „Einführung“ oben rechts.</small>`;
    document.body.appendChild(d);
    d.querySelector('[data-t="los"]').addEventListener('click', () => { d.remove(); this.starten(b); });
    d.querySelector('[data-t="nein"]').addEventListener('click', () => { d.remove(); this.merken(b); });
  }
  starten(b) {
    const t = TOUREN[b]; if (!t) return;
    $('tour-angebot')?.remove();
    const schritte = t[1].filter(([sel]) => { const el = document.querySelector(sel); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (!schritte.length) return;
    this.aktiv = { b, schritte, i: 0 };
    if (!this.ebene) {
      const e = this.ebene = document.createElement('div'); e.className = 'tour'; e.setAttribute('role', 'dialog'); e.setAttribute('aria-modal', 'true');
      e.innerHTML = '<div class="tour-blende" data-s="o"></div><div class="tour-blende" data-s="u"></div><div class="tour-blende" data-s="l"></div><div class="tour-blende" data-s="r"></div><div class="tour-ring"></div><div class="tour-blase" tabindex="-1"></div>';
      e.addEventListener('click', (ev) => { if (ev.target.closest('.tour-blende')) this.ende(); });
      document.body.appendChild(e);
    }
    this.ebene.hidden = false; this.zeigen();
  }
  weiter(d) { const a = this.aktiv; if (!a) return; const i = a.i + d; if (i < 0) return; if (i >= a.schritte.length) { this.ende(); return; } a.i = i; this.zeigen(); }
  ende() { if (!this.aktiv) return; this.merken(this.aktiv.b); this.aktiv = null; if (this.ebene) this.ebene.hidden = true; }
  zeigen() {
    const a = this.aktiv; if (!a || !this.ebene) return;
    const [sel, titel, text] = a.schritte[a.i], el = document.querySelector(sel);
    if (!el) { this.weiter(1); return; }
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect(), W = innerWidth, H = innerHeight, p = 6;
    const x0 = Math.max(0, r.left - p), y0 = Math.max(0, r.top - p), x1 = Math.min(W, r.right + p), y1 = Math.min(H, r.bottom + p);
    const setz = (s, l, t, w, h) => Object.assign(this.ebene.querySelector(`[data-s="${s}"]`).style, { left: l + 'px', top: t + 'px', width: Math.max(0, w) + 'px', height: Math.max(0, h) + 'px' });
    setz('o', 0, 0, W, y0); setz('u', 0, y1, W, H - y1); setz('l', 0, y0, x0, y1 - y0); setz('r', x1, y0, W - x1, y1 - y0);
    Object.assign(this.ebene.querySelector('.tour-ring').style, { left: x0 + 'px', top: y0 + 'px', width: x1 - x0 + 'px', height: y1 - y0 + 'px' });
    const bl = this.ebene.querySelector('.tour-blase'), n = a.schritte.length;
    bl.innerHTML = `<div class="tour-kopf"><b>${esc(titel)}</b><span class="muted">${a.i + 1} / ${n}</span></div><p>${esc(text)}</p>
      <div class="tour-knoepfe"><button type="button" class="btn small" data-t="zu">Beenden</button><span class="grow"></span>${a.i ? '<button type="button" class="btn small" data-t="zurueck">Zurück</button>' : ''}<button type="button" class="btn small primary" data-t="weiter">${a.i + 1 < n ? 'Weiter' : 'Fertig'}</button></div>`;
    bl.querySelector('[data-t="zu"]').addEventListener('click', () => this.ende());
    bl.querySelector('[data-t="zurueck"]')?.addEventListener('click', () => this.weiter(-1));
    bl.querySelector('[data-t="weiter"]').addEventListener('click', () => this.weiter(1));
    // Blase neben das Element: unten, sonst oben, sonst rechts/links daneben; immer im Fenster
    const bw = Math.min(340, W - 24); bl.style.width = bw + 'px';
    const bh = bl.offsetHeight;
    let bx = Math.min(Math.max(12, r.left), W - bw - 12), by;
    if (y1 + 12 + bh < H) by = y1 + 12;
    else if (y0 - 12 - bh > 0) by = y0 - 12 - bh;
    else { by = Math.min(Math.max(12, r.top), H - bh - 12); bx = x1 + 12 + bw < W ? x1 + 12 : Math.max(12, x0 - 12 - bw); }
    Object.assign(bl.style, { left: bx + 'px', top: by + 'px' });
    bl.querySelector('[data-t="weiter"]').focus();
  }
}
