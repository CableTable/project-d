// savepath.js — the Save dialog's path with its extension, asking before a file is replaced.   node savepath.test.mjs
import assert from 'node:assert/strict';
import { saveDefault, withExt } from './web/savepath.js';

let n = 0;
async function test(name, fn) { await fn(); n++; console.log('ok', name); }
const fake = (files, answer) => {
  const asked = [];
  return { asked, fs: { exists: async (p) => files.includes(p) }, dialog: { ask: async (m) => { asked.push(m); return answer; } } };
};

await test('save suggestions use the source folder and preserve literal names, or leave the native last folder alone', () => {
  for (const [path, want] of [
    ['C:\\jobs\\plate.dxf', 'C:\\jobs\\plate $&.pdf'], ['C:/jobs/plate.pdf', 'C:/jobs/plate $&.pdf'],
    ['\\\\server\\jobs\\plate.dxf', '\\\\server\\jobs\\plate $&.pdf'], ['C:\\plate.dxf', 'C:\\plate $&.pdf'], ['/plate.dxf', '/plate $&.pdf'],
  ]) {
    assert.equal(saveDefault('plate $&.pdf', path), want);
  }
  assert.equal(saveDefault('Drawing 1.pdf', null), 'Drawing 1.pdf');
  assert.equal(saveDefault('Drawing 1.csv'), 'Drawing 1.csv');
});

await test('a path that already ends in the extension is left alone (the dialog asked about it)', async () => {
  const t = fake(['C:\\a\\x.pdf'], false);
  assert.equal(await withExt(t, 'C:\\a\\x.PDF', 'pdf'), 'C:\\a\\x.PDF');
  assert.equal(t.asked.length, 0);
});
await test('an added extension on a free name needs no question', async () => {
  const t = fake([], false);
  assert.equal(await withExt(t, 'C:\\a\\x', 'csv'), 'C:\\a\\x.csv');
  assert.equal(t.asked.length, 0);
});
await test('an added extension on a file that exists asks; No gives null, Yes the path', async () => {
  const no = fake(['C:\\a\\x.dxf'], false), yes = fake(['C:\\a\\x.dxf'], true);
  assert.equal(await withExt(no, 'C:\\a\\x', 'dxf'), null);
  assert.match(no.asked[0], /x\.dxf already exists/);
  assert.equal(await withExt(yes, 'C:\\a\\x', 'dxf'), 'C:\\a\\x.dxf');
});
await test('no way to ask: an existing file is not replaced', async () => {
  assert.equal(await withExt({ fs: { exists: async () => true } }, 'C:\\a\\x', 'json'), null);
});

console.log(n + ' savepath tests passed');
