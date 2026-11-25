// nest.test.mjs — nest.js (the packer) and nestshape.js (a part's outline): node nest.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { placedMat, placedBox } from './web/apply.js';
import { newDoc, addEntities, lwpoly, rect as dxfRect, line, circle as dxfCircle, text as dxfText } from './web/dxf-write.js';
import * as LD from './web/layoutdoc.js';
import { outlineOf, hull } from './web/nestshape.js';
import { pack, packSteps, summary, polyAt, polyArea, polyBox, clear, edgeDistance, overlaps, ROTATIONS, freeTry, mulberry32, lru, CACHE_MAX, betterTry, freeRun } from './web/nest.js';

let n = 0;
const t = (name, fn) => { fn(); n++; };
const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];
const circle = (r, k = 72) => Array.from({ length: k }, (_, i) => [r + r * Math.cos((i / k) * 2 * Math.PI), r + r * Math.sin((i / k) * 2 * Math.PI)]);
const L = [[0, 0], [60, 0], [60, 20], [20, 20], [20, 60], [0, 60]];       // a 60 × 60 L, arms 20 thick
const AREA = { x: 0, y: 0, w: 600, h: 390 };
/** The outlines on the sheet, from a result and the job's items. */
const polysOf = (res, items) => res.placements.map((p) => polyAt(items.find((it) => it.id === p.partId).poly, p.rot, p.x, p.y));
function check(res, items, area, gap, fixed = []) {
  const polys = polysOf(res, items);
  polys.forEach((p) => { const [x0, y0, x1, y1] = polyBox(p); assert.ok(x0 >= area.x - 1e-6 && y0 >= area.y - 1e-6 && x1 <= area.x + area.w + 1e-6 && y1 <= area.y + area.h + 1e-6, 'a part leaves the usable area'); });
  const all = [...fixed, ...polys];
  for (let i = 0; i < polys.length; i++) for (let j = 0; j < all.length; j++) {
    if (all[j] === polys[i]) continue;
    assert.ok(clear(polys[i], all[j], gap), `parts ${i} and ${j} are closer than the gap ${gap}`);
  }
}

t('rectangles fill the area exactly, a gap apart', () => {
  const items = [{ id: 'a', count: 13, poly: rect(50, 30) }], area = { x: 0, y: 0, w: 215, h: 100 };       // 4 × 3 with 5 mm gaps is exactly 215 × 100
  const r = pack({ area, gap: 5, rotations: 'none', items });
  assert.equal(r.placed, 12); assert.deepEqual(r.left, { a: 1 });
  check(r, items, area, 5);
  const xs = [...new Set(r.placements.map((p) => p.x))].sort((a, b) => a - b), ys = [...new Set(r.placements.map((p) => p.y))].sort((a, b) => a - b);
  assert.deepEqual(xs, [0, 55, 110, 165]); assert.deepEqual(ys, [0, 35, 70]);
  assert.ok(Math.abs(r.usedPct - (12 * 1500 / (215 * 100)) * 100) < 1e-9);
});

t('bottom-left: the first part sits in the corner of the area (a gripper keeps the bottom free)', () => {
  const area = { x: 10, y: 30, w: 300, h: 200 };
  const r = pack({ area, gap: 5, rotations: 'none', items: [{ id: 'a', count: 2, poly: rect(50, 30) }] });
  assert.deepEqual(r.placements.map((p) => [p.x, p.y]), [[10, 30], [65, 30]]);
});

t('an L nests into the corner of another: two Ls fit where their boxes would not', () => {
  const items = [{ id: 'L', count: 2, poly: L }], area = { x: 0, y: 0, w: 80, h: 60 };      // two 60 × 60 boxes need 120 wide
  const r = pack({ area, gap: 0, rotations: 'flip', items });
  assert.equal(r.placed, 2); assert.deepEqual(r.placements.map((p) => p.rot).sort(), [0, 180]);
  check(r, items, area, 0);
  assert.ok(!overlaps(...polysOf(r, items)));
});

