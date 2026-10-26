// Kartenpunkte für Welt, Karte und Planer: Rohstoff-Knoten (Art, Reinheit), Vorkommen, Geysire, Gasquellen, Absturzstellen,
// Power-Slugs, Somersloops, Mercer-Kugeln. Lage/Art/Reinheit aus den Spieldateien (werkzeuge/gelaende --punkte → userdata/welt/punkte.json),
// Zustand aus dem Spielstand (gemessen 24.10.2026 an Grasland: Akteurnamen und Lagen stimmen 1:1):
//   - Sammelobjekte (Slugs, Somersloops, Mercer) und Absturzstellen, die im Spielstand fehlen, sind eingesammelt/abgebaut
//   - Absturzstellen im Spielstand: mHasBeenOpened (geöffnet)
//   - Knoten, auf die ein Miner/eine Pumpe/ein Geothermie-Kraftwerk verweist (PersistentLevel.<Name>), sind belegt
import fs from 'node:fs';
import { readSave } from './sav.mjs';

export const ARTEN = {
  BP_ResourceNode_C: 'knoten', BP_ResourceNodeGeyser_C: 'geysir', BP_FrackingCore_C: 'gasquelle', BP_FrackingSatellite_C: 'gasquelle',
  BP_ResourceDeposit_C: 'vorkommen', BP_DropPod_C: 'absturz', BP_Crystal_C: 'slug1', BP_Crystal_mk2_C: 'slug2', BP_Crystal_mk3_C: 'slug3',
  BP_WAT1_C: 'somersloop', BP_WAT2_C: 'mercer',
};
const SAMMEL = new Set(['absturz', 'slug1', 'slug2', 'slug3', 'somersloop', 'mercer']);
const REIN = { RP_Inpure: 0, RP_Normal: 1, RP_Pure: 2 };

export function punkteLaden(datei) {
  try { return JSON.parse(fs.readFileSync(datei, 'utf8')); } catch { return null; }
}

/**
 * Kompakt für den Browser: { arten, ressourcen, p: [[art, x, y, z, ressource, reinheit, zustand]] }
 *   reinheit 0 unrein / 1 normal / 2 rein / -1 ohne; zustand 0 frei, 1 belegt bzw. eingesammelt, 2 geöffnet (Absturzstelle)
 */
export function punkteMitZustand(punkte, savBuf = null) {
  let imSave = null, belegt = new Set(), offen = new Set();
  if (savBuf) {
    const s = readSave(savBuf, { props: false });
    imSave = new Set();
    for (const o of s.objects) {
      if (o.kind !== 1) continue;
      const name = o.pathName.slice(o.pathName.lastIndexOf('.') + 1);
      if (/\.BP_(Crystal|WAT|DropPod)/.test(o.typePath)) {
        imSave.add(name);
        if (/BP_DropPod/.test(o.typePath) && o.dBody !== undefined && s.body.indexOf('mHasBeenOpened\0', o.dBody, 'latin1') > 0 && s.body.indexOf('mHasBeenOpened\0', o.dBody, 'latin1') < o.dEnd) offen.add(name);
      } else if (/Build_(Miner|OilPump|FrackingExtractor|GeneratorGeoThermal)/.test(o.typePath) && o.dBody !== undefined) {
        const txt = s.body.toString('latin1', o.dBody, o.dEnd);
        for (const m of txt.matchAll(/PersistentLevel\.(BP_[A-Za-z0-9_]+)\0/g)) belegt.add(m[1]);
      }
    }
  }
  const arten = [...new Set(Object.values(ARTEN))], ressourcen = [], resIdx = new Map();
  const p = [];
  for (const x of punkte) {
    const art = ARTEN[x.t]; if (!art) continue;
    let r = -1; if (x.r) { if (!resIdx.has(x.r)) { resIdx.set(x.r, ressourcen.length); ressourcen.push(x.r); } r = resIdx.get(x.r); }
    const rein = art === 'knoten' || art === 'geysir' || x.t === 'BP_FrackingSatellite_C' ? (REIN[x.p] ?? 1) : -1;
    let zustand = 0;
    if (imSave) {
      if (SAMMEL.has(art)) zustand = !imSave.has(x.n) ? 1 : offen.has(x.n) ? 2 : 0;
      else if (belegt.has(x.n)) zustand = 1;
    }
    p.push([arten.indexOf(art), x.x, x.y, x.z, r, rein, zustand]);
  }
  return { arten, ressourcen, p, mitSpielstand: !!imSave };
}
