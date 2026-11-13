// T76 / T78 / P13: node tools/perf-interact.mjs <file.dxf|spline:900|big:20000> [draw|edit|cmp|lay:<parts>] [port=5184]
// Counts are for the drawing canvas; timings include instrumentation and depend on the machine.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { bigDoc, splineDoc } from './gen-big-dxf.mjs';
import { writeDxf } from '../web/dxf-write.js';
import { decodeDxf, readDxf, flatten, mapply } from '../web/drawing.js';
import { shownItems, itemVisible, startHidden, unitFactor } from '../web/doc.js';

// The recorder every mode shares: long tasks, frame gaps and lineTo on the drawing canvas around each run(), plus the full-paint counter (data-paints).
async function instrument(page) {
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
    const snap = await page.locator('[data-testid=drawing]').getAttribute('data-snap');
    // Include the 120 ms gesture settle paint and delivery of long-task records.
    await page.waitForTimeout(500); await frame();
    const rec = await page.evaluate(() => {
      const { rec, observer } = window.__perfInteract;
      for (const e of observer.takeRecords()) rec.long.push(e.duration);
      return { ...rec, paints: Number(document.querySelector('[data-testid=drawing]').dataset.paints) };
    });
    const gaps = rec.frames.slice(1).map((t, i) => t - rec.frames[i]).sort((a, b) => a - b);
    const r = { action, ms, snap, frames: gaps.length, gapMedian: gaps[Math.floor(gaps.length / 2)] || 0,
      gapP90: gaps[Math.floor(gaps.length * .9)] || 0, gapMax: gaps.at(-1) || 0,
      longTasks: rec.long.length, longTotal: rec.long.reduce((a, b) => a + b, 0), longMax: Math.max(0, ...rec.long),
      lineTo: rec.lineTo, paints: rec.paints - paints };
    results.push(r);
    console.log(`${action}: ${ms} ms; frames ${r.frames}; gaps median/p90/max ${r.gapMedian.toFixed(1)}/${r.gapP90.toFixed(1)}/${r.gapMax.toFixed(1)} ms; long tasks ${r.longTasks}, total/max ${r.longTotal.toFixed(1)}/${r.longMax.toFixed(1)} ms; lineTo ${r.lineTo}; full paints ${r.paints}`);
  };
  const stop = () => page.evaluate(() => { window.__perfInteract.stop(); delete window.__perfInteract; });
  return { frame, count, results, run, stop };
}

// Shared with the browser count regression so it measures the same interactions as this tool.
export async function interact(page, buffer, name = 'spline.dxf') {
  const doc = readDxf(decodeDxf(buffer)), fl = flatten(doc), off = startHidden(fl);
  const it = shownItems(fl).find((it) => it.k === 'p' && itemVisible(it, off) && [0, 2].includes(it.ops[0]));
  assert.ok(it, 'the DXF needs a visible path for the select / Delete / Undo measurements');
  const op = it.ops, p = op[0] === 0 ? [op[1], op[2]] : [op[1] + op[3] * Math.cos(op[4]), op[2] + op[3] * Math.sin(op[4])];
  const pick = mapply(fl.mats[it.m], ...p).map((v) => v * unitFactor(fl.units));
  const { frame, count, results, run, stop } = await instrument(page);
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
  } finally { await stop(); }
}

// P13: the Layout, Compare and drawing-tab edit steps of the lag audit. Counts are asserted by the browser test; the ms are for people.
const openFile = async (page, name, buffer, entities) => {
  await page.locator('[data-testid=picker]').setInputFiles({ name, mimeType: 'text/plain', buffer });
  await page.waitForFunction((n) => document.querySelector('.tabs .dtab.on .tname').textContent === n, name, { timeout: 120000 });
  await page.waitForFunction((n) => Number(document.querySelector('[data-testid=entities]').textContent.replace(/\D/g, '')) === n, entities, { timeout: 120000 });
};
const menu = async (page, top, item) => { await page.locator(`[data-menu=${top}]`).click(); await page.getByRole('menuitem', { name: item, exact: true }).click({ timeout: 120000 }); };
const fitView = async (page, frame) => { await page.locator('[data-testid=canvas]').getByRole('button', { name: 'Fit', exact: true }).click(); await frame(); };
const canvasMid = async (page) => { const b = await page.locator('[data-testid=canvas]').boundingBox(); return { box: b, cx: b.x + b.width / 2, cy: b.y + b.height / 2 }; };
const hoverMoves = async (page, frame, cx, cy, n = 40) => { for (let i = 0; i < n; i++) { await page.mouse.move(cx - 200 + i * 10, cy - 100 + (i % 7) * 12); await frame(); } };
const useTool = async (page, frame, cx, cy, id) => { await page.locator(`[data-tool=${id}]`).first().click(); await page.mouse.move(cx, cy); await frame(); };
const wheelAndPan = async (page, run, frame, label, cx, cy, moves = 20) => {
  await page.mouse.move(cx, cy); await frame();
  await run(`${label} wheel`, async () => { for (let i = 0; i < moves; i++) { await page.mouse.wheel(0, i % 2 ? -150 : 150); await frame(); } });
  await run(`${label} pan`, async () => {
    await page.mouse.down({ button: 'middle' });
    for (let i = 0; i < moves; i++) { await page.mouse.move(cx + i * 4, cy + i * 2); await frame(); }
    await page.mouse.up({ button: 'middle' });
  });
};

