// edit.js — pure: picking, deleting and scaling the entities of an opened drawing (no DOM, no files) — edit.test.mjs.
//
// The raw document (drawing.js readDxf) is the truth; flatten() of it is what is drawn, and every drawn item carries
// `e`, the index of the top-level entity it came from (an INSERT's contents all carry the INSERT's index, so a block
// reference is one pickable thing). Everything here works in drawing units, y up.
//
//   makeIndex(raw, fl, off)      → ed: what is drawn per entity, a pick grid, the end points (built once per state)
//   hitEntity(ed, x, y, tol)     → the entity index under a point, or -1
//   chainAt(ed, e, tol)          → the entity and everything joined to it end to end (endpoints within tol)
//   inBox(ed, [x0,y0,x1,y1])     → entities lying fully inside a box
//   crossBox(ed, [x0,y0,x1,y1])  → entities whose geometry touches or lies inside a box
//   snapEnd(ed, x, y, tol)       → the nearest entity end point within tol, or null
//   removeEntities / keepOnly    → { entities, blocks } without (or with only) some entities; unused blocks go too
//   scaleAbout(raw, s, ax, ay)   → { entities, blocks, skipped } scaled uniformly about (ax, ay)
//   createHistory()              → undo / redo of { entities, blocks } states
import { mapply, mscale, pickIndex, pickAt, piecesNear } from './drawing.js';
import { spaceOf, itemVisible } from './doc.js';
import { line, insert, entity, addLayer, arc, lwpoly } from './dxf-write.js';
import { DEFAULT_TYPES, perpFoot, preferSnap } from './snap.js';
import { pieceInter } from './modify.js';

// ---------------------------------------------------------------- the index

/** The tolerance for "joined end to end", in drawing units: 0.01 mm, or 1e-5 of the drawing's diagonal if that is more (capped at 0.1 mm). */
export function chainTol(box, factor) {
  const diag = box ? Math.hypot(box[2] - box[0], box[3] - box[1]) : 0;
  const mm = Math.min(0.1, Math.max(0.01, diag * factor * 1e-5));
  return mm / (factor || 1);
}

/** A path's ends [x1, y1, x2, y2] (item coordinates), or null when it is closed. */
export function pathEnds(ops) {
  let sx = ops[1], sy = ops[2], x = sx, y = sy, closed = false;
  for (let i = 0; i < ops.length;) {
    const op = ops[i];
    if (op === 0 || op === 1) { x = ops[i + 1]; y = ops[i + 2]; i += 3; }
    else if (op === 2) { x = ops[i + 1] + ops[i + 3] * Math.cos(ops[i + 5]); y = ops[i + 2] + ops[i + 3] * Math.sin(ops[i + 5]); i += 7; }
    else { closed = true; i++; }
  }
  if (closed) return null;
  return [sx, sy, x, y];
}

/** An arc op's sweep (radians, signed), as the canvas draws it: clockwise flag 1 = anticlockwise in canvas terms. */
function arcSweepOp(a0, a1, acw) {
  const T = 2 * Math.PI;
  let d = a1 - a0;
  if (!acw) { if (d >= T) return T; d %= T; if (d < 0) d += T; } else { if (-d >= T) return -T; d %= T; if (d > 0) d -= T; }
  return d;
}

/**
 * The closed loops of some entities, in drawing units (areaPerimeter and Shaping share it): the pieces are joined end to end (within tol)
 * and a loop whose last gap is tiny (≤ 10 × tol) is closed across it and counted in `gaps`. Text, fills and kept dimensions are left out.
 * Returns { loops: [{ pts, ents }] (ents: the entity indexes the loop is made of), len (all lines and arcs), gaps, open (pieces that do not close), openEnts (the entities that have such a piece) }, or null if there are no lines.
 */
export function outlineLoops(ed, ents, tol = 1e-6) {
  const { fl, items, raw } = ed, pieces = [];
  let len = 0;
  for (const e of ents) {
    if (!ed.byEnt[e] || raw.entities[e].layer === DIM_LAYER || raw.entities[e].type === 'DIMENSION') continue;
    for (const i of ed.byEnt[e]) {
      const it = items[i];
      if (it.k !== 'p' || it.fill) continue;
      const m = fl.mats[it.m], ops = it.ops;
      let cur = null;
      const add = (x, y) => { const p = mapply(m, x, y); if (cur.length) { const q = cur[cur.length - 1]; len += Math.hypot(p[0] - q[0], p[1] - q[1]); } cur.push(p); };
      for (let k = 0; k < ops.length;) {
        const op = ops[k];
        if (op === 0) { if (cur && cur.length > 1) pieces.push({ pts: cur, closed: false, ents: new Set([e]) }); cur = []; add(ops[k + 1], ops[k + 2]); k += 3; }
        else if (op === 1) { add(ops[k + 1], ops[k + 2]); k += 3; }
        else if (op === 2) {
          const [cx, cy, r, a0, a1] = [ops[k + 1], ops[k + 2], ops[k + 3], ops[k + 4], ops[k + 5]], sw = arcSweepOp(a0, a1, ops[k + 6] === 1);
          const n = Math.max(2, Math.ceil(Math.abs(sw) / (Math.PI / 720)));         // ¼° steps: well under 0.01 mm on a part
          if (!cur) cur = [];
          for (let s = cur.length ? 1 : 0; s <= n; s++) add(cx + r * Math.cos(a0 + sw * s / n), cy + r * Math.sin(a0 + sw * s / n));
          k += 7;
        } else { if (cur && cur.length > 1) { add(cur[0][0], cur[0][1]); pieces.push({ pts: cur, closed: true, ents: new Set([e]) }); cur = null; } k++; }
      }
      if (cur && cur.length > 1) pieces.push({ pts: cur, closed: false, ents: new Set([e]) });
    }
  }
  if (!pieces.length) return null;
  const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol;
  const loops = [];
  for (const p of pieces) {                                    // one piece that ends where it starts (a circle, a closed polyline)
    if (p.closed || (p.pts.length > 2 && near(p.pts[0], p.pts[p.pts.length - 1]))) { loops.push({ pts: p.pts, ents: p.ents }); p.used = true; }
  }
  const open = pieces.filter((p) => !p.used), gapTol = tol * 10;
  let gaps = 0;
  for (const start of open) {                                  // join open pieces end to end until they close
    if (start.used) continue;
    start.used = true;
    let path = start.pts.slice(), closed = false;
    const es = new Set(start.ents);
    for (;;) {
      if (path.length > 2 && near(path[0], path[path.length - 1])) { closed = true; break; }
      const end = path[path.length - 1];
      const next = open.find((q) => !q.used && (near(q.pts[0], end) || near(q.pts[q.pts.length - 1], end)));
      if (!next) break;
      next.used = true; for (const x of next.ents) es.add(x);
      path = path.concat((near(next.pts[0], end) ? next.pts : next.pts.slice().reverse()).slice(1));
    }
    while (!closed) {                                          // stuck: grow it from its other end too
      const head = path[0];
      const prev = open.find((q) => !q.used && (near(q.pts[0], head) || near(q.pts[q.pts.length - 1], head)));
      if (!prev) break;
      prev.used = true; for (const x of prev.ents) es.add(x);
      path = (near(prev.pts[prev.pts.length - 1], head) ? prev.pts : prev.pts.slice().reverse()).slice(0, -1).concat(path);
      if (near(path[0], path[path.length - 1])) closed = true;
    }
    // a tiny gap left between its two ends (up to 10 × tol): closed across it for the area, and counted (TODO 46 fixes them)
    if (!closed && path.length > 2 && Math.hypot(path[0][0] - path[path.length - 1][0], path[0][1] - path[path.length - 1][1]) <= gapTol) { closed = true; gaps++; }
    if (closed) loops.push({ pts: path, ents: es }); else start.open = true;
  }
  const openPieces = open.filter((p) => p.open);
  return { loops, len, gaps, open: openPieces.length, openEnts: new Set(openPieces.flatMap((p) => [...p.ents])) };
}

/**
 * Area and perimeter of some entities (TODO 31), in mm² and mm. Every line and arc counts toward the perimeter. The
 * pieces are joined end to end (within tol, drawing units) into closed loops (outlineLoops); a loop inside an odd number of others is
 * a hole and is taken off.
 * Returns { area, perimeter, loops, holes, gaps, open } (open: pieces that do not close), or null if there are no lines.
 */
export function areaPerimeter(ed, ents, factor = 1, tol = 1e-6) {
  const r = outlineLoops(ed, ents, tol);
  if (!r) return null;
  const { len, gaps, open } = r, loops = r.loops.map((l) => l.pts);
  const shoelace = (pts) => { let s = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]; return Math.abs(s) / 2; };
  const inside = (pt, poly) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const a = loops.map(shoelace);
  let area = 0, holes = 0;
  loops.forEach((L, i) => {
    const depth = loops.reduce((n, M, j) => n + (j !== i && a[j] > a[i] && inside(L[0], M) ? 1 : 0), 0);
    if (depth % 2) { area -= a[i]; holes++; } else area += a[i];
  });
  return { area: area * factor * factor, perimeter: len * factor, loops: loops.length, holes, gaps, open };
}

/**
 * What the editor needs about a drawing: per shown entity its items and box, a pick grid, and the end points.
 * off: the layer indexes switched off (their entities are not there to pick); hid: entities hidden one by one (Objects tab), the same.
 */
export function makeIndex(raw, fl, off = new Set(), hid = null) {
  const space = spaceOf(fl), n = raw.entities.length, items = fl.items;
  const vis = new Uint8Array(items.length), byEnt = new Array(n), box = new Float64Array(n * 4);
  const areas = [], shown = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.e == null || (it.ps ? 1 : 0) !== space || !itemVisible(it, off) || (hid && hid.has(it.e))) continue;
    vis[i] = 1;
    const e = it.e, b = it.b;
    if (!byEnt[e]) { byEnt[e] = []; shown.push(e); box[e * 4] = b[0]; box[e * 4 + 1] = b[1]; box[e * 4 + 2] = b[2]; box[e * 4 + 3] = b[3]; }
    else { if (b[0] < box[e * 4]) box[e * 4] = b[0]; if (b[1] < box[e * 4 + 1]) box[e * 4 + 1] = b[1]; if (b[2] > box[e * 4 + 2]) box[e * 4 + 2] = b[2]; if (b[3] > box[e * 4 + 3]) box[e * 4 + 3] = b[3]; }
    byEnt[e].push(i);
    if (it.k !== 'p' || it.fill) areas.push(i);
  }
  // end points: one pair per entity made of open paths only (not blocks, not text, not closed shapes)
  const ends = new Float64Array(n * 4).fill(NaN);
  for (const e of shown) {
    const type = raw.entities[e].type;
    if (type === 'INSERT' || type === 'DIMENSION') continue;
    const list = byEnt[e];
    if (!list.every((i) => items[i].k === 'p' && !items[i].fill)) continue;
    const first = pathEnds(items[list[0]].ops), last = list.length === 1 ? first : pathEnds(items[list[list.length - 1]].ops);
    if (!first || !last) continue;
    const a = mapply(fl.mats[items[list[0]].m], first[0], first[1]), b = mapply(fl.mats[items[list[list.length - 1]].m], last[2], last[3]);
    const size = Math.max(Math.abs(box[e * 4 + 2] - box[e * 4]), Math.abs(box[e * 4 + 3] - box[e * 4 + 1]), 1e-9);
    if (type !== 'LINE' && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9 * size) continue;     // a circle: its start is no end; zero-length lines can be micro pieces
    ends[e * 4] = a[0]; ends[e * 4 + 1] = a[1]; ends[e * 4 + 2] = b[0]; ends[e * 4 + 3] = b[1];
  }
  const ix = pickIndex(fl, space === 1), bc = new Map(), bw = [];
  const at = (v) => Math.min(ix.G - 1, Math.max(0, Math.floor(v)));
  // Entity boxes share the pick grid; dimensions need their whole block box, text and hatches have no pick pieces.
  for (const e of shown) {
    const k = e * 4, i0 = at((box[k] - ix.x0) / ix.cell), i1 = at((box[k + 2] - ix.x0) / ix.cell), j0 = at((box[k + 1] - ix.y0) / ix.cell), j1 = at((box[k + 3] - ix.y0) / ix.cell);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 256) { bw.push(e); continue; }
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const key = i * 4096 + j;
      if (!bc.has(key)) bc.set(key, []);
      bc.get(key).push(e);
    }
  }
  return { raw, fl, space, n, vis, byEnt, box, shown, areas, ends, items, ix, bc, bw, graph: null };
}

