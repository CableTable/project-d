// Stop hook (.claude/settings.json): a Bishop or King builder (2nd / 3rd account) can't finish with web/ changes while `npm test` is red.
// Exit 2 blocks the stop and feeds stderr back to the agent; anything else lets it stop.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch {}
if (input.stop_hook_active) process.exit(0);                          // already blocked once: don't loop
if (!/account[23]/i.test(process.env.CLAUDE_CONFIG_DIR || '')) process.exit(0); // Rook (main account) is never blocked

const git = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return 'x'; } };
// uncommitted, or committed but not pushed (no upstream counts as changed)
const changed = git('git status --porcelain -- web tools package.json') || git('git log @{u}..HEAD --name-only --format= -- web tools package.json');
if (!changed) process.exit(0);                                         // reviewers and lookups edit nothing

try {
  execSync('npm.cmd test', { stdio: 'pipe', encoding: 'utf8' });
} catch (e) {
  const out = `${e.stdout || ''}${e.stderr || ''}`.split('\n').slice(-40).join('\n');
  process.stderr.write(`npm test is red with unpushed changes in web/. Fix it before finishing:\n${out}\n`);
  process.exit(2);
}
