// T76 / T78: node tools/perf-interact.mjs <file.dxf|spline:900> [port=5184]
// Counts are for the drawing canvas; timings include instrumentation and depend on the machine.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { splineDoc } from './gen-big-dxf.mjs';
import { writeDxf } from '../web/dxf-write.js';
import { decodeDxf, readDxf, flatten, mapply } from '../web/drawing.js';
import { shownItems, itemVisible, startHidden, unitFactor } from '../web/doc.js';

// Shared with the browser count regression so it measures the same interactions as this tool.
export async function interact(page, buffer, name = 'spline.dxf') {
  const doc = readDxf(decodeDxf(buffer)), fl = flatten(doc), off = startHidden(fl);
  const it = shownItems(fl).find((it) => it.k === 'p' && itemVisible(it, off) && [0, 2].includes(it.ops[0]));
  assert.ok(it, 'the DXF needs a visible path for the select / Delete / Undo measurements');
  const op = it.ops, p = op[0] === 0 ? [op[1], op[2]] : [op[1] + op[3] * Math.cos(op[4]), op[2] + op[3] * Math.sin(op[4])];
  const pick = mapply(fl.mats[it.m], ...p).map((v) => v * unitFactor(fl.units));
  await page.evaluate(() => {
    const rec = { frames: [], long: [], lineTo: 0 }, proto = CanvasRenderingContext2D.prototype, lineTo = proto.lineTo;
    proto.lineTo = function (...args) {
      if (this.canvas.dataset.testid === 'drawing') rec.lineTo++;
      return lineTo.apply(this, args);
    };
    const observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) rec.long.push(e.duration); });
    observer.observe({ entryTypes: ['longtask'] });
    let raf;
    const tick = (t) => { rec.frames.push(t); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    window.__perfInteract = { rec, observer, stop() { cancelAnimationFrame(raf); observer.disconnect(); proto.lineTo = lineTo; } };
  });
  const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const count = () => page.locator('[data-testid=entities]').textContent().then((s) => Number(s.replace(/\D/g, '')));
  const results = [];
  const run = async (action, fn) => {
    const paints = await page.evaluate(() => {
      const { rec, observer } = window.__perfInteract;
      observer.takeRecords(); rec.frames = [performance.now()]; rec.long = []; rec.lineTo = 0;
      return Number(document.querySelector('[data-testid=drawing]').dataset.paints);
    });
    assert.ok(Number.isFinite(paints), 'data-paints full-paint counter is installed');
    const started = Date.now();
    await fn(); await frame();
    const ms = Date.now() - started;
    // Include the 120 ms gesture settle paint and delivery of long-task records.
    await page.waitForTimeout(500); await frame();
    const rec = await page.evaluate(() => {
      const { rec, observer } = window.__perfInteract;
      for (const e of observer.takeRecords()) rec.long.push(e.duration);
      return { ...rec, paints: Number(document.querySelector('[data-testid=drawing]').dataset.paints) };
    });
    const gaps = rec.frames.slice(1).map((t, i) => t - rec.frames[i]).sort((a, b) => a - b);
    const r = { action, ms, frames: gaps.length, gapMedian: gaps[Math.floor(gaps.length / 2)] || 0,
      gapP90: gaps[Math.floor(gaps.length * .9)] || 0, gapMax: gaps.at(-1) || 0,
      longTasks: rec.long.length, longTotal: rec.long.reduce((a, b) => a + b, 0), longMax: Math.max(0, ...rec.long),
      lineTo: rec.lineTo, paints: rec.paints - paints };
    results.push(r);
    console.log(`${action}: ${ms} ms; frames ${r.frames}; gaps median/p90/max ${r.gapMedian.toFixed(1)}/${r.gapP90.toFixed(1)}/${r.gapMax.toFixed(1)} ms; long tasks ${r.longTasks}, total/max ${r.longTotal.toFixed(1)}/${r.longMax.toFixed(1)} ms; lineTo ${r.lineTo}; full paints ${r.paints}`);
  };
  try {
    await run('open', async () => {
      await page.locator('[data-testid=picker]').setInputFiles({ name, mimeType: 'text/plain', buffer });
      await page.waitForFunction((n) => Number(document.querySelector('[data-testid=entities]').textContent.replace(/\D/g, '')) === n, doc.entities.length, { timeout: 120000 });
    });
    await page.locator('[data-testid=canvas]').getByRole('button', { name: 'Fit', exact: true }).click(); await frame();
    const box = await page.locator('[data-testid=canvas]').boundingBox(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const hover = async () => {
      for (let i = 0; i < 40; i++) { await page.mouse.move(cx - 200 + i * 10, cy - 100 + (i % 7) * 12); await frame(); }
    };
    const tool = async (id) => {
      await page.locator(`[data-tool=${id}]`).first().click(); await page.mouse.move(cx, cy); await frame();
    };
    await tool('measure');
    await run('Measure hover', hover);
    await page.keyboard.press('Escape');
    await tool('line');
    await page.mouse.click(cx - 150, cy - 80); await frame();
    await run('Line hover', hover);
    await page.keyboard.press('Escape'); await frame();
    await tool('select');
    const target = await page.locator('rect.sheet').evaluate((el, [x, y]) => {
      const b = el.getBoundingClientRect(), k = b.width / Number(el.getAttribute('width'));
      return { x: b.x + x * k, y: b.y + (Number(el.getAttribute('height')) - y) * k };
    }, pick);
    // Pointer positioning is setup, so a snap-preview hover is not charged to the click.
    await page.mouse.move(target.x, target.y); await frame();
    await run('select click', async () => { await page.mouse.click(target.x, target.y); });
    const selected = Number((await page.locator('[data-testid=sel-count]').textContent()).match(/\d+/)?.[0]);
    assert.ok(selected > 0, 'select click must hit geometry before timing Delete');
    const before = await count();
    await run('Delete', async () => { await page.keyboard.press('Delete'); });
    assert.equal(await count(), before - selected, 'Delete must remove the selection');
    await run('Ctrl+Z', async () => { await page.keyboard.press('Control+z'); });
    assert.equal(await count(), before, 'Ctrl+Z must restore the deleted entities');
    await page.keyboard.press('Escape'); await frame();
    await page.mouse.move(cx, cy); await frame();
    await run('wheel', async () => {
      for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, i % 2 ? -150 : 150); await frame(); }
    });
    await run('pan', async () => {
      await page.mouse.down({ button: 'middle' });
      for (let i = 0; i < 30; i++) { await page.mouse.move(cx + i * 4, cy + i * 2); await frame(); }
      await page.mouse.up({ button: 'middle' });
    });
    return results;
  } finally {
    await page.evaluate(() => { window.__perfInteract.stop(); delete window.__perfInteract; });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const input = process.argv[2], port = Number(process.argv[3]) || 5184;
  if (!input) { console.error('usage: node tools/perf-interact.mjs <file.dxf|spline:900> [port]'); process.exit(1); }
  const buffer = input.startsWith('spline:') ? Buffer.from(writeDxf(splineDoc(Number(input.slice(7))))) : readFileSync(input);
  const server = spawn(process.execPath, ['serve.mjs', String(port)], { stdio: 'ignore', env: { ...process.env, PORT: String(port) } });
  let browser;
  try {
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await page.goto(`http://localhost:${port}/?autosave=86400000`);
    await page.waitForSelector('[data-testid=count]', { state: 'attached' });
    await interact(page, buffer, input.startsWith('spline:') ? 'spline.dxf' : basename(input));
  } finally { await browser?.close(); server.kill(); }
}
