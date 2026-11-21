// shape.js — TODO 139a Shape tool nodes, pure (no DOM): shape.test.mjs.
//
// A node is one of an object's grips (grips.js gripsOf): a polyline's vertices, a line's or an arc's two ends, a circle's four quadrants.
//   nodesOf(ent)                → [{ id, kind, x, y }] (empty for any other kind)
//   nodesIn(nodes, a, b)        → the nodes inside the box with corners a, b
//   dragNodes(ent, nodes, dx, dy) → { ent, label, part } with these nodes of ent moved by (dx, dy): each through grips.js dragGrip (stretch.js stretchGrips),
//                                  the whole object when every node is in the set or 2+ quadrants of a circle are (grill R3)
//   addNode(ent, p, tol)        → { ent, label } with a new node on the outline nearest p, the outline unchanged (TODO 139b1)
//   deleteNodes(ent, ids)       → { ent, label } with the polyline's nodes ids removed, a same-circle arc pair merged into one arc (TODO 139b2)
//   breakNodes(ent, ids)        → the open polylines ent becomes when broken at these nodes, or null (TODO 139c, grill R8)
//   joinNodes(a, b, opts)       → { result, label } or { why }: two end nodes ({ ent, id }) closed (one object) or joined at their midpoint (two) (TODO 139c, grill Q6 / R2)
//   bezierOf(ent) / handlesOf(ent, ids) / toCurve(ent, ids) / toLine(ent, ids)  → Bezier SPLINEs: their nodes (ids 'n3') and handles ('o3' out of node 3, 'i3' into it), To curve, To line (TODO 139e1, grill-139e R1 / R3 / R4)
//   nodeType(ent, id) / setNodeType(ent, ids, type)  → a Bezier node's type Cusp / Smooth / Symmetrical, read back from its handles, and the spline with those nodes changed to a type (TODO 139e2a, R5)
//   addNode / deleteNodes / breakNodes / joinNodes also take Bezier SPLINEs: split the cubic, merge the two segments (ent null: the object goes), open pieces, one spline from two ends or a Close (TODO 139e2b, R6)
// Where the app drives it (app.js; grep the name): gripList (the Shape tool lists nodes, not grips: gripAt hit-tests them), shapeKeys / shapeSet (the selected nodes),
// hotsOf (they stand in for hot grips), gripUp (a click selects, Shift+click toggles), shapeBox (a box selects), gripStretchHots (dragNodes).
import { gripsOf, shapeOf, insertVertex, removeVertex, convertToArc, get, translate } from './grips.js';
import { stretchGrips } from './stretch.js';
import { pathOf, closest, geo, pointAt, subSeg, polyOf, rebuilt } from './modify.js';
import { lwpoly, entity } from './dxf-write.js';
import { classify, joinEntities } from './join.js';
import { closeEntities } from './closeline.js';
import { splineOf, spRecord } from './extend.js';

const KIND = { LWPOLYLINE: 'vertex', LINE: 'end', ARC: 'end', CIRCLE: 'quad' };

export const nodesOf = (ent) => {
  if (ent?.type === 'SPLINE') { const b = bezierOf(ent); return b ? Array.from({ length: b.closed ? b.n : b.n + 1 }, (_, i) => ({ id: 'n' + i, kind: 'node', x: b.P[3 * i][0], y: b.P[3 * i][1] })) : []; }
  return ent && KIND[ent.type] ? gripsOf(ent).filter((g) => g.kind === KIND[ent.type]) : [];
};

export const nodesIn = (nodes, a, b) => nodes.filter((n) => n.kind !== 'handle' && n.x >= Math.min(a[0], b[0]) && n.x <= Math.max(a[0], b[0]) && n.y >= Math.min(a[1], b[1]) && n.y <= Math.max(a[1], b[1]));

/** Does moving these nodes move the object whole? */
function whole(ent, nodes) {
  const ids = new Set(nodes.map((n) => n.id));
  return ent.type === 'CIRCLE' ? ids.size >= 2 : nodesOf(ent).every((n) => ids.has(n.id));
}

export const dragNodes = (ent, nodes, dx, dy) => (ent.type === 'SPLINE' ? dragBezier(ent, nodes, dx, dy) : stretchGrips(ent, nodes, dx, dy, false, whole(ent, nodes)));

/** A circle as four quarter arcs from quadrant 0 anticlockwise, so its quadrant nodes stay nodes. */
const quarters = (c, r) => [0, 1, 2, 3].map((i) => ({ a: [c[0] + r * Math.cos(i * Math.PI / 2), c[1] + r * Math.sin(i * Math.PI / 2)], b: [c[0] + r * Math.cos((i + 1) * Math.PI / 2), c[1] + r * Math.sin((i + 1) * Math.PI / 2)], bulge: Math.tan(Math.PI / 8) }));

