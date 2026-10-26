// Vorhandene Eingabefelder werden verschoben; IDs und Speicherlogik bleiben erhalten.
export function einstellungenGestalten(select) {
  const dialog = document.getElementById('dlg-settings');
  if (!dialog) return;
  const form = dialog.querySelector('form');
  if (!form) return;
  const original = [...form.children];
  const grid = document.createElement('div'); grid.className = 'settings-kacheln';
  const back = document.createElement('button'); back.type = 'button'; back.className = 'btn settings-zurueck'; back.textContent = '← Alle Einstellungen'; back.hidden = true;
  const title = document.createElement('h3'); title.hidden = true;
  form.querySelector('h2').after(grid, back, title);
  const groups = [
    ['darstellung','◈','Darstellung & Sprache','App-Design, Sprache und Startansicht'],
    ['dateien','▱','Ordner & Spielstände','Spielinstallation, Bibliotheken und Speicherorte'],
    ['ablage','▦','Blaupausen-Ablage','Ordnerstruktur, Namen und Anordnung'],
    ['editor','◇','Editor','Verhalten beim Bearbeiten'],
    ['updates','↻','Updates','Aktualisierung und Update-Quelle'],
    ['einrichtung','⚙','Einrichtung & Diagnose','Assistent und Voraussetzungen'],
  ];
  const panels = new Map(); let active;
  const overview = () => { grid.hidden = false; back.hidden = title.hidden = true; panels.forEach(p => p.hidden = true); };
  for (const [id,icon,name,description] of groups) {
    const panel = document.createElement('section'); panel.id = `settings-${id}`; panel.className = 'settings-detail'; panel.hidden = true; panel.setAttribute('aria-label',name); panels.set(id,panel); form.insertBefore(panel,document.getElementById('set-status'));
    const button = document.createElement('button'); button.type = 'button'; button.className = 'settings-kachel'; button.dataset.settingsCategory = id; button.setAttribute('aria-controls',panel.id);
    button.innerHTML = `<span aria-hidden="true">${icon}</span><strong>${name}</strong><small>${description}</small>`;
    button.addEventListener('click', () => { active = button; grid.hidden = true; panel.hidden = false; back.hidden = title.hidden = false; title.textContent = name; back.focus(); }); grid.append(button);
  }
  back.addEventListener('click', () => { overview(); active?.focus(); });
  dialog.addEventListener('close',overview);
  const index = selector => original.indexOf(form.querySelector(selector));
  // Grenzen vor dem Verschieben auflösen.
  const ranges = [
    ['label[for="set-sprache"]','label[for="set-save"]','darstellung'],
    ['label[for="set-save"]','label[for="set-ansicht"]','dateien'],
    ['label[for="set-ansicht"]','label.check','darstellung'],
  ].map(([a,b,id]) => [index(a),index(b),id]);
  ranges.forEach(([a,b,id]) => original.slice(a,b).forEach(n => panels.get(id).append(n)));
  for (const [selector,id] of [['#set-einsortieren','ablage'],['#set-rutschen','editor']]) panels.get(id).append(form.querySelector(selector).closest('label'));
  for (const fieldset of original.filter(n => n.tagName === 'FIELDSET')) panels.get(fieldset.querySelector('#set-update-auto') ? 'updates' : 'ablage').append(fieldset);
  for (const id of ['set-assistent','set-pruefen']) panels.get('einrichtung').append(document.getElementById(id));
  original.filter(n => n.classList.contains('hint') && n.parentElement === form).forEach(n => panels.get('dateien').append(n));

  const descriptions = {
    werkhalle: ['Werkhalle','Dunkle Werkstatt mit warmen Orangetönen. Kräftige Kontraste und eine industrielle Atmosphäre.'],
    atlas: ['Atlas','Helle Flächen, ruhige Grüntöne und elegante Überschriften. Für einen freundlichen, übersichtlichen Arbeitsplatz.'],
    kommandobruecke: ['Kommandobrücke','Tiefes Marineblau mit bernsteinfarbenen Akzenten. Die Standardansicht für deine Fabrikzentrale.'],
  };
  const cards = document.createElement('div'); cards.className = 'settings-designs'; cards.setAttribute('role','group'); cards.setAttribute('aria-label','App-Design auswählen');
  const preview = document.createElement('figure'); preview.className = 'settings-preview'; preview.id = 'settings-design-preview';
  preview.innerHTML = '<img alt=""><figcaption><strong></strong><p></p><small>Vorschau der Startseite · Farben und Stil gelten für die gesamte App.</small></figcaption>';
  const show = id => { const [name,description] = descriptions[id]; preview.querySelector('img').src = `/startseite/${id}.png`; preview.querySelector('img').alt = `Designvorschau ${name}`; preview.querySelector('strong').textContent = name; preview.querySelector('p').textContent = description; };
  const sync = () => { cards.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.designChoice === select.value))); show(select.value); };
  for (const [id,[name]] of Object.entries(descriptions)) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'settings-design'; button.dataset.designChoice = id; button.setAttribute('aria-describedby',preview.id);
    button.innerHTML = `<img src="/startseite/${id}.png" alt=""><strong>${name}</strong>`;
    button.addEventListener('mouseenter',()=>show(id)); button.addEventListener('focus',()=>show(id));
    button.addEventListener('click',()=>{ select.value = id; select.dispatchEvent(new Event('change',{bubbles:true})); sync(); }); cards.append(button);
  }
  cards.addEventListener('mouseleave',()=>show(select.value));
  select.after(cards,preview); select.addEventListener('change',sync); window.addEventListener('bs-design',sync); sync();
}
