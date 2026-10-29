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
import { writeDxf, text as dxfText, addBlock, addEntities, newDoc, insert } from './dxf-write.js';
import { explodeInsert, explodeDimension } from './explode.js';
import { unitFactor, startHidden } from './doc.js';
import { stepRepeat, markGeometry } from './layout.js';
import { buildLayoutDoc, gridPlacements, placedBox, partFromDrawing, placement1 } from './apply.js';
import { keepOnly, DIM_LAYER, DIM_BLOCK, dimTag } from './edit.js';
import { followDimensions } from './linked-dimensions.js';
import { isDimPart, dimName, isSettled, bakeBlock, turnedTag, freeBlockName } from './layoutdim.js';
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

// ---------------------------------------------------------------- layout objects
// A layout object (a line, circle… drawn on the sheet) is held as a part with part.obj = true: one entity, in sheet mm, placed at its
// own extents' corner. So select, snap, Move / Copy / Rotate / Scale / Mirror / Array, paint and Undo are the placed parts' code.
// In the file it is a plain entity on its layer (the placement is baked in with Explode's maths); Sheet, Marks and Parts are ours.

export const RESERVED_LAYERS = ['Sheet', 'Marks', 'Parts'];
export const isReserved = (name) => RESERVED_LAYERS.some((n) => n.toLowerCase() === String(name).toLowerCase());
/** The layers of the layout's objects (a raw layer table: name → def); an old layout has just "0". */
export function layersOf(lay) {
  if (!lay.layers) lay.layers = newDoc(4).layers;
  return lay.layers;
}
/** A layout object from one entity (sheet mm; `layers` is the layer table; `blocks`: the one a dimension's INSERT names), or null when it has no extents. */
export function objectPart(id, name, ent, layers, header = {}, blocks = {}) {
  const raw = { header: { ...header }, layers, ltypes: {}, blocks, entities: [{ ...ent, ps: false }] };
  const fl = flatten(raw), box = fl.boxes && fl.boxes.model;
  if (!box || !(box[2] >= box[0]) || !(box[3] >= box[1])) return null;
  return { id, name, raw, space: 0, factor: 1, box, w: box[2] - box[0], h: box[3] - box[1], fl, off: startHidden(fl), src: '', obj: true };
}
/** A new object's placement: its extents' lower-left corner is where the entity already is. */
export const objectPlacement = (part) => placement1(part.id, part.box[0], part.box[1]);
/** A placed object as plain entities (its placement baked in), or null when Explode cannot carry that kind (it is then kept as a block). */
function bakeObject(part, p) {
  if (isDimPart(part)) return isSettled(part, p) ? [part.raw.entities[0]] : null;       // a dimension is settled (settleDims) before it is baked
  const e = part.raw.entities[0], mini = newDoc(4), k = p.sc || 1, sx = (p.mirrorX ? -1 : 1) * k, sy = (p.mirrorY ? -1 : 1) * k;
  mini.layers = part.raw.layers;
  addBlock(mini, 'O', [e], [part.box[0], part.box[1]]);
  try { return explodeInsert(insert('O', p.x, p.y, { layer: e.layer, rot: p.rot || 0, ...(sx !== 1 || sy !== 1 ? { sx, sy } : {}) }), mini).entities; } catch { return null; }
}

