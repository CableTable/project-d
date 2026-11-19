import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outsideView, subPixel, snapPlace, snapUsable, heavy } from './web/perf.js';
import * as perf from './web/perf.js';
import { paintDrawing } from './web/render.js';
import { bigDoc } from './tools/gen-big-dxf.mjs';
import { writeDxf } from './web/dxf-write.js';
import { readDxf, flatten, mapply } from './web/drawing.js';

test('sameBase: equal arrays, length change, one element change', () => {
  const doc = {}, a = [doc, 10, 20, 2, 'light', null];
  assert.equal(perf.sameBase([], []), true);
  assert.equal(perf.sameBase(a, [...a]), true);
  assert.equal(perf.sameBase(a, [...a, 1]), false);
  assert.equal(perf.sameBase([...a, 1], a), false);
  for (let i = 0; i < a.length; i++) {
    const b = [...a]; b[i] = i === 0 ? {} : 'changed';
    assert.equal(perf.sameBase(a, b), false);
  }
  assert.equal(perf.sameBase([NaN], [NaN]), false);
});

test('outsideView is conservative: a box touching or overlapping the view, or reaching it through its pad, is kept', () => {
  const vr = [0, 0, 100, 100];
  assert.equal(outsideView([10, 10, 20, 20], 0, vr), false);
  assert.equal(outsideView([100, 100, 110, 110], 0, vr), false);      // touching a corner
  assert.equal(outsideView([-50, -50, 150, 150], 0, vr), false);      // bigger than the view
  assert.equal(outsideView([101, 10, 110, 20], 0, vr), true);
  assert.equal(outsideView([101, 10, 110, 20], 1.5, vr), false);      // a fat stroke reaches in
  assert.equal(outsideView([10, -20, 20, -1], 0, vr), true);
});

test('subPixel only for boxes under half a pixel in both directions', () => {
  assert.equal(subPixel([0, 0, 1, 1], 0, 0.3), true);
  assert.equal(subPixel([0, 0, 10, 0.1], 0, 0.3), false);             // a long thin line stays
  assert.equal(subPixel([0, 0, 1, 1], 0.1, 0.3), true);
  assert.equal(subPixel([0, 0, 1, 1], 5, 0.3), false);
});

test('TODO 328b: the quick paint after a layer toggle skips boxes under 1 px, every other paint 0.4 px', () => {
  assert.equal(perf.QUICK_PX, 1);
  assert.equal(subPixel([0, 0, 1, 1], 0, 0.7), false);                 // 0.7 px: drawn by the normal paint
  assert.equal(subPixel([0, 0, 1, 1], 0, 0.7, perf.QUICK_PX), true);   // and skipped by the quick one
  assert.equal(subPixel([0, 0, 10, 0.1], 0, 0.7, perf.QUICK_PX), false);   // a long thin line stays
  assert.equal(subPixel([0, 0, 1, 1], 0, 1, perf.QUICK_PX), false);    // exactly 1 px stays
  assert.equal(subPixel([0, 0, 1, 1], 0, 0.3), true);                  // the default is still 0.4
  const c = { setTransform() {}, clearRect() {}, beginPath() {}, stroke() {}, fill() {}, save() {}, restore() {}, clip() {}, fillRect() {}, setLineDash() {}, moveTo() {}, lineTo() {}, arc() {}, closePath() {} };
  const it = { k: 'p', ops: [0, 0, 0, 1, 1, 1], b: [0, 0, 1, 1], L: [0], m: 0, css: '#000000', fam: [] }, fl = { items: [it], mats: [[1, 0, 0, 1, 0, 0]], boxes: { model: it.b } };
  const draw = (o) => paintDrawing({ getContext: () => c }, { fl, off: new Set(), factor: 1, sheetH: 0, ox: 0, oy: 0, scale: 0.7, dpr: 1, w: 200, h: 200, ...o });
  assert.equal(draw({}), 1, 'a 0.7 px item is drawn by the normal paint');
  assert.equal(draw({ minPx: perf.QUICK_PX }), 0, 'and left out by the quick paint');
});

