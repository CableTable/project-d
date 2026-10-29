// Rook's helpers: short output so the lead's context stays small (2026-10-20).
//   node tools/rook.mjs usage           one line per agent (+ week forecast); refreshes mockups/_design/usage/limits.csv, history.csv
//   node tools/rook.mjs usage --cached  read the CSVs if both are at most five minutes old; otherwise refresh live
//   node tools/rook.mjs result <file>   a run's final reply + tokens: claude2 stream-json (.jsonl), or a Codex -o file (tokens from its .log)
//   node tools/rook.mjs review <sha> <brief> <out.jsonl> [--as bishop|king] [--from <clone> <branch>]   launch the reviewer on a commit, detached
//   node tools/rook.mjs build <brief> <out.jsonl> <branch> <sha> [--as king|bishop]   launch a Claude build on a new branch in its worktree, detached
//   node tools/rook.mjs knight <brief> <report.txt> <branch> <sha>   launch a Knight build on a new branch in its clone, detached
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCsv } from './usage-agent.mjs';
import { cacheAge } from './rook-cache.mjs';
import { peakContext } from './rook-result.mjs';
import { codexWindow, resetLabel } from '../usage-site/public/usage-window.js';
import { review, build, knight } from './rook-launch.mjs';

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

function main() {
if (cmd === 'result') {
  if (arg.endsWith('.jsonl')) {
    const events = readFileSync(arg, 'utf8').trim().split('\n').filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }); // a run in progress has a half-written last line
    const r = events.findLast((e) => e.type === 'result');
    if (!r) { console.log('no result yet'); process.exit(1); }
    const u = r.usage;
    console.log(r.result);
    const fresh = u.input_tokens + u.cache_creation_input_tokens + u.output_tokens;
    console.log(`tokens ${k(fresh + u.cache_read_input_tokens)} (${k(fresh)} new) · denials ${r.permission_denials.length}` + (r.permission_denials.length ? ': ' + r.permission_denials.map((d) => String(d.tool_input.command || d.tool_name).slice(0, 60)).join(' | ') : ''));
    const peak = peakContext(events);
    console.log(`peak context ${Math.round(peak / 1e3)}k` + (peak > 150_000 ? ' (over 150k: split the ticket)' : ''));
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
} else if (cmd === 'review' || cmd === 'build' || cmd === 'knight') {
  try { ({ review, build, knight })[cmd](process.argv.slice(3)); }
  catch (e) { console.error(e.message); process.exit(1); }
} else {
  console.log('usage: node tools/rook.mjs usage [--cached] | result <file> | review <sha> <brief> <out.jsonl> [--as bishop|king] [--from <clone> <branch>] | build <brief> <out.jsonl> <branch> <sha> [--as king|bishop] | knight <brief> <report.txt> <branch> <sha>');
}
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); }
  catch (e) { console.error(e.stack || e.message); console.error(`USAGE_ERROR: ${e.message}`); process.exitCode = 1; }
}