/** The entity under (x, y) within tol: the nearest line or arc, else a filled or text item whose box holds the point. -1 if none. */
export function hitEntity(ed, x, y, tol) {
  const i = hitItem(ed, x, y, tol);
  return i < 0 ? -1 : ed.items[i].e;
}

/** hitEntity's pick, as the item index (its own colour, inside a block too). -1 if none. */
export function hitItem(ed, x, y, tol) {
  const p = pickAt(ed.ix, x, y, tol, (i) => ed.vis[i] === 1);
  if (p.ent) return p.ent.it;
  let best = -1, bestA = Infinity;
  for (const i of ed.areas) {
    const b = ed.items[i].b;
    if (!ed.vis[i] || x < b[0] - tol || x > b[2] + tol || y < b[1] - tol || y > b[3] + tol) continue;
    const a = (b[2] - b[0] + 2 * tol) * (b[3] - b[1] + 2 * tol);
    if (a < bestA) { bestA = a; best = i; }
  }
  return best;
}

/** All hits with hitEntity's geometry rules, in paint order (topmost first). */
export function hitEntities(ed, x, y, tol) {
  const items = new Set(piecesNear(ed.ix, x, y, tol, (i) => ed.vis[i] === 1).map((p) => p.ent.it));
  for (const i of ed.areas) {
    const b = ed.items[i].b;
    if (ed.vis[i] && x >= b[0] - tol && x <= b[2] + tol && y >= b[1] - tol && y <= b[3] + tol) items.add(i);
  }
  return [...new Set([...items].sort((a, b) => b - a).map((i) => ed.items[i].e))];
}

/** The nearest end point (of an open line, arc, polyline…) within tol of (x, y): { x, y } or null. */
export function snapEnd(ed, x, y, tol) {
  const ix = ed.ix;
  if (!ix.G) return null;
  const at = (v) => Math.min(ix.G - 1, Math.max(0, Math.floor(v)));
  const i0 = at((x - tol - ix.x0) / ix.cell), i1 = at((x + tol - ix.x0) / ix.cell), j0 = at((y - tol - ix.y0) / ix.cell), j1 = at((y + tol - ix.y0) / ix.cell);
  let best = tol, out = null;
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const k of ix.sc.get(i * 4096 + j) || []) {
    const s = ix.snaps[k];
    if (s.kind !== 'end' && s.kind !== 'centre') continue;
    if (!ed.vis[s.it]) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d <= best) { best = d; out = { x: s.x, y: s.y }; }
  }
  return out;
}

/**
 * The closest enabled feature under (x, y) within tol (ends win a tie), else the nearest point on a line or arc.
 * → { x, y, kind } or null.
 * on: false → null (the exact clicked point is used). skip: an entity index left out (the one a grip is dragging).
 * types: enabled ticks. extra: the current drawing tool's own points, subject to the same filter and priority.
 * from: the last picked point [x, y] (drawing units), for the perpendicular foot on a straight piece.
 */
export function snapPick(ed, x, y, tol, on = true, skip = -1, types = DEFAULT_TYPES, extra = [], from = null) {
  if (!on) return null;
  let best = null;
  for (const sn of extra) best = preferSnap(best, sn, x, y, tol, types);
  const ix = ed.ix;
  if (!ix.G) return best;
  const at = (v) => Math.min(ix.G - 1, Math.max(0, Math.floor(v)));
  const i0 = at((x - tol - ix.x0) / ix.cell), i1 = at((x + tol - ix.x0) / ix.cell), j0 = at((y - tol - ix.y0) / ix.cell), j1 = at((y + tol - ix.y0) / ix.cell);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const k of ix.sc.get(i * 4096 + j) || []) {
    const sn = ix.snaps[k];
    if (!ed.vis[sn.it] || ed.items[sn.it].e === skip) continue;
    best = preferSnap(best, sn, x, y, tol, types);
  }
  const perp = from && types.perpendicular !== false;
  if (types.intersection !== false || perp) {
    // shortcut: only the 200 pieces nearest the cursor are crossed (k^2/2 pieceInter calls per hover); raise or index them if a dense drawing misses a crossing.
    const pieces = piecesNear(ix, x, y, tol, (i) => ed.vis[i] === 1 && ed.items[i].e !== skip).filter((p) => !p.ent.curve).sort((a, b) => a.d - b.d).slice(0, 200).map((p) => p.ent);
    const eps = 1e-9 * (1 + Math.abs(x) + Math.abs(y));
    if (types.intersection !== false) for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
      for (const [px, py] of pieceInter(pieces[i], pieces[j])) {
        // a line-arc crossing lands ~1e-9 off the end point it shares: the end wins
        if (best?.kind === 'end' && Math.hypot(best.x - px, best.y - py) <= eps) continue;
        best = preferSnap(best, { x: px, y: py, kind: 'intersection' }, x, y, tol, types);
      }
    }
    if (perp) for (const p of pieces) {
      const foot = p.t === 's' && perpFoot(from, [p.x1, p.y1], [p.x2, p.y2]);
      if (foot) best = preferSnap(best, { x: foot[0], y: foot[1], kind: 'perpendicular' }, x, y, tol, types);
    }
  }
  if (best) return { x: best.x, y: best.y, kind: best.kind };
  if (types.near === false) return null;
  const p = pickAt(ix, x, y, tol, (i) => ed.vis[i] === 1 && ed.items[i].e !== skip);
  return p.ent && p.near ? { x: p.near[0], y: p.near[1], kind: 'near' } : null;
}

// ---------------------------------------------------------------- chains

/** A hash of the end points in cells of `tol`: neighbours are found in the 3 × 3 cells around a point. */
function buildGraph(ed, tol) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of ed.shown) {
    if (Number.isNaN(ed.ends[e * 4])) continue;
    for (const k of [0, 2]) { const x = ed.ends[e * 4 + k], y = ed.ends[e * 4 + k + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const cell = Math.max(tol, (Math.max(x1 - x0, y1 - y0) || 1) / 1e6), map = new Map();
  const key = (cx, cy) => (cx + 1048576) * 2097152 + (cy + 1048576);
  for (const e of ed.shown) {
    if (Number.isNaN(ed.ends[e * 4])) continue;
    for (const k of [0, 1]) {
      const kk = key(Math.floor(ed.ends[e * 4 + k * 2] / cell), Math.floor(ed.ends[e * 4 + k * 2 + 1] / cell));
      const l = map.get(kk);
      if (l) l.push(e * 2 + k); else map.set(kk, [e * 2 + k]);
    }
  }
  return { tol, cell, map, key };
}

/** The entity and every entity joined to it end to end (an end within tol of another's), as an array of indexes. */
export function chainAt(ed, e, tol) {
  if (!ed.graph || ed.graph.tol !== tol) ed.graph = buildGraph(ed, tol);
  const g = ed.graph, seen = new Set([e]), stack = [e], t2 = tol * tol;
  while (stack.length) {
    const cur = stack.pop();
    if (Number.isNaN(ed.ends[cur * 4])) continue;
    for (const k of [0, 1]) {
      const x = ed.ends[cur * 4 + k * 2], y = ed.ends[cur * 4 + k * 2 + 1], cx = Math.floor(x / g.cell), cy = Math.floor(y / g.cell);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const l = g.map.get(g.key(cx + i, cy + j));
        if (!l) continue;
        for (const id of l) {
          const o = id >> 1, ok = id & 1;
          if (seen.has(o)) continue;
          const dx = ed.ends[o * 4 + ok * 2] - x, dy = ed.ends[o * 4 + ok * 2 + 1] - y;
          if (dx * dx + dy * dy <= t2) { seen.add(o); stack.push(o); }
        }
      }
    }
  }
  return [...seen];
}

/** Entities lying fully inside the box [x0, y0, x1, y1] (any two corners). */
export function inBox(ed, b) {
  const [x0, y0, x1, y1] = selectionBox(b), out = [];
  for (const e of boxCandidates(ed, [x0, y0, x1, y1])) {
    const k = e * 4;
    if (ed.box[k] >= x0 && ed.box[k + 2] <= x1 && ed.box[k + 1] >= y0 && ed.box[k + 3] <= y1) out.push(e);
  }
  return out.sort((a, b) => a - b);
}

const selectionBox = (b) => [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])];
function boxCandidates(ed, b) {
  const ix = ed.ix;
  if (!ix.G) return [];
  const at = (v) => Math.min(ix.G - 1, Math.max(0, Math.floor(v)));
  const i0 = at((b[0] - ix.x0) / ix.cell), i1 = at((b[2] - ix.x0) / ix.cell), j0 = at((b[1] - ix.y0) / ix.cell), j1 = at((b[3] - ix.y0) / ix.cell), seen = new Set(ed.bw);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const e of ed.bc.get(i * 4096 + j) || []) seen.add(e);
  return [...seen].filter((e) => { const k = e * 4; return ed.box[k] <= b[2] && ed.box[k + 2] >= b[0] && ed.box[k + 1] <= b[3] && ed.box[k + 3] >= b[1]; });
}
const pointInBox = (p, b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];

function segmentCrossBox(a, c, b) {
  let lo = 0, hi = 1;
  for (let k = 0; k < 2; k++) {
    const d = c[k] - a[k];
    if (!d) { if (a[k] < b[k] || a[k] > b[k + 2]) return false; }
    else {
      const t0 = (b[k] - a[k]) / d, t1 = (b[k + 2] - a[k]) / d;
      lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
      if (lo > hi) return false;
    }
  }
  return true;
}

/** The transformed curve c + u cos(t) + v sin(t), including circular arcs and stretched blocks. */
function curveCrossBox(c, u, v, start, sweep, b) {
  const tau = 2 * Math.PI, at = (t) => [c[0] + u[0] * Math.cos(t) + v[0] * Math.sin(t), c[1] + u[1] * Math.cos(t) + v[1] * Math.sin(t)];
  if (pointInBox(at(start), b) || pointInBox(at(start + sweep), b)) return true;
  for (let k = 0; k < 2; k++) for (const edge of [b[k], b[k + 2]]) {
    const r = Math.hypot(u[k], v[k]);
    if (!r) continue;
    const q = (edge - c[k]) / r;
    if (Math.abs(q) > 1 + 1e-12) continue;
    const angle = Math.acos(Math.max(-1, Math.min(1, q))), phase = Math.atan2(v[k], u[k]);
    for (const t of [phase - angle, phase + angle]) {
      const rel = (((t - start) * Math.sign(sweep) % tau) + tau) % tau, p = at(t), other = 1 - k;
      if ((rel <= Math.abs(sweep) + 1e-10 || rel >= tau - 1e-10) && p[other] >= b[other] - 1e-10 && p[other] <= b[other + 2] + 1e-10) return true;
    }
  }
  return false;
}

function itemCrossBox(it, m, b) {
  if (it.k === 't' || !it.ops) return it.b[0] <= b[2] && it.b[2] >= b[0] && it.b[1] <= b[3] && it.b[3] >= b[1];
  const curve = (cx, cy, ux, uy, vx, vy, start, sweep) => curveCrossBox(mapply(m, cx, cy), [m[0] * ux + m[2] * uy, m[1] * ux + m[3] * uy], [m[0] * vx + m[2] * vy, m[1] * vx + m[3] * vy], start, sweep, b);
  if (it.ell) {
    const [cx, cy, , ux, uy, vx, vy, start, end] = it.ell;
    return curve(cx, cy, ux, uy, vx, vy, start, end - start);
  }
  let cur = null, first = null;
  const ops = it.ops;
  for (let k = 0; k < ops.length;) {
    const op = ops[k];
    if (op === 0 || op === 1) {
      const p = mapply(m, ops[k + 1], ops[k + 2]);
      if (pointInBox(p, b) || (op === 1 && cur && segmentCrossBox(cur, p, b))) return true;
      cur = p; if (op === 0) first = p; k += 3;
    } else if (op === 2) {
      const [cx, cy, r, a0, a1, acw] = ops.slice(k + 1, k + 7), sw = arcSweepOp(a0, a1, acw === 1);
      if (curve(cx, cy, r, 0, 0, r, a0, sw)) return true;
      cur = mapply(m, cx + r * Math.cos(a1), cy + r * Math.sin(a1)); k += 7;
    } else {
      if (cur && first && segmentCrossBox(cur, first, b)) return true;
      cur = first; k++;
    }
  }
  return false;
}

