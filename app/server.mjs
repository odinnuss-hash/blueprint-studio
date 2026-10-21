// Blueprint Studio – lokaler Server
// Start:  node app/server.mjs [--open]
// Liest Satisfactory-Blaupausen aus dem Spielstand-Ordner, liefert die Oberflaeche aus und speichert Aenderungen.
// Laeuft nur auf diesem PC (127.0.0.1). Keine Internetverbindung noetig.

import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readBlueprint, writeBlueprint, readCfg, createBlueprint } from './lib/sbp.mjs';
import { baueReihe, baueKette } from './lib/fabrik.mjs';
import { bauePixelbild } from './lib/pixelbild.mjs';
import { ladeMuster, kopiere, qmul, qrot, qz } from './lib/muster.mjs';
import { objekteEinfuegen } from './lib/spielstand-einfuegen.mjs';
import { spielstandAendern } from './lib/spielstand-aendern.mjs';
import { musterUmrechnen, UMRECHNEN_AB } from './lib/umrechnen.mjs';
import { ladeHoehen, kachel as weltKachel, weltDaten, blaupauseDaten, KACHEL } from './lib/welt.mjs';
import { masterclassEinlesen, masterclassDatei, masterclassExport, masterclassImport, masterclassAblegen } from './lib/masterclass.mjs';
import { rechne as planRechnen, vorstufen } from './public/js/planer-rechner.js';
import { buildLibrary, availability, buildObject, costDelta, makeHead, newInstance, templateFor, makeCfg, i32, replaceObjectProp } from './lib/vorlagen.mjs';
import { loadKatalog } from './lib/katalog.mjs';
import { readSavHeader } from './lib/sav.mjs';
import { kartenDaten, packen } from './lib/karte.mjs';
import { megaprintKarte } from './lib/megaprint.mjs';
import { bereichAlsBlaupause } from './lib/extrahieren.mjs';
import { scannen, planen, anwenden, rueckgaengig, vorschau, GRUPPEN, GRUPPE_NAME, GRUPPEN_STANDARD, GRUPPEN_NEU, setGruppen, setPraefixe, setThemenUebersetzung, MAXLEN, pass, merkmale, lernen, vorschlagGelernt, ablageOrdner, strukturOrdner } from './lib/ordnen.mjs';
import { Ablage } from './lib/ablage.mjs';
import { kategorienSchreiben, SYMBOL_STANDARD } from './lib/spielkategorien.mjs';
import { Einrichtung, findeSpielOrdner, ordnerWaehlen } from './lib/einrichtung.mjs';
import { Updater } from './lib/update.mjs';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(APP_DIR);
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const DATA_DIR = process.env.BS_DATA_DIR || path.join(ROOT, 'userdata');
const SETTINGS_FILE = path.join(DATA_DIR, 'einstellungen.json');
const HOST = '127.0.0.1';
const PORT = parseInt(process.env.BS_PORT || '37474', 10);
const OPEN_WINDOW = process.argv.includes('--open') && !process.env.BS_NO_OPEN;
// --weiter: nach einem Neustart (Update) kein neues Fenster, aber beenden, wenn das Fenster geschlossen wird
const FENSTER_ENDE = OPEN_WINDOW || process.argv.includes('--weiter');
const VERSION = '1.4.2';

const log = (...a) => console.log(new Date().toLocaleTimeString('de-DE'), ...a);

