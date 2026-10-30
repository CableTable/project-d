// node tools/base-check.mjs <base-sha> <test-file> [step]: does this test fail on the code before the change?
// Runs ONLY that test file (copied from the current tree) on a scratch worktree at the base, prints PASS or FAIL, removes the worktree.
// A new test should print FAIL here (it catches what the change fixed) and PASS on the head. Exit 0 on PASS, 1 on FAIL or an error.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHA = /^[0-9a-f]{7,40}$/i;
const USAGE = 'usage: node tools/base-check.mjs <base-sha> <test-file> [step]';

// The command that runs the file: browser.test.mjs takes a port and an optional step regex, any other test file runs under node --test.
export function testCommand(file, step) {
  return file === 'browser.test.mjs' ? [process.execPath, [file, '5391', ...(step ? [step] : [])]] : [process.execPath, ['--test', file]];
}

export function parseArgs(args) {
  const [sha, file, step] = args;
  if (!sha || !file || args.length > 3) throw new Error(USAGE);
  if (!SHA.test(sha)) throw new Error(`not a commit id: ${sha}`);
  if (/^([a-z]:|[\\/])|(^|[\\/])\.\.([\\/]|$)/i.test(file)) throw new Error(`test file must be a path inside the repo: ${file}`);
  if (step && file !== 'browser.test.mjs') throw new Error('a step only applies to browser.test.mjs');
  return { sha, file, step };
}

function check(args) {
  const { sha, file, step } = parseArgs(args);
  if (!existsSync(join(REPO, file))) throw new Error(`test file not found: ${file}`);
  const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', stdio: 'pipe' }).trim();
  const wt = join(mkdtempSync(join(tmpdir(), 'base-check-')), 'wt');
  let added = false;
  try {
    git('worktree', 'add', '--detach', wt, sha);
    added = true;
    // The dependencies are the current tree's: a junction, so no npm ci
    symlinkSync(join(REPO, 'node_modules'), join(wt, 'node_modules'), 'junction');
    mkdirSync(dirname(join(wt, file)), { recursive: true });
    copyFileSync(join(REPO, file), join(wt, file));
    const [bin, argv] = testCommand(file, step);
    const { NODE_TEST_CONTEXT, ...env } = process.env; // inside a node --test run the inner node --test would exit 0 whatever it found
    return spawnSync(bin, argv, { cwd: wt, env, stdio: 'inherit' }).status === 0;
  } finally {
    try { rmSync(join(wt, 'node_modules'), { force: true }); } catch { /* not linked yet */ } // the link only, never the repo's modules
    if (added) { try { git('worktree', 'remove', '--force', wt); } catch { /* pruned below */ } }
    rmSync(dirname(wt), { recursive: true, force: true });
    try { git('worktree', 'prune'); } catch { /* best effort */ }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.on('SIGINT', () => {});
  try {
    const ok = check(process.argv.slice(2));
    console.log(ok ? 'PASS' : 'FAIL');
    process.exitCode = ok ? 0 : 1;
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
