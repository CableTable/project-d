import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareSource } from './web/compare-export.js';
import { flatten, readDxf, mapply } from './web/drawing.js';
import { newDoc, addLayer, addEntities, addBlock, insert, rect, text, writeDxf, entity } from './web/dxf-write.js';
import { planPdf, planPagesPdf } from './web/pdf-export.js';
import { PAGES_LAYER } from './web/pdf-read.js';

test('Compare PDF merges visible spaces, hidden layers, factors, block matrices, offsets and tints without changing snapshots', () => {
  const raw = newDoc(4);
  addLayer(raw, 'Hidden');
  addBlock(raw, 'Plate', [rect(0, 0, 10, 5)]);
  addEntities(raw, insert('Plate', 2, 3), text(3, 4, 1, 'VISIBLE'), rect(1000, 1000, 10, 10, { layer: 'Hidden' }), rect(2000, 2000, 5, 5, { ps: 1 }));
  const fl = flatten(readDxf(writeDxf(raw)));
  const a = { name: 'a.dxf', fl, factor: 2, offset: [-4, -6], off: new Set([fl.layers.findIndex((l) => l.name === 'Hidden')]), colour: 'red', visible: true };
  const b = { ...a, name: 'b.dxf', factor: 1, offset: [48, 27], colour: 'blue', checked: false };
  const drawings = [a, b, { ...a, name: 'hidden.dxf', visible: false }], before = structuredClone(drawings);
  const tint = (id) => id === 'red' ? '#c62828' : '#0a5fc2', src = compareSource(drawings, tint);
  assert.deepEqual(drawings, before);
  assert.equal(src.name, 'Compare a.dxf vs b.dxf');
  assert.equal(src.factor, 1);
  assert.deepEqual([src.sheetW, src.sheetH, src.origin], [80, 55, [-10, -10]]);
  assert.deepEqual(src.fl.items.map((it) => it.css), ['#c62828', '#c62828', '#0a5fc2', '#0a5fc2']);
  assert.deepEqual(mapply(src.fl.mats[src.fl.items[0].m], 0, 0), [0, 0]);
  assert.deepEqual(mapply(src.fl.mats[src.fl.items[2].m], 0, 0), [50, 30]);
  const page = planPdf(src, { mirror: false, black: false, separate: false, strip: false }).build(0);
  assert.deepEqual(page.cmds.filter((c) => c[0] === 'T').map((c) => c[1].slice(4)), [[12, 12], [61, 41]]);
  assert.ok(page.cmds.some((c) => c[0] === 'RG' && c[1] === 198 / 255));
  assert.ok(page.cmds.some((c) => c[0] === 'RG' && c[1] === 10 / 255));
  assert.equal(compareSource([drawings[2]], tint), null);
  assert.equal(compareSource([], tint), null);
  assert.equal(compareSource([{ ...a, off: new Set(fl.layers.map((_, i) => i)) }], tint), null);
  assert.equal(compareSource([b], tint).name, 'Compare b.dxf');
});

test('TODO 358c2: a PDF page picture is not tinted in the Compare source, a line is; the pages are the pictures\' own size', () => {
  const PX = 'data:image/png;base64,iVBORw0KGgo=', pics = new Map([[PX, { px: PX, w: 2, h: 2, rgb: new Uint8Array(12), a: null }]]);
  const raw = newDoc(); addLayer(raw, PAGES_LAYER, { aci: 7 });
  const pic = entity('IMAGE', [[10, 0], [20, 0], [30, 0], [11, 10], [21, 0], [31, 0], [12, 0], [22, 10], [32, 0], [13, 8], [23, 5]], { layer: PAGES_LAYER }); pic.r.px = PX;   // 80 × 50 mm
  addEntities(raw, pic, rect(10, 10, 30, 20));
  const fl = flatten(raw), item = { name: 'p.dxf', fl, factor: 1, offset: [5, 7], off: new Set(), colour: 'red', visible: true };
  const src = compareSource([item], () => '#c62828');
  assert.deepEqual(src.fl.items.map((it) => [it.k, it.css === '#c62828']), [['i', false], ['p', true]], 'the picture keeps its own colour, the rectangle is tinted');
  const plan = planPagesPdf({ ...src, pics });
  assert.deepEqual(plan.pages.map((p) => [p.w, p.h]), [[80, 50]], 'the page is the picture, not the compare border box');
  assert.equal(plan.outside, 0);
});
