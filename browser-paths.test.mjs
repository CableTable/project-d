import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('browser.test.mjs contains no drive-letter string literals', () => {
  const lines = readFileSync(new URL('./browser.test.mjs', import.meta.url), 'utf8').split(/\r?\n/);
  for (const [i, line] of lines.entries()) {
    assert.doesNotMatch(line, /['"`][A-Za-z]:[\\/]/, `browser.test.mjs:${i + 1}: use shotDir instead of a drive-letter literal`);
  }
});
