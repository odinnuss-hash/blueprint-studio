// Fabrikplaner → Blaupause: Fertigungsstufen als Maschinenreihen, ganze/teilweise Fabriken als verbundene Reihen.
//
// Reihe (Blick von oben, Fluss von −Y nach +Y durch die Maschinen):
//                *     *     *    je Maschine ein Strommast außerhalb der Eingangsleitungen
//   Eingang ─▶ [S]──▶[S]──▶[S]   je Zutat eine Leitung (Band: Splitter, Rohr: Kreuzung); weitere Leitungen 4 m
//               │     │     │      weiter außen und 2 m höher (Rohre über den Bändern), Zuführung darüber hinweg
//              [M][M][M]          Maschinen direkt nebeneinander (Abstände wie in den eigenen Blaupausen gemessen)
//               │     │     │
//              [V]──▶[V]──▶[V] ─▶ je Produkt eine Sammelleitung (Band: Merger, Rohr: Kreuzung), Nebenprodukt fest
//                                  und unbenutzt → AWESOME-Schredder
// Alles auf 8×1-Fundamenten (Oberkante z = 100), Schilder an Ein- und Ausgängen.

import { i32, fstr, makeHead, templateFor } from './vorlagen.mjs';
import { setzeVerweis, entferne, baueSpline, setzeSchildTexte, setzeDraehte, zerlege, propListe, setzeFarbe, setzeSortierRegeln } from './eigenschaften.mjs';

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
  // Teilchenbeschleuniger (Anschlüsse aus dem Spiel, Abstand in Master-Class-Fabriken 37 m): Eingänge auf +Y → gedreht
  Build_HadronCollider_C: { yaw: 180, strom: ['PowerInput', -833, 675, 617], box: [-3850, 1500, -1100, 1650], ein: [['Input0', -600, 900, 100, 'b'], ['Input1', -200, 900, 100, 'b'], ['FGPipeConnectionFactory', 200, 990, 175, 'r']], aus: [['Output0', -400, -1310, 100, 'b']] },
  // Quantenkodierer (Abstand in Master-Class-Fabriken 24 m)
  Build_QuantumEncoder_C: { strom: ['PowerInput', 858, -2030, 479], box: [-1200, 1200, -2250, 2250], ein: [['Input1', 200, -2460, 100, 'b'], ['Input2', -200, -2460, 100, 'b'], ['Input3', -600, -2100, 100, 'b'], ['PipeInput1', 600, -2090, 175, 'r']], aus: [['Output0', -200, 2100, 100, 'b'], ['PipeOutput1', 200, 2160, 175, 'r']] },
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
const ROHR_MAX = 5000;          // Höchstlänge je Rohr (Spiel: 56 m), darüber Stoß in Linie
const ROHR_BOGEN = 130;         // Abstand Ecke → Bogenanfang wie bei den im Spiel gebauten Rohren
const FUNDAMENTE = ['Build_Foundation_ConcretePolished_8x1_C', 'Build_Foundation_8x1_01_C', 'Build_Foundation_Concrete_8x1_C', 'Build_Foundation_Asphalt_8x1_C', 'Build_Foundation_Metal_8x1_C'];
const SCHILDER = ['Build_StandaloneWidgetSign_SmallVeryWide_C', 'Build_StandaloneWidgetSign_SmallWide_C', 'Build_StandaloneWidgetSign_Small_C'];
const SPEICHER = { cls: 'Build_PipeStorageTank_C', r: 200, z: 175 }; // Anschlüsse gemessen: ConnectionAny0/1 bei (0, ±200, 175)
// Wasserextraktor (gemessen): Rohranschluss (0, −460, 240) nach −Y, Strom (−595, 320, 1045), Grundfläche ±1000 × ±900, 120 m³/min
const EXTRAKTOR = { cls: 'Build_WaterPump_C', aus: ['FGPipeConnectionFactory', 0, -460, 240], strom: ['PowerConnection', -595, 320, 1045], rate: 120, abstand: 2200, mitte: 1100 };
// Rohrpumpe (gemessen an 339 Pumpen): Connection0 (Eingang) und Connection1 (Ausgang) in der Mitte, Durchfluss lokal +X,
// Strom PowerInput (115, −140, 50). Förderhöhe (Wiki): Maschinen/Extraktoren 10 m, Pumpe Mk.1 20 m, Mk.2 50 m – ab Pumpe neu.
const PUMPE = { mk1: 'Build_PipelinePump_C', mk2: 'Build_PipelinePumpMk2_C', strom: ['PowerInput', 115, -140, 50], hubMk1: 1800 };
const HUB_FREI = 900;   // so hoch (über Boden) kommt eine Flüssigkeit sicher ohne Pumpe (10 m empfohlen, 1 m Reserve)
const MAST_PLAETZE = { Build_PowerPoleMk1_C: 4, Build_PowerPoleMk2_C: 7, Build_PowerPoleMk3_C: 10 };
const SCHREDDER = { cls: 'Build_ResourceSink_C', ein: ['Input0', 0, 500, 100], strom: ['FGPowerConnection', -361, -321, 898] };

