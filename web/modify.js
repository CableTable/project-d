// modify.js — Offset, Trim and Mirror of drawn entities, pure (no DOM, no files): modify.test.mjs.
//
// Everything works on the entity record (dxf-write.js shape) in the drawing's own units, y up, through the shapes grips.js shapeOf gives
// ({ t: 'line' | 'arc' | 'circle' | 'poly' }); a result is an entity with the source's layer, colour and line type.
//
//   canModify(ent)                     → can Offset / Trim take this entity? (LINE, ARC, CIRCLE, LWPOLYLINE in the plane)
//   offsetEntity(ent, d, at)           → { ent } | { error }   the copy d away on the side of the point `at`; a polyline is joined with mitres
//   trimEntity(ent, edges, pick)       → { ents, removed } | { error }  the kept pieces and the piece under `pick` that goes
//   mirrorEntity(ent, p1, p2, blocks)  → { ent, blocks? } | { skip }    reflection; dimensions and leaders return private blocks
//   mirrorShape(sh, p1, p2) / offsetShape(sh, d, at) / trimShape(sh, edgeShapes, pick) are the same on shapes.
import { shapeOf, hasGrips, num, at as atCode, get, withValues } from './grips.js';
import { toEntity } from './draw.js';
import { LDR_BLOCK } from './edit.js';
import * as L from './leader.js';
import { insert } from './dxf-write.js';

const TAU = Math.PI * 2, DEG = 180 / Math.PI;
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const norm360 = (t) => { t %= 360; if (t < 0) t += 360; return t >= 360 - 1e-9 ? 0 : t; };
const mod2pi = (t) => { t %= TAU; return t < 0 ? t + TAU : t; };

// ---------------------------------------------------------------- paths: a shape as segments { a, b, bulge } (the polyline way)

/** The path of a shape: { type, closed, segs: [{ a, b, bulge }] }. Polyline points retain start/end widths in slots 3/4. */
export function pathOf(sh) {
  if (sh.t === 'line') return { type: 'line', closed: false, segs: [{ a: sh.a, b: sh.b, bulge: 0 }] };
  if (sh.t === 'arc') {
    if (!norm360(sh.a1 - sh.a0)) return pathOf({ t: 'circle', c: sh.c, r: sh.r });   // no sweep = all the way round
    const sw = (norm360(sh.a1 - sh.a0) || 360) / DEG, P = (t) => [sh.c[0] + sh.r * Math.cos(t / DEG), sh.c[1] + sh.r * Math.sin(t / DEG)];
    return { type: 'arc', closed: false, segs: [{ a: P(sh.a0), b: P(sh.a0 + sw * DEG), bulge: Math.tan(sw / 4) }] };
  }
  if (sh.t === 'circle') {
    const l = [sh.c[0] - sh.r, sh.c[1]], r = [sh.c[0] + sh.r, sh.c[1]];
    return { type: 'circle', closed: true, segs: [{ a: r, b: l, bulge: 1 }, { a: l, b: r, bulge: 1 }] };
  }
  const pts = sh.pts, n = pts.length, segs = [];
  for (let i = 0; i + 1 < n; i++) segs.push({ a: pts[i], b: pts[i + 1], bulge: pts[i][2] || 0 });
  if (sh.closed && n > 2) segs.push({ a: pts[n - 1], b: pts[0], bulge: pts[n - 1][2] || 0 });
  return { type: 'poly', closed: !!sh.closed && n > 2, segs };
}

/** The geometry of a segment: a line { line: true, a, b, len, u (unit direction) } or an arc { c, r, a0 (rad), sw (signed rad) }. */
export function geo(s) {
  if (!s.bulge || Math.abs(s.bulge) < 1e-12) {
    const len = dist(s.a, s.b);
    return { line: true, a: s.a, b: s.b, len, u: len ? [(s.b[0] - s.a[0]) / len, (s.b[1] - s.a[1]) / len] : [1, 0] };
  }
  const th = 4 * Math.atan(s.bulge), chord = dist(s.a, s.b), r = chord / (2 * Math.sin(Math.abs(th) / 2));
  const nx = -(s.b[1] - s.a[1]) / chord, ny = (s.b[0] - s.a[0]) / chord, h = r * Math.cos(Math.abs(th) / 2) * Math.sign(th);
  const c = [(s.a[0] + s.b[0]) / 2 + nx * h, (s.a[1] + s.b[1]) / 2 + ny * h];
  return { line: false, c, r, a0: Math.atan2(s.a[1] - c[1], s.a[0] - c[0]), sw: th };
}
const pointAt = (g, f) => (g.line ? [g.a[0] + (g.b[0] - g.a[0]) * f, g.a[1] + (g.b[1] - g.a[1]) * f] : [g.c[0] + g.r * Math.cos(g.a0 + g.sw * f), g.c[1] + g.r * Math.sin(g.a0 + g.sw * f)]);
/** The part of a segment from fraction f0 to f1 (of its length). */
export function subSeg(s, f0, f1) {
  if (f0 <= 1e-9 && f1 >= 1 - 1e-9) return s;
  const g = geo(s);
  let a = f0 <= 1e-9 ? s.a : pointAt(g, f0), b = f1 >= 1 - 1e-9 ? s.b : pointAt(g, f1);
  if (s.a.length > 3) {
    const w = (f) => s.a[3] + (s.a[4] - s.a[3]) * f;
    a = [a[0], a[1], 0, w(f0), w(f1)];
    if (f1 < 1 - 1e-9) b = [b[0], b[1], 0, w(f1), w(f1)];
  }
  return { a, b, bulge: g.line ? 0 : Math.tan(g.sw * (f1 - f0) / 4) };
}
/** Where on the arc g a point (on its circle) lies, as a fraction of the sweep, or null when it is off the arc. */
function arcFrac(g, p) {
  let d = mod2pi((Math.atan2(p[1] - g.c[1], p[0] - g.c[0]) - g.a0) * Math.sign(g.sw));
  if (d > TAU - 1e-9) d = 0;
  const f = d / Math.abs(g.sw);
  return f <= 1 + 1e-7 ? Math.min(1, f) : null;
}

