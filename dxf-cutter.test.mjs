// dxf-cutter.js — the cutter-safe copy: lines, arcs and polylines only.   node dxf-cutter.test.mjs
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const D = await import('./web/drawing.js');
const W = await import('./web/dxf-write.js');
const { cutterDoc } = await import('./web/dxf-cutter.js');
const LD = await import('./web/layoutdoc.js');
const { readFileSync } = await import('node:fs');

const docOf = (...ents) => { const d = W.newDoc(); W.addEntities(d, ents); return d; };
const types = (r) => r.doc.entities.map((e) => e.type);
const f = (e, code) => +e.r.v[e.r.c.indexOf(code)];
/** The vertices of an LWPOLYLINE entity. */
const verts = (e) => { const p = []; e.r.c.forEach((c, i) => { if (c === 10) p.push([+e.r.v[i], +e.r.v[i + 1]]); }); return p; };
const segDist = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, u = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
};
/** The largest distance from the true curve's points to the polyline. */
const deviation = (curve, steps, pts, closed) => {
  let worst = 0;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i <= steps; i++) {
    const p = curve(i / steps);
    let best = Infinity;
    for (let k = 0; k < n; k++) best = Math.min(best, segDist(p, pts[k], pts[(k + 1) % pts.length]));
    worst = Math.max(worst, best);
  }
  return worst;
};

test('a circle gives two arcs that together close the circle', () => {
  const r = cutterDoc(docOf(W.circle(10, 20, 5, { layer: 'Cut', aci: 1 })), 0.01);
  assert.deepEqual(types(r), ['ARC', 'ARC']);
  assert.deepEqual(r.doc.entities.map((e) => [f(e, 10), f(e, 20), f(e, 40), f(e, 50), f(e, 51) % 360]), [[10, 20, 5, 0, 180], [10, 20, 5, 180, 0]]);
  assert.equal(r.doc.entities[0].layer, 'Cut'); assert.equal(r.doc.entities[0].aci, 1);
  assert.equal(r.left, 0);
});

test('lines, arcs and polylines (bulges kept) come through as they are', () => {
  const r = cutterDoc(docOf(W.line(0, 0, 3, 4), W.arc(0, 0, 10, 30, 120), W.roundRect(0, 0, 40, 20, 5)), 0.01);
  assert.deepEqual(types(r), ['LINE', 'ARC', 'LWPOLYLINE']);
  assert.deepEqual([f(r.doc.entities[1], 50), f(r.doc.entities[1], 51)], [30, 120]);
  assert.equal(r.doc.entities[2].r.c.filter((c) => c === 42).length, 4, 'the four corner arcs stay bulges');
});

test('an ellipse is flattened to a polyline within the tolerance', () => {
  for (const tol of [0.01, 0.5]) {
    const a = 100, b = 40, r = cutterDoc(docOf(W.ellipse(5, 5, a, 0, b / a)), tol);
    assert.deepEqual(types(r), ['LWPOLYLINE']);
    const pts = verts(r.doc.entities[0]);
    assert.ok(deviation((u) => [5 + a * Math.cos(u * 2 * Math.PI), 5 + b * Math.sin(u * 2 * Math.PI)], 4000, pts, true) <= tol, 'within ' + tol);
    assert.ok(pts.length > 8);
  }
  const fine = verts(cutterDoc(docOf(W.ellipse(0, 0, 100, 0, 0.4)), 0.01).doc.entities[0]).length, coarse = verts(cutterDoc(docOf(W.ellipse(0, 0, 100, 0, 0.4)), 0.5).doc.entities[0]).length;
  assert.ok(fine > coarse, 'a smaller tolerance gives more vertices');
});

test('a spline is flattened to a polyline within the tolerance', () => {
  const cp = [[0, 0], [200, 400], [400, -300], [600, 500], [800, -200], [1000, 100]], knots = [0, 0, 0, 0, 1, 2, 3, 3, 3, 3];
  const spline = W.entity('SPLINE', [[70, 8], [71, 3], [72, knots.length], [73, cp.length], ...knots.map((k) => [40, k]), ...cp.flatMap((p) => [[10, p[0]], [20, p[1]], [30, 0]])]);
  for (const tol of [0.01, 0.2]) {
    const r = cutterDoc(docOf(spline), tol);
    assert.deepEqual(types(r), ['LWPOLYLINE']);
    assert.ok(deviation((u) => D.nurbsAt(cp, knots, 3, null, 3 * u), 6000, verts(r.doc.entities[0]), false) <= tol, 'within ' + tol);
  }
});

test('mm dialog tolerance converted to drawing units keeps an inch ellipse within mm tolerance', () => {
  const d = W.newDoc(1), factor = 25.4;
  W.addEntities(d, W.ellipse(0, 0, 4, 0, .4));
  for (const mm of [.01, .05]) {
    const back = D.readDxf(W.writeDxf(cutterDoc(d, mm / factor).doc));
    const pts = verts(back.entities[0]).map((p) => p.map((v) => v * factor));
    assert.ok(deviation((u) => [4 * factor * Math.cos(u * 2 * Math.PI), 1.6 * factor * Math.sin(u * 2 * Math.PI)], 4000, pts, true) <= mm);
    assert.equal(back.header.$INSUNITS, '1');
  }
});

