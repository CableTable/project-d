// geom.js — the 3D viewer's faces, measurements and edges.   node geom.test.mjs
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const G = await import('./web/geom.js');

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, a + ' ≠ ' + b);

/** A tube along `axis` (0 x, 1 y, 2 z) of radius r, centre c, from z0 to z1, as a triangle mesh with normals. */
function tube(r, c, z0, z1, axis = 2, segs = 48, from = 0, to = 2 * Math.PI, inward = true) {
  const pos = [], nor = [], index = [];
  const put = (u, v, w) => { const p = [0, 0, 0]; p[(axis + 1) % 3] = u; p[(axis + 2) % 3] = v; p[axis] = w; return p; };
  for (let i = 0; i <= segs; i++) {
    const a = from + (to - from) * i / segs, x = Math.cos(a), y = Math.sin(a);
    for (const z of [z0, z1]) {
      const p = put(c[0] + r * x, c[1] + r * y, z);
      pos.push(...p);
      nor.push(...put(inward ? -x : x, inward ? -y : y, 0));
    }
  }
  for (let i = 0; i < segs; i++) { const a = i * 2; index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  return { pos, nor, index, tris: index.length / 3 };
}

/** A flat rectangle at height z (normal +z), w × d, from x0, y0. */
function rect(z, x0 = 0, y0 = 0, w = 40, d = 20) {
  return { pos: [x0, y0, z, x0 + w, y0, z, x0 + w, y0 + d, z, x0, y0 + d, z], nor: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], index: [0, 1, 2, 0, 2, 3], tris: 2 };
}
const face = (m) => G.classifyFace(m.pos, m.nor, m.index, 0, m.tris - 1);

test('eigenSym3: a diagonal matrix, and a rotated one', () => {
  const e = G.eigenSym3([[3, 0, 0], [0, 1, 0], [0, 0, 2]]);
  assert.deepEqual(e.map((x) => Math.round(x.value)), [1, 2, 3]);
  near(Math.abs(e[0].vector[1]), 1);
  // n nᵀ summed over normals in the xy plane: the smallest is z
  const m = [[2, 0.5, 0], [0.5, 1, 0], [0, 0, 0]];
  const s = G.eigenSym3(m);
  near(s[0].value, 0); near(Math.abs(s[0].vector[2]), 1);
});

test('fitCircle finds the centre and radius', () => {
  const xs = [], ys = [];
  for (let i = 0; i < 12; i++) { xs.push(5 + 4.1 * Math.cos(i)); ys.push(-3 + 4.1 * Math.sin(i)); }
  const c = G.fitCircle(xs, ys);
  near(c.cx, 5); near(c.cy, -3); near(c.r, 4.1); near(c.rms, 0, 1e-9);
});

test('a flat face is flat, with its normal', () => {
  const f = face(rect(10));
  assert.equal(f.kind, 'plane');
  near(Math.abs(f.normal[2]), 1);
  near(f.point[2], 10);
});

test('a hole is a full cylinder: Ø 8.2 on any axis', () => {
  for (const axis of [0, 1, 2]) {
    const f = face(tube(4.1, [12, 7], 0, 10, axis));
    assert.equal(f.kind, 'cylinder', 'axis ' + axis);
    assert.equal(f.full, true);
    near(f.radius, 4.1, 1e-6);
    near(Math.abs(f.axis[axis]), 1, 1e-9);
    assert.equal(G.label(G.describe({ face: f }), 'mm'), 'Ø 8.2 mm');
  }
});

test('half a hole (STEP splits them) is still a diameter', () => {
  const f = face(tube(5, [0, 0], 0, 8, 2, 24, 0, Math.PI));
  assert.equal(f.full, true);
  assert.equal(G.label(G.describe({ face: f }), 'mm'), 'Ø 10 mm');
});

test('a fillet (a quarter round) is a radius', () => {
  const f = face(tube(2, [0, 0], 0, 30, 2, 12, 0, Math.PI / 2, false));
  assert.equal(f.kind, 'cylinder');
  assert.equal(f.full, false);
  assert.equal(G.label(G.describe({ face: f }), 'mm'), 'R 2 mm');
});

