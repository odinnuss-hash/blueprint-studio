// Baukasten (Beta): Maschinen frei auf einem Reißbrett anordnen, mit Bändern/Rohren verbinden, daraus eine Blaupause bauen.
// Nutzt die Bausteine des Planers (lib/fabrik.mjs): Anschlüsse der Fertigungsgebäude, Band-/Rohrteile, Strom, Fundament.
//
// Koordinaten wie im Spiel (cm, von oben): +X nach rechts (Osten), +Y nach unten (Süden). Drehung `rot` in Grad (0/90/180/270),
// wie die Gier im Spiel: lokaler Punkt (x, y) → (x·cos − y·sin, x·sin + y·cos).
import { vektorStellen, propListe, zerlege } from './eigenschaften.mjs';
import { umgebung, vorlagenPruefen, abschliessen, ROH, Z_BODEN, Z_BAND, BAND_KAPAZITAET, ROHR_KAPAZITAET, ROHR_BOGEN, ROHR_MAX } from './fabrik.mjs';

// Splitter/Merger/Kreuzung (Mitte auf Band- bzw. Rohrhöhe): Anschlüsse 1 m neben der Mitte. Namen gemessen (28.10.2026, eigene Blaupausen:
// je Anschluss Hunderte Band-/Rohrenden): Splitter Output1 = +X, Output2 = +Y, Output3 = −Y; Merger Input2 = +Y, Input3 = −Y.
const SPLITTER = { box: [-100, 100, -100, 100], ein: [['Input1', -100, 0, 0, 'b']], aus: [['Output3', 0, -100, 0, 'b'], ['Output1', 100, 0, 0, 'b'], ['Output2', 0, 100, 0, 'b']] };
const MERGER = { box: [-100, 100, -100, 100], ein: [['Input3', 0, -100, 0, 'b'], ['Input1', -100, 0, 0, 'b'], ['Input2', 0, 100, 0, 'b']], aus: [['Output1', 100, 0, 0, 'b']] };
export const ANBAU = {
  Build_ConveyorAttachmentSplitter_C: SPLITTER,
  Build_ConveyorAttachmentMerger_C: MERGER,
  Build_ConveyorAttachmentSplitterSmart_C: SPLITTER,
  Build_ConveyorAttachmentSplitterProgrammable_C: SPLITTER,
  Build_ConveyorAttachmentMergerPriority_C: MERGER,
  // Rohrkreuzung: alle vier Anschlüsse gleichwertig (Richtung ergibt sich aus dem Fluss)
  Build_PipelineJunction_Cross_C: { rohr: true, box: [-100, 100, -100, 100], ein: [['Connection0', -100, 0, 0, 'r']], aus: [['Connection1', 100, 0, 0, 'r'], ['Connection2', 0, 100, 0, 'r'], ['Connection3', 0, -100, 0, 'r']] },
};
// Weitere Gebäude: Anschlüsse gemessen (28.10.2026, eigene Blaupausen: Median der Band-/Rohr- und Kabelenden), Grundfläche aus den Spielmodellen
export const WEITERE = {
  Build_StorageContainerMk1_C: { gruppe: 'lager', box: [-250, 250, -500, 500], ein: [['Input0', 0, -400, 100, 'b']], aus: [['Output1', 0, 400, 100, 'b']] },
  Build_StorageContainerMk2_C: { gruppe: 'lager', box: [-250, 250, -500, 500], ein: [['Input0', 0, -400, 100, 'b']], aus: [['Output1', 0, 400, 100, 'b']] },
  Build_PipeStorageTank_C: { gruppe: 'lager', box: [-300, 300, -300, 300], ein: [['ConnectionAny1', 0, -200, 175, 'r']], aus: [['ConnectionAny0', 0, 200, 175, 'r']] },
  Build_IndustrialTank_C: { gruppe: 'lager', box: [-700, 700, -700, 700], ein: [['ConnectionAny1', 0, -600, 175, 'r']], aus: [['ConnectionAny0', 0, 600, 175, 'r']] },
  Build_CentralStorage_C: { gruppe: 'lager', box: [-250, 250, -500, 500], ein: [['Input0', 0, 390, 100, 'b']], aus: [], hinweis: 'Strom selbst anschließen' },
  Build_ResourceSink_C: { gruppe: 'sonst', box: [-550, 950, -700, 650], ein: [['Input0', 0, 500, 100, 'b']], aus: [], strom: ['FGPowerConnection', -361, -321, 898] },
  Build_WaterPump_C: { gruppe: 'sonst', box: [-1000, 1000, -550, 1350], ein: [], aus: [['FGPipeConnectionFactory', 0, -460, 240, 'r']], strom: ['PowerConnection', -593, 322, 1047], fest: { item: 'Desc_Water_C', menge: 120 } },
  Build_GeneratorCoal_C: { gruppe: 'strom', box: [-500, 500, -1350, 1250], ein: [['Input0', 200, 1100, 100, 'b'], ['FGPipeConnectionFactory', -200, 1142, 175, 'r']], aus: [], strom: ['PowerConnection', -267, -1312, 938] },
  Build_GeneratorFuel_C: { gruppe: 'strom', box: [-1000, 1000, -1000, 1000], ein: [['FGPipeConnectionFactory', 0, -860, 175, 'r']], aus: [], strom: ['PowerConnection', 0, 538, 920] },
  Build_GeneratorNuclear_C: { gruppe: 'strom', box: [-1750, 1750, -2050, 2400], ein: [['Input0', -200, 1988, 100, 'b'], ['FGPipeConnectionFactory', 0, 2065, 575, 'r']], aus: [['Output0', 200, 1988, 100, 'b']], strom: ['PowerConnection', -662, -1899, 889] },
  Build_PowerStorageMk1_C: { gruppe: 'strom', box: [-300, 300, -350, 300], ein: [], aus: [], strom: ['PowerConnection', 0, -321, 1150] },
};
const GRUPPE_FERTIGUNG = 'fertigung';

