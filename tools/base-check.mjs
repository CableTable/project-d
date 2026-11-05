// node tools/base-check.mjs <base-sha> <test-file> [step]: does this test fail on the code before the change?
// Runs ONLY that test file (copied from the current tree) on a scratch worktree at the base, prints PASS or FAIL, removes the worktree.
// A new test should print FAIL here (it catches what the change fixed) and PASS on the head. Exit 0 on PASS, 1 on FAIL or an error.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHA = /^[0-9a-f]{7,40}$/i;
const USAGE = 'usage: node tools/base-check.mjs <base-sha> <test-file> [step] | --link';

export function modulesDir(repo, commonDir, exists = existsSync) {
  const local = join(repo, 'node_modules');
  return exists(local) ? local : resolve(repo, dirname(commonDir), 'node_modules');
}

const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', stdio: 'pipe' }).trim();
const linkModules = (dir) => symlinkSync(modulesDir(REPO, git('rev-parse', '--git-common-dir')), join(dir, 'node_modules'), 'junction');

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

const LIMIT_MS = Number(process.env.BASE_CHECK_LIMIT_MS) || 120000; // the env value is for the HUNG test only
const LOAD_ERROR = /does not provide an export named|Cannot find module/;

// Runs the command, resolves { status, out, timedOut }. `capture` pipes the output (and echoes it); `limitMs` kills the whole process tree.
// The child dies with this process on a normal exit (the 'exit' listener below); after a real kill on Windows no node child was left either (TODO 193a fix run).
// shortcut: a hard kill of this process (Windows runs no handler) leaves the scratch worktree in `git worktree list`; remove it by hand (git worktree remove --force), upgrade only if kills become common.
export function runCapped(bin, argv, { cwd, env, capture = false, limitMs = Infinity }) {
  return new Promise((done) => {
    const win = process.platform === 'win32';
    // Off Windows the child leads its own process group, so one kill reaches its children too (node --test's own child); a detached child gets no terminal Ctrl+C, hence the SIGINT listener.
    const child = spawn(bin, argv, { cwd, env, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', detached: !win });
    let out = '', timedOut = false;
    const kill = () => { if (win) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* the group is gone */ } } };
    const timer = limitMs < Infinity && setTimeout(() => { timedOut = true; kill(); }, limitMs);
    process.prependOnceListener('exit', kill); // before the worktree cleanup: a live child locks its folder
    if (!win) process.on('SIGINT', kill);
    for (const [stream, sink] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) stream?.on('data', (d) => { out += d; sink.write(d); });
    child.on('close', (status) => { clearTimeout(timer); process.removeListener('exit', kill); process.removeListener('SIGINT', kill); done({ status, out, timedOut }); });
  });
}

async function check(args) {
  const { sha, file, step } = parseArgs(args);
  if (!existsSync(join(REPO, file))) throw new Error(`test file not found: ${file}`);
  const wt = join(mkdtempSync(join(tmpdir(), 'base-check-')), 'wt');
  let added = false, cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try { rmSync(join(wt, 'node_modules'), { force: true }); } catch { /* not linked yet */ } // the link only, never the repo's modules
    if (added) { try { git('worktree', 'remove', '--force', wt); } catch { /* pruned below */ } }
    rmSync(dirname(wt), { recursive: true, force: true });
    try { git('worktree', 'prune'); } catch { /* best effort */ }
  };
  process.once('exit', cleanup); // runs on a normal end, an error or process.exit(143); NOT on a Windows kill (no signal handler runs): the worktree stays then
  try {
    git('worktree', 'add', '--detach', wt, sha);
    added = true;
    // Share dependencies through a junction, so no npm ci.
    linkModules(wt);
    mkdirSync(dirname(join(wt, file)), { recursive: true });
    copyFileSync(join(REPO, file), join(wt, file));
    const [bin, argv] = testCommand(file, step);
    const { NODE_TEST_CONTEXT, ...env } = process.env; // inside a node --test run the inner node --test would exit 0 whatever it found
    const browser = file === 'browser.test.mjs'; // the browser run keeps its output and has no time limit
    const r = await runCapped(bin, argv, { cwd: wt, env, capture: !browser, limitMs: browser ? Infinity : LIMIT_MS });
    if (r.timedOut) throw new Error(`HUNG on base after ${LIMIT_MS / 1000} s: a red test must fail, not loop`);
    if (r.status !== 0 && LOAD_ERROR.test(r.out)) throw new Error('LOAD ERROR on base: the new test never ran (its import fails); this is not a red');
    return r.status === 0;
  } finally {
    cleanup();
    process.removeListener('exit', cleanup);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => process.exit(143)); // POSIX only: Windows terminates without calling it
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--link') {
      if (!existsSync(join(process.cwd(), 'node_modules'))) linkModules(process.cwd());
      console.log('node_modules ready');
    } else {
      const ok = await check(args);
      console.log(ok ? 'PASS' : 'FAIL');
      process.exitCode = ok ? 0 : 1;
    }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
