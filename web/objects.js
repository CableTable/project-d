// objects.js — the Objects tab's model, pure (no DOM): objects.test.mjs.   (TODO 39; mock-up R11a, Option A)
//
// The open drawing as a tree: each layer, its objects (one row per top-level entity, a short label), and a block's members.
//
//   labelOf(ent, factor, blocks)   → "Circle Ø40", "Line 120.0", "Rectangle 200.0 × 140.0", "Text 'REV A'", "Block LOGO · 3"
//   iconOf(ent)                    → 'line' | 'rect' | 'circle' | 'arc' | 'poly' | 'text' | 'block' | 'other'
//   buildTree(raw, fl, opts)       → { layers: [{ name, css, count, shown, hidden, locked, cur, cap, more, rows }], objects, nLayers, hiddenN, lockedN }
//   membersOf(raw, ent, factor)    → the rows of a block's members (first MEMBERS)
//   boxOf(fl, ents)                → the box [x0, y0, x1, y1] (drawing units) of these top-level entities, or null
//   renameLayer(raw, from, to)     → { entities, blocks, layers } with the layer renamed everywhere
//   partsTree(lay, placed, hidden, query) → the rows of a layout: each part, and its places
//   Hiding an object, and locking a layer, are kept by the caller (a Set of entity indexes / of layer names).
import { get, lwVertices } from './grips.js';
import { sweepOf } from './draw.js';
import * as TX from './text.js';
import { typeName } from './props.js';
import { DIM_BLOCK, LDR_BLOCK } from './edit.js';
import { spaceOf, shownEntityIndexes } from './doc.js';

export const CAP = 500;                // objects listed per layer before "show more"
export const MEMBERS = 200;            // members listed per block

const t = (n) => String(+Number(n).toFixed(2));                       // 40, 8.5
const one = (n) => Number(n).toFixed(1);                              // 120.0
const blockName = (ent) => { const k = ent.r ? ent.r.c.indexOf(2) : -1; return k < 0 ? '' : String(ent.r.v[k]).trim(); };

/** Is this closed polyline a plain rectangle (four corners, no bulges, sides along X and Y)? → [w, h] or null. */
function rectSize(r) {
  const vs = lwVertices(r), closed = ((get(r, 70) ?? 0) & 1) === 1;
  if (!closed || vs.length !== 4 || vs.some((v) => v.b)) return null;
  const xs = vs.map((v) => v.x), ys = vs.map((v) => v.y), e = 1e-9 * (1 + Math.max(...xs.map(Math.abs), ...ys.map(Math.abs)));
  const ok = vs.every((v, i) => { const n = vs[(i + 1) % 4]; return Math.abs(v.x - n.x) < e || Math.abs(v.y - n.y) < e; });
  return ok ? [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)] : null;
}

/** The search boxes' rule (Layers, Objects): ignores case, matches any part of the name, no wildcards; an empty query matches all. */
export const nameMatches = (name, query) => String(name).toLowerCase().includes(String(query || '').trim().toLowerCase());

export function iconOf(ent) {
  switch (ent.type) {
    case 'LINE': return 'line';
    case 'CIRCLE': return 'circle';
    case 'ARC': return 'arc';
    case 'LWPOLYLINE': return ent.r && rectSize(ent.r) ? 'rect' : 'poly';
    case 'POLYLINE': return 'poly';
    case 'TEXT': case 'MTEXT': return 'text';
    case 'INSERT': return 'block';
    default: return 'other';
  }
}

export function labelOf(ent, factor = 1, blocks = {}) {
  const r = ent.r, f = factor;
  switch (ent.type) {
    case 'LINE': return r ? `Line ${one(Math.hypot((get(r, 11) ?? 0) - (get(r, 10) ?? 0), (get(r, 21) ?? 0) - (get(r, 20) ?? 0)) * f)}` : 'Line';
    case 'CIRCLE': return r ? `Circle Ø${t(2 * (get(r, 40) ?? 0) * f)}` : 'Circle';
    case 'ARC': return r ? `Arc R${t((get(r, 40) ?? 0) * f)} · ${t(sweepOf(get(r, 50) ?? 0, get(r, 51) ?? 0))}°` : 'Arc';
    case 'LWPOLYLINE': {
      const rs = r && rectSize(r);
      return rs ? `Rectangle ${one(rs[0] * f)} × ${one(rs[1] * f)}` : `Polyline, ${r ? lwVertices(r).length : 0} pts`;
    }
    case 'TEXT': case 'MTEXT': {
      const m = TX.decode(ent), s = m ? m.lines.join(' ') : '';
      return `Text '${s.length > 24 ? s.slice(0, 23) + '…' : s}'`;
    }
    case 'INSERT': {
      const n = blockName(ent);
      if (DIM_BLOCK.test(n)) return 'Dimension';
      if (LDR_BLOCK.test(n)) return 'Leader';
      const b = blocks[n];
      return `Block ${n}` + (b && b.entities ? ` · ${b.entities.length}` : '');
    }
    default: return typeName(ent);
  }
}

/** The rows of a block's members: [{ label, icon }], the first MEMBERS, and how many more there are. */
export function membersOf(raw, ent, factor = 1) {
  const b = raw.blocks && raw.blocks[blockName(ent)], list = (b && b.entities) || [];
  return { rows: list.slice(0, MEMBERS).map((m) => ({ label: labelOf(m, factor, raw.blocks), icon: iconOf(m) })), more: Math.max(0, list.length - MEMBERS) };
}

/**
 * The tree. opts: { factor, off (Set of fl layer indexes), hid (Set of entity indexes), locked (Set of layer names), curLayer, query,
 * filter ('all' | 'hidden' | 'locked'), open (Set of layer names), show (Map layer → how many rows), extra (layer names with no objects) }.
 * Rows (a layer's objects) are only made for a layer that is open (or while searching), and only the first `cap` of them.
 */
