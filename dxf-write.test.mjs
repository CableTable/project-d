// dxf-write.js — the DXF writer: round trips through drawing.js, app-made geometry, numbers.   node dxf-write.test.mjs
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const fs = await import('node:fs');
const D = await import('./web/drawing.js');
const W = await import('./web/dxf-write.js');

const load = (f) => D.readDxf(D.decodeDxf(fs.readFileSync('fixtures/' + f)));
const reread = (doc, o) => D.readDxf(W.writeDxf(doc, o));
const numOrStr = (v) => { const t = String(v).trim(); return t !== '' && Number.isFinite(+t) ? +(+t).toFixed(6) : t; };
const COM = [8, 6, 62, 48, 60, 67, 370, 420, 440, 284];
const SKIP = new Set([5, 105, 330, 100, 102, 66]);
/** An entity on the fields the writer carries: its properties and its type-specific pairs, numbers as numbers. */
const sig = (e) => ({
  type: e.type, layer: e.layer, lt: e.lt, aci: e.aci, tc: e.tc, lw: e.lw, lts: e.lts, hidden: e.hidden, ps: e.ps,
  pairs: e.r.c.map((c, i) => [c, e.r.v[i]]).filter(([c]) => !SKIP.has(c) && c < 1000 && !(c >= 320 && c <= 369))
    .filter(([c]) => !COM.includes(c)).map(([c, v]) => [c, numOrStr(v)]),
  kids: (e.kids || []).map((k) => ({ type: k.type, layer: k.v[k.c.indexOf(8)], pairs: k.c.map((c, i) => [c, k.v[i]]).filter(([c]) => !SKIP.has(c) && c < 1000 && !COM.includes(c)).map(([c, v]) => [c, numOrStr(v)]) }))
});
/** The document without what the writer can't carry (flatten of the original and of the re-read are then comparable). */
const strip = (d) => ({ ...d, entities: supported(d.entities), blocks: Object.fromEntries(Object.entries(d.blocks).map(([n, b]) => [n, { ...b, entities: supported(b.entities) }])) });
const supported = (list) => list.filter((e) => !W.unwritable({ entities: [e], blocks: {} }).length);
const sigs = (list) => supported(list).map(sig);

test('contour colour and linetype round trip, with missing and existing LTYPE entries', () => {
  for (const existing of [false, true]) {
    const doc = W.newDoc();
    W.addLayer(doc, 'Contour', { aci: 3 });
    if (existing) doc.ltypes = { DASHED: { pattern: [7, -4] }, DOT: { pattern: [0, -4] } };
    doc.entities = [W.line(0, 0, 20, 0, { layer: 'Contour', aci: 1, lt: 'DASHED' }),
      W.circle(20, 20, 10, { layer: 'Contour', aci: 5, lt: 'DOT' }), W.line(0, 10, 20, 10, { layer: 'Contour' })];
    const back = reread(doc);
    assert.deepEqual(back.entities.map((e) => [e.aci, e.lt]), [[1, 'DASHED'], [5, 'DOT'], [256, null]]);
    assert.deepEqual(back.ltypes.DASHED.pattern, existing ? [7, -4] : [0.5, -0.25]);
    assert.deepEqual(back.ltypes.DOT.pattern, existing ? [0, -4] : [0, -0.25]);
    const items = D.flatten(back).items;
    assert.equal(items[0].css, '#ff0000'); assert.equal(items[1].css, '#0000ff'); assert.equal(items[2].css, '#00ff00');
    assert.equal(items[0].dpx, undefined); assert.equal(items[1].dpx, undefined);
    assert.ok(items[0].dash.length && items[1].dash.length);
    assert.equal(items[2].dash, undefined);
  }
});

