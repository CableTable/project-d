// textoutline.js — Text to outlines, the pure part.   node textoutline.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import opentype from './web/vendor/opentype/opentype.js';
import * as TO from './web/textoutline.js';
import * as TX from './web/text.js';
import { readDxf, flatten, plainText, CAP } from './web/drawing.js';
import { newDoc, addEntities, writeDxf, text, entity } from './web/dxf-write.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const buf = readFileSync('web/vendor/fonts/LiberationSans-Regular.ttf');
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const boldBuf = readFileSync('web/vendor/fonts/LiberationSans-Bold.ttf');
const boldFont = opentype.parse(boldBuf.buffer.slice(boldBuf.byteOffset, boldBuf.byteOffset + boldBuf.byteLength));
const fontOf = (it) => it.bold ? boldFont : font;
const model = (o = {}) => ({ type: 'TEXT', x: 100, y: 50, h: 10, lines: ['O'], angle: 0, ha: 0, font: 'Standard', styleName: 'Standard', bold: false, ...o });
const itemsOf = (ents) => { const d = newDoc(4); addEntities(d, ents); const raw = readDxf(writeDxf(d)); return { raw, items: flatten(raw).items.filter((it) => it.k === 't') }; };
const polysOf = (m, o) => { const { items } = itemsOf([TX.encode(m, o)]); return TO.textPolys(items[0], font, 0.01); };
const box = (polys) => { const p = polys.flat(); return [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))]; };
const inside = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i][1] > pt[1]) !== (poly[j][1] > pt[1]) && pt[0] < (poly[j][0] - poly[i][0]) * (pt[1] - poly[i][1]) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c; return c; };

test('the three fonts name their Windows files, bold ones too', () => {
  assert.deepEqual(TO.fontFiles('Standard', false), ['segoeui.ttf']);
  assert.deepEqual(TO.fontFiles('Arial', true), ['arialbd.ttf']);
  assert.ok(TO.fontFiles('Mono', false).includes('consola.ttf'));
  assert.deepEqual(TO.fontFiles('nonsense', false), ['segoeui.ttf']);
});

test('missing glyph labels use padded uppercase code points and cap the list at ten', () => {
  assert.equal(TO.missingGlyphsLabel([]), '');
  assert.equal(TO.missingGlyphsLabel(['é', '🦄']), 'é (U+00E9), 🦄 (U+1F984)');
  const chars = [...'ABCDEFGHIJKL'], firstTen = chars.slice(0, 10).map((ch, i) => `${ch} (U+00${(65 + i).toString(16).toUpperCase()})`).join(', ');
  assert.equal(TO.missingGlyphsLabel(chars.slice(0, 10)), firstTen);
  assert.equal(TO.missingGlyphsLabel(chars.slice(0, 11)), firstTen + ', +1 more');
  assert.equal(TO.missingGlyphsLabel(chars), firstTen + ', +2 more');
});

test('a curve is cut within the tolerance; a repeated first point and a flat contour are dropped', () => {
  const cmds = [{ type: 'M', x: 0, y: 0 }, { type: 'Q', x1: 5, y1: 10, x: 10, y: 0 }, { type: 'L', x: 0, y: 0 }, { type: 'Z' },
    { type: 'M', x: 0, y: 0 }, { type: 'L', x: 5, y: 0 }, { type: 'L', x: 9, y: 0 }, { type: 'Z' }];
  const out = TO.flattenCommands(cmds, 0.01);
  assert.equal(out.length, 1, 'the straight sliver has no area');
  const c = out[0];
  assert.notDeepEqual(c[0], c[c.length - 1]);
  for (let i = 1; i < c.length - 1; i++) {                                  // every vertex is on y = 10·(1 − ((x−5)/5)²)·… the parabola 2t(1−t)·10 at x = 10t
    const t = c[i][0] / 10; if (c[i][1] > 1e-9) near(c[i][1], 20 * t * (1 - t), 1e-9);
  }
  let worst = 0;                                                            // the polygon is never further than tol from the curve
  for (let i = 1; i < c.length - 1; i++) { const t = (c[i][0] + c[i + 1][0]) / 20, mid = [(c[i][0] + c[i + 1][0]) / 2, (c[i][1] + c[i + 1][1]) / 2]; worst = Math.max(worst, Math.abs(20 * t * (1 - t) - mid[1])); }
  assert.ok(worst <= 0.01 + 1e-9, 'sagitta ' + worst);
  const cubic = TO.flattenCommands([{ type: 'M', x: 0, y: 0 }, { type: 'C', x1: 0, y1: 10, x2: 10, y2: 10, x: 10, y: 0 }, { type: 'Z' }], 0.01);
  assert.ok(cubic[0].length > 10 && cubic[0].length < 200);
});

