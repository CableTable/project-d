import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseCsv, firestoreValue, assertKeyOutsideRepo } from './tools/usage-agent.mjs';

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