export function buildTree(raw, fl, o = {}) {
  const { factor = 1, off = new Set(), hid = new Set(), locked = new Set(), curLayer = null, filter = 'all', open = new Set(), show = new Map(), extra = [] } = o;
  const q = String(o.query || '').trim().toLowerCase();
  const names = fl.layers.map((l) => l.name), at = new Map(names.map((n, i) => [n, i])), by = new Map(names.map((n) => [n, []]));
  for (const n of extra) if (!by.has(n)) by.set(n, []);                 // layers added by hand, still empty (the file's other empty layers are not listed, as in the Layers section)
  for (const i of shownEntityIndexes(raw, fl)) {
    const e = raw.entities[i];
    if (!by.has(e.layer)) by.set(e.layer, []);
    by.get(e.layer).push(i);
  }
  const layers = [];
  let objects = 0, hiddenN = 0, lockedN = 0;
  for (const [name, list] of by) {
    const idx = at.has(name) ? at.get(name) : -1, layerHidden = idx >= 0 && off.has(idx), isLocked = locked.has(name);
    objects += list.length;
    const hidList = layerHidden ? list : list.filter((e) => hid.has(e));
    hiddenN += hidList.length;
    if (isLocked) lockedN += list.length;
    const pool = filter === 'hidden' ? hidList : filter === 'locked' ? (isLocked ? list : []) : list;
    if (filter === 'hidden' && !layerHidden && !pool.length) continue;
    if (filter === 'locked' && !isLocked) continue;
    const found = q && !nameMatches(name, q) ? pool.filter((e) => nameMatches(labelOf(raw.entities[e], factor, raw.blocks), q)) : pool;
    if (q && !found.length) continue;
    const cap = Math.max(CAP, show.get(name) || 0), isOpen = !!q || open.has(name);
    const rows = isOpen ? found.slice(0, cap).map((e) => {
      const ent = raw.entities[e];
      return { e, label: labelOf(ent, factor, raw.blocks), icon: iconOf(ent), hidden: layerHidden || hid.has(e), locked: isLocked, block: ent.type === 'INSERT' && !DIM_BLOCK.test(blockName(ent)) && !LDR_BLOCK.test(blockName(ent)) };
    }) : [];
    layers.push({ name, css: idx >= 0 ? fl.layers[idx].css : null, index: idx, count: list.length, shown: found.length, hidden: layerHidden, locked: isLocked, cur: name === curLayer, open: isOpen, cap, more: isOpen ? Math.max(0, found.length - cap) : 0, ents: found, rows });
  }
  return { layers, objects, nLayers: by.size, hiddenN, lockedN };
}

/** The numbers of the entities in `hid` (a Set of entity objects): hiding is kept by object, so deleting or inserting before one does not move it. */
export function hiddenIndexes(entities, hid) {
  const out = new Set();
  if (hid && hid.size) entities.forEach((e, i) => { if (hid.has(e)) out.add(i); });
  return out;
}

/** The box [x0, y0, x1, y1] (drawing units, shown space) of these top-level entities, or null. */
export function boxOf(fl, ents) {
  const want = ents instanceof Set ? ents : new Set(ents), space = spaceOf(fl);
  let b = null;
  for (const it of fl.items) {
    if (it.e == null || !want.has(it.e) || (it.ps ? 1 : 0) !== space) continue;
    b = b ? [Math.min(b[0], it.b[0]), Math.min(b[1], it.b[1]), Math.max(b[2], it.b[2]), Math.max(b[3], it.b[3])] : it.b.slice();
  }
  return b;
}

/** The document with a layer renamed: its table entry, every entity on it (also inside blocks). Nothing else changes. */
export function renameLayer(raw, from, to) {
  // a POLYLINE's VERTEX and an INSERT's ATTRIB records carry their own layer (code 8)
  const kid = (k) => ({ ...k, v: k.v.map((v, i) => (k.c[i] === 8 && v.trim() === from ? to : v)) });
  const re = (ents) => ents.map((e) => (e.layer === from ? { ...e, layer: to } : e)).map((e) => (e.kids ? { ...e, kids: e.kids.map(kid) } : e));
  const layers = Object.fromEntries(Object.entries(raw.layers).map(([k, def]) => [k === from ? to : k, def]));
  const blocks = Object.fromEntries(Object.entries(raw.blocks).map(([k, b]) => [k, b && b.entities ? { ...b, entities: re(b.entities) } : b]));
  return { entities: re(raw.entities), blocks, layers };
}

/**
 * A layout's tree: each part it uses (name, how many places, hidden?) and its places. `placed` is placedAll(lay); a place is
 * { src, i, label }. A part is kept while searching if its name or one of its places matches.
 */
export function partsTree(lay, placed, hidden = new Set(), query = '') {
  const q = String(query || '').trim().toLowerCase(), out = [];
  for (const [id, part] of Object.entries(lay.parts)) {
    const mine = placed.map((p, k) => ({ p, k })).filter((x) => x.p.partId === id);
    if (!mine.length) continue;
    const places = mine.map(({ p, k }) => ({ k, src: p.src, i: p.i, label: `X ${t(p.x)} · Y ${t(p.y)}` + (p.rot ? ` · ${t(p.rot)}°` : ''), locked: !!p.lock }));
    const shown = q && !nameMatches(part.name, q) ? places.filter((x) => nameMatches(x.label, q)) : places;
    if (q && !shown.length) continue;
    out.push({ id, name: part.name, w: part.w, h: part.h, count: mine.length, hidden: hidden.has(id), places: shown });
  }
  return out;
}
