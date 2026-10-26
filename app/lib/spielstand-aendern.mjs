// Bestehendes im Spielstand ändern (Welt-Ansicht Stufe 4): Bauteile des Haupt-Levels verschieben/drehen oder löschen.
// Ergebnis ist immer eine neue Datei – das Original bleibt unverändert.
//
// Zwei Arten von Bauteilen:
//  - Akteure (Maschinen, Bänder, Masten …): Kopf mit Transform (4 rot, 3 pos, 3 scale als float) → Lage im Kopf überschreiben;
//    Löschen entfernt Kopf + Daten des Akteurs, seine Komponenten (Eltern = Akteur) und Stromkabel, die an ihm hängen.
//  - Leichtbau (Fundamente, Wände, Träger …) im FGLightweightBuildableSubsystem: je Klasse eine Liste von Einträgen,
//    Transform als double (rot 4, pos 3, scale 3 = 80 Byte am Anfang des Eintrags) → überschreiben bzw. Eintrag entfernen
//    und die Anzahl der Klasse herabsetzen. Längen (Objektdaten, Datenblock, Body) werden nachgeführt.
// Verweise: Akteur = { a: pathName }, Leichtbau = { l: typePath, i: laufende Nummer in der Klasse }.
import { readSave, readSavHeader } from './sav.mjs';
import { hauptLevel, packeSpielstand } from './spielstand-einfuegen.mjs';

const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };

/** Einträge des Leichtbau-Subsystems mit Byte-Lage (gleiche Leselogik wie sav.mjs readLightweight) */
export function leichtbauLage(body, o) {
  let p = body.indexOf('None\0', o.dBody, 'latin1') + 5;
  if (p < o.dBody + 5 || p > o.dEnd) throw new Error('Leichtbau-Daten nicht gefunden');
  const str = () => { const n = body.readInt32LE(p); const s = n > 0 ? body.toString('latin1', p + 4, p + 3 + n) : ''; p += 4 + (n < 0 ? -n * 2 : n); return s; };
  p += 4; const version = body.readInt32LE(p); p += 4;
  const nc = body.readInt32LE(p); p += 4;
  const kopfEnde = p, klassen = [];
  for (let c = 0; c < nc; c++) {
    const ka = p; str(); const typePath = str(); const anzPos = p; const n = body.readInt32LE(p); p += 4;
    const eintraege = [];
    for (let k = 0; k < n; k++) {
      const a = p; p += 80;
      str(); str(); for (let j = 0; j < 6; j++) str();
      p += 32; str(); str(); p++; str(); str();
      const proxyA = p; str(); str(); const proxyE = p;
      if (body.readInt32LE(p)) { p += 4; str(); str(); const sz = body.readInt32LE(p); p += 4 + sz; } else p += 4;
      if (version >= 4) p += 5;
      eintraege.push({ a, e: p, proxyA, proxyE });
    }
    klassen.push({ typePath, ka, anzPos, eintraege });
  }
  if (p !== o.dEnd) throw new Error('Leichtbau-Daten: Länge passt nicht');
  return { kopfEnde, klassen, version };
}

/**
 * buf = Spielstand; loeschen = [ref]; verschieben = [{ ref, pos:[x,y,z], rot:[qx,qy,qz,qw] }]. Liefert { ausgabe, info }.
 * Selbstprüfung: neu einlesen, Anzahl stimmt, verschobene Lagen stehen so im Ergebnis.
 */
