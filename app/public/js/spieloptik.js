// Spieloptik: Maschinen so einfärben wie im Spiel – gemeinsam für 3D-Ansicht (view3dgl.js) und Welt (welt3d.js).
//
// Grundlage (werkzeuge/modelle-aufbereiten.mjs, index.json version 2):
//   - je Modell „teile“: [ersterIndex, anzahl, art, schattenKachel]
//       art 0 = Material-Raster (MM_Factory_Array): UV0 zeigt in ein 3×3-Raster
//               (Primärlack | Verbundfarbe | dunkles Gummi / Sekundärlack | graues Metall | Kunststoff /
//                Chrom | dunkler Stahl | Lichter) – Belegung laut UV-Sheet der Satisfactory-Modding-Community
//       art 1 = Decal (Farbe + Durchsicht aus dem Decal-Atlas ColorAtlas_Alb über UV0)
//       art 2 = Glas · art 3 = sonstiges Material (Kategoriefarbe wie bisher) · art 4 = Normalen-Decal (unsichtbar)
//       art 5 = eigene Textur (MM_FactoryBaked & Co.): Grundfarbe + Maske (R Schatten, G/B Lack) als Kachel im Bauteil-Atlas, UV0
//   - UV-Block (Halbfloats: uv0.xy, uv1.xy) je Modell ab „uv“ in meshes.bin
//   - Texturen: decals.png (Decal-Atlas), schatten.png (Schatten-Kacheln, je Modell eine, Zugriff über UV1)
// Die Texturen stammen aus der eigenen Spielinstallation (Extraktor) und werden nicht mit der App verteilt.

export const SPIEL_VS = `
layout(location=8) in vec4 aUv;
out vec4 vUv;`;

// Standard-Farbmuster „FICSIT“ (Primär/Sekundär) – sRGB
export const STANDARD_LACK = { prim: [0.98, 0.58, 0.29], sek: [0.37, 0.40, 0.55] };

/** GLSL: Grundfarbe/Glanz eines Bildpunkts in der Spieloptik. art < 0 = aus (Aufrufer nimmt die bisherige Farbe). */
export const SPIEL_FS = `
uniform int uArt;
uniform vec4 uAoRect;   // Schatten-Kachel im Atlas (x, y, w, h), w = 0: keine
uniform vec3 uPrim, uSek;
uniform sampler2D tDecal, tSchatten, tBauteil, tBauteilMaske;
uniform vec4 uBtRect;   // Kachel im Bauteil-Atlas (Art 5)
in vec4 vUv;
// liefert rgb = Grundfarbe, a = Metall-/Glanzanteil; discard bei durchsichtigen Decal-Stellen
vec4 spielGrund(out float ao, out float rau) {
  ao = 1.0; rau = 0.6;
  if (uArt == 1) {
    vec4 t = texture(tDecal, vUv.xy);
    if (t.a < 0.333) discard;
    rau = 0.55;
    return vec4(t.rgb, 0.1);
  }
  if (uArt == 6) { // Förderband/-lift (vereinfacht); UV.x wählt das Material (welt3d.js BAND)
    if (vUv.x > 2.5) { rau = 0.5; return vec4(0.17, 0.17, 0.18, 0.7); }
    if (vUv.x > 1.5) { rau = 0.45; return vec4(uPrim, 0.25); }
    if (vUv.x > 0.5) { rau = 0.5; return vec4(0.5, 0.5, 0.52, 0.7); }
    rau = 0.85; return vec4(0.12, 0.12, 0.13, 0.05);
  }
  if (uArt == 7) { rau = 0.45; return vec4(0.62, 0.63, 0.65, 0.6); }   // Rohr (vereinfacht)
  if (uArt == 5) {
    vec2 t = uBtRect.xy + fract(vUv.xy) * uBtRect.zw;
    vec3 b = texture(tBauteil, t).rgb, m = texture(tBauteilMaske, t).rgb;
    ao = mix(1.0, m.r, 0.85);
    b = mix(b, uPrim, m.g); b = mix(b, uSek, m.b * (1.0 - m.g));
    rau = 0.6;
    return vec4(b, 0.15);
  }
  vec2 g = fract(vUv.xy) * 3.0;
  int k = int(floor(g.y)) * 3 + int(floor(g.x));
  vec3 b; float met = 0.0;
  if (k == 0) { b = uPrim; met = 0.25; rau = 0.45; }
  else if (k == 1) { b = vec3(0.78, 0.79, 0.80); rau = 0.5; }
  else if (k == 2) { b = vec3(0.13, 0.13, 0.14); rau = 0.85; }
  else if (k == 3) { b = uSek; met = 0.25; rau = 0.45; }
  else if (k == 4) { b = vec3(0.47, 0.47, 0.48); met = 0.7; rau = 0.55; }
  else if (k == 5) { b = vec3(0.80, 0.80, 0.81); rau = 0.4; }
  else if (k == 6) { b = vec3(0.86, 0.87, 0.89); met = 1.0; rau = 0.2; }
  else if (k == 7) { b = vec3(0.17, 0.17, 0.18); met = 0.7; rau = 0.5; }
  else {
    vec2 h = fract(g);
    b = h.y < 0.5 ? (h.x < 0.5 ? vec3(1.0, 0.82, 0.25) : (h.x < 0.75 ? vec3(1.0, 0.45, 0.1) : vec3(0.2, 1.0, 0.7)))
                  : (h.x < 0.5 ? vec3(1.0, 0.93, 0.7) : vec3(0.02));
    met = -1.0; // leuchtet
  }
  if (uAoRect.z > 0.0) ao = pow(texture(tSchatten, uAoRect.xy + fract(vUv.zw) * uAoRect.zw).r, 1.3);
  return vec4(b, met);
}
// Licht wie die übrige Ansicht, dazu Glanz nach Rauheit/Metall
vec3 spielLicht(vec4 g, float ao, float rau, vec3 n, vec3 v, vec3 L) {
  if (g.a < 0.0) return g.rgb; // Lichter
  float dif = max(dot(n, L), 0.0), hemi = 0.5 + 0.5 * n.z;
  float sp = pow(max(dot(n, normalize(L + v)), 0.0), mix(80.0, 8.0, rau)) * mix(0.05, 0.55, g.a) * (1.0 - rau * 0.6);
  vec3 c = g.rgb * ((0.30 + 0.28 * hemi) * ao + 0.52 * dif * (1.0 - g.a * 0.35) * mix(0.6, 1.0, ao));
  return c + sp * mix(vec3(1.0), g.rgb, g.a) * ao;
}`;