/** The points where two segments cross: [{ fs, ft, p }] (fractions along each). */
export function segInter(s, t) {
  return geoInter(geo(s), geo(t));
}

function geoInter(gs, gt) {
  const s = gs, t = gt, out = [];
  const E = 1e-9;
  if (gs.line && gt.line) {
    const d1 = sub(s.b, s.a), d2 = sub(t.b, t.a), den = cross(d1, d2);
    if (Math.abs(den) < 1e-12 * (gs.len * gt.len || 1)) return out;
    const w = sub(t.a, s.a), u = cross(w, d2) / den, v = cross(w, d1) / den;
    if (u >= -E && u <= 1 + E && v >= -E && v <= 1 + E) out.push({ fs: Math.min(1, Math.max(0, u)), ft: Math.min(1, Math.max(0, v)), p: [s.a[0] + d1[0] * u, s.a[1] + d1[1] * u] });
    return out;
  }
  if (gs.line !== gt.line) {
    const swap = !gs.line, line = swap ? t : s, arc = swap ? gs : gt, d = sub(line.b, line.a);
    const w = sub(line.a, arc.c), A2 = dot(d, d), B = 2 * dot(d, w), C = dot(w, w) - arc.r * arc.r, disc = B * B - 4 * A2 * C;
    if (A2 < 1e-18 || disc < -1e-12 * (B * B + 1)) return out;
    const root = Math.sqrt(Math.max(0, disc));
    // Tangent roots split through cancellation; compare at the quadratic's scale.
    for (const f of (root <= 1e-7 * Math.max(Math.abs(B), 2 * Math.sqrt(A2) * arc.r) ? [-B / (2 * A2)] : [(-B - root) / (2 * A2), (-B + root) / (2 * A2)])) {
      if (f < -E || f > 1 + E) continue;
      const p = [line.a[0] + d[0] * f, line.a[1] + d[1] * f], fa = arcFrac(arc, p);
      if (fa == null) continue;
      const fl = Math.min(1, Math.max(0, f));
      out.push(swap ? { fs: fa, ft: fl, p } : { fs: fl, ft: fa, p });
    }
    return out;
  }
  const dd = dist(gs.c, gt.c);
  if (dd < 1e-9 || dd > gs.r + gt.r + 1e-9 || dd < Math.abs(gs.r - gt.r) - 1e-9) return out;
  const a = (gs.r * gs.r - gt.r * gt.r + dd * dd) / (2 * dd), h = Math.sqrt(Math.max(0, gs.r * gs.r - a * a));
  const ux = (gt.c[0] - gs.c[0]) / dd, uy = (gt.c[1] - gs.c[1]) / dd, mx = gs.c[0] + ux * a, my = gs.c[1] + uy * a;
  for (const sg of (h < 1e-9 ? [0] : [1, -1])) {
    const p = [mx - uy * h * sg, my + ux * h * sg], fs = arcFrac(gs, p), ft = arcFrac(gt, p);
    if (fs != null && ft != null) out.push({ fs, ft, p });
  }
  return out;
}

/** Exact finite intersections of drawing-index lines / arcs / circles; flattened curves have no exact solver. */
export function pieceInter(a, b) {
  if (a.curve || b.curve) return [];
  const geometry = (p) => p.t === 's' ? geo({ a: [p.x1, p.y1], b: [p.x2, p.y2] })
    : { line: false, c: [p.cx, p.cy], r: p.r, a0: p.s, sw: p.full ? TAU : p.sw };
  return geoInter(geometry(a), geometry(b)).map((hit) => hit.p);
}

// ---------------------------------------------------------------- Mirror

const reflect = (p, p1, p2) => {
  const u = sub(p2, p1), l2 = dot(u, u), w = sub(p, p1), k = 2 * dot(w, u) / l2;
  return [p1[0] + u[0] * k - w[0], p1[1] + u[1] * k - w[1]];
};
const reflectVec = (v, p1, p2) => { const u = sub(p2, p1), l2 = dot(u, u), k = 2 * dot(v, u) / l2; return [u[0] * k - v[0], u[1] * k - v[1]]; };

