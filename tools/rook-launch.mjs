// `node tools/rook.mjs review ...`, `build ...` and `knight ...`: the hand-typed launch commands of WORKFLOW.md in one call each (S28 retro).
// Every check that fails throws an Error whose message says why; nothing is launched after one.
import { execFileSync, execSync, spawn } from 'node:child_process';
import { existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateOps } from './handover-gate.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const EXTRAS = 'E:/Project B/Claude/Project D extras';
const MAIN_GIT = 'E:/Project B/Claude/Project D/.git';
const CODEX = join(homedir(), 'AppData', 'Roaming', 'npm', 'codex.cmd');
const SHA = /^[0-9a-f]{7,40}$/i;
// Two Claude accounts x two roles: the account's launcher and the folder it reviews / builds in.
export const ACCOUNTS = {
  bishop: { bin: 'claude2.cmd', review: 'ProjectD-s15fix', build: 'ProjectD-s15fix' },
  king: { bin: 'claude3.cmd', review: 'ProjectD-king2', build: 'ProjectD-king' },
};

// Positionals first, then flags (name -> number of values). Returns { pos, flags: { name: [values] } } or throws the usage.
function parseFlags(args, spec, usage) {
  const i = args.findIndex((a) => a.startsWith('--'));
  const pos = i < 0 ? args : args.slice(0, i);
  const flags = {};
  for (let j = i < 0 ? args.length : i; j < args.length;) {
    const n = spec[args[j]];
    const vals = args.slice(j + 1, j + 1 + n);
    if (n === undefined || flags[args[j]] || vals.length !== n) throw new Error(usage);
    flags[args[j]] = vals;
    j += n + 1;
  }
  return { pos, flags };
}

function account(flags, def, usage) {
  const as = flags['--as'] ? flags['--as'][0] : def;
  if (!ACCOUNTS[as]) throw new Error(`${usage}\nunknown account: ${as}`);
  return as;
}

// Paths are resolved against the caller's folder: the run's cwd is a worktree or clone, where a relative path would land.
export function parseReview(args) {
  const usage = 'usage: review <sha> <brief file> <out jsonl> [--as bishop|king] [--from <clone folder> <branch>]';
  const { pos, flags } = parseFlags(args, { '--as': 1, '--from': 2 }, usage);
  if (pos.length !== 3) throw new Error(usage);
  if (!SHA.test(pos[0])) throw new Error(`not a commit id: ${pos[0]}`);
  const from = flags['--from'];
  return { sha: pos[0], brief: resolve(pos[1]), out: resolve(pos[2]), as: account(flags, 'bishop', usage), from: from && { clone: resolve(from[0]), branch: from[1] } };
}

export function parseBuild(args) {
  const usage = 'usage: build <brief file> <out jsonl> <branch> <sha> [--as king|bishop] [--dir king2] [--fix] [--over]';
  const { pos, flags } = parseFlags(args, { '--as': 1, '--dir': 1, '--fix': 0, '--over': 0 }, usage);
  if (pos.length !== 4) throw new Error(usage);
  if (!SHA.test(pos[3])) throw new Error(`not a commit id: ${pos[3]}`);
  const as = account(flags, 'king', usage), dir = flags['--dir'] && flags['--dir'][0];
  if (dir && (dir !== 'king2' || as !== 'king')) throw new Error(`${usage}\n--dir king2 is for King (--as king)`);
  return { brief: resolve(pos[0]), out: resolve(pos[1]), branch: pos[2], sha: pos[3], as, dir, fix: !!flags['--fix'], over: !!flags['--over'] };
}

export function parseKnight(args) {
  const usage = 'usage: knight <brief file> <report txt> <branch> <sha> [--fix] [--over]';
  const { pos, flags } = parseFlags(args, { '--fix': 0, '--over': 0 }, usage);
  if (pos.length !== 4) throw new Error(usage);
  const [brief, report, branch, sha] = pos;
  if (!report.endsWith('.txt')) throw new Error(`report must end in .txt (the log goes next to it): ${report}`);
  if (!SHA.test(sha)) throw new Error(`not a commit id: ${sha}`);
  const abs = resolve(report);
  return { brief: resolve(brief), report: abs, branch, sha, log: abs.replace(/\.txt$/, '.log'), fix: !!flags['--fix'], over: !!flags['--over'] };
}

// WORKFLOW.md's reviewer flags, plus the extras folder (the brief lives there).
export const reviewerArgs = (extras = EXTRAS) => ['-p', '--agent', 'reviewer', '--model', 'claude-opus-5-5', '--effort', 'medium',
  '--permission-mode', 'dontAsk', '--max-budget-usd', '6', '--add-dir', extras,
  '--disallowedTools', 'Agent', ...['commit', 'push', 'add', 'checkout', 'switch', 'stash', 'restore', 'pull'].map((g) => `Bash(git ${g}:*)`),
  '--output-format', 'stream-json', '--verbose'];

