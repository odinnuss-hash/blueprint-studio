// Formen-Generator: erzeugt Bauteil-Listen ({ cls, pos:[x,y,z], rot:[x,y,z,w] }) fuer typische Formen.
// Masse in cm (Unreal). Rasterweite = Kantenlaenge des gewaehlten Fundaments (meist 8 m).
// Reine Funktionen ohne Bildschirm-Zugriff – laufen im Browser und in Node.

export const quatYaw = (deg) => { const a = deg * Math.PI / 360; return [0, 0, Math.sin(a), Math.cos(a)]; };
const r1 = (v) => Math.round(v * 10) / 10;
const P = (x, y, z) => [r1(x), r1(y), r1(z)];

// Winkelschritte, die 360° glatt teilen (Vielfache von 5° wie im Spiel beim Drehen mit Mausrad)
const STEPS = [5, 10, 15, 20, 30, 40, 45, 60, 72, 90, 120];
function ringStep(radius, tile) {
  const need = 2 * Math.PI * (radius + tile / 2) / tile; // Teile, damit die Aussenkante geschlossen ist
  const max = 360 / need;
  let st = STEPS[0];
  for (const s of STEPS) if (s <= max) st = s;
  return st;
}

function tileSize(box, fallback = 800) {
  if (!box) return { w: fallback, d: fallback, h: 100, zOff: 0 };
  return { w: box[3] - box[0], d: box[4] - box[1], h: box[5] - box[2], zTop: box[5] };
}

