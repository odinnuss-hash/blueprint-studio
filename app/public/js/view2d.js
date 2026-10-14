// 2D-Draufsicht: Canvas mit Zoom/Pan, Auswahl (Klick, Rahmen), Verschieben per Ziehen.
// Bildschirm: rechts = +X, unten = +Y (wie die Karte im Spiel).

import { shade } from './scene.js';

export class View2D {
  constructor(canvas, app) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.app = app;
    this.cx = 0; this.cy = 0; this.scale = 0.05; // px pro cm
    this.drag = null; this.hover = null;
    this.onDown = this.onDown.bind(this); this.onMove = this.onMove.bind(this); this.onUp = this.onUp.bind(this); this.onWheel = this.onWheel.bind(this);
  }
  attach() {
    this.cv.addEventListener('pointerdown', this.onDown);
    this.cv.addEventListener('pointermove', this.onMove);
    this.cv.addEventListener('pointerup', this.onUp);
    this.cv.addEventListener('wheel', this.onWheel, { passive: false });
    this.cv.addEventListener('contextmenu', this.prevent);
    this.cv.style.cursor = 'default';
  }
  detach() {
    this.cv.removeEventListener('pointerdown', this.onDown);
    this.cv.removeEventListener('pointermove', this.onMove);
    this.cv.removeEventListener('pointerup', this.onUp);
    this.cv.removeEventListener('wheel', this.onWheel);
    this.cv.removeEventListener('contextmenu', this.prevent);
  }
  prevent(e) { e.preventDefault(); }

  // ------------------------------------------------ Koordinaten
  size() { return [this.cv.clientWidth, this.cv.clientHeight]; }
  toScreen(x, y) { const [w, h] = this.size(); return [(x - this.cx) * this.scale + w / 2, (y - this.cy) * this.scale + h / 2]; }
  toWorld(sx, sy) { const [w, h] = this.size(); return [(sx - w / 2) / this.scale + this.cx, (sy - h / 2) / this.scale + this.cy]; }
  evPos(e) { const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  fit(bounds) {
    if (!bounds) return;
    const [w, h] = this.size();
    const bw = Math.max(800, bounds.x1 - bounds.x0), bh = Math.max(800, bounds.y1 - bounds.y0);
    this.scale = Math.min((w - 80) / bw, (h - 80) / bh);
    this.cx = (bounds.x0 + bounds.x1) / 2; this.cy = (bounds.y0 + bounds.y1) / 2;
    this.render();
  }

  // ------------------------------------------------ Zeichnen
  render() {
    const cv = this.cv, ctx = this.ctx, dpr = window.devicePixelRatio || 1;
    const [w, h] = this.size();
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#101215'; ctx.fillRect(0, 0, w, h);
    this.drawGrid(w, h);
    const scene = this.app.scene;
    if (!scene) return;
    const sel = this.app.sel, lvl = this.app.level;
    const moving = this.drag && this.drag.type === 'move' && this.drag.moved ? this.drag : null;
    const s = this.scale;
    for (const o of scene.order) {
      if (o.removed || o.hidden) continue;
      let alpha = 1;
      if (lvl >= 0 && scene.levels.length) {
        if (o.level > lvl) continue;
        if (o.level < lvl) alpha = 0.16;
      }
      const isSel = sel.has(o.i);
      const off = moving && isSel ? [moving.dx, moving.dy] : null;
      ctx.globalAlpha = alpha;
      this.drawObj(o, isSel, off, s);
    }
    ctx.globalAlpha = 1;
    // Beschriftungen grosser Maschinen
    if (s > 0.035) {
      ctx.font = '600 11px Segoe UI, sans-serif'; ctx.fillStyle = '#15120d'; ctx.textBaseline = 'top';
      for (const o of scene.order) {
        if (o.removed || o.hidden || o.kind !== 'box' || !o.g || !/Produktion|Energie/.test(o.g.kategorie)) continue;
        if (lvl >= 0 && scene.levels.length && o.level !== lvl) continue;
        const bw = (o.bb[2] - o.bb[0]) * s;
        if (bw < 70) continue;
        const off = moving && sel.has(o.i) ? [moving.dx, moving.dy] : [0, 0];
        const [x, y] = this.toScreen(o.bb[0] + off[0], o.bb[1] + off[1]);
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, bw, (o.bb[3] - o.bb[1]) * s); ctx.clip();
        ctx.fillText(o.name, x + 4, y + 4); ctx.restore();
      }
    }
    // Rahmenauswahl
    if (this.drag && this.drag.type === 'box') {
      const d = this.drag;
      ctx.strokeStyle = '#f59a23'; ctx.fillStyle = 'rgba(245,154,35,.12)'; ctx.lineWidth = 1;
      ctx.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0); ctx.strokeRect(d.x0 + .5, d.y0 + .5, d.x1 - d.x0, d.y1 - d.y0);
    }
    // Massstab
    this.drawScale(w, h);
  }

  drawObj(o, isSel, off, s) {
    const ctx = this.ctx;
    const ox = off ? off[0] : 0, oy = off ? off[1] : 0;
    if (o.kind === 'path') {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      o.path.forEach((v, k) => { const [x, y] = this.toScreen(v[0] + ox, v[1] + oy); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      if (isSel) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(3, o.style.w * s + 4); ctx.stroke(); }
      ctx.strokeStyle = o.color; ctx.lineWidth = Math.max(1.5, o.style.w * s); ctx.stroke();
      return;
    }
    const f = o.foot;
    if (!f || f.length < 3) return;
    ctx.beginPath();
    f.forEach((v, k) => { const [x, y] = this.toScreen(v[0] + ox, v[1] + oy); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath();
    // leicht heller, je hoeher das Objekt
    ctx.fillStyle = shade(o.color, 0.85 + Math.max(-0.2, Math.min(0.3, (o.zMax - this.app.zRef) / 6000)));
    ctx.fill();
    if (isSel) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke(); }
    else if ((o.bb[2] - o.bb[0]) * s > 6) { ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1; ctx.stroke(); }
  }

  drawGrid(w, h) {
    const ctx = this.ctx, s = this.scale;
    const [wx0, wy0] = this.toWorld(0, 0), [wx1, wy1] = this.toWorld(w, h);
    const lines = (step, color) => {
      if (step * s < 6) return;
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = Math.floor(wx0 / step) * step; x <= wx1; x += step) { const sx = Math.round(this.toScreen(x, 0)[0]) + .5; ctx.moveTo(sx, 0); ctx.lineTo(sx, h); }
      for (let y = Math.floor(wy0 / step) * step; y <= wy1; y += step) { const sy = Math.round(this.toScreen(0, y)[1]) + .5; ctx.moveTo(0, sy); ctx.lineTo(w, sy); }
      ctx.stroke();
    };
    lines(100, '#1b1e23');
    lines(800, '#262a31');
    lines(6400, '#323741');
  }

  drawScale(w, h) {
    const ctx = this.ctx, s = this.scale;
    const opts = [100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600];
    const len = opts.find((v) => v * s >= 80) || opts[opts.length - 1];
    const px = len * s, x = 16, y = h - 18;
    ctx.strokeStyle = '#c9ccd1'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(x, y - 5); ctx.lineTo(x, y); ctx.lineTo(x + px, y); ctx.lineTo(x + px, y - 5); ctx.stroke();
    ctx.fillStyle = '#c9ccd1'; ctx.font = '12px Cascadia Mono, Consolas, monospace'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${len / 100} m`, x + px + 6, y + 2);
  }

  // ------------------------------------------------ Trefferpruefung
  hit(sx, sy) {
    const scene = this.app.scene; if (!scene) return null;
    const [x, y] = this.toWorld(sx, sy);
    const lvl = this.app.level, tol = 4 / this.scale;
    for (let k = scene.order.length - 1; k >= 0; k--) {
      const o = scene.order[k];
      if (o.removed || o.hidden) continue;
      if (lvl >= 0 && scene.levels.length && o.level !== lvl) continue;
      if (x < o.bb[0] - tol - 200 || x > o.bb[2] + tol + 200 || y < o.bb[1] - tol - 200 || y > o.bb[3] + tol + 200) continue;
      if (o.kind === 'path') { if (distPolyline(x, y, o.path) <= o.style.w / 2 + tol) return o; }
      else if (o.foot && o.foot.length >= 3 && inPoly(x, y, o.foot)) return o;
    }
    return null;
  }

  // ------------------------------------------------ Maus
  onDown(e) {
    if (!this.app.scene) return;
    this.cv.setPointerCapture(e.pointerId);
    const [sx, sy] = this.evPos(e);
    if (e.button === 1 || e.button === 2) { this.drag = { type: 'pan', sx, sy, cx: this.cx, cy: this.cy }; this.cv.style.cursor = 'grabbing'; return; }
    const o = this.hit(sx, sy);
    if (o) {
      if (e.shiftKey || e.ctrlKey) { this.app.toggleSel(o.i); this.drag = null; return; }
      if (!this.app.sel.has(o.i)) this.app.setSel([o.i]);
      const [wx, wy] = this.toWorld(sx, sy);
      this.drag = { type: 'move', wx, wy, dx: 0, dy: 0, moved: false, sx, sy };
    } else {
      this.drag = { type: 'box', x0: sx, y0: sy, x1: sx, y1: sy, add: e.shiftKey || e.ctrlKey };
    }
  }
  onMove(e) {
    const [sx, sy] = this.evPos(e);
    const [wx, wy] = this.toWorld(sx, sy);
    this.app.setCursor(wx, wy);
    const d = this.drag;
    if (!d) return;
    if (d.type === 'pan') { this.cx = d.cx - (sx - d.sx) / this.scale; this.cy = d.cy - (sy - d.sy) / this.scale; this.render(); return; }
    if (d.type === 'box') { d.x1 = sx; d.y1 = sy; this.render(); return; }
    if (d.type === 'move') {
      if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < 4) return;
      d.moved = true;
      const snap = this.app.snap;
      d.dx = Math.round((wx - d.wx) / snap) * snap; d.dy = Math.round((wy - d.wy) / snap) * snap;
      this.app.setDragInfo(d.dx, d.dy);
      this.render();
    }
  }
  onUp(e) {
    const d = this.drag; this.drag = null; this.cv.style.cursor = 'default';
    if (!d) return;
    if (d.type === 'box') {
      const [ax, ay] = this.toWorld(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1));
      const [bx, by] = this.toWorld(Math.max(d.x0, d.x1), Math.max(d.y0, d.y1));
      if (Math.abs(d.x1 - d.x0) < 3 && Math.abs(d.y1 - d.y0) < 3) { if (!d.add) this.app.setSel([]); this.render(); return; }
      const lvl = this.app.level, scene = this.app.scene;
      const ids = scene.objs.filter((o) => !o.removed && !o.hidden && o.kind !== 'none' && (lvl < 0 || !scene.levels.length || o.level === lvl) &&
        o.bb[0] >= ax && o.bb[2] <= bx && o.bb[1] >= ay && o.bb[3] <= by).map((o) => o.i);
      this.app.setSel(d.add ? [...this.app.sel, ...ids] : ids);
      return;
    }
    if (d.type === 'move' && d.moved && (d.dx || d.dy)) this.app.moveSel(d.dx, d.dy, 0);
    this.app.setDragInfo(null);
    this.render();
  }
  onWheel(e) {
    e.preventDefault();
    const [sx, sy] = this.evPos(e);
    const [wx, wy] = this.toWorld(sx, sy);
    const f = Math.exp(-e.deltaY * 0.0015);
    this.scale = Math.min(2, Math.max(0.0005, this.scale * f));
    const [w, h] = this.size();
    this.cx = wx - (sx - w / 2) / this.scale; this.cy = wy - (sy - h / 2) / this.scale;
    this.render();
  }
}

function inPoly(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function distPolyline(x, y, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
    if (d < best) best = d;
  }
  return best;
}
