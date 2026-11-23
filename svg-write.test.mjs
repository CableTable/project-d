// svg-write.js — a Page as SVG: paths, fill rules, stroke, clip, text (escaped), picture, size in mm / in, precision.   node svg-write.test.mjs
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { Page } = await import('./web/pdf-write.js');
const { pageToSvg } = await import('./web/svg-write.js');
const X = await import('./web/pdf-export.js');
const D = await import('./web/drawing.js');

test('a page: size in mm, viewBox, y flipped, a stroked line', () => {
  const p = new Page(100, 50);
  p.strokeColor([1, 0, 0]); p.lineWidth(0.25); p.moveTo(10, 10); p.lineTo(90.123456789, 40); p.stroke();
  const s = pageToSvg(p);
  assert.match(s, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="100mm" height="50mm" viewBox="0 0 100 50"/);
  assert.match(s, /<path d="M10 40 L90.123457 10" fill="none" stroke="#ff0000" stroke-width="0.25"\/>/);
  assert.match(s, /<\/svg>\n$/);
});

test('inches: width / height in in, every number divided by 25.4; precision sets the decimals', () => {
  const p = new Page(254, 127);
  p.moveTo(25.4, 0); p.lineTo(127, 127); p.stroke();
  const s = pageToSvg(p, { unit: 'in', precision: 2 });
  assert.match(s, /width="10in" height="5in" viewBox="0 0 10 5"/);
  assert.match(s, /d="M1 5 L5 0"/);
  assert.match(pageToSvg(Object.assign(new Page(1, 1), {}), { precision: 0 }), /width="1mm"/);
  const q = new Page(10, 10); q.moveTo(1.23456, 2.34567); q.lineTo(3, 3); q.stroke();
  assert.match(pageToSvg(q, { precision: 3 }), /d="M1.235 7.654 L3 7"/);
});

test('fill: nonzero and even-odd, colour, close', () => {
  const p = new Page(10, 10);
  p.fillColor([0, 0, 1]); p.rect(1, 1, 2, 2); p.fill(); p.fillColor([0, 1, 0]); p.rect(4, 4, 2, 2); p.fill(true);
  const s = pageToSvg(p);
  assert.match(s, /<path d="M1 9 L3 9 L3 7 L1 7 Z" fill="#0000ff"\/>/);
  assert.match(s, /fill="#00ff00" fill-rule="evenodd"\/>/);
});

test('stroke state: caps, joins, dashes; q / Q restore it', () => {
  const p = new Page(10, 10);
  p.save(); p.lineEnds('round', 'bevel'); p.dash([1, 0.5]); p.moveTo(0, 0); p.lineTo(5, 5); p.stroke(); p.restore();
  p.moveTo(0, 1); p.lineTo(5, 1); p.stroke();
  const [a, b] = pageToSvg(p).split('\n').filter((l) => l.startsWith('<path'));
  assert.match(a, /stroke-linecap="round" stroke-linejoin="bevel" stroke-dasharray="1 0.5"/);
  assert.doesNotMatch(b, /linecap|linejoin|dasharray/);
});

test('clip: the path becomes a clipPath, the rest sits in a group closed by restore', () => {
  const p = new Page(10, 10);
  p.moveTo(0, 0); p.lineTo(1, 1); p.stroke();                     // before the clip: not inside it
  p.save(); p.rect(0, 0, 5, 5); p.clip(true); p.moveTo(2, 2); p.lineTo(3, 3); p.stroke(); p.restore();
  p.moveTo(4, 4); p.lineTo(5, 5); p.stroke();
  const s = pageToSvg(p), lines = s.split('\n');
  assert.match(s, /<defs><clipPath id="c0"><path d="M0 10 L5 10 L5 5 L0 5 Z" clip-rule="evenodd"\/><\/clipPath><\/defs>/);
  const open = lines.findIndex((l) => l.startsWith('<g clip-path="url(#c0)">')), shut = lines.indexOf('</g>');
  assert.ok(open > 0 && shut === open + 2, lines.join('|'));
  assert.ok(lines.findIndex((l) => l.includes('M4 6')) > shut && lines.findIndex((l) => l.includes('M0 10 L1 9')) < open);
});

test('an unclosed save is closed at the end', () => {
  const p = new Page(10, 10);
  p.save(); p.rect(0, 0, 5, 5); p.clip(); p.moveTo(1, 1); p.lineTo(2, 2); p.stroke();
  const s = pageToSvg(p);
  assert.equal((s.match(/<g /g) || []).length, (s.match(/<\/g>/g) || []).length);
});

