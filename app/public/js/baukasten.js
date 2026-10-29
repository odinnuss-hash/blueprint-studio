// Baukasten (Beta): Reißbrett von oben – Gebäude hineinziehen, mit Bändern/Rohren verbinden, einfärben, live mitrechnen,
// Ziel-Produkt mit To-do-Liste, Master-Class-Vorlagen als Block, als Blaupause speichern (Server: lib/baukasten.mjs).
// Koordinaten in cm wie im Spiel: +X rechts, +Y unten.
// Eingebettet als Reiter der App (index.html, iframe #baukasten-frame). Direkt geöffnet → in die App mit offenem Reiter.
const EINGEBETTET = window.top !== window;
if (!EINGEBETTET) location.replace('/#' + (new URLSearchParams(location.search).has('planer') ? 'baukasten-planer' : 'baukasten'));
import './design.js'; // gewähltes App-Design (Werkhalle, Industrial …) – gleiche Farbnamen wie hier
import { Draufsicht } from './draufsicht.js';
import { View3DGL } from './view3dgl.js';
import { buildScene } from './scene.js';
import { rechne as planRechnen, rezeptOptionen } from './planer-rechner.js';
import { rechneOptimal } from './planer-optimierer.js';
import { bildwahl } from './bildwahl.js';
import { profilKnopf, profileOeffnen } from './profile.js';
import { i18nStart, t as tr } from './i18n.js'; // tr: t ist hier meist ein Teil

const $ = (id) => document.getElementById(id);
const RASTER = 100; // 1 m
const cv = $('brett'), g = cv.getContext('2d');
// Echte Spielmodelle von oben (falls „Modelle aus dem Spiel holen“ gelaufen ist), sonst einfache Kästen
let ds = null, modelleDa = false;
try { if (View3DGL.supported()) ds = new Draufsicht(); } catch { ds = null; }
const STUFEN = [0.04, 0.08, 0.16, 0.32, 0.5]; // Bild-Auflösungen (Pixel je cm)
const stufe = (s) => STUFEN.find((x) => x >= s) || STUFEN[STUFEN.length - 1];

/** Fundament-Kachel (8 × 8 m) wie im Spiel von oben: heller Beton, dunkle Fuge, leichte Struktur */
let kachelCache = null;
function fundamentKachel() {
  if (kachelCache) return kachelCache;
  const s = 0.32, n = Math.round(800 * s), c = document.createElement('canvas'); c.width = c.height = n;
  const k = c.getContext('2d');
  k.fillStyle = '#b4c4b5'; k.fillRect(0, 0, n, n);
  const gr = k.createLinearGradient(0, 0, n, n); gr.addColorStop(0, 'rgba(255,255,255,.10)'); gr.addColorStop(1, 'rgba(0,0,0,.06)');
  k.fillStyle = gr; k.fillRect(0, 0, n, n);
  let z = 12345; const r = () => ((z = (z * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n * n / 18; i++) { const v = r(); k.fillStyle = v < 0.5 ? 'rgba(0,0,0,.035)' : 'rgba(255,255,255,.05)'; k.fillRect(r() * n, r() * n, 1 + r() * 2, 1 + r() * 2); }
  k.strokeStyle = 'rgba(60,80,65,.10)'; k.lineWidth = 1;
  for (let i = 1; i < 4; i++) { const p = Math.round(i * n / 4) + 0.5; k.beginPath(); k.moveTo(p, 0); k.lineTo(p, n); k.moveTo(0, p); k.lineTo(n, p); k.stroke(); }
  k.fillStyle = '#7f8f82'; const f = Math.max(2, Math.round(7 * s)); k.fillRect(0, 0, n, f); k.fillRect(0, 0, f, n); k.fillRect(0, n - f, n, f); k.fillRect(n - f, 0, f, n);
  k.fillStyle = 'rgba(255,255,255,.25)'; k.fillRect(f, f, n - 2 * f, 1); k.fillRect(f, f, 1, n - 2 * f);
  kachelCache = { s, muster: g.createPattern(c, 'repeat') };
  return kachelCache;
}

const SPEICHER_KEY = 'bs-baukasten';
let D = null;                      // Daten vom Server: teile, rezepte, items, gebaeude, band, rohr
const TYP = new Map();             // cls → Bauteil-Daten (Vorlagen: '#v:<id>')
const VORL = new Map();            // Vorlagen-ID → Daten vom Server (+ Szene fürs Bild)
let teile = [], verb = [], wahl = null, werkzeug = 'waehlen', neuId = 1;
let mehr = [];                     // Mehrfachauswahl (Rahmen mit Umschalt, Strg+Klick, Werkzeuge Rechteck/Stift)
let mehrV = [];                    // dazu markierte Bänder/Rohre (Rechteck/Stift)
let ziel = { item: '', menge: 10, wahl: {}, haken: {} };
let ansicht = { x: 0, y: 0, s: 0.12 }; // Bildschirm = (Welt − x) · s + Mitte
let start = null;                  // begonnene Verbindung { port }
let maus = { x: 0, y: 0, wx: 0, wy: 0 }, zug = null, verlauf = [];
let farbe = 'SwatchDesc_Slot1';    // aktuelles Farbmuster für das Werkzeug „Einfärben“
let reiter = 'gebaeude';
const bilder = new Map();

// Farbmuster: Plätze aus dem Spielstand (Primär/Sekundär), dazu die festen Materialien des Spiels
let SLOTS = ['#fa9549/#5f668c', '#006aa7/#f4b422', '#222325/#bb0000', '#979693/#555c4b', '#2db3cc/#ca39d7', '#4d5333/#69625f', '#fbf6e3/#fa9549', '#8566b4/#67a64d', '#f9df00/#33ab9c',
  '#781414/#f4b422', '#ffb5d8/#f63ba4', '#e8b140/#44585a', '#deb072/#815f3c', '#7b4b21/#c48d41', '#e1fe80/#a26541', '#5f668c/#fa9549', '#5c5c5c/#5c5c5c', '#fa9549/#fa9549'].map((x) => { const [p, s] = x.split('/'); return { prim: p, sek: s }; });
const MATERIAL = [['SwatchDesc_Concrete', 'Beton', '#a7a49b', '#8b887f'], ['SwatchDesc_Carbon', 'Carbon', '#2b2d30', '#1d1e20'], ['SwatchDesc_Caterium', 'Caterium', '#d7a940', '#9b7322'],
  ['SwatchDesc_Chrome', 'Chrom', '#d8dde2', '#9fa6ad'], ['SwatchDesc_Copper', 'Kupfer', '#c26b3a', '#8a4524'], ['SwatchDesc_Unpainted', 'Unlackiert', '#8a8f94', '#6a6f74']];
function farbInfo(sw) {
  if (!sw) return null;
  const m = /^SwatchDesc_Slot(\d+)$/.exec(sw);
  if (m) { const s = SLOTS[+m[1]]; return s ? { name: `Slot ${+m[1] + 1}`, prim: s.prim, sek: s.sek } : null; }
  const x = MATERIAL.find((q) => q[0] === sw); return x ? { name: x[1], prim: x[2], sek: x[3] } : null;
}

// ------------------------------------------------------------------ Hilfen
const drehe = (x, y, rot) => { const a = (rot * Math.PI) / 180, c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a)); return [x * c - y * s, x * s + y * c]; };
const bild = (f) => { if (!f) return null; if (!bilder.has(f)) { const i = new Image(); i.src = 'icons/' + encodeURIComponent(f); i.onload = () => zeichne(); bilder.set(f, i); } return bilder.get(f); };
const zahl = (v, n = 1) => (Math.round(v * 10 ** n) / 10 ** n).toLocaleString('de-DE');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toast = (t, err) => { const e = $('toast'); e.textContent = t; e.className = 'toast' + (err ? ' err' : ''); e.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => { e.style.display = 'none'; }, err ? 7000 : 4000); };
const zuWelt = (px, py) => [(px - cv.clientWidth / 2) / ansicht.s + ansicht.x, (py - cv.clientHeight / 2) / ansicht.s + ansicht.y];
const zuBild = (wx, wy) => [(wx - ansicht.x) * ansicht.s + cv.clientWidth / 2, (wy - ansicht.y) * ansicht.s + cv.clientHeight / 2];
const merke = () => { verlauf.push(JSON.stringify({ teile, verb })); if (verlauf.length > 80) verlauf.shift(); };
const sichern = () => { try { localStorage.setItem(SPEICHER_KEY, JSON.stringify({ teile, verb, ansicht, ziel, farbe, bandMax: +$('s-bandmax').value })); } catch { /* egal */ } };
const istTeil = (x) => x && teile.includes(x);
const istVorlage = (t) => t && String(t.cls).startsWith('#v:');
const takt = (t) => Math.max(1, Math.min(250, +t.takt || 100)) / 100;

/** Gehäuse eines Teils in Weltkoordinaten [x0, x1, y0, y1] */
function gehaeuse(t) {
  const b = TYP.get(t.cls).box, e = [[b[0], b[2]], [b[1], b[2]], [b[0], b[3]], [b[1], b[3]]].map(([x, y]) => drehe(x, y, t.rot));
  return [t.x + Math.min(...e.map((p) => p[0])), t.x + Math.max(...e.map((p) => p[0])), t.y + Math.min(...e.map((p) => p[1])), t.y + Math.max(...e.map((p) => p[1]))];
}
/** Alle Anschlüsse eines Teils (Welt), mit Richtung nach außen. Der Weg beginnt 1 m vor der Gehäusekante. */
function anschluesse(t) {
  const T = TYP.get(t.cls), b = T.box, out = [];
  for (const [liste, ein] of [[T.ein, true], [T.aus, false]]) for (const p of liste) {
    let nx = 0, ny = 0;
    if (T.anbau || Math.abs(p.y) < 1) { nx = Math.sign(p.x); ny = Math.sign(p.y); } else ny = Math.sign(p.y);
    const bisKante = ny < 0 ? p.y - b[2] : ny > 0 ? b[3] - p.y : nx < 0 ? p.x - b[0] : b[1] - p.x;
    const [dx, dy] = drehe(p.x, p.y, t.rot), [rx, ry] = drehe(nx, ny, t.rot), weg = Math.max(0, bisKante) + RASTER;
    out.push({ teil: t, name: p.name, art: p.art, ein, x: t.x + dx, y: t.y + dy, nx: rx, ny: ry, sx: t.x + dx + rx * weg, sy: t.y + dy + ry * weg });
  }
  return out;
}
const portVon = (ref) => { const t = teile.find((x) => x.id === ref.id); return t && anschluesse(t).find((p) => p.name === ref.port); };
const belegt = (t, name) => verb.some((v) => (v.von.id === t.id && v.von.port === name) || (v.nach.id === t.id && v.nach.port === name));

// ------------------------------------------------------------------ Verlegen (A* im 1-m-Raster, Ecken teuer, Gehäuse tabu)
// Das Raster beginnt am Startpunkt: liegen zwei Anschlüsse genau in einer Linie (auch auf halben Metern), wird der Weg gerade.
let kistenCache = null; // beim Verlegen vieler Wege: Gehäuse einmal berechnen
function verlege(a, b, ohne = null, rand = 30) {
  const ox = ((a.sx % RASTER) + RASTER) % RASTER, oy = ((a.sy % RASTER) + RASTER) % RASTER;
  const gx = (x) => Math.round((x - ox) / RASTER), gy = (y) => Math.round((y - oy) / RASTER);
  const sa0 = [gx(a.sx), gy(a.sy)], sb0 = [gx(b.sx), gy(b.sy)];
  // 1 m Vorlauf geradeaus vor jedem Anschluss (sonst knickt das Band direkt am Gebäude), außer die Enden liegen schon nah beieinander
  const nah = Math.abs(sa0[0] - sb0[0]) + Math.abs(sa0[1] - sb0[1]) <= 2;
  const sa = nah ? sa0 : [sa0[0] + Math.round(a.nx), sa0[1] + Math.round(a.ny)], sb = nah ? sb0 : [sb0[0] + Math.round(b.nx), sb0[1] + Math.round(b.ny)];
  // Suchfenster: Rechteck um Start und Ziel plus Rand (nicht die ganze Fabrik – bei großen Fabriken sonst Sekunden je Band)
  const gx0 = Math.min(sa[0], sb[0]) - rand, gx1 = Math.max(sa[0], sb[0]) + rand, gy0 = Math.min(sa[1], sb[1]) - rand, gy1 = Math.max(sa[1], sb[1]) + rand;
  const kisten = (kistenCache || teile.map(gehaeuse)).map((k) => [(k[0] - ox) / RASTER, (k[1] - ox) / RASTER, (k[2] - oy) / RASTER, (k[3] - oy) / RASTER]).filter((k) => k[1] >= gx0 && k[0] <= gx1 && k[3] >= gy0 && k[2] <= gy1);
  const W = gx1 - gx0 + 1, H = gy1 - gy0 + 1, idx = (x, y) => (y - gy0) * W + (x - gx0);
  // gesperrte Zellen (Gehäuse samt Rand) und belegte Zellen (andere Leitungen: kreuzen möglich, aber teuer)
  const tabu = new Uint8Array(W * H);
  for (const k of kisten) for (let y = Math.max(gy0, Math.ceil(k[2] - 0.01)); y <= Math.min(gy1, Math.floor(k[3] + 0.01)); y++) for (let x = Math.max(gx0, Math.ceil(k[0] - 0.01)); x <= Math.min(gx1, Math.floor(k[1] + 0.01)); x++) tabu[idx(x, y)] = 1;
  const frei = (c) => { if (c[0] >= gx0 && c[0] <= gx1 && c[1] >= gy0 && c[1] <= gy1) tabu[idx(c[0], c[1])] = 0; };
  frei(sa0); frei(sb0); frei(sa); frei(sb);
  const wx0 = gx0 * RASTER + ox - RASTER, wx1 = gx1 * RASTER + ox + RASTER, wy0 = gy0 * RASTER + oy - RASTER, wy1 = gy1 * RASTER + oy + RASTER;
  for (const v of verb) if (v !== ohne && v.punkte) for (let i = 1; i < v.punkte.length; i++) {
    const [x0, y0] = v.punkte[i - 1], [x1, y1] = v.punkte[i];
    if (Math.max(x0, x1) < wx0 || Math.min(x0, x1) > wx1 || Math.max(y0, y1) < wy0 || Math.min(y0, y1) > wy1) continue;
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / RASTER));
    for (let k = 0; k <= n; k++) { const cx = gx(x0 + (x1 - x0) * k / n), cy = gy(y0 + (y1 - y0) * k / n); if (cx >= gx0 && cx <= gx1 && cy >= gy0 && cy <= gy1 && tabu[idx(cx, cy)] !== 1) tabu[idx(cx, cy)] = 2; }
  }
  // direkt neben einem anderen Band: teuer (Bänder sind breiter als 1 m – parallel mit Abstand verlegen)
  for (let i = 0; i < tabu.length; i++) if (tabu[i] === 2) { const x = (i % W) + gx0, y = Math.floor(i / W) + gy0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx >= gx0 && nx <= gx1 && ny >= gy0 && ny <= gy1 && tabu[idx(nx, ny)] === 0) tabu[idx(nx, ny)] = 3; } }
  for (const c of [sa0, sb0, sa, sb]) if (c[0] >= gx0 && c[0] <= gx1 && c[1] >= gy0 && c[1] <= gy1 && tabu[idx(c[0], c[1])] === 3) tabu[idx(c[0], c[1])] = 0;
  // A* mit Binär-Heap; Zustand = Zelle × Richtung
  const R = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const kosten = new Float64Array(W * H * 5).fill(Infinity), vor = new Int32Array(W * H * 5).fill(-1);
  const zst = (x, y, r) => idx(x, y) * 5 + (r + 1);
  const heap = [];
  const rein = (f, s) => { heap.push([f, s]); let i = heap.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
  const raus = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
  const h = (x, y) => Math.abs(x - sb[0]) + Math.abs(y - sb[1]);
  const s0 = zst(sa[0], sa[1], -1); kosten[s0] = 0; rein(h(sa[0], sa[1]), s0);
  let zielZ = -1, schritte = 0;
  while (heap.length && schritte++ < 120000) {
    const [f, s] = raus(), k0 = kosten[s];
    const r = (s % 5) - 1, c = (s - (r + 1)) / 5, x = (c % W) + gx0, y = Math.floor(c / W) + gy0;
    if (f > k0 + h(x, y) + 1e-9) continue;
    if (x === sb[0] && y === sb[1]) { zielZ = s; break; }
    for (let nr = 0; nr < 4; nr++) {
      const nx = x + R[nr][0], ny = y + R[nr][1];
      if (nx < gx0 || nx > gx1 || ny < gy0 || ny > gy1) continue;
      const z = tabu[idx(nx, ny)]; if (z === 1) continue;
      const kk = k0 + 1 + (r >= 0 && r !== nr ? 8 : 0) + (z === 2 ? 25 : z === 3 ? 10 : 0), ns = zst(nx, ny, nr);
      if (kk < kosten[ns]) { kosten[ns] = kk; vor[ns] = s; rein(kk + h(nx, ny), ns); }
    }
  }
  // nichts gefunden: einmal mit größerem Fenster versuchen (Umweg um große Gebäudeblöcke)
  if (zielZ < 0 && rand < 60) return verlege(a, b, ohne, rand * 3);
  let pts;
  if (zielZ >= 0) { pts = []; for (let s = zielZ; s >= 0; s = vor[s]) { const c = (s - ((s % 5))) / 5; pts.unshift([((c % W) + gx0) * RASTER + ox, (Math.floor(c / W) + gy0) * RASTER + oy]); } }
  else pts = [[sa[0] * RASTER + ox, sa[1] * RASTER + oy], [sb[0] * RASTER + ox, sb[1] * RASTER + oy]];
  pts.unshift([a.x, a.y], [a.sx, a.sy]); pts.push([b.sx, b.sy], [b.x, b.y]);
  for (let i = 1; i < pts.length;) { if (Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) < 1) pts.splice(i, 1); else i++; }
  for (let i = 1; i + 1 < pts.length;) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], [x2, y2] = pts[i + 1]; if ((Math.abs(x1 - x0) < 1e-6 && Math.abs(y1 - y0) < 1e-6) || Math.abs((x1 - x0) * (y2 - y1) - (y1 - y0) * (x2 - x1)) < 1e-6) pts.splice(i, 1); else i++; }
  return { punkte: pts, ok: zielZ >= 0 };
}
/** Weg durch eigene Wegpunkte (rechtwinklig): Anschluss → Wegpunkte → Anschluss; die Enden passen sich beim Verschieben an */
function wegManuell(a, b, wege) {
  const pts = [[a.x, a.y], [a.sx, a.sy]];
  let [px, py] = [a.sx, a.sy];
  for (const [wx, wy] of wege) { if (Math.abs(wx - px) > 1 && Math.abs(wy - py) > 1) pts.push(Math.abs(a.ny) > 0 && pts.length === 2 ? [px, wy] : [wx, py]); pts.push([wx, wy]); [px, py] = [wx, wy]; }
  if (Math.abs(b.sx - px) > 1 && Math.abs(b.sy - py) > 1) pts.push(Math.abs(b.ny) > 0 ? [b.sx, py] : [px, b.sy]);
  pts.push([b.sx, b.sy], [b.x, b.y]);
  for (let i = 1; i < pts.length;) { if (Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) < 1) pts.splice(i, 1); else i++; }
  for (let i = 1; i + 1 < pts.length;) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], [x2, y2] = pts[i + 1]; if (Math.abs((x1 - x0) * (y2 - y1) - (y1 - y0) * (x2 - x1)) < 1e-6 && (x1 - x0) * (x2 - x1) + (y1 - y0) * (y2 - y1) >= 0) pts.splice(i, 1); else i++; }
  return { punkte: pts, ok: true };
}
/** nächster Wegpunkt beim Zeichnen: rechtwinklig zum vorigen, auf ganze Meter ab dem Startpunkt */
function wegpunkt(wx, wy) {
  const p = start.port, w = start.wege, [qx, qy] = w.length ? w[w.length - 1] : [p.sx, p.sy];
  const ox = ((p.sx % RASTER) + RASTER) % RASTER, oy = ((p.sy % RASTER) + RASTER) % RASTER;
  const rx = Math.round((wx - ox) / RASTER) * RASTER + ox, ry = Math.round((wy - oy) / RASTER) * RASTER + oy;
  return Math.abs(wx - qx) >= Math.abs(wy - qy) ? [rx, qy] : [qx, ry];
}
const wegPasst = (v, a, b) => { const p = v.punkte; if (!p?.length || p.length < 2) return false; const d = (q, x, y) => Math.abs(q[0] - x) < 1 && Math.abs(q[1] - y) < 1; return d(p[0], a.x, a.y) && d(p[p.length - 1], b.x, b.y); };
/** Wege neu legen. nurNoetige: Wege behalten, deren Enden noch an den Anschlüssen liegen (beim Öffnen – sonst dauert es bei großen Fabriken ewig) */
function neuVerlegen(nurTeil = null, nurNoetige = false) {
  kistenCache = teile.map(gehaeuse);
  try { neuVerlegenInnen(nurTeil, nurNoetige); } finally { kistenCache = null; }
}
function neuVerlegenInnen(nurTeil, nurNoetige) {
  const byId = new Map(teile.map((t) => [t.id, t])), pv = (r) => { const t = byId.get(r.id); return t && anschluesse(t).find((p) => p.name === r.port); };
  for (const v of verb) {
    if (nurTeil && v.von.id !== nurTeil.id && v.nach.id !== nurTeil.id) continue;
    const a = pv(v.von), b = pv(v.nach); if (!a || !b) continue;
    if (nurNoetige && wegPasst(v, a, b) && !v.wege?.length) continue;
    const r = v.wege?.length ? wegManuell(a, b, v.wege) : verlege(a, b, v); v.punkte = r.punkte; v.ok = r.ok;
  }
}

