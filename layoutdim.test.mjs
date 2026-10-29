// layoutdim.js + the dimension parts of layoutdoc.js — a dimension on a layout (TODO 156b2c1).   node layoutdim.test.mjs
import assert from 'node:assert/strict';
import { line, circle, arc } from './web/dxf-write.js';
import { readDxf } from './web/drawing.js';
import { writeDxf } from './web/dxf-write.js';
import * as LD from './web/layoutdoc.js';
import * as Ed from './web/edit.js';
import { isDimPart, dimName, turnedTag, freeBlockName } from './web/layoutdim.js';
import { trimEntity } from './web/modify.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }
const near = (a, b, t = 1e-6) => assert.ok(Math.abs(a - b) <= t, a + ' != ' + b);
let ids = 0;
const newId = () => 'n' + (++ids);

function layoutWith() {
  const lay = LD.newLayout('L'), layers = LD.layersOf(lay);
  layers[Ed.DIM_LAYER] = { aci: 5, tc: 0x0f766e };
  return lay;
}
function addLine(lay, id, a, b) {
  const part = LD.objectPart(id, id, line(a[0], a[1], b[0], b[1]), LD.layersOf(lay));
  lay.parts[id] = part; lay.placed.push(LD.objectPlacement(part));
  return lay.placed.at(-1);
}
function addDim(lay, id, a, b, offset, name, kind = 'aligned', axis = null) {
  const dim = Ed.buildDim(kind, { a, b, offset, ...(axis ? { axis } : {}) }, 1, name, 2);
  const part = LD.objectPart(id, id, dim.insert, LD.layersOf(lay), {}, { [name]: dim.block });
  lay.parts[id] = part; lay.placed.push(LD.objectPlacement(part));
  return lay.placed.at(-1);
}
const dimOf = (lay, p) => { const part = lay.parts[p.partId], name = dimName(part); return { name, ...Ed.readDim(name, part.raw.blocks[name]), part }; };
const labelOf = (lay, p) => { const part = lay.parts[p.partId], b = part.raw.blocks[dimName(part)], t = b.entities.find((e) => e.type === 'TEXT'); return t.r.v[t.r.c.indexOf(1)]; };

test('a dimension object is a dimension part with its block, and its box covers the geometry', () => {
  const lay = layoutWith(), p = addDim(lay, 'd1', [0, 0], [100, 0], 10, 'PD_DIM_1');
  const part = lay.parts[p.partId];
  assert.ok(isDimPart(part));
  assert.ok(part.box[2] - part.box[0] >= 100);
  assert.ok(!isDimPart(lay.parts[addLine(lay, 'l1', [0, 0], [10, 0]).partId]));
});

test('saves into the layout file and reopens identical (block, label, placement)', () => {
  const lay = layoutWith();
  addDim(lay, 'd1', [10, 10], [110, 10], 8, 'PD_DIM_1');
  const raw = LD.layoutRaw(lay), text = writeDxf(raw), back = LD.layoutFromRaw(readDxf(text), 'L');
  assert.ok(raw.blocks.PD_DIM_1, 'the block is in the file');
  const objs = Object.values(back.parts).filter((q) => q.obj);
  assert.equal(objs.length, 1);
  assert.ok(isDimPart(objs[0]));
  const q = back.placed[0], part = back.parts[q.partId], bb = part.raw.blocks[dimName(part)];
  assert.equal(bb.entities.find((e) => e.type === 'TEXT').r.v[bb.entities.find((e) => e.type === 'TEXT').r.c.indexOf(1)], '100.00');
  const was = lay.parts[lay.placed[0].partId].box;
  near(part.box[0], was[0], 1e-4); near(part.box[3], was[3], 1e-4);
  assert.deepEqual(Ed.readDim(dimName(part), bb).kind, 'aligned');
});