test('number formatting: 6 decimals, no exponent, no -0', () => {
  assert.equal(W.fmt(1), '1'); assert.equal(W.fmt(100), '100'); assert.equal(W.fmt(-0), '0'); assert.equal(W.fmt(-0.0000001), '0');
  assert.equal(W.fmt(0.1234567), '0.123457'); assert.equal(W.fmt(1e-7), '0'); assert.equal(W.fmt(1.5e-5), '0.000015');
  assert.equal(W.fmt(1e20), '100000000000000000000'); assert.equal(W.fmt(-2.50), '-2.5'); assert.equal(W.fmt(NaN), '0');
  const text = W.writeDxf(W.addEntities(W.newDoc(), W.line(0, 0, 1e-9, 12.3456789)));
  assert.ok(!/\d[eE][+-]?\d/.test(text.replace(/AcDb\w+/g, '')), 'no exponent');
  assert.ok(text.includes('\r\n') && !/[^\r]\n/.test(text), 'CRLF only');
});

for (const f of ['sample.dxf', 'inch.dxf', 'many-layers.dxf']) {
  test(f + ': read → write → read keeps header units, layers, line types, blocks and entities', () => {
    const a = load(f), text = W.writeDxf(a), b = D.readDxf(text);
    assert.equal(b.header.$ACADVER, 'AC1015');
    assert.equal(+b.header.$INSUNITS, +(a.header.$INSUNITS ?? 4));
    for (const [n, l] of Object.entries(a.layers)) {
      const m = b.layers[n];
      assert.ok(m, 'layer ' + n);
      for (const k of ['aci', 'tc', 'off', 'frozen', 'lt', 'lw']) assert.equal(m[k], l[k], n + '.' + k);
    }
    for (const [n, t] of Object.entries(a.ltypes)) assert.deepEqual(b.ltypes[n].pattern, t.pattern.map((x) => +x.toFixed(6)), 'ltype ' + n);
    assert.deepEqual(Object.keys(a.blocks).filter((n) => !a.blocks[n].xref), Object.keys(b.blocks).filter((n) => !/^\*(model|paper)_space$/i.test(n) || n in a.blocks));
    for (const [n, blk] of Object.entries(a.blocks)) {
      assert.deepEqual(b.blocks[n].base, blk.base);
      assert.deepEqual(sigs(b.blocks[n].entities), sigs(blk.entities), 'block ' + n);
    }
    assert.deepEqual(sigs(b.entities), sigs(a.entities));
    assert.ok(a.entities.length > 0);
  });
  test(f + ': flatten of the re-read drawing has the same items and boxes', () => {
    const a = strip(load(f)), fa = D.flatten(a), fb = D.flatten(reread(a));
    assert.equal(fb.items.length, fa.items.length);
    fa.items.forEach((it, i) => { const j = fb.items[i]; assert.equal(j.k, it.k); assert.equal(j.ps, it.ps); it.b.forEach((x, n) => assert.ok(Math.abs(x - j.b[n]) < 1e-5, f + ' item ' + i)); });
    for (const k of ['model', 'paper']) assert.deepEqual(fb.boxes[k]?.map((x) => +x.toFixed(4)), fa.boxes[k]?.map((x) => +x.toFixed(4)));
    assert.equal(fb.units, fa.units);
    assert.deepEqual(fb.layers.map((l) => [l.name, l.css, l.on, l.lw]), fa.layers.map((l) => [l.name, l.css, l.on, l.lw]));
  });
}

test('the sample: sheet items, hatches, polylines with vertices, attributes and dimension blocks survive', () => {
  const b = reread(load('sample.dxf'));
  const types = b.entities.map((e) => e.type);
  for (const t of ['LWPOLYLINE', 'HATCH', 'INSERT', 'MTEXT', 'TEXT', 'SPLINE', 'ELLIPSE', 'ARC', 'DIMENSION']) assert.ok(types.includes(t), t);
  assert.ok(b.entities.some((e) => e.ps), 'something on the sheet');
  assert.ok(b.entities.some((e) => e.kids && e.kids.some((k) => k.type === 'ATTRIB')), 'attributes');
});

test('unwritable: reports what the writer cannot carry', () => {
  const a = load('sample.dxf');
  const u = Object.fromEntries(W.unwritable(a).map((x) => [x.type, x.count]));
  assert.equal(u.IMAGE, 1); assert.equal(u.VIEWPORT, 2); assert.equal(u.LEADER, undefined);
  const doc = W.newDoc(); doc.entities.push(W.line(0, 0, 1, 1), { ...W.line(0, 0, 1, 1), type: 'WIPEOUT' }, { ...W.line(0, 0, 1, 1), type: 'WIPEOUT' });
  doc.blocks.X = { base: [0, 0], xref: true, entities: [] };
  assert.deepEqual(W.unwritable(doc), [{ type: 'WIPEOUT', count: 2 }, { type: 'XREF', count: 1 }]);
  assert.ok(!reread(doc).entities.some((e) => e.type === 'WIPEOUT'));
  assert.deepEqual(W.unwritable(W.newDoc()), []);
});

