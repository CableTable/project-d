import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDoc, line, arc, circle, lwpoly, entity, writeDxf } from './web/dxf-write.js';
import { readDxf, flatten, strokeWidth } from './web/drawing.js';
import { widthKey, withWidth } from './web/props.js';
import { planPdf } from './web/pdf-export.js';
import { paintDrawing } from './web/render.js';

const near = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} vs ${b}`);
const roundtrip = (ents, units = 4) => readDxf(writeDxf({ ...newDoc(units), entities: ents }));

test('outline lineweights round trip for lines, arcs and circles, including inch input', () => {
  for (const e of [line(10, 10, 40, 10), arc(30, 30, 10, 0, 90), circle(50, 50, 10)]) {
    assert.equal(widthKey(e), 'ByLayer');
    for (const value of ['ByLayer', 'Hairline', .1, .25, .5, 1, 2, .37]) {
      const saved = roundtrip([withWidth(e, value)]).entities[0];
      assert.equal(widthKey(saved), value);
      assert.equal(saved.lw, value === 'ByLayer' ? -1 : value === 'Hairline' ? 5 : value * 100);
    }
    for (const mm of [.25, .37]) {
      const inch = roundtrip([withWidth(e, mm, 25.4)], 1).entities[0];
      assert.equal(inch.lw, mm * 100); near(widthKey(inch, 25.4), mm);
    }
    assert.equal(roundtrip([withWidth(e, .376)]).entities[0].lw, 38, 'hundredths of mm');
    for (const bad of [null, '', 'oops', 0, -1, NaN, Infinity, 328]) assert.equal(withWidth(e, bad), null);
  }
});

test('constant polyline widths replace vertex widths and reset to Hairline or ByLayer', () => {
  const light = lwpoly([[10, 10, .2], [40, 10], [40, 30]], { width: 3 });
  light.r.c.push(40, 41); light.r.v.push('1', '2');
  const legacy = entity('POLYLINE', [[70, 0], [40, 1], [41, 2]]);
  legacy.kids = [entity('VERTEX', [[10, 10], [20, 10], [40, 1], [41, 2]]).r,
    entity('VERTEX', [[10, 40], [20, 10], [40, 3], [41, 4]]).r];
  assert.equal(widthKey(legacy), null, 'varying widths');
  for (const e of [light, legacy]) {
    for (const factor of [1, 25.4]) {
      const wide = roundtrip([withWidth(e, .123456, factor)], factor === 1 ? 4 : 1);
      near(widthKey(wide.entities[0], factor), .123456, factor * 1e-6);
      near(flatten(wide).items[0].w, .123456 / factor);
      assert.equal(wide.entities[0].lw, -1);
      for (const key of ['ByLayer', 'Hairline']) {
        const reset = roundtrip([withWidth(wide.entities[0], key, factor)]);
        assert.equal(widthKey(reset.entities[0], factor), key);
        assert.equal(flatten(reset).items[0].w, undefined);
      }
    }
  }
});

test('PDF and Print preserve weights, constant widths, ByLayer and 0.05 mm Hairline after reopening', () => {
  for (const [units, factor] of [[4, 1], [1, 25.4]]) {
    const raw = newDoc(units);
    raw.layers[0].lw = 100;
    raw.entities = [withWidth(line(1, 1, 2, 1), 'Hairline', factor),
      withWidth(arc(3, 3, 1, 0, 90), .37, factor),
      withWidth(circle(4, 4, 1), .5, factor),
      withWidth(lwpoly([[1, 2], [2, 2]]), 2, factor), line(1, 3, 2, 3)];
    for (const doc of [raw, readDxf(writeDxf(raw))]) {
      const fl = flatten(doc);
      for (const mirror of [false, true]) {
        const plan = planPdf({ fl, factor, off: new Set(), sheetW: 200, sheetH: 200 }, { page: 'sheet', separate: false, mirror });
        const widths = plan.build(0).cmds.filter((c) => c[0] === 'w').slice(1).map((c) => c[1]);
        [.05, .37, .5, 2, 1].forEach((w, i) => near(widths[i], w));
        assert.match(Buffer.from(plan.bytes()).toString('latin1'), /0\.05 w/);
      }
    }
  }
  assert.equal(strokeWidth({ lw: 0 }), .05, 'Hairline is the minimum');
});

test('screen stroke scales with zoom and agrees with physical widths, including inches', () => {
  for (const factor of [1, 25.4]) {
    const fl = flatten(roundtrip([line(1, 1, 3, 1), arc(3, 3, 1, 0, 90), circle(4, 4, 1), lwpoly([[1, 2], [2, 2]])]
      .map((e) => withWidth(e, .5, factor))));
    for (const scale of [.1, 2, 10, 1000]) {
      const strokes = [];
      let matrix, width;
      const c = { setTransform: (...m) => { matrix = m; }, clearRect() {}, setLineDash() {}, beginPath() {}, moveTo() {}, lineTo() {}, arc() {},
        set lineWidth(w) { width = w; }, stroke() { strokes.push(width * Math.abs(matrix[0])); } };
      paintDrawing({ width: 5000, height: 5000, getContext: () => c }, { fl, off: new Set(), factor, sheetH: 100, ox: 0, oy: 0, scale, w: 5000 * Math.max(1, scale), h: 5000 * Math.max(1, scale), dpr: 2 });
      assert.ok(strokes.length);
      for (const w of strokes) near(w, Math.max(.5 * scale * 2, 1.2 * 2), factor * scale * 2 * 1e-6); // DXF widths save to six decimals in drawing units.
    }
  }
});

test('inch polyline presets and Custom widths save in drawing units', () => {
  for (const mm of [.25, .37]) {
    const saved = roundtrip([withWidth(lwpoly([[0, 0], [2, 0]]), mm, 25.4)], 1).entities[0];
    near(+saved.r.v[saved.r.c.indexOf(43)], mm / 25.4);
    near(widthKey(saved, 25.4), mm, 25.4e-6);
  }
});

test('selection keeps the true-width object ink under a thin accent centre line', () => {
  for (const factor of [1, 25.4]) {
    const fl = flatten(roundtrip([withWidth(line(1, 1, 3, 1, { aci: 1 }), 2, factor)]));
    for (const dark of [false, true]) {
      const strokes = [];
      let matrix, width, colour;
      const c = { setTransform: (...m) => { matrix = m; }, clearRect() {}, setLineDash() {}, beginPath() {}, moveTo() {}, lineTo() {},
        set lineWidth(w) { width = w; }, set strokeStyle(v) { colour = v; },
        stroke() { strokes.push([colour, width * Math.abs(matrix[0])]); } };
      paintDrawing({ getContext: () => c }, { fl, hl: fl.items, accent: '#4f46e5', off: new Set(), factor, dark,
        sheetH: 100, ox: 0, oy: 0, scale: 10, w: 5000, h: 5000, dpr: 2 });
      assert.equal(strokes.length, 2);
      assert.equal(strokes[0][0], '#ff0000'); near(strokes[0][1], 40);
      assert.equal(strokes[1][0], '#4f46e5'); near(strokes[1][1], 5.2);
    }
  }
});

test('Hairline uses the 1.2 CSS pixel screen minimum when zoomed out', () => {
  const fl = flatten(roundtrip([withWidth(line(0, 0, 100, 0), 'Hairline')]));
  let width, matrix;
  const c = { setTransform: (...m) => { matrix = m; }, clearRect() {}, setLineDash() {}, beginPath() {}, moveTo() {}, lineTo() {},
    set lineWidth(w) { width = w; }, stroke() { near(width * Math.abs(matrix[0]), 2.4); } };
  paintDrawing({ getContext: () => c }, { fl, off: new Set(), factor: 1, sheetH: 100, ox: 0, oy: 0, scale: 1, w: 500, h: 500, dpr: 2 });
});
