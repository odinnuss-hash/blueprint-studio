// Kopplungen beim Übertragen in einen anderen Spielstand prüfen und bereinigen.
//
// Gebäude verweisen auf andere Objekte: Bänder/Rohre auf Anschlüsse, Kabel auf Masten, Drohnenstationen auf ihr Info-Objekt,
// ihre Partner-Station und ihre Drohne, LKW-/Zugstationen auf Stationsnamen und Fahrzeuge, Miner auf Rohstoffknoten …
// Liegt das Gegenstück nicht im übertragenen Bereich, zeigt der Verweis im Ziel ins Leere – oder, bei gleichem Objektnamen
// (Spielstände aus derselben Linie), auf ein fremdes Objekt. Beides kann das Spiel zum Absturz bringen (gemessen 27.10.2026:
// Panem_Neu_2, AFGBuildableDroneStation::Factory_TickProducing – Drohnen ohne Heimatstation, Partner-Infos ohne Gegenstück).
//
// Regel je Verweis aus dem Bereich hinaus:
//   - Welt-Objekte (Rohstoffknoten, Fracking, Subsysteme), die im Ziel mit gleichem Namen und gleicher Art existieren → bleiben
//   - Subsysteme, die im Ziel anders heißen (z. B. BP_RailroadSubsystem) → auf das Subsystem des Ziels umgelenkt
//   - Bandketten/Blaupausen-Gruppen ohne Gegenstück → bleiben (das Spiel baut sie neu auf, so seit jeher übertragen)
//   - alles andere → Verweis wird entfernt (Kopplung aufgehoben), mit Hinweis an den Nutzer
// Bearbeitet werden ObjectProperty und Arrays daraus (einzelne Einträge); andere Eigenschaften nur, wenn sie ausschließlich
// nach außen zeigen (dann ganz entfernt) – gemischte bleiben und werden als „nicht bereinigt“ gemeldet.
import { zerlege, fstr } from './eigenschaften.mjs';

const P = 'Persistent_Level:PersistentLevel.';
const RX_REF = /Persistent_Level:PersistentLevel\.[\w.]+/g;
const WELT = /ResourceNode|FrackingSatellite|FrackingCore|ResourceDeposit|Geyser|Subsystem/;
const HARMLOS = /^FGConveyorChainActor|^FGBlueprintProxy/;
const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const kurz = (t) => (t || '').split('.').pop();
export const wurzel = (n) => { const i = n.indexOf('.', P.length); return i < 0 ? n : n.slice(0, i); };

/** Arten für die Meldung an den Nutzer (Eigenschaft → Text, Hinweis) */
const ARTEN = [
  [/^(mInfo|mStationDrone|mDockedDrone|mPairedStation|mHomeStation|mCurrentDestinationStation)$/, 'Drohnenstationen: Partner-Kopplung / Drohne', 'Die Stationen starten ohne Partner und ohne Drohne – im Spiel Ziel neu wählen und Drohne einsetzen.'],
  [/^(mConnectedComponent|mFlowIndicator)$/, 'Band- und Rohranschlüsse zu Teilen außerhalb', 'Die Enden am Rand des Bereichs sind offen.'],
  [/^mWires$/, 'Stromkabel zu Masten/Gebäuden außerhalb', 'Kabel über den Rand hinaus im Spiel neu ziehen.'],
  [/^(mConnectedComponents|mRailroadTrackConnection|mGuardedConnections|mObservedConnections|mControlledConnections)$/, 'Gleis- und Signalverbindungen am Rand', 'Gleise am Rand im Spiel neu anschließen.'],
  [/^mHiddenConnections$/, 'Bahnstrom-Anbindung von Bahnhöfen (Stromschiene)', 'Baut das Spiel beim Laden aus dem Gleisnetz neu auf.'],
  [/^mStationIdentifier$/, 'Stationsnamen (LKW/Zug)', 'Stationen im Spiel neu benennen.'],
  [/^(mDockedRailroadVehicle|mDockingLocomotive|mVehicleTracking|mDockedActor)$/, 'Angedockte Fahrzeuge', 'Fahrzeuge werden nicht übertragen.'],
  [/^mElevatorCabin$/, 'Aufzugskabinen', 'Kabinen werden nicht übertragen – fährt ein Aufzug nicht, im Spiel abreißen und neu bauen.'],
  [/^mExtractableResource$/, 'Rohstoffknoten', 'Im Ziel gibt es den Knoten an dieser Stelle nicht – Miner/Pumpe dort neu setzen.'],
  [/^(mStartNode|mEndNode|mArrivingConnections|mLeavingConnections|mPathBlocks)$/, 'LKW-Wege am Rand', 'Wege im Spiel neu aufzeichnen.'],
  [/^mOwningPlayerState$/, 'Besitzer (Spieler aus der Quelle)', ''],
  [/^(mConveyorChainActor|mBlueprintProxy)$/, 'Interne Gruppierung (Bandkette/Blaupause) mit Namensgleichheit im Ziel', ''],
  [/^(mSnappedPassthroughs|mTopSnappedConnection|mBottomSnappedConnection)$/, 'Durchführungen zu Teilen außerhalb', ''],
  [/^mSignPoles$/, 'Schilder-Masten außerhalb', ''],
];
const artVon = (eig, zielKlasse = '') => (/Portal/.test(zielKlasse) ? [null, 'Portale: Verbindung zum Gegenstück', 'Portal-Paar im Spiel neu verbinden.'] : ARTEN.find(([re]) => re.test(eig)) || [null, 'Sonstige Verbindungen nach außen', '']);

