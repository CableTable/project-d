// apply.js — pure: builds the drawing that "Apply" in Step and repeat makes (no DOM, no files) — apply.test.mjs.
//
// The layout is a new document (dxf-write.js shape): the part as a block, one INSERT per position on layer "Parts",
// the sheet outline on "Sheet", crop / registration marks on "Marks". Units are mm; 0,0 is the sheet's bottom-left
// and y is up. layout.js works from the top-left with y down, so every y here is sheetH - y.
import { spaceOf } from './doc.js';
import { markGeometry } from './layout.js';
import { newDoc, addLayer, addBlock, addEntities, insert, rect, roundRect, line, circle } from './dxf-write.js';

export const LAYERS = { parts: 'Parts', sheet: 'Sheet', marks: 'Marks' };

/** A valid block name from a file or part name: no extension, none of  < > / \ " : ; ? * | , = `  and no spaces. */
export function blockName(fileName) {
  const base = String(fileName || '').replace(/\.[^.\\/]*$/, '').replace(/[<>/\\":;?*|,=`'\s\u0080-￿]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  return base || 'PART';
}

/**
 * The part an opened drawing is: { name, w, h } in mm from its extents, plus what Apply needs to copy it.
 * raw: readDxf's document; fl: flatten of it; factor: mm per drawing unit. null if the drawing has no extents.
 */
export function partFromDrawing(name, raw, fl, factor) {
  const sp = spaceOf(fl), box = fl.boxes && fl.boxes[sp ? 'paper' : 'model'];
  if (!box || !(box[2] > box[0]) || !(box[3] > box[1])) return null;
  return { name, raw, space: sp, factor, box, w: (box[2] - box[0]) * factor, h: (box[3] - box[1]) * factor };
}

/** Where each copy's INSERT goes, y up: [{ x, y, rot }]. A rotated copy is turned 90° clockwise, as the preview shows it. */
export function placements(L, sheetH) {
  return L.positions.map((p) => L.rotated ? { x: p.x, y: sheetH - p.y, rot: 270 } : { x: p.x, y: sheetH - p.y - L.partH, rot: 0 });
}

/**
 * The preview of each copy: a matrix [a, b, c, d, e, f] from the part's drawing units to sheet mm (y down), one per
 * position, the same placement as placements() (a rotated copy turned 90° clockwise about its corner).
 */
export function slotMats(part, L) {
  const f = part.factor || 1, [x0, y0] = part.box;
  return L.positions.map((p) => L.rotated
    ? [0, f, f, 0, p.x - y0 * f, p.y - x0 * f]
    : [f, 0, 0, -f, p.x - x0 * f, p.y + L.partH + y0 * f]);
}

/**
 * A placed part: { partId, x, y, rot, mirrorX, mirrorY }. x, y are mm on the sheet, y up, 0,0 at its bottom-left: where the
 * part's lower-left corner (its block's base point, the INSERT point) lands. rot is degrees anticlockwise, as in a DXF.
 * mirrorX flips the part left to right, mirrorY top to bottom (before it is turned). Mirroring is a negative scale on the INSERT.
 */
export const placement1 = (partId, x, y, rot = 0, mirrorX = false, mirrorY = false) => ({ partId, x, y, rot, mirrorX: !!mirrorX, mirrorY: !!mirrorY });

/** The matrix [a, b, c, d, e, f] from the part's drawing units to the sheet in mm, y down, for a placement (the preview's matrix). */
export function placedMat(part, pl, sheetH) {
  const f = part.factor || 1, [b0, b1] = part.box || [0, 0];
  const th = (pl.rot || 0) * Math.PI / 180, co = Math.cos(th), si = Math.sin(th);
  const sx = pl.mirrorX ? -1 : 1, sy = pl.mirrorY ? -1 : 1;
  const a = f * co * sx, b = -f * si * sx, c = -f * si * sy, d = -f * co * sy;
  return [a, b, c, d, pl.x - a * b0 - c * b1, sheetH - pl.y - b * b0 - d * b1];
}

/** The box a placed part covers on the sheet, [x0, y0, x1, y1] in mm, y up (the part's own box, mirrored and turned). */
export function placedBox(part, pl) {
  const f = part.factor || 1, w = part.w != null ? part.w : (part.box[2] - part.box[0]) * f, hgt = part.h != null ? part.h : (part.box[3] - part.box[1]) * f;
  const th = (pl.rot || 0) * Math.PI / 180, co = Math.cos(th), si = Math.sin(th), sx = pl.mirrorX ? -1 : 1, sy = pl.mirrorY ? -1 : 1;
  const xs = [], ys = [];
  for (const [u, v] of [[0, 0], [w, 0], [w, hgt], [0, hgt]]) { const p = u * sx, q = v * sy; xs.push(pl.x + co * p - si * q); ys.push(pl.y + si * p + co * q); }
  const r = (v) => Math.round(v * 1e9) / 1e9;
  return [r(Math.min(...xs)), r(Math.min(...ys)), r(Math.max(...xs)), r(Math.max(...ys))];
}

/** Where a stepRepeat result puts its copies, as placed parts of `partId`. */
export const gridPlacements = (L, sheetH, partId) => placements(L, sheetH).map((p) => placement1(partId, p.x, p.y, p.rot));

/** Blocks named in `map` renamed where the entities refer to them (INSERT and DIMENSION carry the name in group 2). */
function renameRefs(ents, map) {
  return ents.map((e) => {
    if (!e.r || (e.type !== 'INSERT' && e.type !== 'DIMENSION')) return e;
    const k = e.r.c.indexOf(2), nm = k < 0 ? null : String(e.r.v[k]).trim();
    if (nm == null || !map[nm]) return e;
    const v = e.r.v.slice(); v[k] = map[nm];
    return { ...e, r: { ...e.r, v } };
  });
}

/**
 * Adds a part's layers, line types and blocks to a document; a block whose name is taken by another part's is renamed.
 * Returns the part's own entities of the shown space, with their block references fixed.
 */
function mergePart(doc, part, origin) {
  const raw = part.raw;
  if (raw.header && raw.header.$LTSCALE != null && doc.header.$LTSCALE == null) doc.header.$LTSCALE = raw.header.$LTSCALE;
  const has = (o, n) => Object.keys(o).some((k) => k.toLowerCase() === n.toLowerCase());   // names ignore case
  for (const [n, l] of Object.entries(raw.layers || {})) if (!has(doc.layers, n)) doc.layers[n] = structuredClone(l);
  for (const [n, l] of Object.entries(raw.ltypes || {})) if (!has(doc.ltypes, n)) doc.ltypes[n] = structuredClone(l);
  for (const [n, s] of Object.entries(raw.styles || {})) if (!has(doc.styles ||= {}, n)) doc.styles[n] = structuredClone(s);
  for (const [n, s] of Object.entries(raw.dimstyles || {})) if (!has(doc.dimstyles ||= {}, n)) doc.dimstyles[n] = structuredClone(s);
  const map = {}, copied = [];
  for (const [n, b] of Object.entries(raw.blocks || {})) {
    if (!has(doc.blocks, n)) { doc.blocks[n] = structuredClone(b); origin.set(n, b); copied.push(n); continue; }
    if (origin.get(n) === b) continue;                               // the same block of the same drawing
    let k = 2; while (has(doc.blocks, n + '_' + k)) k++;
    map[n] = n + '_' + k; doc.blocks[map[n]] = structuredClone(b); origin.set(map[n], b); copied.push(map[n]);
  }
  const renamed = Object.keys(map).length > 0;
  if (renamed) for (const nm of copied) doc.blocks[nm].entities = renameRefs(doc.blocks[nm].entities, map);   // also the blocks copied under their own name
  const ents = raw.entities.filter((e) => (e.ps ? 1 : 0) === part.space).map((e) => ({ ...structuredClone(e), ps: false }));
  return renamed ? renameRefs(ents, map) : ents;
}

/**
 * The layout document of several different parts. o: { parts: { id: part }, placed: [placed part], sheetW, sheetH,
 * marks (markGeometry's result, sheet mm y down; none = no marks), keep: [part ids] written as blocks even if nothing is placed }.
 * A part is { name, w, h } (drawn as a rounded rectangle) or partFromDrawing's result (its entities are copied into its block).
 * One block per part used, one INSERT per placed part (rotation, and a negative scale for a mirror). → { doc, blockOf: { id: block name } }
 */
export function buildLayoutDoc({ parts, placed, sheetW, sheetH, marks, keep = [] }) {
  const doc = newDoc(4);
  doc.header.$MEASUREMENT = '1';
  addLayer(doc, LAYERS.parts, { aci: 5 });
  addLayer(doc, LAYERS.sheet, { aci: 8 });
  addLayer(doc, LAYERS.marks, { aci: 1 });
  const used = [...new Set([...placed.map((p) => p.partId), ...keep])].filter((id) => parts[id]);
  const origin = new Map(), blockOf = {}, own = {};
  // the parts' layers, line types and blocks first, so a part's own block name is checked against them
  for (const id of used) if (parts[id].raw) own[id] = mergePart(doc, parts[id], origin);
  const taken = new Set(Object.keys(doc.blocks).map((n) => n.toLowerCase()));
  for (const id of used) {
    const part = parts[id];
    let name = blockName(part.name), k = 1;
    while (taken.has(name.toLowerCase())) name = blockName(part.name) + '_' + (++k);
    taken.add(name.toLowerCase()); blockOf[id] = name;
    // the block's base is the extents' min corner, so an INSERT's point is the copy's corner
    if (part.raw) addBlock(doc, name, own[id], [part.box[0], part.box[1]]);
    else addBlock(doc, name, [roundRect(0, 0, part.w, part.h, 6)]);
  }
  const ins = placed.filter((p) => blockOf[p.partId]).map((p) => {
    const f = parts[p.partId].factor || 1, sx = (p.mirrorX ? -1 : 1) * f, sy = (p.mirrorY ? -1 : 1) * f;
    return insert(blockOf[p.partId], p.x, p.y, { layer: LAYERS.parts, rot: p.rot || 0, ...(sx !== 1 || sy !== 1 ? { sx, sy } : {}) });
  });
  addEntities(doc, rect(0, 0, sheetW, sheetH, { layer: LAYERS.sheet }), ins);
  if (marks) {
    const seg = ([x1, y1, x2, y2]) => line(x1, sheetH - y1, x2, sheetH - y2, { layer: LAYERS.marks });
    addEntities(doc, marks.crop.map(seg), marks.reg.flatMap((m) => [circle(m.cx, sheetH - m.cy, m.r, { layer: LAYERS.marks }), ...m.cross.map(seg)]));
  }
  return { doc, blockOf };
}

/**
 * The layout document of one part stepped over the sheet. o: { part, layout (a stepRepeat result for this part), sheetW, sheetH, crop, reg }.
 * part is { name, w, h } (drawn as a rounded rectangle) or partFromDrawing's result (its entities are copied into the block).
 */
export function buildLayout({ part, layout: L, sheetW, sheetH, crop = true, reg = true }) {
  return buildLayoutDoc({ parts: { p: part }, placed: gridPlacements(L, sheetH, 'p'), sheetW, sheetH, marks: markGeometry(L, { crop, reg }) }).doc;
}
