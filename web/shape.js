// shape.js — TODO 139a Shape tool nodes, pure (no DOM): shape.test.mjs.
//
// A node is one of an object's grips (grips.js gripsOf): a polyline's vertices, a line's or an arc's two ends, a circle's four quadrants.
//   nodesOf(ent)                → [{ id, kind, x, y }] (empty for any other kind)
//   nodesIn(nodes, a, b)        → the nodes inside the box with corners a, b
//   dragNodes(ent, nodes, dx, dy) → { ent, label, part } with these nodes of ent moved by (dx, dy): each through grips.js dragGrip (stretch.js stretchGrips),
//                                  the whole object when every node is in the set or 2+ quadrants of a circle are (grill R3)
// Where the app drives it (app.js; grep the name): gripList (the Shape tool lists nodes, not grips: gripAt hit-tests them), shapeKeys / shapeSet (the selected nodes),
// hotsOf (they stand in for hot grips), gripUp (a click selects, Shift+click toggles), shapeBox (a box selects), gripStretchHots (dragNodes).
import { gripsOf } from './grips.js';
import { stretchGrips } from './stretch.js';

const KIND = { LWPOLYLINE: 'vertex', LINE: 'end', ARC: 'end', CIRCLE: 'quad' };

export const nodesOf = (ent) => (ent && KIND[ent.type] ? gripsOf(ent).filter((g) => g.kind === KIND[ent.type]) : []);

export const nodesIn = (nodes, a, b) => nodes.filter((n) => n.x >= Math.min(a[0], b[0]) && n.x <= Math.max(a[0], b[0]) && n.y >= Math.min(a[1], b[1]) && n.y <= Math.max(a[1], b[1]));

/** Does moving these nodes move the object whole? */
function whole(ent, nodes) {
  const ids = new Set(nodes.map((n) => n.id));
  return ent.type === 'CIRCLE' ? ids.size >= 2 : nodesOf(ent).every((n) => ids.has(n.id));
}

export const dragNodes = (ent, nodes, dx, dy) => stretchGrips(ent, nodes, dx, dy, false, whole(ent, nodes));
