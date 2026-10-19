// Vorlagen-Bibliothek: Bauteil-Vorlagen (Objektdaten genau so, wie das Spiel sie schreibt) aus den eigenen
// Blaupausen, dazu die vollen Spielpfade aller Bauteile (aus Blaupausen und den neuesten Spielstaenden).
// Damit koennen neue Objekte erzeugt und Bauteile getauscht werden (z. B. Beton- gegen Glasfundament).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { readBlueprint } from './sbp.mjs';
import { wert } from './eigenschaften.mjs';

/** Enthält ein Lager (mInventoryStacks) Gegenstände? */
function lagerBelegt(d) {
  try { const w = wert(d, false, 'mInventoryStacks'); return !!w && w.includes('/Game/'); } catch { return d.includes('/Game/FactoryGame/Resource/'); }
}

const VERSION = 5;
// Bauteile mit Innenleben (Anschlüsse, Lager), die als ganze Baugruppe (Entität + Komponenten) gespeichert werden – für den Fabrikplaner
const BAUGRUPPE = /^Build_(SmelterMk1|ConstructorMk1|AssemblerMk1|FoundryMk1|ManufacturerMk1|OilRefinery|Blender|Packager|HadronCollider|QuantumEncoder|Converter|ConveyorBeltMk\d|ConveyorLiftMk\d|ConveyorAttachmentSplitter|ConveyorAttachmentMerger|PowerPoleMk\d|PowerLine|Pipeline(MK2)?(_NoIndicator)?|PipelineJunction_Cross|PipelinePump(Mk2)?|ResourceSink)_C$/;

// ------------------------------------------------------------------ Bytes
export const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
export function fstr(s) {
  if (!s) return i32(0);
  if (/^[\x00-\x7f]*$/.test(s)) return Buffer.concat([i32(s.length + 1), Buffer.from(s + '\0', 'latin1')]);
  return Buffer.concat([i32(-(s.length + 1)), Buffer.from(s + '\0', 'utf16le')]);
}
const f32s = (arr) => { const b = Buffer.alloc(arr.length * 4); arr.forEach((v, k) => b.writeFloatLE(v, k * 4)); return b; };

/** ObjectProperty-Wert (Verweis) in Objektdaten ersetzen; beide Eigenschaftsformate (bis 1.1 / ab 1.2). */
export function replaceObjectProp(content, propName, newPath) {
  const key = Buffer.concat([fstr(propName), fstr('ObjectProperty')]);
  const at = content.indexOf(key);
  if (at < 0) return null;
  const p = at + key.length;
  const first = content.readInt32LE(p);
  const newFmt = first === 0; // ab 1.2: innere Typanzahl (0), dann Groesse
  const sizePos = newFmt ? p + 4 : p;
  const valStart = p + 9; // beide Formate: Wert beginnt 9 Byte nach dem Typnamen
  const oldSize = content.readInt32LE(sizePos);
  const value = Buffer.concat([fstr(''), fstr(newPath)]);
  const out = Buffer.concat([content.subarray(0, valStart), value, content.subarray(valStart + oldSize)]);
  out.writeInt32LE(value.length, sizePos);
  return out;
}

export function makeHead({ typePath, instance, flags, hasFlags, rot, pos, scale = [1, 1, 1], placed = 0 }) {
  const parts = [i32(1), fstr(typePath), fstr('Persistent_Level'), fstr(instance)];
  if (hasFlags) parts.push(i32(flags ?? 8));
  parts.push(i32(1), f32s([...rot, ...pos, ...scale]), i32(placed));
  return Buffer.concat(parts);
}

