// Satisfactory-Spielstaende (.sav, Update 8 bis 1.2) lesen – ohne fremde Abhaengigkeiten.
//
// Aufbau (Kopf-Version 14, Save-Version 60 / 1.2):
//   Kopf: headerVersion, saveVersion, buildVersion, saveName, mapName, mapOptions, sessionName, playedSeconds,
//         saveDateTime (int64 Ticks), sessionVisibility (u8), editorObjectVersion, modMetadata, isModded,
//         saveIdentifier, isPartitionedWorld, saveDataHash (20 Byte), isCreativeMode
//   Danach zlib-Bloecke wie bei Blaupausen. Entpackter Body:
//     int64 Groesse, Paket-Versionsblock, Validierungs-Raster, int32 Anzahl Unter-Level,
//     je Unter-Level: Name, Level-Daten; zum Schluss das Haupt-Level (ohne Name).
//   Level-Daten: int64 Laenge Objektkoepfe [int32 n, Koepfe…, Sammelobjekte], int64 Laenge Objektdaten [int32 n, je
//     int32 Version, int32 Flag, int32 Groesse, Daten, int32 0], danach (nur Unter-Level) int32 Version, int32, int32 hatPaket, Paketblock.
//
// Gelesen werden fuer die Karte: Klasse, Position, Drehung (alle Objekte) und gezielt Eigenschaften
// (Spline von Baendern/Rohren/Schienen, Lift-Hoehe, Farbe) – derselbe Eigenschafts-Leser wie bei Blaupausen.

import fs from 'node:fs';
import zlib from 'node:zlib';

const CHUNK_TAG = 0x9e2a83c1;
const ANHANG_AB = 53; // Objekt-Version, ab der nach den Daten ein int32 folgt

class Reader {
  constructor(buf, pos = 0) { this.b = buf; this.p = pos; }
  i32() { const v = this.b.readInt32LE(this.p); this.p += 4; return v; }
  u32() { const v = this.b.readUInt32LE(this.p); this.p += 4; return v; }
  u8() { return this.b[this.p++]; }
  f32() { const v = this.b.readFloatLE(this.p); this.p += 4; return v; }
  i64() { const v = Number(this.b.readBigInt64LE(this.p)); this.p += 8; return v; }
  str() {
    const n = this.i32();
    if (n === 0) return '';
    if (n < 0) {
      if (n < -1_000_000) throw new Error(`Ungueltige Textlaenge ${n} bei Byte ${this.p - 4}`);
      const s = this.b.toString('utf16le', this.p, this.p - n * 2 - 2); this.p += -n * 2; return s;
    }
    if (n > 1_000_000) throw new Error(`Ungueltige Textlaenge ${n} bei Byte ${this.p - 4}`);
    const s = this.b.toString('latin1', this.p, this.p + n - 1); this.p += n; return s;
  }
  skipStr() { const n = this.i32(); this.p += n < 0 ? -n * 2 : n; }
}

export const shortClass = (p) => {
  const m = /\.([A-Za-z0-9_]+?)(?:_C)?$/.exec(p || '');
  return m ? m[1] + '_C' : (p || '');
};

// ------------------------------------------------------------------ Kopf
export function readSavHeader(buf) {
  const r = new Reader(buf);
  const h = { headerVersion: r.i32(), saveVersion: r.i32(), buildVersion: r.i32() };
  if (h.headerVersion < 13 || h.headerVersion > 20) throw new Error(`Spielstand-Kopf Version ${h.headerVersion} wird nicht unterstützt (unterstützt: ab Update 8).`);
  h.saveName = h.headerVersion >= 14 ? r.str() : '';
  h.mapName = r.str(); h.mapOptions = r.str(); h.sessionName = r.str();
  h.playedSeconds = r.i32();
  const ticks = BigInt.asIntN(64, buf.readBigInt64LE(r.p)); r.p += 8;
  h.saveDate = new Date(Number((ticks - 621355968000000000n) / 10000n)).toISOString();
  h.visibility = r.u8();
  h.editorObjectVersion = r.i32();
  h.modMetadata = r.str(); h.isModded = r.i32();
  h.saveIdentifier = r.str();
  h.isPartitionedWorld = r.i32();
  r.p += 20; // saveDataHash
  h.isCreative = r.i32();
  h.headerLength = r.p;
  try { h.mods = JSON.parse(h.modMetadata).Mods?.map((m) => m.Name) || []; } catch { h.mods = []; }
  return h;
}

