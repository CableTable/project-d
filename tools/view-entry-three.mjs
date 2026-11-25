// The 3D viewer's pieces, bundled into web/vendor/three/three-view.js (npm run vendor): three.js with its
// orbit controls and the file loaders (STL, OBJ, PLY, glTF/GLB, 3MF); the flat (orthographic) camera, picking (Raycaster),
// and the section's cut and its filled face (a clipping plane, stencil). Only these names are kept.
export {
  WebGLRenderer, Scene, PerspectiveCamera, Color, HemisphereLight, DirectionalLight, Mesh, MeshStandardMaterial,
  BufferGeometry, BufferAttribute, Float32BufferAttribute, Box3, Vector3, Group, EdgesGeometry, LineSegments,
  LineBasicMaterial, GridHelper, Points, PointsMaterial, Line, LineLoop, SkinnedMesh, DoubleSide, SRGBColorSpace,
  OrthographicCamera, Raycaster, Vector2, Plane, PlaneGeometry, SphereGeometry, MeshBasicMaterial, FrontSide, BackSide,
  AlwaysStencilFunc, NotEqualStencilFunc, IncrementWrapStencilOp, DecrementWrapStencilOp, ReplaceStencilOp
} from 'three';
export { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
export { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
export { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
export { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
export { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
