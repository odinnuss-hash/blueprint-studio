// Eigenschaften (UE-Properties) in Objektdaten gezielt lesen und ersetzen – Format ab Spielversion 1.2 (saveVersion ≥ 52).
//
// Objektdaten einer Entität:  ObjectReference Eltern (Level, Pfad), int32 Anzahl Komponenten, je ObjectReference,
//                             u8 0, Eigenschaften …, "None", Rest (Zusatzdaten, unverändert).
// Objektdaten einer Komponente: u8 0, Eigenschaften …, "None", Rest.
// Eigenschaft (1.2): fstr Name, Typbaum (fstr Typ + int32 Anzahl Kinder, rekursiv), int32 Größe, u8 Flags
//                    (Bit 1 → int32 Array-Index), Wert (Größe Bytes).

const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
export function fstr(s) {
  if (!s) return i32(0);
  if (/^[\x00-\x7f]*$/.test(s)) return Buffer.concat([i32(s.length + 1), Buffer.from(s + '\0', 'latin1')]);
  return Buffer.concat([i32(-(s.length + 1)), Buffer.from(s + '\0', 'utf16le')]);
}

class R {
  constructor(b, p = 0) { this.b = b; this.p = p; }
  i32() { const v = this.b.readInt32LE(this.p); this.p += 4; return v; }
  u8() { return this.b[this.p++]; }
  str() {
    const n = this.i32();
    if (n === 0) return '';
    if (n < 0) { const s = this.b.toString('utf16le', this.p, this.p - n * 2 - 2); this.p += -n * 2; return s; }
    if (n > 100000) throw new Error(`Textlänge ${n} bei ${this.p - 4}`);
    const s = this.b.toString('latin1', this.p, this.p + n - 1); this.p += n; return s;
  }
  typ() { const name = this.str(); const n = this.i32(); const kinder = []; for (let k = 0; k < n; k++) kinder.push(this.typ()); return { name, kinder }; }
}

/** Zerlegt Objektdaten: { refs (nur Entität), propsStart, props:[{name,typ,start,valStart,end,size}], noneEnd } */
export function zerlege(data, istEntitaet) {
  const r = new R(data);
  let refs = null;
  if (istEntitaet) {
    refs = { eltern: [r.str(), r.str()], komp: [] };
    const n = r.i32();
    for (let k = 0; k < n; k++) refs.komp.push([r.str(), r.str()]);
  }
  const vorProps = r.p;
  r.u8(); // 0
  const props = [];
  const l = propListe(data, r.p);
  return { refs, vorProps, propsStart: vorProps + 1, props: l.props, noneStart: l.noneStart, noneEnd: l.noneEnd };
}

/** Eigenschaftsliste ab p bis "None" (auch für Struktur-Elemente in Arrays) */
export function propListe(data, p) {
  const r = new R(data, p);
  const props = [];
  while (true) {
    const start = r.p;
    const name = r.str();
    if (name === 'None' || name === '') return { props, noneStart: start, noneEnd: r.p };
    const typ = r.typ();
    const sizePos = r.p;
    const size = r.i32();
    const flags = r.u8();
    if (flags & 1) r.i32();
    const valStart = r.p;
    r.p += size;
    props.push({ name, typ, start, sizePos, valStart, end: r.p, size });
  }
}

const strProp = (name, wert) => { const v = fstr(wert); return Buffer.concat([fstr(name), fstr('StrProperty'), i32(0), i32(v.length), Buffer.from([0]), v]); };
const strWert = (data, p) => new R(data, p.valStart).str();

/** Schild-Texte setzen: texte = { Name: '…', Label: '…' } (ElementName → Text). Nicht genannte Elemente bleiben. */
export function setzeSchildTexte(data, texte) {
  const z = zerlege(data, true);
  const p = z.props.find((x) => x.name === 'mPrefabTextElementSaveData');
  if (!p) throw new Error('Schild ohne Textfelder');
  const n = data.readInt32LE(p.valStart);
  let q = p.valStart + 4;
  const elemente = [];
  for (let k = 0; k < n; k++) {
    const l = propListe(data, q);
    const en = l.props.find((x) => x.name === 'ElementName'), tx = l.props.find((x) => x.name === 'Text');
    const name = en ? strWert(data, en) : '';
    if (tx && Object.prototype.hasOwnProperty.call(texte, name)) {
      elemente.push(Buffer.concat([data.subarray(q, tx.start), strProp('Text', texte[name]), data.subarray(tx.end, l.noneEnd)]));
    } else elemente.push(data.subarray(q, l.noneEnd));
    q = l.noneEnd;
  }
  const wert = Buffer.concat([i32(n), ...elemente, data.subarray(q, p.end)]);
  const kopf = Buffer.from(data.subarray(p.start, p.valStart));
  kopf.writeInt32LE(wert.length, p.sizePos - p.start);
  return Buffer.concat([data.subarray(0, p.start), kopf, wert, data.subarray(p.end)]);
}

