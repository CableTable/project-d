// guides.js — rulers and guidelines.   node guides.test.mjs
import assert from 'node:assert/strict';
import * as G from './web/guides.js';
import * as LD from './web/layoutdoc.js';
import { readDxf } from './web/drawing.js';
import { writeDxf } from './web/dxf-write.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }

test('cleanGuides: only real guides, positions kept, no more than the cap', () => {
  assert.deepEqual(G.cleanGuides([{ axis: 'x', mm: 250 }, { axis: 'y', mm: '600.5' }]), [{ axis: 'x', mm: 250 }, { axis: 'y', mm: 600.5 }]);
  assert.deepEqual(G.cleanGuides([null, 5, { axis: 'z', mm: 1 }, { axis: 'x' }, { axis: 'x', mm: 'abc' }, { axis: 'x', mm: '' }, { axis: 'y', mm: null }]), []);
  assert.deepEqual(G.cleanGuides('nope'), []);
  assert.deepEqual(G.cleanGuides([{ axis: 'x', mm: 1.23456789 }]), [{ axis: 'x', mm: 1.234568 }]);
  assert.equal(G.cleanGuides(Array.from({ length: 500 }, (_, i) => ({ axis: 'x', mm: i }))).length, G.MAX_GUIDES);
});

test('rulerTicks: a numbered mark about every 64 px, minor marks between', () => {
  // 0.77 px per mm (the sheet fitted in a window): 100 mm = 77 px, minor every 20 mm
  const t = G.rulerTicks(-50, 1150, 0.77);
  assert.equal(t.major, 100); assert.equal(t.minor, 20);
  assert.deepEqual(t.ticks.filter((k) => k.major).map((k) => k.v).slice(0, 4), [0, 100, 200, 300]);
  assert.equal(t.ticks.find((k) => k.v === 20).major, false);
  assert.equal(t.ticks[0].v, -40, 'from the first mark at or after lo');
  // zoomed in: 1 mm = 8 px
  const z = G.rulerTicks(0, 40, 8);
  assert.equal(z.major, 10); assert.equal(z.minor, 2);
  const zz = G.rulerTicks(0, 10, 40);
  assert.equal(zz.major, 2); assert.equal(zz.minor, 0.5);
  assert.deepEqual(zz.ticks.filter((k) => k.major).map((k) => k.v), [0, 2, 4, 6, 8, 10]);
  // zoomed far out and in: still sane
  assert.ok(G.rulerTicks(0, 1e6, 0.0005).ticks.length <= 4000);
  assert.equal(G.rulerTicks(5, 5, 1).ticks.length, 0);
  assert.equal(G.rulerTicks(0, 10, 0).ticks.length, 0);
  // negative side of the sheet
  assert.deepEqual(G.rulerTicks(-30, 30, 7).ticks.filter((k) => k.major).map((k) => k.v), [-30, -20, -10, 0, 10, 20, 30]);
});

test('tickLabel', () => {
  assert.equal(G.tickLabel(100), '100'); assert.equal(G.tickLabel(0.5), '0.5'); assert.equal(G.tickLabel(-0), '0'); assert.equal(G.tickLabel(2.0000001), '2');
});

test('snapBoxToGuides: edges and middle land on a guide within the tolerance', () => {
  const box = [100, 200, 200, 260];
  assert.deepEqual(G.snapBoxToGuides(box, [{ axis: 'x', mm: 102 }], 3), { dx: 2, dy: 0, hits: [{ axis: 'x', mm: 102 }] }, 'left edge');
  assert.equal(G.snapBoxToGuides(box, [{ axis: 'x', mm: 198 }], 3).dx, -2, 'right edge');
  assert.equal(G.snapBoxToGuides(box, [{ axis: 'x', mm: 151 }], 3).dx, 1, 'the middle');
  assert.equal(G.snapBoxToGuides(box, [{ axis: 'y', mm: 258 }], 3).dy, -2, 'top edge');
  assert.equal(G.snapBoxToGuides(box, [{ axis: 'y', mm: 230 }], 3).dy, 0, 'the middle already on it');
  assert.deepEqual(G.snapBoxToGuides(box, [{ axis: 'y', mm: 230 }], 3).hits, [{ axis: 'y', mm: 230 }]);
  assert.deepEqual(G.snapBoxToGuides(box, [{ axis: 'x', mm: 104 }, { axis: 'y', mm: 300 }], 3), { dx: 0, dy: 0, hits: [] }, 'out of reach');
  const both = G.snapBoxToGuides(box, [{ axis: 'x', mm: 101 }, { axis: 'y', mm: 262 }], 3);
  assert.deepEqual([both.dx, both.dy], [1, 2]); assert.equal(both.hits.length, 2);
  // the nearest of several
  assert.equal(G.snapBoxToGuides(box, [{ axis: 'x', mm: 98 }, { axis: 'x', mm: 101 }], 3).dx, 1);
  // a straight drag leaves an axis alone
  assert.deepEqual(G.snapBoxToGuides(box, [{ axis: 'x', mm: 101 }, { axis: 'y', mm: 262 }], 3, { skipY: true }).dy, 0);
  assert.deepEqual(G.snapBoxToGuides(box, [{ axis: 'x', mm: 101 }, { axis: 'y', mm: 262 }], 3, { skipX: true }).dx, 0);
});

test('freeSpot and guideText', () => {
  assert.equal(G.freeSpot([], 'y', 350), 350);
  assert.equal(G.freeSpot([{ axis: 'y', mm: 350 }, { axis: 'y', mm: 360 }], 'y', 350), 370);
  assert.equal(G.freeSpot([{ axis: 'x', mm: 350 }], 'y', 350), 350, 'another axis does not count');
  assert.equal(G.guideText({ axis: 'x', mm: 250 }), 'X 250.00'); assert.equal(G.guideText({ axis: 'y', mm: 350.5 }), 'Y 350.50');
});

test('guides are per layout and saved in the settings block; an old file has none', () => {
  const lay = LD.newLayout('g');
  assert.deepEqual(lay.s.guides, []); assert.equal(lay.s.guidesShow, true); assert.equal(lay.s.guidesLock, false);
  const other = LD.newLayout('h');
  lay.s.guides.push({ axis: 'x', mm: 250 }, { axis: 'y', mm: 600 });
  assert.deepEqual(other.s.guides, [], 'each layout has its own list');
  lay.s.guidesShow = false; lay.s.guidesLock = true;
  const back = LD.layoutFromRaw(readDxf(writeDxf(LD.layoutRaw(lay), { escapeUnicode: true })), 'g.dxf');
  assert.deepEqual(back.s.guides, [{ axis: 'x', mm: 250 }, { axis: 'y', mm: 600 }]);
  assert.equal(back.s.guidesShow, false); assert.equal(back.s.guidesLock, true);
  // a file written before guides existed
  const raw = readDxf(writeDxf(LD.layoutRaw(LD.newLayout('old')), { escapeUnicode: true }));
  const s = LD.cleanSettings({ sheetW: 800, sheetH: 500 });
  assert.deepEqual(s.guides, []); assert.equal(s.guidesShow, true); assert.equal(s.guidesLock, false);
  assert.ok(LD.layoutFromRaw(raw, 'old.dxf'));
  // odd guides in a file fall away
  assert.deepEqual(LD.cleanSettings({ guides: [{ axis: 'x', mm: 5 }, { axis: 'q', mm: 1 }, 'x'] }).guides, [{ axis: 'x', mm: 5 }]);
});

console.log(n + ' guides tests passed');
