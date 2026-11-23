// titleblock.js — pure: the title block of a Layouts sheet (TODO 9a, titleblock.test.mjs).
// One block "PD_TITLE" (border, labels and one ATTDEF per field) inserted once per sheet, bottom-right, as a layout block object. Its ATTRIB
// values are what the file keeps. Typed values live in the tab's title block settings (pdf-export.js cleanTitleBlock): a field with none is auto.
import { entity, line, rect, text, insert } from './dxf-write.js';

export const TITLE_NAME = 'PD_TITLE';
export const TITLE_W = 150;
const CELL = 50, ROW = 11, BASE_H = 4 * ROW, RH = 6;
export const REV_ROWS = 5;
export const TITLE_H = BASE_H + (REV_ROWS + 1) * RH;       // the field rows, with the revision table (a header and REV_ROWS rows) above them
/** [tag, settings key, label, column, row (0 = top), columns spanned], as laid out in the block: [tag, key, label, x, y, text height] */
const BASE = [
  ['TITLE', 'title', 'Title', 0, 0, 2], ['DRAWING_NO', 'drawingNo', 'Drawing no.', 2, 0, 1],
  ['REV', 'rev', 'Rev', 0, 1, 1], ['SCALE', 'scale', 'Scale', 1, 1, 1], ['SHEET_SIZE', 'size', 'Sheet size', 2, 1, 1],
  ['DATE', 'date', 'Date', 0, 2, 1], ['DRAWN_BY', 'drawnBy', 'Drawn by', 1, 2, 1], ['MATERIAL', 'material', 'Material', 2, 2, 1],
  ['FILE', 'file', 'File', 0, 3, 3],
].map(([tag, key, label, c, r]) => [tag, key, label, c * CELL + 1.5, (3 - r) * ROW + 2, 3.5]);
/** The revision columns (tag part, key part, header, x, width), five rows each (TODO 9b): REV1_REV, REV1_DATE, REV1_DESC, REV1_BY, REV2_REV… */
const REV_COLS = [['REV', 'Rev', 'Rev', 0, 15], ['DATE', 'Date', 'Date', 15, 30], ['DESC', 'Desc', 'Description', 45, 80], ['BY', 'By', 'By', 125, 25]];
const revRow = (i) => REV_COLS.map(([t]) => `REV${i + 1}_${t}`);
const REVS = Array.from({ length: REV_ROWS }, (_, i) => REV_COLS.map(([t, k, label, x]) => [`REV${i + 1}_${t}`, `r${i + 1}${k}`, label, x + 1.5, BASE_H + (REV_ROWS - 1 - i) * RH + 1.5, 2.5])).flat();
export const FIELDS = [...BASE, ...REVS];
/** The settings keys the PDF strip does not have (the strip's own are pdf-export.js TITLE_FIELDS). */
export const SHEET_KEYS = ['title', 'drawingNo', 'rev', 'drawnBy', 'material', ...REVS.map((f) => f[1])];

const code = (r, c) => String(r.v[r.c.indexOf(c)] ?? '');
const trim = (n) => String(Number(n.toFixed(2)));

/** The block's entities, in block coordinates (0,0 = its lower-left corner). */
export function titleBlockEntities() {
  const out = [rect(0, 0, TITLE_W, TITLE_H)];
  for (const y of [ROW, 2 * ROW, 3 * ROW]) out.push(line(0, y, TITLE_W, y));
  for (const x of [CELL, 2 * CELL]) out.push(line(x, ROW, x, 3 * ROW));
  out.push(line(2 * CELL, 3 * ROW, 2 * CELL, BASE_H));
  for (let k = 0; k <= REV_ROWS; k++) out.push(line(0, BASE_H + k * RH, TITLE_W, BASE_H + k * RH));
  for (const [, , label, x0] of REV_COLS) {
    if (x0) out.push(line(x0, BASE_H, x0, TITLE_H));
    out.push(text(x0 + 1.5, BASE_H + REV_ROWS * RH + 1.5, 2, label));
  }
  FIELDS.forEach(([tag, , label, x, y, ht], i) => {
    if (i < BASE.length) out.push(text(x, y + 5.5, 2, label));
    out.push(entity('ATTDEF', [[10, x], [20, y], [30, 0], [40, ht], [1, ''], [3, label], [2, tag], [70, 0]]));
  });
  return out;
}

/** The auto values: the sheet's size, scale 1:1 (a sheet is drawn in true size), today's date and the file name. */
export const titleAuto = (lay, name, date) => ({ file: name || 'layout', scale: '1:1', size: `${trim(lay.s.sheetW)} x ${trim(lay.s.sheetH)} mm`, date: date || '' });

