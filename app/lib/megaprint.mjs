// Megaprints (.cbp) von satisfactory-calculator.com lesen: zlib-gepacktes JSON
//   { saveVersion, buildVersion, data: [{ parent: { className, pathName, transform: { rotation, translation }, properties, … }, children: […] }],
//     pipes, powerCircuits, hiddenConnections, minX, maxX, minY, maxY }
// Grosse Megaprints entpacken zu mehreren hundert MB JSON – deshalb wird gestreamt und nur Klasse + Lage gelesen.

import fs from 'node:fs';
import zlib from 'node:zlib';

const RX = /"className":"([^"]+)","pathName":"([^"]*)"(?:,"objectFlags":\d+)?(?:,"needTransform":\d+)?(?:,"wasPlacedInLevel":\d+)?,"transform":\{"rotation":\[([^\]]*)\],"translation":\[([^\]]*)\]/g;
const RX_KOPF = /"saveVersion":(\d+),"buildVersion":(\d+)/;
const kurz = (p) => { const m = /\.([A-Za-z0-9_]+)$/.exec(p || ''); return m ? m[1] : (p || ''); };
const yawDeg = (q) => Math.atan2(2 * (q[3] * q[2] + q[0] * q[1]), 1 - 2 * (q[1] * q[1] + q[2] * q[2])) * 180 / Math.PI;

/** Liefert dasselbe Format wie kartenDaten() fuer Spielstaende */
export function megaprintKarte(file) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const klassen = [], kIdx = new Map();
    const ki = (c) => { let i = kIdx.get(c); if (i === undefined) { i = klassen.length; klassen.push(c); kIdx.set(c, i); } return i; };
    const werte = [];
    let rest = '', kopf = null, bytes = 0;
    const verarbeite = (txt, ende) => {
      const s = rest + txt;
      if (!kopf) { const m = RX_KOPF.exec(s.slice(0, 200)); if (m) kopf = { saveVersion: +m[1], buildVersion: +m[2] }; }
      RX.lastIndex = 0;
      let m, letzte = 0;
      while ((m = RX.exec(s))) {
        const cls = kurz(m[1]);
        if (/^Build_|^BP_/.test(cls)) {
          const q = m[3].split(',').map(Number), p = m[4].split(',').map(Number);
          if (p.length === 3 && q.length === 4) werte.push(p[0], p[1], p[2], yawDeg(q), ki(cls), m[2].startsWith('LB_') ? 1 : 0);
        }
        letzte = RX.lastIndex;
      }
      // unvollstaendigen Rest fuer den naechsten Block aufheben (max. 4 KB)
      rest = ende ? '' : s.slice(Math.max(letzte, s.length - 4096));
    };
    const z = zlib.createInflate();
    z.setEncoding('latin1');
    z.on('data', (d) => { bytes += d.length; verarbeite(d, false); });
    z.on('end', () => {
      verarbeite('', true);
      const n = werte.length / 6;
      const ord = Array.from({ length: n }, (_, i) => i).sort((a, b) => werte[a * 6 + 2] - werte[b * 6 + 2]);
      const f = new Float32Array(n * 6);
      ord.forEach((s2, i) => { for (let k = 0; k < 6; k++) f[i * 6 + k] = werte[s2 * 6 + k]; });
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < n; i++) { const x = f[i * 6], y = f[i * 6 + 1]; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      resolve({
        meta: { name: file.split(/[\\/]/).pop().replace(/\.cbp$/i, ''), sitzung: 'Megaprint', art: 'megaprint', version: kopf?.saveVersion, build: kopf?.buildVersion,
          anzahl: n, leichtbau: werte.filter((_, i) => i % 6 === 5 && werte[i]).length, klassen, linien: [], leitungen: [], spieler: [],
          grenzen: n ? [minX, minY, maxX, maxY] : null, dauer: Date.now() - t0, jsonMB: Math.round(bytes / 1e6) },
        werte: f,
      });
    });
    z.on('error', reject);
    fs.createReadStream(file).on('error', reject).pipe(z);
  });
}
