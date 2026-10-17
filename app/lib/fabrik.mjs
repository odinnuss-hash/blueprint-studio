// Fabrikplaner → Blaupause: Fertigungsstufen als Maschinenreihen, ganze/teilweise Fabriken als verbundene Reihen.
//
// Reihe (Blick von oben, Fluss von −Y nach +Y durch die Maschinen):
//   Eingang ─▶ [S]──▶[S]──▶[S]   je Zutat eine Leitung (Band: Splitter, Rohr: Kreuzung); weitere Leitungen 8 m
//               │     │     │      weiter außen und 3 m höher, Zuführung als S-Kurve darüber hinweg
//              [M]   [M]   [M]    Maschinen, je Maschine ein Strommast daneben
//               │     │     │
//              [V]──▶[V]──▶[V] ─▶ je Produkt eine Sammelleitung (Band: Merger, Rohr: Kreuzung), Nebenprodukt fest
//                                  und unbenutzt → AWESOME-Schredder
// Alles auf 8×1-Fundamenten (Oberkante z = 100), Schilder an Ein- und Ausgängen.

import { i32, fstr, makeHead, templateFor } from './vorlagen.mjs';
import { setzeVerweis, entferne, baueSpline, setzeSchildTexte, setzeDraehte, zerlege, propListe } from './eigenschaften.mjs';

// Anschlüsse der Fertigungsgebäude, lokal (cm) bei Drehung 0 wie im Spiel; `yaw` = Drehung in der Reihe, damit alle
// Eingänge auf −Y und alle Ausgänge auf +Y liegen. box = [x0, x1, y0, y1] nach Drehung. art: b = Band, r = Rohr.
const ROH = {
  Build_SmelterMk1_C: { strom: ['PowerConnection', -220, 280, 480], box: [-250, 250, -500, 500], ein: [['Input0', 0, -300, 100, 'b']], aus: [['Output2', 0, 200, 100, 'b']] },
  Build_ConstructorMk1_C: { strom: ['PowerInput', 210, -470, 687], box: [-400, 400, -500, 500], ein: [['Input0', 0, -300, 100, 'b']], aus: [['Output0', 0, 300, 100, 'b']] },
  Build_AssemblerMk1_C: { strom: ['PowerInput', 484, 124, 695], box: [-450, 450, -800, 800], ein: [['Input0', 200, -600, 100, 'b'], ['Input1', -200, -600, 100, 'b']], aus: [['Output0', 0, 500, 100, 'b']] },
  Build_FoundryMk1_C: { strom: ['PowerConnection', -420, 320, 555], box: [-500, 500, -500, 500], ein: [['Input0', 200, -300, 100, 'b'], ['Input1', -200, -300, 100, 'b']], aus: [['Output2', -200, 200, 100, 'b']] },
  Build_ManufacturerMk1_C: { strom: ['PowerConnection', 840, 495, 1015], box: [-900, 900, -900, 900], ein: [['Input0', 600, -875, 100, 'b'], ['Input1', 200, -875, 100, 'b'], ['Input2', -200, -875, 100, 'b'], ['Input3', -600, -875, 100, 'b']], aus: [['Output0', 0, 800, 100, 'b']] },
  // Raffinerie hat Eingänge auf +Y → in der Reihe um 180° gedreht
  Build_OilRefinery_C: { yaw: 180, strom: ['PowerConnection', 0, 969, 1872], box: [-500, 500, -1100, 1100], ein: [['Input0', 200, 900, 100, 'b'], ['PipeInputFactory', -200, 900, 175, 'r']], aus: [['Output1', 200, -900, 100, 'b'], ['PipeOutputFactory', -200, -900, 175, 'r']] },
  Build_Blender_C: { strom: ['PowerConnection', -881, -690, 1094], box: [-1000, 1000, -800, 800], ein: [['Input0', 200, -700, 100, 'b'], ['Input1', 600, -700, 100, 'b'], ['PipeInputFactory', -200, -700, 175, 'r'], ['PipeInputFactory1', -600, -700, 175, 'r']], aus: [['Output1', -200, 700, 100, 'b'], ['PipeOutputFactory', -600, 740, 175, 'r']] },
  Build_Packager_C: { strom: ['PowerConnection', -219, 48, 1074], box: [-400, 400, -400, 400], ein: [['Input0', 0, -300, 100, 'b'], ['PipeInputFactory', 0, -380, 375, 'r']], aus: [['Output1', 0, 300, 100, 'b'], ['PipeOutputFactory', 0, 350, 375, 'r']] },
  Build_Converter_C: { strom: ['PowerInput', 525, -767, 508], box: [-800, 800, -800, 800], ein: [['Input0', -200, -680, 100, 'b'], ['Input1', 200, -680, 100, 'b']], aus: [['Output0', 200, 660, 100, 'b'], ['FGPipeConnectionFactory', -200, 700, 175, 'r']] },
};
const dreh = (x, y, yaw) => (yaw === 180 ? [-x, -y] : [x, y]);
export const GEO = Object.fromEntries(Object.entries(ROH).map(([c, g]) => {
  const w = g.yaw || 0, port = ([n, x, y, z, art]) => { const [a, b] = dreh(x, y, w); return { name: n, x: a, y: b, z, art }; };
  const [sx, sy] = dreh(g.strom[1], g.strom[2], w);
  return [c, { yaw: w, box: g.box, strom: [g.strom[0], sx, sy, g.strom[3]], ein: g.ein.map(port), aus: g.aus.map(port) }];
}));
export const MASCHINEN = Object.keys(GEO);
const BAND = [0, 60, 120, 270, 480, 780, 1200];
const ROHR = [0, 300, 600];
const Z_BODEN = 100;            // Oberkante Fundament
const Z_BAND = Z_BODEN + 100;   // Anschlusshöhe von Bändern, Splittern, Kreuzungen
const FUNDAMENTE = ['Build_Foundation_ConcretePolished_8x1_C', 'Build_Foundation_8x1_01_C', 'Build_Foundation_Concrete_8x1_C', 'Build_Foundation_Asphalt_8x1_C', 'Build_Foundation_Metal_8x1_C'];
const SCHILDER = ['Build_StandaloneWidgetSign_SmallVeryWide_C', 'Build_StandaloneWidgetSign_SmallWide_C', 'Build_StandaloneWidgetSign_Small_C'];
const SCHREDDER = { cls: 'Build_ResourceSink_C', ein: ['Input0', 0, 500, 100], strom: ['FGPowerConnection', -361, -321, 898] };

const quatYaw = (deg) => { const a = deg * Math.PI / 360; return [0, 0, Math.sin(a), Math.cos(a)]; };
const zahl = (v) => (Math.round(v * 100) / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 });
const istFluessig = (kat, it) => /Flüssig|Gas/.test(kat?.items?.[it]?.form || '');

/** Zutaten/Produkte den Band- und Rohranschlüssen zuordnen; null wenn es nicht passt */
function zuordnen(kat, schritt) {
  const g = GEO[schritt.gebaeude];
  if (!g) return null;
  const teile = (liste, ports) => {
    const frei = { b: ports.filter((p) => p.art === 'b'), r: ports.filter((p) => p.art === 'r') };
    const out = [];
    for (const z of liste) { const p = frei[istFluessig(kat, z.item) ? 'r' : 'b'].shift(); if (!p) return null; out.push({ ...z, port: p, art: p.art }); }
    return out;
  };
  const ein = teile(schritt.zutaten, g.ein), aus = teile(schritt.produkte, g.aus);
  return ein && aus ? { ein, aus } : null;
}

