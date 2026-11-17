// Close (TODO 290): an open line, arc or polyline (or several, pieces that nearly meet) becomes one closed polyline. Pure, in drawing units: closeline.test.mjs.
//
//   closeEntities(entities, { ends: 'extend' | 'straight' }) → { result, skipped: [{ entity, reason }], note, why }
//
// Pieces are chained nearest free ends first (any gap, far or not), then the last end is joined to the first. Each gap is closed by a straight
// segment ('straight'), or, with 'extend', the two end lines are run on to where they cross ahead of both ends (no further than 10 gaps away);
// no such crossing (parallel, an arc end) → straight, with a note. The result keeps the first object's layer, colour, line type (join.js rule).
// A lone arc closes with its chord, never a circle (that is Join's cLose). `result` null → `why`.
// joinFar (Join's "Far ends" option, TODO 290b) uses the same bridging and leaves the chain open.
import { classify, flip, joinEntities, NO_TOUCH } from './join.js';
import { polyOf, rebuilt } from './modify.js';

const TOL = 2e-6, REACH = 10, MAX_OBJECTS = 300;      // shortcut: the nearest-ends pairing costs n³; 300 objects is a drawing's worth of pieces, more asks for Join first
export const ALREADY = 'already closed';
export const NOT_AHEAD = 'ends do not meet ahead: closed straight';
export const ONE_LINE = 'a single line has no area to close';
export const FLAT = 'the pieces lie on one line: no area to close';
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** The pieces' segment lists chained nearest free ends first into one list { S, notes }; `close` also joins the last end to the first (Close), else the chain stays open (Join far ends, TODO 290b). */
function bridge(pieces, { extend, close }) {
  const notes = new Set();
  /** Where A's last line and B's first line, run on, cross ahead of both ends and within REACH gaps; null when they do not. */
  const meet = (A, B) => {
    const sa = A[A.length - 1], sb = B[0], P = sa.b, Q = sb.a, gap = dist(P, Q);
    if (!extend || sa.bulge || sb.bulge) return null;
    const d = [P[0] - sa.a[0], P[1] - sa.a[1]], e = [sb.b[0] - Q[0], sb.b[1] - Q[1]], w = [Q[0] - P[0], Q[1] - P[1]], cr = d[0] * e[1] - d[1] * e[0], ld = Math.hypot(...d), le = Math.hypot(...e);
    if (Math.abs(cr) <= 1e-9 * ld * le) return null;                                  // parallel
    const t = (w[0] * e[1] - w[1] * e[0]) / cr, u = (w[0] * d[1] - w[1] * d[0]) / cr;   // P + t·d = Q + u·e: ahead of A is t > 0, ahead of B is u < 0
    return t > 0 && u < 0 && t * ld <= REACH * gap && -u * le <= REACH * gap ? [P[0] + t * d[0], P[1] + t * d[1]] : null;
  };
  const straight = (P, Q) => { if (extend) notes.add(NOT_AHEAD); return { a: [P[0], P[1]], b: [Q[0], Q[1]], bulge: 0 }; };
  const glue = (A, B) => {          // A's end meets B's start
    const P = A[A.length - 1].b, Q = B[0].a;
    if (dist(P, Q) <= TOL) return [...A, ...B];
    const X = meet(A, B);
    return X ? [...A.slice(0, -1), { ...A[A.length - 1], b: X }, { ...B[0], a: [...X, ...B[0].a.slice(2)] }, ...B.slice(1)] : [...A, straight(P, Q), ...B];
  };

  const chains = [...pieces];
  while (chains.length > 1) {
    let best = null;
    for (let i = 0; i < chains.length; i++) for (let j = i + 1; j < chains.length; j++) {
      const a = chains[i], b = chains[j], ha = a[0].a, ta = a[a.length - 1].b, hb = b[0].a, tb = b[b.length - 1].b;
      // the 6th value is the closing gap: with two chains left the bridge is chosen by bridge + closing gap, so parallel lines are not crossed
      for (const c of [[dist(ta, hb), i, false, j, false, dist(tb, ha)], [dist(ta, tb), i, false, j, true, dist(hb, ha)], [dist(ha, hb), i, true, j, false, dist(ta, tb)], [dist(ha, tb), j, false, i, false, dist(ta, hb)]]) {
        const cost = c[0] + (close && chains.length === 2 ? c[5] : 0);
        if (!best || cost < best.cost || cost === best.cost && c[0] < best.c[0]) best = { c, i, j, cost };
      }
    }
    const [, p, fp, q, fq] = best.c;
    chains[best.i] = glue(fp ? flip(chains[p]) : chains[p], fq ? flip(chains[q]) : chains[q]);
    chains.splice(best.j, 1);
  }
  let S = chains[0];
  if (close && !(S.length === 1 && !S[0].bulge)) {
    const first = S[0], last = S[S.length - 1], P = last.b, Q = first.a;
    if (dist(P, Q) > TOL) {
      const X = meet(S, S);
      S = X ? [{ ...first, a: [...X, ...first.a.slice(2)] }, ...S.slice(1, -1), { ...last, b: X }] : [...S, straight(P, Q)];
    }
  }
  return { S, notes };
}