t('with only 0° the same two Ls do not both fit', () => {
  const r = pack({ area: { x: 0, y: 0, w: 80, h: 60 }, gap: 0, rotations: 'none', items: [{ id: 'L', count: 2, poly: L }] });
  assert.equal(r.placed, 1); assert.deepEqual(r.left, { L: 1 });
});

t('the gap is kept between true outlines (circles, Ls) and nothing overlaps or leaves the area', () => {
  const items = [{ id: 'c', count: 9, poly: circle(30) }, { id: 'L', count: 6, poly: L }, { id: 'r', count: 6, poly: rect(50, 20) }], area = { x: 0, y: 30, w: 320, h: 250 };
  for (const gap of [0, 4, 5]) {
    const r = pack({ area, gap, rotations: 'all', items });
    assert.ok(r.placed >= 15, 'it should place most of them (' + r.placed + ')');
    check(r, items, area, gap);
  }
});

t('circles pack closer than their boxes would allow (true shape)', () => {
  const items = [{ id: 'c', count: 12, poly: circle(30) }], area = { x: 0, y: 0, w: 205, h: 200 };
  const r = pack({ area, gap: 5, rotations: 'none', items });
  check(r, items, area, 5);
  assert.ok(r.placed >= 8 && r.placements.some((p) => p.x % 65 !== 0), 'circles in staggered rows, not a box grid');
});

t('rotations obey the setting', () => {
  const items = [{ id: 'bar', count: 1, poly: rect(100, 20) }], area = { x: 0, y: 0, w: 30, h: 100 };
  assert.equal(pack({ area, gap: 0, rotations: 'none', items }).placed, 0);
  assert.equal(pack({ area, gap: 0, rotations: 'flip', items }).placed, 0);
  const r = pack({ area, gap: 0, rotations: 'all', items });
  assert.equal(r.placed, 1); assert.ok(r.placements[0].rot === 90 || r.placements[0].rot === 270);
  check(r, items, area, 0);
  for (const mode of Object.keys(ROTATIONS)) {
    const q = pack({ area: AREA, gap: 5, rotations: mode, items: [{ id: 'L', count: 30, poly: L }, { id: 'b', count: 10, poly: rect(100, 20) }] });
    assert.ok(q.placements.every((p) => ROTATIONS[mode].includes(p.rot)), mode);
  }
});

t('a part too big for the area is a left-over, and the others still go', () => {
  const items = [{ id: 'big', count: 2, poly: rect(700, 10) }, { id: 'ok', count: 3, poly: rect(50, 50) }];
  const r = pack({ area: AREA, gap: 5, rotations: 'all', items });
  assert.deepEqual(r.left, { big: 2 }); assert.equal(r.placed, 3); assert.equal(r.total, 5);
});

t('a part with no outline (fewer than 3 points) or a zero count is a left-over / skipped', () => {
  const r = pack({ area: AREA, gap: 5, rotations: 'all', items: [{ id: 'x', count: 2, poly: [[0, 0], [1, 1]] }, { id: 'z', count: 0, poly: rect(10, 10) }] });
  assert.deepEqual(r.left, { x: 2 }); assert.equal(r.total, 2);
});

t('largest parts first, then the smaller fill in', () => {
  const items = [{ id: 'small', count: 1, poly: rect(10, 10) }, { id: 'big', count: 1, poly: rect(100, 100) }];
  const r = pack({ area: AREA, gap: 0, rotations: 'none', items });
  assert.equal(r.placements[0].partId, 'big'); assert.deepEqual([r.placements[0].x, r.placements[0].y], [0, 0]);
});

t('deterministic: the same job twice gives the same result', () => {
  const job = { area: AREA, gap: 5, rotations: 'all', items: [{ id: 'c', count: 8, poly: circle(30) }, { id: 'L', count: 8, poly: L }, { id: 'r', count: 12, poly: rect(100, 60) }] };
  assert.deepEqual(pack(job), pack(JSON.parse(JSON.stringify(job))));
});

