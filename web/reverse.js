// Reverse (AutoCAD REVERSE): a line, polyline or spline runs the other way; the shape stays where it is. Pure: reverse.test.mjs.
//
//   reverse(entity) → the new entity, or null when it is not reversible (arcs, circles, ellipses and everything else; a 3-D / curve-fit polyline or a mesh).
import { at, get, num, lwVertices } from './grips.js';
import { splineOf, spReverse, spRecord } from './extend.js';

const txt = (n) => String(+Number(n).toPrecision(15));
const swap = (a, i, j) => { [a[i], a[j]] = [a[j], a[i]]; };

/** Per vertex (the segment from it to the next): bulge and start / end width of the reversed polyline. The last open vertex has no segment: zeros. */
function flipped(vs, closed) {
  const n = vs.length;
  return vs.map((_, j) => {
    const k = closed ? (n - 2 - j + n) % n : n - 2 - j, s = k >= 0 ? vs[k] : null;
    return s ? { b: -s.b, ws: s.we, we: s.ws } : { b: 0, ws: 0, we: 0 };
  });
}

function lwpolyline(ent) {
  const r = ent.r, vs = lwVertices(r), closed = ((get(r, 70) ?? 0) & 1) === 1;
  if (vs.length < 2) return null;
  const first = vs[0].kx, rest = flipped(vs.map((v) => ({ b: v.b, ws: v.ws ?? 0, we: v.we ?? 0 })), closed), widths = vs.some((v) => v.ws !== undefined || v.we !== undefined);
  let last = first;                                                       // the vertices' span: from the first vertex to the last code that belongs to one (10 20 40 41 42 91)
  r.c.forEach((c, k) => { if (k >= first && [10, 20, 40, 41, 42, 91].includes(c)) last = k; });
  const c = r.c.slice(0, first), v = r.v.slice(0, first);
  for (let j = 0; j < vs.length; j++) {
    const o = vs[vs.length - 1 - j], t = rest[j], put = (code, val) => { c.push(code); v.push(val); };
    put(10, r.v[o.kx]); put(20, r.v[o.ky]);
    if (widths) { put(40, txt(t.ws)); put(41, txt(t.we)); }
    if (t.b) put(42, txt(t.b));
  }
  return { ...ent, r: { ...r, c: [...c, ...r.c.slice(last + 1)], v: [...v, ...r.v.slice(last + 1)] } };
}

/** The code's value in a VERTEX record, set (added after the codes before it when missing and not zero). */
function setCode(kid, code, val) {
  const c = kid.c.slice(), v = kid.v.slice(), k = c.indexOf(code);
  if (k >= 0) v[k] = txt(val);
  else if (val) { let p = 0; c.forEach((x, i) => { if ([10, 20, 30, 40, 41, 42].includes(x) && x < code) p = i + 1; }); c.splice(p, 0, code); v.splice(p, 0, txt(val)); }
  return { ...kid, c, v };
}

function polyline(ent) {
  const r = ent.r, flags = get(r, 70) ?? 0, kids = ent.kids || [], closed = (flags & 1) === 1;
  if (flags & 94 || kids.length < 2 || kids.some((k) => k.type !== 'VERTEX' || (get(k, 70) ?? 0) & 16)) return null;       // shortcut: 3-D, curve-fit, spline-fit polylines and meshes are filtered out; upgrade when someone needs them
  const rest = flipped(kids.map((k) => ({ b: get(k, 42) ?? 0, ws: get(k, 40) ?? 0, we: get(k, 41) ?? 0 })), closed);
  const out = kids.slice().reverse().map((k, j) => setCode(setCode(setCode(k, 42, rest[j].b), 40, rest[j].ws), 41, rest[j].we));
  const rc = r.c.slice(), rv = r.v.slice(), a = rc.indexOf(40), b = rc.indexOf(41);
  if (a >= 0 && b >= 0) swap(rv, a, b);                                    // the default start / end widths swap too
  return { ...ent, r: { ...r, c: rc, v: rv }, kids: out };
}

function spline(ent) {
  const sp = splineOf(ent.r);
  if (!sp.P.length && !sp.F.length) return null;
  const e = spRecord(ent, spReverse(sp)), c = e.r.c.map((code) => ([12, 22, 32, 13, 23, 33].includes(code) ? code + (code % 10 === 2 ? 1 : -1) : code));       // start and end tangents swap and turn round
  const v = e.r.v.map((x, k) => ([12, 22, 32, 13, 23, 33].includes(e.r.c[k]) ? txt(-num(x)) : x));
  return { ...e, r: { ...e.r, c, v } };
}

export function reverse(ent) {
  if (!ent?.r) return null;
  if (ent.type === 'LINE') {
    const v = ent.r.v.slice(), p = [[10, 11], [20, 21], [30, 31]].map(([a, b]) => [at(ent.r, a), at(ent.r, b)]);
    if (p.slice(0, 2).some(([a, b]) => a < 0 || b < 0)) return null;
    for (const [a, b] of p) if (a >= 0 && b >= 0) swap(v, a, b);
    return { ...ent, r: { ...ent.r, v } };
  }
  return ent.type === 'LWPOLYLINE' ? lwpolyline(ent) : ent.type === 'POLYLINE' ? polyline(ent) : ent.type === 'SPLINE' ? spline(ent) : null;
}
