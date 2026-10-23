// Break Apart preserves outlines; only the enclosing block is removed.
import { explodeInsert } from './explode.js';

const OUTLINES = new Set(['LINE', 'ARC', 'CIRCLE', 'ELLIPSE', 'LWPOLYLINE', 'POLYLINE', 'SPLINE']);

export function breakApart(raw, selection, locked = new Set()) {
  if (selection.size !== 1) return { error: 'select one group or block of outlines first' };
  const i = [...selection][0], e = raw.entities[i];
  if (e.type !== 'INSERT') return { error: `${e.type} is already a separate outline or is not a group or block` };
  if (locked.has(e.layer)) return { error: 'the block is on a locked layer' };
  const block = raw.blocks[e.r.v[e.r.c.indexOf(2)]?.trim()];
  if (!block || block.xref) return { error: 'missing block or external reference' };
  if (e.kids?.length || !block.entities.length || block.entities.some((x) => !OUTLINES.has(x.type))) {
    return { error: 'the block must contain only outlines (no text, fills or nested blocks)' };
  }
  try {
    const r = explodeInsert(e, raw);
    if (r.entities.some((x) => locked.has(x.layer))) return { error: 'an outline is on a locked layer' };
    if (!r.entities.length) return { error: 'the block has no outlines to separate' };
    return { entities: [...raw.entities.slice(0, i), ...r.entities, ...raw.entities.slice(i + 1)],
      blocks: r.blocks, selected: new Set(r.entities.map((_, k) => i + k)) };
  } catch (err) { return { error: err.message }; }
}