/** Entities whose geometry touches or lies inside the box; an enclosing curve alone does not count. */
export function crossBox(ed, corners) {
  const b = selectionBox(corners), out = [];
  for (const e of boxCandidates(ed, b)) {
    if (ed.byEnt[e].some((i) => itemCrossBox(ed.items[i], ed.fl.mats[ed.items[i].m], b))) out.push(e);
  }
  return out.sort((a, b) => a - b);
}

// ---------------------------------------------------------------- tiny gaps (TODO 46)

/** Ends closer than this (drawing units) count as joined: a DXF is written with 6 decimals, so ends joined exactly come back up to ~1.4e-6 apart. */
const JOINED = 2e-6;
const GAP_SKIP = /^(TEXT|MTEXT|ATTRIB|ATTDEF|DIMENSION|HATCH|LEADER|MLEADER|MULTILEADER)$/;
/** True when the ends of a cluster all pair up with another end within JOINED (already joined, as after a bridging Join gaps). */
function pairedUp(g, px, py) {
  if (g.length % 2) return false;
  const left = g.slice();
  while (left.length) {
    const a = left.pop(), k = left.findIndex((b) => Math.hypot(px(a) - px(b), py(a) - py(b)) <= JOINED);
    if (k < 0) return false;
    left.splice(k, 1);
  }
  return true;
}
/**
 * Ends that almost meet (TODO 46): every free end (ed.ends) within `tol` of another is one cluster (single linkage); a
 * cluster whose ends are all within 2e-6 of each other (joined, up to the file's 6 decimals) is not a gap. Ends that already meet exactly are not gaps.
 * Returns [{ x, y, spread, ends: [{ e, k }] }]: x, y the mean of the ends (for two ends, their midpoint), k 0 / 1 = start / end.
 */
export function findGaps(ed, tol) {
  const ids = [];
  for (const e of ed.shown) {
    const ent = ed.raw.entities[e];
    if (GAP_SKIP.test(ent.type)) continue;
    if (!Number.isNaN(ed.ends[e * 4])) ids.push(e * 2, e * 2 + 1);
  }
  const px = (id) => ed.ends[(id >> 1) * 4 + (id & 1) * 2], py = (id) => ed.ends[(id >> 1) * 4 + (id & 1) * 2 + 1];
  const cell = Math.max(tol, 1e-12), map = new Map(), key = (i, j) => i + ',' + j;
  for (const id of ids) { const k = key(Math.floor(px(id) / cell), Math.floor(py(id) / cell)); const l = map.get(k); if (l) l.push(id); else map.set(k, [id]); }
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (a) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
  const t2 = tol * tol;
  for (const id of ids) {
    const x = px(id), y = py(id), cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const o of map.get(key(cx + i, cy + j)) || []) {
        if (o <= id) continue;
        const dx = px(o) - x, dy = py(o) - y;
        if (dx * dx + dy * dy <= t2) parent.set(find(o), find(id));
      }
    }
  }
  const groups = new Map();
  for (const id of ids) { const r = find(id); const l = groups.get(r); if (l) l.push(id); else groups.set(r, [id]); }
  const out = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    if (g.every((id) => (id >> 1) === (g[0] >> 1)) && entityLength(ed, g[0] >> 1) <= tol) continue;   // a micro piece alone, not a nearly closed outline
    let x = 0, y = 0;
    for (const id of g) { x += px(id); y += py(id); }
    x /= g.length; y /= g.length;
    let spread = 0;
    for (const a of g) for (const b of g) spread = Math.max(spread, Math.hypot(px(a) - px(b), py(a) - py(b)));
    if (spread <= JOINED) continue;
    if (pairedUp(g, px, py)) continue;                                          // a bridge piece already joins each side: two exact pairs
    out.push({ x, y, spread, ends: g.map((id) => ({ e: id >> 1, k: id & 1 })).sort((a, b) => a.e - b.e || a.k - b.k) });
  }
  return out.sort((a, b) => a.ends[0].e - b.ends[0].e);
}

export const GAP_MARK_CAP = 50;
/** Keep the full count, but draw no rings above the cap or until Show is pressed. */
export const gapMarks = (gaps, show) => show && gaps.length <= GAP_MARK_CAP ? gaps.map((g) => [g.x, g.y]) : [];

const JOINABLE = new Set(['LINE', 'ARC', 'LWPOLYLINE', 'POLYLINE', 'SPLINE']);
const setv = (r, idx) => { const v = r.v.slice(); for (const [k, x] of idx) v[k] = text(x); return { ...r, v }; };
const nth = (r, code, which) => { let n = -1, last = -1; for (let k = 0; k < r.c.length; k++) if (r.c[k] === code) { n++; last = k; if (which >= 0 && n === which) return k; } return which < 0 ? last : -1; };
const nextCode = (r, from, code) => { for (let k = from + 1; k < r.c.length; k++) if (r.c[k] === code) return k; return -1; };

/** Moves the end points of one line, arc, polyline or spline record: `to` is [start | null, end | null]. Returns the new entity or null (cannot). */
function moveEnds(e, to) {
  const r = e.r, [s, t] = to, f = (code) => { const k = nth(r, code, 0); return k < 0 ? null : +r.v[k]; };
  switch (e.type) {
    case 'LINE': {
      const idx = [];
      if (s) idx.push([nth(r, 10, 0), s[0]], [nth(r, 20, 0), s[1]]);
      if (t) idx.push([nth(r, 11, 0), t[0]], [nth(r, 21, 0), t[1]]);
      if (idx.some((p) => p[0] < 0)) return null;
      return { ...e, r: setv(r, idx) };
    }
    case 'ARC': {
      // Both ends land exactly where they are asked to: the circle goes through the two new ends, its centre the point of
      // the chord's bisector nearest to the old centre (a 0.005 mm move changes the radius by about 0.005 mm).
      const cx = f(10), cy = f(20), rad = f(40), a0 = f(50) * Math.PI / 180, a1 = f(51) * Math.PI / 180;
      if ([cx, cy, rad, a0, a1].some((v) => v == null || !Number.isFinite(v))) return null;
      const p0 = s || [cx + rad * Math.cos(a0), cy + rad * Math.sin(a0)], p1 = t || [cx + rad * Math.cos(a1), cy + rad * Math.sin(a1)];
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1], L = Math.hypot(dx, dy);
      if (L < 1e-12) return null;
      const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2, nx = -dy / L, ny = dx / L, d = (cx - mx) * nx + (cy - my) * ny;
      const ncx = mx + nx * d, ncy = my + ny * d, nr = Math.hypot(p0[0] - ncx, p0[1] - ncy);
      const deg = (a) => { let v = a * 180 / Math.PI; v %= 360; if (v < 0) v += 360; return v; };
      const idx = [[nth(r, 10, 0), ncx], [nth(r, 20, 0), ncy], [nth(r, 40, 0), nr], [nth(r, 50, 0), deg(Math.atan2(p0[1] - ncy, p0[0] - ncx))], [nth(r, 51, 0), deg(Math.atan2(p1[1] - ncy, p1[0] - ncx))]];
      if (idx.some((p) => p[0] < 0)) return null;
      return { ...e, r: setv(r, idx) };
    }
    case 'LWPOLYLINE': {
      const first = nth(r, 10, 0), last = nth(r, 10, -1);
      if (first < 0) return null;
      const idx = [];
      const put = (k, p) => { const ky = nextCode(r, k, 20); if (ky < 0) return false; idx.push([k, p[0]], [ky, p[1]]); return true; };
      if (s && !put(first, s)) return null;
      if (t && !put(last, t)) return null;
      return { ...e, r: setv(r, idx) };
    }
    case 'POLYLINE': {
      const fl = f(70) || 0;
      if (fl & (16 | 32 | 64)) return null;                                   // a mesh
      const vs = (e.kids || []).filter((k) => k.type === 'VERTEX');
      if (vs.length < 2) return null;
      const kids = e.kids.slice(), move = (v, p) => { const a = nth(v, 10, 0), b = nth(v, 20, 0); if (a < 0 || b < 0) return null; return setv(v, [[a, p[0]], [b, p[1]]]); };
      if (s) { const nv = move(vs[0], s); if (!nv) return null; kids[kids.indexOf(vs[0])] = nv; }
      if (t) { const nv = move(vs[vs.length - 1], t); if (!nv) return null; kids[kids.indexOf(vs[vs.length - 1])] = nv; }
      return { ...e, kids };
    }
    case 'SPLINE': {
      // simple cases only: a clamped spline's first / last control point is its end; a spline given by fit points only has them as ends
      const cps = [], fits = [];
      for (let k = 0; k < r.c.length; k++) { if (r.c[k] === 10) cps.push(k); else if (r.c[k] === 11) fits.push(k); }
      let codes;
      if (cps.length >= 2) {
        const deg = f(71) || 3, knots = [];
        for (let k = 0; k < r.c.length; k++) if (r.c[k] === 40) knots.push(+r.v[k]);
        const n = knots.length;
        if (n < 2 * (deg + 1) || knots.slice(0, deg + 1).some((v) => v !== knots[0]) || knots.slice(n - deg - 1).some((v) => v !== knots[n - 1])) return null;
        codes = [cps[0], cps[cps.length - 1], 20];
      } else if (fits.length >= 2 && !cps.length) codes = [fits[0], fits[fits.length - 1], 21];
      else return null;
      const idx = [];
      const put = (k, p) => { const ky = nextCode(r, k, codes[2]); if (ky < 0) return false; idx.push([k, p[0]], [ky, p[1]]); return true; };
      if (s && !put(codes[0], s)) return null;
      if (t && !put(codes[1], t)) return null;
      return { ...e, r: setv(r, idx) };
    }
    default: return null;
  }
}

/** Length along an entity's drawn paths, including arc sweeps rather than their chords (drawing units). */
function entityLength(ed, e) {
  let length = 0;
  for (const i of ed.byEnt[e]) {
    const it = ed.items[i], ops = it.ops, m = ed.fl.mats[it.m];
    let p;
    for (let k = 0; k < ops.length;) {
      const op = ops[k];
      if (op === 0 || op === 1) {
        const q = mapply(m, ops[k + 1], ops[k + 2]);
        if (op === 1) length += Math.hypot(q[0] - p[0], q[1] - p[1]);
        p = q; k += 3;
      } else if (op === 2) {
        length += Math.abs(ops[k + 3] * arcSweepOp(ops[k + 4], ops[k + 5], ops[k + 6] === 1)) * mscale(m);
        p = mapply(m, ops[k + 1] + ops[k + 3] * Math.cos(ops[k + 5]), ops[k + 2] + ops[k + 3] * Math.sin(ops[k + 5]));
        k += 7;
      } else k++;
    }
  }
  return length;
}

/**
 * Removes micro pieces (TODO 104): own length <= tol and an end within tol of a longer entity's end.
 * Then joins the remaining gaps with joinGaps.
 * eligible protects locked entities; indexes refer to the input document throughout. One result is one undo state.
 * → { entities, blocks, removed, joined (gaps closed), skipped: { TYPE: ends left }, changed (entities edited or removed) }.
 */
