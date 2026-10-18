// text.js — the Text tool's model.   node text.test.mjs
import assert from 'node:assert/strict';
import * as TX from './web/text.js';
import { readDxf, flatten, fontOfStyle } from './web/drawing.js';
import { newDoc, addEntities, writeDxf } from './web/dxf-write.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const model = (o = {}) => ({ type: 'TEXT', x: 160, y: 407, h: 30, lines: ['PLATE 04 - REV C'], angle: 0, ha: 0, font: 'Standard', styleName: 'Standard', bold: false, ...o });
const val = (e, code) => { const k = e.r.c.indexOf(code); return k < 0 ? undefined : e.r.v[k]; };
const reopen = (...ents) => { const d = newDoc(4); addEntities(d, ents); return readDxf(writeDxf(d)); };

test('one line saves as TEXT with the board\'s group codes (8 layer, 10/20 point, 40 height, 1 text, 50 angle, 72 align, 7 style)', () => {
  const e = TX.encode(model({ angle: 0 }), { layer: 'Notes' });
  assert.equal(e.type, 'TEXT'); assert.equal(e.layer, 'Notes');
  assert.deepEqual([10, 20, 40, 1, 7].map((c) => val(e, c)), ['160', '407', '30', 'PLATE 04 - REV C', 'Standard']);
  assert.equal(val(e, 72), undefined, 'left needs no alignment code');
  const c = TX.encode(model({ ha: 1 }));
  assert.deepEqual([72, 11, 21].map((k) => val(c, k)), ['1', '160', '407']);
  assert.equal(val(TX.encode(model({ angle: 30 })), 50), '30');
});

test('two or more lines, or bold, save as MTEXT (bold as a font code); the first line stays where it was', () => {
  const two = TX.encode(model({ lines: ['MATERIAL: ACRYLIC 3 MM', 'FINISH: GLOSS'] }), { layer: 'Notes' });
  assert.equal(two.type, 'MTEXT');
  assert.equal(val(two, 1), 'MATERIAL: ACRYLIC 3 MM\\PFINISH: GLOSS');
  assert.equal(val(two, 20), '437', 'the block hangs from its top: a height above the first baseline (407 + 30)');
  assert.equal(val(two, 71), '1');
  const bold = TX.encode(model({ bold: true, font: 'Mono', styleName: 'Mono' }));
  assert.equal(bold.type, 'MTEXT');
  assert.match(val(bold, 1), /^\{\\fCourier New\|b1\|i0\|c0\|p34;PLATE 04 - REV C\}$/);
  assert.equal(val(bold, 7), 'Mono');
  assert.equal(val(TX.encode(model({ lines: ['a', 'b'], ha: 2 })), 71), '3');
  assert.equal(TX.kindOf(model({ lines: ['a', 'b'] })), 'MTEXT'); assert.equal(TX.kindOf(model()), 'TEXT'); assert.equal(TX.kindOf(model({ bold: true })), 'MTEXT');
});

test('decode reads back what encode wrote (TEXT and MTEXT, left / centre / right, turned, bold)', () => {
  const cases = [model(), model({ ha: 1 }), model({ ha: 2, angle: 30 }), model({ lines: ['MATERIAL', 'FINISH: GLOSS', 'x'], angle: 90 }),
    model({ lines: ['a', 'b'], ha: 1, angle: 45, x: 12.5, y: -3 }), model({ bold: true, font: 'Arial', styleName: 'Arial', ha: 2 }), model({ font: 'Mono', styleName: 'Mono' })];
  for (const m of cases) {
    const d = TX.decode(TX.encode(m));
    assert.equal(d.type, TX.kindOf(m)); assert.deepEqual(d.lines, m.lines); assert.equal(d.ha, m.ha); assert.equal(d.bold, m.bold); assert.equal(d.font, m.font);
    near(d.x, m.x); near(d.y, m.y); near(d.h, m.h); near(d.angle, m.angle);
  }
  assert.equal(TX.decode({ type: 'LINE', r: { c: [], v: [] } }), null);
  assert.equal(TX.decode(null), null);
});

