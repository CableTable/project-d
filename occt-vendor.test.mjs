// TODO 10b1 (grill F3): occt-import-js is LGPL-2.1, so it stays in its own replaceable files (web/vendor/occt/) that only
// web/occt-worker.js loads at runtime; none of the app's own files holds a copy of it.   node --test occt-vendor.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const OCCT_ONLY = /emscripten_get_callstack|emscripten_source_map/;     // Emscripten glue: in the library, in nothing of ours
const own = [];                                                          // every text file under web/ outside web/vendor/occt/
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = dir + '/' + e.name;
    if (p === 'web/vendor/occt') continue;
    if (e.isDirectory()) walk(p); else if (/\.(js|mjs|html|css)$/.test(e.name)) own.push(p);
  }
})('web');

test('the symbol marks the vendored library (so the check below can fail)', () => {
  assert.match(readFileSync('web/vendor/occt/occt.js', 'utf8'), OCCT_ONLY);
});

test('no file under web/ outside web/vendor/occt/ contains occt code', () => {
  assert.ok(own.includes('web/app.js') && own.includes('web/occt-worker.js'), 'the walk found the app files');
  assert.deepEqual(own.filter((f) => OCCT_ONLY.test(readFileSync(f, 'utf8'))), []);
});

test('the worker loads the reader from vendor/occt/ at runtime; the library ships with its LGPL text and wasm', () => {
  const w = readFileSync('web/occt-worker.js', 'utf8');
  assert.match(w, /from '\.\/vendor\/occt\/occt\.js'/);
  assert.match(w, /new URL\('\.\/vendor\/occt\/' \+ f, import\.meta\.url\)/);
  assert.doesNotMatch(readFileSync('web/viewers.js', 'utf8'), /vendor\/occt/, 'only the worker names the library');
  assert.ok(existsSync('web/vendor/occt/occt-import-js.wasm'));
  assert.match(readFileSync('web/vendor/occt/LICENSE', 'utf8'), /GNU LESSER GENERAL PUBLIC LICENSE\s+Version 2\.1/);
});
