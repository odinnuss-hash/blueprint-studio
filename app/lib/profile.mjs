// Profile: globale Arbeitsbereiche der App. Genau ein Profil ist aktiv; der Arbeitsstand (Planer mit allen Fabriken,
// Baukasten-Reißbrett) wird laufend automatisch darin gespeichert. Je Profil gibt es „Ideen“: benannte Planungsstände
// (Planer, Reißbrett, Auswahl von Blaupausen), die einzeln oder zusammen wieder geladen werden – Blaupausen kommen dabei
// über die Ablage ins Spiel, andere aktive bleiben, wie sie sind.
// Ablage: userdata/profile/<id>.json, aktives Profil in userdata/profile/_aktiv.json. Löschen verschiebt nach
// userdata/papierkorb/profile (nichts geht verloren).
import fs from 'fs';
import path from 'path';

const fehler = (msg, status = 400) => Object.assign(new Error(msg), { status });
const ID_RX = /^[a-z0-9-]{4,80}$/;
const AUTO_MAX = 3; // automatische Sicherungen („vor dem Laden“) je Profil
const neueId = (name, vor = '') => vor + (String(name || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'p') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const nameOk = (name) => { const n = String(name || '').trim(); if (!n || n.length > 80) throw fehler('Bitte einen Namen (höchstens 80 Zeichen) angeben.'); return n; };
const bpListe = (l) => (Array.isArray(l) ? l : []).filter((b) => b && typeof b.name === 'string' && b.name && typeof b.session === 'string')
  .map((b) => ({ name: b.name, session: b.session, ordner: typeof b.ordner === 'string' && b.ordner ? b.ordner : null }));
/** Kurzinfo eines Planer-/Reißbrett-Stands */
const inhalt = (x) => {
  const fabriken = x?.planer?.welt?.fabriken || (x?.planer?.plan ? [{ name: 'Plan', plan: x.planer.plan }] : []);
  return { fabriken: fabriken.map((f) => f.name), ziele: fabriken.reduce((a, f) => a + (f.plan?.ziele?.filter((z) => z.item && z.menge > 0).length || 0), 0),
    baukasten: x?.baukasten?.teile?.length || 0, blaupausen: (x?.blaupausen || []).length };
};

export class Profile {
  /** deps: { dir, papierkorb, ablage, bpRoot(), spielSitzungen() } */
  constructor({ dir, papierkorb, ablage, bpRoot, spielSitzungen }) {
    Object.assign(this, { dir, papierkorb, ablage, bpRoot, spielSitzungen });
  }
  datei(id) { if (!ID_RX.test(id || '')) throw fehler('Ungültiges Profil'); return path.join(this.dir, id + '.json'); }
  get aktivDatei() { return path.join(this.dir, '_aktiv.json'); }

  /** Profil lesen; ältere Form (ein Stand je Datei) wird zu einem Profil mit einer Idee */
  roh(id) {
    let p; try { p = JSON.parse(fs.readFileSync(this.datei(id), 'utf8')); } catch (e) { if (e.status) throw e; throw fehler('Profil nicht gefunden.', 404); }
    if (!Array.isArray(p.ideen)) p = { id: p.id, name: p.name, zeit: p.zeit, arbeitsstand: { planer: p.planer || null, baukasten: p.baukasten || null },
      ideen: [{ id: neueId(p.name, 'i-'), name: p.name, notiz: p.notiz || '', zeit: p.zeit, auto: !!p.auto, planer: p.planer || null, baukasten: p.baukasten || null, blaupausen: bpListe(p.blaupausen) }] };
    return p;
  }
  schreiben(p) { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(this.datei(p.id), JSON.stringify(p)); }
  ids() { try { return fs.readdirSync(this.dir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).map((f) => f.slice(0, -5)).filter((id) => ID_RX.test(id)); } catch { return []; } }
  aktivId() { try { const id = JSON.parse(fs.readFileSync(this.aktivDatei, 'utf8')).id; return id && fs.existsSync(this.datei(id)) ? id : null; } catch { return null; } }
  setzeAktiv(id) { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(this.aktivDatei, JSON.stringify({ id })); }

  /** Einmalig: Dateien im alten Format (ein Stand je Datei, vom 29.10. vormittags) als Ideen in ein Profil „Mein Profil“
   *  übernehmen; die alten Dateien kommen in den Papierkorb (userdata/papierkorb/profile/altes-format). */
  umziehen() {
    const alte = [];
    for (const id of this.ids()) { try { const p = JSON.parse(fs.readFileSync(this.datei(id), 'utf8')); if (!Array.isArray(p.ideen)) alte.push(p); } catch { /* egal */ } }
    if (!alte.length) return;
    let ziel = this.aktivId() ? this.roh(this.aktivId()) : null;
    if (!ziel) { const r = this.anlegen('Mein Profil', null); ziel = this.roh(r.id); }
    alte.sort((a, b) => a.zeit - b.zeit);
    for (const p of alte) ziel.ideen.push({ id: neueId(p.name, 'i-'), name: p.name, notiz: p.notiz || '', zeit: p.zeit, auto: !!p.auto, planer: p.planer || null, baukasten: p.baukasten || null, blaupausen: bpListe(p.blaupausen) });
    const letzter = alte.filter((p) => !p.auto).pop() || alte[alte.length - 1];
    if (!ziel.arbeitsstand?.planer && !ziel.arbeitsstand?.baukasten) ziel.arbeitsstand = { planer: letzter.planer || null, baukasten: letzter.baukasten || null };
    this.schreiben(ziel);
    const pk = path.join(this.papierkorb, 'altes-format'); fs.mkdirSync(pk, { recursive: true });
    for (const p of alte) try { fs.renameSync(this.datei(p.id), path.join(pk, p.id + '.json')); } catch { /* egal */ }
  }

  liste() {
    this.umziehen();
    const aktiv = this.aktivId(), out = [];
    for (const id of this.ids()) {
      try {
        const p = this.roh(id);
        out.push({ id: p.id, name: p.name, zeit: p.zeit, aktiv: p.id === aktiv, arbeitsstand: inhalt(p.arbeitsstand),
          ideen: p.ideen.map((i) => ({ id: i.id, name: i.name, notiz: i.notiz || '', zeit: i.zeit, auto: !!i.auto, inhalt: inhalt(i) })).sort((a, b) => (a.auto - b.auto) || b.zeit - a.zeit) });
      } catch { /* defekte Datei überspringen */ }
    }
    return { aktiv, profile: out.sort((a, b) => (b.aktiv - a.aktiv) || a.name.localeCompare(b.name, 'de')) };
  }

  /** Neues Profil anlegen und aktiv setzen (mit dem übergebenen Arbeitsstand, sonst leer) */
  anlegen(name, arbeitsstand = null) {
    const p = { id: neueId(nameOk(name)), name: nameOk(name), zeit: Date.now(), arbeitsstand: arbeitsstand || { planer: null, baukasten: null }, ideen: [] };
    this.schreiben(p); this.setzeAktiv(p.id);
    return { ok: true, id: p.id, arbeitsstand: p.arbeitsstand };
  }
  /** Aktives Profil wechseln: Arbeitsstand des neuen Profils zurückgeben (der alte wurde vorher gespeichert) */
  aktivieren(id) { const p = this.roh(id); this.setzeAktiv(id); return { ok: true, id, name: p.name, arbeitsstand: p.arbeitsstand || { planer: null, baukasten: null } }; }
  /** Laufendes Speichern des Arbeitsstands ins aktive Profil (ohne aktives Profil wird „Mein Profil“ angelegt) */
  arbeitsstand({ planer = null, baukasten = null }) {
    this.umziehen();
    const id = this.aktivId();
    if (!id) return { ...this.anlegen('Mein Profil', { planer, baukasten }), neu: true };
    const p = this.roh(id); p.arbeitsstand = { planer, baukasten }; p.zeit = Date.now(); this.schreiben(p);
    return { ok: true, id, name: p.name };
  }
  profilUmbenennen(id, name) { const p = this.roh(id); p.name = nameOk(name); this.schreiben(p); return { ok: true }; }
  profilLoeschen(id) {
    const von = this.datei(id); if (!fs.existsSync(von)) throw fehler('Profil nicht gefunden.', 404);
    fs.mkdirSync(this.papierkorb, { recursive: true });
    fs.renameSync(von, path.join(this.papierkorb, `${id}-${Date.now()}.json`));
    if (this.aktivId() === null) try { fs.unlinkSync(this.aktivDatei); } catch { /* egal */ }
    return { ok: true, wohin: this.papierkorb };
  }

  /** Idee speichern (neu oder überschreiben) – im angegebenen oder im aktiven Profil */
  ideeSpeichern({ profil, idee, name, notiz = '', planer = null, baukasten = null, blaupausen = [], auto = false }) {
    let pid = profil || this.aktivId();
    if (!pid) pid = this.anlegen('Mein Profil', { planer, baukasten }).id;
    const p = this.roh(pid);
    const i = { id: idee || neueId(name, 'i-'), name: nameOk(name), notiz: String(notiz || '').slice(0, 2000), zeit: Date.now(), auto: !!auto, planer, baukasten, blaupausen: bpListe(blaupausen) };
    const k = idee ? p.ideen.findIndex((x) => x.id === idee) : -1;
    if (idee && k < 0) throw fehler('Idee nicht gefunden.', 404);
    if (k >= 0) p.ideen[k] = i; else p.ideen.push(i);
    if (auto) { const autos = p.ideen.filter((x) => x.auto).sort((a, b) => b.zeit - a.zeit); const weg = new Set(autos.slice(AUTO_MAX).map((x) => x.id)); if (weg.size) { this.papier(p, p.ideen.filter((x) => weg.has(x.id))); p.ideen = p.ideen.filter((x) => !weg.has(x.id)); } }
    this.schreiben(p);
    return { ok: true, profil: pid, idee: i.id };
  }
  ideeUmbenennen(profil, idee, name) { const p = this.roh(profil), i = p.ideen.find((x) => x.id === idee); if (!i) throw fehler('Idee nicht gefunden.', 404); i.name = nameOk(name); i.auto = false; this.schreiben(p); return { ok: true }; }
  ideeLoeschen(profil, idee) {
    const p = this.roh(profil), i = p.ideen.find((x) => x.id === idee); if (!i) throw fehler('Idee nicht gefunden.', 404);
    this.papier(p, [i]); p.ideen = p.ideen.filter((x) => x !== i); this.schreiben(p);
    return { ok: true, wohin: this.papierkorb };
  }
  papier(p, ideen) { fs.mkdirSync(this.papierkorb, { recursive: true }); for (const i of ideen) fs.writeFileSync(path.join(this.papierkorb, `${p.id}--${i.id}-${Date.now()}.json`), JSON.stringify({ profil: p.name, ...i })); }
  idee(profil, idee) { const p = this.roh(profil), i = p.ideen.find((x) => x.id === idee); if (!i) throw fehler('Idee nicht gefunden.', 404); return i; }

  /** Alle Blaupausen zur Auswahl: Ablage (aktiv/inaktiv, mit Ordner) und lose Blaupausen in den Spielstand-Ordnern */
  async kandidaten() {
    const ab = this.ablage.lesen(), out = [], gesehen = new Set();
    for (const [ordner, liste] of Object.entries(ab.ordner || {})) for (const b of liste) {
      out.push({ name: b.name, ordner, session: b.session || null, aktiv: !!b.aktiv });
      if (b.aktiv && b.session) gesehen.add(b.session + '/' + b.name);
    }
    const sitz = await this.spielSitzungen();
    for (const s of sitz) {
      let dateien = []; try { dateien = fs.readdirSync(path.join(this.bpRoot(), s.name)).filter((f) => f.toLowerCase().endsWith('.sbp')); } catch { continue; }
      for (const f of dateien) { const name = f.slice(0, -4); if (!gesehen.has(s.name + '/' + name)) out.push({ name, ordner: null, session: s.name, aktiv: true }); }
    }
    return { blaupausen: out, sitzungen: sitz.map((s) => s.name) };
  }

  /** Ideen laden: deren Blaupausen ins Spiel holen (andere bleiben). Rückgabe: volle Ideen + Ergebnis je Blaupause */
  async ideenLaden(profil, ideenIds) {
    const p = this.roh(profil);
    const ideen = (ideenIds || []).map((id) => p.ideen.find((x) => x.id === id)).filter(Boolean);
    if (!ideen.length) throw fehler('Keine Idee gewählt.');
    const sitzungen = new Set((await this.spielSitzungen()).map((s) => s.name));
    const ergebnis = [], schon = new Set();
    const imSpiel = (b) => fs.existsSync(path.join(this.bpRoot(), b.session, b.name + '.sbp'));
    for (const b of ideen.flatMap((i) => i.blaupausen || [])) {
      const key = b.session + '/' + b.name; if (schon.has(key)) continue; schon.add(key);
      try {
        if (!sitzungen.has(b.session)) { ergebnis.push({ ...b, stand: 'fehlt', text: `Spielstand „${b.session}“ nicht gefunden` }); continue; }
        if (imSpiel(b)) { ergebnis.push({ ...b, stand: 'da', text: 'schon im Spiel' }); continue; }
        const ab = this.ablage.lesen();
        let ordner = b.ordner && (ab.ordner[b.ordner] || []).some((x) => x.name === b.name && !x.aktiv) ? b.ordner : null;
        if (!ordner) ordner = Object.entries(ab.ordner || {}).find(([, l]) => l.some((x) => x.name === b.name && !x.aktiv))?.[0] || null;
        if (!ordner) {
          const woanders = Object.values(ab.ordner || {}).flat().find((x) => x.name === b.name && x.aktiv);
          ergebnis.push({ ...b, stand: woanders ? 'da' : 'fehlt', text: woanders ? `schon im Spiel (Spielstand „${woanders.session}“)` : 'nicht gefunden – weder im Spielstand noch in der Ablage' });
          continue;
        }
        const r = this.ablage.schalten(ordner, [b.name], true, b.session);
        if (r.fehler?.length) ergebnis.push({ ...b, stand: 'fehler', text: r.fehler[0].fehler });
        else ergebnis.push({ ...b, ordner, stand: 'geholt', text: `aus der Ablage ins Spiel geholt (${ordner})` });
      } catch (e) { ergebnis.push({ ...b, stand: 'fehler', text: e.message }); }
    }
    return { ideen, ergebnis };
  }
}
