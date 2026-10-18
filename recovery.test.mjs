// recovery.js — the pure parts: the prompt, the time text, and cleaning what comes back from storage.   node recovery.test.mjs
import assert from 'node:assert/strict';
import * as R from './web/recovery.js';

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

console.log(n + ' tests passed');
