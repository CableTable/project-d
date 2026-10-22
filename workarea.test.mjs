import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workAreaDark } from './web/workarea.js';

test('work area overrides either app theme; Follow app keeps the app background', () => {
  for (const appDark of [false, true]) {
    assert.equal(workAreaDark('Follow app', appDark), appDark);
    assert.equal(workAreaDark('Light', appDark), false);
    assert.equal(workAreaDark('Dark', appDark), true);
  }
});
