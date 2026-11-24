// The STEP / IGES / BREP reader, off the page's thread (viewers.js): OpenCascade turns the file into triangles
// here, so a big assembly doesn't freeze the page while it reads. One file per message:
//   in:  { bytes: ArrayBuffer, ext, fine }      out: { ok: true, result } | { ok: false }
// The result is occt-import-js's (meshes, their faces, the parts tree), its arrays made typed and handed over.
// The reader (LGPL-2.1) lives in vendor/occt/ and is only loaded here, at runtime: replace those files to use another build.

import { occtimportjs } from './vendor/occt/occt.js';

const READERS = { step: 'ReadStepFile', stp: 'ReadStepFile', iges: 'ReadIgesFile', igs: 'ReadIgesFile', brep: 'ReadBrepFile' };
let lib = null;

self.onmessage = async (e) => {
  const { bytes, ext, fine } = e.data;
  try {
    if (!lib) lib = await occtimportjs({ locateFile: (f) => new URL('./vendor/occt/' + f, import.meta.url).href });
    // in millimetres; "fine" halves the facets' size, and more again on curves
    const r = lib[READERS[ext]](new Uint8Array(bytes), {
      linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio',
      linearDeflection: fine ? 0.0003 : 0.001, angularDeflection: fine ? 0.2 : 0.5
    });
    if (!r || !r.success) { self.postMessage({ ok: false }); return; }
    const moved = [];
    for (const m of r.meshes) {
      m.position = Float32Array.from(m.attributes.position.array);
      m.normal = m.attributes.normal ? Float32Array.from(m.attributes.normal.array) : null;
      m.index = Uint32Array.from(m.index.array);
      delete m.attributes;
      moved.push(m.position.buffer, m.index.buffer);
      if (m.normal) moved.push(m.normal.buffer);
    }
    self.postMessage({ ok: true, result: { root: r.root, meshes: r.meshes } }, moved);
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.message || err) });
  }
};