test('alignment and lines: left starts at the anchor, centre and right go back by half / all of the width; MTEXT lines are 5/3 heights apart from the top', () => {
  const w = (t) => t.length * 7;
  const one = (o) => TO.lineLayout({ h: 10, ha: 0, va: 'alphabetic', lines: ['abc'], wf: 1, ...o }, w);
  assert.deepEqual(one({}), [{ text: 'abc', x: -0, y: -0 }]);
  near(one({ ha: 1 })[0].x, -10.5); near(one({ ha: 2 })[0].x, -21);
  near(one({ va: 'middle' })[0].y, -5); near(one({ va: 'top' })[0].y, -10); near(one({ va: 'bottom' })[0].y, 3);
  const m = TO.lineLayout({ h: 10, ha: 0, va: 'top', multi: 1, lh: 50 / 3, lines: ['a', 'b'], wf: 1 }, w);
  near(m[0].y, -10); near(m[1].y, -10 - 50 / 3);
  const bottom = TO.lineLayout({ h: 10, ha: 0, va: 'bottom', multi: 1, lh: 50 / 3, lines: ['a', 'b'], wf: 1 }, w);
  near(bottom[1].y, 0, 1e-9);                                               // the block ends on the anchor
  const wrap = TO.lineLayout({ h: 10, ha: 0, va: 'top', multi: 1, lh: 20, wrap: 30, lines: ['aaaa bbbb'], wf: 1 }, w);
  assert.deepEqual(wrap.map((l) => l.text), ['aaaa', 'bbbb'], '28 wide each: two do not fit in 30');
});

test('"O" is two closed outlines, the counter inside the ring; its height is the text height within the font\'s capitals', () => {
  const polys = polysOf(model());
  assert.equal(polys.length, 2);
  const [a, b] = polys.sort((p, q) => Math.abs(box([q])[2] - box([q])[0]) - Math.abs(box([p])[2] - box([p])[0]));
  assert.ok(inside(b[0], a), 'the hole is inside the ring');
  const [x0, y0, , y1] = box(polys);
  assert.ok(Math.abs(x0 - 100) < 1.5, 'starts at the anchor (the side bearing): ' + x0);
  assert.ok(y1 - y0 > 9.5 && y1 - y0 < 11.5, 'about the 10 mm capital height: ' + (y1 - y0));
  assert.ok(Math.abs(y0 - 50) < 0.4, 'sits on the baseline');
});

test('turned, widened, mirrored and centred like the screen draws it', () => {
  const base = box(polysOf(model({ lines: ['HI'] }))), bw = base[2] - base[0], bh = base[3] - base[1];
  const turned = box(polysOf(model({ lines: ['HI'], angle: 90 })));
  near(turned[2] - turned[0], bh, 0.02); near(turned[3] - turned[1], bw, 0.02);
  assert.ok(turned[0] < 100 + 1e-6 && turned[2] <= 100.2, 'a quarter turn about the anchor: the letters stand to its left');
  const { items } = itemsOf([TX.encode(model({ lines: ['HI'] }))]);
  const wide = box(TO.textPolys({ ...items[0], wf: 2 }, font, 0.01));
  near(wide[2] - wide[0], 2 * bw, 0.05);
  const flipped = box(TO.textPolys({ ...items[0], mx: -1 }, font, 0.01));
  assert.ok(flipped[2] <= 100.01 && Math.abs(flipped[2] - flipped[0] - bw) < 0.02, 'mirrored: to the left of the anchor');
  const centre = box(polysOf(model({ lines: ['HI'], ha: 1 }))), right = box(polysOf(model({ lines: ['HI'], ha: 2 })));
  near((centre[0] + centre[2]) / 2, 100, 1); assert.ok(Math.abs(right[2] - 100) < 1.5);
});