// ---------------------------------------------------------------- Formen
export const FORMEN = {
  rundplatte: {
    name: 'Rundplatte (Ringe wie im Spiel)',
    params: [
      { k: 'durchmesser', label: 'Durchmesser (Fundamente)', typ: 'zahl', min: 3, max: 61, std: 21 },
      { k: 'boden', label: 'Bodenteil', typ: 'teil', filter: 'boden', std: 'Build_Foundation_Concrete_8x1_C' },
      { k: 'mitte', label: 'Mittelstück', typ: 'janein', std: true },
    ],
  },
  rasterkreis: {
    name: 'Kreis im Raster (gestuft)',
    params: [
      { k: 'durchmesser', label: 'Durchmesser (Fundamente)', typ: 'zahl', min: 2, max: 80, std: 15 },
      { k: 'boden', label: 'Bodenteil', typ: 'teil', filter: 'boden', std: 'Build_Foundation_Concrete_8x1_C' },
    ],
  },
  ring: {
    name: 'Ring / Kreisbahn',
    params: [
      { k: 'durchmesser', label: 'Außendurchmesser (Fundamente)', typ: 'zahl', min: 5, max: 81, std: 25 },
      { k: 'breite', label: 'Breite (Fundamente)', typ: 'zahl', min: 1, max: 20, std: 2 },
      { k: 'boden', label: 'Bodenteil', typ: 'teil', filter: 'boden', std: 'Build_Foundation_Asphalt_8x1_C' },
    ],
  },
  flaeche: {
    name: 'Rechteckige Fläche',
    params: [
      { k: 'breite', label: 'Breite (Fundamente)', typ: 'zahl', min: 1, max: 100, std: 10 },
      { k: 'laenge', label: 'Länge (Fundamente)', typ: 'zahl', min: 1, max: 100, std: 6 },
      { k: 'boden', label: 'Bodenteil', typ: 'teil', filter: 'boden', std: 'Build_Foundation_Concrete_8x1_C' },
    ],
  },
  gebaeude: {
    name: 'Gebäude (rechteckig, mehrstöckig)',
    params: [
      { k: 'breite', label: 'Breite (Fundamente)', typ: 'zahl', min: 1, max: 40, std: 6 },
      { k: 'laenge', label: 'Länge (Fundamente)', typ: 'zahl', min: 1, max: 40, std: 4 },
      { k: 'etagen', label: 'Etagen', typ: 'zahl', min: 1, max: 20, std: 2 },
      { k: 'hoehe', label: 'Etagenhöhe (Wandreihen à 4 m)', typ: 'zahl', min: 1, max: 6, std: 2 },
      { k: 'boden', label: 'Boden / Decke', typ: 'teil', filter: 'boden', std: 'Build_Foundation_ConcretePolished_8x1_C' },
      { k: 'wand', label: 'Wand', typ: 'teil', filter: 'wand', std: 'Build_Wall_Concrete_8x4_C' },
      { k: 'fenster', label: 'Obere Wandreihe', typ: 'teil', filter: 'wand', std: 'Build_Wall_Concrete_8x4_Window_02_C', leer: 'wie Wand' },
      { k: 'dach', label: 'Dach', typ: 'teil', filter: 'dach', std: 'Build_Roof_Tar_01_C', leer: 'kein Dach' },
    ],
  },
  rundturm: {
    name: 'Rundturm / Rundhaus',
    params: [
      { k: 'durchmesser', label: 'Durchmesser (Fundamente)', typ: 'zahl', min: 3, max: 41, std: 9 },
      { k: 'etagen', label: 'Etagen', typ: 'zahl', min: 1, max: 20, std: 3 },
      { k: 'hoehe', label: 'Etagenhöhe (Wandreihen à 4 m)', typ: 'zahl', min: 1, max: 6, std: 2 },
      { k: 'boden', label: 'Boden / Decke', typ: 'teil', filter: 'boden', std: 'Build_Foundation_Concrete_8x1_C' },
      { k: 'wand', label: 'Wand', typ: 'teil', filter: 'wand', std: 'Build_Wall_Concrete_8x4_C' },
      { k: 'fenster', label: 'Obere Wandreihe', typ: 'teil', filter: 'wand', std: 'Build_Wall_Window_Thin_8x4_01_C', leer: 'wie Wand' },
      { k: 'deckel', label: 'Oberste Decke', typ: 'janein', std: true },
    ],
  },
  // Grundriss: Bild im Browser auf ein 8-m-Raster gelegt (main.js grundrissPlan) → p.plan; Gebäude daraus hier
  grundriss: {
    name: 'Gebäude aus Grundriss (Bild)',
    params: [
      { k: 'bild', label: 'Grundriss-Bild', typ: 'bild' },
      { k: 'breite', label: 'Breite (Fundamente)', typ: 'zahl', min: 2, max: 60, std: 8 },
      { k: 'etagen', label: 'Etagen', typ: 'zahl', min: 1, max: 20, std: 1 },
      { k: 'hoehe', label: 'Etagenhöhe (Wandreihen à 4 m)', typ: 'zahl', min: 1, max: 6, std: 1 },
      { k: 'boden', label: 'Boden / Decke', typ: 'teil', filter: 'boden', std: 'Build_Foundation_ConcretePolished_8x1_C' },
      { k: 'wand', label: 'Wand (schwarz)', typ: 'teil', filter: 'wand', std: 'Build_Wall_Concrete_8x4_C' },
      { k: 'fenster', label: 'Fenster (blau)', typ: 'teil', filter: 'wand', std: 'Build_Wall_Concrete_8x4_Window_02_C' },
      { k: 'tuer', label: 'Tür (rot)', typ: 'teil', filter: 'tuer', std: 'Build_Wall_Concrete_CDoor_8x4_C' },
      { k: 'dach', label: 'Dach', typ: 'teil', filter: 'dach', std: 'Build_Roof_Tar_01_C', leer: 'kein Dach' },
    ],
  },
  // Pixel-Art: Bild wird im Browser verkleinert, je Pixel ein quadratisches Schild (Server: lib/pixelbild.mjs)
  pixelbild: {
    name: 'Pixel-Art aus Bild',
    server: 'pixel',
    params: [
      { k: 'bild', label: 'Bild', typ: 'bild' },
      { k: 'breite', label: 'Breite (Pixel)', typ: 'zahl', min: 4, max: 200, std: 48 },
      { k: 'groesse', label: 'Pixelgröße', typ: 'wahl', std: 'tiny', optionen: [['tiny', '0,5 m (kleines Schild)'], ['small', '1 m'], ['square', '2 m']] },
      { k: 'lage', label: 'Lage', typ: 'wahl', std: 'wand', optionen: [['wand', 'Wand (senkrecht)'], ['boden', 'Boden (liegend)']] },
      { k: 'leuchten', label: 'Leuchtend', typ: 'janein', std: false },
      { k: 'transparent', label: 'Transparente Pixel weglassen', typ: 'janein', std: true },
    ],
  },
};

