// Runs every *.test.mjs in the repo folder except browser.test.mjs (that one is `npm run test:browser`), so a new test file cannot be forgotten.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = readdirSync('.').filter((f) => f.endsWith('.test.mjs') && f !== 'browser.test.mjs').sort();
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
