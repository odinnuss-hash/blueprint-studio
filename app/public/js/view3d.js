// 3D-Ansicht ohne Fremdbibliothek: perspektivische Projektion, Maleralgorithmus, flache Schattierung.
// Linke Maustaste: drehen · rechte/mittlere: verschieben · Mausrad: Zoom · Klick: auswaehlen.

import { FACES, shade } from './scene.js';

const LIGHT = (() => { const v = [0.35, -0.45, 0.82]; const l = Math.hypot(...v); return v.map((x) => x / l); })();

export class View3D {
  constructor(canvas, app) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.app = app;
    this.target = [0, 0, 0]; this.yaw = 45; this.pitch = 35; this.dist = 5000; this.fov = 50;
    this.drag = null; this.frame = null; this.raf = 0; this.fast = false;
    this.onDown = this.onDown.bind(this); this.onMove = this.onMove.bind(this); this.onUp = this.onUp.bind(this); this.onWheel = this.onWheel.bind(this);
  }
  attach() {
    this.cv.addEventListener('pointerdown', this.onDown);
    this.cv.addEventListener('pointermove', this.onMove);
    this.cv.addEventListener('pointerup', this.onUp);
    this.cv.addEventListener('wheel', this.onWheel, { passive: false });
    this.cv.addEventListener('contextmenu', this.prevent);
    this.cv.style.cursor = 'grab';
  }
  detach() {
    this.cv.removeEventListener('pointerdown', this.onDown);
    this.cv.removeEventListener('pointermove', this.onMove);
    this.cv.removeEventListener('pointerup', this.onUp);
    this.cv.removeEventListener('wheel', this.onWheel);
    this.cv.removeEventListener('contextmenu', this.prevent);
  }
  prevent(e) { e.preventDefault(); }
  size() { return [this.cv.clientWidth, this.cv.clientHeight]; }
  evPos(e) { const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  fit(b) {
    if (!b) return;
    this.target = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2];
    const r = Math.max(600, Math.hypot(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0) / 2);
    this.dist = r / Math.tan((this.fov / 2) * Math.PI / 180) * 1.05;
    this.render();
  }

  camera() {
    const yr = this.yaw * Math.PI / 180, pr = this.pitch * Math.PI / 180;
    const off = [Math.cos(pr) * Math.cos(yr), Math.cos(pr) * Math.sin(yr), Math.sin(pr)];
    const eye = [this.target[0] + off[0] * this.dist, this.target[1] + off[1] * this.dist, this.target[2] + off[2] * this.dist];
    const f = [-off[0], -off[1], -off[2]];
    // rechts = Z x f, oben = f x rechts  (passt zur Draufsicht: +Y zeigt nach unten)
    let r = [-f[1], f[0], 0]; const rl = Math.hypot(r[0], r[1]) || 1; r = [r[0] / rl, r[1] / rl, 0];
    const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
    const [w, h] = this.size();
    const focal = (h / 2) / Math.tan((this.fov / 2) * Math.PI / 180);
    return { eye, f, r, u, focal, w, h };
  }

  requestRender(fast) { this.fast = !!fast; if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); }); }

  render() {
    const cv = this.cv, ctx = this.ctx, dpr = window.devicePixelRatio || 1;
    const [w, h] = this.size();
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const scene = this.app.scene;
    // Arbeitsflaeche: bei schneller Bewegung in halber Aufloesung
    const res = this.fast ? 0.5 : 1;
    const W = Math.max(1, Math.round(w * dpr * res)), H = Math.max(1, Math.round(h * dpr * res));
    if (!this.off || this.off.width !== W || this.off.height !== H) { this.off = new OffscreenCanvas(W, H); this.offCtx = this.off.getContext('2d', { willReadFrequently: true }); }
    const oc = this.offCtx, k = W / w;
    oc.setTransform(1, 0, 0, 1, 0, 0);
    const grd = oc.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#171a1f'); grd.addColorStop(1, '#0d0f12');
    oc.fillStyle = grd; oc.fillRect(0, 0, W, H);
    if (!scene) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(this.off, 0, 0, cv.width, cv.height); return; }
    const cam = this.camera();
    oc.setTransform(k, 0, 0, k, 0, 0);
    this.drawGround(cam, oc);
    const img = oc.getImageData(0, 0, W, H);
    const col = new Uint32Array(img.data.buffer);
    const N = W * H;
    const depth = new Float32Array(N);
    const fid = new Int32Array(N).fill(-1);
    const faceObj = [];
    const sel = this.app.sel, lvl = this.app.level, hasL = scene.levels.length > 0;
    const { eye, f, r, u, focal } = cam;
    const cx = w / 2, cy = h / 2, near = 30;
    const fx = focal * k;
    const proj = (v) => {
      const dx = v[0] - eye[0], dy = v[1] - eye[1], dz = v[2] - eye[2];
      const z = dx * f[0] + dy * f[1] + dz * f[2];
      if (z < near) return null;
      return [cx * k + (dx * r[0] + dy * r[1] + dz * r[2]) / z * fx, cy * k - (dx * u[0] + dy * u[1] + dz * u[2]) / z * fx, 1 / z];
    };
    const tri = (a, b, c, color, id) => {
      let area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (area === 0) return;
      if (area < 0) { const t = b; b = c; c = t; area = -area; }
      const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      if (minX > maxX || minY > maxY) return;
      // Kantenfunktionen  w0: b->c, w1: c->a, w2: a->b
      const A0 = b[1] - c[1], B0 = c[0] - b[0], A1 = c[1] - a[1], B1 = a[0] - c[0], A2 = a[1] - b[1], B2 = b[0] - a[0];
      const px = minX + 0.5, py = minY + 0.5;
      let r0 = (px - b[0]) * A0 + (py - b[1]) * B0, r1 = (px - c[0]) * A1 + (py - c[1]) * B1, r2 = (px - a[0]) * A2 + (py - a[1]) * B2;
      const ia = 1 / area, za = a[2] * ia, zb = b[2] * ia, zc = c[2] * ia;
      for (let y = minY; y <= maxY; y++) {
        let w0 = r0, w1 = r1, w2 = r2, idx = y * W + minX;
        for (let x = minX; x <= maxX; x++, idx++) {
          if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
            const iz = w0 * za + w1 * zb + w2 * zc;
            if (iz > depth[idx]) { depth[idx] = iz; col[idx] = color; fid[idx] = id; }
          }
          w0 += A0; w1 += A1; w2 += A2;
        }
        r0 += B0; r1 += B1; r2 += B2;
      }
    };
    const pack = (hex, f2, ghost) => {
      const n = parseInt(hex.slice(1), 16);
      let R = ((n >> 16) & 255) * f2, G = ((n >> 8) & 255) * f2, B = (n & 255) * f2;
      if (ghost) { R = R * 0.3 + 20; G = G * 0.3 + 22; B = B * 0.3 + 26; }
      return (255 << 24) | (Math.min(255, B) << 16) | (Math.min(255, G) << 8) | Math.min(255, R);
    };
    const minPx = this.fast ? 1.5 : 0;
    const addHexa = (o, c, isSel, ghost) => {
      const P = c.map(proj);
      if (P.some((p) => !p)) return;
      if (minPx) { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const p of P) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; } if (x1 - x0 < minPx && y1 - y0 < minPx) return; }
      let mx = 0, my = 0, mz = 0; for (const v of c) { mx += v[0]; my += v[1]; mz += v[2]; } mx /= 8; my /= 8; mz /= 8;
      for (const fc of FACES) {
        const a = c[fc[0]], b = c[fc[1]], d = c[fc[3]], e2 = c[fc[2]];
        let n = [(b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]), (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]), (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0])];
        let nl = Math.hypot(n[0], n[1], n[2]);
        if (nl < 1e-9) { n = [(e2[1] - a[1]) * (d[2] - a[2]) - (e2[2] - a[2]) * (d[1] - a[1]), (e2[2] - a[2]) * (d[0] - a[0]) - (e2[0] - a[0]) * (d[2] - a[2]), (e2[0] - a[0]) * (d[1] - a[1]) - (e2[1] - a[1]) * (d[0] - a[0])]; nl = Math.hypot(...n); if (nl < 1e-9) continue; }
        n = [n[0] / nl, n[1] / nl, n[2] / nl];
        const fcx = (a[0] + e2[0]) / 2, fcy = (a[1] + e2[1]) / 2, fcz = (a[2] + e2[2]) / 2;
        if (n[0] * (fcx - mx) + n[1] * (fcy - my) + n[2] * (fcz - mz) < 0) n = [-n[0], -n[1], -n[2]];
        if (n[0] * (eye[0] - fcx) + n[1] * (eye[1] - fcy) + n[2] * (eye[2] - fcz) <= 0) continue; // Rueckseite
        const lit = 0.5 + 0.5 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
        const color = pack(isSel ? '#ffb347' : o.color, lit * (isSel ? 1.08 : 1), ghost);
        const id = faceObj.length; faceObj.push(o);
        const p0 = P[fc[0]], p1 = P[fc[1]], p2 = P[fc[2]], p3 = P[fc[3]];
        tri(p0, p1, p2, color, id); tri(p0, p2, p3, color, id);
      }
    };
    for (const o of scene.objs) {
      if (o.removed || o.hidden || o.kind === 'none') continue;
      let ghost = false;
      if (lvl >= 0 && hasL) { if (o.level > lvl) continue; if (o.level < lvl) ghost = true; }
      const isSel = sel.has(o.i);
      if (o.corners) addHexa(o, o.corners, isSel, ghost);
      else if (o.prisms) for (const c of o.prisms) addHexa(o, c, isSel, ghost);
    }
    // Kanten: wo die Flaeche wechselt, abdunkeln (Auswahl: hell umranden)
    for (let y = 0; y < H - 1; y++) {
      let idx = y * W;
      for (let x = 0; x < W - 1; x++, idx++) {
        const a = fid[idx];
        if (a < 0) continue;
        const rgt = fid[idx + 1], dn = fid[idx + W];
        if (a !== rgt || a !== dn) {
          const o = faceObj[a], so = sel.has(o.i);
          const oR = rgt >= 0 ? faceObj[rgt] : null, oD = dn >= 0 ? faceObj[dn] : null;
          const outline = so && (oR !== o || oD !== o);
          if (outline) col[idx] = 0xffffffff;
          else { const c = col[idx]; col[idx] = (255 << 24) | ((((c >> 16) & 255) * 0.62) << 16) | ((((c >> 8) & 255) * 0.62) << 8) | ((c & 255) * 0.62); }
        }
      }
    }
    oc.putImageData(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.off, 0, 0, cv.width, cv.height);
    this.frame = { fid, faceObj, W, H, k };
  }

  drawGround(cam, ctx) {
    const scene = this.app.scene, b = scene.bounds;
    if (!b) return;
    const step = 800;
    const z = b.z0;
    const x0 = Math.floor((b.x0 - 1600) / step) * step, x1 = Math.ceil((b.x1 + 1600) / step) * step;
    const y0 = Math.floor((b.y0 - 1600) / step) * step, y1 = Math.ceil((b.y1 + 1600) / step) * step;
    const { eye, f, r, u, focal, w, h } = cam;
    const proj = (x, y) => { const dx = x - eye[0], dy = y - eye[1], dz = z - eye[2]; const d = dx * f[0] + dy * f[1] + dz * f[2]; if (d < 50) return null; return [w / 2 + (dx * r[0] + dy * r[1] + dz * r[2]) / d * focal, h / 2 - (dx * u[0] + dy * u[1] + dz * u[2]) / d * focal]; };
    ctx.strokeStyle = '#262a32'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = x0; x <= x1; x += step) { const a = proj(x, y0), c = proj(x, y1); if (a && c) { ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); } }
    for (let y = y0; y <= y1; y += step) { const a = proj(x0, y), c = proj(x1, y); if (a && c) { ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); } }
    ctx.stroke();
  }

  pick(sx, sy) {
    const fr = this.frame;
    if (!fr) return null;
    const x = Math.floor(sx * fr.k), y = Math.floor(sy * fr.k);
    if (x < 0 || y < 0 || x >= fr.W || y >= fr.H) return null;
    // kleine Toleranz: naechstes Objekt im 5x5-Umfeld
    for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const xx = x + ox, yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= fr.W || yy >= fr.H) continue;
      const id = fr.fid[yy * fr.W + xx];
      if (id >= 0) return fr.faceObj[id];
    }
    return null;
  }

  onDown(e) {
    if (!this.app.scene) return;
    this.cv.setPointerCapture(e.pointerId);
    const [sx, sy] = this.evPos(e);
    this.drag = { btn: e.button, sx, sy, lx: sx, ly: sy, moved: false, shift: e.shiftKey || e.ctrlKey };
    this.cv.style.cursor = 'grabbing';
  }
  onMove(e) {
    const d = this.drag; if (!d) return;
    const [sx, sy] = this.evPos(e);
    const dx = sx - d.lx, dy = sy - d.ly; d.lx = sx; d.ly = sy;
    if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < 4) return;
    d.moved = true;
    if (d.btn === 0 && !e.shiftKey) {
      this.yaw -= dx * 0.4; this.pitch = Math.max(-85, Math.min(89, this.pitch + dy * 0.3));
    } else {
      const cam = this.camera(), k = this.dist / cam.focal;
      for (let j = 0; j < 3; j++) this.target[j] += (-dx * cam.r[j] + dy * cam.u[j]) * k;
    }
    this.requestRender(true);
  }
  onUp(e) {
    const d = this.drag; this.drag = null; this.cv.style.cursor = 'grab';
    if (!d) return;
    if (!d.moved && d.btn === 0) {
      if (this.fast) { this.fast = false; this.render(); }
      const o = this.pick(d.sx, d.sy);
      if (o) { if (d.shift) this.app.toggleSel(o.i); else this.app.setSel([o.i]); }
      else if (!d.shift) this.app.setSel([]);
      return;
    }
    this.requestRender(false);
  }
  onWheel(e) {
    e.preventDefault();
    this.dist = Math.max(300, Math.min(2e6, this.dist * Math.exp(e.deltaY * 0.0015)));
    this.requestRender(true);
    clearTimeout(this.wt); this.wt = setTimeout(() => this.requestRender(false), 180);
  }
}

function inQuad(x, y, p) {
  let c = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const xi = p[i][0], yi = p[i][1], xj = p[j][0], yj = p[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
