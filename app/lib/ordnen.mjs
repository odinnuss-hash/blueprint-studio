// Blaupausen ordnen: Inhalt auswerten, einheitliche Namen vorschlagen, Doppelte erkennen.
//
// Schema:  <Hauptgruppe>_<Untergruppe>_<Thema>[_<Detail>]      (hoechstens 32 Zeichen – Grenze im Spiel)
//   z. B.  2_1_Kabel_12xKonstruktor   5_4_UBahn_Kurve_90Grad   1_1_Leergebäude_12
// Die Nummern bauen auf der vorhandenen Systematik auf (1_1 Gebaeude, 1_2 Wand, 1_3 Boden, 8_3 Statuen …).

export const MAXLEN = 32;

export const GRUPPEN_STANDARD = [
  ['1', 'Bauen'],
  ['1_1', 'Gebäude & Hallen'], ['1_2', 'Wände, Tore & Fassaden'], ['1_3', 'Böden, Fundamente & Dächer'], ['1_4', 'Tunnel, Gänge & Treppen'],
  ['1_5', 'Stützen, Pfeiler & Unterbau'], ['1_6', 'Formen & Bauhilfen'], ['1_8', 'Zäune & Geländer'], ['1_9', 'Bau-Module & Einzelteile'],
  ['2', 'Produktion'],
  ['2_1', 'Fertigung (Maschinenlinien)'], ['2_2', 'Bänder & Rohre (Trassen)'], ['2_3', 'Balancer, Splitter & Verteiler'], ['2_4', 'Abbau & Förderung'],
  ['2_5', 'Maschinen-Hüllen (Skins)'], ['2_6', 'Fabriken (komplett)'], ['2_9', 'Sonstiges Produktion'],
  ['3', 'Energie'],
  ['3_1', 'Kraftwerke'], ['3_2', 'Stromspeicher'], ['3_3', 'Strommasten & Verteilung'], ['3_6', 'Windkraft (Deko)'], ['3_7', 'Solar (Deko)'], ['3_9', 'Sonstiges Energie'],
  ['4', 'Verkehr – Straße'],
  ['4_1', 'Straßen'], ['4_2', 'Kreuzungen & Kreisel'], ['4_3', 'Parken & Stationen'], ['4_5', 'Tankstellen'], ['4_6', 'Brücken & Unterführungen'],
  ['4_7', 'Verkehrsschilder'], ['4_8', 'Gehwege'],
  ['5', 'Verkehr – Bahn'],
  ['5_1', 'Schienen & Trassen'], ['5_2', 'Bahnhöfe'], ['5_3', 'Weichen, Kreuzungen & Kreisel'], ['5_4', 'U-Bahn & Metro'], ['5_5', 'Hypertube & Schwebebahn'],
  ['5_6', 'Bahnbrücken'], ['5_9', 'Sonstiges Bahn'],
  ['6', 'Logistik & Lager'],
  ['6_1', 'Lager'], ['6_2', 'Depots & Uploader'], ['6_3', 'Drohnen & LKW'], ['6_9', 'Sonstiges Logistik'],
  ['7', 'Licht & Anzeigen'],
  ['7_1', 'Licht'], ['7_2', 'Anzeigen & Displays'], ['7_3', 'Schilder & Wegweiser'], ['7_4', 'Werbung & Logos'],
  ['8', 'Deko'],
  ['8_1', 'Möbel & Innenausstattung'], ['8_2', 'Außen & Park'], ['8_3', 'Statuen & Skulpturen'], ['8_4', 'Technik-Deko'], ['8_5', 'Pixel-Art'],
  ['8_6', 'Kräne & Fahrzeuge'], ['8_7', 'Container & Kisten'], ['8_9', 'Sonstiges Deko'],
  ['9', 'Spezial'],
  ['9_1', 'Baustelle'], ['9_2', 'Themen & Fan-Bauten'], ['9_8', 'Cheat & Kreativ'], ['9_9', 'Test & Unklar'],
];
// aktuelle Struktur (in den Einstellungen änderbar) – Arrays/Objekte werden an Ort und Stelle aktualisiert,
// damit alle Importe dieselben Daten sehen
export const GRUPPEN = GRUPPEN_STANDARD.map((g) => [...g]);
export const GRUPPE_NAME = Object.fromEntries(GRUPPEN);
export function setGruppen(liste) {
  const neu = (Array.isArray(liste) && liste.length ? liste : GRUPPEN_STANDARD)
    .filter((g) => Array.isArray(g) && /^\d+(_\d+)?$/.test(g[0]) && String(g[1] || '').trim())
    .map(([c, n]) => [c, String(n).trim()])
    .sort((a, b) => a[0].localeCompare(b[0], 'de', { numeric: true }));
  GRUPPEN.length = 0; GRUPPEN.push(...neu);
  for (const k of Object.keys(GRUPPE_NAME)) delete GRUPPE_NAME[k];
  Object.assign(GRUPPE_NAME, Object.fromEntries(neu));
}
// Themen-Ordnernamen übersetzen (Sprache der Ablage-Struktur)
let THEMA_NAME = (n) => n;
export function setThemenUebersetzung(fn) { THEMA_NAME = typeof fn === 'function' ? fn : (n) => n; }
// eigene Präfixe (Spielername, Weltname …), die beim Namensvorschlag entfallen – in den Einstellungen änderbar
let PRAEFIXE = null;
export function setPraefixe(liste) {
  const w = (liste || []).map((x) => String(x).trim()).filter(Boolean).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  PRAEFIXE = w.length ? new RegExp(`^(${w.join('|')})[_\\- ]+`, 'i') : null;
}

// Bibliotheks-Ordner -> Hauptgruppe
const ORDNER = [[/^bauen\/wand/i, '1_2'], [/^bauen\/(boden|dach)/i, '1_3'], [/^bauen/i, '1'], [/^geb(ä|ae)ude/i, '1_1'], [/^produktion/i, '2'], [/^energie/i, '3'],
  [/^verkehr/i, 'V'], [/^lager/i, '6'], [/^licht/i, '7'], [/^deko/i, '8'], [/^special|^spezial/i, '9'], [/^cheat/i, '9_8']];

// alte Codes, die nicht ins Schema passen
const UMCODE = { '1_6': '3_3', '1_7': '7_3', '5_6': '4_2', '3_5': '3_1', '2_2': '2_2' };

