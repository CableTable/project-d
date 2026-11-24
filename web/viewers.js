// The 3D viewer (ported from Project R's viewers.js, TODO 10a): a model to turn, with Fit; Views (Iso, Front, Top,
// Right; Ortho); Edges (where the surface bends); X-ray; Section (a cut along X, Y or Z, its face filled); Measure
// (point to point: geom.js); Smooth shading for the mesh kinds below. three.js (web/vendor/three/three-view.js, npm run vendor)
// loads only when a model is first opened. STEP / IGES / BREP (sizes in mm; faces, holes and angles to Measure) are read off the page's
// thread by occt-worker.js (TODO 10b1); the read-model cache (IndexedDB) and the Parts tree are done in 10b2; Snap (10c) hands the view's PNG to opts.snap(blob, w, h).
//
//   const done = await renderPreview(el, blob, '3d', 'bracket.stl');   … later: done();
//
// A file that can't be read throws an Error with a short plain message; the caller shows it in the status line.

import { h } from './dom.js';

export const MESH_KINDS = ['stl', 'obj', 'ply', 'glb', 'gltf', '3mf'];
const KINDS = { '3d': model3d };
const SORRY = { '3d': 'Couldn\'t read this 3D file.' };

/** Draws a preview of `blob` into `el` (in the page, sized, position: relative); resolves with a cleanup function. */
export async function renderPreview(el, blob, kind, name, opts = {}) {
  const draw = KINDS[kind];
  if (!draw) throw new Error('No preview for this kind of file.');
  const root = h('div', { class: 'pv pv-' + kind });
  el.append(root);
  const undo = [];                          // what to put away when the viewer closes
  try {
    await draw(root, blob, name || '', (fn) => undo.push(fn), opts);
  } catch (e) {
    tidy(undo); root.remove();
    if (!(e instanceof FriendlyError)) console.warn('Preview failed:', e);
    throw e instanceof FriendlyError ? e : new Error(SORRY[kind]);
  }
  return () => { tidy(undo); root.remove(); };
}

class FriendlyError extends Error {}
const sorry = (msg) => new FriendlyError(msg);
function tidy(undo) { for (const fn of undo.splice(0).reverse()) { try { fn(); } catch { /* closing anyway */ } } }

// ---------------------------------------------------------------- small pieces

const note = (text) => h('div', { class: 'pv-msg' }, text);
const btn = (label, onclick, attrs) => h('button', { type: 'button', class: 'pv-btn', onclick, ...attrs }, label);

/** Calls fn(width, height) now and whenever the box changes size. */
function watchSize(box, fn, undo) {
  const ro = new ResizeObserver(() => fn(box.clientWidth, box.clientHeight));
  ro.observe(box);
  undo(() => ro.disconnect());
  fn(box.clientWidth, box.clientHeight);
}

// ---------------------------------------------------------------- 3D models

const Z_UP = new Set(['stl', 'ply', '3mf', 'step', 'stp', 'iges', 'igs', 'brep']);   // CAD files stand on Z; obj and glTF on Y
const CAD = new Set(['step', 'stp', 'iges', 'igs', 'brep']);
const after = (ms) => new Promise((r) => setTimeout(r, ms));
const ACCENT = 0xf2b544, CUT = 0xd9775f;

// Where each view looks from, and which way is up on screen (a hair off straight down, so Top keeps its bearings).
const VIEWS = {
  z: { Iso: [1, -1.2, 0.9], Front: [0, -1, 0], Top: [0, -1e-4, 1], Right: [1, 0, 0] },
  y: { Iso: [1, 0.8, 1.2], Front: [0, 0, 1], Top: [0, 1, 1e-4], Right: [1, 0, 0] }
};

