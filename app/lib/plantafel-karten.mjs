// Plan-Tafel, Stil „Optimiert“: eigene Karten aus Schildern mit Bildern und Ziffern – ohne fremde Vorlage.
// Die Schilder werden mit lib/schildbau.mjs frei zusammengesetzt (Layout, Texte, Bilder, Farben).
//
// Karte je Fertigungsschritt (4 m breit, von vorn gesehen):
//   ┌──────────────── Kopf (4-m-Schild): Bild Maschine · „3×“ · Rezept ────────────────┐
//   │ Porträt (2 × 3 m): Bild + Name des Produkts │ Eingänge: je Schild (Bild + Name)    │
//   │                                             │ darunter 4 Ziffern = Menge / min     │
//   │ darunter 4 Ziffern = Produktion / min       │                                      │
//   └──────────────────────────────────────────────────────────────────────────────────┘
// Spalten: Rohstoffe → Stufe 1 … n → Ergebnis; höchstens 6 Spalten nebeneinander, dann eine Reihe darunter.
// Lage wie lib/plantafel.mjs: Wand in der X-Z-Ebene, Vorderseite nach −Y, x nach links größer (von vorn gelesen).
import { createBlueprint, readBlueprint } from './sbp.mjs';
import { makeHead, i32 } from './vorlagen.mjs';
import { schildBausteine, baueSchild, schildKopf } from './schildbau.mjs';

const K = {
  kopf: 'Build_StandaloneWidgetSign_SmallVeryWide_C', // 4 × 0,5 m, Layout 4x1_4 (Bild, Name, Label)
  feld: 'Build_StandaloneWidgetSign_Small_C',         // 2 × 0,5 m, Layout 4x1_3 (Bild + Name)
  bild: 'Build_StandaloneWidgetSign_Portrait_C',      // 2 × 3 m, Layout 2x3_1 (großes Bild + Name)
  ziffer: 'Build_StandaloneWidgetSign_Square_Tiny_C', // 0,5 × 0,5 m, Layout 1x1_3 (ein großes Zeichen)
};
const FARBE = {
  titel: [[0.02, 0.02, 0.025, 1], [0.96, 0.6, 0.12, 1]],
  spalte: [[0.02, 0.02, 0.025, 1], [0.85, 0.85, 0.82, 1]],
  kopf: [[1, 1, 1, 1], [0.33, 0.2, 0.06, 1]],
  ein: [[1, 1, 1, 1], [0.04, 0.16, 0.36, 1]],
  aus: [[1, 1, 1, 1], [0.04, 0.3, 0.1, 1]],
  roh: [[1, 1, 1, 1], [0.3, 0.16, 0.05, 1]],
  ziffer: [[1, 1, 1, 1], [0.06, 0.06, 0.07, 1]],
  info: [[1, 1, 1, 1], [0.18, 0.18, 0.2, 1]],
};
const KARTE_B = 400, SPALTE_LUECKE = 60, REIHE_LUECKE = 120, KARTE_LUECKE = 50, KOPF_H = 50, ZEILE_EIN = 100, ZEILE_LISTE = 60;
const JE_REIHE = 6;

/** 4 Zeichen für die Ziffern-Schilder: ab 100 ganze Zahl, darunter eine Nachkommastelle („07,5“) */
export function vierStellen(v) {
  const n = Math.max(0, v);
  if (n >= 9999.5) return '9999';
  if (n >= 100 || Math.abs(n - Math.round(n)) < 0.05) return String(Math.round(n)).padStart(4, '0');
  return (Math.round(n * 10) / 10).toFixed(1).replace('.', ',').padStart(4, '0');
}

/** Lange Wörter fürs Bildschild (2 m breit) trennen: höchstens 12 Zeichen je Zeile (im Spiel gemessen: „Schwerölrückstand“ lief über) */
export function umbrechen(text, max = 12) {
  return String(text).split(' ').map((w) => {
    if (w.length <= max) return w;
    if (/.-./.test(w)) return w.split(/(?<=-)/).map((t) => (t.length > max ? umbrechen(t, max) : t)).join('\n'); // an vorhandenen Bindestrichen
    const teile = []; let r = w;
    // zuerst an bekannten Wortteilen trennen (Satisfactory-Namen sind meist Zusammensetzungen)
    const fuge = /(rückstand|steuerungs|steuerung|einheit|barren|träger|stange|rahmen|platte|platine|blech|draht|rohr|motor|kabel|faser|beschichtung|verkabelung|oszillator|prozessor|kristall|materie|magnetische|batterie|behälter|kanister|schrauben|quarz|sand|beton|stahl|eisen|kupfer|stickstoff|nuklear|elektro|server|rakete|beschleuniger|kodierer)/gi;
    let m, beste = -1; while ((m = fuge.exec(r)) && m.index <= max + 1) if (m.index >= 4 && m.index <= max + 1 && r.length - m.index >= 4) beste = m.index;
    if (beste > 0 && r.length > max) {
      const kopf = r.slice(0, beste), rest = r.slice(beste);
      return kopf + (kopf.endsWith('-') ? '' : '-') + '\n' + umbrechen(rest, max);
    }
    while (r.length > max) {
      // Trennstelle: letzte Silbengrenze (Mitlaut vor Selbstlaut) bis max − 1 Zeichen, sonst hart
      let at = max - 1; for (let i = max - 1; i >= 3; i--) if (/[^aeiouäöüy\-]/i.test(r[i]) && /[aeiouäöü]/i.test(r[i + 1] || '')) { at = i; break; }
      if (/^(tr|pr|br|kr|gr|dr|fr|pl|bl|kl|gl|fl|ch)$/i.test(r.slice(at - 1, at + 1)) && at > 4) at--; // Anlaut zusammenlassen (Trä-ger → Trä-, Tr…)
      if (r[at - 1] === '-') { teile.push(r.slice(0, at)); r = r.slice(at); continue; }
      teile.push(r.slice(0, at) + '-'); r = r.slice(at);
    }
    teile.push(r); return teile.join('\n');
  }).join(' ');
}