// ------------------------------------------------------------------ Mitrechnen
function rechne() {
  const fl = (it) => D.items[it]?.fluessig;
  const byId = new Map(teile.map((t) => [t.id, t])), vonT = new Map(), nachT = new Map();
  for (const v of verb) { (vonT.get(v.von.id) || vonT.set(v.von.id, []).get(v.von.id)).push(v); (nachT.get(v.nach.id) || nachT.set(v.nach.id, []).get(v.nach.id)).push(v); }
  const von = (id) => vonT.get(id) || [], nach = (id) => nachT.get(id) || [];
  const zuteilung = new Map(); // `${id}:${port}` → { item, menge, ein }
  for (const t of teile) {
    const T = TYP.get(t.cls);
    if (T.fest) { const p = T.aus[0]; if (p) zuteilung.set(`${t.id}:${p.name}`, { item: T.fest.item, menge: T.fest.menge * takt(t), ein: false }); continue; }
    const r = t.rezept && D.rezepte[t.rezept]; if (!r) continue;
    const f = takt(t);
    const verteile = (liste, ports, ein) => { const frei = { b: ports.filter((p) => p.art === 'b'), r: ports.filter((p) => p.art === 'r') }; for (const z of liste) { const p = frei[fl(z.item) ? 'r' : 'b'].shift(); if (p) zuteilung.set(`${t.id}:${p.name}`, { item: z.item, menge: z.proMin * f, ein }); } };
    verteile(r.zutaten, T.ein, true); verteile(r.produkte, T.aus, false);
  }
  const teilt = (t) => /Splitter|Junction/.test(t.cls);
  // Bedarf hinter einer Leitung: Maschineneingang = Rezeptmenge, Splitter/Merger = Summe dahinter, sonst (Lager, Schredder,
  // offenes Ende) unbegrenzt. Ein Splitter verteilt wie im Spiel: volle Ausgänge stauen, der Rest geht an die anderen.
  const bedarfMemo = new Map();
  const bedarf = (v, tiefe = 0) => {
    if (bedarfMemo.has(v)) return bedarfMemo.get(v);
    const zt = byId.get(v.nach.id); if (!zt || tiefe > 12) return Infinity;
    let erg;
    if (!TYP.get(zt.cls).anbau) { const z = zuteilung.get(`${zt.id}:${v.nach.port}`); erg = z && z.ein ? z.menge : Infinity; }
    else { const raus = von(zt.id); erg = !raus.length ? 0 : raus.reduce((q, w) => q + bedarf(w, tiefe + 1), 0); }
    if (tiefe === 0 || Number.isFinite(erg)) bedarfMemo.set(v, erg);
    return erg;
  };
  const aufteilen = (summe, alle, t = null, item = null) => {
    // Sortierregeln (intelligenter/programmierbarer Splitter): „keine“ bekommt nichts, Item-Regeln nur ihr Item,
    // „Überlauf“ nur den Rest, den die anderen Ausgänge nicht abnehmen
    const regel = (w) => (t?.regeln ? t.regeln[w.von.port] || (w.von.port === 'Output1' ? ['any'] : ['none']) : ['any']);
    const darf = (w) => regel(w).some((r) => r === 'any' || r === 'rest' || r === item || (item === '(gemischt)' && r !== 'none' && r !== 'overflow'));
    const ueber = alle.filter((w) => !darf(w) && regel(w).includes('overflow'));
    const ausgaenge = alle.filter(darf);
    const anteil = new Map(); let rest = summe, offen = [...ausgaenge];
    for (let k = 0; k < 8 && offen.length && rest > 1e-9; k++) {
      const je = rest / offen.length, satt = offen.filter((w) => bedarf(w) - (anteil.get(w) || 0) <= je + 1e-9);
      if (!satt.length) { for (const w of offen) anteil.set(w, (anteil.get(w) || 0) + je); rest = 0; break; }
      for (const w of satt) { const m = bedarf(w) - (anteil.get(w) || 0); anteil.set(w, (anteil.get(w) || 0) + m); rest -= m; }
      offen = offen.filter((w) => !satt.includes(w));
    }
    if (!ausgaenge.length) rest = summe;
    if (rest > 1e-9 && ueber.length) for (const w of ueber) anteil.set(w, rest / ueber.length);
    return anteil;
  };
  for (const v of verb) v.fluss = null;
  for (let runde = 0; runde < 30; runde++) {
    let geaendert = false;
    for (const v of verb) {
      const t = byId.get(v.von.id); if (!t) continue;
      const T = TYP.get(t.cls); let f = null;
      if (!T.anbau) { const z = zuteilung.get(`${t.id}:${v.von.port}`); if (z && !z.ein) f = { item: z.item, menge: z.menge }; }
      else {
        const rein = nach(t.id).filter((w) => w.fluss && !w.fluss.extern);
        if (rein.length) {
          const summe = rein.reduce((s, w) => s + w.fluss.menge, 0), items = [...new Set(rein.map((w) => w.fluss.item))];
          const raus = von(t.id);
          f = { item: items.length === 1 ? items[0] : '(gemischt)', menge: teilt(t) ? (aufteilen(summe, raus, t, items.length === 1 ? items[0] : '(gemischt)').get(v) || 0) : summe };
        }
      }
      const alt = JSON.stringify(v.fluss); v.fluss = f; if (JSON.stringify(f) !== alt) geaendert = true;
    }
    if (!geaendert) break;
  }
  // Rückwärts: Leitungen ohne Fluss zu einem Maschineneingang bekommen den Bedarf (Zulieferung von außen über einen offenen
  // Splitter-/Merger-Eingang) – so laufen auch dort Items, und nichts gilt als Problem.
  for (let runde = 0; runde < 30; runde++) {
    let geaendert = false;
    for (const v of verb) {
      if (v.fluss && !v.fluss.extern) continue;
      const zt = byId.get(v.nach.id); if (!zt) continue;
      let f = null;
      if (!TYP.get(zt.cls).anbau) { const z = zuteilung.get(`${zt.id}:${v.nach.port}`); if (z && z.ein) f = { item: z.item, menge: z.menge, extern: true }; }
      else {
        const raus = von(zt.id).filter((w) => w.fluss?.extern), rein = nach(zt.id).filter((w) => w !== v);
        if (raus.length && !rein.some((w) => w.fluss && !w.fluss.extern)) {
          const items = [...new Set(raus.map((w) => w.fluss.item))];
          f = { item: items.length === 1 ? items[0] : '(gemischt)', menge: raus.reduce((q, w) => q + w.fluss.menge, 0) / (rein.length + 1), extern: true };
        }
      }
      if (f && JSON.stringify(f) !== JSON.stringify(v.fluss)) { v.fluss = f; geaendert = true; }
    }
    if (!geaendert) break;
  }
  const extern = {};
  for (const t of teile) {
    if (!TYP.get(t.cls).anbau) continue;
    const raus = von(t.id).filter((w) => w.fluss?.extern); if (!raus.length) continue;
    const rein = nach(t.id).reduce((q, w) => q + (w.fluss?.menge || 0), 0);
    const ges = raus.reduce((q, x) => q + x.fluss.menge, 0);
    for (const w of raus) { const m = w.fluss.menge * Math.max(0, 1 - rein / ges); if (m > 1e-6) extern[w.fluss.item] = (extern[w.fluss.item] || 0) + m; }
  }
  const bandMax = +$('s-bandmax').value;
  for (const v of verb) {
    const m = v.fluss?.menge || 0;
    if (v.art === 'r') { v.mk = m > D.rohr[1] + 1e-6 ? 2 : 1; v.zuviel = m > D.rohr[2] + 1e-6; }
    else { let mk = D.band.findIndex((c, k) => k > 0 && c >= m - 1e-6); if (mk < 0) mk = 6; v.zuviel = mk > bandMax || m > D.band[6] + 1e-6; v.mk = Math.min(mk, bandMax); }
    // von Hand gewählte Stufe (Feld am Band): gilt statt der Automatik, rot wenn sie für die Menge nicht reicht
    v.mkAuto = v.mk;
    if (v.mkWahl) { v.mk = v.art === 'r' ? Math.min(2, v.mkWahl) : Math.min(6, v.mkWahl); v.zuviel = m > (v.art === 'r' ? D.rohr : D.band)[v.mk] + 1e-6; }
  }
  const stand = new Map();
  for (const [k, z] of zuteilung) {
    if (!z.ein) continue;
    const [id, port] = k.split(':'), v = nach(id).find((w) => w.nach.port === port);
    const da = v?.fluss; let st = 'frei';
    if (v) st = !da ? 'leer' : da.item !== z.item ? 'falsch' : da.extern ? 'extern' : da.menge + 1e-6 >= z.menge ? 'ok' : 'knapp';
    stand.set(k, { ...z, da, st });
  }
  return { zuteilung, stand, extern };
}

// ------------------------------------------------------------------ Bilder: Gebäude, Vorlagen, eingefärbt
const getoent = new Map();
function toenen(sp, sw) {
  const f = farbInfo(sw); if (!f || !sp) return sp;
  const k = sp; let m = getoent.get(k); if (!m) { m = new Map(); getoent.set(k, m); }
  if (m.has(sw)) return m.get(sw);
  const c = document.createElement('canvas'); c.width = sp.bild.width; c.height = sp.bild.height;
  const x = c.getContext('2d'); x.drawImage(sp.bild, 0, 0);
  x.globalCompositeOperation = 'color'; x.fillStyle = f.prim; x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-in'; x.drawImage(sp.bild, 0, 0);
  const erg = { ...sp, bild: c }; m.set(sw, erg); return erg;
}
const FUND_RX = /Foundation|Ramp|QuarterPipe|Build_Walkway|Build_Catwalk/;
function vorlagenBild(t, st) {
  const v = VORL.get(t.cls.slice(3)); if (!v?.szene || !ds) return null;
  const [ux, uy] = v.ursprung, b = v.box;
  const dim = Math.max(b[1] - b[0], b[3] - b[2]) + 400, s = Math.min(st, 2000 / dim);
  const S = STUFEN.filter((x) => x <= s).pop() || 2000 / dim;
  const zs = v.szene.objs.map((o) => [o.zMin, o.zMax]).flat().filter(Number.isFinite);
  const bereich = { x0: ux + b[0] - 200, x1: ux + b[1] + 200, y0: uy + b[2] - 200, y1: uy + b[3] + 200, z0: Math.min(...zs) - 10, z1: Math.max(...zs) + 10 };
  const sp = ds.bildSzene(v.id, v.szene, bereich, S); if (!sp) return null;
  return { ...sp, ox: (ux - bereich.x0) * S, oy: (uy - bereich.y0) * S };
}
async function vorlageLaden(id) {
  const v = VORL.get(id); if (!v || v.szene || v.laedt) return;
  v.laedt = true;
  try {
    const bp = await (await fetch('/api/masterclass/vorschau?id=' + encodeURIComponent(id))).json();
    bp.objekte = bp.objekte.filter((e) => { const c = bp.klassen[e.c]; return !(FUND_RX.test(c) && e.p[2] <= v.boden + 20) && !/PowerLine|Wire/.test(c); });
    v.szene = buildScene(bp, null);
  } catch (e) { console.warn('Vorlage', id, e); }
  v.laedt = false; zeichne();
}

// ------------------------------------------------------------------ Zeichnen
let rechnung = { zuteilung: new Map(), stand: new Map(), extern: {} }, belegtSet = new Set();
function zeichne(nurBild = false) {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  if (!D) return;
  if (!nurBild) { rechnung = rechne(); belegtSet = new Set(verb.flatMap((v) => [v.von.id + ':' + v.von.port, v.nach.id + ':' + v.nach.port])); }
  const st = stufe(ansicht.s * dpr), modell = modelleDa && ds;
  // Untergrund
  const [wx0, wy0] = zuWelt(0, 0), [wx1, wy1] = zuWelt(w, h);
  const kachel = modell ? fundamentKachel() : null;
  if (kachel) { const k = ansicht.s / kachel.s, [ox, oy] = zuBild(0, 0); kachel.muster.setTransform(new DOMMatrix([k, 0, 0, k, ox, oy])); g.fillStyle = kachel.muster; g.fillRect(0, 0, w, h); }
  const raster = kachel ? [[100, 'rgba(40,60,45,.09)']] : [[100, getComputedStyle(document.documentElement).getPropertyValue('--raster')], [800, getComputedStyle(document.documentElement).getPropertyValue('--raster8')]];
  for (const [schritt, f] of raster) {
    if (schritt * ansicht.s < 6) continue;
    g.strokeStyle = f; g.lineWidth = 1; g.beginPath();
    for (let x = Math.floor(wx0 / schritt) * schritt; x <= wx1; x += schritt) { const [px] = zuBild(x, 0); g.moveTo(Math.round(px) + 0.5, 0); g.lineTo(Math.round(px) + 0.5, h); }
    for (let y = Math.floor(wy0 / schritt) * schritt; y <= wy1; y += schritt) { const [, py] = zuBild(0, y); g.moveTo(0, Math.round(py) + 0.5); g.lineTo(w, Math.round(py) + 0.5); }
    g.stroke();
  }
  // Vorlagen (Blöcke) zuunterst
  // nur zeichnen, was im Bild liegt (große Fabriken)
  const rnd = 600, imBild = (x0, x1, y0, y1) => x1 >= wx0 - rnd && x0 <= wx1 + rnd && y1 >= wy0 - rnd && y0 <= wy1 + rnd;
  const tImBild = (t) => { const k = gehaeuse(t); return imBild(k[0], k[1], k[2], k[3]); };
  for (const t of teile) if (istVorlage(t) && tImBild(t)) zeichneTeil(t, st, modell);
  // Verbindungen
  const jetzt = performance.now() / 1000;
  for (const v of verb) {
    if (!v.punkte?.length) continue;
    { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const [x, y] of v.punkte) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } if (!imBild(x0, x1, y0, y1)) continue; }
    const pts = v.punkte.map(([x, y]) => zuBild(x, y)), rohr = v.art === 'r', breite = Math.max(3, (rohr ? 75 : 120) * ansicht.s);
    const fehler = v.zuviel || v.ok === false, fi = farbInfo(v.farbe);
    // Bögen wie in der Blaupause (lib/baukasten.mjs pfad): Band 3 m, Rohr 1,3 m Radius, an Anschluss-Strecken fast ganz
    g.lineJoin = 'round'; g.lineCap = 'butt'; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i + 1 < pts.length; i++) {
      const lIn = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]), lOut = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      g.arcTo(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], Math.max(0, Math.min((rohr ? 130 : 300) * ansicht.s, (i === 1 ? 0.9 : 0.45) * lIn, (i + 2 === pts.length ? 0.9 : 0.45) * lOut)));
    }
    g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    if (v === wahl || mehrV.includes(v)) { g.strokeStyle = '#f59a23'; g.lineWidth = breite + 6; g.stroke(); }
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = breite + 3; g.stroke();
    if (rohr) {
      g.strokeStyle = fehler ? '#b9483f' : fi ? fi.prim : '#3d8f86'; g.lineWidth = breite; g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = Math.max(1, breite * 0.22); g.stroke();
    } else {
      g.strokeStyle = fehler ? '#a5443c' : fi ? fi.prim : '#55595f'; g.lineWidth = breite; g.stroke();
      g.strokeStyle = fehler ? '#4a1d1a' : '#24272b'; g.lineWidth = breite * 0.66; g.stroke();
    }
    if (v.fluss && v.fluss.menge > 0 && $('c-fluss').checked) {
      const kap = rohr ? D.rohr[v.mk] : D.band[v.mk] || D.band[6];
      const abst = Math.max(120, Math.min(800, 120 * kap / v.fluss.menge)) * ansicht.s, tempo = 180 * ansicht.s;
      const it = D.items[v.fluss.item], im = !rohr && breite > 18 && it?.icon ? bild(it.icon) : null;
      const gr = Math.min(im ? 30 : 16, rohr ? breite * 0.35 : Math.max(2, breite * (im ? 0.62 : 0.34)));
      g.fillStyle = rohr ? 'rgba(220,255,250,.75)' : '#e9edf2';
      let rest = (jetzt * tempo) % abst;
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i], l = Math.hypot(bx - ax, by - ay);
        for (let d = rest; d < l; d += abst) {
          const x = ax + (bx - ax) * d / l, y = ay + (by - ay) * d / l;
          if (im?.complete && im.naturalWidth) g.drawImage(im, x - gr / 2, y - gr / 2, gr, gr);
          else if (rohr) { g.beginPath(); g.arc(x, y, gr / 2, 0, Math.PI * 2); g.fill(); }
          else g.fillRect(x - gr / 2, y - gr / 2, gr, gr);
        }
        rest = ((rest - l) % abst + abst) % abst;
      }
    }
    let bi = 1, bl = 0; for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (l > bl) { bl = l; bi = i; } }
    if (bl > 60 && v.fluss && (ansicht.s > 0.18 || v === wahl)) {
      const mx = (pts[bi][0] + pts[bi - 1][0]) / 2, my = (pts[bi][1] + pts[bi - 1][1]) / 2, it = D.items[v.fluss.item];
      const text = `${zahl(v.fluss.menge)}/min · ${tr(rohr ? 'Rohr' : 'Band')} Mk.${v.mk}`;
      g.font = '600 11px system-ui'; const tw = g.measureText(text).width + (it?.icon ? 18 : 0) + 10;
      if (tw <= bl - 10 || v === wahl) {
        g.fillStyle = v.zuviel ? 'rgba(90,25,25,.92)' : 'rgba(12,14,18,.88)'; g.beginPath(); g.roundRect(mx - tw / 2, my - 10, tw, 20, 10); g.fill();
        const im = it?.icon && bild(it.icon); if (im?.complete && im.naturalWidth) g.drawImage(im, mx - tw / 2 + 4, my - 8, 16, 16);
        g.fillStyle = '#e8e5de'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(text, mx - tw / 2 + (it?.icon ? 22 : 5), my + 0.5);
      }
    }
  }
  // Teile: Splitter/Merger zuerst (liegen auf den Bändern), dann die Gebäude
  const reihe = teile.filter((t) => !istVorlage(t) && tImBild(t)).sort((a, b) => (TYP.get(b.cls).anbau ? 1 : 0) - (TYP.get(a.cls).anbau ? 1 : 0));
  for (const t of reihe) zeichneTeil(t, st, modell);
  // Färben: Rahmen
  if (zug?.art === 'lasso' && zug.pts.length > 1) { g.strokeStyle = '#f59a23'; g.setLineDash([6, 4]); g.lineWidth = 1.5; g.beginPath(); zug.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.lineTo(maus.x, maus.y); g.closePath(); g.stroke(); g.setLineDash([]); g.fillStyle = 'rgba(245,154,35,.08)'; g.fill(); }
  if (zug?.art === 'rahmen') { g.strokeStyle = '#f59a23'; g.setLineDash([6, 4]); g.lineWidth = 1.5; g.strokeRect(zug.px, zug.py, maus.x - zug.px, maus.y - zug.py); g.setLineDash([]); g.fillStyle = 'rgba(245,154,35,.08)'; g.fillRect(zug.px, zug.py, maus.x - zug.px, maus.y - zug.py); }
  // begonnene Verbindung
  if (start) {
    const z = portUnter(maus.x, maus.y), w = start.wege || [];
    let vorsch = null;
    if (z && passt(start.port, z)) vorsch = w.length ? (start.port.ein ? wegManuell(z, start.port, [...w].reverse()) : wegManuell(start.port, z, w)) : verlege(start.port.ein ? z : start.port, start.port.ein ? start.port : z);
    g.strokeStyle = 'rgba(245,154,35,.85)'; g.lineWidth = 3; g.setLineDash([8, 6]); g.beginPath();
    if (vorsch) vorsch.punkte.map(([x, y]) => zuBild(x, y)).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    else {
      const kette = [[start.port.x, start.port.y], [start.port.sx, start.port.sy], ...w, wegpunkt(maus.wx, maus.wy)];
      kette.map(([x, y]) => zuBild(x, y)).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    }
    g.stroke(); g.setLineDash([]);
    g.fillStyle = '#f59a23'; for (const [x, y] of w) { const [bx, by] = zuBild(x, y); g.beginPath(); g.arc(bx, by, 4, 0, Math.PI * 2); g.fill(); }
  }
  // Hinweiszeile: beim Verbinden die Bedienung für eigene Linien
  const hw = $('hinweis'); hw.dataset.normal ||= hw.textContent;
  const htxt = start ? `Verbinden: ins Leere klicken = Wegpunkt setzen (${start.wege?.length || 0}) · Rücktaste = letzten Wegpunkt weg · auf einen Anschluss klicken = fertig · Esc = abbrechen` : hw.dataset.normal;
  if (hw.textContent !== htxt) hw.textContent = htxt;
  if (nurBild) return; // Animation: Felder und rechte Seite bleiben, wie sie sind
  feldZeigen();
  infoZeigen();
}