/** A shape reflected in the line p1 → p2 (null for a zero-length line). */
export function mirrorShape(sh, p1, p2) {
  if (dist(p1, p2) < 1e-12) return null;
  const R = (p) => reflect(p, p1, p2), th = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * DEG;
  if (sh.t === 'line') return { t: 'line', a: R(sh.a), b: R(sh.b) };
  if (sh.t === 'circle') return { t: 'circle', c: R(sh.c), r: sh.r };
  if (sh.t === 'arc') return { t: 'arc', c: R(sh.c), r: sh.r, a0: norm360(2 * th - sh.a1), a1: norm360(2 * th - sh.a0) };
  return { t: 'poly', closed: sh.closed, pts: sh.pts.map((p) => { const q = R(p); return p.length > 2 ? [q[0], q[1], -(p[2] || 0), ...p.slice(3)] : q; }) };
}

/** A shape made from `ent` as an entity again; a polyline keeps its widths (40/41/43) and elevation (38). */
export function rebuilt(sh, ent) {
  const w = ent.type === 'LWPOLYLINE' ? get(ent.r, 43) : null, z = ent.type === 'LWPOLYLINE' ? get(ent.r, 38) : null;
  const e = toEntity(sh, w ? { ...ent, width: w } : ent, 1);
  if (e.type === 'LWPOLYLINE') {
    const r = { ...e.r, c: [], v: [] };
    let i = 0;
    for (let k = 0; k < e.r.c.length; k++) {
      const code = e.r.c[k];
      r.c.push(code); r.v.push(e.r.v[k]);
      if (code === 20) {
        const p = sh.pts[i++];
        if (p.length > 3) { r.c.push(40, 41); r.v.push(String(p[3]), String(p[4])); }
      }
    }
    e.r = r;
  }
  if (z && e.type === 'LWPOLYLINE') { const k = e.r.c.indexOf(70) + 1; e.r.c.splice(k, 0, 38); e.r.v.splice(k, 0, String(z)); }
  return e;
}

const TEXTS = new Set(['TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF']);
const field = (r, code) => r.v[r.c.indexOf(code)];

/** Reflect record coordinates without changing pattern directions or text handedness. */
function mirrorRecord(ent, p1, p2, dimensionText = false, parent = [1, 0, 0, 1]) {
  const r = ent.r, c = r.c.slice(), v = r.v.slice(), type = ent.type;
  if (ent.flip && ['INSERT', 'HATCH', 'SOLID', 'TRACE', 'TEXT', 'ATTRIB', 'ATTDEF'].includes(type)) {
    p1 = [-p1[0], p1[1]]; p2 = [-p2[0], p2[1]];
  }
  const set = (code, value) => {
    const k = c.indexOf(code);
    if (k < 0) { c.push(code); v.push(String(value)); } else v[k] = String(value);
  };
  const pair = (k, vector = false, dy = 10) => {
    const code = r.c[k];
    let j = k + 1;
    while (j < r.c.length && r.c[j] !== code && r.c[j] !== code + dy) j++;
    const q = (vector ? reflectVec : reflect)([num(r.v[k]), r.c[j] === code + dy ? num(r.v[j]) : 0], p1, p2);
    v[k] = String(q[0]);
    if (r.c[j] === code + dy) v[j] = String(q[1]); else { c.push(code + dy); v.push(String(q[1])); }
  };
  const theta = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * DEG;
  if (type === 'HATCH') {
    let stage = 'head', flags = 0, edge = 0, direction = 1;
    for (let k = 0; k < r.c.length; k++) {
      const code = r.c[k];
      if (code === 91) stage = 'paths';
      else if (code === 75) stage = 'pattern';
      else if (code === 98) stage = 'seed';
      else if (stage === 'paths') {
        if (code === 92) { flags = +r.v[k]; edge = 0; }
        else if (code === 72 && !(flags & 2)) {
          edge = +r.v[k];
          let j = k + 1;
          while (j < r.c.length && ![73, 72, 92, 75].includes(r.c[j])) j++;
          direction = r.c[j] === 73 && +r.v[j] === 0 ? -1 : 1;
        } else if ([10, 11, 12, 13].includes(code)) pair(k, edge === 3 && code === 11 || edge === 4 && code >= 12);
        else if (flags & 2 && code === 42) v[k] = String(-num(r.v[k]));
        else if (!(flags & 2) && [2, 3].includes(edge)) {
          if ([50, 51].includes(code) && edge === 2) v[k] = String(norm360(num(r.v[k]) - direction * 2 * theta));
          if (code === 73) v[k] = String(1 - num(r.v[k]));
        }
      } else if (stage === 'pattern' && code === 43) pair(k, false, 1);
      else if (stage === 'seed' && code === 10) pair(k);
    }
    // A copy owns its boundary; handles to the source boundary must not drive it.
    set(71, 0);
  } else {
    const pts = type === 'DIMENSION' ? [10, 11, 12, 13, 14, 15, 16] : ['SOLID', 'TRACE', '3DFACE'].includes(type) ? [10, 11, 12, 13]
      : type === 'SPLINE' ? [10, 11, 12, 13] : type === 'LINE' || type === 'TEXT' || type === 'ATTRIB' || type === 'ATTDEF' || type === 'ELLIPSE' ? [10, 11] : [10];
    for (let k = 0; k < r.c.length; k++) if (pts.includes(r.c[k])) pair(k, type === 'ELLIPSE' && r.c[k] === 11 || type === 'SPLINE' && r.c[k] >= 12);
    if (type === 'ELLIPSE') {
      const a0 = get(r, 41) ?? 0, a1 = get(r, 42) ?? TAU;
      set(41, mod2pi(-a1)); set(42, mod2pi(-a0));
      if (Math.abs(a1 - a0) >= TAU - 1e-6) set(42, mod2pi(-a1) + TAU);
    } else if (type === 'INSERT') {
      set(41, -(get(r, 41) ?? 1)); set(50, norm360(2 * theta - (get(r, 50) ?? 0) + 180));
      if (get(r, 44) != null) set(44, -get(r, 44));
    } else if (type === 'DIMENSION') {
      for (const code of [50, 51, 52, 53]) if (get(r, code) != null || code === 50) {
        let angle = norm360(2 * theta - (get(r, code) ?? 0));
        if (code === 53 && angle > 90 && angle <= 270) angle = norm360(angle + 180);
        set(code, angle);
      }
    }
    if (dimensionText && TEXTS.has(type)) {
      const original = type === 'MTEXT' && get(r, 11) != null ? Math.atan2(get(r, 21) ?? 0, get(r, 11)) * DEG : get(r, 50) ?? 0;
      let angle = norm360(2 * theta - original);
      const a = angle / DEG, x = parent[0] * Math.cos(a) + parent[2] * Math.sin(a), y = parent[1] * Math.cos(a) + parent[3] * Math.sin(a);
      if (x < -1e-9 || Math.abs(x) <= 1e-9 && y < 0) angle = norm360(angle + 180);
      set(50, angle);
      if (type !== 'MTEXT') set(71, (get(r, 71) ?? 0) & ~6);
      if (type === 'MTEXT') { const a = angle / DEG; set(11, Math.cos(a)); set(21, Math.sin(a)); }
    }
  }
  return { ...ent, r: { ...r, c, v } };
}
/**
 * The entity reflected in the line p1 → p2: { ent, blocks? }, or { skip: 'why' } when this kind is not mirrored. Text moves but is not turned
 * round (MIRRTEXT 0): only its insertion point is reflected, so it reads the right way.
 */
