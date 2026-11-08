// Rook's helpers: short output so the lead's context stays small (2026-10-20).
//   node tools/rook.mjs usage           one line per agent (+ week forecast); refreshes mockups/_design/usage/limits.csv, history.csv
//   node tools/rook.mjs usage --cached  read the CSVs if both are at most 75 minutes old (the PC agent refreshes hourly); otherwise refresh live
//   node tools/rook.mjs result <file>   (a RUNNING line first if the run has not ended) a run's final reply + tokens: claude2 stream-json (.jsonl), or a Codex -o file (tokens from its .log)
//   node tools/rook.mjs review <sha> <brief> <out.jsonl> [--as bishop|king] [--from <clone> <branch>] [--over]   launch the reviewer on a commit, detached; without --as: Bishop, or King when Bishop's reviewer folder is locked
//   node tools/rook.mjs build <brief> <out.jsonl> <branch> <sha> [--as king|bishop] [--dir king2] [--fix] [--regrilled] [--tool] [--no-fresh] [--over] [--big] [--review <review brief> <review out.jsonl>]   launch a Claude build on a new branch in its worktree, detached
//   node tools/rook.mjs knight <brief> <report.txt> <branch> <sha> [--fix] [--regrilled] [--tool] [--no-fresh] [--over] [--big] [--review <review brief> <review out.jsonl>]   launch a Knight build on a new branch in its clone, detached
//     New items naming grill-<id>.md require runs<N>/fresh-<id>.out; --fix / --tool are exempt; --no-fresh passes for an S item with no invariant.
//     --review: when the build ends, tools/rook-end.mjs launches `review <branch tip> <review brief> <review out>`; no chain (and `NO REVIEW: <why>` in the review out file) when the branch has no new commit or the build ended in error
//     every launch writes `<kind> <branch|sha> -> <out file>: running` into runs<N>/queue.txt (lines 1-2 stay) and the run's end rewrites it to `ended`
//     build / knight count against the handover gate (2 new items per Rook, tools/handover-gate.mjs): --fix = a fix round (allowed up to the 2nd fix round of an item, the 3rd needs --regrilled after a re-grill file runs<N>/grill-<id>-regrill.md; a brief whose line 1 starts `King fix`, `Knight fix` or `Fix round` counts as one without it),
//     --tool = a tool ticket (passes the gate, not counted as an item; the gate line adds `, <k> tool`), --over = a 3rd item with his OK
//   node tools/rook.mjs suite <sha> [--over]   full suite (`npm.cmd test`, then `npm.cmd run test:browser`) in this checkout, detached; <sha> must be HEAD; log runs<N>/suite-<sha>.log ends `SUITE unit=<code> browser=<code>`
//   node tools/rook.mjs retro [--over] [--events "<text>"] [--as king|bishop]   fill missing briefs from tools/briefs/retro*.txt, then the three retros of runs<N>/, detached; chosen account's cached 5h above 40% is refused (--over passes)
//   node tools/rook.mjs retro --handover [--uuid <id> --name "Rook S<N><x>"] [--as king|bishop] [--over]   ONE retro over the outgoing Rook's transcript (uuid + name default to rook-next.txt lines 1-2) -> runs<N>/retro<N><x>.out (x empty: retro<N>-0); refused above 70% cached 5h
//     review / build --as king (and review falling back to King) are refused above 85% cached King 5h (--over passes); `usage` prints `<name>: 100%` for an account at its limit
//   node tools/rook.mjs pawn <out.json> "<question>"   one Pawn (agy) lookup from ~/agy-research, detached; adds the https-only / no-commands / 3-pages / cite sentence
//   node tools/rook.mjs acad <item> [--as king|bishop]   acad on runs<N>/acad<item>.txt -> acad<item>.out, detached
//   --project <D|R|B|P|WF> (any command, default D, TODO 219b): runs the command for that project: its rook.config.json (folder from hq.json, env ROOK_HQ), runs folder from hq.json; refused when the name is unknown or the project has no rook.config.json
//   node tools/rook.mjs fresh <id> [--as king|bishop]   WORKFLOW step 2b on grill-<id>.md -> fresh-<id>.out, detached with a queue line
//   node tools/rook.mjs board <brief> <out> [--as king|bishop]   board / look (WORKFLOW.md line 194) on <brief> -> <out>, detached
//     retro / acad / board default to King while ProjectD-s15fix/.run-lock exists, else Bishop.
//   node tools/rook.mjs hq-install [--dry]   TODO 219d: copy kit/hq/ (WORKFLOW.md, global-CLAUDE.md, start-rook.ps1) to hq.json "hq" and CLAUDE.md to ~/.claude, ~/.claude-account2, ~/.claude-account3 (.bak of a changed file kept), Rook's memory once to the hq project's memory folder, and write the Startup Rook.lnk; idempotent, copies only, `--dry` prints the actions
//   node tools/rook.mjs local-init <KIT|WF> [--dry]   TODO 219e1: KIT copies D's kit/ to hq.json "kit" (default E:/Project B/Claude/rook-kit) with its rook.config.json, .gitignore, package.json, git init and one commit, and adds "kit" and projects.KIT to hq.json; WF does git init + .gitignore + rook.config.json (test `node build-wfs.mjs`) + one commit in hq.json's WF folder; idempotent, refuses a folder whose .git has other commits, `--dry` prints the actions
//   node tools/rook.mjs fails <log>   the failing steps of a browser-test or node:test log + the first 3 `+` / `-` lines after each, max 40 lines; `no failures in <log>`
//   node tools/rook.mjs handover <resume file> <name> [--no-retro]   refused unless the outgoing Rook's handover retro was launched (runs<N>/retro<N><x>.out named by rook-next.txt line 2; --no-retro passes), else appends a "Handover retro: read ..." line to the resume file; write rook-next.txt (new uuid, name, resume file) and print it; refused when the resume file is missing, has no runs<N> in its path, lacks the merge-due.log line, lacks the `select:Monitor,TaskStop` or `one ci-watch per push` line (the same lines `next` requires), or its line 2 lacks the grilling + domain-modeling skills; exactly 2 arguments; does not start Rook.lnk
//   node tools/rook.mjs wait <run file>... [--ci <sha>]   exits 0 on the first run that finished (`DONE <file>`; a .log: at its `SUITE ` line) or when the CI run for <sha> ends (`CI RUN <id> <conclusion>`; exit 1 `CI RUN none <reason>` when no run was found or the watcher failed); polls every 20 s
//   node tools/rook.mjs merge <n> <sha> [--no-retro]   merge PR <n> at the full <sha> if runs<N>/retro<N>.out is non-empty and runs<N>/retro<N>.applied exists (or --no-retro), <sha> is the PR head and its CI run succeeded; prints `MERGED #<n> <full sha>`
//   node tools/rook.mjs merge --due   the 05:00 IST task: merges the one open claude/session<N> PR (same checks, retro required) while today IST <= the date in merge-ok-until.txt; `NOTHING DUE` when none; logs to merge-due.log
//   node tools/rook.mjs next   start Rook.lnk (the uuid in rook-next.txt line 1) and wait up to 60 s for its transcript; prints `NEXT ROOK <uuid> started|already running|not started after 60 s`; refused when the resume file on line 3 (relative to the extras folder) lacks the merge-due.log line; a Rook started by next outlived its caller (Rook S35c, 2026-11-03, session id matched rook-next.txt)
//   node tools/rook.mjs gate   rewrite line 2 of runs<N>/queue.txt ("items since start ...") and print it
//   node tools/rook.mjs repo   print the project's GitHub repo (rook.config.json "github"); every gh call below gets it as --repo
//   TODO 219c: this file lives in kit/ (hq.json "kit" can point elsewhere); `node tools/rook.mjs` is a shim that runs it.
import { execSync, execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROOT, HQ, project, stripProjectFlag, hqConfig } from './project.mjs';
import { hqInstall } from './hq-install.mjs';
import { localInit } from './local-init.mjs';
import { cacheAge } from './rook-cache.mjs';
import { firstDone, peakContext } from './rook-result.mjs';
import { randomUUID } from 'node:crypto';
import { review, build, knight, suite, retro, pawn, acad, fresh, board, gate, handoverRetroName, runningNote, printRookContext, dedupePath, EXTRAS, REPO } from './rook-launch.mjs';