// ------------------------------------------------------------------ Bibliothek aufbauen
async function newestSaves(saveDir, max = 3) {
  const out = [];
  try {
    for (const e of await fsp.readdir(saveDir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === 'blueprints') continue;
      const d = path.join(saveDir, e.name);
      for (const f of await fsp.readdir(d)) if (f.endsWith('.sav')) { const st = await fsp.stat(path.join(d, f)); out.push({ p: path.join(d, f), t: st.mtimeMs, s: st.size }); }
    }
  } catch { /* keine Spielstaende */ }
  out.sort((a, b) => b.t - a.t);
  // neueste + groesste (deckt am meisten ab)
  const pick = out.slice(0, max - 1);
  const big = [...out].sort((a, b) => b.s - a.s)[0];
  if (big && !pick.includes(big)) pick.push(big);
  return pick;
}

function scanSaveForPaths(file, into) {
  const buf = fs.readFileSync(file);
  const tag = Buffer.from([0xc1, 0x83, 0x2a, 0x9e]);
  let p = buf.indexOf(tag);
  while (p >= 0 && !(buf.readUInt32LE(p + 4) === 0x22222222 && Number(buf.readBigInt64LE(p + 8)) === 131072)) p = buf.indexOf(tag, p + 1);
  const rx = /\/Game\/[A-Za-z0-9_\/\-]+\/(Build_[A-Za-z0-9_]+)\.\1_C/g;
  let tail = '';
  while (p >= 0 && p + 49 <= buf.length && buf.readUInt32LE(p) === 0x9e2a83c1) {
    const comp = Number(buf.readBigInt64LE(p + 17));
    const s = tail + zlib.inflateSync(buf.subarray(p + 49, p + 49 + comp)).toString('latin1');
    for (const m of s.matchAll(rx)) into[m[1] + '_C'] ||= m[0];
    tail = s.slice(-400);
    p += 49 + comp;
  }
}

