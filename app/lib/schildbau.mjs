// Schilder frei zusammenbauen (Spielformat 60 / Satisfactory 1.2): Klasse, Layout, Texte, Bilder und Farben setzen –
// ohne fremde Vorlage. Grundlage ist irgendein Schild derselben Klasse aus den eigenen Blaupausen (Vorlagen-Bibliothek):
// Kopf, Kundendaten (Farbmuster, Rezept) bleiben, Layout und Element-Listen werden neu geschrieben.
//
// Aufbau der Eigenschaften (gemessen an Spiel-Blaupausen, Okt. 2026):
//   mSoftActivePrefabLayout  SoftObjectProperty  fstr(Paket) fstr(Klasse) fstr('')   z. B. …/SignLayouts/BPW_Sign4x1_3 + BPW_Sign4x1_3_C
//   mPrefabTextElementSaveData  Array<Struct>  je Element: ElementName (Str), Text (Str), None
//   mPrefabIconElementSaveData  Array<Struct>  je Element: ElementName (Str), IconID (Int), None
//   mGlobalPrefabIconElementSaveData (ab 1.1)  je Element: ElementName (Str), IconID (Struct PersistentGlobalIconId: Bibliothek + Nummer)
//   mForegroundColor / mBackgroundColor / mAuxilaryColor  LinearColor (4 float)
import { zerlege, propListe, fstr } from './eigenschaften.mjs';
import { setzeBilder } from './plantafel.mjs';

const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const NONE = fstr('None');
const strProp = (name, wert) => { const v = fstr(wert); return Buffer.concat([fstr(name), fstr('StrProperty'), i32(0), i32(v.length), Buffer.from([0]), v]); };
const intProp = (name, wert) => Buffer.concat([fstr(name), fstr('IntProperty'), i32(0), i32(4), Buffer.from([0]), i32(wert)]);
const LAYOUT_PFAD = '/Game/FactoryGame/Interface/UI/InGame/Signs/SignLayouts/';
const WEG = new Set(['mSignPoles', 'mLastEditedBy', 'BuiltBy']);

/** Bausteine aus der Vorlagen-Bibliothek (nur Format 60): Grund-Schilder je Klasse, Eigenschafts-Köpfe, Muster eines globalen Bild-Elements */
export function schildBausteine(lib) {
  const V = String(lib.basis?.saveVersion), vorl = lib.vorlagen?.[V] || {};
  if (+V < 60) return null;
  const basis = {}, koepfe = {}; let globalMuster = null;
  for (const [cls, t] of Object.entries(vorl)) {
    if (!/StandaloneWidgetSign/.test(cls) || !t?.data) continue;
    const d = Buffer.from(t.data, 'base64');
    let z; try { z = zerlege(d, true); } catch { continue; }
    basis[cls] = { d, z, flags: t.flags, placed: t.placed || 0 };
    for (const p of z.props) {
      if (!koepfe[p.name]) koepfe[p.name] = { kopf: d.subarray(p.start, p.sizePos), flags: d.subarray(p.sizePos + 4, p.valStart) };
      if (p.name === 'mGlobalPrefabIconElementSaveData' && !globalMuster && d.readInt32LE(p.valStart) > 0) {
        const l = propListe(d, p.valStart + 4), id = l.props.find((x) => x.name === 'IconID');
        if (id) globalMuster = { b: Buffer.from(d.subarray(id.start, l.noneEnd)), nr: id.end - 13 - id.start }; // IconID-Struktur + None; Nummer wie in setzeBilder
      }
    }
  }
  return { V, basis, koepfe, globalMuster, pfade: lib.pfade || {} };
}

function arrayProp(B, name, elemente) {
  const k = B.koepfe[name]; if (!k) return null;
  const wert = Buffer.concat([i32(elemente.length), ...elemente]);
  return Buffer.concat([k.kopf, i32(wert.length), k.flags, wert]);
}

/**
 * Daten eines Schilds (ohne Längen-Vorsatz). opt = { layout: '4x1_3', texte: { Name: '…', Label: '…' }, bilder: { Icon: nr, … },
 * vorne: [r,g,b,a], hinten: [r,g,b,a], extra: [r,g,b,a] }
 */
export function baueSchild(B, cls, opt) {
  const g = B.basis[cls];
  if (!g) throw Object.assign(new Error(`Für „${cls.replace(/^Build_StandaloneWidgetSign_|_C$/g, '')}“-Schilder gibt es keine Vorlage – bitte im Spiel eine Blaupause mit so einem Schild speichern.`), { status: 422 });
  const { d, z } = g, teile = [];
  const layout = `BPW_Sign${opt.layout}`, texte = Object.entries(opt.texte || {}), bilder = Object.entries(opt.bilder || {});
  const lay = () => { const k = B.koepfe.mSoftActivePrefabLayout; const w = Buffer.concat([fstr(LAYOUT_PFAD + layout), fstr(layout + '_C'), i32(0)]); return Buffer.concat([k.kopf, i32(w.length), k.flags, w]); };
  const textArr = () => arrayProp(B, 'mPrefabTextElementSaveData', texte.map(([n, t]) => Buffer.concat([strProp('ElementName', n), strProp('Text', String(t ?? '')), NONE])));
  const bildArr = () => arrayProp(B, 'mPrefabIconElementSaveData', bilder.map(([n, nr]) => Buffer.concat([strProp('ElementName', n), intProp('IconID', nr ?? -1), NONE])));
  const globalArr = () => {
    if (!B.globalMuster) return null;
    return arrayProp(B, 'mGlobalPrefabIconElementSaveData', bilder.map(([n, nr]) => { const m = Buffer.from(B.globalMuster.b); m.writeInt32LE(nr ?? -1, B.globalMuster.nr); return Buffer.concat([strProp('ElementName', n), m]); }));
  };
  const farbe = (name, f) => { const k = B.koepfe[name]; if (!k || !f) return null; const w = Buffer.alloc(16); f.forEach((v, i) => w.writeFloatLE(v, i * 4)); return Buffer.concat([k.kopf, i32(16), k.flags, w]); };
  const gesetzt = new Set();
  const neu = {
    mSoftActivePrefabLayout: lay, mPrefabTextElementSaveData: textArr, mPrefabIconElementSaveData: bildArr, mGlobalPrefabIconElementSaveData: globalArr,
    mForegroundColor: () => farbe('mForegroundColor', opt.vorne), mBackgroundColor: () => farbe('mBackgroundColor', opt.hinten), mAuxilaryColor: () => farbe('mAuxilaryColor', opt.extra || opt.hinten),
  };
  const reihe = ['mSoftActivePrefabLayout', 'mPrefabTextElementSaveData', 'mPrefabIconElementSaveData', 'mGlobalPrefabIconElementSaveData', 'mForegroundColor', 'mBackgroundColor', 'mAuxilaryColor'];
  // erst die neu geschriebenen in fester Reihenfolge (wie im Spiel), dann die übrigen Eigenschaften der Vorlage
  for (const n of reihe) { const b = neu[n](); if (b) teile.push(b); gesetzt.add(n); }
  for (const p of z.props) if (!gesetzt.has(p.name) && !WEG.has(p.name)) teile.push(d.subarray(p.start, p.end));
  return Buffer.concat([d.subarray(0, z.propsStart), ...teile, d.subarray(z.noneStart)]);
}

/** Kopf-Angaben (Pfad, Flags) für ein Schild der Klasse */
export function schildKopf(B, cls) {
  const g = B.basis[cls];
  return { typePath: B.pfade[cls], flags: g?.flags ?? 8, placed: g?.placed ?? 0 };
}
export { setzeBilder };
