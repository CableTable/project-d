// `node tools/rook.mjs review ...`, `build ...` and `knight ...`: the hand-typed launch commands of WORKFLOW.md in one call each (S28 retro).
// Every check that fails throws an Error whose message says why; nothing is launched after one.
import { execFileSync, execSync, spawn } from 'node:child_process';
import { existsSync, openSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateOps, tickIds } from './handover-gate.mjs';
import { setRunLine } from './rook-end.mjs';
import { parseCsv } from './usage-agent.mjs';
import { retroSessions } from './retro-brief.mjs';

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
  const usage = 'usage: review <sha> <brief file> <out jsonl> [--as bishop|king] [--from <clone folder> <branch>] [--over]';
  const { pos, flags } = parseFlags(args, { '--as': 1, '--from': 2, '--over': 0 }, usage);
  if (pos.length !== 3) throw new Error(usage);
  if (!SHA.test(pos[0])) throw new Error(`not a commit id: ${pos[0]}`);
  const from = flags['--from'];
  return { sha: pos[0], brief: resolve(pos[1]), out: resolve(pos[2]), as: account(flags, 'bishop', usage), auto: !flags['--as'], over: !!flags['--over'], from: from &&{ clone: resolve(from[0]), branch: from[1] } };
}

const reviewOf = (v) => v && { brief: resolve(v[0]), out: resolve(v[1]) };

export function parseBuild(args) {
  const usage = 'usage: build <brief file> <out jsonl> <branch> <sha> [--as king|bishop] [--dir king2] [--fix] [--regrilled] [--tool] [--no-fresh] [--over] [--big] [--review <review brief> <review out jsonl>]';
  const { pos, flags } = parseFlags(args, { '--as': 1, '--dir': 1, '--fix': 0, '--regrilled': 0, '--tool': 0, '--no-fresh': 0, '--over': 0, '--big': 0, '--review': 2 }, usage);
  if (pos.length !== 4) throw new Error(usage);
  if (!SHA.test(pos[3])) throw new Error(`not a commit id: ${pos[3]}`);
  const as = account(flags, 'king', usage), dir = flags['--dir'] && flags['--dir'][0];
  if (dir && (dir !== 'king2' || as !== 'king')) throw new Error(`${usage}\n--dir king2 is for King (--as king)`);
  return { brief: resolve(pos[0]), out: resolve(pos[1]), branch: pos[2], sha: pos[3], as, dir, fix: !!flags['--fix'], regrilled: !!flags['--regrilled'], tool: !!flags['--tool'], noFresh: !!flags['--no-fresh'], over: !!flags['--over'], big: !!flags['--big'], review: reviewOf(flags['--review']) };
}

export function parseKnight(args) {
  const usage = 'usage: knight <brief file> <report txt> <branch> <sha> [--fix] [--regrilled] [--tool] [--no-fresh] [--over] [--big] [--review <review brief> <review out jsonl>]';
  const { pos, flags } = parseFlags(args, { '--fix': 0, '--regrilled': 0, '--tool': 0, '--no-fresh': 0, '--over': 0, '--big': 0, '--review': 2 }, usage);
  if (pos.length !== 4) throw new Error(usage);
  const [brief, report, branch, sha] = pos;
  if (!report.endsWith('.txt')) throw new Error(`report must end in .txt (the log goes next to it): ${report}`);
  if (!SHA.test(sha)) throw new Error(`not a commit id: ${sha}`);
  const abs = resolve(report);
  return { brief: resolve(brief), report: abs, branch, sha, log: abs.replace(/\.txt$/, '.log'), fix: !!flags['--fix'], regrilled: !!flags['--regrilled'], tool: !!flags['--tool'], noFresh: !!flags['--no-fresh'], over: !!flags['--over'], big: !!flags['--big'], review: reviewOf(flags['--review']) };
}

// TODO 167c: a brief whose line 1 opens like a fix round counts as one without `--fix`.
export const isFixBrief = (text) => /^﻿?(King fix|Knight fix|Fix round)\b/.test(text);

export function fixRoundRefusal(id, queue) {
  // shortcut: counts only this runs folder's queue lines; use cross-session history if fixes span folders.
  const count = queue.split(/\r?\n/).filter((line) => [...line.matchAll(/(?:^|\s)(?:king|knight)\/(\S+)/g)].some((m) => m[1].startsWith(`${id}fix`))).length;
  return count >= 2 ? `3rd fix round of ${id}: re-grill the root cause, then --regrilled` : '';
}

