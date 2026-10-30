import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from './web/dxf-write.js';
import * as E from './web/edit.js';
import { dragGrip } from './web/grips.js';
import { flatten, readDxf } from './web/drawing.js';
import { followDimensions } from './web/linked-dimensions.js';
import { labelOf } from './web/objects.js';
import { explodeSelection } from './web/explode.js';
import { rotateEntities } from './web/rotate.js';
import { mirrorEntity } from './web/modify.js';

function drawing(shape, params, kind = 'aligned', factor = 1) {
  const raw = W.newDoc(4);
  W.addEntities(raw, shape);
  Object.assign(raw, E.addDimension(raw, E.buildDim(kind, { textH: 2, offset: 10, ...params }, factor, E.freeName({}, kind === 'linear' ? 'aligned' : kind), 3)));
  return raw;
}
const model = (raw) => E.dimOfEntity(raw, 1);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const point = (a, b) => a.forEach((v, i) => close(v, b[i]));
const grip = (raw, id, to) => followDimensions(raw, {
  entities: raw.entities.map((e, i) => i === 0 ? dragGrip(e, id, to).ent : e), blocks: raw.blocks
});
const label = (raw, e = 1) => { const r = raw.blocks[E.dimOfEntity(raw, e).name].entities.find((e) => e.type === 'TEXT').r; return r.v[r.c.indexOf(1)]; };

test('rectangle corner: aligned dimension value and position follow, one Undo / Redo restores both', () => {
  const raw = drawing(W.lwpoly([[20, 20], [120, 20], [120, 80], [20, 80]], { closed: true }), { a: [120, 20], b: [120, 80] });
  const before = structuredClone(raw), next = grip(raw, 'v2', [150, 100]), p = model(next).params;
  point(p.a, [120, 20]); point(p.b, [150, 100]); close(p.offset, 10);
  assert.equal(label(next), Math.hypot(30, 80).toFixed(3));
  assert.notDeepEqual(next.blocks.PD_DIM_1, raw.blocks.PD_DIM_1);
  assert.deepEqual(raw, before, 'undo snapshot remains immutable');
  const h = E.createHistory(); h.push(raw, 'Stretch vertex');
  assert.deepEqual(h.undo(next), before); assert.equal(h.canUndo, false);
  assert.deepEqual(h.redo(raw), next);
});

test('Move a line: both measured points and callout move; a subsequent grip follows again', () => {
  const raw = drawing(W.line(0, 0, 100, 0), { a: [0, 0], b: [100, 0], units: 'inch', pos: 'centre', arrow: 1, gap: .5 });
  const next = followDimensions(raw, E.moveEntities(raw, new Set([0]), 5, 7)), p = model(next).params;
  point(p.a, [5, 7]); point(p.b, [105, 7]); close(p.offset, 10);
  close(p.textH, 2); close(p.arrow, 1); close(p.gap, .5);
  assert.equal(p.units, 'inch'); assert.equal(p.pos, 'centre'); assert.equal(model(next).dp, 3);
  point(model(grip({ ...raw, ...next }, 'b', [125, 7])).params.b, [125, 7]);
});

test('Scale a line alone, or with its dimension: exact value with no double transform', () => {
  for (const selected of [new Set([0]), new Set([0, 1])]) {
    const raw = drawing(W.line(10, 20, 110, 20), { a: [10, 20], b: [110, 20] });
    const next = followDimensions(raw, E.scaleAbout(raw, 2, 10, 20, 0, selected)), p = model(next).params;
    point(p.a, [10, 20]); point(p.b, [210, 20]); assert.equal(label(next), '200.000');
    close(p.offset, selected.has(1) ? 20 : 10); close(p.textH, selected.has(1) ? 4 : 2);
    point(model(grip({ ...raw, ...next }, 'b', [250, 20])).params.b, [250, 20]);
  }
  const diagonal = drawing(W.line(50, 20, 80, 40), { a: [50, 20], b: [80, 40] });
  assert.equal(label(diagonal), '36.056');
  assert.equal(label(followDimensions(diagonal, E.scaleAbout(diagonal, 2, 0, 0))), '72.111', 'recalculate instead of multiplying the rounded label');
});

