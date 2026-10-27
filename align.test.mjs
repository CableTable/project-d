import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sheetAlignmentLines, partAlignmentLines, snapBoxToAlignment, alignmentSegments } from './web/align.js';
import { placedBox } from './web/apply.js';
import { unionBox } from './web/arrange.js';

const sheet = { sheetW: 1000, sheetH: 700 };
const lines = sheetAlignmentLines(sheet);
const snap = (box, guidelines = [], targets = lines, options) => snapBoxToAlignment(box, targets, guidelines, 6, options);

test('sheet candidates: edges and centres, without duplicate zero grippers', () => {
  assert.deepEqual(lines, [
    { axis: 'x', mm: 0, span: [0, 700] }, { axis: 'x', mm: 500, span: [0, 700] }, { axis: 'x', mm: 1000, span: [0, 700] },
    { axis: 'y', mm: 0, span: [0, 1000] }, { axis: 'y', mm: 350, span: [0, 1000] }, { axis: 'y', mm: 700, span: [0, 1000] },
  ]);
});

test('each dragged edge and centre snaps to each sheet edge and centre on either axis', () => {
  for (const [axis, targets, low, high] of [['x', [0, 500, 1000], 0, 2], ['y', [0, 350, 700], 1, 3]]) {
    for (const target of targets) for (const fraction of [0, .5, 1]) {
      const box = [200, 200, 280, 280];
      box[low] = target - 80 * fraction + 2; box[high] = box[low] + 80;
      const s = snap(box);
      assert.equal(s[axis === 'x' ? 'dx' : 'dy'], -2);
      assert.deepEqual(s.hits, [lines.find((l) => l.axis === axis && l.mm === target)]);
    }
  }
});

test('all four gripper inner edges use y-up coordinates and their finite usable spans', () => {
  const grippers = sheetAlignmentLines({ ...sheet, gripLeft: 25, gripRight: 35, gripBottom: 45, gripTop: 55 });
  assert.deepEqual(grippers.slice(6), [
    { axis: 'x', mm: 25, span: [45, 645] }, { axis: 'x', mm: 965, span: [45, 645] },
    { axis: 'y', mm: 45, span: [25, 965] }, { axis: 'y', mm: 645, span: [25, 965] },
  ]);
  for (const target of grippers.slice(6)) {
    const box = target.axis === 'x' ? [target.mm + 2, 200, target.mm + 82, 280] : [200, target.mm + 2, 280, target.mm + 82];
    const s = snap(box, [], grippers);
    assert.equal(s[target.axis === 'x' ? 'dx' : 'dy'], -2);
    assert.deepEqual(s.hits, [target]);
  }
});

test('nearest wins independently on each axis; Guidelines win ties, including exact overlaps', () => {
  const x = { axis: 'x', mm: 4 }, y = { axis: 'y', mm: 4 };
  assert.deepEqual(snap([2, 2, 82, 82], [x, y]), { dx: 2, dy: 2, hits: [x, y] });
  assert.deepEqual(snap([0, 200, 80, 280], [{ axis: 'x', mm: 0 }]).hits, [{ axis: 'x', mm: 0 }]);
  assert.equal(snap([1, 200, 81, 280], [x]).dx, -1, 'closer sheet beats Guideline');
  assert.equal(snap([3, 200, 83, 280], [x]).dx, 1, 'closer Guideline beats sheet');
  assert.deepEqual(snap([1, 2, 81, 82], [x, y]), { dx: -1, dy: 2, hits: [lines[0], y] });
});

test('six-pixel tolerance is inclusive, scales with zoom, and Shift skips the fixed axis', () => {
  assert.equal(snap([6, 200, 86, 280]).dx, -6);
  assert.deepEqual(snap([6.001, 200, 86.001, 280]), { dx: 0, dy: 0, hits: [] });
  assert.equal(snapBoxToAlignment([4, 200, 84, 280], lines, [], 6 / 2).hits.length, 0);
  assert.equal(snapBoxToAlignment([4, 200, 84, 280], lines, [], 6 / .5).dx, -4);
  assert.deepEqual(snap([2, 2, 82, 82], [], lines, { skipX: true }), { dx: 0, dy: -2, hits: [lines[3]] });
  assert.deepEqual(snap([2, 2, 82, 82], [], lines, { skipY: true }), { dx: -2, dy: 0, hits: [lines[0]] });
});

test('several rotated / mirrored parts snap as one upright box', () => {
  const part = { w: 80, h: 40 };
  const box = unionBox([
    placedBox(part, { x: 42, y: 200, rot: 90 }),
    placedBox(part, { x: 152, y: 260, mirrorX: true }),
  ]);
  assert.deepEqual(box, [2, 200, 152, 300]);
  assert.equal(snap(box).dx, -2);
  assert.equal(snap([box[0] + 423, box[1], box[2] + 423, box[3]]).dx, 0, 'union centre already at sheet centre');
  assert.equal(snap([box[0] + 422, box[1], box[2] + 422, box[3]]).dx, 1);
});

