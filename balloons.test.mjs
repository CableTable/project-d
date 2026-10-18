// balloons.js — numbering, the sidecar, CSV and the text under the arrow.   node balloons.test.mjs
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const B = await import('./web/balloons.js');

const place = (set, tip, c, sheet = 1) => B.add(set, { tip, c, sheet });
const nums = (set) => set.items.map((it) => it.n);

test('the next number goes up by itself; a typed number restarts the count from there', () => {
  let s = place(B.EMPTY, [10, 10], [20, 20]);
  s = place(s, [30, 10], [40, 20]);
  assert.deepEqual(nums(s), [1, 2]); assert.equal(s.next, 3);
  s = B.setNext(s, 10);
  s = place(s, [50, 10], [60, 20]);
  assert.deepEqual(nums(s), [1, 2, 10]); assert.equal(s.next, 11);
  assert.equal(B.setNext(s, 0), null); assert.equal(B.setNext(s, 1.5), null); assert.equal(B.setNext(s, 'x'), null);
  assert.equal(B.setNext(s, '7').next, 7);
  assert.equal(B.EMPTY.items.length, 0, 'the empty set is never changed');
});

test('parseNo: whole numbers from 1 only', () => {
  assert.equal(B.parseNo(' 12 '), 12);
  for (const bad of ['', '0', '-3', '2.5', 'a', '1e3', '1234567']) assert.equal(B.parseNo(bad), null, bad);
});

test('delete: the others keep their numbers; the last one placed gives its number back', () => {
  let s = B.EMPTY;
  for (let i = 0; i < 4; i++) s = place(s, [i, 0], [i, 5]);
  const mid = B.remove(s, s.items[1].id);
  assert.deepEqual(nums(mid), [1, 3, 4]); assert.equal(mid.next, 5);
  const last = B.remove(s, s.items[3].id);
  assert.deepEqual(nums(last), [1, 2, 3]); assert.equal(last.next, 4);
  assert.equal(B.remove(s, 999), s);
});

test('renumber: 1…n in sheet order, then placement order; the count carries on after the last', () => {
  let s = place(B.EMPTY, [0, 0], [1, 1], 2);       // placed first, on sheet 2
  s = place(s, [0, 0], [1, 1], 1);
  s = place(s, [0, 0], [1, 1], 2);
  s = place(s, [0, 0], [1, 1], 1);
  s = B.setNext(B.update(s, s.items[0].id, { n: 40 }), 77);
  const r = B.renumber(s);
  assert.deepEqual(r.items.map((it) => [it.sheet, it.n]), [[2, 3], [1, 1], [2, 4], [1, 2]], 'sheet 1 first, each in the order it was placed');
  assert.equal(r.next, 5);
  assert.deepEqual(B.rows(r).map((it) => it.n), [1, 2, 3, 4]);
  assert.deepEqual(B.rows(r, 2).map((it) => it.n), [3, 4]);
});

test('update changes one balloon; a missing id changes nothing', () => {
  const s = place(B.EMPTY, [1, 1], [5, 5]);
  const u = B.update(s, 1, { dim: 'Ø25', tp: '+0.05' });
  assert.equal(u.items[0].dim, 'Ø25'); assert.equal(s.items[0].dim, '');
  assert.equal(B.update(s, 9, { dim: 'x' }), s);
});

test('the leader runs from the circle\'s edge to the tip; a tip inside the circle has none', () => {
  const g = B.geometry({ c: [0, 0], tip: [10, 0] }, 3.5);
  assert.deepEqual(g.line, [3.5, 0, 10, 0]);
  assert.deepEqual(g.arrow[0], [10, 0]); assert.ok(g.arrow[1][0] < 10 && g.arrow[2][0] < 10);
  assert.deepEqual(B.geometry({ c: [0, 0], tip: [1, 0] }, 3.5), { line: null, arrow: null });
});

test('hit tests: the grips (tip first), the circle and the leader', () => {
  const it = { c: [0, 0], tip: [20, 0] };
  assert.equal(B.gripAt(it, [20.5, 0.5], 1), 'tip'); assert.equal(B.gripAt(it, [0.2, 0], 1), 'c'); assert.equal(B.gripAt(it, [10, 0], 1), null);
  assert.equal(B.gripAt({ c: [0, 0], tip: [0.5, 0] }, [0.2, 0], 1), 'tip');
  assert.ok(B.bodyAt(it, [2, 2], 3.5, 0.5)); assert.ok(B.bodyAt(it, [12, 0.4], 3.5, 0.5));
  assert.ok(!B.bodyAt(it, [12, 3], 3.5, 0.5)); assert.ok(!B.bodyAt(it, [25, 0], 3.5, 0.5));
});

test('the sidecar name: the file\'s name without its extension, next to it', () => {
  assert.equal(B.sidecarName('scan-0142.pdf'), 'scan-0142.pdballoons.json');
  assert.equal(B.sidecarPath('C:\\jobs\\v2.1\\a.b.PDF'), 'C:\\jobs\\v2.1\\a.b.pdballoons.json');
  assert.equal(B.sidecarPath('/x/dir.v2/noext'), '/x/dir.v2/noext.pdballoons.json');
  assert.ok(B.isSidecar('A.PDBALLOONS.JSON') && !B.isSidecar('a.json'));
});

