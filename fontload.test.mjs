// fontload.js — loadFont with a stubbed window.__TAURI__ and fetch.   node fontload.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fontFiles } from './web/textoutline.js';
import { loadFont } from './web/fontload.js';

const bytes = readFileSync('web/vendor/fonts/LiberationSans-Regular.ttf');
let reads = 0, fetches = 0, winOk = false;
globalThis.window = { __TAURI__: { fs: { readFile: async (p) => { reads++; if (!winOk || !p.endsWith(fontFiles('Arial', false)[0])) throw new Error('nope'); return bytes; } } } };
globalThis.fetch = async () => { fetches++; return { ok: true, arrayBuffer: async () => bytes }; };

let n = 0;
async function test(name, fn) { await fn(); n++; console.log('ok', name); }

await test('a failed Windows read falls back to Liberation Sans and is not cached', async () => {
  const a = await loadFont('Arial', false);
  assert.equal(a.fallback, true); assert.equal(a.name, 'Liberation Sans'); assert.equal(a.wanted, 'Arial');
  const r1 = reads; assert.equal(fetches, 1);
  winOk = true;
  const b = await loadFont('Arial', false);          // Windows readable now: tried again, not the stale fallback
  assert.equal(b.fallback, false); assert.ok(reads > r1);
});
await test('a font read from Windows is cached', async () => {
  const r = reads, f = fetches;
  const c = await loadFont('Arial', false);
  assert.equal(c.fallback, false); assert.equal(reads, r); assert.equal(fetches, f);
});
await test('no Tauri: the fallback; a missing bundled file throws', async () => {
  delete globalThis.window.__TAURI__;
  assert.equal((await loadFont('Mono', true)).fallback, true);
  globalThis.fetch = async () => ({ ok: false });
  await assert.rejects(loadFont('Mono', true), /no font/);
});
await test('MTEXT bold uses the bundled bold face; if absent, regular is marked for the result note', async () => {
  const bold = readFileSync('web/vendor/fonts/LiberationSans-Bold.ttf'), paths = [];
  globalThis.fetch = async (p) => { paths.push(p); return { ok: true, arrayBuffer: async () => bold }; };
  const face = await loadFont('Standard', true);
  assert.match(face.font.names.fontSubfamily.en, /Bold/);
  assert.equal(face.regularForBold, false); assert.ok(paths[0].endsWith('Bold.ttf'));
  globalThis.fetch = async (p) => ({ ok: p.endsWith('Regular.ttf'), arrayBuffer: async () => bytes });
  const regular = await loadFont('Standard', true);
  assert.equal(regular.regularForBold, true);
  assert.match(regular.font.names.fontSubfamily.en, /Regular/);
});
console.log(n + ' tests');
