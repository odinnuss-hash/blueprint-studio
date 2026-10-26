// „Karte -> Blaupause“: einen Bereich aus einem Spielstand als Blaupause (.sbp) herauskopieren.
//
// - Normale Gebaeude (Maschinen, Baender, Rohre, Lager, Schilder …) werden 1:1 mit ihren Daten und
//   Bestandteilen (Anschluesse, Lager, Stromanschluss …) uebernommen – Rezepte, Einstellungen und
//   Verbindungen innerhalb des Bereichs bleiben erhalten. Objekte und Blaupausen speichern ihre Daten
//   im selben Format; die Verweise (Persistent_Level:PersistentLevel.…) bleiben gueltig.
// - Leichtbau-Teile (Fundamente, Waende, Saeulen, Traeger …) gibt es im Spielstand nur als Sammelliste;
//   sie werden aus Vorlagen (eigene Blaupausen) neu aufgebaut. Traegerlaenge wird uebernommen, Farbe/Muster nicht.
// - Stromleitungen nur, wenn beide Enden im Bereich liegen (ihre Endpunkte werden mitverschoben).
// - Alles wird so verschoben, dass die Mitte des Bereichs (auf 8 m gerundet) bei 0 und die Unterkante bei 0 liegt.

import { readSave, readLightweight } from './sav.mjs';
import { zerlege } from './eigenschaften.mjs';
import { createBlueprint, readBlueprint } from './sbp.mjs';
import { templateFor, makeHead, newInstance } from './vorlagen.mjs';

const kurz = (p) => { const m = /\.([A-Za-z0-9_]+)$/.exec(p || ''); return m ? m[1] : (p || ''); };
const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const fstr = (s) => (s ? Buffer.concat([i32(Buffer.byteLength(s, 'latin1') + 1), Buffer.from(s + '\0', 'latin1')]) : i32(0));
// nicht in Blaupausen: Hilfsobjekte, Fahrzeuge, Spieler
const RX_OHNE = /^Build_(PowerLine_C|.*Hologram|BlueprintDesigner)|Proxy|Subsystem/;

/** Positionen der Vektor-Werte einer Eigenschaft (z. B. "Locations") im Objekt – fuer das Verschieben von Weltkoordinaten */
function vektorStellen(body, s, e, name) {
  const out = [];
  const txt = body.toString('latin1', s, e);
  const tag = String.fromCharCode(name.length + 1) + '\x00\x00\x00' + name + '\x00';
  let q = 0;
  while ((q = txt.indexOf(tag, q)) >= 0) {
    const vec = txt.indexOf('\x07\x00\x00\x00Vector\x00', q);
    if (vec < 0) break;
    let p = s + vec + 11, size;
    if (body.readInt32LE(p) === 1 && body.readInt32LE(p + 4) === 20) { p += 8 + 20 + 4; size = body.readInt32LE(p); const fl = body[p + 4]; p += 5; if (fl & 1) p += 4; }
    else { size = body.readInt32LE(s + vec - 8); p += 17; }
    if (size === 24) out.push(p);
    q = vec + 11;
  }
  return out;
}

function traegerLaenge(typed) {
  if (!typed) return null;
  const n = typed.indexOf('BeamLength\0', 0, 'latin1');
  const none = typed.lastIndexOf('None\0', typed.length, 'latin1');
  if (n < 0 || none < 8) return null;
  const v = typed.readFloatLE(none - 4 - 4);
  return v > 0 && v < 1e6 ? v : null;
}
function setzeLaenge(content, len) {
  const txt = content.toString('latin1');
  const ml = txt.indexOf('mLength\0');
  if (ml < 0 || !txt.startsWith('FloatProperty\0', ml + 12)) return content;
  const out = Buffer.from(content);
  const at = ml + 12 + 14 + 9;
  if (at + 4 <= out.length) out.writeFloatLE(len, at);
  return out;
}

/**
 * bereich: { x0, y0, x1, y1, z0?, z1? } in cm (Welt), ohne: Set mit Klassen, die ausgeblendet sind
 * auswahl: statt Bereich genau diese Teile { a: Set(Akteur-Pfade), l: Map(Leichtbau-Klasse → Set(Nr.)) } (Stift in der Welt, auch verdeckte)
 * Liefert { datei: Buffer, cfg?, info }
 */
