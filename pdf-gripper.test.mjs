import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPdf } from './web/pdf-export.js';
import { textWidthEm } from './web/pdf-write.js';
import { flatten } from './web/drawing.js';
import { newDoc, addEntities, addLayer, line } from './web/dxf-write.js';
import { stepRepeat } from './web/layout.js';
import { labelGaps } from './web/pdf-source.js';

const raw = newDoc(4);
addLayer(raw, 'Adhesive', { aci: 1 });
addEntities(raw, line(100, 100, 500, 400), line(200, 200, 600, 500, { layer: 'Adhesive' }));
const src = { fl: flatten(raw), factor: 1, off: new Set(), sheetW: 1000, sheetH: 700, grippers: { gripTop: 20, gripRight: 30, gripBottom: 12.5, gripLeft: 0 } };
const opts = { page: 'check', sheetSizeGripper: true, titleBlock: { enabled: false }, strip: false };
const texts = (p) => p.cmds.filter((c) => c[0] === 'T');
const bands = (p) => p.cmds.filter((c) => c[0] === 'rg' && c.slice(1).every((n) => n === 0.85));

test('TODO 202: each check separation has non-zero bands and size dimensions even with title block off', () => {
  const plan = planPdf(src, opts);
  assert.equal(plan.count, 2);
  for (let i = 0; i < plan.count; i++) {
    const page = plan.build(i), labels = texts(page);
    assert.deepEqual(labels.map((c) => c[2]), ['Gripper 20 mm', 'Gripper 30 mm', 'Gripper 12.5 mm', '1000 mm', '700 mm']);
    assert.equal(bands(page).length, 3);
    const { s: sc, ox: sx, oy: sy } = plan.pages[i]._geo.scale, eps = 1e-6;
    for (const b of bands(page)) {
      const at = page.cmds.indexOf(b) + 1, corners = page.cmds.slice(at).filter((c) => c[0] === 'm' || c[0] === 'l').slice(0, 4);
      assert.equal(corners.length, 4);
      for (const [, x, y] of corners) assert.ok(x >= sx - eps && y >= sy - eps && x <= sx + src.sheetW * sc + eps && y <= sy + src.sheetH * sc + eps, 'band corner lies inside the sheet edge');
    }
    assert.equal(labels[1][1][0], 0, 'right label is rotated');
    assert.equal(Math.abs(labels[1][1][1]), 2.5);
    assert.equal(page.cmds.indexOf(labels[0]) < page.cmds.findIndex((c) => c[0] === 'W'), true, 'bands and labels precede clipped artwork');
    assert.equal(page.cmds[page.cmds.indexOf(labels[3]) - 1][0], 'S');
    let depth = 0;
    for (const cmd of page.cmds) {
      if (cmd[0] === 'q') depth++;
      if (cmd[0] === 'Q') depth--;
      if (cmd === labels[3] || cmd === labels[4]) assert.equal(depth, 1, 'dimensions only have their own save, outside the artwork clip');
    }
    const { s, ox, oy } = plan.pages[i]._geo.scale;
    assert.ok(labels[3][1][5] > oy + src.sheetH * s);
    assert.ok(labels[4][1][4] < ox);
    for (const [, matrix, label] of labels) {
      const [a, b, c, d, x, y] = matrix, width = textWidthEm(label);
      for (const [u, v] of [[0, 0], [width, 0], [0, 0.72], [width, 0.72]]) {
        assert.ok(x + a * u + c * v >= 0 && x + a * u + c * v <= page.w);
        assert.ok(y + b * u + d * v >= 0 && y + b * u + d * v <= page.h);
      }
    }
  }
});

test('TODO 202: off, sheet, tile and Part exports ignore annotations; missing grippers gives only dimensions', () => {
  for (const page of ['sheet', 'tile', 'check']) {
    const options = { ...opts, page, sheetSizeGripper: false };
    const unticked = planPdf(src, options), ticked = planPdf(src, { ...options, sheetSizeGripper: true });
    if (page !== 'check') assert.deepEqual(ticked.build(0).cmds, unticked.build(0).cmds);
    assert.equal(bands(unticked.build(0)).length, 0);
    assert.equal(texts(unticked.build(0)).some((c) => /Gripper|^1000 mm$|^700 mm$/.test(c[2])), false);
  }
  assert.equal(texts(planPdf({ ...src, part: true }, opts).build(0)).length, 0);
  assert.deepEqual(texts(planPdf({ ...src, grippers: undefined }, opts).build(0)).map((c) => c[2]), ['1000 mm', '700 mm']);
});

