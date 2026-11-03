// Rook's helpers: short output so the lead's context stays small (2026-10-20).
//   node tools/rook.mjs usage           one line per agent (+ week forecast); refreshes mockups/_design/usage/limits.csv, history.csv
//   node tools/rook.mjs usage --cached  read the CSVs if both are at most five minutes old; otherwise refresh live
//   node tools/rook.mjs result <file>   (a RUNNING line first if the run has not ended) a run's final reply + tokens: claude2 stream-json (.jsonl), or a Codex -o file (tokens from its .log)
//   node tools/rook.mjs review <sha> <brief> <out.jsonl> [--as bishop|king] [--from <clone> <branch>] [--over]   launch the reviewer on a commit, detached; without --as: Bishop, or King when Bishop's reviewer folder is locked
//   node tools/rook.mjs build <brief> <out.jsonl> <branch> <sha> [--as king|bishop] [--dir king2] [--fix] [--tool] [--over] [--big] [--review <review brief> <review out.jsonl>]   launch a Claude build on a new branch in its worktree, detached
//   node tools/rook.mjs knight <brief> <report.txt> <branch> <sha> [--fix] [--tool] [--over] [--big] [--review <review brief> <review out.jsonl>]   launch a Knight build on a new branch in its clone, detached
//     --review: when the build ends, tools/rook-end.mjs launches `review <branch tip> <review brief> <review out>`; no chain (and `NO REVIEW: <why>` in the review out file) when the branch has no new commit or the build ended in error
//     every launch writes `<kind> <branch|sha> -> <out file>: running` into runs<N>/queue.txt (lines 1-2 stay) and the run's end rewrites it to `ended`
//     build / knight count against the handover gate (2 new items per Rook, tools/handover-gate.mjs): --fix = a fix round (always allowed; a brief whose line 1 starts `King fix`, `Knight fix` or `Fix round` counts as one without it),
//     --tool = a tool ticket (passes the gate, not counted as an item; the gate line adds `, <k> tool`), --over = a 3rd item with his OK
//   node tools/rook.mjs suite <sha>   full suite (`npm.cmd test`, then `npm.cmd run test:browser`) in this checkout, detached; <sha> must be HEAD; log runs<N>/suite-<sha>.log ends `SUITE unit=<code> browser=<code>`
//   node tools/rook.mjs retro   the three retros of runs<N>/ (retro<N>, retro<N>king, retro<N>rook: .txt in, .out out) on Bishop, detached; refused when a .txt is missing
//   node tools/rook.mjs pawn <out.json> "<question>"   one Pawn (agy) lookup from ~/agy-research, detached; adds the https-only / no-commands / 3-pages / cite sentence
//   node tools/rook.mjs acad <item>   Bishop-acad on runs<N>/acad<item>.txt -> acad<item>.out, detached
//   node tools/rook.mjs wait <run file>... [--ci <sha>]   exits 0 on the first run that finished (`DONE <file>`; a .log: at its `SUITE ` line) or when the CI run for <sha> ends (`CI RUN <id> <conclusion>`; exit 1 `CI RUN none <reason>` when no run was found or the watcher failed); polls every 20 s
//   node tools/rook.mjs merge <n> <sha> [--no-retro]   merge PR <n> at the full <sha> if runs<N>/retro<N>.out is non-empty and runs<N>/retro<N>.applied exists (or --no-retro), <sha> is the PR head and its CI run succeeded; prints `MERGED #<n> <full sha>`
//   node tools/rook.mjs merge --due   the 05:00 IST task: merges the one open claude/session<N> PR (same checks, retro required) while today IST <= the date in merge-ok-until.txt; `NOTHING DUE` when none; logs to merge-due.log
//   node tools/rook.mjs next   start Rook.lnk (the uuid in rook-next.txt line 1) and wait up to 60 s for its transcript; prints `NEXT ROOK <uuid> started|already running|not started after 60 s`
//   node tools/rook.mjs gate   rewrite line 2 of runs<N>/queue.txt ("items since start ...") and print it
import { execSync, execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCsv } from './usage-agent.mjs';
import { cacheAge } from './rook-cache.mjs';
import { firstDone, peakContext } from './rook-result.mjs';
import { codexWindow, resetLabel } from '../usage-site/public/usage-window.js';
import { review, build, knight, suite, retro, pawn, acad, gate, runningNote, printRookContext, EXTRAS } from './rook-launch.mjs';

