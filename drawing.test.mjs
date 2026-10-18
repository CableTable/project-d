// drawing.js — the drawing viewer's reader, layout and Measure.   node drawing.test.mjs
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const fs = await import('node:fs');
const D = await import('./web/drawing.js');
const G = await import('./web/geom.js');

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, a + ' ≠ ' + b);
const g = (...pairs) => pairs.map(([c, v]) => c + '\n' + v).join('\n');
/** A DXF of just these entities (and blocks, layers, line types when given). */
const dxf = (ents, { blocks = '', tables = '', header = '' } = {}) => [
  g([0, 'SECTION'], [2, 'HEADER']), header, g([0, 'ENDSEC']),
  g([0, 'SECTION'], [2, 'TABLES']), tables, g([0, 'ENDSEC']),
  g([0, 'SECTION'], [2, 'BLOCKS']), blocks, g([0, 'ENDSEC']),
  g([0, 'SECTION'], [2, 'ENTITIES']), ents.join('\n'), g([0, 'ENDSEC']), g([0, 'EOF'])
].filter(Boolean).join('\n') + '\n';
const lay = (text) => D.flatten(D.readDxf(text));
const sample = D.flatten(D.readDxf(D.decodeDxf(fs.readFileSync('fixtures/sample.dxf'))));

test('the sample: units, layers with their weights, what is on the model and on the sheet', () => {
  assert.equal(sample.units, 'mm');
  const L = Object.fromEntries(sample.layers.map((l) => [l.name, l]));
  assert.equal(L.OUTLINE.lw, 50); assert.equal(L.HOLES.lw, 25);
  assert.equal(L.HOLES.css, '#00ff00'); assert.equal(L.CENTRE.css, '#ff0000');
  assert.deepEqual(sample.boxes.paper, [0, 0, 297, 210]);
  assert.ok(sample.boxes.model[0] <= -10 && sample.boxes.model[2] >= 130);
  assert.deepEqual(sample.left, { IMAGE: 1 });                       // said, not hidden
  assert.equal(sample.vports.length, 1);                            // the overall one (id 1) isn't a view
  const v = sample.vports[0];
  assert.deepEqual([v.cx, v.cy, v.w, v.h, v.vcx, v.vcy, v.vh], [110, 120, 200, 150, 60, 30, 150]);
});

test('the sample: centre lines in their line type, the hatches, the leader\'s arrow, a title block\'s fields', () => {
  const centre = sample.layers.findIndex((l) => l.name === 'CENTRE');
  const lines = sample.items.filter((it) => it.L[0] === centre);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0].dash, [8, 2, 2, 2]);
  const hatch = sample.items.find((it) => it.k === 'h');
  assert.equal(hatch.fam.length, 1); near(hatch.fam[0].a, Math.PI / 4);
  assert.deepEqual(hatch.b, [5, 5, 25, 15]);
  const solid = sample.items.find((it) => it.k === 'p' && it.fill && it.css === '#808080');
  assert.deepEqual(solid.b, [100, 5, 115, 12]);
  const arrow = sample.items.find((it) => it.k === 'p' && it.fill && it.css === '#ffff00');
  near(arrow.ops[1], 110); near(arrow.ops[2], 62);                  // the arrowhead's tip is the leader's start
  const texts = sample.items.filter((it) => it.k === 't').map((it) => it.lines.join(' '));
  assert.ok(texts.includes('PLATE 12 - MS 3 mm') && texts.includes('Deburr all edges Tol +/- 0.1') && texts.includes('SEE NOTE 2'));
  const part = sample.items.find((it) => it.k === 't' && it.ps && it.lines[0] === 'PLATE 12');
  assert.ok(part, 'the attribute is on the sheet');
  assert.ok(!texts.includes('secret'), 'a hidden attribute stays hidden');
  assert.ok(!sample.items.some((it) => it.k === 't' && it.lines[0] === ''), 'an ATTDEF is not drawn');
  const wrapped = sample.items.find((it) => it.k === 't' && it.wrap === 45);
  assert.equal(wrapped.multi, 1);
});