export async function buildLibrary({ bpRoot, saveDir, cacheFile, log = () => {} }) {
  // Schluessel: Dateiliste + Zeitstempel. Quellen: zuerst die Spielstand-Ordner (blueprints\<Sitzung>), danach die
  // Ablage samt Unterordnern (dort liegen nach dem Aufräumen die meisten Blaupausen) – ohne _Duplikate/_Archiv/_Pakete.
  const bpFiles = [];
  const SKIP = /^_(duplikate|archiv|pakete)$/i;
  const sammeln = async (dir, tiefe) => {
    let l = []; try { l = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of l) if (e.isFile() && e.name.endsWith('.sbp')) { const p = path.join(dir, e.name); const st = await fsp.stat(p); bpFiles.push({ p, t: st.mtimeMs }); }
    if (tiefe > 0) for (const e of l) if (e.isDirectory() && !SKIP.test(e.name)) await sammeln(path.join(dir, e.name), tiefe - 1);
  };
  try {
    const ordner = (await fsp.readdir(bpRoot, { withFileTypes: true })).filter((s) => s.isDirectory());
    for (const s of ordner) if (!s.name.startsWith('_')) await sammeln(path.join(bpRoot, s.name), 0);
    for (const s of ordner) if (s.name.startsWith('_') && !SKIP.test(s.name)) await sammeln(path.join(bpRoot, s.name), 6);
  } catch { /* kein Ordner */ }
  const saves = await newestSaves(saveDir);
  // Schlüssel aus Dateiname + Änderungszeit (nicht Pfad): Verschieben zwischen Ablage und Spielstand ändert den Inhalt nicht
  // und soll keinen Neuaufbau (bei vielen Blaupausen ~20 s) auslösen
  const key = JSON.stringify({ v: VERSION, b: bpFiles.map((x) => path.basename(x.p) + x.t).sort(), s: saves.map((x) => x.p + x.t) });
  try { const c = JSON.parse(await fsp.readFile(cacheFile, 'utf8')); if (c.key === key) return c; } catch { /* neu */ }

  const t0 = Date.now();
  const lib = { key, version: VERSION, erzeugt: new Date().toISOString(), pfade: {}, vorlagen: {}, basis: null };
  let best = null;
  for (const { p } of bpFiles) {
    let bp;
    try { bp = readBlueprint(await fsp.readFile(p), { props: false }); } catch { continue; }
    const v = String(bp.header.saveVersion);
    const parents = new Set(bp.objects.filter((o) => o.kind === 'component').map((o) => o.parent));
    const lv = (lib.vorlagen[v] ||= {});
    const bg = ((lib.baugruppen ||= {})[v] ||= {});
    const kompVon = new Map();
    for (const o of bp.objects) if (o.kind === 'component') { if (!kompVon.has(o.parent)) kompVon.set(o.parent, []); kompVon.get(o.parent).push(o); }
    for (const o of bp.objects) {
      if (o.kind !== 'entity') continue;
      lib.pfade[o.cls] ||= o.typePath;
      if (parents.has(o.instance) && BAUGRUPPE.test(o.cls) && (!bg[o.cls] || bg[o.cls].inhalt)) {
        // „Inhalt“: Lager mit Gegenständen (z. B. aus Karte → Blaupause) – nur nehmen, wenn nichts Leeres da ist
        const inhalt = kompVon.get(o.instance).some((c) => /Inventory/.test(c.typePath) && lagerBelegt(bp.body.subarray(c.dBody, c.dEnd)));
        if (bg[o.cls] && inhalt) continue;
        bg[o.cls] = { inhalt, typePath: o.typePath, instance: o.instance, flags: o.flags, placed: o.placedInLevel, quelle: path.basename(p),
          data: bp.body.subarray(o.dBody, o.dEnd).toString('base64'),
          komp: kompVon.get(o.instance).map((c) => ({ typePath: c.typePath, root: c.root, name: c.instance.slice(o.instance.length + 1), flags: c.flags, data: bp.body.subarray(c.dBody, c.dEnd).toString('base64') })) };
      }
      if (parents.has(o.instance) || lv[o.cls]) continue;
      lv[o.cls] = { flags: o.flags, placed: o.placedInLevel, data: bp.body.subarray(o.dBody, o.dEnd).toString('base64') };
    }
    // Basis fuer neue Blaupausen: je Spielversion eine (fuer „Karte -> Blaupause“), insgesamt die neueste
    if (!best || bp.header.saveVersion > best.saveVersion || !lib.basen?.[v]) {
      let cfg = null; try { cfg = (await fsp.readFile(p + 'cfg')).toString('base64'); } catch { /* ohne */ }
      const b = { saveVersion: bp.header.saveVersion, headerVersion: bp.header.headerVersion, buildVersion: bp.header.buildVersion,
        hasFlags: bp.hasFlags, headerTail: bp.headerTail.toString('base64'), bodyTail: bp.body.subarray(bp.layout.end).toString('base64'),
        maxChunk: bp.maxChunk, algo: bp.algo, chunkVersion: bp.chunkVersion, cfg, quelle: path.basename(p) };
      (lib.basen ||= {})[v] ||= b;
      if (!best || bp.header.saveVersion > best.saveVersion) best = b;
    }
  }
  lib.basis = best;
  for (const s of saves) { try { scanSaveForPaths(s.p, lib.pfade); } catch (e) { log('Spielstand nicht lesbar:', path.basename(s.p), e.message); } }
  log(`Vorlagen: ${Object.keys(lib.pfade).length} Bauteilpfade, ${Object.entries(lib.vorlagen).map(([v, m]) => `v${v}: ${Object.keys(m).length}`).join(', ')} (${Date.now() - t0} ms)`);
  await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
  await fsp.writeFile(cacheFile, JSON.stringify(lib));
  return lib;
}

// ------------------------------------------------------------------ Objekte erzeugen
const fam = (g) => (g ? `${g.kategorie}|${g.unterkategorie}` : '');
// Nur einfache Architektur-Teile (ohne Innenleben wie Anschluesse/Lager) duerfen aus verwandten Teilen abgeleitet werden
const ABLEITBAR = new Set(['Fundamente', 'Rampen', 'Umgekehrte Rampen', 'Viertelrohre', 'Dächer', 'Rahmen', 'Säulen', 'Träger', 'Laufstege', 'Gehwege', 'Wände', 'Fenster', 'Fensterrahmen', 'Diagonale Wände', 'Obere Diagonalwände', 'Schräge Wände']);
const ableitbar = (g) => ABLEITBAR.has(g.unterkategorie) && /Organisation|Wände/.test(g.kategorie);