test('a face with no normals is worked out from its triangles', () => {
  const r = rect(5);
  assert.equal(G.classifyFace(r.pos, null, r.index, 0, 1).kind, 'plane');
});

test('a bent sheet is neither flat nor a cylinder', () => {
  const pos = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0.8, 2, 0, 0.1, 2, 1, 1.9];
  const nor = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0.3, 0.2, 0.9, 0.6, 0, 0.8, 0.1, 0.9, 0.4];
  const index = [0, 1, 2, 1, 3, 2, 1, 4, 3, 4, 5, 3];
  assert.equal(G.classifyFace(pos, nor, index, 0, 3).kind, 'other');
});

test('two parallel faces: the gap; two at an angle: the angle', () => {
  const top = face(rect(10)), bottom = face(rect(0));
  const gap = G.measure({ point: [1, 1, 10], face: top }, { point: [30, 5, 0], face: bottom });
  assert.equal(gap.kind, 'gap'); near(gap.value, 10);
  assert.equal(G.label(gap, 'mm'), 'Gap 10 mm');
  const side = { kind: 'plane', normal: [1, 0, 0], point: [40, 0, 0] };
  const ang = G.measure({ point: [0, 0, 10], face: top }, { point: [40, 0, 5], face: side });
  assert.equal(ang.kind, 'angle'); near(ang.value, 90);
  assert.equal(G.label(ang), 'Angle 90°');
});

test('two holes on parallel axes: centre to centre; a hole and a face along it: axis to face', () => {
  const a = face(tube(3, [0, 0], 0, 5)), b = face(tube(3, [30, 40], 0, 5));
  const m = G.measure({ point: [3, 0, 2], face: a }, { point: [33, 40, 2], face: b });
  assert.equal(m.kind, 'centres'); near(m.value, 50, 1e-6);
  const wall = { kind: 'plane', normal: [-1, 0, 0], point: [-20, 0, 0] };
  const af = G.measure({ point: [3, 0, 2], face: a }, { point: [-20, 5, 1], face: wall });
  assert.equal(af.kind, 'axis-face'); near(af.value, 20, 1e-6);
});

test('anything else: point to point, with its parts', () => {
  const m = G.measure({ point: [0, 0, 0], face: null }, { point: [3, -4, 12], face: null });
  assert.equal(m.kind, 'points'); near(m.value, 13);
  assert.equal(G.label(m, 'mm'), 'Distance 13 mm (x 3 · y 4 · z 12)');
});

test('true edges: a box\'s 12, none across a face\'s own triangles', () => {
  // a 2 × 2 × 2 cube, each face its own 4 vertices and 2 triangles (as a STEP file gives it)
  const pos = [], index = [], faceOf = [];
  const quads = [
    [[0, 0, 0], [0, 2, 0], [2, 2, 0], [2, 0, 0]], [[0, 0, 2], [2, 0, 2], [2, 2, 2], [0, 2, 2]],
    [[0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2]], [[0, 2, 0], [0, 2, 2], [2, 2, 2], [2, 2, 0]],
    [[0, 0, 0], [0, 0, 2], [0, 2, 2], [0, 2, 0]], [[2, 0, 0], [2, 2, 0], [2, 2, 2], [2, 0, 2]]
  ];
  quads.forEach((q, f) => {
    const b = pos.length / 3;
    q.forEach((p) => pos.push(...p));
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
    faceOf.push(f, f);
  });
  const segs = G.featureEdges(new Float32Array(pos), index, faceOf, 1e-6);
  assert.equal(segs.length / 6, 12);
  // no diagonal: every edge runs along one axis
  for (let i = 0; i < segs.length; i += 6) {
    const moved = [0, 1, 2].filter((k) => segs[i + k] !== segs[i + 3 + k]).length;
    assert.equal(moved, 1);
  }
});

test('lengths read short', () => {
  assert.equal(G.fmtLength(40), '40');
  assert.equal(G.fmtLength(8.2), '8.2');
  assert.equal(G.fmtLength(123.456, 'mm'), '123.5 mm');
  assert.equal(G.fmtLength(0.12345), '0.123');
});
