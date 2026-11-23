// recovery.js — the pure parts: the prompt, the time text, and cleaning what comes back from storage.   node recovery.test.mjs
import assert from 'node:assert/strict';
import * as R from './web/recovery.js';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import * as BAL from './web/balloons.js';
import * as DU from './web/units.js';
import * as PS from './web/pdf-sheets.js';

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

test('TODO 271: source PDF path and original page count survive cleaning; old copies stay valid', () => {
  const good = { id: 'pdf', name: 'same.pdf sheet 2', kind: 'drawing', dxf: '0\nEOF\n', openPath: 'E:/one/same.pdf', pdfPages: 2 };
  const [copy, wrong, old] = R.cleanCopies([good, { ...good, openPath: 42, pdfPages: '2' }, { ...good, openPath: undefined, pdfPages: undefined }]);
  assert.equal(copy.openPath, good.openPath); assert.equal(copy.pdfPages, 2);
  for (const c of [wrong, old]) assert.deepEqual([c.openPath, c.pdfPages], [null, null]);
  for (const pdfPages of [0, -1, 1.5, Infinity]) assert.equal(R.cleanCopies([{ ...good, pdfPages }])[0].pdfPages, null);
});

test('TODO 276: pdfHash survives only as 64 lowercase hex characters', () => {
  const good = { id: 'pdf', name: 'same.pdf', kind: 'drawing', dxf: '0\nEOF\n' }, hex = 'ab'.repeat(32);
  assert.equal(R.cleanCopies([{ ...good, pdfHash: hex }])[0].pdfHash, hex);
  for (const pdfHash of [hex.toUpperCase(), hex.slice(1), hex + '0', 'zz'.repeat(32), 5, null, undefined]) assert.equal(R.cleanCopies([{ ...good, pdfHash }])[0].pdfHash, null);
});

