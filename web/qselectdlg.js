import { h } from './dom.js';
import { objectTypes, propertiesOf, operatorsOf, valuesOf, quickSelect, numberValue } from './qselect.js';
import { fieldUnit } from './props.js';

let exclude = false;

export function openQuickSelect({ entities, layers, scope, selection, factor, dp, unit = 'mm', onApply }) {
  if (document.querySelector('[data-testid=qselect-dialog]')) return;
  const previous = document.activeElement;
  const finish = () => { dialog.close(); dialog.remove(); if (previous?.isConnected) previous.focus(); };
  const combo = (name, size) => h('select', { class: 'fld', 'aria-label': name, size });
  const options = (el, items) => { el.replaceChildren(...items.map(([value, label]) => h('option', { value }, label))); el.selectedIndex = items.length ? 0 : -1; };
  const applyTo = combo('Apply to'), type = combo('Object type'), property = combo('Properties', 7), operator = combo('Operator');
  const list = combo('Value'), input = h('input', { class: 'fld', type: 'text', 'aria-label': 'Value', autocomplete: 'off' });
  const valueBox = h('div', { class: 'qs-value' }, list, input);
  const include = h('input', { type: 'radio', name: 'qs-how', checked: !exclude });
  const omit = h('input', { type: 'radio', name: 'qs-how', checked: exclude });
  const append = h('input', { type: 'checkbox' });
  let props = [];
  const indices = () => applyTo.value === 'selection' ? scope.filter((i) => selection.has(i)) : scope;
  const ents = () => indices().map((i) => entities[i]);
  const prop = () => props.find((p) => p.key === property.value);
  const check = () => {
    const p = prop(), all = operator.value === 'all';
    list.disabled = input.disabled = all;
    ok.disabled = !type.value || !p || (!all && (p.kind === 'list' ? !list.options.length : !input.value.trim() || (p.kind === 'number' && numberValue(input.value, p, unit) == null)));
  };
  const operators = () => { options(operator, operatorsOf(prop().kind)); check(); };
  const values = () => {
    const p = prop();
    list.hidden = p.kind !== 'list'; input.hidden = p.kind === 'list'; input.value = '';
    input.inputMode = p.kind === 'number' ? 'decimal' : 'text';
    input.placeholder = p.kind === 'number' ? fieldUnit(p, unit) || '' : '';
    options(list, p.kind === 'list' ? valuesOf(ents().filter((e) => type.value === 'Multiple' || e.type === type.value), layers, p.key) : []);
    operators();
  };
  const properties = () => {
    props = propertiesOf(ents(), type.value, factor, dp);
    options(property, props.map((p) => [p.key, p.label + (unit !== 'mm' && ['mm', 'mm²'].includes(p.unit) ? ' (' + fieldUnit(p, unit) + ')' : '')])); values();
  };
  const types = () => { options(type, objectTypes(ents())); properties(); };
  applyTo.addEventListener('change', types); type.addEventListener('change', properties);
  property.addEventListener('change', values); operator.addEventListener('change', check); input.addEventListener('input', check);
  const ok = h('button', { class: 'btn primary', type: 'button', onclick: () => {
    if (ok.disabled) return;
    exclude = omit.checked;
    const result = quickSelect(entities, layers, { scope: indices(), type: type.value, property: property.value, operator: operator.value,
      value: prop().kind === 'list' ? list.value : input.value, exclude, factor, dp, unit });
    const add = append.checked; finish(); onApply(result, add);
  } }, 'OK');
  const row = (label, control) => h('label', { class: 'qs-row' }, h('span', null, label), control);
  const dialog = h('dialog', { class: 'pop-dialog qselect-dialog', 'aria-label': 'Quick Select', 'data-testid': 'qselect-dialog',
    oncancel: (e) => { e.preventDefault(); finish(); }, onkeydown: (e) => {
      if (e.key === 'Enter' && e.target === input) { e.preventDefault(); e.stopPropagation(); ok.click(); }
    } }, h('h2', null, 'Quick Select'),
  row('Apply to', applyTo), row('Object type', type), row('Properties', property), row('Operator', operator), row('Value', valueBox),
  h('fieldset', null, h('legend', null, 'How to apply'), h('label', null, include, 'Include in new selection set'), h('label', null, omit, 'Exclude from new selection set')),
  h('label', { class: 'qs-check' }, append, 'Append to current selection set'),
  h('div', { class: 'row' }, h('span', { class: 'spacer' }), ok, h('button', { class: 'btn', type: 'button', onclick: finish }, 'Cancel')));
  options(applyTo, [['drawing', 'Entire drawing'], ...(selection.size ? [['selection', 'Current selection']] : [])]);
  applyTo.value = selection.size ? 'selection' : 'drawing'; types();
  document.body.append(dialog); dialog.showModal(); applyTo.focus();
}
