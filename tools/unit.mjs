// Runs every *.test.mjs in the repo folder except browser.test.mjs, plus tools/browser-lint.test.mjs (browser flows run separately).
// `--skip <file>` leaves one unit file out (a sandbox where base-check.test.mjs stalls); an unknown name is an error.
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT, ROOT } from './kit.mjs';

const base = (f) => f.slice(f.lastIndexOf('/') + 1); // `--skip base-check.test.mjs` also names kit/base-check.test.mjs

// The unit files to run: `all` without the `--skip` names in `argv`; throws a message for a bad flag or an unknown name.
export function unitFiles(all, argv) {
  const skip = [];
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] !== '--skip' || !argv[i + 1]) throw new Error('usage: node tools/unit.mjs [--skip <file>]...');
    if (!all.some((f) => f === argv[i + 1] || base(f) === argv[i + 1])) throw new Error(`--skip: no unit file named ${argv[i + 1]}`);
    skip.push(argv[i + 1]);
  }
  return all.filter((f) => !skip.includes(f) && !skip.includes(base(f)));
}

// TODO 219c: the kit's test files while the kit folder is inside the repo; none once hq.json "kit" points outside it (the kit runs them with `node kit/test.mjs`).
export function kitTests(root, kit, list = (d) => (existsSync(d) ? readdirSync(d) : [])) { // a kit folder that is not there (kit/ removed, "kit" unset) has no tests
  const rel = relative(root, kit).replaceAll('\\', '/');
  return !rel || rel.startsWith('..') || isAbsolute(rel) ? [] : list(kit).filter((f) => f.endsWith('.test.mjs')).map((f) => `${rel}/${f}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const all = readdirSync('.').filter((f) => f.endsWith('.test.mjs') && f !== 'browser.test.mjs').concat('tools/browser-lint.test.mjs', kitTests(ROOT, KIT)).sort();
  let files;
  try { files = unitFiles(all, process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
  const r = spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...files], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