function zeichneTeil(t, st, modell) {
  const T = TYP.get(t.cls), k = gehaeuse(t), [x0, y0] = zuBild(k[0], k[2]), [x1, y1] = zuBild(k[1], k[3]);
  const gr = Math.min(x1 - x0, y1 - y0), r = t.rezept && D.rezepte[t.rezept];
  let sp = null;
  if (modell) sp = T.block ? vorlagenBild(t, st) : toenen(ds.bild(t.cls, st), t.farbe);
  if (T.block && !VORL.get(t.cls.slice(3))?.szene) vorlageLaden(t.cls.slice(3));
  if (sp) {
    const [cx, cy] = zuBild(t.x, t.y), f = ansicht.s / sp.s;
    g.save(); g.translate(cx, cy); g.rotate((t.rot * Math.PI) / 180); g.scale(f, f);
    g.shadowColor = 'rgba(10,20,15,.45)'; g.shadowBlur = Math.min(24, 60 * ansicht.s); g.shadowOffsetX = 25 * ansicht.s; g.shadowOffsetY = 35 * ansicht.s;
    g.drawImage(sp.bild, -sp.ox, -sp.oy);
    g.restore();
  } else {
    g.fillStyle = T.block ? 'rgba(53,59,68,.55)' : T.anbau ? '#3a3f48' : t.rezept ? '#2c3a4a' : '#353b44';
    g.beginPath(); g.roundRect(x0, y0, x1 - x0, y1 - y0, Math.min(8, (x1 - x0) / 6)); g.fill();
    const fi = farbInfo(t.farbe); if (fi) { g.fillStyle = fi.prim + '55'; g.fill(); }
    g.strokeStyle = '#5d6672'; g.lineWidth = 1.5; g.stroke();
    const im = bild(T.icon);
    if (im?.complete && im.naturalWidth && gr > 14) { const s = Math.min(gr * 0.62, 96); g.drawImage(im, (x0 + x1) / 2 - s / 2, (y0 + y1) / 2 - s / 2, s, s); }
  }
  if (t === wahl || mehr.includes(t)) { g.strokeStyle = '#f59a23'; g.lineWidth = 2; g.setLineDash([6, 4]); g.strokeRect(x0 - 3, y0 - 3, x1 - x0 + 6, y1 - y0 + 6); g.setLineDash([]); }
  else if (T.block) { g.strokeStyle = 'rgba(245,154,35,.6)'; g.lineWidth = 1.5; g.setLineDash([10, 6]); g.strokeRect(x0, y0, x1 - x0, y1 - y0); g.setLineDash([]); }
  else if (!T.anbau && T.rezepte.length && !r) { g.strokeStyle = 'rgba(245,154,35,.55)'; g.lineWidth = 1.5; g.setLineDash([4, 4]); g.strokeRect(x0, y0, x1 - x0, y1 - y0); g.setLineDash([]); }
  // Schild mittig: Rezept (Maschinen) bzw. Name (Vorlage, Lager …)
  if (!T.anbau && gr > 50) {
    const prod = r ? D.items[r.produkte[0]?.item] : null, im = prod?.icon ? bild(prod.icon) : null;
    const text = (T.block ? T.name : r ? r.name + (takt(t) !== 1 ? ` · ${zahl(takt(t) * 100, 0)} %` : '') : T.rezepte.length ? tr('Rezept wählen') : T.name).slice(0, 34);
    g.font = '600 11px system-ui'; const tw = g.measureText(text).width + (im ? 20 : 0) + 12, mx = (x0 + x1) / 2, my = T.block ? y0 + 8 : (y0 + y1) / 2 - 10;
    g.fillStyle = r || T.block || !T.rezepte.length ? 'rgba(14,17,22,.82)' : 'rgba(90,55,10,.88)'; g.beginPath(); g.roundRect(mx - tw / 2, my, tw, 20, 6); g.fill();
    if (r || T.block) { g.strokeStyle = 'rgba(245,154,35,.7)'; g.lineWidth = 1; g.stroke(); }
    if (im?.complete && im.naturalWidth) g.drawImage(im, mx - tw / 2 + 5, my + 2, 16, 16);
    g.fillStyle = '#f2efe8'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(text, mx - tw / 2 + (im ? 24 : 6), my + 10.5);
  }
  if (t.regeln && ansicht.s > 0.12) regelMarken(t);
  for (const p of anschluesse(t)) {
    const [px, py] = zuBild(p.x, p.y), stp = rechnung.stand.get(`${t.id}:${p.name}`), frei = !belegtSet.has(t.id + ':' + p.name);
    const rad = Math.min(sp && !frei ? 4 : 9, Math.max(sp && !frei ? 2.5 : 4, (sp && !frei ? 22 : 45) * ansicht.s));
    g.fillStyle = p.art === 'r' ? '#36c6b3' : p.ein ? '#4aa3ff' : '#f39b3c';
    g.beginPath(); g.arc(px, py, rad, 0, Math.PI * 2); g.fill();
    g.lineWidth = 2; g.strokeStyle = start && start.port.teil === t && start.port.name === p.name ? '#fff' : stp?.st === 'ok' || stp?.st === 'extern' ? '#7fd49a' : stp && stp.st !== 'frei' ? '#ff8a80' : 'rgba(0,0,0,.6)'; g.stroke();
  }
}

