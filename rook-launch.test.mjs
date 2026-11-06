import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { dedupePath, acad, acadArgs, board, boardArgs, pawn, pawnArgs, queueLineOf, retro, retroArgs, suite, launchFailed, launchRun, runningNote, parseReview, parseBuild, parseKnight, reviewerArgs, buildArgs, knightArgs, commandLine, review, build, knight, lintBrief, isFixBrief, fixRoundRefusal } from './tools/rook-launch.mjs';

const X = 'E:/Project B/Claude/Project D extras';
const REVIEWER = 'claude2.cmd -p --agent reviewer --model claude-opus-5-5 --effort medium --permission-mode dontAsk --max-budget-usd 6 '
  + `--add-dir "${X}" --disallowedTools Agent "Bash(git commit:*)" "Bash(git push:*)" "Bash(git add:*)" "Bash(git checkout:*)" `
  + '"Bash(git switch:*)" "Bash(git stash:*)" "Bash(git restore:*)" "Bash(git pull:*)" --output-format stream-json --verbose';
const BUILDER = 'claude2.cmd -p --agent builder --strict-mcp-config --model claude-sonnet-5-5 --effort high --permission-mode acceptEdits --max-budget-usd 8 '
  + `--add-dir "E:/Project B/Claude/Project D/.git" --add-dir "${X}" `
  + '--disallowedTools "Bash(gh pr merge:*)" "PowerShell(gh pr merge:*)" Agent "Bash(git push:*)" "Bash(taskkill:*)" "PowerShell(Stop-Process:*)" "Bash(node -e:*)" '
  + '--allowedTools "Bash(echo:*)" "Bash(tee:*)" "Bash(npx.cmd:*)" "Bash(npm.cmd:*)" "PowerShell(Select-String:*)" "PowerShell(Select-Object:*)" '
  + '"PowerShell(Write-Output:*)" "Bash(git add:*)" "Bash(git commit:*)" "Bash(git fetch:*)" "Bash(git checkout:*)" "Bash(git switch:*)" '
  + '"Bash(git cherry-pick:*)" "Bash(git rebase:*)" "Bash(git apply:*)" "Bash(git check-ignore:*)" "Bash(git merge --squash:*)" "Bash(git grep:*)" --output-format stream-json --verbose';

// A recorder in place of git / npm / files / the launch: `calls` is the plan in order; `fail` names a call that throws.
function recorder(fail = '') {
  const calls = [];
  const rec = (name, ret) => (...a) => { calls.push([name, ...a]); if (fail === name) throw new Error(`${name} failed`); return ret; };
  const open = (path, mode) => { calls.push(['open', path, mode]); if (fail === 'open') throw new Error('open failed'); return `fd:${path}`; };
  const git = (...a) => rec('git', a[1] === 'config' ? 'tools/hooks' : '')(...a);
  return { calls, x: { git, has: rec('has', true), need: rec('need'), read: rec('read', ''), exists: () => true, mtime: () => 0, locked: rec('locked', false), open, npmCi: rec('npmCi'), launch: (...a) => calls.push(['launch', ...a]), truncate: rec('truncate'), queue: { open: rec('queueOpen', { queue: 'q.txt', key: 'k', text: 'kind id -> k:' }), set: rec('queueSet') }, gate: { context: rec('gateContext'), check: rec('gateCheck'), record: rec('gateRecord'), queueFile: () => `${X}/runs33/queue.txt` } } };
}
const launched = (calls) => calls.find((c) => c[0] === 'launch');
const isSwitch = (c) => c[0] === 'git' && c[2] === 'switch';

test('Retro 38: retro, board and acad choose King while Bishop is locked; --as overrides either default', (t) => {
  t.mock.method(console, 'log', () => {});
  const runs = [[retro, ['--over']], [board, ['b.txt', 'o.out']], [acad, ['38']]];
  for (const [run, args] of runs) {
    for (const [locked, flags, bin] of [[true, [], 'claude3.cmd'], [false, [], 'claude2.cmd'], [true, ['--as', 'bishop'], 'claude2.cmd'], [false, ['--as', 'king'], 'claude3.cmd']]) {
      const r = recorder();
      r.x.locked = (dir) => locked && dir === `${X}/ProjectD-s15fix`;
      run([...args, ...flags], r.x);
      const launches = r.calls.filter((c) => c[0] === 'launch');
      assert.equal(launches.length, run === retro ? 3 : 1);
      assert.ok(launches.every((c) => basename(c[1]) === bin));
      assert.ok(r.calls.some((c) => c[0] === 'need' && c[2] === bin));
    }
    for (const flags of [['--as', 'rook'], ['--as'], ['--as', 'king', '--as', 'bishop']]) {
      const r = recorder();
      assert.throws(() => run([...args, ...flags], r.x), /usage:/);
      assert.equal(launched(r.calls), undefined);
    }
  }
});

test('Retro 38: retro gates the chosen account at 40 percent, and --over skips its cache', (t) => {
  t.mock.method(console, 'log', () => {});
  const future = new Date(Date.now() + 36e5).toISOString();
  for (const [locked, flags, who] of [[true, [], 'King'], [true, ['--as', 'bishop'], 'Bishop'], [false, ['--as', 'king'], 'King']]) {
    for (const high of [false, true]) {
      const r = withUsage(`King,5h,${who === 'King' ? (high ? 41 : 40) : 99},${future}\nBishop,5h,${who === 'Bishop' ? (high ? 41 : 40) : 99},${future}\n`);
      r.x.locked = (dir) => locked && dir === `${X}/ProjectD-s15fix`;
      const run = () => retro(flags, r.x);
      if (high) {
        assert.throws(run, new RegExp(`${who} 5h 41%`));
        assert.equal(r.calls.some((c) => ['open', 'launch'].includes(c[0])), false);
      } else { run(); assert.equal(r.calls.filter((c) => c[0] === 'launch').length, 3); }
      assert.equal(r.reads.length, 1);
    }
    const over = withUsage(`King,5h,99,${future}\nBishop,5h,99,${future}\n`);
    over.x.locked = (dir) => locked && dir === `${X}/ProjectD-s15fix`;
    retro([...flags, '--over'], over.x);
    assert.deepEqual(over.reads, []);
    assert.equal(over.calls.filter((c) => c[0] === 'launch').length, 3);
  }
});

test('Retro 38: new builds and Knights require fresh reads for each named grill; flag, fix and tool pass', (t) => {
  t.mock.method(console, 'log', () => {});
  for (const [run, out] of [[build, 'o.jsonl'], [knight, 'k.txt']]) {
    for (const [flags, text, files, passes] of [
      [[], 'Spec: ../runs33/grill-dwg.md', [], false],
      [['--big', '--over'], 'Spec: ../runs33/grill-dwg.md', [], false],
      [[], 'Spec: ../runs33/grill-dwg.md', ['dwg'], true],
      [['--no-fresh'], 'Spec: ../runs33/grill-dwg.md', [], true],
      [['--fix'], 'Spec: ../runs33/grill-dwg.md', [], true],
      [['--tool'], 'Spec: ../runs33/grill-dwg.md', [], true],
      [[], 'Knight fix: dwg\nSpec: ../runs33/grill-dwg.md', [], true],
      [[], 'No grill needed', [], true],
      [[], 'Spec: grill-dwg.md and grill-dwg-2.md', ['dwg'], false],
      [[], 'Spec: grill-dwg.md and grill-dwg-2.md', ['dwg', 'dwg-2'], true],
    ]) {
      const r = withUsage('King,5h,0,\n');
      r.x.read = (path) => path.endsWith('limits.csv') ? 'agent,window,used_pct\nKing,5h,0\n' : text;
      r.x.exists = (path) => files.some((id) => path === `${X}/runs33/fresh-${id}.out`);
      const launch = () => run(['b.txt', out, 'br', 'abc1234', ...flags], r.x);
      if (passes) { launch(); assert.ok(launched(r.calls)); }
      else {
        assert.throws(launch, { message: 'fresh read due (--no-fresh for an S item with no invariant)' });
        assert.equal(r.calls.some((c) => ['git', 'open', 'truncate', 'launch'].includes(c[0])), false);
      }
    }
  }
});

test('Retro 38: cargo lint requires no cargo on the same line', () => {
  for (const eol of ['\n', '\r\n']) {
    for (const [brief, count] of [['Run cargo test', 1], ['No cargo here; CI compiles Rust', 0], ['NO CARGO; skip cargo test', 0], ['No cargo here\nRun cargo test', 1], ['Check cargo.toml', 1], ['Check the cargo_hold name', 0]]) {
      const problems = lintBrief(brief.replaceAll('\n', eol));
      assert.equal(problems.length, count, brief);
      if (count) assert.match(problems[0], /line \d+: cargo is unavailable/);
    }
  }
});

test('TODO 190b: every-caller lint uses the six Q7 corpus lines verbatim, including numbered-item continuations', () => {
  const corpus = [
    ["1. Add `minus: '<path d=\"M5 12h14\"/>'` beside `plus` in web/dom.js and use `icon('plus' | 'minus', <size>)` for the glyph in all 7 buttons:", 1],
    ['   Case grid: every button whose visible text starts with a typed "+" or "−" in web/*.js: grep for it and list any other you find in the report (fix only these two plus any exact same kind).', 1],
    ['2. Every caller of commit that adds objects (Mirror ~7865, ~7434, ~7458, ~4596, Copy, Array, and any other grep finds) does `if (!commit(...)) return` and ends or keeps its command cleanly, with no success note.', 1],
    ['King fix: TODO 184 fix round 4 (every commit caller checks its result, guarded by a test). Branch king/184fix4 from ba4c858 (already switched for you).', 0],
    ['Commit "TODO 184 fix 4: every commit caller stops on false; guard test".', 0],
    ['Spec: "../runs33/grill-187.md" and "../runs33/grill-184.md" (read both). Keep 184\'s rule (every commit caller stops when commit returns false; commit-callers.test.mjs) and 187\'s Layout object path (layGripCommit when d.vlay, propLocked) working.', 0],
  ];
  for (const eol of ['\n', '\r\n']) {
    for (const [line, count] of corpus) {
      const brief = line.startsWith('   ') ? `2. Fix the guide buttons${eol}${line}` : line;
      assert.equal(lintBrief(brief).length, count, line);
    }
    for (const [line, count] of [
      ['1. Check every caller with grep -n "commit" web/app.js', 0],
      ['1. Check all sites with `grep "commit" web/app.js`', 0],
      ['1. List every button changed', 1],
      [`1. Fix the launcher${eol}Spec: every caller stays working`, 0],
    ]) assert.equal(lintBrief(line).length, count, line);
  }
});