/** Vektor v mit Quaternion q = [x, y, z, w] drehen */
const qDreh = ([x, y, z, w], [vx, vy, vz]) => {
  const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz;
  return [ix * w - iw * x - iy * z + iz * y, iy * w - iw * y - iz * x + ix * z, iz * w - iw * z - ix * y + iy * x];
};
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
  /**
   * Rohrverlauf durch die Punkte `pts` wie das Spiel ihn baut: ein Rohr, Ecken als Bogen (Spline-Punkte vor und nach der
   * Ecke), gerade Stücke dazwischen. Über ROHR_MAX lang → mehrere Rohre, Stoß immer in Linie. start/ende = [teil, komp].
   * Liefert das freie Ende [teil, 'PipelineConnection1'].
   */
  const rohrPfad = (mk, pts, start, ende) => {
    const sub = (a, b) => a.map((v, i) => v - b[i]), len = (d) => Math.hypot(...d), mul = (d, f) => d.map((v) => v * f), add = (a, b) => a.map((v, i) => v + b[i]);
    const p = [];
    for (const q of pts) if (!p.length || len(sub(q, p[p.length - 1])) > 1) p.push(q);
    for (let i = 1; i + 1 < p.length;) { // gerade durchlaufende Punkte entfernen
      const a = sub(p[i], p[i - 1]), b = sub(p[i + 1], p[i]);
      if (Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b)) > 0.9998) p.splice(i, 1); else i++;
    }
    const dir = (i) => { const d = sub(p[i + 1], p[i]); return mul(d, 1 / len(d)); };
    // Abschnitte {a, b, ta, tb, l}: gerade (Tangente = Strecke) oder Bogen (Tangente nach Kreisnäherung)
    const ab = [];
    let von = p[0];
    for (let i = 1; i < p.length; i++) {
      const dIn = dir(i - 1);
      if (i === p.length - 1) { const d = sub(p[i], von); ab.push({ a: von, b: p[i], ta: d, tb: d, l: len(d) }); break; }
      const dOut = dir(i), th = Math.acos(Math.max(-1, Math.min(1, dIn[0] * dOut[0] + dIn[1] * dOut[1] + dIn[2] * dOut[2])));
      const r = Math.min(ROHR_BOGEN, 0.45 * len(sub(p[i], p[i - 1])), 0.45 * len(sub(p[i + 1], p[i])));
      const R = r / Math.tan(th / 2), tl = 4 * Math.tan(th / 4) * R;
      const A = sub(p[i], mul(dIn, r)), B = add(p[i], mul(dOut, r));
      const d = sub(A, von);
      if (len(d) > 1) ab.push({ a: von, b: A, ta: d, tb: d, l: len(d) });
      ab.push({ a: A, b: B, ta: mul(dIn, tl), tb: mul(dOut, tl), l: R * th });
      von = B;
    }
    // in Rohre bis ROHR_MAX aufteilen (nur in geraden Abschnitten schneiden)
    const rohre = [[]];
    let summe = 0;
    for (let s of ab) {
      while (summe + s.l > ROHR_MAX && s.ta === s.tb && s.l > 200) {
        const rest = Math.max(100, Math.min(s.l - 100, ROHR_MAX - summe)), u = mul(s.ta, 1 / s.l), m = add(s.a, mul(u, rest));
        rohre[rohre.length - 1].push({ a: s.a, b: m, ta: mul(u, rest), tb: mul(u, rest), l: rest });
        rohre.push([]); summe = 0;
        const d = sub(s.b, m); s = { a: m, b: s.b, ta: d, tb: d, l: len(d) };
      }
      if (summe + s.l > ROHR_MAX && rohre[rohre.length - 1].length) { rohre.push([]); summe = 0; }
      rohre[rohre.length - 1].push(s); summe += s.l;
    }
    let vorher = start;
    for (const liste of rohre) {
      const einh = (v) => mul(v, 1 / (len(v) || 1));
      const punkte = [{ loc: liste[0].a, arrive: einh(liste[0].ta), leave: liste[0].ta }];
      for (let k = 0; k < liste.length; k++) punkte.push({ loc: liste[k].b, arrive: liste[k].tb, leave: k + 1 < liste.length ? liste[k + 1].ta : einh(liste[k].tb) });
      const t = neu({ cls: rohrCls(mk), pos: punkte[0].loc, yaw: 0, conn: {}, spline: punkte.map((q) => q.loc), punkte, rohr: true });
      if (vorher) verbinde(vorher[0], vorher[1], t, 'PipelineConnection0');
      vorher = [t, 'PipelineConnection1'];
    }
    if (ende) verbinde(vorher[0], vorher[1], ende[0], ende[1]);
    return vorher;
  };
  const mkFuer = (menge) => { let mk = BAND.findIndex((c, k) => k > 0 && c >= menge - 1e-6); if (mk < 0) mk = 6; return Math.min(mk, bandMax); };
  const rohrMk = (menge) => (menge > ROHR[1] + 1e-6 ? 2 : 1);
  const name = (it) => kat.items[it]?.name || it;
  const mastCls = ['Build_PowerPoleMk1_C', 'Build_PowerPoleMk2_C', 'Build_PowerPoleMk3_C'].find((c) => bg[c]?.komp?.some((k) => /PowerConnection/i.test(k.name)));
  const kabelOk = !!templateFor(lib, kat, ver, 'Build_PowerLine_C');
  const zaehler = { masten: 0, kabel: 0, schredder: 0, speicher: 0, extraktoren: 0, pumpen: 0 };
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
  /** Flüssigkeitsspeicher am Ende eines Rohrs: Rohr beginnt bei p (Richtung +X), senkt sich auf Anschlusshöhe, Speicher auf dem Boden */
  const speicher = (mk, p, quelle, xT = p[0] + 800) => {
    if (!bg[SPEICHER.cls]) { if (!zaehler.speicherGewarnt) { zaehler.speicherGewarnt = true; warnungen.push('Kein Flüssigkeitsspeicher an flüssigen Nebenprodukten: keine Vorlage aus deinen Blaupausen (eine Blaupause mit Flüssigkeitsspeicher speichern).'); } return null; }
    // Anschluss ConnectionAny0 lokal (0, 200) liegt bei Drehung 90° auf der −X-Seite, dem Rohr zugewandt
    const zA = Z_BODEN + SPEICHER.z;
    const s = neu({ cls: SPEICHER.cls, pos: [xT, p[1], Z_BODEN], yaw: 90, conn: {} });
    rohrPfad(mk, [p, [xT - 600, p[1], p[2]], [xT - 400, p[1], zA], [xT - SPEICHER.r, p[1], zA]], quelle, [s, 'ConnectionAny0']);
    s.box = [xT - 300, xT + 300, p[1] - 300, p[1] + 300];
    zaehler.speicher++;
    return s;
  };
  /**
   * Wasserextraktoren für einen freien Wasser-Eingang e: Reihe entlang +X ab xStart, Mitte 11 m auf der −Y-Seite (von der Reihe weg, um 180° gedreht),
   * Sammelleitung mit Kreuzungen auf Höhe der Eingangsleitung, Ende −X zum Eingang. Strom: Mast zwischen den Extraktoren,
   * erster Mast am Mast `netz`. Liefert das linke Ende x der Sammelleitung oder null (dann freier Eingang wie bisher).
   */
  const wasserBelegt = [];
  const wasser = (e, xStart, netz) => {
    if (!bg[EXTRAKTOR.cls]) { if (!zaehler.extraktorGewarnt) { zaehler.extraktorGewarnt = true; warnungen.push('Keine Wasserextraktoren gebaut: keine Vorlage aus deinen Blaupausen (eine Blaupause mit Wasserextraktor speichern).'); } return null; }
    const n = Math.max(1, Math.ceil(e.menge / EXTRAKTOR.rate - 1e-6));
    const cy = e.y - EXTRAKTOR.mitte, breite = n * EXTRAKTOR.abstand;
    let x0 = xStart + EXTRAKTOR.abstand / 2; // Mitte des ersten Extraktors
    for (const b of wasserBelegt) if (Math.abs(b.cy - cy) < 2000 && x0 - 1100 < b.x1) x0 = b.x1 + 1100;
    wasserBelegt.push({ cy, x1: x0 + breite - 1100 });
    const [an, ax, ay, az] = EXTRAKTOR.aus, [sn, sx, sy, sz] = EXTRAKTOR.strom;
    let vorher = null, erste = null, mastVorher = netz;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * EXTRAKTOR.abstand;
      const w = neu({ cls: EXTRAKTOR.cls, pos: [x, cy, Z_BODEN], yaw: 180, conn: {} });
      w.box = [x - 1000, x + 1000, cy - 900, cy + 900];
      const kr = neu({ cls: 'Build_PipelineJunction_Cross_C', pos: [x, e.y, e.z], yaw: 0, conn: {} });
      const f = rohr(e.mk, [x, e.y - 100, e.z], [x - ax, cy - ay, Z_BODEN + az], true);
      verbinde(kr, 'Connection3', f, 'PipelineConnection0'); verbinde(f, 'PipelineConnection1', w, an);
      if (vorher) { const g = rohr(e.mk, [vorher.pos[0] + 100, e.y, e.z], [x - 100, e.y, e.z]); verbinde(vorher, 'Connection1', g, 'PipelineConnection0'); verbinde(g, 'PipelineConnection1', kr, 'Connection0'); }
      else erste = kr;
      vorher = kr;
      if (ctxStrom()) {
        const mast = neu({ cls: mastCls, pos: [x + EXTRAKTOR.abstand / 2, cy, Z_BODEN], yaw: 0, conn: {} });
        mast.anschluss = [mast.pos[0], cy, Z_BODEN + 700];
        zaehler.masten++;
        draht(w, sn, [x - sx, cy - sy, Z_BODEN + sz], mast, 'PowerConnection', mast.anschluss);
        if (mastVorher) draht(mastVorher, 'PowerConnection', mastVorher.anschluss, mast, 'PowerConnection', mast.anschluss);
        mastVorher = mast;
      }
      zaehler.extraktoren++;
    }
    return { x: x0 - 100, anker: [erste, 'Connection0'], n };
  };
  /** Verbraucher an den nächsten Strommast mit freiem Platz (höchstens 90 m entfernt) anschließen */
  const anNetz = (teil, komp, p) => {
    if (!ctxStrom()) return false;
    const frei = teile.filter((t) => t.cls === mastCls && t.anschluss && Object.values(t.draehte || {}).reduce((s, l) => s + l.length, 0) < (MAST_PLAETZE[mastCls] || 4))
      .map((t) => ({ t, d: Math.hypot(t.anschluss[0] - p[0], t.anschluss[1] - p[1]) })).filter((x) => x.d < 9000).sort((a, b) => a.d - b.d)[0];
    if (!frei) { warnungen.push('Eine Pumpe hat keinen Strom bekommen (kein Strommast mit freiem Platz in der Nähe) – bitte im Spiel anschließen.'); return false; }
    draht(teil, komp, p, frei.t, 'PowerConnection', frei.t.anschluss);
    return true;
  };
  /** Rohrpumpe bei pos, Durchfluss entlang der Drehung rot (lokal +X); mk 1/2 (Ersatz: die andere Stufe). Strom vom nächsten Mast. */
  const pumpe = (mk, pos, rot) => {
    const cls = [mk >= 2 ? PUMPE.mk2 : PUMPE.mk1, mk >= 2 ? PUMPE.mk1 : PUMPE.mk2].find((c) => bg[c]);
    if (!cls) { if (!zaehler.pumpeGewarnt) { zaehler.pumpeGewarnt = true; warnungen.push('Rohre steigen höher als 9 m, aber es gibt keine Pumpen-Vorlage aus deinen Blaupausen (eine Blaupause mit Rohrpumpe speichern) – Pumpen bitte selbst setzen.'); } return null; }
    if (mk >= 2 && cls === PUMPE.mk1) warnungen.push('Für eine hohe Rohrspur wäre eine Pumpe Mk.2 nötig, es gibt aber nur eine Vorlage für Mk.1.');
    const p = neu({ cls, pos, rot, conn: {} });
    const [sn, ...s] = PUMPE.strom;
    anNetz(p, sn, qDreh(rot, s).map((v, i) => v + pos[i]));
    zaehler.pumpen++;
    return p;
  };
  const ctxStrom = () => strom && mastCls && kabelOk;
  return { kat, lib, ver, bg, teile, warnungen, neu, verbinde, band, rohr, rohrPfad, stueck, mkFuer, rohrMk, name, mastCls, kabelOk, strom, draht, zaehler, schild, schildCls, schredder, speicher, wasser, pumpe };
}