/** Sortierregeln am Splitter sichtbar machen: je Ausgang ein kleines Schild außen (Item-Bild, ∗ beliebig, ⤳ Überlauf) */
function regelMarken(t) {
  for (const p of anschluesse(t)) {
    if (p.ein) continue;
    const l = t.regeln[p.name] || []; if (!l.length || (l.length === 1 && l[0] === 'none')) continue;
    const [px, py] = zuBild(p.x + p.nx * 60, p.y + p.ny * 60), s = Math.max(12, Math.min(20, 90 * ansicht.s));
    const r0 = l[0], im = D.items[r0]?.icon ? bild(D.items[r0].icon) : null;
    g.fillStyle = r0 === 'overflow' ? 'rgba(120,40,30,.92)' : 'rgba(14,17,22,.88)'; g.beginPath(); g.roundRect(px - s / 2 - 2, py - s / 2 - 2, s + 4 + (l.length > 1 ? 10 : 0), s + 4, 5); g.fill();
    if (im?.complete && im.naturalWidth) g.drawImage(im, px - s / 2, py - s / 2, s, s);
    else { g.fillStyle = '#f2efe8'; g.font = `700 ${Math.round(s * 0.8)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(REGEL_ZEICHEN[r0] || '?', px, py + 1); }
    if (l.length > 1) { g.fillStyle = '#f5c46a'; g.font = '700 10px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('+' + (l.length - 1), px + s / 2, py); }
  }
}
let VORLAGE_DA = null; // Set der Klassen mit Vorlage (null = unbekannt)
const vorlageDa = (cls) => !VORLAGE_DA || VORLAGE_DA.has(cls);
const REGEL_ZEICHEN = { any: '∗', rest: '∗?', overflow: '⤳', none: '×' };
const REGEL_NAMEN = { any: 'Beliebig', none: 'Keine', overflow: 'Überlauf', rest: 'Beliebig, sonst nirgends' };
const ARTEN_SPLITTER = ['Build_ConveyorAttachmentSplitter_C', 'Build_ConveyorAttachmentSplitterSmart_C', 'Build_ConveyorAttachmentSplitterProgrammable_C'];
const ARTEN_MERGER = ['Build_ConveyorAttachmentMerger_C', 'Build_ConveyorAttachmentMergerPriority_C'];
const mitRegeln = (cls) => /SplitterSmart|SplitterProgrammable/.test(cls);
const standardRegeln = () => ({ Output1: ['any'], Output2: ['none'], Output3: ['none'] });
/** Feldteil für Splitter/Merger: Art wechseln, Sortierregeln je Ausgang (wie im Spiel: links – Mitte – rechts) */
function feldSplitter(t) {
  const arten = (ARTEN_SPLITTER.includes(t.cls) ? ARTEN_SPLITTER : ARTEN_MERGER.includes(t.cls) ? ARTEN_MERGER : []).filter((c) => TYP.has(c));
  if (arten.length < 2) return '';
  let h = `<label>Art</label><select id="f-art">${arten.map((c) => `<option value="${c}"${c === t.cls ? ' selected' : ''}${vorlageDa(c) || c === t.cls ? '' : ' disabled'}>${esc(TYP.get(c).name)}${vorlageDa(c) ? '' : ' – keine Vorlage'}</option>`).join('')}</select>`;
  if (!vorlageDa(t.cls)) h += '<p class="muted" style="margin:4px 0 0;font-size:11px;color:#ff8a80">Für dieses Bauteil gibt es keine Vorlage aus deinen Blaupausen – zum Speichern einmal im Spiel eine Blaupause damit anlegen.</p>';
  if (!mitRegeln(t.cls)) return h;
  const regeln = t.regeln || standardRegeln(), prog = /Programmable/.test(t.cls);
  // Items: zuerst, was auf dem Zulauf liegt, dann alle festen Items
  const zu = verb.find((v) => v.nach.id === t.id)?.fluss?.item;
  const feste = Object.entries(D.items).filter(([, it]) => !it.fluessig).sort((a, b) => a[1].name.localeCompare(b[1].name, 'de'));
  const optionen = (wert) => `<optgroup label="Regel">${Object.entries(REGEL_NAMEN).map(([k, n]) => `<option value="${k}"${k === wert ? ' selected' : ''}>${REGEL_ZEICHEN[k]} ${n}</option>`).join('')}</optgroup>`
    + (zu && D.items[zu] ? `<optgroup label="Auf dem Zulauf"><option value="${zu}"${zu === wert ? ' selected' : ''}>${esc(D.items[zu].name)}</option></optgroup>` : '')
    + `<optgroup label="Alle Items">${feste.map(([id, it]) => `<option value="${id}"${id === wert && id !== zu ? ' selected' : ''}>${esc(it.name)}</option>`).join('')}</optgroup>`;
  h += `<label>Sortierregeln ${prog ? '(mehrere je Ausgang)' : ''}</label><div class="regeln">`;
  for (const [out, name] of [['Output3', 'Links'], ['Output1', 'Mitte'], ['Output2', 'Rechts']]) {
    const l = regeln[out]?.length ? regeln[out] : ['none'];
    h += `<div class="regel"><b>${name}</b><div>${l.map((r, i) => `<span class="rz"><select data-out="${out}" data-i="${i}">${optionen(r)}</select>${prog && l.length > 1 ? `<button type="button" data-weg="${out}" data-i="${i}" title="Regel entfernen">×</button>` : ''}</span>`).join('')}${prog ? `<button type="button" data-dazu="${out}" title="weitere Regel">+ Regel</button>` : ''}</div></div>`;
  }
  return h + '</div><p class="muted" style="margin:4px 0 0;font-size:11px">Links/rechts in Laufrichtung. Wird so in die Blaupause geschrieben.</p>';
}
function feldSplitterVerdrahten(t) {
  $('f-art')?.addEventListener('change', (e) => {
    merke(); t.cls = e.target.value;
    if (mitRegeln(t.cls)) { t.regeln = t.regeln || standardRegeln(); if (!/Programmable/.test(t.cls)) for (const k of Object.keys(t.regeln)) t.regeln[k] = t.regeln[k].slice(0, 1); }
    else delete t.regeln;
    feldFuer = null; sichern(); zeichne();
  });
  const el = $('feld');
  el.querySelectorAll('select[data-out]').forEach((sel) => sel.addEventListener('change', () => {
    merke(); t.regeln = t.regeln || standardRegeln();
    const l = [...(t.regeln[sel.dataset.out] || ['none'])]; l[+sel.dataset.i] = sel.value; t.regeln[sel.dataset.out] = l;
    feldFuer = null; sichern(); zeichne();
  }));
  el.querySelectorAll('[data-dazu]').forEach((b) => b.addEventListener('click', () => { merke(); t.regeln = t.regeln || standardRegeln(); const o = b.dataset.dazu; t.regeln[o] = [...(t.regeln[o] || []).filter((r) => r !== 'none'), verb.find((v) => v.nach.id === t.id)?.fluss?.item || 'any']; feldFuer = null; sichern(); zeichne(); }));
  el.querySelectorAll('[data-weg]').forEach((b) => b.addEventListener('click', () => { merke(); const o = b.dataset.weg; t.regeln[o].splice(+b.dataset.i, 1); if (!t.regeln[o].length) t.regeln[o] = ['none']; feldFuer = null; sichern(); zeichne(); }));
}

// ------------------------------------------------------------------ Treffer
function portUnter(px, py) {
  let best = null, bd = Math.min(16, Math.max(9, 70 * ansicht.s));
  for (const t of teile) for (const p of anschluesse(t)) { const [x, y] = zuBild(p.x, p.y), d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = p; } }
  return best;
}
function teilUnter(px, py) {
  const [wx, wy] = zuWelt(px, py), drin = (t) => { const k = gehaeuse(t); return wx >= k[0] && wx <= k[1] && wy >= k[2] && wy <= k[3]; };
  for (let i = teile.length - 1; i >= 0; i--) if (!istVorlage(teile[i]) && drin(teile[i])) return teile[i];
  for (let i = teile.length - 1; i >= 0; i--) if (istVorlage(teile[i]) && drin(teile[i])) return teile[i];
  return null;
}
function verbUnter(px, py) {
  for (const v of verb) { const pts = v.punkte.map(([x, y]) => zuBild(x, y)); for (let i = 1; i < pts.length; i++) { const [ax, ay] = pts[i - 1], [bx, by] = pts[i], l2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1; const u = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2)); if (Math.hypot(ax + u * (bx - ax) - px, ay + u * (by - ay) - py) < Math.max(8, 60 * ansicht.s)) return v; } }
  return null;
}
const passt = (a, b) => a && b && a.teil !== b.teil && a.art === b.art && (a.art === 'r' || a.ein !== b.ein) && !belegt(a.teil, a.name) && !belegt(b.teil, b.name);

function verbinde(a, b, wege = []) {
  if (!passt(a, b)) return false;
  const tausch = a.art === 'b' && a.ein, [q, z] = tausch ? [b, a] : [a, b];
  const w = tausch ? [...wege].reverse() : [...wege];
  merke();
  const r = w.length ? wegManuell(q, z, w) : verlege(q, z);
  verb.push({ id: 'v' + neuId++, von: { id: q.teil.id, port: q.name }, nach: { id: z.teil.id, port: z.name }, art: a.art, punkte: r.punkte, ok: r.ok, ...(w.length ? { wege: w } : {}) });
  if (!r.ok) toast('Kein freier Weg gefunden – die Verbindung ist rot markiert. Teile etwas auseinanderschieben.', true);
  return true;
}
function autoVerbinden() {
  const { zuteilung } = rechne();
  let n = 0;
  merke();
  const ports = teile.flatMap(anschluesse);
  for (const e of ports.filter((p) => p.ein && !belegt(p.teil, p.name))) {
    const ze = zuteilung.get(`${e.teil.id}:${e.name}`); if (!ze) continue;
    const kandidaten = ports.filter((p) => !p.ein && p.art === e.art && p.teil !== e.teil && !belegt(p.teil, p.name) && zuteilung.get(`${p.teil.id}:${p.name}`)?.item === ze.item)
      .sort((p, q) => Math.hypot(p.x - e.x, p.y - e.y) - Math.hypot(q.x - e.x, q.y - e.y));
    if (!kandidaten.length) continue;
    const q = kandidaten[0], r = verlege(q, e);
    verb.push({ id: 'v' + neuId++, von: { id: q.teil.id, port: q.name }, nach: { id: e.teil.id, port: e.name }, art: e.art, punkte: r.punkte, ok: r.ok }); n++;
  }
  if (!n) { verlauf.pop(); toast('Nichts zu verbinden: Rezepte setzen und freie Ein-/Ausgänge mit gleichem Item anlegen. Für mehrere Abnehmer Splitter/Merger einsetzen.'); }
  else toast(`${n} Verbindung${n > 1 ? 'en' : ''} automatisch verlegt.`);
  sichern(); zeichne();
}

// ------------------------------------------------------------------ Einstellungsfeld am Gebäude
function farbRaster(akt, id) {
  const knopf = (sw, f, titel) => `<button type="button" class="fm${akt === sw ? ' an' : ''}" data-sw="${sw}" title="${esc(titel)}" style="--p:${f.prim};--s:${f.sek}"><i></i></button>`;
  return `<div class="farben" id="${id}"><button type="button" class="fm ohne${!akt ? ' an' : ''}" data-sw="" title="wie die Vorlage aus deinen Blaupausen">–</button>${SLOTS.map((s, i) => knopf('SwatchDesc_Slot' + i, s, 'Slot ' + (i + 1))).join('')}${MATERIAL.map(([sw, n, p, s]) => knopf(sw, { prim: p, sek: s }, n)).join('')}</div>`;
}
let feldFuer = null;
let bandKlick = [0, 0];
/** Feld neben einem angeklickten Band/Rohr: Stufe (automatisch oder von Hand), Farbe, Weg, Löschen */
function feldBand(el) {
  const v = wahl, rohr = v.art === 'r', W = cv.clientWidth, H = cv.clientHeight; el.classList.remove('breit');
  let left = bandKlick[0] + 16, top = bandKlick[1] - 20;
  if (left + 270 > W) left = Math.max(8, bandKlick[0] - 286);
  el.style.left = left + 'px'; el.style.top = Math.max(8, Math.min(top, H - (el.offsetHeight || 240) - 8)) + 'px';
  const sig = JSON.stringify(['v', v.id, v.mkWahl, v.mkAuto, v.farbe, !!v.wege?.length, v.fluss?.menge]);
  if (feldFuer === sig) { el.style.display = 'block'; return; }
  feldFuer = sig;
  const kap = rohr ? D.rohr : D.band, stufen = rohr ? [1, 2] : [1, 2, 3, 4, 5, 6], m = v.fluss?.menge || 0;
  let h = `<h3>${rohr ? 'Rohr' : 'Förderband'}</h3>`;
  h += `<div class="muted" style="font-size:12px;margin-bottom:4px">${v.fluss ? `${esc(D.items[v.fluss.item]?.name || v.fluss.item)} · ${zahl(m)}/min` : 'noch kein Fluss'}</div>`;
  h += `<label>Stufe</label><select id="f-mk"><option value="">Automatisch (Mk.${v.mkAuto || 1} – reicht für ${zahl(m)}/min)</option>${stufen.map((k) => `<option value="${k}"${v.mkWahl === k ? ' selected' : ''}>Mk.${k} – bis ${kap[k]}/min${kap[k] + 1e-6 < m ? ' (zu klein!)' : ''}</option>`).join('')}</select>`;
  h += `<label>Farbe</label>${farbRaster(v.farbe || '', 'f-vfarben')}`;
  h += `<div class="reihe">${v.wege?.length ? '<button id="f-auto" title="Eigene Wegpunkte verwerfen und automatisch verlegen">Automatisch verlegen</button>' : ''}<button id="f-vloeschen" title="Entf">Löschen</button></div>`;
  el.innerHTML = h; el.style.display = 'block';
  $('f-mk').onchange = (e) => { merke(); v.mkWahl = +e.target.value || undefined; if (!v.mkWahl) delete v.mkWahl; sichern(); zeichne(); };
  $('f-vfarben').onclick = (e) => { const b = e.target.closest('[data-sw]'); if (!b) return; merke(); v.farbe = b.dataset.sw || null; sichern(); zeichne(); };
  if ($('f-auto')) $('f-auto').onclick = () => { merke(); delete v.wege; neuVerlegen(); sichern(); zeichne(); };
  $('f-vloeschen').onclick = loeschen;
}
function feldZeigen() {
  const el = $('feld');
  if (wahl && !istTeil(wahl) && verb.includes(wahl) && werkzeug === 'waehlen' && !zug?.bewegt && mehrV.length <= 1 && !mehr.length) { feldBand(el); return; }
  if (!istTeil(wahl) || mehr.length > 1 || mehrV.length > 1 || zug?.bewegt || werkzeug !== 'waehlen') { el.style.display = 'none'; feldFuer = null; return; }
  const t = wahl, T = TYP.get(t.cls), k = gehaeuse(t), [, y0] = zuBild(k[0], k[2]), [x1, y1] = zuBild(k[1], k[3]), [xa] = zuBild(k[0], k[2]);
  const W = cv.clientWidth, H = cv.clientHeight, fb = mitRegeln(t.cls) ? 300 : 260;
  el.classList.toggle('breit', mitRegeln(t.cls));
  let left = x1 + 12, top = Math.max(8, y0);
  if (left + fb > W) left = Math.max(8, xa - fb - 2);
  el.style.left = left + 'px'; el.style.top = Math.min(top, Math.max(8, H - (el.offsetHeight || 260) - 8)) + 'px';
  const sig = JSON.stringify([t.id, t.rezept, t.takt, t.farbe, t.rot, t.cls, t.regeln]);
  if (feldFuer === sig) { el.style.display = 'block'; return; }
  feldFuer = sig;
  let h = `<h3>${T.icon ? `<img src="icons/${encodeURIComponent(T.icon)}" alt="">` : ''}${esc(T.name)}</h3>`;
  if (T.rezepte.length) {
    h += `<label>Rezept</label><select id="f-rezept"><option value="">– Rezept wählen –</option>${T.rezepte.map((id) => ({ id, r: D.rezepte[id] })).sort((a, b) => a.r.alternativ - b.r.alternativ || a.r.name.localeCompare(b.r.name, 'de')).map(({ r, id }) => `<option value="${id}"${id === t.rezept ? ' selected' : ''}>${esc(r.name)}${r.alternativ ? ' (alt.)' : ''}</option>`).join('')}</select>`;
  }
  if (!T.anbau && !T.block && (T.rezepte.length || T.fest)) h += `<label>Takt (%) – zum Rechnen; im Spiel an der Maschine einstellen</label><div class="takt"><input type="range" id="f-takt-r" min="1" max="250" value="${t.takt || 100}"><input type="number" id="f-takt" min="1" max="250" value="${t.takt || 100}"></div>`;
  if (T.anbau) h += feldSplitter(t);
  if (!T.block) h += `<label>Farbe</label>${farbRaster(t.farbe || '', 'f-farben')}`;
  if (T.hinweis) h += `<p class="muted" style="margin:8px 0 0;font-size:11px">${esc(T.hinweis)}</p>`;
  h += `<div class="reihe"><button id="f-drehen" title="R">Drehen</button><button id="f-kopie" title="Strg+D">Duplizieren</button><button id="f-loeschen" title="Entf">Löschen</button></div>`;
  el.innerHTML = h; el.style.display = 'block';
  $('f-rezept')?.addEventListener('change', (e) => { merke(); t.rezept = e.target.value || null; sichern(); zeichne(); });
  const taktSetzen = (v) => { t.takt = Math.max(1, Math.min(250, Math.round(+v) || 100)); sichern(); $('f-takt').value = t.takt; $('f-takt-r').value = t.takt; feldFuer = JSON.stringify([t.id, t.rezept, t.takt, t.farbe, t.rot, t.cls, t.regeln]); zeichne(); };
  $('f-takt-r')?.addEventListener('input', (e) => taktSetzen(e.target.value));
  $('f-takt')?.addEventListener('change', (e) => { merke(); taktSetzen(e.target.value); });
  $('f-farben')?.addEventListener('click', (e) => { const b = e.target.closest('[data-sw]'); if (!b) return; merke(); t.farbe = b.dataset.sw || null; sichern(); zeichne(); });
  $('f-drehen').onclick = drehen; $('f-kopie').onclick = duplizieren; $('f-loeschen').onclick = loeschen;
  feldSplitterVerdrahten(t);
}

// ------------------------------------------------------------------ Rechte Seite: Ziel + To-do, Auswahl, Übersicht
let planCache = null, herstellbarListe = null;
function planKat() { return { rezepte: D.rezepte, items: D.items, gebaeude: D.gebaeude }; }
/** Ziele: aus dem Planer übernommen (mehrere) oder hier gewählt (eines) */
function zielListe() { return ziel.ziele?.length ? ziel.ziele.filter((z) => z.item && z.menge > 0) : ziel.item && ziel.menge > 0 ? [{ item: ziel.item, menge: +ziel.menge }] : []; }
function planVoll(pl) { const k = planKat(); return (pl.modus || 'einfach') === 'optimiert' ? rechneOptimal(k, pl) : planRechnen(k, pl); }
/** Aktiver Plan aus dem Planer (gleicher Browser, gleiche App) – null wenn keiner */
function planerPlan() {
  try {
    const u = JSON.parse(localStorage.getItem('bs-baukasten-uebergabe') || 'null');
    const w = JSON.parse(localStorage.getItem('bs.planer.welt') || 'null'), f = w?.fabriken?.[w.aktiv || 0];
    const p = f?.plan || JSON.parse(localStorage.getItem('bs.planer') || 'null');
    const kand = u?.plan?.ziele?.length ? u : p?.ziele?.some((z) => z.item && z.menge > 0) ? { name: f?.name || 'Planer', plan: p } : null;
    return kand && kand.plan.ziele.some((z) => D.items[z.item]) ? kand : null;
  } catch { return null; }
}
/** Bildauswahl wie im Planer: alle herstellbaren Produkte, gruppiert nach dem Gebäude des Standard-Rezepts */
let zielEintraege = null;
async function zielWaehlen() {
  if (!zielEintraege) {
    const reihe = D.teile.filter((t) => t.gruppe === 'fertigung').map((t) => t.name);
    zielEintraege = [];
    for (const [id, it] of Object.entries(D.items)) {
      const rz = Object.values(D.rezepte).filter((r) => r.produkte.some((q) => q.item === id));
      if (!rz.length || it.kategorie === 'Ressource') continue;
      const std = rz.find((r) => !r.alternativ) || rz[0], geb = std.gebaeude?.find((c) => TYP.get(c)?.gruppe === 'fertigung');
      zielEintraege.push({ id, name: it.name, gruppe: /FICSMAS/i.test(it.name) ? 'FICSMAS (Event)' : TYP.get(geb)?.name || 'Sonstiges', marke: it.fluessig ? 'flüssig' : '', wert: it.wert || 0,
        bild: `<span class="tile bw-item${it.fluessig ? ' fluessig' : ''}">${esc((it.name || id).slice(0, 2).toUpperCase())}${it.icon ? `<img src="icons/${encodeURIComponent(it.icon)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>` });
    }
    zielEintraege.sort((a, b) => a.wert - b.wert || a.name.localeCompare(b.name, 'de'));
    zielWaehlen.reihe = [...reihe, 'Sonstiges', 'FICSMAS (Event)'];
  }
  const id = await bildwahl({ titel: 'Was soll herauskommen?', eintraege: zielEintraege, aktuell: ziel.ziele?.length ? null : ziel.item, gruppenReihe: zielWaehlen.reihe,
    hinweis: 'Klick auf ein Bild wählt es aus. Die Liste rechts zeigt dann, welche Maschinen gebraucht werden, und hakt ab, was schon auf dem Reißbrett steht.' });
  if (id == null) return;
  ziel = { item: id, menge: ziel.menge || 10, wahl: {}, haken: {} }; planCache = null; sichern(); zeichne();
}
function plan() {
  const zl = zielListe(); if (!zl.length) return null;
  const key = JSON.stringify([zl, ziel.vorhanden, ziel.wahl, ziel.modus, ziel.takt]);
  if (planCache?.key === key) return planCache.erg;
  let erg = null; try { erg = planVoll({ ziele: zl, vorhanden: ziel.vorhanden || [], wahl: ziel.wahl, modus: ziel.modus, alternativen: ziel.alternativen, takt: ziel.takt }); } catch (e) { console.warn(e); }
  planCache = { key, erg }; return erg;
}
function vorhandenJeRezept() {
  const m = {};
  for (const t of teile) {
    if (istVorlage(t)) { const v = VORL.get(t.cls.slice(3)); for (const [id, n] of Object.entries(v?.rezepte || {})) m[id] = (m[id] || 0) + n; continue; }
    if (t.rezept) m[t.rezept] = (m[t.rezept] || 0) + takt(t);
  }
  return m;
}
/** Zusammenfassung des Reißbretts: Bedarf, Ergebnis, Strom, Maschinen, Baukosten und nötige Freischaltungen */
function zusammenfassung() {
  const bedarf = {}, frei = {}; let mw = 0, erz = 0, maschinen = 0;
  for (const t of teile) {
    const T = TYP.get(t.cls);
    if (T.block) { const v = VORL.get(t.cls.slice(3)); for (const [it, m] of Object.entries(v?.ein || {})) bedarf[it] = (bedarf[it] || 0) + m; for (const [it, m] of Object.entries(v?.aus || {})) frei[it] = (frei[it] || 0) + m; maschinen += Object.values(v?.maschinen || {}).reduce((a, b) => a + b, 0); continue; }
    if (T.anbau) continue;
    maschinen++;
    if (T.gruppe === 'strom') erz += Math.abs(T.mw || 0); else mw += (T.mw || 0) * Math.pow(takt(t), 1.321928);
  }
  for (const [k, z] of rechnung.zuteilung) {
    if (belegtSet.has(k)) continue;
    if (z.ein) bedarf[z.item] = (bedarf[z.item] || 0) + z.menge; else frei[z.item] = (frei[z.item] || 0) + z.menge;
  }
  for (const [it, m] of Object.entries(rechnung.extern || {})) bedarf[it] = (bedarf[it] || 0) + m;
  // Ergebnis: was in einem offenen Splitter/Merger endet oder in Lager/Schredder läuft
  const byId = new Map(teile.map((t) => [t.id, t])), mitAusgang = new Set(verb.map((w) => w.von.id));
  for (const v of verb) if (v.fluss && !v.fluss.extern && v.fluss.menge > 1e-9) {
    const zt = byId.get(v.nach.id); if (!zt) continue; const T = TYP.get(zt.cls);
    if ((T.anbau && !mitAusgang.has(zt.id)) || (!T.anbau && !T.block && !T.rezepte.length && !T.fest)) frei[v.fluss.item] = (frei[v.fluss.item] || 0) + v.fluss.menge;
  }
  const arten = {}, kosten = {}, frei2 = new Map();
  const merkFrei = (f) => { if (!f) return; const k = f.typ + '|' + f.name; if (!frei2.has(k)) frei2.set(k, f); };
  for (const t of teile) {
    const T = TYP.get(t.cls);
    if (T.block) { const v = VORL.get(t.cls.slice(3)); for (const [c, n] of Object.entries(v?.maschinen || {})) { const nm = D.gebaeude[c]?.name || c; arten[nm] = (arten[nm] || 0) + n; merkFrei(D.gebaeude[c]?.frei); } for (const id of Object.keys(v?.rezepte || {})) merkFrei(D.rezepte[id]?.frei); continue; }
    if (!T.anbau) arten[T.name] = (arten[T.name] || 0) + 1;
    const gb = D.gebaeude[t.cls]; merkFrei(gb?.frei);
    for (const [it, n] of gb?.kosten || []) kosten[it] = (kosten[it] || 0) + n;
    if (t.rezept) merkFrei(D.rezepte[t.rezept]?.frei);
  }
  const fl = [...frei2.values()], ms = fl.filter((f) => ['Start', 'HUB-Upgrade', 'Meilenstein'].includes(f.typ));
  const top = ms.reduce((a, b) => (!a || b.stufe > a.stufe ? b : a), null);
  const stufe = top ? { stufe: top.stufe, name: top.typ === 'Meilenstein' ? top.name : '' } : null;
  const extra = fl.filter((f) => !['Start', 'HUB-Upgrade', 'Meilenstein'].includes(f.typ)).map((f) => ({ typ: f.typ === 'Festplatte' ? 'Alternativrezept (Festplatte)' : f.typ, name: f.name.replace(/^Alternativ:\s*/, '') })).sort((a, b) => a.typ.localeCompare(b.typ) || a.name.localeCompare(b.name, 'de'));
  return { bedarf, frei, mw, erz, maschinen, arten, kosten, stufe, extra };
}
/** Kurzer Text für die Blaupausen-Beschreibung (und zum Kopieren) */
function beschreibungText() {
  const zf = zusammenfassung(), nm = (it) => D.items[it]?.name || it, z = (v) => zahl(v, v < 10 ? 1 : 0);
  const liste = (o, n = 6) => { const e = Object.entries(o).sort((a, b) => b[1] - a[1]); return e.slice(0, n).map(([it, m]) => `${z(m)}/min ${nm(it)}`).join(', ') + (e.length > n ? ` (+${e.length - n})` : ''); };
  const zl = zielListe(), zeilen = [];
  zeilen.push(zl.length ? `${tr('Ziel:')} ${zl.map((x) => `${z(x.menge)}/min ${nm(x.item)}`).join(', ')}` : 'Blueprint Studio');
  if (zf.stufe) zeilen.push(`${tr('Braucht:')} ${tr(`Stufe ${zf.stufe.stufe}`)}${zf.stufe.name ? ` (${zf.stufe.name})` : ''}${zf.extra.length ? '; ' + zf.extra.slice(0, 6).map((x) => x.name).join(', ') + (zf.extra.length > 6 ? ' …' : '') : ''}`);
  if (Object.keys(zf.bedarf).length) zeilen.push(`${tr('Zulieferung:')} ${liste(zf.bedarf)}`);
  if (Object.keys(zf.frei).length) zeilen.push(`${tr('Ergebnis/Überschuss:')} ${liste(zf.frei)}`);
  zeilen.push(`${tr('Maschinen:')} ${Object.entries(zf.arten).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, k]) => `${k}× ${n}`).join(', ')}`);
  zeilen.push(tr(`Strom: ca. ${zahl(zf.mw, 0)} MW`) + (zf.erz ? ' ' + tr(`(Erzeugung bis ${zahl(zf.erz, 0)} MW)`) : ''));
  return zeilen.join('\n').slice(0, 1500);
}
function infoZeigen() {
  const el = $('info'), I = (it) => D.items[it], icon = (it) => (I(it)?.icon ? `<img src="icons/${encodeURIComponent(I(it).icon)}" alt="">` : '');
  const name = (it) => esc(I(it)?.name || it);
  let h = '';
  // Ziel-Produkt mit To-do-Liste
  const zl = zielListe(), ausPlaner = ziel.ziele?.length;
  const kachel = (it) => `<span class="tile bw-item">${esc((D.items[it]?.name || it).slice(0, 2).toUpperCase())}${I(it)?.icon ? `<img src="icons/${encodeURIComponent(I(it).icon)}" alt="">` : ''}</span>`;
  h += '<h2>Ziel</h2>';
  if (ausPlaner) {
    h += `<div class="box"><b>Aus dem Planer${ziel.quelle ? ' – ' + esc(ziel.quelle) : ''}</b>${zl.map((z) => `<div class="zeile">${icon(z.item)}${name(z.item)}<span class="w">${zahl(z.menge)}/min</span></div>`).join('')}<div class="reihe" style="margin-top:6px"><button id="z-neu">Eigenes Ziel wählen …</button></div></div>`;
  } else {
    h += `<div class="ziel"><button type="button" class="bw-knopf" id="z-item" title="Produkt wählen">${ziel.item ? kachel(ziel.item) : '<span class="tile bw-item">?</span>'}<span class="bw-k-name">${ziel.item ? name(ziel.item) : 'Produkt wählen …'}</span><span class="bw-k-pfeil">▾</span></button><input type="number" id="z-menge" min="0.1" step="any" value="${ziel.menge}" title="Menge pro Minute"></div>`;
  }
  const pp = planerPlan();
  if (pp && !ausPlaner) h += `<div class="box planer-angebot"><small class="muted">Im Planer: ${pp.plan.ziele.filter((z) => D.items[z.item]).map((z) => esc(D.items[z.item].name) + ' ' + zahl(z.menge) + '/min').join(', ')}</small><div class="reihe" style="margin-top:6px"><button id="z-planer" class="primaer">Aus Planer aufbauen</button></div></div>`;
  const p = plan();
  if (p) {
    const da = vorhandenJeRezept();
    const offen = p.schritte.map((s) => ({ s, ist: da[s.rezept] || 0 }));
    const fertig = (o) => !!ziel.haken[o.s.rezept] || o.ist + 1e-3 >= o.s.maschinen;
    const n = offen.filter(fertig).length;
    h += `<div class="box todo"><b>To-do: ${n} von ${offen.length} Stufen</b><div class="balken"><div style="width:${offen.length ? (100 * n) / offen.length : 0}%"></div></div>`;
    for (const o of offen) {
      const s = o.s, geb = TYP.get(s.gebaeude), f = fertig(o), opt = rezeptOptionen(planKat(), s.produkte[0].item);
      h += `<div class="zeile${f ? ' fertig' : ''}"><input type="checkbox" data-haken="${s.rezept}"${f ? ' checked' : ''} title="abhaken"><div class="t">${icon(s.produkte[0].item)}<span>${esc(s.name)}</span>
        <small>${s.anzahl} × ${esc(geb?.name || s.gebaeude)}${s.takt < 99.9 ? ` (≈ ${zahl(s.maschinen, 2)})` : ''} · gesetzt: ${zahl(o.ist, 2)}</small>
        ${opt.length > 1 ? `<select data-wahl="${s.produkte[0].item}">${opt.map((r) => `<option value="${r.id}"${r.id === s.rezept ? ' selected' : ''}>${esc(r.name)}${r.alternativ ? ' (alt.)' : ''}</option>`).join('')}</select>` : ''}</div>
        ${f ? '' : `<button data-reihe="${s.rezept}" data-n="${Math.max(1, Math.ceil(s.maschinen - o.ist - 1e-6))}" title="Fehlende Maschinen als Reihe aufs Reißbrett setzen">+ ${Math.max(1, Math.ceil(s.maschinen - o.ist - 1e-6))}</button>`}</div>`;
    }
    const roh = Object.entries(p.rohstoffe);
    if (roh.length) h += `<div style="margin-top:6px"><small class="muted">Rohstoffe von außen:</small>${roh.map(([it, m]) => `<div class="zeile">${icon(it)}${name(it)}<span class="w">${zahl(m)}/min</span></div>`).join('')}</div>`;
    h += `<div class="zeile"><span class="muted">Strom (ca.)</span><span class="w">${zahl(p.strom, 0)} MW</span></div>`;
    h += `<div class="reihe" style="margin-top:8px"><button id="z-aufbauen" class="primaer" title="Alle Stufen als Maschinenreihen mit Splittern/Mergern auf das Reißbrett setzen (ersetzt das Reißbrett, Rückgängig mit Strg+Z)">Als Reihen aufbauen</button></div></div>`;
  } else h += '<p class="muted" style="margin:6px 0 12px">Ein Endprodukt und die Menge pro Minute wählen – dann zeigt die Liste, welche Maschinen gebraucht werden, und hakt ab, was schon auf dem Reißbrett steht.</p>';
  // Auswahl
  if (mehr.length > 1 || mehrV.length > 1 || (mehr.length && mehrV.length)) {
    const n = {}; for (const t of mehr) { const nm = TYP.get(t.cls)?.name || t.cls; n[nm] = (n[nm] || 0) + 1; }
    const ids = new Set(mehr.map((t) => t.id)), innen = verb.filter((v) => ids.has(v.von.id) && ids.has(v.nach.id)).length;
    h += `<div class="kopf" style="margin:16px 0 6px">Auswahl</div><h2>${mehr.length} Teil${mehr.length === 1 ? '' : 'e'}${mehrV.length ? ` · ${mehrV.length} Band/Rohr` : ''}</h2><div class="box">${Object.entries(n).map(([k, v]) => `<div class="zeile">${esc(k)}<span class="w">${v}</span></div>`).join('')}<div class="zeile">Verbindungen darin<span class="w">${innen}</span></div>${mehrV.length ? `<div class="zeile">markierte Bänder/Rohre<span class="w">${mehrV.length}</span></div>` : ''}</div>`;
    h += '<div class="reihe"><button id="m-dupl" title="Strg+D">Duplizieren</button><button id="m-dreh" title="R">Drehen</button><button id="m-loesch" title="Entf">Löschen</button></div><p class="muted">Ziehen verschiebt alle. Duplizieren übernimmt die Bänder und Rohre zwischen den gewählten Teilen.</p>';
  } else if (istTeil(wahl)) {
    const T = TYP.get(wahl.cls);
    h += `<div class="kopf" style="margin:16px 0 6px">Auswahl</div><h2>${esc(T.name)}</h2><div class="muted">${zahl((T.box[1] - T.box[0]) / 100)} × ${zahl((T.box[3] - T.box[2]) / 100)} m · ${wahl.rot}°${farbInfo(wahl.farbe) ? ' · ' + farbInfo(wahl.farbe).name : ''}</div>`;
    if (T.block) {
      const v = VORL.get(wahl.cls.slice(3));
      h += `<div class="box"><b>Maschinen</b>${Object.entries(v?.maschinen || {}).map(([c, n]) => `<div class="zeile">${esc(D.gebaeude[c]?.name || c)}<span class="w">${n}</span></div>`).join('')}</div>`;
      h += `<div class="box"><b>Braucht</b>${Object.entries(v?.ein || {}).map(([it, m]) => `<div class="zeile">${icon(it)}${name(it)}<span class="w">${zahl(m)}/min</span></div>`).join('') || '<span class="muted">–</span>'}</div>`;
      h += `<div class="box"><b>Liefert</b>${Object.entries(v?.aus || {}).map(([it, m]) => `<div class="zeile">${icon(it)}${name(it)}<span class="w">${zahl(m)}/min</span></div>`).join('') || '<span class="muted">–</span>'}</div>`;
      h += '<p class="muted">Die Vorlage wird beim Speichern unverändert übernommen (ohne ihre eigenen Fundamente). Ihre Ein- und Ausgänge verbindest du im Spiel.</p>';
    } else {
      const r = wahl.rezept && D.rezepte[wahl.rezept];
      if (r) {
        h += '<div class="box"><b>Eingänge</b>';
        for (const [k, z] of rechnung.zuteilung) {
          if (!z.ein || !k.startsWith(wahl.id + ':')) continue;
          const st = rechnung.stand.get(k);
          const txt = !st || st.st === 'frei' ? '<span class="muted">nicht verbunden</span>' : st.st === 'ok' ? `<span class="ok">${zahl(st.da.menge)} ✓</span>` : st.st === 'extern' ? '<span class="ok">von außen</span>' : st.st === 'knapp' ? `<span class="err">nur ${zahl(st.da.menge)}</span>` : st.st === 'falsch' ? '<span class="err">falsches Item</span>' : '<span class="err">leer</span>';
          h += `<div class="zeile">${icon(z.item)}${name(z.item)}<span class="w">${zahl(z.menge)}/min · ${txt}</span></div>`;
        }
        h += '</div><div class="box"><b>Ausgänge</b>';
        for (const z of r.produkte) h += `<div class="zeile">${icon(z.item)}${name(z.item)}<span class="w">${zahl(z.proMin * takt(wahl))}/min</span></div>`;
        h += '</div>';
      }
      if (T.mw) h += `<div class="zeile"><span class="muted">${T.gruppe === 'strom' ? 'Erzeugt' : 'Strom'}</span><span class="w">${zahl(Math.abs(T.mw) * Math.pow(takt(wahl), 1.321928), 1)} MW</span></div>`;
      if (T.anbau) h += `<p class="muted">${/Junction/.test(T.cls) ? 'Rohrkreuzung: verteilt und sammelt Flüssigkeiten.' : mitRegeln(T.cls) ? 'Verteilt nach den Sortierregeln im Feld daneben (links – Mitte – rechts in Laufrichtung). „Überlauf“ bekommt nur, was die anderen Ausgänge nicht abnehmen.' : /Splitter/.test(T.cls) ? 'Splitter teilt den Zufluss gleichmäßig auf die verbundenen Ausgänge. Im Feld daneben lässt er sich in einen intelligenten oder programmierbaren Splitter umwandeln.' : /Priority/.test(T.cls) ? 'Prioritätsfusion: Vorrang der Eingänge stellst du im Spiel ein.' : 'Merger führt Bänder zusammen.'}</p>`;
    }
  } else if (wahl) {
    const v = wahl, f = v.fluss;
    h += `<div class="kopf" style="margin:16px 0 6px">Auswahl</div><h2>${v.art === 'r' ? 'Rohr' : 'Förderband'}</h2><div class="box">${f ? `<div class="zeile">${icon(f.item)}${name(f.item)}<span class="w">${zahl(f.menge)}/min</span></div>` : '<span class="muted">noch kein Fluss (Rezept an der Quelle setzen)</span>'}<div class="zeile">Stufe<span class="w ${v.zuviel ? 'err' : ''}">Mk.${v.mk}${v.zuviel ? ' – zu viel!' : ''}</span></div><div class="zeile">Länge<span class="w">${zahl(v.punkte.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - v.punkte[i - 1][0], p[1] - v.punkte[i - 1][1]) : 0), 0) / 100)} m</span></div></div>`;
    h += `<label class="muted">Farbe</label>${farbRaster(v.farbe || '', 'v-farben')}<p class="muted"><kbd>Entf</kbd> löschen</p>`;
  }
  // Übersicht
  const zf = zusammenfassung(), { bedarf, frei, mw, erz, maschinen } = zf;
  const probleme = [...rechnung.stand.values()].filter((s) => s.st === 'knapp' || s.st === 'falsch' || s.st === 'leer').length + verb.filter((v) => v.zuviel || v.ok === false).length;
  h += `<div class="kopf" style="margin:16px 0 6px">Übersicht</div><div class="box"><div class="zeile">Maschinen<span class="w">${maschinen}</span></div><div class="zeile">Strombedarf (ca.)<span class="w">${zahl(mw, 0)} MW</span></div>${erz ? `<div class="zeile">Erzeugung (max.)<span class="w">${zahl(erz, 0)} MW</span></div>` : ''}<div class="zeile">Verbindungen<span class="w">${verb.length}</span></div><div class="zeile">Probleme<span class="w ${probleme ? 'err' : 'ok'}">${probleme || 'keine'}</span></div></div>`;
  const liste = (o, titel) => Object.keys(o).length ? `<div class="box"><b>${titel}</b>${Object.entries(o).sort((a, b) => b[1] - a[1]).map(([it, m]) => `<div class="zeile">${icon(it)}${name(it)}<span class="w">${zahl(m)}/min</span></div>`).join('')}</div>` : '';
  h += liste(bedarf, 'Zulieferung nötig') + liste(frei, 'Ergebnis / Überschuss (freie Ausgänge)');
  if (teile.length) {
    const st = zf.stufe;
    h += `<div class="kopf" style="margin:16px 0 6px">Zusammenfassung</div><div class="box zf">`;
    if (st) h += `<div class="zeile"><b>Braucht</b><span class="w">Stufe ${st.stufe}${st.name ? ` · ${esc(st.name)}` : ''}</span></div>`;
    if (zf.extra.length) h += `<div class="zf-extra">${zf.extra.map((x) => `<div><small class="muted">${esc(x.typ)}:</small> ${esc(x.name)}</div>`).join('')}</div>`;
    h += `<div style="margin-top:6px"><small class="muted">Maschinen</small>${Object.entries(zf.arten).sort((a, b) => b[1] - a[1]).map(([n, k]) => `<div class="zeile">${esc(n)}<span class="w">${k}</span></div>`).join('')}</div>`;
    const ko = Object.entries(zf.kosten).sort((a, b) => b[1] - a[1]);
    if (ko.length) h += `<div style="margin-top:6px"><small class="muted">Baukosten der Gebäude (ohne Bänder, Rohre, Fundamente)</small>${ko.map(([it, m]) => `<div class="zeile">${icon(it)}${name(it)}<span class="w">${Math.round(m).toLocaleString('de-DE')}</span></div>`).join('')}</div>`;
    h += `<div class="reihe" style="margin-top:8px"><button id="zf-kopie" title="Zusammenfassung als Text in die Zwischenablage">Als Text kopieren</button></div></div>`;
  }
  if (!teile.length) h += '<p class="muted">Links ein Gebäude oder eine Vorlage ins Reißbrett ziehen und anklicken – im Feld daneben Rezept, Takt und Farbe wählen. Mit <b>Verbinden</b> einen Ausgang (orange) und einen Eingang (blau) anklicken; türkis = Rohr.</p>';
  if (el.dataset.html !== h) {
    const fokus = document.activeElement?.id, sel = fokus && document.activeElement.selectionStart;
    el.innerHTML = h; el.dataset.html = h;
    if (fokus && $(fokus)) { $(fokus).focus(); try { $(fokus).setSelectionRange(sel, sel); } catch { /* egal */ } }
    $('z-item')?.addEventListener('click', zielWaehlen);
    $('z-neu')?.addEventListener('click', zielWaehlen);
    $('z-planer')?.addEventListener('click', () => { const pp2 = planerPlan(); if (pp2) ausPlanerAufbauen(pp2); });
    $('z-aufbauen')?.addEventListener('click', () => ausPlanerAufbauen({ name: ziel.quelle || 'Baukasten-Ziel', plan: { ziele: zielListe(), vorhanden: ziel.vorhanden || [], wahl: ziel.wahl || {}, modus: ziel.modus, alternativen: ziel.alternativen, takt: ziel.takt } }));
    $('z-menge')?.addEventListener('change', (e) => { ziel.menge = Math.max(0.1, +e.target.value || 1); planCache = null; sichern(); zeichne(); });
    $('zf-kopie')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(beschreibungText()); toast('Zusammenfassung kopiert.'); } catch { toast('Kopieren nicht möglich.', true); } });
    $('m-dupl')?.addEventListener('click', duplizieren); $('m-dreh')?.addEventListener('click', drehen); $('m-loesch')?.addEventListener('click', loeschen);
    el.querySelectorAll('[data-haken]').forEach((c) => c.addEventListener('change', () => { ziel.haken[c.dataset.haken] = c.checked; sichern(); zeichne(); }));
    el.querySelectorAll('[data-wahl]').forEach((s) => s.addEventListener('change', () => { ziel.wahl[s.dataset.wahl] = s.value; sichern(); zeichne(); }));
    el.querySelectorAll('[data-reihe]').forEach((b) => b.addEventListener('click', () => reiheSetzen(b.dataset.reihe, +b.dataset.n)));
    $('v-farben')?.addEventListener('click', (e) => { const b = e.target.closest('[data-sw]'); if (!b || !wahl) return; merke(); wahl.farbe = b.dataset.sw || null; sichern(); zeichne(); });
  }
}