// Trim / Extend / Fillet / Offset on layout objects run the drawing tab's code on objectDoc(): the objects as one little drawing (sheet mm,
// one entity per placed object); what they leave is objectCommit()ed back as objects. Placed parts are not in it.
const bakedCache = new WeakMap();      // part → Map(placement key → entity): the same entity each time, so a command can hold on to it between two steps
const bakeKey = (p) => [p.x, p.y, p.rot || 0, p.sc || 1, p.mirrorX ? 1 : 0, p.mirrorY ? 1 : 0].join('|');
function bakedEntity(part, p) {
  let byKey = bakedCache.get(part);
  if (!byKey) bakedCache.set(part, byKey = new Map());
  const key = bakeKey(p);
  if (!byKey.has(key)) { const ents = bakeObject(part, p); byKey.set(key, ents && ents.length === 1 && !isDimPart(part) ? { ...ents[0], ps: false } : null); }       // (a dimension is not in the objects' drawing)
  return byKey.get(key);
}
/** What objectDoc() would be made of, as text: when it is the same, so is the drawing (and the entities in it). `skip(partId)` leaves an object out (hidden). */
export const objectSig = (lay, skip) => lay.placed.map((p) => { const part = lay.parts[p.partId]; return part && part.obj && !skip(p.partId) ? `${p.partId}|${bakeKey(p)}${p.lock ? 'L' : ''}` : '-'; }).join(';');
/** The layout's objects as a drawing: { raw, fl, off, at (entity → its index in lay.placed), lockedEnts }. An object Explode cannot carry is left out. */
export function objectDoc(lay, skip = () => false) {
  const entities = [], at = new Map(), lockedEnts = new Set();
  lay.placed.forEach((p, i) => {
    const part = lay.parts[p.partId];
    let ent = part && part.obj && !skip(p.partId) ? bakedEntity(part, p) : null;
    if (!ent) return;
    if (at.has(ent)) ent = { ...ent };            // an exact copy on top of it: an entity of its own
    entities.push(ent); at.set(ent, i);
    if (p.lock) lockedEnts.add(ent);
  });
  const raw = { header: {}, layers: layersOf(lay), ltypes: {}, blocks: {}, entities }, fl = flatten(raw);
  return { raw, fl, off: startHidden(fl), at, lockedEnts };
}
const OBJ_NAMES = { LINE: 'Line', ARC: 'Arc', CIRCLE: 'Circle', LWPOLYLINE: 'Polyline', POLYLINE: 'Polyline', ELLIPSE: 'Ellipse', SPLINE: 'Spline', SOLID: 'Solid', MTEXT: 'Text' };
/** What a command left of objectDoc(lay) (`entities`): objects whose entity is gone are removed (and their part, if nothing else is placed from it), each new entity becomes an object. */
export function objectCommit(lay, view, entities, newId) {
  const have = new Set(entities), gone = new Set(), layers = layersOf(lay);
  for (const [e, i] of view.at) if (!have.has(e)) gone.add(i);
  const fresh = entities.filter((e) => !view.at.has(e)), oneAt = gone.size === 1 && fresh.length === 1 ? [...gone][0] : -1, one = lay.placed[oneAt];       // one object replaced by one piece (a trim): it keeps its slot, group, lock and name
  const oneName = one && lay.parts[one.partId]?.name;
  lay.placed = lay.placed.filter((_, i) => !gone.has(i));
  const used = new Set(lay.placed.map((p) => p.partId));
  for (const [id, part] of Object.entries(lay.parts)) if (part.obj && !used.has(id)) delete lay.parts[id];
  const names = new Set(Object.values(lay.parts).map((p) => p.name));
  for (const e of entities) {
    if (view.at.has(e)) continue;
    e.ps = false;
    const part = objectPart(newId(), one && oneName && !names.has(oneName) ? oneName : nextName(OBJ_NAMES[e.type] || 'Object', names), e, layers), pl = part && objectPlacement(part);
    if (!part) continue;
    if (one) Object.assign(pl, one.g ? { g: one.g } : {}, one.lock ? { lock: true } : {});
    names.add(part.name); lay.parts[part.id] = part;
    if (one) lay.placed.splice(oneAt, 0, pl); else lay.placed.push(pl);
    bakedCache.set(part, new Map([[bakeKey(pl), e]]));
  }
}

