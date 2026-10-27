// readout.js — the colour under the cursor.   node readout.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { colourAtItem, colourAtLayout, readoutValues, cssRgb } from './web/readout.js';
import { newDoc, addLayer, addBlock, insert, line, rect, circle } from './web/dxf-write.js';
import { flatten } from './web/drawing.js';
import { makeIndex } from './web/edit.js';
import { newLayout, makePart } from './web/layoutdoc.js';
import { placement1 } from './web/apply.js';

const docOf = (setup, ...entities) => { const raw = newDoc(); setup?.(raw); raw.entities = entities; return raw; };
const at = (raw, x, y, tol = 0.5) => colourAtItem(makeIndex(raw, flatten(raw)), x, y, tol);
const withLayers = (raw) => { addLayer(raw, 'Red', { aci: 1 }); addLayer(raw, 'Tru', { tc: 0x3399cc }); };

test('TODO 148d: a line is its own colour, ByLayer goes through the layer, ByBlock is ACI 7', () => {
  const raw = docOf(withLayers, line(0, 0, 10, 0, { layer: 'Red' }), line(0, 10, 10, 10, { layer: 'Red', aci: 5 }), line(0, 20, 10, 20, { layer: 'Tru' }),
    line(0, 30, 10, 30, { layer: 'Red', tc: 0x102030 }), line(0, 40, 10, 40, { layer: 'Red', aci: 7 }), line(0, 50, 10, 50));
  assert.deepEqual([0, 10, 20, 30, 40, 50].map((y) => at(raw, 5, y)), [[255, 0, 0], [0, 0, 255], [0x33, 0x99, 0xcc], [0x10, 0x20, 0x30], [0, 0, 0], [0, 0, 0]]);
  assert.equal(at(raw, 5, 100), null);
});

test('TODO 148d: inside a filled outline and off the line it is the fill; on the line, or unfilled, the line', () => {
  const raw = docOf(withLayers, { ...rect(0, 0, 100, 100, { layer: 'Red' }), fill: 'tc:65280' }, rect(200, 0, 100, 100, { layer: 'Red' }));
  assert.deepEqual(at(raw, 50, 50), [0, 255, 0]);
  assert.deepEqual(at(raw, 0, 50), [255, 0, 0]);
  assert.equal(at(raw, 250, 50), null);                                          // unfilled: nothing inside the line
});

test('TODO 148d review: a ByLayer fill is the layer colour (not white); ByBlock and ACI 7 read black', () => {
  for (const [fill, want] of [['bylayer', [255, 0, 0]], ['byblock', [255, 0, 0]], ['aci:7', [0, 0, 0]], ['aci:5', [0, 0, 255]]]) {
    assert.deepEqual(at(docOf(withLayers, { ...rect(0, 0, 100, 100, { layer: 'Red' }), fill }), 50, 50), want, fill);
  }
  assert.deepEqual(at(docOf(withLayers, { ...rect(0, 0, 100, 100, { layer: 'Tru' }), fill: 'bylayer' }), 50, 50), [0x33, 0x99, 0xcc]);
  assert.deepEqual(at(docOf(withLayers, { ...rect(0, 0, 100, 100), fill: 'bylayer' }), 50, 50), [0, 0, 0], 'layer 0 is ACI 7');
});

test('TODO 148d review: a line inside a block reads its own colour, not the INSERT colour',() => {
  const raw = docOf(withLayers, insert('B', 100, 0, { layer: 'Red' }));
  addBlock(raw, 'B', [line(0, 0, 10, 0, { aci: 3 }), line(0, 10, 10, 10, { tc: 0x102030 }), line(0, 20, 10, 20)]);       // a layer-0 ByLayer line takes the INSERT's layer
  assert.deepEqual([0, 10, 20].map((y) => at(raw, 105, y)), [[0, 255, 0], [0x10, 0x20, 0x30], [255, 0, 0]]);
});

test('TODO 148d review: a placed layout part reads its own item colour, turned and moved with the placement', () => {
  const lay = newLayout('L');
  lay.parts = { p: makePart('p', 'Plate', docOf(withLayers, { ...rect(0, 0, 20, 20, { layer: 'Red' }), fill: 'tc:65280' }, line(30, 0, 30, 10, { aci: 5 })), 1) };
  lay.placed = [placement1('p', 100, 200), placement1('p', 300, 200, 90)];
  assert.deepEqual(colourAtLayout(lay.parts, lay.placed, 110, 210, 0.5), [0, 255, 0]);
  assert.deepEqual(colourAtLayout(lay.parts, lay.placed, 100, 210, 0.5), [255, 0, 0], 'on its outline');
  assert.deepEqual(colourAtLayout(lay.parts, lay.placed, 290, 210, 0.5), [0, 255, 0], 'the turned copy');
  assert.equal(colourAtLayout(lay.parts, lay.placed, 500, 500, 0.5), null);
});

test('TODO 148d: values are RGB, whole-percent CMYK and upper-case hex', () => {
  assert.deepEqual(readoutValues([255, 0, 0]), { rgb: [255, 0, 0], cmyk: [0, 100, 100, 0], hex: '#FF0000' });
  assert.equal(readoutValues([0x33, 0x99, 0xcc]).hex, '#3399CC');
  assert.deepEqual(readoutValues([0, 0, 0]).cmyk, [0, 0, 0, 100]);
});

test('TODO 148e: readout leaves holes empty and reads the nested ring and inner fill', () => {
  const raw = docOf(null, { ...rect(0, 0, 100, 100), fill: 'aci:1' }, circle(30, 30, 20), circle(30, 30, 5),
    { ...circle(75, 75, 10), fill: 'aci:3' });
  assert.equal(at(raw, 40, 30), null);
  assert.deepEqual(at(raw, 30, 30), [255, 0, 0]);
  assert.deepEqual(at(raw, 75, 75), [0, 255, 0]);
});

test('TODO 148d: computed CSS colours', () => {
  assert.deepEqual(cssRgb('rgb(242, 242, 242)'), [242, 242, 242]);
  assert.deepEqual(cssRgb('rgba(1, 2, 3, 0.5)'), [1, 2, 3]);
  assert.deepEqual(cssRgb('rgb(1 2 3 / 50%)'), [1, 2, 3]);
  assert.equal(cssRgb('rgba(0, 0, 0, 0)'), null);
  assert.equal(cssRgb('transparent'), null);
  assert.equal(cssRgb('none'), null);
});
