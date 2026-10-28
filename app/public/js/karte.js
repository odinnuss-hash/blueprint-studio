// Kartenansicht: Spielstand (.sav) als Draufsicht – WebGL2, Hunderttausende Teile flüssig.
import { colorFor } from './scene.js';
import { teilLabel } from './generator.js';
import { zeichnePunkte, filterLaden, filterMenue, zahlenJeGruppe, punktText } from './kartenpunkte.js';
import { ungespeichert, auswahl, eingabe, frage } from './dialog.js';
import { t } from './i18n.js';

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
      this.liste = [...j.spielstaende, ...(j.megaprints || [])]; this.kartenbild = j.kartenbild;
      $('k-bild').disabled = !j.kartenbild; $('k-bild').parentElement.title = j.kartenbild ? 'Spielwelt als Hintergrund' : 'Kein Kartenbild vorhanden – siehe Hilfe → Karte';
      this.zeichne();
      $('k-ordner').textContent = j.ordner;
      this.renderListe();
    } catch (e) { $('k-liste').innerHTML = `<div class="err pad">${esc(e.message)}</div>`; }
  }
  renderListe() {
    const f = ($('k-filter').value || '').toLowerCase();
    const L = this.liste.filter((s) => !f || s.name.toLowerCase().includes(f) || s.sitzung.toLowerCase().includes(f));
    const zeile = (s) => `<div class="k-zeile"><button type="button" class="item${s.id === this.id ? ' on' : ''}" data-id="${esc(s.id)}">
      <span class="n">${esc(s.name)}</span><span class="m">${new Date(s.geaendert).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} · ${(s.groesse / 1e6).toFixed(1)} MB${s.version && s.version < 46 ? ' · alt' : ''}</span></button>
      <button type="button" class="k-weg" data-weg="${esc(s.id)}" title="Spielstand „${esc(s.name)}“ löschen (Papierkorb)" aria-label="Spielstand löschen">🗑</button></div>`;
    const sv = L.filter((s) => s.art !== 'megaprint');
    // nach Karte (Sitzung) gruppiert, auf-/zuklappbar; innerhalb der Gruppe neueste zuerst
    const gruppen = new Map();
    for (const s of sv) { const g = s.sitzung || '(ohne Namen)'; if (!gruppen.has(g)) gruppen.set(g, []); gruppen.get(g).push(s); }
    let offen = {}; try { offen = JSON.parse(localStorage.getItem('bs-karte-gruppen') || '{}'); } catch { /* egal */ }
    const aktiv = sv.find((s) => s.id === this.id)?.sitzung;
    $('k-liste').innerHTML = [...gruppen.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de', { numeric: true })).map(([g, l]) => {
      const auf = f || offen[g] === true || g === aktiv;
      return `<details class="k-gruppe" data-g="${esc(g)}"${auf ? ' open' : ''}><summary><span class="n">${esc(g)}</span><span class="m">${l.length}</span>
        <button type="button" class="k-weg" data-weg-gruppe="${esc(g)}" title="Alle ${l.length} Spielstände der Karte „${esc(g)}“ löschen (Papierkorb)" aria-label="Ganze Karte löschen">🗑</button></summary>${l.map(zeile).join('')}</details>`;
    }).join('') || '<div class="muted pad">Keine Spielstände gefunden.</div>'; // Megaprints: Werkzeug „Megaprints“
    $('k-liste').querySelectorAll('details.k-gruppe').forEach((d) => d.addEventListener('toggle', () => {
      if (f) return; offen[d.dataset.g] = d.open; try { localStorage.setItem('bs-karte-gruppen', JSON.stringify(offen)); } catch { /* egal */ }
    }));
    $('k-liste').querySelectorAll('[data-weg]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); this.loeschen(sv.filter((s) => s.id === b.dataset.weg)); }));
    $('k-liste').querySelectorAll('[data-weg-gruppe]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.loeschen(gruppen.get(b.dataset.wegGruppe) || [], b.dataset.wegGruppe); }));
  }
  /** Spielstände löschen = in den Windows-Papierkorb (wiederherstellbar) */
  async loeschen(liste, karte = null) {
    if (!liste.length) return;
    const text = karte ? `${t(`Alle ${liste.length} Spielstände der Karte „${karte}“ kommen in den Papierkorb (dort wiederherstellbar):`)}\n${liste.slice(0, 12).map((s) => '• ' + s.name).join('\n')}${liste.length > 12 ? '\n…' : ''}`
      : `„${liste[0].name}“ (${liste[0].sitzung}) kommt in den Papierkorb – dort wiederherstellbar.`;
    if (!(await frage({ art: 'warnung', titel: karte ? 'Ganze Karte löschen?' : 'Spielstand löschen?', text, ok: 'In den Papierkorb' }))) return;
    try {
      const r = await fetch('/api/karte/loeschen', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' }, body: JSON.stringify({ ids: liste.map((s) => s.id) }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status);
      this.app.toast([`${j.geloescht} Spielstand/Spielstände in den Papierkorb gelegt.`, ...(j.fehler?.length ? [`Nicht möglich: ${j.fehler.join('; ')}`] : [])].join(' · '), j.fehler?.length ? 'err' : 'ok');
      if (liste.some((s) => s.id === this.id)) this.id = null;
      await this.ladeListe();
    } catch (e) { this.app.toast(e.message, 'err'); }
  }

  // ------------------------------------------------------------ Laden
  async lade(id) {
    this.id = id; this.renderListe(); if (this.ueber) this.ueberWeg();
    if (this.punkte) { this.punkte = null; if (this.punkteAn) this.punkteHolen(); }
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
    this.ebenenKnopf();
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
    // Überlagerung (Megaprint über dem Spielstand): eigener Satz mit gleichem Aufbau
    this.vaoBoxU = gl.createVertexArray(); gl.bindVertexArray(this.vaoBoxU);
    gl.bindBuffer(gl.ARRAY_BUFFER, q); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.bInstU = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.bInstU);
    for (let a = 1; a <= 3; a++) { gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 4, gl.FLOAT, false, 48, (a - 1) * 16); gl.vertexAttribDivisor(a, 1); }
    this.vaoLineU = gl.createVertexArray(); gl.bindVertexArray(this.vaoLineU);
    this.bLineU = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.bLineU);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);
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
      if (this.ueber?.nInst || this.ueber?.nLine) {
        gl.bindVertexArray(this.vaoBoxU); set(this.pBox); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.ueber.nInst);
        gl.bindVertexArray(this.vaoLineU); set(this.pLine); gl.drawArrays(gl.LINES, 0, this.ueber.nLine);
      }
      // Spieler
      this.zeichneMarker(gl);
      this.zeichneBereich(gl);
    }
    gl.bindVertexArray(null);
    this.updateMassstab();
    this.punkteZeichnen();
  }

  // ------------------------------------------------------------ Kartenpunkte (wie in der Welt-Ansicht, hier von oben)
  punkteSetzen(an) { this.punkteAn = an; $('k-punkte').setAttribute('aria-pressed', an); if (an && !this.punkte) this.punkteHolen(); this.zeichne(); }
  async punkteHolen() {
    this.punkteFilter ||= filterLaden();
    const id = this.id && !this.id.startsWith('mp:') ? this.id : null;
    try {
      const r = await fetch('/api/welt/punkte' + (id ? '?id=' + encodeURIComponent(id) : ''), { cache: 'no-store' });
      const j = await r.json(); if (!r.ok) throw new Error(j.fehler || r.status);
      if (id !== (this.id && !this.id.startsWith('mp:') ? this.id : null)) return; // inzwischen anderer Spielstand
      this.punkte = j; this.zeichne();
      const m = $('k-punkte-menue'); if (m && !m.hidden) this.punkteMenue(true);
    } catch (e) { this.app.toast(e.message, 'err'); }
  }
  /** 2D-Ebene über der Karte (Mausereignisse gehen durch) */
  punkteZeichnen() {
    const cv = $('k-canvas'); let c = this.pCv;
    if (!this.punkteAn || !this.punkte) { if (c) c.style.display = 'none'; this.punkteGez = null; return; }
    if (!c) { c = this.pCv = document.createElement('canvas'); c.className = 'w-punkte'; cv.parentElement.insertBefore(c, cv.nextSibling); }
    const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    c.style.display = ''; if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    // Größe folgt dem Zoom: ganze Welt im Bild = kleine Punkte, hineingezoomt bis 12 px
    const s = this.cam.s, cx = this.cam.x, cy = this.cam.y, gr = Math.max(4, Math.min(12, s * 6000));
    const proj = (x, y) => { const sx = (x - cx) * s + w / 2, sy = (y - cy) * s + h / 2; return sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20 ? null : [sx, sy, 0]; };
    this.punkteGez = zeichnePunkte(ctx, this.punkte, proj, this.punkteFilter, gr);
  }
  punktTipp(e) {
    const cv = $('k-canvas'); let t = this.pTipp; const G = this.punkteGez;
    if (!G || !G.length) { if (t) t.hidden = true; return; }
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = null, bd = Infinity; for (const g of G) { const d = Math.hypot(g.sx - mx, g.sy - my); if (d < g.r + 5 && d < bd) { bd = d; best = g; } }
    if (!best) { if (t) t.hidden = true; return; }
    if (!t) { t = this.pTipp = document.createElement('div'); t.className = 'w-punkt-tipp'; cv.parentElement.appendChild(t); }
    t.textContent = punktText(this.punkte, this.punkte.p[best.i], this.app.kat); t.style.left = mx + 14 + 'px'; t.style.top = my + 10 + 'px'; t.hidden = false;
  }
  /** Ebenen-Knopf: Anzahl ausgeblendeter Ebenen */
  ebenenKnopf() { const n = this.aus.size; $('k-eb-text').textContent = n ? `Ebenen (${n} aus)` : 'Ebenen'; $('k-eb-knopf').setAttribute('aria-pressed', n > 0); }
  /** Megaprints: suchen und auf der Karte anzeigen (Liste aus /api/karte/liste) */
  megaprintMenue() {
    let m = $('k-mp-menue');
    if (m && !m.hidden) { m.hidden = true; return; }
    if (!m) {
      m = document.createElement('div'); m.id = 'k-mp-menue'; m.className = 'w-punkte-menue k-mp-menue'; $('k-canvas').parentElement.appendChild(m);
      m.innerHTML = '<input type="search" id="k-mp-suche" placeholder="Megaprint suchen …" aria-label="Megaprint suchen"><label class="check" id="k-mp-ueber-feld"><input type="checkbox" id="k-mp-ueber" checked> Über den geladenen Spielstand legen</label><div id="k-mp-liste" class="k-mp-liste"></div><p class="hint">Klick zeigt den Megaprint an seiner Original-Position. Ordner für Megaprints: Einstellungen → Ordner &amp; Spielstände.</p>';
      $('k-mp-suche').addEventListener('input', () => this.megaprintListe());
      $('k-mp-liste').addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (!b) return; m.hidden = true; if (this.spielstandDa() && $('k-mp-ueber').checked) this.ueberLegen(b.dataset.id); else this.lade(b.dataset.id); });
    }
    $('k-mp-ueber-feld').hidden = !this.spielstandDa();
    m.hidden = false; this.megaprintListe(); $('k-mp-suche').focus();
  }
  spielstandDa() { return !!(this.meta && this.id && !this.id.startsWith('mp:')); }
  /** Karten-Daten (Kopf + Werte) eines Spielstands oder Megaprints holen */
  async holeDaten(id) {
    const r = await fetch('/api/karte/daten?id=' + encodeURIComponent(id), { cache: 'no-store' });
    if (!r.ok) { let m = r.status; try { m = (await r.json()).fehler; } catch { /* */ } throw new Error(m); }
    const buf = await r.arrayBuffer(), dv = new DataView(buf), jl = dv.getUint32(0, true);
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, jl))), off = 4 + jl + ((4 - ((4 + jl) % 4)) % 4);
    return { meta, werte: new Float32Array(buf, off, meta.anzahl * 6) };
  }
  /** Megaprint halbtransparent über den Spielstand legen: Lage wie im Original, Zählung der Bauteile darunter */
  async ueberLegen(id) {
    $('k-loading').hidden = false; $('k-loading-text').textContent = 'Megaprint wird gelesen …';
    try {
      const { meta, werte } = await this.holeDaten(id), kat = this.app.kat?.gebaeude || {}, gl = this.gl;
      const box = meta.klassen.map((c) => { const b = kat[c]?.box; return /^Build_Beam/.test(c) && b ? [0, 0, 400, 50] : b ? [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, b[3] - b[0], b[4] - b[1]] : [0, 0, 200, 200]; });
      const inst = new Float32Array(meta.anzahl * 12), F = [0.2, 0.85, 1, 0.5];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
      for (let i = 0; i < meta.anzahl; i++) {
        const x = werte[i * 6], y = werte[i * 6 + 1], a = werte[i * 6 + 3] * Math.PI / 180, b = box[werte[i * 6 + 4]], o = n * 12;
        if (/^Build_PowerLine/.test(meta.klassen[werte[i * 6 + 4]]) || (Math.abs(x) < 100 && Math.abs(y) < 100)) continue; // Stromleitungen stehen im Megaprint bei 0/0 (Endpunkte fehlen)
        n++;
        inst.set([x, y, Math.cos(a), Math.sin(a), b[0], b[1], b[2], b[3], ...F], o);
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
      }
      const lv = [], L = [0.2, 0.85, 1, 0.8];
      for (const l of meta.linien) for (let j = 1; j + 3 < l.length; j += 2) lv.push(l[j], l[j + 1], ...L, l[j + 2], l[j + 3], ...L);
      for (let j = 0; j + 3 < (meta.leitungen || []).length; j += 4) lv.push(meta.leitungen[j], meta.leitungen[j + 1], ...L, meta.leitungen[j + 2], meta.leitungen[j + 3], ...L);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bInstU); gl.bufferData(gl.ARRAY_BUFFER, inst, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bLineU); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lv), gl.STATIC_DRAW);
      // Bauteile des Spielstands im Bereich des Megaprints (Raster 50 m, dann genau)
      let darunter = 0; const W = this.werte, G = 5000;
      for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G); gx++) for (let gy = Math.floor(y0 / G); gy <= Math.floor(y1 / G); gy++)
        for (const i of this.raster.get(gx * 100000 + gy) || []) { const x = W[i * 6], y = W[i * 6 + 1]; if (x >= x0 && x <= x1 && y >= y0 && y <= y1) darunter++; }
      const name = (this.liste || []).find((x) => x.id === id)?.name || id;
      this.ueber = { id, name, nInst: n, nLine: lv.length / 6, bereich: [x0, y0, x1, y1], darunter };
      $('k-mp-weg').hidden = false; $('k-mp-weg').title = `„${name}“ ausblenden`;
      const w = Math.max(x1 - x0, 2000), h = Math.max(y1 - y0, 2000), cv = $('k-canvas');
      this.cam.x = (x0 + x1) / 2; this.cam.y = (y0 + y1) / 2; this.cam.s = Math.min(cv.clientWidth / w, cv.clientHeight / h) * 0.6;
      this.zeichne();
      this.app.toast(`„${name}“ liegt über dem Spielstand: ${n.toLocaleString('de-DE')} Teile auf ${Math.round(w / 100)} × ${Math.round(h / 100)} m. Im selben Bereich stehen ${darunter.toLocaleString('de-DE')} Bauteile deines Spielstands.`, darunter ? 'err' : 'ok');
    } catch (e) { this.app.toast('Megaprint konnte nicht gelesen werden: ' + e.message, 'err'); }
    finally { $('k-loading').hidden = true; }
  }
  ueberWeg() { this.ueber = null; $('k-mp-weg').hidden = true; this.zeichne(); }
  megaprintListe() {
    const el = $('k-mp-liste'); if (!el) return;
    const f = ($('k-mp-suche').value || '').toLowerCase().trim();
    const alle = (this.liste || []).filter((s) => s.art === 'megaprint');
    const L = alle.filter((s) => !f || (s.name + ' ' + s.sitzung).toLowerCase().includes(f)).sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
    if (!alle.length) { el.innerHTML = '<div class="muted pad">Keine Megaprints gefunden. Ordner in den Einstellungen eintragen.</div>'; return; }
    el.innerHTML = `<div class="muted k-mp-zahl">${L.length} von ${alle.length}</div>` + L.slice(0, 300).map((s) => `<button type="button" class="item${s.id === this.id ? ' on' : ''}" data-id="${esc(s.id)}"><span class="n">${esc(s.name)}</span><span class="m">${esc(s.sitzung)} · ${(s.groesse / 1e6).toFixed(1)} MB</span></button>`).join('') || '<div class="muted pad">Nichts gefunden.</div>';
  }
  /** Auswahl, welche Punkte (Zahlen offen/alle, wenn ein Spielstand geladen ist) */
  async punkteMenue(neu = false) {
    let m = $('k-punkte-menue');
    if (!neu && m && !m.hidden) { m.hidden = true; return; }
    if (!m) { m = document.createElement('div'); m.id = 'k-punkte-menue'; m.className = 'w-punkte-menue'; $('k-canvas').parentElement.appendChild(m); }
    if (!this.punkteAn) this.punkteSetzen(true);
    this.punkteFilter ||= filterLaden();
    filterMenue(m, this.punkteFilter, () => this.zeichne(), this.punkte ? zahlenJeGruppe(this.punkte) : {}, this.punkte, this.app.kat);
    m.hidden = false;
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

  /** Bereich an dieselbe Stelle in einen anderen Spielstand kopieren (Ergebnis als neue Datei neben dem Ziel) */
  async bereichUebertragen() {
    if (!this.bereichZahl) return;
    const ziele = (this.liste || []).filter((s) => !s.id.startsWith('mp:') && s.id !== this.id).sort((a, b) => b.geaendert - a.geaendert);
    if (!ziele.length) { this.app.toast('Kein anderer Spielstand gefunden.', 'err'); return; }
    const w = await auswahl({ titel: 'In welchen Spielstand übertragen?', text: 'Der Bereich kommt an genau dieselbe Stelle. Der gewählte Spielstand bleibt unverändert, das Ergebnis wird eine neue Datei.', ok: 'Weiter',
      optionen: ziele.map((s) => ({ wert: s.id, text: s.name, info: [s.sitzung, new Date(s.geaendert).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })].filter(Boolean).join(' · ') })) });
    if (!w) return;
    const ziel = ziele.find((s) => s.id === w.wert);
    // Vorab prüfen: Kopplungen zu Teilen außerhalb des Bereichs (Drohnen-Partner, Anschlüsse, Kabel, Stationsnamen …)
    {
      const b0 = $('k-bp-uebertragen'); if (b0) { b0.disabled = true; b0.textContent = 'Prüfe Kopplungen …'; }
      let pr = null;
      try {
        const r = await fetch('/api/karte/uebertragen/pruefen', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' }, body: JSON.stringify({ id: this.id, ohne: this.ohneKlassen(), bereich: this.bereichDaten(), ziel: ziel.id }) });
        pr = await r.json(); if (!r.ok) throw new Error(pr.fehler || r.status);
      } catch (e) { this.app.toast('Prüfung nicht möglich: ' + e.message, 'err'); return; }
      finally { const bb = $('k-bp-uebertragen'); if (bb) { bb.disabled = false; bb.textContent = 'In anderen Spielstand übertragen …'; } }
      const kl = pr.kopplungen?.liste || [], nb = Object.entries(pr.kopplungen?.nichtBereinigt || {});
      if (kl.length || nb.length) {
        const zz = (n) => n.toLocaleString(document.documentElement.lang || 'de');
        const liste = kl.map((f) => `${f.anzahl ? zz(f.anzahl) + '× ' : ''}${t(f.art)}${f.umgelenkt ? ' ' + t(`(${zz(f.umgelenkt)}× auf das Gegenstück im Ziel umgelenkt)`) : ''}${f.gleichnamig ? ' – ' + t(`davon ${zz(f.gleichnamig)}× gleichnamig im Ziel`) : ''}${f.hinweis ? ' – ' + t(f.hinweis) : ''}`);
        if (nb.length) liste.push(t(`Nicht bereinigt (gemischte Einträge): ${nb.map(([n, a]) => `${a}× ${n}`).join(', ')}`));
        const ok = await frage({ art: 'warnung', titel: 'Kopplungen nach außen', ok: 'Übertragen und Kopplungen aufheben', abbrechen: 'Abbrechen',
          text: `Einige Teile im Bereich hängen an Objekten, die nicht mit übertragen werden. Im Ziel würden diese Verweise ins Leere (oder auf fremde Objekte) zeigen – das kann das Spiel zum Absturz bringen. Die App hebt diese Kopplungen beim Übertragen auf:`,
          liste, listeUmbruch: true, hinweis: 'Tipp: Gehört das Gegenstück dazu (z. B. die Partner-Drohnenstation), den Bereich größer wählen.' });
        if (!ok) return;
      }
    }
    const art = await auswahl({ titel: 'Was steht im Ziel an dieser Stelle?', ok: 'Weiter', optionen: [
      { wert: 'frei', text: 'Vorher frei räumen', info: 'Entfernt im Ziel alles im selben Bereich (ausgeblendete Ebenen und der Höhenfilter gelten mit), dann wird eingefügt.' },
      { wert: 'dazu', text: 'Nur hinzufügen', info: 'Was im Ziel schon steht, bleibt – Neues kann sich damit überschneiden.' }] });
    if (!art) return;
    const pal = await auswahl({ titel: 'Farben', ok: 'Weiter', optionen: [
      { wert: 'ziel', text: 'Farbpalette des Ziels behalten', info: 'Fundamente und Wände behalten ihre Farbfelder; die Farben kommen aus der Palette des Ziel-Spielstands.' },
      { wert: 'quelle', text: 'Farbpalette der Quelle übernehmen', info: 'Die Farbfelder sehen aus wie im Quell-Spielstand – dafür ändern sich die Farben auch für alles andere im Ziel.' }] });
    if (!pal) return;
    const name = await eingabe({ titel: 'Name des neuen Spielstands', text: `Wird neben „${ziel.name}“ gespeichert.`, wert: (ziel.name + '_Uebertragen').slice(0, 60), ok: 'Übertragen' });
    if (!name) return;
    if (/[\\/:*?"<>|]/.test(name)) { this.app.toast('Bitte einen gültigen Namen angeben (ohne \\ / : * ? " < > |).', 'err'); return; }
    const b = $('k-bp-uebertragen'); if (b) { b.disabled = true; b.textContent = 'Wird übertragen …'; }
    const senden = (ueberschreiben) => fetch('/api/karte/uebertragen', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' },
      body: JSON.stringify({ id: this.id, ohne: this.ohneKlassen(), bereich: this.bereichDaten(), ziel: ziel.id, name, frei: art.wert === 'frei', palette: pal.wert === 'quelle', ueberschreiben }) });
    try {
      let r = await senden(false), j = await r.json();
      if (r.status === 409) {
        if (!(await frage({ art: 'warnung', titel: 'Spielstand überschreiben?', text: `Den Spielstand „${name}“ gibt es schon. Die alte Datei wird vorher gesichert.`, ok: 'Überschreiben' }))) return;
        r = await senden(true); j = await r.json();
      }
      if (!r.ok) throw new Error(j.fehler || r.status);
      const i = j.info, fehlt = Object.entries(i.fehlend || {});
      this.liste = null;
      const teile = [`„${name}“ gespeichert: ${i.eingefuegt.toLocaleString('de-DE')} Objekte übertragen${i.entfernt ? `, ${i.entfernt.toLocaleString('de-DE')} im Ziel entfernt` : ''}.`];
      if (i.palette) teile.push('Farbpalette der Quelle übernommen.');
      if (i.leichtbau) teile.push(`${i.leichtbau.toLocaleString('de-DE')} Leichtbau-Teile mit Originaldaten übernommen.`);
      if (fehlt.length) teile.push(`Ohne Vorlage übersprungen: ${fehlt.map(([c, n]) => n + '× ' + c.replace(/^Build_|_C$/g, '')).join(', ')}.`);
      if (i.sicherung) teile.push(`Alte Datei gesichert: ${i.sicherung}`);
      const kz = (i.kopplungen?.liste || []).reduce((a, f) => a + f.anzahl, 0), ku = (i.kopplungen?.liste || []).reduce((a, f) => a + f.umgelenkt, 0);
      if (kz) teile.push(`${kz.toLocaleString('de-DE')} Kopplungen nach außen aufgehoben.`);
      if (ku) teile.push(`${ku.toLocaleString('de-DE')} Verweise auf das Gegenstück im Ziel umgelenkt.`);
      const np = i.nachpruefung;
      if (np?.tot) teile.push(`Achtung: Nachprüfung fand ${np.tot} Verweise ins Leere (${np.beispiele.join('; ')}) – vor dem Laden im Spiel bitte melden.`);
      else if (np && !np.fehler) teile.push('Nachprüfung: alle Verweise in Ordnung.');
      this.app.toast(teile.join(' · '), fehlt.length || np?.tot ? 'err' : 'ok');
    } catch (e) { this.app.toast(e.message, 'err'); }
    finally { const bb = $('k-bp-uebertragen'); if (bb) { bb.disabled = false; bb.textContent = 'In anderen Spielstand übertragen …'; } }
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
        <div class="nv-btns"><button type="button" class="btn small" id="k-bp-uebertragen" title="Den Bereich an dieselbe Stelle in einen anderen Spielstand kopieren – als neue Datei">In anderen Spielstand übertragen …</button></div>
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
    $('k-bp-uebertragen')?.addEventListener('click', () => this.bereichUebertragen());
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

  /** Spielstand in der eigenen Welt-Ansicht öffnen */
  /** Spielstand auf Fehler prüfen (lib/spielstand-pruefen.mjs) und auf Wunsch eine reparierte Kopie anlegen */
  async spielstandPruefen() {
    if (!this.id || this.id.startsWith('mp:')) { await frage({ art: 'frage', titel: 'Spielstand prüfen', text: 'Bitte links zuerst einen Spielstand laden.', ok: 'OK', abbrechen: 'Schließen' }); return; }
    const s = (this.liste || []).find((x) => x.id === this.id), name0 = s?.name || this.id.split('/').pop().replace(/\.sav$/i, '');
    const b = $('k-pruefen'), alt = b.innerHTML; b.disabled = true; b.textContent = 'Prüfe …';
    // deutlich zeigen, dass gearbeitet wird (große Spielstände brauchen einige Sekunden)
    const laden = (text) => { $('k-loading').hidden = false; $('k-loading-text').textContent = text; };
    laden(`„${name0}“ wird geprüft … (große Spielstände brauchen bis zu einer Minute)`);
    const post = async (url, daten) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BS': '1' }, body: JSON.stringify(daten) }); const j = await r.json(); return { r, j }; };
    try {
      const { r, j } = await post('/api/karte/spielstand-pruefen', { id: this.id });
      if (!r.ok) throw new Error(j.fehler || r.status);
      const zz = (n) => n.toLocaleString(document.documentElement.lang || 'de');
      $('k-loading').hidden = true;
      if (!j.befunde.length) { await frage({ art: 'frage', titel: 'Keine Fehler gefunden', text: `„${name0}“: keine Fehler gefunden (${zz(j.objekte)} Objekte, ${j.stationen} Drohnenstationen, ${j.drohnen} Drohnen geprüft).`, ok: 'OK', abbrechen: 'Schließen' }); return; }
      const liste = j.befunde.map((f) => `${f.kritisch ? '⚠ ' : ''}${zz(f.anzahl)}× ${t(f.art)}${f.hinweis ? ' – ' + t(f.hinweis) : ''}`);
      if (!j.behebbar) { await frage({ art: 'warnung', titel: 'Hinweise zum Spielstand', text: 'Nichts automatisch zu reparieren:', liste, listeUmbruch: true, ok: 'OK', abbrechen: 'Schließen' }); return; }
      const ok = await frage({ art: 'warnung', titel: `${zz(j.behebbar)} Fehler in „${name0}“`, ok: 'Reparierte Kopie anlegen', abbrechen: 'Schließen',
        text: j.kritisch ? `Davon ${zz(j.kritisch)} kritisch (⚠) – die können das Spiel beim Laden abstürzen lassen. Die App kann eine reparierte Kopie anlegen; das Original bleibt unverändert.` : 'Keine kritischen Fehler – die Reparatur räumt verwaiste Verweise auf. Das Original bleibt unverändert.',
        liste, listeUmbruch: true });
      if (!ok) return;
      const name = await eingabe({ titel: 'Name der reparierten Kopie', text: `Wird neben „${name0}“ gespeichert.`, wert: (name0 + '_repariert').slice(0, 60), ok: 'Reparieren' });
      if (!name) return;
      if (/[\\/:*?"<>|]/.test(name)) { this.app.toast('Bitte einen gültigen Namen angeben (ohne \\ / : * ? " < > |).', 'err'); return; }
      b.textContent = 'Repariere …'; laden(`Reparierte Kopie „${name}“ wird angelegt …`);
      let { r: r2, j: j2 } = await post('/api/karte/spielstand-reparieren', { id: this.id, name });
      if (r2.status === 409) {
        if (!(await frage({ art: 'warnung', titel: 'Spielstand überschreiben?', text: `Den Spielstand „${name}“ gibt es schon. Die alte Datei wird vorher gesichert.`, ok: 'Überschreiben' }))) return;
        ({ r: r2, j: j2 } = await post('/api/karte/spielstand-reparieren', { id: this.id, name, ueberschreiben: true }));
      }
      if (!r2.ok) throw new Error(j2.fehler || r2.status);
      $('k-loading').hidden = true;
      this.liste = null; await this.ladeListe();
      await frage({ art: j2.offen ? 'warnung' : 'frage', titel: 'Reparatur fertig', ok: 'OK', abbrechen: 'Schließen',
        text: [`„${name}“ gespeichert: ${zz(j2.behoben)} Fehler behoben.`, j2.offen ? `${zz(j2.offen)} Fehler offen.` : 'Nachprüfung ohne Fehler.', ...(j2.sicherung ? [`Alte Datei gesichert: ${j2.sicherung}`] : [])].map((x) => t(x)).join('\n') });
    } catch (e) { $('k-loading').hidden = true; await frage({ art: 'warnung', titel: 'Prüfen fehlgeschlagen', text: t('Prüfen fehlgeschlagen: ' + e.message) + (/Unbekannt|404/.test(e.message) ? '\n' + t('Bitte die App einmal neu starten – der Server kennt die Prüfung noch nicht.') : ''), ok: 'OK', abbrechen: 'Schließen' }); }
    finally { $('k-loading').hidden = true; b.disabled = false; b.innerHTML = alt; }
  }
  oeffne3d() {
    if (!this.id) { this.app.toast('Bitte zuerst links einen Spielstand wählen.', 'err'); return; }
    if (this.id.startsWith('mp:')) { this.app.toast('Megaprints zeigt die Welt-Ansicht nicht – nur Spielstände.', 'err'); return; }
    this.app.weltOeffnen(this.id);
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
    $('k-ebenen').addEventListener('change', () => this.ebenenKnopf());
    $('k-eb-knopf').addEventListener('click', (e) => { e.stopPropagation(); const m = $('k-eb-menue'); m.hidden = !m.hidden; });
    document.addEventListener('pointerdown', (e) => { const m = $('k-eb-menue'); if (!m.hidden && !m.contains(e.target) && !e.target.closest('#k-eb-knopf')) m.hidden = true; });
    $('k-fit').addEventListener('click', () => this.einpassen());
    $('k-welt').addEventListener('click', () => this.welt());
    $('k-punkte').addEventListener('click', () => this.punkteSetzen(!this.punkteAn));
    $('k-mp').addEventListener('click', (e) => { e.stopPropagation(); this.megaprintMenue(); });
    $('k-mp-weg').addEventListener('click', () => this.ueberWeg());
    document.addEventListener('pointerdown', (e) => { const m = $('k-mp-menue'); if (m && !m.hidden && !m.contains(e.target) && !e.target.closest('#k-mp')) m.hidden = true; });
    $('k-punkte-wahl').addEventListener('click', (e) => { e.stopPropagation(); this.punkteMenue(); });
    // Menü schließt bei Klick daneben
    document.addEventListener('pointerdown', (e) => { const m = $('k-punkte-menue'); if (m && !m.hidden && !m.contains(e.target) && e.target.id !== 'k-punkte-wahl') m.hidden = true; });
    cv.addEventListener('pointerleave', () => { if (this.pTipp) this.pTipp.hidden = true; });
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
      if (!drag) { this.punktTipp(e); return; }
      if (this.pTipp) this.pTipp.hidden = true;
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
    $('k-pruefen').addEventListener('click', () => this.spielstandPruefen());
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