test('decode: an MTEXT attached at the middle or bottom, and text with codes, comes back as its first baseline and plain lines', () => {
  const mid = { type: 'MTEXT', r: { c: [10, 20, 40, 71, 1], v: ['0', '100', '10', '4', 'a\\Pb'] } };      // middle left, two lines: block 26.67 tall, centred on y = 100
  const m = TX.decode(mid);
  near(m.y, 100 + (10 + 50 / 3) / 2 - 10); assert.equal(m.ha, 0);
  const bot = TX.decode({ type: 'MTEXT', r: { c: [10, 20, 40, 71, 1], v: ['0', '0', '10', '7', 'a\\Pb\\Pc'] } });
  near(bot.y, 2 * 50 / 3);                                                   // the first baseline is two line pitches above the last
  const plain = TX.decode({ type: 'TEXT', r: { c: [10, 20, 40, 1], v: ['0', '0', '5', 'D = %%c20 %%p0.1'] } });
  assert.deepEqual(plain.lines, ['D = ⌀20 ±0.1']);
  assert.equal(TX.decode({ type: 'TEXT', r: { c: [10, 20, 40, 1], v: ['0', '0', '0', 'x'] } }), null, 'no height: not a text');
  const font = TX.decode({ type: 'MTEXT', r: { c: [10, 20, 40, 1], v: ['0', '0', '5', '{\\fArial|b1|i0;Hello}'] } });
  assert.equal(font.bold, true); assert.deepEqual(font.lines, ['Hello']);
});

test('fontOfStyle: the three fonts', () => {
  assert.equal(fontOfStyle('Mono'), 'Mono'); assert.equal(fontOfStyle('Courier New'), 'Mono'); assert.equal(fontOfStyle('Arial'), 'Arial');
  assert.equal(fontOfStyle('Standard'), 'Standard'); assert.equal(fontOfStyle('ROMANS'), 'Standard'); assert.equal(fontOfStyle(undefined), 'Standard');
});

test('save → reopen: TEXT, MTEXT, bold; the STYLE table has our styles; the file draws them with their style and bold', () => {
  const doc = newDoc(4);
  addEntities(doc, [TX.encode(model({ font: 'Mono', styleName: 'Mono' }), { layer: 'Notes' }), TX.encode(model({ lines: ['ink', 'two coats'], y: 300 }), { layer: 'Notes' }),
    TX.encode(model({ bold: true, font: 'Arial', styleName: 'Arial', y: 200 }), { layer: 'Notes' })]);
  const text = writeDxf(doc), back = readDxf(text);
  assert.deepEqual(back.entities.map((e) => e.type), ['TEXT', 'MTEXT', 'MTEXT']);
  assert.ok(back.entities.every((e) => e.layer === 'Notes'));
  assert.match(text, /\r\n  2\r\nMono\r\n/); assert.match(text, /cour\.ttf/); assert.match(text, /\r\n  2\r\nArial\r\n/); assert.match(text, /arial\.ttf/);
  const m = back.entities.map(TX.decode);
  assert.deepEqual(m.map((x) => x.lines), [['PLATE 04 - REV C'], ['ink', 'two coats'], ['PLATE 04 - REV C']]);
  assert.deepEqual(m.map((x) => x.bold), [false, false, true]);
  const fl = flatten(back), items = fl.items.filter((it) => it.k === 't');
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((it) => it.st), ['Mono', 'Standard', 'Arial']);
  assert.deepEqual(items.map((it) => !!it.bold), [false, false, true]);
  assert.deepEqual(items[1].lines, ['ink', 'two coats']);
});

test('a text with characters outside ASCII survives the round trip', () => {
  const back = readDxf(writeDxf((() => { const d = newDoc(4); addEntities(d, [TX.encode(model({ lines: ['Ø 20 × 5°'] }))]); return d; })(), { escapeUnicode: true }));
  assert.deepEqual(TX.decode(back.entities[0]).lines, ['Ø 20 × 5°']);
  const long = 'x'.repeat(600);
  const e = TX.encode(model({ lines: [long, 'y'], bold: true }));
  assert.ok(e.r.c.filter((c) => c === 3).length >= 2, 'a long MTEXT goes in 250-character chunks');
  assert.equal(TX.decode(e).lines[0], long);
  const esc = TX.decode(TX.encode(model({ lines: ['a\\b {c}', 'd'] })));
  assert.deepEqual(esc.lines, ['a\\b {c}', 'd']);
});

