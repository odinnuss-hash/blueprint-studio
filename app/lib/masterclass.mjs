// Master Class: lehrbuchgetreue Fabrik-Blaupausen (z. B. aus blueprints\Sortieren\Tschukki) als Vorlagen.
// Beim Einlesen wird jede Blaupause als „Abdruck“ nach userdata\masterclass kopiert (bleibt erhalten, auch wenn der
// Spiel-Ordner umsortiert wird) und ausgewertet: Maschinen, Rezepte, daraus Ein- und Ausgänge pro Minute (bei 100 %).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { readBlueprint, readCfg } from './sbp.mjs';

const VERSION = 4;

function art(kat, bp, maschinen) {
  const cls = new Set(bp.objects.filter((o) => o.kind === 'entity').map((o) => o.cls));
  if (Object.keys(maschinen).length) return 'Fabrik';
  if ([...cls].some((c) => /Railroad|Train/.test(c))) return 'Bahn';
  if ([...cls].every((c) => /Foundation|Ramp|QuarterPipe/.test(c))) return 'Fundament';
  return 'Sonstiges';
}

/** Netto-Bilanz aus Rezepten × Maschinenzahl (100 % Takt) */
function bilanz(kat, rezepte) {
  const b = {};
  for (const [id, n] of Object.entries(rezepte)) {
    const r = kat.rezepte[id];
    if (!r) continue;
    for (const p of r.produkte) b[p.item] = (b[p.item] || 0) + p.proMin * n;
    for (const z of r.zutaten) b[z.item] = (b[z.item] || 0) - z.proMin * n;
  }
  const aus = {}, ein = {};
  for (const [it, v] of Object.entries(b)) { if (v > 1e-6) aus[it] = v; else if (v < -1e-6) ein[it] = -v; }
  // Endprodukte: werden hergestellt, aber in keinem Rezept der Fabrik verbraucht (Mengen ohne Übertaktung nur ungefähr)
  const verbraucht = new Set(Object.keys(rezepte).flatMap((id) => (kat.rezepte[id]?.zutaten || []).map((z) => z.item)));
  const end = Object.keys(aus).filter((it) => !verbraucht.has(it));
  return { aus, ein, end };
}

export async function masterclassEinlesen({ quellen, ziel, kat, log = () => {} }) {
  const index = path.join(ziel, 'index.json');
  const dateien = [];
  const gehe = async (d, t) => {
    if (t > 5) return;
    let l = []; try { l = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of l) { const p = path.join(d, e.name); if (e.isDirectory()) await gehe(p, t + 1); else if (/\.sbp$/i.test(e.name)) dateien.push(p); }
  };
  for (const q of quellen) await gehe(q, 0);
  let alt = { eintraege: [] }; try { alt = JSON.parse(await fsp.readFile(index, 'utf8')); } catch { /* neu */ }
  const bekannt = new Map((alt.version === VERSION ? alt.eintraege : []).map((e) => [e.id, e]));
  await fsp.mkdir(ziel, { recursive: true });
  const neu = new Map(bekannt);
  const analyse = (buf, cfgBuf, meta) => {
    const bp = readBlueprint(buf);
    const cfg = cfgBuf ? readCfg(cfgBuf) : {};
    const maschinen = {}, rezepte = {};
    for (const o of bp.objects) {
      if (o.kind !== 'entity') continue;
      const g = kat.gebaeude[o.cls];
      if (g?.kategorie === 'Produktion' || /ResourceSink_C$/.test(o.cls)) maschinen[o.cls] = (maschinen[o.cls] || 0) + 1;
      if (o.recipe) rezepte[o.recipe] = (rezepte[o.recipe] || 0) + 1;
    }
    const ent = bp.objects.filter((o) => o.kind === 'entity');
    const xs = ent.map((o) => o.pos[0]), ys = ent.map((o) => o.pos[1]), zs = ent.map((o) => o.pos[2]);
    const { aus, ein, end } = bilanz(kat, rezepte);
    // Stufe (Tier): höchste Stufe der genutzten Standard-Rezepte bzw. Maschinen
    const stufe = Math.max(0, ...Object.keys(rezepte).map((id) => (kat.rezepte[id] && !kat.rezepte[id].alternativ ? kat.rezepte[id].stufe : 0) || 0), ...Object.keys(maschinen).map((c) => kat.gebaeude[c]?.stufe || 0));
    return {
      ...meta, saveVersion: bp.header.saveVersion, beschreibung: cfg.description || meta.beschreibung || '', objekte: ent.length, art: art(kat, bp, maschinen),
      groesse: [Math.round((Math.max(...xs) - Math.min(...xs)) / 100), Math.round((Math.max(...ys) - Math.min(...ys)) / 100), Math.round((Math.max(...zs) - Math.min(...zs)) / 100)],
      maschinen, rezepte, aus, ein, end, stufe,
    };
  };
  // Vorhandene Abdrücke (auch importierte ohne Quelle) bei neuer Auswertungs-Version neu auswerten
  if (alt.version !== VERSION) for (const e of alt.eintraege || []) {
    const p = path.join(ziel, e.id + '.sbp');
    if (!fs.existsSync(p) || neu.has(e.id)) continue;
    try { neu.set(e.id, analyse(await fsp.readFile(p), fs.existsSync(p + 'cfg') ? await fsp.readFile(p + 'cfg') : null, { id: e.id, name: e.name, datei: e.datei, quelle: e.quelle, mc: e.mc, beschreibung: e.beschreibung })); } catch { /* defekt */ }
  }
  for (const f of dateien) {
    let buf; try { buf = await fsp.readFile(f); } catch { continue; }
    const id = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
    if (neu.has(id)) continue;
    let cfgBuf = null; try { cfgBuf = await fsp.readFile(f + 'cfg'); } catch { /* ohne */ }
    const name = path.basename(f, path.extname(f)).replace(/^\d+_\d+_(S\d+_)?/, '').replace(/^[\[(]mc2[\])]_?/i, '').replace(/_/g, ' ').trim();
    let e; try { e = analyse(buf, cfgBuf, { id, name, datei: path.basename(f), quelle: path.relative(quellen[0], f), mc: /mc2/i.test(path.basename(f)) }); } catch (err) { log('Master Class: nicht lesbar', path.basename(f), err.message); continue; }
    await fsp.writeFile(path.join(ziel, id + '.sbp'), buf);
    if (cfgBuf) await fsp.writeFile(path.join(ziel, id + '.sbpcfg'), cfgBuf);
    neu.set(id, e);
  }
  const out = { version: VERSION, erzeugt: new Date().toISOString(), quellen, eintraege: [...neu.values()].sort((a, b) => (b.mc - a.mc) || a.name.localeCompare(b.name, 'de')) };
  await fsp.writeFile(index, JSON.stringify(out, null, 1));
  log(`Master Class: ${out.eintraege.length} Vorlagen (${dateien.length} Dateien gelesen)`);
  return out;
}

