// Cleanup and preflight (TODO 49/50): pure; entity indexes always refer to the input document.
import { flatten, strokeWidth, mscale, mapply, ownBlock } from './drawing.js';
import { makeIndex, findGaps, chainAt, pathEnds } from './edit.js';
import { shapeOf, get, withValues } from './grips.js';
import { canModify, pathOf, geo, subSeg, shapeOfPiece, rebuilt } from './modify.js';
import { withWidth } from './props.js';

const EPS = 1e-9, TAU = 2 * Math.PI;
const near = (a, b, tol = EPS) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];

// Fractions of s covered by t; touching endpoints alone have no redundant length.
function covered(s, t) {
  if (s.line !== t.line) return [];
  if (s.line) {
    if (s.len <= EPS || t.len <= EPS || Math.abs(cross(s.u, t.u)) > EPS || Math.abs(cross(sub(t.a, s.a), s.u)) > EPS) return [];
    const a = dot(sub(t.a, s.a), s.u) / s.len, b = dot(sub(t.b, s.a), s.u) / s.len;
    return [[Math.min(a, b), Math.max(a, b)]];
  }
  if (!near(s.c, t.c) || Math.abs(s.r - t.r) > EPS) return [];
  const out = [];
  const base = Math.round((s.a0 - t.a0) / TAU);
  for (let k = base - 2; k <= base + 2; k++) {
    const a = (t.a0 + k * TAU - s.a0) / s.sw, b = a + t.sw / s.sw;
    out.push([Math.min(a, b), Math.max(a, b)]);
  }
  return out;
}

const recordKey = (r) => [r.type, r.c.flatMap((c, i) => c === 5 || c === 330 ? [] : [[c, String(r.v[i]).trim()]])];
const exactKey = (e) => JSON.stringify([e.type, e.layer, !!e.ps, !!e.flip, recordKey(e.r), e.kids?.map(recordKey)]);
const planeKey = (e) => JSON.stringify([e.layer, !!e.ps, !!e.flip,
  ...[30, 31, 38, 39, 210, 220, 230].map((c) => get(e.r, c) ?? (c === 230 ? 1 : 0))]);

function rebuildPiece(shape, ent) {
  if (shape.t === 'line' && ent.type === 'LINE') {
    return withValues(ent, [[10, shape.a[0]], [20, shape.a[1]], [11, shape.b[0]], [21, shape.b[1]]].map(([c, v]) => [ent.r.c.indexOf(c), v]));
  }
  if (shape.t === 'arc' && ent.type === 'ARC') {
    return withValues(ent, [[50, shape.a0], [51, shape.a1]].map(([c, v]) => [ent.r.c.indexOf(c), v]));
  }
  const next = rebuilt(shape, ent), z = get(ent.r, 30);
  return z && next.r.c.includes(30) ? withValues(next, [[next.r.c.indexOf(30), z]]) : next;
}

// Bucket by supporting line/circle; unrelated entities need no pairwise comparison.
function support(g) {
  if (!g.line) return ['arc', ...[...g.c, g.r].map((v) => Math.round(v / 1e-6))];
  let angle = Math.atan2(g.u[1], g.u[0]);
  if (angle < 0) angle += Math.PI;
  if (angle > Math.PI - EPS) angle = 0;
  return ['line', Math.round(angle / 1e-6), Math.round((-Math.sin(angle) * g.a[0] + Math.cos(angle) * g.a[1]) / 1e-6)];
}
function nearbyKeys([kind, ...coords]) {
  let keys = [kind];
  for (const n of coords) keys = keys.flatMap((key) => [-1, 0, 1].map((d) => key + ',' + (n + d)));
  return keys;
}

/** Keep the first original, subtract covered lengths from later entities on the same layer/plane/space.
 * eligible limits repairs (e.g. locked layers); redundant counts entities, including partially trimmed ones.
 */