// ------------------------------------------------------------------ Einstellungen
// Satisfactory wird beim ersten Start gesucht (Steam-Bibliotheken, Epic, übliche Ordner) – siehe findeSpielOrdner()
function defaultSaveDir() {
  const la = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(la, 'FactoryGame', 'Saved', 'SaveGames');
}
let settings = { saveDir: defaultSaveDir(), gameDir: '', sprache: 'de', bibliotheken: [], megaprints: [], namensPraefixe: [] };
try { Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))); } catch { /* Standardwerte */ }
if (!settings.gameDir || !fs.existsSync(settings.gameDir)) settings.gameDir = findeSpielOrdner()[0] || settings.gameDir || '';
if (!settings.megaprints) settings.megaprints = [];
const FMODEL_DIR = () => settings.fmodel || path.join(ROOT, 'werkzeuge', 'FModel');
const FMODEL_EXPORT = () => settings.fmodelExport || path.join(FMODEL_DIR(), 'Output', 'Exports');
/** Wörterbuch einer Sprache (für die vorgegebene Ablage-Struktur in dieser Sprache) */
function woerterbuch(l) { try { return l && l !== 'de' ? JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'i18n', `${l}.json`), 'utf8')) : null; } catch { return null; } }
const ordnerSicher = (s) => String(s).replace(/[\\/:*?"<>|]/g, '-').trim();
function strukturSprache() {
  const w = woerterbuch(settings.strukturSprache);
  setThemenUebersetzung(w ? (n) => ordnerSicher(w[n] || n) : null);
  // eigene Struktur um später hinzugekommene Standard-Gruppen ergänzen (z. B. „10 Master Class“), Nummer frei vorausgesetzt
  if (Array.isArray(settings.struktur)) for (const hg of GRUPPEN_NEU) {
    if (settings.struktur.some(([c]) => c === hg || c.startsWith(hg + '_'))) continue;
    settings.struktur.push(...GRUPPEN_STANDARD.filter(([c]) => c === hg || c.startsWith(hg + '_')).map(([c, n]) => [c, w ? ordnerSicher(w[n] || n) : n]));
  }
  setGruppen(settings.struktur || (w ? GRUPPEN_STANDARD.map(([c, n]) => [c, ordnerSicher(w[n] || n)]) : null));
}
const standardStruktur = () => { const w = woerterbuch(settings.strukturSprache); return GRUPPEN_STANDARD.map(([c, n]) => [c, w ? ordnerSicher(w[n] || n) : n]); };
strukturSprache(); setPraefixe(settings.namensPraefixe);
async function saveSettings() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}
const bpRoot = () => path.join(settings.saveDir, 'blueprints');
function docsFile() {
  const dir = path.join(settings.gameDir, 'CommunityResources', 'Docs');
  const datei = { de: 'de.json', en: 'en-US.json', fr: 'fr.json', ja: 'ja.json' }[settings.sprache] || `${settings.sprache}.json`;
  for (const f of [datei, 'en-US.json', 'de.json']) { const p = path.join(dir, f); if (fs.existsSync(p)) return p; }
  return null;
}

// ------------------------------------------------------------------ Hilfen
const safeName = (s) => typeof s === 'string' && s.length > 0 && s.length < 200 && !/[\\/:*?"<>|]/.test(s) && !s.startsWith('.');
/** Ordner zu einer Auswahl: Spiel-Sitzung (Name des Spielstands) oder Bibliotheks-Ordner ("lib:<Nr>:<Unterordner>") */
const LIB_SKIP = /^_(archiv|pakete|duplikate)$/i;
function sessionDir(session) {
  const m = /^lib:(\d+):(.*)$/.exec(session || '');
  if (m) {
    const root = (settings.bibliotheken || [])[+m[1]];
    const teile = m[2] ? m[2].split('/') : [];
    if (!root || teile.some((t) => !safeName(t))) throw Object.assign(new Error('Ungültiger Bibliotheks-Ordner'), { status: 400 });
    return path.join(root, ...teile);
  }
  // Spiel-Ordner, auch Unterordner („Sortieren/Chaos/Kreativ“)
  const teile = String(session || '').split('/');
  if (!teile.length || teile.some((t) => !safeName(t)) || teile[0] === '_Ablage') throw Object.assign(new Error('Ungültiger Name'), { status: 400 });
  return path.join(bpRoot(), ...teile);
}
function bpPath(session, name, ext = '.sbp') {
  if (!safeName(name)) throw Object.assign(new Error('Ungültiger Name'), { status: 400 });
  return path.join(sessionDir(session), name + ext);
}
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
async function readJsonBody(req, limit = 50 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw new Error('Anfrage zu groß'); chunks.push(c); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// ------------------------------------------------------------------ Katalog (einmal laden)
let katalog = null, katalogFehler = null;
function getKatalog() {
  if (katalog) return katalog;
  const f = docsFile();
  if (!f) { katalogFehler = `Spieldaten nicht gefunden. Bitte in den Einstellungen den Satisfactory-Installationsordner angeben (enthält „CommunityResources“).`; return null; }
  try { katalog = loadKatalog(f, path.join(DATA_DIR, `katalog-cache-${path.basename(f, '.json')}.json`)); katalogFehler = null; log(`Katalog geladen: ${Object.keys(katalog.gebaeude).length} Gebäude`); }
  catch (e) { katalogFehler = 'Spieldaten konnten nicht gelesen werden: ' + e.message; }
  return katalog;
}

// ------------------------------------------------------------------ Vorlagen (fuer neue/getauschte Bauteile)
let lib = null, libPromise = null;
function getLib() {
  if (lib) return Promise.resolve(lib);
  if (!libPromise) {
    log('Baue Vorlagen-Bibliothek auf (einmalig, einige Sekunden) …');
    libPromise = buildLibrary({ bpRoot: bpRoot(), saveDir: settings.saveDir, cacheFile: path.join(DATA_DIR, 'vorlagen-cache.json'), log })
      .then((l) => { lib = l; return l; }).catch((e) => { log('Vorlagen-Fehler:', e.message); libPromise = null; throw e; });
  }
  return libPromise;
}
const availCache = new Map();
async function verfuegbar(ver) {
  const l = await getLib(), k = getKatalog();
  if (!k) throw new Error(katalogFehler || 'Katalog fehlt');
  const key = String(ver);
  if (!availCache.has(key)) availCache.set(key, availability(l, k, ver));
  return availCache.get(key);
}

// Mk-Stufen: Foerderbaender, Foerderlifte, Rohre
const MK_FAMILIE = /^Build_(ConveyorBeltMk\d|ConveyorLiftMk\d|Pipeline(MK2)?(_NoIndicator)?|PipelinePump(MK2)?)_C$/i;
function mkPfad(altPfad, altCls, neuCls) {
  const n = neuCls.replace(/^Build_|_C$/g, '');
  const ordner = /^Conveyor/.test(n) ? n : /^PipelineMK2/.test(n) ? 'PipelineMk2' : /^Pipeline_|^Pipeline$/.test(n) ? 'Pipeline' : /^PipelinePumpMK2$/i.test(n) ? 'PipePumpMk2' : n === 'PipelinePump' ? 'PipePump' : null;
  return ordner ? `/Game/FactoryGame/Buildable/Factory/${ordner}/Build_${n}.Build_${n}_C` : null;
}

// Baukosten/Rezepte nach Aenderungen neu berechnen (Kopf der Blaupause)
const SKIP_KOSTEN = /ConveyorBelt|ConveyorLift|Pipeline|PowerLine|Railroad|Hyper|Wire/;
function neuerKopf(k, header, changes) {
  const d = costDelta(k, changes.filter(([cls]) => !SKIP_KOSTEN.test(cls)));
  const costs = header.costs.map((c) => ({ path: c.path, item: c.item, amount: c.amount + (d[c.item] || 0) }));
  for (const [item, n] of Object.entries(d)) if (n > 0 && !header.costs.some((c) => c.item === item) && k.pfade.items[item]) costs.push({ path: k.pfade.items[item], item, amount: n });
  const recipes = [...header.recipePaths];
  for (const [cls, sign] of changes) {
    if (sign < 0) continue;
    const rp = k.pfade.rezepte[k.gebaeude[cls]?.rezept];
    if (rp && !recipes.includes(rp)) recipes.push(rp);
  }
  return { costs: costs.filter((c) => c.amount > 0), recipes };
}

// ------------------------------------------------------------------ API
async function listSessions() {
  // Spiel-Ordner mit allen Unterordnern (ohne _Ablage, _Archiv, _Pakete, _Duplikate) – jeder einzeln wählbar
  const out = [];
  const walk = async (rel, tiefe) => {
    let ents = [];
    try { ents = await fsp.readdir(path.join(bpRoot(), ...(rel ? rel.split('/') : [])), { withFileTypes: true }); } catch { return; }
    if (rel) out.push({ name: rel, label: rel.split('/').pop(), count: ents.filter((e) => !e.isDirectory() && e.name.toLowerCase().endsWith('.sbp')).length, tiefe });
    const dirs = ents.filter((e) => e.isDirectory() && !(tiefe < 0 && e.name === '_Ablage') && !LIB_SKIP.test(e.name)).map((e) => e.name)
      .sort((x, y) => x.localeCompare(y, 'de', { numeric: true }));
    if (tiefe < 4) for (const d of dirs) await walk(rel ? `${rel}/${d}` : d, tiefe + 1);
  };
  await walk('', -1);
  return out.concat(bibliotheksOrdner());
}
/** Alle Unterordner der Bibliotheken (ohne _Archiv/_Pakete/_Duplikate) einzeln zur Auswahl */
function bibliotheksOrdner() {
  const out = [];
  (settings.bibliotheken || []).forEach((root, ri) => {
    if (!root || !fs.existsSync(root)) return;
    const walk = (rel, tiefe) => {
      let l = []; try { l = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
      const n = l.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.sbp')).length;
      out.push({ name: `lib:${ri}:${rel.split(path.sep).join('/')}`, label: rel ? path.basename(rel) : path.basename(root) + ' (Hauptordner)', pfad: rel.split(path.sep).join(' / '), count: n, lib: true, bibliothek: path.basename(root), tiefe });
      if (tiefe < 4) for (const e of l.filter((x) => x.isDirectory() && !LIB_SKIP.test(x.name)).sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }))) walk(rel ? path.join(rel, e.name) : e.name, tiefe + 1);
    };
    walk('', 0);
  });
  return out;
}

const listCache = new Map(); // Datei -> { key, eintrag } – große Ordner (tausende Blaupausen) nicht jedes Mal neu lesen
async function listBlueprints(session) {
  const dir = sessionDir(session);
  const files = (await fsp.readdir(dir)).filter((f) => f.toLowerCase().endsWith('.sbp'));
  const out = new Array(files.length);
  const eins = async (f, i) => {
    const p = path.join(dir, f);
    let st; try { st = await fsp.stat(p); } catch { return; }
    const key = st.size + '|' + st.mtimeMs;
    const c = listCache.get(p);
    if (c && c.key === key) { out[i] = c.eintrag; return; }
    let cfg = {};
    try { cfg = readCfg(await fsp.readFile(p + 'cfg')); } catch { /* keine cfg */ }
    const eintrag = { name: f.slice(0, -4), size: st.size, mtime: st.mtimeMs, beschreibung: cfg.description || '', farbe: cfg.color || null, iconId: cfg.iconId ?? null };
    listCache.set(p, { key, eintrag }); out[i] = eintrag;
  };
  // in Paketen parallel lesen (schnell auch bei tausenden Dateien)
  for (let i = 0; i < files.length; i += 64) await Promise.all(files.slice(i, i + 64).map((f, k) => eins(f, i + k)));
  if (listCache.size > 60000) listCache.clear();
  return out.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
}

const bpCache = new Map(); // Pfad -> { mtime, bp }
async function loadBp(session, name) { return loadBpFile(bpPath(session, name)); }
async function loadBpFile(p) {
  const st = await fsp.stat(p);
  const c = bpCache.get(p);
  if (c && c.mtime === st.mtimeMs) return c.bp;
  const bp = readBlueprint(await fsp.readFile(p));
  bpCache.clear(); // nur die aktuelle Blaupause im Speicher halten
  bpCache.set(p, { mtime: st.mtimeMs, bp });
  return bp;
}

function bpToClient(bp, session, name, cfg) {
  const classes = [], ci = new Map();
  const cls = (c) => { if (!ci.has(c)) { ci.set(c, classes.length); classes.push(c); } return ci.get(c); };
  const r1 = (v) => Math.round(v * 10) / 10, r5 = (v) => Math.round(v * 1e5) / 1e5;
  const ents = [];
  let components = 0;
  for (const o of bp.objects) {
    if (o.kind !== 'entity') { components++; continue; }
    const e = { i: o.i, c: cls(o.cls), p: o.pos.map(r1), q: o.rot.map(r5) };
    if (o.scale.some((s) => Math.abs(s - 1) > 1e-4)) e.s = o.scale.map(r5);
    if (o.recipe) e.r = o.recipe;
    if (o.swatch) e.w = o.swatch;
    if (o.spline) e.sp = o.spline;
    if (o.liftTop) e.lt = o.liftTop;
    if (o.hoehe !== undefined) e.h = r1(o.hoehe); // Stützen/Masten: Höhe und gewählte Stangen-Variante (3D-Modell)
    if (o.stangeNr !== undefined) e.pv = o.stangeNr;
    if (o.length) e.len = o.length;
    ents.push(e);
  }
  return {
    session, name, beschreibung: cfg.description || '', farbe: cfg.color || null,
    kopf: { saveVersion: bp.header.saveVersion, build: bp.header.buildVersion, engine: bp.header.engineVersion || null, kosten: bp.header.costs.map((c) => [c.item, c.amount]), rezepte: bp.header.recipes },
    klassen: classes, objekte: ents, komponenten: components,
  };
}

async function saveBp(body) {
  const { session, name, mode, newName, edits = {}, remove = [], swap = {}, add = [], quelleId, stufe = {}, ablage: ablageOrdnerRel } = body;
  // Quelle: Spielstand-Ordner (session/name), ein Ablage-Ordner oder ein Eintrag aus „Ordnen“ (Unterordner/Bibliothek)
  let quelle = null;
  if (quelleId) {
    quelle = letzterPlan?.get(quelleId);
    if (!quelle) throw Object.assign(new Error('Bitte im Bereich „Ordnen“ neu einlesen und die Blaupause erneut öffnen.'), { status: 409 });
  }
  const ablageDir = !quelle && ablageOrdnerRel ? ablage.ordnerPfad(ablageOrdnerRel) : null;
  if (ablageDir && !safeName(name)) throw Object.assign(new Error('Ungültiger Name'), { status: 400 });
  const srcPath = quelle ? path.join(quelle.root, quelle.dir, quelle.alt + '.sbp') : ablageDir ? path.join(ablageDir, name + '.sbp') : bpPath(session, name);
  const bp = await loadBpFile(srcPath);
  const k = getKatalog();
  let opts = { edits, remove };
  // Mk-Stufe von Baendern/Liften/Rohren aendern
  const retype = {};
  if (Object.keys(stufe).length) {
    const l = await getLib().catch(() => ({ pfade: {} }));
    for (const [i, cls] of Object.entries(stufe)) {
      const o = bp.objects[+i];
      if (!o || o.kind !== 'entity' || !MK_FAMILIE.test(o.cls) || !MK_FAMILIE.test(cls)) continue;
      const typePath = l.pfade?.[cls] || mkPfad(o.typePath, o.cls, cls);
      if (!typePath) throw Object.assign(new Error(`Pfad für „${k.gebaeude[cls]?.name || cls}“ unbekannt.`), { status: 422 });
      const rp = k.pfade.rezepte[k.gebaeude[cls]?.rezept];
      retype[i] = { typePath, recipePath: rp, replaceRecipe: (c, p) => replaceObjectProp(c, 'mBuiltWithRecipe', p) };
    }
  }
  if (Object.keys(swap).length || add.length || remove.length) {
    const l = await getLib();
    const ver = bp.header.saveVersion, taken = new Set(bp.objects.map((o) => o.instance));
    const parents = new Set(bp.objects.filter((o) => o.kind === 'component').map((o) => o.parent));
    const replace = {}, changes = [];
    for (const [i, s] of Object.entries(swap)) {
      const o = bp.objects[+i];
      if (!o || o.kind !== 'entity') continue;
      if (parents.has(o.instance)) throw Object.assign(new Error(`„${k.gebaeude[o.cls]?.name || o.cls}“ hat Innenleben (Anschlüsse/Lager) und kann nicht getauscht werden.`), { status: 422 });
      replace[i] = buildObject(l, k, ver, bp.hasFlags, { cls: s.cls, pos: s.pos || o.pos, rot: s.rot || o.rot }, taken);
      changes.push([o.cls, -1], [s.cls, 1]);
    }
    const added = add.map((a) => { changes.push([a.cls, 1]); return buildObject(l, k, ver, bp.hasFlags, a, taken); });
    for (const i of remove) { const o = bp.objects[+i]; if (o && o.kind === 'entity' && !o.spline && !o.liftTop) changes.push([o.cls, -1]); }
    opts = { edits, remove, replace, add: added, kopf: neuerKopf(k, bp.header, changes) };
  }
  opts.retype = retype;
  if (Object.keys(retype).length) {
    const ch = Object.keys(retype).map((i) => [stufe[i], 1]);
    if (opts.kopf) { for (const [c] of ch) { const rp = k.pfade.rezepte[k.gebaeude[c]?.rezept]; if (rp && !opts.kopf.recipes.includes(rp)) opts.kopf.recipes.push(rp); } }
    else opts.kopf = neuerKopf(k, bp.header, ch);
  }
  const out = writeBlueprint(bp, opts);
  readBlueprint(out); // Selbstpruefung: Ergebnis muss wieder lesbar sein
  const src = srcPath;
  if (mode === 'overwrite') {
    const bdir = path.join(DATA_DIR, 'sicherungen', quelle ? `${quelle.ort}_${quelle.dir || 'Hauptordner'}`.replace(/[\\/:*?"<>|]/g, '_')
      : ablageDir ? `Ablage_${ablageOrdnerRel}`.replace(/[\\/:*?"<>|]/g, '_') : session);
    await fsp.mkdir(bdir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    await fsp.copyFile(src, path.join(bdir, `${name}__${stamp}.sbp`));
    try { await fsp.copyFile(src + 'cfg', path.join(bdir, `${name}__${stamp}.sbpcfg`)); } catch { /* ohne cfg */ }
    await fsp.writeFile(src, out);
    bpCache.clear();
    return { ok: true, name, id: quelleId || null, ablage: ablageDir ? ablageOrdnerRel : undefined, sicherung: path.join(bdir, `${name}__${stamp}.sbp`) };
  }
  if (!safeName(newName)) throw Object.assign(new Error('Bitte einen gültigen Namen für die Kopie angeben (ohne \\ / : * ? " < > |).'), { status: 400 });
  const dst = quelle ? path.join(quelle.root, quelle.dir, newName + '.sbp') : ablageDir ? path.join(ablageDir, newName + '.sbp') : bpPath(session, newName);
  if (fs.existsSync(dst)) throw Object.assign(new Error(`„${newName}“ gibt es schon. Bitte einen anderen Namen wählen.`), { status: 409 });
  await fsp.writeFile(dst, out);
  try { await fsp.copyFile(src + 'cfg', dst + 'cfg'); } catch { /* ohne cfg */ }
  let id = null;
  if (quelle) { id = `${quelle.ort}|${quelle.dir}|${newName}`; letzterPlan.set(id, { ...quelle, id, alt: newName }); }
  return { ok: true, name: newName, id, ablage: ablageDir ? ablageOrdnerRel : undefined };
}

async function createBp(body) {
  const { session, newName, add = [], beschreibung = '' } = body;
  if (!add.length) throw Object.assign(new Error('Keine Bauteile vorhanden.'), { status: 400 });
  if (!safeName(newName)) throw Object.assign(new Error('Bitte einen gültigen Namen angeben (ohne \\ / : * ? " < > |).'), { status: 400 });
  const dst = bpPath(session, newName);
  if (fs.existsSync(dst)) throw Object.assign(new Error(`„${newName}“ gibt es schon. Bitte einen anderen Namen wählen.`), { status: 409 });
  const l = await getLib(), k = getKatalog();
  if (!l.basis) throw Object.assign(new Error('Keine Basis-Blaupause gefunden (mindestens eine eigene Blaupause nötig).'), { status: 422 });
  const taken = new Set();
  const objs = add.map((a) => buildObject(l, k, l.basis.saveVersion, l.basis.hasFlags, a, taken));
  const kopf = neuerKopf(k, { costs: [], recipePaths: [] }, add.map((a) => [a.cls, 1]));
  const out = createBlueprint(l.basis, objs, kopf);
  readBlueprint(out); // Selbstpruefung
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  await fsp.writeFile(dst, out);
  const cfg = makeCfg(l.basis.cfg, beschreibung);
  if (cfg) await fsp.writeFile(dst + 'cfg', cfg);
  return { ok: true, name: newName, objekte: objs.length };
}

// ------------------------------------------------------------------ Blaupausen ordnen (Namensschema)
const ORDNEN_EIGENE = () => path.join(DATA_DIR, 'ordnen-eigene.json');
const ORDNEN_PROTOKOLL = () => path.join(DATA_DIR, 'ordnen-protokoll.json');
const readJsonFile = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
function ordnenOrte() {
  const orte = [{ ort: 'Spiel', root: bpRoot(), ohneWurzel: true }];
  for (const b of settings.bibliotheken || []) if (b && fs.existsSync(b)) orte.push({ ort: 'Bibliothek', root: b });
  return orte;
}
let letzterPlan = null;
function ordnenPlan() {
  const k = getKatalog();
  const t = Date.now();
  const { eintraege, gelesen } = scannen(ordnenOrte(), k, path.join(DATA_DIR, 'ordnen-cache.json'), log);
  const plan = planen(eintraege);
  const eigene = readJsonFile(ORDNEN_EIGENE(), {});
  for (const r of plan) if (eigene[r.id]) { r.neu = eigene[r.id].neu ?? r.neu; r.aktion = eigene[r.id].aktion ?? r.aktion; r.eigen = true; }
  // Bibliothek: passende Namen gleich in die Ablage-Struktur des Eingangsordners vorsortieren
  for (const r of plan) {
    r.ziel = vorsortZiel(r, r.neu);
    if (r.aktion === 'gleich' && r.ziel != null && r.ziel !== r.dir && pass(r.neu)) r.aktion = 'einsortieren';
  }
  letzterPlan = new Map(plan.map((r) => [r.id, r]));
  log(`Ordnen: ${plan.length} Blaupausen (${gelesen} neu gelesen, ${Date.now() - t} ms)`);
  return {
    gruppen: GRUPPEN, maxLen: MAXLEN, dauer: Date.now() - t, gelesen, uebernehmbar: vorsortiert().length,
    orte: ordnenOrte().map((o) => ({ ort: o.ort, root: o.root })),
    eintraege: plan.map((r) => ({ id: r.id, ort: r.ort, dir: r.dir, alt: r.alt, neu: r.neu, code: r.code, grund: r.grund, aktion: r.aktion, ziel: r.ziel,
      dupVon: r.dupVon, dupId: r.dupId || null, aehnlich: r.aehnlich || null, gleiche: r.gleicheWie || 0, eigen: !!r.eigen, n: r.m.n, dim: r.m.dim, prod: r.m.prod?.[0]?.name || null, fehler: r.m.fehler || null })),
  };
}
// Vorsortierung: Bibliotheks-Blaupausen landen im Eingangsordner (erster Unterordner mit „_“, z. B. _sortieren – sonst
// Hauptordner der Bibliothek) unter derselben Struktur wie die Ablage: _sortieren/1 Bauen/1_3 …/Böden/1_3_Fläche_54x16m.
// Erst „In Ablage übernehmen“ verschiebt sie von dort in die Spiel-Ablage.
const eingangVon = (dir) => { const s = (dir || '').split('/')[0]; return s.startsWith('_') ? s : ''; };
function vorsortZiel(r, neu) {
  if (r.ort !== 'Bibliothek' || !pass(neu)) return null;
  const e = eingangVon(r.dir), o = ablageOrdner((/^\d+_\d+/.exec(neu) || [''])[0], neu);
  return e ? `${e}/${o}` : o;
}
/** Alle vorsortierten Blaupausen der Bibliotheken: [{ von (Ordner), rel (Ablage-Ordner), name }] */
function vorsortiert() {
  const haupt = GRUPPEN.filter(([c]) => !c.includes('_')).map(([c]) => ablageOrdner(c));
  const out = [];
  for (const root of settings.bibliotheken || []) {
    if (!root || !fs.existsSync(root)) continue;
    let basen = [''];
    try { basen = basen.concat(fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith('_') && !LIB_SKIP.test(e.name)).map((e) => e.name)); } catch { /* leer */ }
    for (const b of basen) for (const hg of haupt) {
      const walk = (rel) => {
        const abs = path.join(root, b, ...rel.split('/'));
        let l = []; try { l = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
        for (const e of l) {
          if (e.isFile() && /\.sbp$/i.test(e.name)) out.push({ von: abs, rel, name: e.name.slice(0, -4) });
          else if (e.isDirectory() && !e.name.startsWith('_') && rel.split('/').length < 4) walk(`${rel}/${e.name}`);
        }
      };
      walk(hg);
    }
  }
  return out;
}
const UEBERNAHME_PROTOKOLL = () => path.join(DATA_DIR, 'uebernahme-protokoll.json');
/** Vorsortiertes aus den Bibliotheken in die Spiel-Ablage verschieben (gleicher Ordnerpfad). Gibt es den Namen dort schon: liegen lassen. */
function inAblageUebernehmen() {
  const liste = vorsortiert(), erledigt = [], fehler = [];
  // Namen, die es irgendwo in der Ablage schon gibt (auch in anderem Unterordner oder gerade aktiv im Spiel) – nicht doppelt anlegen
  const da = new Map();
  for (const [rel, l] of Object.entries(ablage.lesen().ordner)) for (const b of l) da.set(b.name.toLowerCase(), rel);
  for (const v of liste) {
    const schon = da.get(v.name.toLowerCase());
    if (schon != null) { fehler.push({ name: v.name, von: v.von, fehler: `Gibt es in der Ablage schon (${schon})` }); continue; }
    try { Ablage.bewegen(v.von, ablage.ordnerPfad(v.rel), v.name); erledigt.push({ von: v.von, nach: v.rel, name: v.name }); da.set(v.name.toLowerCase(), v.rel); }
    catch (e) { fehler.push({ name: v.name, von: v.von, fehler: e.message }); }
  }
  // leer gewordene Struktur-Ordner im Eingang aufräumen (nur wirklich leere)
  const ordner = [...new Set(erledigt.map((e) => e.von))].sort((a, b) => b.length - a.length);
  for (let d of ordner) for (let i = 0; i < 4; i++) { try { fs.rmdirSync(d); } catch { break; } d = path.dirname(d); }
  if (erledigt.length) { const p = readJsonFile(UEBERNAHME_PROTOKOLL(), []); p.push({ zeit: new Date().toISOString(), eintraege: erledigt }); fs.writeFileSync(UEBERNAHME_PROTOKOLL(), JSON.stringify(p)); }
  letzterPlan = null; lernModell = null; bpCache.clear(); lib = null; libPromise = null; availCache.clear();
  log(`In Ablage übernommen: ${erledigt.length}, liegen geblieben: ${fehler.length}`);
  return { ok: erledigt.length, fehler };
}

async function ordnenAnwenden(liste) {
  if (!letzterPlan) ordnenPlan();
  const aenderungen = [], weg = [];
  const fehler = [];
  for (const a of liste) {
    const r = letzterPlan.get(a.id);
    if (!r) { fehler.push({ id: a.id, fehler: 'Unbekannt – bitte neu einlesen' }); continue; }
    const aktion = ['duplikat', 'loeschen', 'einsortieren'].includes(a.aktion) ? a.aktion : 'umbenennen';
    if (aktion === 'loeschen') {
      const dir = path.join(r.root, ...(r.dir ? r.dir.split('/') : []));
      const dateien = [r.alt + '.sbp', r.alt + '.sbpcfg'].map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f));
      if (dateien.length) weg.push({ name: r.alt, ort: `${r.ort} · ${r.dir || '(Hauptordner)'}`, dir, dateien }); else fehler.push({ id: a.id, alt: r.alt, fehler: 'Datei nicht gefunden' });
      continue;
    }
    const neu = aktion === 'einsortieren' ? r.alt : String(a.neu || r.neu).trim();
    if (aktion !== 'duplikat' && (!pass(neu) || !safeName(neu))) { fehler.push({ id: a.id, alt: r.alt, fehler: 'Name passt nicht zum Schema' }); continue; }
    // Bibliothek: Duplikate alle in einen Ordner „_Duplikate“ im Eingang (z. B. _sortieren\_Duplikate)
    const zielDir = aktion === 'duplikat' ? (r.ort === 'Bibliothek' ? [eingangVon(r.dir), '_Duplikate'].filter(Boolean).join('/') : null) : vorsortZiel(r, neu);
    if (aktion !== 'duplikat' && neu === r.alt && (zielDir == null || zielDir === r.dir)) continue;
    aenderungen.push({ id: r.id, ort: r.ort, root: r.root, dir: r.dir, alt: r.alt, neu, aktion, zielDir });
  }
  const geloescht = weg.length ? await inPapierkorb(weg) : [];
  const ergebnis = anwenden(aenderungen);
  // Bibliothek: Ordner, die dadurch leer geworden sind, in den Papierkorb (nie der Eingang/Hauptordner selbst)
  const quellen = [...ergebnis.filter((e) => e.ok && e.ort === 'Bibliothek'), ...weg.map((w) => ({ ort: 'Bibliothek', dirAbs: w.dir }))];
  const leer = await leereOrdnerInPapierkorb(quellen.map((e) => e.dirAbs || path.join(e.root, ...(e.dir ? e.dir.split('/') : []))), (settings.bibliotheken || []));
  const prot = readJsonFile(ORDNEN_PROTOKOLL(), []);
  const zeit = new Date().toISOString();
  if (ergebnis.some((e) => e.ok)) { prot.push({ zeit, eintraege: ergebnis }); fs.writeFileSync(ORDNEN_PROTOKOLL(), JSON.stringify(prot)); }
  // eigene Aenderungen der erledigten Eintraege vergessen
  const eigene = readJsonFile(ORDNEN_EIGENE(), {});
  for (const e of ergebnis) if (e.ok) delete eigene[e.id];
  for (const a of liste) if (a.aktion === 'loeschen') delete eigene[a.id];
  fs.writeFileSync(ORDNEN_EIGENE(), JSON.stringify(eigene));
  letzterPlan = null; lernModell = null; bpCache.clear(); lib = null; libPromise = null; availCache.clear();
  log(`Ordnen: ${ergebnis.filter((e) => e.ok).length} erledigt, ${geloescht.length} gelöscht, ${leer.length} leere Ordner in den Papierkorb, ${ergebnis.filter((e) => !e.ok).length + fehler.length} Fehler`);
  return { zeit, ok: ergebnis.filter((e) => e.ok).length, geloescht: geloescht.length, leereOrdner: leer, fehler: [...fehler, ...ergebnis.filter((e) => !e.ok)] };
}

/** Ordner (und darüber liegende), die nichts mehr enthalten außer desktop.ini/Thumbs.db, in den Windows-Papierkorb.
 *  Grenzen (Bibliotheks-Hauptordner) und deren direkte „_“-Eingänge (z. B. _sortieren) bleiben immer stehen. */
async function leereOrdnerInPapierkorb(dirs, grenzen) {
  const g = grenzen.map((x) => path.resolve(x).toLowerCase());
  const geschuetzt = (d) => { const p = path.resolve(d).toLowerCase(); return g.some((x) => p === x || (path.dirname(p) === x && path.basename(p).startsWith('_')) || !p.startsWith(x + path.sep)); };
  const NEBEN = /^(desktop\.ini|thumbs\.db)$/i;
  const weg = new Map(); // klein geschrieben -> Pfad
  const istLeer = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).every((e) => (e.isFile() && NEBEN.test(e.name)) || (e.isDirectory() && weg.has(path.join(d, e.name).toLowerCase()))); } catch { return false; } };
  // tiefste zuerst, dann nach oben weiter prüfen
  const offen = [...new Set(dirs.map((d) => path.resolve(d)))].sort((a, b) => b.length - a.length);
  while (offen.length) {
    const d = offen.shift();
    if (geschuetzt(d) || weg.has(d.toLowerCase()) || !istLeer(d)) continue;
    weg.set(d.toLowerCase(), d);
    const p = path.dirname(d); if (!offen.includes(p)) { offen.push(p); offen.sort((a, b) => b.length - a.length); }
  }
  // nur die obersten leeren Ordner wegwerfen – ihre (leeren) Unterordner gehen mit
  const alle = [...weg.keys()];
  const echt = alle.filter((d) => !alle.some((x) => x !== d && d.startsWith(x + path.sep))).map((d) => weg.get(d));
  if (!echt.length) return [];
  if (process.platform === 'win32') {
    const ps = "Add-Type -AssemblyName Microsoft.VisualBasic; foreach ($d in [IO.File]::ReadAllLines($env:BS_LISTE)) { if ($d) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($d, 'OnlyErrorDialogs', 'SendToRecycleBin') } }";
    const listeDatei = path.join(os.tmpdir(), `bs-ordner-${process.pid}-${Date.now()}.txt`);
    fs.writeFileSync(listeDatei, '﻿' + echt.join('\r\n'), 'utf8');
    await new Promise((res) => { const c = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { env: { ...process.env, BS_LISTE: listeDatei }, windowsHide: true, stdio: 'ignore' }); c.on('exit', res); c.on('error', res); });
    try { fs.unlinkSync(listeDatei); } catch { /* egal */ }
  }
  const erledigt = echt.filter((d) => !fs.existsSync(d));
  if (erledigt.length) {
    const logbuch = readJsonFile(GELOESCHT(), []);
    for (const d of erledigt) logbuch.push({ zeit: new Date().toISOString(), name: path.basename(d), ort: 'leerer Ordner', ordner: path.dirname(d), ziel: 'Papierkorb', dateien: [], pk: null });
    fs.writeFileSync(GELOESCHT(), JSON.stringify(logbuch.slice(-5000)));
    for (const d of erledigt) log(`Leerer Ordner in den Papierkorb: ${d}`);
  }
  return erledigt;
}

// ------------------------------------------------------------------ Ablage + Namensvorschlag
const ablage = new Ablage({ bpRoot, sessionDir, indexDatei: path.join(DATA_DIR, 'ablage.json') });

/** Ablage-Ordnerstruktur ändern (Einstellungen): vorhandene Ordner werden passend umbenannt, Verweise nachgeführt */
function strukturSpeichern(liste) {
  if (!Array.isArray(liste)) throw Object.assign(new Error('Ungültige Liste'), { status: 400 });
  const ok = (n) => String(n || '').replace(/[\\/:*?"<>|]/g, '-').trim();
  const L = [];
  const codes = new Set();
  for (const e of liste) {
    const code = String(e?.[0] || '').trim(), name = ok(e?.[1]);
    if (!/^\d+(_\d+)?$/.test(code)) throw Object.assign(new Error(`Ungültige Nummer „${code}“ – erlaubt: 7 oder 7_3`), { status: 400 });
    if (!name) throw Object.assign(new Error(`Bitte einen Namen für ${code} angeben.`), { status: 400 });
    if (codes.has(code)) throw Object.assign(new Error(`Die Nummer ${code} gibt es doppelt.`), { status: 400 });
    codes.add(code); L.push([code, name]);
  }
  for (const [c] of L) if (c.includes('_') && !codes.has(c.split('_')[0])) throw Object.assign(new Error(`Zu ${c} fehlt die Hauptgruppe ${c.split('_')[0]}.`), { status: 400 });
  const root = ablage.root;
  const suche = (dir, code, haupt) => {
    let l = []; try { l = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return null; }
    const re = haupt ? new RegExp(`^${code}(?:[ \\-]|$)`) : new RegExp(`^${code}(?:[ _\\-]|$)`);
    return l.find((d) => re.test(d.name))?.name || null;
  };
  const umbenannt = []; // [alterRel, neuerRel]
  const verschieben = (vonRel, nachRel) => {
    if (vonRel === nachRel) return;
    const von = path.join(root, ...vonRel.split('/')), nach = path.join(root, ...nachRel.split('/'));
    if (!fs.existsSync(von) || fs.existsSync(nach)) return;
    fs.renameSync(von, nach); umbenannt.push([vonRel, nachRel]);
  };
  setGruppen(L);
  // 1) Hauptgruppen
  for (const [c, n] of L.filter(([c]) => !c.includes('_'))) {
    const alt = suche(root, c, true);
    if (alt) verschieben(alt, `${c} ${n}`);
  }
  // 2) Untergruppen (im – ggf. neuen – Hauptgruppen-Ordner)
  for (const [c, n] of L.filter(([c]) => c.includes('_'))) {
    const hg = c.split('_')[0], top = `${hg} ${GRUPPE_NAME_LESEN(hg)}`;
    const alt = suche(path.join(root, top), c, false);
    if (alt) verschieben(`${top}/${alt}`, `${top}/${c} ${n}`);
  }
  // 3) Verweise im Ablage-Index nachführen
  if (umbenannt.length) {
    const ix = ablage.index();
    const neuPfad = (rel) => { for (const [a, b] of umbenannt) if (rel === a || rel.startsWith(a + '/')) rel = b + rel.slice(a.length); return rel; };
    for (const a of ix.aktiv || []) a.ordner = neuPfad(a.ordner);
    if (ix.herkunft) ix.herkunft = Object.fromEntries(Object.entries(ix.herkunft).map(([k, v]) => [neuPfad(k), v]));
    ablage.speichern(ix);
  }
  const gleichStandard = JSON.stringify(L) === JSON.stringify(standardStruktur().sort((a, b) => a[0].localeCompare(b[0], 'de', { numeric: true })));
  if (gleichStandard) delete settings.struktur; else settings.struktur = L;
  letzterPlan = null; lernModell = null;
  return { ok: true, umbenannt: umbenannt.length, eintraege: L.length };
}
const GRUPPE_NAME_LESEN = (c) => (GRUPPEN.find(([x]) => x === c) || [])[1] || 'Sonstiges';
let lernModell = null;
function getModell() {
  if (lernModell) return lernModell;
  const t = Date.now();
  const { eintraege } = scannen(ordnenOrte(), getKatalog(), path.join(DATA_DIR, 'ordnen-cache.json'), log);
  const eigene = Object.fromEntries(Object.entries(readJsonFile(ORDNEN_EIGENE(), {})).map(([id, v]) => [id, { ...v, alt: id.split('|').pop() }]));
  for (const k of readJsonFile(LERN_DATEI(), [])) eigene['k|' + k.alt] = k;
  lernModell = lernen(eintraege, eigene);
  log(`Lernmodell: ${lernModell.anzahl} Beispiele, ${lernModell.woerter.size} Wörter (${Date.now() - t} ms)`);
  return lernModell;
}
const LERN_DATEI = () => path.join(DATA_DIR, 'namen-gelernt.json');
async function namensVorschlag({ session, ordner, name }) {
  const file = session ? bpPath(session, name) : path.join(ablage.ordnerPfad(ordner), name + '.sbp');
  const k = getKatalog();
  const m = merkmale(readBlueprint(await fsp.readFile(file)), k);
  const rec = { id: session ? `Spiel|${session}|${name}` : `Spiel|_Ablage/${ordner}|${name}`, ort: 'Spiel', dir: session || ordner, alt: name };
  const v = vorschlagGelernt(rec, m, getModell());
  return { ...v, ordner: ablageOrdner(v.code, v.neu), gruppe: GRUPPEN.find(([c]) => c === v.code)?.[1] || '', ok: pass(v.neu), maxLen: MAXLEN, beispiele: getModell().anzahl };
}
const GELOESCHT = () => path.join(DATA_DIR, 'geloescht.json');
// ------------------------------------------------------------------ Duplikate & Papierkorb (nur ansehen/zuruecklegen – endgueltig loeschen nur von Hand)
function duplikateListe() {
  const out = [];
  ordnenOrte().forEach((o, oi) => {
    const walk = (rel, tiefe) => {
      let l = []; try { l = fs.readdirSync(path.join(o.root, rel), { withFileTypes: true }); } catch { return; }
      for (const e of l) {
        if (!e.isDirectory()) continue;
        const sub = rel ? `${rel}/${e.name}` : e.name;
        if (/^_duplikate$/i.test(e.name)) {
          for (const f of fs.readdirSync(path.join(o.root, sub))) if (/\.sbp$/i.test(f)) {
            const st = fs.statSync(path.join(o.root, sub, f));
            out.push({ ort: o.ort, oi, dir: rel, name: f.slice(0, -4), groesse: st.size, zeit: st.mtimeMs, frei: !fs.existsSync(path.join(o.root, rel, f)) });
          }
        } else if (tiefe < 4 && !/^_(archiv|pakete)$/i.test(e.name)) walk(sub, tiefe + 1);
      }
    };
    walk('', 0);
  });
  return out.sort((a, b) => b.zeit - a.zeit);
}
function duplikatZuruecklegen({ oi, dir, name, neu }) {
  const o = ordnenOrte()[oi];
  if (!o || !safeName(name) || (neu && !safeName(neu)) || /(^|\/)\.\.(\/|$)/.test(dir || '')) throw Object.assign(new Error('Ungültige Angabe'), { status: 400 });
  const von = path.join(o.root, dir || '', '_Duplikate'), nach = path.join(o.root, dir || '');
  const ziel = neu || name;
  if (fs.existsSync(path.join(nach, ziel + '.sbp'))) throw Object.assign(new Error(`Im Ordner gibt es schon „${ziel}“ – bitte mit anderem Namen zurücklegen.`), { status: 409 });
  for (const ext of ['.sbp', '.sbpcfg']) if (fs.existsSync(path.join(von, name + ext))) fs.renameSync(path.join(von, name + ext), path.join(nach, ziel + ext));
  letzterPlan = null; bpCache.clear();
  return { ok: true };
}
function papierkorbWiederherstellen(i) {
  const logbuch = readJsonFile(GELOESCHT(), []), e = logbuch[i];
  if (!e || !e.pk) throw Object.assign(new Error('Liegt im Windows-Papierkorb – dort wiederherstellen.'), { status: 409 });
  for (const f of e.dateien) {
    const von = path.join(e.pk, f), nach = path.join(e.ordner, f);
    if (!fs.existsSync(von)) continue;
    if (fs.existsSync(nach)) throw Object.assign(new Error(`„${f}“ gibt es am alten Ort schon.`), { status: 409 });
    fs.mkdirSync(e.ordner, { recursive: true }); fs.renameSync(von, nach);
  }
  e.wiederhergestellt = new Date().toISOString(); fs.writeFileSync(GELOESCHT(), JSON.stringify(logbuch));
  bpCache.clear(); letzterPlan = null;
  return { ok: true };
}

/** Blaupause loeschen = in den Windows-Papierkorb (wiederherstellbar); sonst in userdata\papierkorb */
async function loeschen({ session, ordner, name }) {
  if (!safeName(name)) throw Object.assign(new Error('Ungültiger Name'), { status: 400 });
  const dir = session ? path.dirname(bpPath(session, name)) : ablage.ordnerPfad(ordner);
  const dateien = [path.join(dir, name + '.sbp'), path.join(dir, name + '.sbpcfg')].filter((f) => fs.existsSync(f));
  if (!dateien.length) throw Object.assign(new Error(`„${name}“ nicht gefunden.`), { status: 404 });
  const [e] = await inPapierkorb([{ name, ort: session ? `Spiel · ${session}` : `Ablage · ${ordner}`, dir, dateien }]);
  return { ok: true, ziel: e.ziel };
}
/** Blaupausen (je { name, ort, dir, dateien }) in den Windows-Papierkorb – ein PowerShell-Aufruf für alle;
 *  was danach noch da ist, kommt nach userdata\papierkorb. Logbuch geloescht.json. */
async function inPapierkorb(liste) {
  const alle = liste.flatMap((e) => e.dateien);
  if (process.platform === 'win32' && alle.length) {
    const ps = "Add-Type -AssemblyName Microsoft.VisualBasic; foreach ($f in [IO.File]::ReadAllLines($env:BS_LISTE)) { if ($f) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($f, 'OnlyErrorDialogs', 'SendToRecycleBin') } }";
    const listeDatei = path.join(os.tmpdir(), `bs-papierkorb-${process.pid}-${Date.now()}.txt`);
    fs.writeFileSync(listeDatei, '﻿' + alle.join('\r\n'), 'utf8');
    await new Promise((res) => {
      const c = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { env: { ...process.env, BS_LISTE: listeDatei }, windowsHide: true, stdio: 'ignore' });
      c.on('exit', res); c.on('error', res);
    });
    try { fs.unlinkSync(listeDatei); } catch { /* egal */ }
  }
  const pk = path.join(DATA_DIR, 'papierkorb', new Date().toISOString().slice(0, 10));
  const logbuch = readJsonFile(GELOESCHT(), []);
  for (const e of liste) {
    e.ziel = 'Papierkorb';
    if (e.dateien.some((f) => fs.existsSync(f))) {
      // Ersatz: in userdata\papierkorb verschieben
      await fsp.mkdir(pk, { recursive: true });
      for (const f of e.dateien) if (fs.existsSync(f)) { let z = path.join(pk, path.basename(f)); if (fs.existsSync(z)) z = z.replace(/(\.sbp(cfg)?)$/, `_${Date.now()}$1`); try { await fsp.rename(f, z); } catch { await fsp.copyFile(f, z); await fsp.unlink(f); } }
      e.ziel = path.join('userdata', 'papierkorb');
    }
    logbuch.push({ zeit: new Date().toISOString(), name: e.name, ort: e.ort, ordner: e.dir, ziel: e.ziel, dateien: e.dateien.map((f) => path.basename(f)), pk: e.ziel === 'Papierkorb' ? null : pk });
    log(`Gelöscht (${e.ziel}): ${e.dateien.join(', ')}`);
  }
  fs.writeFileSync(GELOESCHT(), JSON.stringify(logbuch.slice(-5000)));
  bpCache.clear(); letzterPlan = null;
  return liste;
}
function umbenennenMerken(alt, neu) {
  if (!pass(neu) || alt === neu) return;
  const l = readJsonFile(LERN_DATEI(), []);
  l.push({ alt, neu, zeit: new Date().toISOString() });
  fs.writeFileSync(LERN_DATEI(), JSON.stringify(l.slice(-2000)));
  lernModell = null;
}

// ------------------------------------------------------------------ Fenster-Lebenszeichen
// Das Fenster meldet sich alle 5 s. Beim Schließen schickt es zusätzlich „fenster-zu“: kommt danach binnen 8 s kein
// Lebenszeichen mehr (Neuladen meldet sich sofort wieder), beendet sich der Server – und damit sein Konsolenfenster.
// Fallback ohne Abmeldung: 150 s ohne Lebenszeichen (Browser drosseln Zeitgeber in minimierten Fenstern auf 1×/min).
let lastBeat = Date.now(), seenBeat = false, zuSeit = 0;
setInterval(() => {
  if (!FENSTER_ENDE || !seenBeat) return;
  if (zuSeit && lastBeat < zuSeit && Date.now() - zuSeit > 8000) { log('Fenster geschlossen – beende.'); process.exit(0); }
  if (Date.now() - lastBeat > 150000) { log('Kein Lebenszeichen vom Fenster – beende.'); process.exit(0); }
}, 2000).unref();

// ------------------------------------------------------------------ Karte (Spielstaende)
async function spielstaende() {
  const out = [];
  let dirs = [];
  try { dirs = (await fsp.readdir(settings.saveDir, { withFileTypes: true })).filter((d) => d.isDirectory() && d.name !== 'blueprints'); } catch { return out; }
  for (const d of dirs) {
    let files = [];
    try { files = await fsp.readdir(path.join(settings.saveDir, d.name)); } catch { continue; }
    for (const f of files) {
      if (!f.toLowerCase().endsWith('.sav')) continue;
      const full = path.join(settings.saveDir, d.name, f);
      try {
        const st = await fsp.stat(full);
        if (st.size < 1000) continue;
        const fh = await fsp.open(full, 'r'); const b = Buffer.alloc(Math.min(st.size, 65536)); await fh.read(b, 0, b.length, 0); await fh.close();
        let h; try { h = readSavHeader(b); } catch { continue; } // kein Spielstand (z. B. ServerManager_V2.sav) oder zu alt
        out.push({ id: d.name + '/' + f, name: f.replace(/\.sav$/i, ''), sitzung: h.sessionName || '', spielzeit: h.playedSeconds || 0, version: h.saveVersion || 0, mods: (h.mods || []).length, groesse: st.size, geaendert: st.mtimeMs });
      } catch { /* unlesbar */ }
    }
  }
  return out.sort((a, b) => b.geaendert - a.geaendert);
}
// ------------------------------------------------------------------ Kategorien im Bauplan-Menü des Spiels
// Das Spiel speichert die Einteilung je Spielstand. Beim Holen ins Spiel werden ALLE Spielstände der Sitzung angepasst –
// welcher als Nächstes geladen wird, lässt sich nicht vorhersagen (gemessen 21.10.2026: geschrieben in den zuletzt geladenen,
// geladen wurde ein anderer). Neue Speicherstände des Spiels übernehmen die Einteilung vom geladenen Stand.
// Auch bei laufendem Spiel wird sofort geschrieben: Das Spiel liest einen Stand erst beim Laden, im Spiel genügt also neu laden.
// Stände, die das Spiel gerade speichert (jünger als 15 s oder während des Schreibens verändert), werden übersprungen.
// (vorher einmalig als Original in userdata\sicherungen\spielstaende gesichert); Hauptgruppe → Kategorie, Untergruppe →
// Unterkategorie, Namen ohne Nummer. Symbole: im Spiel einmal einstellen – die App merkt sie sich (settings.spielSymbole).
const SPIEL_SICHERUNG = () => path.join(DATA_DIR, 'sicherungen', 'spielstaende');
function spielLaeuft() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((res) => {
    const c = spawn('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true });
    let t = ''; c.stdout.on('data', (d) => { t += d; }); c.on('close', () => res(/"FactoryGame[^"]*\.exe"/i.test(t))); c.on('error', () => res(false));
  });
}
const ohneNummer = (s) => String(s || '').replace(/^\d+(_\d+)?\s+/, '');
/** Zuordnung für alle Blaupausen im Sitzungsordner: Herkunft aus der Ablage, sonst Gruppencode im Namen */
function spielZuordnung(session) {
  const dir = sessionDir(session);
  const namen = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.sbp$/i.test(f)).map((f) => f.slice(0, -4)) : [];
  const aktiv = new Map((ablage.index().aktiv || []).filter((a) => a.session === session).map((a) => [a.name, a.ordner]));
  const zahl = (s) => { const m = /^(\d+)(?:_(\d+))?/.exec(s || ''); return m ? +m[1] * 1000 + +(m[2] || 0) : 99999; };
  const zuordnung = [];
  for (const n of namen) {
    let hgOrdner, ugOrdner;
    const herkunft = aktiv.get(n);
    if (herkunft) [hgOrdner, ugOrdner] = herkunft.split('/');
    else {
      const code = (/^(\d+_\d+)_/.exec(n) || [])[1];
      if (!code || !GRUPPE_NAME[code]) continue;
      [hgOrdner, ugOrdner] = ablageOrdner(code).split('/');
    }
    if (!hgOrdner) continue;
    zuordnung.push({ name: n, kategorie: ohneNummer(hgOrdner), unterkategorie: ohneNummer(ugOrdner || hgOrdner), kSort: zahl(hgOrdner), uSort: zahl(ugOrdner) });
  }
  return { namen, zuordnung };
}
/** gemerkte Symbole (je Hauptgruppen-Nummer) → { Kategoriename in der aktuellen Struktur: IconID } */
const symboleNachName = () => Object.fromEntries(Object.entries(settings.spielSymbole || {}).map(([c, id]) => [GRUPPE_NAME[c] ?? c, id]));
let spielKatLauf = null, spielKatNochmal = new Set();
async function spielKategorienSetzen(session) {
  if (spielKatLauf) { spielKatNochmal.add(session); return { laeuft: true }; }
  spielKatLauf = (async () => {
    const spielAn = await spielLaeuft();
    const staende = (await spielstaende()).filter((st) => st.sitzung === session); // neueste zuerst
    if (!staende.length) throw Object.assign(new Error(`Kein Spielstand der Sitzung „${session}“ gefunden.`), { status: 404 });
    const { namen, zuordnung } = spielZuordnung(session);
    const rang = {};
    for (const [c, n] of GRUPPEN) { const o = ablageOrdner(c).split('/'); if (c.includes('_')) rang[`${ohneNummer(o[0])}/${n}`] = +c.split('_')[1]; else rang[n] = +c; }
    const geschrieben = [], fehler = []; let kategorien = null;
    for (const stand of staende) {
      const datei = path.join(settings.saveDir, ...stand.id.split('/'));
      try {
        if (spielAn && Date.now() - stand.geaendert < 15000) throw new Error('wird gerade vom Spiel gespeichert');
        const vorher = await fsp.stat(datei);
        // einmalig das Original sichern (je Spielstand-Datei)
        const sich = path.join(SPIEL_SICHERUNG(), stand.id.replace(/[\\/]/g, '__'));
        if (!fs.existsSync(sich)) { await fsp.mkdir(SPIEL_SICHERUNG(), { recursive: true }); await fsp.copyFile(datei, sich); log(`Spielstand gesichert: ${sich}`); }
        const buf = await fsp.readFile(datei);
        const r = kategorienSchreiben(buf, readSavHeader(buf), { zuordnung, vorhanden: new Set(namen), leerWeg: new Set(GRUPPEN.filter(([c]) => !c.includes('_')).map(([, n]) => n)), symbole: symboleNachName(), rang, unbestimmtName: { en: 'Undefined', fr: 'Non défini', ja: '未分類' }[settings.sprache] || 'Unbestimmt' });
        // im Spiel eingestellte Symbole merken – nur aus dem neuesten Stand (je Hauptgruppen-Nummer, Haus = Vorgabe zählt nicht)
        if (!geschrieben.length) {
          const neu = {};
          for (const [n, id] of Object.entries(r.symbole)) { const g = GRUPPEN.find(([c, gn]) => !c.includes('_') && gn === n); if (g && id !== SYMBOL_STANDARD) neu[g[0]] = id; }
          if (Object.keys(neu).some((c) => settings.spielSymbole?.[c] !== neu[c])) { settings.spielSymbole = { ...(settings.spielSymbole || {}), ...neu }; await saveSettings(); }
          kategorien = r.kategorien;
        }
        // erst in eine Nachbardatei schreiben, dann ersetzen
        const tmp = datei + '.bs-neu';
        await fsp.writeFile(tmp, r.ausgabe);
        const jetzt = await fsp.stat(datei);
        if (jetzt.mtimeMs !== vorher.mtimeMs || jetzt.size !== vorher.size) { await fsp.rm(tmp, { force: true }); throw new Error('wurde währenddessen vom Spiel gespeichert'); }
        await fsp.rename(tmp, datei);
        geschrieben.push(stand.name);
      } catch (e) { fehler.push(`${stand.name}: ${e.message}`); }
    }
    log(`Kategorien gesetzt in ${geschrieben.length} Spielständen der Sitzung „${session}“${fehler.length ? ` (${fehler.length} übersprungen: ${fehler.slice(0, 3).join('; ')})` : ''}`);
    if (!geschrieben.length) throw Object.assign(new Error('Kategorien konnten in keinen Spielstand geschrieben werden: ' + fehler.slice(0, 3).join('; ')), { status: 422 });
    return { ok: true, spielstand: geschrieben[0], anzahl: geschrieben.length, uebersprungen: fehler.length, zugeordnet: zuordnung.length, kategorien, spielLaeuft: spielAn };
  })();
  try { return await spielKatLauf; }
  finally {
    spielKatLauf = null;
    const weiter = [...spielKatNochmal]; spielKatNochmal.clear();
    for (const s of weiter) spielKategorienSetzen(s).catch((e) => log('Kategorien: ' + e.message));
  }
}
/** Assistent: Pfade prüfen, ohne sie zu speichern */
async function pfadePruefen({ saveDir, gameDir }) {
  const out = { spiele: findeSpielOrdner(), standardSave: defaultSaveDir() };
  const sd = String(saveDir || '').trim(), gd = String(gameDir || '').trim();
  const bp = sd && path.join(sd, 'blueprints');
  let saves = 0;
  try { for (const d of fs.readdirSync(sd, { withFileTypes: true })) if (d.isDirectory() && d.name !== 'blueprints') saves += fs.readdirSync(path.join(sd, d.name)).filter((f) => /\.sav$/i.test(f)).length; } catch { /* */ }
  out.save = sd && fs.existsSync(sd)
    ? { ok: saves > 0 || fs.existsSync(bp), text: `${saves} Spielstände${fs.existsSync(bp) ? ' · Blaupausen-Ordner vorhanden' : ' · noch kein Blaupausen-Ordner (legt das Spiel beim ersten Speichern an)'}` }
    : { ok: false, text: 'Ordner nicht gefunden' };
  const docs = gd && path.join(gd, 'CommunityResources', 'Docs');
  out.game = docs && fs.existsSync(docs) ? { ok: true, text: `Spieldaten gefunden (${fs.readdirSync(docs).filter((f) => f.endsWith('.json')).length} Sprachen)` } : { ok: false, text: gd ? 'Kein „CommunityResources\\Docs“ in diesem Ordner – bitte den Satisfactory-Installationsordner wählen' : 'nicht gefunden' };
  return out;
}
/** Echte Spielstände (Sitzungsname aus den .sav-Köpfen) – nur deren Blaupausen-Ordner liest das Spiel */
let sitzCache = null;
async function spielSitzungen() {
  if (sitzCache && Date.now() - sitzCache.t < 15000) return sitzCache.liste;
  const m = new Map();
  for (const s of await spielstaende()) {
    if (!s.sitzung) continue;
    const e = m.get(s.sitzung) || { name: s.sitzung, spielstaende: 0, zuletzt: 0, letzter: '' };
    e.spielstaende++; if (s.geaendert > e.zuletzt) { e.zuletzt = s.geaendert; e.letzter = s.name; }
    m.set(s.sitzung, e);
  }
  const liste = [...m.values()].sort((a, b) => b.zuletzt - a.zuletzt).map((e) => {
    let anzahl = 0; try { anzahl = fs.readdirSync(path.join(bpRoot(), e.name)).filter((f) => f.toLowerCase().endsWith('.sbp')).length; } catch { /* noch kein Ordner */ }
    return { ...e, blaupausen: anzahl };
  });
  sitzCache = { t: Date.now(), liste };
  return liste;
}
// Kartenbild (Spielwelt in 4 Kacheln, aus dem Spiel per FModel: Interface/UI/Assets/MapTest/SlicedMap/Map_X-Y)
const KARTENBILD_DIRS = () => [path.join(DATA_DIR, 'kartenbild'), path.join(PUBLIC_DIR, 'karte')];
function kartenKachel(name) {
  if (!/^Map_[01]-[01]$/.test(name)) return null;
  for (const d of KARTENBILD_DIRS()) for (const ext of ['.png', '.jpg', '.jpeg']) { const f = path.join(d, name + ext); if (fs.existsSync(f)) return f; }
  return null;
}
const einrichtung = new Einrichtung({
  ROOT, APP_DIR, PUBLIC_DIR, DATA_DIR, get settings() { return settings; }, docsFile, getKatalog: () => getKatalog(), bpRoot, kartenKachel, fmodelDir: FMODEL_DIR, fmodelExport: FMODEL_EXPORT,
  browserExe: () => browserCandidates().find((p) => fs.existsSync(p)) || null, log: (...a) => log(...a),
});
const updater = new Updater({ ROOT, DATA_DIR, VERSION, get settings() { return settings; }, log: (...a) => log(...a) });
/** Karte -> Blaupause: Bereich aus einem Spielstand herauskopieren */
function bereichPruefen(id, bereich) {
  if (/^mp:/.test(id || '')) throw Object.assign(new Error('Aus Megaprints lässt sich (noch) keine Blaupause erzeugen – bitte einen Spielstand wählen.'), { status: 400 });
  if (typeof id !== 'string' || !/^[^\\/:*?"<>|]+\/[^\\/:*?"<>|]+\.sav$/i.test(id)) throw Object.assign(new Error('Ungültiger Spielstand'), { status: 400 });
  if (!bereich || ![bereich.x0, bereich.y0, bereich.x1, bereich.y1].every(Number.isFinite)) throw Object.assign(new Error('Ungültiger Bereich'), { status: 400 });
  const poly = Array.isArray(bereich.poly) ? bereich.poly.filter((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)).slice(0, 5000) : null;
  return { x0: +bereich.x0, y0: +bereich.y0, x1: +bereich.x1, y1: +bereich.y1, z0: bereich.z0 ?? undefined, z1: bereich.z1 ?? undefined, poly: poly && poly.length >= 3 ? poly : null };
}
/** Bereich nur ansehen (eigene 3D-Ansicht der App, nichts wird gespeichert) */
async function karteVorschau({ id, bereich, ohne = [] }) {
  const b = bereichPruefen(id, bereich);
  const l = await getLib(), k = getKatalog();
  const sav = await fsp.readFile(path.join(settings.saveDir, ...id.split('/')));
  const r = bereichAlsBlaupause(sav, b, { lib: l, kat: k, ohne: new Set(Array.isArray(ohne) ? ohne : []), log });
  const bp = readBlueprint(r.datei);
  return { ...bpToClient(bp, '', 'Kartenausschnitt', {}), nurAnsicht: true, kartenAusschnitt: true, info: r.info };
}
async function karteZuBlaupause({ id, bereich, ohne = [], session, name }) {
  const b = bereichPruefen(id, bereich);
  const dst = bpPath(session, name);
  if (fs.existsSync(dst)) throw Object.assign(new Error(`„${name}“ gibt es in „${session}“ schon. Bitte einen anderen Namen wählen.`), { status: 409 });
  const l = await getLib(), k = getKatalog();
  if (!k) throw Object.assign(new Error('Spieldaten (Katalog) fehlen.'), { status: 422 });
  const sav = await fsp.readFile(path.join(settings.saveDir, ...id.split('/')));
  const r = bereichAlsBlaupause(sav, b, { lib: l, kat: k, ohne: new Set(Array.isArray(ohne) ? ohne : []), log });
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  await fsp.writeFile(dst, r.datei);
  const cfg = r.cfg ? makeCfg(r.cfg, `Aus Karte: ${id.split('/').pop().replace(/\.sav$/i, '')} (${r.info.groesse[0]} × ${r.info.groesse[1]} m)`) : null;
  if (cfg) await fsp.writeFile(dst + 'cfg', cfg);
  bpCache.clear(); letzterPlan = null;
  log(`Blaupause aus Karte: ${dst} (${r.info.objekte} Objekte)`);
  return { ok: true, name, session, info: r.info };
}
// ------------------------------------------------------------------ Welt-Ansicht (3D mit Gelände)
let weltHoehenCache;
const weltHoehen = () => { // neu laden, sobald die Datei neu erzeugt wurde
  const st = path.join(DATA_DIR, 'gelaende', 'hoehen1m'); let t = 0; try { t = fs.statSync(st + '.json').mtimeMs; } catch { /* fehlt */ }
  if (!weltHoehenCache || weltHoehenCache.t !== t) weltHoehenCache = { t, h: t ? ladeHoehen(st) : null };
  return weltHoehenCache.h;
};
// Welt-Ansicht Stufe 3: Blaupausen in der Welt setzen und als neue Spielstand-Kopie speichern
/** Blaupausen-Datei aus Spiel-Sitzung ({session, name}) oder Ablage ({ablage, name}) */
function weltBpPfad(q) {
  if (!q || !safeName(q.name)) throw Object.assign(new Error('Ungültiger Blaupausen-Name'), { status: 400 });
  const f = q.ablage != null ? path.join(ablage.ordnerPfad(q.ablage), q.name + '.sbp') : bpPath(q.session, q.name);
  if (!fs.existsSync(f)) throw Object.assign(new Error(`Blaupause „${q.name}“ nicht gefunden.`), { status: 404 });
  return f;
}
async function weltSpielstand(body) {
  const { id, name } = body, setzungen = Array.isArray(body.setzungen) ? body.setzungen : [];
  const loeschen = Array.isArray(body.loeschen) ? body.loeschen : [], verschieben = Array.isArray(body.verschieben) ? body.verschieben : [];
  if (!id || !/^[^\\/:*?"<>|]+\/[^\\/:*?"<>|]+\.sav$/i.test(id)) throw Object.assign(new Error('Bitte zuerst einen Spielstand laden.'), { status: 400 });
  if (!safeName(name)) throw Object.assign(new Error('Bitte einen gültigen Namen für den neuen Spielstand angeben.'), { status: 400 });
  if (!setzungen.length && !loeschen.length && !verschieben.length) throw Object.assign(new Error('Noch nichts gesetzt oder geändert.'), { status: 400 });
  const quelle = path.join(settings.saveDir, ...id.split('/')), ziel = path.join(path.dirname(quelle), name + '.sav');
  const ueberschreiben = fs.existsSync(ziel);
  if (ueberschreiben && !body.ueberschreiben) throw Object.assign(new Error(`Den Spielstand „${name}“ gibt es schon.`), { status: 409 });
  const muster = new Map(), objs = []; let version = 0;
  const sv = setzungen.length ? readSavHeader(await fsp.readFile(quelle)).saveVersion : 0;
  for (const st of setzungen) {
    const datei = weltBpPfad(st); let m = muster.get(datei);
    if (!m) muster.set(datei, m = ladeMuster(datei));
    // Format 46–52 (Spiel 1.0/1.1) in die Kodierung von Format 60 umrechnen (lib/umrechnen.mjs); älter bleibt gesperrt
    if (m.version < sv && m.version >= UMRECHNEN_AB && sv >= 60 && !m.altVersion) { try { musterUmrechnen(m); } catch (x) { throw Object.assign(new Error(`„${st.name}“ ließ sich nicht ins aktuelle Format umrechnen (${x.message}). Bitte im Spiel im Blaupausen-Designer öffnen und neu speichern.`), { status: 422 }); } }
    if (m.version < sv) { const bv = m.version; throw Object.assign(new Error(`„${st.name}“ ist in einem sehr alten Format gespeichert (Version ${bv}, vor Spielversion 1.0) – das rechnet die App (noch) nicht um. Abhilfe: im Spiel im Blaupausen-Designer öffnen und neu speichern.`), { status: 422 }); }
    version = Math.max(version, m.version);
    const q = qz(((+st.dreh || 0) * Math.PI) / 180), off = [+st.x, +st.y, +st.z];
    if (!off.every(Number.isFinite)) throw Object.assign(new Error('Ungültige Lage'), { status: 400 });
    objs.push(...kopiere(m, () => true, (o) => { const w = qrot(q, o.pos); return { pos: [w[0] + off[0], w[1] + off[1], w[2] + off[2]], rot: qmul(q, o.rot) }; }));
  }
  // erst Bestehendes ändern (Stufe 4), dann Blaupausen einfügen (Stufe 3)
  let daten = await fsp.readFile(quelle), info = { blaupausen: setzungen.length, eingefuegt: 0 };
  if (loeschen.length || verschieben.length) { const a = spielstandAendern(daten, { loeschen, verschieben, speichername: name }); daten = a.ausgabe; Object.assign(info, a.info); }
  if (objs.length) { const e = objekteEinfuegen(daten, objs, { musterVersion: version, speichername: name }); daten = e.ausgabe; Object.assign(info, e.info); }
  let sicherung = null;
  if (ueberschreiben) { // alte Datei zuerst sichern (wiederherstellbar), dann ersetzen
    const sdir = path.join(DATA_DIR, 'spielstand-sicherung'); await fsp.mkdir(sdir, { recursive: true });
    sicherung = path.join(sdir, `${name}_${new Date().toISOString().replace(/[:.]/g, '-')}.sav`); await fsp.copyFile(ziel, sicherung);
  }
  await fsp.writeFile(ziel + '.neu', daten); await fsp.rename(ziel + '.neu', ziel);
  info.sicherung = sicherung ? path.basename(sicherung) : null;
  log(`Welt → Spielstand${sicherung ? ` (überschrieben, alte Datei: ${sicherung})` : ''}: ${ziel} (${setzungen.length} Blaupausen, ${info.eingefuegt} Objekte eingefügt, ${loeschen.length} gelöscht, ${verschieben.length} verschoben, Quelle ${id})`);
  return { ok: true, name, datei: path.basename(ziel), info };
}
// ------------------------------------------------------------------ Master Class (Lehrbuch-Fabriken als Vorlagen)
const MC_DIR = () => path.join(DATA_DIR, 'masterclass');
// Quellen: eigene Einstellung, sonst Sortieren\Tschukki und der Ablage-Ordner „10 Master Class“ (dorthin wird einsortiert)
const mcQuellen = () => (settings.masterclassOrdner?.length ? settings.masterclassOrdner : [path.join(bpRoot(), 'Sortieren', 'Tschukki'), ablage.ordnerPfad(ablageOrdner('10'))]).filter((d) => d && fs.existsSync(d));
async function masterclassEinsortieren() {
  await masterclass();
  const r = await masterclassAblegen({ ziel: MC_DIR(), quellen: mcQuellen(), ordnerFuer: (code) => ablage.ordnerPfad(ablageOrdner(code)) });
  mcCache = null; bpCache.clear(); letzterPlan = null;
  log(`Master Class einsortiert: ${r.verschoben} verschoben, ${r.angelegt} aus Abdruck angelegt, ${r.vorhanden} schon da${r.fehler.length ? `, ${r.fehler.length} Fehler` : ''}`);
  return r;
}
let mcCache = null;
async function masterclass(neu = false) {
  if (mcCache && !neu) return mcCache;
  if (!neu) { try { mcCache = JSON.parse(await fsp.readFile(path.join(MC_DIR(), 'index.json'), 'utf8')); if (mcCache.version === 4) return mcCache; } catch { /* einlesen */ } }
  const k = getKatalog();
  if (!k) throw Object.assign(new Error(katalogFehler || 'Spieldaten (Katalog) fehlen.'), { status: 422 });
  mcCache = await masterclassEinlesen({ quellen: mcQuellen(), ziel: MC_DIR(), kat: k, log });
  return mcCache;
}
async function masterclassKopieren({ id, session, name }) {
  if (!safeName(name)) throw Object.assign(new Error('Bitte einen gültigen Namen angeben (ohne \\ / : * ? " < > |).'), { status: 400 });
  const src = masterclassDatei(MC_DIR(), id), dst = bpPath(session, name);
  if (fs.existsSync(dst)) throw Object.assign(new Error(`„${name}“ gibt es in „${session}“ schon. Bitte einen anderen Namen wählen.`), { status: 409 });
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  await fsp.copyFile(src, dst);
  if (fs.existsSync(src + 'cfg')) await fsp.copyFile(src + 'cfg', dst + 'cfg');
  bpCache.clear(); letzterPlan = null;
  return { ok: true, name, session };
}

// ------------------------------------------------------------------ Planer → Blaupause (eine Fertigungsstufe als Reihe)
function planerSchritt(k, s) {
  const r = k.rezepte[s?.rezept];
  if (!r) throw Object.assign(new Error('Unbekanntes Rezept'), { status: 400 });
  const n = Math.max(0.01, Math.min(500, +s.maschinen || +s.anzahl || 1));
  const gebaeude = r.gebaeude.find((g) => /^Build_/.test(g));
  return { rezept: s.rezept, name: r.name, gebaeude, maschinen: n, anzahl: Math.max(1, Math.ceil(n - 1e-6)),
    zutaten: r.zutaten.map((z) => ({ item: z.item, proMin: z.proMin * n })), produkte: r.produkte.map((p) => ({ item: p.item, proMin: p.proMin * n })) };
}
function planerPlan(p0 = {}) {
  const liste = (l) => (Array.isArray(l) ? l : []).slice(0, 50).filter((x) => x && typeof x.item === 'string').map((x) => ({ item: x.item.slice(0, 120), menge: +x.menge || 0 }));
  return { ziele: liste(p0.ziele), vorhanden: liste(p0.vorhanden), wahl: Object.fromEntries(Object.entries(p0.wahl || {}).slice(0, 500).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k.slice(0, 120), v.slice(0, 120)])),
    layout: Object.fromEntries(Object.entries(p0.layout || {}).slice(0, 500).filter(([, v]) => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite))) };
}
async function planerBauen(body) {
  const l = await getLib(), k = getKatalog();
  if (!k) throw Object.assign(new Error(katalogFehler || 'Spieldaten (Katalog) fehlen.'), { status: 422 });
  if (!l.basis) throw Object.assign(new Error('Keine Basis-Blaupause gefunden (mindestens eine eigene Blaupause nötig).'), { status: 422 });
  const basis = l.basis, bandMax = Math.max(1, Math.min(6, +body.bandMax || 6));
  if (body.kette) {
    const plan = planerPlan(body.plan);
    if (!plan.ziele.some((z) => z.menge > 0)) throw Object.assign(new Error('Der Plan hat kein Ziel.'), { status: 400 });
    const ergebnis = planRechnen(k, plan);
    let nur = null, bisName = null;
    if (body.bis) { // Teilfabrik: diese Stufe und alles, was ihr zuliefert
      const i = ergebnis.schritte.findIndex((x) => x.rezept === body.bis);
      if (i < 0) throw Object.assign(new Error('Die gewählte Stufe gibt es im Plan nicht (mehr).'), { status: 400 });
      nur = vorstufen(ergebnis, i); nur.max = i; bisName = ergebnis.schritte[i].name;
    }
    const r = baueKette({ kat: k, lib: l, ver: basis.saveVersion, hasFlags: basis.hasFlags, ergebnis, bandMax, fundament: body.fundament, nur, wasser: !!body.wasser });
    r.info.bis = bisName;
    const datei = createBlueprint(basis, r.objs, r.kopf);
    return { datei, info: { ...r.info, objekte: r.objs.length, rezept: bisName ? `bis ${bisName}` : 'ganze Kette' }, basis, ergebnis, kette: true, bis: bisName };
  }
  const schritt = planerSchritt(k, body.schritt);
  const r = baueReihe({ kat: k, lib: l, ver: basis.saveVersion, hasFlags: basis.hasFlags, schritt, bandMax, fundament: body.fundament, wasser: !!body.wasser });
  const datei = createBlueprint(basis, r.objs, r.kopf);
  return { datei, info: { ...r.info, objekte: r.objs.length, rezept: schritt.name }, basis, schritt };
}
async function planerVorschau(body) {
  const r = await planerBauen(body);
  const bp = readBlueprint(r.datei);
  return { ...bpToClient(bp, '', `Planer-Vorschau ${r.kette ? (r.bis ? `bis ${r.bis}` : 'ganze Kette') : r.schritt.name}`, {}), nurAnsicht: true, planer: true, info: r.info };
}
async function planerSpeichern(body) {
  const { session, name } = body;
  if (!safeName(name)) throw Object.assign(new Error('Bitte einen gültigen Namen angeben (ohne \\ / : * ? " < > |).'), { status: 400 });
  const dst = bpPath(session, name);
  if (fs.existsSync(dst)) throw Object.assign(new Error(`„${name}“ gibt es in „${session}“ schon. Bitte einen anderen Namen wählen.`), { status: 409 });
  const r = await planerBauen(body);
  readBlueprint(r.datei); // Selbstprüfung
  // Grundlage (Plan + gebaute Stufe) merken – die Blaupause trägt nur die Kennung „Plan #…“ in der Beschreibung
  const planId = crypto.randomBytes(4).toString('hex');
  const herkunft = { id: planId, datum: new Date().toISOString(), name, session, bandMax: +body.bandMax || 6, wasser: !!body.wasser, kette: !!r.kette, bis: typeof body.bis === 'string' ? body.bis : null,
    schritt: r.schritt ? { rezept: r.schritt.rezept, maschinen: r.schritt.maschinen } : null, plan: planerPlan(body.plan) };
  await fsp.mkdir(path.join(DATA_DIR, 'planer'), { recursive: true });
  await fsp.writeFile(path.join(DATA_DIR, 'planer', planId + '.json'), JSON.stringify(herkunft, null, 1));
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  await fsp.writeFile(dst, r.datei);
  const s = r.schritt, nm = (it) => getKatalog().items[it]?.name || it, z = (v) => (Math.round(v * 100) / 100).toLocaleString('de-DE');
  const text = r.kette
    ? r.bis ? `Blueprint Studio Planer: Teilfabrik bis ${r.bis} (${r.info.reihen} Reihen, ${r.info.maschinen} Maschinen)` : `Blueprint Studio Planer: ganze Kette (${r.info.reihen} Reihen, ${r.info.maschinen} Maschinen) → ${r.ergebnis.ziele.map((x) => `${z(x.menge)}/min ${nm(x.item)}`).join(', ')}. Zulieferung: ${Object.entries({ ...r.ergebnis.rohstoffe, ...r.ergebnis.fehlt, ...r.ergebnis.vorhanden }).map(([it, m]) => `${z(m)}/min ${nm(it)}`).join(', ')}`
    : `Blueprint Studio Planer: ${s.anzahl}× ${s.name}. Eingang ${s.zutaten.map((x) => `${z(x.proMin)}/min ${nm(x.item)}`).join(', ')} → Ausgang ${s.produkte.map((x) => `${z(x.proMin)}/min ${nm(x.item)}`).join(', ')}`;
  const cfg = makeCfg(r.basis.cfg, `${text} · Plan #${planId}`);
  if (cfg) await fsp.writeFile(dst + 'cfg', cfg);
  bpCache.clear(); letzterPlan = null;
  log(`Planer-Blaupause: ${dst} (${r.info.objekte} Objekte)`);
  return { ok: true, name, session, info: r.info, planId };
}