/** TAG → text: what is typed in `store`, else the auto value, else empty. */
export const titleValues = (store, auto) => Object.fromEntries(FIELDS.map(([tag, key]) => [tag, typeof store?.[key] === 'string' ? store[key] : auto[key] ?? '']));

/** The block reference at (x, y) with its ATTRIBs (their places are the drawing's own, as the reader draws them), or null when the sheet is too small. */
export function titleInsert(x, y, values) {
  const ent = insert(TITLE_NAME, x, y, { layer: '0' });
  ent.kids = FIELDS.map(([tag, , , x0, y0, ht]) => entity('ATTRIB', [[10, x + x0], [20, y + y0], [30, 0], [40, ht], [1, values[tag] ?? ''], [2, tag], [70, 0]]).r);
  return ent;
}

/** The letters after `rev` (Z → AA, AZ → BA); a blank or non-letter revision starts at A. */
export function nextRev(rev) {
  const s = String(rev ?? '').trim().toUpperCase();
  if (!/^[A-Z]+$/.test(s)) return 'A';
  const c = s.split('');
  let i = c.length - 1;
  for (; i >= 0 && c[i] === 'Z'; i--) c[i] = 'A';
  if (i < 0) return 'A' + c.join('');
  c[i] = String.fromCharCode(c[i].charCodeAt(0) + 1);
  return c.join('');
}
export const REV_FULL = `All ${REV_ROWS} revision rows are full`;
/** Add revision: the ATTRIB values to set (TAG → text) for the first empty revision row (its REV is the letter after the last filled row's, or after the title REV; its date is `date`) and the title REV; null when every row is used. `values`: TAG → current text. */
export function nextRevision(values, date) {
  const rows = Array.from({ length: REV_ROWS }, (_, i) => revRow(i)), at = rows.findIndex((tags) => tags.every((t) => !String(values[t] ?? '').trim()));
  if (at < 0) return null;
  const rev = nextRev(rows.map((r) => values[r[0]] ?? '').findLast((v) => String(v).trim()) ?? values.REV);
  return { REV: rev, [rows[at][0]]: rev, [rows[at][1]]: date };
}

/** Where a new title block goes on a sheet: inside the grippers, bottom-right (sheet mm, y up); null when it does not fit. */
export function titleSpot(s) {
  const x = s.sheetW - (s.gripRight || 0) - TITLE_W, y = s.gripBottom || 0;
  return x >= (s.gripLeft || 0) && y + TITLE_H <= s.sheetH - (s.gripTop || 0) ? [x, y] : null;
}

/** Is this layout object the title block? */
export const isTitlePart = (part) => { const e = part?.obj && part.raw.entities[0]; return !!e && e.type === 'INSERT' && code(e.r, 2) === TITLE_NAME; };
/** The title block part of a layout, or undefined. */
export const titlePartOf = (lay) => Object.values(lay.parts).find((p) => isTitlePart(p) && lay.placed.some((q) => q.partId === p.id));

/** The layout's settings plus the title block's height: the strip a new nest keeps clear (grids skip only the block's box: apply.js gridArea). */
export const sheetArea = (lay) => ({ ...lay.s, titleH: titlePartOf(lay)?.h ?? 0 });

/** The ATTRIB values of an INSERT: { TAG: text }. */
export const titleTexts = (ent) => Object.fromEntries((ent.kids || []).map((k) => [code(k, 2), code(k, 1)]));

/** The same INSERT with its ATTRIBs set to `values` (TAG → text); the same object when nothing changes. */
export function withTitleValues(ent, values) {
  const kids = ent.kids.map((k) => {
    const tag = code(k, 2);
    if (!(tag in values) || code(k, 1) === values[tag]) return k;
    const v = k.v.slice(); v[k.c.indexOf(1)] = values[tag];
    return { ...k, v };
  });
  return kids.every((k, i) => k === ent.kids[i]) ? ent : { ...ent, kids };
}

/** The fields a reopened file reads back from the ATTRIBs: all but the date and file name, whose saved text is only yesterday's auto value. */
export const FROM_FILE = FIELDS.map((f) => f[1]).filter((k) => k !== 'date' && k !== 'file');

/** The settings after the block's ATTRIBs were edited (`keys`: the fields looked at): a value that differs from the auto one is typed, one that equals it is auto again. */
export function typedFromEnt(ent, auto, store, keys = FIELDS.map((f) => f[1])) {
  const out = { ...store }, texts = titleTexts(ent);
  for (const [tag, key] of FIELDS) {
    if (!(tag in texts) || !keys.includes(key)) continue;
    if (texts[tag] === (auto[key] ?? '')) delete out[key]; else out[key] = texts[tag];
  }
  return out;
}
