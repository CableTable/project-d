import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseTodo, parseCsv, firestoreValue, assertKeyOutsideRepo } from './tools/usage-agent.mjs';

test('TODO keeps every section, continuation text and section-local numbers, with done winning duplicates', () => {
  const sample = `# Made-up TODO
Intro.
## First
1. **Open <thing>** (S–M): More detail.
   Continued detail.
2. **Old task** (M): Still open here.

More ideas:
3. Plain task. Extra detail.
2. ✅ (built today) **Finished task** (bug, S): Shipped.
2. **Stale copy** (L)
4. **Large task** (his ask, L): Later.
5. Small task (S): A plain title.
## Next
1. **Another task** (M): Different number scope.
2. ✅ Plain finished. Kept too.
## Empty
## Last
1. No tag.
`;
  assert.deepEqual(parseTodo('\uFEFF' + sample.replace(/\n/g, '\r\n')), { sections: [
    { title: 'First', items: [
      { num: 1, title: 'Open <thing>', size: 'S–M', done: false, text: '(S–M): More detail. Continued detail.' },
      { num: 3, title: 'Plain task.', size: '', done: false, text: 'Extra detail.' },
      { num: 2, title: 'Finished task', size: 'S', done: true, text: '(built today) (bug, S): Shipped.' },
      { num: 4, title: 'Large task', size: 'L', done: false, text: '(his ask, L): Later.' },
      { num: 5, title: 'Small task', size: 'S', done: false, text: '(S): A plain title.' },
    ] },
    { title: 'Next', items: [
      { num: 1, title: 'Another task', size: 'M', done: false, text: '(M): Different number scope.' },
      { num: 2, title: 'Plain finished.', size: '', done: true, text: 'Kept too.' },
    ] },
    { title: 'Empty', items: [] },
    { title: 'Last', items: [{ num: 1, title: 'No tag.', size: '', done: false, text: '' }] },
  ] });
  assert.deepEqual(parseTodo(''), { sections: [] });
});

test('CSV preserves empty cells, CRLF, BOM, quoted commas, escaped quotes and newlines', () => {
  assert.deepEqual(parseCsv('\uFEFFid,task,new_tokens\r\n1,"Fix, then ""test""\nagain",\r\n\r\n2,Done,0'), [
    { id: '1', task: 'Fix, then "test"\nagain', new_tokens: '' },
    { id: '2', task: 'Done', new_tokens: '0' },
  ]);
  assert.deepEqual(parseCsv('a,b\nx,'), [{ a: 'x', b: '' }]);
  assert.deepEqual(parseCsv('a\n""'), [{ a: '' }]);
  assert.deepEqual(parseCsv('a,b\n'), []);
  assert.deepEqual(parseCsv(''), []);
  for (const csv of ['a,b\n1', 'a,b\n1,2,3', 'a\n"unfinished', 'a\n"x"no', 'a\nno"', 'a,a\n1,2', ',b\n1,2']) {
    assert.throws(() => parseCsv(csv), /CSV|quote/);
  }
});

test('Firestore REST Value encoding keeps typed data and empty arrays/maps', () => {
  assert.deepEqual(firestoreValue({ rows: [{ n: 0, fraction: 1.25, empty: '', yes: true, no: false, nil: null }] }), {
    mapValue: { fields: { rows: { arrayValue: { values: [{ mapValue: { fields: {
      n: { integerValue: '0' }, fraction: { doubleValue: 1.25 }, empty: { stringValue: '' },
      yes: { booleanValue: true }, no: { booleanValue: false }, nil: { nullValue: null },
    } } }] } } } },
  });
  assert.deepEqual(firestoreValue([]), { arrayValue: { values: [] } });
  assert.deepEqual(firestoreValue({}), { mapValue: { fields: {} } });
  assert.deepEqual(firestoreValue(new Date('2026-10-20T12:00:00Z')), { timestampValue: '2026-10-20T12:00:00.000Z' });
  assert.deepEqual(firestoreValue(-123), { integerValue: '-123' });
  for (const value of [undefined, NaN, Infinity, new Date('invalid'), () => {}, [[1]]]) assert.throws(() => firestoreValue(value));
});

test('key guard refuses repo keys and permits a sibling outside the repo', () => {
  const folder = mkdtempSync(join(tmpdir(), 'projectd-agent-'));
  try {
    const repo = join(folder, 'repo'), sibling = join(folder, 'repo-other');
    mkdirSync(repo); mkdirSync(sibling);
    const inside = join(repo, 'firebase-key.json'), outside = join(sibling, 'firebase-key.json');
    writeFileSync(inside, '{}'); writeFileSync(outside, '{}');
    assert.throws(() => assertKeyOutsideRepo(inside, repo), /Refusing to start.*inside the repo/);
    assert.throws(() => assertKeyOutsideRepo(join(repo, 'missing-key.json'), repo), /Refusing to start.*inside the repo/);
    assert.doesNotThrow(() => assertKeyOutsideRepo(outside, repo));
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
