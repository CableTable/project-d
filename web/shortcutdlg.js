// R12: DOM only. Binding rules and PGP interchange live in shortcuts.js.
import { h } from './dom.js';
import { COMMANDS } from './cmdbar.js';
import * as SC from './shortcuts.js';
import { withExt } from './savepath.js';

const LABELS = { rrect: 'Rounded rectangle', dimlinear: 'Linear dimension', dimradius: 'Radius dimension', dimdiameter: 'Diameter dimension', dimangular: 'Angular dimension', dimstyle: 'Dimension style', newlayout: 'New layout', saveas: 'Save As', selectall: 'Select all', mx: 'Mirror X', my: 'Mirror Y', pdf: 'PDF / Print', history: 'Undo history', closetab: 'Close tab', nexttab: 'Next tab', previoustab: 'Previous tab' };
const label = (n) => LABELS[n] || n[0].toUpperCase() + n.slice(1);
function glyph(path, size = 14) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), p = document.createElementNS(svg.namespaceURI, 'path');
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  p.setAttribute('d', path); svg.append(p); return svg;
}
const lock = () => glyph('M5 10h14v11H5zM8 10V7a4 4 0 0 1 8 0v3', 11);

export function openShortcuts(current, save) {
  if (document.querySelector('[data-testid=shortcuts-dialog]')) return;
  let draft = SC.bindings(current), listening = '', busy = false;
  const previous = new Map(), lastEdited = { alias: '', key: '' }, rows = new Map(), focusBefore = document.activeElement;
  const button = (text, fn, attrs = {}) => h('button', { type: 'button', class: 'btn', onclick: fn, ...attrs }, text);
  const search = h('input', { type: 'search', placeholder: 'Search commands or aliases…', 'aria-label': 'Search commands' });
  const category = h('select', { 'aria-label': 'Category' }, h('option', { value: '' }, 'All categories'), ['Draw', 'Annotate', 'Edit', 'Layout', 'File', 'View'].map((x) => h('option', null, x)));
  const count = h('span', { class: 'sc-count' }), changed = h('span', { class: 'sc-changed' });
  const status = h('div', { class: 'sc-status', role: 'status', 'aria-live': 'polite' });
  const tbody = h('tbody');
  const finish = () => {
    if (busy) return;
    back.remove(); document.removeEventListener('keydown', onKey, true);
    focusBefore?.focus();
  };
  const remember = (name, field) => {
    const id = name + ':' + field;
    if (!previous.has(id)) previous.set(id, structuredClone(draft[name][field]));
  };
  function edit(name, field, value) {
    remember(name, field); lastEdited[field] = name; draft[name][field] = value; update();
  }
  const saveButton = button('Save', async () => {
    if (SC.clashes(draft).length || busy) return;
    busy = true; update();
    try { await save(draft); busy = false; finish(); }
    catch (err) { status.textContent = 'Save failed: ' + (err.message || err); busy = false; update(); }
  }, { class: 'btn primary', 'data-testid': 'shortcuts-save' });
  const cancelButton = button('Cancel', finish);
  const resetAll = button('Reset all', () => {
    draft = SC.bindings(); previous.clear(); lastEdited.alias = lastEdited.key = ''; listening = ''; status.textContent = ''; update();
  });
  function imported(text) {
    for (const c of COMMANDS) for (const field of ['alias', 'key']) previous.set(c.name + ':' + field, structuredClone(draft[c.name][field]));
    lastEdited.alias = lastEdited.key = '';
    const parsed = SC.parsePgp(text, draft);
    draft = parsed.draft; listening = '';
    status.textContent = `Imported draft · ${parsed.skipped} lines skipped (unknown commands or invalid lines). Save to apply.`;
    update();
  }
  const picker = h('input', { type: 'file', accept: '.pgp', hidden: true, 'data-testid': 'shortcuts-picker', onchange: async () => {
    try { if (picker.files[0]) imported(await picker.files[0].text()); }
    catch (err) { status.textContent = 'Import failed: ' + (err.message || err); }
  } });
  const exportButton = button('Export .pgp', async () => {
    try {
      const text = SC.writePgp(draft), t = window.__TAURI__;
      if (t?.dialog?.save && t?.fs?.writeTextFile) {
        let path = await t.dialog.save({ defaultPath: 'shortcuts.pgp', filters: [{ name: 'PGP shortcuts', extensions: ['pgp'] }] });
        if (!path) return;
        path = await withExt(t, path, 'pgp');
        if (!path) return;
        await t.fs.writeTextFile(path, text);
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
        const a = h('a', { href: url, download: 'shortcuts.pgp' });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
      status.textContent = 'Exported aliases + keys.';
    } catch (err) { status.textContent = 'Export failed: ' + (err.message || err); }
  });
  const importButton = button('Import .pgp', async () => {
    try {
      const t = window.__TAURI__;
      if (!t?.dialog?.open) { picker.value = ''; picker.click(); return; }
      const picked = await t.dialog.open({ multiple: false, filters: [{ name: 'PGP shortcuts', extensions: ['pgp'] }] });
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (path) imported(new TextDecoder().decode(await t.fs.readFile(path)));
    } catch (err) { status.textContent = 'Import failed: ' + (err.message || err); }
  });
  const dlg = h('section', { class: 'pop-dialog sc-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Shortcuts', 'data-testid': 'shortcuts-dialog' },
    h('header', { class: 'sc-head' }, h('div', { class: 'sc-title' }, h('b', null, 'Shortcuts'), h('span', { class: 'chp' }, 'Aliases + keys'), h('span', { class: 'spacer' }), button('×', finish, { class: 'sc-icon', 'aria-label': 'Close shortcuts' })), h('p', null, 'Type an alias, or press a key combination. Use commas for more aliases.')),
    h('div', { class: 'sc-filters' }, h('label', { class: 'sc-search' }, glyph('M5 11a6 6 0 1 0 12 0a6 6 0 1 0-12 0M16 16l4 4', 12), search), category, count),
    h('div', { class: 'sc-tablewrap' }, h('table', null, h('colgroup', null, [26, 11, 24, 34, 5].map((w) => h('col', { style: `width:${w}%` }))), h('thead', null, h('tr', null, ['Command', 'Category', 'Aliases', 'Key', ''].map((x) => h('th', { scope: 'col', 'aria-label': x ? null : 'Reset row' }, x)))), tbody)),
    status,
    h('div', { class: 'sc-note' }, changed, h('span', { class: 'sc-reserved' }, lock(), ' Reserved'), h('span', null, 'Drawing / layout aliases may overlap.'), h('span', { class: 'spacer' }), h('span', null, '.pgp: aliases + keys')),
    h('footer', { class: 'sc-foot' }, resetAll, exportButton, importButton, h('span', { class: 'spacer' }), cancelButton, saveButton), picker);
  const back = h('div', { class: 'pop-back sc-back' }, dlg);
  const order = ['contour', 'offset', 'trim', 'mirror'];
  for (const c of [...order.map((n) => COMMANDS.find((c) => c.name === n)), ...COMMANDS.filter((c) => !order.includes(c.name))]) {
    const input = h('input', { class: 'fld sc-alias', value: draft[c.name].alias.join(', '), placeholder: '—', spellcheck: 'false', 'aria-label': label(c.name) + ' aliases', onfocus: () => {
      if (!SC.clashes(draft).some((x) => x.field === 'alias' && (x.name === c.name || x.other === c.name))) previous.set(c.name + ':alias', [...draft[c.name].alias]);
    }, oninput: () => edit(c.name, 'alias', SC.aliases(input.value)), onblur: () => { input.value = draft[c.name].alias.join(', '); } });
    const key = button('', () => {
      listening = c.name; status.textContent = `Listening for ${label(c.name)} · Previous key: ${draft[c.name].key || 'none'} · Press the full combination. Esc cancels capture.`; update();
    }, { class: 'sc-key', 'aria-label': label(c.name) + ' key', disabled: SC.fixedKey(c.name), title: SC.fixedKey(c.name) ? 'Reserved: this key stays available.' : 'Press keys…' });
    const dot = h('span', { class: 'sc-dot', title: 'Changed' }, '●');
    const tr = h('tr', { 'data-command': c.name }, h('td', null, h('span', { class: 'sc-command', title: c.name }, label(c.name)), c.where ? h('span', { class: 'sc-scope' }, c.where) : null, dot), h('td', { class: 'sc-category' }, c.cat), h('td', null, input), h('td', null, key), h('td', null, button(glyph('M3 10a9 9 0 1 1 2 8M3 4v6h6'), () => {
      previous.set(c.name + ':alias', [...draft[c.name].alias]); previous.set(c.name + ':key', draft[c.name].key);
      lastEdited.alias = lastEdited.key = c.name; draft[c.name] = { alias: [...c.alias], key: c.key }; listening = ''; update();
    }, { class: 'sc-icon', 'aria-label': 'Reset ' + label(c.name), title: 'Reset row' })));
    const warnings = h('td', { colspan: 5 }), warningRow = h('tr', { class: 'sc-warning', hidden: true }, warnings);
    rows.set(c.name, { tr, input, key, dot, warnings, warningRow }); tbody.append(tr, warningRow);
  }
  function update() {
    const conflicts = SC.clashes(draft), changes = SC.differences(draft), q = search.value.trim().toLowerCase();
    for (const b of dlg.querySelectorAll('button')) b.disabled = busy;
    search.disabled = busy; category.disabled = busy;
    let shown = 0;
    for (const c of COMMANDS) {
      const r = rows.get(c.name), b = draft[c.name];
      r.tr.hidden = !(label(c.name) + ' ' + c.name + ' ' + b.alias.join(' ')).toLowerCase().includes(q) || !!category.value && category.value !== c.cat;
      if (!r.tr.hidden) shown++;
      r.tr.classList.toggle('sc-edited', Object.hasOwn(changes, c.name)); r.dot.hidden = !Object.hasOwn(changes, c.name); r.tr.classList.remove('sc-conflict');
      if (document.activeElement !== r.input) r.input.value = b.alias.join(', ');
      r.key.replaceChildren(...(SC.fixedKey(c.name) ? [lock()] : []), listening === c.name ? '● Press a key… Esc to cancel' : b.key || 'Press keys…');
      r.key.classList.toggle('sc-listening', listening === c.name); r.key.classList.toggle('sc-assigned', !!b.key);
      r.input.disabled = busy; r.key.disabled = busy || SC.fixedKey(c.name);
      r.warnings.replaceChildren(); r.warningRow.hidden = true;
    }
    for (const conflict of conflicts) {
      let { name, other, field, value, reason } = conflict;
      const edited = (n) => JSON.stringify(draft[n][field]) !== JSON.stringify(previous.get(n + ':' + field) ?? current[n][field]);
      if (other && (lastEdited[field] === other || lastEdited[field] !== name && edited(other) && !edited(name))) [name, other] = [other, name];
      const r = rows.get(name), old = previous.get(name + ':' + field) ?? current[name][field];
      r.tr.classList.add('sc-conflict');
      const actions = [];
      if (other && !reason && !SC.fixedKey(field === 'key' ? other : '')) actions.push(button('Swap', () => {
        draft = SC.swap(draft, name, other, field, old); previous.delete(name + ':' + field); update();
      }, { 'aria-label': `Swap ${field} clash` }));
      actions.push(button('Cancel', () => { draft[name][field] = structuredClone(old); previous.delete(name + ':' + field); update(); }, { 'aria-label': `Cancel ${field} clash` }));
      r.warnings.append(h('div', { class: 'sc-warning-line' }, h('span', null, reason || `${field === 'alias' ? 'Alias' : 'Key'} “${value}” is used by ${label(other)}${field === 'alias' && COMMANDS.find((c) => c.name === other).where ? ' (' + COMMANDS.find((c) => c.name === other).where + ')' : ''}.`), h('span', { class: 'spacer' }), actions));
      r.warningRow.hidden = r.tr.hidden;
    }
    count.textContent = `${shown} commands`; changed.textContent = conflicts.length ? `⚠ Resolve ${conflicts.length} clashes to save.` : `● ${Object.keys(changes).length} changed`;
    changed.classList.toggle('warn', !!conflicts.length);
    saveButton.disabled = busy || !!listening || !!conflicts.length; exportButton.disabled = busy;
    resetAll.disabled = busy; importButton.disabled = busy; cancelButton.disabled = busy;
  }
  function onKey(e) {
    if (listening) {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { listening = ''; status.textContent = 'Capture cancelled; previous key kept.'; update(); return; }
      const key = SC.eventKey(e);
      if (key == null) return;
      const name = listening, reason = SC.keyReason(key); listening = '';
      if (reason) { status.textContent = `${key} cannot be assigned to ${label(name)}. ${reason}`; update(); }
      else { if (!SC.clashes(draft).some((x) => x.field === 'key' && (x.name === name || x.other === name))) previous.set(name + ':key', draft[name].key); status.textContent = ''; edit(name, 'key', key); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); }
    if (e.key === 'Tab') {
      const fields = [...dlg.querySelectorAll('button:not(:disabled), input:not([hidden]):not(:disabled), select:not(:disabled)')].filter((el) => el.getClientRects().length);
      const first = fields[0], last = fields.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  search.addEventListener('input', update); category.addEventListener('change', update);
  document.addEventListener('keydown', onKey, true);
  document.body.append(back); update(); search.focus();
}