export function masterclassDatei(ziel, id) {
  if (!/^[0-9a-f]{12}$/.test(id || '')) throw Object.assign(new Error('Ungültige Vorlage'), { status: 400 });
  const p = path.join(ziel, id + '.sbp');
  if (!fs.existsSync(p)) throw Object.assign(new Error('Vorlage nicht gefunden – bitte neu einlesen.'), { status: 404 });
  return p;
}

/** Paket zum Mitnehmen auf einen anderen Rechner: Index + alle Abdrücke (base64) */
export async function masterclassExport(ziel) {
  const idx = JSON.parse(await fsp.readFile(path.join(ziel, 'index.json'), 'utf8'));
  const dateien = {};
  for (const e of idx.eintraege) {
    const p = path.join(ziel, e.id + '.sbp');
    if (!fs.existsSync(p)) continue;
    dateien[e.id] = { sbp: (await fsp.readFile(p)).toString('base64') };
    if (fs.existsSync(p + 'cfg')) dateien[e.id].cfg = (await fsp.readFile(p + 'cfg')).toString('base64');
  }
  return { art: 'blueprint-studio-masterclass', version: VERSION, erzeugt: new Date().toISOString(), eintraege: idx.eintraege, dateien };
}
export async function masterclassImport(ziel, paket) {
  if (paket?.art !== 'blueprint-studio-masterclass' || !Array.isArray(paket.eintraege)) throw Object.assign(new Error('Das ist kein Master-Class-Paket von Blueprint Studio.'), { status: 400 });
  await fsp.mkdir(ziel, { recursive: true });
  let idx = { version: VERSION, quellen: [], eintraege: [] };
  try { idx = JSON.parse(await fsp.readFile(path.join(ziel, 'index.json'), 'utf8')); } catch { /* neu */ }
  const da = new Set(idx.eintraege.map((e) => e.id));
  let neu = 0;
  for (const e of paket.eintraege) {
    const d = paket.dateien?.[e.id];
    if (!/^[0-9a-f]{12}$/.test(e.id || '') || !d?.sbp) continue;
    const buf = Buffer.from(d.sbp, 'base64');
    try { readBlueprint(buf, { props: false }); } catch { continue; } // nur gültige Blaupausen
    await fsp.writeFile(path.join(ziel, e.id + '.sbp'), buf);
    if (d.cfg) await fsp.writeFile(path.join(ziel, e.id + '.sbpcfg'), Buffer.from(d.cfg, 'base64'));
    if (!da.has(e.id)) { idx.eintraege.push(e); da.add(e.id); neu++; }
  }
  idx.version = VERSION; idx.importiert = new Date().toISOString();
  await fsp.writeFile(path.join(ziel, 'index.json'), JSON.stringify(idx, null, 1));
  return { ok: true, neu, gesamt: idx.eintraege.length };
}

