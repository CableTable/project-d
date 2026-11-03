// TODO 167e: what `rook.mjs suite` runs, detached: WORKFLOW.md's full-suite line. Its output goes to the launcher's log;
// a line `SUITE unit=<code> browser=<code>` ends the run, which `rook.mjs wait` waits for.
import { spawnSync } from 'node:child_process';

const run = (args) => spawnSync(`npm.cmd ${args.join(' ')}`, { stdio: 'inherit', shell: true }).status; // one string: an args array with shell: true raises Node's DEP0190 warning
const unit = run(['test']);
const browser = run(['run', 'test:browser']);
console.log(`SUITE unit=${unit} browser=${browser}`);
process.exitCode = unit || browser ? 1 : 0;
