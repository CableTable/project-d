// web/viewers.js: the mesh loaders behind the 3D viewer, run on the vendored three.js (the part that needs no WebGL).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMesh, MESH_KINDS } from './web/viewers.js';

const T = await import('./web/vendor/three/three-view.js');
const metal = new T.MeshStandardMaterial();
const blobOf = (text) => new Blob([text]);
const meshes = (group) => { const out = []; group.traverse((n) => { if (n.isMesh) out.push(n); }); return out; };
const box = (group) => new T.Box3().setFromObject(group);

test('the viewer opens STL, OBJ, PLY, GLB, glTF and 3MF', () => {
  assert.deepEqual(MESH_KINDS, ['stl', 'obj', 'ply', 'glb', 'gltf', '3mf']);
});

test('an ASCII STL: the sample bracket is 40 × 30 × 30 with 24 triangles', async () => {
  const g = await loadMesh(T, 'stl', new Blob([readFileSync('fixtures/sample.stl')]), metal);
  const [m] = meshes(g);
  assert.equal(meshes(g).length, 1);
  assert.equal(m.geometry.getAttribute('position').count / 3, 24);
  assert.deepEqual(box(g).getSize(new T.Vector3()).toArray(), [40, 30, 30]);
});

test('an OBJ: two triangles of a square, normals made when the file has none, the metal material', async () => {
  const g = await loadMesh(T, 'obj', blobOf('o sq\nv 0 0 0\nv 4 0 0\nv 4 3 0\nv 0 3 0\nf 1 2 3\nf 1 3 4\n'), metal);
  const [m] = meshes(g);
  assert.equal(m.geometry.getAttribute('position').count, 6);
  assert.ok(m.geometry.getAttribute('normal'), 'normals');
  assert.equal(m.material, metal);
  assert.deepEqual(box(g).getSize(new T.Vector3()).toArray(), [4, 3, 0]);
});

test('an ASCII PLY: a quad of two faces is a mesh with 6 indices; with colours it gets vertex colours', async () => {
  const ply = (colour) => 'ply\nformat ascii 1.0\nelement vertex 4\nproperty float x\nproperty float y\nproperty float z\n'
    + (colour ? 'property uchar red\nproperty uchar green\nproperty uchar blue\n' : '')
    + 'element face 2\nproperty list uchar int vertex_index\nend_header\n'
    + ['0 0 0', '5 0 0', '5 2 0', '0 2 0'].map((v) => v + (colour ? ' 255 0 0' : '')).join('\n') + '\n3 0 1 2\n3 0 2 3\n';
  const plain = (await loadMesh(T, 'ply', blobOf(ply(false)), metal));
  assert.equal(meshes(plain)[0].geometry.index.count, 6);
  assert.equal(meshes(plain)[0].material, metal);
  assert.deepEqual(box(plain).getSize(new T.Vector3()).toArray(), [5, 2, 0]);
  const coloured = meshes(await loadMesh(T, 'ply', blobOf(ply(true)), metal))[0];
  assert.ok(coloured.geometry.getAttribute('color') && coloured.material.vertexColors, 'vertex colours');
});

test('a PLY of points only is drawn as points, not a mesh', async () => {
  const g = await loadMesh(T, 'ply', blobOf('ply\nformat ascii 1.0\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 1 1\n'), metal);
  assert.equal(meshes(g).length, 0);
  let points = 0; g.traverse((n) => { if (n.isPoints) points++; });
  assert.equal(points, 1);
});

test('a broken OBJ with no faces is an empty group the viewer then refuses', async () => {
  const g = await loadMesh(T, 'obj', blobOf('o nothing\n'), metal);
  assert.equal(meshes(g).length, 0);
});