test('a block reference is exploded, with its rotation, scale and mirror', () => {
  const d = W.newDoc();
  W.addBlock(d, 'B', [W.line(1, 0, 2, 0, { layer: '0' }), W.circle(0, 0, 1), W.arc(0, 0, 1, 0, 90), W.text(0, 0, 1, 'hi')]);
  W.addEntities(d, [W.insert('B', 10, 20, { rot: 90, sx: 2, sy: 2, layer: 'Parts' })]);
  const r = cutterDoc(d, 0.01);
  assert.deepEqual(types(r), ['LINE', 'ARC', 'ARC', 'ARC'], 'no INSERT is left');
  const [ln, c1, , ar] = r.doc.entities;
  assert.deepEqual([f(ln, 10), f(ln, 20), f(ln, 11), f(ln, 21)].map((x) => Math.round(x * 1e6) / 1e6), [10, 22, 10, 24]);
  assert.deepEqual([f(c1, 10), f(c1, 20), f(c1, 40)], [10, 20, 2]);
  assert.equal(ln.layer, 'Parts', 'layer 0 inside a block takes the insert\'s layer');
  assert.deepEqual([f(ar, 50), f(ar, 51)].map(Math.round), [90, 180], 'the quarter arc turned by 90°');
  assert.equal(r.left, 1, 'the block\'s text is left out and counted');
  assert.deepEqual(Object.keys(r.doc.blocks), []);

  const m = cutterDoc(Object.assign(W.newDoc(), { blocks: d.blocks, entities: [W.insert('B', 0, 0, { sx: -1 })] }), 0.01);
  assert.deepEqual([f(m.doc.entities[3], 50), f(m.doc.entities[3], 51)].map(Math.round), [90, 180], 'mirrored in X: the arc still runs anticlockwise');

  W.addBlock(d, 'Nested', [W.insert('B', 3, 4, { sx: -1 })]);
  const nested = cutterDoc({ ...d, entities: [W.insert('Nested', 10, 20, { sx: -1 })] }, .01);
  const [nline, , , narc] = nested.doc.entities;
  assert.deepEqual([f(nline, 10), f(nline, 20), f(nline, 11), f(nline, 21)], [8, 24, 9, 24], 'two mirrors restore line direction');
  assert.deepEqual([f(narc, 10), f(narc, 20), f(narc, 50), f(narc, 51)], [7, 24, 0, 90], 'nested mirrors restore arc sweep');
  assert.equal(nested.left, 1);

  W.addBlock(d, 'Bulge', [W.lwpoly([[1, 2, .5], [3, 4]], { width: 2 })]);
  const bulge = cutterDoc({ ...d, entities: [W.insert('Bulge', 10, 20, { sx: -1 })] }, .01).doc.entities[0];
  assert.deepEqual(verts(bulge), [[9, 22], [7, 24]]);
  assert.equal(f(bulge, 42), -.5, 'a mirrored polyline reverses the bulge');
  assert.equal(bulge.r.c.includes(43), false, 'cutter copy drops widths');
});

test('a block stretched out of round gives polylines within the tolerance', () => {
  const d = W.newDoc();
  W.addBlock(d, 'B', [W.circle(0, 0, 10)]);
  W.addEntities(d, [W.insert('B', 0, 0, { sx: 3, sy: 1 })]);
  const r = cutterDoc(d, 0.01);
  assert.deepEqual(types(r), ['LWPOLYLINE']);
  assert.ok(deviation((u) => [30 * Math.cos(u * 2 * Math.PI), 10 * Math.sin(u * 2 * Math.PI)], 4000, verts(r.doc.entities[0]), true) <= 0.01);
});

test('text, fills and dimensions are left out and counted; other things are counted apart', () => {
  const r = cutterDoc(docOf(W.line(0, 0, 1, 1), W.text(0, 0, 1, 'a'), W.mtext(0, 0, 1, 'b'), W.entity('HATCH', []), W.entity('SOLID', []), W.entity('DIMENSION', [[2, '*D1']]), W.point(1, 1),
    W.line(0, 0, 2, 2, { hidden: true })), 0.01);
  assert.deepEqual(types(r), ['LINE']);
  assert.equal(r.left, 5); assert.equal(r.other, 1);
});

test('a loose top-level ATTDEF is counted as left out; one inside a block stays quiet', () => {
  const d = docOf(W.line(0, 0, 1, 1), W.entity('ATTDEF', [[10, 0], [20, 0], [2, 'T'], [1, 'x']]));
  W.addBlock(d, 'B', [W.line(0, 0, 1, 0), W.entity('ATTDEF', [[10, 0], [20, 0], [2, 'T'], [1, 'x']])], [0, 0]);
  W.addEntities(d, [W.insert('B', 5, 5)]);
  const r = cutterDoc(d, 0.01);
  assert.equal(r.left, 1); assert.equal(r.other, 0);
});

