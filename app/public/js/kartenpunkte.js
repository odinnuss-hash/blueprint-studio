// Kartenpunkte zeichnen (Welt und Karte): Rohstoff-Knoten nach Art und Reinheit, Geysire, Gasquellen, Absturzstellen,
// Power-Slugs, Somersloops, Mercer-Kugeln. Daten von /api/welt/punkte (lib/kartenpunkte.mjs), eigene Symbole (keine Spielgrafiken).
// zustand: 0 frei, 1 belegt bzw. eingesammelt, 2 geöffnet (Absturzstelle)

// Farbe und Kurzzeichen je Rohstoff
const RES = {
  Desc_OreIron_C: ['#c27a5c', 'Fe'], Desc_OreCopper_C: ['#e8833a', 'Cu'], Desc_Stone_C: ['#d8cfb4', 'Ka'], Desc_Coal_C: ['#55595f', 'Ko'],
  Desc_OreGold_C: ['#ecc94b', 'Ca'], Desc_RawQuartz_C: ['#eb93d6', 'Qz'], Desc_Sulfur_C: ['#e6e24f', 'S'], Desc_OreBauxite_C: ['#c8553d', 'Bx'],
  Desc_OreUranium_C: ['#74e05c', 'U'], Desc_SAM_C: ['#a06ae8', 'SAM'], Desc_LiquidOil_C: ['#2b2b33', 'Öl'], Desc_NitrogenGas_C: ['#a3d6ea', 'N'],
  Desc_Water_C: ['#3fa2e6', 'W'],
};
const REIN = ['unrein', 'normal', 'rein'];
// Filter-Gruppen (Schalter im Menü) → Arten
export const GRUPPEN = [
  ['knoten', 'Rohstoff-Knoten', ['knoten']], ['gas', 'Gasquellen', ['gasquelle']], ['geysir', 'Geysire', ['geysir']],
  ['absturz', 'Absturzstellen', ['absturz']], ['slugs', 'Power-Slugs', ['slug1', 'slug2', 'slug3']], ['somersloop', 'Somersloops', ['somersloop']],
  ['mercer', 'Mercer-Kugeln', ['mercer']], ['vorkommen', 'Kleine Vorkommen (Sammeln)', ['vorkommen']],
];
const STANDARD = { knoten: true, gas: true, geysir: true, absturz: true, slugs: true, somersloop: true, mercer: true, vorkommen: false, erledigt: true };
export function filterLaden() { try { return { ...STANDARD, ...JSON.parse(localStorage.getItem('bs-kartenpunkte') || '{}') }; } catch { return { ...STANDARD }; } }
export function filterSpeichern(f) { try { localStorage.setItem('bs-kartenpunkte', JSON.stringify(f)); } catch { /* egal */ } }

const name = (d, i) => d.arten[i];
/** Beschreibung eines Punkts für den Tooltip */
export function punktText(d, p, kat) {
  const art = name(d, p[0]), res = p[4] >= 0 ? d.ressourcen[p[4]] : null, rn = res ? (kat?.items?.[res]?.name || res) : '';
  const rein = p[5] >= 0 ? ` (${REIN[p[5]]})` : '';
  const z = p[6] === 1 ? (art === 'knoten' || art === 'gasquelle' || art === 'geysir' ? ' · belegt' : art === 'absturz' ? ' · abgebaut' : ' · eingesammelt') : p[6] === 2 ? ' · geöffnet' : '';
  const t = { knoten: `${rn}-Knoten${rein}`, gasquelle: `Gasquelle ${rn}${rein}`, geysir: `Geysir${rein}`, vorkommen: `Vorkommen ${rn}`, absturz: 'Absturzstelle',
    slug1: 'Power-Slug (blau)', slug2: 'Power-Slug (gelb)', slug3: 'Power-Slug (lila)', somersloop: 'Somersloop', mercer: 'Mercer-Kugel' }[art] || art;
  return t + z + ` · ${Math.round(p[1] / 100)} / ${Math.round(p[2] / 100)} m`;
}