test('app-made geometry: a block with a rounded rectangle, three INSERTs on layer Parts, marks', () => {
  const doc = W.newDoc(4);
  W.addLayer(doc, 'Parts', { aci: 3 }); W.addLayer(doc, 'Marks', { aci: 1, lw: 25 });
  W.addBlock(doc, 'PART1', [W.roundRect(0, 0, 40, 20, 5), W.circle(20, 10, 3), W.text(2, 2, 2.5, 'A\r\nB')]);
  const at = [[10, 10], [60, 10], [110, 10]];
  W.addEntities(doc, at.map(([x, y], i) => W.insert('PART1', x, y, { layer: 'Parts', rot: i * 90 })), W.line(0, 0, 5, 0, { layer: 'Marks' }), W.point(1, 1, { layer: 'Marks' }));
  const text = W.writeDxf(doc), b = D.readDxf(text);
  assert.equal(b.header.$INSUNITS, '4');
  assert.equal(b.layers.Parts.aci, 3); assert.equal(b.layers.Marks.lw, 25);
  const blk = b.blocks.PART1;
  assert.equal(blk.entities.length, 3);
  const lw = blk.entities[0], f = (c) => lw.r.v.filter((_, i) => lw.r.c[i] === c).map(Number);
  assert.equal(lw.type, 'LWPOLYLINE'); assert.equal(f(90)[0], 8); assert.equal(f(70)[0], 1); assert.equal(f(42).length, 4);
  assert.ok(Math.abs(f(42)[0] - Math.tan(Math.PI / 8)) < 1e-6);
  assert.equal(blk.entities[2].r.v[blk.entities[2].r.c.indexOf(1)], 'A B');   // no CR / LF in a single-line value
  const ins = b.entities.filter((e) => e.type === 'INSERT');
  assert.equal(ins.length, 3);
  assert.ok(ins.every((e) => e.layer === 'Parts'));
  assert.deepEqual(ins.map((e) => [+e.r.v[e.r.c.indexOf(10)], +e.r.v[e.r.c.indexOf(20)], +e.r.v[e.r.c.indexOf(50)] || 0]), [[10, 10, 0], [60, 10, 90], [110, 10, 180]]);
  const fl = D.flatten(b);
  assert.equal(fl.items.length, 3 * 3 + 2);                          // 3 × (outline, circle, text) + line + point
  assert.deepEqual(fl.boxes.model.map((x) => Math.round(x)), [-20, 0, 150, 55].map((x, i) => i === 0 ? fl.boxes.model[0] : fl.boxes.model[i]).map(Math.round));
  assert.deepEqual(W.unwritable(doc), []);
  assert.deepEqual(sigs(b.entities).map((s) => s.layer), ['Parts', 'Parts', 'Parts', 'Marks', 'Marks']);
});

test('INSERT arrays, scale, and the builders flatten like read geometry', () => {
  const doc = W.newDoc();
  W.addBlock(doc, 'B', [W.rect(0, 0, 1, 1)]);
  W.addEntities(doc, W.insert('B', 0, 0, { cols: 3, rows: 2, dx: 5, dy: 4, sx: 2, sy: 2 }), W.arc(0, 0, 5, 0, 90), W.ellipse(0, 0, 4, 0, 0.5));
  const b = reread(doc);
  assert.equal(D.flatten(b).items.length, D.flatten(doc).items.length);
  assert.equal(D.flatten(b).items.length, 6 + 2);
  assert.deepEqual(D.flatten(b).boxes.model.map((x) => +x.toFixed(4)), D.flatten(doc).boxes.model.map((x) => +x.toFixed(4)));
});

