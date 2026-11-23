// titleblock.js — the title block of a Layouts sheet (TODO 9a).   node titleblock.test.mjs
import assert from 'node:assert/strict';
import { readDxf } from './web/drawing.js';
import { writeDxf, newDoc, addBlock } from './web/dxf-write.js';
import * as LD from './web/layoutdoc.js';
import * as T from './web/titleblock.js';
import { usableArea, stepRepeat } from './web/layout.js';
import { cleanTitleBlock } from './web/pdf-export.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }

const DATE = '23-11-2026';
function withTitle(store = {}, sheet = {}) {
  const lay = LD.newLayout('T');
  Object.assign(lay.s, sheet);
  const blocks = newDoc(4); addBlock(blocks, T.TITLE_NAME, T.titleBlockEntities());
  const ent = T.titleInsert(...T.titleSpot(lay.s), T.titleValues(store, T.titleAuto(lay, 'f.dxf', DATE)));
  const part = LD.objectPart('tb1', 'Title block', ent, LD.layersOf(lay), {}, blocks.blocks);
  lay.parts.tb1 = part; lay.placed.push(LD.objectPlacement(part));
  return lay;
}
const texts = (lay) => T.titleTexts(T.titlePartOf(lay).raw.entities[0]);

test('TODO 9a: the block has an ATTDEF and an ATTRIB for each of the 9 fields, bottom-right inside the sheet', () => {
  const defs = T.titleBlockEntities().filter((e) => e.type === 'ATTDEF');
  assert.deepEqual(defs.map((e) => e.r.v[e.r.c.indexOf(2)]), ['TITLE', 'DRAWING_NO', 'REV', 'SCALE', 'SHEET_SIZE', 'DATE', 'DRAWN_BY', 'MATERIAL', 'FILE']);
  const lay = withTitle();
  assert.deepEqual(lay.parts.tb1.box, [850, 0, 1000, 44]);
  assert.deepEqual(T.titleSpot({ sheetW: 1000, sheetH: 700, gripRight: 20, gripBottom: 10 }), [830, 10], 'inside the grippers');
  assert.equal(T.titleSpot({ sheetW: 100, sheetH: 700 }), null, 'a sheet too small for it');
});

test('TODO 9a: scale, sheet size, date and file name are auto until typed; the rest start empty', () => {
  const lay = withTitle();
  assert.deepEqual(texts(lay), { TITLE: '', DRAWING_NO: '', REV: '', SCALE: '1:1', SHEET_SIZE: '1000 x 700 mm', DATE, DRAWN_BY: '', MATERIAL: '', FILE: 'f.dxf' });
  const typed = T.titleValues({ date: '01-01-2027', title: 'Plate' }, T.titleAuto(lay, 'f.dxf', DATE));
  assert.equal(typed.DATE, '01-01-2027'); assert.equal(typed.TITLE, 'Plate'); assert.equal(typed.FILE, 'f.dxf');
});

test('TODO 9a: syncTitle follows the settings and the sheet: a typed value sticks, an auto one is live, the block stays where it is', () => {
  const lay = withTitle();
  let k = 0;
  assert.equal(LD.syncTitle(lay, {}, 'f.dxf', DATE, () => 'n' + k++), false, 'nothing changed: the same part');
  lay.s.sheetW = 800; lay.s.sheetH = 500;
  assert.equal(LD.syncTitle(lay, { date: 'typed' }, 'g.dxf', DATE, () => 'n' + k++), true);
  assert.deepEqual([texts(lay).SHEET_SIZE, texts(lay).FILE, texts(lay).DATE], ['800 x 500 mm', 'g.dxf', 'typed']);
  assert.equal(Object.keys(lay.parts).length, 1, 'the old part is gone');
  assert.deepEqual(lay.parts[lay.placed[0].partId].box, [850, 0, 1000, 44], 'in the same place');
  assert.equal(LD.syncTitle(lay, { date: 'typed' }, 'g.dxf', 'tomorrow', () => 'n' + k++), false, 'a typed date ignores the day');
});

test('TODO 9a: an edit in the dialog: a value that differs from auto is typed, one that equals it is auto again (Reset)', () => {
  const lay = withTitle(), auto = T.titleAuto(lay, 'f.dxf', DATE), ent = T.titlePartOf(lay).raw.entities[0];
  const edited = T.withTitleValues(ent, { TITLE: 'Bracket', SCALE: '1:2', FILE: 'f.dxf' });
  const store = T.typedFromEnt(edited, auto, { enabled: true, rev: 'stale' });
  assert.deepEqual(store, { enabled: true, title: 'Bracket', scale: '1:2' }, 'REV came back empty = auto = no typed value; FILE equals auto');
  const reset = T.typedFromEnt(T.withTitleValues(edited, { SCALE: '1:1' }), auto, store);
  assert.deepEqual(reset, { enabled: true, title: 'Bracket' });
  assert.deepEqual(cleanTitleBlock(store), store, 'the tab settings keep the sheet fields');
});

test('TODO 9a: a reopened file reads the fields back except the date and file name (they stay auto)', () => {
  const lay = withTitle({ title: 'Plate', rev: 'B', date: 'yesterday', file: 'old.dxf' });
  const ent = T.titlePartOf(lay).raw.entities[0];
  const store = T.typedFromEnt(ent, T.titleAuto(lay, 'new.dxf', DATE), undefined, T.FROM_FILE);
  assert.deepEqual(store, { title: 'Plate', rev: 'B' });
});

test('TODO 9a: usableArea keeps the title block\'s strip clear, so a grid avoids it', () => {
  const lay = withTitle(), plain = LD.newLayout('P');
  assert.equal(T.sheetArea(lay).titleH, 44);
  assert.equal(usableArea(T.sheetArea(plain)).h, 700);
  assert.equal(usableArea(T.sheetArea(lay)).h, 656);
  const fit = (l) => stepRepeat({ ...T.sheetArea(l), partW: 100, partH: 300, fit: true }).rows;
  assert.equal(fit(plain), 2); assert.equal(fit(lay), 2);
  assert.equal(stepRepeat({ ...T.sheetArea(lay), partW: 100, partH: 330, fit: true }).rows, 1, '2 rows of 330 need 660 > 656');
  assert.equal(stepRepeat({ ...T.sheetArea(plain), partW: 100, partH: 330, fit: true }).rows, 2);
});

test('TODO 9a: saved as INSERT + ATTRIBs and read back with every value (and the layout settings)', () => {
  const lay = withTitle({ title: 'Plate', drawingNo: 'D-1', rev: 'A', drawnBy: 'RR', material: 'Mild steel', scale: '1:5' });
  const back = LD.layoutFromRaw(readDxf(writeDxf(LD.layoutRaw(lay))));
  const part = T.titlePartOf(back);
  assert.ok(part, 'the title block comes back as a title block');
  assert.deepEqual(T.titleTexts(part.raw.entities[0]), texts(lay));
  assert.equal(part.raw.entities[0].kids.length, 9);
  assert.ok(part.raw.blocks[T.TITLE_NAME].entities.some((e) => e.type === 'ATTDEF'), 'the ATTDEFs are in the block');
  assert.deepEqual(part.box, [850, 0, 1000, 44]);
});

console.log(n + ' tests');
