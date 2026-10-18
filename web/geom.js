// Pure geometry for the 3D viewer (viewers.js): what kind of face was clicked (flat, a cylinder: a hole, a shaft,
// a fillet), what two picks measure, and a model's true edges. No three.js here, so geom.test.mjs runs in node.
//
// Points and normals are flat arrays [x, y, z, x, y, z, …]; a triangle is three indices into them. A STEP file's
// faces come from occt-import-js as triangle ranges (brep_faces: first … last), so a face is a run of triangles.

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const DEG = 180 / Math.PI;

/** A symmetric 3×3 matrix's eigenvalues, smallest first, each with its unit eigenvector (Jacobi). */
export function eigenSym3(m) {
  const a = [[m[0][0], m[0][1], m[0][2]], [m[1][0], m[1][1], m[1][2]], [m[2][0], m[2][1], m[2][2]]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-15) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {                       // columns p, q
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {                       // rows p, q
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  return [0, 1, 2].map((i) => ({ value: a[i][i], vector: unit([v[0][i], v[1][i], v[2][i]]) }))
    .sort((x, y) => x.value - y.value);
}

/** The circle nearest some 2D points (least squares): { cx, cy, r, rms }. */
export function fitCircle(xs, ys) {
  const n = xs.length;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  // centred: u, v; solve [Suu Suv; Suv Svv] [a b] = ½ [Suuu + Suvv; Svvv + Svuu]
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (let i = 0; i < n; i++) {
    const u = xs[i] - mx, v = ys[i] - my;
    suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-30) return null;
  const r1 = (suuu + suvv) / 2, r2 = (svvv + svuu) / 2;
  const a = (r1 * svv - r2 * suv) / det, b = (suu * r2 - suv * r1) / det;
  const r = Math.sqrt(a * a + b * b + (suu + svv) / n);
  let e = 0;
  for (let i = 0; i < n; i++) { const d = Math.hypot(xs[i] - mx - a, ys[i] - my - b) - r; e += d * d; }
  return { cx: a + mx, cy: b + my, r, rms: Math.sqrt(e / n) };
}

/** The vertices a run of triangles uses, once each. */
function faceVertices(index, first, last) {
  const seen = new Set();
  for (let t = first; t <= last; t++) for (let k = 0; k < 3; k++) seen.add(index[t * 3 + k]);
  return [...seen];
}

/**
 * What kind of face triangles first…last (inclusive) make:
 *   { kind: 'plane', normal, point }               flat
 *   { kind: 'cylinder', axis, centre, radius, full }  full: a hole or shaft (half way round or more), else a fillet
 *   { kind: 'other' }
 * `normals` may be null (worked out from the triangles then).
 */
export function classifyFace(pos, normals, index, first, last) {
  const vs = faceVertices(index, first, last);
  if (vs.length < 3) return { kind: 'other' };
  const P = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  // the normals: the vertices' own, else each triangle's
  const ns = [];
  if (normals) for (const i of vs) ns.push(unit([normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]]));
  else {
    for (let t = first; t <= last; t++) {
      const a = P(index[t * 3]), b = P(index[t * 3 + 1]), c = P(index[t * 3 + 2]);
      const n = cross(sub(b, a), sub(c, a));
      if (len(n) > 0) ns.push(unit(n));
    }
  }
  if (!ns.length) return { kind: 'other' };
  const pts = vs.map(P);
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  const size = len(sub(hi, lo)) || 1;

  // flat: every normal the same way (the first, flipped to agree), every point on its plane
  const n0 = ns[0];
  if (ns.every((n) => Math.abs(dot(n, n0)) > 0.9998)) {
    const c = pts.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((x) => x / pts.length);
    if (pts.every((p) => Math.abs(dot(sub(p, c), n0)) < size * 1e-4 + 1e-9)) return { kind: 'plane', normal: n0, point: c };
  }

  // a cylinder: the axis is the one way no normal points (the least of Σ n nᵀ)
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const n of ns) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r][c] += n[r] * n[c];
  const axis = eigenSym3(m)[0].vector;
  if (!ns.every((n) => Math.abs(dot(n, axis)) < 0.03)) return { kind: 'other' };
  // the points seen down the axis lie on a circle
  const e1 = unit(Math.abs(axis[0]) < 0.9 ? cross(axis, [1, 0, 0]) : cross(axis, [0, 1, 0])), e2 = cross(axis, e1);
  const xs = pts.map((p) => dot(p, e1)), ys = pts.map((p) => dot(p, e2));
  const circ = fitCircle(xs, ys);
  if (!circ || !(circ.r > 0) || circ.rms > circ.r * 0.01 + size * 1e-5) return { kind: 'other' };
  // a hole or shaft, or a fillet: how far round it goes (a STEP file often splits a hole into two halves, so half is enough)
  const ang = xs.map((x, i) => Math.atan2(ys[i] - circ.cy, x - circ.cx)).sort((a, b) => a - b);
  let gap = ang[0] + 2 * Math.PI - ang[ang.length - 1];
  for (let i = 1; i < ang.length; i++) gap = Math.max(gap, ang[i] - ang[i - 1]);
  const along = pts.map((p) => dot(p, axis));
  const mid = (Math.min(...along) + Math.max(...along)) / 2;
  const centre = [0, 1, 2].map((k) => e1[k] * circ.cx + e2[k] * circ.cy + axis[k] * mid);
  return { kind: 'cylinder', axis, centre, radius: circ.r, full: 2 * Math.PI - gap >= 150 / DEG };
}

