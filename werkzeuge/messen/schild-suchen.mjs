// Schilder mit Textfeld „Name“ in Blaupausen vor 1.2 (≤ v52) finden: Klasse, Layout, Version, Datei
import fs from 'node:fs';
import path from 'node:path';
import { readBlueprint } from '../../app/lib/sbp.mjs';
const dateien = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/^_Duplikate$/i.test(e.name)) walk(p); } else if (/\.sbp$/i.test(e.name) && fs.statSync(p).size < 1e6) dateien.push(p); } };
walk(process.argv[2]);
const funde = {};
for (const f of dateien) {
  let bp; try { bp = readBlueprint(fs.readFileSync(f), { props: false }); } catch { continue; }
  if (bp.header.saveVersion > 52) continue;
  for (const o of bp.objects.filter((x) => x.kind === 'entity' && /StandaloneWidgetSign_(SmallVeryWide|SmallWide|Medium)/.test(x.cls))) {
    const t = bp.body.toString('latin1', o.dBody, o.dEnd);
    const lay = /SignLayouts\/(BPW_[A-Za-z0-9_]+)/.exec(t)?.[1];
    if (!/ElementName\x00[\s\S]{0,40}Name\x00/.test(t)) continue;
    const k = `${o.cls.replace(/^Build_|_C$/g, '')} ${lay} v${bp.header.saveVersion}`;
    (funde[k] ||= []).push(path.basename(f));
  }
}
for (const [k, l] of Object.entries(funde).sort((a, b) => b[1].length - a[1].length).slice(0, 12)) console.log(`${String(l.length).padStart(4)}× ${k}  z. B. ${l[0]}`);