const farbeOk = (f) => (/^SwatchDesc_[A-Za-z0-9_]+$/.test(f || '') ? f : undefined);
const drehe = (x, y, rot) => { const a = (rot * Math.PI) / 180, c = Math.round(Math.cos(a) * 1e6) / 1e6, s = Math.round(Math.sin(a) * 1e6) / 1e6; return [x * c - y * s, x * s + y * c]; };
/** Gehäuse und Anschlüsse eines Bauteils, lokal bei Drehung 0 */
export function geometrie(cls) {
  if (ANBAU[cls]) return { ...ANBAU[cls], strom: null, anbau: true, gruppe: 'logistik', z: ANBAU[cls].rohr ? Z_BODEN + 175 : Z_BAND };
  if (WEITERE[cls]) return { ...WEITERE[cls], strom: WEITERE[cls].strom || null, anbau: false, z: Z_BODEN };
  const g = ROH[cls]; if (!g) return null;
  const b = g.box, box = g.yaw === 180 ? [-b[1], -b[0], -b[3], -b[2]] : b; // ROH.box gilt nach der Reihen-Drehung
  return { box, ein: g.ein, aus: g.aus, strom: g.strom, anbau: false, gruppe: GRUPPE_FERTIGUNG, z: Z_BODEN };
}

