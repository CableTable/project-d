import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserArgs, expandNeeds, pickSteps, shardSelector } from './tools/browser-shards.mjs';

function stepNames(source) {
  const names = [];
  let skipped = 0;
  const calls = /\bfunction\s+step\s*\(|\bstep\s*\(\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\])*)`)?/g;
  for (const match of source.matchAll(calls)) {
    if (match[0].startsWith('function')) continue;
    const name = match[1] ?? match[2] ?? match[3];
    if (name === undefined || match[3]?.includes('${') || !/^\s*[,)]/.test(source.slice(match.index + match[0].length))) skipped++;
    else names.push(name.replace(/\\(['"`\\])/g, '$1'));
  }
  return { names, skipped };
}

test('TODO F19b: untimed steps stay under 10%', (t) => {
  const MAX_UNTIMED = 0.10;
  assert.deepEqual(stepNames("function step(name, fn) {}\r\nstep('single', fn); step(\"double\", fn); step(`plain`, fn); step('it\\'s', fn); step(`dynamic ${name}`, fn); step(variable, fn); step('prefix' + name, fn);"), {
    names: ['single', 'double', 'plain', "it's"], skipped: 3,
  });
  const { names, skipped } = stepNames(readFileSync(new URL('./browser.test.mjs', import.meta.url), 'utf8'));
  const timings = JSON.parse(readFileSync(process.env.F19B_TIMINGS || new URL('./tools/browser-shards.json', import.meta.url), 'utf8'));
  assert.ok(names.length > 0, 'no browser step names parsed');
  const missing = names.filter((name) => !Object.hasOwn(timings, name));
  const message = `${missing.length}/${names.length} untimed steps; ${skipped} dynamic names skipped. Missing (up to 10): ${missing.slice(0, 10).join('; ')}. Fix: node browser.test.mjs <port> --update-timings`;
  t.diagnostic(message);
  assert.ok(missing.length / names.length <= MAX_UNTIMED, message);
});

test('four contiguous shards balance time, cover every step once, and include new steps', () => {
  const timings = { a: 8, b: 1, c: 1, d: 10, e: 5, f: 5, g: 10, 'no console errors': 0 };
  const names = ['new first', 'a', 'b', 'new middle', 'c', 'd', 'e', 'f', 'g', 'new last'];
  const groups = [1, 2, 3, 4].map((index) => {
    const select = shardSelector(timings, index, 4);
    const group = names.filter(select);
    assert.equal(select('no console errors'), true);
    return group;
  });
  assert.deepEqual(groups, [['new first', 'a', 'b', 'new middle', 'c'], ['d'], ['e', 'f'], ['g', 'new last']]);
  assert.deepEqual(groups.flat(), names);
  assert.deepEqual(groups.map((group) => group.reduce((n, name) => n + (timings[name] || 0), 0)), [10, 10, 10, 10]);
  // Removing a timed boundary does not swallow a later shard.
  const select = shardSelector(timings, 3, 4);
  assert.deepEqual(['a', 'b', 'c', 'd', 'f', 'g'].filter(select), ['f']);
});

test('arguments preserve ONLY and full runs; reject invalid shards and partial timing updates', () => {
  assert.deepEqual(browserArgs(['5291']), { port: 5291, only: undefined, shard: undefined, updateTimings: false, shots: 'shots', until: undefined });
  assert.deepEqual(browserArgs(['5291', 'SHARD=2/4']).shard, { index: 2, count: 4 });
  assert.deepEqual(browserArgs(['--shard=3/4'], { TEST_PORT: '5292' }).shard, { index: 3, count: 4 });
  assert.deepEqual(browserArgs([], { SHARD: '1/4' }).shard, { index: 1, count: 4 });
  assert.equal(browserArgs(['5291', 'some regex'], { SHARD: 'bad' }).shard, undefined);
  assert.equal(browserArgs([], { ONLY: 'some regex', SHARD: '4/4' }).only, 'some regex');
  for (const SHARD of ['0/4', '5/4', '1/0', '-1/4', 'abc', '1/4/2']) assert.throws(() => browserArgs([], { SHARD }), /SHARD/);
  assert.equal(browserArgs(['5291', '--update-timings']).updateTimings, true);
  assert.throws(() => browserArgs(['--update-timings'], { SHARD: '1/4' }), /full/);
  assert.throws(() => browserArgs(['--update-timings'], { ONLY: 'some regex' }), /full/);
  assert.throws(() => browserArgs(['65536']), /port/);
  assert.throws(() => shardSelector({ a: -1, b: 1 }, 1, 2), /timing/);
  assert.throws(() => shardSelector({ a: 1 }, 1, 4), /enough/);
});

test('--shots consumes its directory, preserves filters and shards, and overrides SHOTS_DIR', () => {
  for (const args of [['5291', 'some regex', '--shots', 'shots-kretro'], ['--shots', 'shots-kretro', '5291', 'some regex']]) {
    assert.deepEqual(browserArgs(args, { SHOTS_DIR: 'env shots' }), {
      port: 5291, only: 'some regex', shard: undefined, updateTimings: false, shots: 'shots-kretro', until: undefined,
    });
  }
  assert.equal(browserArgs([], { SHOTS_DIR: 'env shots' }).shots, 'env shots');
  assert.equal(browserArgs([], { SHOTS_DIR: '' }).shots, 'shots');
  const sharded = browserArgs(['5291', '--shots', 'shots with spaces', 'SHARD=2/4']);
  assert.equal(sharded.shots, 'shots with spaces');
  assert.deepEqual(sharded.shard, { index: 2, count: 4 });
  assert.equal(browserArgs(['5291', '--shots', 'shots-kretro', '--update-timings']).updateTimings, true);
  for (const args of [['--shots'], ['--shots', ''], ['--shots', '--update-timings'], ['--shots', 'SHARD=2/4']]) {
    assert.throws(() => browserArgs(args), /--shots requires a directory/);
  }
});

