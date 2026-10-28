// Satisfactory-Blaupausen (.sbp / .sbpcfg) lesen und schreiben – ohne fremde Abhaengigkeiten.
//
// Aufbau einer .sbp-Datei (Spielversion 1.0–1.2):
//   Kopf:  int32 headerVersion, int32 saveVersion, int32 buildVersion, int32[3] Abmessung,
//          Baukosten (Anzahl, je: ObjectReference + int32 Menge), Rezepte (Anzahl, je ObjectReference)
//   Danach zlib-Bloecke (je 49 Byte Blockkopf, max. 128 KiB unkomprimiert). Entpackt ergibt sich der Body:
//          int32 Restlaenge, int32 Laenge Objektkoepfe, int32 Anzahl, Objektkoepfe…,
//          int32 Laenge Objektdaten, int32 Anzahl, Objektdaten (je int32 Groesse + Daten)…
//
// Bearbeitet werden nur Transformationen (Position/Drehung) und das Entfernen von Objekten.
// Alle uebrigen Bytes bleiben unveraendert erhalten.

import zlib from 'node:zlib';

const CHUNK_TAG = 0x9e2a83c1;
const ARCHIVE_V2 = 0x22222222;

// ------------------------------------------------------------------ Leser-Hilfen
class Reader {
  constructor(buf, pos = 0) { this.b = buf; this.p = pos; }
  i32() { const v = this.b.readInt32LE(this.p); this.p += 4; return v; }
  u8() { return this.b[this.p++]; }
  f32() { const v = this.b.readFloatLE(this.p); this.p += 4; return v; }
  f64() { const v = this.b.readDoubleLE(this.p); this.p += 8; return v; }
  i64() { const v = Number(this.b.readBigInt64LE(this.p)); this.p += 8; return v; }
  str() {
    const n = this.i32();
    if (n === 0) return '';
    if (n < 0) {
      const len = -n * 2;
      const s = this.b.toString('utf16le', this.p, this.p + len - 2);
      this.p += len; return s;
    }
    if (n > 1_000_000) throw new Error(`Ungueltige Textlaenge ${n} bei Byte ${this.p - 4}`);
    const s = this.b.toString('latin1', this.p, this.p + n - 1);
    this.p += n; return s;
  }
  ref() { return { levelName: this.str(), pathName: this.str() }; }
}

export const shortClass = (p) => {
  const m = /\.([A-Za-z0-9_]+?)(?:_C)?$/.exec(p || '');
  return m ? m[1] + '_C' : (p || '');
};

// ------------------------------------------------------------------ Kopf
function readHeader(buf) {
  const r = new Reader(buf);
  const h = { headerVersion: r.i32(), saveVersion: r.i32(), buildVersion: r.i32() };
  h.dimensions = [r.i32(), r.i32(), r.i32()];
  const nc = r.i32();
  if (nc < 0 || nc > 10000) throw new Error('Kein gueltiger Blaupausen-Kopf');
  h.costs = [];
  for (let i = 0; i < nc; i++) { const ref = r.ref(); h.costs.push({ item: shortClass(ref.pathName), path: ref.pathName, amount: r.i32() }); }
  const nr = r.i32();
  h.recipes = []; h.recipePaths = [];
  for (let i = 0; i < nr; i++) { const ref = r.ref(); h.recipes.push(shortClass(ref.pathName)); h.recipePaths.push(ref.pathName); }
  h.recipesEnd = r.p;
  // Neuere Dateien: danach Engine-/Paketversionen (variable Laenge) -> bis zum ersten Block unveraendert uebernehmen
  const magic = Buffer.from([0xc1, 0x83, 0x2a, 0x9e]);
  let first = buf.indexOf(magic, r.p);
  // Kennung muss von einer plausiblen Blockgroesse (128 KiB) gefolgt sein
  while (first >= 0 && !isChunkStart(buf, first)) first = buf.indexOf(magic, first + 1);
  if (first < 0) throw new Error('Keine komprimierten Daten gefunden');
  h.headerLength = first;
  const vm = /\+\+FactoryGame\+[A-Za-z0-9.\-+]+/.exec(buf.toString('latin1', r.p, first));
  if (vm) h.engineVersion = vm[0];
  return h;
}