test('TODO 190b: build briefs require an Old steps line; fix briefs do not', () => {
  for (const eol of ['\n', '\r\n']) {
    const brief = ['Build: TODO 190b', 'Do:', '1. Fix the launcher'].join(eol);
    assert.deepEqual(lintBrief(brief), ['build brief needs an Old steps line']);
    assert.deepEqual(lintBrief(`${brief}${eol}Old steps: none (no UI change)`), []);
    assert.deepEqual(lintBrief(brief.replace('Build:', 'Knight fix:')), []);
    assert.deepEqual(lintBrief(`${brief}${eol}Mention Old steps here`), ['build brief needs an Old steps line']);
  }
});

test('TODO 190b fix: the Old steps rule also sees a BOM-first build brief (BOM / none x Build / fix / review)', () => {
  const need = ['build brief needs an Old steps line'];
  for (const [bom, first, expected] of [['', 'Build: TODO 1', need], ['﻿', 'Build: TODO 1', need], ['', 'Knight fix: TODO 1', []], ['﻿', 'King fix: TODO 1', []], ['', 'Review: TODO 1', []], ['﻿', 'Review: TODO 1', []]]) {
    assert.deepEqual(lintBrief(`${bom}${first}\n1. Fix the launcher`), expected, JSON.stringify([bom, first]));
  }
});

test('TODO 190b fix: the usage gate skips a row whose resets time is past, and is skipped when Bishop is locked and no --as was given', (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'log', () => {});
  const csv = (resets) => `agent,window,used_pct,resets\nPip,5h,90,${resets}\n`;
  const future = new Date(Date.now() + 36e5).toISOString();
  for (const [resets, flags, locked, refused] of [['2020-01-01T00:00:00+05:30', [], false, false], [future, [], false, true], ['', [], false, true], [future, ['--as', 'bishop'], true, true], [future, [], true, false]]) {
    const r = recorder();
    r.x.read = () => csv(resets);
    r.x.locked = (dir) => locked && dir.endsWith('ProjectD-s15fix'); // only Bishop's folder is locked
    const run = () => review(['abc1234', 'b.txt', 'o.jsonl', ...flags], r.x);
    if (refused) assert.throws(run, /Bishop 5h 90%/, JSON.stringify([resets, flags, locked]));
    else { run(); assert.ok(launched(r.calls)); }
  }
});

test('TODO 190b: knight refuses runs-folder screenshots before changes, even with overrides', () => {
  for (const flags of [[], ['--big'], ['--over'], ['--fix']]) {
    const r = recorder();
    r.x.read = () => 'Screenshots: ../runs35/shots190b/';
    assert.throws(() => knight(['b.txt', 'k.txt', 'br', 'abc1234', ...flags], r.x), /shots go in shots-<id>\/ in the clone root/);
    assert.equal(r.calls.some((c) => ['git', 'open', 'truncate', 'launch'].includes(c[0])), false);
  }
  const r = recorder();
  r.x.read = () => 'Screenshots: shots-190b/';
  knight(['b.txt', 'k.txt', 'br', 'abc1234'], r.x);
  assert.ok(launched(r.calls));
});

test('TODO 190b: needClean quits cherry-pick after a clean status, tolerates no operation, never quits when dirty', (t) => {
  t.mock.method(console, 'error', () => {});
  for (const [run, args] of [[build, ['b.txt', 'o.jsonl', 'br', 'abc1234']], [knight, ['b.txt', 'k.txt', 'br', 'abc1234']], [review, ['abc1234', 'b.txt', 'o.jsonl']]]) {
    for (const noPick of [false, true]) {
      const r = recorder(), git = r.x.git;
      r.x.git = (...a) => {
        const result = git(...a);
        if (a[1] === 'cherry-pick' && noPick) throw new Error('no cherry-pick in progress');
        return a[1] === 'status' ? '?? tmp-untracked.mjs' : result;
      };
      run(args, r.x);
      const at = r.calls.findIndex((c) => c[0] === 'git' && c[2] === 'status');
      assert.deepEqual(r.calls[at + 1], ['git', r.calls[at][1], 'cherry-pick', '--quit']);
      assert.ok(launched(r.calls));
    }
    const dirty = recorder(), git = dirty.x.git;
    dirty.x.git = (...a) => a[1] === 'status' ? ' M tracked.mjs' : git(...a);
    assert.throws(() => run(args, dirty.x), /tracked changes/);
    assert.equal(dirty.calls.some((c) => c[0] === 'git' && c[2] === 'cherry-pick'), false);
    assert.equal(launched(dirty.calls), undefined);
  }
});

test('TODO 190b: review gates Bishop above 85 percent; King, over and unavailable cache pass', (t) => {
  const warnings = t.mock.method(console, 'error', () => {});
  const csv = (agent, percent) => `agent,window,used_pct\nKing,5h,99\n${agent},week,100\n${agent},5h,${percent}\n`;
  for (const agent of ['Pip', 'Bishop']) {
    for (const [percent, flags] of [[86, []], [85, []], [86, ['--as', 'bishop']], [85, ['--as', 'bishop']]]) {
      const r = recorder(), reads = [];
      r.x.read = (path) => { reads.push(path); return csv(agent, percent); };
      const run = () => review(['abc1234', 'b.txt', 'o.jsonl', ...flags], r.x);
      if (percent > 85) {
        assert.throws(run, /Bishop 5h 86%: use --as king, or --over/);
        assert.equal(r.calls.some((c) => isSwitch(c) || ['open', 'npmCi', 'launch'].includes(c[0])), false);
      } else {
        run();
        assert.ok(launched(r.calls));
      }
      assert.deepEqual(reads, [resolve('mockups/_design/usage/limits.csv')]);
    }
  }
  for (const flags of [['--over'], ['--as', 'king', '--over']]) { // TODO 196a: --as king alone now reads King's 99% and is refused
    const r = recorder(), reads = [];
    r.x.read = (path) => { reads.push(path); return csv('Pip', 99); };
    review(['abc1234', 'b.txt', 'o.jsonl', ...flags], r.x);
    assert.ok(launched(r.calls));
    assert.deepEqual(reads, []);
  }
  for (const reading of [new Error('ENOENT'), new Error('EACCES'), '', 'invalid csv', csv('Pip', 'invalid'), csv('Pip', 'Infinity'), csv('Pip', '')]) {
    const r = recorder(), before = warnings.mock.calls.length;
    r.x.read = () => { if (reading instanceof Error) throw reading; return reading; };
    review(['abc1234', 'b.txt', 'o.jsonl'], r.x);
    assert.ok(launched(r.calls));
    assert.match(warnings.mock.calls[before].arguments[0], /Bishop usage cache unavailable.*allowing review/);
  }
});

// A recorder whose limits.csv holds the given 5h readings; `reads` collects the cache reads.
function withUsage(rows) {
  const r = recorder(), reads = [];
  r.reads = reads;
  r.x.read = (path) => { if (!path.endsWith('limits.csv')) return ''; reads.push(path); return `agent,window,used_pct,resets\n${rows}`; };
  return r;
}

test('TODO 206: dedupePath drops empty and case-insensitive repeats, keeps first order, handles a Path key', () => {
  assert.deepEqual(dedupePath({ Path: 'C:\\A;c:\\a;;C:\\B;C:\\A\\;C:\\B', Other: 'x;x' }), { Path: 'C:\\A;C:\\B;C:\\A\\', Other: 'x;x' });
  assert.equal(dedupePath({ PATH: `${'C:\\Git;'.repeat(2000)}C:\\Z` }).PATH, 'C:\\Git;C:\\Z');
});

