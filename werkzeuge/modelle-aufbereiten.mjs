// Blueprint Studio – 3D-Modelle aus einem FModel-Export aufbereiten (ohne Fremdpakete).
//
// Aufruf:  node werkzeuge/modelle-aufbereiten.mjs ["<FModel-Export>\Output\Exports"]
//
// Erwartet im Export-Ordner:
//   - Build_*.json   (FModel: Export -> Properties (json) der Build_-Blueprints)
//   - *.glb          (FModel: Export -> Model, Mesh-Format glTF 2.0 binary)
// Ergebnis:  app/public/modelle/index.json  +  app/public/modelle/meshes.bin
//
// Koordinaten: FModel-glTF ist Y-oben in Metern (x, z, y vertauscht). Hier wird alles nach
// Unreal-Weltkoordinaten (cm, X/Y/Z-oben) zurueckgerechnet, wie es die Blaupausen verwenden.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, '..', 'app', 'public', 'modelle');
// Export-Ordner: Parameter – sonst aus den Einstellungen (fmodelExport) – sonst werkzeuge\\FModel\\Output\\Exports
function exportOrdner(ROOT) {
  if (process.argv[2]) return process.argv[2];
  try { const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'userdata', 'einstellungen.json'), 'utf8')); if (s.fmodelExport) return s.fmodelExport; if (s.fmodel) return path.join(s.fmodel, 'Output', 'Exports'); } catch { /* Standard */ }
  return path.join(ROOT, 'werkzeuge', 'FModel', 'Output', 'Exports');
}
const SRC = exportOrdner(path.resolve(HERE, '..'));

// Bauteile, deren Mesh im Spiel erst zur Laufzeit gewaehlt wird -> feste Wahl
const MANUELL = {
  Build_ConveyorPole_C: ['SM_ConveyorPole_01'],
  Build_PipeHyperSupport_C: ['SM_HyperTubePole_01'],
  Build_SignPole_C: ['SM_SignPole_200cm'],
  Build_SignPole_Small_C: ['SM_SignPole_200cm'],
  Build_SignPole_Medium_C: ['SM_SignPole_200cm'],
  Build_SignPole_Large_C: ['SM_SignPole_350cm'],
  Build_SignPole_Huge_C: ['SM_SignPole_500cm'],
  Build_SignPole_Portrait_C: ['SM_SignPole_200cm'],
  Build_PipelineFlowIndicator_C: ['SM_StatusInd_01'], // liegt unter …/FlowIndicator/ – der Filter „Indicator“ würde es sonst verwerfen
};
// Teile, die nicht zum sichtbaren Gebaeude gehoeren
const SKIP = /(^|\/)Cube$|Hologram|Indicator|Clearance|Collision|Snap|Preview|Overlap|Fog|Broken|_Holo|Arrows|Pause|SmokePlane|BlenderLiquid|LandingPad_Jelly|^\/Engine\/|FicsmasHat|GiftTree|Mercer_Rings/i;
const GLASS = /glass|window|glas/i;

// ------------------------------------------------------------------ Dateien sammeln
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
if (!fs.existsSync(SRC)) { console.error('Export-Ordner nicht gefunden:', SRC); process.exit(1); }
console.log('Lese', SRC);
const all = walk(SRC);
const buildFiles = new Map(), glbFiles = new Map();
for (const f of all) {
  const b = path.basename(f);
  if (/^Build_.*\.json$/i.test(b)) buildFiles.set(b.slice(0, -5), f);
  else if (/\.glb$/i.test(b)) glbFiles.set(b.slice(0, -4), f);
}
console.log(`${buildFiles.size} Build-Dateien, ${glbFiles.size} Modelle`);