test('outlineEntities: closed polylines on the text\'s layer, colour and line style; only a TEXT or MTEXT at the top level', () => {
  const t = TX.encode(model({ lines: ['A', 'B'] }), { layer: 'Notes', aci: 1, lt: 'DASHED', lts: 2 });
  const { raw, items } = itemsOf([t, TX.encode(model({ lines: ['x'], x: 0 }), { layer: 'Other' })]);
  const r = TO.outlineEntities(items.filter((it) => it.e === 0), raw.entities, () => font, 0.01);
  assert.equal(r.texts, 1); assert.deepEqual([...r.done], [0]);
  assert.equal(r.ents.length, 5, 'A: ring and counter (2); B: letter and two counters (3)');
  for (const e of r.ents) {
    assert.equal(e.type, 'LWPOLYLINE'); assert.equal(e.layer, 'Notes'); assert.equal(e.aci, 1); assert.equal(e.lt, 'DASHED'); assert.equal(e.lts, 2);
    assert.equal(e.r.v[e.r.c.indexOf(70)], '1', 'closed');
  }
  const stray = TO.outlineEntities(items, [raw.entities[0], { type: 'LINE' }], () => font, 0.01);
  assert.equal(stray.texts, 1, 'an item whose entity is not a TEXT or MTEXT (text inside a block) is left alone');
});

test('a blank text makes nothing and is not marked done', () => {
  const { raw, items } = itemsOf([TX.encode(model({ lines: ['  '] }))]);
  const r = TO.outlineEntities(items, raw.entities, () => font, 0.01);
  assert.equal(r.ents.length, 0); assert.equal(r.done.size, 0);
});

test('real accented and engineering glyphs keep their contours, component offsets and holes', () => {
  const expected = { 'é': 3, 'ü': 3, 'ñ': 2, 'Å': 4, 'ø': 3, 'ç': 2, '°': 2, '±': 2, 'Ø': 3, '²': 1, 'ǻ': 5 };
  for (const [ch, count] of Object.entries(expected)) {
    const glyph = font.charToGlyph(ch), polys = polysOf(model({ lines: [ch] }));
    assert.notEqual(glyph.index, 0, ch + ' exists in the bundled font');
    assert.equal(polys.length, count, ch + ' contour count');
    assert.ok(polys.flat().every((p) => p.every(Number.isFinite)), ch + ' finite vertices');
  }
  // These are actual TrueType component references, not just non-ASCII simple glyphs.
  for (const [accented, base] of [['é', 'e'], ['ü', 'u'], ['ñ', 'n'], ['Å', 'A'], ['ç', 'c'], ['ǻ', 'a']]) {
    const glyph = font.charToGlyph(accented), component = glyph.components[0], scale = 10 / CAP / font.unitsPerEm;
    assert.equal(glyph.isComposite, true, accented);
    assert.equal(component.glyphIndex, font.charToGlyphIndex(base));
    const polys = polysOf(model({ lines: [accented] })), plain = polysOf(model({ lines: [base] }));
    for (let i = 0; i < plain.length; i++) for (let j = 0; j < plain[i].length; j++) {
      near(polys[i][j][0], plain[i][j][0] + component.dx * scale, 0.00002);
      near(polys[i][j][1], plain[i][j][1] + component.dy * scale, 0.00002);
    }
  }
  const signedArea = (p) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0);
  for (const ch of ['Å', 'é', '°', 'ø', 'Ø']) {
    const polys = polysOf(model({ lines: [ch] }));
    assert.ok(polys.some((hole, i) => polys.some((outer, j) => i !== j && inside(hole[0], outer) && signedArea(hole) * signedArea(outer) < 0)), ch + ' has a nested counter with opposite winding');
  }
});

