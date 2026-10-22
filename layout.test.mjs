// layout.js — step and repeat.   node layout.test.mjs
import assert from 'node:assert/strict';
import { stepRepeat, usableArea, presetFor, markGeometry, PRESETS } from './web/layout.js';

const base = { sheetW: 1000, sheetH: 700, gripTop: 10, gripRight: 10, gripBottom: 30, gripLeft: 10, partW: 120, partH: 80, gapX: 5, gapY: 5, rotate: '0', align: 'centre' };
const near = (a, b, t = 1e-9) => assert.ok(Math.abs(a - b) <= t, a + ' != ' + b);
let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }

test('mock-up case: 1000x700, 0 deg, 7 x 7 = 49, 67%, centred at 65,45', () => {
  const r = stepRepeat(base);
  assert.equal(r.cols, 7); assert.equal(r.rows, 7); assert.equal(r.count, 49);
  assert.equal(Math.round(r.usedPct), 67); assert.equal(r.rotated, false);
  near(r.x0, 65); near(r.y0, 45);
  assert.equal(r.positions.length, 49);
  assert.deepEqual(r.positions[0], { x: 65, y: 45 });
  assert.deepEqual(r.positions[1], { x: 190, y: 45 });
  assert.deepEqual(r.positions[7], { x: 65, y: 130 });
});

test('best fit on the mock-up case finds 55 turned (11 x 5), more than the mock-up\'s 49', () => {
  const r = stepRepeat({ ...base, rotate: 'best' });
  assert.equal(r.rotated, true); assert.equal(r.cols, 11); assert.equal(r.rows, 5); assert.equal(r.count, 55);
});

test('rotation: best picks the higher count, ties keep 0 degrees', () => {
  const o = { ...base, rotate: 'best', sheetW: 500, sheetH: 300, gripTop: 0, gripRight: 0, gripBottom: 0, gripLeft: 0, partW: 100, partH: 30, gapX: 0, gapY: 0 };
  assert.equal(stepRepeat({ ...o, rotate: '0' }).count, 5 * 10);
  const tall = { ...o, sheetW: 300, sheetH: 500 };
  const best = stepRepeat(tall);
  assert.equal(best.rotated, true); assert.equal(best.count, 50);
  assert.equal(best.partW, 30); assert.equal(best.partH, 100);
  const same = stepRepeat({ ...o, partW: 50, partH: 50 });
  assert.equal(same.rotated, false);
});

test('rotate 0 and 90 are forced', () => {
  assert.equal(stepRepeat({ ...base, rotate: '90' }).rotated, true);
  const r = stepRepeat({ ...base, rotate: '0' });
  assert.equal(r.rotated, false); assert.equal(r.partW, 120);
  const r90 = stepRepeat({ ...base, rotate: '90' });
  assert.equal(r90.partW, 80); assert.equal(r90.partH, 120);
  assert.equal(r90.cols * r90.rows, r90.count);
});

test('part bigger than the sheet gives 0', () => {
  const r = stepRepeat({ ...base, partW: 2000, partH: 2000 });
  assert.equal(r.count, 0); assert.equal(r.positions.length, 0); assert.equal(r.usedPct, 0);
  assert.equal(stepRepeat({ ...base, partW: 990, partH: 10, rotate: '0' }).count, 0); // 980 usable
  assert.equal(stepRepeat({ ...base, partW: 0, partH: 10 }).count, 0);
});

test('gripper per side: each side keeps clear by its own gripper, no margin', () => {
  assert.deepEqual(usableArea(base), { x: 10, y: 10, w: 980, h: 660 });
  const only = (k, v) => usableArea({ sheetW: 1000, sheetH: 700, [k]: v });
  assert.deepEqual(only('gripTop', 30), { x: 0, y: 30, w: 1000, h: 670 });
  assert.deepEqual(only('gripBottom', 30), { x: 0, y: 0, w: 1000, h: 670 });
  assert.deepEqual(only('gripLeft', 30), { x: 30, y: 0, w: 970, h: 700 });
  assert.deepEqual(only('gripRight', 30), { x: 0, y: 0, w: 970, h: 700 });
  assert.deepEqual(usableArea({ sheetW: 1000, sheetH: 700, gripTop: 5, gripRight: 6, gripBottom: 7, gripLeft: 8 }), { x: 8, y: 5, w: 986, h: 688 });
  assert.deepEqual(usableArea({ sheetW: 1000, sheetH: 700 }), { x: 0, y: 0, w: 1000, h: 700 }, 'none set: the whole sheet');
  assert.equal(usableArea({ ...base, gripBottom: -5 }).h, 690, 'negative counts as none');
  const t = stepRepeat({ ...base, gripTop: 30, gripBottom: 10 });
  near(t.y0, 30 + (660 - 590) / 2);
  const all = stepRepeat({ ...base, gripTop: 30, gripLeft: 30, gripRight: 30, gripBottom: 30, rotate: '0' });
  assert.deepEqual(all.area, { x: 30, y: 30, w: 940, h: 640 });
  assert.ok(all.positions.every((p) => p.x >= 30 && p.y >= 30 && p.x + 120 <= 970 && p.y + 80 <= 670));
});

