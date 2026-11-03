import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const outsideRepoPath = (line) => [...line.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\r\n])*)\1|\/\/.*$/g)]
  .some(([, , literal = '']) => /Project D extras|^[A-Za-z]:(?=[\\/]).*[\\/]runs\d+[\\/]/i.test(literal));

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
    ["'../Project D extras/runs30/x'", true],
    ["'/e/Project B/Claude/Project D extras/runs30/a'", true],
    ["join(root, 'Claude/Project D extras')", true],
    [String.raw`'..\\Project D extras\\runs30\\x'`, true],
    ["'E:/sheet-one.dxf'", false],
    ["join(shotDir, '163a')", false],
    ["join(shotDir, '163a'); // Project D extras is outside the repo", false],
    ['join(shotDir, "163a"); // "Project D extras" is outside the repo', false],
    ["join(shotDir, '163a', 'E:/runs30/x')", true],
  ];
  for (const [literal, refused] of cases) assert.equal(outsideRepoPath(literal), refused, literal);
});

test('browser.test.mjs contains no drive-letter literals pointing outside the repo', () => {
  const lines = readFileSync(new URL('./browser.test.mjs', import.meta.url), 'utf8').split(/\r?\n/);
  for (const [i, line] of lines.entries()) {
    assert.equal(outsideRepoPath(line), false, `browser.test.mjs:${i + 1}: use shotDir instead of a path outside the repo`);
  }
});