/** Welche Schritte lassen sich als Reihe bauen? */
export function baubar(schritt, kat) {
  const g = GEO[schritt.gebaeude];
  if (!g) return { ok: false, grund: 'Für dieses Gebäude gibt es noch keinen Reihen-Bauplan.' };
  if (!zuordnen(kat, schritt)) return { ok: false, grund: 'Die Zutaten/Produkte passen nicht auf die Anschlüsse dieses Gebäudes.' };
  return { ok: true };
}

// ------------------------------------------------------------------ Gemeinsame Bau-Umgebung
function umgebung({ kat, lib, ver, bandMax, strom }) {
  const bg = lib.baugruppen?.[String(ver)] || {};
  const teile = [], warnungen = [];
  const neu = (t) => { teile.push(t); return t; };
  const verbinde = (a, ka, b2, kb) => { a.conn[ka] = [b2, kb]; b2.conn[kb] = [a, ka]; };
  const band = (mk, von, nach, kurve = false) => neu({ cls: `Build_ConveyorBeltMk${mk}_C`, pos: von, yaw: 0, conn: {}, spline: [von, nach], kurve });
  const rohrCls = (mk) => { const w = mk >= 2 ? ['Build_PipelineMK2_C', 'Build_PipelineMK2_NoIndicator_C', 'Build_Pipeline_C', 'Build_Pipeline_NoIndicator_C'] : ['Build_Pipeline_C', 'Build_Pipeline_NoIndicator_C', 'Build_PipelineMK2_C', 'Build_PipelineMK2_NoIndicator_C']; return w.find((c) => bg[c]) || w[0]; };
  const rohr = (mk, von, nach, kurve = false) => neu({ cls: rohrCls(mk), pos: von, yaw: 0, conn: {}, spline: [von, nach], kurve, rohr: true });
  const mkFuer = (menge) => { let mk = BAND.findIndex((c, k) => k > 0 && c >= menge - 1e-6); if (mk < 0) mk = 6; return Math.min(mk, bandMax); };
  const rohrMk = (menge) => (menge > ROHR[1] + 1e-6 ? 2 : 1);
  const name = (it) => kat.items[it]?.name || it;
  const mastCls = ['Build_PowerPoleMk1_C', 'Build_PowerPoleMk2_C', 'Build_PowerPoleMk3_C'].find((c) => bg[c]?.komp?.some((k) => /PowerConnection/i.test(k.name)));
  const kabelOk = !!templateFor(lib, kat, ver, 'Build_PowerLine_C');
  const zaehler = { masten: 0, kabel: 0, schredder: 0 };
  // Kabel von Ende A (a.ka bei pa) nach Ende B (b2.kb bei pb). Lage = Ende B, Gier zeigt nach A.
  const draht = (a, ka, pa, b2, kb, pb) => {
    const d = [pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]];
    const yaw = Math.atan2(d[1], d[0]);
    const l = neu({ cls: 'Build_PowerLine_C', pos: pb, rot: [0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2)], einfach: true,
      kabel: { a: [a, ka], b: [b2, kb], locA: pa, locB: pb, relA: [Math.hypot(d[0], d[1]), 0, d[2]], laenge: Math.hypot(...d) } });
    (a.draehte ||= {})[ka] ||= []; a.draehte[ka].push(l);
    (b2.draehte ||= {})[kb] ||= []; b2.draehte[kb].push(l);
    zaehler.kabel++;
  };
  const schildCls = SCHILDER.find((c) => templateFor(lib, kat, ver, c));
  const schild = (pos, yaw, text, label) => (schildCls ? neu({ cls: schildCls, pos, yaw, schild: { Name: text, Label: label } }) : null);
  /** Leitungsstück passend zur Art: Band oder Rohr, Anschlussnamen der Enden */
  const stueck = (art, mk, von, nach, kurve = false) => (art === 'r'
    ? { t: rohr(mk, von, nach, kurve), a: 'PipelineConnection0', e: 'PipelineConnection1' }
    : { t: band(mk, von, nach, kurve), a: 'ConveyorAny0', e: 'ConveyorAny1' });
  /** AWESOME-Schredder: Eingang am Punkt p (Bandende), Band kommt in Richtung dir (+1 = +X, −1 = −X); Strom zum Mast */
  const schredder = (p, dir, quelle, mast) => {
    if (!bg[SCHREDDER.cls]) { if (!zaehler.schredderGewarnt) { zaehler.schredderGewarnt = true; warnungen.push('Kein AWESOME-Schredder angeschlossen: keine Vorlage aus deinen Blaupausen (eine Blaupause mit Schredder speichern).'); } return false; }
    // Eingang lokal (0, 500) zeigt nach +Y; gedreht so, dass er dem Band entgegen schaut
    const yaw = dir > 0 ? -90 : 90, rad = (yaw * Math.PI) / 180;
    const rot = (x, y) => [x * Math.cos(rad) - y * Math.sin(rad), x * Math.sin(rad) + y * Math.cos(rad)];
    const [ix, iy] = rot(SCHREDDER.ein[1], SCHREDDER.ein[2]);
    const s = neu({ cls: SCHREDDER.cls, pos: [p[0] - ix, p[1] - iy, Z_BODEN], yaw, conn: {} });
    verbinde(quelle[0], quelle[1], s, SCHREDDER.ein[0]);
    if (mast && ctxStrom()) { const [sx, sy] = rot(SCHREDDER.strom[1], SCHREDDER.strom[2]); draht(s, SCHREDDER.strom[0], [s.pos[0] + sx, s.pos[1] + sy, Z_BODEN + SCHREDDER.strom[3]], mast, 'PowerConnection', mast.anschluss); }
    zaehler.schredder++;
    s.box = [s.pos[0] - 800, s.pos[0] + 800, s.pos[1] - 800, s.pos[1] + 800];
    return s;
  };
  const ctxStrom = () => strom && mastCls && kabelOk;
  return { kat, lib, ver, bg, teile, warnungen, neu, verbinde, band, rohr, stueck, mkFuer, rohrMk, name, mastCls, kabelOk, strom, draht, zaehler, schild, schildCls, schredder };
}

function vorlagenPruefen(ctx, klassen, mitRohr) {
  const { bg, kat, ver } = ctx;
  const fehlt = [...new Set(klassen)].filter((c) => !bg[c]);
  if (!Object.keys(bg).some((c) => /ConveyorBeltMk/.test(c))) fehlt.push('Build_ConveyorBeltMk1_C');
  if (mitRohr && !Object.keys(bg).some((c) => /^Build_Pipeline(MK2)?(_NoIndicator)?_C$/.test(c))) fehlt.push('Build_PipelineMK2_C');
  if (mitRohr && !bg.Build_PipelineJunction_Cross_C) fehlt.push('Build_PipelineJunction_Cross_C');
  if (fehlt.length) throw Object.assign(new Error(`Für die Blaupause fehlen Vorlagen aus deinen eigenen Blaupausen (Spielversion ${ver}): ${fehlt.map((c) => kat.gebaeude[c]?.name || c).join(', ')}. Bitte eine Blaupause speichern, in der diese Bauteile vorkommen.`), { status: 422 });
}

/** Maße einer Reihe relativ zu ihrer Mitte (für das Stapeln mehrerer Reihen) */
function reiheMasse(schritt, kat) {
  const g = GEO[schritt.gebaeude], z = zuordnen(kat, schritt);
  const inY = Math.min(...z.ein.map((e) => e.port.y)), outY = Math.max(...z.aus.map((a) => a.port.y));
  const y0 = z.ein.length > 1 ? inY - 600 : inY - 400, yA = z.aus.length > 1 ? outY + 600 : outY + 400;
  return { yMin: Math.min(g.box[2], y0 - (z.ein.length - 1) * 800) - 100, yMax: Math.max(g.box[3], yA + (z.aus.length - 1) * 800) + 100 };
}

