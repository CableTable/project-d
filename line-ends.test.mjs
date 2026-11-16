import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDoc, addEntities, addBlock, insert, line, lwpoly, entity, writeDxf } from './web/dxf-write.js';
import { readDxf, flatten, patchWidths } from './web/drawing.js';
import { paintDrawing } from './web/render.js';
import { planPdf } from './web/pdf-export.js';
import { Page, contentStream } from './web/pdf-write.js';
import { paintPage } from './web/export.js';
import { copySnapshot, pasteSnapshot } from './web/clipboard.js';
import { copyEntities, createHistory, joinGaps, makeIndex } from './web/edit.js';
import { scaleEntities } from './web/scale.js';
import { apply as gripApply } from './web/gripmode.js';
import { combine } from './web/combine.js';
import { newLayout, objectPart, objectPlacement, objectDoc } from './web/layoutdoc.js';
import { scaleAbout as scalePlacement } from './web/place.js';
import { explodePolyline, explodeInsert } from './web/explode.js';
import { joinEntities } from './web/join.js';

const style = (e) => [e.cap, e.join, e.scaleWithObject];
const defaults = ['butt', 'miter', false];
const styled = { cap: 'square', join: 'bevel', scaleWithObject: true };

test('TODO 293b: Scale and grip scale multiply explicit widths only when Scale with object is on', () => {
  for (const scale of [
    (raw, k) => scaleEntities(raw, new Set(raw.entities.keys()), [0, 0], k),
    (raw, k) => gripApply(raw, new Set(raw.entities.keys()), 'SCALE', [0, 0], k),
  ]) for (const on of [false, true]) for (const k of [2, .5]) {
    const raw = newDoc();
    addEntities(raw, line(0, 0, 10, 0, { lw: 50, scaleWithObject: on }),
      lwpoly([[0, 10], [10, 10]], { width: 2, scaleWithObject: on }),
      line(0, 20, 10, 20, { scaleWithObject: on }),
      line(0, 30, 10, 30, { lw: -3, scaleWithObject: on }));
    const before = structuredClone(raw), result = scale(raw, k);
    assert.equal(result.entities[0].lw, on ? 50 * k : 50);
    assert.equal(+result.entities[1].r.v[result.entities[1].r.c.indexOf(43)], on ? 2 * k : 2);
    assert.deepEqual(result.entities.slice(2).map((e) => e.lw), [-1, -3]);
    assert.deepEqual(raw, before, 'scaling leaves the source intact');
  }
});

test('TODO 293b: Combine and Join gap bridges copy the source ends, corners and scale tick', () => {
  const raw = newDoc();
  addEntities(raw, line(0, 0, 10, 0, styled), line(10.01, 0, 20, 0, styled));
  const combined = combine(raw, new Set([0, 1]));
  assert.deepEqual(style(combined.entities[0]), style(raw.entities[1]));
  const ed = makeIndex(raw, flatten(raw), new Set());
  const bridge = joinGaps(raw, ed, [{ x: 10.005, y: 0, ends: [{ e: 0, k: 1 }, { e: 1, k: 0 }] }], 'chamfer');
  assert.deepEqual(style(bridge.entities.at(-1)), style(raw.entities[0]));
});

test('TODO 293b: layout object scaling bakes numeric widths with the same on / off rule', () => {
  for (const on of [false, true]) for (const ent of [line(0, 0, 10, 0, { lw: 50, scaleWithObject: on }),
    lwpoly([[0, 0], [10, 0]], { width: 2, scaleWithObject: on }), line(0, 0, 10, 0, { scaleWithObject: on })]) {
    const lay = newLayout('scale'), part = objectPart('o1', 'Line', ent, {});
    lay.parts.o1 = part; lay.placed.push(scalePlacement(part, objectPlacement(part), [0, 0], 2));
    const result = objectDoc(lay).raw.entities[0];
    assert.equal(result.lw, ent.lw > 0 && on ? ent.lw * 2 : ent.lw);
    if (ent.type === 'LWPOLYLINE') assert.equal(+result.r.v[result.r.c.indexOf(43)], on ? 4 : 2);
  }
});

test('TODO 293b: scaling refuses an unrepresentable lineweight before changing the source', () => {
  const raw = newDoc(); addEntities(raw, line(0, 0, 10, 0, { lw: 20000, scaleWithObject: true }));
  const before = structuredClone(raw);
  assert.throws(() => scaleEntities(raw, new Set([0]), [0, 0], 2), /outline width exceeds/);
  assert.deepEqual(raw, before);
});

