// Blaupausen-Kategorien im Spiel (Bauplan-Menü): das Spiel speichert sie je Spielstand im Objekt „BlueprintSubsystem“
// (Persistent_Level) als Eigenschaft mBlueprintCategoryRecords – Zuordnung über Blaupausen-Namen:
//   BlueprintCategoryRecord   { CategoryName Str, IconID Int, MenuPriority Float, IsUndefined Bool (Wert im Flag-Byte 0x10),
//                               SubCategoryRecords Array<BlueprintSubCategoryRecord> }
//   BlueprintSubCategoryRecord { SubCategoryName Str, MenuPriority Float, IsUndefined Byte, BlueprintNames Array<Str> }
// MenuPriority ist die Position (0, 1, 2 … ohne Lücken – sonst bleiben Unterkategorien leer). lastEditedBy (neuere Spielstände)
// darf fehlen. Im Spiel getestet (19.10.2026). Hier: lesen und einen geänderten Spielstand erzeugen.
import zlib from 'node:zlib';
import { readSave } from './sav.mjs';

const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const f32 = (v) => { const b = Buffer.alloc(4); b.writeFloatLE(v); return b; };
const fstr = (s) => (/^[\x00-\x7f]*$/.test(s) ? Buffer.concat([i32(s.length + 1), Buffer.from(s + '\0', 'latin1')]) : Buffer.concat([i32(-(s.length + 1)), Buffer.from(s + '\0', 'utf16le')]));
const typ = (name, ...kinder) => Buffer.concat([fstr(name), i32(kinder.length), ...kinder]);
const prop = (name, typBuf, wert, flags = 0) => Buffer.concat([fstr(name), typBuf, i32(wert.length), Buffer.from([flags]), wert]);
const NONE = fstr('None');
const T_STR = typ('StrProperty'), T_INT = typ('IntProperty'), T_FLOAT = typ('FloatProperty'), T_BOOL = typ('BoolProperty'), T_BYTE = typ('ByteProperty');
const T_CAT = typ('ArrayProperty', typ('StructProperty', typ('BlueprintCategoryRecord', typ('/Script/FactoryGame'))));
const T_SUB = typ('ArrayProperty', typ('StructProperty', typ('BlueprintSubCategoryRecord', typ('/Script/FactoryGame'))));
const T_NAMEN = typ('ArrayProperty', typ('StrProperty'));
export const SYMBOL_STANDARD = 350; // Haus

/** Objektdaten des BlueprintSubsystem zerlegen: { kategorien, prop:{start,end}|null, noneStart } */
function zerlegen(d) {
  let p = 0;
  const r32 = () => { const v = d.readInt32LE(p); p += 4; return v; };
  const rstr = () => { const n = r32(); if (!n) return ''; if (n < 0) { const t = d.toString('utf16le', p, p - n * 2 - 2); p += -n * 2; return t; } const t = d.toString('latin1', p, p + n - 1); p += n; return t; };
  const rtyp = () => { const name = rstr(); const n = r32(); const k = []; for (let j = 0; j < n; j++) k.push(rtyp()); return { name, k }; };
  const rprops = () => {
    const out = [];
    for (;;) {
      const start = p, name = rstr(); if (name === 'None') break;
      const t = rtyp(), size = r32(), flags = d[p++]; if (flags & 1) r32();
      const vs = p; let wert;
      if (t.name === 'StrProperty') wert = rstr();
      else if (t.name === 'IntProperty') wert = d.readInt32LE(p);
      else if (t.name === 'FloatProperty') wert = d.readFloatLE(p);
      else if (t.name === 'ByteProperty') wert = d[p];
      else if (t.name === 'BoolProperty') wert = !!(flags & 0x10);
      else if (t.name === 'ArrayProperty' && t.k[0]?.name === 'StrProperty') { const n = r32(); wert = []; for (let j = 0; j < n; j++) wert.push(rstr()); }
      else if (t.name === 'ArrayProperty' && t.k[0]?.name === 'StructProperty') { const n = r32(); wert = []; for (let j = 0; j < n; j++) wert.push(rprops()); }
      p = vs + size;
      out.push({ name, start, end: p, wert });
    }
    return out;
  };
  rstr(); rstr(); { const n = r32(); for (let j = 0; j < n; j++) { rstr(); rstr(); } } // Entität: Eltern, Komponenten
  p++; // u8 0
  const liste = rprops();
  const noneStart = p - 9;
  const v = liste.find((x) => x.name === 'mBlueprintCategoryRecords');
  const get = (props, n) => props.find((x) => x.name === n)?.wert;
  const kategorien = (v?.wert || []).map((c) => ({
    name: get(c, 'CategoryName') || '', icon: get(c, 'IconID') ?? -1, prio: get(c, 'MenuPriority') ?? 0, undef: !!get(c, 'IsUndefined'),
    subs: (get(c, 'SubCategoryRecords') || []).map((s) => ({ name: get(s, 'SubCategoryName') || '', prio: get(s, 'MenuPriority') ?? 0, undef: get(s, 'IsUndefined') ?? 0, namen: get(s, 'BlueprintNames') || [] })),
  }));
  return { kategorien, prop: v ? { start: v.start, end: v.end } : null, noneStart };
}

