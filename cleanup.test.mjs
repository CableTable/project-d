import test from 'node:test';
import assert from 'node:assert/strict';
import { removeDuplicates, preflight, hairline } from './web/cleanup.js';
import { newDoc, addEntities, addLayer, line, arc, circle, lwpoly, text, writeDxf, insert } from './web/dxf-write.js';
import { readDxf } from './web/drawing.js';
import { shapeOf } from './web/grips.js';
import { joinGaps, findGaps } from './web/edit.js';
import { checkIndex } from './web/cleanup.js';
import { withWidth } from './web/props.js';

const doc = (...ents) => { const d = newDoc(); addEntities(d, ...ents); return d; };
const rows = (d, options = {}) => Object.fromEntries(preflight(d, { sheetW: 100, sheetH: 100, ...options }).map((r) => [r.id, r]));

test('exact duplicates count redundant entities, keep one original and do not mutate input', () => {
  const d = doc(line(0, 0, 10, 0), line(0, 0, 10, 0), line(0, 0, 10, 0));
  const before = structuredClone(d), r = removeDuplicates(d);
  assert.equal(r.count, 2); assert.deepEqual(r.offenders, [1, 2]);
  assert.equal(r.entities[0], d.entities[0]); assert.equal(r.entities.length, 1);
  assert.deepEqual(d, before);
});
test('reversed lines are redundant; touching and parallel lines are not', () => {
  const d = doc(line(0, 0, 10, 0), line(10, 0, 0, 0), line(10, 0, 20, 0), line(0, 1, 10, 1));
  assert.deepEqual(removeDuplicates(d).offenders, [1]);
});
test('partial overlap trims the later line to the non-overlapping part', () => {
  const d = doc(line(0, 0, 10, 0), line(5, 0, 15, 0));
  const r = removeDuplicates(d);
  assert.equal(r.count, 1); assert.equal(r.entities[0], d.entities[0]);
  assert.deepEqual(shapeOf(r.entities[1]), { t: 'line', a: [10, 0], b: [15, 0] });
  assert.equal(removeDuplicates({ ...d, entities: r.entities }).count, 0);
});
test('interior overlap splits a reversed line without dropping either tail', () => {
  const r = removeDuplicates(doc(line(3, 0, 7, 0), line(10, 0, 0, 0)));
  assert.equal(r.count, 1); assert.equal(r.entities.length, 3);
  assert.deepEqual(r.entities.slice(1).map((e) => shapeOf(e)), [{ t: 'line', a: [10, 0], b: [7, 0] }, { t: 'line', a: [3, 0], b: [0, 0] }]);
});
test('other layers, spaces, elevations and ineligible entities stay alone', () => {
  const a = line(0, 0, 10, 0), b = line(0, 0, 10, 0, { layer: 'Other' }), c = { ...a, ps: true };
  const z = structuredClone(a); z.r.v[z.r.c.indexOf(30)] = '1'; z.r.v[z.r.c.indexOf(31)] = '1';
  const d = doc(a, b, c, z);
  assert.equal(removeDuplicates(d).count, 0);
  assert.equal(removeDuplicates(doc(a, { ...a }), () => false).count, 0);
});
test('arcs: exact, partial overlap and wrap through zero', () => {
  let d = doc(arc(0, 0, 10, 0, 90), arc(0, 0, 10, 0, 90), arc(0, 0, 10, 45, 135));
  let r = removeDuplicates(d);
  assert.equal(r.count, 2); assert.equal(r.entities[0], d.entities[0]);
  let sh = shapeOf(r.entities[1]);
  assert.ok(Math.abs(sh.a0 - 90) < 1e-7 && Math.abs(sh.a1 - 135) < 1e-7);
  d = doc(arc(0, 0, 10, 300, 30), arc(0, 0, 10, 0, 90)); r = removeDuplicates(d); sh = shapeOf(r.entities[1]);
  assert.equal(r.count, 1); assert.ok(Math.abs(sh.a0 - 30) < 1e-7 && Math.abs(sh.a1 - 90) < 1e-7);
  assert.equal(removeDuplicates({ ...d, entities: r.entities }).count, 0);
});
test('circle coverage removes arcs and trims later circles', () => {
  assert.equal(removeDuplicates(doc(circle(0, 0, 10), arc(0, 0, 10, 20, 80))).count, 1);
  const d = doc(arc(0, 0, 10, 20, 80), circle(0, 0, 10));
  const r = removeDuplicates(d);
  assert.equal(r.count, 1); assert.equal(removeDuplicates({ ...d, entities: r.entities }).count, 0);
});
test('polyline segments are trimmed, preserving widths and layer', () => {
  const d = doc(line(0, 0, 10, 0, { layer: 'Cut' }), lwpoly([[5, 0], [15, 0], [15, 5]], { layer: 'Cut', width: .3 }));
  const r = removeDuplicates(d), sh = shapeOf(r.entities[1]);
  assert.equal(r.count, 1); assert.equal(r.entities[1].layer, 'Cut');
  assert.deepEqual(sh.pts.map((p) => p.slice(0, 2)), [[10, 0], [15, 0], [15, 5]]);
  assert.ok(r.entities[1].r.v.includes('0.3'));
});
test('parsed duplicates with different handles are removed', () => {
  const d = readDxf(writeDxf(doc(line(0, 0, 10, 0), line(0, 0, 10, 0))));
  assert.equal(removeDuplicates(d).count, 1);
});
test('preflight six rows: duplicates, name-based Cut, tiny gap, off-sheet, width and text', () => {
  const d = doc(line(10, 10, 20, 10, { layer: 'laser CUT' }), line(20.005, 10, 30, 10, { layer: 'laser CUT' }),
    line(40, 40, 50, 40), line(40, 40, 50, 40), circle(105, 10, 1), text(10, 30, 2, 'Live'));
  const before = structuredClone(d), r = rows(d);
  assert.equal(Object.keys(r).length, 6);
  assert.equal(r.duplicates.count, 1); assert.deepEqual(r.open.offenders, [0, 1]);
  assert.equal(r.gaps.count, 1); assert.deepEqual(r.gaps.offenders, [0, 1]);
  assert.deepEqual(r.offsheet.offenders, [4]); assert.equal(r.wide.count, 5);
  assert.deepEqual(r.text.offenders, [5]); assert.deepEqual(d, before);
});
test('a Cut loop made of separate lines is closed, an open chain selects every member', () => {
  const opts = { layer: 'Cut' };
  const d = doc(line(0, 0, 10, 0, opts), line(10, 0, 10, 10, opts), line(10, 10, 0, 10, opts), line(0, 10, 0, 0, opts));
  assert.equal(rows(d).open.count, 0);
  d.entities.pop(); assert.deepEqual(rows(d).open.offenders, [0, 1, 2]);
});
test('Cut endpoints do not close against non-Cut paths', () => {
  const d = doc(line(0, 0, 10, 0, { layer: 'cut' }), line(10, 0, 0, 0));
  assert.deepEqual(rows(d).open.offenders, [0]);
});
test('tolerance is mm, and Joining uses the existing gap repair', () => {
  const d = doc(line(0, 0, 1, 0), line(1.001, 0, 2, 0));
  assert.equal(rows(d, { factor: 25.4, tolerance: .01 }).gaps.count, 0);
  assert.equal(rows(d, { factor: 25.4, tolerance: .05 }).gaps.count, 1);
  const ed = checkIndex(d), next = joinGaps(d, ed, findGaps(ed, .05 / 25.4));
  assert.equal(rows({ ...d, ...next }, { factor: 25.4, tolerance: .05 }).gaps.count, 0);
});
test('physical Hairline threshold includes layer/vertex widths; repair clears widths', () => {
  const d = doc(line(1, 1, 2, 1, { lw: 5 }), line(1, 2, 2, 2, { layer: 'Wide' }), lwpoly([[1, 3], [2, 3]], { width: .1 }));
  addLayer(d, 'Wide', { lw: 50 });
  assert.deepEqual(rows(d).wide.offenders, [1, 2]);
  const fixed = { ...d, entities: d.entities.map((e) => withWidth(e, 'Hairline')) };
  assert.equal(rows(fixed).wide.count, 0);
});
test('hidden entities/layers are checked; closed polylines and circles are not open paths', () => {
  const d = doc({ ...text(5, 5, 2, 'Hidden'), hidden: true }, circle(5, 5, 1, { layer: 'Cut' }), lwpoly([[1, 1], [2, 1], [2, 2]], { layer: 'Cut', closed: true }));
  addLayer(d, 'Cut', { off: true });
  assert.equal(rows(d).open.count, 0); assert.equal(rows(d).text.count, 1);
});
test('empty drawing has zero flags and off-sheet edges use physical units', () => {
  assert.ok(Object.values(rows(newDoc())).every((r) => r.count === 0));
  const d = doc(line(0, 0, 1, 0, { lw: 5 }));
  assert.equal(rows(d, { factor: 25.4, sheetW: 25.4 }).offsheet.count, 0);
  assert.equal(rows(d, { factor: 25.4, sheetW: 20 }).offsheet.count, 1);
});