test('Move: the placement is baked into the block (a translate), name and label stay', () => {
  const lay = layoutWith(), p = addDim(lay, 'd1', [0, 0], [100, 0], 10, 'PD_DIM_1'), was = lay.parts['d1'].box.slice();
  p.x += 50; p.y += 20;
  assert.equal(LD.settleDims(lay, newId), true);
  const part = lay.parts[p.partId], d = dimOf(lay, p);
  assert.notEqual(p.partId, 'd1');
  assert.equal(lay.parts['d1'], undefined, 'the old part is dropped');
  near(part.box[0], was[0] + 50); near(part.box[1], was[1] + 20);
  near(p.x, part.box[0]); near(p.y, part.box[1]);
  assert.equal(d.name, 'PD_DIM_1');
  near(d.params.a[0], 50); near(d.params.a[1], 20); near(d.params.b[0], 150);
  assert.equal(labelOf(lay, p), '100.00');
  assert.equal(LD.settleDims(lay, newId), false, 'settled: nothing more to do');
});

test('Scale re-labels; Rotate 90 swaps a Linear dimension H / V and turns the text; Mirror keeps the label', () => {
  const lay = layoutWith(), p = addDim(lay, 'd1', [0, 0], [100, 0], 10, 'PD_DIM_H1', 'linear', 'h');
  p.sc = 2;
  LD.settleDims(lay, newId);
  assert.equal(labelOf(lay, p), '200.00');
  assert.equal(p.sc, undefined);
  p.rot = 90;
  LD.settleDims(lay, newId);
  assert.match(dimName(lay.parts[p.partId]), /^PD_DIM_V\d+$/);
  const tx = lay.parts[p.partId].raw.blocks[dimName(lay.parts[p.partId])].entities.find((e) => e.type === 'TEXT');
  near(+tx.r.v[tx.r.c.indexOf(50)], 90);
  p.mirrorX = true;
  LD.settleDims(lay, newId);
  assert.equal(labelOf(lay, p), '200.00');
  p.rot = 33;
  LD.settleDims(lay, newId);
  assert.match(dimName(lay.parts[p.partId]), /^PD_DIM_\d+$/, 'turned off the axes: Aligned');
});

test('a copy sharing a part gets a part and a block name of its own', () => {
  const lay = layoutWith(), p = addDim(lay, 'd1', [0, 0], [100, 0], 10, 'PD_DIM_1');
  const q = { ...p, x: p.x + 200 };
  lay.placed.push(q);
  LD.settleDims(lay, newId);
  assert.notEqual(q.partId, p.partId);
  assert.notEqual(dimName(lay.parts[q.partId]), dimName(lay.parts[p.partId]));
  assert.equal(new Set(lay.placed.map((x) => dimName(lay.parts[x.partId]))).size, 2);
});

test('a dimension on an object follows it when it moves, and when a grip edit changes it', () => {
  const lay = layoutWith(), l = addLine(lay, 'l1', [0, 0], [100, 0]), d = addDim(lay, 'd1', [0, 0], [100, 0], 10, 'PD_DIM_1');
  const prev = LD.linkView(lay);
  l.x += 30; l.y += 5;
  LD.settleDims(lay, newId);
  assert.equal(LD.followDims(lay, prev, LD.linkView(lay), newId), true);
  let m = dimOf(lay, d);
  near(m.params.a[0], 30); near(m.params.a[1], 5); near(m.params.b[0], 130);
  assert.equal(labelOf(lay, d), '100.00');
  // grip edit: the line's end moves to 180 (objectReplace: same slot, new part)
  const prev2 = LD.linkView(lay), view = LD.objectDoc(lay), ent = view.raw.entities[0];
  assert.ok(LD.objectReplace(lay, view, ent, line(30, 5, 180, 5), newId));
  assert.equal(LD.followDims(lay, prev2, LD.linkView(lay), newId), true);
  m = dimOf(lay, d);
  near(m.params.b[0], 180);
  assert.equal(labelOf(lay, d), '150.00');
});

