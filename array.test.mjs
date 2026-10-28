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
