// A fill is part of its closed outline (TODO 148c, DECISIONS "Fill belongs to its outline"): the entity carries `fill` (a colour key),
// drawing.js paints it behind the outline, dxf-write.js writes it as a solid HATCH right before the outline, and readDxf links a solid
// HATCH back to the outline it matches. Pure: no DOM; fill.test.mjs.
import { ACI, keyRgb, pack420 } from './colour.js';
import { flatten, hatchOps, polyOps, arcSweep, opsBox } from './drawing.js';
import { withColour, effectiveColour } from './props.js';

const TAU = Math.PI * 2;
const val = (r, code, d = 0) => { const k = r.c.indexOf(code); return k < 0 ? d : Number(r.v[k]) || 0; };

/** The vertices [x, y, bulge] of a LWPOLYLINE or POLYLINE. */
function polyPts(e) {
  const r = e.r;
  if (e.type === 'LWPOLYLINE') {
    const pts = [];
    r.c.forEach((c, k) => {
      if (c === 10) pts.push([Number(r.v[k]) || 0, 0, 0]);
      else if (pts.length && c === 20) pts.at(-1)[1] = Number(r.v[k]) || 0;
      else if (pts.length && c === 42) pts.at(-1)[2] = Number(r.v[k]) || 0;
    });
    return pts;
  }
  const flags = val(r, 70);
  return (e.kids || []).filter((k) => !(val(k, 70) & 16)).map((k) => [val(k, 10), val(k, 20), flags & 8 ? 0 : val(k, 42)]);
}

/** Is it one closed shape a fill can sit in: a closed polyline, circle, full ellipse or closed spline? */
export function closedOutline(e) {
  if (!e?.r) return false;
  const r = e.r;
  switch (e.type) {
    case 'CIRCLE': return val(r, 40) > 0;
    case 'LWPOLYLINE': return (val(r, 70) & 1) === 1 && polyPts(e).length >= 3;
    case 'POLYLINE': return (val(r, 70) & (1 | 16 | 64)) === 1 && polyPts(e).length >= 3;
    case 'ELLIPSE': { const t0 = val(r, 41), t1 = val(r, 42, TAU); return (t1 <= t0 ? t1 + TAU : t1) - t0 >= TAU - 1e-6; }
    case 'SPLINE': return (val(r, 70) & 1) === 1;
    default: return false;
  }
}

/** The outline's drawing ops (drawing.js), one closed path; null when it has none. */
export function outlineOps(e) {
  const r = e.r;
  if (e.type === 'CIRCLE') { const cx = val(r, 10), cy = val(r, 20), rad = val(r, 40); return [0, cx + rad, cy, 2, cx, cy, rad, 0, TAU, 0, 9]; }
  if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') { const ops = []; polyOps(ops, polyPts(e), true); return ops; }
  const mini = flatten({ header: {}, layers: {}, ltypes: {}, blocks: {}, styles: {}, entities: [{ ...e, fill: undefined, hidden: false }] });
  return mini.items.find((it) => it.k === 'p')?.ops || null;
}

/** Ops into a polygon [[x, y], …], arcs sampled finely. */
export function opsPoly(ops) {
  const pts = [];
  for (let i = 0; i < ops.length;) {
    if (ops[i] === 2) {
      const [s, sw] = arcSweep(ops[i + 4], ops[i + 5], ops[i + 6]), n = Math.max(4, Math.ceil(256 * sw / TAU));
      for (let j = 0; j <= n; j++) { const t = s + sw * (ops[i + 6] ? n - j : j) / n; pts.push([ops[i + 1] + ops[i + 3] * Math.cos(t), ops[i + 2] + ops[i + 3] * Math.sin(t)]); }
      i += 7;
    } else if (ops[i] === 9) i++;
    else { pts.push([ops[i + 1], ops[i + 2]]); i += 3; }
  }
  return pts;
}

export const boundary = (e) => { const ops = outlineOps(e); return ops ? opsPoly(ops) : []; };

const box = (p) => p.reduce((b, q) => [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[0]), Math.max(b[3], q[1])], [Infinity, Infinity, -Infinity, -Infinity]);
export function edgeDist(p, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return best;
}

