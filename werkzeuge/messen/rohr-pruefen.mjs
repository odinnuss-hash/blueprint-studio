// Erzeugte Blaupause prüfen: jedes Rohr – Enden (Welt), Tangenten, Abstand zum gemessenen Anschlusspunkt des verbundenen Teils
import fs from 'node:fs';
import { readBlueprint } from '../../app/lib/sbp.mjs';
const qRot = (q, v) => { const [x, y, z, w] = q; const [vx, vy, vz] = v; const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz; return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; };
// gemessene Anschlüsse (lokal)
const ANS = {
  OilRefinery: { PipeInputFactory: [-200, 900, 175], PipeOutputFactory: [-200, -900, 175] },
  Blender: { PipeInputFactory: [-200, -700, 175], PipeInputFactory1: [-600, -700, 175], PipeOutputFactory: [-600, 740, 175] },
  Packager: { PipeInputFactory: [0, -380, 375], PipeOutputFactory: [0, 350, 375] },
  WaterPump: { FGPipeConnectionFactory: [0, -460, 240] },
  PipelinePump: { Connection0: [0, 0, 0], Connection1: [0, 0, 0] },
  PipelinePumpMk2: { Connection0: [0, 0, 0], Connection1: [0, 0, 0] },
  PipeStorageTank: { ConnectionAny0: [0, 200, 175], ConnectionAny1: [0, -200, 175] },
  PipelineJunction_Cross: { Connection0: [-100, 0, 0], Connection1: [100, 0, 0], Connection2: [0, 100, 0], Connection3: [0, -100, 0] },
};
const bp = readBlueprint(fs.readFileSync(process.argv[2]));
const byInst = new Map(bp.objects.map((o) => [o.instance, o]));
for (const p of bp.objects.filter((o) => o.kind === 'entity' && /Pipeline(MK2)?(_NoIndicator)?_C$/.test(o.cls))) {
  const zeilen = [];
  const sp = p.spline || [];
  for (const k of bp.objects.filter((o) => o.kind === 'component' && o.parent === p.instance)) {
    const d = bp.body.toString('latin1', k.dBody, k.dEnd);
    const m = /mConnectedComponent[\s\S]*?Persistent_Level\x00[\s\S]{4}(Persistent_Level:PersistentLevel\.[^\x00]+)/.exec(d);
    const ende = /Connection0$/.test(k.instance) ? 0 : sp.length - 1;
    const pt = sp[ende]; if (!pt) continue;
    const welt = qRot(p.rot, pt.slice(0, 3)).map((v, i) => Math.round(v + p.pos[i]));
    let info = 'offen';
    if (m) {
      const ziel = byInst.get(m[1]), geb = ziel && byInst.get(ziel.parent);
      const kurz = geb?.cls.replace(/^Build_|_C$/g, ''), an = ziel?.instance.split('.').pop();
      const lok = ANS[kurz]?.[an];
      if (lok) { const soll = qRot(geb.rot, lok).map((v, i) => Math.round(v + geb.pos[i])); info = `${kurz}.${an} Abstand ${Math.round(Math.hypot(...soll.map((v, i) => v - welt[i])))} cm`; }
      else info = `${kurz}.${an} (kein Messwert)`;
    }
    zeilen.push(`   Ende ${ende}: [${welt}] → ${info}`);
  }
  const tang = sp.map((q) => q.length >= 9 ? `A[${q.slice(3, 6).map(Math.round)}] L[${q.slice(6, 9).map(Math.round)}]` : '–').join(' | ');
  console.log(`${p.cls.replace(/^Build_|_C$/g, '')} pos [${p.pos.map(Math.round)}] Punkte ${sp.length}: ${sp.map((q) => '[' + q.slice(0, 3).map(Math.round) + ']').join(' ')}  Tangenten ${tang}`);
  console.log(zeilen.join('\n'));
}