test('moving a line and its dimension together once, then moving only the line, respects the INSERT frame', () => {
  const raw = drawing(W.line(0, 0, 100, 0), { a: [0, 0], b: [100, 0] });
  const next = followDimensions(raw, E.moveEntities(raw, new Set([0, 1]), 5, 7));
  point(model(next).params.a, [0, 0]); point(model(next).params.b, [100, 0]);
  const again = followDimensions({ ...raw, ...next }, E.moveEntities({ ...raw, ...next }, new Set([0]), 10, 20));
  point(model(again).params.a, [10, 20]); point(model(again).params.b, [110, 20]);
  assert.deepEqual(flatten({ ...raw, ...again }).boxes.model, [15, 27, 115, 40.4]);
});

test('Linear dimensions retain their axis even when initially indistinguishable from Aligned', () => {
  for (const axis of ['h', 'v']) {
    const b = axis === 'h' ? [100, 0] : [0, 100];
    const raw = drawing(W.line(0, 0, ...b), { a: [0, 0], b, axis }, 'linear');
    const next = grip(raw, 'b', [120, 80]), dim = model(next);
    assert.equal(dim.kind, 'linear'); assert.equal(dim.params.axis, axis);
    point(dim.params.b, [120, 80]); assert.equal(label(next), axis === 'h' ? '120.000' : '80.000');
  }
});

test('Linear axis tags survive DXF reopen and Copy: dragging off-axis keeps 100.00', () => {
  for (const axis of ['h', 'v']) for (const offset of [0, 10]) {
    const b = axis === 'h' ? [100, 0] : [0, 100], to = axis === 'h' ? [100, 30] : [30, 100];
    const raw = W.newDoc(4);
    W.addEntities(raw, W.line(0, 0, ...b));
    const dim = E.makeDimension([0, 0], b, 1, raw.blocks, 2, { axis, offset, textH: 2 });
    assert.equal(dim.name, `PD_DIM_${axis.toUpperCase()}1`);
    Object.assign(raw, E.addDimension(raw, dim));
    const back = readDxf(W.writeDxf(raw));
    assert.equal(model(back).kind, 'linear'); assert.equal(model(back).params.axis, axis);
    assert.equal(label(grip(back, 'b', to)), '100.00');
    assert.equal(labelOf(back.entities[1], 1, back.blocks), 'Dimension');
    assert.equal(explodeSelection(back, new Set([1])).exploded, 1);
    const copied = readDxf(W.writeDxf({ ...back, ...E.copyEntities(back, new Set([0, 1]), 0, 50) }));
    const copy = E.dimOfEntity(copied, 3);
    assert.equal(copy.name, `PD_DIM_${axis.toUpperCase()}2`); assert.equal(copy.params.axis, axis);
    const moved = followDimensions(copied, { ...copied, entities: copied.entities.map((e, i) => i === 2 ? dragGrip(e, 'b', [to[0], to[1] + 50]).ent : e) });
    const tx = moved.blocks[copy.name].entities.find((e) => e.type === 'TEXT');
    assert.equal(tx.r.v[tx.r.c.indexOf(1)], '100.00');
    assert.equal(label(moved), '100.00', 'the original stays independent');
  }
});

test('old untagged Linear files keep geometry inference, including on-axis ambiguity', () => {
  for (const axis of ['h', 'v']) for (const offAxis of [false, true]) {
    const b = offAxis ? [100, 100] : axis === 'h' ? [100, 0] : [0, 100];
    const back = readDxf(W.writeDxf(drawing(W.line(0, 0, ...b), { a: [0, 0], b, axis }, 'linear')));
    assert.equal(model(back).name, 'PD_DIM_1');
    assert.equal(model(back).kind, offAxis ? 'linear' : 'aligned');
    assert.equal(model(back).params.axis, offAxis ? axis : undefined);
  }
});

test('free dimensions and near misses stay put; tolerance is 2e-6 drawing units, in inch drawings too', () => {
  for (const factor of [1, 25.4]) {
    const raw = drawing(W.line(0, 0, 100, 0), { a: [0, 5e-6], b: [100, 5e-6] }, 'aligned', factor);
    const next = followDimensions(raw, E.moveEntities(raw, new Set([0]), 5, 7), factor);
    assert.equal(next.blocks, raw.blocks, 'outside tolerance is not linked');
    const exact = drawing(W.line(0, 0, 100, 0), { a: [0, 1e-6], b: [100, 1e-6] }, 'aligned', factor);
    const followed = followDimensions(exact, E.moveEntities(exact, new Set([0]), 5, 7), factor);
    point(model(followed).params.a, [5, 7]);
  }
  const free = drawing(W.line(0, 0, 100, 0), { a: [20, 20], b: [80, 20] });
  assert.equal(grip(free, 'b', [150, 0]).blocks, free.blocks);
});