/**
 * Eine Maschinenreihe um die Mitte (0, oy). Je Zutat eine Verteilerleitung, je Produkt eine Sammelleitung.
 * Liefert Anschlusspunkte: eingaenge[k] = { item, menge, art, mk, y, z, anker:[teil, komp] (frei, linkes Ende), x }
 * ausgaenge[k] = { item, menge, art, mk, y, z, anker:[teil, komp] (frei), x } – Bandausgänge zeigen nach links
 * (ausgangLinks) bzw. rechts; Rohr-Ausgänge nach rohrSeite (−1 links / +1 rechts).
 */
function reihe(ctx, schritt, { oy = 0, ausgangLinks = false, rohrSeite = null } = {}) {
  const { neu, verbinde, stueck, mkFuer, rohrMk, name, warnungen, kat } = ctx;
  const cls = schritt.gebaeude, g = GEO[cls], n = schritt.anzahl;
  const zu = zuordnen(kat, schritt);
  const breite = g.box[1] - g.box[0];
  const abstand = Math.ceil((breite + 200) / 400) * 400;
  const x0 = -((n - 1) * abstand) / 2;
  const inY = Math.min(...zu.ein.map((e) => e.port.y)), outY = Math.max(...zu.aus.map((a) => a.port.y));
  const y0 = zu.ein.length > 1 ? inY - 600 : inY - 400;
  const yA = zu.aus.length > 1 ? outY + 600 : outY + 400;
  const kap = (art, menge) => (art === 'r' ? { mk: rohrMk(menge), max: ROHR[rohrMk(menge)] } : { mk: mkFuer(menge), max: BAND[mkFuer(menge)] });
  const ein = zu.ein.map((z, k) => ({ ...z, y: oy + y0 - k * 800, z: Z_BAND + k * 300, ...kap(z.art, z.proMin), knoten: [] }));
  const aus = zu.aus.map((z, k) => ({ ...z, y: oy + yA + k * 800, z: Z_BAND + k * 300, ...kap(z.art, z.proMin), knoten: [] }));
  for (const L of [...ein, ...aus]) if (L.max < L.proMin - 1e-6) warnungen.push(`${schritt.name}: ${name(L.item)} ${zahl(L.proMin)}/min passt nicht auf ${L.art === 'r' ? 'ein Rohr' : 'ein Förderband'} Mk.${L.mk} (${L.max}/min).`);
  const rs = rohrSeite ?? (ausgangLinks ? -1 : 1);
  const maschinen = [];
  for (let i = 0; i < n; i++) {
    const x = x0 + i * abstand;
    const m = neu({ cls, pos: [x, oy, Z_BODEN], yaw: g.yaw, conn: {}, rezept: schritt.rezept });
    for (const L of ein) {
      const p = L.port, ziel = [x + p.x, oy + p.y, Z_BODEN + p.z];
      const k = L.art === 'r'
        ? { t: neu({ cls: 'Build_PipelineJunction_Cross_C', pos: [x + p.x, L.y, L.z], yaw: 0, conn: {} }), zu: 'Connection2', rein: 'Connection0', weiter: 'Connection1' }
        : { t: neu({ cls: 'Build_ConveyorAttachmentSplitter_C', pos: [x + p.x, L.y, L.z], yaw: 0, conn: {} }), zu: 'Output2', rein: 'Input1', weiter: 'Output1' };
      const f = stueck(L.art, L.mk, [x + p.x, L.y + 100, L.z], ziel, Math.abs(L.z - ziel[2]) > 1);
      verbinde(k.t, k.zu, f.t, f.a); verbinde(f.t, f.e, m, p.name);
      L.knoten.push(k);
    }
    for (const L of aus) {
      const p = L.port, von = [x + p.x, oy + p.y, Z_BODEN + p.z];
      // Band: Merger (bei Ausgang links um 180° gedreht, Maschine an Eingang 2), Rohr: Kreuzung (Connection3 zur Maschine)
      const k = L.art === 'r'
        ? { t: neu({ cls: 'Build_PipelineJunction_Cross_C', pos: [x + p.x, L.y, L.z], yaw: 0, conn: {} }), von: 'Connection3', links: 'Connection0', rechts: 'Connection1' }
        : (ausgangLinks
          ? { t: neu({ cls: 'Build_ConveyorAttachmentMerger_C', pos: [x + p.x, L.y, L.z], yaw: 180, conn: {} }), von: 'Input2', rein: 'Input1', raus: 'Output1' }
          : { t: neu({ cls: 'Build_ConveyorAttachmentMerger_C', pos: [x + p.x, L.y, L.z], yaw: 0, conn: {} }), von: 'Input3', rein: 'Input1', raus: 'Output1' });
      const f = stueck(L.art, L.mk, von, [x + p.x, L.y - 100, L.z], Math.abs(L.z - von[2]) > 1);
      verbinde(m, p.name, f.t, f.a); verbinde(f.t, f.e, k.t, k.von);
      L.knoten.push(k);
    }
    maschinen.push(m);
  }
  // Abstände der S-Kurven über tiefere Leitungen prüfen
  const pruefe = (liste, yMasch) => {
    for (const [k, L] of liste.entries()) for (const J of liste.slice(0, k)) {
      const ys = L.y + Math.sign(yMasch - L.y) * 100, t = (J.y - ys) / (yMasch - ys), hz = L.z + (Z_BAND - L.z) * (3 * t * t - 2 * t * t * t);
      if (hz - J.z < 90) warnungen.push(`${schritt.name}: Leitung ${name(L.item)} kreuzt ${name(J.item)} nur ${Math.round(hz - J.z)} cm darüber.`);
    }
  };
  pruefe(ein, oy + inY); pruefe(aus, oy + outY);
  // Ketten der Leitungen
  for (const L of ein) for (let i = 0; i + 1 < n; i++) {
    const a = L.knoten[i], b = L.knoten[i + 1];
    const f = stueck(L.art, L.mk, [a.t.pos[0] + 100, L.y, L.z], [b.t.pos[0] - 100, L.y, L.z]);
    verbinde(a.t, a.weiter, f.t, f.a); verbinde(f.t, f.e, b.t, b.rein);
  }
  for (const L of aus) for (let i = 0; i + 1 < n; i++) {
    const a = L.knoten[i], b = L.knoten[i + 1];
    if (L.art === 'r') { const f = stueck('r', L.mk, [a.t.pos[0] + 100, L.y, L.z], [b.t.pos[0] - 100, L.y, L.z]); verbinde(a.t, a.rechts, f.t, f.a); verbinde(f.t, f.e, b.t, b.links); }
    else if (ausgangLinks) { const f = stueck('b', L.mk, [b.t.pos[0] - 100, L.y, L.z], [a.t.pos[0] + 100, L.y, L.z]); verbinde(b.t, b.raus, f.t, f.a); verbinde(f.t, f.e, a.t, a.rein); }
    else { const f = stueck('b', L.mk, [a.t.pos[0] + 100, L.y, L.z], [b.t.pos[0] - 100, L.y, L.z]); verbinde(a.t, a.raus, f.t, f.a); verbinde(f.t, f.e, b.t, b.rein); }
  }
  // Strom: je Maschine ein Mast in der Lücke rechts daneben, Maschine → Mast, Mast → nächster Mast
  const masten = [];
  if (ctx.strom && ctx.mastCls && ctx.kabelOk) {
    const [sk, sx, sy, sz] = g.strom;
    for (const m of maschinen) {
      const mast = neu({ cls: ctx.mastCls, pos: [m.pos[0] + abstand / 2, oy, Z_BODEN], yaw: 0, conn: {} });
      mast.anschluss = [mast.pos[0], oy, Z_BODEN + 700];
      ctx.zaehler.masten++;
      ctx.draht(m, sk, [m.pos[0] + sx, oy + sy, Z_BODEN + sz], mast, 'PowerConnection', mast.anschluss);
      const vorher = masten[masten.length - 1];
      if (vorher) ctx.draht(vorher, 'PowerConnection', vorher.anschluss, mast, 'PowerConnection', mast.anschluss);
      masten.push(mast);
    }
  } else if (ctx.strom && !ctx.stromGewarnt) { ctx.stromGewarnt = true; warnungen.push('Kein Strom verlegt: es fehlt eine Vorlage für Strommast oder Stromleitung aus deinen Blaupausen.'); }
  const eingaenge = ein.map((L) => {
    const k0 = L.knoten[0], kn = L.knoten[n - 1];
    const links = L.art === 'b' || rs < 0;
    return { item: L.item, menge: L.proMin, art: L.art, mk: L.mk, y: L.y, z: L.z, seite: links ? -1 : 1,
      anker: links ? [k0.t, k0.rein] : [kn.t, kn.weiter], x: links ? k0.t.pos[0] - 100 : kn.t.pos[0] + 100 };
  });
  const ausgaenge = aus.map((L) => {
    const k0 = L.knoten[0], kn = L.knoten[n - 1];
    if (L.art === 'r') { const links = rs < 0; return { item: L.item, menge: L.proMin, art: 'r', mk: L.mk, y: L.y, z: L.z, seite: links ? -1 : 1, anker: links ? [k0.t, k0.links] : [kn.t, kn.rechts], x: links ? k0.t.pos[0] - 100 : kn.t.pos[0] + 100 }; }
    const e = ausgangLinks ? k0 : kn;
    return { item: L.item, menge: L.proMin, art: 'b', mk: L.mk, y: L.y, z: L.z, seite: ausgangLinks ? -1 : 1, anker: [e.t, e.raus], x: e.t.pos[0] + (ausgangLinks ? -100 : 100) };
  });
  const xs = [...maschinen.map((m) => m.pos[0] + g.box[0]), ...maschinen.map((m) => m.pos[0] + g.box[1]), ...eingaenge.map((e) => e.x), ...ausgaenge.map((a) => a.x)];
  const mm = reiheMasse(schritt, kat);
  return { schritt, maschinen, masten, eingaenge, ausgaenge, abstand, leitungen: ein.length, xMin: Math.min(...xs), xMax: Math.max(...xs), yMin: oy + mm.yMin, yMax: oy + mm.yMax };
}