/**
 * Kontext für die Prüfung. quelle/ziel: Ergebnis von readSave (props:false). drin: Set der übertragenen Akteur-Namen.
 */
/** k.entscheide (optional): eigene Regel (k, ref) → 'bleibt' | { weg } | { neu } – z. B. für die Reparatur eines Spielstands */
export function kopplungsKontext(quelle, ziel, drin) {
  const qk = new Map(quelle.objects.map((o) => [o.pathName, kurz(o.typePath)]));
  const zk = ziel ? new Map(ziel.objects.map((o) => [o.pathName, kurz(o.typePath)])) : null;
  const einzel = new Map();
  if (ziel) for (const o of ziel.objects) { const c = kurz(o.typePath); if (/Subsystem/.test(c) && o.kind === 1) einzel.set(c, einzel.has(c) ? null : o.pathName); }
  return { drin, qk, zk, einzel, funde: new Map(), nichtBereinigt: new Map() };
}

/** Was mit einem Verweis nach außen geschieht: 'bleibt' | 'weg' | { neu: Pfad } (+ gleichnamig: true bei Namensgleichheit) */
function entscheide(k, ref) {
  const root = wurzel(ref), qc = k.qk.get(ref) || k.qk.get(root) || '', zc = k.zk ? k.zk.get(ref) : undefined;
  // Auch in der Quelle nicht gespeichert: fester Teil der Karte (z. B. Wasserflächen der Wasserpumpen) – gibt es überall
  if (!qc) return 'bleibt';
  if (zc !== undefined) {
    if (WELT.test(zc) && zc === qc) return 'bleibt';
    return { weg: true, gleichnamig: true };
  }
  if (/Subsystem/.test(qc) && k.einzel?.get(qc)) return { neu: k.einzel.get(qc) };
  if (HARMLOS.test(qc)) return 'bleibt';
  if (!k.zk && WELT.test(qc)) return 'bleibt'; // ohne Ziel (Blaupause): Welt-Objekte unverändert lassen
  return { weg: true };
}

function merke(k, haltKlasse, eig, ziel, was) {
  const [, art, hinweis] = artVon(eig, k.qk.get(wurzel(ziel)) || '');
  const f = k.funde.get(art) || { art, hinweis, anzahl: 0, umgelenkt: 0, gleichnamig: 0, beispiele: new Set() };
  if (was.neu) f.umgelenkt++; else f.anzahl++;
  if (was.gleichnamig) f.gleichnamig++;
  if (f.beispiele.size < 4) f.beispiele.add(`${haltKlasse.replace(/^Build_|_C$/g, '')} → ${(k.qk.get(wurzel(ziel)) || k.qk.get(ziel) || '?').replace(/^Build_|_C$/g, '')}`);
  k.funde.set(art, f);
}

