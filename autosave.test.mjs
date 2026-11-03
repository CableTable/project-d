import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as PS from './web/pdf-sheets.js';

// Exercise the private app function without loading its DOM or changing app exports.
const source = readFileSync(new URL('./web/app.js', import.meta.url), 'utf8').match(/^async function autosaveNow\(\) \{\r?\n[\s\S]*?^\}/m)?.[0];
assert.ok(source, 'autosaveNow exists');
for (const kind of ['drawing', 'layout']) {
  const page = { name: kind, dirty: true, raw: { entities: [], blocks: {}, layers: {} }, ...(kind === 'layout' ? { lay: {} } : {}) };
  const state = { docs: [page] }, writes = [];
  let text = 'first DXF', serializations = 0;
  const autosaveNow = runInNewContext(`${source}\nautosaveNow`, {
    autosaving: false, dropping: false, state, PS, uid: () => kind,
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
    for (const key of ['entities', 'blocks', 'layers', 'titleBlock']) {
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
  console.log(`ok TODO 186: autosaveNow ${kind} write-skip rule`);
}