// WORKFLOW.md's King-build flags (the same for either account): the repo's git folder and the extras folder (the brief lives there).
export const buildArgs = (extras = EXTRAS, gitDir = MAIN_GIT) => ['-p', '--agent', 'builder', '--strict-mcp-config', '--model', 'claude-sonnet-5-5', '--effort', 'high',
  '--permission-mode', 'acceptEdits', '--max-budget-usd', '8', '--add-dir', gitDir, '--add-dir', extras,
  '--disallowedTools', 'Bash(gh pr merge:*)', 'PowerShell(gh pr merge:*)', 'Agent', 'Bash(git push:*)', 'Bash(taskkill:*)', 'PowerShell(Stop-Process:*)',
  '--allowedTools', 'Bash(echo:*)', 'Bash(tee:*)', 'Bash(npx.cmd:*)', 'Bash(npm.cmd:*)', 'PowerShell(Select-String:*)', 'PowerShell(Select-Object:*)',
  'PowerShell(Write-Output:*)', ...['add', 'commit', 'fetch', 'checkout', 'switch', 'cherry-pick', 'rebase', 'apply', 'check-ignore'].map((g) => `Bash(git ${g}:*)`),
  '--output-format', 'stream-json', '--verbose'];

// WORKFLOW.md's Knight-build flags: its clone, the clone's git folder and the Playwright folder.
export const knightArgs = (report, clone = `${EXTRAS}/ProjectD-rowan`, home = homedir().replaceAll('\\', '/')) => ['exec', '-p', 'builder',
  '-C', clone, '--add-dir', `${clone}-git`, '--add-dir', `${home}/AppData/Local/ms-playwright`, '-o', report, '-'];

// Safe words stay bare; everything else (spaces, parentheses, *) goes in double quotes for cmd.exe.
export function commandLine(bin, args) {
  return [bin, ...args].map((a) => {
    if (a.includes('"')) throw new Error(`double quote in argument: ${a}`);
    return /^[\w./:\\=-]+$/.test(a) ? a : `"${a}"`;
  }).join(' ');
}

// A detached cmd.exe loses its redirected output on Windows (tested 2026-10-29), so a detached node holds the handles
// and runs the .cmd under them. The command returns at once and the run goes on. stdin = brief, stdout and stderr = the out file.
// When the run ends it deletes the folder's lock (argv[2]).
const RUN = 'const rm = () => { try { require("fs").unlinkSync(process.argv[2]); } catch {} };'
  + 'require("child_process").spawn(process.argv[1], { shell: true, stdio: "inherit", windowsHide: true }).on("exit", (c) => { rm(); process.exit(c); });';
const lockFile = (dir) => `${dir}/.run-lock`;

// A run that never started must not leave its folder locked.
export function launchFailed(cwd, e, exit = process.exit) {
  try { unlinkSync(lockFile(cwd)); } catch { /* no lock */ }
  console.error(`launch failed: ${e.message}`);
  exit(1);
}

// The command line is built first (it throws on a bad argument), the lock is written last; a throw from the spawn or its 'error' event takes the lock off again.
export function launchRun(bin, args, cwd, inFd, outFd, env, outPath = '', spawnFn = spawn, fail = launchFailed) {
  const line = commandLine(bin, args);
  writeFileSync(lockFile(cwd), `${new Date().toISOString()}\n${outPath}`); // `rook.mjs result` reads the out file's name back
  try {
    const child = spawnFn(process.execPath, ['-e', RUN, line, lockFile(cwd)], { cwd, env, detached: true, windowsHide: true, stdio: [inFd, outFd, outFd] });
    child.on('error', (e) => fail(cwd, e));
    child.unref();
  } catch (e) {
    try { unlinkSync(lockFile(cwd)); } catch { /* no lock */ }
    throw e;
  }
}

// Everything that touches git, npm, files or processes; the tests swap it for a recorder.
const io = {
  git(dir, ...a) {
    try { return execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: 'pipe' }).trim(); }
    catch (e) { throw new Error(`git ${a.join(' ')} failed in ${dir}: ${String(e.stderr || e.message).trim()}`); }
  },
  has(dir, sha) { try { execFileSync('git', ['-C', dir, 'cat-file', '-e', `${sha}^{commit}`], { stdio: 'pipe' }); return true; } catch { return false; } },
  need(path, what) { if (!existsSync(path)) throw new Error(`${what} not found: ${path}`); },
  open: (path, mode) => openSync(path, mode),
  locked: (dir) => existsSync(lockFile(dir)),
  npmCi(dir) {
    try { execSync('npm.cmd ci --silent', { cwd: dir, stdio: 'pipe' }); }
    catch (e) { throw new Error(`npm ci failed in ${dir}: ${String(e.stderr || e.message).trim()}`); }
  },
  launch: (bin, args, cwd, inFd, outFd, env = process.env, outPath) => launchRun(bin, args, cwd, inFd, outFd, env, outPath),
};
// The handover gate (tools/handover-gate.mjs) reads the Rook's files in the extras folder and the session branch in this repo.
io.gate = gateOps({ extras: EXTRAS, read: (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null), write: writeFileSync, git: (...a) => io.git(REPO, ...a) });

