import test from 'node:test';
import assert from 'node:assert/strict';
import { stretchEntities, stretchGrips } from './web/stretch.js';
import * as GR from './web/grips.js';
import { entity, line, arc, circle, ellipse, lwpoly, text, mtext, insert } from './web/dxf-write.js';
import { geometry as leaderGeometry } from './web/leader.js';

const pair = (e, code = 10, n = 0) => [GR.get(e.r, code, n), GR.get(e.r, code + 10, n)];
const vertices = (e) => GR.lwVertices(e.r).map((v) => [v.x, v.y]);
const ends = (e) => GR.gripsOf(e).filter((g) => g.kind === 'end').map((g) => [g.x, g.y]);
const box = (x0, y0, x1 = x0, y1 = y0) => ({ x0, y0, x1, y1 });
const around = ([x, y]) => box(x - .1, y - .1, x + .1, y + .1);
const enclosing = (ps) => box(Math.min(...ps.map((p) => p[0])) - .1, Math.min(...ps.map((p) => p[1])) - .1,
  Math.max(...ps.map((p) => p[0])) + .1, Math.max(...ps.map((p) => p[1])) + .1);
const nearPoints = (actual, expected, msg) => {
  assert.equal(actual.length, expected.length, msg);
  actual.forEach((p, i) => p.forEach((v, j) => assert.ok(Math.abs(v - expected[i][j]) < 1e-7, `${msg}: ${actual} vs ${expected}`)));
};
const coords = [[0, 0], [20, 0], [20, 20], [0, 20]];
const hatch = entity('HATCH', [[10, 0], [20, 0], [2, 'SOLID'], [70, 1], [71, 0], [91, 1], [92, 2], [72, 0], [73, 1], [93, 4],
  ...coords.flatMap(([x, y]) => [[10, x], [20, y]]), [97, 0], [75, 0], [98, 0]]);
const poly = entity('POLYLINE', [[70, 1], [40, 2], [41, 3]]);
poly.kids = coords.map(([x, y], i) => ({ type: 'VERTEX', c: [10, 20, 42, 40, 41], v: [x, y, i ? 0 : .4, 2, 3].map(String) }));
const light = entity('LWPOLYLINE', [[90, 4], [70, 1], [43, 5], ...coords.flatMap(([x, y], i) => [[10, x], [20, y], [42, i ? 0 : .4], [40, 2], [41, 3]])]);
const spline = entity('SPLINE', [[70, 0], [71, 3], [40, 0], [40, 1], [41, 1], [12, 3], [22, 4],
  ...coords.flatMap(([x, y], i) => [[i < 2 ? 10 : 11, x], [i < 2 ? 20 : 21, y]])]);
const dimension = entity('DIMENSION', [[70, 1], [1, '<>'], [42, 20], [10, 20], [20, 20], [11, 0], [21, 20], [13, 0], [23, 0], [14, 20], [24, 0]]);
const rawLeader = entity('LEADER', [[71, 1], [76, 4], ...coords.flatMap(([x, y]) => [[10, x], [20, y]])]);
const leader = { type: 'LEADER', model: { pts: coords, lines: ['note'], textH: 2, arrow: 1 } };
const sizedText = mtext(0, 0, 2, 'note');
sizedText.r.c.push(41, 46); sizedText.r.v.push('20', '10');
const block = insert('block', 0, 0);
block.kids = [{ type: 'ATTRIB', c: [10, 20, 1], v: ['20', '0', 'value'] }];
const fixtures = [
  ['LINE', line(0, 0, 20, 0), ends, [10, 0]],
  ['LWPOLYLINE', light, vertices, [10, -4]],
  ['POLYLINE', poly, (e) => e.kids.filter((r) => r.type === 'VERTEX').map((r) => pair({ r })), [10, -4]],
  ['ARC', arc(0, 0, 20, 0, 90), ends, [Math.SQRT1_2 * 20, Math.SQRT1_2 * 20]],
  ['SPLINE', spline, (e) => [pair(e, 10), pair(e, 10, 1), pair(e, 11), pair(e, 11, 1)], [10, 0]],
  ['HATCH', hatch, (e) => GR.gripsOf(e).filter((g) => g.kind === 'vertex').map((g) => [g.x, g.y]), [10, 0]],
  ['DIMENSION', dimension, (e) => [10, 11, 13, 14].map((c) => pair(e, c)), [10, 10]],
  ['LEADER', leader, (e) => e.model.pts, [10, 0]],
  ['LEADER record', rawLeader, (e) => coords.map((_, i) => pair(e, 10, i)), [10, 0]],
  ['CIRCLE', circle(0, 0, 20), (e) => [pair(e)], [20, 0]],
  ['ELLIPSE', ellipse(0, 0, 20, 0, .5), (e) => [pair(e)], [20, 0]],
  ['TEXT', text(0, 0, 2, 'note'), (e) => [pair(e)], [10, 0]],
  ['MTEXT', sizedText, (e) => [pair(e)], [20, 0]],
  ['INSERT', block, (e) => [pair(e)], [20, 0]],
  ['POINT', entity('POINT', [[10, 0], [20, 0]]), (e) => [pair(e)], [20, 0]],
  ['IMAGE', entity('IMAGE', [[10, 0], [20, 0], [11, 2], [21, 0], [12, 0], [22, 2], [13, 20], [23, 20]]), (e) => [pair(e)], [20, 20]],
];