export function removeDuplicates(raw, eligible = () => true) {
  const entities = [], offenders = [], groups = new Map(), exact = new Set(), indexes = new Map();   // indexes: old entity → its new indexes
  raw.entities.forEach((ent, i) => {
    const key = exactKey(ent);
    indexes.set(i, []);
    if (exact.has(key) && eligible(i)) { offenders.push(i); return; }
    exact.add(key);
    const sh = canModify(ent) && !(ent.type === 'LINE' && get(ent.r, 30) !== get(ent.r, 31)) && shapeOf(ent);
    if (!sh) { indexes.set(i, [entities.length]); entities.push(ent); return; }
    const pk = planeKey(ent), previous = groups.get(pk) || new Map(), path = pathOf(sh), runs = [];
    let changed = false, run = [];
    for (const s of path.segs) {
      const g = geo(s);
      // shortcut: many disjoint segments on one supporting curve still compare pairwise; add interval indexing for large collinear files.
      const bucket = support(g), candidates = nearbyKeys(bucket).flatMap((key) => previous.get(key) || []);
      let spans = [[0, 1]];
      if (eligible(i)) for (const t of candidates) for (const [a, b] of covered(g, t)) {
        spans = spans.flatMap(([lo, hi]) => {
          const l = Math.max(lo, a), h = Math.min(hi, b);
          if (h - l <= EPS) return [[lo, hi]];
          changed = true;
          return [...(l - lo > EPS ? [[lo, l]] : []), ...(hi - h > EPS ? [[h, hi]] : [])];
        });
      }
      for (const [lo, hi] of spans) {
        const piece = subSeg(s, lo, hi);
        if (run.length && !near(run[run.length - 1].b, piece.a)) { runs.push(run); run = []; }
        run.push(piece);
      }
      if (!spans.length && run.length) { runs.push(run); run = []; }
      const key = bucket.join(',');
      if (!previous.has(key)) previous.set(key, []);
      previous.get(key).push(g);
    }
    groups.set(pk, previous);
    if (run.length) runs.push(run);
    if (!changed) { indexes.set(i, [entities.length]); entities.push(ent); return; }
    offenders.push(i);
    if (path.closed && runs.length > 1 && near(runs[runs.length - 1].at(-1).b, runs[0][0].a)) runs[0] = runs.pop().concat(runs[0]);
    for (const pieces of runs) {
      const shape = shapeOfPiece(pieces, path.type);
      if (shape) { indexes.get(i).push(entities.length); entities.push(rebuildPiece(shape, ent)); }
    }
  });
  return { entities, blocks: raw.blocks, offenders, count: offenders.length, indexes };
}

/** Include hidden entities as well as hidden layers; session visibility never suppresses warnings. */
export function checkIndex(raw) {
  const unhide = (e) => e.hidden ? { ...e, hidden: false } : e;
  const visible = { ...raw, entities: raw.entities.map(unhide), blocks: Object.fromEntries(Object.entries(raw.blocks).map(([name, b]) => [name, { ...b, entities: b.entities.map(unhide) }])) };
  const fl = flatten(visible);
  return makeIndex(raw, fl);
}

/** Hairline uses TODO 48's width setter. Copy referenced blocks so other instances keep their widths. */
export function hairline(raw, offenders, locked = new Set()) {
  const selected = new Set(offenders), blocks = { ...raw.blocks }, copies = new Map();
  const names = new Set(Object.keys(blocks).map((n) => n.toLowerCase()));
  function fix(ent, inherited = '0') {
    const layer = ent.layer === '0' ? inherited : ent.layer;
    if (locked.has(layer)) return ent;
    let next = withWidth(ent, 'Hairline');
    if (ent.type !== 'INSERT' && ent.type !== 'DIMENSION') return next;
    const idx = ent.r.c.indexOf(2), name = ent.r.v[idx]?.trim(), source = ownBlock(raw.blocks, name);
    if (!source) return next;
    const key = JSON.stringify([name, layer]);
    if (!copies.has(key)) {
      // the copy keeps the kind in its name (edit.js:1250): dimTag, DIM_BLOCK, LDR_BLOCK and native dimensions find it by name
      const prefix = ent.type === 'DIMENSION' ? '*D' : /^PD_(DIM_[RDAHV]?|LDR_)(?=\d+$)/.exec(name)?.[0] || 'PD_HAIRLINE_';
      let n = 1;
      while (names.has((prefix + n).toLowerCase())) n++;
      const fresh = prefix + n;
      names.add(fresh.toLowerCase()); copies.set(key, fresh);
      blocks[fresh] = { ...source, entities: source.entities.map((e) => fix(e, layer)) };
    }
    const v = next.r.v.slice(); v[idx] = copies.get(key);
    return { ...next, r: { ...next.r, v } };
  }
  return { entities: raw.entities.map((e, i) => selected.has(i) ? fix(e) : e), blocks };
}

