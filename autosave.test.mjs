import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as PS from './web/pdf-sheets.js';
import * as BAL from './web/balloons.js';
import { newDoc, writeDxf } from './web/dxf-write.js';
import { readDxf } from './web/drawing.js';

// Exercise the private app function without loading its DOM or changing app exports.
const source = readFileSync(new URL('./web/app.js', import.meta.url), 'utf8').match(/^async function autosaveNow\(\) \{\r?\n[\s\S]*?^\}/m)?.[0];
assert.ok(source, 'autosaveNow exists');
for (const kind of ['drawing', 'layout']) {
  const page = { name: kind, dirty: true, raw: { entities: [], blocks: {}, layers: {} }, ...(kind === 'layout' ? { lay: {} } : {}) };
  const state = { docs: [page] }, writes = [];
  let text = 'first DXF', serializations = 0;
  const autosaveNow = runInNewContext(`${source}\nautosaveNow`, {
    autosaving: false, dropping: false, state, PS, BAL, newDoc, balOf: (d) => d.balloons || BAL.EMPTY, uid: () => kind,
    rawForSave: (d) => d.raw,
    writeDxf: () => { serializations++; return text; },
    RC: { saveCopy: async (copy) => { writes.push(copy); } },
    dropCopy: async () => assert.fail('a dirty tab must keep its recovery copy'),
    console,
  });
  await autosaveNow();
  assert.equal(writes.length, 1, kind + ': first copy is written');
  assert.equal(page.recovery.autoTab, 0);
  const serialized = serializations;
  await autosaveNow();
  assert.equal(writes.length, 1, kind + ': unchanged content and tab index skip the write');
  assert.equal(serializations, serialized + (kind === 'layout' ? 1 : 0), kind + ': drawings skip serialization; layouts compare serialized text');
  state.docs.unshift({ pdf: { busy: true } });
  await autosaveNow();
  assert.equal(writes.length, 2, kind + ': tab index alone forces a rewrite');
  assert.equal(writes.at(-1).tab, 1);
  assert.equal(page.recovery.autoTab, 1, kind + ': remember the rewritten index');
  await autosaveNow();
  assert.equal(writes.length, 2, kind + ': unchanged after rewrite skips again');
  state.docs.shift();
  await autosaveNow();
  assert.equal(writes.length, 3, kind + ': closing an earlier tab also forces a rewrite');
  assert.equal(writes.at(-1).tab, 0);
  if (kind === 'drawing') {
    for (const key of ['entities', 'blocks', 'layers', 'titleBlock', 'groups', 'ltypes', 'header']) {
      const target = key === 'titleBlock' ? page : page.raw;
      target[key] = key === 'entities' ? [] : {};
      const before = writes.length;
      await autosaveNow();
      assert.equal(writes.length, before + 1, key + ': changed reference forces a write at the same index');
      await autosaveNow();
      assert.equal(writes.length, before + 1, key + ': unchanged reference skips again');
    }
  } else {
    text = 'changed DXF';
    await autosaveNow();
    assert.equal(writes.length, 4, 'layout: changed text forces a write at the same index');
    page.recovery.hasCopy = false;
    await autosaveNow();
    assert.equal(writes.length, 5, 'layout: no stored copy must write even with matching text and index');
  }
  for (const key of ['balloons', 'drawingUnit']) {
    const before = writes.length;
    page[key] = key === 'balloons' ? BAL.add(BAL.EMPTY, { tip: [1, 2], c: [3, 4] }) : 'ft-in';
    await autosaveNow();
    assert.equal(writes.length, before + 1, kind + ': ' + key + ' alone forces a write');
    assert.equal(writes.at(-1).balloons, BAL.encode(page.balloons, { source: page.name, pages: 1 }));
    assert.equal(writes.at(-1).unit, page.drawingUnit || null);
    await autosaveNow();
    assert.equal(writes.length, before + 1, kind + ': unchanged ' + key + ' skips again');
  }
  console.log(`ok TODO 186: autosaveNow ${kind} write-skip rule`);
}
console.log('ok a balloon-only or group-only change writes a new copy');

const raw = newDoc(), first = { name: 'sheet1', raw, dirty: true }, second = { name: 'sheet2', raw, dirty: true };
const drawing = { ...second, drawingUnit: 'inch', balloons: BAL.add(BAL.EMPTY, { tip: [10, 10], c: [20, 20], sheet: 1 }), pdf: { name: 'scan.pdf', page: 2, pages: 2, states: new Map([[1, first]]) } };
const writes = [], state = { docs: [drawing] };
const autosaveNow = runInNewContext(`${source}\nautosaveNow`, {
  autosaving: false, dropping: false, state, PS, BAL, newDoc, balOf: (d) => d.balloons || BAL.EMPTY, uid: () => 'pdf',
  rawForSave: (d) => d.raw, writeDxf,
  RC: { saveCopy: async (copy) => { writes.push(copy); } }, dropCopy: async () => assert.fail('dirty sheet'), console,
});
await autosaveNow(); assert.equal(writes.length, 2);
drawing.balloons = BAL.update(drawing.balloons, 1, { note: 'edited while sheet 2 is active' });
await autosaveNow(); assert.equal(writes.length, 4);
for (const copy of writes.slice(-2)) {
  assert.equal(BAL.decode(copy.balloons).set.items[0].note, 'edited while sheet 2 is active');
  assert.equal(copy.unit, 'inch');
}
assert.deepEqual(writes.slice(-2).map((c) => c.sheet), [1, 2]);
await autosaveNow(); assert.equal(writes.length, 4);
state.docs = [{ name: 'picture.png', dirty: true, balloons: drawing.balloons }];
await autosaveNow(); assert.equal(writes.length, 5, 'balloons without raw still get a valid empty drawing copy');
assert.equal(readDxf(writes.at(-1).dxf).entities.length, 0); assert.ok(writes.at(-1).balloons);
await autosaveNow(); assert.equal(writes.length, 5, 'unchanged balloons without raw skip again');
console.log('ok recovery: every sheet uses live tab balloons and unit; balloon-only tabs without raw are copied');
