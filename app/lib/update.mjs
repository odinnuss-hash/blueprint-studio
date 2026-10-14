// Updates: neue Version von GitHub (Releases) holen und über die vorhandene Installation legen.
//
// Ablauf: GET https://api.github.com/repos/<repo>/releases/latest  ->  Tag (z. B. v0.9.0) mit der eigenen
// Version vergleichen  ->  auf Wunsch Quelltext-ZIP des Releases laden, entpacken, Dateien kopieren.
// Persönliches bleibt unberührt: userdata, Modelle, Icons, FModel, 3D-Editor, Extraktor-Zwischendateien.
// Jede ersetzte Datei wird vorher nach userdata\update-sicherung\<alte Version>\ kopiert.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { laden, entpacken } from './einrichtung.mjs';

const API = process.env.BS_UPDATE_API || 'https://api.github.com'; // Umgebungsvariable nur für Tests
const UA = { 'User-Agent': 'BlueprintStudio-Updater', Accept: 'application/vnd.github+json' };
// nie überschreiben (relativ zum Programmordner, mit /)
const GESCHUETZT = [/^userdata\//i, /^app\/public\/modelle\//i, /^app\/public\/icons\/[^/]+\.png$/i, /^app\/icon-[^/]*\.ico$/i,
  /^werkzeuge\/FModel\//i, /^werkzeuge\/Satisfactory3DMap\//i, /^werkzeuge\/extraktor\/(quelle|bin|obj|Export|daten)\//i, /^\.git\//i];

/** "v0.10.2" -> [0,10,2] ; Vergleich numerisch */
export function versionVergleich(a, b) {
  const z = (v) => String(v || '').replace(/^[^\d]*/, '').split(/[.\-+]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
  const A = z(a), B = z(b);
  for (let i = 0; i < 3; i++) if ((A[i] || 0) !== (B[i] || 0)) return (A[i] || 0) - (B[i] || 0);
  return 0;
}

export class Updater {
  /** ctx: { ROOT, DATA_DIR, VERSION, settings, log } */
  constructor(ctx) { this.c = ctx; this.cache = null; this.laeuft = false; }

  /** Standard-Quelle steht in app/update.json (vom Herausgeber gesetzt), in den Einstellungen änderbar */
  standardRepo() {
    try { return JSON.parse(fs.readFileSync(path.join(this.c.ROOT, 'app', 'update.json'), 'utf8')).repo || ''; } catch { return ''; }
  }
  repo() { return String(this.c.settings.updateRepo || this.standardRepo() || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, ''); }

  async pruefen(erzwingen = false) {
    const repo = this.repo();
    const basis = { aktuell: this.c.VERSION, repo, verfuegbar: false };
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { ...basis, hinweis: 'Keine Update-Quelle eingetragen (Einstellungen → Updates).' };
    if (!erzwingen && this.cache && this.cache.repo === repo && Date.now() - this.cache.zeit < 6 * 3600e3) return { ...this.cache.daten, aktuell: this.c.VERSION, verfuegbar: versionVergleich(this.cache.daten.neu, this.c.VERSION) > 0 };
    let r;
    try { r = await fetch(`${API}/repos/${repo}/releases/latest`, { headers: UA, signal: AbortSignal.timeout(15000) }); }
    catch (e) { return { ...basis, fehler: `GitHub nicht erreichbar (${e.message})` }; }
    if (r.status === 404) return { ...basis, hinweis: `Unter ${repo} gibt es noch keine Veröffentlichung (Release).` };
    if (!r.ok) return { ...basis, fehler: `GitHub antwortet mit ${r.status}${r.status === 403 ? ' (zu viele Anfragen – später erneut versuchen)' : ''}` };
    const j = await r.json();
    const daten = {
      repo, neu: String(j.tag_name || '').replace(/^v/i, ''), titel: j.name || j.tag_name, notizen: String(j.body || '').slice(0, 20000),
      datum: j.published_at, seite: j.html_url, zip: j.zipball_url,
    };
    this.cache = { repo, zeit: Date.now(), daten };
    return { ...daten, aktuell: this.c.VERSION, verfuegbar: versionVergleich(daten.neu, this.c.VERSION) > 0 };
  }

  async installieren() {
    if (this.laeuft) throw Object.assign(new Error('Das Update läuft bereits.'), { status: 409 });
    this.laeuft = true;
    try {
      const info = await this.pruefen(true);
      if (info.fehler || info.hinweis) throw new Error(info.fehler || info.hinweis);
      if (!info.verfuegbar) return { ok: true, neu: false, text: `Blueprint Studio ist aktuell (${this.c.VERSION}).` };
      const { ROOT, DATA_DIR, VERSION, log } = this.c;
      const arbeit = path.join(DATA_DIR, 'update', info.neu.replace(/[^\w.-]/g, '_'));
      const zip = path.join(arbeit, 'update.zip'), ausgepackt = path.join(arbeit, 'inhalt');
      log(`Update ${VERSION} → ${info.neu}: lade ${info.zip}`);
      await laden(info.zip, zip);
      await fsp.rm(ausgepackt, { recursive: true, force: true }).catch(() => {});
      await entpacken(zip, ausgepackt);
      // GitHub packt alles in einen Ordner <besitzer>-<repo>-<commit>
      let quelle = ausgepackt;
      const oben = fs.readdirSync(ausgepackt, { withFileTypes: true });
      if (oben.length === 1 && oben[0].isDirectory()) quelle = path.join(ausgepackt, oben[0].name);
      if (!fs.existsSync(path.join(quelle, 'app', 'server.mjs'))) throw new Error('Das heruntergeladene Paket ist kein Blueprint-Studio-Paket (app/server.mjs fehlt).');
      const sicherung = path.join(DATA_DIR, 'update-sicherung', VERSION);
      let kopiert = 0, gesichert = 0, uebersprungen = 0;
      const gehe = async (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const voll = path.join(dir, e.name), rel = path.relative(quelle, voll).split(path.sep).join('/');
          if (e.isDirectory()) { if (!GESCHUETZT.some((re) => re.test(rel + '/'))) await gehe(voll); else uebersprungen++; continue; }
          if (GESCHUETZT.some((re) => re.test(rel))) { uebersprungen++; continue; }
          const ziel = path.join(ROOT, ...rel.split('/'));
          if (fs.existsSync(ziel)) {
            const alt = fs.readFileSync(ziel), neu = fs.readFileSync(voll);
            if (alt.equals(neu)) continue;
            const s = path.join(sicherung, ...rel.split('/'));
            await fsp.mkdir(path.dirname(s), { recursive: true }); await fsp.writeFile(s, alt); gesichert++;
          }
          await fsp.mkdir(path.dirname(ziel), { recursive: true });
          await fsp.copyFile(voll, ziel); kopiert++;
        }
      };
      await gehe(quelle);
      await fsp.rm(arbeit, { recursive: true, force: true }).catch(() => {});
      log(`Update installiert: ${kopiert} Dateien ersetzt, ${gesichert} gesichert nach ${sicherung}`);
      return { ok: true, neu: true, version: info.neu, kopiert, gesichert, sicherung, text: `Update auf ${info.neu} installiert (${kopiert} Dateien). Die App startet neu …` };
    } finally { this.laeuft = false; }
  }
}