test('composite paths have the same placement, kerning and transforms as plain letters', () => {
  const { items } = itemsOf([TX.encode(model({ lines: ['Åé°ñ Ø25'] }))]), it = items[0];
  const actual = TO.textPolys(it, font, 0.01);
  const expected = TO.flattenCommands(font.getPath(it.lines[0], 0, 0, it.h / CAP).commands, 0.01);
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) for (let j = 0; j < actual[i].length; j++) {
    near(actual[i][j][0], it.x + expected[i][j][0], 0.00001);
    near(actual[i][j][1], it.y - expected[i][j][1], 0.00001);
  }
  const moved = TO.textPolys({ ...it, ha: 1, mx: -1, my: -1, wf: 1.5, rot: Math.PI / 2 }, font, 0.01);
  const half = font.getAdvanceWidth(it.lines[0], it.h / CAP) / 2;
  for (let i = 0; i < actual.length; i++) for (let j = 0; j < actual[i].length; j++) {
    near(moved[i][j][0], it.x + actual[i][j][1] - it.y, 0.00002);
    near(moved[i][j][1], it.y - 1.5 * (actual[i][j][0] - it.x - half), 0.00002);
  }
});

test('missing glyphs make no .notdef contours, keep advance and alignment, and are named once', () => {
  const { raw, items } = itemsOf([TX.encode(model({ lines: ['A🦄V🦄'] }))]), it = items[0], size = it.h / CAP;
  assert.equal(font.charToGlyphIndex('🦄'), 0);
  const r = TO.outlineEntities(items, raw.entities, () => font, 0.01);
  assert.deepEqual(r.missing, ['🦄']);
  assert.equal(r.texts, 1); assert.equal(r.ents.length, 3, 'only A (two contours) and V (one)');
  const polys = TO.textPolys(it, font, 0.01), v = polysOf(model({ lines: ['V'] }));
  const advance = font.getAdvanceWidth('A🦄', size);
  for (let j = 0; j < v[0].length; j++) {
    near(polys[2][j][0], v[0][j][0] + advance, 0.00002);
    near(polys[2][j][1], v[0][j][1], 0.00002);
  }
  const centred = TO.textPolys({ ...it, ha: 1 }, font, 0.01), half = font.getAdvanceWidth(it.lines[0], size) / 2;
  near(centred[0][0][0], polys[0][0][0] - half, 0.00002);
  const only = itemsOf([TX.encode(model({ lines: ['🦄🦄'] }))]);
  const empty = TO.outlineEntities(only.items, only.raw.entities, () => font, 0.01);
  assert.deepEqual(empty.missing, ['🦄']); assert.equal(empty.ents.length, 0); assert.equal(empty.done.size, 0, 'an entirely missing text stays for correction');
});

test('DXF TEXT escapes decode before glyph lookup, including escaped accented and missing characters', () => {
  assert.deepEqual(plainText('%%d %%D %%p %%P %%c %%C \\U+00C5\\U+00e9 \\U+D83E\\U+DD84', false), ['° ° ± ± ⌀ ⌀ Åé 🦄']);
  assert.deepEqual(plainText('\\U+XYZ1 \\U+123', false), ['\\U+XYZ1 \\U+123'], 'malformed escapes stay literal');
  const escaped = itemsOf([text(100, 50, 10, '\\U+00C5\\U+00e9%%d\\U+00F1 \\U+00D825 %%p %%c')]);
  const literal = itemsOf([text(100, 50, 10, 'Åé°ñ Ø25 ± ⌀')]);
  assert.deepEqual(TO.textPolys(escaped.items[0], font, 0.01), TO.textPolys(literal.items[0], font, 0.01));
  const r = TO.outlineEntities(escaped.items, escaped.raw.entities, () => font, 0.01);
  assert.deepEqual(r.missing, [], 'the bundled font uses slashed O outlines for the absent diameter sign');
});

