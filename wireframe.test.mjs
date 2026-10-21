import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paintMode } from './web/wireframe.js';
import { paintDrawing } from './web/render.js';
import { flatten, readDxf } from './web/drawing.js';
import { planPdf } from './web/pdf-export.js';

test('wireframe outlines filled paths, both hatches and masks; keeps text and points', () => {
  for (const [item, normal, wire] of [
    [{ k: 'p', ops: [], lw: 200, w: 8 }, 'stroke', 'stroke'],
    [{ k: 'p', ops: [], fill: 1 }, 'fill', 'stroke'],
    [{ k: 'h', ops: [], fam: [] }, 'hatch', 'stroke'],
    [{ k: 'w', ops: [] }, 'mask', 'stroke'],
    [{ k: 't' }, 'text', 'text'], [{ k: 'n' }, 'point', 'point'],
  ]) {
    const before = structuredClone(item);
    assert.equal(paintMode(item), normal);
    assert.equal(paintMode(item, true), wire);
    assert.deepEqual(item, before);
  }
});

test('wireframe screen has no fills or pictures, one CSS pixel strokes at every zoom; output stays intact', () => {
  const raw = readDxf(readFileSync('fixtures/wireframe.dxf', 'utf8')), fl = flatten(raw);
  const before = JSON.stringify(fl);
  const pdf = () => planPdf({ fl, factor: 1, off: new Set(), sheetW: 240, sheetH: 150 }, { page: 'sheet', separate: false }).bytes();
  const bytes = pdf();
  for (const stretch of [1, 3]) for (const scale of [.5, 2, 10]) for (const dpr of [1, 2]) {
    const widths = [], text = [], stack = [];
    let matrix, width;
    const c = {
      setTransform: (...m) => { matrix = m; }, clearRect() {}, setLineDash(dash) { assert.deepEqual(dash, []); },
      beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, closePath() {},
      save() { stack.push([matrix, width]); }, restore() { [matrix, width] = stack.pop(); }, translate() {}, rotate() {}, scale() {},
      set lineWidth(w) { width = w; }, stroke() { widths.push(width * Math.abs(matrix[0]) / dpr); },
      strokeText(s) { text.push(s); }, fill() { assert.fail('wireframe filled a path'); },
      fillText() { assert.fail('wireframe filled text'); }, drawImage() { assert.fail('wireframe drew the background'); },
    };
    paintDrawing({ width: 5000, height: 5000, getContext: () => c }, { fl, off: new Set(), factor: 1, sheetH: 150,
      ox: 0, oy: 0, scale, w: 5000, h: 5000, dpr, wireframe: true, bg: { visible: true, bitmap: {} },
      slots: [[stretch, 0, 0, -1, 0, 150]] });
    assert.ok(widths.length >= 4);
    widths.forEach((w) => assert.ok(Math.abs(w - 1) < 1e-9));
    assert.ok(text.length);
  }
  assert.equal(JSON.stringify(fl), before, 'view painting did not change flattened entities');
  assert.deepEqual(pdf(), bytes, 'PDF retains the fills and widths');
});
