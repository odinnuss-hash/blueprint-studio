// Kartenansicht: Spielstand (.sav) als Draufsicht – WebGL2, Hunderttausende Teile flüssig.
import { colorFor } from './scene.js';
import { teilLabel } from './generator.js';
import { ungespeichert } from './dialog.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Weltgrenzen der Spielkarte (cm) – so deckt auch ein Kartenbild die Welt ab
export const WELT = [-324650, -375000, 425350, 375000]; // 7500 x 7500 m, wie die Kartenkacheln des Spiels

// Ebenen (Filter) – Reihenfolge = Liste links
const EBENEN = [
  ['bau', 'Fundamente, Wände, Dächer', '#6b7280'],
  ['saeule', 'Säulen & Träger', '#9aa0a8'],
  ['prod', 'Produktion', '#e8a33d'],
  ['energie', 'Energie', '#f2d04b'],
  ['lager', 'Lager & Logistik', '#7fa7c9'],
  ['band', 'Förderbänder & Lifte', '#5b9bd5'],
  ['rohr', 'Rohre & Pumpen', '#3fb6a8'],
  ['bahn', 'Schienen & Bahnhöfe', '#c8ccd2'],
  ['hyper', 'Hypertubes', '#a98ad6'],
  ['strom', 'Strommasten & Leitungen', '#f7e08a'],
  ['schild', 'Schilder', '#3fb6a8'],
  ['deko', 'Sonstiges', '#b48ead'],
  ['natur', 'Ressourcen-Knoten', '#e05d5d'],
];
function ebeneFuer(cls, g) {
  if (/^BP_ResourceNode|^BP_Fracking/.test(cls)) return 'natur';
  if (/ConveyorBelt|ConveyorLift|ConveyorPole|ConveyorAttachment|ConveyorMonopole|ConveyorCeiling|ConveyorWall/.test(cls)) return 'band';
  if (/Pipeline|PipeSupport|PipePump|Valve|PipeJunction|PipeHyperSupport/.test(cls) && !/Hyper(?!Support)/.test(cls)) return 'rohr';
  if (/PipeHyper|Hypertube/.test(cls)) return 'hyper';
  if (/Railroad|Train|Station|FreightWagon|Locomotive|Docking/.test(cls)) return 'bahn';
  if (/Sign|Billboard/.test(cls)) return 'schild';
  if (/PowerPole|PowerLine|PowerSwitch|PowerStorage|PriorityPowerSwitch|Wire/.test(cls)) return 'strom';
  if (/Pillar|Beam/.test(cls)) return 'saeule';
  const k = g?.kategorie, u = g?.unterkategorie || '';
  if (k === 'Produktion') return 'prod';
  if (k === 'Energie') return 'energie';
  if (/Lager|Türme/.test(u) || /Storage|Container|Merger|Splitter/.test(cls)) return 'lager';
  if (/Foundation|Ramp|Wall|Roof|Frame|Stair|Walkway|Catwalk|QuarterPipe|Fence|Window|Door|Gate|Barrier|Ladder/.test(cls) || k === 'Organisation' || k === 'Wände') return 'bau';
  return 'deko';
}
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

// ------------------------------------------------------------------ Shader
const VS_BOX = `#version 300 es
layout(location=0) in vec2 corner;      // -0.5..0.5
layout(location=1) in vec4 posRot;      // x, y, cos, sin
layout(location=2) in vec4 box;         // Mittelpunkt-Versatz (lokal) x,y, Breite, Tiefe
layout(location=3) in vec4 color;
uniform vec2 uCenter; uniform float uScale; uniform vec2 uView;
out vec4 vColor;
void main() {
  // mindestens ~1.2 Pixel gross, damit kleine Teile beim Herauszoomen sichtbar bleiben
  vec2 size = max(box.zw * uScale, vec2(1.2)) / uScale;
  vec2 local = box.xy + corner * size;
  vec2 w = posRot.xy + vec2(local.x * posRot.z - local.y * posRot.w, local.x * posRot.w + local.y * posRot.z);
  vec2 s = (w - uCenter) * uScale;
  gl_Position = vec4(s.x / uView.x * 2.0, -s.y / uView.y * 2.0, 0.0, 1.0);
  vColor = color;
}`;
const FS = `#version 300 es
precision mediump float; in vec4 vColor; out vec4 o; void main() { o = vColor; }`;
const VS_LINE = `#version 300 es
layout(location=0) in vec2 pos; layout(location=1) in vec4 color;
uniform vec2 uCenter; uniform float uScale; uniform vec2 uView;
out vec4 vColor;
void main() { vec2 s = (pos - uCenter) * uScale; gl_Position = vec4(s.x / uView.x * 2.0, -s.y / uView.y * 2.0, 0.0, 1.0); vColor = color; }`;

const VS_BILD = `#version 300 es
layout(location=0) in vec2 pos; layout(location=1) in vec2 uv;
uniform vec2 uCenter; uniform float uScale; uniform vec2 uView;
out vec2 vUv;
void main() { vec2 s = (pos - uCenter) * uScale; gl_Position = vec4(s.x / uView.x * 2.0, -s.y / uView.y * 2.0, 0.0, 1.0); vUv = uv; }`;
const FS_BILD = `#version 300 es
precision mediump float; in vec2 vUv; uniform sampler2D uTex; uniform float uHell; out vec4 o;
void main() { o = vec4(texture(uTex, vUv).rgb * uHell, 1.0); }`;

function prog(gl, vs, fs) {
  const mk = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return { p, u: (n) => gl.getUniformLocation(p, n) };
}

export class Karte {
  constructor(app) {
    this.app = app;
    this.liste = null; this.id = null; this.meta = null; this.werte = null;
    this.aus = new Set(['natur']);
    this.cam = { x: (WELT[0] + WELT[2]) / 2, y: (WELT[1] + WELT[3]) / 2, s: 0.001 };
    this.sel = -1; this.selLinie = -1; this.suche = ''; this.markiert = new Set();
    this.bild = null;
    this.bound = false;
  }