/**
 * TODO 139b1: a new node on ent's outline at the point nearest p (none farther than tol): { ent, label } or null (not a node kind, too far, or on a node).
 * The outline stays: the hit segment splits in two, an arc into two arcs of its circle (grill Q4). A line, arc or circle becomes a polyline (grill Q3, R4)
 * with its layer, colour, line type and lineweight (dxf-write.js lwpoly); a polyline keeps its record (grips.js insertVertex, then each half's bulge).
 */
export function addNode(ent, p, tol = Infinity) {
  if (!nodesOf(ent).length || !p) return null;
  if (ent.type === 'SPLINE') return addBezier(ent, p, tol);       // 139e2b
  const sh = shapeOf(ent), path = sh.t === 'circle' ? { closed: true, segs: quarters(sh.c, sh.r) } : pathOf(sh), hit = closest(path, p);
  const i = hit.index, f = hit.u - i, s = path.segs[i];
  if (!(hit.d <= tol) || f < 1e-9 || f > 1 - 1e-9) return null;
  const g = geo(s), q = pointAt(g, f), halves = [subSeg(s, 0, f), subSeg(s, f, 1)];
  if (ent.type !== 'LWPOLYLINE') return { ent: lwpoly(polyOf(path.segs.flatMap((x, k) => (k === i ? halves : [x])), path.closed).pts, { ...ent, closed: path.closed }), label: 'Add node' };       // not draw.js toEntity: its 6-decimal rounding moves the outline
  let r = insertVertex(ent, i, q);
  for (const [k, h] of halves.entries()) if (r && !g.line) r = convertToArc(r.ent, i + k, pointAt(geo(h), 0.5));
  return r && { ent: r.ent, label: 'Add node' };
}

/** Remove polyline vertex i: the segment that joins its neighbours is straight, unless both are arcs of one circle (same direction, under a full turn together): then one arc of it (grill R1). Null when refused. */
function removeNode(ent, i) {
  const r = removeVertex(ent, i);       // straight; refuses below 2 (open) / 3 (closed) vertices
  if (!r) return null;
  const { segs } = pathOf(shapeOf(ent)), n = nodesOf(ent).length, p = segs[(i + n - 1) % n], q = segs[i];       // the segments before and after vertex i (an open end has one only)
  if (!p || !q) return r;
  const a = geo(p), b = geo(q);
  if (a.line || b.line || Math.abs(a.r - b.r) > 1e-6 * a.r || Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1]) > 1e-6 * a.r || a.sw * b.sw <= 0 || Math.abs(a.sw + b.sw) > 2 * Math.PI - 1e-6) return r;
  return convertToArc(r.ent, i ? i - 1 : n - 2, pointAt({ ...a, sw: a.sw + b.sw }, 0.5)) || r;
}

/** TODO 139b2: delete the nodes with these ids ('v3') of a polyline, each by removeNode: { ent, label } or null (not a polyline, or fewer than 2 / 3 nodes would stay: then none go). Lines, arcs and circles keep all theirs. */
export function deleteNodes(ent, ids) {
  if (ent?.type === 'SPLINE') return deleteBezier(ent, ids);       // 139e2b
  let r = { ent };
  for (const i of [...new Set(ids)].map((id) => +id.slice(1)).sort((a, b) => b - a)) if (r && ent?.type === 'LWPOLYLINE') r = removeNode(r.ent, i); else return null;       // from the last: the lower numbers stay valid
  return r && r.ent !== ent ? { ent: r.ent, label: new Set(ids).size > 1 ? 'Delete nodes' : 'Delete node' } : null;
}

const flat = (ent) => Math.abs(get(ent.r, 210) ?? 0) <= 1e-9 && Math.abs(get(ent.r, 220) ?? 0) <= 1e-9 && (get(ent.r, 230) ?? 1) > 0;       // not mirrored or tilted (as break.js, join.js)
const openPoly = (segs) => { const sh = polyOf(segs, false), l = sh.pts.at(-1); sh.pts[sh.pts.length - 1] = [l[0], l[1], 0, ...l.slice(3)]; return sh; };       // the last vertex of an open polyline has no bulge

/**
 * TODO 139c Break at node (grill R8): the open polylines a polyline or circle becomes when cut at the nodes ids ('v3', 'q1'), each with ent's properties; null when nothing is cut.
 * A closed outline opens at its first cut node (one piece when that is the only one); an open one splits at its inner nodes (its end nodes cut nothing). Bulges stay: each piece keeps its segments whole.
 * A line or arc has only end nodes: null.
 */