/** Sichtbar nach Filter? */
export function sichtbar(d, p, f) {
  const art = name(d, p[0]); const g = GRUPPEN.find(([, , a]) => a.includes(art)); if (!g || !f[g[0]]) return false;
  if (p[4] >= 0 && f.aus?.includes(d.ressourcen[p[4]])) return false; // einzelne Rohstoffe ausgeblendet
  return f.erledigt || p[6] !== 1;
}

/**
 * Alle sichtbaren Punkte zeichnen. proj(x, y, z) → [sx, sy, abstand] oder null; groesse: Grundgröße in Pixel.
 * Liefert die gezeichneten Punkte [{ sx, sy, i }] für die Treffersuche (Tooltip).
 */
export function zeichnePunkte(ctx, d, proj, f, groesse = 13) {
  const gez = [];
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  // weit entfernte zuerst, nahe obenauf
  const liste = [];
  d.p.forEach((p, i) => { if (!sichtbar(d, p, f)) return; const s = proj(p[1], p[2], p[3]); if (s) liste.push([s, p, i]); });
  liste.sort((a, b) => b[0][2] - a[0][2]);
  for (const [[sx, sy, ab], p, i] of liste) {
    const art = name(d, p[0]), res = p[4] >= 0 ? d.ressourcen[p[4]] : null, [farbe, kurz] = RES[res] || ['#9aa3ad', '?'];
    const r = Math.max(4, groesse * (ab > 300000 ? 0.65 : ab > 120000 ? 0.85 : 1)) * (art === 'vorkommen' ? 0.5 : 1);
    ctx.globalAlpha = p[6] === 1 ? 0.35 : 1;
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(15,17,20,.9)';
    if (art === 'knoten' || art === 'gasquelle' || art === 'geysir') {
      const f0 = art === 'geysir' ? '#bfe6f5' : farbe;
      ctx.beginPath();
      if (art === 'gasquelle') { for (let k = 0; k < 6; k++) { const w = Math.PI / 3 * k + Math.PI / 6; ctx.lineTo(sx + r * Math.cos(w), sy + r * Math.sin(w)); } ctx.closePath(); }
      else ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = f0; ctx.fill(); ctx.stroke();
      // Reinheit als Ring: unrein gestrichelt, normal einfach, rein doppelt
      if (p[5] >= 0) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
        if (p[5] === 0) ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.arc(sx, sy, r + 3, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        if (p[5] === 2) { ctx.beginPath(); ctx.arc(sx, sy, r + 6, 0, Math.PI * 2); ctx.stroke(); }
      }
      if (r >= 8) { ctx.fillStyle = res === 'Desc_LiquidOil_C' || res === 'Desc_Coal_C' ? '#fff' : '#111'; ctx.font = `700 ${Math.round(r * (kurz.length > 2 ? 0.7 : 0.9))}px system-ui, sans-serif`; ctx.fillText(art === 'geysir' ? 'G' : kurz, sx, sy + 0.5); }
    } else if (art === 'vorkommen') {
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fillStyle = farbe; ctx.fill(); ctx.lineWidth = 1; ctx.stroke();
    } else if (art === 'absturz') {
      ctx.beginPath(); ctx.moveTo(sx, sy - r); ctx.lineTo(sx + r, sy + r * 0.8); ctx.lineTo(sx - r, sy + r * 0.8); ctx.closePath();
      ctx.fillStyle = p[6] === 2 ? 'rgba(255,140,40,.25)' : '#ff8c28'; ctx.fill(); ctx.strokeStyle = '#ff8c28'; ctx.stroke();
      if (r >= 8) { ctx.fillStyle = p[6] === 2 ? '#ff8c28' : '#111'; ctx.font = `700 ${Math.round(r * 0.9)}px system-ui, sans-serif`; ctx.fillText('!', sx, sy + r * 0.2); }
    } else if (art.startsWith('slug')) {
      const fs = { slug1: '#4fb3ff', slug2: '#ffd23f', slug3: '#c069ff' }[art];
      ctx.beginPath(); ctx.moveTo(sx, sy - r); ctx.lineTo(sx + r * 0.7, sy); ctx.lineTo(sx, sy + r); ctx.lineTo(sx - r * 0.7, sy); ctx.closePath();
      ctx.fillStyle = fs; ctx.fill(); ctx.stroke();
    } else if (art === 'somersloop' || art === 'mercer') {
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fillStyle = art === 'somersloop' ? '#e0303a' : '#7a3fd1'; ctx.fill(); ctx.stroke();
      if (r >= 8) { ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(r * 0.95)}px system-ui, sans-serif`; ctx.fillText(art === 'somersloop' ? 'S' : 'M', sx, sy + 0.5); }
    }
    gez.push({ sx, sy, i, r });
  }
  ctx.restore();
  return gez;
}

/** Filter-Menü (Schalter je Gruppe, „Erledigte zeigen“) in el aufbauen; aenderung(f) bei jeder Änderung */
export function filterMenue(el, f, aenderung, zahlen = {}, d = null, kat = null) {
  // Unterauswahl je Rohstoff (Knoten, Gasquellen, Vorkommen): Farbpunkt, Name, Anzahl Knoten
  const je = {}; if (d) for (const p of d.p) { const a = d.arten[p[0]]; if ((a === 'knoten' || a === 'gasquelle') && p[4] >= 0) { const r = d.ressourcen[p[4]]; je[r] = (je[r] || 0) + 1; } }
  const res = Object.keys(je).sort((a, b) => (kat?.items?.[a]?.name || a).localeCompare(kat?.items?.[b]?.name || b, 'de'));
  const unter = res.length ? `<div class="kp-res">${res.map((r) => `<label class="check"><input type="checkbox" data-res="${r}"${f.aus?.includes(r) ? '' : ' checked'}> <i class="kp-punkt" style="background:${(RES[r] || ['#9aa3ad'])[0]}"></i> ${kat?.items?.[r]?.name || r} <small class="muted">${je[r]}</small></label>`).join('')}</div>` : '';
  el.innerHTML = GRUPPEN.map(([k, t]) => `<label class="check"><input type="checkbox" data-k="${k}"${f[k] ? ' checked' : ''}> ${t}${zahlen[k] != null ? ` <small class="muted">${zahlen[k]}</small>` : ''}</label>${k === 'knoten' ? unter : ''}`).join('')
    + '<hr><label class="check"><input type="checkbox" data-k="erledigt"' + (f.erledigt ? ' checked' : '') + '> Belegte/eingesammelte zeigen (blass)</label>'
    + '<p class="hint">Rohstoff-Knoten: Ring gestrichelt = unrein, einfach = normal, doppelt = rein.</p>';
  el.querySelectorAll('input[data-k]').forEach((c) => c.addEventListener('change', () => { f[c.dataset.k] = c.checked; filterSpeichern(f); aenderung(f); }));
  el.querySelectorAll('input[data-res]').forEach((c) => c.addEventListener('change', () => { const r = c.dataset.res; f.aus = (f.aus || []).filter((x) => x !== r); if (!c.checked) f.aus.push(r); filterSpeichern(f); aenderung(f); }));
}

/** Zahlen je Gruppe (offen / alle) für das Menü */
export function zahlenJeGruppe(d) {
  const z = {};
  for (const [k, , arten] of GRUPPEN) {
    let alle = 0, offen = 0; for (const p of d.p) if (arten.includes(d.arten[p[0]])) { alle++; if (p[6] !== 1) offen++; }
    z[k] = d.mitSpielstand ? `${offen}/${alle}` : `${alle}`;
  }
  return z;
}