/** A mesh file's bytes as a three.js Group (T = the vendored three.js, metal = the default material). Throws what the loader throws. */
export async function loadMesh(T, ext, blob, metal) {
  const group = new T.Group();
  if (ext === 'stl') group.add(new T.Mesh(new T.STLLoader().parse(await blob.arrayBuffer()), metal));
  else if (ext === 'ply') {
    const g = new T.PLYLoader().parse(await blob.arrayBuffer());
    if (g.index || g.getAttribute('position').count % 3 === 0 && g.getAttribute('normal')) {
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      const m = g.getAttribute('color') ? new T.MeshStandardMaterial({ vertexColors: true, metalness: 0.1, roughness: 0.6, side: T.DoubleSide }) : metal;
      group.add(new T.Mesh(g, m));
    } else group.add(new T.Points(g, new T.PointsMaterial({ size: 0.01, vertexColors: !!g.getAttribute('color'), color: 0xaab2bd })));
  } else if (ext === 'obj') {
    const o = new T.OBJLoader().parse(await blob.text());
    o.traverse((n) => { if (n.isMesh) { if (!n.geometry.getAttribute('normal')) n.geometry.computeVertexNormals(); n.material = metal; } });
    group.add(o);
  } else if (ext === '3mf') group.add(new T.ThreeMFLoader().parse(await blob.arrayBuffer()));
  else {
    const data = await blob.arrayBuffer();
    // glTF pictures normally load through fetch(blob:), which the page's CSP refuses; the plain <img> way is allowed.
    const cib = globalThis.createImageBitmap;
    const gltf = await new Promise((ok, no) => {
      globalThis.createImageBitmap = undefined;
      try { new T.GLTFLoader().parse(data, '', ok, no); } catch (e) { no(e); } finally { globalThis.createImageBitmap = cib; }
    });
    group.add(gltf.scene);
  }
  return group;
}

