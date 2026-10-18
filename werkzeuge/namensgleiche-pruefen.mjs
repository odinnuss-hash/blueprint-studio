// Prüft die Blaupausen, die im Ordnen-Trockenlauf denselben neuen Namen bekämen: gleicher Inhalt oder nur gleicher Name?
// Aufruf: node werkzeuge/namensgleiche-pruefen.mjs   (liest userdata/ordnen-vorschau-<datum>.json)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readBlueprint } from '../app/lib/sbp.mjs';
import { merkmale, aehnlichkeit } from '../app/lib/ordnen.mjs';

const datei = fs.readdirSync('userdata').filter((f) => /^ordnen-vorschau-.*\.json$/.test(f)).sort().pop();
const b = JSON.parse(fs.readFileSync(path.join('userdata', datei), 'utf8'));
const gruppen = {};
for (const r of b.liste.filter((x) => x.nameMehrfach)) (gruppen[r.neu.toLowerCase()] ||= []).push(r);
const lies = (r) => {
  const buf = fs.readFileSync(path.join(b.ordner, r.datei + '.sbp'));
  return { md5: crypto.createHash('md5').update(buf).digest('hex'), m: merkmale(readBlueprint(buf), null) };
};
const out = [];
for (const [neu, rs] of Object.entries(gruppen)) {
  const d = rs.map((r) => ({ r, ...lies(r) }));
  const paare = [];
  for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) {
    const a = d[i], c = d[j];
    paare.push({ a: a.r.datei, b: c.r.datei, byteGleich: a.md5 === c.md5, gleicheBauteile: a.m.sig === c.m.sig, form: Math.round(aehnlichkeit(a.m.sk, c.m.sk) * 100), teile: [a.m.n, c.m.n], masse: [a.m.dim.join('×'), c.m.dim.join('×')] });
  }
  out.push({ neu: rs[0].neu, anzahl: rs.length, paare });
}
const alle = out.flatMap((g) => g.paare);
console.log(JSON.stringify({ namensgruppen: out.length, paare: alle.length, byteGleich: alle.filter((p) => p.byteGleich).length, form99: alle.filter((p) => p.form >= 99).length, form90: alle.filter((p) => p.form >= 90 && p.form < 99).length, verschieden: alle.filter((p) => p.form < 90).length }));
for (const g of out) for (const p of g.paare) console.log(`${p.form.toString().padStart(3)}%  ${p.gleicheBauteile ? 'gleiche Teile' : 'andere Teile '}  ${g.neu}  |  ${p.a} (${p.teile[0]}, ${p.masse[0]})  ↔  ${p.b} (${p.teile[1]}, ${p.masse[1]})`);