test('text: escaped, as text, WinAnsi back to Unicode, matrix flipped', () => {
  const p = new Page(100, 50);
  p.fillColor([0, 0, 0]); p.text([2.5, 0, 0, 2.5, 10, 20], 'A & B <c> "d" \x80 \xb5');
  const s = pageToSvg(p);
  assert.match(s, /<text transform="matrix\(2.5 0 0 2.5 10 30\)" fill="#000000" font-family="Helvetica, Arial, sans-serif" font-size="1" xml:space="preserve">A &amp; B &lt;c&gt; &quot;d&quot; € µ<\/text>/);
  const r = new Page(100, 50); r.text([0, 2.5, -2.5, 0, 10, 20], 'x');
  assert.match(pageToSvg(r), /matrix\(0 -2.5 2.5 0 10 30\)/);
  assert.doesNotMatch(pageToSvg(new Page(1, 1)), /<text/);
});

test('a picture: its data URI, placed by its matrix (top row at the top)', () => {
  const p = new Page(100, 50), px = 'data:image/png;base64,iVBORw0KGgo=';
  p.image([20, 0, 0, 10, 5, 10], { w: 1, h: 1, rgb: new Uint8Array(3), a: null, px });
  const s = pageToSvg(p);
  assert.match(s, new RegExp(`<image width="1" height="1" preserveAspectRatio="none" transform="matrix\\(20 0 0 10 5 30\\)" href="${px}"/>`));
  const q = new Page(100, 50); q.image([20, 0, 0, 10, 5, 10], { w: 1, h: 1, rgb: new Uint8Array(3), a: null, px: 'x" onload="y' });
  assert.doesNotMatch(pageToSvg(q), /onload="y/);                 // the attribute is escaped
  const none = new Page(100, 50); none.image([1, 0, 0, 1, 0, 0], { w: 1, h: 1, rgb: new Uint8Array(3), a: null });
  assert.doesNotMatch(pageToSvg(none), /<image/);                 // no data URI: left out, never a broken element
});

test('a drawing through planPdf: its line and text are there, no NaN', () => {
  const raw = D.readDxf(D.decodeDxf(new TextEncoder().encode(['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '30', '21', '20', '0', 'TEXT', '8', '0', '10', '1', '20', '1', '40', '2', '1', 'Hi <&>', '0', 'ENDSEC', '0', 'EOF', ''].join('\r\n'))));
  const fl = D.flatten(raw), src = X.partSource({ fl, factor: 1, off: new Set(), name: 'x', hide: [] }, 0);
  const page = X.planPdf(src, { page: 'sheet', separate: false, mirror: false, negative: false, black: false, strip: false, titleBlock: { enabled: false } }).build(0);
  const s = pageToSvg(page, { precision: 3 });
  assert.match(s, /width="30mm" height="20.1mm"/);              // the drawing's box: the text's own box runs 0.1 mm past the line
  assert.match(s, /<path d="M0 20 L30 0"/);
  assert.match(s, />Hi &lt;&amp;&gt;<\/text>/);
  assert.doesNotMatch(s, /NaN|undefined/);
});

test('TODO 109d1: Line weights off draws every stroke at 0.05 mm; Hidden objects on draws the code-60 line (flatten option)', async () => {
  const W = await import('./web/dxf-write.js');
  const doc = W.newDoc(4); W.addEntities(doc, W.line(0, 0, 30, 0, { lw: 50 }), W.line(0, 10, 30, 10, { hidden: true }), W.text(1, 1, 2, 'Hi'));
  const svg = (opts, flat) => {
    const fl = D.flatten(D.readDxf(W.writeDxf(doc)), undefined, opts), src = X.partSource({ fl, factor: 1, off: new Set(), name: 'x', hide: [] }, 0);
    const page = X.planPdf(src, { page: 'sheet', separate: false, mirror: false, negative: false, black: false, strip: false, titleBlock: { enabled: false } }).build(0);
    return pageToSvg(flat ? page.hairlines() : page);
  };
  const widths = (s) => [...s.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => m[1]);
  assert.deepEqual(widths(svg()), ['0.5'], 'on: the 0.50 mm line keeps its width; the code-60 line is not drawn');
  assert.deepEqual(widths(svg(undefined, true)), ['0.05'], 'off: hairline');
  assert.match(svg(undefined, true), />Hi<\/text>/, 'text is untouched');
  assert.deepEqual(widths(svg({ hidden: true })), ['0.5', '0.25'], 'Hidden objects on: the code-60 line is drawn too (Default weight 0.25)');
  assert.deepEqual(widths(svg({ hidden: true }, true)), ['0.05', '0.05']);
});