t('parts already on the sheet are kept clear of and counted in the sheet used', () => {
  const fixed = [polyAt(rect(100, 100), 0, 0, 0)], items = [{ id: 'a', count: 4, poly: rect(100, 100) }], area = { x: 0, y: 0, w: 210, h: 100 };
  const r = pack({ area, gap: 5, rotations: 'none', items, fixed });
  assert.equal(r.placed, 1); assert.deepEqual([r.placements[0].x, r.placements[0].y], [105, 0]);
  check(r, items, area, 5, fixed);
  assert.ok(Math.abs(r.usedPct - (20000 / 21000) * 100) < 1e-9);
});

t('packSteps gives a partial result after each piece, and the same end as pack', () => {
  const job = { area: AREA, gap: 5, rotations: 'all', items: [{ id: 'r', count: 7, poly: rect(100, 60) }] };
  const g = packSteps(job), seen = [];
  let s;
  while (!(s = g.next()).done) seen.push([s.value.done, s.value.placements.length]);
  assert.deepEqual(seen.map((v) => v[0]), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(s.value, pack(job));
});

t('summary: a run stopped part-way keeps what was placed, the rest is left over', () => {
  const job = { area: AREA, gap: 5, rotations: 'all', items: [{ id: 'r', count: 7, poly: rect(100, 60) }, { id: 'c', count: 3, poly: circle(30) }] };
  const g = packSteps(job);
  let s;
  for (let i = 0; i < 4; i++) s = g.next();
  const part = summary(job, s.value.placements.slice());
  assert.equal(part.placed, 4); assert.equal(part.total, 10); assert.equal(part.stopped, true);
  assert.equal(Object.values(part.left).reduce((a, b) => a + b, 0), 6);
  assert.ok(Math.abs(part.usedPct - (4 * 6000 / (AREA.w * AREA.h)) * 100) < 1e-9);
  const full = pack(job);
  assert.equal(summary(job, full.placements).placed, full.placed);
  assert.deepEqual(summary(job, full.placements).left, full.left);
});

t('50 parts of mixed shapes in a few seconds, and all of it valid', () => {
  const items = [{ id: 'L', count: 12, poly: L }, { id: 'c', count: 12, poly: circle(30) }, { id: 'p', count: 16, poly: rect(100, 60) }, { id: 't', count: 10, poly: rect(50, 20) }];
  const t0 = Date.now(), r = pack({ area: AREA, gap: 5, rotations: 'all', items });
  assert.ok(Date.now() - t0 < 8000, 'took ' + (Date.now() - t0) + ' ms');
  check(r, items, AREA, 5);
  assert.equal(r.total, 50);
});

t('geometry helpers', () => {
  assert.equal(polyArea(L), 60 * 20 + 40 * 20);
  assert.deepEqual(polyBox(polyAt(rect(10, 20), 90)), [-20, 0, 0, 10]);
  assert.ok(Math.abs(edgeDistance(rect(10, 10), polyAt(rect(10, 10), 0, 25, 0)) - 15) < 1e-9);
  assert.ok(overlaps(rect(10, 10), polyAt(rect(10, 10), 0, 5, 5)));
  assert.ok(overlaps(rect(100, 100), polyAt(rect(10, 10), 0, 40, 40)));
  assert.ok(!overlaps(rect(10, 10), polyAt(rect(10, 10), 0, 10, 0)));
  assert.ok(clear(rect(10, 10), polyAt(rect(10, 10), 0, 10, 0), 0));
  assert.ok(!clear(rect(10, 10), polyAt(rect(10, 10), 0, 10, 0), 1));
});

const partOf = (...ents) => { const d = newDoc(4); addEntities(d, ...ents); return LD.makePart('p', 'p', d, 1); };
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, a + ' != ' + b);

t('outlineOf: a closed polyline is its own outline, its box corner at 0,0 (not the drawing origin)', () => {
  const o = outlineOf(partOf(lwpoly([[100, 200], [160, 200], [160, 220], [120, 220], [120, 260], [100, 260]], { closed: true })));
  assert.equal(o.kind, 'outline'); near(polyArea(o.poly), 60 * 20 + 40 * 20); assert.deepEqual(polyBox(o.poly).map((v) => Math.round(v)), [0, 0, 60, 60]);
});