/** Prüfen, ob alle nötigen Schild-Arten als Grundlage vorhanden sind – liefert fehlende Klassen */
export function kartenFehlen(lib) {
  const B = schildBausteine(lib);
  if (!B) return Object.values(K);
  return Object.values(K).filter((c) => !B.basis[c] || !B.pfade[c]);
}

export function bauePlantafelKarten({ lib, kat, titel, plan, symbole = {} }) {
  const B = schildBausteine(lib);
  if (!B) throw Object.assign(new Error('Der Stil „Optimiert“ braucht Blaupausen im aktuellen Spielformat (1.2).'), { status: 422 });
  const fehlt = Object.values(K).filter((c) => !B.basis[c] || !B.pfade[c]);
  if (fehlt.length) throw Object.assign(new Error(`Für den Stil „Optimiert“ fehlen Schild-Vorlagen: ${fehlt.map((c) => kat.gebaeude[c]?.name || c).join(', ')} – bitte im Spiel je ein solches Schild in einer Blaupause speichern (oder Stil „Einfach“ wählen).`), { status: 422 });
  if (!plan?.stufen?.length) throw Object.assign(new Error('Der Plan hat keine Fertigungsschritte.'), { status: 400 });
  const nm = (it) => kat.items[it]?.name || it, bildItem = (it) => symbole[it] ?? -1, bildGeb = (g) => symbole[String(g || '').replace(/^Build_/, 'Desc_')] ?? -1;
  const objs = []; let inst = 2147480000 - Math.floor(Math.random() * 4e7);
  const rot = [0, 0, 1, 0];
  /** Schild setzen: Mitte (x, z) in Weltkoordinaten */
  const setze = (art, x, z, opt, farbe) => {
    const cls = K[art], [vorne, hinten] = FARBE[farbe] || FARBE.info;
    const d = baueSchild(B, cls, { ...opt, vorne, hinten });
    const k = schildKopf(B, cls);
    objs.push({ head: makeHead({ typePath: k.typePath, instance: `Persistent_Level:PersistentLevel.${cls}_${inst--}`, flags: k.flags, hasFlags: lib.basis.hasFlags, rot, pos: [x, 0, z], placed: k.placed }), data: Buffer.concat([i32(d.length), d]) });
  };
  // Hilfen im Spaltenraster: (XL, ZO) = linke obere Ecke (von vorn), u nach rechts, v nach unten (cm)
  const at = (XL, ZO, u, v) => [XL - u, ZO - v];
  const kopf = (XL, ZO, u, v, label, name, bild, farbe = 'kopf', breit = 400) => { const [x, z] = at(XL, ZO, u + breit / 2, v + 25); setze('kopf', x, z, { layout: '4x1_4', texte: { Name: name, Label: label }, bilder: { Icon: bild, Other_Icon: -1 } }, farbe); };
  const feld = (XL, ZO, u, v, name, bild, farbe) => { const [x, z] = at(XL, ZO, u + 100, v + 25); setze('feld', x, z, { layout: '4x1_3', texte: { Name: name, Label: '' }, bilder: { Icon: bild, Other_Icon: -1 } }, farbe); };
  const ziffern = (XL, ZO, u, v, wert) => { const s = vierStellen(wert); for (let i = 0; i < 4; i++) { const [x, z] = at(XL, ZO, u + 25 + i * 50, v + 25); setze('ziffer', x, z, { layout: '1x1_3', texte: { Name: '', Other_Text: s[i] }, bilder: { Icon: -1, '{BG}Background': -1 } }, 'ziffer'); } };
  const portrait = (XL, ZO, u, v, name, bild, label) => { const [x, z] = at(XL, ZO, u + 100, v + 150); setze('bild', x, z, { layout: '2x3_1', texte: { Name: name, Label: label }, bilder: { Icon: bild, '{BG}Background': -1 } }, 'aus'); };

  // Höhe einer Karte / Liste
  const karteH = (s) => KOPF_H + 10 + Math.max(300 + 10 + 50, s.ein.length * ZEILE_EIN);
  const listeH = (n, fuss) => KOPF_H + 10 + n * ZEILE_LISTE + (fuss ? KARTE_LUECKE + KOPF_H : 0);
  // Nur, was tatsächlich gebraucht wird (Anzeige „0000“ weglassen)
  const roh = (plan.roh || []).filter((x) => x.menge >= 0.05);
  const spalten = [{ art: 'liste', kopf: 'ROHSTOFFE', zeilen: roh, farbe: 'roh' }];
  plan.stufen.forEach((st, i) => spalten.push({ art: 'stufe', kopf: `STUFE ${i + 1}`, schritte: st }));
  spalten.push({ art: 'liste', kopf: 'ERGEBNIS', zeilen: plan.ergebnis, farbe: 'aus', fuss: [`${plan.maschinen} Maschinen`, `Strom ca. ${Math.round(plan.strom)} MW`] });
  for (const sp of spalten) sp.h = KOPF_H + 20 + (sp.art === 'liste' ? listeH(sp.zeilen.length, sp.fuss) : sp.schritte.reduce((h, s) => h + karteH(s), 0) + (sp.schritte.length - 1) * KARTE_LUECKE);
  const reihen = []; for (let i = 0; i < spalten.length; i += JE_REIHE) reihen.push(spalten.slice(i, i + JE_REIHE));
  const proReihe = Math.min(JE_REIHE, spalten.length), BREITE = proReihe * KARTE_B + (proReihe - 1) * SPALTE_LUECKE;
  const HOEHE = reihen.reduce((h, r) => h + Math.max(...r.map((s) => s.h)), 0) + (reihen.length - 1) * REIHE_LUECKE;
  const H = HOEHE + KOPF_H + 60; // Oberkante inkl. Überschrift
  const XL0 = BREITE / 2;
  kopf(XL0, H, 0, 0, 'ABLAUFPLAN', String(titel || '').slice(0, 40), -1, 'titel');
  if (proReihe > 1) kopf(XL0, H, KARTE_B + SPALTE_LUECKE, 0, 'GESAMT', `${plan.maschinen} Maschinen · ca. ${Math.round(plan.strom)} MW`, -1, 'titel');
  let ZO = H - KOPF_H - 60, nr = 0;
  for (const r of reihen) {
    r.forEach((sp, k) => {
      const XL = XL0 - k * (KARTE_B + SPALTE_LUECKE);
      kopf(XL, ZO, 0, 0, sp.kopf, sp.art === 'liste' ? 'pro Minute' : '', -1, 'spalte');
      let v = KOPF_H + 20;
      if (sp.art === 'liste') {
        for (const x of sp.zeilen) { feld(XL, ZO, 0, v + 5, nm(x.item), bildItem(x.item), sp.farbe); ziffern(XL, ZO, 200, v + 5, x.menge); v += ZEILE_LISTE; }
        if (sp.fuss) { v += KARTE_LUECKE; kopf(XL, ZO, 0, v, sp.fuss[0], sp.fuss[1], -1, 'info'); }
        return;
      }
      for (const s of sp.schritte) {
        nr++;
        const geb = kat.gebaeude[s.geb]?.name || s.geb;
        kopf(XL, ZO, 0, v, `${s.anzahl}×${Math.abs(s.takt - 100) > 0.05 ? ' ' + Math.round(s.takt) + '%' : ''}`, `${s.name.replace(/^Alternativ: /, 'Alt: ')} · ${geb}`, bildGeb(s.geb));
        const v0 = v + KOPF_H + 10, haupt = s.aus[0];
        const neben = s.aus.slice(1).map((a) => `+ ${vierStellen(a.menge).replace(/^0+(?=\d)/, '')}\n${umbrechen(nm(a.item))}`).join('\n');
        portrait(XL, ZO, 0, v0, `${umbrechen(nm(haupt.item))}${neben ? '\n' + neben : ''}`, bildItem(haupt.item), String(nr));
        ziffern(XL, ZO, 0, v0 + 310, haupt.menge);
        s.ein.forEach((e, i) => { feld(XL, ZO, 200, v0 + i * ZEILE_EIN, nm(e.item), bildItem(e.item), 'ein'); ziffern(XL, ZO, 200, v0 + i * ZEILE_EIN + 50, e.menge); });
        v += karteH(s) + KARTE_LUECKE;
      }
    });
    ZO -= Math.max(...r.map((s) => s.h)) + REIHE_LUECKE;
  }
  const datei = createBlueprint(lib.basis, objs, { costs: [], recipes: [], dimensions: [Math.max(1, Math.ceil(BREITE / 800)), 1, Math.max(1, Math.ceil(H / 800))] });
  readBlueprint(datei); // Selbstprüfung
  return { datei, info: { schilder: objs.length, spalten: spalten.length, breite: Math.round(BREITE) / 100, hoehe: Math.round(H) / 100, schritte: nr, stil: 'optimiert' } };
}