test('TODO 206: retro --handover launches one run over the named Rook transcript; defaults from rook-next.txt; 70% gate; refusals', (t) => {
  t.mock.method(console, 'log', () => {});
  const T = 'C:/Users/raksh/.claude/projects/E--Project-B-Claude-Project-D';
  const future = new Date(Date.now() + 36e5).toISOString();
  const mk = (rows = 'Pip,5h,70,' + future + '\n', next = 'aaaa-1111\nRook S33j\nr\n') => {
    const r = withUsage(rows), written = new Map(), read = r.x.read;
    r.x.exists = (p) => !p.endsWith('.txt');
    r.x.read = (p) => (p.endsWith('rook-next.txt') ? next : p.endsWith('.txt') ? 'N={N} S={SESSIONS} T={TRANSCRIPTS}' : read(p));
    r.x.write = (p, text) => written.set(p, text);
    return { r, written };
  };
  const a = mk();
  retro(['--handover'], a.r.x);
  const ls = a.r.calls.filter((c) => c[0] === 'launch');
  assert.equal(ls.length, 1);
  assert.equal(ls[0][7], `${X}/runs33/retro33j.out`);
  assert.equal(ls[0][9], `${X}/runs33/.run-lock-retro33j`);
  const brief = a.written.get(`${X}/runs33/retro33j.txt`);
  assert.ok(brief.startsWith(`N=33 S=Rook S33j T=${T}/aaaa-1111.jsonl`) && brief.includes('Handover retro: only this Rook; short (top 5 fixes)'));
  const b = mk();
  retro(['--handover', '--uuid', 'bbbb-2', '--name', 'Rook S33'], b.r.x); // no letter: retro33-0 (retro33h is "Rook S33h")
  assert.equal(b.r.calls.find((c) => c[0] === 'launch')[7], `${X}/runs33/retro33-0.out`);
  assert.ok(b.written.get(`${X}/runs33/retro33-0.txt`).includes(`${T}/bbbb-2.jsonl`));
  const bad = [[['--handover', '--uuid', 'u'], /usage/], [['--handover', '--name', 'Rook S33j'], /usage/], [['--uuid', 'u', '--name', 'Rook S33j'], /usage/],
    [['--handover', '--uuid', 'u', '--name', 'Rook'], /need a uuid and a name/], [['--handover', '--uuid', 'u', '--name', 'Rook S32j'], /session 32 but this is runs33/]];
  for (const [args, re] of bad) { const c = mk(); assert.throws(() => retro(args, c.r.x), re); assert.equal(launched(c.r.calls), undefined); }
  const none = mk(); none.r.x.exists = () => false;
  assert.throws(() => retro(['--handover'], none.r.x), /no transcript .*aaaa-1111\.jsonl/);
  const high = mk('Pip,5h,71,' + future + '\n'); // 71% refused (the 3-run path refuses at 41%); --over passes
  assert.throws(() => retro(['--handover'], high.r.x), /Bishop 5h 71%/);
  retro(['--handover', '--over'], high.r.x);
  assert.equal(high.r.calls.filter((c) => c[0] === 'launch').length, 1);
});

test('TODO 196a: King builds and reviews are refused above 85% King 5h; --over, Knight/Bishop and an unavailable cache pass', (t) => {
  const warnings = t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'log', () => {});
  const future = new Date(Date.now() + 36e5).toISOString();
  const row = (p) => `King,5h,${p},${future}\nPip,5h,10,${future}\n`;
  const calls = {
    'review --as king': (x) => review(['abc1234', 'b.txt', 'o.jsonl', '--as', 'king'], x),
    'review fallback to King': (x) => { x.locked = (dir) => dir.endsWith('ProjectD-s15fix'); review(['abc1234', 'b.txt', 'o.jsonl'], x); },
    'build (King by default)': (x) => build(['b.txt', 'o.jsonl', 'br', 'abc1234'], x),
    'build --as king --dir king2': (x) => build(['b.txt', 'o.jsonl', 'br', 'abc1234', '--as', 'king', '--dir', 'king2'], x),
  };
  for (const [name, run] of Object.entries(calls)) {
    const refused = withUsage(row(86));
    assert.throws(() => run(refused.x), /^Error: King 5h 86%: use Knight, or --over$/, name);
    assert.equal(refused.calls.some((c) => isSwitch(c) || ['open', 'npmCi', 'launch'].includes(c[0])), false, name);
    const ok = withUsage(row(85));
    run(ok.x);
    assert.ok(launched(ok.calls), name);
  }
  for (const run of [(x) => review(['abc1234', 'b.txt', 'o.jsonl', '--as', 'king', '--over'], x), (x) => build(['b.txt', 'o.jsonl', 'br', 'abc1234', '--over'], x)]) {
    const over = withUsage(row(99));
    run(over.x);
    assert.ok(launched(over.calls));
    assert.deepEqual(over.reads, []);
  }
  const bishop = withUsage(row(99)); // Bishop's own build is not King's gate
  build(['b.txt', 'o.jsonl', 'br', 'abc1234', '--as', 'bishop'], bishop.x);
  assert.ok(launched(bishop.calls));
  for (const csv of ['Pip,5h,10,\n', `King,5h,,${future}\n`, `King,5h,high,${future}\n`, 'King,5h,99,2020-01-01T00:00:00+05:30\n']) { // no King row, blank / invalid reading, window already reset
    const before = warnings.mock.calls.length, r = withUsage(csv);
    build(['b.txt', 'o.jsonl', 'br', 'abc1234'], r.x);
    assert.ok(launched(r.calls), csv);
    assert.equal(warnings.mock.calls.length > before, !csv.includes('2020'), csv); // the reset window is a quiet pass
  }
});

test('TODO 196a: retro is refused above 40% Bishop 5h, naming the percent; 40%, --over and an unavailable cache pass', (t) => {
  const warnings = t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'log', () => {});
  const future = new Date(Date.now() + 36e5).toISOString();
  const refused = withUsage(`Pip,5h,41,${future}\n`);
  assert.throws(() => retro([], refused.x), /^Error: Bishop 5h 41%: .*--over$/);
  assert.equal(refused.calls.some((c) => ['open', 'launch'].includes(c[0])), false);
  for (const gate of ['bin', 'lock']) { // TODO 196g fix: a refused run writes no brief
    const r = withUsage(`Pip,5h,40,${future}\n`);
    r.x.exists = () => false;
    r.x.write = () => assert.fail('a refused retro must not write a brief');
    if (gate === 'bin') r.x.need = () => { throw new Error('bin missing'); }; else r.x.locked = () => true;
    assert.throws(() => retro([], r.x), gate === 'bin' ? /bin missing/ : /in use/);
  }
  const high = withUsage(`Pip,5h,41,${future}\n`);
  high.x.exists = () => false;
  high.x.write = () => assert.fail('a refused retro must not write a brief');
  assert.throws(() => retro([], high.x), /Bishop 5h 41%/);
  for (const agent of ['Pip', 'Bishop']) {
    const ok = withUsage(`${agent},5h,40,${future}\n`);
    retro([], ok.x);
    assert.equal(ok.calls.filter((c) => c[0] === 'launch').length, 3, agent);
  }
  const over = withUsage(`Pip,5h,99,${future}\n`);
  retro(['--over'], over.x);
  assert.equal(over.calls.filter((c) => c[0] === 'launch').length, 3);
  assert.deepEqual(over.reads, []);
  assert.throws(() => retro(['--over', 'x'], over.x), /usage: retro \[--over\]/);
  assert.throws(() => retro(['x'], over.x), /usage: retro \[--over\]/);
  const before = warnings.mock.calls.length, none = withUsage('King,5h,99,\n');
  retro([], none.x);
  assert.equal(none.calls.filter((c) => c[0] === 'launch').length, 3);
  assert.match(warnings.mock.calls[before].arguments[0], /retro: Bishop usage cache unavailable.*allowing retro/);
});

test('TODO 172: lintBrief refuses oversized behaviours, one-word filters, builder suites and bare runs paths', () => {
  const behaviours = Array.from({ length: 6 }, (_, i) => `${i + 1}. Change behaviour ${i + 1}`);
  const routine = ['Screenshots in light and dark', '`npm.cmd test` and browser filter', 'Tick TODO', 'Append a decision', 'Add a DECISIONS row', 'Report results'];
  for (const [brief, count] of [
    ['Do:\n1. Change the launcher', 0],
    [behaviours.join('\n'), 1],
    [[...behaviours.slice(0, 5), ...routine.map((s, i) => `${i + 6}. ${s}`)].join('\n'), 0],
    ["node browser.test.mjs <port> 'Layout'", 1],
    ["node browser.test.mjs <port> '[Ll]ayer'", 1],
    ["node browser.test.mjs <port> 'TODO 175|nest'", 1],
    ["node browser.test.mjs <port> 'TODO 175|New layout'", 0],
    ["node browser.test.mjs <free port> 'TODO 171|Layout'", 1],
    ["node browser.test.mjs <free port> 'TODO 175|New layout'", 0],
    ["node browser.test.mjs 4567 'nest'", 1],
    ['node browser.test.mjs <fresh port> "[Ll]ayer"', 1],
    ['Tests:`npm.cmd test` and the new steps (never the full suite).', 0],
    ['then the full browser suite once', 1],
    ['Rook runs the full suite', 0],
    ["Don't run the full suite", 0],
    ['Tests: npm.cmd test, not more. Then the full browser suite once.', 1],
    ['No mock-up needed; then run the full suite.', 1],
    ['Do not skip lint; run the full browser suite.', 1],
    ["browser.test.mjs, don't run Layout: node browser.test.mjs <free port> 'Layout'", 1],
    ['Spec: runs31/grill-175.md', 1],
    ['../runs31/grill-175.md', 0],
    ['E:/Project B/Claude/Project D extras/runs31/x.md', 0],
    ['node browser.test.mjs <port> "Layout|[Ll]ayer|TODO 175|New layout"', 2],
  ]) {
    for (const eol of ['\n', '\r\n']) assert.equal(lintBrief(brief.replaceAll('\n', eol)).length, count, brief);
  }
});

test('TODO 185b: lint checks filters after apostrophes and accepts directly negated suite requests', () => {
  for (const [brief, problems] of [
    ["browser.test.mjs, don't skip: 'Layout'", ["line 1: one-word browser filter piece 'Layout'"]],
    ["1. browser.test.mjs:2160 (step `TODO 110c: Draw, Modify, Annotate, Layout, Compare and the automatic Part tab`) expects the Dimension flyout ['Aligned','Linear','Radius','Diameter','Angle']; 155l1 added 'Automatic' first on purpose (grill-155l.md Q1). Fix: expect 'Automatic' first. Then grep browser.test.mjs for any other list of the five dimension names (flyout / ribbon / menu) a filtered run would miss, and fix those the same way.", []],
    ["node browser.test.mjs <port> 'Layout'", ["line 1: one-word browser filter piece 'Layout'"]],
    ["node browser.test.mjs <port> 'TODO 175|New layout'", []],
    ["Don't ever run the full suite", []],
    ['Don’t run the full suite', []],
    ['Don’t ever run the full browser suite', []],
    ['Never run the full suite', []],
    ['Do not run the full suite', []],
    ['No full suite', []],
    ['Rook runs the full suite', []],
    ['Do not skip lint; run the full suite', ['line 1: builder asked for the full suite']],
  ]) assert.deepEqual(lintBrief(brief), problems, brief);
});

