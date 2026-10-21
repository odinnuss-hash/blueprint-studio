// 3D-Ansicht mit WebGL 2: echte Spielmodelle (aus FModel aufbereitet, siehe werkzeuge/modelle-aufbereiten.mjs),
// Kaesten fuer alles ohne Modell, Splines (Foerderbaender, Rohre, Schienen) als Segmente.
// Linke Maustaste: drehen · rechte/mittlere: verschieben · Mausrad: Zoom · Klick: auswaehlen.
import { teileDynamisch } from './teile.js';

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec4 iM0;
layout(location=3) in vec4 iM1;
layout(location=4) in vec4 iM2;
layout(location=5) in vec4 iM3;
layout(location=6) in vec4 iCol;
layout(location=7) in vec4 iId;
uniform mat4 uVP;
uniform vec3 uQMin, uQSpan;
out vec3 vW; out vec3 vN; out vec4 vCol; out vec4 vId;
void main() {
  vec3 p = uQMin + (aPos * 0.5 + 0.5) * uQSpan;
  mat4 M = mat4(iM0, iM1, iM2, iM3);
  vec4 w = M * vec4(p, 1.0);
  vW = w.xyz; vN = mat3(M) * aNrm; vCol = iCol; vId = iId;
  gl_Position = uVP * w;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; in vec4 vCol; in vec4 vId;
uniform vec3 uEye;
uniform float uGlass;
layout(location=0) out vec4 oCol;
layout(location=1) out vec4 oId;
void main() {
  vec3 n = vN;
  if (dot(n, n) < 0.01) n = cross(dFdx(vW), dFdy(vW));
  n = normalize(n);
  vec3 v = normalize(uEye - vW);
  if (dot(n, v) < 0.0) n = -n;
  vec3 L = normalize(vec3(0.35, -0.45, 0.82));
  float dif = max(dot(n, L), 0.0);
  float hemi = 0.5 + 0.5 * n.z;
  float spec = pow(max(dot(n, normalize(L + v)), 0.0), 24.0) * 0.18;
  vec3 base = vCol.rgb;
  float a = 1.0;
  if (uGlass > 0.5) { base = mix(base, vec3(0.62, 0.85, 0.95), 0.6); a = 0.38; spec *= 2.5; }
  vec3 c = base * (0.30 + 0.28 * hemi + 0.52 * dif) + spec;
  oCol = vec4(c, a);
  oId = vId;
}`;

const LINE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uVP;
void main() { gl_Position = uVP * vec4(aPos, 1.0); }`;
const LINE_FS = `#version 300 es
precision mediump float;
uniform vec4 uCol;
layout(location=0) out vec4 oCol;
layout(location=1) out vec4 oId;
void main() { oCol = uCol; oId = vec4(0.0); }`;

// Nachbearbeitung: Hintergrund, Kanten (Objektwechsel + Tiefenspruenge), Auswahl-Umriss
const POST_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() { vec2 p = P[gl_VertexID]; vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const POST_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D tCol, tId, tDep;
uniform float uNear, uFar;
out vec4 o;
float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 S = textureSize(tCol, 0) - 1;
  float d = texelFetch(tDep, p, 0).r;
  vec4 id = texelFetch(tId, p, 0);
  vec3 bg = mix(vec3(0.051, 0.059, 0.071), vec3(0.090, 0.102, 0.122), vUv.y);
  if (d >= 1.0) { o = vec4(bg, 1.0); return; }
  vec3 c = texelFetch(tCol, p, 0).rgb;
  ivec2 q[4] = ivec2[4](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1));
  float ld = lin(d);
  bool edge = false, selEdge = false;
  float dsum = 0.0;
  for (int k = 0; k < 4; k++) {
    ivec2 r = clamp(p + q[k], ivec2(0), S);
    vec4 j = texelFetch(tId, r, 0);
    if (any(greaterThan(abs(j.rgb - id.rgb), vec3(0.001)))) { edge = true; if (id.a > 0.5) selEdge = true; }
    float dn = texelFetch(tDep, r, 0).r;
    dsum += dn >= 1.0 ? 1.0 / ld : 1.0 / lin(dn);
  }
  float crease = abs(dsum - 4.0 / ld) * ld;
  if (selEdge) c = vec3(1.0, 0.9, 0.7);
  else if (edge) c *= 0.55;
  else if (crease > 0.06) c *= 0.75;
  o = vec4(c, 1.0);
}`;

const CUBE = (() => {
  // Einheitswuerfel 0..1 (als Int16-normiert: -1 = 0, +1 = 1)
  const v = [], idx = [];
  const F = [[0, 2, 6, 4], [1, 5, 7, 3], [0, 4, 5, 1], [2, 3, 7, 6], [0, 1, 3, 2], [4, 6, 7, 5]];
  for (const f of F) {
    const b = v.length / 3;
    for (const k of f) v.push(k & 1 ? 32767 : -32767, k & 2 ? 32767 : -32767, k & 4 ? 32767 : -32767);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { pos: new Int16Array(v), idx: new Uint32Array(idx) };
})();

const CYL = (() => {
  // Rohr: Achse X von 0..1, Radius 0.5 (als Int16-normiert, siehe uQMin/uQSpan beim Zeichnen), mit Normalen
  const N = 14, pos = [], nrm = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    for (const x of [0, 1]) { pos.push(x ? 32767 : -32767, Math.round(c * 32767), Math.round(s * 32767)); nrm.push(0, Math.round(c * 127), Math.round(s * 127), 0); }
  }
  for (let i = 0; i < N; i++) { const b = i * 2; idx.push(b, b + 1, b + 3, b, b + 3, b + 2); }
  return { pos: new Int16Array(pos), nrm: new Int8Array(nrm), idx: new Uint32Array(idx) };
})();
// Prozedurale Modelle aus Quadern im Einheitswuerfel (x = Laenge, y = Breite, z = Hoehe)
function quaderMesh(boxes) {
  const v = [], idx = [];
  const F = [[0, 2, 6, 4], [1, 5, 7, 3], [0, 4, 5, 1], [2, 3, 7, 6], [0, 1, 3, 2], [4, 6, 7, 5]];
  const q = (t) => Math.round(Math.max(0, Math.min(1, t)) * 65534 - 32767);
  for (const [x0, y0, z0, x1, y1, z1] of boxes) for (const f of F) {
    const b = v.length / 3;
    for (const k of f) v.push(q(k & 1 ? x1 : x0), q(k & 2 ? y1 : y0), q(k & 4 ? z1 : z0));
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { pos: new Int16Array(v), idx: new Uint32Array(idx) };
}
const BAND = quaderMesh([
  [0, 0.08, 0.42, 1, 0.92, 0.58],   // Laufflaeche
  [0, 0, 0.25, 1, 0.08, 1],         // Seitenwange links
  [0, 0.92, 0.25, 1, 1, 1],         // Seitenwange rechts
  [0, 0.3, 0, 1, 0.7, 0.42],        // Unterbau
]);
const LIFT = quaderMesh([
  [0, 0, 0, 0.14, 0.14, 1], [0.86, 0, 0, 1, 0.14, 1], [0, 0.86, 0, 0.14, 1, 1], [0.86, 0.86, 0, 1, 1, 1], // Eckpfosten
  [0.3, 0.3, 0, 0.7, 0.7, 1],       // Band im Schacht
  [0, 0, 0, 1, 1, 0.06], [0, 0, 0.94, 1, 1, 1], // Ein-/Ausgang
  [0, 0, 0.48, 1, 0.14, 0.52], [0, 0.86, 0.48, 1, 1, 0.52], // Querstreben
]);
const PROZ = { '#band': BAND, '#lift': LIFT };
const ROHR = /Pipeline|Pipe_|PipeHyper|Hypertube/;
const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const NO_MESH = /PowerLine|Wire/;
const BEAM = /^Build_Beam(?!_Connector|_Support)/;

export class View3DGL {
  static supported() { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } }

  constructor(canvas, app) {
    this.cv = canvas; this.app = app;
    this.target = [0, 0, 0]; this.yaw = 45; this.pitch = 35; this.dist = 5000; this.fov = 50;
    this.drag = null; this.raf = 0; this.fast = false; this.fitted = false;
    this.models = { state: 'aus', index: null };
    try { this.useModels = localStorage.getItem('bs-modelle') !== '0'; } catch { this.useModels = true; }
    this.stift = false; this.lasso = null;
    this.onDown = this.onDown.bind(this); this.onMove = this.onMove.bind(this); this.onUp = this.onUp.bind(this); this.onWheel = this.onWheel.bind(this);
    this.initGl();
  }

  // ------------------------------------------------------------ WebGL-Grundlagen
  initGl() {
    const gl = this.gl = this.cv.getContext('webgl2', { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL 2 nicht verfuegbar');
    const prog = (vs, fs) => {
      const p = gl.createProgram();
      for (const [t, s] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        gl.attachShader(p, sh);
      }
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
      return { p, u };
    };
    this.pMain = prog(VS, FS); this.pLine = prog(LINE_VS, LINE_FS); this.pPost = prog(POST_VS, POST_FS);
    // Wuerfel
    this.cubeVbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.cubeVbo); gl.bufferData(gl.ARRAY_BUFFER, CUBE.pos, gl.STATIC_DRAW);
    this.cubeIbo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.cubeIbo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, CUBE.idx, gl.STATIC_DRAW);
    this.cylVbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.cylVbo); gl.bufferData(gl.ARRAY_BUFFER, CYL.pos, gl.STATIC_DRAW);
    this.cylNbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.cylNbo); gl.bufferData(gl.ARRAY_BUFFER, CYL.nrm, gl.STATIC_DRAW);
    this.cylIbo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.cylIbo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, CYL.idx, gl.STATIC_DRAW);
    this.proz = {};
    for (const [k, m] of Object.entries(PROZ)) {
      const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
      this.proz[k] = { vb, ib, n: m.idx.length };
    }
    this.instVbo = gl.createBuffer();
    this.lineVbo = gl.createBuffer();
    this.vao = gl.createVertexArray();
    this.postVao = gl.createVertexArray();
    this.fbo = null;
  }

  ensureFbo(W, H) {
    const gl = this.gl;
    if (this.fbo && this.fboW === W && this.fboH === H) return;
    if (this.fbo) { gl.deleteFramebuffer(this.fbo); for (const t of this.fboTex) gl.deleteTexture(t); }
    const tex = (ifmt, fmt, type) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, W, H, 0, fmt, type, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      return t;
    };
    const col = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE), id = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE), dep = tex(gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, col, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, id, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, dep, 0);
    this.fbo = f; this.fboTex = [col, id, dep]; this.fboW = W; this.fboH = H;
  }

  // ------------------------------------------------------------ Modelle laden
  setModels(on) {
    this.useModels = on;
    try { localStorage.setItem('bs-modelle', on ? '1' : '0'); } catch { /* egal */ }
    if (on) this.loadModels();
    this.render();
  }
  async loadModels() {
    if (this.models.state !== 'aus') return this.models.promise;
    this.models.state = 'laedt';
    this.app.onModelsState?.('laedt');
    this.models.promise = (async () => {
      try {
        const r = await fetch('modelle/index.json', { cache: 'no-cache' });
        if (!r.ok) throw new Error('keine Modelle');
        const index = await r.json();
        const b = await fetch('modelle/meshes.bin');
        if (!b.ok) throw new Error('meshes.bin fehlt');
        const buf = await b.arrayBuffer();
        const gl = this.gl;
        // Indizes in eigenen Puffer (WebGL erlaubt keinen Puffer fuer beide Ziele)
        let iBytes = 0;
        for (const m of Object.values(index.meshes)) { iBytes += m.ni * (m.u32 ? 4 : 2); iBytes += (4 - (iBytes % 4)) % 4; }
        const ib = new Uint8Array(iBytes); let io = 0;
        const pad = (n) => (n + 3) & ~3;
        for (const m of Object.values(index.meshes)) {
          m.oPos = m.o; m.oNrm = m.o + pad(m.nv * 6);
          const src = m.oNrm + m.nv * 4, len = m.ni * (m.u32 ? 4 : 2);
          ib.set(new Uint8Array(buf, src, len), io); m.oIdx = io; io = pad(io + len);
        }
        this.meshVbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.meshVbo); gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
        this.meshIbo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshIbo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ib, gl.STATIC_DRAW);
        this.models.index = index; this.models.state = 'bereit';
        this.app.onModelsState?.('bereit', Object.keys(index.klassen).length);
      } catch (e) {
        this.models.state = 'fehlt'; this.app.onModelsState?.('fehlt', 0, e.message);
      }
      this.render();
    })();
    return this.models.promise;
  }
  partsFor(o) {
    if (!this.useModels || this.models.state !== 'bereit' || o.sp || NO_MESH.test(o.cls)) return null;
    // Lifte und Stützen/Masten wie im Spiel aus Teilen (Höhe aus der Blaupause; js/teile.js)
    const dyn = teileDynamisch(this.models.index, o.cls, o.lt ? o.lt[2] : (o.pv != null ? (o.pv + 1) * 100000 : 0) + (o.h || 0));
    if (dyn) return dyn;
    if (o.lt) return null;
    return this.models.index.klassen[o.cls] || null;
  }

  // ------------------------------------------------------------ Ereignisse
  attach() {
    this.cv.hidden = false;
    this.cv.addEventListener('pointerdown', this.onDown);
    this.cv.addEventListener('pointermove', this.onMove);
    this.cv.addEventListener('pointerup', this.onUp);
    this.cv.addEventListener('wheel', this.onWheel, { passive: false });
    this.cv.addEventListener('contextmenu', this.prevent);
    this.cv.style.cursor = 'grab';
    if (this.useModels) this.loadModels();
  }
  detach() {
    this.cv.hidden = true;
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
    let r = [-f[1], f[0], 0]; const rl = Math.hypot(r[0], r[1]) || 1; r = [r[0] / rl, r[1] / rl, 0];
    const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
    const [w, h] = this.size();
    const focal = (h / 2) / Math.tan((this.fov / 2) * Math.PI / 180);
    return { eye, f, r, u, focal, w, h };
  }

  viewProj(cam, near, far) {
    const { eye, f, r, u, focal, w, h } = cam;
    const sx = focal / (w / 2), sy = focal / (h / 2);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const A = (far + near) / (far - near), B = -2 * far * near / (far - near);
    const row0 = [sx * r[0], sx * r[1], sx * r[2], -sx * dot(r, eye)];
    const row1 = [sy * u[0], sy * u[1], sy * u[2], -sy * dot(u, eye)];
    const row3 = [f[0], f[1], f[2], -dot(f, eye)];
    const row2 = [A * row3[0], A * row3[1], A * row3[2], A * row3[3] + B];
    const m = new Float32Array(16);
    for (let c = 0; c < 4; c++) { m[c * 4] = row0[c]; m[c * 4 + 1] = row1[c]; m[c * 4 + 2] = row2[c]; m[c * 4 + 3] = row3[c]; }
    return m;
  }

  requestRender(fast) { this.fast = !!fast; if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(this.fast); }); }

  // ------------------------------------------------------------ Instanzdaten
  buildInstances() {
    const scene = this.app.scene;
    const groups = new Map(); // Schluessel: Mesh-Name oder '#cube'
    const objs = [null];
    if (!scene) return { groups, objs, count: 0 };
    const sel = this.app.sel, lvl = this.app.level, hasL = scene.levels.length > 0;
    const push = (key, arr) => { let g = groups.get(key); if (!g) { g = []; groups.set(key, g); } for (const v of arr) g.push(v); };
    const qm = (q, s) => {
      const [x, y, z, w] = q;
      return [(1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0],
        2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1],
        2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2]];
    };
    // 3x3 * 3x3 (spaltenweise)
    const m3 = (A, B) => { const C = new Array(9); for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) C[c * 3 + r] = A[r] * B[c * 3] + A[3 + r] * B[c * 3 + 1] + A[6 + r] * B[c * 3 + 2]; return C; };
    const mv = (A, v) => [A[0] * v[0] + A[3] * v[1] + A[6] * v[2], A[1] * v[0] + A[4] * v[1] + A[7] * v[2], A[2] * v[0] + A[5] * v[1] + A[8] * v[2]];
    for (const o of scene.objs) {
      if (o.removed || o.hidden || o.kind === 'none') continue;
      let ghost = false;
      if (lvl >= 0 && hasL) { if (o.level > lvl) continue; if (o.level < lvl) ghost = true; }
      const isSel = sel.has(o.i);
      const id = objs.length; objs.push(o);
      let rgb = hexRgb(o.color);
      const parts = this.partsFor(o);
      if (parts) rgb = rgb.map((c) => c * 0.75 + 0.78 * 0.25);
      if (isSel) rgb = rgb.map((c, k) => c * 0.35 + [1, 0.70, 0.28][k] * 0.65);
      if (ghost) rgb = rgb.map((c) => c * 0.3 + 0.09);
      const col = [rgb[0], rgb[1], rgb[2], 1];
      const idc = [(id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255, isSel ? 1 : 0];
      if (parts) {
        const R = qm(o.q, o.s || [1, 1, 1]);
        const beam = BEAM.test(o.cls);
        for (const [mesh, t, q, s0] of parts) {
          let s = s0;
          if (beam) { const mm = this.models.index.meshes[mesh]; const L = mm ? mm.max[2] - mm.min[2] : 0; if (L > 1) s = [s0[0], s0[1], s0[2] * (o.len || L) / L]; }
          const M = m3(R, qm(q, s));
          const T = mv(R, t);
          push(mesh, [M[0], M[1], M[2], 0, M[3], M[4], M[5], 0, M[6], M[7], M[8], 0, T[0] + o.p[0], T[1] + o.p[1], T[2] + o.p[2], 1, ...col, ...idc]);
        }
      } else if (o.path && o.path.length > 1 && ROHR.test(o.cls)) {
        // Rohre/Hypertubes rund: je Segment ein Zylinder
        const d0 = /Hyper/.test(o.cls) ? 250 : /MK2|Mk2/.test(o.cls) ? 110 : 90;
        for (let k = 0; k < o.path.length - 1; k++) {
          const a = o.path[k], b = o.path[k + 1];
          const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz);
          if (L < 1) continue;
          let ux = -dy, uy = dx, uz = 0; let ul = Math.hypot(ux, uy); if (ul < 1e-6) { ux = 1; uy = 0; ul = 1; }
          ux /= ul; uy /= ul;
          const vx = (dy * uz - dz * uy) / L, vy = (dz * ux - dx * uz) / L, vz = (dx * uy - dy * ux) / L;
          push('#cyl', [dx, dy, dz, 0, ux * d0, uy * d0, uz * d0, 0, vx * d0, vy * d0, vz * d0, 0, a[0], a[1], a[2], 1, ...col, ...idc]);
        }
      } else {
        const hexas = o.corners ? [o.corners] : (o.prisms || []);
        const key = !this.useModels ? '#cube' : /ConveyorBelt/.test(o.cls) && o.prisms ? '#band' : /ConveyorLift/.test(o.cls) && o.lt ? '#lift' : '#cube';
        for (const c of hexas) {
          const a = c[0], x = c[1], y = c[2], z = c[4];
          push(key, [x[0] - a[0], x[1] - a[1], x[2] - a[2], 0, y[0] - a[0], y[1] - a[1], y[2] - a[2], 0, z[0] - a[0], z[1] - a[1], z[2] - a[2], 0, a[0], a[1], a[2], 1, ...col, ...idc]);
        }
      }
    }
    // in einen Puffer
    let total = 0; for (const g of groups.values()) total += g.length;
    const data = new Float32Array(total);
    const ranges = [];
    let off = 0;
    for (const [key, g] of groups) { data.set(g, off); ranges.push({ key, first: off / 24, count: g.length / 24 }); off += g.length; }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instVbo); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    return { ranges, objs, count: total / 24 };
  }

  // ------------------------------------------------------------ Zeichnen
  render(fast) {
    const gl = this.gl, cv = this.cv, dpr = window.devicePixelRatio || 1;
    const [w, h] = this.size();
    if (!w || !h) return;
    const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    this.ensureFbo(W, H);
    if (!fast || !this.inst) this.inst = this.buildInstances();
    const scene = this.app.scene, cam = this.camera();
    const b = scene?.bounds;
    const rad = b ? Math.hypot(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0) : 10000;
    const near = Math.max(5, this.dist * 0.004), far = this.dist + rad * 3 + 50000;
    const VP = this.viewProj(cam, near, far);
    this.near = near; this.far = far;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, W, H);
    gl.clearBufferfv(gl.COLOR, 0, [0.07, 0.08, 0.095, 1]);
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    gl.clearBufferfi(gl.DEPTH_STENCIL, 0, 1, 0);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);

    if (scene) {
      this.drawGround(VP, b);
      gl.useProgram(this.pMain.p);
      gl.uniformMatrix4fv(this.pMain.u.uVP, false, VP);
      gl.uniform3fv(this.pMain.u.uEye, cam.eye);
      gl.bindVertexArray(this.vao);
      const glassDraws = [];
      for (const rg of this.inst.ranges) {
        if (rg.key[0] === '#') this.drawRange(rg, rg.key, false);
        else {
          const m = this.models.index?.meshes[rg.key];
          if (!m) continue;
          this.drawRange(rg, m, false);
          if (m.gi < m.ni) glassDraws.push([rg, m]);
        }
      }
      if (glassDraws.length) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
        for (const [rg, m] of glassDraws) this.drawRange(rg, m, true);
        gl.depthMask(true); gl.disable(gl.BLEND);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      }
      gl.bindVertexArray(null);
    }

    // Nachbearbeitung auf den Bildschirm
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.pPost.p);
    const [tc, ti, td] = this.fboTex;
    [[tc, 'tCol'], [ti, 'tId'], [td, 'tDep']].forEach(([t, n], k) => { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(this.pPost.u[n], k); });
    gl.uniform1f(this.pPost.u.uNear, near); gl.uniform1f(this.pPost.u.uFar, far);
    gl.bindVertexArray(this.postVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  drawRange(rg, m, glass) {
    const gl = this.gl, u = this.pMain.u;
    if (m === '#cyl') {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cylVbo);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.SHORT, true, 6, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cylNbo);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.BYTE, true, 4, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.cylIbo);
      gl.uniform3f(u.uQMin, 0, -0.5, -0.5); gl.uniform3f(u.uQSpan, 1, 1, 1);
    } else if (this.proz[m]) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.proz[m].vb);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.SHORT, true, 6, 0);
      gl.disableVertexAttribArray(1); gl.vertexAttrib3f(1, 0, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.proz[m].ib);
      gl.uniform3f(u.uQMin, 0, 0, 0); gl.uniform3f(u.uQSpan, 1, 1, 1);
    } else if (m && m !== '#cube') {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshVbo);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.SHORT, true, 6, m.oPos);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.BYTE, true, 4, m.oNrm);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshIbo);
      gl.uniform3fv(u.uQMin, m.min); gl.uniform3f(u.uQSpan, m.max[0] - m.min[0], m.max[1] - m.min[1], m.max[2] - m.min[2]);
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cubeVbo);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.SHORT, true, 6, 0);
      gl.disableVertexAttribArray(1); gl.vertexAttrib3f(1, 0, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.cubeIbo);
      gl.uniform3f(u.uQMin, 0, 0, 0); gl.uniform3f(u.uQSpan, 1, 1, 1);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instVbo);
    const base = rg.first * 96;
    for (let k = 0; k < 6; k++) {
      const loc = 2 + k;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 96, base + k * 16);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.uniform1f(u.uGlass, glass ? 1 : 0);
    if (m === '#cyl') gl.drawElementsInstanced(gl.TRIANGLES, CYL.idx.length, gl.UNSIGNED_INT, 0, rg.count);
    else if (this.proz[m]) gl.drawElementsInstanced(gl.TRIANGLES, this.proz[m].n, gl.UNSIGNED_INT, 0, rg.count);
    else if (m && m !== '#cube') {
      const es = m.u32 ? 4 : 2, type = m.u32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      const from = glass ? m.gi : 0, cnt = glass ? m.ni - m.gi : m.gi;
      if (cnt > 0) gl.drawElementsInstanced(gl.TRIANGLES, cnt, type, m.oIdx + from * es, rg.count);
    } else gl.drawElementsInstanced(gl.TRIANGLES, 36, gl.UNSIGNED_INT, 0, rg.count);
  }

  drawGround(VP, b) {
    if (!b) return;
    const gl = this.gl, step = 800, z = b.z0 - 2;
    const x0 = Math.floor((b.x0 - 1600) / step) * step, x1 = Math.ceil((b.x1 + 1600) / step) * step;
    const y0 = Math.floor((b.y0 - 1600) / step) * step, y1 = Math.ceil((b.y1 + 1600) / step) * step;
    const v = [];
    for (let x = x0; x <= x1; x += step) v.push(x, y0, z, x, y1, z);
    for (let y = y0; y <= y1; y += step) v.push(x0, y, z, x1, y, z);
    gl.useProgram(this.pLine.p);
    gl.uniformMatrix4fv(this.pLine.u.uVP, false, VP);
    gl.uniform4f(this.pLine.u.uCol, 0.15, 0.165, 0.196, 1);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    for (let k = 1; k < 8; k++) gl.disableVertexAttribArray(k);
    gl.drawArrays(gl.LINES, 0, v.length / 3);
    gl.bindVertexArray(null);
  }

  pick(sx, sy) {
    const gl = this.gl;
    if (!this.fbo || !this.inst) return null;
    const dpr = window.devicePixelRatio || 1;
    const x = Math.floor(sx * dpr), y = this.fboH - 1 - Math.floor(sy * dpr);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    const R = 3, px = new Uint8Array((2 * R + 1) * (2 * R + 1) * 4);
    const x0 = Math.max(0, x - R), y0 = Math.max(0, y - R);
    gl.readPixels(x0, y0, 2 * R + 1, 2 * R + 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // Mitte zuerst, dann naechste Nachbarn
    let best = null, bd = Infinity;
    for (let j = 0; j < 2 * R + 1; j++) for (let i = 0; i < 2 * R + 1; i++) {
      const k = (j * (2 * R + 1) + i) * 4, id = px[k] | (px[k + 1] << 8) | (px[k + 2] << 16);
      if (!id) continue;
      const d = (x0 + i - x) ** 2 + (y0 + j - y) ** 2;
      if (d < bd) { bd = d; best = id; }
    }
    return best ? this.inst.objs[best] || null : null;
  }

  // ------------------------------------------------------------ Maus
  onDown(e) {
    if (!this.app.scene) return;
    this.cv.setPointerCapture(e.pointerId);
    const [sx, sy] = this.evPos(e);
    if (this.stift && e.button === 0) {
      this.lasso = { pts: [[sx, sy]], art: e.shiftKey ? 'dazu' : (e.ctrlKey || e.metaKey || e.altKey) ? 'weg' : 'neu' };
      return;
    }
    this.drag = { btn: e.button, sx, sy, lx: sx, ly: sy, moved: false, shift: e.shiftKey || e.ctrlKey };
    this.cv.style.cursor = 'grabbing';
  }
  onMove(e) {
    if (this.lasso) {
      const [sx, sy] = this.evPos(e), L = this.lasso.pts, l = L[L.length - 1];
      if (Math.hypot(sx - l[0], sy - l[1]) >= 3) { L.push([sx, sy]); this.lassoZeichnen(); }
      return;
    }
    const d = this.drag; if (!d) return;
    const [sx, sy] = this.evPos(e);
    const dx = sx - d.lx, dy = sy - d.ly; d.lx = sx; d.ly = sy;
    if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < 4) return;
    d.moved = true;
    if ((d.btn === 0 || (this.stift && d.btn === 2)) && !e.shiftKey) {
      this.yaw -= dx * 0.4; this.pitch = Math.max(-85, Math.min(89, this.pitch + dy * 0.3));
    } else {
      const cam = this.camera(), k = this.dist / cam.focal;
      for (let j = 0; j < 3; j++) this.target[j] += (-dx * cam.r[j] + dy * cam.u[j]) * k;
    }
    this.requestRender(true);
  }
  onUp() {
    if (this.lasso) { const l = this.lasso; this.lasso = null; this.lassoZeichnen(); this.lassoAnwenden(l); return; }
    const d = this.drag; this.drag = null; this.cv.style.cursor = this.stift ? 'crosshair' : 'grab';
    if (!d) return;
    if (!d.moved && d.btn === 0) {
      const o = this.pick(d.sx, d.sy);
      if (o) { if (d.shift) this.app.toggleSel(o.i); else this.app.setSel([o.i]); }
      else if (!d.shift) this.app.setSel([]);
    }
  }
  // ------------------------------------------------------------ Stift (Lasso)
  setStift(an) {
    this.stift = !!an; this.lasso = null;
    const o = document.getElementById('cv3o');
    if (o) { o.toggleAttribute('hidden', !this.stift); this.lassoZeichnen(); } // SVG kennt .hidden nicht – Attribut setzen
    this.cv.style.cursor = this.stift ? 'crosshair' : 'grab';
  }
  lassoZeichnen() {
    const o = document.getElementById('cv3o'), poly = document.getElementById('cv3o-poly'); if (!o || !poly) return;
    const L = this.lasso?.pts;
    o.classList.toggle('weg', this.lasso?.art === 'weg');
    poly.setAttribute('points', L && L.length > 1 ? L.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') : '');
  }
  /** Objekte innerhalb der gezeichneten Linie bestimmen und Auswahl anpassen */
  lassoAnwenden(l) {
    const app = this.app, L = l.pts;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of L) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (L.length < 3 || (x1 - x0) * (y1 - y0) < 36) {
      // nur geklickt: wie normal ein Objekt waehlen
      const o = this.pick(L[0][0], L[0][1]);
      if (o) { if (l.art === 'dazu') app.toggleSel(o.i); else if (l.art === 'weg') { app.sel.delete(o.i); app.afterSel(); } else app.setSel([o.i]); }
      else if (l.art === 'neu') app.setSel([]);
      return;
    }
    const dpr = window.devicePixelRatio || 1, [w, h] = this.size();
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(w - 1, Math.ceil(x1)); y1 = Math.min(h - 1, Math.ceil(y1));
    if (x1 <= x0 || y1 <= y0) return;
    // Maske der Flaeche (Geraetepixel)
    const W = Math.max(1, Math.round((x1 - x0 + 1) * dpr)), H = Math.max(1, Math.round((y1 - y0 + 1) * dpr));
    const mc = document.createElement('canvas'); mc.width = W; mc.height = H;
    const m = mc.getContext('2d', { willReadFrequently: true });
    m.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
    m.beginPath(); m.moveTo(L[0][0], L[0][1]); for (const p of L) m.lineTo(p[0], p[1]); m.closePath(); m.fillStyle = '#fff'; m.fill();
    const maske = m.getImageData(0, 0, W, H).data;
    const innen = (sx, sy) => { const i = Math.floor((sy - y0) * dpr), j = Math.floor((sx - x0) * dpr); return i >= 0 && j >= 0 && i < H && j < W && maske[(i * W + j) * 4 + 3] > 127; };
    const lvl = app.level, hasL = app.scene.levels.length > 0;
    const zaehlt = (o) => o && !o.removed && !o.hidden && o.kind !== 'none' && !(lvl >= 0 && hasL && o.level !== lvl);
    const treffer = new Set();
    // 1) sichtbare Objekte aus dem ID-Puffer
    if (this.fbo && this.inst) {
      const gl = this.gl;
      const fx = Math.floor(x0 * dpr), fy = this.fboH - Math.floor(y0 * dpr) - H;
      const rx = Math.max(0, fx), ry = Math.max(0, fy), rw = Math.min(W - (rx - fx), this.fboW - rx), rh = Math.min(H - (ry - fy), this.fboH - ry);
      if (rw > 0 && rh > 0) {
      const px = new Uint8Array(rw * rh * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo); gl.readBuffer(gl.COLOR_ATTACHMENT1);
      gl.readPixels(rx, ry, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      for (let r = 0; r < rh; r++) {
        const mi = H - 1 - (r + ry - fy); // Zeile in der Maske (oben = 0)
        if (mi < 0 || mi >= H) continue;
        for (let c = 0; c < rw; c++) {
          const mj = c + rx - fx; if (mj < 0 || mj >= W || maske[(mi * W + mj) * 4 + 3] <= 127) continue;
          const k = (r * rw + c) * 4, id = px[k] | (px[k + 1] << 8) | (px[k + 2] << 16);
          if (id) { const o = this.inst.objs[id]; if (zaehlt(o)) treffer.add(o.i); }
        }
      }
      }
    }
    // 2) auf Wunsch auch verdeckte: Mittelpunkt jedes Objekts projizieren
    if (document.getElementById('stift-verdeckt')?.checked) {
      const cam = this.camera(), VP = this.viewProj(cam, this.near || 5, this.far || 1e6);
      for (const o of app.scene.objs) {
        if (!zaehlt(o) || !o.p) continue;
        const v = [o.p[0], o.p[1], o.p[2], 1], cl = [0, 0, 0, 0];
        for (let r = 0; r < 4; r++) cl[r] = VP[r] * v[0] + VP[4 + r] * v[1] + VP[8 + r] * v[2] + VP[12 + r] * v[3];
        if (cl[3] <= 0) continue;
        const sx = (cl[0] / cl[3] + 1) / 2 * w, sy = (1 - cl[1] / cl[3]) / 2 * h;
        if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1 && innen(sx, sy)) treffer.add(o.i);
      }
    }
    const vorher = app.sel.size;
    if (l.art === 'neu') app.setSel([...treffer]);
    else if (l.art === 'dazu') app.setSel([...app.sel, ...treffer]);
    else { for (const i of treffer) app.sel.delete(i); app.afterSel(); }
    app.toast?.(l.art === 'weg' ? `${vorher - app.sel.size} Objekt(e) abgewählt – ${app.sel.size} bleiben ausgewählt.` : `${app.sel.size} Objekt(e) ausgewählt${app.sel.size ? ' – Entf löscht sie' : ''}.`, 'ok');
  }

  onWheel(e) {
    e.preventDefault();
    this.dist = Math.max(200, Math.min(2e6, this.dist * Math.exp(e.deltaY * 0.0015)));
    this.requestRender(true);
  }
}