export function joinTinyGaps(raw, ed, tol, eligible = () => true, method = 'average') {
  const lengths = new Map(ed.shown.filter((e) => !GAP_SKIP.test(raw.entities[e].type) && !Number.isNaN(ed.ends[e * 4])).map((e) => [e, entityLength(ed, e)]));
  const graph = buildGraph(ed, tol), drop = new Set(), touch = new Map(), link = new Map();
  const px = (id) => ed.ends[(id >> 1) * 4 + (id & 1) * 2], py = (id) => ed.ends[(id >> 1) * 4 + (id & 1) * 2 + 1];
  const near = (e, fn) => {
    for (const k of [0, 1]) {
      const x = px(e * 2 + k), y = py(e * 2 + k), cx = Math.floor(x / graph.cell), cy = Math.floor(y / graph.cell);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        for (const id of graph.map.get(graph.key(cx + i, cy + j)) || []) if (Math.hypot(px(id) - x, py(id) - y) <= tol) fn(id);
      }
    }
  };
  // a micro piece that touches a longer entity's end, and which other such pieces and long ends it meets
  for (const [e, length] of lengths) {
    if (!(length <= tol) || !eligible(e)) continue;
    const longs = new Set();
    near(e, (id) => { if (lengths.get(id >> 1) > tol) longs.add(id); });
    if (longs.size) touch.set(e, longs);
  }
  for (const e of touch.keys()) { const l = new Set(); near(e, (id) => { if (touch.has(id >> 1) && id >> 1 !== e) l.add(id >> 1); }); link.set(e, l); }
  // dropping a connected group must leave only gaps that join: its long ends are within tol of each other and free to move
  const seen = new Set();
  for (const first of touch.keys()) {
    if (seen.has(first)) continue;
    const group = [first], longs = new Set();
    seen.add(first);
    for (let n = 0; n < group.length; n++) {
      for (const id of touch.get(group[n])) longs.add(id);
      for (const o of link.get(group[n])) if (!seen.has(o)) { seen.add(o); group.push(o); }
    }
    const ids = [...longs];
    const ok = ids.every((a) => ids.every((b) => {
      const d = Math.hypot(px(a) - px(b), py(a) - py(b));
      return d <= JOINED || (d <= tol && eligible(a >> 1) && eligible(b >> 1));
    }));
    if (ok) for (const e of group) drop.add(e);
  }
  const gaps = findGaps({ ...ed, shown: ed.shown.filter((e) => !drop.has(e)) }, tol).filter((g) => g.ends.every((x) => eligible(x.e)));
  const result = joinGaps(raw, ed, gaps, method);
  return { ...result, entities: result.entities.filter((_, e) => !drop.has(e)), removed: drop.size, changed: result.changed + drop.size };
}

// ---------------------------------------------------------------- join methods (TODO 121)

/** How a gap is closed: the Join gaps box's Method list (average point is the original behaviour). */
export const JOIN_METHODS = { average: 'Average point', extend: 'Extend', chamfer: 'Chamfer', fillet: 'Fillet', bezier: 'Bezier' };
const unit = (x, y) => { const l = Math.hypot(x, y); return l > 1e-12 ? [x / l, y / l] : null; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const turn = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];

/** A polyline's vertices as [x, y, bulge], or null. */
function polyVerts(ent) {
  const out = [];
  if (ent.type === 'LWPOLYLINE') {
    const r = ent.r;
    for (let k = 0; k < r.c.length; k++) {
      if (r.c[k] === 10) out.push([+r.v[k], 0, 0]); else if (!out.length) continue;
      else if (r.c[k] === 20) out[out.length - 1][1] = +r.v[k]; else if (r.c[k] === 42) out[out.length - 1][2] = +r.v[k];
    }
  } else if (ent.type === 'POLYLINE') {
    for (const v of (ent.kids || []).filter((k) => k.type === 'VERTEX')) {
      const x = nth(v, 10, 0), y = nth(v, 20, 0), b = nth(v, 42, 0);
      if (x < 0 || y < 0) return null;
      out.push([+v.v[x], +v.v[y], b < 0 ? 0 : +v.v[b]]);
    }
  }
  return out.length >= 2 && out.every((p) => p.every(Number.isFinite)) ? out : null;
}

/**
 * Which way an entity's end points and how long its end piece is: { d: unit tangent leaving the end, len, line: a straight
 * piece, arc: { c, R } for an ARC } or null (a mirrored entity, a spline, an ellipse, ...).
 */
function endInfo(ent, k) {
  if (ent.flip) return null;
  const r = ent.r, f = (code) => { const i = nth(r, code, 0); return i < 0 ? NaN : +r.v[i]; };
  let a, b, bulge = 0;
  if (ent.type === 'LINE') { a = [f(10), f(20)]; b = [f(11), f(21)]; }
  else if (ent.type === 'ARC') {
    const c = [f(10), f(20)], R = f(40), a0 = f(50) * Math.PI / 180, a1 = f(51) * Math.PI / 180, t = k ? a1 : a0;
    if (![...c, R, a0, a1].every(Number.isFinite)) return null;
    return { d: k ? [-Math.sin(t), Math.cos(t)] : [Math.sin(t), -Math.cos(t)], len: R * arcSweepOp(a0, a1, false), arc: { c, R } };
  } else if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') {
    const vs = polyVerts(ent);
    if (!vs) return null;
    const n = vs.length;
    a = k ? vs[n - 2] : vs[0]; b = k ? vs[n - 1] : vs[1]; bulge = a[2];
  } else return null;
  if (![...a, ...b].every(Number.isFinite)) return null;
  const chord = [b[0] - a[0], b[1] - a[1]], u = unit(chord[0], chord[1]);
  if (!u) return null;
  const half = 2 * Math.atan(bulge);                                          // half the arc's included angle, signed
  return { d: k ? turn(u, half) : turn(u, -half).map((v) => -v), len: Math.hypot(chord[0], chord[1]), line: !bulge };
}

/** Where two end pieces meet when extended (or trimmed) along their own line / circle, nearest the gap and no further than `far`; or null. */
function meetPoint(Pa, A, Pb, B, far) {
  const cands = [];
  if (!A.arc && !B.arc) {
    const cr = cross(A.d, B.d);
    if (Math.abs(cr) < 1e-9) return null;
    const w = [Pb[0] - Pa[0], Pb[1] - Pa[1]], s = cross(w, B.d) / cr;
    cands.push([Pa[0] + s * A.d[0], Pa[1] + s * A.d[1]]);
  } else if (!A.arc || !B.arc) {
    const [P, D, C] = A.arc ? [Pb, B.d, A.arc] : [Pa, A.d, B.arc], q = [P[0] - C.c[0], P[1] - C.c[1]];
    const bq = dot(D, q), disc = bq * bq - (dot(q, q) - C.R * C.R);
    if (disc >= 0) for (const s of [-bq + Math.sqrt(disc), -bq - Math.sqrt(disc)]) cands.push([P[0] + s * D[0], P[1] + s * D[1]]);
  } else {
    const c1 = A.arc.c, c2 = B.arc.c, dx = c2[0] - c1[0], dy = c2[1] - c1[1], L = Math.hypot(dx, dy), r1 = A.arc.R, r2 = B.arc.R;
    if (L > 1e-12 && L <= r1 + r2 && L >= Math.abs(r1 - r2)) {
      const a = (r1 * r1 - r2 * r2 + L * L) / (2 * L), hh = Math.sqrt(Math.max(0, r1 * r1 - a * a)), mx = c1[0] + a * dx / L, my = c1[1] + a * dy / L;
      cands.push([mx + hh * dy / L, my - hh * dx / L], [mx - hh * dy / L, my + hh * dx / L]);
    }
  }
  let best = null, bestSum = Infinity;
  for (const X of cands) {
    const ok = (P, I) => { const dist = Math.hypot(X[0] - P[0], X[1] - P[1]); return dist <= far && (dot([X[0] - P[0], X[1] - P[1]], I.d) >= 0 || dist < 0.9 * I.len); };
    const sum = Math.hypot(X[0] - Pa[0], X[1] - Pa[1]) + Math.hypot(X[0] - Pb[0], X[1] - Pb[1]);
    if (ok(Pa, A) && ok(Pb, B) && sum < bestSum) { best = X; bestSum = sum; }
  }
  return best;
}

const deg360 = (a) => { let v = a * 180 / Math.PI % 360; if (v < 0) v += 360; return v; };
/** The properties a new piece takes from `src` (layer, colour, line type). */
const like = (s) => ({ layer: s.layer, lt: s.lt, aci: s.aci, tc: s.tc, lw: s.lw, lts: s.lts, ps: s.ps });
const lineEntity = (src, p, q) => line(p[0], p[1], q[0], q[1], like(src));
const arcEntity = (src, c, R, a0, a1) => arc(c[0], c[1], R, deg360(a0), deg360(a1), like(src));
const BEZIER_PIECES = 12;
const bezierEntity = (src, p, q, dp, dq, h) => {
  const c1 = [p[0] + dp[0] * h, p[1] + dp[1] * h], c2 = [q[0] + dq[0] * h, q[1] + dq[1] * h], pts = [];
  for (let i = 0; i <= BEZIER_PIECES; i++) {
    const t = i / BEZIER_PIECES, u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    pts.push(i === 0 ? p : i === BEZIER_PIECES ? q : [w[0] * p[0] + w[1] * c1[0] + w[2] * c2[0] + w[3] * q[0], w[0] * p[1] + w[1] * c1[1] + w[2] * c2[1] + w[3] * q[1]]);
  }
  return lwpoly(pts, like(src));
};
/** The polyline `ent` with its closed flag set (70 bit 1). */
function closedPoly(ent) {
  const r = ent.r, k = nth(r, 70, 0);
  if (k >= 0) return { ...ent, r: setv(r, [[k, (+r.v[k] || 0) | 1]]) };
  const at = nth(r, 90, 0) + 1;                                               // 70 follows the vertex count
  return { ...ent, r: { ...r, c: [...r.c.slice(0, at), 70, ...r.c.slice(at)], v: [...r.v.slice(0, at), '1', ...r.v.slice(at)] } };
}

/**
 * Moves the ends of each gap together (TODO 46): to the mean of the cluster, i.e. the midpoint of a pair. A cluster holding an
 * end that cannot be moved (an ellipse, a mirrored arc, ...) is moved to that end instead; if two such ends differ it is skipped.
 * method (TODO 121) works on pairs of ends and leaves the rest, and any pair it cannot do, to the average point:
 * extend (both pieces to where they meet), chamfer (a straight bridge, a polyline's own ends closed), fillet (a tangent arc
 * at the corner, else chamfer), bezier (a tangent curve of short pieces).
 * → { entities, blocks, joined (gaps closed), by: { method: gaps closed that way }, skipped: { TYPE: ends left }, changed (entities edited or added) }.
 */