export function breakNodes(ent, ids) {
  if (ent?.type === 'SPLINE') return breakBezier(ent, ids);       // 139e2b
  if (!['LWPOLYLINE', 'CIRCLE'].includes(ent?.type) || !flat(ent)) return null;
  const sh = shapeOf(ent), { closed, segs } = sh.t === 'circle' ? { closed: true, segs: quarters(sh.c, sh.r) } : pathOf(sh), n = segs.length;
  const cuts = [...new Set(ids)].map((id) => +id.slice(1)).filter((k) => k >= (closed ? 0 : 1) && k < n).sort((a, b) => a - b);
  if (!cuts.length) return null;
  const run = closed ? [...segs.slice(cuts[0]), ...segs.slice(0, cuts[0])] : segs, from = [...new Set([0, ...cuts.map((k) => k - (closed ? cuts[0] : 0))])];
  return from.map((s, j) => rebuilt(openPoly(run.slice(s, from[j + 1] ?? n)), ent));
}

/** An open object's end node ids: a polyline's first and last vertex, a line's or arc's a and b; none for a closed one or another kind. */
const endIds = (ent) => {
  if (ent?.type === 'SPLINE') { const b = bezierOf(ent); return b && !b.closed ? ['n0', 'n' + b.n] : []; }       // 139e2b
  return classify(ent).reason ? [] : ent.type === 'LWPOLYLINE' ? ['v0', 'v' + (nodesOf(ent).length - 1)] : ['a', 'b'];
};

/**
 * TODO 139c Join nodes (grill Q6, R2): a and b are { ent, id }, two end nodes. Of one open object: the Close tool's result (closeline.js closeEntities, opts.ends 'extend' | 'straight').
 * Of two objects: both ends move to their midpoint (dragNodes), then joinEntities, whose result stays as it comes (a LINE or ARC when the pieces merge); a's object is the source of its properties.
 * { result, label, note } or { why } (nothing changes).
 */
export function joinNodes(a, b, opts = {}) {
  if ([a, b].some((x) => x.ent?.type === 'SPLINE' && !bezierOf(x.ent))) return { why: 'Not a Bezier curve: only Bezier splines are joined' };       // 139e2b
  if (!endIds(a.ent).includes(a.id) || !endIds(b.ent).includes(b.id)) return { why: 'Join nodes needs two end nodes of open lines, arcs, polylines or Bezier splines' };
  if ([a, b].some((x) => x.ent.type === 'SPLINE')) return a.ent === b.ent ? closeBezier(a.ent) : joinBezier(a, b);
  if (a.ent === b.ent) { const r = closeEntities([a.ent], opts); return r.result ? { result: r.result, label: 'Close', note: r.note } : { why: r.why }; }
  const [p, q] = [a, b].map((x) => nodesOf(x.ent).find((k) => k.id === x.id)), m = [(p.x + q.x) / 2, (p.y + q.y) / 2];
  const moved = [[a, p], [b, q]].map(([x, k]) => (Math.hypot(m[0] - k.x, m[1] - k.y) < 1e-12 ? x.ent : dragNodes(x.ent, [k], m[0] - k.x, m[1] - k.y).ent));
  const r = joinEntities(moved);
  return r.result ? { result: r.result, label: 'Join nodes' } : { why: r.skipped[0]?.reason ?? 'nothing joined' };
}

// ---- TODO 139e1: Bezier SPLINEs (grill-139e R1 / R3 / R4): a degree-3 SPLINE in piecewise-Bezier form, control points P = node, handle, handle, node, handle, handle, node, ... ----
const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** ent as a Bezier curve: { P: [[x, y, z], …] (3n + 1 control points), n: segments, closed }; null for any other SPLINE (fit points, weights, another degree or knots), a mirrored or tilted one, or another kind. */
export function bezierOf(ent) {
  if (ent?.type !== 'SPLINE' || !ent.r || !flat(ent)) return null;
  const s = splineOf(ent.r), { P, U } = s;
  if (s.p !== 3 || s.F.length || P.length < 4 || (P.length - 1) % 3 || U.length !== P.length + 4 || s.W?.some((w) => !near(w, 1))) return null;
  const n = (P.length - 1) / 3, runs = [];
  for (const u of U) if (runs.length && near(runs.at(-1)[0], u)) runs.at(-1)[1]++; else runs.push([u, 1]);
  if (runs.length !== n + 1 || runs.some(([, m], i) => m !== (i === 0 || i === n ? 4 : 3))) return null;       // clamped ends, every inner knot x3
  const closed = !!((get(ent.r, 70) ?? 0) & 1) && near(P[0][0], P[3 * n][0]) && near(P[0][1], P[3 * n][1]);
  return { P, n, closed };
}

