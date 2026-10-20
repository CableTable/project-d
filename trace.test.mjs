// trace.js — option mapping, threshold, paths → polylines at true size.   node trace.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as T from './web/trace.js';
import { newDoc, addEntities, writeDxf } from './web/dxf-write.js';

const ImageTracer = createRequire(import.meta.url)('imagetracerjs');

/** RGBA bytes: white paper, with each [x0, y0, x1, y1, grey] box painted (pixels x0 ≤ x < x1). */
function picture(w, h, ...boxes) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const [x0, y0, x1, y1, g] of boxes) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = g; }
  return { width: w, height: h, data };
}
const trace = (img, p) => {
  T.maskThreshold(img.data, p.threshold ?? 128);
  return ImageTracer.imagedataToTracedata(img, T.tracerOptions({ ...T.DEFAULTS, ...p }));
};
const bbox = (poly) => [Math.min(...poly.map((p) => p[0])), Math.min(...poly.map((p) => p[1])), Math.max(...poly.map((p) => p[0])), Math.max(...poly.map((p) => p[1]))];
const near = (a, b, eps, m) => assert.ok(Math.abs(a - b) <= eps, `${m}: ${a} !~ ${b}`);

test('fitSize keeps small pictures and shrinks big ones to the limit, keeping the shape', () => {
  assert.deepEqual(T.fitSize(400, 300), { w: 400, h: 300, k: 1 });
  const r = T.fitSize(4000, 2000);
  assert.equal(r.w, T.MAX_PX); assert.equal(r.h, T.MAX_PX / 2); assert.equal(r.k, T.MAX_PX / 4000);
  assert.equal(T.fitSize(1, 1).w, 1);
});

test('tracerOptions: more detail means finer tolerances and fewer dropped specks; smoothing is the blur', () => {
  const lo = T.tracerOptions({ threshold: 128, detail: 0, smoothing: 0, colours: 8 }), hi = T.tracerOptions({ threshold: 128, detail: 100, smoothing: 100, colours: 8 });
  assert.ok(hi.ltres < lo.ltres && hi.qtres < lo.qtres); assert.ok(hi.pathomit < lo.pathomit);
  assert.equal(lo.blurradius, 0); assert.equal(hi.blurradius, 5);
  assert.equal(lo.numberofcolors, 8); assert.equal(lo.pal, undefined);
});

test('tracerOptions: two colours get a black and white palette; colours and sliders are clamped', () => {
  const o = T.tracerOptions({ detail: 65, smoothing: 30, colours: 2 });
  assert.equal(o.pal.length, 2); assert.equal(o.colorsampling, 0);
  assert.equal(T.tracerOptions({ detail: 500, smoothing: -4, colours: 99 }).numberofcolors, T.MAX_COLOURS);
  assert.equal(T.tracerOptions({ detail: NaN, smoothing: 0, colours: 'x' }).numberofcolors, 2);
});

test('maskThreshold: darker than the threshold is black, the rest white, see-through is white', () => {
  const d = new Uint8ClampedArray([100, 100, 100, 255, 200, 200, 200, 255, 0, 0, 0, 0]);
  T.maskThreshold(d, 128);
  assert.deepEqual([...d], [0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
  const e = new Uint8ClampedArray([100, 100, 100, 255]);
  T.maskThreshold(e, 50);
  assert.equal(e[0], 255);
});

test('isBackground: white and see-through are paper', () => {
  assert.ok(T.isBackground({ r: 255, g: 255, b: 255, a: 255 })); assert.ok(T.isBackground({ r: 0, g: 0, b: 0, a: 0 }));
  assert.ok(!T.isBackground({ r: 20, g: 20, b: 20, a: 255 })); assert.ok(T.isBackground(undefined));
});

test('a black box on white becomes one closed outline at the right place and true size (y up)', () => {
  const td = trace(picture(40, 30, [10, 5, 30, 15, 0]), {});
  const polys = T.tracedataToPolys(td, 80, 60);                  // 2 mm per pixel
  assert.equal(polys.length, 1);
  const [x0, y0, x1, y1] = bbox(polys[0]);
  near(x0, 20, 2.1, 'left'); near(x1, 60, 2.1, 'right'); near(x1 - x0, 40, 2.1, 'width');
  near(y0, 60 - 30, 2.1, 'bottom (image row 15 is 30 mm above the bottom)'); near(y1, 60 - 10, 2.1, 'top'); near(y1 - y0, 20, 2.1, 'height');
});

test('a hole in the artwork is its own outline; white paper is never traced', () => {
  const td = trace(picture(60, 60, [10, 10, 50, 50, 0], [25, 25, 35, 35, 255]), {});
  const polys = T.tracedataToPolys(td, 60, 60);
  assert.equal(polys.length, 2);
  const sizes = polys.map((p) => { const b = bbox(p); return Math.round(b[2] - b[0]); }).sort((a, b) => a - b);
  near(sizes[0], 10, 1.5, 'hole'); near(sizes[1], 40, 1.5, 'outer');
});

test('a disc comes out as a polyline with many points near the circle (curves are flattened)', () => {
  const w = 80, img = picture(w, w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) if (Math.hypot(x + 0.5 - 40, y + 0.5 - 40) < 25) { const i = (y * w + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 0; }
  const polys = T.tracedataToPolys(trace(img, {}), 80, 80);
  assert.equal(polys.length, 1); assert.ok(polys[0].length > 12);
  for (const p of polys[0]) near(Math.hypot(p[0] - 40, p[1] - 40), 25, 1.6, 'radius');
});

test('colours: with 3 colours the dark ink is traced, the white paper and the faint tint are not', () => {
  const td = trace(picture(50, 50, [5, 5, 20, 20, 0], [30, 30, 45, 45, 250]), { colours: 3 });
  assert.ok(T.tracedataToPolys(td, 50, 50).length >= 1);
});

test('traceEntities: closed LWPOLYLINEs on the layer, moved to the picture position and into drawing units', () => {
  const ents = T.traceEntities([[[0, 0], [10, 0], [10, 5]]], { x: 100, y: 50, factor: 25.4, layer: 'Trace' });
  assert.equal(ents.length, 1); assert.equal(ents[0].type, 'LWPOLYLINE'); assert.equal(ents[0].layer, 'Trace');
  const r = ents[0].r, at = (code) => r.v.filter((_, k) => r.c[k] === code).map(Number);
  assert.equal(at(70)[0], 1);                                      // closed
  near(at(10)[0], 100 / 25.4, 1e-4, 'x'); near(at(10)[1], 110 / 25.4, 1e-4, 'x2'); near(at(20)[2], 55 / 25.4, 1e-4, 'y');
  const d = newDoc(); addEntities(d, ...ents);
  assert.ok(writeDxf(d).includes('LWPOLYLINE'));
});