test('skipPoint keeps run ends and stays within half a pixel', () => {
  assert.equal(typeof perf.skipPoint, 'function');
  for (const [dx, dy, k, want] of [[0, 0, 0, false], [.49, 0, 1, true], [.5, 0, 1, false],
    [.3, .4, 1, false], [-.3, -.3, 1, true], [.1, 0, 5, false], [.1, 0, 4, true]]) {
    assert.equal(perf.skipPoint(dx, dy, k), want);
  }
  const round = (x) => Math.round(x * 1e9) / 1e9;
  const paint = (ops, { kind = 'p', fill = false, dash, dpx, matrix = [1, 0, 0, 1, 0, 0], scale = 1, dpr = 1, slots, highlight = false, wireframe = false } = {}) => {
    const calls = [], c = {
      setTransform(...m) { this.m = m; }, clearRect() {}, beginPath() {}, fill() {},
      save() {}, restore() {}, clip() {}, fillRect() {}, setLineDash() {},
      moveTo(x, y) { calls.push(['M', ...mapply(this.m, x, y).map(round)]); },       // rounded: the overlay's paths start at their run's corner, not the view's origin (329a)
      lineTo(x, y) { calls.push(['L', ...mapply(this.m, x, y).map(round)]); },
      arc() { calls.push(['A']); }, closePath() { calls.push(['Z']); },
      stroke(p) { if (p) for (const f of p.fns) this[f[0]](...f.slice(1)); }       // the selection overlay's Path2D (TODO 329a): replayed under the matrix set before the stroke
    };
    globalThis.Path2D = class { fns = []; moveTo(...a) { this.fns.push(['moveTo', ...a]); } lineTo(...a) { this.fns.push(['lineTo', ...a]); } arc(...a) { this.fns.push(['arc', ...a]); } closePath() { this.fns.push(['closePath']); } rect() {} };
    const it = { k: kind, ops, b: [-50, -50, 50, 50], L: [0], m: 0, css: '#000000', fill, dash, dpx, fam: [] };
    const fl = { items: highlight ? [] : [it], mats: [matrix], boxes: { model: it.b } };
    paintDrawing({ getContext: () => c }, { fl, off: new Set(), factor: 1, sheetH: 0, ox: 0, oy: 0,
      scale, dpr, w: 200, h: 200, slots, hl: highlight ? [it] : [], wireframe });
    return calls;
  };
  const shearOps = Array.from({ length: 11 }, (_, i) => [i ? 1 : 0, i * .1, i * .1]).flat();
  for (const highlight of [false, true]) {
    const matrix = [1, .2, 1, .2, 0, 0];
    const full = paint(shearOps, { matrix, dpx: [6, 4] }), kept = paint(shearOps, { matrix, highlight });
    let last = kept[0], skipped = 0;
    for (const p of full.slice(1)) {
      if (kept.some((q) => q[1] === p[1] && q[2] === p[2])) last = p;
      else {
        skipped++;
        assert.ok(Math.hypot(p[1] - last[1], p[2] - last[2]) < .5, 'every skipped point under shear stays within half a device pixel of the last drawn point');
      }
    }
    assert.ok(skipped > 0, 'sheared paths still skip sub-pixel points');
  }
  const tiny = [0, 0, 0, 1, .1, 0, 1, .2, 0];
  for (const tail of [[], [0, .21, 0, 1, .3, 0, 1, .4, 0], [2, 1, 0, 1, 0, 1, 0, 1, 1.1, 0, 1, 1.2, 0], [3, 1, .1, 0, 1, .2, 0]]) {
    const full = paint([...tiny, ...tail], { dpx: [6, 4] }), kept = paint([...tiny, ...tail]);
    assert.deepEqual(kept, full.filter((_, i) => i !== 1 && !(tail[0] === 0 && i === 4)), 'reset at every move; keep ends before moves, arcs, closes and end of ops');
  }
  const points = Array.from({ length: 401 }, (_, i) => [i * .025, Math.sin(i * .3) * .12]);
  points.push([10.01, points.at(-1)[1]]);
  const ops = points.flatMap((p, i) => [i ? 1 : 0, ...p]);
  const dist = (p, a, b) => {
    const dx = b[1] - a[1], dy = b[2] - a[2], len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p[1] - a[1]) * dx + (p[2] - a[2]) * dy) / len)) : 0;
    return Math.hypot(p[1] - a[1] - t * dx, p[2] - a[2] - t * dy);
  };
  for (const options of [{}, { scale: 8, dpr: 2 }, { matrix: [0, 10, -.1, 0, 0, 0] },
    { matrix: [.1, 0, 0, 10, 0, 0] }, { slots: [[12, 0, 0, -2, 0, 100]] },
    { fill: true }, { kind: 'w' }, { kind: 'h' }, { highlight: true },
    { highlight: true, matrix: [0, 10, -.1, 0, 0, 0] }, { wireframe: true }]) {
    const full = paint(ops, { ...options, kind: 'p', fill: false, highlight: false, wireframe: false, dpx: [6, 4] });
    const kept = paint(ops, options);
    assert.ok(kept.length < full.length, 'all trace callers skip short pieces: ' + JSON.stringify(options));
    assert.deepEqual(kept[0], full[0]); assert.deepEqual(kept.at(-1), full.at(-1), 'the final point is always drawn');
    let start = 0;
    for (let i = 1; i < kept.length; i++) {
      const end = full.findIndex((p, j) => j > start && p[1] === kept[i][1] && p[2] === kept[i][2]);
      assert.ok(end > start, 'kept points stay in path order');
      for (let j = start; j <= end; j++) assert.ok(dist(full[j], kept[i - 1], kept[i]) < .5, 'original line stays within half a device pixel of its chord');
      for (let t = 0; t <= 1; t += .1) {
        const p = ['L', kept[i - 1][1] * (1 - t) + kept[i][1] * t, kept[i - 1][2] * (1 - t) + kept[i][2] * t];
        assert.ok(Math.min(...full.slice(start, end).map((a, j) => dist(p, a, full[start + j + 1]))) < .5, 'drawn chord stays within half a device pixel of the original line');
      }
      start = end;
    }
  }
  for (const options of [{ dash: [6, 4] }, { dpx: [6, 4] }]) {
    assert.equal(paint(ops, options).length, points.length, 'dashed batches keep every point and their dash phase');
  }
  assert.equal(paint(ops, { scale: 1000 }).length, points.length, 'zooming in redraws the original pieces');
});