/** Objektdaten bereinigen. o: { pathName, kind, typePath }, data: Buffer (ohne Längen-Vorsatz). Liefert neue Daten (oder dieselben). */
export function kopplungenBereinigen(k, o, data) {
  const halt = kurz(o.typePath) || '', istE = o.kind === 1;
  let z; try { z = zerlege(data, istE); } catch { return data; }
  const haltKlasse = istE ? halt : (k.qk.get(wurzel(o.pathName)) || halt);
  const teile = []; let pos = 0, geaendert = false;
  for (const p of z.props) {
    const val = data.subarray(p.valStart, p.end), txt = val.toString('latin1');
    const refs = txt.match(RX_REF); if (!refs) continue;
    const aussen = refs.filter((r) => !k.drin.has(wurzel(r))); if (!aussen.length) continue;
    const wahl = new Map(aussen.map((r) => [r, (k.entscheide || entscheide)(k, r)]));
    if ([...wahl.values()].every((w) => w === 'bleibt')) continue;
    const typ = p.typ?.name, inner = p.typ?.kinder?.[0]?.name;
    let neuVal = null, entfernen = false;
    if (typ === 'ObjectProperty') {
      const w = wahl.get(aussen[0]);
      if (w === 'bleibt') continue;
      merke(k, haltKlasse, p.name, aussen[0], w);
      if (w.neu) neuVal = Buffer.concat([fstr('Persistent_Level'), fstr(w.neu)]); else entfernen = true;
    } else if (typ === 'ArrayProperty' && inner === 'ObjectProperty') {
      // Wert: int32 Anzahl, je Eintrag fstr Level + fstr Pfad
      const n = val.readInt32LE(0); let q = 4; const bleiben = [];
      const lies = () => { const l = val.readInt32LE(q); const s = l > 0 ? val.toString('latin1', q + 4, q + 4 + l - 1) : ''; const b = val.subarray(q, q + 4 + Math.max(0, l)); q += 4 + Math.max(0, l); return { s, b }; };
      let ok = true;
      for (let i = 0; i < n; i++) {
        if (q + 8 > val.length) { ok = false; break; }
        const lv = lies(), pf = lies();
        const w = !pf.s || k.drin.has(wurzel(pf.s)) ? 'bleibt' : (wahl.get(pf.s) || (k.entscheide || entscheide)(k, pf.s));
        if (w === 'bleibt') { bleiben.push(Buffer.concat([lv.b, pf.b])); continue; }
        merke(k, haltKlasse, p.name, pf.s, w);
        if (w.neu) bleiben.push(Buffer.concat([lv.b, fstr(w.neu)]));
      }
      if (!ok || q !== val.length) { k.nichtBereinigt.set(p.name, (k.nichtBereinigt.get(p.name) || 0) + 1); continue; }
      if (!bleiben.length) entfernen = true; else neuVal = Buffer.concat([i32(bleiben.length), ...bleiben]);
    } else {
      // Struktur o. Ä.: nur entfernen, wenn alles darin nach außen zeigt und nichts umgelenkt werden müsste
      if (aussen.length === refs.length && [...wahl.values()].every((w) => w !== 'bleibt' && !w.neu)) { for (const r of aussen) merke(k, haltKlasse, p.name, r, wahl.get(r)); entfernen = true; }
      else { k.nichtBereinigt.set(p.name, (k.nichtBereinigt.get(p.name) || 0) + 1); continue; }
    }
    teile.push(data.subarray(pos, p.start)); pos = p.end; geaendert = true;
    if (!entfernen) teile.push(data.subarray(p.start, p.sizePos), i32(neuVal.length), data.subarray(p.sizePos + 4, p.valStart), neuVal);
  }
  if (!geaendert) return data;
  teile.push(data.subarray(pos));
  let neu = Buffer.concat(teile);
  // Drohnenstation ohne angedockte Drohne: Lade-/Entlade-Zustand zurücksetzen. In intakten Spielständen gibt es den Zustand
  // nur mit angedockter Drohne (gemessen 27.10.2026, Grasland/MASSAGE); sonst greift die Station ins Leere.
  if (/Build_DroneStation_C$/.test(halt)) neu = ohneLadezustand(neu);
  zerlege(neu, istE); // Selbstprüfung: lässt sich wieder lesen
  return neu;
}

/** Ergebnis für die Anzeige: [{ art, hinweis, anzahl, umgelenkt, gleichnamig, beispiele[] }], nichtBereinigt: { Eigenschaft: Anzahl } */
export function kopplungsBericht(k) {
  const liste = [...k.funde.values()].map((f) => ({ ...f, beispiele: [...f.beispiele] })).sort((a, b) => b.anzahl + b.umgelenkt - a.anzahl - a.umgelenkt);
  return { liste, nichtBereinigt: Object.fromEntries(k.nichtBereinigt) };
}

/**
 * Nachprüfung im fertigen Spielstand: Verweise der übertragenen Objekte, die ins Leere zeigen (ohne harmlose Gruppierungen).
 * Liefert { tot: Anzahl, beispiele: [...] }.
 */
export function nachpruefen(save, namen, quellNamen = null) {
  const da = new Set(save.objects.map((o) => o.pathName)), kl = new Map(save.objects.map((o) => [o.pathName, kurz(o.typePath)]));
  let tot = 0; const beispiele = [];
  for (const o of save.objects) {
    if (o.dBody === undefined || !namen.has(o.kind === 1 ? o.pathName : wurzel(o.pathName))) continue;
    const t = save.body.toString('latin1', o.dBody, o.dEnd);
    for (const r of t.match(RX_REF) || []) {
      if (da.has(r) || da.has(wurzel(r))) continue;
      if (quellNamen && !quellNamen.has(r) && !quellNamen.has(wurzel(r))) continue; // fester Teil der Karte
      if (/FGConveyorChainActor|FGBlueprintProxy/.test(r)) continue;
      tot++; if (beispiele.length < 5) beispiele.push(`${(kl.get(o.pathName) || '').replace(/^Build_|_C$/g, '')} → ${r.slice(P.length)}`);
    }
  }
  return { tot, beispiele };
}

/** Drohnenstation (Objektdaten): mItemTransferringStage entfernen, wenn keine Drohne angedockt ist */
export function ohneLadezustand(data) {
  const z = zerlege(data, true);
  if (z.props.some((p) => p.name === 'mDockedDrone')) return data;
  const p = z.props.find((x) => x.name === 'mItemTransferringStage');
  return p ? Buffer.concat([data.subarray(0, p.start), data.subarray(p.end)]) : data;
}