test('TODO 172: build and knight refuse every brief problem before changes; --big overrides, including fixes', () => {
  const brief = 'Spec: runs31/grill-175.md\nnode browser.test.mjs <port> "Layout"\nthen the full browser suite once\n'
    + Array.from({ length: 6 }, (_, i) => `${i + 1}. Change behaviour ${i + 1}`).join('\n');
  for (const [run, args] of [[build, ['b.txt', 'o.jsonl', 'br', 'abc1234']], [knight, ['b.txt', 'k.txt', 'br', 'abc1234']]]) {
    for (const flags of [[], ['--fix'], ['--over']]) {
      const refused = recorder();
      refused.x.read = (path) => { assert.equal(path, resolve('b.txt')); return brief; };
      assert.throws(() => run([...args, ...flags], refused.x), (e) => {
        for (const problem of lintBrief(brief)) assert.ok(e.message.includes(problem), problem);
        assert.match(e.message, /--big overrides/);
        return true;
      });
      assert.equal(refused.calls.some((c) => isSwitch(c) || ['open', 'launch', 'gateRecord'].includes(c[0])), false);
      const big = recorder();
      big.x.read = () => brief;
      assert.doesNotThrow(() => run([...args, ...flags, '--big'], big.x));
      assert.ok(launched(big.calls));
      assert.deepEqual(big.calls.find((c) => c[0] === 'gateCheck'), ['gateCheck', flags.includes('--fix'), flags.includes('--over'), false]);
    }
  }
});

test('review arguments: three positionals, optional --as and --from clone branch, a real commit id, paths absolute', () => {
  assert.deepEqual(parseReview(['abc1234', 'b.txt', 'r.jsonl']), { sha: 'abc1234', brief: resolve('b.txt'), out: resolve('r.jsonl'), as: 'bishop', auto: true, over: false, from: undefined });
  const r = parseReview(['abc1234', 'b.txt', 'r.jsonl', '--from', 'clone', 'king/x', '--as', 'king', '--over']);
  assert.deepEqual([r.as, r.from, r.over], ['king', { clone: resolve('clone'), branch: 'king/x' }, true]);
  assert.throws(() => parseReview(['abc1234', 'b.txt']), /usage: review/);
  assert.throws(() => parseReview(['abc1234', 'b.txt', 'r.jsonl', '--from', 'C:/clone']), /usage: review/);
  assert.throws(() => parseReview(['abc1234', 'b.txt', 'r.jsonl', '--as']), /usage: review/);
  assert.throws(() => parseReview(['abc1234', 'b.txt', 'r.jsonl', '--as', 'pawn']), /unknown account: pawn/);
  assert.throws(() => parseReview(['abc1234', 'b.txt', 'r.jsonl', '--as', 'king', '--as', 'king']), /usage: review/);
  assert.throws(() => parseReview(['--from', 'C:/clone', 'x', 'abc1234', 'b.txt', 'r.jsonl']), /usage: review/);
  assert.throws(() => parseReview(['HEAD', 'b.txt', 'r.jsonl']), /not a commit id/);
});

test('build arguments: four positionals, optional --as (default king), a real commit id, paths absolute', () => {
  assert.deepEqual(parseBuild(['b.txt', 'o.jsonl', 'king/x', 'abc1234']), { brief: resolve('b.txt'), out: resolve('o.jsonl'), branch: 'king/x', sha: 'abc1234', as: 'king', dir: undefined, fix: false, regrilled: false, tool: false, noFresh: false, over: false, big: false, review: undefined });
  const flagged = parseBuild(['b.txt', 'o.jsonl', 'king/x', 'abc1234', '--fix', '--over', '--as', 'king']);
  assert.deepEqual([flagged.fix, flagged.over, flagged.as], [true, true, 'king']);
  assert.equal(parseBuild(['b.txt', 'o.jsonl', 'king/x', 'abc1234', '--as', 'bishop']).as, 'bishop');
  assert.throws(() => parseBuild(['b.txt', 'o.jsonl', 'king/x']), /usage: build/);
  assert.throws(() => parseBuild(['b.txt', 'o.jsonl', 'king/x', 'main']), /not a commit id/);
});

test('knight arguments: four positionals, report ends in .txt, log sits next to it, paths absolute', () => {
  assert.deepEqual(parseKnight(['b.txt', 'runs/k.txt', 'knight/x', 'abc1234']),
    { brief: resolve('b.txt'), report: resolve('runs/k.txt'), branch: 'knight/x', sha: 'abc1234', log: resolve('runs/k.log'), fix: false, regrilled: false, tool: false, noFresh: false, over: false, big: false, review: undefined });
  assert.deepEqual(['--fix', '--over'].map((f) => parseKnight(['b.txt', 'runs/k.txt', 'knight/x', 'abc1234', f])).map((p) => [p.fix, p.over]), [[true, false], [false, true]]);
  assert.throws(() => parseKnight(['b.txt', 'k.txt', 'knight/x']), /usage: knight/);
  assert.throws(() => parseKnight(['b.txt', 'k.md', 'knight/x', 'abc1234']), /must end in \.txt/);
  assert.throws(() => parseKnight(['b.txt', 'k.txt', 'knight/x', 'main']), /not a commit id/);
});

test('the four account x role command lines: flags, cwd, launcher', () => {
  for (const [as, bin, role, run, dir] of [
    ['bishop', 'claude2.cmd', 'review', REVIEWER, 'ProjectD-s15fix'], ['king', 'claude3.cmd', 'review', REVIEWER, 'ProjectD-king2'],
    ['bishop', 'claude2.cmd', 'build', BUILDER, 'ProjectD-s15fix'], ['king', 'claude3.cmd', 'build', BUILDER, 'ProjectD-king'],
  ]) {
    const { calls, x } = recorder();
    if (role === 'review') review(['abc1234', 'b.txt', 'o.jsonl', '--as', as], x);
    else build(['b.txt', 'o.jsonl', 'br', 'abc1234', '--as', as], x);
    const [, launcher, args, cwd, inFd, outFd, env] = launched(calls);
    assert.equal(basename(launcher), bin, `${as} ${role}`);
    assert.equal(commandLine(bin, args), run.replace('claude2.cmd', bin), `${as} ${role}`);
    assert.equal(cwd, `${X}/${dir}`);
    assert.deepEqual([inFd, outFd], [`fd:${resolve('b.txt')}`, `fd:${resolve('o.jsonl')}`]);
    if (role === 'build') assert.equal('FORCE_COLOR' in env, false);
    if (role === 'build') assert.equal(env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS, as === 'king' ? '1' : process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS);
  }
  assert.equal(commandLine('claude2.cmd', reviewerArgs(X)), REVIEWER);
  assert.equal(commandLine('claude2.cmd', buildArgs(X)), BUILDER);
});

test('review plan: checks, files opened, detach, npm ci in the review folder, then launch; a failing npm ci launches nothing', () => {
  const { calls, x } = recorder();
  review(['abc1234', 'b.txt', 'o.jsonl'], x);
  const names = calls.map((c) => c[0] + (c[0] === 'git' ? ` ${c[2]}` : ''));
  assert.deepEqual(names.slice(-7), ['open', 'git switch', 'npmCi', 'queueOpen', 'open', 'launch', 'queueSet']);
  assert.equal(calls.find((c) => c[0] === 'npmCi')[1], `${X}/ProjectD-s15fix`);
  assert.ok(calls.some((c) => c[0] === 'need' && c[1] === `${X}/ProjectD-s15fix/.claude/agents/reviewer.md`));
  const bad = recorder('npmCi');
  assert.throws(() => review(['abc1234', 'b.txt', 'o.jsonl'], bad.x), /npmCi failed/);
  assert.equal(launched(bad.calls), undefined);
});

test('build and knight open the brief before the branch is made (a failed run can be re-run), the out file only after it', () => {
  for (const [run, args] of [[build, ['b.txt', 'o.jsonl', 'br', 'abc1234']], [knight, ['b.txt', 'k.txt', 'br', 'abc1234']]]) {
    const { calls, x } = recorder();
    run(args, x);
    const at = (f) => calls.findIndex(f);
    assert.ok(at((c) => c[0] === 'open' && c[2] === 'r') < at(isSwitch), run.name);
    assert.ok(at(isSwitch) < at((c) => c[0] === 'open' && c[2] === 'w'), run.name);
    assert.ok(at((c) => c[0] === 'open' && c[2] === 'w') < at((c) => c[0] === 'launch'), run.name);
    assert.deepEqual(calls.find(isSwitch).slice(3), ['-c', 'br', 'abc1234']);
    const failing = recorder('open');
    assert.throws(() => run(args, failing.x), /open failed/);
    assert.equal(failing.calls.some(isSwitch), false, run.name);
  }
});

test('a folder with tracked changes, or a commit it lacks, stops the run before anything changes', () => {
  const dirty = recorder();
  dirty.x.git = (...a) => { dirty.calls.push(['git', ...a]); return a[1] === 'status' ? ' M web/app.js\n?? tmp.js' : ''; };
  assert.throws(() => build(['b.txt', 'o.jsonl', 'br', 'abc1234'], dirty.x), /tracked changes.*web\/app\.js/);
  assert.equal(dirty.calls.some((c) => c[0] === 'open'), false);
  const missing = recorder();
  missing.x.has = () => false;
  assert.throws(() => build(['b.txt', 'o.jsonl', 'br', 'abc1234'], missing.x), /not in/);
});

