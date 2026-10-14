// Gebaeude-/Item-/Rezept-Katalog aus den offiziellen Spieldaten (CommunityResources/Docs/<sprache>.json).
// Ergebnis wird als JSON zwischengespeichert und nur neu erzeugt, wenn sich die Spieldaten aendern.

import fs from 'node:fs';
import path from 'node:path';

const short = (p) => { const m = (p || '').match(/\.([A-Za-z0-9_]+_C)\b/g); return m ? m[m.length - 1].slice(1) : null; };
const itemsList = (s) => [...(s || '').matchAll(/ItemClass="([^"]+)",Amount=(\d+)/g)].map((m) => [short(m[1]), +m[2]]);
const num = (c, k) => { const v = parseFloat(c[k]); return Number.isFinite(v) ? v : 0; };
const clean = (t) => (t || '').replace(/\r\n/g, '\n').trim();
const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '');

const TYPNAME = {
  EST_Milestone: 'Meilenstein', EST_Tutorial: 'HUB-Upgrade', EST_MAM: 'M.A.M.-Forschung', EST_Alternate: 'Festplatte',
  EST_ResourceSink: 'AWESOME-Shop', EST_Customization: 'Anpassung', EST_HardDrive: 'Festplatte', EST_Story: 'Story', EST_Custom: 'Start',
};
const HAUPT = {
  Sub_Production: 'Produktion', Sub_Power: 'Energie', Sub_Logistics: 'Logistik', Sub_Organisation: 'Organisation',
  Sub_Transport: 'Transport', Sub_Architecture: 'Architektur', Sub_Foundations: 'Fundamente', Sub_Walls: 'Wände',
  Sub_Special: 'Spezial', Sub_Ladders: 'Leitern', Sub_Decor: 'Dekoration', Sub_Customization: 'Anpassung', Sub_Ramps: 'Rampen',
};
const SUB_DE = {
  Generators: 'Generatoren', 'Power Poles': 'Strommasten', 'Wall Poles': 'Wandanschlüsse', Attach: 'Anbauteile', Beams: 'Träger',
  Catwalks: 'Laufstege', Floors: 'Fundamente', Frames: 'Rahmen', Inverted: 'Umgekehrte Rampen', Lights: 'Beleuchtung', Pillars: 'Säulen',
  'Quat Pipes': 'Viertelrohre', Ramps: 'Rampen', Roofs: 'Dächer', Signs: 'Schilder', Storage: 'Lager', Towers: 'Türme', Utility: 'Nützliches',
  Walkways: 'Gehwege', 'Jump Pads': 'Sprungpads', Manufacturers: 'Fertiger', Miners: 'Abbau', 'Oil Production': 'Ölförderung',
  Smelters: 'Schmelzen', Workstations: 'Werkbänke', 'Blueprint Designers': 'Blaupausen-Designer', Progression: 'Fortschritt',
  'Conver Pole': 'Förderband-Stützen', 'Convey Lift': 'Förderlifte', 'Conveyor Attachments': 'Förderband-Anbauten',
  'Conveyor Belts': 'Förderbänder', Elevators: 'Aufzüge', 'Hyper Tubes': 'Hypertubes', Monitoring: 'Überwachung',
  'Pipe Support': 'Rohrstützen', Pipes: 'Rohre', Trains: 'Züge', 'Vehicle Paths': 'Fahrzeugwege', Vehicles: 'Fahrzeuge',
  'Angular Walls': 'Schräge Wände', 'Conveyor Connections': 'Förderband-Wanddurchlässe', 'Diagonal Walls': 'Diagonale Wände',
  Doors: 'Türen', 'Upper Diagonal Walls': 'Obere Diagonalwände', Walls: 'Wände', 'Window Frames': 'Fensterrahmen', Windows: 'Fenster',
};
const GUESS = {
  FGBuildableWallLightweight: ['Wände', 'Wände'], FGBuildableCornerWallLightweight: ['Wände', 'Wände'], FGBuildableWall: ['Wände', 'Wände'],
  FGBuildableFoundationLightweight: ['Organisation', 'Fundamente'], FGBuildableRampLightweight: ['Organisation', 'Rampen'],
  FGBuildableWalkwayLightweight: ['Organisation', 'Laufstege'], FGBuildableWalkway: ['Organisation', 'Laufstege'],
  FGBuildablePillarLightweight: ['Organisation', 'Säulen'], FGBuildableBeam: ['Organisation', 'Träger'], FGBuildableStair: ['Organisation', 'Anbauteile'],
  FGBuildableWidgetSign: ['Organisation', 'Schilder'], FGBuildablePoleBase: ['Organisation', 'Schilder'],
};
const FORM = { RF_SOLID: 'Fest', RF_LIQUID: 'Flüssig', RF_GAS: 'Gas' };