/** The handles of these nodes ('n3') of a Bezier spline: { id: 'o3' (out, on the segment after) | 'i3' (in, on the one before), kind: 'handle', node, x, y }; an open curve's ends have one. */
export function handlesOf(ent, ids) {
  const b = bezierOf(ent), out = [];
  if (!b) return out;
  for (const id of new Set(ids)) {
    const i = +id.slice(1), at = (k) => ({ kind: 'handle', node: id, x: b.P[k][0], y: b.P[k][1] });
    if (id[0] !== 'n' || !(i >= 0 && i < (b.closed ? b.n : b.n + 1))) continue;
    if (i < b.n) out.push({ id: 'o' + i, ...at(3 * i + 1) });
    if (i > 0 || b.closed) out.push({ id: 'i' + i, ...at(i ? 3 * i - 1 : 3 * b.n - 1) });
  }
  return out;
}

/** Move these nodes and handles of a Bezier spline by (dx, dy): a node takes its two handles along, a handle moves alone; every node moves the curve whole. */
function dragBezier(ent, nodes, dx, dy) {
  const b = bezierOf(ent), ids = new Set(nodes.map((g) => g.id));
  if (!b || !(dx || dy)) return { ent, label: null, part: false };
  if (nodesOf(ent).every((g) => ids.has(g.id))) return { ent: translate(ent, dx, dy), label: 'Move', part: false };
  const { P, n, closed } = b, last = 3 * n, idx = new Set(), mark = (k) => { idx.add(k); if (closed && (k === 0 || k === last)) { idx.add(0); idx.add(last); } };       // a closed curve's first point is also its last
  for (const g of nodes) {
    const i = +g.id.slice(1), before = i ? 3 * i - 1 : last - 1;
    if (g.id[0] === 'n') { mark(3 * i); if (i < n) mark(3 * i + 1); if (i > 0 || closed) mark(before); }
    else mark(g.id[0] === 'o' ? 3 * i + 1 : before);
  }
  const Q = P.map((p, k) => (idx.has(k) ? [p[0] + dx, p[1] + dy, ...p.slice(2)] : p));
  for (const g of nodes) {       // 139e2a (grill R5): a handle dragged alone keeps its node's type: Smooth turns the other handle to stay collinear, Symmetrical mirrors it
    if (g.id[0] === 'n') continue;
    const i = +g.id.slice(1), out = g.id[0] === 'o', h = hOf(b, i), mine = out ? h.o : h.i, other = out ? h.i : h.o, t = nodeType(ent, 'n' + i);
    if (other == null || ids.has('n' + i) || ids.has((out ? 'i' : 'o') + i) || (t !== 'Smooth' && t !== 'Symmetrical')) continue;
    const c = Q[3 * i], v = [Q[mine][0] - c[0], Q[mine][1] - c[1]], l = Math.hypot(...v);
    if (l < 1e-9) continue;       // a handle on its node has no direction: the other stays
    const keep = t === 'Symmetrical' ? l : Math.hypot(P[other][0] - c[0], P[other][1] - c[1]);
    Q[other] = [c[0] - v[0] / l * keep, c[1] - v[1] / l * keep, ...P[other].slice(2)];
  }
  return { ent: spRecord(ent, { ...splineOf(ent.r), P: Q }), label: nodes.every((g) => g.id[0] !== 'n') ? 'Move handle' : 'Move node', part: false };
}

/** A segment as cubic Beziers [[p0, h1, h2, p1], …]: a line one with its handles at 1/3 and 2/3; an arc one per quarter turn or less, handles 4/3 tan(θ/4) r along the tangents. */
function cubics(s) {
  const g = geo(s), a = [s.a[0], s.a[1]], b = [s.b[0], s.b[1]];
  if (g.line) return [[a, [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3], [a[0] + (b[0] - a[0]) * 2 / 3, a[1] + (b[1] - a[1]) * 2 / 3], b]];
  const k = Math.max(1, Math.ceil(Math.abs(g.sw) / (Math.PI / 2) - 1e-9)), th = g.sw / k, h = 4 / 3 * Math.tan(th / 4) * g.r;
  const P = (t) => [g.c[0] + g.r * Math.cos(t), g.c[1] + g.r * Math.sin(t)];
  return Array.from({ length: k }, (_, j) => {
    const t0 = g.a0 + th * j, t1 = t0 + th, p0 = P(t0), p1 = P(t1);
    return [j ? p0 : a, [p0[0] - h * Math.sin(t0), p0[1] + h * Math.cos(t0)], [p1[0] + h * Math.sin(t1), p1[1] - h * Math.cos(t1)], j === k - 1 ? b : p1];
  });
}

