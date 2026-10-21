// In welchen Spielstand gehören die Bauplan-Kategorien? In den, mit dem gespielt wird – nicht einfach in den neuesten.
// Das Spielprotokoll (Saved\Logs\FactoryGame*.log) enthält bei jedem Laden „…?loadgame=<Name>“ (Zeitstempel in UTC).
// Regel: zuletzt geladener Stand der Sitzung bzw. ein danach vom Spiel gespeicherter neuerer Stand derselben Sitzung;
// Stände, die die App selbst angelegt hat (Welt-Ansicht), zählen nur, wenn genau dieser zuletzt geladen wurde.
import fs from 'node:fs';
import path from 'node:path';

/** zuletzt im Spiel geladener Spielstand: { name, zeit (ms) } oder null */
export function zuletztGeladen(logsDir) {
  let dateien = [];
  try { dateien = fs.readdirSync(logsDir).filter((f) => /^FactoryGame.*\.log$/i.test(f)).map((f) => path.join(logsDir, f)); } catch { return null; }
  dateien.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const f of dateien.slice(0, 8)) {
    let t; try { t = fs.readFileSync(f, 'latin1'); } catch { continue; }
    let letzter = null;
    for (const m of t.matchAll(/^\[(\d{4})\.(\d\d)\.(\d\d)-(\d\d)\.(\d\d)\.(\d\d):(\d{3})\][^\n]*?[?&]loadgame=([^?&\s"]+)/gim)) letzter = m;
    if (letzter) { const [, J, M, T, h, mi, s, ms, name] = letzter; return { name: decodeURIComponent(name), zeit: Date.UTC(+J, +M - 1, +T, +h, +mi, +s, +ms) }; }
  }
  return null;
}

/** staende: Spielstände der Sitzung, neueste zuerst ({ name, geaendert }); appStaende: Namen, die die App angelegt hat */
export function zielWaehlen(staende, geladen, appStaende = new Set()) {
  if (!staende.length) return null;
  const vomSpiel = (s) => !appStaende.has(s.name);
  if (geladen && staende.some((s) => s.name === geladen.name)) {
    const kandidaten = staende.filter((s) => s.name === geladen.name || (s.geaendert > geladen.zeit && vomSpiel(s)));
    return { stand: kandidaten[0], grund: kandidaten[0].name === geladen.name ? 'zuletzt im Spiel geladen' : `nach „${geladen.name}“ zuletzt vom Spiel gespeichert` };
  }
  const s = staende.find(vomSpiel) || staende[0];
  return { stand: s, grund: 'neuester Spielstand der Sitzung' };
}