export function buildKatalog(docsFile) {
  const raw = fs.readFileSync(docsFile);
  const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le').slice(1) : raw.toString('utf8').replace(/^﻿/, '');
  const data = JSON.parse(text);
  const idx = new Map();
  for (const g of data) {
    const nc = g.NativeClass.split('.').pop().replace(/'$/, '');
    for (const c of g.Classes) idx.set(c.ClassName, [nc, c]);
  }

  // Volle Spielpfade: Rezepte (FullName) und Items (aus ItemClass-Angaben)
  const pfade = { rezepte: {}, items: {} };
  for (const [nc, c] of idx.values()) {
    if (nc === 'FGRecipe' && c.FullName) pfade.rezepte[c.ClassName] = c.FullName.replace(/^\S+\s+/, '');
    if (nc === 'FGRecipe' || nc === 'FGSchematic') for (const m of ((c.mIngredients || '') + (c.mProduct || '') + (c.mCost || '')).matchAll(/ItemClass="[^']*'([^']+)'"/g)) { const sh = short(m[1]); if (sh) pfade.items[sh] = m[1]; }
  }

  // Freischaltungen
  const unlock = new Map();
  const schematics = [];
  for (const [nc, c] of idx.values()) {
    if (nc !== 'FGSchematic') continue;
    const typ = c.mType || '', tier = num(c, 'mTechTier');
    const recs = [];
    for (const u of c.mUnlocks || []) for (const m of (u.mRecipes || '').matchAll(/'([^']+)'/g)) { const r = short(m[1]); if (r) recs.push(r); }
    schematics.push({ id: c.ClassName, name: c.mDisplayName || '', typ: TYPNAME[typ] || typ, stufe: tier, kosten: itemsList(c.mCost), rezepte: recs });
    const rank = typ === 'EST_Milestone' || typ === 'EST_Tutorial' || typ === 'EST_Custom' ? 0 : 1;
    for (const r of recs) {
      const old = unlock.get(r);
      const tn = TYPNAME[typ] || typ, nm = c.mDisplayName || '';
      if (!old || rank < old.rank || (rank === old.rank && tier < old.stufe)) unlock.set(r, { stufe: tier, durch: nm.startsWith(tn) || nm.includes('Upgrade') ? nm : `${nm} (${tn})`, rank });
    }
  }

  // Items
  const items = {};
  for (const [nc, c] of idx.values()) {
    if (!c.mDisplayName || nc === 'FGBuildingDescriptor' || nc === 'FGRecipe' || nc === 'FGSchematic' || nc === 'FGCustomizationRecipe') continue;
    if (!('mStackSize' in c) && !('mForm' in c)) continue;
    const kat = nc === 'FGResourceDescriptor' ? 'Ressource' : /Equip|Weapon|Gas|Suit|Jet|Hover|Chainsaw|Parachute|Stilts|Scanner|Dispenser|Ammo/.test(nc) ? 'Ausrüstung' : 'Teil';
    items[c.ClassName] = {
      name: clean(c.mDisplayName), beschreibung: clean(c.mDescription), kategorie: kat, form: FORM[c.mForm] || 'Fest',
      stapel: num(c, 'mCachedStackSize') || null, energieMJ: num(c, 'mEnergyValue') || null, sinkPunkte: num(c, 'mResourceSinkPoints') || null,
      icon: (c.mSmallIcon || '').replace('Texture2D ', '').split('.')[0] || null,
    };
  }
  const menge = (id, n) => (items[id] && items[id].form !== 'Fest' ? n / 1000 : n);

  // Gebaeude
  const buildRecipe = new Map();
  for (const [nc, c] of idx.values()) if (nc === 'FGRecipe' && (c.mProducedIn || '').includes('BuildGun')) {
    const p = itemsList(c.mProduct); if (p.length) buildRecipe.set(p[0][0], c);
  }
  const bnorm = new Map();
  for (const [name, [, c]] of idx) if (name.startsWith('Build_') && c.mDisplayName && !bnorm.has(norm(name.slice(6)))) bnorm.set(norm(name.slice(6)), name);
  // Descriptor -> Build-Klasse: erst exakt, dann unscharf (nur noch nicht vergebene Klassen)
  const descs = [...idx.values()].filter(([nc, c]) => nc === 'FGBuildingDescriptor' && buildRecipe.has(c.ClassName)).map(([, c]) => c);
  const claimed = new Set(), bidOf = new Map();
  for (const c of descs) {
    const base = c.ClassName.startsWith('Desc_') ? c.ClassName.slice(5) : c.ClassName;
    const exact = idx.has('Build_' + base) ? 'Build_' + base : bnorm.get(norm(base));
    if (exact) { bidOf.set(c.ClassName, exact); claimed.add(exact); }
  }
  // gleiche Namensbestandteile in anderer Reihenfolge (z. B. Desc_Wall_Orange_8x1_Tris / Build_Wall_Orange_Tris_8x1)
  const tok = (x) => x.replace(/^(Desc_|Build_)/, '').replace(/_C$/, '').toLowerCase().split('_').sort().join('|');
  const btok = new Map();
  for (const [name, [, c]] of idx) if (name.startsWith('Build_') && c.mDisplayName) btok.set(tok(name), name);
  for (const c of descs) {
    if (bidOf.has(c.ClassName)) continue;
    const t = btok.get(tok(c.ClassName));
    if (t && !claimed.has(t)) { bidOf.set(c.ClassName, t); claimed.add(t); }
  }
  for (const c of descs) {
    if (bidOf.has(c.ClassName)) continue;
    const key = norm(c.ClassName.startsWith('Desc_') ? c.ClassName.slice(5) : c.ClassName);
    const cand = bnorm.get(key.slice(0, -1) + '2c') || [...bnorm].find(([k, v]) => !claimed.has(v) && (k.startsWith(key.slice(0, -1)) || key.startsWith(k.slice(0, -1))))?.[1];
    if (cand) { bidOf.set(c.ClassName, cand); claimed.add(cand); }
  }
  const gebaeude = {};
  for (const c of descs) {
    const did = c.ClassName;
    const rec = buildRecipe.get(did);
    const bid = bidOf.get(did) || 'Build_' + (did.startsWith('Desc_') ? did.slice(5) : did);
    const [bnc, bc] = idx.get(bid) || [null, {}];
    const name = clean(bc.mDisplayName || rec.mDisplayName || c.mDisplayName);
    const m = /BuildCategories\/(Sub_[A-Za-z]+)\/([A-Za-z0-9_]+)\./.exec(c.mSubCategories || '');
    let sub = m ? m[2].replace(/^(SC_|Sub_)/, '').replace(/(?<=[a-z])(?=[A-Z])/g, ' ').replace(/_/g, ' ') : '';
    sub = SUB_DE[sub] || sub;
    const box = /ClearanceBox=\(Min=\(X=([-\d.]+),Y=([-\d.]+),Z=([-\d.]+)\),Max=\(X=([-\d.]+),Y=([-\d.]+),Z=([-\d.]+)\)/.exec(bc.mClearanceData || '');
    const ul = unlock.get(rec.ClassName);
    const w = {};
    if (num(bc, 'mPowerConsumption')) w.strom = num(bc, 'mPowerConsumption');
    if (num(bc, 'mEstimatedMaximumPowerConsumption')) w.stromVar = [num(bc, 'mEstimatedMininumPowerConsumption'), num(bc, 'mEstimatedMaximumPowerConsumption')];
    if (num(bc, 'mPowerProduction')) w.erzeugung = num(bc, 'mPowerProduction');
    if (num(bc, 'mSpeed') && /Conveyor/.test(bnc || '')) w.durchsatz = num(bc, 'mSpeed') / 2;
    if (num(bc, 'mFlowLimit')) w.durchfluss = num(bc, 'mFlowLimit') * 60;
    if (num(bc, 'mExtractCycleTime') && num(bc, 'mItemsPerCycle')) w.abbau = Math.round(num(bc, 'mItemsPerCycle') / num(bc, 'mExtractCycleTime') * 60 / (/Water|Oil|Fracking/.test(bid) ? 1000 : 1) * 100) / 100;
    if (num(bc, 'mInventorySizeX') && num(bc, 'mInventorySizeY')) w.slots = num(bc, 'mInventorySizeX') * num(bc, 'mInventorySizeY');
    gebaeude[bid] = {
      name, beschreibung: clean(bc.mDescription), kategorie: m ? (HAUPT[m[1]] || m[1]) : 'Sonstiges', unterkategorie: sub,
      prio: num(c, 'mMenuPriority'), stufe: ul ? ul.stufe : null, freischaltung: ul ? ul.durch : null,
      box: box ? box.slice(1).map(Number) : null, // [minX,minY,minZ,maxX,maxY,maxZ] in cm
      kosten: itemsList(rec.mIngredients), werte: w, rezept: rec.ClassName,
      icon: (c.mSmallIcon || '').replace('Texture2D ', '').split('.')[0] || null,
    };
  }

  // Waende und Daecher: Drehpunkt liegt im Spiel an der Unterkante (in deinen Blaupausen gemessen),
  // die Clearance-Box der Spieldaten ist aber um die Mitte beschrieben -> nach oben verschieben.
  const unten = (g) => g.box && (g.kategorie === 'Wände' || g.unterkategorie === 'Dächer') && Math.abs(g.box[2] + g.box[5]) < 2;
  const fixBox = (g) => { if (unten(g)) { const h = g.box[5] - g.box[2]; g.box = [g.box[0], g.box[1], 0, g.box[3], g.box[4], h]; } };
  for (const g of Object.values(gebaeude)) fixBox(g);

  // Bauteile ohne zuordenbaren Bauplan trotzdem aufnehmen (Name, Masse)
  for (const [name, [nc, c]] of idx) {
    if (!name.startsWith('Build_') || !c.mDisplayName || gebaeude[name]) continue;
    const box = /ClearanceBox=\(Min=\(X=([-\d.]+),Y=([-\d.]+),Z=([-\d.]+)\),Max=\(X=([-\d.]+),Y=([-\d.]+),Z=([-\d.]+)\)/.exec(c.mClearanceData || '');
    gebaeude[name] = { name: clean(c.mDisplayName), beschreibung: clean(c.mDescription), kategorie: GUESS[nc]?.[0] || 'Sonstiges', unterkategorie: GUESS[nc]?.[1] || nc.replace(/^FGBuildable/, ''),
      prio: 0, stufe: null, freischaltung: null, box: box ? box.slice(1).map(Number) : null, kosten: [], werte: {}, rezept: null, icon: null, ohneBauplan: true };
    fixBox(gebaeude[name]);
  }

  // Produktionsrezepte
  const rezepte = {};
  for (const [nc, c] of idx.values()) {
    if (nc !== 'FGRecipe' || (c.mProducedIn || '').includes('BuildGun')) continue;
    const dur = num(c, 'mManufactoringDuration');
    if (!dur) continue;
    const machines = [...(c.mProducedIn || '').matchAll(/"([^"]+)"/g)].map((x) => short(x[1])).filter((x) => gebaeude[x]);
    const z = itemsList(c.mIngredients), p = itemsList(c.mProduct);
    if (!p.length || ![...z, ...p].every(([i]) => items[i])) continue;
    const ul = unlock.get(c.ClassName);
    const rate = ([i, n]) => ({ item: i, menge: menge(i, n), proMin: Math.round(menge(i, n) * 60 / dur * 1000) / 1000 });
    rezepte[c.ClassName] = {
      name: clean(c.mDisplayName), dauer: dur, alternativ: c.ClassName.startsWith('Recipe_Alternate'), gebaeude: machines,
      zutaten: z.map(rate), produkte: p.map(rate), stufe: ul ? ul.stufe : null, freischaltung: ul ? ul.durch : null,
    };
  }
  return { erzeugt: new Date().toISOString(), quelle: docsFile, gebaeude, items, rezepte, freischaltungen: schematics, pfade };
}

/** Katalog laden – aus Cache, wenn die Spieldaten seitdem nicht geaendert wurden. */
export function loadKatalog(docsFile, cacheFile) {
  const st = fs.statSync(docsFile);
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (c.quelle === docsFile && c.quelleMtime === st.mtimeMs && c.version === 5) return c;
  } catch { /* neu erzeugen */ }
  const k = buildKatalog(docsFile);
  k.quelleMtime = st.mtimeMs; k.version = 5;
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(k));
  return k;
}
