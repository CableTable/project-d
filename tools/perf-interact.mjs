// T76 / T78 / P13: node tools/perf-interact.mjs <file.dxf|spline:900|big:20000> [draw|edit|commit|dim|insert|rotate|cmp|layers|selection|resize|lay:<parts>] [port=5184]
// Counts are for the drawing canvas; timings include instrumentation and depend on the machine.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { bigDoc, splineDoc } from './gen-big-dxf.mjs';
import { addLayer, writeDxf } from '../web/dxf-write.js';
import { decodeDxf, readDxf, flatten, mapply } from '../web/drawing.js';
import { shownItems, itemVisible, startHidden, unitFactor } from '../web/doc.js';

// The recorder every mode shares: long tasks, frame gaps and lineTo on the drawing canvas around each run(), plus the full-paint counter (data-paints).
async function instrument(page) {
  await page.evaluate(() => {
    const rec = { frames: [], long: [], lineTo: 0 }, proto = CanvasRenderingContext2D.prototype, lineTo = proto.lineTo, pathProto = Path2D.prototype, pathLineTo = pathProto.lineTo;
    proto.lineTo = function (...args) {
      if (this.canvas.dataset.testid === 'drawing') rec.lineTo++;
      return lineTo.apply(this, args);
    };
    pathProto.lineTo = function (...args) { rec.lineTo++; return pathLineTo.apply(this, args); };       // the selection overlay builds Path2D runs (TODO 329a)
    const observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) rec.long.push([e.startTime, e.duration]); });
    observer.observe({ entryTypes: ['longtask'] });
    // TODO 322e: the picker's first `change` in a run; long tasks that start before it are Playwright's setInputFiles (building the File), not the app's open.
    document.addEventListener('change', (e) => { if (e.target.dataset?.testid === 'picker' && rec.change == null) rec.change = performance.now(); }, true);
    let raf;
    const tick = (t) => { rec.frames.push(t); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    window.__perfInteract = { rec, observer, stop() { cancelAnimationFrame(raf); observer.disconnect(); proto.lineTo = lineTo; pathProto.lineTo = pathLineTo; } };
  });
  const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const count = () => page.locator('[data-testid=entities]').textContent().then((s) => Number(s.replace(/\D/g, '')));
  const results = [];
  const run = async (action, fn, resized = false) => {
    const paints = await page.evaluate(() => {
      const { rec, observer } = window.__perfInteract;
      observer.takeRecords(); rec.frames = [performance.now()]; rec.long = []; rec.lineTo = 0; rec.change = null;
      return Number(document.querySelector('[data-testid=drawing]').dataset.paints);
    });
    assert.ok(Number.isFinite(paints), 'data-paints full-paint counter is installed');
    const size = resized && await page.getByTestId('drawing').evaluate((c) => [c.width, c.height]);
    const started = Date.now();
    await fn();
    if (size) await page.waitForFunction(([w, h]) => {
      const c = document.querySelector('[data-testid=drawing]');
      return c.width !== w || c.height !== h;
    }, size);
    else await frame();
    const ms = Date.now() - started;
    const snap = await page.locator('[data-testid=drawing]').getAttribute('data-snap');
    // Include the 120 ms gesture settle paint and delivery of long-task records.
    await page.waitForTimeout(500); await frame();
    const rec = await page.evaluate(() => {
      const { rec, observer } = window.__perfInteract;
      for (const e of observer.takeRecords()) rec.long.push([e.startTime, e.duration]);
      return { ...rec, paints: Number(document.querySelector('[data-testid=drawing]').dataset.paints) };
    });
    const injected = rec.change == null ? [] : rec.long.filter(([s]) => s < rec.change).map(([, d]) => d);
    rec.long = rec.long.filter(([s]) => rec.change == null || s >= rec.change).map(([, d]) => d);
    const gaps = rec.frames.slice(1).map((t, i) => t - rec.frames[i]).sort((a, b) => a - b);
    const r = { action, ms, snap, frames: gaps.length, gapMedian: gaps[Math.floor(gaps.length / 2)] || 0,
      gapP90: gaps[Math.floor(gaps.length * .9)] || 0, gapMax: gaps.at(-1) || 0,
      longTasks: rec.long.length, longTotal: rec.long.reduce((a, b) => a + b, 0), longMax: Math.max(0, ...rec.long),
      lineTo: rec.lineTo, paints: rec.paints - paints };
    if (rec.change != null) r.inject = { longTasks: injected.length, longTotal: injected.reduce((a, b) => a + b, 0), longMax: Math.max(0, ...injected) };
    results.push(r);
    if (r.inject) console.log(`${action} inject (before the picker's change): long tasks ${r.inject.longTasks}, total/max ${r.inject.longTotal.toFixed(1)}/${r.inject.longMax.toFixed(1)} ms`);
    console.log(`${action}: ${ms} ms; frames ${r.frames}; gaps median/p90/max ${r.gapMedian.toFixed(1)}/${r.gapP90.toFixed(1)}/${r.gapMax.toFixed(1)} ms; long tasks ${r.longTasks}, total/max ${r.longTotal.toFixed(1)}/${r.longMax.toFixed(1)} ms${r.longTasks <= 12 ? ` (${rec.long.map((d) => d.toFixed(0)).join(' ')})` : ''}; lineTo ${r.lineTo}; full paints ${r.paints}${resized ? `; first picture: ${snap === '1' ? 'scaled' : 'full'}` : ''}`);
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
    await zoomIn(page, run, frame, 'draw', cx, cy);
    return results;
  } finally { await stop(); }
}

