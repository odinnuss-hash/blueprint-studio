// Kartenbild (Spielwelt) aus dem FModel-Export uebernehmen.
// In FModel exportieren: FactoryGame/Content/FactoryGame/Interface/UI/Assets/MapTest/SlicedMap/Map_0-0 … Map_1-1
// (Rechtsklick -> "Save Texture" als PNG). Danach dieses Werkzeug starten (kartenbild-uebernehmen.bat).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ziel = path.join(ROOT, 'userdata', 'kartenbild');
const quellen = process.argv.slice(2).length ? process.argv.slice(2) : [
  (() => { try { const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'userdata', 'einstellungen.json'), 'utf8')); return s.fmodelExport || s.fmodel || ''; } catch { return ''; } })(),
  path.join(ROOT, 'werkzeuge', 'FModel'), path.join(process.env.USERPROFILE || '', 'Documents', 'FModel'),
];
const namen = ['Map_0-0', 'Map_0-1', 'Map_1-0', 'Map_1-1'];
const gefunden = {};
function suche(d, tiefe) {
  let l = []; try { l = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of l) {
    const p = path.join(d, e.name);
    if (e.isDirectory() && tiefe > 0) suche(p, tiefe - 1);
    else if (e.isFile()) { const m = /^(Map_[01]-[01])\.(png|jpe?g)$/i.exec(e.name); if (m && /SlicedMap/i.test(d) && !gefunden[m[1]]) gefunden[m[1]] = p; }
  }
}
for (const q of quellen) if (q && fs.existsSync(q)) suche(q, 14);
const fehlt = namen.filter((n) => !gefunden[n]);
if (fehlt.length) {
  console.log('Nicht gefunden: ' + fehlt.join(', '));
  console.log('Bitte in FModel exportieren: FactoryGame/Content/FactoryGame/Interface/UI/Assets/MapTest/SlicedMap/Map_*');
  console.log('Oder den Export-Ordner als Parameter angeben:  kartenbild-uebernehmen.bat "D:\\Pfad\\zum\\Export"');
  process.exitCode = 1;
} else {
  fs.mkdirSync(ziel, { recursive: true });
  for (const n of namen) {
    for (const ext of ['.png', '.jpg', '.jpeg']) { try { fs.renameSync(path.join(ziel, n + ext), path.join(ziel, n + ext + '.alt')); } catch { /* nicht vorhanden */ } }
    fs.copyFileSync(gefunden[n], path.join(ziel, n + path.extname(gefunden[n]).toLowerCase()));
    console.log('übernommen: ' + gefunden[n]);
  }
  console.log('Fertig. Karte in der App neu öffnen.');
}