/**
 * Cross-object Duplicates and Gaps (TODO 156e3c) on a layout: `items` = [{ k, polys }], the outlines (Float64Array x, y, x, y… in sheet mm) of placement k.
 * Only pairs from two different k count (a hit inside one k is the per-object row's). Returns { duplicates: Set of k, gaps: [Set of the k's of one gap], covered: Set of the k's (not `solid`, a placed part) whose whole outline lies on solid ones' (TODO 156e3d) }.
 * shortcut: arcs are compared as their sampled chords (a rotated copy of a circle samples elsewhere, so it is no duplicate); upgrade with arc-aware covered().
 */
export function crossChecks(items, tolerance) {
  const D = 1e-6, duplicates = new Set(), prev = new Map(), gaps = [], ends = [], segsOf = new Map();
  for (const { k, polys, solid } of items) for (const q of polys) {
    const n = q.length;
    if (n >= 4 && Math.hypot(q[0] - q[n - 2], q[1] - q[n - 1]) > 2e-6) ends.push({ k, x: q[0], y: q[1] }, { k, x: q[n - 2], y: q[n - 1] });       // a closed outline has no ends
    for (let i = 0; i + 3 < n; i += 2) {
      const a = [q[i], q[i + 1]], b = [q[i + 2], q[i + 3]], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len <= D) continue;
      const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], bucket = support({ line: true, a, u }), key = bucket.join(','), me = { k, a, b, u, len, solid, cov: [] };
      for (const t of nearbyKeys(bucket).flatMap((nk) => prev.get(nk) || [])) {
        if (t.k === k || (duplicates.has(k) && duplicates.has(t.k) && !solid && !t.solid) || Math.abs(cross(sub(t.a, a), u)) > D || Math.abs(cross(sub(t.b, a), u)) > D) continue;
        const s0 = dot(sub(t.a, a), u), s1 = dot(sub(t.b, a), u), lo = Math.max(0, Math.min(s0, s1)), hi = Math.min(len, Math.max(s0, s1));
        if (hi - lo <= D) continue;
        duplicates.add(k); duplicates.add(t.k);
        if (t.solid) me.cov.push([lo, hi]);       // what lies on a placed part's outline, for `covered`
        if (solid) { const r0 = dot(sub(a, t.a), t.u), r1 = dot(sub(b, t.a), t.u); t.cov.push([Math.max(0, Math.min(r0, r1)), Math.min(t.len, Math.max(r0, r1))]); }
      }
      if (!prev.has(key)) prev.set(key, []);
      prev.get(key).push(me);
      if (!segsOf.has(k)) segsOf.set(k, []);
      segsOf.get(k).push(me);
    }
  }
  // covered: loose placements (not `solid`, a placed part) whose whole outline lies on placed parts' outlines
  const covered = new Set();
  for (const [k, segs] of segsOf) {
    if (segs[0].solid) continue;
    if (segs.every((s) => {
      let at = 0, got = 0;
      for (const [lo, hi] of s.cov.sort((p, q) => p[0] - q[0])) { if (hi > at) { got += hi - Math.max(lo, at); at = hi; } }
      return s.len - got <= D;
    })) covered.add(k);
  }
  const cell = Math.max(tolerance, 1e-12), at = new Map(), parent = ends.map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  ends.forEach((p, i) => {
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), key = cx + ',' + cy;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of at.get((cx + dx) + ',' + (cy + dy)) || []) if (Math.hypot(ends[j].x - p.x, ends[j].y - p.y) <= tolerance) parent[find(j)] = find(i);
    if (!at.has(key)) at.set(key, []);
    at.get(key).push(i);
  });
  const groups = new Map();
  ends.forEach((p, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); });
  for (const g of groups.values()) {
    const pts = [];       // ends that already meet (2e-6) are one point of the placements that have one there
    for (const p of g) { const q = pts.find((o) => Math.hypot(p.x - o.x, p.y - o.y) <= 2e-6); if (q) q.ks.add(p.k); else pts.push({ x: p.x, y: p.y, ks: new Set([p.k]) }); }
    // a gap is two points no one placement has both of: when every copy has both, it is the gap inside that placement (the per-object / per-part row's)
    if (pts.some((p, i) => pts.some((o, j) => j > i && ![...p.ks].some((k) => o.ks.has(k))))) gaps.push(new Set(pts.flatMap((p) => [...p.ks])));
  }
  return { duplicates, gaps, covered };
}

