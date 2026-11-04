import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { readDxf, flatten, DrawingError } from './web/drawing.js';
import { layerCounts, entityCount, drawingBoxMm } from './web/doc.js';
import * as W from './web/dxf-write.js';
import { filletEntities } from './web/fillet.js';
import { trimEntity, mirrorEntity } from './web/modify.js';
import { moveEntities, copyEntities, removeEntities, createHistory } from './web/edit.js';
import { group, ungroup, groupOf, prune, remap, copy, follow } from './web/groups.js';
import * as G from './web/groups.js';
import { explodeSelection } from './web/explode.js';
import { outlineEntities } from './web/textoutline.js';
import * as SH from './web/shaping.js';
import * as GR from './web/grips.js';
import * as TX from './web/text.js';
import opentype from './web/vendor/opentype/opentype.js';
const { swap } = G, { shape, goneEntities, ringsOf } = SH;       // namespace imports: on the base a missing export fails its test, not the whole file

const fixture = readFileSync('fixtures/groups.dxf', 'utf8').replace(/\r\n/g, '\n');
const members = (groups) => groups.map((g) => g.members.slice().sort((a, b) => a - b));
const make = (...indexes) => group([], indexes)[0];
const pairs = (...ps) => ps.map(([c, v]) => c + '\n' + v).join('\n') + '\n';
const addObjects = (text, extra) => text.replace('0\nENDSEC\n0\nEOF', extra + '0\nENDSEC\n0\nEOF');
const record = (h, refs) => pairs([0, 'GROUP'], [5, h], [330, 'D'], [100, 'AcDbGroup'], [300, 'Nested'], [70, 1], [71, 1], ...refs.map((h) => [340, h]));
const appSource = readFileSync('web/app.js', 'utf8').split(/\r?\n/).join('\n');
const appFunction = (name) => {
  const start = appSource.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' exists');
  return appSource.slice(start, appSource.indexOf('\n}', start) + 2);
};

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

test('TODO 97a fix 2: fillet replacements keep their group through Save; the new arc stays separate', () => {
  const a = W.line(0, 0, 10, 0), b = W.line(10, 0, 10, 10), c = W.circle(30, 30, 2);
  const doc = { ...W.newDoc(), entities: [a, b, c], groups: [make(0, 1, 2)] };
  const { ents: [a2, b2, arc] } = filletEntities(a, [5, 0], b, [10, 5], 2);
  for (const [before, after] of [
    [[a, b, c], [a2, b2, c, arc]],
    [[c, a, b], [c, a2, b2, arc]],
    [[a, c, b], [a2, c, b2, arc]],
  ]) {
    const groups = follow(doc.groups, before, after);
    assert.deepEqual(members(groups), [[0, 1, 2]]);
    const back = readDxf(W.writeDxf({ ...doc, entities: after, groups }));
    assert.deepEqual(members(back.groups), [[0, 1, 2]]);
    assert.equal(back.entities[3].type, 'ARC');
  }
});

test('TODO 97a fix 2: trim-split and break pieces inherit the source group at the start, middle or end', () => {
  const a = W.line(0, 0, 30, 0), b = W.circle(40, 40, 2), c = W.circle(50, 50, 2);
  const cut = trimEntity(a, [W.line(10, -5, 10, 5), W.line(20, -5, 20, 5)], [15, 0], false);
  assert.equal(cut.ents.length, 2);
  for (const pieces of [cut.ents, [W.line(0, 0, 10, 0), W.line(20, 0, 30, 0)]]) {
    for (const [before, after] of [
      [[a, b, c], [...pieces, b, c]],
      [[b, a, c], [b, ...pieces, c]],
      [[b, c, a], [b, c, ...pieces]],
      [[a, b, c], [b, c, ...pieces]],
    ]) {
      const groups = [make(0, 1, 2)], saved = structuredClone(groups);
      const next = follow(groups, before, after);
      assert.deepEqual(members(next), [[0, 1, 2, 3]]);
      assert.deepEqual(members(readDxf(W.writeDxf({ ...W.newDoc(), entities: after, groups: next })).groups), [[0, 1, 2, 3]]);
      assert.deepEqual(groups, saved);
    }
  }
});