/** A placed part's loose entities (sheet mm) with its placement baked in, one level (a block or dimension inside stays one INSERT): { entities, blocks }. Throws when a member cannot be carried. */
export function explodePart(part, p) {
  const mini = newDoc(4), f = part.factor || 1, k = p.sc || 1, sx = (p.mirrorX ? -1 : 1) * f * k, sy = (p.mirrorY ? -1 : 1) * f * k;
  mini.layers = part.raw.layers; mini.blocks = { ...part.raw.blocks };
  addBlock(mini, 'PD_PART', part.raw.entities.filter((e) => (e.ps ? 1 : 0) === part.space), [part.box[0], part.box[1]]);
  return explodeInsert(insert('PD_PART', p.x, p.y, { layer: '0', rot: p.rot || 0, ...(sx !== 1 || sy !== 1 ? { sx, sy } : {}) }), mini);       // layer 0 stays layer 0, as AutoCAD
}
/** Explode the placed parts at `idxs` (indexes in lay.placed; layout objects and locked parts stay): each becomes its loose entities as layout objects, in its slot, on the part's layers (added to the layout when missing).
 * → { done (parts exploded), pieces (indexes in lay.placed of the new objects), errors } */
export function explodePlaced(lay, idxs, newId) {
  const at = new Set(idxs), out = [], pieces = [], errors = new Set(), table = { ...layersOf(lay) }, names = new Set(Object.values(lay.parts).map((q) => q.name));
  const find = (t, n) => Object.keys(t).find((k) => k.toLowerCase() === String(n).toLowerCase());
  let done = 0;
  lay.placed.forEach((p, i) => {
    const part = lay.parts[p.partId], mine = [];
    if (at.has(i) && part && !part.obj && !p.lock) {
      try {
        const r = explodePart(part, p);
        for (const e of r.entities) {
          if (find(table, e.layer) === undefined) { const k = find(part.raw.layers || {}, e.layer); table[e.layer] = k === undefined ? { aci: 7 } : structuredClone(part.raw.layers[k]); }
          const o = objectPart(newId(), nextName(OBJ_NAMES[e.type] || 'Object', names), e, table, {}, e.type === 'INSERT' ? r.blocks : {});
          if (o) { names.add(o.name); mine.push(o); }
        }
      } catch (err) { errors.add(err.message); mine.length = 0; }
    }
    if (!mine.length) { out.push(p); return; }
    done++;
    for (const o of mine) { lay.parts[o.id] = o; pieces.push(out.length); out.push(objectPlacement(o)); }
  });
  if (done) { lay.placed = out; lay.layers = table; }       // a new layer table, so an undo snapshot keeps the old one
  return { done, pieces, errors: [...errors] };
}

/** A grip edit: the object of entity `ent` (from objectDoc `view`) becomes `next`, in place: the same slot, name, group and lock (a part shared with a copy is left to the copy, and the new one gets a name of its own).
 * The new part always has a new id: objectSig() sees a changed entity only through it (the placement can stay the same). False when `next` has no extents. */
export function objectReplace(lay, view, ent, next, newId) {
  const i = view.at.get(ent), old = lay.placed[i], was = lay.parts[old.partId], shared = lay.placed.some((p, k) => k !== i && p.partId === old.partId);
  next.ps = false;
  const part = objectPart(newId(), shared ? nextName(OBJ_NAMES[next.type] || 'Object', new Set(Object.values(lay.parts).map((p) => p.name))) : was.name, next, layersOf(lay));
  if (!part) return false;
  const { sc, ...rest } = old, pl = { ...rest, ...objectPlacement(part) };       // placed at its own extents, so no scale / mirror is left over
  if (!shared) delete lay.parts[old.partId];
  lay.parts[part.id] = part; lay.placed[i] = pl;
  bakedCache.set(part, new Map([[bakeKey(pl), next]]));
  return true;
}

// ---------------------------------------------------------------- dimensions on a layout (TODO 156b2c1; layoutdim.js)

