// Cleanup and preflight (TODO 49/50): pure; entity indexes always refer to the input document.
import { flatten, strokeWidth, mscale, mapply } from './drawing.js';
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
  const entities = [], offenders = [], groups = new Map(), exact = new Set();
  raw.entities.forEach((ent, i) => {
    const key = exactKey(ent);
    if (exact.has(key) && eligible(i)) { offenders.push(i); return; }
    exact.add(key);
    const sh = canModify(ent) && !(ent.type === 'LINE' && get(ent.r, 30) !== get(ent.r, 31)) && shapeOf(ent);
    if (!sh) { entities.push(ent); return; }
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
    if (!changed) { entities.push(ent); return; }
    offenders.push(i);
    if (path.closed && runs.length > 1 && near(runs[runs.length - 1].at(-1).b, runs[0][0].a)) runs[0] = runs.pop().concat(runs[0]);
    for (const pieces of runs) {
      const shape = shapeOfPiece(pieces, path.type);
      if (shape) entities.push(rebuildPiece(shape, ent));
    }
  });
  return { entities, blocks: raw.blocks, offenders, count: offenders.length };
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
  let serial = 1;
  function fix(ent, inherited = '0') {
    const layer = ent.layer === '0' ? inherited : ent.layer;
    if (locked.has(layer)) return ent;
    let next = withWidth(ent, 'Hairline');
    if (ent.type !== 'INSERT' && ent.type !== 'DIMENSION') return next;
    const idx = ent.r.c.indexOf(2), name = ent.r.v[idx]?.trim(), source = raw.blocks[name];
    if (!source) return next;
    const key = JSON.stringify([name, layer]);
    if (!copies.has(key)) {
      let fresh;
      do { fresh = 'PD_HAIRLINE_' + serial++; } while (names.has(fresh.toLowerCase()));
      names.add(fresh.toLowerCase()); copies.set(key, fresh);
      blocks[fresh] = { ...source, entities: source.entities.map((e) => fix(e, layer)) };
    }
    const v = next.r.v.slice(); v[idx] = copies.get(key);
    return { ...next, r: { ...next.r, v } };
  }
  return { entities: raw.entities.map((e, i) => selected.has(i) ? fix(e) : e), blocks };
}

/** Six warning checks. Sheet/tolerance are mm; counts are offending entities except gap clusters. */
export function preflight(raw, { factor = 1, tolerance = 0.01, sheetW, sheetH } = {}) {
  const ed = checkIndex(raw), fl = ed.fl, gaps = findGaps(ed, tolerance / factor);
  const cut = [], ends = [];
  for (const it of fl.items) {
    if (it.ps !== ed.space || it.k !== 'p' || it.fill || !/cut/i.test(fl.layers[it.L[0]].name)) continue;
    const p = pathEnds(it.ops);
    if (!p) continue;
    const a = mapply(fl.mats[it.m], p[0], p[1]), b = mapply(fl.mats[it.m], p[2], p[3]);
    if (near(a, b)) continue;
    cut.push(it); ends.push(...a, ...b);
  }
  const cutEd = { shown: cut.map((_, i) => i), ends, graph: null }, open = new Set(), visited = new Set();
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
  const off = new Set(), wide = new Set(), text = new Set();
  for (const it of fl.items) {
    if (it.ps !== ed.space) continue;
    if (it.k === 't') text.add(it.e);
    if (it.k === 'p' && !it.fill && strokeWidth(it, factor, mscale(fl.mats[it.m])) > 0.05 + EPS) wide.add(it.e);
    const b = it.b.map((v) => v * factor);
    if (sheetW != null && sheetH != null && (b[0] < -EPS || b[1] < -EPS || b[2] > sheetW + EPS || b[3] > sheetH + EPS)) off.add(it.e);
  }
  const dup = removeDuplicates(raw);
  const row = (id, label, offenders, fix, count = offenders.length) => ({ id, label, offenders, fix, count });
  return [row('duplicates', 'Duplicates / overlaps', dup.offenders, 'Remove'),
    row('open', 'Open paths on Cut', [...open]),
    row('gaps', `Tiny gaps < ${tolerance} mm`, [...new Set(gaps.flatMap((g) => g.ends.map((e) => e.e)))], 'Join', gaps.length),
    row('offsheet', 'Parts off the sheet', [...off]),
    row('wide', 'Lines wider than hairline', [...wide], 'Hairline'),
    row('text', 'Text not outlined', [...text])];
}
