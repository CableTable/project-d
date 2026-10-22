import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codexWindow, resetLabel } from './usage-site/public/usage-window.js';
test('expired five-hour and weekly Codex readings show zero and Reset without guessing the next reset', () => {
  for (const reading of [[100, 10], [61, 15], [0, null], [100, 20]]) {
    const [used, resets] = codexWindow(reading, 20_000);
    assert.equal(used, 0);
    assert.equal(resetLabel(resets, () => assert.fail('unknown reset formatted')), 'Reset');
  }
  assert.deepEqual(codexWindow([61, 30], 20_000), [61, 30]);
  assert.equal(resetLabel(30, String), 'Resets 30');
});