test('name filters expand transitive and shared needs once, in file order', () => {
  const steps = [
    { name: 'setup' }, { name: 'unrelated' }, { name: 'drawing', needs: ['setup'] },
    { name: 'layout', needs: ['drawing', 'setup'] }, { name: 'save', needs: ['layout', 'drawing'] },
    { name: 'no console errors' },
  ];
  assert.deepEqual(expandNeeds(steps, '^save$|no console errors'), [steps[0], ...steps.slice(2)]);
  assert.deepEqual(expandNeeds(steps, 'drawing|layout|save'), [steps[0], ...steps.slice(2, 5)]);
  assert.deepEqual(expandNeeds(steps, '^setup$'), [steps[0]]);
  assert.deepEqual(expandNeeds(steps, 'absent'), []);
  assert.deepEqual(expandNeeds(steps, '.*'), steps);
  assert.deepEqual(steps[3].needs, ['drawing', 'setup'], 'expansion does not mutate metadata');
  assert.throws(() => expandNeeds([{ name: 'a', needs: ['missing'] }], 'a'), /Unknown.*missing/);
  assert.throws(() => expandNeeds([{ name: 'a', needs: ['b'] }, { name: 'b' }], 'a'), /must precede/);
  assert.throws(() => expandNeeds([{ name: 'a', needs: ['a'] }], 'a'), /must precede/);
  assert.throws(() => expandNeeds([{ name: 'a' }, { name: 'a' }], 'a'), /Duplicate/);
});

test('a filter matching no step throws; a match, or no filter, picks steps', () => {
  const steps = [{ name: 'one' }, { name: 'two' }];
  const all = () => true;
  assert.throws(() => pickSteps(steps, 'one,two', all), /filter one,two matches no step/);
  assert.throws(() => pickSteps(steps, 'one', (name) => name !== 'one'), /matches no step/);
  assert.deepEqual(pickSteps(steps, 'one|two', all), steps);
  assert.deepEqual(pickSteps(steps, undefined, all), steps);
});

test('TODO K5: --until parses an exact step name without becoming ONLY', () => {
  const until = 'second step [exact]=yes';
  for (const args of [['5291', 'SHARD=1/4', `--until=${until}`], [`--until=${until}`, '5291', '--shard=1/4']]) {
    const parsed = browserArgs(args);
    assert.equal(parsed.until, until);
    assert.equal(parsed.only, undefined);
    assert.deepEqual(parsed.shard, { index: 1, count: 4 });
  }
  assert.throws(() => browserArgs(['--update-timings', `--until=${until}`]), /full/);
});

test('TODO K5: --until stops at the exact selected step, inclusive and in suite order', () => {
  const names = ['a', 'b', 'new step', 'c [exact]=yes', 'c', 'd', 'no console errors'];
  const steps = names.map((name) => ({ name }));
  const select = () => shardSelector({ a: 1, b: 1, 'c [exact]=yes': 1, c: 1, d: 4 }, 1, 2);
  assert.deepEqual(pickSteps(steps, undefined, select(), 'c [exact]=yes'), steps.slice(0, 4));
  assert.deepEqual(pickSteps(steps, undefined, select(), 'a'), steps.slice(0, 1));
  assert.deepEqual(pickSteps(steps, undefined, select(), 'c'), steps.slice(0, 5));
  for (const until of ['missing', 'c [exact]', 'd', '']) {
    assert.throws(() => pickSteps(steps, undefined, select(), until), /--until.*not in the selected steps/);
  }
});

test('local runner launches four children together, prefixes failures and counts crashed children', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-browser-shards-'));
  try {
    writeFileSync(join(dir, 'browser.test.mjs'), `
      import assert from 'node:assert/strict';
      import { writeFileSync, readdirSync } from 'node:fs';
      const focused = process.env.ONLY || process.argv[3];
      assert.equal(!process.env.SHARD, Boolean(focused), 'a focused run is unsharded');
      const index = focused ? 1 : Number(process.env.SHARD.split('/')[0]);
      const count = focused ? 1 : 4;
      assert.equal(process.argv[2], String(5290 + index));
      assert.equal(process.env.TEST_PORT, process.argv[2]);
      writeFileSync('ready-' + index, '');
      const end = Date.now() + 5000;
      while (readdirSync('.').filter((name) => name.startsWith('ready-')).length < count) {
        assert.ok(Date.now() < end, 'all four shards must start concurrently');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (process.env.RUNNER_FAILURE && index === 4) process.exit(1);
      if (process.env.RUNNER_FAILURE && index === 2) {
        console.error('FAIL example'); console.log('2 failed'); process.exit(1);
      }
      console.log('all browser steps passed');
    `);
    // The last case is the pre-151 form: the regex as the 2nd argument.
    for (const [fail, only, arg] of [['', ''], ['1', ''], ['', 'focused step'], ['', '', 'focused step']]) {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('./tools/browser-parallel.mjs', import.meta.url)), '5291', ...(arg ? [arg] : [])], {
        cwd: dir, encoding: 'utf8', timeout: 10000,
        env: { ...process.env, TEST_PORT: '', RUNNER_FAILURE: fail, ONLY: only },
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, fail ? 1 : 0, result.stdout + result.stderr);
      assert.equal(result.stdout.trim().split('\n').at(-1), fail ? '3 failed' : 'all browser steps passed');
      if (fail) assert.match(result.stdout, /\[shard 2\/4\] FAIL example/);
      for (const i of only || arg ? [1] : [1, 2, 3, 4]) rmSync(join(dir, `ready-${i}`));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
