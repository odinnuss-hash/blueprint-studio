// Bildauswahl: breites Fenster mit allen Möglichkeiten als Kacheln (Bild + Name), Suche und Gruppen.
// Wird überall genutzt, wo aus vielen Items/Bauteilen gewählt wird (Planer-Ziele, Zulieferung, Tauschen, Formen).
//
//   const id = await bildwahl({ titel, eintraege: [{ id, name, gruppe, info, bild }], aktuell, leer: '– nicht tauschen –' });
//   → id der gewählten Kachel, '' für den Leer-Eintrag, null bei Abbrechen.

import { ICONS, iconFile, abbr, tileHtml } from './katalog.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Kachel-HTML für ein Item (Icon aus dem Spiel, sonst Kürzel) */
export function itemBild(kat, id, klasse = '') {
  const it = kat?.items?.[id];
  const icon = it && iconFile(it.icon);
  const img = icon && ICONS.has(icon) ? `<img src="icons/${encodeURI(icon)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  const fl = it?.form === 'Flüssig' || it?.form === 'Gas';
  return `<span class="tile bw-item${fl ? ' fluessig' : ''} ${klasse}" data-no-i18n>${esc(abbr(it?.name || id))}${img}</span>`;
}
/** Kachel-HTML für ein Gebäude/Bauteil */
export const bauteilBild = (kat, cls) => tileHtml(kat?.gebaeude?.[cls], cls);

let offen = null;

export function bildwahl({ titel, hinweis = '', eintraege, aktuell = null, leer = null, gruppenReihe = null }) {
  if (offen) offen.abbrechen();
  return new Promise((resolve) => {
    let d = document.getElementById('dlg-bildwahl');
    if (!d) { d = document.createElement('dialog'); d.id = 'dlg-bildwahl'; d.className = 'bw-dlg'; document.body.appendChild(d); }
    const gruppen = [...new Set(eintraege.map((e) => e.gruppe || ''))];
    if (gruppenReihe) gruppen.sort((a, b) => { const ia = gruppenReihe.indexOf(a), ib = gruppenReihe.indexOf(b); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b, 'de'); });
    const mitGruppen = gruppen.length > 1;
    d.innerHTML = `<div class="bw">
      <div class="bw-kopf">
        <h2>${esc(titel)}</h2>
        <input type="search" class="bw-suche" placeholder="Suchen …" spellcheck="false" aria-label="Suchen">
        <button type="button" class="bw-zu" aria-label="Schließen" title="Schließen (Esc)">✕</button>
      </div>
      ${hinweis ? `<p class="hint bw-hinweis">${esc(hinweis)}</p>` : ''}
      ${mitGruppen ? `<div class="bw-gruppen" role="tablist"><button type="button" class="bw-chip on" data-g="*">Alle <small>${eintraege.length}</small></button>${gruppen.map((g) => `<button type="button" class="bw-chip" data-g="${esc(g)}">${esc(g || 'Sonstiges')} <small>${eintraege.filter((e) => (e.gruppe || '') === g).length}</small></button>`).join('')}</div>` : ''}
      <div class="bw-liste"></div>
      <div class="bw-fuss"><span class="muted bw-zahl"></span>${leer ? `<button type="button" class="btn small bw-leer">${esc(leer)}</button>` : ''}<button type="button" class="btn small bw-abbr">Abbrechen</button></div>
    </div>`;
    let gruppe = '*', suche = '';
    const liste = d.querySelector('.bw-liste');
    const karte = (e) => `<button type="button" class="bw-karte${e.id === aktuell ? ' aktuell' : ''}${e.aus ? ' aus' : ''}" data-id="${esc(e.id)}" title="${esc(e.name)}${e.info ? ' – ' + esc(e.info) : ''}"${e.aus ? ' disabled' : ''}>
        ${e.bild}<span class="bw-name" data-no-i18n>${esc(e.name)}</span>${e.info ? `<span class="bw-info">${esc(e.info)}</span>` : ''}${e.marke ? `<span class="bw-marke">${esc(e.marke)}</span>` : ''}</button>`;
    const zeichne = () => {
      const q = norm(suche);
      const passt = eintraege.filter((e) => (gruppe === '*' || (e.gruppe || '') === gruppe) && (!q || norm(e.name).includes(q) || norm(e.suche).includes(q)));
      let html = '';
      if (gruppe === '*' && mitGruppen && !q) {
        for (const g of gruppen) { const l = passt.filter((e) => (e.gruppe || '') === g); if (l.length) html += `<h3 class="bw-g">${esc(g || 'Sonstiges')}</h3><div class="bw-grid">${l.map(karte).join('')}</div>`; }
      } else html = `<div class="bw-grid">${passt.map(karte).join('')}</div>`;
      liste.innerHTML = passt.length ? html : '<p class="muted bw-nichts">Nichts gefunden.</p>';
      d.querySelector('.bw-zahl').textContent = `${passt.length} von ${eintraege.length}`;
      d._erster = passt.find((e) => !e.aus)?.id ?? null;
    };
    const fertig = (wert) => { offen = null; d.close(); resolve(wert); };
    offen = { abbrechen: () => fertig(null) };
    liste.addEventListener('click', (e) => { const k = e.target.closest('.bw-karte'); if (k && !k.disabled) fertig(k.dataset.id); });
    d.querySelectorAll('.bw-chip').forEach((c) => c.addEventListener('click', () => {
      gruppe = c.dataset.g; d.querySelectorAll('.bw-chip').forEach((x) => x.classList.toggle('on', x === c)); zeichne(); liste.scrollTop = 0;
    }));
    const such = d.querySelector('.bw-suche');
    such.addEventListener('input', () => { suche = such.value; zeichne(); });
    such.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (d._erster != null) fertig(d._erster); } });
    d.querySelector('.bw-zu').addEventListener('click', () => fertig(null));
    d.querySelector('.bw-abbr').addEventListener('click', () => fertig(null));
    d.querySelector('.bw-leer')?.addEventListener('click', () => fertig(''));
    d.oncancel = (e) => { e.preventDefault(); fertig(null); };
    d.onclick = (e) => { if (e.target === d) fertig(null); }; // Klick neben das Fenster
    zeichne();
    d.showModal();
    such.focus();
    d.querySelector('.bw-karte.aktuell')?.scrollIntoView({ block: 'center' });
  });
}

/**
 * Macht aus einem <select> einen Knopf mit Bild, der die Bildauswahl öffnet. Das <select> bleibt (versteckt)
 * die Quelle für den Wert – vorhandene Logik (value, change-Ereignis) funktioniert unverändert weiter.
 * opt = { titel, bild(value) → HTML, gruppe(value), info(value), marke(value), hinweis, gruppenReihe }
 */
export function selectMitBildern(sel, opt) {
  if (!sel || sel.dataset.bw) return;
  sel.dataset.bw = '1';
  sel.hidden = true;
  const knopf = document.createElement('button');
  knopf.type = 'button'; knopf.className = 'bw-knopf';
  knopf.setAttribute('aria-label', sel.getAttribute('aria-label') || opt.titel);
  sel.after(knopf);
  const leerOpt = () => [...sel.options].find((o) => o.value === '');
  const aktualisieren = () => {
    const o = sel.selectedOptions[0];
    const v = sel.value;
    knopf.innerHTML = `${v ? opt.bild(v) : '<span class="tile pl-tile leer"></span>'}<span class="bw-k-name" data-no-i18n>${esc(o ? o.textContent : '–')}</span><span class="bw-k-pfeil">▦</span>`;
  };
  aktualisieren();
  sel.addEventListener('change', aktualisieren);
  knopf.addEventListener('click', async () => {
    const eintraege = [...sel.options].filter((o) => o.value !== '').map((o) => ({
      id: o.value, name: o.textContent, bild: opt.bild(o.value), gruppe: opt.gruppe?.(o.value) || '', info: opt.info?.(o.value) || '', marke: opt.marke?.(o.value) || '', aus: o.disabled,
    }));
    const w = await bildwahl({ titel: opt.titel, hinweis: opt.hinweis, eintraege, aktuell: sel.value || null, leer: leerOpt()?.textContent || null, gruppenReihe: opt.gruppenReihe });
    if (w === null || w === sel.value) return;
    sel.value = w;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return knopf;
}