test('TODO 293a: entity defaults and PROJECTD xdata round trip, including blocks and legacy polylines', () => {
  const raw = newDoc();
  addEntities(raw, line(10, 10, 50, 10), lwpoly([[10, 20], [50, 20], [50, 40]], styled));
  addBlock(raw, 'ends', [line(0, 0, 20, 0, { cap: 'round', join: 'round' })]);
  const legacy = entity('POLYLINE', [[70, 0]], styled);
  legacy.kids = [entity('VERTEX', [[10, 5], [20, 5]]).r, entity('VERTEX', [[10, 15], [20, 15]]).r];
  addEntities(raw, legacy, insert('ends', 10, 50), line(0, 60, 20, 60, { scaleWithObject: true }));
  assert.deepEqual(style(raw.entities[0]), defaults);
  const text = writeDxf(raw), reopened = readDxf(text);
  assert.match(text, /AcDbRegAppTableRecord\r\n  2\r\nPROJECTD\r\n/);
  assert.equal((text.match(/1001\r\nPROJECTD\r\n/g) || []).length, 4);
  assert.deepEqual(reopened.entities.map(style), raw.entities.map(style));
  assert.deepEqual(style(reopened.blocks.ends.entities[0]), ['round', 'round', false]);
  assert.equal(writeDxf(reopened), text, 'save/reopen/save stays stable');
});

test('TODO 293a: defaults write no xdata; styling one entity leaves untouched entity bytes unchanged', () => {
  const raw = newDoc();
  addEntities(raw, line(10, 10, 50, 10), line(10, 20, 50, 20));
  const before = writeDxf(raw);
  assert.doesNotMatch(before, /PROJECTD|1001/);
  Object.assign(raw.entities[0], styled);
  const after = writeDxf(raw);
  const lines = (text) => text.match(/  0\r\nLINE\r\n[\s\S]*?(?=  0\r\n)/g);
  assert.equal(lines(after)[1], lines(before)[1]);
  Object.assign(raw.entities[0], { cap: 'butt', join: 'miter', scaleWithObject: false });
  assert.equal(writeDxf(raw), before);
});

test('TODO 293a: foreign and malformed xdata cannot set line ends; stale xdata does not override edited fields', () => {
  const raw = newDoc();
  const xdata = (app, cap, join, scale) => [[1001, app], [1000, 'LINE_ENDS_V1'], [1070, cap], [1070, join], [1070, scale]];
  addEntities(raw, entity('LINE', [[10, 0], [20, 0], [11, 20], [21, 0], ...xdata('OTHER', 2, 2, 1)]));
  const text = writeDxf(raw);
  assert.doesNotMatch(text, /OTHER|LINE_ENDS_V1/);
  const withData = (pairs) => text.replace('  0\r\nENDSEC\r\n  0\r\nSECTION\r\n  2\r\nOBJECTS', pairs.map(([c, v]) => String(c).padStart(3) + '\r\n' + v + '\r\n').join('') + '  0\r\nENDSEC\r\n  0\r\nSECTION\r\n  2\r\nOBJECTS');
  assert.deepEqual(style(readDxf(withData(xdata('OTHER', 2, 2, 1))).entities[0]), defaults);
  for (const bad of [[99, 2, 1], [1, -1, 1], [1, 1, 7], ['', 1, 0]]) {
    assert.deepEqual(style(readDxf(withData(xdata('PROJECTD', ...bad))).entities[0]), defaults);
  }
  const read = readDxf(withData([...xdata('PROJECTD', 1, 2, 1), ...xdata('OTHER', 2, 1, 0)]));
  assert.deepEqual(style(read.entities[0]), ['round', 'bevel', true]);
  Object.assign(read.entities[0], { cap: 'butt', join: 'miter', scaleWithObject: false });
  assert.doesNotMatch(writeDxf(read), /PROJECTD|LINE_ENDS_V1|OTHER/);
});

test('TODO 293a: Copy, Paste, Explode, Join and Undo carry entity line ends', () => {
  const raw = newDoc();
  addEntities(raw, lwpoly([[10, 10], [30, 10], [30, 30]], styled));
  const history = createHistory(); history.push(raw, 'Copy');
  const copied = { ...raw, ...copyEntities(raw, new Set([0]), 40, 0) };
  assert.deepEqual(copied.entities.map(style), [style(raw.entities[0]), style(raw.entities[0])]);
  assert.deepEqual(history.undo(copied), raw);
  assert.deepEqual(history.redo(raw), copied);
  const snapshot = copySnapshot(raw, new Set([0]), 1, 'ends');
  const target = newDoc(1);
  const pasted = pasteSnapshot(snapshot, { raw: target, factor: 25.4, space: 0, dp: 2, names: ['0'], hidden: [], locked: [], cur: '0' });
  assert.deepEqual(style(pasted.entities[0]), style(raw.entities[0]));
  const pieces = explodePolyline(raw.entities[0]);
  assert.ok(pieces.every((e) => JSON.stringify(style(e)) === JSON.stringify(style(raw.entities[0]))));
  assert.deepEqual(style(joinEntities(pieces).result), style(raw.entities[0]));
  addBlock(raw, 'ends', [raw.entities[0]]);
  assert.deepEqual(style(explodeInsert(insert('ends', 0, 0), raw).entities[0]), style(raw.entities[0]));
  Object.assign(raw.entities[0], { cap: 'round', join: 'round', scaleWithObject: false });
  assert.deepEqual(style(snapshot.raw.entities[0]), ['square', 'bevel', true], 'clipboard owns its style');
});

