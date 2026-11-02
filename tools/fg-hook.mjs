// PreToolUse hook (.claude/settings.json, matcher Bash|Monitor): King (3rd account) runs everything in the foreground.
// Exit 2 refuses the call and feeds stderr back to the agent; anything else lets it through.
import { readFileSync } from 'node:fs';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch {}
if (!/account3/i.test(process.env.CLAUDE_CONFIG_DIR || '')) process.exit(0);

if (input.tool_name === 'Monitor' || (input.tool_name === 'Bash' && input.tool_input?.run_in_background === true)) {
  process.stderr.write('King runs tests in the foreground (timeout 600000); over 10 min means the filter is too wide: split it\n');
  process.exit(2);
}
