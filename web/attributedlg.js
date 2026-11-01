import { h } from './dom.js';
import { attributeRows, blockName, definitionFields, applyAttributeValues, applyDefinition, validTag } from './attribute-edit.js';

/** Shared by drawing, Layout and Compare picks; save receives only changed records. */
export function openAttributes(ent, blocks, save) {
  if (document.querySelector('[data-testid=attribute-dialog]')) return;
  const definition = ent.type === 'ATTDEF', title = definition ? 'Edit Attribute Definition' : 'Attribute editor';
  const rows = definition ? [] : attributeRows(ent, blocks), draft = definition && definitionFields(ent);
  if (!definition && !rows.length) return;
  const previous = document.activeElement;
  let selected = 0;
  const finish = () => { dialog.close(); dialog.remove(); if (previous?.isConnected) previous.focus(); };
  const write = () => {
    if (ok.disabled) return false;
    const next = definition ? applyDefinition(ent, draft) : applyAttributeValues(ent, rows);
    if (next !== ent) { save(next); ent = next; }
    return true;
  };
  const button = (label, fn) => h('button', { type: 'button', class: 'btn', onclick: fn }, label);
  const ok = button('OK', () => attempt(() => { if (write()) finish(); })); ok.classList.add('primary');
  const value = h('input', { type: 'text', class: 'fld', 'aria-label': definition ? 'Default' : 'Value', value: definition ? draft.value : rows[0].value,
    oninput: () => { if (definition) draft.value = value.value; else { rows[selected].value = value.value; cells[selected].textContent = value.value; } } });
  const cells = [], rowEls = [];
  const contents = [];
  if (definition) {
    const tag = h('input', { type: 'text', class: 'fld', 'aria-label': 'Tag', value: draft.tag, required: true, oninput: () => {
      const start = tag.selectionStart, end = tag.selectionEnd;
      tag.value = tag.value.toUpperCase(); tag.setSelectionRange(start, end); draft.tag = tag.value;
      ok.disabled = !validTag(draft.tag); tag.setAttribute('aria-invalid', String(ok.disabled));
    } });
    const prompt = h('input', { type: 'text', class: 'fld', 'aria-label': 'Prompt', value: draft.prompt, oninput: () => { draft.prompt = prompt.value; } });
    ok.disabled = !validTag(draft.tag);
    contents.push(h('label', null, 'Tag', tag), h('span', { class: 'lbl' }, 'Required; no spaces.'), h('label', null, 'Prompt', prompt));
  } else {
    contents.push(h('div', { class: 'attribute-block' }, h('span', { class: 'lbl' }, 'Block'), h('strong', null, blockName(ent))));
    const body = h('tbody');
    rows.forEach((row, i) => {
      const cell = h('td', null, row.value); cells.push(cell);
      const pick = () => { selected = i; value.value = row.value; rowEls.forEach((el, k) => el.setAttribute('aria-selected', String(i === k))); };
      const el = h('tr', { tabindex: '0', 'aria-selected': String(i === 0), onclick: pick, onkeydown: (e) => {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pick(); value.focus(); }
      } }, h('td', null, row.tag), h('td', null, row.prompt), cell);
      rowEls.push(el); body.append(el);
    });
    contents.push(h('div', { class: 'attribute-list' }, h('table', null,
      h('thead', null, h('tr', null, ['Tag', 'Prompt', 'Value'].map((s) => h('th', { scope: 'col' }, s)))), body)));
  }
  const status = h('div', { class: 'lbl', role: 'status' });
  const attempt = (fn) => { try { fn(); } catch (err) { status.textContent = err.message; } };
  const dialog = h('dialog', { class: 'pop-dialog attribute-dialog', 'aria-label': title, 'data-testid': 'attribute-dialog',
    oncancel: (e) => { e.preventDefault(); finish(); }, onkeydown: (e) => {
      if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); e.stopPropagation(); attempt(() => { if (write()) finish(); }); }
    } }, h('h2', null, title), contents, h('label', null, definition ? 'Default' : 'Value', value), status,
    h('div', { class: 'row' }, h('span', { class: 'spacer' }), ok, button('Cancel', finish), !definition && button('Apply', () => attempt(write))));
  document.body.append(dialog); dialog.showModal();
  (definition ? dialog.querySelector('input') : value).focus();
}
