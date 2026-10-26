// Plan-Tafel im Stil einer Schild-Vorlage aus der eigenen Bibliothek („Alternate Prod Sign (3/6 inputs)“, Community-Blaupause):
// je Fertigungsschritt eine Karte aus den Schildern der Vorlage – Eingänge (Bild + Name, darunter 4 Ziffern-Schilder je Menge/min),
// Ausgang (großes Porträt-Schild), PROD / VERBRAUCH / ÜBRIG mit Ziffern. Die Vorlage wird nicht mitgeliefert; fehlt sie, bleibt
// die einfache Tafel (lib/plantafel.mjs).
//
// Gemessen 26.10.2026 an der Vorlage (Format 46, über lib/umrechnen.mjs ins Format 60): Schilder stehen in einer Ebene (y fest),
// Rollen erkennbar an den Texten: „INPUT“/„OUTPUT“/„PROD“/„OUT“/„AVAILABLE“ (Label, Layout 4x1_4), Eingangs-Plätze (Layout 4x1_3,
// Bild + Name), Porträt (Layout 2x3_1), Ziffern (Quadratisch 0,5 m, Layout 1x1_3, Text „Other_Text“) je 4 direkt unter einem Feld.
import fs from 'node:fs';
import path from 'node:path';
import { readBlueprint, createBlueprint } from './sbp.mjs';
import { makeHead, i32 } from './vorlagen.mjs';
import { zerlege, propListe, setzeSchildTexte } from './eigenschaften.mjs';
import { objektUmrechnen } from './umrechnen.mjs';
import { setzeBilder } from './plantafel.mjs';

const MUSTER = { 3: /^(7_3_)?Alternate[ _]Prod[ _]Sign[ _]\(?3[ _]Inputs\)?\.sbp$/i, 6: /^(7_3_)?Alternate[ _]Prod[ _]Sign[ _]\(?6[ _]Inputs\)?\.sbp$/i };

/** Vorlagen-Dateien in den Blaupausen-Ordnern suchen (erste Fundstelle je Variante) */
export function findeVorlagen(wurzeln) {
  const gefunden = {};
  const geh = (d, t) => {
    if (t > 6 || (gefunden[3] && gefunden[6])) return;
    let l = []; try { l = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of l) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!/^_(Duplikate|Archiv)/.test(e.name)) geh(p, t + 1); continue; }
      for (const n of [3, 6]) if (!gefunden[n] && MUSTER[n].test(e.name)) gefunden[n] = p;
    }
  };
  for (const w of wurzeln) geh(w, 0);
  return gefunden;
}

const textVon = (d, p) => { const n = d.readInt32LE(p.valStart); return n > 0 ? d.toString('latin1', p.valStart + 4, p.valStart + 3 + n) : n < 0 ? d.toString('utf16le', p.valStart + 4, p.valStart + 4 - n * 2 - 2) : ''; };
function texte(d) {
  const z = zerlege(d, true), p = z.props.find((x) => x.name === 'mPrefabTextElementSaveData'), out = {};
  if (!p) return out;
  const n = d.readInt32LE(p.valStart); let q = p.valStart + 4;
  for (let k = 0; k < n; k++) { const l = propListe(d, q), en = l.props.find((x) => x.name === 'ElementName'), tx = l.props.find((x) => x.name === 'Text'); if (en) out[textVon(d, en)] = tx ? textVon(d, tx) : ''; q = l.noneEnd; }
  return out;
}

