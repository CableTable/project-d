// Compare's session-only snapshots and results; no DOM or storage.
import { COLOURS, polylines, lineUp, compare } from './compare.js';
import { makeIndex, areaPerimeter, chainTol } from './edit.js';

export const MAX_ITEMS = 5;
export const reference = (items) => items.find((x) => x.checked);
export const removeItem = (items, id) => items.filter((x) => x.id !== id);
export const setItem = (items, id, patch) => items.map((x) => x.id === id ? { ...x, ...patch } : x);

/** Copy the artwork and layer visibility: later source edits cannot reach the snapshot. */
export function addItem(items, source) {
  if (items.length >= MAX_ITEMS) throw new Error('Compare: at most 5 drawings');
  const { name, raw, factor = 1 } = source, fl = structuredClone(source.fl), off = new Set(source.off);
  const outlines = polylines(fl, factor, off);
  if (!outlines.box) throw new Error(name + ': no outlines to compare (lines, arcs, circles and polylines)');
  const ed = makeIndex(raw, fl, off), ents = new Set(ed.shown);
  const metrics = areaPerimeter(ed, ents, factor, chainTol(outlines.box, 1) / factor);
  const colour = COLOURS.find((k) => !items.some((x) => x.colour === k.id)).id;
  return [...items, { id: Math.max(0, ...items.map((x) => x.id)) + 1, name, fl, factor, off, ...outlines,
    metrics: { area: metrics?.area || 0, perimeter: metrics?.perimeter || 0, w: outlines.box[2] - outlines.box[0], h: outlines.box[3] - outlines.box[1] },
    colour, checked: true, visible: true, offset: [0, 0] }];
}

/** Manual offsets belong to each item; automatic line up puts every checked item on the reference. */
export function lineUpItems(items, mode) {
  const ref = reference(items);
  if (!ref || mode === 'manual') return items;
  return items.map((x) => x.checked ? { ...x, offset: x === ref ? [0, 0] : lineUp(ref.box, x.box, mode) } : x);
}

/** Each checked item's signed measurements and outline differences from the first checked item. */
export function compareItems(items, tol) {
  const ref = reference(items), chosen = items.filter((x) => x.checked);
  if (chosen.length < 2) return null;
  const diffs = [], rows = [];
  let truncated = false;
  for (const item of chosen) {
    const delta = Object.fromEntries(Object.keys(ref.metrics).map((k) => [k, item.metrics[k] - ref.metrics[k]]));
    rows.push({ id: item.id, ...delta });
    if (item === ref) continue;
    const result = compare(ref.polys, item.polys, tol, { offsetB: [item.offset[0] - ref.offset[0], item.offset[1] - ref.offset[1]] });
    truncated ||= result.truncated;
    for (const d of result.diffs) diffs.push({ ...d, n: diffs.length + 1, itemId: item.id,
      x: d.x + ref.offset[0], y: d.y + ref.offset[1], box: d.box.map((v, i) => v + ref.offset[i % 2]) });
  }
  return { rows, diffs, truncated };
}
