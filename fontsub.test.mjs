import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fontForStyle, fontSubstitutions } from './web/fontsub.js';
import { readDxf, flatten } from './web/drawing.js';
import { fontOf, paintDrawing } from './web/render.js';
import { readFileSync } from 'node:fs';

const style = (file) => ({ c: [3], v: [file] });
const text = (st) => ({ k: 't', st });
const styles = { Standard: style('romans.shx'), GOST: style('GOST.ttf'), Good: style('Arial.TTF'), Same: style('ROMANS.SHX'), Unused: style('unused.shx') };

test('SHX and missing TTF are named once; available and unused fonts are silent', () => {
  assert.deepEqual(fontSubstitutions(styles, [text(), text('standard'), text('GOST'), text('Good'), text('Same'), { k: 'p' }]), [
    { asked: 'romans.shx', shown: 'Arial' }, { asked: 'GOST.ttf', shown: 'Arial' },
  ]);
  assert.deepEqual(fontSubstitutions(undefined, [text()]), []);
  assert.deepEqual(fontSubstitutions({ Standard: style('') }, [text()]), []);
  assert.deepEqual(fontSubstitutions(styles, [text('Good')]), []);
});

test('font choice uses the file, case-insensitive style names and supported Windows paths', () => {
  assert.equal(fontForStyle(styles, 'STANDARD'), 'Arial');
  assert.equal(fontForStyle(styles, 'GOST'), 'Arial');
  assert.equal(fontForStyle(styles, 'Good'), 'Arial');
  assert.equal(fontForStyle({ Other: style('C:\\Windows\\Fonts\\consola.ttf') }, 'other'), 'Mono');
  assert.equal(fontForStyle({}, 'Standard'), 'Standard');
  assert.equal(fontForStyle({}, 'Mono'), 'Mono');
});

test('flattened text and the canvas use the same fallback as the note', () => {
  const doc = readDxf(readFileSync('fixtures/font-note.dxf', 'utf8'));
  const fl = flatten(doc), items = fl.items.filter((it) => it.k === 't');
  assert.equal(items.length, 2);
  assert.deepEqual(fontSubstitutions(doc.styles, items), [{ asked: 'romans.shx', shown: 'Arial' }]);
  assert.ok(items.every((it) => it.font === 'Arial' && fontOf(it).includes('Arial')));
  const fonts = [], c = {
    setTransform() {}, clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    fillText() { fonts.push(this.font); },
  };
  paintDrawing({ getContext: () => c }, { fl, off: new Set(), factor: 1, sheetH: 40, ox: 0, oy: 0, scale: 1, w: 200, h: 100, dpr: 1 });
  assert.equal(fonts.length, 2);
  assert.ok(fonts.every((font) => font.startsWith('100px Arial,')), 'default STYLE is honoured even without TEXT group 7');
});