test('TODO 97a fix 2: erase, Move and copy still use the right members; relocated replacements and joins inherit', () => {
  const doc = { ...W.newDoc(), entities: [W.line(0, 0, 10, 0), W.line(10, 0, 20, 0), W.circle(30, 30, 2)], groups: [make(0, 1, 2)] };
  assert.deepEqual(members(follow(doc.groups, doc.entities, removeEntities(doc, new Set([0])).entities)), [[0, 1]]);
  assert.deepEqual(follow([make(0, 1)], doc.entities, removeEntities(doc, new Set([0])).entities), [], 'erase still dissolves a singleton');
  assert.equal(follow(doc.groups, doc.entities, moveEntities(doc, new Set([0, 1]), 2, 3).entities), doc.groups);
  const copied = copyEntities(doc, new Set([0, 1]), 2, 3).entities;
  assert.deepEqual(members(follow(doc.groups, doc.entities, copied)), [[0, 1, 2]], 'copies never join the source group');
  const [a, b, c] = doc.entities, a2 = W.line(0, 2, 10, 2);
  assert.deepEqual(members(follow([make(0, 2)], doc.entities, [b, c, a2])), [[1, 2]], 'offset with source erased appends its replacement');
  assert.deepEqual(members(follow(doc.groups, doc.entities, [W.line(0, 0, 20, 0), c])), [[0, 1]], 'a join maps both old members to the joined object');
  assert.deepEqual(members(follow([make(0, 1)], [a, b], [])), []);
});

test('TODO 97a fix 2: region Trim remaps adjacent sources with unequal splits and erasures', () => {
  for (const counts of [[2, 3, 0, 1], [2, 0, 1, 1]]) {
    const entities = counts.map((_, i) => W.line(i * 10, 0, i * 10 + 5, 0));
    const doc = { ...W.newDoc(), entities, groups: [make(0, 2), make(1, 3)] };
    const changed = counts.flatMap((count, i) => count === 1 ? [] : [{ i, ents: Array.from({ length: count }, (_, k) => W.line(i * 10, k, i * 10 + 5, k)) }]);
    const region = runInNewContext(appFunction('trimRegionDo') + '\ntrimRegionDo;', {
      state: { mod: { edges: [] } }, view: {}, remapGroups: remap, note() {},
      trimRegionResult: () => ({ idxs: [0, 1, 2, 3], ext: false, changed }),
      trimCommit: (d, next) => { Object.assign(d.raw, next); return true; },
    });
    assert.equal(region({ raw: doc }, null, 'Fence', false), true);
    assert.deepEqual(members(doc.groups), counts[1] ? [[0, 1], [2, 3, 4, 5]] : [[0, 1, 2]]);
    assert.deepEqual(members(readDxf(W.writeDxf(doc)).groups), members(doc.groups));
  }
});

test('TODO 97a fix 2: snapshotOf / restore carry edited and split groups through Undo and Redo', () => {
  const snapshotSource = appSource.match(/^const snapshotOf = .*;$/m)[0];
  const { snapshotOf, restore } = runInNewContext([
    snapshotSource, appFunction('restoreBg'), appFunction('restore'), '({ snapshotOf, restore });',
  ].join('\n'), {
    followGroups: follow, flatten, DrawingError, layerCounts, entityCount, drawingBoxMm,
    cmpDoc: () => false, showDoc() {}, warm() {}, update() {},
  });
  const a = W.line(0, 0, 10, 0), b = W.line(10, 0, 10, 10), c = W.circle(30, 30, 2);
  for (const after of [
    [...filletEntities(a, [5, 0], b, [10, 5], 2).ents.slice(0, 2), c, W.arc(8, 2, 2, 270, 0)],
    [W.line(0, 0, 3, 0), W.line(7, 0, 10, 0), b, c],
  ]) {
    const raw = { ...W.newDoc(), entities: [a, b, c], groups: [make(0, 1, 2)] };
    const d = { raw, fl: flatten(raw), off: new Set(), factor: 1 }, history = createHistory();
    const before = snapshotOf(d);
    history.push(before, 'Edit');
    restore(d, { entities: after, blocks: raw.blocks });
    const edited = snapshotOf(d), expected = members(d.raw.groups);
    assert.deepEqual(expected, after[1].type === 'LINE' && after[2] === b ? [[0, 1, 2, 3]] : [[0, 1, 2]]);
    restore(d, history.undo(edited));
    assert.equal(d.raw.groups, before.groups);
    assert.equal(d.raw.entities, before.entities);
    restore(d, history.redo(snapshotOf(d)));
    assert.equal(d.raw.groups, edited.groups);
    assert.equal(d.raw.entities, after);
    assert.deepEqual(members(readDxf(W.writeDxf(d.raw)).groups), expected);
  }
});