/** A Bezier SPLINE through the control points P (3n + 1: node, handle, handle, node, …), closed or open, with like's layer, colour, line type and lineweight. */
function bezierEnt(P, closed, like) {
  const count = (P.length - 1) / 3, U = [0, 0, 0, 0, ...Array.from({ length: count - 1 }, (_, i) => [i + 1, i + 1, i + 1]).flat(), ...Array(4).fill(count)];
  return entity('SPLINE', [[70, closed ? 9 : 8], [71, 3], [72, U.length], [73, P.length], [74, 0], ...U.map((u) => [40, u]), ...P.flatMap((p) => [[10, p[0]], [20, p[1]], [30, p[2] ?? 0]])], like);
}

/**
 * TODO 139e1 To curve (grill R1 / R4): the whole object (a polyline, line, arc or circle) becomes one Bezier SPLINE with its layer, colour, line type and lineweight, closed when it was;
 * every line a straight cubic (handles at 1/3 and 2/3), every arc its closest cubics, so the outline stays. Needs a segment after one of the nodes ids.
 * { ent, label, ids: where those nodes are now } or { why }.
 */
export function toCurve(ent, ids) {
  if (ent?.type === 'SPLINE') return { why: bezierOf(ent) ? 'That segment is a Bezier curve already: drag its handles to bend it' : 'Not a Bezier curve' };
  if (!nodesOf(ent).length) return { why: 'This object has no nodes' };
  if (!flat(ent)) return { why: 'A mirrored or tilted object stays as it is' };
  if (ent.type === 'LWPOLYLINE' && ent.r.c.some((c, k) => [40, 41, 43].includes(c) && +ent.r.v[k])) return { why: 'A polyline with width stays a polyline' };
  const sh = shapeOf(ent), { closed, segs } = sh.t === 'circle' ? { closed: true, segs: quarters(sh.c, sh.r) } : pathOf(sh), m = segs.length;
  const idx = (id) => (ent.type === 'LWPOLYLINE' || ent.type === 'CIRCLE' ? +id.slice(1) : id === 'a' ? 0 : m), want = [...new Set(ids)].map(idx);
  if (!want.some((k) => k < m)) return { why: 'To curve needs a segment after the node: this is the last node of an open outline' };
  const P = [], first = [];
  for (const s of segs) { first.push(P.length ? (P.length - 1) / 3 : 0); for (const c of cubics(s)) P.push(...(P.length ? c.slice(1) : c)); }
  const count = (P.length - 1) / 3;
  if (closed) P[P.length - 1] = P[0];
  first.push(count);
  const out = bezierEnt(P, closed, ent);
  return { ent: withCusps(out, nodesOf(out).map((n) => n.id).filter((id) => (nodeType(out, id) ?? 'Cusp') !== 'Cusp')), label: 'To curve', ids: want.filter((k) => k <= m).map((k) => 'n' + first[k]) };       // 139e2a: every new node is a Cusp, even where the handles happen to line up
}

/** Are the handles of segment s (control points 3s .. 3s+3 of P) on its chord: a straight segment? */
function straight(P, s) {
  const [a, c1, c2, d] = P.slice(3 * s, 3 * s + 4), len = Math.hypot(d[0] - a[0], d[1] - a[1]);
  const off = (p) => (len ? Math.abs((p[0] - a[0]) * (d[1] - a[1]) - (p[1] - a[1]) * (d[0] - a[0])) / len : Math.hypot(p[0] - a[0], p[1] - a[1]));
  return off(c1) <= 1e-9 * (1 + len) && off(c2) <= 1e-9 * (1 + len);
}

/** TODO 139e1 To line (grill R4): the segment after each of these nodes ids ('n3') of a Bezier spline gets its handles on its chord, at 1/3 and 2/3 (it stays a SPLINE). { ent, label } or { why } (not a Bezier curve, no segment after, or all straight already). */
export function toLine(ent, ids) {
  const b = bezierOf(ent);
  if (!b) return { why: 'Not a Bezier curve' };
  const ks = [...new Set(ids)].map((id) => +id.slice(1)).filter((k) => k < b.n);
  if (!ks.length) return { why: 'To line needs a segment after the node: this is the last node of an open curve' };
  const Q = b.P.slice();
  let changed = false;
  for (const k of ks) {
    const [a, , , d] = b.P.slice(3 * k, 3 * k + 4);
    if (straight(b.P, k)) continue;       // its handles are on the chord already
    Q[3 * k + 1] = [a[0] + (d[0] - a[0]) / 3, a[1] + (d[1] - a[1]) / 3, ...a.slice(2)]; Q[3 * k + 2] = [a[0] + (d[0] - a[0]) * 2 / 3, a[1] + (d[1] - a[1]) * 2 / 3, ...a.slice(2)];
    changed = true;
  }
  return changed ? { ent: spRecord(ent, { ...splineOf(ent.r), P: Q }), label: 'To line' } : { why: 'That segment is straight already' };
}

