// Objekte (aus Blaupausen-Mustern erzeugt) in einen Spielstand einfügen – als neue Akteure im Haupt-Level (Persistent_Level).
//
// Gemessen 21.10.2026 an Tims Panem_autosave_0 (Spiel 1.2, Save-Version 60): Inhalte des Blaupausen-Designers liegen dort als
// vollständige Akteure derselben Klassen (Wand, Träger, Fundament …) mit denselben Eigenschaften wie in der Blaupause
// (im Spielstand zusätzlich ein Designer-Verweis). Kopf eines Objekts in Blaupause und Spielstand gleich aufgebaut:
//   int32 Typ, Klasse, Level-Name, Instanzname, int32 Flags, [Akteur: int32 needTransform, 10 float, int32 placed | Komponente: Eltern]
// Datenblock im Spielstand je Objekt: int32 Version, int32 Flag (0), int32 Größe, Daten, ab Version 53 int32 0.
// Blaupause: int32 Größe, Daten. Längen werden nachgeführt wie beim Schreiben der Bauplan-Kategorien (spielkategorien.mjs).
import zlib from 'node:zlib';
import { readSave, readSavHeader } from './sav.mjs';

const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const fstr = (s) => (s ? Buffer.concat([i32(s.length + 1), Buffer.from(s + '\0', 'latin1')]) : i32(0));

/** Lage der Blöcke des Haupt-Levels im entpackten Body (gleiche Leselogik wie sav.mjs) */
export function hauptLevel(s) {
  const pl = s.levels.length - 1, P = s.objects.filter((o) => o.level === pl);
  if (!P.length || P.some((o) => o.dBody === undefined)) throw new Error('Spielstand: Haupt-Level ohne lesbare Objektdaten');
  const b = s.body, erstes = P[0], letztes = P.at(-1);
  // Datenblock: int64 Länge, int32 Anzahl, Einträge … – das erste Objekt beginnt 12 Byte vor seinen Daten (Version, Flag, Größe)
  const datenAnzahlPos = erstes.dBody - 12 - 4, datenLaengePos = datenAnzahlPos - 8;
  if (b.readInt32LE(datenAnzahlPos) !== P.length) throw new Error('Spielstand: Anzahl der Objektdaten unerwartet');
  const datenEnde = letztes.dEnd + (letztes.ver >= 53 ? 4 : 0);
  const datenBlockEnde = datenAnzahlPos + Number(b.readBigInt64LE(datenLaengePos));
  // Kopfblock: liegt direkt vor dem Datenblock; int64 Länge, int32 Anzahl, Köpfe, Sammelobjekte
  // Anfang über die gespeicherte Länge rückwärts suchen: Länge L bei Position q mit q + 8 + L == datenLaengePos
  let kopfLaengePos = -1;
  for (let q = datenLaengePos - 12; q > 0 && datenLaengePos - q < 512 * 1024 * 1024; q--) {
    if (Number(b.readBigInt64LE(q)) === datenLaengePos - q - 8 && b.readInt32LE(q + 8) === P.length) { kopfLaengePos = q; break; }
  }
  if (kopfLaengePos < 0) throw new Error('Spielstand: Kopfblock des Haupt-Levels nicht gefunden');
  // Ende der Köpfe = Anfang der Sammelobjekte: Köpfe einzeln überspringen
  let p = kopfLaengePos + 12;
  const str = () => { const n = b.readInt32LE(p); p += 4 + (n < 0 ? -n * 2 : n); };
  const mitFlags = s.header.saveVersion >= 46, koepfe = [];
  for (let k = 0; k < P.length; k++) {
    const a = p, typ = b.readInt32LE(p); p += 4; str(); str(); str(); if (mitFlags) p += 4;
    const tf = p + 4; // Akteur: Transform (4 rot, 3 pos, 3 scale float) nach needTransform
    if (typ === 1) p += 4 + 40 + 4; else str();
    koepfe.push({ a, e: p, tf: typ === 1 ? tf : -1 });
  }
  return { P, koepfe, kopfLaengePos, kopfEnde: p, datenLaengePos, datenAnzahlPos, datenEnde, datenBlockEnde };
}

/** Entpackten Body wie das Spiel packen (Blöcke zu 128 KiB, zlib), Kopf vom Original mit neuem Speichernamen */
export function packeSpielstand(buf, header, neu, speichername) {
  const teile = [kopfMitName(buf, header, speichername)];
  for (let q = 0; q < neu.length; q += 131072) {
    const roh = neu.subarray(q, Math.min(q + 131072, neu.length)), zz = zlib.deflateSync(roh), k = Buffer.alloc(49);
    k.writeUInt32LE(0x9E2A83C1, 0); k.writeUInt32LE(0x22222222, 4); k.writeBigInt64LE(131072n, 8); k[16] = 3;
    k.writeBigInt64LE(BigInt(zz.length), 17); k.writeBigInt64LE(BigInt(roh.length), 25); k.writeBigInt64LE(BigInt(zz.length), 33); k.writeBigInt64LE(BigInt(roh.length), 41);
    teile.push(k, zz);
  }
  return Buffer.concat(teile);
}

