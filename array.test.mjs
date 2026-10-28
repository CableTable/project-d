// array.js — the rectangular array's grid maths, typed words and copies.   node array.test.mjs
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const W = await import('./web/dxf-write.js');
const A = await import('./web/array.js');

const f = (e, c) => +e.r.v[e.r.c.indexOf(c)];

test('TODO 75 T1: defaults are 4 x 3 with 1.5 x the selection size; a box with no size falls back to 10 mm', () => {
  assert.deepEqual(A.rectDefaults([10, 20, 210, 80]), { cols: 4, rows: 3, dx: 300, dy: 90 });
  assert.deepEqual(A.rectDefaults(null), { cols: 4, rows: 3, dx: 10, dy: 10 });
  assert.equal(A.rectDefaults([5, 5, 5, 25]).dx, 10, 'a vertical line has no width');
});

test('TODO 75 T1: offsets: counts, spacings, the original is left out, negative spacing goes the other way', () => {
  const o = A.rectOffsets({ cols: 4, rows: 3, dx: 300, dy: 90 });
  assert.equal(o.length, 11, '4 x 3 = 12 objects, 11 copies');
  assert.deepEqual(o[0], [300, 0]); assert.deepEqual(o.at(-1), [900, 180]);
  assert.ok(!o.some(([x, y]) => !x && !y));
  assert.deepEqual(A.rectOffsets({ cols: 2, rows: 2, dx: -5, dy: 7 }).map((p) => p.map((v) => v + 0)), [[-5, 0], [0, 7], [-5, 7]]);       // + 0: no -0
  assert.deepEqual(A.rectOffsets({ cols: 1, rows: 1, dx: 5, dy: 5 }), [], '1 x 1 adds nothing');
  assert.deepEqual(A.rectOffsets({ cols: 3, rows: 1, dx: 10, dy: 0 }), [[10, 0], [20, 0]]);
});

test('TODO 75 T1: withField takes whole counts from 1, any spacing, and the most is capped', () => {
  const c = A.rectDefaults(null);
  assert.equal(A.withField(c, 'cols', 2).cfg.cols, 2);
  assert.equal(A.withField(c, 'dx', -12.5).cfg.dx, -12.5);
  for (const bad of [0, -1, 2.5, NaN]) assert.ok(A.withField(c, 'rows', bad).error, 'rows ' + bad);
  assert.ok(A.withField(c, 'dy', Infinity).error);
  assert.ok(A.withField({ ...c, rows: 100 }, 'cols', 101).error, 'over the cap');
  assert.equal(A.withField({ ...c, rows: 100 }, 'cols', 100).cfg.cols, 100);
});

test('TODO 75 T1: typed lines: option words with their numbers, keys COU / COL / R / S / E', () => {
  assert.deepEqual(A.parseLine('col 2 r 2'), [{ opt: 'columns', args: [2] }, { opt: 'rows', args: [2] }]);
  assert.deepEqual(A.parseLine('COU 5, 6'), [{ opt: 'count', args: [5, 6] }]);
  assert.deepEqual(A.parseLine('s 40 -25'), [{ opt: 'spacing', args: [40, -25] }]);
  assert.deepEqual(A.parseLine('count'), [{ opt: 'count', args: [] }]);
  assert.deepEqual(A.parseLine('x'), [{ opt: 'exit', args: [] }]);
  assert.deepEqual(A.parseLine('Rows 3'), [{ opt: 'rows', args: [3] }]);
  for (const no of ['', 'c', 'co', 'copy', '3', '3 rows', 'line']) assert.equal(A.parseLine(no), null, JSON.stringify(no));
  const cfg = A.rectDefaults([0, 0, 100, 50]);
  const r = A.applyLine(cfg, A.parseLine('col 2 r 2'));
  assert.deepEqual([r.cfg.cols, r.cfg.rows, r.exit, r.ask], [2, 2, false, []]);
  assert.deepEqual(A.applyLine(cfg, A.parseLine('s 40 -25')).cfg, { ...cfg, dx: 40, dy: -25 });
  assert.deepEqual(A.applyLine(cfg, A.parseLine('s 40')).cfg, { ...cfg, dx: 40 }, 'one number: columns only');
  assert.deepEqual(A.applyLine(cfg, A.parseLine('cou')).ask, ['cols', 'rows']);
  assert.deepEqual(A.applyLine(cfg, A.parseLine('s')).ask, ['dx', 'dy']);
  assert.equal(A.applyLine(cfg, A.parseLine('col r 2')).error, 'Columns needs a number');
  assert.ok(A.applyLine(cfg, A.parseLine('col 0')).error);
  assert.equal(A.applyLine(cfg, A.parseLine('r 2 x')).exit, true);
});

