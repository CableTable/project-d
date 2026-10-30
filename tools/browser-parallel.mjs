// npm run test:browser -- [first-port] [only] [--shots <dir>]; each child owns its server and browser.
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

// A regex (ONLY or the 2nd argument) bypasses shard filtering, so launch that focused run just once.
const args = process.argv.slice(2);
const at = args.indexOf('--shots');
const shots = at < 0 ? [] : args.splice(at, 2); // each shard files its pictures under <dir>/shard-N-of-M (browser.test.mjs)
if (at >= 0 && (!shots[1] || shots[1].startsWith('--'))) { console.error('--shots requires a directory'); console.log('1 failed'); process.exit(1); }
const only = process.env.ONLY || args[1];
const count = only ? 1 : 4;
const port = Number(process.env.TEST_PORT || args[0] || 5181);
if (!Number.isInteger(port) || port < 1 || port + count - 1 > 65535) {
  console.error('Invalid first browser test port');
  console.log('1 failed');
  process.exit(1);
}
const children = [];
// win32: kill() leaves the child's server and Chromium running, so end the whole tree.
const stop = () => {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode) continue;
    if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
    else child.kill();
  }
};
process.on('exit', stop);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(1));
const failed = await Promise.all(Array.from({ length: count }, (_, i) => new Promise((resolve) => {
  const started = performance.now();
  const label = `[shard ${i + 1}/${count}]`;
  const child = spawn(process.execPath, ['browser.test.mjs', String(port + i), ...(only ? [only] : []), ...shots], {
    env: { ...process.env, TEST_PORT: String(port + i), ...(only ? {} : { SHARD: `${i + 1}/${count}` }) },
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