/** Spielstand-Kopf mit neuem Speichernamen (Text an Position 12) */
function kopfMitName(buf, header, name) {
  if (!name) return buf.subarray(0, header.headerLength);
  const n = buf.readInt32LE(12), alt = 16 + (n < 0 ? -n * 2 : n);
  return Buffer.concat([buf.subarray(0, 12), fstr(name), buf.subarray(alt, header.headerLength)]);
}

/**
 * objs = [{ head, data }] wie von strasse.mjs baueObjekte (Blaupausen-Format, Weltkoordinaten). Liefert den neuen Spielstand.
 * Prüft vorher: Spielstand-Version = Muster-Version, keine doppelten Instanznamen; nachher: neu einlesen, alles Alte unverändert.
 */
export function objekteEinfuegen(buf, objs, { musterVersion, speichername } = {}) {
  const header = readSavHeader(buf);
  if (musterVersion && musterVersion > header.saveVersion) throw Object.assign(new Error(`Muster (Version ${musterVersion}) und Spielstand (Version ${header.saveVersion}) passen nicht zusammen – bitte Muster im aktuellen Spiel neu speichern.`), { status: 422 });
  const s = readSave(buf, { props: false }), b = s.body;
  if (b.readBigInt64LE(0) !== BigInt(b.length - 8)) throw new Error('Spielstand: Gesamtlänge unerwartet');
  const L = hauptLevel(s);
  const vorhanden = new Set(s.objects.map((o) => o.pathName));
  const ver = L.P.at(-1).ver;
  const koepfe = [], daten = [];
  for (const o of objs) {
    // Instanzname aus dem Kopf lesen (nach Typ und zwei Texten) und auf Doppel prüfen
    let p = 4; for (let k = 0; k < 2; k++) { const n = o.head.readInt32LE(p); p += 4 + n; }
    const n = o.head.readInt32LE(p), inst = o.head.toString('latin1', p + 4, p + 3 + n);
    if (vorhanden.has(inst)) throw new Error(`Objektname schon im Spielstand: ${inst}`);
    vorhanden.add(inst);
    koepfe.push(o.head);
    const nutz = o.data.subarray(4, 4 + o.data.readInt32LE(0));
    // Objekt-Version je Objekt (ältere Muster, z. B. 1.1-Blaupausen, behalten ihr Format – wie alte Objekte im Spielstand)
    const v = o.ver ?? ver;
    if (v > header.saveVersion) throw Object.assign(new Error(`Muster-Objekt (Version ${v}) neuer als der Spielstand (${header.saveVersion}).`), { status: 422 });
    daten.push(i32(v), i32(0), i32(nutz.length), nutz, ...(v >= 53 ? [i32(0)] : []));
  }
  const kBuf = Buffer.concat(koepfe), dBuf = Buffer.concat(daten);
  if (L.datenEnde !== L.datenBlockEnde) throw new Error('Spielstand: nach den Objektdaten des Haupt-Levels folgt Unerwartetes');
  const neu = Buffer.concat([b.subarray(0, L.kopfEnde), kBuf, b.subarray(L.kopfEnde, L.datenEnde), dBuf, b.subarray(L.datenEnde)]);
  const verschub = kBuf.length; // alles hinter den Köpfen rückt um kBuf.length nach hinten
  neu.writeBigInt64LE(b.readBigInt64LE(L.kopfLaengePos) + BigInt(kBuf.length), L.kopfLaengePos);
  neu.writeInt32LE(L.P.length + objs.length, L.kopfLaengePos + 8);
  neu.writeBigInt64LE(b.readBigInt64LE(L.datenLaengePos) + BigInt(dBuf.length), L.datenLaengePos + verschub);
  neu.writeInt32LE(L.P.length + objs.length, L.datenAnzahlPos + verschub);
  neu.writeBigInt64LE(BigInt(neu.length - 8), 0);

  const ausgabe = packeSpielstand(buf, header, neu, speichername);

  // Selbstprüfung: neu einlesen, alte Objekte unverändert, neue vollständig da
  const pr = readSave(ausgabe, { props: false });
  if (pr.objects.length !== s.objects.length + objs.length) throw new Error('Selbstprüfung: Objektanzahl weicht ab');
  for (let k = 0; k < s.objects.length; k++) {
    const a = s.objects[k], c = pr.objects[k];
    if (a.pathName !== c.pathName || (a.dBody !== undefined && !b.subarray(a.dBody, a.dEnd).equals(pr.body.subarray(c.dBody, c.dEnd)))) throw new Error('Selbstprüfung: Objekt verändert ' + a.pathName);
  }
  // Haupt-Level ist das letzte – die neuen Objekte stehen am Ende der Liste
  const neuGelesen = pr.objects.slice(s.objects.length);
  if (neuGelesen.some((o, k) => o.dBody === undefined || o.dEnd - o.dBody !== objs[k].data.readInt32LE(0))) throw new Error('Selbstprüfung: neue Objekte unvollständig');
  return { ausgabe, info: { eingefuegt: objs.length, vorher: s.objects.length, nachher: pr.objects.length, groesseMB: +(ausgabe.length / 1e6).toFixed(1) } };
}