test('textBox: a padded box round the text, turned with it; widths come from the font', () => {
  const w = (l) => l.length * 60;                                            // a fake font: 60 per character at 100 px
  const b = TX.textBox(model({ x: 10, y: 20, h: 7, lines: ['ABCDE'] }), w, 0.2);       // size 10, so 5 chars are 30 wide
  near(b.w, 30 + 2.8); near(b.hgt, 7 + 1.4 + 1.75 + 1.4);
  assert.deepEqual(b.corners.map((p) => p.map((v) => +v.toFixed(6))), [[8.6, 20 - 1.75 - 1.4], [8.6 + 32.8, 20 - 1.75 - 1.4], [8.6 + 32.8, 20 + 7 + 1.4], [8.6, 20 + 7 + 1.4]]);
  const c = TX.textBox(model({ x: 0, y: 0, h: 7, lines: ['ABCDE'], ha: 1 }), w, 0);
  near(c.corners[0][0], -15); near(c.corners[1][0], 15);
  const r = TX.textBox(model({ x: 0, y: 0, h: 7, lines: ['ABCDE'], ha: 2 }), w, 0);
  near(r.corners[0][0], -30); near(r.corners[1][0], 0);
  const turned = TX.textBox(model({ x: 0, y: 0, h: 7, lines: ['ABCDE'], angle: 90 }), w, 0);
  near(turned.corners[1][0], 1.75, 1e-9); near(turned.corners[1][1], 30, 1e-9);   // its width now runs up (the descent is to its right)
  const two = TX.textBox(model({ x: 0, y: 0, h: 6, lines: ['AB', 'ABCD'] }), w, 0);   // the second line is the widest; a line pitch of 10 down
  near(two.w, 4 * 60 * (6 / 0.7) / 100); near(two.corners[0][1], -(10 + 1.5)); near(two.corners[2][1], 6);
});

test('scaleByCorner: dragging a corner scales the text about the opposite one (Height 30 → 39)', () => {
  const m = model({ x: 156, y: 243, h: 30 }), w = (l) => l.length * 60;
  const box = TX.textBox(m, w, 0.2);
  const br = box.corners[1];                                                  // bottom-right: dragged
  const tl = box.corners[3];                                                  // top-left: stays
  const grown = TX.scaleByCorner(m, box, 1, [tl[0] + (br[0] - tl[0]) * 1.3, tl[1] + (br[1] - tl[1]) * 1.3]);
  near(grown.h, 39); near(grown.x, tl[0] + (m.x - tl[0]) * 1.3); near(grown.y, tl[1] + (m.y - tl[1]) * 1.3);
  const small = TX.scaleByCorner(m, box, 1, [tl[0], tl[1]]);
  near(small.h, 30 * 0.05, 1e-9);                                             // never collapses
  const other = TX.scaleByCorner(m, box, 3, [box.corners[1][0] + (tl[0] - box.corners[1][0]) * 2, box.corners[1][1] + (tl[1] - box.corners[1][1]) * 2]);
  near(other.h, 60);
  assert.deepEqual(TX.scaleByCorner(m, { corners: [[0, 0], [0, 0], [0, 0], [0, 0]] }, 0, [5, 5]), { h: 30, x: 156, y: 243 });
});

test('linesOf: the editor\'s text as lines, trailing empty ones dropped, null when empty', () => {
  assert.deepEqual(TX.linesOf('a\nb\n\n'), ['a', 'b']);
  assert.deepEqual(TX.linesOf('a\r\nb'), ['a', 'b']);
  assert.deepEqual(TX.linesOf('a\n\nb'), ['a', '', 'b']);
  assert.equal(TX.linesOf('  \n '), null); assert.equal(TX.linesOf(''), null);
});

console.log(n + ' text tests passed');
