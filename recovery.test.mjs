// recovery.js — the pure parts: the prompt, the time text, and cleaning what comes back from storage.   node recovery.test.mjs
import assert from 'node:assert/strict';
import * as R from './web/recovery.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as BAL from './web/balloons.js';
import * as DU from './web/units.js';

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };

test('time text: the clock today, the date and clock on another day', () => {
  const now = at(2026, 10, 18, 15, 0);
  assert.equal(R.timeText(at(2026, 10, 18, 9, 5), now), '09:05');
  assert.equal(R.timeText(at(2026, 10, 17, 23, 59), now), '17 Oct 23:59');
});

test('prompt: counts the drawings and names the newest copy time', () => {
  const now = at(2026, 10, 18, 15, 0);
  assert.equal(R.recoverPrompt([{ t: at(2026, 10, 18, 14, 5) }], now), 'Recover 1 unsaved drawing from 14:05?');
  assert.equal(R.recoverPrompt([{ t: at(2026, 10, 18, 13, 0) }, { t: at(2026, 10, 18, 14, 5) }], now), 'Recover 2 unsaved drawings from 14:05?');
});

test('cleanCopies: only well-formed records, fields in the right types', () => {
  const good = { id: 'a', name: 'p.dxf', path: 'C:/x/p.dxf', kind: 'drawing', dxf: '0\nEOF\n', t: 5, saved: 1 };
  const out = R.cleanCopies([good, null, { id: 'b' }, { ...good, id: 'c', kind: 'other' }, { ...good, id: 'd', dxf: '' }, { ...good, id: 'e', path: 7, t: 'x', fromPdf: 3 }]);
  assert.deepEqual(out.map((c) => c.id), ['a', 'e']);
  assert.equal(out[0].saved, true); assert.equal(out[1].path, null); assert.equal(out[1].t, 0); assert.equal(out[1].fromPdf, null);
  assert.deepEqual(R.cleanCopies('nonsense'), []);
});

test('cleanCopies: balloons, unit and sheet pass as text, wrong types become null', () => {
  const good = { id: 'a', name: 'scan.pdf', kind: 'drawing', dxf: '0\nEOF\n', balloons: BAL.encode(BAL.EMPTY), unit: 'ft-in', sheet: 2 };
  const [copy, wrong, old] = R.cleanCopies([good, { ...good, balloons: {}, unit: 4, sheet: '2' }, { id: 'old', name: 'old.dxf', kind: 'drawing', dxf: good.dxf }]);
  assert.deepEqual([copy.balloons, copy.unit, copy.sheet], [good.balloons, 'ft-in', 2]);
  for (const c of [wrong, old]) assert.deepEqual([c.balloons, c.unit, c.sheet], [null, null, null]);
  for (const sheet of [0, -1, 1.5, Infinity]) assert.equal(R.cleanCopies([{ ...good, sheet }])[0].sheet, null);
});