// Kreisflaeche aus Ringen (Bauweise wie „Rundplatte22x22“: Ringe im Fundamentabstand, tangential gedreht, 5°-Raster)
function polarDisc(cls, box, radiusTiles, z, withCenter, innerTiles = 0) {
  const t = tileSize(box), s = t.w, out = [];
  if (withCenter && innerTiles === 0) out.push({ cls, pos: P(0, 0, z), rot: quatYaw(0) });
  const kMax = Math.floor(radiusTiles);
  for (let k = Math.max(1, innerTiles); k <= kMax; k++) {
    const r = k * s, step = ringStep(r, s);
    for (let a = 0; a < 360; a += step) {
      const rad = a * Math.PI / 180;
      out.push({ cls, pos: P(Math.cos(rad) * r, Math.sin(rad) * r, z), rot: quatYaw(a) });
    }
  }
  return out;
}

function rectFloor(cls, box, w, l, z) {
  const t = tileSize(box), out = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < l; j++)
    out.push({ cls, pos: P((i - (w - 1) / 2) * t.w, (j - (l - 1) / 2) * t.d, z), rot: quatYaw(0) });
  return out;
}

export function generate(form, p, kat) {
  if (FORMEN[form]?.server) return []; // entsteht auf dem Server
  const box = (cls) => kat?.gebaeude?.[cls]?.box || null;
  const top = (cls) => { const b = box(cls); return b ? b[5] : 50; }; // Oberkante relativ zum Drehpunkt
  const wallBase = (cls) => { const b = box(cls); return b ? -b[2] : 0; }; // Unterkante liegt auf dem Boden (Drehpunkt unten -> 0)
  const objs = [];
  if (form === 'rundplatte') {
    objs.push(...polarDisc(p.boden, box(p.boden), (p.durchmesser - 1) / 2, -top(p.boden), p.mitte));
  } else if (form === 'ring') {
    const R = (p.durchmesser - 1) / 2;
    objs.push(...polarDisc(p.boden, box(p.boden), R, -top(p.boden), false, Math.max(1, Math.round(R - p.breite + 1))));
  } else if (form === 'rasterkreis') {
    const s = tileSize(box(p.boden)).w, R = p.durchmesser / 2, n = p.durchmesser;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = (i - (n - 1) / 2), y = (j - (n - 1) / 2);
      if (Math.hypot(x, y) <= R - 0.25) objs.push({ cls: p.boden, pos: P(x * s, y * s, -top(p.boden)), rot: quatYaw(0) });
    }
  } else if (form === 'flaeche') {
    objs.push(...rectFloor(p.boden, box(p.boden), p.breite, p.laenge, -top(p.boden)));
  } else if (form === 'gebaeude') {
    const t = tileSize(box(p.boden)), W = p.breite * t.w, L = p.laenge * t.d, fh = p.hoehe * 400;
    for (let e = 0; e <= p.etagen; e++) {
      const zf = e * fh;
      if (e < p.etagen) objs.push(...rectFloor(p.boden, box(p.boden), p.breite, p.laenge, zf - top(p.boden)));
      else if (p.dach) objs.push(...rectFloor(p.dach, box(p.dach), p.breite, p.laenge, zf - (box(p.dach) ? box(p.dach)[2] : 0)));
      if (e === p.etagen) break;
      for (let row = 0; row < p.hoehe; row++) {
        const wcls = row === p.hoehe - 1 && p.fenster ? p.fenster : p.wand, zc = zf + row * 400 + wallBase(wcls);
        for (let i = 0; i < p.breite; i++) {
          const x = (i - (p.breite - 1) / 2) * t.w;
          objs.push({ cls: wcls, pos: P(x, -L / 2, zc), rot: quatYaw(-90) }, { cls: wcls, pos: P(x, L / 2, zc), rot: quatYaw(90) });
        }
        for (let j = 0; j < p.laenge; j++) {
          const y = (j - (p.laenge - 1) / 2) * t.d;
          objs.push({ cls: wcls, pos: P(-W / 2, y, zc), rot: quatYaw(180) }, { cls: wcls, pos: P(W / 2, y, zc), rot: quatYaw(0) });
        }
      }
    }
  } else if (form === 'grundriss') {
    // plan = { n, m, kanten: { 'h,i,j' | 'v,i,j': 'W'|'F'|'T' }, innen: Set('i,j') } – Zelle (i, j): Spalte i, Zeile j von oben.
    // Lage wie die im Spiel geprüfte Boden-Pixel-Art: Spalten nach −X, oben im Bild = +Y (lesbar mit Blick nach +Y).
    const plan = p.plan; if (!plan) return objs;
    const s = tileSize(box(p.boden)).w, fh = p.hoehe * 400;
    const X = (i) => -(i - (plan.n - 1) / 2) * s, Y = (j) => -(j - (plan.m - 1) / 2) * s;
    const innen = (i, j) => plan.innen.has(`${i},${j}`);
    for (let e = 0; e <= p.etagen; e++) {
      const zf = e * fh;
      for (const k of plan.innen) {
        const [i, j] = k.split(',').map(Number);
        if (e < p.etagen) objs.push({ cls: p.boden, pos: P(X(i), Y(j), zf - top(p.boden)), rot: quatYaw(0) });
        else if (p.dach) objs.push({ cls: p.dach, pos: P(X(i), Y(j), zf - (box(p.dach) ? box(p.dach)[2] : 0)), rot: quatYaw(0) });
      }
      if (e === p.etagen) break;
      for (const [k, art] of Object.entries(plan.kanten)) {
        const [r, i, j] = k.split(','); const a = +i, b = +j;
        // Lage und Drehung: Vorderseite nach außen (wie beim Gebäude-Generator)
        const [x, y, yaw] = r === 'h'
          ? [X(a), (Y(b - 1) + Y(b)) / 2, innen(a, b - 1) && !innen(a, b) ? -90 : 90]
          : [(X(a - 1) + X(a)) / 2, Y(b), innen(a - 1, b) && !innen(a, b) ? 180 : 0];
        for (let row = 0; row < p.hoehe; row++) {
          const cls = row === 0 && art === 'F' ? p.fenster : row === 0 && art === 'T' ? p.tuer : p.wand;
          objs.push({ cls, pos: P(x, y, zf + row * 400 + wallBase(cls)), rot: quatYaw(yaw) });
        }
      }
    }
  } else if (form === 'rundturm') {
    const s = tileSize(box(p.boden)).w, R = (p.durchmesser - 1) / 2, fh = p.hoehe * 400;
    const wallR = R * s + s / 2; // Wand an der Aussenkante des aeussersten Rings
    const n = Math.max(6, Math.ceil(2 * Math.PI * wallR / 800));
    const step = 360 / n;
    for (let e = 0; e <= p.etagen; e++) {
      const zf = e * fh;
      if (e < p.etagen || p.deckel) objs.push(...polarDisc(p.boden, box(p.boden), R, zf - top(p.boden), true));
      if (e === p.etagen) break;
      for (let row = 0; row < p.hoehe; row++) {
        const wcls = row === p.hoehe - 1 && p.fenster ? p.fenster : p.wand, zc = zf + row * 400 + wallBase(wcls);
        for (let k = 0; k < n; k++) {
          const a = k * step, rad = a * Math.PI / 180;
          objs.push({ cls: wcls, pos: P(Math.cos(rad) * wallR, Math.sin(rad) * wallR, zc), rot: quatYaw(a) });
        }
      }
    }
  }
  return objs;
}