/** Fundamente (8-m-Raster unter allem), Objekte erzeugen, Kopf (Baukosten, Rezepte, Größe) */
function abschliessen(ctx, { fundament, hasFlags, extraXs = [], extraYs = [] }) {
  const { kat, lib, ver, teile, neu, warnungen } = ctx;
  const fCls = [fundament, ...FUNDAMENTE].find((c) => c && templateFor(lib, kat, ver, c));
  const xs = [...extraXs], ys = [...extraYs];
  for (const t of teile) { for (const p of t.spline || [t.pos]) { xs.push(p[0]); ys.push(p[1]); } if (t.box) { xs.push(t.box[0], t.box[1]); ys.push(t.box[2], t.box[3]); } }
  const fx0 = Math.floor((Math.min(...xs) - 100) / 800), fx1 = Math.ceil((Math.max(...xs) + 100) / 800);
  const fy0 = Math.floor((Math.min(...ys) - 100) / 800), fy1 = Math.ceil((Math.max(...ys) + 100) / 800);
  let fundamente = 0;
  if (fCls) for (let ix = fx0; ix < fx1; ix++) for (let iy = fy0; iy < fy1; iy++) { neu({ cls: fCls, pos: [ix * 800 + 400, iy * 800 + 400, Z_BODEN - 50], yaw: 0, einfach: true }); fundamente++; }
  else warnungen.push('Keine Fundament-Vorlage gefunden – Blaupause ohne Fundamente.');
  const objs = baueObjekte({ kat, lib, ver, hasFlags, teile });
  for (const c of new Set(teile.map((t) => t.cls))) if (ctx.bg[c]?.inhalt && GEO[c]) warnungen.push(`Die Vorlage für ${kat.gebaeude[c]?.name || c} stammt aus „${ctx.bg[c].quelle}“ und hat Gegenstände im Lager – die kommen mit. Besser eine im Spiel gespeicherte Blaupause mit diesem Gebäude anlegen.`);
  const kosten = {}, rezepte = new Set();
  for (const t of teile) {
    const gb = kat.gebaeude[t.cls];
    if (!gb) continue;
    const rp = kat.pfade.rezepte[gb.rezept];
    if (rp) rezepte.add(rp);
    if (/ConveyorBelt|ConveyorLift|PowerLine|Pipeline_|PipelineMK2|^Build_Pipeline_C$/.test(t.cls)) continue;
    for (const [item, m] of gb.kosten || []) kosten[item] = (kosten[item] || 0) + m;
  }
  const kopf = {
    costs: Object.entries(kosten).filter(([it]) => kat.pfade.items[it]).map(([item, amount]) => ({ item, path: kat.pfade.items[item], amount })),
    recipes: [...rezepte],
    dimensions: [Math.max(1, fx1 - fx0), Math.max(1, fy1 - fy0), 4],
  };
  return { objs, kopf, fundamente, groesse: [(fx1 - fx0) * 8, (fy1 - fy0) * 8] };
}

const brauchtRohr = (kat, schritte) => schritte.some((s) => [...s.zutaten, ...s.produkte].some((z) => istFluessig(kat, z.item)));

/**
 * Eine Fertigungsstufe als Reihe (mit freien Ein-/Ausgängen und Schildern).
 * Ausgang 0 = Hauptprodukt (frei mit Schild); weitere feste Produkte (Nebenprodukte) → Schredder, flüssige → freies Rohr.
 */
