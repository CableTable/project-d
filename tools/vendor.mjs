// Copies the third-party code the page loads into web/vendor/ (not ours, not linted).   node tools/vendor.mjs   (npm run vendor)
// pdf.js (pdfjs-dist, the legacy ES-module build: it runs in WebView2 / Chromium and older): the library and its worker.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';

const src = 'node_modules/pdfjs-dist/legacy/build/', dst = 'web/vendor/pdfjs/';
mkdirSync(dst, { recursive: true });
for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) copyFileSync(src + f, dst + f);
const v = JSON.parse(readFileSync('node_modules/pdfjs-dist/package.json', 'utf8')).version;
copyFileSync('node_modules/pdfjs-dist/LICENSE', dst + 'LICENSE');
console.log('pdfjs-dist ' + v + ' -> ' + dst);
