// Writes a synthetic DXF of N mixed entities (LINE, ARC, CIRCLE, LWPOLYLINE, TEXT, a few INSERTs) for the big-file checks (TODO 55).
//   node tools/gen-big-dxf.mjs <out.dxf> [count=100000]     (the DXF is not committed: write it to a temp folder)
//   node tools/gen-big-dxf.mjs spline <out.dxf> [count=900]  (T76 / T78 spline-heavy fixture)
import { writeFileSync } from 'node:fs';
import { newDoc, addLayer, addBlock, addEntities, entity, line, arc, circle, lwpoly, text, insert, writeDxf } from '../web/dxf-write.js';

/** The document: one entity per ~10 mm cell on a square grid, so the drawing is about sqrt(n) * 10 mm wide. */
export function bigDoc(n = 100000) {
  const doc = newDoc(4), cols = Math.ceil(Math.sqrt(n)), ents = [];
  addBlock(doc, 'BOLT', [circle(0, 0, 2), line(-3, 0, 3, 0), line(0, -3, 0, 3)]);
  for (let i = 0; i < n; i++) {
    const x = (i % cols) * 10, y = Math.floor(i / cols) * 10;
    switch (i % 6) {
      case 0: ents.push(line(x, y, x + 8, y + 5)); break;
      case 1: ents.push(arc(x + 4, y + 4, 3, 0, 270)); break;
      case 2: ents.push(circle(x + 4, y + 4, 3)); break;
      case 3: ents.push(lwpoly([[x, y], [x + 8, y], [x + 8, y + 6], [x + 3, y + 8]], { closed: true })); break;
      case 4: ents.push(text(x, y, 2.5, 'T' + i)); break;
      default: ents.push(i % 600 === 5 ? insert('BOLT', x + 4, y + 4) : line(x, y + 8, x + 8, y));
    }
  }
  return addEntities(doc, ents);
}

/** T76 / T78 shape: closed cubic splines with 38 controls, ten polylines, three unused block definitions, two layers. */
export function splineDoc(n = 900) {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError('spline count must be a positive integer');
  const doc = newDoc(4), cols = Math.ceil(Math.sqrt(n)), ents = [];
  addLayer(doc, 'Profiles', { aci: 7 });
  for (let i = 0; i < 3; i++) addBlock(doc, 'PROFILE_' + (i + 1), [circle(0, 0, i + 1)]);
  for (let i = 0; i < n; i++) {
    const x = (i % cols) * 10 + 4, y = Math.floor(i / cols) * 10 + 4;
    // Repeat the first three controls to close a periodic cubic without a seam.
    const cp = Array.from({ length: 38 }, (_, j) => {
      const a = (j % 35) * Math.PI * 2 / 35, r = 3.5 + .4 * Math.cos(3 * a + i % 3);
      return [[10, x + r * Math.cos(a)], [20, y + r * Math.sin(a)], [30, 0]];
    });
    ents.push(entity('SPLINE', [[70, 3], [71, 3], [72, 42], [73, 38], [74, 0],
      ...Array.from({ length: 42 }, (_, j) => [40, j]), ...cp.flat()], { layer: i % 2 ? 'Profiles' : '0' }));
  }
  for (let i = 0; i < 10; i++) {
    const x = i * 10;
    ents.push(lwpoly([[x, -10], [x + 8, -10], [x + 8, -4], [x, -4]], { closed: true, layer: i % 2 ? 'Profiles' : '0' }));
  }
  return addEntities(doc, ents);
}

if (process.argv[1] && process.argv[1].endsWith('gen-big-dxf.mjs')) {
  const spline = process.argv[2] === 'spline', out = process.argv[spline ? 3 : 2], count = process.argv[spline ? 4 : 3];
  if (!out) { console.error('usage: node tools/gen-big-dxf.mjs [spline] <out.dxf> [count]'); process.exit(1); }
  writeFileSync(out, writeDxf(spline ? splineDoc(count === undefined ? 900 : Number(count)) : bigDoc(Number(count) || 100000)));
  console.log('wrote', out);
}