test('Stretch case grid: every defining-point type, union of boxes, picks, zero, groups and shared grip drags', () => {
  let cases = 0;
  for (const [name, ent, points, miss] of fixtures) {
    const original = structuredClone(ent), ps = points(ent);
    const bounds = enclosing(ps);
    const several = ps.slice(0, Math.min(2, ps.length));
    const scenarios = [
      ['before', [box(-100, -100, -90, -90)], []],
      ['one point', [around(ps[0])], [0]],
      ['several points', [enclosing(several)], several.map((_, i) => i)],
      ['all', [bounds], ps.map((_, i) => i)],
      ['missing defining points', [around(miss)], []],
      ['picked', [], ps.map((_, i) => i), new Set([0])],
      ['zero displacement', [bounds], [], new Set([0]), 0, 0],
    ];
    for (const [scenario, boxes, hotIn, picked = new Set(), dx = 3, dy = 4] of scenarios) {
      const msg = `${name}: ${scenario}`, input = structuredClone(boxes);
      // A native dimension never stretches: a box that cuts it leaves it unchanged.
      const hot = name === 'DIMENSION' && hotIn.length < ps.length ? [] : hotIn;
      const { next, moved, stretched } = stretchEntities({ entities: [ent], blocks: {} }, boxes, dx, dy, picked);
      const changed = hot.length > 0, whole = changed && hot.length === ps.length;
      assert.equal(next.size, +changed, msg);
      assert.equal(moved, +whole, msg); assert.equal(stretched, +(changed && !whole), msg);
      const result = next.get(0) || ent;
      nearPoints(points(result), ps.map((p, i) => hot.includes(i) ? [p[0] + dx, p[1] + dy] : p), msg);
      assert.deepEqual(ent, original, `${msg}: source untouched`);
      assert.deepEqual(boxes, input, `${msg}: boxes untouched`);
      if (name === 'LWPOLYLINE') assert.deepEqual(GR.lwVertices(result.r).map((p) => [p.b, p.ws, p.we]), GR.lwVertices(ent.r).map((p) => [p.b, p.ws, p.we]), msg);
      if (name === 'POLYLINE') assert.deepEqual(result.kids.map((r) => r.c.map((c, i) => [10, 20].includes(c) ? null : r.v[i])), ent.kids.map((r) => r.c.map((c, i) => [10, 20].includes(c) ? null : r.v[i])), msg);
      if (name === 'SPLINE' || name === 'IMAGE') {
        const keep = name === 'SPLINE' ? [40, 41, 12, 22] : [11, 21, 12, 22, 13, 23];
        assert.deepEqual(keep.map((c) => GR.get(result.r, c)), keep.map((c) => GR.get(ent.r, c)), msg);
      }
      if (['CIRCLE', 'ELLIPSE', 'TEXT', 'MTEXT', 'INSERT'].includes(name)) {
        const fixed = (e) => e.r.c.flatMap((c, i) => [10, 20, 30].includes(c) ? [] : [[c, e.r.v[i]]]);
        assert.deepEqual(fixed(result), fixed(ent), `${msg}: size, content and shape stay`);
      }
      if (name === 'LEADER' && hot.includes(3)) {
        const oldText = leaderGeometry(ent.model).text, newText = leaderGeometry(result.model).text;
        nearPoints([[newText.x, newText.y]], [[oldText.x + dx, oldText.y + dy]], `${msg}: text follows`);
      }
      cases++;
    }
  }
  const p = lwpoly(coords, { closed: true });
  const union = stretchEntities({ entities: [p], blocks: {} }, [box(-1, -1, 21, 1), box(-1, 19, 21, 21)], 20, 0);
  assert.equal(union.moved, 1); assert.equal(union.stretched, 0);
  nearPoints(vertices(union.next.get(0)), coords.map(([x, y]) => [x + 20, y]), 'two boxes cover all; no coincident intermediate drags');
  const raw = { entities: [line(0, 0, 20, 0), line(100, 0, 120, 0)], groups: [{ name: 'G', members: [0, 1], selectable: true }] };
  const before = structuredClone(raw), selected = new Set([0]);
  const group = stretchEntities(raw, [around([0, 0])], 3, 4);
  assert.deepEqual([...group.next.keys()], [0], 'the group mate outside stays');
  const nextEntities = raw.entities.map((e, i) => group.next.get(i) || e);
  assert.equal(nextEntities[1], raw.entities[1], 'the outside group mate retains its identity');
  assert.deepEqual(raw, before, 'group membership and source stay untouched');
  const picked = stretchEntities(raw, [], 3, 4, selected);
  assert.deepEqual([...picked.next.keys()], [0]); assert.equal(picked.moved, 1);
  assert.deepEqual([...selected], [0]);
  const mixed = stretchEntities(raw, [around([0, 0])], 3, 4, new Set([1]));
  assert.equal(mixed.moved, 1); assert.equal(mixed.stretched, 1); assert.equal(mixed.next.size, 2);
  const l = raw.entities[0], grips = GR.gripsOf(l).filter((g) => g.id !== 'm');
  const shared = stretchGrips(l, grips, 20, 0);
  assert.equal(shared.label, 'Move'); assert.equal(shared.part, false);
  nearPoints(ends(shared.ent), [[20, 0], [40, 0]], 'the existing all-hot rule moves whole');
  assert.throws(() => stretchEntities({ entities: [l], blocks: {} }, [], NaN, 0), /finite/);
  console.log(`Stretch grid: ${cases} type/scenario cases plus union, groups, mixed counts and shared-loop checks`);
});

