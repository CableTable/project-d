// Rook's helpers: short output so the lead's context stays small (2026-10-20).
//   node tools/rook.mjs usage           one line per agent (+ week forecast); refreshes mockups/_design/usage/limits.csv, history.csv
//   node tools/rook.mjs usage --cached  read the CSVs if both are at most five minutes old; otherwise refresh live
//   node tools/rook.mjs result <file>   a run's final reply + tokens: claude2 stream-json (.jsonl), or a Codex -o file (tokens from its .log)
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './usage-agent.mjs';
import { cacheAge } from './rook-cache.mjs';
import { peakContext } from './rook-result.mjs';

const U = join(dirname(fileURLToPath(import.meta.url)), '..', 'mockups', '_design', 'usage');
const [cmd, arg] = process.argv.slice(2);
const k = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : Math.round(n / 1e3) + 'k');

if (cmd === 'result') {
  if (arg.endsWith('.jsonl')) {
    const events = readFileSync(arg, 'utf8').trim().split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
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
  const claude = (bin) => {
    const out = execSync(`echo Reply OK| ${bin} -p --model claude-haiku-5-5 --output-format stream-json --verbose`, { encoding: 'utf8' });
    const w = JSON.parse(out.split('\n').find((l) => l.includes('rate_limit_event'))).rate_limit_info.unifiedWindows;
    return { h5: [w.five_hour.utilization * 100, w.five_hour.resetsAt], wk: [w.seven_day.utilization * 100, w.seven_day.resetsAt] };
  };
  const codex = () => {
    const files = [];
    const walk = (d) => readdirSync(d).forEach((f) => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith('.jsonl') && files.push(p); });
    walk(join(homedir(), '.codex', 'sessions'));
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
        cached = ['Rook', 'Pip', 'Rowan'].map((a) => {
          const h5 = limits.find((r) => r.agent === a && r.window === '5h');
          const wk = limits.find((r) => r.agent === a && r.window === 'week');
          return [a, h5?.role, h5?.model, h5 && wk ? { h5: [+h5.used_pct, Date.parse(h5.resets) / 1e3], wk: [+wk.used_pct, Date.parse(wk.resets) / 1e3] } : null];
        });
        const time = new Date(now - age).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
        suffix = ` (as of ${time} IST, ${Math.floor(age / 60_000)} min old)`;
      }
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  const agents = cached || [
    ['Rook', 'Lead (main account)', 'Opus 5.5', claude('claude')],
    ['Pip', 'Builds and reviews (claude2)', 'Sonnet / Opus / Haiku', claude('C:\\Users\\raksh\\.local\\bin\\claude2.cmd')],
    ['Rowan', 'Default builder (Codex)', 'gpt-6.1-sol', codex()],
  ];
  const rows = ['agent,role,model,window,used_pct,cap_pct,starts,resets,as_of'];
  if (!cached) mkdirSync(U, { recursive: true });
  for (const [a, role, model, u] of agents) {
    if (!u) { console.log(a + ': no reading' + suffix); continue; }
    const wkLen = 7 * 864e5, s = u.wk[1] * 1e3 - wkLen, el = now - s;
    const cap = a === 'Pip' ? Math.min(100, 14 * Math.ceil((now - s) / 864e5)) : '';
    const atReset = el > 12 * 36e5 && u.wk[0] > 0 ? Math.round((u.wk[0] * wkLen) / el) : null;
    const fc = atReset == null ? 'too early' : atReset >= 100 ? `hits 100% ${ist((s + (el * 100) / u.wk[0]) / 1e3)}` : `~${atReset}% at reset`;
    console.log(`${a}: 5h ${Math.round(u.h5[0])}% (resets ${ist(u.h5[1])}) · week ${Math.round(u.wk[0])}%${cap ? ' of ' + cap + '% cap' : ''} (resets ${ist(u.wk[1])}) · ${fc}${suffix}`);
    if (cached) continue;
    rows.push([a, role, model, '5h', Math.round(u.h5[0]), '', iso(u.h5[1] * 1e3 - 5 * 36e5), iso(u.h5[1] * 1e3), iso(now)].join(','));
    rows.push([a, role, model, 'week', Math.round(u.wk[0]), cap, iso(s), iso(u.wk[1] * 1e3), iso(now)].join(','));
    appendFileSync(join(U, 'history.csv'), `${iso(now)},${a},5h,${Math.round(u.h5[0])}\n${iso(now)},${a},week,${Math.round(u.wk[0])}\n`);
  }
  if (!cached) writeFileSync(join(U, 'limits.csv'), rows.join('\n') + '\n');
} else {
  console.log('usage: node tools/rook.mjs usage [--cached] | result <file>');
}
