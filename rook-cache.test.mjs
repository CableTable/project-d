import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { cacheAge } from './tools/rook-cache.mjs';

test('usage cache expires only after five minutes, using the older of both files', () => {
  const now = 1_000_000;
  assert.equal(cacheAge([now, now - 299_999], now), 299_999);
  assert.equal(cacheAge([now - 300_000, now], now), 300_000);
  assert.equal(cacheAge([now, now - 300_001], now), null);
  assert.equal(cacheAge([now - 300_001, now], now), null);
  assert.equal(cacheAge([now], now), null);
  assert.equal(cacheAge([], now), null);
  assert.equal(cacheAge([NaN, now], now), null);
  assert.equal(cacheAge([now + 1, now], now), null);
});

test('cached usage shares live summaries, avoids processes and writes, and falls back when missing or stale', () => {
  const repo = mkdtempSync(join(tmpdir(), 'projectd-rook-'));
  try {
    mkdirSync(join(repo, 'tools'));
    const usage = join(repo, 'mockups', '_design', 'usage');
    mkdirSync(usage, { recursive: true });
    for (const file of ['rook.mjs', 'rook-cache.mjs', 'rook-result.mjs', 'usage-agent.mjs', 'usage-agent-policy.mjs']) {
      copyFileSync(new URL('./tools/' + file, import.meta.url), join(repo, 'tools', file));
    }
    writeFileSync(join(repo, 'package.json'), '{"type":"module"}');
    const now = Date.parse('2026-10-20T12:00:00Z'), asOf = now - 120_000;
    const reset5h = new Date(now + 3600_000).toISOString(), resetWeek = new Date(now + 5 * 86400_000).toISOString();
    const rows = ['agent,role,model,window,used_pct,cap_pct,starts,resets,as_of'];
    for (const a of ['Rook', 'Pip', 'Rowan']) {
      for (const [window, used, reset] of [['5h', 20, reset5h], ['week', 10, resetWeek]]) {
        rows.push(`${a},role,model,${window},${used},,,${reset},${new Date(asOf).toISOString()}`);
      }
    }
    writeFileSync(join(usage, 'limits.csv'), rows.join('\n') + '\n');
    writeFileSync(join(usage, 'history.csv'), `at,agent,window,used_pct\n${new Date(asOf).toISOString()},Pip,week,10\n`);
    for (const file of ['limits.csv', 'history.csv']) utimesSync(join(usage, file), asOf / 1000, asOf / 1000);
    writeFileSync(join(repo, 'guard.mjs'), `
      import child from 'node:child_process';
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      for (const key of ['execSync', 'execFileSync', 'spawnSync', 'exec', 'execFile', 'spawn', 'fork']) child[key] = () => { throw Error('child process'); };
      for (const key of ['writeFileSync', 'appendFileSync']) fs[key] = () => { throw Error('cache write'); };
      syncBuiltinESMExports();
      Date.now = () => ${now};
    `);
    const output = execFileSync(process.execPath, ['--import', './guard.mjs', 'tools/rook.mjs', 'usage', '--cached'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
    const lines = output.trim().split('\n');
    assert.equal(lines.length, 3);
    for (const [i, agent] of ['Rook', 'Bishop', 'Knight'].entries()) {
      assert.ok(lines[i].startsWith(`${agent}: 5h 20% (resets Tue 18:30) · week 10%`));
      assert.ok(lines[i].endsWith('· ~35% at reset (as of 17:28 IST, 2 min old)'));
    }
    assert.match(lines[1], /10% of 28% cap/);

    mkdirSync(join(repo, '.codex', 'sessions'), { recursive: true });
    writeFileSync(join(repo, '.codex', 'sessions', 'reading.jsonl'), JSON.stringify({
      primary: { used_percent: 20, window_minutes: 300, resets_at: Date.parse(reset5h) / 1000 },
      secondary: { used_percent: 10, window_minutes: 10080, resets_at: Date.parse(resetWeek) / 1000 },
    }));
    writeFileSync(join(repo, 'live.mjs'), `
      import assert from 'node:assert/strict';
      import child from 'node:child_process';
      import os from 'node:os';
      import { syncBuiltinESMExports } from 'node:module';
      let calls = 0;
      process.env.CLAUDE_CONFIG_DIR = 'account2-test';
      child.execSync = (command, { env }) => {
        assert.equal(env.CLAUDE_CONFIG_DIR, command.includes('claude2.cmd') ? 'account2-test' : undefined);
        assert.ok(env.PATH === process.env.PATH);
        assert.equal(process.env.CLAUDE_CONFIG_DIR, 'account2-test');
        calls++; return JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: {
        five_hour: { utilization: 0.2, resetsAt: ${Date.parse(reset5h) / 1000} },
        seven_day: { utilization: 0.1, resetsAt: ${Date.parse(resetWeek) / 1000} }
      } } }); };
      os.homedir = () => process.cwd();
      syncBuiltinESMExports();
      Date.now = () => ${now};
      process.on('exit', () => { if (calls !== 2) process.exitCode = 1; });
    `);
    for (const file of ['limits.csv', 'history.csv']) {
      for (const missing of [false, true]) {
        // The preceding live run restores both files; only this one file is invalidated.
        for (const name of ['limits.csv', 'history.csv']) utimesSync(join(usage, name), asOf / 1000, asOf / 1000);
        if (missing) rmSync(join(usage, file));
        else utimesSync(join(usage, file), (now - 300_001) / 1000, (now - 300_001) / 1000);
        const live = execFileSync(process.execPath, ['--import', './live.mjs', 'tools/rook.mjs', 'usage', '--cached'], { cwd: repo, encoding: 'utf8', timeout: 5000 });
        assert.deepEqual(live.trim().split('\n'), lines.map((line) => line.replace(/ \(as of .*\)$/, ' (live)')));
      }
    }
    rmSync(usage, { recursive: true });
    const live = execFileSync(process.execPath, ['--import', './live.mjs', 'tools/rook.mjs', 'usage', '--cached'], { cwd: repo, encoding: 'utf8', timeout: 5000 });
    assert.deepEqual(live.trim().split('\n'), lines.map((line) => line.replace(/ \(as of .*\)$/, ' (live)')));
    for (const missingRoot of [false, true]) {
      if (missingRoot) rmSync(join(repo, '.codex'), { recursive: true });
      else writeFileSync(join(repo, '.codex', 'sessions', 'reading.jsonl'), '{}\n');
      const partial = execFileSync(process.execPath, ['--import', './live.mjs', 'tools/rook.mjs', 'usage'], { cwd: repo, encoding: 'utf8', timeout: 5000 });
      assert.deepEqual(partial.trim().split('\n'), [...lines.slice(0, 2).map((line) => line.replace(/ \(as of .*\)$/, ' (live)')), 'Knight: no reading (live)']);
      const limits = readFileSync(join(usage, 'limits.csv'), 'utf8');
      assert.match(limits, /Rook,role|Rook,Lead/);
      assert.match(limits, /Pip,Builds/);
      assert.doesNotMatch(limits, /Rowan,/);
      assert.deepEqual(readFileSync(join(usage, 'history.csv'), 'utf8').trim().split('\n').slice(-4).map((row) => row.split(',')[1]), ['Rook', 'Rook', 'Pip', 'Pip']);
    }
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
