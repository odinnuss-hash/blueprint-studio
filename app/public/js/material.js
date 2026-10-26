// Material-Check: Baukosten gegen die Vorräte eines Spielstands.
// Beim Bauen nimmt das Spiel aus dem Inventar und dem Dimensionslager – das zählt als „reicht“.
// Was nur in Kisten liegt, steht getrennt daneben (müsste man erst holen).
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const zahl = (n) => n.toLocaleString('de-DE');

/** kosten: [[item, menge], …]; titel: wofür (Blaupausen-Name); sitzung: Spielsitzung für die Vorwahl des Spielstands */
export async function materialCheck(app, kosten, titel, sitzung) {
  kosten = kosten.filter(([, n]) => n > 0);
  if (!kosten.length) { app.toast('Diese Blaupause hat keine Baukosten.'); return; }
  let staende = [];
  try { staende = (await fetch('/api/karte/liste', { cache: 'no-store' }).then((r) => r.json())).spielstaende || []; } catch { /* unten */ }
  if (!staende.length) { app.toast('Keine Spielstände gefunden.', 'err'); return; }
  staende.sort((a, b) => b.geaendert - a.geaendert);
  const vorwahl = (staende.find((s) => s.sitzung && s.sitzung === sitzung) || staende[0]).id;

  const d = $('dlg-material');
  $('mat-titel').textContent = titel || '';
  const sel = $('mat-stand');
  sel.innerHTML = staende.map((s) => `<option value="${esc(s.id)}"${s.id === vorwahl ? ' selected' : ''}>${esc(s.name)}${s.sitzung ? ` · ${esc(s.sitzung)}` : ''} · ${new Date(s.geaendert).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</option>`).join('');
  let fehlt = [];
  const laden = async () => {
    $('mat-ergebnis').textContent = 'Spielstand wird gelesen …';
    $('mat-tabelle').innerHTML = ''; $('mat-kopieren').hidden = true;
    let v;
    try {
      const r = await fetch('/api/vorraete?id=' + encodeURIComponent(sel.value), { cache: 'no-store' });
      v = await r.json();
      if (!r.ok) throw new Error(v.fehler || r.statusText);
    } catch (e) { $('mat-ergebnis').textContent = 'Fehler: ' + e.message; return; }
    const name = (i) => app.kat?.items?.[i]?.name || i;
    fehlt = [];
    let nurKisten = 0;
    const zeilen = kosten.map(([i, n]) => {
      const da = (v.inventar[i] || 0) + (v.lager[i] || 0), ki = v.kisten[i] || 0;
      const rest = n - da;
      let status;
      if (rest <= 0) status = '<span class="mat-ok">reicht</span>';
      else {
        fehlt.push([name(i), rest]);
        if (ki >= rest) { nurKisten++; status = `<span class="mat-kiste">${zahl(rest)} aus Kisten holen</span>`; }
        else status = `<span class="mat-fehlt">fehlt ${zahl(rest - ki)}</span>${ki ? ` <span class="muted">(+${zahl(ki)} in Kisten)</span>` : ''}`;
      }
      return `<tr class="${rest > 0 ? 'mat-zu-wenig' : ''}"><td>${esc(name(i))}</td><td class="mat-n">${zahl(n)}</td><td class="mat-n">${zahl(v.inventar[i] || 0)}</td><td class="mat-n">${zahl(v.lager[i] || 0)}</td><td class="mat-n">${zahl(ki)}</td><td>${status}</td></tr>`;
    });
    $('mat-tabelle').innerHTML = `<table class="rz mat-tab"><thead><tr><th>Material</th><th class="mat-n">Benötigt</th><th class="mat-n">Inventar</th><th class="mat-n">Dimensionslager</th><th class="mat-n">Kisten</th><th></th></tr></thead><tbody>${zeilen.join('')}</tbody></table>`;
    const echt = fehlt.length - nurKisten;
    // zwei Sätze in eigenen Elementen, damit die Übersetzung jeden für sich findet
    const saetze = !fehlt.length ? ['Alles da: Inventar und Dimensionslager reichen.']
      : !echt ? [`${nurKisten} von ${kosten.length} Materialien reichen erst mit dem Inhalt deiner Kisten.`]
        : [echt === 1 ? `Es fehlt 1 von ${kosten.length} Materialien.` : `Es fehlen ${echt} von ${kosten.length} Materialien.`,
          nurKisten === 1 ? '1 weiteres liegt in Kisten.' : nurKisten ? `${nurKisten} weitere liegen in Kisten.` : ''];
    $('mat-ergebnis').innerHTML = saetze.filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join(' ');
    $('mat-hinweis').textContent = `Stand: ${v.name} (${new Date(v.geaendert).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}) · ${v.kistenAnzahl} Kisten und Uploader`;
    $('mat-kopieren').hidden = !fehlt.length;
  };
  sel.onchange = laden;
  $('mat-kopieren').onclick = async () => {
    const text = fehlt.map(([n, m]) => `${n}: ${m}`).join('\n');
    try { await navigator.clipboard.writeText(text); app.toast('Einkaufszettel kopiert.', 'ok'); } catch { app.toast('Kopieren nicht möglich.', 'err'); }
  };
  d.showModal();
  await laden();
}