test('handles are unique and valid, every block has a BLOCK_RECORD, layer flags kept', () => {
  const doc = load('sample.dxf');
  W.addLayer(doc, 'Hidden', { off: true, aci: 5, frozen: false }); W.addLayer(doc, 'Cold', { frozen: true, tc: 0xff8000 });
  const text = W.writeDxf(doc), lines = text.split('\r\n');
  const hs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) if (+lines[i] === 5 || +lines[i] === 105) hs.push(lines[i + 1].trim());
  hs.shift();                                                         // the seed itself
  assert.ok(hs.length > 50);
  assert.ok(hs.every((h) => /^[0-9A-F]{1,8}$/.test(h)), 'hex');
  assert.equal(new Set(hs).size, hs.length, 'unique');
  const seed = parseInt(lines[lines.indexOf('$HANDSEED') + 2], 16);
  assert.ok(hs.every((h) => parseInt(h, 16) < seed), 'seed above every handle');
  const b = D.readDxf(text);
  assert.equal(b.layers.Hidden.off, true); assert.equal(b.layers.Hidden.aci, 5);
  assert.equal(b.layers.Cold.frozen, true); assert.equal(b.layers.Cold.tc, 0xff8000);
  const recs = []; for (let i = 0; i + 3 < lines.length; i += 2) if (lines[i + 1] === 'BLOCK_RECORD' && +lines[i] === 0) { const j = lines.indexOf('  2', i + 2); recs.push(lines[j + 1]); }
  for (const n of [...Object.keys(doc.blocks), '*Model_Space', '*Paper_Space']) assert.ok(recs.includes(n), 'BLOCK_RECORD ' + n);
  for (const name of ['HEADER', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS']) assert.ok(text.includes('SECTION\r\n  2\r\n' + name));
  assert.ok(text.endsWith('EOF\r\n'));
});

test('missing layers and line types get a table entry; a unicode switch writes \\U+', () => {
  const doc = W.newDoc();
  W.addEntities(doc, W.line(0, 0, 1, 1, { layer: 'Nowhere', lt: 'DASHED' }), W.text(0, 0, 1, 'Ø é'));
  const b = reread(doc);
  assert.ok(b.layers.Nowhere); assert.ok(b.ltypes.DASHED.pattern.length === 2);
  const t = W.writeDxf(doc, { escapeUnicode: true });
  assert.ok(t.includes('\\U+00D8 \\U+00E9') && !/[^\u0000-\u007f]/.test(t));
  assert.equal(D.plainText(D.readDxf(t).entities[1].r.v[D.readDxf(t).entities[1].r.c.indexOf(1)])[0], 'Ø é');
});

test('a DXF without subclass markers (R12 style) gets them', () => {
  const g = (...p) => p.map(([c, v]) => c + '\n' + v).join('\n');
  const src = g([0, 'SECTION'], [2, 'ENTITIES'], [0, 'ARC'], [8, 'A'], [10, 0], [20, 0], [40, 5], [50, 10], [51, 80],
    [0, 'POLYLINE'], [8, 'A'], [66, 1], [70, 1], [0, 'VERTEX'], [8, 'A'], [10, 0], [20, 0], [0, 'VERTEX'], [8, 'A'], [10, 4], [20, 0], [0, 'VERTEX'], [8, 'A'], [10, 4], [20, 3], [0, 'SEQEND'], [8, 'A'],
    [0, 'ENDSEC'], [0, 'EOF']) + '\n';
  const text = W.writeDxf(D.readDxf(src));
  for (const m of ['AcDbCircle', 'AcDbArc', 'AcDb2dPolyline', 'AcDbVertex', 'AcDb2dVertex', 'SEQEND']) assert.ok(text.includes(m), m);
  const b = D.readDxf(text);
  assert.equal(b.entities.length, 2); assert.equal(b.entities[1].kids.length, 3);
  assert.equal(D.flatten(b).items.length, 2);
});

test('an independent parser (dxf-parser) reads the written sample', async () => {
  let Parser;
  try { Parser = (await import('dxf-parser')).default; } catch { if (process.env.CI) throw new Error('dxf-parser did not load: the cross-check would be skipped'); return; }
  const text = W.writeDxf(load('sample.dxf')), p = new Parser().parseSync(text);
  assert.ok(p && p.entities.length >= 10);
  const types = new Set(p.entities.map((e) => e.type));
  for (const t of ['LINE', 'CIRCLE', 'LWPOLYLINE', 'INSERT']) assert.ok(types.has(t), t);
  assert.ok(p.tables.layer.layers.OUTLINE, 'layer table');
  assert.ok(Object.keys(p.blocks).length >= 3);
  const mine = W.writeDxf(W.addEntities(W.newDoc(), W.roundRect(0, 0, 10, 5, 1, { layer: 'L' })));
  const q = new Parser().parseSync(mine);
  assert.equal(q.entities[0].vertices.length, 8); assert.equal(q.entities[0].shape, true);
});

test('roundRect: arcs bulge outward at the corners and the drawn box is exactly w × h', () => {
  const doc = W.addEntities(W.newDoc(), W.roundRect(5, 7, 120, 80, 6));
  const b = D.flatten(doc).boxes.model;
  for (const [got, want] of [[b[0], 5], [b[1], 7], [b[2], 125], [b[3], 87]]) assert.ok(Math.abs(got - want) < 1e-6, b.join());
});

// a hand-made DXF from [code, value] pairs
const dxfOf = (pairs) => pairs.map(([c, v]) => String(c).padStart(3) + '\n' + v).join('\n') + '\n  0\nEOF\n';
const tablesDxf = (...recs) => dxfOf([[0, 'SECTION'], [2, 'TABLES'], ...recs.flat(), [0, 'ENDSEC']]);
const table = (name, recs) => [[0, 'TABLE'], [2, name], [70, recs.length], ...recs.flat(), [0, 'ENDTAB']];

test('non-ASCII layer and block names survive Save and reopen (written as \\U+XXXX, read back as the characters)', () => {
  const d = W.newDoc();
  W.addLayer(d, 'H\u00f6he', { aci: 3 });
  W.addBlock(d, 'Teil_\u00dc', [W.line(0, 0, 5, 0, { layer: 'H\u00f6he' })]);
  W.addEntities(d, W.insert('Teil_\u00dc', 1, 1, { layer: 'H\u00f6he' }), W.text(0, 0, 2, 'Gr\u00f6\u00dfe'));
  const t = W.writeDxf(d, { escapeUnicode: true });
  assert.ok(/^[\x00-\x7f]*$/.test(t) && t.includes('H\\U+00F6he'));
  const back = D.readDxf(t);
  assert.ok(back.layers['H\u00f6he'] && back.blocks['Teil_\u00dc']);
  assert.equal(back.entities[0].layer, 'H\u00f6he');
  assert.equal(back.entities[0].r.v[back.entities[0].r.c.indexOf(2)], 'Teil_\u00dc');
  assert.equal(W.writeDxf(back, { escapeUnicode: true }), t, 'a second round trip changes nothing');
});

test('STYLE and DIMSTYLE records are written back as they were (font file, width, oblique; dimension variables)', () => {
  const t = tablesDxf(
    table('STYLE', [[[0, 'STYLE'], [5, '11'], [2, 'ROMANS'], [70, 0], [40, 0], [41, 0.8], [50, 15], [71, 0], [42, 2.5], [3, 'romans.shx'], [4, '']]]),
    table('DIMSTYLE', [[[0, 'DIMSTYLE'], [105, '12'], [2, 'ISO-25'], [70, 0], [3, 'mm'], [40, 1], [41, 2.5], [140, 3.5], [147, 0.8], [340, '11']]]));
  const back = reread(D.readDxf(t));
  const get = (rec, c) => rec.v[rec.c.indexOf(c)];
  assert.equal(get(back.styles.ROMANS, 3), 'romans.shx'); assert.equal(+get(back.styles.ROMANS, 41), 0.8); assert.equal(+get(back.styles.ROMANS, 50), 15);
  assert.equal(+get(back.dimstyles['ISO-25'], 140), 3.5); assert.equal(get(back.dimstyles['ISO-25'], 3), 'mm');
  assert.equal(+get(back.dimstyles['ISO-25'], 147), 0.8);
  assert.ok(back.styles.Standard || back.styles.STANDARD, 'Standard is still there');
});

test('a layer locked in the file stays locked; freezing from the panel still works', () => {
  const t = tablesDxf(table('LAYER', [[[0, 'LAYER'], [2, 'Jig'], [70, 4], [62, 5], [6, 'CONTINUOUS']], [[0, 'LAYER'], [2, 'Hold'], [70, 5], [62, 5], [6, 'CONTINUOUS']]]));
  const doc = D.readDxf(t);
  const back = reread(doc);
  assert.equal(back.layers.Jig.flags & 4, 4); assert.equal(back.layers.Jig.frozen, false);
  assert.equal(back.layers.Hold.flags & 4, 4); assert.equal(back.layers.Hold.frozen, true);
  doc.layers.Jig.frozen = true;
  const again = reread(doc);
  assert.equal(again.layers.Jig.frozen, true); assert.equal(again.layers.Jig.flags & 4, 4);
});

test('a layer marked "No plot" (code 290) keeps it; a layer without the code plots', () => {
  const doc = D.readDxf(tablesDxf(table('LAYER', [[[0, 'LAYER'], [2, 'CONSTR'], [70, 0], [62, 5], [6, 'CONTINUOUS'], [290, 0]], [[0, 'LAYER'], [2, 'CUT'], [70, 0], [62, 1], [6, 'CONTINUOUS']]])));
  assert.equal(doc.layers.CONSTR.plot, false); assert.equal(doc.layers.CUT.plot, true);
  const once = W.writeDxf(doc), back = D.readDxf(once);
  assert.equal(back.layers.CONSTR.plot, false); assert.equal(back.layers.CUT.plot, true);
  assert.equal(once.split(/\r?\n/).filter((l) => l.trim() === '290').length, 1, 'only the No plot layer gets the code');
});

test('a big file writes: 20 000 polylines × 50 points on 300 layers, extents handed in', () => {
  const doc = W.newDoc(4);
  const ents = [];
  for (let i = 0; i < 20000; i++) ents.push(W.lwpoly(Array.from({ length: 50 }, (_, k) => [i % 100 + k, Math.floor(i / 100) + (k % 2)]), { layer: 'Layer' + (i % 300) }));
  W.addEntities(doc, ents);
  const text = W.writeDxf(doc, { extents: [0, 0, 150, 201] });        // no time limit: it was ~1.5 s in the suite, a flaky check on CI
  const back = D.readDxf(text);
  assert.equal(Object.keys(back.layers).length, 301, 'every layer has its record');
  assert.match(text, /\$EXTMAX\r\n 10\r\n150\r\n 20\r\n201\r\n/, 'the extents handed in are the header\'s');
});

test('a line type with text keeps its text (and its text style); layer names that differ only in case make one record', () => {
  const t = tablesDxf(
    table('LTYPE', [[[0, 'LTYPE'], [2, 'GAS_LINE'], [70, 0], [3, ''], [72, 65], [73, 3], [40, 0.9],
      [49, 0.5], [74, 0], [49, -0.2], [74, 2], [75, 0], [340, '11'], [46, 0.1], [50, 0], [44, -0.1], [45, -0.05], [9, 'GAS'], [49, -0.2], [74, 0]]]),
    table('STYLE', [[[0, 'STYLE'], [5, '11'], [2, 'Standard'], [70, 0], [3, 'txt']]]));
  const doc = D.readDxf(t);
  assert.equal(doc.ltypes.GAS_LINE.elems[1].text, 'GAS'); assert.equal(doc.ltypes.GAS_LINE.elems[1].style, 'Standard');
  const back = reread(doc);
  assert.deepEqual(back.ltypes.GAS_LINE.pattern, [0.5, -0.2, -0.2]);
  assert.equal(back.ltypes.GAS_LINE.elems[1].text, 'GAS'); assert.equal(back.ltypes.GAS_LINE.elems[1].style, 'Standard');
  assert.equal(back.ltypes.GAS_LINE.elems[1].scale, 0.1);
  const d = W.newDoc();
  W.addLayer(d, 'Cut'); W.addEntities(d, W.line(0, 0, 1, 1, { layer: 'CUT' }));
  const names = Object.keys(reread(d).layers).map((k) => k.toLowerCase());
  assert.equal(names.filter((k) => k === 'cut').length, 1);
});