export function baueReihe({ kat, lib, ver, hasFlags, schritt, bandMax = 6, fundament, strom = true, nebenprodukt = 'schredder' }) {
  const b = baubar(schritt, kat);
  if (!b.ok) throw Object.assign(new Error(b.grund), { status: 422 });
  if (schritt.anzahl > 200) throw Object.assign(new Error(`Das wären ${schritt.anzahl} Maschinen in einer Reihe – bitte kleinere Mengen wählen.`), { status: 422 });
  const ctx = umgebung({ kat, lib, ver, bandMax, strom });
  vorlagenPruefen(ctx, [schritt.gebaeude, 'Build_ConveyorAttachmentSplitter_C', 'Build_ConveyorAttachmentMerger_C'], brauchtRohr(kat, [schritt]));
  const r = reihe(ctx, schritt);
  const { stueck, verbinde, name, schild } = ctx;
  const xEin = Math.min(...r.eingaenge.map((e) => e.x)) - 400;
  r.eingaenge.forEach((e, k) => {
    const f = stueck(e.art, e.mk, [xEin, e.y, e.z], [e.x, e.y, e.z]);
    verbinde(f.t, f.e, e.anker[0], e.anker[1]);
    schild([xEin, e.y - 250, e.z + 50], 90, `EINGANG${r.eingaenge.length > 1 ? ' ' + (k + 1) : ''}: ${zahl(e.menge)}/min ${name(e.item)}`, r.eingaenge.length > 1 ? `E${k + 1}` : 'E');
  });
  const haupt = kat.rezepte[schritt.rezept]?.produkte?.[0]?.item;
  r.ausgaenge.forEach((a, k) => {
    const xAus = a.x + 400;
    const f = stueck(a.art, a.mk, [a.x, a.y, a.z], [xAus, a.y, a.z]);
    verbinde(a.anker[0], a.anker[1], f.t, f.a);
    if (a.item !== haupt && a.art === 'b' && nebenprodukt === 'schredder' && ctx.schredder([xAus, a.y, a.z], 1, [f.t, f.e], r.masten[r.masten.length - 1])) return;
    schild([xAus, a.y + 250, a.z + 50], -90, `${a.item === haupt ? 'AUSGANG' : 'NEBENPRODUKT'}: ${zahl(a.menge)}/min ${name(a.item)}`, a.item === haupt ? 'A' : 'N');
  });
  if (!ctx.schildCls) ctx.warnungen.push('Keine Schild-Vorlage gefunden (z. B. „Schild schmal, sehr breit“ in einer eigenen Blaupause) – Blaupause ohne Schilder.');
  const f = abschliessen(ctx, { fundament, hasFlags, extraXs: [r.xMin, r.xMax], extraYs: [r.yMin, r.yMax] });
  const a0 = r.ausgaenge[0];
  return {
    objs: f.objs, kopf: f.kopf,
    info: {
      maschinen: schritt.anzahl, abstand: r.abstand, splitter: schritt.anzahl, merger: schritt.anzahl, baender: ctx.teile.filter((t) => t.spline && !t.rohr).length, rohre: ctx.teile.filter((t) => t.rohr).length, fundamente: f.fundamente,
      schilder: ctx.teile.filter((t) => t.schild).length, bandEin: r.eingaenge[0].mk, bandAus: a0.mk, leitungen: r.leitungen, masten: ctx.zaehler.masten, kabel: ctx.zaehler.kabel, schredder: ctx.zaehler.schredder,
      groesse: f.groesse, warnungen: ctx.warnungen,
    },
  };
}

// ------------------------------------------------------------------ Ganze Kette
const Z_SPUR = 1600;      // Höhe der Verbindungsbänder in der Logistik-Spalte (über allen Verteilerleitungen)
const Z_ROHRSPUR = 650;   // unterste Rohrspur rechts (zwischen den Leitungshöhen 2/5/8 m); jede weitere 3 m höher

/**
 * Alle baubaren Stufen eines Plans als eine Blaupause. Reihen übereinander (entlang +Y). Bänder: alle Ein-/Ausgänge
 * links, Logistik-Spalte links mit Förderliften (Spuren auf 16 m). Rohre: Ein-/Ausgänge rechts, Rohr-Spalte rechts:
 * je Verbindung eine Spur auf eigener Höhe (äußere höher), Steigrohre direkt neben der Reihe.
 * Feste Nebenprodukte ohne Abnehmer → AWESOME-Schredder; flüssige → freies Rohr mit Schild.
 */