// ------------------------------------------------------------------ Namensbereinigung
const GANZ = { '储存箱': 'Lagerbox', '熔岩制造站': 'Magma_Manufaktur', '熔岩构筑站': 'Magma_Konstruktor', '熔岩混料站': 'Magma_Mixer', '熔岩精炼站': 'Magma_Raffinerie', '熔岩装配站': 'Magma_Fabrikator' };
const KLEIN = new Set(['für', 'mit', 'und', 'zu', 'auf', 'ohne', 'von', 'nach', 'in', 'an', 'x']);
const AKRONYM = /^(FICSIT|HUB|AWESOME|MAM|LED|HVAC|AKW|COC|DAMM|UFO|RIP|HMF|MF|OC|GW|MW|GWh|MWh|SAM|KI|LKW|PKW|DD|AV|AC|NPP|NPPs|HT|BP|USA|ADA|DNA|DJ|PC|TV|RV|OM|AOM|UBahn|XL|XXL|II|III|IV)$/;
const DROP = new Set(['the', 'a', 'an', 'of', 'for', 'by', 'to', 'in', 'on', 'my', 'v1', 'v2', 'v3', 'vanilla', 'update', 'compatible', 'version', 'blueprint', 'bp', 'design']);

// ------------------------------------------------------------------ Merkmale aus einer gelesenen Blaupause
const MASCH_KURZ = {
  Schmelzofen: 'Schmelze', Gießerei: 'Gießerei', Konstruktor: 'Konstruktor', Fabrikator: 'Fabrikator', Fertiger: 'Fertiger', Manufaktur: 'Manufaktur', Raffinerie: 'Raffinerie',
  Mixer: 'Mixer', Umfüllanlage: 'Umfüller', Teilchenbeschleuniger: 'Teilchenb', Konverter: 'Konverter', Quantenkodierer: 'Quantenk',
};
export function merkmale(bp, kat) {
  const cls = {}, rez = {};
  const X = [], Y = [], Z = [];
  let n = 0;
  for (const o of bp.objects) {
    const c = o.cls || '';
    if (!c.startsWith('Build_')) continue;
    n++; cls[c] = (cls[c] || 0) + 1;
    if (o.recipe) rez[o.recipe] = (rez[o.recipe] || 0) + 1;
    if (o.pos) { X.push(o.pos[0]); Y.push(o.pos[1]); Z.push(o.pos[2]); }
  }
  // Ausdehnung ohne Ausreisser (2 %/98 %)
  const span = (a) => { if (!a.length) return 0; a.sort((p, q) => p - q); const k = a.length > 20 ? Math.floor(a.length * 0.02) : 0; return a[a.length - 1 - k] - a[k]; };
  // Form-Fingerabdruck (Bottom-k-MinHash ueber Bauteil + Rasterzelle), fuer "aehnlich/identisch"
  const sk = sketch(bp.objects, bp.body);
  const cat = {}, masch = {};
  for (const [c, m] of Object.entries(cls)) {
    const g = kat?.gebaeude?.[c];
    const k = g ? `${g.kategorie}/${g.unterkategorie}` : 'unbekannt';
    cat[k] = (cat[k] || 0) + m;
    if (g && (g.kategorie === 'Produktion' || g.unterkategorie === 'Generatoren')) masch[g.name] = (masch[g.name] || 0) + m;
  }
  // Endprodukt: Produkt, das kein anderes Rezept der Blaupause verbraucht
  const R = Object.entries(rez).map(([id, m]) => ({ id, m, r: kat?.rezepte?.[id] })).filter((x) => x.r);
  const verbraucht = new Set(R.flatMap((x) => x.r.zutaten.map((z) => z.item)));
  const prod = R.map((x) => ({ item: x.r.produkte[0]?.item, m: x.m, proMin: (x.r.produkte[0]?.proMin || 0) * x.m }))
    .filter((p) => p.item).sort((a, b) => (verbraucht.has(a.item) - verbraucht.has(b.item)) || b.m - a.m)
    .map((p) => ({ name: kat.items[p.item]?.name || p.item, m: p.m, proMin: Math.round(p.proMin) }));
  return {
    n, dim: [Math.round(span(X) / 100), Math.round(span(Y) / 100), Math.round(span(Z) / 100)],
    cat, masch, prod, sig: signatur(cls), sk,
  };
}
const SK = 128;
const fnv = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
function sketch(objects, body) {
  const os = objects.filter((o) => (o.cls || '').startsWith('Build_') && o.pos);
  if (!os.length) return [];
  const med = (k) => { const a = os.map((o) => o.pos[k]).sort((p, q) => p - q); return Math.round(a[a.length >> 1] / 400) * 400; };
  const c = [med(0), med(1), med(2)];
  const set = new Set();
  for (const o of os) {
    // Inhalt des Objekts (Schildtexte, Farben, Rezept …) ohne Instanz-Nummern, damit Kopien gleich bleiben
    let inhalt = '';
    if (body && o.dBody != null && o.dEnd > o.dBody) inhalt = String(fnv(body.toString('latin1', o.dBody, Math.min(o.dEnd, o.dBody + 4096)).replace(/_C_\d+/g, '_C_#').replace(/\.[A-Za-z]+_\d+/g, '.#')));
    const [x, y, z, w] = o.rot || [0, 0, 0, 1];
    const yaw = Math.round(Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * 12 / Math.PI);
    set.add(fnv(o.cls + ':' + Math.round((o.pos[0] - c[0]) / 100) + ',' + Math.round((o.pos[1] - c[1]) / 100) + ',' + Math.round((o.pos[2] - c[2]) / 100) + ':' + yaw + ':' + inhalt));
  }
  return [...set].sort((a, b) => a - b).slice(0, SK);
}
/** Jaccard-Schaetzung zweier Bottom-k-Fingerabdruecke (0..1) */
export function aehnlichkeit(a, b) {
  if (!a?.length || !b?.length) return 0;
  const A = new Set(a), B = new Set(b);
  const u = [...new Set([...a, ...b])].sort((x, y) => x - y).slice(0, Math.min(SK, Math.max(a.length, b.length)));
  let both = 0;
  for (const h of u) if (A.has(h) && B.has(h)) both++;
  return both / u.length;
}
export function signatur(cls) {
  let h = 2166136261;
  for (const k of Object.keys(cls).sort()) for (const ch of k + ':' + cls[k] + ';') { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36) + '.' + Object.values(cls).reduce((a, b) => a + b, 0);
}

// ------------------------------------------------------------------ Hilfen
const lower = (s) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
const sumCat = (m, re) => Object.entries(m.cat).reduce((s, [k, v]) => s + (re.test(k) ? v : 0), 0);
const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w);
const MOJIBAKE = /\+[ñ¥ñ¤ä]|Ã|Â/;

