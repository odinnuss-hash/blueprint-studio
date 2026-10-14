// Einrichtung: Voraussetzungen pruefen und fehlende Teile (soweit erlaubt) automatisch installieren.
//
// Automatisch:  3D-Editor „Satisfactory 3D Map“ (GitHub-Release, GPL-3.0, eigenstaendiges Programm),
//               Kartenbild (Kacheln aus dem satisfactory-3d-map-Repository), Desktop-Verknuepfung.
// 3D-Modelle und Icons: automatisch mit dem eigenen Extraktor (werkzeuge\extraktor, baut sich beim ersten Mal
//               selbst mit dem .NET-10-SDK und CUE4Parse) oder angeleitet per FModel – immer aus der eigenen
//               Spielinstallation, Spielinhalte von Coffee Stain duerfen nicht mitgeliefert werden.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

export const QUELLEN = {
  editor3d: 'https://github.com/moritz-h/satisfactory-3d-map/releases/latest/download/Satisfactory3DMap-Windows.zip',
  editor3dSeite: 'https://github.com/moritz-h/satisfactory-3d-map/releases',
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
  /** ctx: { ROOT, APP_DIR, PUBLIC_DIR, DATA_DIR, settings, docsFile, getKatalog, bpRoot, finde3d, kartenKachel, browserExe, log } */
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
    const e3 = c.finde3d();
    add('editor3d', '3D-Editor „Satisfactory 3D Map“', e3 ? 'ok' : 'warnung', e3 || 'nicht installiert – „In 3D öffnen“ geht erst danach', { aktion: e3 ? 'editor3d' : 'editor3d', aktionText: e3 ? 'Aktualisieren' : 'Installieren', link: QUELLEN.editor3dSeite });
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
    if (art !== 'automatisch') throw Object.assign(new Error('Unbekannter Vorgang'), { status: 400 });
    const j = this.job = { art, laeuft: true, ok: null, schritt: 'Start …', nr: 0, von: 5, fortschritt: null, text: '', log: [], start: Date.now(), ende: null };
    const zeile = (z) => { j.log.push(z); if (j.log.length > 600) j.log.splice(0, j.log.length - 600); };
    this.automatisch(j, zeile)
      .then((t) => { j.ok = true; j.text = t; })
      .catch((e) => { j.ok = false; j.text = e.message; zeile('FEHLER ' + e.message); this.c.log('Automatische Modelle: ' + e.message); })
      .finally(() => { j.laeuft = false; j.ende = Date.now(); j.fortschritt = null; });
    return this.jobStatus();
  }

  async automatisch(j, zeile) {
    const c = this.c, dir = this.extraktorDir();
    const schritt = (nr, t) => { j.nr = nr; j.schritt = t; j.fortschritt = null; zeile(`== ${t}`); };
    if (!c.settings.gameDir || !fs.existsSync(path.join(c.settings.gameDir, 'FactoryGame', 'Content', 'Paks'))) throw new Error('Satisfactory-Installationsordner fehlt oder stimmt nicht (Einstellungen bzw. Schritt „Ordner“).');
    if (!fs.existsSync(path.join(dir, 'BsExtraktor.csproj'))) throw new Error('werkzeuge\\extraktor fehlt – bitte die App vollständig (neu) herunterladen.');
    const env = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', CUE4PARSE_SKIP_NATIVE: 'true' };

    // 1. .NET-SDK
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
    return `Fertig: ${fertig || 'Daten exportiert'} – Icons und 3D-Modelle sind in der App.`;
  }

  async ausfuehren(aktion) {
    const c = this.c;
    if (aktion === 'editor3d') {
      const dir = path.join(c.ROOT, 'werkzeuge', 'Satisfactory3DMap');
      const zip = path.join(dir, 'Satisfactory3DMap-Windows.zip');
      c.log('Lade 3D-Editor …');
      const n = await laden(QUELLEN.editor3d, zip);
      await entpacken(zip, dir);
      try { await fsp.unlink(zip); } catch { /* bleibt liegen */ }
      const exe = c.finde3d();
      if (!exe) throw new Error('Heruntergeladen, aber keine Satisfactory3DMap*.exe gefunden.');
      c.log(`3D-Editor installiert: ${exe} (${(n / 1e6).toFixed(1)} MB)`);
      return { ok: true, text: `3D-Editor installiert (${(n / 1e6).toFixed(1)} MB): ${exe}` };
    }
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
    if (aktion === 'verknuepfung') {
      if (process.platform !== 'win32') throw new Error('Nur unter Windows.');
      const r = await lauf('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(c.APP_DIR, 'create-shortcut.ps1')]);
      if (r.code !== 0) throw new Error('Verknüpfung konnte nicht angelegt werden: ' + r.out.slice(-300));
      return { ok: true, text: 'Verknüpfung auf dem Desktop und im Startmenü angelegt.' };
    }
    throw Object.assign(new Error('Unbekannte Aktion'), { status: 400 });
  }
}
