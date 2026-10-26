// Vorräte eines Spielstands für den Material-Check (nur lesen).
//   inventar: Inventar des Spielers (Char_Player)
//   lager:    Dimensionslager (FGCentralStorageSubsystem.mStoredItems: ItemClass + amount)
//   kisten:   Lagerkisten und Uploader (FGInventoryComponent von Build_Storage*/Build_CentralStorage_C: Item + NumItems)
// Beim Bauen nimmt das Spiel aus Inventar und Dimensionslager; Kisten muss man selbst leeren.
import { readSave, shortClass } from './sav.mjs';

// Getaggte Eigenschaften: nach jedem Gegenstands-Pfad folgt als nächste IntProperty die Menge.
//   ab Spiel 1.2 (saveVersion ≥ 53): int32 Anzahl Kind-Typen (0), int32 Größe (4), u8 Flags (Bit 1 → int32 Index)
//   Spiel 1.0/1.1:                   int32 Größe (4), int32 Index, u8 hatGuid (→ 16 Byte Guid)
function gegenstaende(d, add) {
  const txt = d.toString('latin1');
  const re = /\/Game\/[^\0]*?\.(?:Desc_|BP_)[^\0]*?_C\0/g;
  let m;
  while ((m = re.exec(txt))) {
    const ip = txt.indexOf('IntProperty\0', m.index);
    if (ip < 0) break;
    let p = ip + 12;
    const a = d.readInt32LE(p), b = d.readInt32LE(p + 4);
    p += 8;
    if (a === 0 && b === 4) { if (d[p++] & 1) p += 4; } // neu
    else if (a === 4) { if (d[p++]) p += 16; } // alt
    else continue;
    const n = d.readInt32LE(p);
    if (n > 0) add(shortClass(m[0].slice(0, -1)), n);
    re.lastIndex = p;
  }
}

export function vorraeteLesen(buf) {
  const s = readSave(buf, { props: false });
  const b = s.body;
  const out = { inventar: {}, lager: {}, kisten: {}, kistenAnzahl: 0 };
  const zu = (ziel) => (k, n) => { ziel[k] = (ziel[k] || 0) + n; };
  const kisten = new Set();
  for (const o of s.objects) {
    if (o.dBody === undefined) continue;
    if (/FGCentralStorageSubsystem/.test(o.typePath)) { gegenstaende(b.subarray(o.dBody, o.dEnd), zu(out.lager)); continue; }
    if (o.kind !== 0 || !/\.FGInventoryComponent$/.test(o.typePath)) continue;
    const besitzer = (o.pathName.match(/\.(\w+?)_C_\d+\./) || [])[1] || '';
    if (/^Build_(Storage|CentralStorage)/.test(besitzer)) { gegenstaende(b.subarray(o.dBody, o.dEnd), zu(out.kisten)); kisten.add(o.parent || o.pathName.replace(/\.[^.]+$/, '')); }
    else if (/^Char_Player/.test(besitzer)) gegenstaende(b.subarray(o.dBody, o.dEnd), zu(out.inventar));
  }
  out.kistenAnzahl = kisten.size;
  return out;
}