  // ------------------------------------------------------------ Liste
  async show() {
    this.bind();
    if (!this.liste) await this.ladeListe();
    requestAnimationFrame(() => this.resize());
  }
  async ladeListe() {
    $('k-liste').innerHTML = '<div class="muted pad">Lese Spielstände …</div>';
    try {
      const r = await fetch('/api/karte/liste', { cache: 'no-store' });
      const j = await r.json();
      this.liste = [...j.spielstaende, ...(j.megaprints || [])]; this.kartenbild = j.kartenbild; this.editor3d = j.editor3d;
      $('k-bild').disabled = !j.kartenbild; $('k-bild').parentElement.title = j.kartenbild ? 'Spielwelt als Hintergrund' : 'Kein Kartenbild vorhanden – siehe Hilfe → Karte';
      $('k-3d').title = j.editor3d ? 'Im 3D-Editor öffnen: ' + j.editor3d : '3D-Editor nicht gefunden – siehe Hilfe → Karte';
      this.zeichne();
      $('k-ordner').textContent = j.ordner;
      this.renderListe();
    } catch (e) { $('k-liste').innerHTML = `<div class="err pad">${esc(e.message)}</div>`; }
  }
  renderListe() {
    const f = ($('k-filter').value || '').toLowerCase();
    const L = this.liste.filter((s) => !f || s.name.toLowerCase().includes(f) || s.sitzung.toLowerCase().includes(f));
    const zeile = (s) => `<button type="button" class="item${s.id === this.id ? ' on' : ''}" data-id="${esc(s.id)}">
      <span class="n">${esc(s.name)}</span><span class="m">${esc(s.sitzung)} · ${new Date(s.geaendert).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} · ${(s.groesse / 1e6).toFixed(1)} MB${s.version && s.version < 46 ? ' · alt' : ''}</span></button>`;
    const sv = L.filter((s) => s.art !== 'megaprint'), mp = L.filter((s) => s.art === 'megaprint');
    $('k-liste').innerHTML = (sv.map(zeile).join('') || '<div class="muted pad">Keine Spielstände gefunden.</div>')
      + (mp.length ? `<div class="k-gruppe">Megaprints (${mp.length})</div>` + mp.map(zeile).join('') : '');
  }