/** Block names, ignoring case; drawings' names also reserve a dimension's existing name. */
export function dimensionNames(lay) {
  const taken = new Set(), drawn = new Set();
  for (const q of Object.values(lay.parts)) for (const n of Object.keys(q.raw?.blocks || {})) { taken.add(n.toLowerCase()); if (!q.obj) drawn.add(n.toLowerCase()); }
  return { taken, drawn };
}
/** Replace a dimension with its new entity and blocks, keeping its placement slot and metadata. */
export function replaceDim(lay, p, ent, blocks, newId, names) {
  const part = lay.parts[p.partId], shared = lay.placed.filter((q) => q.partId === p.partId).length > 1;
  const next = objectPart(newId(), shared ? nextName('Dimension', names) : part.name, ent, layersOf(lay), part.raw.header, blocks);
  if (!next) return false;
  names.add(next.name); lay.parts[next.id] = next;
  Object.assign(p, objectPlacement(next));
  return true;
}
/** Explode the dimensions at `lay.placed` indexes `ats`: each becomes its lines, arrowheads and text as separate objects in its slot (its lock kept; the pieces follow nothing). → the number of dimensions exploded. */
export function explodeDims(lay, ats, newId) {
  const layers = layersOf(lay), names = new Set(Object.values(lay.parts).map((q) => q.name));
  let n = 0;
  for (const p of ats.map((i) => lay.placed[i])) {
    const part = lay.parts[p.partId], at = lay.placed.indexOf(p);
    if (!isDimPart(part) || !isSettled(part, p)) continue;
    const pieces = [];
    for (const e of explodeDimension(part.raw.entities[0], { blocks: part.raw.blocks, layers })) {
      const obj = objectPart(newId(), nextName(OBJ_NAMES[e.type] || 'Object', names), { ...e, ps: false }, layers);
      if (!obj) continue;
      names.add(obj.name); lay.parts[obj.id] = obj;
      pieces.push(Object.assign(objectPlacement(obj), p.lock ? { lock: true } : {}));
    }
    lay.placed.splice(at, 1, ...pieces); n++;
  }
  dropUnusedDims(lay);
  return n;
}
/** Bakes the placement of every moved / turned / scaled / mirrored dimension into its block (a new part, the placement back to the identity).
 * Also gives a dimension a block name of its own when a placed drawing's block, or another dimension (pasted from another layout), has it: they all land in one file. → true when any changed. */
export function settleDims(lay, newId, { taken, drawn } = dimensionNames(lay)) {
  const owner = new Map(), names = new Set(Object.values(lay.parts).map((q) => q.name));
  let changed = false;
  for (const p of lay.placed) {
    const part = lay.parts[p.partId];
    if (!isDimPart(part)) continue;
    const old = dimName(part), lo = old.toLowerCase(), settled = isSettled(part, p), clash = drawn.has(lo) || owner.has(lo) && owner.get(lo) !== p.partId;
    if (settled && !clash) { owner.set(lo, p.partId); continue; }
    const shared = lay.placed.filter((q) => q.partId === p.partId).length > 1, tag = settled ? dimTag(old) : turnedTag(dimTag(old), p.rot);
    const name = !shared && !clash && tag === dimTag(old) ? old : freeBlockName(taken, tag), ent = part.raw.entities[0];
    taken.add(name.toLowerCase());
    if (!replaceDim(lay, p, { ...ent, r: { ...ent.r, v: ent.r.v.map((v, k) => (ent.r.c[k] === 2 ? name : v)) } },
      { [name]: settled ? part.raw.blocks[old] : bakeBlock(part.raw.blocks[old], part, p) }, newId, names)) continue;
    owner.set(name.toLowerCase(), p.partId); delete p.sc;
    changed = true;
  }
  dropUnusedDims(lay);
  return changed;
}
function dropUnusedDims(lay) {
  const used = new Set(lay.placed.map((p) => p.partId));
  for (const [id, q] of Object.entries(lay.parts)) if (isDimPart(q) && !used.has(id)) delete lay.parts[id];
}
/** The layout's objects, dimensions included, as they are now (one entity each; a key per object: its part's name and where it is placed): what followDims() compares. */
export function linkView(lay) {
  const keys = [], entities = [], at = [], blocks = {};
  lay.placed.forEach((p, i) => {
    const part = lay.parts[p.partId];
    if (!part || !part.obj) return;
    const dim = isDimPart(part), ent = dim ? part.raw.entities[0] : bakedEntity(part, p);
    if (!ent) return;
    keys.push({ id: part.name, at: bakeKey(p) }); entities.push(ent); at.push(i);
    if (dim) Object.assign(blocks, part.raw.blocks);
  });
  return { keys, entities, at, blocks, layers: layersOf(lay) };
}
const bucket = (m, k, v) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); };
/** [cur index, prev index] of the same object in two linkView()s. Copies share a part name, so an object that did not move pairs with its exact twin first
 * (deleting copy A must not make B look like A moved), the rest by name in order. */