/** Daten für die Oberfläche: Bauteile mit Anschlüssen, Rezepte, Items */
export function baukastenDaten(kat, iconDa = () => true) {
  const icon = (p) => { const f = p ? p.split('/').pop() + '.png' : null; return f && iconDa(f) ? f : null; };
  const teile = [], gebaeude = {};
  // Freischaltung je Rezept (auch Bau-Rezepte der Gebäude): Meilenstein/HUB/Start vor M.A.M., Festplatte, AWESOME-Shop
  const RANG = { Start: 0, 'HUB-Upgrade': 1, Meilenstein: 2, 'M.A.M.-Forschung': 3, Festplatte: 4, 'AWESOME-Shop': 5 };
  const frei = {};
  for (const sc of kat.freischaltungen || []) {
    if (!(sc.typ in RANG)) continue;
    for (const r of sc.rezepte || []) { const alt = frei[r]; if (!alt || RANG[sc.typ] < RANG[alt.typ] || (RANG[sc.typ] === RANG[alt.typ] && (sc.stufe ?? 0) < (alt.stufe ?? 0))) frei[r] = { typ: sc.typ, stufe: sc.stufe ?? 0, name: sc.name }; }
  }
  for (const cls of [...Object.keys(ROH), ...Object.keys(ANBAU), ...Object.keys(WEITERE)]) {
    const g = kat.gebaeude[cls], geo = geometrie(cls); if (!geo || !g) continue;
    const rez = Object.entries(kat.rezepte).filter(([, r]) => r.gebaeude?.includes(cls)).map(([id]) => id);
    teile.push({ cls, name: g?.name || cls, icon: icon(g?.icon), mw: g?.werte?.strom ?? null, box: geo.box, anbau: geo.anbau, gruppe: geo.gruppe, hinweis: geo.hinweis || null, fest: geo.fest || null,
      ein: geo.ein.map(([n, x, y, z, art]) => ({ name: n, x, y, z, art })), aus: geo.aus.map(([n, x, y, z, art]) => ({ name: n, x, y, z, art })), rezepte: rez });
    gebaeude[cls] = { name: g.name, werte: { strom: g.werte?.strom ?? 0 }, frei: frei[g.rezept] || null, kosten: g.kosten || [] };
  }
  const rezepte = {}, items = {};
  const itemDazu = (id) => { if (items[id]) return; const it = kat.items[id]; items[id] = { name: it?.name || id, icon: icon(it?.icon), fluessig: /Flüssig|Gas/.test(it?.form || ''), kategorie: it?.kategorie || '', wert: it?.sinkPunkte || 0 }; };
  for (const t of teile) for (const id of t.rezepte) {
    const r = kat.rezepte[id];
    rezepte[id] = { name: r.name, alternativ: !!r.alternativ, gebaeude: r.gebaeude, frei: frei[id] || null, zutaten: r.zutaten.map((z) => ({ item: z.item, proMin: z.proMin })), produkte: r.produkte.map((z) => ({ item: z.item, proMin: z.proMin })) };
    for (const z of [...r.zutaten, ...r.produkte]) itemDazu(z.item);
  }
  for (const t of teile) if (t.fest) itemDazu(t.fest.item);
  for (const g of Object.values(gebaeude)) for (const [it] of g.kosten) itemDazu(it);
  return { teile, rezepte, items, gebaeude, band: BAND_KAPAZITAET, rohr: ROHR_KAPAZITAET };
}

// ------------------------------------------------------------------ Master-Class-Vorlagen als Block (nur eine Ebene)
const FUNDAMENT_RX = /Foundation|Ramp|QuarterPipe|Build_Walkway|Build_Catwalk/;
/** Vorlage auswerten: Boden-Höhe, Ebenen, Umriss (ohne die eigenen Fundamente), Maschinen/Rezepte */
export function vorlageAuswerten(bp) {
  const ents = bp.objects.filter((o) => o.kind === 'entity');
  const maschinen = ents.filter((o) => ROH[o.cls] || WEITERE[o.cls]);
  if (!maschinen.length) return { ok: false, grund: 'keine Maschinen' };
  const zs = maschinen.map((o) => o.pos[2]).sort((a, b) => a - b);
  let ebenen = 1; for (let i = 1; i < zs.length; i++) if (zs[i] - zs[i - 1] > 300) ebenen++;
  const boden = zs[zs.length >> 1];
  const behalten = ents.filter((o) => !(FUNDAMENT_RX.test(o.cls) && o.pos[2] <= boden + 20));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const dazu = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  for (const o of behalten) {
    if (/PowerLine|Wire/.test(o.cls)) continue;
    dazu(o.pos[0], o.pos[1]);
    const g = geometrie(o.cls);
    if (g) { const yaw = Math.atan2(2 * (o.rot[3] * o.rot[2] + o.rot[0] * o.rot[1]), 1 - 2 * (o.rot[1] ** 2 + o.rot[2] ** 2)) * 180 / Math.PI; for (const [a, b] of [[g.box[0], g.box[2]], [g.box[1], g.box[3]], [g.box[0], g.box[3]], [g.box[1], g.box[2]]]) { const a1 = yaw * Math.PI / 180; dazu(o.pos[0] + a * Math.cos(a1) - b * Math.sin(a1), o.pos[1] + a * Math.sin(a1) + b * Math.cos(a1)); } }
  }
  const ox = Math.round((x0 + x1) / 200) * 100, oy = Math.round((y0 + y1) / 200) * 100;
  const zaehl = {}, rez = {};
  for (const o of maschinen) { zaehl[o.cls] = (zaehl[o.cls] || 0) + 1; if (o.recipe) rez[o.recipe] = (rez[o.recipe] || 0) + 1; }
  return { ok: ebenen === 1, grund: ebenen > 1 ? `${ebenen} Ebenen` : null, ebenen, boden, ursprung: [ox, oy], box: [Math.floor(x0 - ox), Math.ceil(x1 - ox), Math.floor(y0 - oy), Math.ceil(y1 - oy)], maschinen: zaehl, rezepte: rez, weg: ents.length - behalten.length };
}