function vorlagenPruefen(ctx, klassen, mitRohr) {
  const { bg, kat, ver } = ctx;
  const fehlt = [...new Set(klassen)].filter((c) => !bg[c]);
  if (!Object.keys(bg).some((c) => /ConveyorBeltMk/.test(c))) fehlt.push('Build_ConveyorBeltMk1_C');
  if (mitRohr && !Object.keys(bg).some((c) => /^Build_Pipeline(MK2)?(_NoIndicator)?_C$/.test(c))) fehlt.push('Build_PipelineMK2_C');
  if (mitRohr && !bg.Build_PipelineJunction_Cross_C) fehlt.push('Build_PipelineJunction_Cross_C');
  if (fehlt.length) throw Object.assign(new Error(`Für die Blaupause fehlen Vorlagen aus deinen eigenen Blaupausen (Spielversion ${ver}): ${fehlt.map((c) => kat.gebaeude[c]?.name || c).join(', ')}. Bitte eine Blaupause speichern, in der diese Bauteile vorkommen.`), { status: 422 });
}

// Maße wie in den eigenen Blaupausen gemessen (19.10.2026, 182 Blaupausen): Maschinen direkt nebeneinander (Mitte–Mitte),
// Splitter/Merger/Kreuzung 3 m vor dem Anschluss (2 m Zuleitung), weitere Leitungen 4 m weiter außen und 2 m höher
// (Zuführband ≤ ~33°, Bänder in Blaupausen nie steiler als 40°), Strommast je Maschine 3 m außerhalb der äußersten Eingangsleitung.
const ABSTAND = { Build_SmelterMk1_C: 500, Build_ConstructorMk1_C: 800, Build_AssemblerMk1_C: 1000, Build_FoundryMk1_C: 1000, Build_ManufacturerMk1_C: 1800, Build_OilRefinery_C: 1000, Build_Blender_C: 1800, Build_Packager_C: 800, Build_HadronCollider_C: 5400, Build_QuantumEncoder_C: 2400 };
// Höhe der Maschinen (Oberkante der Spielmodelle, gemessen) – für Etagen: nächster Boden 4 m darüber
const HOEHE = { Build_SmelterMk1_C: 860, Build_ConstructorMk1_C: 730, Build_AssemblerMk1_C: 830, Build_FoundryMk1_C: 880, Build_ManufacturerMk1_C: 1220, Build_OilRefinery_C: 3020, Build_Blender_C: 1430, Build_Packager_C: 1170, Build_Converter_C: 1750, Build_HadronCollider_C: 3230, Build_QuantumEncoder_C: 730 };
const ZULEITUNG = 300, LEIT_DY = 400, LEIT_DZ = 200, MAST_AUSSEN = 300;
const REIHEN_LUECKE = 400; // freier Raum zwischen den äußersten Teilen benachbarter Reihen (gemessen meist 2–8 m)