/** Layout with `n` placed parts (the drawing added n + 1 times: the first becomes the step-and-repeat grid). */
export async function interactLayout(page, buffer, name = 'lay.dxf', n = 2) {
  const doc = readDxf(decodeDxf(buffer)), { frame, run, results, stop } = await instrument(page);
  try {
    await run('open', () => openFile(page, name, buffer, doc.entities.length));
    await run(`Add to layout x ${n + 1}`, async () => {
      await menu(page, 'Layout', 'Add to layout');
      for (let i = 0; i < n; i++) { await page.locator('.tabs .dtab').first().click(); await menu(page, 'Layout', 'Add to layout'); }
    });
    await fitView(page, frame);
    console.log(`layout: ${await page.locator('[data-group=parts] [data-i]').count()} placed parts, grid copies ${await page.locator('[data-testid=count]').textContent()}`);
    const { cx, cy } = await canvasMid(page);
    await wheelAndPan(page, run, frame, 'Layout', cx, cy);
    await fitView(page, frame);
    await useTool(page, frame, cx, cy, 'measure');
    await run('Layout Measure hover', () => hoverMoves(page, frame, cx, cy));
    await page.keyboard.press('Escape');
    await useTool(page, frame, cx, cy, 'line');
    await page.mouse.click(cx - 150, cy - 80); await frame();
    await run('Layout Line hover', () => hoverMoves(page, frame, cx, cy));
    await page.keyboard.press('Escape'); await frame();
    await useTool(page, frame, cx, cy, 'select');
    await run('Layout part click', async () => { await page.mouse.click(cx, cy); });
    await run('Layout part drag', async () => {
      await page.mouse.move(cx, cy); await page.mouse.down();
      for (let i = 1; i <= 20; i++) { await page.mouse.move(cx + i * 4, cy + i * 2); await frame(); }
      await page.mouse.up();
    });
    await run('Layout undo', async () => { await page.keyboard.press('Control+z'); });
    await page.locator('[data-ribbon-tab=Layout]').click();
    await run('Layout sheet size', async () => {
      for (const [key, v] of [['sheetW', '3000'], ['sheetH', '2000']]) { const f = page.locator(`[data-key=${key}]:visible`).first(); await f.fill(v); await f.press('Enter'); }
      await frame();
    });
    console.log(`grid copies after the sheet size: ${await page.locator('[data-testid=count]').textContent()}`);
    await run('Layout Apply', async () => { await page.locator('[data-testid=apply]').dispatchEvent('click'); });
    return results;
  } finally { await stop(); }
}

/** Compare of the drawing with a second copy of it. */
export async function interactCompare(page, buffer, name = 'cmp.dxf') {
  const doc = readDxf(decodeDxf(buffer)), { frame, run, results, stop } = await instrument(page);
  try {
    await run('open', async () => { await openFile(page, name, buffer, doc.entities.length); await openFile(page, '2-' + name, buffer, doc.entities.length); });
    await run('Compare start', () => menu(page, 'File', 'Compare drawings…'));
    await frame();
    const { cx, cy } = await canvasMid(page);
    await wheelAndPan(page, run, frame, 'Compare', cx, cy);
    await fitView(page, frame);
    await useTool(page, frame, cx, cy, 'select');
    await run('Compare click', async () => { await page.mouse.click(cx, cy); });
    await run('Compare button', async () => { await page.locator('[data-testid=cmp-run]').dispatchEvent('click'); });
    await run('Compare button again', async () => { await page.locator('[data-testid=cmp-run]').dispatchEvent('click'); });
    await run('Compare grip drag', async () => {
      await page.mouse.move(cx, cy); await page.mouse.down();
      for (let i = 1; i <= 20; i++) { await page.mouse.move(cx + i * 4, cy + i * 2); await frame(); }
      await page.mouse.up();
    });
    const x = cx + 40, y = cy - 30;
    assert.ok(await page.getByTestId('grip').evaluateAll((grips, { x, y }) => grips.every((g) => {
      const b = g.getBoundingClientRect();
      return Math.hypot(x - b.x - b.width / 2, y - b.y - b.height / 2) > 12;
    }), { x, y }), 'Compare body press is away from every grip');
    await page.mouse.move(x, y); await frame();
    const hint = await page.getByTestId('cmp-hint').textContent();
    await run('Compare drag', async () => {
      await page.mouse.down();
      for (let i = 1; i <= 20; i++) { await page.mouse.move(x + i * 4, y + i * 2); await frame(); }
      await page.mouse.up();
    });
    assert.notEqual(await page.getByTestId('cmp-hint').textContent(), hint, 'Compare body drag changes the snapshot offset');
    return results;
  } finally { await stop(); }
}