export function joinGaps(raw, ed, gaps, method = 'average') {
  const to = new Map(), skipped = {}, added = [], closed = new Set(), by = {};
  let joined = 0;
  const movable = (e) => { const ent = raw.entities[e]; return JOINABLE.has(ent.type) && !ent.flip; };
  const pos = (x) => [ed.ends[x.e * 4 + x.k * 2], ed.ends[x.e * 4 + x.k * 2 + 1]];
  const move = (x, p) => { const cur = to.get(x.e) || [null, null]; cur[x.k] = p; to.set(x.e, cur); };
  /** One pair by `how`: moves ends, adds pieces. false when the method cannot do it. */
  const bridge = (xa, xb, how) => {
    const pa = pos(xa), pb = pos(xb), gap = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]), A = endInfo(raw.entities[xa.e], xa.k), B = endInfo(raw.entities[xb.e], xb.k);
    const src = raw.entities[xa.e];
    if (how === 'extend') {
      const X = A && B && movable(xa.e) && movable(xb.e) && meetPoint(pa, A, pb, B, 10 * gap);
      if (!X) return false;
      move(xa, X); move(xb, X);
    } else if (how === 'fillet') {
      const cr = A && B && A.line && B.line && movable(xa.e) && movable(xb.e) ? cross(A.d, B.d) : 0;
      if (Math.abs(cr) < 1e-9) return false;
      const w = [pb[0] - pa[0], pb[1] - pa[1]], s = cross(w, B.d) / cr, t = cross(w, A.d) / cr, T = Math.max(s, t);
      if (T <= 1e-9 || Math.abs(s) > 10 * gap || Math.abs(t) > 10 * gap || T - s >= 0.9 * A.len || T - t >= 0.9 * B.len) return false;
      const X = [pa[0] + s * A.d[0], pa[1] + s * A.d[1]], ua = [-A.d[0], -A.d[1]], ub = [-B.d[0], -B.d[1]], half = Math.acos(Math.max(-1, Math.min(1, dot(ua, ub)))) / 2;
      const bis = unit(ua[0] + ub[0], ua[1] + ub[1]);
      if (!bis || half < 1e-6 || half > Math.PI / 2 - 1e-6) return false;
      const ta = [X[0] + ua[0] * T, X[1] + ua[1] * T], tb = [X[0] + ub[0] * T, X[1] + ub[1] * T], R = T * Math.tan(half), dc = T / Math.cos(half);
      const C = [X[0] + bis[0] * dc, X[1] + bis[1] * dc], va = [ta[0] - C[0], ta[1] - C[1]], vb = [tb[0] - C[0], tb[1] - C[1]];
      move(xa, ta); move(xb, tb);
      added.push(cross(va, vb) > 0 ? arcEntity(src, C, R, Math.atan2(va[1], va[0]), Math.atan2(vb[1], vb[0])) : arcEntity(src, C, R, Math.atan2(vb[1], vb[0]), Math.atan2(va[1], va[0])));
    } else if (how === 'chamfer') {
      const ent = raw.entities[xa.e], vs = xa.e === xb.e && ent.type === 'LWPOLYLINE' && polyVerts(ent);
      if (vs && vs[vs.length - 1][2] === 0) closed.add(xa.e); else added.push(lineEntity(src, pa, pb));
    } else {
      const chord = unit(pb[0] - pa[0], pb[1] - pa[1]);
      if (!chord) return false;
      added.push(bezierEntity(src, pa, pb, A ? A.d : chord, B ? B.d : [-chord[0], -chord[1]], 0.4 * gap));
    }
    by[how] = (by[how] || 0) + 1;
    return true;
  };
  for (const g of gaps) {
    if (method !== 'average' && g.ends.length === 2 && (bridge(g.ends[0], g.ends[1], method) || method === 'fillet' && bridge(g.ends[0], g.ends[1], 'chamfer'))) { joined++; continue; }
    const fixed = g.ends.filter((x) => !movable(x.e));
    let target = [g.x, g.y];
    if (fixed.length) {
      const a = pos(fixed[0]);
      if (fixed.some((x) => Math.hypot(pos(x)[0] - a[0], pos(x)[1] - a[1]) > 1e-9)) { for (const x of fixed) { const t = raw.entities[x.e].type; skipped[t] = (skipped[t] || 0) + 1; } continue; }
      target = a;
    }
    for (const x of g.ends) {
      if (!movable(x.e)) { const t = raw.entities[x.e].type; skipped[t] = (skipped[t] || 0) + 1; continue; }
      const cur = to.get(x.e) || [null, null];
      cur[x.k] = target; to.set(x.e, cur);
    }
    joined++; by.average = (by.average || 0) + 1;
  }
  const entities = raw.entities.slice();
  let changed = 0;
  for (const [e, ends] of to) {
    const ne = moveEnds(raw.entities[e], ends);
    if (ne) { entities[e] = ne; changed++; } else { const t = raw.entities[e].type; skipped[t] = (skipped[t] || 0) + 1; }
  }
  for (const e of closed) { entities[e] = closedPoly(entities[e]); if (!to.has(e)) changed++; }
  entities.push(...added);                                                   // after the old ones, so indexes into `raw` still hold
  return { entities, blocks: raw.blocks, joined, by, skipped, changed: changed + added.length };
}

// ---------------------------------------------------------------- deleting

const fieldOf = (r, code) => { const k = r.c.indexOf(code); return k < 0 ? '' : String(r.v[k]).trim(); };

/** The block names a list of entities uses, and the blocks those use in turn. */
function usedBlocks(blocks, entities) {
  const used = new Set(), todo = [];
  const scan = (list) => { for (const e of list) if (e.type === 'INSERT' || e.type === 'DIMENSION' || e.type === 'ACAD_TABLE') { const nm = fieldOf(e.r, 2); if (nm && !used.has(nm)) { used.add(nm); todo.push(nm); } } };
  scan(entities);
  while (todo.length) { const b = blocks[todo.pop()]; if (b && b.entities) scan(b.entities); }
  return used;
}

/** The document's entities and blocks without the entities in `drop` (a Set of indexes); blocks only they used are dropped too. */
export function removeEntities(raw, drop) {
  const entities = raw.entities.filter((_, i) => !drop.has(i)), blocks = { ...raw.blocks };
  const before = usedBlocks(raw.blocks, raw.entities), after = usedBlocks(raw.blocks, entities);
  for (const nm of before) if (!after.has(nm)) delete blocks[nm];
  return { entities, blocks };
}

/** Everything except the entities in `keep` is removed. */
export function keepOnly(raw, keep) {
  const drop = new Set();
  for (let i = 0; i < raw.entities.length; i++) if (!keep.has(i)) drop.add(i);
  return removeEntities(raw, drop);
}

// ---------------------------------------------------------------- scaling

const num = (v) => { const n = +v; return Number.isFinite(n) && String(v).trim() !== '' ? n : null; };
const text = (n) => String(+n.toPrecision(15));
// per type: the x codes that are points (moved about the anchor) and vectors (only scaled), and the codes that are lengths
export const SPEC = {
  LINE: { pts: [10, 11] }, POINT: { pts: [10] }, CIRCLE: { pts: [10], len: [39, 40] }, ARC: { pts: [10], len: [39, 40] },
  ELLIPSE: { pts: [10], vec: [11] }, LWPOLYLINE: { pts: [10], len: [38, 39, 40, 41, 43] }, POLYLINE: { pts: [], len: [39, 40, 41], z: [30] },
  VERTEX: { pts: [10], len: [40, 41] }, SPLINE: { pts: [10, 11] }, SOLID: { pts: [10, 11, 12, 13], len: [39] }, TRACE: { pts: [10, 11, 12, 13], len: [39] },
  '3DFACE': { pts: [10, 11, 12, 13] }, TEXT: { pts: [10, 11], len: [39, 40] }, ATTRIB: { pts: [10, 11], len: [39, 40] }, ATTDEF: { pts: [10, 11], len: [39, 40] },
  MTEXT: { pts: [10], len: [40, 41, 42, 43] }, INSERT: { pts: [10], len: [44, 45] },
  DIMENSION: { pts: [10, 11, 12, 13, 14, 15, 16], len: [40, 42] }, LEADER: { pts: [10], len: [40, 41] }, HATCH: {}
};
export const OCS = new Set(['CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE', 'TEXT', 'ATTRIB', 'INSERT', 'SOLID', 'TRACE', 'HATCH']);

/** Scales one record's pairs (codes are shared, values are new). a: the anchor [x, y] in this record's own coordinates. */
function scaleRecord(type, r, s, a) {
  const spec = SPEC[type];
  if (!spec) return null;
  if (type === 'HATCH') return scaleHatch(r, s, a);
  const pts = new Set(spec.pts || []), vec = new Set(spec.vec || []), len = new Set(spec.len || []), zs = new Set(spec.z || []);
  const v = r.v.slice();
  for (let k = 0; k < r.c.length; k++) {
    const c = r.c[k], n = num(v[k]);
    if (n == null) continue;
    if (pts.has(c)) v[k] = text(a[0] + (n - a[0]) * s);
    else if (pts.has(c - 10) && c >= 20 && c <= 28) v[k] = text(a[1] + (n - a[1]) * s);
    else if (vec.has(c) || vec.has(c - 10) || vec.has(c - 20)) v[k] = text(n * s);
    else if ((pts.has(c - 20) && c >= 30 && c <= 38) || zs.has(c) || len.has(c)) v[k] = text(n * s);
  }
  let c = r.c;
  if (type === 'INSERT') {                                          // the block's contents scale through the insert's factors
    let at = -1;
    const have = {};
    for (let k = 0; k < r.c.length; k++) { const code = r.c[k]; if ([10, 20, 30, 41, 42, 43].includes(code)) at = k; if ([41, 42, 43].includes(code) && !(code in have)) have[code] = k; }
    const add = [];
    for (const code of [41, 42, 43]) {
      if (code in have) { const n = num(v[have[code]]); v[have[code]] = text((n == null || n === 0 ? 1 : n) * s); } else add.push([code, text(s)]);
    }
    if (add.length) {
      const cc = r.c.slice(), vv = v.slice();
      cc.splice(at + 1, 0, ...add.map((x) => x[0])); vv.splice(at + 1, 0, ...add.map((x) => x[1]));
      return { ...r, c: cc, v: vv };
    }
  }
  return { ...r, c, v };
}

/** A hatch: boundary geometry about the anchor; the pattern's scale, spacing and dashes by s. */
function scaleHatch(r, s, a) {
  const v = r.v.slice();
  let st = 'head', flags = 0, edge = 0;
  for (let k = 0; k < r.c.length; k++) {
    const c = r.c[k], n = num(v[k]);
    if (c === 91 && st === 'head') { st = 'paths'; continue; }
    if (c === 75 && st === 'paths') { st = 'pat'; continue; }
    if (c === 98) { st = 'seed'; continue; }
    if (n == null) continue;
    if (st === 'head') { if (c === 30) v[k] = text(n * s); }
    else if (st === 'paths') {
      if (c === 92) { flags = n; edge = 0; } else if (c === 72 && !(flags & 2)) edge = n;
      else if (c === 10 || c === 11 && edge !== 3) v[k] = text(a[0] + (n - a[0]) * s);
      else if (c === 20 || c === 21 && edge !== 3) v[k] = text(a[1] + (n - a[1]) * s);
      else if (c === 11 || c === 21) v[k] = text(n * s);            // an ellipse edge's major axis
      else if (c === 40 && edge === 2) v[k] = text(n * s);          // an arc edge's radius
    } else if (st === 'pat') {
      if ([41, 43, 44, 45, 46, 47, 49].includes(c)) v[k] = text(n * s);
    } else if (st === 'seed') {
      if (c === 10) v[k] = text(a[0] + (n - a[0]) * s); else if (c === 20) v[k] = text(a[1] + (n - a[1]) * s);
    }
  }
  return { ...r, v };
}

/**
 * The entities of the shown space (space 0 model, 1 paper) scaled by s about (ax, ay); other spaces stay. A DIMENSION's
 * block is scaled with it. skipped: { TYPE: count } of what has no scaling here (it stays as it was).
 */
