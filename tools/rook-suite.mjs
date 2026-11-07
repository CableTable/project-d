// TODO 167e: what `rook.mjs suite` runs, detached: WORKFLOW.md's full-suite line. Its output goes to the launcher's log;
// a line `SUITE unit=<code> browser=<code>` (browser=skipped after a red unit run) ends the run, which `rook.mjs wait` waits for.
import { spawnSync } from 'node:child_process';
import { project, winCmd } from './project.mjs';

const env = { ...process.env, TEST_PORT: process.env.TEST_PORT || '15181' }; // clear of a builder's 5181
const run = (command) => spawnSync(winCmd(command), { stdio: 'inherit', shell: true, env }).status; // one string: an args array with shell: true raises Node's DEP0190 warning
const head = () => String(spawnSync('git rev-parse HEAD', { shell: true, encoding: 'utf8' }).stdout).trim();
const before = head();
const unit = run(project.test);
const browser = unit ? 'skipped' : run(project.browserTest); // red unit: the ~18-minute browser run would only delay the news (S35 retro)
const after = head();
if (after !== before) console.log(`SUITE INVALID head ${before} -> ${after}`); // the suite ran files that changed under it
console.log(`SUITE unit=${unit} browser=${browser}`);
process.exitCode = unit || browser || after !== before ? 1 : 0;