// ------------------------------------------------------------------ zlib-Bloecke
// Blockkopf v2 (ab 1.0): Tag, 0x22222222, int64 maxChunk, uint8 Algorithmus, int64 comp, int64 uncomp, int64 comp, int64 uncomp (49 Byte)
// Blockkopf v1 (bis U8):  Tag, 0x00000000, int64 maxChunk, int64 comp, int64 uncomp, int64 comp, int64 uncomp (48 Byte)
function isChunkStart(buf, p) {
  if (p + 48 > buf.length || buf.readUInt32LE(p) !== CHUNK_TAG) return false;
  const arch = buf.readUInt32LE(p + 4);
  if (arch !== ARCHIVE_V2 && arch !== 0) return false;
  return Number(buf.readBigInt64LE(p + 8)) === 131072;
}

function readChunks(buf, start) {
  const parts = [];
  let p = start, maxChunk = 131072, algo = 3, version = 2;
  while (p < buf.length) {
    if (!isChunkStart(buf, p)) throw new Error(`Unerwartete Daten bei Byte ${p} (kein Block-Kennzeichen)`);
    version = buf.readUInt32LE(p + 4) === ARCHIVE_V2 ? 2 : 1;
    maxChunk = Number(buf.readBigInt64LE(p + 8));
    let q = p + 16;
    if (version === 2) algo = buf[q++];
    const comp = Number(buf.readBigInt64LE(q));
    const uncomp = Number(buf.readBigInt64LE(q + 8));
    const start2 = q + 32;
    const data = zlib.inflateSync(buf.subarray(start2, start2 + comp));
    if (data.length !== uncomp) throw new Error('Blockgroesse stimmt nicht');
    parts.push(data);
    p = start2 + comp;
  }
  return { body: Buffer.concat(parts), maxChunk, algo, chunkVersion: version };
}

function writeChunks(body, maxChunk = 131072, algo = 3, version = 2) {
  const out = [];
  for (let off = 0; off < body.length; off += maxChunk) {
    const raw = body.subarray(off, Math.min(off + maxChunk, body.length));
    const comp = zlib.deflateSync(raw);
    const v2 = version === 2;
    const h = Buffer.alloc(v2 ? 49 : 48);
    h.writeUInt32LE(CHUNK_TAG, 0);
    h.writeUInt32LE(v2 ? ARCHIVE_V2 : 0, 4);
    h.writeBigInt64LE(BigInt(maxChunk), 8);
    let q = 16;
    if (v2) h[q++] = algo;
    h.writeBigInt64LE(BigInt(comp.length), q);
    h.writeBigInt64LE(BigInt(raw.length), q + 8);
    h.writeBigInt64LE(BigInt(comp.length), q + 16);
    h.writeBigInt64LE(BigInt(raw.length), q + 24);
    out.push(h, comp);
  }
  return Buffer.concat(out);
}

// ------------------------------------------------------------------ Body
function readBody(body, hasFlags = true) {
  const r = new Reader(body);
  const total = r.i32();
  if (total !== body.length - 4) throw new Error('Body-Laenge stimmt nicht');
  const headersLen = r.i32();
  const headersStart = r.p;
  const count = r.i32();
  const objects = [];
  for (let i = 0; i < count; i++) {
    const start = r.p;
    const type = r.i32();
    const o = { i, kind: type === 1 ? 'entity' : 'component', typePath: r.str(), root: r.str(), instance: r.str() };
    o.flags = hasFlags ? r.i32() : 0;
    if (type === 1) {
      o.needTransform = r.i32();
      o.tOff = r.p;
      o.rot = [r.f32(), r.f32(), r.f32(), r.f32()];
      o.pos = [r.f32(), r.f32(), r.f32()];
      o.scale = [r.f32(), r.f32(), r.f32()];
      o.placedInLevel = r.i32();
    } else {
      o.parent = r.str();
    }
    o.hStart = start; o.hEnd = r.p;
    o.cls = shortClass(o.typePath);
    objects.push(o);
  }
  if (r.p !== headersStart + headersLen) throw new Error(`Objektkoepfe: Laenge passt nicht (${r.p} statt ${headersStart + headersLen})`);
  const dataLenPos = r.p;
  const dataLen = r.i32();
  const dataStart = r.p;
  const n2 = r.i32();
  if (n2 !== count) throw new Error(`Anzahl Objektdaten (${n2}) passt nicht zu Objektkoepfen (${count})`);
  for (let i = 0; i < count; i++) {
    const o = objects[i];
    o.dStart = r.p;
    const size = r.i32();
    o.dBody = r.p;
    r.p += size;
    o.dEnd = r.p;
  }
  if (r.p !== dataStart + dataLen) throw new Error('Objektdaten: Laenge passt nicht');
  return { objects, layout: { headersLenPos: 4, headersStart, dataLenPos, dataStart, end: r.p } };
}