test('Stretch: a native dimension moves whole with its block, or stays when a box cuts it', () => {
  const dim = entity('DIMENSION', [[2, '*D1'], [70, 1], [10, 20], [20, 20], [11, 0], [21, 20], [13, 0], [23, 0], [14, 20], [24, 0]]);
  const raw = { entities: [dim, line(0, 0, 20, 0)], blocks: { '*D1': { entities: [line(0, 0, 20, 0)] } } };
  const before = structuredClone(raw), blockLine = (r) => [GR.get(r.blocks['*D1'].entities[0].r, 10), GR.get(r.blocks['*D1'].entities[0].r, 20)];
  const cut = stretchEntities(raw, [around([0, 0])], 3, 4);
  assert.deepEqual([...cut.next.keys()], [1], 'cut by a box: the dimension is not in next');
  assert.equal(cut.blocks, raw.blocks, 'nothing moved whole in its block');
  const inside = stretchEntities(raw, [enclosing([[0, 0], [20, 20]])], 3, 4);
  assert.equal(inside.moved, 2); assert.equal(inside.stretched, 0);
  nearPoints([10, 11, 13, 14].map((c) => pair(inside.next.get(0), c)), [[23, 24], [3, 24], [3, 4], [23, 4]], 'definition points moved');
  nearPoints([blockLine(inside)], [[3, 4]], 'the *D block moved with it');
  const picked = stretchEntities(raw, [], 3, 4, new Set([0]));
  assert.deepEqual([...picked.next.keys()], [0]); assert.equal(picked.moved, 1);
  nearPoints([blockLine(picked)], [[3, 4]], 'picked: block moved');
  assert.deepEqual(raw, before, 'source drawing untouched');
});
