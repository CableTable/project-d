// Exact vertex matches, inferred only for edits that keep the shape: grip drag, Move and Scale.
import { flatten, pickIndex, mapply } from './drawing.js';
import { dimOfEntity, buildDim, replaceDimension, DIM_LAYER } from './edit.js';

function vertices(raw, entities) {
  const fl = flatten({ ...raw, entities }), byEnt = new Map();
  for (const p of [...pickIndex(fl, false).snaps, ...pickIndex(fl, true).snaps]) {
    if (p.kind !== 'end' && p.kind !== 'node') continue;
    const e = fl.items[p.it].e;
    if (!byEnt.has(e)) byEnt.set(e, []);
    byEnt.get(e).push([p.x, p.y]);
  }
  return byEnt;
}

const near = (a, b, factor) => Math.hypot(a[0] - b[0], a[1] - b[1]) * factor <= 1e-9;
function dimMatrix(raw, e) {
  const fl = flatten({ ...raw, entities: [{ ...raw.entities[e], hidden: false }] });
  return fl.items.length ? fl.mats[fl.items[0].m] : null;
}
function local(m, p) {
  const x = p[0] - m[4], y = p[1] - m[5], det = m[0] * m[3] - m[1] * m[2];
  return [(m[3] * x - m[2] * y) / det, (m[0] * y - m[1] * x) / det];
}

/** Rebuild linked aligned / linear dimensions in the same state as a shape edit. Never call for replacement or deletion. */
export function followDimensions(raw, next, factor = 1) {
  const dims = raw.entities.map((_, i) => [i, dimOfEntity(raw, i)])
    .filter(([, d]) => d && (d.kind === 'aligned' || d.kind === 'linear'));
  if (!dims.length) return next;
  const shapes = raw.entities.map((_, i) => i).filter((i) => {
    const e = raw.entities[i];
    return e.layer !== DIM_LAYER && e.type !== 'DIMENSION' &&
      !(e.type === 'INSERT' && /^PD_(DIM|LDR)_/.test(e.r.v[e.r.c.indexOf(2)]));
  });
  const changed = shapes.filter((i) => raw.entities[i] !== next.entities[i]);
  if (!changed.length) return next;
  const before = vertices(raw, changed.map((i) => raw.entities[i])), afterRaw = { ...raw, ...next };
  const after = vertices(afterRaw, changed.map((i) => next.entities[i])), moves = [];
  for (const [e, points] of before) {
    const to = after.get(e);
    if (!to || to.length !== points.length) continue;
    points.forEach((p, i) => { if (!near(p, to[i], factor)) moves.push([p, to[i], !!raw.entities[changed[e]].ps]); });
  }
  if (!moves.length) return next;
  const unchanged = shapes.filter((i) => raw.entities[i] === next.entities[i]).map((i) => raw.entities[i]);
  const stationary = [...vertices(raw, unchanged)].flatMap(([e, points]) => points.map((p) => [p, !!unchanged[e].ps]));
  let result = next;
  for (const [e, dim] of dims) {
    const m = dimMatrix(raw, e), nextMatrix = dimMatrix(afterRaw, e), current = dimOfEntity(afterRaw, e), params = { ...current.params };
    if (!m || !nextMatrix) continue;
    let moved = false;
    const paper = !!raw.entities[e].ps, end = {};
    for (const key of ['a', 'b']) {
      const p = mapply(m, ...dim.params[key]);
      end[key] = {
        shared: stationary.some(([q, ps]) => ps === paper && near(q, p, factor)),
        match: moves.find(([from, , ps]) => ps === paper && near(from, p, factor)),
      };
    }
    for (const [key, other] of [['a', 'b'], ['b', 'a']]) {
      const { shared, match } = end[key];
      // A point a moved and a stayed shape share goes with the shape holding the other end; if that is unclear, it stays.
      if (match && (!shared || (end[other].match && !end[other].shared))) { params[key] = local(nextMatrix, match[1]); moved = true; }
    }
    if (!moved) continue;
    const built = buildDim(dim.kind, params, factor, dim.name, dim.dp);
    if (built) result = { ...result, ...replaceDimension(result, built) };
  }
  return result;
}