  // ------------------------------------------------------------ Laden
  async lade(id) {
    this.id = id; this.renderListe();
    $('k-loading').hidden = false;
    $('k-loading-text').textContent = 'Spielstand wird gelesen … (beim ersten Mal einige Sekunden)';
    try {
      const r = await fetch('/api/karte/daten?id=' + encodeURIComponent(id), { cache: 'no-store' });
      if (!r.ok) { let m = r.status; try { m = (await r.json()).fehler; } catch { /* */ } throw new Error(m); }
      const buf = await r.arrayBuffer();
      const dv = new DataView(buf), jl = dv.getUint32(0, true);
      this.meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, jl)));
      const off = 4 + jl + ((4 - ((4 + jl) % 4)) % 4);
      this.werte = new Float32Array(buf, off, this.meta.anzahl * 6);
      this.vorbereiten();
      this.sel = -1; this.selLinie = -1; this.bereich = null; this.bereichZahl = null; this.bereichErgebnis = null; this.markiert.clear(); this.suche = ''; $('k-bauteil').value = '';
      this.einpassen();
      this.renderInfo();
    } catch (e) {
      this.app.toast('Spielstand konnte nicht gelesen werden: ' + e.message, 'err');
    } finally { $('k-loading').hidden = true; }
  }

  /** Klassen -> Ebene, Farbe, Masse; Raster fuer Klick-Suche */
  vorbereiten() {
    const kat = this.app.kat?.gebaeude || {};
    const M = this.meta;
    this.kinfo = M.klassen.map((c) => {
      const g = kat[c];
      const eb = ebeneFuer(c, g);
      let farbe = eb === 'natur' ? '#e05d5d' : colorFor(g, c);
      if (eb === 'band' && !g) farbe = '#5b9bd5';
      const b = g?.box;
      let box = b ? [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, b[3] - b[0], b[4] - b[1]] : (eb === 'natur' ? [0, 0, 600, 600] : [0, 0, 200, 200]);
      if (/^Build_Beam/.test(c) && b) box = [0, 0, 400, 50];
      return { cls: c, name: g ? teilLabel(this.app.kat, c) : c.replace(/^Build_|^BP_|_C$/g, '').replace(/_/g, ' '), eb, farbe, rgb: hexRgb(farbe), box, n: 0 };
    });
    const W = this.werte, n = M.anzahl;
    for (let i = 0; i < n; i++) this.kinfo[W[i * 6 + 4]].n++;
    for (const l of M.linien) this.kinfo[l[0]].n++;
    this.zaehler = {};
    for (const k of this.kinfo) this.zaehler[k.eb] = (this.zaehler[k.eb] || 0) + k.n;
    this.zaehler.strom = (this.zaehler.strom || 0) + M.leitungen.length / 4;
    // Raster 50 m
    const G = 5000; this.raster = new Map();
    for (let i = 0; i < n; i++) {
      const key = Math.floor(W[i * 6] / G) * 100000 + Math.floor(W[i * 6 + 1] / G);
      let a = this.raster.get(key); if (!a) this.raster.set(key, a = []); a.push(i);
    }
    this.renderEbenen();
    this.puffer();
  }

  renderEbenen() {
    $('k-ebenen').innerHTML = EBENEN.map(([id, name, f]) => `<label class="check keb"><input type="checkbox" data-eb="${id}"${this.aus.has(id) ? '' : ' checked'}>
      <span class="sw" style="background:${f}"></span><span class="n">${esc(name)}</span><span class="c">${(this.zaehler?.[id] || 0).toLocaleString('de-DE')}</span></label>`).join('');
  }

  // ------------------------------------------------------------ WebGL
  initGL() {
    if (this.gl) return true;
    const cv = $('k-canvas');
    const gl = cv.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
    if (!gl) { $('k-hinweis').textContent = 'WebGL2 wird nicht unterstützt.'; return false; }
    this.gl = gl;
    this.pBox = prog(gl, VS_BOX, FS); this.pLine = prog(gl, VS_LINE, FS); this.pBild = prog(gl, VS_BILD, FS_BILD);
    this.vaoBox = gl.createVertexArray(); this.vaoLine = gl.createVertexArray(); this.vaoBg = gl.createVertexArray();
    gl.bindVertexArray(this.vaoBox);
    const q = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, q);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.bInst = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.bInst);
    for (let a = 1; a <= 3; a++) { gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 4, gl.FLOAT, false, 48, (a - 1) * 16); gl.vertexAttribDivisor(a, 1); }
    gl.bindVertexArray(this.vaoLine);
    this.bLine = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.bLine);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);
    gl.bindVertexArray(null);
    return true;
  }

  puffer() {
    if (!this.initGL() || !this.meta) return;
    const gl = this.gl, W = this.werte, M = this.meta, K = this.kinfo;
    // Hervorheben: angehakte Arten (rechts) und/oder Suchtext – alles andere wird abgedunkelt, bleibt aber sichtbar
    const q = this.suche.toLowerCase(), mk = this.markiert;
    const filter = !!q || mk.size > 0;
    const treffer = (k) => (mk.size ? mk.has(k.cls) : true) && (!q || k.name.toLowerCase().includes(q) || k.cls.toLowerCase().includes(q));
    const DUNKEL = 0.22;
    $('k-normal').hidden = !filter;
    // Kaesten
    const inst = new Float32Array(M.anzahl * 12);
    let m = 0;
    this.sichtbar = new Uint8Array(M.anzahl);
    const hv = (id) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v * 100 : null; };
    const hmin = hv('k-hmin'), hmax = hv('k-hmax');
    for (let i = 0; i < M.anzahl; i++) {
      const k = K[W[i * 6 + 4]];
      if (this.aus.has(k.eb)) continue;
      const z = W[i * 6 + 2];
      if ((hmin !== null && z < hmin) || (hmax !== null && z > hmax)) continue;
      const hit = !filter || treffer(k);
      this.sichtbar[i] = 1;
      const yaw = W[i * 6 + 3] * Math.PI / 180;
      const o = m * 12;
      inst[o] = W[i * 6]; inst[o + 1] = W[i * 6 + 1]; inst[o + 2] = Math.cos(yaw); inst[o + 3] = Math.sin(yaw);
      inst[o + 4] = k.box[0]; inst[o + 5] = k.box[1]; inst[o + 6] = k.box[2]; inst[o + 7] = k.box[3];
      const dim = hit ? 1 : DUNKEL, sel = i === this.sel;
      inst[o + 8] = sel ? 1 : k.rgb[0] * dim; inst[o + 9] = sel ? 0.55 : k.rgb[1] * dim; inst[o + 10] = sel ? 0.1 : k.rgb[2] * dim; inst[o + 11] = 1;
      m++;
    }
    this.nInst = m;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bInst); gl.bufferData(gl.ARRAY_BUFFER, inst.subarray(0, m * 12), gl.STATIC_DRAW);
    // Linien (Baender, Rohre, Schienen, Hypertubes, Stromleitungen)
    const lv = [];
    const seg = (x1, y1, x2, y2, c) => lv.push(x1, y1, c[0], c[1], c[2], 1, x2, y2, c[0], c[1], c[2], 1);
    M.linien.forEach((l, li) => {
      const k = K[l[0]];
      if (this.aus.has(k.eb)) return;
      const d = !filter || treffer(k) ? 1 : DUNKEL;
      const c = li === this.selLinie ? [1, 0.55, 0.1] : [k.rgb[0] * d, k.rgb[1] * d, k.rgb[2] * d];
      for (let j = 1; j + 3 < l.length; j += 2) seg(l[j], l[j + 1], l[j + 2], l[j + 3], c);
    });
    if (!this.aus.has('strom')) {
      const d = filter && !(mk.has('Build_PowerLine_C')) ? DUNKEL : 1;
      const c = [0.97 * d, 0.88 * d, 0.54 * d];
      for (let j = 0; j < M.leitungen.length; j += 4) seg(M.leitungen[j], M.leitungen[j + 1], M.leitungen[j + 2], M.leitungen[j + 3], c);
    }
    this.nLine = lv.length / 6;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bLine); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lv), gl.STATIC_DRAW);
    this.zeichne();
  }

  resize() {
    const cv = $('k-canvas'); if (!cv || !cv.clientWidth) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr);
    this.zeichne();
  }

  zeichne() {
    if (!this.gl) { this.initGL(); if (!this.gl) return; }
    const gl = this.gl, cv = gl.canvas, dpr = window.devicePixelRatio || 1;
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0.075, 0.085, 0.1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const s = this.cam.s * dpr;
    const set = (P) => { gl.useProgram(P.p); gl.uniform2f(P.u('uCenter'), this.cam.x, this.cam.y); gl.uniform1f(P.u('uScale'), s); gl.uniform2f(P.u('uView'), cv.width, cv.height); };
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    // Raster + Weltgrenze als Linien
    if ($('k-bild').checked) this.zeichneBild(gl, set);
    set(this.pLine);
    this.zeichneRaster(gl);
    if (this.meta) {
      gl.bindVertexArray(this.vaoBox); set(this.pBox);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.nInst || 0);
      gl.bindVertexArray(this.vaoLine); set(this.pLine);
      gl.drawArrays(gl.LINES, 0, this.nLine || 0);
      // Spieler
      this.zeichneMarker(gl);
      this.zeichneBereich(gl);
    }
    gl.bindVertexArray(null);
    this.updateMassstab();
  }

  /** Hintergrund: 4 Kacheln der Spielkarte (Map_X-Y, X = Spalte, Y = Zeile), je 3750 x 3750 m */
  ladeBild() {
    if (this.kacheln || !this.gl) return;
    const gl = this.gl;
    this.kacheln = [];
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const k = { x, y, tex: null };
      this.kacheln.push(k);
      const img = new Image();
      img.onload = () => {
        k.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, k.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.zeichne();
      };
      img.src = `/api/karte/kachel/Map_${x}-${y}`;
    }
    const v = [];
    const W = (WELT[2] - WELT[0]) / 2, H = (WELT[3] - WELT[1]) / 2;
    for (const k of this.kacheln) {
      const x0 = WELT[0] + k.x * W, y0 = WELT[1] + k.y * H, x1 = x0 + W, y1 = y0 + H;
      v.push(x0, y0, 0, 0, x1, y0, 1, 0, x0, y1, 0, 1, x1, y1, 1, 1);
    }
    this.vaoBild = gl.createVertexArray(); gl.bindVertexArray(this.vaoBild);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);
  }
  zeichneBild(gl, set) {
    if (!this.kartenbild) return;
    this.ladeBild();
    set(this.pBild);
    gl.uniform1f(this.pBild.u('uHell'), this.meta ? 0.62 : 0.9);
    gl.uniform1i(this.pBild.u('uTex'), 0); gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(this.vaoBild);
    this.kacheln.forEach((k, i) => { if (k.tex) { gl.bindTexture(gl.TEXTURE_2D, k.tex); gl.drawArrays(gl.TRIANGLE_STRIP, i * 4, 4); } });
  }

  zeichneRaster(gl) {
    if (!this.bRaster) {
      const v = [], c = [0.22, 0.25, 0.3, 1], cb = [0.4, 0.45, 0.52, 1];
      const L = (x1, y1, x2, y2, col) => v.push(x1, y1, ...col, x2, y2, ...col);
      for (let x = Math.ceil(WELT[0] / 50000) * 50000; x <= WELT[2]; x += 50000) L(x, WELT[1], x, WELT[3], c);
      for (let y = Math.ceil(WELT[1] / 50000) * 50000; y <= WELT[3]; y += 50000) L(WELT[0], y, WELT[2], y, c);
      L(WELT[0], WELT[1], WELT[2], WELT[1], cb); L(WELT[2], WELT[1], WELT[2], WELT[3], cb); L(WELT[2], WELT[3], WELT[0], WELT[3], cb); L(WELT[0], WELT[3], WELT[0], WELT[1], cb);
      this.bRaster = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.bRaster); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
      this.nRaster = v.length / 6;
      this.vaoRaster = gl.createVertexArray(); gl.bindVertexArray(this.vaoRaster);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);
    }
    gl.bindVertexArray(this.vaoRaster); gl.drawArrays(gl.LINES, 0, this.nRaster);
  }

  zeichneBereich(gl) {
    const b = this.bereich; if (!b) return;
    const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    const c = [1, 0.6, 0.14, 1], v = [];
    const L = (a, bb, cc, d) => v.push(a, bb, ...c, cc, d, ...c);
    if (b.poly) {
      const P = b.poly;
      for (let i = 0; i < P.length; i++) { const a = P[i], n = P[(i + 1) % P.length]; L(a[0], a[1], n[0], n[1]); }
    } else
    // doppelte Linie fuer bessere Sichtbarkeit
    for (const o of [0, 1.5 / this.cam.s]) { L(x0 - o, y0 - o, x1 + o, y0 - o); L(x1 + o, y0 - o, x1 + o, y1 + o); L(x1 + o, y1 + o, x0 - o, y1 + o); L(x0 - o, y1 + o, x0 - o, y0 - o); }
    if (!this.bBer) { this.bBer = gl.createBuffer(); this.vaoBer = gl.createVertexArray(); gl.bindVertexArray(this.vaoBer); gl.bindBuffer(gl.ARRAY_BUFFER, this.bBer); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8); }
    gl.bindVertexArray(this.vaoBer); gl.bindBuffer(gl.ARRAY_BUFFER, this.bBer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINES, 0, v.length / 6);
  }

  /** Bereich gewaehlt: zaehlen (sichtbare Ebenen + Hoehenfilter) und Speichern anbieten */
  bereichInfo() {
    const b = this.bereich, W = this.werte, M = this.meta;
    const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    const hv = (id) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v * 100 : null; };
    const hmin = hv('k-hmin'), hmax = hv('k-hmax');
    let n = 0, lb = 0;
    for (let i = 0; i < M.anzahl; i++) {
      const x = W[i * 6], y = W[i * 6 + 1], z = W[i * 6 + 2];
      if (x < x0 || x > x1 || y < y0 || y > y1 || (hmin !== null && z < hmin) || (hmax !== null && z > hmax) || (b.poly && !imPoly(b.poly, x, y))) continue;
      const k = this.kinfo[W[i * 6 + 4]];
      if (this.aus.has(k.eb) || k.eb === 'natur' || !k.cls.startsWith('Build_')) continue;
      n++; if (W[i * 6 + 5]) lb++;
    }
    let lin = 0;
    for (const l of M.linien) { const k = this.kinfo[l[0]]; if (!this.aus.has(k.eb) && l[1] >= x0 && l[1] <= x1 && l[2] >= y0 && l[2] <= y1 && (!b.poly || imPoly(b.poly, l[1], l[2]))) lin++; }
    this.bereichZahl = { n: n + lin, lb, b: [x0, y0, x1, y1], hmin, hmax, poly: b.poly || null };
    this.renderInfo();
  }

  bereichDaten() {
    const z = this.bereichZahl;
    return { x0: z.b[0], y0: z.b[1], x1: z.b[2], y1: z.b[3], z0: z.hmin, z1: z.hmax, poly: z.poly ? z.poly.map((q) => [Math.round(q[0]), Math.round(q[1])]) : null };
  }
  ohneKlassen() {
    const ohne = this.kinfo.filter((k) => this.aus.has(k.eb)).map((k) => k.cls);
    if (this.aus.has('strom')) ohne.push('Build_PowerLine_C');
    return ohne;
  }
  /** Bereich in der eigenen 3D-Ansicht der App zeigen (ohne zu speichern) */
  async bereichIn3D() {
    if (!this.bereichZahl) return;
    const b = $('k-bp-3d'); if (b) { b.disabled = true; b.textContent = 'Wird aufgebaut …'; }
    try {
      const r = await fetch('/api/karte/vorschau', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' }, body: JSON.stringify({ id: this.id, ohne: this.ohneKlassen(), bereich: this.bereichDaten() }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status);
      if (this.app.dirty() && !(await ungespeichert('Trotzdem den Kartenausschnitt öffnen?'))) return;
      this.app.bp = j; this.app.setMode('editor'); this.app.openScene();
      if (this.app.mode !== '3d') $('v3d').click();
      $('pathtext').textContent = `Kartenausschnitt · ${this.meta.name} · ${j.info.objekte} Objekte (nur ansehen – „Als Blaupause speichern“ in der Karte)`;
    } catch (e) { this.app.toast(e.message, 'err'); }
    finally { const bb = $('k-bp-3d'); if (bb) { bb.disabled = false; bb.textContent = 'In 3D ansehen'; } }
  }

  async bereichSpeichern() {
    const z = this.bereichZahl; if (!z) return;
    const name = $('k-bp-name').value.trim(), session = $('k-bp-ziel').value;
    if (!name || /[\\/:*?"<>|]/.test(name)) { this.app.toast('Bitte einen gültigen Namen angeben (ohne \\ / : * ? " < > |).', 'err'); return; }
    const ohne = this.ohneKlassen();
    $('k-bp-ok').disabled = true; $('k-bp-ok').textContent = 'Wird erstellt …';
    try {
      const r = await fetch('/api/karte/blaupause', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' },
        body: JSON.stringify({ id: this.id, session, name, ohne, bereich: this.bereichDaten() }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status);
      const i = j.info, fehlt = Object.entries(i.fehlend || {});
      this.letzteBp = { session, name };
      this.app.zaehlerAktualisieren(); if ($('session').value === session) this.app.loadList();
      this.app.toast(`Blaupause „${name}“ gespeichert: ${i.gebaeude} Gebäude, ${i.leichtbau} Leichtbau-Teile, ${i.bestandteile} Anschlüsse/Bestandteile.${fehlt.length ? ` Ohne Vorlage übersprungen: ${fehlt.map(([c, n]) => n + '× ' + c.replace(/^Build_|_C$/g, '')).join(', ')}.` : ''}${i.falscheVersion ? ` ${i.falscheVersion} ältere Objekte übersprungen.` : ''}`, fehlt.length || i.falscheVersion ? 'err' : 'ok');
      this.bereichErgebnis = j.info; this.renderInfo();
    } catch (e) { this.app.toast(e.message, 'err'); }
    finally { const b = $('k-bp-ok'); if (b) { b.disabled = false; b.textContent = 'Als Blaupause speichern'; } }
  }

  zeichneMarker(gl) {
    const pts = this.meta.spieler || [];
    if (!pts.length) return;
    const r = 8 / this.cam.s, v = [];
    for (const [x, y] of pts) {
      const c = [1, 0.35, 0.35, 1];
      v.push(x - r, y, ...c, x + r, y, ...c, x, y - r, ...c, x, y + r, ...c);
    }
    if (!this.bMark) { this.bMark = gl.createBuffer(); this.vaoMark = gl.createVertexArray(); gl.bindVertexArray(this.vaoMark); gl.bindBuffer(gl.ARRAY_BUFFER, this.bMark); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8); }
    gl.bindVertexArray(this.vaoMark); gl.bindBuffer(gl.ARRAY_BUFFER, this.bMark); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINES, 0, v.length / 6);
  }

  // ------------------------------------------------------------ Kamera
  einpassen() {
    const cv = $('k-canvas');
    const b = this.meta?.grenzenBau || this.baugrenzen() || WELT;
    const w = Math.max(b[2] - b[0], 5000), h = Math.max(b[3] - b[1], 5000);
    this.cam.x = (b[0] + b[2]) / 2; this.cam.y = (b[1] + b[3]) / 2;
    this.cam.s = Math.min(cv.clientWidth / w, cv.clientHeight / h) * 0.92;
    this.zeichne();
  }
  welt() {
    const cv = $('k-canvas');
    this.cam.x = (WELT[0] + WELT[2]) / 2; this.cam.y = (WELT[1] + WELT[3]) / 2;
    this.cam.s = Math.min(cv.clientWidth / (WELT[2] - WELT[0]), cv.clientHeight / (WELT[3] - WELT[1])) * 0.95;
    this.zeichne();
  }
  /** Bereich der eigenen Bauten (ohne Ressourcen-Knoten), robust gegen Ausreisser */
  baugrenzen() {
    if (!this.meta) return null;
    const W = this.werte, xs = [], ys = [];
    for (let i = 0; i < this.meta.anzahl; i += Math.max(1, Math.floor(this.meta.anzahl / 20000))) {
      if (this.kinfo[W[i * 6 + 4]].eb === 'natur') continue;
      xs.push(W[i * 6]); ys.push(W[i * 6 + 1]);
    }
    if (!xs.length) return null;
    xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    const q = (a, f) => a[Math.min(a.length - 1, Math.max(0, Math.round(f * (a.length - 1))))];
    return [q(xs, 0.002) - 5000, q(ys, 0.002) - 5000, q(xs, 0.998) + 5000, q(ys, 0.998) + 5000];
  }
  zuWelt(px, py) {
    const cv = $('k-canvas');
    return [this.cam.x + (px - cv.clientWidth / 2) / this.cam.s, this.cam.y + (py - cv.clientHeight / 2) / this.cam.s];
  }
  updateMassstab() {
    // Massstabsbalken: runde Laenge ~ 100 px
    const m = 100 / this.cam.s / 100; // Meter pro 100 px
    const p = Math.pow(10, Math.floor(Math.log10(m))), n = [1, 2, 5, 10].find((f) => f * p >= m) * p;
    $('k-massstab').style.width = (n * 100 * this.cam.s) + 'px';
    $('k-massstab-t').textContent = n >= 1000 ? (n / 1000) + ' km' : n + ' m';
  }

  // ------------------------------------------------------------ Auswahl
  finde(wx, wy) {
    if (!this.meta) return { i: -1, l: -1 };
    const W = this.werte, G = 5000, tol = 4 / this.cam.s;
    let best = -1;
    const cx = Math.floor(wx / G), cy = Math.floor(wy / G);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const a = this.raster.get((cx + dx) * 100000 + (cy + dy)); if (!a) continue;
      for (const i of a) {
        if (!this.sichtbar[i]) continue;
        const k = this.kinfo[W[i * 6 + 4]];
        const yaw = -W[i * 6 + 3] * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw);
        const rx = wx - W[i * 6], ry = wy - W[i * 6 + 1];
        const lx = rx * c - ry * s - k.box[0], ly = rx * s + ry * c - k.box[1];
        if (Math.abs(lx) <= k.box[2] / 2 + tol && Math.abs(ly) <= k.box[3] / 2 + tol && i > best) best = i;
      }
    }
    // Linien nur, wenn kein Bauteil getroffen wurde oder Linie naeher liegt
    let bl = -1, bd = 6 / this.cam.s;
    this.meta.linien.forEach((l, li) => {
      const k = this.kinfo[l[0]]; if (this.aus.has(k.eb)) return;
      for (let j = 1; j + 3 < l.length; j += 2) {
        const d = distSeg(wx, wy, l[j], l[j + 1], l[j + 2], l[j + 3]);
        if (d < bd) { bd = d; bl = li; }
      }
    });
    if (bl >= 0 && (best < 0 || bd < 2 / this.cam.s)) return { i: -1, l: bl };
    return { i: best, l: -1 };
  }
  waehle(r) {
    this.sel = r.i; this.selLinie = r.l;
    this.puffer(); this.renderInfo();
  }

  renderInfo() {
    const M = this.meta;
    if (!M) { $('k-info').innerHTML = '<div class="muted">Links einen Spielstand wählen.</div>'; return; }
    const d = new Date(this.liste?.find((x) => x.id === this.id)?.geaendert);
    let html = `<div class="label">${M.art === 'megaprint' ? 'Megaprint' : 'Spielstand'}</div><div class="k-kv"><span>Name</span><b>${esc(M.name)}</b><span>Sitzung</span><b>${esc(M.sitzung)}</b>
      <span>Gespeichert</span><b>${isNaN(d) ? '–' : d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</b>
      <span>Bauteile</span><b>${(M.anzahl + M.linien.length).toLocaleString('de-DE')}</b><span>davon Leichtbau</span><b>${M.leichtbau.toLocaleString('de-DE')}</b>
      <span>Stromleitungen</span><b>${(M.leitungen.length / 4).toLocaleString('de-DE')}</b>${M.kreativ ? '<span>Modus</span><b>Kreativ</b>' : ''}
      ${M.mods?.length ? `<span>Mods</span><b title="${esc(M.mods.join(', '))}">${M.mods.length}</b>` : ''}</div>`;
    const W = this.werte;
    if (this.bereich && this.bereichZahl) {
      const z = this.bereichZahl, mp = this.id?.startsWith('mp:');
      const sessions = (this.app.cfg?.sessions || []).filter((x) => !x.lib).map((x) => x.name);
      const vorschlag = (M.name || 'Karte').replace(/[^A-Za-z0-9ÄÖÜäöüß_-]+/g, '_').slice(0, 18) + '_' + Math.round((z.b[0] + z.b[2]) / 200) + '_' + Math.round((z.b[1] + z.b[3]) / 200);
      html += `<div class="label">${z.poly ? 'Freihand-Bereich' : 'Bereich'} → Blaupause</div><div class="k-sel">
        <div class="k-kv"><span>Größe</span><b>${m0(z.b[2] - z.b[0])} × ${m0(z.b[3] - z.b[1])} m</b><span>Bauteile</span><b>${z.n.toLocaleString('de-DE')}</b><span>davon Leichtbau</span><b>${z.lb.toLocaleString('de-DE')}</b>
        ${z.hmin !== null || z.hmax !== null ? `<span>Höhe</span><b>${z.hmin !== null ? m0(z.hmin) : '…'} – ${z.hmax !== null ? m0(z.hmax) : '…'} m</b>` : ''}</div>
        ${mp ? '<div class="hint">Aus Megaprints lässt sich (noch) keine Blaupause erzeugen – bitte einen Spielstand wählen.</div>' : `
        <label class="nv-lbl" for="k-bp-name">Name</label><input id="k-bp-name" type="text" value="${esc(this.bpName || vorschlag)}" spellcheck="false">
        <label class="nv-lbl" for="k-bp-ziel">Speichern in</label><select id="k-bp-ziel">${sessions.map((s) => `<option${s === (this.bpZiel || this.app.spielSession()) ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
        <div class="hint">Ausgeblendete Ebenen und der Höhenfilter gelten mit. ${z.n > 5000 ? '<b>Sehr groß</b> – das Spiel braucht dafür Mods wie Blueprint Designer Plus.' : ''}</div>
        <div class="nv-btns"><button type="button" class="btn primary small" id="k-bp-ok">Als Blaupause speichern</button><button type="button" class="btn small" id="k-bp-3d" title="Ausschnitt in der 3D-Ansicht der App zeigen (mit Spielmodellen) – nichts wird gespeichert">In 3D ansehen</button><button type="button" class="btn small" id="k-bp-weg">Verwerfen</button></div>
        ${this.bereichErgebnis ? `<div class="hint">Gespeichert: ${this.bereichErgebnis.objekte.toLocaleString('de-DE')} Objekte · <a href="#" id="k-bp-open">in „Blaupause“ öffnen</a></div>` : ''}`}
      </div>`;
    }
    if (this.sel >= 0) {
      const i = this.sel, k = this.kinfo[W[i * 6 + 4]];
      html += `<div class="label">Auswahl</div><div class="k-sel"><b>${esc(k.name)}</b><div class="muted">${esc(k.cls)}</div>
        <div class="k-kv"><span>X</span><b>${m1(W[i * 6])} m</b><span>Y</span><b>${m1(W[i * 6 + 1])} m</b><span>Höhe</span><b>${m1(W[i * 6 + 2])} m</b><span>Drehung</span><b>${Math.round(W[i * 6 + 3])}°</b>
        <span>Gleiche im Spielstand</span><b>${k.n.toLocaleString('de-DE')}</b>${W[i * 6 + 5] ? '<span>Gespeichert als</span><b>Leichtbau</b>' : ''}</div>
        <button type="button" class="btn" id="k-gleiche">Nur diese Art zeigen</button></div>`;
    } else if (this.selLinie >= 0) {
      const l = M.linien[this.selLinie], k = this.kinfo[l[0]];
      let len = 0; for (let j = 1; j + 3 < l.length; j += 2) len += Math.hypot(l[j + 2] - l[j], l[j + 3] - l[j + 1]);
      html += `<div class="label">Auswahl</div><div class="k-sel"><b>${esc(k.name)}</b><div class="muted">${esc(k.cls)}</div>
        <div class="k-kv"><span>Länge (Draufsicht)</span><b>${m1(len)} m</b><span>Start</span><b>${m1(l[1])} / ${m1(l[2])} m</b><span>Gleiche im Spielstand</span><b>${k.n.toLocaleString('de-DE')}</b></div>
        <button type="button" class="btn" id="k-gleiche">Nur diese Art zeigen</button></div>`;
    }
    // Gebaeude nach Art (wie die Gebaeude-Liste von satisfactory-calculator), anklickbar
    // Anhaken = nur diese Arten hell zeigen, alles andere abdunkeln (mehrere moeglich)
    const reihe = (k) => `<label class="k-toprow"><input type="checkbox" data-cls="${esc(k.cls)}"${this.markiert.has(k.cls) ? ' checked' : ''}><span class="sw" style="background:${k.farbe}"></span><span class="n">${esc(k.name)}</span><span class="c">${k.n.toLocaleString('de-DE')}</span></label>`;
    if (this.markiert.size || this.suche) html += `<div class="k-filterbar"><span>${this.markiert.size ? `${this.markiert.size} Art${this.markiert.size === 1 ? '' : 'en'} hervorgehoben` : 'Suche hervorgehoben'} – Rest abgedunkelt</span><button type="button" class="btn small" id="k-reset">Alle normal zeigen</button></div>`;
    const gruppen = [['prod', 'Produktion'], ['energie', 'Energie'], ['lager', 'Lager & Logistik'], ['bahn', 'Bahn'], ['band', 'Förderbänder & Lifte'], ['rohr', 'Rohre & Pumpen'], ['hyper', 'Hypertubes']];
    const offen = this.offeneGruppen || (this.offeneGruppen = new Set(['prod', 'energie']));
    html += '<div class="label">Gebäude nach Art</div><div class="k-top">';
    for (const [eb, titel] of gruppen) {
      const L = this.kinfo.filter((k) => k.eb === eb && k.n).sort((a, b) => b.n - a.n);
      if (!L.length) continue;
      const sum = L.reduce((a, k) => a + k.n, 0);
      const alle = L.every((k) => this.markiert.has(k.cls)), teil = !alle && L.some((k) => this.markiert.has(k.cls));
      html += `<details class="k-grp" data-eb="${eb}"${offen.has(eb) ? ' open' : ''}><summary><input type="checkbox" class="k-grpcb" data-eb="${eb}"${alle ? ' checked' : ''}${teil ? ' data-teil="1"' : ''} title="Ganze Gruppe hervorheben" aria-label="${esc(titel)} hervorheben"><span class="n">${esc(titel)}</span><span class="c">${sum.toLocaleString('de-DE')}</span></summary>${L.map(reihe).join('')}</details>`;
    }
    const top = [...this.kinfo].filter((k) => k.eb !== 'natur').sort((a, b) => b.n - a.n).slice(0, 10);
    html += `</div><div class="label">Häufigste Bauteile</div><div class="k-top">${top.map(reihe).join('')}</div>`;
    const scroll = $('k-info').scrollTop;
    $('k-info').innerHTML = html;
    $('k-info').scrollTop = scroll;
    $('k-gleiche')?.addEventListener('click', () => {
      const k = this.sel >= 0 ? this.kinfo[W[this.sel * 6 + 4]] : this.kinfo[M.linien[this.selLinie][0]];
      this.markiert = new Set([k.cls]); this.puffer(); this.renderInfo();
    });
    const info = $('k-info');
    info.querySelectorAll('.k-toprow input').forEach((c) => c.addEventListener('change', () => {
      if (c.checked) this.markiert.add(c.dataset.cls); else this.markiert.delete(c.dataset.cls);
      this.puffer(); this.renderInfo();
    }));
    info.querySelectorAll('.k-grpcb').forEach((c) => {
      if (c.dataset.teil) c.indeterminate = true;
      c.addEventListener('click', (e) => e.stopPropagation());
      c.addEventListener('change', () => {
        for (const k of this.kinfo) if (k.eb === c.dataset.eb && k.n) { if (c.checked) this.markiert.add(k.cls); else this.markiert.delete(k.cls); }
        this.puffer(); this.renderInfo();
      });
    });
    $('k-reset')?.addEventListener('click', () => this.zuruecksetzen());
    $('k-bp-ok')?.addEventListener('click', () => this.bereichSpeichern());
    $('k-bp-3d')?.addEventListener('click', () => this.bereichIn3D());
    $('k-bp-name')?.addEventListener('input', (e) => { this.bpName = e.target.value; });
    $('k-bp-ziel')?.addEventListener('change', (e) => { this.bpZiel = e.target.value; });
    $('k-bp-weg')?.addEventListener('click', () => { this.bereich = null; this.bereichZahl = null; this.bereichErgebnis = null; this.bpName = null; this.zeichne(); this.renderInfo(); });
    $('k-bp-open')?.addEventListener('click', async (e) => {
      e.preventDefault(); const b = this.letzteBp; if (!b) return;
      this.app.setMode('editor'); $('session').value = b.session; await this.app.loadList(); this.app.openBlueprint(b.name);
    });
    $('k-info').querySelectorAll('.k-grp').forEach((d) => d.addEventListener('toggle', () => { if (d.open) this.offeneGruppen.add(d.dataset.eb); else this.offeneGruppen.delete(d.dataset.eb); }));
  }

  zuruecksetzen() {
    this.markiert.clear(); this.suche = ''; $('k-bauteil').value = '';
    this.puffer(); this.renderInfo();
  }

  async oeffne3d() {
    if (!this.id) { this.app.toast('Bitte zuerst links einen Spielstand wählen.', 'err'); return; }
    if (this.id.startsWith('mp:')) { this.app.toast('Megaprints kann der 3D-Editor nicht öffnen – nur Spielstände.', 'err'); return; }
    try {
      const r = await fetch('/api/karte/3d', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' }, body: JSON.stringify({ id: this.id }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status);
      this.app.toast(j.hinweis || '3D-Editor wird geöffnet … (großer Spielstand: einige Sekunden)', j.hinweis ? 'err' : 'ok');
    } catch (e) { this.app.toast(e.message, 'err'); }
  }

  // ------------------------------------------------------------ Bedienung
  bind() {
    if (this.bound) return; this.bound = true;
    const cv = $('k-canvas');
    $('k-liste').addEventListener('click', (e) => { const b = e.target.closest('.item'); if (b) this.lade(b.dataset.id); });
    $('k-filter').addEventListener('input', () => this.renderListe());
    $('k-neu').addEventListener('click', () => { this.liste = null; this.ladeListe(); });
    $('k-ebenen').addEventListener('change', (e) => { const c = e.target.closest('input[data-eb]'); if (!c) return; if (c.checked) this.aus.delete(c.dataset.eb); else this.aus.add(c.dataset.eb); this.puffer(); });
    $('k-alle').addEventListener('click', () => { this.aus.clear(); this.renderEbenen(); this.puffer(); });
    $('k-fit').addEventListener('click', () => this.einpassen());
    $('k-welt').addEventListener('click', () => this.welt());
    let t = null;
    $('k-bauteil').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { this.suche = $('k-bauteil').value.trim(); this.puffer(); this.renderInfo(); }, 200); });
    new ResizeObserver(() => this.resize()).observe(cv);
    // Ziehen = verschieben, Rad = Zoom zum Mauszeiger, Klick = auswaehlen
    let drag = null;
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      const r = cv.getBoundingClientRect();
      if (this.meta && e.button === 0 && (this.auswahl || e.shiftKey)) {
        const [wx, wy] = this.zuWelt(e.clientX - r.left, e.clientY - r.top);
        this.bereichErgebnis = null;
        if (this.auswahl === 'stift' && !e.shiftKey) { drag = { stift: true }; this.bereich = { poly: [[wx, wy]], x0: wx, y0: wy, x1: wx, y1: wy }; return; }
        drag = { rahmen: true, wx, wy }; this.bereich = { x0: wx, y0: wy, x1: wx, y1: wy }; return;
      }
      drag = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y, moved: false };
    });
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      const [wx, wy] = this.zuWelt(e.clientX - r.left, e.clientY - r.top);
      $('k-pos').textContent = `X ${m0(wx)} m · Y ${m0(wy)} m`;
      if (!drag) return;
      if (drag.rahmen) { this.bereich.x1 = wx; this.bereich.y1 = wy; this.zeichne(); return; }
      if (drag.stift) {
        const P = this.bereich.poly, last = P[P.length - 1];
        if (Math.hypot(wx - last[0], wy - last[1]) * this.cam.s > 4) { P.push([wx, wy]); this.zeichne(); }
        return;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      this.cam.x = drag.cx - dx / this.cam.s; this.cam.y = drag.cy - dy / this.cam.s;
      this.zeichne();
    });
    cv.addEventListener('pointerup', (e) => {
      if (drag?.stift) {
        drag = null;
        const P = this.bereich.poly;
        const xs = P.map((q) => q[0]), ys = P.map((q) => q[1]);
        Object.assign(this.bereich, { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
        const b = this.bereich;
        if (P.length < 3 || b.x1 - b.x0 < 200 || b.y1 - b.y0 < 200) { this.bereich = null; this.zeichne(); return; }
        this.zeichne(); this.bereichInfo(); return;
      }
      if (drag?.rahmen) {
        drag = null;
        const b = this.bereich;
        if (Math.abs(b.x1 - b.x0) < 200 || Math.abs(b.y1 - b.y0) < 200) { this.bereich = null; this.zeichne(); return; }
        this.bereichInfo(); return;
      }
      if (drag && !drag.moved) { const r = cv.getBoundingClientRect(); const [wx, wy] = this.zuWelt(e.clientX - r.left, e.clientY - r.top); this.waehle(this.finde(wx, wy)); }
      drag = null;
    });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const [wx, wy] = this.zuWelt(px, py);
      const f = Math.exp(-e.deltaY * 0.0015);
      this.cam.s = Math.min(2, Math.max(0.0002, this.cam.s * f));
      this.cam.x = wx - (px - cv.clientWidth / 2) / this.cam.s; this.cam.y = wy - (py - cv.clientHeight / 2) / this.cam.s;
      this.zeichne();
    }, { passive: false });
    for (const id of ['k-hmin', 'k-hmax']) $(id).addEventListener('change', () => this.puffer());
    $('k-bild').addEventListener('change', () => this.zeichne());
    $('k-3d').addEventListener('click', () => this.oeffne3d());
    const werkzeug = (art) => {
      this.auswahl = this.auswahl === art ? null : art;
      for (const [id, a] of [['k-bereich', 'rechteck'], ['k-stift', 'stift']]) { $(id).classList.toggle('on', this.auswahl === a); $(id).setAttribute('aria-pressed', String(this.auswahl === a)); }
      $('k-canvas').style.cursor = this.auswahl ? 'crosshair' : '';
      if (this.auswahl) this.app.toast(this.auswahl === 'stift' ? 'Mit gedrückter Maustaste den Bereich umranden – loslassen schließt die Form.' : 'Rechteck auf der Karte aufziehen. Tipp: Umschalt + Ziehen geht immer.', 'ok');
    };
    $('k-bereich').addEventListener('click', () => werkzeug('rechteck'));
    $('k-stift').addEventListener('click', () => werkzeug('stift'));
    $('k-normal').addEventListener('click', () => this.zuruecksetzen());
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.app.area === 'karte' && (this.markiert.size || this.suche)) this.zuruecksetzen(); });
    $('k-zin').addEventListener('click', () => { this.cam.s = Math.min(2, this.cam.s * 1.6); this.zeichne(); });
    $('k-zout').addEventListener('click', () => { this.cam.s = Math.max(0.0002, this.cam.s / 1.6); this.zeichne(); });
  }
}

function distSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy;
  let t = l ? ((px - x1) * dx + (py - y1) * dy) / l : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
const m1 = (cm) => (cm / 100).toLocaleString('de-DE', { maximumFractionDigits: 1 });
const m0 = (cm) => Math.round(cm / 100).toLocaleString('de-DE');

/** Punkt in Polygon (Strahlverfahren) */
function imPoly(P, x, y) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; }
  return c;
}