/** Texturen laden (decals.png, schatten.png) – null, wenn die Modelle keine Spieloptik-Daten haben */
export async function spielTexturenLaden(gl, index, basis = 'modelle/') {
  const sp = index?.spiel;
  if (!sp || index.version < 2) return null;
  const lade = async (datei, grau) => {
    if (!datei) return null;
    const r = await fetch(basis + datei); if (!r.ok) return null;
    const bild = await createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, grau ? gl.R8 : gl.RGBA8, grau ? gl.RED : gl.RGBA, gl.UNSIGNED_BYTE, bild);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    bild.close?.();
    return t;
  };
  const [decal, schatten, bt, btMaske] = await Promise.all([lade(sp.decals, false), lade(sp.schatten, true), lade(sp.bauteile?.farbe, false), lade(sp.bauteile?.maske, false)]);
  if (!decal && !schatten) return null;
  // ohne Texturen trotzdem gültige Bindungen (1×1)
  const leer = (wert) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(wert)); return t; };
  return { decal: decal || leer([0, 0, 0, 0]), schatten: schatten || leer([255, 255, 255, 255]), kachel: sp.kachel, spalten: sp.spalten || 1, zeilen: sp.zeilen || 1, mitSchatten: !!schatten,
    bauteil: bt || leer([200, 200, 200, 255]), bauteilMaske: btMaske || leer([255, 0, 0, 255]), bt: bt ? sp.bauteile : null };
}

/** Rechteck der Schatten-Kachel nr im Atlas (UV), [0,0,0,0] = keine */
export function schattenRect(tex, nr) {
  if (!tex?.mitSchatten || nr == null || nr < 0) return [0, 0, 0, 0];
  const w = 1 / tex.spalten, h = 1 / tex.zeilen;
  // halbe Pixel Rand, damit beim Filtern nichts aus der Nachbarkachel kommt
  const px = 0.5 / (tex.kachel * tex.spalten), py = 0.5 / (tex.kachel * tex.zeilen);
  return [(nr % tex.spalten) * w + px, Math.floor(nr / tex.spalten) * h + py, w - 2 * px, h - 2 * py];
}

/** Rechteck der Bauteil-Kachel nr (Art 5) */
export function bauteilRect(tex, nr) {
  const b = tex?.bt; if (!b || nr == null || nr < 0) return [0, 0, 0, 0];
  const w = 1 / b.spalten, h = 1 / b.zeilen, px = 1 / (b.kachel * b.spalten), py = 1 / (b.kachel * b.zeilen);
  return [(nr % b.spalten) * w + px, Math.floor(nr / b.spalten) * h + py, w - 2 * px, h - 2 * py];
}

/** Texturen an die Einheiten binden (ab einheit, 4 Stück) und Lackfarben setzen */
export function spielUniforms(gl, u, tex, einheit, lack = STANDARD_LACK) {
  gl.activeTexture(gl.TEXTURE0 + einheit); gl.bindTexture(gl.TEXTURE_2D, tex.decal); gl.uniform1i(u.tDecal, einheit);
  gl.activeTexture(gl.TEXTURE0 + einheit + 1); gl.bindTexture(gl.TEXTURE_2D, tex.schatten); gl.uniform1i(u.tSchatten, einheit + 1);
  gl.activeTexture(gl.TEXTURE0 + einheit + 2); gl.bindTexture(gl.TEXTURE_2D, tex.bauteil); gl.uniform1i(u.tBauteil, einheit + 2);
  gl.activeTexture(gl.TEXTURE0 + einheit + 3); gl.bindTexture(gl.TEXTURE_2D, tex.bauteilMaske); gl.uniform1i(u.tBauteilMaske, einheit + 3);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform3fv(u.uPrim, lack.prim); gl.uniform3fv(u.uSek, lack.sek);
}

/** Merken, ob die Spieloptik gewünscht ist (je Gerät) */
export function spielOptikGewuenscht() { try { return localStorage.getItem('bs-spieloptik') !== '0'; } catch { return true; } }
export function spielOptikMerken(an) { try { localStorage.setItem('bs-spieloptik', an ? '1' : '0'); } catch { /* egal */ } }