// ------------------------------------------------------------------ Aufbau aus dem Planer (eine Ebene, Bänder dürfen sich kreuzen)
// Je Stufe eine Reihe wie bei den Planer-Blaupausen: oben je Zutat eine Verteiler-Leitung (Band: Splitter, Rohr: Kreuzung),
// darunter die Maschinen nebeneinander (Eingänge nach oben), darunter je Produkt eine Sammel-Leitung (Merger/Kreuzung).
// Stufen nach Fertigungsebene von oben (Rohstoff-nah) nach unten; zwischen den Stufen Verteiler/Sammler, wenn eine Stufe
// mehrere beliefert oder von mehreren beliefert wird. Rohstoffe und Zulieferung bleiben offene Eingänge, Ziele offene Ausgänge.
const SPL = { b: 'Build_ConveyorAttachmentSplitter_C', r: 'Build_PipelineJunction_Cross_C' };
const MRG = { b: 'Build_ConveyorAttachmentMerger_C', r: 'Build_PipelineJunction_Cross_C' };
// Anschlussnamen (lokal −X = rein, +X = raus, +Y/−Y = seitlich)
const NAMEN = {
  vert: { b: { rein: 'Input1', raus: 'Output1', sued: 'Output2', nord: 'Output3' }, r: { rein: 'Connection0', raus: 'Connection1', sued: 'Connection2', nord: 'Connection3' } },
  samm: { b: { rein: 'Input1', raus: 'Output1', sued: 'Input2', nord: 'Input3' }, r: { rein: 'Connection0', raus: 'Connection1', sued: 'Connection2', nord: 'Connection3' } },
};
const rotFuer = (nx, ny) => (nx > 0 ? 0 : ny > 0 ? 90 : nx < 0 ? 180 : 270); // lokale +X-Achse zeigt in Richtung (nx, ny)

