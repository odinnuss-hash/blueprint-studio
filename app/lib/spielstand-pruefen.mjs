// Spielstand prüfen und als Kopie reparieren (Karte → „Spielstand prüfen“).
//
// Gefunden werden Fehler, wie sie nach Übertragungen mit älteren App-Versionen oder Mods auftreten (gemessen 27.10.2026
// an Panem_Neu_2, Absturz in AFGBuildableDroneStation::Factory_TickProducing):
//   1. Verweise auf Objekte, die im Spielstand fehlen, obwohl solche Objekte immer gespeichert werden (Gebäude, Drohnen,
//      Drohnen-Infos, Stationsnamen, Fahrzeuge, Spieler …) → Verweis entfernen (Kopplung aufheben)
//   2. Drohnen, die angedockt sind, aber keiner Station gehören → Station, an der sie angedockt sind, als Besitzer eintragen
//   3. Drohnen ohne oder mit falscher Heimatstation (mHomeStation) → Besitzer-Station eintragen
//   4. Drohnenstationen mit Lade-/Entlade-Zustand ohne angedockte Drohne → Zustand zurücksetzen
// Das Original bleibt unverändert; die Reparatur schreibt eine neue Datei (lib/spielstand-aendern.mjs).
import { readSave } from './sav.mjs';
import { zerlege, setzeVerweis } from './eigenschaften.mjs';
import { spielstandAendern } from './spielstand-aendern.mjs';
import { kopplungenBereinigen, kopplungsBericht, ohneLadezustand, wurzel } from './kopplungen.mjs';

const P = 'Persistent_Level:PersistentLevel.';
// Objekte dieser Arten stehen immer im Spielstand – fehlt eins, ist der Verweis kaputt (Kartenteile wie Wasserflächen nicht)
const GESPEICHERT = /^(Build_|BP_DroneTransport|FGDroneStationInfo|FGDockingStationIdentifier|FGTrainStationIdentifier|BP_PlayerState|BP_Truck|BP_Tractor|BP_Explorer|BP_Golfcart|BP_ElevatorCabin|BP_Locomotive|BP_FreightWagon|FGTrain_|FGRailroadTimeTable)/;
// Ausnahmen: vom Spiel erzeugte Teile, die nie im Spielstand stehen (HUB-Spind; gemessen in intakten Ständen)
const NICHT_GESPEICHERT = /Locker_MK1/i;
const RX_REF = /Persistent_Level:PersistentLevel\.[\w.]+/g;
const kurz = (t) => (t || '').split('.').pop();
const ohneNr = (n) => n.slice(P.length).split('.')[0].replace(/_\d+$/, '');

/** Eigenschaften (Name → erster Verweis) eines Objekts */
function verweise(data, istE) {
  const r = {}; let z; try { z = zerlege(data, istE); } catch { return r; }
  for (const p of z.props) { const m = data.toString('latin1', p.valStart, p.end).match(RX_REF); r[p.name] = m ? m[0] : true; }
  return r;
}

/**
 * Prüfen. Liefert { befunde: [{ art, hinweis, anzahl, beispiele }], ersetzen: Map(pathName → neue Daten), gesamt }
 * ersetzen enthält bereits die Reparatur (für reparieren()).
 */