// ------------------------------------------------------------------ Eigenschaften (gezielt)
const RX_RECIPE = /mCurrentRecipe\x00[\s\S]{0,140}?\/(?:Game|Script)\/[^\x00]*?\.(Recipe_[A-Za-z0-9_]+)\x00/;
const RX_SWATCH = /\.(SwatchDesc_[A-Za-z0-9_]+?)(?:_C)?\x00/;

export function readVectorAfter(body, pos, end) {
  // Sucht den naechsten Vektor-Wert (StructProperty "Vector") ab pos
  const vec = body.indexOf('\x07\x00\x00\x00Vector\x00', pos, 'latin1');
  if (vec < 0 || vec > end) return null;
  let p = vec + 11, size;
  if (body.readInt32LE(p) === 1 && body.readInt32LE(p + 4) === 20) {
    // ab 1.2: innere Typen ("/Script/CoreUObject"), dann Groesse + Flags
    p += 8 + 20 + 4;
    size = body.readInt32LE(p); const fl = body[p + 4]; p += 5;
    if (fl & 1) p += 4; // Array-Index (statische Felder, z. B. zweiter Leitungs-Endpunkt)
  } else {
    // bis 1.1: Groesse stand vor dem Strukturnamen; danach GUID (16) + hasGuid (1)
    size = body.readInt32LE(vec - 8);
    p += 17;
  }
  if (size === 24) return [body.readDoubleLE(p), body.readDoubleLE(p + 8), body.readDoubleLE(p + 16)];
  if (size === 12) return [body.readFloatLE(p), body.readFloatLE(p + 4), body.readFloatLE(p + 8)];
  return null;
}

export function readProps(body, o) {
  const s = o.dBody, e = o.dEnd;
  const txt = body.toString('latin1', s, e);
  const rm = RX_RECIPE.exec(txt);
  if (rm) o.recipe = rm[1].endsWith('_C') ? rm[1] : rm[1] + '_C';
  const sm = RX_SWATCH.exec(txt);
  if (sm) o.swatch = sm[1];
  // Spline (Foerderbaender, Rohre, Schienen, Hypertubes)
  const sp = txt.indexOf('mSplineData\x00');
  if (sp >= 0) {
    const pts = [];
    let q = sp;
    while (true) {
      const loc = txt.indexOf('\x09\x00\x00\x00Location\x00', q);
      if (loc < 0) break;
      const v = readVectorAfter(body, s + loc, e);
      if (!v) break;
      const pt = v.map((x) => Math.round(x * 10) / 10);
      // Tangenten (fuer Kurven) folgen direkt
      const at = txt.indexOf('ArriveTangent\x00', loc), lt = txt.indexOf('LeaveTangent\x00', loc);
      const nextLoc = txt.indexOf('\x09\x00\x00\x00Location\x00', loc + 12);
      if (at > 0 && lt > 0 && (nextLoc < 0 || lt < nextLoc)) {
        const a = readVectorAfter(body, s + at, e), l = readVectorAfter(body, s + lt, e);
        if (a && l) pt.push(...a.map((x) => Math.round(x * 10) / 10), ...l.map((x) => Math.round(x * 10) / 10));
      }
      pts.push(pt);
      q = loc + 12;
    }
    if (pts.length) o.spline = pts;
  }
  // Traeger: Laenge (FloatProperty, Wert 9 Bytes nach dem Typnamen – gleich in allen Versionen)
  const ml = txt.indexOf('mLength\x00');
  if (ml >= 0 && txt.startsWith('FloatProperty\x00', ml + 12)) {
    const at = s + ml + 12 + 14 + 9;
    if (at + 4 <= e) { const v = body.readFloatLE(at); if (v > 0 && v < 1e6) o.length = Math.round(v * 10) / 10; }
  }
  // Stützen/Masten: Höhe und gewählte Stangen-Variante (Name, 4-Byte-Typlänge, Typ, 9 Byte bis zum Wert – in alter und neuer Kodierung)
  const mh = txt.indexOf('mHeight\x00');
  if (mh >= 0 && txt.startsWith('FloatProperty\x00', mh + 12)) { const at = s + mh + 12 + 14 + 9; if (at + 4 <= e) { const v = body.readFloatLE(at); if (v >= 0 && v < 1e5) o.hoehe = v; } }
  const pv = txt.indexOf('mSelectedPoleVersion\x00');
  if (pv >= 0 && txt.startsWith('IntProperty\x00', pv + 25)) { const at = s + pv + 25 + 12 + 9; if (at + 4 <= e) { const v = body.readInt32LE(at); if (v >= 0 && v < 20) o.stangeNr = v; } }
  // Boden-Durchführung: Fundamentdicke (Name 26 Zeichen + Null, dann Typname mit Länge, 9 Byte bis zum Wert)
  const sd = txt.indexOf('mSnappedBuildingThickness\x00');
  if (sd >= 0 && txt.startsWith('FloatProperty\x00', sd + 30)) { const at = s + sd + 30 + 14 + 9; if (at + 4 <= e) { const v = body.readFloatLE(at); if (v > 0 && v < 1e4) o.dicke = v; } }
  // Foerderlift: obere Position
  const tt = txt.indexOf('mTopTransform\x00');
  if (tt >= 0) {
    const tr = txt.indexOf('Translation\x00', tt);
    if (tr >= 0) { const v = readVectorAfter(body, s + tr, e); if (v) o.liftTop = v.map((x) => Math.round(x * 10) / 10); }
  }
}