export function istNichtssagend(name) {
  const n = name.trim();
  return /^\d{4}[_-]\d{1,2}[_-]\d{1,2}/.test(n) || /^(test\d*|adsf|asdf|neu|new|bp\d*|blueprint\d*|unbenannt\w*|untitled\w*|kopie\d*|copy\d*)$/i.test(n)
    || /^[a-z]{1,2}\d{0,2}$/i.test(n) || /^\d+([-_ ]\d+)*$/.test(n) || /^(links|rechts|mitte|oben|unten|tube|treib|verst|speicher|doppelband|eisenbarren|w-[hlr])$/i.test(n);
}

// Grobe Einordnung nach Inhalt (Hauptgruppe + Untergruppe)
function codeNachInhalt(m) {
  const N = Math.max(1, m.n);
  const rails = sumCat(m, /Züge/), gens = sumCat(m, /Generatoren/), prodM = sumCat(m, /^Produktion\/(Fertiger|Schmelzen|Ölförderung)/);
  const miner = sumCat(m, /Abbau/), belts = sumCat(m, /Förderbänder|Förderlifte/), pipes = sumCat(m, /^Transport\/Rohre/), attach = sumCat(m, /Förderband-Anbauten/);
  const store = sumCat(m, /Lager/), signs = sumCat(m, /Schilder/), lights = sumCat(m, /Beleuchtung/), walls = sumCat(m, /^Wände/), found = sumCat(m, /Fundamente|Rampen|Viertelrohre|Dächer/);
  const pillars = sumCat(m, /Säulen|Träger/), paths = sumCat(m, /Fahrzeug/), hyper = sumCat(m, /Hypertubes/), poles = sumCat(m, /Strommasten|Wandanschlüsse/), power = sumCat(m, /Energie\//);
  if (N <= 2 && (gens || prodM || miner)) return '9_8';
  if (gens) return '3_1';
  if (prodM) return N > 2500 ? '2_6' : '2_1';
  if (miner) return '2_4';
  if (rails > 0 && rails >= N * 0.02) return '5_1';
  if (power >= N * 0.6 && poles) return '3_3';
  if (/Energie\/Stromspeicher|Energiespeicher/.test(Object.keys(m.cat).join())) return '3_2';
  if (attach >= 4 && attach >= belts * 0.25) return '2_3';
  if (belts + pipes >= N * 0.3) return '2_2';
  if (hyper >= N * 0.2) return '5_5';
  if (store >= N * 0.3) return '6_1';
  if (paths >= N * 0.2) return '6_3';
  if (lights >= N * 0.3) return '7_1';
  if (signs >= N * 0.5) return '7_2';
  if (walls >= N * 0.45) return '1_2';
  if (found >= N * 0.5 && m.dim[2] <= 6) return '1_3';
  if (pillars >= N * 0.6) return '1_5';
  if (N >= 300 && Math.max(m.dim[0], m.dim[1]) >= 24) return '1_1';
  // ueberwiegend Bauteile (Waende, Boeden, Saeulen, Traeger, Rahmen …) -> Bau-Module statt Deko
  const bau = sumCat(m, /^Wände|^Organisation\/(Fundamente|Rampen|Viertelrohre|Dächer|Säulen|Träger|Rahmen|Laufstege|Gehwege|Treppen|Anbauteile)/);
  if (bau >= N * 0.5) return '1_9';
  return '8_9';
}

// Stichworte im Namen -> Untergruppe (innerhalb der Hauptgruppe, falls bekannt)
const STICH = [
    [/glitch|kanone|cannon|launcher/, '5_5'],
  [/baustelle|bauzaun|bagger|krakena|construction site/, '9_1'],
  [/pixel ?art|pixelart|\bpixel/, '8_5'],
  [/statue|skulptur|sculpture|denkmal|monument|bust/, '8_3'],
  [/kran|crane|forklift|stapler|bulldozer|truck prop|fahrzeug|vehicle|\bcar\b|\bauto\b|\brv\b|\bship\b|bagger/, '8_6'],
  [/container|kiste|crate|box|fass|barrel|dumpster/, '8_7'],
  [/tisch|table|stuhl|chair|bett|bed\b|kitchen|kueche|sofa|desk|lamp shade|bathroom|toilet|vanity|shelf|regal/, '8_1'],
  [/park|bank|bench|baum|tree|plant|pflanze|brunnen|fountain|garden|blossom|flower/, '8_2'],
  [/ventilator|fan\b|vent|hvac|server|computer|antenna|satellit|radar/, '8_4'],
  [/u-?bahn|subway|metro/, '5_4'],
  [/hyper ?tube|hyperloop|schwebebahn|levitat/, '5_5'],
  [/bahnhof|train station|station platform|bahnsteig|frachtbahnhof|kopfbahnhof|grossbahnhof|grand station/, '5_2'],
  [/weiche|switch|kreuz|interchange|clover|kleeblatt|round ?about|kreisel|rondel|rondell|vortex|u-turn|wende/, 'KREUZ'],
  [/bruecke|bridge|viadukt|aquaedukt|unterfuehrung|ueberfuehrung|overpass|truss|suspension|cable-stayed|cable spire/, 'BRUECKE'],
  [/bahnuebergang|bahnschranke|oberleitung|signal/, '5_9'],
  [/schiene|rail|gleis|trasse|track/, '5_1'],
  [/tankstelle|gas station|fuel station/, '4_5'],
  [/parkplatz|parken|parking|bus ?stop|bushalt|truck station|lkw|ladestation|loading dock/, '4_3'],
  [/gehweg|sidewalk|walkway|fussweg/, '4_8'],
  [/strasse|road|highway|autobahn|asphalt/, '4_1'],
  [/verkehrsschild|road sign|stop sign|right of way|off-road sign|forward.*sign/, '4_7'],
  [/kraftwerk|power ?plant|power station|generator|npp|reactor|reaktor|akw|nuclear flower|tower of power/, '3_1'],
  [/batter|speicher|power storage|power bank|batterybank/, '3_2'],
  [/strommast|power pole|power tower|relais|umspann|trafo|outlet|power connector|power pillar|stromverteil|stromknubbel|prioschalter/, '3_3'],
  [/windrad|wind turbine/, '3_6'], [/solar/, '3_7'],
  [/balancer|splitter|merger|verteiler|sammler|zusammenf|fusi\b|load balanc/, '2_3'],
  [/miner|extractor|extraktor|oelquelle|oil place|quelle|ölpumpe|oil pump|wasserpumpe|water pump|frack/, '2_4'],
  [/skin|huelle|matrix -|verkleidung|magma|casing for|cap\b|crown/, '2_5'],
  [/\bband\b|baender|belt|rohr|pipe|pipeline|trasse|hauptverbinder|lift/, '2_2'],
  [/lager|storage|depot|uploader|silo\b|regal/, '6_1'],
  [/drohne|drone|dronen/, '6_3'],
  [/licht|light|lampe|laterne|leuchte|led\b|neon/, '7_1'],
  [/display|anzeige|bildschirm|screen|monitor|control panel|tafel|taskboard/, '7_2'],
  [/schild|sign|wegweiser|warn|beschriftung|label|exit/, '7_3'],
  [/werbung|reklame|billboard|logo|advert|plakat|ficsit$|ficsyt/, '7_4'],
  [/tunnel|gang|korridor|corridor|treppe|stair|rolltreppe|aufzug|elevator|fahrstuhl/, '1_4'],
  [/stuetze|pfeiler|pillar|saeule|unterbau|fundament stuetz|support/, '1_5'],
  [/zaun|fence|gelaender|railing|absperrung|barrier/, '1_8'],
  [/kreis|circle|raster|grid|ruler|lineal|rotation|offset|tool|form\b|shape|spacer|abstand/, '1_6'],
  [/wand(?!el)|\bwall|\btor\b|\bgate|fassade|facade|fenster|window|\bdoor|tuer\b|mauer/, '1_2'],
  [/boden|floor|fundament|foundation|platte|plattform|platform|dach|roof|kuppel|dome|rundplatte|grundplatte|asphalt|beton \d|rasen/, '1_3'],
  [/gebaeude|building|haus|house|halle|hall|werkstatt|workshop|lagerhaus|turm|tower|villa|buero|office|fabrikhalle|bunker|raum|room|kontrollraum/, '1_1'],
];

const STARK = [[/cheat|\bfree\b|gratis|no input|place anywhere|anywhere|\b\d+ oc\b|overclock|unlimited|without input/, '9_8'], [/\btest\b|^test|kompressortest/, '9_9']];
function codeFuer(rec, m) {
  const name = lower(rec.alt);
  const ex = /^(\d)_(\d)_/.exec(rec.alt);
  if (ex) { const c = `${ex[1]}_${ex[2]}`; const c2 = UMCODE[c] || c; if (GRUPPE_NAME[c2]) return c2; }
  for (const [re, c] of STARK) if (re.test(name)) return c;
  let hg = null;
  for (const [re, c] of ORDNER) if (re.test(rec.dir || '')) { hg = c; break; }
  const inhalt = codeNachInhalt(m);
  const rails = sumCat(m, /Züge/) > 0;
  // Maschinen/Generatoren im Inhalt: Produktion bzw. Energie (auch wenn der Ordner etwas anderes sagt)
  if (/^(2_1|2_6|3_1|9_8)$/.test(inhalt) && hg !== '9_8') {
    if (inhalt === '2_1' || inhalt === '2_6') { for (const [re, c] of STICH) if (re.test(name) && /^2_/.test(c)) return c === '2_2' ? inhalt : c; }
    return inhalt;
  }
  if (hg && hg.length === 3) return hg;
  for (const [re, c0] of STICH) {
    if (!re.test(name)) continue;
    let c = c0;
    if (c0 === 'KREUZ') c = rails ? '5_3' : '4_2';
    if (c0 === 'BRUECKE') c = rails || /bahn|train|rail|zug/.test(name) ? '5_6' : '4_6';
    if (hg === 'V') { if (!/^[45]/.test(c)) continue; return c; }
    if (hg && hg !== '9' && c[0] !== hg[0]) continue;
    return c;
  }
  if (hg === 'V') return rails ? '5_1' : '4_1';
  if (hg && inhalt[0] === hg[0]) return inhalt;
  if (hg) return { 1: '1_9', 2: '2_9', 3: '3_9', 6: '6_9', 7: '7_2', 8: '8_9', 9: '9_2' }[hg] || inhalt;
  return inhalt;
}

// Thema aus dem alten Namen (bereinigt, Sprache bleibt wie sie ist)
function themaAusName(alt) {
  const ganz = GANZ[alt.trim()];
  if (ganz) return ganz.split('_');
  let s = alt.replace(/\(\d\)$/, '').replace(/^(\d)_(\d)_+/, '').replace(/^270_/, '')
    .replace(PRAEFIXE || /^\0/, '').replace(/^coc[_\- ]+/i, 'COC_').replace(/^BS_Test_/i, 'Test_');
  s = s.replace(/U-Bahn/gi, 'UBahn').replace(/\[[^\]]*\]/g, ' ').replace(/\((?:[^)]*(?:vanilla|update|v\d|1\.\d|mod|compatible)[^)]*)\)/gi, ' ')
    .replace(/\bv\d+(\.\d+)*\b/gi, ' ').replace(/\b(ver\d+)\b/gi, ' ').replace(/\s+by\s+\S+.*$/i, ' ').replace(/\b(1\.0|1\.1|1\.2)\b/g, ' ')
    .replace(/(\d+)\s*(zu|auf|to|into|in)\s*(\d+)/gi, '$1zu$3').replace(/(\d+),(\d+)/g, '$1komma$2');
  let words = s.split(/[\s_\-–,;:+/()&.!'"#]+/).filter(Boolean);
  // Anzahl vorne ("10x Band") ans Ende
  const vorn = [];
  while (words.length > 1 && /^\d+x$/i.test(words[0])) vorn.push(words.shift().toLowerCase());
  words = words.concat(vorn);
  const out = [];
  for (const w of words) {
    const lw = w.toLowerCase();
    if (DROP.has(lw)) continue;
    if (KLEIN.has(lw) && out.length) { out.push(lw); continue; }
    if (AKRONYM.test(w)) { out.push(w); continue; }
    if (/^[A-ZÄÖÜ]{4,}$/.test(w)) { out.push(w[0] + w.slice(1).toLowerCase()); continue; }
    out.push(/^[a-zäöüß]/.test(w) ? cap(w) : w);
  }
  return out;
}
function themaAusInhalt(m, code) {
  const d = `${m.dim[0]}x${m.dim[1]}m`;
  if (/^(2_1|2_6|3_1|9_8)$/.test(code) && (m.prod.length || Object.keys(m.masch).length)) {
    const p = m.prod[0];
    const [mn, mc] = Object.entries(m.masch).sort((a, b) => b[1] - a[1])[0] || [];
    const kurz = mn ? (MASCH_KURZ[mn] || mn.replace(/[^A-Za-zÄÖÜäöüß0-9]/g, '')) : '';
    const name = p ? p.name.replace(/^Abgefüllte[rs]? /, 'Abgef').replace(/[^A-Za-zÄÖÜäöüß0-9-]/g, '') : kurz;
    return [name, mc ? `${mc}x${kurz}` : '', p && p.proMin ? `${p.proMin}pm` : ''].filter(Boolean);
  }
  const N = m.n;
  const belts = sumCat(m, /Förderbänder/), pipes = sumCat(m, /^Transport\/Rohre/);
  if (code === '2_2') return [belts >= pipes ? 'Band' : 'Rohr', d];
  if (code === '2_3') return ['Verteiler', d];
  if (code === '1_3') return ['Fläche', d];
  if (code === '1_2') return ['Wand', d];
  if (code === '1_1') return ['Gebäude', d];
  if (code.startsWith('5')) return ['Gleis', d];
  if (code === '6_1') return ['Lager', d];
  if (code === '7_2') return ['Anzeige', d];
  const dom = Object.entries(m.cat).sort((a, b) => b[1] - a[1])[0];
  const wort = dom ? dom[0].split('/').pop().replace(/[^A-Za-zÄÖÜäöüß]/g, '') : 'Bau';
  return [wort || 'Bau', d];
}

function kuerzen(code, tokens) {
  const join = (t) => [code, ...t].join('_').replace(/_+/g, '_');
  let t = tokens.filter(Boolean);
  if (join(t).length <= MAXLEN) return join(t);
  t = t.filter((w, i) => i === 0 || !KLEIN.has(w.toLowerCase()));
  if (join(t).length <= MAXLEN) return join(t);
  const pm = t.findIndex((w, i) => i > 0 && /pm$/.test(w));
  if (pm > 0) t.splice(pm, 1);
  if (join(t).length <= MAXLEN) return join(t);
  t = t.map((w, i) => (i > 0 && w.length > 9 && !/\d/.test(w) ? w.slice(0, 7) : w));
  if (join(t).length <= MAXLEN) return join(t);
  while (t.length > 2 && join(t).length > MAXLEN) {
    // erstes Wort und Zahlen/Varianten am Ende behalten, vorletztes Nicht-Zahl-Wort streichen
    let k = t.length - 2;
    while (k > 0 && /\d/.test(t[k])) k--;
    t.splice(k > 0 ? k : 1, 1);
  }
  let r = join(t);
  if (r.length > MAXLEN) r = r.slice(0, MAXLEN).replace(/_+$/, '');
  return r;
}

/** Vorschlag fuer eine Blaupause: rec = { alt, dir, ort }, m = merkmale */
export function vorschlag(rec, m, overrides = {}) {
  if (overrides[rec.alt]) return { neu: overrides[rec.alt], code: overrides[rec.alt].slice(0, 3), grund: 'kuratiert' };
  const code = codeFuer(rec, m);
  const leer = istNichtssagend(rec.alt.replace(/\(\d\)$/, '').trim());
  let tokens = leer ? themaAusInhalt(m, code) : themaAusName(rec.alt);
  if (!tokens.length) tokens = themaAusInhalt(m, code);
  return { neu: kuerzen(code, tokens), code, grund: leer ? 'aus Inhalt' : 'aus Name' };
}

export const istMojibake = (s) => MOJIBAKE.test(s);
export const pass = (neu) => /^\d_\d_/.test(neu) && neu.length <= MAXLEN && !/[\\/:*?"<>|]/.test(neu);

// ------------------------------------------------------------------ Plan ueber alle Blaupausen
const guteNote = (e) => (istNichtssagend(e.alt.replace(/\(\d\)$/, '').trim()) ? 0 : 4) + (/\(\d\)$/.test(e.alt) ? 0 : 2) + (istMojibake(e.alt) ? 0 : 2)
  + (/^\d_\d_/.test(e.alt) ? 1 : 0) + (e.ort === 'Bibliothek' ? 1 : 0);

/** eintraege: [{ id, ort, dir, alt, m }]  ->  [{ ...eintrag, neu, code, grund, aktion, dupVon }] */
export function planen(eintraege, overrides = {}) {
  const gruppen = new Map();
  for (const e of eintraege) {
    const key = e.m && e.m.n > 0 ? e.m.sig : 'leer:' + e.id;
    if (!gruppen.has(key)) gruppen.set(key, []);
    gruppen.get(key).push(e);
  }
  const out = [];
  for (const g of gruppen.values()) {
    g.sort((a, b) => guteNote(b) - guteNote(a));
    const best = g[0];
    const v = vorschlag(best, best.m, overrides);
    const ersteImOrdner = new Map();
    for (const e of g) {
      const gleich = e === best || !best.m?.sk?.length || aehnlichkeit(best.m.sk, e.m.sk) >= 0.99;
      const ov = overrides[e.alt] || !gleich ? vorschlag(e, e.m, overrides) : v;
      const ordner = e.ort + '|' + e.dir;
      const r = { ...e, neu: ov.neu, code: ov.code, grund: ov.grund, aktion: 'umbenennen', dupVon: null };
      if (ersteImOrdner.has(ordner) && aehnlichkeit(ersteImOrdner.get(ordner).m.sk, e.m.sk) >= 0.99) { r.aktion = 'duplikat'; r.dupVon = ersteImOrdner.get(ordner).alt; r.dupId = ersteImOrdner.get(ordner).id; }
      else if (!ersteImOrdner.has(ordner)) ersteImOrdner.set(ordner, e);
      if (g.length > 1 && r.aktion !== 'duplikat') r.gleicheWie = g.filter((x) => x !== e).length;
      out.push(r);
    }
  }
  // Aehnliche (>= 90 %) finden: Kandidaten mit aehnlicher Teilezahl vergleichen
  const kand = out.filter((r) => r.m?.sk?.length && r.m.n > 0).sort((a, b) => a.m.n - b.m.n);
  for (let i = 0; i < kand.length; i++) {
    const a = kand[i];
    for (let j = i + 1; j < kand.length && kand[j].m.n <= a.m.n * 1.12 + 2; j++) {
      const b = kand[j];
      if (a.m.sig === b.m.sig && a.dir === b.dir && a.ort === b.ort) continue; // bereits als identisch erkannt
      const sim = aehnlichkeit(a.m.sk, b.m.sk);
      if (sim < 0.9) continue;
      const pct = Math.round(sim * 100);
      const selberOrdner = a.ort === b.ort && a.dir === b.dir;
      if (selberOrdner || pct < 99) for (const [x, y] of [[a, b], [b, a]]) if (!x.aehnlich || x.aehnlich.pct < pct) x.aehnlich = { id: y.id, alt: y.alt, ort: y.ort, dir: y.dir, pct };
      // praktisch identisch (>= 99 %) im selben Ordner -> schlechter benannte als Duplikat
      if (sim >= 0.99 && a.ort === b.ort && a.dir === b.dir && a.aktion !== 'duplikat' && b.aktion !== 'duplikat') {
        const [keep, dup] = guteNote(a) >= guteNote(b) ? [a, b] : [b, a];
        dup.aktion = 'duplikat'; dup.dupVon = keep.alt; dup.dupId = keep.id;
      }
    }
  }
  // Namensgleichheit im selben Ordner bei verschiedenem Inhalt -> _2, _3 …
  const belegt = new Map();
  for (const r of out) {
    if (r.aktion === 'duplikat') continue;
    const k = r.ort + '|' + r.dir + '|' + r.neu.toLowerCase();
    if (!belegt.has(k)) { belegt.set(k, [r]); continue; }
    belegt.get(k).push(r);
  }
  for (const list of belegt.values()) {
    if (list.length < 2) continue;
    list.forEach((r, i) => { if (i === 0) return; const suf = '_' + (i + 1); r.neu = r.neu.slice(0, MAXLEN - suf.length).replace(/_$/, '') + suf; });
  }
  for (const r of out) if (r.aktion === 'umbenennen' && r.neu === r.alt) r.aktion = 'gleich';
  return out;
}

// ------------------------------------------------------------------ Einlesen (mit Zwischenspeicher)
import fs from 'node:fs';
import path from 'node:path';
import { readBlueprint } from './sbp.mjs';

const SKIP_DIR = /^_(archiv|pakete|duplikate)$/i;

export function ordnerListe(root) {
  const res = [];
  const walk = (rel) => {
    res.push(rel);
    let list = [];
    try { list = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of list) if (e.isDirectory() && !SKIP_DIR.test(e.name)) walk(rel ? path.join(rel, e.name) : e.name);
  };
  walk('');
  return res;
}

/** orte: [{ ort: 'Spiel'|'Bibliothek', root, ohneWurzel }] */
export function scannen(orte, kat, cacheFile, log = () => {}) {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { /* neu */ }
  const neuCache = {}, eintraege = [];
  let gelesen = 0;
  for (const o of orte) {
    if (!o.root || !fs.existsSync(o.root)) continue;
    for (const rel of ordnerListe(o.root)) {
      if (o.ohneWurzel && !rel) continue;
      const abs = path.join(o.root, rel);
      let files = [];
      try { files = fs.readdirSync(abs).filter((f) => f.toLowerCase().endsWith('.sbp')); } catch { continue; }
      for (const f of files) {
        const p = path.join(abs, f);
        let st; try { st = fs.statSync(p); } catch { continue; }
        const key = p + '|' + st.size + '|' + Math.round(st.mtimeMs);
        let m = cache[key];
        if (!m) {
          try { m = merkmale(readBlueprint(fs.readFileSync(p)), kat); } catch (e) { m = { n: 0, dim: [0, 0, 0], cat: {}, masch: {}, prod: [], sig: 'fehler', fehler: e.message }; }
          gelesen++;
          if (gelesen % 200 === 0) log(`  ${gelesen} Blaupausen gelesen …`);
        }
        neuCache[key] = m;
        eintraege.push({ id: o.ort + '|' + rel.split(path.sep).join('/') + '|' + f.slice(0, -4), ort: o.ort, root: o.root, dir: rel.split(path.sep).join('/'), alt: f.slice(0, -4), m });
      }
    }
  }
  try { fs.writeFileSync(cacheFile, JSON.stringify(neuCache)); } catch { /* egal */ }
  return { eintraege, gelesen };
}

/** Umbenennen bzw. Duplikate verschieben; liefert Protokoll-Eintraege */
export function anwenden(aenderungen) {
  const ergebnis = [];
  for (const a of aenderungen) {
    const dir = path.join(a.root, a.dir);
    const res = { id: a.id, ort: a.ort, root: a.root, dir: a.dir, alt: a.alt, neu: a.neu, aktion: a.aktion, ok: false };
    try {
      const zielDir = a.aktion === 'duplikat' ? path.join(dir, '_Duplikate') : dir;
      const zielName = a.aktion === 'duplikat' ? a.alt : a.neu;
      if (a.aktion !== 'duplikat' && (!pass(a.neu))) throw new Error('Name passt nicht zum Schema');
      fs.mkdirSync(zielDir, { recursive: true });
      for (const ext of ['.sbp', '.sbpcfg']) {
        const von = path.join(dir, a.alt + ext), nach = path.join(zielDir, zielName + ext);
        if (!fs.existsSync(von)) { if (ext === '.sbp') throw new Error('Datei nicht gefunden'); continue; }
        if (fs.existsSync(nach) && path.resolve(von).toLowerCase() !== path.resolve(nach).toLowerCase()) throw new Error('Ziel existiert schon: ' + zielName + ext);
      }
      for (const ext of ['.sbp', '.sbpcfg']) {
        const von = path.join(dir, a.alt + ext), nach = path.join(zielDir, zielName + ext);
        if (fs.existsSync(von)) fs.renameSync(von, nach);
      }
      res.ok = true; res.zielDir = path.relative(a.root, zielDir).split(path.sep).join('/'); res.zielName = zielName;
    } catch (e) { res.fehler = e.message; }
    ergebnis.push(res);
  }
  return ergebnis;
}

/** Rueckgaengig fuer Protokoll-Eintraege */
export function rueckgaengig(eintraege) {
  const out = [];
  for (const r of eintraege.filter((x) => x.ok).reverse()) {
    const res = { ...r, zurueck: false };
    try {
      for (const ext of ['.sbp', '.sbpcfg']) {
        const von = path.join(r.root, r.zielDir, r.zielName + ext), nach = path.join(r.root, r.dir, r.alt + ext);
        if (!fs.existsSync(von)) continue;
        if (fs.existsSync(nach)) throw new Error('Alter Name ist inzwischen wieder belegt: ' + r.alt);
        fs.renameSync(von, nach);
      }
      res.zurueck = true;
    } catch (e) { res.fehler = e.message; }
    out.push(res);
  }
  return out;
}

// ------------------------------------------------------------------ kleine Draufsicht (Vorschaubild)
const KAT_FARBE = (g, cls) => {
  if (!g) return 6;
  if (g.kategorie === 'Produktion') return 0;
  if (g.kategorie === 'Energie') return 1;
  if (g.kategorie === 'Transport') return 2;
  if (g.kategorie === 'Wände') return 3;
  if (/Fundamente|Rampen|Viertelrohre|Dächer/.test(g.unterkategorie)) return 4;
  if (/Schilder|Beleuchtung/.test(g.unterkategorie)) return 5;
  return 6;
};
const qrotV = (q, v) => { const [x, y, z, w] = q, [vx, vy, vz] = v; const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx); return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)]; };
export function vorschau(file, kat) {
  const bp = readBlueprint(fs.readFileSync(file));
  let os = bp.objects.filter((o) => o.kind === 'entity' && (o.cls || '').startsWith('Build_') && o.pos && !/PowerLine|Wire/.test(o.cls));
  const step = Math.max(1, Math.ceil(os.length / 2500));
  if (step > 1) os = os.filter((_, i) => i % step === 0);
  const med = (k) => { const a = os.map((o) => o.pos[k]).sort((p, q) => p - q); return a.length ? a[a.length >> 1] : 0; };
  const cx = med(0), cy = med(1);
  const r1 = (v) => Math.round(v * 10) / 10;
  const boxes = [], lines = [];
  for (const o of os) {
    const g = kat?.gebaeude?.[o.cls];
    const c = KAT_FARBE(g, o.cls);
    if (o.spline && o.spline.length > 1) {
      lines.push([c, ...o.spline.flatMap((p) => { const w = qrotV(o.rot, p.slice(0, 3)); return [r1((w[0] + o.pos[0] - cx) / 100), r1((w[1] + o.pos[1] - cy) / 100)]; })]);
      continue;
    }
    const b = g?.box || [-50, -50, 0, 50, 50, 100];
    const [x, y, z, w] = o.rot;
    const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
    const mx = (b[0] + b[3]) / 2, my = (b[1] + b[4]) / 2, off = qrotV(o.rot, [mx, my, 0]);
    boxes.push([r1((o.pos[0] + off[0] - cx) / 100), r1((o.pos[1] + off[1] - cy) / 100), r1((b[3] - b[0]) / 100), r1((b[4] - b[1]) / 100), Math.round(yaw * 100) / 100, c, Math.round(o.pos[2] / 100)]);
  }
  return { boxes, lines, n: bp.objects.length };
}