/** Six warning checks. Sheet/tolerance are mm; counts are offending entities except gap clusters. */
export function preflight(raw, { factor = 1, tolerance = 0.01, sheetW, sheetH, check } = {}) {
  const wanted = (id) => !check || check === id, hasSheet = sheetW != null && sheetH != null;
  const ed = check === 'duplicates' || (check === 'offsheet' && !hasSheet) ? null : checkIndex(raw), fl = ed?.fl;
  const gaps = wanted('gaps') ? findGaps(ed, tolerance / factor) : [];
  const open = new Set();
  if (wanted('open')) {
    const cut = [], ends = [];
    for (const it of fl.items) {
      if (it.ps !== ed.space || it.k !== 'p' || it.fill || !/cut/i.test(fl.layers[it.L[0]].name)) continue;
      const p = pathEnds(it.ops);
      if (!p) continue;
      const a = mapply(fl.mats[it.m], p[0], p[1]), b = mapply(fl.mats[it.m], p[2], p[3]);
      if (near(a, b)) continue;
      cut.push(it); ends.push(...a, ...b);
    }
    const cutEd = { shown: cut.map((_, i) => i), ends, graph: null }, visited = new Set();
    const endpoints = cut.flatMap((_, e) => [0, 1].map((k) => ({ e, k, p: ends.slice(e * 4 + k * 2, e * 4 + k * 2 + 2) })));
    const bins = new Map(), cell = 2e-6;
    for (const p of endpoints) {
      const key = `${Math.floor(p.p[0] / cell)},${Math.floor(p.p[1] / cell)}`;
      if (!bins.has(key)) bins.set(key, []);
      bins.get(key).push(p);
    }
    const free = new Set();
    for (const p of endpoints) {
      const x = Math.floor(p.p[0] / cell), y = Math.floor(p.p[1] / cell);
      let joined = false;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if ((bins.get(`${x + dx},${y + dy}`) || []).some((q) => q !== p && near(p.p, q.p, cell))) joined = true;
      }
      if (!joined) free.add(p.e);
    }
    for (const i of cutEd.shown) {
      if (visited.has(i)) continue;
      const chain = chainAt(cutEd, i, cell);
      for (const e of chain) visited.add(e);
      if (chain.some((e) => free.has(e))) for (const e of chain) open.add(cut[e].e);
    }
  }
  const off = new Set(), wide = new Set(), text = new Set();
  if (wanted('offsheet') && hasSheet || wanted('wide') || wanted('text')) for (const it of fl.items) {
    if (it.ps !== ed.space) continue;
    if (wanted('text') && it.k === 't') text.add(it.e);
    if (wanted('wide') && it.k === 'p' && !it.fill && strokeWidth(it, factor, mscale(fl.mats[it.m])) > 0.05 + EPS) wide.add(it.e);
    if (wanted('offsheet') && hasSheet) {
      const b = it.b.map((v) => v * factor);
      if (b[0] < -EPS || b[1] < -EPS || b[2] > sheetW + EPS || b[3] > sheetH + EPS) off.add(it.e);
    }
  }
  const dup = wanted('duplicates') ? removeDuplicates(raw) : null;
  const row = (id, label, offenders, fix, count = offenders.length) => ({ id, label, offenders, fix, count });
  return [row('duplicates', 'Duplicates / overlaps', dup?.offenders || [], 'Remove'),
    row('open', 'Open paths on Cut', [...open]),
    row('gaps', `Tiny gaps < ${tolerance} mm`, [...new Set(gaps.flatMap((g) => g.ends.map((e) => e.e)))], 'Join', gaps.length),
    row('offsheet', 'Parts off the sheet', [...off], undefined, hasSheet ? off.size : null),
    row('wide', 'Lines wider than hairline', [...wide], 'Hairline'),
    row('text', 'Text not outlined', [...text])].filter((r) => wanted(r.id));
}
