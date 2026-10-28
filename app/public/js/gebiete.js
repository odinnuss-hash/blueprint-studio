// Biome/Gebiete der Spielwelt für die Kompass-Anzeige der Welt-Ansicht.
// Grundlage: modelle/gebiete.json aus werkzeuge/modelle-aufbereiten.mjs (Gebietskarte aus der eigenen Spielinstallation,
// wird nicht mit der App verteilt). Aufbau: { x0, y0, zelle (cm je Feld), breite, hoehe (Felder), namen: [...],
// daten: Base64, je Feld ein Byte (rle: 1 → Paare Wert/Anzahl): 0 = kein Gebiet, n = namen[n − 1] }; namen: { de, en } oder Text.
let karte = null, laden = null;

function holen() {
  if (laden) return;
  laden = fetch('modelle/gebiete.json').then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (!j?.daten || !j.namen?.length) return;
    const bin = atob(j.daten);
    let d;
    if (j.rle) { // Paare (Wert, Anzahl)
      d = new Uint8Array(j.breite * j.hoehe); let o = 0;
      for (let i = 0; i + 1 < bin.length; i += 2) { const w = bin.charCodeAt(i), n = bin.charCodeAt(i + 1); d.fill(w, o, o + n); o += n; }
    } else { d = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) d[i] = bin.charCodeAt(i); }
    const en = !/^de/i.test(document.documentElement.lang || 'de');
    karte = { ...j, d, namen: j.namen.map((n) => (typeof n === 'string' ? n : en ? n.en : n.de)) };
  }).catch(() => { /* ohne Gebietskarte: keine Anzeige */ });
}

/** Name des Gebiets an (x, y) in Spielkoordinaten (cm) – null, wenn unbekannt */
export function gebietAn(x, y) {
  if (!karte) { holen(); return null; }
  const k = karte, i = Math.floor((x - k.x0) / k.zelle), j = Math.floor((y - k.y0) / k.zelle);
  if (i < 0 || j < 0 || i >= k.breite || j >= k.hoehe) return null;
  const n = k.d[j * k.breite + i];
  return n ? k.namen[n - 1] : null;
}
