// Profile: globale Arbeitsbereiche der App (Server: lib/profile.mjs). Ein Profil ist aktiv; Planer (alle Fabriken) und
// Baukasten-Reißbrett werden laufend darin gespeichert. Je Profil gibt es Ideen – benannte Planungsstände mit Planer,
// Reißbrett und einer Auswahl von Blaupausen –, die einzeln oder zusammen geladen werden. Gemeinsam für Haupt-App
// (Knopf oben) und Baukasten; beide liegen im Browser-Speicher derselben App. Nach Laden/Wechseln lädt die Seite neu.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const datum = (t) => new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
async function api(url, body) {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' }, body: JSON.stringify(body), keepalive: JSON.stringify(body).length < 60000 } : {});
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.fehler || j.error || r.status); return j;
}
const lies = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };

/** Aktueller Stand aus dem Browser-Speicher */
export function aktuellerStand() {
  const welt = lies('bs.planer.welt'), plan = lies('bs.planer'), brett = lies('bs-baukasten');
  return { planer: welt || plan ? { welt, plan } : null, baukasten: brett?.teile?.length || brett?.ziel?.item || brett?.ziel?.ziele?.length ? brett : null };
}
/** Stand in den Browser-Speicher schreiben; null = leeren */
function standSetzen({ planer, baukasten }, nurWasDa = false) {
  try {
    if (planer || !nurWasDa) { localStorage.removeItem('bs.planer'); localStorage.removeItem('bs.planer.welt'); if (planer?.welt) localStorage.setItem('bs.planer.welt', JSON.stringify(planer.welt)); if (planer?.plan) localStorage.setItem('bs.planer', JSON.stringify(planer.plan)); }
    if (baukasten) localStorage.setItem('bs-baukasten', JSON.stringify(baukasten)); else if (!nurWasDa) localStorage.removeItem('bs-baukasten');
  } catch { /* Speicher voll/gesperrt */ }
}
const fabrikenVon = (x) => x?.planer?.welt?.fabriken?.length ? x.planer.welt.fabriken : x?.planer?.plan ? [{ name: 'Plan', plan: x.planer.plan }] : [];

// ------------------------------------------------------------------ laufende Speicherung ins aktive Profil
let knopfEl = null, letzter = null, aktivName = '';
function beschriften() { if (knopfEl) { knopfEl.textContent = aktivName ? `Profil: ${aktivName.length > 22 ? aktivName.slice(0, 21) + '…' : aktivName}` : 'Profile'; knopfEl.title = (aktivName ? `Aktives Profil „${aktivName}“ – ` : '') + 'Profile und Ideen: Planer, Reißbrett und Blaupausen-Auswahl speichern und wieder laden'; } }
async function sichern(sofort = false) {
  const st = aktuellerStand(), s = JSON.stringify(st);
  if (s === letzter && !sofort) return;
  if (!st.planer && !st.baukasten && !aktivName) { letzter = s; return; } // nichts zu sichern, noch kein Profil
  try { const r = await api('/api/profile/arbeitsstand', st); letzter = s; if (r.name || r.neu) { if (r.neu) await nameHolen(); else aktivName = r.name; beschriften(); } } catch { /* später erneut */ }
}
async function nameHolen() { try { const l = await api('/api/profile'); aktivName = l.profile.find((p) => p.aktiv)?.name || ''; } catch { /* egal */ } beschriften(); }
let laeuft = false;
function automatik() {
  if (laeuft) return; laeuft = true;
  nameHolen();
  setInterval(() => { if (document.visibilityState === 'visible') sichern(); }, 4000);
  addEventListener('pagehide', () => sichern());
}

