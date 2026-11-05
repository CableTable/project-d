// PreToolUse hook (Bash|PowerShell|Monitor): wait needs background / Monitor; King's other builder calls stay foreground.
// Exit 2 refuses the call and feeds stderr back to the agent; anything else lets it through.
import { readFileSync } from 'node:fs';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch {}
if (['Bash', 'PowerShell', 'Monitor'].includes(input?.tool_name) && /\bnode\s+(?:"[^"]*|\S*)rook\.mjs["']?\s+wait\b/.test(input.tool_input?.command ?? '')) {
  if (input.tool_name !== 'Monitor' && input.tool_input?.run_in_background !== true) {
    process.stderr.write('rook.mjs wait prints only at the end: run it in the background or as a Monitor\n');
    process.exit(2);
  }
  process.exit(0);
}
// Only King's builder is held to the foreground; King-lead (no agent_type) may background.
if (!/account3/i.test(process.env.CLAUDE_CONFIG_DIR || '') || input?.agent_type !== 'builder') process.exit(0);

if (input.tool_name === 'Monitor' || (['Bash', 'PowerShell'].includes(input.tool_name) && input.tool_input?.run_in_background === true)) {
  process.stderr.write('King runs tests in the foreground (timeout 600000); over 10 min means the filter is too wide: split it\n');
  process.exit(2);
}
