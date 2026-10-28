// ARRAY (TODO 75): copies of the selection in columns and rows. Pure maths and the typed words; no DOM.
// The result is plain copies (the shared copy-many routine), not a linked array object. Rectangular and Polar
// each have their own config and placements; the typed-line parser and withField are shared.
import { copyMany } from './edit.js';

export const MAX_ITEMS = 10000;       // array items x selection size: more is nearly always a typo, and would freeze the drawing

/** AutoCAD's defaults for a selection of `box` [x0,y0,x1,y1] mm: 4 columns x 3 rows, spacing 1.5 x its width / height (10 mm when it has none). */
export function rectDefaults(box) {
  const w = box ? box[2] - box[0] : 0, h = box ? box[3] - box[1] : 0;
  return { cols: 4, rows: 3, dx: 1.5 * w || 10, dy: 1.5 * h || 10 };
}

/** The offsets [dx, dy] of every copy (the original, at 0,0, is not one): columns go along x, rows along y; a negative spacing goes the other way. */
export function rectOffsets({ cols, rows, dx, dy }) {
  const out = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (i || j) out.push([i * dx, j * dy]);
  return out;
}

/** AutoCAD's Polar defaults: 6 items over 360°, items turned as they go round. */
export const polarDefaults = () => ({ items: 6, fill: 360, rotate: true });

/** The angle between neighbouring items: 360 spreads them evenly with no overlap, any other fill puts the first and last at its ends; the sign is the way round (negative = clockwise). */
export function polarStep({ items, fill }) {
  if (items < 2) return 0;
  return Math.abs(fill) === 360 ? fill / items : fill / (items - 1);
}

/** Every copy (the original is not one) round `center`, in drawing units: Rotate items on → { deg } about the centre; off → the same orientation, { dx, dy } carrying the `base` point round the centre. */
export function polarPlacements(center, base, cfg) {
  const step = polarStep(cfg), out = [];
  for (let k = 1; k < cfg.items; k++) {
    const deg = k * step;
    if (cfg.rotate) { out.push({ deg, dx: 0, dy: 0 }); continue; }
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), x = base[0] - center[0], y = base[1] - center[1];
    out.push({ deg: 0, dx: x * c - y * s - x, dy: x * s + y * c - y });
  }
  return out;
}

/** "y" / "yes" → true, "n" / "no" → false, anything else null. */
export const yesNo = (text) => { const w = String(text).trim().toLowerCase(); return w === 'y' || w === 'yes' ? true : w === 'n' || w === 'no' ? false : null; };

const capError = (items, n) => `That is ${items} items x ${n} selected objects = ${items * n} objects (including originals): the most is ${MAX_ITEMS}`;

/** One field set, checked: counts are whole numbers from 1, spacings any number. → { cfg } or { error } */
export function withField(cfg, key, v, selectionSize = 1) {
  if (!Number.isFinite(v)) return { error: 'Type a number' };
  if (key === 'rotate') return { cfg: { ...cfg, rotate: v !== 0 } };
  if (key === 'items') {
    if (!Number.isInteger(v) || v < 1) return { error: 'The number of items is a whole number, 1 or more' };
    if (v * selectionSize > MAX_ITEMS) return { error: capError(v, selectionSize) };
    return { cfg: { ...cfg, items: v } };
  }
  if (key === 'fill') {
    if (!v || Math.abs(v) > 360) return { error: 'The angle to fill is from -360 to 360, not 0 (negative = clockwise)' };
    return { cfg: { ...cfg, fill: v } };
  }
  if (key === 'cols' || key === 'rows') {
    if (!Number.isInteger(v) || v < 1) return { error: `The number of ${key === 'cols' ? 'columns' : 'rows'} is a whole number, 1 or more` };
    const next = { ...cfg, [key]: v };
    if (next.cols * next.rows * selectionSize > MAX_ITEMS) return { error: capError(next.cols * next.rows, selectionSize) };
    return { cfg: next };
  }
  return { cfg: { ...cfg, [key]: v } };
}

