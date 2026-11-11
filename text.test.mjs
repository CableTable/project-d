// text.js — the Text tool's model.   node text.test.mjs
import assert from 'node:assert/strict';
import * as TX from './web/text.js';
import { readDxf, flatten, fontOfStyle } from './web/drawing.js';
import { newDoc, addEntities, writeDxf, entity } from './web/dxf-write.js';

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

test('TODO 246: text edits replace only the changed DXF codes (TEXT / MTEXT property grid)', () => {
  const shared = [[5, 'AB'], [330, 'CD'], [210, '0.0'], [220, '0.0'], [230, '1.0'], [39, '0.2']];
  const fixtures = [
    entity('TEXT', [[10, 10], [20, 20], [30, 3], [11, 12], [21, 24], [31, 3], [40, 5], [50, 15], [7, 'ROMANS'], [72, 1], [73, 2], [1, 'Hello %%d'], [41, '0.80'], [51, 12], ...shared], { layer: 'Notes', aci: 1 }),
    entity('MTEXT', [[10, 10], [20, 20], [30, 3], [40, 5], [50, 15], [11, 0], [21, 1], [31, 0], [7, 'ROMANS'], [71, 5], [3, '{\\H1.5x;Hello}'], [3, '\\P'], [1, '{\\C1;world}'], [41, '80.00'], [44, '1.20'], ...shared], { layer: 'Notes', aci: 1 }),
  ];
  const pairs = (e, codes, include = true) => e.r.c.flatMap((c, i) => codes.includes(c) === include ? [[c, e.r.v[i]]] : []);
  const cases = [
    ['height', { h: 9 }, [40]], ['angle', { angle: 30 }, [50, 11, 21]],
    ['font', { font: 'Mono', styleName: 'Mono' }, [7]], ['align', { ha: 2 }, [72, 71, 10, 20, 11, 21]],
    ['bold', { bold: true }, [1, 3]], ['lines', { lines: ['Changed', 'second'] }, [1, 3]],
  ];
  for (const old of fixtures) for (const [name, patch, changed] of cases) {
    const before = structuredClone(old), m = { ...TX.decode(old), ...patch }, next = TX.reencode(old, m), label = `${old.type} ${name}`;
    const converted = next.type !== old.type;
    assert.deepEqual(old, before, `${label}: source unchanged`);
    assert.equal(next.type, converted ? 'MTEXT' : old.type, label);
    assert.deepEqual(pairs(next, shared.map(([c]) => c)), pairs(old, shared.map(([c]) => c)), `${label}: shared codes`);
    assert.equal(next.layer, old.layer); assert.equal(next.aci, old.aci);
    if (converted) {
      assert.equal(val(next, 41), undefined); assert.equal(val(next, 51), undefined); assert.equal(val(next, 73), undefined);
    } else {
      const touched = old.type === 'TEXT' && name === 'angle' ? [50] : changed;
      assert.deepEqual(pairs(next, touched, false), pairs(old, touched, false), `${label}: untouched codes`);
    }
    const decoded = TX.decode(next);
    for (const key of Object.keys(patch)) {
      if (typeof patch[key] === 'number') near(decoded[key], patch[key]); else assert.deepEqual(decoded[key], patch[key], `${label}: ${key}`);
    }
    if (name === 'height') assert.equal(val(next, 40), '9');
    if (name === 'font') assert.equal(val(next, 7), 'Mono');
    if (name === 'angle') {
      assert.equal(val(next, 50), '30');
      if (old.type === 'MTEXT') { near(+val(next, 11), Math.cos(Math.PI / 6)); near(+val(next, 21), 0.5); }
    }
    if (name === 'align') { assert.equal(val(next, old.type === 'TEXT' ? 72 : 71), old.type === 'TEXT' ? '2' : '3'); near(decoded.x, m.x); near(decoded.y, m.y); }
    if (name === 'lines' || name === 'bold') {
      assert.deepEqual(pairs(next, [1, 3]), pairs(TX.encode(m), [1, 3]), `${label}: new plain string`);
    } else assert.deepEqual(pairs(next, [1, 3]), pairs(old, [1, 3]), `${label}: raw string`);
  }
  for (const old of fixtures) {
    assert.deepEqual(TX.reencode(old, TX.decode(old)), old, 'no-op preserves every code');
    const m = TX.decode(old), moved = TX.reencode(old, { ...m, x: m.x + 8, y: m.y - 4 });
    const point = old.type === 'TEXT' ? [11, 21] : [10, 20];
    assert.deepEqual(pairs(moved, point, false), pairs(old, point, false));
    near(+val(moved, point[0]), +val(old, point[0]) + 8); near(+val(moved, point[1]), +val(old, point[1]) - 4);
    const scaled = TX.reencode(old, { ...m, h: m.h * 2, x: m.x + 8, y: m.y - 4 }), anchor = TX.decode(scaled);
    assert.deepEqual(pairs(scaled, [...point, 40], false), pairs(old, [...point, 40], false));
    near(anchor.x, m.x + 8); near(anchor.y, m.y - 4); near(anchor.h, m.h * 2);
    const zero = TX.reencode(old, { ...m, angle: 0 });
    near(TX.decode(zero).angle, 0);
    if (old.type === 'TEXT') {
      const left = TX.reencode(old, { ...m, ha: 0 });
      assert.equal(val(left, 72), '0'); near(TX.decode(left).x, m.x); near(TX.decode(left).y, m.y);
    }
  }
  const single = entity('MTEXT', [[10, 0], [20, 10], [40, 5], [1, '\\H2;Hello'], ...shared]);
  for (const patch of [{ h: 8 }, { angle: 30 }, { font: 'Mono', styleName: 'Mono' }, { ha: 2 }]) {
    const next = TX.reencode(single, { ...TX.decode(single), ...patch });
    assert.equal(next.type, 'MTEXT'); assert.equal(val(next, 1), val(single, 1));
  }
  for (const old of [single, TX.reencode(single, { ...TX.decode(single), bold: true })]) {
    const next = TX.reencode(old, { ...TX.decode(old), lines: ['new'], bold: false });
    assert.equal(next.type, 'TEXT'); assert.equal(val(next, 1), 'new');
    assert.deepEqual(pairs(next, shared.map(([c]) => c)), pairs(old, shared.map(([c]) => c)));
  }
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
