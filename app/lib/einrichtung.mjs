// Einrichtung: Voraussetzungen pruefen und fehlende Teile (soweit erlaubt) automatisch installieren.
//
// Automatisch:  Kartenbild (Kacheln aus dem satisfactory-3d-map-Repository), Desktop-Verknuepfung.
// Gelände & Felsen für die Welt-Ansicht: werkzeuge\gelaende (ebenfalls CUE4Parse) → userdata\gelaende\hoehen1m.*, userdata\welt\felsen\*.
// 3D-Modelle und Icons: automatisch mit dem eigenen Extraktor (werkzeuge\extraktor, baut sich beim ersten Mal
//               selbst mit dem .NET-10-SDK und CUE4Parse) oder angeleitet per FModel – immer aus der eigenen
//               Spielinstallation, Spielinhalte von Coffee Stain duerfen nicht mitgeliefert werden.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

// Teile-Limit (Satisfactory-Wiki „Tutorial:Unreal Engine Entity Limit“): Standard 2.162.688 UObjects; sehr große Fabriken stürzen ab mit
// „Maximum number of UObjects … exceeded“. Abhilfe: in Saved\Config\Windows\Engine.ini [/Script/Engine.GarbageCollectionSettings]
// gc.MaxObjectsInEditor / gc.MaxObjectsInGame setzen (Wiki: 100000000). Das Wiki rät, nur bei diesem Absturz zu erhöhen.
export const TEILELIMIT_STANDARD = 2162688, TEILELIMIT_WIKI = 100000000;
const GC_ABSCHNITT = '[/Script/Engine.GarbageCollectionSettings]', GC_SCHLUESSEL = ['gc.MaxObjectsInEditor', 'gc.MaxObjectsInGame'];
/** Werte aus dem Text der Engine.ini (null = nicht gesetzt) */
export function teileLimitLesen(text) {
  const w = {}; let drin = false;
  for (const z of String(text || '').split(/\r?\n/)) {
    const t = z.trim(); if (t.startsWith('[')) { drin = t.toLowerCase() === GC_ABSCHNITT.toLowerCase(); continue; }
    const m = drin && /^(gc\.MaxObjectsIn(?:Editor|Game))\s*=\s*(\d+)/i.exec(t); if (m) w[m[1].toLowerCase()] = +m[2];
  }
  return { editor: w['gc.maxobjectsineditor'] ?? null, spiel: w['gc.maxobjectsingame'] ?? null };
}
/** Text mit neuem Limit (wert = null: Zeilen entfernen → Spiel-Standard); alles andere bleibt unverändert */
export function teileLimitSetzen(text, wert) {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n', zeilen = String(text || '').split(/\r?\n/), aus = [];
  let drin = false, abschnitt = -1;
  for (const z of zeilen) {
    const t = z.trim();
    if (t.startsWith('[')) { drin = t.toLowerCase() === GC_ABSCHNITT.toLowerCase(); aus.push(z); if (drin) abschnitt = aus.length - 1; continue; }
    if (drin && /^gc\.MaxObjectsIn(?:Editor|Game)\s*=/i.test(t)) continue; // alte Werte raus
    aus.push(z);
  }
  if (wert != null) {
    const neu = GC_SCHLUESSEL.map((k) => `${k}=${wert}`);
    if (abschnitt >= 0) aus.splice(abschnitt + 1, 0, ...neu);
    else { while (aus.length && aus.at(-1).trim() === '') aus.pop(); aus.push('', GC_ABSCHNITT, ...neu, ''); }
  } else if (abschnitt >= 0) { // leeren Abschnitt mit entfernen
    let j = abschnitt + 1; while (j < aus.length && aus[j].trim() === '') j++;
    if (j >= aus.length || aus[j].trim().startsWith('[')) aus.splice(abschnitt, j - abschnitt);
  }
  return aus.join(eol);
}

export const QUELLEN = {
  kachel: (n) => `https://raw.githubusercontent.com/moritz-h/satisfactory-3d-map/master/map/resources/textures/Map/${n}.png`,
  fmodel: 'https://fmodel.app',
  fmodelZip: 'https://github.com/4sval/FModel/releases/latest/download/FModel.zip',
  fmodelApi: 'https://api.github.com/repos/4sval/FModel/releases/latest',
  dotnet: 'https://dotnet.microsoft.com/download/dotnet/10.0',
  cue4parse: (commit) => `https://codeload.github.com/FabianFG/CUE4Parse/zip/${commit}`,
  node: 'https://nodejs.org',
};

/**
 * Satisfactory-Installation suchen: Steam-Bibliotheken (libraryfolders.vdf), Epic-Manifeste, übliche Ordner auf allen Laufwerken.
 * Liefert eine Liste gefundener Ordner (enthalten CommunityResources\Docs).
 */
