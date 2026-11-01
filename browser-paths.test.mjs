import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const outsideRepoPath = /['"`][A-Za-z]:(?=[\\/])[^'"`\r\n]*(?:Project D extras|[\\/]runs\d+[\\/])/i;

test('drive-path guard refuses outside-repo paths and accepts fake file names', () => {
  const cases = [
    ['`E:/Project B/Claude/Project D extras/runs30/shots-163a/${name}-${theme}.png`', true],
    ["'E:/Project B/Claude/Project D extras/runs30/shots-163a'", true],
    ["'E:/Project B/Claude/Project D extras/runs30/shots-163b'", true],
    ['`E:/Project B/Claude/Project D extras/runs30/shots-163b/${name}-${theme}.png`', true],
    ["'E:/Project B/Claude/Project D extras/runs30/shots-164b1'", true],
    ["'E:/Project B/Claude/Project D extras/runs30/shots-164b2'", true],
    ["window.__paths = ['E:/sheet-one.dxf', null]", false],
    ['`E:/runs30/${name}.png`', true],
    [String.raw`'E:\\elsewhere\\runs30\\x'`, true],
  ];
  for (const [literal, refused] of cases) assert.equal(outsideRepoPath.test(literal), refused, literal);
});

test('browser.test.mjs contains no drive-letter literals pointing outside the repo', () => {
  const lines = readFileSync(new URL('./browser.test.mjs', import.meta.url), 'utf8').split(/\r?\n/);
  for (const [i, line] of lines.entries()) {
    assert.doesNotMatch(line, outsideRepoPath, `browser.test.mjs:${i + 1}: use shotDir instead of a path outside the repo`);
  }
});