// ---- TODO 139e2a: node types Cusp / Smooth / Symmetrical (grill-139e R5). No saved form: a node's type is read back from its handles (collinear and equal = Symmetrical, collinear = Smooth, else Cusp),
// except a Cusp whose handles happen to line up, which the entity remembers in ent.cusps (node ids, in memory only: lost with a reload or any edit that rebuilds the entity).
const withCusps = (ent, list) => { const { cusps, ...rest } = ent; return list.length ? { ...rest, cusps: list } : rest; };
/** The control point indexes of node i's handles: out (the segment after) and in (the one before), null where an open curve's end has none. */
const hOf = (b, i) => ({ o: i < b.n ? 3 * i + 1 : null, i: i > 0 ? 3 * i - 1 : b.closed ? 3 * b.n - 1 : null });

/** The type ('Cusp' | 'Smooth' | 'Symmetrical') of node id ('n3') of a Bezier spline; null for another curve or an end node of an open one (one handle only). */
export function nodeType(ent, id) {
  const b = bezierOf(ent), i = +id.slice(1);
  if (!b || id[0] !== 'n' || !(i >= 0 && i < (b.closed ? b.n : b.n + 1))) return null;
  const h = hOf(b, i);
  if (h.o == null || h.i == null) return null;
  if (ent.cusps?.includes(id)) return 'Cusp';
  const c = b.P[3 * i], vo = [b.P[h.o][0] - c[0], b.P[h.o][1] - c[1]], vi = [b.P[h.i][0] - c[0], b.P[h.i][1] - c[1]], lo = Math.hypot(...vo), li = Math.hypot(...vi);
  if (lo < 1e-9 || li < 1e-9 || Math.abs(vo[0] * vi[1] - vo[1] * vi[0]) > 1e-6 * lo * li || vo[0] * vi[0] + vo[1] * vi[1] >= 0) return 'Cusp';
  return Math.abs(lo - li) <= 1e-6 * Math.max(lo, li) ? 'Symmetrical' : 'Smooth';
}

/** Node i's two handles made collinear (Smooth: lengths kept; Symmetrical: equal) → { o, i: the new control points } or { why }. A straight side keeps its direction (the curved side turns to it); two curved sides share the bisector. */
function aligned(b, i, type) {
  const h = hOf(b, i), c = b.P[3 * i], vo = [b.P[h.o][0] - c[0], b.P[h.o][1] - c[1]], vi = [b.P[h.i][0] - c[0], b.P[h.i][1] - c[1]], lo = Math.hypot(...vo), li = Math.hypot(...vi);
  const so = straight(b.P, i), si = straight(b.P, (i + b.n - 1) % b.n);
  if (so && si) return { why: 'No curve on either side of this node: drag a handle to curve one side first' };
  const unit = (v) => { const l = Math.hypot(...v); return l > 1e-9 ? [v[0] / l, v[1] / l] : null; }, p = b.P[3 * (i ? i - 1 : b.n - 1)], q = b.P[3 * i + 3];
  const uo = unit(so ? [q[0] - c[0], q[1] - c[1]] : vo), ui = unit(si ? [c[0] - p[0], c[1] - p[1]] : [-vi[0], -vi[1]]);       // the direction each side leaves the node in, travelling on
  const sum = uo && ui ? unit([uo[0] + ui[0], uo[1] + ui[1]]) : null, u = so ? uo : si ? ui : sum || uo || ui;
  if (!u) return { why: 'The handles have no direction (zero length): drag one out first' };
  if (type === 'Smooth' && (lo < 1e-9 || li < 1e-9)) return { why: 'A handle of zero length has no direction: drag it out first' };
  const L = (so ? lo : si ? li : (lo + li) / 2) || Math.max(lo, li), a = type === 'Smooth' ? lo : L, z = type === 'Smooth' ? li : L;
  if (a + z < 1e-9) return { why: 'The handles have no length: drag one out first' };
  return { o: [c[0] + u[0] * a, c[1] + u[1] * a, ...b.P[h.o].slice(2)], i: [c[0] - u[0] * z, c[1] - u[1] * z, ...b.P[h.i].slice(2)] };
}