test('blocks: placed, turned and scaled; a layer-0 part takes its insert\'s layer and colour', () => {
  const blocks = g([0, 'BLOCK'], [8, '0'], [2, 'B'], [70, 0], [10, 1], [20, 0]) + '\n'
    + g([0, 'CIRCLE'], [8, '0'], [62, 0], [10, 1], [20, 0], [40, 2]) + '\n' + g([0, 'ENDBLK'], [8, '0']);
  const fl = lay(dxf([g([0, 'INSERT'], [8, 'BOLTS'], [62, 1], [2, 'B'], [10, 10], [20, 5], [41, 2], [42, 2], [50, 90])], { blocks }));
  assert.equal(fl.items.length, 1);
  const it = fl.items[0];
  assert.equal(fl.layers[it.L[0]].name, 'BOLTS');
  assert.equal(it.css, '#ff0000');                                   // ByBlock: the insert's red
  const ix = D.pickIndex(fl, false);
  const c = ix.snaps.find((s) => s.kind === 'centre');
  near(c.x, 10); near(c.y, 5);                                       // the base point lands on the insert point
  const hit = D.pickAt(ix, 10, 9, 0.5);
  assert.equal(hit.ent.t, 'a'); near(hit.ent.r, 4);                  // scaled twice
  assert.equal(G.label(D.describe2d(hit), 'mm'), 'Ø 8 mm');
});

test('an arc drawn from below (extrusion −Z) is mirrored', () => {
  const fl = lay(dxf([g([0, 'ARC'], [8, '0'], [10, 10], [20, 0], [40, 1], [50, 0], [51, 90], [210, 0], [220, 0], [230, -1])]));
  const ix = D.pickIndex(fl, false);
  const c = ix.snaps.find((s) => s.kind === 'centre');
  near(c.x, -10); near(c.y, 0);
  const a = ix.pieces[0];
  // a quarter from 0° to 90° seen from below is 90° to 180° from above
  near(a.s, Math.PI / 2); near(a.sw, Math.PI / 2);
  assert.ok(D.pickAt(ix, -10.7, 0.7, 0.05).ent, 'on the arc');
  assert.equal(D.pickAt(ix, -9.3, 0.7, 0.05).ent, null, 'not where it was');
});

test('polylines: a bulge is an arc, a closed one closes, widths that change make filled pieces', () => {
  const fl = lay(dxf([g([0, 'LWPOLYLINE'], [8, '0'], [90, 2], [70, 0], [10, 0], [20, 0], [42, 1], [10, 2], [20, 0])]));
  const ops = fl.items[0].ops;
  assert.equal(ops[3], 2);                                           // an arc
  near(ops[4], 1); near(ops[5], 0); near(ops[6], 1);                 // a half circle about (1, 0)
  assert.deepEqual(fl.items[0].b.map((x) => Math.round(x * 1e6) / 1e6), [0, -1, 2, 0]);   // + bulge: counter-clockwise, below
  const arrowLike = lay(dxf([g([0, 'LWPOLYLINE'], [8, '0'], [90, 3], [70, 0], [10, 0], [20, 0], [40, 0], [41, 0], [10, 10], [20, 0], [40, 2], [41, 0], [10, 14], [20, 0])]));
  assert.equal(arrowLike.items.filter((it) => it.fill).length, 1);
  assert.equal(arrowLike.items.filter((it) => !it.fill).length, 1);
});

test('line types: dashes, gaps and dots become a canvas dash list', () => {
  assert.deepEqual(D.dashArray([8, -2, 2, -2]), [8, 2, 2, 2]);
  assert.deepEqual(D.dashArray([0, -2]), [0, 2]);                     // dots
  assert.deepEqual(D.dashArray([-2, 4]), [0, 2, 4, 0]);               // starts with a gap
  assert.deepEqual(D.dashArray([3, 1, -2]), [4, 2]);                  // two dashes in a row are one
  assert.equal(D.dashArray([]), null);
  assert.equal(D.dashArray([5]), null);                              // no gap: a solid line
  const tables = g([0, 'TABLE'], [2, 'LTYPE']) + '\n' + g([0, 'LTYPE'], [2, 'DASHED'], [73, 2], [40, 3], [49, 2], [49, -1]) + '\n' + g([0, 'ENDTAB']);
  const fl = lay(dxf([g([0, 'LINE'], [8, '0'], [6, 'DASHED'], [48, 2], [10, 0], [20, 0], [11, 10], [21, 0])], { tables, header: g([9, '$LTSCALE'], [40, 5]) }));
  assert.deepEqual(fl.items[0].dash, [20, 10]);                       // × $LTSCALE × its own scale
});