test('TODO 97a fix: a named group keeps its name and unnamed flag; new and copied groups take free *A names', () => {
  const doc = readDxf(fixture);
  for (let i = 1; i <= 6; i++) doc.entities.push(W.line(40 * i, 0, 40 * i + 10, 0));
  const [named] = doc.groups, copied = copy(doc.groups, new Map([[0, [3]], [1, [4]]]))[1];
  doc.groups = [named, copied, { ...make(5, 6), name: '*A1', unnamed: true }, make(7, 8)];
  const back = readDxf(W.writeDxf(doc));
  assert.deepEqual(back.groups.map((g) => g.name), ['Parallel lines', '*A2', '*A1', '*A3'], 'the copy of a named group is unnamed; new names skip the used *A1');
  assert.deepEqual(back.groups.map((g) => g.unnamed), [false, true, true, true]);
});

test('TODO 97a fix 3: a fillet of a grouped line with a circle adds no arc to the group', () => {
  const a = W.line(0, 0, 20, 0), c = W.circle(10, 6, 3), d = W.line(0, 30, 20, 30);
  const doc = { ...W.newDoc(), entities: [a, c, d], groups: [make(0, 2)] };
  const run = runInNewContext(appFunction('filletDo') + '\nfilletDo;', {
    state: { mod: { ent: a, p0: [3, 0], trim: true, stage: '' }, filR: 2 }, filletEntities, remapGroups: remap, GR, mmText: String,
    note() {}, paintOverlay() {}, ui: { cmdUI: { message() {} } },
    filletCommit: (dd, entities, groups) => { Object.assign(dd.raw, { entities, groups }); return true; },
  });
  run({ raw: doc, factor: 1 }, c, [8, 3.2], false);
  assert.deepEqual([...doc.entities.map((e) => e.type)], ['LINE', 'CIRCLE', 'LINE', 'ARC']);
  assert.deepEqual(members(doc.groups), [[0, 2]], 'a and d stay grouped; the arc (3) is outside');
});

test('TODO 97a fix 3: Explode of several members keeps each piece in its own source group', () => {
  const [p1, p2, c, c2] = [W.rect(0, 0, 5, 5), W.rect(20, 0, 5, 5), W.circle(50, 50, 2), W.circle(60, 60, 2)];
  const two = { ...W.newDoc(), entities: [p1, p2, c, c2], groups: [make(0, 2), make(1, 3)] };
  const r = explodeSelection(two, new Set([0, 1]));
  assert.equal(r.entities.length, 10);
  assert.deepEqual(members(remap(two.groups, r.indexes)), [[0, 1, 2, 3, 8], [4, 5, 6, 7, 9]]);
  const one = { ...W.newDoc(), entities: [p1, c, p2], groups: [make(0, 1, 2)] };
  const r1 = explodeSelection(one, new Set([0, 2]));
  assert.deepEqual(members(remap(one.groups, r1.indexes)), [[0, 1, 2, 3, 4, 5, 6, 7, 8]], 'non-adjacent members keep every piece');
});

