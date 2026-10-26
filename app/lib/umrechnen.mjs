// Blaupausen-Objekte aus älteren Formaten (33–52, Update 6 bis Spiel 1.1, Unreal bis 5.3) in die Kodierung von Format 60 (Spiel 1.2,
// Unreal 5.4+) umrechnen – damit das Spiel eingefügte Objekte wie aktuelle liest (gemessen 21.10.2026: alte Objekte im
// neuen Spielstand → Schilder-Ladefehler, Endlos-Laden).
//
// Kodierung alt: Name, Typ, Größe, Index, [Struct: Name + GUID16 | Bool: Wert | Byte/Enum: Enumname | Array/Set: innerer Typ |
//   Map: Schlüssel-/Werttyp], Flag-Byte (1 = Index folgt nochmals, 2 = GUID, 4 = Erweiterung, 8 = native Kodierung), Wert. Struktur-Listen mit innerem Kopf.
// Kodierung neu: Name, Typ-Baum (Name + Kinderzahl + Kinder; Strukturen/Enums mit Paketpfad), Größe, Flag-Byte
//   (1 Index, 2 GUID, 8 native Kodierung, 0x10 Bool wahr), Wert. Struktur-Listen ohne inneren Kopf. Vor den Eigenschaften
//   ein Steuerbyte. Typ-Bäume gelernt aus Format-60-Daten (umrechnen-typen.json).
// Inhalt: einzige echte Typänderung mLastEditedBy (Schilder) → weglassen; mBlueprintProxy (alte Designer-Sitzung) → weglassen.
// Vor 1.0 (33–42, gemessen 25.10.2026 an 708 133 Objekten, kein Typwechsel): mBuildTimeStamp und mDidFirstTimeUse gibt es in 60
//   nicht mehr → weglassen; Schild-Layout mActivePrefabLayout (Objektverweis) heißt ab 1.0 mSoftActivePrefabLayout (Paket, Asset, Unterpfad).
// Geprüft an 23 Blaupausen, die es alt und vom Spiel neu gespeichert gibt: 95,5 % der Objekte bytegleich (Rest: andere Inhalte).
import fs from 'node:fs';

export const UMRECHNEN_AB = 33, ZIEL_VERSION = 60;
const T = JSON.parse(fs.readFileSync(new URL('./umrechnen-typen.json', import.meta.url), 'utf8'));
const WEG = new Set(['mLastEditedBy', 'mBlueprintProxy', 'mBuildTimeStamp', 'mDidFirstTimeUse']);
const CORE = new Set(['Vector', 'Rotator', 'Quat', 'LinearColor', 'Color', 'Guid', 'Transform', 'Vector2D', 'Vector4', 'IntPoint', 'IntVector', 'Box', 'DateTime', 'Timespan', 'SoftObjectPath', 'SoftClassPath']);
const NATIV = new Set(['Vector', 'Rotator', 'Quat', 'LinearColor', 'Color', 'Guid', 'Vector2D', 'Vector4', 'IntPoint', 'IntVector', 'Box', 'DateTime', 'Timespan', 'FluidBox', 'InventoryItem', 'RailroadTrackPosition']);

const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const fstr = (s) => (s === '' ? i32(0) : Buffer.concat([i32(s.length + 1), Buffer.from(s + '\0', 'latin1')]));
class R {
  constructor(b, p, e) { this.b = b; this.p = p; this.e = e; }
  i32() { const v = this.b.readInt32LE(this.p); this.p += 4; return v; }
  u8() { return this.b[this.p++]; }
  str() { const n = this.i32(); if (n === 0) return ''; if (n < 0) { const s = this.b.toString('utf16le', this.p, this.p - n * 2 - 2); this.p += -n * 2; return s; } if (n > 65536 || this.p + n > this.e) throw new Error('Text ungültig @' + this.p); const s = this.b.toString('latin1', this.p, this.p + n - 1); this.p += n; return s; }
}
const baumBytes = (t) => Buffer.concat([fstr(t.n), i32(t.kinder.length), ...t.kinder.map(baumBytes)]);
const structBaum = (sn) => T.struct[sn] || { n: sn, kinder: [{ n: CORE.has(sn) ? '/Script/CoreUObject' : '/Script/FactoryGame', kinder: [] }] };
const istNativ = (sn) => (sn in T.nativ ? T.nativ[sn] === 'nativ' : NATIV.has(sn));

