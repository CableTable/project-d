// PD dimensions draw resolved TEXT; an invisible constant attribute keeps the group 1 override and measured label for rebuilds.
import { entity } from './dxf-write.js';

const field = (e, c) => e?.r.v[e.r.c.indexOf(c)] || '';
const unesc = (s) => String(s).replace(/\\U\+([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
export const overrideText = (text = '') => !text.trim() || text === '<>' ? '' : text;
export const dimensionText = (measured, override) => overrideText(override) ? override.replaceAll('<>', measured) : measured;
export const textRecord = (ents) => ents.find((e) => e.type === 'ATTDEF' && field(e, 2) === 'PD_DIM_TEXT');
export const measuredText = (ents) => unesc(field(textRecord(ents) || ents.find((e) => e.type === 'TEXT'), textRecord(ents) ? 3 : 1));
export const readOverride = (ents) => { const e = textRecord(ents); return e ? unesc(field(e, 1)) : ''; };
export const overrideRecord = (override, measured) => entity('ATTDEF', [[10, 0], [20, 0], [30, 0], [40, 1], [1, override], [2, 'PD_DIM_TEXT'], [3, measured], [70, 3]], { layer: '0' });

export function dimensionEditor(measured, override = '') {
  const parts = (overrideText(override) || '<>').split('<>'), ranges = [];
  let value = parts[0];
  for (const part of parts.slice(1)) { ranges.push([value.length, value.length + measured.length]); value += measured + part; }
  const state = { value, measured, ranges };
  return { ...state, history: [state], index: 0 };
}

/** Keep only measured ranges untouched by this textarea edit; insertions at their edges move them. */
export function changeDimensionEditor(edit, value, selection, inputType) {
  // Native Undo can group several inputs: restore the ranges belonging to the text it restores.
  if (inputType === 'historyUndo' || inputType === 'historyRedo') {
    const step = inputType === 'historyUndo' ? -1 : 1;
    for (let i = edit.index + step; i >= 0 && i < edit.history.length; i += step) {
      if (edit.history[i].value === value) return { ...edit.history[i], history: edit.history, index: i };
    }
  }
  let [start, end] = selection || [0, edit.value.length];
  if (!selection) {
    while (start < end && edit.value[start] === value[start]) start++;
    let tail = value.length;
    while (end > start && tail > start && edit.value[end - 1] === value[tail - 1]) { end--; tail--; }
  }
  const delta = value.length - edit.value.length;
  const ranges = edit.ranges.flatMap(([a, b]) => end <= a ? [[a + delta, b + delta]] : start >= b ? [[a, b]] : []);
  const state = { value, measured: edit.measured, ranges }, history = [...edit.history.slice(0, edit.index + 1), state];
  return { ...state, history, index: history.length - 1 };
}

export function dimensionEditorOverride(edit) {
  let value = edit.value;
  for (const [a, b] of edit.ranges.slice().reverse()) if (value.slice(a, b) === edit.measured) value = value.slice(0, a) + '<>' + value.slice(b);
  return overrideText(value);
}

/** Our exported native dimensions use world-coordinate PD blocks; edit them internally as identity INSERTs. */
export function restoreDimensionInserts(doc) {
  doc.entities = doc.entities.map((e) => {
    const name = field(e, 2), block = doc.blocks[name];
    if (e.type !== 'DIMENSION' || !/^PD_DIM_/.test(name) || !block || !textRecord(block.entities)) return e;
    const override = overrideText(field(e, 1)), measured = measuredText(block.entities), record = textRecord(block.entities);
    block.entities = block.entities.map((child) => child === record ? overrideRecord(override, measured) : child.type === 'TEXT'
      ? { ...child, r: { ...child.r, v: child.r.v.map((v, k) => child.r.c[k] === 1 ? dimensionText(measured, override) : v) } } : child);
    return { ...e, type: 'INSERT', r: { type: 'INSERT', c: [2, 10, 20, 30], v: [name, '0', '0', '0'] } };
  });
  return doc;
}
