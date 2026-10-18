// track.js — polar tracking and object-snap tracking, pure (no DOM): track.test.mjs.
//
// Everything works in one uniform unit (the app gives drawing units); the pixel tolerance is passed in as `tol` in that unit.
//
//   toggleAcquired(list, pt, eps)  → the acquired points after hovering on `pt`: it is added (at most MAX_ACQUIRED, the oldest drops)
//                                    or, when it is already there, released
//   resolve({ p, base, inc, acq, tol, step, scale }) → where the pick lands, or null when nothing locks:
//        { q: [x, y], lines: [{ x, y, h, name, ang }] (tracking lines in use), ray: { a, base } | null (the polar angle in use), cross, text }
//     p the pointer, base the point the rubber band starts from (null: no polar), inc the polar step in degrees (0: polar off),
//     acq the acquired points [{ x, y, kind }], step the grid a length / coordinate lands on, scale the unit → mm for the readout.
//     Priority: a tracking / polar intersection near the pointer, then the single line or ray nearest to it, else null.
//     (An object snap under the pointer wins over all of this: the app does not ask then.)

export const INCREMENTS = [90, 45, 30, 22.5, 15, 10, 5];
export const MAX_ACQUIRED = 7;
export const KIND_NAMES = { end: 'Endpoint', mid: 'Midpoint', centre: 'Centre', node: 'Point' };
const DEG = Math.PI / 180;

/** Can a snap of this kind be acquired? ("near", a point on a line, cannot.) */
export const acquirable = (kind) => Object.hasOwn(KIND_NAMES, kind);

export function toggleAcquired(list, pt, eps) {
  const i = list.findIndex((a) => Math.hypot(a.x - pt.x, a.y - pt.y) <= eps);
  if (i >= 0) return list.filter((_, j) => j !== i);
  return [...list, { x: pt.x, y: pt.y, kind: pt.kind }].slice(-MAX_ACQUIRED);
}

const grid = (v, step) => (step > 0 ? Math.round(v / step) * step : v);
const num = (v) => String(+v.toFixed(2));                    // 30 → "30", 22.5 → "22.5"

export function resolve({ p, base, inc, acq, tol, step, scale = 1 }) {
  const rays = [];
  if (base && inc > 0) for (let k = 0; k * inc < 360 - 1e-9; k++) rays.push({ a: k * inc, u: [Math.cos(k * inc * DEG), Math.sin(k * inc * DEG)] });
  const lines = [];
  for (const [i, pt] of acq.entries()) for (const h of [true, false]) lines.push({ i, x: pt.x, y: pt.y, h, name: KIND_NAMES[pt.kind] || 'Point', ang: h ? 0 : 90 });
  let best = null, bd = tol;                                   // the nearest intersection to the pointer
  const meet = (q, used, ray) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d <= bd) { bd = d; best = { q, lines: used, ray, cross: true }; } };
  for (const A of lines.filter((l) => l.h)) for (const B of lines.filter((l) => !l.h)) if (A.i !== B.i) meet([B.x, A.y], [B, A].sort((a, b) => a.ang - b.ang), null);
  for (const r of rays) for (const L of lines) {
    const t = L.h ? (L.y - base[1]) / r.u[1] : (L.x - base[0]) / r.u[0];
    if (Number.isFinite(t) && Math.abs(L.h ? r.u[1] : r.u[0]) > 1e-9 && t > 1e-9) meet([base[0] + r.u[0] * t, base[1] + r.u[1] * t], [L], { a: r.a, base });
  }
  if (!best) {                                                 // else the single line or ray the pointer is nearest to
    bd = tol;
    for (const L of lines) {
      const d = Math.abs(L.h ? p[1] - L.y : p[0] - L.x);
      if (d <= bd) { bd = d; best = { q: L.h ? [grid(p[0], step), L.y] : [L.x, grid(p[1], step)], lines: [L], ray: null, cross: false }; }
    }
    for (const r of rays) {
      const dx = p[0] - base[0], dy = p[1] - base[1], along = dx * r.u[0] + dy * r.u[1], perp = Math.abs(dx * r.u[1] - dy * r.u[0]);
      if (along > tol && perp <= bd) { const len = grid(along, step); bd = perp; best = { q: [base[0] + r.u[0] * len, base[1] + r.u[1] * len], lines: [], ray: { a: r.a, base }, cross: false, len }; }
    }
  }
  if (!best) return null;
  const parts = best.lines.map((l) => `${l.name}: ${num(l.ang)}°`);
  if (best.ray) parts.push(best.lines.length ? `Polar: ${num(best.ray.a)}°` : `Polar: ${(best.len * scale).toFixed(2)} < ${num(best.ray.a)}°`);
  best.text = parts.join(' · ');
  return best;
}
