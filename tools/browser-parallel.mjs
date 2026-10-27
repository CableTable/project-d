// npm run test:browser -- [first-port]; each child owns its server and browser.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// ONLY bypasses shard filtering, so launch that focused run just once.
const count = process.env.ONLY ? 1 : 4;
const port = Number(process.env.TEST_PORT || process.argv[2] || 5181);
if (!Number.isInteger(port) || port < 1 || port + count - 1 > 65535) {
  console.error('Invalid first browser test port');
  console.log('1 failed');
  process.exit(1);
}
const children = [];
const stop = () => { for (const child of children) child.kill(); };
process.on('exit', stop);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(1));
const failed = await Promise.all(Array.from({ length: count }, (_, i) => new Promise((resolve) => {
  const started = performance.now();
  const label = `[shard ${i + 1}/${count}]`;
  const child = spawn(process.execPath, ['browser.test.mjs', String(port + i)], {
    env: { ...process.env, TEST_PORT: String(port + i), SHARD: `${i + 1}/${count}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let failures;
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => {
      const summary = /^(\d+) failed$/.exec(line);
      if (summary) failures = Number(summary[1]);
      console.log(`${label} ${line}`);
    });
  }
  child.on('error', (error) => console.error(`${label} ${error.message}`));
  child.on('close', (code) => {
    console.log(`${label} ${Math.round((performance.now() - started) / 1000)}s, exit ${code}`);
    resolve(code === 0 ? 0 : Math.max(1, failures || 0));
  });
})));
const total = failed.reduce((sum, n) => sum + n, 0);
console.log(total ? `${total} failed` : 'all browser steps passed');
process.exitCode = total ? 1 : 0;
