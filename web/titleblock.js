// titleblock.js — pure: the title block of a Layouts sheet (TODO 9a, titleblock.test.mjs).
// One block "PD_TITLE" (border, labels and one ATTDEF per field) inserted once per sheet, bottom-right, as a layout block object. Its ATTRIB
// values are what the file keeps. Typed values live in the tab's title block settings (pdf-export.js cleanTitleBlock): a field with none is auto.
import { entity, line, rect, text, insert } from './dxf-write.js';

export const TITLE_NAME = 'PD_TITLE';
export const TITLE_W = 150, TITLE_H = 44;
const CELL = 50, ROW = 11;
/** [tag, settings key, label, column, row (0 = top), columns spanned] */
export const FIELDS = [
  ['TITLE', 'title', 'Title', 0, 0, 2], ['DRAWING_NO', 'drawingNo', 'Drawing no.', 2, 0, 1],
  ['REV', 'rev', 'Rev', 0, 1, 1], ['SCALE', 'scale', 'Scale', 1, 1, 1], ['SHEET_SIZE', 'size', 'Sheet size', 2, 1, 1],
  ['DATE', 'date', 'Date', 0, 2, 1], ['DRAWN_BY', 'drawnBy', 'Drawn by', 1, 2, 1], ['MATERIAL', 'material', 'Material', 2, 2, 1],
  ['FILE', 'file', 'File', 0, 3, 3],
];
/** The settings keys the PDF strip does not have (the strip's own are pdf-export.js TITLE_FIELDS). */
export const SHEET_KEYS = ['title', 'drawingNo', 'rev', 'drawnBy', 'material'];

const code = (r, c) => String(r.v[r.c.indexOf(c)] ?? '');
const trim = (n) => String(Number(n.toFixed(2)));

/** The block's entities, in block coordinates (0,0 = its lower-left corner). */
export function titleBlockEntities() {
  const out = [rect(0, 0, TITLE_W, TITLE_H)];
  for (const y of [ROW, 2 * ROW, 3 * ROW]) out.push(line(0, y, TITLE_W, y));
  for (const x of [CELL, 2 * CELL]) out.push(line(x, ROW, x, 3 * ROW));
  out.push(line(2 * CELL, 3 * ROW, 2 * CELL, TITLE_H));
  for (const [tag, , label, c, r] of FIELDS) {
    const x = c * CELL + 1.5, y = (3 - r) * ROW;
    out.push(text(x, y + 7.5, 2, label), entity('ATTDEF', [[10, x], [20, y + 2], [30, 0], [40, 3.5], [1, ''], [3, label], [2, tag], [70, 0]]));
  }
  return out;
}

/** The auto values: the sheet's size, scale 1:1 (a sheet is drawn in true size), today's date and the file name. */
export const titleAuto = (lay, name, date) => ({ file: name || 'layout', scale: '1:1', size: `${trim(lay.s.sheetW)} x ${trim(lay.s.sheetH)} mm`, date: date || '' });

/** TAG → text: what is typed in `store`, else the auto value, else empty. */
export const titleValues = (store, auto) => Object.fromEntries(FIELDS.map(([tag, key]) => [tag, typeof store?.[key] === 'string' ? store[key] : auto[key] ?? '']));

/** The block reference at (x, y) with its ATTRIBs (their places are the drawing's own, as the reader draws them), or null when the sheet is too small. */
export function titleInsert(x, y, values) {
  const ent = insert(TITLE_NAME, x, y, { layer: '0' });
  ent.kids = FIELDS.map(([tag, , , c, r]) => entity('ATTRIB', [[10, x + c * CELL + 1.5], [20, y + (3 - r) * ROW + 2], [30, 0], [40, 3.5], [1, values[tag] ?? ''], [2, tag], [70, 0]]).r);
  return ent;
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