// ------------------------------------------------------------------ Ablage „10 Master Class“
// Thema (Untergruppe) nach Art und Hauptprodukt; die Stufe steht im Dateinamen (…_S7_…), damit im Ordner nach Stufe sortiert wird.
const THEMA_REGELN = [
  ['10_6', /Singularity|Quantum|Ficsite|TimeCrystal|SAMFluctuator|DarkEnergy|DarkMatter|Neural|Superposition|Ficsonium|Plutonium|Nuclear/],
  ['10_5', /Silica|Crystal|Quartz|Computer|CircuitBoard|HighSpeedConnector|Oscillator|RadioControl|AILimiter|Supercomputer/],
  ['10_4', /Alumin|Cooling|Fused|Lightweight|Battery|Radio/],
  ['10_3', /Rubber|Plastic|Petroleum|Fabric|Fuel|Polymer|Resin|Packaged|Canister/],
  ['10_2', /Cable|Wire|Copper|Caterium|Quickwire|HighSpeedWire/],
];
export function mcThema(e) {
  if (e.art === 'Bahn') return '10_7';
  if (e.art === 'Fundament') return '10_8';
  if (e.art !== 'Fabrik') return '10_9';
  const h = (e.end || [])[0] || Object.keys(e.aus || {})[0] || '';
  const sp = /SpaceElevatorPart_(\d+)/.exec(h);
  if (sp) return +sp[1] <= 4 ? '10_1' : +sp[1] === 5 ? '10_5' : '10_6';
  for (const [c, re] of THEMA_REGELN) if (re.test(h)) return c;
  return '10_1';
}
/** Dateiname in der Ablage, z. B. 10_1_S2_dwight_d._eisentower (höchstens 32 Zeichen, gültig für Windows) */
const ABK = [[/blocksignal/g, 'block'], [/pfadsignal/g, 'pfad'], [/kreuzung/g, 'kreuz'], [/bahnhof/g, 'bhf'], [/kreisverkehr/g, 'kreisel'], [/schiene/g, 'sch'],
  [/modular/g, 'mod'], [/gerade/g, 'ger'], [/starter/g, 'start'], [/endgame/g, 'end'], [/beschichteter/g, 'beschicht'], [/final/g, 'fin']];
export function mcAblageName(e) {
  let roh = String(e.name || e.id).replace(/[\\/:*?"<>|]/g, '').trim().replace(/\s+/g, '_');
  const kopf = `${mcThema(e)}_${e.art === 'Fabrik' ? `S${e.stufe ?? 0}_` : ''}`;
  const platz = 32 - kopf.length;
  for (const [re, k] of ABK) if (roh.length > platz) roh = roh.replace(re, k);
  if (roh.length > platz) roh = roh.slice(0, platz - 7) + '~' + roh.slice(-6); // Ende behalten (oft Größe/Nummer)
  return (kopf + roh).replace(/[._ ]+$/, '');
}
/**
 * Alle Master-Class-Vorlagen in die Ablage einsortieren: Originale aus den Quellordnern werden VERSCHOBEN
 * (samt .sbpcfg, umbenannt nach Schema), fehlende (z. B. nur als Paket importierte) werden aus dem Abdruck angelegt.
 * ordnerFuer(code) → Ordnerpfad (absolut). Vorhandene Ziele bleiben unangetastet.
 */
export async function masterclassAblegen({ ziel, quellen, ordnerFuer }) {
  const idx = JSON.parse(await fsp.readFile(path.join(ziel, 'index.json'), 'utf8'));
  const sha = async (f) => crypto.createHash('sha1').update(await fsp.readFile(f)).digest('hex').slice(0, 12);
  const ergebnis = { verschoben: 0, angelegt: 0, vorhanden: 0, fehler: [] };
  const vergeben = new Set();
  for (const e of idx.eintraege) {
    const dir = ordnerFuer(mcThema(e));
    let name = mcAblageName(e);
    for (let k = 2; vergeben.has(name.toLowerCase()); k++) name = mcAblageName(e).slice(0, 29) + '_' + k;
    vergeben.add(name.toLowerCase());
    const nach = path.join(dir, name + '.sbp');
    try {
      if (fs.existsSync(nach)) { ergebnis.vorhanden++; continue; }
      await fsp.mkdir(dir, { recursive: true });
      let von = null;
      for (const q of quellen) {
        const f = e.quelle && path.join(q, e.quelle);
        if (f && fs.existsSync(f) && await sha(f) === e.id) { von = f; break; }
      }
      if (von) {
        await fsp.rename(von, nach);
        if (fs.existsSync(von + 'cfg')) await fsp.rename(von + 'cfg', nach + 'cfg');
        ergebnis.verschoben++;
      } else {
        const a = masterclassDatei(ziel, e.id);
        await fsp.copyFile(a, nach);
        if (fs.existsSync(a + 'cfg')) await fsp.copyFile(a + 'cfg', nach + 'cfg');
        ergebnis.angelegt++;
      }
      if (quellen[0]) e.quelle = path.relative(quellen[0], nach);
    } catch (err) { ergebnis.fehler.push(`${e.name}: ${err.message}`); }
  }
  await fsp.writeFile(path.join(ziel, 'index.json'), JSON.stringify(idx, null, 1));
  return { ok: true, ...ergebnis, gesamt: idx.eintraege.length };
}
