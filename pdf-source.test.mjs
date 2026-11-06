import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchPdfSource } from './web/pdf-source.js';
import { planPdf } from './web/pdf-export.js';
import { newLayout, layoutRaw, makePart } from './web/layoutdoc.js';
import { flatten, readDxf } from './web/drawing.js';
import { newDoc, addEntities, line, writeDxf } from './web/dxf-write.js';

test('TODO 202: batch keeps its own sheet size and hides nothing; a layout file adds only its grippers', () => {
  const drawing = addEntities(newDoc(4), line(0, 0, 100, 80)), sources = [];
  for (const [sheetW, sheetH, gripTop, gripRight, gripBottom, gripLeft] of [[800, 600, 20, 30, 40, 50], [900, 700, 1, 0, 12.5, 0]]) {
    const lay = newLayout('Batch');
    Object.assign(lay.s, { sheetW, sheetH, gripTop, gripRight, gripBottom, gripLeft });
    lay.parts.p = makePart('p', 'Plate', drawing);
    lay.placed = [{ partId: 'p', x: 200, y: 200, rot: 0 }];
    sources.push({ raw: layoutRaw(lay), expected: { sheetW: 1000, sheetH: 700, grippers: { gripTop, gripRight, gripBottom, gripLeft } } });
  }
  sources.push({ raw: drawing, expected: { sheetW: 1000, sheetH: 700 } });
  for (const { raw, expected } of sources) {
    const doc = readDxf(writeDxf(raw)), src = batchPdfSource({ doc, result: flatten(doc) }, { w: 1000, h: 700 });
    assert.equal(src.sheetW, expected.sheetW); assert.equal(src.sheetH, expected.sheetH);
    assert.deepEqual(src.hide, [], 'Batch hides nothing, a layout keeps its own crop and registration marks');
    assert.deepEqual(src.grippers, expected.grippers);
    const plan = planPdf(src, { page: 'check', sheetSizeGripper: true, titleBlock: { enabled: false } });
    for (let i = 0; i < plan.count; i++) {
      const labels = plan.build(i).cmds.filter((c) => c[0] === 'T').map((c) => c[2]);
      assert.ok(labels.includes(`${expected.sheetW} mm`) && labels.includes(`${expected.sheetH} mm`));
      const grippers = Object.values(expected.grippers || {}).filter((v) => v > 0).map((v) => `Gripper ${v} mm`);
      assert.deepEqual(labels.filter((s) => s.startsWith('Gripper')), grippers);
    }
  }
});
