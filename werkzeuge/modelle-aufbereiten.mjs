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
import zlib from 'node:zlib';
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

// ------------------------------------------------------------------ Spieloptik: Material-Arten
// 0 = Material-Raster (MM_Factory_Array: UV0 zeigt in ein 3×3-Raster aus Lack/Metall/Gummi …, Lackfarben aus der Blaupause)
// 1 = Decal (DecalColor_Masked: Farbe aus ColorAtlas_Alb über UV0, durchsichtig wo Alpha < 1/3)
// 2 = Glas · 3 = sonstiges Material (vorerst einfarbig) · 4 = nur-Normalen-Decal (in der Spieloptik unsichtbar)
// Reihenfolge der Dreiecke je Modell: 0, 3, 1, 4, 2 – Glas zuletzt (gi), damit ältere Darstellungen unverändert bleiben.
const ART_REIHE = [0, 5, 3, 1, 4, 2];
// 5 = eigene Textur (Grundfarbe + Lack-/Schattenmaske, UV0) – Kachel im Atlas „bauteile.png“/„bauteile-maske.png“
const materialien = new Map(); // Name -> { kette: [Namen …], ao: Texturname|null }
function materialInfo(name) {
  if (materialien.has(name)) return materialien.get(name);
  const info = { kette: [name], ao: null, albedo: null, maske: null, bekannt: false };
  materialien.set(name, info);
  let n = name;
  for (let k = 0; k < 12 && n; k++) {
    const f = matDateien.get(n.toLowerCase());
    if (!f) break;
    let d; try { d = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { break; }
    const o = Array.isArray(d) ? d.find((e) => e.Properties) || d[0] : d;
    const p = o?.Properties || {};
    info.bekannt = true;
    for (const t of p.TextureParameterValues || []) {
      const pn = t.ParameterInfo?.Name || '', tn = /'([^']+)'/.exec(t.ParameterValue?.ObjectName || '')?.[1];
      if (!tn) continue;
      if (!info.ao && /^AO$/i.test(pn)) info.ao = tn;                                   // Schatten (Material-Raster)
      else if (!info.maske && /^(AOMasks?|AO_Masks?|MaskAO)$/i.test(pn)) info.maske = tn; // R Schatten, G Primär-, B Sekundärlack
      else if (!info.albedo && /^(Albedo|BaseColou?r)$/i.test(pn)) info.albedo = tn;    // Grundfarbe
    }
    const eltern = /'([^']+)'/.exec(p.Parent?.ObjectName || '')?.[1];
    if (!eltern) break;
    info.kette.push(eltern); n = eltern;
  }
  return info;
}
function materialArt(name) {
  if (/Decal_?Normal/i.test(name)) return 4;
  if (/DecalColor/i.test(name)) return 1;
  if (GLASS.test(name)) return 2;
  const info = materialInfo(name);
  if (info.kette.some((k) => /Decal_?Normal/i.test(k))) return 4;
  if (info.kette.some((k) => /DecalColor/i.test(k))) return 1;
  if (info.kette.some((k) => /MM_Factory_Array/i.test(k))) return 0;
  if (info.albedo && !info.kette.some((k) => /Imposter|Hologram|Fog|Glass/i.test(k))) return 5; // eigene Textur (MM_FactoryBaked & Co.)
  if (!info.bekannt && /^MI_Factory_(Base|0\d)/i.test(name)) return 0; // ohne Material-Daten: bekannte Grundmaterialien
  return 3;
}

