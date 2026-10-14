// Gebaeude-Katalog: Filter (Kategorie, Stufe, Material, Suche), Karten, Detailansicht mit Rezepten.

import { colorFor } from './scene.js';

const CAT_ORDER = ['Produktion', 'Energie', 'Transport', 'Organisation', 'Wände', 'Spezial', 'Sonstiges'];
const ARCH_SUBS = new Set(['Fundamente', 'Umgekehrte Rampen', 'Viertelrohre', 'Rampen', 'Dächer', 'Rahmen', 'Säulen', 'Träger', 'Laufstege', 'Gehwege']);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmt = (v, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('de-DE');
export const abbr = (n) => { const p = n.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean); return (p.length > 1 ? p[0][0] + p[1][0] : n.slice(0, 2)).toUpperCase(); };
export const iconFile = (path) => (path ? path.split('/').pop() + '.png' : null);

export const ICONS = new Set();
export function tileHtml(g, cls, big) {
  const icon = g && iconFile(g.icon);
  const img = icon && ICONS.has(icon) ? `<img src="icons/${encodeURI(icon)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<span class="tile" style="background:${colorFor(g, cls)}${big ? ';width:72px;height:72px;font-size:24px' : ''}">${esc(abbr(g ? g.name : cls))}${img}</span>`;
}
export function dims(g) {
  if (!g || !g.box) return 'Länge variabel';
  const b = g.box;
  return `${fmt((b[3] - b[0]) / 100, 1)} × ${fmt((b[4] - b[1]) / 100, 1)} × ${fmt((b[5] - b[2]) / 100, 1)} m`;
}
export function powerText(g) {
  const w = g?.werte || {};
  if (w.stromVar) return `${fmt(w.stromVar[0], 0)}–${fmt(w.stromVar[1], 0)} MW`;
  if (w.strom) return `${fmt(w.strom)} MW`;
  if (w.erzeugung) return `+${fmt(w.erzeugung)} MW`;
  return '—';
}
export function extraText(g) {
  const w = g?.werte || {}, out = [];
  if (w.durchsatz) out.push(`${fmt(w.durchsatz)} Teile/min`);
  if (w.durchfluss) out.push(`${fmt(w.durchfluss)} m³/min`);
  if (w.abbau) out.push(`Abbau ${fmt(w.abbau)} /min (normal)`);
  if (w.slots) out.push(`${w.slots} Lagerplätze`);
  return out.join(' · ');
}

export class Katalog {
  constructor(app) {
    this.app = app;
    this.state = { cat: 'Produktion', tier: 9, res: '', q: '', arch: false, sel: null };
    this.el = {
      cats: document.getElementById('k-cats'), tiers: document.getElementById('k-tiers'), res: document.getElementById('k-res'),
      q: document.getElementById('k-suche'), arch: document.getElementById('k-arch'), cards: document.getElementById('k-cards'),
      title: document.getElementById('k-title'), count: document.getElementById('k-count'), detail: document.getElementById('k-detail'),
      source: document.getElementById('k-source'),
    };
    this.el.q.addEventListener('input', () => { this.state.q = this.el.q.value.trim().toLowerCase(); this.renderCards(); });
    this.el.res.addEventListener('change', () => { this.state.res = this.el.res.value; this.renderCards(); });
    this.el.arch.addEventListener('change', () => { this.state.arch = this.el.arch.checked; this.renderAll(); });
  }

  setData(k) {
    this.k = k;
    this.list = Object.entries(k.gebaeude).map(([cls, g]) => ({ cls, g }));
    const mats = new Set();
    for (const { g } of this.list) for (const [i] of g.kosten) mats.add(i);
    const opts = [...mats].map((i) => [i, k.items[i]?.name || i]).sort((a, b) => a[1].localeCompare(b[1], 'de'));
    this.el.res.innerHTML = '<option value="">beliebig</option>' + opts.map(([i, n]) => `<option value="${esc(i)}">${esc(n)}</option>`).join('');
    this.el.source.textContent = `${this.list.length} Gebäude · ${Object.keys(k.items).length} Items · ${Object.keys(k.rezepte).length} Rezepte aus den Spieldaten. Eigene Icons: per FModel nach app/public/icons exportieren.`;
    this.renderAll();
  }