/** Join with Far ends on (TODO 290b): every joinable piece bridged into one open chain (or, with `close`, closed as Close does; arcs of one circle become a circle first, as Join's cLose). */
export function joinFar(entities, { ends = 'extend', close = false } = {}) {
  if (close) {
    const j = joinEntities(entities, { close: true });
    if (j.result?.type === 'CIRCLE' && !j.skipped.some((s) => s.reason === NO_TOUCH)) return j;
    return closeEntities(entities, { ends });
  }
  const skipped = [], items = [];
  if (entities.length > MAX_OBJECTS) return { result: null, skipped, why: `more than ${MAX_OBJECTS} objects: pick fewer` };
  for (const entity of entities) {
    const c = classify(entity);
    if (c.reason) skipped.push({ entity, reason: c.reason }); else items.push({ entity, ...c });
  }
  if (items.length < 2) return { result: null, skipped, why: skipped[0]?.reason ?? 'pick two or more objects to join' };
  const { S, notes } = bridge(items.map((i) => i.path.segs), { extend: ends !== 'straight', close: false }), sh = polyOf(S, false);
  sh.pts[sh.pts.length - 1] = sh.pts[sh.pts.length - 1].slice(0, 2);       // an open polyline's last vertex has no bulge
  return { result: rebuilt(sh, items[0].entity), skipped, note: [...notes].join('. ') };
}

export function closeEntities(entities, { ends = 'extend' } = {}) {
  const skipped = [], items = [];
  if (entities.length > MAX_OBJECTS) return { result: null, skipped, why: `more than ${MAX_OBJECTS} objects: pick fewer` };
  let done = 0;
  for (const entity of entities) {
    const c = classify(entity);
    if (!c.reason) items.push({ entity, ...c });
    else { const was = c.reason.startsWith('closed'); done += was; skipped.push({ entity, reason: was ? ALREADY : c.reason.replace('joined', 'closed') }); }
  }
  if (!items.length) return { result: null, skipped, why: done ? ALREADY : skipped[0]?.reason ?? 'nothing selected' };
  const { S, notes } = bridge(items.map((i) => i.path.segs), { extend: ends !== 'straight', close: true });
  if (S.length === 1 && !S[0].bulge) return { result: null, skipped, why: ONE_LINE };
  const sh = polyOf(S, true), n = sh.pts.length;
  const area = sh.pts.reduce((s, p, k) => s + p[0] * sh.pts[(k + 1) % n][1] - sh.pts[(k + 1) % n][0] * p[1], 0) / 2, perim = S.reduce((s, g) => s + dist(g.a, g.b), 0);
  if (S.every((g) => !g.bulge) && Math.abs(area) <= 1e-9 * perim * perim) return { result: null, skipped, why: FLAT };
  return { result: rebuilt(sh, items[0].entity), skipped, note: [...notes].join('. ') };
}
