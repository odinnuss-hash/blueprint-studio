// Draufsicht für den Baukasten: echte Spielmodelle (wie im Editor, view3dgl.js) senkrecht von oben ohne Perspektive
// einmal je Bauteil und Auflösung in ein Bild zeichnen. Das Reißbrett (baukasten.js) legt diese Bilder dann gedreht ab.
// Ohne „Modelle aus dem Spiel holen“ gibt es keine Bilder – das Reißbrett zeichnet dann einfache Kästen.
import { View3DGL } from './view3dgl.js';
import { spielUniforms } from './spieloptik.js';

const qm = (q, s) => {
  const [x, y, z, w] = q;
  return [(1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0],
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1],
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2]];
};

export class Draufsicht extends View3DGL {
  constructor() {
    super(document.createElement('canvas'), { scene: null, sel: new Set(), level: -1 });
    this.useModels = true; this.spielOptik = true; this.cache = new Map();
  }
  render() { /* nur auf Anfrage über bild() */ }
  async laden() { await this.loadModels(); return this.models.state === 'bereit'; }
  hat(cls) { return this.models.state === 'bereit' && !!this.models.index.klassen[cls]; }

  /** Umriss des Modells (cm, Drehung 0) */
  grenzen(cls) {
    const idx = this.models.index, mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const [mesh, t, q, s] of idx.klassen[cls] || []) {
      const m = idx.meshes[mesh]; if (!m) continue;
      const R = qm(q, s);
      for (let k = 0; k < 8; k++) {
        const c = [k & 1 ? m.max[0] : m.min[0], k & 2 ? m.max[1] : m.min[1], k & 4 ? m.max[2] : m.min[2]];
        for (let j = 0; j < 3; j++) { const v = R[j] * c[0] + R[3 + j] * c[1] + R[6 + j] * c[2] + t[j]; mn[j] = Math.min(mn[j], v); mx[j] = Math.max(mx[j], v); }
      }
    }
    return Number.isFinite(mn[0]) ? { x0: mn[0], x1: mx[0], y0: mn[1], y1: mx[1], z0: mn[2], z1: mx[2] } : null;
  }

  /**
   * Bild eines Bauteils von oben. s = Pixel je cm. Rückgabe { bild, ox, oy, s }: (ox, oy) = Pixel des Bauteil-Ursprungs.
   * ausschnitt (optional, cm): fester Bereich { x0, x1, y0, y1 } statt des Modell-Umrisses (z. B. Fundament-Kachel).
   */
  bild(cls, s, ausschnitt = null) {
    const key = cls + '@' + s + (ausschnitt ? '#' + Object.values(ausschnitt).join() : '');
    if (this.cache.has(key)) return this.cache.get(key);
    let erg = null;
    try { erg = this.zeichneBild(cls, s, ausschnitt); } catch (e) { console.warn('Draufsicht', cls, e); }
    this.cache.set(key, erg);
    return erg;
  }

  zeichneBild(cls, s, ausschnitt) {
    if (!this.hat(cls)) return null;
    const g0 = this.grenzen(cls); if (!g0) return null;
    const rand = ausschnitt ? 0 : 30;
    const b = ausschnitt ? { ...ausschnitt, z0: g0.z0, z1: g0.z1 } : { x0: g0.x0 - rand, x1: g0.x1 + rand, y0: g0.y0 - rand, y1: g0.y1 + rand, z0: g0.z0, z1: g0.z1 };
    return this.rendere({ objs: [{ i: 0, cls, p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1], color: '#8d949c', kind: 'teil' }], levels: [] }, b, s);
  }

  /** Ganze Szene (scene.js-Objekte) von oben; b = Bereich in cm { x0, x1, y0, y1, z0, z1 }. Rückgabe wie bild(). */
  bildSzene(key, scene, b, s) {
    const k = '#' + key + '@' + s;
    if (this.cache.has(k)) return this.cache.get(k);
    let erg = null;
    try { if (this.models.state === 'bereit') erg = this.rendere(scene, b, s); } catch (e) { console.warn('Draufsicht', key, e); }
    this.cache.set(k, erg);
    return erg;
  }

  rendere(scene, b, s) {
    const W = Math.max(1, Math.min(2048, Math.round((b.x1 - b.x0) * s))), H = Math.max(1, Math.min(2048, Math.round((b.y1 - b.y0) * s)));
    const gl = this.gl;
    this.app.scene = scene;
    this.inst = this.buildInstances();
    this.ensureFbo(W, H);
    // Parallelprojektion von oben: x → rechts, y (Süden) → unten im Bild, höheres z liegt vorn
    const zr = Math.max(1, b.z1 - b.z0 + 20), z0 = b.z0 - 10;
    const VP = new Float32Array(16);
    VP[0] = 2 / (b.x1 - b.x0); VP[12] = -(b.x1 + b.x0) / (b.x1 - b.x0);
    VP[5] = 2 / (b.y1 - b.y0); VP[13] = -(b.y1 + b.y0) / (b.y1 - b.y0);
    VP[10] = -2 / zr; VP[14] = 1 + 2 * z0 / zr;
    VP[15] = 1;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, W, H);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.DEPTH, 0, [1]);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    gl.useProgram(this.pMain.p);
    gl.uniformMatrix4fv(this.pMain.u.uVP, false, VP);
    gl.uniform3fv(this.pMain.u.uEye, [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z1 + 200000]);
    gl.uniform1i(this.pMain.u.uArt, -1);
    this.spielAn = !!this.spielTex;
    spielUniforms(gl, this.pMain.u, this.spielAn ? this.spielTex : this.leerTex, 4);
    gl.bindVertexArray(this.vao);
    const glas = [];
    for (const rg of this.inst.ranges) {
      if (rg.key[0] === '#') { this.drawRange(rg, rg.key, false); continue; }
      const m = this.models.index.meshes[rg.key]; if (!m) continue;
      this.drawRange(rg, m, false);
      if (m.gi < m.ni) glas.push([rg, m]);
    }
    if (glas.length) {
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
      for (const [rg, m] of glas) this.drawRange(rg, m, true);
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
    const px = new Uint8ClampedArray(W * H * 4);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // Zeile 0 von readPixels = Clip −1 = Norden (y0) – passt zur Bildzeile oben. Glas: Farbe ist vormultipliziert → zurückrechnen
    for (let i = 0; i < px.length; i += 4) { const a = px[i + 3]; if (a > 0 && a < 255) { const f = 255 / a; px[i] = Math.min(255, px[i] * f); px[i + 1] = Math.min(255, px[i + 1] * f); px[i + 2] = Math.min(255, px[i + 2] * f); } }
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    cv.getContext('2d').putImageData(new ImageData(px, W, H), 0, 0);
    this.app.scene = null; this.inst = null;
    return { bild: cv, ox: -b.x0 * s, oy: -b.y0 * s, s };
  }
}
