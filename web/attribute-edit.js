// Attribute editor data and immutable record edits (attribute-edit.test.mjs).
const field = (r, code) => String(r.v[r.c.indexOf(code)] ?? '');
function fields(r, edits) {
  let next = r;
  for (const [code, value] of edits) {
    if (field(next, code) === value) continue;
    if (next === r) next = { ...r, c: r.c.slice(), v: r.v.slice() };
    const k = next.c.indexOf(code);
    if (k < 0) { next.c.push(code); next.v.push(value); } else next.v[k] = value;
  }
  return next;
}
export const blockName = (ent) => field(ent.r, 2);
/** Only the picked insert's own nonconstant ATTRIBs, in record order. */
export function attributeRows(ent, blocks) {
  if (ent?.type !== 'INSERT') return [];
  const block = Object.entries(blocks).find(([name]) => name.toUpperCase() === blockName(ent).toUpperCase())?.[1];
  const defs = block?.entities.filter((e) => e.type === 'ATTDEF') || [];
  return (ent.kids || []).flatMap((r, index) => {
    if (r.type !== 'ATTRIB') return [];
    const tag = field(r, 2), def = defs.find((e) => field(e.r, 2).toUpperCase() === tag.toUpperCase());
    if ((+field(r, 70) | +(def && field(def.r, 70))) & 2) return [];
    return [{ index, tag, prompt: def ? field(def.r, 3) : '', value: field(r, 1) }];
  });
}
export function applyAttributeValues(ent, rows) {
  const edits = new Map(rows.map((row) => [row.index, row.value]));
  const kids = ent.kids.map((r, i) => r.type === 'ATTRIB' && edits.has(i) ? fields(r, [[1, edits.get(i)]]) : r);
  return kids.every((r, i) => r === ent.kids[i]) ? ent : { ...ent, kids };
}
export const definitionFields = (ent) => ({ tag: field(ent.r, 2), prompt: field(ent.r, 3), value: field(ent.r, 1) });
export const validTag = (tag) => !!tag && !/\s/.test(tag);
export function applyDefinition(ent, draft) {
  if (!validTag(draft.tag)) throw new Error('Tag is required and cannot contain spaces.');
  const r = fields(ent.r, [[2, draft.tag.toUpperCase()], [3, draft.prompt], [1, draft.value]]);
  return r === ent.r ? ent : { ...ent, r };
}