test('Alignment guide spans box and target, stops there, and excludes Guidelines', () => {
  assert.deepEqual(alignmentSegments([0, -40, 80, 40], [lines[0]]), [[0, -40, 0, 700]]);
  assert.deepEqual(alignmentSegments([980, 350, 1060, 430], [lines[4]]), [[0, 350, 1060, 350]]);
  assert.deepEqual(alignmentSegments([0, 200, 80, 280], [{ axis: 'x', mm: 0 }]), []);
});

const parts = { plate: { w: 80, h: 40 } };
const all = () => true;

test('part edges and centres on both axes snap each dragged edge and centre; guide joins only their extents', () => {
  const targets = partAlignmentLines(parts, [{ partId: 'plate', x: 200, y: 400 }], all);
  assert.deepEqual(targets, [
    { axis: 'x', mm: 200, span: [400, 440] }, { axis: 'x', mm: 240, span: [400, 440] }, { axis: 'x', mm: 280, span: [400, 440] },
    { axis: 'y', mm: 400, span: [200, 280] }, { axis: 'y', mm: 420, span: [200, 280] }, { axis: 'y', mm: 440, span: [200, 280] },
  ]);
  for (const target of targets) for (const fraction of [0, .5, 1]) {
    const box = [600, 100, 660, 160], low = target.axis === 'x' ? 0 : 1;
    box[low] = target.mm - 60 * fraction + 2; box[low + 2] = box[low] + 60;
    const s = snap(box, [], targets);
    assert.equal(s[low === 0 ? 'dx' : 'dy'], -2);
    assert.deepEqual(s.hits, [target]);
  }
  assert.deepEqual(alignmentSegments([200, 100, 260, 160], [targets[0]]), [[200, 100, 200, 440]]);
  assert.deepEqual(alignmentSegments([600, 400, 660, 460], [targets[3]]), [[200, 400, 660, 400]]);
});

test('eligibility excludes dragged originals (including copy), hidden and locked parts before building targets', () => {
  const placed = [
    { partId: 'plate', x: 100, y: 100 }, { partId: 'plate', x: 200, y: 100 },
    { partId: 'hidden', x: 300, y: 100 }, { partId: 'plate', x: 400, y: 100, lock: true },
    { partId: 'plate', x: 500, y: 100 },
  ];
  const dragged = new Set([0, 1]), hidden = new Set(['hidden']);
  const targets = partAlignmentLines(parts, placed, (p, i) => !dragged.has(i) && !hidden.has(p.partId) && !p.lock);
  assert.deepEqual(targets, partAlignmentLines(parts, [placed[4]], all));
  assert.deepEqual(partAlignmentLines(parts, placed, () => false), [], 'hidden Parts display has no candidates');
});

test('ties choose sheet / gripper, then parts in layout order; Guidelines precede all; nearer still wins', () => {
  const targets = partAlignmentLines(parts, [{ partId: 'plate', x: 4, y: 400 }, { partId: 'plate', x: 0, y: 500 }], all);
  const box = [2, 200, 82, 260], combined = [...lines, ...targets];
  assert.deepEqual(snap(box, [], combined), { dx: -2, dy: 0, hits: [lines[0]] });
  assert.deepEqual(snap(box, [], targets), { dx: 2, dy: 0, hits: [targets[0]] });
  const guideline = { axis: 'x', mm: 4 };
  assert.deepEqual(snap(box, [guideline], combined), { dx: 2, dy: 0, hits: [guideline] });
  assert.deepEqual(snap([0, 200, 80, 260], [{ axis: 'x', mm: 0 }], combined).hits, [{ axis: 'x', mm: 0 }]);
  assert.deepEqual(snap([3, 200, 83, 260], [], combined).hits, [targets[0]], 'nearer part beats sheet');
  const grippers = sheetAlignmentLines({ ...sheet, gripLeft: 30 });
  const part = partAlignmentLines(parts, [{ partId: 'plate', x: 34, y: 400 }], all);
  assert.deepEqual(snap([32, 200, 92, 260], [], [...grippers, ...part]).hits, [grippers[6]]);
  const overlap = partAlignmentLines(parts, [{ partId: 'plate', x: 0, y: 400 }], all);
  assert.deepEqual(snap([0, 200, 80, 260], [], [...lines, ...overlap]).hits, [lines[0]], 'sheet wins exact overlap');
});

test('a rotated target uses its upright box, including the finite span', () => {
  const target = { partId: 'plate', x: 240, y: 400, rot: 45 };
  const targets = partAlignmentLines(parts, [target], all), box = placedBox(parts.plate, target);
  assert.ok(Math.abs(box[0] - (240 - 40 / Math.sqrt(2))) < 1e-8);
  assert.deepEqual(targets.map((l) => l.mm), [box[0], (box[0] + box[2]) / 2, box[2], box[1], (box[1] + box[3]) / 2, box[3]]);
  assert.deepEqual(targets[0].span, [box[1], box[3]]);
  assert.deepEqual(snap([box[0] + 2, 100, box[0] + 62, 160], [], targets), { dx: -2, dy: 0, hits: [targets[0]] });
});
