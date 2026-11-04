// Join (AutoCAD JOIN): several open lines, arcs and polylines become one object. Pure, in drawing units: join.test.mjs.
//
//   joinEntities(entities, { close }) → { result, skipped: [{ entity, reason }] }
//
// The first joinable entity is the source: the result has its layer, colour, line type and lineweight. Collinear lines become a LINE
// (gaps bridged, overlaps merged); arcs of one circle become an ARC (gaps bridged counterclockwise; `close` makes a CIRCLE); anything else whose
// ends touch (within 2e-6, DECISIONS "Joined means within 2e-6") becomes an LWPOLYLINE, closed when the chain closes.
// Join gaps (edit.js) is another thing: it moves ends together and leaves the objects separate.
import { shapeOf, get } from './grips.js';
import { pathOf, polyOf, rebuilt } from './modify.js';

const TOL = 2e-6, DEG = 180 / Math.PI;
export const NO_TOUCH = 'ends do not touch';
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const norm360 = (t) => ((t % 360) + 360) % 360;

/** { sh, path } for an entity that can be joined, else { reason }. */
function classify(e) {
  if (e?.type === 'ELLIPSE' || e?.type === 'SPLINE') return { reason: 'ellipses and splines are not joined' };
  if (!['LINE', 'ARC', 'LWPOLYLINE', 'CIRCLE'].includes(e?.type)) return { reason: 'only lines, arcs and polylines are joined' };
  if (e.type !== 'LINE' && (Math.abs(get(e.r, 210) ?? 0) > 1e-9 || Math.abs(get(e.r, 220) ?? 0) > 1e-9 || (get(e.r, 230) ?? 1) < 0)) return { reason: 'mirrored or tilted objects are not joined' };
  const sh = shapeOf(e), path = pathOf(sh);
  if (path.closed || sh.closed) return { reason: 'closed objects are not joined' };
  if (!path.segs.length) return { reason: 'it has no length' };
  return { sh, path };
}

/** Collinear lines → one line; arcs of the source's circle → one arc (or a circle); else null. */
function merged(src, items, close) {
  const s = src.sh;
  if (s.t === 'line' && dist(s.a, s.b) > 1e-9) {
    const len = dist(s.a, s.b), u = [(s.b[0] - s.a[0]) / len, (s.b[1] - s.a[1]) / len], rel = (p) => [p[0] - s.a[0], p[1] - s.a[1]];
    const used = items.filter((i) => i.sh.t === 'line' && [i.sh.a, i.sh.b].every((p) => Math.abs(u[0] * rel(p)[1] - u[1] * rel(p)[0]) <= TOL));
    if (used.length < 2) return null;
    const ts = used.flatMap((i) => [i.sh.a, i.sh.b]).map((p) => u[0] * rel(p)[0] + u[1] * rel(p)[1]), lo = Math.min(...ts), hi = Math.max(...ts);
    return { used, sh: { t: 'line', a: [s.a[0] + u[0] * lo, s.a[1] + u[1] * lo], b: [s.a[0] + u[0] * hi, s.a[1] + u[1] * hi] } };
  }
  if (s.t !== 'arc') return null;
  const used = items.filter((i) => i.sh.t === 'arc' && dist(i.sh.c, s.c) <= TOL && Math.abs(i.sh.r - s.r) <= TOL);
  if (close) return { used, sh: { t: 'circle', c: s.c, r: s.r } };
  if (used.length < 2) return null;
  const eps = TOL / s.r * DEG;
  let lo = 0, hi = 0;
  for (const { sh } of used) {
    // angles from the source's start; an arc that runs over that start (or ends on it) begins before it
    const sw = norm360(sh.a1 - sh.a0) || 360, from = norm360(sh.a0 - s.a0), before = from + sw >= 360 - eps && from > 0;
    lo = Math.min(lo, before ? from - 360 : from); hi = Math.max(hi, (before ? from - 360 : from) + sw);
  }
  if (hi - lo >= 360 - eps) return { used, sh: { t: 'circle', c: s.c, r: s.r } };
  return { used, sh: { t: 'arc', c: s.c, r: s.r, a0: norm360(s.a0 + lo), a1: norm360(s.a0 + hi) } };
}

const flip = (segs) => segs.map((g) => ({ a: [g.b[0], g.b[1], 0, ...(g.a.length > 3 ? [g.a[4], g.a[3]] : [])], b: [g.a[0], g.a[1]], bulge: -g.bulge })).reverse();

/** Pieces touching end to end, from the source outwards: { used, sh } or null when nothing touches the source. */
function chained(src, items) {
  const rest = items.filter((i) => i !== src), used = [src];
  let segs = src.path.segs, closed = false;
  const take = (at) => {            // a piece with an end at `at`, turned so that end is where it starts
    for (const [k, i] of rest.entries()) {
      const g = i.path.segs;
      if (dist(g[0].a, at) <= TOL) { rest.splice(k, 1); used.push(i); return g; }
      if (dist(g[g.length - 1].b, at) <= TOL) { rest.splice(k, 1); used.push(i); return flip(g); }
    }
    return null;
  };
  for (let more = true; more && !closed;) {
    const tail = take(segs[segs.length - 1].b);
    if (tail) segs = [...segs, ...tail];
    const head = !tail && take(segs[0].a);
    if (head) segs = [...flip(head), ...segs];
    more = !!(tail || head);
    closed = used.length > 1 && dist(segs[segs.length - 1].b, segs[0].a) <= TOL;
  }
  if (used.length < 2) return null;
  const sh = polyOf(segs, closed);
  if (!closed) sh.pts[sh.pts.length - 1] = sh.pts[sh.pts.length - 1].slice(0, 2);       // an open polyline's last vertex has no bulge
  return { used, sh };
}

export function joinEntities(entities, opts = {}) {
  const skipped = [], items = [];
  for (const entity of entities) {
    const c = classify(entity);
    if (c.reason) skipped.push({ entity, reason: c.reason }); else items.push({ entity, ...c });
  }
  const src = items[0], r = src && (merged(src, items, opts.close) || chained(src, items));
  if (!r) return { result: null, skipped: [...skipped, ...items.map(({ entity }) => ({ entity, reason: NO_TOUCH }))] };
  return { result: rebuilt(r.sh, src.entity), skipped: [...skipped, ...items.filter((i) => !r.used.includes(i)).map(({ entity }) => ({ entity, reason: NO_TOUCH }))] };
}
