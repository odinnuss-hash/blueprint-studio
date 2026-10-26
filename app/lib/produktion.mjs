// Produktion eines Spielstands je Minute (für den Planer: „was liegt schon vor“).
// Gemessen 24.10.2026 an Grasland (2 395 Fertigungsmaschinen, 353 Extraktoren); Eigenschaften je Maschine:
//   mCurrentRecipe (Rezept), mCurrentPotential (Takt, fehlt = 100 %), mCurrentProductionBoost (Somersloop, fehlt = 0),
//   mLastProductivityMeasurementProduceDuration / …Duration (gemessene Auslastung), mIsProductionPaused,
//   Extraktoren: mExtractableResource → Knoten (Art/Reinheit aus den Kartenpunkten, lib/kartenpunkte.mjs).
// Ergebnis je Item: hergestellt, verbraucht (Nennwerte bei eingestelltem Takt) und dieselben Werte mit gemessener Auslastung.
// Kraftwerke: mCurrentFuelClass (eingelegter Brennstoff), mCurrentPotential; Verbrauch = Leistung × 60 / Energie je Stück (Flüssiges je Liter → × 1000
// für m³), Kühlwasser Kohle 45 / Atom 240 m³/min, Atommüll 50 je Uran- bzw. 10 je Plutoniumstab; Geothermie nach Reinheit 100/200/400 MW
// (Mittelwert), Alien Power Augmenter 500 MW (ohne Netz-Bonus). Strom: erzeugt und von Maschinen verbraucht (Takt^1,321928).
import { readSave } from './sav.mjs';
import { zerlege } from './eigenschaften.mjs';

const kurz = (p) => { const m = /\.([A-Za-z0-9_]+)$/.exec(p || ''); return m ? m[1] : (p || ''); };
const MINER = { Build_MinerMk1_C: 60, Build_MinerMk2_C: 120, Build_MinerMk3_C: 240 };
const REIN = { RP_Inpure: 0.5, RP_Normal: 1, RP_Pure: 2, '': 1 };
const KRAFT = { Build_GeneratorCoal_C: [75, 45], Build_GeneratorFuel_C: [250, 0], Build_GeneratorNuclear_C: [2500, 240], Build_GeneratorBiomass_Automated_C: [30, 0], Build_GeneratorBiomass_C: [30, 0] };
const ABFALL = { Desc_NuclearFuelRod_C: ['Desc_NuclearWaste_C', 50], Desc_PlutoniumFuelRod_C: ['Desc_PlutoniumWaste_C', 10] };

function werte(body, o) {
  const d = body.subarray(o.dBody, o.dEnd), z = zerlege(d, true), w = {};
  for (const p of z.props) {
    const t = p.typ.name;
    if (t === 'FloatProperty') w[p.name] = d.readFloatLE(p.valStart);
    else if (t === 'BoolProperty') w[p.name] = true; // Wert steckt im Flag-Byte; vorhanden heißt hier gesetzt
    else if (t === 'ObjectProperty') { let q = p.valStart; const n1 = d.readInt32LE(q); q += 4 + Math.max(0, n1); const n2 = d.readInt32LE(q); w[p.name] = n2 > 0 ? d.toString('latin1', q + 4, q + 3 + n2) : ''; }
  }
  return w;
}