const U = join(dirname(fileURLToPath(import.meta.url)), '..', 'mockups', '_design', 'usage');
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
      report(`${e.stack || e.message}\n${out}\n${e.stdout || ''}\n${e.stderr || ''}`);
      if (bin === 'claude' && attempt === 0) continue;
      const output = `${e.message}\n${out}\n${e.stdout || ''}\n${e.stderr || ''}`;
      const limited = /limit (?:has been |is )?reached|you[’']?ve hit your[^\n]*limit|rate_limit_error|usage_limit_reached/i.test(output);
      const who = bin === 'claude' ? 'Rook' : /claude3/.test(bin) ? 'King' : 'Bishop';
      throw new Error(limited ? `${{ Rook: 'Main', King: 'Third' }[who] || 'Second'} account: 100%, limit reached`
        : `${who} usage probe failed, exit ${Number.isInteger(e.status) ? e.status : 'unknown'}`);
    }
  }
}

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
  const ci = spawnFn(bash, [join(tools, 'ci-watch.sh'), sha], { cwd: join(tools, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
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
export const startArgs = (lnk) => ['powershell.exe', ['-NoProfile', '-Command', `Start-Process '${lnk.replace(/'/g, "''")}'`], { stdio: 'ignore' }];

// `why` (optional) returns the spawn's error / exit code, appended to the "not started" line.
export async function nextRook({ read, exists, start, sleep, now, projects, own, why = () => '' }) {
  const uuid = read().split(/\r?\n/)[0].trim();
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(uuid)) throw new Error('rook-next.txt line 1 is not a uuid');
  if (uuid === own) throw new Error('rook-next.txt names this session: write the handover first');
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
  if (!noRetro && !applied) return `refused: runs${n}/retro${n}.applied is missing (apply the retro suggestions, then write it, or pass --no-retro)`; // TODO 193b
  if (head !== sha) return `refused: ${sha} is not the head of PR #${pr} (head is ${head})`;
  if (ci !== 'success') return `refused: CI for ${sha} is ${ci || 'not found'}, not success`;
  return '';
}

// `merge <n> <sha> [--no-retro]`: checks, merges, confirms; returns the `MERGED` line or throws the refusal.
export function merge(args, run = (cmd, a) => execFileSync(cmd, a, { encoding: 'utf8', cwd: join(dirname(fileURLToPath(import.meta.url)), '..') }).trim(), extras = EXTRAS) {
  const noRetro = args.includes('--no-retro'), [pr, short, ...rest] = args.filter((a) => a !== '--no-retro');
  if (!/^\d+$/.test(pr || '') || !short || rest.length) throw new Error('usage: node tools/rook.mjs merge <n> <sha> [--no-retro]');
  const sha = run('git', ['rev-parse', '--verify', `${short}^{commit}`]);
  const info = JSON.parse(run('gh', ['pr', 'view', pr, '--json', 'headRefOid,headRefName']));
  const n = /^claude\/session(\d+)$/.exec(info.headRefName)?.[1];
  if (!n) throw new Error(`refused: PR #${pr} branch ${info.headRefName} is not claude/session<N>`);
  const retroFile = `${extras}/runs${n}/retro${n}.out`;
  const [r] = JSON.parse(run('gh', ['run', 'list', '--commit', sha, '--workflow', 'ci.yml', '--limit', '1', '--json', 'status,conclusion']));
  const retro = existsSync(retroFile) ? readFileSync(retroFile, 'utf8') : null;
  const msg = mergeRefusal({ n, pr, sha, head: info.headRefOid, retro, applied: existsSync(`${extras}/runs${n}/retro${n}.applied`), noRetro, ci: r &&(r.status === 'completed' ? r.conclusion : r.status) });
  if (msg) throw new Error(msg);
  run('gh', ['pr', 'merge', pr, '--merge', '--match-head-commit', sha]);
  if (JSON.parse(run('gh', ['pr', 'view', pr, '--json', 'state'])).state !== 'MERGED') throw new Error(`PR #${pr} is not MERGED after gh pr merge`);
  if (noRetro && !(retro || '').trim()) {
    mkdirSync(`${extras}/runs${+n + 1}`, { recursive: true });
    appendFileSync(`${extras}/runs${+n + 1}/resume-rook.txt`, `retro${n} due first (merged without it)\n`);
  }
  return `MERGED #${pr} ${sha}`;
}

// `merge --due` (TODO 191, the 05:00 IST task): inside his OK window (extras/merge-ok-until.txt, an IST date), merges the one open claude/session<N> PR; logs each run to extras/merge-due.log. Throws the refusal.
export function mergeDue(run = (cmd, a) => execFileSync(cmd, a, { encoding: 'utf8', cwd: join(dirname(fileURLToPath(import.meta.url)), '..') }).trim(), extras = EXTRAS, now = Date.now()) {
  const ist = new Date(now + 19800e3).toISOString(); // shifted so the UTC fields read as IST
  let line;
  try {
    let until = '';
    try { until = readFileSync(`${extras}/merge-ok-until.txt`, 'utf8').trim(); } catch { /* refused below */ }
    const real = /^\d{4}-\d\d-\d\d$/.test(until) && !isNaN(Date.parse(until + 'T00:00Z')) && new Date(until + 'T00:00Z').toISOString().slice(0, 10) === until; // trim() above also strips a BOM
    if (!real) throw new Error('refused: merge-ok-until.txt is missing or unreadable: ask him');
    if (ist.slice(0, 10) > until) throw new Error(`refused: merge OK expired ${until}: ask him`);
    const prs = JSON.parse(run('gh', ['pr', 'list', '--state', 'open', '--json', 'number,headRefName,headRefOid'])).filter((p) => /^claude\/session\d+$/.test(p.headRefName));
    if (prs.length > 1) throw new Error(`refused: ${prs.length} open claude/session PRs (${prs.map((p) => '#' + p.number).join(', ')})`);
    line = prs.length ? merge([String(prs[0].number), prs[0].headRefOid], run, extras) : 'NOTHING DUE';
  } catch (e) {
    appendFileSync(`${extras}/merge-due.log`, `${ist.slice(0, 16).replace('T', ' ')} ${e.message.trim().replace(/\s*\n\s*/g, ' ')}\n`);
    throw e;
  }
  appendFileSync(`${extras}/merge-due.log`, `${ist.slice(0, 16).replace('T', ' ')} ${line}\n`);
  return line;
}

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
    ['Rook', 'Lead (main account)', 'Opus 5.5', claudeUsage('claude')],
    ['Pip', 'Builds and reviews (claude2)', 'Sonnet / Opus / Haiku', claudeUsage('C:\\Users\\raksh\\.local\\bin\\claude2.cmd')],
    // King is new and the likeliest to fail: a failed probe skips King, it does not take Rook, Bishop and Knight down
    ['King', 'Builds and leads in Castle mode (claude3)', 'Sonnet', (() => { try { return claudeUsage('C:\\Users\\raksh\\.local\\bin\\claude3.cmd'); } catch { return null; } })()],
    ['Rowan', 'Builder and web research (Codex)', 'gpt-6.1-sol', codex()],
  ];
  for (const [a, , , u] of agents) if (!u && a !== 'Rowan' && a !== 'King') throw new Error(`${label(a)} usage probe failed, exit unknown`);
  const rows = ['agent,role,model,window,used_pct,cap_pct,starts,resets,as_of'];
  if (!cached) mkdirSync(U, { recursive: true });
  for (const [a, role, model, u] of agents) {
    if (!u) { console.log(`${label(a)}: no reading${suffix}`); continue; }
    if (a === 'Rowan') for (const w of ['h5', 'wk']) u[w] = codexWindow(u[w], now);
    const wkLen = 7 * 864e5, s = u.wk[1] * 1e3 - wkLen, el = now - s;
    const cap = a === 'Pip' ? Math.min(100, 14 * Math.ceil((now - s) / 864e5)) : '';
    const atReset = el > 12 * 36e5 && u.wk[0] > 0 ? Math.round((u.wk[0] * wkLen) / el) : null;
    const fc = atReset == null ? 'too early' : atReset >= 100 ? `hits 100% ${ist((s + (el * 100) / u.wk[0]) / 1e3)}` : `~${atReset}% at reset`;
    console.log(`${label(a)}: 5h ${Math.round(u.h5[0])}% (${resetLabel(u.h5[1], ist)}) · week ${Math.round(u.wk[0])}%${cap ? ' of ' + cap + '% cap' : ''} (${resetLabel(u.wk[1], ist)}) · ${fc}${suffix}`);
    if (cached) continue;
    rows.push([a, role, model, '5h', Math.round(u.h5[0]), '', u.h5[1] == null ? '' : iso(u.h5[1] * 1e3 - 5 * 36e5), u.h5[1] == null ? '' : iso(u.h5[1] * 1e3), iso(now)].join(','));
    rows.push([a, role, model, 'week', Math.round(u.wk[0]), cap, u.wk[1] == null ? '' : iso(s), u.wk[1] == null ? '' : iso(u.wk[1] * 1e3), iso(now)].join(','));
    appendFileSync(join(U, 'history.csv'), `${iso(now)},${a},5h,${Math.round(u.h5[0])}\n${iso(now)},${a},week,${Math.round(u.wk[0])}\n`);
  }
  if (!cached) writeFileSync(join(U, 'limits.csv'), rows.join('\n') + '\n');
} else if (['review', 'build', 'knight', 'suite', 'retro', 'pawn', 'acad'].includes(cmd)) {
  try { ({ review, build, knight, suite, retro, pawn, acad })[cmd](process.argv.slice(3)); }
  catch (e) { console.error(e.message); process.exit(1); }
} else if (cmd === 'wait') {
  wait(process.argv.slice(3));
} else if (cmd === 'merge') {
  try { console.log(process.argv[3] === '--due' ? mergeDue() : merge(process.argv.slice(3))); }
  catch (e) { console.error(e.message); process.exit(1); }
} else if (cmd === 'gate') {
  try { console.log(gate()); }
  catch (e) { console.error(e.message); process.exit(1); }
} else if (cmd === 'next') {
  const lnk = join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Rook.lnk');
  let failure = '';
  nextRook({
    read: () => readFileSync(`${EXTRAS}/rook-next.txt`, 'utf8'), exists: existsSync, now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    start: () => {
      const [bin, args, opts] = startArgs(lnk);
      spawn(bin, args, opts).on('error', (e) => { failure = `spawn error: ${e.message}`; }).on('exit', (c) => { if (c) failure = `${bin} exit ${c}`; }).unref();
    },
    why: () => failure,
    projects: join(homedir(), '.claude', 'projects', 'E--Project-B-Claude-Project-D'), own: process.env.CLAUDE_CODE_SESSION_ID,
  }).then(({ line, code }) => { console.log(line); process.exitCode = code; }, (e) => { console.error(e.message); process.exitCode = 1; });
} else {
  console.log('usage: node tools/rook.mjs usage [--cached] | result <file> | wait <run file>... [--ci <sha>] | merge <n> <sha> [--no-retro] | gate | next | review <sha> <brief> <out.jsonl> [--as bishop|king] [--from <clone> <branch>] [--over] | build <brief> <out.jsonl> <branch> <sha> [--as king|bishop] [--dir king2] [--fix] [--tool] [--over] [--big] [--review <review brief> <review out.jsonl>] | knight <brief> <report.txt> <branch> <sha> [--fix] [--tool] [--over] [--big] [--review <review brief> <review out.jsonl>] | suite <sha> | retro | pawn <out.json> "<question>" | acad <item>');
}
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); }
  catch (e) { console.error(e.stack || e.message); console.error(`USAGE_ERROR: ${e.message}`); process.exitCode = 1; }
}