// ------------------------------------------------------------------ Dialog
const CSS = `
dialog.pf-dlg { width: min(1040px, 96vw); max-height: 90vh; padding: 0; border: 1px solid var(--line2, #454c56); border-radius: 12px; background: var(--panel, #1b1e24); color: var(--text, #e8e5de); }
dialog.pf-dlg::backdrop { background: rgba(0,0,0,.55); }
.pf { display: flex; flex-direction: column; max-height: 90vh; font: 13px/1.4 system-ui, 'Segoe UI', sans-serif; }
.pf-kopf { display: flex; align-items: center; gap: 10px; padding: 14px 18px 8px; }
.pf-kopf h2 { margin: 0; font-size: 18px; flex: 1; }
.pf-inhalt { overflow: auto; padding: 4px 18px 12px; }
.pf-zwei { display: grid; grid-template-columns: 260px 1fr; gap: 16px; min-height: 0; overflow: hidden; padding: 4px 18px 14px; }
.pf-zwei > div { overflow: auto; max-height: calc(90vh - 90px); }
.pf-fuss { display: flex; gap: 8px; justify-content: flex-end; align-items: center; padding: 10px 18px; border-top: 1px solid var(--line, #2f343c); }
.pf button, .pf input, .pf textarea, .pf select { font: inherit; color: inherit; background: var(--panel2, #23272e); border: 1px solid var(--line2, #454c56); border-radius: 7px; padding: 6px 10px; }
.pf button { cursor: pointer; } .pf button:hover { border-color: var(--accent, #f59a23); } .pf button:disabled { opacity: .5; cursor: default; }
.pf button.primaer { background: var(--accent, #f59a23); border-color: var(--accent, #f59a23); color: #1a1206; font-weight: 600; }
.pf .muted { color: var(--muted, #a3a9b1); }
.pf-kopf2 { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted, #a3a9b1); margin: 4px 0 6px; }
.pf-prof { display: block; width: 100%; text-align: left; margin: 0 0 6px; padding: 8px 10px !important; }
.pf-prof.gewaehlt { border-color: var(--accent, #f59a23) !important; box-shadow: 0 0 0 1px var(--accent, #f59a23) inset; }
.pf-prof b { display: block; } .pf-prof small { color: var(--muted, #a3a9b1); }
.pf-aktiv { font-size: 10px; font-weight: 700; color: #1a1206; background: #7fd49a; border-radius: 999px; padding: 0 7px; margin-left: 6px; }
.pf-karte { display: grid; grid-template-columns: auto 1fr auto; gap: 2px 10px; align-items: start; padding: 9px 12px; margin: 6px 0; border: 1px solid var(--line, #2f343c); border-radius: 9px; background: var(--panel2, #23272e); }
.pf-karte.auto { opacity: .8; border-style: dashed; }
.pf-karte > input { margin-top: 3px; grid-row: span 3; }
.pf-karte .pf-knoepfe { grid-row: span 3; display: flex; gap: 6px; }
.pf-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: flex-start; }
.pf-chip { display: inline-block; line-height: 18px; font-size: 11px; padding: 1px 8px; border-radius: 999px; background: rgba(245,154,35,.14); color: #f5c46a; }
.pf label { display: block; margin: 10px 0 4px; color: var(--muted, #a3a9b1); }
.pf input[type=text], .pf textarea { width: 100%; box-sizing: border-box; }
.pf-was { display: flex; gap: 16px; flex-wrap: wrap; } .pf-was label { display: flex; gap: 6px; align-items: center; margin: 0; color: inherit; }
.pf-bps { max-height: 32vh; overflow: auto; border: 1px solid var(--line, #2f343c); border-radius: 8px; padding: 4px 8px; }
.pf-bp, .pf label.pf-bp { display: flex; gap: 8px; align-items: center; padding: 3px 0; margin: 0; border-bottom: 1px solid var(--line, #2f343c); color: inherit; }
.pf-bp small { margin-left: auto; padding-left: 12px; color: var(--muted, #a3a9b1); text-align: right; }
.pf-bp .an { color: #7fd49a; }
.pf-fuss select { width: auto; flex: none; }
.pf-tour { position: fixed; inset: 0; pointer-events: none; z-index: 5; }
.pf-blase { position: fixed; width: 340px; font: 13px/1.4 system-ui, 'Segoe UI', sans-serif; color: var(--text, #e8e5de); pointer-events: auto; background: var(--panel, #1b1e24); border: 1px solid var(--accent, #f59a23); border-radius: 10px; padding: 10px 12px; box-shadow: 0 10px 30px rgba(0,0,0,.55); }
.pf-blase p { margin: 6px 0 10px; } .pf-tkopf { display: flex; justify-content: space-between; gap: 8px; } .pf-tk { display: flex; gap: 6px; justify-content: flex-end; }
.pf-blase button { font: inherit; color: inherit; background: var(--panel2, #23272e); border: 1px solid var(--line2, #454c56); border-radius: 7px; padding: 5px 10px; cursor: pointer; }
.pf-blase button:hover { border-color: var(--accent, #f59a23); } .pf-blase button.primaer { background: var(--accent, #f59a23); border-color: var(--accent, #f59a23); color: #1a1206; font-weight: 600; }
.pf-hervor { outline: 2px solid var(--accent, #f59a23) !important; outline-offset: 3px; border-radius: 8px; }
.pf-erg { margin: 4px 0; } .pf-erg .ok { color: #7fd49a; } .pf-erg .err { color: #ff8a80; }
@media (max-width: 760px) { .pf-zwei { grid-template-columns: 1fr; } }
`;
let dlg = null;
function dialog() {
  if (!document.getElementById('pf-css')) { const st = document.createElement('style'); st.id = 'pf-css'; st.textContent = CSS; document.head.appendChild(st); }
  if (!dlg) { dlg = document.createElement('dialog'); dlg.className = 'pf-dlg'; document.body.appendChild(dlg); dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); }
  return dlg;
}
const chips = (i) => `${i.fabriken.length ? `<span class="pf-chip">Planer: ${i.fabriken.map(esc).join(', ')}${i.ziele ? ` (${i.ziele} Ziel${i.ziele === 1 ? '' : 'e'})` : ''}</span>` : ''}${i.baukasten ? `<span class="pf-chip">Reißbrett: ${i.baukasten} Teile</span>` : ''}${i.blaupausen ? `<span class="pf-chip">${i.blaupausen} Blaupause${i.blaupausen === 1 ? '' : 'n'}</span>` : ''}` || '<span class="muted">leer</span>';