// ------------------------------------------------------------------ Mathe
const rad = (d) => d * Math.PI / 180;
function rotToQuat(r) {
  if (!r) return [0, 0, 0, 1];
  const p = rad(r.Pitch || 0) / 2, y = rad(r.Yaw || 0) / 2, ro = rad(r.Roll || 0) / 2;
  const SP = Math.sin(p), CP = Math.cos(p), SY = Math.sin(y), CY = Math.cos(y), SR = Math.sin(ro), CR = Math.cos(ro);
  return [CR * SP * SY - SR * CP * CY, -CR * SP * CY - SR * CP * SY, CR * CP * SY - SR * SP * CY, CR * CP * CY + SR * SP * SY];
}
function qmul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
function qrot(q, v) {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
const vec = (v, d = 0) => (v ? [v.X ?? d, v.Y ?? d, v.Z ?? d] : [d, d, d]);
function compose(P, C) {
  const t = qrot(P.q, [C.t[0] * P.s[0], C.t[1] * P.s[1], C.t[2] * P.s[2]]);
  return { t: [t[0] + P.t[0], t[1] + P.t[1], t[2] + P.t[2]], q: qmul(P.q, C.q), s: [P.s[0] * C.s[0], P.s[1] * C.s[1], P.s[2] * C.s[2]] };
}
const inner = (ref) => { const m = /'([^']+)'/.exec(ref || ''); return m ? m[1] : null; };
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// ------------------------------------------------------------------ Build-Blueprints -> Mesh-Liste
const cache = new Map();
function partsOf(name, depth = 0) {
  if (cache.has(name)) return cache.get(name);
  cache.set(name, []);
  const file = buildFiles.get(name);
  if (!file || depth > 6) return [];
  let d;
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
  const byName = new Map(d.map((e) => [e.Name, e]));
  const out = [];
  let sup = null;
  for (const e of d) {
    const p = e.Properties || {};
    if (e.Type === 'BlueprintGeneratedClass') sup = inner((e.Super || e.SuperStruct || {}).ObjectName);
    if (e.Type === 'AbstractInstanceDataObject') {
      for (const ins of p.Instances || []) {
        if (!ins.StaticMesh) continue;
        const mesh = ins.StaticMesh.ObjectPath.split('.')[0];
        if (SKIP.test(mesh)) continue;
        const rt = ins.RelativeTransform || {}, q = rt.Rotation || {};
        out.push({ mesh, t: vec(rt.Translation), q: [q.X || 0, q.Y || 0, q.Z || 0, q.W ?? 1], s: vec(rt.Scale3D, 1) });
      }
    }
  }
  // Hierarchie der Komponenten (SCS-Knoten)
  const parent = new Map();
  for (const e of d) {
    if (e.Type !== 'SCS_Node') continue;
    const p = e.Properties || {};
    const tn = inner(p.ComponentTemplate?.ObjectName);
    for (const ch of p.ChildNodes || []) {
      const ce = byName.get(inner(ch.ObjectName));
      const ctn = ce && inner(ce.Properties?.ComponentTemplate?.ObjectName);
      if (ctn && tn) parent.set(ctn, tn);
    }
  }
  const xf = (n, k = 0) => {
    const e = byName.get(n);
    if (!e) return { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
    const p = e.Properties || {};
    const own = { t: vec(p.RelativeLocation), q: rotToQuat(p.RelativeRotation), s: vec(p.RelativeScale3D, 1) };
    return parent.has(n) && k < 10 ? compose(xf(parent.get(n), k + 1), own) : own;
  };
  for (const e of d) {
    const p = e.Properties || {};
    if (!p.StaticMesh || e.Type === 'AbstractInstanceDataObject') continue;
    if (p.bVisible === false || p.bHiddenInGame === true) continue;
    const mesh = p.StaticMesh.ObjectPath.split('.')[0];
    if (SKIP.test(mesh) || SKIP.test(e.Name || '')) continue;
    out.push({ mesh, ...xf(e.Name) });
  }
  const res = out.length ? out : (sup && sup.endsWith('_C') ? partsOf(sup.slice(0, -2), depth + 1) : []);
  cache.set(name, res);
  return res;
}

const klassen = {};
const fehlend = new Set();
for (const name of [...buildFiles.keys()].sort()) {
  for (const p of partsOf(name)) if (!glbFiles.has(p.mesh.split('/').pop())) fehlend.add(p.mesh.split('/').pop());
  const parts = partsOf(name).filter((p) => glbFiles.has(p.mesh.split('/').pop()));
  if (parts.length) klassen[name + '_C'] = parts.map((p) => [p.mesh.split('/').pop(), p.t.map(r4), p.q.map(r4), p.s.map(r4)]);
}
for (const [cls, list] of Object.entries(MANUELL)) {
  if (!klassen[cls]) { const ok = list.filter((m) => glbFiles.has(m)); if (ok.length) klassen[cls] = ok.map((m) => [m, [0, 0, 0], [0, 0, 0, 1], [1, 1, 1]]); }
}
// Höhenabhängige Bauteile – das Spiel setzt sie erst zur Laufzeit zusammen, die App ebenso (Höhe aus Spielstand/Blaupause):
//  lifte:    Förderlifte – Unterteil, Mittelstücke (Teilhöhe, auch halbe), Oberteil (FGBuildableConveyorLiftSparseData)
//  stuetzen: Stützen/Masten – Stangen-Varianten je Höhe (mPoleVariations) und ggf. Kopf (mSupportMeshInstanceData)
const lifte = {}, stuetzen = {};
const meshName = (ref) => (/StaticMesh'([^']+)'/.exec(ref?.ObjectName || '') || [])[1];
for (const [name, file] of buildFiles) {
  let d; try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
  const sp = d.filter((e) => e.Type === 'FGBuildableConveyorLiftSparseData').pop()?.Properties;
  if (sp) lifte[name + '_C'] = { teilhoehe: sp.mMeshHeight || 200, unten: meshName(sp.mBottomMesh), mitte: meshName(sp.mMidMesh), halb: meshName(sp.mHalfMidMesh), oben: meshName(sp.mTopMesh) };
  const def = d.find((e) => e.Name === 'Default__' + name + '_C')?.Properties;
  if (def?.mPoleVariations?.length) {
    const k = def.mSupportMeshInstanceData;
    stuetzen[name + '_C'] = { kopf: k?.StaticMesh ? [meshName(k.StaticMesh), vec(k.RelativeTransform?.Translation).map(r4)] : null,
      stangen: def.mPoleVariations.map((v) => [meshName(v.StaticMesh), v.Height || 0, vec(v.RelativeTransform?.Translation).map(r4)]).filter((x) => x[0]) };
  }
}
const zusatz = [...Object.values(lifte).flatMap((l) => [l.unten, l.mitte, l.halb, l.oben]), ...Object.values(stuetzen).flatMap((x) => [x.kopf?.[0], ...x.stangen.map((y) => y[0])])].filter((m) => m && glbFiles.has(m));
const used = [...new Set([...Object.values(klassen).flatMap((l) => l.map((x) => x[0])), ...zusatz])].sort();
console.log(`${Object.keys(lifte).length} Förderlifte, ${Object.keys(stuetzen).length} Stützen/Masten (höhenabhängig)`);
console.log(`${Object.keys(klassen).length} Bauteil-Typen mit Modell, ${used.length} verschiedene Meshes`);
if (fehlend.size) console.log(`Hinweis: ${fehlend.size} Meshes fehlen im Export (in FModel mit Export > Model nachholen):\n  ` + [...fehlend].sort().join('|'));

