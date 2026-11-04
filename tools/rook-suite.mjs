// TODO 167e: what `rook.mjs suite` runs, detached: WORKFLOW.md's full-suite line. Its output goes to the launcher's log;
// a line `SUITE unit=<code> browser=<code>` (browser=skipped after a red unit run) ends the run, which `rook.mjs wait` waits for.
import { spawnSync } from 'node:child_process';

const run = (args) => spawnSync(`npm.cmd ${args.join(' ')}`, { stdio: 'inherit', shell: true }).status; // one string: an args array with shell: true raises Node's DEP0190 warning
const unit = run(['test']);
const browser = unit ? 'skipped' : run(['run', 'test:browser']); // red unit: the ~18-minute browser run would only delay the news (S35 retro)
console.log(`SUITE unit=${unit} browser=${browser}`);
process.exitCode = unit || browser ? 1 : 0;