/** Vorlage fuer Klasse cls in Spielversion ver: direkt oder von einem verwandten Bauteil abgeleitet. */
export function templateFor(lib, kat, ver, cls) {
  const lv = lib.vorlagen[String(ver)] || {};
  const typePath = lib.pfade[cls];
  if (lv[cls] && typePath) return { ...lv[cls], typePath, art: 'vorlage' };
  const g = kat.gebaeude[cls];
  const rp = g && g.rezept && kat.pfade?.rezepte?.[g.rezept];
  if (!g || !rp || !typePath || !ableitbar(g)) return null;
  // Spender: gleiche Familie (Kategorie + Unterkategorie), sonst irgendein leichtes Architektur-Bauteil
  const cands = Object.keys(lv).filter((c) => kat.gebaeude[c]);
  const sameFam = cands.filter((c) => fam(kat.gebaeude[c]) === fam(g));
  const arch = cands.filter((c) => ableitbar(kat.gebaeude[c]));
  for (const donor of [...sameFam, ...arch]) {
    const content = Buffer.from(lv[donor].data, 'base64');
    const out = replaceObjectProp(content, 'mBuiltWithRecipe', rp);
    if (out) return { flags: lv[donor].flags, placed: lv[donor].placed, data: out.toString('base64'), typePath, art: 'abgeleitet', spender: donor };
  }
  return null;
}

export function availability(lib, kat, ver) {
  const out = {};
  for (const cls of Object.keys(kat.gebaeude)) {
    const t = templateFor(lib, kat, ver, cls);
    if (t) out[cls] = t.art;
  }
  return out;
}

let uid = Math.floor(2147000000 - Math.random() * 1e8);
/** .sbpcfg mit neuer Beschreibung aus einer vorhandenen cfg ableiten */
export function makeCfg(baseB64, beschreibung) {
  if (!baseB64) return null;
  const b = Buffer.from(baseB64, 'base64');
  const n = b.readInt32LE(4);
  const len = n === 0 ? 0 : n > 0 ? n : -n * 2;
  return Buffer.concat([b.subarray(0, 4), fstr(beschreibung || ''), b.subarray(8 + len)]);
}

export function newInstance(cls, taken) {
  let n;
  do { n = `Persistent_Level:PersistentLevel.${cls}_${uid--}`; } while (taken && taken.has(n));
  taken?.add(n);
  return n;
}

/** Baut Kopf + Daten fuer ein neues Objekt. */
export function buildObject(lib, kat, ver, hasFlags, { cls, pos, rot }, taken) {
  const t = templateFor(lib, kat, ver, cls);
  if (!t) throw Object.assign(new Error(`Für „${kat.gebaeude[cls]?.name || cls}“ gibt es (noch) keine Vorlage in dieser Spielversion.`), { status: 422 });
  const content = Buffer.from(t.data, 'base64');
  const head = makeHead({ typePath: t.typePath, instance: newInstance(cls, taken), flags: t.flags, hasFlags, rot, pos, placed: t.placed });
  return { head, data: Buffer.concat([i32(content.length), content]) };
}

// ------------------------------------------------------------------ Kosten
/** Baukosten je Klasse (Katalog) als Map itemKlasse -> Menge, fuer eine Liste von Klassen (+1 / -1). */
export function costDelta(kat, changes) {
  const d = {};
  for (const [cls, sign] of changes) {
    const g = kat.gebaeude[cls];
    if (!g) continue;
    for (const [item, n] of g.kosten) d[item] = (d[item] || 0) + sign * n;
  }
  return d;
}