const parallel = (a, b) => Math.abs(dot(a, b)) > Math.cos(0.5 / DEG);
/** The distance from point p to the line through c along unit d. */
const toLine = (p, c, d) => { const v = sub(p, c); return len(sub(v, d.map((x) => x * dot(v, d)))); };

/**
 * What one pick says: a hole or shaft's diameter, a fillet's radius, a flat face.
 * pick: { point: [x, y, z], face: classifyFace(…) or null }
 */
export function describe(pick) {
  const f = pick.face;
  if (f && f.kind === 'cylinder') return f.full ? { kind: 'diameter', value: f.radius * 2 } : { kind: 'radius', value: f.radius };
  if (f && f.kind === 'plane') return { kind: 'flat' };
  return { kind: 'point' };
}

/**
 * What two picks measure, the most useful first:
 *   two flat faces, parallel: the gap between them; not parallel: the angle between them
 *   two cylinders on parallel axes: centre to centre;  a cylinder and a flat face along it: axis to face
 *   otherwise: point to point, with its x, y, z parts
 * → { kind: 'gap' | 'angle' | 'centres' | 'axis-face' | 'points', value, dx?, dy?, dz? }
 */
export function measure(a, b) {
  const fa = a.face, fb = b.face;
  if (fa && fb && fa.kind === 'plane' && fb.kind === 'plane') {
    if (parallel(fa.normal, fb.normal)) return { kind: 'gap', value: Math.abs(dot(sub(fb.point, fa.point), fa.normal)) };
    return { kind: 'angle', value: Math.acos(Math.min(1, Math.abs(dot(fa.normal, fb.normal)))) * DEG };
  }
  if (fa && fb && fa.kind === 'cylinder' && fb.kind === 'cylinder' && parallel(fa.axis, fb.axis)) {
    return { kind: 'centres', value: toLine(fb.centre, fa.centre, fa.axis) };
  }
  const cyl = fa && fa.kind === 'cylinder' ? fa : fb && fb.kind === 'cylinder' ? fb : null;
  const pl = fa && fa.kind === 'plane' ? fa : fb && fb.kind === 'plane' ? fb : null;
  if (cyl && pl && Math.abs(dot(cyl.axis, pl.normal)) < Math.sin(0.5 / DEG)) {
    return { kind: 'axis-face', value: Math.abs(dot(sub(cyl.centre, pl.point), pl.normal)) };
  }
  const d = sub(b.point, a.point);
  return { kind: 'points', value: len(d), dx: Math.abs(d[0]), dy: Math.abs(d[1]), dz: Math.abs(d[2]) };
}