test('encode then decode gives the same balloons; the count and the cells come back', () => {
  let s = place(B.EMPTY, [1.5, 2.5], [10, 20], 2);
  s = B.update(place(s, [3, 4], [5, 6]), 2, { dim: 'Ø15 H7', tp: '+0.018', tm: '0', note: 'Pin "hole", 2x' });
  s = B.setNext(s, 9);
  const r = B.decode(B.encode(s, { source: 'scan-0142.pdf', pages: 3 }));
  assert.equal(r.dropped, 0);
  assert.deepEqual(r.set, s);
  assert.equal(JSON.parse(B.encode(s, { source: 's.pdf' })).source, 's.pdf');
});

test('decode: not JSON, the wrong kind, bad items dropped, long text cut, numbers made up when missing', () => {
  assert.match(B.decode('{nope').error, /not JSON/);
  assert.match(B.decode('{"kind":"other","v":1,"items":[]}').error, /not a Project D balloons file/);
  assert.match(B.decode('[]').error, /not a Project D/);
  assert.match(B.decode('{"kind":"project-d-balloons","v":2,"items":[]}').error, /not a Project D/);
  const ok = { n: 3, sheet: 1, tip: [1, 2], c: [3, 4], dim: 'x'.repeat(500), tp: 5, note: '<b>' };
  const text = JSON.stringify({ kind: B.KIND, v: 1, items: [ok, { ...ok, n: 1.5 }, { ...ok, sheet: 0 }, { ...ok, tip: [1] }, { ...ok, c: [1, 'a'] }, null, { ...ok, tip: [1, null] }, 7] });
  const r = B.decode(text);
  assert.equal(r.dropped, 7); assert.equal(r.set.items.length, 1);
  assert.equal(r.set.items[0].dim.length, 200); assert.equal(r.set.items[0].tp, ''); assert.equal(r.set.items[0].note, '<b>');
  assert.equal(r.set.next, 4, 'no next in the file: after the highest');
  assert.equal(B.decode(JSON.stringify({ kind: B.KIND, v: 1, next: -2, items: [] })).set.next, 1);
});

test('CSV: a header, quotes doubled, commas and line breaks quoted, = and @ made harmless, an optional BOM', () => {
  const s = B.update(place(B.EMPTY, [0, 0], [5, 5], 3), 1, { dim: 'Ø25', tp: '+0.05', tm: '0', note: 'say "hi", ok\nnext' });
  const t = B.csv(B.rows(s));
  assert.equal(t, 'No.,Dimension,Tol +,Tol -,Sheet,Note\r\n1,Ø25,+0.05,0,3,"say ""hi"", ok\nnext"\r\n');
  assert.ok(B.csv([{ n: 2, dim: '=1+1', tp: '@x', tm: '-0.1', sheet: 1, note: '' }]).includes("2,'=1+1,'@x,-0.1,1,"));
  assert.equal(B.csv([], { bom: true }), '\ufeffNo.,Dimension,Tol +,Tol -,Sheet,Note\r\n');
  assert.equal(B.csv([]).charCodeAt(0), 78);
});

test('nearestText: the text under (or right next to) the point, the nearest of two, turned text, nothing far away', () => {
  const t1 = { x: 0, y: 0, h: 3.5, lines: ['120.0 ±0.1'], angle: 0, ha: 0 }, t2 = { x: 0, y: 20, h: 3.5, lines: ['Ø25'], angle: 0, ha: 0 };
  assert.equal(B.nearestText([t1, t2], [10, 1], 2).str, '120.0 ±0.1');
  assert.equal(B.nearestText([t1, t2], [3, 21], 2).str, 'Ø25');
  assert.equal(B.nearestText([t1, t2], [10, 10], 2), null, 'between them');
  assert.equal(B.nearestText([t1, t2], [1, 5.5], 2).str, '120.0 ±0.1', 'a little above counts');
  const up = { x: 0, y: 0, h: 3.5, lines: ['60'], angle: 90, ha: 0 };           // runs upwards
  assert.equal(B.nearestText([up], [-1, 3], 1).str, '60'); assert.equal(B.nearestText([up], [4, 3], 1), null);
  const mid = { x: 50, y: 0, h: 3.5, lines: ['ABCDEFGH'], angle: 0, ha: 1 };      // centred on x
  assert.equal(B.nearestText([mid], [45, 1], 0.5).str, 'ABCDEFGH'); assert.equal(B.nearestText([mid], [64, 1], 0.5), null);
  const two = { x: 0, y: 0, h: 3, lines: ['a', 'b'], angle: 0, ha: 0 };
  assert.equal(B.nearestText([two], [0.5, -4], 0.5).str, 'a b', 'the second line hangs below');
  assert.equal(B.nearestText([], [0, 0], 5), null);
});