test('the copy writes and reads back as LINE, ARC and LWPOLYLINE only', () => {
  const d = docOf(W.circle(0, 0, 3), W.ellipse(0, 0, 9, 0, 0.5), W.line(0, 0, 5, 5), W.text(0, 0, 1, 'x'), W.rect(0, 0, 4, 4));
  const back = D.readDxf(W.writeDxf(cutterDoc(d, 0.01).doc));
  assert.deepEqual([...new Set(back.entities.map((e) => e.type))].sort(), ['ARC', 'LINE', 'LWPOLYLINE']);
  assert.equal(W.unwritable(back).length, 0);
});

test('the tolerance must be a number above 0', () => {
  for (const bad of [0, -1, NaN, Infinity, undefined]) assert.throws(() => cutterDoc(docOf(), bad), RangeError);
});

test('TODO 184: a block holding 8 inserts of itself ends in a DrawingError, fast', () => {
  const d = W.newDoc(); W.addBlock(d, 'A', Array.from({ length: 8 }, () => W.insert('A', 0, 0)));
  d.entities = [W.insert('A', 0, 0)];
  const t0 = Date.now();
  assert.throws(() => cutterDoc(d, 0.01), D.DrawingError);
  assert.ok(Date.now() - t0 < 15000);
});

test('TODO 184: INSERT arrays nested 4 deep ending in an empty block end in a DrawingError, fast', () => {
  const d = W.newDoc(); W.addBlock(d, 'E', []);
  for (const [n, to] of [['A1', 'E'], ['A2', 'A1'], ['A3', 'A2'], ['A4', 'A3']]) W.addBlock(d, n, [W.insert(to, 0, 0, { cols: 100, rows: 100, dx: 1, dy: 1 })]);
  d.entities = [W.insert('A4', 0, 0, { cols: 100, rows: 100, dx: 1, dy: 1 })];
  const t0 = Date.now();
  assert.throws(() => cutterDoc(d, 0.01), D.DrawingError);
  assert.ok(Date.now() - t0 < 15000);
});

test('TODO 244: cutter export omits only the layout\'s own sheet rectangle and marks', async (t) => {
  // Exercise the app's actual preparation so the old layer-name filter fails the loose-line rows too.
  const app = readFileSync(new URL('./web/app.js', import.meta.url), 'utf8').split('function exportCutter() {')[1];
  const prepare = new Function('d', 'LD', 'cutterDoc', app.slice(app.indexOf('  const raw ='), app.indexOf('  const want =')) + 'return made.res;');
  const lay = LD.newLayout('Cutter');
  lay.s.crop = true; lay.s.reg = true;
  const part = docOf(W.line(0, 0, 9, 9, { layer: 'Sheet' }), W.rect(0, 0, 5, 5, { layer: 'Cut' }));
  lay.parts.p = LD.makePart('p', 'P', part, 1);
  lay.placed.push({ partId: 'p', x: 100, y: 100 });
  for (const layer of ['Marks', 'Sheet', '0']) {
    const id = 'loose' + layer, obj = LD.objectPart(id, id, W.line(30, 40, 50, 60, { layer }), LD.layersOf(lay));
    lay.parts[id] = obj; lay.placed.push(LD.objectPlacement(obj));
  }
  const loose = (layer) => (e) => e.type === 'LINE' && e.layer === layer && f(e, 10) === 30 && f(e, 20) === 40;
  const rows = [
    ['loose line on Marks kept', loose('Marks'), 1],
    ['loose line on Sheet kept', loose('Sheet'), 1],
    ['loose line on 0 kept', loose('0'), 1],
    ['layout\'s own sheet rectangle left out', (e) => e.type === 'LWPOLYLINE' && e.layer === 'Sheet', 0],
    ['layout\'s own marks left out', (e) => e.layer === 'Marks' && !loose('Marks')(e), 0],
    ['Sheet line inside placed block P kept', (e) => e.type === 'LINE' && e.layer === 'Sheet' && f(e, 10) === 100, 1],
  ];
  const saved = LD.layoutRaw(lay), result = prepare({ lay }, LD, cutterDoc);
  assert.ok(saved.blocks.P, 'the placed part is in block P');
  assert.ok(saved.entities.some(rows[3][1]) && saved.entities.some(rows[4][1]), 'ordinary layout output still has its sheet and marks');
  assert.equal(result.left, 0); assert.equal(result.other, 0);
  for (const [name, select, want] of rows) await t.test(name, () => {
    assert.equal(result.doc.entities.filter(select).length, want);
  });
  const drawing = docOf(W.rect(0, 0, 300, 200, { layer: 'Sheet' }), W.line(0, 5, 5, 5, { layer: 'Marks' }));
  assert.deepEqual(prepare({ raw: drawing, factor: 1 }, LD, cutterDoc), cutterDoc(drawing, .01), 'drawing export unchanged');
});