test('TODO 202: narrow labels sit outside near the ends; long labels shorten; registration crosses stay clear', () => {
  const narrow = { ...src, grippers: { gripTop: 1, gripRight: 2, gripBottom: 3, gripLeft: 4 } };
  const plan = planPdf(narrow, { ...opts, reg: true }), { s, ox: x, oy: y } = plan.pages[0]._geo.scale;
  const labels = texts(plan.build(0)).slice(0, 4);
  assert.ok(labels[0][1][5] > y + src.sheetH * s);
  assert.ok(labels[1][1][4] > x + src.sheetW * s);
  assert.ok(labels[2][1][5] < y);
  assert.ok(labels[3][1][4] < x);
  assert.equal(labels[3][1][0], 0, 'left label is rotated too');
  assert.ok(labels[0][1][4] < x + src.sheetW * s / 3, 'outside label avoids central dimension');
  const tiny = planPdf({ ...src, sheetW: 5, sheetH: 1000, grippers: { gripTop: 12 } }, opts);
  assert.equal(texts(tiny.build(0))[0][2], '12 mm');
  const marksRaw = addEntities(newDoc(4), line(100, 600, 900, 660));
  const withMarks = planPdf({ ...src, fl: flatten(marksRaw), grippers: { gripTop: 40 } }, { ...opts, reg: true, separate: false });
  const shifted = texts(withMarks.build(0))[0], fit = withMarks.pages[0]._geo.scale;
  const centre = shifted[1][4] + textWidthEm(shifted[2]) * 2.5 / 2;
  assert.ok(Math.abs(centre - (fit.ox + 500 * fit.s)) > 12 * fit.s + textWidthEm(shifted[2]) * 2.5 / 2, 'label moves along band clear of the registration cross');
});

// TODO 333: label gap dimensions on a check print, from the first grid's measured gaps
const gapSrc = (grid = {}, s = {}) => ({ ...src, sheetW: 1000, sheetH: 700, ...s, gaps: labelGaps(stepRepeat({ sheetW: 1000, sheetH: 700, partW: 100, partH: 100, gapX: 5, gapY: 5, fit: false, cols: 2, rows: 2, ...grid, ...s }), s.sheetH || 700) });
const gapOpts = { ...opts, sheetSizeGripper: false, labelGap: true, separate: false };
const gapTexts = (s, o = gapOpts) => texts(planPdf(s, o).build(0)).map((c) => c[2]);

test('TODO 333: a 2 x 2 grid at 5 mm gets two dimensions labelled 5; an extra gap of another size gets a third; off draws none', () => {
  const two = gapSrc();
  assert.deepEqual(two.gaps, [{ dir: 'x', from: 497.5, to: 502.5, at: 402.5, size: 5 }, { dir: 'y', from: 347.5, to: 352.5, at: 447.5, size: 5 }]);
  assert.deepEqual(gapTexts(two), ['5', '5']);
  const extra = gapSrc({ cols: 3, extraCols: [{ after: 2, mm: 7 }] });
  assert.deepEqual(extra.gaps.map((g) => [g.dir, g.size]), [['x', 5], ['x', 12], ['y', 5]]);
  assert.deepEqual(gapTexts(extra), ['5', '12', '5']);
  assert.deepEqual(gapTexts(extra, { ...gapOpts, labelGap: false }), [], 'flag off: no dimensions');
  assert.deepEqual(planPdf(extra, { ...gapOpts, labelGap: false }).build(0).cmds, planPdf({ ...extra, gaps: undefined }, gapOpts).build(0).cmds, 'off = no gap data');
  assert.deepEqual(gapTexts(extra, { ...gapOpts, page: 'sheet' }), [], 'check print only');
  assert.deepEqual(gapTexts({ ...extra, part: true }), [], 'a part page has no label gaps');
});

test('TODO 333: a gap of 0 is not drawn; one row or column draws only the other direction; the gap is the measured box distance', () => {
  assert.deepEqual(gapSrc({ gapX: 0, gapY: 0 }).gaps, []);
  assert.deepEqual(gapSrc({ gapX: 0 }).gaps.map((g) => g.dir), ['y']);
  assert.deepEqual(gapSrc({ rows: 1 }).gaps.map((g) => g.dir), ['x']);
  assert.deepEqual(gapSrc({ cols: 1 }).gaps.map((g) => g.dir), ['y']);
  assert.deepEqual(gapSrc({ cols: 3, extraCols: [{ after: 2, mm: 7 }, { after: 3, mm: 7 }] }).gaps.filter((g) => g.dir === 'x').map((g) => g.size), [5, 12], 'a repeated size has one dimension');
  const turned = gapSrc({ partW: 100, partH: 60, rotate: '90', cols: 2, rows: 2, gapX: 8, gapY: 3 });
  assert.deepEqual(turned.gaps.map((g) => g.size), [8, 3]);
});

test('TODO 333: the text sits above the line in a wide gap and beside it under 3 mm on the page', () => {
  const small = gapSrc({ gapX: 20, gapY: 20, partW: 30, partH: 30 }, { sheetW: 200, sheetH: 100 });
  const plan = planPdf(small, gapOpts), { s, ox, oy } = plan.pages[0]._geo.scale, t = texts(plan.build(0));
  assert.deepEqual(t.map((c) => c[2]), ['20', '20']);
  const [, m, label] = t[0], g = small.gaps[0], mid = ox + (g.from + g.to) / 2 * s, half = textWidthEm(label) * 2.5 / 2;
  assert.ok(Math.abs(m[4] + half - mid) < 1e-6, 'centred over the gap');
  assert.ok(m[5] > oy + g.at * s, 'above the line');
  const narrow = planPdf(gapSrc(), gapOpts), n = narrow.pages[0]._geo.scale, tn = texts(narrow.build(0))[0], gn = gapSrc().gaps[0];
  assert.ok(n.s * gn.size < 3);
  assert.ok(tn[1][4] >= n.ox + gn.to * n.s + 1, 'beside: right of the gap');
});