function checkFixRound(x, branch, regrilled) {
  const queue = x.gate.queueFile(), id = branch.replace(/^(king|knight)\//, '').replace(/fix\d*$/, '');
  if (regrilled) x.need(join(dirname(queue), `grill-${id}-regrill.md`), 're-grill file');
  else {
    const refusal = fixRoundRefusal(id, existsSync(queue) ? x.read(queue) : '');
    if (refusal) throw new Error(refusal);
  }
}

export function lintBrief(text) {
  const problems = [];
  let behaviours = 0;
  let inItem = false;
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    const numbered = line.match(/^\s*\d+\.\s+(.*)$/);
    if (/^\s*\d+\./.test(line)) inItem = true;
    else if (line.trim() && !/^\s+/.test(line)) inItem = false;
    if (inItem && /\b(every|all) \w*\s*(caller|button|site)s?\b/i.test(line) && !/\bgrep -n\b|`grep\b/.test(line)) problems.push(`line ${i + 1}: every-caller instruction needs a grep command (grep -n or \`grep)`);
    if (numbered && !/^`?(Screenshots|npm\.cmd test|Tick|Append|Add a DECISIONS|Report)\b/i.test(numbered[1])) behaviours++;
    if (/^\s*(\d+\.\s+)?Also\b/i.test(line)) problems.push(`line ${i + 1}: line starts with Also (scope creep: make it a numbered item or drop it)`);
    if (new Set(tickIds(line)).size > 1) problems.push(`line ${i + 1}: Tick line names more than one TODO id`);
    for (const [, , filter] of line.matchAll(/\bbrowser\.test\.mjs\b(?:[^'"]|(?<=\w)['’](?=\w))*\s(['"])(.*?)\1/g)) {
      for (const piece of filter.split('|')) {
        if (/^(?:[a-z]|\[[a-z]{2}\])+$/i.test(piece.trim())) problems.push(`line ${i + 1}: one-word browser filter piece '${piece}'`);
      }
    }
    if (/full (browser )?suite/i.test(line) && !/\bRook\b/i.test(line) && !/\b(never|not|no|don['’]?t)\s+(ever\s+)?(run\s+)?(the\s+)?full (browser )?suite/i.test(line)) problems.push(`line ${i + 1}: builder asked for the full suite`);
    if (/(^|[\s(`'"])runs\d+\//.test(line)) problems.push(`line ${i + 1}: bare runs<N>/ path; use ../runs<N>/ or an absolute path`);
    if (/\.\.\/Project D extras\/runs/.test(line)) problems.push(`line ${i + 1}: use ../runs<N>/ (the worktree sits beside runs<N>/)`);
    if (/\b(cmd(\.exe)? \/c|powershell\.exe)\b/i.test(line)) problems.push(`line ${i + 1}: cmd /c and powershell.exe are off King's allowlist; use a tmp-*.mjs`);
    if (/\bcargo\b/i.test(line) && !/\bno cargo\b/i.test(line)) problems.push(`line ${i + 1}: cargo is unavailable on this PC; say no cargo on the same line`);
  }
  if (behaviours > 5) problems.unshift(`${behaviours} behaviour lines (maximum 5)`);
  if (/^﻿?Build:/.test(text) && !/^Old steps\b/m.test(text)) problems.push('build brief needs an Old steps line');
  return problems;
}

function checkBrief(text, big) {
  const problems = lintBrief(text);
  if (problems.length && !big) throw new Error(`brief refused:\n${problems.join('\n')}\n--big overrides these problems; fix with Read + Edit (sed -i is denied)`);
}

// WORKFLOW.md's reviewer flags, plus the extras folder (the brief lives there).
export const reviewerArgs = (extras = EXTRAS) => ['-p', '--agent', 'reviewer', '--model', 'claude-opus-5-5', '--effort', 'medium',
  '--permission-mode', 'dontAsk', '--max-budget-usd', '6', '--add-dir', extras,
  '--disallowedTools', 'Agent', ...['commit', 'push', 'add', 'checkout', 'switch', 'stash', 'restore', 'pull'].map((g) => `Bash(git ${g}:*)`),
  '--output-format', 'stream-json', '--verbose'];

// WORKFLOW.md's King-build flags (the same for either account): the repo's git folder and the extras folder (the brief lives there).
export const buildArgs = (extras = EXTRAS, gitDir = MAIN_GIT) => ['-p', '--agent', 'builder', '--strict-mcp-config', '--model', 'claude-sonnet-5-5', '--effort', 'high',
  '--permission-mode', 'acceptEdits', '--max-budget-usd', '8', '--add-dir', gitDir, '--add-dir', extras,
  '--disallowedTools', 'Bash(gh pr merge:*)', 'PowerShell(gh pr merge:*)', 'Agent', 'Bash(git push:*)', 'Bash(taskkill:*)', 'PowerShell(Stop-Process:*)', 'Bash(node -e:*)',
  '--allowedTools', 'Bash(echo:*)', 'Bash(tee:*)', 'Bash(npx.cmd:*)', 'Bash(npm.cmd:*)', 'PowerShell(Select-String:*)', 'PowerShell(Select-Object:*)',
  'PowerShell(Write-Output:*)', ...['add', 'commit', 'fetch', 'checkout', 'switch', 'cherry-pick', 'rebase', 'apply', 'check-ignore', 'merge --squash', 'grep'].map((g) => `Bash(git ${g}:*)`),
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
// When the run ends it deletes the folder's lock (argv[2]), then (TODO 167d) runs tools/rook-end.mjs (argv[3]) with the job JSON (argv[4]) and the exit code.
const RUN = 'const rm = () => { try { require("fs").unlinkSync(process.argv[2]); } catch {} };'
  + 'const end = (c) => { if (process.argv[3]) try { require("child_process").execFileSync(process.execPath, [process.argv[3], process.argv[4], String(c)], { stdio: "ignore", windowsHide: true }); } catch {} };'
  + 'require("child_process").spawn(process.argv[1], { shell: true, stdio: "inherit", windowsHide: true }).on("exit", (c) => { rm(); end(c); process.exit(c); });';
const lockFile = (dir) => `${dir}/.run-lock`;
const END = join(REPO, 'tools', 'rook-end.mjs');

// A run that never started must not leave its folder locked.
export function launchFailed(cwd, e, exit = process.exit, lock = lockFile(cwd)) {
  try { unlinkSync(lock); } catch { /* no lock */ }
  console.error(`launch failed: ${e.message}`);
  exit(1);
}

// The command line is built first (it throws on a bad argument), the lock is written last; a throw from the spawn or its 'error' event takes the lock off again.
export function launchRun(bin, args, cwd, inFd, outFd, env, outPath = '', spawnFn = spawn, fail = launchFailed, after = null, lock = lockFile(cwd)) {
  const line = commandLine(bin, args);
  writeFileSync(lock, `${new Date().toISOString()}\n${outPath}`); // `rook.mjs result` reads the out file's name back
  try {
    const child = spawnFn(process.execPath, ['-e', RUN, line, lock, ...(after ? [END, JSON.stringify(after)] : [])], { cwd, env, detached: true, windowsHide: true, stdio: [inFd, outFd, outFd] });
    child.on('error', (e) => fail(cwd, e, process.exit, lock));
    child.unref();
  } catch (e) {
    try { unlinkSync(lock); } catch { /* no lock */ }
    throw e;
  }
}

// A launch's line in queue.txt as a job for rook-end.mjs; null when there is no queue.txt (lines 1-2 are Rook's, so the launcher never creates one).
export const queueLineOf = (queue, kind, id, out, exists = existsSync) => (exists(queue) ? { queue, key: basename(out), text: `${kind} ${id} -> ${basename(out)}:` } : null);

// Everything that touches git, npm, files or processes; the tests swap it for a recorder.
const io = {
  git(dir, ...a) {
    try { return execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: 'pipe' }).trim(); }
    catch (e) { throw new Error(`git ${a.join(' ')} failed in ${dir}: ${String(e.stderr || e.message).trim()}`); }
  },
  has(dir, sha) { try { execFileSync('git', ['-C', dir, 'cat-file', '-e', `${sha}^{commit}`], { stdio: 'pipe' }); return true; } catch { return false; } },
  need(path, what) { if (!existsSync(path)) throw new Error(`${what} not found: ${path}`); },
  read: (path) => readFileSync(path, 'utf8'),
  exists: existsSync,
  mtime: (path) => statSync(path).mtimeMs,
  list: (path) => readdirSync(path, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name),
  write: (path, text) => writeFileSync(path, text, { flag: 'wx' }),
  open: (path, mode) => openSync(path, mode),
  locked: (dir, lock = lockFile(dir)) => existsSync(lock),
  npmCi(dir) {
    try { execSync('npm.cmd ci --silent', { cwd: dir, stdio: 'pipe' }); }
    catch (e) { throw new Error(`npm ci failed in ${dir}: ${String(e.stderr || e.message).trim()}`); }
  },
  launch: (bin, args, cwd, inFd, outFd, env = process.env, outPath, after, lock) => launchRun(bin, args, cwd, inFd, outFd, env, outPath, spawn, launchFailed, after, lock),
  truncate(path) { if (existsSync(path)) writeFileSync(path, ''); }, // a reused out file must not wake `wait` before the run ends
  // This launch's line in queue.txt; `open` never throws and returns null when queue.txt is missing.
  queue: {
    open(kind, id, out) {
      try { return queueLineOf(io.gate.queueFile(), kind, id, out); }
      catch (e) { console.error(`queue line not written: ${e.message}`); return null; }
    },
    set(q, state) {
      if (!q) return;
      try { writeFileSync(q.queue, setRunLine(existsSync(q.queue) ? readFileSync(q.queue, 'utf8') : '', `${q.text} ${state}`, q.key)); }
      catch (e) { console.error(`queue line not written: ${e.message}`); }
    },
  },
};
// The handover gate (tools/handover-gate.mjs) reads the Rook's files in the extras folder and the session branch in this repo.
io.gate = gateOps({ extras: EXTRAS, claudeDir: join(homedir(), '.claude', 'projects', 'E--Project-B-Claude-Project-D'), read: (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null), write: writeFileSync, git: (...a) => io.git(REPO, ...a) });

const claude = (as) => join(homedir(), '.local', 'bin', ACCOUNTS[as].bin);
const folder = (as, role) => `${EXTRAS}/${ACCOUNTS[as][role]}`;
const defaultAccount = (x) => (x.locked(folder('bishop', 'review')) ? 'king' : 'bishop');

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
  try { x.git(dir, 'cherry-pick', '--quit'); } catch { /* No cherry-pick in progress is fine. */ }
}