test('a failed switch never opens the out file; a locked folder is refused before anything changes', () => {
  for (const [run, args] of [[build, ['b.txt', 'o.jsonl', 'br', 'abc1234']], [knight, ['b.txt', 'k.txt', 'br', 'abc1234']], [review, ['abc1234', 'b.txt', 'o.jsonl']]]) {
    const failing = recorder('git');
    assert.throws(() => run(args, failing.x), /git failed/);
    assert.equal(failing.calls.some((c) => c[0] === 'open' && c[2] === 'w'), false, run.name);
    const locked = recorder();
    locked.x.locked = () => true;
    assert.throws(() => run(args, locked.x), /in use.*\.run-lock/);
    assert.equal(locked.calls.some((c) => c[0] === 'open' || isSwitch(c) || c[0] === 'launch'), false, run.name);
  }
});

test('the Knight command line has the builder profile, its clone, the git folder and Playwright', () => {
  const line = commandLine('codex.cmd', knightArgs('E:/runs/k.txt', 'E:/x y/ProjectD-rowan', 'C:/Users/me'));
  assert.equal(line, 'codex.cmd exec -p builder -C "E:/x y/ProjectD-rowan" --add-dir "E:/x y/ProjectD-rowan-git" '
    + '--add-dir C:/Users/me/AppData/Local/ms-playwright -o E:/runs/k.txt -');
});

test('commandLine refuses a double quote', () => {
  assert.throws(() => commandLine('x', ['a"b']), /double quote/);
});

test('a launch that fails to start deletes the folder\'s lock and exits 1; no lock is no error', (t) => {
  t.mock.method(console, 'error', () => {});
  const dir = mkdtempSync(join(tmpdir(), 'rook-lock-')), codes = [];
  writeFileSync(`${dir}/.run-lock`, 'x');
  launchFailed(dir, new Error('spawn ENOENT'), (c) => codes.push(c));
  assert.equal(existsSync(`${dir}/.run-lock`), false);
  launchFailed(dir, new Error('again'), (c) => codes.push(c));
  assert.deepEqual(codes, [1, 1]);
  rmSync(dir, { recursive: true });
});

// A fake spawn: records its call and returns a child that can emit 'error'.
const fakeSpawn = (throwOnSpawn) => {
  const child = Object.assign(new EventEmitter(), { unref() {} });
  return { child, spawn: () => { if (throwOnSpawn) throw new Error('spawn blew up'); return child; } };
};

test('launchRun writes the lock last: a bad argument leaves none, a spawn that throws removes it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rook-lock-'));
  assert.throws(() => launchRun('x.cmd', ['a"b'], dir, 0, 1, {}, 'o.jsonl', fakeSpawn().spawn), /double quote/);
  assert.equal(existsSync(`${dir}/.run-lock`), false);
  assert.throws(() => launchRun('x.cmd', ['ok'], dir, 0, 1, {}, 'o.jsonl', fakeSpawn(true).spawn), /spawn blew up/);
  assert.equal(existsSync(`${dir}/.run-lock`), false);
  rmSync(dir, { recursive: true });
});

test('launchRun: the child\'s error event removes the lock; a live run keeps it, and result reports RUNNING for its out file only', (t) => {
  t.mock.method(console, 'error', () => {});
  const dir = mkdtempSync(join(tmpdir(), 'rook-lock-')), out = join(dir, 'run.jsonl');
  const { child, spawn } = fakeSpawn();
  launchRun('x.cmd', ['ok'], dir, 0, 1, {}, out, spawn, (cwd, e) => launchFailed(cwd, e, () => {}));
  assert.equal(existsSync(`${dir}/.run-lock`), true);
  assert.match(runningNote(out, [dir]), /^RUNNING \(lock since \d{4}-\d\d-\d\dT[\d:.]+Z\)$/);
  assert.equal(runningNote(join(dir, 'other.jsonl'), [dir]), '');
  child.emit('error', new Error('spawn ENOENT'));
  assert.equal(existsSync(`${dir}/.run-lock`), false);
  assert.equal(runningNote(out, [dir]), '');
  rmSync(dir, { recursive: true });
});

test('build --dir king2 runs King in his review folder; a lock there refuses it; only for King', () => {
  assert.equal(parseBuild(['b.txt', 'o.jsonl', 'br', 'abc1234', '--dir', 'king2']).dir, 'king2');
  assert.equal(parseBuild(['b.txt', 'o.jsonl', 'br', 'abc1234']).dir, undefined);
  assert.throws(() => parseBuild(['b.txt', 'o.jsonl', 'br', 'abc1234', '--dir', 'king3']), /--dir king2/);
  assert.throws(() => parseBuild(['b.txt', 'o.jsonl', 'br', 'abc1234', '--as', 'bishop', '--dir', 'king2']), /--dir king2/);
  const { calls, x } = recorder();
  build(['b.txt', 'o.jsonl', 'br', 'abc1234', '--dir', 'king2'], x);
  assert.equal(calls.find(isSwitch)[1], `${X}/ProjectD-king2`);
  assert.equal(launched(calls)[3], `${X}/ProjectD-king2`);
  const locked = recorder();
  locked.x.locked = (dir) => dir.endsWith('ProjectD-king2');
  assert.throws(() => build(['b.txt', 'o.jsonl', 'br', 'abc1234', '--dir', 'king2'], locked.x), /in use.*\.run-lock/);
});

test('handover gate: build and knight check it first, record after the launch; a refusal launches nothing; --fix / --over pass through', () => {
  for (const [run, args] of [[build, ['b.txt', 'o.jsonl', 'br', 'abc1234']], [knight, ['b.txt', 'k.txt', 'br', 'abc1234']]]) {
    const { calls, x } = recorder();
    run([...args, '--fix'], x);
    const at = (name) => calls.findIndex((c) => c[0] === name);
    assert.deepEqual(calls[at('gateCheck')].slice(1), [true, false, false]);
    assert.ok(at('launch') < at('gateRecord'), run.name);
    assert.deepEqual(calls[at('gateRecord')][1], { fix: true, over: false, tool: false, brief: resolve(args[0]), branch: 'br' });
    const refused = recorder('gateCheck');
    assert.throws(() => run(args, refused.x), /gateCheck failed/);
    assert.deepEqual(refused.calls.map((c) => c[0]), ['need', 'read', 'gateCheck'], run.name); // nothing changes before the gate says yes
    const over = recorder();
    run([...args, '--over'], over.x);
    assert.deepEqual(over.calls.find((c) => c[0] === 'gateCheck').slice(1), [false, true, false]);
  }
});

test('TODO 167c: a brief whose line 1 starts King fix / Knight fix / Fix round counts as a fix round without --fix; --tool passes the gate and is recorded', () => {
  assert.deepEqual(['King fix: TODO 1', 'Knight fix: TODO 1', 'Fix round: x', 'Fix round 2: x'].map(isFixBrief), [true, true, true, true]);
  assert.deepEqual(['Build: TODO 1', 'Review: x', '\nKing fix: second line', 'King fixes the thing', 'Fix rounds: x'].map(isFixBrief), [false, false, false, false, false]);
  assert.equal(isFixBrief('﻿King fix: TODO 1'), true);
  for (const [run, args] of [[build, ['b.txt', 'o.jsonl', 'br', 'abc1234']], [knight, ['b.txt', 'k.txt', 'br', 'abc1234']]]) {
    for (const [first, flags, kind] of [['King fix: TODO 1', [], 'fix'], ['Fix round 2: TODO 1', [], 'fix'], ['Build: TODO 1', [], 'item'], ['Build: TODO 1', ['--tool'], 'tool'], ['Build: TODO 1', ['--fix'], 'fix']]) {
      const { calls, x } = recorder();
      x.read = () => `${first}\nrest\nOld steps: none\n`;
      run([...args, ...flags], x);
      const [, fix, , tool] = calls.find((c) => c[0] === 'gateCheck'), rec = calls.find((c) => c[0] === 'gateRecord')[1];
      assert.deepEqual([fix, tool, rec.fix, rec.tool], [kind === 'fix', kind === 'tool', kind === 'fix', kind === 'tool'], `${run.name} ${first} ${flags}`);
    }
  }
});