export function mirrorEntity(ent, p1, p2, blocks = {}, depth = 0) {
  if (!ent || !ent.r) return { skip: 'it has no shape' };
  if (dist(p1, p2) < 1e-12) return { skip: 'the mirror line has no length' };
  if (depth >= 10) return { skip: 'the dimension blocks are nested too deeply' };
  if (hasGrips(ent)) {
    const sh = mirrorShape(shapeOf(ent, 1), p1, p2);
    return sh ? { ent: rebuilt(sh, ent) } : { skip: 'it could not be mirrored' };
  }
  const r = ent.r;
  if (TEXTS.has(ent.type)) {
    const edits = [], x = atCode(r, 10), y = atCode(r, 20);
    if (x < 0 || y < 0) return { skip: 'no insertion point' };
    const q = reflect([num(r.v[x]), num(r.v[y])], p1, p2);
    edits.push([x, q[0]], [y, q[1]]);
    const x2 = atCode(r, 11), y2 = atCode(r, 21);
    if (ent.type === 'TEXT' && x2 >= 0 && y2 >= 0) { const q2 = reflect([num(r.v[x2]), num(r.v[y2])], p1, p2); edits.push([x2, q2[0]], [y2, q2[1]]); }
    return { ent: withValues(ent, edits) };
  }
  if (ent.type === 'INSERT' || ent.type === 'DIMENSION') {
    const name = field(r, 2), dim = ent.type === 'DIMENSION' || /^PD_DIM_/.test(name);
    if (ent.type === 'INSERT' && LDR_BLOCK.test(name)) {
      const block = blocks[name], model = !block?.xref && L.read(name, block);
      if (!model) return { skip: 'the leader has no block geometry' };
      const angle = (get(r, 50) ?? 0) / DEG, c = Math.cos(angle), s = Math.sin(angle);
      model.pts = model.pts.map(([x, y]) => {
        x = (x - block.base[0]) * (get(r, 41) ?? 1); y = (y - block.base[1]) * (get(r, 42) ?? 1);
        const wx = (get(r, 10) ?? 0) + c * x - s * y, wy = (get(r, 20) ?? 0) + s * x + c * y;
        return reflect([ent.flip ? -wx : wx, wy], p1, p2);
      });
      const built = L.build(model, L.freeName(blocks));
      return built ? { ent: insert(built.name, 0, 0, ent), blocks: { ...blocks, [built.name]: built.block } } : { skip: 'the leader has invalid geometry' };
    }
    let mirrored = mirrorRecord(ent, p1, p2);
    mirrored.kids = ent.kids?.map((kid) => mirrorRecord({ type: kid.type, r: kid, flip: (get(kid, 230) ?? 1) < 0 }, p1, p2).r);
    if (!dim) return { ent: mirrored };
    const block = blocks[name];
    if (!block || block.xref) return { skip: 'the dimension has no block geometry' };
    const prefix = ent.type === 'DIMENSION' ? '*D' : /^PD_DIM_[RDAHV]?/.exec(name)[0];
    let n = 1;
    while (blocks[prefix + n]) n++;
    const own = prefix + n, native = ent.type === 'DIMENSION';
    // Native blocks use world coordinates; PD_DIM keeps its positive insert transform and reflects local geometry.
    const a = native ? p1 : [0, 0], b = native ? p2 : [0, 1];
    const rot = (get(mirrored.r, 50) ?? 0) / DEG, sx = get(r, 41) ?? 1, sy = get(r, 42) ?? 1;
    const parent = native ? [1, 0, 0, 1] : [sx * Math.cos(rot), sx * Math.sin(rot), -sy * Math.sin(rot), sy * Math.cos(rot)];
    let nextBlocks = { ...blocks, [own]: block };
    const entities = [];
    for (const e of block.entities) {
      const result = TEXTS.has(e.type) ? { ent: mirrorRecord(e, a, b, true, parent) } : mirrorEntity(e, a, b, nextBlocks, depth + 1);
      if (!result.ent) return { skip: 'the dimension contains unsupported geometry: ' + result.skip };
      entities.push(result.ent);
      if (result.blocks) nextBlocks = result.blocks;
    }
    if (!native) mirrored = { ...mirrored, r: { ...mirrored.r, v: mirrored.r.v.map((v, k) => mirrored.r.c[k] === 41 ? String(sx) : v) } };
    mirrored = { ...mirrored, r: { ...mirrored.r, v: mirrored.r.v.map((v, k) => mirrored.r.c[k] === 2 ? own : v) } };
    const base = native ? block.base : reflect(block.base, a, b);
    return { ent: mirrored, blocks: { ...nextBlocks, [own]: { ...block, base, entities } } };
  }
  if (ent.type === 'ELLIPSE' && [10, 20, 11, 21].some((code) => atCode(r, code) < 0)) return { skip: 'it is not a plain ellipse' };
  if (['ELLIPSE', 'HATCH', 'SOLID', 'TRACE', '3DFACE', 'POINT', 'SPLINE'].includes(ent.type)) return { ent: mirrorRecord(ent, p1, p2) };
  return { skip: ent.type + ' is not mirrored yet' };
}

