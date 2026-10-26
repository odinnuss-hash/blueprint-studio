// Welt-Ansicht (Test): ganze Karte in 3D – Gelände in voller Auflösung (1 m, Kacheln mit Detailstufen), Kartenbild als Farbe,
// Bauteile eines Spielstands mit Spielmodellen (gebündelt gezeichnet wie view3dgl.js). Ziel: offline planen
// und viele Blaupausen setzen, ohne sie ins Spiel zu laden – kein Ersatz fürs Spiel.
// Kamera: Fliegen – WASD bewegen, Q/E runter/hoch, Umschalt = schneller, Maus ziehen = umsehen, Mausrad = vor/zurück.
import { WELT } from './karte.js';
import { colorFor } from './scene.js';
import { teileDynamisch } from './teile.js';
import { zeichnePunkte, filterLaden, punktText } from './kartenpunkte.js';

const LEER = -32768;
const TERRAIN_VS = `#version 300 es
layout(location=0) in vec2 aGrid;         // 0..N+1 (Ränder = Schürze)
uniform highp isampler2D uH;
uniform vec2 uOrigin; uniform float uStep; uniform int uN;
uniform mat4 uVP;
out vec3 vW; out vec3 vN; out float vLeer;
float hoehe(ivec2 p) { p = clamp(p, ivec2(0), ivec2(uN)); int v = texelFetch(uH, p, 0).r; return v == -32768 ? -40000.0 : float(v) * 10.0; }
void main() {
  ivec2 g = ivec2(aGrid) - 1; bool rand = any(lessThan(g, ivec2(0))) || any(greaterThan(g, ivec2(uN)));
  ivec2 p = clamp(g, ivec2(0), ivec2(uN));
  float h = hoehe(p);
  vLeer = texelFetch(uH, p, 0).r == -32768 ? 1.0 : 0.0;
  float dx = hoehe(p + ivec2(1, 0)) - hoehe(p - ivec2(1, 0)), dy = hoehe(p + ivec2(0, 1)) - hoehe(p - ivec2(0, 1));
  vN = normalize(vec3(-dx, -dy, 2.0 * uStep));
  vec3 w = vec3(uOrigin + vec2(p) * uStep, h - (rand ? uStep * 0.6 + 200.0 : 0.0));
  vW = w; gl_Position = uVP * vec4(w, 1.0);
}`;
const TERRAIN_FS = `#version 300 es
precision highp float;
uniform float uPick; // 1 = Weltposition statt Farbe ausgeben (Mausklick-Treffer)
in vec3 vW; in vec3 vN; in float vLeer;
uniform sampler2D uK0, uK1, uK2, uK3; uniform vec4 uWelt; uniform vec3 uEye; uniform float uBild;
out vec4 o;
void main() {
  if (vLeer > 0.5) discard;
  vec2 q = (vW.xy - uWelt.xy) / (uWelt.zw - uWelt.xy) * 2.0; // 0..2 über die vier Kartenkacheln
  vec3 farbe = vec3(0.55, 0.52, 0.45);
  if (uBild > 0.5 && q.x >= 0.0 && q.y >= 0.0 && q.x < 2.0 && q.y < 2.0) {
    vec2 uv = fract(q);
    farbe = q.x < 1.0 ? (q.y < 1.0 ? texture(uK0, uv).rgb : texture(uK1, uv).rgb) : (q.y < 1.0 ? texture(uK2, uv).rgb : texture(uK3, uv).rgb);
  }
  vec3 n = normalize(vN), L = normalize(vec3(0.35, -0.45, 0.82));
  float dif = max(dot(n, L), 0.0), hemi = 0.5 + 0.5 * n.z;
  vec3 c = farbe * (0.45 + 0.25 * hemi + 0.55 * dif);
  float d = length(uEye - vW), dunst = 1.0 - exp(-d / 900000.0);
  o = vec4(mix(c, vec3(0.62, 0.70, 0.78), dunst * 0.7), 1.0);
  if (uPick > 0.5) o = vec4(vW, 1.0);
}`;
const OBJ_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm;
layout(location=2) in vec4 iM0; layout(location=3) in vec4 iM1; layout(location=4) in vec4 iM2; layout(location=5) in vec4 iM3; layout(location=6) in vec4 iCol;
uniform mat4 uVP, uM; uniform vec3 uQMin, uQSpan; uniform vec4 uTint;
out vec3 vW; out vec3 vN; out vec4 vCol; flat out float vId;
void main() {
  vec3 p = uQMin + (aPos * 0.5 + 0.5) * uQSpan; vId = iCol.a;
  mat4 M = uM * mat4(iM0, iM1, iM2, iM3); vec4 w = M * vec4(p, 1.0);
  vW = w.xyz; vN = mat3(M) * aNrm; vCol = vec4(mix(iCol.rgb, uTint.rgb, uTint.a), 1.0); gl_Position = uVP * w;
}`;
const OBJ_FS = `#version 300 es
precision highp float;
uniform float uPick; // 1 = Weltposition statt Farbe ausgeben (Mausklick-Treffer)
in vec3 vW; in vec3 vN; in vec4 vCol; flat in float vId; uniform vec3 uEye; out vec4 o;
void main() {
  vec3 n = vN; if (dot(n, n) < 0.01) n = cross(dFdx(vW), dFdy(vW)); n = normalize(n);
  vec3 v = normalize(uEye - vW); if (dot(n, v) < 0.0) n = -n;
  vec3 L = normalize(vec3(0.35, -0.45, 0.82));
  float dif = max(dot(n, L), 0.0), hemi = 0.5 + 0.5 * n.z, spec = pow(max(dot(n, normalize(L + v)), 0.0), 24.0) * 0.18;
  vec3 c = vCol.rgb * (0.32 + 0.28 * hemi + 0.5 * dif) + spec;
  float d = length(uEye - vW), dunst = 1.0 - exp(-d / 900000.0);
  o = vec4(mix(c, vec3(0.62, 0.70, 0.78), dunst * 0.7), 1.0);
  if (uPick > 0.5) o = vec4(vW, vId);
}`;
// Felsen: Farbe aus dem Kartenbild an der Stelle (passt zum Gelände), steile Flächen grauer
const FELS_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm;
layout(location=2) in vec4 iM0; layout(location=3) in vec4 iM1; layout(location=4) in vec4 iM2; layout(location=5) in vec4 iM3;
uniform mat4 uVP; uniform vec3 uQMin, uQSpan;
out vec3 vW; out vec3 vN;
void main() {
  vec3 p = uQMin + (aPos * 0.5 + 0.5) * uQSpan;
  mat4 M = mat4(iM0, iM1, iM2, iM3); vec4 w = M * vec4(p, 1.0);
  vW = w.xyz; vN = mat3(M) * aNrm; gl_Position = uVP * w;
}`;
const FELS_FS = `#version 300 es
precision highp float;
uniform float uPick; // 1 = Weltposition statt Farbe ausgeben (Mausklick-Treffer)
in vec3 vW; in vec3 vN;
uniform sampler2D uK0, uK1, uK2, uK3; uniform vec4 uWelt; uniform vec3 uEye; uniform float uBild;
out vec4 o;
void main() {
  vec3 n = normalize(vN); if (dot(n, normalize(uEye - vW)) < 0.0) n = -n;
  vec2 q = (vW.xy - uWelt.xy) / (uWelt.zw - uWelt.xy) * 2.0;
  vec3 farbe = vec3(0.55, 0.50, 0.44);
  if (uBild > 0.5 && q.x >= 0.0 && q.y >= 0.0 && q.x < 2.0 && q.y < 2.0) {
    vec2 uv = fract(q);
    farbe = q.x < 1.0 ? (q.y < 1.0 ? texture(uK0, uv).rgb : texture(uK1, uv).rgb) : (q.y < 1.0 ? texture(uK2, uv).rgb : texture(uK3, uv).rgb);
  }
  farbe = mix(farbe, vec3(0.50, 0.47, 0.43), 0.55 * (1.0 - abs(n.z)));
  vec3 L = normalize(vec3(0.35, -0.45, 0.82));
  float dif = max(dot(n, L), 0.0), hemi = 0.5 + 0.5 * n.z;
  vec3 c = farbe * (0.40 + 0.25 * hemi + 0.55 * dif);
  float d = length(uEye - vW), dunst = 1.0 - exp(-d / 900000.0);
  o = vec4(mix(c, vec3(0.62, 0.70, 0.78), dunst * 0.7), 1.0);
  if (uPick > 0.5) o = vec4(vW, 1.0);
}`;
const LINE_VS = `#version 300 es
layout(location=0) in vec3 aPos; uniform mat4 uVP, uM; void main() { gl_Position = uVP * uM * vec4(aPos, 1.0); }`;
const LINE_FS = `#version 300 es
precision mediump float; uniform vec4 uCol; out vec4 o; void main() { o = uCol; }`;