test('moving only the dimension, or a shape it does not measure, leaves the links alone', () => {
  const lay = layoutWith(), l = addLine(lay, 'l1', [0, 0], [100, 0]), far = addLine(lay, 'l2', [0, 50], [100, 50]), d = addDim(lay, 'd1', [0, 0], [100, 0], 10, 'PD_DIM_1');
  const prev = LD.linkView(lay);
  far.x += 10;
  assert.equal(LD.followDims(lay, prev, LD.linkView(lay), newId), false);
  const prev2 = LD.linkView(lay);
  d.y += 7; LD.settleDims(lay, newId);
  assert.equal(LD.followDims(lay, prev2, LD.linkView(lay), newId), false);
  near(dimOf(lay, d).params.a[1], 7);
  assert.ok(l);
});

const blockLabel = (b) => { const t = b.entities.find((e) => e.type === 'TEXT'); return t.r.v[t.r.c.indexOf(1)]; };

test('a dimension whose block name a placed drawing already has gets a name of its own; both survive save and reopen', () => {
  const lay = layoutWith(), mine = Ed.buildDim('aligned', { a: [0, 0], b: [10, 0], offset: 5 }, 1, 'PD_DIM_1', 2);
  const drawing = LD.makePart('pd', 'Drawing', { header: {}, layers: { 0: { aci: 7 }, [Ed.DIM_LAYER]: { aci: 5 } }, ltypes: {}, blocks: { PD_DIM_1: mine.block }, entities: [line(0, 0, 10, 0), mine.insert] }, 1);
  addDim(lay, 'd1', [0, 0], [100, 0], 10, 'PD_DIM_1');
  lay.parts.pd = drawing; lay.placed.push(LD.objectPlacement(drawing));
  assert.equal(LD.settleDims(lay, newId), true);
  const name = dimName(lay.parts[lay.placed[0].partId]);
  assert.notEqual(name, 'PD_DIM_1');
  const raw = LD.layoutRaw(lay);
  assert.equal(blockLabel(raw.blocks.PD_DIM_1), '10.00', 'the drawing keeps its own block');
  assert.equal(blockLabel(raw.blocks[name]), '100.00');
  const back = LD.layoutFromRaw(readDxf(writeDxf(raw)), 'L'), dims = Object.values(back.parts).filter((q) => q.obj && isDimPart(q));
  assert.equal(dims.length, 1);
  assert.equal(blockLabel(dims[0].raw.blocks[dimName(dims[0])]), '100.00');
  assert.equal(LD.settleDims(lay, newId), false, 'settled: nothing more to do');
});

test('two dimensions with the same block name (one pasted from another layout) keep their own blocks', () => {
  const a = layoutWith(), b = layoutWith();
  addDim(a, 'da', [0, 0], [100, 0], 10, 'PD_DIM_1');
  const pb = addDim(b, 'db', [0, 0], [40, 0], 10, 'PD_DIM_1');
  a.parts.db = b.parts.db; a.placed.push({ ...pb, y: pb.y + 50 });
  LD.settleDims(a, newId);
  const names = a.placed.map((p) => dimName(a.parts[p.partId]));
  assert.equal(new Set(names).size, 2);
  const raw = LD.layoutRaw(a), back = LD.layoutFromRaw(readDxf(writeDxf(raw)), 'L');
  assert.deepEqual(a.placed.map((p) => blockLabel(raw.blocks[dimName(a.parts[p.partId])])), ['100.00', '40.00']);
  assert.deepEqual(back.placed.map((p) => blockLabel(back.parts[p.partId].raw.blocks[dimName(back.parts[p.partId])])).sort(), ['100.00', '40.00']);
});