/** Vorlage lesen und in Rollen zerlegen; Lage relativ zur Mitte des Porträts */
export function ladeVorlage(datei) {
  const bp = readBlueprint(fs.readFileSync(datei), { props: false });
  const teile = [];
  for (const o of bp.objects) {
    if (o.kind !== 'entity' || !/StandaloneWidgetSign/.test(o.cls)) continue;
    let d = Buffer.from(bp.body.subarray(o.dStart, o.dEnd));
    if (bp.header.saveVersion < 60) d = objektUmrechnen(d, true);
    d = d.subarray(4);
    teile.push({ cls: o.cls, typePath: o.typePath, rot: o.rot, pos: o.pos, flags: o.flags, placed: o.placedInLevel || 0, d, t: texte(d) });
  }
  const portrait = teile.find((x) => /Portrait/.test(x.cls)); if (!portrait) throw new Error('Vorlage ohne Porträt-Schild');
  const [px, py, pz] = portrait.pos;
  for (const x of teile) x.rel = [x.pos[0] - px, x.pos[1] - py, x.pos[2] - pz];
  const label = (l) => teile.find((x) => x.t.Label === l && !/Tiny/.test(x.cls));
  const ziffern = (feld) => teile.filter((x) => /Tiny/.test(x.cls) && Math.abs(x.pos[2] - (feld.pos[2] - 50)) < 5 && Math.abs(x.pos[0] - feld.pos[0]) <= 100).sort((a, b) => b.pos[0] - a.pos[0]); // von links (großes x) nach rechts
  const eingaenge = teile.filter((x) => /4x1_3/.test(String(x.t.__layout)) || (x.t.Name && x.t.Label === 'A' && !/Portrait|Tiny/.test(x.cls)))
    .sort((a, b) => b.pos[0] - a.pos[0] || b.pos[2] - a.pos[2]).map((f) => ({ feld: f, ziffern: ziffern(f) }));
  const zahl = (l) => { const f = label(l); return f ? { feld: f, ziffern: ziffern(f) } : null; };
  const xs = teile.map((x) => x.rel[0]), zs = teile.map((x) => x.rel[2]);
  return { teile, portrait, eingang: label('INPUT'), ausgang: label('OUTPUT'), eingaenge, prod: zahl('PROD'), out: zahl('OUT'), avail: zahl('AVAILABLE'),
    groesse: [Math.max(...xs) - Math.min(...xs) + 250, Math.max(...zs) - Math.min(...zs) + 200], minX: Math.min(...xs), maxZ: Math.max(...zs) };
}

/** 4 Zeichen für die Ziffern-Schilder: ab 100 ganze Zahl, darunter eine Nachkommastelle („07,5“) */
function vierStellen(v) {
  const n = Math.max(0, v);
  if (n >= 9999.5) return '9999';
  if (n >= 100 || Math.abs(n - Math.round(n)) < 0.05) return String(Math.round(n)).padStart(4, '0');
  return (Math.round(n * 10) / 10).toFixed(1).replace('.', ',').padStart(4, '0');
}

/**
 * Tafel bauen: plan (planAusSchritten), vorlagen { 3, 6 } (ladeVorlage), symbole (Desc → IconID). Liefert { datei, info }.
 * Spalten: Stufen, je Schritt eine Karte (3 oder 6 Eingänge); höchstens 3 Spalten nebeneinander, dann eine Reihe darunter.
 */
