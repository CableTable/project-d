// layoutdoc.js — pure: the layout (its own tab), its parts, and how it is kept in a .dxf (no DOM, no files) — layoutdoc.test.mjs.
//
// A layout is  { name, s, parts, placed }:
//   s       the sheet and step-and-repeat settings (DEFAULTS): size, grippers, marks, gaps, extra gaps, rotate, align,
//           Fit to sheet / rows / columns, and gridPart (the id of the part the step-and-repeat grid is made of; null = no grid)
//   parts   { id: part } — every part the layout uses; a part is apply.js partFromDrawing's result plus id and fl (what is drawn)
//   placed  [{ partId, x, y, rot, mirrorX, mirrorY }] — parts placed one by one (sheet mm, y up, 0,0 at the bottom-left; see apply.js)
// The grid is not stored: it is worked out from s and the grid part, so it is always what the panel says. The placed parts
// of the layout, all together, are placedAll(): the grid's copies first (src 'grid'), then s.placed (src 'loose', i = its index).
//
// In the file: the sheet outline on "Sheet", the parts on "Parts" (one block per part, one INSERT per placed part, a mirror is
// a negative scale), marks on "Marks" — what any CAD app shows. The settings and the placed parts also travel in a block named
// PD_LAYOUT that nothing inserts: a few TEXT entities, each holding up to 200 characters of base64 of a JSON text. Other CAD
// apps ignore (or at most list) an unused block; our reader (drawing.js readDxf) keeps it, and layoutFromRaw() reads it back.
import { readDxf, flatten } from './drawing.js';
import { writeDxf, text as dxfText, addBlock } from './dxf-write.js';
import { unitFactor, startHidden } from './doc.js';
import { stepRepeat, markGeometry } from './layout.js';
import { buildLayoutDoc, gridPlacements, placedBox, partFromDrawing, placement1 } from './apply.js';
import { keepOnly, DIM_LAYER } from './edit.js';
import { cleanGuides } from './guides.js';
import { TITLE_BLOCK } from './pdf-export.js';
import { colourKey, withColour } from './props.js';

export const LAYOUT_BLOCK = 'PD_LAYOUT';
const CHUNK = 200;

export const DEFAULTS = Object.freeze({
  sheetW: 1000, sheetH: 700, gripTop: 0, gripRight: 0, gripBottom: 30, gripLeft: 0,
  crop: false, reg: false, gapX: 5, gapY: 5, rotate: '0', align: 'centre',
  fit: true, rows: 1, cols: 1, extraRows: [], extraCols: [], gridPart: null,
  guides: [], guidesShow: true, guidesLock: false,       // guidelines (guides.js): per layout, saved with it
});
export const SETTING_KEYS = Object.keys(DEFAULTS);

/** A fresh settings object (its lists are its own). */
export const newSettings = (over = {}) => ({ ...DEFAULTS, extraRows: [], extraCols: [], guides: [], ...over });

/** An empty layout. */
export const newLayout = (name) => ({ name, s: newSettings(), parts: {}, placed: [] });

// ---------------------------------------------------------------- parts

/** Parts offered for placing or the library; linked contours stay with their source part. */
export function partsForPlacement(lay) {
  const ctParts = new Set(lay.placed.filter((q) => q.ct).map((q) => q.partId));
  return Object.values(lay.parts).filter((p) => !ctParts.has(p.id));
}

/** A part keeps drawing blocks, never the source file's PDF title settings. */
export const partBlocks = (blocks) => Object.fromEntries(Object.entries(blocks).filter(([name]) => name !== TITLE_BLOCK));

/** A part from a drawing's document: { id, name, raw, space, factor, box, w, h, fl, off (the layers its file has switched off) }, or null when it has no extents. */
export function makePart(id, name, raw, factor, src = '') {
  const fl = flatten(raw), p = partFromDrawing(name, raw, fl, factor || unitFactor(fl.units));
  return p && { id, ...p, fl, off: startHidden(fl), src };
}

/** A private coloured copy for selected placements; the source and library part stay intact. */
export function withPartColour(part, key, id) {
  if (!part.raw) return null;
  const blocks = Object.values(part.raw.blocks || {});
  if ([...part.raw.entities, ...blocks.flatMap((b) => b.entities)].every((e) => colourKey(e) === key)) return null;
  const colour = (ents) => ents.map((e) => withColour(e, key));
  const raw = { ...part.raw, entities: colour(part.raw.entities), blocks: Object.fromEntries(Object.entries(part.raw.blocks || {}).map(([name, b]) =>
    [name, { ...b, entities: colour(b.entities) }])) };
  return { ...part, id, raw, fl: flatten(raw) };
}

/**
 * The document of a part cut from a drawing: the entities in `sel` (a Set of indexes; null = all) without the ones on the
 * layer "Dimensions" (kept dimensions are not part of a part and never count toward its size), with the blocks they use.
 * Null when nothing is left.
 */