/**
 * TODO 139e2a Node types (grill R5): these nodes ('n3') of a Bezier spline become type 'Cusp' | 'Smooth' | 'Symmetrical'. Smooth turns the handles collinear (lengths kept), Symmetrical collinear and equal;
 * Cusp leaves them where they are and frees them from then on (ent.cusps). { ent, label } or { why } when no node changed: not a Bezier curve, an end node, no curve either side, already that type.
 */
export function setNodeType(ent, ids, type) {
  const b = bezierOf(ent);
  if (!b) return { why: 'Not a Bezier curve' };
  const Q = b.P.slice(), cusps = new Set(ent.cusps);
  let why = 'Select a node first', changed = 0;
  for (const id of new Set(ids)) {
    const t = nodeType(ent, id), i = +id.slice(1), h = hOf(b, i);
    if (!t) { why = 'An end node of an open curve has one handle only, so no type'; continue; }
    if (t === type) { why = `This node is ${type} already`; continue; }
    if (type === 'Cusp') cusps.add(id);
    else { const r = aligned(b, i, type); if (r.why) { why = r.why; continue; } Q[h.o] = r.o; Q[h.i] = r.i; cusps.delete(id); }
    changed++;
  }
  return changed ? { ent: withCusps(spRecord(ent, { ...splineOf(ent.r), P: Q }), [...cusps]), label: `${type} node${changed > 1 ? 's' : ''}` } : { why };
}

// ---- TODO 139e2b: add node, Delete, Break and Join on Bezier splines (grill-139e R6 / R9). Each builds a new Bezier SPLINE (bezierEnt) and carries the Cusp memory over to the nodes' new numbers. ----
const lerp = (a, b, t) => a.map((x, k) => x + (b[k] - x) * t);
const bezAt = (q, t) => { const m = lerp(q[1], q[2], t); return lerp(lerp(lerp(q[0], q[1], t), m, t), lerp(m, lerp(q[2], q[3], t), t), t); };
const cubicAt = (b, s) => b.P.slice(3 * s, 3 * s + 4);

/** The parameter of cubic q nearest to p, and the distance there: four rounds of 33 samples, each narrowed to the best one's neighbours. */
function nearest(q, p) {
  let lo = 0, hi = 1, t = 0, d = Infinity;
  for (let r = 0; r < 4; r++) {
    const w = (hi - lo) / 32;
    for (let k = 0; k <= 32; k++) { const u = lo + w * k, c = bezAt(q, u), e = Math.hypot(c[0] - p[0], c[1] - p[1]); if (e < d) { d = e; t = u; } }
    lo = Math.max(0, t - w); hi = Math.min(1, t + w);
  }
  return { t, d };
}

/** `out` (a spline made from ent) with ent's remembered Cusps: its node j was ent's node from[j] (null: a new one); the ids in `extra` are Cusps too. */
const carry = (out, ent, from, extra = []) => withCusps(out, [...new Set([...extra, ...from.flatMap((o, j) => (o != null && ent.cusps?.includes('n' + o) ? ['n' + j] : []))])]);

/** Add node on a Bezier spline: the cubic nearest p (within tol) splits there by de Casteljau, so the curve stays; the new node is a Cusp. { ent, label } or null (not a Bezier curve, too far, on a node). */
function addBezier(ent, p, tol) {
  const b = bezierOf(ent);
  if (!b) return null;
  let hit = null;
  for (let s = 0; s < b.n; s++) { const h = nearest(cubicAt(b, s), p); if (!hit || h.d < hit.d) hit = { ...h, s }; }
  if (!(hit.d <= tol) || hit.t < 1e-6 || hit.t > 1 - 1e-6) return null;
  const { s, t } = hit, [q0, q1, q2, q3] = cubicAt(b, s), a = lerp(q0, q1, t), m = lerp(q1, q2, t), c = lerp(q2, q3, t), d = lerp(a, m, t), e = lerp(m, c, t);
  const P = [...b.P.slice(0, 3 * s + 1), a, d, lerp(d, e, t), e, c, ...b.P.slice(3 * s + 3)];
  return { ent: carry(bezierEnt(P, b.closed, ent), ent, Array.from({ length: (b.closed ? b.n : b.n + 1) + 1 }, (_, j) => (j <= s ? j : j === s + 1 ? null : j - 1)), ['n' + (s + 1)]), label: 'Add node' };
}

