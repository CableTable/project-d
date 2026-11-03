// `node tools/rook.mjs review ...`, `build ...` and `knight ...`: the hand-typed launch commands of WORKFLOW.md in one call each (S28 retro).
// Every check that fails throws an Error whose message says why; nothing is launched after one.
import { execFileSync, execSync, spawn } from 'node:child_process';
import { existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateOps, tickIds } from './handover-gate.mjs';
import { setRunLine } from './rook-end.mjs';
import { parseCsv } from './usage-agent.mjs';

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
  const usage = 'usage: build <brief file> <out jsonl> <branch> <sha> [--as king|bishop] [--dir king2] [--fix] [--tool] [--over] [--big] [--review <review brief> <review out jsonl>]';
  const { pos, flags } = parseFlags(args, { '--as': 1, '--dir': 1, '--fix': 0, '--tool': 0, '--over': 0, '--big': 0, '--review': 2 }, usage);
  if (pos.length !== 4) throw new Error(usage);
  if (!SHA.test(pos[3])) throw new Error(`not a commit id: ${pos[3]}`);
  const as = account(flags, 'king', usage), dir = flags['--dir'] && flags['--dir'][0];
  if (dir && (dir !== 'king2' || as !== 'king')) throw new Error(`${usage}\n--dir king2 is for King (--as king)`);
  return { brief: resolve(pos[0]), out: resolve(pos[1]), branch: pos[2], sha: pos[3], as, dir, fix: !!flags['--fix'], tool: !!flags['--tool'], over: !!flags['--over'], big: !!flags['--big'], review: reviewOf(flags['--review']) };
}

export function parseKnight(args) {
  const usage = 'usage: knight <brief file> <report txt> <branch> <sha> [--fix] [--tool] [--over] [--big] [--review <review brief> <review out jsonl>]';
  const { pos, flags } = parseFlags(args, { '--fix': 0, '--tool': 0, '--over': 0, '--big': 0, '--review': 2 }, usage);
  if (pos.length !== 4) throw new Error(usage);
  const [brief, report, branch, sha] = pos;
  if (!report.endsWith('.txt')) throw new Error(`report must end in .txt (the log goes next to it): ${report}`);
  if (!SHA.test(sha)) throw new Error(`not a commit id: ${sha}`);
  const abs = resolve(report);
  return { brief: resolve(brief), report: abs, branch, sha, log: abs.replace(/\.txt$/, '.log'), fix: !!flags['--fix'], tool: !!flags['--tool'], over: !!flags['--over'], big: !!flags['--big'], review: reviewOf(flags['--review']) };
}

// TODO 167c: a brief whose line 1 opens like a fix round counts as one without `--fix`.
export const isFixBrief = (text) => /^﻿?(King fix|Knight fix|Fix round)\b/.test(text);

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