export function extractRaw(raw, sel) {
  const keep = new Set();
  raw.entities.forEach((e, i) => { if ((!sel || sel.has(i)) && e.layer !== DIM_LAYER) keep.add(i); });
  if (!keep.size) return null;
  const { entities, blocks } = keepOnly(raw, keep);
  return { header: { ...raw.header }, layers: raw.layers, ltypes: raw.ltypes, blocks: partBlocks(blocks), entities };
}

/** A part as a DXF text (the library keeps this). */
export const partToDxf = (part) => writeDxf(part.raw, { escapeUnicode: true });

/** A part from a DXF text (as partToDxf wrote it), or null if it has no extents or cannot be read. */
export function partFromDxf(id, name, text) {
  try { return makePart(id, name, readDxf(text)); } catch { return null; }
}

/** The first "<base> 1", "<base> 2", … not in `taken` (compared without case). */
export function nextName(base, taken) {
  const t = new Set([...taken].map((n) => String(n).toLowerCase()));
  let n = 1;
  while (t.has((base + ' ' + n).toLowerCase())) n++;
  return base + ' ' + n;
}

// ---------------------------------------------------------------- the layout's placed parts

/** The grid of the layout's step-and-repeat part (a stepRepeat result), or null when no part is picked. */
export function gridOf(lay) {
  const p = lay.s.gridPart && lay.parts[lay.s.gridPart];
  const placed = lay.placed.filter((pl) => lay.parts[pl.partId]).map((pl) => {
    const [x0, y0, x1, y1] = boxOfPlaced(lay, pl);
    return { ...pl, box: [x0, lay.s.sheetH - y1, x1, lay.s.sheetH - y0] };
  });
  return p ? stepRepeat({ ...lay.s, partW: p.w, partH: p.h, placed }) : null;
}

/** Every placed part: the grid's copies, then the loose ones — [{ partId, x, y, rot, mirrorX, mirrorY, src, i }]. */
export function placedAll(lay, L = gridOf(lay)) {
  const out = [];
  if (L && L.count) gridPlacements(L, lay.s.sheetH, lay.s.gridPart).forEach((p, i) => out.push({ ...p, src: 'grid', i }));
  lay.placed.forEach((p, i) => { if (lay.parts[p.partId]) out.push({ ...p, src: 'loose', i }); });
  return out;
}

/** Placed parts per part id: { id: count }. */
export function usesOf(list) {
  const n = {};
  for (const p of list) n[p.partId] = (n[p.partId] || 0) + 1;
  return n;
}

/** The ids of the parts the layout uses (placed, or the grid's): the others are not written to the file. */
export const usedIds = (lay) => [...new Set([...(lay.s.gridPart ? [lay.s.gridPart] : []), ...lay.placed.map((p) => p.partId)])].filter((id) => lay.parts[id]);

/** The box [x0, y0, x1, y1] (mm, y up) of a placed part on the sheet. */
export const boxOfPlaced = (lay, p) => placedBox(lay.parts[p.partId], p);

/** Crop and registration marks round everything placed (markGeometry of the box that holds it; y down, as the preview draws them). */
export function marksOf(lay, list) {
  const { sheetH, crop, reg } = lay.s;
  if (!list.length) return markGeometry({ count: 0 }, { crop, reg });
  const b = list.map((p) => boxOfPlaced(lay, p));
  const x0 = Math.min(...b.map((v) => v[0])), x1 = Math.max(...b.map((v) => v[2])), yUp0 = Math.min(...b.map((v) => v[1])), yUp1 = Math.max(...b.map((v) => v[3]));
  return markGeometry({ count: list.length, x0, y0: sheetH - yUp1, gridW: x1 - x0, gridH: yUp1 - yUp0 }, { crop, reg });
}

// ---------------------------------------------------------------- into a file