test('layers: off and frozen ones start hidden; ByLayer colours, ACI and true colour', () => {
  const tables = g([0, 'TABLE'], [2, 'LAYER']) + '\n' + [g([0, 'LAYER'], [2, 'OFF'], [70, 0], [62, -3]), g([0, 'LAYER'], [2, 'ICE'], [70, 1], [62, 4]),
    g([0, 'LAYER'], [2, 'TC'], [70, 0], [62, 1], [420, 0x336699])].join('\n') + '\n' + g([0, 'ENDTAB']);
  const fl = lay(dxf(['OFF', 'ICE', 'TC'].map((l) => g([0, 'LINE'], [8, l], [10, 0], [20, 0], [11, 1], [21, 0])).concat(
    g([0, 'LINE'], [8, 'TC'], [62, 5], [10, 0], [20, 0], [11, 1], [21, 1]), g([0, 'LINE'], [8, 'TC'], [420, 0xff8800], [10, 0], [20, 0], [11, 1], [21, 2])), { tables }));
  const by = Object.fromEntries(fl.layers.map((l) => [l.name, l]));
  assert.equal(by.OFF.on, false); assert.equal(by.ICE.on, false); assert.equal(by.TC.on, true);
  assert.equal(by.OFF.css, '#00ff00');
  assert.deepEqual(fl.items.map((it) => it.css), ['#00ff00', '#00ffff', '#336699', '#0000ff', '#ff8800']);
  assert.equal(fl.boxes.model[3], 2, 'the box leaves out what starts hidden');
});

test('text: TEXT\'s alignment point, MTEXT\'s codes and lines, special characters', () => {
  assert.deepEqual(D.plainText('%%c8 %%d %%p0.1', false), ['⌀8 ° ±0.1']);
  assert.deepEqual(D.plainText('{\\fArial|b1;Bold}\\PNext \\S1^2; \\pxqc;line', true), ['Bold', 'Next 1/2 line']);
  const fl = lay(dxf([g([0, 'TEXT'], [8, '0'], [10, 0], [20, 0], [11, 50], [21, 10], [40, 2.5], [72, 1], [73, 2], [50, 30], [1, 'MID'])]));
  const t = fl.items[0];
  assert.deepEqual([t.x, t.y, t.ha, t.va], [50, 10, 1, 'middle']);
  near(t.rot, Math.PI / 6);
});

test('a multileader: its line, arrow and text', () => {
  const ml = g([0, 'MULTILEADER'], [8, '0'], [100, 'AcDbEntity'], [100, 'AcDbMLeader'], [300, 'CONTEXT_DATA{'], [40, 1], [10, 30], [20, 20], [41, 2.5], [140, 3],
    [290, 1], [304, 'BREAK EDGE'], [12, 31], [22, 22], [13, 1], [23, 0], [302, 'LEADER{'], [290, 1], [291, 1], [10, 30], [20, 20], [11, 1], [21, 0], [40, 2],
    [304, 'LEADER_LINE{'], [10, 10], [20, 5], [305, '}'], [303, '}'], [301, '}']);
  const fl = lay(dxf([ml]));
  assert.ok(fl.items.some((it) => it.k === 't' && it.lines[0] === 'BREAK EDGE'));
  const line = fl.items.find((it) => it.k === 'p' && !it.fill);
  assert.deepEqual(line.ops, [0, 10, 5, 1, 30, 20]);
  const tip = fl.items.find((it) => it.fill);
  assert.deepEqual([tip.ops[1], tip.ops[2]], [10, 5]);
});

test('hatch boundaries of arcs: a clockwise edge\'s angles are mirrored', () => {
  const h = g([0, 'HATCH'], [8, '0'], [2, 'SOLID'], [70, 1], [71, 0], [91, 1], [92, 1], [93, 2],
    [72, 2], [10, 0], [20, 0], [40, 5], [50, 0], [51, 180], [73, 1], [72, 1], [10, -5], [20, 0], [11, 5], [21, 0], [97, 0], [75, 0], [76, 1], [98, 0]);
  const top = lay(dxf([h])).items[0];
  near(top.b[3], 5); near(top.b[1], 0);
  const cw = lay(dxf([h.replace('73\n1\n72\n1', '73\n0\n72\n1')])).items[0];
  near(cw.b[1], -5); near(cw.b[3], 0);
});

