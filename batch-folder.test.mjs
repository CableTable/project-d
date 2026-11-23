import test from 'node:test';
import assert from 'node:assert/strict';
import { outPath, batchOutDir, newBatch, joinPath } from './web/batch-folder.js';

test('outPath: bracket.dxf + bracket.dwg give two different names; a file already there is skipped (TODO 109d2 R1, R2)', async () => {
  const onDisk = new Set(['c:\\out\\bracket-export.dxf']), used = new Set(), exists = async (p) => onDisk.has(p.toLowerCase());
  const a = await outPath('C:\\out', 'bracket-export', 'dxf', used, exists);                    // from bracket.dxf: the name is on disk
  const b = await outPath('C:\\out', 'bracket-export', 'dxf', used, exists);                    // from bracket.dwg: the same base name
  const c = await outPath('C:\\out\\', 'Bracket-Export', 'dxf', used, exists);                  // a third, in capitals: still taken (case-insensitive)
  assert.deepEqual([a, b, c], ['C:\\out\\bracket-export (2).dxf', 'C:\\out\\bracket-export (3).dxf', 'C:\\out\\Bracket-Export (4).dxf']);
  assert.equal(await outPath('C:\\out', 'bracket-export', 'svg', used, exists), 'C:\\out\\bracket-export.svg', 'another extension is its own name');
});

test('outPath: a slash path keeps its slashes; no folder (the browser) is a bare name, still distinct', async () => {
  assert.equal(await outPath('/out', 'a', 'pdf', new Set(), async () => false), '/out/a.pdf');
  const used = new Set(), no = async () => false;
  assert.deepEqual([await outPath(null, 'dup-export', 'svg', used, no), await outPath(null, 'dup-export', 'svg', used, no)], ['dup-export.svg', 'dup-export (2).svg']);
  assert.equal(joinPath('C:\\x\\', 'f.dxf'), 'C:\\x\\f.dxf');
});

test('batchOutDir: next to each file, or one folder asked once (cancel = false)', async () => {
  const B = { ...newBatch(), saveTo: 'choose' }; let asked = 0;
  const t = { dialog: { open: async () => { asked++; return asked === 1 ? null : ['C:\\pick']; } } };
  assert.equal(await batchOutDir(newBatch(), t, true), null);
  assert.equal(await batchOutDir(B, t, false), null, 'the browser has no folder');
  assert.equal(await batchOutDir(B, t, true), false, 'cancelled');
  assert.equal(await batchOutDir(B, t, true), 'C:\\pick');
  assert.equal(await batchOutDir(B, t, true), 'C:\\pick'); assert.equal(asked, 2, 'asked once');
});
