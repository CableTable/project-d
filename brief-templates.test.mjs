import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lintBrief } from './tools/rook-launch.mjs';

const dir = new URL('./tools/briefs/', import.meta.url);
const values = {
  'King|Knight': 'King', item: '170', summary: 'brief templates', branch: 'knight/170', sha: '943c3e1',
  'base sha': '9572997', 'spec path': '../runs32/grill-170.md', 'brief path': '../runs32/b-170.txt',
  N: '32', file: 'rev-170.jsonl','preserved behaviour': 'existing brief linting',
  'Do list': '1. Check the brief templates.\n2. `npm.cmd test` passes.\n3. Tick TODO 170 in TODO.md.',
  'commit title': 'TODO 170: brief templates', 'report size': '5', 'area words': 'brief template|brief lint', img: '<img>', // board.txt names the HTML tag
};

for (const file of readdirSync(dir).filter((name) => name.endsWith('.txt')).sort()) {
  test(`TODO 170: filled ${file} passes lintBrief`, () => {
    const brief = readFileSync(new URL(file, dir), 'utf8').replace(/<([^<>]+)>/g, (_, key) => {
      assert.ok(Object.hasOwn(values, key), `${file}: unknown placeholder <${key}>`);
      return values[key];
    });
    assert.deepEqual(lintBrief(brief), [], file);
    if (file === 'fix.txt') assert.ok(brief.split('\n')[0].includes('source: ../runs32/rev-170.jsonl)'), 'TODO 167c: one ../ in the source path');
  });
}