// ------------------------------------------------------------------ Lernen aus den eigenen, schon passend benannten Blaupausen
const STOPP = new Set(['mk', 'mk1', 'mk2', 'mk3', 'mk4', 'mk5', 'mk6', 'klein', 'gross', 'groß', 'neu', 'alt', 'links', 'rechts', 'oben', 'unten']);
const worte = (name) => lower(name.replace(/^\d_\d_/, '')).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !/^\d+(x|m|pm)?$/.test(w) && !STOPP.has(w));
const katVektor = (m) => { const t = Object.values(m.cat || {}).reduce((a, b) => a + b, 0) || 1; return Object.fromEntries(Object.entries(m.cat || {}).map(([k, v]) => [k, v / t])); };
const cosinus = (a, b) => { let s = 0, na = 0, nb = 0; for (const k in a) { na += a[k] * a[k]; if (b[k]) s += a[k] * b[k]; } for (const k in b) nb += b[k] * b[k]; return s / (Math.sqrt(na * nb) || 1); };

/** Modell: Beispiele (Code, Fingerabdruck, Kategorie-Mix) + Wort -> Code-Stimmen. Quelle: alle Namen, die schon dem Schema folgen. */
export function lernen(eintraege, eigene = {}) {
  const beispiele = [], woerter = new Map();
  const stimme = (w, code, g = 1) => { let m = woerter.get(w); if (!m) woerter.set(w, m = {}); m[code] = (m[code] || 0) + g; };
  for (const e of eintraege) {
    if (!e.m || !e.m.n || !pass(e.alt)) continue;
    const code = e.alt.slice(0, 3);
    if (!GRUPPE_NAME[code]) continue;
    beispiele.push({ id: e.id, name: e.alt, code, sk: e.m.sk, vek: katVektor(e.m), dim: e.m.dim || [0, 0, 0], n: e.m.n });
    for (const w of new Set(worte(e.alt))) stimme(w, code);
  }
  // eigene Korrekturen (im Bereich „Ordnen“ bzw. beim Umbenennen eingegeben) zaehlen doppelt
  for (const v of Object.values(eigene)) if (v?.neu && pass(v.neu) && v.alt) for (const w of new Set(worte(v.alt))) stimme(w, v.neu.slice(0, 3), 2);
  return { beispiele, woerter, anzahl: beispiele.length };
}

