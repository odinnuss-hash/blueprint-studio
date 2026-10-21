// Szene: wandelt Blaupausen-Objekte + Katalog in zeichenbare Geometrie (Weltkoordinaten in cm, Unreal: X, Y, Z-oben).

// ---------------------------------------------------------------- Mathematik
export function qRot(q, v) {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
export function rotateZ(q, deg) {
  const a = deg * Math.PI / 360, s = Math.sin(a), c = Math.cos(a);
  const [x, y, z, w] = q;
  const r = [c * x - s * y, c * y + s * x, c * z + s * w, c * w - s * z];
  const n = Math.hypot(...r) || 1;
  return r.map((v) => v / n);
}
export function yawOf(q) {
  const [x, y, z, w] = q;
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * 180 / Math.PI;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ---------------------------------------------------------------- Farben
const CAT_COLOR = {
  Produktion: '#e8a33d', Energie: '#f2d04b', Transport: '#5b9bd5', Spezial: '#c08bd6', Sonstiges: '#9aa0a8',
};
const SUB_COLOR = {
  Fundamente: '#535a65', 'Umgekehrte Rampen': '#5d636d', Rampen: '#5d636d', Viertelrohre: '#5d636d', Dächer: '#6d6a74',
  Rahmen: '#7b8089', Säulen: '#8a8f98', Träger: '#b4b9c1', Laufstege: '#8f8a7c', Gehwege: '#8f8a7c', Anbauteile: '#9aa0a8',
  Schilder: '#3fb6a8', Beleuchtung: '#f7e08a', Lager: '#7fa7c9', Türme: '#9aa0a8',
  Rohre: '#3fb6a8', Rohrstützen: '#5fa59b', Förderbänder: '#5b9bd5', Förderlifte: '#4f86bb', 'Förderband-Stützen': '#6d93b8',
  'Förderband-Anbauten': '#7fb2e6', Züge: '#b0b6c0', Hypertubes: '#a98ad6', Fahrzeugwege: '#b0b6c0',
  Strommasten: '#f2d04b', Wandanschlüsse: '#e6c547', Generatoren: '#f2b84b',
};
export function colorFor(g, cls) {
  if (/Glass|Window_Thin/.test(cls || '')) return '#8ecfe6';
  if (!g) return /Wall/.test(cls) ? '#8a7a66' : '#9aa0a8';
  if (g.kategorie === 'Wände') return '#8a7a66';
  return SUB_COLOR[g.unterkategorie] || CAT_COLOR[g.kategorie] || '#9aa0a8';
}
export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f)), g = Math.min(255, Math.round(((n >> 8) & 255) * f)), b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

// ---------------------------------------------------------------- Formen ohne Katalog-Box
function pathStyle(cls) {
  if (/ConveyorBelt/.test(cls)) return { w: 130, lo: -10, hi: 25 };
  if (/Pipeline|Pipe_/.test(cls)) return { w: 90, lo: -45, hi: 45 };
  if (/Railroad|Track/.test(cls)) return { w: 320, lo: -20, hi: 30 };
  if (/Hyper/.test(cls)) return { w: 260, lo: -130, hi: 130 };
  return { w: 100, lo: -20, hi: 20 };
}
function defaultBox(cls) {
  if (/FoundationPassthrough/.test(cls)) return [-110, -110, -100, 110, 110, 100];
  if (/ConveyorPole|PipelineSupport|PipeSupport|PipeHyperSupport/.test(cls)) return [-40, -40, 0, 40, 40, 150];
  if (/Ceiling|WallAttachment|Wall_?Mount|SupportWall/.test(cls)) return [-40, -40, -40, 40, 40, 40];
  if (/SignPole/.test(cls)) return [-15, -15, 0, 15, 15, 300];
  return [-50, -50, 0, 50, 50, 100];
}

// Hermite-Abtastung eines Splines (Punkte lokal: [x,y,z, arriveX..Z, leaveX..Z])
function sampleSpline(pts) {
  if (pts.length < 2) return pts.map((p) => p.slice(0, 3));
  const out = [pts[0].slice(0, 3)];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const p0 = a.slice(0, 3), p1 = b.slice(0, 3);
    const m0 = a.length >= 9 ? a.slice(6, 9) : sub(p1, p0), m1 = b.length >= 9 ? b.slice(3, 6) : sub(p1, p0);
    const chord = sub(p1, p0), len = Math.hypot(...chord);
    // gerade, wenn Tangenten parallel zur Sehne
    const dev = Math.hypot(...cross(norm(m0), norm(chord))) + Math.hypot(...cross(norm(m1), norm(chord)));
    const n = dev < 0.02 ? 1 : Math.max(2, Math.min(24, Math.round(len / 150)));
    for (let k = 1; k <= n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      out.push([0, 1, 2].map((j) => h00 * p0[j] + h10 * m0[j] + h01 * p1[j] + h11 * m1[j]));
    }
  }
  return out;
}

