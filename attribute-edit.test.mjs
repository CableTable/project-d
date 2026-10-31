import test from 'node:test';
import assert from 'node:assert/strict';
import { entity, insert } from './web/dxf-write.js';
import { attributeRows, applyAttributeValues, definitionFields, applyDefinition, validTag } from './web/attribute-edit.js';

test('attribute rows keep record order, find prompts by tag, omit constants and nested inserts', () => {
  const def = (tag, flags = 0) => entity('ATTDEF', [[2, tag], [3, '<Prompt>'], [70, flags]]);
  const ent = insert('BLOCK', 0, 0);
  ent.kids = ['SECOND', 'first', 'constant', 'missing', 'flagged'].map((tag, i) => entity('ATTRIB', [[2, tag], [1, i ? '' : '{\\H2;Raw}\\Pnext'], [70, i === 4 ? 2 : 0]]).r);
  const blocks = { block: { entities: [def('FIRST'), def('SECOND'), def('CONSTANT', 2), insert('Nested', 0, 0)] }, Nested: { entities: [def('NESTED')] } };
  const rows = attributeRows(ent, blocks);
  assert.deepEqual(rows.map((r) => [r.index, r.tag, r.prompt, r.value]), [[0, 'SECOND', '<Prompt>', '{\\H2;Raw}\\Pnext'], [1, 'first', '<Prompt>', ''], [3, 'missing', '', '']]);
  assert.equal(applyAttributeValues(ent, rows), ent, 'unchanged is the same entity: no Undo');
  const next = applyAttributeValues(ent, rows.map((r) => ({ ...r, value: r.index === 0 ? '' : '<value>' })));
  assert.equal(attributeRows(next, blocks)[0].value, '', 'empty values allowed');
  assert.equal(attributeRows(ent, blocks)[0].value, '{\\H2;Raw}\\Pnext', 'source is immutable');
  assert.equal(next.kids[2], ent.kids[2], 'constant record untouched');
  assert.equal(next.r, ent.r, 'placement and styling untouched');
  assert.deepEqual(attributeRows(insert('BLOCK', 0, 0), blocks), []);
});

test('definition edits validate and uppercase tags; missing fields, no-op and unrelated pairs survive', () => {
  const ent = entity('ATTDEF', [[2, 'TAG'], [10, 42], [70, 1]]);
  const before = structuredClone(ent);
  assert.deepEqual(definitionFields(ent), { tag: 'TAG', prompt: '', value: '' });
  assert.equal(applyDefinition(ent, definitionFields(ent)), ent);
  for (const tag of ['', 'two words', 'a\tb', 'a\nb']) {
    assert.equal(validTag(tag), false);
    assert.throws(() => applyDefinition(ent, { tag, prompt: '', value: '' }), /Tag is required/);
  }
  const next = applyDefinition(ent, { tag: 'new_tag', prompt: '<Prompt>', value: '' });
  assert.deepEqual(definitionFields(next), { tag: 'NEW_TAG', prompt: '<Prompt>', value: '' });
  assert.equal(next.r.v[next.r.c.indexOf(10)], '42');
  assert.equal(next.r.v[next.r.c.indexOf(70)], '1');
  assert.deepEqual(ent, before);
  assert.equal(applyDefinition(next, definitionFields(next)), next);
});