import { parseCsv } from './usage-agent.mjs';
// shortcut: the usage page's window maths stay in the project until TODO 219d; upgrade when they move into the kit.
const { codexWindow, resetLabel } = await import(pathToFileURL(join(ROOT, 'usage-site/public/usage-window.js')).href);

stripProjectFlag(process.argv); // TODO 219b: project.mjs has already read `--project <name>`; the commands below parse their own flags only
dedupePath(process.env); // TODO 206: every child below (and Rook.lnk's) inherits a PATH cmd.exe keeps

const U = join(ROOT, 'mockups', '_design', 'usage');
const [cmd, arg] = process.argv.slice(2);
const k = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : Math.round(n / 1e3) + 'k');
const label = (a) => ({ Rowan: 'Knight', Pip: 'Bishop' })[a] || a;

export function claudeUsage(bin, execute = execSync, report = console.error) {
  const env = { ...process.env };
  if (bin === 'claude') delete env.CLAUDE_CONFIG_DIR;
  for (let attempt = 0; attempt < (bin === 'claude' ? 2 : 1); attempt++) {
    let out = '';
    try {
      out = execute(`echo Reply OK| ${bin} -p --model claude-haiku-5-5 --output-format stream-json --verbose`, { encoding: 'utf8', env, windowsHide: true, timeout: 45_000, maxBuffer: 1024 * 1024 });
      const w = JSON.parse(out.split('\n').find((l) => l.includes('rate_limit_event'))).rate_limit_info.unifiedWindows;
      if (![w.five_hour.utilization, w.five_hour.resetsAt, w.seven_day.utilization, w.seven_day.resetsAt].every(Number.isFinite)) throw new Error('Invalid usage reading');
      return { h5: [w.five_hour.utilization * 100, w.five_hour.resetsAt], wk: [w.seven_day.utilization * 100, w.seven_day.resetsAt] };
    } catch (e) {
      report(String(e.message).slice(0, 300)); // the stream stays out of Rook's context; `output` below keeps it for the limit check
      if (bin === 'claude' && attempt === 0) continue;
      const output = `${e.message}\n${out}\n${e.stdout || ''}\n${e.stderr || ''}`;
      const limited = /limit (?:has been |is )?reached|you[’']?ve hit your[^\n]*limit|rate_limit_error|usage_limit_reached/i.test(output);
      const who = bin === 'claude' ? 'Rook' : /claude3/.test(bin) ? 'King' : 'Bishop';
      throw limited ? Object.assign(new Error(`${{ Rook: 'Main', King: 'Third' }[who] || 'Second'} account: 100%, limit reached`), { reset: /resets? ([^\n·"]*)/i.exec(output)?.[1].trim() || '' })
        : new Error(`${who} usage probe failed, exit ${Number.isInteger(e.status) ? e.status : 'unknown'}`);
    }
  }
}

// TODO 196a: an account that hit its limit is at 100%, not a failed probe: { limited: <reset text or ''> } in place of a reading (other failures still throw).
export function usageProbe(bin, execute = execSync, report = console.error) {
  try { return claudeUsage(bin, execute, report); }
  catch (e) { if (e.reset !== undefined) return { limited: e.reset }; throw e; }
}
// The limits.csv rows of a limited account: 5h at 100% (the old 5h window kept while it is still ahead, so a gate reads the row as stale once it passes) and the last week row as written (a limited probe says nothing of the week).
export function limitedRows(a, role, model, oldLimits, now, asOf) {
  const old = (w) => oldLimits.find((r) => (a === 'Pip' ? ['Pip', 'Bishop'] : [a]).includes(r.agent) && r.window === w);
  const h5 = old('5h'), wk = old('week'), keep = h5 && Date.parse(h5.resets) > now ? h5 : { starts: '', resets: '' };
  return [[a, role, model, '5h', 100, '', keep.starts, keep.resets, asOf], ...(wk ? [[a, role, model, 'week', wk.used_pct, wk.cap_pct, wk.starts, wk.resets, wk.as_of]] : [])].map((r) => r.join(','));
}
// IST calendar days since the week start, counting the start day (TODO 207bfix: not 24 h blocks); cap 14% a day
export const capDays = (now, start) => Math.floor((now + 198e5) / 864e5) - Math.floor((start + 198e5) / 864e5) + 1;
export const weekCap = (now, start) => Math.min(100, 14 * capDays(now, start));
export const limitedLine =(name, limited, suffix = '') => `${name}: 100%${limited ? ` (resets ${limited})` : ''}${suffix}`;

// Git Bash, not WSL's bash.exe that PowerShell may find first: `git --exec-path` is <Git>/mingw64/libexec/git-core, three levels below <Git>.
export function gitBash(exec = execFileSync, exists = existsSync) {
  try {
    const bash = join(exec('git', ['--exec-path'], { encoding: 'utf8' }).trim(), '..', '..', '..', 'bin', 'bash.exe');
    if (exists(bash)) return bash;
  } catch { /* no git on the PATH: fall back */ }
  return 'bash';
}

// Runs ci-watch.sh for <sha>: forwards its stderr; every end prints one `CI RUN ...` line (TODO 190a):
// `CI RUN <id> <conclusion>` and exit 0 at the RUN line, else `CI RUN none <reason>` and exit 1 (no run found / unknown sha / watcher failed or ended without a RUN line).
// keep (wait with run files): a `none` line is printed but does not exit, the files are still waited on.
export function watchCi(sha, spawnFn = spawn, exit = process.exit, bash = gitBash(), keep = false) {
  const tools = dirname(fileURLToPath(import.meta.url));
  const ci = spawnFn(bash, [join(tools, 'ci-watch.sh'), sha, '--repo', project.github], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
  process.on('exit', () => ci.kill()); // a killed wait must not leave the watcher holding the pipes
  let done = false;
  const end = (line, code) => { if (!done) { done = true; console.log(line); if (!(keep && code)) exit(code); } };
  const scan = (lines) => {
    const run = lines.find((l) => l.startsWith('RUN '));
    if (run) return end(`CI ${run}`, 0);
    const none = lines.find((l) => /^(no CI run found|unknown sha)/.test(l));
    if (none) end(`CI RUN none ${none}`, 1);
  };
  ci.stderr.on('data', (d) => process.stderr.write(d));
  let buf = '';
  ci.stdout.on('data', (d) => {
    const lines = (buf += d).split(/\r?\n/);
    buf = lines.pop();
    scan(lines);
  });
  ci.on('error', (e) => end(`CI RUN none watcher not started: ${e.message}`, 1));
  ci.on('close', (c) => {
    scan(buf.split(/\r?\n/));
    if (c) console.error(`ci-watch.sh ended with exit ${c}`);
    end(`CI RUN none ci-watch.sh ${c ? `exit ${c}` : 'ended without a RUN line'}`, 1);
  });
}

// `next`: starts Rook.lnk (the next Rook, uuid = rook-next.txt line 1) and waits up to 60 s for its transcript; returns { line, code }.
// All effects are injected so the test starts nothing.
// Not `detached`: a detached powershell has no console and its Start-Process of a .lnk silently starts nothing (TODO 192).
// PowerShell ends a '...' string on ASCII and curly single quotes alike: double them all.
export const startArgs = (lnk) => ['powershell.exe', ['-NoProfile', '-Command', `Start-Process '${lnk.replace(/['‘’‚‛]/g, '$&$&')}'`], { stdio: 'ignore' }];

// Spawns [bin, args, opts] unref'd; a spawn error or non-zero exit goes to onFail as the reason line.
export function startWatched([bin, args, opts], onFail, spawnFn = spawn) {
  spawnFn(bin, args, opts).on('error', (e) => onFail(`spawn error: ${e.message}`)).on('exit', (c) => { if (c) onFail(`${bin} exit ${c}`); }).unref();
}

// The resume lines besides merge-due.log that `handover` and `next` both require (TODO 198c); `handover` refuses what `next` would.
const RESUME_NEEDS = ['select:Monitor,TaskStop', 'one ci-watch per push'];
const checkResumeNeeds = (text, resume) => { for (const need of RESUME_NEEDS) if (!text.includes(need)) throw new Error(`refused: ${resume} has no line containing "${need}"`); };

// `why` (optional) returns the spawn's error / exit code, appended to the "not started" line.
// The resume file named on rook-next.txt line 3 must have a line mentioning merge-due.log (TODO 193b); shortcut: no line 3 = no check.
export async function nextRook({ read, exists, start, sleep, now, projects, own, why = () => '', readFile = (p) => readFileSync(p, 'utf8') }) {
  const [uuid, , resume = ''] = read().split(/\r?\n/).map((l) => l.trim());
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(uuid)) throw new Error('rook-next.txt line 1 is not a uuid');
  if (uuid === own) throw new Error('rook-next.txt names this session: write the handover first');
  if (resume) {
    let text = '';
    try { text = readFile(resolve(EXTRAS, resume)); } catch { /* reported below */ }
    if (!text.includes('merge-due.log')) throw new Error(`refused: ${resume} is missing or has no line "read the last line of ../${basename(EXTRAS)}/merge-due.log first"`);
    checkResumeNeeds(text, resume);
  }
  const seen = () => exists(`${projects}/${uuid}.jsonl`);
  if (seen()) return { code: 0, line: `NEXT ROOK ${uuid} already running` };
  start();
  for (const t0 = now(); now() - t0 < 60_000;) {
    await sleep(2000);
    if (seen()) return { code: 0, line: `NEXT ROOK ${uuid} started` };
  }
  return { code: 1, line: `NEXT ROOK ${uuid} not started after 60 s${why() ? ` (${why()})` : ''}` };
}

// `wait <run file>... [--ci <sha>]`: checks now and every 20 s; prints `DONE <file>` for the first finished run or `CI <RUN line>` and exits 0 (TODO 167a).
function wait(args) {
  const i = args.indexOf('--ci'), files = i < 0 ? args : args.slice(0, i), sha = i < 0 ? '' : args[i + 1];
  if ((!files.length && !sha) || (i >= 0 && (!sha || args.length > i + 2))) { console.error('usage: node tools/rook.mjs wait <run file>... [--ci <sha>]'); process.exit(1); }
  if (sha) watchCi(sha, spawn, process.exit, gitBash(), files.length > 0);
  const check = () => {
    const texts = Object.fromEntries(files.map((f) => [f, existsSync(f) ? readFileSync(f, 'utf8') : null]));
    const done = firstDone(texts);
    if (done) { console.log(`DONE ${done}`); process.exit(0); }
  };
  check();
  setInterval(check, 20_000);
}

// The merge checks (TODO 167b): '' when the merge may go ahead, else the one-line refusal. retro = the retro file's text or null.
export function mergeRefusal({ n, pr, sha, head, retro, applied, noRetro, ci }) {
  if (!noRetro && !(retro || '').trim()) return `refused: runs${n}/retro${n}.out is missing or empty (run the retro, or pass --no-retro)`;
  if (!noRetro && retro.trim().length < 300 && /hit your .*limit/i.test(retro)) return `refused: runs${n}/retro${n}.out is only a usage-limit message (the retro did not run: re-run it after the limit resets, or pass --no-retro)`; // TODO 196a
  if (!noRetro && !applied) return `refused: runs${n}/retro${n}.applied is missing (apply the retro suggestions, then write it, or pass --no-retro)`; // TODO 193b
  if (head !== sha) return `refused: ${sha} is not the head of PR #${pr} (head is ${head})`;
  if (ci !== 'success') return `refused: CI for ${sha} is ${ci || 'not found'}, not success`;
  return '';
}

// TODO 219c: every gh call names the repo from rook.config.json "github", never the one gh guesses from the folder.
const gh = (run, ...a) => run('gh', [...a, '--repo', project.github]);

// `merge <n> <sha> [--no-retro]`: checks, merges, confirms; returns the `MERGED` line or throws the refusal.
export function merge(args, run = (cmd, a) => execFileSync(cmd, a, { encoding: 'utf8', cwd: REPO }).trim(), extras = EXTRAS) {
  const noRetro = args.includes('--no-retro'), [pr, short, ...rest] = args.filter((a) => a !== '--no-retro');
  if (!/^\d+$/.test(pr || '') || !short || rest.length) throw new Error('usage: node tools/rook.mjs merge <n> <sha> [--no-retro]');
  const sha = run('git', ['rev-parse', '--verify', `${short}^{commit}`]);
  const info = JSON.parse(gh(run, 'pr', 'view', pr, '--json', 'headRefOid,headRefName'));
  const n = /^claude\/session(\d+)$/.exec(info.headRefName)?.[1];
  if (!n) throw new Error(`refused: PR #${pr} branch ${info.headRefName} is not claude/session<N>`);
  const retroFile = `${extras}/runs${n}/retro${n}.out`;
  const [r] = JSON.parse(gh(run, 'run', 'list', '--commit', sha, '--workflow', 'ci.yml', '--limit', '1', '--json', 'status,conclusion'));
  const retro = existsSync(retroFile) ? readFileSync(retroFile, 'utf8') : null;
  const applied = existsSync(`${extras}/runs${n}/retro${n}.applied`);
  const msg = mergeRefusal({ n, pr, sha, head: info.headRefOid, retro, applied, noRetro, ci: r &&(r.status === 'completed' ? r.conclusion : r.status) });
  if (msg) throw new Error(msg);
  gh(run, 'pr', 'merge', pr, '--merge', '--match-head-commit', sha);
  if (JSON.parse(gh(run, 'pr', 'view', pr, '--json', 'state')).state !== 'MERGED') throw new Error(`PR #${pr} is not MERGED after gh pr merge`);
  const noOut = !(retro || '').trim();
  if (noRetro && (noOut || !applied)) {
    mkdirSync(`${extras}/runs${+n + 1}`, { recursive: true });
    appendFileSync(`${extras}/runs${+n + 1}/resume-rook.txt`, noOut ? `retro${n} due first (merged without it)\n` : `retro${n} edits not applied (merged without retro${n}.applied)\n`);
  }
  return `MERGED #${pr} ${sha}`;
}

// `merge --due` (TODO 191, the 05:00 IST task): inside his OK window (extras/merge-ok-until.txt, an IST date), merges the one open claude/session<N> PR; logs each run to extras/merge-due.log. Throws the refusal.
export function mergeDue(run = (cmd, a) => execFileSync(cmd, a, { encoding: 'utf8', cwd: REPO }).trim(), extras = EXTRAS, now = Date.now()) {
  const ist = new Date(now + 19800e3).toISOString(); // shifted so the UTC fields read as IST
  let line;
  try {
    let until = '';
    try { until = readFileSync(`${extras}/merge-ok-until.txt`, 'utf8').trim(); } catch { /* refused below */ }
    const real = /^\d{4}-\d\d-\d\d$/.test(until) && !isNaN(Date.parse(until + 'T00:00Z')) && new Date(until + 'T00:00Z').toISOString().slice(0, 10) === until; // trim() above also strips a BOM
    if (!real) throw new Error('refused: merge-ok-until.txt is missing or unreadable: ask him');
    if (ist.slice(0, 10) > until) throw new Error(`refused: merge OK expired ${until}: ask him`);
    const prs = JSON.parse(gh(run, 'pr', 'list', '--state', 'open', '--json', 'number,headRefName,headRefOid')).filter((p) => /^claude\/session\d+$/.test(p.headRefName));
    if (prs.length > 1) throw new Error(`refused: ${prs.length} open claude/session PRs (${prs.map((p) => '#' + p.number).join(', ')})`);
    line = prs.length ? merge([String(prs[0].number), prs[0].headRefOid], run, extras) : 'NOTHING DUE';
  } catch (e) {
    appendFileSync(`${extras}/merge-due.log`, `${ist.slice(0, 16).replace('T', ' ')} ${e.message.trim().replace(/\s*\n\s*/g, ' ')}\n`);
    throw e;
  }
  appendFileSync(`${extras}/merge-due.log`, `${ist.slice(0, 16).replace('T', ' ')} ${line}\n`);
  return line;
}

// `fails <log>` (TODO 196g): the failing steps of a test log (browser test `[shard n/m] FAIL <step>`, node:test spec `✖ <name> (<ms>)`), each with its first 3 `+` / `-` assertion lines; ANSI stripped, at most 40 lines.
export function failLines(text, log) {
  const out = [];
  let left = 0;
  const lines = text.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /, '').replace(/^\[shard \d+\/\d+\] /, '')); // the browser runner prefixes its error lines too
  const summary = lines.findIndex((l) => /^\s*✖ failing tests:/.test(l)); // the spec reporter repeats every failure under it, now with its error: read those, not the inline ✖ lines
  for (const [i, line] of lines.entries()) {
    if (i === summary) { left = 0; continue; }
    const name = /^FAIL (.+?)\s*$/.exec(line) || (i > summary && /^\s*✖ (.+?)(?: \(\d[\d.]*ms\))?\s*$/.exec(line));
    if (name) { out.push(name[1]); left = 3; } else if (left && /^\s*[+-] (?!actual - expected)\S/.test(line)) { out.push(line.trim()); left--; }
  }
  const invalid = lines.filter((l) => /^SUITE INVALID/.test(l)).map((l) => l.trim()); // TODO 207a: an invalid suite run (HEAD moved) is never "no failures"
  if (out.length) return [...invalid, ...out].slice(0, 40);
  const red = /^SUITE unit=(\d+) browser=(\d+)\s*$/m.exec(lines.join('\n'));
  if (red && (red[1] !== '0' || red[2] !== '0')) return [...invalid, `red (unit=${red[1]} browser=${red[2]}) but no failing step lines found in ${log}`];
  if (invalid.length) return invalid;
  return [lines.some((l) => /^##\[error\]/.test(l)) ? `no failing step lines found in ${log}` : `no failures in ${log}`];
}

// `handover <resume file> <name>` (TODO 196g): writes rook-next.txt (uuid, name, resume file) for `next`; refused when the resume file is missing or its line 2 lacks the grilling + domain-modeling rule. Returns the 3 lines.
// TODO 219d `hq` (hq.json): the file is also written to "runs" (where the session number is read) and to "hq" whenever hq.hq is set (review of 219d1: the new Rook.lnk's start-rook.ps1 reads only <hq>/rook-next.txt, and it is installed mid-session 40).
export function handover(resume, name, extras = EXTRAS, uuid = randomUUID(), noRetro = false, hq = null) {
  if (!resume || !name || /[\r\n]/.test(name)) throw new Error('usage: node tools/rook.mjs handover <resume file> <name> [--no-retro]');
  if (!handoverRetroName(name)) throw new Error(`refused: name "${name}" must end in S<N> (like "Rook S38j"): the next handover's retro check needs it`);
  let text = '';
  try { text = readFileSync(resume, 'utf8'); } catch { throw new Error(`refused: ${resume} is missing`); }
  const line2 = text.split(/\r?\n/)[1] || '';
  if (!line2.includes('mattpocock-skills:grilling') || !line2.includes('mattpocock-skills:domain-modeling')) throw new Error(`refused: line 2 of ${resume} lacks mattpocock-skills:grilling and mattpocock-skills:domain-modeling`);
  if (!/runs\d+/.test(resolve(resume))) throw new Error(`refused: ${resume} has no runs<N> folder (the handover gate needs runs<N>/resume-rook.txt)`);
  if (!text.includes('merge-due.log')) throw new Error(`refused: ${resume} has no merge-due.log line (next needs it)`);
  checkResumeNeeds(text, resume);
  // TODO 206: rook-next.txt line 2 names the outgoing Rook; its handover retro must have been launched (its .out exists), or --no-retro.
  let prev = '';
  try { prev = readFileSync(`${extras}/rook-next.txt`, 'utf8').split(/\r?\n/)[1] || ''; } catch { /* first ever handover: no check */ }
  const m = handoverRetroName(prev);
  const retroOut = m && `runs${m.n}/${m.id}.out`;
  if (retroOut && !noRetro && !existsSync(`${extras}/${retroOut}`)) throw new Error(`refused: ${retroOut} is missing (run \`node tools/rook.mjs retro --handover\` for ${prev}, or pass --no-retro)`);
  if (retroOut && existsSync(`${extras}/${retroOut}`)) appendFileSync(resume, `${text.endsWith('\n') ? '' : '\n'}Handover retro: read ${retroOut} first and apply what it recommends.\n`);
  const lines = [uuid, name, resolve(resume).replaceAll('\\', '/')];
  const next = lines.join('\n') + '\n';
  for (const dir of new Set([extras, ...(hq ? [hq.runs, hq.hq] : [])].filter(Boolean))) { mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/rook-next.txt`, next); }
  return lines.join('\n');
}

// The CLI guard of `handover`: '' for `node rook.mjs handover <resume> <name>`, else the usage line (an unquoted name makes 3 arguments).
export const handoverArgsError = (argv) => argv.filter((a) => a !== '--no-retro').length > 5 ? 'usage: node tools/rook.mjs handover <resume file> <name> [--no-retro] (2 arguments; quote a name with spaces)' : '';

function main() {
if (cmd === 'result') {
  const running = runningNote(arg);
  if (running) console.log(running);
  if (arg.endsWith('.jsonl')) {
    const raw = readFileSync(arg, 'utf8');
    if (raw.startsWith('NO REVIEW:')) { console.log(raw.trim()); process.exit(0); } // TODO 167d: a review that was not chained
    const events = raw.trim().split('\n').filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }); // a run in progress has a half-written last line
    const r = events.findLast((e) => e.type === 'result');
    if (!r) { console.log('no result yet'); process.exit(1); }
    const u = r.usage;
    console.log(r.result);
    if (!u) process.exit(1); // LAUNCH DIED: the result has no usage
    const fresh = u.input_tokens + u.cache_creation_input_tokens + u.output_tokens;
    console.log(`tokens ${k(fresh + u.cache_read_input_tokens)} (${k(fresh)} new) · denials ${r.permission_denials.length}` + (r.permission_denials.length ? ': ' + r.permission_denials.map((d) => String(d.tool_input.command || d.tool_name).slice(0, 60)).join(' | ') : '') + ` · report ${String(r.result ?? '').split(/\r?\n/).filter((l) => l.trim()).length} lines`); // TODO 193a: the cap counts physical lines, blanks not
    const peak = peakContext(events);
    console.log(`peak context ${Math.round(peak / 1e3)}k` + (peak > 150_000 ? ' (over 150k: split the ticket)' : ''));
    printRookContext();
  } else {
    console.log(readFileSync(arg, 'utf8').trim());
    const log = arg.replace(/\.txt$/, '.log');
    const m = existsSync(log) && readFileSync(log, 'utf8').match(/tokens used\s*\n?\s*([\d,]+)/g);
    if (m) console.log('tokens ' + m.pop().replace(/tokens used\s*/, '').trim());
  }
} else if (cmd === 'usage') {
  const codex = () => {
    const files = [];
    const walk = (d) => readdirSync(d).forEach((f) => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith('.jsonl') && files.push(p); });
    const root = join(homedir(), '.codex', 'sessions');
    if (!existsSync(root)) return;
    walk(root);
    files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    for (const f of files.slice(0, 3)) {
      const m = [...readFileSync(f, 'utf8').matchAll(/"primary":\{"used_percent":([\d.]+),"window_minutes":\d+,"resets_at":(\d+)\},"secondary":\{"used_percent":([\d.]+),"window_minutes":\d+,"resets_at":(\d+)/g)].pop();
      if (m) return { h5: [+m[1], +m[2]], wk: [+m[3], +m[4]] };
    }
  };
  const now = Date.now(), iso = (t) => new Date(t + 19800e3).toISOString().slice(0, 19) + '+05:30';
  const ist = (s) => new Date(s * 1e3).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit' });
  let cached, suffix = ' (live)';
  if (arg === '--cached') {
    try {
      const age = cacheAge(['limits.csv', 'history.csv'].map((f) => statSync(join(U, f)).mtimeMs), now);
      if (age !== null) {
        const limits = parseCsv(readFileSync(join(U, 'limits.csv'), 'utf8'));
        cached = ['Rook', 'Pip', 'King', 'Rowan'].map((a) => {
          const names = a === 'Pip' ? ['Pip', 'Bishop'] : [a]; // 'Pip' = Bishop in the CSV and Firestore (the live site still reads it); a cache written under 'Bishop' still loads
          const h5 = limits.find((r) => names.includes(r.agent) && r.window === '5h');
          const wk = limits.find((r) => names.includes(r.agent) && r.window === 'week');
          return [a, h5?.role, h5?.model, h5 && wk ? { h5: [+h5.used_pct, h5.resets ? Date.parse(h5.resets) / 1e3 : null], wk: [+wk.used_pct, wk.resets ? Date.parse(wk.resets) / 1e3 : null] } : null];
        });
        if (cached.some(([a, , , u]) => !u && a !== 'Rowan')) cached = undefined; // a cache from before King: read live
        else {
        const time = new Date(now - age).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
        suffix = ` (as of ${time} IST, ${Math.floor(age / 60_000)} min old)`;
        }
      }
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  const agents = cached || [
    ['Rook', 'Lead (main account)', 'Opus 5.5', usageProbe('claude')],
    ['Pip', 'Builds and reviews (claude2)', 'Sonnet / Opus / Haiku', usageProbe('C:\\Users\\raksh\\.local\\bin\\claude2.cmd')],
    // King is new and the likeliest to fail: a failed probe skips King, it does not take Rook, Bishop and Knight down
    ['King', 'Builds and leads in Castle mode (claude3)', 'Sonnet', (() => { try { return usageProbe('C:\\Users\\raksh\\.local\\bin\\claude3.cmd'); } catch { return null; } })()],
    ['Rowan', 'Builder and web research (Codex)', 'gpt-6.1-sol', codex()],
  ];
  for (const [a, , , u] of agents) if (!u && a !== 'Rowan' && a !== 'King') throw new Error(`${label(a)} usage probe failed, exit unknown`);
  const rows = ['agent,role,model,window,used_pct,cap_pct,starts,resets,as_of'];
  if (!cached) mkdirSync(U, { recursive: true });
  let oldLimits = [];
  try { oldLimits = parseCsv(readFileSync(join(U, 'limits.csv'), 'utf8')); } catch { /* no file yet: no week to keep */ }
  for (const [a, role, model, u] of agents) {
    if (!u) { console.log(`${label(a)}: no reading${suffix}`); continue; }
    if (u.limited !== undefined) { // a limited probe says nothing of the week: keep the last week row as it was written (the cached read needs both rows)
      console.log(limitedLine(label(a), u.limited, suffix));
      if (!cached) {
        rows.push(...limitedRows(a, role, model, oldLimits, now, iso(now)));
        appendFileSync(join(U, 'history.csv'), `${iso(now)},${a},5h,100\n`);
      }
      continue;
    }
    if (a === 'Rowan') for (const w of ['h5', 'wk']) u[w] = codexWindow(u[w], now);
    const wkLen = 7 * 864e5, s = u.wk[1] * 1e3 - wkLen, el = now - s;
    const cap = a === 'Pip' || a === 'Rook' ? weekCap(now, s) : '';
    const atReset = el > 12 * 36e5 && u.wk[0] > 0 ? Math.round((u.wk[0] * wkLen) / el) : null;
    const fc = atReset == null ? 'too early' : atReset >= 100 ? `hits 100% ${ist((s + (el * 100) / u.wk[0]) / 1e3)}` : `~${atReset}% at reset`;
    console.log(`${label(a)}: 5h ${Math.round(u.h5[0])}% (${resetLabel(u.h5[1], ist)}) · week ${Math.round(u.wk[0])}%${cap ? ' of ' + cap + '% cap' + (a === 'Rook' ? ' today' : '') : ''} (${resetLabel(u.wk[1], ist)}) · ${fc}${suffix}`);
    if (cached) continue;
    rows.push([a, role, model, '5h', Math.round(u.h5[0]), '', u.h5[1] == null ? '' : iso(u.h5[1] * 1e3 - 5 * 36e5), u.h5[1] == null ? '' : iso(u.h5[1] * 1e3), iso(now)].join(','));
    rows.push([a, role, model, 'week', Math.round(u.wk[0]), cap, u.wk[1] == null ? '' : iso(s), u.wk[1] == null ? '' : iso(u.wk[1] * 1e3), iso(now)].join(','));
    appendFileSync(join(U, 'history.csv'), `${iso(now)},${a},5h,${Math.round(u.h5[0])}\n${iso(now)},${a},week,${Math.round(u.wk[0])}\n`);
  }
  if (!cached) writeFileSync(join(U, 'limits.csv'), rows.join('\n') + '\n');
} else if (['review', 'build', 'knight', 'suite', 'retro', 'pawn', 'acad', 'fresh', 'board'].includes(cmd)) {
  try { ({ review, build, knight, suite, retro, pawn, acad, fresh, board })[cmd](process.argv.slice(3)); }
  catch (e) { console.error(e.message); process.exit(1); }
} else if (cmd === 'hq-install') {
  try { hqInstall({ hq: hqConfig(), dry: process.argv.includes('--dry') }); }
  catch (e) { console.error(e.message); process.exit(1); }
} else if (cmd === 'local-init') {
  try { localInit({ name: arg, hqFile: HQ, root: ROOT, dry: process.argv.includes('--dry') }); }
  catch (e) { console.error(e.message); process.exit(1); }
} else if (cmd === 'fails') {
  try { console.log(failLines(readFileSync(arg, 'utf8'), arg).join('\n')); }
  catch (e) { console.error(e.message); process.exit(1); }
} else if (cmd === 'handover') {
  try {
    const bad = handoverArgsError(process.argv);
    if (bad) throw new Error(bad);
    const [resume, hname] = process.argv.slice(3).filter((a) => a !== '--no-retro');
    console.log(handover(resume, hname, EXTRAS, undefined, process.argv.includes('--no-retro'), hqConfig()));
  }
  catch (e) { console.error(e.message); process.exit(1); }
} else if (cmd === 'wait') {
  wait(process.argv.slice(3));
} else if (cmd === 'merge') {
  try { console.log(process.argv[3] === '--due' ? mergeDue() : merge(process.argv.slice(3))); }
  catch (e) { console.error(e.message); process.exit(1); }
} else if (cmd === 'gate') {
  try { console.log(gate()); }
  catch (e) { console.error(e.message); process.exit(1); }
} else if (cmd === 'repo') {
  console.log(project.github); // ci-watch.sh asks for it when called without --repo
} else if (cmd === 'next') {
  const lnk = join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Rook.lnk');
  let failure = '';
  nextRook({
    read: () => readFileSync(`${EXTRAS}/rook-next.txt`, 'utf8'), exists: existsSync, now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    start: () => startWatched(startArgs(lnk), (f) => { failure = f; }),
    why: () => failure,
    projects: join(homedir(), '.claude', 'projects', project.claudeProject), own: process.env.CLAUDE_CODE_SESSION_ID,
  }).then(({ line, code }) => { console.log(line); process.exitCode = code; }, (e) => { console.error(e.message); process.exitCode = 1; });
} else {
  console.log('usage: node tools/rook.mjs usage [--cached] | result <file> | wait <run file>... [--ci <sha>] | merge <n> <sha> [--no-retro] | gate | next | review <sha> <brief> <out.jsonl> [--as bishop|king] [--from <clone> <branch>] [--over] | build <brief> <out.jsonl> <branch> <sha> [--as king|bishop] [--dir king2] [--fix] [--regrilled] [--tool] [--no-fresh] [--over] [--big] [--review <review brief> <review out.jsonl>] | knight <brief> <report.txt> <branch> <sha> [--fix] [--regrilled] [--tool] [--no-fresh] [--over] [--big] [--review <review brief> <review out.jsonl>] | suite <sha> [--over] | retro [--over] [--events "<text>"] [--as king|bishop] | pawn <out.json> "<question>" | fresh <id> [--as king|bishop] | acad <item> [--as king|bishop] | board <brief> <out> [--as king|bishop] | fails <log> | handover <resume file> <name> | hq-install [--dry] | local-init <KIT|WF> [--dry] | any command: --project <D|R|B|P|WF>');
}
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); }
  catch (e) { console.error(e.stack || e.message); console.error(`USAGE_ERROR: ${e.message}`); process.exitCode = 1; }
}