test('TODO 196b: the third fix round needs a re-grill file in the current runs folder', (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const dir = mkdtempSync(join(tmpdir(), 'rook-fixes-')), queue = join(dir, 'queue.txt');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = 'build king/196bfix1 -> fix1.jsonl: ended';
  const second = 'knight knight/196bfix2 -> fix2.txt: running';
  const other = 'build king/196bcfix1 -> other.jsonl: ended\nreview bishop/196bfix2 -> review.jsonl: ended';
  const refusal = '3rd fix round of 196b: re-grill the root cause, then --regrilled';
  for (const eol of ['\n', '\r\n']) {
    assert.equal(fixRoundRefusal('196b', other), '');
    assert.equal(fixRoundRefusal('196b', [first, other].join(eol)), '');
    assert.equal(fixRoundRefusal('196b', [first, second, other].join(eol)), refusal);
    assert.equal(fixRoundRefusal('196b', `${first} knight/196bfix2`), '', 'count lines, not mentions');
    assert.equal(fixRoundRefusal('196b', `king/196bfix\nknight/196bfix10`), refusal, 'fix wildcard and branch at start');
  }
  for (const [run, out, branch] of [[build, 'o.jsonl', 'king/196bfix3'], [knight, 'k.txt', 'knight/196bfix30']]) {
    const make = (text = '') => {
      const r = recorder();
      r.x.gate.queueFile = () => queue;
      r.x.read = (path) => path === queue ? readFileSync(path, 'utf8') : text;
      r.x.need = (path, what) => { if (what === 're-grill file' && !existsSync(path)) throw new Error(`${what} not found: ${path}`); };
      return r;
    };
    const args = ['b.txt', out, branch, 'abc1234'];
    for (const prior of ['', first]) {
      writeFileSync(queue, prior);
      const r = make();
      run([...args, '--fix'], r.x);
      assert.ok(launched(r.calls));
    }
    rmSync(queue);
    const none = make();
    run([...args, '--fix'], none.x);
    assert.ok(launched(none.calls), 'no queue.txt counts as empty');
    writeFileSync(queue, `${first}\r\n${second}\r\n${other}`);
    const normal = make();
    run(args, normal.x);
    assert.ok(launched(normal.calls), 'new builds do not count as fix rounds');
    for (const flags of [['--fix'], ['--fix', '--over', '--tool', '--big'], []]) {
      const r = make(flags.length ? '' : 'Knight fix: TODO 196b');
      assert.throws(() => run([...args, ...flags], r.x), { message: refusal });
      assert.ok(!r.calls.some((c) => ['launch', 'open', 'truncate'].includes(c[0]) || isSwitch(c)), 'refusal precedes mutations');
    }
    for (const name of [branch.replace(/\d+$/, ''), branch.replace(/fix\d+$/, '')]) {
      const r = make();
      assert.throws(() => run(['b.txt', out, name, 'abc1234', '--fix'], r.x), { message: refusal });
    }
    const proof = join(dir, 'grill-196b-regrill.md');
    for (const flags of [['--regrilled'], ['--fix', '--regrilled']]) {
      const r = make();
      assert.throws(() => run([...args, ...flags], r.x), { message: `re-grill file not found: ${proof}` });
      assert.ok(!launched(r.calls));
    }
    writeFileSync(proof, 'Root cause re-grilled');
    const allowed = make();
    run([...args, '--fix', '--regrilled'], allowed.x);
    assert.ok(launched(allowed.calls));
    rmSync(proof);
  }
});

test('TODO 167c: lintBrief refuses a line starting Also and a Tick line naming two TODO ids', () => {
  for (const [brief, count] of [
    ['1. Do it\nAlso add unit cases', 1], ['2. Also add unit cases', 1], ['  also, one more', 1], ['Do the thing; also this', 0], ['Always fix', 0],
    ['Tick 171 and 174', 1], ['5. Tick TODO 171 and 174 in TODO.md', 1], ['Tick 167c in TODO.md', 0], ['`Tick TODO 170 in TODO.md`', 0], ['6. Tick 155m2 and 167c', 1], ['Tick 171, 171', 0],
    ['6. Tick TODO 174 in TODO.md with one line on the cause. Append to the 156a row in DECISIONS.md only if the app changed.', 0],
    ['3. Tick TODO 173 in TODO.md with one line (say the --shots part is already covered by AGENTS.md and TODO 180).', 0],
    ['3. Tick 167d in TODO.md; the launch refusal is past 150k Rook context.', 0], ['Tick 171/174', 1], ['Tick 171 & TODO 174', 1],
  ]) assert.equal(lintBrief(brief).length, count, brief);
});

test('TODO 193a: lintBrief refuses ../Project D extras/runs paths, cmd /c and powershell.exe lines', () => {
  for (const [brief, count] of [
    ['Spec: "../Project D extras/runs35/grill-193.md"', 1], ['Spec: "../runs35/grill-193.md"', 0], ['Spec: "E:/Project B/Claude/Project D extras/runs35/x.md"', 0],
    ['Run cmd /c npm test', 1], ['Run cmd.exe /c dir', 1], ['Run powershell.exe -File x', 1], ['Use the cmdline and a powershell tool', 0], ['Write tmp-x.mjs', 0],
  ]) assert.equal(lintBrief(brief).length, count, brief);
});

test('TODO 193a: knight refuses a sha named in the brief that the clone lacks, one line, before anything starts', () => {
  const brief = 'Build: x\nRead it with git show 86d88ee before you start. Commit 2026110 and deadbeef are not shas.\nOld steps: none';
  const r = recorder();
  r.x.read = () => brief;
  r.x.has = (dir, sha) => { r.calls.push(['has', dir, sha]); return sha !== '86d88ee'; };
  assert.throws(() => knight(['b.txt', 'k.txt', 'br', 'abc1234'], r.x), (e) => e.message === 'brief names 86d88ee, which is not in the Knight clone: fetch it there first' && !e.message.includes('\n'));
  assert.equal(r.calls.some((c) => ['open', 'truncate', 'launch'].includes(c[0]) || (c[0] === 'git' && c[2] === 'switch')), false);
  assert.deepEqual(r.calls.filter((c) => c[0] === 'has').map((c) => c[2]), ['abc1234', '86d88ee']);
  const ok = recorder();
  ok.x.read = () => brief;
  knight(['b.txt', 'k.txt', 'br', 'abc1234'], ok.x);
  assert.ok(launched(ok.calls));
});

test('TODO 167a: review checks the context gate first (nothing launches when refused); --over is passed on', () => {
  const refused = recorder('gateContext');
  assert.throws(() => review(['abc1234', 'b.txt', 'o.jsonl'], refused.x), /gateContext failed/);
  assert.deepEqual(refused.calls.map((c) => c[0]), ['gateContext']);
  const over = recorder();
  review(['abc1234', 'b.txt', 'o.jsonl', '--over'], over.x);
  assert.deepEqual(over.calls[0], ['gateContext', true]);
});

test('TODO 169: build and knight require tools/hooks in the target folder before opening files or switching branches', () => {
  for (const [run, args, folder] of [
    [build, ['b.txt', 'o.jsonl', 'br', 'abc1234'], 'ProjectD-king'],
    [build, ['b.txt', 'o.jsonl', 'br', 'abc1234', '--dir', 'king2'], 'ProjectD-king2'],
    [build, ['b.txt', 'o.jsonl', 'br', 'abc1234', '--as', 'bishop'], 'ProjectD-s15fix'],
    [knight, ['b.txt', 'k.txt', 'br', 'abc1234'], 'ProjectD-rowan'],
  ]) {
    for (const value of ['tools/hooks', resolve(X, folder, 'tools/hooks'), 'E:/Project B/Claude/Project D/tools/hooks', '', 'other/hooks', resolve(X, 'other/hooks'), 'E:/Project B/Claude/Project D/other/hooks', null]) {
      const { calls, x } = recorder();
      const git = x.git;
      x.git = (...a) => {
        if (a[1] !== 'config') return git(...a);
        assert.deepEqual(a, [`${X}/${folder}`, 'config', 'core.hooksPath']);
        if (value === null) throw new Error('config unset');
        return value;
      };
      if (value && [resolve(X, folder, 'tools/hooks'), resolve('E:/Project B/Claude/Project D/tools/hooks')].includes(resolve(X, folder, value))) {
        run(args, x);
        assert.ok(launched(calls));
      } else {
        assert.throws(() => run(args, x), { message: `hooksPath required: git -C "${X}/${folder}" config core.hooksPath tools/hooks` });
        assert.equal(calls.some((c) => c[0] === 'open' || isSwitch(c) || c[0] === 'launch' || c[0] === 'gateRecord'), false);
      }
    }
  }
});

test('TODO 167d: --review is parsed for build and knight (two paths, absolute); a missing value is the usage', () => {
  const b = parseBuild(['b.txt', 'o.jsonl', 'br', 'abc1234', '--review', 'rb.txt', 'r.jsonl']);
  assert.deepEqual(b.review, { brief: resolve('rb.txt'), out: resolve('r.jsonl') });
  assert.deepEqual(parseKnight(['b.txt', 'k.txt', 'br', 'abc1234', '--review', 'rb.txt', 'r.jsonl']).review, { brief: resolve('rb.txt'), out: resolve('r.jsonl') });
  assert.throws(() => parseBuild(['b.txt', 'o.jsonl', 'br', 'abc1234', '--review', 'rb.txt']), /usage: build.*--review/);
  assert.throws(() => parseKnight(['b.txt', 'k.txt', 'br', 'abc1234', '--review']), /usage: knight.*--review/);
});

test('TODO 167d: build and knight hand the review job and the queue line to the RUN script; without --review only the queue line', () => {
  const rb = resolve('rb.txt'), ro = resolve('r.jsonl');
  const b = recorder();
  build(['b.txt', 'o.jsonl', 'br', 'abc1234', '--review', 'rb.txt', 'r.jsonl'], b.x);
  assert.deepEqual(launched(b.calls)[8], { queue: 'q.txt', key: 'k', text: 'kind id -> k:', review: { brief: rb, out: ro, dir: `${X}/ProjectD-king`, branch: 'br', base: 'abc1234' } });
  assert.deepEqual(b.calls.filter((c) => c[0] === 'truncate'), [['truncate', ro]]);
  const k = recorder();
  knight(['b.txt', 'k.txt', 'br', 'abc1234', '--review', 'rb.txt', 'r.jsonl'], k.x);
  assert.deepEqual(launched(k.calls)[8].review, { brief: rb, out: ro, dir: `${X}/ProjectD-rowan`, branch: 'br', base: 'abc1234', from: `${X}/ProjectD-rowan` });
  const plain = recorder();
  build(['b.txt', 'o.jsonl', 'br', 'abc1234'], plain.x);
  assert.equal(launched(plain.calls)[8].review, undefined);
  const none = recorder();
  none.x.queue.open = () => null;
  build(['b.txt', 'o.jsonl', 'br', 'abc1234'], none.x);
  assert.equal(launched(none.calls)[8], null); // no queue.txt and no review: nothing for the RUN script to do
  const missing = recorder();
  missing.x.need = (path) => { if (path === rb) throw new Error('review brief file not found'); };
  assert.throws(() => build(['b.txt', 'o.jsonl', 'br', 'abc1234', '--review', 'rb.txt', 'r.jsonl'], missing.x), /review brief file/);
  assert.equal(missing.calls.some((c) => c[0] === 'open' || isSwitch(c) || c[0] === 'launch'), false);
});

