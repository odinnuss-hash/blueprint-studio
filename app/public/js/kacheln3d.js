// 3D-Vorschaubilder für die Kachelansicht der Ablage: ein eigenes, unsichtbares WebGL-Feld (gleicher Renderer wie die
// 3D-Ansicht, mit echten Modellen wenn eingeschaltet) zeichnet die Blaupausen nacheinander; das Bild wird in die
// Kachel kopiert und gemerkt. Gezeichnet wird nur, was sichtbar ist (IntersectionObserver).
import { View3DGL } from './view3dgl.js';
import { buildScene, sceneBounds } from './scene.js';

const B = 320, H = 210; // Größe des Zeichenfelds (CSS-Pixel)

export class Kacheln3D {
  constructor(app) {
    this.app = app;
    this.cache = new Map(); // Schlüssel → ImageBitmap/Canvas
    this.warte = []; this.laeuft = false;
    this.io = new IntersectionObserver((ents) => {
      for (const e of ents) if (e.isIntersecting) { this.io.unobserve(e.target); this.warte.push(e.target); }
      this.pumpe();
    }, { rootMargin: '150px' });
  }
  ansicht() {
    if (this.view !== undefined) return this.view;
    const cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = `position:fixed;left:-10000px;top:0;width:${B}px;height:${H}px;pointer-events:none`;
    document.body.appendChild(cv);
    this.stub = { scene: null, sel: new Set(), level: -1, onModelsState() {}, setSel() {} };
    try { this.view = View3DGL.supported() ? new View3DGL(cv, this.stub) : null; } catch { this.view = null; }
    if (this.view) { this.view.yaw = 45; this.view.pitch = 30; }
    return this.view;
  }
  /** Kachel-Zeichenflächen (canvas[data-quelle]) anmelden; data-quelle = Abfrage für /api/blueprint */
  beobachten(canvasse) {
    // schon sichtbare gleich zeichnen (ohne auf den Beobachter zu warten), den Rest beim Scrollen
    for (const c of canvasse) {
      if (this.zeigeAusCache(c)) continue;
      const r = c.getBoundingClientRect();
      if (r.width && r.bottom > -150 && r.top < innerHeight + 150) this.warte.push(c); else this.io.observe(c);
    }
    this.pumpe();
  }
  zeigeAusCache(c) {
    const bild = this.cache.get(c.dataset.quelle);
    if (!bild) return false;
    const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(bild, 0, 0, c.width, c.height);
    c.classList.add('fertig');
    return true;
  }
  async pumpe() {
    if (this.laeuft) return;
    this.laeuft = true;
    try {
      while (this.warte.length) {
        const c = this.warte.shift();
        if (!c.isConnected || this.zeigeAusCache(c)) continue;
        const v = this.ansicht();
        if (!v || !this.app.kat) { c.classList.add('ohne'); continue; }
        try {
          if (v.useModels) await v.loadModels();
          const r = await fetch('/api/blueprint?' + c.dataset.quelle, { cache: 'no-store' });
          const bp = await r.json(); if (!r.ok) throw new Error(bp.fehler || r.status);
          const scene = buildScene(bp, this.app.kat);
          scene.bounds = sceneBounds(scene);
          if (!scene.bounds) { c.classList.add('ohne'); continue; }
          this.stub.scene = scene; v.inst = null;
          v.fit(scene.bounds); // zeichnet sofort
          const kopie = document.createElement('canvas'); kopie.width = v.cv.width; kopie.height = v.cv.height;
          kopie.getContext('2d').drawImage(v.cv, 0, 0);
          this.cache.set(c.dataset.quelle, kopie);
          if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value);
          this.zeigeAusCache(c);
        } catch { c.classList.add('ohne'); }
        await new Promise((res) => setTimeout(res, 0)); // Oberfläche zwischendurch atmen lassen
      }
    } finally { this.laeuft = false; this.stub && (this.stub.scene = null); }
  }
  /** nach Änderungen (Umbenennen, Löschen …) Bild einer Blaupause neu zeichnen lassen */
  vergessen(quelle) { if (quelle) this.cache.delete(quelle); else this.cache.clear(); }
}
