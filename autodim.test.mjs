// autodim.js — which dimension a hover / pick gives, and how the pointer shapes it.   node autodim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as AD from './web/autodim.js';
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

const S = (o = {}) => ({ obj: null, lines: [], pts: [], as: null, ...o });
const LINE = { type: 'line', l: [0, 0, 10, 0] }, ARC = { type: 'arc', c: [0, 0], r: 30 }, CIRC = { type: 'circle', c: [0, 0], r: 20 };

test('stages and prompts: the text of each, with its options', () => {
  assert.equal(AD.stageOf(S()), 'first');
  assert.equal(AD.stageOf(S({ pts: [[0, 0]] })), 'second');
  assert.equal(AD.stageOf(S({ pts: [[0, 0], [1, 1]] })), 'points');
  assert.equal(AD.stageOf(S({ obj: LINE })), 'line');
  assert.equal(AD.stageOf(S({ obj: LINE, lines: [LINE.l, [0, 0, 0, 5]] })), 'angle');
  assert.equal(AD.promptOf(S()), 'Select a line, arc or circle, or specify first extension line origin [Undo]:');
  assert.equal(AD.promptOf(S({ pts: [[0, 0]] })), 'Specify second extension line origin or [Undo]:');
  assert.equal(AD.promptOf(S({ pts: [[0, 0], [1, 1]] })), 'Specify dimension line location or [Text/Undo]:');
  assert.equal(AD.promptOf(S({ obj: LINE })), 'Specify dimension line location or second line for angle [Text/Undo]:');
  assert.equal(AD.promptOf(S({ obj: LINE, lines: [LINE.l, [0, 0, 0, 5]] })), 'Specify angular dimension location or [Text/Undo]:');
  assert.equal(AD.promptOf(S({ obj: ARC })), 'Specify radius dimension location or [Diameter/Text/Undo]:');
  assert.equal(AD.promptOf(S({ obj: ARC, as: 'diameter' })), 'Specify diameter dimension location or [Radius/Text/Undo]:');
  assert.equal(AD.promptOf(S({ obj: CIRC })), 'Specify diameter dimension location or [Radius/Text/Undo]:');
  assert.equal(AD.promptOf(S({ obj: CIRC, as: 'radius' })), 'Specify radius dimension location or [Diameter/Text/Undo]:');
});

test('option letters: T / U everywhere, D / R only on an arc or circle, never on a line', () => {
  assert.equal(AD.optionOf(S({ obj: LINE }), 't'), 'Text');
  assert.equal(AD.optionOf(S({ obj: LINE }), 'Undo'), 'Undo');
  assert.equal(AD.optionOf(S({ obj: LINE }), 'd'), null);
  assert.equal(AD.optionOf(S({ obj: ARC }), 'd'), 'Diameter');
  assert.equal(AD.optionOf(S({ obj: ARC }), 'r'), null, 'an arc is a radius already');
  assert.equal(AD.optionOf(S({ obj: CIRC }), 'R'), 'Radius');
  assert.equal(AD.optionOf(S(), 't'), null, 'no Text before a pick');
  assert.equal(AD.optionOf(S(), 'u'), 'Undo');
  assert.equal(AD.optionOf(S(), ''), null);
});

test('Undo steps back one pick, and is null at the first prompt', () => {
  assert.equal(AD.back(S()), null);
  assert.deepEqual(AD.back(S({ pts: [[0, 0]] })), { obj: null, lines: [], pts: [] });
  assert.deepEqual(AD.back(S({ pts: [[0, 0], [1, 1]] })).pts, [[0, 0]]);
  assert.deepEqual(AD.back(S({ obj: LINE })), { obj: null, lines: [], pts: [] });
  assert.deepEqual(AD.back(S({ obj: LINE, lines: [LINE.l, [0, 0, 0, 5]] })), { obj: LINE, lines: [], pts: [] }, 'the angle goes back to the line');
});

test('a second line for the angle: a line that is not parallel; the same, a parallel one, an arc or nothing is not', () => {
  assert.deepEqual(AD.secondLine(LINE, { type: 'line', l: [0, 0, 0, 5] }), [0, 0, 0, 5]);
  assert.equal(AD.secondLine(LINE, LINE), null, 'the same line');
  assert.equal(AD.secondLine(LINE, { type: 'line', l: [0, 5, 20, 5] }), null, 'parallel');
  assert.equal(AD.secondLine(LINE, ARC), null);
  assert.equal(AD.secondLine(LINE, null), null);
  assert.equal(AD.secondLine(ARC, LINE), null);
});

test('R / D: an arc can be made a diameter and a circle a radius', () => {
  const d = AD.autoDraft(ARC, [20, 20], 'diameter');
  assert.equal(d.kind, 'diameter'); near(dimGeom(d.kind, { ...d.params, textH: 3 }, 1).mm, 60);
  const r = AD.autoDraft(CIRC, [10, 10], 'radius');
  assert.equal(r.kind, 'radius'); near(dimGeom(r.kind, { ...r.params, textH: 3 }, 1).mm, 20);
});