function bsObjekt(save) {
  const o = save.objects.find((x) => x.kind === 1 && /\.BlueprintSubsystem$/.test(x.pathName));
  if (!o || o.dBody === undefined) throw new Error('Im Spielstand fehlt das Blaupausen-Subsystem (Spielstand zu alt?).');
  return o;
}

/** Kategorien eines Spielstands lesen */
export function kategorienLesen(buf) {
  const save = readSave(buf, { props: false });
  const o = bsObjekt(save);
  return zerlegen(save.body.subarray(o.dBody, o.dEnd)).kategorien;
}

/**
 * Neuen Spielstand-Inhalt mit gesetzten Kategorien erzeugen.
 * zuordnung: [{ name, kategorie, unterkategorie, kSort, uSort }] – nur diese Blaupausen werden (um)sortiert.
 * vorhanden: Set der Blaupausen-Namen im Sitzungsordner (Namen, die es dort nicht mehr gibt, fliegen aus den Listen).
 * leerWeg: Set von Kategorienamen, die entfernt werden dürfen, wenn sie leer sind (die von der App angelegten).
 * symbole: { Kategoriename: IconID } für neue Kategorien.
 * rang: { Kategoriename: Zahl, 'Kategorie/Unterkategorie': Zahl } – Reihenfolge der Ablage-Struktur.
 * unbestimmtName: Name der Sammel-Kategorie, falls der Spielstand noch keine Einteilung hat (Sprache der App).
 * anlegen: [{ kategorie, unterkategorien: [] }] – auch ohne Blaupausen anlegen (z. B. zum Symbole-Wählen im Spiel).
 * Liefert { ausgabe, kategorien, symbole } (symbole = Symbole aller vorhandenen Kategorien, zum Merken).
 */
