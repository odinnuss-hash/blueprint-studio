// Höhenabhängige Bauteile wie im Spiel zusammensetzen – genutzt von der Welt-Ansicht (welt3d.js) und der 3D-Ansicht des Editors
// (view3dgl.js). Teile kommen aus modelle/index.json (werkzeuge/modelle-aufbereiten.mjs: „lifte“, „stuetzen“).
//   Lift: Unterteil am Anschluss, Mittelstücke im Teilhöhen-Raster (Rest mit halbem Stück), Oberteil bei Höhe p (p < 0: nach unten).
//   Stütze/Mast: p = (Variante + 1) · 100 000 + Höhe; Stange von 0 bis Höhe (mit Kopf: bis Höhe − 100, Kopf darüber), passend gestreckt.
// Gemessen 21.10.2026: Rohrstütze −328 + mHeight 175 = Rohr −153 (Durchflussanzeige); Stange _01 0…74 cm = Höhe − 100.

/** Teile-Liste [[Mesh, Lage, Drehung, Skalierung], …] oder null, wenn das Bauteil nicht höhenabhängig ist */
export function teileDynamisch(index, cls, p) {
  if (!index) return null;
  const E = [0, 0, 0, 1], S1 = [1, 1, 1], L = index.lifte?.[cls];
  if (L) {
    const h = Math.abs(p) >= 50 ? p : 400, lo = Math.min(0, h), hi = Math.max(0, h), teile = [[L.unten, [0, 0, lo], E, S1], [L.oben, [0, 0, hi], E, S1]];
    let z = lo + L.teilhoehe; const ende = hi - 100;
    for (; z + L.teilhoehe <= ende + 1; z += L.teilhoehe) teile.push([L.mitte, [0, 0, z], E, S1]);
    if (L.halb && ende - z > 20) teile.push([L.halb, [0, 0, z], E, S1]);
    return teile;
  }
  const D = index.durchfuehrungen?.[cls];
  if (D) {
    // Boden-Durchführung: p = Fundamentdicke (mSnappedBuildingThickness), Ursprung in der Mitte des Fundaments
    const t = p > 1 ? p : 200, [vx, vy] = D.versatz || [0, 0], q = D.drehDeckel, [x, y, z, w] = q;
    const unten = [w, -z, y, -x]; // um 180° um X gekippt (Deckel zeigt nach unten)
    const teile = [[D.deckel, [vx, vy, t / 2], q, S1], [D.deckel, [vx, vy, -t / 2], unten, S1]];
    if (D.mitte) {
      // Längsachse des Mittelteils = die Achse, die nach der Drehung senkrecht steht
      const m = D.drehMitte, achse = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].findIndex((a) => Math.abs(drehe(m, a)[2]) > 0.9);
      const s = [1, 1, 1]; if (achse >= 0) s[achse] = t / (D.laenge || 100);
      teile.push([D.mitte, [0, 0, -t / 2], m, s]);
    }
    return teile;
  }
  const T = index.stuetzen?.[cls];
  if (T) {
    const nr = p >= 100000 ? Math.floor(p / 100000) - 1 : -1, hoehe = (p % 100000) || T.stangen[0][1];
    const v = T.stangen[nr] || T.stangen.find((x) => x[1] >= hoehe - 1) || T.stangen.at(-1);
    const kopfAb = T.kopf ? 100 : 0, soll = Math.max(1, hoehe - kopfAb), mm = index.meshes[v[0]], ist = mm ? mm.max[2] - Math.min(0, mm.min[2]) : soll;
    const teile = [[v[0], v[2] || [0, 0, 0], E, [1, 1, ist > 1 ? soll / ist : 1]]];
    if (T.kopf) teile.push([T.kopf[0], [T.kopf[1][0], T.kopf[1][1], hoehe + T.kopf[1][2]], E, S1]);
    return teile;
  }
  return null;
}

function drehe(q, v) {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