test('replacement, deletion and Copy leave the dimension in place', () => {
  const raw = drawing(W.line(0, 0, 100, 0), { a: [0, 0], b: [100, 0] });
  // Replacement tools and Delete commit their own state, without followDimensions.
  const replaced = { entities: [W.line(0, 10, 100, 10), raw.entities[1]], blocks: raw.blocks };
  for (const next of [replaced, E.removeEntities(raw, new Set([0])), E.copyEntities(raw, new Set([0]), 5, 7)]) {
    assert.deepEqual(next.blocks.PD_DIM_1, raw.blocks.PD_DIM_1);
  }
});

test('block vertices follow Move; a radius dimension on no circle stays', () => {
  const raw = drawing(W.insert('Part', 20, 30), { a: [20, 30], b: [120, 30] });
  W.addBlock(raw, 'Part', [W.line(0, 0, 100, 0)]);
  const next = followDimensions(raw, E.moveEntities(raw, new Set([0]), 5, 7));
  point(model(next).params.a, [25, 37]); point(model(next).params.b, [125, 37]);
  const r = E.buildDim('radius', { c: [0, 0], r: 10, p: [20, 0] }, 1, 'PD_DIM_R1');
  Object.assign(raw, E.addDimension(raw, r));
  const moved = followDimensions(raw, E.moveEntities(raw, new Set([0]), 5, 7));
  assert.equal(moved.blocks.PD_DIM_R1, raw.blocks.PD_DIM_R1);
});

test('moving a touching rectangle leaves the unchanged rectangle dimension in place', () => {
  for (const kind of ['aligned', 'linear']) {
    const raw = drawing(W.lwpoly([[0, 0], [100, 0], [100, 60], [0, 60]], { closed: true }),
      { a: [100, 0], b: [200, 0], axis: 'h' }, kind);
    W.addEntities(raw, W.lwpoly([[100, 0], [200, 0], [200, 60], [100, 60]], { closed: true }));
    const moved = E.moveEntities(raw, new Set([0]), -30, 0);
    const next = followDimensions(raw, moved), p = model(next).params;
    point(p.a, [100, 0]); point(p.b, [200, 0]);
    assert.equal(label(next), '100.000');
    assert.equal(next.entities[2], raw.entities[2], 'the dimensioned rectangle stayed put');
    assert.equal(next.blocks, raw.blocks);
  }
});

test('a shared point goes with the shape holding the dimension\'s other end', () => {
  const raw = drawing(W.lwpoly([[0, 0], [100, 0], [100, 60], [0, 60]], { closed: true }), { a: [0, 0], b: [100, 0] });
  W.addEntities(raw, W.lwpoly([[100, 0], [200, 0], [200, 60], [100, 60]], { closed: true }));
  const add = (name, a, b) => Object.assign(raw, E.addDimension(raw, E.buildDim('aligned', { a, b, offset: 10, textH: 2 }, 1, name, 3)));
  add('PD_DIM_2', [100, 0], [200, 0]); add('PD_DIM_3', [0, 60], [200, 60]);
  const next = followDimensions(raw, E.moveEntities(raw, new Set([0]), 0, 50));
  const own = E.dimOfEntity(next, 1).params, neighbour = E.dimOfEntity(next, 3).params, far = E.dimOfEntity(next, 4).params;
  point(own.a, [0, 50]); point(own.b, [100, 50]);
  point(neighbour.a, [100, 0]); point(neighbour.b, [200, 0]);
  point(far.a, [0, 110]); point(far.b, [200, 60]);
});

test('grip dragging one LINE of a four-LINE rectangle leaves a shared dimension end in place', () => {
  const raw = drawing(W.line(0, 0, 100, 0), { a: [100, 0], b: [100, 60] });
  W.addEntities(raw, [W.line(100, 0, 100, 60), W.line(100, 60, 0, 60), W.line(0, 60, 0, 0)]);
  const next = grip(raw, 'b', [70, 0]), p = model(next).params;
  point(p.a, [100, 0]); point(p.b, [100, 60]);
  assert.equal(label(next), '60.000');
  assert.equal(next.entities[2], raw.entities[2], 'the dimensioned LINE stayed put');
  assert.equal(next.blocks, raw.blocks);
});

