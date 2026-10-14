// Eigene Rückfrage-/Eingabe-Fenster statt der Browser-Meldungen (confirm/prompt): mittig, im Stil der App.
const ICON = {
  loeschen: '<svg viewBox="0 0 448 512" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M135.2 17.7C140.6 6.8 151.7 0 163.8 0L284.2 0c12.1 0 23.2 6.8 28.6 17.7L320 32l96 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 96C14.3 96 0 81.7 0 64S14.3 32 32 32l96 0 7.2-14.3zM32 128l384 0 0 320c0 35.3-28.7 64-64 64L96 512c-35.3 0-64-28.7-64-64l0-320zm96 64c-8.8 0-16 7.2-16 16l0 224c0 8.8 7.2 16 16 16s16-7.2 16-16l0-224c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16l0 224c0 8.8 7.2 16 16 16s16-7.2 16-16l0-224c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16l0 224c0 8.8 7.2 16 16 16s16-7.2 16-16l0-224c0-8.8-7.2-16-16-16z"/></svg>',
  warnung: '<svg viewBox="0 0 512 512" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M256 32c14.2 0 27.3 7.5 34.5 19.8l216 368c7.3 12.4 7.3 27.7 .2 40.1S486.3 480 472 480L40 480c-14.3 0-27.6-7.7-34.7-20.1s-7-27.8 .2-40.1l216-368C228.7 39.5 241.8 32 256 32zm0 128c-13.3 0-24 10.7-24 24l0 112c0 13.3 10.7 24 24 24s24-10.7 24-24l0-112c0-13.3-10.7-24-24-24zm32 224a32 32 0 1 0 -64 0 32 32 0 1 0 64 0z"/></svg>',
  frage: '<svg viewBox="0 0 512 512" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM169.8 165.3c7.9-22.3 29.1-37.3 52.8-37.3l58.3 0c34.9 0 63.1 28.3 63.1 63.1c0 22.6-12.1 43.5-31.7 54.8L280 264.4c-.2 13-10.9 23.6-24 23.6c-13.3 0-24-10.7-24-24l0-13.5c0-8.6 4.6-16.5 12.1-20.8l44.3-25.4c4.7-2.7 7.6-7.7 7.6-13.1c0-8.4-6.8-15.1-15.1-15.1l-58.3 0c-3.4 0-6.4 2.1-7.5 5.3l-.4 1.2c-4.4 12.5-18.2 19-30.6 14.6s-19-18.2-14.6-30.6l.4-1.2zM224 352a32 32 0 1 1 64 0 32 32 0 1 1 -64 0z"/></svg>',
  ordner: '<svg viewBox="0 0 512 512" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M512 416c0 35.3-28.7 64-64 64L64 480c-35.3 0-64-28.7-64-64L0 96C0 60.7 28.7 32 64 32l128 0c20.1 0 39.1 9.5 51.2 25.6l19.2 25.6c6 8.1 15.5 12.8 25.6 12.8l160 0c35.3 0 64 28.7 64 64l0 256zM232 376c0 13.3 10.7 24 24 24s24-10.7 24-24l0-64 64 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-64 0 0-64c0-13.3-10.7-24-24-24s-24 10.7-24 24l0 64-64 0c-13.3 0-24 10.7-24 24s10.7 24 24 24l64 0 0 64z"/></svg>',
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fenster({ titel, text, liste, hinweis, ok = 'OK', abbrechen = 'Abbrechen', art = 'frage', eingabe = null, optionen = null, merken = null }) {
  return new Promise((fertig) => {
    const d = document.createElement('dialog');
    d.className = `bs-frage art-${art}`;
    const gefahr = art === 'loeschen';
    d.innerHTML = `<form method="dialog" class="bf-inhalt">
      <div class="bf-icon">${ICON[art] || ICON.frage}</div>
      <h2 class="bf-titel">${esc(titel)}</h2>
      ${text ? `<p class="bf-text">${esc(text)}</p>` : ''}
      ${liste?.length ? `<ul class="bf-liste">${liste.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${optionen ? `<div class="bf-optionen" role="radiogroup">${optionen.map((o, i) => `<label class="bf-option"><input type="radio" name="bf-opt" value="${esc(o.wert)}" ${o.wert === optionen.vorwahl || (!optionen.vorwahl && i === 0) ? 'checked' : ''}><span class="bf-o-text"><b>${esc(o.text)}</b>${o.info ? `<small>${esc(o.info)}</small>` : ''}</span></label>`).join('')}</div>` : ''}
      ${merken ? `<label class="check bf-merken"><input type="checkbox" class="bf-merken-cb"> ${esc(merken)}</label>` : ''}
      ${eingabe ? `<input class="bf-eingabe" type="text" spellcheck="false" autocomplete="off" value="${esc(eingabe.wert || '')}" placeholder="${esc(eingabe.platzhalter || '')}">` : ''}
      ${hinweis ? `<p class="bf-hinweis">${esc(hinweis)}</p>` : ''}
      <div class="bf-knoepfe">
        <button type="button" class="btn" value="nein">${esc(abbrechen)}</button>
        <button type="submit" class="btn ${gefahr ? 'bf-gefahr' : 'primary'}" value="ja">${esc(ok)}</button>
      </div></form>`;
    document.body.appendChild(d);
    const feld = d.querySelector('.bf-eingabe');
    const leer = eingabe || optionen ? null : false;
    let ergebnis = leer;
    const zu = (wert) => { ergebnis = wert; d.classList.add('zu'); setTimeout(() => d.close(), 120); };
    d.querySelector('[value=nein]').addEventListener('click', () => zu(leer));
    d.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (eingabe && !feld.value.trim()) { feld.focus(); return; }
      if (optionen) { const r = d.querySelector('input[name=bf-opt]:checked'); if (!r) return; zu({ wert: r.value, merken: !!d.querySelector('.bf-merken-cb')?.checked }); return; }
      zu(eingabe ? feld.value.trim() : true);
    });
    d.querySelectorAll('.bf-option').forEach((l) => l.addEventListener('dblclick', () => d.querySelector('form').requestSubmit()));
    d.addEventListener('cancel', (e) => { e.preventDefault(); zu(leer); });
    d.addEventListener('click', (e) => { if (e.target === d) zu(leer); }); // Klick daneben = Abbrechen
    d.addEventListener('keydown', (e) => e.stopPropagation()); // Editor-Tasten (Entf, Q/E …) nicht auslösen
    d.addEventListener('close', () => { d.remove(); fertig(ergebnis); });
    d.showModal();
    if (feld) { feld.focus(); feld.select(); } else d.querySelector(gefahr ? '[value=nein]' : '[value=ja]').focus();
  });
}
/** Ja/Nein-Rückfrage. Liefert true/false. art: 'frage' | 'warnung' | 'loeschen' */
export const frage = (o) => fenster(o);
/** Texteingabe. Liefert den Text oder null. */
export const eingabe = (o) => fenster({ ...o, eingabe: { wert: o.wert, platzhalter: o.platzhalter } });
/** Rückfrage bei ungespeicherten Änderungen */
export const ungespeichert = (was) => frage({ art: 'warnung', titel: 'Ungespeicherte Änderungen', text: `Die geöffnete Blaupause hat Änderungen, die noch nicht gespeichert sind. ${was}`, ok: 'Trotzdem fortfahren', abbrechen: 'Zurück' });
/** Auswahl aus einer Liste (optionen: [{ wert, text, info }], optionen.vorwahl). Liefert { wert, merken } oder null. */
export const auswahl = (o) => { const opt = [...o.optionen]; opt.vorwahl = o.vorwahl; return fenster({ ...o, optionen: opt }); };