  visible(e, ignoreCat) {
    const s = this.state, g = e.g;
    if (!ignoreCat && s.cat !== 'Alle' && g.kategorie !== s.cat) return false;
    if (s.cat === 'Alle' && !s.arch && (ARCH_SUBS.has(g.unterkategorie) || g.kategorie === 'Wände')) return false;
    if (g.stufe != null && g.stufe > s.tier) return false;
    if (s.res && !g.kosten.some(([i]) => i === s.res)) return false;
    if (s.q) {
      const hay = (g.name + ' ' + g.unterkategorie + ' ' + g.kosten.map(([i]) => this.k.items[i]?.name || '').join(' ')).toLowerCase();
      if (!hay.includes(s.q)) return false;
    }
    return true;
  }

  renderAll() { this.renderCats(); this.renderTiers(); this.renderCards(); }

  renderCats() {
    const counts = { Alle: 0 };
    for (const e of this.list) {
      if (!this.visible(e, true)) continue;
      counts[e.g.kategorie] = (counts[e.g.kategorie] || 0) + 1;
      if (!(ARCH_SUBS.has(e.g.unterkategorie) || e.g.kategorie === 'Wände') || this.state.arch) counts.Alle++;
    }
    this.el.cats.innerHTML = ['Alle', ...CAT_ORDER].filter((c) => c === 'Alle' || counts[c]).map((c) =>
      `<button type="button" class="cat${this.state.cat === c ? ' on' : ''}" data-cat="${esc(c)}" aria-pressed="${this.state.cat === c}"><span>${esc(c)}</span><span>${counts[c] || 0}</span></button>`).join('');
    this.el.cats.querySelectorAll('.cat').forEach((b) => b.addEventListener('click', () => { this.state.cat = b.dataset.cat; this.renderAll(); }));
  }