const qMul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
/** Objekte einer Vorlage verschoben/gedreht und mit neuen Namen (gleich lang) – fertig für createBlueprint */
export function vorlageObjekte(bp, info, { x, y, rot }, vergeben) {
  const ents = bp.objects.filter((o) => o.kind === 'entity');
  const weg = new Set(ents.filter((o) => FUNDAMENT_RX.test(o.cls) && o.pos[2] <= info.boden + 20).map((o) => o.instance));
  const namen = new Map();
  for (const o of ents) {
    if (weg.has(o.instance)) continue;
    const m = /^(.*\.)([A-Za-z0-9_]+?_)(\d+)$/.exec(o.instance); if (!m) continue;
    const lo = 10 ** (m[3].length - 1), hi = Math.min(10 ** m[3].length - 1, 2147483647);
    let neu; do { neu = m[2] + String(Math.floor(lo + Math.random() * (hi - lo))); } while (vergeben.has(neu));
    vergeben.add(neu); namen.set(m[2] + m[3], neu);
  }
  const ersetze = (buf) => {
    const t = buf.toString('latin1');
    const n = t.replace(/PersistentLevel\.([A-Za-z0-9_]+?_C_\d+)/g, (a, k) => (namen.has(k) ? 'PersistentLevel.' + namen.get(k) : a));
    return n === t ? Buffer.from(buf) : Buffer.from(n, 'latin1');
  };
  const a = (rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), q = [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
  const dz = Z_BODEN - info.boden, [ux, uy] = info.ursprung;
  const punkt = (p) => { const px = p[0] - ux, py = p[1] - uy; return [x + px * c - py * s, y + px * s + py * c, p[2] + dz]; };
  const objs = [];
  for (const o of bp.objects) {
    const eigner = o.kind === 'entity' ? o.instance : o.parent;
    if (weg.has(eigner)) continue;
    const head = ersetze(bp.body.subarray(o.hStart, o.hEnd));
    let data = ersetze(bp.body.subarray(o.dStart, o.dEnd));
    if (o.kind === 'entity') {
      const r = qMul(q, o.rot), p = punkt(o.pos);
      let k = o.tOff - o.hStart;
      for (const v of r) { head.writeFloatLE(v, k); k += 4; }
      for (const v of p) { head.writeFloatLE(v, k); k += 4; }
      if (/PowerLine/.test(o.cls)) { // Kabel: Locations (Welt) verschieben, CachedRelativeLocations nur drehen
        try {
          const stellen = vektorStellen(data.subarray(4), true, 'mWireInstances');
          stellen.forEach((st, i) => {
            const at = st + 4, v = [data.readDoubleLE(at), data.readDoubleLE(at + 8), data.readDoubleLE(at + 16)];
            const w = i % 4 < 2 ? punkt(v) : [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
            data.writeDoubleLE(w[0], at); data.writeDoubleLE(w[1], at + 8); data.writeDoubleLE(w[2], at + 16);
          });
        } catch { /* Kabel unverändert */ }
      }
      // Bänder/Förderlifte der Vorlage leeren (Items auf dem Band würden mitkommen)
      if (/^Build_Conveyor(Belt|Lift)/.test(o.cls)) {
        try {
          const ent = data.subarray(4), z = zerlege(ent, true);
          if (ent.length - z.noneEnd !== 8) { const neu = Buffer.concat([ent.subarray(0, z.noneEnd), Buffer.alloc(8)]), l = Buffer.alloc(4); l.writeInt32LE(neu.length); data = Buffer.concat([l, neu]); }
        } catch { /* unverändert */ }
      }
    }
    objs.push({ head, data });
  }
  const kosten = bp.header.costs || [], rezepte = bp.header.recipePaths || [];
  return { objs, kosten, rezepte, box: info.box.map((v, i) => v + (i < 2 ? x : y)), drehBox: (() => { const e = [[info.box[0], info.box[2]], [info.box[1], info.box[3]], [info.box[0], info.box[3]], [info.box[1], info.box[2]]].map(([px, py]) => [x + px * c - py * s, y + px * s + py * c]); return [Math.min(...e.map((v) => v[0])), Math.max(...e.map((v) => v[0])), Math.min(...e.map((v) => v[1])), Math.max(...e.map((v) => v[1]))]; })() };
}

// ------------------------------------------------------------------ Farben (Farbmuster-Plätze) aus einem Spielstand
/** Farbplätze (Primär/Sekundär, sRGB-Hex) aus dem entpackten Spielstand – mColorSlots_Data */
export function farbenLesen(body) {
  const st = body.indexOf('mColorSlots_Data\0', 0, 'latin1'); if (st < 0) return null;
  const out = []; let i = st;
  const lin = (v) => { const x = Math.max(0, Math.min(1, v)); return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)); };
  const hex = (p) => '#' + [0, 4, 8].map((k) => lin(body.readFloatLE(p + k)).toString(16).padStart(2, '0')).join('');
  while (out.length < 18) {
    i = body.indexOf('PrimaryColor\0', i + 1, 'latin1'); if (i < 0 || i - st > 40000) break;
    const l = propListe(body, i - 4);
    const P = l.props.find((p) => p.name === 'PrimaryColor'), S = l.props.find((p) => p.name === 'SecondaryColor');
    if (!P) break;
    out.push({ prim: hex(P.valStart), sek: S ? hex(S.valStart) : hex(P.valStart) });
  }
  return out.length ? out : null;
}