t('outlineOf: a plate with a hole is its outer outline (the hole is counted, not used); a circle is a round outline', () => {
  const o = outlineOf(partOf(dxfRect(0, 0, 100, 60), dxfCircle(50, 30, 15)));
  assert.equal(o.kind, 'outline'); assert.equal(o.holes, 1); near(polyArea(o.poly), 6000);
  const c = outlineOf(partOf(dxfCircle(0, 0, 30)));
  assert.equal(c.kind, 'outline'); assert.ok(Math.abs(polyArea(c.poly) - Math.PI * 900) < 0.01 * Math.PI * 900);
});

t('outlineOf: lines that do not close give the hull; text and kept dimensions are left out; nothing drawn is its box', () => {
  const o = outlineOf(partOf(line(0, 0, 100, 0), line(100, 0, 100, 50), line(0, 0, 50, 80)));
  assert.equal(o.kind, 'hull'); near(polyArea(o.poly), 5250);
  assert.ok(hull([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5]]).length === 4);
  const t2 = outlineOf(partOf(dxfRect(0, 0, 40, 20), dxfText(0, 30, 5, 'note')));
  assert.ok(t2.kind === 'outline' || t2.kind === 'hull');
  const nothing = outlineOf({ raw: { entities: [], layers: {}, blocks: {}, header: {} }, fl: { items: [], mats: [[1, 0, 0, 1, 0, 0]], boxes: {} }, box: [0, 0, 10, 10], w: 10, h: 10, factor: 1 });
  assert.equal(nothing.kind, 'box'); near(polyArea(nothing.poly), 100);
});

t('a part narrower than one grid cell still marks a cell, so two of them are never put on the same spot', () => {
  const items = [{ id: 'a', count: 6, poly: rect(1, 30) }], area = { x: 0, y: 0, w: 40, h: 40 };
  const r = pack({ area, gap: 0, rotations: 'none', items, cell: 4 });
  assert.equal(r.placed, 6);
  const polys = polysOf(r, items);
  for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) assert.ok(clear(polys[i], polys[j], 0), 'no overlap');
  const cells = new Set(r.placements.map((p) => Math.floor(p.x / 4) + ',' + Math.floor(p.y / 4)));
  assert.equal(cells.size, 6, 'one cell each');
});

// ---------------------------------------------------------------- 267a: any angle, seeded tries
const hashOf = (jobs) => createHash('sha1').update(JSON.stringify(jobs.map((j) => { const r = pack(j); return [r.placements, r.placed, r.left, r.usedPct]; }))).digest('hex');
const FIXTURES = (() => {
  const mix = [{ id: 'c', count: 9, poly: circle(30) }, { id: 'L', count: 6, poly: L }, { id: 'r', count: 6, poly: rect(50, 20) }], mixArea = { x: 0, y: 30, w: 320, h: 250 };
  return [
    ...['none', 'flip', 'all'].flatMap((rotations) => [0, 4].map((gap) => ({ area: mixArea, gap, rotations, items: mix }))),
    { area: { x: 0, y: 0, w: 80, h: 60 }, gap: 0, rotations: 'flip', items: [{ id: 'L', count: 2, poly: L }] },
    { area: { x: 0, y: 0, w: 215, h: 100 }, gap: 5, rotations: 'none', items: [{ id: 'a', count: 13, poly: rect(50, 30) }] },
  ];
})();
const BASE_HASH = '14717bdcbdd9e1abd34733c4f49b8c69c2e7874b';

t('Every 90° / 0° + 180° / 0° only give byte-for-byte the placements of the base packer (hash pinned from base e1f6a2d)', () => {
  assert.equal(hashOf(FIXTURES), BASE_HASH);
});