test('a turned or mirrored dimension keeps its text parallel to the line and upright', () => {
  const angle = (lay, p) => { const part = lay.parts[p.partId], t = part.raw.blocks[dimName(part)].entities.find((e) => e.type === 'TEXT'), k = t.r.c.indexOf(50); return k < 0 ? 0 : +t.r.v[k]; };
  const lineAngle = (lay, p) => { const m = dimOf(lay, p).params; return Math.atan2(m.b[1] - m.a[1], m.b[0] - m.a[0]) / (Math.PI / 180); };
  const upright = (a) => a <= 90 + 1e-6 || a > 270 + 1e-6;
  const parallel = (a, b) => { const d = (((a - b) % 180) + 180) % 180; return d < 1e-6 || 180 - d < 1e-6; };
  for (const [rot, mirrorX] of [[0, true], [180, false], [45, false], [45, true], [200, false], [90, true], [270, false]]) {
    const lay = layoutWith(), p = addDim(lay, 'd1', [0, 0], [100, 100], 10, 'PD_DIM_1');
    p.rot = rot; if (mirrorX) p.mirrorX = true;
    LD.settleDims(lay, newId);
    const a = angle(lay, p);
    assert.ok(upright(a), `rot ${rot} mirror ${mirrorX}: text at ${a} reads upside down`);
    assert.ok(parallel(a, lineAngle(lay, p)), `rot ${rot} mirror ${mirrorX}: text at ${a}, line at ${lineAngle(lay, p)}`);
  }
  const lay = layoutWith(), p = addDim(lay, 'd1', [0, 0], [100, 0], 10, 'PD_DIM_1');
  p.rot = 180; LD.settleDims(lay, newId);
  near(angle(lay, p), 0);
});

test('deleting one of two copies of a line does not move its dimension onto the other copy', () => {
  const lay = layoutWith(), a = addLine(lay, 'l1', [0, 0], [100, 0]), d = addDim(lay, 'd1', [0, 0], [100, 0], 10, 'PD_DIM_1');
  const b = { ...a, y: a.y + 500 };
  lay.placed.push(b);
  const prev = LD.linkView(lay);
  lay.placed.splice(lay.placed.indexOf(a), 1);
  assert.equal(LD.followDims(lay, prev, LD.linkView(lay), newId), false);
  near(dimOf(lay, d).params.a[1], 0);
  // ...but moving a copy still drags its dimension
  const lay2 = layoutWith(), a2 = addLine(lay2, 'l1', [0, 0], [100, 0]), d2 = addDim(lay2, 'd1', [0, 0], [100, 0], 10, 'PD_DIM_1');
  const b2 = { ...a2, y: a2.y + 500 };
  lay2.placed.push(b2);
  const prev2 = LD.linkView(lay2);
  a2.x += 20;
  assert.equal(LD.followDims(lay2, prev2, LD.linkView(lay2), newId), true);
  near(dimOf(lay2, d2).params.a[0], 20);
});

test('a mirrored or half-turned dimension keeps its text on its own side of the dimension line', () => {
  // [y of the dimension line, y of the text's middle] read from the block (text 73: 1 = bottom-aligned, 3 = top-aligned)
  const sides = (lay, p) => {
    const b = lay.parts[p.partId].raw.blocks[dimName(lay.parts[p.partId])], ln = b.entities.find((e) => e.type === 'LINE'), t = b.entities.find((e) => e.type === 'TEXT');
    const f = (e, c) => +e.r.v[e.r.c.indexOf(c)], h = f(t, 40), va = f(t, 73), y = f(t, 20);
    const lo = va === 3 ? y - h : y, hi = lo + h, ly = f(ln, 20);
    assert.ok(lo >= ly - 1e-6 || hi <= ly + 1e-6, `text ${lo}..${hi} crosses the dimension line at ${ly}`);
    return Math.sign((lo + hi) / 2 - ly);
  };
  const lay0 = layoutWith(), p0 = addDim(lay0, 'd1', [0, 0], [100, 0], 10, 'PD_DIM_1');
  const own = sides(lay0, p0);
  for (const [name, set, want] of [['rot 180', (p) => { p.rot = 180; }, -own], ['mirrorY', (p) => { p.mirrorY = true; }, -own], ['mirrorX', (p) => { p.mirrorX = true; }, own]]) {
    const lay = layoutWith(), p = addDim(lay, 'd1', [0, 0], [100, 0], 10, 'PD_DIM_1');
    set(p); LD.settleDims(lay, newId);
    assert.equal(sides(lay, p), want, name);
  }
});

