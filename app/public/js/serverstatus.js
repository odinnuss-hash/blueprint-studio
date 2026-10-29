// Server-Zustand in der App: Meldung „wird vorbereitet“ beim Start (Katalog, Vorlagen-Bibliothek) und das Server-Protokoll
// (Einstellungen → Server-Protokoll …) – das, was früher im eigenen Serverfenster stand. Server: /api/status, /api/protokoll.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CSS = `
#bs-vorbereitung { position: fixed; left: 50%; top: 66px; transform: translateX(-50%); z-index: 9000; display: flex; align-items: center; gap: 10px;
  padding: 9px 16px; border-radius: 10px; background: var(--panel, #1b1e24); color: var(--text, #e8e5de); border: 1px solid var(--accent, #f59a23);
  box-shadow: 0 6px 24px rgba(0,0,0,.35); font: 13px/1.35 system-ui, 'Segoe UI', sans-serif; max-width: min(640px, 92vw); }
#bs-vorbereitung small { display: block; color: var(--muted, #a3a9b1); }
#bs-vorbereitung .kreis { width: 16px; height: 16px; flex: none; border-radius: 50%; border: 2px solid var(--accent, #f59a23); border-right-color: transparent; animation: bs-dreh .8s linear infinite; }
@keyframes bs-dreh { to { transform: rotate(360deg); } }
dialog.bs-protokoll { width: min(1000px, 94vw); height: min(80vh, 760px); padding: 0; border: 1px solid var(--line2, #454c56); border-radius: 12px; background: var(--panel, #1b1e24); color: var(--text, #e8e5de); }
dialog.bs-protokoll::backdrop { background: rgba(0,0,0,.55); }
.bs-pr { display: flex; flex-direction: column; height: 100%; font: 13px/1.4 system-ui, 'Segoe UI', sans-serif; }
.bs-pr-kopf { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--line, #2f343c); }
.bs-pr-kopf h2 { margin: 0; font-size: 17px; flex: 1; }
.bs-pr pre { flex: 1; margin: 0; padding: 10px 16px; overflow: auto; font: 12px/1.5 Consolas, 'Cascadia Mono', monospace; white-space: pre-wrap; word-break: break-word; background: var(--bg, #14161a); }
.bs-pr pre .f { color: #ff8a80; }
.bs-pr-fuss { display: flex; gap: 8px; align-items: center; padding: 10px 16px; border-top: 1px solid var(--line, #2f343c); }
.bs-pr button { font: inherit; color: inherit; background: var(--panel2, #23272e); border: 1px solid var(--line2, #454c56); border-radius: 7px; padding: 6px 12px; cursor: pointer; }
.bs-pr button:hover { border-color: var(--accent, #f59a23); }
`;
function stil() { if (!document.getElementById('bs-status-css')) { const s = document.createElement('style'); s.id = 'bs-status-css'; s.textContent = CSS; document.head.appendChild(s); } }

/** Beim App-Start: solange Katalog oder Vorlagen-Bibliothek noch geladen werden, eine kleine Meldung zeigen */
export async function vorbereitungZeigen() {
  stil();
  const start = Date.now();
  let el = null, st = null, fertig = false, frageSeit = 0;
  // Der Server rechnet beim Aufbau der Vorlagen-Bibliothek einige Sekunden am Stück und antwortet dann nicht –
  // eine lange offene Abfrage heißt also „beschäftigt“. Die Meldung erscheint erst nach 0,7 s (kurze Starts ohne Meldung).
  const text = () => {
    const beschaeftigt = frageSeit && Date.now() - frageSeit > 1000;
    if (st?.katalog === 'laedt' && !beschaeftigt) return 'Spieldaten (Katalog) werden gelesen …';
    if (st?.bibliothek === 'baut' || st?.bibliothek === 'offen' || beschaeftigt) return 'Vorlagen-Bibliothek wird aus deinen Blaupausen aufgebaut (einmalig nach dem Start, einige Sekunden) …';
    return st ? 'Gleich fertig …' : 'Server startet …';
  };
  const anzeigen = () => {
    if (fertig) return;
    if (!el && Date.now() - start > 700) { el = document.createElement('div'); el.id = 'bs-vorbereitung'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    if (el) el.innerHTML = `<span class="kreis"></span><span><b>Blueprint Studio wird vorbereitet</b><small><span>${esc(text())}</span> <span>Klicks werden danach ausgeführt.</span></small></span>`;
  };
  const tick = setInterval(anzeigen, 400);
  while (!fertig && Date.now() - start < 180000) {
    frageSeit = Date.now();
    try { st = await (await fetch('/api/status', { cache: 'no-store' })).json(); } catch { st = null; }
    frageSeit = 0;
    fertig = !!st && st.katalog !== 'laedt' && st.bibliothek === 'bereit' || (!!st && st.bibliothek === 'offen' && Date.now() - start > 20000);
    if (!fertig) await new Promise((r) => setTimeout(r, 600));
  }
  fertig = true; clearInterval(tick);
  if (el) { el.innerHTML = '<span><b>Bereit</b></span>'; setTimeout(() => el.remove(), 900); }
}

/** Server-Protokoll in einem Fenster, laufend aktualisiert */
export function protokollOeffnen() {
  stil();
  let d = document.getElementById('dlg-bs-protokoll');
  if (!d) { d = document.createElement('dialog'); d.id = 'dlg-bs-protokoll'; d.className = 'bs-protokoll'; document.body.appendChild(d); }
  d.innerHTML = `<div class="bs-pr"><div class="bs-pr-kopf"><h2>Server-Protokoll</h2><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="pr-folgen" checked> mitlaufen</label><button id="pr-zu" title="Schließen">✕</button></div>
    <pre id="pr-text">Lädt …</pre>
    <div class="bs-pr-fuss"><span id="pr-info" style="flex:1;color:var(--muted,#a3a9b1);font-size:12px"></span><button id="pr-kopie">Kopieren</button><button id="pr-ok">Schließen</button></div></div>`;
  const pre = d.querySelector('#pr-text');
  let ab = 0, zeilen = [], timer = 0;
  const holen = async () => {
    try {
      const j = await (await fetch('/api/protokoll?ab=' + ab, { cache: 'no-store' })).json();
      if (j.zeilen.length) {
        zeilen.push(...j.zeilen); ab = j.zeilen[j.zeilen.length - 1].n;
        if (pre.textContent === 'Lädt …') pre.textContent = '';
        pre.insertAdjacentHTML('beforeend', j.zeilen.map((z) => `<span${z.art === 'fehler' ? ' class="f"' : ''}>${esc(z.zeit)}  ${esc(z.text)}</span>\n`).join(''));
        if (d.querySelector('#pr-folgen').checked) pre.scrollTop = pre.scrollHeight;
      }
      d.querySelector('#pr-info').textContent = j.datei ? `Auch gespeichert in ${j.datei} (der vorige Lauf in server.alt.log).` : '';
    } catch { d.querySelector('#pr-info').textContent = 'Server nicht erreichbar.'; }
  };
  const zu = () => { clearInterval(timer); d.close(); };
  d.querySelector('#pr-zu').onclick = zu; d.querySelector('#pr-ok').onclick = zu;
  d.onclose = () => clearInterval(timer);
  d.querySelector('#pr-kopie').onclick = async () => { try { await navigator.clipboard.writeText(zeilen.map((z) => `${z.zeit} ${z.text}`).join('\n')); d.querySelector('#pr-info').textContent = 'In die Zwischenablage kopiert.'; } catch { /* egal */ } };
  d.showModal();
  holen(); timer = setInterval(holen, 1500);
}