test('snapPlace: the same view is the identity; a pan shifts; a zoom about a point keeps that point', () => {
  const a = { ox: 10, oy: 20, scale: 2 };
  assert.deepEqual(snapPlace(a, a), { dx: 0, dy: 0, r: 1 });
  assert.deepEqual(snapPlace(a, { ox: 15, oy: 20, scale: 2 }), { dx: -10, dy: 0, r: 1 });
  // zoom x2 about canvas point (100, 50): the sheet point under it must not move on screen
  const mx = a.ox + 100 / a.scale, my = a.oy + 50 / a.scale, b = { scale: 4 };
  b.ox = mx - 100 / b.scale; b.oy = my - 50 / b.scale;
  const p = snapPlace(a, b);
  assert.equal(100 * p.r + p.dx, 100); assert.equal(50 * p.r + p.dy, 50);
});

test('snapUsable accepts a canvas size or DPR change and still limits zoom', () => {
  const s = { view: { ox: 0, oy: 0, scale: 1 }, w: 100, h: 80 };
  assert.equal(snapUsable(s, { view: { ox: 5, oy: 0, scale: 2 }, w: 100, h: 80 }), true);
  assert.equal(snapUsable(s, { view: { ox: 0, oy: 0, scale: 1 }, w: 101, h: 80 }), true);
  assert.equal(snapUsable(s, { view: s.view, w: 200, h: 160 }), true);
  assert.equal(snapUsable(s, { view: { ox: 0, oy: 0, scale: 30 }, w: 100, h: 80 }), false);
  assert.equal(snapUsable(null, s), false);
});