test('TODO 293a: LINE and polyline screen strokes and PDF bytes share caps, joins, dashes and miter limit', () => {
  for (const cap of ['butt', 'round', 'square']) for (const join of ['miter', 'round', 'bevel']) {
    const raw = newDoc();
    raw.ltypes.DASHED = { pattern: [8, -4] };
    addEntities(raw, line(10, 10, 50, 10, { cap, join, lt: 'DASHED', lw: 200 }),
      lwpoly([[10, 20], [50, 20], [50, 40]], { cap, join, lt: 'DASHED', lw: 200 }),
      line(10, 50, 50, 50, { lw: 200 }));
    const fl = flatten(readDxf(writeDxf(raw))), strokes = [];
    const c = { setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
      setLineDash(d) { this.dash = d; }, stroke() { strokes.push([this.lineCap, this.lineJoin, this.miterLimit, this.dash]); } };
    paintDrawing({ width: 1000, height: 1000, getContext: () => c }, { fl, off: new Set(), factor: 1, sheetH: 100,
      ox: 0, oy: 0, scale: 5, w: 1000, h: 1000, dpr: 1 });
    assert.deepEqual(strokes[0], [cap, join, 10, [8, 4]]);
    assert.deepEqual(strokes.at(-1), ['butt', 'miter', 10, []], 'following default resets the batch');
    const plan = planPdf({ fl, factor: 1, off: new Set(), sheetW: 100, sheetH: 100 }, { page: 'sheet', separate: false, crop: false, reg: false, strip: false });
    const page = plan.build(0), pdfStrokes = [];
    let J = 0, j = 0, M = 10, dash = [];
    for (const cmd of page.cmds) {
      if (cmd[0] === 'J') J = cmd[1]; else if (cmd[0] === 'j') j = cmd[1];
      else if (cmd[0] === 'M') M = cmd[1]; else if (cmd[0] === 'd') dash = cmd[1];
      else if (cmd[0] === 'S') pdfStrokes.push([['butt', 'round', 'square'][J], ['miter', 'round', 'bevel'][j], M, dash]);
    }
    assert.deepEqual(pdfStrokes.slice(0, 2), [[cap, join, 10, [8, 4]], [cap, join, 10, [8, 4]]]);
    assert.deepEqual(pdfStrokes[2], ['butt', 'miter', 10, []]);
    const stream = contentStream(page);
    if (cap === 'butt' && join === 'miter') assert.doesNotMatch(stream, /\b[JjM]\b/);
    else assert.match(stream, /10 M\n/, 'non-default styles explicitly set miter limit 10');
    assert.doesNotMatch(contentStream(new Page(10, 10)), /\b[JjM]\b/, 'default PDF uses PDF defaults');
    for (const cmd of page.cmds.filter((x) => ['J', 'j', 'M'].includes(x[0]))) assert.ok(stream.includes(`${cmd[1]} ${cmd[0]}\n`));
    assert.ok(Buffer.from(plan.bytes()).toString('latin1').includes(stream));
    const reshaped = patchWidths(fl, raw.entities, new Map([[1, .5]]), 1, new Set([1]));
    assert.deepEqual([reshaped.items[1].cap, reshaped.items[1].join], [cap, join], 'width reshaping retains ends');
  }
});

test('TODO 293a: adjacent solid styles split screen batches, and PDF preview restores style across q/Q', () => {
  const raw = newDoc();
  addEntities(raw, line(10, 10, 50, 10, { cap: 'round', join: 'bevel' }),
    lwpoly([[10, 20], [50, 20], [50, 40]], { cap: 'square', join: 'round' }), line(10, 50, 50, 50));
  const strokes = [], c = { setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    setLineDash() {}, stroke() { strokes.push([this.lineCap, this.lineJoin, this.miterLimit]); } };
  paintDrawing({ width: 1000, height: 1000, getContext: () => c }, { fl: flatten(raw), off: new Set(), factor: 1, sheetH: 100,
    ox: 0, oy: 0, scale: 5, w: 1000, h: 1000, dpr: 1 });
  assert.deepEqual(strokes, [['round', 'bevel', 10], ['square', 'round', 10], ['butt', 'miter', 10]]);
  const page = new Page(100, 100);
  page.lineEnds('round', 'bevel'); page.save(); page.lineEnds('square', 'round'); page.moveTo(0, 0); page.lineTo(10, 0); page.stroke();
  page.restore(); page.moveTo(0, 10); page.lineTo(10, 10); page.stroke();
  page.lineEnds(); page.moveTo(0, 20); page.lineTo(10, 20); page.stroke();
  assert.match(contentStream(page), /10 M\n1 J\n2 j\nq\n10 M\n2 J\n1 j\n/);
  const savedWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    strokes.length = 0;
    Object.assign(c, { fillRect() {}, strokeRect() {}, rect() {}, clip() {}, save() {}, restore() {} });
    paintPage({ style: {}, getContext: () => c }, page, { width: 500, height: 500 }, { paper: '#fff', film: '#000', line: '#888' });
    assert.deepEqual(strokes, [['square', 'round', 10], ['round', 'bevel', 10], ['butt', 'miter', 10]]);
  } finally {
    if (savedWindow === undefined) delete globalThis.window; else globalThis.window = savedWindow;
  }
});