export function baueKette({ kat, lib, ver, hasFlags, ergebnis, bandMax = 6, fundament, strom = true, nur = null }) {
  const ctx = umgebung({ kat, lib, ver, bandMax, strom });
  const { band, stueck, verbinde, name, schild, neu, warnungen, mkFuer, rohrMk } = ctx;
  const alle = ergebnis.schritte.map((s, i) => ({ s, i, ok: baubar(s, kat).ok })).filter((x) => !nur || nur.has(x.i));
  const bau = alle.filter((x) => x.ok);
  if (!bau.length) throw Object.assign(new Error('Keine der Stufen lässt sich bisher als Reihe bauen.'), { status: 422 });
  for (const x of alle) if (!x.ok) warnungen.push(`„${x.s.name}“ wird nicht gebaut (${baubar(x.s, kat).grund}) – Zu- und Abfuhr als freie Leitungen mit Schild.`);
  vorlagenPruefen(ctx, [...bau.map((x) => x.s.gebaeude), 'Build_ConveyorAttachmentSplitter_C', 'Build_ConveyorAttachmentMerger_C'], brauchtRohr(kat, bau.map((x) => x.s)));
  if (!Object.keys(ctx.bg).some((c) => /^Build_ConveyorLiftMk\d_C$/.test(c))) throw Object.assign(new Error('Für die Verbindungen zwischen den Reihen fehlt eine Vorlage für einen Förderlift aus deinen Blaupausen.'), { status: 422 });

  const gesamt = bau.reduce((a, x) => a + x.s.anzahl, 0);
  if (gesamt > 400) throw Object.assign(new Error(`Das wären ${gesamt} Maschinen – zu groß für eine Blaupause. Bitte kleinere Mengen oder eine Teilfabrik wählen.`), { status: 422 });
  bau.sort((a, b) => a.s.ebene - b.s.ebene || a.s.name.localeCompare(b.s.name));
  let cursor = 0;
  const reihen = [];
  for (const x of bau) {
    const m = reiheMasse(x.s, kat);
    const oy = cursor - m.yMin;
    const r = reihe(ctx, x.s, { oy, ausgangLinks: true, rohrSeite: 1 });
    r.index = x.i;
    reihen.push(r);
    cursor = oy + m.yMax + 1400;
  }
  for (let k = 0; k + 1 < reihen.length; k++) {
    const a = reihen[k].masten[reihen[k].masten.length - 1], b = reihen[k + 1].masten[0];
    if (a && b) ctx.draht(a, 'PowerConnection', a.anschluss, b, 'PowerConnection', b.anschluss);
  }
  // Verbindungen aus den Kanten der Rechnung
  const reiheVon = new Map(reihen.map((r) => [r.index, r]));
  const verb = [];
  for (const r of reihen) for (const e of r.eingaenge) {
    const intern = ergebnis.kanten.filter((k) => k.nach === r.index && k.item === e.item && reiheVon.has(k.von));
    if (!intern.length) continue;
    const k = intern.sort((a, b) => b.menge - a.menge)[0];
    const von = reiheVon.get(k.von), a = von.ausgaenge.find((x) => x.item === e.item);
    if (!a) continue;
    verb.push({ von, nach: r, eingang: e, ausgang: a, item: e.item, art: e.art, menge: intern.reduce((s, q) => s + q.menge, 0) });
    if (intern.length > 1) warnungen.push(`${name(e.item)} für „${r.schritt.name}“ kommt aus mehreren Reihen – verbunden ist nur die größte.`);
    e.verbunden = true;
  }
  const vb = verb.filter((v) => v.art === 'b'), vr = verb.filter((v) => v.art === 'r');
  const X0 = Math.min(...reihen.map((r) => r.xMin)) - 600;
  vb.forEach((v, k) => { v.x = X0 - 400 * k; });
  const xFrei = X0 - 400 * vb.length - 400;
  // Rohr-Spalte rechts: Abzweig-Kreuzungen und Steigrohre zwischen Reihe und XR, Spuren dahinter (äußere höher)
  const maxAb = Math.max(1, ...reihen.flatMap((r) => r.ausgaenge.map((a) => vr.filter((v) => v.ausgang === a).length)));
  const XR = Math.max(...reihen.map((r) => r.xMax)) + 600 + 300 * maxAb;
  vr.forEach((v, k) => { v.x = XR + 400 + 400 * k; v.h = Z_ROHRSPUR + 300 * k; });
  const xFreiR = XR + 400 + 400 * vr.length + 400;
  if (vr.some((v) => v.h > 1000)) warnungen.push('Rohrspuren liegen höher als 10 m – ggf. eine Pumpe einsetzen (Förderhöhe).');
  const lift = (mk, pos, yawDeg, hoch, relYaw) => neu({ cls: `Build_ConveyorLiftMk${mk}_C`, pos, yaw: yawDeg, conn: {}, lift: { hoch, relYaw } });
  // Rohrzug aus Stücken (je Stück eigenes Rohr, Enden verbunden)
  const rohrzug = (mk, punkte, start, ende) => {
    let vorher = start;
    for (let k = 0; k + 1 < punkte.length; k++) {
      const f = stueck('r', mk, punkte[k], punkte[k + 1]);
      if (vorher) verbinde(vorher[0], vorher[1], f.t, f.a);
      vorher = [f.t, f.e];
    }
    if (ende) verbinde(vorher[0], vorher[1], ende[0], ende[1]);
    return vorher;
  };
  const extern = (r, a) => (ergebnis.ziele.find((z) => z.item === a.item)?.menge || 0) > 1e-6 || (nur && nur.max === r.index && a.item === kat.rezepte[r.schritt.rezept]?.produkte?.[0]?.item);
  const istHaupt = (r, a) => a.item === kat.rezepte[r.schritt.rezept]?.produkte?.[0]?.item;

  for (const r of reihen) for (const a of r.ausgaenge) {
    const abgaenge = verb.filter((v) => v.von === r && v.ausgang === a).sort((p, q) => (a.art === 'b' ? q.x - p.x : p.x - q.x));
    const intern = abgaenge.reduce((s, v) => s + v.menge, 0);
    const restMenge = Math.max(0, a.menge - intern);
    const nachAussen = extern(r, a) || ergebnis.kanten.some((k) => k.von === r.index && k.item === a.item && !reiheVon.has(k.nach));
    let von = a.anker, x = a.x;
    if (a.art === 'b') {
      for (const v of abgaenge) {
        const sp = neu({ cls: 'Build_ConveyorAttachmentSplitter_C', pos: [v.x, a.y, a.z], yaw: 180, conn: {} });
        const b0 = band(a.mk, [x, a.y, a.z], [v.x + 100, a.y, a.z]);
        verbinde(von[0], von[1], b0, 'ConveyorAny0'); verbinde(b0, 'ConveyorAny1', sp, 'Input1');
        von = [sp, 'Output1']; x = v.x - 100;
        const e = v.eingang, sgn = Math.sign(e.y - a.y) || 1, mk = mkFuer(v.menge);
        const b1 = band(mk, [v.x, a.y + 100 * sgn, a.z], [v.x, a.y + 300 * sgn, a.z]);
        verbinde(sp, sgn > 0 ? 'Output3' : 'Output2', b1, 'ConveyorAny0');
        const l1 = lift(mk, [v.x, a.y + 300 * sgn, a.z], 90 * sgn + 180, Z_SPUR - a.z, 180);
        verbinde(b1, 'ConveyorAny1', l1, 'ConveyorAny0');
        const b2 = band(mk, [v.x, a.y + 300 * sgn, Z_SPUR], [v.x, e.y, Z_SPUR]);
        verbinde(l1, 'ConveyorAny1', b2, 'ConveyorAny0');
        const l2 = lift(mk, [v.x, e.y, Z_SPUR], 90 * sgn + 180, e.z - Z_SPUR, -(90 * sgn + 180));
        verbinde(b2, 'ConveyorAny1', l2, 'ConveyorAny0');
        const b3 = band(e.mk, [v.x, e.y, e.z], [e.x, e.y, e.z]);
        verbinde(l2, 'ConveyorAny1', b3, 'ConveyorAny0'); verbinde(b3, 'ConveyorAny1', e.anker[0], e.anker[1]);
      }
      if (nachAussen || !abgaenge.length) {
        const bf = band(a.mk, [x, a.y, a.z], [xFrei, a.y, a.z]);
        verbinde(von[0], von[1], bf, 'ConveyorAny0');
        const menge = abgaenge.length ? restMenge : a.menge;
        if (!nachAussen && !istHaupt(r, a) && ctx.schredder([xFrei, a.y, a.z], -1, [bf, 'ConveyorAny1'], r.masten[0])) continue;
        schild([xFrei, a.y + 250, a.z + 50], 90, `${nachAussen || istHaupt(r, a) ? 'AUSGANG' : 'NEBENPRODUKT'}: ${zahl(menge)}/min ${name(a.item)}`, 'A');
      }
    } else {
      // Rohr: je Abnehmer eine Kreuzung auf dem Ausgangsrohr (höhere Spur weiter links), Steigrohr hoch auf die Spurhöhe,
      // waagerecht zur Spur, entlang Y, zurück bis XR, Fallrohr auf Leitungshöhe, hinein.
      const reihenfolge = [...abgaenge].sort((p, q) => q.h - p.h);
      const xs0 = Math.max(a.x + 300, r.xMax + 400);
      reihenfolge.forEach((v, k) => { v.xk = xs0 + 300 * k; });
      for (const v of [...reihenfolge].sort((p, q) => p.xk - q.xk)) {
        const kr = neu({ cls: 'Build_PipelineJunction_Cross_C', pos: [v.xk, a.y, a.z], yaw: 0, conn: {} });
        rohrzug(a.mk, [[x, a.y, a.z], [v.xk - 100, a.y, a.z]], von, [kr, 'Connection0']);
        von = [kr, 'Connection1']; x = v.xk + 100;
        const e = v.eingang, sgn = Math.sign(e.y - a.y) || 1, mk = rohrMk(v.menge), ys = a.y + 200 * sgn;
        rohrzug(mk, [[v.xk, a.y + 100 * sgn, a.z], [v.xk, ys, a.z], [v.xk, ys, v.h], [v.x, ys, v.h], [v.x, e.y, v.h], [XR, e.y, v.h], [XR, e.y, e.z], [e.x, e.y, e.z]], [kr, sgn > 0 ? 'Connection2' : 'Connection3'], e.anker);
      }
      if (nachAussen || !abgaenge.length) {
        rohrzug(a.mk, [[x, a.y, a.z], [xFreiR, a.y, a.z]], von, null); // kreuzt die Spuren unterhalb (Spuren ab 5 m)
        const menge = abgaenge.length ? restMenge : a.menge;
        schild([xFreiR, a.y + 250, a.z + 50], -90, `${nachAussen || istHaupt(r, a) ? 'AUSGANG' : 'NEBENPRODUKT'}: ${zahl(menge)} m³/min ${name(a.item)}`, 'A');
      }
    }
  }
  // Freie Eingänge (Rohstoffe, Zulieferungen, nicht gebaute Stufen)
  const freieEin = [];
  for (const r of reihen) for (const e of r.eingaenge) {
    if (e.verbunden) continue;
    if (e.art === 'b') {
      const be = band(e.mk, [xFrei, e.y, e.z], [e.x, e.y, e.z]);
      verbinde(be, 'ConveyorAny1', e.anker[0], e.anker[1]);
      schild([xFrei, e.y - 250, e.z + 50], 90, `EINGANG: ${zahl(e.menge)}/min ${name(e.item)}`, 'E');
    } else {
      rohrzug(e.mk, [[xFreiR, e.y, e.z], [e.x, e.y, e.z]], null, e.anker);
      schild([xFreiR, e.y - 250, e.z + 50], -90, `EINGANG: ${zahl(e.menge)} m³/min ${name(e.item)}`, 'E');
    }
    freieEin.push(e);
  }
  for (const r of reihen) schild([r.xMax + 300, (r.yMin + r.yMax) / 2, Z_BODEN + 300], -90, `${r.schritt.anzahl}× ${kat.gebaeude[r.schritt.gebaeude]?.name || ''}: ${r.schritt.name}`, '#');
  if (!ctx.schildCls) warnungen.push('Keine Schild-Vorlage gefunden – Blaupause ohne Schilder.');

  const f = abschliessen(ctx, { fundament, hasFlags, extraXs: [xFrei, vr.length ? xFreiR : XR], extraYs: reihen.flatMap((r) => [r.yMin, r.yMax]) });
  return {
    objs: f.objs, kopf: f.kopf,
    info: {
      reihen: reihen.length, maschinen: reihen.reduce((s, r) => s + r.schritt.anzahl, 0), verbindungen: verb.length, eingaenge: freieEin.length,
      baender: ctx.teile.filter((t) => t.spline && !t.rohr).length, rohre: ctx.teile.filter((t) => t.rohr).length, lifte: ctx.teile.filter((t) => t.lift).length, fundamente: f.fundamente,
      masten: ctx.zaehler.masten, kabel: ctx.zaehler.kabel, schredder: ctx.zaehler.schredder, groesse: f.groesse, warnungen, nichtGebaut: alle.filter((x) => !x.ok).map((x) => x.s.name),
    },
  };
}