test('zero gaps', () => {
  const r = stepRepeat({ ...base, gapX: 0, gapY: 0, rotate: '0' });
  assert.equal(r.cols, 8); assert.equal(r.rows, 8); assert.equal(r.count, 64); // 980/120, 660/80
  assert.equal(r.gridW, 960);
  near(r.positions[1].x - r.positions[0].x, 120);
  assert.equal(stepRepeat({ ...base, gapX: -5, gapY: -5, rotate: '0' }).count, 64); // negative gaps are clamped
});

test('centre vs top-left origins', () => {
  const c = stepRepeat(base);
  const t = stepRepeat({ ...base, align: 'topleft' });
  near(t.x0, 10); near(t.y0, 10);
  assert.equal(t.count, c.count);
  near(c.x0 - t.x0, (980 - 870) / 2); near(c.y0 - t.y0, (660 - 590) / 2);
  // a single part, centred in the usable area
  const one = stepRepeat({ ...base, partW: 600, partH: 400, rotate: '0' });
  assert.equal(one.count, 1); near(one.x0, 10 + (980 - 600) / 2); near(one.y0, 10 + (660 - 400) / 2);
});

test('presets', () => {
  assert.equal(presetFor(1000, 700), 'screen');
  assert.equal(presetFor(297, 210), 'a4');
  assert.equal(presetFor(123, 456), 'custom');
  assert.ok(PRESETS.some((p) => p.id === 'custom'));
});

// ---- extra gaps (rows counted from the top, columns from the left; "after 3" = between 3 and 4)
const e0 = { ...base, rotate: '0', align: 'topleft' };      // 980 × 660 usable: 7 × 7 at gap 5
test('extra gap after a row: the rows below shift down by it, the grid grows by it', () => {
  const a = stepRepeat(e0), b = stepRepeat({ ...e0, extraRows: [{ after: 3, mm: 10 }] });
  assert.equal(b.count, 49);
  near(b.gridH, a.gridH + 10);
  for (let r = 0; r < 7; r++) near(b.positions[r * 7].y - a.positions[r * 7].y, r >= 3 ? 10 : 0);
  assert.deepEqual(b.rowGaps[2], { after: 3, at: a.positions[14].y + 80, size: 15 });
  assert.equal(b.rowGaps.length, 6); assert.equal(b.colGaps.length, 6);
  assert.deepEqual(b.positions.map((p) => p.x), a.positions.map((p) => p.x), 'columns do not move');
});
test('extra gap after a column shifts the columns to its right', () => {
  const a = stepRepeat(e0), b = stepRepeat({ ...e0, extraCols: [{ after: 2, mm: 5 }, { after: 4, mm: 7 }] });
  assert.equal(b.count, 49);
  [0, 0, 5, 5, 12, 12, 12].forEach((d, c) => near(b.positions[c].x - a.positions[c].x, d));
  near(b.gridW, a.gridW + 12);
});
test('a row or column that no longer fits is dropped, and the count follows', () => {
  // 660 usable high: 7 rows take 590; an extra 80 makes it 670, so the last row goes
  const r = stepRepeat({ ...e0, extraRows: [{ after: 1, mm: 80 }] });
  assert.equal(r.rows, 6); assert.equal(r.count, 42);
  assert.ok(r.positions.every((p) => p.y + 80 <= 10 + 660 + 1e-9));
  const c = stepRepeat({ ...e0, extraCols: [{ after: 1, mm: 120 }] });
  assert.equal(c.cols, 6); assert.equal(c.count, 42);
  // it fits exactly: the 7th row stays
  assert.equal(stepRepeat({ ...e0, extraRows: [{ after: 1, mm: 70 }] }).rows, 7);
  assert.equal(stepRepeat({ ...e0, extraRows: [{ after: 1, mm: 70.5 }] }).rows, 6);
  // a gap after a row that is dropped is ignored; the base counts say where gaps can be
  const d = stepRepeat({ ...e0, extraRows: [{ after: 6, mm: 200 }] });
  assert.equal(d.rows, 6); assert.equal(d.baseRows, 7);
  assert.equal(stepRepeat({ ...e0, extraRows: [{ after: 9, mm: 50 }] }).count, 49, 'beyond the last row: nothing');
});
test('extras: bad entries are ignored, both axes together, none = as before', () => {
  const a = stepRepeat(e0);
  assert.deepEqual(stepRepeat({ ...e0, extraRows: [{ after: 0, mm: 5 }, { after: 2, mm: 0 }, { after: 2, mm: -4 }, null] }).positions, a.positions);
  const b = stepRepeat({ ...e0, extraRows: [{ after: 1, mm: 10 }], extraCols: [{ after: 1, mm: 10 }] });
  near(b.positions[8].x - a.positions[8].x, 10); near(b.positions[8].y - a.positions[8].y, 10);
  assert.equal(b.baseCols, 7);
});
test('extras with align centre: the grown grid is centred', () => {
  const a = stepRepeat({ ...e0, align: 'centre' }), b = stepRepeat({ ...e0, align: 'centre', extraRows: [{ after: 3, mm: 20 }], extraCols: [{ after: 3, mm: 10 }] });
  near(b.x0, a.x0 - 5); near(b.y0, a.y0 - 10);
  near(b.x0 + b.gridW / 2, 10 + 980 / 2); near(b.y0 + b.gridH / 2, 10 + 660 / 2);
});
test('extras with a rotated part: rows and columns are the sheet\'s, the part is turned', () => {
  const o = { ...e0, rotate: '90' };                       // 80 wide × 120 high copies
  const a = stepRepeat(o), b = stepRepeat({ ...o, extraRows: [{ after: 2, mm: 10 }], extraCols: [{ after: 1, mm: 3 }] });
  assert.equal(b.rotated, true); assert.equal(b.partW, 80);
  assert.equal(b.count, a.count);
  near(b.positions[b.cols * 2].y - a.positions[a.cols * 2].y, 10);
  near(b.positions[1].x - a.positions[1].x, 3);
  assert.equal(b.baseRows, a.rows);
  // 'best' compares with the extras in: a big extra can make the other orientation win
  const best = stepRepeat({ ...base, rotate: 'best', extraCols: [{ after: 1, mm: 140 }] });
  assert.ok(best.count > 0);
  assert.ok(best.positions.every((p) => p.x >= 10 - 1e-9 && p.x + best.partW <= 990 + 1e-9));
});
test('marks follow the grown grid', () => {
  const a = stepRepeat(e0), b = stepRepeat({ ...e0, extraCols: [{ after: 3, mm: 20 }] });
  near(markGeometry(b).crop[2][0] - markGeometry(a).crop[2][0], 20);
});

