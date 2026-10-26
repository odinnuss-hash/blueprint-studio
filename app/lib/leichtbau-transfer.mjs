// Leichtbau von Save zu Save: Transform, Material, Muster, Farben und Zusatzdaten
// bleiben erhalten. Nur der sitzungsfremde Blueprint-Proxy wird gelöst.
import {readSave, readLightweight} from './sav.mjs';
import {leichtbauLage} from './spielstand-aendern.mjs';
import {hauptLevel,packeSpielstand} from './spielstand-einfuegen.mjs';
const i32=v=>{const b=Buffer.alloc(4);b.writeInt32LE(v);return b;};
const lwObj=s=>s.objects.find(o=>/LightweightBuildableSubsystem$/.test(o.typePath));
export function imBereich(b,p) {
 if(p[0]<Math.min(b.x0,b.x1)||p[0]>Math.max(b.x0,b.x1)||p[1]<Math.min(b.y0,b.y1)||p[1]>Math.max(b.y0,b.y1))return false;
 if(Number.isFinite(b.z0)&&p[2]<b.z0 || Number.isFinite(b.z1)&&p[2]>b.z1)return false;
 if(!Array.isArray(b.poly)||b.poly.length<3)return true;
 let c=false;for(let i=0,j=b.poly.length-1;i<b.poly.length;j=i++){
  const [xi,yi]=b.poly[i],[xj,yj]=b.poly[j];if((yi>p[1])!==(yj>p[1])&&p[0]<(xj-xi)*(p[1]-yi)/(yj-yi)+xi)c=!c;
 }return c;
}
export function leichtbauUebertragen(quelle,ziel,bereich,{ohne=new Set(),speichername,auswahl}={}) {
 const s=readSave(quelle,{props:false}),t=readSave(ziel,{props:false}),so=lwObj(s),to=lwObj(t);
 if(!so)return {ausgabe:ziel,info:{leichtbau:0}};
 const a=leichtbauLage(s.body,so),incoming=new Map();let count=0;
 for(const kl of a.klassen){
  if(ohne.has(kl.typePath.split('.').pop()))continue;
  const entries=[];
  for(const [index,e] of kl.eintraege.entries()){
   const pos=[0,1,2].map(j=>s.body.readDoubleLE(e.a+32+j*8));if(!imBereich(bereich,pos)||auswahl&&!auswahl(kl.typePath,index,pos))continue;
   entries.push(Buffer.concat([s.body.subarray(e.a,e.proxyA),Buffer.alloc(8),s.body.subarray(e.proxyE,e.e)]));count++;
  }
  if(entries.length)incoming.set(kl.typePath,{head:s.body.subarray(kl.ka,kl.anzPos),entries});
 }
 if(!count)return {ausgabe:ziel,info:{leichtbau:0}};
 if(!to)throw Object.assign(new Error('Ziel besitzt kein Leichtbau-Subsystem. Bitte einmal im aktuellen Spiel speichern.'),{status:422});
 const b=leichtbauLage(t.body,to);
 if(a.version!==b.version)throw Object.assign(new Error(`Leichtbau-Format ${a.version} → ${b.version} noch nicht freigegeben. Quelle zuerst im aktuellen Spiel neu speichern.`),{status:422});
 const chunks=[Buffer.from(t.body.subarray(to.dBody,b.kopfEnde))];let classes=0;
 for(const kl of b.klassen){
  const extra=incoming.get(kl.typePath)?.entries||[];
  chunks.push(t.body.subarray(kl.ka,kl.anzPos),i32(kl.eintraege.length+extra.length));
  for(const e of kl.eintraege)chunks.push(t.body.subarray(e.a,e.e));
  for(const e of extra)chunks.push(e);
  incoming.delete(kl.typePath);classes++;
 }
 for(const {head,entries} of incoming.values()){chunks.push(head,i32(entries.length));for(const e of entries)chunks.push(e);classes++;}
 chunks[0].writeInt32LE(classes,chunks[0].length-4);
 const data=Buffer.concat(chunks),L=hauptLevel(t),delta=data.length-(to.dEnd-to.dBody);
 const body=Buffer.concat([t.body.subarray(0,to.dBody),data,t.body.subarray(to.dEnd)]);
 body.writeInt32LE(data.length,to.dBody-4);body.writeBigInt64LE(t.body.readBigInt64LE(L.datenLaengePos)+BigInt(delta),L.datenLaengePos);body.writeBigInt64LE(BigInt(body.length-8),0);
 const ausgabe=packeSpielstand(ziel,t.header,body,speichername),pr=readSave(ausgabe,{props:false});
 const before=readLightweight(t.body,to,()=>{}),after=readLightweight(pr.body,lwObj(pr),()=>{});
 if(after!==before+count||pr.objects.length!==t.objects.length)throw new Error('Leichtbau-Selbstprüfung: Anzahl falsch');
 for(let i=0;i<t.objects.length;i++){
  const x=t.objects[i],y=pr.objects[i];if(x.pathName!==y.pathName||x!==to&&x.dBody!==undefined&&!t.body.subarray(x.dBody,x.dEnd).equals(pr.body.subarray(y.dBody,y.dEnd)))throw new Error('Leichtbau-Selbstprüfung: anderes Objekt verändert');
 }
 return {ausgabe,info:{leichtbau:count}};
}
