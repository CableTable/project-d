// Open / pan / zoom timings on a generated big DXF (TODO 55).   node tools/perf-big.mjs [count=100000] [port=5183]
// Prints ms for the open, and ms per frame + fps for a wheel zoom run and a pan drag run. Numbers depend on the machine.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { bigDoc } from './gen-big-dxf.mjs';
import { writeDxf } from '../web/dxf-write.js';

const N = Number(process.argv[2]) || 100000, PORT = Number(process.argv[3]) || 5183;
const server = spawn(process.execPath, ['serve.mjs', String(PORT)], { stdio: 'ignore', env: { ...process.env, PORT: String(PORT) } });
const buffer = Buffer.from(writeDxf(bigDoc(N)));
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 100)); }
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('[data-testid=count]', { state: 'attached' });
  const t0 = Date.now();
  await page.locator('[data-testid=picker]').setInputFiles({ name: 'big.dxf', mimeType: 'text/plain', buffer });
  await page.waitForFunction((n) => document.body.textContent.includes('Entities ' + n), N, { timeout: 120000 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const open = Date.now() - t0;
  const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const box = await page.locator('[data-testid=canvas]').boundingBox(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const STEPS = 60;
  await page.evaluate(() => { window.__frames = 0; const tick = () => { window.__frames++; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  const run = async (name, fn) => { await frame(); const f0 = await page.evaluate(() => window.__frames), t = Date.now(); for (let i = 0; i < STEPS; i++) await fn(i); await frame(); const s = (Date.now() - t) / 1000, f = (await page.evaluate(() => window.__frames)) - f0; console.log(`${name}: ${(f / s).toFixed(1)} fps (${(1000 * s / STEPS).toFixed(1)} ms per step)`); };
  await page.mouse.move(cx, cy);
  await run('idle (baseline: two rAFs)', async () => {});
  await run('zoom in (whole drawing in view)', async () => { await page.mouse.wheel(0, -40); });
  await page.getByRole('button', { name: 'Fit', exact: true }).click(); await frame();
  await run('zoom out/in at fit', async (i) => { await page.mouse.wheel(0, i % 2 ? -150 : 150); });
  await page.getByRole('button', { name: 'Fit', exact: true }).click(); await frame();
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -200);          // into a few cells' worth of the drawing
  await frame();
  await page.locator('[data-tool=pan]').click();
  await page.mouse.move(cx, cy); await page.mouse.down();
  await run('pan (zoomed in)', async (i) => { await page.mouse.move(cx + (i % 2 ? 1 : -1) * 3 * (i % 20), cy + 2 * (i % 20)); });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Fit', exact: true }).click(); await frame();
  await page.mouse.move(cx, cy); await page.mouse.down();
  await run('pan (fitted, all 100k in view)', async (i) => { await page.mouse.move(cx + (i % 2 ? 1 : -1) * 3 * (i % 20), cy + 2 * (i % 20)); });
  await page.mouse.up();
  console.log(`entities: ${N}; open: ${open} ms`);
  await browser.close();
} finally { server.kill(); }
