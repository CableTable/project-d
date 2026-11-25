// doc.js — pure helpers for an opened drawing (no DOM). The drawing is placed at true size on the sheet,
// its 0,0 at the sheet's bottom-left corner. Sheet coordinates are mm, origin top-left, y down (as layout.js).

/** mm in one drawing unit, by drawing.js's unit names. Unknown or unitless → 1 (treated as mm). */
const MM_PER = { mm: 1, cm: 10, dm: 100, m: 1000, km: 1e6, in: 25.4, ft: 304.8, yd: 914.4, mi: 1609344, mil: 0.0254, 'µin': 25.4e-6 };
const NAMES = { in: 'inch', ft: 'foot', mi: 'mile', yd: 'yard', mil: 'mil', 'µin': 'microinch' };

export function unitFactor(units) {
  return MM_PER[units] || 1;
}

/** CorelDRAW-style backup beside the file, keeping its extension so it opens as a drawing. */
export function backupPath(path) {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1;
  return path.slice(0, at) + 'Backup_of_' + path.slice(at);
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
  const out = [], ents = raw.entities;                 // a loop, not flatMap: that makes an array per entity (30 ms at 150k)
  for (let i = 0; i < ents.length; i++) if (!ents[i].hidden && (ents[i].ps ? 1 : 0) === sp) out.push(i);
  return out;
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

/**
 * TODO 319c: { counts: layerCounts, n: entityCount } after an edit, from what they were before (prev = { entities, names, space, counts, n }):
 * only the entities between the first and the last one that differ are counted again. Counted in full when prev is not for the
 * entity list the edit started from, or the layers (names, order) or the shown space differ (a layer that lost its last entity, a space change).
 */
export function patchedCounts(prev, raw, fl) {
  const old = prev?.entities, now = raw.entities, space = spaceOf(fl);
  if (!old || prev.space !== space || prev.names.length !== fl.layers.length || prev.names.some((n, i) => n !== fl.layers[i].name)) return { counts: layerCounts(raw, fl), n: entityCount(raw, fl) };
  let a = 0, b = 0;
  while (a < old.length && a < now.length && old[a] === now[a]) a++;
  while (b < old.length - a && b < now.length - a && old[old.length - 1 - b] === now[now.length - 1 - b]) b++;
  const counts = prev.counts.slice(), at = new Map(fl.layers.map((l, i) => [l.name, i]));
  let n = prev.n;
  const move = (list, to, sign) => {
    for (let i = a; i < to; i++) {
      const e = list[i];
      if (e.hidden || (e.ps ? 1 : 0) !== space) continue;
      n += sign;
      const l = at.get(e.layer);
      if (l != null) counts[l] += sign;
    }
  };
  move(old, old.length - b, -1); move(now, now.length - b, 1);
  return { counts, n };
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

export const recentKey = (p) => String(p).replace(/\//g, '\\').toLowerCase();

/** The thumbnail keys (recentKey of a path) in `ids` to delete: a thumbnail stays only for a path that is in the recent list or pinned (TODO 136b). */
export function staleThumbs(ids, list, pins = []) {
  const keep = new Set([...(Array.isArray(list) ? list : []), ...(Array.isArray(pins) ? pins : [])].filter((p) => typeof p === 'string').map(recentKey));
  return ids.filter((id) => !keep.has(id));
}

/** The Options "Recent files" count: a whole number 0-50, 20 when unset or not a number (TODO 136a). */
export function recentMax(v) {
  const n = Math.floor(Number(v));
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? 20 : Math.min(50, Math.max(0, n));
}

/** The list cut to `max` unpinned paths; pinned paths (`pins`) always stay and do not count against `max`. */
export function trimRecent(list, max = 20, pins = []) {
  const pinned = new Set((Array.isArray(pins) ? pins : []).map(recentKey));
  let n = 0;
  return (Array.isArray(list) ? list : []).filter((p) => pinned.has(recentKey(p)) || n++ < max);
}

/** The recent-files list with `path` put first: no repeats (Windows paths match whatever the case), at most `max` unpinned. */
export function addRecent(list, path, max = 20, pins = []) {
  return trimRecent([path, ...removeRecent(list, path)], max, pins);
}

/** Remove a recent path using the same Windows path key as addRecent, preserving the remaining order. */
export function removeRecent(list, path) {
  return (Array.isArray(list) ? list : []).filter((p) => typeof p === 'string' && recentKey(p) !== recentKey(path));
}

/** The pinned paths with `path` pinned (`on`) or unpinned: no repeats, same Windows path key. Removing a recent file unpins it with this. */
export function setPin(pins, path, on = true) {
  const rest = removeRecent(pins, path);
  return on ? [...rest, path] : rest;
}

/** The recent list in display order: pinned paths first, then the others, each group in last-opened order. A pin with no row is ignored. */
export function orderRecent(list, pins = []) {
  const pinned = new Set((Array.isArray(pins) ? pins : []).map(recentKey));
  const rows = (Array.isArray(list) ? list : []).filter((p) => typeof p === 'string');
  return [...rows.filter((p) => pinned.has(recentKey(p))), ...rows.filter((p) => !pinned.has(recentKey(p)))];
}

/** First free duplicate number across all tab names, before the file extension. */
export function dupName(name, names) {
  const ext = name.match(/\.[^.]+$/)?.[0] || '', base = name.slice(0, name.length - ext.length).replace(/ \(\d+\)$/, '');
  const used = new Set(names.map((n) => n.toLowerCase()));
  let n = 2;
  while (used.has(`${base} (${n})${ext}`.toLowerCase())) n++;
  return `${base} (${n})${ext}`;
}

/** Files over this many bytes get a warning before they are opened (T273a). */
export const BIG_FILE = 50 * 1024 * 1024;

/** The question to ask before opening `files` ({ name, size }): null when none is over BIG_FILE; one dialog names every big one. */
export function bigFileAsk(files) {
  const big = files.filter((f) => f.size > BIG_FILE), mb = (f) => Math.round(f.size / 1048576) + ' MB';
  if (!big.length) return null;
  const tail = 'big drawings may open slowly and some tools may lag.';
  if (big.length === 1) return `${big[0].name} is ${mb(big[0])}: ${tail} Open it?`;
  return `${big.length} files are big (${big.map((f) => `${f.name} ${mb(f)}`).join(', ')}): ${tail} Open them?`;
}

/** The words of the close prompt for the tabs with unsaved changes (names): { title, names } (names are listed only when there are several, five at most). */
export function closePrompt(names) {
  const list = names.filter((n) => typeof n === 'string');
  if (list.length === 1) return { title: `Save changes to "${list[0]}"?`, names: [] };
  const shown = list.slice(0, 5);
  if (list.length > shown.length) shown.push(`and ${list.length - shown.length} more`);
  return { title: `Save changes to ${list.length} drawings?`, names: shown };
}
