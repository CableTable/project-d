// Runs every *.test.mjs in the repo folder except browser.test.mjs, plus tools/browser-lint.test.mjs (browser flows run separately).
// `--skip <file>` leaves one unit file out (a sandbox where base-check.test.mjs stalls); an unknown name is an error.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The unit files to run: `all` without the `--skip` names in `argv`; throws a message for a bad flag or an unknown name.
export function unitFiles(all, argv) {
  const skip = [];
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] !== '--skip' || !argv[i + 1]) throw new Error('usage: node tools/unit.mjs [--skip <file>]...');
    if (!all.includes(argv[i + 1])) throw new Error(`--skip: no unit file named ${argv[i + 1]}`);
    skip.push(argv[i + 1]);
  }
  return all.filter((f) => !skip.includes(f));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const all = readdirSync('.').filter((f) => f.endsWith('.test.mjs') && f !== 'browser.test.mjs').concat('tools/browser-lint.test.mjs').sort();
  let files;
  try { files = unitFiles(all, process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
  const r = spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...files], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