/** Spline-Array komplett neu aufbauen (beliebige Punktanzahl) – erstes Element dient als Muster */
export function baueSpline(data, punkte) {
  const z = zerlege(data, true);
  const p = z.props.find((x) => x.name === 'mSplineData');
  if (!p) throw new Error('Keine Spline-Daten');
  const n = data.readInt32LE(p.valStart);
  if (n < 1) throw new Error('Leere Spline-Vorlage');
  const e0 = p.valStart + 4;
  const l = propListe(data, e0);
  const muster = data.subarray(e0, l.noneEnd);
  // Positionen der drei Vektoren (Location, ArriveTangent, LeaveTangent) relativ zum Muster
  const stellen = l.props.filter((x) => x.size === 24 && x.typ?.kinder?.[0]?.name === 'Vector').map((x) => x.valStart - e0);
  if (stellen.length !== 3) throw new Error('Spline-Muster unerwartet');
  const elemente = punkte.map((pt) => {
    const b = Buffer.from(muster);
    [pt.loc, pt.arrive, pt.leave].forEach((v, j) => v.forEach((x, m) => b.writeDoubleLE(x, stellen[j] + m * 8)));
    return b;
  });
  let ende = e0;
  for (let k = 0; k < n; k++) ende = propListe(data, ende).noneEnd;
  const rest = data.subarray(ende, p.end);
  const wert = Buffer.concat([i32(punkte.length), ...elemente, rest]);
  const kopf = Buffer.from(data.subarray(p.start, p.valStart));
  kopf.writeInt32LE(wert.length, p.sizePos - p.start);
  return Buffer.concat([data.subarray(0, p.start), kopf, wert, data.subarray(p.end)]);
}

/** Eigenschaft entfernen (falls vorhanden) */
export function entferne(data, istEntitaet, name) {
  const z = zerlege(data, istEntitaet);
  const p = z.props.find((x) => x.name === name);
  if (!p) return data;
  return Buffer.concat([data.subarray(0, p.start), data.subarray(p.end)]);
}

/** ObjectProperty-Rohbytes (1.2) */
export function objectProp(name, level, pfad) {
  const wert = Buffer.concat([fstr(level), fstr(pfad)]);
  return Buffer.concat([fstr(name), fstr('ObjectProperty'), i32(0), i32(wert.length), Buffer.from([0]), wert]);
}

/** ObjectProperty setzen: ersetzt vorhandene oder fügt sie als erste Eigenschaft ein */
export function setzeVerweis(data, istEntitaet, name, pfad, level = 'Persistent_Level') {
  const z = zerlege(data, istEntitaet);
  const neu = objectProp(name, level, pfad);
  const p = z.props.find((x) => x.name === name);
  if (p) return Buffer.concat([data.subarray(0, p.start), neu, data.subarray(p.end)]);
  return Buffer.concat([data.subarray(0, z.propsStart), neu, data.subarray(z.propsStart)]);
}

/** Wert (Rohbytes) einer Eigenschaft */
export function wert(data, istEntitaet, name) {
  const p = zerlege(data, istEntitaet).props.find((x) => x.name === name);
  return p ? data.subarray(p.valStart, p.end) : null;
}

/** Alle Vektoren (24-Byte-Doubles) innerhalb der Eigenschaft name in Reihenfolge – Positionen im Puffer */
export function vektorStellen(data, istEntitaet, name, liste) {
  const key = Buffer.from('\x07\x00\x00\x00Vector\x00', 'latin1');
  const out = [];
  if (liste) { // Liste von Vector-Eigenschaften (Struktur-Element)
    for (const x of liste) if (x.size === 24 && x.typ?.kinder?.[0]?.name === 'Vector') out.push(x.valStart);
    return out;
  }
  const p = zerlege(data, istEntitaet).props.find((x) => x.name === name);
  if (!p) return [];
  let q = data.indexOf(key, p.valStart);
  while (q >= 0 && q < p.end) {
    // Vector → 1 Kind "/Script/CoreUObject" (0 Kinder), dann Größe 24 + Flags
    const r = new R(data, q + key.length);
    const n = r.i32();
    for (let k = 0; k < n; k++) r.typ();
    const size = r.i32(); const fl = r.u8(); if (fl & 1) r.i32();
    if (size === 24) out.push(r.p);
    q = data.indexOf(key, r.p + size);
  }
  return out;
}

/** Spline (Punkte mit Location/ArriveTangent/LeaveTangent) überschreiben – Punktanzahl muss gleich bleiben */
export function setzeSpline(data, punkte) {
  const st = vektorStellen(data, true, 'mSplineData');
  if (st.length !== punkte.length * 3) throw new Error(`Spline: Vorlage hat ${st.length / 3} Punkte, gebraucht ${punkte.length}`);
  const out = Buffer.from(data);
  punkte.forEach((pt, k) => {
    [pt.loc, pt.arrive, pt.leave].forEach((v, j) => { const at = st[k * 3 + j]; v.forEach((x, m) => out.writeDoubleLE(x, at + m * 8)); });
  });
  return out;
}

/** UTF-16/ASCII-Text in StrProperty mit Name `feld` innerhalb der n-ten Struktur ersetzen, die `marke` enthält (Schilder) */
export function ersetzeText(data, alt, neu) {
  // sucht fstr(alt) und ersetzt durch fstr(neu); passt umgebende Größenangaben NICHT an → Aufrufer korrigiert Größen
  const a = fstr(alt);
  const at = data.indexOf(a);
  if (at < 0) return null;
  return { data: Buffer.concat([data.subarray(0, at), fstr(neu), data.subarray(at + a.length)]), at, delta: fstr(neu).length - a.length };
}

/** mWires (ArrayProperty aus ObjectProperty) einer PowerConnection setzen – ersetzt vorhandene */
export function setzeDraehte(data, pfade, level = 'Persistent_Level') {
  let d = entferne(data, false, 'mWires');
  if (!pfade.length) return d;
  const wert = Buffer.concat([i32(pfade.length), ...pfade.flatMap((p) => [fstr(level), fstr(p)])]);
  const prop = Buffer.concat([fstr('mWires'), fstr('ArrayProperty'), i32(1), fstr('ObjectProperty'), i32(0), i32(wert.length), Buffer.from([0]), wert]);
  const z = zerlege(d, false);
  return Buffer.concat([d.subarray(0, z.propsStart), prop, d.subarray(z.propsStart)]);
}