/** savBuf, kat (Katalog), punkte (userdata/welt/punkte.json oder null) → { items: { item: { her, ver, herGem, verGem } }, maschinen, extraktoren, ohneKnoten } */
export function produktionLesen(savBuf, kat, punkte) {
  const s = readSave(savBuf, { props: false });
  const knoten = new Map((punkte || []).map((p) => [p.n, p]));
  const items = {}, add = (it, feld, v) => { if (!it || !v) return; const e = items[it] ||= { her: 0, ver: 0, herGem: 0, verGem: 0 }; e[feld] += v; };
  let maschinen = 0, extraktoren = 0, ohneKnoten = 0, unbekannt = 0;
  const strom = { erzeugt: 0, erzeugtGem: 0, verbraucht: 0, verbrauchtGem: 0 }, kraftwerke = {};
  const verbrauchMW = (cls, takt) => (kat.gebaeude[cls]?.werte?.strom || 0) * Math.pow(takt, 1.321928);
  for (const o of s.objects) {
    if (o.kind !== 1 || o.dBody === undefined || !/\/Buildable\//.test(o.typePath)) continue;
    const cls = kurz(o.typePath);
    const fertigung = /^Build_(Smelter|Constructor|Assembler|Foundry|Manufacturer|OilRefinery|Blender|Packager|HadronCollider|QuantumEncoder|Converter)/.test(cls);
    const extraktor = /^Build_(Miner|OilPump|WaterPump|FrackingExtractor)/.test(cls);
    const kraftwerk = !!KRAFT[cls] || cls === 'Build_GeneratorGeoThermal_C' || cls === 'Build_AlienPowerBuilding_C';
    if (!fertigung && !extraktor && !kraftwerk) continue;
    let w; try { w = werte(s.body, o); } catch { continue; }
    if (w.mIsProductionPaused) continue;
    const takt = w.mCurrentPotential ?? 1;
    const gemessen = w.mLastProductivityMeasurementDuration > 0 ? Math.min(1, (w.mLastProductivityMeasurementProduceDuration || 0) / w.mLastProductivityMeasurementDuration) : 0;
    if (kraftwerk) {
      const k = kraftwerke[cls] ||= { anzahl: 0, mw: 0, brennstoffe: {} }; k.anzahl++;
      let mw = 0;
      if (cls === 'Build_AlienPowerBuilding_C') mw = 500;
      else if (cls === 'Build_GeneratorGeoThermal_C') { const g = knoten.get(kurz(w.mExtractableResource)); mw = { RP_Inpure: 100, RP_Pure: 400 }[g?.p] || 200; }
      else {
        const fuel = kurz(w.mCurrentFuelClass), e = kat.items[fuel]?.energieMJ; if (!fuel || !e) { k.anzahl--; continue; }
        const [leistung, wasser] = KRAFT[cls], fl = /Flüssig|Gas/.test(kat.items[fuel]?.form || '');
        mw = leistung * takt;
        const proMin = mw * 60 / (e * (fl ? 1000 : 1));
        add(fuel, 'ver', proMin); add(fuel, 'verGem', proMin * gemessen); k.brennstoffe[fuel] = (k.brennstoffe[fuel] || 0) + proMin;
        if (wasser) { add('Desc_Water_C', 'ver', wasser * takt); add('Desc_Water_C', 'verGem', wasser * takt * gemessen); }
        if (ABFALL[fuel]) { const [ab, n] = ABFALL[fuel]; add(ab, 'her', proMin * n); add(ab, 'herGem', proMin * n * gemessen); }
      }
      k.mw += mw; strom.erzeugt += mw; strom.erzeugtGem += mw * (cls === 'Build_AlienPowerBuilding_C' || cls === 'Build_GeneratorGeoThermal_C' ? 1 : gemessen);
      continue;
    }
    strom.verbraucht += verbrauchMW(cls, takt); strom.verbrauchtGem += verbrauchMW(cls, takt) * gemessen;
    if (fertigung) {
      const r = kat.rezepte[kurz(w.mCurrentRecipe)]; if (!r) { if (w.mCurrentRecipe) unbekannt++; continue; }
      maschinen++;
      const boost = 1 + (w.mCurrentProductionBoost || 0);
      for (const p of r.produkte) { add(p.item, 'her', p.proMin * takt * boost); add(p.item, 'herGem', p.proMin * takt * boost * gemessen); }
      for (const z of r.zutaten) { add(z.item, 'ver', z.proMin * takt); add(z.item, 'verGem', z.proMin * takt * gemessen); }
    } else {
      extraktoren++;
      let item, menge;
      if (cls === 'Build_WaterPump_C') { item = 'Desc_Water_C'; menge = 120; }
      else {
        const k = knoten.get(kurz(w.mExtractableResource)); if (!k) { ohneKnoten++; continue; }
        item = k.r; const rein = REIN[k.p] ?? 1;
        menge = MINER[cls] ? MINER[cls] * rein : cls === 'Build_OilPump_C' ? 120 * rein : 60 * rein; // Gasquellen-Nebenquelle: 30/60/120
      }
      add(item, 'her', menge * takt); add(item, 'herGem', menge * takt * gemessen);
    }
  }
  for (const e of Object.values(items)) for (const k of Object.keys(e)) e[k] = Math.round(e[k] * 100) / 100;
  for (const k of Object.keys(strom)) strom[k] = Math.round(strom[k]);
  for (const k of Object.values(kraftwerke)) { k.mw = Math.round(k.mw); for (const f of Object.keys(k.brennstoffe)) k.brennstoffe[f] = Math.round(k.brennstoffe[f] * 10) / 10; }
  return { items, maschinen, extraktoren, ohneKnoten, unbekannt, strom, kraftwerke, name: s.header.saveName || '' };
}

/** Eine Maschine (pathName) im bereits gelesenen Spielstand s: Rezept, Takt, Ein-/Ausgänge pro Minute; null = nicht gefunden */
export function maschineInfo(s, kat, punkte, pathName) {
  const o = s.objects.find((x) => x.pathName === pathName); if (!o) return null;
  const cls = kurz(o.typePath), info = { cls, name: kat.gebaeude[cls]?.name || cls };
  if (o.kind !== 1 || o.dBody === undefined) return info;
  let w; try { w = werte(s.body, o); } catch { return info; }
  const takt = w.mCurrentPotential ?? 1, boost = 1 + (w.mCurrentProductionBoost || 0);
  info.takt = Math.round(takt * 1000) / 10; info.pausiert = !!w.mIsProductionPaused;
  if (w.mLastProductivityMeasurementDuration > 0) info.auslastung = Math.round(Math.min(1, (w.mLastProductivityMeasurementProduceDuration || 0) / w.mLastProductivityMeasurementDuration) * 100);
  if (boost > 1) info.boost = Math.round((boost - 1) * 100);
  const r1 = (v) => Math.round(v * 100) / 100;
  if (w.mCurrentRecipe) {
    const rid = kurz(w.mCurrentRecipe), r = kat.rezepte[rid];
    info.rezept = r ? r.name : rid;
    if (r) { info.alternativ = !!r.alternativ; info.aus = r.produkte.map((p) => ({ item: p.item, proMin: r1(p.proMin * takt * boost) })); info.ein = r.zutaten.map((z) => ({ item: z.item, proMin: r1(z.proMin * takt) })); }
  } else if (w.mCurrentFuelClass && KRAFT[cls]) {
    const fuel = kurz(w.mCurrentFuelClass), e = kat.items[fuel]?.energieMJ, fl = /Flüssig|Gas/.test(kat.items[fuel]?.form || '');
    const mw = KRAFT[cls][0] * takt; info.mw = Math.round(mw);
    if (e) info.ein = [{ item: fuel, proMin: r1(mw * 60 / (e * (fl ? 1000 : 1))) }];
    if (KRAFT[cls][1]) (info.ein ||= []).push({ item: 'Desc_Water_C', proMin: r1(KRAFT[cls][1] * takt) });
  } else if (MINER[cls] || /^Build_(OilPump|WaterPump|FrackingExtractor)/.test(cls)) {
    let item = 'Desc_Water_C', menge = 120;
    if (cls !== 'Build_WaterPump_C') {
      const k = (punkte || []).find((p) => p.n === kurz(w.mExtractableResource)); if (!k) return info;
      const rein = REIN[k.p] ?? 1; item = k.r; info.reinheit = { RP_Inpure: 'unrein', RP_Normal: 'normal', RP_Pure: 'rein' }[k.p] || 'normal';
      menge = MINER[cls] ? MINER[cls] * rein : cls === 'Build_OilPump_C' ? 120 * rein : 60 * rein;
    }
    info.aus = [{ item, proMin: r1(menge * takt) }];
  }
  return info;
}
