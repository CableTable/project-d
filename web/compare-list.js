// Compare's session-only snapshots and results; no DOM or storage.
import { COLOURS, polylines, boxOf, lineUp, compareSteps } from './compare.js';
import { itemShown, areaPerimeterSteps, chainTol } from './edit.js';
import { spaceOf } from './doc.js';
import { drain, slice, scaled } from './perf.js';

export const MAX_ITEMS = 5;
export const reference = (items) => items.find((x) => x.checked);
export const removeItem = (items, id) => items.filter((x) => x.id !== id);
export const setItem = (items, id, patch) => items.map((x) => x.id === id ? { ...x, ...patch } : x);
const metrics = new WeakMap();      // keyed by the visible outlines, which lineUpItems / setItem share
const artwork = new WeakMap();      // a snapshot's sampled outlines, including layers it may show later

function visibleOutlines(fl, factor, off) {
  let all = artwork.get(fl);
  if (!all) {
    const layers = [];
    all = { ...polylines(fl, factor, undefined, layers), layers };
    artwork.set(fl, all);
  }
  const polys = off.size ? all.polys.filter((_, i) => all.layers[i].every((l) => !off.has(l))) : all.polys;
  const box = off.size ? boxOf(polys) : all.box;
  return { polys, box, w: box ? box[2] - box[0] : 0, h: box ? box[3] - box[1] : 0 };
}

/** Artwork and dimensions refreshed together, including an emptied drawing. */
export function snapshotGeometry(source) {
  // A source edit makes a new fl, so the snapshot owns the old artwork without a deep copy.
  const { name, raw, factor = 1 } = source, fl = { ...source.fl }, off = new Set(source.off);
  return { name, fl, factor, off, raw: { entities: raw.entities.map(({ type, layer }) => ({ type, layer })) }, ...visibleOutlines(fl, factor, off), sn: null };
}

/** Hide or show layers in this snapshot only (its own off list): outlines and measurements follow; the source drawing is untouched. */
export const setItemOff = (item, off) => ({ ...item, off, ...visibleOutlines(item.fl, item.factor, off) });

/** A snapshot's artwork from its source again; its hidden layers are kept by name, since layer numbers shift when a layer empties or appears. */
export function refreshGeometry(item, source) {
  const names = new Set([...item.off].map((i) => item.fl.layers[i]?.name));
  return snapshotGeometry({ ...source, off: new Set(source.fl.layers.flatMap((l, i) => names.has(l.name) ? [i] : [])) });
}

/** A snapshot owns its artwork; a tab id lets the app refresh it while that tab is open. */
export function addItem(items, source) {
  if (items.length >= MAX_ITEMS) throw new Error('Compare: at most 5 drawings');
  const geometry = snapshotGeometry(source);
  if (!geometry.box) throw new Error(source.name + ': no outlines to compare (lines, arcs, circles and polylines)');
  const colour = COLOURS.find((k) => !items.some((x) => x.colour === k.id)).id;
  return [...items, { id: Math.max(0, ...items.map((x) => x.id)) + 1, ...geometry, tabId: source.tabId || null, part: !!source.part,
    colour, checked: true, visible: true, offset: [0, 0] }];
}

export const drawingPoint = (item, point) => point.map((v, i) => (v - item.offset[i]) / item.factor);
export const comparePoint = (item, point) => point.map((v, i) => v * item.factor + item.offset[i]);

/** Manual offsets belong to each item; automatic line up puts every checked item on the reference. */
export function lineUpItems(items, mode) {
  const ref = reference(items);
  if (!ref?.box || mode === 'manual') return items;
  return items.map((x) => x.checked && x.box ? { ...x, offset: x === ref ? [0, 0] : lineUp(ref.box, x.box, mode) } : x);
}

/** The part of edit.js makeIndex that outlineLoops reads, without its pick grid (that grid was most of the time on 150 000 entities). */
function loopIndex(raw, fl, off) {
  const space = spaceOf(fl), byEnt = new Array(raw.entities.length), shown = [];
  fl.items.forEach((it, i) => {
    if (!itemShown(it, space, off, null)) return;
    if (!byEnt[it.e]) { byEnt[it.e] = []; shown.push(it.e); }
    byEnt[it.e].push(i);
  });
  return { raw, fl, items: fl.items, byEnt, shown };
}

/** Each checked item's signed measurements and outline differences from the first checked item. */
export const compareItems = (items, tol) => drain(compareItemsSteps(items, tol));
/** compareItems as a generator (TODO 316): yields its progress (0..1) whenever due() says its slice is used up; the app runs it with runChunks. */
export function* compareItemsSteps(items, tol, due = slice()) {
  const ref = reference(items), chosen = items.filter((x) => x.checked);
  if (chosen.length < 2) return null;
  const diffs = [], rows = [], units = 2 * chosen.length - 1;       // a metrics step per item, a compare step per item but the reference
  let truncated = false, unit = 0;
  for (const item of chosen) {
    if (!metrics.has(item.polys)) {
      const ed = loopIndex(item.raw, item.fl, item.off);
      const m = item.box && (yield* scaled(areaPerimeterSteps(ed, new Set(ed.shown), item.factor, chainTol(item.box, 1) / item.factor, due), unit / units, (unit + 1) / units));
      metrics.set(item.polys, { area: m?.area || 0, perimeter: m?.perimeter || 0, w: item.w, h: item.h });
    }
    unit++;
    const current = metrics.get(item.polys), base = metrics.get(ref.polys);
    const delta = Object.fromEntries(Object.keys(base).map((k) => [k, current[k] - base[k]]));
    rows.push({ id: item.id, ...delta });
    if (item === ref) continue;
    const result = yield* scaled(compareSteps(ref.polys, item.polys, tol, { offsetB: [item.offset[0] - ref.offset[0], item.offset[1] - ref.offset[1]] }, due), unit / units, (unit + 1) / units);
    unit++;
    truncated ||= result.truncated;
    for (const d of result.diffs) diffs.push({ ...d, n: diffs.length + 1, itemId: item.id,
      x: d.x + ref.offset[0], y: d.y + ref.offset[1], box: d.box.map((v, i) => v + ref.offset[i % 2]) });
  }
  return { rows, diffs, truncated };
}
