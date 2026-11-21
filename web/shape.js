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
// Where the app drives it (app.js; grep the name): gripList (the Shape tool lists nodes, not grips: gripAt hit-tests them), shapeKeys / shapeSet (the selected nodes),
// hotsOf (they stand in for hot grips), gripUp (a click selects, Shift+click toggles), shapeBox (a box selects), gripStretchHots (dragNodes).
import { gripsOf, shapeOf, insertVertex, removeVertex, convertToArc, get } from './grips.js';
import { stretchGrips } from './stretch.js';
import { pathOf, closest, geo, pointAt, subSeg, polyOf, rebuilt } from './modify.js';
import { lwpoly } from './dxf-write.js';
import { classify, joinEntities } from './join.js';
import { closeEntities } from './closeline.js';

const KIND = { LWPOLYLINE: 'vertex', LINE: 'end', ARC: 'end', CIRCLE: 'quad' };

export const nodesOf = (ent) => (ent && KIND[ent.type] ? gripsOf(ent).filter((g) => g.kind === KIND[ent.type]) : []);

export const nodesIn = (nodes, a, b) => nodes.filter((n) => n.x >= Math.min(a[0], b[0]) && n.x <= Math.max(a[0], b[0]) && n.y >= Math.min(a[1], b[1]) && n.y <= Math.max(a[1], b[1]));

/** Does moving these nodes move the object whole? */
function whole(ent, nodes) {
  const ids = new Set(nodes.map((n) => n.id));
  return ent.type === 'CIRCLE' ? ids.size >= 2 : nodesOf(ent).every((n) => ids.has(n.id));
}

export const dragNodes = (ent, nodes, dx, dy) => stretchGrips(ent, nodes, dx, dy, false, whole(ent, nodes));

/** A circle as four quarter arcs from quadrant 0 anticlockwise, so its quadrant nodes stay nodes. */
const quarters = (c, r) => [0, 1, 2, 3].map((i) => ({ a: [c[0] + r * Math.cos(i * Math.PI / 2), c[1] + r * Math.sin(i * Math.PI / 2)], b: [c[0] + r * Math.cos((i + 1) * Math.PI / 2), c[1] + r * Math.sin((i + 1) * Math.PI / 2)], bulge: Math.tan(Math.PI / 8) }));

/**
 * TODO 139b1: a new node on ent's outline at the point nearest p (none farther than tol): { ent, label } or null (not a node kind, too far, or on a node).
 * The outline stays: the hit segment splits in two, an arc into two arcs of its circle (grill Q4). A line, arc or circle becomes a polyline (grill Q3, R4)
 * with its layer, colour, line type and lineweight (dxf-write.js lwpoly); a polyline keeps its record (grips.js insertVertex, then each half's bulge).
 */
export function addNode(ent, p, tol = Infinity) {
  if (!nodesOf(ent).length || !p) return null;
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
  if (!['LWPOLYLINE', 'CIRCLE'].includes(ent?.type) || !flat(ent)) return null;
  const sh = shapeOf(ent), { closed, segs } = sh.t === 'circle' ? { closed: true, segs: quarters(sh.c, sh.r) } : pathOf(sh), n = segs.length;
  const cuts = [...new Set(ids)].map((id) => +id.slice(1)).filter((k) => k >= (closed ? 0 : 1) && k < n).sort((a, b) => a - b);
  if (!cuts.length) return null;
  const run = closed ? [...segs.slice(cuts[0]), ...segs.slice(0, cuts[0])] : segs, from = [...new Set([0, ...cuts.map((k) => k - (closed ? cuts[0] : 0))])];
  return from.map((s, j) => rebuilt(openPoly(run.slice(s, from[j + 1] ?? n)), ent));
}

/** An open object's end node ids: a polyline's first and last vertex, a line's or arc's a and b; none for a closed one or another kind. */
const endIds = (ent) => (classify(ent).reason ? [] : ent.type === 'LWPOLYLINE' ? ['v0', 'v' + (nodesOf(ent).length - 1)] : ['a', 'b']);

/**
 * TODO 139c Join nodes (grill Q6, R2): a and b are { ent, id }, two end nodes. Of one open object: the Close tool's result (closeline.js closeEntities, opts.ends 'extend' | 'straight').
 * Of two objects: both ends move to their midpoint (dragNodes), then joinEntities, whose result stays as it comes (a LINE or ARC when the pieces merge); a's object is the source of its properties.
 * { result, label, note } or { why } (nothing changes).
 */
export function joinNodes(a, b, opts = {}) {
  if (!endIds(a.ent).includes(a.id) || !endIds(b.ent).includes(b.id)) return { why: 'Join nodes needs two end nodes of open lines, arcs or polylines' };
  if (a.ent === b.ent) { const r = closeEntities([a.ent], opts); return r.result ? { result: r.result, label: 'Close', note: r.note } : { why: r.why }; }
  const [p, q] = [a, b].map((x) => nodesOf(x.ent).find((k) => k.id === x.id)), m = [(p.x + q.x) / 2, (p.y + q.y) / 2];
  const moved = [[a, p], [b, q]].map(([x, k]) => (Math.hypot(m[0] - k.x, m[1] - k.y) < 1e-12 ? x.ent : dragNodes(x.ent, [k], m[0] - k.x, m[1] - k.y).ent));
  const r = joinEntities(moved);
  return r.result ? { result: r.result, label: 'Join nodes' } : { why: r.skipped[0]?.reason ?? 'nothing joined' };
}