/** Kept dimension blocks: PD_DIM_n aligned, PD_DIM_H / V n linear, PD_DIM_R / D / A n radius, diameter, angle. */
export const DIM_BLOCK = /^PD_DIM_/;
/** The blocks a leader lives in (leader.js). */
export const LDR_BLOCK = /^PD_LDR_/;
export const DIM_LAYER = 'Dimensions';
/** Decimal places in a dimension's text ("300.00" → 2; "R25.00", "7.87\"" and "45.00°" too). */
const placesOf = (t) => { const m = /\.(\d+)["°]?$/.exec(String(t)); return m ? m[1].length : 0; };
/** A dimension's value with exactly dp decimals (0–4), no "-0". */
export const dimText = (v, dp = 2) => { const s = Number(v).toFixed(dp); return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s; };
/** The text of a dimension: its prefix (R, Ø), the number with dp decimals, in inches (then ended by ") when units is 'inch'. */
export const dimLabel = (mm, dp = 2, units = 'mm', prefix = '') => prefix + (units === 'inch' ? dimText(mm / 25.4, dp) + '"' : dimText(mm, dp));
const unesc = (s) => String(s).replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));     // a saved file writes Ø and ° as \U+00D8
/** A scaled dimension's text says its new length: the old number times s, with as many decimals as it had (an angle keeps its value). */
export function relabel(ents, s) {
  return ents.map((e) => {
    if (e.type !== 'TEXT') return e;
    const k = e.r.c.indexOf(1), m = k < 0 ? null : /^([RØ]?)(-?\d+(?:\.\d+)?)(["°]?)$/.exec(unesc(e.r.v[k]));
    if (!m || m[3] === '°') return e;
    const vv = e.r.v.slice(); vv[k] = m[1] + dimText(+m[2] * s, placesOf(unesc(e.r.v[k]))) + m[3];
    return { ...e, r: { ...e.r, v: vv } };
  });
}
/**
 * Every kept dimension re-labelled with dp decimals, from its own geometry (drawing units × factor), so no rounding
 * piles up. → { entities, blocks } (as commit takes), or null when nothing changes.
 */
export function relabelDims(raw, factor, dp) {
  const blocks = { ...raw.blocks };
  let changed = false;
  for (const [nm, b] of Object.entries(raw.blocks)) {
    const m = readDim(nm, b), g = m && dimGeom(m.kind, m.params, factor || 1, dp);
    if (!g) continue;
    const ents = b.entities.map((e) => {
      if (e.type !== 'TEXT') return e;
      const k = e.r.c.indexOf(1);
      if (k < 0 || unesc(e.r.v[k]) === g.label) return e;
      const vv = e.r.v.slice(); vv[k] = g.label; changed = true;
      return { ...e, r: { ...e.r, v: vv } };
    });
    blocks[nm] = { ...b, entities: ents };
  }
  return changed ? { entities: raw.entities, blocks } : null;
}

export function scaleAbout(raw, s, ax, ay, space = 0, selection = null) {
  const skipped = {}, blocks = { ...raw.blocks }, doneBlocks = new Set();
  const one = (e) => {
    if (e.type === 'INSERT' && (DIM_BLOCK.test(fieldOf(e.r, 2)) || LDR_BLOCK.test(fieldOf(e.r, 2)))) {         // a kept dimension or leader: its block is scaled (a dimension's value re-labelled); the insert stays put
      const nm = fieldOf(e.r, 2), b = raw.blocks[nm];
      if (b && !doneBlocks.has(nm)) { doneBlocks.add(nm); blocks[nm] = { ...b, entities: DIM_BLOCK.test(nm) ? relabel(b.entities.map(one), s) : b.entities.map(one) }; }
      return e;
    }
    const a = e.flip && OCS.has(e.type) ? [-ax, ay] : [ax, ay];
    const r = scaleRecord(e.type, e.r, s, a);
    if (!r) { skipped[e.type] = (skipped[e.type] || 0) + 1; return e; }
    let kids = e.kids;
    if (kids) kids = kids.map((kid) => scaleRecord(kid.type, kid, s, a) || kid);
    if (e.type === 'DIMENSION') {
      const nm = fieldOf(e.r, 2), b = raw.blocks[nm];
      if (b && !b.xref && !doneBlocks.has(nm)) { doneBlocks.add(nm); blocks[nm] = { ...b, entities: b.entities.map(one) }; }
    }
    return { ...e, r: { ...e.r, c: r.c, v: r.v }, kids };
  };
  const entities = raw.entities.map((e, i) => ((e.ps ? 1 : 0) === space && (!selection || selection.has(i)) ? one(e) : e));
  return { entities, blocks, skipped };
}

/** Resize about the bottom-left; refuse the whole edit when an entity cannot stay exact. */
export function resizeAbout(raw, sx, sy, ax, ay, space = 0, selection = null) {
  if (![sx, sy, ax, ay].every(Number.isFinite) || sx <= 0 || sy <= 0) throw new Error('Type a size above 0');
  if (Math.abs(sx - sy) < 1e-12) return scaleAbout(raw, sx, ax, ay, space, selection);
  // shortcut: other DXF types refuse non-uniform scaling; add exact transforms when those types need independent W / H.
  const supported = new Set(['LINE', 'POINT', 'LWPOLYLINE', 'POLYLINE', 'SPLINE', 'SOLID', 'TRACE', '3DFACE']);
  const records = (e) => [e.r, ...(e.kids || [])];
  const entities = raw.entities.map((e, i) => {
    if ((e.ps ? 1 : 0) !== space || selection && !selection.has(i)) return e;
    if (!supported.has(e.type) || records(e).some((r) => r.c.some((c, k) =>
      ['LWPOLYLINE', 'POLYLINE', 'VERTEX'].includes(r.type) && [40, 41, 42, 43].includes(c) && +r.v[k] !== 0))) {
      throw new Error('Cannot resize ' + e.type + ' with proportions unlocked. Lock the padlock to scale proportionally; arcs, circles, curved or wide polylines and other unsupported objects stay unchanged.');
    }
    const x = e.flip && OCS.has(e.type) ? -ax : ax;
    const scaled = (r) => ({ ...r, v: r.v.map((v, k) => {
      const c = r.c[k], pts = SPEC[r.type]?.pts || [];
      if (pts.includes(c)) return text(x + (+v - x) * sx);
      if (pts.includes(c - 10)) return text(ay + (+v - ay) * sy);
      if (e.type === 'SPLINE' && [12, 13, 22, 23].includes(c)) return text(+v * (c < 20 ? sx : sy));
      return v;
    }) });
    return { ...e, r: scaled(e.r), kids: e.kids?.map(scaled) };
  });
  return { entities, blocks: raw.blocks, skipped: {} };
}

/** Translate selected records; sizes, direction vectors and shared blocks stay unchanged. Copy also isolates unshared native dimension blocks. */
export function moveEntities(raw, selection, dx, dy, copy = false) {
  if (![dx, dy].every(Number.isFinite)) throw new Error('Move needs finite distances');
  const record = (type, r, x) => {
    if (type === 'HATCH') return moveHatch(r, x, dy);
    if (type === 'MLEADER' || type === 'MULTILEADER') return moveMleader(r, x, dy);
    const pts = ['ACAD_TABLE', 'WIPEOUT', 'IMAGE', 'VIEWPORT'].includes(type) ? [10] : SPEC[type]?.pts;
    if (!pts) throw new Error('Cannot move ' + type);
    return { ...r, v: r.v.map((v, k) => pts.includes(r.c[k]) ? text(+v + x) : pts.includes(r.c[k] - 10) ? text(+v + dy) : v) };
  };
  let blocks = raw.blocks, blockRefs;
  const movedDims = new Map();
  const countRefs = (entities) => {
    for (const e of entities) if (['INSERT', 'DIMENSION', 'ACAD_TABLE'].includes(e.type)) {
      const name = fieldOf(e.r, 2); blockRefs.set(name, (blockRefs.get(name) || 0) + 1);
    }
  };
  const one = (e) => {
    const x = e.flip && OCS.has(e.type) ? -dx : dx;
    let r = record(e.type, e.r, x);
    if (e.type === 'DIMENSION') {
      const name = fieldOf(e.r, 2), b = raw.blocks[name];
      if (b && !b.xref) {
        if (!blockRefs) {
          blockRefs = new Map();
          countRefs(raw.entities);
          for (const block of Object.values(raw.blocks)) countRefs(block.entities);
        }
        let own = movedDims.get(name);
        if (!own) {
          own = name;
          if (copy || blockRefs.get(name) > 1) {
            let n = 1;
            while (blocks['*D' + n]) n++;
            own = '*D' + n;
            countRefs(b.entities);       // The clone adds references before its nested dimensions move.
          }
          movedDims.set(name, own);
          // Native dimensions draw their block in world coordinates; isolate shared blocks before moving it.
          blocks = { ...blocks, [own]: b };
          const entities = b.entities.map(one);
          blocks = { ...blocks, [own]: { ...b, entities } };
        }
        r = { ...r, v: r.v.map((v, k) => r.c[k] === 2 ? own : v) };
      }
    }
    return { ...e, r, kids: e.kids?.map((kid) => record(kid.type, kid, OCS.has(kid.type) ? (+fieldOf(kid, 230) < 0 ? -dx : dx) : x)) };
  };
  const entities = raw.entities.map((e, i) => selection.has(i) ? one(e) : e);
  return { entities, blocks };
}

/** Boundary points and pattern origins move; ellipse axes, pattern spacing and radii stay. */
function moveHatch(r, dx, dy) {
  let stage = 'head', flags = 0, edge = 0;
  const v = r.v.map((v, k) => {
    const c = r.c[k];
    if (c === 91 && stage === 'head') stage = 'paths';
    else if (c === 75 && stage === 'paths') stage = 'pattern';
    else if (c === 98) stage = 'seed';
    else if (stage === 'paths') {
      if (c === 92) { flags = +v; edge = 0; }
      else if (c === 72 && !(flags & 2)) edge = +v;
      else if (c === 10 || c === 11 && edge !== 3) return text(+v + dx);
      else if (c === 20 || c === 21 && edge !== 3) return text(+v + dy);
    } else if (stage === 'pattern') {
      if (c === 43) return text(+v + dx);
      if (c === 44) return text(+v + dy);
    } else if (stage === 'seed') {
      if (c === 10) return text(+v + dx);
      if (c === 20) return text(+v + dy);
    }
    return v;
  });
  return { ...r, v };
}

function moveMleader(r, dx, dy) {
  const stack = [];
  return { ...r, v: r.v.map((v, k) => {
    const c = r.c[k], s = v.trim();
    if (c === 300 && s === 'CONTEXT_DATA{') stack.push('ctx');
    else if (c === 302 && s === 'LEADER{') stack.push('leader');
    else if (c === 304 && s === 'LEADER_LINE{') stack.push('line');
    else if ([301, 303, 305].includes(c) && s === '}') stack.pop();
    const where = stack.at(-1);
    // DXF reuses point codes for directions in other MLeader sections.
    const pts = where === 'ctx' ? [10, 12, 15, 110] : where === 'leader' ? [10, 12, 13] : where === 'line' ? [10, 11, 12] : [];
    if (pts.includes(c)) return text(+v + dx);
    if (pts.includes(c - 10)) return text(+v + dy);
    return v;
  }) };
}

/** Append translated copies in drawing order, leaving the originals and shared blocks intact; copied dimensions and leaders get their own blocks. */
export function copyEntities(raw, selection, dx, dy) {
  const moved = moveEntities(raw, selection, dx, dy, true);
  let blocks = moved.blocks;
  const copies = moved.entities.filter((_, i) => selection.has(i)).map((e) => {
    const name = e.type === 'INSERT' ? fieldOf(e.r, 2) : '';
    if ((!DIM_BLOCK.test(name) && !LDR_BLOCK.test(name)) || !blocks[name]) return e;
    let own;
    if (LDR_BLOCK.test(name)) {
      let n = 1;
      while (blocks['PD_LDR_' + n]) n++;
      own = 'PD_LDR_' + n;
    } else {
      const dim = readDim(name, blocks[name]);
      own = freeName(blocks, dim?.kind, dim?.params.axis);
    }
    blocks = { ...blocks, [own]: structuredClone(blocks[name]) };
    return { ...e, r: { ...e.r, v: e.r.v.map((v, k) => e.r.c[k] === 2 ? own : v) } };
  });
  return { entities: [...raw.entities, ...copies], blocks };
}

// ---------------------------------------------------------------- undo

/**
 * Undo and redo of states ({ entities, blocks }, or a layout's): push the state before a change, with a label for what the change is
 * (TODO 30; default 'Edit'); undo / redo hand back the one to restore. labels() lists the steps for the history list, and
 * undoMany(n, current) / redoMany(n, current) go several steps at once.
 */
export function createHistory(limit = 100) {
  let revision = 0;
  let undo = [], redo = [];                                  // entries { s: the state to go back to, label: the step it undoes }
  const h = {
    push(state, label = 'Edit') { revision++; undo.push({ s: state, label }); if (undo.length > limit) undo.shift(); redo = []; },
    undo(current) { revision++; const e = undo.pop(); if (!e) return null; redo.push({ s: current, label: e.label }); return e.s; },
    redo(current) { revision++; const e = redo.pop(); if (!e) return null; undo.push({ s: current, label: e.label }); return e.s; },
    /** Back n steps (1 to canUndo count): the state to restore, or null. */
    undoMany(n, current) { if (!(n >= 1) || n > undo.length) return null; let s = current; for (let i = 0; i < n; i++) s = h.undo(s); return s; },
    redoMany(n, current) { if (!(n >= 1) || n > redo.length) return null; let s = current; for (let i = 0; i < n; i++) s = h.redo(s); return s; },
    /** { past: labels oldest first (the last is what Undo undoes), future: labels, the one Redo redoes first } */
    labels() { return { past: undo.map((e) => e.label), future: redo.slice().reverse().map((e) => e.label) }; },
    get canUndo() { return undo.length > 0; },
    get canRedo() { return redo.length > 0; },
    get revision() { return revision; },
    clear() { revision++; undo = []; redo = []; }
  };
  return h;
}

/** The factor that turns `current` into `wanted` (both mm), or null when either is not a usable length. */
export function scaleFactor(wanted, current) {
  const w = +wanted, c = +current;
  if (!(w > 0) || !(c > 0) || !Number.isFinite(w) || !Number.isFinite(c)) return null;
  const s = w / c;
  return s > 1e-6 && s < 1e6 ? s : null;
}

// ---------------------------------------------------------------- measuring

/** Two points in drawing units (y up) → { dist, dx, dy, angle } in mm; angle in degrees 0 ≤ a < 360, anticlockwise from +X. */
export function measureTwo(a, b, factor = 1) {
  const dx = (b[0] - a[0]) * factor, dy = (b[1] - a[1]) * factor;
  let angle = Math.atan2(dy, dx) * 180 / Math.PI;
  if (angle < 0) angle += 360;
  if (angle >= 360 - 1e-9) angle = 0;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) angle = 0;
  return { dist: Math.hypot(dx, dy), dx, dy, angle };
}
/**
 * Shift held while picking: p moved onto the horizontal or the vertical through `from`, whichever is nearer to it
 * (AutoCAD's Ortho). A snap kind is dropped when the point moved off the snapped point.
 */
export function orthoLock(from, p) {
  if (!from) return p;
  const q = Math.abs(p[0] - from[0]) >= Math.abs(p[1] - from[1]) ? [p[0], from[1]] : [from[0], p[1]];
  return q[0] === p[0] && q[1] === p[1] && p.length > 2 ? [q[0], q[1], p[2]] : q;
}
/** A number for people: 2 decimals, no trailing zeros, no "-0". */
export const mmText = (v) => { const s = String(+Number(v).toFixed(2)); return s === '-0' ? '0' : s; };
/** "Distance 100 mm   ΔX 100   ΔY 0   Angle 0°" */
export function formatMeasure(m) {
  return `Distance ${mmText(m.dist)} mm   ΔX ${mmText(m.dx)}   ΔY ${mmText(m.dy)}   Angle ${mmText(m.angle)}°`;
}

// ---------------------------------------------------------------- the background (a picture under the drawing)

/** A background { w, h (pixels), mm (mm per pixel), x, y (its bottom-left, mm, y up) } → its box [x0, y0, x1, y1] in mm. */
export const bgBox = (bg) => [bg.x, bg.y, bg.x + bg.w * bg.mm, bg.y + bg.h * bg.mm];
/** The same picture, mm-per-pixel times s, still fixed at its bottom-left corner. */
export const bgScaled = (bg, s) => ({ ...bg, mm: bg.mm * s });

/// ---------------------------------------------------------------- a kept dimension

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const DEG = Math.PI / 180;
/** The text height a new dimension gets, in drawing units: 5 % of its length, 2 to 5 mm. */
export const defaultTextH = (len, factor = 1) => clamp(0.05 * len * factor, 2, 5) / factor;
/** A filled arrowhead as a triangle: its tip, pointing along the unit vector (ux, uy), `ar` long and `half` wide to each side. */
export function arrowHead(tip, ux, uy, ar, half) {
  const bx = tip[0] - ux * ar, by = tip[1] - uy * ar;
  return [tip, [bx - uy * half, by + ux * half], [bx + uy * half, by - ux * half]];
}
/** Linear dimension of a and b with the pointer at p: 'h' (a horizontal line) when p is further above or below the points than beside them, else 'v'. */
export function linearAxis(a, b, p) {
  const out = (v, lo, hi) => Math.max(lo - v, v - hi, 0);
  const ox = out(p[0], Math.min(a[0], b[0]), Math.max(a[0], b[0])), oy = out(p[1], Math.min(a[1], b[1]), Math.max(a[1], b[1]));
  if (ox !== oy) return oy > ox ? 'h' : 'v';
  return Math.abs(p[1] - (a[1] + b[1]) / 2) >= Math.abs(p[0] - (a[0] + b[0]) / 2) ? 'h' : 'v';
}
/**
 * The shape of an aligned or linear dimension, all in drawing units (y up), from { a, b, offset, textH, arrow, gap, pos, units, axis, prefix }:
 * the dimension line runs parallel to a→b (axis null) or along X ('h') or Y ('v'), `offset` to its left (negative: to its right);
 * extension lines go from `gap` off the point (default 0.4 text heights) to an overshoot past the line (the gap and 0.4 text heights, 0.8 with
 * the default gap, which is how the gap is read back), and are left out at offset 0; arrowheads (arrow, else 1.1 text heights) and the text
 * scale with the text height; the text is 0.4 text heights above the line or, with pos 'centre', in the line, which is then broken round it. → { line, ext, more, lines, arrows, text: { x, y, h,
 * rot, label, va }, mm, label, th } or null for two equal points.
 */
export function dimGeometry({ a, b, offset = 0, textH, arrow, gap, pos = 'above', units = 'mm', axis = null, prefix = '' }, factor, dp = 2) {
  const dx = b[0] - a[0], dy = b[1] - a[1], f = factor || 1;
  const len = axis === 'h' ? Math.abs(dx) : axis === 'v' ? Math.abs(dy) : Math.hypot(dx, dy);
  if (!(len > 1e-9)) return null;
  const ux = axis === 'h' ? Math.sign(dx) : axis === 'v' ? 0 : dx / len, uy = axis === 'v' ? Math.sign(dy) : axis === 'h' ? 0 : dy / len, nx = -uy, ny = ux;
  const mm = len * f, th = textH > 0 ? textH : defaultTextH(len, f), ar = Math.min(arrow > 0 ? arrow : 1.1 * th, len * 0.4), half = ar * 0.18;
  const off = Math.abs(offset) * f < 1e-6 ? 0 : offset;
  const a2 = [a[0] + nx * off, a[1] + ny * off], b2 = [a2[0] + ux * len, a2[1] + uy * len];
  const offB = off - ((b[0] - a[0]) * nx + (b[1] - a[1]) * ny);            // b's own distance from the line (off, when aligned)
  const ext = [];
  if (off || Math.abs(offB) * f >= 1e-6) {
    const g = Number.isFinite(gap) && gap >= 0 ? gap : 0.4 * th, over = g + 0.4 * th;
    for (const [p, q, o] of [[a, a2, off], [b, b2, offB]]) { const sg = Math.sign(o) || Math.sign(off) || 1; ext.push([p[0] + nx * sg * g, p[1] + ny * sg * g, q[0] + nx * sg * over, q[1] + ny * sg * over]); }
  }
  const flip = ux < -1e-9 || (Math.abs(ux) <= 1e-9 && uy < 0);              // read it left to right (bottom to top when upright)
  const rx = flip ? -ux : ux, ry = flip ? -uy : uy, rot = Math.atan2(ry, rx) / DEG;
  const label = dimLabel(mm, dp, units, prefix), mid = [(a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2], tg = 0.4 * th, centred = pos === 'centre';
  const text = centred ? { x: mid[0], y: mid[1], h: th, rot, label, va: 2 } : { x: mid[0] - ry * tg, y: mid[1] + rx * tg, h: th, rot, label, va: 1 };
  const hw = 0.3 * th * label.length + tg;                                    // half the text and its gap, along the line
  let line = [a2[0], a2[1], b2[0], b2[1]], more = [];
  if (centred && 2 * hw < len - 2 * ar) { line = [a2[0], a2[1], mid[0] - ux * hw, mid[1] - uy * hw]; more = [[mid[0] + ux * hw, mid[1] + uy * hw, b2[0], b2[1]]]; }
  return { line, ext, more, lines: [line, ...ext, ...more], arrows: [arrowHead(b2, ux, uy, ar, half), arrowHead(a2, -ux, -uy, ar, half)], text, mm, label, th };
}
/**
 * A radius dimension, from { c, r (the circle), p (the pointer), textH, arrow, units }: a line from the centre through p to a short landing
 * with the text beyond it on the side p is on, and an arrowhead on the circle pointing out. Same shape as dimGeometry, or null.
 */
export function radiusGeometry({ c, r, p, textH, arrow, units = 'mm' }, factor, dp = 2) {
  const f = factor || 1, d = Math.hypot(p[0] - c[0], p[1] - c[1]);
  if (!(r > 1e-9) || !(d > 1e-9)) return null;
  const ux = (p[0] - c[0]) / d, uy = (p[1] - c[1]) / d, th = textH > 0 ? textH : defaultTextH(r, f), ar = Math.min(arrow > 0 ? arrow : 1.1 * th, r * 0.4);
  const tip = [c[0] + ux * r, c[1] + uy * r], q = d >= r ? p : tip, side = ux < -1e-9 ? -1 : 1, end = [q[0] + side * th, q[1]];     // a pointer inside the circle is put on it
  const label = dimLabel(r * f, dp, units, 'R'), line = [c[0], c[1], q[0], q[1]], more = [[q[0], q[1], end[0], end[1]]];
  return { line, ext: [], more, lines: [line, ...more], arrows: [arrowHead(tip, ux, uy, ar, ar * 0.18)], mm: r * f, label, th,
    text: { x: end[0] + side * (0.4 * th + 0.3 * th * label.length), y: q[1] - 0.5 * th, h: th, rot: 0, label, va: 1 } };
}
/**
 * An angle dimension, from { v (the vertex), r (the arc's radius), a0, a1 (degrees: the arc runs anticlockwise from a0 to a1), textH, arrow }:
 * the arc with an arrowhead at each end and the value outside it, upright. Same shape as dimGeometry (arcs: [[cx, cy, r, a0, a1]]), or null.
 */
export function angleGeometry({ v, r, a0, a1, textH, arrow }, factor, dp = 2) {
  const f = factor || 1, sw = (((a1 - a0) % 360) + 360) % 360;
  if (!(r > 1e-9) || !(sw > 1e-6)) return null;
  const th = textH > 0 ? textH : defaultTextH(r, f), ar = Math.min(arrow > 0 ? arrow : 1.1 * th, r * sw * DEG * 0.4), half = ar * 0.18;
  const at = (a) => [v[0] + r * Math.cos(a * DEG), v[1] + r * Math.sin(a * DEG)];
  const am = (a0 + sw / 2) * DEG, dm = [Math.cos(am), Math.sin(am)], label = dimText(sw, dp) + '°';
  const reach = r + 0.4 * th + (0.6 * th * label.length * Math.abs(dm[0]) + th * Math.abs(dm[1])) / 2;
  return { line: null, ext: [], more: [], lines: [], arcs: [[v[0], v[1], r, ((a0 % 360) + 360) % 360, (((a0 + sw) % 360) + 360) % 360]], mm: sw, label, th,
    arrows: [arrowHead(at(a0), Math.sin(a0 * DEG), -Math.cos(a0 * DEG), ar, half), arrowHead(at(a0 + sw), -Math.sin((a0 + sw) * DEG), Math.cos((a0 + sw) * DEG), ar, half)],
    text: { x: v[0] + dm[0] * reach, y: v[1] + dm[1] * reach - th / 2, h: th, rot: 0, label, va: 1 } };
}
/**
 * The angle between the lines l1 and l2 ([x1, y1, x2, y2], taken as endless) on the side of the pointer p: { v, r, a0, a1 } for angleGeometry
 * (r: how far p is from the vertex), or null for parallel lines.
 */
export function angleBetween(l1, l2, p) {
  const d1 = [l1[2] - l1[0], l1[3] - l1[1]], d2 = [l2[2] - l2[0], l2[3] - l2[1]], cr = d1[0] * d2[1] - d1[1] * d2[0];
  if (!(Math.abs(cr) > 1e-9 * Math.hypot(...d1) * Math.hypot(...d2))) return null;
  const t = ((l2[0] - l1[0]) * d2[1] - (l2[1] - l1[1]) * d2[0]) / cr, v = [l1[0] + d1[0] * t, l1[1] + d1[1] * t];
  const ang = (x, y) => ((Math.atan2(y, x) / DEG) + 360) % 360, A = ang(...d1), B = ang(...d2), phi = ang(p[0] - v[0], p[1] - v[1]);
  const rays = [A, (A + 180) % 360, B, (B + 180) % 360].sort((x, y) => x - y), lo = rays.filter((x) => x <= phi).length - 1;     // the two rays either side of the pointer
  return { v, r: Math.hypot(p[0] - v[0], p[1] - v[1]), a0: rays[(lo + 4) % 4], a1: rays[(lo + 5) % 4] };
}
/** The two ends of a diameter dimension on circle (c, r) lying along the way the pointer p points from the centre; null when p is the centre. */
export function diameterEnds(c, r, p) {
  const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
  if (!(d > 1e-12)) return null;
  const ux = (p[0] - c[0]) / d * r, uy = (p[1] - c[1]) / d * r;
  return { a: [c[0] - ux, c[1] - uy], b: [c[0] + ux, c[1] + uy] };
}
/** { c, r } of a CIRCLE or ARC (not a mirrored one), else null; and [x1, y1, x2, y2] of a LINE with a length, else null. */
export function circleOf(ent) {
  if (!ent || !ent.r || (ent.type !== 'CIRCLE' && ent.type !== 'ARC')) return null;
  const g = (c) => +fieldOf(ent.r, c);
  return g(40) > 0 && !g(210) && !g(220) && !(g(230) < 0) ? { c: [g(10), g(20)], r: g(40) } : null;
}
export function lineOf(ent) {
  if (!ent || !ent.r || ent.type !== 'LINE') return null;
  const g = (c) => +fieldOf(ent.r, c), l = [g(10), g(20), g(11), g(21)];
  return Math.hypot(l[2] - l[0], l[3] - l[1]) > 1e-9 && !g(210) && !g(220) && !(g(230) < 0) ? l : null;
}

/** The drawn shape of a dimension of this kind ('aligned', 'linear', 'radius', 'diameter', 'angle') from its params, or null. */
export function dimGeom(kind, params, factor, dp = 2) {
  if (kind === 'radius') return radiusGeometry(params, factor, dp);
  if (kind === 'angle') return angleGeometry(params, factor, dp);
  return dimGeometry(kind === 'diameter' ? { ...params, offset: 0, axis: null, prefix: 'Ø' } : params, factor, dp);
}
/**
 * A dimension (see dimGeom) as a block called `name`: its lines (the dimension line first, then the extension lines), the arc of an angle,
 * the arrowheads and the text. → { name, block, insert, mm, label }. factor: mm per drawing unit.
 */
export function dimBlock(g, name) {
  const o = { layer: '0' }, t = g.text;
  const solid = ([p, q, r]) => entity('SOLID', [[10, p[0]], [20, p[1]], [30, 0], [11, q[0]], [21, q[1]], [31, 0], [12, r[0]], [22, r[1]], [32, 0]], o);
  const txt = entity('TEXT', [[10, t.x], [20, t.y], [30, 0], [40, t.h], [1, t.label], [50, t.rot], [72, 1], [11, t.x], [21, t.y], [31, 0], [73, t.va || 1]], o);
  const ents = [...g.lines.map((l) => line(...l, o)), ...(g.arcs || []).map((a) => arc(...a, o)), ...g.arrows.map(solid), txt];
  return { name, block: { base: [0, 0], xref: false, entities: ents }, insert: insert(name, 0, 0, { layer: DIM_LAYER }), mm: g.mm, label: g.label };
}
export const buildDim = (kind, params, factor, name, dp = 2) => {
  const g = dimGeom(kind, params, factor, dp), built = g && dimBlock(g, name);
  // Keep the axis in-session too when rebuilding an old untagged Linear block.
  if (built && kind === 'linear') built.block.dimAxis = params.axis;
  return built;
};
/** An aligned or linear dimension (see dimGeometry) as a block; null for two equal points. */
export const buildDimension = (params, factor, name, dp = 2) => buildDim('aligned', params, factor, name, dp);
/** First free name: PD_DIM_n aligned, H / V linear, R radius, D diameter or A angle. */
export function freeName(blocks, kind = 'aligned', axis = null) {
  const tag = kind === 'linear' ? { h: 'H', v: 'V' }[axis] || '' : { radius: 'R', diameter: 'D', angle: 'A' }[kind] || '';
  let n = 1;
  while (blocks['PD_DIM_' + tag + n]) n++;
  return 'PD_DIM_' + tag + n;
}

/** How a dimension looks, read back from its block: text height, arrow size, units and text position (all in drawing units). */
function lookOf(ents) {
  const tx = ents.find((e) => e.type === 'TEXT'), sd = ents.find((e) => e.type === 'SOLID'), g = (e, c) => +fieldOf(e.r, c);
  const th = tx ? g(tx, 40) : NaN;
  const look = { textH: th > 0 ? th : null, units: tx && unesc(fieldOf(tx.r, 1)).endsWith('"') ? 'inch' : 'mm', pos: tx && g(tx, 73) === 2 ? 'centre' : 'above' };
  if (sd) look.arrow = Math.hypot((g(sd, 11) + g(sd, 12)) / 2 - g(sd, 10), (g(sd, 21) + g(sd, 22)) / 2 - g(sd, 20));
  return look;
}
/**
 * An aligned, linear or diameter dimension's parameters read back from its block: { a, b, offset, textH, arrow, gap, pos, units, axis }
 * (drawing units; axis 'h' / 'v' for a linear one; gap: the extension lines' start off the points), or null. The first LINE is the dimension line (a centred text breaks it in two: the
 * first and the last LINE); with extension lines (the next two) a and b are where they start less the gap, without them (offset 0, and
 * every dimension Keep made) a and b are the line's ends.
 */
export function dimParams(block) {
  const ents = (block && block.entities) || [], lines = ents.filter((e) => e.type === 'LINE'), tx = ents.find((e) => e.type === 'TEXT');
  if (!lines.length) return null;
  const g = (e, c) => +fieldOf(e.r, c), th = tx ? g(tx, 40) : NaN, split = lines.length % 2 === 0, first = lines[0], last = split ? lines[lines.length - 1] : first;
  const p0 = [g(first, 10), g(first, 20)], p1 = [g(last, 11), g(last, 21)], look = lookOf(ents), ext = lines.slice(1, split ? -1 : undefined);
  if (ext.length < 2 || !(th > 0)) return { a: p0, b: p1, offset: 0, ...look };
  const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), ux = (p1[0] - p0[0]) / L, uy = (p1[1] - p0[1]) / L;
  const gap = Math.max(0, Math.abs((g(ext[0], 11) - p0[0]) * -uy + (g(ext[0], 21) - p0[1]) * ux) - 0.4 * th);          // the overshoot past the line is the gap and 0.4 text heights
  const back = (e) => { const l = Math.hypot(g(e, 11) - g(e, 10), g(e, 21) - g(e, 20)); return [g(e, 10) - (g(e, 11) - g(e, 10)) / l * gap, g(e, 20) - (g(e, 21) - g(e, 20)) / l * gap]; };
  const a = back(ext[0]), b = back(ext[1]);
  const bl = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const out = { a, b, offset: (p0[0] - a[0]) * -uy + (p0[1] - a[1]) * ux, gap, ...look };
  const flat = Math.min(Math.abs(ux), Math.abs(uy)) < 1e-6, perp =Math.abs((b[0] - a[0]) * -uy + (b[1] - a[1]) * ux);
  if (bl > 1e-9 && flat && perp > 1e-5 + 1e-7 * bl) out.axis = Math.abs(ux) > Math.abs(uy) ? 'h' : 'v';      // the points are off the axis of a horizontal / vertical line: a linear dimension
  return out;
}
/** A kept dimension's kind and parameters from its block name and block: { kind, params } for dimGeom, or null when it is not one. */
export function readDim(name, block) {
  if (!block || !DIM_BLOCK.test(name)) return null;
  const tag = (/^PD_DIM_([RDAHV])\d+$/.exec(name) || [])[1], ents = block.entities || [], g = (e, c) => +fieldOf(e.r, c);
  if (tag === 'R' || tag === 'A') {
    const ln = ents.find((e) => e.type === 'LINE'), sd = ents.find((e) => e.type === 'SOLID'), ar = ents.find((e) => e.type === 'ARC'), look = lookOf(ents);
    if (tag === 'R' && ln && sd) { const c = [g(ln, 10), g(ln, 20)]; return { kind: 'radius', params: { ...look, c, r: Math.hypot(g(sd, 10) - c[0], g(sd, 20) - c[1]), p: [g(ln, 11), g(ln, 21)] } }; }
    return tag === 'A' && ar ? { kind: 'angle', params: { ...look, v: [g(ar, 10), g(ar, 20)], r: g(ar, 40), a0: g(ar, 50), a1: g(ar, 51) } } : null;
  }
  const p = dimParams(block);
  const axis = { H: 'h', V: 'v' }[tag] || block.dimAxis;
  if (p && axis) p.axis = axis;
  return p && { kind: tag === 'D' ? 'diameter' : p.axis ? 'linear' : 'aligned', params: p };
}
/** The signed offset of a dimension line through point p, for a dimension from a to b (positive: left of a→b); axis 'h' / 'v': of a linear one. */
export function dimOffsetAt(a, b, p, axis = null) {
  let dx = b[0] - a[0], dy = b[1] - a[1];
  if (axis === 'h') { dx = Math.sign(dx) || 1; dy = 0; } else if (axis === 'v') { dy = Math.sign(dy) || 1; dx = 0; }
  const len = Math.hypot(dx, dy);
  return len > 1e-12 ? (-(p[0] - a[0]) * dy + (p[1] - a[1]) * dx) / len : 0;
}
/** A dimension with its first free block name, offset 0 and default text height, or `look` (what Measure's Keep makes). */
export function makeDimension(a, b, factor, blocks = {}, dp = 2, look = {}) {
  const kind = look.axis ? 'linear' : 'aligned';
  return buildDim(kind, { a, b, offset: 0, ...look }, factor, freeName(blocks, kind, look.axis), dp);
}
/** The dimension INSERT at entity index e → { name, kind, params, dp } (see readDim; dp: the decimals its text has), or null when that is not a kept dimension. */
export function dimOfEntity(raw, e) {
  const ent = raw.entities[e];
  if (!ent || ent.type !== 'INSERT') return null;
  const name = fieldOf(ent.r, 2), block = raw.blocks[name], m = readDim(name, block);
  if (!m) return null;
  const tx = block.entities.find((x) => x.type === 'TEXT'), k = tx ? tx.r.c.indexOf(1) : -1;
  return { name, ...m, dp: k < 0 ? 2 : placesOf(unesc(tx.r.v[k])) };
}
/** { entities, blocks } with dimension block `built.name` rebuilt (the INSERT stays); the label follows the new geometry. */
export function replaceDimension(raw, built) {
  return { entities: raw.entities, blocks: { ...raw.blocks, [built.name]: built.block } };
}
/** The document with the dimension added (new entities and blocks; the layer "Dimensions" is made on first use). */
export function addDimension(raw, dim) {
  if (!raw.layers[DIM_LAYER]) addLayer(raw, DIM_LAYER, { aci: 5, tc: 0x0f766e });
  return { entities: [...raw.entities, dim.insert], blocks: { ...raw.blocks, [dim.name]: dim.block } };
}

// ---- layers added by hand (Layers panel, + Add)

/** The first of Layer1, Layer2… not in names (DXF layer names are not case-sensitive). */
export function newLayerName(names) {
  const used = new Set([...names].map((n) => String(n).toLowerCase()));
  let i = 1;
  while (used.has('layer' + i)) i++;
  return 'Layer' + i;
}

/** '' when name can be a layer's name, else why not: empty, a character a DXF layer name can't hold, too long, or taken (other than by `own`). */
export function layerNameProblem(name, names, own = null) {
  const n = String(name).trim();
  if (!n) return 'A layer needs a name';
  if (n.length > 255) return 'A layer name can be 255 characters at most';
  if (/[<>/\\":;?*|,=`]/.test(n)) return 'A layer name can\'t hold < > / \ " : ; ? * | , = or `';
  const low = n.toLowerCase();
  if ([...names].some((x) => x !== own && String(x).toLowerCase() === low)) return `The layer "${n}" is already there`;
  return '';
}
