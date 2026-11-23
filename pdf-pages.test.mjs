// pdf-export.js planPagesPdf (TODO 358b): Save as PDF (pages): a page per page picture, what is drawn on it as vector, clipped; the outside count.   node pdf-pages.test.mjs
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const D = await import('./web/drawing.js');
const W = await import('./web/dxf-write.js');
const X = await import('./web/pdf-export.js');
const { PAGES_LAYER } = await import('./web/pdf-read.js');

const PX = 'data:image/png;base64,iVBORw0KGgo=';                       // isPng looks at the prefix and the alphabet only
const pics = new Map([[PX, { px: PX, w: 2, h: 2, rgb: new Uint8Array(12), a: null }]]);
/** A page picture: its corner (x, y), pixel sides u, v (mm per pixel) and size in pixels w × h. */
const picture = (x, y, u, v, w, h, layer = PAGES_LAYER) => { const e = W.entity('IMAGE', [[10, x], [20, y], [30, 0], [11, u[0]], [21, u[1]], [31, 0], [12, v[0]], [22, v[1]], [32, 0], [13, w], [23, h]], { layer }); e.r.px = PX; return e; };
const make = (entities, extra = {}) => {
  const raw = W.newDoc(); W.addLayer(raw, PAGES_LAYER, { aci: 7 }); W.addEntities(raw, ...entities);
  return { raw, src: { fl: D.flatten(raw), factor: 1, off: new Set(), name: 'two', pics, ...extra } };
};
const page1 = () => picture(0, 0, [10, 0], [0, 10], 8, 5), page2 = () => picture(90, 0, [10, 0], [0, 10], 12, 9);   // 80 × 50 and 120 × 90 mm, 10 mm apart
const text = (bytes) => Buffer.from(bytes).toString('latin1');
const mediaBoxes = (t) => [...t.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
const MM = 72 / 25.4;
const draws = (page) => page.cmds.filter((c) => c[0] === 'm' || c[0] === 'l').map((c) => [c[1], c[2]]);

test('a PDF page per picture at its size, left to right as placed, the picture first', () => {
  const { src } = make([page2(), page1()]);                          // placed right-to-left in the file: the order is by position
  const plan = X.planPagesPdf(src);
  assert.deepEqual(plan.pages.map((p) => [p.n, p.of, p.w, p.h]), [[1, 2, 80, 50], [2, 2, 120, 90]]);
  assert.equal(plan.outside, 0);
  const t = text(plan.bytes());
  assert.deepEqual(mediaBoxes(t).map(([w, h]) => [Math.round(w / MM), Math.round(h / MM)]), [[80, 50], [120, 90]]);
  assert.equal(plan.build(0).cmds.filter((c) => c[0] === 'I').length, 1, 'its own picture only');
  assert.ok(t.includes('/Subtype /Image') && t.includes('/Im1 Do'), 'the picture is an image object');
});

test('a rotated page picture is a page the size of its turned box', () => {
  const { src } = make([picture(500, 0, [0, 10], [-10, 0], 10, 4)]);   // 100 mm up, 40 mm left: a 40 × 100 box
  const [p] = X.planPagesPdf(src).pages;
  assert.deepEqual([p.w, p.h, p.box], [40, 100, [460, 0, 500, 100]]);
});

test('what is drawn across two pages is cut on each; an object touching no page is counted, not saved', () => {
  const across = W.line(60, 20, 130, 20), far = W.line(0, 200, 10, 200), far2 = W.line(300, 0, 310, 0);
  const { src } = make([page1(), page2(), across, far, far2]);
  const plan = X.planPagesPdf(src);
  assert.equal(plan.outside, 2, 'the two lines that touch no page');
  const [a, b] = [plan.build(0), plan.build(1)];
  assert.deepEqual(draws(a).slice(4), [[60, 20], [130, 20]], 'page 1: the line, in page coordinates (the first four points are the clip)');
  assert.deepEqual(draws(b).slice(4), [[-30, 20], [40, 20]], 'page 2: the same line shifted to its own corner');
  for (const page of [a, b]) {
    const i = page.cmds.findIndex((c) => c[0] === 'W');
    assert.ok(i > 0 && page.cmds[i - 1][0] === 'h' && page.cmds[0][0] === 'q', 'a clip to the page edge before anything is drawn');
    assert.equal(page.cmds.filter((c) => c[0] === 'S').length, 1, 'one stroke: the far lines are not drawn');
  }
});

test('overlapping pages each draw their own frame', () => {
  const dot = W.line(55, 5, 65, 5);
  const { src } = make([picture(0, 0, [10, 0], [0, 10], 8, 5), picture(50, 0, [10, 0], [0, 10], 8, 5), dot]);   // 0..80 and 50..130: both hold x 55..65
  const plan = X.planPagesPdf(src);
  assert.equal(plan.outside, 0);
  assert.deepEqual(draws(plan.build(0)).slice(4), [[55, 5], [65, 5]]);
  assert.deepEqual(draws(plan.build(1)).slice(4), [[5, 5], [15, 5]]);
  assert.equal(plan.build(0).cmds.filter((c) => c[0] === 'I').length, 1, 'the other page picture is not drawn on it');
});

test('hidden layers and objects are left out; no page picture gives no pages', () => {
  const raw = W.newDoc(); W.addLayer(raw, PAGES_LAYER, { aci: 7 }); W.addLayer(raw, 'Notes', { aci: 1 });
  W.addEntities(raw, page1(), W.line(10, 10, 20, 10, { layer: 'Notes' }), W.line(10, 20, 20, 20));
  const fl = D.flatten(raw), notes = fl.layers.findIndex((l) => l.name === 'Notes');
  const plan = X.planPagesPdf({ fl, factor: 1, off: new Set([notes]), pics });
  assert.deepEqual(draws(plan.build(0)).slice(4), [[10, 20], [20, 20]], 'the Notes line is hidden');
  assert.equal(plan.outside, 0, 'a hidden object is not "outside"');
  const none = make([W.line(0, 0, 5, 5), picture(0, 0, [10, 0], [0, 10], 8, 5, '0')]);
  assert.equal(X.planPagesPdf(none.src).pages.length, 0, 'a picture on another layer is not a page');
  assert.equal(X.isPagePicture(none.src.fl, none.src.fl.items.find((it) => it.k === 'i')), false);
});

test('hasPagePictures (TODO 358c1): a shown page picture counts, also inside a block; hidden layer or none: no', () => {
  const { src } = make([page1()]);
  assert.equal(X.hasPagePictures(src), true);
  const pagesLayer = src.fl.layers.findIndex((l) => l.name === PAGES_LAYER);
  assert.equal(X.hasPagePictures({ ...src, off: new Set([pagesLayer]) }), false, 'the "PDF pages" layer hidden');
  assert.equal(X.hasPagePictures(make([W.line(0, 0, 5, 5), picture(0, 0, [10, 0], [0, 10], 8, 5, '0')]).src), false, 'a picture on another layer');
  assert.equal(X.hasPagePictures(null), false);
  const raw = W.newDoc(); W.addLayer(raw, PAGES_LAYER, { aci: 7 });     // a layout part is a block: the INSERT puts the picture at (100, 50)
  W.addBlock(raw, 'part', [picture(0, 0, [10, 0], [0, 10], 8, 5)], [0, 0]);
  W.addEntities(raw, W.insert('part', 100, 50));
  const fl = D.flatten(raw), inBlock = { fl, factor: 1, off: new Set(), pics };
  assert.equal(X.hasPagePictures(inBlock), true, 'a page picture inside a block');
  const plan = X.planPagesPdf(inBlock);
  assert.deepEqual(plan.pages.map((p) => [p.w, p.h, p.box]), [[80, 50, [100, 50, 180, 100]]]);
  assert.equal(X.hasPagePictures({ ...inBlock, off: new Set([fl.layers.findIndex((l) => l.name === PAGES_LAYER)]) }), false, 'hidden, also inside the block');
});

test('layers the source hides (a layout\'s Sheet and Marks) are not artwork: not drawn, not counted outside', () => {
  const raw = W.newDoc(); W.addLayer(raw, PAGES_LAYER, { aci: 7 }); W.addLayer(raw, 'Sheet', { aci: 8 });
  W.addEntities(raw, page1(), W.line(0, 0, 80, 0, { layer: 'Sheet' }), W.line(300, 0, 310, 0, { layer: 'Sheet' }), W.line(10, 20, 20, 20));
  const plan = X.planPagesPdf({ fl: D.flatten(raw), factor: 1, off: new Set(), pics, hide: ['Sheet'] });
  assert.deepEqual(draws(plan.build(0)).slice(4), [[10, 20], [20, 20]]);
  assert.equal(plan.outside, 0);
});

test('a drawing saved as DXF and reopened (-pageN.png) saves as PDF pages again', () => {
  const { raw } = make([page1(), page2(), W.line(60, 20, 130, 20)]);
  const back = D.readDxf(W.writeDxf(raw, { name: 'two.dxf' }));
  const images = back.entities.filter((e) => e.type === 'IMAGE');
  assert.deepEqual(images.map((e) => [e.layer, e.r.file]), [[PAGES_LAYER, 'two-page1.png'], [PAGES_LAYER, 'two-page2.png']]);
  for (const e of images) e.r.px = PX;                                // the app reads the sibling PNGs back into px
  const plan = X.planPagesPdf({ fl: D.flatten(back), factor: 1, off: new Set(), pics });
  assert.deepEqual(plan.pages.map((p) => [p.w, p.h]), [[80, 50], [120, 90]]);
  assert.equal(plan.outside, 0);
});