// ------------------------------------------------------------------ Teile → Bytes
let nr = 2147480000 - Math.floor(Math.random() * 4e7);
function neuerName(cls, ziffern, vergeben) {
  let s;
  do { const z = String(nr--); s = `Persistent_Level:PersistentLevel.${cls}_${z.length === ziffern ? z : z.padStart(ziffern, '1').slice(-ziffern)}`; } while (vergeben.has(s));
  vergeben.add(s);
  return s;
}
const ersetzeAlle = (buf, alt, neu) => {
  if (alt.length !== neu.length) throw new Error('Namenslänge');
  const a = Buffer.from(alt, 'latin1'), b = Buffer.from(neu, 'latin1');
  const out = Buffer.from(buf);
  let p = out.indexOf(a);
  while (p >= 0) { b.copy(out, p); p = out.indexOf(a, p + a.length); }
  return out;
};
const istAnschluss = (tp) => /FactoryConnectionComponent|PipeConnection/.test(tp);

function bandVorlage(lib, kat, ver, cls) {
  const bg = lib.baugruppen[String(ver)];
  if (bg[cls]) return bg[cls];
  const art = /Lift/.test(cls) ? 'ConveyorLift' : 'ConveyorBelt';
  const spender = Object.keys(bg).filter((c) => new RegExp(`^Build_${art}Mk\\d_C$`).test(c)).sort()[0];
  const t = bg[spender];
  const n = cls.replace(/^Build_|_C$/g, '');
  const typePath = lib.pfade[cls] || `/Game/FactoryGame/Buildable/Factory/${n}/Build_${n}.Build_${n}_C`;
  const rp = kat.pfade.rezepte[kat.gebaeude[cls]?.rezept];
  let data = Buffer.from(t.data, 'base64');
  if (rp) data = setzeVerweis(data, true, 'mBuiltWithRecipe', rp, '');
  // Instanzname der Vorlage auf die neue Klasse umstellen (gleiche Länge: nur die Mk-Ziffer ändert sich)
  const altInst = t.instance, neuInst = altInst.replace(spender, cls);
  return { ...t, typePath, instance: neuInst, data: ersetzeAlle(data, altInst, neuInst).toString('base64'), komp: t.komp.map((k) => ({ ...k, data: ersetzeAlle(Buffer.from(k.data, 'base64'), altInst, neuInst).toString('base64') })) };
}

// Muster der Eigenschaft mWireInstances (ein Draht: Locations[2], CachedRelativeLocations[2]) wie das Spiel sie schreibt
const DRAHT_MUSTER = Buffer.from('DwAAAG1XaXJlSW5zdGFuY2VzAA4AAABBcnJheVByb3BlcnR5AAEAAAAPAAAAU3RydWN0UHJvcGVydHkAAQAAAA0AAABXaXJlSW5zdGFuY2UAAQAAABQAAAAvU2NyaXB0L0ZhY3RvcnlHYW1lAAAAAADlAQAAAAEAAAAKAAAATG9jYXRpb25zAA8AAABTdHJ1Y3RQcm9wZXJ0eQABAAAABwAAAFZlY3RvcgABAAAAFAAAAC9TY3JpcHQvQ29yZVVPYmplY3QAAAAAABgAAAAIAAAAIOV+2UAAAADgKTERwQAAAOBfmalACgAAAExvY2F0aW9ucwAPAAAAU3RydWN0UHJvcGVydHkAAQAAAAcAAABWZWN0b3IAAQAAABQAAAAvU2NyaXB0L0NvcmVVT2JqZWN0AAAAAAAYAAAACQEAAABTdvT7Dn3ZQE5cgvOuMBHBAAAA4GctrEAYAAAAQ2FjaGVkUmVsYXRpdmVMb2NhdGlvbnMADwAAAFN0cnVjdFByb3BlcnR5AAEAAAAHAAAAVmVjdG9yAAEAAAAUAAAAL1NjcmlwdC9Db3JlVU9iamVjdAAAAAAAGAAAAAhnTxJKpnMWwObdZXbrHD/AAAAAAECgdMAYAAAAQ2FjaGVkUmVsYXRpdmVMb2NhdGlvbnMADwAAAFN0cnVjdFByb3BlcnR5AAEAAAAHAAAAVmVjdG9yAAEAAAAUAAAAL1NjcmlwdC9Db3JlVU9iamVjdAAAAAAAGAAAAAkBAAAA/KVtwGUfgL/vvcJrg8SRvwAAAAAAAAAABQAAAE5vbmUA', 'base64');
/** Stromleitung: Drahtverlauf, Länge und beide Endpunkt-Verweise setzen (sonst verbindet das Spiel nichts) */
function baueKabel(data, k) {
  data = entferne(entferne(data, true, 'mWireInstances'), true, 'mCachedLength');
  const w = Buffer.from(DRAHT_MUSTER);
  const l = propListe(w, w.indexOf(Buffer.from('Locations\0', 'latin1')) - 4);
  const vek = l.props.filter((x) => x.size === 24).map((x) => x.valStart);
  [k.locA, k.locB, k.relA, [0, 0, 0]].forEach((v, j) => v.forEach((x, m) => w.writeDoubleLE(x, vek[j] + m * 8)));
  const f = Buffer.alloc(4); f.writeFloatLE(k.laenge);
  const len = Buffer.concat([fstr('mCachedLength'), fstr('FloatProperty'), i32(0), i32(4), Buffer.from([0]), f]);
  const z = zerlege(data, true);
  const ref = ([teil, komp]) => Buffer.concat([fstr('Persistent_Level'), fstr(`${teil.inst}.${komp}`)]);
  return Buffer.concat([data.subarray(0, z.propsStart), w, len, data.subarray(z.propsStart, z.noneEnd), i32(0), ref(k.a), ref(k.b)]);
}