export function inflateBody(buf, start) {
  const parts = [];
  let p = start;
  while (p < buf.length) {
    if (buf.readUInt32LE(p) !== CHUNK_TAG) throw new Error(`Unerwartete Daten bei Byte ${p}`);
    const v2 = buf.readUInt32LE(p + 4) === 0x22222222;
    const q = p + (v2 ? 17 : 16);
    const comp = Number(buf.readBigInt64LE(q));
    const s = q + 32;
    parts.push(zlib.inflateSync(buf.subarray(s, s + comp)));
    p = s + comp;
  }
  return Buffer.concat(parts);
}

// ------------------------------------------------------------------ Body
function skipPackageBlock(r) {
  r.i32(); r.i32(); r.i32(); r.i32(); // ?, UE4-Version, UE5-Version, Lizenznehmer-Version
  r.p += 6; r.u32(); // Engine-Version 5.x.y + Changelist
  r.skipStr(); // "++FactoryGame+rel-main-1.2.0"
  const n = r.i32();
  if (n < 0 || n > 1000) throw new Error('Versionsblock unlesbar');
  r.p += n * 20; // CustomVersions (GUID + int32)
}

function readLevel(r, name, objects, levelIdx, opts) {
  const hl = r.i64(), hs = r.p;
  if (hl < 0 || hs + hl > r.b.length) throw new Error(`Level ${name}: Länge der Objektköpfe ungültig`);
  const n = r.i32();
  const first = objects.length;
  for (let k = 0; k < n; k++) {
    const type = r.i32();
    const typePath = r.str();
    r.skipStr(); // levelName
    const pathName = r.str();
    const flags = opts.mitFlags ? r.i32() : 0; // Objekt-Flags erst ab 1.0 (Save-Version 46)
    if (type === 1) {
      r.i32(); // needTransform
      const rot = [r.f32(), r.f32(), r.f32(), r.f32()];
      const pos = [r.f32(), r.f32(), r.f32()];
      const scale = [r.f32(), r.f32(), r.f32()];
      const placed = r.i32();
      objects.push({ kind: 1, typePath, pathName, flags, rot, pos, scale, placed, level: levelIdx });
    } else {
      const parent = r.str();
      objects.push({ kind: 0, typePath, pathName, flags, parent, level: levelIdx });
    }
  }
  r.p = hs + hl; // Rest (Sammelobjekte) ueberspringen
  const cl = r.i64(), cs = r.p;
  if (cl < 0 || cs + cl > r.b.length) throw new Error(`Level ${name}: Länge der Objektdaten ungültig`);
  const n2 = r.i32();
  if (n2 === n) {
    for (let k = 0; k < n; k++) {
      const ver = r.i32(); r.i32(); // Objekt-Version (je Objekt! alte Objekte behalten ihre Version), Flag
      const size = r.i32();
      const o = objects[first + k];
      o.ver = ver; o.dBody = r.p; o.dEnd = r.p + size;
      r.p += size;
      if (ver >= ANHANG_AB) r.i32(); // Anhang bei Objekten ab Version 1.2 (bisher immer 0)
    }
  }
  r.p = cs + cl;
}

