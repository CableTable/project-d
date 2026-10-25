import assert from 'node:assert/strict';
import { ribbonTabs, nextFold, doubleFold } from './web/ribbon.js';

assert.deepEqual(ribbonTabs('drawing'), ['Home', 'Draw', 'Modify', 'Annotate', 'View', 'Output']);
assert.deepEqual(ribbonTabs('layout'), ['Home', 'Layout', 'View', 'Output']);
assert.deepEqual(ribbonTabs('layout', true), ['Home', 'Layout', 'View', 'Output', 'Part']);
assert.deepEqual(ribbonTabs('drawing', true), ribbonTabs('drawing'));
assert.deepEqual(ribbonTabs('compare'), ['Home', 'Compare', 'View', 'Output']);
assert.deepEqual(['full', 'titles', 'tabs'].map(nextFold), ['titles', 'tabs', 'full']);
assert.equal(doubleFold('titles', 'full'), 'tabs');
assert.equal(doubleFold('tabs', 'titles'), 'titles');
assert.equal(doubleFold('tabs', 'invalid'), 'full');
console.log('ok ribbon tab sets and fold transitions');
