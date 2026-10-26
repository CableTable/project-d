import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACI, parseHex, rgbHex, hsbRgb, rgbHsb, cmykRgb, rgbCmyk, nearestAci, pack420, unpack420, rgbKey, keyRgb, validColourKey } from './web/colour.js';
import { newDoc, addLayer, addBlock, addEntities, line, insert, entity, writeDxf } from './web/dxf-write.js';
import { readDxf, flatten } from './web/drawing.js';
import { withColour } from './web/props.js';

test('hex and pasted RGB accept only complete byte colours', () => {
  for (const text of ['#3399cc', '3399CC', '51,153,204', ' 51, 153, 204 ']) assert.deepEqual(parseHex(text), [51, 153, 204]);
  for (const text of ['', '#123', '#3399ccff', '3399cg', '256,0,0', '-1,0,0', '1.5,0,0', '1,2', '1,2,3x']) assert.equal(parseHex(text), null, text);
  assert.equal(rgbHex([0, 0, 0]), '#000000'); assert.equal(rgbHex([255, 255, 255]), '#ffffff');
});

test('HSB hue, saturation and brightness, including black, grey and hue wrap', () => {
  assert.deepEqual(rgbHsb([255, 0, 0]), [0, 100, 100]);
  assert.deepEqual(rgbHsb([0, 255, 0]), [120, 100, 100]);
  assert.deepEqual(rgbHsb([0, 0, 255]), [240, 100, 100]);
  assert.deepEqual(hsbRgb([360, 100, 100]), [255, 0, 0]);
  assert.deepEqual(rgbHsb([0, 0, 0]), [0, 0, 0]);
  assert.deepEqual(rgbHsb([255, 255, 255]), [0, 0, 100]);
  for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
    const rgb = [r, g, b];
    assert.deepEqual(hsbRgb(rgbHsb(rgb)), rgb);
    assert.deepEqual(cmykRgb(rgbCmyk(rgb)), rgb);
    assert.deepEqual(unpack420(pack420(rgb)), rgb);
  }
});

test('CMYK uses the simple formula and handles pure black without division by zero', () => {
  assert.deepEqual(rgbCmyk([0, 0, 0]), [0, 0, 0, 100]);
  assert.deepEqual(rgbCmyk([255, 255, 255]), [0, 0, 0, 0]);
  assert.deepEqual(rgbCmyk([255, 0, 0]), [0, 100, 100, 0]);
  assert.deepEqual(cmykRgb([50, 0, 100, 20]), [102, 204, 0]);
  assert.equal(pack420([51, 153, 204]), 0x3399cc);
});

test('nearest ACI excludes special indices, preserves exact indexed colours and chooses the smallest distance', () => {
  assert.equal(ACI.length, 256);
  for (const hex of ACI.slice(1)) assert.equal(ACI[nearestAci(parseHex(hex))], hex);
  assert.equal(nearestAci([255, 0, 0]), 1);
  const rgb = [51, 153, 204], index = nearestAci(rgb);
  const distance = (a) => a.reduce((s, n, i) => s + (n - rgb[i]) ** 2, 0);
  assert.ok(index >= 1 && index <= 255);
  assert.equal(distance(parseHex(ACI[index])), Math.min(...ACI.slice(1).map((s) => distance(parseHex(s)))));
  assert.equal(rgbKey([255, 0, 0]), 'aci:1'); assert.equal(rgbKey(rgb), 'tc:' + 0x3399cc);
  assert.deepEqual(keyRgb(rgbKey(rgb)), rgb);
  for (const key of ['bylayer', 'byblock', 'aci:1', 'aci:255', 'tc:0', 'tc:16777215']) assert.equal(validColourKey(key), true);
  for (const key of [null, undefined, {}, ['tc:1'], '', 'aci:0', 'aci:256', 'tc:-1', 'tc:16777216', 'tc:NaN']) assert.equal(validColourKey(key), false);
});

test('nearest ACI maps greys to grey indices and aci:7 opens as black', () => {
  assert.equal(nearestAci([0, 0, 0]), 250);
  assert.equal(nearestAci([255, 255, 255]), 7);
  assert.equal(nearestAci([128, 128, 128]), 8);
  assert.equal(nearestAci([5, 6, 4]), 250);
  assert.deepEqual(keyRgb('aci:7'), [0, 0, 0]);
  assert.equal(rgbKey([255, 255, 255]), 'tc:' + 0xffffff);
  assert.deepEqual(keyRgb(rgbKey([255, 255, 255])), [255, 255, 255]);
});

test('DXF exact RGB and nearest ACI round trip on entities, block members, attributes and off layers', () => {
  const rgb = [51, 153, 204], tc = pack420(rgb), aci = nearestAci(rgb), doc = newDoc();
  addLayer(doc, 'Colour', { tc, aci: 1, off: true });
  const blockLine = line(0, 0, 10, 10, { tc });
  addBlock(doc, 'Coloured', [blockLine]);
  const block = insert('Coloured', 0, 0);
  block.kids = [{ type: 'ATTRIB', c: [8, 62, 420, 10, 20, 40, 1, 2], v: ['0', '256', String(tc), '0', '0', '2', 'Colour', 'TAG'] }];
  addEntities(doc, withColour(line(0, 0, 10, 10), rgbKey(rgb)), line(0, 10, 10, 0, { tc, aci: 256 }), block,
    entity('LINE', [[10, 0], [20, 0], [11, 1], [21, 1]], { aci: 0 }), line(1, 1, 2, 2));
  const back = readDxf(writeDxf(doc));
  assert.equal(back.layers.Colour.tc, tc); assert.equal(back.layers.Colour.aci, aci); assert.equal(back.layers.Colour.off, true);
  for (const ent of [back.entities[0], back.entities[1], back.blocks.Coloured.entities[0]]) {
    assert.equal(ent.tc, tc); assert.equal(ent.aci, aci);
  }
  const kid = back.entities[2].kids[0];
  assert.equal(+kid.v[kid.c.indexOf(62)], aci); assert.equal(+kid.v[kid.c.indexOf(420)], tc);
  assert.equal(back.entities[3].aci, 0); assert.equal(back.entities[3].tc, null);
  assert.equal(back.entities[4].aci, 256); assert.equal(back.entities[4].tc, null);
  assert.equal(flatten(back).items[0].css, '#3399cc');
  assert.equal(readDxf(writeDxf(back)).entities[0].tc, tc);
});