/** Vorschlag mit Gelerntem: 1. fast gleiche Blaupause (>= 90 %) -> deren Gruppe, 2. Woerter im Namen, 3. aehnlicher Inhalt, sonst Regeln */
export function vorschlagGelernt(rec, m, modell) {
  const regel = vorschlag(rec, m);
  if (pass(rec.alt)) return { ...regel, neu: rec.alt, code: rec.alt.slice(0, 3), grund: 'passt schon zum Schema' };
  if (!modell?.anzahl || !m?.n) return regel;
  const leer = istNichtssagend(rec.alt.replace(/\(\d\)$/, '').trim());
  const mitCode = (code, grund, extra = {}) => {
    const tokens = leer ? themaAusInhalt(m, code) : themaAusName(rec.alt);
    return { neu: kuerzen(code, tokens.length ? tokens : themaAusInhalt(m, code)), code, grund, ...extra };
  };
  // 1. fast gleiche Blaupause
  let best = null, bs = 0;
  for (const b of modell.beispiele) {
    if (b.id === rec.id) continue;
    const s = aehnlichkeit(m.sk, b.sk);
    if (s > bs) { bs = s; best = b; }
  }
  if (best && bs >= 0.9) {
    if (leer && bs >= 0.99) return { neu: (best.name.length > MAXLEN - 2 ? best.name.slice(0, MAXLEN - 2) : best.name) + '_2', code: best.code, grund: `identisch mit „${best.name}“ – vermutlich doppelt`, wie: best.name, doppelt: true, gelernt: true };
    if (leer) return { neu: best.name.length > MAXLEN - 2 ? best.name : best.name + '_V', code: best.code, grund: `wie „${best.name}“ (${Math.round(bs * 100)} % gleich) – Variante`, wie: best.name, gelernt: true };
    return mitCode(best.code, `Gruppe wie „${best.name}“ (${Math.round(bs * 100)} % gleich)`, { wie: best.name, gelernt: true });
  }
  // 2. Woerter, die du schon benutzt hast
  if (!leer && !/^(9_8|9_9)$/.test(regel.code)) {
    const summe = {};
    let wort = null, wmax = 0;
    for (const w of worte(rec.alt)) {
      const v = modell.woerter.get(w); if (!v) continue;
      const tot = Object.values(v).reduce((a, b) => a + b, 0);
      const [c, n] = Object.entries(v).sort((a, b) => b[1] - a[1])[0];
      if (tot >= 2 && n / tot >= 0.7) { summe[c] = (summe[c] || 0) + n; if (n > wmax) { wmax = n; wort = w; } }
    }
    const top = Object.entries(summe).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 3 && top[0] !== regel.code) return mitCode(top[0], `gelernt: „${wort}“ steht bei dir meist in ${top[0]}`, { gelernt: true });
    if (top && top[0] === regel.code) return { ...regel, grund: regel.grund + ' · bestätigt durch deine Namen' };
  }
  // 3. aehnlicher Inhalt (nur wenn der Name nichts hergibt)
  if (leer) {
    const v = katVektor(m);
    // aehnlich = gleicher Bauteil-Mix UND aehnliche Groesse (Grundflaeche, Hoehe, Teilezahl je hoechstens Faktor 1,5)
    const fl = (d) => [Math.max(d[0], d[1]), Math.min(d[0], d[1]), d[2]];
    const nah = (a, b) => Math.max(a, b) <= 2 || Math.max(a, b) / Math.max(1, Math.min(a, b)) <= 1.5;
    const da = fl(m.dim || [0, 0, 0]);
    const nn = modell.beispiele.map((b) => [b, cosinus(v, b.vek)])
      .filter(([b, s]) => s >= 0.95 && nah(m.n, b.n) && fl(b.dim).every((x, i) => nah(x, da[i])))
      .sort((a, b) => b[1] - a[1]).slice(0, 7);
    if (nn.length >= 3) {
      const z = {}; for (const [b] of nn) z[b.code] = (z[b.code] || 0) + 1;
      const [c, n] = Object.entries(z).sort((a, b) => b[1] - a[1])[0];
      if (n >= 3 && n / nn.length >= 0.75 && c !== regel.code) return mitCode(c, `gelernt: ähnlich groß und gleich aufgebaut wie ${n} deiner Blaupausen in ${c}`, { gelernt: true });
    }
  }
  return regel;
}