test('all matching dimensions follow, including an endpoint on a different shape; paper and model stay separate', () => {
  const raw = drawing(W.line(0, 0, 100, 0), { a: [0, 0], b: [100, 0] });
  W.addEntities(raw, W.line(100, 0, 100, 100));
  Object.assign(raw, E.addDimension(raw, E.buildDim('linear', { a: [0, 0], b: [100, 100], axis: 'v', offset: 20, textH: 2 }, 1, 'PD_DIM_2')));
  W.addEntities(raw, W.line(0, 0, 100, 0, { ps: true }));
  const next = followDimensions(raw, E.moveEntities(raw, new Set([0]), 10, 20));
  point(model(next).params.a, [10, 20]); point(model(next).params.b, [110, 20]);
  const other = E.dimOfEntity(next, 3);
  point(other.params.a, [10, 20]); point(other.params.b, [100, 100]);
  const paperOnly = followDimensions(raw, E.moveEntities(raw, new Set([4]), 10, 20));
  assert.equal(paperOnly.blocks, raw.blocks, 'a vertex in paper space cannot move a model dimension');
});

test('hidden dimensions follow too; blocks with every member hidden cannot break a shape edit', () => {
  const raw = drawing(W.line(0, 0, 100, 0), { a: [0, 0], b: [100, 0] });
  raw.entities[1] = { ...raw.entities[1], hidden: true };
  const next = followDimensions(raw, E.moveEntities(raw, new Set([0]), 10, 20));
  point(model(next).params.a, [10, 20]); assert.equal(next.entities[1].hidden, true);
  raw.blocks.PD_DIM_1.entities = raw.blocks.PD_DIM_1.entities.map((e) => ({ ...e, hidden: true }));
  assert.doesNotThrow(() => followDimensions(raw, E.moveEntities(raw, new Set([0]), 10, 20)));
});

test('radius dimension follows its circle: Move and Scale (value, centre, pointer); one Undo restores', () => {
  const raw = drawing(W.circle(50, 40, 10), { c: [50, 40], r: 10, p: [70, 40] }, 'radius');
  const before = structuredClone(raw), moved = followDimensions(raw, E.moveEntities(raw, new Set([0]), 5, 7)), p = model(moved).params;
  point(p.c, [55, 47]); point(p.p, [75, 47]); close(p.r, 10); assert.equal(label(moved), 'R10.000');
  assert.deepEqual(raw, before);
  const h = E.createHistory(); h.push(raw, 'Move selection');
  assert.deepEqual(h.undo(moved), before);
  const scaled = followDimensions(raw, E.scaleAbout(raw, 2, 0, 0, 0, new Set([0]))), q = model(scaled).params;
  point(q.c, [100, 80]); close(q.r, 20); point(q.p, [140, 80]); assert.equal(label(scaled), 'R20.000');
});

test('radius dimension of an arc follows; another radius, a stacked twin and a free centre do not link', () => {
  const arc = drawing(W.arc(0, 0, 10, 0, 90), { c: [0, 0], r: 10, p: [20, 0] }, 'radius');
  point(model(followDimensions(arc, E.moveEntities(arc, new Set([0]), 5, 7))).params.c, [5, 7]);
  const two = drawing(W.circle(0, 0, 10), { c: [0, 0], r: 10, p: [20, 0] }, 'radius');
  W.addEntities(two, W.circle(0, 0, 30));
  assert.equal(followDimensions(two, E.moveEntities(two, new Set([2]), 5, 7)).blocks, two.blocks, 'the bigger circle does not move it');
  point(model(followDimensions(two, E.moveEntities(two, new Set([0]), 5, 7))).params.c, [5, 7]);
  W.addEntities(two, W.circle(0, 0, 10));
  assert.equal(followDimensions(two, E.moveEntities(two, new Set([0]), 5, 7)).blocks, two.blocks, 'ambiguous: stays');
  const free = drawing(W.circle(0, 0, 10), { c: [1, 0], r: 10, p: [20, 0] }, 'radius');
  assert.equal(followDimensions(free, E.moveEntities(free, new Set([0]), 5, 7)).blocks, free.blocks);
});