test('TODO 167d: the queue line is written after the launch as running, with the kind, branch or sha and the out file', () => {
  for (const [run, args, kind, id, out] of [[build, ['b.txt', 'o.jsonl', 'br', 'abc1234'], 'build', 'br', 'o.jsonl'], [knight, ['b.txt', 'k.txt', 'br', 'abc1234'], 'knight', 'br', 'k.txt'], [review, ['abc1234', 'b.txt', 'o.jsonl'], 'review', 'abc1234', 'o.jsonl']]) {
    const { calls, x } = recorder();
    run(args, x);
    const names = calls.map((c) => c[0]);
    assert.deepEqual(calls.find((c) => c[0] === 'queueOpen').slice(1), [kind, id, resolve(out)]);
    assert.ok(names.indexOf('queueOpen') < names.indexOf('launch') && names.indexOf('launch') < names.indexOf('queueSet'), kind);
    assert.equal(calls.find((c) => c[0] === 'queueSet')[2], 'running');
  }
});

test('TODO 167d: a knight launch empties an existing report file before the run', () => {
  const { calls, x } = recorder();
  knight(['b.txt', 'k.txt', 'br', 'abc1234'], x);
  const at = (f) => calls.findIndex(f);
  assert.deepEqual(calls[at((c) => c[0] === 'truncate')], ['truncate', resolve('k.txt')]);
  assert.ok(at((c) => c[0] === 'truncate') < at((c) => c[0] === 'launch'));
});

test('TODO 167d: review without --as uses King when Bishop\'s reviewer folder is locked, and says so; --as is never overridden; both locked is refused', (t) => {
  const log = t.mock.method(console, 'log', () => {});
  const free = recorder();
  review(['abc1234', 'b.txt', 'o.jsonl'], free.x);
  assert.equal(launched(free.calls)[3], `${X}/ProjectD-s15fix`);
  const busy = recorder();
  busy.x.locked = (dir) => dir.endsWith('ProjectD-s15fix');
  review(['abc1234', 'b.txt', 'o.jsonl'], busy.x);
  assert.equal(launched(busy.calls)[3], `${X}/ProjectD-king2`);
  assert.match(launched(busy.calls)[1], /claude3\.cmd$/);
  assert.ok(log.mock.calls.some((c) => c.arguments[0] === 'review: Bishop busy, King'));
  const explicit = recorder();
  explicit.x.locked = (dir) => dir.endsWith('ProjectD-s15fix');
  assert.throws(() => review(['abc1234', 'b.txt', 'o.jsonl', '--as', 'bishop'], explicit.x), /in use.*\.run-lock/);
  const both = recorder();
  both.x.locked = () => true;
  assert.throws(() => review(['abc1234', 'b.txt', 'o.jsonl'], both.x), /ProjectD-king2 is in use/);
});

test('TODO 167d: launchRun gives the RUN script the end script and the job JSON only when there is a job', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rook-lock-')), seen = [];
  const spawn = (bin, argv) => { seen.push(argv); return fakeSpawn().child; };
  launchRun('x.cmd', ['ok'], dir, 0, 1, {}, 'o.jsonl', spawn);
  launchRun('x.cmd', ['ok'], dir, 0, 1, {}, 'o.jsonl', spawn, undefined, { queue: 'q.txt' });
  assert.equal(seen[0].length, 4);
  assert.match(seen[1][4], /rook-end\.mjs$/);
  assert.deepEqual(JSON.parse(seen[1][5]), { queue: 'q.txt' });
  rmSync(dir, { recursive: true });
});

test('TODO 167d lows: a Tick line with a one-digit number after a joiner is prose; 2+ digit ids still count', () => {
  for (const [brief, count] of [['Tick 170, 1 line on the cause', 0], ['6. Tick TODO 170, 1 line on the cause', 0], ['Tick 170, 171', 1], ['Tick 170 and 171, 1 line', 1]]) assert.equal(lintBrief(brief).length, count, brief);
});

test('TODO 167e: suite refuses a sha that is not HEAD; otherwise launches the suite script in this checkout with the log, a lock and a queue line', (t) => {
  t.mock.method(console, 'log', () => {});
  const r = recorder();
  r.x.git = (...a) => { r.calls.push(['git', ...a]); return 'abc1234' + 'f'.repeat(33); };
  assert.throws(() => suite(['def5678'], r.x), /refused: def5678 is not HEAD \(abc1234\)/);
  assert.throws(() => suite([], r.x), /usage/);
  assert.throws(() => suite(['zz'], r.x), /not a commit id/);
  assert.equal(launched(r.calls), undefined);
  suite(['ABC1234'], r.x);
  const l = launched(r.calls);
  assert.match(l[1], /node(\.exe)?$/i);
  assert.match(l[2][0], /rook-suite\.mjs$/);
  assert.equal(l[4], 'ignore'); // no stdin
  assert.equal(l[5], `fd:${X}/runs33/suite-ABC1234.log`);
  assert.equal(l[7], `${X}/runs33/suite-ABC1234.log`);
  assert.equal(l[9], undefined); // the folder's own lock
  assert.deepEqual(r.calls.find((c) => c[0] === 'queueOpen').slice(1), ['suite', 'ABC1234', `${X}/runs33/suite-ABC1234.log`]);
  assert.equal(r.calls.find((c) => c[0] === 'queueSet')[2], 'running');
  const busy = recorder();
  busy.x.git = () => 'abc1234';
  busy.x.locked = () => true;
  assert.throws(() => suite(['abc1234'], busy.x), /in use/);
});

