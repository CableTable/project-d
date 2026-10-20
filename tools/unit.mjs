// Runs every *.test.mjs in the repo folder and tools except browser.test.mjs (that one is `npm run test:browser`).
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = ['.', 'tools'].flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith('.test.mjs') && f !== 'browser.test.mjs').map((f) => `${dir}/${f}`)).sort();
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