// ------------------------------------------------------------------ glb lesen
const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('kein glb');
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  const acc = (i) => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
    const T = CT[a.componentType], n = NC[a.type], es = T.BYTES_PER_ELEMENT;
    const stride = bv.byteStride || n * es, start = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
    const out = new (T === Float32Array ? Float32Array : T === Uint32Array ? Uint32Array : Float32Array)(a.count * n);
    const dv = new DataView(bin.buffer);
    const rd = { 5126: (o) => dv.getFloat32(o, true), 5125: (o) => dv.getUint32(o, true), 5123: (o) => dv.getUint16(o, true), 5121: (o) => dv.getUint8(o), 5122: (o) => dv.getInt16(o, true), 5120: (o) => dv.getInt8(o) }[a.componentType];
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = rd(start + k * stride + c * es);
    return out;
  };
  // Knoten-Matrizen (meist Einheitsmatrix)
  const mats = [];
  const mul = (A, B) => { const C = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) C[c * 4 + r] += A[k * 4 + r] * B[c * 4 + k]; return C; };
  const local = (nd) => {
    if (nd.matrix) return nd.matrix;
    const [qx, qy, qz, qw] = nd.rotation || [0, 0, 0, 1], [sx, sy, sz] = nd.scale || [1, 1, 1], [tx, ty, tz] = nd.translation || [0, 0, 0];
    return [(1 - 2 * (qy * qy + qz * qz)) * sx, 2 * (qx * qy + qz * qw) * sx, 2 * (qx * qz - qy * qw) * sx, 0,
      2 * (qx * qy - qz * qw) * sy, (1 - 2 * (qx * qx + qz * qz)) * sy, 2 * (qy * qz + qx * qw) * sy, 0,
      2 * (qx * qz + qy * qw) * sz, 2 * (qy * qz - qx * qw) * sz, (1 - 2 * (qx * qx + qy * qy)) * sz, 0, tx, ty, tz, 1];
  };
  const visit = (i, M) => {
    const nd = json.nodes[i], W = mul(M, local(nd));
    if (nd.mesh !== undefined) mats.push([nd.mesh, W]);
    for (const c of nd.children || []) visit(c, W);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const roots = json.scenes?.[json.scene || 0]?.nodes || (json.nodes || []).map((_, i) => i);
  for (const r of roots) visit(r, I);
  if (!mats.length && json.meshes) json.meshes.forEach((_, i) => mats.push([i, I]));
  const prims = [];
  for (const [mi, M] of mats) {
    for (const pr of json.meshes[mi].primitives) {
      if (pr.mode !== undefined && pr.mode !== 4) continue;
      const pos = acc(pr.attributes.POSITION);
      const nrm = pr.attributes.NORMAL !== undefined ? acc(pr.attributes.NORMAL) : null;
      const idx = pr.indices !== undefined ? acc(pr.indices) : Uint32Array.from({ length: pos.length / 3 }, (_, k) => k);
      const mat = pr.material !== undefined ? (json.materials?.[pr.material]?.name || '') : '';
      prims.push({ pos, nrm, idx, M, glass: GLASS.test(mat) });
    }
  }
  return prims;
}