/** Verteiler-/Sammelleitung einer Reihe nach dem Zubringer bzw. Abnehmer ausrichten:
 *  Eingang (Verteiler) bzw. Ausgang (Sammler) am Ende, das näher am Gegenstück liegt; kommt das Gegenstück eher von oben
 *  (Verteiler) bzw. geht es eher nach unten (Sammler), zeigt das Endstück dorthin und gibt geradeaus an die Maschine. */
function kettenRichten(k) {
  if (k.el.length < 2) return;
  const N = (k.typ === 'vert' ? NAMEN.vert : NAMEN.samm)[k.art], ids = new Set(k.el.map((t) => t.id)), mids = new Set(k.masch.map((x) => x.m.id));
  const aussen = verb.find((v) => (k.typ === 'vert' ? ids.has(v.nach.id) && !ids.has(v.von.id) : ids.has(v.von.id) && !ids.has(v.nach.id) && !mids.has(v.nach.id)));
  if (!aussen) return;
  const P = portVon(k.typ === 'vert' ? aussen.von : aussen.nach); if (!P) return;
  const w = k.el[0], o = k.el[k.el.length - 1];
  const ost = Math.abs(P.x - o.x) + Math.abs(P.y - o.y) < Math.abs(P.x - w.x) + Math.abs(P.y - w.y);
  // Reihenfolge ab dem Ende beim Gegenstück; s = Richtung nach außen (+1 Osten, −1 Westen)
  const sv = ost ? -1 : 1, sgn = ost ? 1 : -1;
  const reihe = k.el.map((t, i) => ({ t, m: k.masch[i] }));
  // alte Verbindungen der Leitung entfernen (intern und zu den Maschinen), Außenverbindung bleibt
  verb = verb.filter((v) => !(ids.has(v.von.id) && ids.has(v.nach.id)) && !(ids.has(v.von.id) && mids.has(v.nach.id)) && !(mids.has(v.von.id) && ids.has(v.nach.id)));
  const V = (a, ap, b, bp) => verb.push({ id: 'v' + neuId++, von: { id: a.id, port: ap }, nach: { id: b.id, port: bp }, art: k.art, punkte: [] });
  if (k.typ === 'vert') {
    const rot = ost ? 180 : 0, seq = ost ? [...reihe].reverse() : reihe, F = seq[0].t;
    aussen.nach = { id: F.id, port: N.rein };
    const nord = P.y < F.y - 200 && F.y - P.y > (P.x - F.x) * sgn;
    seq.forEach(({ t, m }, i) => {
      const end = i === 0 && nord; t.rot = end ? 90 : rot;
      V(t, end ? N.raus : rot === 0 ? N.sued : N.nord, m.m, m.port);
      if (i + 1 < seq.length) V(t, end ? (sv > 0 ? N.nord : N.sued) : N.raus, seq[i + 1].t, N.rein);
    });
  } else {
    const rot = ost ? 0 : 180, seq = ost ? reihe : [...reihe].reverse(), F = seq[seq.length - 1].t; // seq endet am Ausgang
    aussen.von = { id: F.id, port: N.raus };
    const sued = P.y > F.y + 200 && P.y - F.y > (P.x - F.x) * sgn;
    seq.forEach(({ t, m }, i) => {
      const end = i === seq.length - 1 && sued; t.rot = end ? 90 : rot;
      V(m.m, m.port, t, end ? N.rein : rot === 0 ? N.nord : N.sued);
      if (i + 1 < seq.length) { const n2 = i + 1 === seq.length - 1 && sued; V(t, N.raus, seq[i + 1].t, n2 ? (ost ? N.sued : N.nord) : N.rein); }
    });
  }
}
function ausPlanerAufbauen(pp) {
  const pl = { ziele: pp.plan.ziele.filter((z) => z.item && z.menge > 0 && D.items[z.item]), vorhanden: pp.plan.vorhanden || [], wahl: pp.plan.wahl || {}, modus: pp.plan.modus, alternativen: pp.plan.alternativen, takt: pp.plan.takt };
  let erg; try { erg = planVoll(pl); } catch (e) { toast('Plan lässt sich nicht rechnen: ' + e.message, true); return; }
  if (!erg?.schritte?.length) { toast('Im Planer ist kein Ziel mit Fertigung festgelegt.', true); return; }
  const nMasch = erg.schritte.reduce((q, st) => q + (st.anzahl || 0), 0);
  if (nMasch > 250 && !confirm(tr(`Sehr große Fabrik: rund ${Math.round(nMasch)} Maschinen auf einer Ebene. Der Aufbau dauert eine Weile, und das Reißbrett wird bei so vielen Teilen träge. Tipp: Ziel kleiner stellen oder in Abschnitten planen.\n\nTrotzdem aufbauen?`))) return;
  if (teile.length && !confirm(tr('Das Reißbrett wird durch den Aufbau aus dem Planer ersetzt (Rückgängig mit Strg+Z). Weiter?'))) return;
  merke();
  teile = []; verb = []; wahl = null; mehr = [];
  const fl = (it) => !!D.items[it]?.fluessig;
  const neuT = (cls, x, y, rot = 0, rezept = null, tk = 100) => { const t = { id: 't' + neuId++, cls, x: Math.round(x), y: Math.round(y), rot, rezept, takt: tk, farbe: null }; teile.push(t); return t; };
  const V = (a, ap, b, bp, art) => verb.push({ id: 'v' + neuId++, von: { id: a.id, port: ap }, nach: { id: b.id, port: bp }, art, punkte: [] });
  const portWelt = (t, name) => anschluesse(t).find((q) => q.name === name);
  const fehlt = [];

  // 1) Reihen bauen (zunächst bei x = 0, y = 0), Maße merken
  const reihen = [], ketten = [];
  erg.schritte.forEach((st, i) => {
    const cls = st.gebaeude, T = TYP.get(cls), r = D.rezepte[st.rezept];
    if (!T || !r) { fehlt.push(st.name); return; }
    const einY = T.ein.length ? T.ein.reduce((a, q) => a + q.y, 0) / T.ein.length : -1, rot = einY > 0 ? 180 : 0;
    const n = st.anzahl, tk = Math.round(Math.min(250, Math.max(1, st.takt)));
    const w = T.box[1] - T.box[0];
    const vorher = teile.length;
    // Zuordnung Zutat/Produkt → Anschluss (wie beim Mitrechnen: Reihenfolge des Rezepts, Band/Rohr getrennt)
    const zuord = (liste, ports) => { const frei = { b: ports.filter((q) => q.art === 'b'), r: ports.filter((q) => q.art === 'r') }; return liste.map((z) => ({ item: z.item, port: frei[fl(z.item) ? 'r' : 'b'].shift() })).filter((x) => x.port); };
    const ein = zuord(r.zutaten, T.ein), aus = zuord(r.produkte, T.aus);
    const masch = [];
    for (let j = 0; j < n; j++) {
      const t = neuT(cls, 0, 0, rot, st.rezept, tk);
      const k = gehaeuse(t); t.x += j * w - k[0]; t.y += -k[2];
      masch.push(t);
    }
    const k0 = gehaeuse(masch[0]), oben = k0[2], unten = k0[3];
    const rein = {}, raus = {};
    // Verteiler-Leitungen oben (je Zutat), die erste am nächsten an den Maschinen
    ein.forEach((z, kk) => {
      const art = z.port.art, N = NAMEN.vert[art];
      if (n === 1) { rein[z.item] = { t: masch[0], port: z.port.name, art }; return; }
      const y = oben - 300 - 400 * kk; let vor = null; const kt = { typ: 'vert', art, el: [], masch: [] };
      masch.forEach((m) => {
        const q = portWelt(m, z.port.name), sp = neuT(SPL[art], q.x, y, 0);
        V(sp, N.sued, m, z.port.name, art);
        if (vor) V(vor, N.raus, sp, N.rein, art); else rein[z.item] = { t: sp, port: N.rein, art };
        vor = sp; kt.el.push(sp); kt.masch.push({ m, port: z.port.name });
      });
      ketten.push(kt);
    });
    // Sammel-Leitungen unten (je Produkt)
    aus.forEach((z, kk) => {
      const art = z.port.art, N = NAMEN.samm[art];
      if (n === 1) { raus[z.item] = { t: masch[0], port: z.port.name, art }; return; }
      const y = unten + 300 + 400 * kk; let vor = null; const kt = { typ: 'samm', art, el: [], masch: [] };
      masch.forEach((m) => {
        const q = portWelt(m, z.port.name), mg = neuT(MRG[art], q.x, y, 0);
        V(m, z.port.name, mg, N.nord, art);
        if (vor) V(vor, N.raus, mg, N.rein, art);
        vor = mg; kt.el.push(mg); kt.masch.push({ m, port: z.port.name });
      });
      ketten.push(kt);
      raus[z.item] = { t: vor, port: N.raus, art };
    });
    const eigene = teile.slice(vorher), kk = eigene.map(gehaeuse);
    reihen.push({ i, st, teile: eigene, rein, raus, x0: Math.min(...kk.map((q) => q[0])), x1: Math.max(...kk.map((q) => q[1])), y0: Math.min(...kk.map((q) => q[2])), y1: Math.max(...kk.map((q) => q[3])) });
  });
  const reiheVon = new Map(reihen.map((r) => [r.i, r]));

  // 2) Fächer je Reihe (wie viele Verteiler rechts / Sammler links nötig) → Abstände
  const kanten = erg.kanten.filter((k) => typeof k.von === 'number' && typeof k.nach === 'number' && reiheVon.has(k.von) && reiheVon.has(k.nach));
  const ausN = (r) => Math.max(0, ...Object.keys(r.raus).map((it) => kanten.filter((k) => k.von === r.i && k.item === it).length - 1));
  const einN = (r) => Math.max(0, ...Object.keys(r.rein).map((it) => kanten.filter((k) => k.nach === r.i && k.item === it).length - 1));
  const ebenen = [...new Set(reihen.map((r) => r.st.ebene))].sort((a, b) => a - b);
  let y = 0;
  for (const e of ebenen) {
    const liste = reihen.filter((r) => r.st.ebene === e);
    let x = 0, hoehe = 0;
    liste.forEach((r, k) => {
      if (k) x += 800 + 400 * (ausN(liste[k - 1]) + einN(r));
      else x += 400 * einN(r);
      const dx = x - r.x0, dy = y - r.y0;
      for (const t of r.teile) { t.x += dx; t.y += dy; }
      r.x0 += dx; r.x1 += dx; r.y0 += dy; r.y1 += dy;
      x = r.x1; hoehe = Math.max(hoehe, r.y1 - r.y0);
    });
    y += hoehe + 1600 + 400 * Math.max(0, ...liste.map(ausN));
  }

  // 3) Verbinden: je Item Quelle(n) → Senke(n); bei mehreren Abnehmern Verteiler, bei mehreren Lieferanten Sammler
  const kette = (ende, n, art, sammeln) => {
    // n Plätze an einem Leitungsende: Teile in Richtung des Anschlusses (nach außen) aufreihen
    const q = portWelt(ende.t, ende.port); if (!q || n <= 1) return [ende];
    const N = (sammeln ? NAMEN.samm : NAMEN.vert)[art], cls = (sammeln ? MRG : SPL)[art];
    const rot = sammeln ? rotFuer(-q.nx, -q.ny) : rotFuer(q.nx, q.ny);
    const plaetze = []; let vor = ende;
    for (let m = 0; m < n - 1; m++) {
      // ab dem Wegpunkt vor dem Anschluss (1 m vor dem Gehäuse): eigener Anschluss liegt dann genau gegenüber
      const t = neuT(cls, q.sx + q.nx * (200 + 400 * m), q.sy + q.ny * (200 + 400 * m), rot);
      if (sammeln) { V(t, N.raus, vor.t, vor.port, art); plaetze.push({ t, port: N.nord, art }); vor = { t, port: N.rein }; }
      else { V(vor.t, vor.port, t, N.rein, art); plaetze.push({ t, port: N.sued, art }); vor = { t, port: N.raus }; }
    }
    plaetze.push({ ...vor, art });
    return plaetze;
  };
  const quellen = new Map(), senken = new Map();
  for (const r of reihen) {
    for (const [it, en] of Object.entries(r.raus)) { const ks = kanten.filter((k) => k.von === r.i && k.item === it); if (ks.length) quellen.set(r.i + '|' + it, kette(en, ks.length, en.art, false)); }
    for (const [it, en] of Object.entries(r.rein)) { const ks = kanten.filter((k) => k.nach === r.i && k.item === it); if (ks.length) senken.set(r.i + '|' + it, kette(en, ks.length, en.art, true)); }
  }
  const nimm = new Map();
  const naechster = (map, key) => { const l = map.get(key); if (!l) return null; const i = nimm.get(map === quellen ? 'q' + key : 's' + key) || 0; nimm.set(map === quellen ? 'q' + key : 's' + key, i + 1); return l[i] || null; };
  for (const k of kanten) {
    const a = naechster(quellen, k.von + '|' + k.item), b = naechster(senken, k.nach + '|' + k.item);
    if (a && b) V(a.t, a.port, b.t, b.port, a.art);
  }
  // 4) Ende der Fertigung: Ausgänge ohne Abnehmer → intelligenter Splitter, geradeaus in einen Lagercontainer, Überlauf in den
  //    AWESOME-Schredder (erst läuft der Container voll, dann wird der Rest verwertet). Nur Bänder; ohne Sink-Punkte kein Schredder.
  let lager = 0;
  const hat = (cls) => TYP.has(cls) && vorlageDa(cls);
  for (const r of reihen) for (const [it, en] of Object.entries(r.raus)) {
    if (en.art !== 'b' || kanten.some((k) => k.von === r.i && k.item === it) || !hat('Build_StorageContainerMk1_C')) continue;
    const q = portWelt(en.t, en.port); if (!q) continue;
    const nx = Math.round(q.nx), ny = Math.round(q.ny);
    const cRot = nx > 0 ? 270 : ny > 0 ? 0 : nx < 0 ? 90 : 180; // Container-Eingang (lokal −Y) zeigt zurück zum Splitter
    const mitSink = (D.items[it]?.wert || 0) > 0 && hat('Build_ResourceSink_C') && hat('Build_ConveyorAttachmentSplitterSmart_C');
    if (!mitSink) { const c = neuT('Build_StorageContainerMk1_C', q.sx + nx * 600, q.sy + ny * 600, cRot); V(en.t, en.port, c, 'Input0', 'b'); lager++; continue; }
    const sx = q.sx + nx * 300, sy = q.sy + ny * 300, sRot = rotFuer(nx, ny);
    const sp = neuT('Build_ConveyorAttachmentSplitterSmart_C', sx, sy, sRot);
    sp.regeln = { Output1: ['any'], Output2: ['overflow'], Output3: ['none'] };
    const c = neuT('Build_StorageContainerMk1_C', sx + nx * 1000, sy + ny * 1000, cRot);
    const [dx, dy] = drehe(0, 1, sRot); // Output2 (rechts)
    const sinkRot = dx > 0 ? 90 : dy > 0 ? 180 : dx < 0 ? 270 : 0; // Schredder-Eingang (lokal +Y) zeigt zum Splitter
    const sk = neuT('Build_ResourceSink_C', sx + dx * 1300, sy + dy * 1300, sinkRot);
    V(en.t, en.port, sp, 'Input1', 'b'); V(sp, 'Output1', c, 'Input0', 'b'); V(sp, 'Output2', sk, 'Input0', 'b');
    lager++;
  }
  // 5) Splitter/Merger der Reihen drehen, damit Zubringer und Abnehmer ohne Umweg ankommen
  ketten.forEach(kettenRichten);
  if (pp.name === 'Baukasten-Ziel') ziel = { ...ziel, wahl: { ...erg.wahl }, haken: {} }; else ziel = { item: pl.ziele[0].item, menge: pl.ziele[0].menge, ziele: pl.ziele, vorhanden: pl.vorhanden, wahl: { ...erg.wahl }, modus: pl.modus, alternativen: pl.alternativen, takt: pl.takt, haken: {}, quelle: pp.name };
  planCache = null;
  if (pp.name !== 'Baukasten-Ziel') try { localStorage.removeItem('bs-baukasten-uebergabe'); } catch { /* egal */ }
  sichern(); einpassen();
  // Meldung aus einzeln übersetzbaren Sätzen (Englisch/Französisch/Japanisch)
  const meldung = [tr(`${pp.name === 'Baukasten-Ziel' ? 'Aufgebaut' : 'Aus dem Planer aufgebaut'}: ${erg.schritte.length} Stufen, ${teile.filter((x) => !TYP.get(x.cls).anbau).length} Maschinen, ${verb.length} Verbindungen.`),
    fehlt.length ? tr('Nicht im Baukasten:') + ' ' + fehlt.join(', ') + '.' : '', tr('Offene Eingänge = Rohstoffe von außen.'), lager ? tr(`Am Ende: ${lager}× Lagercontainer (Überlauf → AWESOME-Schredder).`) : ''].filter(Boolean).join(' ');
  verlegeSchrittweise().then(() => { sichern(); zeichne(); toast(meldung, !!fehlt.length); });
}
/** Alle Wege in Häppchen verlegen (die Seite bleibt bedienbar, Fortschritt als Meldung) */
let verlegeLauf = 0;
async function verlegeSchrittweise(nurNoetige = false) {
  const lauf = ++verlegeLauf, byId = new Map(teile.map((t) => [t.id, t])), pv = (r) => { const t = byId.get(r.id); return t && anschluesse(t).find((p) => p.name === r.port); };
  const liste = verb.filter((v) => { if (!nurNoetige || v.wege?.length) return true; const a = pv(v.von), b = pv(v.nach); return a && b && !wegPasst(v, a, b); }), n = liste.length;
  if (!n) return;
  let t0 = performance.now(), letztesSichern = t0;
  for (let i = 0; i < n; i++) {
    if (lauf !== verlegeLauf) return;
    const v = liste[i]; if (!verb.includes(v)) continue;
    if (!kistenCache) kistenCache = teile.map(gehaeuse);
    const a = portVon(v.von), b = portVon(v.nach);
    if (a && b) { const r = v.wege?.length ? wegManuell(a, b, v.wege) : verlege(a, b, v); v.punkte = r.punkte; v.ok = r.ok; }
    if (performance.now() - t0 > 120) {
      if (n > 60) toast(`Bänder und Rohre werden verlegt … ${i + 1} / ${n}`);
      if (performance.now() - letztesSichern > 3000) { sichern(); letztesSichern = performance.now(); } // Zwischenstand, falls die App vorher zugeht
      zeichne(); kistenCache = null; await new Promise((r) => setTimeout(r, 0)); t0 = performance.now();
    }
  }
  kistenCache = null;
}