// ------------------------------------------------------------------ Pixel-Art aus einem Bild
async function pixelBauen(body) {
  const kat = getKatalog();
  if (!kat) throw Object.assign(new Error(katalogFehler || 'Spieldaten (Katalog) fehlen.'), { status: 422 });
  return bauePixelbild({ lib: await getLib(), kat, bild: body.bild, groesse: body.groesse, lage: body.lage, leuchten: !!body.leuchten, transparentWeg: body.transparentWeg !== false });
}
async function pixelVorschau(body) {
  const r = await pixelBauen(body);
  return { ...bpToClient(readBlueprint(r.datei), '', `Pixel-Art · ${body.bild?.b}×${body.bild?.h}`, {}), nurAnsicht: true, info: r.info };
}
async function pixelSpeichern(body) {
  const { session, name } = body;
  if (!safeName(name)) throw Object.assign(new Error('Bitte einen gültigen Namen angeben (ohne \\ / : * ? " < > |).'), { status: 400 });
  const dst = bpPath(session, name);
  if (fs.existsSync(dst)) throw Object.assign(new Error(`„${name}“ gibt es in „${session}“ schon. Bitte einen anderen Namen wählen.`), { status: 409 });
  const r = await pixelBauen(body);
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  await fsp.writeFile(dst, r.datei);
  const cfg = makeCfg((await getLib()).basis?.cfg, `Blueprint Studio Pixel-Art: ${body.bild.b} × ${body.bild.h} Pixel (${r.info.breite} × ${r.info.hoehe} m, ${r.info.schild})${body.quelle ? ` aus „${String(body.quelle).slice(0, 80)}“` : ''}`);
  if (cfg) await fsp.writeFile(dst + 'cfg', cfg);
  bpCache.clear();
  log(`Pixel-Art: ${dst} (${r.info.pixel} Pixel)`);
  return { ok: true, name, session, info: r.info };
}