test('drawing tabs have no sheet; each targeted check agrees with a full preflight', () => {
  const d = doc(line(-1, 0, 1, 0), line(-1, 0, 1, 0), text(200, 200, 2, 'Outside'));
  const options = { factor: 25.4, tolerance: .05 };
  const all = preflight(d, options);
  assert.equal(all.find((r) => r.id === 'offsheet').count, null);
  assert.deepEqual(all.find((r) => r.id === 'offsheet').offenders, []);
  for (const row of all) assert.deepEqual(preflight(d, { ...options, check: row.id }), [row]);
  const sheet = { ...options, sheetW: 100, sheetH: 100 };
  for (const row of preflight(d, sheet)) assert.deepEqual(preflight(d, { ...sheet, check: row.id }), [row]);
});

test('targeted width and text checks skip duplicate geometry comparisons', () => {
  const d = doc(line(0, 0, 10, 0, { lw: 50 }), text(0, 5, 1, 'Live'));
  // Duplicate comparison reads every raw field; these checks only need flattened geometry.
  d.entities[0].r.c.push(999);
  d.entities[0].r.v.push({ toString() { throw new Error('duplicate scan ran'); } });
  assert.deepEqual(preflight(d, { check: 'wide' })[0].offenders, [0]);
  assert.deepEqual(preflight(d, { check: 'text' })[0].offenders, [1]);
});
test('partial cleanup preserves elevated lines/arcs and their original properties', () => {
  const d = doc(line(0, 0, 10, 0), line(5, 0, 15, 0), arc(0, 0, 10, 0, 90), arc(0, 0, 10, 45, 135));
  for (const e of d.entities) for (const c of [30, 31]) if (e.r.c.includes(c)) e.r.v[e.r.c.indexOf(c)] = '7';
  const r = removeDuplicates(d);
  assert.equal(r.count, 2);
  for (const e of r.entities) assert.equal(e.r.v[e.r.c.indexOf(30)], '7');
  assert.equal(r.entities[1].r.v[r.entities[1].r.c.indexOf(31)], '7');
});
test('Hairline fixes nested explicit/constant widths, skips locks, and leaves other block instances alone', () => {
  const d = doc(insert('Wide', 0, 0), insert('Wide', 50, 0), line(0, 20, 5, 20, { layer: 'Locked', lw: 100 }));
  d.blocks.Wide = { base: [0, 0], entities: [line(1, 1, 5, 1, { lw: 50 }), lwpoly([[1, 2], [5, 2]], { width: 1 })] };
  const original = structuredClone(d), fixed = { ...d, ...hairline(d, [0, 2], new Set(['Locked'])) };
  assert.deepEqual(rows(fixed).wide.offenders, [1, 2]);
  assert.equal(fixed.entities[1], d.entities[1]); assert.deepEqual(d, original);
});
test('Cut names on block members are checked in world coordinates; closed block loops stay clear', () => {
  const d = doc(insert('Paths', 10, 10));
  d.blocks.Paths = { base: [0, 0], entities: [line(0, 0, 10, 0, { layer: 'laser cut' }), circle(10, 10, 1, { layer: 'laser cut' })] };
  assert.deepEqual(rows(d).open.offenders, [0]);
  d.blocks.Paths.entities.shift();
  assert.equal(rows(d).open.count, 0);
});
