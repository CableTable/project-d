// Break Apart preserves outlines; only the enclosing block is removed.
import { ownBlock } from './drawing.js';
import { explodeInsert } from './explode.js';
import { isCombined, partsOf, OUTLINES } from './combine.js';
import { closedOutline, hatchKey } from './fill.js';

export function breakApart(raw, selection, locked = new Set()) {
  if (selection.size !== 1) return { error: 'select one group or block of outlines first' };
  const i = [...selection][0], e = raw.entities[i];
  if (e.type !== 'INSERT') return { error: `${e.type} is already a separate outline or is not a group or block` };
  if (locked.has(e.layer)) return { error: 'the block is on a locked layer' };
  const name = e.r.v[e.r.c.indexOf(2)]?.trim(), block = ownBlock(raw.blocks, name);
  if (!block || block.xref) return { error: 'missing block or external reference' };
  const combined = isCombined(name, block), { hatch, outlines } = combined ? partsOf(block) : { hatch: null, outlines: block.entities };
  if (e.kids?.length || !block.entities.length || outlines.some((x) => !OUTLINES.has(x.type))) {
    return { error: 'the block must contain only outlines (no text, fills or nested blocks)' };
  }
  try {
    const r = explodeInsert(e, hatch ? { ...raw, blocks: { ...raw.blocks, [name]: { ...block, entities: outlines } } } : raw);
    if (r.entities.some((x) => locked.has(x.layer))) return { error: 'an outline is on a locked layer' };
    if (!r.entities.length) return { error: 'the block has no outlines to separate' };
    let entities = r.entities, blocks = r.blocks;
    if (hatch) {       // the Combined fill goes; each closed member is filled the normal way (148e: nested ones become holes). ByBlock fill = the INSERT's colour
      const own = hatchKey(hatch), key = own !== 'byblock' ? own : e.tc != null ? 'tc:' + e.tc : e.aci >= 1 && e.aci <= 255 ? 'aci:' + e.aci : 'bylayer';
      entities = entities.map((x) => (closedOutline(x) ? { ...x, fill: key } : x));
      blocks = { ...blocks, [name]: block };       // other copies of the Combined block keep their fill
    }
    return { entities: [...raw.entities.slice(0, i), ...entities, ...raw.entities.slice(i + 1)],
      blocks, selected: new Set(entities.map((_, k) => i + k)) };
  } catch (err) { return { error: err.message }; }
}