async function planerHerkunft(id) {
  if (!/^[0-9a-f]{8}$/.test(id || '')) throw Object.assign(new Error('Ungültige Plan-Kennung'), { status: 400 });
  try { return JSON.parse(await fsp.readFile(path.join(DATA_DIR, 'planer', id + '.json'), 'utf8')); }
  catch { throw Object.assign(new Error(`Plan #${id} ist auf diesem Rechner nicht gespeichert.`), { status: 404 }); }
}

const kartenCache = new Map();
// Megaprints (.cbp von satisfactory-calculator) – Ordner aus den Einstellungen
const megaprintDirs = () => (settings.megaprints || []).filter((d) => d && fs.existsSync(d));
function megaprintListe() {
  const out = [];
  megaprintDirs().forEach((root, ri) => {
    const walk = (rel, t) => {
      let l = []; try { l = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
      for (const e of l) {
        const r2 = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory() && t < 2 && !/^_archiv$/i.test(e.name)) walk(r2, t + 1);
        else if (e.isFile() && /\.cbp$/i.test(e.name)) { const st = fs.statSync(path.join(root, r2)); out.push({ id: `mp:${ri}:${r2}`, name: e.name.slice(0, -4), sitzung: 'Megaprint' + (rel ? ' · ' + rel : ''), art: 'megaprint', groesse: st.size, geaendert: st.mtimeMs }); }
      }
    };
    walk('', 0);
  });
  return out.sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
}
async function karte(id) {
  let full, lesen;
  const mp = /^mp:(\d+):(.+)$/.exec(id || '');
  if (mp) {
    const root = megaprintDirs()[+mp[1]];
    if (!root || mp[2].split('/').some((t) => !t || t === '..' || /[\\:*?"<>|]/.test(t)) || !/\.cbp$/i.test(mp[2])) throw Object.assign(new Error('Ungültiger Megaprint'), { status: 400 });
    full = path.join(root, ...mp[2].split('/'));
    lesen = async () => packen(await megaprintKarte(full));
  } else {
    if (typeof id !== 'string' || !/^[^\\/:*?"<>|]+\/[^\\/:*?"<>|]+\.sav$/i.test(id)) throw Object.assign(new Error('Ungültiger Spielstand'), { status: 400 });
    full = path.join(settings.saveDir, ...id.split('/'));
    lesen = async () => packen(kartenDaten(await fsp.readFile(full)));
  }
  const st = await fsp.stat(full);
  const key = `k3|${id}|${st.size}|${Math.round(st.mtimeMs)}`; // k2 = Format der Kartendaten
  if (kartenCache.has(key)) return kartenCache.get(key);
  const cdir = path.join(DATA_DIR, 'karten');
  const cfile = path.join(cdir, id.replace(/[\\/:*?"<>|]/g, '_') + '.bin');
  try {
    const c = await fsp.readFile(cfile);
    const kl = c.readUInt32LE(0);
    if (c.toString('utf8', 4, 4 + kl) === key) { const d = c.subarray(4 + kl); kartenCache.clear(); kartenCache.set(key, d); return d; }
  } catch { /* kein Cache */ }
  log(`Lese ${mp ? 'Megaprint' : 'Spielstand'} ${id} …`);
  const daten = await lesen();
  log(`Spielstand gelesen (${(daten.length / 1e6).toFixed(1)} MB Kartendaten).`);
  await fsp.mkdir(cdir, { recursive: true });
  const kb = Buffer.from(key, 'utf8'), kl = Buffer.alloc(4); kl.writeUInt32LE(kb.length);
  await fsp.writeFile(cfile, Buffer.concat([kl, kb, daten]));
  kartenCache.clear(); kartenCache.set(key, daten);
  return daten;
}

// ------------------------------------------------------------------ Server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  const p = url.pathname;
  try {
    if (p.startsWith('/api/')) {
      // Abmeldung beim Schließen (sendBeacon kann keine eigenen Kopfzeilen senden; harmlos: laufende Fenster melden sich weiter)
      if (p === '/api/fenster-zu') { zuSeit = Date.now(); seenBeat = true; return sendJson(res, 200, { ok: true }); }
      const mutating = req.method !== 'GET';
      if (mutating && req.headers['x-bs'] !== '1') return sendJson(res, 403, { fehler: 'Nicht erlaubt' });
      if (p === '/api/ping') return sendJson(res, 200, { app: 'blueprint-studio', version: VERSION, pid: process.pid });
      if (p === '/api/neustart' && req.method === 'POST') {
        // nach einem Update: neuen Server mit dem aktuellen Programmcode starten, dieser beendet sich
        sendJson(res, 200, { ok: true });
        log('Neustart (Update) …');
        server.close();
        setTimeout(() => { spawn(process.execPath, [fileURLToPath(import.meta.url), '--weiter'], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true }).unref(); process.exit(0); }, 300);
        return;
      }
      if (p === '/api/beenden' && req.method === 'POST') { sendJson(res, 200, { ok: true }); server.close(); setTimeout(() => process.exit(0), 200); return; }
      if (p === '/api/heartbeat') { lastBeat = Date.now(); seenBeat = true; return sendJson(res, 200, { ok: true }); }
      if (p === '/api/config' && req.method === 'GET') {
        const k = getKatalog();
        const modelleDa = fs.existsSync(path.join(PUBLIC_DIR, 'modelle', 'index.json'));
        return sendJson(res, 200, { version: VERSION, saveDir: settings.saveDir, gameDir: settings.gameDir, blueprintDir: bpRoot(),
          appDir: ROOT, fmodelDir: FMODEL_DIR(), fmodelExport: FMODEL_EXPORT(), fmodelEigen: settings.fmodel || '', fmodelExportEigen: settings.fmodelExport || '',
          namensPraefixe: settings.namensPraefixe || [], struktur: GRUPPEN, strukturStandard: standardStruktur(), hilfeSprachen: ['en', 'fr', 'ja'].filter((l) => fs.existsSync(path.join(PUBLIC_DIR, `hilfe.${l}.html`))), sprache: settings.sprache || 'de',
          modelle3d: settings.modelle3d || (modelleDa ? 'modelle' : 'kaesten'), modelleVorhanden: modelleDa, eingerichtet: !!settings.eingerichtet, plattform: process.platform, updateRepo: settings.updateRepo || '', updateRepoStandard: updater.standardRepo(), updatePruefen: settings.updatePruefen !== false, ueVersion: settings.ueVersion || 'GAME_UE5_6',
          blueprintDirOk: fs.existsSync(bpRoot()), bibliotheken: settings.bibliotheken || [], ansicht: settings.ansicht || 'zuletzt', nachrutschen: settings.nachrutschen !== false, umbenennenEinsortieren: settings.umbenennenEinsortieren !== false, spielSitzung: settings.spielSitzung || '', spielSitzungen: await spielSitzungen(), ablageLage: settings.ablageLage || 'unten', ablageBreite: settings.ablageBreite || 420, ablageHoehe: settings.ablageHoehe || 260, megaprints: settings.megaprints || [], docs: docsFile(), katalogOk: !!k, katalogFehler, sessions: await listSessions(),
          icons: await fsp.readdir(path.join(PUBLIC_DIR, 'icons')).then((l) => l.filter((f) => f.endsWith('.png'))).catch(() => []) });
      }
      if (p === '/api/config' && req.method === 'POST') {
        const b = await readJsonBody(req);
        if (typeof b.saveDir === 'string' && b.saveDir.trim()) { settings.saveDir = b.saveDir.trim(); lib = null; libPromise = null; availCache.clear(); }
        if (typeof b.gameDir === 'string' && b.gameDir.trim()) { settings.gameDir = b.gameDir.trim(); katalog = null; availCache.clear(); }
        if (typeof b.nachrutschen === 'boolean') settings.nachrutschen = b.nachrutschen;
        if (typeof b.umbenennenEinsortieren === 'boolean') settings.umbenennenEinsortieren = b.umbenennenEinsortieren;
        if (typeof b.spielSitzung === 'string' && (!b.spielSitzung || safeName(b.spielSitzung))) settings.spielSitzung = b.spielSitzung;
        if (['zuletzt', '2d', '3d'].includes(b.ansicht)) settings.ansicht = b.ansicht;
        if (['unten', 'links'].includes(b.ablageLage)) settings.ablageLage = b.ablageLage;
        if (Number.isFinite(+b.ablageBreite) && b.ablageBreite !== '') settings.ablageBreite = Math.max(220, Math.min(1200, Math.round(+b.ablageBreite)));
        if (Number.isFinite(+b.ablageHoehe) && b.ablageHoehe !== '') settings.ablageHoehe = Math.max(120, Math.min(900, Math.round(+b.ablageHoehe)));
        if (Array.isArray(b.namensPraefixe)) { settings.namensPraefixe = b.namensPraefixe.map((x) => String(x).trim()).filter(Boolean); setPraefixe(settings.namensPraefixe); lernModell = null; letzterPlan = null; }
        if (typeof b.updateRepo === 'string') settings.updateRepo = b.updateRepo.trim();
        if (typeof b.updatePruefen === 'boolean') settings.updatePruefen = b.updatePruefen;
        if (typeof b.ueVersion === 'string' && /^GAME_UE\d_\d+$/.test(b.ueVersion.trim())) settings.ueVersion = b.ueVersion.trim();
        if (typeof b.fmodel === 'string') settings.fmodel = b.fmodel.trim();
        if (typeof b.fmodelExport === 'string') settings.fmodelExport = b.fmodelExport.trim();
        if (['de', 'en', 'fr', 'ja'].includes(b.sprache) && b.sprache !== settings.sprache) {
          settings.sprache = b.sprache; katalog = null; availCache.clear();
          // Ablage-Struktur in der gewählten Sprache vorgeben, solange noch keine Ablage angelegt und nichts selbst geändert ist
          if (!settings.struktur && !fs.existsSync(ablage.root)) { settings.strukturSprache = b.sprache; strukturSprache(); }
        }
        if (['modelle', 'kaesten'].includes(b.modelle3d)) settings.modelle3d = b.modelle3d;
        if (typeof b.eingerichtet === 'boolean') settings.eingerichtet = b.eingerichtet;
        if (Array.isArray(b.megaprints)) settings.megaprints = b.megaprints.map((x) => String(x).trim()).filter(Boolean);
        if (Array.isArray(b.bibliotheken)) { settings.bibliotheken = b.bibliotheken.map((x) => String(x).trim()).filter(Boolean); letzterPlan = null; }
        await saveSettings();
        return sendJson(res, 200, { ok: true });
      }
      if (p === '/api/struktur' && req.method === 'POST') { const r = strukturSpeichern((await readJsonBody(req)).liste); await saveSettings(); return sendJson(res, 200, r); }
      if (p === '/api/sessions') return sendJson(res, 200, await listSessions());
      if (p === '/api/spielsitzungen') { sitzCache = null; return sendJson(res, 200, await spielSitzungen()); }
      if (p === '/api/sitzungen') return sendJson(res, 200, await listSessions());
      if (p === '/api/blueprints') return sendJson(res, 200, await listBlueprints(url.searchParams.get('session')));
      if (p === '/api/blueprint' && url.searchParams.get('ablage')) {
        const o = url.searchParams.get('ablage'), n = url.searchParams.get('name');
        const f = path.join(ablage.ordnerPfad(o), n + '.sbp');
        if (!safeName(n)) throw Object.assign(new Error('Ungültiger Name'), { status: 400 });
        const bp = await loadBpFile(f);
        let cfg = {}; try { cfg = readCfg(await fsp.readFile(f + 'cfg')); } catch { /* ohne cfg */ }
        return sendJson(res, 200, { ...bpToClient(bp, '', n, cfg), ablage: o }); // bearbeitbar, Speichern schreibt in den Ablage-Ordner
      }
      if (p === '/api/blueprint') {
        const s = url.searchParams.get('session'), n = url.searchParams.get('name');
        const bp = await loadBp(s, n);
        let cfg = {}; try { cfg = readCfg(await fsp.readFile(bpPath(s, n, '.sbpcfg'))); } catch { /* ohne cfg */ }
        return sendJson(res, 200, bpToClient(bp, s, n, cfg));
      }
      if (p === '/api/katalog') {
        const k = getKatalog();
        if (!k) return sendJson(res, 503, { fehler: katalogFehler });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ gebaeude: k.gebaeude, items: k.items, rezepte: k.rezepte, freischaltungen: k.freischaltungen }));
      }
      if (p === '/api/blueprint-datei') {
        // Blaupause aus Spiel-Ordner oder Bibliothek nur ansehen (Ordnen-Ansicht)
        const r = letzterPlan?.get(url.searchParams.get('id'));
        if (!r) return sendJson(res, 404, { fehler: 'Bitte die Liste neu einlesen.' });
        const f = path.join(r.root, r.dir, r.alt + '.sbp');
        const bp = await loadBpFile(f);
        let cfg = {}; try { cfg = readCfg(await fsp.readFile(f + 'cfg')); } catch { /* ohne cfg */ }
        return sendJson(res, 200, { ...bpToClient(bp, null, r.alt, cfg), quelleId: r.id, herkunft: `${r.ort}: ${r.dir || '(Hauptordner)'}` });
      }
      if (p === '/api/ordnen' && req.method === 'GET') return sendJson(res, 200, ordnenPlan());
      if (p === '/api/ordnen/vorschau') {
        const r = letzterPlan?.get(url.searchParams.get('id'));
        if (!r) return sendJson(res, 404, { fehler: 'unbekannt' });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'max-age=600' });
        return res.end(JSON.stringify(vorschau(path.join(r.root, r.dir, r.alt + '.sbp'), getKatalog())));
      }
      if (p === '/api/ordnen/merken' && req.method === 'POST') {
        const b = await readJsonBody(req);
        const eigene = readJsonFile(ORDNEN_EIGENE(), {});
        for (const [id, v] of Object.entries(b || {})) { if (v === null) delete eigene[id]; else eigene[id] = { neu: v.neu, aktion: v.aktion }; }
        fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(ORDNEN_EIGENE(), JSON.stringify(eigene));
        return sendJson(res, 200, { ok: true });
      }
      if (p === '/api/ordnen/anwenden' && req.method === 'POST') return sendJson(res, 200, await ordnenAnwenden((await readJsonBody(req)).liste || []));
      if (p === '/api/ordnen/uebernehmen' && req.method === 'POST') return sendJson(res, 200, inAblageUebernehmen());
      if (p === '/api/ordnen/protokoll') return sendJson(res, 200, readJsonFile(ORDNEN_PROTOKOLL(), []).map((b) => ({ zeit: b.zeit, anzahl: b.eintraege.filter((e) => e.ok).length, zurueck: !!b.zurueck })).reverse());
      if (p === '/api/ordnen/rueckgaengig' && req.method === 'POST') {
        const { zeit } = await readJsonBody(req);
        const prot = readJsonFile(ORDNEN_PROTOKOLL(), []);
        const b = prot.find((x) => x.zeit === zeit);
        if (!b || b.zurueck) return sendJson(res, 404, { fehler: 'Diesen Vorgang gibt es nicht (mehr).' });
        const r = rueckgaengig(b.eintraege);
        b.zurueck = new Date().toISOString();
        fs.writeFileSync(ORDNEN_PROTOKOLL(), JSON.stringify(prot));
        letzterPlan = null; bpCache.clear();
        return sendJson(res, 200, { ok: r.filter((x) => x.zurueck).length, fehler: r.filter((x) => !x.zurueck) });
      }
      if (p === '/api/einrichtung') return sendJson(res, 200, einrichtung.pruefen());
      if (p === '/api/einrichtung/modelle') return sendJson(res, 200, await einrichtung.modellStatus());
      if (p === '/api/ordner-waehlen' && req.method === 'POST') { const b = await readJsonBody(req); return sendJson(res, 200, { pfad: await ordnerWaehlen(b.titel, b.start) }); }
      if (p === '/api/einrichtung/pfade' && req.method === 'POST') return sendJson(res, 200, await pfadePruefen(await readJsonBody(req)));
      if (p === '/api/einrichtung/gesehen' && req.method === 'POST') return sendJson(res, 200, einrichtung.gesehen());
      if (p === '/api/einrichtung/job' && req.method === 'GET') return sendJson(res, 200, einrichtung.jobStatus());
      if (p === '/api/einrichtung/job' && req.method === 'POST') return sendJson(res, 200, einrichtung.jobStarten((await readJsonBody(req)).art));
      if (p === '/api/update' && req.method === 'GET') return sendJson(res, 200, await updater.pruefen(url.searchParams.get('neu') === '1'));
      if (p === '/api/update' && req.method === 'POST') return sendJson(res, 200, await updater.installieren());
      if (p === '/api/einrichtung/aktion' && req.method === 'POST') return sendJson(res, 200, await einrichtung.ausfuehren((await readJsonBody(req)).aktion));
      if (p === '/api/karte/liste') return sendJson(res, 200, { ordner: settings.saveDir, spielstaende: await spielstaende(), megaprints: megaprintListe(), kartenbild: ['Map_0-0', 'Map_0-1', 'Map_1-0', 'Map_1-1'].every((n) => kartenKachel(n)) });
      if (p.startsWith('/api/karte/kachel/')) {
        const f = kartenKachel(decodeURIComponent(p.slice('/api/karte/kachel/'.length)));
        if (!f) return sendJson(res, 404, { fehler: 'Kein Kartenbild' });
        res.writeHead(200, { 'Content-Type': f.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Cache-Control': 'max-age=3600' });
        return fs.createReadStream(f).pipe(res);
      }
      if (p === '/api/karte/vorschau' && req.method === 'POST') return sendJson(res, 200, await karteVorschau(await readJsonBody(req)));
      if (p === '/api/masterclass') return sendJson(res, 200, await masterclass(url.searchParams.get('neu') === '1'));
      if (p === '/api/masterclass/vorschau') { const f = masterclassDatei(MC_DIR(), url.searchParams.get('id')); const e = (await masterclass()).eintraege.find((x) => x.id === url.searchParams.get('id')); return sendJson(res, 200, { ...bpToClient(readBlueprint(await fsp.readFile(f)), '', `Master Class ${e?.name || ''}`, {}), nurAnsicht: true }); }
      if (p === '/api/masterclass/export') { await masterclass(); const j = JSON.stringify(await masterclassExport(MC_DIR())); res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="BlueprintStudio-MasterClass.bsmc"' }); res.end(j); return; }
      if (p === '/api/masterclass/import' && req.method === 'POST') { const r = await masterclassImport(MC_DIR(), await readJsonBody(req, 300 * 1024 * 1024)); mcCache = null; return sendJson(res, 200, r); }
      if (p === '/api/masterclass/ablegen' && req.method === 'POST') return sendJson(res, 200, await masterclassEinsortieren());
      if (p === '/api/masterclass/kopieren' && req.method === 'POST') return sendJson(res, 200, await masterclassKopieren(await readJsonBody(req)));
      if (p === '/api/planer/herkunft') return sendJson(res, 200, await planerHerkunft(url.searchParams.get('id')));
      if (p === '/api/planer/vorschau' && req.method === 'POST') return sendJson(res, 200, await planerVorschau(await readJsonBody(req)));
      if (p === '/api/planer/blaupause' && req.method === 'POST') return sendJson(res, 200, await planerSpeichern(await readJsonBody(req)));
      if (p === '/api/pixelbild/vorschau' && req.method === 'POST') return sendJson(res, 200, await pixelVorschau(await readJsonBody(req)));
      if (p === '/api/pixelbild/blaupause' && req.method === 'POST') return sendJson(res, 200, await pixelSpeichern(await readJsonBody(req)));
      if (p === '/api/karte/blaupause' && req.method === 'POST') return sendJson(res, 200, await karteZuBlaupause(await readJsonBody(req)));
      // Welt-Ansicht: Gelände-Kacheln in Detailstufen, Bauteile eines Spielstands mit voller Drehung
      if (p.startsWith('/api/welt/felsen/')) { // Fels-Modelle + Platzierungen (werkzeuge/gelaende --felsen-modelle)
        const n = p.slice('/api/welt/felsen/'.length);
        if (!['index.json', 'meshes.bin', 'platzierungen.bin'].includes(n)) throw Object.assign(new Error('Unbekannte Datei'), { status: 404 });
        const f = path.join(DATA_DIR, 'welt', 'felsen', n);
        if (!fs.existsSync(f)) throw Object.assign(new Error('Keine Fels-Daten (werkzeuge/gelaende --felsen-modelle)'), { status: 404 });
        const d = await fsp.readFile(f);
        res.writeHead(200, { 'Content-Type': n.endsWith('.json') ? 'application/json' : 'application/octet-stream', 'Cache-Control': 'max-age=3600', 'Content-Length': d.length }); return res.end(d);
      }
      if (p === '/api/welt/info') { const h = weltHoehen(); return sendJson(res, 200, { gelaende: h ? h.kopf : null, kachel: KACHEL }); }
      if (p === '/api/welt/kachel') {
        const h = weltHoehen(); if (!h) throw Object.assign(new Error('Keine Geländedaten (werkzeuge/gelaende --raster 100)'), { status: 404 });
        const lod = Math.max(0, Math.min(8, +url.searchParams.get('lod') | 0)), d = Buffer.from(weltKachel(h, lod, +url.searchParams.get('x') | 0, +url.searchParams.get('y') | 0).buffer);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'max-age=3600', 'Content-Length': d.length }); return res.end(d);
      }
      if (p === '/api/welt/daten') {
        const id = url.searchParams.get('id') || '';
        if (!/^[^\\/:*?"<>|]+\/[^\\/:*?"<>|]+\.sav$/i.test(id)) throw Object.assign(new Error('Bitte einen Spielstand wählen.'), { status: 400 });
        const d = packen(weltDaten(await fsp.readFile(path.join(settings.saveDir, ...id.split('/')))));
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': d.length }); return res.end(d);
      }
      if (p === '/api/welt/blaupause') {
        const q = { name: url.searchParams.get('name'), session: url.searchParams.get('session'), ablage: url.searchParams.get('ablage') ?? undefined };
        const d = packen(blaupauseDaten(await loadBpFile(weltBpPfad(q)), q.name));
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': d.length }); return res.end(d);
      }
      if (p === '/api/welt/spielstand-da') { // gibt es den Namen schon? (Rückfrage vor dem Überschreiben)
        const id = url.searchParams.get('id') || '', name = url.searchParams.get('name') || '';
        if (!/^[^\\/:*?"<>|]+\/[^\\/:*?"<>|]+\.sav$/i.test(id) || !safeName(name)) return sendJson(res, 200, { da: false });
        const ziel = path.join(settings.saveDir, id.split('/')[0], name + '.sav');
        return sendJson(res, 200, { da: fs.existsSync(ziel), original: path.basename(id, '.sav') === name });
      }
      if (p === '/api/welt/spielstand' && req.method === 'POST') return sendJson(res, 200, await weltSpielstand(await readJsonBody(req)));
      if (p === '/api/karte/daten') {
        const d = await karte(url.searchParams.get('id'));
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': d.length });
        return res.end(d);
      }
      if (p === '/api/ablage') return sendJson(res, 200, { ...ablage.lesen(), spielSitzungen: (await spielSitzungen()).map((x) => x.name), gruppen: GRUPPEN, ordnerFuer: Object.fromEntries(GRUPPEN.map(([c]) => [c, ablageOrdner(c)])), struktur: strukturOrdner() });
      if (p === '/api/ablage/ablegen' && req.method === 'POST') { const b = await readJsonBody(req); const r = b.von ? ablage.umordnen(b.von, b.name, b.nach) : ablage.ablegen(b.session, b.name, b.nach); bpCache.clear(); letzterPlan = null; return sendJson(res, 200, r); }
      if (p === '/api/ablage/schalten' && req.method === 'POST') { const b = await readJsonBody(req);
        if (b.aktiv && !(await spielSitzungen()).some((x) => x.name === b.session)) throw Object.assign(new Error(`„${b.session || '–'}“ ist kein Spielstand – das Spiel liest nur die Blaupausen-Ordner seiner Spielstände. Bitte einen Spielstand wählen.`), { status: 400 }); const r = ablage.schalten(b.ordner, b.namen || [], !!b.aktiv, b.session); bpCache.clear(); letzterPlan = null; return sendJson(res, 200, r); }
      if (p === '/api/spielkategorien' && req.method === 'POST') return sendJson(res, 200, await spielKategorienSetzen(String((await readJsonBody(req)).session || '')));
      if (p === '/api/ablage/struktur' && req.method === 'POST') { let n = 0; for (const rel of strukturOrdner()) { if (!fs.existsSync(ablage.ordnerPfad(rel))) { ablage.ordnerAnlegen(rel); n++; } } return sendJson(res, 200, { ok: true, angelegt: n, root: ablage.root }); }
      if (p === '/api/ablage/ordner' && req.method === 'POST') { const b = await readJsonBody(req); return sendJson(res, 200, b.entfernen ? ablage.ordnerEntfernen(b.ordner) : ablage.ordnerAnlegen(b.ordner)); }
      if (p === '/api/vorschlag') return sendJson(res, 200, await namensVorschlag({ session: url.searchParams.get('session'), ordner: url.searchParams.get('ordner'), name: url.searchParams.get('name') }));
      if (p === '/api/papierkorb') return sendJson(res, 200, { duplikate: duplikateListe(), geloescht: readJsonFile(GELOESCHT(), []).map((e, i) => ({ ...e, i })).reverse(), orte: ordnenOrte().map((o) => ({ ort: o.ort, root: o.root })) });
      if (p === '/api/papierkorb/zuruecklegen' && req.method === 'POST') return sendJson(res, 200, duplikatZuruecklegen(await readJsonBody(req)));
      if (p === '/api/papierkorb/wiederherstellen' && req.method === 'POST') return sendJson(res, 200, papierkorbWiederherstellen((await readJsonBody(req)).i));
      if (p === '/api/papierkorb/oeffnen' && req.method === 'POST') { if (process.platform === 'win32') spawn('explorer.exe', ['shell:RecycleBinFolder'], { detached: true, stdio: 'ignore' }).unref(); return sendJson(res, 200, { ok: true }); }
      if (p === '/api/loeschen' && req.method === 'POST') return sendJson(res, 200, await loeschen(await readJsonBody(req)));
      if (p === '/api/umbenennen' && req.method === 'POST') {
        const b = await readJsonBody(req);
        const r = ablage.umbenennen(b);
        umbenennenMerken(b.name, b.neu); bpCache.clear(); letzterPlan = null;
        return sendJson(res, 200, r);
      }
      if (p === '/api/save' && req.method === 'POST') return sendJson(res, 200, await saveBp(await readJsonBody(req)));
      if (p === '/api/create' && req.method === 'POST') return sendJson(res, 200, await createBp(await readJsonBody(req)));
      if (p === '/api/vorlagen') {
        const l = await getLib();
        const ver = parseInt(url.searchParams.get('version') || '', 10) || l.basis?.saveVersion;
        return sendJson(res, 200, { basisVersion: l.basis?.saveVersion ?? null, version: ver, verfuegbar: await verfuegbar(ver),
          pfade: Object.keys(l.pfade).length, vorlagen: Object.keys(l.vorlagen[String(ver)] || {}).length });
      }
      if (p === '/api/open-folder' && req.method === 'POST') {
        const b = await readJsonBody(req);
        let dir = bpRoot(); try { if (b.session) dir = sessionDir(b.session); } catch { /* Standard */ }
        if (b.id && letzterPlan?.get(b.id)) { const r = letzterPlan.get(b.id); dir = path.join(r.root, r.dir); }
        if (process.platform === 'win32') spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 404, { fehler: 'Unbekannt' });
    }
    // statische Dateien
    let rel = decodeURIComponent(p === '/' ? '/index.html' : p);
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
    const data = await fsp.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT') return p.startsWith('/api/') ? sendJson(res, 404, { fehler: 'Datei nicht gefunden' }) : (res.writeHead(404), res.end('Nicht gefunden'));
    log('Fehler:', e.message);
    if (!res.headersSent) sendJson(res, e.status || 500, { fehler: e.message });
  }
});

