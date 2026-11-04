import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readDxf } from './web/drawing.js';
import * as W from './web/dxf-write.js';
import { group, ungroup, groupOf, prune, remap, copy, follow } from './web/groups.js';

const fixture = readFileSync('fixtures/groups.dxf', 'utf8').replace(/\r\n/g, '\n');
const members = (groups) => groups.map((g) => g.members.slice().sort((a, b) => a - b));
const make = (...indexes) => group([], indexes)[0];
const pairs = (...ps) => ps.map(([c, v]) => c + '\n' + v).join('\n') + '\n';
const addObjects = (text, extra) => text.replace('0\nENDSEC\n0\nEOF', extra + '0\nENDSEC\n0\nEOF');
const record = (h, refs) => pairs([0, 'GROUP'], [5, h], [330, 'D'], [100, 'AcDbGroup'], [300, 'Nested'], [70, 1], [71, 1], ...refs.map((h) => [340, h]));

// Inspect raw output independently of readDxf so regenerated pointers cannot mask writer errors.
function records(text) {
  const lines = text.split(/\r?\n/), result = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = +lines[i], value = lines[i + 1].trim();
    if (code === 0) result.push({ type: value, pairs: [] });
    else result.at(-1)?.pairs.push([code, value]);
  }
  return result;
}
const values = (r, c) => r.pairs.filter(([code]) => code === c).map(([, v]) => v);
const first = (r, c) => values(r, c)[0];

test('TODO 97a: hand-written AutoCAD-style GROUP reads names, flags and entity indexes; round trip keeps members', () => {
  const doc = readDxf(fixture);
  assert.deepEqual(doc.groups, [{ members: [0, 1], name: 'Parallel lines', description: 'Two parallel lines', unnamed: false, selectable: true }]);
  assert.equal(doc.entities[doc.groups[0].members[1]].type, 'LINE');
  const before = structuredClone(doc), back = readDxf(W.writeDxf(doc));
  assert.deepEqual(members(back.groups), [[0, 1]]);
  assert.equal(back.groups[0].name, 'Parallel lines');
  assert.equal(back.groups[0].unnamed, false);
  assert.equal(back.groups[0].description, 'Two parallel lines');
  assert.deepEqual(doc, before, 'save leaves the source alone');
  const disabled = readDxf(fixture.replace('71\n1\n340', '71\n0\n340'));
  assert.equal(disabled.groups[0].selectable, false);
  assert.equal(readDxf(W.writeDxf(disabled)).groups[0].selectable, false);
  const sections = fixture.match(/0\nSECTION\n2\n[\s\S]*?0\nENDSEC\n/g);
  assert.deepEqual(members(readDxf(sections.reverse().join('') + '0\nEOF\n').groups), [[0, 1]], 'section order is irrelevant');
});

test('TODO 97a: nested GROUP handles flatten, including shared members and cycles', () => {
  for (const namedInner of [false, true]) {
    let text = fixture.replace('340\n11\n0\nENDSEC', '340\nF\n0\nENDSEC');
    if (namedInner) text = text.replace('3\nParallel lines', '3\nInner\n350\nF\n3\nParallel lines');
    text = addObjects(text, record('F', ['11', '12', 'E', '11']));
    const doc = readDxf(text);
    assert.deepEqual(members(doc.groups), [[0, 1, 2]]);
    assert.deepEqual(members(readDxf(W.writeDxf(doc)).groups), [[0, 1, 2]]);
  }
});

test('TODO 97a: unresolved and duplicate handles drop; short groups dissolve; only ACAD_GROUP entries count', () => {
  const extra = record('F', ['10', '12']);
  const text = addObjects(fixture.replace('340\n11\n', '340\n11\n340\n10\n340\nBAD\n'), extra);
  assert.deepEqual(members(readDxf(text).groups), [[0, 1]], 'unlisted GROUP is ignored');
  assert.deepEqual(readDxf(fixture.replace('340\n11\n', '340\nBAD\n')).groups, []);
  assert.deepEqual(readDxf(fixture.replace('340\n11\n', '340\n10\n')).groups, []);
  assert.deepEqual(readDxf(fixture.replace('ACAD_GROUP', 'OTHER')).groups, []);
  assert.deepEqual(readDxf(fixture.replace('350\nE\n', '350\nBAD\n')).groups, []);
  assert.deepEqual(members(readDxf(fixture.replace('350\nE\n', '350\ne\n')).groups), [[0, 1]], 'handles ignore case');
  assert.deepEqual(W.newDoc().groups, []);
});