// What the RUN script hands to tools/rook-end.mjs when the run ends: its queue line (q) and the review to chain; null when there is neither.
const afterOf = (q, review) => (q || review ? { ...q, review } : null);

// The cached 5h reading of one account (limits.csv, written by `rook.mjs usage`); undefined, with a warning, when it is unreadable or the window has reset.
function cachedH5(x, names, who, what) {
  try {
    const row = parseCsv(x.read(join(REPO, 'mockups', '_design', 'usage', 'limits.csv'))).find((r) => names.includes(r.agent) && r.window === '5h');
    const used = Number(row?.used_pct);
    if (!row?.used_pct?.trim() || !Number.isFinite(used)) throw new Error(`missing or invalid ${who} 5h reading`);
    if (!(Date.parse(row.resets) < Date.now())) return used; // a past reset time = the window has reset, the reading is old
  } catch (e) { console.error(`${what}: ${who} usage cache unavailable (${e.message}); allowing ${what}`); }
}

// TODO 196a: King builds and reviews are refused above 85% of his cached 5h, like Bishop's review gate; --over passes.
function kingGate(x, what) {
  const h5 = cachedH5(x, ['King'], 'King', what);
  if (h5 > 85) throw new Error(`King 5h ${h5}%: use Knight, or --over`);
}