// ------------------------------------------------------------------ cfg
export function readCfg(buf) {
  try {
    const r = new Reader(buf);
    const cfg = { version: r.i32(), description: r.str(), iconId: r.i32() };
    cfg.color = [r.f32(), r.f32(), r.f32(), r.f32()];
    return cfg;
  } catch { return {}; }
}

// ------------------------------------------------------------------ Oeffentliche API
export function readBlueprint(buf, { props = true } = {}) {
  const header = readHeader(buf);
  const { body, maxChunk, algo, chunkVersion } = readChunks(buf, header.headerLength);
  // Objektkoepfe haben ab 1.0 ein zusaetzliches Flags-Feld; aeltere Dateien (U7/U8) nicht
  let parsed, hasFlags = header.saveVersion >= 46;
  try { parsed = readBody(body, hasFlags); } catch (e) {
    hasFlags = !hasFlags;
    try { parsed = readBody(body, hasFlags); } catch { throw e; }
  }
  const { objects, layout } = parsed;
  if (props) for (const o of objects) readProps(body, o);
  return { header, body, maxChunk, algo, chunkVersion, hasFlags, objects, layout, headerBytes: buf.subarray(0, header.headerLength), headerTail: buf.subarray(header.recipesEnd, header.headerLength) };
}

/** Nur Kopf + Objektanzahl (schnell fuer Listen) */
export function readSummary(buf) {
  const header = readHeader(buf);
  const { body } = readChunks(buf, header.headerLength);
  const r = new Reader(body, 8);
  return { header, objectCount: r.i32() };
}

/**
 * Schreibt eine Blaupause mit Aenderungen.
 * edits:   { index: { rot:[x,y,z,w], pos:[x,y,z] } }      Transformation aendern
 * remove:  [index]                                        entfernen (Komponenten der Entitaet mit)
 * replace: { index: { head: Buffer, data: Buffer } }      Objekt ersetzen (z. B. anderes Material)
 * add:     [{ head: Buffer, data: Buffer }]               neue Objekte anhaengen
 * kopf:    { costs: [{ path, amount }], recipes: [path] } Kopf neu schreiben (Baukosten/Rezepte)
 */