test('%%c25 outlines the absent diameter sign as Ø with closed contours and no skipped glyph note', () => {
  assert.equal(font.charToGlyphIndex('⌀'), 0);
  const { raw, items } = itemsOf([text(100, 50, 10, '%%c25')]), before = structuredClone(items[0]);
  assert.deepEqual(items[0].lines, ['⌀25'], 'screen text keeps the diameter sign');
  const r = TO.outlineEntities(items, raw.entities, () => font, 0.01);
  const expected = itemsOf([text(100, 50, 10, 'Ø25')]);
  assert.deepEqual(r.ents, TO.outlineEntities(expected.items, expected.raw.entities, () => font, 0.01).ents);
  assert.ok(r.ents.length >= 3, 'includes all three Ø contours');
  assert.ok(r.ents.every((e) => e.type === 'LWPOLYLINE' && e.r.v[e.r.c.indexOf(70)] === '1'));
  assert.deepEqual(r.missing, []); assert.deepEqual(r.notes, []);
  assert.deepEqual(items[0], before, 'outlining does not mutate screen text');
  assert.deepEqual(TO.textPolys({ ...items[0], ha: 1 }, font, 0.01), TO.textPolys({ ...expected.items[0], ha: 1 }, font, 0.01), 'alignment uses the replacement glyph advance');
});

test('MTEXT escapes, paragraphs, real newlines, nonbreaking spaces and scoped braces', () => {
  const p = TO.parseMtext(String.raw`A\~B\P\\\{C\} {D}` + '\r\n\rE %%d \\U+00C5\\U+D83E\\U+DD84', 10);
  assert.equal(p.runs.map((r) => r.text).join(''), 'A\u00a0B\n\\{C} D\n\nE ° Å🦄');
  assert.deepEqual(p.notes, []);
});

test('MTEXT absolute and relative height, width and oblique stay scoped; invalid numbers do not poison geometry', () => {
  const p = TO.parseMtext(String.raw`a{\H2x;b{\H0.5x;\W2;\Q30;c}d}\H7;e\H0;\W-2;\Q90;f`, 10);
  assert.deepEqual(p.runs.map(({ text, h, wf, oblique }) => [text, h, wf, oblique]), [
    ['a', 10, 1, 0], ['b', 20, 1, 0], ['c', 10, 2, 30], ['d', 20, 1, 0], ['ef', 7, 1, 0],
  ]);
  assert.ok(p.notes.includes('Unknown MTEXT codes stripped'));
});

test('MTEXT bold toggles and restores; colours, decorations, stacks and unknown codes never become letters', () => {
  const p = TO.parseMtext(String.raw`a{\fArial|b1|i0;b{\fArial|b0;c}d}e\Lx\l\Oy\o\C1;z\c123;\S1#2;\S3^4;\S5/6;\Zhidden;!`, 10);
  assert.deepEqual(p.runs.map(({ text, bold }) => [text, bold]), [['a', false], ['b', true], ['c', false], ['d', true], ['exyz1/23/45/6!', false]]);
  assert.deepEqual(p.notes, ['Underline / overline skipped', 'Inline colours ignored', 'Stacked fractions drawn as a/b', 'Unknown MTEXT codes stripped']);
});

test('MTEXT valueless codes preserve following text; alignment and paragraph formatting are stripped quietly', () => {
  for (const [source, expected] of [
    [String.raw`\Kitem A; item B\k`, 'item A; item B'],
    [String.raw`col\Ntwo; x`, 'col\ntwo; x'],
    [String.raw`\A1;x`, 'x'],
    [String.raw`\pxqc;x`, 'x'],
    [String.raw`a\Xb; c`, 'ab; c'],
  ]) {
    const p = TO.parseMtext(source, 10);
    assert.equal(p.runs.map((r) => r.text).join(''), expected);
    assert.deepEqual(p.notes, []);
  }
});

