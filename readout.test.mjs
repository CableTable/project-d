// readout.js — the colour under the cursor.   node readout.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { colourUnder, readoutValues, cssRgb } from './web/readout.js';

const layers = { Red: { aci: 1 }, Tru: { tc: 0x3399cc } };

test('TODO 148d: a line is its own colour, ByLayer goes through the layer, ByBlock is ACI 7', () => {
  assert.deepEqual(colourUnder({ layer: 'Red', aci: 256 }, layers, true), [255, 0, 0]);
  assert.deepEqual(colourUnder({ layer: 'Red', aci: 5 }, layers, true), [0, 0, 255]);
  assert.deepEqual(colourUnder({ layer: 'Tru', aci: 256 }, layers, true), [0x33, 0x99, 0xcc]);
  assert.deepEqual(colourUnder({ layer: 'Red', tc: 0x102030 }, layers, true), [0x10, 0x20, 0x30]);
  assert.deepEqual(colourUnder({ layer: 'Red', aci: 0 }, layers, true), [0, 0, 0]);
  assert.deepEqual(colourUnder({ layer: 'Missing' }, layers, true), [0, 0, 0]);
});

test('TODO 148d: inside a filled outline and off the line it is the fill; on the line, or unfilled, the line', () => {
  const e = { layer: 'Red', aci: 256, fill: 'tc:65280' };
  assert.deepEqual(colourUnder(e, layers, false), [0, 255, 0]);
  assert.deepEqual(colourUnder(e, layers, true), [255, 0, 0]);
  assert.deepEqual(colourUnder({ layer: 'Red', aci: 256 }, layers, false), [255, 0, 0]);
});

test('TODO 148d: values are RGB, whole-percent CMYK and upper-case hex', () => {
  assert.deepEqual(readoutValues([255, 0, 0]), { rgb: [255, 0, 0], cmyk: [0, 100, 100, 0], hex: '#FF0000' });
  assert.equal(readoutValues([0x33, 0x99, 0xcc]).hex, '#3399CC');
  assert.deepEqual(readoutValues([0, 0, 0]).cmyk, [0, 0, 0, 100]);
});

test('TODO 148d: computed CSS colours', () => {
  assert.deepEqual(cssRgb('rgb(242, 242, 242)'), [242, 242, 242]);
  assert.deepEqual(cssRgb('rgba(1, 2, 3, 0.5)'), [1, 2, 3]);
  assert.deepEqual(cssRgb('rgb(1 2 3 / 50%)'), [1, 2, 3]);
  assert.equal(cssRgb('rgba(0, 0, 0, 0)'), null);
  assert.equal(cssRgb('transparent'), null);
  assert.equal(cssRgb('none'), null);
});
