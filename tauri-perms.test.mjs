// Every Tauri dialog / fs / window call the web code makes has its permission in src-tauri/capabilities/default.json.   node tauri-perms.test.mjs
// The browser tests use a hand-written fake of the Tauri API, so a missing permission would pass them and fail only in the exe.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const caps = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8')).permissions.filter((p) => typeof p === 'string');
const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const files = readdirSync('web').filter((f) => f.endsWith('.js'));
const needed = new Map();                 // permission → the files that need it
for (const f of files) {
  const src = readFileSync('web/' + f, 'utf8');
  for (const m of src.matchAll(/\bt\.(dialog|fs)\.([a-zA-Z]+)/g)) {
    const perm = `${m[1]}:allow-${kebab(m[2])}`;
    if (!needed.has(perm)) needed.set(perm, new Set());
    needed.get(perm).add(f);
  }
  if (/\bw\.destroy\(/.test(src)) needed.set('core:window:allow-destroy', new Set([f]));
}

let n = 0;
for (const [perm, who] of needed) {
  assert.ok(caps.includes(perm), `${perm} is used by ${[...who].join(', ')} but is not in default.json`);
  n++;
}
assert.ok(needed.size >= 8, 'the scan found the calls (' + needed.size + ')');
console.log(n + ' Tauri permissions checked');
