// apply.js — pure: builds the drawing that "Apply" in Step and repeat makes (no DOM, no files) — apply.test.mjs.
//
// The layout is a new document (dxf-write.js shape): the part as a block, one INSERT per position on layer "Parts",
// the sheet outline on "Sheet", crop / registration marks on "Marks". Units are mm; 0,0 is the sheet's bottom-left
// and y is up. layout.js works from the top-left with y down, so every y here is sheetH - y.
import { spaceOf, startHidden, itemVisible } from './doc.js';
import { polylines } from './compare.js';
import { hull as convexHull } from './nestshape.js';
import { baseName } from './savepath.js';
import { markGeometry, stepRepeat, usableArea } from './layout.js';
import { titlePartOf } from './titleblock.js';
import { newDoc, addLayer, addBlock, addEntities, insert, rect, roundRect, line, circle } from './dxf-write.js';

export const LAYERS = { parts: 'Parts', sheet: 'Sheet', marks: 'Marks' };

/** A valid block name from a file or part name: no known extension, none of  < > / \ " : ; ? * | , = `  and no spaces. */
export function blockName(fileName) {
  const base = baseName(String(fileName || '')).replace(/[<>/\\":;?*|,=`'\s\u0080-￿]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  return base || 'PART';
}

/**
 * The part an opened drawing is: { name, w, h } in mm from its extents, plus what Apply needs to copy it.
 * raw: readDxf's document; fl: flatten of it; factor: mm per drawing unit. null if the drawing has no extents.
 */
export function partFromDrawing(name, raw, fl, factor) {
  const sp = spaceOf(fl), box = fl.boxes && fl.boxes[sp ? 'paper' : 'model'];
  if (!box || !(box[2] > box[0]) || !(box[3] > box[1])) return null;
  return { name, raw, space: sp, factor, box, w: (box[2] - box[0]) * factor, h: (box[3] - box[1]) * factor, hull: hullOf(fl, sp, factor || 1) };
}

/**
 * The convex hull of everything the part draws, in drawing units ([[x, y], …], kept in memory only: place.js offSheet / inGripper map it
 * through placedMat). Paths are sampled (arcs to 0.01 mm); text, hatches, pictures and paper-space viewports count by their box corners.
 * An empty list (nothing to test) makes callers use the box.
 */
function hullOf(fl, space, factor) {
  const hidden = startHidden(fl), pts = [];
  // sampled in mm (so the 0.01 mm sag is true mm whatever the unit), then back to drawing units
  for (const q of polylines({ ...fl, items: fl.items.filter((it) => it.k === 'p').map((it) => it.fill ? { ...it, fill: 0 } : it) }, factor, hidden).polys) for (let i = 0; i < q.length; i += 2) pts.push([q[i] / factor, q[i + 1] / factor]);
  for (const it of fl.items) if (it.k !== 'p' && (it.ps ? 1 : 0) === space && itemVisible(it, hidden)) pts.push([it.b[0], it.b[1]], [it.b[2], it.b[1]], [it.b[2], it.b[3]], [it.b[0], it.b[3]]);
  if (space) for (const v of fl.vports) pts.push([v.cx - v.w / 2, v.cy - v.h / 2], [v.cx + v.w / 2, v.cy - v.h / 2], [v.cx + v.w / 2, v.cy + v.h / 2], [v.cx - v.w / 2, v.cy + v.h / 2]);
  return convexHull(pts);
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
  const k = pl.sc || 1, sx = (pl.mirrorX ? -1 : 1) * k, sy = (pl.mirrorY ? -1 : 1) * k;
  const a = f * co * sx, b = -f * si * sx, c = -f * si * sy, d = -f * co * sy;
  return [a, b, c, d, pl.x - a * b0 - c * b1, sheetH - pl.y - b * b0 - d * b1];
}

/** The box a placed part covers on the sheet, [x0, y0, x1, y1] in mm, y up (the part's own box, mirrored and turned). */
export function placedBox(part, pl) {
  const f = part.factor || 1, w = part.w != null ? part.w : (part.box[2] - part.box[0]) * f, hgt = part.h != null ? part.h : (part.box[3] - part.box[1]) * f;
  const th = (pl.rot || 0) * Math.PI / 180, co = Math.cos(th), si = Math.sin(th), k = pl.sc || 1, sx = (pl.mirrorX ? -1 : 1) * k, sy = (pl.mirrorY ? -1 : 1) * k;
  const xs = [], ys = [];
  for (const [u, v] of [[0, 0], [w, 0], [w, hgt], [0, hgt]]) { const p = u * sx, q = v * sy; xs.push(pl.x + co * p - si * q); ys.push(pl.y + si * p + co * q); }
  const r = (v) => Math.round(v * 1e9) / 1e9;
  return [r(Math.min(...xs)), r(Math.min(...ys)), r(Math.max(...xs)), r(Math.max(...ys))];
}

/** Where a stepRepeat result puts its copies, as placed parts of `partId`. */
export const gridPlacements = (L, sheetH, partId) => placements(L, sheetH).map((p) => placement1(partId, p.x, p.y, p.rot));

// ---- applied grids (TODO 283): the copies Apply makes keep a grid id (placement.gid); lay.grids[gid] holds that grid's settings and
// its slots ({ x, y, rot, r, c }: where each copy was laid, row r from the top, column c from the left), so "Update grid" can lay them again.
/** The step-and-repeat settings the panel shows and edits for an applied grid. */
export const GRID_KEYS = ['gridPart', 'fit', 'rows', 'cols', 'gapX', 'gapY', 'rotate', 'align', 'extraRows', 'extraCols'];

/** The grid a grid record G makes on the layout's sheet (a stepRepeat result; count 0 when its part is gone). Parts on the sheet do not anchor it: only G.at, the top-left saved at Apply by an anchored grid. */
export function gridLayout(lay, G) {
  const p = lay.parts[G.gridPart];
  return stepRepeat({ ...gridArea(lay), ...G, partW: p ? p.w : 0, partH: p ? p.h : 0 });
}

const same = (a, b) => Math.abs(a - b) < 1e-6;
const turn = (r) => ((r || 0) % 360 + 360) % 360;
/** What decides where an applied grid's copies sit: its settings (GRID_KEYS) and the sheet's usable area. Equal to G.sig = nothing to lay again. */
export const gridSig = (lay, G) => JSON.stringify([...GRID_KEYS.map((k) => G[k]), usableArea(lay.s), gridArea(lay).occupied]);

/** The layout's settings plus the sheet's title block as an obstacle (sheet mm, y down): cells it covers are skipped, the rest of the sheet stays usable. */
export function gridArea(lay) {
  const t = titlePartOf(lay), pl = t && lay.placed.find((q) => q.partId === t.id), H = lay.s.sheetH;
  if (!pl) return { ...lay.s, occupied: [] };
  const [x0, y0, x1, y1] = placedBox(t, pl);
  return { ...lay.s, occupied: [[x0, H - y1, x1, H - y0]] };
}

/**
 * Records an applied grid and adds its copies to lay.placed, each with `gid`. copies: placements in the grid's order (L.positions);
 * L: the live grid (stepRepeat result) they came from; s: the layout settings at that moment (lay.s).
 * slots: one per cell of the grid, numbered by its true row (from the top) and column (from the left); a cell the live grid skipped
 * (a part in the way, taken by an existing copy) is an empty slot { r, c }, which Update grid never fills.
 */
export function bakeGrid(lay, gid, copies, L, s = lay.s) {
  const slots = copies.map((p, i) => ({ x: p.x, y: p.y, rot: p.rot, r: L.cells[i][0], c: L.cells[i][1] })), have = new Set(slots.map((q) => q.r + ',' + q.c));
  for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) if (!have.has(r + ',' + c)) slots.push({ r, c });
  lay.grids = lay.grids || {};
  const G = lay.grids[gid] = {
    ...Object.fromEntries(GRID_KEYS.map((k) => [k, s[k]])), rows: L.rows, cols: L.cols,
    extraRows: s.extraRows.map((e) => ({ ...e })), extraCols: s.extraCols.map((e) => ({ ...e })), slots,
    ...(L.anchor ? { at: L.anchor } : {}),
  };
  G.sig = gridSig(lay, G);
  for (const p of copies) lay.placed.push({ ...p, gid });
}

const plain = (p) => !p.mirrorX && !p.mirrorY && !(p.sc && p.sc !== 1) && !p.lock;       // a copy not turned into something else by hand
const posKey = (o) => Math.round(o.x * 1e5) + ',' + Math.round(o.y * 1e5) + ',' + turn(o.rot);
const slotMaps = new WeakMap();      // slots array → { position key → slot index }; relayGrid replaces G.slots, so a new array has a new map
function slotAt(G) {
  let m = slotMaps.get(G.slots);
  if (!m) { m = new Map(); G.slots.forEach((s, k) => { if (s.x != null && !m.has(posKey(s))) m.set(posKey(s), k); }); slotMaps.set(G.slots, m); }
  return m;
}

/** The index in its grid's slots of the slot a placement still sits on (not moved, turned, mirrored or scaled; the first one there owns it), or -1. */
export function slotOf(lay, p) {
  const G = p && p.gid && lay.grids && lay.grids[p.gid];
  if (!G || !plain(p)) return -1;
  const k = slotAt(G).get(posKey(p));
  if (k == null) return -1;
  for (const q of lay.placed) {
    if (q === p) return k;
    if (q.gid === p.gid && plain(q) && same(q.x, p.x) && same(q.y, p.y) && turn(q.rot) === turn(p.rot)) return -1;       // an earlier copy owns the slot
  }
  return -1;
}

/**
 * Lays an applied grid again from its settings (lay.grids[gid]). Nothing changed since it was applied (or last laid) = nothing moves.
 * Otherwise the copies still on their slots move to the new slot with the same row and column, a cell the grid did not have before gets
 * a new copy (unless another placed part is in the way), copies past the new rows / columns go, a slot that was empty stays empty,
 * and a copy that left its slot (moved, turned, locked) stays where it is. The placement objects are changed in place.
 * → { moved, added, dropped } or null when nothing fits (then nothing is changed).
 */
export function relayGrid(lay, gid) {
  const G = lay.grids && lay.grids[gid], L = G && gridLayout(lay, G);
  if (!L || !L.count) return null;
  const out = { moved: 0, added: 0, dropped: 0 }, sig = gridSig(lay, G);
  if (G.sig === sig) return out;
  const at = slotAt(G), alive = new Map();                       // slot index → the copy on it (the first one there)
  for (const p of lay.placed) if (p.gid === gid && plain(p)) { const k = at.get(posKey(p)); if (k != null && !alive.has(k)) alive.set(k, p); }
  const mine = new Set(alive.values()), H = lay.s.sheetH, pw = L.partW, ph = L.partH;
  const others = lay.placed.filter((p) => !mine.has(p) && lay.parts[p.partId] && !lay.parts[p.partId].obj).map((p) => {
    const [x0, y0, x1, y1] = placedBox(lay.parts[p.partId], p);
    return [x0, H - y1, x1, H - y0];
  });                                                            // sheet mm, y down, as stepRepeat's
  const blocked = (x, y) => others.some((b) => x < b[2] - 1e-9 && x + pw > b[0] + 1e-9 && y < b[3] - 1e-9 && y + ph > b[1] + 1e-9);
  const old = new Map(G.slots.map((s, k) => [s.r + ',' + s.c, k])), spots = gridPlacements(L, H, G.gridPart), slots = [], fresh = [];
  spots.forEach((sp, i) => {
    const [r, c] = L.cells[i], k = old.get(r + ',' + c), p = k != null && alive.get(k), slot = { x: sp.x, y: sp.y, rot: sp.rot, r, c };
    if (p) { Object.assign(p, { partId: G.gridPart, x: sp.x, y: sp.y, rot: sp.rot }); alive.delete(k); out.moved++; slots.push(slot); }
    else if (k != null) slots.push(G.slots[k].x == null ? { r, c } : slot);     // a slot that was empty stays empty; a copy gone from its slot is not put back
    else if (blocked(L.positions[i].x, L.positions[i].y)) slots.push({ r, c });
    else { fresh.push({ ...placement1(G.gridPart, sp.x, sp.y, sp.rot), gid }); out.added++; slots.push(slot); }
  });
  const gone = new Set(alive.values());
  out.dropped = gone.size;
  lay.placed = lay.placed.filter((p) => !gone.has(p)).concat(fresh);
  G.slots = slots; G.sig = sig;
  return out;
}

/** Blocks named in `map` renamed where the entities refer to them (INSERT and DIMENSION carry the name in group 2). */
function renameRefs(ents, map0) {
  const map = new Map(Object.entries(map0).map(([k, v]) => [k.toLowerCase(), v]));   // block names ignore case; a Map: `constructor` is no key
  return ents.map((e) => {
    if (!e.r || (e.type !== 'INSERT' && e.type !== 'DIMENSION')) return e;
    const k = e.r.c.indexOf(2), nm = k < 0 ? null : String(e.r.v[k]).trim();
    if (nm == null || !map.get(nm.toLowerCase())) return e;
    const v = e.r.v.slice(); v[k] = map.get(nm.toLowerCase());
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
  const map = Object.create(null), copied = [];       // no prototype: a block named `__proto__` is a key
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
 * marks (markGeometry's result, sheet mm y down; none = no marks), keep: [part ids] written as blocks even if nothing is placed, sheet: draw the sheet rectangle (default true) }.
 * A part is { name, w, h } (drawn as a rounded rectangle) or partFromDrawing's result (its entities are copied into its block).
 * One block per part used, one INSERT per placed part (rotation, and a negative scale for a mirror). → { doc, blockOf: { id: block name } }
 */
export function buildLayoutDoc({ parts, placed, sheetW, sheetH, marks, keep = [], sheet = true }) {
  const doc = newDoc(4);
  doc.blocks = Object.create(null);       // a part's block named `__proto__` is a key here, not the prototype
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
    const f = parts[p.partId].factor || 1, k = p.sc || 1, sx = (p.mirrorX ? -1 : 1) * f * k, sy = (p.mirrorY ? -1 : 1) * f * k;
    return insert(blockOf[p.partId], p.x, p.y, { layer: LAYERS.parts, rot: p.rot || 0, ...(sx !== 1 || sy !== 1 ? { sx, sy } : {}) });
  });
  addEntities(doc, sheet ? rect(0, 0, sheetW, sheetH, { layer: LAYERS.sheet }) : [], ins);
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