// Themen-Unterordner fuer die grossen Gruppen (aus der Auswertung der eigenen ~3.000 Blaupausen, Okt. 2026).
// Reihenfolge zaehlt: das erste passende Thema gewinnt; ohne Treffer bleibt die Blaupause im Gruppenordner.
export const THEMEN = {
  '1_1': [['Hallen & Werkstätten', /halle|hall\b|werkstatt|workshop|hangar|fabrikhalle/], ['Türme', /turm|tower/], ['Wohnhäuser', /haus|house|villa|wohn|home/], ['Leergebäude', /leergeb/], ['Räume & Module', /raum|room|modul/]],
  '1_2': [['Türen & Tore', /tuer|door|\btor\b|gate/], ['Fenster & Fassaden', /fassade|facade|fenster|window|glas/], ['Mauern & Dämme', /damm|mauer|brick|vault/], ['Wand-Module', /modul|wand|wall/]],
  '1_5': [['Säulen', /saeule|pillar|stuetze/], ['Träger', /traeger|beam/], ['Unterbau', /unterbau|fundament|sockel/]],
  '1_9': [['Säulen & Träger', /saeule|traeger|pillar|beam/], ['Böden & Fundamente', /fundament|boden|flaeche|floor/], ['Wände & Rahmen', /wand|wall|rahmen|frame/]],
  '2_1': [['Kompakt-Layouts', /ultracompact|compact|kompakt|starter/], ['Eisen & Stahl', /eisen|iron|stahl|steel|schraub|screw|rotor|stator|platte|plate|modular|frame/],
    ['Kupfer & Caterium', /kupfer|copper|kabel|cable|draht|wire|caterium|quickwire|schnelldraht/], ['Öl, Kunststoff & Treibstoff', /oel|\boil|kunststoff|plastic|gummi|rubber|fuel|treibstoff|polymer|harz|resin/],
    ['Aluminium', /alu/], ['Beton, Quarz & Glas', /beton|concrete|quarz|quartz|silica|kristall|crystal|glas/],
    ['Hightech & Endgame', /computer|circuit|motor|turbo|heavy|fused|rocket|rakete|quant|ficsonium|dark|singular|nuclear|uran|plutonium|magma|mirror|spiegel|projekt|project/]],
  '2_2': [['Förderbänder', /band|belt/], ['Rohre', /rohr|pipe/], ['Förderlifte', /lift/]],
  '3_1': [['Atomkraft', /reactor|reaktor|nuclear|atom|akw|uran|plutonium/], ['Kohle', /coal|kohle/], ['Treibstoff', /fuel|treibstoff|turbo/]],
  '4_6': [['Hängebrücken', /suspension|haenge|cable|golden/], ['Brücken-Module', /modular|abschnitt|part|teil/]],
  '5_1': [['Rampen & Abzweige', /ramp|rampe|abzweig|left|right|links|rechts/], ['Trassen & Stützen', /trasse|support|stuetze|wall/]],
  '7_2': [['Muster', /muster|pattern/], ['Bedienpulte', /control|panel|pult|konsole/], ['Displays & Tafeln', /anzeige|screen|display|tafel/]],
  '8_6': [['Kräne', /kran|crane/], ['Fahrzeuge & Bagger', /truck|lkw|auto|\bcar|fahrzeug|bagger|zug/]],
  '8_7': [['Container', /container/], ['Kisten', /kiste|crate|box/]],
};