// Exercise the private restore path without loading the UI or adding app exports.
const source = readFileSync(new URL('./web/app.js', import.meta.url), 'utf8').match(/^async function recoverOne\(c\) \{\r?\n[\s\S]*?^\}/m)?.[0];
assert.ok(source, 'recoverOne exists');
let restored;
const recoverOne = runInNewContext(`${source}\nrecoverOne`, {
  BAL, DU, TextEncoder, console, state: {},
  readDrawing: async () => ({ ok: true, doc: { header: {} }, result: {} }),
  tabFields: () => ({ drawingUnit: 'mm' }),
  addTab: (doc) => { restored = doc; },
});
let set = BAL.add(BAL.EMPTY, { tip: [10, 20], c: [30, 40], sheet: 1 });
set = BAL.add(set, { tip: [50, 60], c: [70, 80], sheet: 2 });
set = BAL.update(set, 2, { dim: '42', note: '<b>keep as text</b>' });
assert.equal(await recoverOne({ id: 'sheet2', kind: 'drawing', name: 'scan sheet 2', dxf: '', sheet: 2, balloons: BAL.encode(set), unit: 'inch' }), true);
assert.deepEqual(JSON.parse(JSON.stringify(restored.balloons.items)), [{ ...set.items[1], id: 2, sheet: 1 }]);
assert.equal(restored.balloons.next, set.next);
assert.equal(restored.balSaved, undefined, 'Save must write the restored balloons');
assert.equal(restored.drawingUnit, 'inch'); assert.equal(restored.unitsDirty, true); assert.equal(restored.dirty, true);
n++; console.log('ok recovery: only the copy sheet comes back as sheet 1, with unsaved balloons');
assert.equal(await recoverOne({ id: 'unit', kind: 'drawing', name: 'unit.dxf', dxf: '', unit: 'ft-in' }), true);
assert.equal(restored.drawingUnit, 'ft-in'); assert.equal(restored.unitsDirty, true); assert.equal(restored.balloons, undefined);
n++; console.log('ok unit comes back when the drawing has a unit and no balloons');
assert.equal(await recoverOne({ id: 'bad', kind: 'drawing', name: 'bad.dxf', dxf: '', unit: 'bogus', balloons: '{}' }), true);
assert.equal(restored.drawingUnit, 'mm'); assert.equal(restored.unitsDirty, undefined); assert.equal(restored.balloons, undefined);
n++; console.log('ok recovery: invalid balloon text and unknown units do not replace defaults');

// Keep the storage boundary small; the table exercises loadCopies' real sort.
let stored = [];
const originalIndexedDB = globalThis.indexedDB;
globalThis.indexedDB = { open: () => {
  const request = { result: { transaction: () => ({ objectStore: () => ({ getAll: () => {
    const read = { result: stored.slice() };
    queueMicrotask(() => read.onsuccess());
    return read;
  } }) }) } };
  queueMicrotask(() => request.onsuccess());
  return request;
} };
try {
  for (const [name, copies, expected] of [
    ['tab order', [{ id: '2', tab: 1, t: 1 }, { id: '1', tab: 0, t: 2 }], ['1', '2']],
    ['PDF sheet order', [{ id: 's3', tab: 0, sheet: 3, t: 1 }, { id: 'next', tab: 1, sheet: null, t: 0 }, { id: 's1', tab: 0, sheet: 1, t: 3 }, { id: 's2', tab: 0, sheet: 2, t: 2 }], ['s1', 's2', 's3', 'next']],
    ['missing tab sorts last by time', [{ id: 'old2', t: 2 }, { id: 'tab', tab: 0, sheet: null, t: 3 }, { id: 'old1', tab: null, sheet: 9, t: 1 }], ['tab', 'old1', 'old2']],
    ['same tab and sheet sort by time', [{ id: 'b', tab: 0, sheet: 1, t: 2 }, { id: 'a', tab: 0, sheet: 1, t: 1 }], ['a', 'b']],
    ['a stale index (C was 2, now 0) sorts wrong; rewritten it sorts right', [{ id: 'D', tab: 1, t: 4 }, { id: 'C', tab: 2, t: 1 }, { id: 'E', tab: 2, t: 5 }], ['D', 'C', 'E']],
    ['C rewritten with tab 0', [{ id: 'D', tab: 1, t: 4 }, { id: 'C', tab: 0, t: 6 }, { id: 'E', tab: 2, t: 5 }], ['C', 'D', 'E']],
    ['tie on t keeps input order', [{ id: 'b', tab: 0, sheet: null, t: 1 }, { id: 'a', tab: 0, sheet: null, t: 1 }], ['b', 'a']],
  ]) {
    stored = copies;
    assert.deepEqual((await R.loadCopies()).map((c) => c.id), expected, name);
    n++; console.log('ok loadCopies:', name);
  }
} finally {
  if (originalIndexedDB === undefined) delete globalThis.indexedDB;
  else globalThis.indexedDB = originalIndexedDB;
}

console.log(n + ' tests passed');
