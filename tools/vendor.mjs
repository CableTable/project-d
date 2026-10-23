// Copies the third-party code the page loads into web/vendor/ (not ours, not linted).   node tools/vendor.mjs   (npm run vendor)
// pdf.js (pdfjs-dist, the legacy ES-module build: it runs in WebView2 / Chromium and older): the library and its worker.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const src = 'node_modules/pdfjs-dist/legacy/build/', dst = 'web/vendor/pdfjs/';
mkdirSync(dst, { recursive: true });
for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) copyFileSync(src + f, dst + f);
const v = JSON.parse(readFileSync('node_modules/pdfjs-dist/package.json', 'utf8')).version;
copyFileSync('node_modules/pdfjs-dist/LICENSE', dst + 'LICENSE');
console.log('pdfjs-dist ' + v + ' -> ' + dst);

// imagetracerjs (Unlicense; one classic script that sets window.ImageTracer; pinned to 1.2.6 in package.json): Trace a bitmap.
const tr = 'web/vendor/imagetracer/';
mkdirSync(tr, { recursive: true });
copyFileSync('node_modules/imagetracerjs/imagetracer_v1.2.6.js', tr + 'imagetracer.js');
copyFileSync('node_modules/imagetracerjs/LICENSE', tr + 'LICENSE');
console.log('imagetracerjs ' + JSON.parse(readFileSync('node_modules/imagetracerjs/package.json', 'utf8')).version + ' -> ' + tr);

// opentype.js (MIT; the ES-module build, pinned to 1.3.4 in package.json): reads a font file's glyph outlines for Text to outlines.
const ot = 'web/vendor/opentype/';
mkdirSync(ot, { recursive: true });
copyFileSync('node_modules/opentype.js/dist/opentype.module.js', ot + 'opentype.js');
copyFileSync('node_modules/opentype.js/LICENSE', ot + 'LICENSE');
console.log('opentype.js ' + JSON.parse(readFileSync('node_modules/opentype.js/package.json', 'utf8')).version + ' -> ' + ot);

// Liberation Sans (SIL OFL 1.1, from pdfjs-dist's standard fonts): the fallback font of Text to outlines when a Windows font file cannot be read.
const fo = 'web/vendor/fonts/';
mkdirSync(fo, { recursive: true });
for (const f of ['LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf', 'LICENSE_LIBERATION']) copyFileSync('node_modules/pdfjs-dist/standard_fonts/' + f, fo + f);
console.log('Liberation Sans -> ' + fo);

// polygon-clipping (MIT; its self-contained UMD build wrapped as an ES module, pinned to 0.15.7 in package.json): the boolean maths of Shaping (web/shaping.js).
const pc = 'web/vendor/polygon-clipping/';
mkdirSync(pc, { recursive: true });
writeFileSync(pc + 'polygon-clipping.js', 'const module = { exports: {} }, exports = module.exports;\n' + readFileSync('node_modules/polygon-clipping/dist/polygon-clipping.umd.js', 'utf8') + '\nexport default module.exports;\n');
copyFileSync('node_modules/polygon-clipping/LICENSE.md', pc + 'LICENSE');
console.log('polygon-clipping ' + JSON.parse(readFileSync('node_modules/polygon-clipping/package.json', 'utf8')).version + ' -> ' + pc);
