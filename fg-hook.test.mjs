// tools/fg-hook.mjs: King's builder (account 3, agent_type builder) can't background Bash / PowerShell or use Monitor.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const run = (input, dir) => spawnSync(process.execPath, ['tools/fg-hook.mjs'], {
  input: typeof input === 'string' ? input : JSON.stringify(input),
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
});
const K = 'C:\\Users\\raksh\\.claude-account3';
const B = { agent_type: 'builder' };

let r = run({ ...B, tool_name: 'Bash', tool_input: { command: 'npm test', run_in_background: true } }, K);
assert.equal(r.status, 2, 'builder on account3 + background Bash is blocked');
assert.match(r.stderr, /foreground/);

r = run({ ...B, tool_name: 'PowerShell', tool_input: { command: 'npm.cmd test', run_in_background: true } }, K);
assert.equal(r.status, 2, 'builder on account3 + background PowerShell is blocked');

r = run({ ...B, tool_name: 'Monitor', tool_input: {} }, K);
assert.equal(r.status, 2, 'builder on account3 + Monitor is blocked');

r = run({ ...B, tool_name: 'Bash', tool_input: { command: 'npm test' } }, K);
assert.equal(r.status, 0, 'builder foreground Bash is allowed');

r = run({ tool_name: 'Bash', tool_input: { command: 'npm test', run_in_background: true } }, K);
assert.equal(r.status, 0, 'account3 without agent_type (King-lead) background Bash is allowed');

r = run({ tool_name: 'Monitor', tool_input: {} }, K);
assert.equal(r.status, 0, 'account3 without agent_type (King-lead) Monitor is allowed');

r = run({ ...B, tool_name: 'Bash', tool_input: { command: 'npm test', run_in_background: true } }, 'C:\\Users\\raksh\\.claude');
assert.equal(r.status, 0, 'main account background Bash is allowed');

r = run('not json', K);
assert.equal(r.status, 0, 'bad stdin is allowed');

r = run('null', K);
assert.equal(r.status, 0, 'null stdin is allowed');

// TODO 196e: wait prints only at the end, for every account and agent.
for (const dir of [K, 'C:\\Users\\raksh\\.claude', 'C:\\Users\\raksh\\.claude-account2']) {
  for (const agent_type of [undefined, 'builder', 'reviewer']) {
    for (const tool_name of ['Bash', 'PowerShell']) {
      for (const command of ['node tools/rook.mjs wait run.log', 'node "E:/Project B/tools/rook.mjs" wait run.log', "& node 'E:/x/tools/rook.mjs' wait a.log"]) {
        for (const run_in_background of [undefined, false, 'true', true]) {
          r = run({ agent_type, tool_name, tool_input: { command, run_in_background } }, dir);
          assert.equal(r.status, run_in_background === true ? 0 : 2, JSON.stringify({ dir, agent_type, tool_name, command, run_in_background }));
          assert.equal(r.stderr, run_in_background === true ? '' : 'rook.mjs wait prints only at the end: run it in the background or as a Monitor\n');
        }
        r = run({ agent_type, tool_name: 'Monitor', tool_input: { command } }, dir);
        assert.equal(r.status, 0, 'Monitor wait passes, including King builder');
      }
      for (const command of ['node tools/rook.mjs waiter', 'node tools/rook.mjs retro', 'npm.cmd test', 'git grep -n "rook.mjs wait" WORKFLOW.md']) {
        assert.equal(run({ agent_type, tool_name, tool_input: { command } }, dir).status, 0, command);
      }
    }
  }
}

console.log('fg-hook tests passed');