// Quader-Ecken: Index-Bits: 1 = X max, 2 = Y max, 4 = Z max
export const FACES = [[0, 2, 6, 4], [1, 5, 7, 3], [0, 4, 5, 1], [2, 3, 7, 6], [0, 1, 3, 2], [4, 6, 7, 5]];

function boxCorners(box, p, q, s) {
  const out = [];
  for (let k = 0; k < 8; k++) {
    let v = [k & 1 ? box[3] : box[0], k & 2 ? box[4] : box[1], k & 4 ? box[5] : box[2]];
    if (s) v = [v[0] * s[0], v[1] * s[1], v[2] * s[2]];
    const r = qRot(q, v);
    out.push([r[0] + p[0], r[1] + p[1], r[2] + p[2]]);
  }
  return out;
}

function segmentPrisms(world, st) {
  const prisms = [];
  for (let i = 0; i < world.length - 1; i++) {
    const a = world[i], b = world[i + 1];
    const d = sub(b, a);
    if (Math.hypot(...d) < 1) continue;
    let side = cross([0, 0, 1], d);
    if (Math.hypot(...side) < 1e-6) side = [1, 0, 0];
    side = norm(side);
    const hw = st.w / 2, c = [];
    for (let k = 0; k < 8; k++) {
      const base = k & 1 ? b : a, sg = k & 2 ? hw : -hw, z = k & 4 ? st.hi : st.lo;
      c.push([base[0] + side[0] * sg, base[1] + side[1] * sg, base[2] + z]);
    }
    prisms.push(c);
  }
  return prisms;
}

// 2D-Huelle (konvex) fuer Umriss in der Draufsicht
function hull(points) {
  const p = points.map((v) => [v[0], v[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const v of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], v) <= 0) lo.pop(); lo.push(v); }
  for (let i = p.length - 1; i >= 0; i--) { const v = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], v) <= 0) up.pop(); up.push(v); }
  up.pop(); lo.pop();
  return lo.concat(up);
}

// ---------------------------------------------------------------- Objekt-Geometrie
export const isBeam = (cls) => /^Build_Beam(?!_Connector|_Support)/.test(cls || '');
export function computeGeometry(o) {
  const g = o.g, cls = o.cls;
  o.prisms = null; o.corners = null; o.path = null; o.foot = null;
  if (/PowerLine|Wire/.test(cls)) { o.kind = 'none'; o.zMin = o.zMax = o.p[2]; o.foot = []; return o; }
  if (o.sp && o.sp.length >= 2) {
    o.kind = 'path';
    const st = pathStyle(cls);
    o.style = st;
    const local = sampleSpline(o.sp);
    o.path = local.map((v) => { const r = qRot(o.q, v); return [r[0] + o.p[0], r[1] + o.p[1], r[2] + o.p[2]]; });
    o.prisms = segmentPrisms(o.path, st);
    const zs = o.path.map((v) => v[2]);
    o.zMin = Math.min(...zs) + st.lo; o.zMax = Math.max(...zs) + st.hi;
  } else if (o.lt) {
    o.kind = 'box';
    const top = qRot(o.q, o.lt);
    const z0 = Math.min(0, top[2]), z1 = Math.max(0, top[2]);
    o.corners = boxCorners([-100, -100, z0 - 50, 100, 100, z1 + 50], o.p, [0, 0, 0, 1]);
  } else if (isBeam(cls)) {
    // Traeger: Mesh laeuft entlang Z, ist im Spiel auf X gedreht; Laenge aus der Blaupause
    o.kind = 'box';
    const b = (g && g.box) || [-50, -50, 0, 50, 50, 400];
    o.corners = boxCorners([0, b[0], b[1], o.len || b[5], b[3], b[4]], o.p, o.q, o.s);
  } else {
    o.kind = 'box';
    const box = (g && g.box) || defaultBox(cls);
    o.corners = boxCorners(box, o.p, o.q, o.s);
  }
  if (o.corners) {
    const zs = o.corners.map((v) => v[2]);
    o.zMin = Math.min(...zs); o.zMax = Math.max(...zs);
    o.foot = hull(o.corners);
  } else if (o.path) {
    o.foot = o.path.map((v) => [v[0], v[1]]);
  }
  // Mittelpunkt + Ausdehnung
  const pts = o.corners || o.path || [o.p];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const v of pts) { if (v[0] < x0) x0 = v[0]; if (v[0] > x1) x1 = v[0]; if (v[1] < y0) y0 = v[1]; if (v[1] > y1) y1 = v[1]; }
  o.bb = [x0, y0, x1, y1];
  return o;
}

