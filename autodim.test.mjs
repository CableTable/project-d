// autodim.js — which dimension a hover / pick gives, and how the pointer shapes it.   node autodim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { targetOf, lineAxis, autoDraft, ghostAt } from './web/autodim.js';
import { dimGeom } from './web/edit.js';
import { line, circle, arc, ellipse, lwpoly, rect, text } from './web/dxf-write.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} !~ ${b}`);

test('what a pick dimensions: line, polyline segment, arc, circle; the rest nothing', () => {
  assert.deepEqual(targetOf(line(0, 0, 10, 0), [5, 0]), { type: 'line', l: [0, 0, 10, 0] });
  assert.equal(targetOf(arc(0, 0, 30, 0, 90), [30, 0]).type, 'arc');
  assert.deepEqual(targetOf(circle(1, 2, 20), [21, 2]), { type: 'circle', c: [1, 2], r: 20 });
  assert.equal(targetOf(ellipse(0, 0, 20, 0, 0.5), [20, 0]), null);
  assert.equal(targetOf(text(0, 0, 3, 'x'), [0, 0]), null);
  assert.equal(targetOf(null, [0, 0]), null);
});

test('polyline: the segment nearest the pointer, the closing one too; a bulged segment gives nothing', () => {
  const pl = lwpoly([[0, 0], [50, 0], [50, 30]]);
  assert.deepEqual(targetOf(pl, [20, 1]).l, [0, 0, 50, 0]);
  assert.deepEqual(targetOf(pl, [49, 20]).l, [50, 0, 50, 30]);
  assert.deepEqual(targetOf(rect(0, 0, 40, 20), [1, 10]).l, [0, 20, 0, 0], 'the closing segment');
  assert.equal(targetOf(lwpoly([[0, 0, 0.5], [50, 0], [50, 30]]), [20, 1]), null, 'bulge');
});

test('the line rule (sloped line 0,20 to 80,80, length 100): beside = aligned, beyond an end = horizontal above / below, vertical to the side', () => {
  const l = [0, 20, 80, 80];
  assert.equal(lineAxis(l, [40, 50 + 45]), null, 'beside');
  assert.equal(lineAxis(l, [40 + 36, 50 - 27]), null, 'beside the other way');
  assert.equal(lineAxis(l, [60, 110]), 'h', 'above the end');
  assert.equal(lineAxis(l, [30, -40]), 'h', 'below the start');
  assert.equal(lineAxis(l, [110, 50]), 'v', 'to the side');
  assert.equal(lineAxis([0, 0, 100, 0], [50, 40]), 'h', 'a horizontal line stays horizontal');
  assert.equal(lineAxis([0, 0, 0, 100], [500, 40]), 'v', 'a vertical line stays vertical');
});

test('autoDraft: line → aligned / linear measured as the line / its box side; arc → radius; circle → diameter', () => {
  const t = { type: 'line', l: [0, 20, 80, 80] };
  const al = autoDraft(t, [10, 90]);
  assert.equal(al.kind, 'aligned');
  near(dimGeom(al.kind, { ...al.params, textH: 3 }, 1).mm, 100);
  const hz = autoDraft(t, [60, 110]);
  assert.equal(hz.kind, 'linear'); assert.equal(hz.params.axis, 'h');
  near(dimGeom(hz.kind, { ...hz.params, textH: 3 }, 1).mm, 80);
  const vt = autoDraft(t, [110, 50]);
  near(dimGeom(vt.kind, { ...vt.params, textH: 3 }, 1).mm, 60);
  const r = autoDraft({ type: 'arc', c: [0, 0], r: 30 }, [20, 20]);
  assert.equal(r.kind, 'radius'); near(dimGeom(r.kind, { ...r.params, textH: 3 }, 1).mm, 30);
  const d = autoDraft({ type: 'circle', c: [0, 0], r: 20 }, [20, 20]);
  assert.equal(d.kind, 'diameter'); near(dimGeom(d.kind, { ...d.params, textH: 3 }, 1).mm, 40);
  assert.equal(autoDraft({ type: 'circle', c: [0, 0], r: 20 }, [0, 0]), null, 'pointer on the centre');
  assert.equal(autoDraft(null, [0, 0]), null);
});

test('ghostAt: a line\'s ghost sits beside the line; an arc or circle uses the pointer', () => {
  const g = ghostAt({ type: 'line', l: [0, 0, 10, 0] }, [5, 0], 4);
  near(g[0], 5); near(g[1], 4);
  assert.deepEqual(ghostAt({ type: 'circle', c: [0, 0], r: 1 }, [1, 0], 4), [1, 0]);
});