export function review(args, x = io) {
  const parsed = parseReview(args), { sha, brief, out, from, over } = parsed;
  let as = parsed.as;
  x.gate.context(over);
  // TODO 167d: no --as = Bishop, or King when Bishop's reviewer folder is locked (both locked: needClean refuses King's below)
  const busy = parsed.auto && x.locked(folder('bishop', 'review'));
  if (as === 'bishop' && !over && !busy) {
    let h5;
    try {
      const row = parseCsv(x.read(join(REPO, 'mockups', '_design', 'usage', 'limits.csv'))).find((r) => ['Pip', 'Bishop'].includes(r.agent) && r.window === '5h');
      const used = Number(row?.used_pct);
      if (!row?.used_pct?.trim() || !Number.isFinite(used)) throw new Error('missing or invalid Bishop 5h reading');
      if (!(Date.parse(row.resets) < Date.now())) h5 = used; // a past reset time = the window has reset, the reading is old
    } catch (e) { console.error(`review: Bishop usage cache unavailable (${e.message}); allowing review`); }
    if (h5 > 85) throw new Error(`Bishop 5h ${h5}%: use --as king, or --over`);
  }
  if (busy) { as = 'king'; console.log('review: Bishop busy, King'); }
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
  const { brief, out, branch, sha, as, dir: second, fix: fixFlag, tool, over, big, review: chain } = parseBuild(args);
  const dir =second ? folder(as, 'review') : folder(as, 'build'); // king2 is King's review folder: needClean refuses it while a review runs
  x.need(brief, 'brief file');
  if (chain) { x.need(chain.brief, 'review brief file'); x.need(dirname(chain.out), 'review output folder'); }
  const text = x.read(brief), fix = fixFlag || isFixBrief(text);
  x.gate.check(fix, over, tool);
  checkBrief(text, big);
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

// `rook.mjs gate`: rewrite line 2 of runs<N>/queue.txt now and print it.
export const gate = (x = io) => x.gate.report();

function needHooks(x, dir) {
  let hooks;
  try { hooks = x.git(dir, 'config', 'core.hooksPath'); } catch { /* Missing config also refuses the launch. */ }
  if (hooks !== 'tools/hooks') throw new Error(`hooksPath required: git -C "${dir}" config core.hooksPath tools/hooks`);
}

export function knight(args, x = io) {
  const { brief, report, branch, sha, log, fix: fixFlag, tool, over, big, review: chain } = parseKnight(args);
  const clone = `${EXTRAS}/ProjectD-rowan`;
  x.need(brief, 'brief file');
  if (chain) { x.need(chain.brief, 'review brief file'); x.need(dirname(chain.out), 'review output folder'); }
  const text = x.read(brief), fix = fixFlag || isFixBrief(text);
  if (/\.\.\/runs\d+\/shots/.test(text)) throw new Error('shots go in shots-<id>/ in the clone root');
  x.gate.check(fix, over, tool);
  checkBrief(text, big);
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

// WORKFLOW.md line 215's retro flags and line 87's Bishop-acad flags.
export const retroArgs = (extras = EXTRAS, home = homedir().replaceAll('\\', '/')) => ['-p', '--model', 'claude-opus-5-5', '--effort', 'medium', '--permission-mode', 'dontAsk', '--max-budget-usd', '6',
  '--output-format', 'text', '--add-dir', extras, '--add-dir', MAIN_GIT.replace(/\/\.git$/, ''), '--add-dir', `${home}/.claude/projects/E--Project-B-Claude-Project-D`, '--add-dir', `${home}/.claude/plugins/cache/mattpocock`,
  '--allowedTools', 'Read', 'Grep', 'Glob', 'Write', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(wc:*)', '--disallowedTools', 'Agent'];
export const acadArgs = (extras = EXTRAS) => ['-p', '--model', 'claude-sonnet-5-5', '--effort', 'high', '--permission-mode', 'dontAsk', '--max-budget-usd', '4', '--output-format', 'text',
  '--add-dir', extras, '--allowedTools', 'PowerShell', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch(domain:help.autodesk.com)', '--disallowedTools', 'Agent'];
// WORKFLOW.md lines 248-250: one question, the house sentence added here; a newline would end the cmd.exe line.
export const pawnArgs = (question) => {
  if (/[\r\n]/.test(question)) throw new Error('pawn: the question must be one line');
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

// `retro`: the three retro runs of runs<N>/ (retro<N>, retro<N>king, retro<N>rook), each from its .txt into its .out; none starts when a .txt is missing.
export function retro(args, x = io) {
  if (args.length) throw new Error('usage: retro');
  const dir = runsDir(x), n = /runs(\d+)$/.exec(dir)[1], names = [`retro${n}`, `retro${n}king`, `retro${n}rook`];
  for (const name of names) x.need(`${dir}/${name}.txt`, 'retro brief');
  x.need(claude('bishop'), ACCOUNTS.bishop.bin);
  for (const name of names) if (x.locked(dir, `${dir}/.run-lock-${name}`)) throw new Error(`${name} is in use by a running launch (${dir}/.run-lock-${name}); if that run is dead, delete the lock file`);
  for (const name of names) plainRun(x, { kind: 'retro', id: name, bin: claude('bishop'), args: retroArgs(), cwd: dir, inPath: `${dir}/${name}.txt`, out: `${dir}/${name}.out`, lock: `${dir}/.run-lock-${name}` });
}

// `acad <item>`: Bishop-acad on runs<N>/acad<item>.txt -> acad<item>.out.
export function acad(args, x = io) {
  const [item, ...rest] = args;
  if (!item || rest.length || !/^[\w.-]+$/.test(item)) throw new Error('usage: acad <item>');
  const dir = runsDir(x), name = `acad${item}`;
  x.need(`${dir}/${name}.txt`, 'acad brief');
  x.need(claude('bishop'), ACCOUNTS.bishop.bin);
  plainRun(x, { kind: 'acad', id: item, bin: claude('bishop'), args: acadArgs(), cwd: dir, inPath: `${dir}/${name}.txt`, out: `${dir}/${name}.out`, lock: `${dir}/.run-lock-${name}` });
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