test('Measure: a hole\'s Ø, an arc\'s R, a line\'s length; ends, middles and centres snap', () => {
  const ix = D.pickIndex(sample, false);
  const hole = D.pickAt(ix, 30 + 12 * Math.SQRT1_2, 35 + 12 * Math.SQRT1_2, 0.5);
  assert.equal(hole.snap, null);
  assert.equal(G.label(D.describe2d(hole), 'mm'), 'Ø 24 mm');
  const arc = D.pickAt(ix, 95 + 18 * Math.cos(1), 35 + 18 * Math.sin(1), 0.5);
  assert.equal(G.label(D.describe2d(arc), 'mm'), 'R 18 mm');
  const end = D.pickAt(ix, 0.3, 0.2, 1);
  assert.equal(end.snap.kind, 'end'); assert.deepEqual(end.point, [0, 0]);
  const mid = D.pickAt(ix, 60.2, 0.1, 1);
  assert.equal(mid.snap.kind, 'mid'); assert.deepEqual(mid.point, [60, 0]);
  const centre = D.pickAt(ix, 75.3, 35.2, 1);
  assert.equal(centre.snap.kind, 'centre');
  const edge = D.pickAt(ix, 40, 0.05, 0.5);
  assert.equal(G.label(D.describe2d(edge), 'mm'), 'Length 120 mm');
  assert.equal(G.label(D.describe2d(end)), 'At x 0 · y 0');
  assert.equal(D.pickAt(ix, 300, 300, 1).ent, null);
  // a hidden layer can't be picked
  const holes = sample.layers.findIndex((l) => l.name === 'HOLES');
  assert.equal(D.pickAt(ix, 30 - 12 * Math.SQRT1_2, 35 - 12 * Math.SQRT1_2, 0.5, (i) => sample.items[i].L[0] !== holes).ent, null);
});

test('Measure: between two picks', () => {
  const ix = D.pickIndex(sample, false), at = (x, y) => D.pickAt(ix, x, y, 0.5);
  const a = at(30 + 12 * Math.SQRT1_2, 35 + 12 * Math.SQRT1_2), b = at(75 + 6 * Math.SQRT1_2, 35 + 6 * Math.SQRT1_2);
  assert.equal(G.label(D.measure2d(a, b), 'mm'), 'Centre to centre 45 mm (x 45 · y 0)');
  const bottom = at(40, 0), left = at(0, 20), side = at(120, 20);
  assert.equal(G.label(D.measure2d(left, side), 'mm'), 'Gap 120 mm');
  assert.equal(G.label(D.measure2d(bottom, side), 'mm'), 'Angle 90°');
  assert.equal(G.label(D.measure2d(a, bottom), 'mm'), 'Centre to line 35 mm');
  const corner = D.pickAt(ix, 0.2, 0.2, 1);
  assert.equal(G.label(D.measure2d(corner, side), 'mm'), 'Point to line 120 mm');
  const far = D.pickAt(ix, 119.8, 0.2, 1);
  assert.equal(G.label(D.measure2d(corner, far), 'mm'), 'Distance 120 mm (x 120 · y 0)');
});

test('the file\'s bytes: UTF-8, an old code page, and a binary DXF said plainly', () => {
  const text = dxf([g([0, 'TEXT'], [8, '0'], [10, 0], [20, 0], [40, 1], [1, 'Ø 8 — Größe'])]);
  assert.match(D.decodeDxf(new TextEncoder().encode(text)), /Ø 8 — Größe/);
  const old = Uint8Array.from(g([0, 'SECTION'], [2, 'HEADER'], [9, '$DWGCODEPAGE'], [3, 'ANSI_1252'], [0, 'ENDSEC'], [1, 'Größe']).split('').map((c) => c.charCodeAt(0)));
  assert.match(D.decodeDxf(old), /Größe/);
  assert.throws(() => D.decodeDxf(new TextEncoder().encode('AutoCAD Binary DXF\r\n\x1a\x00')), (e) => e instanceof D.DrawingError && /binary/i.test(e.message));
  assert.throws(() => D.readDxf(''), D.DrawingError);
});

test('arc helpers: a sweep, a box over the extremes', () => {
  assert.deepEqual(D.arcSweep(0, Math.PI / 2, 0), [0, Math.PI / 2]);
  const [s, sw] = D.arcSweep(0, -Math.PI / 2, 1);
  near(s, -Math.PI / 2); near(sw, Math.PI / 2);
  assert.deepEqual(D.opsBox([0, 1, 0, 2, 0, 0, 1, 0, Math.PI, 0]).map((x) => Math.round(x * 1e9) / 1e9), [-1, 0, 1, 1]);
});