// ---------------------------------------------------------------- Szene
export function buildScene(bp, kat) {
  const objs = bp.objekte.map((e) => {
    const cls = bp.klassen[e.c];
    const g = kat?.gebaeude?.[cls] || null;
    const o = { i: e.i, cls, g, name: g ? g.name : cls.replace(/^Build_|_C$/g, '').replace(/_/g, ' '), p: e.p.slice(), q: e.q.slice(), s: e.s || null,
      sp: e.sp || null, lt: e.lt || null, len: e.len || null, h: e.h ?? null, pv: e.pv ?? null, r: e.r || null, w: e.w || null, color: colorFor(g, cls), removed: false };
    o.p0 = e.p.slice(); o.q0 = e.q.slice(); o.cls0 = cls;
    return computeGeometry(o);
  });
  const byId = new Map(objs.map((o) => [o.i, o]));
  const scene = { objs, byId, levels: [] };
  computeLevels(scene);
  sortScene(scene);
  return scene;
}

const prettyCls = (cls) => cls.replace(/^Build_|_C$/g, '').replace(/_/g, ' ');

/** Neues Objekt (aus Generator oder eingefuegt) */
export function newObj(i, cls, p, q, kat) {
  const g = kat?.gebaeude?.[cls] || null;
  const o = { i, cls, cls0: cls, g, name: g ? g.name : prettyCls(cls), p: p.slice(), q: q.slice(), s: null, sp: null, lt: null, r: null, w: null,
    color: colorFor(g, cls), removed: false, isNew: true };
  o.p0 = p.slice(); o.q0 = q.slice();
  return computeGeometry(o);
}

/** Bauteil-Typ eines Objekts aendern (Material/Variante tauschen) */
export function setCls(o, cls, kat) {
  o.cls = cls; o.g = kat?.gebaeude?.[cls] || null; o.name = o.g ? o.g.name : prettyCls(cls); o.color = colorFor(o.g, cls);
  if (cls !== o.cls0) { o.r = null; } // Rezept/Farbe gehoeren zur alten Variante
  return computeGeometry(o);
}

export function sortScene(scene) {
  scene.order = scene.objs.filter((o) => o.kind !== 'none').sort((a, b) => (a.zMax - b.zMax) || (a.zMin - b.zMin));
}

export function computeLevels(scene) {
  const zs = scene.objs.filter((o) => o.g && o.g.unterkategorie === 'Fundamente' && !o.removed).map((o) => Math.round(o.p[2] / 50) * 50).sort((a, b) => a - b);
  const levels = [];
  for (const z of zs) if (!levels.length || z - levels[levels.length - 1] > 250) levels.push(z);
  scene.levels = levels.length >= 2 ? levels : [];
  for (const o of scene.objs) o.level = levelOf(scene, o);
}
export function levelOf(scene, o) {
  const L = scene.levels;
  if (!L.length) return 0;
  let k = 0;
  for (let j = 0; j < L.length; j++) if (o.zMin >= L[j] - 150) k = j;
  return k;
}

export function sceneBounds(scene, onlySel) {
  // Ausreisser (z. B. Mod-Objekte weit abseits) beim Einpassen ignorieren
  let lim = null;
  if (!onlySel) {
    const os = scene.objs.filter((o) => !o.removed && o.kind !== 'none');
    if (os.length > 20) {
      const q = (arr, f) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * f)))];
      const xs = os.map((o) => (o.bb[0] + o.bb[2]) / 2).sort((a, b) => a - b), ys = os.map((o) => (o.bb[1] + o.bb[3]) / 2).sort((a, b) => a - b);
      const ax = q(xs, 0.02), bx = q(xs, 0.98), ay = q(ys, 0.02), by = q(ys, 0.98);
      const mx = Math.max(1600, (bx - ax) * 0.3), my = Math.max(1600, (by - ay) * 0.3);
      lim = [ax - mx, ay - my, bx + mx, by + my];
    }
  }
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const o of scene.objs) {
    if (o.removed || o.kind === 'none' || (onlySel && !onlySel.has(o.i))) continue;
    if (lim) { const cx = (o.bb[0] + o.bb[2]) / 2, cy = (o.bb[1] + o.bb[3]) / 2; if (cx < lim[0] || cx > lim[2] || cy < lim[1] || cy > lim[3]) continue; }
    if (o.bb[0] < x0) x0 = o.bb[0]; if (o.bb[2] > x1) x1 = o.bb[2];
    if (o.bb[1] < y0) y0 = o.bb[1]; if (o.bb[3] > y1) y1 = o.bb[3];
    if (o.zMin < z0) z0 = o.zMin; if (o.zMax > z1) z1 = o.zMax;
  }
  if (!Number.isFinite(x0)) return null;
  return { x0, y0, z0, x1, y1, z1 };
}