export function review(args, x = io) {
  const parsed = parseReview(args), { sha, brief, out, from, over } = parsed;
  let as = parsed.as;
  x.gate.context(over);
  // TODO 167d: no --as = Bishop, or King when Bishop's reviewer folder is locked (both locked: needClean refuses King's below)
  const busy = parsed.auto && x.locked(folder('bishop', 'review'));
  if (as === 'bishop' && !over && !busy) {
    const h5 = cachedH5(x, ['Pip', 'Bishop'], 'Bishop', 'review');
    if (h5 > 85) throw new Error(`Bishop 5h ${h5}%: use --as king, or --over`);
  }
  if (busy) { as = 'king'; console.log('review: Bishop busy, King'); }
  if (as === 'king' && !over) kingGate(x, 'review');
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
  const q = x.queue.open('review', sha, out);
  x.launch(claude(as), reviewerArgs(), wt, inFd, x.open(out, 'w'), undefined, out, afterOf(q));
  x.queue.set(q, 'running');
  console.log(`review ${sha} (${as}) -> ${out}`);
}

export function build(args, x = io) {
  const { brief, out, branch, sha, as, dir: second, fix: fixFlag, regrilled, tool, noFresh, over, big, review: chain } = parseBuild(args);
  const dir =second ? folder(as, 'review') : folder(as, 'build'); // king2 is King's review folder: needClean refuses it while a review runs
  x.need(brief, 'brief file');
  if (chain) { x.need(chain.brief, 'review brief file'); x.need(dirname(chain.out), 'review output folder'); }
  const text = x.read(brief), fix = fixFlag || isFixBrief(text);
  x.gate.check(fix, over, tool);
  if (as === 'king' && !over) kingGate(x, 'build');
  checkBrief(text, big);
  if (!fix && !tool && !noFresh) checkFresh(x, text);
  if (fix || regrilled) checkFixRound(x, branch, regrilled);
  x.need(claude(as), ACCOUNTS[as].bin);
  needClean(x, dir);
  needHooks(x, dir);
  if (!x.has(dir, sha)) throw new Error(`commit ${sha} not in ${dir}`);
  x.need(dirname(out), 'output folder');
  const inFd = x.open(brief, 'r');
  x.git(dir, 'switch', '-c', branch, sha);
  const env = { ...process.env };
  delete env.FORCE_COLOR;
  if (as === 'king') env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = '1'; // a long foreground call must not move to the background
  if (chain) x.truncate(chain.out);
  const q = x.queue.open('build', branch, out);
  x.launch(claude(as), buildArgs(), dir, inFd, x.open(out, 'w'), env, out, afterOf(q, chain && { ...chain, dir, branch, base: sha }));
  x.queue.set(q, 'running');
  console.log(`build ${branch} @ ${sha} (${as}) -> ${out}`);
  const line = x.gate.record({ fix, over, tool, brief, branch });
  if (line) console.log(line);
}

