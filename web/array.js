// ARRAY (TODO 75): copies of the selection in columns and rows. Pure maths and the typed words; no DOM.
// The result is plain copies (Copy's own routine), not a linked array object. Polar (T2) will add its own
// config beside `rect` and its own offsets / transform; the typed-line parser and withField are shared.
import { copyEntities } from './edit.js';

export const MAX_ITEMS = 10000;       // columns x rows: more is nearly always a typo, and would freeze the drawing

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

/** One field set, checked: counts are whole numbers from 1, spacings any number. → { cfg } or { error } */
export function withField(cfg, key, v) {
  if (!Number.isFinite(v)) return { error: 'Type a number' };
  if (key === 'cols' || key === 'rows') {
    if (!Number.isInteger(v) || v < 1) return { error: `The number of ${key === 'cols' ? 'columns' : 'rows'} is a whole number, 1 or more` };
    const next = { ...cfg, [key]: v };
    if (next.cols * next.rows > MAX_ITEMS) return { error: `That is ${next.cols * next.rows} objects: the most is ${MAX_ITEMS}` };
    return { cfg: next };
  }
  return { cfg: { ...cfg, [key]: v } };
}

const OPTIONS = [['count', 3], ['columns', 3], ['rows', 1], ['spacing', 1], ['exit', 1]];       // [name, letters that pick it]: COUnt, COLumns, Rows, Spacing, Exit
const optionOf = (w) => w === 'x' ? 'exit' : OPTIONS.find(([name, n]) => w.length >= n && name.startsWith(w))?.[0];
const FIELDS = { count: ['cols', 'rows'], columns: ['cols'], rows: ['rows'], spacing: ['dx', 'dy'] };

/** "col 2 r 3", "s 40 -25", "cou": option words, each with the numbers after it. → [{ opt, args }] or null when it is not such a line */
export function parseLine(text) {
  const steps = [];
  for (const tok of String(text).trim().toLowerCase().split(/[\s,]+/).filter(Boolean)) {
    if (Number.isFinite(Number(tok))) { if (!steps.length) return null; steps.at(-1).args.push(Number(tok)); continue; }
    const opt = optionOf(tok);
    if (!opt) return null;
    steps.push({ opt, args: [] });
  }
  return steps.length ? steps : null;
}

/** A parsed line applied: the new config, the fields still to ask (the last option typed without numbers) and whether Exit was typed. → { cfg, ask, exit } or { error } */
export function applyLine(cfg, steps) {
  let ask = [], exit = false;
  for (const [n, { opt, args }] of steps.entries()) {
    if (opt === 'exit') { exit = true; continue; }
    const keys = FIELDS[opt];
    if (!args.length) {
      if (n < steps.length - 1) return { error: `${opt[0].toUpperCase() + opt.slice(1)} needs a number` };
      ask = keys; continue;
    }
    for (const [k, v] of args.slice(0, keys.length).entries()) {
      const r = withField(cfg, keys[k], v);
      if (r.error) return r;
      cfg = r.cfg;
    }
  }
  return { cfg, ask, exit };
}

/** The selection arrayed: Copy's routine once per offset, so the copies keep layer, colour and line type and dimension blocks are isolated. Spacings are mm; `factor` turns them into drawing units. */
export function arrayRect(raw, selection, cfg, factor = 1) {
  if (!(factor > 0)) throw new Error('Array needs the drawing scale');
  if (!Number.isInteger(cfg.cols) || !Number.isInteger(cfg.rows) || cfg.cols < 1 || cfg.rows < 1 || cfg.cols * cfg.rows > MAX_ITEMS) throw new Error('Array needs whole numbers of columns and rows (most ' + MAX_ITEMS + ' objects)');
  let cur = { entities: raw.entities, blocks: raw.blocks };
  for (const [x, y] of rectOffsets(cfg)) cur = copyEntities(cur, selection, x / factor, y / factor);
  return cur;
}