export function bereichAlsBlaupause(savBuf, bereich, { lib, kat, ohne = new Set(), log = () => {}, weltkoordinaten = false, leichtbauAlsAkteure = true, auswahl = null }) {
  const save = readSave(savBuf, { props: false });
  const { header, body, objects } = save;
  const ver = header.saveVersion;
  const basis = lib.basen?.[String(ver)] || (lib.basis?.saveVersion === ver ? lib.basis : null);
  if (!basis) throw Object.assign(new Error(`Für Spielversion ${ver} gibt es keine Blaupause als Vorlage. Bitte mindestens eine Blaupause aus dieser Spielversion im Blaupausen-Ordner haben.`), { status: 422 });
  let x0 = Math.min(bereich.x0, bereich.x1), x1 = Math.max(bereich.x0, bereich.x1), y0 = Math.min(bereich.y0, bereich.y1), y1 = Math.max(bereich.y0, bereich.y1);
  const zMin = Number.isFinite(bereich.z0) ? bereich.z0 : -Infinity, zMax = Number.isFinite(bereich.z1) ? bereich.z1 : Infinity;
  // Freihand-Bereich (Stift): Punkt-in-Polygon zusaetzlich zum umgebenden Rechteck
  const poly = Array.isArray(bereich.poly) && bereich.poly.length >= 3 ? bereich.poly : null;
  const imPoly = (x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const drin = (p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1 && p[2] >= zMin && p[2] <= zMax && (!poly || imPoly(p[0], p[1]));

  // 1. normale Gebaeude im Bereich
  const gewaehlt = [], namen = new Set();
  let falscheVersion = 0;
  for (const o of objects) {
    if (o.kind !== 1 || o.dBody === undefined) continue;
    const cls = kurz(o.typePath);
    if (!cls.startsWith('Build_') || RX_OHNE.test(cls) || ohne.has(cls) || !(auswahl ? auswahl.a.has(o.pathName) : drin(o.pos))) continue;
    if (o.ver !== ver) { falscheVersion++; continue; }
    gewaehlt.push(o); namen.add(o.pathName);
  }
  // Stromleitungen: beide Enden muessen in der Auswahl liegen
  const leitungen = [];
  if (!ohne.has('Build_PowerLine_C')) {
    for (const o of objects) {
      if (o.kind !== 1 || !/Build_PowerLine_C$/.test(o.typePath) || o.dBody === undefined || o.ver !== ver) continue;
      const txt = body.toString('latin1', o.dBody, o.dEnd);
      const refs = [...txt.matchAll(/(Persistent_Level:PersistentLevel\.[A-Za-z0-9_]+)\.[A-Za-z0-9_]+\x00/g)].map((m) => m[1]);
      if (refs.length >= 2 && refs.every((r) => namen.has(r))) leitungen.push(o);
    }
  }
  const alle = [...gewaehlt, ...leitungen];
  for (const o of leitungen) namen.add(o.pathName);
  // Bestandteile (Anschluesse, Lager …)
  const teile = objects.filter((o) => o.kind === 0 && namen.has(o.parent) && o.dBody !== undefined);

  // 2. Leichtbau-Teile im Bereich
  const leicht = [];
  const lw = objects.find((o) => /LightweightBuildableSubsystem$/.test(o.typePath));
  const lwNr = {};
  if (lw) readLightweight(body, lw, (tp, rot, pos, swatch, proxy, typed) => {
    const cls = kurz(tp), nr = lwNr[tp] = (lwNr[tp] ?? -1) + 1;
    if (ohne.has(cls) || !(auswahl ? auswahl.l.get(tp)?.has(nr) : drin(pos))) return;
    leicht.push({ cls, rot, pos, len: /Beam/.test(cls) ? traegerLaenge(typed) : null });
  });
  const n = alle.length + leicht.length;
  if (!n) throw Object.assign(new Error('Im gewählten Bereich ist nichts (sichtbar), das in eine Blaupause passt.'), { status: 400 });
  if (auswahl) { // Grenzen aus der Auswahl selbst
    x0 = y0 = Infinity; x1 = y1 = -Infinity;
    for (const o of [...alle, ...leicht]) { x0 = Math.min(x0, o.pos[0]); x1 = Math.max(x1, o.pos[0]); y0 = Math.min(y0, o.pos[1]); y1 = Math.max(y1, o.pos[1]); }
  }

  // 3. Verschiebung: Mitte auf 8-m-Raster, Unterkante auf 0
  let zLow = Infinity;
  for (const o of alle) zLow = Math.min(zLow, o.pos[2]);
  for (const o of leicht) zLow = Math.min(zLow, o.pos[2]);
  const cx = weltkoordinaten ? 0 : Math.round((x0 + x1) / 2 / 800) * 800, cy = weltkoordinaten ? 0 : Math.round((y0 + y1) / 2 / 800) * 800, cz = weltkoordinaten ? 0 : Math.round(zLow / 100) * 100;
  const verschiebe = (p) => [p[0] - cx, p[1] - cy, p[2] - cz];

  const heads = [], datas = [], zaehl = {};
  const zaehle = (cls) => { zaehl[cls] = (zaehl[cls] || 0) + 1; };
  const kopfEntity = (o, pos) => Buffer.concat([i32(1), fstr(o.typePath), fstr('Persistent_Level'), fstr(o.pathName), basis.hasFlags ? i32(o.flags) : Buffer.alloc(0),
    i32(1), ...o.rot.map((v) => { const b = Buffer.alloc(4); b.writeFloatLE(v); return b; }), ...pos.map((v) => { const b = Buffer.alloc(4); b.writeFloatLE(v); return b; }),
    ...(o.scale || [1, 1, 1]).map((v) => { const b = Buffer.alloc(4); b.writeFloatLE(v); return b; }), i32(o.placed || 0)]);
  const kopfTeil = (o) => Buffer.concat([i32(0), fstr(o.typePath), fstr('Persistent_Level'), fstr(o.pathName), basis.hasFlags ? i32(o.flags) : Buffer.alloc(0), fstr(o.parent)]);

  // Drohnenstationen: Verweise auf ihr Info-Objekt (Kopplung mit der Partner-Station) und ihre Drohne zeigen auf Objekte, die
  // nicht mitkommen – im Ziel würden sie ins Leere bzw. auf fremde Stationen zeigen (gemessen 25.10.2026: Absturz in
  // AFGBuildableDroneStation::Factory_TickProducing). Ohne diese Eigenschaften startet die Station wie frisch gebaut.
  const DROHNE_WEG = new Set(['mInfo', 'mStationDrone', 'mDockedDrone']);
  const ohneDrohnenVerweise = (c) => {
    try { const z = zerlege(c, true), weg = z.props.filter((p) => DROHNE_WEG.has(p.name)); if (!weg.length) return c;
      const teile = []; let p = 0; for (const x of weg) { teile.push(c.subarray(p, x.start)); p = x.end; } teile.push(c.subarray(p)); return Buffer.concat(teile);
    } catch { return c; }
  };
  for (const o of alle) {
    let content = body.subarray(o.dBody, o.dEnd);
    if (/Build_DroneStation_C$/.test(o.typePath)) content = ohneDrohnenVerweise(content);
    if (/Build_PowerLine_C$/.test(o.typePath)) {
      // Endpunkte sind Weltkoordinaten -> mitverschieben
      content = Buffer.from(content);
      for (const at of vektorStellen(content, 0, content.length, 'Locations')) {
        content.writeDoubleLE(content.readDoubleLE(at) - cx, at); content.writeDoubleLE(content.readDoubleLE(at + 8) - cy, at + 8); content.writeDoubleLE(content.readDoubleLE(at + 16) - cz, at + 16);
      }
    }
    heads.push(kopfEntity(o, verschiebe(o.pos)));
    datas.push(Buffer.concat([i32(content.length), content]));
    zaehle(kurz(o.typePath));
  }
  for (const o of teile) {
    const content = body.subarray(o.dBody, o.dEnd);
    heads.push(kopfTeil(o));
    datas.push(Buffer.concat([i32(content.length), content]));
  }
  // Leichtbau aus Vorlagen
  const taken = new Set(namen), fehlend = {};
  for (const t of leicht) {
    if (!leichtbauAlsAkteure) continue; // Save-Transfer übernimmt die nativen Einträge separat.
    const v = templateFor(lib, kat, ver, t.cls);
    if (!v) { fehlend[t.cls] = (fehlend[t.cls] || 0) + 1; continue; }
    let content = Buffer.from(v.data, 'base64');
    if (t.len) content = setzeLaenge(content, t.len);
    heads.push(makeHead({ typePath: v.typePath, instance: newInstance(t.cls, taken), flags: v.flags, hasFlags: basis.hasFlags, rot: t.rot, pos: verschiebe(t.pos), placed: v.placed }));
    datas.push(Buffer.concat([i32(content.length), content]));
    zaehle(t.cls);
  }

  // 4. Kopf: Baukosten, Rezepte, Abmessung (in 8-m-Feldern)
  const kosten = {}, rezepte = new Set();
  for (const [cls, m] of Object.entries(zaehl)) {
    const g = kat.gebaeude[cls];
    if (!g) continue;
    if (!/ConveyorBelt|ConveyorLift|Pipeline|PowerLine|Railroad|Hyper|Wire/.test(cls)) for (const [it, a] of g.kosten || []) kosten[it] = (kosten[it] || 0) + a * m;
    const rp = kat.pfade.rezepte[g.rezept]; if (rp) rezepte.add(rp);
  }
  const kopf = {
    costs: Object.entries(kosten).filter(([it]) => kat.pfade.items[it]).map(([it, a]) => ({ path: kat.pfade.items[it], item: it, amount: Math.round(a) })),
    recipes: [...rezepte],
    dimensions: [Math.max(1, Math.ceil((x1 - x0) / 800)), Math.max(1, Math.ceil((y1 - y0) / 800)), 4],
  };
  const objs = heads.map((head, i) => ({ head, data: datas[i] }));
  const datei = createBlueprint(basis, objs, kopf);
  const pruef = readBlueprint(datei, { props: false }); // Selbstpruefung
  log(`Karte -> Blaupause: ${alle.length} Gebäude, ${teile.length} Bestandteile, ${leicht.length} Leichtbau`);
  return {
    datei, cfg: basis.cfg,
    info: {
      objekte: pruef.objects.length, gebaeude: alle.length, leitungen: leitungen.length, bestandteile: teile.length,
      leichtbau: leicht.length - Object.values(fehlend).reduce((a, b) => a + b, 0), fehlend, falscheVersion,
      groesse: [Math.round((x1 - x0) / 100), Math.round((y1 - y0) / 100)], version: ver, verschiebung: [cx, cy, cz],
    },
  };
}