/** Ordnerpfad (relativ zur Ablage) fuer einen Code, z. B. "2 Produktion/2_1 Fertigung (Maschinenlinien)/Eisen & Stahl" */
export function ablageOrdner(code, name = '') {
  const hg = String(code).split('_')[0];
  const ok = (s) => s.replace(/[\\/:*?"<>|]/g, '-');
  const top = `${hg} ${ok(GRUPPE_NAME[hg] || 'Sonstiges')}`;
  if (!(GRUPPE_NAME[code] && String(code).includes('_'))) return top;
  const gruppe = `${top}/${code} ${ok(GRUPPE_NAME[code])}`;
  const n = lower(name.replace(/^\d_\d_/, ''));
  const t = name && (THEMEN[code] || []).find(([, re]) => re.test(n));
  return t ? `${gruppe}/${ok(THEMA_NAME(t[0]))}` : gruppe;
}
/** alle Ordner der Struktur (Hauptgruppen, Gruppen, Themen) */
export function strukturOrdner() {
  const out = [];
  for (const [c] of GRUPPEN) {
    out.push(ablageOrdner(c));
    for (const [t] of THEMEN[c] || []) out.push(`${ablageOrdner(c)}/${THEMA_NAME(t).replace(/[\\/:*?"<>|]/g, '-')}`);
  }
  return out;
}