// `rook.mjs result`'s last line: this Rook's own context ('' when its transcript is not found).
export const rookContextLine = (x = io) => x.gate.contextLine();
// What `result` prints after the peak context line: this Rook's context, or nothing when its transcript is not there.
export const printRookContext = (x = io, log = console.log) => { const line = rookContextLine(x); if (line) log(line); };

// `rook.mjs gate`: rewrite line 2 of runs<N>/queue.txt now and print it.
export const gate = (x = io) => x.gate.report();

function needHooks(x, dir) {
  let hooks;
  try { hooks = x.git(dir, 'config', 'core.hooksPath'); } catch { /* Missing config also refuses the launch. */ }
  // A worktree shares main's config, which holds main's absolute tools/hooks: accept that too.
  const ok = hooks && [resolve(dir, 'tools/hooks'), resolve(dirname(MAIN_GIT), 'tools/hooks')].includes(resolve(dir, hooks));
  if (!ok) throw new Error(`hooksPath required: git -C "${dir}" config core.hooksPath tools/hooks`);
}

export function knight(args, x = io) {
  const { brief, report, branch, sha, log, fix: fixFlag, regrilled, tool, noFresh, over, big, review: chain } = parseKnight(args);
  const clone = `${EXTRAS}/ProjectD-rowan`;
  x.need(brief, 'brief file');
  if (chain) { x.need(chain.brief, 'review brief file'); x.need(dirname(chain.out), 'review output folder'); }
  const text = x.read(brief), fix = fixFlag || isFixBrief(text);
  if (/\.\.\/runs\d+\/shots/.test(text)) throw new Error('shots go in shots-<id>/ in the clone root');
  x.gate.check(fix, over, tool);
  checkBrief(text, big);
  if (!fix && !tool && !noFresh) checkFresh(x, text);
  if (fix || regrilled) checkFixRound(x, branch, regrilled);
  x.need(CODEX, basename(CODEX));
  needClean(x, clone);
  needHooks(x, clone);
  if (!x.has(clone, sha)) {
    if (!x.has(REPO, sha)) throw new Error(`commit ${sha} not in the repo or the clone`);
    const holder = x.git(REPO, 'branch', '--contains', sha, '--format=%(refname:short)').split('\n')[0];
    if (!holder) throw new Error(`no branch in the repo holds ${sha}`);
    x.git(clone, 'fetch', REPO, holder);
    if (!x.has(clone, sha)) throw new Error(`commit ${sha} still missing in the clone after fetching ${holder}`);
  }
  // S35 retro: a brief that says `git show <sha>` for a commit the clone lacks wastes the run. A sha has both a digit and a letter (a bare number or a word is not one).
  // shortcut: any hex token with a digit and a letter (e.g. a transcript id like 81b99077) counts as a sha and blocks the launch; an all-digit sha (about 3.7% of 7-char ones) is never checked. Upgrade if either bites.
  const missing = (text.match(/\b[0-9a-f]{7,40}\b/gi) || []).find((s) => /\d/.test(s) && /[a-f]/i.test(s) && !x.has(clone, s));
  if (missing) throw new Error(`brief names ${missing}, which is not in the Knight clone: fetch it there first`);
  x.need(dirname(log), 'output folder');
  const inFd = x.open(brief, 'r');
  x.git(clone, 'switch', '-c', branch, sha);
  x.truncate(report);
  if (chain) x.truncate(chain.out);
  const q = x.queue.open('knight', branch, report);
  x.launch(CODEX, knightArgs(report, clone), clone, inFd, x.open(log, 'w'), undefined, report, afterOf(q, chain && { ...chain, dir: clone, branch, base: sha, from: clone }));
  x.queue.set(q, 'running');
  console.log(`knight ${branch} @ ${sha} -> ${report}`);
  const line = x.gate.record({ fix, over, tool, brief, branch });
  if (line) console.log(line);
}