test('Fit off: rows and columns typed by hand; the grid may not fit and says so', () => {
  const r = stepRepeat({ ...base, fit: false, rows: 4, cols: 2 });
  assert.equal(r.rows, 4); assert.equal(r.cols, 2); assert.equal(r.count, 8); assert.equal(r.manual, true); assert.equal(r.fits, true);
  assert.equal(r.positions.length, 8);
  near(r.gridW, 2 * 120 + 5); near(r.gridH, 4 * 80 + 3 * 5);
  near(r.x0, 10 + (980 - r.gridW) / 2);                                       // centred on the usable area
  const big = stepRepeat({ ...base, fit: false, rows: 20, cols: 20 });        // 20 x 20 does not fit 1000 x 700
  assert.equal(big.count, 400); assert.equal(big.fits, false); assert.ok(big.gridW > big.area.w);
  const worked = stepRepeat(base); assert.equal(worked.manual, false); assert.equal(worked.fits, true);
  // extra gaps up to the typed count still apply; 'best' means 0 degrees by hand; rotate 90 swaps the footprint
  const e = stepRepeat({ ...base, fit: false, rows: 3, cols: 1, extraRows: [{ after: 2, mm: 10 }] });
  near(e.positions[2].y - e.positions[1].y, 80 + 5 + 10);
  assert.equal(stepRepeat({ ...base, fit: false, rows: 1, cols: 1, rotate: 'best' }).rotated, false);
  assert.equal(stepRepeat({ ...base, fit: false, rows: 1, cols: 1, rotate: '90' }).partW, 80);
  assert.equal(stepRepeat({ ...base, fit: false, rows: 0, cols: 'x' }).count, 1);   // at least 1 by 1
  assert.equal(stepRepeat({ ...base, partW: 0, partH: 0, fit: false, rows: 3, cols: 3 }).count, 0);   // no part yet
});


test('Fit skips overlapping occupied boxes once per cell, permits touching, and keeps manual counts', () => {
  const o = { sheetW: 40, sheetH: 20, partW: 10, partH: 20, gapX: 0, gapY: 0, rotate: '0', align: 'topleft' };
  const occupied = [[0, 0, 10, 20], [0, 0, 10, 20], [19, 5, 21, 6]];
  const r = stepRepeat({ ...o, occupied });
  assert.deepEqual(r.positions, [{ x: 30, y: 0 }]);
  assert.equal(r.skipped, 3); assert.equal(r.count, 1); assert.equal(r.usedPct, 25);
  assert.equal(stepRepeat({ ...o, occupied: [[0, 0, 40, 20]] }).count, 0);
  const manual = stepRepeat({ ...o, occupied, fit: false, rows: 1, cols: 4 });
  assert.equal(manual.count, 4); assert.equal(manual.skipped, 0);
  const turned = stepRepeat({ ...o, partW: 20, partH: 10, rotate: '90', occupied });
  assert.deepEqual(turned.positions, r.positions);
});

console.log(n + ' tests passed');