test('TODO 97a: writer assigns unnamed groups, unique handles, owners, members and persistent reactors', () => {
  const doc = readDxf(fixture);
  doc.entities.push(W.line(40, 0, 50, 0));
  doc.groups.push(make(2, 3));
  const text = W.writeDxf(doc), recs = records(text), gs = recs.filter((r) => r.type === 'GROUP');
  const root = recs.find((r) => r.type === 'DICTIONARY' && values(r, 3).includes('ACAD_GROUP'));
  const dict = recs.find((r) => r.type === 'DICTIONARY' && first(r, 5) === first(root, 350));
  assert.deepEqual(values(dict, 3), ['Parallel lines', '*A1']);
  assert.deepEqual(values(dict, 350), gs.map((r) => first(r, 5)));
  assert.equal(values(dict, 330).at(-1), first(root, 5));
  const allHandles = recs.filter((r) => r.type !== 'SECTION').flatMap((r) => [...values(r, 5), ...values(r, 105)]);
  assert.equal(new Set(allHandles).size, allHandles.length);
  assert.ok(allHandles.every((h) => /^[0-9A-F]+$/.test(h)));
  for (const r of recs) for (const h of values(r, 330)) assert.ok(h === '0' || allHandles.includes(h), 'owner / reactor resolves');
  const entities = recs.filter((r) => ['LINE', 'CIRCLE'].includes(r.type));
  gs.forEach((g, i) => {
    assert.equal(first(g, 70), i ? '1' : '0'); assert.equal(first(g, 71), '1');
    assert.deepEqual(values(g, 330), [first(dict, 5), first(dict, 5)]);
    assert.deepEqual(values(g, 340), entities.slice(i * 2, i * 2 + 2).map((r) => first(r, 5)));
    for (const e of entities.slice(i * 2, i * 2 + 2)) {
      assert.deepEqual(values(e, 102), ['{ACAD_REACTORS', '}']);
      assert.equal(first(e, 330), first(g, 5));
    }
  });
  assert.deepEqual(members(readDxf(text).groups), [[0, 1], [2, 3]]);
});

test('TODO 97a: saving filters unsupported members and remaps inserted fill hatches', () => {
  const doc = W.newDoc();
  doc.entities = [W.entity('IMAGE', []), W.rect(0, 0, 10, 10, { fill: 'aci:1' }), W.line(20, 0, 30, 0), W.circle(40, 0, 2)];
  doc.groups = [make(0, 1, 2)];
  const report = W.writeDxfWithReport(doc), recs = records(report.text);
  assert.deepEqual(report.skipped, [{ type: 'IMAGE', count: 1 }]);
  const handles = values(recs.find((r) => r.type === 'GROUP'), 340);
  assert.deepEqual(recs.filter((r) => handles.includes(first(r, 5))).map((r) => r.type), ['HATCH', 'LWPOLYLINE', 'LINE']);
  const back = readDxf(report.text);
  assert.deepEqual(back.entities.map((e) => e.type), ['LWPOLYLINE', 'LINE', 'CIRCLE']);
  assert.deepEqual(members(back.groups), [[0, 1]]);
  assert.equal(back.entities[0].fill, 'aci:1');
  doc.groups = [make(0, 2)];
  assert.deepEqual(readDxf(W.writeDxf(doc)).groups, [], 'one writable member dissolves');
  doc.groups = [];
  const empty = records(W.writeDxf(doc));
  assert.ok(!empty.some((r) => r.type === 'GROUP'));
  const root = empty.find((r) => r.type === 'DICTIONARY' && values(r, 3).includes('ACAD_GROUP'));
  const dict = empty.find((r) => r.type === 'DICTIONARY' && first(r, 5) === first(root, 350));
  assert.equal(first(dict, 281), '1'); assert.deepEqual(values(dict, 3), []);
});

test('TODO 97a: group handles name top-level INSERT / POLYLINE entities, not block contents or children', () => {
  const doc = W.newDoc();
  W.addBlock(doc, 'Pair', [W.line(0, 0, 1, 0), W.line(0, 1, 1, 1)]);
  const poly = W.entity('POLYLINE', [[70, 0]]);
  poly.kids = [W.entity('VERTEX', [[10, 0], [20, 0]]).r, W.entity('VERTEX', [[10, 10], [20, 10]]).r];
  doc.entities = [W.insert('Pair', 0, 0), poly, W.circle(20, 20, 2, { ps: true })];
  doc.groups = [make(0, 1, 2)];
  const text = W.writeDxf(doc), recs = records(text);
  const handles = values(recs.find((r) => r.type === 'GROUP'), 340);
  assert.deepEqual(recs.filter((r) => handles.includes(first(r, 5))).map((r) => r.type), ['INSERT', 'POLYLINE', 'CIRCLE']);
  const back = readDxf(text);
  assert.deepEqual(members(back.groups), [[0, 1, 2]]);
  assert.equal(back.entities[1].kids.length, 2);
  assert.equal(back.entities[2].ps, true);
});