const ascii = (s) => s.replace(/[^\u0000-\u007f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const enc = (obj) => btoa(ascii(JSON.stringify(obj)));
const dec = (b64) => JSON.parse(atob(b64));

/** The settings and placed parts as the hidden block's TEXT entities. */
function metaEntities(lay, blockOf, ids) {
  const meta = {
    v: 1, app: 'Project D', name: lay.name, s: lay.s,
    parts: ids.map((id) => { const p = lay.parts[id]; return { id, name: p.name, block: blockOf[id], factor: p.factor || 1, w: p.w, h: p.h, src: p.src || '' }; }),
    placed: lay.placed.filter((p) => ids.includes(p.partId)),
  };
  const b = enc(meta), out = [];
  for (let i = 0; i < b.length; i += CHUNK) out.push(dxfText(0, 0, 1, b.slice(i, i + CHUNK), { layer: '0' }));
  return out;
}

/** The layout as a DXF document (writeDxf's shape): everything a CAD app shows, plus the hidden PD_LAYOUT block. */
export function layoutRaw(lay) {
  const list = placedAll(lay), ids = usedIds(lay);
  const { doc, blockOf } = buildLayoutDoc({ parts: lay.parts, placed: list, sheetW: lay.s.sheetW, sheetH: lay.s.sheetH, marks: marksOf(lay, list), keep: ids });
  addBlock(doc, LAYOUT_BLOCK, metaEntities(lay, blockOf, ids));
  return doc;
}

// ---------------------------------------------------------------- out of a file

const num = (v, d, min = -Infinity) => (Number.isFinite(+v) && v !== '' && v !== null && +v >= min ? +v : d);
const gaps = (list) => (Array.isArray(list) ? list.filter((e) => e && e.after >= 1 && e.mm > 0).map((e) => ({ after: Math.floor(e.after), mm: +e.mm })) : []);
/** Settings read from a file: anything missing or odd falls back to the default. */
export function cleanSettings(s = {}) {
  const d = DEFAULTS;
  return {
    sheetW: num(s.sheetW, d.sheetW, 1), sheetH: num(s.sheetH, d.sheetH, 1),
    gripTop: num(s.gripTop, 0, 0), gripRight: num(s.gripRight, 0, 0), gripBottom: num(s.gripBottom, 0, 0), gripLeft: num(s.gripLeft, 0, 0),
    crop: s.crop === true, reg: s.reg === true, gapX: num(s.gapX, d.gapX, 0), gapY: num(s.gapY, d.gapY, 0),
    rotate: ['best', '0', '90'].includes(String(s.rotate)) ? String(s.rotate) : '0', align: s.align === 'topleft' ? 'topleft' : 'centre',
    fit: s.fit !== false, rows: Math.max(1, Math.floor(num(s.rows, 1))), cols: Math.max(1, Math.floor(num(s.cols, 1))),
    extraRows: gaps(s.extraRows), extraCols: gaps(s.extraCols), gridPart: typeof s.gridPart === 'string' ? s.gridPart : null,
    guides: cleanGuides(s.guides), guidesShow: s.guidesShow !== false, guidesLock: s.guidesLock === true,
  };
}

const refs = (ents) => ents.filter((e) => (e.type === 'INSERT' || e.type === 'DIMENSION' || e.type === 'ACAD_TABLE') && e.r).map((e) => String(e.r.v[e.r.c.indexOf(2)] || '').trim());
/** The blocks a list of entities uses, and the blocks those use, as { name: block }. */
export function blocksUsed(blocks, ents) {
  const out = {}, todo = refs(ents);
  while (todo.length) {
    const n = todo.pop();
    if (out[n] || !blocks[n]) continue;
    out[n] = blocks[n]; todo.push(...refs(blocks[n].entities || []));
  }
  return out;
}

/** The settings text of a document: the hidden block's TEXT joined and decoded, or null. */
export function readMeta(raw) {
  const blk = raw.blocks && raw.blocks[LAYOUT_BLOCK];
  if (!blk) return null;
  try {
    const b64 = blk.entities.filter((e) => e.type === 'TEXT' && e.r).map((e) => String(e.r.v[e.r.c.indexOf(1)] ?? '').trim()).join('');
    const m = dec(b64);
    return m && m.v === 1 && Array.isArray(m.parts) ? m : null;
  } catch { return null; }
}

/** The layout a document holds (what layoutRaw wrote, possibly saved by another app and back), or null if it is not one of ours. */
export function layoutFromRaw(raw, name) {
  const m = readMeta(raw);
  if (!m) return null;
  const lay = { name: name || m.name || 'Layout', s: cleanSettings(m.s), parts: {}, placed: [] };
  for (const pm of m.parts) {
    const blk = raw.blocks[pm.block];
    if (!blk || typeof pm.id !== 'string') continue;
    const ents = blk.entities.map((e) => ({ ...e, ps: false }));
    const part = makePart(pm.id, String(pm.name || pm.block), { header: { ...raw.header }, layers: raw.layers, ltypes: raw.ltypes, blocks: blocksUsed(raw.blocks, ents), entities: ents }, num(pm.factor, 1, 1e-9), String(pm.src || ''));
    if (part) lay.parts[pm.id] = part;
  }
  lay.placed = (Array.isArray(m.placed) ? m.placed : []).filter((p) => p && lay.parts[p.partId] && Number.isFinite(+p.x) && Number.isFinite(+p.y))
    .map((p) => ({ ...placement1(p.partId, +p.x, +p.y, num(p.rot, 0), p.mirrorX, p.mirrorY), ...(typeof p.g === 'string' && p.g ? { g: p.g } : {}), ...(p.lock === true ? { lock: true } : {}), ...(num(p.sc, 1, 1e-6) !== 1 ? { sc: num(p.sc, 1, 1e-6) } : {}),
      ...(typeof p.cid === 'string' && p.cid ? { cid: p.cid } : {}), ...(typeof p.ct === 'string' && p.ct ? { ct: p.ct } : {}) }));   // cid: a part that has a contour; ct: the contour of the part with that cid (layoutcontour.js)
  if (lay.s.gridPart && !lay.parts[lay.s.gridPart]) lay.s.gridPart = null;
  return lay;
}
