// shape.js — TODO 139a Shape tool nodes, pure (no DOM): shape.test.mjs.
//
// A node is one of an object's grips (grips.js gripsOf): a polyline's vertices, a line's or an arc's two ends, a circle's four quadrants.
//   nodesOf(ent)                → [{ id, kind, x, y }] (empty for any other kind)
//   nodesIn(nodes, a, b)        → the nodes inside the box with corners a, b
//   dragNodes(ent, nodes, dx, dy) → { ent, label, part } with these nodes of ent moved by (dx, dy): each through grips.js dragGrip (stretch.js stretchGrips),
//                                  the whole object when every node is in the set or 2+ quadrants of a circle are (grill R3)
//   addNode(ent, p, tol)        → { ent, label } with a new node on the outline nearest p, the outline unchanged (TODO 139b1)
// Where the app drives it (app.js; grep the name): gripList (the Shape tool lists nodes, not grips: gripAt hit-tests them), shapeKeys / shapeSet (the selected nodes),
// hotsOf (they stand in for hot grips), gripUp (a click selects, Shift+click toggles), shapeBox (a box selects), gripStretchHots (dragNodes).
import { gripsOf, shapeOf, insertVertex, convertToArc } from './grips.js';
import { stretchGrips } from './stretch.js';
import { pathOf, closest, geo, pointAt, subSeg, polyOf } from './modify.js';
import { lwpoly } from './dxf-write.js';

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