const mitem = (source, o = {}) => ({ h: 10, x: 20, y: 100, ha: 0, va: 'top', lh: 50 / 3, wrap: 0, ...TO.parseMtext(source, 10), ...o });
const fakeFont = (r) => ({ getAdvanceWidth: (t, size) => t.length * size * CAP * (r.bold ? 2 : 1) });
const lineTexts = (lines) => lines.map((l) => l.runs.map((r) => r.text).join(''));

test('MTEXT wraps whole words using each run\'s face, height and width; formatting cannot split a word', () => {
  const it = mitem(String.raw`AB {\fArial|b1;CD} EF\PZ` + '\n', { wrap: 60 });
  const lines = TO.mtextLayout(it, fakeFont);
  assert.deepEqual(lineTexts(lines), ['AB', 'CD', 'EF', 'Z', '']);
  near(lines[1].y - lines[0].y, -50 / 3);
  assert.deepEqual(lineTexts(TO.mtextLayout(mitem(String.raw`A{\fArial|b1;B}C D`, { wrap: 50 }), fakeFont)), ['ABC', 'D']);
  assert.deepEqual(lineTexts(TO.mtextLayout(mitem(String.raw`A\~B C`, { wrap: 40 }), fakeFont)), ['A\u00a0B', 'C']);
  assert.deepEqual(lineTexts(TO.mtextLayout(mitem(String.raw`{\W2;AA} BB`, { wrap: 40 }), fakeFont)), ['AA', 'BB']);
  assert.deepEqual(lineTexts(TO.mtextLayout(mitem(String.raw`{\H2x;AA} BB`, { wrap: 40 }), fakeFont)), ['AA', 'BB']);
  assert.deepEqual(lineTexts(TO.mtextLayout(mitem(String.raw`A \S1^ 2;`, { wrap: 20 }), fakeFont)), ['A', '1/2']);
  assert.deepEqual(lineTexts(TO.mtextLayout(mitem(String.raw`\Sa b#c d;`, { wrap: 20 }), fakeFont)), ['a\u00a0b/c\u00a0d']);
});

test('MTEXT aligns each line at all nine attachment positions, with the saved line spacing', () => {
  for (const ha of [0, 1, 2]) for (const va of ['top', 'middle', 'bottom']) {
    const lines = TO.mtextLayout(mitem('AA\nB', { ha, va, wrap: 60, lh: 20 }), fakeFont);
    near(lines[0].runs[0].x, -10 * ha); near(lines[1].runs[0].x, -5 * ha);
    near(lines[0].y, va === 'top' ? -10 : va === 'middle' ? 5 : 20);
    near(lines[1].y, lines[0].y - 20);
  }
  const auto = TO.mtextLayout(mitem('AA\nB', { ha: 1 }), fakeFont);
  near(auto[0].runs[0].x, -10); near(auto[1].runs[0].x, -5);
  const tall = TO.mtextLayout(mitem(String.raw`A\P{\H50;B}`), fakeFont);
  near(tall[1].y + 50, 0, 1e-9);
  near(TO.mtextLayout(mitem(String.raw`\H7;A`), fakeFont)[0].y, -7);
});

test('oblique slants the glyph to the right by its height times the tangent, without changing the baseline', () => {
  const { items } = itemsOf([text(20, 100, 10, 'H')]), it = items[0];
  const straight = TO.textPolys(it, font, 0.01), slanted = TO.textPolys({ ...it, oblique: 30 }, font, 0.01);
  for (let i = 0; i < straight[0].length; i++) {
    near(slanted[0][i][0], straight[0][i][0] + (straight[0][i][1] - 100) * Math.tan(Math.PI / 6), 0.00002);
    near(slanted[0][i][1], straight[0][i][1]);
  }
});

