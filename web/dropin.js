// dropin.js — pure: a Parts library part dropped into a drawing (T50): its entities at a point, 1:1, loose, on their own layers. dropin.test.mjs.
import { moveEntities, scaleAbout } from './edit.js';
import { withLayer } from './props.js';

const low = (s) => String(s).toLowerCase();
const codeAt = (r, c) => r.c.indexOf(c);

/** A block name not taken (compared without case): name, name_2, name_3 … */
function freeBlock(name, taken) {
  let n = 2, nm = name;
  while (taken.has(low(nm))) nm = `${name}_${n++}`;
  return nm;
}
/** The entity with its INSERT pointing at another block name (its record is copied, not changed). */
function reinsert(e, names) {
  const k = e.type === 'INSERT' ? codeAt(e.r, 2) : -1, to = k >= 0 && names.get(e.r.v[k]);
  return to ? { ...e, r: { ...e.r, v: e.r.v.map((v, i) => (i === k ? to : v)) } } : e;
}

/**
 * The drawing with `part` dropped in. part: { raw, box (the part's lower-left is its reference point, drawing units), factor, space };
 * target: { raw, factor, names (every layer it has), hidden (layer names switched off), locked (layer names), cur (the current layer) };
 * at: [x, y] in the target's drawing units. A part entity on a layer the drawing has hidden or locked goes on `cur`; a layer the
 * drawing lacks is made from the part's. Returns { entities, blocks, layers, from, count, moved: { layer: n }, made: [new layer names] }
 * (the new entities are entities[from..from + count)); throws when an entity cannot be moved (a hatch, a dimension).
 */
export function dropPart(part, target, at) {
  const s = part.factor / target.factor;
  let { entities, blocks } = part.raw;
  if (Math.abs(s - 1) > 1e-9) ({ entities, blocks } = scaleAbout(part.raw, s, 0, 0, part.space || 0));
  const dx = at[0] - part.box[0] * s, dy = at[1] - part.box[1] * s;
  ({ entities, blocks } = moveEntities({ entities, blocks }, new Set(entities.map((_, i) => i)), dx, dy));

  const have = new Map([...target.names].map((n) => [low(n), n])), hidden = new Set([...target.hidden].map(low)), locked = new Set([...target.locked].map(low));
  const layers = { ...target.raw.layers }, moved = {}, made = [];
  entities = entities.map((e) => {
    const k = low(e.layer), own = have.get(k);
    if (own && !hidden.has(k) && !locked.has(k)) return own === e.layer ? e : withLayer(e, own);
    if (own) { moved[e.layer] = (moved[e.layer] || 0) + 1; return withLayer(e, target.cur); }
    have.set(k, e.layer); made.push(e.layer);
    layers[e.layer] = part.raw.layers[e.layer] || { aci: 7, tc: null, off: false, frozen: false, lt: 'CONTINUOUS', lw: -3, handle: '' };
    return e;
  });

  const taken = new Set(Object.keys(target.raw.blocks).map(low)), names = new Map();
  for (const nm of Object.keys(blocks)) if (taken.has(low(nm))) names.set(nm, freeBlock(nm, new Set([...taken, ...Object.keys(blocks).map(low)])));
  const merged = { ...target.raw.blocks };
  for (const [nm, b] of Object.entries(blocks)) merged[names.get(nm) || nm] = names.size ? { ...b, entities: b.entities.map((e) => reinsert(e, names)) } : b;
  if (names.size) entities = entities.map((e) => reinsert(e, names));

  const from = target.raw.entities.length;
  return { entities: [...target.raw.entities, ...entities], blocks: merged, layers, from, count: entities.length, moved, made };
}
