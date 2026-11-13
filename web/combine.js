// Combine (Ctrl+L), like CorelDRAW's: the picked outlines become ONE object, an INSERT of a new block "Combined <n>" that holds them
// unchanged (TODO 218a, DECISIONS "Combine"). The INSERT takes the last pick's colour, width, linetype and layer; the members are on layer 0 /
// ByBlock so it shows. A fill is one even-odd HATCH inside the block over every closed member. Pure: no DOM; combine.test.mjs.
import { ownBlock } from './drawing.js';
import { insert } from './dxf-write.js';
import { explodeInsert } from './explode.js';
import { usedBlocks, freeNameWithPrefix } from './edit.js';
import { closedOutline, fillHatch, hatchKey } from './fill.js';
import { typeName } from './props.js';

export const OUTLINES = new Set(['LINE', 'ARC', 'CIRCLE', 'ELLIPSE', 'LWPOLYLINE', 'POLYLINE', 'SPLINE']);
const PREFIX = 'Combined ';
export const blockNameOf = (e) => e.r.v[e.r.c.indexOf(2)]?.trim();

/** Is this block a Combined object's: named "Combined …", only outlines and at most one HATCH (its fill)? Anything else stays an ordinary block. */
export const isCombined = (name, block) => !!block && !block.xref && name?.startsWith(PREFIX) && block.entities.length > 0
  && block.entities.every((x) => OUTLINES.has(x.type) || x.type === 'HATCH') && block.entities.filter((x) => x.type === 'HATCH').length <= 1;

/** "Combined (k outlines)" for the Properties chip, or null when `ent` is not a Combined object. */
export function combinedLabel(blocks, ent) {
  if (ent.type !== 'INSERT') return null;
  const name = blockNameOf(ent), b = ownBlock(blocks, name);
  if (!isCombined(name, b) || ent.kids?.length) return null;
  const k = b.entities.filter((x) => x.type !== 'HATCH').length;
  return `Combined (${k} outline${k === 1 ? '' : 's'})`;
}

/** The block's outlines and its HATCH (null when it has none): what Combine and Break Apart work on. */
export const partsOf = (block) => ({ hatch: block.entities.find((x) => x.type === 'HATCH') || null, outlines: block.entities.filter((x) => x.type !== 'HATCH') });

/** Per-object fill; null for a non-Combined or open-only object. Layouts let objectReplace copy the part instead. */
export function fillCombined(raw, e, key, copy = true) {
  if (e.type !== 'INSERT' || e.kids?.length) return null;
  const name = blockNameOf(e), block = ownBlock(raw.blocks, name);
  if (!isCombined(name, block)) return null;
  const { hatch, outlines } = partsOf(block), closed = outlines.filter(closedOutline);
  if (!closed.length) return null;
  if ((hatch ? hatchKey(hatch) : null) === key) return { entity: e, blocks: raw.blocks };
  const made = key ? fillHatch({ ...closed[0], fill: key, layer: '0' }, closed.slice(1)) : null;
  const filled = made && (hatch ? { ...hatch, aci: made.aci, tc: made.tc } : made);
  const uses = (x) => x !== e && x.type === 'INSERT' && blockNameOf(x) === name;
  const shared = copy && (raw.entities.some(uses) || Object.values(raw.blocks).some((b) => b.entities.some(uses)));
  const nextName = shared ? freeNameWithPrefix(raw.blocks, PREFIX) : name;
  const entity = { ...e, r: { ...e.r, v: e.r.v.map((v, i) => e.r.c[i] === 2 ? nextName : v) } };
  return { entity, blocks: { ...raw.blocks, [nextName]: { ...block, entities: filled ? [filled, ...outlines] : outlines } } };
}

const reset = (e) => ({ ...e, layer: '0', aci: 0, tc: null, lw: -2, lt: 'BYBLOCK', fill: undefined });     // ByBlock in everything: the INSERT's look shows

/** → { entities, blocks, selected, name, count, filled, heir (the last pick) } or { error }. `selection`: entity indexes in pick order; the last one decides the look.
 * `reserved`: more block names (lower case) the new "Combined n" must not take (a layout's other parts' blocks). */
export function combine(raw, selection, locked = new Set(), reserved = new Set()) {
  const picked = [...selection];
  if (picked.length < 2) return { error: 'select at least 2 outlines first' };
  const ents = picked.map((i) => raw.entities[i]), last = ents.at(-1), flattened = new Set(), members = [];
  for (const e of ents) {
    const name = e.type === 'INSERT' ? blockNameOf(e) : null;
    if (!OUTLINES.has(e.type) && !(name && isCombined(name, ownBlock(raw.blocks, name)) && !e.kids?.length)) return { error: `a ${typeName(e).toLowerCase()} cannot be combined (outlines only)` };
    if (locked.has(e.layer)) return { error: `layer ${e.layer} is locked` };
    if (!!e.ps !== !!last.ps) return { error: 'the objects are in different spaces' };
  }
  let key = last.fill || null;
  if (key === 'byblock') key = 'bylayer';       // outside a block a ByBlock fill shows in the layer's colour
  for (const i of [...picked].sort((a, b) => a - b)) {
    const e = raw.entities[i], name = e.type === 'INSERT' ? blockNameOf(e) : null;
    if (!name) { members.push(reset(e)); continue; }
    const { hatch, outlines } = partsOf(ownBlock(raw.blocks, name));
    if (e === last) key = hatch ? hatchKey(hatch) : null;
    try { members.push(...explodeInsert(e, { ...raw, blocks: { ...raw.blocks, [name]: { ...ownBlock(raw.blocks, name), entities: outlines } } }).entities.map(reset)); }
    catch (err) { return { error: err.message }; }       // the explode transform refuses (a tilted insert, a degenerate scale): so does Combine
    flattened.add(name);
  }
  const taken = new Set([...Object.keys(raw.blocks).map((n) => n.toLowerCase()), ...reserved]);
  let n = 1; while (taken.has((PREFIX + n).toLowerCase())) n++;
  const name = PREFIX + n, closed = members.filter(closedOutline);
  const hatch = key && closed.length ? fillHatch({ ...closed[0], fill: key, layer: '0' }, closed.slice(1)) : null;
  const made = insert(name, 0, 0, { layer: last.layer, aci: last.aci, tc: last.tc, lw: last.lw, lt: last.lt, lts: last.lts, ps: last.ps });
  const first = Math.min(...picked), entities = [];
  raw.entities.forEach((e, i) => { if (i === first) entities.push(made); if (!selection.has(i)) entities.push(e); });
  const blocks = { ...raw.blocks, [name]: { base: [0, 0], xref: false, entities: hatch ? [hatch, ...members] : members } };
  const used = usedBlocks(blocks, entities);
  for (const f of flattened) if (!used.has(f)) delete blocks[f];       // a Combined object nothing uses any more goes with it
  return { entities, blocks, selected: new Set([entities.indexOf(made)]), name, count: members.length, filled: !!hatch, heir: last };
}
