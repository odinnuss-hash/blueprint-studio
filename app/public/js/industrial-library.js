// Gebäudeübersicht der Testoberfläche: echte Katalogdaten, keine fiktive Einfügefunktion.
import { tileHtml } from './katalog.js';
const categories = ['Produktion','Energie','Transport','Organisation','Wände','Spezial','Sonstiges'];
const root = document.getElementById('pane-library');
const cats = document.getElementById('library-categories');
const cards = document.getElementById('library-cards');
const search = document.getElementById('library-search');
const title = document.getElementById('library-title');
const count = document.getElementById('library-count');
let entries = [], category = 'Produktion', loaded = false;
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render() {
  const q = search.value.trim().toLocaleLowerCase();
  const found = entries.filter(({g}) => g.kategorie === category && (!q || (g.name+' '+g.unterkategorie).toLocaleLowerCase().includes(q)))
    .sort((a,b) => a.g.unterkategorie.localeCompare(b.g.unterkategorie,'de') || a.g.name.localeCompare(b.g.name,'de'));
  cats.replaceChildren(...categories.map(name => {
    const b=document.createElement('button'); b.type='button'; b.className='library-category'; b.textContent=name; b.setAttribute('aria-pressed',String(category===name));
    b.addEventListener('click',()=>{category=name;render()}); return b;
  }));
  title.textContent=category; count.textContent=`${found.length} Gebäude`;
  cards.innerHTML=found.map(({cls,g})=>`<button type="button" class="library-card" data-cls="${escape(cls)}" title="${escape(g.name)} im Katalog ansehen">${tileHtml(g,cls)}<span>${escape(g.name)}</span></button>`).join('') || '<div class="hint">Keine Gebäude gefunden.</div>';
  cards.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{
    const entry=entries.find(e=>e.cls===b.dataset.cls); if(!entry) return;
    document.getElementById('mode-katalog').click();
    const qfield=document.getElementById('k-suche'); qfield.value=''; qfield.dispatchEvent(new Event('input',{bubbles:true}));
    const material=document.getElementById('k-res'); material.value=''; material.dispatchEvent(new Event('change',{bubbles:true}));
    document.querySelector('#k-tiers [data-t="9"]')?.click();
    const cat=[...document.querySelectorAll('#k-cats .cat')].find(x=>x.dataset.cat===entry.g.kategorie); cat?.click();
    qfield.value=entry.g.name; qfield.dispatchEvent(new Event('input',{bubbles:true}));
    [...document.querySelectorAll('#k-cards .card')].find(x=>x.dataset.cls===entry.cls)?.click();
  }));
}
async function load() {
  if (loaded) return;
  cards.textContent='Gebäude werden geladen …';
  try { const response=await fetch('/api/katalog'); if(!response.ok) throw new Error(); const k=await response.json(); entries=Object.entries(k.gebaeude).map(([cls,g])=>({cls,g})); loaded=true; render(); }
  catch { cards.textContent='Gebäudedaten nicht verfügbar. Prüfe die Spieleinrichtung.'; }
}
document.getElementById('tab-library').addEventListener('click',load);
search.addEventListener('input',render);
