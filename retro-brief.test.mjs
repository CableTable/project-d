import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retroSessions } from './tools/retro-brief.mjs';

test('TODO 196e: only the first user message selects a Rook transcript and its distinct session names', () => {
  const user = (content) => JSON.stringify({ type: 'user', message: { content } });
  for (const eol of ['\n', '\r\n']) {
    for (const [first, expected] of [
      ['Read resume-rook-S33a.txt; S33, S33a, S33b, S33b', ['S33a', 'S33', 'S33b']],
      [[{ type: 'text', text: 'Read runs33/resume-rook.txt' }, { type: 'text', text: 'Rook S33c' }], ['S33', 'S33c']],
      ['Read runs33/resume-rook.txt', ['S33']],
      ['Read resume-rook-S330a.txt or runs330/resume-rook.txt', null],
      ['Read an unrelated brief', null],
      [null, null],
      [{ text: 'resume-rook-S33a.txt' }, null],
    ]) {
      const text = ['not json', 'null', JSON.stringify({ type: 'assistant' }), user(first), user('resume-rook-S33z.txt')].join(eol);
      assert.deepEqual(retroSessions(text, '33'), expected);
    }
  }
  assert.equal(retroSessions('{}\n{"type":', '33'), null);
});