export function bauePlantafelVorlage({ lib, kat, titel, plan, vorlagen, symbole = {} }) {
  const nm = (it) => kat.items[it]?.name || it, bildItem = (it) => symbole[it] ?? -1, bildGeb = (g) => symbole[String(g || '').replace(/^Build_/, 'Desc_')] ?? -1;
  // Verbrauch je Item innerhalb des Plans
  const verbrauch = {}; for (const st of plan.stufen) for (const s of st) for (const e of s.ein) verbrauch[e.item] = (verbrauch[e.item] || 0) + e.menge;
  const objs = []; let inst = 2147480000 - Math.floor(Math.random() * 4e7);
  const setze = (teil, off, texteNeu, bilder) => {
    let d = Buffer.from(teil.d);
    if (texteNeu) d = setzeSchildTexte(d, texteNeu);
    if (bilder) d = setzeBilder(d, bilder);
    const pos = [off[0] + teil.rel[0], off[1] + teil.rel[1], off[2] + teil.rel[2]];
    objs.push({ head: makeHead({ typePath: teil.typePath, instance: `Persistent_Level:PersistentLevel.${teil.cls}_${inst--}`, flags: teil.flags, hasFlags: lib.basis.hasFlags, rot: teil.rot, pos, placed: teil.placed }), data: Buffer.concat([i32(d.length), d]) });
  };
  const ziffernSetzen = (z, off, wert) => { if (!z) return; const s = vierStellen(wert); z.ziffern.slice(0, 4).forEach((t, i) => setze(t, off, { Other_Text: s[i] || '' })); };
  /** Karte eines Schritts mit der Vorlage v an off (Mitte des Porträts) */
  const karte = (v, s, off) => {
    const haupt = s.aus[0];
    const neben = s.aus.slice(1).map((a) => `+ ${vierStellen(a.menge).replace(/^0+(?=\d)/, '')} ${nm(a.item)}`).join('\n');
    setze(v.portrait, off, { Name: `${nm(haupt.item)}${neben ? '\n' + neben : ''}` }, { Icon: bildItem(haupt.item) });
    if (v.eingang) setze(v.eingang, off, { Label: 'INPUT', Name: s.name.replace(/^Alternativ: /, 'Alt: ') });
    if (v.ausgang) setze(v.ausgang, off, { Label: 'OUTPUT', Name: `${s.anzahl}× ${kat.gebaeude[s.geb]?.name || s.geb}${Math.abs(s.takt - 100) > 0.05 ? ` · ${Math.round(s.takt * 10) / 10} %` : ''}` }, { Icon: bildGeb(s.geb) });
    s.ein.slice(0, v.eingaenge.length).forEach((e, i) => { const slot = v.eingaenge[i]; setze(slot.feld, off, { Name: nm(e.item), Label: '' }, { Icon: bildItem(e.item) }); ziffernSetzen(slot, off, e.menge); });
    const prod = haupt.menge, ver = Math.min(prod, verbrauch[haupt.item] || 0);
    for (const [z, l, w] of [[v.prod, 'PROD', prod], [v.out, 'VERBRAUCH', ver], [v.avail, 'ÜBRIG', prod - ver]]) if (z) { setze(z.feld, off, { Label: l, Name: '' }); ziffernSetzen(z, off, w); }
  };
  // Maße: Schild-Rechtecke (Katalog) in der Wandebene; Lage = Mitte, x nach links größer (von vorn gelesen), z nach oben
  const halb = (t) => { const bx = kat.gebaeude[t.cls]?.box || [-100, 0, -50, 100, 0, 50]; return [(bx[3] - bx[0]) / 2, (bx[5] - bx[2]) / 2]; };
  const rahmen = (teile) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const t of teile) { const [hw, hh] = halb(t); x0 = Math.min(x0, t.rel[0] - hw); x1 = Math.max(x1, t.rel[0] + hw); z0 = Math.min(z0, t.rel[2] - hh); z1 = Math.max(z1, t.rel[2] + hh); } return { x0, x1, z0, z1, b: x1 - x0, h: z1 - z0 }; };
  // Lage so wählen, dass die linke obere Ecke (von vorn gesehen) eines Rahmens bei (XL, ZO) liegt
  const ecke = (r, XL, ZO) => [XL - r.x1, 0, ZO - r.z1];
  const LUECKE_KARTE = 40, LUECKE_KOPF = 20, LUECKE_SPALTE = 60, LUECKE_REIHE = 100;
  const v3 = vorlagen[3] || vorlagen[6], v6 = vorlagen[6] || vorlagen[3];
  const karteR = new Map([[v3, rahmen(v3.teile)], [v6, rahmen(v6.teile)]]);
  const kopfSchild = v3.ausgang || v3.eingang, kopfR = rahmen([kopfSchild]);
  const slot = v3.eingaenge[0], zeileR = rahmen([slot.feld, ...slot.ziffern]), ZEILE_H = zeileR.h + 10;
  const fussSchild = v3.ausgang, fussR = fussSchild ? rahmen([fussSchild]) : null;
  const vorlageFuer = (x) => (x.ein.length > (v3.eingaenge.length || 3) ? v6 : v3);
  // Spalten mit Breite/Höhe
  const spalten = [{ art: 'liste', kopf: 'ROHSTOFFE /min', zeilen: plan.roh }];
  plan.stufen.forEach((st, i) => spalten.push({ art: 'stufe', kopf: `STUFE ${i + 1}`, schritte: st }));
  spalten.push({ art: 'liste', kopf: 'ERGEBNIS /min', zeilen: plan.ergebnis, fuss: ['GESAMT', `${plan.maschinen} Maschinen · ${Math.round(plan.strom)} MW`] });
  for (const sp of spalten) {
    if (sp.art === 'liste') { sp.b = Math.max(kopfR.b, zeileR.b, sp.fuss ? fussR.b : 0); sp.h = kopfR.h + LUECKE_KOPF + sp.zeilen.length * ZEILE_H + (sp.fuss ? LUECKE_KARTE + fussR.h : 0); }
    else { const R = sp.schritte.map((x) => karteR.get(vorlageFuer(x))); sp.b = Math.max(kopfR.b, ...R.map((r) => r.b)); sp.h = kopfR.h + LUECKE_KOPF + R.reduce((h, r) => h + r.h, 0) + (R.length - 1) * LUECKE_KARTE; }
  }
  // Spalten je Reihe: Querformat bevorzugt (Breite bis 1,5 × Höhe zählt wie quadratisch), Breite höchstens 46 m
  const teile = (jr) => { const r = []; for (let i = 0; i < spalten.length; i += jr) r.push(spalten.slice(i, i + jr)); return r; };
  const masse = (jr) => { const r = teile(jr); return [Math.max(...r.map((x) => x.reduce((w, y) => w + y.b, 0) + (x.length - 1) * LUECKE_SPALTE)), r.reduce((h, x) => h + Math.max(...x.map((y) => y.h)), 0) + (r.length - 1) * LUECKE_REIHE]; };
  const wert = ([bb, hh]) => Math.max(bb / 1.5, hh);
  let JE_REIHE = 1; for (let jr = 1; jr <= spalten.length; jr++) { const m = masse(jr); if (m[0] > 4600) break; if (wert(m) <= wert(masse(JE_REIHE))) JE_REIHE = jr; }
  const reihen = teile(JE_REIHE), [BREITE, HOEHE] = masse(JE_REIHE);
  const titelR = kopfR, H = HOEHE + titelR.h + LUECKE_REIHE / 2; // Gesamthöhe ab Boden (z = 0) bis Oberkante Überschrift
  const XL0 = BREITE / 2; // linker Rand (von vorn gesehen), Tafel um x = 0 zentriert
  setze(kopfSchild, ecke(kopfR, XL0, H), { Label: 'ABLAUFPLAN', Name: String(titel || '').slice(0, 40) });
  let ZO = H - titelR.h - LUECKE_REIHE / 2;
  for (const r of reihen) {
    let XL = XL0;
    for (const sp of r) {
      setze(kopfSchild, ecke(kopfR, XL, ZO), { Label: sp.kopf, Name: '' });
      let z = ZO - kopfR.h - LUECKE_KOPF;
      if (sp.art === 'liste') {
        for (const x of sp.zeilen) { const o = ecke(zeileR, XL, z); setze(slot.feld, o, { Name: nm(x.item), Label: '' }, { Icon: bildItem(x.item) }); ziffernSetzen(slot, o, x.menge); z -= ZEILE_H; }
        if (sp.fuss && fussSchild) setze(fussSchild, ecke(fussR, XL, z - LUECKE_KARTE + 10), { Label: sp.fuss[0], Name: sp.fuss[1] });
      } else for (const x of sp.schritte) { const v = vorlageFuer(x), kr = karteR.get(v); karte(v, x, ecke(kr, XL, z)); z -= kr.h + LUECKE_KARTE; }
      XL -= sp.b + LUECKE_SPALTE;
    }
    ZO -= Math.max(...r.map((y) => y.h)) + LUECKE_REIHE;
  }
  const xs = objs.length;
  const datei = createBlueprint(lib.basis, objs, { costs: [], recipes: [], dimensions: [Math.max(1, Math.ceil(BREITE / 800)), 1, Math.max(1, Math.ceil(H / 800))] });
  readBlueprint(datei); // Selbstprüfung
  return { datei, info: { schilder: xs, spalten: spalten.length, breite: Math.round(BREITE) / 100, hoehe: Math.round(H) / 100, schritte: plan.stufen.flat().length, stil: 'vorlage' } };
}