/** Lage der Leitungen einer Reihe (relativ zur Mitte) */
function reiheLage(schritt, kat) {
  const g = GEO[schritt.gebaeude], z = zuordnen(kat, schritt);
  // Rezepte ohne Zutaten (z. B. Angeregte photonische Materie im Konverter): Lage nach den Anschlüssen des Gebäudes
  const inY = Math.min(...(z.ein.length ? z.ein.map((e) => e.port.y) : g.ein.map((p) => p.y))), outY = Math.max(...(z.aus.length ? z.aus.map((a) => a.port.y) : g.aus.map((p) => p.y)));
  const y0 = inY - ZULEITUNG, yA = outY + ZULEITUNG;
  const yMast = y0 - Math.max(0, z.ein.length - 1) * LEIT_DY - MAST_AUSSEN;
  return { g, z, inY, outY, y0, yA, yMast, yMin: Math.min(g.box[2], yMast) - 100, yMax: Math.max(g.box[3], yA + (z.aus.length - 1) * LEIT_DY) + 100 };
}
/** Maße einer Reihe relativ zu ihrer Mitte (für das Stapeln mehrerer Reihen) */
function reiheMasse(schritt, kat) {
  const l = reiheLage(schritt, kat);
  return { yMin: l.yMin, yMax: l.yMax };
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
  const abstand = ABSTAND[cls] || g.box[1] - g.box[0];
  const x0 = -((n - 1) * abstand) / 2;
  const { inY, outY, y0, yA, yMast } = reiheLage(schritt, kat);
  const kap = (art, menge) => (art === 'r' ? { mk: rohrMk(menge), max: ROHR[rohrMk(menge)] } : { mk: mkFuer(menge), max: BAND[mkFuer(menge)] });
  // Bänder innen und unten, Rohre außen und höher (Rohre laufen über die Bänder hinweg, nie hindurch)
  const bandZuerst = (l) => [...l.filter((z) => z.art === 'b'), ...l.filter((z) => z.art !== 'b')];
  // Leitungen für Volllast auslegen: alle gebauten Maschinen mit 100 % (nicht nur die geplante Teilmenge)
  const voll = schritt.anzahl / (schritt.maschinen || schritt.anzahl);
  const ein = bandZuerst(zu.ein).map((z, k) => ({ ...z, k, y: oy + y0 - k * LEIT_DY, z: Z_BAND + k * LEIT_DZ, voll: z.proMin * voll, ...kap(z.art, z.proMin * voll), knoten: [] }));
  const aus = bandZuerst(zu.aus).map((z, k) => ({ ...z, k, y: oy + yA + k * LEIT_DY, z: Z_BAND + k * LEIT_DZ, voll: z.proMin * voll, ...kap(z.art, z.proMin * voll), knoten: [] }));
  // Rohr-Zuführung über tiefere Leitungen: am Anschluss kurz gerade, steil auf Leitungshöhe, dann flach darüber
  const rohrZu = (L, xp, yp, zp, s) => [[xp, yp, zp], [xp, yp + 100 * s, zp], [xp, yp + 250 * s, L.z], [xp, L.y - 100 * s, L.z]];
  for (const L of [...ein, ...aus]) if (L.max < L.voll - 1e-6) warnungen.push(`${schritt.name}: ${name(L.item)} ${zahl(L.voll)}/min (alle Maschinen bei 100 %) passt nicht auf ${L.art === 'r' ? 'ein Rohr' : 'ein Förderband'} Mk.${L.mk} (${L.max}/min).`);
  for (const L of [...ein, ...aus]) if (L.art === 'r' && L.z - Z_BODEN > HUB_FREI) warnungen.push(`${schritt.name}: Rohrleitung ${name(L.item)} liegt ${zahl((L.z - Z_BODEN) / 100)} m hoch – mehr als die Förderhöhe einer Maschine (10 m), ggf. eine Pumpe einsetzen.`);
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
      if (L.art === 'r' && L.k > 0) ctx.rohrPfad(L.mk, rohrZu(L, ...ziel, -1).reverse(), [k.t, k.zu], [m, p.name]);
      else { const f = stueck(L.art, L.mk, [x + p.x, L.y + 100, L.z], ziel, Math.abs(L.z - ziel[2]) > 1); verbinde(k.t, k.zu, f.t, f.a); verbinde(f.t, f.e, m, p.name); }
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
      if (L.art === 'r' && L.k > 0) ctx.rohrPfad(L.mk, rohrZu(L, ...von, 1), [m, p.name], [k.t, k.von]);
      else { const f = stueck(L.art, L.mk, von, [x + p.x, L.y - 100, L.z], Math.abs(L.z - von[2]) > 1); verbinde(m, p.name, f.t, f.a); verbinde(f.t, f.e, k.t, k.von); }
      L.knoten.push(k);
    }
    maschinen.push(m);
  }
  // Abstände der S-Kurven über tiefere Leitungen prüfen
  const pruefe = (liste, yMasch) => {
    for (const [k, L] of liste.entries()) if (L.art !== 'r') for (const J of liste.slice(0, k)) {
      const ys = L.y + Math.sign(yMasch - L.y) * 100, t = (J.y - ys) / (yMasch - ys), hz = L.z + (Z_BAND - L.z) * (3 * t * t - 2 * t * t * t);
      if (hz - J.z < 60) warnungen.push(`${schritt.name}: Leitung ${name(L.item)} kreuzt ${name(J.item)} nur ${Math.round(hz - J.z)} cm darüber.`);
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
  // Strom: je Maschine ein Mast außerhalb der äußersten Eingangsleitung, Maschine → Mast, Mast → nächster Mast
  const masten = [];
  if (ctx.strom && ctx.mastCls && ctx.kabelOk) {
    const [sk, sx, sy, sz] = g.strom;
    for (const m of maschinen) {
      const mast = neu({ cls: ctx.mastCls, pos: [m.pos[0], oy + yMast, Z_BODEN], yaw: 0, conn: {} });
      mast.anschluss = [mast.pos[0], oy + yMast, Z_BODEN + 700];
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
    return { item: L.item, menge: L.proMin, voll: L.voll, art: L.art, mk: L.mk, y: L.y, z: L.z, seite: links ? -1 : 1,
      anker: links ? [k0.t, k0.rein] : [kn.t, kn.weiter], x: links ? k0.t.pos[0] - 100 : kn.t.pos[0] + 100 };
  });
  const ausgaenge = aus.map((L) => {
    const k0 = L.knoten[0], kn = L.knoten[n - 1];
    if (L.art === 'r') { const links = rs < 0; return { item: L.item, menge: L.proMin, voll: L.voll, art: 'r', mk: L.mk, y: L.y, z: L.z, seite: links ? -1 : 1, anker: links ? [k0.t, k0.links] : [kn.t, kn.rechts], x: links ? k0.t.pos[0] - 100 : kn.t.pos[0] + 100 }; }
    const e = ausgangLinks ? k0 : kn;
    return { item: L.item, menge: L.proMin, voll: L.voll, art: 'b', mk: L.mk, y: L.y, z: L.z, seite: ausgangLinks ? -1 : 1, anker: [e.t, e.raus], x: e.t.pos[0] + (ausgangLinks ? -100 : 100) };
  });
  const xs = [...maschinen.map((m) => m.pos[0] + g.box[0]), ...maschinen.map((m) => m.pos[0] + g.box[1]), ...eingaenge.map((e) => e.x), ...ausgaenge.map((a) => a.x)];
  const mm = reiheMasse(schritt, kat);
  return { schritt, maschinen, masten, eingaenge, ausgaenge, abstand, leitungen: ein.length, xMin: Math.min(...xs), xMax: Math.max(...xs), yMin: oy + mm.yMin, yMax: oy + mm.yMax };
}

/** Fundamente (8-m-Raster unter allem), Objekte erzeugen, Kopf (Baukosten, Rezepte, Größe) */
function abschliessen(ctx, { fundament, hasFlags, extraXs = [], extraYs = [], boeden = null }) {
  const { kat, lib, ver, teile, neu, warnungen } = ctx;
  const fCls = [fundament, ...FUNDAMENTE].find((c) => c && templateFor(lib, kat, ver, c));
  const xs = [...extraXs], ys = [...extraYs];
  for (const t of teile) { for (const p of t.spline || [t.pos]) { xs.push(p[0]); ys.push(p[1]); } if (t.box) { xs.push(t.box[0], t.box[1]); ys.push(t.box[2], t.box[3]); } }
  const fx0 = Math.floor((Math.min(...xs) - 100) / 800), fx1 = Math.ceil((Math.max(...xs) + 100) / 800);
  const fy0 = Math.floor((Math.min(...ys) - 100) / 800), fy1 = Math.ceil((Math.max(...ys) + 100) / 800);
  let fundamente = 0;
  if (fCls && boeden) { // Etagen: je Boden eine eigene Fläche (Spalten für Lifte und Rohre bleiben frei)
    for (const b of boeden) for (let ix = 0; ix < b.nx; ix++) for (let iy = 0; iy < b.ny; iy++) { neu({ cls: fCls, pos: [b.x0 + ix * 800 + 400, b.y0 + iy * 800 + 400, b.z], yaw: 0, einfach: true }); fundamente++; }
  } else if (fCls) for (let ix = fx0; ix < fx1; ix++) for (let iy = fy0; iy < fy1; iy++) { neu({ cls: fCls, pos: [ix * 800 + 400, iy * 800 + 400, Z_BODEN - 50], yaw: 0, einfach: true }); fundamente++; }
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
    dimensions: [Math.max(1, fx1 - fx0), Math.max(1, fy1 - fy0), boeden ? Math.max(4, Math.ceil((Math.max(...boeden.map((b) => b.z)) + 2000) / 800)) : 4],
  };
  return { objs, kopf, fundamente, groesse: [(fx1 - fx0) * 8, (fy1 - fy0) * 8] };
}

const brauchtRohr = (kat, schritte) => schritte.some((s) => [...s.zutaten, ...s.produkte].some((z) => istFluessig(kat, z.item)));