test('TODO 75 T1: arrayRect adds plain copies in order, keeps the originals, layer and colour, and scales the spacing by the factor', () => {
  const raw = W.newDoc(4);
  W.addEntities(raw, [W.line(0, 0, 10, 0, { layer: 'Cut', aci: 3, lt: 'DASHED' }), W.circle(5, 5, 2, { layer: 'Cut', aci: 3, lt: 'DASHED' })]);
  const before = structuredClone(raw.entities), sel = new Set([0, 1]);
  const next = A.arrayRect(raw, sel, { cols: 2, rows: 2, dx: 30, dy: 20 });
  assert.deepEqual(raw.entities, before, 'the input stays intact');
  assert.equal(next.entities.length, 2 + 2 * 3, '2 originals + 3 copies of each');
  assert.deepEqual(next.entities.slice(0, 2), before);
  const lines = next.entities.filter((e) => e.type === 'LINE');
  assert.deepEqual(lines.map((e) => [f(e, 10), f(e, 20)]), [[0, 0], [30, 0], [0, 20], [30, 20]]);
  assert.ok(next.entities.every((e) => e.layer === 'Cut' && e.aci === 3 && e.lt === 'DASHED'), 'layer, colour and line type are kept');
  // the drawing is in inches (factor 25.4): 30 mm is 30 / 25.4 units
  const inch = A.arrayRect(raw, new Set([0]), { cols: 2, rows: 1, dx: 25.4, dy: 0 }, 25.4);
  assert.equal(f(inch.entities[2], 10), 1);
  assert.throws(() => A.arrayRect(raw, sel, { cols: 0, rows: 2, dx: 1, dy: 1 }), /whole numbers/);
  assert.throws(() => A.arrayRect(raw, sel, { cols: 200, rows: 200, dx: 1, dy: 1 }), /whole numbers/);
  assert.throws(() => A.arrayRect(raw, sel, { cols: 2, rows: 2, dx: 1, dy: 1 }, 0), /scale/);
});

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('TODO 75 T2: polar defaults are 6 items, fill 360, Rotate items on', () => {
  assert.deepEqual(A.polarDefaults(), { items: 6, fill: 360, rotate: true });
});

test('TODO 75 T2: 360 spreads the items evenly with no overlap; a partial angle puts the first and last at its ends; negative = clockwise', () => {
  const degs = (cfg) => A.polarPlacements([0, 0], [0, 0], cfg).map((p) => p.deg);
  assert.deepEqual(degs({ items: 6, fill: 360, rotate: true }), [60, 120, 180, 240, 300], '360 stops short of the original');
  assert.deepEqual(degs({ items: 5, fill: 90, rotate: true }), [22.5, 45, 67.5, 90], 'the last one is at the fill angle');
  assert.deepEqual(degs({ items: 3, fill: -90, rotate: true }), [-45, -90], 'clockwise');
  assert.deepEqual(degs({ items: 4, fill: -360, rotate: true }), [-90, -180, -270]);
  assert.deepEqual(degs({ items: 1, fill: 360, rotate: true }), [], '1 item adds nothing');
  assert.deepEqual(degs({ items: 2, fill: 180, rotate: true }), [180]);
});

test('TODO 75 T2: Rotate items off keeps the orientation and carries the base point round the centre', () => {
  const p = A.polarPlacements([0, 0], [10, 0], { items: 4, fill: 360, rotate: false });
  assert.equal(p.length, 3);
  assert.ok(p.every((q) => q.deg === 0), 'no turning');
  [[-10, 10], [-20, 0], [-10, -10]].forEach(([dx, dy], k) => { near(p[k].dx, dx, 'dx ' + k); near(p[k].dy, dy, 'dy ' + k); });        // base (10,0) → (0,10), (-10,0), (0,-10)
  const q = A.polarPlacements([5, 5], [5, 5], { items: 3, fill: 360, rotate: false });
  assert.ok(q.every((r) => Math.abs(r.dx) < 1e-9 && Math.abs(r.dy) < 1e-9), 'a base on the centre does not move');
});