  renderTiers() {
    this.el.tiers.innerHTML = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) =>
      `<button type="button" class="tierbtn${t === this.state.tier ? ' on' : t < this.state.tier ? ' in' : ''}" data-t="${t}" aria-pressed="${t === this.state.tier}">${t}</button>`).join('');
    this.el.tiers.querySelectorAll('.tierbtn').forEach((b) => b.addEventListener('click', () => { this.state.tier = +b.dataset.t; this.renderAll(); }));
  }

  renderCards() {
    const items = this.list.filter((e) => this.visible(e)).sort((a, b) =>
      CAT_ORDER.indexOf(a.g.kategorie) - CAT_ORDER.indexOf(b.g.kategorie) || a.g.unterkategorie.localeCompare(b.g.unterkategorie, 'de') || a.g.prio - b.g.prio || a.g.name.localeCompare(b.g.name, 'de'));
    const s = this.state;
    this.el.title.textContent = (s.cat === 'Alle' ? 'Alle Gebäude' : s.cat) + (s.tier < 9 ? ` · bis Stufe ${s.tier}` : '') + (s.res ? ` · mit ${this.k.items[s.res]?.name || s.res}` : '');
    this.el.count.textContent = `${items.length} Treffer`;
    const inBp = this.app.classCounts();
    this.el.cards.innerHTML = items.map(({ cls, g }) => `
      <button type="button" class="card${s.sel === cls ? ' on' : ''}" data-cls="${esc(cls)}">
        <span class="top">${tileHtml(g, cls)}<span><span class="n">${esc(g.name)}</span><br><span class="u">${esc(g.kategorie)} › ${esc(g.unterkategorie)}</span></span></span>
        <span class="chips"><span class="chip tier">${g.stufe != null ? 'Stufe ' + g.stufe : 'ohne Stufe'}</span><span class="chip">${esc(dims(g))}</span>${powerText(g) !== '—' ? `<span class="chip">${esc(powerText(g))}</span>` : ''}${inBp[cls] ? `<span class="chip">${inBp[cls]}× in Blaupause</span>` : ''}</span>
      </button>`).join('') || '<div class="muted">Keine Gebäude für diese Filter.</div>';
    this.el.cards.querySelectorAll('.card').forEach((b) => b.addEventListener('click', () => { this.state.sel = b.dataset.cls; this.renderCards(); }));
    if (!s.sel || !this.k.gebaeude[s.sel]) this.state.sel = items[0]?.cls || null;
    this.renderDetail();
  }

  renderDetail() {
    const cls = this.state.sel, g = cls && this.k.gebaeude[cls];
    if (!g) { this.el.detail.innerHTML = '<div class="muted">Nichts ausgewählt.</div>'; return; }
    const k = this.k, n = (i) => esc(k.items[i]?.name || i);
    const rz = Object.entries(k.rezepte).filter(([, r]) => r.gebaeude.includes(cls)).sort((a, b) => (a[1].alternativ - b[1].alternativ) || ((a[1].stufe ?? 99) - (b[1].stufe ?? 99)) || a[1].name.localeCompare(b[1].name, 'de'));
    const inBp = this.app.classCounts()[cls] || 0;
    this.el.detail.innerHTML = `
      <div style="display:flex;gap:12px;align-items:center">${tileHtml(g, cls, true)}
        <div><div class="insp-title">${esc(g.name)}</div><div class="insp-sub">${esc(g.kategorie)} › ${esc(g.unterkategorie)}</div><div class="insp-cls">${esc(cls)}</div></div></div>
      ${g.beschreibung ? `<div class="desc">${esc(g.beschreibung)}</div>` : ''}
      <div>
        <div class="kv"><span class="k">Stufe</span><span class="v">${g.stufe ?? '—'}</span></div>
        <div class="kv"><span class="k">Freischaltung</span><span class="v">${esc(g.freischaltung || '—')}</span></div>
        <div class="kv"><span class="k">Maße (B × T × H)</span><span class="v mono">${esc(dims(g))}</span></div>
        <div class="kv"><span class="k">Strom</span><span class="v mono">${esc(powerText(g))}</span></div>
        ${extraText(g) ? `<div class="kv"><span class="k">Leistung</span><span class="v">${esc(extraText(g))}</span></div>` : ''}
      </div>
      <div><div class="label">Baukosten</div>${g.kosten.map(([i, a]) => `<div class="costrow"><span>${n(i)}</span><span>${a}</span></div>`).join('') || '<div class="muted">—</div>'}</div>
      ${rz.length ? `<div><div class="label">Rezepte (${rz.length}) · pro Minute bei 100 %</div><table class="rz"><thead><tr><th>Rezept</th><th>Zutaten</th><th>Ergebnis</th></tr></thead><tbody>
        ${rz.map(([, r]) => `<tr><td>${esc(r.name)}${r.alternativ ? '<br><span class="alt">Alternativ</span>' : ''}</td><td>${r.zutaten.map((z) => `${fmt(z.proMin)} ${n(z.item)}`).join('<br>')}</td><td>${r.produkte.map((z) => `${fmt(z.proMin)} ${n(z.item)}`).join('<br>')}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
      <div style="margin-top:auto;display:flex;flex-direction:column;gap:8px">
        <button type="button" class="btn primary" id="k-select" ${inBp ? '' : 'disabled'}>${inBp ? `In Blaupause auswählen (${inBp}×)` : 'Nicht in der geöffneten Blaupause'}</button>
      </div>`;
    const b = document.getElementById('k-select');
    if (b && inBp) b.addEventListener('click', () => this.app.selectClass(cls, true));
  }
}