// ------------------------------------------------------------------ PNG lesen/schreiben (ohne Fremdpakete)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function pngLesen(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('kein PNG');
  let o = 8, w = 0, h = 0, tiefe = 8, typ = 6, il = 0; const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o), t = b.toString('latin1', o + 4, o + 8), d = b.subarray(o + 8, o + 8 + len);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); tiefe = d[8]; typ = d[9]; il = d[12]; }
    else if (t === 'IDAT') idat.push(d);
    else if (t === 'IEND') break;
    o += 12 + len;
  }
  if (il) throw new Error('PNG mit Zeilensprung');
  const kanaele = { 0: 1, 2: 3, 4: 2, 6: 4 }[typ];
  if (!kanaele || (tiefe !== 8 && tiefe !== 16)) throw new Error(`PNG-Format ${typ}/${tiefe} nicht unterstützt`);
  const roh = zlib.inflateSync(Buffer.concat(idat)), bpp = kanaele * tiefe / 8, zeile = w * bpp;
  const px = Buffer.alloc(h * zeile);
  for (let y = 0; y < h; y++) {
    const f = roh[y * (zeile + 1)], q = roh.subarray(y * (zeile + 1) + 1, (y + 1) * (zeile + 1)), z = px.subarray(y * zeile, (y + 1) * zeile), v = y ? px.subarray((y - 1) * zeile, y * zeile) : null;
    for (let i = 0; i < zeile; i++) {
      const a = i >= bpp ? z[i - bpp] : 0, bb = v ? v[i] : 0, c = v && i >= bpp ? v[i - bpp] : 0;
      let r = q[i];
      if (f === 1) r += a; else if (f === 2) r += bb; else if (f === 3) r += (a + bb) >> 1;
      else if (f === 4) { const pp = a + bb - c, pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c); r += pa <= pb && pa <= pc ? a : pb <= pc ? bb : c; }
      z[i] = r & 255;
    }
  }
  // erster Kanal (bei 16 Bit das höherwertige Byte) – mehr braucht die Schatten-Textur nicht
  const grau = new Uint8Array(w * h), schritt = bpp, b1 = tiefe / 8;
  for (let k = 0; k < w * h; k++) grau[k] = px[k * schritt];
  // RGB (Graustufen werden dreifach), bei 16 Bit das höherwertige Byte
  const rgb = () => { const out = new Uint8Array(w * h * 3); for (let k = 0; k < w * h; k++) for (let c = 0; c < 3; c++) out[k * 3 + c] = px[k * schritt + (kanaele >= 3 ? c : 0) * b1]; return out; };
  return { w, h, grau, rgb };
}
function pngGrauSchreiben(file, w, h, px, kanaele = 1) {
  const zl = w * kanaele, roh = Buffer.alloc(h * (zl + 1));
  for (let y = 0; y < h; y++) { roh[y * (zl + 1)] = 0; Buffer.from(px.buffer, px.byteOffset + y * zl, zl).copy(roh, y * (zl + 1) + 1); }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'latin1'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = kanaele === 3 ? 2 : 0;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(roh, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}
/** Graustufenbild auf k×k verkleinern (Mittelwert der Bereiche) */
function verkleinern(bild, k) {
  const out = new Uint8Array(k * k), fx = bild.w / k, fy = bild.h / k;
  for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) {
    let s = 0, n = 0;
    for (let yy = Math.floor(y * fy); yy < Math.max(Math.floor(y * fy) + 1, Math.floor((y + 1) * fy)); yy++) for (let xx = Math.floor(x * fx); xx < Math.max(Math.floor(x * fx) + 1, Math.floor((x + 1) * fx)); xx++) { s += bild.grau[yy * bild.w + xx]; n++; }
    out[y * k + x] = Math.round(s / n);
  }
  return out;
}
/** RGB-Bild (w×h×3) auf k×k verkleinern (Mittelwert) */
function verkleinernRgb(w, h, px, k) {
  const out = new Uint8Array(k * k * 3), fx = w / k, fy = h / k;
  for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) {
    const s = [0, 0, 0]; let n = 0;
    for (let yy = Math.floor(y * fy); yy < Math.max(Math.floor(y * fy) + 1, Math.floor((y + 1) * fy)); yy++) for (let xx = Math.floor(x * fx); xx < Math.max(Math.floor(x * fx) + 1, Math.floor((x + 1) * fx)); xx++) { const o = (yy * w + xx) * 3; s[0] += px[o]; s[1] += px[o + 1]; s[2] += px[o + 2]; n++; }
    for (let c = 0; c < 3; c++) out[(y * k + x) * 3 + c] = Math.round(s[c] / n);
  }
  return out;
}
// Gleitkomma -> Halbfloat (für UV-Koordinaten)
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function half(v) {
  f32[0] = v; const x = u32[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return s;            // sehr kleine Werte -> 0
  if (e >= 31) return s | 0x7bff;  // zu groß -> größter Wert
  return (s | (e << 10) | (m >>> 13)) + ((m >>> 12) & 1); // runden (Übertrag in den Exponenten ist richtig)
}

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
const buildFiles = new Map(), glbFiles = new Map(), matDateien = new Map(), pngDateien = new Map();
for (const f of all) {
  const b = path.basename(f);
  if (/^Build_.*\.json$/i.test(b)) buildFiles.set(b.slice(0, -5), f);
  else if (/\.glb$/i.test(b)) glbFiles.set(b.slice(0, -4), f);
  else if (/\.json$/i.test(b) && /[\\/]Materialien[\\/]/i.test(f) && !b.startsWith('_')) matDateien.set(b.slice(0, -5).toLowerCase(), f);
  else if (/\.png$/i.test(b)) pngDateien.set(b.slice(0, -4).toLowerCase(), f);
}
console.log(`${matDateien.size} Material-Daten (Spieloptik)${matDateien.size ? '' : ' – fehlen: Modelle mit dem neuen Extraktor neu exportieren'}`);
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
// Boden-Durchführungen (Lift/Rohr/Hypertube): Deckel oben und unten, Mittelteil auf Fundamentdicke gestreckt (mSnappedBuildingThickness)
const durchfuehrungen = {};
for (const [name, file] of buildFiles) {
  let d; try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
  const def = d.find((e) => e.Name === 'Default__' + name + '_C')?.Properties || d.find((e) => e.Properties?.mCapMesh)?.Properties;
  if (!def?.mCapMesh) continue;
  const r = def.mMidMeshRotation || {};
  durchfuehrungen[name + '_C'] = { deckel: meshName(def.mCapMesh), mitte: meshName(def.mMidMesh), laenge: def.mMidMeshLength || 100, drehMitte: rotToQuat(r).map(r4), drehDeckel: Math.abs((r.Pitch || 0) - 90) < 1 ? rotToQuat(r).map(r4) : [0, 0, 0, 1] };
}
const zusatz = [...Object.values(durchfuehrungen).flatMap((x) => [x.deckel, x.mitte]), ...Object.values(lifte).flatMap((l) => [l.unten, l.mitte, l.halb, l.oben]), ...Object.values(stuetzen).flatMap((x) => [x.kopf?.[0], ...x.stangen.map((y) => y[0])])].filter((m) => m && glbFiles.has(m));
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
      const uv0 = pr.attributes.TEXCOORD_0 !== undefined ? acc(pr.attributes.TEXCOORD_0) : null;
      const uv1 = pr.attributes.TEXCOORD_1 !== undefined ? acc(pr.attributes.TEXCOORD_1) : null;
      const art = materialArt(mat);
      prims.push({ pos, nrm, idx, M, uv0, uv1, mat, art, glass: art === 2 });
    }
  }
  return prims;
}