test('blitCovers: a shifted bitmap shows nothing its canvas did not hold', () => {
  const inside = [100, 100, 200, 200], w = 400, h = 300;
  assert.equal(perf.blitCovers(inside, 50, -30, w, h), true, 'a picture inside the canvas stays inside');
  assert.equal(perf.blitCovers(inside, 400, 0, w, h), true, 'shifted out of the canvas: nothing shows');
  assert.equal(perf.blitCovers([300, 100, 500, 200], 200, 0, w, h), true, 'the cut-off part moves away from the view');
  assert.equal(perf.blitCovers([300, 100, 500, 200], -100, 0, w, h), false, 'the part outside on the right slides into view');
  assert.equal(perf.blitCovers([-50, 100, 50, 200], 20, 0, w, h), false, 'the part outside on the left slides into view');
  assert.equal(perf.blitCovers([-50, 100, 50, 200], -20, 0, w, h), true, 'it moves further out of the view');
  assert.equal(perf.blitCovers(null, 0, 0, w, h), true, 'no shift needs no box');
  assert.equal(perf.blitCovers(null, 1, 0, w, h), false, 'an unknown box is not trusted once shifted');
});

test('panStrips: the shifted bitmap plus the strips cover the canvas once', () => {
  const w = 40, h = 30, area = ([a, b, c, d]) => (c - a) * (d - b);
  for (const [dx, dy] of [[5, 7], [-5, 7], [5, -7], [-5, -7], [0, 7], [5, 0], [0, -7]]) {
    const strips = perf.panStrips(dx, dy, w, h), seen = new Set();
    for (const [x0, y0, x1, y1] of strips) for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) { assert.ok(!seen.has(x + ',' + y), 'no pixel twice'); seen.add(x + ',' + y); }
    const kept = (w - Math.abs(dx)) * (h - Math.abs(dy));
    assert.equal(seen.size + kept, w * h, `${dx},${dy}: strips + the reused bitmap fill the canvas`);
    for (const r of strips) assert.ok(r[0] >= 0 && r[1] >= 0 && r[2] <= w && r[3] <= h && area(r) > 0, 'inside the canvas');
    for (const [x, y] of [[0, 0], [w - 1, h - 1], [0, h - 1], [w - 1, 0]]) {            // a corner is either in a strip or still covered by the moved bitmap
      const moved = x - dx >= 0 && x - dx < w && y - dy >= 0 && y - dy < h;
      assert.equal(seen.has(x + ',' + y), !moved, `${dx},${dy} corner ${x},${y}`);
    }
  }
  assert.deepEqual(perf.panStrips(0, 0, w, h), [], 'no move, nothing to paint');
  assert.equal(perf.panStrips(w, 0, w, h), null, 'moved by a whole canvas: nothing to reuse');
  assert.equal(perf.panStrips(3, -h, w, h), null);
});

test('heavy: slow script or many items; a small quick drawing always repaints in full', () => {
  assert.equal(heavy(3, 200), false);
  assert.equal(heavy(40, 200), true);
  assert.equal(heavy(3, 20000), true);
});

test('the generator makes the asked number of mixed entities and the file reads back', () => {
  const doc = bigDoc(600);
  assert.equal(doc.entities.length, 600);
  assert.deepEqual([...new Set(doc.entities.map((e) => e.type))].sort(), ['ARC', 'CIRCLE', 'INSERT', 'LINE', 'LWPOLYLINE', 'TEXT']);
  const fl = flatten(readDxf(writeDxf(doc)));
  assert.ok(fl.items.length >= 600);
});