// glTF (Meter, Y-oben) -> Unreal (cm, Z-oben):  UE = (gx, gz, gy) * 100
function toUE(prims) {
  const P = [], N = [], I = [], G = [];
  let base = 0;
  const all = [...prims.filter((p) => !p.glass), ...prims.filter((p) => p.glass)];
  let glassStart = -1;
  for (const pr of all) {
    if (pr.glass && glassStart < 0) glassStart = I.length;
    const M = pr.M, n = pr.pos.length / 3;
    for (let k = 0; k < n; k++) {
      const x = pr.pos[k * 3], y = pr.pos[k * 3 + 1], z = pr.pos[k * 3 + 2];
      const gx = M[0] * x + M[4] * y + M[8] * z + M[12], gy = M[1] * x + M[5] * y + M[9] * z + M[13], gz = M[2] * x + M[6] * y + M[10] * z + M[14];
      P.push(gx * 100, gz * 100, gy * 100);
      if (pr.nrm) {
        const a = pr.nrm[k * 3], b = pr.nrm[k * 3 + 1], c = pr.nrm[k * 3 + 2];
        let nx = M[0] * a + M[4] * b + M[8] * c, ny = M[1] * a + M[5] * b + M[9] * c, nz = M[2] * a + M[6] * b + M[10] * c;
        const l = Math.hypot(nx, ny, nz) || 1; N.push(nx / l, nz / l, ny / l);
      } else N.push(0, 0, 0);
    }
    for (let k = 0; k < pr.idx.length; k++) I.push(pr.idx[k] + base);
    base += n;
  }
  return { P, N, I, glassStart: glassStart < 0 ? I.length : glassStart };
}

