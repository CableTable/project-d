// `node tools/rook.mjs review ...` and `knight ...`: the hand-typed launch commands of WORKFLOW.md in one call each (S28 retro).
// Every check that fails throws an Error whose message says why; nothing is launched after one.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const EXTRAS = 'E:/Project B/Claude/Project D extras';
const CLAUDE2 = join(homedir(), '.local', 'bin', 'claude2.cmd');
const CODEX = join(homedir(), 'AppData', 'Roaming', 'npm', 'codex.cmd');
const SHA = /^[0-9a-f]{7,40}$/i;

export function parseReview(args) {
  const usage = 'usage: review <sha> <brief file> <out jsonl> [--from <clone folder> <branch>]';
  const i = args.indexOf('--from');
  const pos = i < 0 ? args : args.slice(0, i);
  const from = i < 0 ? null : args.slice(i + 1);
  if (pos.length !== 3 || (from && from.length !== 2)) throw new Error(usage);
  if (!SHA.test(pos[0])) throw new Error(`not a commit id: ${pos[0]}`);
  return { sha: pos[0], brief: pos[1], out: pos[2], from: from && { clone: from[0], branch: from[1] } };
}

export function parseKnight(args) {
  if (args.length !== 4) throw new Error('usage: knight <brief file> <report txt> <branch> <sha>');
  const [brief, report, branch, sha] = args;
  if (!report.endsWith('.txt')) throw new Error(`report must end in .txt (the log goes next to it): ${report}`);
  if (!SHA.test(sha)) throw new Error(`not a commit id: ${sha}`);
  return { brief, report, branch, sha, log: report.replace(/\.txt$/, '.log') };
}

// WORKFLOW.md's reviewer flags, plus the extras folder (the brief lives there).
export const reviewerArgs = (extras = EXTRAS) => ['-p', '--agent', 'reviewer', '--model', 'claude-opus-5-5', '--effort', 'medium',
  '--permission-mode', 'dontAsk', '--max-budget-usd', '6', '--add-dir', extras,
  '--disallowedTools', 'Agent', ...['commit', 'push', 'add', 'checkout', 'switch', 'stash', 'restore', 'pull'].map((g) => `Bash(git ${g}:*)`),
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

const git = (dir, ...a) => {
  try { return execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: 'pipe' }).trim(); }
  catch (e) { throw new Error(`git ${a.join(' ')} failed in ${dir}: ${String(e.stderr || e.message).trim()}`); }
};
const has = (dir, sha) => { try { execFileSync('git', ['-C', dir, 'cat-file', '-e', `${sha}^{commit}`], { stdio: 'pipe' }); return true; } catch { return false; } };
const need = (path, what) => { if (!existsSync(path)) throw new Error(`${what} not found: ${path}`); };

// A detached cmd.exe loses its redirected output on Windows (tested 2026-10-29), so a detached node holds the handles
// and runs the .cmd under them. The command returns at once and the run goes on. stdin = brief, stdout and stderr = the out file.
const RUN = 'require("child_process").spawn(process.argv[1], { shell: true, stdio: "inherit", windowsHide: true }).on("exit", (c) => process.exit(c));';
function launch(bin, args, cwd, briefFile, outFile) {
  const out = openSync(outFile, 'w');
  const child = spawn(process.execPath, ['-e', RUN, commandLine(bin, args)], { cwd, detached: true, windowsHide: true, stdio: [openSync(briefFile, 'r'), out, out] });
  child.on('error', (e) => { console.error(`launch failed: ${e.message}`); process.exit(1); });
  child.unref();
}

export function review(args) {
  const { sha, brief, out, from } = parseReview(args);
  const wt = `${EXTRAS}/ProjectD-s15fix`;
  need(brief, 'brief file');
  need(CLAUDE2, 'claude2.cmd');
  need(`${wt}/.claude/agents/reviewer.md`, 'reviewer worktree (.claude/agents/reviewer.md)');
  if (from) git(REPO, 'fetch', from.clone, from.branch);
  if (!has(REPO, sha)) throw new Error(`commit ${sha} not in the repo${from ? '' : ' (use --from <clone folder> <branch> for a Knight build)'}`);
  git(wt, 'switch', '--detach', sha);
  launch(CLAUDE2, reviewerArgs(), wt, brief, out);
  console.log(`review ${sha} -> ${out}`);
}

export function knight(args) {
  const { brief, report, branch, sha, log } = parseKnight(args);
  const clone = `${EXTRAS}/ProjectD-rowan`;
  need(brief, 'brief file');
  need(CODEX, 'codex.cmd');
  need(clone, 'Knight clone');
  const dirty = git(clone, 'status', '--porcelain').split('\n').filter((l) => l && !l.startsWith('??'));
  if (dirty.length) throw new Error(`${clone} has tracked changes (git stash -u -m "<run>" first): ${dirty.join(' | ')}`);
  if (!has(clone, sha)) {
    if (!has(REPO, sha)) throw new Error(`commit ${sha} not in the repo or the clone`);
    const holder = git(REPO, 'branch', '--contains', sha, '--format=%(refname:short)').split('\n')[0];
    if (!holder) throw new Error(`no branch in the repo holds ${sha}`);
    git(clone, 'fetch', REPO, holder);
    if (!has(clone, sha)) throw new Error(`commit ${sha} still missing in the clone after fetching ${holder}`);
  }
  git(clone, 'switch', '-c', branch, sha);
  launch(CODEX, knightArgs(report, clone), clone, brief, log);
  console.log(`knight ${branch} @ ${sha} -> ${report}`);
}
