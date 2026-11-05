// LENGTHEN works in drawing units; records and unrelated polyline segments stay intact.
import { shapeOf, get, at, withValues, lengthen } from './grips.js';
import { pathOf, geo } from './modify.js';

const EPS = 1e-9, TAU = 2 * Math.PI;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const wrap = (a) => (a % TAU + TAU) % TAU;
export const CANNOT_LENGTHEN = 'Cannot LENGTHEN this object.';
export const ZERO_LENGTH = 'Results in zero length geometry.';

/** Length and included angle for measuring, plus the finite path used by the command. */
export function lengthenInfo(ent) {
  if (!ent?.r || !['LINE', 'ARC', 'LWPOLYLINE'].includes(ent.type) ||
      ent.type !== 'LINE' && (Math.abs(get(ent.r, 210) ?? 0) > EPS || Math.abs(get(ent.r, 220) ?? 0) > EPS ||
      ent.type === 'LWPOLYLINE' && ((get(ent.r, 70) ?? 0) & 1))) return null;
  const shape = shapeOf(ent), path = pathOf(shape);
  if (path.closed || !path.segs.length) return null;
  const lengths = path.segs.map((s) => { const g = geo(s); return g.line ? g.len : Math.abs(g.sw) * g.r; });
  if (lengths.some((n) => !Number.isFinite(n)) || lengths[0] <= EPS || lengths.at(-1) <= EPS) return null;       // only an end segment is measured: an interior duplicate vertex is harmless
  return { path, lengths, length: lengths.reduce((a, b) => a + b, 0), angle: ent.type === 'ARC' ? wrap((shape.a1 - shape.a0) * Math.PI / 180) * 180 / Math.PI : null };
}

/** The new entity (the original when unchanged), or the refusal text. */
function attempt(ent, pick, mode, value) {
  const info = lengthenInfo(ent);
  if (!info || !Array.isArray(pick) || pick.length < 2 || !pick.slice(0, 2).every(Number.isFinite)) return CANNOT_LENGTHEN;
  const flip = ent.type !== 'LINE' && (get(ent.r, 230) ?? 1) < 0;
  const local = (p) => flip ? [-p[0], p[1]] : p;
  pick = local(pick);
  const { segs } = info.path, start = distance(pick, segs[0].a) <= distance(pick, segs.at(-1).b);
  const j = start ? 0 : segs.length - 1, seg = segs[j], g = geo(seg), old = info.lengths[j];
  let now;
  if (mode === 'Dynamic') {
    if (!Array.isArray(value) || value.length < 2 || !value.slice(0, 2).every(Number.isFinite)) return CANNOT_LENGTHEN;
    const p = local(value), fixed = start ? seg.b : seg.a;
    if (g.line) now = (p[0] - fixed[0]) * g.u[0] * (start ? -1 : 1) + (p[1] - fixed[1]) * g.u[1] * (start ? -1 : 1);
    else {
      const angle = Math.atan2(p[1] - g.c[1], p[0] - g.c[0]);
      now = wrap((start ? g.a0 + g.sw - angle : angle - g.a0) * Math.sign(g.sw)) * g.r;
    }
  } else {
    if (!Number.isFinite(value)) return CANNOT_LENGTHEN;
    if (mode === 'DeltaAngle' || mode === 'TotalAngle') {
      if (g.line) return CANNOT_LENGTHEN;
      now = (mode === 'DeltaAngle' ? old : 0) + value * Math.PI / 180 * g.r;
    } else now = old + (mode === 'Delta' ? value : mode === 'Percent' ? info.length * (value / 100 - 1) : mode === 'Total' ? value - info.length : NaN);
  }
  if (!(now > EPS) || !Number.isFinite(now)) return ZERO_LENGTH;
  if (!g.line && now / g.r >= TAU - EPS) return CANNOT_LENGTHEN;       // AutoCAD has no text for a full turn (acad-97ef.txt): same refusal as any object it cannot change
  if (Math.abs(now - old) < 1e-12) return ent;
  if (ent.type !== 'LWPOLYLINE') {
    // Grip math uses OCS coordinates; only its upright check needs a positive normal.
    const normal = at(ent.r, 230), source = (get(ent.r, 230) ?? 1) < 0 ? withValues(ent, [[normal, 1]]) : ent;
    const deg = (start ? g.a0 + g.sw - now / g.r : g.a0 + now / g.r) * 180 / Math.PI;
    const result = lengthen(source, start ? 'a' : 'b', g.line ? { add: now - old } : { deg: start ? -deg : deg })?.ent;
    return result && normal >= 0 ? withValues(result, [[normal, get(ent.r, 230)]]) : result || CANNOT_LENGTHEN;
  }
  const fixed = start ? seg.b : seg.a;
  const angle = g.line ? 0 : start ? g.a0 + g.sw - Math.sign(g.sw) * now / g.r : g.a0 + Math.sign(g.sw) * now / g.r;
  const p = g.line ? [fixed[0] + g.u[0] * now * (start ? -1 : 1), fixed[1] + g.u[1] * now * (start ? -1 : 1)]
    : [g.c[0] + g.r * Math.cos(angle), g.c[1] + g.r * Math.sin(angle)];
  const vertex = start ? 0 : segs.length, edits = [[at(ent.r, 10, vertex), p[0]], [at(ent.r, 20, vertex), p[1]]];
  const out = withValues(ent, edits);
  if (!g.line) {
    const first = at(out.r, 10, j), next = at(out.r, 10, j + 1), bulge = out.r.c.indexOf(42, first);
    const b = Math.tan(Math.sign(g.sw) * now / g.r / 4);
    if (bulge >= first && bulge < next) return withValues(out, [[bulge, b]]);
    return CANNOT_LENGTHEN;
  }
  return out;
}

/** Null on refusal (lengthenWhy says why); an unchanged valid value returns the original entity. */
export const lengthenEntity = (...a) => { const r = attempt(...a); return typeof r === 'string' ? null : r; };
/** The refusal text for the same arguments: zero length only when the result really is zero. */
export const lengthenWhy = (...a) => { const r = attempt(...a); return typeof r === 'string' ? r : CANNOT_LENGTHEN; };