test('diameter dimension follows its circle: Move and Scale keep its direction', () => {
  const raw = drawing(W.circle(50, 40, 10), { a: [40, 40], b: [60, 40] }, 'diameter');
  const moved = followDimensions(raw, E.moveEntities(raw, new Set([0]), 5, 7)), p = model(moved).params;
  point(p.a, [45, 47]); point(p.b, [65, 47]); assert.equal(label(moved), 'Ø20.000');
  const scaled = followDimensions(raw, E.scaleAbout(raw, 2, 0, 0, 0, new Set([0])));
  point(model(scaled).params.a, [80, 80]); point(model(scaled).params.b, [120, 80]); assert.equal(label(scaled), 'Ø40.000');
  const slanted = drawing(W.circle(0, 0, 5), { a: [-3, -4], b: [3, 4] }, 'diameter');
  const s = model(followDimensions(slanted, E.moveEntities(slanted, new Set([0]), 10, 0))).params;
  point(s.a, [7, -4]); point(s.b, [13, 4]);
});

test('angle dimension follows its two lines: Move of one, a tilt, and a Move of both', () => {
  const raw = drawing(W.line(0, 0, 100, 0), { v: [0, 0], r: 20, a0: 0, a1: 90 }, 'angle');
  W.addEntities(raw, W.line(0, 0, 0, 100));
  const lone = followDimensions(raw, E.moveEntities(raw, new Set([0]), 0, 10)), p = model(lone).params;
  close(p.a0, 0); close(p.a1, 90); point(p.v, [0, 10]); assert.equal(label(lone), '90.000°');
  const both = followDimensions(raw, E.moveEntities(raw, new Set([0, 2]), 5, 7));
  point(model(both).params.v, [5, 7]); close(model(both).params.a1, 90);
  const tilt = followDimensions(raw, { entities: raw.entities.map((e, i) => i === 0 ? W.line(0, 0, 100, 100) : e), blocks: raw.blocks });
  close(model(tilt).params.a0, 45); close(model(tilt).params.a1, 90); assert.equal(label(tilt), '45.000°');
});

test('angle dimension keeps its 90° arc when its lines are mirrored (a reflection reverses the arc ends)', () => {
  const raw = drawing(W.line(0, 0, 100, 0), { v: [0, 0], r: 20, a0: 0, a1: 90 }, 'angle');
  W.addEntities(raw, W.line(0, 0, 0, 100));
  const follow = (a, b) => followDimensions(raw, { entities: raw.entities.map((e, i) => i === 0 ? a : i === 2 ? b : e), blocks: raw.blocks });
  for (const [name, next, a0, a1] of [['across the y axis', follow(W.line(0, 0, -100, 0), raw.entities[2]), 90, 180], ['across the x axis', follow(raw.entities[0], W.line(0, 0, 0, -100)), 270, 0]]) {
    const p = model(next).params;
    close(p.a0, a0); close(p.a1, a1); point(p.v, [0, 0]); assert.equal(label(next), '90.000°', name);
  }
});

test('angle dimension in a mirrored / turned INSERT keeps its angle and rays when its two lines Move (rays 180 and 90 under an X mirror)', () => {
  for (const [name, sx, sy, rot] of [['X mirror', -1, 1, 0], ['Y mirror', 1, -1, 0], ['X mirror + 90', -1, 1, 90], ['Y mirror + 90', 1, -1, 90], ['X mirror + 270', -1, 1, 270], ['Y mirror + 270', 1, -1, 270], ['turned 90', 1, 1, 90], ['non-uniform scale', 2, .5, 0]]) {
    for (const [a0, a1] of [[180, 90], [90, 180], [0, 90], [30, 120], [200, 100]]) {
      const raw = W.newDoc(4), c = Math.cos(rot * Math.PI / 180), s = Math.sin(rot * Math.PI / 180);
      const world = ([x, y]) => [3 + c * sx * x - s * sy * y, 4 + s * sx * x + c * sy * y];   // the insert's matrix, at (3, 4)
      Object.assign(raw, E.addDimension(raw, E.buildDim('angle', { textH: 2, v: [1, 2], r: 20, a0, a1 }, 1, 'PD_DIM_A1', 3)));
      const v = world([1, 2]), ray = (a) => world([1 + 100 * Math.cos(a * Math.PI / 180), 2 + 100 * Math.sin(a * Math.PI / 180)]);
      Object.assign(raw.entities[0].r, { c: [8, 2, 10, 20, 30, 41, 42, 43, 50], v: ['Dimensions', 'PD_DIM_A1', '3', '4', '0', String(sx), String(sy), '1', String(rot)] });
      W.addEntities(raw, W.line(...v, ...ray(a0)));
      W.addEntities(raw, W.line(...v, ...ray(a1)));
      const next = followDimensions(raw, E.moveEntities(raw, new Set([1, 2]), 5, 7)), p = E.dimOfEntity(next, 0).params;
      const sweep = (((a1 - a0) % 360) + 360) % 360;
      close(p.a0, a0 % 360); close(p.a1, a1 % 360); assert.equal(label(next, 0), sweep.toFixed(3) + '°', `${name} ${a0}/${a1}`);
      point(p.v, [1 + (c * 5 + s * 7) / sx, 2 + (-s * 5 + c * 7) / sy]);
    }
  }
});

