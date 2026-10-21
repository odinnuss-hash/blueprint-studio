import fs from 'node:fs';
import { readBlueprint } from '../../app/lib/sbp.mjs';
import { zerlege } from '../../app/lib/eigenschaften.mjs';
for (const f of process.argv.slice(2)) {
  const bp = readBlueprint(fs.readFileSync(f));
  const s = bp.objects.filter((o) => o.kind === 'entity' && /WidgetSign/.test(o.cls));
  const d = bp.body.subarray(s[0].dBody, s[0].dEnd);
  const z = zerlege(Buffer.from(d), true);
  const farbe = (n) => { const p = z.props.find((x) => x.name === n); return p ? [0, 1, 2, 3].map((i) => Math.round(Buffer.from(d).readFloatLE(p.valStart + i * 4) * 100) / 100) : '-'; };
  console.log(f.split('/').pop(), 'Schrift', farbe('mForegroundColor'), 'Grund', farbe('mBackgroundColor'), 'Schilder', s.length);
}
