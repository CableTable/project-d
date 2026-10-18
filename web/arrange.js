// arrange.js — pure: Align and Distribute for placed parts, and the groups they travel in (no DOM) — arrange.test.mjs.
//
// Boxes are [x0, y0, x1, y1] in sheet mm, y up (what apply.js placedBox gives). A group is one object: its parts share a
// `g` (a string) on their placements, and align and distribute move the group's parts together by the same amount.
// Every function returns new numbers; nothing is changed in place.

export const ALIGN_HOW = ['left', 'centre', 'right', 'top', 'middle', 'bottom'];
export const REL = ['selection', 'sheet', 'first'];

/** The box that holds all of these boxes, or null when there are none. */
export function unionBox(boxes) {
  if (!boxes.length) return null;
  return [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
}

/**
 * The objects of a selection, in pick order: items [{ g, box }] (g: the group id or undefined) → [{ members: [item index], box, g }].
 * Items of one group are one object (placed where its first-picked member comes in the order).
 */
export function objectsOf(items) {
  const out = [], byGroup = new Map();
  items.forEach((it, i) => {
    if (it.g && byGroup.has(it.g)) { const o = byGroup.get(it.g); o.members.push(i); o.box = unionBox([o.box, it.box]); return; }
    const o = { members: [i], box: it.box.slice(), g: it.g || null };
    out.push(o);
    if (it.g) byGroup.set(it.g, o);
  });
  return out;
}

/** The frame to line up with: the union of the boxes (selection), the sheet [0, 0, W, H], or the first selected box. */
function frameOf(boxes, rel, sheet, first) {
  if (rel === 'sheet' && sheet) return sheet;
  if (rel === 'first' && boxes[first]) return boxes[first];
  return unionBox(boxes);
}

/**
 * How far each box moves to line up: how is left, centre, right (along X), top, middle or bottom (along Y).
 * rel: 'selection' (the box round all of them), 'sheet' (sheet = [0, 0, W, H]) or 'first' (the box at index `first`, which stays).
 * → [{ dx, dy }] per box (no -0).
 */
export function alignDeltas(boxes, how, rel = 'selection', sheet = null, first = 0) {
  const f = frameOf(boxes, rel, sheet, first);
  if (!f) return [];
  const fx = (f[0] + f[2]) / 2, fy = (f[1] + f[3]) / 2;
  return boxes.map((b) => {
    let dx = 0, dy = 0;
    if (how === 'left') dx = f[0] - b[0];
    else if (how === 'right') dx = f[2] - b[2];
    else if (how === 'centre') dx = fx - (b[0] + b[2]) / 2;
    else if (how === 'top') dy = f[3] - b[3];
    else if (how === 'bottom') dy = f[1] - b[1];
    else if (how === 'middle') dy = fy - (b[1] + b[3]) / 2;
    return { dx: dx || 0, dy: dy || 0 };
  });
}

/**
 * Equal gaps between the boxes along an axis ('x' left to right, 'y' bottom to top), in their current order. The span is the
 * outer edges of the selection (the first and last stay put) or, relative to the sheet, the sheet's whole width / height
 * (the first box touches the near edge, the last the far one). "First selected" uses the selection's span too: with equal gaps
 * there is no other sensible place for the rest to go (DECISIONS.md).
 * → { deltas: [{ dx, dy }], gap } (gap in mm, negative when the boxes overlap), or null with fewer than 3 boxes.
 */
export function distributeDeltas(boxes, axis, rel = 'selection', sheet = null) {
  if (boxes.length < 3) return null;
  const a = axis === 'y' ? 1 : 0, b = a + 2;
  const order = boxes.map((_, i) => i).sort((p, q) => boxes[p][a] - boxes[q][a] || boxes[p][b] - boxes[q][b] || p - q);
  const u = unionBox(boxes);
  const lo = rel === 'sheet' && sheet ? sheet[a] : u[a], hi = rel === 'sheet' && sheet ? sheet[b] : u[b];
  const total = boxes.reduce((s, bx) => s + (bx[b] - bx[a]), 0), gap = (hi - lo - total) / (boxes.length - 1);
  const deltas = boxes.map(() => ({ dx: 0, dy: 0 }));
  let at = lo;
  for (const i of order) {
    const move = at - boxes[i][a];
    if (a === 0) deltas[i].dx = move || 0; else deltas[i].dy = move || 0;
    at += boxes[i][b] - boxes[i][a] + gap;
  }
  return { deltas, gap };
}

/** The same deltas for the parts of each object: objects' deltas → one delta per item. */
export function spreadToItems(objects, deltas, nItems) {
  const out = new Array(nItems).fill(null).map(() => ({ dx: 0, dy: 0 }));
  objects.forEach((o, k) => { for (const m of o.members) out[m] = deltas[k]; });
  return out;
}

/** Does this selection consist of exactly one whole group? items [{ g }], allG: every member of that group in the layout (count). */
export function isWholeGroup(items, groupCount) {
  if (items.length < 2 || !items[0].g) return false;
  return items.every((it) => it.g === items[0].g) && items.length === groupCount(items[0].g);
}