// Muster der Eigenschaft mTopTransform eines Förderlifts (Rotation als Quat, Translation als Vektor)
const LIFT_MUSTER = Buffer.from('DgAAAG1Ub3BUcmFuc2Zvcm0ADwAAAFN0cnVjdFByb3BlcnR5AAEAAAAKAAAAVHJhbnNmb3JtAAEAAAAUAAAAL1NjcmlwdC9Db3JlVU9iamVjdAAAAAAA6gAAAAAJAAAAUm90YXRpb24ADwAAAFN0cnVjdFByb3BlcnR5AAEAAAAFAAAAUXVhdAABAAAAFAAAAC9TY3JpcHQvQ29yZVVPYmplY3QAAAAAACAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAA8D8MAAAAVHJhbnNsYXRpb24ADwAAAFN0cnVjdFByb3BlcnR5AAEAAAAHAAAAVmVjdG9yAAEAAAAUAAAAL1NjcmlwdC9Db3JlVU9iamVjdAAAAAAAGAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAADAYkAFAAAATm9uZQA=', 'base64');
/** Förderlift: oberes Ende relativ (nur Höhe) und Drehung des Ausgangs gegenüber dem Eingang setzen */
function baueLift(data, { hoch, relYaw }) {
  data = entferne(entferne(data, true, 'mTopTransform'), true, 'mSnappedPassthroughs');
  const w = Buffer.from(LIFT_MUSTER);
  const l = propListe(w, w.indexOf(Buffer.from('Rotation\0', 'latin1')) - 4);
  const rot = l.props.find((x) => x.name === 'Rotation'), tr = l.props.find((x) => x.name === 'Translation');
  const a = relYaw * Math.PI / 360;
  [0, 0, Math.sin(a), Math.cos(a)].forEach((v, m) => w.writeDoubleLE(v, rot.valStart + m * 8));
  [0, 0, hoch].forEach((v, m) => w.writeDoubleLE(v, tr.valStart + m * 8));
  const z = zerlege(data, true);
  return Buffer.concat([data.subarray(0, z.propsStart), w, data.subarray(z.propsStart)]);
}

function baueObjekte({ kat, lib, ver, hasFlags, teile }) {
  const vergeben = new Set();
  // 1. Namen vergeben (für Verweise zwischen den Teilen)
  for (const t of teile) {
    if (t.einfach || t.schild) { t.tpl = templateFor(lib, kat, ver, t.cls); t.inst = neuerName(t.cls, 10, vergeben); continue; }
    t.tpl = /Conveyor(Belt|Lift)Mk/.test(t.cls) ? bandVorlage(lib, kat, ver, t.cls) : lib.baugruppen[String(ver)][t.cls];
    const ziffern = /_(\d+)$/.exec(t.tpl.instance)[1].length;
    t.inst = neuerName(t.cls, ziffern, vergeben);
  }
  // Anschlussnamen der Vorlage verwenden (das Spiel schreibt z. B. beim Merger „InPut3“) – Vergleich ohne Groß/Klein
  const echt = (t, name) => (t.tpl.komp || []).find((k) => k.name.toLowerCase() === name.toLowerCase())?.name;
  for (const t of teile) {
    if (!t.conn) continue;
    const neu = {};
    for (const [kn, [ziel, zn]] of Object.entries(t.conn)) {
      const a = echt(t, kn), b = echt(ziel, zn);
      if (!a) throw new Error(`Vorlage ${t.cls} (${t.tpl.quelle || '?'}) hat keinen Anschluss „${kn}“`);
      if (!b) throw new Error(`Vorlage ${ziel.cls} (${ziel.tpl.quelle || '?'}) hat keinen Anschluss „${zn}“`);
      neu[a] = [ziel, b];
    }
    t.conn = neu;
  }
  for (const t of teile) {
    if (t.draehte) {
      const d = {};
      for (const [kn, l] of Object.entries(t.draehte)) { const a = echt(t, kn); if (!a) throw new Error(`Vorlage ${t.cls} (${t.tpl.quelle || '?'}) hat keinen Stromanschluss „${kn}“`); d[a] = l; }
      t.draehte = d;
    }
    if (t.kabel) for (const e of [t.kabel.a, t.kabel.b]) e[1] = echt(e[0], e[1]) || e[1];
  }
  const objs = [];
  for (const t of teile) {
    const rot = t.rot || quatYaw(t.yaw || 0);
    if (t.einfach || t.schild) {
      let data = Buffer.from(t.tpl.data, 'base64');
      if (t.schild) data = setzeSchildTexte(data, t.schild);
      if (t.kabel) data = baueKabel(data, t.kabel);
      objs.push({ head: makeHead({ typePath: t.tpl.typePath, instance: t.inst, flags: t.tpl.flags, hasFlags, rot, pos: t.pos, placed: t.tpl.placed }), data: Buffer.concat([i32(data.length), data]) });
      continue;
    }
    const alt = t.tpl.instance;
    let data = ersetzeAlle(Buffer.from(t.tpl.data, 'base64'), alt, t.inst);
    if (t.rezept) data = setzeVerweis(data, true, 'mCurrentRecipe', kat.pfade.rezepte[t.rezept], '');
    let pos = t.pos;
    if (t.lift) data = baueLift(data, t.lift);
    if (t.rohr) data = entferne(data, true, 'mSnappedPassthroughs');
    if (t.spline) {
      const [a, e] = t.spline;
      const d = [e[0] - a[0], e[1] - a[1], e[2] - a[2]];
      const len = Math.hypot(...d) || 1, u = d.map((v) => v / len), h = d.map((v) => v / 2);
      pos = a;
      if (t.kurve) { // waagerecht an beiden Enden, dazwischen sanft auf/ab (S-Kurve)
        const lh = Math.hypot(d[0], d[1]) || 1, w = [d[0] / lh, d[1] / lh, 0], T = w.map((v) => v * lh);
        data = baueSpline(data, [{ loc: [0, 0, 0], arrive: w, leave: T }, { loc: d, arrive: T, leave: w }]);
      } else data = baueSpline(data, [{ loc: [0, 0, 0], arrive: u, leave: h }, { loc: d, arrive: h, leave: u }]);
    }
    objs.push({ head: makeHead({ typePath: t.tpl.typePath, instance: t.inst, flags: t.tpl.flags, hasFlags, rot: t.spline ? [0, 0, 0, 1] : rot, pos, placed: t.tpl.placed }), data: Buffer.concat([i32(data.length), data]) });
    for (const k of t.tpl.komp) {
      let kd = ersetzeAlle(Buffer.from(k.data, 'base64'), alt, t.inst);
      if (istAnschluss(k.typePath)) {
        kd = entferne(kd, false, 'mConnectedComponent');
        const c = t.conn[k.name];
        if (c) kd = setzeVerweis(kd, false, 'mConnectedComponent', `${c[0].inst}.${c[1]}`);
      }
      if (/PowerConnection/.test(k.typePath)) kd = setzeDraehte(kd, (t.draehte?.[k.name] || []).map((l) => l.inst));
      const kopf = [i32(0), fstr(k.typePath), fstr(k.root), fstr(`${t.inst}.${k.name}`)];
      if (hasFlags) kopf.push(i32(k.flags));
      kopf.push(fstr(t.inst));
      objs.push({ head: Buffer.concat(kopf), data: Buffer.concat([i32(kd.length), kd]) });
    }
    // Prüfen: alle gewünschten Verbindungen haben einen Anschluss in der Vorlage
    for (const kn of Object.keys(t.conn)) if (!t.tpl.komp.some((k) => k.name === kn)) throw new Error(`Vorlage ${t.cls} hat keinen Anschluss „${kn}“`);
  }
  return objs;
}
