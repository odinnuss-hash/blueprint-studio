// Wie eng bauen echte Blaupausen? Je Maschinenklasse:
//  1. Abstand zum nächsten gleichen, gleich gedrehten Nachbarn in einer Reihe (Mitte–Mitte, lokal X bzw. Y)
//  2. Verteiler/Sammler am Anschluss: Teil am anderen Ende des Bands/Rohrs ab Maschinenanschluss (Klasse, lokale Lage)
//     → Zuleitungslänge (Abstand Anschluss → Splitter/Merger/Kreuzung) und Höhe
//  3. Abstand paralleler Verteilerleitungen vor derselben Maschine (verschiedene Eingänge, Splitter-Lage lokal Y/Z)
import fs from 'node:fs';
import path from 'node:path';
import { readBlueprint } from '../../app/lib/sbp.mjs';
const qRot = (q, v) => { const [x, y, z, w] = q; const [vx, vy, vz] = v; const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz; return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; };
const inv = (q) => [-q[0], -q[1], -q[2], q[3]];
const MASCH = /^Build_(SmelterMk1|ConstructorMk1|AssemblerMk1|FoundryMk1|ManufacturerMk1|OilRefinery|Blender|Packager|Converter)_C$/;
const dateien = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/^_Duplikate$/i.test(e.name)) walk(p); } else if (/\.sbp$/i.test(e.name) && fs.statSync(p).size < 4e6) dateien.push(p); } };
walk(process.argv[2]);
const z = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const nachbar = {}, zuleitung = {}, parallel = {}, quellen = {};
for (const f of dateien) {
  let bp; try { bp = readBlueprint(fs.readFileSync(f)); } catch { continue; }
  const byInst = new Map(bp.objects.map((o) => [o.instance, o]));
  const verb = new Map(); // Komponente → verbundene Komponente
  for (const o of bp.objects) if (o.kind === 'component' && /FactoryConnection|PipeConnection/.test(o.typePath)) {
    const d = bp.body.toString('latin1', o.dBody, o.dEnd);
    const m = /mConnectedComponent[\s\S]*?Persistent_Level\x00[\s\S]{4}(Persistent_Level:PersistentLevel\.[^\x00]+)/.exec(d);
    if (m) verb.set(o.instance, m[1]);
  }
  const komp = new Map(); for (const o of bp.objects) if (o.kind === 'component') { if (!komp.has(o.parent)) komp.set(o.parent, []); komp.get(o.parent).push(o); }
  const masch = bp.objects.filter((o) => o.kind === 'entity' && MASCH.test(o.cls));
  if (!masch.length) continue;
  let genutzt = false;
  for (const m of masch) {
    const kurz = m.cls.replace(/^Build_|Mk1|_C$/g, '');
    // 1. Nachbar
    let best = null;
    for (const n of masch) if (n !== m && n.cls === m.cls && Math.abs(n.rot[2] * m.rot[2] + n.rot[3] * m.rot[3]) > 0.999) {
      const l = qRot(inv(m.rot), n.pos.map((v, i) => v - m.pos[i]));
      if (Math.abs(l[2]) > 50) continue;
      const d = Math.hypot(l[0], l[1]); if (!best || d < best.d) best = { d, l };
    }
    if (best) { const ax = Math.abs(best.l[0]) > Math.abs(best.l[1]) ? 'X' : 'Y'; if (Math.min(Math.abs(best.l[0]), Math.abs(best.l[1])) < 50) z(nachbar, `${kurz} entlang ${ax}: ${Math.round(best.d / 50) * 50}`); }
    // 2./3. Anschlüsse
    const lagen = {};
    for (const c of komp.get(m.instance) || []) {
      const port = c.instance.slice(m.instance.length + 1);
      if (!/Input|Output|Pipe/.test(port)) continue;
      const b = verb.get(c.instance); if (!b) continue;
      const leitung = byInst.get(byInst.get(b)?.parent); if (!leitung) continue;
      if (!/ConveyorBelt|Pipeline(MK2)?(_NoIndicator)?_C$/.test(leitung.cls)) { z(quellen, `${kurz}.${port} direkt an ${leitung.cls.replace(/^Build_|_C$/g, '')}`); continue; }
      const andere = (komp.get(leitung.instance) || []).find((k) => k.instance !== b && /Connection|ConveyorAny/.test(k.instance));
      const ziel = andere && byInst.get(byInst.get(verb.get(andere.instance))?.parent);
      if (!ziel) continue;
      const zk = ziel.cls.replace(/^Build_|_C$/g, '').replace(/ConveyorAttachment|PipelineJunction_/, '');
      z(quellen, `${kurz} ${/Pipe/.test(port) ? 'Rohr' : 'Band'} → ${zk}`);
      if (!/Splitter|Merger|Cross|Lift|Pipeline/.test(zk)) continue;
      if (/Pipeline/.test(zk)) continue;
      const l = qRot(inv(m.rot), ziel.pos.map((v, i) => v - m.pos[i])).map((v) => Math.round(v / 50) * 50);
      const sp = leitung.spline || []; let len = 0; for (let i = 1; i < sp.length; i++) len += Math.hypot(sp[i][0] - sp[i - 1][0], sp[i][1] - sp[i - 1][1], sp[i][2] - sp[i - 1][2]);
      z(zuleitung, `${kurz}.${port} → ${zk}: Länge ${Math.round(len / 50) * 50}, Teil lokal y ${l[1]} z ${l[2]}`);
      lagen[port] = l; genutzt = true;
    }
    // parallele Leitungen: lokale Y/Z-Abstände der Verteiler verschiedener Eingänge (gleiche Seite)
    const ps = Object.entries(lagen).filter(([p]) => /Input|PipeInput/.test(p)).map(([, l]) => l).sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]));
    for (let i = 1; i < ps.length; i++) if (Math.sign(ps[i][1]) === Math.sign(ps[0][1])) z(parallel, `${kurz}: ΔY ${Math.abs(ps[i][1] - ps[i - 1][1])} ΔZ ${ps[i][2] - ps[i - 1][2]}`);
  }
  if (genutzt) z(quellen, '#Dateien mit Messwerten');
}
const top = (o, filt, n) => Object.entries(o).filter(([k]) => filt.test(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `  ${String(v).padStart(4)}× ${k}`).join('\n');
console.log('Dateien:', dateien.length, '| mit Messwerten:', quellen['#Dateien mit Messwerten']);
for (const k of ['Smelter', 'Constructor', 'Assembler', 'Foundry', 'Manufacturer', 'OilRefinery', 'Blender', 'Packager']) {
  console.log(`\n=== ${k}\nNachbar:\n${top(nachbar, new RegExp('^' + k + ' '), 4)}\nZuleitung:\n${top(zuleitung, new RegExp('^' + k + '\\.'), 8)}\nParallel:\n${top(parallel, new RegExp('^' + k + ':'), 4)}\nAnschluss an:\n${top(quellen, new RegExp('^' + k + ' '), 5)}`);
}