test('angle follows rotated lines under a mirrored or non-uniform INSERT', () => {
  for (const [sx, sy, a0, a1] of [[-1, 1, 330, 60], [2, 1, 49.10660535086909, 106.10211375198602]]) {
    const raw = W.newDoc(4);
    Object.assign(raw, E.addDimension(raw, E.buildDim('angle', { textH: 2, v: [0, 0], r: 20, a0: 0, a1: 90 }, 1, 'PD_DIM_A1', 3)));
    raw.entities[0] = W.insert('PD_DIM_A1', 0, 0, { sx, sy, layer: 'Dimensions' });
    W.addEntities(raw, W.line(0, 0, 100 * sx, 0), W.line(0, 0, 0, 100 * sy));
    const next = followDimensions(raw, rotateEntities(raw, new Set([1, 2]), [0, 0], 30)), p = E.dimOfEntity(next, 0).params;
    close(p.a0, a0); close(p.a1, a1); point(p.v, [0, 0]);
    assert.equal(label(next, 0), ((a1 - a0 + 360) % 360).toFixed(3) + '°');
  }
});

test('mirroring a reflex angle keeps its reflex sweep and reverses its rays', () => {
  const raw = drawing(W.line(0, 0, 100, 0), { v: [0, 0], r: 20, a0: 90, a1: 0 }, 'angle');
  W.addEntities(raw, W.line(0, 0, 0, 100));
  const entities = raw.entities.map((e, i) => i === 1 ? e : mirrorEntity(e, [0, 0], [0, 1], raw.blocks).ent);
  const next = followDimensions(raw, { entities, blocks: raw.blocks }), p = model(next).params;
  close(p.a0, 180); close(p.a1, 90); point(p.v, [0, 0]);
  assert.equal(label(next), '270.000°');
});

test('angle at a rectangle corner follows a grip drag of the corner; a vertex off the lines does not link', () => {
  const square = [[20, 20], [120, 20], [120, 80], [20, 80]];
  const raw = drawing(W.lwpoly(square, { closed: true }), { v: [120, 20], r: 15, a0: 90, a1: 180 }, 'angle');
  const next = grip(raw, 'v1', [150, 20]), p = model(next).params;
  point(p.v, [150, 20]); close(p.a0, 180 - Math.atan2(60, 30) * 180 / Math.PI); close(p.a1, 180);
  const unlinked = drawing(W.lwpoly(square, { closed: true }), { v: [121, 20], r: 15, a0: 90, a1: 180 }, 'angle');
  assert.equal(grip(unlinked, 'v1', [150, 20]).blocks, unlinked.blocks);
});

// TODO 129c: a saved drawing read back keeps its links (DXF holds 6 decimals; the dimension blocks are rebuilt through arithmetic).
const like = (a, b) => a.forEach((v, k) => assert.ok(Math.abs(v - b[k]) < 1e-5, `${a} != ${b}`));   // what a file holds is good to 6 decimals
const reopen = (raw) => readDxf(W.writeDxf(raw));
const gripAt = (raw, i, id, to) => followDimensions(raw, {
  entities: raw.entities.map((e, k) => k === i ? dragGrip(e, id, to).ent : e), blocks: raw.blocks
});

test('TODO 129c: aligned dimension of an odd-valued rectangle follows a grip drag after save and reopen', () => {
  const raw = drawing(W.lwpoly([[20.1234567, 20], [120.3333333, 20], [120, 80.7777], [20, 80]], { closed: true }), { a: [120.3333333, 20], b: [120, 80.7777] });
  const back = reopen(raw), next = gripAt(back, 0, 'v2', [150, 100]), p = model(next).params;
  assert.notEqual(next.blocks, back.blocks);
  like(p.a, [120.333333, 20]); like(p.b, [150, 100]);
  assert.equal(label(next), Math.hypot(150 - 120.333333, 80).toFixed(3));
});