test('TODO 75 T2: withField takes items from 1, fill -360..360 but not 0, rotate as 1 / 0; yesNo', () => {
  const c = A.polarDefaults();
  assert.equal(A.withField(c, 'items', 8).cfg.items, 8);
  for (const bad of [0, 2.5, -3, 10001]) assert.ok(A.withField(c, 'items', bad).error, 'items ' + bad);
  assert.equal(A.withField(c, 'fill', -90).cfg.fill, -90);
  for (const bad of [0, 361, -400]) assert.ok(A.withField(c, 'fill', bad).error, 'fill ' + bad);
  assert.equal(A.withField(c, 'rotate', 0).cfg.rotate, false);
  assert.equal(A.withField({ ...c, rotate: false }, 'rotate', 1).cfg.rotate, true);
  assert.deepEqual(['y', 'Yes', 'n', ' NO ', 'x', ''].map(A.yesNo), [true, true, false, false, null, null]);
});

test('TODO 75 T2: polar typed lines: I, A / F, ROT with Yes / No, X', () => {
  assert.deepEqual(A.parseLine('i 8 a 180', 'polar'), [{ opt: 'items', args: [8] }, { opt: 'angle', args: [180] }]);
  assert.deepEqual(A.parseLine('f -90', 'polar'), [{ opt: 'fill', args: [-90] }]);
  assert.deepEqual(A.parseLine('rot n', 'polar'), [{ opt: 'rotate', args: [0] }]);
  assert.deepEqual(A.parseLine('rotate yes x', 'polar'), [{ opt: 'rotate', args: [1] }, { opt: 'exit', args: [] }]);
  assert.deepEqual(A.parseLine('rot', 'polar'), [{ opt: 'rotate', args: [] }]);
  for (const no of ['r', 'ro', 'n', 'y', 'cou', 'items n']) assert.equal(A.parseLine(no, 'polar'), null, no);
  assert.equal(A.parseLine('i 8'), null, 'Rectangular does not know Items');
  const c = A.polarDefaults();
  assert.deepEqual(A.applyLine(c, A.parseLine('i 8 a 180 rot n', 'polar')).cfg, { items: 8, fill: 180, rotate: false });
  assert.deepEqual(A.applyLine(c, A.parseLine('rot', 'polar')).ask, ['rotate']);
  assert.equal(A.applyLine(c, A.parseLine('rot i 3', 'polar')).error, 'Rotate needs Yes or No');
  assert.ok(A.applyLine(c, A.parseLine('a 0', 'polar')).error);
});

test('TODO 75 T2: arrayPolar adds plain copies turned about the centre (or moved, Rotate items off), keeps layer / colour / line type, leaves the input alone', () => {
  const raw = W.newDoc(4);
  W.addEntities(raw, [W.line(40, 0, 60, 0, { layer: 'Cut', aci: 3, lt: 'DASHED' })]);
  const before = structuredClone(raw.entities), sel = new Set([0]);
  const next = A.arrayPolar(raw, sel, [0, 0], [50, 0], { items: 4, fill: 360, rotate: true });
  assert.deepEqual(raw.entities, before);
  assert.equal(next.entities.length, 4);
  assert.deepEqual(next.entities[0], before[0]);
  const at = (e) => [10, 20, 11, 21].map((c) => f(e, c));
  [[0, 40, 0, 60], [-40, 0, -60, 0], [0, -40, 0, -60]].forEach((want, k) => at(next.entities[k + 1]).forEach((v, i) => near(v, want[i], `copy ${k + 1} field ${i}`)));
  assert.ok(next.entities.every((e) => e.layer === 'Cut' && e.aci === 3 && e.lt === 'DASHED'));
  const flat = A.arrayPolar(raw, sel, [0, 0], [50, 0], { items: 3, fill: 180, rotate: false });
  [[-50, 50], [-100, 0]].forEach(([dx, dy], k) => { near(f(flat.entities[k + 1], 10), 40 + dx, 'x'); near(f(flat.entities[k + 1], 20), dy, 'y'); near(f(flat.entities[k + 1], 11) - f(flat.entities[k + 1], 10), 20, 'still horizontal'); });
  assert.throws(() => A.arrayPolar(raw, sel, [NaN, 0], [0, 0], A.polarDefaults()), /centre/);
  assert.throws(() => A.arrayPolar(raw, sel, [0, 0], [0, 0], { items: 0, fill: 360, rotate: true }), /items/);
  assert.throws(() => A.arrayPolar(raw, sel, [0, 0], [0, 0], { items: 3, fill: 0, rotate: true }), /angle/);
});