/**
 * Eine Fertigungsstufe als Reihe (mit freien Ein-/Ausgängen und Schildern).
 * Ausgang 0 = Hauptprodukt (frei mit Schild); weitere feste Produkte (Nebenprodukte) → Schredder, flüssige → freies Rohr.
 */
export function baueReihe({ kat, lib, ver, hasFlags, schritt, bandMax = 6, fundament, strom = true, nebenprodukt = 'schredder', wasser = false }) {
  const b = baubar(schritt, kat);
  if (!b.ok) throw Object.assign(new Error(b.grund), { status: 422 });
  if (schritt.anzahl > 200) throw Object.assign(new Error(`Das wären ${schritt.anzahl} Maschinen in einer Reihe – bitte kleinere Mengen wählen.`), { status: 422 });
  const ctx = umgebung({ kat, lib, ver, bandMax, strom });
  vorlagenPruefen(ctx, [schritt.gebaeude, 'Build_ConveyorAttachmentSplitter_C', 'Build_ConveyorAttachmentMerger_C'], brauchtRohr(kat, [schritt]));
  const r = reihe(ctx, schritt);
  const { stueck, verbinde, name, schild } = ctx;
  const xEin = Math.min(...r.eingaenge.map((e) => e.x)) - 400;
  r.eingaenge.forEach((e, k) => {
    // Eingang auf der Seite seines freien Endes (Rohr-Eingänge liegen rechts)
    const xe = e.seite > 0 ? Math.max(...r.eingaenge.map((q) => q.x)) + 400 : xEin;
    const w = wasser && e.item === 'Desc_Water_C' && e.seite > 0 && ctx.wasser(e, xe, r.masten[r.masten.length - 1]);
    if (w) {
      ctx.rohrPfad(e.mk, [[w.x, e.y, e.z], [e.x, e.y, e.z]], w.anker, e.anker);
      schild([xe, e.y - 250, e.z + 50], -90, `WASSER: ${zahl(e.menge)} m³/min aus ${w.n}× Wasserextraktor`, 'W');
      return;
    }
    const f = stueck(e.art, e.mk, [xe, e.y, e.z], [e.x, e.y, e.z]);
    verbinde(f.t, f.e, e.anker[0], e.anker[1]);
    schild([xe, e.y - 250, e.z + 50], e.seite > 0 ? -90 : 90, `EINGANG${r.eingaenge.length > 1 ? ' ' + (k + 1) : ''}: ${zahl(e.menge)}/min ${name(e.item)}`, r.eingaenge.length > 1 ? `E${k + 1}` : 'E');
  });
  const haupt = kat.rezepte[schritt.rezept]?.produkte?.[0]?.item;
  r.ausgaenge.forEach((a, k) => {
    const xAus = a.x + 400;
    if (a.art === 'r' && a.item !== haupt && nebenprodukt === 'schredder' && ctx.speicher(a.mk, [a.x, a.y, a.z], a.anker)) {
      schild([xAus, a.y + 250, a.z + 50], -90, `NEBENPRODUKT: ${zahl(a.menge)} m³/min ${name(a.item)}`, 'N');
      return;
    }
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
      schilder: ctx.teile.filter((t) => t.schild).length, bandEin: r.eingaenge[0].mk, bandAus: a0.mk, leitungen: r.leitungen, masten: ctx.zaehler.masten, kabel: ctx.zaehler.kabel, schredder: ctx.zaehler.schredder, speicher: ctx.zaehler.speicher, extraktoren: ctx.zaehler.extraktoren, pumpen: ctx.zaehler.pumpen,
      groesse: f.groesse, warnungen: ctx.warnungen,
    },
  };
}

// ------------------------------------------------------------------ Ganze Kette
const Z_SPUR_STANDARD = 1600, Z_SPUR = Z_SPUR_STANDARD;      // Höhe der Verbindungsbänder in der Logistik-Spalte (über allen Verteilerleitungen)
const Z_ROHRSPUR = 650;   // unterste Rohrspur rechts (zwischen den Leitungshöhen 2/5/8 m); jede weitere 3 m höher

/**
 * Alle baubaren Stufen eines Plans als eine Blaupause. Reihen übereinander (entlang +Y). Bänder: alle Ein-/Ausgänge
 * links, Logistik-Spalte links mit Förderliften (Spuren auf 16 m). Rohre: Ein-/Ausgänge rechts, Rohr-Spalte rechts:
 * je Verbindung eine Spur auf eigener Höhe (äußere höher), Steigrohre direkt neben der Reihe.
 * Feste Nebenprodukte ohne Abnehmer → AWESOME-Schredder; flüssige → freies Rohr mit Schild.
 */