test('TODO 97a: group selection merges touched groups flat; ungroup and lookup leave entities alone', () => {
  const groups = [make(0, 1), make(2, 3), make(5, 6)], before = structuredClone(groups);
  const merged = group(groups, new Set([0, 2, 4]));
  assert.deepEqual(members(merged), [[5, 6], [0, 1, 2, 3, 4]]);
  assert.equal(groupOf(merged, 1), merged[1]); assert.equal(groupOf(merged, 9), null);
  assert.deepEqual(members(ungroup(merged, [3])), [[5, 6]]);
  assert.deepEqual(members(ungroup(merged, [])), members(merged));
  assert.deepEqual(group([], [1, 1]), []); assert.deepEqual(group([], []), []);
  assert.deepEqual(members(group([make(1, 2), make(0, 1)], [0])), [[0, 1, 2]], 'transitive overlap flattens');
  assert.deepEqual(groups, before);
});

test('TODO 97a: prune erases missing members and dissolves singletons without mutation', () => {
  const groups = [make(0, 1, 2), make(3, 4)], before = structuredClone(groups);
  assert.deepEqual(members(prune(groups, new Set([0, 2, 3]))), [[0, 2]]);
  assert.deepEqual(prune(groups, new Set()), []);
  assert.deepEqual(groups, before);
});

test('TODO 97a: erase / explode remaps indexes; copy creates independent groups', () => {
  const groups = [make(0, 2), make(3, 4)], before = structuredClone(groups);
  assert.deepEqual(members(remap(groups, new Map([[0, [0]], [2, [1]], [3, [2]]]))), [[0, 1]], 'erase shifts indexes and dissolves');
  const exploded = remap(groups, new Map([[0, [0]], [2, [1, 2]], [3, [3]], [4, [4]]]));
  assert.deepEqual(members(exploded), [[0, 1, 2], [3, 4]], 'all exploded block pieces stay in the group');
  const copied = copy(groups, new Map([[0, [5]], [2, [6]]]));
  assert.deepEqual(members(copied), [[0, 2], [3, 4], [5, 6]]);
  copied[2].members.push(7);
  assert.deepEqual(groups, before);
  assert.deepEqual(members(copy(groups, new Map([[0, [5]]]))), members(groups), 'a partial copy with one member dissolves');
});

test('TODO 97a fix: groups follow the entity list through erase, Move, copy; saved members are the right objects', () => {
  const doc = readDxf(fixture);
  doc.entities.push(W.line(40, 0, 50, 0), W.line(60, 0, 70, 0));
  doc.groups.push(make(3, 4));                               // entities: LINE LINE CIRCLE LINE LINE; groups [0, 1] and [3, 4]
  const saved = structuredClone(doc.groups), erased = doc.entities.slice(1);       // what Ed.removeEntities leaves of an erase of entity 0
  assert.deepEqual(members(follow(doc.groups, doc.entities, erased)), [[2, 3]], 'the pair that lost a member dissolves, the other shifts');
  const back = readDxf(W.writeDxf({ ...doc, entities: erased, groups: follow(doc.groups, doc.entities, erased) }));
  assert.deepEqual(members(back.groups), [[2, 3]]);
  assert.deepEqual(back.groups[0].members.map((i) => back.entities[i].type), ['LINE', 'LINE']);
  assert.deepEqual(back.entities.map((e) => e.type), ['LINE', 'CIRCLE', 'LINE', 'LINE']);
  const moved = doc.entities.map((e, i) => (i === 1 ? { ...e } : e));
  assert.equal(follow(doc.groups, doc.entities, moved), doc.groups, 'Move keeps the count: indexes stay');
  assert.deepEqual(members(follow(doc.groups, doc.entities, [...doc.entities, W.line(0, 0, 1, 1)])), [[0, 1], [3, 4]], 'a copy appends: members stay');
  assert.deepEqual(doc.groups, saved, 'follow leaves its input alone; Undo hands the snapshot back');
  assert.equal(follow([], doc.entities, erased).length, 0);
});

test('TODO 97a fix: a named group keeps its name and unnamed flag; new and copied groups take free *A names', () => {
  const doc = readDxf(fixture);
  for (let i = 1; i <= 6; i++) doc.entities.push(W.line(40 * i, 0, 40 * i + 10, 0));
  const [named] = doc.groups, copied = copy(doc.groups, new Map([[0, [3]], [1, [4]]]))[1];
  doc.groups = [named, copied, { ...make(5, 6), name: '*A1', unnamed: true }, make(7, 8)];
  const back = readDxf(W.writeDxf(doc));
  assert.deepEqual(back.groups.map((g) => g.name), ['Parallel lines', '*A2', '*A1', '*A3'], 'the copy of a named group is unnamed; new names skip the used *A1');
  assert.deepEqual(back.groups.map((g) => g.unnamed), [false, true, true, true]);});
