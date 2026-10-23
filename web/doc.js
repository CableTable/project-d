// doc.js — pure helpers for an opened drawing (no DOM). The drawing is placed at true size on the sheet,
// its 0,0 at the sheet's bottom-left corner. Sheet coordinates are mm, origin top-left, y down (as layout.js).

/** mm in one drawing unit, by drawing.js's unit names. Unknown or unitless → 1 (treated as mm). */
const MM_PER = { mm: 1, cm: 10, dm: 100, m: 1000, km: 1e6, in: 25.4, ft: 304.8, yd: 914.4, mi: 1609344, mil: 0.0254, 'µin': 25.4e-6 };
const NAMES = { in: 'inch', ft: 'foot', mi: 'mile', yd: 'yard', mil: 'mil', 'µin': 'microinch' };

export function unitFactor(units) {
  return MM_PER[units] || 1;
}

/** "converted from inch" for a non-mm file, else ''. */
export function convertedNote(units) {
  return MM_PER[units] && MM_PER[units] !== 1 ? 'converted from ' + (NAMES[units] || units) : '';
}

/** The space to show: the model, or the paper layout when the file has no model. 0 = model, 1 = paper. */
export function spaceOf(fl) {
  return fl.boxes && fl.boxes.model ? 0 : 1;
}

const shownCache = new WeakMap();
/** Items of the shown space (kept per drawing: a big one is not filtered again on every pan frame). */
export function shownItems(fl) {
  const sp = spaceOf(fl), c = shownCache.get(fl);
  if (c && c.items === fl.items && c.n === fl.items.length && c.sp === sp) return c.list;
  const list = fl.items.filter((it) => (it.ps ? 1 : 0) === sp);
  shownCache.set(fl, { items: fl.items, n: fl.items.length, sp, list });
  return list;
}

/** An item is drawn unless one of its layers is switched off (off = a Set of layer indexes). */
export const itemVisible = (it, off) => it.L.every((l) => !off.has(l));

/** Layers the file itself has switched off or frozen: hidden to start with. */
export function startHidden(fl) {
  return new Set(fl.layers.map((l, i) => (l.on ? -1 : i)).filter((i) => i >= 0));
}

/** Top-level entity indexes in the shown space, including unsupported objects preserved on Save. */
export function shownEntityIndexes(raw, fl) {
  const sp = spaceOf(fl);
  return raw.entities.flatMap((e, i) => !e.hidden && (e.ps ? 1 : 0) === sp ? [i] : []);
}

/** Entities in the shown space: a block or dimension counts once, on its own layer. */
export function entityCount(raw, fl) {
  return shownEntityIndexes(raw, fl).length;
}

/** Entities per layer index, using the same top-level objects as the Objects tree. */
export function layerCounts(raw, fl) {
  const n = new Array(fl.layers.length).fill(0), at = new Map(fl.layers.map((l, i) => [l.name, i]));
  for (const e of shownEntityIndexes(raw, fl)) {
    const l = at.get(raw.entities[e].layer);
    if (l != null) n[l]++;
  }
  return n;
}

/** The drawing's box [x0,y0,x1,y1] in mm, y up, or null if it has none. */
export function drawingBoxMm(fl, factor) {
  const b = fl.boxes && fl.boxes[spaceOf(fl) ? 'paper' : 'model'];
  return b ? b.map((v) => v * factor) : null;
}

/** The matrix from drawing units to sheet mm: scale, y up, 0,0 at the sheet's bottom-left. */
export const placement = (factor, sheetH) => [factor, 0, 0, -factor, 0, sheetH];

/** A drawing-mm box → a box in sheet coordinates (y flipped). */
export const boxOnSheet = (b, sheetH) => [b[0], sheetH - b[3], b[2], sheetH - b[1]];

/** What Fit should show: the sheet plus the drawing's box (if any), as [x0,y0,x1,y1] in sheet coordinates. */
export function fitRect(sheetW, sheetH, boxMm) {
  const r = [0, 0, sheetW, sheetH];
  if (!boxMm) return r;
  const b = boxOnSheet(boxMm, sheetH);
  return [Math.min(r[0], b[0]), Math.min(r[1], b[1]), Math.max(r[2], b[2]), Math.max(r[3], b[3])];
}

/** A point on the sheet (x right, y down) → the cursor readout: mm from the bottom-left, y up. */
export const cursorMm = (x, y, sheetH) => [x, sheetH - y];

/** Does the drawing's box lie inside the sheet? */
export function fitsSheet(boxMm, sheetW, sheetH) {
  return !boxMm || (boxMm[0] >= 0 && boxMm[1] >= 0 && boxMm[2] <= sheetW && boxMm[3] <= sheetH);
}

/** The recent-files list with `path` put first: no repeats (Windows paths match whatever the case), at most `max`. */
export function addRecent(list, path, max = 8) {
  const key = (p) => String(p).replace(/\//g, '\\').toLowerCase();
  return [path, ...(Array.isArray(list) ? list : []).filter((p) => typeof p === 'string' && key(p) !== key(path))].slice(0, max);
}

/** The words of the close prompt for the tabs with unsaved changes (names): { title, names } (names are listed only when there are several, five at most). */
export function closePrompt(names) {
  const list = names.filter((n) => typeof n === 'string');
  if (list.length === 1) return { title: `Save changes to "${list[0]}"?`, names: [] };
  const shown = list.slice(0, 5);
  if (list.length > shown.length) shown.push(`and ${list.length - shown.length} more`);
  return { title: `Save changes to ${list.length} drawings?`, names: shown };
}