/** Fehlende Maschinen einer Stufe als Reihe rechts neben das Vorhandene setzen (gleiche Richtung, 1 m Abstand) */
function reiheSetzen(rezept, n) {
  const r = D.rezepte[rezept], cls = r?.gebaeude?.find((c) => TYP.has(c)); if (!cls) return;
  const T = TYP.get(cls), bw = T.box[1] - T.box[0];
  merke();
  let x0 = 0, y0 = 0;
  if (teile.length) { const k = teile.map(gehaeuse); x0 = Math.max(...k.map((q) => q[1])) + 800; y0 = Math.min(...k.map((q) => q[2])); }
  for (let i = 0; i < n; i++) {
    const t = { id: 't' + neuId++, cls, x: x0 - T.box[0] + i * (bw + 100), y: y0 - T.box[2], rot: 0, rezept, takt: 100, farbe: null };
    einrasten(t); teile.push(t);
  }
  sichern(); einpassen();
  toast(`${n} × ${T.name} („${r.name}“) gesetzt – jetzt verbinden.`);
}

// ------------------------------------------------------------------ Bedienung
function setzeWerkzeug(w) {
  werkzeug = w; start = null;
  for (const [id, n] of [['w-waehlen', 'waehlen'], ['w-verbinden', 'verbinden'], ['w-faerben', 'faerben'], ['w-rechteck', 'rechteck'], ['w-stift', 'stift']]) $(id).classList.toggle('an', w === n);
  cv.style.cursor = w === 'verbinden' || w === 'rechteck' || w === 'stift' ? 'crosshair' : w === 'faerben' ? 'cell' : 'default';
  zeichne();
}
function loeschen() {
  if (mehr.length > 1 || mehrV.length) {
    merke(); const ids = new Set(mehr.map((t) => t.id)), n = mehr.length, nv = mehrV.length;
    teile = teile.filter((t) => !ids.has(t.id)); verb = verb.filter((v) => !ids.has(v.von.id) && !ids.has(v.nach.id) && !mehrV.includes(v));
    wahl = null; mehr = []; mehrV = []; sichern(); zeichne(); toast(`${n} Teil(e)${nv ? ` und ${nv} Band/Rohr` : ''} entfernt (Rückgängig: Strg+Z).`); return;
  }
  if (!wahl) return; merke();
  if (istTeil(wahl)) { teile = teile.filter((t) => t !== wahl); verb = verb.filter((v) => v.von.id !== wahl.id && v.nach.id !== wahl.id); }
  else verb = verb.filter((v) => v !== wahl);
  wahl = null; sichern(); zeichne();
}
function drehen() {
  if (mehr.length > 1) {
    // Gruppe um ihre Mitte drehen (90° im Uhrzeigersinn)
    merke(); const k = mehr.map(gehaeuse), cx = Math.round((Math.min(...k.map((q) => q[0])) + Math.max(...k.map((q) => q[1]))) / 2 / 50) * 50, cy = Math.round((Math.min(...k.map((q) => q[2])) + Math.max(...k.map((q) => q[3]))) / 2 / 50) * 50;
    for (const t of mehr) { const [dx, dy] = drehe(t.x - cx, t.y - cy, 90); t.x = cx + dx; t.y = cy + dy; t.rot = (t.rot + 90) % 360; }
    const gids = new Set(mehr.map((t) => t.id));
    for (const v of verb) if (v.wege && gids.has(v.von.id) && gids.has(v.nach.id)) v.wege = v.wege.map(([x, y]) => { const [dx, dy] = drehe(x - cx, y - cy, 90); return [cx + dx, cy + dy]; });
    neuVerlegen(); sichern(); zeichne(); return;
  }
  if (!istTeil(wahl)) return; merke(); wahl.rot = (wahl.rot + 90) % 360; einrasten(wahl); neuVerlegen(wahl); sichern(); zeichne();
}
/** Duplizieren: ein Teil oder die ganze Auswahl – samt Bändern/Rohren zwischen den gewählten Teilen – rechts daneben */
function duplizieren() {
  const gruppe = mehr.length > 1 ? mehr : istTeil(wahl) ? [wahl] : [];
  if (!gruppe.length) return; merke();
  const k = gruppe.map(gehaeuse), breite = Math.max(...k.map((q) => q[1])) - Math.min(...k.map((q) => q[0]));
  const versatz = Math.ceil((breite + 100) / RASTER) * RASTER, neu = new Map();
  for (const t of gruppe) { const c = { ...t, id: 't' + neuId++, x: t.x + versatz }; if (t.regeln) c.regeln = JSON.parse(JSON.stringify(t.regeln)); neu.set(t.id, c); teile.push(c); }
  for (const v of [...verb]) if (neu.has(v.von.id) && neu.has(v.nach.id)) verb.push({ ...v, id: 'v' + neuId++, von: { ...v.von, id: neu.get(v.von.id).id }, nach: { ...v.nach, id: neu.get(v.nach.id).id }, punkte: [], ...(v.wege ? { wege: v.wege.map(([x, y]) => [x + versatz, y]) } : {}) });
  const ids = new Set([...neu.values()].map((t) => t.id));
  for (const v of verb) if (ids.has(v.von.id)) { const a = portVon(v.von), b = portVon(v.nach); if (a && b) { const r = verlege(a, b, v); v.punkte = r.punkte; v.ok = r.ok; } }
  mehr = [...neu.values()]; wahl = mehr[0]; feldFuer = null; sichern(); zeichne();
  if (gruppe.length > 1) toast(`${gruppe.length} Teile dupliziert${verb.length ? ' (mit ihren Verbindungen)' : ''}.`);
}
/**
 * Einrasten: Gehäusekante aufs 1-m-Raster, dann „magnetisch“ an Anschlüsse anderer Teile: liegt ein eigener Anschluss bis 1,5 m
 * neben einem gegenüberliegenden Anschluss (gleiche Art, zueinander zeigend), wird genau auf dessen Linie geschoben –
 * so sitzen Splitter/Merger exakt über Ein- und Ausgängen, auch auf halben Metern.
 */
function einrasten(t, ohne = null) {
  const k = gehaeuse(t); t.x = Math.round(t.x + (Math.round(k[0] / RASTER) * RASTER - k[0])); t.y = Math.round(t.y + (Math.round(k[2] / RASTER) * RASTER - k[2]));
  const eigene = anschluesse(t); if (!eigene.length) return;
  let bx = null, by = null;
  for (const o of teile) {
    if (o === t || ohne?.has(o) || istVorlage(o)) continue;
    for (const q of anschluesse(o)) for (const p of eigene) {
      if (p.art !== q.art) continue;
      const dx = q.x - p.x, dy = q.y - p.y;
      if (p.ny && q.ny === -p.ny && dy * p.ny > 0 && Math.abs(dx) <= 150 && Math.abs(dy) < 3000) { if (!bx || Math.abs(dy) < bx.d) bx = { v: dx, d: Math.abs(dy) }; }
      if (p.nx && q.nx === -p.nx && dx * p.nx > 0 && Math.abs(dy) <= 150 && Math.abs(dx) < 3000) { if (!by || Math.abs(dx) < by.d) by = { v: dy, d: Math.abs(dx) }; }
    }
  }
  if (bx) t.x = Math.round(t.x + bx.v);
  if (by) t.y = Math.round(t.y + by.v);
}
let einpassenOffen = false; // Reißbrett war beim Einpassen unsichtbar (Reiter noch nicht offen) → beim Sichtbarwerden nachholen
function einpassen() {
  if (!teile.length) { ansicht = { x: 0, y: 0, s: 0.12 }; zeichne(); return; }
  if (!cv.clientWidth || !cv.clientHeight) { einpassenOffen = true; return; }
  einpassenOffen = false;
  const k = teile.map(gehaeuse), x0 = Math.min(...k.map((q) => q[0])), x1 = Math.max(...k.map((q) => q[1])), y0 = Math.min(...k.map((q) => q[2])), y1 = Math.max(...k.map((q) => q[3]));
  ansicht = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, s: Math.min(0.6, 0.85 * Math.min(cv.clientWidth / (x1 - x0 + 800), cv.clientHeight / (y1 - y0 + 800))) };
  sichern(); zeichne();
}
/** Liegt beim Öffnen etwas außerhalb des Bildes, einpassen */
function allesImBild() {
  if (!teile.length || !cv.clientWidth) return true;
  const k = teile.map(gehaeuse), [ax, ay] = zuBild(Math.min(...k.map((q) => q[0])), Math.min(...k.map((q) => q[2]))), [bx, by] = zuBild(Math.max(...k.map((q) => q[1])), Math.max(...k.map((q) => q[3])));
  return ax >= -5 && ay >= -5 && bx <= cv.clientWidth + 5 && by <= cv.clientHeight + 5;
}
function faerbe(ziel2) { if (!ziel2) return false; ziel2.farbe = farbe || null; return true; }

