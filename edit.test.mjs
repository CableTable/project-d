// edit.js — picking by chain, box, delete / keep only, scaling every entity type, undo.   node edit.test.mjs
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const fs = await import('node:fs');
const D = await import('./web/drawing.js');
const W = await import('./web/dxf-write.js');
const E = await import('./web/edit.js');
const { ink } = await import('./web/render.js');
const { unitFactor, drawingBoxMm } = await import('./web/doc.js');

const load = (f) => { const raw = D.readDxf(D.decodeDxf(fs.readFileSync('fixtures/' + f))); return { raw, fl: D.flatten(raw) }; };
const near = (a, b, m, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * (1 + Math.abs(b)), `${m || ''} ${a} !~ ${b}`);
const types = (raw, list) => list.map((i) => raw.entities[i].type);
const asc = (a) => [...a].sort((x, y) => x - y);

test('flatten tells each item its entity (a block\'s contents: the INSERT)', () => {
  const { raw, fl } = load('outline.dxf');
  const ins = raw.entities.findIndex((e) => e.type === 'INSERT');
  const fromIns = fl.items.filter((it) => it.e === ins);
  assert.equal(fromIns.length, 2, 'the block\'s line and circle');
  assert.deepEqual(asc(new Set(fl.items.map((it) => it.e))), [...Array(raw.entities.length).keys()]);
});

test('chain tolerance: 0.01 mm, more on a big drawing, in drawing units', () => {
  near(E.chainTol([0, 0, 100, 60], 1), 0.01, 'small');
  near(E.chainTol([0, 0, 1000, 700], 1), 1220.6 * 1e-5, 'big', 1e-3);
  near(E.chainTol([0, 0, 1, 1], 25.4), 0.01 / 25.4, 'inch file');
  assert.ok(E.chainTol([0, 0, 1e7, 1e7], 1) <= 0.1, 'capped');
  assert.ok(E.chainTol(null, 1) > 0);
});

