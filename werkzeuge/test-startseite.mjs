import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'file:///C:/Users/tim_t/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const root=path.resolve('app/public');let mapReady=false,broken=false;
const harness=`<html><head><link rel="stylesheet" href="/app.css"></head><body><div id="app"><nav>${['editor','welt','karte','planer'].map(x=>'<button id="mode-'+x+'">'+x+'</button>').join('')}<button id="btn-settings">Settings</button></nav><div id="view-editor"></div></div><dialog id="dlg-settings"><select id="set-sprache"></select></dialog><script type="module">import {Startseite} from '/js/startseite.js';window.app={setMode(m){this.area=m;document.getElementById('view-editor').hidden=m!=='editor'},ablage:{grossesFenster(){window.libraryOpened=true}},toast(){}};document.getElementById('btn-settings').onclick=()=>document.getElementById('dlg-settings').showModal();window.home=new Startseite(app);home.starten();</script></body></html>`;
const server=http.createServer((req,res)=>{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(harness);return;}
 if(req.url==='/api/karte/liste'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({kartenbild:mapReady}));return;}
 let file=path.join(root,req.url);
 if(req.url.startsWith('/api/karte/kachel/')){
  if(broken&&req.url.endsWith('1-1')){res.writeHead(404);res.end();return;}
  file=path.resolve('userdata/kartenbild',req.url.split('/').pop()+'.jpg');
 }
 if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'image/png');res.end(fs.readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true,channel:'msedge'});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const url='http://127.0.0.1:'+server.address().port;await page.goto(url);await page.waitForSelector('.home-tile');
 assert.equal(await page.locator('.home-real-map.ready').count(),0);
 await page.locator('[data-home-mode=bibliothek]').click();assert.ok(await page.evaluate(()=>window.libraryOpened));
 await page.locator('button[aria-controls=bs-startseite]').click();
 fs.mkdirSync('test-ergebnisse/startseite',{recursive:true});
 for(const style of ['werkhalle','atlas','kommandobruecke']){
  await page.locator('[data-home-settings]').click();await page.locator('#set-startseite').selectOption(style);await page.evaluate(()=>document.getElementById('dlg-settings').close());
  await page.waitForLoadState('networkidle'); await page.screenshot({path:`test-ergebnisse/startseite/${style}.png`});
  await page.reload();await page.waitForSelector(`[data-stil=${style}]`);
  assert.equal(await page.locator('.home-tile').count(),3);
 }
 mapReady=true;broken=true;await page.evaluate(()=>home.karteLaden());assert.equal(await page.locator('.home-real-map.ready').count(),0);
 broken=false;await page.evaluate(()=>home.karteLaden());assert.equal(await page.locator('.home-real-map.ready image').count(),4);
 await page.locator('[data-home-mode=karte]').click();assert.equal(await page.evaluate(()=>app.area),'karte');assert.ok(await page.locator('#bs-startseite').isHidden());
 await page.locator('button[aria-controls=bs-startseite]').click();await page.locator('[data-home-mode=welt]').click();assert.equal(await page.evaluate(()=>app.area),'welt');
 await page.locator('button[aria-controls=bs-startseite]').click();await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);console.log('PASS: 3 Designs, Persistenz, Ordner/2D/3D-Navigation, Karten-Fallback, Teilfehler, echte vier Kartenkacheln, Mobilbreite, keine JS-Fehler');
}finally{await browser?.close();server.close();}