/** alte Eigenschaftsliste ab p lesen und neu kodiert zurückgeben (inkl. „None“) */
function liste(b, p, e, oben) {
  const r = new R(b, p, e), teile = [];
  for (;;) {
    const name = r.str(); if (name === 'None') { teile.push(fstr('None')); return { buf: Buffer.concat(teile), ende: r.p }; }
    const typ = r.str(), groesse = r.i32(), idx = r.i32();
    let sn = null, en = null, inner = null, key = null, val = null, boolWert = 0;
    if (typ === 'StructProperty') { sn = r.str(); r.p += 16; } else if (typ === 'BoolProperty') boolWert = r.u8();
    else if (typ === 'ByteProperty' || typ === 'EnumProperty') en = r.str();
    else if (typ === 'ArrayProperty' || typ === 'SetProperty') inner = r.str();
    else if (typ === 'MapProperty') { key = r.str(); val = r.str(); }
    const fl = r.u8(); let guid = null; if (fl & 1) r.i32(); if (fl & 2) { guid = b.subarray(r.p, r.p + 16); r.p += 16; } if (fl & 4) r.u8(); // UE5-Flags: 1 Index nochmals, 2 GUID, 4 Erweiterung
    const wert = b.subarray(r.p, r.p + groesse); r.p += groesse;
    if (r.p > e) throw new Error(`Eigenschaft ${name}: Größe passt nicht`);
    if (oben && WEG.has(name)) continue;
    if (oben && name === 'mActivePrefabLayout' && typ === 'ObjectProperty') { // Schild-Layout vor 1.0: Level + Pfad „Paket.Klasse“ → weicher Verweis
      const w = new R(wert, 0, wert.length); w.str(); const pfad = w.str(), punkt = pfad.lastIndexOf('.');
      if (punkt > 0) { const v = Buffer.concat([fstr(pfad.slice(0, punkt)), fstr(pfad.slice(punkt + 1)), fstr('')]);
        teile.push(fstr('mSoftActivePrefabLayout'), baumBytes({ n: 'SoftObjectProperty', kinder: [] }), i32(v.length), Buffer.from([0]), v); }
      continue;
    }
    let baum, neuWert = wert, flags = 0;
    if (typ === 'StructProperty') {
      baum = { n: typ, kinder: [structBaum(sn)] };
      if (istNativ(sn)) flags |= 8; else neuWert = liste(wert, 0, wert.length, false).buf;
    } else if (typ === 'ArrayProperty' || typ === 'SetProperty') {
      if (inner === 'StructProperty') { // alter innerer Kopf vor den Elementen fällt weg
        const n = wert.readInt32LE(0), r2 = new R(wert, 4, wert.length); r2.str(); r2.str(); r2.i32(); r2.i32(); const isn = r2.str(); r2.p += 16; const ifl = r2.u8(); if (ifl & 1) r2.i32(); if (ifl & 2) r2.p += 16; if (ifl & 4) r2.u8();
        baum = { n: typ, kinder: [{ n: 'StructProperty', kinder: [structBaum(isn)] }] };
        const el = [i32(n)]; let q = r2.p;
        if (istNativ(isn)) el.push(wert.subarray(q)); else for (let i = 0; i < n; i++) { const u = liste(wert, q, wert.length, false); el.push(u.buf); q = u.ende; }
        neuWert = Buffer.concat(el);
      } else baum = T.prop[name + '|' + typ] || { n: typ, kinder: [{ n: inner, kinder: [] }] };
    } else if (typ === 'MapProperty') {
      if (key === 'StructProperty' || val === 'StructProperty') { if (oben) continue; throw new Error(`Map mit Struktur (${name}) wird nicht umgerechnet`); } // oben: weglassen (z. B. Fahrzeug-Statistik)
      baum = T.prop[name + '|' + typ] || { n: typ, kinder: [{ n: key, kinder: [] }, { n: val, kinder: [] }] };
    } else if (typ === 'ByteProperty' || typ === 'EnumProperty') {
      const eb = en && en !== 'None' ? (T.enum[en] || { n: en, kinder: [{ n: '/Script/FactoryGame', kinder: [] }] }) : null;
      baum = typ === 'EnumProperty' ? { n: typ, kinder: [eb, { n: 'ByteProperty', kinder: [] }].filter(Boolean) } : { n: typ, kinder: eb ? [eb] : [] };
    } else if (typ === 'BoolProperty') { baum = { n: typ, kinder: [] }; if (boolWert) flags |= 0x10; }
    else baum = { n: typ, kinder: [] };
    if (idx) flags |= 1; if (guid) flags |= 2;
    teile.push(fstr(name), baumBytes(baum), i32(neuWert.length), Buffer.from([flags]), ...(idx ? [i32(idx)] : []), ...(guid ? [guid] : []), neuWert);
  }
}

/**
 * Datenstück eines Blaupausen-Objekts (int32 Größe + Daten) alt → neu.
 * Akteur: Besitzer (2 Texte), Komponenten (Anzahl + je 2 Texte), [neu: Steuerbyte], Eigenschaften, Rest.
 * Komponente: [neu: Steuerbyte], Eigenschaften, Rest.
 */
export function objektUmrechnen(data, istAkteur) {
  let kopfEnde = 4;
  if (istAkteur) { const r = new R(data, 4, data.length); r.str(); r.str(); const n = r.i32(); for (let i = 0; i < n; i++) { r.str(); r.str(); } kopfEnde = r.p; }
  const u = liste(data, kopfEnde, data.length, true);
  const neu = Buffer.concat([i32(0), data.subarray(4, kopfEnde), Buffer.from([0]), u.buf, data.subarray(u.ende)]);
  neu.writeInt32LE(neu.length - 4, 0);
  return neu;
}

/** ganzes Muster (ladeMuster) umrechnen; liefert Anzahl umgerechneter Objekte. Wirft bei Unbekanntem (dann lieber nicht setzen). */
export function musterUmrechnen(m) {
  if (m.version >= ZIEL_VERSION || m.version < UMRECHNEN_AB) return 0;
  let n = 0;
  for (const x of m.objs) { x.data = objektUmrechnen(x.data, x.o.kind === 'entity'); n++; }
  m.altVersion = m.version; m.version = ZIEL_VERSION;
  return n;
}