test('a grip edit on a copy that shares its part keeps its dimension following', () => {
  const lay = layoutWith(), a = addLine(lay, 'l1', [0, 0], [100, 0]), d = addDim(lay, 'd1', [0, 0], [100, 0], 10, 'PD_DIM_1');
  const b = { ...a, y: a.y + 500 };
  lay.placed.push(b);
  LD.settleDims(lay, newId);
  const prev = LD.linkView(lay), view = LD.objectDoc(lay), ent = view.raw.entities.find((e) => e.type === 'LINE');
  assert.ok(LD.objectReplace(lay, view, ent, line(0, 0, 160, 0), newId));
  assert.equal(new Set([lay.placed[0], lay.placed[2]].map((q) => lay.parts[q.partId].name)).size, 2);   // the edited copy got a part name of its own
  LD.settleDims(lay, newId);
  assert.equal(LD.followDims(lay, prev, LD.linkView(lay), newId), true);
  near(dimOf(lay, d).params.b[0], 160);
});

for (const [slot, where] of ['first', 'middle', 'last'].entries()) test(`Trim of the ${where} shared copy: only its dimension follows by slot`, () => {
  const lay = layoutWith(), a = addLine(lay, 'l1', [0, 0], [100, 0]);
  lay.placed.push({ ...a, y: 50 }, { ...a, y: 100 });
  const dims = [0, 50, 100].map((y, i) => addDim(lay, 'd' + i, [0, y], [100, y], 10, `PD_DIM_${i + 1}`));
  const blocks = dims.map((p) => { const q = lay.parts[p.partId]; return q.raw.blocks[dimName(q)]; });
  const prev = LD.linkView(lay), view = LD.objectDoc(lay), ent = view.raw.entities[slot];
  const cut = trimEntity(ent, [line(60, -10, 60, 110)], [90, slot * 50]);
  assert.equal(cut.ents.length, 1);
  LD.objectCommit(lay, view, view.raw.entities.flatMap((e) => e === ent ? cut.ents : [e]), newId);
  LD.settleDims(lay, newId);
  assert.equal(LD.followDims(lay, prev, LD.linkView(lay), newId), true);
  assert.equal(LD.objectDoc(lay).raw.entities[slot], cut.ents[0], 'Trim keeps the edited copy in its slot');
  dims.forEach((p, i) => {
    const d = dimOf(lay, p);
    near(d.params.a[0], 0); near(d.params.a[1], i * 50);
    near(d.params.b[0], i === slot ? 60 : 100); near(d.params.b[1], i * 50);
    assert.equal(labelOf(lay, p), i === slot ? '60.00' : '100.00');
    if (i !== slot) assert.equal(d.part.raw.blocks[d.name], blocks[i], 'another copy\'s dimension block is untouched');
  });
});

