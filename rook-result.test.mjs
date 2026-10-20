import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { peakContext } from './tools/rook-result.mjs';

const assistant = (usage) => ({ type: 'assistant', message: { usage } });

test('peak context takes the largest assistant input plus cache read and write, excluding output and totals', () => {
  assert.equal(peakContext([]), 0);
  assert.equal(peakContext([
    { type: 'system' }, { type: 'assistant' }, assistant({}),
    assistant({ input_tokens: 1000, cache_read_input_tokens: 120_000, cache_creation_input_tokens: 40_000, output_tokens: 900_000 }),
    assistant({ input_tokens: 2000, cache_read_input_tokens: 50_000 }),
    { type: 'result', usage: { input_tokens: 999_999 } },
    { type: 'user', message: { usage: { input_tokens: 999_999 } } },
  ]), 161_000);
  assert.equal(peakContext([assistant({ input_tokens: 1234 })]), 1234);
});

test('result prints peak context and warns strictly above 150k; Codex logs skip it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'projectd-result-'));
  try {
    const run = join(dir, 'run.jsonl');
    const result = { type: 'result', result: 'Done', usage: { input_tokens: 500_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 200_000, output_tokens: 3000 }, permission_denials: [] };
    const read = (file) => execFileSync(process.execPath, ['tools/rook.mjs', 'result', file], { encoding: 'utf8' });
    for (const peak of [149_999, 150_000, 150_001, 1_100_000]) {
      writeFileSync(run, [assistant({ input_tokens: peak - 50_000, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 10_000 }), result].map((e) => JSON.stringify(e)).join('\r\n') + '\r\n');
      const output = read(run);
      assert.match(output, /^Done\r?\ntokens 1\.70M \(703k new\) · denials 0/);
      assert.ok(output.includes(`peak context ${Math.round(peak / 1000)}k`));
      assert.equal(output.includes(' (over 150k: split the ticket)'), peak > 150_000);
    }
    const log = join(dir, 'run.log'), reply = join(dir, 'run.txt');
    writeFileSync(log, 'tokens used\n123,456\n');
    writeFileSync(reply, 'Codex done\n');
    assert.equal(read(reply).trim(), 'Codex done\ntokens 123,456');
    assert.ok(!read(log).includes('peak context'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