export function pruefeSpielstand(buf) {
  const s = readSave(buf, { props: false });
  const namen = new Set(s.objects.map((o) => o.pathName)), klasse = new Map(s.objects.map((o) => [o.pathName, kurz(o.typePath)]));
  const daten = (o) => ersetzen.get(o.pathName) || s.body.subarray(o.dBody, o.dEnd);
  const ersetzen = new Map(), extra = new Map();
  const melde = (art, hinweis, beispiel) => { const f = extra.get(art) || { art, hinweis, anzahl: 0, beispiele: [] }; f.anzahl++; if (f.beispiele.length < 4) f.beispiele.push(beispiel); extra.set(art, f); };

  // 1. Verweise ins Leere
  const k = {
    drin: namen, qk: { get: (n) => klasse.get(n) || (n.startsWith(P) ? ohneNr(n) : '') }, zk: null, einzel: new Map(), funde: new Map(), nichtBereinigt: new Map(),
    entscheide: (_k, ref) => (!namen.has(ref) && !namen.has(wurzel(ref)) && GESPEICHERT.test(ref.slice(P.length)) && !NICHT_GESPEICHERT.test(ref.slice(P.length)) ? { weg: true } : 'bleibt'),
  };
  for (const o of s.objects) {
    if (o.dBody === undefined || o.dEnd <= o.dBody) continue;
    const d = s.body.subarray(o.dBody, o.dEnd), refs = d.toString('latin1').match(RX_REF);
    if (!refs || refs.every((r) => namen.has(r) || namen.has(wurzel(r)) || !GESPEICHERT.test(r.slice(P.length)) || NICHT_GESPEICHERT.test(r))) continue;
    const neu = kopplungenBereinigen(k, o, d);
    if (neu !== d) ersetzen.set(o.pathName, neu);
  }

  // 2.–4. Drohnen
  const stationen = s.objects.filter((o) => /Build_DroneStation_C$/.test(o.typePath)), drohnen = s.objects.filter((o) => /BP_DroneTransport_C$/.test(o.typePath));
  const sv = new Map(stationen.map((o) => [o.pathName, verweise(daten(o), true)])), dv = new Map(drohnen.map((o) => [o.pathName, verweise(daten(o), true)]));
  const besitzer = new Map(); for (const [st, v] of sv) if (typeof v.mStationDrone === 'string' && namen.has(v.mStationDrone)) besitzer.set(v.mStationDrone, st);
  const setze = (o, name, pfad) => ersetzen.set(o.pathName, setzeVerweis(daten(o), true, name, pfad));
  const objVon = new Map([...stationen, ...drohnen].map((o) => [o.pathName, o]));
  for (const d of drohnen) {
    const v = dv.get(d.pathName), dock = typeof v.mDockedStation === 'string' && namen.has(v.mDockedStation) ? v.mDockedStation : null;
    if (!besitzer.has(d.pathName)) {
      const st = dock && objVon.get(dock), stv = st && sv.get(dock);
      if (st && typeof stv.mStationDrone !== 'string') {
        setze(st, 'mStationDrone', d.pathName); besitzer.set(d.pathName, dock); sv.set(dock, verweise(daten(st), true));
        melde('Drohnen ohne Besitzer-Station', 'Die Station, an der die Drohne angedockt ist, wird ihr Besitzer.', `${ohneNr(d.pathName)} → ${kurz(dock)}`);
      } else { melde('Drohnen ohne Station (nicht automatisch lösbar)', 'Im Spiel abbauen oder einer Station zuordnen.', kurz(d.pathName)); continue; }
    }
    const b = besitzer.get(d.pathName);
    if (v.mHomeStation !== b) { setze(d, 'mHomeStation', b); melde('Drohnen ohne passende Heimatstation', 'Heimatstation = Besitzer-Station.', `${kurz(d.pathName)} → ${kurz(b)}`); }
  }
  for (const st of stationen) {
    const d = daten(st), neu = ohneLadezustand(d);
    if (neu !== d) { ersetzen.set(st.pathName, neu); melde('Drohnenstationen im Ladezustand ohne Drohne', 'Lade-/Entlade-Zustand wird zurückgesetzt.', kurz(st.pathName)); }
  }
  const bericht = kopplungsBericht(k);
  // kritisch = kann das Spiel abstürzen lassen (Drohnen, Stationen, Partner) – sonst Aufräumen (tote Verweise ohne bekannte Folgen)
  const KRITISCH = /Drohne/; // belegt: Absturz Panem_Neu_2 (27.10.2026); übrige tote Verweise liefen im Spiel ohne Absturz
  const befunde = [...bericht.liste.map((f) => ({ art: f.art.replace(/ zu Teilen außerhalb| nach außen| am Rand/, ' ins Leere'), hinweis: 'Verweis zeigt auf ein fehlendes Objekt – wird entfernt.', anzahl: f.anzahl, beispiele: f.beispiele })), ...extra.values()]
    .map((f) => ({ ...f, kritisch: KRITISCH.test(f.art) && !/nicht automatisch/.test(f.art) })).sort((a, b) => b.kritisch - a.kritisch || b.anzahl - a.anzahl);
  const behebbar = befunde.filter((f) => !/nicht automatisch/.test(f.art)).reduce((a, f) => a + f.anzahl, 0);
  const kritisch = befunde.filter((f) => f.kritisch).reduce((a, f) => a + f.anzahl, 0);
  return { befunde, ersetzen, behebbar, kritisch, objekte: s.objects.length, drohnen: drohnen.length, stationen: stationen.length };
}

/** Reparierte Kopie erzeugen (Puffer). Prüft das Ergebnis erneut. */
export function repariereSpielstand(buf, speichername) {
  const p = pruefeSpielstand(buf);
  if (!p.ersetzen.size) return { ausgabe: null, vorher: p, nachher: p };
  const { ausgabe } = spielstandAendern(buf, { ersetzen: p.ersetzen, speichername });
  const nachher = pruefeSpielstand(ausgabe);
  return { ausgabe, vorher: p, nachher };
}