const CUBE = (() => {
  const v = [], idx = [], F = [[0, 2, 6, 4], [1, 5, 7, 3], [0, 4, 5, 1], [2, 3, 7, 6], [0, 1, 3, 2], [4, 6, 7, 5]];
  for (const f of F) { const b = v.length / 3; for (const k of f) v.push(k & 1 ? 32767 : -32767, k & 2 ? 32767 : -32767, k & 4 ? 32767 : -32767); idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
  return { pos: new Int16Array(v), idx: new Uint32Array(idx) };
})();
// Zylinder für Rohre: Achse x 0…1, Querschnitt y/z −0,5…0,5 (Positionen wie CUBE normiert, dazu Normalen für runde Schattierung)
const ROHR_SEG = 12;
const ROHR = (() => {
  const v = [], n = [], idx = [];
  for (let k = 0; k <= ROHR_SEG; k++) {
    const a = (k / ROHR_SEG) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
    for (const x of [-32767, 32767]) { v.push(x, Math.round(c * 32767), Math.round(sn * 32767)); n.push(0, Math.round(c * 127), Math.round(sn * 127), 0); }
  }
  for (let k = 0; k < ROHR_SEG; k++) { const b = k * 2; idx.push(b, b + 1, b + 3, b, b + 3, b + 2); }
  return { pos: new Int16Array(v), nrm: new Int8Array(n), idx: new Uint16Array(idx) };
})();
const BEAM = /^Build_Beam(?!_Connector|_Support)/;
const EINS = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
// Leistungsmodus: Zellen von 200 m; Zellen näher als NAH mit Spielmodellen, weiter weg als Quader.
// AUTO_DREIECKE: ab so vielen Dreiecken pro Bild schaltet er sich beim Laden selbst ein (gemessen 24.10.: Grasland 359 Mio. → 1,1 s/Bild auf Iris Xe)
const ZELLE = 20000, NAH = 30000, MITTEL = 120000, AUTO_DREIECKE = 50e6; // MITTEL: bis 1,2 km vereinfachte Modelle, danach Quader
/** wachsender Zahlenpuffer (statt JS-Listen mit Millionen Einträgen – die bremsen über die Speicherbereinigung) */
class Puffer {
  constructor() { this.a = new Float32Array(20 * 64); this.n = 0; }
  add(x) { if (this.n + x.length > this.a.length) { const b = new Float32Array(Math.max(this.a.length * 2, this.n + x.length)); b.set(this.a.subarray(0, this.n)); this.a = b; } this.a.set(x, this.n); this.n += x.length; }
  inhalt() { return this.a.subarray(0, this.n); }
}
const zelleSchluessel = (x, y) => Math.floor(x / ZELLE) + ',' + Math.floor(y / ZELLE);
/** Sichtpyramiden-Ebenen aus der View-Projektion (spaltenweise) */
const ebenen = (m) => { const r = (i) => [m[i], m[4 + i], m[8 + i], m[12 + i]], [a, b, c, d] = [r(0), r(1), r(2), r(3)]; return [0, 1, 2].flatMap((k) => { const x = [a, b, c][k]; return [d.map((v, j) => v + x[j]), d.map((v, j) => v - x[j])]; }); };
/** Quader (min/max) ganz außerhalb einer Ebene → nicht im Bild */
const imSicht = (E, mn, mx) => E.every((p) => p[0] * (p[0] > 0 ? mx[0] : mn[0]) + p[1] * (p[1] > 0 ? mx[1] : mn[1]) + p[2] * (p[2] > 0 ? mx[2] : mn[2]) + p[3] >= 0);
const drehQ = (dreh = 0, kx = 0, ky = 0) => { const h = (g) => g * Math.PI / 360; return qmul([0, 0, Math.sin(h(dreh)), Math.cos(h(dreh))], qmul([0, Math.sin(h(ky)), 0, Math.cos(h(ky))], [Math.sin(h(kx)), 0, 0, Math.cos(h(kx))])); };
const qdreh = (q, [x, y, z]) => { const [a, b, c, d] = q, t = qmul(qmul(q, [x, y, z, 0]), [-a, -b, -c, d]); return [t[0], t[1], t[2]]; };
const qmul = ([ax, ay, az, aw], [bx, by, bz, bw]) => [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
// Querschnitt (Breite, Höhe in cm) für Linien-Bauteile – grob nach Spielmodellen
const LINIE_MASS = (cls) => (/RailroadTrack/.test(cls) ? [420, 40] : /PipeHyper/.test(cls) ? [260, 260] : /Pipeline/.test(cls) ? [110, 110] : [120, 25]);
const hexRgb = (hex) => { const n = parseInt((hex || '#8a8f99').slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

export class Welt3D {
  constructor(canvas, app) {
    this.cv = canvas; this.app = app;
    this.eye = [0, 0, 50000]; this.yaw = 0; this.pitch = -25; this.fov = 60;
    this.kacheln = new Map(); this.laden = new Set(); this.tasten = new Set(); this.raf = 0; this.letzt = 0;
    this.info = null; this.objekte = null; this.bildAn = true;
    this.setzen = null; this.gesetzt = []; this.bpCache = new Map(); // Stufe 3: Blaupausen setzen
    try { this.mausUmkehren = localStorage.getItem('bs-welt-maus-umkehren') === '1'; } catch { this.mausUmkehren = false; }
    this.initGl();
    this.bind();
  }

  // ------------------------------------------------------------ WebGL
  initGl() {
    const gl = this.gl = this.cv.getContext('webgl2', { antialias: true });
    if (!gl) throw new Error('WebGL 2 nicht verfügbar');
    const prog = (vs, fs) => {
      const p = gl.createProgram();
      for (const [t, s] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); gl.attachShader(p, sh); }
      gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
      return { p, u };
    };
    this.pT = prog(TERRAIN_VS, TERRAIN_FS); this.pO = prog(OBJ_VS, OBJ_FS); this.pL = prog(LINE_VS, LINE_FS); this.pF = prog(FELS_VS, FELS_FS);
    this.felsInstVbo = gl.createBuffer();
    this.cubeVbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.cubeVbo); gl.bufferData(gl.ARRAY_BUFFER, CUBE.pos, gl.STATIC_DRAW);
    this.cubeIbo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.cubeIbo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, CUBE.idx, gl.STATIC_DRAW);
    this.rohrVbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.rohrVbo); gl.bufferData(gl.ARRAY_BUFFER, ROHR.pos, gl.STATIC_DRAW);
    this.rohrNrm = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.rohrNrm); gl.bufferData(gl.ARRAY_BUFFER, ROHR.nrm, gl.STATIC_DRAW);
    this.rohrIbo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.rohrIbo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ROHR.idx, gl.STATIC_DRAW);
    this.vao = gl.createVertexArray();
    this.saetze = Object.fromEntries(['spielstand', 'gesetzt', 'geist', 'auswahl', 'gwahl'].map((k) => [k, { vbo: gl.createBuffer(), lineVbo: gl.createBuffer(), ranges: [], nLinie: 0 }]));
  }
  /** Gitter für eine Kachel: (N+3)² Punkte inkl. Schürze, gemeinsam für alle Kacheln */
  baueGitter(N) {
    const gl = this.gl, M = N + 3, v = new Float32Array(M * M * 2), idx = new Uint32Array((M - 1) * (M - 1) * 6);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) { v[(j * M + i) * 2] = i; v[(j * M + i) * 2 + 1] = j; }
    let k = 0; for (let j = 0; j < M - 1; j++) for (let i = 0; i < M - 1; i++) { const a = j * M + i; idx.set([a, a + 1, a + M + 1, a, a + M + 1, a + M], k); k += 6; }
    this.gVao = gl.createVertexArray(); gl.bindVertexArray(this.gVao);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null); this.gN = idx.length;
  }
  ladeKartenbild() {
    const gl = this.gl; this.bild = [];
    ['Map_0-0', 'Map_0-1', 'Map_1-0', 'Map_1-1'].forEach((n, k) => {
      const t = gl.createTexture(); this.bild[k] = t;
      gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([140, 130, 110]));
      const img = new Image();
      img.onload = () => { gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img); gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const an = gl.getExtension('EXT_texture_filter_anisotropic'); if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, 8); this.zeichne(); };
      img.src = `/api/karte/kachel/${n}`;
    });
  }
  async start() {
    if (this.info) return;
    const r = await fetch('/api/welt/info', { cache: 'no-store' }); this.info = await r.json();
    if (!this.info.gelaende) throw new Error('Keine Geländedaten – werkzeuge/gelaende mit --raster 100 ausführen.');
    const k = this.info.gelaende; this.N = this.info.kachel;
    this.baueGitter(this.N); this.ladeKartenbild(); this.ladeFelsen();
    // höchste Detailstufe: eine Kachel deckt die ganze Karte
    this.maxLod = Math.ceil(Math.log2(Math.max(k.breite, k.hoehe) / this.N));
    this.eye = [k.x0 + k.breite * 50, k.y0 + k.hoehe * 100 + 150000, 250000]; this.yaw = -90; this.pitch = -35;
    this.zeichne();
  }

  // ------------------------------------------------------------ Gelände-Kacheln
  kachelHolen(lod, x, y) {
    const key = `${lod}/${x}/${y}`; let t = this.kacheln.get(key);
    if (t) { t.benutzt = performance.now(); return t.tex ? t : null; }
    if (this.laden.size >= 6) return null; // höchstens 6 Anfragen gleichzeitig
    t = { benutzt: performance.now(), tex: null }; this.kacheln.set(key, t); this.laden.add(key);
    fetch(`/api/welt/kachel?lod=${lod}&x=${x}&y=${y}`).then((r) => r.arrayBuffer()).then((b) => {
      const gl = this.gl, d = new Int16Array(b), tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16I, this.N + 1, this.N + 1, 0, gl.RED_INTEGER, gl.SHORT, d);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      let alleLeer = true; for (let i = 0; i < d.length; i += 7) if (d[i] !== LEER) { alleLeer = false; break; }
      t.tex = tex; t.leer = alleLeer; t.daten = d; this.zeichne();
    }).catch(() => this.kacheln.delete(key)).finally(() => { this.laden.delete(key); if (this.laden.size === 0) this.zeichne(); });
    this.aufraeumen();
    return null;
  }
  aufraeumen() {
    if (this.kacheln.size < 700) return;
    const alt = [...this.kacheln.entries()].filter(([, t]) => t.tex).sort((a, b) => a[1].benutzt - b[1].benutzt).slice(0, 200);
    for (const [k, t] of alt) { this.gl.deleteTexture(t.tex); this.kacheln.delete(k); }
  }
  /** Quadtree: nahe Kacheln fein, ferne grob; fehlt eine feine Kachel noch, wird die gröbere gezeichnet */
  sichtbareKacheln() {
    if (!this.info?.gelaende) return [];
    const k = this.info.gelaende, out = [], N = this.N, e = this.eye;
    const besuche = (lod, x, y) => {
      const s = (1 << lod) * 100, gr = N * s, x0 = k.x0 + x * gr, y0 = k.y0 + y * gr;
      if (x0 > k.x0 + k.breite * 100 || y0 > k.y0 + k.hoehe * 100) return;
      const cx = Math.max(x0, Math.min(e[0], x0 + gr)), cy = Math.max(y0, Math.min(e[1], y0 + gr));
      const d = Math.hypot(e[0] - cx, e[1] - cy, Math.max(0, e[2] - 25000));
      const eigen = this.kachelHolen(lod, x, y);
      if (lod > 0 && d < gr * 1.6) {
        const kinder = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => [lod - 1, x * 2 + a, y * 2 + b]);
        const bereit = kinder.every(([l, a, b]) => { const s2 = (1 << l) * 100 * N; return k.x0 + a * s2 > k.x0 + k.breite * 100 || k.y0 + b * s2 > k.y0 + k.hoehe * 100 || this.kachelHolen(l, a, b); });
        if (bereit || !eigen) { for (const [l, a, b] of kinder) besuche(l, a, b); return; }
      }
      if (eigen && !eigen.leer) out.push({ t: eigen, x0, y0, s });
    };
    besuche(this.maxLod, 0, 0);
    return out;
  }

  // ------------------------------------------------------------ Spielstand
  async ladeSpielstand(id) {
    const r = await fetch('/api/welt/daten?id=' + encodeURIComponent(id), { cache: 'no-store' });
    if (!r.ok) { let m = r.status; try { m = (await r.json()).fehler; } catch { /* */ } throw new Error(m); }
    const buf = await r.arrayBuffer(), dv = new DataView(buf), jl = dv.getUint32(0, true);
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, jl)));
    const off = 4 + jl + ((4 - ((4 + jl) % 4)) % 4);
    this.objekte = { meta, w: new Float32Array(buf, off, meta.anzahl * 12) };
    this.spielstandId = id; if (this.punkteAn) this.punkteHolen();
    await this.ladeModelle(); // Spielmodelle im eigenen WebGL-Kontext (Puffer lassen sich nicht teilen)
    this.auswahl = new Set(); this.geloescht = new Set(); this.delta = new Map(); this.bewegung = null;
    this.spielstandNeu(true);
    // sehr große Stände: Leistungsmodus selbst einschalten (außer er wurde von Hand ausgeschaltet)
    this.leistungAuto = false;
    if (!this.leistung && !this.leistungAus && this.saetze.spielstand.dreiecke > AUTO_DREIECKE) { this.leistungSetzen(true); this.leistungAuto = true; }
    this.app.weltLeistungStatus?.(this);
    // Kamera über den eigenen Bauten
    const w = this.objekte.w; let sx = 0, sy = 0, sz = 0, n = 0;
    for (let i = 0; i < meta.anzahl; i += Math.max(1, Math.floor(meta.anzahl / 2000))) { sx += w[i * 12]; sy += w[i * 12 + 1]; sz += w[i * 12 + 2]; n++; }
    const p = meta.spieler?.[0] || (n ? [sx / n, sy / n, sz / n] : this.eye);
    this.eye = [p[0], p[1] + 30000, p[2] + 15000]; this.yaw = -90; this.pitch = -28;
    this.zeichne();
    return meta;
  }
  /** Instanzdaten für einen Satz bauen. quellen: [{ meta, w, dreh (Grad, um Z), off [x,y,z] }] */
  fuelleSatz(name, quellen, nurZellen = null) {
    const gl = this.gl, satz = this.saetze[name];
    const models = this.modelle || null, kat = this.app.kat?.gebaeude || {};
    // Leistungsmodus (nur der Spielstand): Instanzen nach Zellen getrennt – je Zelle Modelle und ein Quader je Teil für die Ferne.
    // nurZellen: nur diese Zellen neu aufbauen (Auswahl/Änderung), die übrigen bleiben
    const Z = this.leistung && name === 'spielstand' ? ZELLE : 0, zellen = new Map(); let zk = '';
    if (!Z || !satz.zellenMap) nurZellen = null;
    const zelleVon = zelleSchluessel;
    const quader = (key, a) => { // Modell-Instanz → Quader über die Modellgrenzen (gleiche Farbe/Nummer)
      if (key === '#rohr') return [...a.slice(0, 12), a[12] - (a[4] + a[8]) / 2, a[13] - (a[5] + a[9]) / 2, a[14] - (a[6] + a[10]) / 2, 1, ...a.slice(16)];
      const m = key === '#cube' ? null : models?.meshes[key]; if (!m) return a;
      const s = [m.max[0] - m.min[0], m.max[1] - m.min[1], m.max[2] - m.min[2]], n = m.min;
      return [a[0] * s[0], a[1] * s[0], a[2] * s[0], 0, a[4] * s[1], a[5] * s[1], a[6] * s[1], 0, a[8] * s[2], a[9] * s[2], a[10] * s[2], 0,
        a[0] * n[0] + a[4] * n[1] + a[8] * n[2] + a[12], a[1] * n[0] + a[5] * n[1] + a[9] * n[2] + a[13], a[2] * n[0] + a[6] * n[1] + a[10] * n[2] + a[14], 1, a[16], a[17], a[18], a[19]];
    };
    const groups = new Map(), push = (key, arr) => {
      if (Z) {
        let c = zellen.get(zk); if (!c) zellen.set(zk, c = { groups: new Map(), box: new Puffer(), min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
        let g = c.groups.get(key); if (!g) c.groups.set(key, g = new Puffer()); g.add(arr);
        const b = quader(key, arr); c.box.add(b);
        for (let k = 0; k < 8; k++) for (let j = 0; j < 3; j++) { const v = b[12 + j] + (k & 1 ? b[j] : 0) + (k & 2 ? b[4 + j] : 0) + (k & 4 ? b[8 + j] : 0); if (v < c.min[j]) c.min[j] = v; if (v > c.max[j]) c.max[j] = v; }
        return;
      }
      let g = groups.get(key); if (!g) groups.set(key, g = new Puffer()); g.add(arr);
    };
    const qm = (q, s) => { const [x, y, z, w] = q; return [(1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2]]; };
    const m3 = (A, B) => { const C = new Array(9); for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) C[c * 3 + r] = A[r] * B[c * 3] + A[3 + r] * B[c * 3 + 1] + A[6 + r] * B[c * 3 + 2]; return C; };
    const mv = (A, v) => [A[0] * v[0] + A[3] * v[1] + A[6] * v[2], A[1] * v[0] + A[4] * v[1] + A[7] * v[2], A[2] * v[0] + A[5] * v[1] + A[8] * v[2]];
    const L = [];
    for (const { meta, w, dreh = 0, kipp = [0, 0], off = [0, 0, 0], ids = false, id = 0, nur = null, ohne = null, delta = null } of quellen) {
      const qd = drehQ(dreh, kipp[0], kipp[1]), gedreht = dreh || kipp[0] || kipp[1];
      const lage = (x, y, z) => { const v = gedreht ? qdreh(qd, [x, y, z]) : [x, y, z]; return [v[0] + off[0], v[1] + off[1], v[2] + off[2]]; };
      const farben = meta.klassen.map((c) => hexRgb(colorFor(kat[c], c)));
      const liste = nur ? [...nur] : null, nAlle = liste ? liste.length : meta.anzahl;
      for (let ii = 0; ii < nAlle; ii++) {
        const i = liste ? liste[ii] : ii; if (ohne?.has(i) || i >= meta.anzahl) continue;
        const o = i * 12, cls = meta.klassen[w[o + 10]], s = [w[o + 7] || 1, w[o + 8] || 1, w[o + 9] || 1];
        const [p0, q0] = this.lageMit(w, i, delta?.get(i), meta);
        const q = gedreht ? qmul(qd, q0) : q0, p = lage(p0[0], p0[1], p0[2]);
        if (Z) { zk = zelleVon(p[0], p[1]); if (nurZellen && !nurZellen.has(zk)) continue; }
        const parts = this.teileFuer(cls, w[o + 11]) || models?.klassen?.[cls], col = [...farben[w[o + 10]].map((c) => c * 0.75 + 0.2), id || (ids ? i + 2 : 1)], R = qm(q, s);
        if (parts) {
          for (const [mesh, t, mq, s0] of parts) {
            let sk = s0;
            if (BEAM.test(cls) && w[o + 11] > 0) { const mm = models.meshes[mesh]; const Lm = mm ? mm.max[2] - mm.min[2] : 0; if (Lm > 1) sk = [s0[0], s0[1], s0[2] * w[o + 11] / Lm]; }
            const M = m3(R, qm(mq, sk)), T = mv(R, t);
            push(mesh, [M[0], M[1], M[2], 0, M[3], M[4], M[5], 0, M[6], M[7], M[8], 0, T[0] + p[0], T[1] + p[1], T[2] + p[2], 1, ...col]);
          }
        } else {
          const b = kat[cls]?.box || [-200, -200, 0, 200, 200, 400], ex = [b[3] - b[0], b[4] - b[1], b[5] - b[2]], c0 = mv(R, [b[0], b[1], b[2]]);
          push('#cube', [R[0] * ex[0], R[1] * ex[0], R[2] * ex[0], 0, R[3] * ex[1], R[4] * ex[1], R[5] * ex[1], 0, R[6] * ex[2], R[7] * ex[2], R[8] * ex[2], 0, p[0] + c0[0], p[1] + c0[1], p[2] + c0[2], 1, ...col]);
        }
      }
      // Bänder, Rohre, Schienen, Hypertubes: Abschnitte als flache/dicke Körper entlang der Kurve; Nummer = anzahl + Linie
      const nL = meta.linien.length, lListe = liste ? liste.filter((i) => i >= meta.anzahl).map((i) => i - meta.anzahl) : null;
      for (let jj = 0, nj = lListe ? lListe.length : nL; jj < nj; jj++) {
        const li = lListe ? lListe[jj] : jj, i = meta.anzahl + li; if (ohne?.has(i)) continue;
        const l = meta.linien[li], cls = meta.klassen[l[0]], [B, H] = LINIE_MASS(cls), d = delta?.get(i); const hv = /Pipe/.test(cls) ? 0.5 : 1; // Rohre mittig auf der Kurve, Bänder/Schienen darunter
        const c = d ? Math.cos(d.a) : 1, sn = d ? Math.sin(d.a) : 0;
        const pt = (k) => { let x = l[k], y = l[k + 1], z = l[k + 2]; if (d) { [x, y] = [c * x - sn * y + d.t[0], sn * x + c * y + d.t[1]]; z += d.t[2]; } return lage(x, y, z); };
        const col = [...farben[l[0]].map((v) => v * 0.75 + 0.2), id || (ids ? i + 2 : 1)];
        let a0 = pt(1);
        if (Z) { zk = zelleVon(a0[0], a0[1]); if (nurZellen && !nurZellen.has(zk)) continue; }
        for (let k = 4; k + 2 < l.length; k += 3) {
          const b0 = pt(k), dv = [b0[0] - a0[0], b0[1] - a0[1], b0[2] - a0[2]], len = Math.hypot(...dv); if (len < 1) continue;
          let sd = [dv[1], -dv[0], 0], sl = Math.hypot(sd[0], sd[1]); sd = sl > 1e-6 ? [sd[0] / sl, sd[1] / sl, 0] : [1, 0, 0];
          const u = [sd[1] * dv[2] / len - 0, -sd[0] * dv[2] / len, (sd[0] * dv[1] - sd[1] * dv[0]) / len]; // oben = Seite × Richtung
          if (hv < 1) push('#rohr', [dv[0], dv[1], dv[2], 0, sd[0] * B, sd[1] * B, 0, 0, u[0] * H, u[1] * H, u[2] * H, 0, a0[0], a0[1], a0[2], 1, ...col]);
          else push('#cube', [dv[0], dv[1], dv[2], 0, sd[0] * B, sd[1] * B, 0, 0, u[0] * H, u[1] * H, u[2] * H, 0, a0[0] - sd[0] * B / 2 - u[0] * H * hv, a0[1] - sd[1] * B / 2 - u[1] * H * hv, a0[2] - u[2] * H * hv, 1, ...col]);
          a0 = b0;
        }
      }
    }
    if (nurZellen) { for (const k of nurZellen) { const c = satz.zellenMap.get(k); if (c) { gl.deleteBuffer(c.vbo); satz.zellenMap.delete(k); } } }
    else { for (const c of satz.zellen || []) gl.deleteBuffer(c.vbo); satz.zellen = null; satz.zellenMap = null; }
    if (Z) { // je Zelle ein Puffer: Modelle, danach die Quader
      if (!nurZellen) satz.zellenMap = new Map();
      satz.ranges = []; let dreiecke = 0;
      for (const [k, c] of zellen) {
        let total = c.box.n; for (const g of c.groups.values()) total += g.n;
        const data = new Float32Array(total), ranges = []; let off = 0;
        for (const [key, g] of c.groups) { data.set(g.inhalt(), off); ranges.push({ key, first: off / 20, count: g.n / 20 }); off += g.n; dreiecke += this.dreieckeVon(key) * g.n / 20; }
        data.set(c.box.inhalt(), off); const box = { key: '#cube', first: off / 20, count: c.box.n / 20 };
        const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        satz.zellenMap.set(k, { vbo, ranges, box, min: c.min, max: c.max });
      }
      satz.zellen = [...satz.zellenMap.values()];
      if (!nurZellen) satz.dreiecke = dreiecke;
      gl.bindBuffer(gl.ARRAY_BUFFER, satz.lineVbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(L), gl.STATIC_DRAW); satz.nLinie = L.length / 3;
      this.zeichne(); return;
    }
    let total = 0; for (const g of groups.values()) total += g.n;
    const data = new Float32Array(total), ranges = []; let off = 0;
    for (const [key, g] of groups) { data.set(g.inhalt(), off); ranges.push({ key, first: off / 20, count: g.n / 20 }); off += g.n; }
    gl.bindBuffer(gl.ARRAY_BUFFER, satz.vbo); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); satz.ranges = ranges;
    satz.dreiecke = ranges.reduce((s, rg) => s + this.dreieckeVon(rg.key) * rg.count, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, satz.lineVbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(L), gl.STATIC_DRAW); satz.nLinie = L.length / 3;
    this.zeichne();
  }
  // ------------------------------------------------------------ Kartenpunkte (Knoten, Absturzstellen, Sammelobjekte)
  /** an/aus; beim ersten Einschalten laden (mit Zustand aus dem geladenen Spielstand) */
  punkteSetzen(an) { this.punkteAn = an; if (an && !this.punkte) this.punkteHolen(); this.zeichne(); }
  async punkteHolen() {
    this.punkteFilter ||= filterLaden();
    try {
      const r = await fetch('/api/welt/punkte' + (this.spielstandId ? '?id=' + encodeURIComponent(this.spielstandId) : ''), { cache: 'no-store' });
      const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status);
      this.punkte = j; this.app.weltPunkteStatus?.(this); this.zeichne();
    } catch (e) { this.app.toast?.(e.message, 'err'); }
  }
  /** Punkte als 2D-Ebene über der 3D-Ansicht (eigene Leinwand, Mausereignisse gehen durch) */
  punkteZeichnen(VP) {
    let c = this.pCv;
    if (!this.punkteAn || !this.punkte || this.pick) { if (c) c.style.display = 'none'; this.punkteGez = null; return; }
    if (!c) { c = this.pCv = document.createElement('canvas'); c.className = 'w-punkte'; this.cv.parentElement.insertBefore(c, this.cv.nextSibling); }
    const w = this.cv.clientWidth, h = this.cv.clientHeight, dpr = window.devicePixelRatio || 1;
    c.style.display = ''; if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const proj = (x, y, z) => {
      const cw = VP[3] * x + VP[7] * y + VP[11] * z + VP[15]; if (cw <= 100) return null;
      const sx = ((VP[0] * x + VP[4] * y + VP[8] * z + VP[12]) / cw * 0.5 + 0.5) * w, sy = (0.5 - (VP[1] * x + VP[5] * y + VP[9] * z + VP[13]) / cw * 0.5) * h;
      return sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20 ? null : [sx, sy, cw];
    };
    this.punkteGez = zeichnePunkte(ctx, this.punkte, proj, this.punkteFilter, 12);
  }
  /** Tooltip über dem Punkt unter der Maus */
  punktTipp(e) {
    let t = this.pTipp; const G = this.punkteGez;
    if (!G || !G.length) { if (t) t.hidden = true; return; }
    const r = this.cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = null, bd = Infinity; for (const g of G) { const d = Math.hypot(g.sx - mx, g.sy - my); if (d < g.r + 5 && d < bd) { bd = d; best = g; } }
    if (!best) { if (t) t.hidden = true; return; }
    if (!t) { t = this.pTipp = document.createElement('div'); t.className = 'w-punkt-tipp'; this.cv.parentElement.appendChild(t); }
    t.textContent = punktText(this.punkte, this.punkte.p[best.i], this.app.kat); t.style.left = mx + 14 + 'px'; t.style.top = my + 10 + 'px'; t.hidden = false;
  }
  // ------------------------------------------------------------ Ego-Modus: auf Augenhöhe durch die Fabriken schweben
  egoSetzen(an) {
    if (an) { this.ego = { an: true, wartet: true, hoehe: 180, boden: null, vorher: { eye: [...this.eye], yaw: this.yaw, pitch: this.pitch } }; this.cv.style.cursor = 'crosshair'; }
    else if (this.ego) { const v = this.ego.vorher; this.ego = null; this.cv.style.cursor = ''; if (v) { this.eye = v.eye; this.yaw = v.yaw; this.pitch = v.pitch; } }
    this.zeichne();
  }
  /** Startpunkt: getroffene Oberfläche (Gelände oder Bauteil) unter der Maus, Blick waagerecht */
  egoStart(cx, cy) {
    const p = this.treffer(cx, cy); if (!p) return;
    this.ego.wartet = false; this.ego.boden = null; this.ego.hoehe = 180;
    this.eye = [p[0], p[1], p[2] + 180]; this.pitch = 0; this.cv.style.cursor = '';
    this.ego.boden = p[2]; // auf Bauteilen (Fundamenten) bleibt die Höhe des Startpunkts; über freiem Gelände folgt sie dem Boden
    this.ego.folgen = Math.abs(p[2] - (this.boden() ?? p[2])) < 150;
    if (this.ego.folgen) this.ego.boden = null;
    this.app.weltEgoStatus?.(this); this.zeichne();
  }
  /** Leistungsmodus an/aus (von Hand: aus = bleibt aus, auch bei großen Ständen) */
  leistungSetzen(an, vonHand = false) {
    if (vonHand) this.leistungAus = !an;
    if (this.leistung === an) return;
    this.leistung = an; this.spielstandNeu(true);
  }
  /** Lifte/Stützen aus Teilen (js/teile.js) – sonst null */
  teileFuer(cls, p) { return teileDynamisch(this.modelle, cls, p); }
  /** Dreiecke eines Modells (Quader 12) */
  dreieckeVon(key) { return key === '#cube' ? 12 : key === '#rohr' ? ROHR_SEG * 2 : (this.modelle?.meshes[key]?.ni || 0) / 3; }
  zeichneSatz(VP, satz, M = EINS, tint = [0, 0, 0, 0]) {
    if (!satz.ranges.length && !satz.nLinie && !satz.zellen?.length) return;
    const gl = this.gl, O = this.pO; gl.useProgram(O.p); gl.uniformMatrix4fv(O.u.uVP, false, VP); gl.uniformMatrix4fv(O.u.uM, false, M); gl.uniform4fv(O.u.uTint, tint); gl.uniform3fv(O.u.uEye, this.eye); gl.uniform1f(O.u.uPick, this.pick ? 1 : 0);
    gl.bindVertexArray(this.vao);
    if (satz.zellen) { // Leistungsmodus: nur Zellen im Bild; ferne Zellen als Quader
      const E = ebenen(VP), e = this.eye; let gez = 0, nah = 0, mittel = 0;
      for (const c of satz.zellen) {
        if (!imSicht(E, c.min, c.max)) continue;
        const d = Math.hypot(...[0, 1, 2].map((j) => Math.max(c.min[j] - e[j], 0, e[j] - c.max[j])));
        if (d < NAH) { for (const rg of c.ranges) this.zeichneRange(rg, c.vbo); nah++; } else if (d < MITTEL) { for (const rg of c.ranges) this.zeichneRange(rg, c.vbo, true); mittel++; } else this.zeichneRange(c.box, c.vbo);
        gez++;
      }
      this.zellenStatus = { gez, nah, mittel, alle: satz.zellen.length };
    } else for (const rg of satz.ranges) this.zeichneRange(rg, satz.vbo);
    if (satz.nLinie && !this.pick) {
      const Lp = this.pL; gl.useProgram(Lp.p); gl.uniformMatrix4fv(Lp.u.uVP, false, VP); gl.uniformMatrix4fv(Lp.u.uM, false, M);
      gl.uniform4f(Lp.u.uCol, ...(tint[3] ? [0.35, 0.75, 1, 1] : [0.95, 0.65, 0.2, 1]));
      gl.bindBuffer(gl.ARRAY_BUFFER, satz.lineVbo); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0); for (let k = 1; k < 7; k++) gl.disableVertexAttribArray(k);
      gl.drawArrays(gl.LINES, 0, satz.nLinie);
    }
    gl.bindVertexArray(null);
  }
  /** Einen Instanz-Abschnitt (ein Modell) aus dem Puffer vbo zeichnen */
  zeichneRange(rg, vbo, grob = false) {
    const gl = this.gl, O = this.pO, models = this.modelle;
    if (!rg.count) return;
    {
      const eigen = rg.key === '#cube' || rg.key === '#rohr', m = eigen ? null : models?.meshes[rg.key]; if (!eigen && !m) return;
      if (m) { gl.bindBuffer(gl.ARRAY_BUFFER, this.meshVbo); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.SHORT, true, 6, m.oPos); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.BYTE, true, 4, m.oNrm); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshIbo); gl.uniform3fv(O.u.uQMin, m.min); gl.uniform3f(O.u.uQSpan, m.max[0] - m.min[0], m.max[1] - m.min[1], m.max[2] - m.min[2]); }
      else if (rg.key === '#rohr') { gl.bindBuffer(gl.ARRAY_BUFFER, this.rohrVbo); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.SHORT, true, 6, 0); gl.bindBuffer(gl.ARRAY_BUFFER, this.rohrNrm); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.BYTE, true, 4, 0); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.rohrIbo); gl.uniform3f(O.u.uQMin, 0, -0.5, -0.5); gl.uniform3f(O.u.uQSpan, 1, 1, 1); }
      else { gl.bindBuffer(gl.ARRAY_BUFFER, this.cubeVbo); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.SHORT, true, 6, 0); gl.disableVertexAttribArray(1); gl.vertexAttrib3f(1, 0, 0, 0); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.cubeIbo); gl.uniform3f(O.u.uQMin, 0, 0, 0); gl.uniform3f(O.u.uQSpan, 1, 1, 1); }
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      for (let k = 0; k < 5; k++) { gl.enableVertexAttribArray(2 + k); gl.vertexAttribPointer(2 + k, 4, gl.FLOAT, false, 80, rg.first * 80 + k * 16); gl.vertexAttribDivisor(2 + k, 1); }
      if (m) { const g = grob && m.niGrob; gl.drawElementsInstanced(gl.TRIANGLES, g ? m.niGrob : m.ni, m.u32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, g ? m.oIdxGrob : m.oIdx, rg.count); }
      else if (rg.key === '#rohr') gl.drawElementsInstanced(gl.TRIANGLES, ROHR_SEG * 6, gl.UNSIGNED_SHORT, 0, rg.count);
      else gl.drawElementsInstanced(gl.TRIANGLES, 36, gl.UNSIGNED_INT, 0, rg.count);
      for (let k = 0; k < 5; k++) gl.vertexAttribDivisor(2 + k, 0);
    }
  }

  // ------------------------------------------------------------ Bestehendes ändern (Stufe 4)
  /** Lage eines Bauteils mit Änderung d = { a (rad um Z), t [x,y,z] }: p' = Rz(a)·p + t, q' = qz(a)·q */
  lageMit(w, i, d, meta = this.objekte?.meta) {
    let p, q;
    if (meta && i >= meta.anzahl) { const L = meta.linienLage, o = (i - meta.anzahl) * 7; p = [L[o], L[o + 1], L[o + 2]]; q = [L[o + 3], L[o + 4], L[o + 5], L[o + 6]]; }
    else { const o = i * 12; p = [w[o], w[o + 1], w[o + 2]]; q = [w[o + 3], w[o + 4], w[o + 5], w[o + 6]]; }
    if (!d) return [p, q];
    const c = Math.cos(d.a), s = Math.sin(d.a);
    return [[c * p[0] - s * p[1] + d.t[0], s * p[0] + c * p[1] + d.t[1], p[2] + d.t[2]], qmul([0, 0, Math.sin(d.a / 2), Math.cos(d.a / 2)], q)];
  }
  spielstandNeu(ganz = false) {
    const O = this.objekte; if (!O) return;
    const ohne = new Set([...this.auswahl, ...this.geloescht]), S = this.saetze.spielstand;
    // Leistungsmodus: nur die Zellen neu aufbauen, in denen sich etwas geändert hat (Auswahl, Löschen, Verschieben)
    let nur = null;
    if (!ganz && this.leistung && S.zellenMap && this.alt) {
      const geaendert = new Set();
      for (const i of ohne) if (!this.alt.ohne.has(i)) geaendert.add(i);
      for (const i of this.alt.ohne) if (!ohne.has(i)) geaendert.add(i);
      for (const [i, d] of this.delta) if (this.alt.delta.get(i) !== d) geaendert.add(i);
      for (const i of this.alt.delta.keys()) if (!this.delta.has(i)) geaendert.add(i);
      // Teile je Zelle nachführen (verschobene wechseln die Zelle), dann nur die Teile der betroffenen Zellen neu
      const T = this.zellenTeile; nur = new Set();
      for (const i of geaendert) {
        const a = this.zelleVonTeil(i, this.alt.delta.get(i)), b = this.zelleVonTeil(i, this.delta.get(i)); nur.add(a); nur.add(b);
        if (a !== b) { T.get(a)?.delete(i); let s = T.get(b); if (!s) T.set(b, s = new Set()); s.add(i); }
      }
      const liste = []; for (const k of nur) for (const i of T.get(k) || []) liste.push(i);
      if (nur.size) this.fuelleSatz('spielstand', [{ meta: O.meta, w: O.w, ids: true, ohne, delta: this.delta, nur: liste }], nur);
    } else {
      this.fuelleSatz('spielstand', [{ meta: O.meta, w: O.w, ids: true, ohne, delta: this.delta }]);
      if (this.leistung) { // Teile je Zelle für spätere Teil-Neuaufbauten
        const T = this.zellenTeile = new Map(), n = O.meta.anzahl + O.meta.linien.length;
        for (let i = 0; i < n; i++) { const k = this.zelleVonTeil(i, this.delta.get(i)); let s = T.get(k); if (!s) T.set(k, s = new Set()); s.add(i); }
      }
    }
    this.alt = { ohne, delta: new Map(this.delta) };
    this.fuelleSatz('auswahl', this.auswahl.size ? [{ meta: O.meta, w: O.w, ids: true, nur: this.auswahl, delta: this.delta }] : []);
    if (this.infoFeld && !this.auswahl.has(this.infoTeil)) { this.infoFeld.hidden = true; this.infoTeil = -1; }
    this.app.weltAendernStatus?.(this);
  }
  /** Klick auf ein Bauteil: allein auswählen oder (zusatz) hinzufügen/abwählen */
  waehle(i, zusatz) {
    const O = this.objekte; if (!O) return;
    if (this.refVon(i) == null) { this.app.toast?.('Dieses Bauteil liegt nicht im Haupt-Level und lässt sich hier nicht ändern.', 'err'); return; }
    this.festigen();
    if (!zusatz) this.auswahl = new Set([i]); else if (this.auswahl.has(i)) this.auswahl.delete(i); else this.auswahl.add(i);
    this.spielstandNeu();
  }
  /** Schwebendes Feld neben einer angeklickten Maschine: Rezept, Takt, Ein-/Ausgänge (aus dem Spielstand); i < 0 = schließen */
  async maschineZeigen(i, x, y) {
    let el = this.infoFeld;
    const zu = () => { if (el) el.hidden = true; this.infoTeil = -1; };
    if (i < 0 || !this.spielstandId) return zu();
    const ref = this.refVon(i), cls = this.klasseVon(i);
    if (typeof ref !== 'string' || !/^Build_(Smelter|Constructor|Assembler|Foundry|Manufacturer|OilRefinery|Blender|Packager|HadronCollider|QuantumEncoder|Converter|Miner|OilPump|WaterPump|FrackingExtractor|Generator)/.test(cls)) return zu();
    this.infoTeil = i;
    let j; try { const r = await fetch('/api/welt/maschine?id=' + encodeURIComponent(this.spielstandId) + '&ref=' + encodeURIComponent(ref), { cache: 'no-store' }); j = await r.json(); if (!r.ok) throw new Error(j.fehler); } catch { return zu(); }
    if (this.infoTeil !== i) return; // inzwischen anderes gewählt
    if (!el) { el = this.infoFeld = document.createElement('div'); el.className = 'w-maschine'; this.cv.parentElement.appendChild(el); }
    el.innerHTML = this.app.weltMaschineHtml?.(j) || '';
    const r = this.cv.getBoundingClientRect(), bx = x - r.left + 18, by = y - r.top - 10;
    el.hidden = false; el.style.left = Math.min(bx, r.width - el.offsetWidth - 8) + 'px'; el.style.top = Math.max(8, Math.min(by, r.height - el.offsetHeight - 8)) + 'px';
  }
  // ------------------------------------------------------------ Stift: Lasso-Auswahl (auch verdeckte Teile)
  stiftSetzen(an) { this.stift = an; this.cv.style.cursor = an ? 'crosshair' : ''; if (!an && this.lasso) { this.lasso = null; this.lassoZeichnen(); } }
  /** Linie des Lassos über der Ansicht (SVG) */
  lassoZeichnen() {
    let s = this.lassoSvg;
    if (!s) { s = this.lassoSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'w-lasso'); s.innerHTML = '<polygon/>'; this.cv.parentElement.appendChild(s); }
    s.style.display = this.lasso ? '' : 'none';
    if (this.lasso) s.firstChild.setAttribute('points', this.lasso.map((p) => p.join(',')).join(' '));
  }
  /** Lasso schließen: alle Bauteile, deren Lage im Bild innerhalb liegt – auch verdeckte (dazu = Umschalt, weg = Strg/Alt) */
  lassoFertig(dazu, weg) {
    const P = this.lasso; this.lasso = null; this.lassoZeichnen();
    if (!P || P.length < 3) return;
    const O = this.objekte, VP = this.aktuelleVP(), r = this.cv.getBoundingClientRect(), W = r.width, H = r.height, n = O.meta.anzahl + O.meta.linien.length;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const [x, y] of P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const innen = (x, y) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
    let treffer = [];
    const abst = [], e = this.eye;
    for (let i = 0; i < n; i++) {
      if (this.geloescht.has(i) || this.refVon(i) == null) continue;
      const [p] = this.lageMit(O.w, i, this.delta.get(i));
      const cw = VP[3] * p[0] + VP[7] * p[1] + VP[11] * p[2] + VP[15]; if (cw <= 0) continue;
      const sx = ((VP[0] * p[0] + VP[4] * p[1] + VP[8] * p[2] + VP[12]) / cw * 0.5 + 0.5) * W, sy = (0.5 - (VP[1] * p[0] + VP[5] * p[1] + VP[9] * p[2] + VP[13]) / cw * 0.5) * H;
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1 && innen(sx, sy)) { treffer.push(i); abst.push(Math.hypot(p[0] - e[0], p[1] - e[1], p[2] - e[2])); }
    }
    // Tiefe: nur bis so weit hinter dem vordersten Treffer (verdeckte Teile im Gebäude ja, Gebäude weit dahinter nein)
    const tiefe = (this.lassoTiefe ?? 600) * 100;
    if (tiefe > 0 && treffer.length) { let vorn = Infinity; for (const a of abst) if (a < vorn) vorn = a; treffer = treffer.filter((_, k) => abst[k] <= vorn + tiefe); }
    this.festigen();
    if (!dazu && !weg) this.auswahl = new Set(treffer); else for (const i of treffer) { if (weg) this.auswahl.delete(i); else this.auswahl.add(i); }
    this.spielstandNeu();
    this.app.toast?.(`${treffer.length.toLocaleString('de-DE')} Bauteile ${weg ? 'abgewählt' : dazu ? 'dazu gewählt' : 'gewählt'} (auch verdeckte).`, 'ok');
    this.app.weltAuswahlMenue?.(this, (x0 + x1) / 2, y0, y1); // Feld über dem umrandeten Bereich
  }
  /** Auswahl löschen (erst beim Speichern in der neuen Datei wirksam) */
  auswahlLoeschen() {
    if (!this.auswahl?.size) return;
    this.festigen(); for (const i of this.auswahl) this.geloescht.add(i); const n = this.auswahl.size; this.auswahl = new Set(); this.spielstandNeu();
    this.app.toast?.(`${n} Bauteil(e) gelöscht (erst beim Speichern in der neuen Datei).`, 'ok');
  }
  /** Welt zurücksetzen: Spielstand entladen, gesetzte Blaupausen und Änderungen verwerfen – nur Gelände bleibt */
  zuruecksetzen() {
    this.setzen = null; this.gesetzt = []; this.gSel = null; this.lasso = null; this.lassoZeichnen();
    this.objekte = null; this.spielstandId = null; this.alt = null; this.zellenTeile = null;
    this.auswahl = new Set(); this.geloescht = new Set(); this.delta = new Map(); this.bewegung = null;
    for (const k of ['spielstand', 'gesetzt', 'geist', 'auswahl', 'gwahl']) this.fuelleSatz(k, []);
    if (this.infoFeld) { this.infoFeld.hidden = true; this.infoTeil = -1; }
    if (this.punkteAn) this.punkteHolen();
    this.app.weltGMenue?.(this, null); this.app.weltAuswahlMenue?.(this); this.app.weltSetzenStatus?.(this);
    this.zeichne();
  }
  /** Auswahl als Verweise für den Server: Akteur-Pfade und Leichtbau [Klasse, Nr.] */
  auswahlRefs() {
    const O = this.objekte, akteure = [], leicht = [];
    for (const i of this.auswahl) { const r = this.refVon(i); if (r == null) continue; if (typeof r === 'string') akteure.push(r); else leicht.push([O.meta.lwTypen[r[0]], r[1]]); }
    return { akteure, leicht };
  }
  /** Zelle eines Bauteils mit Änderung d – wie fuelleSatz sie vergibt (Linien: erster Punkt) */
  zelleVonTeil(i, d) {
    const m = this.objekte.meta;
    if (i < m.anzahl) { const [p] = this.lageMit(this.objekte.w, i, d); return zelleSchluessel(p[0], p[1]); }
    const l = m.linien[i - m.anzahl]; let x = l[1], y = l[2];
    if (d) { const c = Math.cos(d.a), s = Math.sin(d.a); [x, y] = [c * x - s * y + d.t[0], s * x + c * y + d.t[1]]; }
    return zelleSchluessel(x, y);
  }
  /** Verweis eines Bauteils (Akteur-Pfad oder [Leichtbau-Klasse, Nr.]); Linien ab Nummer anzahl */
  refVon(i) { const m = this.objekte?.meta; if (!m) return null; return i < m.anzahl ? m.refs?.[i] : m.linienRefs?.[i - m.anzahl]; }
  /** Klassenname eines Bauteils (auch Linien) */
  klasseVon(i) { const O = this.objekte; return i < O.meta.anzahl ? O.meta.klassen[O.w[i * 12 + 10]] : O.meta.klassen[O.meta.linien[i - O.meta.anzahl][0]]; }
  auswahlAufheben() { if (!this.auswahl?.size) return; this.festigen(); this.auswahl = new Set(); this.spielstandNeu(); }
  /** Mitte der Auswahl (Drehpunkt) */
  auswahlMitte() {
    const O = this.objekte; let x = 0, y = 0, z = Infinity;
    for (const i of this.auswahl) { const [p] = this.lageMit(O.w, i, this.delta.get(i)); x += p[0]; y += p[1]; z = Math.min(z, p[2]); }
    return [x / this.auswahl.size, y / this.auswahl.size, z];
  }
  /** laufende Bewegung der Auswahl in die Änderungen je Bauteil übernehmen */
  festigen() {
    const B = this.bewegung; this.bewegung = null; if (!B || (!B.a && !B.t[0] && !B.t[1] && !B.t[2])) return;
    const c = Math.cos(B.a), s = Math.sin(B.a), m = B.m;
    const k = [m[0] - (c * m[0] - s * m[1]) + B.t[0], m[1] - (s * m[0] + c * m[1]) + B.t[1], B.t[2]]; // p' = Rz(a)(p − m) + m + t
    for (const i of this.auswahl) {
      const d = this.delta.get(i) || { a: 0, t: [0, 0, 0] };
      this.delta.set(i, { a: d.a + B.a, t: [c * d.t[0] - s * d.t[1] + k[0], s * d.t[0] + c * d.t[1] + k[1], d.t[2] + k[2]] });
    }
    this.spielstandNeu();
  }
  auswahlMatrix() {
    const B = this.bewegung; if (!B) return EINS;
    const c = Math.cos(B.a), s = Math.sin(B.a), m = B.m;
    return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, m[0] - (c * m[0] - s * m[1]) + B.t[0], m[1] - (s * m[0] + c * m[1]) + B.t[1], B.t[2], 1]);
  }
  /** Taste bei aktiver Auswahl: Pfeile verschieben entlang der Weltachse, die der Blickrichtung am nächsten ist */
  auswahlTaste(e) {
    const k = e.key; if (!this.auswahl?.size) return false;
    if (k === 'Escape') { this.auswahlAufheben(); return true; }
    if (k === 'Delete') { this.auswahlLoeschen(); return true; }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'r', 'R'].includes(k)) return false;
    if (!this.bewegung) this.bewegung = { a: 0, t: [0, 0, 0], m: this.auswahlMitte() };
    const B = this.bewegung, schritt = e.shiftKey ? 800 : 100;
    const f = this.richtung(), ach = Math.abs(f[0]) >= Math.abs(f[1]) ? [Math.sign(f[0]), 0] : [0, Math.sign(f[1])], re = [-ach[1], ach[0]]; // rechts wie this.rechts();
    if (k === 'ArrowUp') { B.t[0] += ach[0] * schritt; B.t[1] += ach[1] * schritt; }
    if (k === 'ArrowDown') { B.t[0] -= ach[0] * schritt; B.t[1] -= ach[1] * schritt; }
    if (k === 'ArrowRight') { B.t[0] += re[0] * schritt; B.t[1] += re[1] * schritt; }
    if (k === 'ArrowLeft') { B.t[0] -= re[0] * schritt; B.t[1] -= re[1] * schritt; }
    if (k === 'PageUp') B.t[2] += e.shiftKey ? 400 : 100;
    if (k === 'PageDown') B.t[2] -= e.shiftKey ? 400 : 100;
    if (k === 'r' || k === 'R') B.a += (e.shiftKey ? 15 : 90) * Math.PI / 180;
    this.app.weltAendernStatus?.(this); this.zeichne(); return true;
  }
  aenderungenVerwerfen() { this.auswahl = new Set(); this.geloescht = new Set(); this.delta = new Map(); this.bewegung = null; this.spielstandNeu(); }
  /** Änderungen für den Server: Verweise + neue Lage (Position, Quaternion) */
  aenderungen() {
    this.festigen();
    const O = this.objekte; if (!O) return { loeschen: [], verschieben: [] };
    const ref = (i) => { const r = this.refVon(i); return r == null ? null : typeof r === 'string' ? { a: r } : { l: O.meta.lwTypen[r[0]], i: r[1] }; };
    const loeschen = [...this.geloescht].map(ref).filter(Boolean);
    const verschieben = [...this.delta.keys()].filter((i) => !this.geloescht.has(i) && ref(i)).map((i) => { const [pos, rot] = this.lageMit(O.w, i, this.delta.get(i)); return { ref: ref(i), pos, rot }; });
    return { loeschen, verschieben };
  }

  // ------------------------------------------------------------ Blaupausen setzen (Stufe 3)
  /** quelle: { session, name } oder { ablage, name } */
  async waehleBlaupause(quelle) {
    const key = JSON.stringify(quelle); let d = this.bpCache.get(key);
    if (!d) {
      const qs = new URLSearchParams({ name: quelle.name, ...(quelle.ablage != null ? { ablage: quelle.ablage } : { session: quelle.session }) });
      const r = await fetch('/api/welt/blaupause?' + qs, { cache: 'no-store' });
      if (!r.ok) { let m = r.status; try { m = (await r.json()).fehler; } catch { /* */ } throw new Error(m); }
      const buf = await r.arrayBuffer(), dv = new DataView(buf), jl = dv.getUint32(0, true);
      const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, jl))), off = 4 + jl + ((4 - ((4 + jl) % 4)) % 4);
      d = { meta, w: new Float32Array(buf, off, meta.anzahl * 12) }; this.bpCache.set(key, d);
    }
    const sv = this.objekte?.meta?.version, bv = d.meta.version;
    if (sv && bv < Math.min(sv, 46)) throw new Error(`„${quelle.name}“ ist in einem sehr alten Format gespeichert (Version ${bv}, vor Spielversion 1.0) – das rechnet die App (noch) nicht um. Abhilfe: im Spiel im Blaupausen-Designer öffnen und neu speichern.`); // 46–52 rechnet der Server beim Speichern um
    await this.ladeModelle();
    this.fuelleSatz('geist', [d]);
    this.auswahlAufheben?.();
    this.setzen = { quelle, daten: d, dreh: this.setzen?.dreh || 0, dz: 0, p: null };
    this.app.weltSetzenStatus?.(this);
    return d.meta;
  }
  setzenBeenden() { const z = this.setzen?.zurueck; if (z) { this.gesetzt.push(z); this.gesetztNeu(); } this.setzen = null; this.fuelleSatz('geist', []); this.app.weltSetzenStatus?.(this); }
  legeAb() {
    const S = this.setzen; if (!S?.p) return;
    this.gesetzt.push({ quelle: S.quelle, daten: S.daten, x: S.p[0], y: S.p[1], z: S.p[2] + S.dz, dreh: S.dreh, kx: S.kx || 0, ky: S.ky || 0 });
    if (S.zurueck) { this.setzen = null; this.fuelleSatz('geist', []); } // verschobene Blaupause: einmal absetzen, fertig
    this.gesetztNeu();
  }
  entferne(i) { this.gesetzt.splice(i, 1); if (this.gSel === i) this.gSel = null; else if (this.gSel > i) this.gSel--; this.gesetztNeu(); }
  /** gesetzte Blaupause wählen (Klick in der Welt oder in der Liste); x/y = Mausposition fürs Menü */
  gWaehle(i, x = null, y = null) { this.auswahlAufheben?.(); this.gSel = i; this.gesetztNeu(); this.app.weltGMenue?.(this, i, x, y); }
  gAufheben() { if (this.gSel == null) return; this.gSel = null; this.gesetztNeu(); this.app.weltGMenue?.(this, null); }
  /** gewählte Blaupause wieder an die Maus nehmen; Esc/Rechtsklick legt sie an den alten Platz zurück */
  gVerschieben(i = this.gSel) {
    const g = this.gesetzt[i]; if (!g) return;
    this.gesetzt.splice(i, 1); this.gSel = null; this.gesetztNeu(); this.app.weltGMenue?.(this, null);
    this.fuelleSatz('geist', [g.daten]);
    this.setzen = { quelle: g.quelle, daten: g.daten, dreh: g.dreh, kx: g.kx || 0, ky: g.ky || 0, dz: 0, p: [g.x, g.y, g.z], zurueck: g };
    this.app.weltSetzenStatus?.(this); this.zeichne();
  }
  /** Tasten für die gewählte gesetzte Blaupause: Pfeile/Bild/R wie beim Ändern, Entf löscht, Esc hebt auf */
  gTaste(e) {
    const g = this.gesetzt[this.gSel]; if (!g) return false; const k = e.key;
    if (k === 'Escape') { this.gAufheben(); return true; }
    if (k === 'Delete') { this.entferne(this.gSel); this.app.weltGMenue?.(this, null); return true; }
    const f = this.richtung(), ach = Math.abs(f[0]) >= Math.abs(f[1]) ? [Math.sign(f[0]), 0] : [0, Math.sign(f[1])], re = [-ach[1], ach[0]], st = e.shiftKey ? 800 : (this.raster || 100);
    if (k === 'ArrowUp') { g.x += ach[0] * st; g.y += ach[1] * st; } else if (k === 'ArrowDown') { g.x -= ach[0] * st; g.y -= ach[1] * st; }
    else if (k === 'ArrowRight') { g.x += re[0] * st; g.y += re[1] * st; } else if (k === 'ArrowLeft') { g.x -= re[0] * st; g.y -= re[1] * st; }
    else if (k === 'PageUp') g.z += e.shiftKey ? 400 : 100; else if (k === 'PageDown') g.z -= e.shiftKey ? 400 : 100;
    else if (k === 'r' || k === 'R') g.dreh = (g.dreh + (e.shiftKey ? 15 : 90)) % 360;
    else return false;
    this.gesetztNeu(); this.app.weltGMenue?.(this, this.gSel); return true;
  }
  gesetztNeu() {
    if (this.gSel != null && !this.gesetzt[this.gSel]) this.gSel = null;
    const q = (g, i) => ({ meta: g.daten.meta, w: g.daten.w, dreh: g.dreh, kipp: [g.kx || 0, g.ky || 0], off: [g.x, g.y, g.z], id: 15000000 + i });
    this.fuelleSatz('gesetzt', this.gesetzt.map(q).filter((_, i) => i !== this.gSel));
    this.fuelleSatz('gwahl', this.gSel != null ? [q(this.gesetzt[this.gSel], this.gSel)] : []);
    this.app.weltSetzenStatus?.(this);
  }
  /** Mausstrahl → Punkt auf dem Gelände (aus den geladenen Kacheln) */
  treffer(cx, cy) {
    const p = this.pickTreffer(cx, cy); if (p) return p;
    const rc = this.cv.getBoundingClientRect(), w = rc.width, h = rc.height, f = this.richtung(), r = this.rechts();
    const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
    const focal = (h / 2) / Math.tan((this.fov / 2) * Math.PI / 180), nx = (cx - rc.left - w / 2) / focal, ny = -(cy - rc.top - h / 2) / focal;
    const d = [0, 1, 2].map((i) => f[i] + r[i] * nx + u[i] * ny), l = Math.hypot(...d); d.forEach((_, i) => { d[i] /= l; });
    const e = this.eye; let t = 0, schritt = 200, vorher = 0;
    for (let n = 0; n < 4000 && t < 2e6; n++) {
      const p = [e[0] + d[0] * t, e[1] + d[1] * t, e[2] + d[2] * t], hb = this.hoeheBei(p[0], p[1]);
      if (hb != null && p[2] <= hb) {
        let a = vorher, b = t; for (let k = 0; k < 20; k++) { const m = (a + b) / 2, q = [e[0] + d[0] * m, e[1] + d[1] * m]; const hm = this.hoeheBei(q[0], q[1]); if (hm != null && e[2] + d[2] * m <= hm) b = m; else a = m; }
        const x = e[0] + d[0] * b, y = e[1] + d[1] * b; return [x, y, this.hoeheBei(x, y) ?? e[2] + d[2] * b];
      }
      vorher = t; t += schritt; schritt = Math.max(100, t * 0.004);
    }
    return null;
  }
  /** exakt = Klick: sofort messen; sonst (Mausbewegung) ohne Warten, höchstens eine Abfrage gleichzeitig */
  setzenFolgen(cx, cy, exakt = false) {
    const S = this.setzen; if (!S) return;
    const setze = (p) => { if (!p || this.setzen !== S) return; S.p = [Math.round(p[0] / 100) * 100, Math.round(p[1] / 100) * 100, Math.round(p[2])]; this.zeichne(); }; // 1-m-Raster
    if (exakt) { setze(this.treffer(cx, cy)); this.app.weltSetzenStatus?.(this); return; }
    this.mausZiel = [cx, cy]; if (this.pickLaeuft) return;
    const los = () => {
      const [x, y] = this.mausZiel; this.mausZiel = null; this.pickLaeuft = true;
      const ok = this.pickTreffer(x, y, (p) => { this.pickLaeuft = false; setze(p ?? this.treffer(x, y)); if (this.mausZiel) los(); });
      if (!ok) { this.pickLaeuft = false; setze(this.treffer(x, y)); }
    };
    los();
  }
  geistMatrix() {
    const S = this.setzen, [x, y, z, w] = drehQ(S.dreh, S.kx || 0, S.ky || 0);
    return new Float32Array([1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0, 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, S.p[0], S.p[1], S.p[2] + S.dz, 1]);
  }

  /** Spielmodelle (modelle/index.json  /** Spielmodelle (modelle/index.json + meshes.bin, wie view3dgl.js) in diesen Kontext laden */
  async ladeModelle() {
    if (this.modelleLaden) return this.modelleLaden;
    this.modelleLaden = (async () => {
      try {
        const index = await (await fetch('modelle/index.json', { cache: 'no-cache' })).json(), buf = await (await fetch('modelle/meshes.bin')).arrayBuffer(), gl = this.gl;
        const pad = (n) => (n + 3) & ~3; let iBytes = 0;
        // je Modell zusätzlich eine grobe Dreiecksliste für mittlere Entfernung (Vertex-Clustering: Eckpunkte auf einem
        // 8er-Raster der Modellgrenzen zusammenfassen, zerfallene Dreiecke weg) – gleiche Eckpunkte, nur weniger Dreiecke
        const grob = new Map();
        for (const [k, m] of Object.entries(index.meshes)) {
          const pos = new Int16Array(buf, m.o, m.nv * 3), src = m.o + pad(m.nv * 6) + m.nv * 4;
          const idx = m.u32 ? new Uint32Array(buf.slice(src, src + m.ni * 4)) : new Uint16Array(buf.slice(src, src + m.ni * 2));
          const G = 8, zelle = (v) => Math.min(G - 1, Math.floor((v + 32768) / 65536 * G)), rep = new Map(), ab = new (m.u32 ? Uint32Array : Uint16Array)(m.nv);
          for (let v = 0; v < m.nv; v++) { const c = (zelle(pos[v * 3]) * G + zelle(pos[v * 3 + 1])) * G + zelle(pos[v * 3 + 2]); let r = rep.get(c); if (r === undefined) rep.set(c, r = v); ab[v] = r; }
          const neu = []; for (let t = 0; t < m.ni; t += 3) { const a = ab[idx[t]], b = ab[idx[t + 1]], c = ab[idx[t + 2]]; if (a !== b && b !== c && a !== c) neu.push(a, b, c); }
          if (neu.length < m.ni * 0.7) { grob.set(k, m.u32 ? Uint32Array.from(neu) : Uint16Array.from(neu)); iBytes = pad(iBytes + neu.length * (m.u32 ? 4 : 2)); }
          iBytes = pad(iBytes + m.ni * (m.u32 ? 4 : 2));
        }
        const ib = new Uint8Array(iBytes); let io = 0;
        for (const [k, m] of Object.entries(index.meshes)) {
          m.oPos = m.o; m.oNrm = m.o + pad(m.nv * 6); const src = m.oNrm + m.nv * 4, len = m.ni * (m.u32 ? 4 : 2); ib.set(new Uint8Array(buf, src, len), io); m.oIdx = io; io = pad(io + len);
          const g = grob.get(k); if (g) { ib.set(new Uint8Array(g.buffer), io); m.oIdxGrob = io; m.niGrob = g.length; io = pad(io + g.byteLength); }
        }
        this.meshVbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.meshVbo); gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
        this.meshIbo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshIbo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ib, gl.STATIC_DRAW);
        this.modelle = index;
      } catch { this.modelle = null; } // ohne Modelle: Kästen
    })();
    return this.modelleLaden;
  }

  // ------------------------------------------------------------ Felsen (Stufe 2)
  /** Fels-Modelle + Platzierungen laden (werkzeuge/gelaende --felsen-modelle → userdata/welt/felsen) */
  async ladeFelsen() {
    if (this.felsenLaden) return this.felsenLaden;
    this.felsenLaden = (async () => {
      try {
        const [index, buf, pb] = await Promise.all([fetch('/api/welt/felsen/index.json').then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
          fetch('/api/welt/felsen/meshes.bin').then((r) => r.arrayBuffer()), fetch('/api/welt/felsen/platzierungen.bin').then((r) => r.arrayBuffer())]);
        const gl = this.gl, pad = (n) => (n + 3) & ~3; let iBytes = 0;
        for (const m of Object.values(index.meshes)) iBytes = pad(iBytes + m.ni * (m.u32 ? 4 : 2));
        const ib = new Uint8Array(iBytes); let io = 0;
        for (const m of Object.values(index.meshes)) { m.oPos = m.o; m.oNrm = m.o + pad(m.nv * 6); const len = m.ni * (m.u32 ? 4 : 2); ib.set(new Uint8Array(buf, m.oNrm + m.nv * 4, len), io); m.oIdx = io; io = pad(io + len); }
        this.felsVbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.felsVbo); gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
        this.felsIbo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.felsIbo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ib, gl.STATIC_DRAW);
        // Platzierungen: 13 float (3 Achsen, Ursprung, Modell); Weltradius = Modellradius × größte Achse; in 500-m-Zellen einsortieren
        const p = new Float32Array(pb), n = p.length / 13, rad = new Float32Array(n), zellen = new Map(), Z = 50000;
        for (let i = 0; i < n; i++) {
          const o = i * 13, s = Math.max(Math.hypot(p[o], p[o + 1], p[o + 2]), Math.hypot(p[o + 3], p[o + 4], p[o + 5]), Math.hypot(p[o + 6], p[o + 7], p[o + 8]));
          rad[i] = (index.modelle[p[o + 12]]?.radius || 500) * s;
          const k = Math.floor(p[o + 9] / Z) * 100000 + Math.floor(p[o + 10] / Z); let a = zellen.get(k); if (!a) zellen.set(k, a = []); a.push(i);
        }
        this.felsen = { index, p, rad, zellen, Z, n }; this.felsStand = null;
      } catch { this.felsen = null; } // ohne Fels-Daten: nur Gelände
      this.zeichne();
    })();
    return this.felsenLaden;
  }
  /** Sichtbare Felsen je Modell/Detailstufe neu sammeln, wenn sich die Kamera merklich bewegt hat */
  felsInstanzen() {
    const F = this.felsen; if (!F) return;
    const e = this.eye; if (this.felsStand && Math.hypot(e[0] - this.felsStand[0], e[1] - this.felsStand[1], e[2] - this.felsStand[2]) < 5000) return;
    this.felsStand = [...e];
    const { p, rad, zellen, Z, index } = F, weit = 900000, gruppen = new Map();
    const zx0 = Math.floor((e[0] - weit) / Z), zx1 = Math.floor((e[0] + weit) / Z), zy0 = Math.floor((e[1] - weit) / Z), zy1 = Math.floor((e[1] + weit) / Z);
    let sichtbar = 0;
    for (let zx = zx0; zx <= zx1; zx++) for (let zy = zy0; zy <= zy1; zy++) {
      const a = zellen.get(zx * 100000 + zy); if (!a) continue;
      for (const i of a) {
        const o = i * 13, r = rad[i], d = Math.max(0, Math.hypot(p[o + 9] - e[0], p[o + 10] - e[1], p[o + 11] - e[2]) - r);
        if (d > Math.min(weit, Math.max(80000, r * 150))) continue; // kleine Findlinge nur in der Nähe, Klippen bis 9 km
        const mo = index.modelle[p[o + 12]]; if (!mo?.nah) continue;
        const key = d < Math.max(40000, r * 25) ? mo.nah : mo.fern;
        let g = gruppen.get(key); if (!g) gruppen.set(key, g = []);
        g.push(p[o], p[o + 1], p[o + 2], 0, p[o + 3], p[o + 4], p[o + 5], 0, p[o + 6], p[o + 7], p[o + 8], 0, p[o + 9], p[o + 10], p[o + 11], 1);
        sichtbar++;
      }
    }
    let total = 0; for (const g of gruppen.values()) total += g.length;
    const data = new Float32Array(total), ranges = []; let off = 0;
    for (const [key, g] of gruppen) { data.set(g, off); ranges.push({ key, first: off / 16, count: g.length / 16 }); off += g.length; }
    const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.felsInstVbo); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    this.felsRanges = ranges; this.felsSichtbar = sichtbar;
  }
  zeichneFelsen(VP) {
    this.felsInstanzen(); if (!this.felsRanges?.length) return;
    const gl = this.gl, P = this.pF, M = this.felsen.index.meshes; gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uVP, false, VP); gl.uniform3fv(P.u.uEye, this.eye); gl.uniform4f(P.u.uWelt, ...WELT); gl.uniform1f(P.u.uBild, this.bildAn && this.bild ? 1 : 0); gl.uniform1f(P.u.uPick, this.pick ? 1 : 0);
    ['uK0', 'uK1', 'uK2', 'uK3'].forEach((n, i) => { gl.activeTexture(gl.TEXTURE1 + i); gl.bindTexture(gl.TEXTURE_2D, this.bild?.[i] || null); gl.uniform1i(P.u[n], 1 + i); });
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(this.vao);
    for (const rg of this.felsRanges) {
      const m = M[rg.key]; if (!m) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.felsVbo); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.SHORT, true, 6, m.oPos); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.BYTE, true, 4, m.oNrm);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.felsIbo); gl.uniform3fv(P.u.uQMin, m.min); gl.uniform3f(P.u.uQSpan, m.max[0] - m.min[0], m.max[1] - m.min[1], m.max[2] - m.min[2]);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.felsInstVbo);
      for (let k = 0; k < 4; k++) { gl.enableVertexAttribArray(2 + k); gl.vertexAttribPointer(2 + k, 4, gl.FLOAT, false, 64, rg.first * 64 + k * 16); gl.vertexAttribDivisor(2 + k, 1); }
      gl.disableVertexAttribArray(6);
      gl.drawElementsInstanced(gl.TRIANGLES, m.ni, m.u32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, m.oIdx, rg.count);
      for (let k = 0; k < 4; k++) gl.vertexAttribDivisor(2 + k, 0);
    }
    gl.bindVertexArray(null);
  }

  // ------------------------------------------------------------ Kamera und Zeichnen
  rechts() { const f = this.richtung(); const r = [-f[1], f[0], 0], l = Math.hypot(r[0], r[1]) || 1; return [r[0] / l, r[1] / l, 0]; }
  richtung() { const y = this.yaw * Math.PI / 180, p = this.pitch * Math.PI / 180; return [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), Math.sin(p)]; }
  viewProj(near, far) {
    const f = this.richtung(), e = this.eye, r = this.rechts();
    const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]]; // wie view3dgl.js
    const w = this.cv.clientWidth, h = this.cv.clientHeight, focal = (h / 2) / Math.tan((this.fov / 2) * Math.PI / 180), sx = focal / (w / 2), sy = focal / (h / 2);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], A = (far + near) / (far - near), B = -2 * far * near / (far - near);
    const r0 = [sx * r[0], sx * r[1], sx * r[2], -sx * dot(r, e)], r1 = [sy * u[0], sy * u[1], sy * u[2], -sy * dot(u, e)], r3 = [f[0], f[1], f[2], -dot(f, e)], r2 = r3.map((x, i) => A * x + (i === 3 ? B : 0));
    const m = new Float32Array(16); for (let c = 0; c < 4; c++) { m[c * 4] = r0[c]; m[c * 4 + 1] = r1[c]; m[c * 4 + 2] = r2[c]; m[c * 4 + 3] = r3[c]; } return m;
  }
  /** Geländehöhe unter der Kamera (aus geladenen Kacheln, grob) für Mindesthöhe und Tempo */
  boden() { return this.hoeheBei(this.eye[0], this.eye[1]) ?? 0; }
  /** Geländehöhe (cm) an einer Stelle aus der feinsten geladenen Kachel, null = keine Daten */
  hoeheBei(px, py) {
    const k = this.info?.gelaende; if (!k) return null;
    for (let lod = 0; lod <= this.maxLod; lod++) {
      const s = (1 << lod) * 100, gr = this.N * s, x = Math.floor((px - k.x0) / gr), y = Math.floor((py - k.y0) / gr), t = this.kacheln.get(`${lod}/${x}/${y}`);
      if (t?.daten) { const i = Math.round((px - k.x0 - x * gr) / s), j = Math.round((py - k.y0 - y * gr) / s), v = t.daten[j * (this.N + 1) + i]; return v === LEER ? null : v * 10; }
    }
    return null;
  }
  zeichne() { if (!this.raf) this.raf = requestAnimationFrame((t) => { this.raf = 0; this.bild_(t); }); }
  bild_(t) {
    const gl = this.gl, cv = this.cv, dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h || !this.info) return;
    // Bewegung (WASD/QE), Tempo wächst mit der Höhe
    const dt = this.letzt ? Math.min(0.1, (t - this.letzt) / 1000) : 0; this.letzt = this.tasten.size ? t : 0;
    const ego = this.ego?.an && !this.ego.wartet; // vor dem Startpunkt-Klick normal fliegen
    if (this.tasten.size && dt && ego) {
      const f = this.richtung(), rr = this.rechts(), fl = Math.hypot(f[0], f[1]) || 1, v = (this.tasten.has('Shift') ? 2500 : 700) * dt, k = (c) => this.tasten.has(c);
      if (k('w')) { this.eye[0] += f[0] / fl * v; this.eye[1] += f[1] / fl * v; }
      if (k('s')) { this.eye[0] -= f[0] / fl * v; this.eye[1] -= f[1] / fl * v; }
      if (k('a')) { this.eye[0] -= rr[0] * v; this.eye[1] -= rr[1] * v; }
      if (k('d')) { this.eye[0] += rr[0] * v; this.eye[1] += rr[1] * v; }
      if (k('e') || k(' ')) this.ego.hoehe += 600 * dt; if (k('q') || k('c')) this.ego.hoehe = Math.max(100, this.ego.hoehe - 600 * dt);
    }
    if (ego) this.eye[2] = (this.ego.boden ?? this.boden()) + this.ego.hoehe;
    else if (this.tasten.size && dt) {
      const f = this.richtung(), rr = this.rechts();
      const hoehe = Math.max(2000, this.eye[2] - this.boden()), v = hoehe * 1.2 * (this.tasten.has('Shift') ? 5 : 1) * dt;
      const k = (c) => this.tasten.has(c);
      if (k('w')) { this.eye[0] += f[0] * v; this.eye[1] += f[1] * v; this.eye[2] += f[2] * v; }
      if (k('s')) { this.eye[0] -= f[0] * v; this.eye[1] -= f[1] * v; this.eye[2] -= f[2] * v; }
      if (k('a')) { this.eye[0] -= rr[0] * v; this.eye[1] -= rr[1] * v; }
      if (k('d')) { this.eye[0] += rr[0] * v; this.eye[1] += rr[1] * v; }
      if (k('e') || k(' ')) this.eye[2] += v; if (k('q') || k('c')) this.eye[2] -= v; // steigen: Leertaste/E, sinken: C/Q
      this.eye[2] = Math.max(this.boden() + 200, this.eye[2]);
    }
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const VP = this.aktuelleVP();
    gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0.62, 0.70, 0.78, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.szene(VP);
    this.punkteZeichnen(VP);
    this.app.weltStatus?.(this);
    if (this.tasten.size || this.laden.size) this.zeichne();
  }
  aktuelleVP() { const hoehe = Math.max(200, this.eye[2] - this.boden()); return this.viewProj(Math.max(20, hoehe * 0.02), 2.5e6); }
  /** Gelände, Felsen, Bauteile; im Treffer-Durchgang (this.pick) ohne Vorschau und Linien */
  szene(VP) {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    // Gelände
    const P = this.pT; gl.useProgram(P.p); gl.uniformMatrix4fv(P.u.uVP, false, VP); gl.uniform3fv(P.u.uEye, this.eye); gl.uniform1i(P.u.uN, this.N);
    gl.uniform4f(P.u.uWelt, ...WELT); gl.uniform1f(P.u.uBild, this.bildAn && this.bild ? 1 : 0); gl.uniform1f(P.u.uPick, this.pick ? 1 : 0);
    ['uK0', 'uK1', 'uK2', 'uK3'].forEach((n, i) => { gl.activeTexture(gl.TEXTURE1 + i); gl.bindTexture(gl.TEXTURE_2D, this.bild?.[i] || null); gl.uniform1i(P.u[n], 1 + i); });
    gl.uniform1i(P.u.uH, 0); gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(this.gVao);
    const sicht = this.sichtbareKacheln(); this.zahlKacheln = sicht.length;
    for (const k of sicht) { gl.bindTexture(gl.TEXTURE_2D, k.t.tex); gl.uniform2f(P.u.uOrigin, k.x0, k.y0); gl.uniform1f(P.u.uStep, k.s); gl.drawElements(gl.TRIANGLES, this.gN, gl.UNSIGNED_INT, 0); }
    gl.bindVertexArray(null);
    this.zeichneFelsen(VP);
    // Bauteile: Spielstand, gesetzte Blaupausen (grünlich), Vorschau an der Maus (blau)
    this.zeichneSatz(VP, this.saetze.spielstand);
    this.zeichneSatz(VP, this.saetze.gesetzt, EINS, [0.3, 0.85, 0.45, 0.25]);
    this.zeichneSatz(VP, this.saetze.gwahl, EINS, [1, 0.78, 0.15, 0.5]);
    this.zeichneSatz(VP, this.saetze.auswahl, this.auswahlMatrix(), [1, 0.78, 0.15, 0.5]);
    if (this.setzen?.p && !this.pick) this.zeichneSatz(VP, this.saetze.geist, this.geistMatrix(), [0.25, 0.6, 1, 0.55]);
  }
  /** Weltposition der sichtbaren Oberfläche unter der Maus: Szene nur für dieses eine Pixel in ein Float-Bild zeichnen */
  pickTreffer(cx, cy, asyncFertig = null) {
    const gl = this.gl, cv = this.cv, W = cv.width, H = cv.height; if (!W || !H || !this.info) return null;
    if (this.pickOk === undefined) this.pickOk = !!gl.getExtension('EXT_color_buffer_float');
    if (!this.pickOk) return null;
    if (!this.pickFbo) { this.pickFbo = gl.createFramebuffer(); this.pickTex = gl.createTexture(); this.pickRb = gl.createRenderbuffer(); this.pickGr = [0, 0]; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFbo);
    if (this.pickGr[0] !== W || this.pickGr[1] !== H) {
      gl.bindTexture(gl.TEXTURE_2D, this.pickTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pickTex, 0);
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.pickRb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.pickRb);
      this.pickGr = [W, H];
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { this.pickOk = false; gl.bindFramebuffer(gl.FRAMEBUFFER, null); return null; }
    }
    const rc = cv.getBoundingClientRect(), x = Math.floor((cx - rc.left) * W / rc.width), y = H - 1 - Math.floor((cy - rc.top) * H / rc.height);
    const a = new Float32Array(4);
    try {
      gl.viewport(0, 0, W, H); gl.enable(gl.SCISSOR_TEST); gl.scissor(x, y, 1, 1); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.pick = true; this.szene(this.aktuelleVP());
      if (!asyncFertig) gl.readPixels(x, y, 1, 1, gl.RGBA, gl.FLOAT, a);
      else { // ohne Warten: Pixel in einen Puffer, abholen, sobald die Grafikkarte fertig ist
        if (!this.pickPbo) { this.pickPbo = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pickPbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, 16, gl.STREAM_READ); }
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pickPbo); gl.readPixels(x, y, 1, 1, gl.RGBA, gl.FLOAT, 0); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
        const warte = () => {
          const st = gl.clientWaitSync(sync, 0, 0);
          if (st === gl.TIMEOUT_EXPIRED) { setTimeout(warte, 4); return; }
          gl.deleteSync(sync); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pickPbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, a); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
          asyncFertig(a[3] > 0.5 ? [a[0], a[1], a[2]] : null);
        };
        setTimeout(warte, 4);
      }
    } finally { this.pick = false; gl.disable(gl.SCISSOR_TEST); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
    return asyncFertig ? true : a[3] > 0.5 ? [a[0], a[1], a[2], a[3]] : null; // a[3] ≥ 2: Bauteil Nr. a[3] − 2 des Spielstands
  }

  // ------------------------------------------------------------ Bedienung
  bind() {
    const cv = this.cv; let drag = null;
    cv.tabIndex = 0;
    let start = null;
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId); cv.focus();
      if (this.stift && e.button === 0 && !this.setzen && this.objekte) { const r = cv.getBoundingClientRect(); this.lasso = [[e.clientX - r.left, e.clientY - r.top]]; this.lassoZeichnen(); return; }
      drag = { x: e.clientX, y: e.clientY }; start = { x: e.clientX, y: e.clientY, b: e.button };
    });
    cv.addEventListener('pointermove', (e) => {
      if (this.lasso) { const r = cv.getBoundingClientRect(), p = [e.clientX - r.left, e.clientY - r.top], q = this.lasso.at(-1); if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 3) { this.lasso.push(p); this.lassoZeichnen(); } return; }
      if (!drag) { if (this.setzen) this.setzenFolgen(e.clientX, e.clientY); else this.punktTipp(e); return; } const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
      // Maus nach rechts = nach rechts schauen (wie im Spiel); Option „umkehren“ dreht es um
      this.yaw += dx * 0.2 * (this.mausUmkehren ? -1 : 1); this.pitch = Math.max(-89, Math.min(89, this.pitch - dy * 0.2)); this.zeichne();
    });
    cv.addEventListener('pointerup', (e) => {
      if (this.lasso) { this.lassoFertig(e.shiftKey, e.ctrlKey || e.altKey); return; }
      drag = null;
      const klick = start && start.b === 0 && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5;
      const rechts = start && start.b === 2 && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5;
      if (rechts) { if (this.setzen) this.setzenBeenden(); else { this.gAufheben(); this.auswahlAufheben(); } } // Rechtsklick ohne Ziehen = fertig (wie im Spiel)
      else if (klick && this.ego?.an && this.ego.wartet) { this.egoStart(e.clientX, e.clientY); }
      else if (klick && this.setzen) { this.setzenFolgen(e.clientX, e.clientY, true); this.legeAb(); }
      else if (klick) {
        const t = this.pickTreffer(e.clientX, e.clientY), n = t ? Math.round(t[3]) : 0;
        if (n >= 15000000) this.gWaehle(n - 15000000, e.clientX, e.clientY);
        else { this.gAufheben(); if (this.objekte) { if (n >= 2) { this.waehle(n - 2, e.ctrlKey || e.shiftKey); this.maschineZeigen(this.auswahl.size === 1 ? n - 2 : -1, e.clientX, e.clientY); } else { this.auswahlAufheben(); this.maschineZeigen(-1); } } }
      }
      start = null;
    });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); const f = this.richtung(), hoehe = Math.max(2000, this.eye[2] - this.boden()), v = -Math.sign(e.deltaY) * hoehe * 0.25;
      this.eye = this.eye.map((x, i) => x + f[i] * v); this.eye[2] = Math.max(this.boden() + 200, this.eye[2]); this.zeichne(); }, { passive: false });
    const taste = (e) => (e.key === 'Shift' ? 'Shift' : e.key.toLowerCase());
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    // beim Setzen: Fokus in die Ansicht, sobald die Maus darüber ist (dann gehen auch W A S D ohne Klick)
    cv.addEventListener('pointerenter', () => { if (this.setzen && !document.activeElement?.closest?.('input, textarea, select')) cv.focus({ preventScroll: true }); });
    // Setzen-/Auswahl-Tasten gelten in der ganzen Welt-Ansicht – nicht nur, wenn die 3D-Fläche den Fokus hat
    document.addEventListener('keydown', (e) => {
      if (!cv.isConnected || !cv.clientWidth || document.querySelector('dialog[open]') || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      if (!this.setzen && this.gSel != null && this.gTaste(e)) { e.preventDefault(); return; }
      if (!this.setzen && this.auswahlTaste(e)) { e.preventDefault(); return; }
      const S = this.setzen, k0 = e.key.toLowerCase();
      if (this.ego?.an && k0 === 'escape') { e.preventDefault(); this.egoSetzen(false); this.app.weltEgoStatus?.(this); return; }
      if (S && (k0 === 'r' || k0 === 'pageup' || k0 === 'pagedown' || k0 === 'escape')) {
        e.preventDefault();
        if (k0 === 'r') S.dreh = (S.dreh + (e.shiftKey ? 15 : 90)) % 360;
        else if (k0 === 'escape') { this.setzenBeenden(); return; }
        else S.dz += (k0 === 'pageup' ? 1 : -1) * (e.shiftKey ? 400 : 100);
        this.app.weltSetzenStatus?.(this); this.zeichne(); return;
      }
    });
    const frei = (e) => cv.isConnected && cv.clientWidth && !document.querySelector('dialog[open]') && !e.target.closest?.('input, textarea, select, [contenteditable]');
    document.addEventListener('keydown', (e) => { const k = taste(e); if (e.ctrlKey || e.metaKey || e.altKey || !['w', 'a', 's', 'd', 'q', 'e', ' ', 'c', 'Shift'].includes(k) || !frei(e)) return; e.preventDefault(); if (!this.tasten.has(k)) { this.tasten.add(k); this.zeichne(); } });
    document.addEventListener('keyup', (e) => { this.tasten.delete(taste(e)); });
    window.addEventListener('blur', () => this.tasten.clear());
    new ResizeObserver(() => this.zeichne()).observe(cv);
  }
}
