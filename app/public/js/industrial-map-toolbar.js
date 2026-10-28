// Das zusätzliche Design gruppiert bestehende Bedienelemente; beim Wechsel bleiben sie erhalten.
const toolbar = document.querySelector('#view-karte .stage > .toolbar');
if (toolbar) {
  const original = [...toolbar.childNodes];
  const byId = id => document.getElementById(id);
  let active = false;
  function update(stil) {
    const grouped = stil === 'industrial' || stil === 'immersive';
    if (grouped === active) return;
    active = grouped;
    toolbar.classList.toggle('map-toolbar', grouped);
    if (!grouped) { toolbar.replaceChildren(...original); window.dispatchEvent(new Event('resize')); return; }
    const groups = [
      ['Suchen & Filtern', 'map-filter', [byId('k-bauteil'), byId('k-normal'), document.querySelector('#view-karte .k-hoehe')]],
      ['Ansicht', 'map-view', [byId('k-fit'), byId('k-welt'), byId('k-zout'), byId('k-zin')]],
      ['Einblenden', 'map-layers', [byId('k-bild').closest('label'), document.querySelector('#view-karte .k-eb-gruppe'), document.querySelector('#view-karte .k-punkte-gruppe'), document.querySelector('#view-karte .k-mp-gruppe')]],
      ['Bereich & Welt', 'map-actions', [document.querySelector('#view-karte .k-werkzeug'), byId('k-3d'), byId('k-pruefen')]],
    ];
    // Bedienelemente, die keiner Gruppe zugeordnet sind (z. B. später hinzugekommene Knöpfe), nicht verlieren: in die letzte Gruppe
    const vergeben = new Set(groups.flatMap((g) => g[2]).filter(Boolean));
    const rest = original.filter((n) => n.nodeType === 1 && (n.matches('button,label,input,select') || n.querySelector('button,input,select')) && ![...vergeben].some((c) => c === n || n.contains(c) || c.contains(n)));
    groups[groups.length - 1][2].push(...rest);
    const wrappers = groups.map(([name, className, controls]) => {
      const group = document.createElement('div'); group.className = `map-toolbar-group ${className}`; group.setAttribute('role','group'); group.setAttribute('aria-label',name);
      const caption = document.createElement('span'); caption.className = 'map-toolbar-caption'; caption.textContent = name;
      const row = document.createElement('div'); row.className = 'map-toolbar-controls';
      controls.forEach(control => { if (control) row.append(control); });
      group.append(caption,row); return group;
    });
    toolbar.replaceChildren(...wrappers);
    window.dispatchEvent(new Event('resize'));
  }
  update(document.documentElement.dataset.design);
  window.addEventListener('bs-design', e => update(e.detail));
}