/** Liest einen Spielstand. opts.props: Eigenschaften (Splines usw.) auslesen. */
export function readSave(buf, { props = true, readProps = null } = {}) {
  const header = readSavHeader(buf);
  const body = inflateBody(buf, header.headerLength);
  const r = new Reader(body);
  r.i64();
  // ab 1.2: Paket-Versionsblock (int32 0, UE4-Version 5xx, …); 1.0/1.1 beginnen direkt mit den Rastern
  const neu = r.b.readInt32LE(r.p) === 0 && r.b.readInt32LE(r.p + 4) > 400 && r.b.readInt32LE(r.p + 4) < 1000;
  if (neu) skipPackageBlock(r);
  const opt = { neu, mitFlags: header.saveVersion >= 46 };
  // Validierungs-Raster
  const ng = r.i32();
  for (let g = 0; g < ng; g++) { r.skipStr(); r.i32(); r.u32(); const n = r.i32(); for (let c = 0; c < n; c++) { r.skipStr(); r.u32(); } }
  const nl = r.i32();
  const objects = [], levels = [];
  for (let l = 0; l <= nl; l++) {
    const persistent = l === nl;
    const name = persistent ? header.mapName : r.str();
    levels.push(name);
    const at = r.p;
    try { readLevel(r, name, objects, l, opt); } catch (e) { e.message += ` (Level ${l}/${nl} „${name}“ ab Byte ${at})`; throw e; }
    if (!persistent) {
      // Level-Anhang: Version, entfernte Objekte (Liste von Referenzen), hatPaket, Paketblock
      if (opt.mitFlags) r.i32(); // Level-Version (erst ab 1.0)
      const nd = r.i32();
      for (let k = 0; k < nd; k++) { r.skipStr(); r.skipStr(); }
      if (neu && r.i32()) skipPackageBlock(r); // ab 1.2: Paketblock je Level
    }
  }
  if (props && readProps) for (const o of objects) if (o.kind === 1 && o.dBody !== undefined) readProps(body, o);
  return { header, body, objects, levels };
}

export function readSaveFile(file, opts) { return readSave(fs.readFileSync(file), opts); }

// ------------------------------------------------------------------ Leichtbau-Teile (Fundamente, Waende, Saeulen, Traeger …)
// Ab 1.0 speichert das Spiel diese nicht als einzelne Objekte, sondern gesammelt im Objekt
// FGLightweightBuildableSubsystem: nach den Eigenschaften ("None") int32 0, int32 Version, int32 Anzahl Klassen,
// je Klasse: ObjectReference Klasse, int32 Anzahl, je Teil: Transform (10 double: Drehung, Position, Skalierung),
// 4 Referenzen (Farbfeld, Material, Muster, Skin), 2 Farben (8 float), Referenz Lackierung, u8 Musterdrehung,
// Referenz Rezept, Referenz Blaupausen-Proxy, int32 hatDaten [Referenz Struktur, int32 Groesse, Daten], int32, u8.
export function readLightweight(body, o, cb) {
  const r = new Reader(body, body.indexOf('None\0', o.dBody, 'latin1') + 5);
  if (r.p < o.dBody + 5 || r.p > o.dEnd) return 0;
  r.i32(); const version = r.i32(); // 2 = Spiel 1.1, 4 = Spiel 1.2
  const nc = r.i32();
  let total = 0;
  for (let c = 0; c < nc; c++) {
    r.skipStr(); const typePath = r.str();
    const n = r.i32();
    for (let k = 0; k < n; k++) {
      const rot = [body.readDoubleLE(r.p), body.readDoubleLE(r.p + 8), body.readDoubleLE(r.p + 16), body.readDoubleLE(r.p + 24)];
      const pos = [body.readDoubleLE(r.p + 32), body.readDoubleLE(r.p + 40), body.readDoubleLE(r.p + 48)];
      r.p += 80;
      r.skipStr(); const swatch = r.str();
      for (let j = 0; j < 6; j++) r.skipStr();
      r.p += 32;
      r.skipStr(); r.skipStr(); r.p++;
      r.skipStr(); r.skipStr(); // Rezept
      r.skipStr(); const proxy = r.str();
      let typed = null;
      if (r.i32()) { r.skipStr(); r.skipStr(); const sz = r.i32(); typed = body.subarray(r.p, r.p + sz); r.p += sz; }
      if (version >= 4) { r.i32(); r.p++; }
      cb(typePath, rot, pos, swatch, proxy, typed);
    }
    total += n;
  }
  if (r.p !== o.dEnd) throw new Error(`Leichtbau-Daten: Länge passt nicht (${r.p - o.dBody} von ${o.dEnd - o.dBody} Byte)`);
  return total;
}