// glTF (Meter, Y-oben) -> Unreal (cm, Z-oben):  UE = (gx, gz, gy) * 100
let uvTausch = 0;
function toUE(prims) {
  const P = [], N = [], I = [], UV = [], teile = [];
  let base = 0;
  const all = ART_REIHE.flatMap((a) => prims.filter((p) => p.art === a));
  let glassStart = -1;
  for (const pr of all) {
    if (pr.glass && glassStart < 0) glassStart = I.length;
    const ao = pr.art === 0 && pr.uv1 ? aoKachel(materialInfo(pr.mat).ao) : pr.art === 5 ? bauteilKachel(pr.mat) : -1;
    if (pr.art === 5 && ao < 0) pr.art = 3; // Textur fehlt: wie bisher einfarbig
    const letzt = teile[teile.length - 1];
    if (letzt && letzt[2] === pr.art && letzt[3] === ao) letzt[1] += pr.idx.length; else teile.push([I.length, pr.idx.length, pr.art, ao]);
    const M = pr.M, n = pr.pos.length / 3;
    // Fundamente/Rampen/Wände (MM_BakedStencil): die eigene Textur liegt auf UV1 (eindeutig 0…1), UV0 wiederholt nur das Muster
    // (gemessen 28.10.2026: Rampe UV0 −0,59…1,26, UV1 0…1) → für Art 5 UV1 an die Stelle von UV0 setzen
    const tausch = pr.art === 5 && pr.uv1 && materialInfo(pr.mat).kette.some((k2) => /BakedStencil/i.test(k2)) && pr.uv1.some((v) => v > 0.01);
    if (tausch) uvTausch++;
    for (let k = 0; k < n; k++) {
      const x = pr.pos[k * 3], y = pr.pos[k * 3 + 1], z = pr.pos[k * 3 + 2];
      const gx = M[0] * x + M[4] * y + M[8] * z + M[12], gy = M[1] * x + M[5] * y + M[9] * z + M[13], gz = M[2] * x + M[6] * y + M[10] * z + M[14];
      P.push(gx * 100, gz * 100, gy * 100);
      if (pr.nrm) {
        const a = pr.nrm[k * 3], b = pr.nrm[k * 3 + 1], c = pr.nrm[k * 3 + 2];
        let nx = M[0] * a + M[4] * b + M[8] * c, ny = M[1] * a + M[5] * b + M[9] * c, nz = M[2] * a + M[6] * b + M[10] * c;
        const l = Math.hypot(nx, ny, nz) || 1; N.push(nx / l, nz / l, ny / l);
      } else N.push(0, 0, 0);
      const a0 = tausch ? pr.uv1 : pr.uv0, a1 = tausch ? pr.uv0 : pr.uv1;
      UV.push(a0 ? a0[k * 2] : 0, a0 ? a0[k * 2 + 1] : 0, a1 ? a1[k * 2] : 0, a1 ? a1[k * 2 + 1] : 0);
    }
    for (let k = 0; k < pr.idx.length; k++) I.push(pr.idx[k] + base);
    base += n;
  }
  return { P, N, I, UV, teile, glassStart: glassStart < 0 ? I.length : glassStart };
}