/**
 * A model's true edges: where one face meets another, and a face's open border. faceOf[t] is triangle t's face.
 * Vertices are matched by place (a STEP file gives each face its own), to within `tol`.
 * → Float32Array of line segments [x1, y1, z1, x2, y2, z2, …]
 */
export function featureEdges(pos, index, faceOf, tol) {
  const q = 1 / (tol || 1e-6);
  const keyOf = new Map();                       // vertex → the id of its place
  const ids = new Int32Array(pos.length / 3);
  for (let i = 0; i < ids.length; i++) {
    const k = Math.round(pos[i * 3] * q) + ',' + Math.round(pos[i * 3 + 1] * q) + ',' + Math.round(pos[i * 3 + 2] * q);
    let id = keyOf.get(k);
    if (id === undefined) { id = keyOf.size; keyOf.set(k, id); }
    ids[i] = id;
  }
  const edges = new Map();                       // "a,b" → { v: [i, j], faces: [f, …] }
  for (let t = 0; t < index.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const i = index[t * 3 + k], j = index[t * 3 + (k + 1) % 3];
      const a = ids[i], b = ids[j];
      if (a === b) continue;
      const key = a < b ? a + ',' + b : b + ',' + a;
      const e = edges.get(key);
      if (e) e.faces.push(faceOf[t]); else edges.set(key, { v: [i, j], faces: [faceOf[t]] });
    }
  }
  const out = [];
  for (const e of edges.values()) {
    if (e.faces.length === 2 && e.faces[0] === e.faces[1]) continue;     // inside a face (a seam is one face both sides)
    for (const i of e.v) out.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  }
  return new Float32Array(out);
}

/** A length as the viewer shows it: 3 figures, trailing zeros gone; with the unit when known. */
export function fmtLength(n, unitName) {
  const a = Math.abs(n), s = (a >= 100 ? n.toFixed(1) : a >= 10 ? n.toFixed(2) : n.toFixed(3)).replace(/\.?0+$/, '').replace(/^-0$/, '0');
  return unitName ? s + ' ' + unitName : s;
}

/** A measurement's x, y (and z) parts, where it has them: " (x 10 · y 7.5 · z 0)". */
const parts = (m) => m.dx == null ? '' : ' (x ' + fmtLength(m.dx) + ' · y ' + fmtLength(m.dy) + (m.dz == null ? '' : ' · z ' + fmtLength(m.dz)) + ')';

/** What a measurement reads as: "Ø 8.2 mm", "Gap 40 mm", "Angle 90°", "Distance 12.5 mm (x 10 · y 7.5 · z 0)". */
export function label(m, unitName) {
  const L = (n) => fmtLength(n, unitName);
  switch (m.kind) {
    case 'diameter': return 'Ø ' + L(m.value);
    case 'radius': return 'R ' + L(m.value);
    case 'flat': return 'Flat face';
    case 'point': return 'A point';
    case 'gap': return 'Gap ' + L(m.value);
    case 'angle': return 'Angle ' + fmtLength(m.value) + '°';
    case 'centres': return 'Centre to centre ' + L(m.value) + parts(m);
    case 'axis-face': return 'Axis to face ' + L(m.value);
    case 'length': return 'Length ' + L(m.value);
    case 'centre-line': return 'Centre to line ' + L(m.value);
    case 'point-line': return 'Point to line ' + L(m.value);
    case 'at': return 'At x ' + fmtLength(m.x) + ' · y ' + fmtLength(m.y);
    default: return 'Distance ' + L(m.value) + parts(m);
  }
}
