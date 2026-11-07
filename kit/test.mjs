// node kit/test.mjs: the kit's own tests (every *.test.mjs beside this file), run from the project's checkout (some read process.cwd() as the project).
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).map((f) => join(dir, f));
const r = spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
