// png-size.js — Export's PNG size and the 16384 px / 268 MP cap.   node png-size.test.mjs
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { pngSize, PNG_MAX_SIDE, PNG_MAX_PIXELS } = await import('./web/png-size.js');

test('inside the cap: inches x dpi, not capped', () => {
  assert.deepEqual(pngSize(254, 127, 300), { w: 3000, h: 1500, dpi: 300, capped: false });
  assert.deepEqual(pngSize(0.001, 0.001, 72), { w: 1, h: 1, dpi: 72, capped: false });
});

test('a long side over 16384 px: the largest dpi that fits', () => {
  const r = pngSize(25.4 * 100, 25.4 * 10, 300);           // 100 in at 300 dpi = 30000 px
  assert.deepEqual(r, { w: 16300, h: 1630, dpi: 163, capped: true });      // 163 dpi = 16300 px; 164 dpi = 16400 > 16384
});

test('both sides under 16384 but over 268 MP: capped by pixels', () => {
  const r = pngSize(25.4 * 16.38, 25.4 * 16.38, 1000);     // 16380 px square = 268.3 MP
  assert.equal(r.capped, true);
  assert.equal(r.dpi, 999);
  assert.ok(r.w * r.h <= PNG_MAX_PIXELS && r.w <= PNG_MAX_SIDE);
});

test('a sliver: one side tiny, the other long, still at least 1 px', () => {
  const r = pngSize(25.4 * 1000, 0.01, 1200);
  assert.equal(r.capped, true);
  assert.equal(r.h, 1);
  assert.ok(r.w <= PNG_MAX_SIDE);
});