/** Delete nodes of a Bezier spline: a node's two segments become one cubic with the outer handles kept; an open curve's end drops its segment. { ent, label }; ent null when fewer than 2 nodes would stay (the object goes); null when no id is a node. */
function deleteBezier(ent, ids) {
  const b = bezierOf(ent), N = b && (b.closed ? b.n : b.n + 1), gone = b ? [...new Set(ids)].filter((id) => id[0] === 'n' && +id.slice(1) < N).map((id) => +id.slice(1)).sort((x, y) => y - x) : [];
  if (!gone.length) return null;
  const label = gone.length > 1 ? 'Delete nodes' : 'Delete node';
  let P = b.P, n = b.n;
  for (const i of gone) {       // from the last: the lower numbers stay valid
    if ((b.closed ? n : n + 1) - 1 < 2) return { ent: null, label };
    if (!b.closed && i === 0) P = P.slice(3);
    else if (!b.closed && i === n) P = P.slice(0, 3 * n - 2);
    else if (i === 0) P = [...P.slice(3, 3 * n - 1), P[2], P[3]];       // closed: the curve starts at the old node 1 now
    else P = [...P.slice(0, 3 * i - 1), ...P.slice(3 * i + 2)];
    n--;
  }
  return { ent: carry(bezierEnt(P, b.closed, ent), ent, Array.from({ length: N }, (_, j) => j).filter((j) => !gone.includes(j))), label };
}

/** Break at node on a Bezier spline: an open curve splits into two at an inner node, a closed one opens into one starting at its first cut node (more cuts, more pieces); the curves stay. The open splines, or null when nothing is cut. */
function breakBezier(ent, ids) {
  const b = bezierOf(ent);
  if (!b) return null;
  const { closed, n } = b, cuts = [...new Set(ids)].filter((id) => id[0] === 'n').map((id) => +id.slice(1)).filter((k) => k >= (closed ? 0 : 1) && k < n).sort((x, y) => x - y);
  if (!cuts.length) return null;
  const c0 = closed ? cuts[0] : 0, segs = Array.from({ length: n }, (_, s) => cubicAt(b, s)), run = [...segs.slice(c0), ...segs.slice(0, c0)], from = [...new Set([0, ...cuts.map((k) => k - c0)])];
  return from.map((s, j) => {
    const part = run.slice(s, from[j + 1] ?? n);
    return carry(bezierEnt(part.flatMap((q, k) => (k ? q.slice(1) : q)), false, ent), ent, Array.from({ length: part.length + 1 }, (_, k) => (s + k + c0) % (closed ? n : n + 1)));
  });
}

/** Join nodes, the two ends of one Bezier spline: closed by a straight segment (none when they meet). { result, label } like closeline.js closeEntities. */
function closeBezier(ent) {
  const b = bezierOf(ent), p = b.P[3 * b.n], q = b.P[0], meet = Math.hypot(q[0] - p[0], q[1] - p[1]) <= 1e-9;
  const P = meet ? [...b.P.slice(0, -1), q] : [...b.P, lerp(p, q, 1 / 3), lerp(p, q, 2 / 3), q];
  return { result: carry(bezierEnt(P, true, ent), ent, Array.from({ length: meet ? b.n : b.n + 1 }, (_, j) => j), meet ? ['n0'] : ['n0', 'n' + b.n]), label: 'Close' };
}

/** Join nodes of two objects, a Bezier spline end and another spline's or a polyline's, line's or arc's (that one goes through toCurve first): both ends move to their midpoint (dragNodes), the curves run on from there into one Bezier SPLINE with a's properties; the joint is a Cusp. */
function joinBezier(a, b) {
  const parts = [];
  for (const x of [a, b]) {
    const r = x.ent.type === 'SPLINE' ? { ent: x.ent } : toCurve(x.ent, nodesOf(x.ent).map((k) => k.id));
    if (!r.ent) return { why: r.why };
    const z = bezierOf(r.ent), start = endIds(x.ent)[0] === x.id;
    parts.push({ ent: r.ent, start, at: z.P[start ? 0 : 3 * z.n], id: start ? 'n0' : 'n' + z.n });
  }
  const m = [(parts[0].at[0] + parts[1].at[0]) / 2, (parts[0].at[1] + parts[1].at[1]) / 2];
  const [A, B] = parts.map((x, k) => {
    const e = dragNodes(x.ent, [nodesOf(x.ent).find((g) => g.id === x.id)], m[0] - x.at[0], m[1] - x.at[1]).ent, z = bezierOf(e), flip = k ? !x.start : x.start;       // a runs into the joint, b out of it
    return { ent: e, P: flip ? z.P.slice().reverse() : z.P, n: z.n, cusps: (e.cusps ?? []).map((id) => (flip ? z.n - +id.slice(1) : +id.slice(1))) };
  });
  const out = bezierEnt([...A.P, ...B.P.slice(1)], false, A.ent);
  return { result: withCusps(out, [...A.cusps, ...B.cusps.map((j) => j + A.n), A.n].map((j) => 'n' + j)), label: 'Join nodes' };
}