// ------------------------------------------------------------------ schreiben
fs.mkdirSync(OUT_DIR, { recursive: true });
const chunks = [];
let offset = 0;
const meshes = {};
const pad4 = () => { const r = offset % 4; if (r) { chunks.push(Buffer.alloc(4 - r)); offset += 4 - r; } };
let nTri = 0, fail = 0;
for (const name of used) {
  let g;
  try { g = toUE(readGlb(glbFiles.get(name))); } catch (e) { console.warn('  uebersprungen:', name, e.message); fail++; continue; }
  const nv = g.P.length / 3;
  if (!nv || !g.I.length) { fail++; continue; }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < nv; k++) for (let c = 0; c < 3; c++) { const v = g.P[k * 3 + c]; if (v < min[c]) min[c] = v; if (v > max[c]) max[c] = v; }
  // Positionen als Int16 im Begrenzungsrahmen (Genauigkeit < 1 mm je 65 m)
  const pos = new Int16Array(nv * 3);
  for (let k = 0; k < nv; k++) for (let c = 0; c < 3; c++) {
    const span = max[c] - min[c] || 1;
    pos[k * 3 + c] = Math.round(((g.P[k * 3 + c] - min[c]) / span) * 65535 - 32768);
  }
  const nrm = new Int8Array(nv * 4);
  for (let k = 0; k < nv; k++) for (let c = 0; c < 3; c++) nrm[k * 4 + c] = Math.round(g.N[k * 3 + c] * 127);
  const big = nv > 65535;
  const idx = big ? Uint32Array.from(g.I) : Uint16Array.from(g.I);
  pad4();
  const o = offset;
  const add = (ta) => { const b = Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength); chunks.push(b); offset += b.length; pad4(); };
  add(pos); add(nrm); add(idx);
  meshes[name] = { o, nv, ni: g.I.length, gi: g.glassStart, u32: big ? 1 : 0, min: min.map((v) => Math.round(v * 100) / 100), max: max.map((v) => Math.round(v * 100) / 100) };
  nTri += g.I.length / 3;
}
for (const [cls, list] of Object.entries(klassen)) {
  klassen[cls] = list.filter((x) => meshes[x[0]]);
  if (!klassen[cls].length) delete klassen[cls];
}
for (const [c, l] of Object.entries(lifte)) if (![l.unten, l.mitte, l.oben].every((m) => meshes[m])) delete lifte[c]; else if (!meshes[l.halb]) l.halb = null;
for (const [c, x] of Object.entries(stuetzen)) { x.stangen = x.stangen.filter((y) => meshes[y[0]]); if (x.kopf && !meshes[x.kopf[0]]) x.kopf = null; if (!x.stangen.length) delete stuetzen[c]; }
const index = { version: 1, erstellt: new Date().toISOString(), quelle: SRC, groesse: offset, meshes, klassen, lifte, stuetzen };
fs.writeFileSync(path.join(OUT_DIR, 'meshes.bin'), Buffer.concat(chunks));
fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index));
console.log(`Fertig: ${Object.keys(meshes).length} Meshes (${Math.round(nTri / 1000)}k Dreiecke, ${(offset / 1048576).toFixed(1)} MB), ${Object.keys(klassen).length} Bauteil-Typen, ${fail} Fehler`);
console.log('->', OUT_DIR);