// ---------------------------------------------------------------- Teile-Auswahl
const MAT = [['ConcretePolished', 'Beton poliert'], ['Concrete', 'Beton'], ['Asphalt', 'Asphalt'], ['Metal', 'Riffelblech'], ['Glass', 'Glas'],
  ['Orange', 'FICSIT'], ['Tar', 'Teerpappe'], ['Steel', 'Stahl'], ['Copper', 'Kupfer'], ['Grip', 'Riffel'], ['Frame', 'Rahmen'], ['Window_Thin', 'Vollglas'],
  ['Window', 'Fenster'], ['Gate', 'Tor'], ['Door', 'Tür'], ['8x4_01', 'Standard'], ['8x4_02', 'Standard 2']];
export function material(cls) {
  for (const [k, n] of MAT) if (cls.includes(k)) return n;
  return '';
}
export function teilLabel(kat, cls) {
  const g = kat.gebaeude[cls]; if (!g) return cls;
  const m = material(cls);
  return m && !g.name.toLowerCase().includes(m.toLowerCase()) ? `${g.name} · ${m}` : g.name;
}
export function teileFuer(filter, kat, avail) {
  const ok = (cls) => avail[cls];
  const list = Object.entries(kat.gebaeude).filter(([cls, g]) => {
    if (!ok(cls) || !g.box) return false;
    const w = g.box[3] - g.box[0], d = g.box[4] - g.box[1], h = g.box[5] - g.box[2];
    if (filter === 'boden') return (g.unterkategorie === 'Fundamente' || /Glass|Frame/.test(cls) && g.unterkategorie === 'Rahmen') && Math.abs(w - 800) < 2 && Math.abs(d - 800) < 2;
    if (filter === 'wand') return /Wände|Fenster|Fensterrahmen/.test(g.unterkategorie) && Math.abs(d - 800) < 2 && Math.abs(h - 400) < 2 && w <= 100;
    if (filter === 'tuer') return /Türen/.test(g.unterkategorie) && !/BigGarage/.test(cls) && Math.abs(d - 800) < 2 && Math.abs(h - 400) < 2 && w <= 100;
    if (filter === 'dach') return (g.unterkategorie === 'Dächer' && Math.abs(w - 800) < 2 && Math.abs(d - 800) < 2 && h <= 60 && !/Corner|Ramp|Curved|Sloped|In_|Out_/.test(cls)) || (g.unterkategorie === 'Fundamente' && h <= 100 && Math.abs(w - 800) < 2);
    return false;
  });
  return list.map(([cls]) => cls).sort((a, b) => teilLabel(kat, a).localeCompare(teilLabel(kat, b), 'de'));
}

/** Tauschbare Varianten: gleiche Unterkategorie (bzw. Boden<->Glas/Rahmen) und gleiche Masse. */
export function tauschVarianten(cls, kat, avail) {
  const g = kat.gebaeude[cls]; if (!g || !g.box) return [];
  const same = (b) => b && b.every((v, k) => Math.abs(v - g.box[k]) < 3);
  const famOk = (h) => h.unterkategorie === g.unterkategorie || (h.kategorie === g.kategorie && /Fundamente|Rahmen/.test(h.unterkategorie) && /Fundamente|Rahmen/.test(g.unterkategorie)) ||
    (/Wände|Fenster|Fensterrahmen|Förderband-Wanddurchlässe|Türen/.test(h.unterkategorie) && /Wände|Fenster|Fensterrahmen|Förderband-Wanddurchlässe|Türen/.test(g.unterkategorie));
  return Object.entries(kat.gebaeude).filter(([c, h]) => c !== cls && avail[c] && famOk(h) && same(h.box)).map(([c]) => c)
    .sort((a, b) => teilLabel(kat, a).localeCompare(teilLabel(kat, b), 'de'));
}