cv.addEventListener('mousedown', (e) => {
  const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  $('farbwahl').style.display = 'none';
  if (e.button !== 0) { zug = { art: 'schieben', px, py, x: ansicht.x, y: ansicht.y }; return; }
  if (werkzeug === 'rechteck' || werkzeug === 'stift') {
    const th = teilUnter(px, py);
    if (th && mehr.includes(th)) { greifen(th, px, py); return; } // in der Markierung: alles verschieben
    const dazu = e.shiftKey || e.ctrlKey || e.metaKey;
    zug = werkzeug === 'rechteck' ? { art: 'rahmen', zweck: 'auswahl', px, py, dazu } : { art: 'lasso', pts: [[px, py]], dazu };
    return;
  }
  if (werkzeug === 'faerben') {
    const t = teilUnter(px, py), v = !t || istVorlage(t) ? verbUnter(px, py) : null;
    if (v || (t && !istVorlage(t))) { merke(); faerbe(v || t); sichern(); zeichne(); return; }
    zug = { art: 'rahmen', px, py }; return;
  }
  let p = portUnter(px, py);
  // Im Auswählen-Werkzeug: Klick näher an der Mitte eines Teils als am Anschluss = Teil wählen (kleine Splitter/Merger)
  if (p && werkzeug !== 'verbinden' && !start) {
    const th = teilUnter(px, py);
    if (th && !istVorlage(th)) { const [cx, cy] = zuBild(th.x, th.y), [qx, qy] = zuBild(p.x, p.y); if (Math.hypot(px - cx, py - cy) < Math.hypot(px - qx, py - qy)) p = null; }
  }
  if (e.shiftKey && werkzeug === 'waehlen') { zug = { art: 'rahmen', zweck: 'auswahl', px, py, dazu: e.ctrlKey || e.metaKey }; return; }
  if (werkzeug === 'verbinden' || (p && !belegt(p.teil, p.name))) {
    if (p) {
      if (!start) { if (belegt(p.teil, p.name)) { toast('Dieser Anschluss ist schon verbunden.', true); return; } setzeWerkzeug('verbinden'); start = { port: p, wege: [] }; zeichne(); return; }
      if (verbinde(start.port, p, start.wege)) { start = null; sichern(); zeichne(); return; }
      toast(start.port.art !== p.art ? 'Band und Rohr lassen sich nicht verbinden.' : start.port.teil === p.teil ? 'Nicht mit demselben Teil verbinden.' : 'Bänder laufen von einem Ausgang (orange) zu einem Eingang (blau).', true);
      return;
    }
    // Klick ins Leere bei begonnener Verbindung: Wegpunkt setzen (eigene Linie ziehen)
    if (werkzeug === 'verbinden' && start) { start.wege.push(wegpunkt(...zuWelt(px, py))); zeichne(); return; }
    if (werkzeug === 'verbinden') { start = null; zeichne(); }
  }
  const t = teilUnter(px, py);
  if (t && (e.ctrlKey || e.metaKey)) { mehr = mehr.includes(t) ? mehr.filter((x) => x !== t) : [...(mehr.length ? mehr : istTeil(wahl) ? [wahl] : []), t]; wahl = mehr[mehr.length - 1] || null; feldFuer = null; zeichne(); return; }
  if (t) {
    if (!mehr.includes(t)) { mehr = [t]; mehrV = []; }
    greifen(t, px, py); return;
  }
  const v = verbUnter(px, py);
  if (v) { wahl = v; mehr = []; mehrV = []; bandKlick = [px, py]; feldFuer = null; zeichne(); return; }
  wahl = null; mehr = []; mehrV = []; zug = { art: 'schieben', px, py, x: ansicht.x, y: ansicht.y }; zeichne();
});
/** Teil (und ggf. die ganze Markierung) mit der Maus greifen */
function greifen(t, px, py) {
  {
    wahl = t; const [mx, my] = zuWelt(px, py);
    const gids = new Set(mehr.map((o) => o.id));
    zug = { art: 'teil', t, dx: mx - t.x, dy: my - t.y, bewegt: false, gruppe: mehr.length > 1 ? mehr.map((o) => ({ o, x: o.x, y: o.y })) : null,
      wege: mehr.length > 1 ? verb.filter((v) => v.wege && gids.has(v.von.id) && gids.has(v.nach.id)).map((v) => ({ v, w: v.wege.map((q) => [...q]) })) : [] };
    feldFuer = null; zeichne();
  }
}
addEventListener('mousemove', (e) => {
  const r = cv.getBoundingClientRect(); maus.x = e.clientX - r.left; maus.y = e.clientY - r.top; [maus.wx, maus.wy] = zuWelt(maus.x, maus.y);
  if (zug?.art === 'schieben') { ansicht.x = zug.x - (maus.x - zug.px) / ansicht.s; ansicht.y = zug.y - (maus.y - zug.py) / ansicht.s; zeichne(); return; }
  if (zug?.art === 'rahmen') { zeichne(); return; }
  if (zug?.art === 'lasso') { const l = zug.pts[zug.pts.length - 1]; if (Math.hypot(maus.x - l[0], maus.y - l[1]) >= 3) { zug.pts.push([maus.x, maus.y]); zeichne(); } return; }
  if (zug?.art === 'palette') {
    // aus der Leiste gezogen: sobald die Maus über dem Reißbrett ist, entsteht das Teil und hängt an der Maus
    const imBrett = maus.x >= 0 && maus.y >= 0 && maus.x <= cv.clientWidth && maus.y <= cv.clientHeight;
    if (!imBrett) return;
    merke();
    const t = { id: 't' + neuId++, cls: zug.cls, x: Math.round(maus.wx), y: Math.round(maus.wy), rot: zug.rot || 0, rezept: null, takt: 100, farbe: null };
    einrasten(t); teile.push(t); wahl = t; mehr = [t]; setzeWerkzeug('waehlen');
    zug = { art: 'teil', t, dx: 0, dy: 0, bewegt: true, neu: true };
    zeichne(); return;
  }
  if (zug?.art === 'teil') {
    if (!zug.bewegt) { if (Math.hypot(maus.wx - zug.dx - zug.t.x, maus.wy - zug.dy - zug.t.y) * ansicht.s < 3) return; merke(); zug.bewegt = true; }
    const t = zug.t, x0 = zug.gruppe ? zug.gruppe.find((q) => q.o === t).x : 0, y0 = zug.gruppe ? zug.gruppe.find((q) => q.o === t).y : 0;
    t.x = maus.wx - zug.dx; t.y = maus.wy - zug.dy;
    if (zug.gruppe) {
      einrasten(t, new Set(zug.gruppe.map((q) => q.o)));
      const ddx = t.x - x0, ddy = t.y - y0;
      for (const q of zug.gruppe) if (q.o !== t) { q.o.x = q.x + ddx; q.o.y = q.y + ddy; }
      for (const q of zug.wege) q.v.wege = q.w.map(([x, y]) => [x + ddx, y + ddy]);
      const ids = new Set(zug.gruppe.map((q) => q.o.id));
      for (const v of verb) if (ids.has(v.von.id) || ids.has(v.nach.id)) { const a = portVon(v.von), b = portVon(v.nach); if (a && b) { const r = verlege(a, b, v); v.punkte = r.punkte; v.ok = r.ok; } }
    } else { einrasten(t); neuVerlegen(t); }
    zeichne(); return;
  }
  const p = e.target === cv && werkzeug !== 'faerben' ? portUnter(maus.x, maus.y) : null, tp = $('tipp');
  if (p) {
    const z = rechnung.zuteilung.get(`${p.teil.id}:${p.name}`), st = rechnung.stand.get(`${p.teil.id}:${p.name}`);
    tp.innerHTML = `${tr(`${p.art === 'r' ? 'Rohr' : 'Band'}-${p.ein ? 'Eingang' : 'Ausgang'}`)}${z ? ` · ${esc(D.items[z.item]?.name || z.item)} ${zahl(z.menge)}/min` : ''}${st && st.st !== 'frei' ? ` · ${tr(st.st === 'ok' ? 'versorgt' : st.st === 'extern' ? 'von außen' : st.st === 'knapp' ? 'zu wenig' : st.st === 'falsch' ? 'falsches Item' : 'leer')}` : ''}${belegt(p.teil, p.name) ? ' · ' + tr('verbunden') : ''}`;
    tp.style.display = 'block'; tp.style.left = maus.x + 14 + 'px'; tp.style.top = maus.y + 10 + 'px';
  } else tp.style.display = 'none';
  if (start) zeichne();
});
addEventListener('mouseup', () => {
  document.body.classList.remove('zieht');
  if (zug?.art === 'palette') { zug = null; return; }
  if (zug?.neu) {
    const imBrett = maus.x >= 0 && maus.y >= 0 && maus.x <= cv.clientWidth && maus.y <= cv.clientHeight;
    if (!imBrett) { teile = teile.filter((x) => x !== zug.t); verlauf.pop(); wahl = null; mehr = []; }
    sichern(); zug = null; zeichne(); return;
  }
  if ((zug?.art === 'rahmen' && zug.zweck === 'auswahl') || zug?.art === 'lasso') {
    // Prüffunktion in Bildschirm-Koordinaten: Rechteck oder frei gezeichneter Umriss
    let innen;
    if (zug.art === 'rahmen') { const x0 = Math.min(zug.px, maus.x), x1 = Math.max(zug.px, maus.x), y0 = Math.min(zug.py, maus.y), y1 = Math.max(zug.py, maus.y); innen = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1; }
    else { const P = zug.pts; innen = (x, y) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; }; }
    const klein = zug.art === 'rahmen' ? Math.abs(maus.x - zug.px) < 4 && Math.abs(maus.y - zug.py) < 4 : zug.pts.length < 3;
    if (!klein) {
      const drinT = teile.filter((t) => { const k = gehaeuse(t), [ax, ay] = zuBild(k[0], k[2]), [bx, by] = zuBild(k[1], k[3]); return innen((ax + bx) / 2, (ay + by) / 2) || (zug.art === 'rahmen' && innen(ax, ay) && innen(bx, by)); });
      const drinV = verb.filter((v) => { const pts = v.punkte.map(([x, y]) => zuBild(x, y)); for (let i = 1; i < pts.length; i++) { const n = Math.max(1, Math.ceil(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) / 8)); for (let k = 0; k <= n; k++) if (innen(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k / n, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k / n)) return true; } return false; });
      mehr = zug.dazu ? [...new Set([...mehr, ...drinT])] : drinT; mehrV = zug.dazu ? [...new Set([...mehrV, ...drinV])] : drinV;
      wahl = mehr[0] || mehrV[0] || null; feldFuer = null;
      if (mehr.length + mehrV.length) toast(`${mehr.length} Teil(e)${mehrV.length ? ` und ${mehrV.length} Band/Rohr` : ''} markiert – Entf entfernt, ziehen verschiebt, Strg+D dupliziert, R dreht.`);
    } else { mehr = []; mehrV = []; wahl = null; }
    zug = null; zeichne(); return;
  }
  if (zug?.art === 'rahmen') {
    const [ax, ay] = zuWelt(Math.min(zug.px, maus.x), Math.min(zug.py, maus.y)), [bx, by] = zuWelt(Math.max(zug.px, maus.x), Math.max(zug.py, maus.y));
    if (Math.abs(maus.x - zug.px) > 4) {
      const drin = teile.filter((t) => { if (istVorlage(t)) return false; const k = gehaeuse(t); return k[0] < bx && k[1] > ax && k[2] < by && k[3] > ay; });
      const vs = verb.filter((v) => v.punkte.some(([x, y]) => x >= ax && x <= bx && y >= ay && y <= by));
      if (drin.length || vs.length) { merke(); drin.forEach(faerbe); vs.forEach(faerbe); sichern(); toast(`${drin.length} Teil(e) und ${vs.length} Leitung(en) eingefärbt.`); }
    }
    zug = null; zeichne(); return;
  }
  if (zug?.art === 'teil' && zug.bewegt) { sichern(); zug = null; zeichne(); return; }
  zug = null;
});
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  // Teil gerade gegriffen (Maustaste gedrückt): Mausrad dreht statt zu zoomen
  if (zug?.art === 'teil' && !zug.gruppe) {
    const t = zug.t, d = e.deltaY > 0 ? 90 : 270;
    if (!zug.bewegt) { merke(); zug.bewegt = true; }
    t.rot = (t.rot + d) % 360; [zug.dx, zug.dy] = drehe(zug.dx, zug.dy, d);
    t.x = maus.wx - zug.dx; t.y = maus.wy - zug.dy; einrasten(t); neuVerlegen(t); feldFuer = null; zeichne(); return;
  }
  if (zug?.art === 'palette') { zug.rot = ((zug.rot || 0) + (e.deltaY > 0 ? 90 : 270)) % 360; return; }
  const [wx, wy] = zuWelt(maus.x, maus.y), f = Math.exp(-e.deltaY * 0.0015);
  ansicht.s = Math.min(1.5, Math.max(0.005, ansicht.s * f));
  ansicht.x = wx - (maus.x - cv.clientWidth / 2) / ansicht.s; ansicht.y = wy - (maus.y - cv.clientHeight / 2) / ansicht.s; zeichne();
}, { passive: false });
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('dragover', (e) => e.preventDefault());
cv.addEventListener('drop', (e) => {
  e.preventDefault(); const cls = e.dataTransfer.getData('text/plain'); if (!TYP.has(cls)) return;
  const r = cv.getBoundingClientRect(), [wx, wy] = zuWelt(e.clientX - r.left, e.clientY - r.top);
  merke(); const t = { id: 't' + neuId++, cls, x: Math.round(wx), y: Math.round(wy), rot: 0, rezept: null, takt: 100, farbe: null };
  einrasten(t); teile.push(t); wahl = t; setzeWerkzeug('waehlen'); sichern(); zeichne();
});
addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, dialog')) return;
  if (e.key === 'Backspace' && start?.wege?.length) { start.wege.pop(); zeichne(); e.preventDefault(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { loeschen(); e.preventDefault(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') rueck();
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { duplizieren(); e.preventDefault(); }
  else if (e.key === 'r' || e.key === 'R') drehen();
  else if (e.key === 'v' || e.key === 'V') setzeWerkzeug('waehlen');
  else if (e.key === 'c' || e.key === 'C') setzeWerkzeug('verbinden');
  else if (e.key === 'f' || e.key === 'F') setzeWerkzeug('faerben');
  else if (e.key === 'm' || e.key === 'M') setzeWerkzeug('rechteck');
  else if (e.key === 'l' || e.key === 'L') setzeWerkzeug('stift');
  else if (e.key === 'Escape') { start = null; wahl = null; mehr = []; mehrV = []; setzeWerkzeug('waehlen'); }
});
function rueck() { const s = verlauf.pop(); if (!s) return; ({ teile, verb } = JSON.parse(s)); wahl = null; mehr = []; mehrV = []; start = null; sichern(); zeichne(); }
$('w-waehlen').onclick = () => setzeWerkzeug('waehlen');
$('w-verbinden').onclick = () => setzeWerkzeug('verbinden');
$('w-faerben').onclick = () => setzeWerkzeug('faerben');
$('w-rechteck').onclick = () => setzeWerkzeug('rechteck');
$('w-stift').onclick = () => setzeWerkzeug('stift');
$('b-drehen').onclick = drehen; $('b-kopie').onclick = duplizieren; $('b-loeschen').onclick = loeschen; $('b-auto').onclick = autoVerbinden; $('b-rueck').onclick = rueck; $('b-einpassen').onclick = einpassen;
$('s-bandmax').onchange = () => { sichern(); zeichne(); };
$('c-fluss').onchange = () => zeichne();
$('b-neu').onclick = () => { if (teile.length && !confirm(tr('Reißbrett leeren?'))) return; merke(); teile = []; verb = []; wahl = null; mehr = []; mehrV = []; sichern(); zeichne(); };
addEventListener('resize', () => { if (einpassenOffen && cv.clientWidth) einpassen(); else zeichne(); });
// Farbwahl (Werkzeugleiste)
function farbknopf() { const f = farbInfo(farbe) || { name: 'wie Vorlage', prim: '#777', sek: '#555' }; const b = $('b-farbe'); b.querySelector('i').style.cssText = `--p:${f.prim};--s:${f.sek}`; b.querySelector('span').textContent = f.name; }
$('b-farbe').onclick = (e) => {
  const p = $('farbwahl'), r = e.currentTarget.getBoundingClientRect();
  if (p.style.display === 'block') { p.style.display = 'none'; return; }
  p.innerHTML = '<b>Farbmuster</b><div class="muted" style="margin:2px 0 8px;font-size:11px">Plätze wie im Spiel (Farben aus deinem neuesten Spielstand). Werkzeug „Einfärben“: anklicken oder Rahmen aufziehen.</div>' + farbRaster(farbe, 'p-farben');
  p.style.left = Math.min(innerWidth - 310, r.left) + 'px'; p.style.top = r.bottom + 6 + 'px'; p.style.display = 'block';
  $('p-farben').onclick = (ev) => { const b = ev.target.closest('[data-sw]'); if (!b) return; farbe = b.dataset.sw || null; farbknopf(); sichern(); p.style.display = 'none'; setzeWerkzeug('faerben'); };
};

// ------------------------------------------------------------------ Linke Leiste: Gebäude / Vorlagen
const GRUPPEN = [['fertigung', 'Fertigung'], ['logistik', 'Splitter, Merger & Kreuzung'], ['lager', 'Lager & Puffer'], ['strom', 'Strom'], ['sonst', 'Sonstiges']];
function paletteZeigen() {
  const el = $('palette');
  $('r-gebaeude').classList.toggle('an', reiter === 'gebaeude'); $('r-vorlagen').classList.toggle('an', reiter === 'vorlagen');
  if (reiter === 'gebaeude') {
    el.innerHTML = GRUPPEN.map(([gr, titel]) => {
      const liste = D.teile.filter((t) => t.gruppe === gr); if (!liste.length) return '';
      return `<div class="kopf">${titel}</div><div class="palette">${liste.map((t) => `<div class="pal" draggable="true" data-cls="${t.cls}" title="${esc(t.name)} – ins Reißbrett ziehen">${t.icon ? `<img src="icons/${encodeURIComponent(t.icon)}" alt="">` : '<span class="platz">▦</span>'}<span>${esc(t.name)}<small>${zahl((t.box[1] - t.box[0]) / 100)} × ${zahl((t.box[3] - t.box[2]) / 100)} m${t.anbau ? '' : t.ein.length + t.aus.length ? ` · ${t.ein.length} ein / ${t.aus.length} aus` : ''}</small></span></div>`).join('')}</div>`;
    }).join('');
  } else {
    const liste = [...VORL.values()];
    el.innerHTML = `<div class="kopf">Master Class (eine Ebene)</div><div class="palette">${liste.length ? liste.map((v) => {
      const aus = Object.keys(v.aus || {}).map((it) => D.items[it]?.name || it).slice(0, 2).join(', ');
      const ikon = Object.keys(v.aus || {}).map((it) => D.items[it]?.icon).find(Boolean);
      return `<div class="pal${v.ok ? '' : ' aus'}" ${v.ok ? 'draggable="true"' : ''} data-cls="#v:${v.id}" title="${esc(v.name)}${v.ok ? ' – ins Reißbrett ziehen' : ' – ' + esc(v.grund) + ', im Baukasten nur eine Ebene'}">${ikon ? `<img src="icons/${encodeURIComponent(ikon)}" alt="">` : '<span class="platz">▦</span>'}<span>${esc(v.name)}<small>${v.ok ? `${zahl((v.box[1] - v.box[0]) / 100, 0)} × ${zahl((v.box[3] - v.box[2]) / 100, 0)} m${aus ? ' · ' + esc(aus) : ''}` : esc(v.grund)}</small></span></div>`;
    }).join('') : '<p class="muted" style="padding:0 4px">Keine Master-Class-Vorlagen gefunden. Sie kommen aus der Haupt-App (Planer → Master Class einlesen).</p>'}</div>`;
  }
  // Ziehen mit der Maus (statt Drag & Drop des Browsers), damit das Mausrad dabei drehen kann
  for (const p of el.querySelectorAll('.pal[draggable=true]')) {
    p.removeAttribute('draggable');
    p.addEventListener('mousedown', (e) => { if (e.button !== 0) return; e.preventDefault(); zug = { art: 'palette', cls: p.dataset.cls, rot: 0 }; document.body.classList.add('zieht'); });
  }
}
$('r-gebaeude').onclick = () => { reiter = 'gebaeude'; paletteZeigen(); };
$('r-vorlagen').onclick = () => { reiter = 'vorlagen'; paletteZeigen(); };

// ------------------------------------------------------------------ Speichern als Blaupause
if (EINGEBETTET) { document.body.classList.add('eingebettet'); } else profilKnopf($('b-profile'), { vonWo: 'baukasten' });
$('b-app').onclick = () => { location.href = '/#planer'; };
// Idee speichern: Dialog der Profile (in der Haupt-App bzw. hier, wenn der Baukasten allein offen ist)
$('b-idee').onclick = () => { sichern(); try { if (EINGEBETTET && window.top.bsIdeeSpeichern) { window.top.bsIdeeSpeichern(); return; } } catch { /* andere Herkunft */ } profileOeffnen({ neueIdee: true }); };
$('b-speichern').onclick = async () => {
  if (!teile.length) { toast('Das Reißbrett ist leer.', true); return; }
  const offen = verb.filter((v) => v.ok === false).length;
  if (offen && !confirm(tr(`${offen} Verbindung(en) haben keinen freien Weg (rot). Trotzdem speichern?`))) return;
  const sel = $('d-sitzung');
  try { const s = await (await fetch('/api/sessions')).json(); sel.innerHTML = s.filter((x) => !x.lib).map((x) => `<option value="${esc(x.name)}">${esc(x.label)}</option>`).join(''); } catch { /* leer */ }
  if (!sel.options.length) { toast('Kein Spielstand-Ordner für Blaupausen gefunden.', true); return; }
  try { const v = localStorage.getItem('bs-baukasten-sitzung'); if (v && [...sel.options].some((o) => o.value === v)) sel.value = v; } catch { /* egal */ }
  $('d-beschreibung').value = beschreibungText();
  $('d-speichern').showModal();
};
$('d-abbrechen').onclick = () => $('d-speichern').close();
$('d-ok').onclick = async (e) => {
  e.preventDefault();
  const name = $('d-name').value.trim(), session = $('d-sitzung').value;
  if (!name) return;
  const b = $('d-ok'); b.disabled = true; b.textContent = 'Wird gebaut …';
  try {
    rechne();
    const body = { session, name, strom: $('d-strom').checked, beschreibung: $('d-beschreibung').value.trim(),
      teile: teile.filter((t) => !istVorlage(t)).map(({ id, cls, x, y, rot, rezept, farbe: f, regeln }) => ({ id, cls, x, y, rot, rezept, farbe: f || undefined, regeln: mitRegeln(cls) ? regeln || standardRegeln() : undefined })),
      bloecke: teile.filter(istVorlage).map((t) => ({ id: t.cls.slice(3), x: t.x, y: t.y, rot: t.rot })),
      verbindungen: verb.map((v) => ({ von: v.von, nach: v.nach, art: v.art, punkte: v.punkte, mk: v.mk, farbe: v.farbe || undefined })) };
    const r = await fetch('/api/baukasten/blaupause', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' }, body: JSON.stringify(body) });
    const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status);
    try { localStorage.setItem('bs-baukasten-sitzung', session); } catch { /* egal */ }
    $('d-speichern').close();
    const i = j.info;
    const stueck = [`${i.maschinen} Gebäude`, `${i.anbau} Splitter/Merger/Kreuzungen`, `${i.baender} Bänder`, `${i.rohre} Rohre`, `${i.masten} Strommasten`, `${i.fundamente} Fundamente`, ...(i.vorlagen ? [`${i.vorlagen} Vorlage(n)`] : [])].map((x) => tr(x));
    toast(`${tr(`„${name}“ gespeichert:`)} ${stueck.join(', ')} (${i.groesse[0]} × ${i.groesse[1]} m).${i.warnungen?.length ? ' ' + tr('Hinweis:') + ' ' + i.warnungen.map((w) => tr(w)).join(' ') : ''}`, !!i.warnungen?.length);
  } catch (err) { toast('Speichern fehlgeschlagen: ' + err.message, true); }
  finally { b.disabled = false; b.textContent = 'Speichern'; }
};

// ------------------------------------------------------------------ Start
(async () => {
  // Sprache der App (Englisch, Französisch, Japanisch: Oberfläche wird übersetzt)
  try { const c = await (await fetch('/api/config')).json(); await i18nStart(c.sprache); } catch { /* deutsch */ }
  try { const r = await fetch('/api/baukasten/daten'); D = await r.json(); if (!r.ok) throw new Error(D.fehler || r.status); }
  catch (e) { $('info').innerHTML = `<p class="err">Daten nicht verfügbar: ${esc(e.message)}</p>`; return; }
  for (const t of D.teile) TYP.set(t.cls, t);
  try {
    const s = JSON.parse(localStorage.getItem(SPEICHER_KEY) || 'null');
    if (s?.teile) {
      teile = s.teile; verb = s.verb || []; ansicht = s.ansicht || ansicht; if (s.bandMax) $('s-bandmax').value = s.bandMax;
      if (s.ziel) ziel = { item: '', menge: 10, wahl: {}, haken: {}, ...s.ziel };
      if ('farbe' in s) farbe = s.farbe;
      // ältere Stände: Splitter-Nordausgang hieß im Baukasten „Output0“ (im Spiel Output3)
      for (const v of verb) for (const e of [v.von, v.nach]) { const t = teile.find((x) => x.id === e.id); if (t && /Splitter/.test(t.cls) && e.port === 'Output0') e.port = 'Output3'; }
      neuId = 1 + Math.max(0, ...[...teile, ...verb].map((x) => parseInt(String(x.id).slice(1), 10) || 0));
    }
  } catch { /* neu */ }
  farbknopf();
  // Vorlagen (Master Class) – Typen für die Blöcke
  try {
    for (const v of await (await fetch('/api/baukasten/vorlagen')).json()) {
      VORL.set(v.id, v);
      TYP.set('#v:' + v.id, { cls: '#v:' + v.id, block: true, name: v.name, box: v.box || [-400, 400, -400, 400], ein: [], aus: [], rezepte: [], anbau: false, gruppe: 'vorlage' });
    }
  } catch { /* ohne Vorlagen */ }
  teile = teile.filter((t) => TYP.has(t.cls));
  { const ids = new Set(teile.map((t) => t.id)); verb = verb.filter((v) => ids.has(v.von.id) && ids.has(v.nach.id)); }
  paletteZeigen();
  if (!allesImBild() || !cv.clientWidth) einpassen(); else zeichne();
  // Wege, die noch fehlen oder nicht mehr an den Anschlüssen liegen, schrittweise nachlegen (gespeicherte Wege bleiben)
  verlegeSchrittweise(true).then(() => { sichern(); zeichne(); });
  // Welche Bauteile es als Vorlage aus den eigenen Blaupausen gibt (sonst lässt sich nicht speichern) – im Hintergrund
  const vorlagenDa = fetch('/api/baukasten/vorlagen-da').then((r) => r.json()).then((j) => { if (Array.isArray(j.da)) { VORLAGE_DA = new Set(j.da); feldFuer = null; paletteZeigen(); zeichne(); } }).catch(() => {});
  // Farbplätze aus dem neuesten Spielstand (im Hintergrund)
  fetch('/api/baukasten/farben').then((r) => r.json()).then((c) => { if (c?.slots?.length) { SLOTS = c.slots.slice(0, 18); while (SLOTS.length < 18) SLOTS.push({ prim: '#777', sek: '#555' }); getoent.clear(); farbknopf(); feldFuer = null; zeichne(); } }).catch(() => {});
  if (ds) ds.laden().then((ok) => { modelleDa = ok; if (!ok) $('hinweis').textContent = 'Ohne Spielmodelle: einmal in der App „Modelle aus dem Spiel holen“ ausführen, dann erscheinen die Gebäude wie im Spiel.'; zeichne(); });
  // aus dem Planer geöffnet („Im Baukasten aufbauen“): Plan übernehmen und Reihen setzen
  if (new URLSearchParams(location.search).has('planer')) {
    history.replaceState(null, '', location.pathname);
    await Promise.race([vorlagenDa, new Promise((r) => setTimeout(r, 20000))]); // erst wissen, was sich speichern lässt
    const pp = planerPlan(); if (pp) ausPlanerAufbauen(pp); else toast('Im Planer ist kein Ziel festgelegt.', true);
  }
  // Animation der Items: ~30 Bilder/s; dauert ein Bild lange (große Fabrik), entsprechend seltener
  let pause = 33;
  const lauf = () => {
    if (document.visibilityState === 'visible' && cv.clientWidth && $('c-fluss').checked && !zug && verb.some((v) => v.fluss)) { const t0 = performance.now(); zeichne(true); pause = Math.max(33, (performance.now() - t0) * 4); }
    setTimeout(() => requestAnimationFrame(lauf), pause);
  };
  lauf();
})();