t('a piece at 37° keeps the gap to its neighbours and the sheet edge, and is placed at that angle', () => {
  const items = [{ id: 'a', count: 4, poly: rect(50, 30) }, { id: 'L', count: 2, poly: L }], area = { x: 5, y: 7, w: 200, h: 150 };
  for (const gap of [0, 5]) {
    const r = pack({ area, gap, rotations: 'all', items, angles: [37, 37, 37, 37, 37, 37], order: null });
    assert.equal(r.placed, 6); assert.ok(r.placements.every((p) => p.rot === 37));
    check(r, items, area, gap);
  }
});

t('a try angle is rounded to a whole degree (37.4 packs as 37, -0.4 as 0)', () => {
  const items = [{ id: 'a', count: 4, poly: rect(50, 30) }, { id: 'L', count: 2, poly: L }], area = { x: 5, y: 7, w: 200, h: 150 };
  const run = (a) => pack({ area, gap: 3, rotations: 'all', items, angles: Array(6).fill(a), order: null });
  assert.deepEqual(run(37.4), run(37)); assert.deepEqual(run(36.6), run(37)); assert.deepEqual(run(-0.4), run(0));
});

t('apply.js placement and the dialog outline at 37° match the packer outline (R6)', () => {
  const part = { w: 50, h: 30, box: [0, 0, 50, 30], factor: 1 }, pl = { partId: 'a', x: 40, y: 25, rot: 37 }, sheetH = 300;
  const want = polyAt(rect(50, 30), 37, pl.x, pl.y), m = placedMat(part, pl, sheetH);
  rect(50, 30).forEach(([u, v], k) => { near(m[0] * u + m[2] * v + m[4], want[k][0], 1e-9); near(m[1] * u + m[3] * v + m[5], sheetH - want[k][1], 1e-9); });
  const bx = placedBox(part, pl), wb = polyBox(want);
  bx.forEach((v, k) => near(v, wb[k], 1e-6));
  assert.match(readFileSync(new URL('./web/nestdlg.js', import.meta.url), 'utf8'), /import \{[^}]*\bpolyAt\b[^}]*\} from '\.\/nest\.js'/);   // the dialog draws with this very polyAt
});

t('a seed gives one try: the same seed twice is the same result; seed 0 is the Every 90° run', () => {
  const items = [{ id: 'c', count: 5, poly: circle(30) }, { id: 'L', count: 4, poly: L }, { id: 'r', count: 5, poly: rect(50, 20) }], area = { x: 0, y: 30, w: 300, h: 200 };
  const total = 14, run = (seed) => pack({ area, gap: 4, rotations: 'all', items, ...freeTry(seed, total) });
  assert.deepEqual(freeTry(7, total), freeTry(7, total));
  assert.notDeepEqual(freeTry(7, total), freeTry(8, total));
  assert.deepEqual(run(7), run(7)); assert.notDeepEqual(run(7).placements, run(8).placements);
  assert.deepEqual(run(0), pack({ area, gap: 4, rotations: 'all', items }));
  const f = freeTry(123, total);
  assert.ok(f.angles.every((a) => Number.isInteger(a) && a >= 0 && a < 360)); assert.deepEqual([...f.order].sort((a, b) => a - b), Array.from({ length: total }, (_, k) => k));
  check(run(7), items, area, 4);
  assert.equal(mulberry32(1)(), mulberry32(1)());
});

t('the cache holds at most 2048 entries, the oldest go first, a read keeps an entry', () => {
  assert.equal(CACHE_MAX, 2048);
  const c = lru();
  for (let k = 0; k < 5000; k++) { c.set('k' + k, k); if (k === 2100) c.get('k5'); assert.ok(c.size <= CACHE_MAX); }
  assert.equal(c.size, CACHE_MAX); assert.equal(c.get('k0'), undefined); assert.equal(c.get('k4999'), 4999);
  const d = lru(2); d.set('a', 1); d.set('b', 2); d.get('a'); d.set('c', 3);
  assert.equal(d.get('b'), undefined); assert.equal(d.get('a'), 1);
});

