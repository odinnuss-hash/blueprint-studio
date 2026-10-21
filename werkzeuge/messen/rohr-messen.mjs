// Rohr-Anschlüsse messen: Wo enden Rohre (Spline-Endpunkt + Richtung) relativ zu dem Gebäude, an dessen Anschluss sie hängen?
// Ausgabe je Gebäudeklasse + Anschlussname: lokaler Versatz (cm) und Richtung der Rohr-Tangente (lokal), gemittelt über Funde.
import fs from 'node:fs';
import path from 'node:path';
import { readBlueprint } from '../../app/lib/sbp.mjs';
const qRot = (q, v) => { const [x, y, z, w] = q; const [vx, vy, vz] = v; const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz; return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; };
const inv = (q) => [-q[0], -q[1], -q[2], q[3]];
const dateien = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/^_Duplikate$/i.test(e.name)) walk(p); } else if (/.sbp$/i.test(e.name) && fs.readFileSync(p).length < 3e6) dateien.push(p); } };
for (const a of process.argv.slice(2)) fs.statSync(a).isDirectory() ? walk(a) : dateien.push(a);
const funde = {};
for (const f of dateien) {
  const bp = readBlueprint(fs.readFileSync(f));
  const byInst = new Map(bp.objects.map((o) => [o.instance, o]));
  const ents = bp.objects.filter((o) => o.kind === 'entity');
  for (const p of ents.filter((o) => /Pipeline(MK2)?(_NoIndicator)?_C$/.test(o.cls) && o.spline?.length >= 2)) {
    const komps = bp.objects.filter((o) => o.kind === 'component' && o.parent === p.instance);
    for (const k of komps) {
      const d = bp.body.toString('latin1', k.dBody, k.dEnd);
      const m = /mConnectedComponent[\s\S]*?Persistent_Level\x00[\s\S]{4}(Persistent_Level:PersistentLevel\.[^\x00]+)/.exec(d);
      if (!m) continue;
      const ziel = byInst.get(m[1]); if (!ziel) continue;
      const geb = byInst.get(ziel.parent); if (!geb || !geb.pos) continue;
      const ende = /Connection0$/.test(k.instance) ? 0 : p.spline.length - 1;
      const sp = p.spline[ende];
      const welt = qRot(p.rot, [sp[0], sp[1], sp[2]]).map((v, i) => v + p.pos[i]);
      // Richtung: Tangente am Ende (Leave am Anfang, Arrive am Ende), zeigt beim Ende 0 vom Anschluss weg
      const t = ende === 0 ? sp.slice(6, 9) : sp.slice(3, 6).map((v) => -v);
      const tw = t.length === 3 ? qRot(p.rot, t) : null;
      const lok = qRot(inv(geb.rot), welt.map((v, i) => v - geb.pos[i]));
      const dl = tw ? qRot(inv(geb.rot), tw) : null;
      const norm = dl ? Math.hypot(...dl) : 0;
      const key = `${geb.cls.replace(/^Build_|_C$/g, '')} · ${ziel.instance.split('.').pop()}`;
      (funde[key] ||= []).push({ lok: lok.map(Math.round), dir: dl && norm ? dl.map((v) => Math.round(v / norm * 100) / 100) : null, quelle: path.basename(f) });
    }
  }
}
for (const [k, l] of Object.entries(funde).sort()) {
  const z = new Map(); for (const x of l) { const key = x.lok.map((v) => Math.round(v / 5) * 5).join(","); z.set(key, (z.get(key) || 0) + 1); }
  const top = [...z.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p, n]) => `[${p}] ${Math.round(n / l.length * 100)}%`).join("  ");
  console.log(`${k.padEnd(44)} n=${String(l.length).padStart(4)}  häufigste: ${top}`);
}
