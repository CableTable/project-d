import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ago, usageText, recentJsonl, findRuns, runsText, bandLine } from './tools/pd-band/hooks/band.mjs';

const MIN = 60_000, now = 10_000_000;
const csv = ['agent,role,model,window,used_pct,cap_pct,starts,resets,as_of',
  'Rook,r,m,5h,12,,s,r,a', 'Rook,r,m,week,40.4,,s,r,a', 'Pip,r,m,5h,3,,s,r,a', 'Pip,r,m,week,21,28,s,r,a', 'Rowan,r,m,5h,5,,s,r,a'].join('\n');
const f = (name, minAgo) => ({ name, mtimeMs: now - minAgo * MIN });

test('usage line: percents, a missing reading, cache age, stale after 15 min, no cache', () => {
  assert.equal(usageText(csv, 2 * MIN), 'Rook 5h 12% wk 40% · Pip 5h 3% wk 21% · Rowan 5h 5% wk ? · 2m ago');
  assert.match(usageText(csv, 15 * MIN), /· 15m ago$/);
  assert.match(usageText(csv, 15 * MIN + 1), /· usage stale 15m$/);
  assert.equal(usageText(null, null), 'no usage cache');
  assert.equal(ago(30_000), '<1m');
  assert.equal(ago(125 * MIN), '2h');
});

test('a Pip run is a recent jsonl with no result line', () => {
  const files = [f('pip-txo-suite.jsonl', 12 - 10), f('pip-done.jsonl', 1), f('pip-old.jsonl', 4), f('pip-stub.txt', 1)];
  assert.deepEqual(recentJsonl(files, now), ['pip-txo-suite.jsonl', 'pip-done.jsonl']);
  const texts = { 'pip-txo-suite.jsonl': '{"type":"assistant"}\n{"type":"user"', 'pip-done.jsonl': '{"type":"assistant"}\n{"type": "result","result":"x"}' };
  assert.deepEqual(findRuns(files, now, texts), [{ who: 'Pip', name: 'txo-suite', age: 2 * MIN }]);
});

test('a Rowan run is a recent log with no newer -r.txt', () => {
  const files = [f('rowan-54.log', 2), f('rowan-54-r.txt', 3), f('rowan-gloss.log', 1), f('rowan-gloss-r.txt', 0.5), f('rowan-late.log', 3), f('rowan-late-r.txt', 4)];
  assert.deepEqual(findRuns(files, now, {}), [{ who: 'Rowan', name: '54', age: 2 * MIN }, { who: 'Rowan', name: 'late', age: 3 * MIN }]);
  assert.deepEqual(findRuns([f('rowan-x.log', 3.1)], now, {}), []);
});

test('the line joins usage and runs, or says idle', () => {
  assert.equal(runsText([]), 'idle');
  const files = [f('pip-txo-suite.jsonl', 12 - 10), f('rowan-54.log', 4 - 1)];
  assert.equal(bandLine(csv, MIN, files, now, {}), 'Rook 5h 12% wk 40% · Pip 5h 3% wk 21% · Rowan 5h 5% wk ? · 1m ago  |  Pip txo-suite 2m · Rowan 54 3m');
  assert.ok(bandLine(csv, MIN, [], now, {}).endsWith('|  idle'));
});