// ---------------------------------------------------------------- Offset

/** The side of the segment g a point lies on: +1 left of its direction of travel, -1 right. */
function sideOf(s, g, p) {
  if (g.line) return cross(g.u, sub(p, s.a)) >= 0 ? 1 : -1;
  const inside = dist(p, g.c) < g.r;
  return (g.sw > 0) === inside ? 1 : -1;               // anticlockwise: the centre is on the left
}

/** The nearest point of a path to p: { u (segment index + fraction), d, index }. */
export function closest(P, p) {
  let best = { u: 0, d: Infinity, index: 0 };
  P.segs.forEach((s, i) => {
    const g = geo(s);
    let f;
    if (g.line) f = g.len ? Math.min(1, Math.max(0, dot(sub(p, s.a), g.u) / g.len)) : 0;
    else {
      const fa = arcFrac(g, p);
      f = fa != null ? fa : (dist(p, s.a) <= dist(p, s.b) ? 0 : 1);
    }
    const d = dist(p, pointAt(g, f));
    if (d < best.d - 1e-12) best = { u: i + f, d, index: i };
  });
  return best;
}

/** Where the curve of g (the whole line or circle) meets the curve of h. */
function curveInter(g, h) {
  if (g.line && h.line) {
    const den = cross(g.u, h.u);
    if (Math.abs(den) < 1e-12) return [];
    const t = cross(sub(h.a, g.a), h.u) / den;
    return [[g.a[0] + g.u[0] * t, g.a[1] + g.u[1] * t]];
  }
  if (g.line !== h.line) {
    const l = g.line ? g : h, c = g.line ? h : g, w = sub(l.a, c.c), B = dot(l.u, w), disc = B * B - (dot(w, w) - c.r * c.r);
    if (disc < 0) return [];
    const root = Math.sqrt(disc);
    return [-B - root, -B + root].map((t) => [l.a[0] + l.u[0] * t, l.a[1] + l.u[1] * t]);
  }
  const dd = dist(g.c, h.c);
  if (dd < 1e-12 || dd > g.r + h.r || dd < Math.abs(g.r - h.r)) return [];
  const a = (g.r * g.r - h.r * h.r + dd * dd) / (2 * dd), k = Math.sqrt(Math.max(0, g.r * g.r - a * a));
  const ux = (h.c[0] - g.c[0]) / dd, uy = (h.c[1] - g.c[1]) / dd, mx = g.c[0] + ux * a, my = g.c[1] + uy * a;
  return [[mx - uy * k, my + ux * k], [mx + uy * k, my - ux * k]];
}

/** One segment moved sideways by dd (+ left of its travel): { a, b, curve (the whole line / circle), sigma, g (the original), gone }. */
function offsetSeg(s, dd) {
  const g = geo(s);
  if (g.line) {
    const n = [-g.u[1], g.u[0]], a = [s.a[0] + n[0] * dd, s.a[1] + n[1] * dd], b = [s.b[0] + n[0] * dd, s.b[1] + n[1] * dd];
    return { a, b, curve: { line: true, a, u: g.u }, g, gone: false };
  }
  const sigma = Math.sign(g.sw), r2 = g.r - sigma * dd;
  if (r2 <= 1e-9) return { gone: true, g };
  const k = r2 / g.r, a = [g.c[0] + (s.a[0] - g.c[0]) * k, g.c[1] + (s.a[1] - g.c[1]) * k], b = [g.c[0] + (s.b[0] - g.c[0]) * k, g.c[1] + (s.b[1] - g.c[1]) * k];
  return { a, b, curve: { line: false, c: g.c, r: r2 }, sigma, g, gone: false };
}