// TODO 167e: `suite`, `retro`, `pawn`, `acad`: the other hand-typed launches of WORKFLOW.md (lines 87, 214, 215, 248-250), detached with a lock and a queue line.
const SUITE = join(REPO, 'tools', 'rook-suite.mjs');
const runsDir = (x) => dirname(x.gate.queueFile());

function checkFresh(x, text) {
  for (const [, id] of text.matchAll(/\bgrill-([\w.-]+)\.md\b/g)) {
    if (!x.exists(`${runsDir(x)}/fresh-${id}.out`)) throw new Error('fresh read due (--no-fresh for an S item with no invariant)');
  }
}

// WORKFLOW.md line 215's retro flags and line 87's Bishop-acad flags.
export const retroArgs = (extras = EXTRAS, home = homedir().replaceAll('\\', '/')) => ['-p', '--model', 'claude-opus-5-5', '--effort', 'medium', '--permission-mode', 'dontAsk', '--max-budget-usd', '6',
  '--output-format', 'text', '--add-dir', extras, '--add-dir', MAIN_GIT.replace(/\/\.git$/, ''), '--add-dir', `${home}/.claude/projects/E--Project-B-Claude-Project-D`, '--add-dir', `${home}/.claude/plugins/cache/mattpocock`,
  '--allowedTools', 'Read', 'Grep', 'Glob', 'Write', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(wc:*)', '--disallowedTools', 'Agent'];
export const acadArgs = (extras = EXTRAS) => ['-p', '--model', 'claude-sonnet-5-5', '--effort', 'high', '--permission-mode', 'dontAsk', '--max-budget-usd', '4', '--output-format', 'text',
  '--add-dir', extras, '--allowedTools', 'PowerShell', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch(domain:help.autodesk.com)', '--disallowedTools', 'Agent'];
// WORKFLOW.md lines 248-250: one question, the house sentence added here; a newline would end the cmd.exe line.
export const pawnArgs = (question) => {
  if (/[\r\n]/.test(question)) throw new Error('pawn: the question must be one line');
  if (/\(2\)|(?:^|\s)2(?:\.(?!\d)|\))/.test(question)) throw new Error('pawn: one question per Pawn run');
  if (/[%"]/.test(question)) throw new Error('pawn: the question may not hold % or " (cmd.exe expands %NAME% inside quotes); use single quotes / spell it out');
  return ['-p', `${question} Open https links only, skip http ones, run no commands; read at most 3 pages; cite URLs.`, '--output-format', 'json', '--print-timeout', '10m'];
};
const AGY = join(homedir(), 'AppData', 'Local', 'agy', 'bin', 'agy.exe');
const AGY_DIR = join(homedir(), 'agy-research');

// One detached run: lock (`lock` or the folder's), queue line, stdin from `inPath` when given, stdout and stderr to `out`.
function plainRun(x, { kind, id, bin, args, cwd, inPath, out, lock }) {
  if (x.locked(cwd, lock)) throw new Error(`${id} is in use by a running launch (${lock || lockFile(cwd)}); if that run is dead, delete the lock file`);
  const inFd = inPath ? x.open(inPath, 'r') : 'ignore';
  const q = x.queue.open(kind, id, out);
  x.launch(bin, args, cwd, inFd, x.open(out, 'w'), undefined, out, afterOf(q), lock);
  x.queue.set(q, 'running');
  console.log(`${kind} ${id} -> ${out}`);
}

// `suite <sha>`: npm test then the browser test in this repo's checked-out branch; the log ends `SUITE unit=<code> browser=<code>`.
export function suite(args, x = io) {
  const [sha, ...rest] = args;
  if (!sha || rest.length) throw new Error('usage: suite <sha>');
  if (!SHA.test(sha)) throw new Error(`not a commit id: ${sha}`);
  const head = x.git(REPO, 'rev-parse', 'HEAD');
  if (!head.startsWith(sha.toLowerCase())) throw new Error(`refused: ${sha} is not HEAD (${head.slice(0, 7)}); the suite runs the checked-out files`);
  plainRun(x, { kind: 'suite', id: sha, bin: process.execPath, args: [SUITE], cwd: REPO, out: `${runsDir(x)}/suite-${sha}.log` });
}

// cmd.exe drops a variable over 8191 chars, and each Rook started by `next` inherits and grows PATH: drop empty and case-insensitive repeats, first order kept.
export function dedupePath(env) {
  for (const key of Object.keys(env).filter((k) => /^path$/i.test(k))) {
    const seen = new Set();
    env[key] = String(env[key]).split(';').filter((p) => p && !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase())).join(';');
  }
  return env;
}

// `retro`: fill missing briefs, then launch the three retros from their .txt into their .out.
// TODO 206 `--handover`: one retro over the outgoing Rook's transcript (uuid + name default to rook-next.txt lines 1-2).
export function retro(args, x = io) {
  const usage = 'usage: retro [--over] [--events "<text>"] [--as king|bishop] | retro --handover [--uuid <id> --name "Rook S<N><x>"] [--as king|bishop] [--over]';
  const { pos, flags } = parseFlags(args, { '--over': 0, '--events': 1, '--as': 1, '--handover': 0, '--uuid': 1, '--name': 1 }, usage);
  const ho = !!flags['--handover'];
  if (pos.length || (!ho && (flags['--uuid'] || flags['--name'])) || !flags['--uuid'] !== !flags['--name']) throw new Error(usage);
  const as = account(flags, defaultAccount(x), usage), who = as === 'king' ? 'King' : 'Bishop';
  const over = !!flags['--over'];
  const dir = runsDir(x), n = /runs(\d+)$/.exec(dir)[1];
  let names = [`retro${n}`, `retro${n}king`, `retro${n}rook`], hUuid, hName;
  if (ho) {
    [hUuid, hName] = flags['--uuid'] ? [flags['--uuid'][0], flags['--name'][0]] : x.read(`${dirname(dir)}/rook-next.txt`).split(/\r?\n/);
    const m = /S(\d+)([a-z]*)$/.exec(hName || '');
    if (!/^[\w-]+$/.test(hUuid || '') || !m) throw new Error(`${usage}\nneed a uuid and a name like "Rook S${n}j" (rook-next.txt lines 1-2, or --uuid and --name)`);
    if (m[1] !== n) throw new Error(`refused: ${hName} is session ${m[1]} but this is runs${n}`);
    names = [`retro${n}${m[2] || 'h'}`];
  }
  const transcript = `C:/Users/raksh/.claude/projects/E--Project-B-Claude-Project-D/${hUuid}.jsonl`;
  if (ho && !x.exists(transcript)) throw new Error(`refused: no transcript ${transcript}`);
  if (!over) { // TODO 196a: three Opus retros took Bishop from 61% to 100% (S36)
    const h5 = cachedH5(x, as === 'king' ? ['King'] : ['Pip', 'Bishop'], who, 'retro');
    if (h5 > (ho ? 70 : 40)) throw new Error(`${who} 5h ${h5}%: ${ho ? 'the handover retro needs' : 'the three retros need'} room; wait for the reset, or --over`);
  }
  x.need(claude(as), ACCOUNTS[as].bin);
  for (const name of names) if (x.locked(dir, `${dir}/.run-lock-${name}`)) throw new Error(`${name} is in use by a running launch (${dir}/.run-lock-${name}); if that run is dead, delete the lock file`);
  const missing = names.filter((name) => !x.exists(`${dir}/${name}.txt`)); // filled last: a refused run writes nothing
  if (missing.length) {
    const transcripts = [], sessions = new Set();
    const project = 'C:/Users/raksh/.claude/projects/E--Project-B-Claude-Project-D';
    const files = ho ? [] : x.list(project).filter((f) => f.endsWith('.jsonl')).sort().map((f) => [f, x.mtime(`${project}/${f}`)]).sort((a, b) => a[1] - b[1]); // oldest first: S37, S37b, S37c
    if (ho) { transcripts.push(transcript); sessions.add(hName); }
    for (const [file] of files) {
      const found = retroSessions(x.read(`${project}/${file}`), n);
      if (found === null) continue;
      transcripts.push(`${project}/${file}`);
      for (const session of found) sessions.add(session);
    }
    if (!transcripts.length) throw new Error(`no Rook transcripts for session ${n}`);
    const values = { N: n, SESSIONS: [...sessions].join(', '), TRANSCRIPTS: transcripts.join(', '), EVENTS: flags['--events']?.[0] ?? 'none given.' };
    for (const name of missing) {
      const suffix = ho ? 'rook' : name.slice(`retro${n}`.length);
      const template = x.read(join(REPO, 'tools', 'briefs', `retro${suffix ? `-${suffix}` : ''}.txt`));
      const note = ho ? `\nHandover retro: only this Rook; short (top 5 fixes); skip points already in runs${n}/retro${n}*.out\n` : '';
      x.write(`${dir}/${name}.txt`, template.replace(/\{(N|SESSIONS|TRANSCRIPTS|EVENTS)\}/g, (_, key) => values[key]) + note);
    }
  }
  for (const name of names) x.need(`${dir}/${name}.txt`, 'retro brief');
  for (const name of names) plainRun(x, { kind: 'retro', id: name, bin: claude(as), args: retroArgs(), cwd: dir, inPath: `${dir}/${name}.txt`, out: `${dir}/${name}.out`, lock: `${dir}/.run-lock-${name}` });
}

// `acad <item>`: the chosen account on runs<N>/acad<item>.txt -> acad<item>.out.
export function acad(args, x = io) {
  const usage = 'usage: acad <item> [--as king|bishop]';
  const { pos, flags } = parseFlags(args, { '--as': 1 }, usage);
  const [item] = pos;
  if (pos.length !== 1 || !/^[\w.-]+$/.test(item)) throw new Error(usage);
  const as = account(flags, defaultAccount(x), usage);
  const dir = runsDir(x), name = `acad${item}`;
  x.need(`${dir}/${name}.txt`, 'acad brief');
  x.need(claude(as), ACCOUNTS[as].bin);
  plainRun(x, { kind: 'acad', id: item, bin: claude(as), args: acadArgs(), cwd: dir, inPath: `${dir}/${name}.txt`, out: `${dir}/${name}.out`, lock: `${dir}/.run-lock-${name}` });
}

// `pawn <out.json> "<question>"`: one Pawn (agy) lookup from its own folder.
export function pawn(args, x = io) {
  const [out, question, ...rest] = args;
  if (!out || !question || rest.length || !out.endsWith('.json')) throw new Error('usage: pawn <out.json> "<question>" (out ends in .json)');
  const cmdArgs = pawnArgs(question);
  x.need(AGY, 'agy.exe');
  x.need(AGY_DIR, 'folder');
  x.need(dirname(resolve(out)), 'output folder');
  plainRun(x, { kind: 'pawn', id: 'agy', bin: AGY, args: cmdArgs, cwd: AGY_DIR, out: resolve(out), lock: `${AGY_DIR}/.run-lock-${basename(out)}` }); // one lock per out file: parallel Pawn runs
}

// TODO 196g: WORKFLOW.md line 194's Bishop board / look flags.
export const boardArgs = (extras = EXTRAS) => ['-p', '--model', 'claude-sonnet-5-5', '--effort', 'high', '--permission-mode', 'dontAsk', '--max-budget-usd', '4', '--output-format', 'text',
  '--add-dir', extras, '--add-dir', MAIN_GIT.replace(/\/\.git$/, ''), '--allowedTools', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash(node:*)', '--disallowedTools', 'Agent'];

// `board <brief> <out>`: the chosen account on <brief> (stdin) -> <out>, from runs<N>.
export function board(args, x = io) {
  const usage = 'usage: board <brief> <out> [--as king|bishop]';
  const { pos, flags } = parseFlags(args, { '--as': 1 }, usage);
  const [brief, out] = pos;
  if (pos.length !== 2 || !brief || !out) throw new Error(usage);
  const as = account(flags, defaultAccount(x), usage);
  x.need(resolve(brief), 'board brief');
  x.need(claude(as), ACCOUNTS[as].bin);
  plainRun(x, { kind: 'board', id: basename(out), bin: claude(as), args: boardArgs(), cwd: runsDir(x), inPath: resolve(brief), out: resolve(out), lock: `${runsDir(x)}/.run-lock-${basename(out)}` });
}