for (const kind of ['radius', 'diameter']) for (const shape of ['circle', 'arc']) {
  const tag = kind === 'radius' ? 'R' : 'D';
  const makeShape = (r) => shape === 'circle' ? circle(100, 100, r) : arc(100, 100, r, 20, 160);
  const setup = () => {
    const lay = layoutWith(), part = LD.objectPart('s', 'Shape', makeShape(20), LD.layersOf(lay));
    lay.parts.s = part; lay.placed.push(LD.objectPlacement(part));
    const params = kind === 'radius' ? { c: [100, 100], r: 20, p: [130, 130] } : { a: [80, 100], b: [120, 100], offset: 0 };
    const dim = Ed.buildDim(kind, params, 1, `PD_DIM_${tag}1`, 3), dp = LD.objectPart('d', 'Dimension', dim.insert, LD.layersOf(lay), {}, { [dim.name]: dim.block });
    lay.parts.d = dp; lay.placed.push(LD.objectPlacement(dp));
    return lay;
  };
  const centreRadius = (d) => {
    const p = d.params;
    return kind === 'radius' ? [...p.c, p.r] : [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) / 2];
  };

  test(`${kind} on a ${shape}: R/D block saves and reopens as a dimension object`, () => {
    const lay = setup(), back = LD.layoutFromRaw(readDxf(writeDxf(LD.layoutRaw(lay))), 'L');
    const p = back.placed.find((q) => isDimPart(back.parts[q.partId]));
    assert.ok(p);
    assert.equal(dimOf(back, p).kind, kind);
    assert.equal(dimOf(back, p).name, `PD_DIM_${tag}1`);
    centreRadius(dimOf(back, p)).forEach((v, i) => near(v, [100, 100, 20][i]));
    assert.equal(labelOf(back, p).replace('\\U+00D8', 'Ø'), kind === 'radius' ? 'R20.000' : 'Ø40.000');
  });

  test(`${kind} on a ${shape}: follows Scale, Move, rotation, mirror and a radius grip`, () => {
    const lay = setup(), p = lay.placed[0], d = lay.placed[1];
    const follow = (change) => {
      const prev = LD.linkView(lay);
      change(); LD.settleDims(lay, newId);
      assert.equal(LD.followDims(lay, prev, LD.linkView(lay), newId), true);
      const q = Ed.circleOf(LD.objectDoc(lay).raw.entities[0]);
      centreRadius(dimOf(lay, d)).forEach((v, i) => near(v, [...q.c, q.r][i]));
    };
    follow(() => { p.sc = 2; });
    assert.equal(labelOf(lay, d), kind === 'radius' ? 'R40.000' : 'Ø80.000');
    follow(() => { p.x += 30; p.y += 5; });
    follow(() => { p.rot = 90; });
    follow(() => { p.mirrorX = true; });
    follow(() => {
      const view = LD.objectDoc(lay), ent = view.raw.entities[0], q = Ed.circleOf(ent);
      const next = { ...ent, r: { ...ent.r, v: ent.r.v.map((v, i) => ent.r.c[i] === 40 ? String(q.r + 10) : v) } };
      assert.ok(LD.objectReplace(lay, view, ent, next, newId));
    });
    assert.equal(labelOf(lay, d), kind === 'radius' ? 'R50.000' : 'Ø100.000');
  });

  test(`${kind}: baking its own scale, rotation and mirror keeps its tag and measured value`, () => {
    const lay = setup(), d = lay.placed[1];
    d.sc = 2; d.rot = 35; d.mirrorX = true;
    assert.equal(LD.settleDims(lay, newId), true);
    assert.equal(dimOf(lay, d).kind, kind);
    assert.equal(labelOf(lay, d), kind === 'radius' ? 'R40.000' : 'Ø80.000');
    near(centreRadius(dimOf(lay, d))[2], 40);
    assert.equal(LD.settleDims(lay, newId), false);
  });
}

test('names: turnedTag and freeBlockName', () => {
  assert.equal(turnedTag('H', 90), 'V'); assert.equal(turnedTag('V', 270), 'H'); assert.equal(turnedTag('H', 180), 'H'); assert.equal(turnedTag('H', 45), '');
  assert.equal(turnedTag('', 90), ''); assert.equal(turnedTag('R', 45), 'R');
  assert.equal(freeBlockName(new Set(['PD_DIM_1', 'PD_DIM_2']), ''), 'PD_DIM_3');
  assert.equal(freeBlockName(new Set(['pd_dim_1', 'pd_dim_h1']), ''), 'PD_DIM_2'); assert.equal(freeBlockName(new Set(['pd_dim_h1']), 'H'), 'PD_DIM_H2');
  assert.equal(freeBlockName(new Set(['pd_dim_r1']), 'R'), 'PD_DIM_R2');
  assert.equal(freeBlockName(new Set(['pd_dim_d1']), 'D'), 'PD_DIM_D2');
});

console.log(n + ' tests');
