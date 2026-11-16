import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addedLines, releaseTag } from './tools/release-notes.mjs';

const TODO = [
  '- [x] 300. **Big drawing opens** (done: `abc`)',
  '- [ ] 301. **Still open row** (S)',
  '- [x] 302. **Born ticked** (S)',
  '- [ ] 287. **Usage page: latest exe**',
].join('\r\n');

test('addedLines: ids from TODO subjects, title from the row, oldest first, once each', () => {
  const log = [
    'TODO 302 fix: turn by hand', // newest
    'TODO 300 ticked, 302 note (CI 1 green)', // Rook's tick commit: not an exe change
    'Session 48 fix: status bar',
    'TODO 287a: date tags; usage card', // no row 287a: the subject text
    'TODO 300: no Out of Memory',
    'TODO 300 fix: second round',
    'Merge pull request #5',
  ];
  assert.deepEqual(addedLines(log, TODO), ['300 Big drawing opens', '287a date tags; usage card', '302 Born ticked']);
});

test('addedLines: a row still `[ ]` is listed when its commit is in the range; no TODO commits = no lines', () => {
  assert.deepEqual(addedLines(['TODO 301: open row'], TODO), ['301 Still open row']);
  assert.deepEqual(addedLines(['Session 48 fix: x', 'TODO 300 ticked (CI green)'], TODO), []);
});

test('releaseTag: the IST date, .2 and .3 when that day has a tag', () => {
  const now = new Date('2026-11-15T20:00:00Z'); // 01:30 IST on the 16th
  assert.equal(releaseTag(['v0.1.360'], now), 'v2026.11.16');
  assert.equal(releaseTag(['v2026.11.16', 'v2026.11.15'], now), 'v2026.11.16.2');
  assert.equal(releaseTag(['v2026.11.16', 'v2026.11.16.2'], now), 'v2026.11.16.3');
  assert.equal(releaseTag([], new Date('2026-11-16T18:00:00Z')), 'v2026.11.16'); // 23:30 IST, still the 16th
});