t('Free angles: the best try is the highest usedPct, a tie goes to the lower seed whichever came first', () => {
  const a = { seed: 5, usedPct: 40 }, b = { seed: 2, usedPct: 40 }, c = { seed: 9, usedPct: 41 }, d = { seed: 0, usedPct: 39.9 };
  assert.equal(betterTry(a, null), true);
  assert.equal(betterTry(c, a), true); assert.equal(betterTry(a, c), false);
  assert.equal(betterTry(b, a), true); assert.equal(betterTry(a, b), false, 'a tie: the lower seed');
  assert.equal(betterTry({ seed: 3, usedPct: 40 + 1e-12 }, b), false, 'ulp noise is a tie, seed 2 stays');
  assert.equal(betterTry(d, a), false);
  for (const order of [[a, b, c, d], [d, c, b, a], [c, a, d, b]]) assert.equal(order.reduce((best, x) => (betterTry(x, best) ? x : best), null), c);
  for (const order of [[a, b, d], [d, b, a], [b, d, a]]) assert.equal(order.reduce((best, x) => (betterTry(x, best) ? x : best), null), b);
});

t('Free angles: workers k of K try seeds k, k+K, …; seed 0 is never cut by the time limit; the best of all workers is the brute-force best', () => {
  const items = [{ id: 'c', count: 5, poly: circle(30) }, { id: 'L', count: 4, poly: L }, { id: 'r', count: 5, poly: rect(50, 20) }], area = { x: 0, y: 30, w: 150, h: 100 }, job = { area, gap: 4, rotations: 'free', items }, total = 14;
  // the limit is already past: worker 0 still packs seed 0 (= Every 90°) and nothing else, worker 1 packs nothing
  const late = (k) => { const g = freeRun(job, k, 2, 0, () => 1); const out = []; let r; while (!(r = g.next()).done) out.push(r.value); return { out, ...r.value }; };
  const w0 = late(0), w1 = late(1);
  assert.equal(w0.tried, 1); assert.equal(w0.best.seed, 0); assert.deepEqual(w0.best.placements, pack({ area, gap: 4, rotations: 'all', items }).placements);
  assert.deepEqual(w0.out.filter((m) => m.type === 'best').map((m) => m.tried), [1]); assert.ok(w0.out.some((m) => m.type === 'step' && m.seed === 0));
  assert.equal(w1.tried, 0); assert.equal(w1.best, null);
  // the clock runs out after ~60 steps: each worker's tried count says which seeds it finished
  const run = (k, K) => { let steps = 0; const g = freeRun(job, k, K, 1, () => (steps > 60 ? 2 : 0)); let r; while (!(r = g.next()).done) { if (r.value.type === 'step') steps++; } return r.value; };
  const K = 2, ws = [run(0, K), run(1, K)], seen = [];
  assert.ok(ws.every((w) => w.tried > 1));
  const all = ws.flatMap((w, k) => Array.from({ length: w.tried }, (_, i) => k + K * i));
  for (const s of all) seen.push({ ...pack({ area, gap: 4, rotations: 'all', items, ...freeTry(s, total) }), seed: s });
  assert.ok(new Set(seen.map((x) => x.usedPct.toFixed(6))).size > 1, 'the tries differ');
  const want = seen.reduce((best, x) => (betterTry(x, best) ? x : best), null);
  for (const order of [[ws[0].best, ws[1].best], [ws[1].best, ws[0].best]]) {
    const got = order.reduce((best, x) => (betterTry(x, best) ? x : best), null);
    assert.equal(got.seed, want.seed); assert.deepEqual(got.placements, want.placements);
  }
});

{                                                   // Free angles: the dialog's kept settings (top-level await: t() does not wait)
  const { kept, limitOf } = await import('./web/nestdlg.js');
  assert.deepEqual(kept, { rotations: 'all', timeLimit: 60 }, 'the dialog keeps rotations and the time limit; the default stays Every 90°, 60 s');
  assert.ok('free' in ROTATIONS);
  assert.deepEqual(['1', '5', '60', '600', '9999', '-3', '12.7', 'abc', ''].map(limitOf), [5, 5, 60, 600, 600, 5, 12, 60, 60]);
  n++;
}

console.log(`nest.test.mjs: ${n} tests passed`);