// P13: the Layout, Compare and drawing-tab edit steps of the lag audit. Counts are asserted by the browser test; the ms are for people.
const openFile = async (page, name, buffer, entities) => {
  await page.locator('[data-testid=picker]').setInputFiles({ name, mimeType: 'text/plain', buffer });
  await page.waitForFunction((n) => document.querySelector('.tabs .dtab.on .tname')?.textContent === n, name, { timeout: 120000 });       // ?.: before the first tab opens there is none (TODO 356)
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
  await zoomIn(page, run, frame, label, cx, cy);
};
// One way (TODO 324b): the alternating wheel above returns to its first view and so paints nothing; this one ends on a new scale, the zoom end the chunked paint is for.
const zoomIn = async (page, run, frame, label, cx, cy, notches = 2) => {
  await page.mouse.move(cx, cy); await frame();
  await run(`${label} zoom in`, async () => { for (let i = 0; i < notches; i++) { await page.mouse.wheel(0, -150); await frame(); } });
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
    const compareDone = async () => { await page.locator('[data-testid=cmp-run]').dispatchEvent('click'); await page.waitForFunction(() => !document.querySelector('[data-testid=cmp-count]').textContent.startsWith('Comparing'), null, { timeout: 300000 }); };       // the run is in slices (TODO 316): wait for its end
    await run('Compare button', compareDone);
    await run('Compare button again', compareDone);
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
  const dragBy = async (from, dx, dy, steps = 20, hovered = false) => {
    if (!hovered) await page.mouse.move(from.x, from.y);
    await page.mouse.down();
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
      // every pointer move over the selected LINE repaints the picture when it is not kept (a base that paints in under KEEP_MS, TODO 340 hover marker): arrive on the grip once, here, so the drag's own count is press + release; the click's late paints settle too
      await page.mouse.move(end.x, end.y); await frame();
      let tries = 0;
      for (let last = -1, still = 0; still < 4; await page.waitForTimeout(150)) {
        if (++tries > 20) throw new Error('LINE grip drag: the paint count kept changing for 20 tries (3 s), so the drag cannot be counted');
        const n = await page.evaluate(() => document.querySelector('[data-testid=drawing]').dataset.paints); still = n === last ? still + 1 : 0; last = n;
      }
      await run('LINE grip drag', () => dragBy(end, 30, 20, 20, true));
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

/** One selected object, with picking and Move's base point outside the timed commit. */
async function interactCommit(page, buffer, name) {
  const doc = readDxf(decodeDxf(buffer)), fl = flatten(doc), { frame, count, run, results, stop } = await instrument(page);
  const [x0, y0, x1, y1] = fl.boxes.model, centre = [(x0 + x1) / 2, (y0 + y1) / 2], off = startHidden(fl);
  const it = fl.items.find((it) => doc.entities[it.e].type === 'LINE' && itemVisible(it, off) &&
    Math.abs(it.b[0] - centre[0]) < (x1 - x0) / 10 && Math.abs(it.b[1] - centre[1]) < (y1 - y0) / 10);
  assert.ok(it, 'the drawing needs a visible LINE near the centre');
  const pick = [0, 1].map((i) => (it.b[i] + it.b[i + 2]) / 2 * unitFactor(fl.units));
  try {
    await openFile(page, name, buffer, doc.entities.length);
    await fitView(page, frame);
    const { x, y } = await page.locator('rect.sheet').evaluate((el, [x, y]) => {
      const b = el.getBoundingClientRect(), k = b.width / Number(el.getAttribute('width'));
      return { x: b.x + x * k, y: b.y + (Number(el.getAttribute('height')) - y) * k };
    }, pick);
    const selectOne = async () => {
      await page.mouse.click(x, y); await frame();
      assert.match(await page.getByTestId('sel-count').textContent(), /^1 selected$/);
    };
    await selectOne();
    console.log(`Commit fixture: ${await count()} entities, 1 selected`);
    await run('Delete one object', () => page.keyboard.press('Delete'));
    assert.equal(await count(), doc.entities.length - 1);
    await page.keyboard.press('Control+z'); await frame();
    assert.equal(await count(), doc.entities.length);
    await selectOne();
    await page.locator('[data-tool=move]').first().click();
    await page.mouse.click(x, y);
    await page.mouse.move(x + 100, y + 80); await frame();
    await run('Move one object commit', () => page.mouse.click(x + 100, y + 80));
    assert.match(await page.getByTestId('cmd-prompt').textContent(), /Selection moved/);
    assert.equal(await count(), doc.entities.length);
    for (const r of results) assert.equal(r.paints, 1, `${r.action}: full paints`);
  } finally { await stop(); }
}

/** TODO 237b: one Delete makes the tab dirty; the page's autosave round (?autosave=4000) then runs inside the timed window. */
async function interactAutosave(page, buffer, name) {
  const doc = readDxf(decodeDxf(buffer)), fl = flatten(doc), { frame, run, results, stop } = await instrument(page);
  const [x0, y0, x1, y1] = fl.boxes.model, centre = [(x0 + x1) / 2, (y0 + y1) / 2], off = startHidden(fl);
  const it = fl.items.find((it) => doc.entities[it.e].type === 'LINE' && itemVisible(it, off) &&
    Math.abs(it.b[0] - centre[0]) < (x1 - x0) / 10 && Math.abs(it.b[1] - centre[1]) < (y1 - y0) / 10);
  assert.ok(it, 'the drawing needs a visible LINE near the centre');
  const pick = [0, 1].map((i) => (it.b[i] + it.b[i + 2]) / 2 * unitFactor(fl.units));
  try {
    await openFile(page, name, buffer, doc.entities.length);
    await fitView(page, frame);
    const { x, y } = await page.locator('rect.sheet').evaluate((el, [x, y]) => {
      const b = el.getBoundingClientRect(), k = b.width / Number(el.getAttribute('width'));
      return { x: b.x + x * k, y: b.y + (Number(el.getAttribute('height')) - y) * k };
    }, pick);
    await page.mouse.click(x, y); await frame();
    // The tick can fire right after the Delete, so the Delete is inside the window: its own long tasks are the 'commit' mode's 'Delete one object' row.
    await run('Delete + autosave round', async () => { await page.keyboard.press('Delete'); await page.waitForTimeout(9000); });
    console.log(`Autosave fixture: ${await page.locator('[data-testid=entities]').textContent()} entities after Delete`);
    const copies = await page.evaluate(async () => (await (await import('./recovery.js')).loadCopies()).map((c) => c.dxf.length));
    assert.equal(copies.length, 1, 'the autosave round kept one copy');
    console.log(`Autosave copy: ${copies[0]} characters`);
    return results;
  } finally { await stop(); }
}

/** TODO 356: one commit of each kind on the big drawing: `insert` Moves an INSERT, `rotate` turns a LINE, `dim` places an aligned dimension (the click that makes it). */
async function interactAction(page, buffer, name, which) {
  const doc = readDxf(decodeDxf(buffer)), fl = flatten(doc), { frame, count, run, results, stop } = await instrument(page);
  const [x0, y0, x1, y1] = fl.boxes.model, off = startHidden(fl), type = which === 'insert' ? 'INSERT' : 'LINE';
  let it, best = Infinity;                                       // the visible item of that entity type nearest the middle
  for (const c of fl.items) {
    if (doc.entities[c.e].type !== type || !itemVisible(c, off)) continue;
    const d = Math.hypot((c.b[0] + c.b[2] - x0 - x1) / 2, (c.b[1] + c.b[3] - y0 - y1) / 2);
    if (d < best) { best = d; it = c; }
  }
  assert.ok(it, `the drawing needs a visible ${type}`);
  const pick = [0, 1].map((i) => (it.b[i] + it.b[i + 2]) / 2 * unitFactor(fl.units));       // a block's circle: its middle is the insertion point, where its two lines cross
  try {
    await openFile(page, name, buffer, doc.entities.length);
    await fitView(page, frame);
    const { x, y } = await page.locator('rect.sheet').evaluate((el, [x, y]) => {
      const b = el.getBoundingClientRect(), k = b.width / Number(el.getAttribute('width'));
      return { x: b.x + x * k, y: b.y + (Number(el.getAttribute('height')) - y) * k };
    }, pick);
    await page.waitForTimeout(3000); await frame();               // the open's own idle work (pick index slices) is not the action's
    const entities = await count();
    if (which === 'dim') {
      await page.locator('[data-tool=dimension]').first().click();
      for (const [dx, dy] of [[-60, -40], [60, -40]]) { await page.mouse.move(x + dx, y + dy); await frame(); await page.mouse.click(x + dx, y + dy); await frame(); }
      await page.mouse.move(x, y - 100); await frame();
      await run('Dimension placed', () => page.mouse.click(x, y - 100));
      assert.equal(await count(), entities + 1, 'the dimension is one more entity');
    } else {
      await page.mouse.click(x, y); await frame();
      assert.match(await page.getByTestId('sel-count').textContent(), /^1 selected$/);
      if (which === 'rotate') await menu(page, 'Modify', 'Rotate'); else await page.locator('[data-tool=move]').first().click();
      await page.mouse.click(x, y);
      await page.mouse.move(x + 100, y + 80); await frame();
      await run(which === 'rotate' ? 'Rotate one LINE commit' : 'Move one INSERT commit', () => page.mouse.click(x + 100, y + 80));
      assert.equal(await count(), entities);
    }
    await page.waitForTimeout(1500);
  } finally { await stop(); }
  return results;
}

/** Measure both eyes on the same layer, after opening and warming the drawings. */
async function interactLayers(page, buffer, name) {
  const raw = readDxf(decodeDxf(buffer)), { frame, run, results, stop } = await instrument(page);
  const layer = raw.entities.find((e) => e.layer !== '0')?.layer;
  assert.ok(layer, 'the drawing needs a second layer');
  const eye = page.locator(`[data-file-layer][data-layer-name]`).filter({ has: page.getByText(layer, { exact: true }) }).locator('button[data-act=vis]');
  const objects = () => page.getByTestId('ptab-objects').click();
  const toggle = async (tab) => {
    await frame();
    await page.waitForTimeout(500);
    for (const [action, label] of [['off', 'Show'], ['on', 'Hide']]) {
      await run(`${tab} layer ${action}`, () => eye.dispatchEvent('click'));
      assert.equal(await eye.getAttribute('aria-label'), label);
    }
  };
  try {
    await openFile(page, 'reference-' + name, buffer, raw.entities.length);
    await openFile(page, name, buffer, raw.entities.length);
    console.log(`Layer fixture: ${raw.entities.length} entities per drawing, ${raw.entities.filter((e) => e.layer === layer).length} on ${layer}`);
    await objects(); await toggle('Drawings');
    // The layout's own row hides / shows its parts (the layout has no file layers of its own).
    await menu(page, 'Layout', 'Add to layout');
    await page.locator('.tabs .dtab').first().click();
    await menu(page, 'Layout', 'Add to layout');
    await objects();
    const layoutEye = page.locator('[data-testid=obj-layout] button[data-act=vis]');
    await frame(); await page.waitForTimeout(500);
    for (const [action, label] of [['off', 'Show'], ['on', 'Hide']]) {
      await run(`Layouts layer ${action}`, () => layoutEye.dispatchEvent('click'));
      assert.equal(await layoutEye.getAttribute('aria-label'), label);
    }
    await menu(page, 'File', 'Compare drawings…');
    await objects(); await toggle('Compare');
    for (const r of results) assert.ok([1, 2].includes(r.paints), `${r.action}: full paints ${r.paints}`);       // 2 = a heavy drawing's quick paint, then the settled one (TODO 328b)
    return results;
  } finally { await stop(); }
}

/** The before / after table: headline per action is longTotal (all long tasks) and gapMax (longest frame gap), the < 100 ms target is judged on these. */
export function headlineTable(results) {
  const rows = results.map((r) => `${r.action.padEnd(28)} | ${r.longTotal.toFixed(0).padStart(5)} ms | ${r.gapMax.toFixed(0).padStart(5)} ms | ${String(r.paints).padStart(2)} | ${r.lineTo}`);
  return ['action                       | longTotal | gapMax | full paints | lineTo', ...rows].join('\n');
}

/** TODO 323: select all and toggle Properties on warmed tabs, with a placed part on the layout. */
async function interactSelection(page, buffer, name) {
  const n = readDxf(decodeDxf(buffer)).entities.length, { frame, run, results, stop } = await instrument(page);
  const first = page.locator('.tabs .dtab').first();
  const measure = async (tab, count) => {
    await fitView(page, frame);
    await page.waitForTimeout(1000);
    await run(`${tab} Ctrl+A`, () => page.keyboard.press('Control+a'));
    if (tab === 'Layout') assert.match(await page.getByTestId('cmd-prompt').textContent(), /^1 part selected$/);
    else assert.equal(await page.getByTestId('sel-count').textContent(), `${count} selected`);
    await run(`${tab} Ctrl+1 close`, () => page.keyboard.press('Control+1'));
    assert.match(await page.getByTestId('cmd-prompt').textContent(), /Panel hidden/);
    await run(`${tab} Ctrl+1 open`, () => page.keyboard.press('Control+1'));
    assert.match(await page.getByTestId('cmd-prompt').textContent(), /Panel shown/);
    await page.keyboard.press('Escape');
  };
  try {
    await openFile(page, name, buffer, n);
    console.log(`Selection fixture: ${n} entities per drawing, one placed part on Layout`);
    await measure('Drawings', n);
    await menu(page, 'Layout', 'Add to layout');
    await first.click();
    await menu(page, 'Layout', 'Add to layout');
    await measure('Layout', 1);
    await openFile(page, '2-' + name, buffer, n);
    await menu(page, 'File', 'Compare drawings…');
    await measure('Compare', n);
    return results;
  } finally { await stop(); }
}

/** First resized canvas frame, then total full paints through settle on each warmed tab. */
async function interactResize(page, buffer, name) {
  const n = readDxf(decodeDxf(buffer)).entities.length, { frame, run, results, stop } = await instrument(page);
  const viewport = page.viewportSize();
  const measure = async (tab) => {
    await fitView(page, frame);
    await page.waitForTimeout(500);
    await run(`${tab} resize`, () => page.setViewportSize({ width: viewport.width + 200, height: viewport.height + 100 }), true);
    await run(`${tab} Ctrl+1 close`, () => page.keyboard.press('Control+1'), true);
    await run(`${tab} Ctrl+1 open`, () => page.keyboard.press('Control+1'), true);
    await page.setViewportSize(viewport);
    await frame();
  };
  try {
    await openFile(page, name, buffer, n);
    console.log(`Resize fixture: ${n} entities per drawing, one placed part on Layouts, two snapshots in Compare`);
    await measure('Drawings');
    await menu(page, 'Layout', 'Add to layout');
    await page.locator('.tabs .dtab').first().click();
    await menu(page, 'Layout', 'Add to layout');
    await measure('Layouts');
    await openFile(page, '2-' + name, buffer, n);
    await menu(page, 'File', 'Compare drawings…');
    await measure('Compare');
    return results;
  } finally { await stop(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const input = process.argv[2], rest = process.argv.slice(3), port = Number(rest.find((a) => /^\d+$/.test(a))) || 5184, mode = rest.find((a) => !/^\d+$/.test(a)) || 'draw';
  if (!input || !/^(draw|edit|commit|dim|insert|rotate|cmp|layers|selection|resize|autosave|lay:\d+)$/.test(mode)) { console.error('usage: node tools/perf-interact.mjs <file.dxf|spline:900|big:20000> [draw|edit|commit|dim|insert|rotate|cmp|layers|selection|resize|autosave|lay:<parts>] [port]'); process.exit(1); }
  const big = input.startsWith('big:') && bigDoc(Number(input.slice(4)));
  if (big && mode === 'layers') {
    addLayer(big, 'Toggle', { aci: 3 });
    big.entities.forEach((e, i) => { if (i % 7 === 0) { e.layer = 'Toggle'; e.r.v[0] = e.layer; } });
  }
  const buffer = input.startsWith('spline:') ? Buffer.from(writeDxf(splineDoc(Number(input.slice(7))))) : big ? Buffer.from(writeDxf(big)) : readFileSync(input);
  const server = spawn(process.execPath, ['serve.mjs', String(port)], { stdio: 'ignore', env: { ...process.env, PORT: String(port) } });
  let browser;
  try {
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await page.goto(`http://localhost:${port}/?autosave=${mode === 'autosave' ? 4000 : 86400000}`);
    await page.waitForSelector('[data-testid=count]', { state: 'attached' });
    const name = /^(spline|big):/.test(input) ? input.replace(':', '-') + '.dxf' : basename(input);
    const results = mode === 'draw' ? await interact(page, buffer, name)
      : mode === 'edit' ? await interactEdit(page, buffer, name)
        : mode === 'commit' ? await interactCommit(page, buffer, name)
          : ['dim', 'insert', 'rotate'].includes(mode) ? await interactAction(page, buffer, name, mode)
          : mode === 'cmp' ? await interactCompare(page, buffer, name)
            : mode === 'layers' ? await interactLayers(page, buffer, name)
              : mode === 'selection' ? await interactSelection(page, buffer, name)
                : mode === 'resize' ? await interactResize(page, buffer, name)
                  : mode === 'autosave' ? await interactAutosave(page, buffer, name)
                  : await interactLayout(page, buffer, name, Number(mode.slice(4)));
    if (results) console.log(`\n${headlineTable(results)}`);
  } finally { await browser?.close(); server.kill(); }
}
