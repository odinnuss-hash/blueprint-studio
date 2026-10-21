// Ablage: Blaupausen in Ordnern (nach Namensschema + eigene) sammeln und einzeln oder ordnerweise
// fuer das Spiel aktivieren/deaktivieren.
//
//   Ablage-Ordner:  <SaveGames>\blueprints\_Ablage\<Hauptgruppe>\<Untergruppe>\…   (wird bei Bedarf angelegt)
//   aktiv:          Datei liegt im Spielstand-Ordner (blueprints\<Session>) – das Spiel findet sie.
//                   Die Zuordnung zum Ablage-Ordner merkt sich ablage.json.
//   inaktiv:        Datei liegt im Ablage-Ordner – das Spiel sieht sie nicht.
// Es wird nie geloescht, nur verschoben (.sbp und .sbpcfg gemeinsam).

import fs from 'node:fs';
import path from 'node:path';

const BAD = /[\\:*?"<>|]/;
export const sicher = (s) => typeof s === 'string' && s.length > 0 && s.length < 200 && !/[\\/:*?"<>|]/.test(s) && !s.startsWith('.');
export function sicherRel(rel) {
  if (typeof rel !== 'string' || BAD.test(rel)) return false;
  const teile = rel.split('/');
  return teile.length <= 4 && teile.every(sicher);
}

export class Ablage {
  constructor({ bpRoot, sessionDir, indexDatei, name = '_Ablage' }) {
    this.bpRoot = bpRoot; this.sessionDir = sessionDir; this.indexDatei = indexDatei; this.name = name;
  }
  get root() { return path.join(this.bpRoot(), this.name); }
  index() { try { return JSON.parse(fs.readFileSync(this.indexDatei, 'utf8')); } catch { return { aktiv: [] }; } }
  speichern(ix) { fs.mkdirSync(path.dirname(this.indexDatei), { recursive: true }); fs.writeFileSync(this.indexDatei, JSON.stringify(ix, null, 1)); }
  ordnerPfad(rel) { if (rel && !sicherRel(rel)) throw Object.assign(new Error('Ungültiger Ordner'), { status: 400 }); return path.join(this.root, ...(rel ? rel.split('/') : [])); }
  sessionPfad(s) {
    if (this.sessionDir) return this.sessionDir(s); // Spiel-Sitzung oder Bibliotheks-Ordner (lib:…)
    if (!sicher(s) || s === this.name) throw Object.assign(new Error('Ungültiger Spielstand-Ordner'), { status: 400 });
    return path.join(this.bpRoot(), s);
  }
  static istBibliothek(s) { return /^lib:/.test(s || ''); }

  /** Alle physischen Ordner (bis Tiefe 3) und ihre Blaupausen + aktive Eintraege */
  lesen() {
    const ix = this.index();
    const ordner = {};
    const walk = (rel, tiefe) => {
      const abs = this.ordnerPfad(rel);
      let list = [];
      try { list = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
      if (rel) ordner[rel] = ordner[rel] || [];
      for (const e of list) {
        if (e.isDirectory() && tiefe < 3) walk(rel ? `${rel}/${e.name}` : e.name, tiefe + 1);
        else if (rel && e.isFile() && e.name.toLowerCase().endsWith('.sbp')) { const nm = e.name.slice(0, -4); ordner[rel].push({ name: nm, aktiv: false, session: ix.herkunft?.[`${rel}/${nm}`] || null }); }
      }
    };
    walk('', 0);
    // aktive: Datei muss noch im Spielstand-Ordner liegen
    const bleiben = [];
    for (const a of ix.aktiv || []) {
      if (!fs.existsSync(path.join(this.bpRoot(), a.session, a.name + '.sbp'))) continue;
      bleiben.push(a);
      (ordner[a.ordner] = ordner[a.ordner] || []).push({ name: a.name, aktiv: true, session: a.session });
    }
    if (bleiben.length !== (ix.aktiv || []).length) { ix.aktiv = bleiben; this.speichern(ix); }
    for (const l of Object.values(ordner)) l.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    return { root: this.root, ordner, aktivIn: Object.fromEntries(bleiben.map((a) => [`${a.session}/${a.name}`, a.ordner])) };
  }

  static bewegen(vonDir, nachDir, name, neuName = name) {
    const von = path.join(vonDir, name + '.sbp'), nach = path.join(nachDir, neuName + '.sbp');
    if (!fs.existsSync(von)) throw Object.assign(new Error(`„${name}“ nicht gefunden.`), { status: 404 });
    if (fs.existsSync(nach) && von.toLowerCase() !== nach.toLowerCase()) throw Object.assign(new Error(`Im Ziel gibt es schon „${neuName}“.`), { status: 409 });
    fs.mkdirSync(nachDir, { recursive: true });
    fs.renameSync(von, nach);
    if (fs.existsSync(von + 'cfg')) { try { fs.renameSync(von + 'cfg', nach + 'cfg'); } catch (e) { fs.renameSync(nach, von); throw e; } }
  }

  static kopieren(vonDir, nachDir, name, neuName = name) {
    const von = path.join(vonDir, name + '.sbp'), nach = path.join(nachDir, neuName + '.sbp');
    if (!fs.existsSync(von)) throw Object.assign(new Error(`„${name}“ nicht gefunden.`), { status: 404 });
    if (fs.existsSync(nach)) throw Object.assign(new Error(`In der Ablage gibt es dort schon „${neuName}“.`), { status: 409 });
    fs.mkdirSync(nachDir, { recursive: true });
    fs.copyFileSync(von, nach);
    if (fs.existsSync(von + 'cfg')) fs.copyFileSync(von + 'cfg', nach + 'cfg');
  }

  /** Aus dem Spielstand-Ordner in einen Ablage-Ordner (wird dabei inaktiv); aus der Bibliothek: Kopie */
  ablegen(session, name, ordner) {
    if (!sicher(name) || !ordner) throw Object.assign(new Error('Ungültige Angabe'), { status: 400 });
    const ix = this.index();
    const neu = Ablage.codeName(name, ordner);
    if (Ablage.istBibliothek(session)) {
      // Aus der Bibliothek wird KOPIERT – das Original bleibt dort liegen
      Ablage.kopieren(this.sessionPfad(session), this.ordnerPfad(ordner), name, neu);
      return { ok: true, kopiert: true, name: neu };
    }
    Ablage.bewegen(this.sessionPfad(session), this.ordnerPfad(ordner), name, neu);
    ix.aktiv = (ix.aktiv || []).filter((a) => !(a.session === session && a.name === name));
    (ix.herkunft = ix.herkunft || {})[`${ordner}/${neu}`] = session;
    this.speichern(ix);
    return { ok: true, name: neu };
  }

  /**
   * Gruppencode des Zielordners (letzter Ordner mit „1_1 …“-Nummer, Themen-Unterordner erben ihn) in den Namen übernehmen:
   * „1_1_Haus“ nach „2_6 Fabriken/…“ → „2_6_Haus“. Namen ohne Code und Ordner ohne Code bleiben, wie sie sind.
   */
  static codeName(name, ordner) {
    const code = (ordner || '').split('/').reverse().map((t) => /^(\d+_\d+)(?=[ _-]|$)/.exec(t)?.[1]).find(Boolean);
    const m = /^(\d+_\d+)_(.+)$/.exec(name);
    return code && m && m[1] !== code ? `${code}_${m[2]}` : name;
  }

  /** Zwischen Ablage-Ordnern verschieben (aktive nur umbuchen); Gruppencode im Namen wird an den Zielordner angepasst */
  umordnen(von, name, nach) {
    if (von === nach) return { ok: true, name };
    const ix = this.index();
    const neu = Ablage.codeName(name, nach);
    const a = (ix.aktiv || []).find((x) => x.ordner === von && x.name === name);
    if (a) {
      this.ordnerPfad(nach);
      if (neu !== name) Ablage.bewegen(this.sessionPfad(a.session), this.sessionPfad(a.session), name, neu);
      a.ordner = nach; a.name = neu; this.speichern(ix);
      return { ok: true, name: neu };
    }
    Ablage.bewegen(this.ordnerPfad(von), this.ordnerPfad(nach), name, neu);
    if (ix.herkunft?.[`${von}/${name}`]) { ix.herkunft[`${nach}/${neu}`] = ix.herkunft[`${von}/${name}`]; delete ix.herkunft[`${von}/${name}`]; this.speichern(ix); }
    return { ok: true, name: neu };
  }

  /** Aktivieren = in den Spielstand-Ordner, Deaktivieren = zurueck in den Ablage-Ordner */
  schalten(ordner, namen, aktiv, session) {
    const ix = this.index(); ix.aktiv = ix.aktiv || [];
    const ergebnis = [];
    for (const name of namen) {
      try {
        const a = ix.aktiv.find((x) => x.ordner === ordner && x.name === name);
        if (aktiv) {
          if (a) { ergebnis.push({ name, ok: true }); continue; }
          const ziel = session; // immer in den gewählten Spielstand (nicht dorthin, wo sie herkam – das kann ein Sammelordner sein)
          if (!ziel || Ablage.istBibliothek(ziel)) throw Object.assign(new Error('Zum Aktivieren bitte einen Spielstand wählen – die Bibliothek sieht das Spiel nicht.'), { status: 400 });
          Ablage.bewegen(this.ordnerPfad(ordner), this.sessionPfad(ziel), name);
          ix.aktiv.push({ name, session: ziel, ordner });
        } else {
          if (!a) { ergebnis.push({ name, ok: true }); continue; }
          Ablage.bewegen(this.sessionPfad(a.session), this.ordnerPfad(ordner), name);
          ix.aktiv = ix.aktiv.filter((x) => x !== a);
        }
        ergebnis.push({ name, ok: true });
      } catch (e) { ergebnis.push({ name, ok: false, fehler: e.message }); }
    }
    this.speichern(ix);
    return { ok: ergebnis.filter((e) => e.ok).length, fehler: ergebnis.filter((e) => !e.ok) };
  }

  ordnerAnlegen(rel) {
    if (!sicherRel(rel)) throw Object.assign(new Error('Ungültiger Ordnername (keine \\ / : * ? " < > |)'), { status: 400 });
    fs.mkdirSync(this.ordnerPfad(rel), { recursive: true });
    return { ok: true, ordner: rel };
  }
  /** nur leere Ordner (ohne Dateien, ohne aktive Eintraege) */
  ordnerEntfernen(rel) {
    const abs = this.ordnerPfad(rel);
    if (!rel) throw Object.assign(new Error('Ungültig'), { status: 400 });
    const ix = this.index();
    if ((ix.aktiv || []).some((a) => a.ordner === rel || a.ordner.startsWith(rel + '/'))) throw Object.assign(new Error('Der Ordner enthält noch aktive Blaupausen.'), { status: 409 });
    let inhalt = [];
    try { inhalt = fs.readdirSync(abs); } catch { return { ok: true }; }
    if (inhalt.length) throw Object.assign(new Error('Der Ordner ist nicht leer.'), { status: 409 });
    fs.rmdirSync(abs);
    return { ok: true };
  }

  /** Umbenennen (im Spielstand- oder Ablage-Ordner); aktive Eintraege werden mitgefuehrt */
  umbenennen({ session, ordner, name, neu }) {
    if (!sicher(name) || !sicher(neu)) throw Object.assign(new Error('Ungültiger Name (keine \\ / : * ? " < > |)'), { status: 400 });
    if (name === neu) return { ok: true };
    const dir = session ? this.sessionPfad(session) : this.ordnerPfad(ordner);
    Ablage.bewegen(dir, dir, name, neu);
    if (session) {
      const ix = this.index();
      const a = (ix.aktiv || []).find((x) => x.session === session && x.name === name);
      if (a) { a.name = neu; this.speichern(ix); }
    }
    return { ok: true };
  }
}
