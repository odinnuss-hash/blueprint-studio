import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {chromium} from 'file:///C:/Users/tim_t/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const data=fs.mkdtempSync(path.resolve('test-ergebnisse/startseite/runtime-'));
fs.mkdirSync(path.join(data,'saves','blueprints'),{recursive:true});
const cfg=JSON.parse(fs.readFileSync('userdata/einstellungen.json','utf8'));
Object.assign(cfg,{saveDir:path.join(data,'saves'),bibliotheken:[],megaprints:[],updatePruefen:false});
fs.writeFileSync(path.join(data,'einstellungen.json'),JSON.stringify(cfg));
for(const name of ['katalog-cache.json','katalog-cache-de.json','.setup-done','.einrichtung-gesehen'])if(fs.existsSync('userdata/'+name))fs.copyFileSync('userdata/'+name,path.join(data,name));
fs.cpSync('userdata/kartenbild',path.join(data,'kartenbild'),{recursive:true});
const server=spawn(process.execPath,['app/server.mjs'],{env:{...process.env,BS_DATA_DIR:data,BS_PORT:'37479'},windowsHide:true,stdio:'pipe'});
let log='';server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);let browser;
try{
 for(let i=0;i<50;i++){try{if((await fetch('http://127.0.0.1:37479/api/ping')).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1600,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.stack));
 await page.goto('http://127.0.0.1:37479');await page.waitForSelector('#bs-startseite[data-stil=kommandobruecke]');
 await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
 await page.waitForSelector('.home-real-map.ready');await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll('.home-art image')].map(e=>new Promise(resolve=>{const i=new Image();i.onload=resolve;i.onerror=resolve;i.src=e.getAttribute('href')})))});
 await page.screenshot({path:'test-ergebnisse/startseite/app-kommandobruecke.png'});
 await page.locator('[data-home-settings]').click();await page.locator('[data-settings-category=darstellung]').click();await page.locator('#set-startseite').selectOption('atlas');await page.locator('#set-cancel').click();
 await page.reload();await page.waitForSelector('#bs-startseite[data-stil=atlas]');await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
 await page.locator('[data-home-mode=bibliothek]').click();await page.waitForSelector('#dlg-ablage[open]');await page.locator('#ab-gross-zu').click();
 await page.locator('button[aria-controls=bs-startseite]').click();await page.locator('[data-home-mode=karte]').click();assert.ok(await page.locator('#view-karte').isVisible());assert.ok(await page.locator('#bs-startseite').isHidden());
 await page.locator('button[aria-controls=bs-startseite]').click();await page.locator('[data-home-mode=welt]').click();assert.ok(await page.locator('#view-welt').isVisible());
 await page.locator('button[aria-controls=bs-startseite]').click();await page.locator('[data-home-mode=planer]').click();assert.ok(await page.locator('#view-planer').isVisible());
 for(const style of ['werkhalle','atlas','kommandobruecke']) {
 await page.locator('#btn-settings').click();await page.locator('[data-settings-category=darstellung]').click();await page.locator('#set-startseite').selectOption(style);
 assert.equal(await page.locator('html').getAttribute('data-design'),style);
 await page.locator('#set-cancel').click();
 for(const mode of ['editor','katalog','ordnen','karte','welt','planer','hilfe']) {
  await page.locator('#mode-'+mode).click();assert.ok(await page.locator('#view-'+mode).isVisible());
  assert.equal(await page.locator('html').getAttribute('data-design'),style);
 }
 await page.waitForFunction(s=>document.getElementById('hilfe-frame').contentDocument?.documentElement.dataset.design===s,style);
 await page.locator('#mode-katalog').click();await page.screenshot({path:'test-ergebnisse/startseite/design-'+style+'.png'});
}
await page.locator('#btn-settings').click();
assert.equal(await page.locator('.settings-kachel:visible').count(),6);
assert.equal(await page.locator('.settings-detail:visible').count(),0);
await page.screenshot({path:'test-ergebnisse/startseite/einstellungen-kacheln.png'});
for(const category of ['dateien','ablage','editor','updates','einrichtung','darstellung']) {
 await page.locator(`[data-settings-category=${category}]`).click();
 assert.equal(await page.locator('.settings-detail:visible').count(),1);
 if(category==='dateien') await page.locator('#set-lib').fill('Testentwurf');
 await page.locator('.settings-zurueck').click();
}
await page.locator('[data-settings-category=dateien]').click();assert.equal(await page.locator('#set-lib').inputValue(),'Testentwurf');await page.locator('.settings-zurueck').click();
await page.locator('[data-settings-category=darstellung]').click();
await page.locator('[data-design-choice=atlas]').hover();
assert.ok((await page.locator('.settings-preview img').getAttribute('src')).includes('atlas'));
assert.equal(await page.locator('html').getAttribute('data-design'),'kommandobruecke');
await page.locator('[data-design-choice=atlas]').click();assert.equal(await page.locator('html').getAttribute('data-design'),'atlas');
await page.locator('[data-design-choice=werkhalle]').focus();assert.ok((await page.locator('.settings-preview img').getAttribute('src')).includes('werkhalle'));
await page.keyboard.press('Enter');assert.equal(await page.locator('html').getAttribute('data-design'),'werkhalle');
await page.screenshot({path:'test-ergebnisse/startseite/einstellungen-vorschau.png'});
await page.setViewportSize({width:390,height:844});
assert.ok(await page.locator('#dlg-settings').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
await page.locator('.settings-zurueck').click();await page.screenshot({path:'test-ergebnisse/startseite/einstellungen-mobil.png'});
await page.locator('#set-cancel').click();await page.locator('#btn-settings').click();assert.equal(await page.locator('.settings-kachel:visible').count(),6);
await page.locator('[data-settings-category=dateien]').click();assert.notEqual(await page.locator('#set-lib').inputValue(),'Testentwurf');await page.locator('#set-cancel').click();
assert.deepEqual(errors,[]);console.log('PASS vollständige App und Kachel-Einstellungen: Kategorien, Entwurf/Abbrechen, Hover ohne Auswahl, Klick/Tastatur, Mobilbreite, Persistenz, alle Designs und Ansichten, keine JS-Fehler');
}catch(e){console.error(log.slice(-2000));throw e;}finally{await browser?.close();server.kill();}