/** The offset of a path, d to the left (+) or right (-) of its direction of travel: { segs } | { error }. */
function offsetPath(P, dd) {
  const n0 = P.segs.length;
  let items = P.segs.map((s, i) => ({ s, i, o: offsetSeg(s, dd), vref: s.a }));
  for (let guard = 0; guard <= n0 + 2; guard++) {
    const live = items.filter((it) => !it.o.gone);
    if (live.length < items.length) {
      items = live;
      if (!items.length) return { error: 'The offset is more than the shape can take: nothing is left' };
    }
    const n = items.length;
    if (P.closed ? n < 2 : n < 1) return { error: 'The offset is more than the shape can take: nothing is left' };
    // the joint at the start of item k (between k - 1 and k): where the end of the one before and the start of this one go
    const joint = (k) => {
      const prev = items[(k + n - 1) % n], it = items[k], v = it.vref;
      if (dist(prev.o.b, it.o.a) < 1e-7 * (1 + Math.abs(dd))) return { e: prev.o.b, s: it.o.a };
      const xs = curveInter(prev.o.curve, it.o.curve).sort((p, q) => dist(p, v) - dist(q, v));
      return xs.length ? { e: xs[0], s: xs[0] } : { e: prev.o.b, s: it.o.a };
    };
    const J = [];
    for (let k = 0; k < n; k++) J.push(k === 0 && !P.closed ? { e: null, s: items[0].o.a } : joint(k));
    const endJ = (k) => (k + 1 < n ? J[k + 1] : P.closed ? J[0] : { e: items[n - 1].o.b, s: null });
    const out = [];
    let vanished = null;
    for (let k = 0; k < n && !vanished; k++) {
      const it = items[k], a = J[k].s, b = endJ(k).e, g = it.o.g;
      if (g.line) {
        if (dot(sub(b, a), g.u) <= 1e-9) { vanished = it; break; }
        out.push({ a, b, bulge: 0, line: true, k });
      } else {
        const c = it.o.curve.c, mag0 = Math.abs(g.sw);
        const m = mod2pi((Math.atan2(b[1] - c[1], b[0] - c[0]) - Math.atan2(a[1] - c[1], a[0] - c[0])) * it.o.sigma);
        const mag = Math.abs(m - mag0) <= Math.abs(m - TAU - mag0) ? m : m - TAU;
        if (mag <= 1e-9) { vanished = it; break; }
        out.push({ a, b, bulge: it.o.sigma * Math.tan(mag / 4), k });
      }
    }
    // a true offset is nowhere nearer the original than d: a piece that is (a side that crossed over the middle) is dropped
    for (let q = 0; q < out.length && !vanished; q++) {
      const o = out[q], go = geo(o), tol = Math.abs(dd) * (1 - 1e-4) - 1e-7;
      for (const f of [0.25, 0.5, 0.75]) if (closest(P, pointAt(go, f)).d < tol) { vanished = items[o.k]; break; }
    }
    if (vanished) {                                          // a side that turned round or an arc smaller than nothing: it goes, its neighbours meet
      const at = items.indexOf(vanished);
      if (items[(at + 1) % items.length] && items.length > 1) items[(at + 1) % items.length].vref = dist(vanished.s.a, vanished.s.b) ? [(vanished.s.a[0] + vanished.s.b[0]) / 2, (vanished.s.a[1] + vanished.s.b[1]) / 2] : vanished.s.a;
      vanished.o = { gone: true, g: vanished.o.g };
      continue;
    }
    // joints that did not meet get a straight piece between the two ends
    const segs = [];
    for (let k = 0; k < n; k++) {
      if (items[k].s.a.length > 3) out[k].a = [out[k].a[0], out[k].a[1], 0, ...items[k].s.a.slice(3)];
      if (items[k].s.b.length > 3) out[k].b = [out[k].b[0], out[k].b[1], 0, ...items[k].s.b.slice(3)];
      segs.push(out[k]);
      const nj = k + 1 < n ? J[k + 1] : P.closed ? J[0] : null;
      if (nj && nj.e && nj.s && dist(nj.e, nj.s) > 1e-7) {
        const end = items[k].s.a[4] ?? 0, start = items[(k + 1) % n].s.a[3] ?? 0;
        segs.push({ a: items[k].s.a.length > 3 || items[(k + 1) % n].s.a.length > 3 ? [nj.e[0], nj.e[1], 0, end, start] : nj.e, b: nj.s, bulge: 0, line: true });
      }
    }
    return { segs };
  }
  return { error: 'The offset could not be worked out' };
}

/** Is the path a polyline shape again: points with bulges. */
function polyOf(segs, closed) {
  const pts = segs.map((s) => (s.a.length > 3 || s.bulge ? [s.a[0], s.a[1], s.bulge || 0, ...s.a.slice(3)] : [s.a[0], s.a[1]]));
  if (!closed) pts.push(segs[segs.length - 1].b.slice());
  return { t: 'poly', pts, closed };
}

/**
 * The shape moved d away towards the point `at`. A circle or arc gets a new radius (an error when that would be nothing), a line is moved,
 * a polyline is offset segment by segment and the corners are joined with mitres (a side that would turn round is dropped).
 */