const mtext = (source, pairs = [], props = {}) => entity('MTEXT', [[10, 20], [20, 100], [40, 10], [71, 1], [1, source], ...pairs], props);
test('MTEXT reads joined DXF chunks and restores even a narrow box width; pure layout does not mutate its input', () => {
  const e = entity('MTEXT', [[10, 20], [20, 100], [40, 10], [41, 15], [3, 'AA '], [1, 'BB']]);
  const { raw, items } = itemsOf([e]), it = TO.outlineItem(items[0], raw.entities[0]);
  assert.equal(it.wrap, 15); assert.equal(it.runs[0].text, 'AA BB');
  const before = structuredClone(it);
  assert.deepEqual(lineTexts(TO.mtextLayout(it, fakeFont)), ['AA', 'BB']);
  assert.deepEqual(it, before);
});

test('MTEXT outlines use the regular and bold glyphs, height, width and oblique before rotation about the insertion point', () => {
  const { raw, items } = itemsOf([mtext(String.raw`A{\fArial|b1;\H2x;\W1.5;\Q20;B}`, [[50, 90]])]);
  const r = TO.outlineEntities(items, raw.entities, fontOf, 0.01);
  assert.equal(r.texts, 1); assert.equal(r.ents.length, 5);
  const it = TO.outlineItem(items[0], raw.entities[0]), lines = TO.mtextLayout(it, fontOf);
  near(lines[0].y, -20);
  const second = lines[0].runs[1], advance = font.getAdvanceWidth('A', 10 / CAP);
  near(second.x, advance); assert.equal(second.bold, true);
  const expected = TO.textPolys({ ...items[0], ...second, multi: false, ha: 0, va: 'alphabetic', lines: ['B'], x: 40, y: 100 + advance }, boldFont, 0.01);
  const actual = r.ents.slice(2).map((e) => e.r.c.flatMap((c, i) => c === 10 ? [[+e.r.v[i], +e.r.v[i + 1]]] : []));
  assert.deepEqual(actual, expected);
});

test('outlineEntities reuses prepared MTEXT runs without reading its source again', () => {
  const { raw, items } = itemsOf([mtext(String.raw`A{\fArial|b1;B}`)]);
  const prepared = items.map((it) => TO.outlineItem(it, raw.entities[it.e]));
  const expected = TO.outlineEntities(items, raw.entities, fontOf, 0.01);
  const entities = raw.entities.map((e) => ({ ...e, get r() { assert.fail('MTEXT source already parsed'); } }));
  assert.deepEqual(TO.outlineEntities(prepared, entities, fontOf, 0.01), expected);
});

test('MTEXT preserves entity colour and layer, names simplifications and missing glyphs, keeps missing advance and all-missing text', () => {
  const { raw, items } = itemsOf([mtext(String.raw`\C1;A{\fArial|b1;🦄}V\L\S1#2;\l\Zhidden;`, [], { layer: 'CUT', aci: 3, tc: 0x123456 })]);
  const r = TO.outlineEntities(items, raw.entities, fontOf, 0.01);
  assert.equal(r.texts, 1); assert.deepEqual(r.missing, ['🦄']);
  assert.ok(r.ents.every((e) => e.type === 'LWPOLYLINE' && e.layer === 'CUT' && e.aci === 3 && e.tc === 0x123456 && e.r.v[e.r.c.indexOf(70)] === '1'));
  assert.deepEqual(r.notes, ['Inline colours ignored', 'Underline / overline skipped', 'Stacked fractions drawn as a/b', 'Unknown MTEXT codes stripped']);
  const v = r.ents[2], x = +v.r.v[v.r.c.indexOf(10)];
  const advance = font.getAdvanceWidth('A', 10 / CAP) + boldFont.getAdvanceWidth('🦄', 10 / CAP);
  near(x, 20 + advance + TO.textPolys({ ...items[0], multi: false, x: 0, y: 0, ha: 0, va: 'alphabetic', lines: ['V'] }, font, 0.01)[0][0][0], 0.00002);
  const only = itemsOf([mtext('🦄')]);
  const empty = TO.outlineEntities(only.items, only.raw.entities, fontOf, 0.01);
  assert.deepEqual(empty.missing, ['🦄']); assert.equal(empty.done.size, 0); assert.equal(empty.ents.length, 0);
});

console.log(n + ' tests');
