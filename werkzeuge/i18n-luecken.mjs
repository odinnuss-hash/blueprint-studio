// Fehlende Übersetzungen finden: sammelt deutsche Texte aus Oberfläche (index.html, js/*.js) und Server-Meldungen, die seit
// einem Git-Stand hinzugekommen sind (Standard: letzte Version), und prüft sie mit derselben Logik wie js/i18n.js gegen
// i18n/<sprache>.json. Ausgabe: Liste der Texte ohne Übersetzung (je Sprache).
// Aufruf: node werkzeuge/i18n-luecken.mjs [<git-stand>] [--json <datei>]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stand = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'v0.9.1';
const jsonAus = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const DATEIEN = ['app/public/index.html', 'app/public/baukasten.html', ...fs.readdirSync(path.join(ROOT, 'app/public/js')).map((f) => 'app/public/js/' + f), 'app/server.mjs', ...fs.readdirSync(path.join(ROOT, 'app/lib')).map((f) => 'app/lib/' + f)];

// neue Zeilen seit <stand> (inkl. nicht committeter und neuer Dateien)
const neueZeilen = [];
for (const f of DATEIEN) {
  let diff = '';
  try { diff = execFileSync('git', ['diff', stand, '--', f], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); } catch { /* */ }
  const unbekannt = (() => { try { execFileSync('git', ['cat-file', '-e', `${stand}:${f}`], { cwd: ROOT, stdio: 'ignore' }); return false; } catch { return true; } })();
  const zeilen = unbekannt ? fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n') : diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
  for (const z of zeilen) neueZeilen.push({ f, z });
}

const DEUTSCH = /[A-Za-zÄÖÜäöüß]{3}/;
const istText = (s) => {
  const t = s.trim();
  if (t.length < 2 || !DEUTSCH.test(t)) return false;
  if (/^(\/|\.\/|#|\.|[a-z][\w-]*(\.[\w-]+)+$)/.test(t)) return false; // Pfade, Selektoren, Dateinamen
  if (/^[a-z][a-zA-Z0-9]*$/.test(t)) return false; // Bezeichner
  if (/^[a-z-]+(\s[a-z-]+)*$/.test(t) && !/[äöüß]/.test(t) && t.split(' ').every((w) => /^[a-z-]+$/.test(w)) && !/\b(und|oder|nicht|der|die|das|ein|eine|in|im|zu|von|mit|bei|nach|schon|noch|alle|keine?)\b/.test(t)) return false; // CSS-Klassen
  if (/[{}<>=;]|=>|\$\(|\bfunction\b|\bconst\b|\breturn\b/.test(t) && !/\$\{/.test(s)) return false;
  if (/^(GET|POST|utf8|latin1|utf16le|application\/json|text\/)/.test(t)) return false;
  return /[A-ZÄÖÜ]|[äöüß]|\s/.test(t);
};
const kandidaten = new Map();
const nimm = (s, f) => { const t = s.replace(/\$\{[^}]*\}/g, '7').replace(/\s+/g, ' ').trim(); if (istText(t)) kandidaten.set(t, f); };
for (const { f, z } of neueZeilen) {
  if (f.endsWith('.html')) {
    for (const m of z.matchAll(/>([^<>]+)</g)) nimm(m[1], f);
    for (const m of z.matchAll(/(?:title|placeholder|aria-label)="([^"]+)"/g)) nimm(m[1], f);
    continue;
  }
  if (/^\s*(\/\/|\*|\/\*)/.test(z)) continue; // Kommentare
  const nurMeldungen = f.startsWith('app/server') || f.startsWith('app/lib');
  if (nurMeldungen && !/Error\(|fehler:|grund:|log\(|toast|text:|titel:|hinweis:/.test(z)) continue;
  if (nurMeldungen && /\blog\(/.test(z)) continue; // Server-Log sieht nur die Konsole
  for (const m of z.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const roh = m[1] ?? m[2] ?? m[3];
    if (m[3] != null) {
      // Template: HTML-Text und Attribute darin, sonst ganzer Text
      if (/<[a-z]/i.test(roh)) { for (const x of roh.matchAll(/>([^<>]+)</g)) nimm(x[1], f); for (const x of roh.matchAll(/(?:title|placeholder|aria-label)="([^"]+)"/g)) nimm(x[1], f); }
      else nimm(roh, f);
    } else nimm(roh.replace(/\\(.)/g, '$1'), f);
  }
}

// gleiche Logik wie js/i18n.js (exakt, Muster, „ · “-Teile, Nummer vorne)
function uebersetzer(woerter) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const muster = Object.entries(woerter).filter(([k]) => /\{\d+\}/.test(k)).sort((a, b) => b[0].replace(/\{\d+\}/g, '').length - a[0].replace(/\{\d+\}/g, '').length)
    .map(([k, v]) => [new RegExp('^' + esc(k).replace(/\\\{(\d+)\\\}/g, '([\\s\\S]+?)') + '$'), v, k.includes(' · ')]);
  const t = (kern) => {
    if (Object.prototype.hasOwnProperty.call(woerter, kern)) return woerter[kern];
    const mitPunkt = kern.includes(' · ');
    for (const [re, ziel, punkt] of muster) { if (mitPunkt && !punkt) continue; if (re.test(kern)) return ziel; }
    if (kern.includes(' · ')) { const teile = kern.split(' · '); if (teile.every((x) => t(x) != null || !DEUTSCH.test(x) || /^7$/.test(x))) return 'ok'; }
    const n = /^(\d+[.)]\s+)(.+)$/.exec(kern); if (n && woerter[n[2]] != null) return 'ok';
    return null;
  };
  return t;
}
const ergebnis = {};
for (const sp of ['en', 'fr', 'ja']) {
  const w = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/public/i18n', sp + '.json'), 'utf8'));
  const t = uebersetzer(w);
  ergebnis[sp] = [...kandidaten.keys()].filter((k) => t(k) == null);
}
const alle = [...new Set(Object.values(ergebnis).flat())].sort((a, b) => a.localeCompare(b, 'de'));
console.log(`geprüft ${kandidaten.size} neue Texte seit ${stand}; fehlend: en ${ergebnis.en.length}, fr ${ergebnis.fr.length}, ja ${ergebnis.ja.length}`);
if (jsonAus) fs.writeFileSync(jsonAus, JSON.stringify(alle.map((k) => ({ de: k, datei: kandidaten.get(k), fehlt: Object.keys(ergebnis).filter((s) => ergebnis[s].includes(k)) })), null, 1));
else for (const k of alle) console.log(`${kandidaten.get(k).padEnd(28)} ${k}`);
