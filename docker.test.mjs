import assert from 'node:assert/strict';
import { panelWidth } from './web/docker.js';

assert.equal(panelWidth(180), 220);
assert.equal(panelWidth(700), 520);
assert.equal(panelWidth(345), 345);
assert.equal(panelWidth(289.99), 290);
assert.equal(panelWidth(290.4), 290);
assert.equal(panelWidth(290.6), 291);
for (const value of [undefined, null, '400', NaN, Infinity]) assert.equal(panelWidth(value), 290);