export function spielstandAendern(buf, { loeschen = [], verschieben = [], ersetzen = null, speichername } = {}) {
  // ersetzen: Map(pathName → neue Objektdaten) – z. B. Farbpalette (Eigenschaft im BP_BuildableSubsystem)
  const header = readSavHeader(buf);
  const s = readSave(buf, { props: false }), b = s.body;
  if (b.readBigInt64LE(0) !== BigInt(b.length - 8)) throw new Error('Spielstand: Gesamtlänge unerwartet');
  const L = hauptLevel(s);
  if (L.datenEnde !== L.datenBlockEnde) throw new Error('Spielstand: nach den Objektdaten des Haupt-Levels folgt Unerwartetes');
  const idx = new Map(L.P.map((o, k) => [o.pathName, k]));
  const key = (r) => (r.a ? 'a:' + r.a : `l:${r.l}#${r.i}`);
  const weg = new Set(loeschen.map(key)), lage = new Map(verschieben.map((v) => [key(v.ref), v]));
  for (const v of verschieben) if (!(v.pos?.length === 3 && v.rot?.length === 4 && [...v.pos, ...v.rot].every(Number.isFinite))) throw Object.assign(new Error('Ungültige Lage'), { status: 400 });

  // Akteure: zu löschende Objekte samt Komponenten und Stromkabeln
  const raus = new Set();
  for (const r of loeschen) if (r.a) {
    if (!idx.has(r.a)) throw Object.assign(new Error('Bauteil nicht im Haupt-Level: ' + r.a), { status: 422 });
    raus.add(r.a);
  }
  if (raus.size) {
    // Nachschlagen statt jeden Namen gegen jedes Objekt zu prüfen – beim Freiräumen großer Bereiche (Tausende Teile) sonst Minuten
    const unterRaus = (n) => { for (let p = n.indexOf('.'); p >= 0; p = n.indexOf('.', p + 1)) if (raus.has(n.slice(0, p))) return true; return false; };
    for (const o of L.P) if (o.kind === 0 && (raus.has(o.parent) || unterRaus(o.pathName))) raus.add(o.pathName);
    // Kabel verweisen auf Komponenten des Akteurs („<Akteur>.<Anschluss>“)
    const PL = 'PersistentLevel.', akteure = loeschen.filter((r) => r.a).map((r) => r.a), wort = new Map();
    for (const a of akteure) { const i = a.indexOf(PL); if (i >= 0) wort.set(a.slice(i + PL.length), a); }
    const schnell = wort.size === akteure.length;
    const namen = schnell ? null : akteure.map((a) => Buffer.from(a + '.', 'latin1'));
    const wortEnde = (s, e) => { while (e < s.length) { const c = s.charCodeAt(e); if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95)) break; e++; } return e; };
    const haengtDran = (d) => {
      if (!schnell) return namen.some((n) => d.includes(n));
      const s = d.toString('latin1');
      for (let p = s.indexOf(PL); p >= 0; p = s.indexOf(PL, p + PL.length)) {
        const a = p + PL.length, e = wortEnde(s, a), voll = wort.get(s.slice(a, e));
        if (voll && s[e] === '.' && s.startsWith(voll, e - voll.length)) return true;
      }
      return false;
    };
    for (const o of L.P) if (o.kind === 1 && /Build_PowerLine_C$/.test(o.typePath) && !raus.has(o.pathName) && haengtDran(b.subarray(o.dBody, o.dEnd))) raus.add(o.pathName);
  }
  let kabel = 0; for (const n of raus) if (/PowerLine/.test(n)) kabel++;

  // Köpfe und Daten neu zusammensetzen
  const koepfe = [], daten = [];
  let lwGeloescht = 0, lwVerschoben = 0, aVerschoben = 0;
  const datenEintrag = (o, nutz) => [i32(o.ver), i32(0), i32(nutz.length), nutz, ...(o.ver >= 53 ? [i32(0)] : [])];
  for (let k = 0; k < L.P.length; k++) {
    const o = L.P[k], kk = L.koepfe[k];
    if (raus.has(o.pathName)) continue;
    let kopf = b.subarray(kk.a, kk.e), nutz = ersetzen?.get(o.pathName) || b.subarray(o.dBody, o.dEnd);
    const v = lage.get('a:' + o.pathName);
    if (v && kk.tf >= 0) {
      kopf = Buffer.from(kopf); const t = kk.tf - kk.a;
      v.rot.forEach((x, j) => kopf.writeFloatLE(x, t + j * 4)); v.pos.forEach((x, j) => kopf.writeFloatLE(x, t + 16 + j * 4));
      aVerschoben++;
    }
    if (/LightweightBuildableSubsystem$/.test(o.typePath)) {
      const lw = leichtbauLage(b, o), teile = [b.subarray(o.dBody, lw.kopfEnde)];
      for (const kl of lw.klassen) {
        const bleiben = [];
        kl.eintraege.forEach((e, i) => {
          const kk2 = `l:${kl.typePath}#${i}`;
          if (weg.has(kk2)) { lwGeloescht++; return; }
          let eb = b.subarray(e.a, e.e); const vv = lage.get(kk2);
          if (vv) { eb = Buffer.from(eb); vv.rot.forEach((x, j) => eb.writeDoubleLE(x, j * 8)); vv.pos.forEach((x, j) => eb.writeDoubleLE(x, 32 + j * 8)); lwVerschoben++; }
          bleiben.push(eb);
        });
        teile.push(b.subarray(kl.ka, kl.anzPos), i32(bleiben.length), ...bleiben);
      }
      nutz = Buffer.concat(teile);
    }
    koepfe.push(kopf); daten.push(...datenEintrag(o, nutz));
  }
  const gesucht = loeschen.filter((r) => r.l).length + verschieben.filter((v) => v.ref.l).length;
  if (lwGeloescht + lwVerschoben !== gesucht) throw Object.assign(new Error(`Leichtbau: ${gesucht} Bauteile angefragt, ${lwGeloescht + lwVerschoben} gefunden – Spielstand inzwischen geändert?`), { status: 409 });
  if (aVerschoben !== verschieben.filter((v) => v.ref.a).length) throw Object.assign(new Error('Ein verschobener Akteur wurde nicht gefunden.'), { status: 409 });

  const kBuf = Buffer.concat(koepfe), dBuf = Buffer.concat(daten), n = koepfe.length;
  const sammel = b.subarray(L.kopfEnde, L.datenLaengePos); // Sammelobjekte hinter den Köpfen bleiben
  const kopfBlock = Buffer.concat([Buffer.alloc(12), kBuf, sammel]);
  kopfBlock.writeBigInt64LE(BigInt(kopfBlock.length - 8), 0); kopfBlock.writeInt32LE(n, 8);
  const datenBlock = Buffer.concat([Buffer.alloc(12), dBuf]);
  datenBlock.writeBigInt64LE(BigInt(datenBlock.length - 8), 0); datenBlock.writeInt32LE(n, 8);
  const neu = Buffer.concat([b.subarray(0, L.kopfLaengePos), kopfBlock, datenBlock, b.subarray(L.datenEnde)]);
  neu.writeBigInt64LE(BigInt(neu.length - 8), 0);
  const ausgabe = packeSpielstand(buf, header, neu, speichername);

  // Selbstprüfung
  const pr = readSave(ausgabe, { props: false });
  if (pr.objects.length !== s.objects.length - raus.size) throw new Error('Selbstprüfung: Objektanzahl weicht ab');
  const prL = new Map(pr.objects.map((o) => [o.pathName, o]));
  for (const v of verschieben) if (v.ref.a) { const o = prL.get(v.ref.a); if (!o || v.pos.some((x, j) => Math.abs(o.pos[j] - x) > 1)) throw new Error('Selbstprüfung: Lage nicht übernommen ' + v.ref.a); }
  for (const a of raus) if (prL.has(a)) throw new Error('Selbstprüfung: nicht gelöscht ' + a);
  return { ausgabe, info: { akteureGeloescht: [...raus].filter((x) => idx.has(x) && L.P[idx.get(x)].kind === 1).length - kabel, kabelGeloescht: kabel, leichtbauGeloescht: lwGeloescht, verschoben: aVerschoben + lwVerschoben, groesseMB: +(ausgabe.length / 1e6).toFixed(1) } };
}
