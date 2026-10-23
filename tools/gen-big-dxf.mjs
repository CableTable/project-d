// Writes a synthetic DXF of N mixed entities (LINE, ARC, CIRCLE, LWPOLYLINE, TEXT, a few INSERTs) for the big-file checks (TODO 55).
//   node tools/gen-big-dxf.mjs <out.dxf> [count=100000]     (the DXF is not committed: write it to a temp folder)
import { writeFileSync } from 'node:fs';
import { newDoc, addBlock, addEntities, line, arc, circle, lwpoly, text, insert, writeDxf } from '../web/dxf-write.js';

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

if (process.argv[1] && process.argv[1].endsWith('gen-big-dxf.mjs')) {
  const out = process.argv[2];
  if (!out) { console.error('usage: node tools/gen-big-dxf.mjs <out.dxf> [count]'); process.exit(1); }
  writeFileSync(out, writeDxf(bigDoc(Number(process.argv[3]) || 100000)));
  console.log('wrote', out);
}