test('one click on the outline: the whole loop, and nothing inside or crossing it', () => {
  const { raw, fl } = load('outline.dxf');
  const ed = E.makeIndex(raw, fl), tol = E.chainTol(fl.boxes.model, 1);
  const e = E.hitEntity(ed, 50, 0.1, 1);
  assert.equal(raw.entities[e].type, 'LINE');
  const chain = E.chainAt(ed, e, tol);
  assert.deepEqual(asc(chain), [0, 1, 2, 3, 4, 5, 6, 7]);
  // from an arc, the same loop
  assert.deepEqual(asc(E.chainAt(ed, 5, tol)), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('the small gaps (0.004, 0.006) join under the tolerance and not under a tighter one', () => {
  const { raw, fl } = load('outline.dxf');
  const ed = E.makeIndex(raw, fl);
  assert.equal(E.chainAt(ed, 0, 0.01).length, 8);
  const tight = E.chainAt(ed, 0, 0.001);
  assert.ok(tight.length < 8 && tight.includes(0), 'the ring is broken in two places: ' + tight);
  assert.equal(E.chainAt(ed, 0, 0.0065).length, 8, 'a gap of 0.006 joins at 0.0065');
});

test('a click on a shape inside selects just that shape; one on the leader selects the leader; a block is one thing', () => {
  const { raw, fl } = load('outline.dxf');
  const ed = E.makeIndex(raw, fl), tol = 0.5, ctol = 0.01;
  const circ = E.hitEntity(ed, 38, 30, tol);
  assert.equal(raw.entities[circ].type, 'CIRCLE');
  assert.deepEqual(E.chainAt(ed, circ, ctol), [circ]);
  const lead = E.hitEntity(ed, -10, 30.1, tol);
  assert.equal(raw.entities[lead].type, 'LINE');
  assert.deepEqual(E.chainAt(ed, lead, ctol), [lead], 'it crosses the outline and touches no end');
  const bl = E.hitEntity(ed, 113, 10.1, tol);                       // the block's line
  assert.equal(raw.entities[bl].type, 'INSERT');
  assert.deepEqual(E.chainAt(ed, bl, ctol), [bl]);
  const solid = E.hitEntity(ed, 46, 39, tol);                       // inside the filled arrow
  assert.equal(raw.entities[solid].type, 'SOLID');
  const poly = E.hitEntity(ed, 15, 9, tol);                         // the exploded text
  assert.equal(raw.entities[poly].type, 'POLYLINE');
  assert.equal(E.hitEntity(ed, 60, 52, 0.5), -1, 'empty space');
});

test('hit-testing skips layers that are switched off', () => {
  const { raw, fl } = load('outline.dxf');
  const ed = E.makeIndex(raw, fl, new Set([0]));                    // the only layer
  assert.equal(E.hitEntity(ed, 50, 0, 1), -1);
  assert.deepEqual(E.inBox(ed, [-100, -100, 200, 200]), []);
});

test('a box selects what lies fully inside it', () => {
  const { raw, fl } = load('outline.dxf');
  const ed = E.makeIndex(raw, fl);
  const all = E.inBox(ed, [-1, -1, 101, 61]);
  assert.deepEqual(types(raw, asc(all)), ['LINE', 'ARC', 'LINE', 'ARC', 'LINE', 'ARC', 'LINE', 'ARC', 'CIRCLE', 'LWPOLYLINE', 'POLYLINE', 'SOLID', 'ELLIPSE']);
  assert.deepEqual(E.inBox(ed, [100, 60, -1, -1]).length, 13, 'corners in any order');
  assert.deepEqual(types(raw, E.inBox(ed, [20, 10, 90, 50])), ['CIRCLE', 'LWPOLYLINE', 'SOLID', 'ELLIPSE']);
  assert.ok(E.inBox(ed, [-30, 25, 60, 35]).some((i) => raw.entities[i].type === 'LINE'), 'the leader is fully inside this one');
});

test('end snapping finds an end of an open shape, not the middle', () => {
  const { raw, fl } = load('outline.dxf');
  const ed = E.makeIndex(raw, fl);
  const s = E.snapEnd(ed, 100.2, 10.1, 1);
  near(s.x, 100, 'x'); near(s.y, 10, 'y');
  assert.equal(E.snapEnd(ed, 50, 0.3, 0.5), null, 'the middle of the bottom line is no end');
  const c = E.snapEnd(ed, 30.2, 30.1, 1);
  near(c.x, 30); near(c.y, 30);                                      // a circle's centre
});

test('Keep only: the outline stays, the rest and the block it no longer uses are gone', () => {
  const { raw, fl } = load('outline.dxf');
  const ed = E.makeIndex(raw, fl);
  const next = E.keepOnly(raw, new Set(E.chainAt(ed, 0, 0.01)));
  assert.equal(next.entities.length, 8);
  assert.ok(next.entities.every((e) => e.type === 'LINE' || e.type === 'ARC'));
  assert.equal(next.blocks.MARK, undefined);
  assert.ok(raw.blocks.MARK, 'the original is not touched');
  assert.equal(raw.entities.length, 15);
  // what is left draws as the plate: 100 x 60
  const kept = { ...raw, entities: next.entities, blocks: next.blocks }, box = D.flatten(kept).boxes.model;
  assert.deepEqual(box.map((v) => Math.round(v * 100) / 100), [0, 0, 100, 60]);
});

test('Delete: the selection goes, and a block is kept while something still uses it', () => {
  const { raw } = load('outline.dxf');
  const ins = raw.entities.findIndex((e) => e.type === 'INSERT');
  const a = E.removeEntities(raw, new Set([0, 1]));
  assert.equal(a.entities.length, 13); assert.ok(a.blocks.MARK);
  const b = E.removeEntities(raw, new Set([ins]));
  assert.equal(b.entities.length, 14); assert.equal(b.blocks.MARK, undefined);
  const twice = { ...raw, entities: [...raw.entities, raw.entities[ins]] };
  assert.ok(E.removeEntities(twice, new Set([ins])).blocks.MARK, 'a second INSERT still uses it');
});

test('what is left saves and reads back (LINE, ARC, ELLIPSE, SOLID, old POLYLINE all writable)', () => {
  const { raw, fl } = load('outline.dxf');
  assert.deepEqual(W.unwritable(raw), []);
  const ed = E.makeIndex(raw, fl);
  const keep = new Set([...E.chainAt(ed, 0, 0.01), ...E.inBox(ed, [20, 10, 90, 50]), raw.entities.findIndex((e) => e.type === 'POLYLINE')]);
  const next = E.keepOnly(raw, keep);
  const doc = { ...raw, entities: next.entities, blocks: next.blocks };
  const back = D.readDxf(W.writeDxf(doc));
  assert.deepEqual(back.entities.map((e) => e.type), doc.entities.map((e) => e.type));
  assert.equal(back.entities.find((e) => e.type === 'POLYLINE').kids.length, 4);
  assert.equal(back.header.$INSUNITS, '0', 'still unitless');
});

// ---------------------------------------------------------------- scale

const boxOf = (doc) => D.flatten(doc).boxes.model;
const lineBox = (doc) => { const fl = D.flatten(doc); return fl.items.filter((it) => it.k === 'p').reduce((a, it) => D.unionBox(a, it.b), null); };

test('scale: every entity type of the outline fixture, uniformly about the bottom-left of its box', () => {
  const { raw, fl } = load('outline.dxf');
  const b = fl.boxes.model, s = 2.5;
  const r = E.scaleAbout(raw, s, b[0], b[1]);
  assert.deepEqual(r.skipped, {});
  const doc = { ...raw, entities: r.entities, blocks: r.blocks }, nb = boxOf(doc);
  nb.forEach((v, i) => near(v, [b[0], b[1], b[0] + (b[2] - b[0]) * s, b[1] + (b[3] - b[1]) * s][i], 'box ' + i, 1e-9));
  // the original is untouched
  assert.deepEqual(boxOf(raw), b);
  // a few entities by hand
  const f = (e, c) => +e.r.v[e.r.c.indexOf(c)];
  const arc = r.entities[1];
  near(f(arc, 40), 25, 'arc radius'); near(f(arc, 10), b[0] + (90 - b[0]) * s, 'arc centre x'); near(f(arc, 20), b[1] + (10 - b[1]) * s, 'arc centre y');
  near(f(arc, 50), 270, 'angles stay'); near(f(arc, 51), 360);
  const ell = r.entities.find((e) => e.type === 'ELLIPSE');
  near(f(ell, 11), 15, 'ellipse axis is a vector'); near(f(ell, 40), 0.5, 'ratio stays');
  const lw = r.entities.find((e) => e.type === 'LWPOLYLINE');
  near(f(lw, 10), b[0] + (50 - b[0]) * s);
  const ins = r.entities.find((e) => e.type === 'INSERT');
  assert.equal(ins.r.v[ins.r.c.indexOf(41)], '2.5', 'an insert without a scale gets one');
  near(f(ins, 10), b[0] + (110 - b[0]) * s, 'insert point');
  const pl = r.entities.find((e) => e.type === 'POLYLINE');
  near(+pl.kids[2].v[pl.kids[2].c.indexOf(42)], 0.4, 'bulge stays'); near(+pl.kids[0].v[pl.kids[0].c.indexOf(10)], b[0] + (15 - b[0]) * s, 'vertex x');
});

test('scale: text and widths, insert factors and arrays, a spline, a hatch, a mirrored entity', () => {
  const doc = W.newDoc(4);
  doc.layers.A = doc.layers['0'];
  W.addBlock(doc, 'B', [W.line(0, 0, 10, 0)]);
  const ents = [
    W.text(10, 10, 3, 'HELLO'), W.mtext(20, 20, 4, 'WORLD'),
    W.insert('B', 30, 30, { sx: 2, sy: -3, rot: 30, cols: 2, rows: 2, dx: 15, dy: 12 }),
    W.lwpoly([[0, 0], [10, 0, 0.5], [10, 10]], { width: 0.4 }),
    W.entity('SPLINE', [[70, 8], [71, 3], [72, 8], [73, 4], [40, 0], [40, 0], [40, 0], [40, 0], [40, 1], [40, 1], [40, 1], [40, 1], [10, 0], [20, 0], [30, 0], [10, 5], [20, 10], [30, 0], [10, 10], [20, 10], [30, 0], [10, 15], [20, 0], [30, 0]]),
    W.entity('HATCH', [[10, 0], [20, 0], [30, 0], [210, 0], [220, 0], [230, 1], [2, 'ANSI31'], [70, 0], [71, 0], [91, 1], [92, 7], [72, 0], [73, 1], [93, 3],
      [10, 0], [20, 0], [10, 20], [20, 0], [10, 20], [20, 20], [97, 0], [75, 0], [76, 1], [52, 0], [41, 1], [77, 0], [78, 1], [53, 45], [43, 0], [44, 0], [45, 0], [46, 2.5], [79, 0], [47, 0.1], [98, 1], [10, 15], [20, 5]]),
    W.entity('CIRCLE', [[10, 5], [20, 5], [30, 0], [40, 2], [210, 0], [220, 0], [230, -1]])
  ];
  ents[6].flip = true;
  ents[0].r.c.push(41); ents[0].r.v.push('1.5');
  W.addEntities(doc, ents);
  const r = E.scaleAbout(doc, 2, 10, 10);
  const f = (e, c, nth = 0) => { let k = -1; for (let i = 0; i < e.r.c.length; i++) if (e.r.c[i] === c && nth-- === 0) { k = i; break; } return +e.r.v[k]; };
  const [t, m, ins, lw, sp, ha, ci] = r.entities;
  near(f(t, 40), 6, 'text height'); near(f(t, 10), 10, 'text point stays on the anchor'); near(f(t, 41), 1.5, 'width factor is not a length');
  near(f(m, 40), 8); near(f(m, 10), 30);
  near(f(ins, 41), 4); near(f(ins, 42), -6, 'sign kept'); near(f(ins, 44), 30, 'array spacing'); near(f(ins, 45), 24); near(f(ins, 50), 30, 'rotation'); near(f(ins, 10), 50);
  near(f(lw, 43), 0.8, 'polyline width'); near(f(lw, 42), 0.5, 'bulge');
  near(f(sp, 40, 4), 1, 'knots stay'); near(f(sp, 10, 1), 0, 'control point'); near(f(sp, 20, 1), 10);
  near(f(ha, 10, 1), -10, 'boundary vertex');
  near(f(ha, 41), 2, 'pattern scale'); near(f(ha, 46), 5, 'pattern offset'); near(f(ha, 47), 0.2); near(f(ha, 10, 4), 20, 'seed point');
  near(f(ci, 40), 4, 'radius'); near(f(ci, 10), 20, 'mirrored: the anchor is -x in its own coordinates');
  assert.equal(r.skipped.MLEADER, undefined);
});

test('scale: a dimension scales its block with it; what has no scaling is counted, not hidden', () => {
  const doc = W.newDoc(4);
  W.addBlock(doc, '*D1', [W.line(0, 0, 10, 0), W.text(5, 1, 2, '10')]);
  W.addEntities(doc, [W.entity('DIMENSION', [[2, '*D1'], [10, 5], [20, 5], [11, 5], [21, 1], [70, 0], [13, 0], [23, 0], [14, 10], [24, 0], [42, 10]]),
    W.entity('MLEADER', [[10, 1], [20, 1]]), W.line(0, 0, 10, 0)]);
  const r = E.scaleAbout(doc, 3, 0, 0);
  assert.deepEqual(r.skipped, { MLEADER: 1 });
  assert.equal(r.blocks['*D1'].entities[0].r.v[r.blocks['*D1'].entities[0].r.c.indexOf(11)], '30');
  assert.equal(doc.blocks['*D1'].entities[0].r.v[doc.blocks['*D1'].entities[0].r.c.indexOf(11)], '10', 'the original block is untouched');
  assert.equal(r.entities[0].r.v[r.entities[0].r.c.indexOf(42)], '30', 'measurement');
});

test('scale: the real fixtures scale to the box a scale of the box predicts', () => {
  for (const name of ['sample.dxf', 'overlay.dxf', 'many-layers.dxf', 'inch.dxf']) {
    const { raw, fl } = load(name);
    const b = fl.boxes.model || fl.boxes.paper;
    if (!b) continue;
    const space = fl.boxes.model ? 0 : 1, s = 1.7;
    const r = E.scaleAbout(raw, s, b[0], b[1], space);
    const doc = { ...raw, entities: r.entities, blocks: r.blocks };
    const fl2 = D.flatten(doc);
    assert.equal(fl2.items.length, fl.items.length, name + ': same things drawn');
    // paths (lines, arcs, polylines…) scale exactly; text, hatches and arrows are sized by rules of their own
    const ps = (f) => f.items.filter((it) => it.k === 'p' && !it.w && (it.ps ? 1 : 0) === space);
    const a = ps(fl), c = ps(fl2);
    assert.equal(a.length, c.length);
    for (let i = 0; i < a.length; i++) {
      if (a[i].fill) continue;
      const p = a[i].b, q = c[i].b;
      [b[0] + (p[0] - b[0]) * s, b[1] + (p[1] - b[1]) * s, b[0] + (p[2] - b[0]) * s, b[1] + (p[3] - b[1]) * s].forEach((v, j) => near(q[j], v, `${name} item ${i} box ${j}`, 1e-6));
    }
  }
});

test('scale to a width: the box comes out as typed, mm, also for a file in inches', () => {
  const { raw, fl } = load('outline.dxf');
  const factor = unitFactor(fl.units), box = drawingBoxMm(fl, factor), w = box[2] - box[0];
  const s = E.scaleFactor(250, w);
  const r = E.scaleAbout(raw, s, fl.boxes.model[0], fl.boxes.model[1]);
  const fl2 = D.flatten({ ...raw, entities: r.entities, blocks: r.blocks }), b2 = drawingBoxMm(fl2, factor);
  near(b2[2] - b2[0], 250, 'width'); near(b2[0], box[0], 'left stays'); near(b2[1], box[1], 'bottom stays');
  near(b2[3] - b2[1], (box[3] - box[1]) * s, 'aspect kept');
  // an inch file: typed millimetres, drawing units are inches (25.4 mm each)
  const inch = load('inch.dxf'), f2 = unitFactor(inch.fl.units), bx = drawingBoxMm(inch.fl, f2);
  assert.equal(f2, 25.4);
  const s2 = E.scaleFactor(100, bx[2] - bx[0]), ib = inch.fl.boxes.model;
  const r2 = E.scaleAbout(inch.raw, s2, ib[0], ib[1]);
  const bb = drawingBoxMm(D.flatten({ ...inch.raw, entities: r2.entities, blocks: r2.blocks }), f2);
  near(bb[2] - bb[0], 100, 'inch file width in mm');
});

test('scaleFactor: real over measured, or nothing for a length that makes no sense', () => {
  near(E.scaleFactor(200, 100), 2); near(E.scaleFactor('12.5', 25), 0.5);
  for (const bad of [0, -5, NaN, '', 'abc', null]) assert.equal(E.scaleFactor(bad, 100), null, String(bad));
  assert.equal(E.scaleFactor(100, 0), null); assert.equal(E.scaleFactor(1e12, 1), null);
});

// ---------------------------------------------------------------- undo

test('history: undo and redo hand back the state to restore; a new change drops the redo', () => {
  const h = E.createHistory(3);
  assert.equal(h.canUndo, false); assert.equal(h.undo('now'), null); assert.equal(h.redo('now'), null);
  h.push('a'); h.push('b');
  assert.equal(h.canUndo, true); assert.equal(h.canRedo, false);
  assert.equal(h.undo('c'), 'b'); assert.equal(h.canRedo, true);
  assert.equal(h.undo('b'), 'a');
  assert.equal(h.redo('a'), 'b'); assert.equal(h.redo('b'), 'c');
  assert.equal(h.redo('c'), null);
  h.undo('c'); h.push('x');
  assert.equal(h.canRedo, false);
  for (const s of ['1', '2', '3', '4']) h.push(s);
  let n = 0; while (h.undo('z')) n++;
  assert.equal(n, 3, 'only the last 3 are kept');
  h.clear(); assert.equal(h.canUndo, false);
});

test('history labels (TODO 30): old pushes get "Edit"; labels(); undoMany / redoMany jump several steps and back', () => {
  const h = E.createHistory();
  h.push('s0', 'Delete 3'); h.push('s1', 'Set length ×2.000'); h.push('s2');
  assert.deepEqual(h.labels(), { past: ['Delete 3', 'Set length ×2.000', 'Edit'], future: [] });
  assert.equal(h.undoMany(0, 's3'), null); assert.equal(h.undoMany(4, 's3'), null, 'more than there is');
  assert.equal(h.undoMany(2, 's3'), 's1', 'two steps back lands on the state before the 2nd');
  assert.deepEqual(h.labels(), { past: ['Delete 3'], future: ['Set length ×2.000', 'Edit'] }, 'the undone steps keep their names, next redo first');
  assert.equal(h.redoMany(2, 's1'), 's3', 'forward again, all the way');
  assert.deepEqual(h.labels(), { past: ['Delete 3', 'Set length ×2.000', 'Edit'], future: [] });
  assert.equal(h.undo('s3'), 's2'); assert.equal(h.redo('s2'), 's3');
  assert.equal(h.undoMany(1, 's3'), 's2'); h.push('s9', 'New');
  assert.deepEqual(h.labels().future, [], 'a new change drops the redo');
});

test('undo of a Keep only and a scale restores the document the way it was', () => {
  const { raw, fl } = load('outline.dxf');
  const h = E.createHistory(), snap = () => ({ entities: raw.entities, blocks: raw.blocks });
  const first = snap();
  const ed = E.makeIndex(raw, fl);
  h.push(snap()); Object.assign(raw, E.keepOnly(raw, new Set(E.chainAt(ed, 0, 0.01))));
  assert.equal(raw.entities.length, 8);
  h.push(snap()); Object.assign(raw, E.scaleAbout(raw, 2, 0, 0, 0));
  near(boxOf(raw)[2], 200);
  Object.assign(raw, h.undo(snap())); near(boxOf(raw)[2], 100);
  Object.assign(raw, h.undo(snap())); assert.equal(raw.entities, first.entities); assert.equal(raw.entities.length, 15);
  Object.assign(raw, h.redo(snap())); assert.equal(raw.entities.length, 8);
});

test('a dense drawing: the chain graph and a click stay fast', () => {
  // 20 000 short lines in one long chain, and 20 000 loose ones
  const doc = W.newDoc(4), ents = [];
  for (let i = 0; i < 20000; i++) ents.push(W.line(i * 0.05, 0, (i + 1) * 0.05, i % 2 ? 0.01 : 0));
  for (let i = 0; i < 20000; i++) ents.push(W.line(i * 0.07, 5 + (i % 50), i * 0.07 + 0.03, 5 + (i % 50)));
  W.addEntities(doc, ents);
  const raw = D.readDxf(W.writeDxf(doc)), fl = D.flatten(raw);
  const t0 = performance.now();
  const ed = E.makeIndex(raw, fl);
  const e = E.hitEntity(ed, 100.02, 0, 0.1), t1 = performance.now();
  const chain = E.chainAt(ed, e, 0.011), t2 = performance.now();
  assert.equal(chain.length, 20000, 'the long chain, all of it');
  assert.ok(t2 - t1 < 500, 'chain ' + (t2 - t1) + ' ms');
  assert.ok(t1 - t0 < 5000, 'index ' + (t1 - t0) + ' ms');
});

test('measure: distance, ΔX, ΔY and the angle in mm, anticlockwise from +X with y up', () => {
  const m = E.measureTwo([0, 0], [3, 4]);
  near(m.dist, 5); near(m.dx, 3); near(m.dy, 4); near(m.angle, 53.13010235, 'angle', 1e-8);
  assert.equal(E.measureTwo([0, 0], [-1, 0]).angle, 180);
  near(E.measureTwo([0, 0], [0, -1]).angle, 270);
  assert.equal(E.measureTwo([5, 5], [5, 5]).angle, 0);
  const inch = E.measureTwo([0, 0], [1, 0], 25.4);
  near(inch.dist, 25.4); near(inch.dx, 25.4);
  assert.equal(E.measureTwo([0, 0], [1, -1e-12]).angle, 0, 'no 360 for a hair below zero');
});
test('measure text: 2 decimals, no trailing zeros, never -0', () => {
  assert.equal(E.mmText(100), '100'); assert.equal(E.mmText(12.3456), '12.35'); assert.equal(E.mmText(-0.001), '0'); assert.equal(E.mmText(2.5), '2.5');
  assert.equal(E.formatMeasure(E.measureTwo([0, 0], [100, 0])), 'Distance 100 mm   ΔX 100   ΔY 0   Angle 0°');
  assert.equal(E.formatMeasure(E.measureTwo([0, 0], [-30, 40])), 'Distance 50 mm   ΔX -30   ΔY 40   Angle 126.87°');
});

test('snap: ends, centres, middles and the nearest point on a line, nearest first; off = no snap', () => {
  const { raw, fl } = load('outline.dxf');
  const ed = E.makeIndex(raw, fl);
  const k = (x, y, tol = 0.5, on) => E.snapPick(ed, x, y, tol, on);
  const e = k(100.2, 10.1); assert.equal(e.kind, 'end'); near(e.x, 100); near(e.y, 10);
  const c = k(30.2, 30.1); assert.equal(c.kind, 'centre'); near(c.x, 30);
  const m = k(50.2, 0.3); assert.equal(m.kind, 'mid'); near(m.x, 50); near(m.y, 0);
  const n = k(65, 0.4); assert.equal(n.kind, 'near'); near(n.x, 65); near(n.y, 0);
  const a = k(97.1, 52.9, 0.5); assert.ok(a === null || a.kind === 'near' || a.kind === 'mid', 'on an arc: no end here');
  assert.equal(k(60, 52), null, 'nothing near');
  assert.equal(k(100.2, 10.1, 0.5, false), null, 'snap off');
  assert.equal(k(100.2, 10.1, 0.01), null, 'out of reach');
  const hidden = E.makeIndex(raw, fl, new Set([0]));
  assert.equal(E.snapPick(hidden, 100.2, 10.1, 0.5), null, 'a hidden layer does not snap');
});

test('Nearest snap (TODO 89): the closest point on a line, arc, circle, ellipse, polyline with a bulge and spline, and it ranks below every other snap', () => {
  const doc = W.newDoc(4);
  W.addEntities(doc, [
    W.line(0, 0, 100, 0),                                       // 0
    W.arc(50, 50, 20, 0, 90),                                   // 1: ends (70, 50) and (50, 70)
    W.circle(200, 50, 10),                                      // 2
    W.ellipse(300, 50, 20, 0, 0.5),                             // 3: 20 wide, 10 high
    W.lwpoly([[400, 0], [440, 0, 1], [440, 40]]),               // 4: a bulge of 1 is a half circle, centre (440, 20)... from (440, 0) to (440, 40)
    W.entity('SPLINE', [[70, 8], [71, 3], [74, 3], [11, 500], [21, 0], [31, 0], [11, 510], [21, 10], [31, 0], [11, 520], [21, 0], [31, 0]]),   // 5
  ]);
  const raw = D.readDxf(W.writeDxf(doc)), ed = E.makeIndex(raw, D.flatten(raw));
  const k = (x, y, tol = 1) => E.snapPick(ed, x, y, tol, true);
  let n = k(30, 0.6); assert.equal(n.kind, 'near'); near(n.x, 30); near(n.y, 0);
  n = k(50 + 20 * Math.cos(0.7) * 1.03, 50 + 20 * Math.sin(0.7) * 1.03, 1); assert.equal(n.kind, 'near', 'arc'); near(Math.hypot(n.x - 50, n.y - 50), 20); near(Math.atan2(n.y - 50, n.x - 50), 0.7, 'on the pointer\'s ray', 1e-6);
  n = k(200 - 10.5, 50); assert.equal(n.kind, 'near', 'circle'); near(n.x, 190); near(n.y, 50);
  n = k(316.684, 55.888); assert.equal(n.kind, 'near', 'ellipse'); assert.ok(Math.hypot(n.x - 316.507, n.y - 55.646) < 0.05, 'the point of the ellipse at t = 0.6 (flattened, so a hair off)');
  n = k(440 + 20.4 * Math.cos(0.5), 20 + 20.4 * Math.sin(0.5)); assert.equal(n.kind, 'near', 'polyline bulge'); near(n.x, 440 + 20 * Math.cos(0.5), 'on the half circle', 1e-3); near(n.y, 20 + 20 * Math.sin(0.5), '', 1e-3);
  n = k(405, -0.5); assert.equal(n.kind, 'near', 'polyline line'); near(n.x, 405); near(n.y, 0);
  n = k(505, 5.4); assert.equal(n.kind, 'near', 'spline'); near(n.x - n.y, 500, 'on its first piece (y = x - 500)'); assert.ok(Math.hypot(n.x - 505, n.y - 5.4) < 0.5);
  n = k(510, 10.3); assert.equal(n.kind, 'near', 'a spline joint is no end or middle snap'); near(n.y, 10);
  assert.equal(k(30, 3), null, 'outside the aperture');
  // lowest priority: an end, a middle or a centre inside the aperture wins even when the curve is closer
  n = k(0.8, 0.1); assert.equal(n.kind, 'end'); near(n.x, 0);
  n = k(50.7, 0.05); assert.equal(n.kind, 'mid'); near(n.x, 50);
  n = k(200.7, 50.7); assert.equal(n.kind, 'centre'); near(n.x, 200);
  n = k(70, 49.4); assert.equal(n.kind, 'end', 'the arc\'s end beats the arc'); near(n.y, 50);
  assert.equal(E.snapPick(ed, 30, 0.6, 1, true, 0), null, 'skip: the entity being dragged is left out (Nearest and ends alike)');
  assert.equal(E.snapPick(ed, 0.8, 0.1, 1, true, 0), null);
  assert.equal(E.snapPick(ed, 30, 0.6, 1, true, 1).kind, 'near', 'another entity skipped: no change');
});

test('background: its box in mm from its pixels, and scaling keeps the bottom-left corner', () => {
  const bg = { w: 400, h: 200, mm: 0.25, x: 10, y: 20 };
  assert.deepEqual(E.bgBox(bg), [10, 20, 110, 70]);
  const b = E.bgScaled(bg, 2);
  assert.deepEqual(E.bgBox(b), [10, 20, 210, 120]);
  assert.equal(bg.mm, 0.25, 'the original is untouched');
});

test('a kept dimension: line, two arrowheads and the length in mm, in one block with one INSERT on the layer Dimensions', () => {
  const { raw, fl } = load('outline.dxf');
  const dim = E.makeDimension([50, 20], [80, 40], 1, raw.blocks);
  assert.equal(dim.name, 'PD_DIM_1'); assert.equal(dim.label, '36.06');
  assert.deepEqual(dim.block.entities.map((e) => e.type), ['LINE', 'SOLID', 'SOLID', 'TEXT']);
  assert.equal(dim.insert.layer, 'Dimensions');
  assert.equal(E.makeDimension([1, 1], [1, 1], 1), null);
  const next = E.addDimension(raw, dim);
  assert.equal(next.entities.length, raw.entities.length + 1); assert.ok(next.blocks.PD_DIM_1); assert.ok(raw.layers.Dimensions);
  assert.equal(raw.layers.Dimensions.tc, 0x0f766e); assert.equal(ink('#0f766e', false), '#0f766e'); assert.equal(ink('#0f766e', true), '#5eead4', 'the dimension colour: teal on the light sheet, light teal on the dark one');
  assert.equal(E.makeDimension([0, 0], [1, 0], 1, next.blocks).label, '1.00'); assert.equal(E.makeDimension([0, 0], [1, 0], 1, next.blocks).name, 'PD_DIM_2', 'a free name');
  const doc = { ...raw, entities: next.entities, blocks: next.blocks }, fl2 = D.flatten(doc);
  const items = fl2.items.filter((it) => it.e === next.entities.length - 1);
  assert.equal(items.length, 4, 'four drawn pieces, one entity');
  assert.ok(items.every((it) => fl2.layers[it.L[0]].name === 'Dimensions'));
  // the text is above the line, centred, along it
  const t = dim.block.entities[3], f = (c) => +t.r.v[t.r.c.indexOf(c)];
  near(f(50), Math.atan2(20, 30) * 180 / Math.PI, 'rotation'); assert.ok(f(21) > 30 - 1e-9 || f(11) < 65, 'beside the middle');
  // an upside-down direction reads from the other side
  const t2 = E.makeDimension([80, 40], [50, 20], 1).block.entities[3];
  near(+t2.r.v[t2.r.c.indexOf(50)], Math.atan2(20, 30) * 180 / Math.PI, 'upright either way');
  // pickable as one thing, deletable, and the block goes with it
  const ed = E.makeIndex(doc, fl2), hit = E.hitEntity(ed, 65, 30, 0.5);
  assert.equal(hit, next.entities.length - 1);
  assert.deepEqual(E.chainAt(ed, hit, 0.01), [hit]);
  assert.equal(E.removeEntities(doc, new Set([hit])).blocks.PD_DIM_1, undefined);
  // a file in inches: the value is in mm
  assert.equal(E.makeDimension([0, 0], [2, 0], 25.4).label, '50.80');
  // it saves and reads back with the layer
  const back = D.readDxf(W.writeDxf(doc));
  assert.ok(back.blocks.PD_DIM_1); assert.ok(back.layers.Dimensions);
  assert.equal(D.flatten(back).items.length, fl2.items.length);
});

test('scaling re-labels a kept dimension with its new length and scales its drawing; the insert stays where it is', () => {
  const { raw } = load('outline.dxf');
  const dim = E.makeDimension([50, 20], [80, 40], 1, raw.blocks), next = E.addDimension(raw, dim);
  const doc = { ...raw, entities: next.entities, blocks: next.blocks };
  const r = E.scaleAbout(doc, 2, 0, 0, 0);
  const b = r.blocks.PD_DIM_1.entities, g = (e, c) => +e.r.v[e.r.c.indexOf(c)];
  assert.equal(b[3].r.v[b[3].r.c.indexOf(1)], '72.12');
  near(g(b[0], 11), 160); near(g(b[3], 40), g(dim.block.entities[3], 40) * 2, 'text height');
  const ins = r.entities.at(-1);
  assert.equal(ins.r.c.includes(41), false, 'not scaled through the insert');
  assert.equal(dim.block.entities[3].r.v[dim.block.entities[3].r.c.indexOf(1)], '36.06', 'the original is untouched');
  assert.deepEqual(r.skipped, {});
});

test('dimension decimals: fixed places, 0 to 4; relabelDims re-labels every kept dimension from its own line', () => {
  assert.equal(E.dimText(300.0002018326812, 2), '300.00'); assert.equal(E.dimText(300.0002018326812, 0), '300');
  assert.equal(E.dimText(12.34567, 3), '12.346'); assert.equal(E.dimText(-0.0001, 2), '0.00');
  const { raw } = load('outline.dxf');
  const d1 = E.makeDimension([50, 20], [80, 40], 1, raw.blocks, 0), n1 = E.addDimension(raw, d1);
  assert.equal(d1.label, '36');
  const d2 = E.makeDimension([0, 0], [100, 0], 1, n1.blocks, 3), n2 = E.addDimension({ ...raw, ...n1 }, d2);
  assert.equal(d2.label, '100.000');
  const doc = { ...raw, ...n2 }, txt = (r, nm) => { const t = r.blocks[nm].entities.find((e) => e.type === 'TEXT'); return t.r.v[t.r.c.indexOf(1)]; };
  const r = E.relabelDims(doc, 1, 1);
  assert.equal(txt(r, 'PD_DIM_1'), '36.1'); assert.equal(txt(r, 'PD_DIM_2'), '100.0');
  assert.equal(E.relabelDims({ ...doc, ...r }, 1, 1), null, 'nothing to change');
  assert.equal(txt(E.relabelDims(doc, 25.4, 2), 'PD_DIM_2'), '2540.00', 'in mm');
  // scaling keeps a dimension's own number of decimals
  assert.equal(txt(E.scaleAbout(doc, 2, 0, 0, 0), 'PD_DIM_1'), '72'); assert.equal(txt(E.scaleAbout(doc, 2, 0, 0, 0), 'PD_DIM_2'), '200.000');
});

test('Shift picks: the point goes onto the horizontal or vertical through the first, whichever is nearer', () => {
  assert.deepEqual(E.orthoLock([0, 0], [10, 3]), [10, 0]);
  assert.deepEqual(E.orthoLock([0, 0], [-2, -9]), [0, -9]);
  assert.deepEqual(E.orthoLock([5, 5], [9, 5, 'end']), [9, 5, 'end'], 'already straight: the snap stays');
  assert.deepEqual(E.orthoLock([5, 5], [9, 6, 'end']), [9, 5], 'moved off the snapped point: no snap kind');
  assert.deepEqual(E.orthoLock(null, [1, 2]), [1, 2]);
});

test('buildDimension: the line at the offset, extension lines with a gap and an overshoot, the text centred above and upright', () => {
  const g = (e, c) => +e.r.v[e.r.c.indexOf(c)];
  const d = E.buildDimension({ a: [0, 0], b: [100, 0], offset: 20, textH: 2.5 }, 1, 'PD_DIM_7');
  assert.equal(d.name, 'PD_DIM_7'); assert.equal(d.label, '100.00'); assert.equal(d.insert.layer, 'Dimensions');
  assert.deepEqual(d.block.entities.map((e) => e.type), ['LINE', 'LINE', 'LINE', 'SOLID', 'SOLID', 'TEXT']);
  const [dl, e1, e2, , , tx] = d.block.entities;
  near(g(dl, 10), 0); near(g(dl, 20), 20, 'dimension line 20 up'); near(g(dl, 11), 100); near(g(dl, 21), 20);
  near(g(e1, 20), 1, 'gap 1 mm at the part'); near(g(e1, 21), 22, 'overshoot 2 mm past the line'); near(g(e2, 10), 100);
  near(g(tx, 11), 50, 'centred'); assert.ok(g(tx, 21) > 20 && g(tx, 21) < 20 + 2.5, 'above the line, not on it'); near(g(tx, 40), 2.5); near(g(tx, 50), 0);
  // the other side
  const n = E.buildDimension({ a: [0, 0], b: [100, 0], offset: -20, textH: 2.5 }, 1, 'x').block.entities;
  near(g(n[0], 20), -20); near(g(n[1], 20), -1); near(g(n[1], 21), -22);
  // a dimension that runs right to left reads upright; one that runs upward reads bottom to top
  near(g(E.buildDimension({ a: [100, 0], b: [0, 0], offset: 5, textH: 2 }, 1, 'x').block.entities.at(-1), 50), 0, 'upright');
  const up = E.buildDimension({ a: [0, 0], b: [0, 50], offset: 5, textH: 2 }, 1, 'x').block.entities;
  near(g(up[0], 10), -5, 'left of an upward line is -x'); near(g(up.at(-1), 50), 90); near(g(up.at(-1), 10), -5 - 0.8, 'text on the far side from the part, upright');
  // offset 0: no extension lines (makeDimension's shape)
  assert.deepEqual(E.buildDimension({ a: [0, 0], b: [10, 0], offset: 0 }, 1, 'x').block.entities.map((e) => e.type), ['LINE', 'SOLID', 'SOLID', 'TEXT']);
  assert.equal(E.buildDimension({ a: [1, 1], b: [1, 1] }, 1, 'x'), null);
  // text height scales the arrowheads with it
  const sz = (th) => { const s = E.buildDimension({ a: [0, 0], b: [100, 0], offset: 10, textH: th }, 1, 'x').block.entities[3]; return Math.abs(g(s, 10) - g(s, 11)); };
  near(sz(5) / sz(2.5), 2, 'twice the text, twice the arrow');
  // dimOffsetAt: the cursor's perpendicular distance, left positive
  near(E.dimOffsetAt([0, 0], [10, 0], [3, 7]), 7); near(E.dimOffsetAt([0, 0], [10, 0], [3, -4]), -4); near(E.dimOffsetAt([0, 0], [0, 10], [3, 5]), -3);
});

test('dimParams reads a, b, offset and text height back, from the block and through Save and reopen', () => {
  const { raw } = load('outline.dxf');
  const cases = [{ a: [50, 20], b: [80, 40], offset: 12.5, textH: 3 }, { a: [80, 40], b: [50, 20], offset: -7, textH: 4.25 }, { a: [0, 0], b: [0, 33], offset: 0.5, textH: 2 },
    { a: [10, 10], b: [60, 10], offset: 0, textH: 2.5 }, { a: [-5, 5], b: [-45, -30], offset: -3, textH: 1 }];
  for (const p of cases) {
    const d = E.buildDimension(p, 1, 'PD_DIM_1'), got = E.dimParams(d.block);
    near(got.a[0], p.a[0]); near(got.a[1], p.a[1]); near(got.b[0], p.b[0]); near(got.b[1], p.b[1]); near(got.offset, p.offset, 'offset'); near(got.textH, p.textH);
    const doc = { ...raw, ...E.addDimension(raw, d) }, back = D.readDxf(W.writeDxf(doc)), again = E.dimParams(back.blocks.PD_DIM_1);
    near(again.a[0], p.a[0], 'saved a', 1e-5); near(again.b[1], p.b[1], 'saved b', 1e-5); near(again.offset, p.offset, 'saved offset', 1e-5); near(again.textH, p.textH, 'saved height', 1e-5);
    const i = doc.entities.length - 1;
    assert.equal(E.dimOfEntity(back, back.entities.length - 1).name, 'PD_DIM_1'); assert.equal(E.dimOfEntity(back, 0), null);
    assert.ok(i >= 0);
  }
  // Keep's zero-offset dimension (makeDimension) reads back with its line's ends, and rebuilding it changes only what changed
  const k = E.makeDimension([50, 20], [80, 40], 1, {}), kp = E.dimParams(k.block);
  near(kp.offset, 0); near(kp.a[0], 50); near(kp.b[1], 40); near(kp.textH, 2);
  const re = E.buildDimension({ ...kp, offset: 9, textH: 6 }, 1, 'PD_DIM_1'), rp = E.dimParams(re.block);
  near(rp.offset, 9); near(rp.textH, 6); near(rp.a[1], 20);
  const doc = { ...raw, ...E.addDimension(raw, k) }, rep = E.replaceDimension(doc, re);
  assert.equal(rep.entities, doc.entities, 'the INSERT stays'); assert.equal(rep.blocks.PD_DIM_1, re.block);
  assert.equal(E.dimParams(null), null);
});

test('relabelDims and scaleAbout still right with extension lines present: the label comes from the dimension line', () => {
  const { raw } = load('outline.dxf');
  const d = E.buildDimension({ a: [0, 0], b: [100, 0], offset: 30, textH: 3 }, 1, 'PD_DIM_1', 2), doc = { ...raw, ...E.addDimension(raw, d) };
  const txt = (r) => { const t = r.blocks.PD_DIM_1.entities.find((e) => e.type === 'TEXT'); return t.r.v[t.r.c.indexOf(1)]; };
  assert.equal(txt(E.relabelDims(doc, 1, 0)), '100'); assert.equal(txt(E.relabelDims(doc, 25.4, 1)), '2540.0');
  const r = E.scaleAbout(doc, 2, 0, 0, 0), p = E.dimParams(r.blocks.PD_DIM_1);
  assert.equal(txt(r), '200.00'); near(p.offset, 60); near(p.textH, 6); near(p.b[0], 200);
  // a text height change keeps a, b and offset
  const h = E.dimParams(E.buildDimension({ ...E.dimParams(r.blocks.PD_DIM_1), textH: 4 }, 1, 'x').block);
  near(h.offset, 60); near(h.b[0], 200); near(h.textH, 4);
});

test('area and perimeter (TODO 31): a hole is taken off; arcs are measured round', () => {
  const L = (a, b, c, d) => `0\nLINE\n8\n0\n10\n${a}\n20\n${b}\n11\n${c}\n21\n${d}\n`;
  const raw = D.readDxf(`0\nSECTION\n2\nENTITIES\n` + L(0, 0, 10, 0) + L(10, 10, 10, 0) + L(10, 10, 0, 10) + L(0, 10, 0, 0) +
    `0\nCIRCLE\n8\n0\n10\n5\n20\n5\n40\n2\n0\nENDSEC\n0\nEOF\n`);
  const ed = E.makeIndex(raw, D.flatten(raw));
  const r = E.areaPerimeter(ed, [0, 1, 2, 3, 4], 1, 0.001);
  near(r.area, 100 - 4 * Math.PI, 'square less the hole', 1e-5);
  near(r.perimeter, 40 + 4 * Math.PI, 'both outlines', 1e-5);
  assert.deepEqual([r.loops, r.holes, r.open], [2, 1, 0]);
  const sq = E.areaPerimeter(ed, [0, 1, 2], 1, 0.001);          // three sides: not closed, no area
  assert.deepEqual([sq.area, sq.open], [0, 1]);
  near(E.areaPerimeter(ed, [0, 1, 2, 3], 25.4, 0.001).area, 100 * 25.4 * 25.4, 'an inch drawing in mm?');
});

test('area and perimeter of a rounded outline (100 x 60, r 10)', () => {
  const { raw, fl } = load('outline.dxf');
  const r = E.areaPerimeter(E.makeIndex(raw, fl), [0, 1, 2, 3, 4, 5, 6, 7], 1, E.chainTol(fl.boxes.model, 1));
  near(r.area, 6000 - (4 - Math.PI) * 100, 'area', 1e-5);
  near(r.perimeter, 320 - 80 + 20 * Math.PI, 'perimeter', 1e-4);
});

test('area across a tiny gap: the outline scaled x2 (gaps 0.008 and 0.012 mm) still closes, and says so', () => {
  const { raw } = load('outline.dxf');
  const s = E.scaleAbout(raw, 2, 0, 0), big = { ...raw, entities: s.entities, blocks: s.blocks }, fl = D.flatten(big);
  const r = E.areaPerimeter(E.makeIndex(big, fl), [0, 1, 2, 3, 4, 5, 6, 7], 1, E.chainTol(fl.boxes.model, 1));
  near(r.area, 4 * (6000 - (4 - Math.PI) * 100), 'area', 1e-5);
  assert.deepEqual([r.loops, r.gaps, r.open], [1, 1, 0]);
});

// ---- TODO 46: tiny gaps
test('findGaps: the two gaps of outline.dxf (0.004, 0.006) at 0.01, one at 0.005, none at 0.001', () => {
  const { raw, fl } = load('outline.dxf');
  const ed = E.makeIndex(raw, fl);
  const g = E.findGaps(ed, 0.01);
  assert.equal(g.length, 2);
  near(Math.max(...g.map((x) => x.spread)), 0.006, 'the larger gap', 1e-3);
  assert.equal(E.findGaps(ed, 0.005).length, 1, 'only the 0.004 one');
  assert.equal(E.findGaps(ed, 0.001).length, 0);
});

test('joinGaps: every end meets its neighbour, the ring chains at 1e-6, area has no gaps, one new state', () => {
  const { raw, fl } = load('outline.dxf');
  const ed = E.makeIndex(raw, fl), gaps = E.findGaps(ed, 0.01);
  const before = JSON.stringify(raw.entities);
  const r = E.joinGaps(raw, ed, gaps);
  assert.equal(JSON.stringify(raw.entities), before, 'the old state is untouched (undo)');
  assert.equal(r.joined, 2);
  assert.deepEqual(r.skipped, {});
  const raw2 = { ...raw, entities: r.entities, blocks: r.blocks }, fl2 = D.flatten(raw2), ed2 = E.makeIndex(raw2, fl2);
  assert.equal(E.findGaps(ed2, 0.01).length, 0);
  assert.equal(E.chainAt(ed2, 0, 1e-6).length, 8);
  const ap = E.areaPerimeter(ed2, E.chainAt(ed2, 0, 1e-6), 1, 1e-6);
  assert.equal(ap.gaps, 0);
  assert.equal(ap.open, 0);
  assert.ok(ap.loops >= 1);
  // the moved ends sit at the midpoint of where they were
  const a = gaps[0];
  for (const x of a.ends) near(ed2.ends[x.e * 4 + x.k * 2], a.x, 'x', 1e-9);
});

test('joined gaps stay joined through Save and reopen (the file keeps 6 decimals)', () => {
  const { raw, fl } = load('outline.dxf');
  const ed = E.makeIndex(raw, fl), r = E.joinGaps(raw, ed, E.findGaps(ed, 0.01));
  const text = W.writeDxf({ ...raw, entities: r.entities, blocks: r.blocks }, { escapeUnicode: true });
  const raw2 = D.readDxf(D.decodeDxf(new TextEncoder().encode(text))), ed2 = E.makeIndex(raw2, D.flatten(raw2));
  assert.equal(E.findGaps(ed2, 0.01).length, 0);
  assert.equal(E.findGaps(ed2, 1e-5).length, 0);
});

test('joinGaps: lines, polylines and a polyline', () => {
  const dxf = (body) => '0\nSECTION\n2\nENTITIES\n' + body + '0\nENDSEC\n0\nEOF\n';
  const L = (x1, y1, x2, y2) => `0\nLINE\n8\n0\n10\n${x1}\n20\n${y1}\n30\n0\n11\n${x2}\n21\n${y2}\n31\n0\n`;
  const PL = (pts) => `0\nLWPOLYLINE\n8\n0\n90\n${pts.length}\n70\n0\n` + pts.map((p) => `10\n${p[0]}\n20\n${p[1]}\n`).join('');
  const raw = D.readDxf(dxf(L(0, 0, 10, 0) + PL([[10.004, 0], [10, 10], [0.002, 10]]) + L(0, 10.001, 0, 0.003)));
  const fl = D.flatten(raw), ed = E.makeIndex(raw, fl), gaps = E.findGaps(ed, 0.01);
  assert.equal(gaps.length, 3);
  const r = E.joinGaps(raw, ed, gaps);
  const raw2 = { ...raw, entities: r.entities }, ed2 = E.makeIndex(raw2, D.flatten(raw2));
  assert.equal(E.findGaps(ed2, 0.01).length, 0);
  assert.equal(E.chainAt(ed2, 0, 1e-9).length, 3);
});

test('newLayerName: the first free Layer1, Layer2… (any case)', () => {
  assert.equal(E.newLayerName(['0']), 'Layer1');
  assert.equal(E.newLayerName(['0', 'Layer1', 'layer2', 'Layer4']), 'Layer3');
  assert.equal(E.newLayerName(new Set(['LAYER1'])), 'Layer2');
});

test('layerNameProblem: empty, bad characters, too long, taken', () => {
  const names = ['0', 'Cut', 'Layer1'];
  assert.equal(E.layerNameProblem('Marks', names), '');
  assert.match(E.layerNameProblem('  ', names), /needs a name/);
  assert.match(E.layerNameProblem('a/b', names), /can't hold/);
  assert.match(E.layerNameProblem('x'.repeat(256), names), /255/);
  assert.match(E.layerNameProblem('cut', names), /already there/);
  assert.equal(E.layerNameProblem('CUT', names, 'Cut'), '', 'its own name in another case is fine');
});