test('TODO 129c: radius, diameter and angle dimensions follow Move after save and reopen', () => {
  const circ = W.circle(50.123456789, 40.5, 10.3333333);
  const rad = reopen(drawing(circ, { c: [50.123456789, 40.5], r: 10.3333333, p: [70, 40] }, 'radius'));
  like(model(followDimensions(rad, E.moveEntities(rad, new Set([0]), 5, 7))).params.c, [55.123457, 47.5]);
  const dia = reopen(drawing(circ, { a: [39.790123, 40.5], b: [60.456789, 40.5] }, 'diameter'));
  like(model(followDimensions(dia, E.moveEntities(dia, new Set([0]), 5, 7))).params.a, [44.790123, 47.5]);
  const ang = W.newDoc(4);
  W.addEntities(ang, W.line(0, 0, 100, 37), W.line(0, 0, 10, 90));
  Object.assign(ang, E.addDimension(ang, E.buildDim('angle', { textH: 2, v: [0, 0], r: 30, a0: Math.atan2(37, 100) * 180 / Math.PI, a1: Math.atan2(90, 10) * 180 / Math.PI }, 1, 'PD_DIM_A1', 3)));
  const back = reopen(ang), moved = followDimensions(back, E.moveEntities(back, new Set([0, 1]), 5, 7));
  assert.notEqual(moved.blocks, back.blocks);
  like(E.dimOfEntity(moved, 2).params.v, [5, 7]);
});

test('TODO 129c: a link survives two saves, and a shape far from the dimension still does not link', () => {
  const raw = drawing(W.circle(50.123456789, 40.5, 10.3333333), { c: [50.123456789, 40.5], r: 10.3333333, p: [70, 40] }, 'radius');
  const twice = reopen(reopen(raw));
  like(model(followDimensions(twice, E.moveEntities(twice, new Set([0]), 1, 1))).params.c, [51.123457, 41.5]);
  const off = reopen(drawing(W.circle(50, 40, 10), { c: [50.00001, 40], r: 10, p: [70, 40] }, 'radius'));
  assert.equal(followDimensions(off, E.moveEntities(off, new Set([0]), 1, 1)).blocks, off.blocks);
});

test('Fix 129: a copied dimension has its own block; moving the copy leaves the original alone', () => {
  const raw = drawing(W.line(0, 0, 100, 0), { a: [0, 0], b: [100, 0] });
  const copied = { ...raw, ...E.copyEntities(raw, new Set([0, 1]), 0, 50) };
  assert.equal(copied.entities.length, 4);
  const n1 = E.dimOfEntity(copied, 1).name, n2 = E.dimOfEntity(copied, 3).name;
  assert.notEqual(n1, n2);
  const next = gripAt(copied, 2, 'b', [100, 80]);
  assert.deepEqual(next.blocks[n1], copied.blocks[n1], 'the original dimension is unchanged');
  assert.notDeepEqual(next.blocks[n2], copied.blocks[n2]);
  const circ = drawing(W.circle(50, 40, 10), { c: [50, 40], r: 10, p: [70, 40] }, 'radius');
  const cc = E.copyEntities(circ, new Set([0, 1]), 5, 5);
  assert.match(E.dimOfEntity(cc, 3).name, /^PD_DIM_R\d+$/); assert.notEqual(E.dimOfEntity(cc, 3).name, E.dimOfEntity(cc, 1).name);
});

test('Fix 129: a Linear dimension dragged off its axis keeps its axis and value on reopen', () => {
  for (const [axis, to] of [['h', [100, 30]], ['v', [30, 100]], ['h', [100, 0.05]]]) {
    const b = axis === 'h' ? [100, 0] : [0, 100], raw = drawing(W.line(0, 0, ...b), { a: [0, 0], b, axis }, 'linear');
    const next = gripAt(raw, 0, 'b', to), back = reopen(next), m = E.dimOfEntity(back, 1);
    assert.equal(m.kind, 'linear'); assert.equal(m.params.axis, axis);
    assert.equal(label(back), label(next)); assert.equal(label(back), '100.000');
  }
});