// [name, letters that pick it]: COUnt, COLumns, Rows, Spacing, Exit; Items, Fill, ROTate items, Exit
const OPTIONS = { rect: [['count', 3], ['columns', 3], ['rows', 1], ['spacing', 1], ['exit', 1]], polar: [['items', 1], ['fill', 1], ['rotate', 3], ['exit', 1]] };
const optionOf = (w, mode) => w === 'x' ? 'exit' : OPTIONS[mode].find(([name, n]) => w.length >= n && name.startsWith(w))?.[0];
const FIELDS = { count: ['cols', 'rows'], columns: ['cols', 'dx'], rows: ['rows', 'dy'], spacing: ['dx', 'dy'], items: ['items'], fill: ['fill'], rotate: ['rotate'] };

/** "col 2 r 3", "s 40 -25", "cou" (Polar: "i 8 f 180", "rot n"): option words, each with the numbers after it (Yes / No after ROTate). → [{ opt, args }] or null when it is not such a line */
export function parseLine(text, mode = 'rect') {
  const steps = [];
  for (const tok of String(text).trim().toLowerCase().split(/[\s,]+/).filter(Boolean)) {
    if (Number.isFinite(Number(tok))) { if (!steps.length) return null; steps.at(-1).args.push(Number(tok)); continue; }
    if (steps.at(-1)?.opt === 'rotate' && !steps.at(-1).args.length && yesNo(tok) !== null) { steps.at(-1).args.push(+yesNo(tok)); continue; }
    const opt = optionOf(tok, mode);
    if (!opt) return null;
    steps.push({ opt, args: [] });
  }
  return steps.length ? steps : null;
}

/** A parsed line applied: the new config, the fields still to ask (the last option typed without numbers) and whether Exit was typed. → { cfg, ask, exit } or { error } */
export function applyLine(cfg, steps, selectionSize = 1) {
  let ask = [], exit = false;
  for (const [n, { opt, args }] of steps.entries()) {
    if (opt === 'exit') { exit = true; continue; }
    const keys = FIELDS[opt];
    if (!args.length) {
      if (n < steps.length - 1) return { error: `${opt[0].toUpperCase() + opt.slice(1)} needs ${opt === 'rotate' ? 'Yes or No' : 'a number'}` };
      ask = keys; continue;
    }
    for (const [k, v] of args.slice(0, keys.length).entries()) {
      const r = withField(cfg, keys[k], v, selectionSize);
      if (r.error) return r;
      cfg = r.cfg;
    }
    ask = n === steps.length - 1 ? keys.slice(args.length) : [];
  }
  return { cfg, ask, exit };
}

/** The selection arrayed: One batch of copies, so the copies keep layer, colour and line type and dimension blocks are isolated. Spacings are mm; `factor` turns them into drawing units. */
export function arrayRect(raw, selection, cfg, factor = 1) {
  if (!(factor > 0)) throw new Error('Array needs the drawing scale');
  if (!Number.isInteger(cfg.cols) || !Number.isInteger(cfg.rows) || cfg.cols < 1 || cfg.rows < 1) throw new Error('Array needs whole numbers of columns and rows (most ' + MAX_ITEMS + ' objects)');
  if (cfg.cols * cfg.rows * selection.size > MAX_ITEMS) throw new Error(capError(cfg.cols * cfg.rows, selection.size));
  return copyMany(raw, selection, rectOffsets(cfg).map(([x, y]) => ({ dx: x / factor, dy: y / factor })));
}

/** The selection arrayed round `center`: One batch of rotated copies (Rotate items on) or the `base` point carried round (off), so layer, colour and line type are kept. Centre and base are drawing units. */
export function arrayPolar(raw, selection, center, base, cfg) {
  if (![...center, ...base].every(Number.isFinite)) throw new Error('Array needs a centre point');
  if (!Number.isInteger(cfg.items) || cfg.items < 1) throw new Error('Array needs a whole number of items (most ' + MAX_ITEMS + ')');
  if (!cfg.fill || Math.abs(cfg.fill) > 360) throw new Error('Array needs an angle to fill from -360 to 360');
  if (cfg.items * selection.size > MAX_ITEMS) throw new Error(capError(cfg.items, selection.size));
  return copyMany(raw, selection, polarPlacements(center, base, cfg), center);
}