// ------------------------------------------------------------------ App-Fenster
function browserCandidates() {
  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const list = [];
  for (const r of roots) {
    list.push(path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    list.push(path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  return list;
}
function openWindow(url) {
  if (process.platform === 'win32') {
    const exe = browserCandidates().find((p) => fs.existsSync(p));
    if (exe) {
      const profile = path.join(DATA_DIR, 'fenster-profil');
      spawn(exe, [`--app=${url}`, '--window-size=1600,980', `--user-data-dir=${profile}`, '--no-first-run'], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

async function alreadyRunning() {
  try {
    const r = await fetch(`http://${HOST}:${PORT}/api/ping`, { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    return j.app === 'blueprint-studio' ? j : false;
  } catch { return false; }
}
/** Laeuft noch ein Server einer anderen (aelteren) Version? Dann beenden, damit der neue Programmcode gilt. */
async function alteVersionBeenden(alt) {
  log(`Ältere Version ${alt.version || '?'} läuft noch – wird beendet …`);
  try { await fetch(`http://${HOST}:${PORT}/api/beenden`, { method: 'POST', headers: { 'x-bs': '1' }, signal: AbortSignal.timeout(1500) }); } catch { /* alte Version kennt das nicht */ }
  await new Promise((r) => setTimeout(r, 800));
  if (!(await alreadyRunning())) return true;
  if (process.platform === 'win32') {
    // alte Versionen ohne /api/beenden: Prozess ueber den belegten Port finden
    let pid = alt.pid;
    if (!pid) {
      const { execSync } = await import('node:child_process');
      try {
        const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
        const m = out.split(/\r?\n/).map((l) => l.trim().split(/\s+/)).find((c) => c[1] === `${HOST}:${PORT}` && (/LISTEN|ABH/i.test(c[3] || '') || c[2] === '0.0.0.0:0'));
        if (m) pid = +m[4];
      } catch { /* egal */ }
    }
    if (pid && pid !== process.pid) { try { process.kill(pid); } catch { /* evtl. schon weg */ } }
    await new Promise((r) => setTimeout(r, 800));
  }
  return !(await alreadyRunning());
}

const url = `http://localhost:${PORT}/`;
server.once('error', async (err) => {
  const alt = err.code === 'EADDRINUSE' ? await alreadyRunning() : false;
  if (alt && alt.version !== VERSION && (await alteVersionBeenden(alt))) {
    server.listen(PORT, HOST);
    return;
  }
  if (alt) {
    log('Blueprint Studio läuft bereits – öffne nur ein Fenster.');
    if (OPEN_WINDOW) openWindow(url);
    setTimeout(() => process.exit(0), 500);
  } else {
    console.error(`\nServer konnte nicht starten: ${err.message}\n(Anderer Port: Umgebungsvariable BS_PORT setzen.)\nDieses Fenster schließt sich in 60 Sekunden.`);
    setTimeout(() => process.exit(1), 60000);
  }
});
await fsp.mkdir(DATA_DIR, { recursive: true });
server.listen(PORT, HOST, () => {
  log(`Blueprint Studio ${VERSION} läuft auf ${url}`);
  log(`Blaupausen: ${bpRoot()}`);
  setTimeout(() => { getKatalog(); getLib().catch(() => {}); }, 50);
  if (OPEN_WINDOW) openWindow(url);
});
