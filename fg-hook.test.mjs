// tools/fg-hook.mjs: King (account 3) can't background Bash or use Monitor.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const run = (input, dir) => spawnSync(process.execPath, ['tools/fg-hook.mjs'], {
  input: typeof input === 'string' ? input : JSON.stringify(input),
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
});
const K = 'C:\\Users\\raksh\\.claude-account3';

let r = run({ tool_name: 'Bash', tool_input: { command: 'npm test', run_in_background: true } }, K);
assert.equal(r.status, 2, 'account3 + background Bash is blocked');
assert.match(r.stderr, /foreground/);

r = run({ tool_name: 'Monitor', tool_input: {} }, K);
assert.equal(r.status, 2, 'account3 + Monitor is blocked');

r = run({ tool_name: 'Bash', tool_input: { command: 'npm test' } }, K);
assert.equal(r.status, 0, 'account3 foreground Bash is allowed');

r = run({ tool_name: 'Bash', tool_input: { command: 'npm test', run_in_background: true } }, 'C:\\Users\\raksh\\.claude');
assert.equal(r.status, 0, 'main account background Bash is allowed');

r = run('not json', K);
assert.equal(r.status, 0, 'bad stdin is allowed');

console.log('fg-hook tests passed');