export async function profileOeffnen({ neueIdee = false } = {}) {
  const d = dialog();
  await sichern(true); // aktuellen Stand vorher ins aktive Profil
  let gewaehlt = null, ersterAufruf = true;

  const uebersicht = async () => {
    let L; try { L = await api('/api/profile'); } catch (e) { d.innerHTML = `<div class="pf"><div class="pf-inhalt"><p class="pf-erg"><span class="err">${esc(e.message)}</span></p></div></div>`; if (!d.open) d.showModal(); return; }
    aktivName = L.profile.find((p) => p.aktiv)?.name || ''; beschriften();
    if (!L.profile.some((p) => p.id === gewaehlt)) gewaehlt = L.aktiv || L.profile[0]?.id || null;
    const P = L.profile.find((p) => p.id === gewaehlt);
    const links = `<div><div class="pf-kopf2">Profile</div>${L.profile.map((p) => `<button class="pf-prof${p.id === gewaehlt ? ' gewaehlt' : ''}" data-prof="${esc(p.id)}"><b>${esc(p.name)}${p.aktiv ? '<span class="pf-aktiv">aktiv</span>' : ''}</b><small>${p.ideen.filter((i) => !i.auto).length} Idee${p.ideen.filter((i) => !i.auto).length === 1 ? '' : 'n'} · ${datum(p.zeit)}</small></button>`).join('') || '<p class="muted">Noch kein Profil – es entsteht automatisch, sobald du planst, oder mit „Neues Profil“.</p>'}
      <button id="pf-neuprof" style="width:100%;margin-top:6px">+ Neues Profil …</button></div>`;
    let rechts = '<div><p class="muted">Links ein Profil wählen oder anlegen.</p></div>';
    if (P) {
      rechts = `<div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><h3 style="margin:0;font-size:16px;flex:1">${esc(P.name)}${P.aktiv ? '<span class="pf-aktiv">aktiv</span>' : ''}</h3>
        ${P.aktiv ? '' : '<button id="pf-wechseln" class="primaer" title="Aktuellen Stand im aktiven Profil sichern und zu diesem Profil wechseln">Zu diesem Profil wechseln</button>'}
        <button id="pf-pumb" title="Profil umbenennen">✎</button><button id="pf-pweg" title="Profil löschen (Papierkorb der App)">🗑</button></div>
        <p class="muted" style="margin:6px 0 10px">Arbeitsstand: ${chips(P.arbeitsstand)}${P.aktiv ? ' · wird laufend gespeichert' : ''}</p>
        <div style="display:flex;gap:8px;align-items:center"><div class="pf-kopf2" style="flex:1;margin:0">Ideen</div><button id="pf-neuidee" class="primaer">Aktuellen Stand als Idee speichern …</button></div>
        ${P.ideen.length ? P.ideen.map((i) => `<div class="pf-karte${i.auto ? ' auto' : ''}" data-idee="${esc(i.id)}"><input type="checkbox" data-wahl title="zum Laden auswählen">
          <div><b>${esc(i.name)}</b> <span class="muted">· ${datum(i.zeit)}${i.auto ? ' · automatisch' : ''}</span></div>
          <div class="pf-knoepfe"><button data-akt="ueber" title="Mit dem aktuellen Stand überschreiben">Überschreiben</button><button data-akt="umb" title="Umbenennen">✎</button><button data-akt="weg" title="Löschen (Papierkorb der App)">🗑</button></div>
          <div class="pf-chips">${chips(i.inhalt)}</div>${i.notiz ? `<div class="muted">${esc(i.notiz)}</div>` : '<div></div>'}</div>`).join('') : '<p class="muted">Noch keine Ideen in diesem Profil.</p>'}</div>`;
    }
    d.innerHTML = `<div class="pf"><div class="pf-kopf"><h2>Profile &amp; Ideen</h2><button id="pf-tour" title="Einführung: Profile und Ideen Schritt für Schritt erklärt">? Einführung</button><button id="pf-zu" title="Schließen">✕</button></div>
      <div class="pf-zwei">${links}${rechts}</div>
      ${P?.ideen.length ? `<div class="pf-fuss"><span class="muted" id="pf-wahlinfo" style="margin-right:auto">Ideen anhaken, dann laden – mehrere werden im Planer als eigene Fabriken nebeneinander geladen.</span>
        <select id="pf-modus" title="Was passiert mit deinem aktuellen Planer?"><option value="ersetzen">Planer ersetzen</option><option value="dazu">Zu meinen Fabriken hinzufügen</option></select>
        <button class="primaer" id="pf-laden" disabled>Gewählte laden</button></div>` : ''}</div>`;
    if (!d.open) d.showModal();
    d.querySelector('#pf-zu').onclick = () => d.close();
    d.querySelector('#pf-tour').onclick = () => einfuehrung(d, true);
    d.querySelectorAll('[data-prof]').forEach((b) => (b.onclick = () => { gewaehlt = b.dataset.prof; uebersicht(); }));
    d.querySelector('#pf-neuprof').onclick = async () => {
      const n = prompt('Name für das neue Profil:', ''); if (!n || !n.trim()) return;
      const mit = confirm('Mit deinem aktuellen Stand (Planer und Reißbrett) beginnen?\n\nOK = aktuellen Stand mitnehmen · Abbrechen = leer beginnen\n(Der bisherige Stand bleibt im bisherigen Profil gespeichert.)');
      try { await sichern(true); const r = await api('/api/profile/anlegen', { name: n.trim(), arbeitsstand: mit ? aktuellerStand() : null }); if (!mit) { standSetzen({ planer: null, baukasten: null }); d.close(); location.reload(); return; } gewaehlt = r.id; letzter = null; uebersicht(); } catch (e) { alert(e.message); }
    };
    if (!P) return;
    d.querySelector('#pf-wechseln')?.addEventListener('click', async () => {
      try { await sichern(true); const r = await api('/api/profile/aktivieren', { id: P.id }); standSetzen(r.arbeitsstand || {}); letzter = JSON.stringify(aktuellerStand()); d.close(); location.reload(); } catch (e) { alert(e.message); }
    });
    d.querySelector('#pf-pumb').onclick = async () => { const n = prompt('Neuer Name für das Profil:', P.name); if (n && n.trim()) { try { await api('/api/profile/umbenennen', { id: P.id, name: n.trim() }); uebersicht(); } catch (e) { alert(e.message); } } };
    d.querySelector('#pf-pweg').onclick = async () => {
      if (!confirm(`Profil „${P.name}“ mit allen Ideen löschen?\nEs kommt in den Papierkorb der App (userdata\\papierkorb\\profile).${P.aktiv ? '\nDein aktueller Stand bleibt im Planer und Reißbrett; beim nächsten Planen entsteht wieder ein Profil.' : ''}`)) return;
      try { await api('/api/profile/loeschen', { id: P.id }); if (P.aktiv) { aktivName = ''; beschriften(); } gewaehlt = null; uebersicht(); } catch (e) { alert(e.message); }
    };
    d.querySelector('#pf-neuidee').onclick = () => ideeBearbeiten(P, null);
    if (ersterAufruf) { ersterAufruf = false; if (neueIdee && P.aktiv) return ideeBearbeiten(P, null); einfuehrung(d, false); }
    const wahl = () => [...d.querySelectorAll('.pf-karte')].filter((k) => k.querySelector('[data-wahl]').checked).map((k) => k.dataset.idee);
    d.querySelectorAll('.pf-karte').forEach((k) => {
      k.querySelector('[data-wahl]').onchange = () => { const n = wahl().length; d.querySelector('#pf-laden').disabled = !n; d.querySelector('#pf-laden').textContent = n > 1 ? `${n} Ideen laden` : 'Gewählte laden'; };
      k.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-akt]'); if (!b) return;
        const i = P.ideen.find((x) => x.id === k.dataset.idee);
        try {
          if (b.dataset.akt === 'ueber') return ideeBearbeiten(P, await api(`/api/profile/eintrag?profil=${encodeURIComponent(P.id)}&idee=${encodeURIComponent(i.id)}`));
          if (b.dataset.akt === 'umb') { const n = prompt('Neuer Name für die Idee:', i.name); if (n && n.trim()) { await api('/api/profile/idee/umbenennen', { profil: P.id, idee: i.id, name: n.trim() }); uebersicht(); } return; }
          if (b.dataset.akt === 'weg') { if (confirm(`Idee „${i.name}“ löschen? (Papierkorb der App)`)) { await api('/api/profile/idee/loeschen', { profil: P.id, idee: i.id }); uebersicht(); } }
        } catch (err) { alert(err.message); }
      });
    });
    d.querySelector('#pf-laden')?.addEventListener('click', () => laden(P, wahl(), d.querySelector('#pf-modus').value));
  };

  // Idee speichern (neu oder überschreiben): Name, Notiz, was hinein, Blaupausen auswählen
  const ideeBearbeiten = async (P, alt) => {
    const st = aktuellerStand();
    d.innerHTML = '<div class="pf"><div class="pf-kopf"><h2>Idee speichern</h2></div><div class="pf-inhalt"><p class="muted">Blaupausen werden gelesen …</p></div></div>';
    let k = { blaupausen: [], sitzungen: [] }; try { k = await api('/api/profile/blaupausen'); } catch { /* ohne Liste */ }
    const gew = new Set((alt?.blaupausen || []).map((b) => b.session + '|' + b.name));
    const fabriken = fabrikenVon(st).map((f) => f.name);
    const bps = k.blaupausen.sort((a, b) => (b.aktiv - a.aktiv) || a.name.localeCompare(b.name, 'de'));
    d.innerHTML = `<div class="pf"><div class="pf-kopf"><h2>${alt ? `Idee „${esc(alt.name)}“ überschreiben` : 'Neue Idee'} <span class="muted" style="font-size:13px;font-weight:400">in „${esc(P.name)}“</span></h2></div><div class="pf-inhalt">
      <label for="pf-name">Name</label><input type="text" id="pf-name" value="${esc(alt?.name || '')}" placeholder="z. B. Verstärkte Eisenplatten" spellcheck="false">
      <label for="pf-notiz">Notiz (optional)</label><textarea id="pf-notiz" rows="2">${esc(alt?.notiz || '')}</textarea>
      <label>Was soll hinein?</label><div class="pf-was">
        <label><input type="checkbox" id="pf-planer"${st.planer ? ' checked' : ' disabled'}> Planer${fabriken.length ? ` (${fabriken.map(esc).join(', ')})` : ' – leer'}</label>
        <label><input type="checkbox" id="pf-bk"${st.baukasten ? ' checked' : ' disabled'}> Reißbrett${st.baukasten ? ` (${st.baukasten.teile?.length || 0} Teile)` : ' – leer'}</label></div>
      <label>Blaupausen, die beim Laden ins Spiel geholt werden sollen <span class="muted">(${bps.length} gefunden)</span></label>
      <div style="display:flex;gap:8px;margin-bottom:6px"><input type="text" id="pf-suche" placeholder="Suchen …" style="flex:1"><label style="margin:0;display:flex;gap:6px;align-items:center;color:inherit"><input type="checkbox" id="pf-nuraktiv"> nur gerade im Spiel</label><label style="margin:0;display:flex;gap:6px;align-items:center;color:inherit"><input type="checkbox" id="pf-nurgew"> nur gewählte</label><span class="muted" id="pf-anz" style="align-self:center"></span></div>
      <div class="pf-bps" id="pf-bps"></div></div>
      <div class="pf-fuss"><button id="pf-zurueck">Zurück</button><button class="primaer" id="pf-ok">${alt ? 'Überschreiben' : 'Speichern'}</button></div></div>`;
    const key = (b) => (b.session || '') + '|' + b.name;
    const zeigen = () => {
      const q = d.querySelector('#pf-suche').value.trim().toLowerCase(), nurAktiv = d.querySelector('#pf-nuraktiv').checked, nurGew = d.querySelector('#pf-nurgew').checked;
      const l = bps.filter((b) => (!q || b.name.toLowerCase().includes(q) || (b.ordner || '').toLowerCase().includes(q)) && (!nurAktiv || b.aktiv) && (!nurGew || gew.has(key(b))));
      d.querySelector('#pf-bps').innerHTML = l.slice(0, 800).map((b) => `<label class="pf-bp"><input type="checkbox" data-key="${esc(key(b))}"${gew.has(key(b)) ? ' checked' : ''}> ${esc(b.name)}<small>${b.aktiv ? `<span class="an">im Spiel</span> · ${esc(b.session)}` : 'in der Ablage'}${b.ordner ? ' · ' + esc(b.ordner) : ''}</small></label>`).join('') || '<p class="muted">Keine Blaupausen gefunden.</p>';
      d.querySelector('#pf-anz').textContent = `${gew.size} gewählt`;
    };
    zeigen();
    d.querySelector('#pf-suche').oninput = zeigen; d.querySelector('#pf-nuraktiv').onchange = zeigen; d.querySelector('#pf-nurgew').onchange = zeigen;
    d.querySelector('#pf-bps').onchange = (e) => { const c = e.target.closest('[data-key]'); if (!c) return; if (c.checked) gew.add(c.dataset.key); else gew.delete(c.dataset.key); d.querySelector('#pf-anz').textContent = `${gew.size} gewählt`; };
    d.querySelector('#pf-zurueck').onclick = uebersicht;
    d.querySelector('#pf-ok').onclick = async () => {
      const name = d.querySelector('#pf-name').value.trim(); if (!name) { d.querySelector('#pf-name').focus(); return; }
      const standard = k.sitzungen?.[0] || '';
      const auswahl = [...gew].map((kk) => { const [session, ...n] = kk.split('|'); const nm = n.join('|'); const b = bps.find((x) => key(x) === kk) || bps.find((x) => x.name === nm); return { name: nm, session: session || b?.session || standard, ordner: b?.ordner || null }; });
      try {
        await api('/api/profile/idee', { profil: P.id, idee: alt?.id, name, notiz: d.querySelector('#pf-notiz').value, planer: d.querySelector('#pf-planer').checked ? st.planer : null, baukasten: d.querySelector('#pf-bk').checked ? st.baukasten : null, blaupausen: auswahl });
        gewaehlt = P.id; uebersicht();
      } catch (err) { alert('Speichern fehlgeschlagen: ' + err.message); }
    };
    d.querySelector('#pf-name').focus();
  };

  // Ideen laden: Vorschau → aktuellen Stand als „automatisch“-Idee sichern → Blaupausen holen → Planer/Reißbrett setzen → neu laden
  const laden = async (P, ids, modus) => {
    const voll = [];
    for (const id of ids) voll.push(await api(`/api/profile/eintrag?profil=${encodeURIComponent(P.id)}&idee=${encodeURIComponent(id)}`));
    const fab = voll.flatMap((i) => fabrikenVon(i).map((f) => ({ ...f, name: voll.length > 1 && fabrikenVon(i).length === 1 ? i.name : f.name })));
    const brett = voll.find((i) => i.baukasten);
    const bps = [...new Map(voll.flatMap((i) => i.blaupausen || []).map((b) => [b.session + '|' + b.name, b])).values()];
    d.innerHTML = `<div class="pf"><div class="pf-kopf"><h2>${voll.length > 1 ? `${voll.length} Ideen laden` : `Idee „${esc(voll[0].name)}“ laden`}</h2></div><div class="pf-inhalt">
      <p>${fab.length ? `<b>Planer:</b> ${modus === 'dazu' ? 'zu deinen Fabriken hinzufügen' : 'ersetzen'} – ${fab.map((f) => esc(f.name)).join(', ')}.` : 'Kein Planer-Stand in der Auswahl – der Planer bleibt.'}<br>
      ${brett ? `<b>Reißbrett:</b> ersetzen durch „${esc(brett.name)}“ (${brett.baukasten.teile?.length || 0} Teile)${voll.filter((i) => i.baukasten).length > 1 ? ' – es gibt nur ein Reißbrett, die übrigen Ideen bringen nur ihren Planer mit' : ''}.` : 'Kein Reißbrett in der Auswahl – das Reißbrett bleibt.'}<br>
      ${bps.length ? `<b>Blaupausen:</b> ${bps.length} ins Spiel holen – andere aktive bleiben.` : ''}</p>
      ${bps.length ? `<div class="pf-bps">${bps.map((b) => `<div class="pf-bp">${esc(b.name)}<small>${esc(b.session)}${b.ordner ? ' · ' + esc(b.ordner) : ''}</small></div>`).join('')}</div>` : ''}
      <p class="muted">Dein aktueller Stand wird vorher als Idee „Automatisch gesichert“ im aktiven Profil abgelegt (die letzten drei bleiben). Lief das Spiel schon, den Spielstand danach neu laden, damit es die Blaupausen sieht.</p></div>
      <div class="pf-fuss"><button id="pf-zurueck">Abbrechen</button><button class="primaer" id="pf-ok">Laden</button></div></div>`;
    d.querySelector('#pf-zurueck').onclick = uebersicht;
    d.querySelector('#pf-ok').onclick = async () => {
      const knopf = d.querySelector('#pf-ok'); knopf.disabled = true; knopf.textContent = 'Lädt …';
      try {
        const st = aktuellerStand();
        if (st.planer || st.baukasten) await api('/api/profile/idee', { name: `Automatisch gesichert vor „${voll.map((i) => i.name).join(', ').slice(0, 50)}“`, planer: st.planer, baukasten: st.baukasten, blaupausen: [], auto: true });
        const r = await api('/api/profile/laden', { profil: P.id, ideen: ids });
        // Planer zusammenstellen
        let planer = null;
        if (fab.length) {
          const basis = voll.find((i) => i.planer?.welt)?.planer.welt || {};
          const alt = modus === 'dazu' ? fabrikenVon(st) : [];
          const welt = { ...basis, ...(modus === 'dazu' && st.planer?.welt ? { miner: st.planer.welt.miner, takt: st.planer.welt.takt } : {}), fabriken: [...alt, ...fab], aktiv: alt.length };
          planer = { welt, plan: welt.fabriken[welt.aktiv].plan };
        }
        standSetzen({ planer, baukasten: brett?.baukasten || null }, true);
        const zeile = (e) => `<div class="pf-erg">${e.stand === 'geholt' || e.stand === 'da' ? '<span class="ok">✓</span>' : '<span class="err">✗</span>'} ${esc(e.name)} <span class="muted">– ${esc(e.text)}</span></div>`;
        d.innerHTML = `<div class="pf"><div class="pf-kopf"><h2>Geladen</h2></div><div class="pf-inhalt">
          ${r.ergebnis.length ? r.ergebnis.map(zeile).join('') : '<p class="muted">Keine Blaupausen in der Auswahl.</p>'}
          <p class="muted">${planer || brett ? 'Planer/Reißbrett sind gesetzt – die Seite lädt neu, sobald du schließt.' : ''}</p></div>
          <div class="pf-fuss"><button class="primaer" id="pf-fertig">Schließen</button></div></div>`;
        d.querySelector('#pf-fertig').onclick = () => { d.close(); if (planer || brett) location.reload(); };
      } catch (err) { alert('Laden fehlgeschlagen: ' + err.message); knopf.disabled = false; knopf.textContent = 'Laden'; }
    };
  };

  await uebersicht();
}