export function offsetShape(sh, d, at) {
  if (!(d > 0) || !Number.isFinite(d)) return { error: 'The offset distance must be more than 0' };
  if (sh.t === 'circle' || sh.t === 'arc') {
    const r2 = dist(at, sh.c) < sh.r ? sh.r - d : sh.r + d;
    if (r2 <= 1e-9) return { error: `The offset is more than the radius (${+sh.r.toFixed(3)}): nothing is left` };
    return { shape: { ...sh, r: r2 } };
  }
  const P = pathOf(sh);
  if (sh.t === 'line') {
    const g = geo(P.segs[0]);
    if (!g.len) return { error: 'The line has no length' };
    const s = sideOf(P.segs[0], g, at), n = [-g.u[1] * s * d, g.u[0] * s * d];
    return { shape: { t: 'line', a: [sh.a[0] + n[0], sh.a[1] + n[1]], b: [sh.b[0] + n[0], sh.b[1] + n[1]] } };
  }
  if (!P.segs.length || P.segs.some((s) => dist(s.a, s.b) < 1e-9)) return { error: 'The polyline has a side without length' };
  const near = closest(P, at), i = Math.min(P.segs.length - 1, Math.floor(near.u)), s = sideOf(P.segs[i], geo(P.segs[i]), at);
  const res = offsetPath(P, s * d);
  if (res.error) return res;
  return { shape: polyOf(res.segs, P.closed) };
}

// ---------------------------------------------------------------- Trim

function subPath(P, u0, u1) {
  const n = P.segs.length, segs = [];
  for (let k = Math.floor(u0 + 1e-12); k < Math.ceil(u1 - 1e-12); k++) {
    const f0 = Math.max(0, u0 - k), f1 = Math.min(1, u1 - k);
    if (f1 - f0 > 1e-9) segs.push(subSeg(P.segs[k % n], f0, f1));
  }
  return segs;
}

/** A piece of a path back as a shape of the kind the source was. */
export function shapeOfPiece(segs, srcType) {
  if (!segs.length) return null;
  const len = segs.reduce((a, s) => a + dist(s.a, s.b), 0);
  if (len < 1e-7) return null;
  if (srcType === 'line') return { t: 'line', a: segs[0].a, b: segs[segs.length - 1].b };
  if (srcType === 'arc' || srcType === 'circle') {
    const g = geo(segs[0]);
    return { t: 'arc', c: g.c, r: g.r, a0: norm360(Math.atan2(segs[0].a[1] - g.c[1], segs[0].a[0] - g.c[0]) * DEG), a1: norm360(Math.atan2(segs[segs.length - 1].b[1] - g.c[1], segs[segs.length - 1].b[0] - g.c[0]) * DEG) };
  }
  return polyOf(segs, false);
}

/** Where the cutting edges cross a path (segment index + fraction), sorted, no doubles; the ends of an open path are dropped. */
function cutParams(P, edges) {
  const n = P.segs.length, cuts = [];
  for (const e of edges) {
    const E = pathOf(e);
    P.segs.forEach((s, i) => { for (const t of E.segs.filter((q) => dist(q.a, q.b) >= 1e-9)) for (const h of segInter(s, t)) cuts.push(i + h.fs); });
  }
  let cs = cuts.map((u) => (P.closed && u >= n - 1e-9 ? 0 : u)).sort((a, b) => a - b);
  if (!P.closed) cs = cs.filter((u) => u > 1e-7 && u < n - 1e-7);
  return cs.filter((u, i) => i === 0 || u - cs[i - 1] > 1e-7);
}

/**
 * The kept shapes and removed shape under `pick`, sharing the same cutting interval: { shapes, removed } | { error }.
 * An open shape loses the stretch between the two crossings round the pick (up to its end when there is only one); a circle or closed
 * polyline needs two crossings and keeps the rest as one open piece.
 */
export function trimShape(sh, edges, pick, quick = false) {
  const P = pathOf(sh), n = P.segs.length;
  if (P.segs.some((s) => dist(s.a, s.b) < 1e-9)) return { error: 'The polyline has a side without length' };
  const cs = cutParams(P, edges);
  if (!cs.length) return quick ? { shapes: [], removed: sh } : { error: 'Nothing crosses it here: pick a part between cutting edges' };     // Quick: an object nothing crosses goes whole
  const up = closest(P, pick).u;
  let pieces, removed;
  if (!P.closed) {
    const lo = cs.filter((u) => u <= up).pop(), hi = cs.find((u) => u > up);
    pieces = [];
    if (lo != null) pieces.push(subPath(P, 0, lo));
    if (hi != null) pieces.push(subPath(P, hi, n));
    removed = subPath(P, lo ?? 0, hi ?? n);
  } else {
    if (cs.length < 2) return { error: 'A closed shape needs two cutting edges to trim it' };
    const lo = cs.filter((u) => u <= up).pop() ?? cs[cs.length - 1], hi = cs.find((u) => u > up) ?? cs[0];
    pieces = [subPath(P, hi, lo >= hi ? lo : lo + n)];
    removed = subPath(P, lo, hi > lo ? hi : hi + n);
  }
  const shapes = pieces.map((p) => shapeOfPiece(p, P.type)).filter(Boolean);
  return { shapes, removed: shapeOfPiece(removed, P.type) };
}

// ---------------------------------------------------------------- entities

/** Can Offset and Trim take this entity? (A line, arc, circle or light polyline lying in the plane.) */
export const canModify = (ent) => !!ent && hasGrips(ent) && ent.type !== 'LEADER';