function pairUp(pv, cv) {
  const prev = pv.keys, cur = cv.keys, exact = new Map(), byId = new Map(), out = [], rest = [], used = new Set();
  prev.forEach((k, j) => bucket(exact, k.id + '|' + k.at, j));
  cur.forEach((k, i) => { const l = exact.get(k.id + '|' + k.at); if (l && l.length) { const j = l.shift(); used.add(j); out.push([i, j]); } else rest.push(i); });
  prev.forEach((k, j) => { if (!used.has(j)) bucket(byId, k.id, j); });
  const left = [];
  for (const i of rest) { const l = byId.get(cur[i].id); if (l && l.length) { const j = l.shift(); used.add(j); out.push([i, j]); } else left.push(i); }
  // a grip edit renames the part of a copy that shares one (objectReplace keeps the slot), so what is left pairs by slot
  const bySlot = new Map(pv.at.map((slot, j) => [slot, j]));
  for (const i of left) { const j = bySlot.get(cv.at[i]); if (j !== undefined && !used.has(j)) { used.add(j); out.push([i, j]); } }
  return out.sort((a, b) => a[0] - b[0]);
}
/** Dimensions follow the objects they measure: `prev` and `cur` are linkView()s before and after an edit; a dimension whose end sat on a point that moved is rebuilt (drawings' linked dimensions, linked-dimensions.js). → true when any changed. */
export function followDims(lay, prev, cur, newId) {
  const common = pairUp(prev, cur);
  if (!common.length) return false;
  const before = { header: {}, layers: cur.layers, ltypes: {}, blocks: prev.blocks, entities: common.map(([, j]) => prev.entities[j]) };
  const next = { entities: common.map(([i]) => cur.entities[i]), blocks: cur.blocks }, out = followDimensions(before, next, 1);
  if (out === next) return false;
  let changed = false;
  const names = new Set(Object.values(lay.parts).map((q) => q.name));
  common.forEach(([i]) => {
    const p = lay.placed[cur.at[i]], part = lay.parts[p.partId];
    if (!isDimPart(part)) return;
    const name = dimName(part), block = out.blocks[name];
    if (!block || block === part.raw.blocks[name]) return;
    if (replaceDim(lay, p, part.raw.entities[0], { [name]: block }, newId, names)) changed = true;
  });
  dropUnusedDims(lay);
  return changed;
}

// ---------------------------------------------------------------- parts