export function writeBlueprint(bp, { edits = {}, remove = [], replace = {}, add = [], kopf = null, retype = {} } = {}) {
  const body = Buffer.from(bp.body); // Kopie
  for (const [k, e] of Object.entries(edits)) {
    const o = bp.objects[+k];
    if (!o || o.kind !== 'entity') continue;
    let p = o.tOff;
    for (const v of e.rot) { body.writeFloatLE(v, p); p += 4; }
    for (const v of e.pos) { body.writeFloatLE(v, p); p += 4; }
  }
  let newBody = body;
  const rm = new Set(remove.map(Number));
  const rep = new Map(Object.entries(replace).map(([k, v]) => [+k, v]));
  // Bauteil-Typ in place aendern (z. B. Foerderband Mk.1 -> Mk.3): Kopf mit neuem Typpfad, Daten mit neuem Rezept; Spline/Anschluesse bleiben
  for (const [k, t] of Object.entries(retype)) {
    const o = bp.objects[+k];
    if (!o || rep.has(o.i)) continue;
    const oldLen = body.readInt32LE(o.hStart + 4);
    const afterPath = o.hStart + 8 + (oldLen < 0 ? -oldLen * 2 : oldLen);
    const head = Buffer.concat([body.subarray(o.hStart, o.hStart + 4), fstrb(t.typePath), body.subarray(afterPath, o.hEnd)]);
    let content = body.subarray(o.dBody, o.dEnd);
    if (t.recipePath) content = t.replaceRecipe(content, t.recipePath) || content;
    rep.set(o.i, { head, data: Buffer.concat([i32b(content.length), content]), keepComponents: true });
  }
  if (rm.size || rep.size || add.length) {
    const gone = new Set([...rm, ...[...rep].filter(([, v]) => !v.keepComponents).map(([i]) => i)].map((i) => bp.objects[i]?.instance).filter(Boolean));
    for (const o of bp.objects) if (o.kind === 'component' && gone.has(o.parent)) rm.add(o.i);
    const heads = [], datas = [];
    for (const o of bp.objects) {
      if (rm.has(o.i)) continue;
      const r = rep.get(o.i);
      heads.push(r ? r.head : body.subarray(o.hStart, o.hEnd));
      datas.push(r ? r.data : body.subarray(o.dStart, o.dEnd));
    }
    for (const a of add) { heads.push(a.head); datas.push(a.data); }
    newBody = assembleBody(heads, datas, body.subarray(bp.layout.end));
  }
  const head = kopf ? buildHeader(bp.header, kopf, bp.headerTail) : bp.headerBytes;
  return Buffer.concat([head, writeChunks(newBody, bp.maxChunk, bp.algo, bp.chunkVersion)]);
}

const i32b = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const fstrb = (s) => (s ? Buffer.concat([i32b(s.length + 1), Buffer.from(s + '\0', 'latin1')]) : i32b(0));

function assembleBody(heads, datas, tail) {
  const headBlock = Buffer.concat([i32b(heads.length), ...heads]);
  const dataBlock = Buffer.concat([i32b(datas.length), ...datas]);
  const inner = Buffer.concat([i32b(headBlock.length), headBlock, i32b(dataBlock.length), dataBlock, tail]);
  return Buffer.concat([i32b(inner.length), inner]);
}

export function buildHeader(h, kopf, tail) {
  const parts = [i32b(h.headerVersion), i32b(h.saveVersion), i32b(h.buildVersion), ...(kopf.dimensions || h.dimensions || [0, 0, 0]).map(i32b)];
  parts.push(i32b(kopf.costs.length));
  for (const c of kopf.costs) parts.push(fstrb(''), fstrb(c.path), i32b(Math.max(0, Math.round(c.amount))));
  parts.push(i32b(kopf.recipes.length));
  for (const r of kopf.recipes) parts.push(fstrb(''), fstrb(r));
  parts.push(tail);
  return Buffer.concat(parts);
}

/** Neue Blaupause aus einer Basis (Versionsdaten einer vorhandenen Blaupause) + Objekten. */
export function createBlueprint(basis, objs, kopf) {
  const h = { headerVersion: basis.headerVersion, saveVersion: basis.saveVersion, buildVersion: basis.buildVersion, dimensions: [0, 0, 0] };
  const head = buildHeader(h, kopf, Buffer.from(basis.headerTail, 'base64'));
  const body = assembleBody(objs.map((o) => o.head), objs.map((o) => o.data), Buffer.from(basis.bodyTail || '', 'base64'));
  return Buffer.concat([head, writeChunks(body, basis.maxChunk || 131072, basis.algo ?? 3, basis.chunkVersion || 2)]);
}

// ------------------------------------------------------------------ Mathematik
export function yawOf(q) {
  const [x, y, z, w] = q;
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * 180 / Math.PI;
}
export function rotateZ(q, deg) {
  const a = deg * Math.PI / 360, s = Math.sin(a), c = Math.cos(a);
  const [x, y, z, w] = q; // r = (0,0,s,c) * q
  return [c * x - s * y, c * y + s * x, c * z + s * w, c * w - s * z];
}
