// Stop hook (.claude/settings.json): a Bishop or King builder (2nd / 3rd account) can't finish with web/ changes while `npm test` is red.
// Exit 2 blocks the stop and feeds stderr back to the agent; anything else lets it stop.
import { execSync, execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { rookStop } from './stop-hook-rook.mjs';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch {}
if (input.stop_hook_active) process.exit(0);                          // already blocked once: don't loop
if (!/account[23]/i.test(process.env.CLAUDE_CONFIG_DIR || '')) {      // Rook (main account): handover and suite-green checks only (TODO 190a)
  const msg = rookStop(input, { read: (p) => readFileSync(p, 'utf8'), exists: existsSync, git: (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() });
  if (msg) { process.stderr.write(`${msg}\n`); process.exit(2); }
  process.exit(0);
}

const git = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return 'x'; } };
// uncommitted, or committed but on no remote branch (King branches have no upstream, so `@{u}` would fail and count every stop as changed)
const changed = git('git status --porcelain -- web tools package.json') || git('git log HEAD --not --remotes --name-only --format= -- web tools package.json');
if (!changed) process.exit(0);                                         // reviewers and lookups edit nothing

try {
  execSync('npm.cmd test', { stdio: 'pipe', encoding: 'utf8' });
} catch (e) {
  const out = `${e.stdout || ''}${e.stderr || ''}`.split('\n').slice(-40).join('\n');
  process.stderr.write(`npm test is red with unpushed changes in web/. Fix it before finishing:\n${out}\n`);
  process.exit(2);
}