/**
 * Blaupause bauen. teile: [{ id, cls, x, y, rot, rezept }], verbindungen: [{ von: { id, port }, nach: { id, port }, punkte: [[x, y], …], mk }]
 * (punkte beginnen am Anschluss von „von“ und enden am Anschluss von „nach“; bei Bändern ist „von“ der Ausgang).
 */
// Sortierregeln (intelligenter/programmierbarer Splitter): t.regeln = { Output1: ['any'], Output2: ['Desc_IronPlate_C'], Output3: ['overflow'] }
// Spiel: OutputIndex 0 = Mitte (Output1), 1 = rechts (Output2), 2 = links (Output3) – aus Blaupausen des Spiels nachgezählt.
const REGEL_SONDER = { any: 'Desc_Wildcard', none: 'Desc_None', overflow: 'Desc_Overflow', rest: 'Desc_AnyUndefined' };
function sortierRegelnFuer(kat, t) {
  if (!/SplitterSmart|SplitterProgrammable/.test(t.cls)) return undefined;
  const max = /Programmable/.test(t.cls) ? 64 : 1, regeln = [];
  ['Output1', 'Output2', 'Output3'].forEach((out, index) => {
    let l = Array.isArray(t.regeln?.[out]) ? t.regeln[out].slice(0, max) : [];
    if (!l.length) l = [index === 0 && !t.regeln ? 'any' : 'none'];
    for (const r of l) {
      const s = REGEL_SONDER[r], pfad = s ? `/Game/FactoryGame/Resource/FilteringRules/${s}.${s}_C` : kat.pfade.items[r];
      if (pfad) regeln.push({ pfad, index });
    }
  });
  return regeln;
}
export function baueBaukasten({ kat, lib, ver, hasFlags, teile = [], verbindungen, strom = true, fundament, bloecke = [], ladeVorlage = null }) {
  if ((!Array.isArray(teile) || !teile.length) && !bloecke?.length) throw Object.assign(new Error('Das Reißbrett ist leer.'), { status: 400 });
  if (teile.length > 3000) throw Object.assign(new Error('Zu viele Teile für eine Blaupause (höchstens 3000).'), { status: 400 });
  const ctx = umgebung({ kat, lib, ver, bandMax: 6, strom });
  const { neu, verbinde, warnungen } = ctx;
  const mitRohr = (verbindungen || []).some((v) => v.art === 'r');
  vorlagenPruefen(ctx, teile.map((t) => t.cls), mitRohr);
  const nach = new Map();
  for (const t of teile) {
    const geo = geometrie(t.cls); if (!geo) throw Object.assign(new Error(`Unbekanntes Bauteil: ${t.cls}`), { status: 400 });
    const rot = ((Math.round(+t.rot / 90) * 90) % 360 + 360) % 360, x = Math.round(+t.x), y = Math.round(+t.y);
    if (![x, y].every(Number.isFinite)) throw Object.assign(new Error('Ungültige Lage'), { status: 400 });
    const ecken = [[geo.box[0], geo.box[2]], [geo.box[1], geo.box[2]], [geo.box[0], geo.box[3]], [geo.box[1], geo.box[3]]].map(([a, b]) => drehe(a, b, rot));
    const rezept = t.rezept && kat.rezepte[t.rezept]?.gebaeude?.includes(t.cls) ? t.rezept : undefined;
    const swatch = /^SwatchDesc_[A-Za-z0-9_]+$/.test(t.farbe || '') ? t.farbe : undefined;
    const teil = neu({ cls: t.cls, pos: [x, y, geo.z], yaw: rot, conn: {}, rezept, swatch, regeln: sortierRegelnFuer(kat, t) });
    teil.box = [x + Math.min(...ecken.map((e) => e[0])), x + Math.max(...ecken.map((e) => e[0])), y + Math.min(...ecken.map((e) => e[1])), y + Math.max(...ecken.map((e) => e[1]))];
    nach.set(t.id, { teil, geo, rot });
  }
  const port = (ref) => {
    const m = nach.get(ref?.id); if (!m) throw Object.assign(new Error('Verbindung zu einem fehlenden Teil.'), { status: 400 });
    const p = [...m.geo.ein, ...m.geo.aus].find((q) => q[0] === ref.port); if (!p) throw Object.assign(new Error(`Anschluss „${ref.port}“ fehlt.`), { status: 400 });
    const [dx, dy] = drehe(p[1], p[2], m.rot);
    return { m, name: p[0], art: p[4], pos: [m.teil.pos[0] + dx, m.teil.pos[1] + dy, m.teil.pos[2] + p[3]] };
  };
  const rohrCls = ['Build_PipelineMK2_C', 'Build_PipelineMK2_NoIndicator_C', 'Build_Pipeline_C', 'Build_Pipeline_NoIndicator_C'];
  let baender = 0, rohre = 0;
  const belegt = new Set();
  for (const v of verbindungen || []) {
    const a = port(v.von), b = port(v.nach);
    for (const e of [a, b]) { const k = e.m.teil.pos.join() + e.name; if (belegt.has(k)) throw Object.assign(new Error(`Anschluss „${e.name}“ ist doppelt verbunden.`), { status: 400 }); belegt.add(k); }
    if (a.art !== b.art) throw Object.assign(new Error('Band und Rohr lassen sich nicht verbinden.'), { status: 400 });
    const pts2 = Array.isArray(v.punkte) && v.punkte.length >= 2 ? v.punkte : [a.pos, b.pos];
    // Höhe: am Start wie Anschluss A, am Ende wie Anschluss B (dazwischen gleichmäßig)
    const pts = pts2.map((p, i) => [+p[0], +p[1], i === pts2.length - 1 ? b.pos[2] : a.pos[2]]);
    pts[0] = a.pos; pts[pts.length - 1] = b.pos;
    if (a.art === 'r') {
      const cls = (+v.mk >= 2 ? rohrCls : [rohrCls[2], rohrCls[3], rohrCls[0], rohrCls[1]]).find((c) => ctx.bg[c]) || rohrCls[0];
      rohre += pfad(ctx, { cls, a: 'PipelineConnection0', e: 'PipelineConnection1', rohr: true, swatch: farbeOk(v.farbe) }, pts, [a.m.teil, a.name], [b.m.teil, b.name]);
    } else {
      const mk = Math.max(1, Math.min(6, Math.round(+v.mk) || 1));
      baender += pfad(ctx, { cls: `Build_ConveyorBeltMk${mk}_C`, a: 'ConveyorAny0', e: 'ConveyorAny1', rohr: false, swatch: farbeOk(v.farbe) }, pts, [a.m.teil, a.name], [b.m.teil, b.name]);
    }
  }
  void verbinde;
  // Strom: je Maschine ein Mast 1,5 m außerhalb neben dem Stromanschluss, Masten der Reihe nach verbunden (nächster Nachbar)
  let masten = 0;
  if (strom && ctx.mastCls && ctx.kabelOk) {
    const liste = [...nach.values()].filter((m) => m.geo.strom);
    const gesetzt = [];
    for (const m of liste) {
      const [sn, sx, sy, sz] = m.geo.strom, [dx, dy] = drehe(sx, sy, m.rot), p = [m.teil.pos[0] + dx, m.teil.pos[1] + dy];
      // nach außen schieben: über die nächstgelegene Gehäusekante hinaus
      const b = m.teil.box, abst = [p[0] - b[0], b[1] - p[0], p[1] - b[2], b[3] - p[1]], k = abst.indexOf(Math.min(...abst));
      const mp = [k === 0 ? b[0] - 150 : k === 1 ? b[1] + 150 : p[0], k === 2 ? b[2] - 150 : k === 3 ? b[3] + 150 : p[1]];
      const mast = neu({ cls: ctx.mastCls, pos: [mp[0], mp[1], Z_BODEN], yaw: 0, conn: {} });
      mast.anschluss = [mp[0], mp[1], Z_BODEN + 700];
      ctx.draht(m.teil, sn, [p[0], p[1], Z_BODEN + sz], mast, 'PowerConnection', mast.anschluss);
      masten++; ctx.zaehler.masten++;
      if (gesetzt.length) { // mit dem nächstgelegenen schon gesetzten Mast verbinden
        const n = gesetzt.reduce((x, y) => (Math.hypot(y.pos[0] - mp[0], y.pos[1] - mp[1]) < Math.hypot(x.pos[0] - mp[0], x.pos[1] - mp[1]) ? y : x));
        ctx.draht(n, 'PowerConnection', n.anschluss, mast, 'PowerConnection', mast.anschluss);
      }
      gesetzt.push(mast);
    }
  } else if (strom) warnungen.push('Kein Strom verlegt: es fehlt eine Vorlage für Strommast oder Stromleitung aus deinen Blaupausen.');
  // Vorlagen (Master Class, eine Ebene) als Block: eigene Objekte verschoben/gedreht, unser Fundament darunter
  const block = [];
  const vergeben = new Set();
  for (const bl of bloecke || []) {
    const v = ladeVorlage?.(bl.id); if (!v) throw Object.assign(new Error('Vorlage nicht gefunden.'), { status: 400 });
    if (!v.info.ok) throw Object.assign(new Error(`Vorlage „${v.name}“ hat ${v.info.grund} – im Baukasten geht nur eine Ebene.`), { status: 400 });
    const rot = ((Math.round(+bl.rot / 90) * 90) % 360 + 360) % 360;
    block.push({ ...vorlageObjekte(v.bp, v.info, { x: Math.round(+bl.x), y: Math.round(+bl.y), rot }, vergeben), name: v.name });
  }
  const f = abschliessen(ctx, { fundament, hasFlags, extraXs: block.flatMap((b) => [b.drehBox[0], b.drehBox[1]]), extraYs: block.flatMap((b) => [b.drehBox[2], b.drehBox[3]]) });
  const maschinen = [...nach.values()].filter((m) => !m.geo.anbau).length;
  // Namen der Vorlagen dürfen nicht mit unseren kollidieren (sehr unwahrscheinlich) – sonst neu bauen lassen
  const objs = [...f.objs];
  for (const b of block) objs.push(...b.objs);
  const kosten = new Map(f.kopf.costs.map((c) => [c.path, { ...c }]));
  for (const b of block) for (const c of b.kosten) { const k = kosten.get(c.path); if (k) k.amount += c.amount; else kosten.set(c.path, { item: c.item, path: c.path, amount: c.amount }); }
  const kopf = { ...f.kopf, costs: [...kosten.values()], recipes: [...new Set([...f.kopf.recipes, ...block.flatMap((b) => b.rezepte)])] };
  return { objs, kopf, info: { maschinen, anbau: nach.size - maschinen, baender, rohre, masten, fundamente: f.fundamente, groesse: f.groesse, vorlagen: block.length, warnungen } };
}

