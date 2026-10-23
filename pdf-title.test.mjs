import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTitleBlock, titleBlockTexts, checkFit, planPdf, readTitleBlock, withTitleBlock } from './web/pdf-export.js';
import { newDoc, addEntities, line, writeDxf } from './web/dxf-write.js';
import { readDxf, flatten } from './web/drawing.js';
import { newLayout, layoutRaw, layoutFromRaw } from './web/layoutdoc.js';

const src = { name: 'Bracket', part: true, sheetW: 100, sheetH: 200, date: '23-10-2026' };
const page = { scale: 0.5, layer: null, n: 1, of: 1 };

test('title block: defaults, overrides, empty fields, automatic and typed dates', () => {
  assert.deepEqual(cleanTitleBlock(), { enabled: true });
  assert.deepEqual(titleBlockTexts(src, page), {
    file: 'Bracket', scale: 'NOT 1:1 · scale 1 : 2', size: 'Part 100 × 200 mm · ALL · page 1/1',
    date: '23-10-2026', footnote: 'Fitted to one page: not 1:1, not to be used as film',
  });
  const changed = cleanTitleBlock({ footnote: '<shop & film>', file: '', date: 'Approved yesterday', scale: 4, extra: 'ignored' });
  const texts = titleBlockTexts({ ...src, date: '24-10-2026' }, page, changed);
  assert.equal(texts.footnote, '<shop & film>');
  assert.equal(texts.file, '');
  assert.equal(texts.date, 'Approved yesterday');
  assert.equal(texts.scale, 'NOT 1:1 · scale 1 : 2');
  assert.equal(titleBlockTexts({ ...src, date: '24-10-2026' }, page, { footnote: '' }).date, '24-10-2026');
  assert.equal(titleBlockTexts(src, { ...page, layer: 'cut', n: 2, of: 3 }).size, 'Part 100 × 200 mm · CUT · page 2/3');
});

test('title block off releases exactly 22 mm; output has no labels, properties retain actual scale', () => {
  const on = checkFit(100, 200, 210, 297), off = checkFit(100, 200, 210, 297, false);
  assert.ok(Math.abs((off.s - on.s) * 200 - 22) < 1e-9);
  assert.equal(off.oy, 10);
  const raw = addEntities(newDoc(), line(0, 0, 100, 200));
  const source = { ...src, fl: flatten(raw), factor: 1, off: new Set() };
  const options = { page: 'check', separate: false, titleBlock: { file: '', footnote: 'Shop proof' } };
  const plan = planPdf(source, options);
  const texts = plan.build(0).cmds.filter((c) => c[0] === 'T').map((c) => c[2]);
  assert.ok(texts.includes('Shop proof'));
  assert.ok(!texts.includes('Bracket'));
  const hidden = planPdf(source, { ...options, titleBlock: { enabled: false, footnote: 'Shop proof' } });
  assert.equal(hidden.build(0).cmds.some((c) => c[0] === 'T'), false);
  assert.match(Buffer.from(hidden.bytes()).toString('latin1'), /\/Subject \(Scale [\d.]+ : [\d.]+\)/);
  assert.ok(hidden.pages[0].scale > plan.pages[0].scale);
});

test('title settings round-trip in drawings and layouts without changing their artwork', () => {
  const value = { enabled: false, date: '', footnote: 'Approved (rev 2) \\ <b>日本語</b> ' + 'x'.repeat(500) };
  const drawing = addEntities(newDoc(), line(0, 0, 100, 200));
  for (const raw of [drawing, layoutRaw(newLayout('Test'))]) {
    const stored = withTitleBlock(raw, value);
    assert.equal(readTitleBlock(raw), undefined, 'source was not mutated');
    const reopened = readDxf(writeDxf(stored, { escapeUnicode: true }));
    assert.deepEqual(readTitleBlock(reopened), value);
    assert.equal(flatten(reopened).items.length, flatten(raw).items.length);
    if (layoutFromRaw(raw)) assert.ok(layoutFromRaw(reopened));
    const reset = readDxf(writeDxf(withTitleBlock(reopened, { enabled: true })));
    assert.deepEqual(readTitleBlock(reset), { enabled: true });
  }
  assert.deepEqual(cleanTitleBlock({ enabled: 0, date: null, file: {}, size: '' }), { enabled: true, size: '' });
  assert.equal(readTitleBlock({ blocks: { PD_PDF_TITLE: { entities: [] } } }), undefined);
});