export function kategorienSchreiben(buf, header, { zuordnung, vorhanden, leerWeg = new Set(), symbole = {}, rang = {}, anlegen = [], unbestimmtName = 'Unbestimmt' }) {
  const save = readSave(buf, { props: false });
  const { body, objects } = save;
  const o = bsObjekt(save);
  const alt = body.subarray(o.dBody, o.dEnd);
  const z = zerlegen(alt);
  const kategorien = z.kategorien;
  const gelernt = {};
  for (const c of kategorien) if (!c.undef && c.name && c.icon >= 0) gelernt[c.name] = c.icon;
  // Kategorien mit der Vorgabe (Haus) bekommen das gemerkte Symbol; im Spiel selbst gewählte bleiben
  for (const c of kategorien) if (!c.undef && c.icon === SYMBOL_STANDARD && symbole[c.name] != null) c.icon = symbole[c.name];

  let unbestimmt = kategorien.find((c) => c.undef);
  if (!unbestimmt) { unbestimmt = { name: unbestimmtName, icon: -1, prio: 0, undef: true, subs: [] }; kategorien.unshift(unbestimmt); }
  if (!unbestimmt.subs.length) unbestimmt.subs.push({ name: unbestimmtName, prio: 0, undef: 1, namen: [] });
  // Namen, die es im Sitzungsordner nicht (mehr) gibt, entfernen; neu zugeordnete aus ihren bisherigen Listen nehmen
  const neuZu = new Set(zuordnung.map((x) => x.name));
  for (const c of kategorien) for (const s of c.subs) s.namen = s.namen.filter((n) => vorhanden.has(n) && !neuZu.has(n));
  for (const x of zuordnung) {
    let k = kategorien.find((c) => !c.undef && c.name === x.kategorie);
    if (!k) { k = { name: x.kategorie, icon: symbole[x.kategorie] ?? SYMBOL_STANDARD, prio: 0, undef: false, subs: [], sort: x.kSort }; kategorien.push(k); }
    k.sort ??= x.kSort;
    let s = k.subs.find((u) => u.name === x.unterkategorie);
    if (!s) { s = { name: x.unterkategorie, prio: 0, undef: 0, namen: [], sort: x.uSort }; k.subs.push(s); }
    s.sort ??= x.uSort;
    s.namen.push(x.name);
  }
  for (const a of anlegen) {
    let k = kategorien.find((c) => !c.undef && c.name === a.kategorie);
    if (!k) { k = { name: a.kategorie, icon: symbole[a.kategorie] ?? SYMBOL_STANDARD, prio: 0, undef: false, subs: [] }; kategorien.push(k); }
    for (const u of a.unterkategorien || []) if (!k.subs.some((x) => x.name === u)) k.subs.push({ name: u, prio: 0, undef: 0, namen: [] });
  }
  // Blaupausen im Ordner, die nirgends stehen, sieht das Spiel als „Unbestimmt“ – dort ergänzen
  const gelistet = new Set(kategorien.flatMap((c) => c.subs.flatMap((s) => s.namen)));
  for (const n of vorhanden) if (!gelistet.has(n)) unbestimmt.subs[0].namen.push(n);
  // leere App-Unterkategorien/-Kategorien entfernen, eigene des Spielers bleiben
  for (const c of kategorien) if (!c.undef && leerWeg.has(c.name)) c.subs = c.subs.filter((s) => s.namen.length);
  const bleiben = kategorien.filter((c) => c.undef || c.subs.length || !leerWeg.has(c.name));
  // Reihenfolge: Unbestimmt, dann vorhandene in ihrer Reihenfolge, neue nach Gruppen-Nummer; Positionen 0…n−1
  for (const c of bleiben) { c.sort = rang[c.name] ?? c.sort; for (const u of c.subs) u.sort = rang[`${c.name}/${u.name}`] ?? u.sort; }
  const ord = (a, b) => (a.sort ?? -1) - (b.sort ?? -1) || a.prio - b.prio;
  bleiben.sort((a, b) => (b.undef - a.undef) || ord(a, b));
  bleiben.forEach((c, i) => { c.prio = i; c.subs.sort(ord); c.subs.forEach((s, j) => { s.prio = j; s.namen.sort((x, y) => x.localeCompare(y, 'de', { numeric: true })); }); });

  const subBuf = (s) => Buffer.concat([
    prop('SubCategoryName', T_STR, fstr(s.name)), prop('MenuPriority', T_FLOAT, f32(s.prio)), prop('IsUndefined', T_BYTE, Buffer.from([s.undef ? 1 : 0])),
    prop('BlueprintNames', T_NAMEN, Buffer.concat([i32(s.namen.length), ...s.namen.map(fstr)])), NONE]);
  const catBuf = (c) => Buffer.concat([
    prop('CategoryName', T_STR, fstr(c.name)), prop('IconID', T_INT, i32(c.icon)), prop('MenuPriority', T_FLOAT, f32(c.prio)),
    prop('IsUndefined', T_BOOL, Buffer.alloc(0), c.undef ? 0x10 : 0),
    prop('SubCategoryRecords', T_SUB, Buffer.concat([i32(c.subs.length), ...c.subs.map(subBuf)])), NONE]);
  const neueProp = prop('mBlueprintCategoryRecords', T_CAT, Buffer.concat([i32(bleiben.length), ...bleiben.map(catBuf)]));
  const neu = z.prop ? Buffer.concat([alt.subarray(0, z.prop.start), neueProp, alt.subarray(z.prop.end)])
    : Buffer.concat([alt.subarray(0, z.noneStart), neueProp, alt.subarray(z.noneStart)]);

  // Längen nachführen: Objektgröße (int32 vor den Daten), Datenlänge des Levels (int64), Gesamtlänge (int64 am Anfang)
  if (body.readBigInt64LE(0) !== BigInt(body.length - 8)) throw new Error('Spielstand: Gesamtlänge unerwartet');
  if (body.readInt32LE(o.dBody - 4) !== alt.length) throw new Error('Spielstand: Objektgröße unerwartet');
  const erstes = objects.find((x) => x.level === o.level && x.dBody !== undefined);
  const levelLaenge = erstes.dBody - 12 - 4 - 8;
  const delta = neu.length - alt.length;
  const neuBody = Buffer.concat([body.subarray(0, o.dBody), neu, body.subarray(o.dEnd)]);
  neuBody.writeInt32LE(neu.length, o.dBody - 4);
  neuBody.writeBigInt64LE(body.readBigInt64LE(levelLaenge) + BigInt(delta), levelLaenge);
  neuBody.writeBigInt64LE(BigInt(neuBody.length - 8), 0);

  // Packen wie das Spiel: Blöcke zu 128 KiB, zlib; Kopf unverändert
  const teile = [buf.subarray(0, header.headerLength)];
  for (let q = 0; q < neuBody.length; q += 131072) {
    const roh = neuBody.subarray(q, Math.min(q + 131072, neuBody.length));
    const zz = zlib.deflateSync(roh);
    const k = Buffer.alloc(49);
    k.writeUInt32LE(0x9E2A83C1, 0); k.writeUInt32LE(0x22222222, 4); k.writeBigInt64LE(131072n, 8); k[16] = 3;
    k.writeBigInt64LE(BigInt(zz.length), 17); k.writeBigInt64LE(BigInt(roh.length), 25); k.writeBigInt64LE(BigInt(zz.length), 33); k.writeBigInt64LE(BigInt(roh.length), 41);
    teile.push(k, zz);
  }
  const ausgabe = Buffer.concat(teile);

  // Selbstprüfung: neu einlesen, Objektzahl gleich, Subsystem wie geschrieben, Stichprobe der übrigen Objekte unverändert
  const pr = readSave(ausgabe, { props: false });
  if (pr.objects.length !== objects.length) throw new Error('Selbstprüfung: Objektanzahl weicht ab');
  const o2 = pr.objects.find((x) => x.pathName === o.pathName);
  if (!pr.body.subarray(o2.dBody, o2.dEnd).equals(neu)) throw new Error('Selbstprüfung: Blaupausen-Subsystem nicht wie geschrieben');
  for (let k = 0; k < objects.length; k += Math.max(1, Math.floor(objects.length / 5000))) {
    const a = objects[k], b = pr.objects[k];
    if (a === o) continue;
    if (a.pathName !== b.pathName || !body.subarray(a.dBody, a.dEnd).equals(pr.body.subarray(b.dBody, b.dEnd))) throw new Error('Selbstprüfung: Objekt verändert ' + a.pathName);
  }
  return { ausgabe, kategorien: bleiben.map((c) => ({ name: c.name, undef: c.undef, icon: c.icon, subs: c.subs.map((s) => ({ name: s.name, anzahl: s.namen.length })) })), symbole: gelernt };
}