/**
 * Band- oder Rohrverlauf durch die Punkte wie im Spiel: ein Teil je Abschnitt bis ROHR_MAX (56 m), Ecken als Bogen.
 * Liefert die Zahl der gebauten Teile.
 */
const BAND_BOGEN = 300;
function pfad(ctx, art, pts0, start, ende) {
  const sub = (a, b) => a.map((v, i) => v - b[i]), len = (d) => Math.hypot(...d), mul = (d, f) => d.map((v) => v * f), add = (a, b) => a.map((v, i) => v + b[i]);
  const p = [];
  for (const q of pts0) if (!p.length || len(sub(q, p[p.length - 1])) > 1) p.push(q);
  if (p.length < 2) p.push(add(p[0], [100, 0, 0]));
  for (let i = 1; i + 1 < p.length;) { const a = sub(p[i], p[i - 1]), b = sub(p[i + 1], p[i]); if (Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b)) > 0.9998) p.splice(i, 1); else i++; }
  const dir = (i) => { const d = sub(p[i + 1], p[i]); return mul(d, 1 / len(d)); };
  const ab = []; let von = p[0];
  for (let i = 1; i < p.length; i++) {
    const dIn = dir(i - 1);
    if (i === p.length - 1) { const d = sub(p[i], von); ab.push({ a: von, b: p[i], ta: d, tb: d, l: len(d) }); break; }
    const dOut = dir(i), th = Math.acos(Math.max(-1, Math.min(1, dIn[0] * dOut[0] + dIn[1] * dOut[1] + dIn[2] * dOut[2])));
    // Bogen: Bänder 3 m Radius (enger faltet das Spiel das Band), Rohre wie gemessen. Zwischen zwei Ecken teilen sie sich
    // die Strecke (je 45 %), an der ersten/letzten Strecke (Anschluss) darf der Bogen sie fast ganz nutzen.
    const fIn = i - 1 === 0 ? 0.9 : 0.45, fOut = i + 1 === p.length - 1 ? 0.9 : 0.45;
    const r = Math.min(art.rohr ? ROHR_BOGEN : BAND_BOGEN, fIn * len(sub(p[i], p[i - 1])), fOut * len(sub(p[i + 1], p[i])));
    const R = r / Math.tan(th / 2), tl = 4 * Math.tan(th / 4) * R;
    const A = sub(p[i], mul(dIn, r)), B = add(p[i], mul(dOut, r)), d = sub(A, von);
    if (len(d) > 1) ab.push({ a: von, b: A, ta: d, tb: d, l: len(d) });
    ab.push({ a: A, b: B, ta: mul(dIn, tl), tb: mul(dOut, tl), l: R * th });
    von = B;
  }
  const stuecke = [[]]; let summe = 0;
  for (let s of ab) {
    while (summe + s.l > ROHR_MAX && s.ta === s.tb && s.l > 200) {
      const rest = Math.max(100, Math.min(s.l - 100, ROHR_MAX - summe)), u = mul(s.ta, 1 / s.l), m = add(s.a, mul(u, rest));
      stuecke[stuecke.length - 1].push({ a: s.a, b: m, ta: mul(u, rest), tb: mul(u, rest), l: rest });
      stuecke.push([]); summe = 0;
      const d = sub(s.b, m); s = { a: m, b: s.b, ta: d, tb: d, l: len(d) };
    }
    if (summe + s.l > ROHR_MAX && stuecke[stuecke.length - 1].length) { stuecke.push([]); summe = 0; }
    stuecke[stuecke.length - 1].push(s); summe += s.l;
  }
  let vorher = start, n = 0;
  for (const liste of stuecke) {
    if (!liste.length) continue;
    const einh = (v) => mul(v, 1 / (len(v) || 1));
    const punkte = [{ loc: liste[0].a, arrive: einh(liste[0].ta), leave: liste[0].ta }];
    for (let k = 0; k < liste.length; k++) punkte.push({ loc: liste[k].b, arrive: liste[k].tb, leave: k + 1 < liste.length ? liste[k + 1].ta : einh(liste[k].tb) });
    const t = ctx.neu({ cls: art.cls, pos: punkte[0].loc, yaw: 0, conn: {}, spline: punkte.map((q) => q.loc), punkte, rohr: art.rohr, swatch: art.swatch });
    ctx.verbinde(vorher[0], vorher[1], t, art.a);
    vorher = [t, art.e]; n++;
  }
  ctx.verbinde(vorher[0], vorher[1], ende[0], ende[1]);
  return n;
}