async function model3d(root, blob, name, undo, opts = {}) {
  const ext = (name.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
  if (!CAD.has(ext) && !MESH_KINDS.includes(ext)) throw sorry('This kind of 3D file can\'t be previewed.');
  const local = [];                                  // put away on close
  const put = (fn) => local.push(fn);
  undo(() => tidy(local));
  const unitName = CAD.has(ext) ? 'mm' : '';
  const body = h('div', { class: 'pv-body' }, note(CAD.has(ext) ? 'Reading the model… a big one takes a while.' : 'Loading…'));
  root.append(body);
  const [T, G] = await Promise.all([import('./vendor/three/three-view.js'), import('./geom.js')]);

  let renderer;
  try { renderer = new T.WebGLRenderer({ antialias: true, stencil: true }); } catch { throw sorry('This browser can\'t show 3D files.'); }
  put(() => { renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.localClippingEnabled = true;
  const canvas = renderer.domElement;

  // the work area is the page's own colour (--canvas, light or dark); metal is grey
  const bg = new T.Color(); try { bg.setStyle(getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim() || '#14161B'); } catch { bg.set('#14161B'); }
  const dark = (bg.r + bg.g + bg.b) / 3 < 0.5;
  const scene = new T.Scene(); scene.background = bg;
  const zUp = Z_UP.has(ext);
  const persp = new T.PerspectiveCamera(40, 1, 0.1, 1000), ortho = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  for (const c of [persp, ortho]) { c.up.set(...(zUp ? [0, 0, 1] : [0, 1, 0])); scene.add(c); }
  let camera = persp;
  scene.add(new T.HemisphereLight(0xffffff, dark ? 0x454a57 : 0x8a8f9c, 1.6));
  const key = new T.DirectionalLight(0xffffff, 2.4);          // a headlight: follows the camera
  key.position.set(0.4, 0.8, 1); camera.add(key);
  const metal = new T.MeshStandardMaterial({ color: 0xaab2bd, metalness: 0.25, roughness: 0.5, side: T.DoubleSide });
  put(() => metal.dispose());

  await after(30);                                               // let the message paint
  let group;
  if (CAD.has(ext)) {
    const r = await readCad(await blob.arrayBuffer(), ext, put, root);
    if (!r.meshes.length) throw sorry('Couldn\'t read this 3D file.');
    group = new T.Group(); group.add(cadTree(T, r, metal));
  } else group = await loadMesh(T, ext, blob, metal);
  // each part its own material (so one can be seen through); faces sit back a hair so edges draw clean
  const meshes = [];
  group.traverse((n) => {
    if (!n.isMesh) return;
    n.material = Array.isArray(n.material) ? n.material.map((m) => m.clone()) : n.material.clone();
    for (const m of [].concat(n.material)) { m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 1; }
    n.renderOrder = 2;
    meshes.push(n);
  });
  scene.add(group);
  put(() => {
    group.traverse((n) => {
      if (n.geometry) n.geometry.dispose();
      for (const mat of [].concat(n.material || [])) { for (const v of Object.values(mat)) if (v && v.isTexture) v.dispose(); mat.dispose(); }
    });
  });
  const mats = () => meshes.flatMap((n) => [].concat(n.material));

  let tris = 0, parts = 0;
  group.traverse((n) => {
    if (n.isMesh || n.isPoints) { parts++; const g = n.geometry; tris += n.isMesh ? ((g.index ? g.index.count : g.getAttribute('position').count) / 3) : 0; }
  });
  group.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(group);
  if (!parts || box.isEmpty()) throw sorry('Couldn\'t read this 3D file.');
  const size = box.getSize(new T.Vector3()), centre = box.getCenter(new T.Vector3());
  const radius = Math.max(size.length() / 2, 1e-6);

  // a faint floor under it
  const grid = new T.GridHelper(radius * 4, 20, dark ? 0x4a505c : 0xa0a6b2, dark ? 0x30343d : 0xd0d4dc);
  grid.material.transparent = true; grid.material.opacity = 0.5;
  if (zUp) { grid.rotation.x = Math.PI / 2; grid.position.set(centre.x, centre.y, box.min.z); } else grid.position.set(centre.x, box.min.y, centre.z);
  scene.add(grid);
  put(() => { grid.geometry.dispose(); grid.material.dispose(); });

  const controls = new T.OrbitControls(camera, canvas);
  controls.screenSpacePanning = true;
  let queued = 0;
  const draw = () => { if (queued) return; queued = requestAnimationFrame(() => { queued = 0; renderer.render(scene, camera); }); };
  controls.addEventListener('change', draw);
  put(() => { if (queued) cancelAnimationFrame(queued); queued = 0; controls.dispose(); });

  // ---- the cameras: Fit, the views, Ortho
  let aspect = 1, look = 'Iso';
  const flatFrame = (dist) => {                     // the flat camera shows what the round one would at this distance
    const half = dist * Math.tan(persp.fov * Math.PI / 360);
    ortho.left = -half * aspect; ortho.right = half * aspect; ortho.top = half; ortho.bottom = -half;
  };
  function fit(view) {
    if (view) look = view;
    const v = persp.fov * Math.PI / 180, hv = 2 * Math.atan(Math.tan(v / 2) * Math.min(aspect, 1));
    const dist = radius / Math.sin(Math.min(v, hv) / 2) * 1.05;
    const dir = new T.Vector3(...VIEWS[zUp ? 'z' : 'y'][look]).normalize();
    for (const c of [persp, ortho]) {
      c.position.copy(centre).addScaledVector(dir, dist);
      c.near = dist / 200; c.far = dist * 50; c.zoom = 1;
    }
    flatFrame(dist);
    persp.updateProjectionMatrix(); ortho.updateProjectionMatrix();
    controls.target.copy(centre); controls.update(); draw();
  }
  function useCamera(flat) {
    const next = flat ? ortho : persp;
    if (next === camera) return;
    next.position.copy(camera.position); next.quaternion.copy(camera.quaternion);
    if (flat) { flatFrame(camera.position.distanceTo(controls.target)); ortho.zoom = 1; ortho.updateProjectionMatrix(); }
    else if (camera.zoom !== 1) {                    // the flat camera's zoom becomes distance
      const d = camera.position.distanceTo(controls.target) / camera.zoom;
      next.position.copy(controls.target).addScaledVector(camera.position.clone().sub(controls.target).normalize(), d);
    }
    next.add(key);
    camera = next; controls.object = next; controls.update(); draw();
  }

  // ---- edges: a STEP file's true ones (where faces meet), else where the surface bends; found when first asked for
  let edges = null;
  const edgeMat = new T.LineBasicMaterial({ color: dark ? 0xe3e6ec : 0x1b1e24 });
  put(() => edgeMat.dispose());
  function makeEdges() {
    edges = [];
    for (const n of meshes) {
      const g = n.geometry, faces = n.userData.faces;
      let lg;
      if (faces && faces.length && g.index) {
        lg = new T.BufferGeometry();
        lg.setAttribute('position', new T.BufferAttribute(G.featureEdges(g.getAttribute('position').array, g.index.array, faceOf(n), radius * 1e-6), 3));
      } else lg = new T.EdgesGeometry(g, 30);
      const l = new T.LineSegments(lg, edgeMat);
      l.renderOrder = 2;
      n.add(l); edges.push(l);
    }
    put(() => edges.forEach((l) => l.geometry.dispose()));
  }

  // ---- X-ray: see through to what's inside
  function xray(on) {
    for (const m of mats()) {
      if (on) { m.userData.was = { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite }; m.transparent = true; m.opacity = 0.28; m.depthWrite = false; }
      else if (m.userData.was) { Object.assign(m, m.userData.was); delete m.userData.was; }
      m.needsUpdate = true;
    }
    draw();
  }

  // ---- Section: a cut through the model, its face filled (the stencil counts in and out of the solid)
  const cut = { on: false, axis: zUp ? 2 : 1, at: 0.5, flip: false, plane: new T.Plane(new T.Vector3(0, 0, -1), 0), cap: null, stencils: null };
  function placeCut() {
    const n = [0, 0, 0]; n[cut.axis] = cut.flip ? 1 : -1;
    const lo = box.min.getComponent(cut.axis), hi = box.max.getComponent(cut.axis);
    const at = lo + (hi - lo) * cut.at;
    cut.plane.normal.set(...n);
    cut.plane.constant = cut.flip ? -at : at;
    if (cut.cap) {                                   // the filled face: on the cut, across the model
      const c = box.getCenter(new T.Vector3()); c.setComponent(cut.axis, at);
      cut.cap.position.copy(c);
      cut.cap.lookAt(c.clone().sub(cut.plane.normal));
    }
    draw();
  }
  function section(on) {
    cut.on = on;
    if (on && !cut.stencils) {
      const base = { depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: T.AlwaysStencilFunc, clippingPlanes: [cut.plane] };
      const inc = T.IncrementWrapStencilOp, dec = T.DecrementWrapStencilOp;
      const back = new T.MeshBasicMaterial({ ...base, side: T.BackSide, stencilFail: inc, stencilZFail: inc, stencilZPass: inc });
      const front = new T.MeshBasicMaterial({ ...base, side: T.FrontSide, stencilFail: dec, stencilZFail: dec, stencilZPass: dec });
      cut.stencils = [];
      for (const n of meshes) for (const m of [back, front]) { const s = new T.Mesh(n.geometry, m); s.renderOrder = 1; n.add(s); cut.stencils.push(s); }
      const capMat = new T.MeshBasicMaterial({ color: CUT, side: T.DoubleSide, stencilWrite: true, stencilRef: 0, stencilFunc: T.NotEqualStencilFunc,
        stencilFail: T.ReplaceStencilOp, stencilZFail: T.ReplaceStencilOp, stencilZPass: T.ReplaceStencilOp });
      cut.cap = new T.Mesh(new T.PlaneGeometry(radius * 4, radius * 4), capMat);
      cut.cap.renderOrder = 1.1;
      cut.cap.onAfterRender = (r) => r.clearStencil();
      scene.add(cut.cap);
      put(() => { back.dispose(); front.dispose(); capMat.dispose(); cut.cap.geometry.dispose(); });
    }
    for (const s of cut.stencils || []) s.visible = on;
    if (cut.cap) cut.cap.visible = on;
    for (const m of mats().concat(edgeMat)) m.clippingPlanes = on ? [cut.plane] : [];
    placeCut();
  }

  // ---- picking: which point, which face (a STEP file's faces are runs of triangles)
  const ray = new T.Raycaster();
  const visibleUp = (n) => { for (let o = n; o; o = o.parent) if (!o.visible) return false; return true; };
  function faceOf(n) {                               // triangle → its face number
    if (n.userData.faceOf) return n.userData.faceOf;
    const f = new Int32Array(n.geometry.index.count / 3).fill(-1);
    n.userData.faces.forEach((x, i) => f.fill(i, x.first, x.last + 1));
    return (n.userData.faceOf = f);
  }
  function faceAt(n, tri) {                          // → { face: geom.js's, first, last } in world terms, or null
    const faces = n.userData.faces;
    if (!faces || !faces.length || !n.geometry.index) return null;
    const i = faceOf(n)[tri];
    if (i < 0) return null;
    const cache = n.userData.kinds || (n.userData.kinds = new Map());
    if (!cache.has(i)) {
      const g = n.geometry, nor = g.getAttribute('normal');
      cache.set(i, G.classifyFace(g.getAttribute('position').array, nor ? nor.array : null, g.index.array, faces[i].first, faces[i].last));
    }
    return { face: toWorld(cache.get(i), n), first: faces[i].first, last: faces[i].last };
  }
  function toWorld(f, n) {
    if (f.kind === 'other') return f;
    const pt = (p) => new T.Vector3(...p).applyMatrix4(n.matrixWorld).toArray();
    const dir = (d) => new T.Vector3(...d).transformDirection(n.matrixWorld).toArray();
    return f.kind === 'plane' ? { kind: 'plane', normal: dir(f.normal), point: pt(f.point) }
      : { ...f, axis: dir(f.axis), centre: pt(f.centre), radius: f.radius * n.matrixWorld.getMaxScaleOnAxis() };
  }
  function pickAt(e) {
    const r = canvas.getBoundingClientRect();
    camera.updateMatrixWorld();                      // a click right after a view change comes before the next render
    ray.setFromCamera(new T.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
    const hits = ray.intersectObjects(meshes.filter((n) => n.visible && visibleUp(n)), false);
    return hits.find((x) => !cut.on || cut.plane.distanceToPoint(x.point) >= 0) || null;
  }

  // ---- Measure: one pick says what it is (Ø, R, a flat face); two say how far apart, or the angle
  const marks = new T.Group(); scene.add(marks);
  const markMat = new T.MeshBasicMaterial({ color: ACCENT, depthTest: false });
  const faceMat = new T.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.45, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const lineMat = new T.LineBasicMaterial({ color: ACCENT, depthTest: false });
  const dotGeo = new T.SphereGeometry(1, 16, 12);
  put(() => { clearMarks(); markMat.dispose(); faceMat.dispose(); lineMat.dispose(); dotGeo.dispose(); });
  function clearMarks() { for (const o of marks.children.slice()) { if (o.geometry && o.geometry !== dotGeo) o.geometry.dispose(); marks.remove(o); } }
  let picks = [];
  const readout = h('div', { class: 'pv-readout', 'data-testid': 'pv-readout', hidden: true });
  function say(text, hint) {
    readout.hidden = false;
    readout.replaceChildren(...[h('strong', null, text), hint ? h('span', null, hint) : null].filter(Boolean),
      btn('Clear', () => { picks = []; clearMarks(); say(START); draw(); }));
  }
  const START = CAD.has(ext) ? 'Pick a face, a hole or a point.' : 'Pick a point.';
  function measurePick(hit) {
    const n = hit.object, f = faceAt(n, hit.faceIndex);
    const pick = { point: hit.point.toArray(), face: f ? f.face : null };
    if (picks.length >= 2) { picks = []; clearMarks(); }
    picks.push(pick);
    const dot = new T.Mesh(dotGeo, markMat); dot.renderOrder = 9;
    dot.scale.setScalar(radius * 0.012); dot.position.copy(hit.point); marks.add(dot);
    if (f && f.face.kind !== 'other') {               // the face, lit up
      const g = new T.BufferGeometry();
      g.setAttribute('position', n.geometry.getAttribute('position'));
      g.setIndex(new T.BufferAttribute(n.geometry.index.array.slice(f.first * 3, (f.last + 1) * 3), 1));
      const m = new T.Mesh(g, faceMat); m.matrixAutoUpdate = false; m.matrix.copy(n.matrixWorld); m.renderOrder = 3; marks.add(m);
    }
    if (picks.length === 1) say(G.label(G.describe(pick), unitName), CAD.has(ext) ? 'Pick another face or point to measure between.' : 'Pick another point.');
    else {
      const m = G.measure(picks[0], picks[1]);
      if (m.kind === 'points') {
        const g = new T.BufferGeometry().setFromPoints([new T.Vector3(...picks[0].point), new T.Vector3(...picks[1].point)]);
        const l = new T.LineSegments(g, lineMat); l.renderOrder = 9; marks.add(l);
      }
      say(G.label(m, unitName), 'Pick again to start over.');
    }
    draw();
  }

  // ---- Parts: the assembly's tree; a click lights a part up, the box shows or hides it, Only shows just it
  let lit = null;
  function light(obj) {
    const set = (o, on) => o.traverse((n) => { if (n.isMesh) for (const m of [].concat(n.material)) if (m.emissive) m.emissive.setHex(on ? 0xa87a1c : 0); });
    if (lit) set(lit, false);
    lit = obj && obj !== lit ? obj : null;
    if (lit) set(lit, true);
    for (const row of partsList.children) row.classList.toggle('on', row.obj === lit);
    const row = [...partsList.children].find((r) => r.obj === lit);
    if (row) row.scrollIntoView({ block: 'nearest' });
    draw();
  }
  const partsList = h('div', { class: 'pv-parts-list', 'data-testid': 'pv-parts-list' });
  const partsBox = h('div', { class: 'pv-parts', 'data-testid': 'pv-parts', hidden: true },
    h('div', { class: 'pv-parts-head' }, h('strong', null, 'Parts'), btn('Show all', () => { setVis(group, true); syncBoxes(); draw(); })),
    partsList);
  // parts only: the Edges and Section buttons own the edge lines and the stencil helper meshes
  function setVis(root, v) { root.traverse((x) => { if (!x.isLineSegments && !(cut.stencils || []).includes(x)) x.visible = v; }); }
  function syncBoxes() { for (const row of partsList.children) row.box.checked = row.obj.visible; }
  function buildParts() {
    const rows = [];
    let n = 0;
    const walk = (o, depth) => {
      if (rows.length > 2000) return;
      // a solid with no name of its own ("SOLID", or none) is its group's, numbered
      const generic = !o.name || /^(solid|body|shape|part|mesh)\s*\d*$/i.test(o.name) || /open cascade/i.test(o.name);
      const named = o.isMesh && generic ? (o.parent && o.parent !== group && o.parent.name ? o.parent.name + ' · ' : '') + 'solid ' + ++n
        : o.name || '';
      const shown = o !== group && (o.isMesh || (named && o.children.some((c) => c.isMesh || c.isGroup || c.isObject3D)));
      // Section's hidden helper meshes are not parts
      const real = (c) => !(cut.stencils || []).includes(c);
      const kids = o.children.filter((c) => real(c) && (c.isMesh || (c.isGroup || c.type === 'Object3D')));
      // a part that's its named group's only one is that group's row
      const alone = o.isMesh && o.parent && o.parent !== group && o.parent.name && o.parent.children.filter((c) => real(c) && (c.isMesh || c.isGroup)).length === 1;
      if (shown && !alone) {
        const box = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Show ' + named, onchange: () => { o.visible = box.checked; draw(); } });
        const row = h('div', { class: 'pv-part' }, box,
          h('button', { type: 'button', class: 'pv-part-name', title: named, style: 'padding-left:' + (depth * 12) + 'px', onclick: () => light(o) }, named),
          h('button', { type: 'button', class: 'pv-part-only', onclick: () => {
            setVis(group, false);
            setVis(o, true);
            for (let p = o.parent; p; p = p.parent) p.visible = true;
            syncBoxes(); draw();
          } }, 'Only'));
        row.obj = o; row.box = box;
        rows.push(row);
        depth++;
      }
      for (const c of kids) if (!c.isLineSegments) walk(c, depth);
    };
    walk(group, 0);
    partsList.replaceChildren(...rows);
  }

  // ---- clicks on the model (a press without a drag): measure, or pick a part
  let down = null, mode = null;
  const onDown = (e) => { down = e.button === 0 ? [e.clientX, e.clientY] : null; };
  const onUp = (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    down = null;
    const hit = pickAt(e);
    if (mode === 'measure') { if (hit) measurePick(hit); }
    else if (!partsBox.hidden) {
      let o = hit ? hit.object : null;
      // the part's row may be its group's
      while (o && ![...partsList.children].some((r) => r.obj === o)) o = o.parent;
      light(o);
    }
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  put(() => { canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); });

  // ---- the buttons
  const toggle = (label, fn) => {
    const b = btn(label, () => { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); fn(on); }, { 'aria-pressed': 'false' });
    return b;
  };
  const viewsRow = h('div', { class: 'pv-views', hidden: true },
    ['Iso', 'Front', 'Top', 'Right'].map((v) => btn(v, () => fit(v))),
    toggle('Ortho', (on) => useCamera(on)));
  const sectionRow = h('div', { class: 'pv-section', hidden: true },
    ['X', 'Y', 'Z'].map((a, i) => btn(a, () => { cut.axis = i; markAxis(); placeCut(); }, { 'data-axis': String(i) })),
    h('input', { type: 'range', min: '0', max: '1', step: '0.002', value: '0.5', 'aria-label': 'Where the cut is',
      oninput: (e) => { cut.at = Number(e.target.value); placeCut(); } }),
    btn('Flip', () => { cut.flip = !cut.flip; placeCut(); }));
  const markAxis = () => { for (const b of sectionRow.querySelectorAll('[data-axis]')) b.setAttribute('aria-pressed', String(Number(b.dataset.axis) === cut.axis)); };
  markAxis();
  const tools = [
    btn('Fit', () => fit()),
    toggle('Views', (on) => { viewsRow.hidden = !on; }),
    toggle('Edges', (on) => { if (!edges) makeEdges(); edges.forEach((l) => { l.visible = on; }); draw(); }),
    toggle('X-ray', xray),
    toggle('Section', (on) => { sectionRow.hidden = !on; section(on); }),
    toggle('Measure', (on) => {
      mode = on ? 'measure' : null;
      canvas.style.cursor = on ? 'crosshair' : '';
      if (on) say(START); else { readout.hidden = true; picks = []; clearMarks(); draw(); }
    }),
    meshes.length > 1 ? toggle('Parts', (on) => { partsBox.hidden = !on; if (on && !partsList.children.length) buildParts(); if (!on) light(null); }) : null,
    // Snap (TODO 10c): the canvas is read right after the render in this one handler, so the buffer needs no preserveDrawingBuffer
    opts.snap ? btn('Snap', () => { renderer.render(scene, camera); canvas.toBlob((b) => { if (b) opts.snap(b, canvas.width, canvas.height); }, 'image/png'); }, { title: 'Put this view on the drawing', 'data-testid': 'pv-snap' }) : null
  ];

  const fmt = (n) => G.fmtLength(n);
  body.replaceChildren(canvas,
    h('div', { class: 'pv-float' }, h('div', { class: 'pv-tools' }, tools), viewsRow, sectionRow),
    readout, partsBox,
    h('div', { class: 'pv-info', 'data-testid': 'pv-info' }, fmt(size.x) + ' × ' + fmt(size.y) + ' × ' + fmt(size.z) + (unitName ? ' ' + unitName : '')
      + (tris ? ' · ' + Math.round(tris).toLocaleString('en') + ' triangles' : '')));
  watchSize(body, (cw, ch) => {
    if (!cw || !ch) return;
    renderer.setSize(cw, ch, false);
    aspect = cw / ch;
    persp.aspect = aspect; persp.updateProjectionMatrix();
    flatFrame(camera.position.distanceTo(controls.target)); ortho.updateProjectionMatrix();
    if (!controls.userChanged) { fit(); } else draw();
  }, put);
  controls.addEventListener('start', () => { controls.userChanged = true; });
}

/** A STEP file's parts tree as three.js groups; each mesh keeps its faces (triangle runs) for picking and edges. */
function cadTree(T, r, metal) {
  const meshes = r.meshes.map((m) => {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(m.position, 3));
    if (m.normal) g.setAttribute('normal', new T.BufferAttribute(m.normal, 3));
    g.setIndex(new T.BufferAttribute(m.index, 1));
    if (!m.normal) g.computeVertexNormals();
    const faces = m.brep_faces || [];
    let mat = metal;
    if (faces.some((f) => f.color)) {               // faces coloured in the file: each its own
      const base = m.color || [0.667, 0.698, 0.741], col = new Float32Array(m.position.length);
      for (let i = 0; i < col.length; i += 3) col.set(base, i);
      for (const f of faces) {
        if (!f.color) continue;
        for (let t = f.first; t <= f.last; t++) for (let k = 0; k < 3; k++) col.set(f.color, m.index[t * 3 + k] * 3);
      }
      g.setAttribute('color', new T.BufferAttribute(col, 3));
      mat = new T.MeshStandardMaterial({ vertexColors: true, metalness: 0.2, roughness: 0.5, side: T.DoubleSide });
    } else if (m.color) mat = new T.MeshStandardMaterial({ color: new T.Color(m.color[0], m.color[1], m.color[2]), metalness: 0.2, roughness: 0.5, side: T.DoubleSide });
    const mesh = new T.Mesh(g, mat);
    mesh.name = m.name || '';
    mesh.userData.faces = faces;
    return mesh;
  });
  const node = (n) => {
    const g = new T.Group();
    g.name = n.name || '';
    for (const i of n.meshes || []) if (meshes[i]) g.add(meshes[i]);
    for (const c of n.children || []) g.add(node(c));
    return g;
  };
  return node(r.root || { meshes: meshes.map((_, i) => i), children: [] });
}

/** A STEP / IGES / BREP file as triangles: from this device's store when read before, else read in the worker. root.dataset.cache says which. */
async function readCad(bytes, ext, put, root) {
  const key = await digest(bytes, ext);
  const kept = key && await store('get', key);
  root.dataset.cache = kept ? 'hit' : 'miss';
  if (kept) return kept.result;
  const r = await inWorker(bytes, ext, put);
  if (r && key) store('put', key, { result: r, at: Date.now() });
  return r;
}

async function digest(bytes, extra) {
  try {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return 'v1:' + extra + ':' + [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

/** This device's store of read models (IndexedDB): the 12 last opened. `ages` (key → last opened, ms) is
 *  its own store, so eviction never loads a model. Any failure is just a miss. */
const KEEP_MODELS = 12;
function store(op, key, value) {
  return new Promise((done) => {
    let req;
    try { req = indexedDB.open('project-d-3d', 1); } catch { done(null); return; }
    req.onupgradeneeded = () => {
      for (const n of ['models', 'ages']) if (!req.result.objectStoreNames.contains(n)) req.result.createObjectStore(n);
    };
    req.onerror = () => done(null);
    req.onblocked = () => done(null);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction(['models', 'ages'], 'readwrite');
        const os = tx.objectStore('models'); const ages = tx.objectStore('ages');
        let out = null;
        if (op === 'get') {
          const g = os.get(key);
          g.onsuccess = () => { out = g.result || null; if (out) ages.put(Date.now(), key); };
        } else {
          os.put(value, key); ages.put(value.at, key);
          // the oldest go, past the last KEEP_MODELS; a model with no age counts as 0
          const mk = os.getAllKeys(); const ak = ages.getAllKeys(); const av = ages.getAll();
          av.onsuccess = () => {
            const age = new Map(ak.result.map((k, i) => [k, av.result[i]]));
            const have = new Set(mk.result);
            for (const k of ak.result) if (!have.has(k)) ages.delete(k);
            const old = [...mk.result].sort((a, b) => (age.get(a) || 0) - (age.get(b) || 0));
            for (const k of old.slice(0, Math.max(0, old.length - KEEP_MODELS))) { os.delete(k); ages.delete(k); }
          };
        }
        tx.oncomplete = () => { db.close(); done(out); };
        tx.onerror = tx.onabort = () => { db.close(); done(null); };
      } catch { db.close(); done(null); }
    };
  });
}

/** A STEP / IGES / BREP file as triangles, read off the page's thread (occt-worker.js, the only file that loads the LGPL reader). */
function inWorker(bytes, ext, put) {
  return new Promise((ok, no) => {
    const w = new Worker(new URL('./occt-worker.js', import.meta.url), { type: 'module' });
    put(() => w.terminate());
    w.onmessage = (e) => {
      w.terminate();
      if (e.data.ok) ok(e.data.result); else no(sorry('Couldn\'t read this 3D file.'));
    };
    w.onerror = (e) => { e.preventDefault(); w.terminate(); no(new Error(e.message || 'worker failed')); };
    w.postMessage({ bytes, ext, fine: false }, [bytes]);
  });
}