export function baueKette({ kat, lib, ver, hasFlags, ergebnis, bandMax = 6, fundament, strom = true, nur = null, wasser = false, etagen = false }) {
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
  let cursor = 0, zBasis = 0;
  const reihen = [];
  // Etagen: jede Stufe auf einem eigenen Boden übereinander (Rohstoffseite unten), nächster Boden 4 m über der höchsten
  // Maschine bzw. Leitung. Alles einer Reihe wird nachträglich um die Bodenhöhe angehoben.
  const anheben = (teile, dz) => {
    const gesehen = new Set(), hoch = (p) => { if (p && !gesehen.has(p)) { gesehen.add(p); p[2] += dz; } };
    for (const t of teile) { hoch(t.pos); (t.spline || []).forEach(hoch); (t.punkte || []).forEach((q) => hoch(q.loc)); hoch(t.anschluss); if (t.kabel) { hoch(t.kabel.locA); hoch(t.kabel.locB); } }
  };
  // Etagen: je Fertigungsebene ein Boden, darauf ihre Reihen nebeneinander (wie sonst entlang Y)
  const gruppen = etagen ? [...new Set(bau.map((x) => x.s.ebene))].map((eb) => bau.filter((x) => x.s.ebene === eb)) : [bau];
  for (const gruppe of gruppen) {
    let oben = 0;
    if (etagen) cursor = 0;
    for (const x of gruppe) {
      const m = reiheMasse(x.s, kat);
      const oy = cursor - m.yMin;
      const start = ctx.teile.length;
      const r = reihe(ctx, x.s, { oy, ausgangLinks: true, rohrSeite: 1 });
      r.index = x.i; r.oz = 0;
      if (etagen && zBasis) {
        anheben(ctx.teile.slice(start), zBasis);
        for (const l of [...r.eingaenge, ...r.ausgaenge]) l.z += zBasis;
      }
      r.oz = etagen ? zBasis : 0;
      oben = Math.max(oben, HOEHE[x.s.gebaeude] || 1200, ...[...r.eingaenge, ...r.ausgaenge].map((l) => l.z - r.oz - Z_BODEN + 200));
      reihen.push(r);
      cursor = oy + m.yMax + REIHEN_LUECKE;
    }
    if (etagen) zBasis += Math.ceil((oben + 400 + 100) / 100) * 100; // nächster Boden: 4 m über der höchsten Maschine + 1 m Fundament
  }
  // Böden (Etagen): gemeinsame Fläche über allen Reihen; links die Lift-Spalte, rechts die Rohr-Spalte außerhalb
  let boeden = null, xBodenEnde = null;
  if (etagen) {
    const bx0 = Math.min(...reihen.map((r) => r.xMin)) - 100, bx1 = Math.max(...reihen.map((r) => r.xMax)) + 100;
    const by0 = Math.min(...reihen.map((r) => r.yMin)) - 100, by1 = Math.max(...reihen.map((r) => r.yMax)) + 100;
    const nx = Math.max(1, Math.ceil((bx1 - bx0) / 800)), ny = Math.max(1, Math.ceil((by1 - by0) / 800));
    boeden = [...new Set(reihen.map((r) => r.oz))].map((oz) => ({ x0: bx0, y0: by0, nx, ny, z: oz + Z_BODEN - 50 }));
    xBodenEnde = bx0 + nx * 800;
    if (zBasis > 4800 * 2) warnungen.push(`Die Etagen sind zusammen ${zahl(zBasis / 100)} m hoch – Förderlifte gehen im Spiel nur bis 48 m; ggf. als Teilfabriken bauen.`);
  }
  for (let k = 0; k + 1 < reihen.length; k++) {
    const a = reihen[k].masten[reihen[k].masten.length - 1], b = reihen[k + 1].masten[0];
    if (a && b) ctx.draht(a, 'PowerConnection', a.anschluss, b, 'PowerConnection', b.anschluss);
  }
  // Verbindungen aus den Kanten der Rechnung
  const reiheVon = new Map(reihen.map((r) => [r.index, r]));
  const verb = [];
  for (const r of reihen) for (const e of r.eingaenge) {
    // jede liefernde Reihe wird angeschlossen (nicht nur die größte)
    const quellen = [];
    for (const k of ergebnis.kanten.filter((q) => q.nach === r.index && q.item === e.item && reiheVon.has(q.von)).sort((p, q) => q.menge - p.menge)) {
      const von = reiheVon.get(k.von), a = von.ausgaenge.find((x) => x.item === e.item);
      if (!a) continue;
      const v = { von, nach: r, eingang: e, ausgang: a, item: e.item, art: e.art, menge: k.menge, voll: a.voll }; // Verbindung trägt die volle Menge der Quelle (Tim: lieber Mk.4 durchgehend)
      verb.push(v); quellen.push(v);
    }
    if (!quellen.length) continue;
    e.verbunden = true;
    // Rest von außen (Rohstoff, nicht gebaute Stufe): intern geht vor, der Zulauf kommt nur für das, was fehlt
    e.aussen = ergebnis.kanten.filter((q) => q.nach === r.index && q.item === e.item && !reiheVon.has(q.von)).reduce((s, q) => s + q.menge, 0);
    if (e.aussen < 1e-6) e.aussen = 0;
    if (quellen.length < 2 && !e.aussen) continue;
    e.mehrfach = true; // mehrere Zuflüsse: Band über Merger, Rohr über Kreuzungen mit Anschluss nach oben
    if (e.art === 'b') continue;
    // Rohr: Kreuzungen vor dem Leitungsende (erste = Zulauf von außen, falls nötig), je Quelle eine; Zufluss jeweils von oben
    const js = [];
    for (let i = 0; i < quellen.length + (e.aussen ? 1 : 0); i++) {
      const xJ = e.x + 200 + 300 * i;
      const J = neu({ cls: 'Build_PipelineJunction_Cross_C', pos: [xJ, e.y, e.z], rot: [Math.SQRT1_2, 0, 0, Math.SQRT1_2], conn: {} });
      ctx.rohrPfad(e.mk, [[xJ - 100, e.y, e.z], [i ? xJ - 200 : e.x, e.y, e.z]], [J, 'Connection0'], i ? [js[i - 1], 'Connection1'] : e.anker);
      js.push(J);
    }
    e.x = js[js.length - 1].pos[0] + 100;
    if (e.aussen) e.zulauf = { J: js[0], x: js[0].pos[0], menge: e.aussen };
    e.quellJ = js.slice(e.aussen ? 1 : 0);
  }
  const vb = verb.filter((v) => v.art === 'b'), vr = verb.filter((v) => v.art === 'r');
  const X0 = Math.min(...reihen.map((r) => r.xMin)) - 600;
  vb.forEach((v, k) => { v.x = X0 - 400 * k; });
  const xFrei = X0 - 400 * vb.length - 400;
  // Rohr-Spalte rechts: Abzweig-Kreuzungen und Steigrohre zwischen Reihe und XR, Spuren dahinter (äußere höher)
  // Direkt verbinden, wenn zwischen Ausgangs- und Eingangsleitung nichts liegt (benachbarte Reihen, beide außen)
  for (const v of vr) {
    const a = v.ausgang, e = v.eingang, lo = Math.min(a.y, e.y), hi = Math.max(a.y, e.y);
    const frei = (l) => l === a || l === e || l.y < lo || l.y > hi;
    v.direkt = !etagen && !e.mehrfach && e.x + 300 <= Math.max(a.x + 300, v.von.xMax + 400) && reihen.every((q) => (q === v.von || q === v.nach)
      ? [...q.eingaenge, ...q.ausgaenge].every(frei) : q.yMax < lo || q.yMin > hi);
  }
  const maxAb = Math.max(1, ...reihen.flatMap((r) => r.ausgaenge.map((a) => vr.filter((v) => v.ausgang === a).length)));
  const XR = (etagen ? xBodenEnde + 300 : Math.max(...reihen.map((r) => r.xMax))) + 600 + 300 * maxAb;
  // Spuren mindestens 4 m über der höchsten Leitung (freie Rohre kreuzen die Spalte darunter)
  const zSpur = Math.max(Z_ROHRSPUR, ...reihen.flatMap((r) => [...r.eingaenge, ...r.ausgaenge].filter((l) => l.art === 'r').map((l) => l.z + 400)));
  const spur = vr.filter((v) => !v.direkt);
  spur.forEach((v, k) => { v.x = XR + 400 + 400 * k; v.h = etagen ? Math.max(v.ausgang.z, v.eingang.z) + 400 + 300 * k : zSpur + 300 * k; });
  vr.filter((v) => v.direkt).forEach((v) => { v.h = Infinity; });
  // mehrere Rohr-Zuflüsse: die höchste Spur fällt in die Kreuzung nächst der Reihe (überquert die übrigen oberhalb)
  for (const e of new Set(vr.filter((v) => v.eingang.quellJ).map((v) => v.eingang))) vr.filter((v) => v.eingang === e).sort((p, q) => q.h - p.h).forEach((v, i) => { v.J = e.quellJ[i]; });
  const xFreiR = XR + 400 + 400 * spur.length + 400;
  const lift = (mk, pos, yawDeg, hoch, relYaw) => neu({ cls: `Build_ConveyorLiftMk${mk}_C`, pos, yaw: yawDeg, conn: {}, lift: { hoch, relYaw } });
  // Rohrzug: ein Rohr mit Bögen an den Ecken (über 50 m in Linie gestoßen)
  const rohrzug = ctx.rohrPfad;
  const extern = (r, a) => (ergebnis.ziele.find((z) => z.item === a.item)?.menge || 0) > 1e-6 || (nur && nur.max === r.index && a.item === kat.rezepte[r.schritt.rezept]?.produkte?.[0]?.item);
  const istHaupt = (r, a) => a.item === kat.rezepte[r.schritt.rezept]?.produkte?.[0]?.item;

  for (const r of reihen) for (const a of r.ausgaenge) {
    const abgaenge = verb.filter((v) => v.von === r && v.ausgang === a).sort((p, q) => (a.art === 'b' ? q.x - p.x : p.x - q.x));
    const intern = abgaenge.reduce((s, v) => s + v.menge, 0);
    const restMenge = Math.max(0, a.menge - intern);
    // „rest:…“ = Überschuss ohne Abnehmer (Nebenprodukt) – kein Ausgang nach außen
    const nachAussen = extern(r, a) || ergebnis.kanten.some((k) => k.von === r.index && k.item === a.item && !reiheVon.has(k.nach) && !String(k.nach).startsWith('rest:'));
    let von = a.anker, x = a.x;
    if (a.art === 'b') {
      for (const v of abgaenge) {
        const sp = neu({ cls: 'Build_ConveyorAttachmentSplitter_C', pos: [v.x, a.y, a.z], yaw: 180, conn: {} });
        const b0 = band(a.mk, [x, a.y, a.z], [v.x + 100, a.y, a.z]);
        verbinde(von[0], von[1], b0, 'ConveyorAny0'); verbinde(b0, 'ConveyorAny1', sp, 'Input1');
        von = [sp, 'Output1']; x = v.x - 100;
        const e = v.eingang, sgn = Math.sign(e.y - a.y) || 1, mk = mkFuer(v.voll);
        const Z_SPUR = etagen ? Math.max(a.z, e.z) + 400 : Z_SPUR_STANDARD; // Etagen: Spur 4 m über der höheren Leitung
        if (etagen && Math.max(Z_SPUR - a.z, Z_SPUR - e.z) > 4800) warnungen.push(`Verbindung ${name(v.item)}: Förderlift höher als 48 m – im Spiel ggf. zwei Lifte übereinander setzen.`);
        const b1 = band(mk, [v.x, a.y + 100 * sgn, a.z], [v.x, a.y + 200 * sgn, a.z]); // Lift mittig zwischen zwei Leitungen
        verbinde(sp, sgn > 0 ? 'Output3' : 'Output2', b1, 'ConveyorAny0');
        const l1 = lift(mk, [v.x, a.y + 200 * sgn, a.z], 90 * sgn + 180, Z_SPUR - a.z, 180);
        verbinde(b1, 'ConveyorAny1', l1, 'ConveyorAny0');
        if (e.mehrfach) { // Lift neben der Leitung, von der Seite in einen Merger auf der Leitung (Kette der Merger unten)
          const yl = e.y - 200 * sgn;
          const b2 = band(mk, [v.x, a.y + 200 * sgn, Z_SPUR], [v.x, yl, Z_SPUR]);
          verbinde(l1, 'ConveyorAny1', b2, 'ConveyorAny0');
          const l2 = lift(mk, [v.x, yl, Z_SPUR], 90 * sgn + 180, e.z - Z_SPUR, 180);
          verbinde(b2, 'ConveyorAny1', l2, 'ConveyorAny0');
          v.merger = neu({ cls: 'Build_ConveyorAttachmentMerger_C', pos: [v.x, e.y, e.z], yaw: 0, conn: {} });
          const b3 = band(mk, [v.x, yl, e.z], [v.x, e.y - 100 * sgn, e.z]);
          verbinde(l2, 'ConveyorAny1', b3, 'ConveyorAny0'); verbinde(b3, 'ConveyorAny1', v.merger, sgn > 0 ? 'Input3' : 'Input2');
          continue;
        }
        const b2 = band(mk, [v.x, a.y + 200 * sgn, Z_SPUR], [v.x, e.y, Z_SPUR]);
        verbinde(l1, 'ConveyorAny1', b2, 'ConveyorAny0');
        const l2 = lift(mk, [v.x, e.y, Z_SPUR], 90 * sgn + 180, e.z - Z_SPUR, -(90 * sgn + 180));
        verbinde(b2, 'ConveyorAny1', l2, 'ConveyorAny0');
        const b3 = band(Math.max(mk, e.mk), [v.x, e.y, e.z], [e.x, e.y, e.z]);
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
      const xs0 = etagen ? Math.max(a.x + 300, xBodenEnde + 300) : Math.max(a.x + 300, r.xMax + 400);
      reihenfolge.forEach((v, k) => { v.xk = xs0 + 300 * k; });
      for (const v of [...reihenfolge].sort((p, q) => p.xk - q.xk)) {
        const kr = neu({ cls: 'Build_PipelineJunction_Cross_C', pos: [v.xk, a.y, a.z], yaw: 0, conn: {} });
        rohrzug(a.mk, [[x, a.y, a.z], [v.xk - 100, a.y, a.z]], von, [kr, 'Connection0']);
        von = [kr, 'Connection1']; x = v.xk + 100;
        const e = v.eingang, sgn = Math.sign(e.y - a.y) || 1, mk = rohrMk(v.voll), ys = a.y + (LEIT_DY / 2) * sgn; // Steigrohr mittig zwischen zwei Leitungen
        if (v.direkt) { // geradeaus zur Eingangsleitung, Höhenwechsel kurz vor dem Ziel
          rohrzug(mk, [[v.xk, a.y + 100 * sgn, a.z], [v.xk, e.y - 600 * sgn, a.z], [v.xk, e.y - 300 * sgn, e.z], [v.xk, e.y, e.z], [e.x, e.y, e.z]], [kr, sgn > 0 ? 'Connection2' : 'Connection3'], e.anker);
          continue;
        }
        let start = [kr, sgn > 0 ? 'Connection2' : 'Connection3'], weg = [[v.xk, a.y + 100 * sgn, a.z], [v.xk, ys, a.z]];
        if (v.h - r.oz - Z_BODEN > HUB_FREI) { // Spur zu hoch für die Förderhöhe der Maschine: Pumpe senkrecht unten im Steigrohr
          const pp = [v.xk, ys, a.z + 350];
          const pu = ctx.pumpe(v.h - pp[2] > PUMPE.hubMk1 ? 2 : 1, pp, [0, -Math.SQRT1_2, 0, Math.SQRT1_2]); // lokal +X → nach oben
          if (pu) { rohrzug(mk, [...weg, pp], start, [pu, 'Connection0']); start = [pu, 'Connection1']; weg = [pp]; }
        }
        const ende = v.J ? [[v.J.pos[0], e.y, v.h], [v.J.pos[0], e.y, e.z + 100]] : [[XR, e.y, v.h], [XR, e.y, e.z], [e.x, e.y, e.z]];
        rohrzug(mk, [...weg, [v.xk, ys, v.h], [v.x, ys, v.h], [v.x, e.y, v.h], ...ende], start, v.J ? [v.J, 'Connection2'] : e.anker);
      }
      if (nachAussen || !abgaenge.length) {
        const menge = abgaenge.length ? restMenge : a.menge;
        if (!nachAussen && !istHaupt(r, a) && ctx.speicher(a.mk, [x, a.y, a.z], von, xFreiR + 400)) {
          schild([xFreiR, a.y + 250, a.z + 50], -90, `NEBENPRODUKT: ${zahl(menge)} m³/min ${name(a.item)}`, 'N');
          continue;
        }
        rohrzug(a.mk, [[x, a.y, a.z], [xFreiR, a.y, a.z]], von, null); // kreuzt die Spuren unterhalb
        schild([xFreiR, a.y + 250, a.z + 50], -90, `${nachAussen || istHaupt(r, a) ? 'AUSGANG' : 'NEBENPRODUKT'}: ${zahl(menge)} m³/min ${name(a.item)}`, 'A');
      }
    }
  }
  // Freie Eingänge (Rohstoffe, Zulieferungen, nicht gebaute Stufen)
  const freieEin = [];
  for (const r of reihen) for (const e of r.eingaenge) {
    if (e.mehrfach && e.art === 'b') { // Merger der Zuflüsse verketten (links → rechts), Rest von außen in den ersten
      const ms = verb.filter((v) => v.eingang === e && v.merger).map((v) => v.merger).sort((p, q) => p.pos[0] - q.pos[0]);
      for (let i = 0; i < ms.length; i++) {
        const x1 = i + 1 < ms.length ? ms[i + 1].pos[0] - 100 : e.x;
        const b = band(Math.max(e.mk, mkFuer(verb.filter((v) => v.eingang === e && v.merger && v.merger.pos[0] <= ms[i].pos[0]).reduce((s, v) => s + v.voll, 0))), [ms[i].pos[0] + 100, e.y, e.z], [x1, e.y, e.z]);
        verbinde(ms[i], 'Output1', b, 'ConveyorAny0');
        verbinde(b, 'ConveyorAny1', ...(i + 1 < ms.length ? [ms[i + 1], 'Input1'] : e.anker));
      }
      if (e.aussen) {
        const b = band(e.mk, [xFrei, e.y, e.z], [ms[0].pos[0] - 100, e.y, e.z]);
        verbinde(b, 'ConveyorAny1', ms[0], 'Input1');
        schild([xFrei, e.y - 250, e.z + 50], 90, `EINGANG: ${zahl(e.aussen)}/min ${name(e.item)} (Rest – intern geht vor)`, 'E');
        freieEin.push(e);
      }
      continue;
    }
    if (e.zulauf) { // teilweise intern versorgt: Rest über den nach oben zeigenden Anschluss
      const z = e.zulauf, oben = [z.x, e.y, e.z + 100], ye = e.y - 400;
      const w = wasser && e.item === 'Desc_Water_C' && ctx.wasser({ ...e, y: ye, menge: z.menge }, xFreiR + 800, r.masten[r.masten.length - 1]);
      if (w) { // Sammelleitung der Extraktoren parallel daneben, dann über die Kreuzung und von oben hinein
        rohrzug(e.mk, [[w.x, ye, e.z], [z.x, ye, e.z], [z.x, ye, e.z + 400], [z.x, e.y, e.z + 400], oben], w.anker, [z.J, 'Connection2']);
        schild([z.x + 300, ye - 250, e.z + 50], -90, `WASSER: ${zahl(z.menge)} m³/min aus ${w.n}× Wasserextraktor (Rest, Nebenprodukt-Wasser geht vor)`, 'W');
      } else {
        rohrzug(e.mk, [oben, [z.x, e.y, e.z + 300]], [z.J, 'Connection2'], null);
        schild([z.x + 250, e.y - 250, e.z + 200], -90, `ZULAUF VON OBEN: ${zahl(z.menge)} m³/min ${name(e.item)} (Rest – intern geht vor)`, 'Z');
      }
      freieEin.push(e);
      continue;
    }
    if (e.verbunden) continue;
    if (e.art === 'b') {
      const be = band(e.mk, [xFrei, e.y, e.z], [e.x, e.y, e.z]);
      verbinde(be, 'ConveyorAny1', e.anker[0], e.anker[1]);
      schild([xFrei, e.y - 250, e.z + 50], 90, `EINGANG: ${zahl(e.menge)}/min ${name(e.item)}`, 'E');
    } else {
      const w = wasser && e.item === 'Desc_Water_C' && ctx.wasser(e, xFreiR + 800, r.masten[r.masten.length - 1]);
      if (w) {
        rohrzug(e.mk, [[w.x, e.y, e.z], [e.x, e.y, e.z]], w.anker, e.anker);
        schild([xFreiR, e.y - 250, e.z + 50], -90, `WASSER: ${zahl(e.menge)} m³/min aus ${w.n}× Wasserextraktor`, 'W');
        freieEin.push(e);
        continue;
      }
      rohrzug(e.mk, [[xFreiR, e.y, e.z], [e.x, e.y, e.z]], null, e.anker);
      schild([xFreiR, e.y - 250, e.z + 50], -90, `EINGANG: ${zahl(e.menge)} m³/min ${name(e.item)}`, 'E');
    }
    freieEin.push(e);
  }
  for (const r of reihen) schild([r.xMax + 300, (r.yMin + r.yMax) / 2, r.oz + Z_BODEN + 300], -90, `${r.schritt.anzahl}× ${kat.gebaeude[r.schritt.gebaeude]?.name || ''}: ${r.schritt.name}`, '#');
  if (!ctx.schildCls) warnungen.push('Keine Schild-Vorlage gefunden – Blaupause ohne Schilder.');

  const f = abschliessen(ctx, { fundament, hasFlags, extraXs: [xFrei, vr.length ? xFreiR : XR], extraYs: reihen.flatMap((r) => [r.yMin, r.yMax]), boeden });
  return {
    objs: f.objs, kopf: f.kopf,
    info: {
      reihen: reihen.length, maschinen: reihen.reduce((s, r) => s + r.schritt.anzahl, 0), verbindungen: verb.length, eingaenge: freieEin.length,
      baender: ctx.teile.filter((t) => t.spline && !t.rohr).length, rohre: ctx.teile.filter((t) => t.rohr).length, lifte: ctx.teile.filter((t) => t.lift).length, fundamente: f.fundamente,
      etagen: etagen ? new Set(reihen.map((r) => r.oz)).size : 0, hoehe: etagen ? Math.round(zBasis / 100) : 0,
      masten: ctx.zaehler.masten, kabel: ctx.zaehler.kabel, schredder: ctx.zaehler.schredder, speicher: ctx.zaehler.speicher, extraktoren: ctx.zaehler.extraktoren, pumpen: ctx.zaehler.pumpen, groesse: f.groesse, warnungen, nichtGebaut: alle.filter((x) => !x.ok).map((x) => x.s.name),
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

/** Schildfarben fest setzen (weiße Schrift auf dunklem Grund) – Vorlagen aus fremden Blaupausen haben teils Schrift = Hintergrund */
const SCHILD_FARBEN = { mForegroundColor: [1, 1, 1, 1], mBackgroundColor: [0.02, 0.02, 0.025, 1] };
function schildFarben(data) {
  const out = Buffer.from(data);
  for (const p of zerlege(out, true).props) {
    const f = SCHILD_FARBEN[p.name];
    if (f && p.size === 16) f.forEach((v, i) => out.writeFloatLE(v, p.valStart + i * 4));
  }
  return out;
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
      if (t.schild) data = schildFarben(setzeSchildTexte(data, t.schild));
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
    if (t.punkte) {
      pos = t.punkte[0].loc;
      data = baueSpline(data, t.punkte.map((q) => ({ loc: q.loc.map((v, i) => v - pos[i]), arrive: q.arrive, leave: q.leave })));
    } else if (t.spline) {
      const [a, e] = t.spline;
      const d = [e[0] - a[0], e[1] - a[1], e[2] - a[2]];
      const len = Math.hypot(...d) || 1, u = d.map((v) => v / len), h = d.map((v) => v / 2);
      pos = a;
      if (t.kurve) { // waagerecht an beiden Enden, dazwischen sanft auf/ab (S-Kurve)
        const lh = Math.hypot(d[0], d[1]) || 1, w = [d[0] / lh, d[1] / lh, 0], T = w.map((v) => v * lh);
        data = baueSpline(data, [{ loc: [0, 0, 0], arrive: w, leave: T }, { loc: d, arrive: T, leave: w }]);
      } else data = baueSpline(data, [{ loc: [0, 0, 0], arrive: u, leave: h }, { loc: d, arrive: h, leave: u }]);
    }
    if (t.swatch) data = setzeFarbe(data, t.swatch);
    if (t.regeln) data = setzeSortierRegeln(data, t.regeln);
    // Bänder/Förderlifte: Item-Liste hinter den Eigenschaften leeren (die Vorlage kann aus einer Blaupause mit vollen Bändern stammen,
    // sonst liegen im Spiel z. B. Beeren darauf). Leer = int32 0 + Anzahl 0.
    if (/^Build_Conveyor(Belt|Lift)/.test(t.tpl.typePath.split('.').pop())) { const z = zerlege(data, true); if (data.length - z.noneEnd !== 8) data = Buffer.concat([data.subarray(0, z.noneEnd), Buffer.alloc(8)]); }
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

// Für den Baukasten (lib/baukasten.mjs): Bausteine des Planers wiederverwenden
export { umgebung, vorlagenPruefen, abschliessen, ROH, Z_BODEN, Z_BAND, BAND as BAND_KAPAZITAET, ROHR as ROHR_KAPAZITAET, ROHR_BOGEN, ROHR_MAX };