/** The drawing-tab edit steps: select all, box select, Move / Trim hover, a commit click, an object drag, a LINE grip drag, Delete / Undo / Redo. */
export async function interactEdit(page, buffer, name = 'edit.dxf') {
  const doc = readDxf(decodeDxf(buffer)), fl = flatten(doc), off = startHidden(fl), { frame, run, results, stop } = await instrument(page);
  const paths = shownItems(fl).filter((it) => it.k === 'p' && itemVisible(it, off));
  const lines = paths.filter((it) => doc.entities[it.e]?.type === 'LINE' && it.ops[0] === 0 && it.ops[3] === 1);     // a middle one: zooming in on it keeps it clear of the status bars
  const it = paths.find((it) => [0, 2].includes(it.ops[0])), lineIt = lines[lines.length >> 1];
  assert.ok(it, 'the DXF needs a visible path for the select / Delete / Undo measurements');
  const mm = (it, x, y) => mapply(fl.mats[it.m], x, y).map((v) => v * unitFactor(fl.units));
  const p = it.ops[0] === 0 ? [it.ops[1], it.ops[2]] : [it.ops[1] + it.ops[3] * Math.cos(it.ops[4]), it.ops[2] + it.ops[3] * Math.sin(it.ops[4])];
  const screenOf = (pt) => page.locator('rect.sheet').evaluate((el, [x, y]) => {
    const b = el.getBoundingClientRect(), k = b.width / Number(el.getAttribute('width'));
    return { x: b.x + x * k, y: b.y + (Number(el.getAttribute('height')) - y) * k, k };
  }, pt);
  const selCount = async () => Number((await page.locator('[data-testid=sel-count]').textContent()).match(/\d+/)?.[0] || 0);
  const dragBy = async (from, dx, dy, steps = 20) => {
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    for (let i = 1; i <= steps; i++) { await page.mouse.move(from.x + dx * i / steps, from.y + dy * i / steps); await frame(); }
    await page.mouse.up();
  };
  const count = () => page.locator('[data-testid=entities]').textContent().then((s) => Number(s.replace(/\D/g, '')));
  const changed = () => page.locator('.tabs .dtab.on .dot').count();      // the tab's "not saved" dot
  const redoReady = async () => {                               // after a Ctrl+Z: a new edit clears the redo, so a drag that moved nothing leaves it on
    await page.locator('[data-menu=Edit]').click();
    const on = await page.getByRole('menuitem', { name: 'Redo', exact: true }).isEnabled();
    await page.keyboard.press('Escape'); await frame();
    return on;
  };
  try {
    await run('open', () => openFile(page, name, buffer, doc.entities.length));
    await fitView(page, frame);
    const { box, cx, cy } = await canvasMid(page);
    await useTool(page, frame, cx, cy, 'select');
    await run('Ctrl+A', async () => { await page.keyboard.press('Control+a'); });
    console.log(`selected by Ctrl+A: ${await selCount()}`);
    await page.keyboard.press('Escape'); await frame();
    const sheet = await page.locator('rect.sheet').boundingBox(), x0 = Math.max(box.x + 4, sheet.x - 6), y0 = Math.max(box.y + 4, sheet.y - 6);
    await run('box select', () => dragBy({ x: x0, y: y0 }, sheet.x + sheet.width * .55 - x0, sheet.y + sheet.height * .55 - y0, 10));
    assert.ok(await selCount() > 0, 'the box must select something');
    console.log(`selected by the box: ${await selCount()}`);
    await page.locator('[data-tool=move]').first().click(); await page.mouse.move(cx, cy); await frame();
    await page.mouse.click(cx, cy); await frame();                                // the base point
    await run('Move hover', () => hoverMoves(page, frame, cx, cy));
    assert.equal(await changed(), 0, 'nothing is edited before the commit click');
    await run('Move commit click', async () => { await page.mouse.click(cx + 120, cy + 60); });
    assert.equal(await changed(), 1, 'the commit click must edit the drawing');
    await page.keyboard.press('Escape'); await page.keyboard.press('Control+z'); await frame();
    await page.keyboard.press('Escape'); await frame();
    await useTool(page, frame, cx, cy, 'trim');
    await run('Trim hover', () => hoverMoves(page, frame, cx, cy));
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await useTool(page, frame, cx, cy, 'select');
    const target = await screenOf(mm(it, ...p));
    assert.ok(await redoReady(), 'the Move is undone and can be redone');          // (its menu's Escape also clears the selection, so this comes first)
    await page.mouse.click(target.x, target.y); await frame();                    // only a selected object is dragged
    assert.ok(await selCount() > 0, 'the click must select the object that is dragged');
    await run('object drag', () => dragBy(target, 60, 40));
    assert.ok(!await redoReady(), 'the object drag must be a new edit (it clears the redo)');
    await page.keyboard.press('Control+z'); await frame();
    await page.keyboard.press('Escape'); await frame();
    if (lineIt) {
      const [x0l, y0l, x1l, y1l] = [lineIt.ops[1], lineIt.ops[2], lineIt.ops[4], lineIt.ops[5]], mid = mm(lineIt, (x0l + x1l) / 2, (y0l + y1l) / 2);
      assert.ok(await redoReady(), 'the object drag is undone and can be redone');
      let at = await screenOf(mid);
      await page.mouse.move(at.x, at.y);
      for (let i = 0; i < 12 && at.k < 8; i++) { await page.mouse.wheel(0, -300); await frame(); await page.waitForTimeout(150); at = await screenOf(mid); }
      await page.waitForTimeout(500); await frame(); at = await screenOf(mid);
      await page.mouse.click(at.x, at.y); await frame();
      assert.equal(await selCount(), 1, 'the click must select the LINE before its grip is dragged');
      const end = await screenOf(mm(lineIt, x1l, y1l));
      await run('LINE grip drag', () => dragBy(end, 30, 20));
      assert.ok(!await redoReady(), 'the grip drag must be a new edit (it clears the redo)');
      await page.keyboard.press('Control+z'); await frame();
      await page.keyboard.press('Escape'); await fitView(page, frame);
    } else console.log('LINE grip drag: skipped, this drawing has no LINE');
    const reselect = async () => {
      await page.keyboard.press('Escape'); await frame();
      const at = await screenOf(mm(it, ...p));
      await page.mouse.click(at.x, at.y); await frame();
      assert.ok(await selCount() > 0, 'the click must hit geometry before Delete / Undo / Redo');
      return selCount();
    };
    const before = await count(), selected = await reselect();
    await run('Delete', async () => { await page.keyboard.press('Delete'); });
    assert.equal(await count(), before - selected, 'Delete must remove the selection');
    await reselect();
    await run('Ctrl+Z', async () => { await page.keyboard.press('Control+z'); });
    assert.equal(await count(), before, 'Ctrl+Z must restore the deleted entities');
    await reselect();
    await run('Ctrl+Y', async () => { await page.keyboard.press('Control+y'); });
    assert.equal(await count(), before - selected, 'Ctrl+Y must delete them again');
    await page.keyboard.press('Control+z'); await frame();
    return results;
  } finally { await stop(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const input = process.argv[2], rest = process.argv.slice(3), port = Number(rest.find((a) => /^\d+$/.test(a))) || 5184, mode = rest.find((a) => !/^\d+$/.test(a)) || 'draw';
  if (!input || !/^(draw|edit|cmp|lay:\d+)$/.test(mode)) { console.error('usage: node tools/perf-interact.mjs <file.dxf|spline:900|big:20000> [draw|edit|cmp|lay:<parts>] [port]'); process.exit(1); }
  const buffer = input.startsWith('spline:') ? Buffer.from(writeDxf(splineDoc(Number(input.slice(7))))) : input.startsWith('big:') ? Buffer.from(writeDxf(bigDoc(Number(input.slice(4))))) : readFileSync(input);
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
    const name = /^(spline|big):/.test(input) ? input.replace(':', '-') + '.dxf' : basename(input);
    if (mode === 'draw') await interact(page, buffer, name);
    else if (mode === 'edit') await interactEdit(page, buffer, name);
    else if (mode === 'cmp') await interactCompare(page, buffer, name);
    else await interactLayout(page, buffer, name, Number(mode.slice(4)));
  } finally { await browser?.close(); server.kill(); }
}