/** Parts offered for placing or the library; linked contours stay with their source part. */
export function partsForPlacement(lay) {
  const ctParts = new Set(lay.placed.filter((q) => q.ct).map((q) => q.partId));
  return Object.values(lay.parts).filter((p) => !ctParts.has(p.id) && !p.obj);
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
  const placed = lay.placed.filter((pl) => lay.parts[pl.partId] && !lay.parts[pl.partId].obj).map((pl) => {       // layout objects are not in the grid's way
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

/** The ids of the parts the layout uses (placed, or the grid's): the others are not written to the file. Layout objects are plain entities, not parts. */
export const usedIds = (lay) => [...new Set([...(lay.s.gridPart ? [lay.s.gridPart] : []), ...lay.placed.map((p) => p.partId)])].filter((id) => lay.parts[id] && !lay.parts[id].obj);

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
function metaEntities(lay, blockOf, ids, ob = []) {
  const meta = {
    v: 1, app: 'Project D', name: lay.name, s: lay.s,
    parts: ids.map((id) => { const p = lay.parts[id]; return { id, name: p.name, block: blockOf[id], factor: p.factor || 1, w: p.w, h: p.h, src: p.src || '', ...(p.obj ? { obj: true } : {}) }; }),
    placed: lay.placed.filter((p) => ids.includes(p.partId)),
    ...(ob.some((o) => o) ? { ob, obCount: ob.length } : {}),       // the group / lock of each baked object, in entity order (a plain entity carries neither)
  };
  const b = enc(meta), out = [];
  for (let i = 0; i < b.length; i += CHUNK) out.push(dxfText(0, 0, 1, b.slice(i, i + CHUNK), { layer: '0' }));
  return out;
}

/** The layout as a DXF document (writeDxf's shape): everything a CAD app shows, plus the hidden PD_LAYOUT block. */
export function layoutRaw(lay) {
  const all = placedAll(lay), baked = [], kept = [], ob = [], dimBlocks = {};
  for (const p of all) {
    const part = lay.parts[p.partId], ents = part.obj && bakeObject(part, p);
    if (ents) { baked.push(...ents); if (isDimPart(part)) Object.assign(dimBlocks, part.raw.blocks); for (const _ of ents) ob.push(p.g || p.lock ? { ...(p.g ? { g: p.g } : {}), ...(p.lock ? { lock: true } : {}) } : 0); } else kept.push(p);               // an object Explode cannot carry stays a block (and comes back as an object)
  }
  const ids = [...new Set([...usedIds(lay), ...kept.filter((p) => lay.parts[p.partId].obj).map((p) => p.partId)])];
  const { doc, blockOf } = buildLayoutDoc({ parts: lay.parts, placed: kept, sheetW: lay.s.sheetW, sheetH: lay.s.sheetH, marks: marksOf(lay, all.filter((p) => !lay.parts[p.partId].obj)), keep: ids });
  for (const [name, def] of Object.entries(layersOf(lay))) if (!(name in doc.layers)) doc.layers[name] = structuredClone(def);
  addEntities(doc, baked);
  for (const [n, b] of Object.entries(dimBlocks)) addBlock(doc, n, b.entities, b.base);
  addBlock(doc, LAYOUT_BLOCK, metaEntities(lay, blockOf, ids, ob));
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
  for (const pm of m.parts) if (pm.obj === true && lay.parts[pm.id]) lay.parts[pm.id].obj = true;       // an object kept as a block
  readObjects(lay, raw, Array.isArray(m.ob) ? m.ob : [], m.obCount);
  return lay;
}

/** The plain entities of the file (not the sheet, the marks or the INSERTs) become layout objects again, one each. */
function readObjects(lay, raw, ob, count) {
  const layers = layersOf(lay), insName = (e) => String(e.r.v[e.r.c.indexOf(2)] ?? '').trim();
  const isDim = (e) => e.type === 'INSERT' && DIM_BLOCK.test(insName(e)) && !!raw.blocks[insName(e)];
  const plain = raw.entities.filter((e) => (e.type !== 'INSERT' || isDim(e)) && !e.ps && !isReserved(e.layer));
  // shortcut: equal-count outside reordering remains positional, use stable entity IDs if that must be detected
  if (count !== plain.length) ob = [];       // outside edits can shift the positional group / lock metadata
  let n = 0, k = 0;
  for (const e of plain) {
    const info = ob[k++];
    if (raw.layers[e.layer] && !layers[e.layer]) layers[e.layer] = raw.layers[e.layer];
    let id; do id = 'ob' + (++n); while (lay.parts[id]);
    const part = objectPart(id, 'Object ' + n, e, layers, raw.header, isDim(e) ? { [insName(e)]: raw.blocks[insName(e)] } : {});
    if (!part) continue;
    lay.parts[id] = part; lay.placed.push({ ...objectPlacement(part), ...(info && typeof info.g === 'string' && info.g ? { g: info.g } : {}), ...(info && info.lock === true ? { lock: true } : {}) });
  }
}