export function findeSpielOrdner() {
  const treffer = new Set();
  const pruefe = (d) => { try { if (d && fs.existsSync(path.join(d, 'CommunityResources', 'Docs'))) treffer.add(path.normalize(d)); } catch { /* */ } };
  if (process.platform === 'win32') {
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', pf = process.env.ProgramFiles || 'C:\\Program Files';
    // Steam: alle Bibliotheken aus libraryfolders.vdf
    for (const steam of [path.join(pf86, 'Steam'), path.join(pf, 'Steam')]) {
      try {
        const vdf = fs.readFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8');
        const libs = [steam, ...[...vdf.matchAll(/"path"\s+"([^"]+)"/g)].map((m) => m[1].replace(/\\\\/g, '\\'))];
        for (const l of libs) pruefe(path.join(l, 'steamapps', 'common', 'Satisfactory'));
      } catch { /* kein Steam */ }
    }
    // Epic: Manifeste
    try {
      const md = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
      for (const f of fs.readdirSync(md).filter((x) => x.endsWith('.item'))) {
        try { const j = JSON.parse(fs.readFileSync(path.join(md, f), 'utf8')); if (/satisfactory/i.test(j.DisplayName || j.AppName || '')) pruefe(j.InstallLocation); } catch { /* */ }
      }
    } catch { /* kein Epic */ }
    // übliche Ordner auf allen Laufwerken
    for (const lw of 'CDEFGHIJ') {
      for (const rel of ['SteamLibrary\\steamapps\\common\\Satisfactory', 'Steam\\steamapps\\common\\Satisfactory', 'Program Files (x86)\\Steam\\steamapps\\common\\Satisfactory', 'Epic Games\\Satisfactory', 'Program Files\\Epic Games\\Satisfactory', 'Games\\Satisfactory']) pruefe(`${lw}:\\${rel}`);
    }
  } else {
    const h = os.homedir();
    for (const d of [path.join(h, '.steam', 'steam', 'steamapps', 'common', 'Satisfactory'), path.join(h, '.local', 'share', 'Steam', 'steamapps', 'common', 'Satisfactory')]) pruefe(d);
  }
  return [...treffer];
}

const zaehle = (dir, re) => { try { return fs.readdirSync(dir).filter((f) => re.test(f)).length; } catch { return 0; } };

function lauf(cmd, args, opts = {}) {
  return new Promise((res) => {
    const c = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    c.stdout?.on('data', (d) => { out += d; }); c.stderr?.on('data', (d) => { out += d; });
    c.on('exit', (code) => res({ code, out })); c.on('error', (e) => res({ code: -1, out: e.message }));
  });
}

export async function laden(url, ziel) {
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'BlueprintStudio' }, signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw new Error(`Download fehlgeschlagen (${r.status}) – ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await fsp.mkdir(path.dirname(ziel), { recursive: true });
  await fsp.writeFile(ziel, buf);
  return buf.length;
}

export async function entpacken(zip, ziel) {
  await fsp.mkdir(ziel, { recursive: true });
  // Windows 10/11 bringt tar mit (kann .zip); sonst PowerShell; unter Linux unzip
  let r = await lauf('tar', ['-xf', zip, '-C', ziel]);
  if (r.code !== 0 && process.platform === 'win32') {
    r = await lauf('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -Force -LiteralPath $env:BS_ZIP -DestinationPath $env:BS_ZIEL'], { env: { ...process.env, BS_ZIP: zip, BS_ZIEL: ziel } });
  }
  if (r.code !== 0 && process.platform !== 'win32') r = await lauf('unzip', ['-o', zip, '-d', ziel]);
  if (r.code !== 0) throw new Error('Entpacken fehlgeschlagen: ' + r.out.slice(0, 200));
}

/** Windows-Ordnerauswahl (Explorer-Dialog) – liefert den Pfad oder '' */
export async function ordnerWaehlen(titel = 'Ordner wählen', start = '') {
  if (process.platform !== 'win32') throw Object.assign(new Error('Die Ordnerauswahl gibt es nur unter Windows – bitte den Pfad eintippen.'), { status: 400 });
  const ps = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description=$env:BS_TITEL; $d.ShowNewFolderButton=$true; if ($env:BS_START -and (Test-Path $env:BS_START)) { $d.SelectedPath=$env:BS_START }; $f=New-Object System.Windows.Forms.Form -Property @{TopMost=$true; ShowInTaskbar=$false}; if ($d.ShowDialog($f) -eq 'OK') { Write-Output $d.SelectedPath }";
  const r = await lauf('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-Command', ps], { env: { ...process.env, BS_TITEL: titel, BS_START: start || '' } });
  return r.out.trim().split(/\r?\n/).pop() || '';
}

/** dotnet.exe – nach einer frischen Installation steht es noch nicht im PATH dieses Prozesses */
export function dotnetExe() {
  if (process.platform === 'win32') for (const d of [process.env.ProgramFiles, 'C:\\Program Files']) { const f = d && path.join(d, 'dotnet', 'dotnet.exe'); if (f && fs.existsSync(f)) return f; }
  return 'dotnet';
}
/** .NET-Desktop-Laufzeit 10 oder neuer (FModel ab 2026) vorhanden? */
export async function dotnetDa() {
  const r = await lauf(dotnetExe(), ['--list-runtimes']);
  return r.code === 0 && /Microsoft\.WindowsDesktop\.App (1\d|[2-9]\d)\./.test(r.out);
}
/** .NET-SDK 10 oder neuer (zum Bauen des Extraktors) vorhanden? */
export async function sdkDa() {
  const r = await lauf(dotnetExe(), ['--list-sdks']);
  return r.code === 0 && /^(1\d|[2-9]\d)\.\d+\.\d+/m.test(r.out);
}
/** Prozess starten und jede Ausgabezeile melden */
function laufZeilen(cmd, args, opts, proZeile) {
  return new Promise((res) => {
    const c = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let rest = '';
    const daten = (d) => { rest += d; const z = rest.split(/\r?\n/); rest = z.pop(); for (const x of z) if (x.trim()) proZeile(x); };
    c.stdout.on('data', daten); c.stderr.on('data', daten);
    c.on('exit', (code) => { if (rest.trim()) proZeile(rest); res(code); }); c.on('error', (e) => { proZeile('FEHLER ' + e.message); res(-1); });
  });
}
// CUE4Parse-Stand, den auch FModel (Okt. 2026) verwendet – muss zu werkzeuge/extraktor/BsExtraktor.csproj passen
export const CUE_COMMIT = '3fc091a085a609bdb7bd2f8934890051b88ac18b';

export class Einrichtung {
  /** ctx: { ROOT, APP_DIR, PUBLIC_DIR, DATA_DIR, settings, docsFile, getKatalog, bpRoot, kartenKachel, browserExe, log } */
  constructor(ctx) { this.c = ctx; }

  /** FModel.exe im eingestellten bzw. Standard-Ordner */
  fmodelExe() {
    const such = (d, t) => { let l = []; try { l = fs.readdirSync(d, { withFileTypes: true }); } catch { return null; }
      for (const e of l) if (e.isFile() && /^FModel\.exe$/i.test(e.name)) return path.join(d, e.name);
      if (t > 0) for (const e of l) if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'Output') { const r = such(path.join(d, e.name), t - 1); if (r) return r; }
      return null; };
    return such(this.c.fmodelDir(), 2);
  }
  /** Stand für den Assistenten (Modelle mit FModel) */
  async modellStatus() {
    const c = this.c, exp = c.fmodelExport();
    let glb = 0, json = 0, icons = 0;
    const zaehlen = (d, t) => { let l = []; try { l = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of l) { if (e.isDirectory() && t > 0) zaehlen(path.join(d, e.name), t - 1); else if (/\.glb$/i.test(e.name)) glb++; else if (/^Build_.*\.json$/i.test(e.name)) json++; else if (/^IconDesc.*\.png$/i.test(e.name)) icons++; } };
    if (fs.existsSync(exp)) zaehlen(exp, 12);
    return {
      windows: process.platform === 'win32', dotnet: process.platform === 'win32' ? await dotnetDa() : false, sdk: await sdkDa(),
      extraktor: fs.existsSync(path.join(this.extraktorDir(), 'BsExtraktor.csproj')), extraktorGebaut: fs.existsSync(path.join(this.extraktorDir(), 'bin', 'BsExtraktor.dll')), job: this.jobStatus(), ueVersion: c.settings.ueVersion || 'GAME_UE5_6', fmodel: this.fmodelExe(), fmodelDir: c.fmodelDir(), export: exp,
      exportDa: { glb, json, icons }, modelle: fs.existsSync(path.join(c.PUBLIC_DIR, 'modelle', 'index.json')), icons: zaehle(path.join(c.PUBLIC_DIR, 'icons'), /\.png$/i),
      gameDir: c.settings.gameDir, usmap: path.join(c.settings.gameDir || '', 'CommunityResources', 'FactoryGame.usmap'),
    };
  }

  desktopLnk() {
    const home = os.homedir();
    return [path.join(home, 'Desktop', 'Blueprint Studio.lnk'), path.join(home, 'OneDrive', 'Desktop', 'Blueprint Studio.lnk'), path.join(home, 'OneDrive', 'Schreibtisch', 'Blueprint Studio.lnk')].find((f) => fs.existsSync(f)) || null;
  }

  pruefen() {
    const c = this.c, s = c.settings, liste = [];
    const add = (id, titel, status, text, extra = {}) => liste.push({ id, titel, status, text, ...extra });
    const nv = parseInt(process.versions.node, 10);
    add('node', 'Node.js', nv >= 18 ? 'ok' : 'fehler', `Version ${process.versions.node}${nv >= 18 ? '' : ' – mindestens 18 nötig'}`, { link: QUELLEN.node });
    const docs = c.docsFile();
    const kat = docs ? c.getKatalog() : null;
    add('spiel', 'Satisfactory-Installation', kat ? 'ok' : 'fehler', kat ? `${Object.keys(kat.gebaeude).length} Gebäude aus ${docs}` : `Spieldaten nicht gefunden in „${s.gameDir}“ – Ordner in den Einstellungen angeben`, { pflicht: true });
    const bp = c.bpRoot();
    const sessions = fs.existsSync(bp) ? fs.readdirSync(bp, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== '_Ablage').length : 0;
    add('saves', 'Spielstand-Ordner', fs.existsSync(bp) ? 'ok' : 'fehler', fs.existsSync(bp) ? `${s.saveDir} · ${sessions} Blaupausen-Ordner` : `„blueprints“ nicht gefunden in „${s.saveDir}“`, { pflicht: true });
    if (process.platform === 'win32') {
      const exe = c.browserExe();
      add('browser', 'App-Fenster (Edge/Chrome)', exe ? 'ok' : 'warnung', exe || 'Kein Edge/Chrome gefunden – die App öffnet sich im Standard-Browser');
    }
    const modelle = fs.existsSync(path.join(c.PUBLIC_DIR, 'modelle', 'index.json')) && fs.existsSync(path.join(c.PUBLIC_DIR, 'modelle', 'meshes.bin'));
    let nModelle = 0; try { nModelle = Object.keys(JSON.parse(fs.readFileSync(path.join(c.PUBLIC_DIR, 'modelle', 'index.json'), 'utf8')).klassen || {}).length; } catch { /* */ }
    add('modelle', '3D-Modelle', modelle ? 'ok' : 'warnung', modelle ? `vorhanden${nModelle ? ` (${nModelle} Gebäude)` : ''}` : 'fehlen – 3D zeigt einfache Kästen. Im Einrichtungs-Assistenten (Schritt „Spielmodelle“) automatisch aus dem eigenen Spiel holen.', { hilfe: 'fm-modelle' });
    const nIcons = zaehle(path.join(c.PUBLIC_DIR, 'icons'), /\.png$/i);
    add('icons', 'Gebäude-Icons', nIcons > 100 ? 'ok' : 'warnung', nIcons > 100 ? `${nIcons} Icons` : 'fehlen – Katalog ohne Bilder. Im Einrichtungs-Assistenten (Schritt „Spielmodelle“) automatisch holen.', { hilfe: 'fm-icons' });
    const kacheln = ['Map_0-0', 'Map_0-1', 'Map_1-0', 'Map_1-1'].every((n) => c.kartenKachel(n));
    add('kartenbild', 'Kartenbild (Spielwelt)', kacheln ? 'ok' : 'warnung', kacheln ? 'vorhanden' : 'fehlt – Karte ohne Hintergrund', { aktion: kacheln ? null : 'kartenbild', aktionText: 'Herunterladen' });
    const welt = this.weltDa(), jw = this.job?.art === 'gelaende' && this.job.laeuft ? this.job : null;
    add('welt', 'Gelände & Felsen (Welt-Ansicht)', welt ? 'ok' : 'warnung', jw ? `wird erzeugt – Schritt ${jw.nr}/${jw.von}: ${jw.schritt}` : welt ? 'vorhanden (aus deinem Spiel)' : 'fehlen – die Welt-Ansicht braucht sie. „Erzeugen“ holt sie einmalig aus deinem Spiel (ca. 1–2 Minuten; geschieht auch automatisch beim Holen der Spielmodelle).', { aktion: jw ? null : 'gelaende', aktionText: welt ? 'Neu erzeugen' : 'Erzeugen' });
    if (process.platform === 'win32') {
      const tl = this.teileLimit(), wert = Math.min(tl.editor ?? TEILELIMIT_STANDARD, tl.spiel ?? TEILELIMIT_STANDARD), hoch = wert > TEILELIMIT_STANDARD;
      add('teilelimit', 'Teile-Limit (große Fabriken)', tl.da ? 'ok' : 'warnung', !tl.da ? 'Engine.ini des Spiels noch nicht vorhanden – Satisfactory einmal starten.'
        : hoch ? `angehoben auf ${wert.toLocaleString('de-DE')} Objekte (Spiel-Standard ${TEILELIMIT_STANDARD.toLocaleString('de-DE')})`
        : `Spiel-Standard (${TEILELIMIT_STANDARD.toLocaleString('de-DE')} Objekte) – reicht fast immer. Nur anheben, wenn das Spiel bei einer riesigen Fabrik mit „Maximum number of UObjects … exceeded“ abstürzt.`,
        { aktion: tl.da ? (hoch ? 'teilelimitAus' : 'teilelimitAn') : null, aktionText: hoch ? 'Zurücksetzen' : 'Anheben', link: 'https://satisfactory.fandom.com/wiki/Tutorial:Unreal_Engine_Entity_Limit' });
    }
    if (process.platform === 'win32') {
      const lnk = this.desktopLnk();
      add('verknuepfung', 'Desktop-Verknüpfung', lnk ? 'ok' : 'warnung', lnk ? lnk : 'keine Verknüpfung auf dem Desktop', { aktion: 'verknuepfung', aktionText: lnk ? 'Neu anlegen' : 'Anlegen' });
    }
    const pflichtOk = liste.filter((x) => x.pflicht).every((x) => x.status === 'ok');
    return { liste, pflichtOk, ersterStart: !fs.existsSync(path.join(c.DATA_DIR, '.einrichtung-gesehen')) };
  }

  gesehen() { fs.mkdirSync(this.c.DATA_DIR, { recursive: true }); fs.writeFileSync(path.join(this.c.DATA_DIR, '.einrichtung-gesehen'), new Date().toISOString()); return { ok: true }; }

  // ------------------------------------------------------------ Automatisch: Extraktor (läuft im Hintergrund)
  extraktorDir() { return path.join(this.c.ROOT, 'werkzeuge', 'extraktor'); }
  jobStatus() { const j = this.job; return j ? { art: j.art, laeuft: j.laeuft, ok: j.ok, schritt: j.schritt, nr: j.nr, von: j.von, fortschritt: j.fortschritt, text: j.text, log: j.log.slice(-60), start: j.start, ende: j.ende } : { laeuft: false }; }
  jobStarten(art) {
    if (this.job?.laeuft) throw Object.assign(new Error('Es läuft bereits ein Vorgang.'), { status: 409 });
    if (art !== 'automatisch' && art !== 'gelaende') throw Object.assign(new Error('Unbekannter Vorgang'), { status: 400 });
    const j = this.job = { art, laeuft: true, ok: null, schritt: 'Start …', nr: 0, von: art === 'gelaende' ? 7 : 7, fortschritt: null, text: '', log: [], start: Date.now(), ende: null };
    const zeile = (z) => { j.log.push(z); if (j.log.length > 600) j.log.splice(0, j.log.length - 600); };
    (art === 'gelaende' ? this.gelaendeJob(j, zeile) : this.automatisch(j, zeile))
      .then((t) => { j.ok = true; j.text = t; })
      .catch((e) => { j.ok = false; j.text = e.message; zeile('FEHLER ' + e.message); this.c.log((art === 'gelaende' ? 'Gelände & Felsen: ' : 'Automatische Modelle: ') + e.message); })
      .finally(() => { j.laeuft = false; j.ende = Date.now(); j.fortschritt = null; });
    return this.jobStatus();
  }

  dotnetEnv() { return { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', CUE4PARSE_SKIP_NATIVE: 'true' }; }
  /** Schritte 1–2 für Extraktor und Gelände-Werkzeug: .NET 10 SDK und CUE4Parse-Quelltext */
  async vorbereiten(j, zeile, schritt) {
    const dir = this.extraktorDir();
    schritt(1, '.NET 10 SDK prüfen');
    if (!(await sdkDa())) {
      if (process.platform !== 'win32') throw new Error('Bitte das .NET 10 SDK installieren: ' + QUELLEN.dotnet);
      schritt(1, '.NET 10 SDK installieren (einmalig, ca. 250 MB – Windows fragt evtl. nach Erlaubnis)');
      const code = await laufZeilen('winget', ['install', '--id', 'Microsoft.DotNet.SDK.10', '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements'], {}, (z) => { if (!/^[\s\-\\|/█▒]+$/.test(z)) zeile(z); });
      if (!(await sdkDa())) throw new Error(`.NET 10 SDK konnte nicht installiert werden (winget Code ${code}). Bitte von ${QUELLEN.dotnet} das „SDK 10“ (x64) installieren und erneut versuchen.`);
    }
    zeile('.NET 10 SDK vorhanden.');

    // 2. CUE4Parse-Quelltext
    schritt(2, 'Bibliothek CUE4Parse laden');
    const quelle = path.join(dir, 'quelle', `CUE4Parse-${CUE_COMMIT}`);
    if (!fs.existsSync(path.join(quelle, 'CUE4Parse-Conversion', 'CUE4Parse-Conversion.csproj'))) {
      const zip = path.join(dir, 'quelle', 'cue4parse.zip');
      const n = await laden(QUELLEN.cue4parse(CUE_COMMIT), zip);
      zeile(`heruntergeladen: ${(n / 1e6).toFixed(1)} MB`);
      await entpacken(zip, path.join(dir, 'quelle'));
      try { await fsp.unlink(zip); } catch { /* bleibt liegen */ }
      if (!fs.existsSync(path.join(quelle, 'CUE4Parse-Conversion', 'CUE4Parse-Conversion.csproj'))) throw new Error('CUE4Parse wurde geladen, aber nicht wie erwartet entpackt: ' + quelle);
    } else zeile('schon vorhanden.');

  }
  engineIni() { return this.c.engineIni || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'FactoryGame', 'Saved', 'Config', 'Windows', 'Engine.ini'); }
  teileLimit() { const f = this.engineIni(); let t = null; try { t = fs.readFileSync(f, 'utf8'); } catch { /* fehlt */ } return { datei: f, da: t != null, ...teileLimitLesen(t) }; }
  /** Engine.ini ändern (wert = null: Standard) – vorher Sicherung nach userdata/engine-ini-sicherung */
  teileLimitAendern(wert) {
    const f = this.engineIni(); if (!fs.existsSync(f)) throw new Error('Engine.ini des Spiels nicht gefunden – Satisfactory einmal starten und beenden, dann erneut versuchen.');
    const alt = fs.readFileSync(f, 'utf8'), neu = teileLimitSetzen(alt, wert);
    const sdir = path.join(this.c.DATA_DIR, 'engine-ini-sicherung'); fs.mkdirSync(sdir, { recursive: true });
    const sich = path.join(sdir, `Engine_${new Date().toISOString().replace(/[:.]/g, '-')}.ini`); fs.writeFileSync(sich, alt);
    fs.writeFileSync(f, neu);
    const pr = teileLimitLesen(fs.readFileSync(f, 'utf8'));
    if ((wert == null && (pr.editor != null || pr.spiel != null)) || (wert != null && (pr.editor !== wert || pr.spiel !== wert))) throw new Error('Engine.ini wurde nicht wie erwartet geändert – Sicherung liegt in ' + sich);
    return sich;
  }
  weltDa() { const d = this.c.DATA_DIR; return fs.existsSync(path.join(d, 'gelaende', 'hoehen1m.json')) && fs.existsSync(path.join(d, 'welt', 'felsen', 'index.json')); }
  /** Gelände (1-m-Raster) und Fels-Modelle aus dem eigenen Spiel – Schritte ab nr (Werkzeug bauen, Gelände, Felsen) */
  async weltDatenErzeugen(j, zeile, schritt, nr) {
    const c = this.c, wdir = path.join(c.ROOT, 'werkzeuge', 'gelaende'), env = this.dotnetEnv(), daten = path.join(this.extraktorDir(), 'daten');
    if (!fs.existsSync(path.join(wdir, 'Gelaende.csproj'))) throw new Error('werkzeuge\\gelaende fehlt – bitte die App vollständig (neu) herunterladen.');
    if (!['FactoryGame-angepasst.usmap', 'oodle-data-shared.dll'].every((n) => fs.existsSync(path.join(daten, n)))) throw new Error('Hilfsdaten des Extraktors fehlen – bitte zuerst im Schritt „Spielmodelle“ die Modelle automatisch holen.');
    schritt(nr, 'Gelände-Werkzeug bauen (beim ersten Mal ca. 1 Minute)');
    const bin = path.join(wdir, 'bin'), dll = path.join(bin, 'Gelaende.dll');
    const zeit = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
    if (!fs.existsSync(dll) || Math.max(zeit(path.join(wdir, 'Program.cs')), zeit(path.join(wdir, 'Gelaende.csproj'))) > zeit(dll)) {
      const letzte = [];
      const code = await laufZeilen(dotnetExe(), ['build', path.join(wdir, 'Gelaende.csproj'), '-c', 'Release', '-o', bin, '-nologo', '-v', 'minimal', '-p:CUE4PARSE_SKIP_NATIVE=true'], { cwd: wdir, env },
        (z) => { letzte.push(z); if (letzte.length > 40) letzte.shift(); if (/error|Fehler|Build succeeded|Der Buildvorgang/i.test(z) || /->/.test(z)) zeile(z.trim().slice(0, 400)); });
      if (code !== 0 || !fs.existsSync(dll)) { letzte.slice(-25).forEach((z) => zeile(z)); throw new Error('Das Gelände-Werkzeug konnte nicht gebaut werden – Ausgabe siehe unten.'); }
      zeile('gebaut.');
    } else zeile('schon gebaut.');
    const lauf = async (n, titel, extra) => {
      schritt(n, titel); let fertig = '';
      const code = await laufZeilen(dotnetExe(), [dll, '--spiel', c.settings.gameDir, '--daten', daten, ...extra], { cwd: wdir, env }, (z) => {
        const m = /^FORTSCHRITT (\d+) (\d+)/.exec(z); if (m) { j.fortschritt = [+m[1], +m[2]]; return; }
        if (z.startsWith('FERTIG ')) fertig = z.slice(7);
        if (!/Treffer für|^\d+ Dateien$/.test(z)) zeile(z.slice(0, 400));
      });
      if (code !== 0) throw new Error(`Das Gelände-Werkzeug hat mit Fehler ${code} aufgehört – Ausgabe siehe unten.`);
      return fertig;
    };
    fs.mkdirSync(path.join(c.DATA_DIR, 'gelaende'), { recursive: true });
    const g = await lauf(nr + 1, 'Gelände aus dem Spiel lesen (1-m-Raster, ca. 30 Sekunden)', ['--export', path.join(c.DATA_DIR, 'gelaende', 'hoehen1m'), '--raster', '100']);
    const f = await lauf(nr + 2, 'Felsen und Klippen als Modelle holen (ca. 30 Sekunden)', ['--felsen-modelle', path.join(c.DATA_DIR, 'welt', 'felsen')]);
    const p = await lauf(nr + 3, 'Rohstoff-Knoten, Absturzstellen und Sammelobjekte lesen (ca. 1 Minute)', ['--punkte', path.join(c.DATA_DIR, 'welt', 'punkte.json')]);
    // Schild-Symbole (Plan-Tafel): Symbol-Bibliothek des Spiels → userdata/symbole.json (Desc-Klasse → IconID)
    let sy = '';
    try {
      const roh = path.join(c.DATA_DIR, 'iconlibrary.json');
      await lauf(nr + 4, 'Schild-Symbole lesen (wenige Sekunden)', ['--muster', 'IconLibrary', '--json', roh]);
      const daten = JSON.parse(fs.readFileSync(roh, 'utf8')), m = {};
      for (const e of daten[0]?.exporte?.[0]?.Properties?.mIconData || []) { const d = e.ItemDescriptor?.AssetPathName; if (!d || e.Hidden) continue; const k = d.split('.').pop(); if (!(k in m)) m[k] = e.ID; }
      fs.writeFileSync(path.join(c.DATA_DIR, 'symbole.json'), JSON.stringify({ quelle: 'IconLibrary (mIconData)', erzeugt: new Date().toISOString(), symbole: m }));
      fs.rmSync(roh, { force: true }); sy = ` · Symbole: ${Object.keys(m).length}`;
    } catch (e) { zeile('Schild-Symbole: ' + e.message); }
    return `Gelände: ${g || 'fertig'} · Felsen: ${f || 'fertig'} · Kartenpunkte: ${p || 'fertig'}${sy}`;
  }
  async gelaendeJob(j, zeile) {
    const c = this.c, schritt = (nr, t) => { j.nr = nr; j.schritt = t; j.fortschritt = null; zeile(`== ${t}`); };
    if (!c.settings.gameDir || !fs.existsSync(path.join(c.settings.gameDir, 'FactoryGame', 'Content', 'Paks'))) throw new Error('Satisfactory-Installationsordner fehlt oder stimmt nicht (Einstellungen bzw. Schritt „Ordner“).');
    await this.vorbereiten(j, zeile, schritt);
    const t = await this.weltDatenErzeugen(j, zeile, schritt, 3);
    return 'Fertig – Gelände und Felsen für die Welt-Ansicht sind da (' + t + ').';
  }

  async automatisch(j, zeile) {
    const c = this.c, dir = this.extraktorDir();
    const schritt = (nr, t) => { j.nr = nr; j.schritt = t; j.fortschritt = null; zeile(`== ${t}`); };
    if (!c.settings.gameDir || !fs.existsSync(path.join(c.settings.gameDir, 'FactoryGame', 'Content', 'Paks'))) throw new Error('Satisfactory-Installationsordner fehlt oder stimmt nicht (Einstellungen bzw. Schritt „Ordner“).');
    if (!fs.existsSync(path.join(dir, 'BsExtraktor.csproj'))) throw new Error('werkzeuge\\extraktor fehlt – bitte die App vollständig (neu) herunterladen.');
    const env = this.dotnetEnv();
    await this.vorbereiten(j, zeile, schritt);
    // 3. Extraktor bauen (nur wenn nötig)
    schritt(3, 'Extraktor bauen (beim ersten Mal 1–3 Minuten)');
    const bin = path.join(dir, 'bin'), dll = path.join(bin, 'BsExtraktor.dll');
    const zeit = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
    if (!fs.existsSync(dll) || Math.max(zeit(path.join(dir, 'Program.cs')), zeit(path.join(dir, 'BsExtraktor.csproj'))) > zeit(dll)) {
      const letzte = [];
      const code = await laufZeilen(dotnetExe(), ['build', path.join(dir, 'BsExtraktor.csproj'), '-c', 'Release', '-o', bin, '-nologo', '-v', 'minimal', '-p:CUE4PARSE_SKIP_NATIVE=true', `-p:CueCommit=${CUE_COMMIT}`], { cwd: dir, env },
        (z) => { letzte.push(z); if (letzte.length > 40) letzte.shift(); if (/error|Fehler|warn.*NU1|Build succeeded|Der Buildvorgang/i.test(z) || /->/.test(z)) zeile(z.trim().slice(0, 400)); });
      if (code !== 0 || !fs.existsSync(dll)) { letzte.slice(-25).forEach((z) => zeile(z)); throw new Error('Der Extraktor konnte nicht gebaut werden – Ausgabe siehe unten (bitte bei Problemen weitergeben).'); }
      zeile('gebaut.');
    } else zeile('schon gebaut.');

    // 4. Spieldaten extrahieren
    schritt(4, 'Bauteil-Daten, 3D-Modelle und Icons aus dem Spiel holen');
    const exportDir = path.join(dir, 'Export');
    let fertig = '';
    const code = await laufZeilen(dotnetExe(), [dll, '--spiel', c.settings.gameDir, '--ziel', exportDir, '--ue', c.settings.ueVersion || 'GAME_UE5_6', '--daten', path.join(dir, 'daten')], { cwd: dir, env }, (z) => {
      const m = /^FORTSCHRITT (\d+) (\d+)/.exec(z);
      if (m) { j.fortschritt = [+m[1], +m[2]]; return; }
      if (z.startsWith('SCHRITT ')) { j.schritt = 'Spiel: ' + z.slice(8); j.fortschritt = null; }
      if (z.startsWith('FERTIG ')) fertig = z.slice(7);
      zeile(z);
    });
    if (code !== 0) throw new Error(`Der Extraktor hat mit Fehler ${code} aufgehört – Ausgabe siehe unten.`);

    // 5. In die App übernehmen
    schritt(5, 'Icons und Modelle in die App übernehmen');
    for (const w of ['icons-uebernehmen.mjs', 'modelle-aufbereiten.mjs']) {
      const k = await laufZeilen(process.execPath, [path.join(c.ROOT, 'werkzeuge', w), exportDir], { cwd: c.ROOT }, (z) => zeile(z.slice(0, 600)));
      if (k !== 0) throw new Error(`${w} hat mit Fehler ${k} aufgehört.`);
    }
    // 6. Gelände & Felsen für die Welt-Ansicht (eigenes Werkzeug; Fehler hier lassen die Modelle gelten)
    let welt = '';
    try { j.von = 10; await this.weltDatenErzeugen(j, zeile, schritt, 6); welt = ' Gelände und Felsen für die Welt-Ansicht ebenfalls.'; }
    catch (e) { zeile('HINWEIS Gelände & Felsen: ' + e.message); welt = ' Gelände & Felsen fehlen noch (Einstellungen → Voraussetzungen → „Erzeugen“).'; }
    return `Fertig: ${fertig || 'Daten exportiert'} – Icons und 3D-Modelle sind in der App.${welt}`;
  }

  async ausfuehren(aktion) {
    const c = this.c;
    if (aktion === 'gelaende') { this.jobStarten('gelaende'); return { ok: true, text: 'Gelände & Felsen werden im Hintergrund erzeugt (1–2 Minuten). Danach die Welt-Ansicht neu öffnen.' }; }
    if (aktion === 'kartenbild') {
      const dir = path.join(c.DATA_DIR, 'kartenbild');
      let n = 0;
      for (const k of ['Map_0-0', 'Map_0-1', 'Map_1-0', 'Map_1-1']) n += await laden(QUELLEN.kachel(k), path.join(dir, k + '.png'));
      return { ok: true, text: `Kartenbild geladen (${(n / 1e6).toFixed(1)} MB, © Coffee Stain Studios, Stand Spielversion 0.6 – für den aktuellen Stand per FModel ersetzen)` };
    }
    if (aktion === 'dotnet') {
      if (process.platform !== 'win32') throw new Error('Nur unter Windows.');
      if (await dotnetDa()) return { ok: true, text: '.NET-Desktop-Laufzeit ist schon installiert.' };
      c.log('Installiere .NET-Desktop-Laufzeit 10 …');
      const r = await lauf('winget', ['install', '--id', 'Microsoft.DotNet.DesktopRuntime.10', '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements']);
      if (!(await dotnetDa())) throw new Error('Installation nicht bestätigt – bitte von ' + QUELLEN.dotnet + ' die „.NET Desktop Runtime 10“ (x64) installieren. ' + r.out.slice(-200));
      return { ok: true, text: '.NET-Desktop-Laufzeit 10 installiert.' };
    }
    if (aktion === 'fmodel') {
      const dir = c.fmodelDir();
      const zip = path.join(dir, 'FModel.zip');
      c.log('Lade FModel …');
      let n;
      try { n = await laden(QUELLEN.fmodelZip, zip); }
      catch {
        const j = await (await fetch(QUELLEN.fmodelApi, { headers: { 'User-Agent': 'BlueprintStudio' } })).json();
        const a = (j.assets || []).find((x) => /\.zip$/i.test(x.name));
        if (!a) throw new Error('FModel-Download nicht gefunden – bitte von ' + QUELLEN.fmodel + ' laden und nach ' + dir + ' entpacken.');
        n = await laden(a.browser_download_url, zip);
      }
      await entpacken(zip, dir);
      try { await fsp.unlink(zip); } catch { /* bleibt liegen */ }
      const exe = this.fmodelExe();
      if (!exe) throw new Error('Heruntergeladen, aber keine FModel.exe gefunden.');
      return { ok: true, text: `FModel installiert (${(n / 1e6).toFixed(1)} MB): ${exe}` };
    }
    if (aktion === 'fmodelStarten') {
      const exe = this.fmodelExe();
      if (!exe) throw new Error('FModel ist noch nicht installiert.');
      spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore' }).unref();
      return { ok: true, text: 'FModel gestartet.' };
    }
    if (aktion === 'uebernehmen') {
      const exp = c.fmodelExport();
      if (!fs.existsSync(exp)) throw new Error(`Export-Ordner nicht gefunden: ${exp} – zuerst in FModel exportieren.`);
      const ausgabe = [];
      for (const w of ['icons-uebernehmen.mjs', 'modelle-aufbereiten.mjs']) {
        const r = await lauf(process.execPath, [path.join(c.ROOT, 'werkzeuge', w), exp], { cwd: c.ROOT });
        ausgabe.push(`== ${w} (Code ${r.code})`, r.out.trim().split(/\r?\n/).slice(-14).join('\n'));
      }
      return { ok: true, text: 'Icons und 3D-Modelle übernommen – Ausgabe siehe unten.', ausgabe: ausgabe.join('\n') };
    }
    if (aktion === 'teilelimitAn' || aktion === 'teilelimitAus') {
      const an = aktion === 'teilelimitAn', sich = this.teileLimitAendern(an ? TEILELIMIT_WIKI : null);
      c.log(`Teile-Limit ${an ? 'angehoben' : 'zurückgesetzt'} (Sicherung ${sich})`);
      return { ok: true, text: an ? `Teile-Limit auf ${TEILELIMIT_WIKI.toLocaleString('de-DE')} angehoben – wirkt beim nächsten Spielstart. Alte Engine.ini gesichert.` : 'Teile-Limit auf Spiel-Standard zurückgesetzt – wirkt beim nächsten Spielstart. Alte Engine.ini gesichert.' };
    }
    if (aktion === 'verknuepfung') {
      if (process.platform !== 'win32') throw new Error('Nur unter Windows.');
      const r = await lauf('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(c.APP_DIR, 'create-shortcut.ps1')]);
      if (r.code !== 0) throw new Error('Verknüpfung konnte nicht angelegt werden: ' + r.out.slice(-300));
      return { ok: true, text: 'Verknüpfung auf dem Desktop und im Startmenü angelegt.' };
    }
    throw Object.assign(new Error('Unbekannte Aktion'), { status: 400 });
  }
}