// ------------------------------------------------------------------ Schatten-Texturen sammeln (Atlas aus Kacheln)
const AO_K = 256, BT_K = 256;
// Bauteil-Texturen (Art 5): je Material eine Kachel Grundfarbe + eine Kachel Maske (R Schatten, G/B Lack); malen = Lackmaske anwenden
const btListe = [], btNr = new Map();
function bauteilKachel(mat) {
  const key = mat.toLowerCase();
  if (btNr.has(key)) return btNr.get(key);
  const info = materialInfo(mat);
  let nr = -1;
  const fa = info.albedo && pngDateien.get(info.albedo.toLowerCase());
  if (fa) {
    try {
      const a = pngLesen(fa), farbe = verkleinernRgb(a.w, a.h, a.rgb(), BT_K);
      let maske = null;
      const fm = info.maske && pngDateien.get(info.maske.toLowerCase());
      if (fm) { const m = pngLesen(fm); maske = verkleinernRgb(m.w, m.h, m.rgb(), BT_K); }
      // Lack nur bei Maschinen-/Ausrüstungsteilen – Wände, Fundamente, Träger usw. behalten ihre Grundfarbe
      const malen = !!maske && info.kette.some((k) => /^MM_FactoryBaked(_VAT|_Equipment)?$|VAT/i.test(k)) && !info.kette.some((k) => /Walls|Stencil|Beams|Spline|Signal/i.test(k));
      btListe.push({ farbe, maske, malen }); nr = btListe.length - 1;
    } catch (e) { console.warn('  Bauteil-Textur übersprungen:', mat, e.message); }
  }
  btNr.set(key, nr);
  return nr;
}
const aoListe = [], aoNr = new Map();
function aoKachel(tex) {
  if (!tex) return -1;
  const key = tex.toLowerCase();
  if (aoNr.has(key)) return aoNr.get(key);
  let nr = -1;
  const f = pngDateien.get(key);
  if (f) { try { const b = pngLesen(f); aoListe.push(verkleinern(b, AO_K)); nr = aoListe.length - 1; } catch (e) { console.warn('  Schatten-Textur übersprungen:', tex, e.message); } }
  aoNr.set(key, nr);
  return nr;
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
  // Spieloptik: UV0 (Material-Raster/Decals) und UV1 (Schatten) als Halbfloats direkt dahinter
  const uvo = offset;
  const uv = new Uint16Array(nv * 4);
  for (let k = 0; k < nv * 4; k++) uv[k] = half(g.UV[k]);
  add(uv);
  meshes[name] = { o, nv, ni: g.I.length, gi: g.glassStart, u32: big ? 1 : 0, min: min.map((v) => Math.round(v * 100) / 100), max: max.map((v) => Math.round(v * 100) / 100), uv: uvo, teile: g.teile };
  nTri += g.I.length / 3;
}
for (const [cls, list] of Object.entries(klassen)) {
  klassen[cls] = list.filter((x) => meshes[x[0]]);
  if (!klassen[cls].length) delete klassen[cls];
}
for (const [c, l] of Object.entries(lifte)) if (![l.unten, l.mitte, l.oben].every((m) => meshes[m])) delete lifte[c]; else if (!meshes[l.halb]) l.halb = null;
for (const [c, x] of Object.entries(durchfuehrungen)) {
  if (!meshes[x.deckel]) { delete durchfuehrungen[c]; continue; }
  if (!meshes[x.mitte]) x.mitte = null;
  // Deckel mittig auf die Achse (z. B. Hypertube-Wanddurchführung liegt 1 m über ihrem Ursprung)
  const m = meshes[x.deckel], mitte = [0, 1, 2].map((k) => (m.min[k] + m.max[k]) / 2), v = qrot(x.drehDeckel, mitte);
  x.versatz = [-v[0], -v[1]].map(r4);
}
for (const [c, x] of Object.entries(stuetzen)) { x.stangen = x.stangen.filter((y) => meshes[y[0]]); if (x.kopf && !meshes[x.kopf[0]]) x.kopf = null; if (!x.stangen.length) delete stuetzen[c]; }
// Spieloptik-Texturen: Decal-Atlas (Original-PNG) und Schatten-Atlas (Graustufen, AO_K² je Modell)
let spiel = null;
{
  const decal = pngDateien.get('coloratlas_alb');
  const spalten = Math.max(1, Math.ceil(Math.sqrt(aoListe.length)));
  if (aoListe.length) {
    const W = spalten * AO_K, Hh = Math.ceil(aoListe.length / spalten) * AO_K, px = new Uint8Array(W * Hh).fill(255);
    aoListe.forEach((k, i) => { const x0 = (i % spalten) * AO_K, y0 = Math.floor(i / spalten) * AO_K; for (let y = 0; y < AO_K; y++) px.set(k.subarray(y * AO_K, (y + 1) * AO_K), (y0 + y) * W + x0); });
    pngGrauSchreiben(path.join(OUT_DIR, 'schatten.png'), W, Hh, px);
  }
  if (decal) { const z = path.join(OUT_DIR, 'decals.png'); try { fs.chmodSync(z, 0o644); } catch { /* neu */ } fs.writeFileSync(z, fs.readFileSync(decal)); }
  // Bauteil-Atlas (höchstens 4096 px): bei vielen Materialien kleinere Kacheln
  let bt = null;
  if (btListe.length) {
    const spBt = Math.ceil(Math.sqrt(btListe.length)), K = Math.min(BT_K, 2 ** Math.floor(Math.log2(4096 / spBt))), zeBt = Math.ceil(btListe.length / spBt);
    const W = spBt * K, Hh = zeBt * K, farbe = new Uint8Array(W * Hh * 3), maske = new Uint8Array(W * Hh * 3);
    for (let i = 0; i < W * Hh; i++) maske[i * 3] = 255;
    btListe.forEach((t, i) => {
      const x0 = (i % spBt) * K, y0 = Math.floor(i / spBt) * K;
      const f = K === BT_K ? t.farbe : verkleinernRgb(BT_K, BT_K, t.farbe, K), m = t.maske ? (K === BT_K ? t.maske : verkleinernRgb(BT_K, BT_K, t.maske, K)) : null;
      for (let y = 0; y < K; y++) for (let x = 0; x < K; x++) {
        const z = ((y0 + y) * W + x0 + x) * 3, q = (y * K + x) * 3;
        for (let c = 0; c < 3; c++) farbe[z + c] = f[q + c];
        if (m) { maske[z] = m[q]; maske[z + 1] = t.malen ? m[q + 1] : 0; maske[z + 2] = t.malen ? m[q + 2] : 0; }
      }
    });
    pngGrauSchreiben(path.join(OUT_DIR, 'bauteile.png'), W, Hh, farbe, 3);
    pngGrauSchreiben(path.join(OUT_DIR, 'bauteile-maske.png'), W, Hh, maske, 3);
    bt = { farbe: 'bauteile.png', maske: 'bauteile-maske.png', kachel: K, spalten: spBt, zeilen: zeBt };
    console.log(`Spieloptik: ${btListe.length} Bauteil-Texturen (${W}×${Hh})`);
  }
  spiel = !matDateien.size ? null : { bauteile: bt, decals: decal ? 'decals.png' : null, schatten: aoListe.length ? 'schatten.png' : null, kachel: AO_K, spalten, zeilen: Math.ceil(aoListe.length / spalten), materialDaten: matDateien.size > 0 };
  console.log(`Spieloptik: ${aoListe.length} Schatten-Texturen, Decal-Atlas ${decal ? 'ja' : 'fehlt'}, ${uvTausch} Teile mit Textur auf UV1 (Fundamente/Wände)`);
}
// ------------------------------------------------------------------ Gebiete (Biome) für den Kompass der Welt-Ansicht
// Quelle: FGMapAreaTexture „MapareatexturePersistentLevel“ (Extraktor → Export\Gebiete): mAreaData = 4096×4096 Byte, je Bildpunkt
// ein Eintrag aus mColorToArea (Gebiets-Klasse); Anzeigename über mDisplayName.Key der Klasse (Locations/…).
// Bildfläche = Kartenbereich der Spielwelt (wie interaktive Karten): X −324 698,83 … 425 301,83, Y −375 000 … 375 000 (cm).
// Ergebnis: app/public/modelle/gebiete.json (2048×2048, lauflängenkodiert)
const GEBIET_NAMEN = { // Schlüssel → [deutsch (Wiki/Spiel), englisch]
  AbyssCliffs: ['Abyss-Klippen', 'Abyss Cliffs'], BlueCrater: ['Blue Crater', 'Blue Crater'], CraterLakes: ['Kraterseen', 'Crater Lakes'],
  DesertCanyon: ['Desert Canyons', 'Desert Canyons'], DuneDesert: ['Dünenwüste', 'Dune Desert'], EasternDuneForest: ['Östlicher Dünenwald', 'Eastern Dune Forest'],
  GrassFields: ['Grasfelder', 'Grass Fields'], JungleSpires: ['Dschungeltürme', 'Jungle Spires'], LakeForest: ['Waldsee', 'Lake Forest'],
  MazeCanyon: ['Maze Canyons', 'Maze Canyons'], NorthernForest: ['Nördlicher Wald', 'Northern Forest'], RedBambooFields: ['Rote Bambusfelder', 'Red Bamboo Fields'],
  RedJungle: ['Roter Dschungel', 'Red Jungle'], RockyDesert: ['Felsenwüste', 'Rocky Desert'], SouthernForest: ['Südlicher Wald', 'Southern Forest'],
  SpireCoast: ['Spire Coast', 'Spire Coast'], Swamp: ['Sumpf', 'Swamp'], TitanForest: ['Titanenwald', 'Titan Forest'], WesternDuneForest: ['Westlicher Dünenwald', 'Western Dune Forest'],
};
function gebieteBauen() {
  const ordner = path.join(SRC, 'Gebiete'); if (!fs.existsSync(ordner)) return false;
  const tex = fs.readdirSync(ordner).find((f) => /Mapareatexture/i.test(f)); if (!tex) return false;
  const buf = fs.readFileSync(path.join(ordner, tex));
  // mAreaData ohne JSON.parse lesen (über 200 MB Text): Zahlen zwischen [ … ]
  const a = buf.indexOf('"mAreaData"'); if (a < 0) return false;
  let p = buf.indexOf(91, a) + 1; const W0 = 4096, roh = new Uint8Array(W0 * W0); let n = 0, v = 0, inZahl = false;
  for (; p < buf.length && n < roh.length; p++) {
    const c = buf[p];
    if (c >= 48 && c <= 57) { v = v * 10 + c - 48; inZahl = true; }
    else { if (inZahl) { roh[n++] = v; v = 0; inZahl = false; } if (c === 93) break; }
  }
  if (n !== roh.length) { console.log(`Gebiete: unerwartete Größe (${n})`); return false; }
  const rest = buf.toString('utf8', p, Math.min(buf.length, p + 2e6));
  const breite = +(/"mDataWidth":\s*(\d+)/.exec(rest) || [])[1] || W0; if (breite !== W0) { console.log('Gebiete: Breite', breite); return false; }
  const ca = /"mColorToArea":\s*(\[[\s\S]*?\]\s*)(?=,\s*"m|\s*\})/.exec(rest); if (!ca) return false;
  const eintraege = JSON.parse(ca[1]);
  // Klasse → Anzeigeschlüssel aus den Gebiets-Dateien
  const schluessel = {};
  for (const f of fs.readdirSync(ordner)) {
    const m = /_Area_(\w+)\.json$/.exec(f); if (!m) continue;
    try { const j = JSON.parse(fs.readFileSync(path.join(ordner, f), 'utf8')); const k = j[0]?.Properties?.mDisplayName?.Key; if (k) schluessel['Area_' + m[1] + '_C'] = k.replace(/^Locations\//, ''); } catch { /* egal */ }
  }
  const namen = [], nr = new Map(), abb = eintraege.map((e) => {
    const cls = (/'(Area_\w+_C)'/.exec(e.MapArea?.ObjectName || '') || [])[1], k = schluessel[cls];
    if (!k || k === 'NoMansLand') return 0;
    if (!nr.has(k)) { const t = GEBIET_NAMEN[k] || [k.replace(/([a-z])([A-Z])/g, '$1 $2'), k.replace(/([a-z])([A-Z])/g, '$1 $2')]; namen.push({ de: t[0], en: t[1] }); nr.set(k, namen.length); }
    return nr.get(k);
  });
  const W = 2048, f = W0 / W, karte = new Uint8Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) karte[y * W + x] = abb[roh[(y * f) * W0 + x * f]] || 0;
  const rle = []; for (let i = 0; i < karte.length;) { const w = karte[i]; let l = 1; while (l < 255 && i + l < karte.length && karte[i + l] === w) l++; rle.push(w, l); i += l; }
  const X0 = -324698.83, Y0 = -375000, SPANNE = 750000;
  fs.writeFileSync(path.join(OUT_DIR, 'gebiete.json'), JSON.stringify({ version: 1, x0: X0, y0: Y0, zelle: SPANNE / W, breite: W, hoehe: W, rle: 1, namen, daten: Buffer.from(Uint8Array.from(rle)).toString('base64') }));
  console.log(`Gebiete: ${namen.length} Biome (${namen.map((x) => x.de).join(', ')})`);
  return true;
}
try { gebieteBauen(); } catch (e) { console.log('Gebiete übersprungen:', e.message); }
const index = { version: 2, spiel, erstellt: new Date().toISOString(), quelle: SRC, groesse: offset, meshes, klassen, lifte, stuetzen, durchfuehrungen };
fs.writeFileSync(path.join(OUT_DIR, 'meshes.bin'), Buffer.concat(chunks));
fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index));
console.log(`Fertig: ${Object.keys(meshes).length} Meshes (${Math.round(nTri / 1000)}k Dreiecke, ${(offset / 1048576).toFixed(1)} MB), ${Object.keys(klassen).length} Bauteil-Typen, ${fail} Fehler`);
console.log('->', OUT_DIR);