/** Do two polygons trace the same outline, whatever the start, direction or number of vertices? */
export function boundariesMatch(a, b) {
  if (a.length < 3 || b.length < 3) return false;
  const A = box(a), B = box(b), tol = 2e-3 * Math.hypot(A[2] - A[0], A[3] - A[1]) + 1e-9;
  return A.every((v, i) => Math.abs(v - B[i]) <= tol) && a.every((p) => edgeDist(p, b) <= tol) && b.every((p) => edgeDist(p, a) <= tol);
}

/** Is `p` inside the polygon (even-odd)? */
export function containsPoint(poly, p) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
function edgesMeet(a, b, c, d) {
  if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
      Math.max(a[1], b[1]) < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) < Math.min(a[1], b[1])) return false;
  return cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0;
}

function fullyInside(outer, inner) {
  if (!inner.every((p) => containsPoint(outer, p))) return false;
  // Vertices alone miss a straight edge crossing a concave outline's notch.
  for (let i = 0; i < inner.length; i++) for (let j = 0; j < outer.length; j++) {
    if (edgesMeet(inner[i], inner[(i + 1) % inner.length], outer[j], outer[(j + 1) % outer.length])) return false;
  }
  return true;
}

/** Live islands, computed once per flatten/save, never on pan or zoom. All nested loops take part in even-odd filling. */
export function fillHoles(entities, hidden = new Set()) {
  const result = new Map(), groups = new Map();
  if (!entities.some((e) => e.fill && closedOutline(e))) return result;
  for (const e of entities) {
    if (e.hidden || hidden.has(e) || !closedOutline(e)) continue;
    const ops = outlineOps(e), b = ops && opsBox(ops);
    if (!b) continue;
    if (e.flip) [b[0], b[2]] = [-b[2], -b[0]];
    const key = JSON.stringify([e.layer, !!e.ps]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ e, ops, b, poly: null });
  }
  const polygon = (s) => s.poly ||= opsPoly(s.ops).map(([x, y]) => [s.e.flip ? -x : x, y]);
  for (const shapes of groups.values()) {
    shapes.sort((a, b) => a.b[0] - b.b[0]);
    for (const outer of shapes) {
      if (!outer.e.fill) continue;
      const holes = [], A = outer.b;
      let lo = 0, hi = shapes.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (shapes[mid].b[0] < A[0]) lo = mid + 1; else hi = mid; }
      for (let i = lo; i < shapes.length && shapes[i].b[0] <= A[2]; i++) {
        const inner = shapes[i], B = inner.b;
        if (inner === outer || B[1] < A[1] || B[2] > A[2] || B[3] > A[3]) continue;
        if (fullyInside(polygon(outer), polygon(inner))) holes.push(inner.e);
      }
      result.set(outer.e, holes);
    }
  }
  return result;
}

/** HATCH polyline loops, in the outer outline's OCS; circles retain exact semicircle bulges. */
export function fillLoops(e, holes = []) {
  return [e, ...holes].map((shape) => {
    const r = shape.r;
    const pts = shape.type === 'CIRCLE' ? [[val(r, 10) - val(r, 40), val(r, 20), 1], [val(r, 10) + val(r, 40), val(r, 20), 1]]
      : shape.type === 'LWPOLYLINE' || shape.type === 'POLYLINE' ? polyPts(shape) : boundary(shape).map((p) => [p[0], p[1], 0]);
    return !!shape.flip === !!e.flip ? pts : pts.map(([x, y, bulge]) => [-x, y, -bulge]);
  });
}

export function fillOps(e, holes = []) {
  const ops = outlineOps(e);
  if (ops && holes.length) for (const pts of fillLoops(e, holes).slice(1)) polyOps(ops, pts, true);
  return ops;
}

/** Hit an even-odd fill path, including its holes and nested islands. */
export function containsFill(ops, p) {
  let inside = false, start = 0;
  for (let i = 0; i <= ops.length;) {
    if (i === ops.length || (i > start && ops[i] === 0)) {
      if (containsPoint(opsPoly(ops.slice(start, i)), p)) inside = !inside;
      start = i;
    }
    if (i === ops.length) break;
    i += ops[i] === 2 ? 7 : ops[i] === 9 ? 1 : 3;
  }
  return inside;
}