// ------------------------------------------------------------------ Einführung (Schritte im Dialog, wie die Einführung der Bereiche)
const PF_TOUR = [
  ['.pf-zwei > div:first-child', 'Profile', 'Ein Profil ist dein Arbeitsbereich. Alles, was du in Planer und Baukasten machst, wird laufend im aktiven Profil gespeichert – bis du ein anderes anlegst oder wechselst.'],
  ['#pf-neuprof', 'Neues Profil', 'Legt ein weiteres Profil an, wahlweise mit deinem aktuellen Stand oder leer. Der bisherige Stand bleibt im alten Profil.'],
  ['#pf-wechseln', 'Wechseln', 'Sichert den aktuellen Stand im aktiven Profil und lädt das gewählte.'],
  ['#pf-neuidee', 'Idee speichern', 'Hält den aktuellen Stand als benannte Idee fest – Planer, Reißbrett und auf Wunsch eine Auswahl Blaupausen. Im Baukasten gibt es dafür auch den Knopf „Idee speichern“.'],
  ['.pf-karte', 'Ideen', 'Jede Idee zeigt, was drinsteckt. Überschreiben, umbenennen oder löschen rechts; anhaken zum Laden. Gestrichelte Ideen hat die App vor dem Laden automatisch gesichert.'],
  ['#pf-modus', 'Laden: ersetzen oder dazu', 'Beim Laden ersetzen die Ideen deinen Planer oder kommen als eigene Fabriken dazu.'],
  ['#pf-laden', 'Laden', 'Lädt die angehakten Ideen. Ihre Blaupausen werden ins Spiel geholt; andere aktive Blaupausen bleiben.'],
];
function einfuehrung(d, sofort) {
  let gesehen = false; try { gesehen = localStorage.getItem('bs.tour.profile') === '1'; } catch { /* egal */ }
  if (!sofort && gesehen) return;
  const merken = () => { try { localStorage.setItem('bs.tour.profile', '1'); } catch { /* egal */ } };
  d.querySelector('.pf-tour')?.remove();
  const schritte = PF_TOUR.filter(([sel]) => { const el = d.querySelector(sel); return el && el.getBoundingClientRect().width > 0; });
  if (!schritte.length) return;
  const ebene = document.createElement('div'); ebene.className = 'pf-tour'; d.appendChild(ebene);
  let i = sofort ? 0 : -1;
  const ende = () => { ebene.remove(); d.querySelectorAll('.pf-hervor').forEach((e) => e.classList.remove('pf-hervor')); merken(); };
  const zeigen = () => {
    d.querySelectorAll('.pf-hervor').forEach((e) => e.classList.remove('pf-hervor'));
    if (i < 0) { const dr = d.getBoundingClientRect(); ebene.innerHTML = `<div class="pf-blase" style="left:${Math.max(12, dr.right - 360)}px;top:${dr.top + 56}px"><b>Neu hier?</b><p>Kurze Einführung zu Profilen und Ideen.</p><div class="pf-tk"><button data-t="nein">Nein, danke</button><button class="primaer" data-t="los">Einführung starten</button></div></div>`; }
    else {
      const [sel, titel, text] = schritte[i], el = d.querySelector(sel); el.classList.add('pf-hervor'); el.scrollIntoView({ block: 'nearest' });
      ebene.innerHTML = `<div class="pf-blase" style="left:0;top:0;visibility:hidden"><div class="pf-tkopf"><b>${esc(titel)}</b><span class="muted">${i + 1} / ${schritte.length}</span></div><p>${esc(text)}</p>
        <div class="pf-tk"><button data-t="zu">Beenden</button><span style="flex:1"></span>${i ? '<button data-t="zurueck">Zurück</button>' : ''}<button class="primaer" data-t="weiter">${i + 1 < schritte.length ? 'Weiter' : 'Fertig'}</button></div></div>`;
    }
    // Blase neben das Element (Fensterkoordinaten): darunter, sonst darüber, sonst rechts/links daneben
    if (i >= 0) {
      const bl = ebene.querySelector('.pf-blase'), r = d.querySelector(schritte[i][0]).getBoundingClientRect(), W = innerWidth, H = innerHeight, bw = bl.offsetWidth, bh = bl.offsetHeight;
      let x = Math.min(Math.max(12, r.left), W - bw - 12), y;
      if (r.bottom + 12 + bh < H) y = r.bottom + 12; else if (r.top - 12 - bh > 0) y = r.top - 12 - bh;
      else { y = Math.min(Math.max(12, r.top), H - bh - 12); x = r.right + 12 + bw < W ? r.right + 12 : Math.max(12, r.left - 12 - bw); }
      Object.assign(bl.style, { left: x + 'px', top: y + 'px', visibility: '' });
    }
    ebene.querySelectorAll('[data-t]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const t = b.dataset.t;
      if (t === 'nein' || t === 'zu') return ende(); if (t === 'los') i = 0; else if (t === 'zurueck') i--; else if (++i >= schritte.length) return ende(); zeigen(); }));
  };
  zeigen();
}

/** Knopf verdrahten (Haupt-App, Baukasten) und laufende Speicherung starten */
export function profilKnopf(el) { knopfEl = el; if (el) el.addEventListener('click', () => profileOeffnen()); automatik(); }