test('TODO 97a fix 3: Text to outlines of several members maps each letter set to its text', () => {
  const buf = readFileSync('web/vendor/fonts/LiberationSans-Regular.ttf'), font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const model = (s, x) => ({ type: 'TEXT', x, y: 50, h: 10, lines: [s], angle: 0, ha: 0, font: 'Standard', styleName: 'Standard', bold: false });
  const doc = W.addEntities(W.newDoc(4), [TX.encode(model('A', 0)), TX.encode(model('B', 40)), W.circle(0, 0, 1), W.circle(5, 5, 1)]);
  const raw = readDxf(W.writeDxf(doc)), items = flatten(raw).items.filter((it) => it.k === 't');
  const r = outlineEntities(items, raw.entities, () => font, 0.01);
  assert.deepEqual([r.ents.length, r.from.get(0), r.from.get(1)], [5, [0, 1], [2, 3, 4]]);
  assert.deepEqual(members(swap([make(0, 2), make(1, 3)], 4, r.from)), [[0, 2, 3], [1, 4, 5, 6]]);
});

test('TODO 97a fix 3: Shaping gives a ring to the group of the outline it came from', () => {
  const sq = (x, ents) => ({ pts: [[x, 0], [x + 10, 0], [x + 10, 10], [x, 10]], ents: new Set(ents) });
  const loops = [sq(0, [0]), sq(5, [1])], res = shape('simplify', loops);       // the back square loses the front one's corner
  const gone = goneEntities(loops, [], res.operands.flatMap((o, i) => (res.untouched.includes(i) ? [] : o.loops)));
  assert.deepEqual([...gone], [0]);
  const rings = ringsOf('simplify', loops, res, gone);
  assert.deepEqual(members(swap([make(0, 2), make(1, 3)], 4, rings)), [[1, 3], [0, 2]], 'ring (3) joins the first group; the other keeps its shifted members');
  const weld = shape('weld', loops), all = goneEntities(loops, [], [0, 1]);
  assert.deepEqual(members(swap([make(0, 2), make(1, 3)], 4, ringsOf('weld', loops, weld, all))), [[0, 2], [1, 2]], 'a weld: every source member goes to the one ring');
});

test('TODO 97a fix 3: Mirror with erase puts each copy in its own source group, in click order', () => {
  const [l1, l2, c, c2] = [W.line(0, 0, 10, 0), W.line(0, 5, 10, 5), W.circle(50, 50, 2), W.circle(60, 60, 2)];
  const doc = { ...W.newDoc(), entities: [l1, l2, c, c2], groups: [make(0, 2), make(1, 3)] };
  const mirror = runInNewContext(appFunction('modAnswer') + '\nmodAnswer;', {
    state: { mod: { objs: [l2, l1], p1: [0, -10], p2: [10, -10] } }, MD: { mirrorEntity }, Ed: { removeEntities }, swapGroups: swap, view: {},
    setTool() {}, setSel() {}, note() {}, commit: (d, next) => { Object.assign(d.raw, next); return true; },
  });
  mirror({ raw: doc }, true);
  assert.equal(doc.entities.length, 4);
  assert.deepEqual([...doc.entities.slice(2).map((e) => e.type)], ['LINE', 'LINE']);
  assert.deepEqual(members(doc.groups), [[0, 3], [1, 2]], 'the copy of l1 (3) is in l1\'s group, the copy of l2 (2) in l2\'s');
});

test('TODO 97a fix 3: Offset Multiple with Erase source keeps the member as the last copy', () => {
  const [src, c, k1, k2] = [W.line(0, 0, 10, 0), W.circle(50, 50, 2), W.line(0, 2, 10, 2), W.line(0, 4, 10, 4)];
  const doc = { ...W.newDoc(), entities: [src, c, k1, k2], groups: [make(0, 1)] };
  const end = runInNewContext(appFunction('offsetEnd') + '\noffsetEnd;', {
    state: { mod: { offsetSource: 0, offsetSteps: [1] } }, modSync() {}, remapGroups: remap, setTool() {}, note() {},
    restore: (d, next) => Object.assign(d.raw, next),
  });
  end({ raw: doc });
  assert.deepEqual(doc.entities, [c, k1, k2]);
  assert.deepEqual(members(doc.groups), [[0, 2]], 'the group is the circle and the last copy');
});