/** The css colour of a fill key (a by-layer fill takes the layer's colour, by-block the INSERT's). */
export function fillCss(key, layerCss, blockCss) {
  if (key?.startsWith('tc:')) return '#' + (Number(key.slice(3)) & 0xffffff).toString(16).padStart(6, '0');
  if (key?.startsWith('aci:')) return ACI[Number(key.slice(4))] || layerCss;
  return key === 'byblock' ? blockCss || layerCss : layerCss;
}

/** The solid HATCH that saves `e`'s fill (written right before the outline); null when it has none. */
export function fillHatch(e, holes = []) {
  if (!e.fill || !closedOutline(e)) return null;
  const r = e.r;
  const loops = fillLoops(e, holes), key = e.fill;
  const index = key.startsWith('aci:') ? Number(key.slice(4)) : key === 'byblock' ? 0 : key === 'bylayer' ? 256 : null;     // a palette fill is written as 62 only, so it reopens as the same key; true colour as 420
  const colour = index != null ? { aci: index, tc: null } : { aci: 256, tc: pack420(keyRgb(key)) };
  const pairs = [[8, e.layer], [10, 0], [20, 0], [30, 0], [210, val(r, 210)], [220, val(r, 220)], [230, val(r, 230, 1)], [2, 'SOLID'], [70, 1], [71, 0], [91, loops.length],
    ...loops.flatMap((pts, i) => {
      const bulge = pts.some((p) => p[2]);
      return [[92, i === 0 ? 3 : 2], [72, bulge ? 1 : 0], [73, 1], [93, pts.length],
        ...pts.flatMap((p) => [[10, p[0]], [20, p[1]], ...(bulge ? [[42, p[2]]] : [])]), [97, 0]];
    }), [75, 0], [76, 1], [98, 0]];
  return { type: 'HATCH', layer: e.layer, lt: null, ...colour, lw: -1, lts: 1, hidden: !!e.hidden, ps: !!e.ps, flip: !!e.flip,
    r: { type: 'HATCH', c: pairs.map((x) => x[0]), v: pairs.map((x) => String(x[1])) }, kids: undefined };
}

/** A solid HATCH's first (outer) loop, no gradient; leave malformed loop counts alone. */
function solidLoop(h) {
  if (h.type !== 'HATCH' || val(h.r, 70) !== 1 || val(h.r, 91) < 1 || val(h.r, 450) === 1) return null;
  const { c, v } = h.r, starts = c.flatMap((code, i) => code === 92 ? [i] : []);
  if (starts.length !== val(h.r, 91)) return null;
  const end = starts[1] ?? c.length, r = { ...h.r, c: c.slice(0, end), v: v.slice(0, end) };
  r.v[c.indexOf(91)] = '1';
  const ops = hatchOps({ ...h, r });
  return ops && opsPoly(ops);
}
const hatchKey = (h) => h.tc != null ? 'tc:' + h.tc : h.aci >= 1 && h.aci <= 255 ? 'aci:' + h.aci : h.aci === 0 ? 'byblock' : 'bylayer';

/**
 * A visible solid HATCH that sits right before a closed outline on the same layer and in the same space (as dxf-write.js saves a fill)
 * and matches its boundary becomes that outline's fill (the HATCH is dropped); any other HATCH stays. Changes `doc` in place.
 */
export function linkFills(doc) {
  for (const list of [doc, ...Object.values(doc.blocks || {})]) {
    const ents = list.entities;
    if (!ents?.some((e) => e.type === 'HATCH')) continue;
    const gone = new Set();
    ents.forEach((h, i) => {
      const o = ents[i + 1], poly = o && !o.fill && !h.hidden && h.layer === o.layer && !!h.ps === !!o.ps && closedOutline(o) && solidLoop(h);
      if (poly && boundariesMatch(poly, boundary(o))) { o.fill = hatchKey(h); gone.add(h); }
    });
    if (gone.size) list.entities = ents.filter((e) => !gone.has(e));
  }
  return doc;
}

export const coloursEqual = (a, b) => a.tc === b.tc && a.aci === b.aci && (a.fill || null) === (b.fill || null);

/** `dst` with the Eyedropper's colours from `src`: its effective line colour and its fill (no fill copies "no fill"); nothing else. */
export function copyColours(src, dst, layers) {
  const next = withColour(dst, effectiveColour(src, layers));
  return closedOutline(dst) ? { ...next, fill: src.fill || null } : next;
}
