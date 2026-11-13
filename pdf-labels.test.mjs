import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFit, planPdf } from './web/pdf-export.js';
import { textWidthEm } from './web/pdf-write.js';
import { newDoc, addEntities, line } from './web/dxf-write.js';
import { flatten } from './web/drawing.js';
import { batchPdfSource } from './web/pdf-source.js';
import { newLayout, layoutRaw } from './web/layoutdoc.js';

const grippers = { gripTop: 1, gripRight: 1, gripBottom: 1, gripLeft: 1 };
const src = { fl: flatten(addEntities(newDoc(4), line(10, 10, 90, 90))), factor: 1, sheetW: 520, sheetH: 400, grippers };
const margins = (v) => ({ top: v, right: v, bottom: v, left: v });

function inside(plan) {
  for (let i = 0; i < plan.count; i++) {
    const p = plan.pages[i], labels = plan.build(i).cmds.filter((c) => c[0] === 'T' && /^(Gripper |[\d.]+ mm$)/.test(c[2]));
    assert.equal(labels.length, 6);
    for (const [, [a, b, c, d, x, y], text] of labels) {
      for (const u of [0, textWidthEm(text)]) for (const v of [-0.22, 0.94]) {
        const px = x + a * u + c * v, py = y + b * u + d * v;
        assert.ok(px >= 0 && px <= p.w && py >= 0 && py <= p.h, `${text}: ${px}, ${py} outside ${p.w}, ${p.h}`);
        assert.ok(py >= (plan.options.titleBlock.enabled ? 22 : 0), `${text} overlaps title block`);
      }
    }
  }
}

test('TODO 263: checkFit reserves labels at zero and small margins; unchecked fit is unchanged', () => {
  for (const margin of [0, 1, 2, 5, 10]) for (const title of [false, true]) for (const [w, h] of [[520, 400], [400, 520]]) {
    const m = margins(margin), aw = 297 - 2 * margin, ah = 210 - 2 * margin - (title ? 22 : 0), s = Math.min(aw / w, ah / h);
    const base = { s, ox: margin + (aw - w * s) / 2, oy: margin + (title ? 22 : 0) + (ah - h * s) / 2 };
    assert.deepEqual(checkFit(w, h, 297, 210, title, m, false), base);
    const fit = checkFit(w, h, 297, 210, title, m, true);
    assert.ok(fit.s < s, 'ticked fit must reserve label room');
    assert.ok(fit.ox >= margin + 8 && fit.oy >= margin + (title ? 22 : 0) + 4.5 - 1e-9);
    const plan = planPdf({ ...src, sheetW: w, sheetH: h }, { page: 'check', sheetSizeGripper: true, margins: m, titleBlock: { enabled: title } });
    inside(plan);
  }
});

test('TODO 263: typed scale is preserved and offset; labels that cannot fit are reported', () => {
  const o = { page: 'custom', customPaper: 'A4', scale: 0.4, sheetSizeGripper: true, margins: margins(0) };
  const plan = planPdf(src, o);
  assert.equal(plan.pages[0].scale, 0.4);
  assert.equal(plan.pages[0].tile, null);
  inside(plan);
  assert.throws(() => planPdf({ ...src, sheetW: 297, sheetH: 188 }, { ...o, scale: 1 }), /Sheet labels do not fit at 1:1/);
  assert.equal(planPdf({ ...src, sheetW: 297, sheetH: 188 }, { ...o, scale: 1, sheetSizeGripper: false }).pages[0].tile, null);
});

test('TODO 263: batch layouts carry their narrow grippers into label fitting', () => {
  const lay = newLayout('Batch labels');
  Object.assign(lay.s, { sheetW: 520, sheetH: 400, ...grippers });
  const doc = layoutRaw(lay), source = batchPdfSource({ doc, result: flatten(doc) }, { w: 520, h: 400 });
  inside(planPdf(source, { page: 'check', sheetSizeGripper: true, margins: margins(0) }));
});

test('TODO 263: bands that stay wide or become narrow after reducing scale still fit', () => {
  for (const value of [7.5, 20]) {
    const grippers = { gripTop: value, gripRight: value, gripBottom: value, gripLeft: value };
    inside(planPdf({ ...src, grippers }, { page: 'check', sheetSizeGripper: true, margins: margins(0) }));
  }
});