const claude = (as) => join(homedir(), '.local', 'bin', ACCOUNTS[as].bin);
const folder = (as, role) => `${EXTRAS}/${ACCOUNTS[as][role]}`;

// "RUNNING (lock since <time>)" while a launch whose out file is `file` has not ended (its folder still has the lock), else ''.
export function runningNote(file, dirs = [...new Set([...Object.values(ACCOUNTS).flatMap((a) => [a.review, a.build]), 'ProjectD-rowan'])].map((d) => `${EXTRAS}/${d}`)) {
  for (const dir of dirs) {
    try {
      const [since, out] = readFileSync(lockFile(dir), 'utf8').split('\n');
      if (out && resolve(out) === resolve(file)) return `RUNNING (lock since ${since})`;
    } catch { /* no lock */ }
  }
  return '';
}

// A folder runs one thing at a time: a second launch would switch the branch under the first.
function needClean(x, dir) {
  x.need(dir, 'folder');
  if (x.locked(dir)) throw new Error(`${dir} is in use by a running launch (${lockFile(dir)}); if that run is dead, delete the lock file`);
  const dirty = x.git(dir, 'status', '--porcelain').split('\n').filter((l) => l && !l.startsWith('??'));
  if (dirty.length) throw new Error(`${dir} has tracked changes (git stash -u -m "<run>" first): ${dirty.join(' | ')}`);
}

export function review(args, x = io) {
  const { sha, brief, out, as, from } = parseReview(args);
  const wt = folder(as, 'review');
  x.need(brief, 'brief file');
  x.need(claude(as), ACCOUNTS[as].bin);
  needClean(x, wt);
  x.need(`${wt}/.claude/agents/reviewer.md`, 'reviewer worktree (.claude/agents/reviewer.md)');
  if (from) x.git(REPO, 'fetch', from.clone, from.branch);
  if (!x.has(REPO, sha)) throw new Error(`commit ${sha} not in the repo${from ? '' : ' (use --from <clone folder> <branch> for a Knight build)'}`);
  x.need(dirname(out), 'output folder');
  const inFd = x.open(brief, 'r');
  x.git(wt, 'switch', '--detach', sha);
  x.npmCi(wt);
  x.launch(claude(as), reviewerArgs(), wt, inFd, x.open(out, 'w'), undefined, out);
  console.log(`review ${sha} (${as}) -> ${out}`);
}

export function build(args, x = io) {
  const { brief, out, branch, sha, as, dir: second, fix, over } = parseBuild(args);
  x.gate.check(fix, over);
  const dir =second ? folder(as, 'review') : folder(as, 'build'); // king2 is King's review folder: needClean refuses it while a review runs
  x.need(brief, 'brief file');
  x.need(claude(as), ACCOUNTS[as].bin);
  needClean(x, dir);
  if (!x.has(dir, sha)) throw new Error(`commit ${sha} not in ${dir}`);
  x.need(dirname(out), 'output folder');
  const inFd = x.open(brief, 'r');
  x.git(dir, 'switch', '-c', branch, sha);
  const env = { ...process.env };
  delete env.FORCE_COLOR;
  x.launch(claude(as), buildArgs(), dir, inFd, x.open(out, 'w'), env, out);
  console.log(`build ${branch} @ ${sha} (${as}) -> ${out}`);
  const line = x.gate.record({ fix, over, brief, branch });
  if (line) console.log(line);
}

// `rook.mjs gate`: rewrite line 2 of runs<N>/queue.txt now and print it.
export const gate = (x = io) => x.gate.report();

export function knight(args, x = io) {
  const { brief, report, branch, sha, log, fix, over } = parseKnight(args);
  x.gate.check(fix, over);
  const clone = `${EXTRAS}/ProjectD-rowan`;
  x.need(brief, 'brief file');
  x.need(CODEX, basename(CODEX));
  needClean(x, clone);
  if (!x.has(clone, sha)) {
    if (!x.has(REPO, sha)) throw new Error(`commit ${sha} not in the repo or the clone`);
    const holder = x.git(REPO, 'branch', '--contains', sha, '--format=%(refname:short)').split('\n')[0];
    if (!holder) throw new Error(`no branch in the repo holds ${sha}`);
    x.git(clone, 'fetch', REPO, holder);
    if (!x.has(clone, sha)) throw new Error(`commit ${sha} still missing in the clone after fetching ${holder}`);
  }
  x.need(dirname(log), 'output folder');
  const inFd = x.open(brief, 'r');
  x.git(clone, 'switch', '-c', branch, sha);
  x.launch(CODEX, knightArgs(report, clone), clone, inFd, x.open(log, 'w'), undefined, report);
  console.log(`knight ${branch} @ ${sha} -> ${report}`);
  const line = x.gate.record({ fix, over, brief, branch });
  if (line) console.log(line);
}