/** The offset copy d away towards `at`; null distance means Through: { ent } | { error }. */
export function offsetEntity(ent, d, at) {
  if (!canModify(ent)) return { error: 'Offset takes a line, arc, circle or polyline' };
  const sh = shapeOf(ent, 1);
  if (d === null) {
    const P = pathOf(sh), near = closest(P, at), s = P.segs[near.index], g = s && geo(s);
    if (!g) return { error: 'The object has no offset path' };
    const distance = (g) => g.line ? Math.abs(cross(g.u, sub(at, g.a))) : Math.abs(dist(at, g.c) - g.r);
    d = distance(g);
    if (sh.t === 'poly') {
      // At a shared endpoint, the other segment may be the one whose offset passes through the pick.
      const f = near.u - near.index, other = f < 1e-9 ? near.index - 1 : f > 1 - 1e-9 ? near.index + 1 : near.index;
      let error;
      for (let i of new Set([near.index, other])) {
        if (P.closed) i = (i + P.segs.length) % P.segs.length;
        if (!P.segs[i]) continue;
        const r = offsetShape(sh, distance(geo(P.segs[i])), at);
        if (r.shape && closest(pathOf(r.shape), at).d < 1e-6) return { ent: rebuilt(r.shape, ent) };
        error ||= r.error;
      }
      return { error: error || 'The through point cannot lie on an offset of this polyline' };
    }
  }
  const r = offsetShape(sh, d, at);
  return r.error ? r : { ent: rebuilt(r.shape, ent) };
}

/** The kept entities and removed preview entity after cutting at the edges: { ents, removed } | { error }. `quick`: nothing crossing = the whole entity goes. */
export function trimEntity(ent, edges, pick, quick = false) {
  if (!canModify(ent)) return { error: 'Trim takes a line, arc, circle or polyline' };
  const shapes = edges.filter((e) => e !== ent && canModify(e)).map((e) => shapeOf(e, 1));
  const r = trimShape(shapeOf(ent, 1), shapes, pick, quick);
  return r.error ? r : { ents: r.shapes.map((sh) => rebuilt(sh, ent)), removed: r.removed ? rebuilt(r.removed, ent) : null };
}

// ---------------------------------------------------------------- Quick Trim by fence or crossing window

const straight = (pts) => pts.slice(1).map((b, i) => ({ a: pts[i], b, bulge: 0 })).filter((l) => dist(l.a, l.b) >= 1e-9);
const touches = (segs, lines) => { for (const s of segs) for (const l of lines) { const h = segInter(s, l); if (h.length) return h[0].p; } return null; };
/** For trimRegion and extendRegion: where the fence (a polyline of straight segments) first crosses a piece, null when it does not. */
export const fenceHit = (pts) => { const lines = straight(pts); return (segs) => touches(segs, lines); };
/** For trimRegion and extendRegion: a point of the piece inside or on the crossing window of corners a and b, null when it does not touch it. */
export function windowHit(a, b) {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  const lines = straight([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]), inside = (p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
  return (segs) => (inside(segs[0].a) ? segs[0].a : touches(segs, lines));
}

/**
 * Quick Trim of many at once: each piece of `ents` (the stretch between the `cutters`' crossings; an object nothing crosses is one piece)
 * for which hit(segs) is true goes, and what stays is joined into as few pieces as possible.
 * Returns { changed: [{ i, ents }] (ents = what is left of ents[i]), skipped } (a closed shape with one crossing is skipped).
 */
export function trimRegion(ents, cutters, hit) {
  const changed = [], shapes = cutters.filter(canModify).map((e) => ({ e, sh: shapeOf(e, 1) }));
  let skipped = 0;
  ents.forEach((ent, i) => {
    if (!canModify(ent)) return;
    const P = pathOf(shapeOf(ent, 1)), n = P.segs.length;
    if (P.segs.some((s) => dist(s.a, s.b) < 1e-9) || !hit(P.segs)) return;
    const cs = cutParams(P, shapes.filter((c) => c.e !== ent).map((c) => c.sh));
    if (P.closed && cs.length === 1) { skipped++; return; }
    const bounds = !cs.length ? [0, n] : P.closed ? [...cs, cs[0] + n] : [0, ...cs, n];
    let pieces = bounds.slice(1).map((u, k) => [bounds[k], u]);
    const cut = pieces.map(([u0, u1]) => !!hit(subPath(P, u0, u1)));
    if (!cut.includes(true)) return;
    const s = P.closed ? (cut.indexOf(true) + 1) % pieces.length : 0;           // a closed shape: start just after a cut piece, so no run wraps
    pieces = pieces.slice(s).concat(pieces.slice(0, s).map(([a, b]) => [a + n, b + n]));
    const keep = cut.slice(s).concat(cut.slice(0, s)).map((c) => !c), runs = [];
    pieces.forEach((pc, k) => { if (!keep[k]) return; if (k && keep[k - 1]) runs[runs.length - 1][1] = pc[1]; else runs.push([pc[0], pc[1]]); });
    changed.push({ i, ents: runs.map(([u0, u1]) => shapeOfPiece(subPath(P, u0, u1), P.type)).filter(Boolean).map((sh) => rebuilt(sh, ent)) });
  });
  return { changed, skipped };
}
