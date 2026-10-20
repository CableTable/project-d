// unitfix.js — the one-click unit fix ×25.4 / ÷25.4 (TODO 51).   node unitfix.test.mjs
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const U = await import('./web/unitfix.js');
const E = await import('./web/edit.js');
const W = await import('./web/dxf-write.js');
const D = await import('./web/drawing.js');

test('the factors are 25.4 and 1/25.4, and the sizes they give', () => {
  assert.equal(U.UNIT_FIXES.up.s, 25.4);
  assert.ok(Math.abs(U.UNIT_FIXES.down.s * 25.4 - 1) < 1e-12);
  const [w, h] = U.unitFixSize([0, 0, 10, 5], 25.4);
  assert.ok(Math.abs(w - 254) < 1e-9 && Math.abs(h - 127) < 1e-9);
});

test('texts: the command line and the tooltip', () => {
  assert.equal(U.unitFixLine(U.UNIT_FIXES.up, [10, 5], [254, 127]), 'Unit fix ×25.4 · 10.00 × 5.00 → 254.00 × 127.00 mm');
  assert.equal(U.unitFixLine(U.UNIT_FIXES.down, [254, 127], [10, 5]), 'Unit fix ÷25.4 · 254.00 × 127.00 → 10.00 × 5.00 mm');
  assert.match(U.unitFixTip(U.UNIT_FIXES.up, [0, 0, 10, 5]), /×25\.4.*Would give 254\.00 × 127\.00 mm/);
  assert.match(U.unitFixTip(U.UNIT_FIXES.down, null), /nothing to scale/);
});

test('the background scales about the origin: its size and its corner', () => {
  const bg = { name: 'a.png', w: 100, h: 50, mm: 0.5, x: 10, y: 20 };
  const r = U.bgUnitFixed(bg, 25.4);
  assert.ok(Math.abs(r.mm - 12.7) < 1e-9 && Math.abs(r.x - 254) < 1e-9 && Math.abs(r.y - 508) < 1e-9);
  assert.equal(bg.mm, 0.5, 'the original is untouched');
  const b = E.bgBox(r);
  assert.ok(Math.abs(b[2] - b[0] - 1270) < 1e-9);
});

test('a drawing scaled about 0,0: the points move away from the origin, a polyline width scales too, the original is untouched', () => {
  const doc = W.newDoc(4);
  W.addEntities(doc, [W.line(10, 20, 30, 20), W.lwpoly([[10, 20], [30, 20], [30, 40]], { width: 0.5 })]);
  const r = E.scaleAbout(doc, 25.4, 0, 0, 0);
  assert.deepEqual(r.skipped, {});
  const back = D.readDxf(W.writeDxf({ ...doc, entities: r.entities, blocks: r.blocks }));
  const fl = D.flatten(back), b = fl.boxes.model;
  // the box is drawn with the line width: half of 0.5 × 25.4 = 6.35 each side of 254 / 508 / 762
  assert.ok(Math.abs(b[0] - (254 - 6.35)) < 1e-6 && Math.abs(b[1] - (508 - 6.35)) < 1e-6 && Math.abs(b[2] - (762 + 6.35)) < 1e-4, `box ${b}`);
  const e = r.entities[1].r, k = e.c.map((c, i) => [c, e.v[i]]).filter(([c]) => c === 43).map(([, v]) => +v);
  assert.ok(k.length && Math.abs(k[0] - 0.5 * 25.4) < 1e-9, 'constant width ×25.4');
  const e0 = doc.entities[1].r;
  assert.ok(e0.c.some((c, i) => c === 43 && +e0.v[i] === 0.5), 'the original keeps its width');
});