// Exercise the private restore path without loading the UI or adding app exports.
const source = readFileSync(new URL('./web/app.js', import.meta.url), 'utf8').match(/^async function recoverOne\(c[^)]*\) \{\r?\n[\s\S]*?^\}/m)?.[0];
assert.ok(source, 'recoverOne exists');
let restored;
const recoverOne = runInNewContext(`${source}\nrecoverOne`, {
  BAL, DU, PS, TextEncoder, console, state: {}, Ed: { createHistory: () => ({}) },
  balOf: (d) => d.balloons || BAL.EMPTY, baseName: (name) => name.replace(/\.pdf$/i, ''),
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

assert.equal(await recoverOne({ id: 'saved', kind: 'drawing', name: 'saved.dxf', dxf: '', path: 'E:/saved.dxf', saved: true, openPath: 'E:/source.pdf', fromPdf: 'source.pdf' }), true);
assert.equal(restored.openPath, null); assert.equal(restored.path, 'E:/saved.dxf'); assert.equal(restored.fromPdf, 'source.pdf');
n++; console.log('ok TODO 271: a fallback drawing tab does not keep the PDF path, so the PDF can be opened');
const target = { pdf: { name: 'source.pdf', page: 1, pages: 2 }, fromPdf: 'source.pdf', balloons: BAL.add(BAL.EMPTY, { tip: [1, 2], c: [3, 4], sheet: 1 }) };
assert.equal(await recoverOne({ id: 'sheet2', kind: 'drawing', name: 'source.pdf sheet 2', dxf: '', sheet: 2, balloons: BAL.encode(set), unit: 'inch' }, target), true);
assert.deepEqual(target.balloons.items.map((it) => it.sheet), [1, 2]);
assert.equal(target.pdf.states.get(2).recovery.rid, 'sheet2'); assert.equal(target.pdf.states.get(2).dirty, true);
assert.equal(target.pdf.states.get(2).name, 'source.dxf'); assert.equal(target.drawingUnit, 'inch');
assert.equal(target.fromPdf, 'source.pdf');
n++; console.log('ok TODO 271: restoring a PDF sheet keeps other sheets balloons and its own recovery id');
// TODO 358a: a reopen matches the page pictures' names (drawing-pageN.png) as well as drawing-imgN.png, and gives each its pixels back
const picRecover = runInNewContext(`${source}\nrecoverOne`, {
  BAL, DU, PS, TextEncoder, console, state: {}, Ed: { createHistory: () => ({}) }, balOf: () => BAL.EMPTY, baseName: (name) => name,
  readDrawing: async () => ({ ok: true, doc: { header: {}, entities: [{ type: 'IMAGE', r: { file: 'drawing-page1.png' } }, { type: 'IMAGE', r: { file: 'drawing-page2.png' } }, { type: 'IMAGE', r: { file: 'other.png' } }] } }),
  flatten: () => ({}), preloadPictures: async () => {}, tabFields: (doc) => ({ doc }), addTab: (doc) => { restored = doc; },
});
const pagePics = [{ type: 'IMAGE', r: { px: 'one' } }, { type: 'IMAGE', r: { px: 'two' } }];
assert.equal(await picRecover({ id: 'pg', kind: 'drawing', name: 'pages.dxf', dxf: '', pics: pagePics }), true);
assert.deepEqual(restored.doc.entities.map((e) => e.r.px), ['one', 'two', undefined], 'the two page pictures get their pixels; the other file is left alone');
n++; console.log('ok TODO 358a: recovery matches drawing-pageN.png');

const pdfSource = readFileSync(new URL('./web/app.js', import.meta.url), 'utf8').match(/^async function openPdf\([^\r\n]*\) \{\r?\n[\s\S]*?^\}/m)?.[0];
assert.ok(pdfSource, 'openPdf exists');
const openPdf = runInNewContext(`${pdfSource}\nopenPdf`, { ArrayBuffer, Uint8Array, note: () => {}, readPdf: async () => ({ pages: 1, paths: 0 }), crypto: webcrypto });
for (const copy of [{ pdfPages: 2, sheet: 1 }, { pdfPages: 2, sheet: 2 }, { sheet: 2 }]) {
  await assert.rejects(openPdf('source.pdf', new ArrayBuffer(0), 'E:/source.pdf', [copy]), /source PDF changed/);
}
await assert.rejects(openPdf('source.pdf', new ArrayBuffer(0), 'E:/source.pdf', [{ pdfPages: 1, sheet: 1 }]), /source PDF has no vector lines/);
n++; console.log('ok TODO 271: a changed page count or out-of-range copy falls back before opening a tab');
// TODO 276: same page count, different bytes. readPdf is stubbed (no vector lines), so "opens" = passes the check and reaches that error.
const srcBytes = new Uint8Array([1, 2, 3]).buffer, srcHash = createHash('sha256').update(new Uint8Array(srcBytes)).digest('hex');
await assert.rejects(openPdf('source.pdf', new Uint8Array([1, 2, 4]).buffer, 'E:/source.pdf', [{ pdfPages: 1, pdfHash: srcHash, sheet: 1 }]), /source PDF changed/);
await assert.rejects(openPdf('source.pdf', srcBytes, 'E:/source.pdf', [{ pdfPages: 1, pdfHash: srcHash, sheet: 1 }]), /source PDF has no vector lines/);
await assert.rejects(openPdf('source.pdf', new Uint8Array([1, 2, 4]).buffer, 'E:/source.pdf', [{ pdfPages: 1, sheet: 1 }]), /source PDF has no vector lines/);
await assert.rejects(openPdf('source.pdf', new Uint8Array([1, 2, 4]).buffer, 'E:/source.pdf', [{ pdfPages: 2, pdfHash: srcHash, sheet: 1 }]), /source PDF changed/);
const noCrypto = runInNewContext(`${pdfSource}\nopenPdf`, { ArrayBuffer, Uint8Array, note: () => {}, readPdf: async () => ({ pages: 1, paths: 0 }) });
await assert.rejects(noCrypto('source.pdf', new Uint8Array([1, 2, 4]).buffer, 'E:/source.pdf', [{ pdfPages: 1, pdfHash: srcHash, sheet: 1 }]), /source PDF has no vector lines/);
n++; console.log('ok TODO 276: a changed PDF with the same page count is caught by its hash; no hash on the copy or no crypto keeps the old check');

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