test('TODO 196e: retro fills all missing templates from matching transcripts, with default or literal --events', (t) => {
  t.mock.method(console, 'log', () => {});
  const project = 'C:/Users/raksh/.claude/projects/E--Project-B-Claude-Project-D';
  const user = (text) => JSON.stringify({ type: 'user', message: { content: text } });
  const sources = {
    'a.jsonl': user('Read resume-rook-S33c.txt; Rook S33c'),
    'b.jsonl': user([{ type: 'text', text: 'Read runs33/resume-rook.txt' }]),
    'c.jsonl': user('resume-rook-S330a.txt'),
    'd.jsonl': `${user('Other work')}\n${user('resume-rook-S33z.txt')}`,
    'notes.txt': 'not a transcript',
  };
  for (const events of [undefined, 'A $& event with {N} kept literally.']) {
    const r = recorder(), written = new Map();
    r.x.exists = () => false;
    r.x.list = (path) => { assert.equal(path, project); return Object.keys(sources).reverse(); };
    r.x.mtime = (path) => (path.endsWith('/b.jsonl') ? 1 : 2); // b is older than a, though it sorts after it by name
    r.x.read = (path) => {
      if (path.startsWith(`${project}/`)) { assert.ok(path.endsWith('.jsonl')); return sources[basename(path)]; }
      return readFileSync(path, 'utf8');
    };
    r.x.write = (path, text) => { assert.equal(launched(r.calls), undefined); written.set(path, text); };
    retro(['--over', ...(events === undefined ? [] : ['--events', events])], r.x);
    assert.deepEqual([...written.keys()], ['', 'king', 'rook'].map((s) => `${X}/runs33/retro33${s}.txt`));
    const main = written.get(`${X}/runs33/retro33.txt`);
    assert.match(main, /session 33 \(Rook = lead; Rook sessions S33, S33c\)/);
    assert.ok(main.includes(`Rook transcripts: ${project}/b.jsonl, ${project}/a.jsonl (large:`));
    assert.ok(main.includes(`Known events: ${events ?? 'none given.'} Change nothing.`));
    assert.match(written.get(`${X}/runs33/retro33king.txt`), /King's runs in session 33/);
    assert.match(written.get(`${X}/runs33/retro33rook.txt`), /Rook's own work in session 33/);
    for (const text of written.values()) {
      assert.ok(text.includes('runs33/'));
      assert.doesNotMatch(text, /\{SESSIONS\}|\{TRANSCRIPTS\}|\{EVENTS\}|runs36|session 36/);
    }
    assert.equal(r.calls.filter((c) => c[0] === 'launch').length, 3);
  }
});

test('TODO 196e: retro keeps existing briefs, including when no discovery is needed', (t) => {
  t.mock.method(console, 'log', () => {});
  for (const all of [false, true]) {
    const r = recorder(), writes = [];
    r.x.exists = (path) => all || path.endsWith('retro33.txt');
    r.x.list = () => { assert.equal(all, false); return ['rook.jsonl']; };
    r.x.read = (path) => {
      assert.equal(all, false);
      return path.endsWith('.jsonl') ? '{"type":"user","message":{"content":"resume-rook-S33.txt"}}' : 'Session {N}: {SESSIONS}: {TRANSCRIPTS}: Known events: {EVENTS}';
    };
    r.x.write = (path) => writes.push(path);
    retro(['--events', 'an event', '--over'], r.x);
    assert.deepEqual(writes, all ? [] : ['king', 'rook'].map((s) => `${X}/runs33/retro33${s}.txt`));
    assert.equal(r.calls.filter((c) => c[0] === 'launch').length, 3);
  }
});

test('TODO 196e: retro refuses absent Rook transcripts before writing or launching; --events needs one value', () => {
  for (const files of [[], ['unrelated.jsonl']]) {
    const r = recorder();
    r.x.exists = () => false;
    r.x.list = () => files;
    r.x.read = () => '{"type":"user","message":{"content":"resume-rook-S330.txt"}}';
    r.x.write = () => assert.fail('must not write an empty transcript list');
    assert.throws(() => retro(['--over'], r.x), { message: 'no Rook transcripts for session 33' });
    assert.equal(launched(r.calls), undefined);
  }
  for (const args of [['--events'], ['--events', 'a', 'b'], ['--unknown']]) {
    assert.throws(() => retro(args, recorder().x), /usage: retro/);
  }
});

test('TODO 167e: retro launches the three runs from runs<N> as WORKFLOW line 215; a missing .txt launches none', (t) => {
  t.mock.method(console, 'log', () => {});
  assert.deepEqual(retroArgs('E', 'H'), ['-p', '--model', 'claude-opus-5-5', '--effort', 'medium', '--permission-mode', 'dontAsk', '--max-budget-usd', '6', '--output-format', 'text',
    '--add-dir', 'E', '--add-dir', 'E:/Project B/Claude/Project D', '--add-dir', 'H/.claude/projects/E--Project-B-Claude-Project-D', '--add-dir', 'H/.claude/plugins/cache/mattpocock',
    '--allowedTools', 'Read', 'Grep', 'Glob', 'Write', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(wc:*)', '--disallowedTools', 'Agent']);
  const r = recorder();
  retro([], r.x);
  const ls = r.calls.filter((c) => c[0] === 'launch');
  assert.deepEqual(ls.map((l) => l[7]), ['retro33', 'retro33king', 'retro33rook'].map((n) => `${X}/runs33/${n}.out`));
  assert.deepEqual(ls.map((l) => l[9]), ['retro33', 'retro33king', 'retro33rook'].map((n) => `${X}/runs33/.run-lock-${n}`));
  assert.ok(ls.every((l) => l[3] === `${X}/runs33` && /claude2\.cmd$/.test(l[1])));
  assert.deepEqual(r.calls.filter((c) => c[0] === 'open' && c[2] === 'r').map((c) => c[1]), ['retro33', 'retro33king', 'retro33rook'].map((n) => `${X}/runs33/${n}.txt`));
  const missing = recorder();
  missing.x.need = (path) => { if (path.endsWith('retro33rook.txt')) throw new Error('retro brief not found'); };
  assert.throws(() => retro([], missing.x), /retro brief not found/);
  assert.equal(launched(missing.calls), undefined);
  assert.throws(() => retro(['x'], r.x), /usage/);
  const busy = recorder();
  busy.x.locked = (dir, lock = '') => lock.endsWith('retro33king');
  assert.throws(() => retro([], busy.x), /retro33king is in use/);
  const lastBusy = recorder();
  lastBusy.x.locked = (dir, lock = '') => lock.endsWith('retro33rook');
  assert.throws(() => retro([], lastBusy.x), /retro33rook is in use/);
  assert.equal(launched(lastBusy.calls), undefined); // a later run locked: the earlier ones never start
});

test('TODO 167e: acad runs Bishop on runs<N>/acad<item>.txt as WORKFLOW line 87; a missing .txt or a bad item launches nothing', (t) => {
  t.mock.method(console, 'log', () => {});
  assert.deepEqual(acadArgs('E'), ['-p', '--model', 'claude-sonnet-5-5', '--effort', 'high', '--permission-mode', 'dontAsk', '--max-budget-usd', '4', '--output-format', 'text', '--add-dir', 'E',
    '--allowedTools', 'PowerShell', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch(domain:help.autodesk.com)', '--disallowedTools', 'Agent']);
  assert.match(commandLine('c', acadArgs('E')), /"WebFetch\(domain:help\.autodesk\.com\)"/);
  const r = recorder();
  acad(['170'], r.x);
  const l = launched(r.calls);
  assert.equal(l[3], `${X}/runs33`);
  assert.equal(l[4], `fd:${X}/runs33/acad170.txt`);
  assert.equal(l[7], `${X}/runs33/acad170.out`);
  assert.deepEqual(r.calls.find((c) => c[0] === 'queueOpen').slice(1), ['acad', '170', `${X}/runs33/acad170.out`]);
  const missing = recorder();
  missing.x.need = (path) => { if (path.endsWith('acad170.txt')) throw new Error('acad brief not found'); };
  assert.throws(() => acad(['170'], missing.x), /acad brief not found/);
  for (const bad of [[], ['a', 'b'], ['../x']]) assert.throws(() => acad(bad, r.x), /usage/);
  assert.equal(r.calls.filter((c) => c[0] === 'launch').length, 1);
});

test('TODO 167e: pawn adds the house sentence, runs in ~/agy-research with a json out file, one question only', (t) => {
  t.mock.method(console, 'log', () => {});
  assert.deepEqual(pawnArgs('What is X; max 5 lines'), ['-p', 'What is X; max 5 lines Open https links only, skip http ones, run no commands; read at most 3 pages; cite URLs.', '--output-format', 'json', '--print-timeout', '10m']);
  assert.throws(() => pawnArgs('a\nb'), /one line/);
  assert.throws(() => pawnArgs('say "hi"'), /single quotes/);
  assert.throws(() => pawnArgs('is %PATH% set'), /single quotes/);
  const r = recorder();
  pawn(['out.json', 'What is X?'], r.x);
  const l = launched(r.calls);
  assert.match(l[1], /agy\.exe$/);
  assert.match(l[3], /agy-research$/);
  assert.equal(l[4], 'ignore');
  assert.equal(l[7], resolve('out.json'));
  assert.deepEqual(r.calls.find((c) => c[0] === 'queueOpen').slice(1), ['pawn', 'agy', resolve('out.json')]);
  for (const bad of [[], ['out.json'], ['out.txt', 'q'], ['out.json', 'q', 'extra'], ['out.json', 'a\nb'], ['out.json', '100%'], ['out.json', 'say "hi"']]) assert.throws(() => pawn(bad, r.x), /usage|one line|single quotes/);
  assert.equal(r.calls.filter((c) => c[0] === 'launch').length, 1);
  assert.equal(r.calls.filter((c) => c[0] === 'open').length, 1); // refused questions opened no file
  // each out file has its own lock: a second pawn with another out file starts, the same out file is refused
  const two = recorder();
  two.x.locked = (cwd, lock) => lock.endsWith('.run-lock-a.json');
  pawn(['b.json', 'Q2?'], two.x);
  assert.match(launched(two.calls)[9], /agy-research[\\/]\.run-lock-b\.json$/);
  assert.throws(() => pawn(['a.json', 'Q1?'], two.x), /in use/);
});

test('TODO 196g: board runs Bishop on <brief> into <out> as WORKFLOW line 194; missing brief or bad usage launches nothing', (t) => {
  t.mock.method(console, 'log', () => {});
  assert.deepEqual(boardArgs('E'), ['-p', '--model', 'claude-sonnet-5-5', '--effort', 'high', '--permission-mode', 'dontAsk', '--max-budget-usd', '4', '--output-format', 'text',
    '--add-dir', 'E', '--add-dir', 'E:/Project B/Claude/Project D', '--allowedTools', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash(node:*)', '--disallowedTools', 'Agent']);
  const r = recorder();
  board(['b-ab1.txt', 'b-ab1.out'], r.x);
  const l = launched(r.calls);
  assert.match(l[1], /claude2\.cmd$/);
  assert.equal(l[3], `${X}/runs33`);
  assert.equal(l[4], `fd:${resolve('b-ab1.txt')}`);
  assert.equal(l[7], resolve('b-ab1.out'));
  assert.equal(l[9], `${X}/runs33/.run-lock-b-ab1.out`);
  assert.deepEqual(r.calls.find((c) => c[0] === 'queueOpen').slice(1), ['board', 'b-ab1.out', resolve('b-ab1.out')]);
  const missing = recorder();
  missing.x.need = (path) => { if (path.endsWith('b-ab1.txt')) throw new Error('board brief not found'); };
  assert.throws(() => board(['b-ab1.txt', 'b-ab1.out'], missing.x), /board brief not found/);
  for (const bad of [[], ['a.txt'], ['a', 'b', 'c']]) assert.throws(() => board(bad, r.x), /usage/);
  assert.equal(r.calls.filter((c) => c[0] === 'launch').length, 1);
});

test('TODO 196b: Pawn refuses a second numbered question before opening files or launching', () => {
  for (const question of ['(1) First? (2) Second?', '(2) Second?', '1. First? 2. Second?', '1) First? 2) Second?', '2. Second?', '2) Second?']) {
    assert.throws(() => pawnArgs(question), { message: 'pawn: one question per Pawn run' });
    const r = recorder();
    assert.throws(() => pawn(['out.json', question], r.x), { message: 'pawn: one question per Pawn run' });
    assert.deepEqual(r.calls, []);
  }
  for (const question of ['1. First?', 'Q2?', 'What does x2) mean?', 'What about (12)?', 'Is Tauri 2.5 out?', 'Windows 2.0?', 'Is 2027 the year?']) assert.equal(pawnArgs(question)[1].startsWith(question), true);
});

test('TODO 167e lows: a missing queue.txt gives no queue line; launchRun with its own lock writes and removes that one', () => {
  assert.equal(queueLineOf('q.txt', 'build', 'br', '/a/o.jsonl', () => false), null);
  assert.deepEqual(queueLineOf('q.txt', 'build', 'br', '/a/o.jsonl', () => true), { queue: 'q.txt', key: 'o.jsonl', text: 'build br -> o.jsonl:' });
  const dir = mkdtempSync(join(tmpdir(), 'rook-lock-')), lock = join(dir, '.run-lock-x'), seen = [];
  launchRun('x.cmd', ['ok'], dir, 0, 1, {}, 'o', (bin, argv) => { seen.push(argv); return fakeSpawn().child; }, undefined, null, lock);
  assert.equal(seen[0][3], lock);
  assert.ok(existsSync(lock) && !existsSync(join(dir, '.run-lock')));
  launchFailed(dir, new Error('x'), () => {}, lock);
  assert.equal(existsSync(lock), false);
  rmSync(dir, { recursive: true });
});
