// The UI in Chromium against web/ served locally.   node browser.test.mjs
// Locally: CHROME=/path/to/chrome node browser.test.mjs   (CI uses Playwright's own Chromium)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { dimParams, readDim } from './web/edit.js';
import { read as readLeader } from './web/leader.js';
import { decode as decodeText } from './web/text.js';
import { stepRepeat } from './web/layout.js';
import { readDxf, decodeDxf, flatten } from './web/drawing.js';
import { readMeta, newLayout, makePart, layoutRaw, layoutFromRaw, gridOf } from './web/layoutdoc.js';
import { newDoc, addEntities, addLayer, addBlock, entity, insert as dxfInsert, text as dxfText, roundRect, circle as dxfCircle, line as dxfLine, arc as dxfArc, ellipse as dxfEllipse, lwpoly as dxfPoly, writeDxf } from './web/dxf-write.js';
import * as GR from './web/grips.js';
import { COMMANDS } from './web/cmdbar.js';
import { Page, writePdf, winAnsi } from './web/pdf-write.js';
import { bigDoc } from './tools/gen-big-dxf.mjs';

const PORT = Number(process.env.TEST_PORT) || Number(process.argv[2]) || 5181;   // TEST_PORT or `npm run test:browser -- 5291`
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['serve.mjs', String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, PORT: String(PORT) } });
let browser;
const stop = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', stop);

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(URL_)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('serve.mjs did not start');
}

function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  return existsSync(local) && !process.env.CI ? local : undefined;
}

const base = { sheetW: 1000, sheetH: 700, gripTop: 0, gripRight: 0, gripBottom: 30, gripLeft: 0, partW: 120, partH: 80, gapX: 5, gapY: 5, rotate: '0', align: 'centre' };
const N0 = stepRepeat(base).count;                // the default sheet, 120 × 80 parts: 8 × 7 = 56
let failed = 0;
let afterStep = async () => {};
async function step(name, fn) {
  const only = process.env.ONLY || process.argv[3];
  if (only && !new RegExp(only).test(name)) return;      // ONLY=regex (or a 2nd argument: node browser.test.mjs 5297 regex) runs just the steps whose name matches (to work on one flow quickly)
  try { await fn(); console.log('ok', name); } catch (e) { failed++; console.log('FAIL', name, '\n  ', e.message, '\n  at', ((e.stack || '').split('\n').find((l) => l.includes('browser.test.mjs')) || '').trim()); try { await afterStep(); } catch { /* best effort */ } }
}

try {
  await waitForServer();
  const exe = chromePath();
  browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  if (process.env.SLOWRAF) await page.addInitScript(() => { const r = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (f) => r(() => setTimeout(() => f(performance.now()), 150)); });
  // THROTTLE=6 slows the CPU 6x (CDP) to mimic a slow CI runner and expose timing-dependent steps
  if (process.env.THROTTLE) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.THROTTLE) });
  // POLAR and OTRACK start off here: the older steps pick free points at any angle; the tracking steps switch them on
  await page.addInitScript(() => { try { localStorage.setItem('pd-track', JSON.stringify({ polar: false, inc: 15, otrack: false })); } catch { /* ignore */ } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL_);
  await page.waitForSelector('[data-testid=count]', { state: 'attached' });
  const t = (id) => page.locator(`[data-testid=${id}]`);
  // the command bar's input: a letter typed on the drawing or the echo button opens the bar; this opens it by the echo button when it is shut
  const cmdLine = () => { const i = t('cmd-input'), open = async () => { if (!(await i.isVisible())) { await t('cmd-echo').click(); await i.waitFor({ state: 'visible' }); } }; return { fill: async (v) => { await open(); await i.fill(v); }, press: async (k) => { await open(); await i.press(k); }, inputValue: () => i.inputValue(), focus: open }; };
  const typeCmd = async (text) => { await cmdLine().fill(text); await cmdLine().press('Enter'); };
  const readout = async () => ({ count:Number(await t('count').textContent()), grid: await t('grid').textContent() });

  const shotDir = process.env.SHOTS_DIR || 'shots';
  mkdirSync(shotDir, { recursive: true });
  const tabNames = () => page.locator('.tabs .dtab:not([aria-label]) .tname').allTextContents();
  // closes (accepting "close without saving?") every tab whose name matches
  const closeTabs = async (re) => {
    const accept = (d) => d.accept().catch(() => {});
    page.on('dialog', accept);
    try {
      for (let i = 0; i < 30; i++) {
        const tab = page.locator('.tabs .dtab:not([aria-label])', { hasText: re }).first();
        if (!(await tab.count())) break;
        await tab.locator('.x').click();
        await page.waitForTimeout(60);
      }
    } finally { page.off('dialog', accept); }
  };
  await step('TODO 56: font note on open, once per open, literal file names, light and dark', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    try {
      const p = await context.newPage();
      p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(URL_);
      const picker = p.locator('[data-testid=picker]'), prompt = p.locator('[data-testid=cmd-prompt]'), fontNote = p.locator('.status [data-testid=font-note]');
      await picker.setInputFiles('fixtures/font-note.dxf');
      await p.waitForFunction(() => document.querySelector('[data-testid=cmd-prompt]').textContent.includes('Fonts: romans.shx → Arial'));
      assert.equal((await prompt.textContent()).match(/romans\.shx/g).length, 1, 'two texts name the same font once');
      assert.equal(await fontNote.isVisible(), true, 'the note is visible in the status bar');
      assert.equal(await fontNote.textContent(), 'Fonts: romans.shx → Arial');
      await p.screenshot({ path: shotDir + '/font-note-light.png' });
      await p.locator('[data-menu=View]').click();
      await p.getByRole('menuitemcheckbox', { name: /Theme: dark/ }).click();
      await p.screenshot({ path: shotDir + '/font-note-dark.png' });
      const sheetBefore = await p.locator('rect.sheet').boundingBox();
      await p.locator('[data-testid=new-tab]').click();
      assert.equal(await fontNote.isVisible(), false);
      await p.locator('.tabs .dtab', { hasText: 'font-note.dxf' }).click();
      assert.deepEqual(await p.locator('rect.sheet').boundingBox(), sheetBefore, 'clearing the note preserves the drawing viewport');
      await picker.setInputFiles('fixtures/outline.dxf');
      await p.waitForFunction(() => document.querySelector('[data-testid=cmd-prompt]').textContent.startsWith('Opened outline.dxf'));
      for (const name of ['font-note.dxf', 'outline.dxf', 'font-note.dxf']) {
        await p.locator('.tabs .dtab', { hasText: name }).click();
        assert.doesNotMatch(await prompt.textContent(), /Fonts:/, 'tab switches do not repeat the note');
        assert.equal(await fontNote.isVisible(), false);
      }
      await picker.setInputFiles('fixtures/font-note.dxf');
      await p.waitForFunction(() => document.querySelector('[data-testid=cmd-prompt]').textContent.includes('Fonts: romans.shx → Arial'));
      const dxf = readFileSync('fixtures/font-note.dxf', 'utf8');
      await picker.setInputFiles({ name: 'available-font.dxf', mimeType: 'text/plain', buffer: Buffer.from(dxf.replaceAll('romans.shx', 'arial.ttf')) });
      await p.waitForFunction(() => document.querySelector('[data-testid=cmd-prompt]').textContent.startsWith('Opened available-font.dxf'));
      assert.doesNotMatch(await prompt.textContent(), /Fonts:/);
      assert.equal(await fontNote.isVisible(), false);
      await picker.setInputFiles({ name: 'missing-font.dxf', mimeType: 'text/plain', buffer: Buffer.from(dxf.replaceAll('romans.shx', '<b>GOST</b>.ttf')) });
      await p.waitForFunction(() => document.querySelector('[data-testid=cmd-prompt]').textContent.includes('Fonts: <b>GOST</b>.ttf → Arial'));
      assert.equal(await prompt.locator('b').count(), 0, 'font names reach the DOM as text');
      assert.equal(await fontNote.textContent(), 'Fonts: <b>GOST</b>.ttf → Arial');
      assert.equal(await fontNote.locator('b').count(), 0);
    } finally { await context.close(); }
  });
  await step('TODO 93 / T12: Explorer startup and later launches share Open, serialize files and survive errors', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    const pdf = new Page(80, 50); pdf.rect(10, 10, 60, 30); pdf.stroke();
    try {
      const p = await context.newPage();
      p.on('pageerror', (e) => errors.push(String(e)));
      await p.addInitScript(({ dxf, pdf }) => {
        const log = window.__launchLog = { reads: [], grants: [], active: 0, maxActive: 0, saves: [] };
        const allowed = new Set();
        const queue = [['C:/jobs/first plate.dxf', null], ['D:/jobs/second.dxf', null]];
        window.__launchQueue = queue;
        window.__TAURI__ = {
          event: { listen: async (name, fn) => {
            if (name !== 'open-launch-files') throw new Error('unexpected event: ' + name);
            window.__launch = fn;
            queue.push(['C:/jobs/before-ready.dxf', null]);
            fn(); // A second launch arrives while the listener is registering.
            return () => {};
          } },
          core: { invoke: async (command, args) => {
            if (command === 'take_launch_files') {
              return queue.splice(0).map(([path, error]) => {
                if (!error) { allowed.add(path); log.grants.push(path); }
                return [path, error];
              });
            }
            if (command !== 'grant_balloon_sidecar' || !allowed.has(args.path)) throw new Error('unexpected grant');
          } },
          fs: {
            readFile: async (path) => {
              if (!allowed.has(path)) throw new Error('forbidden path: ' + path);
              log.reads.push(path);
              if (/missing/.test(path)) throw new Error('file not found');
              log.maxActive = Math.max(log.maxActive, ++log.active);
              await new Promise((resolve) => setTimeout(resolve, 30));
              log.active--;
              return new Uint8Array(/\.pdf$/i.test(path) ? pdf : dxf);
            },
            exists: async () => false,
            writeTextFile: async () => { throw new Error('launch sources must never be overwritten'); },
          },
          dialog: {
            open: async () => window.__launchPick,
            save: async (options) => { log.saves.push(options.defaultPath); return null; },
          },
        };
      }, { dxf: [...readFileSync('fixtures/outline.dxf')], pdf: [...writePdf([pdf])] });
      await p.goto(URL_);
      const names = () => p.locator('.tabs .dtab .tname').allTextContents();
      const prompt = () => p.locator('[data-testid=cmd-prompt]').textContent();
      await p.waitForFunction(() => document.querySelectorAll('.tabs .dtab .tname').length === 3);
      assert.deepEqual(await names(), ['first plate.dxf', 'second.dxf', 'before-ready.dxf']);
      await p.evaluate(async () => {
        window.__launchQueue.push(['C:/jobs/vector.pdf', null]);
        const first = window.__launch();
        window.__launchQueue.push(['C:/jobs/later.dxf', null]);
        await Promise.all([first, window.__launch()]);
      });
      assert.deepEqual(await names(), ['first plate.dxf', 'second.dxf', 'before-ready.dxf', 'vector.dxf', 'later.dxf']);
      assert.equal(await p.evaluate(() => window.__launchLog.maxActive), 1, 'launch batches open sequentially');
      for (const [path, expected] of [
        ['C:/jobs/missing.dxf', /Open failed: file not found/],
        ['C:/jobs/unsupported.xyz', /Opens DXF or PDF/],
        ['C:/jobs/unbuilt.dwg', /DWG: not built yet/],
      ]) {
        await p.evaluate(async (path) => { window.__launchQueue.push([path, null]); await window.__launch(); }, path);
        const message = await prompt();
        assert.match(message, expected);
        await p.evaluate((path) => { window.__launchPick = path; }, path);
        await p.locator('[data-menu=File]').click();
        await p.getByRole('menuitem', { name: 'Open…', exact: true }).click();
        await p.waitForFunction((message) => document.querySelector('[data-testid=cmd-prompt]').textContent === message, message);
        assert.equal(await prompt(), message, 'Explorer uses the same errors as File → Open');
      }
      await p.evaluate(async () => {
        window.__launchQueue.push(['C:/jobs/denied.dxf', 'scope grant failed']); await window.__launch();
      });
      assert.equal(await prompt(), 'Open failed: scope grant failed');
      await p.evaluate(async () => {
        window.__launchQueue.push(['C:/jobs/missing.dxf', null], ['C:/jobs/last.dxf', null]);
        await window.__launch();
      });
      assert.equal((await names()).at(-1), 'last.dxf', 'one bad file does not stop the batch');
      await p.evaluate(async () => {
        window.__launchQueue.push(['C:/jobs/first plate.dxf', null]); await window.__launch();
      });
      assert.equal((await names()).length, 6, 'reopening an existing file follows Open and selects its tab');
      assert.match(await prompt(), /already open/);
      await p.keyboard.press('Control+s');
      await p.waitForFunction(() => window.__launchLog.saves.length === 1);
      assert.deepEqual(await p.evaluate(() => window.__launchLog.saves), ['C:/jobs/first plate-edited.dxf']);
      await p.screenshot({ path: shotDir + '/explorer-open-light.png' });
      await p.locator('[data-menu=View]').click();
      await p.getByRole('menuitemcheckbox', { name: /Theme: dark/ }).click();
      await p.screenshot({ path: shotDir + '/explorer-open-dark.png' });
    } finally { await context.close(); }
  });
  await step('TODO 93 fix: a launched picture PDF prompt leaves library, autosave and recovery running', async () => {
    const context = await browser.newContext();
    try {
      const p = await context.newPage();
      p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(URL_); await p.locator('[data-testid=count]').waitFor({ state: 'attached' });
      await p.evaluate(async (dxf) => {
        const { savePart } = await import('./partstore.js');
        const { saveCopy } = await import('./recovery.js');
        await savePart({ id: 'startup-part', name: 'Startup part', w: 20, h: 20, dxf, thumb: document.createElement('canvas').toDataURL(), t: Date.now() });
        await saveCopy({ id: 'startup-copy', name: 'Unsaved plate', kind: 'drawing', dxf, t: Date.now() });
      }, readFileSync('fixtures/outline.dxf', 'utf8'));
      await p.addInitScript((pdf) => {
        let pending = true;
        window.__intervals = [];
        const interval = window.setInterval;
        window.setInterval = (fn, ms, ...args) => { window.__intervals.push(ms); return interval(fn, ms, ...args); };
        window.__TAURI__ = {
          event: { listen: async () => () => {} },
          core: { invoke: async () => { if (!pending) return []; pending = false; return [['C:/picture.pdf', null]]; } },
          fs: { readFile: async () => new Uint8Array(pdf) },
          dialog: { ask: (text) => { window.__backgroundAsked = text; return new Promise(() => {}); } },
        };
      }, [...writePdf([new Page(80, 50)])]);
      await p.reload();
      await p.waitForFunction(() => /background picture/.test(window.__backgroundAsked || ''));
      await p.locator('[data-part-id=startup-part]').waitFor({ state: 'attached' });
      await p.locator('[data-testid=recover-dialog]').waitFor();
      assert.ok(await p.evaluate(() => window.__intervals.includes(120000)), 'autosave starts while the PDF question is unanswered');
    } finally { await context.close(); }
  });
  await step('TODO 119 / T36: View theme rows match, full-row hover, separate dividers and moving theme tick', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    try {
      const p = await context.newPage();
      p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(URL_);
      await p.waitForSelector('[data-testid=count]', { state: 'attached' });
      const view = p.locator('[data-menu=View]'), themes = p.getByRole('menuitemcheckbox', { name: /Theme:/ });
      await view.click();
      for (const active of ['follow system', 'light', 'dark', 'follow system']) {
        const rows = await themes.evaluateAll((els) => els.map((el) => [el.textContent.trim(), el.getAttribute('aria-checked')]));
        assert.deepEqual(rows, ['follow system', 'light', 'dark'].map((mode) => [(mode === active ? '✓ ' : '') + 'Theme: ' + mode, String(mode === active)]));
        for (const group of ['Work area:', 'Theme:']) {
          const items = p.getByRole('menuitemcheckbox', { name: new RegExp(group) });
          const geometry = await items.evaluateAll((els) => els.map((el) => {
            const r = el.getBoundingClientRect(), s = getComputedStyle(el);
            return [r.height, r.width, s.margin, s.padding, s.borderRadius];
          }));
          assert.equal(geometry.length, 3);
          assert.deepEqual(geometry, [geometry[0], geometry[0], geometry[0]], group + ' rows have identical geometry');
          assert.equal(await items.first().evaluate((el) => {
            const divider = el.previousElementSibling;
            return divider.getAttribute('role') === 'separator' && divider.getBoundingClientRect().height === 1;
          }), true, group + ' has its own thin divider');
          for (const item of await items.all()) {
            const box = await item.boundingBox();
            await p.mouse.move(box.x + box.width - 10, box.y + box.height / 2);
            assert.equal(await item.evaluate((el) => el.matches(':hover') && getComputedStyle(el).backgroundColor === getComputedStyle(document.querySelector('.menu.open')).backgroundColor), true, 'hover at the far edge highlights the full row');
          }
        }
        if (active === 'light' || active === 'dark') {
          await themes.first().hover();
          await p.screenshot({ path: `${shotDir}/s16-t36-${active}.png` });
        }
        const next = active === 'light' ? 'dark' : active === 'dark' ? 'follow system' : 'light';
        await themes.filter({ hasText: 'Theme: ' + next }).click();
        await view.click();
      }
      await view.click();
      await p.reload();
      await view.click();
      assert.equal(await themes.filter({ hasText: 'Theme: light' }).getAttribute('aria-checked'), 'true', 'theme tick persists after reload');
    } finally { await context.close(); }
  });

  const partText = () => t('part').evaluate((s) => s.selectedOptions[0].textContent);
  await step('start state: one empty "Drawing 1", no sample data, Apply disabled with its hint', async () => {
    assert.deepEqual(await tabNames(), ['Drawing 1']);
    assert.equal(await t('count').textContent(), '0');
    assert.deepEqual(await page.locator('.layer .nm').allTextContents(), [], 'an empty drawing has no layers');
    assert.equal(await page.locator('[data-group=parts] [data-i]').count(), 0);
    assert.equal(await t('mode-part').count(), 0, 'no Part | Layout switch');
    assert.equal(await t('new-layout').textContent(), '+ New layout');
    assert.equal(await t('apply').isDisabled(), true);
    for (const id of ['sheet-panel', 'step-panel', 'propbar', 'drawing-panel']) assert.equal(await t(id).isVisible(), false, id);
    const body = await page.locator('body').textContent();
    assert.ok(!/Overlay-A|overlays-oct|front-panel|Print · /.test(body), 'no sample data');
    const dir = process.env.SHOTS_DIR || 'shots';
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: dir + '/s4-start-light.png' });
    await page.locator('[data-menu=View]').click(); await page.getByRole('menuitemcheckbox', { name: new RegExp('Theme: dark' + '$') }).click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: dir + '/s4-start-dark.png' });
    await page.locator('[data-menu=View]').click(); await page.getByRole('menuitemcheckbox', { name: new RegExp('Theme: light' + '$') }).click();
  });

  await step('× on the only tab leaves a fresh "Drawing 1"; + adds "Drawing 2"; × closes any tab', async () => {
    await page.locator('.tabs .dtab .x').first().click();
    assert.deepEqual(await tabNames(), ['Drawing 1']);
    await t('new-tab').click();
    assert.deepEqual(await tabNames(), ['Drawing 1', 'Drawing 2']);
    await page.locator('.tabs .dtab', { hasText: 'Drawing 1' }).locator('.x').click();      // not the active one
    assert.deepEqual(await tabNames(), ['Drawing 2']);
    await t('new-tab').click();
    assert.deepEqual(await tabNames(), ['Drawing 2', 'Drawing 1']);
    await page.locator('.tabs .dtab', { hasText: 'Drawing 2' }).locator('.x').click();
    await page.locator('.tabs .dtab .x').first().click();
    assert.deepEqual(await tabNames(), ['Drawing 1']);
  });

  await step('TODO 62: Open keeps drawn, edited and saved tabs; only an untouched new tab is replaced', async () => {
    for (const kind of ['draw', 'draw-save', 'layer-save', 'empty-save']) {
      await t('new-tab').click();
      if (kind === 'layer-save') {
        await t('layer-add').click();
        await page.evaluate(() => document.activeElement.blur());
      } else {
        await page.locator('[data-tool=line]').click();
        if (kind !== 'empty-save') { await typeCmd('20,20'); await typeCmd('120,20'); }
        await page.keyboard.press('Escape');
      }
      if (kind.endsWith('save')) {
        const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
        const raw = readDxf(readFileSync(await dl.path(), 'latin1'));
        assert.equal(raw.entities.length, kind === 'draw-save' ? 1 : 0);
        assert.equal(await page.locator('.tabs .dtab.on .dot').count(), 0, 'Save cleared dirty');
      }
      const before = await tabNames(), keptName = before.at(-1);
      await t('picker').setInputFiles('fixtures/overlay.dxf');
      await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'overlay.dxf');
      assert.deepEqual(await tabNames(), [...before, 'overlay.dxf'], kind + ': the tab stays');
      await page.locator('.tabs .dtab', { hasText: keptName }).click();
      assert.equal(await t('entities').textContent(), kind.startsWith('draw') ? 'Entities 1' : 'Entities 0');
      await closeTabs(/./);
    }
    await t('new-tab').click();
    await t('picker').setInputFiles('fixtures/overlay.dxf');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'overlay.dxf');
    assert.deepEqual(await tabNames(), ['Drawing 1', 'overlay.dxf'], 'the untouched Drawing 2 is replaced');
    await closeTabs(/./);
  });

  await step('Many tabs: only the tab strip scrolls at 1024; widening to 1440 keeps the menu and toolbar in place and + New layout on one line', async () => {
    const c2 = await browser.newContext({ viewport: { width: 1024, height: 700 } });
    try {
      const p2 = await c2.newPage();
      await p2.goto(URL_); await p2.waitForSelector('[data-testid=count]', { state: 'attached' });
      for (let i = 1; i < 17; i++) await p2.locator('[data-testid=new-tab]').click();
      const docs = p2.locator('.tabs .dtab[data-kind]');
      assert.equal(await docs.count(), 17);
      const fits = async () => {
        const m = await p2.evaluate(() => {
          const strip = document.querySelector('.tabs'), row = document.querySelector('.tabsrow');
          const label = document.createRange(); label.selectNodeContents(document.querySelector('[data-testid=new-layout]'));
          return {
            pageWidth: document.documentElement.scrollWidth, viewport: innerWidth, pageX: scrollX,
            shellX: document.querySelector('.shell').scrollLeft, rowX: row.scrollLeft,
            menuLeft: document.querySelector('.menubar').getBoundingClientRect().left,
            toolsRight: document.querySelector('.rowtools').getBoundingClientRect().right,
            stripX: strip.scrollLeft, stripWidth: strip.clientWidth, contentWidth: strip.scrollWidth,
            labelLines: label.getClientRects().length,
          };
        });
        assert.ok(m.pageWidth <= m.viewport, 'the page fits the viewport');
        assert.deepEqual([m.pageX, m.shellX, m.rowX, m.menuLeft], [0, 0, 0, 0], 'the page and shell never scroll sideways');
        assert.ok(m.toolsRight <= m.viewport, 'the toolbar stays inside the window');
        assert.ok(m.contentWidth > m.stripWidth && m.stripX > 0, 'the tab strip itself scrolls to reveal the last tab');
        assert.equal(m.labelLines, 1, '+ New layout stays on one line');
      };
      await docs.first().click(); await docs.last().click();
      assert.ok((await docs.last().getAttribute('class')).includes('on'), 'the last tab is selected');
      await fits();
      await p2.setViewportSize({ width: 1440, height: 900 });
      await fits();
      for (let i = 0; i < 3; i++) await docs.last().locator('.x').click();
      assert.equal(await docs.count(), 14);
      await docs.first().click(); await docs.last().click();
      await fits();
    } finally { await c2.close(); }
  });

  await step('a DXF opens on a drawing tab (no sheet); Add to layout makes a layout tab and the part fills Step and repeat', async () => {
    await t('picker').setInputFiles('fixtures/overlay.dxf');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'overlay.dxf');
    assert.deepEqual(await tabNames(), ['overlay.dxf']);
    assert.equal(await t('drawing-panel').isVisible(), true);
    assert.equal(await t('sheet-panel').isVisible(), false);
    await t('add-to-layout').click();
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').dataset.kind === 'layout');
    assert.deepEqual(await tabNames(), ['overlay.dxf', 'overlay layout']);
    assert.equal(await partText(), 'overlay · 120 × 80');
    assert.equal(await t('apply').isDisabled(), false);
  });

  await step('default sheet case: 56, 8 × 7, 77%', async () => {
    const r = await readout();
    assert.equal(r.count, N0); assert.equal(N0, 56); assert.match(r.grid, /8 × 7/);
    assert.equal(await t('pct').textContent(), '77% of sheet');
    assert.equal(await page.locator('[data-group=parts] .part-hit').count(), N0);
  });

  await step('layout: menu bar, rail tools in order, layers', async () => {
    assert.deepEqual(await page.locator('.menubar .menu').allTextContents(), ['File', 'Edit', 'View', 'Draw', 'Modify', 'Format', 'Layout', 'Tools', 'Help']);
    const labels = await page.locator('nav[aria-label=Tools] button').evaluateAll((b) => b.map((x) => x.getAttribute('aria-label')));
    assert.equal(labels.length, 20); assert.equal(labels[0], 'Select'); assert.equal(labels.at(-1), 'Measure');
    assert.deepEqual(await page.locator('.layer .nm').allTextContents(), ['Parts', 'Marks', 'Dimensions']);
  });

  // a download the page makes: { name, text }
  const downloaded = async (action) => {
    // Chromium silently drops burst downloads after 10/s; keep test exports below that limit.
    await page.waitForTimeout(110);
    const [dl] = await Promise.all([page.waitForEvent('download'), action()]).catch(async (e) => {
      // No download in 30 s: say what the page was doing (a dialog open swallows Ctrl+S; the status line shows a refused save)
      const seen = await page.evaluate(() => ({ dialog: !!document.querySelector('.pop-back, .pdlg-back'), prompt: document.querySelector('[data-testid=cmd-prompt]')?.textContent, focus: document.activeElement?.tagName })).catch(() => ({}));
      throw new Error(e.message + ' | page: ' + JSON.stringify(seen));
    });
    return { name: dl.suggestedFilename(), text: readFileSync(await dl.path(), 'latin1') };
  };
  const menuItem = async (menu, item) => { await page.locator(`[data-menu=${menu}]`).click(); await page.getByRole(item.startsWith('Theme:') ? 'menuitemcheckbox' : 'menuitem', { name: item.startsWith('Theme:') ? new RegExp(item + '$') : item, exact: true }).click(); };
  const grip = (side) => page.locator(`[data-key=grip${side}]`);
  await step('gripper per side, no margin: four fields, every side with a gripper is shaded; rail and panel fit at 900 px', async () => {
    assert.equal(await page.locator('[data-key=margin]').count(), 0, 'no margin field');
    assert.equal(await page.locator('[data-key=gripper]').count(), 0);
    assert.deepEqual(await Promise.all(['Top', 'Right', 'Bottom', 'Left'].map((x) => grip(x).inputValue())), ['0', '0', '30', '0']);
    const band = page.locator('.grip-band');
    assert.equal(await band.count(), 1, 'only the bottom gripper is set');
    assert.deepEqual(await band.evaluate((r) => [r.getAttribute('data-edge'), r.getAttribute('y'), r.getAttribute('height')]), ['bottom', '670', '30']);
    assert.equal(await page.locator('.grip-label').textContent(), 'GRIPPER 30');
    const fits = (sel) => page.locator(sel).evaluate((e) => e.scrollHeight <= e.clientHeight + 1);
    assert.ok(await fits('nav.rail'), 'rail scrolls');
  });

  await page.screenshot({ path: shotDir + '/a-light.png' });

  await step('Gap X 20 changes the count', async () => {
    await page.locator('[data-key=gapX]').fill('20');
    const want = stepRepeat({ ...base, gapX: 20 }).count;
    assert.notEqual(want, N0);
    assert.equal((await readout()).count, want);
    assert.equal(await page.locator('[data-group=parts] .part-hit').count(), want);
    await page.locator('[data-key=gapX]').fill('5');
    assert.equal((await readout()).count, N0);
  });

  await step('rotate 90° recomputes', async () => {
    await t('rotate').selectOption('90');
    const want = stepRepeat({ ...base, rotate: '90' });
    const r = await readout();
    assert.equal(r.count, want.count); assert.match(r.grid, new RegExp(`${want.cols} × ${want.rows}`));
    assert.equal(await t('pa').inputValue(), '270°', 'turned 90° clockwise = 270° anticlockwise, as in a DXF');
    await t('rotate').selectOption('0');
  });

  await step('huge values: a sheet side over 100 000 mm, grippers wider than the sheet, a sheet narrower than its grippers: refused, the field reverts', async () => {
    const f = (k) => page.locator(`[data-key=${k}]`);
    const w0 = await f('sheetW').inputValue(), h0 = await f('sheetH').inputValue();
    await f('sheetW').fill('1e308'); await f('sheetW').blur();
    assert.equal(await f('sheetW').inputValue(), w0);
    assert.match(await t('cmd-prompt').textContent(), /Width can be 100000 mm at most/);
    await f('sheetH').fill('100001'); await f('sheetH').blur();
    assert.equal(await f('sheetH').inputValue(), h0);
    const top0 = await grip('Top').inputValue();
    await grip('Top').fill(String(Number(h0) + 1)); await grip('Top').blur();
    assert.equal(await grip('Top').inputValue(), top0);
    assert.match(await t('cmd-prompt').textContent(), /Top can be \d+ mm at most/);
    await grip('Left').fill('10'); await grip('Right').fill('10');
    await f('sheetW').fill('15'); await f('sheetW').blur();
    assert.equal(await f('sheetW').inputValue(), w0, 'narrower than Left + Right: refused');
    assert.match(await t('cmd-prompt').textContent(), /Width must be 20 mm or more/);
    await grip('Left').fill('0'); await grip('Right').fill('0');
    await f('sheetW').fill('2000'); await f('sheetW').blur();
    assert.equal(await f('sheetW').inputValue(), '2000', 'a sane side is kept');
    await f('sheetW').fill(w0); await f('sheetW').blur();
    assert.equal(await page.locator('svg [d*="e+"]').count(), 0, 'no 1e+… in a path');
  });

  await step('preset, gripper sides and top-left align: the count and the first position follow', async () => {
    await t('preset').selectOption('a3');
    assert.equal(await page.locator('[data-key=sheetW]').inputValue(), '420');
    assert.equal((await readout()).count, stepRepeat({ ...base, sheetW: 420, sheetH: 297 }).count);
    await t('preset').selectOption('screen');
    await grip('Top').fill('30'); await grip('Bottom').fill('0');
    await t('align').selectOption('topleft');
    const want = stepRepeat({ ...base, gripTop: 30, gripBottom: 0, align: 'topleft' });
    assert.equal((await readout()).count, want.count);
    assert.equal(await t('px').inputValue(), want.positions[0].x.toFixed(2));
    assert.equal(await t('py').inputValue(), (700 - want.positions[0].y - 80).toFixed(2), 'Y is from the sheet\'s bottom-left, like the cursor');
    assert.equal(await page.locator('.grip-band').count(), 1); assert.equal(await page.locator('.grip-band').getAttribute('data-edge'), 'top');
    await grip('Top').fill('0'); await grip('Bottom').fill('30');
    await t('align').selectOption('centre');
    assert.equal((await readout()).count, N0);
  });

  await step('gripper: any sides at once, 0 = none, the parts keep clear of each', async () => {
    for (const [k, v] of [['Top', '20'], ['Right', '40'], ['Bottom', '0'], ['Left', '50']]) await grip(k).fill(v);
    assert.deepEqual(await page.locator('.grip-band').evaluateAll((r) => r.map((x) => x.getAttribute('data-edge')).sort()), ['left', 'right', 'top']);
    assert.deepEqual(await page.locator('.grip-label').allTextContents().then((x) => x.sort()), ['GRIPPER 20', 'GRIPPER 40', 'GRIPPER 50']);
    const o = { ...base, gripTop: 20, gripRight: 40, gripBottom: 0, gripLeft: 50 }, want = stepRepeat(o);
    assert.equal((await readout()).count, want.count);
    const printable = await page.locator('.printable').evaluate((r) => ['x', 'y', 'width', 'height'].map((k) => +r.getAttribute(k)));
    assert.deepEqual(printable, [50, 20, 910, 680]);
    await page.screenshot({ path: (process.env.SHOTS_DIR || 'shots') + '/s6-grippers-light.png' });
    for (const [k, v] of [['Top', '0'], ['Right', '0'], ['Bottom', '30'], ['Left', '0']]) await grip(k).fill(v);
    assert.equal((await readout()).count, N0); assert.equal(await page.locator('.grip-band').count(), 1);
  });

  await step('extra gap: click a gap, type mm; the grid shifts, the count follows, the panel lists it with a ×', async () => {
    const gaps = t('gap-list');
    assert.equal(await gaps.locator('.gaprow').count(), 0);
    await page.locator('[data-gap=r3]').click({ force: true, position: { x: 30, y: 5 } });
    const row = page.locator('[data-gap-row=r3]');
    assert.equal(await row.count(), 1);
    assert.match(await row.textContent(), /^After row 3: \+/);
    assert.equal(await page.locator('.gap-sel').count(), 1, 'the gap is shaded');
    assert.equal(await row.locator('input').evaluate((i) => i === document.activeElement), true, 'its field has the focus');
    await page.keyboard.type('90');                                       // 590 + 90 > 670: the last row goes
    assert.equal((await readout()).count, stepRepeat({ ...base, extraRows: [{ after: 3, mm: 90 }] }).count);
    assert.notEqual((await readout()).count, N0);
    await row.locator('input').fill('10');
    assert.equal((await readout()).count, N0);
    // rows are counted from the top: the 4th row (part 24 on) moved down by 10
    const want = stepRepeat({ ...base, extraRows: [{ after: 3, mm: 10 }] });
    await page.locator('[data-group=parts] [data-i="24"] .part-hit').click({ force: true });
    assert.equal(await t('py').inputValue(), (700 - want.positions[24].y - 80).toFixed(2));
    await page.locator('[data-gap=r1]').click({ force: true, position: { x: 30, y: 5 } });
    assert.equal(await page.locator('[data-gap-row=r1] input').inputValue(), '', 'an empty field, no extra yet');
    await page.locator('[data-gap=c2]').click({ force: true, position: { x: 5, y: 30 } });
    assert.equal(await gaps.locator('.gaprow').count(), 2, 'the empty after-row-1 one went away quietly');
    await page.keyboard.type('5');
    assert.deepEqual(await gaps.locator('.gaprow .lbl:first-child').allTextContents(), ['After row 3: +', 'After column 2: +']);
    const both = stepRepeat({ ...base, extraRows: [{ after: 3, mm: 10 }], extraCols: [{ after: 2, mm: 5 }] });
    await page.locator('[data-group=parts] [data-i="26"] .part-hit').click({ force: true });
    assert.equal(await t('px').inputValue(), both.positions[26].x.toFixed(2));
    assert.equal(await t('py').inputValue(), (700 - both.positions[26].y - 80).toFixed(2));
    const dir = process.env.SHOTS_DIR || 'shots';
    await page.screenshot({ path: dir + '/s6-extra-gap-light.png' });
    await menuItem('View', 'Theme: dark'); await page.waitForTimeout(150);
    await page.screenshot({ path: dir + '/s6-extra-gap-dark.png' });
    await menuItem('View', 'Theme: light');
  });

  await step('extra gap: what Save writes uses the shifted positions (the first Save of a new layout is a Save As)', async () => {
    const want = stepRepeat({ ...base, extraRows: [{ after: 3, mm: 10 }], extraCols: [{ after: 2, mm: 5 }] });
    const dl = await downloaded(() => page.keyboard.press('Control+s'));
    assert.equal(dl.name, 'overlay layout.dxf');
    const ins = readDxf(dl.text).entities.filter((e) => e.type === 'INSERT');
    const val = (e, c) => +e.r.v[e.r.c.indexOf(c)];
    const got = ins.map((e) => [Math.round(val(e, 10) * 100) / 100, Math.round(val(e, 20) * 100) / 100]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const exp = want.positions.map((p) => [Math.round(p.x * 100) / 100, Math.round((700 - p.y - 80) * 100) / 100]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    assert.deepEqual(got, exp);
  });

  await step('extra gap: a gap that no longer exists after a sheet change goes quietly; × removes one', async () => {
    await page.locator('[data-gap=r3]').click({ force: true, position: { x: 30, y: 5 } }); await page.keyboard.type('10');
    await page.locator('[data-gap=c2]').click({ force: true, position: { x: 5, y: 30 } }); await page.keyboard.type('5');
    assert.equal(await t('gap-list').locator('.gaprow').count(), 2);
    await t('preset').selectOption('a4');                                 // 2 × 2: no gap after row 3 or after column 2
    assert.equal(await t('gap-list').locator('.gaprow').count(), 0);
    await t('preset').selectOption('screen');
    assert.equal(await t('gap-list').locator('.gaprow').count(), 0, 'they do not come back');
    await page.locator('[data-gap=r3]').click({ force: true, position: { x: 30, y: 5 } }); await page.keyboard.type('10');
    await page.locator('[data-gap-remove=r3]').click();
    assert.equal(await t('gap-list').locator('.gaprow').count(), 0);
    assert.equal(await page.locator('.gap-sel').count(), 0);
    assert.equal((await readout()).count, N0);
  });

  await step('crop / reg checkboxes and layer toggles', async () => {
    const marks = page.locator('[data-group=marks] circle');
    assert.equal(await marks.count(), 0, 'marks are off by default');
    await page.locator('[data-key=crop]').check(); await page.locator('[data-key=reg]').check();
    assert.equal(await marks.count(), 4);
    await page.locator('[data-key=reg]').uncheck();
    assert.equal(await marks.count(), 0);
    await page.locator('[data-key=reg]').check();
    await page.locator('[data-layer=parts]').click();
    assert.equal(await page.locator('[data-group=parts]').evaluate((g) => getComputedStyle(g).display), 'none');
    await page.locator('[data-layer=parts]').click();
    assert.notEqual(await page.locator('[data-group=parts]').evaluate((g) => getComputedStyle(g).display), 'none');
  });

  await step('wheel zoom, pan and cursor coordinates', async () => {
    const before = await t('zoom').textContent();
    const box = await t('canvas').boundingBox();
    await page.mouse.move(box.x + 400, box.y + 300);
    const c1 = await t('coords').textContent();
    assert.match(c1, /X -?\d+\.\d\d\s+Y -?\d+\.\d\d mm/);
    await page.mouse.wheel(0, -300);
    const after = await t('zoom').textContent();
    assert.ok(parseInt(after) > parseInt(before), `${before} -> ${after}`);
    await page.mouse.move(box.x + 401, box.y + 300);
    assert.notEqual(await t('coords').textContent(), c1);
    const vb = await page.locator('.canvas > svg').getAttribute('viewBox');
    await page.locator('[data-tool=pan]').click();
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down(); await page.mouse.move(box.x + 360, box.y + 340); await page.mouse.up();
    assert.notEqual(await page.locator('.canvas > svg').getAttribute('viewBox'), vb);
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    assert.equal(await t('zoom').textContent(), before);
    await page.mouse.move(box.x + 400, box.y + 300); await page.mouse.wheel(0, -300);
    assert.notEqual(await t('zoom').textContent(), before);
    await page.keyboard.press('Control+0');                           // Ctrl+0 = Fit (TODO 42)
    assert.equal(await t('zoom').textContent(), before);
    assert.equal(await t('tool-chip').textContent(), 'Tool: Pan');     // the active tool chip (TODO 44)
    await typeCmd('s');                                                 // S is typed at the command bar now
    assert.equal(await t('tool-chip').textContent(), 'Tool: Select');
  });

  await step('tools: every rail tool is built (none greyed); Auto-nest opens its dialog and does not become the tool; Select/Step work', async () => {
    const line = page.locator('[data-tool=nest]');
    assert.equal(await line.getAttribute('title'), 'Auto-nest mixed parts');
    assert.equal(await line.getAttribute('aria-disabled'), null);
    assert.equal(await page.locator('nav.rail button.off').count(), 0, 'nothing is greyed');
    await line.click();
    assert.equal(await page.locator('[data-testid=nest-dialog]').count(), 1, 'it opens the Auto-nest dialog');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-testid=nest-dialog]').count(), 0);
    assert.ok(!(await line.getAttribute('class')).split(' ').includes('on'), 'it does not become the tool');
    for (const id of ['select', 'dimension', 'measure', 'step', 'pan']) assert.equal(await page.locator('[data-tool=' + id + ']').getAttribute('aria-disabled'), null, id + ' is built');
    await page.locator('[data-tool=select]').click();
    await page.locator('[data-group=parts] [data-i="8"] .part-hit').click({ force: true });
    assert.equal(await t('px').inputValue(), stepRepeat(base).positions[8].x.toFixed(2));
    await page.locator('[data-tool=step]').click();
  });

  // pixels in the drawing canvas that are not transparent
  const inked = () => t('drawing').evaluate((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  });
  // the canvas repaints on the next animation frame, which can lag on a slow runner:
  // poll until the pixel count satisfies ok (or time out), then return the last count
  const inkedWhen = async (ok, ms = 10000) => {
    const end = Date.now() + ms;
    let n = await inked();
    while (!ok(n) && Date.now() < end) { await page.waitForTimeout(50); n = await inked(); }
    return n;
  };
  // two animation frames: a redraw queued by the last action has run, so "blank" is the drawing, not the canvas before its repaint
  const blank = async () => { await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); return inkedWhen((n) => n === 0); };
  const tabs = () => page.locator('.tabs .dtab:not([aria-label])').allTextContents();

  await step('closing the tabs leaves a fresh empty Drawing 1 with nothing drawn', async () => {
    await closeTabs(/./);
    assert.deepEqual(await tabNames(), ['Drawing 1']);
    assert.equal(await t('count').textContent(), '0');
    assert.equal(await blank(), 0);
  });

  await step('Open: a .dxf through the browser picker gets a tab and is drawn', async () => {
    assert.equal(await blank(), 0);
    await t('picker').setInputFiles('fixtures/sample.dxf');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').textContent.startsWith('sample.dxf'));
    const names = await tabs();
    assert.equal(names.length, 1, 'the empty tab was used up');
    assert.match(names.at(-1), /^sample\.dxf/);
    assert.ok((await inkedWhen((n) => n > 500)) > 500, 'drawing canvas is blank');
    assert.match(await t('cmd-prompt').textContent(), /Opened sample\.dxf: 20 entities/);
    assert.equal(await t('entities').textContent(), 'Entities 20');
    assert.equal(await t('units').textContent(), '');
  });

  await step('layers panel lists the file\'s layers; toggling one hides it', async () => {
    assert.deepEqual((await page.locator('.layer .nm').allTextContents()).includes('Parts'), false, 'a drawing tab: only the file\'s layers');
    const names = await page.locator('.layer .nm').allTextContents();
    for (const n of ['OUTLINE', 'HOLES', 'CENTRE', 'NOTES', 'DIMS', 'HATCH']) assert.ok(names.includes(n), n);
    assert.ok(!names.includes('Print · Red'));
    const idx = await page.locator('.layer', { hasText: 'HOLES' }).getAttribute('data-file-layer');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));   // let the Layout view repaint first
    const all = await inked();
    await page.locator(`[data-layer=f${idx}]`).click();
    const less = await inkedWhen((n) => n < all);
    assert.ok(less < all, `${less} !< ${all}`);
    assert.ok((await page.locator('.layer', { hasText: 'HOLES' }).getAttribute('class')).includes('hidden-layer'));
    await page.locator(`[data-layer=f${idx}]`).click();
    assert.equal(await inkedWhen((n) => n === all), all);
  });

  await step('drawing sits at true size, 0,0 at the sheet bottom-left; Y is up', async () => {
    // sample.dxf's model box starts at x -10, y -38.9: the cursor at the sheet's bottom-left reads 0,0
    const box = await t('canvas').boundingBox();
    const vb = (await page.locator('.canvas > svg').getAttribute('viewBox')).split(' ').map(Number);
    const sc = box.width / vb[2];
    await page.mouse.move(box.x + (0 - vb[0]) * sc, box.y + (700 - vb[1]) * sc);
    assert.match(await t('coords').textContent(), /X -?0\.0\d\s+Y -?0\.0\d mm/);
  });

  await step('inch file: converted to mm, status says so', async () => {
    await t('picker').setInputFiles('fixtures/inch.dxf');
    await page.waitForSelector('.tabs .dtab:has-text("inch.dxf")');
    assert.equal(await t('units').textContent(), 'converted from inch');
    assert.equal(await t('entities').textContent(), 'Entities 3');
    assert.match(await t('cmd-prompt').textContent(), /converted from inch/);
  });

  await step('drag and drop a .dxf opens a tab', async () => {
    const data = readFileSync('fixtures/inch.dxf', 'utf8');
    const before = (await tabs()).length;
    const dt = await page.evaluateHandle((txt) => {
      const d = new DataTransfer();
      d.items.add(new File([txt], 'dropped.dxf', { type: 'text/plain' }));
      return d;
    }, data);
    await page.dispatchEvent('[data-testid=canvas]', 'dragover', { dataTransfer: dt });
    await page.dispatchEvent('[data-testid=canvas]', 'drop', { dataTransfer: dt });
    await page.waitForFunction((n) => document.querySelectorAll('.tabs .dtab:not([aria-label])').length === n, before + 1);
    assert.match((await tabs()).at(-1), /^dropped\.dxf/);
  });

  await step('a bad file says so; other types are refused', async () => {
    await t('picker').setInputFiles({ name: 'bad.dxf', mimeType: 'text/plain', buffer: Buffer.from('not a drawing') });
    await page.waitForFunction(() => /bad\.dxf/.test(document.querySelector('[data-testid=cmd-prompt]').textContent));
    assert.equal((await tabs()).filter((x) => x.startsWith('bad.dxf')).length, 0);
  });

  await step('switching tabs swaps the drawing; closing a tab works', async () => {
    await page.locator('.tabs .dtab', { hasText: 'sample.dxf' }).click();
    assert.equal(await t('entities').textContent(), 'Entities 20');
    await t('new-tab').click();                                                 // an empty tab
    assert.equal(await t('entities').textContent(), '');
    assert.equal(await blank(), 0);
    assert.deepEqual(await page.locator('.layer .nm').allTextContents(), []);
    const n = (await tabs()).length;
    await page.locator('.tabs .dtab', { hasText: /^Drawing \d/ }).locator('.x').click();
    assert.equal((await tabs()).length, n - 1);
    await page.locator('.tabs .dtab', { hasText: 'dropped.dxf' }).locator('.x').click();
    await page.locator('.tabs .dtab', { hasText: 'inch.dxf' }).locator('.x').click();
    assert.equal((await tabs()).length, n - 3);
    await page.locator('.tabs .dtab', { hasText: 'sample.dxf' }).click();
    assert.ok((await inkedWhen((x) => x > 500)) > 500);
  });

  await step('many layers: the panel still fits, only the layers list scrolls', async () => {
    await t('picker').setInputFiles('fixtures/many-layers.dxf');
    await page.waitForSelector('.tabs .dtab:has-text("many-layers.dxf")');
    await page.waitForFunction(() => document.querySelectorAll('.layer').length >= 30);
    assert.ok(await page.locator('aside.panel').evaluate((e) => e.scrollHeight <= e.clientHeight + 1), 'panel scrolls');
    assert.ok(await page.locator('.layers-rows').evaluate((e) => e.scrollHeight > e.clientHeight), 'list does not scroll');
    const last = page.locator('.layer', { hasText: 'LAYER_30' });
    await last.scrollIntoViewIfNeeded();
    assert.ok(await last.evaluate((e) => { const r = e.getBoundingClientRect(), l = e.parentElement.getBoundingClientRect(); return r.bottom <= l.bottom + 1 && r.top >= l.top - 1; }), 'last row not visible');
    assert.ok(await page.locator('aside.panel').evaluate((e) => e.scrollHeight <= e.clientHeight + 1), 'panel scrolls after');
    if (process.env.SHOTS_DIR) await page.screenshot({ path: process.env.SHOTS_DIR + '/s2-many.png' });
    await page.locator('.tabs .dtab', { hasText: 'many-layers.dxf' }).locator('.x').click();
    await page.locator('.tabs .dtab', { hasText: 'sample.dxf' }).click();
  });

  const named = (doc) => Object.keys(doc.layers).filter((n) => n !== '0').sort();       // the writer always adds layer 0
  const layerNames = (text) => named(readDxf(text));
  const fixtureLayers = (f) => named(readDxf(decodeDxf(readFileSync('fixtures/' + f))));

  await step('Save As (menu): a clean file downloads under its own name; the bytes re-read with the same layers', async () => {
    await t('picker').setInputFiles('fixtures/inch.dxf');
    await page.waitForSelector('.tabs .dtab:has-text("inch.dxf")');
    const dl = await downloaded(() => menuItem('File', 'Save As…'));
    assert.equal(dl.name, 'inch-edited.dxf');
    assert.match(dl.text, /^\s*0\r\nSECTION/);
    assert.ok(/^[\x00-\x7f]*$/.test(dl.text), 'ASCII only');
    assert.deepEqual(layerNames(dl.text), fixtureLayers('inch.dxf'));
    assert.match(await t('cmd-prompt').textContent(), /Saved inch-edited\.dxf/);
    await page.locator('.tabs .dtab', { hasText: 'inch-edited.dxf' }).locator('.x').click();
  });

  await step('Ctrl+S on a file with things Save cannot keep saves a copy, never the original', async () => {
    await page.locator('.tabs .dtab', { hasText: 'sample.dxf' }).click();
    const dl = await downloaded(() => page.keyboard.press('Control+s'));
    assert.equal(dl.name, 'sample-copy.dxf');
    assert.deepEqual(layerNames(dl.text), fixtureLayers('sample.dxf'));
    assert.ok(!/VIEWPORT|IMAGE/.test(dl.text));
    assert.match(await t('cmd-prompt').textContent(), /Saved sample-copy\.dxf \(without VIEWPORT 2, IMAGE 1\)/);
    assert.equal((await tabs()).filter((x) => x.startsWith('sample-copy.dxf')).length, 1);
  });

  let applied = 0;
  await step('Add to layout: a new "… layout" tab, unsaved, drawn; part size from the drawing; the drawing\'s tab stays', async () => {
    const before = (await tabs()).length;
    await t('add-to-layout').click();
    await page.waitForFunction((n) => document.querySelectorAll('.tabs .dtab:not([aria-label])').length === n, before + 1);
    assert.match((await tabs()).at(-1), /^sample-copy layout •/);
    assert.equal((await tabs()).filter((x) => x.startsWith('sample-copy.dxf')).length, 1, 'the drawing\'s own tab stays');
    assert.equal(await partText(), 'sample-copy · 165.9 × 119.3');
    applied = Number(await t('count').textContent());
    const want = stepRepeat({ ...base, partW: 165.9, partH: 119.3 }).count;
    assert.equal(applied, want); assert.ok(applied > 1);
    assert.ok((await inkedWhen((n) => n > 500)) > 500, 'layout is blank');
    assert.deepEqual(await page.locator('.layer .nm').allTextContents(), ['Parts', 'Marks', 'Dimensions']);
    assert.match(await t('cmd-prompt').textContent(), new RegExp('added to sample-copy layout: ' + applied + ' fit on the sheet'));
  });

  await step('layout tab: Save writes one INSERT per part plus the sheet and marks; the tab is clean after', async () => {
    const dl = await downloaded(() => page.keyboard.press('Control+s'));
    assert.equal(dl.name, 'sample-copy layout.dxf');
    const doc = readDxf(dl.text);
    assert.equal(doc.entities.filter((e) => e.type === 'INSERT').length, applied);
    // layer names ignore case: the part's SHEET layer is the layout's Sheet (one record, not a duplicate)
    for (const n of ['Parts', 'Sheet', 'Marks', ...fixtureLayers('sample.dxf')]) assert.ok(Object.keys(doc.layers).some((k) => k.toLowerCase() === n.toLowerCase()), n);
    assert.ok(doc.entities.some((e) => e.layer === 'Sheet'));
    assert.ok(doc.blocks.PD_LAYOUT, 'the layout\'s settings are inside the file');
    assert.ok(!(await tabs()).some((x) => x.includes('•')), 'dot should be gone');
  });

  await step('screenshots 1440 × 900 with the applied layout, light and dark', async () => {
    const dir = process.env.SHOTS_DIR || 'shots';
    mkdirSync(dir, { recursive: true });
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await inkedWhen((n) => n > 500);
    await page.screenshot({ path: dir + '/s3-light.png' });
    await menuItem('View', 'Theme: dark');
    await inkedWhen((n) => n > 500);
    await page.waitForTimeout(150);
    await page.screenshot({ path: dir + '/s3-dark.png' });
    await menuItem('View', 'Theme: light');
  });

  // ---- PDF / Print (the active tab is the applied layout)
  const pdfBytes = (dl) => Buffer.from(dl.text, 'latin1');
  const pdfText = (dl) => dl.text;
  const boxes = (txt) => [...txt.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [Number(m[1]) / (72 / 25.4), Number(m[2]) / (72 / 25.4)]);
  const dialog = page.locator('[data-testid=pdf-dialog]');
  const openPdf = async () => { await t('pdf-open').click(); await dialog.waitFor(); await page.waitForFunction(() => { const c = document.querySelector('[data-testid=pdf-preview]'); return c && c.width > 100; }); };
  afterStep = async () => {
    const v = page.viewportSize();                                  // a failed small-window step must not leave the window small
    if (!v || v.width !== 1440 || v.height !== 900) await page.setViewportSize({ width: 1440, height: 900 });
    if (await page.locator('[data-testid=pdf-back]').count()) await closePdf();
  };   // after a FAILED step, a still-open PDF dialog is closed so it does not block the steps after it
  const closePdf = async () => { await t('pdf-close').click(); await dialog.waitFor({ state: 'detached' }); };
  let layers = 0;

  await step('PDF / Print: the dialog opens from the tab row button with the mock-up\'s defaults', async () => {
    await openPdf();
    assert.equal(await dialog.getAttribute('aria-label'), 'PDF export');
    assert.equal((await dialog.locator('h1').textContent()), 'PDF / Print');
    assert.deepEqual(await dialog.locator('[role=tab]').allTextContents(), ['This layout', 'A folder at once']);
    assert.equal(await t('pdf-tab-one').getAttribute('aria-selected'), 'true');
    assert.equal(await t('pdf-page-sheet').isChecked(), true);
    assert.equal(await t('pdf-page-tile').isChecked(), false);
    assert.equal(await t('pdf-page-check').isChecked(), false);
    assert.equal(await t('pdf-sheet-size').textContent(), '1000 × 700');
    assert.equal(await t('pdf-tile-paper').inputValue(), 'A3');
    assert.deepEqual(await t('pdf-tile-paper').locator('option').allTextContents(), ['A3', 'A4']);
    assert.equal(await t('pdf-check-paper').inputValue(), 'A4');
    assert.deepEqual(await t('pdf-check-paper').locator('option').allTextContents(), ['A4', 'A3']);
    const on = { mirror: true, negative: false, black: true, separate: true, crop: false, reg: false, strip: true };
    for (const [k, v] of Object.entries(on)) assert.equal(await t('pdf-' + k).isChecked(), v, k);
    assert.deepEqual(await dialog.locator('legend').allTextContents(), ['Page', 'Title block', 'Film', 'Pages', 'Marks']);
    const labels = (await dialog.locator('.pd-left .pd-set:not([hidden]) label').allTextContents()).map((x) => x.replace(/\s+/g, ' ').trim());
    assert.deepEqual(labels.slice(0, 3), ['Sheet size, 1:1 1000 × 700', 'Tile 1:1 on A3A4 pages 3 × 3 tiles'.replace('3 × 3', '4 × 2'), 'Check print, fit to A4A3 scale 1 : 3.97'.replace('3.97', labels[2].match(/1 : [\d.]+/)[0].slice(4))]);
    assert.deepEqual(labels.slice(3, 9), ['Mirror (emulsion down)', 'Negative', 'All colours print black', 'One page per print colour (layer)', 'Crop marks', 'Registration marks'].slice(0, 3).concat(['One page per print colour (layer)', 'Crop marks', 'Registration marks']));
    assert.equal(labels[9], 'Job strip: file, date, colour');
    assert.deepEqual(await dialog.locator('.pd-footer button').allTextContents(), ['Cancel', 'Print…', 'Save PDF']);
    assert.equal(await t('pdf-foot').textContent(), 'sample-copy layout.pdf');
    const note = await t('pdf-pages-note').textContent();
    layers = Number(note.match(/= (\d+) pages?$/)[1]);
    assert.ok(layers >= 3 && note.includes('OUTLINE'), note);
    assert.equal(await t('pdf-pagebtn').count(), layers);
    assert.match(await t('pdf-preview-label').textContent(), new RegExp(`^Preview · page 1 of ${layers} · `));
    assert.equal(await t('pdf-pagebtn').first().textContent().then((x) => /^1 · /.test(x)), true);
    assert.ok((await t('pdf-preview').evaluate((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 60 && d[i + 3] > 200) n++; return n; })) > 200, 'preview is blank');
  });

  await step('screenshots 1440 × 900 of the dialog over the layout, light and dark', async () => {
    const dir = process.env.SHOTS_DIR || 'shots';
    await page.waitForTimeout(150);
    await page.screenshot({ path: dir + '/s4-light.png' });
    await closePdf();
    await menuItem('View', 'Theme: dark');
    await openPdf();
    await page.waitForTimeout(150);
    await page.screenshot({ path: dir + '/s4-dark.png' });
    await closePdf();
    await menuItem('View', 'Theme: light');
  });

  await step('closing: ×, Cancel, Escape and a click outside', async () => {
    await openPdf(); await closePdf();
    await openPdf(); await t('pdf-cancel').click(); await dialog.waitFor({ state: 'detached' });
    await openPdf(); await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    await menuItem('File', 'PDF / Print…'); await dialog.waitFor();
    await page.mouse.click(5, 5); await dialog.waitFor({ state: 'detached' });
  });

  await step('Save PDF at 1:1: a PDF per colour, the sheet\'s size in points, mirrored, marks and strip; settings are kept', async () => {
    await openPdf();
    await t('pdf-crop').check(); await t('pdf-reg').check();                          // off by default
    const dl = await downloaded(() => t('pdf-go').click());
    assert.equal(dl.name, 'sample-copy layout.pdf');
    const txt = pdfText(dl), b = pdfBytes(dl);
    assert.equal(b.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.equal((txt.match(/\/Type \/Page /g) || []).length, layers);
    assert.equal(Number(txt.match(/\/Count (\d+)/)[1]), layers);
    for (const [w, h] of boxes(txt)) { assert.ok(Math.abs(w - 1000) < 0.001 && Math.abs(h - 700) < 0.001, `${w} × ${h}`); }
    assert.equal(boxes(txt).length, layers);
    assert.match(txt, /\(sample-copy layout \\267 \d\d-\d\d-\d{4} \\267 OUTLINE \\267 1\/\d+\)/);
    assert.ok(!/NaN|Infinity/.test(txt));
    assert.equal(await dialog.count(), 0, 'closes after saving');
    assert.match(await t('cmd-prompt').textContent(), /Saved sample-copy layout\.pdf \(\d+ pages\)/);
    // mirrored: the first page's strip text matrix has a negative x scale
    assert.match(txt.split('stream\n')[1], /BT \/F1 1 Tf -[\d.]+ /);
  });

  await step('Mirror off, Negative on, one page per colour off change the output', async () => {
    await openPdf();
    await t('pdf-mirror').uncheck();
    const plain = pdfText(await downloaded(() => t('pdf-go').click()));
    assert.match(plain.split('stream\n')[1], /BT \/F1 1 Tf [\d.]+ /);
    await openPdf();
    assert.equal(await t('pdf-mirror').isChecked(), false, 'settings are kept for the session');
    await t('pdf-negative').check();
    const neg = pdfText(await downloaded(() => t('pdf-go').click()));
    assert.match(neg.split('stream\n')[1], /\n0 0 0 rg\n0 0 m\n1000 0 l\n1000 700 l/, 'black page first');
    assert.ok(/1 1 1 RG/.test(neg) && !/\n0 0 0 RG/.test(neg), 'white artwork');
    await openPdf();
    await t('pdf-negative').uncheck();
    await t('pdf-separate').uncheck();
    assert.match(await t('pdf-pages-note').textContent(), /^All layers = 1 page$/);
    assert.equal(await t('pdf-pagebtn').count(), 1);
    const one = pdfText(await downloaded(() => t('pdf-go').click()));
    assert.equal((one.match(/\/Type \/Page /g) || []).length, 1);
    assert.match(one, /\\267 ALL \\267 1\/1\)/);
    await openPdf();
    await t('pdf-mirror').check(); await t('pdf-separate').check();           // back to the defaults
    await closePdf();
  });

  await step('Tile 1:1 on A3: more pages, A3 size, tile labels; check print: A4 with a scale', async () => {
    await openPdf();
    await t('pdf-page-tile').check();
    const tiles = await t('pdf-tile-count').textContent();
    assert.match(tiles, /^\d+ × \d+ tiles$/);
    const n = tiles.match(/(\d+) × (\d+)/).slice(1).reduce((a, x) => a * Number(x), 1);
    assert.equal(await t('pdf-pagebtn').count(), Math.min(60, n * layers));
    const dl = await downloaded(() => t('pdf-go').click());
    const txt = pdfText(dl);
    assert.equal(Number(txt.match(/\/Count (\d+)/)[1]), n * layers);
    const [w, h] = boxes(txt)[0];
    assert.ok((Math.abs(w - 297) < 0.01 && Math.abs(h - 420) < 0.01) || (Math.abs(w - 420) < 0.01 && Math.abs(h - 297) < 0.01), `${w} × ${h}`);
    assert.match(txt, /\(Tile 1\/\d+ /);
    await openPdf();
    await t('pdf-page-check').check();
    assert.equal(await t('pdf-mirror').isDisabled(), true); assert.equal(await t('pdf-negative').isDisabled(), true);
    const ck = pdfText(await downloaded(() => t('pdf-go').click()));
    const [cw, ch] = boxes(ck)[0];
    assert.ok(Math.abs(cw - 297) < 0.01 && Math.abs(ch - 210) < 0.01, `${cw} × ${ch}`);
    assert.match(ck, /\(Scale 1 : [\d.]+\)/);
    assert.match(ck, /\(Check print: not to be used as film\)/);
    await openPdf();
    await t('pdf-check-paper').selectOption('A3');
    const a3 = boxes(pdfText(await downloaded(() => t('pdf-go').click())))[0];
    assert.ok(Math.abs(a3[0] - 420) < 0.01 && Math.abs(a3[1] - 297) < 0.01, `${a3}`);
    await openPdf(); await t('pdf-page-sheet').check(); await closePdf();
  });

  await step('TODO 101 / T18: editable title block, off frees the strip, Reset, per-tab settings saved and reopened', async () => {
    const titleCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    const titlePage = await titleCtx.newPage();
    const q = (id) => titlePage.locator(`[data-testid=${id}]`);
    const open = async () => { await q('pdf-open').click(); await q('pdf-dialog').waitFor(); };
    const saveDownload = async (action) => {
      const pending = titlePage.waitForEvent('download'); await action();
      const dl = await pending;
      return { name: dl.suggestedFilename(), buffer: readFileSync(await dl.path()) };
    };
    try {
      await titlePage.goto(URL_);
      const raw = newDoc();
      addEntities(raw, dxfLine(0, 0, 100, 0), dxfLine(100, 0, 100, 200), dxfLine(100, 200, 0, 200), dxfLine(0, 200, 0, 0));
      await q('picker').setInputFiles({ name: 'title-test.dxf', mimeType: 'application/dxf', buffer: Buffer.from(writeDxf(raw)) });
      await titlePage.waitForFunction(() => document.querySelector('.tabs .dtab.on').textContent.startsWith('title-test.dxf'));
      await open(); await q('pdf-page-check').check();
      assert.equal(await q('pdf-title-block').isChecked(), true);
      const autoDate = await titlePage.evaluate(() => { const d = new Date(); return [d.getDate(), d.getMonth() + 1].map((n) => String(n).padStart(2, '0')).join('-') + '-' + d.getFullYear(); });
      assert.equal(await q('pdf-title-date').inputValue(), autoDate);
      const fields = { file: 'Shop bracket', scale: 'Approved scale', size: 'Part B / rev 2', date: 'Approved yesterday', footnote: 'Approved <shop> & checked' };
      for (const [key, value] of Object.entries(fields)) await q('pdf-title-' + key).fill(value);
      assert.equal(await q('pdf-dialog').locator('shop').count(), 0, 'typed markup stays text');
      await q('pdf-title-footnote').scrollIntoViewIfNeeded();
      await titlePage.screenshot({ path: shotDir + '/todo-101-title-block-light.png' });
      await titlePage.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
      await titlePage.waitForTimeout(250);
      await titlePage.screenshot({ path: shotDir + '/todo-101-title-block-dark.png' });
      const exported = (await saveDownload(() => q('pdf-go').click())).buffer.toString('latin1');
      for (const value of Object.values(fields)) assert.ok(exported.includes('(' + value + ') Tj'), value + ' is PDF text');
      assert.match(exported, /\/Subject \(Scale [\d.]+ : [\d.]+\)/, 'properties keep the real scale');
      await open();
      for (const [key, value] of Object.entries(fields)) assert.equal(await q('pdf-title-' + key).inputValue(), value);
      const withBoxScale = await q('pdf-scale').textContent();
      await q('pdf-title-block').uncheck();
      assert.equal(await q('pdf-title-footnote').isDisabled(), true);
      assert.notEqual(await q('pdf-scale').textContent(), withBoxScale, 'scale uses the freed strip');
      const noBox = (await saveDownload(() => q('pdf-go').click())).buffer.toString('latin1');
      assert.equal(/ Tj ET/.test(noBox), false, 'no title text or warning on the page');
      await open();
      assert.equal(await q('pdf-title-block').isChecked(), false);
      assert.equal(await q('pdf-title-footnote').inputValue(), fields.footnote);
      await q('pdf-close').click();
      const saved = await saveDownload(() => titlePage.keyboard.press('Control+s'));
      const drawTabs = await titlePage.locator('.tabs .dtab:not([aria-label])').count();
      await q('picker').setInputFiles({ name: saved.name, mimeType: 'application/dxf', buffer: saved.buffer });
      await titlePage.waitForFunction((count) => document.querySelectorAll('.tabs .dtab:not([aria-label])').length > count, drawTabs);
      await open();
      assert.equal(await q('pdf-title-block').isChecked(), false, 'off survives Save and reopen');
      await q('pdf-title-block').check();
      for (const [key, value] of Object.entries(fields)) assert.equal(await q('pdf-title-' + key).inputValue(), value, 'reopened ' + key);
      await q('pdf-title-footnote').fill('');
      const empty = (await saveDownload(() => q('pdf-go').click())).buffer.toString('latin1');
      assert.equal(empty.includes(fields.footnote), false);
      await open(); await q('pdf-title-reset').click();
      assert.equal(await q('pdf-title-date').inputValue(), autoDate);
      assert.match(await q('pdf-title-footnote').inputValue(), /Fitted to one page/);
      assert.match(await q('pdf-title-scale').inputValue(), /NOT 1:1/);
      await q('pdf-title-footnote').fill('This tab only'); await q('pdf-close').click();
      await q('picker').setInputFiles({ name: 'another-title.dxf', mimeType: 'application/dxf', buffer: Buffer.from(writeDxf(raw)) });
      await titlePage.waitForFunction(() => document.querySelector('.tabs .dtab.on').textContent.startsWith('another-title.dxf'));
      await open();
      assert.match(await q('pdf-title-footnote').inputValue(), /Fitted to one page/, 'other tab keeps its own defaults');
      await q('pdf-close').click();
      await titlePage.locator('.tabs .dtab', { hasText: saved.name }).last().click();
      await open(); assert.equal(await q('pdf-title-footnote').inputValue(), 'This tab only');
      await q('pdf-close').click();
      await q('add-to-layout').click();
      await open(); await q('pdf-page-check').check();
      assert.equal(await q('pdf-title-block').isChecked(), true);
      assert.match(await q('pdf-title-footnote').inputValue(), /^Check print:/, 'new layout has its own defaults');
      await q('pdf-title-footnote').fill('Layout proof');
      await q('pdf-title-block').uncheck(); await q('pdf-close').click();
      const layoutSaved = await saveDownload(() => titlePage.keyboard.press('Control+s'));
      const layoutTabs = await titlePage.locator('.tabs .dtab:not([aria-label])').count();
      await q('picker').setInputFiles({ name: layoutSaved.name, mimeType: 'application/dxf', buffer: layoutSaved.buffer });
      await titlePage.waitForFunction((count) => document.querySelectorAll('.tabs .dtab:not([aria-label])').length > count, layoutTabs);
      await open();
      assert.equal(await q('pdf-title-block').isChecked(), false, 'layout switch survives Save and reopen');
      assert.equal(await q('pdf-title-footnote').inputValue(), 'Layout proof');
      await q('pdf-title-reset').click();
      assert.equal(await q('pdf-title-block').isChecked(), false, 'Reset restores text without changing the switch');
      assert.match(await q('pdf-title-footnote').inputValue(), /^Check print:/);
    } finally { await titleCtx.close(); }
  });

  await step('page buttons pick the preview page; Print… saves and opens the PDF', async () => {
    await openPdf();
    await t('pdf-pagebtn').nth(1).click();
    assert.match(await t('pdf-preview-label').textContent(), new RegExp(`^Preview · page 2 of ${layers} · `));
    assert.equal(await t('pdf-pagebtn').nth(1).evaluate((b) => b.classList.contains('on')), true);
    await t('pdf-print').click();
    await dialog.waitFor({ state: 'detached' });
    assert.match(await t('cmd-prompt').textContent(), /sample-copy layout\.pdf opened for printing \(\d+ pages\)|opened for printing/);
  });

  await step('Print… in the app asks where to save (the Save dialog, <name>.pdf), not Downloads; Cancel writes nothing', async () => {
    await page.evaluate(() => {
      window.__saved = { asked: [], wrote: [] }; window.__pick = 'C:\\prints\\mine';
      window.__TAURI__ = { dialog: { save: async (o) => { window.__saved.asked.push(o.defaultPath); return window.__pick; } }, fs: { exists: async () => false, writeFile: async (p) => { window.__saved.wrote.push(p); } }, path: { downloadDir: async () => { throw new Error('Downloads must not be used'); } } };
    });
    await openPdf();
    await page.evaluate(() => { window.__pick = null; });
    await t('pdf-print').click();                                     // Cancel in the dialog
    await page.waitForFunction(() => window.__saved.asked.length === 1);
    assert.equal(await dialog.count(), 1, 'the PDF dialog stays open on Cancel');
    assert.deepEqual(await page.evaluate(() => window.__saved.wrote), []);
    await page.evaluate(() => { window.__pick = 'C:\\prints\\mine'; });
    await t('pdf-print').click();
    await dialog.waitFor({ state: 'detached' });
    const got = await page.evaluate(() => window.__saved);
    assert.match(got.asked[0], /\.pdf$/);
    assert.deepEqual(got.wrote, ['C:\\prints\\mine.pdf']);
    assert.match(await t('cmd-prompt').textContent(), /Saved C:\\prints\\mine\.pdf/);
    await page.evaluate(() => { window.__pick = null; });
    await openPdf();
    await t('pdf-go').click();
    await page.waitForFunction(() => window.__saved.asked.length === 3);
    assert.equal(await page.evaluate(() => window.__saved.asked.at(-1)), 'sample-copy layout.pdf', 'a tab without a disk path leaves the last folder to the native picker');
    await t('pdf-cancel').click();
    await page.evaluate(() => { delete window.__TAURI__; delete window.__saved; });
  });

  await step('A folder at once: choose a folder, the list, Convert makes one PDF per .dxf', async () => {
    await openPdf();
    await t('pdf-tab-batch').click();
    assert.equal(await t('pdf-go').isDisabled(), true);
    assert.equal(await t('pdf-print').isDisabled(), true);
    assert.equal(await t('pdf-go').textContent(), 'Convert 0 files');
    assert.equal(await t('pdf-foot').textContent(), '0 files · 0 done');
    assert.deepEqual(await dialog.locator('.pd-batch .pd-row').allTextContents().then((a) => a.map((x) => x.trim())), ['.dxf', '.dwg', '.cdr', 'Subfolders too']);
    assert.equal(await t('pdf-batch-mode').inputValue(), 'same');
    assert.deepEqual(await t('pdf-batch-mode').locator('option').allTextContents(), ['Same as “This layout”', 'Check print, A4 fit', 'Sheet size 1:1, no film options']);
    assert.deepEqual(await t('pdf-batch-save').locator('option').allTextContents(), ['Same folder as each file', 'Choose a folder…']);
    await t('pdf-dirpicker').setInputFiles(['fixtures/inch.dxf', 'fixtures/many-layers.dxf', 'fixtures/sample.dxf']);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=pdf-include]').length >= 3);
    assert.equal(await t('pdf-go').textContent(), 'Convert 3 files');
    assert.equal(await t('pdf-foot').textContent(), '3 files · 0 done');
    const names = await dialog.locator('.pd-list .pd-grid:not(.head) span[title]').allTextContents();
    assert.deepEqual(names.sort(), ['inch.dxf', 'many-layers.dxf', 'sample.dxf']);
    await t('pdf-include').nth(1).uncheck();                                   // many-layers.dxf skipped
    assert.equal(await t('pdf-go').textContent(), 'Convert 2 files');
    const got = [];
    const onDl = async (d) => got.push({ name: d.suggestedFilename(), text: readFileSync(await d.path(), 'latin1') });   // d.path() waits for the download to finish
    page.on('download', onDl);
    await t('pdf-go').click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=pdf-status]')].filter((e) => /^Done · \d+ pages?$/.test(e.textContent)).length === 2, null, { timeout: 20000 });
    for (let i = 0; i < 200 && got.length < 2; i++) await page.waitForTimeout(100);      // the real condition: both files saved
    page.off('download', onDl);
    assert.deepEqual(got.map((g) => g.name).sort(), ['inch.pdf', 'sample.pdf']);
    for (const g of got) { assert.ok(g.text.startsWith('%PDF-')); assert.ok(!/NaN/.test(g.text)); }
    assert.equal(await t('pdf-foot').textContent(), '3 files · 2 done');
    assert.match(await t('cmd-prompt').textContent(), /PDF: 2 of 2 files converted/);
    await closePdf();
  });

  await step('closing a tab with unsaved changes asks first; Keep it open keeps it, closing discards', async () => {
    await t('new-layout').click();                                                    // a second layout tab, changed and not saved
    await page.locator('[data-key=gapX]').fill('6');
    await page.waitForFunction(() => /•/.test(document.querySelector('.tabs .dtab.on').textContent));
    const n = (await tabs()).length;
    const closeBtn = () => page.locator('.tabs .dtab.on .x');
    page.once('dialog', (d) => d.dismiss());
    await closeBtn().click();
    await page.waitForTimeout(100);
    assert.equal((await tabs()).length, n);
    let asked = '';
    page.once('dialog', (d) => { asked = d.message(); d.accept(); });
    await closeBtn().click();
    await page.waitForFunction((k) => document.querySelectorAll('.tabs .dtab:not([aria-label])').length === k, n - 1);
    assert.match(asked, /has changes that are not saved/);
    await page.locator('.tabs .dtab', { hasText: 'sample-copy.dxf' }).click();
  });

  await step('an empty tab: Apply disabled, Save and PDF say there is nothing yet', async () => {
    await t('new-tab').click();
    assert.equal(await t('apply').isDisabled(), true);
    await page.keyboard.press('Control+s');
    assert.match(await t('cmd-prompt').textContent(), /Nothing to save yet/);
    await t('pdf-open').click();
    assert.match(await t('cmd-prompt').textContent(), /Nothing to export/);
    assert.equal(await page.locator('[data-testid=pdf-dialog]').count(), 0);
    await page.locator('.tabs .dtab', { hasText: /^Drawing \d/ }).locator('.x').click();
    await page.locator('.tabs .dtab', { hasText: 'sample-copy.dxf' }).click();
  });

  // ---- editing: pick the outline by its chain, Keep only, size, Set length, undo, Save, Apply (fixtures/outline.dxf: a 100 × 60 plate)
  const sheetPx = async () => {
    const b = await page.locator('rect.sheet').boundingBox();
    const w = Number(await page.locator('[data-key=sheetW]').inputValue()), hh = Number(await page.locator('[data-key=sheetH]').inputValue());
    return { b, sc: b.width / w, h: hh };
  };
  /** The client position of a drawing point (mm from the sheet's bottom-left, y up). */
  const at = async (x, y) => { const { b, sc, h: hh } = await sheetPx(); return { x: b.x + x * sc, y: b.y + (hh - y) * sc }; };
  const click = async (x, y, opts = {}) => {
    const p = await at(x, y);
    if (opts.shift) await page.keyboard.down('Shift');
    try { await page.mouse.click(p.x, p.y); } finally { if (opts.shift) await page.keyboard.up('Shift'); }
  };
  const selCount = async () => (await t('sel-count').textContent()).trim();
  const waitSel = (txt) => page.waitForFunction((x) => document.querySelector('[data-testid=sel-count]').textContent.trim() === x, txt, { timeout: 8000 }).catch(async (e) => { throw new Error('waiting for ' + txt + ', it says ' + (await t('sel-count').textContent()) + ' / ' + (await t('cmd-prompt').textContent())); });
  // pixels of the drawing canvas close to the accent colour (the selection)
  const accentInk = () => t('drawing').evaluate((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, a = getComputedStyle(document.documentElement).getPropertyValue('--selection').trim();
    const n = parseInt(a.slice(1), 16), R = n >> 16, G = (n >> 8) & 255, B = n & 255;
    let k = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && Math.abs(d[i] - R) < 40 && Math.abs(d[i + 1] - G) < 40 && Math.abs(d[i + 2] - B) < 40) k++;
    return k;
  });
  const accentWhen = async (ok, ms = 10000) => {
    const end = Date.now() + ms;
    let n = await accentInk();
    while (!ok(n) && Date.now() < end) { await page.waitForTimeout(50); n = await accentInk(); }
    return n;
  };
  const sizeNow = async () => [await t('dw').inputValue(), await t('dh').inputValue()];
  const waitSize = (w, h2) => page.waitForFunction(([a, b]) => document.querySelector('[data-testid=dw]').value === a && document.querySelector('[data-testid=dh]').value === b, [w, h2]);
  const entitiesNow = async () => (await t('entities').textContent()).trim();

  await step('edit: a DXF tab gets the Drawing panel with W × H in mm; no selection, no Keep only', async () => {
    await t('picker').setInputFiles('fixtures/outline.dxf');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').textContent.startsWith('outline.dxf'));
    await inkedWhen((n) => n > 200);
    assert.equal(await t('drawing-panel').isVisible(), true);
    assert.deepEqual(await sizeNow(), ['136', '60'], 'the plate, the leader and the block: -20 to 116');
    assert.equal(await t('selrow').isVisible(), false);
    assert.equal(await entitiesNow(), 'Entities 15');
    assert.equal(await t('undo').isDisabled(), true);
    await page.locator('[data-tool=select]').click();
    assert.match(await t('cmd-hist').textContent(), /Command: SELECT/);
  });

  await step('edit: one click on the outline selects the whole loop (8 entities), drawn in the accent colour', async () => {
    assert.equal(await accentWhen((n) => n === 0), 0);
    await click(50, 0);
    await waitSel('8 selected');
    assert.ok((await accentWhen((n) => n > 150)) > 150, 'selection not drawn in the accent colour');
    assert.equal(await t('selrow').isVisible(), true);
    assert.match(await t('cmd-prompt').textContent(), /8 entities joined end to end selected/);
    await page.screenshot({ path: shotDir + '/s5-selected-light.png' });
  });

  await step('edit: Shift+click adds a shape and takes it out again; Esc clears; a click on empty space clears', async () => {
    await click(38, 30, { shift: true });              // the dial
    await waitSel('9 selected');
    await click(38, 30, { shift: true });
    await waitSel('8 selected');
    await page.keyboard.press('Escape');
    await waitSel('0 selected');
    assert.equal(await t('selrow').isVisible(), false);
    assert.equal(await accentWhen((n) => n === 0), 0, 'highlight gone');
    await click(50, 0); await waitSel('8 selected');
    await click(115, 45); await waitSel('0 selected');          // empty space
  });

  await step('edit: a shape inside, the leader that crosses the outline, and the block are each one thing', async () => {
    await click(38, 30); await waitSel('1 selected');            // the dial
    await click(-10, 30); await waitSel('1 selected');           // the leader: crosses the outline, joined to nothing
    await click(113, 10); await waitSel('1 selected');           // the block's line: the whole INSERT
    await page.keyboard.press('Escape');
  });

  await step('edit: dragging a box from empty space selects what lies fully inside it', async () => {
    const a = await at(-5, -5), b = await at(101, 61);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
    assert.equal(await t('rubber').isVisible(), true, 'the box is drawn while dragging');
    await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
    await waitSel('13 selected');                                // the plate and what is inside; not the leader or the block
    assert.equal(await t('rubber').isVisible(), false);
    await page.keyboard.press('Escape'); await waitSel('0 selected');
  });

  await step('edit: Delete removes the selection, Ctrl+Z brings it back, Ctrl+Y does it again; the tab is marked unsaved', async () => {
    await click(38, 30); await waitSel('1 selected');
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => document.querySelector('[data-testid=entities]').textContent.trim() === 'Entities 14');
    assert.match((await tabs()).at(-1), /^outline\.dxf •/);
    assert.equal(await selCount(), '0 selected');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => document.querySelector('[data-testid=entities]').textContent.trim() === 'Entities 15');
    await page.keyboard.press('Control+y');
    await page.waitForFunction(() => document.querySelector('[data-testid=entities]').textContent.trim() === 'Entities 14');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => document.querySelector('[data-testid=entities]').textContent.trim() === 'Entities 15');
  });

  await step('Select all: Ctrl+A and Edit → Select all pick every visible entity of a drawing (not while typing in an input); Delete then works; Ctrl+Z brings them back', async () => {
    await page.keyboard.press('Control+a');
    await waitSel('15 selected');
    await page.keyboard.press('Escape');
    await waitSel('0 selected');
    await page.locator('[data-menu=Edit]').click();
    assert.match(await page.getByRole('menuitem', { name: /^Select all/ }).textContent(), /Ctrl\+A/);
    await page.getByRole('menuitem', { name: /^Select all/ }).click();
    await waitSel('15 selected');
    await page.keyboard.press('Escape');
    await waitSel('0 selected');
    const cmd = cmdLine();
    await cmd.focus();                                           // typing in an input: Ctrl+A is the field's own, not Select all
    await page.keyboard.press('Control+a');
    assert.equal(await selCount(), '0 selected');
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Control+a');
    await waitSel('15 selected');
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => document.querySelector('[data-testid=entities]').textContent.trim() === 'Entities 0');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => document.querySelector('[data-testid=entities]').textContent.trim() === 'Entities 15');
  });

  await step('edit: Keep only this leaves just the outline; the size is the plate\'s 100 × 60', async () => {
    await click(50, 0); await waitSel('8 selected');
    await t('keep-only').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=entities]').textContent.trim() === 'Entities 8');
    await waitSize('100', '60');
    assert.equal(await t('selrow').isVisible(), false);
    assert.ok((await tabs()).at(-1).includes('•'), 'unsaved');
    assert.match(await t('cmd-prompt').textContent(), /Kept 8, removed 7/);
    assert.ok((await inkedWhen((n) => n > 150)) > 150);
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await inkedWhen((n) => n > 150);
    await page.screenshot({ path: shotDir + '/s5-kept-light.png' });
    await menuItem('View', 'Theme: dark');
    await inkedWhen((n) => n > 150);
    await page.waitForTimeout(150);
    await page.screenshot({ path: shotDir + '/s5-kept-dark.png' });
    await menuItem('View', 'Theme: light');
  });

  await step('edit: a typed width scales the drawing, the height follows, it stays at the sheet\'s bottom-left', async () => {
    await t('dw').fill('250'); await t('dw').press('Enter');
    await waitSize('250', '150');
    assert.match(await t('cmd-prompt').textContent(), /Scaled ×2\.5: now 250 × 150 mm/);
    await t('dh').fill('75'); await t('dh').press('Enter');
    await waitSize('125', '75');
    await t('dw').fill('abc'); await t('dw').press('Enter');
    assert.match(await t('cmd-prompt').textContent(), /Type the size in mm/);
    await waitSize('125', '75');
    // it stayed where it was: the plate's left edge is still at x 0 on the sheet and its right edge at 125
    const p0 = await at(0, 30), p1 = await at(125, 30), cb = await t('canvas').boundingBox();
    const inkAt = () => t('drawing').evaluate((c, pts) => {
      const k = c.width / c.clientWidth, ctx = c.getContext('2d');
      return pts.map(([x, y]) => ctx.getImageData(Math.round(x * k) - 3, Math.round(y * k) - 3, 7, 7).data.some((v, i) => i % 4 === 3 && v > 0));
    }, [[p0.x - cb.x, p0.y - cb.y], [p1.x - cb.x, p1.y - cb.y]]);
    const end = Date.now() + 10000;
    let ink = await inkAt();
    while (!(ink[0] && ink[1]) && Date.now() < end) { await page.waitForTimeout(50); ink = await inkAt(); }
    assert.deepEqual(ink, [true, true], 'the left edge is at 0 and the right at 125 on the sheet');
  });

  await step('edit: Set length: two points snap to ends, the real length scales the drawing', async () => {
    await t('set-length').click();
    assert.match(await t('cmd-prompt').textContent(), /click the first point/);
    await click(12.5, 0);                                      // the bottom line starts at 12.5 (10 × 1.25)
    assert.match(await t('cmd-prompt').textContent(), /now the second point/);
    await click(112.5 + 0.3, 0.2);                             // its other end, a little off: it snaps
    await page.waitForFunction(() => document.querySelector('[data-testid=len-row]') && !document.querySelector('[data-testid=len-row]').hidden);
    assert.equal((await t('measured').textContent()).trim(), '100 mm measured');
    await t('real-length').fill('50'); await t('real-length').press('Enter');
    await waitSize('62.5', '37.5');
    assert.equal(await t('len-row').isVisible(), false);
    assert.match(await t('cmd-prompt').textContent(), /Scaled ×0\.5: now 62\.5 × 37\.5 mm/);
    // Esc cancels a Set length in progress
    await t('set-length').click(); await click(6.25, 0); await page.keyboard.press('Escape');
    assert.match(await t('cmd-prompt').textContent(), /Set length cancelled/);
    assert.equal(await t('len-row').isVisible(), false);
  });

  await step('edit: Ctrl+Z walks back through the scaling and Keep only; Ctrl+Y forward again', async () => {
    await page.keyboard.press('Control+z'); await waitSize('125', '75');
    await page.keyboard.press('Control+z'); await waitSize('250', '150');
    await page.keyboard.press('Control+z'); await waitSize('100', '60');
    await page.keyboard.press('Control+z'); await waitSize('136', '60');
    assert.equal(await entitiesNow(), 'Entities 15');
    assert.equal(await t('undo').isDisabled(), true);
    await page.keyboard.press('Control+y'); await waitSize('100', '60');
    await t('redo').click(); await waitSize('250', '150');
    await page.keyboard.press('Control+Shift+z'); await waitSize('125', '75');
    await page.keyboard.press('Control+y'); await waitSize('62.5', '37.5');
    assert.equal(await t('redo').isDisabled(), true);
  });

  await step('edit: Unit fix ×25.4 / ÷25.4 scales the whole drawing in one undo step and says before → after', async () => {
    assert.match(await t('unit-up').getAttribute('title'), /Would give 1587\.50 × 952\.50 mm/);
    assert.match(await t('unit-down').getAttribute('title'), /Would give 2\.46 × 1\.48 mm/);
    await t('unit-up').click(); await waitSize('1587.5', '952.5');
    assert.match(await t('cmd-prompt').textContent(), /Unit fix ×25\.4 · 62\.50 × 37\.50 → 1587\.50 × 952\.50 mm/);
    const dir = process.env.SHOTS_DIR || 'shots';
    mkdirSync(dir, { recursive: true });
    await page.waitForTimeout(600);
    const checkToasts = async () => {
      const canvas = await t('canvas').boundingBox(), fade = await t('cmd-fade').boundingBox();
      assert.ok(Math.abs(fade.x + fade.width / 2 - canvas.x - canvas.width / 2) < 1, 'toasts centred in the canvas');
      assert.ok(fade.y + fade.height < canvas.y + canvas.height, 'toasts above the status bar');
      assert.equal(await t('cmd-fade').locator('.cb-fade-rows > div').evaluateAll((rows) => rows.length === 3 && rows.every((row) => {
        const css = getComputedStyle(row), panel = getComputedStyle(document.querySelector('.panel'));
        return css.opacity === '1' && css.color === panel.color && css.backgroundColor === panel.backgroundColor && css.borderTopStyle === 'solid' && parseFloat(css.borderTopWidth) >= 1;
      })), true, 'all three toast rows use opaque theme panel/text colours and a border');
    };
    await checkToasts();
    await page.screenshot({ path: dir + '/s11-51-light.png' });
    await page.locator('[data-menu=View]').click(); await page.getByRole('menuitemcheckbox', { name: new RegExp('Theme: dark' + '$') }).click();
    await page.waitForTimeout(150);
    await checkToasts();
    await page.screenshot({ path: dir + '/s11-51-dark.png' });
    await page.locator('[data-menu=View]').click(); await page.getByRole('menuitemcheckbox', { name: new RegExp('Theme: light' + '$') }).click();
    await t('unit-down').click(); await waitSize('62.5', '37.5');
    assert.match(await t('cmd-prompt').textContent(), /Unit fix ÷25\.4 · 1587\.50 × 952\.50 → 62\.50 × 37\.50 mm/);
    await page.keyboard.press('Control+z'); await waitSize('1587.5', '952.5');        // one undo step each
    await page.keyboard.press('Control+z'); await waitSize('62.5', '37.5');
    assert.equal(await t('undo').isDisabled(), false, 'the earlier steps are still there');
  });

  await step('edit: Save writes the edited drawing: 8 entities, 62.5 × 37.5, nothing else', async () => {
    const dl = await downloaded(() => page.keyboard.press('Control+s'));
    assert.equal(dl.name, 'outline-edited.dxf', 'the opened file is left alone: the first Save is a Save As');
    const doc = readDxf(dl.text), b = flatten(doc).boxes.model;
    assert.deepEqual(doc.entities.map((e) => e.type).sort(), ['ARC', 'ARC', 'ARC', 'ARC', 'LINE', 'LINE', 'LINE', 'LINE']);
    assert.deepEqual(b.map((v) => Math.round(v * 100) / 100), [0, 0, 62.5, 37.5]);
    assert.ok(!(await tabs()).at(-1).includes('•'), 'saved: no dot');
    const again = await downloaded(() => page.keyboard.press('Control+s'));
    assert.equal(again.name, 'outline-edited.dxf', 'later saves write the same file');
  });

  await step('edit: Add to layout puts the edited, scaled part (62.5 × 37.5) on a new layout', async () => {
    await closeTabs(/layout/);                                   // a fresh layout, not the earlier ones
    const before = (await tabs()).length;
    await t('add-to-layout').click();
    await page.waitForFunction((n) => document.querySelectorAll('.tabs .dtab:not([aria-label])').length === n, before + 1);
    assert.match((await tabs()).at(-1), /^outline-edited layout •/);
    assert.equal(await partText(), 'outline-edited · 62.5 × 37.5');
    const want = stepRepeat({ ...base, partW: 62.5, partH: 37.5 }).count;
    assert.equal(Number(await t('count').textContent()), want);
    const dl = await downloaded(() => page.keyboard.press('Control+s'));
    assert.equal(dl.name, 'outline-edited layout.dxf');
    const doc = readDxf(dl.text), ins = doc.entities.filter((e) => e.type === 'INSERT');
    assert.equal(ins.length, want);
    const one = flatten({ ...doc, entities: [ins[0]] }).boxes.model;
    const dims = [one[2] - one[0], one[3] - one[1]].map((v) => Math.round(v * 100) / 100).sort((x, y) => x - y);
    assert.deepEqual(dims, [37.5, 62.5], 'the copy is the edited part at true size');
    const blk = Object.entries(doc.blocks).find(([n]) => n === 'outline-edited');
    assert.equal(blk[1].entities.length, 8, 'only the outline is in the part');
  });

  await step('edit: tidy up the tabs', async () => {
    await closeTabs(/outline/);
    await page.locator('.tabs .dtab', { hasText: 'sample-copy.dxf' }).click();
    assert.ok(!(await tabs()).some((x) => x.startsWith('outline')));
  });

  // ---- drawing tabs and layout tabs, and Measure
  const fitsPanel = () => page.locator('aside.panel').evaluate((e) => e.scrollHeight <= e.clientHeight + 1);
  const vis = (id) => t(id).isVisible();
  const drawingTab = () => page.locator('.tabs .dtab', { hasText: /^outline\.dxf/ }).first();
  await step('view: a DXF opens on its own drawing tab: only Drawing scale, Outlines and Layers; no sheet, grippers or step and repeat; no Part | Layout switch', async () => {
    await t('picker').setInputFiles('fixtures/outline.dxf');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'outline.dxf');
    await inkedWhen((n) => n > 150);
    assert.equal(await t('mode-part').count(), 0); assert.equal(await t('mode-layout').count(), 0);
    assert.equal(await vis('drawing-panel'), true); assert.equal(await vis('outlines-panel'), true);
    assert.equal(await vis('sheet-panel'), false); assert.equal(await vis('step-panel'), false); assert.equal(await vis('parts-panel'), false);
    assert.equal(await vis('propbar'), false);
    assert.equal(await page.locator('rect.sheet').evaluate((r) => getComputedStyle(r.ownerSVGElement).visibility), 'hidden', 'no sheet outline');
    assert.deepEqual(await page.locator('.layer .nm').allTextContents(), ['0']);
    assert.equal(await page.locator('[data-tool=select]').getAttribute('class'), 'tool on', 'Select is the tool on a drawing');
    assert.equal(await page.locator('[data-testid=panel-main]').textContent(), 'Drawing');
    assert.ok(await fitsPanel(), 'panel fits on a drawing tab');
    // the drawing is fitted to the view: the 136 mm wide drawing fills most of the canvas
    const w = await t('canvas').boundingBox();
    assert.ok(await inkedWhen((n) => n > 150) > 150);
    assert.ok(await page.locator('[data-testid=zoom]').textContent().then((x) => parseInt(x) > 100), 'zoomed to the drawing, not the sheet');
    assert.ok(w.width > 500);
  });

  await step('view: edits on a drawing tab, then Add to layout: the layout tab has the sheet, grippers and step and repeat, no part tools', async () => {
    await closeTabs(/layout/);
    await click(50, 0); await waitSel('8 selected');
    await page.screenshot({ path: shotDir + '/s7-part-selected-light.png' });
    await menuItem('View', 'Theme: dark'); await page.waitForTimeout(150);
    await page.screenshot({ path: shotDir + '/s7-part-selected-dark.png' });
    await menuItem('View', 'Theme: light');
    await t('keep-only').click();
    await waitSize('100', '60');
    await t('add-to-layout').click();
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').dataset.kind === 'layout');
    assert.equal(await vis('drawing-panel'), false); assert.equal(await vis('sheet-panel'), true); assert.equal(await vis('step-panel'), true); assert.equal(await vis('parts-panel'), true);
    assert.equal(await vis('propbar'), true);
    assert.equal(await t('panel-main').textContent(), 'Layout');
    assert.equal(await partText(), 'outline · 100 × 60');
    assert.ok((await page.locator('.layer .nm').allTextContents()).includes('Parts'));
    assert.equal(await page.locator('[data-tool=step]').getAttribute('class'), 'tool on');
    assert.equal(await t('count').textContent(), String(stepRepeat({ ...base, partW: 100, partH: 60 }).count));
    // the part itself is drawn in every slot, and nothing of it is left off the sheet
    const inkIn = (sel) => page.evaluate((sel) => {
      const c = document.querySelector('[data-testid=drawing]'), cr = c.getBoundingClientRect(), k = c.width / cr.width;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, boxes = [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect());
      const n = boxes.map(() => 0); let out = 0;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        if (!d[(y * c.width + x) * 4 + 3]) continue;
        const px = cr.left + x / k, py = cr.top + y / k, i = boxes.findIndex((b) => px >= b.left - 3 && px <= b.right + 3 && py >= b.top - 3 && py <= b.bottom + 3);
        if (i < 0) out++; else n[i]++;
      }
      return { n, out };
    }, sel);
    await inkedWhen((n) => n > 500);
    const ink = await inkIn('[data-group=parts] .part-hit');
    assert.equal(ink.n.length, stepRepeat({ ...base, partW: 100, partH: 60 }).count);
    assert.ok(ink.n.every((x) => x > 50), 'every slot draws the part: ' + ink.n.join(','));
    assert.equal(ink.out, 0, 'no ink outside the slots');
    assert.equal(await page.locator('.part-body').count(), 0, 'no plain box over a drawn part');
    // keys that edit a drawing do nothing on a layout
    await page.keyboard.press('Control+z');
    assert.equal(await partText(), 'outline · 100 × 60');
    await drawingTab().click();
    await waitSize('100', '60');
    assert.equal(await entitiesNow(), 'Entities 8', 'the edits are still there');
    assert.equal(await t('undo').isDisabled(), false, 'and undoable');
  });

  await step('layouts: "+ New layout" and File → New layout; each layout has its own sheet settings; an empty drawing tab shows no sheet', async () => {
    await t('new-tab').click();
    assert.equal(await vis('sheet-panel'), false);
    assert.deepEqual(await page.locator('.layer .nm').allTextContents(), []);
    await t('new-layout').click();
    assert.equal(await page.locator('.tabs .dtab.on').getAttribute('data-kind'), 'layout');
    assert.match((await tabNames()).at(-1), /^Layout 1$/);
    assert.equal(await t('count').textContent(), '0');
    assert.equal(await partText(), 'No parts yet');
    assert.match(await t('step-hint').textContent(), /Pick a part to repeat over the sheet, or add parts from the Parts library/);
    assert.equal(await t('apply').isDisabled(), true);
    await t('preset').selectOption('a3');                                         // this layout's own sheet
    assert.equal(await page.locator('[data-key=sheetW]').inputValue(), '420');
    await menuItem('File', 'New layout');
    assert.match((await tabNames()).at(-1), /^Layout 2$/);
    assert.equal(await page.locator('[data-key=sheetW]').inputValue(), '1000', 'the new layout has its own sheet');
    await grip('Top').fill('12');
    await page.locator('.tabs .dtab', { hasText: /^Layout 1/ }).click();
    assert.equal(await page.locator('[data-key=sheetW]').inputValue(), '420');
    assert.equal(await grip('Top').inputValue(), '0');
    assert.equal(await t('preset').inputValue(), 'a3');
    assert.equal(await page.locator('rect.sheet').getAttribute('width'), '420');
    await page.locator('.tabs .dtab', { hasText: /^Layout 2/ }).click();
    assert.equal(await grip('Top').inputValue(), '12'); assert.equal(await t('preset').inputValue(), 'screen');
    assert.equal(await page.locator('rect.sheet').getAttribute('width'), '1000');
    assert.match(await t('cmd-prompt').textContent(), /./);
    await closeTabs(/^Layout \d/);
    await drawingTab().click();
    await closeTabs(/^Drawing \d/);
  });

  await step('measure: two clicks on end points give the distance, ΔX, ΔY and angle; a third click starts over; Esc clears', async () => {
    await page.locator('[data-tool=measure]').click();
    assert.match(await t('cmd-prompt').textContent(), /Measure: click the first point/);
    await click(10.2, 0.2);                                           // the bottom line's start, a little off: it snaps
    assert.match(await t('cmd-prompt').textContent(), /now the second point/);
    await click(89.8, -0.2);
    assert.equal((await t('cmd-prompt').textContent()).trim(), 'Distance 80 mm   ΔX 80   ΔY 0   Angle 0°');
    assert.ok((await accentWhen((n) => n > 100)) > 100, 'markers and the line are drawn');
    await page.screenshot({ path: shotDir + '/s7-measure-light.png' });
    await menuItem('View', 'Theme: dark'); await page.waitForTimeout(150);
    await page.screenshot({ path: shotDir + '/s7-measure-dark.png' });
    await menuItem('View', 'Theme: light');
    await click(100, 10);                                              // a third click: a new measure
    assert.match(await t('cmd-prompt').textContent(), /now the second point/);
    await click(90, 0);                                                // the arc's end (100,10) to the line's end (90,0)
    assert.match(await t('cmd-prompt').textContent(), /Distance 14\.14 mm   ΔX -10   ΔY -10   Angle 225°/);
    // Shift keeps the second point straight along X or Y from the first
    await click(100, 10); await click(60, 13, { shift: true });
    assert.match(await t('cmd-prompt').textContent(), /ΔY 0   Angle 180°/);
    await click(10, 0); await click(13, 40, { shift: true });
    assert.match(await t('cmd-prompt').textContent(), /ΔX 0   ΔY [\d.]+   Angle 90°/);
    await page.keyboard.press('Escape');
    assert.match(await t('cmd-prompt').textContent(), /Measure cleared/);
    assert.equal(await accentWhen((n) => n === 0), 0, 'the measure is gone from the canvas');
    // a layout tab has no drawing to measure: it says so
    await page.locator('.tabs .dtab[data-kind=layout]').first().click();
    await page.locator('[data-tool=measure]').click();
    assert.match(await t('cmd-prompt').textContent(), /Measure: open a drawing tab first/);
    await drawingTab().click();
    await page.locator('[data-tool=select]').click();
  });

  await step('snap toggle: Off measures the exact clicked point, On snaps to ends again; the state is shown', async () => {
    await page.locator('[data-tool=measure]').click();
    assert.equal(await t('tog-snap').getAttribute('aria-pressed'), 'true');
    await t('tog-snap').click();
    assert.equal(await t('tog-snap').getAttribute('aria-pressed'), 'false');
    assert.match(await t('cmd-prompt').textContent(), /Snap off/);
    await click(10.3, 0.5); await click(89.7, 0.5);
    const off = await t('cmd-prompt').textContent();
    assert.ok(!/Distance 80 mm/.test(off) && /Distance 79\.\d+ mm/.test(off), off);
    await t('tog-snap').click();
    assert.equal(await t('tog-snap').getAttribute('aria-pressed'), 'true');
    await click(10.3, 0.5); await click(89.7, 0.5);
    assert.match(await t('cmd-prompt').textContent(), /Distance 80 mm   ΔX 80   ΔY 0/);
    await page.keyboard.press('Escape');
    await page.locator('[data-tool=select]').click();
    await closeTabs(/^outline/);
    await page.locator('.tabs .dtab', { hasText: 'sample-copy.dxf' }).click();
  });

  await step('background: a picture under the drawing on its own dimmed layer; Set length / size scale it; not saved; Measure works on it', async () => {
    await t('picker').setInputFiles('fixtures/outline.dxf');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').textContent.startsWith('outline.dxf'));
    await t('bg-picker').setInputFiles('fixtures/bg.png');
    await page.waitForFunction(() => document.querySelector('[data-testid=bg-name]').textContent === 'bg.png');
    assert.ok((await page.locator('.layer .nm').allTextContents()).includes('Background'));
    assert.equal(await t('scale-target').isVisible(), true);
    assert.equal(await t('scale-target').inputValue(), 'drawing');
    assert.deepEqual(await sizeNow(), ['136', '60'], 'the drawing\'s size by default');
    assert.match(await t('cmd-prompt').textContent(), /400 × 200 px, shown at 96 dpi/);
    // it is not selectable: a click on empty picture picks nothing
    await click(20, 20); await waitSel('0 selected');
    await t('scale-target').selectOption('bg');
    await waitSize('105.83', '52.92');
    await t('dw').fill('200'); await t('dw').press('Enter');
    await waitSize('200', '100');
    assert.match(await t('cmd-prompt').textContent(), /Background scaled ×1\.8897\d*: now 200 × 100 mm/);
    assert.deepEqual(await sizeNow().then(() => t('scale-target').inputValue()), 'bg');
    await t('scale-target').selectOption('drawing');
    await waitSize('136', '60');                                   // the drawing is untouched
    await t('scale-target').selectOption('bg');
    // Set length on the picture: two clicks on its left and right edges (no snaps to the picture: exact points)
    await t('set-length').click(); await click(0, 50); await click(100, 50);
    await page.waitForFunction(() => /mm measured/.test(document.querySelector('[data-testid=measured]').textContent));
    await t('real-length').fill('50'); await t('real-length').press('Enter');
    await waitSize('100', '50');
    // dimmed: the picture's red border is drawn faintly; the layer's eye hides it
    const ink = await inkedWhen((n) => n > 200);
    await t('drawing').evaluate(() => {});
    const eye = page.locator('[data-layer=bg]');
    await eye.click();
    assert.ok((await inkedWhen((n) => n < ink)) < ink, 'hidden: less ink');
    await eye.click();
    await inkedWhen((n) => n >= ink);
    await page.keyboard.press('Control+z'); await waitSize('200', '100');
    // Measure on the picture itself (nothing to snap to there)
    await page.screenshot({ path: shotDir + '/s8-background-light.png' });
    const dl = await downloaded(() => page.keyboard.press('Control+s'));
    assert.ok(!/PNG|bg\.png/.test(dl.text), 'the DXF has no picture');
    assert.match(await t('cmd-prompt').textContent(), /The background picture is not saved in the DXF/);
    await menuItem('View', 'Theme: dark'); await page.waitForTimeout(150);
    await page.screenshot({ path: shotDir + '/s8-background-dark.png' });
    await menuItem('View', 'Theme: light');
    await t('bg-remove').click();
    assert.ok(!(await page.locator('.layer .nm').allTextContents()).includes('Background'));
    await page.locator('.tabs .dtab.on .x').click();
  });

  await step('background: in an empty tab it gets a tab of its own, the size fields are its size', async () => {
    await t('new-tab').click();
    await menuItem('File', 'Import background…');
    await t('bg-picker').setInputFiles('fixtures/bg.png');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').textContent.startsWith('bg.png'));
    assert.equal(await t('scale-target').isVisible(), false, 'only the picture: no choice to make');
    await waitSize('105.83', '52.92');
    await t('dh').fill('52.9'); await t('dh').press('Enter');
    await waitSize('105.8', '52.9');
    await page.locator('[data-tool=measure]').click();
    await page.mouse.click(300, 400); await page.mouse.click(500, 400);
    assert.match(await t('cmd-prompt').textContent(), /Distance \d+(\.\d+)? mm   ΔX \d+(\.\d+)?   ΔY 0   Angle 0°/, 'exact points: no snaps on a picture');
    await page.locator('[data-tool=select]').click();
    await page.locator('.tabs .dtab.on .x').click();
    await page.locator('.tabs .dtab', { hasText: 'sample-copy.dxf' }).click();
    await page.locator('[data-tool=step]').click();
  });

  await step('TODO 40: Trace bitmap: asks for a picture when there is none, previews, validates the layer name, traces at the picture\'s size, one undo', async () => {
    await t('new-tab').click();
    assert.equal(await t('bg-trace').isVisible(), false, 'no picture, no Trace button');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), menuItem('File', 'Trace bitmap…')]);
    await chooser.setFiles('fixtures/bg.png');
    const dlg = t('trace-dialog');
    await dlg.waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid=trace-dialog]').dataset.state === 'ready', null, { timeout: 60000 });
    assert.ok(Number(await dlg.getAttribute('data-count')) >= 2, 'the frame and the grid cells are outlines');
    assert.equal(await t('trace-mode-centreline').isDisabled(), true);
    assert.equal(await t('trace-mode-centreline').getAttribute('title'), 'Centreline: coming later');
    assert.equal(await t('trace-threshold').isDisabled(), false, 'two colours: the threshold works');
    assert.match(await t('trace-limit').textContent(), /reduced to 1000 px before tracing/);
    assert.match(await t('trace-stats').textContent(), /\d+ outlines? · \d+ points/);
    assert.equal(await t('trace-layer').inputValue(), 'Trace');
    assert.equal(await t('trace-apply').textContent(), 'Trace');
    // a control changes: the preview is out of date until Update preview
    await t('trace-colours').fill('3'); await t('trace-colours').press('Tab');
    assert.equal(await dlg.getAttribute('data-state'), 'stale');
    assert.equal(await t('trace-apply').isDisabled(), true);
    assert.equal(await t('trace-threshold').isDisabled(), true, 'more colours: no threshold');
    await t('trace-colours').fill('2'); await t('trace-colours').press('Tab');
    await t('trace-update').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=trace-dialog]').dataset.state === 'ready', null, { timeout: 60000 });
    // a bad layer name
    await t('trace-layer').fill('a<b');
    assert.equal(await t('trace-apply').isDisabled(), true);
    assert.match(await t('trace-layer-error').textContent(), /can't hold/);
    await t('trace-layer').fill('Trace');
    await page.screenshot({ path: shotDir + '/trace-dialog-light.png' });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await page.waitForTimeout(150);      // the dialog covers the menus
    await page.screenshot({ path: shotDir + '/trace-dialog-dark.png' });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; }); await page.waitForTimeout(150);
    await t('trace-cancel').click();
    assert.equal(await dlg.count(), 0, 'Cancel changes nothing');
    assert.ok(!(await page.locator('.layer .nm').allTextContents()).includes('Trace'));
    // the Trace… button and the command open it again; Esc closes it
    await t('bg-trace').click(); await dlg.waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await dlg.count(), 0);
    await typeCmd('trace'); await dlg.waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid=trace-dialog]').dataset.state === 'ready', null, { timeout: 60000 });
    await t('trace-apply').click();
    assert.equal(await dlg.count(), 0);
    assert.ok((await page.locator('.layer .nm').allTextContents()).includes('Trace'), 'the new layer');
    assert.match(await t('cmd-prompt').textContent(), /Trace: \d+ closed outlines? on the layer Trace/);
    // true size: the picture is 400 × 200 px at 96 dpi = 105.83 × 52.92 mm; the traced frame is that, within a pixel (0.27 mm) or two
    await t('scale-target').selectOption('drawing');
    await page.waitForFunction(() => Math.abs(parseFloat(document.querySelector('[data-testid=dw]').value) - 105.83) < 1, null, { timeout: 5000 });
    assert.ok(Math.abs(parseFloat(await t('dh').inputValue()) - 52.92) < 1, 'height');
    await page.waitForFunction(() => !document.querySelector('[data-testid=outlines]').textContent.includes('Reading the drawing'), null, { timeout: 30000 });
    await page.screenshot({ path: shotDir + '/trace-result-light.png' });
    await menuItem('View', 'Theme: dark'); await page.waitForTimeout(150);
    await page.screenshot({ path: shotDir + '/trace-result-dark.png' });
    await menuItem('View', 'Theme: light'); await page.waitForTimeout(150);
    // one undo takes the outlines and the layer away
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => ![...document.querySelectorAll('.layer .nm')].some((n) => n.textContent === 'Trace'));
    assert.equal(await t('scale-target').isVisible(), false, 'only the picture again');
    await closeTabs(/bg\.png/);
  });

  await step('TODO 64: Open keeps a fresh tab and its imported background after picking a tool without drawing', async () => {
    const originalName = await page.locator('.tabs .dtab.on .tname').textContent();
    await t('new-tab').click();
    await page.locator('[data-tool=line]').click();
    await page.keyboard.press('Escape');
    assert.equal(await t('entities').textContent(), 'Entities 0');
    await t('bg-picker').setInputFiles('fixtures/bg.png');
    await page.waitForFunction(() => document.querySelector('[data-testid=bg-name]').textContent === 'bg.png');
    const before = await tabNames(), keptName = before.at(-1);
    assert.equal(await page.locator('.tabs .dtab.on .dot').count(), 1, 'import marks the tab changed');
    await t('picker').setInputFiles('fixtures/overlay.dxf');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'overlay.dxf');
    assert.deepEqual(await tabNames(), [...before, 'overlay.dxf'], 'the background tab stays');
    await page.locator('.tabs .dtab', { hasText: keptName }).click();
    assert.equal(await t('bg-name').textContent(), 'bg.png');
    assert.ok((await page.locator('.layer .nm').allTextContents()).includes('Background'));
    assert.ok((await inkedWhen((n) => n > 200)) > 200, 'the picture is still drawn');
    await page.locator('.tabs .dtab', { hasText: 'overlay.dxf' }).last().click();
    await page.locator('.tabs .dtab.on .x').click();
    await closeTabs(new RegExp('^' + keptName + '\\b'));
    await page.locator('.tabs .dtab', { hasText: originalName }).click();
    await page.locator('[data-tool=step]').click();
    assert.deepEqual(await tabNames(), before.slice(0, -1), 'test tabs are closed');
  });

  await step('PDF: a vector PDF opens as a drawing (mm, page corner at 0,0), the outline is one click, Keep only, size, Save writes a DXF', async () => {
    await t('picker').setInputFiles('fixtures/vector.pdf');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').textContent.startsWith('vector.dxf'), null, { timeout: 60000 });
    assert.doesNotMatch((await tabs()).at(-1), /•/, 'a PDF opens clean: nothing to save yet');
    await page.locator('.tabs .dtab.on .x').click();             // closing it asks nothing (an unhandled dialog would hang here)
    await page.waitForFunction(() => ![...document.querySelectorAll('.tabs .dtab')].some((d) => d.textContent.startsWith('vector.dxf')));
    await t('picker').setInputFiles('fixtures/vector.pdf');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').textContent.startsWith('vector.dxf'), null, { timeout: 60000 });
    assert.match(await t('cmd-prompt').textContent(), /Opened vector\.pdf as a drawing \(page 1 of 1\): \d+ entities, 1 texts, 200 × 120 mm/);
    assert.equal(await page.locator('.tabs .dtab.on').getAttribute('data-kind'), 'drawing');
    await inkedWhen((n) => n > 150);
    assert.deepEqual(await sizeNow(), ['175', '80'], 'the drawing: 5 to 180, 20 to 100');
    await click(100, 20); await waitSel('8 selected');           // the plate's bottom edge: its four sides and four corners, nothing else
    await t('keep-only').click();
    await waitSize('160', '80');
    await page.screenshot({ path: shotDir + '/s9-pdf-light.png' });
    await menuItem('View', 'Theme: dark'); await page.waitForTimeout(150);
    await page.screenshot({ path: shotDir + '/s9-pdf-dark.png' });
    await menuItem('View', 'Theme: light');
    const dl = await downloaded(() => page.keyboard.press('Control+s'));
    assert.equal(dl.name, 'vector.dxf');
    const doc = readDxf(dl.text);
    assert.equal(doc.entities.length, 8);
    assert.deepEqual(flatten(doc).boxes.model.map((v) => Math.round(v * 100) / 100), [20, 20, 180, 100]);
    await page.locator('.tabs .dtab.on .x').click();
  });

  await step('PDF: one with no vector lines offers its page as a background picture', async () => {
    page.once('dialog', (dlg) => { assert.match(dlg.message(), /no vector lines/); dlg.accept(); });
    await t('picker').setInputFiles('fixtures/text-only.pdf');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').textContent.startsWith('text-only.pdf'), null, { timeout: 60000 });
    assert.equal(await t('bg-name').textContent(), 'text-only.pdf');
    assert.match(await t('cmd-prompt').textContent(), /page 1 of 1, true size from the PDF/);
    const [w, hh] = await sizeNow();
    assert.ok(Math.abs(+w - 200) < 0.5 && Math.abs(+hh - 120) < 0.5, `the page's size in mm: ${w} × ${hh}`);
    await inkedWhen((n) => n > 50);
    // and the same through Import background… on a drawing
    await page.locator('.tabs .dtab.on .x').click();
    await t('picker').setInputFiles('fixtures/outline.dxf');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').textContent.startsWith('outline.dxf'));
    await t('bg-picker').setInputFiles('fixtures/text-only.pdf');
    await page.waitForFunction(() => document.querySelector('[data-testid=bg-name]').textContent === 'text-only.pdf', null, { timeout: 60000 });
    assert.ok((await page.locator('.layer .nm').allTextContents()).includes('Background'));
    await page.locator('.tabs .dtab.on .x').click();
    await page.locator('.tabs .dtab', { hasText: 'sample-copy.dxf' }).click();
    await page.locator('[data-tool=step]').click();
  });

  await step('dimension: Keep (button or Enter) makes the measure a dimension on a Dimensions layer: one pickable thing, undoable, saved, re-labelled when the drawing is scaled', async () => {
    await t('picker').setInputFiles('fixtures/outline.dxf');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').textContent.startsWith('outline.dxf'));
    await page.locator('[data-tool=measure]').click();
    assert.equal(await t('meas-keep').isVisible(), false, 'nothing to keep yet');
    await click(50, 20); await click(80, 40);                              // the screen box's bottom-left and a corner across
    assert.match(await t('cmd-prompt').textContent(), /Distance 36\.06 mm   ΔX 30   ΔY 20   Angle 33\.69°/);
    assert.equal(await t('meas-keep').isVisible(), true);
    await t('meas-keep').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=entities]').textContent.trim() === 'Entities 16');
    assert.ok((await page.locator('.layer .nm').allTextContents()).includes('Dimensions'));
    assert.match(await t('cmd-prompt').textContent(), /Dimension kept: 36\.06 mm/);
    assert.equal(await t('meas-keep').isVisible(), false);
    // Enter keeps a second one
    await click(10, 0); await click(90, 0);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-testid=entities]').textContent.trim() === 'Entities 17');
    await page.screenshot({ path: shotDir + '/s10-dimension-light.png' });
    await menuItem('View', 'Theme: dark'); await page.waitForTimeout(150);
    await page.screenshot({ path: shotDir + '/s10-dimension-dark.png' });
    await menuItem('View', 'Theme: light');
    // one dimension is one thing for the select tool; Delete and Ctrl+Z
    await page.locator('[data-tool=select]').click();
    await click(65, 30); await waitSel('1 selected');
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => document.querySelector('[data-testid=entities]').textContent.trim() === 'Entities 16');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => document.querySelector('[data-testid=entities]').textContent.trim() === 'Entities 17');
    // saved, and scaled it says its new length
    let dl = await downloaded(() => page.keyboard.press('Control+s'));
    let doc = readDxf(dl.text);
    assert.ok(doc.layers.Dimensions && doc.blocks.PD_DIM_1 && doc.blocks.PD_DIM_2);
    assert.deepEqual(doc.entities.filter((e) => e.type === 'INSERT' && e.layer === 'Dimensions').length, 2);
    const labels = (d) => Object.values(d.blocks).flatMap((b) => b.entities).filter((e) => e.type === 'TEXT').map((e) => e.r.v[e.r.c.indexOf(1)]).sort();
    assert.deepEqual(labels(doc), ['36.06', '80.00']);
    await t('dw').fill('272'); await t('dw').press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-testid=dw]').value === '272');
    dl = await downloaded(() => page.keyboard.press('Control+s'));
    assert.deepEqual(labels(readDxf(dl.text)), ['160.00', '72.12'], 'twice the size: twice the numbers');
    // the status bar's decimal places re-label every kept dimension; Ctrl+Z undoes it
    assert.equal(await t('decimals').inputValue(), '2');
    await t('decimals').selectOption('1');
    assert.match(await t('cmd-prompt').textContent(), /Dimensions: 1 decimal place \(re-labelled in 1 drawing/);
    dl = await downloaded(() => page.keyboard.press('Control+s'));
    assert.deepEqual(labels(readDxf(dl.text)), ['160.0', '72.1']);
    await t('decimals').selectOption('0');
    dl = await downloaded(() => page.keyboard.press('Control+s'));
    assert.deepEqual(labels(readDxf(dl.text)), ['160', '72']);
    await page.keyboard.press('Control+z');
    dl = await downloaded(() => page.keyboard.press('Control+s'));
    assert.deepEqual(labels(readDxf(dl.text)), ['160.0', '72.1'], 'undone');
    await t('decimals').selectOption('2');
    assert.equal(await page.evaluate(() => localStorage.getItem('pd-decimals')), '2');
    await page.locator('.tabs .dtab.on .x').click();
    await page.locator('.tabs .dtab', { hasText: 'sample-copy.dxf' }).click();
    await page.locator('[data-tool=step]').click();
  });

  await step('Dimension tool, AutoCAD way: first point, second point, move the callout, third click places it (undoable, saved); select + drag moves it, the panel resizes its text', async () => {
    await t('picker').setInputFiles('fixtures/outline.dxf');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').textContent.startsWith('outline.dxf'));
    const count = async () => Number((await t('entities').textContent()).replace(/\D/g, ''));
    await page.waitForFunction(() => document.querySelector('[data-testid=entities]').textContent.trim() === 'Entities 15');
    const n0 = await count();
    const dims = async () => { const dl = await downloaded(() => page.keyboard.press('Control+s')); const doc = readDxf(dl.text); return { doc, ps: doc.entities.filter((e) => e.type === 'INSERT' && e.layer === 'Dimensions').map((e) => dimParams(doc.blocks[e.r.v[e.r.c.indexOf(2)]])) }; };
    await page.locator('[data-tool=dimension]').click();
    const ink0 = await accentInk();
    assert.match(await t('cmd-prompt').textContent(), /Dimension: first point/);
    await click(10, 0);
    assert.match(await t('cmd-prompt').textContent(), /Dimension: second point/);
    const mid = await at(60, 10);
    await page.mouse.move(mid.x, mid.y);                                   // the line follows the cursor
    await page.waitForTimeout(100);
    await click(90, 0);
    assert.match(await t('cmd-prompt').textContent(), /Dimension: move the line up or down and click to place it/);
    assert.equal(await count(), n0, 'nothing is made before the third click');
    const inkBefore = await accentInk();
    const low = await at(50, -15);
    await page.mouse.move(low.x, low.y);
    assert.ok(await accentWhen((n) => n > ink0 + 300) > ink0 + 300, 'the callout is drawn live in the accent colour');
    await page.screenshot({ path: shotDir + '/s11-dimension-preview-light.png' });
    await page.keyboard.press('Escape');                                   // Esc cancels
    assert.match(await t('cmd-prompt').textContent(), /Dimension cancelled/);
    assert.equal(await count(), n0);
    await click(10, 0); await click(90, 0); await click(50, -15);
    await page.waitForFunction((n) => Number(document.querySelector('[data-testid=entities]').textContent.replace(/\D/g, '')) === n, n0 + 1);
    assert.match(await t('cmd-prompt').textContent(), /Dimension placed: 80\.00 mm/);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: shotDir + '/s11-dimension-light.png' });
    await menuItem('View', 'Theme: dark'); await page.waitForTimeout(150);
    await page.screenshot({ path: shotDir + '/s11-dimension-dark.png' });
    await menuItem('View', 'Theme: light');
    await page.keyboard.press('Control+z');
    await page.waitForFunction((n) => Number(document.querySelector('[data-testid=entities]').textContent.replace(/\D/g, '')) === n, n0);
    await page.keyboard.press('Control+y');
    await page.waitForFunction((n) => Number(document.querySelector('[data-testid=entities]').textContent.replace(/\D/g, '')) === n, n0 + 1);
    let r = await dims();
    assert.equal(r.ps.length, 1);
    assert.ok(Math.abs(r.ps[0].offset + 15) < 0.7, 'the callout was placed 15 mm below: ' + r.ps[0].offset);
    assert.ok(Math.abs(Math.abs(r.ps[0].b[0] - r.ps[0].a[0]) - 80) < 1e-6);
    // select it (one thing) and drag its line down 10 mm
    await page.locator('[data-tool=select]').click();
    await click(50, -15); await waitSel('1 selected');
    assert.equal(await t('dim-row').isVisible(), true);
    const from = await at(50, -15), to = await at(50, -25);
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(from.x, (from.y + to.y) / 2, { steps: 4 }); await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.screenshot({ path: shotDir + '/s11-dimension-drag-light.png' });
    await page.mouse.up();
    await page.waitForFunction((n) => Number(document.querySelector('[data-testid=entities]').textContent.replace(/\D/g, '')) === n, n0 + 1);
    assert.match(await t('cmd-prompt').textContent(), /Dimension moved/);
    r = await dims();
    assert.equal(r.ps.length, 1);
    assert.ok(Math.abs(r.ps[0].offset + 25) < 0.7, 'dragged to 25 mm below: ' + r.ps[0].offset);
    assert.equal(await t('sel-count').textContent(), '1 selected', 'still selected');
    await page.keyboard.press('Control+z');
    r = await dims();
    assert.ok(Math.abs(r.ps[0].offset + 15) < 0.7, 'undone');
    // the text height in the panel
    await click(50, -15); await waitSel('1 selected');
    const h0 = Number(await t('dim-height').inputValue());
    assert.equal(h0, 3.5, 'the Standard style text height');
    await t('dim-height').fill('3'); await t('dim-height').press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-testid=cmd-prompt]').textContent.includes('text height 3'));
    r = await dims();
    assert.ok(Math.abs(r.ps[0].textH - 3) < 1e-6 && Math.abs(r.ps[0].offset + 15) < 0.7, 'height 3, same place');
    const tx = Object.values(r.doc.blocks).flatMap((b) => b.entities).find((e) => e.type === 'TEXT');
    assert.equal(+tx.r.v[tx.r.c.indexOf(40)], 3);
    await page.screenshot({ path: shotDir + '/s11-dimension-text-light.png' });
    await typeCmd('d');                                        // D picks the Dimension tool
    assert.equal(await page.locator('[data-tool=dimension].on').count(), 1);
    await page.locator('.tabs .dtab.on .x').click();
    await page.locator('.tabs .dtab', { hasText: 'sample-copy.dxf' }).click();
    await page.locator('[data-tool=step]').click();
  });

  await step('part PDF: on Part the dialog offers the part alone three ways: cut to the part 1:1, tiled on A4 / A3, scaled to one page (not 1:1)', async () => {
    await t('picker').setInputFiles('fixtures/outline.dxf');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').textContent.startsWith('outline.dxf'));
    await t('bg-picker').setInputFiles('fixtures/bg.png');                 // a background must stay out of the PDF
    await page.waitForFunction(() => document.querySelector('[data-testid=bg-name]').textContent === 'bg.png');
    await page.locator('[data-tool=measure]').click();
    await click(10, 0); await click(90, 0); await t('meas-keep').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=entities]').textContent.trim() === 'Entities 16');
    await page.locator('[data-tool=select]').click();
    await t('pdf-open').click(); await dialog.waitFor();
    assert.equal(await t('pdf-tab-batch').isVisible(), false, 'no folder tab for one part');
    assert.equal(await t('pdf-page-sheet').isChecked(), true);
    const labels = (await dialog.locator('.pd-left label').allTextContents()).map((x) => x.replace(/\s+/g, ' ').trim());
    assert.match(labels[0], /^Page cut to the part, 1:1 [\d.]+ × [\d.]+ \+ 10 mm border$/);
    assert.match(labels[1], /^Tile 1:1 on A3A4 pages 1 × 1 tiles$/);
    assert.match(labels[2], /^Scaled to fit one A4A3A0 page/);
    assert.equal(await t('pdf-scale').isVisible(), false, 'the scale line is not shown until Scaled is picked');
    await t('pdf-page-check').check();
    assert.equal(await t('pdf-scale').isVisible(), true); const scaled = (await dialog.locator('.pd-left label').nth(2).textContent()).replace(/\s+/g, ' ').trim();
    assert.match(scaled, /^Scaled to fit one A4A3A0 page not 1:1 · scale [\d.]+ : 1$|^Scaled to fit one A4A3A0 page not 1:1 · scale 1 : [\d.]+$/);
    await t('pdf-page-sheet').check();
    assert.deepEqual(await t('pdf-check-paper').locator('option').allTextContents(), ['A4', 'A3', 'A0']);
    assert.equal(await dialog.locator('legend').allTextContents().then((x) => x.join()), 'Page,Title block,Film,Label', 'no pages-per-colour, no crop or registration marks');
    assert.equal(await t('pdf-foot').textContent(), 'outline.pdf');
    const sz = /^([\d.]+) × ([\d.]+) \+ 10 mm border$/.exec(await t('pdf-sheet-size').textContent());
    assert.ok(sz, 'says the part size and the border: ' + await t('pdf-sheet-size').textContent());
    const w = Number(sz[1]) + 20, h2 = Number(sz[2]) + 20;                    // the page is the part plus the border all round
    assert.ok(Math.abs(w - 156) < 0.2 && h2 > 75 && h2 < 90, `the part plus the border: ${w} × ${h2}`);
    await page.screenshot({ path: shotDir + '/s11-part-pdf-light.png' });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await page.waitForTimeout(250);
    await page.screenshot({ path: shotDir + '/s11-part-pdf-dark.png' });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    // 1: cut to the part
    let dl = await downloaded(() => t('pdf-go').click());
    assert.equal(dl.name, 'outline.pdf');
    let tx = pdfText(dl);
    assert.equal(boxes(tx).length, 1);
    assert.ok(Math.abs(boxes(tx)[0][0] - w) < 0.2 && Math.abs(boxes(tx)[0][1] - h2) < 0.2, 'the page is the part: ' + boxes(tx)[0]);
    assert.match(tx, /\(80\.00\) Tj/, 'the dimension\'s number');
    assert.ok(!/\/Image|\/XObject/.test(tx), 'no background picture');
  });

  await step('part PDF: tiled on A4, and scaled to fit A0 / A3 / A4 with its scale stated; the layout dialog is unchanged', async () => {
    await t('pdf-open').click(); await dialog.waitFor();
    await t('pdf-tile-paper').selectOption('A4');
    assert.equal(await t('pdf-page-tile').isChecked(), true);
    let dl = await downloaded(() => t('pdf-go').click());
    let tx = pdfText(dl);
    assert.equal(boxes(tx).length, 1);
    const [a, b2] = boxes(tx)[0].sort((x, y) => x - y);
    assert.ok(Math.abs(a - 210) < 0.2 && Math.abs(b2 - 297) < 0.2, 'an A4 page: ' + boxes(tx)[0]);
    assert.match(tx, /Tile 1\/1/);
    for (const [paper, wide, high] of [['A0', 1189, 841], ['A3', 420, 297], ['A4', 297, 210]]) {
      await t('pdf-open').click(); await dialog.waitFor();
      await t('pdf-check-paper').selectOption(paper);
      assert.equal(await t('pdf-page-check').isChecked(), true);
      dl = await downloaded(() => t('pdf-go').click());
      tx = pdfText(dl);
      const bx = boxes(tx)[0].sort((x, y) => x - y);
      assert.ok(Math.abs(bx[1] - wide) < 0.3 && Math.abs(bx[0] - high) < 0.3, `${paper}: ${bx}`);
      assert.match(tx, /NOT 1:1/); assert.match(tx, /not 1:1, not to be used as film/); assert.match(tx, /\(80\.00\) Tj/);
    }
    // the same file on Layout: the layout dialog, as it was
    await t('add-to-layout').click();
    await t('pdf-open').click(); await dialog.waitFor();
    assert.equal(await t('pdf-tab-batch').isVisible(), true);
    assert.equal(await dialog.locator('legend').allTextContents().then((x) => x.join()), 'Page,Title block,Film,Pages,Marks');
    await t('pdf-close').click(); await dialog.waitFor({ state: 'detached' });
    await closeTabs(/^outline/);
  });

  // ---- Round 3: extract a part, the Parts library, a layout of several parts, step and repeat per layout, saving and reopening a layout
  const libCard = (name) => page.locator(`[data-testid=lib-list] .card[data-name="${name}"]`);
  const libNames = () => page.locator('[data-testid=lib-list] .card .cname').allTextContents();
  const nameDlg = page.locator('[data-testid=name-dialog]');
  const ctxItems = () => page.locator('[data-testid=ctx-menu] .mi').allTextContents();
  /** A screenshot of a screen light and dark: show() opens what is to be seen, hide() puts it away again. */
  const shotBoth = async (name, show = async () => {}, hide = async () => {}) => {
    await show(); await page.waitForTimeout(250); await page.screenshot({ path: `${shotDir}/s12-${name}-light.png` }); await hide();
    await menuItem('View', 'Theme: dark'); await show(); await page.waitForTimeout(300); await page.screenshot({ path: `${shotDir}/s12-${name}-dark.png` }); await hide();
    await menuItem('View', 'Theme: light'); await page.waitForTimeout(100);
  };
  const partRows = () => page.locator('[data-testid=part-rows] .prow').evaluateAll((rs) => rs.map((r) => [...r.querySelectorAll('.nm, .mono')].map((x) => x.textContent).join('|')));

  await step('extract: outlines are listed; right-click an outline → Extract part…; the name is pre-filled "<file> 1" and selected; Save to library', async () => {
    await closeTabs(/./);
    assert.deepEqual(await tabNames(), ['Drawing 1']);
    await t('picker').setInputFiles('fixtures/outline.dxf');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'outline.dxf');
    await inkedWhen((n) => n > 150);
    await page.locator('[data-tool=select]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=outlines] .orow').length > 0);
    assert.match(await page.locator('[data-testid=outlines] .orow').first().textContent(), /Outline 1.*100 × 60/, 'the biggest outline first');
    assert.equal(await t('sel-name').textContent(), 'Nothing selected');
    assert.equal(await t('bar-extract').isDisabled(), true); assert.equal(await t('bar-keep').isDisabled(), true);
    await click(50, 0); await waitSel('8 selected');
    assert.equal(await t('selbar').isVisible(), true);
    assert.equal(await t('sel-name').textContent(), 'Outline 1');
    assert.equal(await t('sel-layer').textContent(), 'layer 0');
    assert.equal(await t('sel-w').inputValue(), '100.00'); assert.equal(await t('sel-h').inputValue(), '60.00');
    assert.equal(await t('sel-area').textContent(), 'Area 5914.16 mm² · Perimeter 302.82 mm', 'TODO 31: 100 × 60, r 10, less its two small gaps');
    assert.deepEqual(await page.locator('[data-testid=selbar] .btn').allTextContents(), ['Keep only', 'Extract part…']);
    const p = await at(50, 0);
    await shotBoth('extract-menu', async () => { await page.mouse.click(p.x, p.y, { button: 'right' }); await page.waitForSelector('[data-testid=ctx-menu]'); }, async () => { await page.keyboard.press('Escape'); });
    await page.mouse.click(p.x, p.y, { button: 'right' });
    assert.deepEqual(await ctxItems(), ['Extract part…', 'Keep only this', 'Measure from here', 'Delete']);
    await page.getByRole('menuitem', { name: 'Extract part…' }).click();
    await nameDlg.waitFor();
    assert.equal(await nameDlg.getAttribute('aria-label'), 'Extract part');
    assert.equal(await t('name-input').inputValue(), 'outline 1');
    assert.deepEqual(await t('name-input').evaluate((e) => [e.selectionStart, e.selectionEnd, document.activeElement === e]), [0, 9, true], 'the name is selected');
    assert.deepEqual(await nameDlg.locator('.row.lbl').allTextContents(), ['Size100.00 × 60.00 mm1:1', 'Saves toParts library']);
    assert.deepEqual(await nameDlg.locator('.btn').allTextContents(), ['Cancel', 'Save to library']);
    await page.screenshot({ path: shotDir + '/s12-extract-dialog-light.png' });
    await page.keyboard.press('Escape'); await nameDlg.waitFor({ state: 'detached' });
    await menuItem('View', 'Theme: dark');
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Extract part…' }).click();
    await nameDlg.waitFor(); await page.waitForTimeout(250);
    await page.screenshot({ path: shotDir + '/s12-extract-dialog-dark.png' });
    await t('name-input').fill(''); await t('name-ok').click();
    assert.equal(await t('name-error').textContent(), 'Type a name');
    await t('name-input').evaluate((e) => { e.focus(); e.select(); });
    await page.keyboard.type('Plate A');                                         // typing replaces the selected name
    assert.equal(await t('name-input').inputValue(), 'Plate A');
    await page.keyboard.press('Enter');
    await nameDlg.waitFor({ state: 'detached' });
    await menuItem('View', 'Theme: light');
    assert.match(await t('cmd-prompt').textContent(), /Part Plate A saved to the Parts library: 100\.00 × 60\.00 mm/);
    assert.equal(await page.locator('[data-testid=outlines] .orow .chip').count(), 1, 'the outline is marked saved');
    assert.equal(await page.locator('[data-testid=outlines] .orow .chip').textContent(), 'saved');
  });

  await step('extract: a selection with a kept dimension is sized without it; a taken name is refused; the command line and the dial work too', async () => {
    await page.locator('[data-tool=measure]').click();
    await click(50, 20); await click(80, 40); await t('meas-keep').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=entities]').textContent.trim() === 'Entities 16');
    await page.locator('[data-tool=select]').click();
    const a = await at(-5, -5), b = await at(101, 61);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
    await page.waitForFunction(() => Number(document.querySelector('[data-testid=sel-count]').textContent.replace(/\D/g, '')) >= 14);
    assert.equal(await t('sel-w').inputValue(), '100.00', 'the dimension is not part of the part');
    await t('extract').click();                                                  // the Outlines section's button
    await nameDlg.waitFor();
    assert.equal(await t('name-input').inputValue(), 'outline 1', 'the first free number: the library only has Plate A');
    await t('name-input').fill('plate a');
    await t('name-ok').click();
    assert.match(await t('name-error').textContent(), /already in the library/);
    assert.equal(await nameDlg.count(), 1, 'the dialog stays');
    await t('name-input').fill('Plate B'); await page.keyboard.press('Enter');
    await nameDlg.waitFor({ state: 'detached' });
    await page.keyboard.press('Escape');                                         // clears the selection
    await click(30, 22); await waitSel('1 selected');                              // the dial's lower edge
    assert.equal(await t('sel-w').inputValue(), '16.00');
    await cmdLine().fill('extract'); await cmdLine().press('Enter');
    await nameDlg.waitFor();
    await page.keyboard.type('Dial'); await page.keyboard.press('Enter');
    await nameDlg.waitFor({ state: 'detached' });
    await page.waitForFunction(() => /Part Dial saved to the Parts library/.test(document.querySelector('[data-testid=cmd-prompt]').textContent));
  });

  await step('Parts library: a card per part with thumbnail, name and W × H; search; rename; Export .dxf; delete; kept inside the app (a reload keeps them)', async () => {
    await t('panel-library').click();
    assert.equal(await t('library').isVisible(), true);
    assert.deepEqual(await libNames(), ['Plate A', 'Plate B', 'Dial']);
    assert.equal(await t('lib-size').nth(0).textContent(), '100.00 × 60.00');
    assert.equal(await t('lib-size').nth(1).textContent(), '100.00 × 60.00', 'the kept dimension is not in the part');
    assert.deepEqual(await page.locator('[data-testid=lib-list] .card img.thumb').evaluateAll((im) => im.map((i) => [i.src.slice(0, 22), i.naturalWidth > 0])), [['data:image/png;base64,', true], ['data:image/png;base64,', true], ['data:image/png;base64,', true]]);
    assert.match(await t('lib-foot').textContent(), /^3 parts · saved inside the app\. Drag a card onto the sheet, or Add to sheet\.$/);
    assert.deepEqual(await libCard('Plate A').locator('.btn, .tog').allTextContents(), ['Add to sheet', '⋯']);
    assert.equal(await libCard('Plate A').locator('.lbl').last().textContent(), 'outline.dxf');
    await t('lib-search').fill('PLATE'); assert.deepEqual(await libNames(), ['Plate A', 'Plate B']);
    await t('lib-search').fill('zzz'); assert.deepEqual(await libNames(), []);
    await t('lib-search').fill(''); assert.equal((await libNames()).length, 3);
    const openMenu = (name) => libCard(name).locator('[data-testid=lib-menu]').click();
    await shotBoth('library', async () => { await openMenu('Plate B'); await page.waitForSelector('[data-testid=ctx-menu]'); }, async () => { await page.keyboard.press('Escape'); });
    await openMenu('Plate B');
    assert.deepEqual(await ctxItems(), ['Add to sheet', 'Export .dxf…', 'Rename…', 'Delete from library']);
    await page.getByRole('menuitem', { name: 'Rename…' }).click();
    await nameDlg.waitFor();
    assert.equal(await nameDlg.getAttribute('aria-label'), 'Rename part');
    assert.equal(await t('name-input').inputValue(), 'Plate B');
    await page.keyboard.type('Plate C'); await page.keyboard.press('Enter');
    await nameDlg.waitFor({ state: 'detached' });
    assert.deepEqual(await libNames(), ['Plate A', 'Plate C', 'Dial']);
    // Export .dxf: a download of the part alone
    const dl = await downloaded(async () => { await openMenu('Plate C'); await page.getByRole('menuitem', { name: 'Export .dxf…' }).click(); });
    assert.equal(dl.name, 'Plate C.dxf');
    assert.ok(/^[\x00-\x7f]*$/.test(dl.text), 'ASCII only');
    const exp = readDxf(dl.text);
    assert.ok(exp.entities.length > 0 && exp.entities.every((e) => e.layer !== 'Dimensions'), 'no dimension in the part');
    assert.deepEqual(flatten(exp).boxes.model.map((v) => Math.round(v * 100) / 100), [0, 0, 100, 60]);
    // Delete from library (asks first)
    let asked = '';
    page.once('dialog', (d) => { asked = d.message(); d.accept(); });
    await openMenu('Plate C'); await page.getByRole('menuitem', { name: 'Delete from library' }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=lib-list] .card').length === 2);
    assert.match(asked, /Delete "Plate C" from the Parts library\?/);
    assert.deepEqual(await libNames(), ['Plate A', 'Dial']);
    await page.waitForFunction(() => /Plate C deleted from the Parts library/.test(document.querySelector('[data-testid=cmd-prompt]').textContent));     // storage done
    // saved inside the app: a reload keeps them
    await page.reload(); await page.waitForSelector('[data-testid=count]', { state: 'attached' });
    await t('panel-library').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=lib-list] .card').length === 2);
    assert.deepEqual(await libNames(), ['Plate A', 'Dial']);
    assert.equal(await t('lib-size').nth(0).textContent(), '100.00 × 60.00');
  });

  await step('Add to sheet and a drag from the library: placed parts of different parts on one layout; the drop shows its position', async () => {
    await t('new-layout').click();
    assert.equal(await t('library').isVisible(), false, 'a new layout shows its own panel');
    assert.equal(await t('placed-name').textContent(), 'Layout · Layout 1');
    assert.equal(await t('placed-kind').textContent(), 'its own tab, not tied to one drawing');
    assert.equal(await t('parts-from').textContent(), 'Parts from: none yet');
    assert.equal(await t('px').isVisible(), false, 'no part placed yet: the bar is about the layout');
    await t('panel-library').click();
    assert.equal(await t('placed-name').textContent(), 'Parts library');
    assert.equal(await t('placed-kind').textContent(), 'drag a part onto the sheet, or press Add to sheet');
    await libCard('Plate A').locator('[data-testid=lib-add]').click();
    assert.match(await t('cmd-prompt').textContent(), /Plate A \(100\.00 × 60\.00 mm\) added to Layout 1/);
    await t('panel-main').click();
    assert.equal(await t('placed-name').textContent(), 'Plate A');
    assert.equal(await t('px').isVisible(), true);
    assert.deepEqual([await t('px').inputValue(), await t('py').inputValue(), await t('pw').inputValue(), await t('ph').inputValue(), await t('pa').inputValue()], ['450.00', '320.00', '100.00', '60.00', '0°']);
    assert.equal(await t('placed-kind').textContent(), 'placed part');
    assert.ok((await inkedWhen((n) => n > 100)) > 100, 'the part is drawn');
    await t('panel-library').click();
    // drag the Dial card onto the sheet: the hint shows where it lands
    const id = await libCard('Dial').getAttribute('data-part-id'), to = await at(200, 150);
    const fire = (type) => page.evaluate(([ty, x, y, pid]) => {
      const dt = new DataTransfer(); dt.setData('application/x-pd-part', pid); dt.setData('text/plain', 'Dial');
      const e = new DragEvent(ty, { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true });
      (document.querySelector('[data-testid=canvas]')).dispatchEvent(e);
    }, [type, to.x, to.y, id]);
    await fire('dragover');
    assert.equal(await t('drop-hint').isVisible(), true);
    const hint = (await t('drop-hint').textContent()).match(/^Drop to place at X (-?[\d.]+) Y (-?[\d.]+) mm$/);
    assert.ok(hint && Math.abs(hint[1] - 200) < 2 && Math.abs(hint[2] - 150) < 2, await t('drop-hint').textContent());
    await fire('drop');
    assert.match(await t('cmd-prompt').textContent(), /on whole mm. Shift-drag keeps it straight/);
    assert.equal(await t('drop-hint').isVisible(), false);
    await t('panel-main').click();
    assert.equal(await t('placed-name').textContent(), 'Dial');
    assert.equal(await t('parts-from').isVisible(), false);
    const mid = [Number(await t('px').inputValue()) + Number(await t('pw').inputValue()) / 2, Number(await t('py').inputValue()) + Number(await t('ph').inputValue()) / 2];
    assert.ok(Math.abs(mid[0] - hint[1]) <= 0.51 && Math.abs(mid[1] - hint[2]) <= 0.51, 'centred on the drop point the hint showed, to whole mm (TODO 45): ' + mid + ' vs ' + hint.slice(1));
    assert.ok(Number(await t('px').inputValue()) % 1 === 0 && Number(await t('py').inputValue()) % 1 === 0, 'the dropped part sits on whole mm');
    const rows = await partRows();
    assert.equal(rows.length, 2); assert.match(rows[0], /^Plate A\|100 × 60 · 1 copy$/); assert.match(rows[1], /^Dial\|[\d.]+ × [\d.]+ · 1 copy$/);
    assert.equal(await page.locator('[data-testid=part-rows] .prow').first().locator('[data-part-remove]').getAttribute('aria-label'), 'Take Plate A off this layout');
    await t('panel-library').click();
    await shotBoth('layout');
  });

  await step('step and repeat per layout: pick the part; Fit to sheet on works out rows × columns, off lets them be typed (it may not fit, and says so); Apply makes them placed parts', async () => {
    await t('panel-main').click();
    await t('part').selectOption({ label: 'Plate A · 100 × 60' });
    const worked = gridOf(layoutFromRaw(readDxf((await downloaded(() => page.keyboard.press('Control+s'))).text)));
    assert.equal(await t('count').textContent(), String(worked.count));
    assert.equal(await t('fit-switch').isChecked(), true); assert.equal(await t('fit-state').textContent(), 'On');
    const rows = page.locator('[data-key=rows]'), cols = page.locator('[data-key=cols]');
    assert.equal(await rows.evaluate((e) => e.readOnly), true);
    assert.equal(await rows.inputValue(), String(worked.rows)); assert.equal(await cols.inputValue(), String(worked.cols));
    assert.equal(await rows.locator('xpath=..').textContent().then((x) => x.trim()), 'Rows');
    assert.match(await t('grid').textContent(), new RegExp(worked.skipped ? `^fit · ${worked.count} copies` : `^fit · ${worked.cols} × ${worked.rows}`));
    // off: typed by hand, starting from what was worked out
    await t('fit-switch').click();
    assert.equal(await t('fit-state').textContent(), 'Off');
    assert.equal(await rows.evaluate((e) => e.readOnly), false);
    assert.equal(await rows.inputValue(), String(worked.rows), 'typing starts from the worked-out numbers');
    assert.equal(await rows.locator('xpath=..').textContent().then((x) => x.trim()), 'Rows');
    await rows.fill('2'); await cols.fill('3');
    let want = stepRepeat({ ...base, partW: 100, partH: 60, fit: false, rows: 2, cols: 3 });
    assert.equal(await t('count').textContent(), '6');
    assert.equal(await t('grid').textContent(), 'placed · 3 × 2');
    assert.equal(await t('pct').textContent(), Math.round(want.usedPct) + '% of sheet');
    assert.equal(await t('fit-note').isVisible(), false);
    assert.equal(await page.locator('[data-group=parts] .part-hit').count(), 6 + 2, 'the grid and the two placed parts');
    await shotBoth('step-fit-off');
    // too many for the sheet: it says so, and still shows what it would be
    await rows.fill('40');
    assert.equal(await t('count').textContent(), '120');
    assert.equal(await t('fit-note').isVisible(), true);
    assert.match(await t('fit-note').textContent(), /^Does not fit: the grid is 310 × 2\d\d\d mm, the usable area 1000 × 670 mm\.$/);
    assert.match(await t('cmd-prompt').textContent(), /Does not fit the usable area/);
    await rows.fill('2');
    // rotate and an extra gap keep working
    await t('rotate').selectOption('90');
    assert.equal(await t('grid').textContent(), 'placed · 3 × 2 · 90°');
    await t('rotate').selectOption('0');
    await page.locator('[data-gap=r1]').click({ force: true, position: { x: 30, y: 5 } });
    await page.keyboard.type('12');
    assert.equal(await page.locator('[data-gap-row=r1]').count(), 1);
    assert.equal(await t('count').textContent(), '6');
    want = stepRepeat({ ...base, partW: 100, partH: 60, fit: false, rows: 2, cols: 3, extraRows: [{ after: 1, mm: 12 }] });
    assert.equal(Math.round(want.gridH), 60 + 5 + 12 + 60);
    // Apply: the copies become placed parts of their own and the grid is empty again
    await t('apply').click();
    assert.equal(await t('count').textContent(), '0');
    assert.equal(await t('part').evaluate((s) => s.value), '', 'no grid part');
    assert.match(await t('cmd-prompt').textContent(), /6 copies of Plate A are now placed parts of their own/);
    const after = await partRows();
    assert.match(after[0], /^Plate A\|100 × 60 · 7 copies$/);
    assert.equal(await page.locator('[data-group=parts] .part-hit').count(), 8);
  });

  let saved = null;
  await step('Save a layout: a download with one INSERT per placed part and the settings in a hidden block; reopening it gives a layout tab with the same panel values and parts', async () => {
    await t('preset').selectOption('a3');
    await grip('Top').fill('12'); await grip('Left').fill('8');
    await page.locator('[data-key=gapX]').fill('7'); await page.locator('[data-key=gapY]').fill('9');
    await t('rotate').selectOption('90'); await t('align').selectOption('topleft');
    await page.locator('[data-key=crop]').uncheck(); await page.locator('[data-key=reg]').check();
    const dialLabel = await t('part').locator('option').evaluateAll((o) => o.map((x) => x.textContent).find((x) => x.startsWith('Dial')));
    await t('part').selectOption({ label: dialLabel });
    await page.locator('[data-key=rows]').fill('2'); await page.locator('[data-key=cols]').fill('2');
    assert.equal(await t('count').textContent(), '4');
    assert.equal(await t('fit-switch').isChecked(), false);
    const dl = await downloaded(() => page.keyboard.press('Control+s'));
    saved = dl;
    assert.equal(dl.name, 'Layout 1.dxf', 'a new layout: the first Save is a Save As, named after the layout');
    assert.ok(/^[\x00-\x7f]*$/.test(dl.text), 'ASCII only');
    const doc = readDxf(dl.text);
    assert.equal(doc.entities.filter((e) => e.type === 'INSERT').length, 12, '7 plates, 1 dropped dial, 4 dials in the grid');
    assert.ok(doc.blocks.PD_LAYOUT && doc.blocks.PD_LAYOUT.entities.every((e) => e.type === 'TEXT'), 'the settings: TEXT in a block nothing inserts');
    assert.ok(!doc.entities.some((e) => e.type === 'INSERT' && e.r.v[e.r.c.indexOf(2)] === 'PD_LAYOUT'));
    for (const n of ['Parts', 'Sheet', 'Marks']) assert.ok(doc.layers[n], n);
    const sheet = doc.entities.find((e) => e.layer === 'Sheet'), xs = sheet.r.c.map((c, i) => (c === 10 ? +sheet.r.v[i] : null)).filter((v) => v != null);
    assert.deepEqual([Math.min(...xs), Math.max(...xs)], [0, 420]);
    assert.ok(!(await tabs()).some((x) => x.includes('•')), 'saved: no dot');
    // forget Plate A in the library, close the layout, open the file again
    await t('panel-library').click();
    page.once('dialog', (d) => d.accept());
    await libCard('Plate A').locator('[data-testid=lib-menu]').click(); await page.getByRole('menuitem', { name: 'Delete from library' }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=lib-list] .card').length === 1);
    await closeTabs(/^Layout 1/);
    await t('picker').setInputFiles({ name: 'Layout 1.dxf', mimeType: 'text/plain', buffer: Buffer.from(dl.text, 'latin1') });
    await page.waitForFunction(() => { const b = document.querySelector('.tabs .dtab.on'); return b && b.dataset.kind === 'layout' && b.textContent.startsWith('Layout 1.dxf'); });
    assert.deepEqual(await tabNames(), ['Layout 1.dxf'], 'the empty tab was used up');
    assert.match(await t('cmd-prompt').textContent(), /Opened Layout 1\.dxf as a layout: 12 placed parts, 2 parts, its sheet and settings as saved/);
    assert.ok(!(await tabs()).some((x) => x.includes('•')), 'just opened: no dot');
    await t('panel-main').click();
    const val = (k) => page.locator(`[data-key=${k}]`).inputValue();
    assert.equal(await t('preset').inputValue(), 'a3');
    assert.deepEqual(await Promise.all(['sheetW', 'sheetH', 'gripTop', 'gripRight', 'gripBottom', 'gripLeft', 'gapX', 'gapY', 'rows', 'cols'].map(val)), ['420', '297', '12', '0', '30', '8', '7', '9', '2', '2']);
    assert.equal(await t('rotate').inputValue(), '90'); assert.equal(await t('align').inputValue(), 'topleft');
    assert.equal(await page.locator('[data-key=crop]').isChecked(), false); assert.equal(await page.locator('[data-key=reg]').isChecked(), true);
    assert.equal(await t('fit-switch').isChecked(), false);
    assert.equal(await t('count').textContent(), '4'); assert.equal(await t('grid').textContent(), 'placed · 2 × 2 · 90°');
    assert.match(await partText(), /^Dial · /);
    const rows = await partRows();
    assert.deepEqual(rows.map((r) => r.split('|')[0]).sort(), ['Dial', 'Plate A']);
    assert.match(rows.find((r) => r.startsWith('Plate A')).split('|')[1], / · 7 copies$/); assert.match(rows.find((r) => r.startsWith('Dial')).split('|')[1], / · 5 copies$/);
    assert.equal(await page.locator('[data-group=parts] .part-hit').count(), 12);
    assert.ok((await inkedWhen((n) => n > 300)) > 300, 'the parts are drawn');
    // Plate A was not in the library any more: the layout's copy is added back, by name
    await t('panel-library').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=lib-list] .card').length === 2);
    assert.deepEqual((await libNames()).sort(), ['Dial', 'Plate A']);
    await t('panel-main').click();
    await shotBoth('reopen');
    // a file opened is never overwritten: the first Save of it is a Save As
    const again = await downloaded(() => page.keyboard.press('Control+s'));
    assert.equal(again.name, 'Layout 1-edited.dxf');
  });

  await step('dark theme changes the body background', async () => {
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const light = await bg();
    await page.locator('[data-menu=View]').click();
    await page.getByRole('menuitemcheckbox', { name: new RegExp('Theme: dark' + '$') }).click();
    const dark = await bg();
    assert.notEqual(light, dark); assert.equal(dark, 'rgb(11, 11, 13)');
    await page.locator('[data-group=parts] [data-i="0"] .part-hit').click({ force: true });
    await page.screenshot({ path: shotDir + '/a-dark.png' });
    await page.locator('[data-menu=View]').click();
    await page.getByRole('menuitemcheckbox', { name: new RegExp('Theme: light' + '$') }).click();
    assert.equal(await bg(), light);
  });

  await step('prefers-color-scheme: dark is followed', async () => {
    const p2 = await (await browser.newContext({ colorScheme: 'dark' })).newPage();
    await p2.goto(URL_);
    assert.equal(await p2.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(11, 11, 13)');
  });

  await step('Parts library with no storage (private mode, blocked): a part is still kept in memory and the app says so; nothing breaks', async () => {
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p2 = await ctx2.newPage();
    await p2.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); });
    const errs2 = [];
    p2.on('pageerror', (e) => errs2.push(String(e)));
    p2.on('console', (m) => { if (m.type() === 'error') errs2.push(m.text()); });
    await p2.goto(URL_);
    await p2.locator('[data-testid=picker]').setInputFiles('fixtures/outline.dxf');
    await p2.waitForFunction(() => document.querySelectorAll('[data-testid=outlines] .orow').length > 0);
    await p2.locator('[data-testid=outlines] .orow').first().click();
    await p2.locator('[data-testid=bar-extract]').click();
    await p2.keyboard.type('Mem part'); await p2.keyboard.press('Enter');
    await p2.waitForFunction(() => /Part Mem part saved to the Parts library/.test(document.querySelector('[data-testid=cmd-prompt]').textContent));
    assert.match(await p2.locator('[data-testid=cmd-prompt]').textContent(), /storage is not available: it stays until the app is closed/);
    await p2.locator('[data-testid=panel-library]').click();
    assert.deepEqual(await p2.locator('[data-testid=lib-list] .card .cname').allTextContents(), ['Mem part']);
    assert.match(await p2.locator('[data-testid=lib-foot]').textContent(), /storage is not available here, so parts last until the app is closed/);
    await p2.locator('[data-testid=lib-add]').click();                                         // Add to sheet still works: a new layout tab
    assert.equal(await p2.locator('.tabs .dtab.on').getAttribute('data-kind'), 'layout');
    assert.deepEqual(errs2, []);
    await ctx2.close();
  });

  // ---- review fixes (session 3 follow-ups): status bar, keys, menus, dimensions kept out of sizes, layout panel, PDF dialog
  const rectsOverlap = (a, b, pad = 0) => a.x < b.x + b.width + pad && a.x + a.width > b.x - pad && a.y < b.y + b.height + pad && a.y + a.height > b.y - pad;
  const rectOf = (loc) => loc.evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const entitiesN = async () => Number((await t('entities').textContent()).replace(/\D/g, ''));
  const hasText = async (re) => re.test(await page.locator('body').innerText());

  await step('review: status bar: GRID is greyed and never on; the layer shown is the selection\'s; no fixed Scale 1:1', async () => {
    await closeTabs(/./);
    await t('picker').setInputFiles('fixtures/outline.dxf');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'outline.dxf');
    await page.waitForFunction(() => document.querySelector('[data-testid=entities]').textContent.trim() === 'Entities 15');
    for (const id of ['tog-grid']) {
      assert.equal(await t(id).getAttribute('aria-disabled'), 'true', id);
      assert.equal(await t(id).getAttribute('aria-pressed'), 'false', id + ' is not on');
      assert.equal(await t(id).getAttribute('title'), 'Not built yet');
      assert.ok(!(await t(id).getAttribute('class')).split(' ').includes('on'), id);
      await t(id).click({ force: true });
      assert.equal(await t(id).getAttribute('aria-pressed'), 'false', id + ' still not on after a click');
    }
    for (const id of ['tog-ortho', 'tog-polar', 'tog-otrack']) assert.equal(await t(id).getAttribute('aria-disabled'), null, id + ' works');
    assert.equal(await t('layer-info').textContent(), 'Layer: —', 'nothing selected');
    assert.ok(!(await hasText(/Scale 1:1/)), 'no fixed scale text');
    await click(50, 0); await waitSel('8 selected');
    assert.equal(await t('layer-info').textContent(), 'Layer: 0');
    await page.keyboard.press('Escape'); await waitSel('0 selected');
    assert.equal(await t('layer-info').textContent(), 'Layer: —');
  });

  await step('review: ORTHO is a sticky Shift in Measure, Dimension and Set length; Shift still works', async () => {
    await t('tog-snap').click();                                                  // (free picks: a snap, Nearest too, beats ORTHO since TODO 89)
    await typeCmd('m');
    assert.match(await t('cmd-prompt').textContent(), /Measure: click the first point/);
    await click(50, 20); await click(80, 40);
    const dxy = async () => (await t('cmd-prompt').textContent()).match(/ΔX (-?[\d.]+)\s+ΔY (-?[\d.]+)/).slice(1).map(Number);      // (free picks land to the pixel)
    const is = async (x, y, msg) => { const [a, b] = await dxy(); assert.ok(Math.abs(a - x) < 3 && (y === 0 ? b === 0 : Math.abs(b - y) < 3), msg + ': ' + await t('cmd-prompt').textContent()); };
    await is(30, 20, 'without ORTHO the points are as picked');
    await page.keyboard.press('Escape');
    await t('tog-ortho').click();
    assert.equal(await t('tog-ortho').getAttribute('aria-pressed'), 'true');
    assert.match(await t('cmd-prompt').textContent(), /Ortho on/);
    await click(50, 20); await click(80, 40);
    await is(30, 0, 'straight along X');
    await click(50, 20); await click(52, 40);
    assert.match(await t('cmd-prompt').textContent(), /ΔX 0   ΔY [\d.]+   Angle 90°/, 'straight along Y');
    await page.keyboard.press('Escape'); await typeCmd('d');
    await click(50, 20); await click(80, 40);
    assert.match(await t('cmd-prompt').textContent(), /Dimension: move the line/);
    await click(65, 50);
    assert.ok(Math.abs(Number((await t('cmd-prompt').textContent()).match(/Dimension placed: ([\d.]+) mm/)[1]) - 30) < 3, 'a dimension made with ORTHO on is straight too');
    await page.keyboard.press('Control+z');
    await t('tog-ortho').click();
    assert.equal(await t('tog-ortho').getAttribute('aria-pressed'), 'false');
    await typeCmd('m');
    await click(50, 20); await click(80, 40);
    await is(30, 20, 'ORTHO off: as picked again');
    await click(50, 20, { shift: true }); await click(80, 40, { shift: true });
    await is(30, 0, 'Shift still straightens one pick');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await t('tog-snap').click();
    assert.ok((await page.locator('[data-tool=select]').getAttribute('class')).split(' ').includes('on'));
  });

  await step('review: keys S, M, D and Esc work as the tooltips say; unbuilt tools carry no letters; Pan says how', async () => {
    const on = async (id) => (await page.locator('[data-tool=' + id + ']').getAttribute('class')).split(' ').includes('on');
    assert.equal(await page.locator('[data-tool=select]').getAttribute('title'), 'Select (S)');
    assert.equal(await page.locator('[data-tool=measure]').getAttribute('title'), 'Measure (M)');
    assert.equal(await page.locator('[data-tool=dimension]').getAttribute('title'), 'Dimension (D)');
    const titles = await page.locator('nav.rail button').evaluateAll((bs) => bs.map((b) => b.getAttribute('title')));
    assert.ok(titles.every((x) => !/\((NE|NEST)\)/.test(x)), 'no letter that does nothing: ' + titles.join());
    await typeCmd('m'); assert.ok(await on('measure'));
    await page.keyboard.press('Escape'); assert.ok(await on('select') && !(await on('measure')), 'Esc with nothing in progress: back to Select');
    await typeCmd('d'); assert.ok(await on('dimension'));
    await click(10, 0);
    await page.keyboard.press('Escape'); assert.ok(await on('dimension'), 'the first Esc only cancels the pick in progress');
    await page.keyboard.press('Escape'); assert.ok(await on('select'));
    await typeCmd('m'); await typeCmd('s'); assert.ok(await on('select'), 'S is Select');
    await page.locator('[data-tool=pan]').click();
    assert.equal((await t('cmd-prompt').textContent()).trim(), 'Drag to pan');
    await typeCmd('s'); assert.ok(await on('select'));
  });

  await step('review: Edit menu has Undo, Redo, Delete; shortcut hints; unbuilt menus are greyed', async () => {
    await page.locator('[data-menu=File]').click();
    const hint = (name) => page.getByRole('menuitem', { name, exact: true }).locator('.hint').textContent();
    assert.equal(await hint('Save'), 'Ctrl+S'); assert.equal(await hint('Save As…'), 'Ctrl+Shift+S');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-menu=Modify]').getAttribute('aria-disabled'), null, 'Modify is built: Offset, Trim, Mirror');
    for (const m of ['Help']) {
      const b = page.locator('[data-menu=' + m + ']');
      assert.equal(await b.getAttribute('aria-disabled'), 'true', m); assert.equal(await b.getAttribute('title'), 'Not built yet', m);
    }
    await page.locator('[data-menu=Draw]').click();
    assert.equal(await hint('Line'), 'L'); assert.equal(await hint('Text'), 'T');
    await page.keyboard.press('Escape');
    await page.locator('[data-menu=Edit]').click();
    assert.deepEqual(await page.locator('.dropdown button').evaluateAll((bs) => bs.map((b) => b.textContent)), ['UndoCtrl+Z', 'RedoCtrl+Y', 'Undo history…', 'Select allCtrl+A', 'DeleteDel']);
    assert.equal(await page.getByRole('menuitem', { name: 'Undo', exact: true }).isDisabled(), true, 'nothing to undo yet');
    assert.equal(await page.getByRole('menuitem', { name: 'Delete', exact: true }).isDisabled(), true, 'nothing selected');
    await page.keyboard.press('Escape');
    await click(38, 30); await waitSel('1 selected');
    await menuItem('Edit', 'Delete');
    await page.waitForFunction(() => document.querySelector('[data-testid=entities]').textContent.trim() === 'Entities 14');
    await menuItem('Edit', 'Undo');
    await page.waitForFunction(() => document.querySelector('[data-testid=entities]').textContent.trim() === 'Entities 15');
    await menuItem('Edit', 'Redo');
    await page.waitForFunction(() => document.querySelector('[data-testid=entities]').textContent.trim() === 'Entities 14');
    await menuItem('Edit', 'Undo');
    await page.waitForFunction(() => document.querySelector('[data-testid=entities]').textContent.trim() === 'Entities 15');
    await shotBoth('edit-menu', async () => { await page.locator('[data-menu=Edit]').click(); }, async () => { await page.keyboard.press('Escape'); });
  });

  await step('review: opening a picture says what opens and where pictures go', async () => {
    await t('picker').setInputFiles('fixtures/bg.png');
    await page.waitForFunction(() => /Opens DXF or PDF; pictures go in as a background \(Background…\)/.test(document.querySelector('[data-testid=cmd-prompt]').textContent));
    assert.deepEqual(await tabNames(), ['outline.dxf'], 'no new tab');
  });

  await step('review: a kept dimension never changes a part\'s size; Selection and Whole drawing are labelled; a dimension alone cannot be kept or extracted; one wording and one count', async () => {
    const [w0, h0] = await sizeNow();
    assert.deepEqual([w0, h0], ['136', '60']);
    assert.equal(await page.locator('.selbar .sizelbl').textContent(), 'Size');
    assert.equal(await page.locator('[data-testid=drawing-panel] .sizelbl').textContent(), 'Whole drawing');
    const n0 = await entitiesN();
    await typeCmd('d');
    await click(10, 0); await click(90, 0); await click(50, -25);                      // far below the part
    await page.waitForFunction((n) => Number(document.querySelector('[data-testid=entities]').textContent.replace(/\D/g, '')) === n, n0 + 1);
    assert.deepEqual(await sizeNow(), [w0, h0], 'the whole-drawing size leaves the dimension out');
    await typeCmd('s');
    await click(50, -25);                                                              // the callout's line
    await waitSel('1 selected');
    assert.equal(await t('sel-name').textContent(), '1 selected', 'one wording');
    assert.equal(await t('sel-layer').textContent(), 'layer Dimensions');
    assert.equal(await t('layer-info').textContent(), 'Layer: Dimensions');
    assert.deepEqual([await t('sel-w').inputValue(), await t('sel-h').inputValue()], ['—', '—'], 'a dimension has no part size');
    for (const id of ['bar-keep', 'bar-extract', 'keep-only', 'extract']) assert.equal(await t(id).isDisabled() , id === 'extract' ? false : true, id);
    const p = await at(50, -25);
    await page.mouse.click(p.x, p.y, { button: 'right' }); await page.waitForSelector('[data-testid=ctx-menu]');
    assert.deepEqual(await ctxItems(), ['Measure from here', 'Delete'], 'no Extract or Keep for a dimension');
    await page.keyboard.press('Escape');
    await t('extract').click();
    assert.match(await t('cmd-prompt').textContent(), /a kept dimension is not part of a part/);
    assert.equal(await page.locator('.layer', { hasText: 'Dimensions' }).locator('.mono').textContent(), '1', 'a dimension counts as one entity in Layers');
    assert.equal(await entitiesN(), n0 + 1, 'and one in the Entities readout');
    // the selection of the plate and a dimension together: the size is the plate's
    await click(50, 0, { shift: true });
    await waitSel('9 selected');
    assert.deepEqual([await t('sel-w').inputValue(), await t('sel-h').inputValue()], ['100.00', '60.00']);
    await page.keyboard.press('Escape'); await waitSel('0 selected');
    // Reset: the text height comes back to the default
    await click(50, -25); await waitSel('1 selected');
    await t('dim-height').fill('9'); await t('dim-height').press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-testid=dim-height]').value === '9');
    await t('dim-reset').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=dim-height]').value === '3.5');
    assert.match(await t('cmd-prompt').textContent(), /back to the style's, 3.5 mm/);
    // Width / Height scale by the part, not by the dimension: 136 wide → 272 wide doubles everything
    await page.keyboard.press('Escape');
    await t('dw').fill('272'); await t('dw').press('Enter');
    await waitSize('272', '120');
    // Add to layout: the part without the dimension
    await t('add-to-layout').click();
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').dataset.kind === 'layout');
    assert.equal(await partText(), 'outline · 272 × 120');
  });

  await step('review: layout: the Dimensions row is the real count; the parts list says copies; Apply stays in view; each Add puts a new copy 10 mm further on', async () => {
    assert.equal(await page.locator('.layer', { hasText: 'Dimensions' }).locator('.mono').textContent(), '3', 'sheet width and height, and the selected part\'s width');
    assert.match((await partRows())[0], /^outline\|272 × 120 · \d+ copies$/);
    await shotBoth('layout-review');
    // Apply and the count are in the panel's visible part with the panel scrolled to the top
    await page.setViewportSize({ width: 1440, height: 600 });
    await page.waitForTimeout(200);
    const panel = await rectOf(page.locator('aside.panel'));
    assert.equal(await page.locator('aside.panel').evaluate((e) => e.scrollTop), 0);
    const apply = await rectOf(t('apply')), count = await rectOf(t('count'));
    assert.ok(apply.y >= panel.y && apply.y + apply.height <= panel.y + panel.height + 1, 'Apply is in view: ' + JSON.stringify([apply, panel]));
    assert.ok(count.y >= panel.y && count.y + count.height <= panel.y + panel.height + 1, 'the count line is in view');
    assert.equal(await t('apply').isDisabled(), false);
    await page.setViewportSize({ width: 1440, height: 900 });
    // Add to layout again from the drawing: loose copies, each 10 mm right and up from the last, on the sheet
    await page.locator('.tabs .dtab[data-kind=drawing]').first().click();
    await page.waitForTimeout(100);
    await t('add-to-layout').click(); await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').dataset.kind === 'layout');
    const pos = async () => [Number(await t('px').inputValue()), Number(await t('py').inputValue())];
    const first = await pos();
    await page.locator('.tabs .dtab[data-kind=drawing]').first().click(); await t('add-to-layout').click();
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').dataset.kind === 'layout');
    const second = await pos();
    assert.deepEqual([second[0] - first[0], second[1] - first[1]], [10, 10], 'the second is 10 mm right and up from the first');
    await page.locator('.tabs .dtab[data-kind=drawing]').first().click(); await t('add-to-layout').click();
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').dataset.kind === 'layout');
    const third = await pos();
    assert.deepEqual([third[0] - second[0], third[1] - second[1]], [10, 10]);
    assert.ok(third[0] >= 0 && third[1] >= 0 && third[0] + 272 <= 1000 && third[1] + 120 <= 700, 'on the sheet');
  });

  await step('review: Rows and Columns say why a typed value is refused; a huge count is refused with a note', async () => {
    await t('apply').click();                                                         // the grid becomes placed parts, so a new grid can be picked
    await t('part').selectOption({ index: 1 });
    await t('fit-switch').uncheck();
    const rows = page.locator('[data-key=rows]');
    for (const v of ['0', '-3', 'abc']) {
      await rows.fill(v);
      assert.match(await t('cmd-prompt').textContent(), /Rows must be 1 or more/, v);
    }
    await rows.fill('500');
    assert.match(await t('cmd-prompt').textContent(), /Rows: 500 will not fit on a sheet \(200 at most\)/);
    await rows.fill('3'); await rows.press('Tab');
    assert.equal(await rows.inputValue(), '3');
    await rows.fill(''); await rows.press('Tab');
    assert.match(await t('cmd-prompt').textContent(), /Rows must be 1 or more/);
    assert.equal(await rows.inputValue(), '3', 'it snaps back, and said why');
    const cols = page.locator('[data-key=cols]');
    await cols.fill('1000'); await cols.press('Tab');
    assert.match(await t('cmd-prompt').textContent(), /Columns: 1000 will not fit/);
    assert.notEqual(await cols.inputValue(), '1000');
    await t('fit-switch').check();
  });

  await step('invalid numbers (text, negative, 0 rows) get a message naming the allowed range, a red mark on the field, and the old value back', async () => {
    const cases = [['rows', '0', /Rows must be 1 or more \(up to 200\)/], ['rows', 'abc', /Rows must be 1 or more/], ['gapX', 'abc', /Gap X must be a number in mm: 0 or more/], ['gapY', '-4', /Gap Y must be 0 mm or more/],
      ['sheetW', 'abc', /Width must be a number in mm: \d+ to 100000/], ['sheetH', '0', /Height must be \d+ mm or more/], ['gripLeft', '-5', /Left must be 0 mm or more/]];
    const key = (k) => page.locator(`[data-key=${k}]`).first();
    await t('fit-switch').uncheck();
    for (const [k, v, re] of cases) {
      const f = key(k), was = await f.inputValue();
      await t('cmd-prompt').evaluate((el) => { el.textContent = ''; });
      await f.fill(v); await f.press('Tab');
      assert.match(await t('cmd-prompt').textContent(), re, `${k} = ${v}`);
      assert.equal(await f.inputValue(), was, `${k} is reset`);
      assert.equal(await f.getAttribute('aria-invalid'), 'true', `${k} is marked`);
      await f.focus();
      assert.equal(await f.getAttribute('aria-invalid'), null, `${k}: the mark goes when the field is entered again`);
      await f.press('Tab');
    }
    await key('gapX').fill('abc'); await key('gapX').press('Tab');                // leave one mark on screen for the pictures
    await key('gapX').evaluate((el) => el.scrollIntoView({ block: 'center' }));   // clear of the sticky Apply footer
    const theme0 = await page.evaluate(() => document.documentElement.dataset.theme || '');
    for (const th of ['light', 'dark']) {
      await page.evaluate((x) => { document.documentElement.dataset.theme = x; }, th);
      await page.screenshot({ path: `${shotDir}/s14-invalid-${th}.png` });
    }
    await page.evaluate((x) => { if (x) document.documentElement.dataset.theme = x; else delete document.documentElement.dataset.theme; }, theme0);
    await t('fit-switch').check();
  });

  await step('review: the gripper label never sits on a registration mark; the selected slot\'s width is never drawn over another part', async () => {
    await t('new-layout').click();
    await t('panel-library').click();
    assert.ok((await libNames()).length > 0);
    await page.locator('[data-testid=lib-search]').fill('zzz-no-such-part');
    assert.match(await t('lib-nomatch').textContent(), /No part matches "zzz-no-such-part"/);
    await page.locator('[data-testid=lib-search]').fill('');
    assert.equal(await page.locator('[data-testid=lib-menu]').first().getAttribute('title'), 'Rename, Export, Delete');
    await libCard('Plate A').locator('[data-testid=lib-add]').click();
    await t('panel-main').click();
    await t('part').selectOption({ index: 1 });                                        // Plate A fills the sheet as a grid
    for (const k of ['Top', 'Right', 'Bottom', 'Left']) await grip(k).fill('30');
    await page.locator('[data-key=reg]').check();
    const marksBoxes = async () => page.locator('[data-group=marks] circle, [data-group=marks] path').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
    const labels = await page.locator('.grip-label').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { e: e.dataset.edge, x: r.x, y: r.y, width: r.width, height: r.height }; }));
    assert.equal(labels.length, 4);
    const marks = await marksBoxes();
    assert.ok(marks.length >= 8, 'registration marks are drawn');
    for (const l of labels) for (const m of marks) assert.ok(!rectsOverlap(l, m), `the ${l.e} label overlaps a registration mark: ${JSON.stringify([l, m])}`);
    await shotBoth('gripper-marks');
    // the selected slot's width: not over another part
    const n = await page.locator('[data-group=parts] .part-hit').count();
    assert.ok(n > 4, 'a grid');
    const mid = Math.floor(n / 2);
    await page.locator(`[data-group=parts] [data-i="${mid}"] .part-hit`).click({ force: true });
    const tag = await rectOf(page.locator('[data-group=dims] .dim-text.small'));
    const others = await page.locator('[data-group=parts] .part-hit').evaluateAll((els, sel) => els.map((e, i) => { const r = e.getBoundingClientRect(); return { i, x: r.x, y: r.y, width: r.width, height: r.height }; }).filter((r) => r.i !== sel), mid);
    for (const o of others) assert.ok(!rectsOverlap(tag, o, -1), 'the width label is over part ' + o.i + ': ' + JSON.stringify([tag, o]));
    await shotBoth('slot-width');
  });

  await step('review: the read-only bar numbers (W, H) are not drawn as inputs; X, Y and Angle are, and say what they are', async () => {
    const bg = await t('pw').evaluate((e) => getComputedStyle(e).backgroundColor);
    assert.match(bg, /^rgba\(0, 0, 0, 0\)|^transparent/, 'no white input look: ' + bg);
    assert.match(await t('pw').getAttribute('title'), /Read-only: parts are scaled per drawing/);
    assert.match(await t('ph').getAttribute('title'), /Read-only: parts are scaled per drawing/);
    const bgx = await t('px').evaluate((e) => getComputedStyle(e).backgroundColor);
    assert.doesNotMatch(bgx, /^rgba\(0, 0, 0, 0\)|^transparent/, 'X is typed, so it looks like an input: ' + bgx);
    assert.equal(await t('px').isEditable(), true); assert.equal(await t('pw').isEditable(), false);
    assert.match(await t('px').getAttribute('title'), /lower-left of the part's box/);
  });

  await step('review: PDF dialog: a greyed Mirror and Negative show unticked and do not apply', async () => {
    await t('pdf-open').click();
    const dialog = t('pdf-dialog');
    await dialog.waitFor();
    await t('pdf-page-sheet').check();
    await t('pdf-mirror').check(); await t('pdf-negative').check();
    await t('pdf-page-check').check();
    for (const id of ['pdf-mirror', 'pdf-negative']) { assert.equal(await t(id).isDisabled(), true, id); assert.equal(await t(id).isChecked(), false, id + ' shows unticked while greyed'); }
    const a = await downloaded(() => t('pdf-go').click());
    await t('pdf-open').click(); await dialog.waitFor();
    assert.equal(await t('pdf-page-check').isChecked(), true);
    await t('pdf-page-sheet').check();
    assert.equal(await t('pdf-mirror').isChecked(), true, 'it comes back as it was when the page allows it');
    assert.equal(await t('pdf-negative').isChecked(), true);
    await t('pdf-mirror').uncheck(); await t('pdf-negative').uncheck();
    await t('pdf-page-check').check();
    const b = await downloaded(() => t('pdf-go').click());
    assert.equal(a.text, b.text, 'a check print is the same whatever Mirror and Negative were ticked');
  });

  await step('review: the smallest window (1024 × 700): every tool is reachable without scrolling, on a drawing and on a layout', async () => {
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.waitForTimeout(250);
    const rail = async () => page.locator('nav.rail').evaluate((n) => {
      const r = n.getBoundingClientRect(), bs = [...n.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
      return { scrolls: n.scrollHeight > n.clientHeight + 1, all: bs.every((b) => b.top >= r.top - 0.5 && b.bottom <= r.bottom + 0.5 && b.left >= r.left - 0.5 && b.right <= r.right + 0.5), n: bs.length };
    });
    const lay = await rail();
    assert.deepEqual([lay.scrolls, lay.all, lay.n], [false, true, 20], 'layout: ' + JSON.stringify(lay));
    await shotBoth('small-layout');
    await drawingTab().click(); await click(50, 0);
    const dr = await rail();
    assert.deepEqual([dr.scrolls, dr.all, dr.n], [false, true, 20], 'drawing: ' + JSON.stringify(dr));
    await shotBoth('small-drawing');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(150);
  });

  await step('Recent files (TODO 33): in the app the File menu lists them; one that is gone comes off the list', async () => {
    const bytes = [...readFileSync('fixtures/outline.dxf')];
    await page.evaluate((b) => {                                     // a stand-in for the app's file API: only readFile
      window.__TAURI__ = { fs: { readFile: async (p) => { if (/gone/.test(p)) throw new Error('not found'); return new Uint8Array(b); } } };
      localStorage.setItem('pd-recent', JSON.stringify(['C:\\work\\outline.dxf', 'C:\\work\\gone.dxf']));
    }, bytes);
    const fileMenu = page.locator('[data-menu=File]');
    await fileMenu.click();
    const items = page.locator('.dropdown [role=menuitem]');
    assert.equal(await items.filter({ hasText: '1  outline.dxf' }).getAttribute('title'), 'C:\\work\\outline.dxf');
    await items.filter({ hasText: '2  gone.dxf' }).click();
    assert.match(await t('cmd-prompt').textContent(), /gone\.dxf: not found/);
    const tabs = await page.locator('.tabs .dtab').count();
    await fileMenu.click();
    assert.equal(await items.filter({ hasText: 'gone.dxf' }).count(), 0);
    await page.screenshot({ path: shotDir + '/s13-recent-' + (await page.evaluate(() => document.documentElement.dataset.theme || 'light')) + '.png' });
    await items.filter({ hasText: '1  outline.dxf' }).click();
    await page.waitForFunction((n) => document.querySelectorAll('.tabs .dtab').length > n || /Opened outline\.dxf/.test(document.querySelector('[data-testid=cmd-prompt]').textContent), tabs);
    assert.match(await t('cmd-prompt').textContent(), /Opened outline\.dxf/);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('pd-recent'))), ['C:\\work\\outline.dxf']);
    // the same file again (any case of the path): its tab is shown, no second copy
    const nTabs = await page.locator('.tabs .dtab').count();
    await page.locator('.tabs .dtab').first().click();
    await fileMenu.click(); await items.filter({ hasText: '1  outline.dxf' }).click();
    await page.waitForFunction(() => /already open/.test(document.querySelector('[data-testid=cmd-prompt]').textContent));
    assert.equal(await page.locator('.tabs .dtab').count(), nTabs, 'no second tab for the same file');
    assert.match(await page.locator('.tabs .dtab.on').textContent(), /outline\.dxf/);
    await page.evaluate(() => { delete window.__TAURI__; localStorage.removeItem('pd-recent'); });
    await fileMenu.click();
    assert.equal(await items.filter({ hasText: 'Recent' }).count(), 0, 'no Recent files in a browser');
    await page.keyboard.press('Escape');
  });

  // ---- Build B: placing and editing parts (TODO 2, 9-13, 16) ----
  const pos = async () => [Number(await t('px').inputValue()), Number(await t('py').inputValue())];
  const angleNow = async () => Number((await t('pa').inputValue()).replace('°', ''));
  const nParts = () => page.locator('[data-group=parts] .part-hit').count();
  const prompt = async () => (await t('cmd-prompt').textContent());
  const approx = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} != ${b}`);
  /** A mouse drag from one sheet point to another (mm); keys: held for the whole drag. */
  const dragMm = async (from, to, keys = [], mid = null) => {
    const a = await at(from[0], from[1]), b = await at(to[0], to[1]);
    for (const k of keys) await page.keyboard.down(k);
    try {
      await page.mouse.move(a.x, a.y); await page.mouse.down();
      await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 3 }); await page.mouse.move(b.x, b.y, { steps: 3 });
      if (mid) await mid();
      await page.mouse.up();
    } finally { for (const k of keys.slice().reverse()) await page.keyboard.up(k); }
  };
  /** The client position of a point inside the selected part: the centre moved f of the way to its first corner. */
  const partPoint = (f) => page.evaluate((fr) => {
    const poly = document.querySelector('[data-group=tools] .sel-box'), m = poly.getScreenCTM();
    const pts = poly.getAttribute('points').split(' ').map((p) => p.split(',').map(Number));
    const cx = pts.reduce((s, p) => s + p[0], 0) / 4, cy = pts.reduce((s, p) => s + p[1], 0) / 4;
    const x = cx + fr * (pts[0][0] - cx), y = cy + fr * (pts[0][1] - cy);
    return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
  }, f);
  /** The client position of the middle of a turn arrow's curve. */
  const arrowPoint = (i) => page.evaluate((idx) => {
    const el = document.querySelector(`[data-group=tools] [data-rot="${idx}"]`), m = el.getScreenCTM(), q = el.getPointAtLength(el.getTotalLength() / 2);
    return { x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f };
  }, i);
  const pivotPx = async () => { const r = await rectOf(page.locator('[data-group=tools] [data-pivot]')); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
  const markPixels = () => t('drawing').evaluate((c) => {                // pixels in the mark colour (#b4440e, or #f0894a on dark)
    const x = c.getContext('2d'), d = x.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 60 && Math.abs(d[i] - 180) < 30 && Math.abs(d[i + 1] - 68) < 30 && Math.abs(d[i + 2] - 14) < 30) n++;
    return n;
  });
  const freshLayoutWithPlate = async () => {
    await closeTabs(/./);
    await t('new-layout').click();
    await t('panel-library').click();
    await libCard('Plate A').locator('[data-testid=lib-add]').click();
    await t('panel-main').click();
  };

  await step('placing: a selected part shows the hint, size handles and the editable bar; Build B wording is gone', async () => {
    await freshLayoutWithPlate();
    assert.deepEqual(await pos(), [450, 320]);
    assert.equal(await t('hint-pill').isVisible(), true);
    assert.equal(await t('hint-pill').textContent(), 'Ctrl-drag = copy · Ctrl+Shift-drag = copy straight (along X or Y)');
    assert.equal(await page.locator('[data-group=tools] .grip-sq rect').count(), 8, 'handles at the four corners and four mid-sides');
    assert.equal(await page.locator('[data-group=tools] [data-rot]').count(), 0, 'no turn arrows until the part is clicked again');
    assert.equal(await t('pw').isEditable(), false); assert.equal(await t('ph').isEditable(), false);
    for (const id of ['px', 'py', 'pw', 'ph', 'pa']) assert.ok(!/Build B/.test((await t(id).getAttribute('title')) || ''), id);
    assert.ok(!/Build B/.test(await page.locator('body').innerHTML()), 'no "Build B" placeholder wording left');
    assert.equal(await t('bar-mirror-x').textContent(), 'Mirror X'); assert.equal(await t('bar-mirror-y').textContent(), 'Mirror Y');
    assert.equal(await t('nudge-step').inputValue(), '1.0');
    // the right panel: Selected part, Group and lock, Rotate, Mirror, Duplicate, Nudge, above the layout settings (Arrange only with 2+ parts selected)
    const heads = await page.locator('aside.panel > section:not([hidden]) h2.sec, aside.panel > .contents > section:not([hidden]) h2.sec').allTextContents();
    assert.deepEqual(heads.slice(0, 7), ['Selected part', 'Group and lock', 'Rotate', 'Mirror', 'Duplicate', 'Nudge', 'Sheet']);
    assert.equal(await t('pp-name').textContent(), 'Plate A');
    assert.equal(await t('pp-size').textContent(), '100 × 60');
    assert.equal(await t('pp-x').inputValue(), '450.00');
    assert.equal(await t('rot-pivot').inputValue(), 'centre');
    assert.equal(await t('rot-px').isDisabled(), true, 'the pivot fields are for Custom');
    assert.match(await page.locator('[data-testid=sec-rotate] .lbl').last().textContent(), /^Click the part again to turn it by hand; drag ◎ to move the pivot\.$/);
    assert.match(await page.locator('[data-testid=sec-nudge]').textContent(), /Arrow keys move the part by this step\./);
    assert.equal(await t('dup-gap').getAttribute('aria-label'), 'Distance between copies in mm');
  });

  await step('placing: drag moves the part; Shift keeps it straight; Esc cancels; Ctrl+Z undoes', async () => {
    await dragMm([500, 350], [600, 420]);
    let p = await pos(); approx(p[0], 550, 1, 'x'); approx(p[1], 390, 1, 'y');
    assert.match(await prompt(), /^Plate A moved to X 550\.\d\d Y 390\.\d\d:?$/);
    assert.ok((await tabs()).some((x) => x.includes('•')), 'a move is an unsaved change');
    const before = await pos();
    await dragMm([600, 420], [680, 430], ['Shift']);
    p = await pos(); approx(p[0], before[0] + 80, 1, 'straight along X'); assert.equal(p[1], before[1], 'Shift: Y did not move');
    const b2 = await pos();
    await dragMm([680, 430], [690, 520], ['Shift']);
    p = await pos(); assert.equal(p[0], b2[0], 'Shift: X did not move'); approx(p[1], b2[1] + 90, 1, 'straight along Y');
    // a ghost shows where it was, during the drag; Esc puts it back
    const b3 = await pos();
    const a = await at(690, 520), b = await at(300, 200);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.waitForFunction(() => document.querySelectorAll('[data-group=tools] .ghost').length === 1);
    await page.keyboard.press('Escape'); await page.mouse.up();
    assert.deepEqual(await pos(), b3, 'Esc: back where it was');
    assert.equal(await page.locator('[data-group=tools] .ghost').count(), 0);
    // undo
    await page.keyboard.press('Control+z');
    p = await pos(); assert.deepEqual(p, b2, 'undo of the straight drag');
    await page.keyboard.press('Control+y');
    assert.deepEqual(await pos(), b3, 'redo');
    for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
    assert.deepEqual(await pos(), [450, 320], 'three undos: where it was added');
    assert.equal(await nParts(), 1);
    for (let i = 0; i < 3; i++) await page.keyboard.press('Control+y');            // and forward again, so the next steps start from the moved part
    assert.deepEqual(await pos(), b3);
  });

  await step('placing: Ctrl-drag copies (the original stays); Ctrl+Shift-drag copies straight', async () => {
    const [x0, y0] = await pos();
    await dragMm([x0 + 50, y0 + 30], [x0 + 50, y0 - 120], ['Control']);
    assert.equal(await nParts(), 2);
    const copy = await pos();
    approx(copy[1], y0 - 150, 1.5, 'the copy dropped 150 mm lower'); approx(copy[0], x0, 1.5);
    assert.match(await prompt(), /^Plate A copied to X /);
    assert.match(await partRows().then((r) => r[0]), /· 2 copies$/);
    // the original is still at its place: pick it by clicking where it is
    await click(x0 + 50, y0 + 30);
    assert.deepEqual(await pos(), [x0, y0], 'the original did not move');
    await dragMm([x0 + 50, y0 + 30], [x0 + 200, y0 + 40], ['Control', 'Shift']);
    assert.equal(await nParts(), 3);
    const c2 = await pos();
    approx(c2[0], x0 + 150, 1.5, 'copied along X'); assert.equal(c2[1], y0, 'straight: same Y as the original');
    await page.keyboard.press('Control+z');
    assert.equal(await nParts(), 2, 'undo removes the copy');
  });

  await step('placing: arrow keys nudge by the step, Shift+arrow by 10 times; the step field is remembered; not while typing', async () => {
    await click(450 + 50, 320 + 30);
    const p0 = await pos();
    await page.keyboard.press('ArrowRight');
    assert.deepEqual(await pos(), [p0[0] + 1, p0[1]]);
    await page.keyboard.press('ArrowUp');
    assert.deepEqual(await pos(), [p0[0] + 1, p0[1] + 1], 'up is +Y');
    await page.keyboard.press('Shift+ArrowLeft');
    assert.deepEqual(await pos(), [p0[0] - 9, p0[1] + 1]);
    await page.keyboard.press('Shift+ArrowDown');
    assert.deepEqual(await pos(), [p0[0] - 9, p0[1] - 9]);
    // the step: the bar and the panel are one value
    await t('nudge-step').fill('2.5'); await t('nudge-step').press('Enter');
    assert.equal(await t('nudge-step2').inputValue(), '2.5');
    assert.equal(await page.evaluate(() => localStorage.getItem('pd-nudge')), '2.5');
    const p1 = await pos();
    await page.keyboard.press('ArrowLeft');
    assert.deepEqual(await pos(), [p1[0] - 2.5, p1[1]]);
    // typing in a field: the arrow keys move the caret, not the part
    await t('px').focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Shift+ArrowUp');
    await t('px').blur();
    assert.deepEqual(await pos(), [p1[0] - 2.5, p1[1]], 'not moved while typing');
    // a bad step says so and snaps back
    await t('nudge-step2').fill('abc'); await t('nudge-step2').press('Enter');
    assert.match(await prompt(), /The nudge step must be a number above 0 mm/);
    assert.equal(await t('nudge-step2').inputValue(), '2.5'); assert.equal(await t('nudge-step').inputValue(), '2.5');
    await t('nudge-step').fill('0'); await t('nudge-step').press('Enter');
    assert.equal(await t('nudge-step').inputValue(), '2.5');
    // held down: one undo step for the run
    await page.waitForTimeout(900);
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    const p2 = await pos();
    await page.keyboard.press('Control+z');
    assert.deepEqual(await pos(), [p2[0] - 10, p2[1]], 'a run of arrow presses undoes at once');
    await page.reload(); await page.waitForSelector('[data-testid=count]', { state: 'attached' });
    await t('new-layout').click();
    assert.equal(await t('nudge-step').count(), 1);
    await t('panel-library').click(); await libCard('Plate A').locator('[data-testid=lib-add]').click(); await t('panel-main').click();
    assert.equal(await t('nudge-step').inputValue(), '2.5', 'remembered after a reload');
    await t('nudge-step').fill('1'); await t('nudge-step').press('Enter');
  });

  await step('placing: typed X, Y and Angle apply on Enter; bad input says so and snaps back; W and H stay read-only', async () => {
    await t('px').fill('100'); await t('px').press('Enter');
    await t('py').fill('50.5'); await t('py').press('Enter');
    assert.deepEqual(await pos(), [100, 50.5]);
    assert.equal(await t('pp-x').inputValue(), '100.00');
    assert.match(await prompt(), /^Plate A moved to X 100\.00 Y 50\.50:?$/);
    await t('px').fill('abc'); await t('px').press('Tab');
    assert.match(await prompt(), /X must be a number in mm/);
    assert.equal(await t('px').inputValue(), '100.00', 'snapped back');
    await t('py').fill(''); await t('py').press('Tab');
    assert.match(await prompt(), /Y must be a number in mm/);
    await t('pp-x').fill('120,5'); await t('pp-x').press('Enter');
    assert.equal((await pos())[0], 120.5, 'a comma is a decimal point');
    // Angle: the part turns about its centre
    const cen = async () => { const [x, y] = await pos(); return [x + Number(await t('pw').inputValue()) / 2, y + Number(await t('ph').inputValue()) / 2]; };
    const c0 = await cen();
    await t('pa').fill('30'); await t('pa').press('Enter');
    assert.equal(await t('pa').inputValue(), '30°');
    const c1 = await cen();
    approx(c1[0], c0[0], 0.02); approx(c1[1], c0[1], 0.02);
    approx(Number(await t('pw').inputValue()), 100 * Math.cos(Math.PI / 6) + 60 * Math.sin(Math.PI / 6), 0.02, 'the box of the turned part');
    assert.equal(await t('rot-angle').inputValue(), '30°');
    await t('pa').fill('x'); await t('pa').press('Tab');
    assert.match(await prompt(), /Angle must be a number in degrees/);
    assert.equal(await t('pa').inputValue(), '30°');
    await t('rot-angle').fill('-45'); await t('rot-angle').press('Enter');
    assert.equal(await t('pa').inputValue(), '315°', 'any angle is kept as 0 to 360');
    await t('pa').fill('0'); await t('pa').press('Enter');
    assert.equal(await t('pa').inputValue(), '0°');
    const c2 = await cen();
    approx(c2[0], c0[0], 0.02); approx(c2[1], c0[1], 0.02);
  });

  await step('placing: click again to turn it by hand (arrows, pivot, ghost, Shift snaps to 15°); click once more or Esc ends', async () => {
    const q = await partPoint(0.5);
    await page.mouse.click(q.x, q.y);
    assert.equal(await page.locator('[data-group=tools] [data-rot]').count(), 4, 'four turn arrows');
    assert.equal(await page.locator('[data-group=tools] [data-pivot]').count(), 1);
    assert.equal(await page.locator('[data-group=tools] .grip-sq').count(), 0, 'the handles give way to the arrows');
    assert.match(await t('cmd-hist').textContent(), /^Command: ROTATE {3}Pivot: [\d.]+, [\d.]+$/);
    assert.match(await prompt(), /^Angle <0\.00>: \[Pivot \/ Copy \/ Esc\]:?$/);
    // turn by hand: drag a corner arrow 20° anticlockwise about the pivot
    const turn = async (deg, keys = [], shot = '') => {
      const a = await arrowPoint(0), pv = await pivotPx(), r = Math.hypot(a.x - pv.x, a.y - pv.y), a0 = Math.atan2(a.y - pv.y, a.x - pv.x);
      const to = (d) => ({ x: pv.x + r * Math.cos(a0 - d * Math.PI / 180), y: pv.y + r * Math.sin(a0 - d * Math.PI / 180) });
      for (const k of keys) await page.keyboard.down(k);
      await page.mouse.move(a.x, a.y); await page.mouse.down();
      for (let i = 1; i <= 4; i++) await page.mouse.move(to(deg * i / 4).x, to(deg * i / 4).y);
      await page.waitForFunction(() => document.querySelectorAll('[data-group=tools] .ghost').length === 1 && document.querySelectorAll('[data-group=tools] .rot-label').length === 1);
      const label = await page.locator('[data-group=tools] .rot-label').textContent();
      if (shot) await page.screenshot({ path: `${shotDir}/s12-placing-turning-${shot}.png` });
      await page.mouse.up();
      for (const k of keys.slice().reverse()) await page.keyboard.up(k);
      return label;
    };
    const label = await turn(20, [], 'light');
    assert.match(label, /^\d+\.\d°$/, 'the angle by the pivot, e.g. 20.0°');
    approx(await angleNow(), 20, 3, 'turned by about 20°'); approx(parseFloat(label), await angleNow(), 0.06);
    assert.match(await prompt(), /^Plate A turned to [\d.]+°/);
    assert.equal(await page.locator('[data-group=tools] [data-rot]').count(), 4, 'still in rotate mode');
    await menuItem('View', 'Theme: dark'); await page.waitForTimeout(150);
    await turn(23, ['Shift'], 'dark');
    await menuItem('View', 'Theme: light'); await page.waitForTimeout(100);
    assert.equal((await angleNow()) % 15, 0, 'Shift: a multiple of 15°, got ' + await angleNow());
    // drag the pivot: it becomes Custom
    const pv = await pivotPx(), pw = await rectOf(t('drawing'));
    await page.mouse.move(pv.x, pv.y); await page.mouse.down(); await page.mouse.move(pv.x + 60, pv.y + 40, { steps: 3 }); await page.mouse.up();
    assert.equal(await t('rot-pivot').inputValue(), 'custom');
    assert.equal(await t('rot-px').isDisabled(), false);
    const pvx = Number(await t('rot-px').inputValue()), pvy = Number(await t('rot-py').inputValue());
    assert.match(await t('cmd-hist').textContent(), new RegExp(`Pivot: ${pvx.toFixed(2)}, ${pvy.toFixed(2)}`));
    void pw;
    // a typed angle turns to it about the pivot (the pivot does not move)
    const before = await angleNow();
    await cmdLine().fill('75'); await cmdLine().press('Enter');
    assert.equal(await angleNow(), 75);
    assert.equal(Number(await t('rot-px').inputValue()), pvx);
    void before;
    await cmdLine().fill('abc'); await cmdLine().press('Enter');
    assert.match(await prompt(), /Unknown command: abc/);
    // the Rotate section's pivot select
    await t('rot-pivot').selectOption('bl');
    assert.equal(await t('rot-px').isDisabled(), true);
    await t('pa').fill('90'); await t('pa').press('Enter');
    const corner = [Number(await t('rot-px').inputValue()), Number(await t('rot-py').inputValue())];
    await t('pa').fill('120'); await t('pa').press('Enter');
    assert.deepEqual([Number(await t('rot-px').inputValue()), Number(await t('rot-py').inputValue())], corner, 'turned about its own lower-left corner: that corner stays put');
    await t('rot-pivot').selectOption('centre');
    // click once more: back to the plain selection (and Esc does the same)
    const q2 = await partPoint(0.5);
    await page.mouse.click(q2.x, q2.y);
    assert.equal(await page.locator('[data-group=tools] [data-rot]').count(), 0);
    assert.equal(await page.locator('[data-group=tools] .grip-sq').count(), 1);
    const q3 = await partPoint(0.5);
    await page.mouse.click(q3.x, q3.y);
    assert.equal(await page.locator('[data-group=tools] [data-rot]').count(), 4);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-group=tools] [data-rot]').count(), 0, 'Esc ends rotate mode');
    assert.doesNotMatch(await t('cmd-hist').textContent(), /ROTATE/);
  });

  await step('placing: Mirror X flips left to right, Mirror Y top to bottom; twice is the start; the Rotate/Mirror sections do the same', async () => {
    await t('pa').fill('0'); await t('pa').press('Enter');
    await t('pa').fill('30'); await t('pa').press('Enter');
    const start = [await pos(), await angleNow(), Number(await t('pw').inputValue())];
    await t('bar-mirror-x').click();
    assert.match(await prompt(), /^Plate A mirrored left to right \(X\)/);
    assert.equal(await angleNow(), 330, 'a mirror reverses the turn');
    assert.equal(Number(await t('pw').inputValue()), start[2], 'the box is the same size');
    await t('mirror-x').click();
    assert.deepEqual([await pos(), await angleNow()], [start[0], start[1]], 'twice is the start');
    await t('mirror-y').click();
    assert.match(await prompt(), /mirrored top to bottom \(Y\)/);
    assert.equal(await angleNow(), 330);
    await t('bar-mirror-y').click();
    assert.deepEqual([await pos(), await angleNow()], [start[0], start[1]]);
    await page.keyboard.press('Control+z');
    assert.equal(await angleNow(), 330, 'undo takes back a mirror');
    await page.keyboard.press('Control+y');
    assert.equal(await angleNow(), 30);
    await t('pa').fill('0'); await t('pa').press('Enter');
  });

  await step('exe review fixes: with no grid part the step footer is only its hint (no floating 0); Duplicate says when copies land on other parts', async () => {
    await freshLayoutWithPlate();
    assert.equal(await t('step-foot').evaluate((e) => e.classList.contains('idle')), true);
    assert.equal(await t('count').isVisible(), false, 'no big 0');
    assert.equal(await t('apply').isVisible(), false);
    assert.equal(await t('step-foot').evaluate((e) => getComputedStyle(e).position), 'static');
    await t('px').fill('50'); await t('px').press('Enter'); await t('py').fill('100'); await t('py').press('Enter');
    await t('dup-count').fill('1'); await t('dup-count').press('Enter'); await t('dup-gap').fill('5'); await t('dup-gap').press('Enter');
    await t('dup-x').click(); await t('dup-go').click();
    assert.doesNotMatch(await prompt(), /on top of/);
    await t('dup-negx').click(); await t('dup-go').click();               // back from the copy: onto the original
    assert.match(await prompt(), /1 copy lands on top of other parts/);
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    await t('dup-x').click(); await t('dup-count').fill('3'); await t('dup-count').press('Enter');
  });

  await step('placing: Duplicate along X or Y (gap edge to edge), Copy once / Ctrl+D, Delete, off the sheet is tinted and said once', async () => {
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });      // markPixels looks for the light mark colour
    await freshLayoutWithPlate();
    await t('px').fill('50'); await t('px').press('Enter'); await t('py').fill('100'); await t('py').press('Enter');
    assert.equal(await t('dup-x').getAttribute('aria-pressed'), 'true');
    assert.equal(await t('dup-gap').inputValue(), '5'); assert.equal(await t('dup-count').inputValue(), '3');
    await t('dup-go').click();
    assert.equal(await nParts(), 4);
    assert.match(await prompt(), /^3 copies of Plate A to the right, 5 mm apart, edge to edge:?$/);
    assert.deepEqual(await pos(), [50 + 3 * 105, 100], 'the last copy is selected');
    await t('dup-y').click(); assert.equal(await t('dup-y').getAttribute('aria-pressed'), 'true');
    await t('dup-gap').fill('20'); await t('dup-gap').press('Enter'); await t('dup-count').fill('2'); await t('dup-count').press('Enter');
    await t('dup-go').click();
    assert.equal(await nParts(), 6);
    assert.deepEqual(await pos(), [365, 100 + 2 * 80]);
    // the other way: left and down (his pick, 2026-10-18), then undo them both
    await t('dup-negx').click(); assert.equal(await t('dup-negx').getAttribute('aria-pressed'), 'true');
    await t('dup-count').fill('1'); await t('dup-count').press('Enter'); await t('dup-go').click();
    assert.match(await prompt(), /^1 copy of Plate A to the left, 20 mm apart/);
    assert.deepEqual(await pos(), [365 - 120, 260]);
    await t('dup-negy').click(); await t('dup-go').click();
    assert.deepEqual(await pos(), [245, 260 - 80]);
    assert.equal(await nParts(), 8);
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    assert.equal(await nParts(), 6);
    await t('dup-count').fill('2'); await t('dup-count').press('Enter');
    await t('dup-count').fill('0'); await t('dup-count').press('Enter');
    assert.match(await prompt(), /Copies must be a whole number from 1 to 200/);
    assert.equal(await t('dup-count').inputValue(), '2');
    await t('dup-gap').fill('-1'); await t('dup-gap').press('Enter');
    assert.match(await prompt(), /The distance between copies must be 0 or more/);
    // copies off the sheet are still placed, with a warning; they are tinted
    assert.equal(await markPixels() < 20, true, 'nothing orange while everything is on the sheet');
    await t('dup-x').click(); await t('dup-gap').fill('0'); await t('dup-gap').press('Enter'); await t('dup-count').fill('10'); await t('dup-count').press('Enter');
    await t('dup-go').click();
    assert.equal(await nParts(), 16);
    assert.match(await prompt(), /^10 copies of Plate A to the right, 0 mm apart, edge to edge\. \d+ of the copies are off the sheet \(drawn in orange\)\. They are still placed:?$/);
    let orange = await markPixels();
    for (let i = 0; i < 40 && orange <= 30; i++) { await page.waitForTimeout(50); orange = await markPixels(); }
    assert.ok(orange > 30, 'a part off the sheet is drawn in the mark colour: ' + orange);
    await page.keyboard.press('Control+z');
    assert.equal(await nParts(), 6, 'one undo takes the whole row back');
    // Copy once and Ctrl+D: 10 mm right and up, selected; never exactly on another copy
    const p0 = await pos();
    await t('dup-one').click();
    assert.deepEqual(await pos(), [p0[0] + 10, p0[1] + 10]);
    await page.keyboard.press('Control+d');
    assert.deepEqual(await pos(), [p0[0] + 20, p0[1] + 20], 'Ctrl+D copies the copy');
    assert.equal(await nParts(), 8);
    assert.match(await prompt(), /^Plate A duplicated: the copy is at X /);
    // Delete removes the selected part; Ctrl+Z brings it back
    await page.keyboard.press('Delete');
    assert.equal(await nParts(), 7);
    assert.match(await prompt(), /^Plate A deleted\. Ctrl\+Z brings it back:?$/);
    await page.keyboard.press('Control+z');
    assert.equal(await nParts(), 8);
    // moving one part off the sheet says so once, and a part back on the sheet loses the tint
    await t('px').fill('950'); await t('px').press('Enter');
    assert.match(await prompt(), /Plate A moved to X 950\.00 Y \d+\.\d\d\. Plate A is off the sheet \(drawn in orange\)\. It is still placed:?$/);
    await t('px').fill('900'); await t('px').press('Enter');
    assert.doesNotMatch(await prompt(), /off the sheet/);
  });

  await step('placing: a part of the step and repeat grid becomes a placed part of its own when it is changed', async () => {
    await t('new-layout').click();
    await t('panel-library').click(); await libCard('Plate A').locator('[data-testid=lib-add]').click(); await t('panel-main').click();
    await t('apply').isDisabled();
    await t('part').selectOption({ index: 1 });
    const n = Number(await t('count').textContent());
    assert.ok(n > 4);
    await page.locator('[data-group=parts] [data-i="3"] .part-hit').click({ force: true });
    assert.equal(await t('placed-kind').textContent(), 'placed part · step and repeat');
    await t('px').fill('5'); await t('px').press('Enter');
    assert.match(await prompt(), /The step and repeat grid became separate placed parts/);
    assert.equal(await t('count').textContent(), '0', 'the grid is cleared, as Apply does');
    assert.equal(await nParts(), n + 1);
    assert.equal((await pos())[0], 5);
    await page.keyboard.press('Control+z');
    assert.equal(await t('count').textContent(), String(n), 'undo brings the grid back');
    assert.equal(await nParts(), n + 1 - 0, 'the same parts');
    await closeTabs(/./);
  });

  await step('placing: saved with its rotation and mirror, reopened the same, the PDF draws it; screenshots light and dark', async () => {
    await freshLayoutWithPlate();
    await t('px').fill('200'); await t('px').press('Enter'); await t('py').fill('300'); await t('py').press('Enter');
    await t('pa').fill('33'); await t('pa').press('Enter');
    await t('bar-mirror-x').click();
    const angle = await angleNow(), at1 = await pos(), box1 = [await t('pw').inputValue(), await t('ph').inputValue()];
    assert.equal(angle, 327);
    // a second part, turned, mirrored the other way, and a third on its own for the picture
    await t('dup-one').click(); await t('px').fill('500'); await t('px').press('Enter'); await t('py').fill('250'); await t('py').press('Enter');
    await t('bar-mirror-y').click(); await t('pa').fill('75'); await t('pa').press('Enter');
    await t('dup-one').click(); await t('pa').fill('0'); await t('pa').press('Enter'); await t('px').fill('700'); await t('px').press('Enter'); await t('py').fill('450'); await t('py').press('Enter');
    // the third part in rotate mode, for the picture
    await t('px').fill('600'); await t('px').press('Enter');
    const q = await partPoint(0.5);
    await page.mouse.click(q.x, q.y);
    await page.locator('aside.panel').evaluate((e) => { e.scrollTop = 0; });
    await shotBoth('placing-rotate');
    await page.keyboard.press('Escape');
    const dl = await downloaded(() => page.keyboard.press('Control+s'));
    const doc = readDxf(dl.text), v = (e, c) => (e.r.c.includes(c) ? +e.r.v[e.r.c.indexOf(c)] : null);
    const ins = doc.entities.filter((e) => e.type === 'INSERT');
    assert.equal(ins.length, 3);
    approx(v(ins[0], 50), 327, 1e-5); assert.equal(v(ins[0], 41), -1); assert.equal(v(ins[0], 42) ?? 1, 1);
    assert.equal(v(ins[1], 42), -1, 'the second part is mirrored top to bottom'); approx(v(ins[1], 50), 75, 1e-5);
    // reopen it: the same angle and mirror
    await closeTabs(/./);
    await t('picker').setInputFiles({ name: 'Turned.dxf', mimeType: 'text/plain', buffer: Buffer.from(dl.text, 'latin1') });
    await page.waitForFunction(() => { const b = document.querySelector('.tabs .dtab.on'); return b && b.dataset.kind === 'layout' && b.textContent.startsWith('Turned.dxf'); });
    await page.locator('[data-group=parts] [data-i="0"] .part-hit').click({ force: true });
    assert.equal(await angleNow(), angle, 'the angle came back');
    assert.deepEqual(await pos(), at1); assert.deepEqual([await t('pw').inputValue(), await t('ph').inputValue()], box1);
    await t('bar-mirror-x').click();
    assert.equal(await angleNow(), 33, 'it was mirrored when saved: mirroring again gives the unmirrored 33°');
    await page.keyboard.press('Control+z');
    // the PDF of the layout draws the turned, mirrored parts where the sheet shows them
    await t('pdf-open').click();
    await t('pdf-dialog').waitFor();
    await t('pdf-page-sheet').check();
    const pdf = await downloaded(() => t('pdf-go').click());
    assert.ok(pdf.text.startsWith('%PDF'), 'a PDF was written');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    if (await t('pdf-dialog').count()) await page.locator('[data-testid=pdf-dialog] button', { hasText: /Close|Cancel/ }).first().click().catch(() => {});
    await page.locator('aside.panel').evaluate((e) => { e.scrollTop = 0; });
    await shotBoth('placing-turned');
    // the smallest window: the bar with a part selected still fits on one row
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.waitForTimeout(200);
    const bar = await rectOf(t('propbar')), kids = await t('propbar').locator('> *:not([hidden])').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
    await page.screenshot({ path: `${shotDir}/s12-placing-1024-light.png` });
    for (const r of kids) assert.ok(r.y + r.height <= bar.y + bar.height + 1 && r.x + r.width <= bar.x + bar.width + 1, 'the property bar overflows at 1024: ' + JSON.stringify([r, bar]));
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  // ---- TODO 36: several parts selected; Arrange (align and distribute) ----
  /** The boxes (mm, y up) of the outlines drawn round the selected parts, in pick order. */
  const selBoxes = () => page.evaluate(() => {
    const H = Number(document.querySelector('[data-key=sheetH]').value);
    return [...document.querySelectorAll('[data-group=tools] .sel-multi')].map((p) => {
      const pts = p.getAttribute('points').split(' ').map((q) => q.split(',').map(Number));
      return [Math.min(...pts.map((q) => q[0])), H - Math.max(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), H - Math.min(...pts.map((q) => q[1]))].map((v) => Math.round(v * 100) / 100);
    });
  });
  const ppSize = () => t('pp-size').textContent();
  /** Three parts of different sizes at different heights: Plate A, Dial, Plate B. */
  const threeParts = async () => {
    await freshLayoutWithPlate();
    await t('px').fill('100'); await t('px').press('Enter'); await t('py').fill('420'); await t('py').press('Enter');
    await t('panel-library').click();
    await libCard('Dial').locator('[data-testid=lib-add]').click();
    await t('panel-main').click();
    await t('px').fill('400'); await t('px').press('Enter'); await t('py').fill('300'); await t('py').press('Enter');
    await t('panel-library').click();
    await libCard('Plate A').locator('[data-testid=lib-add]').click();
    await t('panel-main').click();
    await t('px').fill('700'); await t('py').fill('360'); await t('py').press('Enter'); await t('px').press('Enter');
  };
  await step('TODO 36: Shift-click adds and removes parts; a rubber band selects the parts fully inside; the pick-order numbers, the box and its readout, the Arrange section', async () => {
    await threeParts();
    assert.equal(await t('pp-name').textContent(), 'Plate A');
    assert.equal(await page.locator('[data-testid=sec-arrange]').isVisible(), false, 'one part selected: no Arrange section');
    assert.equal(await t('bar-group').isVisible(), false);
    // Shift-click adds
    await click(150, 450, { shift: true });
    assert.equal(await t('pp-name').textContent(), '2 parts');
    assert.equal(await page.locator('[data-testid=sec-arrange]').isVisible(), true);
    assert.equal(await page.locator('[data-group=tools] .pick-badge').count(), 2);
    assert.match(await prompt(), /^Align or distribute \[Left \/ Centre \/ Right \/ Top \/ Middle \/ Bottom \/ Horizontal \/ Vertical\]:?$/);
    assert.match(await t('cmd-hist').textContent(), /^Command: SELECT {3}2 parts selected \(Shift-click adds or removes a part\)$/);
    // ... and takes a part out
    await click(150, 450, { shift: true });
    assert.equal(await page.locator('[data-testid=sec-arrange]').isVisible(), false, 'back to one part');
    assert.equal(await t('pp-name').textContent(), 'Plate A');
    // a rubber band from empty sheet selects what is fully inside
    await dragMm([40, 600], [650, 200]);
    assert.equal(await t('pp-name').textContent(), '2 parts', 'Plate B is not fully inside the box');
    await dragMm([40, 650], [960, 150]);
    assert.equal(await t('pp-name').textContent(), '3 parts');
    const badges = await page.locator('[data-group=tools] .pick-badge text').allTextContents();
    assert.deepEqual(badges, ['1', '2', '3']);
    assert.match(await t('sel-readout').textContent(), /^3 parts · \d+\.\d\d × \d+\.\d\d$/);
    assert.equal(await page.locator('[data-group=tools] .sel-union').count(), 1);
    assert.equal(await page.locator('[data-group=tools] .grip-sq rect').count(), 8);
    assert.equal(await t('members').locator('li').count(), 3);
    assert.equal(await t('hint-pill').textContent(), 'Rubber-band or Shift-click to select several parts · the number is the pick order');
    const heads = await page.locator('aside.panel > .contents > section:not([hidden]) h2.sec').allTextContents();
    assert.deepEqual(heads.slice(0, 7), ['Selected parts', 'Arrange', 'Group and lock', 'Rotate', 'Mirror', 'Duplicate', 'Nudge']);
    assert.deepEqual(await page.locator('[data-testid=sec-arrange] button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label'))),
      ['Align left', 'Align centre', 'Align right', 'Align top', 'Align middle', 'Align bottom', 'Distribute horizontally', 'Distribute vertically']);
    assert.deepEqual(await t('arrange-rel').locator('option').allTextContents(), ['Selection', 'Sheet', 'First selected']);
    assert.equal(await t('arrange-rel').inputValue(), 'selection');
    // the bar and the panel say what is selected
    assert.equal(await t('placed-name').textContent(), '3 parts selected');
    assert.equal(await t('pa').inputValue(), '0°');
    await page.locator('aside.panel').evaluate((e) => { e.scrollTop = 0; });
    await shotBoth('arrange-three');
    // the smallest window: the bar with several parts selected (Group, Lock) still fits on one row, with room to spare for CI's wider fonts
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.waitForTimeout(200);
    const bar = await rectOf(t('propbar')), kids = await t('propbar').locator('> *:not([hidden])').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
    await page.screenshot({ path: `${shotDir}/s12-arrange-1024-light.png` });
    for (const r of kids) assert.ok(r.y + r.height <= bar.y + bar.height + 1 && r.x + r.width <= bar.x + bar.width - 20, 'the property bar overflows or is too tight at 1024: ' + JSON.stringify([r, bar]));
    const barInner = await t('propbar').evaluate((e) => [e.scrollWidth, e.clientWidth]);
    assert.ok(barInner[0] <= barInner[1], 'no horizontal overflow ' + barInner);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await step('Select all in a layout: Ctrl+A and Edit → Select all pick every placed part; Delete removes them all as one step; Ctrl+Z brings them back', async () => {
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+a');
    assert.equal(await t('pp-name').textContent(), '3 parts');
    assert.equal(await page.locator('[data-group=tools] .pick-badge').count(), 3);
    await dragMm([40, 700], [60, 690]);                          // an empty corner: back to nothing
    await page.locator('[data-menu=Edit]').click();
    await page.getByRole('menuitem', { name: /^Select all/ }).click();
    assert.equal(await t('pp-name').textContent(), '3 parts');
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => document.querySelectorAll('[data-group=tools] .pick-badge').length === 0);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+a');
    assert.equal(await t('pp-name').textContent(), '3 parts', 'all three are back');
  });

  await step('TODO 36: Align left / centre / right / top / middle / bottom, relative to the selection, the sheet and the first selected', async () => {
    const before = await selBoxes();
    const w = (b) => b[2] - b[0], hh = (b) => b[3] - b[1];
    const near = (a, b, m) => approx(a, b, 0.02, m);
    await t('align-left').click();
    let b = await selBoxes();
    for (const x of b) near(x[0], Math.min(...before.map((q) => q[0])), 'left edges meet');
    assert.match(await prompt(), /^3 parts aligned left to the selection:?$/);
    await page.keyboard.press('Control+z');
    assert.deepEqual(await selBoxes(), before, 'one undo step puts them back');
    await t('align-right').click(); b = await selBoxes();
    for (const x of b) near(x[2], Math.max(...before.map((q) => q[2])), 'right edges meet');
    await page.keyboard.press('Control+z');
    await t('align-centre').click(); b = await selBoxes();
    const cx = (Math.min(...before.map((q) => q[0])) + Math.max(...before.map((q) => q[2]))) / 2;
    for (const x of b) near((x[0] + x[2]) / 2, cx, 'centres meet');
    await page.keyboard.press('Control+z');
    await t('align-top').click(); b = await selBoxes();
    for (const x of b) near(x[3], Math.max(...before.map((q) => q[3])), 'top edges meet (y up)');
    await page.keyboard.press('Control+z');
    await t('align-bottom').click(); b = await selBoxes();
    for (const x of b) near(x[1], Math.min(...before.map((q) => q[1])), 'bottom edges meet');
    await page.keyboard.press('Control+z');
    await t('align-middle').click(); b = await selBoxes();
    const cy = (Math.min(...before.map((q) => q[1])) + Math.max(...before.map((q) => q[3]))) / 2;
    for (const x of b) near((x[1] + x[3]) / 2, cy, 'middles meet');
    await page.keyboard.press('Control+z');
    // relative to the sheet: left edges on the sheet's left edge, bottoms on its bottom
    await t('arrange-rel').selectOption('sheet');
    await t('align-left').click(); b = await selBoxes();
    for (const x of b) near(x[0], 0, 'sheet left');
    assert.match(await prompt(), /aligned left to the sheet:?$/);
    await t('align-top').click(); b = await selBoxes();
    for (const x of b) near(x[3], 700, 'sheet top');
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    assert.deepEqual(await selBoxes(), before);
    // relative to the first selected: it stays where it is (the numbers are the pick order; part 1 is Plate A)
    await t('arrange-rel').selectOption('first');
    await t('align-right').click(); b = await selBoxes();
    near(b[0][2], before[0][2], 'the first selected stays'); for (const x of b) near(x[2], before[0][2], 'right edges meet the first one\'s');
    assert.deepEqual(b[0], before[0]);
    await page.keyboard.press('Control+z');
    await t('arrange-rel').selectOption('selection');
    assert.deepEqual(await selBoxes(), before);
    assert.ok(before.every((x, i) => w(x) > 0 && hh(x) > 0 && i >= 0));
  });

  await step('TODO 36: Distribute horizontally / vertically with equal gaps (selection span or the sheet); needs three; the command line words work', async () => {
    const before = await selBoxes();
    await t('distribute-horizontal').click();
    let b = (await selBoxes()).slice().sort((p, q) => p[0] - q[0]);
    const g1 = b[1][0] - b[0][2], g2 = b[2][0] - b[1][2];
    approx(g1, g2, 0.02, 'equal gaps');
    approx(b[0][0], Math.min(...before.map((q) => q[0])), 0.02, 'the outer two stay'); approx(b[2][2], Math.max(...before.map((q) => q[2])), 0.02);
    assert.match(await prompt(), /^3 parts distributed horizontally with equal gaps, gaps of -?[\d.]+ mm \(the selection\):?$/);
    await page.keyboard.press('Control+z');
    await t('distribute-vertical').click();
    b = (await selBoxes()).slice().sort((p, q) => p[1] - q[1]);
    approx(b[1][1] - b[0][3], b[2][1] - b[1][3], 0.02, 'equal vertical gaps');
    await page.keyboard.press('Control+z');
    // across the sheet: the first touches the left edge, the last the right
    await t('arrange-rel').selectOption('sheet');
    await t('distribute-horizontal').click();
    b = (await selBoxes()).slice().sort((p, q) => p[0] - q[0]);
    approx(b[0][0], 0, 0.02, 'left edge'); approx(b[2][2], 1000, 0.02, 'right edge'); approx(b[1][0] - b[0][2], b[2][0] - b[1][2], 0.02);
    await page.keyboard.press('Control+z');
    await t('arrange-rel').selectOption('selection');
    // the command line: the words in the prompt
    await cmdLine().fill('left'); await page.keyboard.press('Enter'); await page.evaluate(() => document.activeElement.blur());
    b = await selBoxes();
    for (const x of b) approx(x[0], Math.min(...before.map((q) => q[0])), 0.02);
    await page.keyboard.press('Control+z');
    assert.deepEqual(await selBoxes(), before);
    // two parts cannot be distributed
    await click(150, 450, { shift: true });                       // Plate A goes out
    assert.equal(await t('pp-name').textContent(), '2 parts');
    await t('distribute-horizontal').click();
    assert.match(await prompt(), /^Distribute needs three or more objects \(a group counts as one\):?$/);
  });

  await step('TODO 36: dragging any selected part moves them all; arrows nudge, Mirror and Delete act on all; a click on one of them selects just it', async () => {
    await dragMm([40, 650], [960, 150]);
    assert.equal(await t('pp-name').textContent(), '3 parts');
    const before = await selBoxes();
    await dragMm([408, 308], [438, 358]);                          // press on the Dial, drag by (30, 50)
    let b = await selBoxes();
    b.forEach((x, i) => { approx(x[0], before[i][0] + 30, 1.2, 'x ' + i); approx(x[1], before[i][1] + 50, 1.2, 'y ' + i); });
    assert.match(await prompt(), /^3 parts moved to X [\d.]+ Y [\d.]+/);
    assert.equal((await tabs()).some((x) => x.includes('•')), true);
    await page.keyboard.press('Control+z');
    assert.deepEqual(await selBoxes(), before, 'one undo step for the whole drag');
    // Esc during a drag puts them all back
    await dragMm([408, 308], [478, 358], [], async () => { await page.keyboard.press('Escape'); });
    assert.deepEqual(await selBoxes(), before);
    // arrow keys
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp');
    b = await selBoxes();
    b.forEach((x, i) => { approx(x[0], before[i][0] + 1, 0.02); approx(x[1], before[i][1] + 1, 0.02); });
    await page.keyboard.press('Shift+ArrowLeft');
    b = await selBoxes(); approx(b[0][0], before[0][0] - 9, 0.02);
    // typed X moves the selection's box: its lower-left lands there
    const ub = [Math.min(...before.map((q) => q[0])), Math.min(...before.map((q) => q[1]))];
    await t('px').fill('50'); await t('px').press('Enter');
    b = await selBoxes(); approx(Math.min(...b.map((q) => q[0])), 50, 0.02);
    // Mirror X: the whole selection flips left to right about its middle
    const m0 = await selBoxes(), lo = Math.min(...m0.map((q) => q[0])), hi = Math.max(...m0.map((q) => q[2]));
    await t('bar-mirror-x').click();
    b = await selBoxes();
    b.forEach((x, i) => { approx(x[0], lo + hi - m0[i][2], 0.05, 'mirrored x0 ' + i); approx(x[1], m0[i][1], 0.05); });
    await t('bar-mirror-x').click();
    b = await selBoxes(); b.forEach((x, i) => approx(x[0], m0[i][0], 0.05, 'twice is the start'));
    // Angle: a turn of the whole selection about its middle
    await t('pa').fill('90'); await t('pa').press('Enter');
    assert.match(await prompt(), /^3 parts turned by 90° about the middle of the selection/);
    await page.keyboard.press('Control+z');
    // Copy once / Ctrl+D duplicates all three, and selects the copies
    await page.keyboard.press('Control+d');
    assert.equal(await nParts(), 6);
    assert.equal(await t('pp-name').textContent(), '3 parts');
    await page.keyboard.press('Control+z');
    assert.equal(await nParts(), 3);
    // Delete removes all three, one undo brings them back
    await dragMm([20, 690], [980, 100]);
    assert.equal(await t("pp-name").textContent(), "3 parts");
    await page.keyboard.press('Delete');
    assert.equal(await nParts(), 0);
    assert.match(await prompt(), /^3 parts deleted. Ctrl\+Z brings them back:?$/);
    await page.keyboard.press('Control+z');
    assert.equal(await nParts(), 3);
    // a plain click on one of the selected parts selects just that one
    await click(408, 308);
    assert.notEqual(await t('pp-name').textContent(), '3 parts');
    assert.equal(await page.locator('[data-testid=sec-arrange]').isVisible(), false);
  });

  // ---- TODO 37: Group, Ungroup, Lock, Unlock ----
  const rightClickMm = async (x, y) => { const p = await at(x, y); await page.mouse.click(p.x, p.y, { button: 'right' }); };
  const padlocks = () => page.locator('[data-group=tools] .padlock').count();
  const LOCKED_MSG = /^Locked: Unlock to move it:?$/;
  /** Plate A, Dial, Plate A as in threeParts, plus a lone Dial high on the right. */
  const fourParts = async () => {
    await threeParts();
    await t('panel-library').click();
    await libCard('Dial').locator('[data-testid=lib-add]').click();
    await t('panel-main').click();
    await t('px').fill('850'); await t('px').press('Enter'); await t('py').fill('600'); await t('py').press('Enter');
  };
  await step('TODO 37: Ctrl+G groups the selected parts, a click on a member selects the group, "Group of N" in the bar, the panel and on the canvas; it moves as one; Ctrl+Shift+G ungroups', async () => {
    await fourParts();
    await dragMm([40, 500], [960, 150]);
    assert.equal(await t('pp-name').textContent(), '3 parts');
    assert.equal(await t('bar-group').getAttribute('title'), 'Group the selected parts (Ctrl+G)');
    await page.keyboard.press('Control+g');
    assert.match(await prompt(), /^Grouped 3 parts: a click on one selects the group, and it moves, turns and copies as one \(Ctrl\+Shift\+G ungroups\):?$/);
    assert.equal(await t('placed-name').textContent(), 'Group of 3');
    assert.equal(await t('placed-kind').textContent(), 'group');
    assert.equal(await t('pp-name').textContent(), 'Group of 3');
    assert.equal(await page.locator('[data-testid=sec-part] h2').textContent(), 'Selected group');
    assert.equal(await t('bar-group').innerText(), 'Ungroup');
    assert.equal(await t('sel-readout').textContent(), 'Group of 3');
    assert.equal(await page.locator('[data-group=tools] .group-tag').count(), 1);
    assert.equal(await page.locator('[data-group=tools] .pick-badge').count(), 0, 'no pick-order numbers on a whole group');
    assert.equal(await t('members').locator('li').count(), 3);
    assert.match(await t('cmd-hist').textContent(), /^Command: SELECT {3}Group of 3 /);
    assert.equal(await t('hint-pill').textContent(), 'A group moves, turns and copies as one part · Ctrl+Shift+G ungroups');
    const heads = await page.locator('aside.panel > .contents > section:not([hidden]) h2.sec').allTextContents();
    assert.deepEqual(heads.slice(0, 3), ['Selected group', 'Arrange', 'Group and lock']);
    assert.equal(await t('grp-group').isDisabled(), true); assert.equal(await t('grp-ungroup').isDisabled(), false);
    assert.equal(await t('grp-lock').isDisabled(), false); assert.equal(await t('grp-unlock').isDisabled(), true);
    // a click elsewhere selects the lone Dial; a click on a member selects the whole group
    await click(858, 608);
    assert.equal(await t('pp-name').textContent(), 'Dial');
    await click(150, 450);
    assert.equal(await t('pp-name').textContent(), 'Group of 3', 'one click on a member selects the group');
    await click(500, 650);                                         // empty sheet: the group stays selected
    assert.equal(await t('pp-name').textContent(), 'Group of 3');
    // it moves as one (a drag on the Dial, a member)
    const before = await selBoxes();
    await dragMm([408, 308], [438, 358]);
    (await selBoxes()).forEach((x, i) => { approx(x[0], before[i][0] + 30, 1.2); approx(x[1], before[i][1] + 50, 1.2); });
    assert.match(await prompt(), /^3 parts moved to X /);
    await page.keyboard.press('Control+z');
    // as one object for Align: Shift-click adds the lone Dial; aligned left, the group keeps its shape
    await click(858, 608, { shift: true });
    assert.equal(await t('pp-name').textContent(), '4 parts');
    const b4 = await selBoxes();
    await t('align-left').click();
    const a4 = await selBoxes();
    approx(a4[3][0], Math.min(...b4.map((q) => q[0])), 0.02, 'the lone part goes to the left edge');
    for (let i = 0; i < 3; i++) approx(a4[i][0] - a4[0][0], b4[i][0] - b4[0][0], 0.02, 'the group kept its shape');
    await page.keyboard.press('Control+z');
    await t('distribute-horizontal').click();
    assert.match(await prompt(), /^Distribute needs three or more objects \(a group counts as one\):?$/);
    await click(858, 608, { shift: true });                        // takes the Dial out again
    assert.equal(await t('pp-name').textContent(), 'Group of 3');
    // a copy of a group is a group of its own
    await page.keyboard.press('Control+d');
    assert.equal(await nParts(), 7);
    assert.equal(await t('pp-name').textContent(), 'Group of 3', 'the copy is a group');
    await click(150, 450);
    assert.equal(await t('pp-name').textContent(), 'Group of 3');
    await page.keyboard.press('Control+z');
    assert.equal(await nParts(), 4);
    // Ctrl+Shift+G ungroups: the parts stay selected, separate
    await page.keyboard.press('Control+Shift+g');
    assert.match(await prompt(), /^Ungrouped: 3 parts are separate again, still selected:?$/);
    assert.equal(await t('pp-name').textContent(), '3 parts');
    assert.equal(await t('bar-group').innerText(), 'Group');
    assert.equal(await page.locator('[data-group=tools] .pick-badge').count(), 3);
    await click(150, 450);
    assert.equal(await t('pp-name').textContent(), 'Plate A', 'one click now selects one part');
    await page.keyboard.press('Control+z');                        // undo Ungroup: the group is back
    await click(150, 450);
    assert.equal(await t('pp-name').textContent(), 'Group of 3');
    // Group needs two or more
    await click(858, 608);
    await page.keyboard.press('Control+g');
    assert.match(await prompt(), /^Group: select two or more parts first/);
  });

  await step('TODO 37: Lock: a locked part cannot be moved, nudged, turned, mirrored or deleted ("Locked: Unlock to move it"); a padlock marks it; Unlock frees it; the menu and panel buttons work', async () => {
    await freshLayoutWithPlate();
    assert.equal(await padlocks(), 0);
    const p0 = await pos();
    await t('bar-lock').click();
    assert.match(await prompt(), /^Plate A locked: it cannot be moved, turned, mirrored or deleted until you unlock it:?$/);
    assert.equal(await padlocks(), 1);
    assert.equal(await t('lock-chip').isVisible(), true); assert.equal(await t('pp-lock').isVisible(), true);
    assert.equal(await t('bar-lock').innerText(), 'Unlock');
    assert.equal(await t('px').isDisabled(), true); assert.equal(await t('py').isDisabled(), true); assert.equal(await t('pa').isDisabled(), true);
    assert.equal(await t('pp-x').isDisabled(), true); assert.equal(await t('rot-angle').isDisabled(), true);
    assert.equal(await t('nudge-step').isDisabled(), false, 'the nudge step is a setting, not the part');
    assert.equal(await t('grp-lock').isDisabled(), true); assert.equal(await t('grp-unlock').isDisabled(), false);
    // drag
    await dragMm([p0[0] + 50, p0[1] + 30], [p0[0] + 120, p0[1] + 90]);
    assert.deepEqual(await pos(), p0); assert.match(await prompt(), LOCKED_MSG);
    // nudge
    await page.keyboard.press('ArrowRight');
    assert.deepEqual(await pos(), p0); assert.match(await prompt(), LOCKED_MSG);
    // mirror
    await t('bar-mirror-x').click();
    assert.deepEqual(await pos(), p0); assert.match(await prompt(), LOCKED_MSG);
    assert.equal(await angleNow(), 0);
    // turning by hand: a click on the selected part does not start it
    await click(p0[0] + 50, p0[1] + 30);
    assert.equal(await page.locator('[data-group=tools] [data-rot]').count(), 0, 'no turn arrows on a locked part');
    assert.match(await prompt(), LOCKED_MSG);
    // delete (key and Edit menu)
    await page.keyboard.press('Delete');
    assert.equal(await nParts(), 1); assert.match(await prompt(), LOCKED_MSG);
    await menuItem('Edit', 'Delete');
    assert.equal(await nParts(), 1);
    // typed values
    await t('pa').evaluate((e) => { e.disabled = false; });
    await t('pa').fill('45'); await t('pa').press('Enter');
    assert.equal(await angleNow(), 0);
    // the right-click menu
    await rightClickMm(p0[0] + 50, p0[1] + 30);
    await page.waitForSelector('[data-testid=ctx-menu]');
    assert.deepEqual(await ctxItems(), ['DuplicateCtrl+D', 'Mirror XMX', 'GroupCtrl+G', 'UngroupCtrl+Shift+G', 'Lock', 'Unlock', 'DeleteDel']);
    const enabled = await page.locator('[data-testid=ctx-menu] .mi').evaluateAll((bs) => bs.map((b) => !b.disabled));
    assert.deepEqual(enabled, [true, true, false, false, false, true, true], 'Group / Ungroup / Lock are greyed on one locked part');
    await shotBoth('locked', async () => { if (!(await t('ctx-menu').count())) await rightClickMm(p0[0] + 50, p0[1] + 30); await page.waitForSelector('[data-testid=ctx-menu]'); }, async () => { await page.keyboard.press('Escape'); });
    await rightClickMm(p0[0] + 50, p0[1] + 30); await page.waitForSelector('[data-testid=ctx-menu]');
    await page.locator('[data-testid=ctx-menu] .mi', { hasText: 'Unlock' }).click();
    assert.match(await prompt(), /^Plate A unlocked:?$/);
    assert.equal(await padlocks(), 0);
    assert.equal(await t('px').isDisabled(), false);
    await dragMm([p0[0] + 50, p0[1] + 30], [p0[0] + 120, p0[1] + 90]);
    const moved = await pos(); approx(moved[0], p0[0] + 70, 1.2); approx(moved[1], p0[1] + 60, 1.2);
    await page.keyboard.press('Control+z');
    assert.deepEqual(await pos(), p0);
    // Lock and Unlock from the panel, from the command line, and one undo step each
    await t('grp-lock').click();
    assert.equal(await padlocks(), 1);
    await page.keyboard.press('Control+z');
    assert.equal(await padlocks(), 0);
    await cmdLine().fill('lock'); await page.keyboard.press('Enter'); await page.evaluate(() => document.activeElement.blur());
    assert.equal(await padlocks(), 1);
    await t('grp-unlock').click();
    assert.equal(await padlocks(), 0);
    await t('grp-unlock').isDisabled().then((d) => assert.equal(d, true));
    // a copy of a locked part is not locked
    await t('bar-lock').click();
    await page.keyboard.press('Control+d');
    assert.equal(await nParts(), 2); assert.equal(await padlocks(), 1, 'the original keeps its padlock, the copy has none');
    assert.equal(await t('bar-lock').innerText(), 'Lock', 'the copy is selected and free');
  });

  await step('TODO 37: a locked group: every member is locked, Arrange refuses; groups and locks are saved in the layout file and reopen', async () => {
    await fourParts();
    await dragMm([40, 500], [960, 150]);
    await page.keyboard.press('Control+g');
    await page.keyboard.press('Control+Shift+g');
    await page.keyboard.press('Control+g');                        // grouped again (the ungroup was in between)
    await t('bar-lock').click();
    assert.equal(await padlocks(), 3);
    assert.equal(await t('pp-lock').isVisible(), true);
    assert.match(await prompt(), /^3 parts locked:/);
    await t('align-left').click();
    assert.match(await prompt(), LOCKED_MSG);
    await page.keyboard.press('Delete');
    assert.equal(await nParts(), 4); assert.match(await prompt(), LOCKED_MSG);
    await page.keyboard.press('Control+d');                        // a copy of a locked group is a free group
    assert.equal(await nParts(), 7); assert.equal(await padlocks(), 3);
    assert.equal(await t('pp-name').textContent(), 'Group of 3');
    await page.keyboard.press('Control+z');
    // the lone Dial stays free
    await click(858, 608);
    assert.equal(await padlocks(), 3); assert.equal(await t('bar-lock').innerText(), 'Lock');
    // save, close, reopen
    const dl = await downloaded(() => page.keyboard.press('Control+s'));
    const meta = readMeta(readDxf(dl.text));
    assert.equal(meta.placed.filter((p) => p.lock === true).length, 3, 'three locks in the settings block');
    assert.equal(new Set(meta.placed.filter((p) => p.g).map((p) => p.g)).size, 1, 'one group id');
    assert.equal(meta.placed.filter((p) => p.g).length, 3);
    await closeTabs(/./);
    await t('picker').setInputFiles({ name: 'Grouped.dxf', mimeType: 'text/plain', buffer: Buffer.from(dl.text, 'latin1') });
    await page.waitForFunction(() => { const b = document.querySelector('.tabs .dtab.on'); return b && b.dataset.kind === 'layout' && b.textContent.startsWith('Grouped.dxf'); });
    assert.equal(await padlocks(), 3, 'the padlocks came back');
    await click(150, 450);
    assert.equal(await t('pp-name').textContent(), 'Group of 3', 'the group came back');
    assert.equal(await t('bar-lock').innerText(), 'Unlock');
    await page.locator('aside.panel').evaluate((e) => { e.scrollTop = 0; });
    await shotBoth('group-locked');
    await t('bar-lock').click();                                   // unlock and the whole group moves again
    assert.equal(await padlocks(), 0);
    await page.keyboard.press('Control+Shift+g');
    assert.equal(await t('pp-name').textContent(), '3 parts');
    await page.locator('aside.panel').evaluate((e) => { e.scrollTop = 0; });
  });

  await step('TODO 37: Group / Ungroup / Lock are in the Layout menu; group and lock are named in Undo history; screenshots of a group', async () => {
    await fourParts();
    await dragMm([40, 500], [960, 150]);
    await menuItem('Layout', 'Group');
    assert.equal(await t('pp-name').textContent(), 'Group of 3');
    await page.locator('[data-menu=Layout]').click();
    assert.deepEqual(await page.locator('.dropdown button').evaluateAll((bs) => bs.map((b) => [b.firstChild.textContent, b.disabled])).then((r) => r.filter((x) => /Group|Ungroup|Lock|Unlock/.test(x[0]))),
      [['Group', true], ['Ungroup', false], ['Lock', false], ['Unlock', true]]);
    await page.keyboard.press('Escape');
    await menuItem('Layout', 'Lock');
    await menuItem('Layout', 'Unlock');
    await menuItem('Edit', 'Undo history…'); await t('hist-dialog').waitFor();
    const rows = await page.locator('[data-testid=hist-row] > span:last-child').allTextContents();
    assert.ok(rows.some((r) => /Group 3 parts/.test(r)) && rows.some((r) => /Lock 3 parts/.test(r)) && rows.some((r) => /Unlock 3 parts/.test(r)), rows.join(' | '));
    await page.keyboard.press('Escape');
    await page.locator('aside.panel').evaluate((e) => { e.scrollTop = 0; });
    await shotBoth('group');
  });

  // ---- TODO 38: rulers and guides ----
  const guideLines = () => page.locator('[data-group=guides] line.guide').count();
  const guideVals = () => page.locator('[data-testid=guide-pos]').evaluateAll((es) => es.map((e) => [e.closest('.guiderow').dataset.axis, Number(e.value)]));
  /** Pointer drag from a client point to a sheet point (mm); mid() runs while the button is down. */
  const dragFrom = async (from, toMm, mid = null) => {
    const b = await at(toMm[0], toMm[1]);
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move((from.x + b.x) / 2, (from.y + b.y) / 2, { steps: 4 }); await page.mouse.move(b.x, b.y, { steps: 4 });
    if (mid) await mid();
    await page.mouse.up();
  };
  const rulerPoint = async (which, along) => {                                   // a client point on a ruler: along = px from the canvas edge
    const r = await rectOf(t('canvas'));
    return which === 'top' ? { x: r.x + along, y: r.y + 10 } : { x: r.x + 10, y: r.y + along };
  };
  await step('TODO 38: rulers in mm along the top and left of the canvas; 0,0 is the sheet\'s bottom-left and Y counts up; on layouts and drawings; View → Rulers and the panel switch', async () => {
    await freshLayoutWithPlate();
    assert.equal(await t('ruler-top').isVisible(), true); assert.equal(await t('ruler-left').isVisible(), true);
    assert.equal(await t('ruler-corner').textContent(), 'mm');
    const cb = await rectOf(t('canvas')), sb = await page.locator('rect.sheet').boundingBox();
    const zeroX = await t('ruler-top').locator('text', { hasText: /^0$/ }).first().getAttribute('x'), zeroY = await t('ruler-left').locator('text', { hasText: /^0$/ }).first().getAttribute('y');
    approx(Number(zeroX) - 3, sb.x - cb.x, 1.2, 'the top ruler\'s 0 is the sheet\'s left edge');
    approx(Number(zeroY) + 4, sb.y + sb.height - cb.y, 1.2, 'the left ruler\'s 0 is the sheet\'s bottom edge (Y counts up)');
    const topLabels = (await t('ruler-top').locator('text').allTextContents()).map(Number), leftLabels = (await t('ruler-left').locator('text').allTextContents()).map(Number);
    assert.ok(topLabels.includes(0) && topLabels.includes(500) && topLabels.includes(1000) || topLabels.includes(100), 'numbers along the top: ' + topLabels);
    assert.ok(leftLabels.includes(0) && leftLabels.some((v) => v > 0), 'numbers up the left: ' + leftLabels);
    assert.equal(await t('rulers-show').isChecked(), true);
    assert.equal(await page.locator('[data-testid=rulers-panel] .lbl').textContent(), "Millimetres. Zero is the sheet's bottom-left corner; Y counts up, like the X / Y in the status bar.");
    // View → Rulers
    await page.locator('[data-menu=View]').click();
    assert.deepEqual(await page.locator('.dropdown button').evaluateAll((bs) => bs.map((b) => [b.firstChild.textContent, b.disabled])),
      [['Fit to window', false], ['  Properties', false], ['✓ Rulers', false], ['  Wireframe', false], ['✓ Guides', false], ['  Lock guides', false], ['Clear all guides', true], ['✓ Work area: Follow app', false], ['  Work area: Light', false], ['  Work area: Dark', false], ['  Theme: follow system', false], ['✓ Theme: light', false], ['  Theme: dark', false]]);
    await page.getByRole('menuitem', { name: /Rulers/ }).click();
    assert.equal(await t('ruler-top').isVisible(), false); assert.equal(await t('ruler-left').isVisible(), false);
    assert.equal(await t('rulers-show').isChecked(), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('pd-rulers')), '0', 'remembered on this PC');
    await t('rulers-show').check();
    assert.equal(await t('ruler-top').isVisible(), true);
    assert.equal(await page.evaluate(() => localStorage.getItem('pd-rulers')), '1');
    // drawing tabs have them too
    await t('picker').setInputFiles('fixtures/outline.dxf');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'outline.dxf');
    assert.equal(await t('ruler-top').isVisible(), true, 'rulers on a drawing tab');
    assert.ok((await t('ruler-left').locator('text').allTextContents()).length > 2);
    assert.equal(await t('guides-panel').isVisible(), false, 'guides belong to layouts');
    // dragging out of a ruler on a drawing says where guides live
    const rp = await rulerPoint('top', 300);
    await page.mouse.move(rp.x, rp.y); await page.mouse.down(); await page.mouse.move(rp.x, rp.y + 60, { steps: 3 }); await page.mouse.up();
    assert.match(await prompt(), /^Guides belong to a layout tab/);
    await closeTabs(/outline/);
    await t('new-layout').click();                                // nothing placed yet: the bar says where 0,0 is
    assert.equal(await t('sheet-origin').isVisible(), true);
    assert.equal(await t('sheet-origin').textContent(), "Sheet 1000 × 700 mm · Origin 0,0 at the sheet's bottom-left · Y points up · Rulers: mm");
  });

  await step('TODO 38: drag a guide out of a ruler (dashed line, readout, command line); Esc cancels; dropped back on the ruler it goes; moving one; undo', async () => {
    await freshLayoutWithPlate();
    assert.equal(await guideLines(), 0);
    assert.equal(await t('guide-list').locator('.guiderow').count(), 0);
    // a horizontal guide from the top ruler
    let mid = async () => {
      assert.equal(await t('guide-tip').isVisible(), true);
      assert.match(await t('guide-tip').textContent(), /^Y 3[45]\d\.\d\d$/);
      assert.match(await t('cmd-hist').textContent(), /^Command: GUIDE {3}Dragging a horizontal guide from the top ruler \(Esc cancels\)$/);
      assert.match(await prompt(), /^Y position <3[45]\d\.\d\d>:?$/);
      assert.equal(await page.locator('[data-group=guides] line.guide.drag').count(), 1, 'the guide being dragged is drawn in the accent colour');
      await page.screenshot({ path: `${shotDir}/s12-guide-drag-light.png` });
    };
    await dragFrom(await rulerPoint('top', 300), [300, 350], mid);
    assert.equal(await guideLines(), 1);
    let gv = await guideVals();
    assert.equal(gv.length, 1); assert.equal(gv[0][0], 'y'); approx(gv[0][1], 350, 2.5, 'where it was let go');
    assert.equal(await t('guide-tip').isVisible(), false);
    assert.match(await prompt(), /^Guide Y 3[45]\d\.\d\d placed:?$/);
    assert.ok((await tabs()).some((x) => x.includes('•')), 'a guide is an unsaved change');
    assert.match(await page.locator('[data-group=guides] .guide-label').first().textContent(), /^Y 3[45]\d\.\d\d$/);
    // a vertical one from the left ruler
    await menuItem('View', 'Theme: dark');
    await dragFrom(await rulerPoint('left', 200), [250, 200], async () => { await page.waitForTimeout(150); await page.screenshot({ path: `${shotDir}/s12-guide-drag-dark.png` }); });
    await menuItem('View', 'Theme: light');
    gv = await guideVals();
    assert.deepEqual(gv.map((x) => x[0]), ['y', 'x']); approx(gv[1][1], 250, 2.5);
    assert.equal(await guideLines(), 2);
    assert.match(await page.locator('[data-group=guides] .guide-label').nth(1).textContent(), /^X 2[45]\d\.\d\d$/);
    // Esc cancels a drag
    await dragFrom(await rulerPoint('top', 500), [500, 500], async () => { await page.keyboard.press('Escape'); });
    assert.equal(await guideLines(), 2);
    assert.match(await prompt(), /^Guide cancelled:?$/);
    // dropped back on its own ruler: no guide is made
    await dragFrom(await rulerPoint('top', 500), [500, 500], async () => { const r = await rulerPoint('top', 520); await page.mouse.move(r.x, r.y, { steps: 3 }); assert.equal(await t('guide-tip').textContent(), 'Release to delete'); });
    assert.equal(await guideLines(), 2);
    // move an existing guide by its line
    const before = (await guideVals())[0][1];
    const lp = await at(60, before);
    await dragFrom(lp, [60, before + 100]);
    approx((await guideVals())[0][1], before + 100, 2.5, 'moved');
    assert.match(await prompt(), /^Guide Y \d+\.\d\d moved:?$/);
    // ... and put back on the ruler it is deleted
    const lp2 = await at(60, (await guideVals())[0][1]), r2 = await rulerPoint('top', 300);
    await page.mouse.move(lp2.x, lp2.y); await page.mouse.down(); await page.mouse.move(r2.x, r2.y + 40, { steps: 3 }); await page.mouse.move(r2.x, r2.y, { steps: 3 }); await page.mouse.up();
    assert.equal(await guideLines(), 1);
    assert.match(await prompt(), /^Guide Y \d+\.\d\d deleted: dropped on the ruler:?$/);
    // undo brings it back; the steps are named
    await page.keyboard.press('Control+z');
    assert.equal(await guideLines(), 2);
    await menuItem('Edit', 'Undo history…'); await t('hist-dialog').waitFor();
    const rows = await page.locator('[data-testid=hist-row] > span:last-child').allTextContents();
    assert.deepEqual(rows, ['Start', 'Add Plate A', 'Add guide', 'Add guide', 'Move guide', 'Delete guide']);
    await page.keyboard.press('Escape'); await t('hist-dialog').waitFor({ state: 'detached' });
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    assert.equal(await guideLines(), 0, 'every step undone');
  });

  await step('TODO 38: the Guides section: a position field and a delete button per guide, + Horizontal / + Vertical, Show, Lock, Clear all; View menu; right-click a guide', async () => {
    await freshLayoutWithPlate();
    assert.equal(await t('guide-clear').isDisabled(), true);
    assert.equal(await page.locator('[data-testid=guides-panel] h2').textContent(), 'Guides');
    await t('guide-add-h').click();
    assert.deepEqual(await guideVals(), [['y', 350]]);
    assert.equal(await t('guide-pos').evaluate((e) => document.activeElement === e), true, 'the new guide\'s field is ready to type in');
    await t('guide-pos').fill('600'); await t('guide-pos').press('Enter');
    assert.deepEqual(await guideVals(), [['y', 600]]);
    assert.match(await prompt(), /^Guide moved to Y 600\.00:?$/);
    await t('guide-add-v').click();
    assert.deepEqual(await guideVals(), [['y', 600], ['x', 500]]);
    await t('guide-pos').nth(1).fill('250'); await t('guide-pos').nth(1).press('Enter');
    assert.deepEqual(await guideVals(), [['y', 600], ['x', 250]]);
    assert.deepEqual(await page.locator('[data-testid=guide-del]').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label'))), ['Delete guide Y 600.00', 'Delete guide X 250.00']);
    assert.deepEqual(await page.locator('[data-testid=guide-pos]').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label'))), ['Y guide position in millimetres', 'X guide position in millimetres']);
    // the lines are where the fields say, on the sheet
    const sb = await page.locator('rect.sheet').boundingBox(), sc = sb.width / 1000;
    const hy = await page.locator('[data-group=guides] line.guide').nth(0).evaluate((l) => l.getBoundingClientRect().y), vx = await page.locator('[data-group=guides] line.guide').nth(1).evaluate((l) => l.getBoundingClientRect().x);
    approx(hy, sb.y + (700 - 600) * sc, 1.5, 'Y 600 is 100 mm below the sheet\'s top'); approx(vx, sb.x + 250 * sc, 1.5, 'X 250');
    // a wrong value says so and snaps back
    await t('guide-pos').first().fill('abc'); await t('guide-pos').first().press('Enter');
    assert.match(await prompt(), /^A guide's position must be a number in mm:?$/);
    assert.deepEqual(await guideVals(), [['y', 600], ['x', 250]]);
    // Show / Lock switches and Clear all
    assert.equal(await t('guides-show').isChecked(), true); assert.equal(await t('guides-lock').isChecked(), false);
    await t('guides-show').uncheck();
    assert.equal(await guideLines(), 0, 'hidden guides are not drawn'); assert.equal((await guideVals()).length, 2, 'but still listed');
    await t('guides-show').check();
    assert.equal(await guideLines(), 2);
    await t('guides-lock').check();
    assert.equal(await page.locator('[data-group=guides] .guide-hit.locked').count(), 2);
    const lp = await at(60, 600);
    await page.mouse.move(lp.x, lp.y); await page.mouse.down(); await page.mouse.move(lp.x, lp.y + 50, { steps: 3 }); await page.mouse.up();
    assert.deepEqual(await guideVals(), [['y', 600], ['x', 250]], 'a locked guide does not move');
    const rp = await rulerPoint('top', 400);
    await page.mouse.move(rp.x, rp.y); await page.mouse.down(); await page.mouse.move(rp.x, rp.y + 80, { steps: 3 }); await page.mouse.up();
    assert.equal((await guideVals()).length, 2, 'locked: no new guide from a ruler');
    assert.match(await prompt(), /^Guides are locked/);
    // a locked guide does not catch a press meant for the part under it
    const pp = [Number(await t('px').inputValue()) + 50, Number(await t('py').inputValue()) + 30];
    await t('guide-pos').first().fill('' + (pp[1])); await t('guide-pos').first().press('Enter');
    const at0 = await pos();
    await dragMm([pp[0], pp[1]], [pp[0] + 30, pp[1] + 30]);
    approx((await pos())[0], at0[0] + 30, 1.2, 'the part under the locked guide was dragged'); approx((await pos())[1], at0[1] + 30, 1.2);
    await page.keyboard.press('Control+z');
    await t('guides-lock').uncheck();
    // right-click a guide: Delete guide, Lock guides, Hide guides
    const gp = await at(60, pp[1]);
    await page.mouse.click(gp.x, gp.y, { button: 'right' });
    await page.waitForSelector('[data-testid=ctx-menu]');
    assert.deepEqual(await ctxItems(), ['Delete guide', 'Lock guides', 'Hide guides']);
    await page.locator('[data-testid=ctx-menu] .mi', { hasText: 'Delete guide' }).click();
    assert.deepEqual(await guideVals(), [['x', 250]]);
    const gx = await at(250, 600);
    await page.mouse.click(gx.x, gx.y, { button: 'right' });
    await page.locator('[data-testid=ctx-menu] .mi', { hasText: 'Lock guides' }).click();
    assert.equal(await t('guides-lock').isChecked(), true);
    await page.mouse.click(gx.x, gx.y, { button: 'right' });
    assert.deepEqual(await ctxItems(), ['Delete guide', 'Unlock guides', 'Hide guides']);
    assert.equal(await page.locator('[data-testid=ctx-menu] .mi', { hasText: 'Delete guide' }).isDisabled(), true);
    await page.locator('[data-testid=ctx-menu] .mi', { hasText: 'Hide guides' }).click();
    assert.equal(await guideLines(), 0); assert.equal(await t('guides-show').isChecked(), false);
    // View menu: Guides, Lock guides, Clear all guides
    await page.locator('[data-menu=View]').click();
    assert.deepEqual(await page.locator('.dropdown button').evaluateAll((bs) => bs.map((b) => b.firstChild.textContent)).then((r) => r.slice(2, 7)), ['✓ Rulers', '  Wireframe', '  Guides', '✓ Lock guides', 'Clear all guides']);
    await page.getByRole('menuitem', { name: /Guides/ }).click();
    assert.equal(await guideLines(), 1); assert.equal(await t('guides-show').isChecked(), true);
    await menuItem('View', 'Clear all guides');
    assert.equal((await guideVals()).length, 0);
    assert.match(await prompt(), /^1 guide cleared\. Ctrl\+Z brings it back:?$/);
    await page.keyboard.press('Control+z');
    assert.equal((await guideVals()).length, 1);
    await t('guides-lock').uncheck();
    await t('guide-clear').click();
    assert.equal((await guideVals()).length, 0);
    await t('guide-del').count().then((n) => assert.equal(n, 0));
    // delete from the panel
    await t('guide-add-h').click(); await t('guide-add-h').click();
    assert.deepEqual(await guideVals(), [['y', 350], ['y', 360]], 'a second guide on the same line is moved along 10 mm');
    await page.locator('[data-testid=guide-del]').first().click();
    assert.deepEqual(await guideVals(), [['y', 360]]);
    assert.match(await prompt(), /^Guide Y 350\.00 deleted:?$/);
  });

  await step('TODO 38: a part dragged near a guide lands on it (within a few screen px; SNAP off stops it); the guide lights up', async () => {
    await freshLayoutWithPlate();
    await t('guide-add-v').click(); await t('guide-pos').fill('300'); await t('guide-pos').press('Enter');
    await t('guide-add-h').click(); await t('guide-pos').nth(1).fill('200'); await t('guide-pos').nth(1).press('Enter');
    const p0 = await pos(), sc = (await page.locator('rect.sheet').boundingBox()).width / 1000, tol = 6 / sc;
    assert.deepEqual(p0, [450, 320]);
    // the part's left edge (450) dragged to about x 302, bottom edge (320) to about y 203
    await dragMm([500, 350], [352, 233], [], async () => {
      assert.equal(await page.locator('[data-group=guides] line.guide.snapped').count(), 2, 'both guides light up');
      assert.match(await page.locator('[data-group=guides] .guide-label').first().textContent(), /snaps to guides$/);
    });
    assert.deepEqual(await pos(), [300, 200], 'the lower-left corner is on both guides');
    assert.match(await prompt(), /^Plate A moved to X 300\.00 Y 200\.00/);
    // right edge to the vertical guide: x1 = 400 → 300
    await dragMm([350, 230], [250 + 1.5, 230 + 40]);
    approx((await pos())[0], 200, 0.01, 'the right edge (x + 100) is on the guide at 300');
    approx((await pos())[1], 240, 1.5);
    // the middle: centre x = x + 50 on the guide → x = 250
    await t('px').fill('0'); await t('px').press('Enter');
    await dragMm([50, 270], [50 + 253, 270]);
    approx((await pos())[0], 250, 0.01, 'the middle on the guide');
    // far from any guide: no snap
    await t('px').fill('600'); await t('px').press('Enter'); await t('py').fill('450'); await t('py').press('Enter');
    await dragMm([650, 480], [670, 490]);
    approx((await pos())[0], 620, 1.2); approx((await pos())[1], 460, 1.2);
    // SNAP off: the exact point, even 2 mm from a guide (302 here)
    await t('tog-snap').click();
    await t('px').fill('312'); await t('px').press('Enter'); await t('py').fill('450'); await t('py').press('Enter');
    await dragMm([362, 480], [352, 480]);
    approx((await pos())[0], 302, 1.2, 'SNAP off: no snapping to guides');
    assert.notEqual((await pos())[0], 300);
    await t('tog-snap').click();
    // a straight (Shift) drag keeps its straight axis: only the other axis may snap
    await t('px').fill('310'); await t('px').press('Enter'); await t('py').fill('450'); await t('py').press('Enter');
    await dragMm([360, 480], [354, 478], ['Shift']);
    assert.equal((await pos())[1], 450, 'straight along X: Y did not change');
    assert.equal((await pos())[0], 300, 'X snapped to the guide');
    // hidden guides do not snap
    await t('guides-show').uncheck();
    await t('px').fill('312'); await t('px').press('Enter');
    await dragMm([362, 480], [352, 480]);
    approx((await pos())[0], 302, 1.2);
    await t('guides-show').check();
  });

  await step('TODO 38: guides are saved in the layout file (settings block) and reopen, with Show and Lock; screenshots light and dark', async () => {
    await freshLayoutWithPlate();
    await t('guide-add-h').click(); await t('guide-pos').fill('600'); await t('guide-pos').press('Enter');
    await t('guide-add-v').click(); await t('guide-pos').nth(1).fill('250'); await t('guide-pos').nth(1).press('Enter');
    await page.keyboard.press('Escape');
    await page.locator('aside.panel').evaluate((e) => { e.scrollTop = 0; });
    await page.locator('[data-testid=guides-panel]').scrollIntoViewIfNeeded();
    await shotBoth('guides');
    await t('guides-lock').check();
    const dl = await downloaded(() => page.keyboard.press('Control+s'));
    const m = readMeta(readDxf(dl.text));
    assert.deepEqual(m.s.guides, [{ axis: 'y', mm: 600 }, { axis: 'x', mm: 250 }]);
    assert.equal(m.s.guidesLock, true); assert.equal(m.s.guidesShow, true);
    await closeTabs(/./);
    await t('picker').setInputFiles({ name: 'Guided.dxf', mimeType: 'text/plain', buffer: Buffer.from(dl.text, 'latin1') });
    await page.waitForFunction(() => { const b = document.querySelector('.tabs .dtab.on'); return b && b.dataset.kind === 'layout' && b.textContent.startsWith('Guided.dxf'); });
    assert.deepEqual(await guideVals(), [['y', 600], ['x', 250]], 'the guides came back');
    assert.equal(await t('guides-lock').isChecked(), true); assert.equal(await t('guides-show').isChecked(), true);
    assert.equal(await guideLines(), 2);
    // each layout has its own guides
    await t('new-layout').click();
    assert.equal((await guideVals()).length, 0, 'a new layout has none');
    assert.equal(await guideLines(), 0);
  });

  // ---- TODO 35: Contour ----
  const contourInk = () => t('drawing').evaluate((c) => {                      // translucent green: ByLayer uses the new Contour layer's ACI 3
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let k = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 100 && d[i] < 30 && d[i + 1] > 225 && d[i + 2] < 30) k++;
    return k;
  });
  const contourInkWhen = async (ok, ms = 6000) => { const end = Date.now() + ms; let n = await contourInk(); while (!ok(n) && Date.now() < end) { await page.waitForTimeout(60); n = await contourInk(); } return n; };
  const shapesDoc = () => {
    const doc = newDoc(4);
    addEntities(doc, roundRect(100, 100, 100, 60, 18, { layer: 'Plate' }), dxfCircle(300, 130, 20, { layer: 'Plate' }),
      dxfLine(500, 100, 600, 100, { layer: 'Open' }), dxfLine(600, 100, 600, 200, { layer: 'Open' }));
    return writeDxf(doc);
  };
  const ctCfg = () => page.evaluate(() => JSON.parse(localStorage.getItem('pd-contour')));
  const ctPanel = (id) => page.locator(`[data-testid=contour-panel] [data-testid=${id}]`);
  const entCount = async () => Number((await t('entities').textContent()).replace(/\D+/g, ''));
  await step('TODO 35: the Contour tool (rail, after Offset): a floating panel with a small preview; pick a closed outline; live preview on the sheet; Close; not on a layout', async () => {
    await page.evaluate(() => localStorage.removeItem('pd-contour'));
    await closeTabs(/./);
    await t('picker').setInputFiles({ name: 'shapes.dxf', mimeType: 'text/plain', buffer: Buffer.from(shapesDoc(), 'latin1') });
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'shapes.dxf');
    await page.waitForFunction(() => document.querySelector('[data-testid=gap-count]') && document.querySelector('[data-testid=gap-count]').textContent !== '…');
    // the rail: Contour sits after Offset
    const order = await page.locator('nav.rail .tool').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
    assert.equal(order[order.indexOf('Offset') + 1], 'Contour');
    assert.equal(await page.locator('[data-tool=contour]').getAttribute('title'), 'Contour (CO)');
    assert.equal(await t('contour-panel').isVisible(), false);
    await page.locator('[data-tool=contour]').click();
    assert.equal(await t('contour-panel').isVisible(), true);
    assert.equal(await t('tool-chip').textContent(), 'Tool: Contour');
    assert.equal(await t('contour-panel').getAttribute('role'), 'dialog');
    assert.equal(await t('contour-panel').locator('strong').textContent(), 'Contour');
    // what is on it: the preview, Direction, Distance, Steps, Corners, the live-preview box, the hint, Close, Apply
    assert.equal(await t('contour-preview').count(), 1);
    assert.deepEqual(await ctPanel('contour-inside').evaluateAll((b) => b.map((x) => x.textContent)), ['Inside']);
    assert.deepEqual(await t('contour-panel').locator('.seg').allTextContents(), ['Inside', 'Outside', 'Sharp', 'Rounded']);
    assert.deepEqual(await t('contour-panel').locator('label.field').allTextContents().then((r) => r.map((x) => x.trim())), ['Distance (mm)', 'Steps']);
    assert.equal(await t('contour-live').isChecked(), true);
    assert.equal(await t('contour-panel').locator('label[for=contour-live]').textContent(), 'Live preview on the sheet');
    assert.deepEqual(await t('contour-panel').locator('.row.end button').allTextContents(), ['Close', 'Apply']);
    assert.equal(await t('contour-x').getAttribute('aria-label'), 'Close Contour');
    // his defaults: Outside, 5 mm, 1 step, Sharp; the bar and the command line say so
    assert.equal(await ctPanel('contour-outside').getAttribute('aria-pressed'), 'true'); assert.equal(await ctPanel('contour-sharp').getAttribute('aria-pressed'), 'true');
    assert.equal(await t('contour-dist').inputValue(), '5.0'); assert.equal(await t('contour-steps').inputValue(), '1');
    assert.equal(await t('sel-contour').textContent(), 'Contour: Outside · 5.0 mm · 1 step · Sharp');
    assert.equal(await t('cmd-hist').textContent(), 'Command: CONTOUR   Outside · 5.00 mm · 1 step · Sharp corners');
    assert.equal(await prompt(), 'Option [Inside / Outside / Distance / Steps / Sharp / Rounded / Apply]:');
    assert.equal(await t('contour-hint').textContent(), 'Pick a closed outline in the drawing: click one of its edges.');
    assert.equal(await t('contour-apply').isDisabled(), true);
    // pick the rounded rectangle (its straight bottom edge): the preview appears on the sheet
    await click(150, 100);
    await waitSel('1 selected');
    assert.equal(await t('contour-hint').textContent(), 'Apply makes 1 new outline on the layer Contour. The part itself is not changed.');
    assert.equal(await t('contour-apply').isDisabled(), false);
    assert.equal(await t('contour-preview').locator('.ct-orig').count(), 1); assert.equal(await t('contour-preview').locator('.ct-out').count(), 1);
    assert.ok((await contourInkWhen((n) => n > 40)) > 40, 'the preview is drawn on the sheet');
    assert.equal(await t('hint-pill').textContent(), 'Preview: 1 outline outside, sharp corners');
    // the smallest window: the selection bar (with the Contour words) still fits on one row
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.waitForTimeout(250);
    const sbar = await rectOf(t('selbar')), skids = await t('selbar').locator('> *:not([hidden])').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
    await page.screenshot({ path: `${shotDir}/s12-contour-1024-light.png` });
    for (const r of skids) assert.ok(r.y + r.height <= sbar.y + sbar.height + 1 && r.x + r.width <= sbar.x + sbar.width - 20, 'the selection bar overflows or is too tight at 1024: ' + JSON.stringify([r, sbar]));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(150);
    // Distance, Steps and Corners: the preview and the words follow
    await ctPanel('contour-rounded').click();
    await t('contour-dist').fill('10'); await t('contour-dist').press('Enter');
    await t('contour-steps').fill('3'); await t('contour-steps').press('Enter');
    assert.equal(await t('contour-hint').textContent(), 'Apply makes 3 new outlines on the layer Contour. The part itself is not changed.');
    assert.equal(await t('contour-preview').locator('.ct-out').count(), 3);
    assert.equal(await t('sel-contour').textContent(), 'Contour: Outside · 10.0 mm · 3 steps · Rounded');
    assert.equal(await t('cmd-hist').textContent(), 'Command: CONTOUR   Outside · 10.00 mm · 3 steps · Rounded corners');
    assert.equal(await t('hint-pill').textContent(), 'Preview: 3 outlines outside, rounded corners');
    const inkOn = await contourInkWhen((n) => n > 100);
    // live preview off: the sheet shows nothing of it (the panel's small preview keeps the outline)
    await t('contour-live').uncheck();
    assert.ok((await contourInkWhen((n) => n < inkOn / 10)) < inkOn / 10, 'no preview on the sheet');
    assert.equal(await t('contour-preview').locator('.ct-out').count(), 0);
    await t('contour-live').check();
    // bad values are refused with a note and snap back
    await t('contour-dist').fill('-3'); await t('contour-dist').press('Enter');
    assert.match(await prompt(), /^Distance must be a number above 0 mm/); assert.equal(await t('contour-dist').inputValue(), '10.0');
    await t('contour-steps').fill('2.5'); await t('contour-steps').press('Enter');
    assert.match(await prompt(), /^Steps must be a whole number from 1 to 100/); assert.equal(await t('contour-steps').inputValue(), '3');
    // it remembers Inside / Outside, the distance, the steps and Sharp / Rounded, on this PC (his call)
    assert.deepEqual(await ctCfg(), { dir: 'outside', dist: 10, steps: 3, corners: 'rounded', colour: 'bylayer', lt: 'BYLAYER' });
    const p2 = await ctx.newPage();
    await p2.goto(URL_); await p2.waitForSelector('[data-testid=count]', { state: 'attached' });
    assert.deepEqual(await p2.evaluate(() => JSON.parse(localStorage.getItem('pd-contour'))), { dir: 'outside', dist: 10, steps: 3, corners: 'rounded', colour: 'bylayer', lt: 'BYLAYER' });
    await p2.locator('[data-testid=picker]').setInputFiles({ name: 'shapes.dxf', mimeType: 'text/plain', buffer: Buffer.from(shapesDoc(), 'latin1') });
    await p2.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'shapes.dxf');
    await p2.locator('[data-tool=contour]').click();
    assert.equal(await p2.locator('[data-testid=contour-dist]').inputValue(), '10.0'); assert.equal(await p2.locator('[data-testid=contour-steps]').inputValue(), '3');
    assert.equal(await p2.locator('[data-testid=contour-panel] [data-testid=contour-rounded]').getAttribute('aria-pressed'), 'true');
    assert.equal(await p2.locator('[data-testid=contour-panel] [data-testid=contour-outside]').getAttribute('aria-pressed'), 'true');
    await p2.close();
    // the panel is floating: it is dragged by its title bar, and it does not catch a click meant for the drawing
    const box0 = await rectOf(t('contour-panel')), head = await rectOf(t('contour-panel').locator('.cthead'));
    await page.mouse.move(head.x + 60, head.y + 12); await page.mouse.down(); await page.mouse.move(head.x - 140, head.y + 80, { steps: 4 }); await page.mouse.up();
    const box1 = await rectOf(t('contour-panel'));
    approx(box1.x, box0.x - 200, 3, 'moved left'); approx(box1.y, box0.y + 68, 3, 'moved down');
    assert.equal(await selCount(), '1 selected', 'a drag on the panel selected nothing else');
    // The extra style rows make the panel taller: move it left to uncover the open outline.
    const canvas = await rectOf(t('canvas'));
    await page.mouse.move(box1.x + 60, box1.y + 12); await page.mouse.down(); await page.mouse.move(canvas.x + 60, canvas.y + 12, { steps: 4 }); await page.mouse.up();
    // an outline that is not closed says so
    await click(550, 100); await waitSel('2 selected');
    assert.match(await t('contour-hint').textContent(), /^That is not a closed outline \(2 pieces left open\)\. Join the tiny gaps, or pick a closed one\.$/);
    assert.equal(await t('contour-apply').isDisabled(), true);
    // Close puts the Select tool back; Esc with nothing selected does too
    await t('contour-close').click();
    assert.equal(await t('contour-panel').isVisible(), false); assert.equal(await t('tool-chip').textContent(), 'Tool: Select');
    assert.ok((await contourInkWhen((n) => n < 50)) < 50, 'the preview is gone');
    await page.locator('[data-tool=contour]').click();
    await page.keyboard.press('Escape');                          // clears the selection
    await page.keyboard.press('Escape');                          // nothing selected: back to Select
    assert.equal(await t('tool-chip').textContent(), 'Tool: Select');
    // on a layout tab it is not available
    await t('new-layout').click();
    await page.locator('[data-tool=contour]').click();
    assert.match(await prompt(), /^Contour works on a drawing tab/);
    assert.equal(await t('contour-panel').isVisible(), false);
    await closeTabs(/Layout/);
    await page.locator('.tabs .dtab', { hasText: 'shapes.dxf' }).click();
  });

  await step('TODO 35: Apply adds the outlines as lines and arcs on the new layer "Contour" (one undo step), the original is untouched; inward steps stop early; a circle stays a circle; the words in the command line', async () => {
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'shapes.dxf');
    const base = await entCount();
    await page.locator('[data-tool=contour]').click();
    await click(150, 100); await waitSel('1 selected');
    assert.equal(await t('contour-dist').inputValue(), '10.0');   // remembered from the last step
    await page.locator('aside.panel').evaluate((e) => { e.scrollTop = 0; });
    await shotBoth('contour', async () => { await page.waitForTimeout(100); }, async () => {});
    // Inside, 10 mm, 3 steps, rounded: the third would close the 60 mm tall plate up
    await ctPanel('contour-inside').click();
    assert.equal(await t('contour-warn').isVisible(), true);
    assert.equal(await t('contour-warn').textContent(), 'Step 3 would close up: made 2.');
    assert.equal(await t('contour-hint').textContent(), 'Apply makes 2 new outlines on the layer Contour. The part itself is not changed.');
    assert.equal(await t('contour-preview').locator('.ct-out').count(), 2);
    assert.equal(await t('sel-contour').textContent(), 'Contour: Inside · 10.0 mm · 3 steps · Rounded');
    // Apply (outside, 10 mm, 3 steps, rounded): 3 outlines of 8 pieces each
    await ctPanel('contour-outside').click();
    assert.equal(await t('contour-warn').isVisible(), false);
    assert.equal(await page.locator('[data-testid=layer-new]').count(), 0);
    await t('contour-apply').click();
    assert.match(await prompt(), /^Contour: 3 new outlines \(24 lines and arcs\) on the layer Contour\. Ctrl\+Z takes them away:?$/);
    assert.equal(await entCount(), base + 24);
    const layerRow = page.locator('.layer', { hasText: 'Contour' });
    assert.equal(await layerRow.count(), 1);
    assert.equal(await layerRow.locator('[data-testid=layer-new]').textContent(), 'new');
    assert.equal(await layerRow.locator('.lbl.mono').textContent(), '24');
    assert.equal(await selCount(), '1 selected', 'the original stays selected');
    assert.equal(await t('contour-panel').isVisible(), true, 'the panel stays open to try another');
    // the original is untouched, the new ones are ordinary lines and arcs on the layer Contour (saved)
    const dl = await downloaded(() => page.keyboard.press('Control+s'));
    const raw = readDxf(dl.text), onLayer = raw.entities.filter((e) => e.layer === 'Contour');
    assert.equal(onLayer.length, 24); assert.deepEqual([...new Set(onLayer.map((e) => e.type))].sort(), ['ARC', 'LINE']);
    assert.equal(onLayer.filter((e) => e.type === 'ARC').length, 12);
    assert.equal(raw.entities.filter((e) => e.layer === 'Plate').length, 2, 'the plate and the circle are as they were');
    assert.ok(raw.layers.Contour, 'the layer exists in the file');
    // one undo step, named
    await menuItem('Edit', 'Undo history…'); await t('hist-dialog').waitFor();
    assert.equal((await page.locator('[data-testid=hist-row] > span:last-child').allTextContents()).pop(), 'Contour outside 10 mm × 3');
    await page.keyboard.press('Escape'); await t('hist-dialog').waitFor({ state: 'detached' });
    await page.keyboard.press('Control+z');
    assert.equal(await entCount(), base, 'one Ctrl+Z takes all 24 away');
    await page.keyboard.press('Control+y');
    assert.equal(await entCount(), base + 24);
    await page.keyboard.press('Control+z');
    // a circle: one CIRCLE per step
    await click(300, 110); await waitSel("1 selected");           // the circle's lowest point: the panel covers its top
    await t('contour-steps').fill('2'); await t('contour-steps').press('Enter');
    await ctPanel('contour-sharp').click();
    assert.equal(await t('contour-hint').textContent(), 'Apply makes 2 new outlines on the layer Contour. The part itself is not changed.');
    await t('contour-apply').click();
    assert.equal(await entCount(), base + 2);
    const dl2 = await downloaded(() => page.keyboard.press('Control+s'));
    const circles = readDxf(dl2.text).entities.filter((e) => e.layer === 'Contour');
    assert.deepEqual(circles.map((e) => e.type), ['CIRCLE', 'CIRCLE']);
    assert.deepEqual(circles.map((e) => +e.r.v[e.r.c.indexOf(40)]), [30, 40], 'radii 20 + 10 and 20 + 20');
    // inside by more than the radius: nothing to make
    await ctPanel('contour-inside').click();
    await t('contour-dist').fill('25'); await t('contour-dist').press('Enter');
    assert.equal(await t('contour-warn').textContent(), 'Step 1 would close up: made 0.');
    assert.equal(await t('contour-hint').textContent(), 'Nothing to make with these values.');
    assert.equal(await t('contour-apply').isDisabled(), true);
    // the words in the prompt
    await cmdLine().fill('outside'); await page.keyboard.press('Enter');
    assert.equal(await ctPanel('contour-outside').getAttribute('aria-pressed'), 'true');
    await cmdLine().fill('distance 7'); await page.keyboard.press('Enter');
    assert.equal(await t('contour-dist').inputValue(), '7.0');
    await cmdLine().fill('steps 4'); await page.keyboard.press('Enter');
    assert.equal(await t('contour-steps').inputValue(), '4');
    await cmdLine().fill('rounded'); await page.keyboard.press('Enter');
    assert.equal(await t('cmd-hist').textContent(), 'Command: CONTOUR   Outside · 7.00 mm · 4 steps · Rounded corners');
    await cmdLine().fill('sharp'); await page.keyboard.press('Enter');
    await cmdLine().fill('steps 1'); await page.keyboard.press('Enter');
    await cmdLine().fill('apply'); await page.keyboard.press('Enter');
    assert.equal(await entCount(), base + 2 + 1, 'apply from the command line: one more circle');
    assert.deepEqual(await ctCfg(), { dir: 'outside', dist: 7, steps: 1, corners: 'sharp', colour: 'bylayer', lt: 'BYLAYER' });
    await t('contour-close').click();
    // picking an outline of the new layer works like any other (they are ordinary entities)
    await click(300, 103); await waitSel('1 selected');
    assert.equal(await t('sel-layer').textContent(), 'layer Contour');
  });

  await step('TODO 65: Contour Red / Dashed previews, Apply, one selected edge in Properties, DXF reopen and remembered style', async () => {
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });      // the pixel checks below look for pure red / green
    await closeTabs(/./);
    const doc = newDoc();
    addEntities(doc, dxfPoly([[100, 100], [200, 100], [200, 200], [100, 200]], { closed: true }));
    await t('picker').setInputFiles({ name: 'contour-style.dxf', mimeType: 'text/plain', buffer: Buffer.from(writeDxf(doc)) });
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'contour-style.dxf');
    await page.locator('[data-tool=contour]').click(); await click(150, 100); await waitSel('1 selected');
    const colours = t('contour-panel').getByRole('group', { name: 'Colour', exact: true });
    const styles = t('contour-panel').getByRole('group', { name: 'Line style', exact: true });
    assert.deepEqual(await colours.locator('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label'))), ['ByLayer', 'Red', 'Blue', 'Green', 'Black']);
    assert.deepEqual(await styles.locator('button').allTextContents(), ['Solid', 'Dashed', 'Dotted']);
    assert.equal(await colours.getByRole('button', { name: 'ByLayer', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await styles.getByRole('button', { name: 'Solid', exact: true }).getAttribute('aria-pressed'), 'true');
    await t('contour-dist').fill('5'); await t('contour-dist').press('Enter');
    await t('contour-steps').fill('2'); await t('contour-steps').press('Enter');
    await ctPanel('contour-outside').click(); await ctPanel('contour-sharp').click();
    await colours.getByRole('button', { name: 'Red', exact: true }).click();
    await styles.getByRole('button', { name: 'Dashed', exact: true }).click();
    const previewStyle = await t('contour-preview').locator('.ct-out').first().evaluate((p) => {
      const s = getComputedStyle(p); return [s.stroke, s.strokeDasharray, s.opacity];
    });
    assert.deepEqual(previewStyle, ['rgb(255, 0, 0)', '7px, 4px', '0.65']);
    await page.waitForFunction(() => {
      const c = document.querySelector('[data-testid=drawing]'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let red = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 225 && d[i + 1] < 30 && d[i + 2] < 30 && d[i + 3] > 100) red++;
      return red > 40;
    });
    for (const th of ['light', 'dark']) {
      await menuItem('View', 'Theme: ' + th); await page.waitForTimeout(250);
      await page.screenshot({ path: `${shotDir}/R13-built-${th}.png` });
    }
    await menuItem('View', 'Theme: light');
    const base = await entCount(); await t('contour-apply').click();
    assert.equal(await entCount(), base + 8);
    const dl = await downloaded(() => page.keyboard.press('Control+s'));
    const saved = readDxf(dl.text), added = saved.entities.filter((e) => e.layer === 'Contour');
    assert.equal(added.length, 8); assert.ok(added.every((e) => e.aci === 1 && e.lt === 'DASHED'));
    assert.deepEqual(saved.ltypes.DASHED.pattern, [7, -4]);
    await t('contour-close').click(); await page.keyboard.press('Control+z'); assert.equal(await entCount(), base);
    await page.keyboard.press('Control+y'); assert.equal(await entCount(), base + 8);
    const pickEdge = async () => {
      await page.keyboard.press('Escape');
      const a = await at(75, 75), b = await at(225, 92);
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
      await waitSel('1 selected');
      if (!(await t('props-panel').isVisible())) await page.keyboard.press('Control+1');
      assert.equal(await t('prop-chip').textContent(), 'Line');
      assert.equal(await t('prop-layer').inputValue(), 'Contour');
      assert.equal(await t('prop-colour').inputValue(), 'aci:1');
      assert.equal(await t('prop-colour').locator('option:checked').textContent(), 'Red');
      assert.equal(await t('prop-lt').inputValue(), 'DASHED');
      assert.equal(await t('prop-lt').locator('option:checked').textContent(), 'DASHED');
    };
    await pickEdge();
    await closeTabs(/./);
    await page.reload(); await page.waitForSelector('[data-testid=count]', { state: 'attached' });
    await t('picker').setInputFiles({ name: 'contour-style-saved.dxf', mimeType: 'text/plain', buffer: Buffer.from(dl.text) });
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'contour-style-saved.dxf');
    await pickEdge();
    await page.locator('[data-tool=contour]').click();
    assert.equal(await colours.getByRole('button', { name: 'Red', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await styles.getByRole('button', { name: 'Dashed', exact: true }).getAttribute('aria-pressed'), 'true');
    await styles.getByRole('button', { name: 'Dotted', exact: true }).click();
    assert.equal(await t('contour-preview').evaluate((p) => p.style.getPropertyValue('--ct-dash')), '0 4');
    await colours.getByRole('button', { name: 'ByLayer', exact: true }).click();
    await styles.getByRole('button', { name: 'Solid', exact: true }).click(); await t('contour-close').click();
    if (await t('props-panel').isVisible()) await page.keyboard.press('Control+1');
  });

  await step('TODO 104 / T21: Join removes micro pieces, reports the count, and one Undo restores pieces and gaps', async () => {
    const original = readDxf(decodeDxf(readFileSync('fixtures/micro-gaps.dxf')));
    // Save regenerates DXF handles and owners; compare the entity geometry and properties.
    const geometry = (raw) => raw.entities.map((e) => [e.type, e.layer, e.r.c.flatMap((c, i) => c === 5 || c === 330 ? [] : [[c, e.r.v[i]]])]);
    await closeTabs(/./);
    await t('picker').setInputFiles('fixtures/micro-gaps.dxf');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'micro-gaps.dxf');
    await t('gap-tol').fill('0.01'); await t('gap-tol').press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-testid=gap-count]').textContent === '2');
    await t('gap-join').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=gap-count]').textContent === '0');
    assert.match(await t('cmd-prompt').textContent(), /Joined 2 gaps; 2 micro pieces removed/);
    await t('cmd-fade').getByText(/Joined 2 gaps; 2 micro pieces removed/).waitFor({ state: 'visible' });
    await shotBoth('104-micro-gaps');
    const saved = await downloaded(() => page.keyboard.press('Control+s'));
    const joined = readDxf(saved.text);
    assert.equal(joined.entities.length, 11);
    assert.deepEqual(geometry(joined).at(-1), geometry(original).at(-1), 'lone tiny piece stays');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => document.querySelector('[data-testid=gap-count]').textContent === '2');
    const undone = await downloaded(() => page.keyboard.press('Control+s'));
    assert.deepEqual(geometry(readDxf(undone.text)), geometry(original), 'one Undo restores every original entity and endpoint');
    // Preflight uses the same repair pipeline.
    await menuItem('Tools', 'Preflight…');
    await t('preflight-gaps-fix').click();
    assert.match(await t('cmd-prompt').textContent(), /Joined 2 gaps; 2 micro pieces removed/);
    await t('preflight-close').click();
  });

  await step('TODO 121: Join gaps has a Method list (average point by default, remembered); each method joins in one undo step and the message names it', async () => {
    await closeTabs(/./);
    await t('picker').setInputFiles('fixtures/outline.dxf');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'outline.dxf');
    await page.waitForFunction(() => document.querySelector('[data-testid=gap-count]').textContent === '2');
    assert.equal(await t('gap-method').inputValue(), 'average');
    await shotBoth('join-gaps-method');
    for (const [method, label, pieces] of [['extend', 'Extend', 8], ['chamfer', 'Chamfer', 10], ['fillet', 'Fillet', 10], ['bezier', 'Bezier', 10]]) {
      await t('gap-method').selectOption(method);
      await t('gap-join').click();
      assert.match(await t('cmd-prompt').textContent(), new RegExp(`^Joined 2 gaps \\(${label}\\)`), method);
      await click(50, 0); await waitSel(pieces + ' selected');
      await page.keyboard.press('Control+z');
      await click(50, 0); await waitSel('8 selected');                          // one Undo took the lot back
      await page.keyboard.press('Escape');
    }
    assert.equal(await page.evaluate(() => localStorage.getItem('pd-gapmethod')), 'bezier', 'remembered');
    await t('gap-method').selectOption('average');
    await t('gap-join').click();
    assert.match(await t('cmd-prompt').textContent(), /^Joined 2 gaps\. /, 'average point says no method');
    await page.keyboard.press('Control+z');
  });

  await step('TODO 46: tiny gaps are counted (0.01 mm) and ringed; the tolerance is editable; Join gaps closes them in one undo step', async () => {
    await closeTabs(/./);
    await t('picker').setInputFiles('fixtures/outline.dxf');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'outline.dxf');
    await page.waitForFunction(() => document.querySelector('[data-testid=gap-count]').textContent === '2');
    assert.equal(await t('gap-tol').inputValue(), '0.01');
    await t('gap-show').click();
    await shotBoth('tiny-gaps', async () => {}, async () => {});
    await t('gap-tol').fill('0.005'); await t('gap-tol').press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-testid=gap-count]').textContent === '1');
    await t('gap-tol').fill('0.01'); await t('gap-tol').press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-testid=gap-count]').textContent === '2');
    await click(50, 0); await waitSel('8 selected');
    await t('gap-join').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=gap-count]').textContent === '0');
    assert.match(await t('cmd-prompt').textContent(), /Joined 2 gaps/);
    assert.doesNotMatch(await t('cmd-prompt').textContent(), /micro pieces removed/, 'no removal message when none were removed');
    assert.equal(await t('gap-join').isDisabled(), true);
    await click(50, 0); await waitSel('8 selected');
    assert.equal(await t('sel-area').textContent(), 'Area 5914.16 mm² · Perimeter 302.83 mm', 'the perimeter now includes the 0.01 mm the gaps hid');
    await shotBoth('tiny-gaps-joined');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => document.querySelector('[data-testid=gap-count]').textContent === '2');
  });

  await step('TODO 30: Edit → Undo history… lists the steps by name; a click goes back or forward several at once (drawing and layout)', async () => {
    const rows = () => page.locator('[data-testid=hist-row] > span:last-child').allTextContents();
    const openHist = async () => { await menuItem('Edit', 'Undo history…'); await t('hist-dialog').waitFor(); };
    const gaps = (n) => page.waitForFunction((x) => document.querySelector('[data-testid=gap-count]').textContent === x, String(n));
    await openHist();
    assert.deepEqual(await rows(), ['Start', 'Join gaps'], 'a step undone is still listed, to go forward again');
    assert.equal(await page.locator('[data-testid=hist-row].now').textContent(), '●Start');
    await page.locator('[data-testid=hist-row]', { hasText: 'Join gaps' }).click();
    await t('hist-dialog').waitFor({ state: 'detached' });
    await gaps(0);
    await click(38, 30); await waitSel('1 selected'); await page.keyboard.press('Delete');
    await openHist();
    assert.deepEqual(await rows(), ['Start', 'Join gaps', 'Delete 1']);
    assert.equal(await page.locator('[data-testid=hist-row].now').textContent(), '●Delete 1');
    await shotBoth('undo-history', async () => { if (!(await t('hist-dialog').count())) await openHist(); }, async () => { await page.keyboard.press('Escape'); await t('hist-dialog').waitFor({ state: 'detached' }); });
    await openHist();
    await page.locator('[data-testid=hist-row]', { hasText: 'Start' }).click();
    await gaps(2);
    assert.match(await t('cmd-prompt').textContent(), /^Went back 2 steps, to the start/);
    await openHist();
    assert.deepEqual(await rows(), ['Start', 'Join gaps', 'Delete 1']);
    await page.locator('[data-testid=hist-row]', { hasText: 'Delete 1' }).click();
    await gaps(0);
    assert.match(await t('cmd-prompt').textContent(), /^Went forward 2 steps, to after Delete 1/);
    // a layout has one too
    await t('add-to-layout').click(); await page.waitForTimeout(400);
    await page.locator('.tabs .dtab', { hasText: 'outline.dxf' }).first().click();
    await t('add-to-layout').click(); await page.waitForTimeout(500);
    await openHist();
    assert.deepEqual(await rows(), ['Start', 'Add outline']);
    await page.locator('[data-testid=hist-row]', { hasText: 'Start' }).click();
    await t('hist-dialog').waitFor({ state: 'detached' });
    assert.match(await t('cmd-prompt').textContent(), /^Went back 1 step, to the start/);
    await menuItem('Edit', 'Redo');
    await page.keyboard.press('Delete'); await page.waitForTimeout(300);
    await openHist();
    assert.deepEqual(await rows(), ['Start', 'Add outline', 'Delete outline']);
    await page.keyboard.press('Escape'); await t('hist-dialog').waitFor({ state: 'detached' });
  });

  await step('TODO 32: unsaved tabs are copied inside the app on a timer (?autosave=300 here, 2 minutes normally); a restart offers them back as unsaved tabs; saving or closing drops a copy; Discard clears', async () => {
    const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    const p = await c2.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    p.on('dialog', (d) => d.accept().catch(() => {}));                                  // "close without saving?"
    const u = URL_ + '?autosave=300', tp = (id) => p.locator(`[data-testid=${id}]`);
    const copies = () => p.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('project-d-recovery', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('copies', { keyPath: 'id' });
      r.onsuccess = () => { const q = r.result.transaction('copies').objectStore('copies').getAll(); q.onsuccess = () => { r.result.close(); res(q.result.map(({ dxf, ...x }) => ({ ...x, head: dxf.slice(0, 12), len: dxf.length }))); }; };
    }));
    const waitCopies = async (n) => { for (let i = 0; i < 60; i++) { const l = await copies(); if (l.length === n) return l; await p.waitForTimeout(150); } throw new Error('waiting for ' + n + ' copies, there are ' + (await copies()).length); };
    const names = () => p.locator('.tabs .dtab:not([aria-label]) .tname').allTextContents();
    await p.goto(u);
    await p.waitForSelector('[data-testid=count]', { state: 'attached' });
    assert.equal(await p.locator('[data-testid=recover-dialog]').count(), 0, 'nothing to recover on a first start');
    await tp('picker').setInputFiles('fixtures/outline.dxf');
    await p.waitForFunction(() => document.querySelector('[data-testid=gap-count]') && document.querySelector('[data-testid=gap-count]').textContent === '2');
    await p.waitForTimeout(900);
    assert.deepEqual(await copies(), [], 'an untouched drawing has no copy');
    await tp('gap-join').click();                                                         // a change: the tab has unsaved changes
    const first = await waitCopies(1);
    assert.deepEqual([first[0].name, first[0].kind, first[0].path], ['outline.dxf', 'drawing', null]);
    assert.match(first[0].head, /^\s*0\s+SECTION/);
    assert.ok(first[0].len > 500 && Number.isFinite(first[0].t));
    await tp('add-to-layout').click(); await p.waitForTimeout(500);                       // a layout tab: the grid part first, then one placed on its own
    await p.locator('.tabs .dtab', { hasText: 'outline.dxf' }).first().click();
    await tp('add-to-layout').click();
    const two = await waitCopies(2);
    assert.deepEqual(two.map((x) => x.kind).sort(), ['drawing', 'layout']);
    await p.locator('.tabs .dtab', { hasText: 'outline layout' }).first().locator('.x').click();      // closed on purpose: its copy goes
    await waitCopies(1);
    await p.locator('.tabs .dtab', { hasText: 'outline.dxf' }).first().click();
    await tp('add-to-layout').click();                                                      // a new layout tab again
    await p.waitForTimeout(400);
    await p.locator('.tabs .dtab', { hasText: 'outline.dxf' }).first().click();
    await tp('add-to-layout').click();
    await waitCopies(2);
    await p.reload();                                                                      // "the app was closed without saving"
    await tp('recover-dialog').waitFor();
    assert.match(await tp('recover-text').textContent(), /^Recover 2 unsaved drawings from \d\d:\d\d\?$/);
    assert.deepEqual(await p.locator('[data-testid=recover-dialog] li').allTextContents().then((l) => l.map((x) => x.replace(/, [^,]*\)$/, ')'))), ['outline.dxf (drawing)', 'outline layout (layout)']);
    await p.waitForTimeout(250); await p.screenshot({ path: shotDir + '/s14-recover-light.png' });
    await p.emulateMedia({ colorScheme: 'dark' }); await p.waitForTimeout(250); await p.screenshot({ path: shotDir + '/s14-recover-dark.png' });
    await p.emulateMedia({ colorScheme: 'light' });
    await tp('recover-ok').click();
    await tp('recover-dialog').waitFor({ state: 'detached' });
    await p.waitForFunction(() => document.querySelectorAll('.tabs .dtab:not([aria-label]) .tname').length === 2);
    assert.deepEqual((await names()).sort(), ['outline layout', 'outline.dxf']);
    assert.match(await tp('cmd-prompt').textContent(), /Recovered 2 unsaved drawings/);
    assert.equal(await p.locator('.tabs .dtab .dot').count(), 2, 'both come back marked unsaved');
    await p.locator('.tabs .dtab', { hasText: 'outline.dxf' }).first().click();
    await p.waitForFunction(() => document.querySelector('[data-testid=gap-count]').textContent === '0');           // the Join gaps change came back
    assert.equal((await copies()).length, 2, 'the copies stay until the tabs are saved or closed');
    await p.keyboard.press('Control+s');                                                    // Save works as before (browser: a download)
    await waitCopies(1);
    assert.equal(await p.locator('.tabs .dtab', { hasText: 'outline.dxf' }).first().locator('.dot').count(), 0, 'saved: the dot is gone');
    await p.reload();
    await tp('recover-dialog').waitFor();
    assert.match(await tp('recover-text').textContent(), /^Recover 1 unsaved drawing from /);
    await tp('recover-discard').click();
    await tp('recover-dialog').waitFor({ state: 'detached' });
    assert.deepEqual(await copies(), []);
    await p.reload(); await p.waitForSelector('[data-testid=count]', { state: 'attached' }); await p.waitForTimeout(500);
    assert.equal(await p.locator('[data-testid=recover-dialog]').count(), 0, 'nothing left to offer');
    assert.deepEqual(errs, []);
    await c2.close();
  });

  // ---- Next sessions 1: the drawing tools (draw.js): Line, Polyline, Rectangle, Rounded rectangle, Circle, Ellipse, Arc ----
  const fieldOf = (e, code) => +e.r.v[e.r.c.indexOf(code)];
  const savedDoc = async () => readDxf((await downloaded(() => page.keyboard.press('Control+s'))).text);
  await step('TODO 115 / T32: PDF invisible search text stays out; visible text becomes outlines once, with one Undo', async () => {
    await closeTabs(/./);
    await menuItem('File', 'Open…');
    await t('picker').setInputFiles({ name: 'search-text.pdf', mimeType: 'application/pdf', buffer: readFileSync('fixtures/pdf-search-text.pdf') });
    await page.waitForFunction(() => document.querySelector('.dtab.on .tname').textContent === 'search-text.dxf');
    const before = await savedDoc();
    assert.deepEqual(before.entities.map((e) => e.type), ['LINE', 'LINE', 'LINE', 'TEXT']);
    assert.equal(before.entities[3].r.v[before.entities[3].r.c.indexOf(1)], 'C', 'invisible searchable A is not imported over its strokes');
    await page.keyboard.press('Control+a');
    await menuItem('Modify', 'Text to outlines');
    await page.waitForFunction(() => /1 text →/.test(document.querySelector('[data-testid=cmd-prompt]').textContent), null, { timeout: 15000 });
    const outlined = await savedDoc();
    assert.deepEqual(outlined.entities.slice(0, 3), before.entities.slice(0, 3), 'original letter strokes stay once');
    assert.ok(outlined.entities.slice(3).length > 0 && outlined.entities.slice(3).every((e) => e.type === 'LWPOLYLINE'), 'visible text is replaced by curves');
    for (const theme of ['light', 'dark']) {
      await menuItem('View', 'Theme: ' + theme); await page.waitForTimeout(150);
      await page.screenshot({ path: `${shotDir}/s17-115-outlines-${theme}.png` });
    }
    await menuItem('View', 'Theme: light');
    await menuItem('Modify', 'Text to outlines');
    assert.deepEqual((await savedDoc()).entities, outlined.entities, 'running again adds no second copy');
    await page.keyboard.press('Escape'); await page.keyboard.press('Control+z');
    assert.deepEqual((await savedDoc()).entities, before.entities, 'one Undo restores the visible text and the original strokes');
    await closeTabs(/search-text/);
  });
  await step('TODO 120 / T37: PDF selections drag, stay unlocked, undo once and cancel safely', async () => {
    await closeTabs(/./);
    const empty = await t('canvas').boundingBox(), errorCount = errors.length;
    await page.mouse.move(empty.x + 100, empty.y + 100); await page.mouse.down();
    await page.mouse.move(empty.x + 140, empty.y + 140, { steps: 5 }); await page.mouse.up();
    assert.equal(errors.length, errorCount, 'an untouched empty drawing has no selection set to drag');
    const pdf = new Page(100, 80);
    pdf.moveTo(20, 20); pdf.lineTo(30, 50); pdf.lineTo(40, 20); pdf.stroke();
    pdf.moveTo(25, 30); pdf.lineTo(35, 30); pdf.stroke();
    pdf.text([8, 0, 0, 8, 60, 30], 'A');
    await menuItem('File', 'Open…');
    await t('picker').setInputFiles({ name: 'drag-letter.pdf', mimeType: 'application/pdf', buffer: Buffer.from(writePdf([pdf])) });
    await page.waitForFunction(() => document.querySelector('.dtab.on .tname').textContent === 'drag-letter.dxf');
    await page.getByRole('tab', { name: 'Objects', exact: true }).click();
    assert.match(await t('obj-filter-locked').textContent(), /Locked 0/, 'PDF imports open unlocked');
    assert.equal(await t('bg-name').textContent(), '', 'File Open creates drawing entities without a background picture');
    await page.getByRole('tab', { name: 'Drawing', exact: true }).click();
    if (await t('tog-snap').getAttribute('aria-pressed') === 'true') await t('tog-snap').click();
    const before = await savedDoc();
    const boxA = await at(18, 18), boxB = await at(42, 52);
    await page.mouse.move(boxA.x, boxA.y); await page.mouse.down();
    await page.mouse.move(boxB.x, boxB.y, { steps: 5 }); await page.mouse.up();
    await waitSel('3 selected');
    const start = await at(22.5, 27.5), end = await at(32.5, 32.5);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const previewPoint = await at(40, 35);
    assert.ok(await t('drawing').evaluate((canvas, p) => {
      const b = canvas.getBoundingClientRect(), x = Math.round((p.x - b.x) * canvas.width / b.width), y = Math.round((p.y - b.y) * canvas.height / b.height);
      return canvas.getContext('2d').getImageData(x - 2, y - 2, 5, 5).data.some((v, i) => i % 4 === 3 && v > 0);
    }, previewPoint), 'the moving preview is painted at the offset');
    await page.mouse.up();
    const moved = await savedDoc();
    assert.ok(Math.abs(fieldOf(moved.entities[0], 10) - fieldOf(before.entities[0], 10) - 10) < .05, 'selected A moves');
    assert.ok(Math.abs(fieldOf(moved.entities[0], 20) - fieldOf(before.entities[0], 20) - 5) < .05);
    assert.deepEqual(moved.entities[3], before.entities[3], 'unselected text stays');
    await page.keyboard.press('Control+z');
    assert.deepEqual((await savedDoc()).entities, before.entities, 'one undo restores the whole A');
    // A single imported TEXT also moves by its body, away from its resize handles.
    await click(63, 32); await waitSel('1 selected');
    const textStart = await at(63, 32), textEnd = await at(73, 37);
    await page.mouse.move(textStart.x, textStart.y); await page.mouse.down();
    await page.mouse.move(textEnd.x, textEnd.y, { steps: 5 }); await page.mouse.up();
    const textMoved = await savedDoc();
    assert.ok(Math.abs(fieldOf(textMoved.entities[3], 10) - fieldOf(before.entities[3], 10) - 10) < .05);
    const cancelStart = await at(73, 37), cancelEnd = await at(83, 42);
    await page.mouse.move(cancelStart.x, cancelStart.y); await page.mouse.down();
    await page.mouse.move(cancelEnd.x, cancelEnd.y, { steps: 5 }); await page.keyboard.press('Escape'); await page.mouse.up();
    assert.deepEqual((await savedDoc()).entities, textMoved.entities, 'Escape cancels');
    await page.mouse.move(cancelStart.x, cancelStart.y); await page.mouse.down();
    await page.mouse.move(cancelEnd.x, cancelEnd.y, { steps: 5 });
    await page.locator('.canvas').dispatchEvent('pointercancel'); await page.mouse.up();
    assert.deepEqual((await savedDoc()).entities, textMoved.entities, 'pointer cancellation keeps the drawing');
    await page.mouse.move(cancelStart.x, cancelStart.y); await page.mouse.down();
    await page.keyboard.down('Shift'); await page.mouse.move(cancelEnd.x, cancelEnd.y, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Shift');
    const straight = await savedDoc();
    assert.ok(Math.abs(fieldOf(straight.entities[3], 10) - fieldOf(textMoved.entities[3], 10) - 10) < .05);
    assert.equal(fieldOf(straight.entities[3], 20), fieldOf(textMoved.entities[3], 20), 'Shift constrains the move');
    for (const theme of ['light', 'dark']) {
      await menuItem('View', 'Theme: ' + theme);
      await page.screenshot({ path: `${shotDir}/s17-120-moved-A-${theme}.png` });
    }
    await menuItem('View', 'Theme: light');
    if (await t('tog-snap').getAttribute('aria-pressed') !== 'true') await t('tog-snap').click();
    await closeTabs(/drag-letter/);
  });
  await step('TODO 120 fix: dragging a selection containing a locked layer reports the layer and keeps every entity', async () => {
    await closeTabs(/./);
    const raw = newDoc(4);
    addLayer(raw, 'Locked');
    raw.entities = [dxfLine(20, 20, 60, 20), dxfLine(60, 20, 60, 60, { layer: 'Locked' }), dxfLine(60, 60, 20, 60), dxfLine(20, 60, 20, 20)];
    await t('picker').setInputFiles({ name: 'locked-drag.dxf', mimeType: 'application/dxf', buffer: Buffer.from(writeDxf(raw)) });
    await page.waitForFunction(() => document.querySelector('.dtab.on .tname').textContent === 'locked-drag.dxf');
    await t('ptab-objects').click();
    await page.locator('.or.layer[data-layer=Locked] [data-act=lock]').click();
    await t('ptab-drawing').click();
    await page.locator('[data-outline="1"]').click(); await waitSel('4 selected');
    const before = await savedDoc(), start = await at(30, 20), end = await at(35, 25);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 }); await page.mouse.up();
    assert.match(await prompt(), /Layer Locked is locked/);
    assert.deepEqual((await savedDoc()).entities, before.entities);
    await closeTabs(/locked-drag/);
  });
  const histLabels = async () => {
    await menuItem('Edit', 'Undo history…'); await t('hist-dialog').waitFor();
    const rows = await page.locator('[data-testid=hist-row] > span:last-child').allTextContents();
    await page.keyboard.press('Escape'); await t('hist-dialog').waitFor({ state: 'detached' });
    return rows;
  };
  const tipText = () => t('draw-tip').textContent();
  const tipWhen = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('[data-testid=draw-tip]').textContent), re.source, { timeout: 8000 }).catch(async (e) => { throw new Error('the readout ' + re + ' never came; it says ' + JSON.stringify(await tipText().catch(() => null)) + '; prompt ' + (await prompt()) + '; ortho ' + (await t('tog-ortho').getAttribute('aria-pressed'))); });
  await step('drawing tools: the rail buttons are built (titles with keys); on a layout tab they say so; on an empty "Drawing 1" tab a drawing tool makes it a drawing', async () => {
    await closeTabs(/./);
    assert.deepEqual(await tabNames(), ['Drawing 1']);
    const titles = {};
    for (const id of ['line', 'polyline', 'rect', 'rrect', 'circle', 'ellipse', 'arc']) {
      const b = page.locator('[data-tool=' + id + ']');
      assert.equal(await b.getAttribute('aria-disabled'), null, id + ' is built');
      titles[id] = await b.getAttribute('title');
    }
    assert.deepEqual([titles.line, titles.polyline, titles.rect, titles.circle, titles.ellipse, titles.arc], ['Line (L)', 'Polyline (PL)', 'Rectangle (R)', 'Circle (C)', 'Ellipse (EL)', 'Arc (A)']);
    // a layout tab: the tools say so and do not become the tool
    await t('new-layout').click();
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').dataset.kind === 'layout');
    await page.locator('[data-tool=line]').click();
    assert.match(await prompt(), /^Drawing tools work on a drawing tab:?$/);
    assert.notEqual(await t('tool-chip').textContent(), 'Tool: Line');
    await typeCmd('c');
    assert.match(await prompt(), /^Drawing tools work on a drawing tab:?$/);
    await closeTabs(/layout/i);
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').dataset.kind === 'drawing');
    // the empty tab
    await page.locator('[data-tool=line]').click();
    assert.equal(await t('tool-chip').textContent(), 'Tool: Line');
    assert.equal(await t('cmd-hist').textContent(), 'Command: LINE   layer 0');
    assert.equal(await prompt(), 'Specify first point (x,y):');
    assert.equal(await page.locator('.layer', { hasText: '0' }).locator('[data-testid=layer-current]').textContent(), 'current', 'layer 0 is the current layer to begin with');
    assert.equal(await page.locator('.tabs .dtab .dot').count(), 0, 'nothing drawn yet: still untouched');
  });

  await step('Line: typed x,y and @dx,dy, a length while the rubber band points the way; each segment is made at once, its own undo step; Esc ends; saved as LINEs', async () => {
    await typeCmd('20,20');
    assert.match(await prompt(), /^Next point or length \[Undo\]:?$/);
    assert.equal(await entCount(), 0, 'the first point makes nothing');
    await typeCmd('@100,0');
    assert.equal(await entCount(), 1, 'the first segment is in the drawing at once');
    // direct distance entry: the pointer points straight up from the last point (120, 20); type 50
    const p = await at(120, 70);
    await t('tog-ortho').click();                              // ORTHO (a sticky Shift) locks it straight up
    await page.mouse.move(p.x, p.y);
    await tipWhen(/· 90\.00°$/);
    assert.equal(await t('draw-preview').count(), 1, 'the rubber band is drawn');
    await typeCmd('50');
    await t('tog-ortho').click();
    assert.equal(await entCount(), 2, 'both segments are in the drawing already');
    assert.match(await t('cmd-hist').textContent(), /2 segments made/);
    await page.keyboard.press('Escape');                     // Esc ends the command (Enter and right-click the other ways), nothing is taken back
    assert.equal(await entCount(), 2);
    assert.equal(await page.locator('.tabs .dtab .dot').count(), 1, 'the tab is marked unsaved now');
    assert.deepEqual(await histLabels(), ['Start', 'Line', 'Line']);
    const doc = await savedDoc();
    assert.deepEqual(doc.entities.map((e) => e.type), ['LINE', 'LINE']);
    assert.deepEqual([10, 20, 11, 21].map((c) => fieldOf(doc.entities[0], c)), [20, 20, 120, 20]);
    assert.deepEqual([10, 20, 11, 21].map((c) => fieldOf(doc.entities[1], c)), [120, 20, 120, 70]);
  });

  await step('Line: clicks snap to ends and middles of what is drawn; Shift keeps it straight; right-click ends; Ctrl+Z takes it back', async () => {
    await page.locator('[data-tool=line]').click();
    await click(120.4, 69.7);                                  // within a few pixels of the end (120, 70): snaps to it exactly
    const free = await at(60, 90);
    await page.mouse.move(free.x, free.y);
    await tipWhen(/^[\d.]+ mm/);
    await page.keyboard.down('Shift');
    await page.mouse.move(free.x + 1, free.y + 1);
    await tipWhen(/· (0|180)\.00°$/);                         // straight along X from the first point
    await page.keyboard.up('Shift');
    const mid = await at(70, 20);                              // the middle of the first line (20,20)-(120,20): a snap too
    await page.mouse.move(mid.x, mid.y);
    await page.waitForTimeout(150);
    await page.mouse.click(mid.x, mid.y);
    assert.equal(await entCount(), 3, 'the click made the segment');
    await page.mouse.click(mid.x, mid.y, { button: 'right' });  // right-click ends the command, the segment stays
    assert.equal(await entCount(), 3);
    const doc = await savedDoc(), e = doc.entities[2];
    assert.deepEqual([10, 20].map((c) => fieldOf(e, c)), [120, 70], 'its start is the snapped end, to the digit');
    assert.deepEqual([11, 21].map((c) => +fieldOf(e, c).toFixed(6)), [70, 20], 'its end is the snapped middle');
    await page.keyboard.press('Control+z');
    assert.equal(await entCount(), 2, 'one Ctrl+Z took the segment (one step)');
  });

  await step('Line, the AutoCAD way: Ctrl+Z or U mid-command takes the last segment back and goes on from the one before; Esc after the first point adds nothing; Esc / right-click keep the segments', async () => {
    await page.locator('[data-tool=line]').click();
    await typeCmd('300,100');
    assert.equal(await entCount(), 2, 'the first point adds nothing');
    await page.keyboard.press('Escape');
    assert.equal(await entCount(), 2, 'Esc with only the first point: nothing added, nothing taken');
    assert.equal(await prompt(), 'Specify first point (x,y):');
    await typeCmd('300,100'); await typeCmd('@50,0'); await typeCmd('@0,50');
    assert.equal(await entCount(), 4);
    assert.match(await prompt(), /Close \/ Undo/);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Control+z');
    assert.equal(await entCount(), 3, 'Ctrl+Z mid-command: the last segment is gone');
    await typeCmd('@0,-20');                                   // carries on from (350, 100), where that segment began
    assert.equal(await entCount(), 4);
    let doc = await savedDoc(), e = doc.entities[3];
    assert.deepEqual([10, 20, 11, 21].map((c) => fieldOf(e, c)), [350, 100, 350, 80]);
    await typeCmd('u');
    assert.equal(await entCount(), 3, 'U takes the last segment back too');
    await typeCmd('u');
    assert.equal(await entCount(), 2, 'and the one before');
    await typeCmd('300,100'); await typeCmd('@10,0');
    await page.keyboard.press('Escape');
    assert.equal(await entCount(), 3, 'Esc keeps the segment');
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Control+z');
    assert.equal(await entCount(), 2, 'back to where this step began');
    await page.locator('[data-tool=polyline]').click(); await page.locator('[data-tool=line]').click(); await page.keyboard.press('Escape');
  });

  await step('Polyline: one LWPOLYLINE; C closes it; U drops the last point', async () => {
    await page.locator('[data-tool=polyline]').click();
    assert.equal(await t('tool-chip').textContent(), 'Tool: Polyline');
    await typeCmd('150,20'); await typeCmd('@60,0'); await typeCmd('@0,40'); await typeCmd('@-10,10'); await typeCmd('u');
    assert.equal(await t('draw-preview').count(), 1);
    assert.match(await prompt(), /Close \/ Undo/);
    await typeCmd('c');
    assert.equal(await entCount(), 3);
    const doc = await savedDoc(), e = doc.entities[2];
    assert.equal(e.type, 'LWPOLYLINE');
    assert.equal(fieldOf(e, 70) & 1, 1, 'closed');
    assert.equal(e.r.c.filter((c) => c === 10).length, 3, 'three corners (the undone one is gone)');
    assert.equal((await histLabels()).at(-1), 'Polyline');
  });

  await step('Rectangle: two corners, or a first corner then W,H; a closed LWPOLYLINE; Rounded rectangle asks its radius first and remembers it', async () => {
    await page.evaluate(() => localStorage.removeItem('pd-rradius'));
    await page.locator('[data-tool=rect]').click();
    await typeCmd('20,100'); await typeCmd('60,30');
    assert.equal(await entCount(), 4);
    await click(120.3, 20.2); await click(150, 60);            // the first corner snaps to the end (120, 20)
    assert.equal(await entCount(), 5);
    await page.locator('[data-tool=rrect]').click();
    assert.equal(await prompt(), 'Corner radius <5.00>:');
    await typeCmd('8');
    assert.equal(await prompt(), 'Specify first corner [Radius]:');
    await typeCmd('160,100'); await typeCmd('@50,30');
    assert.equal(await entCount(), 6);
    await page.locator('[data-tool=rrect]').click();
    assert.equal(await prompt(), 'Corner radius <8.00>:', 'the radius is remembered');
    assert.equal(await page.evaluate(() => localStorage.getItem('pd-rradius')), '8');
    await typeCmd('');                                         // Enter keeps it
    assert.equal(await prompt(), 'Specify first corner [Radius]:');
    await page.keyboard.press('Escape');
    assert.equal(await t('tool-chip').textContent(), 'Tool: Select', 'Esc with nothing in progress: back to Select');
    const doc = await savedDoc();
    assert.deepEqual(doc.entities.slice(2).map((e) => e.type), ['LWPOLYLINE', 'LWPOLYLINE', 'LWPOLYLINE', 'LWPOLYLINE']);
    const xs = (e) => e.r.v.filter((_, k) => e.r.c[k] === 10).map(Number), ys = (e) => e.r.v.filter((_, k) => e.r.c[k] === 20).map(Number);
    assert.deepEqual([xs(doc.entities[3]), ys(doc.entities[3])], [[20, 80, 80, 20], [100, 100, 130, 130]]);
    assert.deepEqual([xs(doc.entities[4])[0], ys(doc.entities[4])[0]], [120, 20], 'the snapped corner');
    const rr = doc.entities[5], bulge = +rr.r.v[rr.r.c.indexOf(42)];
    assert.equal(rr.r.c.filter((c) => c === 10).length, 8); assert.equal(rr.r.c.filter((c) => c === 42).length, 4);
    assert.ok(bulge > 0.41 && bulge < 0.42, 'quarter-circle bulges');
    assert.equal(xs(rr)[0], 168, 'the corner radius is 8');
    assert.deepEqual((await histLabels()).slice(-3), ['Rectangle', 'Rectangle', 'Rounded rectangle']);
  });

  await step('Circle (centre, then radius or D for a diameter), Ellipse (centre, axis 1, other half-axis) and Arc (3 points)', async () => {
    await page.locator('[data-tool=circle]').click();
    await typeCmd('50,60'); await typeCmd('d');
    assert.equal(await prompt(), 'Diameter [Radius]:');
    await typeCmd('40');
    await click(50.2, 60.1);                                   // a circle by clicks: the centre snaps to the first circle's centre
    const r = await at(65, 60); await page.mouse.move(r.x, r.y);
    await tipWhen(/^R /);
    await click(65, 60);
    assert.equal(await entCount(), 8);
    await page.locator('[data-tool=ellipse]').click();
    await typeCmd('115,112'); await typeCmd('@25,0'); await typeCmd('8');
    await page.locator('[data-tool=arc]').click();
    await typeCmd('170,75'); await typeCmd('185,90');
    assert.equal(await prompt(), 'Specify end point:');
    await typeCmd('200,75');
    assert.equal(await entCount(), 10);
    const doc = await savedDoc(), types = doc.entities.slice(6).map((e) => e.type);
    assert.deepEqual(types, ['CIRCLE', 'CIRCLE', 'ELLIPSE', 'ARC']);
    assert.deepEqual([10, 20, 40].map((c) => fieldOf(doc.entities[6], c)), [50, 60, 20]);
    assert.equal(fieldOf(doc.entities[7], 10), 50, "snapped to the first circle's centre");
    assert.ok(fieldOf(doc.entities[7], 40) > 14);
    const el = doc.entities[8];
    assert.deepEqual([10, 20, 11, 21, 40].map((c) => fieldOf(el, c)), [115, 112, 25, 0, 0.32]);
    const ar = doc.entities[9];
    assert.deepEqual([10, 20, 40, 50, 51].map((c) => Math.round(fieldOf(ar, c) * 1e6) / 1e6), [185, 75, 15, 0, 180]);
    assert.deepEqual((await histLabels()).slice(-4), ['Circle', 'Circle', 'Ellipse', 'Arc']);
  });

  await step('the new shapes are ordinary entities: selectable, snappable, and they reopen', async () => {
    await page.locator('[data-tool=select]').click();
    await click(140, 112);                                     // the ellipse's right end
    assert.equal(await selCount(), '1 selected');
    await page.keyboard.press('Escape');
    // snaps on the new shapes: the circle's centre (50, 60) and the arc's middle (185, 90), both to the digit
    await page.locator('[data-tool=line]').click();
    await click(50.3, 60.3); await click(185.2, 89.8);
    await page.keyboard.press('Enter');
    const doc = await savedDoc(), e = doc.entities[10];
    assert.deepEqual([10, 20].map((c) => fieldOf(e, c)), [50, 60]);
    assert.deepEqual([11, 21].map((c) => Math.round(fieldOf(e, c) * 1e6) / 1e6), [185, 90]);
    await page.keyboard.press('Control+z');
    // reopen the saved file: all the shapes come back as what they were
    const text = (await downloaded(() => page.keyboard.press('Control+s'))).text;
    await t('picker').setInputFiles({ name: 'drawn.dxf', mimeType: 'text/plain', buffer: Buffer.from(text, 'latin1') });
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'drawn.dxf');
    assert.equal(await entCount(), 10);
  });

  await step('Current layer: a layer clicked in the Layers panel gets the new shapes; the file keeps its own layers', async () => {
    await closeTabs(/./);
    await t('picker').setInputFiles({ name: 'shapes.dxf', mimeType: 'text/plain', buffer: Buffer.from(shapesDoc(), 'latin1') });
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'shapes.dxf');
    assert.equal(await page.locator('[data-testid=layer-current]').count(), 1);
    assert.equal(await page.locator('.layer.current .nm').textContent(), '0');
    await page.locator('.layer', { hasText: 'Open' }).click();
    assert.equal(await page.locator('.layer.current .nm').textContent(), 'Open');
    assert.match((await t('cmd-hist').textContent()) + (await prompt()), /Current layer: Open/);
    await page.locator('[data-tool=circle]').click();
    assert.match(await t('cmd-hist').textContent(), /layer Open/);
    await typeCmd('700,150'); await typeCmd('15');
    const doc = await savedDoc(), c = doc.entities.at(-1);
    assert.equal(c.type, 'CIRCLE'); assert.equal(c.layer, 'Open');
    assert.equal(doc.entities.slice(0, -1).filter((e) => e.layer === 'Plate').length, 2);
    await page.locator('[data-tool=select]').click();
  });

  await step('Layers + Add: Layer1, Layer2… become the current layer with the name ready to type; rename and colour; a bad name says why; one undo step; saved in the DXF', async () => {
    await closeTabs(/./);
    await t('picker').setInputFiles({ name: 'shapes.dxf', mimeType: 'text/plain', buffer: Buffer.from(shapesDoc(), 'latin1') });
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'shapes.dxf');
    const add = t('layer-add'), name = t('layer-name'), rows = page.locator('.layer');
    assert.equal(await add.isDisabled(), false);
    assert.equal(await add.getAttribute('aria-disabled'), null, '+ Add is built, not greyed');
    const before = await rows.count();
    await add.click();
    assert.equal(await rows.count(), before + 1);
    assert.equal(await name.inputValue(), 'Layer1');
    assert.equal(await name.evaluate((el) => document.activeElement === el), true, 'the name is ready to type over');
    assert.equal(await page.locator('.layer.current [data-testid=layer-name]').count(), 1, 'the new layer is the current one');
    await name.press('Enter');
    await page.keyboard.press('Control+z');                                          // one undo step takes it away
    await page.waitForFunction(() => !document.querySelector('[data-testid=layer-name]'));
    assert.equal(await page.locator('.layer.current .nm').textContent(), '0');
    assert.ok((await histLabels()).includes('Add layer Layer1'));
    await page.keyboard.press('Control+y');
    assert.equal(await name.inputValue(), 'Layer1', 'redo brings it back');
    await add.click();
    assert.equal(await page.locator('.layer.current [data-testid=layer-name]').inputValue(), 'Layer2', 'the next free name');
    // a bad name is refused with a reason and the old name comes back, marked
    const l2 = page.locator('.layer.current [data-testid=layer-name]');
    await l2.fill('Plate'); await l2.press('Enter');
    assert.match(await prompt(), /The layer "Plate" is already there/);
    assert.equal(await l2.inputValue(), 'Layer2'); assert.equal(await l2.getAttribute('aria-invalid'), 'true');
    await l2.fill('a/b'); await l2.press('Enter');
    assert.match(await prompt(), /can't hold/);
    await l2.fill('Cut line'); await l2.press('Enter');
    assert.match(await prompt(), /Layer renamed to Cut line/);
    await t('layer-colour').last().fill('#ff0000');
    assert.equal(await page.locator('.layer.current [data-testid=layer-name]').inputValue(), 'Cut line');
    for (const th of ['light', 'dark']) { await page.evaluate((x) => { document.documentElement.dataset.theme = x; }, th); await page.locator('.layers').screenshot({ path: `${shotDir}/s15-addlayer-${th}.png` }); }
    await page.evaluate(() => { delete document.documentElement.dataset.theme; });
    await page.locator('[data-tool=circle]').click();
    assert.match(await t('cmd-hist').textContent(), /layer Cut line/);
    await typeCmd('700,150'); await typeCmd('15');
    const doc = await savedDoc();
    assert.equal(doc.entities.at(-1).layer, 'Cut line');
    assert.equal(doc.layers['Cut line'].tc, 0xff0000);
    assert.ok(doc.layers.Layer1, 'the empty layer is in the file too');
    await page.locator('[data-tool=select]').click();
  });

  await step('drawing tools: screenshots mid-draw, light and dark (the live preview and its readout)', async () => {
    await closeTabs(/./);
    await page.locator('[data-tool=rrect]').click();
    await typeCmd('10');
    await typeCmd('40,30'); await typeCmd('90,70');
    await page.locator('[data-tool=circle]').click();
    await typeCmd('150,50'); await typeCmd('25');
    await page.locator('[data-tool=arc]').click();
    await typeCmd('40,100'); await typeCmd('90,115');
    const pt = await at(130, 70);
    await shotBoth('draw-tools', async () => { await page.mouse.move(pt.x, pt.y); await tipWhen(/^R /); }, async () => {});
    assert.equal(await t('draw-preview').count(), 1);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await closeTabs(/./);
  });

  // ---- TODO 47: the floating command bar (cmdbar.js, cmdui.js; mock-up R12b Option B) ----
  const barOn = () => t('cmd-bar').isVisible();
  const toolChip = async () => (await t('tool-chip').textContent()).trim();
  const canvasBox = () => t('canvas').boundingBox();
  await step('command bar: a letter typed on the drawing opens it at the cursor with autocomplete; Enter starts the command; Esc cancels; the status bar has the echo and the hint', async () => {
    await closeTabs(/./);
    assert.equal(await barOn(), false, 'shut at the start');
    assert.ok((await t('cmd-echo').textContent()).length < 60, 'the echo is the last command and its last answers, not the whole session');
    assert.match(await page.locator('.cb-hint').textContent(), /Just start typing on the drawing · F2 history/);
    const cb = await canvasBox();
    await page.mouse.move(cb.x + 300, cb.y + 200);
    await page.keyboard.press('l');
    await t('cmd-bar').waitFor();
    assert.equal(await t('cmd-input').inputValue(), 'l', 'the letter typed is the first letter in the bar');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid')), 'cmd-input');
    const bb = await t('cmd-bar').boundingBox();
    assert.ok(Math.abs(bb.x - (cb.x + 320)) < 3 && Math.abs(bb.y - (cb.y + 220)) < 3, `20 px right-below the cursor, got ${bb.x - cb.x - 300},${bb.y - cb.y - 200}`);
    const row = t('cmd-sugg').first();
    assert.match(await row.textContent(), /line.*Straight segments.*Draw/i, 'name, alias, description and category');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-testid=tool-chip]').textContent.trim() === 'Tool: Line');
    assert.equal(await barOn(), false, 'Enter starts the command and shuts the bar');
    assert.match(await t('cmd-fade').textContent(), /Command:\s*l/i, 'the fade shows the command line');
    assert.match(await t('cmd-echo').textContent(), /LINE/);
    await page.keyboard.press('Escape');
    assert.equal(await toolChip(), 'Tool: Select', 'Esc cancels the command');
  });

  await step('command bar: arrow keys choose, Tab accepts; a flip keeps it inside the canvas; Space repeats the last command; inside a text-entry command Space types a space', async () => {
    const cb = await canvasBox();
    await page.mouse.move(cb.x + cb.width - 10, cb.y + cb.height - 10);          // the far corner: the bar flips left and up
    await page.keyboard.type('re');
    await t('cmd-bar').waitFor();
    const bb = await t('cmd-bar').boundingBox();
    assert.ok(bb.x + bb.width <= cb.x + cb.width + 1 && bb.y + bb.height <= cb.y + cb.height + 1 && bb.x < cb.x + cb.width - 10 - bb.width + 40, 'flipped left / up, still inside the canvas');
    const names = await t('cmd-sugg').locator('.nm').allTextContents();
    assert.ok(names.length >= 2, 'several commands start with re: ' + names.join());
    await page.keyboard.press('ArrowDown');
    assert.equal(await t('cmd-sugg').nth(1).getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Tab');
    assert.equal(await t('cmd-input').inputValue(), names[1], 'Tab puts the chosen command in');
    await page.keyboard.press('Escape');
    assert.equal(await barOn(), false);
    await page.mouse.move(cb.x + 300, cb.y + 200);
    await typeCmd('circle');                                                    // the full name works as the alias does
    await page.waitForFunction(() => document.querySelector('[data-testid=tool-chip]').textContent.trim() === 'Tool: Circle');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Space');                                         // Space on the drawing: the last command (CIRCLE) again
    await page.waitForFunction(() => document.querySelector('[data-testid=tool-chip]').textContent.trim() === 'Tool: Circle');
    assert.match(await t('cmd-fade').textContent(), /repeats CIRCLE/);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await t('cmd-echo').click();                                                // an empty bar: Space is Enter
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('[data-testid=tool-chip]').textContent.trim() === 'Tool: Circle');
    assert.equal(await barOn(), false);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    // Space after a command word accepts it; in a sentence it is a space
    await t('cmd-echo').click(); await page.keyboard.type('l'); await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('[data-testid=tool-chip]').textContent.trim() === 'Tool: Line');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await page.locator('[data-tool=text]').click();                             // a text-entry command: Space types a space
    await t('cmd-echo').click();
    await t('cmd-input').pressSequentially('height 12');
    assert.equal(await t('cmd-input').inputValue(), 'height 12', 'Space is a space inside what is typed');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    assert.equal(await toolChip(), 'Tool: Select');
  });

  await step('command bar: the prompt shows with its option chips; typing the underlined letter picks one; a chip click answers; Esc shuts the bar and cancels', async () => {
    const cb = await canvasBox();
    await page.mouse.move(cb.x + 300, cb.y + 200);
    await typeCmd('c'); await typeCmd('50,50');
    assert.match(await prompt(), /^Radius \[Diameter\]:?$/);
    await page.keyboard.press('x');                                             // any key opens the bar during a command
    await t('cmd-bar').waitFor();
    assert.match(await t('cmd-bar-prompt').textContent(), /Radius \[Diameter\]/);
    await page.keyboard.press('Backspace');
    const chip = t('cmd-chip');
    assert.equal(await chip.count(), 1);
    assert.equal(await chip.locator('b').textContent(), 'D', 'the key letter is underlined');
    assert.equal(await chip.textContent(), 'Diameter');
    await page.keyboard.type('d');
    assert.match(await chip.getAttribute('class'), /hit/, 'the typed letter lights its chip');
    await page.keyboard.press('Backspace');
    await chip.click();
    await page.waitForFunction(() => /^Diameter \[Radius\]/.test(document.querySelector('[data-testid=cmd-prompt]').textContent.trim()));
    assert.equal(await barOn(), false);
    await page.keyboard.press('d');                                             // reopen, then type the letter and Enter
    await t('cmd-input').fill('r'); await t('cmd-input').press('Enter');
    await page.waitForFunction(() => /^Radius \[Diameter\]/.test(document.querySelector('[data-testid=cmd-prompt]').textContent.trim()));
    await page.keyboard.press('x'); await t('cmd-bar').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await barOn(), false, 'Esc shuts the bar');
    assert.equal(await toolChip(), 'Tool: Circle');
    assert.equal(await entCount(), 0, 'nothing was made');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    assert.equal(await toolChip(), 'Tool: Select');
  });

  await step('command bar: F2 opens the history on the right; the filter, Copy history and a click on a line that runs it again; F2 and Esc shut it', async () => {
    assert.equal(await t('cmd-history').isVisible(), false);
    await page.keyboard.press('F2');
    await t('cmd-history').waitFor();
    const lines = await t('cmd-history-line').allTextContents();
    assert.ok(lines.some((l) => /Command:\s*l/i.test(l)) && lines.some((l) => /Radius \[Diameter\]/.test(l)), 'the session\'s lines are listed: ' + lines.slice(-4).join(' | '));
    await t('cmd-history').locator('input').fill('diameter');
    const some = await t('cmd-history-line').allTextContents();
    assert.ok(some.length > 0 && some.every((l) => /diameter/i.test(l)), 'the filter keeps only the matching lines');
    await t('cmd-history').locator('input').fill('');
    assert.ok(await t('cmd-copy').isVisible());
    await t('cmd-history-line').filter({ hasText: /Command:\s*l\b/i }).first().click();
    await page.waitForFunction(() => document.querySelector('[data-testid=tool-chip]').textContent.trim() === 'Tool: Line');
    await page.keyboard.press('Escape');                                         // Esc shuts the drawer first, then cancels
    assert.equal(await t('cmd-history').isVisible(), false);
    await page.keyboard.press('Escape');
    assert.equal(await toolChip(), 'Tool: Select');
    await page.keyboard.press('F2'); await t('cmd-history').waitFor();
    await page.keyboard.press('F2');
    assert.equal(await t('cmd-history').isVisible(), false, 'F2 again shuts it');
  });

  await step('command bar: in Contour a bare option that takes a value waits for it (no "Unknown command"); `d 7` sets the distance; Esc with the bar open cancels the command; the footer says what Enter takes', async () => {
    await closeTabs(/./);
    await t('picker').setInputFiles({ name: 'shapes.dxf', mimeType: 'text/plain', buffer: Buffer.from(shapesDoc(), 'latin1') });
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'shapes.dxf');
    await page.locator('[data-tool=contour]').click();
    const cb = await canvasBox();
    await page.mouse.move(cb.x + 300, cb.y + 200);
    await page.keyboard.press('d'); await t('cmd-bar').waitFor();
    await page.keyboard.press('Enter');                                          // the bare option: the bar keeps waiting for the value
    assert.equal(await barOn(), true, 'the bar stays open');
    assert.equal(await t('cmd-input').inputValue(), 'distance ');
    assert.doesNotMatch(await t('cmd-hist').textContent(), /Unknown command/);
    await page.keyboard.type('7'); await page.keyboard.press('Enter');
    assert.equal(await barOn(), false);
    assert.equal(await t('contour-dist').inputValue(), '7.0');
    await page.keyboard.press('d'); await t('cmd-input').fill('d 5'); await page.keyboard.press('Enter');
    assert.equal(await t('contour-dist').inputValue(), '5.0', '`d 5` through the bar');
    assert.doesNotMatch(await t('cmd-hist').textContent(), /Unknown command/);
    await page.keyboard.press('s'); await t('cmd-bar').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await barOn(), false);
    assert.equal(await toolChip(), 'Tool: Select', 'Esc with the bar open cancels the command that is on');
    assert.equal(await t('contour-panel').isVisible(), false);
    await closeTabs(/./);
  });

  await step('command bar: screenshots, light and dark (typing with autocomplete; a prompt with chips; the history drawer)', async () => {
    const cb = await canvasBox();
    await page.mouse.move(cb.x + 420, cb.y + 260);
    await shotBoth('cmdbar-typing', async () => { await page.mouse.move(cb.x + 420, cb.y + 260); await page.keyboard.type('ro'); await t('cmd-bar').waitFor(); }, async () => { await page.keyboard.press('Escape'); });
    await typeCmd('c'); await typeCmd('50,50');
    await shotBoth('cmdbar-prompt', async () => { await page.mouse.move(cb.x + 420, cb.y + 260); await page.keyboard.press('x'); await t('cmd-bar').waitFor(); await page.keyboard.press('Backspace'); }, async () => { await page.evaluate(() => document.activeElement.blur()); });       // blur shuts the bar and keeps the command
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await shotBoth('cmdbar-history', async () => { await page.keyboard.press('F2'); await t('cmd-history').waitFor(); }, async () => { await page.keyboard.press('Escape'); });
    assert.equal(await t('cmd-history').isVisible(), false);
  });

  // ---- TODO 17: the Text tool (text.js; mock-up R5a Option A) ----
  const wait = (ms) => page.waitForTimeout(ms);
  const texts = (doc) => doc.entities.filter((e) => e.type === 'TEXT' || e.type === 'MTEXT');
  const handleBox = (i) => t('text-handle-' + i).boundingBox();
  await step('Text tool (T): the board\'s list: tool chip, hint, the top bar (Height, Font, Angle, Align, Bold, Layer), the command line', async () => {
    await closeTabs(/./);
    assert.equal(await page.locator('[data-tool=text]').getAttribute('aria-disabled'), null, 'built');
    assert.equal(await page.locator('[data-tool=text]').getAttribute('title'), 'Text (T)');
    assert.equal(await t('text-hint').isVisible(), false);
    await page.locator('[data-tool=text]').click();
    assert.equal(await t('tool-chip').textContent(), 'Tool: Text');
    assert.equal(await t('text-hint').textContent(), 'Text tool (T): click to place · type · drag a corner to change the height');
    assert.equal(await t('textbar').isVisible(), true);
    assert.equal(await t('selbar').isVisible(), false, 'the text bar takes the place of the selection bar');
    assert.equal(await t('textbar').locator('strong').textContent(), 'Text');
    assert.equal(await t('text-kind').textContent(), 'new text');
    assert.deepEqual(await t('textbar').locator('label').evaluateAll((ls) => ls.map((l) => l.childNodes[0].textContent.trim())), ['Height', 'Font', 'Angle']);
    assert.deepEqual(await t('text-font').locator('option').allTextContents(), ['Standard', 'Arial-like', 'Mono']);
    assert.equal(await t('text-angle').inputValue(), '0.00°');
    assert.deepEqual(await t('textbar').locator('.ib').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label'))), ['Align left', 'Align centre', 'Align right', 'Bold']);
    assert.deepEqual(await t('textbar').locator('.ib').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-pressed'))), ['true', 'false', 'false', 'false']);
    assert.equal(await t('text-layer').textContent(), 'Layer: 0');
    assert.equal(await t('cmd-hist').textContent(), 'Command: TEXT   Height 10.00 · Standard · Left · layer 0');
    assert.equal(await prompt(), 'Specify insertion point or [Height / Justify / Style]:');
    await page.evaluate(() => localStorage.removeItem('pd-text'));
  });

  await step('Text: click to place, type in place, Enter commits one line as TEXT on the current layer; Height from the bar; one undo step "Text"', async () => {
    await t('text-height').fill('12'); await t('text-height').press('Enter');
    assert.equal(await t('cmd-hist').textContent(), 'Command: TEXT   Height 12.00 · Standard · Left · layer 0');
    await click(30, 100);
    await t('text-editor').waitFor();
    assert.equal(await t('text-editor-hint').textContent(), 'Typing in placeEnter = done · Shift+Enter = new line');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.testid), 'text-editor', 'the box has the keyboard');
    assert.equal(await prompt(), 'Type the text. Enter ends, Shift+Enter starts a new line:');
    await page.keyboard.type('PLATE 04 - REV C');
    assert.equal(await entCount(), 0, 'nothing is in the drawing until it is committed');
    await page.keyboard.press('Enter');
    assert.equal(await t('text-edit-box').isVisible(), false);
    assert.equal(await entCount(), 1);
    assert.equal(await t('text-kind').textContent(), 'selected · 1 line');
    assert.equal(await t('text-tag').textContent(), 'TEXT · layer 0');
    assert.equal(await t('text-height').inputValue(), '12.00');
    assert.equal(await t('text-box').count(), 1);
    assert.equal(await page.locator('[data-testid^=text-handle-]').count(), 4, 'four corner handles');
    assert.deepEqual(await histLabels(), ['Start', 'Text']);
    const doc = await savedDoc(), e = doc.entities[0];
    assert.equal(e.type, 'TEXT'); assert.equal(e.layer, '0');
    assert.equal(e.r.v[e.r.c.indexOf(1)], 'PLATE 04 - REV C');
    assert.equal(fieldOf(e, 40), 12); assert.ok(Math.abs(fieldOf(e, 10) - 30) < 0.5 && Math.abs(fieldOf(e, 20) - 100) < 0.5, 'where it was clicked');
    assert.equal(e.r.v[e.r.c.indexOf(7)], 'Standard');
  });

  await step('Text: Shift+Enter makes a new line (two lines save as MTEXT); clicking away commits; Esc is done too; empty text makes nothing', async () => {
    await click(30, 60);
    await t('text-editor').waitFor();
    await page.keyboard.type('MATERIAL: ACRYLIC 3 MM');
    await page.keyboard.press('Shift+Enter');
    assert.equal(await t('text-edit-box').isVisible(), true, 'Shift+Enter did not end it');
    await page.keyboard.type('FINISH: GLOSS');
    assert.equal(await t('text-editor').inputValue(), 'MATERIAL: ACRYLIC 3 MM\nFINISH: GLOSS');
    await click(170, 20);                                      // click away: commits (and only that)
    assert.equal(await t('text-edit-box').isVisible(), false);
    assert.equal(await entCount(), 2);
    assert.equal(await t('text-tag').textContent(), 'MTEXT · layer 0');
    assert.equal(await t('text-kind').textContent(), 'selected · 2 lines');
    // Esc = done
    await click(130, 30);
    await t('text-editor').waitFor();
    await page.keyboard.type('SCALE 1:1'); await page.keyboard.press('Escape');
    assert.equal(await entCount(), 3);
    assert.equal(await t('tool-chip').textContent(), 'Tool: Text', 'Esc ended the typing, not the tool');
    // nothing typed: nothing made
    await click(130, 130);
    await t('text-editor').waitFor();
    await page.keyboard.press('Enter');
    assert.equal(await entCount(), 3);
    assert.match(await t('cmd-hist').textContent(), /nothing typed, so nothing was made/);
    const doc = await savedDoc(), tx = texts(doc);
    assert.deepEqual(tx.map((e) => e.type), ['TEXT', 'MTEXT', 'TEXT']);
    assert.equal(tx[1].r.v[tx[1].r.c.indexOf(1)], 'MATERIAL: ACRYLIC 3 MM\\PFINISH: GLOSS');
    assert.deepEqual((await histLabels()).slice(-2), ['Text', 'Text']);
  });

  await step('Text: the top bar changes the selected text (Height, Font, Angle, Align, Bold): each one labelled undo step; bold saves as MTEXT with a bold font code', async () => {
    await page.locator('[data-tool=select]').click();
    await page.keyboard.press('Escape');
    await click(60, 105);                                      // on "PLATE 04 - REV C"
    assert.equal(await t('textbar').isVisible(), true, 'a selected text brings the text bar');
    assert.equal(await t('text-kind').textContent(), 'selected · 1 line');
    await t('text-height').fill('14'); await t('text-height').press('Enter');
    await t('text-font').selectOption('Mono');
    await t('text-angle').fill('15'); await t('text-angle').press('Enter');
    await t('text-align-centre').click();
    assert.deepEqual(await t('textbar').locator('.ib').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-pressed'))), ['false', 'true', 'false', 'false']);
    let doc = await savedDoc(), e = doc.entities[0];
    assert.equal(e.type, 'TEXT');
    assert.deepEqual([40, 50, 72].map((c) => fieldOf(e, c)), [14, 15, 1]);
    assert.equal(e.r.v[e.r.c.indexOf(7)], 'Mono');
    assert.equal(fieldOf(e, 11), fieldOf(e, 10), 'centre needs the alignment point');
    await t('text-bold').click();
    assert.equal(await t('text-bold').getAttribute('aria-pressed'), 'true');
    await page.waitForFunction(() => document.querySelector('[data-testid=text-tag]').textContent === 'MTEXT · layer 0');
    doc = await savedDoc(); e = doc.entities[0];
    assert.equal(e.type, 'MTEXT');
    assert.match(e.r.v[e.r.c.indexOf(1)], /^\{\\fCourier New\|b1\|i0\|c0\|p34;PLATE 04 - REV C\}$/);
    assert.equal(e.r.v[e.r.c.indexOf(7)], 'Mono');
    assert.deepEqual((await histLabels()).slice(-5), ['Text height', 'Text font', 'Text angle', 'Text align', 'Text bold']);
    await t('text-bold').click();                              // off again: back to a plain TEXT
    doc = await savedDoc();
    assert.equal(doc.entities[0].type, 'TEXT');
    // the same file in the Standard text style names the STYLE table entry
    const dxf = (await downloaded(() => page.keyboard.press('Control+s'))).text;
    assert.match(dxf, /\r\n\s*2\r\nMono\r\n/); assert.match(dxf, /cour\.ttf/);
    // reset it: the next steps start from a Standard, left, upright text
    await t('text-angle').fill('0'); await t('text-angle').press('Enter');
    await t('text-align-left').click(); await t('text-font').selectOption('Standard');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('pd-text'))), { h: 14, font: 'Standard', ha: 0, bold: false }, 'the last values are what the next text gets, remembered on this PC');
  });

  await step('Text: dragging a corner handle scales the height ("Height 14.00 → …"); Esc cancels the drag; one undo step', async () => {
    await page.keyboard.press('Escape');                       // clears the selection
    await click(60, 105);
    const before = (await savedDoc()).entities[0];
    const h0 = fieldOf(before, 40);
    const hb = await handleBox(1);                             // the bottom-right corner
    const x0 = hb.x + hb.width / 2, y0 = hb.y + hb.height / 2;
    await page.mouse.move(x0, y0); await page.mouse.down();
    await page.mouse.move(x0 + 60, y0 + 30, { steps: 4 });
    await page.waitForFunction(() => /^Height /.test(document.querySelector('[data-testid=draw-tip]').textContent));
    const tip = await t('draw-tip').textContent();
    assert.match(tip, /^Height 14\.00 → \d+\.\d\d$/);
    assert.ok(await page.locator('.tx-box.tx-new').count() === 1, 'the scaled box is previewed');
    assert.equal(await page.locator('.tx-handle.hot').count() > 0, true, 'the dragged handle is hot');
    await page.keyboard.press('Escape');                       // cancels
    await page.mouse.up();
    await t('draw-tip').waitFor({ state: 'hidden' });
    assert.equal(fieldOf((await savedDoc()).entities[0], 40), h0, 'cancelled: the height is as it was');
    const hb2 = await handleBox(1), x1 = hb2.x + hb2.width / 2, y1 = hb2.y + hb2.height / 2;
    await page.mouse.move(x1, y1); await page.mouse.down();
    await page.mouse.move(x1 + 60, y1 + 30, { steps: 4 });
    await page.waitForFunction(() => /^Height /.test(document.querySelector('[data-testid=draw-tip]').textContent));
    const grown = Number((await t('draw-tip').textContent()).replace(/^.* → /, ''));
    await page.mouse.up();
    assert.match(await prompt(), /Height 14\.00 → /);
    const e = (await savedDoc()).entities[0];
    assert.ok(grown > h0 && Math.abs(fieldOf(e, 40) - grown) < 0.01, `the height became ${grown}: ${fieldOf(e, 40)}`);
    assert.equal(await t('text-height').inputValue(), grown.toFixed(2));
    assert.equal((await histLabels()).at(-1), 'Text height');
    await page.keyboard.press('Control+z');
    assert.equal(fieldOf((await savedDoc()).entities[0], 40), h0, 'one Ctrl+Z gives the old height back');
  });

  await step('Text: double-click a text (or click it with the Text tool) to change it; Edit text is one undo step; the text reopens as saved', async () => {
    const p = await at(60, 105);
    await page.mouse.dblclick(p.x, p.y);
    await t('text-editor').waitFor();
    assert.equal(await t('text-editor').inputValue(), 'PLATE 04 - REV C');
    await page.keyboard.press('Control+a'); await page.keyboard.type('PLATE 05');
    await page.keyboard.press('Enter');
    assert.equal(await entCount(), 3, 'changed, not added');
    assert.equal((await histLabels()).at(-1), 'Edit text');
    // with the Text tool: click on a text
    await page.locator('[data-tool=text]').click();
    await click(40, 62);                                       // inside the two-line text
    await t('text-editor').waitFor();
    assert.equal(await t('text-editor').inputValue(), 'MATERIAL: ACRYLIC 3 MM\nFINISH: GLOSS');
    await page.keyboard.press('Escape');                       // unchanged: no undo step
    assert.equal((await histLabels()).at(-1), 'Edit text');
    // the file reopens with the same texts
    const text = (await downloaded(() => page.keyboard.press('Control+s'))).text;
    const back = readDxf(text), tx = texts(back).map((e) => decodeText(e));
    assert.deepEqual(tx.map((m) => m.lines), [['PLATE 05'], ['MATERIAL: ACRYLIC 3 MM', 'FINISH: GLOSS'], ['SCALE 1:1']]);
    await t('picker').setInputFiles({ name: 'texts.dxf', mimeType: 'text/plain', buffer: Buffer.from(text, 'latin1') });
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'texts.dxf');
    assert.equal(await entCount(), 3);
    await page.locator('[data-tool=select]').click();
    await click(40, 62);
    assert.equal(await t('text-kind').textContent(), 'selected · 2 lines', 'a reopened MTEXT is found where it was');
  });

  await step('Text: the command line takes Height, Left / Centre / Right, Style, Bold and x,y; text goes on the current layer', async () => {
    await closeTabs(/./);
    await t('picker').setInputFiles({ name: 'shapes.dxf', mimeType: 'text/plain', buffer: Buffer.from(shapesDoc(), 'latin1') });
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'shapes.dxf');
    await page.locator('.layer', { hasText: 'Open' }).click();
    await page.locator('[data-tool=text]').click();
    await typeCmd('height 8');
    assert.match(await t('cmd-hist').textContent(), /^Command: TEXT   Height 8\.00 · Standard · Left · layer Open/);
    await typeCmd('centre'); await typeCmd('style mono'); await typeCmd('bold');
    assert.match(await t('cmd-hist').textContent(), /^Command: TEXT   Height 8\.00 · Mono · Centre · Bold · layer Open/);
    await typeCmd('350,150');
    await t('text-editor').waitFor();
    await page.keyboard.type('Ink: two coats'); await page.keyboard.press('Enter');
    const doc = await savedDoc(), e = doc.entities.at(-1);
    assert.equal(e.layer, 'Open'); assert.equal(e.type, 'MTEXT');
    assert.deepEqual([10, 20].map((c) => fieldOf(e, c).toFixed(1)), ['350.0', '158.0'], 'the block hangs from its top: a height over the baseline at y 150');
    assert.equal(fieldOf(e, 71), 2, 'centre');
    await typeCmd('height x');
    assert.match(await t('cmd-hist').textContent(), /Height must be a number above 0/);
    await page.locator('[data-tool=select]').click();
    await page.evaluate(() => localStorage.removeItem('pd-text'));
  });

  await step('Text: screenshots, light and dark (selected text with its box, handles and tag; typing in place; a corner being dragged)', async () => {
    await closeTabs(/./);
    await page.evaluate(() => localStorage.removeItem('pd-text'));
    await page.reload(); await page.waitForSelector('[data-testid=count]', { state: 'attached' });
    await page.locator('[data-tool=circle]').click(); await typeCmd('150,50'); await typeCmd('22');
    await page.locator('[data-tool=rect]').click(); await typeCmd('20,20'); await typeCmd('120,90');
    await page.locator('[data-tool=text]').click();
    await t('text-height').fill('10'); await t('text-height').press('Enter');
    await click(28, 75); await t('text-editor').waitFor();
    await page.keyboard.type('PLATE 04 - REV C'); await page.keyboard.press('Enter');
    await t('text-font').selectOption('Mono');
    await click(28, 50); await t('text-editor').waitFor();
    await page.keyboard.type('MATERIAL: ACRYLIC 3 MM'); await page.keyboard.press('Shift+Enter'); await page.keyboard.type('FINISH: GLOSS'); await page.keyboard.press('Enter');
    await page.locator('[data-tool=select]').click();
    await page.keyboard.press('Escape');
    await click(40, 77);
    assert.equal(await t('text-kind').textContent(), 'selected · 1 line');
    await shotBoth('text-selected', async () => { await wait(150); }, async () => {});
    // typing in place
    await page.locator('[data-tool=text]').click();
    await page.keyboard.press('Escape');
    await shotBoth('text-typing', async () => { await click(110, 120); await t('text-editor').waitFor(); await page.keyboard.type('Ink: two coats'); await wait(150); },
      async () => { await page.keyboard.press('Control+a'); await page.keyboard.press('Delete'); await page.keyboard.press('Escape'); });
    // a corner being dragged
    await page.keyboard.press('Escape');
    await page.locator('[data-tool=select]').click();
    await click(40, 77);
    await shotBoth('text-drag', async () => {
      const g = await handleBox(1), gx = g.x + g.width / 2, gy = g.y + g.height / 2;
      await page.mouse.move(gx, gy); await page.mouse.down(); await page.mouse.move(gx + 70, gy + 40, { steps: 4 }); await wait(150);
    }, async () => { await page.keyboard.press('Escape'); await page.mouse.up(); });
    // the 1024 px window: the bar fits on one line
    await page.setViewportSize({ width: 1024, height: 700 }); await wait(200);
    const fits = await t('textbar').evaluate((el) => { const r = el.getBoundingClientRect(); return [...el.children].filter((c) => c.offsetParent !== null).every((c) => c.getBoundingClientRect().right <= r.right - 4 && c.getBoundingClientRect().top >= r.top - 1 && c.getBoundingClientRect().bottom <= r.bottom + 1) && r.right - [...el.children].filter((c) => c.offsetParent !== null).at(-1).getBoundingClientRect().right > 40; });
    await page.screenshot({ path: shotDir + '/s13-text-1024-light.png' });
    await page.setViewportSize({ width: 1440, height: 900 });
    assert.equal(fits, true, 'the text bar fits on one line at 1024 px, with room to spare for wider fonts');
    await closeTabs(/./);
  });

  // ---- TODO 22: grips (grips.js; mock-up R5c, left pane) ----
  const gripsDoc = () => {
    const doc = newDoc(4);
    addEntities(doc, dxfLine(20, 30, 120, 30), dxfCircle(170, 100, 20), dxfArc(60, 100, 30, 0, 180), dxfPoly([[140, 30], [200, 30], [200, 60], [150, 70]]));
    return writeDxf(doc);
  };
  const openGrips = async (text = gripsDoc(), name = 'grips.dxf') => {
    await closeTabs(/./);
    await t('picker').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text, 'latin1') });
    await page.waitForFunction((n) => document.querySelector('.tabs .dtab.on .tname').textContent === n, name);
    await page.waitForFunction(() => document.querySelector('[data-testid=gap-count]') && document.querySelector('[data-testid=gap-count]').textContent !== '…');
    await page.locator('[data-tool=select]').click();
  };
  const gripCount = () => page.locator('[data-testid=grip], [data-testid=grip-hot]').count();
  const gripWhen = async (n) => { await page.waitForFunction((k) => document.querySelectorAll('[data-testid=grip], [data-testid=grip-hot]').length === k, n, { timeout: 8000 }).catch(async () => { throw new Error(`waiting for ${n} grips, there are ${await gripCount()}; prompt: ${await prompt()}; hist: ${await t("cmd-hist").textContent()}`); }); };
  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));       // the overlay repaints on the next frame
  const gripBox = async (id) => {
    await frames();
    const p = await page.evaluate((g) => { const el = document.querySelector(`[data-grip="${g}"]`); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id);
    if (!p) throw new Error('no grip ' + id + '; grips: ' + (await page.locator('[data-testid=grip]').evaluateAll((g) => g.map((x) => x.dataset.grip).join())));
    return p;
  };
  const dragGripTo = async (id, mmx, mmy, opts = {}) => {
    const a = await gripBox(id), b = await at(mmx, mmy);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 3 });
    await page.mouse.move(b.x, b.y, { steps: 3 });
    if (!opts.hold) await page.mouse.up();
  };
  const pick = async (x, y, n) => { await page.keyboard.press('Escape'); await click(x, y); await frames(); await gripWhen(n); };       // select the one shape at x, y (n grips)
  const undoAndPick = async (x, y, n) => { await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.keyboard.press('Control+z'); await pick(x, y, n); };       // (not from inside the command line, where Ctrl+Z is the field's own)
  const entOf = (doc, i) => doc.entities[i];
  const near = (a, b, e) => Math.abs(a - b) < e;
  await step('command messages: an error sits above the visible hint with a selection and grips on', async () => {
    await openGrips();
    await click(70, 30); await gripWhen(3);
    await typeCmd('unknowncommand');
    await t('cmd-fade').locator('.er', { hasText: 'Unknown command: unknowncommand' }).waitFor();
    const viewport = page.viewportSize();
    try {
      for (const size of [viewport, { width: 1280, height: 720 }]) {
        await page.setViewportSize(size);
        await t('cmd-fade').waitFor({ state: 'visible' });
        await t('grip-hint').waitFor({ state: 'visible' });
        const messages = await t('cmd-fade').boundingBox(), hint = await t('grip-hint').boundingBox();
        assert.ok(messages && hint && messages.y + messages.height <= hint.y + 1,
          `command messages sit above the grip hint without overlapping at ${size.width}x${size.height}: ${JSON.stringify({ messages, hint })}`);
      }
    } finally { await page.setViewportSize(viewport); }
  });

  await step('Grips: a selected line, circle, arc and polyline show blue squares (line 3, circle 5, arc 4, polyline per vertex); none with nothing selected, with a drawing tool, or past 200 selected', async () => {
    await openGrips();
    assert.equal(await gripCount(), 0, 'nothing selected: no grips');
    assert.equal(await t('grip-hint').isVisible(), false);
    await click(70, 30); await gripWhen(3);
    assert.deepEqual(await page.locator('[data-testid=grip]').evaluateAll((g) => g.map((x) => x.dataset.grip)), ['0:a', '0:m', '0:b']);
    assert.equal(await t('grip-hint').isVisible(), true);
    assert.equal(await t('grip-hint').textContent(), 'Grips: drag, or click one then click the new place · type x,y · Shift = straight · Esc cancels');
    await pick(190, 100, 5);
    await pick(60, 130, 4);
    assert.equal(await page.locator('.gr-spoke').count(), 1, 'an arc: dashed spokes from the centre to its ends');
    await pick(170, 30, 4);
    await pick(70, 30, 3); await click(190, 100, { shift: true }); await click(60, 130, { shift: true }); await click(170, 30, { shift: true });
    await gripWhen(3 + 5 + 4 + 4);
    const sq = await page.locator('[data-testid=grip]').first().evaluate((el) => Math.round(el.getBoundingClientRect().width));
    assert.equal(sq, 10, 'the board\'s 10 px squares');
    await page.locator('[data-tool=line]').click();
    await gripWhen(0);                                         // a drawing tool is on: no grips
    await page.keyboard.press('Escape');                       // back to Select, the selection stays
    await gripWhen(3 + 5 + 4 + 4);
    await page.keyboard.press('Escape'); await gripWhen(0);
  });

  await step('Grips: dragging a line\'s end stretches it (rubber band, length and angle readout, the hot grip red, a ghost of what it was); it snaps; one undo step "Stretch line"', async () => {
    await pick(70, 30, 3);
    const a = await gripBox('0:b'), b = await at(150, 60);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.waitForFunction(() => /^[\d.]+ mm · [\d.]+°$/.test(document.querySelector('[data-testid=draw-tip]').textContent));
    assert.match(await t('draw-tip').textContent(), /^\d+\.\d\d mm · \d+\.\d\d°$/);
    assert.equal(await page.locator('[data-testid=grip-hot]').count(), 1, 'the dragged grip is hot');
    assert.equal(await page.locator('.gr-ghost').count(), 1, 'a dashed ghost of what it was');
    assert.equal(await t('grip-preview').count(), 1, 'the new line, dashed');
    assert.match(await t('cmd-hist').textContent(), /^Command: STRETCH   Dragging a grip/);
    assert.match(await prompt(), /^Specify the new point/);
    assert.equal(await page.locator('[data-testid=grip]').count(), 2, 'its other two grips stay blue');
    await page.keyboard.press('Escape');                       // cancels the drag
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=grip-preview]').length === 0);
    assert.equal(fieldOf(entOf(await savedDoc(), 0), 11), 120, 'cancelled: as it was');
    await pick(70, 30, 3);
    // again, onto the circle's centre (170, 100): a snap, so to the digit
    const a2 = await gripBox('0:b'), c = await at(170.3, 99.8);
    await page.mouse.move(a2.x, a2.y); await page.mouse.down(); await page.mouse.move(c.x, c.y, { steps: 5 }); await page.mouse.up();
    assert.match(await prompt(), /^Stretch line: 1\d\d\.\d\d mm · \d+\.\d\d°\. Ctrl\+Z takes it back:?$/);
    const doc = await savedDoc(), e = entOf(doc, 0);
    assert.deepEqual([10, 20, 11, 21].map((k) => fieldOf(e, k)), [20, 30, 170, 100], 'the end snapped to the circle\'s centre');
    assert.equal(doc.entities.length, 4);
    assert.equal((await histLabels()).at(-1), 'Stretch line');
    await gripWhen(3);
    await page.keyboard.press('Control+z');
    assert.equal(fieldOf(entOf(await savedDoc(), 0), 11), 120, 'one Ctrl+Z puts it back');
  });

  await step('Grips: the middle grip moves the line ("Move ΔX … ΔY …"); ORTHO keeps it straight; the line keeps its length', async () => {
    await pick(70, 30, 3);
    await dragGripTo('0:m', 90, 60, { hold: true });
    await page.waitForFunction(() => /^Move ΔX /.test(document.querySelector('[data-testid=draw-tip]').textContent));
    assert.match(await t('draw-tip').textContent(), /^Move ΔX (19|20)\.\d\d ΔY (29|30)\.\d\d$/);
    await page.mouse.up();
    let e = entOf(await savedDoc(), 0);
    assert.ok(near(fieldOf(e, 11) - fieldOf(e, 10), 100, 1e-6), 'moved whole: still 100 long');
    assert.ok(near(fieldOf(e, 10), 40, 0.6) && near(fieldOf(e, 20), 60, 0.6), 'by about (20, 30)');
    assert.equal((await histLabels()).at(-1), 'Move line');
    await undoAndPick(70, 30, 3);
    await t('tog-ortho').click();
    await dragGripTo('0:m', 110, 40);
    e = entOf(await savedDoc(), 0);
    assert.equal(fieldOf(e, 20), 30, 'ORTHO: straight along X'); assert.equal(fieldOf(e, 21), 30);
    assert.ok(near(fieldOf(e, 10), 60, 0.6));
    await page.keyboard.press('Control+z');
    await t('tog-ortho').click();
  });

  await step('Grips: with ORTHO a line\'s end dragged onto the line\'s own old place still ends straight (Nearest leaves the dragged shape out)', async () => {
    await pick(70, 30, 3);
    await dragGripTo('0:b', 120, 45);                          // slants it: (20, 30) to (120, 45)
    await t('tog-ortho').click();
    await dragGripTo('0:b', 70, 37.5);                         // on the slanted line itself
    const e = entOf(await savedDoc(), 0);
    assert.equal(fieldOf(e, 21), 30, 'straight along X, not back on the old slant'); assert.ok(near(fieldOf(e, 11), 70, 0.6));
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    await t('tog-ortho').click();
  });

  await step('Grips: a circle\'s quadrant sets its radius, its centre moves it; an arc\'s middle changes the bulge (3 points), its ends re-fit it, its centre moves it; a polyline vertex moves', async () => {
    await pick(190, 100, 5);
    await dragGripTo('1:q0', 200, 100);
    let doc = await savedDoc(), c = entOf(doc, 1);
    assert.ok(near(fieldOf(c, 40), 30, 0.4), `the radius is 30: ${fieldOf(c, 40)}`); assert.deepEqual([fieldOf(c, 10), fieldOf(c, 20)], [170, 100]);
    assert.equal((await histLabels()).at(-1), 'Circle radius');
    await gripWhen(5);
    await dragGripTo('1:c', 150, 50);
    doc = await savedDoc(); c = entOf(doc, 1);
    assert.ok(near(fieldOf(c, 10), 150, 0.6) && near(fieldOf(c, 20), 50, 0.6), `the centre moved to (150, 50): ${fieldOf(c, 10)}, ${fieldOf(c, 20)}`);
    assert.equal((await histLabels()).at(-1), 'Move circle');
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    // the arc: ends (90,100) and (30,100), middle (60,130), centre (60,100)
    await pick(60, 130, 4);
    await dragGripTo('2:m', 60, 150);
    doc = await savedDoc();
    let g = GR.gripsOf(entOf(doc, 2));
    assert.ok(near(g[0].x, 90, 1e-5) && near(g[0].y, 100, 1e-5) && near(g[2].x, 30, 1e-5) && near(g[2].y, 100, 1e-5), 'the ends stay where they were');
    assert.ok(near(g[1].x, 60, 0.3) && near(g[1].y, 150, 0.3), 'its middle is where it was dragged');
    assert.equal((await histLabels()).at(-1), 'Arc bulge');
    await undoAndPick(60, 130, 4);
    await dragGripTo('2:b', 20, 90);                           // the end (30,100) moved: it still passes through the old middle
    doc = await savedDoc(); g = GR.gripsOf(entOf(doc, 2));
    assert.ok(g.some((x) => near(x.x, 90, 1e-5) && near(x.y, 100, 1e-5)), 'the other end stays');
    const old = entOf(doc, 2), c2 = [fieldOf(old, 10), fieldOf(old, 20)], R = fieldOf(old, 40);
    assert.ok(near(Math.hypot(60 - c2[0], 130 - c2[1]), R, 1e-5), 'the old middle is still on the arc');
    assert.equal((await histLabels()).at(-1), 'Stretch arc');
    await undoAndPick(60, 130, 4);
    await dragGripTo('2:c', 80, 90);
    doc = await savedDoc();
    assert.ok(near(fieldOf(entOf(doc, 2), 10), 80, 0.6) && fieldOf(entOf(doc, 2), 40) === 30, `moved, same size: ${fieldOf(entOf(doc, 2), 10)}, ${fieldOf(entOf(doc, 2), 20)}, r ${fieldOf(entOf(doc, 2), 40)}`);
    assert.equal((await histLabels()).at(-1), 'Move arc');
    await page.keyboard.press('Control+z');
    // the polyline
    await pick(170, 30, 4);
    await dragGripTo('3:v2', 205, 80);
    doc = await savedDoc();
    const pl = GR.gripsOf(entOf(doc, 3));
    assert.equal(pl.length, 4); assert.ok(near(pl[2].x, 205, 0.6) && near(pl[2].y, 80, 0.6)); assert.deepEqual([pl[0].x, pl[0].y, pl[3].x, pl[3].y], [140, 30, 150, 70]);
    assert.equal((await histLabels()).at(-1), 'Stretch polyline');
    await page.keyboard.press('Control+z');
  });

  await step('Grips: click a grip, then click the new place; typed x,y, @dx,dy or a length work on a hot grip; Esc cancels', async () => {
    await pick(70, 30, 3);
    const a = await gripBox('0:b'), p = await at(130, 70);
    await page.mouse.click(a.x, a.y);                          // a click: the grip is hot
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=grip-hot]').length === 1);
    assert.match(await t('cmd-hist').textContent(), /Hot grip: click the new place/);
    await page.mouse.move(p.x, p.y);
    await t('grip-preview').waitFor({ state: 'attached' });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=grip-hot]').length === 0);
    assert.equal(fieldOf(entOf(await savedDoc(), 0), 11), 120, 'cancelled');
    await page.mouse.click(a.x, a.y);                          // click, move, click
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=grip-hot]').length === 1);
    await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y);
    let e = entOf(await savedDoc(), 0);
    assert.ok(near(fieldOf(e, 11), 130, 0.6) && near(fieldOf(e, 21), 70, 0.6));
    assert.equal((await histLabels()).at(-1), 'Stretch line');
    // typed coordinates on a hot grip: absolute, relative to where the grip was, and a length the way the rubber band points
    await undoAndPick(70, 30, 3);
    await page.mouse.click(a.x, a.y);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=grip-hot]').length === 1);
    await typeCmd('150,60');
    e = entOf(await savedDoc(), 0);
    assert.deepEqual([10, 20, 11, 21].map((k) => fieldOf(e, k)), [20, 30, 150, 60], 'x,y');
    await undoAndPick(70, 30, 3);
    await page.mouse.click(a.x, a.y);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=grip-hot]').length === 1);
    await typeCmd('@10,25');
    e = entOf(await savedDoc(), 0);
    assert.deepEqual([11, 21].map((k) => fieldOf(e, k)), [130, 55], '@dx,dy from where the grip was');
    await undoAndPick(70, 30, 3);
    await page.mouse.click(a.x, a.y);
    const up = await at(20, 90); await page.mouse.move(up.x, up.y);          // the pointer straight above the other end (20, 30)
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=grip-preview]').length === 1);
    await t('tog-ortho').click(); await page.mouse.move(up.x + 1, up.y + 1); await t('tog-ortho').click();
    await typeCmd('40');
    e = entOf(await savedDoc(), 0);
    assert.ok(near(Math.hypot(fieldOf(e, 11) - 20, fieldOf(e, 21) - 30), 40, 1e-6), 'a length: 40 long, the way the pointer points');
    // a typed point while dragging with the button held
    await undoAndPick(70, 30, 3);
    await dragGripTo('0:b', 130, 80, { hold: true });
    await page.keyboard.type('90,70');
    await page.keyboard.press('Enter');
    assert.equal(await cmdLine().inputValue(), '');
    await page.mouse.up();
    e = entOf(await savedDoc(), 0);
    assert.deepEqual([11, 21].map((k) => fieldOf(e, k)), [90, 70], 'typed while dragging');
    await page.keyboard.press('Control+z');
    assert.equal(await page.locator('[data-testid=grip-hot]').count(), 0);
    await typeCmd('');
  });

  await step('Grips: off past 200 selected shapes (and on for fewer)', async () => {
    const doc = newDoc(4);
    addEntities(doc, Array.from({ length: 205 }, (_, i) => dxfLine(10 + (i % 41) * 4, 20 + Math.floor(i / 41) * 20, 12 + (i % 41) * 4, 26 + Math.floor(i / 41) * 20)));
    await openGrips(writeDxf(doc), 'many.dxf');
    const a = await at(0, 0), b = await at(200, 130);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();    // a box round everything
    await page.waitForFunction(() => document.querySelector('[data-testid=sel-count]').textContent.trim() === '205 selected');
    assert.equal(await gripCount(), 0, '205 selected: no grips');
    assert.equal(await t('grip-hint').isVisible(), false);
    await page.keyboard.press('Escape');
    const c = await at(0, 0), d = await at(100, 130);                     // fewer than 200 shapes, but more than 200 grips
    await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(d.x, d.y, { steps: 4 }); await page.mouse.up();
    const n = Number((await t('sel-count').textContent()).replace(/\D+/g, ''));
    assert.ok(n <= GR.MAX_SELECTED && 3 * n > GR.MAX_SELECTED, 'a part of them: ' + n);
    await gripWhen(3 * n);
  });

  await step('Grips: screenshots, light and dark (blue squares on each kind; a grip being dragged: hot, ghost, rubber band, readout)', async () => {
    await openGrips();
    await click(70, 30); await click(190, 100, { shift: true }); await click(60, 130, { shift: true }); await click(170, 30, { shift: true });
    await gripWhen(16);
    await shotBoth('grips', async () => { await wait(150); }, async () => {});
    await page.keyboard.press('Escape');
    await click(70, 30); await gripWhen(3);
    await shotBoth('grips-drag', async () => {
      const a = await gripBox('0:b'), b = await at(150, 80);
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 });
      await page.waitForFunction(() => /mm · /.test(document.querySelector('[data-testid=draw-tip]').textContent)); await wait(150);
    }, async () => { await page.keyboard.press('Escape'); await page.mouse.up(); });
    await page.keyboard.press('Escape');
    await click(60, 130); await gripWhen(4);
    await shotBoth('grips-arc', async () => {
      const a = await gripBox('2:m'), b = await at(60, 155);
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 });
      await page.waitForFunction(() => /^R /.test(document.querySelector('[data-testid=draw-tip]').textContent)); await wait(150);
    }, async () => { await page.keyboard.press('Escape'); await page.mouse.up(); });
    await closeTabs(/./);
  });

  // ---- TODO 24 / 25: Properties, Select similar, Match properties (props.js; mock-up R5b, Option B) ----
  const propsDoc = () => {
    const doc = newDoc(4);
    addLayer(doc, 'Cutting', { aci: 1 }); addLayer(doc, 'Marks', { aci: 5 });
    addEntities(doc, dxfLine(20, 30, 120, 30, { layer: 'Cutting' }), dxfLine(20, 60, 120, 60, { layer: 'Cutting', aci: 5 }), dxfCircle(170, 100, 20, { layer: 'Marks' }),
      dxfArc(60, 100, 30, 0, 180, { layer: 'Cutting', lt: 'DASHED' }), dxfPoly([[140, 30], [200, 30], [200, 60], [150, 70]], { layer: 'Marks' }), dxfText(20, 150, 6, 'Label', { layer: 'Marks' }));
    return writeDxf(doc);
  };
  const propsOpen = async () => { await openGrips(propsDoc(), 'props.dxf'); };
  const propVal = (key) => page.locator(`[data-prop=${key}]`).inputValue();
  const propsOnNow = async () => { if (!(await t('props-panel').isVisible())) await page.keyboard.press('Control+1'); await t('props-panel').waitFor(); };
  await step('Properties: View → Properties (Ctrl+1) toggles a section at the top of the Drawing panel (not a tab); it asks for a selection; the choice is remembered', async () => {
    await propsOpen();
    assert.equal(await t('props-panel').isVisible(), false, 'off until switched on');
    await page.locator('[data-menu=View]').click();
    const items = await page.locator('.dropdown button').evaluateAll((bs) => bs.map((b) => [b.firstChild.textContent, b.querySelector('.hint') && b.querySelector('.hint').textContent]));
    assert.deepEqual(items[1], ['  Properties', 'Ctrl+1']);
    await page.getByRole('menuitem', { name: /Properties/ }).click();
    await t('props-panel').waitFor();
    assert.equal(await t('prop-empty').isVisible(), true);
    assert.match(await t('prop-empty').textContent(), /Select something/);
    assert.deepEqual(await page.locator('.panelsw .seg').allTextContents(), ['Drawing', 'Parts library'], 'not a third panel tab');
    const tops = await page.evaluate(() => ['props-panel', 'drawing-panel'].map((id) => document.querySelector(`[data-testid=${id}]`).getBoundingClientRect().top));
    assert.ok(tops[0] < tops[1], 'Properties sits above the Drawing scale section');
    await page.locator('[data-menu=View]').click();
    assert.equal(await page.locator('.dropdown button').nth(1).evaluate((b) => b.firstChild.textContent), '✓ Properties');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+1'); await t('props-panel').waitFor({ state: 'hidden' });
    await page.keyboard.press('Control+1'); await t('props-panel').waitFor();
    await page.reload(); await page.waitForSelector('[data-testid=count]', { state: 'attached' });
    await propsOpen();
    assert.equal(await t('props-panel').isVisible(), true, 'remembered on this PC');
  });

  await step('Properties: a line shows its layer, colour, line type and length; the ends are read only; a new length is one labelled undo step', async () => {
    await propsOpen(); await propsOnNow();
    await click(70, 30); await frames();
    assert.equal(await t('prop-chip').textContent(), 'Line');
    assert.equal(await t('prop-layer').inputValue(), 'Cutting');
    assert.equal(await t('prop-colour').inputValue(), 'bylayer');
    assert.equal(await t('prop-lt').inputValue(), 'BYLAYER');
    assert.equal(await propVal('length'), '100.00');
    assert.equal(await propVal('angle'), '0.00');
    assert.deepEqual(await Promise.all(['startX', 'startY', 'endX', 'endY'].map((k) => propVal(k))), ['20.00', '30.00', '120.00', '30.00']);
    assert.equal(await page.locator('[data-prop=startX]').isDisabled(), true);
    assert.equal(await page.locator('[data-prop=length]').isDisabled(), false);
    await page.locator('[data-prop=length]').fill('150'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-prop=endX]').value === '170.00');
    const e = entOf(await savedDoc(), 0);
    assert.deepEqual([10, 20, 11, 21].map((k) => fieldOf(e, k)), [20, 30, 170, 30], 'the end moved along the line');
    assert.equal((await histLabels()).at(-1), 'Length → 150.00');
    await page.keyboard.press('Control+z');
    assert.equal(fieldOf(entOf(await savedDoc(), 0), 11), 120);
    await click(70, 30); await frames();
    await page.locator('[data-prop=length]').fill('abc'); await page.keyboard.press('Enter');
    assert.match(await prompt(), /Length: type a number/);
    assert.equal(await propVal('length'), '100.00', 'the field shows the line again');
  });

  await step('Properties: layer, colour and line type are changed from the section, one undo step each; the drawing and the Layers panel follow', async () => {
    await propsOpen(); await propsOnNow();
    await click(70, 30); await frames();
    await t('prop-layer').selectOption('Marks');
    await page.waitForFunction(() => document.querySelector('[data-testid=prop-layer]').value === 'Marks');
    assert.equal(await t('sel-layer').textContent(), 'layer Marks');
    await t('prop-colour').selectOption('aci:1');
    await t('prop-lt').selectOption('DASHED');
    await page.waitForFunction(() => document.querySelector('[data-testid=prop-lt]').value === 'DASHED');
    const e = entOf(await savedDoc(), 0);
    assert.equal(e.layer, 'Marks'); assert.equal(e.aci, 1); assert.equal(e.lt, 'DASHED');
    assert.deepEqual((await histLabels()).slice(-3), ['Layer → Marks', 'Colour → Red', 'Line type → DASHED']);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    assert.equal(entOf(await savedDoc(), 0).layer, 'Cutting');
  });

  await step('Properties: a circle (radius, diameter, centre), an arc (radius, length keeps the radius and changes the sweep, centre) and a text (height)', async () => {
    await propsOpen(); await propsOnNow();
    await click(190, 100); await frames();
    assert.equal(await t('prop-chip').textContent(), 'Circle');
    assert.deepEqual(await Promise.all(['radius', 'diameter', 'centreX', 'centreY'].map((k) => propVal(k))), ['20.00', '40.00', '170.00', '100.00']);
    await page.locator('[data-prop=diameter]').fill('60'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-prop=radius]').value === '30.00');
    await page.locator('[data-prop=centreX]').fill('180'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-prop=centreX]').value === '180.00');
    const c = entOf(await savedDoc(), 2);
    assert.deepEqual([10, 20, 40].map((k) => fieldOf(c, k)), [180, 100, 30]);
    await page.keyboard.press('Escape'); await click(60, 130); await frames();
    assert.equal(await t('prop-chip').textContent(), 'Arc');
    assert.equal(await t('prop-lt').inputValue(), 'DASHED');
    assert.equal(await propVal('radius'), '30.00'); assert.equal(await propVal('sweep'), '180.00');
    assert.equal(await propVal('length'), (30 * Math.PI).toFixed(2));
    await page.locator('[data-prop=length]').fill(String(15 * Math.PI)); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-prop=sweep]').value === '90.00');
    assert.equal(await propVal('radius'), '30.00', 'the radius stays');
    const a = entOf(await savedDoc(), 3);
    assert.deepEqual([40, 50, 51].map((k) => Math.round(fieldOf(a, k) * 1000) / 1000), [30, 0, 90]);
    await page.locator('[data-prop=length]').fill('500'); await page.keyboard.press('Enter');
    assert.match(await prompt(), /cannot be longer than its full circle/);
    await page.keyboard.press('Escape'); await click(40, 150); await frames();
    assert.equal(await t('prop-chip').textContent(), 'Text');
    assert.equal(await propVal('textH'), '6.00');
    await page.locator('[data-prop=textH]').fill('10'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-prop=textH]').value === '10.00');
    const tx = decodeText(entOf(await savedDoc(), 5));
    assert.equal(tx.h, 10); assert.equal(tx.lines[0], 'Label');
    await page.keyboard.press('Escape'); await click(170, 30); await frames();
    assert.equal(await t('prop-chip').textContent(), 'Polyline');
    assert.equal(await page.locator('[data-prop=length]').isDisabled(), true, 'a polyline length is read only');
  });

  await step('Properties: several shapes show "*varies*" where they differ; typing sets all of them', async () => {
    await propsOpen(); await propsOnNow();
    await click(70, 30); await click(70, 60, { shift: true }); await frames();
    assert.equal(await t('prop-chip').textContent(), 'Line × 2');
    assert.equal(await t('prop-layer').inputValue(), 'Cutting');
    assert.equal(await t('prop-colour').inputValue(), '', 'the colours differ');
    assert.equal(await t('prop-colour').evaluate((s) => s.selectedOptions[0].textContent), '*varies*');
    await click(190, 100, { shift: true }); await frames();
    assert.equal(await t('prop-chip').textContent(), '3 shapes');
    assert.equal(await t('prop-layer').evaluate((s) => s.selectedOptions[0].textContent), '*varies*');
    assert.equal(await page.locator('[data-prop]').count(), 0, 'mixed kinds share no geometry');
    await t('prop-layer').selectOption('Marks');
    await page.waitForFunction(() => document.querySelector('[data-testid=prop-layer]').value === 'Marks');
    const doc = await savedDoc();
    assert.deepEqual([0, 1, 2].map((i) => entOf(doc, i).layer), ['Marks', 'Marks', 'Marks']);
    assert.equal(doc.entities.length, 6);
    assert.equal((await histLabels()).at(-1), 'Layer → Marks', 'one undo step for all three');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Control+z');
    // two lines of different length: the field varies, then both take the typed value
    await page.keyboard.press('Escape'); await click(70, 30); await click(70, 60, { shift: true });
    await page.locator('[data-prop=length]').fill('60'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-prop=length]').value === '60.00');
    const d2 = await savedDoc();
    assert.deepEqual([0, 1].map((i) => fieldOf(entOf(d2, i), 11)), [80, 80]);
  });

  await step('Select similar: Layer / Colour / Type with the counts; the selection becomes those shapes', async () => {
    await propsOpen(); await propsOnNow();
    await click(70, 30); await frames();
    await t('prop-similar').click();
    const items = await page.locator('[data-testid=ctx-menu] button').allTextContents();
    assert.deepEqual(items, ['Layer (3)', 'Colour (2)', 'Type (2)']);        // Cutting: two lines and the arc; red (the layer's own): the first line and the arc; lines: two
    await page.getByRole('menuitem', { name: 'Layer (3)' }).click();
    await waitSel('3 selected');
    assert.match(await prompt(), /Selected 3 shapes on layer Cutting/);
    await page.keyboard.press('Escape'); await click(70, 30); await frames();
    await t('prop-similar').click(); await page.getByRole('menuitem', { name: 'Type (2)' }).click();
    await waitSel('2 selected');
    assert.equal(await t('prop-chip').textContent(), 'Line × 2');
    assert.deepEqual(await histLabels(), ['Start'], 'selecting is not an undo step');
  });

  await step('Match properties: the first selected shape is the source; each click copies its layer, colour and line type; Esc ends; one undo step each', async () => {
    await propsOpen(); await propsOnNow();
    await click(60, 130); await frames();                       // the dashed arc on Cutting
    await t('prop-match').click();
    assert.equal(await t('match-hint').isVisible(), true);
    assert.equal(await t('match-hint').textContent(), 'Match properties · source: Arc (Cutting, ByLayer, DASHED) · click what should change · Esc ends');
    assert.equal((await t('cmd-hist').textContent()).startsWith('Command: MATCHPROP'), true);
    assert.match(await prompt(), /^Select destination object/);
    await frames();
    assert.equal(await page.locator('[data-testid=grip]').count(), 0, 'no grips while matching');
    await click(190, 100); await frames();                      // the circle on Marks
    await click(170, 30); await frames();                       // the polyline on Marks
    let doc = await savedDoc();
    assert.deepEqual([2, 4].map((i) => [entOf(doc, i).layer, entOf(doc, i).lt]), [['Cutting', 'DASHED'], ['Cutting', 'DASHED']]);
    assert.equal(fieldOf(entOf(doc, 2), 40), 20, 'the geometry is untouched');
    assert.deepEqual((await histLabels()).slice(-2), ['Match properties', 'Match properties']);
    await click(190, 100);
    assert.match(await t('cmd-hist').textContent(), /already has them/);
    await page.keyboard.press('Escape');
    assert.equal(await t('match-hint').isVisible(), false);
    await frames();
    assert.equal(await page.locator('[data-testid=grip]').count() > 0, true, 'the arc is still selected, with its grips');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    doc = await savedDoc();
    assert.equal(entOf(doc, 2).layer, 'Marks');
  });

  await step('Properties: screenshots, light and dark (an arc, a mix, Match properties on); the section fits the panel', async () => {
    await propsOpen(); await propsOnNow();
    await click(60, 130); await frames();
    await shotBoth('props-arc', async () => { await wait(150); }, async () => {});
    await page.keyboard.press('Escape'); await click(70, 30); await click(190, 100, { shift: true }); await frames();
    await shotBoth('props-mixed', async () => { await wait(150); }, async () => {});
    await page.keyboard.press('Escape'); await click(60, 130); await t('prop-match').click(); await frames();
    await shotBoth('props-match', async () => { await wait(150); }, async () => {});
    await page.keyboard.press('Escape');
    const ok = await t('props-panel').evaluate((el) => { const r = el.getBoundingClientRect(); return [...el.querySelectorAll('select, input, button')].filter((c) => c.offsetParent !== null).every((c) => c.getBoundingClientRect().right <= r.right + 0.5 && c.getBoundingClientRect().left >= r.left - 0.5); });
    assert.equal(ok, true, 'nothing sticks out of the section');
    await page.keyboard.press('Control+1'); await closeTabs(/./);
  });

  await step('Outline width: presets, Custom, varies, one undo for the selection, polyline save and light/dark screenshots (TODO 48)', async () => {
    await propsOpen(); await propsOnNow(); await click(70, 30); await frames();
    const preset = (value) => t('prop-width').locator(`[data-width="${value}"]`);
    assert.deepEqual(await t('prop-width').locator('button').allTextContents(), ['ByLayer', 'Hairline', '0.10', '0.25', '0.50', '1.00', '2.00']);
    assert.equal(await preset('ByLayer').getAttribute('aria-pressed'), 'true');
    const bounds = await Promise.all([t('prop-lt').boundingBox(), t('prop-width').boundingBox()]);
    assert.ok(bounds[1].y > bounds[0].y + bounds[0].height, 'below Line type');
    await preset('0.5').click();
    assert.equal((await savedDoc()).entities[0].lw, 50);
    const before = (await histLabels()).length;
    await t('prop-width-custom').fill('0.37'); await t('prop-width-custom').press('Enter');
    assert.equal((await savedDoc()).entities[0].lw, 37);
    await page.keyboard.press('Control+z');
    assert.equal((await savedDoc()).entities[0].lw, 50);
    await click(70, 30); await click(190, 100, { shift: true }); await frames();
    assert.equal(await t('prop-width-custom').getAttribute('placeholder'), '*varies*');
    await preset('2').click();
    let saved = await savedDoc();
    assert.deepEqual([saved.entities[0].lw, saved.entities[2].lw], [200, 200]);
    assert.equal((await histLabels()).length, before + 1, 'one step for both selected objects');
    await page.keyboard.press('Control+z'); saved = await savedDoc();
    assert.deepEqual([saved.entities[0].lw, saved.entities[2].lw], [50, -1]);
    await click(170, 30); await frames();
    await t('prop-width-custom').fill('0.63'); await t('prop-width-custom').press('Enter');
    saved = await savedDoc(); assert.equal(fieldOf(saved.entities[4], 43), .63);
    const history = await histLabels();
    await t('prop-width-custom').fill('-1'); await t('prop-width-custom').press('Enter');
    assert.match(await prompt(), /Outline width: type a positive number/);
    assert.deepEqual(await histLabels(), history, 'invalid input does not create an undo step');
    await t('prop-width-custom').fill('3'); await t('prop-width-custom').press('Escape');
    assert.equal(await t('prop-width-custom').inputValue(), '0.63', 'Escape cancels Custom');
    await preset('Hairline').click(); saved = await savedDoc();
    assert.equal(saved.entities[4].lw, 5); assert.equal(saved.entities[4].r.c.includes(43), false);
    await preset('ByLayer').click(); saved = await savedDoc(); assert.equal(saved.entities[4].lw, -1);
    const plate = newDoc();
    addEntities(plate, roundRect(20, 20, 50, 30, 2), dxfCircle(26, 44, 2, { lw: 5 }), dxfCircle(64, 44, 2, { lw: 5 }), dxfCircle(45, 33, 7, { lw: 5 }), dxfLine(20, 10, 70, 10, { lw: 5 }));
    await openGrips(writeDxf(plate), 'outline-width.dxf'); await click(40, 20); await frames(); await preset('2').click();
    for (const theme of ['light', 'dark']) {
      await menuItem('View', 'Theme: ' + theme); await frames();
      assert.equal(await t('prop-width').evaluate((el) => {
        const r = el.getBoundingClientRect();
        return [...el.querySelectorAll('button, input, .lbl')].every((e) => e.getBoundingClientRect().right <= r.right + .5);
      }), true, 'width controls and units fit the panel');
      await page.screenshot({ path: shotDir + '/s11-48-' + theme + '.png' });
    }
    await menuItem('View', 'Theme: light');
    const dl = await downloaded(() => page.keyboard.press('Control+s'));
    await openGrips(dl.text, 'outline-width-reopened.dxf'); await click(40, 20); await frames();
    assert.equal(await preset('2').getAttribute('aria-pressed'), 'true', 'width returns after reopening');
    await openPdf(); await t('pdf-page-sheet').check();
    const pdf = pdfText(await downloaded(() => t('pdf-go').click()));
    assert.match(pdf, /\n2 w\n/, 'reopened constant width reaches PDF / Print');
    assert.match(pdf, /\n0\.05 w\n/, 'Hairline stays 0.05 mm in the output');
    const inch = newDoc(1); addEntities(inch, dxfLine(1, 1, 3, 1), dxfPoly([[1, 2], [3, 2]]));
    await openGrips(writeDxf(inch), 'outline-inches.dxf'); await click(50.8, 25.4); await frames();
    assert.match(await t('prop-width').textContent(), /Selection · mm/);
    await preset('0.25').click();
    assert.equal((await savedDoc()).entities[0].lw, 25, 'preset uses mm in an inch drawing');
    await t('prop-width-custom').fill('0.1'); await t('prop-width-custom').press('Enter');
    assert.equal((await savedDoc()).entities[0].lw, 10, 'typed Custom uses mm in an inch drawing');
    await t('prop-width-custom').fill('328'); await t('prop-width-custom').press('Enter');
    assert.match(await prompt(), /up to 327\.67 mm/);
    await click(50.8, 50.8); await frames(); await preset('0.25').click();
    assert.equal(await preset('0.25').getAttribute('aria-pressed'), 'true', 'inch polyline preset stays active after conversion');
    const inchSaved = await savedDoc();
    assert.ok(Math.abs(fieldOf(inchSaved.entities[1], 43) - .25 / 25.4) < 1e-6);
    await openGrips(writeDxf(inchSaved), 'outline-inches-reopened.dxf'); await click(50.8, 50.8); await frames();
    assert.equal(await preset('0.25').getAttribute('aria-pressed'), 'true', 'inch preset survives DXF width rounding');
    await t('prop-width-custom').fill('0.37'); await t('prop-width-custom').press('Enter');
    assert.ok(Math.abs(fieldOf((await savedDoc()).entities[1], 43) - .37 / 25.4) < 1e-6);
    await page.keyboard.press('Control+1'); await closeTabs(/./);
  });

  const cleanupDrawing = () => {
    const d = newDoc(); addLayer(d, 'Laser CUT'); addLayer(d, 'Artwork');
    addEntities(d, dxfLine(20, 20, 50, 20, { layer: 'Laser CUT', lw: 5 }),
      dxfLine(20, 20, 50, 20, { layer: 'Laser CUT', lw: 5 }),
      dxfLine(40, 20, 70, 20, { layer: 'Laser CUT', lw: 5 }),
      dxfLine(80, 30, 100, 30, { layer: 'Laser CUT', lw: 5 }),
      dxfLine(100.005, 30, 120, 30, { layer: 'Laser CUT', lw: 5 }),
      dxfCircle(90, 65, 10, { layer: 'Artwork', lw: 50 }),
      dxfText(20, 75, 4, 'JOB 14', { layer: 'Artwork' }), dxfCircle(-10, 10, 2, { lw: 5 }));
    return writeDxf(d);
  };
  await step('Remove duplicates + undo: count redundant entities and trim partial overlaps (TODO 49)', async () => {
    await openGrips(cleanupDrawing(), 'cleanup.dxf');
    assert.equal(await t('duplicate-count').textContent(), 'Check');
    const before = await savedDoc(), labels = await histLabels();
    await t('duplicate-remove').click(); await frames();
    assert.equal(await t('duplicate-count').textContent(), 'Check', 'edits invalidate the count without scanning');
    const cleaned = await savedDoc();
    assert.equal(cleaned.entities.length, before.entities.length - 1);
    assert.equal(fieldOf(cleaned.entities[1], 10), 50, 'partially redundant line starts at 50');
    assert.equal((await histLabels()).length, labels.length + 1, 'one undo step');
    await t('undo').click(); await frames();
    assert.equal(await t('duplicate-count').textContent(), '2 found', 'undo reuses the cached count for the restored entities');
    assert.deepEqual((await savedDoc()).entities, before.entities, 'undo restores every original');
    await t('duplicate-remove').click(); await t('duplicate-remove').click();
    assert.equal(await t('duplicate-count').textContent(), '0 found', 'explicit check updates the count');
  });
  await step('Preflight open, Select, Fix, Recheck and Close, light/dark screenshots (TODO 50)', async () => {
    await openGrips(cleanupDrawing(), 'preflight.dxf');
    await t('gap-tol').fill('0.01'); await t('gap-tol').press('Enter');
    await menuItem('Tools', 'Preflight…');
    assert.equal(await t('preflight').isVisible(), true);
    assert.equal(await t('preflight').locator('.pfrow:not(.pfcols)').count(), 6);
    assert.match(await t('preflight-note').textContent(), /name contains “cut” \(any case\)/);
    assert.equal(await t('preflight-duplicates-count').textContent(), '2');
    assert.equal(await t('preflight-gaps-count').textContent(), '1');
    assert.equal(await t('preflight-text-count').textContent(), '1');
    assert.equal(await t('preflight-wide-count').textContent(), '1');
    assert.equal(await t('preflight-offsheet-count').textContent(), 'n/a (no sheet)');
    assert.equal(await t('preflight-offsheet-select').isDisabled(), true);
    assert.equal(await t('duplicate-count').textContent(), '2 found', 'Preflight updates the duplicate count');
    const openCount = await t('preflight-open-count').textContent();
    assert.deepEqual(await t('preflight').locator('.pfmanual').allTextContents(), ['Manual', 'Manual', 'Manual']);
    await t('preflight-duplicates-select').click();
    assert.equal(await t('sel-count').textContent(), '2 selected');
    assert.equal(await t('preflight').isVisible(), true, 'Select keeps the canvas panel open');
    for (const theme of ['light', 'dark']) {
      await menuItem('View', 'Theme: ' + theme); await frames();
      await page.screenshot({ path: shotDir + '/s11-50-' + theme + '.png' });
    }
    await menuItem('View', 'Theme: light');
    await savedDoc();
    await openPdf();
    assert.match(pdfText(await downloaded(() => t('pdf-go').click())), /^%PDF-/, 'preflight warnings never block PDF output');
    await t('preflight-duplicates-fix').click(); await frames();
    assert.equal(await t('preflight-duplicates-count').textContent(), '0');
    assert.equal(await t('preflight-open-count').textContent(), openCount, 'Fix leaves other row counts stale');
    await t('preflight-gaps-select').click(); assert.equal(await t('sel-count').textContent(), '2 selected');
    await t('preflight-gaps-fix').click(); await frames();
    assert.equal(await t('preflight-gaps-count').textContent(), '0');
    await t('preflight-wide-select').click(); assert.equal(await t('sel-count').textContent(), '1 selected');
    await t('preflight-wide-fix').click(); await frames();
    assert.equal(await t('preflight-wide-count').textContent(), '0');
    await t('undo').click(); await frames();
    assert.match(await t('preflight-note').textContent(), /Drawing changed/);
    await t('preflight-text-select').click();
    assert.equal(await t('preflight-wide-count').textContent(), '0', 'Select refreshes only the clicked row');
    await t('preflight-recheck').click(); assert.equal(await t('preflight-wide-count').textContent(), '1');
    await t('preflight-open-select').click(); assert.ok(/selected/.test(await t('sel-count').textContent()));
    await t('preflight-text-select').click(); assert.equal(await t('sel-count').textContent(), '1 selected');
    await t('preflight-close').click(); assert.equal(await t('preflight').isVisible(), false);
    await menuItem('Tools', 'Preflight…'); await t('preflight-recheck').focus(); await page.keyboard.press('Escape');
    assert.equal(await t('preflight').isVisible(), false);
    await closeTabs(/./);
  });
  await step('Background unit fix: chosen Background scales size and a nonzero corner by ×25.4; Ctrl+Z restores both', async () => {
    const doc = newDoc(); addEntities(doc, dxfLine(10, 20, 30, 20));
    await openGrips(writeDxf(doc), 'background-unit-fix.dxf');
    await t('drawing').evaluate((canvas) => {
      const ctx = canvas.getContext('2d'), draw = ctx.drawImage;
      ctx.drawImage = function (image, x, y, w, h) {
        const svg = document.querySelector('.canvas > svg'), view = svg.getAttribute('viewBox').split(' ').map(Number), box = svg.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
        const m = this.getTransform(), a = m.transformPoint({ x, y }), b = m.transformPoint({ x: x + w, y: y + h });
        canvas.__backgroundRect = [view[0] + a.x / dpr * view[2] / box.width,
          Number(document.querySelector('[data-key=sheetH]').value) - view[1] - b.y / dpr * view[3] / box.height,
          (b.x - a.x) / dpr * view[2] / box.width, (b.y - a.y) / dpr * view[3] / box.height];
        return draw.call(this, image, x, y, w, h);
      };
    });
    const painted = async () => { await frames(); return t('drawing').evaluate((c) => c.__backgroundRect); };
    try {
      await t('bg-picker').setInputFiles('fixtures/bg.png');
      await page.waitForFunction(() => document.querySelector('[data-testid=bg-name]').textContent === 'bg.png');
      await t('scale-target').selectOption('bg'); await waitSize('105.83', '52.92');
      const before = await painted();
      before.slice(0, 2).forEach((v, i) => assert.ok(Math.abs(v - [10, 20][i]) < .001, 'rendered background corner within a micron'));
      await t('unit-up').click(); await waitSize('2688.17', '1344.08');
      const after = await painted();
      after.forEach((v, i) => assert.ok(Math.abs(v - before[i] * 25.4) < .001, 'scaled rendered size and corner'));
      await page.keyboard.press('Control+z'); await waitSize('105.83', '52.92');
      const restored = await painted();
      restored.forEach((v, i) => assert.ok(Math.abs(v - before[i]) < .001, 'restored rendered size and corner'));
      await t('scale-target').selectOption('drawing'); await waitSize('20', '0');
    } finally {
      await t('drawing').evaluate((c) => { delete c.getContext('2d').drawImage; });
      await closeTabs(/./);
    }
  });

  await step('Picture PDF: changing sheets clears undo and redo so Ctrl+Z cannot resize another sheet', async () => {
    await closeTabs(/./);
    page.once('dialog', (d) => d.accept('1'));
    await t('bg-picker').setInputFiles({ name: 'picture-sheets.pdf', mimeType: 'application/pdf', buffer: Buffer.from(writePdf([new Page(80, 50), new Page(120, 90)])) });
    await page.waitForFunction(() => document.querySelector('[data-testid=bg-name]').textContent === 'picture-sheets.pdf');
    await t('unit-up').click();
    assert.equal(await t('undo').isDisabled(), false);
    await page.locator('[data-sheet="2"]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=sheet-chip]').textContent === 'Sheet 2 / 2');
    assert.equal(await t('undo').isDisabled(), true, 'sheet 1 history was cleared');
    const before = await sizeNow();
    await page.keyboard.press('Control+z'); assert.deepEqual(await sizeNow(), before, 'sheet 2 size stays put');
    await t('unit-up').click(); await page.keyboard.press('Control+z');
    assert.deepEqual(await sizeNow(), before, 'sheet 2 has its own working undo');
    assert.equal(await t('redo').isDisabled(), false);
    await page.locator('[data-sheet="1"]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=sheet-chip]').textContent === 'Sheet 1 / 2');
    assert.equal(await t('redo').isDisabled(), true, 'sheet 2 redo was cleared');
    await closeTabs(/./);
  });

  // ---- TODO 23: resize the sheet on a layout (R5c, right pane): select the sheet, drag a side handle, whole mm, the parts stay where they are ----
  const sheetSize = async () => [await page.locator('[data-key=sheetW]').inputValue(), await page.locator('[data-key=sheetH]').inputValue()];
  const sizeNum = async () => (await sheetSize()).map(Number);
  const near1 = (v, want, m) => assert.ok(Math.abs(v - want) <= 1.5, `${m}: ${v} is not within 1.5 of ${want}`);       // a pointer position is a pixel, and a pixel is more than a millimetre
  const handleAt = async (side) => { const b = await page.locator(`[data-sheet-handle=${side}] .ssel-h`).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const dragSide = async (side, mmx, mmy, opts = {}) => {
    const a = await handleAt(side), b = await at(mmx, mmy);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 3 });
    await page.mouse.move(b.x, b.y, { steps: 3 });
    if (!opts.hold) await page.mouse.up();
  };
  const sizeChanged = (axis, from) => page.waitForFunction(([k, v]) => document.querySelector(`[data-key=${k}]`).value !== v, [axis, String(from)]);
  const placedXY = async () => [await page.locator('[data-testid=px]').inputValue(), await page.locator('[data-testid=py]').inputValue()];
  await step('Sheet resize: Select sheet (or a click on its edge) selects the sheet: four side handles, "Sheet selected · W × H mm", where 0,0 is; Esc or a click away deselects', async () => {
    await threeParts();
    assert.equal(await page.locator('[data-testid=sheet-handle]').count(), 0, 'not selected yet');
    assert.equal(await t('sheet-select').textContent(), 'Select sheet');
    assert.match(await t('sheet-panel').textContent(), /Or click the sheet edge\. Drag a side handle to resize\./);
    await t('sheet-select').click();
    assert.equal(await page.locator('[data-testid=sheet-handle]').count(), 4);
    assert.deepEqual(await page.locator('[data-sheet-handle]').evaluateAll((g) => g.map((x) => x.dataset.sheetHandle).sort()), ['bottom', 'left', 'right', 'top']);
    assert.equal(await t('sheet-label').textContent(), 'Sheet selected · 1000 × 700 mm');
    assert.equal(await page.locator('.ssel-note').textContent(), '0,0 parts stay here');
    assert.equal(await t('sheet-select').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-group=tools] .sel-box').count(), 0, 'the placed part\'s own selection is not drawn meanwhile');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-testid=sheet-handle]').count(), 0);
    const e = await at(0, 350);                                   // the sheet's left edge
    await page.mouse.click(e.x, e.y);
    assert.equal(await page.locator('[data-testid=sheet-handle]').count(), 4, 'a click on the edge selects the sheet');
    const away = await at(500, 120);
    await page.mouse.click(away.x, away.y);
    assert.equal(await page.locator('[data-testid=sheet-handle]').count(), 0, 'a click on the sheet deselects it');
  });

  await step('Sheet resize: dragging the right handle shows the new outline (dashed), the added strip and "W … × H 700 mm" with "Whole mm only"; releasing sets the size, whole mm; the parts stay; one undo step', async () => {
    await threeParts();
    const before = await placedXY();
    await t('sheet-select').click();
    await dragSide('right', 1060.4, 350, { hold: true });
    await page.waitForFunction(() => document.querySelector('[data-testid=sheet-readout]'));
    const ro = await t('sheet-readout').textContent(), mw = /^W (\d+) × H 700 mm$/.exec(ro);
    assert.ok(mw, 'the readout is in whole mm: ' + ro); near1(Number(mw[1]), 1060, 'width');
    assert.equal(await page.locator('.ssel-whole').textContent(), 'Whole mm only');
    assert.equal(await t('sheet-preview').count(), 1);
    assert.equal(await page.locator('.ssel-add').count(), 1, 'the added strip');
    assert.equal(await page.locator('[data-testid=sheet-handle-hot]').count(), 1, 'the dragged handle is hot');
    assert.match(await t('cmd-hist').textContent(), /^Command: STRETCH {3}Sheet W \d+ × H 700 mm \(whole mm\)/);
    assert.deepEqual(await sheetSize(), ['1000', '700'], 'nothing is changed until it is let go');
    await page.mouse.up();
    await sizeChanged('sheetW', 1000);
    assert.deepEqual(await sheetSize(), [mw[1], '700']);
    assert.deepEqual(await placedXY(), before, 'the part has not moved');
    assert.equal(await t('sheet-label').textContent(), `Sheet selected · ${mw[1]} × 700 mm`, 'the sheet stays selected');
    assert.match(await prompt(), new RegExp(`Sheet ${mw[1]} × 700 mm\\. The parts stayed where they were\\. Ctrl\\+Z takes it back$`));
    assert.equal((await histLabels()).at(-1), `Sheet ${mw[1]} × 700 mm`);
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => document.querySelector('[data-key=sheetW]').value === '1000');
    assert.deepEqual(await placedXY(), before);
  });

  await step('Sheet resize: top, left and bottom handles; left and bottom keep the parts where they are on the screen (their sheet positions move); Esc cancels a drag; shrinking leaves parts off the sheet', async () => {
    await threeParts();
    const [x0, y0] = (await placedXY()).map(Number);
    await t('sheet-select').click();
    await dragSide('top', 500, 712);
    await sizeChanged('sheetH', 700);
    const H1 = (await sizeNum())[1]; near1(H1, 712, 'top');
    assert.deepEqual((await placedXY()).map(Number), [x0, y0], 'top: nothing moves');
    await dragSide('left', -12, 350);
    await sizeChanged('sheetW', 1000);
    const W1 = (await sizeNum())[0]; near1(W1, 1012, 'left');
    assert.deepEqual((await placedXY()).map(Number), [x0 + W1 - 1000, y0], 'left: the part is further from the new left edge by what the sheet grew');
    await dragSide('bottom', 500, -14);
    await sizeChanged('sheetH', H1);
    const H2 = (await sizeNum())[1]; near1(H2, 726, 'bottom');
    assert.deepEqual((await placedXY()).map(Number), [x0 + W1 - 1000, y0 + H2 - H1]);
    assert.deepEqual((await histLabels()).slice(-3), [`Sheet 1000 × ${H1} mm`, `Sheet ${W1} × ${H1} mm`, `Sheet ${W1} × ${H2} mm`]);
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    await page.waitForFunction(() => document.querySelector('[data-key=sheetW]').value === '1000' && document.querySelector('[data-key=sheetH]').value === '700');
    assert.deepEqual((await placedXY()).map(Number), [x0, y0], 'three undos put everything back');
    // Esc cancels
    if (!(await page.locator('[data-testid=sheet-handle]').count())) await t('sheet-select').click();
    await dragSide('right', 1200, 350, { hold: true });
    await page.keyboard.press('Escape'); await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('[data-testid=sheet-readout]'));
    assert.deepEqual(await sheetSize(), ['1000', '700']);
    assert.match(await prompt(), /Sheet resize cancelled/);
    // shrinking: the part at x 700 is now off the sheet
    if (!(await page.locator('[data-testid=sheet-handle]').count())) await t('sheet-select').click();
    await dragSide('right', 600, 350);
    await sizeChanged('sheetW', 1000);
    near1((await sizeNum())[0], 600, 'shrunk');
    assert.match(await prompt(), /now (is|are) off the sheet \(drawn in orange\)/);
    assert.deepEqual((await placedXY()).map(Number), [x0, y0]);
    await page.keyboard.press('Control+z');
  });

  await step('Sheet resize: a click on a handle then a click at the new place does it too; typed Width and Height are whole mm', async () => {
    await threeParts();
    await t('sheet-select').click();
    const a = await handleAt('right'), b = await at(1080, 350);       // 1100 is past the canvas's right edge now that the command line no longer takes the bottom 64 px
    await page.mouse.click(a.x, a.y);
    assert.equal(await page.locator('[data-testid=sheet-handle-hot]').count(), 1, 'hot after one click');
    assert.match(await prompt(), /Sheet resize: click the new place, or Esc/);
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await frames();                                                      // the readout follows the pointer on the next frame
    const ro = await t('sheet-readout').textContent(), mw = /^W (\d+) × H 700 mm$/.exec(ro);
    assert.ok(mw); near1(Number(mw[1]), 1080, 'width');
    await page.mouse.click(b.x, b.y);
    await sizeChanged('sheetW', 1000);
    near1((await sizeNum())[0], 1080, 'set');
    assert.equal(await page.locator('[data-testid=sheet-handle-hot]').count(), 0);
    await page.locator('[data-key=sheetW]').fill('1000.6'); await page.locator('[data-key=sheetW]').press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-key=sheetW]').value === '1001');
    assert.match(await prompt(), /rounded to whole mm/);
    await page.keyboard.press('Escape');
  });

  await step('Sheet resize: screenshots, light and dark (sheet selected; the right side being dragged)', async () => {
    await threeParts();
    await t('sheet-select').click();
    await shotBoth('sheet-select', async () => { await wait(150); }, async () => {});
    await shotBoth('sheet-drag', async () => { await dragSide('right', 1120, 350, { hold: true }); await wait(150); }, async () => { await page.keyboard.press('Escape'); await page.mouse.up(); });
    await page.keyboard.press('Escape');
    await closeTabs(/./);
  });

  // ---- Compare drawings (TODO 41; mock-up R5d, Option B) ----
  const plateDxf = (name, r2) => {
    const d = newDoc(4); addEntities(d, [dxfPoly([[0, 0], [300, 0], [300, 180], [0, 180]], { closed: true }), dxfCircle(80, 90, 30), dxfCircle(220, 90, r2)]);
    return { name, mimeType: 'application/dxf', buffer: Buffer.from(writeDxf(d)) };
  };
  const cmpHint = () => t('cmp-hint').textContent();
  const cmpCount = () => t('cmp-count').textContent();
  const cmpOffX = async () => Number(/X (-?[\d.]+),/.exec(await cmpHint())[1]);

  await step('Compare: File → Compare drawings… opens a Compare tab with the open drawings as 1 and 2, differences listed and glowing', async () => {
    await closeTabs(/./);
    await t('picker').setInputFiles(plateDxf('plate-b.dxf', 30));
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'plate-b.dxf');
    await t('picker').setInputFiles(plateDxf('plate-c.dxf', 30.6));
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'plate-c.dxf');
    await page.locator('.tabs .dtab', { hasText: 'plate-b' }).click();
    await menuItem('File', 'Compare drawings…');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'Compare');
    assert.equal(await t('cmp-name-1').textContent(), 'plate-b.dxf');
    assert.equal(await t('cmp-name-2').textContent(), 'plate-c.dxf');
    assert.equal(await cmpCount(), 'Press Compare', 'nothing is worked out until the button is pressed');
    assert.equal(await t('cmp-glow').count(), 0);
    await t('cmp-run').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=cmp-count]').textContent === '1 difference');
    assert.equal(await t('cmp-stale').isVisible(), false);
    assert.equal(await t('cmp-glow').count(), 1);
    assert.match(await t('cmp-diff').textContent(), /0\.[56]\d mm/);
    assert.match(await t('cmd-hist').textContent(), /COMPARE.*plate-b\.dxf \(red\) vs plate-c\.dxf \(blue\).*tolerance 0\.1 mm.*1 difference/);
    await menuItem('File', 'Compare drawings…');
    assert.deepEqual((await tabNames()).filter((n) => n === 'Compare').length, 1, 'one Compare tab');
  });

  await step('Compare: tolerance is editable (bad values refused), Show differences hides the glow, a click on a difference zooms to it', async () => {
    await t('cmp-tol').fill('1'); await t('cmp-tol').press('Enter');
    await t('cmp-run').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=cmp-count]').textContent === 'No differences');
    await t('cmp-tol').fill('abc'); await t('cmp-tol').press('Enter');
    assert.match(await prompt(), /Tolerance: a number above 0/);
    assert.equal(await t('cmp-tol').inputValue(), '1');
    await t('cmp-tol').fill('0.1'); await t('cmp-tol').press('Enter');
    await t('cmp-run').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=cmp-count]').textContent === '1 difference');
    await t('cmp-show').uncheck();
    await page.waitForFunction(() => !document.querySelector('[data-testid=cmp-glow]'));
    await t('cmp-show').check();
    await page.waitForFunction(() => !!document.querySelector('[data-testid=cmp-glow]'));
    const z0 = parseInt(await t('zoom').textContent(), 10);
    await t('cmp-diff').click();
    await page.waitForFunction((z) => parseInt(document.querySelector('[data-testid=zoom]').textContent, 10) > z, z0);
    assert.match(await prompt(), /Difference 1: 0\.[56]\d mm/);
  });

  await step('Compare: distinct colours, Line up Centres and Manual (arrow keys nudge by the step, a drag moves drawing 2), Add file… picks another drawing', async () => {
    assert.deepEqual(await t('cmp-item').evaluateAll((rs) => rs.map((r) => r.dataset.colour)), ['red', 'blue']);
    assert.match(await t('cmd-hist').textContent(), /plate-b\.dxf \(red\)/);
    await t('cmp-lineup-centre').click();
    assert.equal(await cmpOffX(), 0);
    await t('cmp-lineup-manual').click();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => /X 1\.00,/.test(document.querySelector('[data-testid=cmp-hint]').textContent));
    assert.equal(await t('cmp-stale').isVisible(), true, 'a move marks the result out of date');
    assert.equal(await cmpCount(), '1 difference', 'the old result stays until Compare is pressed again');
    assert.equal(await t('cmp-glow').count(), 0, 'the old glow is hidden: it no longer sits on the drawing');
    await t('cmp-run').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=cmp-count]').textContent !== '1 difference');
    assert.equal(await t('cmp-stale').isVisible(), false, 'pressing Compare clears the mark');
    // idle: no repeating work (no animation frames) while a Compare result is on show
    const frames = await page.evaluate(() => new Promise((res) => { let n = 0; const raf = window.requestAnimationFrame; window.requestAnimationFrame = (f) => { n++; return raf(f); }; setTimeout(() => { window.requestAnimationFrame = raf; res(n); }, 1000); }));
    assert.equal(frames, 0, 'Compare is idle until something changes');
    const b = await t('canvas').boundingBox();
    await page.mouse.move(b.x + 400, b.y + 300); await page.mouse.down(); await page.mouse.move(b.x + 450, b.y + 300, { steps: 4 }); await page.mouse.up();
    await page.waitForFunction(() => !/X 1\.00,/.test(document.querySelector('[data-testid=cmp-hint]').textContent));
    assert.ok((await cmpOffX()) > 1, 'dragged right');
    assert.equal(await t('cmp-stale').isVisible(), true, 'a drag marks the result out of date');
    await t('cmp-lineup-bl').click();
    assert.equal(await cmpOffX(), 0);
    await t('cmp-remove').nth(1).click();
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), t('cmp-add-file').click()]);
    await fc.setFiles(plateDxf('plate-d.dxf', 31));
    await page.waitForFunction(() => document.querySelector('[data-testid=cmp-name-2]')?.textContent === 'plate-d.dxf');
    assert.equal(await cmpCount(), 'Press Compare', 'a new drawing has no result yet');
    await t('cmp-run').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=cmp-count]').textContent === '1 difference');
  });

  await step('Compare: run once, move, "out of date" mark, run again, mark gone (TODO 113)', async () => {
    assert.equal(await t('cmp-stale').isVisible(), false);
    await page.locator('[data-testid^=cmp-lineup-][aria-pressed=true]').click();
    assert.equal(await t('cmp-stale').isVisible(), false, 'clicking the current Line up choice preserves the result');
    await t('cmp-lineup-manual').click();
    await page.keyboard.press('ArrowRight');
    await t('cmp-stale').waitFor();
    assert.match(await t('cmp-stale').textContent(), /Out of date - press Compare again/);
    await shotBoth('compare-outofdate');
    await t('cmp-run').click();
    await t('cmp-stale').waitFor({ state: 'hidden' });
    await t('cmp-lineup-bl').click();
    await t('cmp-stale').waitFor();
    await t('cmp-run').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=cmp-count]').textContent === '1 difference');
  });

  await step('Compare: dragging drawing 2 snaps its corner onto drawing 1\'s corner, with a marker and a name; SNAP off drops where released (TODO 112)', async () => {
    await t('cmp-lineup-manual').click();
    await page.getByRole('button', { name: 'Fit', exact: true }).click();     // both corners in view
    const drag = async (shot) => {                                      // drawing 2's bottom-left corner (0, 0) to drawing 1's bottom-right one (300, 0), 4 px short and 3 px high
      const a = await at(0, 0), z = await at(300, 0);
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(z.x - 4, z.y - 3, { steps: 6 });
      if (shot) await page.screenshot({ path: `${shotDir}/s16-compare-snap-light.png` });
      await page.mouse.up();
    };
    await drag(true);
    assert.deepEqual(await page.evaluate(() => /X (-?[\d.]+), Y (-?[\d.]+)/.exec(document.querySelector('[data-testid=cmp-hint]').textContent).slice(1).map(Number)), [300, 0], 'the drop lands exactly on the target corner');
    await t('cmp-lineup-bl').click(); await t('cmp-lineup-manual').click();
    await t('tog-snap').click();
    await drag(false);
    const [x, y] = await page.evaluate(() => /X (-?[\d.]+), Y (-?[\d.]+)/.exec(document.querySelector('[data-testid=cmp-hint]').textContent).slice(1).map(Number));
    assert.ok(x !== 300 && Math.abs(x - 300) < 2 && y !== 0, `SNAP off: the exact released point, not the corner (${x}, ${y})`);
    await t('tog-snap').click();
    await t('cmp-lineup-bl').click();
  });

  await step('Compare: five snapshots from tabs, library and disk; tick, eye, reference, selection, removal and coloured table (TODO 114)', async () => {
    // Make a real library part through Extract, so the source picker has no fixture-only path.
    await t('picker').setInputFiles(plateDxf('compare-library-source.dxf', 30.9));
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'compare-library-source.dxf');
    await page.keyboard.press('Control+a');
    await t('bar-extract').click();
    const partName = '<b>Compare part</b>';
    await t('name-input').fill(partName); await t('name-ok').click();
    await t('name-dialog').waitFor({ state: 'detached' });
    await closeTabs(/^compare-library-source/);
    await menuItem('File', 'Compare drawings…');
    while (await t('cmp-remove').count()) await t('cmp-remove').first().click();
    assert.equal(await t('cmp-run').isDisabled(), true);
    const addTab = async (name) => {
      await t('cmp-add-tab').click(); await page.getByRole('menuitem', { name, exact: true }).click();
    };
    const addLibrary = async () => {
      await t('cmp-add-library').click(); await page.getByRole('menuitem', { name: partName, exact: true }).click();
    };
    await addTab('plate-b.dxf'); await addTab('plate-c.dxf'); await addLibrary();
    assert.equal(await t('cmp-name-3').textContent(), partName);
    assert.equal(await t('cmp-items').locator('b').count(), 0, 'file and library names stay text');
    assert.deepEqual(await t('cmp-item').evaluateAll((rs) => rs.map((r) => r.dataset.colour)), ['red', 'blue', 'green']);
    await t('cmp-run').click();
    assert.equal(await t('cmp-result').count(), 3);
    assert.deepEqual(await t('cmp-result').first().locator('td').allTextContents(), ['0.00', '0.00', '0.00 × 0.00']);
    assert.deepEqual(await t('cmp-glow').evaluateAll((rs) => rs.map((r) => r.dataset.colour).sort()), ['blue', 'green']);
    const resultText = await t('cmp-table').textContent();
    await t('cmp-eye').nth(2).click();
    assert.equal(await t('cmp-eye').nth(2).getAttribute('aria-pressed'), 'false');
    assert.equal(await t('cmp-stale').isVisible(), false, 'the eye changes only visibility');
    await t('cmp-run').click();
    assert.equal(await t('cmp-result').count(), 3, 'eye-hidden snapshot remains in the table');
    assert.equal(await t('cmp-table').textContent(), resultText);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=cmp-glow]')].every((r) => r.dataset.colour !== 'green'));
    await t('cmp-check').first().uncheck();
    await t('cmp-run').click();
    assert.equal(await t('cmp-result').count(), 2, 'unticked snapshot is left out');
    assert.equal(await t('cmp-result').first().locator('th').textContent(), 'plate-c.dxf');
    assert.deepEqual(await t('cmp-result').first().locator('td').allTextContents(), ['0.00', '0.00', '0.00 × 0.00'], 'first ticked is the reference');
    await t('cmp-eye').nth(1).click();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    assert.ok(await t('drawing').evaluate((el) => {
      const d = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
      let red = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i] - d[i + 1] > 60 && Math.abs(d[i + 1] - d[i + 2]) < 20) red++;
      return red > 100;
    }), 'the eye controls visibility independently of the compare tick');
    await t('cmp-eye').nth(1).click();
    await t('cmp-check').nth(1).uncheck();
    assert.equal(await t('cmp-run').isDisabled(), true, 'one ticked snapshot cannot compare');
    await t('cmp-check').first().check(); await t('cmp-check').nth(1).check();
    await t('cmp-eye').nth(2).click();
    await t('cmp-lineup-manual').click();
    await t('cmp-name-3').click(); await page.keyboard.press('ArrowRight');
    assert.equal(await cmpOffX(), 1, 'selected third snapshot moves');
    await t('cmp-name-2').click(); assert.equal(await cmpOffX(), 0, 'second snapshot stays put');
    await t('cmp-name-1').click(); assert.equal(await cmpOffX(), 0, 'reference stays put');
    await t('cmp-lineup-bl').click();
    await t('cmp-remove').nth(2).click(); await t('cmp-run').click();
    assert.equal(await t('cmp-result').count(), 2);
    assert.equal(await cmpCount(), '1 difference', 'two-item result is unchanged after removal');
    await addLibrary(); await addTab('plate-b.dxf'); await addTab('plate-c.dxf');
    assert.equal(await t('cmp-item').count(), 5);
    assert.equal(new Set(await t('cmp-item').evaluateAll((rs) => rs.map((r) => r.dataset.colour))).size, 5);
    for (const id of ['cmp-add-tab', 'cmp-add-library', 'cmp-add-file']) assert.equal(await t(id).isDisabled(), true);
    await t('cmp-remove').nth(4).click(); await t('cmp-remove').nth(3).click();
    await t('cmp-run').click();
    await t('decimals').selectOption('1');
    assert.deepEqual(await t('cmp-result').first().locator('td').allTextContents(), ['0.0', '0.0', '0.0 × 0.0']);
    await t('decimals').selectOption('2');
    assert.equal(await t('cmp-result').count(), 3);
    await shotBoth('compare-three');
    assert.equal(await t('cmp-result').nth(2).locator('th').textContent(), partName);
    const colours = await t('cmp-item').locator('.cswatch').evaluateAll((rs) => rs.map((r) => getComputedStyle(r).backgroundColor));
    assert.equal(new Set(colours).size, 3);
    // Editing an open source after adding it cannot change the Compare snapshot.
    await page.locator('.tabs .dtab', { hasText: 'plate-b.dxf' }).click();
    await page.keyboard.press('Control+a'); await page.keyboard.press('Delete');
    await menuItem('File', 'Compare drawings…'); await t('cmp-run').click();
    assert.equal(await t('cmp-table').textContent(), resultText, 'source edits leave snapshot measurements intact');
    assert.equal(await cmpCount(), '2 differences');
  });

  await step('Compare: a library card dropped on the canvas or the panel joins Compare; five is the limit; a hint follows the pointer (T49)', async () => {
    const partName = '<b>Compare part</b>';
    await t('panel-library').click();
    const id = await libCard(partName).getAttribute('data-part-id');
    await t('panel-main').click();
    const fire = (type, target) => page.evaluate(([ty, tg, pid]) => {
      const dt = new DataTransfer(); dt.setData('application/x-pd-part', pid); dt.setData('text/plain', 'part');
      document.querySelector(`[data-testid=${tg}]`).dispatchEvent(new DragEvent(ty, { dataTransfer: dt, clientX: 400, clientY: 300, bubbles: true, cancelable: true }));
    }, [type, target, id]);
    await t('cmp-remove').last().click();
    const before = await t('cmp-item').count(), tabs = await tabNames();
    assert.equal(before, 2);
    await fire('dragover', 'canvas');
    assert.equal(await t('cmp-drop-hint').isVisible(), true);
    assert.equal(await t('cmp-drop-hint').textContent(), 'Drop to add to Compare');
    await shotBoth('t49-hint', () => fire('dragover', 'canvas'), () => page.evaluate(() => { document.querySelector('[data-testid=cmp-drop-hint]').hidden = true; }));
    await fire('drop', 'canvas');
    assert.equal(await t('cmp-drop-hint').isVisible(), false);
    assert.equal(await t('cmp-item').count(), before + 1, 'a drop on the canvas adds one drawing');
    assert.equal(await t('cmp-name-3').textContent(), partName);
    assert.equal(await t('compare-panel').isVisible(), true, 'the app stays on Compare');
    assert.deepEqual(await tabNames(), tabs, 'no layout tab is made or changed');
    assert.deepEqual(await t('cmp-item').evaluateAll((rs) => rs.map((r) => r.dataset.colour)), ['red', 'blue', 'green'], 'the next free colour');
    await shotBoth('t49-result');
    await fire('drop', 'cmp-items');
    assert.equal(await t('cmp-item').count(), before + 2, 'a drop on the panel list adds one more');
    await fire('drop', 'canvas');
    assert.equal(await t('cmp-item').count(), 4 + 1, 'five drawings');
    await fire('drop', 'canvas');
    assert.equal(await t('cmp-item').count(), 5, 'a sixth is not added');
    assert.equal(await t('cmd-prompt').textContent(), 'Compare holds five drawings; remove one first');
    await t('cmp-remove').last().click(); await t('cmp-remove').last().click();
  });

  await step('Compare: screenshots, light and dark; the top bar still fits at 1024', async () => {
    await shotBoth('compare');
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'the page is wider than 1024');
    const bar = await page.locator('.tabsrow').evaluate((n) => { const r = n.getBoundingClientRect(); return [...n.children].every((c) => c.getBoundingClientRect().right <= r.right + 1); });
    assert.ok(bar, 'the tab bar overflows at 1024');
    await page.screenshot({ path: `${shotDir}/compare-1024-light.png` });
    await page.setViewportSize({ width: 1440, height: 900 });
    await closeTabs(/./);
  });

  await step('T50: a library card dropped on a drawing tab goes into that drawing (loose, selected, one Undo); on a layout tab it goes on the sheet; on the start screen it opens as a new drawing', async () => {
    const file = (name, ents, layers = {}) => { const d = newDoc(4); for (const [n, aci] of Object.entries(layers)) addLayer(d, n, { aci }); addEntities(d, ents); return { name, mimeType: 'application/dxf', buffer: Buffer.from(writeDxf(d)) }; };
    await closeTabs(/./);
    await t('picker').setInputFiles(file('t50-source.dxf', [dxfPoly([[0, 0], [100, 0], [100, 60], [0, 60]], { closed: true, layer: 'T50CUT' }), dxfCircle(50, 30, 10, { layer: 'T50HOLE' })], { T50CUT: 1, T50HOLE: 3 }));
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 't50-source.dxf');
    await page.keyboard.press('Control+a');
    await t('bar-extract').click();
    await t('name-input').fill('T50 part'); await t('name-ok').click();
    await t('name-dialog').waitFor({ state: 'detached' });
    await closeTabs(/./);
    await t('panel-library').click();
    const id = await libCard('T50 part').getAttribute('data-part-id');
    await t('panel-main').click();
    const fire = (type, x, y) => page.evaluate(([ty, cx, cy, pid]) => {
      const dt = new DataTransfer(); dt.setData('application/x-pd-part', pid); dt.setData('text/plain', 'T50 part');
      document.querySelector('[data-testid=canvas]').dispatchEvent(new DragEvent(ty, { dataTransfer: dt, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
    }, [type, x, y, id]);
    const mid = async () => { const r = await t('canvas').boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };

    // the empty start screen: the part opens as its own new drawing tab, named after it, not saved yet
    assert.deepEqual(await tabNames(), ['Drawing 1']);
    let m = await mid();
    await fire('dragover', m.x, m.y);
    assert.equal(await t('drop-hint').textContent(), 'Drop to open as a new drawing');
    await fire('drop', m.x, m.y);
    assert.deepEqual(await tabNames(), ['T50 part.dxf']);
    assert.equal(await entCount(), 2);
    assert.match(await t('cmd-prompt').textContent(), /^T50 part opened as a new drawing: 2 entities\. Not saved yet: Save asks where$/);
    await closeTabs(/./);

    // a drawing tab: the entities go in at the drop point, the app stays on the tab
    await t('picker').setInputFiles(file('t50-target.dxf', [dxfLine(0, 0, 300, 0, { layer: 'T50CUT' }), dxfLine(0, 10, 300, 10)], { T50CUT: 5 }));
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 't50-target.dxf');
    await page.locator('[data-tool=select]').click();
    assert.equal(await entCount(), 2);
    const to = await mid();
    await fire('dragover', to.x, to.y);
    const hint = (await t('drop-hint').textContent()).match(/^Drop to add to t50-target\.dxf at X (-?[\d.]+) Y (-?[\d.]+) mm$/);
    assert.ok(hint, await t('drop-hint').textContent());
    await fire('drop', to.x, to.y);
    assert.equal(await t('drop-hint').isVisible(), false);
    assert.deepEqual(await tabNames(), ['t50-target.dxf'], 'the app stays on the drawing tab');
    assert.equal(await entCount(), 4);
    assert.equal(await selCount(), '2 selected', 'the new entities are the selection');
    assert.match(await t('cmd-prompt').textContent(), /^T50 part \(100\.00 × 60\.00 mm\) added to t50-target\.dxf: 2 entities selected, new layers: T50HOLE\. Ctrl\+Z takes them away$/);
    const doc = await savedDoc();
    assert.deepEqual(Object.keys(doc.layers).sort(), ['0', 'T50CUT', 'T50HOLE']);
    const newOnes = doc.entities.slice(2), x10 = (e) => Number(e.r.v[e.r.c.indexOf(10)]), y20 = (e) => Number(e.r.v[e.r.c.indexOf(20)]);
    assert.deepEqual(newOnes.map((e) => e.layer), ['T50CUT', 'T50HOLE'], 'each on its own layer');
    const circle = newOnes.find((e) => e.type === 'CIRCLE');
    assert.ok(Math.abs(x10(circle) - (Number(hint[1]) + 50)) < 0.01 && Math.abs(y20(circle) - (Number(hint[2]) + 30)) < 0.01, 'the part\'s lower-left corner is where the mouse was let go, 1:1');
    await shotBoth('t50-drawing');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Control+z');
    assert.equal(await entCount(), 2, 'one Undo takes both away');
    assert.deepEqual(await tabNames(), ['t50-target-edited.dxf'], 'still the one tab (the Save above gave it its -edited name)');

    // a layout tab: on the sheet, as before
    await t('new-layout').click();
    m = await mid();
    await fire('drop', m.x, m.y);
    assert.match(await t('cmd-prompt').textContent(), /^T50 part \(100\.00 × 60\.00 mm\) added to Layout 1/);
    assert.deepEqual(await tabNames(), ['t50-target-edited.dxf', 'Layout 1']);
    await page.locator('.tabs .dtab', { hasText: 't50-target' }).click();
    assert.equal(await entCount(), 2, 'the drawing tab is untouched');
    await closeTabs(/./);
    await t('panel-library').click();
    page.once('dialog', (d) => d.accept());
    await libCard('T50 part').locator('[data-testid=lib-menu]').click();
    await page.getByRole('menuitem', { name: 'Delete from library', exact: true }).click();
    await libCard('T50 part').waitFor({ state: 'detached' });
    await t('panel-main').click();
  });

  // ---- polar and object-snap tracking (track.js; mock-up R7a, Option A) ----
  const chipOn = async (id) => (await t(id).getAttribute('aria-pressed')) === 'true';
  const trkN = (cls) => page.locator('.ovl .' + cls).count();
  const incMenu = async () => { await t('tog-polar').click({ button: 'right' }); await t('ctx-menu').waitFor(); return page.locator('[data-testid=ctx-menu] .mi').evaluateAll((bs) => bs.map((b) => b.textContent)); };
  const pickInc = (txt) => page.locator('[data-testid=ctx-menu] .mi', { hasText: txt }).click();
  await step('tracking: POLAR / OTRACK chips (on in a fresh profile, remembered), ORTHO and POLAR turn each other off, the increment menu, F10 / F11', async () => {
    const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p2 = await c2.newPage();
    await p2.goto(URL_); await p2.waitForSelector('[data-testid=count]', { state: 'attached' });
    const on2 = async (id) => (await p2.locator(`[data-testid=${id}]`).getAttribute('aria-pressed')) === 'true';
    assert.deepEqual([await on2('tog-polar'), await on2('tog-otrack'), await on2('tog-ortho')], [true, true, false], 'a fresh profile: POLAR and OTRACK on, ORTHO off');
    await p2.locator('[data-testid=tog-otrack]').click();
    await p2.locator('[data-testid=tog-polar]').click({ button: 'right' });
    await p2.locator('[data-testid=ctx-menu] .mi', { hasText: '22.5°' }).click();
    assert.match(await p2.locator('[data-testid=cmd-prompt]').textContent(), /^Polar on \(22\.5°\)$/);
    await p2.reload(); await p2.waitForSelector('[data-testid=count]', { state: 'attached' });
    assert.deepEqual([await on2('tog-polar'), await on2('tog-otrack')], [true, false], 'remembered on this PC');
    await p2.locator('[data-testid=tog-polar]').click({ button: 'right' });
    assert.deepEqual(await p2.locator('[data-testid=ctx-menu] .mi').allTextContents(), ['90°', '45°', '30°', '22.5°●', '15°', '10°', '5°'], 'the saved increment is ticked');
    await c2.close();

    assert.equal(await chipOn('tog-polar'), false, 'the test page starts with tracking off');
    await t('tog-polar').click();
    assert.equal(await chipOn('tog-polar'), true);
    assert.match(await prompt(), /^Polar on \(15°\)$/);
    await t('tog-ortho').click();
    assert.deepEqual([await chipOn('tog-polar'), await chipOn('tog-ortho')], [false, true], 'ORTHO on turns POLAR off');
    await t('tog-polar').click();
    assert.deepEqual([await chipOn('tog-polar'), await chipOn('tog-ortho')], [true, false], 'POLAR on turns ORTHO off');
    assert.deepEqual(await incMenu(), ['90°', '45°', '30°', '22.5°', '15°●', '10°', '5°']);
    await pickInc('30°');
    assert.match(await prompt(), /^Polar on \(30°\)$/);
    assert.deepEqual(await incMenu(), ['90°', '45°', '30°●', '22.5°', '15°', '10°', '5°']);
    await pickInc('15°');
    assert.match(await prompt(), /^Polar on \(15°\)$/);
    await page.keyboard.press('F10');
    assert.equal(await chipOn('tog-polar'), false); assert.match(await prompt(), /^Polar off$/);
    await page.keyboard.press('F10');
    assert.equal(await chipOn('tog-polar'), true);
    await page.keyboard.press('F11');
    assert.equal(await chipOn('tog-otrack'), true); assert.match(await prompt(), /^Object snap tracking on$/);
    await page.keyboard.press('F11'); assert.match(await prompt(), /^Object snap tracking off$/);
    await page.keyboard.press('F11');
    await page.setViewportSize({ width: 1024, height: 700 });                                  // the status bar with five chips still fits
    assert.ok(await page.locator('.status').evaluate((n) => n.scrollWidth <= n.clientWidth), 'the status bar overflows at 1024');
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await step('tracking: POLAR locks a line onto 30° (guide, readout "Polar: 120.00 < 30°"), a typed length goes along the ray, the points are exact', async () => {
    await closeTabs(/./);
    await page.locator('[data-tool=line]').click();
    await typeCmd('20,20');
    await page.waitForTimeout(400);                                                            // the empty tab's sheet and view settle first
    const { sc } = await sheetPx(), off = 3 / sc, a = Math.PI / 6, ux = Math.cos(a), uy = Math.sin(a);
    const near3 = (L) => at(20 + L * ux + off * uy, 20 + L * uy - off * ux);                    // about 3 px beside the 30° ray, L along it
    const p = await near3(120);
    await page.mouse.move(p.x, p.y);
    await tipWhen(/^Polar: 1(19|20)\.\d\d < 30°$/);
    const L1 = +(/Polar: ([\d.]+)/.exec(await tipText())[1]);                              // the pointer lands on whole pixels: about 120
    assert.equal(await trkN('trk-polar'), 1, 'the dotted polar guide');
    await page.mouse.click(p.x, p.y);
    const q2 = [20 + L1 * ux, 20 + L1 * uy];
    const p3 = await at(q2[0] + 80 * ux + off * uy, q2[1] + 80 * uy - off * ux);
    await page.mouse.move(p3.x, p3.y);
    await tipWhen(/^Polar: (79|80|81)\.\d\d < 30°$/);
    assert.equal(await trkN('trk-polar'), 1);
    await typeCmd('50');                                                                       // direct distance: along the locked ray
    await page.keyboard.press('Escape');
    const doc = await savedDoc();
    assert.deepEqual(doc.entities.map((e) => e.type), ['LINE', 'LINE']);
    const ends = (e) => [10, 20, 11, 21].map((c) => fieldOf(e, c));
    const e1 = ends(doc.entities[0]), e2 = ends(doc.entities[1]);
    for (const [got, want] of [[e1[0], 20], [e1[1], 20], [e1[2], q2[0]], [e1[3], q2[1]], [e2[0], q2[0]], [e2[1], q2[1]], [e2[2], q2[0] + 50 * ux], [e2[3], q2[1] + 50 * uy]]) assert.ok(Math.abs(got - want) < 1e-4, `${got} vs ${want}`);
  });

  await step('tracking: OTRACK acquires a snap point after a hover and releases it on another, lines up, an intersection lands exactly, and it clears when the line ends', async () => {
    await closeTabs(/./);
    await page.locator('[data-tool=line]').click();
    await typeCmd('20,20'); await typeCmd('@120,0'); await page.keyboard.press('Escape');
    await typeCmd('60,100'); await typeCmd('@0,40'); await page.keyboard.press('Escape');
    const hover = async (x, y) => { const p = await at(x, y); await page.mouse.move(p.x, p.y); await page.waitForTimeout(750); };
    await hover(140, 20);
    assert.equal(await trkN('trk-plus'), 1, 'the end (140, 20) is acquired');
    await hover(60, 140);
    assert.equal(await trkN('trk-plus'), 2);
    const free = await at(100, 60); await page.mouse.move(free.x, free.y);
    await hover(60, 140);
    assert.equal(await trkN('trk-plus'), 1, 'hovering on it again releases it');
    await page.mouse.move(free.x, free.y);
    await hover(60, 140);
    assert.equal(await trkN('trk-plus'), 2);
    const { sc } = await sheetPx(), off = 3 / sc;
    const x = await at(60 + off, 20 + off);                                                    // near where x = 60 (the top end) meets y = 20 (the right end)
    await page.mouse.move(x.x, x.y);
    await tipWhen(/^Endpoint: 0° · Endpoint: 90°$/);
    assert.equal(await trkN('trk-x'), 1, 'the × where the two tracking lines meet');
    assert.equal(await trkN('trk-line'), 2);
    await page.mouse.click(x.x, x.y);
    await typeCmd('@0,50');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.ovl .trk-plus'), null, { timeout: 5000 }).catch(() => { throw new Error('the acquired points did not go when the line ended'); });
    const doc = await savedDoc();
    assert.equal(doc.entities.length, 3);
    const e = doc.entities[2];
    assert.deepEqual([10, 20, 11, 21].map((c) => Math.round(fieldOf(e, c) * 1e6) / 1e6), [60, 20, 60, 70], 'the pick landed exactly on the intersection');
  });

  await step('tracking: screenshots, light and dark (a line in progress with a polar guide and an OTRACK ×)', async () => {
    await page.locator('[data-tool=line]').click();
    await typeCmd('20,50');
    const a = await at(60, 140); await page.mouse.move(a.x, a.y); await page.waitForTimeout(750);
    const p = await at(60.3, 50 + 40 + 0.3);                                                    // near where the 45° ray from (20, 50) meets x = 60 (not 15°: that crosses the line x = 60, y 20–70, and Nearest beats POLAR)
    await page.mouse.move(p.x, p.y);
    await tipWhen(/^Endpoint: 90° · Polar: 45°$/);
    assert.equal(await trkN('trk-x'), 1);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${shotDir}/tracking-light.png` });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.mouse.move(p.x + 1, p.y); await page.mouse.move(p.x, p.y);
    await tipWhen(/^Endpoint: 90° · Polar: 45°$/);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${shotDir}/tracking-dark.png` });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.ovl .trk-plus'), null, { timeout: 5000 });
    await page.keyboard.press('Escape');
    await closeTabs(/./);
  });

  await step('tracking: POLAR also locks a grip drag of a line end (30° from the other end)', async () => {
    await closeTabs(/./);
    await page.locator('[data-tool=line]').click();
    await typeCmd('20,20'); await typeCmd('@100,0'); await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await page.locator('[data-tool=select]').click();
    await pick(70, 20, 3);
    const { sc } = await sheetPx(), off = 3 / sc, a = Math.PI / 6;
    await dragGripTo('0:b', 20 + 100 * Math.cos(a) + off * Math.sin(a), 20 + 100 * Math.sin(a) - off * Math.cos(a));
    const e = entOf(await savedDoc(), 0), x = fieldOf(e, 11) - fieldOf(e, 10), y = fieldOf(e, 21) - fieldOf(e, 20);
    assert.ok(Math.abs(Math.atan2(y, x) * 180 / Math.PI - 30) < 1e-6, 'the stretched end is exactly on the 30° ray: ' + Math.atan2(y, x) * 180 / Math.PI);
    assert.ok(Math.abs(Math.hypot(x, y) - 100) < 1.5, 'about as long as the pointer was out');
  });

  // ---- POLAR in Measure and Dimension picks (pickPoint → trackPick): a pick 6 px beside the 30° ray locks onto it ----
  const blankTab = async () => {
    await closeTabs(/./);
    await page.locator('[data-tool=line]').click();
    await typeCmd('20,20'); await page.keyboard.press('Escape');                              // an empty drawing tab, nothing to snap to
    await page.waitForTimeout(400);
    if (!(await chipOn('tog-polar'))) await t('tog-polar').click();
  };
  const ray30 = async (L) => { const { sc } = await sheetPx(), o = 6 / sc, a = Math.PI / 6; return at(20 + L * Math.cos(a) + o * Math.sin(a), 20 + L * Math.sin(a) - o * Math.cos(a)); };
  const trkWhen = (cls, n) => page.waitForFunction(([c, k]) => document.querySelectorAll('.ovl .' + c).length === k, [cls, n], { timeout: 5000 }).catch(() => { throw new Error(`${cls} count never became ${n}`); });
  await step('tracking: POLAR in Measure locks the second point onto the 30° ray (guide shows, Angle 30°)', async () => {
    await blankTab();
    await page.locator('[data-tool=measure]').click();
    await click(20, 20);
    const p = await ray30(100);
    await page.mouse.move(p.x, p.y);
    await trkWhen('trk-polar', 1);
    await page.mouse.click(p.x, p.y);
    assert.match(await prompt(), /Distance (99|100|101)(\.\d+)? mm .*Angle 30(\.0+)?°/, 'the point is on the ray, not 6 px beside it: ' + await prompt());
    await page.keyboard.press('Escape');
  });
  await step('tracking: POLAR in the Dimension tool (Aligned) locks the second point onto the 30° ray; the placed dimension runs at 30°', async () => {
    await blankTab();
    await page.locator('[data-tool=dimension]').click();
    assert.equal(await page.locator('[data-tool=dimension]').getAttribute('title'), 'Dimension (D)', 'Aligned is the type');
    await click(20, 20);
    const p = await ray30(100);
    await page.mouse.move(p.x, p.y);
    await trkWhen('trk-polar', 1);
    await page.mouse.click(p.x, p.y);
    await click(20 + 50 * Math.cos(Math.PI / 6) - 15 * 0.5, 20 + 25 + 15 * Math.cos(Math.PI / 6));          // the callout 15 mm to the left of the ray
    await page.keyboard.press('Escape');
    const doc = await savedDoc(), ins = doc.entities.filter((e) => e.type === 'INSERT' && e.layer === 'Dimensions');
    assert.equal(ins.length, 1);
    const dp = dimParams(doc.blocks[ins[0].r.v[ins[0].r.c.indexOf(2)]]);
    assert.ok(Math.abs(Math.atan2(dp.b[1] - dp.a[1], dp.b[0] - dp.a[0]) * 180 / Math.PI - 30) < 1e-3, 'the dimension points are exactly on 30°: ' + JSON.stringify(dp));
  });
  await step('tracking: Shift in Measure drops the tracking guide and keeps the pick straight along X', async () => {
    await blankTab();
    await page.locator('[data-tool=measure]').click();
    await click(20, 20);
    const p = await ray30(100);
    await page.mouse.move(p.x, p.y);
    await trkWhen('trk-polar', 1);
    await page.keyboard.down('Shift');
    try {
      await page.mouse.move(p.x + 1, p.y);
      await trkWhen('trk-polar', 0); await trkWhen('trk-line', 0);
      await page.mouse.click(p.x, p.y);
    } finally { await page.keyboard.up('Shift'); }
    assert.match(await prompt(), /ΔY 0   Angle 0°/, 'straight along X, not on the 30° ray');
    await page.keyboard.press('Escape');
  });
  await step('tracking: on a layout tab Measure shows no tracking guide', async () => {
    await closeTabs(/./);
    await t('new-layout').click();
    await page.locator('[data-tool=measure]').click();
    assert.match(await prompt(), /Measure: open a drawing tab first/);
    await page.mouse.move(700, 450); await page.mouse.move(720, 460);
    await page.waitForTimeout(200);
    for (const c of ['trk-line', 'trk-polar', 'trk-x', 'trk-plus']) assert.equal(await trkN(c), 0, c);
    await page.locator('[data-tool=select]').click();
    await closeTabs(/./);
  });

  // ---- TODO 26: dimension types (mock-up R8a, Option A): the Dimension button's flyout, DLI / DRA / DDI / DAN ----
  const dimDoc = () => {
    const doc = newDoc(4);
    addEntities(doc, dxfLine(20, 20, 220, 20), dxfLine(20, 20, 100, 100), dxfCircle(150, 100, 25), dxfArc(200, 150, 20, 0, 180));
    return writeDxf(doc);
  };
  const dimBlocks = async () => { const doc = await savedDoc(); return Object.fromEntries(Object.entries(doc.blocks).filter(([k]) => /^PD_DIM_/.test(k)).map(([k, b]) => [k, readDim(k, b)])); };
  const histLine = async () => (await t('cmd-hist').textContent()).trim();
  const flyoutItems = () => page.locator('.ctxmenu .mi').evaluateAll((a) => a.map((b) => [...b.children].map((c) => c.textContent).join(' ')));
  await step('dimension types: the button\'s corner triangle opens the flyout (Aligned D, Linear DLI, Radius DRA, Diameter DDI, Angle DAN); picking Linear puts the button on it and asks for the first extension line origin', async () => {
    await openGrips(dimDoc(), 'dims.dxf');
    assert.equal(await page.locator('[data-tool=dimension]').getAttribute('title'), 'Dimension (D)');
    await t('dim-flyout').click();
    assert.deepEqual(await flyoutItems(), ['Aligned D', 'Linear DLI', 'Radius DRA', 'Diameter DDI', 'Angle DAN']);
    await page.locator('.ctxmenu .mi', { hasText: 'Linear' }).click();
    assert.equal(await page.locator('[data-tool=dimension].on').count(), 1);
    assert.equal(await page.locator('[data-tool=dimension]').getAttribute('title'), 'Dimension · Linear (DLI)', 'the button shows the type last used');
    assert.equal(await t('tool-chip').textContent(), 'Tool: Dimension');
    assert.equal(await prompt(), 'Specify first extension line origin:');
    assert.equal(await histLine(), 'Command: DIMLINEAR');
    assert.equal(await page.evaluate(() => localStorage.getItem('pd-dimtype')), 'linear', 'remembered on this PC');
    await page.keyboard.press('Escape'); await page.locator('[data-tool=select]').click();
    await page.locator('[data-tool=dimension]').click();                              // the button itself starts the tool with the last type
    assert.equal(await prompt(), 'Specify first extension line origin:');
    await typeCmd('d');                                                    // D is the Aligned dimension
    assert.equal(await page.locator('[data-tool=dimension]').getAttribute('title'), 'Dimension (D)');
    assert.match(await prompt(), /Dimension: first point/);
    await page.keyboard.press('Escape'); await page.locator('[data-tool=select]').click();
  });
  await step('dimension types: linear, the pointer decides: below the points a horizontal 120.00, to the right a vertical 80.00 (undoable, saved, read back)', async () => {
    await typeCmd('dli');
    assert.equal(await histLine(), 'Command: DIMLINEAR');
    await click(100, 100); assert.equal(await prompt(), 'Specify second extension line origin:');
    await click(220, 20); assert.match(await prompt(), /Specify dimension line location \[Horizontal\/Vertical\]:/);
    const ink0 = await accentInk();
    const low = await at(160, 5); await page.mouse.move(low.x, low.y); await page.waitForTimeout(150);
    await page.screenshot({ path: shotDir + '/s12-linear-preview-light.png' });
    await click(160, 5);
    assert.match(await prompt(), /Dimension placed: 120\.00 mm/);
    await typeCmd('dli');
    await click(100, 100); await click(220, 20); await click(270, 60);
    assert.match(await prompt(), /Dimension placed: 80\.00 mm/);
    const dims = await dimBlocks();
    assert.deepEqual(Object.keys(dims).sort(), ['PD_DIM_1', 'PD_DIM_2']);
    assert.equal(dims.PD_DIM_1.kind, 'linear'); assert.equal(dims.PD_DIM_1.params.axis, 'h');
    assert.ok(Math.abs(Math.abs(dims.PD_DIM_1.params.b[0] - dims.PD_DIM_1.params.a[0]) - 120) < 1e-6 && Math.abs(dims.PD_DIM_1.params.offset + 95) < 0.7, 'x distance, the line at y = 5, 95 below the first point: ' + JSON.stringify(dims.PD_DIM_1.params));
    assert.equal(dims.PD_DIM_2.params.axis, 'v');
    assert.ok(ink0 >= 0);
    await page.keyboard.press('Control+z');
    assert.deepEqual(Object.keys(await dimBlocks()), ['PD_DIM_1'], 'one undo takes the second one back');
    await page.keyboard.press('Control+y');
    assert.deepEqual(Object.keys(await dimBlocks()).sort(), ['PD_DIM_1', 'PD_DIM_2'], 'and redo brings it back');
    await page.keyboard.press('Control+z');                                           // (the vertical one stands in the way of the next clicks)
    await typeCmd('dli'); await click(100, 100); await click(220, 20);
    await typeCmd('h'); assert.match(await prompt(), /Linear: horizontal/);
    await click(270, 60);
    assert.match(await prompt(), /Dimension placed: 120\.00 mm/, 'H typed at the last prompt forces a horizontal line even with the pointer at the right');
    await page.keyboard.press('Control+z');
  });
  await step('dimension types: radius and diameter pick a circle or an arc (DRA R25.00, DDI Ø50.00), refuse anything else, and Esc cancels', async () => {
    await typeCmd('dra');
    assert.equal(await histLine(), 'Command: DIMRADIUS'); assert.equal(await prompt(), 'Select arc or circle:');
    await click(60, 50); assert.equal(await prompt(), 'Select an arc or a circle: click on one', 'a click on nothing');
    await click(70, 20); assert.equal(await prompt(), 'Select an arc or a circle: click on one', 'a line is not an arc');
    await click(175, 100); assert.equal(await prompt(), 'Specify dimension line location:');
    const mv = await at(200, 140); await page.mouse.move(mv.x, mv.y); await page.waitForTimeout(150);
    await page.screenshot({ path: shotDir + '/s12-radius-preview-light.png' });
    await page.keyboard.press('Escape'); assert.match(await prompt(), /Dimension cancelled\. Select arc or circle:/);
    await click(175, 100); await click(190, 150);
    assert.match(await prompt(), /Dimension placed: R25\.00 mm/);
    await typeCmd('ddi'); assert.equal(await histLine(), 'Command: DIMDIAMETER');
    await click(175, 100); await click(150, 160);
    assert.match(await prompt(), /Dimension placed: Ø50\.00 mm/);
    await typeCmd('dra'); await click(200, 170); await click(240, 190);             // the arc (200,150) r20, at its top
    assert.match(await prompt(), /Dimension placed: R20\.00 mm/);
    const dims = await dimBlocks();
    assert.equal(dims.PD_DIM_R1.kind, 'radius'); assert.ok(Math.abs(dims.PD_DIM_R1.params.r - 25) < 1e-6 && Math.abs(dims.PD_DIM_R1.params.c[0] - 150) < 1e-6);
    assert.equal(dims.PD_DIM_D1.kind, 'diameter'); assert.ok(Math.abs(Math.hypot(dims.PD_DIM_D1.params.b[0] - dims.PD_DIM_D1.params.a[0], dims.PD_DIM_D1.params.b[1] - dims.PD_DIM_D1.params.a[1]) - 50) < 1e-6);
    assert.ok(Math.abs(dims.PD_DIM_R2.params.r - 20) < 1e-6);
  });
  await step('dimension types: angle picks two lines (DAN 45.00°), refuses parallel ones, the pointer picks which of the angles; saved as an ARC and read back', async () => {
    await typeCmd('dan');
    assert.equal(await histLine(), 'Command: DIMANGULAR'); assert.equal(await prompt(), 'Select first line:');
    await click(150, 20); assert.equal(await prompt(), 'Select second line:');
    await click(150, 20); assert.match(await prompt(), /Those lines are parallel/, 'the same line twice');
    await click(60, 60); assert.equal(await prompt(), 'Specify dimension arc location:');
    const mv = await at(80, 34); await page.mouse.move(mv.x, mv.y); await page.waitForTimeout(150);
    await page.screenshot({ path: shotDir + '/s12-angle-preview-light.png' });
    await click(80, 34);
    assert.match(await prompt(), /Dimension placed: 45\.00°, on the layer Dimensions/);
    await typeCmd('dan'); await click(150, 20); await click(60, 60); await click(10, 70);       // the pointer on the far side: the 135° one
    assert.match(await prompt(), /Dimension placed: 135\.00°/);
    const dims = await dimBlocks();
    assert.equal(dims.PD_DIM_A1.kind, 'angle'); assert.ok(Math.abs(dims.PD_DIM_A1.params.a0) < 1e-6 && Math.abs(dims.PD_DIM_A1.params.a1 - 45) < 1e-6 && Math.abs(dims.PD_DIM_A1.params.v[0] - 20) < 1e-6);
    assert.ok(Math.abs(dims.PD_DIM_A2.params.a1 - dims.PD_DIM_A2.params.a0 - 135) < 1e-6 || Math.abs(dims.PD_DIM_A2.params.a1 - dims.PD_DIM_A2.params.a0 + 225) < 1e-6);
    const doc = await savedDoc();
    assert.deepEqual(doc.blocks.PD_DIM_A1.entities.map((e) => e.type), ['ARC', 'SOLID', 'SOLID', 'TEXT']);
    await page.keyboard.press('Escape');
  });
  await step('dimension types: the new dimensions are things to select; the text height, Reset and the decimals work on them; Ctrl+Z undoes; a reopened file keeps them', async () => {
    await page.locator('[data-tool=select]').click();
    await page.keyboard.press('Escape');
    await click(190, 150 + 0.1); await waitSel('1 selected');                          // the radius dimension's landing line, from (190,150) to its text
    assert.equal(await t('dim-row').isVisible(), true);
    const h0 = Number(await t('dim-height').inputValue());
    assert.equal(h0, 3.5, 'the Standard style text height');
    await t('dim-height').fill('4'); await t('dim-height').press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-testid=cmd-prompt]').textContent.includes('text height 4'));
    let dims = await dimBlocks();
    assert.equal(dims.PD_DIM_R1.params.textH, 4); assert.ok(Math.abs(dims.PD_DIM_R1.params.arrow - 2.5 * 4 / 3.5) < 1e-6, 'the arrowhead grew with the text');
    await t('dim-reset').click(); assert.match(await prompt(), /back to the style's, 3.5 mm/);
    await page.locator('[data-testid=decimals]').selectOption('0');
    const doc = await savedDoc();
    const label = (name) => { const tx = doc.blocks[name].entities.find((e) => e.type === 'TEXT'); return tx.r.v[tx.r.c.indexOf(1)].replace(/\\U\+([0-9A-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))); };
    assert.deepEqual(['PD_DIM_1', 'PD_DIM_R1', 'PD_DIM_D1', 'PD_DIM_A1'].map(label), ['120', 'R25', 'Ø50', '45°'], 'the decimals re-label every kind, keeping R, Ø and °');
    await page.locator('[data-testid=decimals]').selectOption('2');
    await page.keyboard.press('Escape');
    // Save, close and open the saved file: they are still there and still selectable
    const dl = await downloaded(() => page.keyboard.press('Control+s'));
    await closeTabs(/./);
    await t('picker').setInputFiles({ name: 'dims2.dxf', mimeType: 'text/plain', buffer: Buffer.from(dl.text, 'latin1') });
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'dims2.dxf');
    await page.locator('[data-tool=select]').click();
    await click(190, 150 + 0.1); await waitSel('1 selected');
    assert.equal(await t('dim-row').isVisible(), true, 'the reopened radius dimension is a kept dimension');
    dims = await dimBlocks();
    assert.deepEqual(Object.keys(dims).sort(), ['PD_DIM_1', 'PD_DIM_A1', 'PD_DIM_A2', 'PD_DIM_D1', 'PD_DIM_R1', 'PD_DIM_R2']);
    await page.keyboard.press('Delete'); await page.keyboard.press('Control+z');
  });
  await step('dimension types: screenshots, light and dark (all five kinds, the flyout open)', async () => {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await t('dim-flyout').click();
    await page.mouse.move(5, 5);
    await page.screenshot({ path: shotDir + '/s12-dimtypes-light.png' });
    await page.keyboard.press('Escape');
    await menuItem('View', 'Theme: dark'); await page.waitForTimeout(150);
    await t('dim-flyout').click();
    await page.screenshot({ path: shotDir + '/s12-dimtypes-dark.png' });
    await page.keyboard.press('Escape');
    await menuItem('View', 'Theme: light');
    await closeTabs(/./);
  });

  // ---- TODO 27: dimension styles (mock-up R8b, Option A): Format → Dimension style… ----
  const openStyle = async () => { await menuItem('Format', 'Dimension style…'); await t('dimstyle-dialog').waitFor(); };
  const styleFields = async () => ({ arrow: await t('ds-arrow').inputValue(), text: await t('ds-text').inputValue(), dp: await t('ds-dp').inputValue(), gap: await t('ds-gap').inputValue(),
    units: await page.locator('[data-testid^=ds-units-].on').getAttribute('data-testid'), pos: await page.locator('[data-testid^=ds-pos-].on').getAttribute('data-testid') });
  const setStyle = async (o) => {
    if (o.arrow != null) await t('ds-arrow').fill(String(o.arrow));
    if (o.text != null) await t('ds-text').fill(String(o.text));
    if (o.gap != null) await t('ds-gap').fill(String(o.gap));
    if (o.dp != null) await t('ds-dp').selectOption(String(o.dp));
    if (o.units) await t('ds-units-' + o.units).click();
    if (o.pos) await t('ds-pos-' + o.pos).click();
  };
  const dimLook = async (name) => (await dimBlocks())[name].params;
  const styleStore = () => page.evaluate(() => JSON.parse(localStorage.getItem('pd-dimstyles') || 'null'));
  await step('dimension styles: the new Format menu opens the dialog with the Standard style (arrow 2.50, text 3.50, Decimals 0.00, gap 0.80, mm, Above), a live preview and a caption', async () => {
    await openGrips(dimDoc(), 'styles.dxf');
    assert.deepEqual(await page.locator('.menubar .menu').allTextContents(), ['File', 'Edit', 'View', 'Draw', 'Modify', 'Format', 'Layout', 'Tools', 'Help']);
    await openStyle();
    assert.deepEqual(await styleFields(), { arrow: '2.50', text: '3.50', dp: '2', gap: '0.80', units: 'ds-units-mm', pos: 'ds-pos-above' });
    assert.equal(await t('ds-preset').inputValue(), 'Standard'); assert.deepEqual(await t('ds-preset').locator('option').allTextContents(), ['Standard']);
    assert.equal(await t('ds-delete').isDisabled(), true, 'Standard cannot be deleted');
    assert.equal(await t('ds-caption').textContent(), 'arrow 2.50 · text 3.50 · gap 0.80 mm');
    assert.match(await t('ds-preview').textContent(), /60\.00/);
    assert.equal(await histLine(), 'Command: DIMSTYLE   Dimension style');
    await t('ds-arrow').fill('4'); assert.equal(await t('ds-caption').textContent(), 'arrow 4.00 · text 3.50 · gap 0.80 mm', 'it redraws as you type');
    await t('ds-arrow').fill('x');
    assert.equal(await t('ds-error').textContent(), 'Arrow size: a number from 0.1 to 100 mm'); assert.equal(await t('ds-caption').textContent(), 'arrow 4.00 · text 3.50 · gap 0.80 mm', 'a half-typed number keeps the last good picture');
    await t('ds-ok').click(); assert.equal(await t('dimstyle-dialog').isVisible(), true, 'OK with a wrong field stays open');
    await t('ds-arrow').fill('2.5'); await t('ds-pos-centre').click(); await t('ds-units-inch').click(); await t('ds-dp').selectOption('3');
    assert.match(await t('ds-preview').textContent(), /2\.362"/, 'inch: 60 mm is 2.362"');
    await page.screenshot({ path: shotDir + '/s13-dimstyle-light.png' });
    await page.keyboard.press('Escape'); assert.equal(await t('dimstyle-dialog').count(), 0, 'Esc cancels');
    await openStyle();
    assert.deepEqual(await styleFields(), { arrow: '2.50', text: '3.50', dp: '2', gap: '0.80', units: 'ds-units-mm', pos: 'ds-pos-above' }, 'Cancel threw the changes away');
    await t('ds-cancel').click();
    await typeCmd('dimstyle'); await t('dimstyle-dialog').waitFor(); await page.keyboard.press('Escape');
  });
  await step('dimension styles: Save as preset… (a taken name refused), pick, Delete; presets are remembered on this PC and survive a reload of the page', async () => {
    await openStyle();
    await setStyle({ arrow: 3, text: 5, gap: 1.5, pos: 'centre' });
    await t('ds-save').click(); await t('name-input').fill('Standard'); await t('name-ok').click();
    assert.equal(await t('name-error').textContent(), 'A preset with this name already exists');
    await t('name-input').fill('Plate drawings'); await t('name-ok').click();
    assert.equal(await t('ds-preset').inputValue(), 'Plate drawings');
    assert.deepEqual(await t('ds-preset').locator('option').allTextContents(), ['Standard', 'Plate drawings']);
    assert.equal(await t('ds-delete').isDisabled(), false);
    await t('ds-preset').selectOption('Standard');
    assert.deepEqual(await styleFields(), { arrow: '2.50', text: '3.50', dp: '2', gap: '0.80', units: 'ds-units-mm', pos: 'ds-pos-above' }, 'picking a preset loads it');
    await t('ds-preset').selectOption('Plate drawings');
    assert.deepEqual(await styleFields(), { arrow: '3.00', text: '5.00', dp: '2', gap: '1.50', units: 'ds-units-mm', pos: 'ds-pos-centre' });
    await t('ds-save').click(); await t('name-input').fill('Inch jobs'); await t('name-ok').click();
    await t('ds-delete').click();
    assert.deepEqual(await t('ds-preset').locator('option').allTextContents(), ['Standard', 'Plate drawings'], 'Delete removed Inch jobs');
    assert.equal(await t('ds-preset').inputValue(), 'Standard');
    await t('ds-preset').selectOption('Plate drawings');
    await t('ds-ok').click();
    assert.match(await prompt(), /Dimension style Plate drawings\. New dimensions use it/);
    const st = await styleStore(); assert.equal(st.cur, 'Plate drawings'); assert.deepEqual(Object.keys(st.presets), ['Standard', 'Plate drawings']);
    await page.reload(); await page.waitForSelector('[data-testid=count]', { state: 'attached' });
    await openStyle(); assert.equal(await t('ds-preset').inputValue(), 'Plate drawings', 'the current style is remembered');
    assert.equal((await styleFields()).text, '5.00');
    await t('ds-cancel').click();
  });
  await step('dimension styles: new dimensions get the style (text height, arrow, gap, centred text breaking the line), also from Keep; a saved file reads back the same', async () => {
    await openGrips(dimDoc(), 'styles2.dxf');
    await typeCmd('d'); await click(100, 100); await click(220, 20); await click(180, 90);
    assert.match(await prompt(), /Dimension placed: 144\.22 mm/);
    let p = await dimLook('PD_DIM_1');
    assert.ok(Math.abs(p.textH - 5) < 1e-5 && Math.abs(p.arrow - 3) < 1e-5 && Math.abs(p.gap - 1.5) < 1e-5 && p.pos === 'centre' && p.units === 'mm', JSON.stringify(p));
    const doc = await savedDoc();
    assert.equal(doc.blocks.PD_DIM_1.entities.filter((e) => e.type === 'LINE').length, 4, 'the centred text broke the dimension line: two halves and two extension lines');
    await typeCmd('dra'); await click(150, 75); await click(200, 150);
    p = await dimLook('PD_DIM_R1'); assert.ok(Math.abs(p.textH - 5) < 1e-5 && Math.abs(p.arrow - 3) < 1e-5, 'a radius takes the text height and arrow');
    await page.keyboard.press('Escape'); await page.locator('[data-tool=select]').click();
    await page.keyboard.press('Escape');
  });
  await step('dimension styles: OK also restyles the selected dimensions (one undo step "Dimension style"); inch and Decimals 0.000 change the text; Cancel leaves them', async () => {
    await click(145, 113.3); await waitSel('1 selected');                    // the first dimension's line, off its centred text
    assert.equal(await t('dim-height').inputValue(), '5');
    await openStyle(); await t('ds-preset').selectOption('Standard');
    await t('ds-cancel').click();
    assert.equal(await t('dim-height').inputValue(), '5', 'Cancel changed nothing');
    await openStyle(); await t('ds-preset').selectOption('Standard'); await setStyle({ units: 'inch', dp: 3 }); await t('ds-ok').click();
    assert.match(await prompt(), /Dimension style Standard: 1 selected dimension restyled/);
    const dl = await downloaded(() => page.keyboard.press('Control+s')), doc = readDxf(dl.text);
    const lab = (name) => { const tx = doc.blocks[name].entities.find((e) => e.type === 'TEXT'); return tx.r.v[tx.r.c.indexOf(1)]; };
    assert.equal(lab('PD_DIM_1'), '5.678"', 'inch, 3 decimals'); assert.equal(await t('decimals').inputValue(), '3');
    assert.equal(lab('PD_DIM_R1'), 'R25.000', 'Decimals is a drawing-wide setting: every dimension is re-labelled');
    const p = readDim('PD_DIM_1', doc.blocks.PD_DIM_1).params;
    assert.ok(Math.abs(p.textH - 3.5) < 1e-5 && Math.abs(p.arrow - 2.5) < 1e-5 && Math.abs(p.gap - 0.8) < 1e-5 && p.pos === 'above' && p.units === 'inch', 'the Standard look: ' + JSON.stringify(p));
    const near2 = readDim('PD_DIM_R1', doc.blocks.PD_DIM_R1).params; assert.ok(Math.abs(near2.textH - 5) < 1e-5, 'the one that was not selected keeps its look');
    await page.keyboard.press('Control+z'); assert.equal((await dimLook('PD_DIM_1')).units, 'inch', 'the first undo takes the decimals back');
    await page.keyboard.press('Control+z'); assert.equal((await dimLook('PD_DIM_1')).units, 'mm', 'the second takes the restyle back (one step)');
    await page.keyboard.press('Control+y'); await page.keyboard.press('Control+y');
    // reopen the saved file: the dimension keeps its look whatever style this PC has now
    await closeTabs(/./);
    await t('picker').setInputFiles({ name: 'styles3.dxf', mimeType: 'text/plain', buffer: Buffer.from(dl.text, 'latin1') });
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'styles3.dxf');
    await page.locator('[data-tool=select]').click();
    await click(145, 113.3); await waitSel('1 selected');
    assert.equal(await t('dim-height').inputValue(), '3.5');
    assert.equal(await t('decimals').inputValue(), '3', 'the status bar setting is the PC\'s, not the file\'s');
    await t('decimals').selectOption('2');
    await openStyle(); await t('ds-preset').selectOption('Standard'); await t('ds-ok').click();
    await page.screenshot({ path: shotDir + '/s13-dimstyle-applied-light.png' });
    await menuItem('View', 'Theme: dark'); await page.waitForTimeout(150);
    await openStyle(); await t('ds-pos-centre').click();
    await page.screenshot({ path: shotDir + '/s13-dimstyle-dark.png' });
    await t('ds-cancel').click();
    await page.screenshot({ path: shotDir + '/s13-dimstyle-applied-dark.png' });
    await menuItem('View', 'Theme: light');
    await closeTabs(/./);
  });

  // ---- TODO 28: leaders (mock-up R8c): a note with an arrow ----
  const ldrBlocks = async () => { const doc = await savedDoc(); return { doc, list: Object.entries(doc.blocks).filter(([k]) => /^PD_LDR_/.test(k)).map(([k, b]) => ({ name: k, model: readLeader(k, b), types: b.entities.map((e) => e.type) })) }; };
  const typeNote = async (text) => { await t('text-editor').waitFor(); await t('text-editor').fill(text); await page.keyboard.press('Enter'); };
  await step('leader: the rail has a Leader button; the tool asks for the arrowhead, the next point, then Enter or a third point, then the note typed in place (Enter finishes)', async () => {
    await openGrips(dimDoc(), 'leaders.dxf');
    assert.equal(await page.locator('[data-tool=leader]').getAttribute('title'), 'Leader (LE)');
    assert.deepEqual(await page.locator('.rail .tool').evaluateAll((a) => a.map((b) => b.dataset.tool).filter((x) => ['text', 'dimension', 'leader', 'offset'].includes(x))), ['text', 'dimension', 'leader', 'offset'], 'beside Dimension');
    await page.locator('[data-tool=leader]').click();
    assert.equal(await t('tool-chip').textContent(), 'Tool: Leader'); assert.equal(await histLine(), 'Command: LEADER'); assert.equal(await prompt(), 'Specify leader arrowhead location:');
    const n0 = Number((await t('entities').textContent()).replace(/\D/g, ''));
    await click(100, 100); assert.equal(await prompt(), 'Specify next point:');
    await click(60, 150); assert.equal(await prompt(), 'Specify next point, or Enter to type the note:');
    const mv = await at(30, 170); await page.mouse.move(mv.x, mv.y); await page.waitForTimeout(150);
    await page.screenshot({ path: shotDir + '/s14-leader-preview-light.png' });
    await page.keyboard.press('Enter');                                             // two points are enough
    await t('text-editor').waitFor(); assert.equal(await t('text-edit-box').isVisible(), true);
    await page.screenshot({ path: shotDir + '/s14-leader-typing-light.png' });
    await typeNote('DEBURR');
    assert.match(await prompt(), /Leader placed on the layer Dimensions: DEBURR/);
    assert.equal(Number((await t('entities').textContent()).replace(/\D/g, '')), n0 + 1, 'one new thing');
    let r = await ldrBlocks(), L = r.list[0];
    assert.equal(r.list.length, 1); assert.deepEqual(L.types, ['LINE', 'SOLID', 'TEXT']);
    assert.ok(Math.abs(L.model.pts[0][0] - 100) < 1e-5 && Math.abs(L.model.pts[0][1] - 100) < 1e-5, 'the arrowhead is exactly on the line end it snapped to: ' + L.model.pts[0]);
    assert.ok(Math.abs(L.model.pts[1][0] - 60) < 1 && Math.abs(L.model.pts[1][1] - 150) < 1, 'the next point: ' + L.model.pts[1]);
    assert.deepEqual(L.model.lines, ['DEBURR']); assert.ok(Math.abs(L.model.textH - 3.5) < 1e-5 && Math.abs(L.model.arrow - 2.5) < 1e-5, 'text height and arrow from the dimension style');
    const tx = r.doc.blocks.PD_LDR_1.entities.find((e) => e.type === 'TEXT'); assert.equal(fieldOf(tx, 72), 2, 'the last segment goes left: the note lands left (right-aligned)');
    assert.equal(r.doc.entities.filter((e) => e.layer === 'Dimensions').length, 1, 'on the Dimensions layer');
    // a second segment: the third click opens the note; it lands right
    await click(220, 20); await click(235, 50); await click(255, 50);
    await typeNote('Ø25.00 THRU');
    assert.match(await prompt(), /Leader placed on the layer Dimensions: Ø25\.00 THRU/);
    r = await ldrBlocks(); L = r.list[1];
    assert.deepEqual(L.types, ['LINE', 'LINE', 'SOLID', 'TEXT']); assert.deepEqual(L.model.lines, ['Ø25.00 THRU']); assert.equal(L.model.pts.length, 3);
    assert.equal(fieldOf(r.doc.blocks.PD_LDR_2.entities.find((e) => e.type === 'TEXT'), 72) || 0, 0, 'lands right: left aligned');
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    assert.equal((await ldrBlocks()).list.length, 0, 'undo takes them back one at a time');
    await page.keyboard.press('Control+y'); await page.keyboard.press('Control+y');
    assert.equal((await ldrBlocks()).list.length, 2);
  });
  await step('leader: Esc cancels (the points, or the note being typed); nothing typed makes nothing; the same point twice is refused; Esc with nothing in progress goes back to Select', async () => {
    await page.locator('[data-tool=leader]').click();
    await click(100, 100); await page.keyboard.press('Escape'); assert.match(await prompt(), /Leader cancelled\. Specify leader arrowhead location:/);
    await click(100, 100); await click(100, 100); assert.match(await prompt(), /same point again/);
    await click(60, 150); await page.keyboard.press('Enter'); await t('text-editor').waitFor();
    await page.keyboard.press('Enter');                                              // nothing typed
    assert.match(await prompt(), /Leader: nothing typed, so nothing was made/);
    await click(100, 100); await click(60, 150); await page.keyboard.press('Enter'); await t('text-editor').waitFor(); await t('text-editor').fill('NOT KEPT'); await page.keyboard.press('Escape');
    assert.match(await prompt(), /Leader cancelled/); assert.equal((await ldrBlocks()).list.length, 2, 'Esc in the note cancels the whole leader');
    await page.keyboard.press('Escape'); assert.equal(await page.locator('[data-tool=select].on').count(), 1, 'Esc with nothing in progress: back to Select');
    await typeCmd('le'); assert.equal(await page.locator('[data-tool=leader].on').count(), 1, 'LE in the command line'); await page.keyboard.press('Escape');
  });
  await step('leader: a selected leader shows a grip at each point (drag one: the note follows the end), the Leader section (note, text height, arrow size, style), double-click edits the note, Delete', async () => {
    await page.locator('[data-tool=select]').click(); await page.keyboard.press('Escape');
    await click(80, 125); await waitSel('1 selected');                                // the first leader's line, half way
    assert.equal(await t('ldr-row').isVisible(), true); assert.equal(await t('dim-row').isVisible(), false);
    assert.equal(await t('ldr-note').inputValue(), 'DEBURR'); assert.equal(await t('ldr-height').inputValue(), '3.5'); assert.equal(await t('ldr-arrow').inputValue(), '2.5');
    assert.equal(await t('ldr-style').textContent(), 'Style: Standard. Note lands left.');
    await gripWhen(2);
    await page.screenshot({ path: shotDir + '/s14-leader-selected-light.png' });
    await dragGripTo('4:v1', 30, 140); await frames();
    let r = await ldrBlocks(), L = r.list.find((x) => x.name === 'PD_LDR_1');
    assert.ok(Math.abs(L.model.pts[1][0] - 30) < 1 && Math.abs(L.model.pts[1][1] - 140) < 1 && Math.abs(L.model.pts[0][0] - 100) < 1e-5, 'the end moved, the arrowhead did not');
    const tx = r.doc.blocks.PD_LDR_1.entities.find((e) => e.type === 'TEXT'); assert.ok(fieldOf(tx, 11) < 30, 'the note went with the end');
    assert.equal(await t('sel-count').textContent(), '1 selected', 'still selected');
    await dragGripTo('4:v0', 110, 110); await frames();
    L = (await ldrBlocks()).list.find((x) => x.name === 'PD_LDR_1'); assert.ok(Math.abs(L.model.pts[0][0] - 110) < 1, 'the arrowhead moved');
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    L = (await ldrBlocks()).list.find((x) => x.name === 'PD_LDR_1'); assert.ok(Math.abs(L.model.pts[0][0] - 100) < 1e-5 && Math.abs(L.model.pts[1][0] - 60) < 1, 'each drag is one undo step');
    await click(80, 125); await waitSel('1 selected');
    await t('ldr-note').fill('BURR OFF'); await t('ldr-note').press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-testid=cmd-prompt]').textContent.includes('Leader note'));
    await t('ldr-height').fill('5'); await t('ldr-height').press('Enter');
    await t('ldr-arrow').fill('3'); await t('ldr-arrow').press('Enter');
    L = (await ldrBlocks()).list.find((x) => x.name === 'PD_LDR_1');
    assert.deepEqual(L.model.lines, ['BURR OFF']); assert.ok(Math.abs(L.model.textH - 5) < 1e-5 && Math.abs(L.model.arrow - 3) < 1e-5);
    await t('ldr-note').fill('  '); await t('ldr-note').press('Enter'); assert.match(await prompt(), /A leader needs a note/);
    assert.equal(await t('ldr-note').inputValue(), 'BURR OFF', 'and it snaps back');
    await t('ldr-height').fill('0'); await t('ldr-height').press('Enter'); assert.match(await prompt(), /Type the text height in mm/);
    // double-click: the note is typed in place
    const p = await at(80, 125); await page.mouse.dblclick(p.x, p.y);
    await t('text-editor').waitFor(); assert.equal(await t('text-editor').inputValue(), 'BURR OFF');
    await t('text-editor').fill('DEBURR ALL'); await page.keyboard.press('Enter');
    assert.match(await prompt(), /Leader note changed/); assert.deepEqual((await ldrBlocks()).list.find((x) => x.name === 'PD_LDR_1').model.lines, ['DEBURR ALL']);
    await page.keyboard.press('Delete'); assert.equal((await ldrBlocks()).list.length, 1, 'Delete removes the whole leader');
    await page.keyboard.press('Control+z'); assert.equal((await ldrBlocks()).list.length, 2);
  });
  await step('leader: Format → Dimension style… restyles a selected leader (text height, arrow); a saved file reopens it, selectable and editable', async () => {
    await click(80, 125); await waitSel('1 selected');
    await openStyle(); await setStyle({ text: 2, arrow: 1 }); await t('ds-ok').click();
    assert.match(await prompt(), /1 selected dimension restyled/);
    let L = (await ldrBlocks()).list.find((x) => x.name === 'PD_LDR_1'); assert.ok(Math.abs(L.model.textH - 2) < 1e-5 && Math.abs(L.model.arrow - 1) < 1e-5, 'the leader took the style');
    await openStyle(); await setStyle({ text: 3.5, arrow: 2.5 }); await t('ds-ok').click();                    // the Standard style back, and the leader with it
    const dl = await downloaded(() => page.keyboard.press('Control+s'));
    await closeTabs(/./);
    await t('picker').setInputFiles({ name: 'leaders2.dxf', mimeType: 'text/plain', buffer: Buffer.from(dl.text, 'latin1') });
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'leaders2.dxf');
    await page.locator('[data-tool=select]').click();
    await click(80, 125); await waitSel('1 selected');
    assert.equal(await t('ldr-row').isVisible(), true, 'the reopened leader is a leader'); assert.equal(await t('ldr-note').inputValue(), 'DEBURR ALL'); assert.equal(await t('ldr-height').inputValue(), '3.5');
    await page.keyboard.press('Escape');
    await menuItem('View', 'Theme: dark'); await page.waitForTimeout(150);
    await click(80, 125); await waitSel('1 selected'); await gripWhen(2);
    await page.screenshot({ path: shotDir + '/s14-leader-selected-dark.png' });
    await menuItem('View', 'Theme: light');
    await closeTabs(/./);
  });

  // ---- TODO 29: inspection balloons (mock-ups R9a and R9c Option B): by hand on a vector PDF, a two-page one, and a picture-only page ----
  const balPdf = () => {
    const pgs = [];
    for (const txt of [[['120.0 ±0.1', 70, 12], ['Ø25', 95, 60], ['R8', 30, 90]], [['M6 6H', 60, 60]]]) {
      const p = new Page(200, 120); p.lineWidth(0.3); p.rect(20, 20, 160, 80); p.stroke();
      for (const [s, x, y] of txt) p.text([5, 0, 0, 5, x, y], winAnsi(s));
      pgs.push(p);
    }
    return Buffer.from(writePdf(pgs));
  };
  const balNums = async () => { await frames(); return page.locator('[data-testid=balloon] .bal-n').allTextContents(); };
  const balRows = () => page.locator('[data-testid=bal-row]').evaluateAll((r) => r.map((x) => [...x.children].map((c) => c.textContent)));
  const balOpen = async (extra = [], toSelect = true) => {
    await closeTabs(/./);
    await t('picker').setInputFiles([{ name: 'insp.pdf', mimeType: 'application/pdf', buffer: balPdf() }, ...extra]);
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').textContent.startsWith('insp.dxf'), null, { timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('[data-testid=gap-count]') && document.querySelector('[data-testid=gap-count]').textContent !== '…');
    if (toSelect) await page.locator('[data-tool=select]').click();
  };
  const balPlace = async (tip, c) => { await click(...tip); await click(...c); };
  const balGrip = async (which) => { await frames(); return page.evaluate((w) => { const r = document.querySelector(`[data-bal-grip="${w}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, which); };
  const downloadsUtf8 = async (action, n) => {
    const got = [], on = (dl) => got.push(dl);
    page.on('download', on);
    try { await action(); const end = Date.now() + 8000; while (got.length < n && Date.now() < end) await page.waitForTimeout(40); await page.waitForTimeout(150); } finally { page.off('download', on); }
    return Promise.all(got.map(async (dl) => ({ name: dl.suggestedFilename(), text: readFileSync(await dl.path(), 'utf8') })));
  };
  let balJson = null;

  await step('balloons: the Balloon tool (B) sits beside Leader; two clicks make a balloon, the next number goes up by itself, a number typed at the command line restarts the count', async () => {
    await balOpen();
    assert.equal(await page.locator('[data-tool=balloon]').getAttribute('title'), 'Balloon (B)');
    assert.deepEqual(await page.locator('.rail .tool').evaluateAll((a) => a.map((b) => b.dataset.tool).filter((x) => ['dimension', 'leader', 'balloon', 'offset'].includes(x))), ['dimension', 'leader', 'balloon', 'offset']);
    assert.equal(await t('bal-dock').isVisible(), false, 'no table while there is no balloon and the tool is off');
    await typeCmd('b'); await page.waitForTimeout(200); await frames();                 // the table opens and the canvas is fitted again
    assert.equal(await t('tool-chip').textContent(), 'Tool: Balloon'); assert.equal(await histLine(), 'Command: BALLOON   next no. 1');
    assert.equal(await prompt(), 'Click the feature to balloon:');
    assert.equal(await t('bal-dock').isVisible(), true, 'the table shows while the tool is on'); assert.equal(await t('bal-count').textContent(), '0');
    assert.equal(await t('bal-picture-only').isVisible(), false, 'this page has text');
    await click(101, 62); assert.equal(await prompt(), 'Click where the balloon sits:');
    await page.mouse.move(...Object.values(await at(130, 80))); await frames();
    assert.equal(await page.locator('[data-testid=balloon-ghost]').count(), 1, 'a dashed ghost follows the pointer');
    await page.screenshot({ path: shotDir + '/s15-balloon-placing-light.png' });
    await click(130, 80);
    assert.deepEqual(await balNums(), ['1']); assert.match(await prompt(), /Balloon 1 placed \(sheet 1\)\. Click the feature to balloon:/);
    await balPlace([75, 13], [75, 35]); await balPlace([33, 91], [55, 105]);
    assert.deepEqual(await balNums(), ['1', '2', '3']); assert.equal(await t('bal-next').inputValue(), '4');
    await typeCmd('10'); assert.equal(await histLine(), 'Command: BALLOON   next no. 10'); assert.equal(await t('bal-next').inputValue(), '10');
    await balPlace([150, 30], [165, 50]);
    assert.deepEqual(await balNums(), ['1', '2', '3', '10']); assert.equal(await t('bal-next').inputValue(), '11');
    await click(101, 62); await page.keyboard.press('Escape'); assert.match(await prompt(), /Balloon cancelled/);
    assert.deepEqual(await balNums(), ['1', '2', '3', '10'], 'Esc with the arrow tip placed drops it');
    await page.keyboard.press('Escape'); assert.equal(await page.locator('[data-tool=select].on').count(), 1, 'Esc with nothing in progress: back to Select');
    await typeCmd('b'); assert.equal(await page.locator('[data-tool=balloon].on').count(), 1, 'B at the command line'); await page.locator('[data-tool=select]').click();
    assert.equal(await t('bal-dock').isVisible(), true, 'the table stays while the drawing has balloons');
    assert.equal(await t('bal-count').textContent(), '4');
  });

  await step('balloons: Renumber numbers 1…n in sheet order, then placement order, as one undo step; every change is a labelled step', async () => {
    await page.locator('[data-tool=balloon]').click();
    await typeCmd('2'); await balPlace([100, 40], [110, 20]);                                  // a fifth, numbered 2 again
    assert.deepEqual(await balNums(), ['1', '2', '3', '10', '2']);
    await t('bal-renumber').click();
    assert.deepEqual(await balNums(), ['1', '2', '3', '4', '5']); assert.equal(await t('bal-next').inputValue(), '6');
    assert.deepEqual((await balRows()).map((r) => r[0]), ['1', '2', '3', '4', '5']);
    await page.locator('[data-tool=select]').click();
    await page.keyboard.press('Control+z');
    assert.deepEqual(await balNums(), ['1', '2', '3', '10', '2'], 'one Ctrl+Z undoes the whole Renumber'); assert.equal(await t('bal-next').inputValue(), '3');
    await page.keyboard.press('Control+y');
    assert.deepEqual(await balNums(), ['1', '2', '3', '4', '5']);
    await menuItem('Edit', 'Undo history…');
    const rows = await page.locator('[data-testid=hist-row] > span:last-child').allTextContents();
    assert.ok(rows.includes('Add balloon 1') && rows.includes('Renumber balloons') && rows.includes('Next balloon number 10'), rows.join(' | '));
    await page.locator('[data-testid=hist-close]').click();
  });

  await step('balloons: a selected balloon shows grips (centre, tip) and its row lights; the fields are typed, Pick from text fills the dimension from the PDF text under the arrow; a drag of a grip is one labelled step; Delete keeps the other numbers', async () => {
    await click(75, 35); await page.waitForFunction(() => document.querySelector('[data-testid=bal-panel]') && !document.querySelector('[data-testid=bal-panel]').hidden);
    assert.equal(await t('bal-chip').textContent(), 'Balloon 2'); assert.equal(await page.locator('[data-testid=bal-grip]').count(), 2);
    assert.deepEqual(await page.locator('[data-testid=bal-row].hi').evaluateAll((r) => r.map((x) => x.dataset.n)), ['2']);
    assert.equal(await t('bal-pick').getAttribute('aria-disabled'), 'false');
    await t('bal-pick').click();
    assert.equal(await t('bal-dim').inputValue(), '120.0 ±0.1'); assert.match(await prompt(), /dimension "120\.0 ±0\.1" taken from the text under the arrow/);
    await t('bal-tp').fill('+0.1'); await t('bal-tp').press('Enter');
    await t('bal-tm').fill('-0.1'); await t('bal-tm').press('Enter');
    await t('bal-note').fill('Overall <b>length</b>'); await t('bal-note').press('Enter');
    const row2 = (await balRows()).find((r) => r[0] === '2');
    assert.deepEqual(row2, ['2', '120.0 ±0.1', '+0.1', '-0.1', '1', 'Overall <b>length</b>']);
    assert.equal(await page.locator('[data-testid=bal-row] b').count(), 0, 'cells are text, never markup');
    await t('bal-n').fill('x'); await t('bal-n').press('Enter'); assert.match(await prompt(), /whole number from 1/); assert.equal(await t('bal-n').inputValue(), '2');
    // the grips: the centre moves the circle, the tip the arrow; each drag one step
    const before = await page.locator('[data-testid=balloon][data-bal] .bal-c').nth(1).getAttribute('cx');
    let a = await balGrip('c'), b = await at(95, 45);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 3 }); await page.mouse.move(b.x, b.y, { steps: 3 }); await page.mouse.up();
    await frames();
    assert.notEqual(await page.locator('[data-testid=balloon] .bal-c').nth(1).getAttribute('cx'), before, 'the circle moved');
    a = await balGrip('tip'); b = await at(80, 14);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
    await menuItem('Edit', 'Undo history…');
    const rows = await page.locator('[data-testid=hist-row] > span:last-child').allTextContents();
    assert.deepEqual(rows.slice(-2), ['Move balloon', 'Move balloon arrow'], rows.join(' | '));
    await page.locator('[data-testid=hist-close]').click();
    await page.screenshot({ path: shotDir + '/s15-balloons-selected-light.png' });
    await menuItem('View', 'Theme: dark'); await page.waitForTimeout(150);
    await page.screenshot({ path: shotDir + '/s15-balloons-selected-dark.png' });
    await menuItem('View', 'Theme: light');
    await page.keyboard.press('Delete');
    assert.deepEqual(await balNums(), ['1', '3', '4', '5'], 'the others keep their numbers'); assert.match(await prompt(), /Balloon 2 deleted/);
    await page.keyboard.press('Control+z'); assert.deepEqual(await balNums(), ['1', '2', '3', '4', '5']);
    await click(95, 45); await t('bal-dim').waitFor();
    const p = await at(95, 45); await page.mouse.dblclick(p.x, p.y); assert.equal(await page.evaluate(() => document.activeElement.dataset.testid), 'bal-n', 'double-click: the number is typed in the panel');
  });

  await step('balloons: the table is docked above the command line, resizes, collapses; a row zooms to its balloon; Export CSV and Export Excel write the rows', async () => {
    const dock = t('bal-dock'), h0 = (await dock.boundingBox()).height, cmd = await page.locator('.status').boundingBox(), box0 = await dock.boundingBox();
    assert.ok(Math.abs(box0.y + box0.height - cmd.y) < 2, 'it sits right above the status bar (the command bar floats on the canvas now)');
    const hb = await t('bal-drag').boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + 4); await page.mouse.down(); await page.mouse.move(hb.x + hb.width / 2, hb.y - 76, { steps: 4 }); await page.mouse.up();
    assert.ok((await dock.boundingBox()).height > h0 + 50, 'dragging the bar up makes it taller');
    await t('bal-collapse').click();
    assert.ok((await dock.boundingBox()).height < 60, 'collapsed: only the header'); assert.equal(await page.locator('.balscroll').isVisible(), false);
    await t('bal-collapse').click(); assert.equal(await page.locator('.balscroll').isVisible(), true);
    // a row zooms to its balloon
    const before = await page.evaluate(() => document.querySelector('[data-testid=zoom]').textContent);
    await page.locator('[data-testid=bal-row][data-n="3"]').click();
    assert.notEqual(await page.evaluate(() => document.querySelector('[data-testid=zoom]').textContent), before, 'zoomed');
    assert.deepEqual(await page.locator('[data-testid=bal-row].hi').evaluateAll((r) => r.map((x) => x.dataset.n)), ['3']);
    assert.equal(await t('bal-chip').textContent(), 'Balloon 3');
    // the files
    const csv = (await downloadsUtf8(() => t('bal-csv').click(), 1))[0];
    assert.equal(csv.name, 'insp-balloons.csv');
    assert.equal(csv.text.split('\r\n')[0], 'No.,Dimension,Tol +,Tol -,Sheet,Note'); assert.ok(csv.text.includes('2,120.0 ±0.1,+0.1,-0.1,1,Overall <b>length</b>\r\n'), csv.text);
    assert.equal(csv.text.split('\r\n').length, 7, 'header, five balloons, and the end');
    const xl = (await downloadsUtf8(() => t('bal-excel').click(), 1))[0];
    assert.equal(xl.name, 'insp-balloons-excel.csv'); assert.equal(xl.text.charCodeAt(0), 0xfeff, 'a byte order mark, so Excel reads Ø and ±'); assert.equal(xl.text.slice(1), csv.text);
  });

  await step('balloons: a two-page PDF has a sheet switcher; numbering carries on across sheets; the table filters by sheet and a row on another sheet goes there', async () => {
    assert.equal(await t('bal-sheets').isVisible(), true); assert.match(await t('bal-sheets').textContent(), /insp\.pdf · 2 pages/);
    assert.equal(await t('sheet-chip').textContent(), 'Sheet 1 / 2');
    await page.locator('[data-sheet="2"]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=sheet-chip]').textContent === 'Sheet 2 / 2');
    assert.match(await prompt(), /Sheet 2 of 2/); assert.deepEqual(await balNums(), [], 'the balloons of sheet 1 are not drawn on sheet 2');
    await page.locator('[data-tool=balloon]').click();
    await balPlace([61, 62], [80, 80]);
    assert.deepEqual(await balNums(), ['6'], 'sheet 2 carries on after the last number of sheet 1');
    assert.equal((await balRows()).length, 6); assert.deepEqual((await balRows()).at(-1).slice(0, 5), ['6', '', '', '', '2']);
    await t('bal-filter').selectOption('2'); assert.deepEqual((await balRows()).map((r) => r[0]), ['6']);
    await t('bal-filter').selectOption('all');
    await page.locator('[data-tool=select]').click();
    await page.locator('[data-testid=bal-row][data-n="4"]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=sheet-chip]').textContent === 'Sheet 1 / 2');
    assert.equal(await t('bal-chip').textContent(), 'Balloon 4', 'the row went to its sheet and picked the balloon');
  });

  await step('balloons: Save writes <name>.pdballoons.json next to the drawing (here a download), and opening the PDF with it brings the balloons and the table back', async () => {
    const dls = await downloadsUtf8(() => page.keyboard.press('Control+s'), 2);
    assert.deepEqual(dls.map((x) => x.name).sort(), ['insp.dxf', 'insp.pdballoons.json']);
    balJson = dls.find((x) => x.name === 'insp.pdballoons.json').text;
    const file = JSON.parse(balJson);
    assert.equal(file.kind, 'project-d-balloons'); assert.equal(file.pages, 2); assert.equal(file.items.length, 6); assert.equal(file.items.find((i) => i.n === 2).dim, '120.0 ±0.1');
    assert.deepEqual(file.items.map((i) => i.sheet), [1, 1, 1, 1, 1, 2]);
    await balOpen([{ name: 'insp.pdballoons.json', mimeType: 'application/json', buffer: Buffer.from(balJson, 'utf8') }], false);
    await page.waitForFunction(() => document.querySelector('[data-testid=bal-count]') && document.querySelector('[data-testid=bal-count]').textContent === '6');
    assert.match(await prompt(), /insp\.pdballoons\.json: 6 balloons/);
    assert.deepEqual(await balNums(), ['1', '2', '3', '4', '5'], 'sheet 1 drawn');
    assert.deepEqual((await balRows()).find((r) => r[0] === '2'), ['2', '120.0 ±0.1', '+0.1', '-0.1', '1', 'Overall <b>length</b>']);
    assert.equal(await t('bal-next').inputValue(), '7');
    // a damaged file says so and changes nothing
    await balOpen([{ name: 'insp.pdballoons.json', mimeType: 'application/json', buffer: Buffer.from('{"kind":"other"}') }], false);
    assert.match(await prompt(), /not a Project D balloons file/); assert.equal(await t('bal-dock').isVisible(), false);
  });

  await step('balloons: a picture-only page (no text) takes balloons by eye; Pick from text is greyed; Save writes the balloons alone; the status bar and panel fit at 1024 px', async () => {
    await closeTabs(/./);
    page.once('dialog', (dlg) => dlg.accept());
    await t('picker').setInputFiles('fixtures/text-only.pdf');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').textContent.startsWith('text-only.pdf'), null, { timeout: 60000 });
    await page.locator('[data-tool=balloon]').click();
    assert.equal(await t('bal-picture-only').isVisible(), true);
    // a picture tab's sheet is sized to the page: the scale is read from its height
    const pic = async (x, y) => { const b = await page.locator('rect.sheet').boundingBox(), sc = b.height / Number(await page.locator('[data-key=sheetH]').inputValue()); await page.mouse.click(b.x + x * sc, b.y + b.height - y * sc); };
    await pic(50, 50); await pic(90, 80);
    assert.deepEqual(await balNums(), ['1']);
    await page.locator('[data-tool=select]').click();
    const bb = await page.locator('[data-testid=balloon] .bal-c').first().boundingBox(); await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    assert.equal(await t('bal-pick').getAttribute('aria-disabled'), 'true');
    await t('bal-pick').click({ force: true }); assert.match(await prompt(), /this page has no text \(it is a picture\)/); assert.equal(await t('bal-dim').inputValue(), '');
    await t('bal-dim').fill('42'); await t('bal-dim').press('Enter');
    assert.equal(await t('bal-sheets').isVisible(), false, 'one page: no switcher');
    const dls = await downloadsUtf8(() => page.keyboard.press('Control+s'), 1);
    assert.deepEqual(dls.map((x) => x.name), ['text-only.pdballoons.json']); assert.equal(JSON.parse(dls[0].text).items[0].dim, '42');
    await page.screenshot({ path: shotDir + '/s15-balloons-picture-light.png' });
    await menuItem('View', 'Theme: dark'); await page.waitForTimeout(150);
    await page.screenshot({ path: shotDir + '/s15-balloons-picture-dark.png' });
    await menuItem('View', 'Theme: light');
    await balOpen(); await page.setViewportSize({ width: 1024, height: 700 }); await page.waitForTimeout(250);
    const rail = await page.locator('nav.rail').evaluate((n) => ({ scrolls: n.scrollHeight > n.clientHeight + 1 }));
    assert.equal(rail.scrolls, false, 'the rail with the Balloon button fits at 700 px high (the table is not open yet)');
    await page.locator('[data-tool=balloon]').click(); await balPlace([101, 62], [130, 80]);
    const fit = await page.evaluate(() => { const s = document.querySelector('.status'); return s.scrollWidth <= s.clientWidth + 1; });
    assert.equal(fit, true, 'the status bar fits with the sheet chip');
    await page.screenshot({ path: shotDir + '/s15-balloons-1024-light.png' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await closeTabs(/./);
  });

  await step('screenshots with the sample open, light and dark', async () => {
    const dir = process.env.SHOTS_DIR || 'shots';
    mkdirSync(dir, { recursive: true });
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await page.screenshot({ path: dir + '/s2-light.png' });
    await page.locator('[data-menu=View]').click();
    await page.getByRole('menuitemcheckbox', { name: new RegExp('Theme: dark' + '$') }).click();
    await page.waitForTimeout(100);
    await page.screenshot({ path: dir + '/s2-dark.png' });
    await page.locator('[data-menu=View]').click();
    await page.getByRole('menuitemcheckbox', { name: new RegExp('Theme: light' + '$') }).click();
  });

  // ---- Next sessions 6: Offset, Trim and Mirror (modify.js) ----
  const modDoc = () => {
    const doc = newDoc(4);
    addEntities(doc, dxfLine(20, 30, 120, 30, { layer: 'Cut' }), dxfCircle(170, 100, 20, { layer: 'Cut' }), roundRect(250, 20, 100, 60, 8, { layer: 'Cut' }));
    return writeDxf(doc);
  };
  const layerOf = (e) => e.r.v[e.r.c.indexOf(8)];
  await step('Offset, Trim and Mirror: built (their buttons are not greyed, titles with keys); Auto-nest is built too; none works on a layout tab', async () => {
    await openGrips(modDoc(), 'mod.dxf');
    const titles = {};
    for (const id of ['offset', 'trim', 'mirror']) { const b = page.locator('[data-tool=' + id + ']'); assert.equal(await b.getAttribute('aria-disabled'), null, id + ' is built'); titles[id] = await b.getAttribute('title'); }
    assert.deepEqual(titles, { offset: 'Offset (O)', trim: 'Trim (TR)', mirror: 'Mirror (MI)' });
    assert.equal(await page.locator('[data-tool=nest]').getAttribute('aria-disabled'), null, 'Auto-nest is built');
    await page.locator('nav.rail').screenshot({ path: `${shotDir}/s12-toolbar-light.png` });
    await menuItem('View', 'Theme: dark'); await page.waitForTimeout(300);
    await page.locator('nav.rail').screenshot({ path: `${shotDir}/s12-toolbar-dark.png` });
    await menuItem('View', 'Theme: light'); await page.waitForTimeout(100);
    await t('new-layout').click();
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').dataset.kind === 'layout');
    await page.locator('[data-tool=trim]').click();
    assert.match(await prompt(), /^Trim works on a drawing tab/);
    assert.notEqual(await t('tool-chip').textContent(), 'Tool: Trim');
    await page.locator('[data-tool=select]').click();
    await closeTabs(/Layout/);
  });

  await step('Offset: the distance is remembered; click an object, click the side; a line, circle and rounded rectangle each make one copy on the same layer, one undo step "Offset"; too much is refused; Esc backs out', async () => {
    await openGrips(modDoc(), 'mod.dxf');
    assert.equal(await entCount(), 3);
    await page.locator('[data-tool=offset]').click();
    assert.equal(await t('tool-chip').textContent(), 'Tool: Offset');
    assert.match(await prompt(), /Select the object to offset, or type the distance <10>/);
    await typeCmd('15');
    assert.match(await histLine(), /Distance <15> mm/);
    await click(70, 30);
    assert.match(await prompt(), /Click the side to offset to/);
    const side = await at(70, 70);
    await page.mouse.move(side.x, side.y);
    await frames();
    assert.equal(await t('mod-preview').count(), 1, 'the copy shows before the click');
    await click(70, 70);
    assert.equal(await entCount(), 4);
    assert.match(await prompt(), /Select the object to offset/, 'it goes on with the next object');
    let doc = await savedDoc(), e = doc.entities[3];
    assert.equal(e.type, 'LINE'); assert.equal(layerOf(e), 'Cut');
    assert.deepEqual([10, 20, 11, 21].map((c) => fieldOf(e, c)), [20, 45, 120, 45]);
    // a circle: inside, the radius shrinks by the distance
    await click(190, 100); await click(165, 100);
    assert.equal(await entCount(), 5);
    doc = await savedDoc(); e = doc.entities[4];
    assert.equal(e.type, 'CIRCLE'); assert.equal(fieldOf(e, 40), 5);
    // more than the radius: refused, nothing added, the circle is still held for another side
    await typeCmd('25');
    await click(190, 100); await click(165, 100);
    assert.match(await histLine(), /more than the radius/);
    assert.equal(await entCount(), 5);
    // a rounded rectangle: outside, 6 mm (arcs grow)
    await typeCmd('6');
    await page.keyboard.press('Escape');                   // back to picking an object
    assert.match(await prompt(), /Select the object to offset/);
    await click(300, 20); await click(300, 5);
    assert.equal(await entCount(), 6);
    doc = await savedDoc(); e = doc.entities[5];
    assert.equal(e.type, 'LWPOLYLINE'); assert.equal(layerOf(e), 'Cut');
    const ys = e.r.c.map((c, i) => (c === 20 ? +e.r.v[i] : null)).filter((v) => v != null);
    assert.ok(Math.abs(Math.min(...ys) - 14) < 1e-6 && Math.abs(Math.max(...ys) - 86) < 1e-6, 'the outline grew by 6 mm each way: ' + ys.join());
    assert.equal(e.r.c.filter((c) => c === 42).length > 0, true, 'the corners are still arcs');
    const labels = await histLabels();
    assert.deepEqual(labels.slice(-3), ['Offset', 'Offset', 'Offset'], 'one undo step each');
    // the distance is remembered after switching tools
    await page.locator('[data-tool=select]').click(); await page.locator('[data-tool=offset]').click();
    assert.match(await prompt(), /<6>/);
    await page.keyboard.press('Escape');
    assert.equal(await t('tool-chip').textContent(), 'Tool: Select', 'Esc with nothing held: back to Select');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    assert.equal(await entCount(), 3);
    await typeCmd('o');
    assert.equal(await t('tool-chip').textContent(), 'Tool: Offset', 'O is Offset');
    await typeCmd('10');
    await shotBoth('offset', async () => { await click(70, 30); const p = await at(70, 62); await page.mouse.move(p.x, p.y); await frames(); }, async () => { await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); });
    await page.locator('[data-tool=select]').click();
  });

  await step('Trim: Enter makes every object a cutting edge, a click cuts the part between the crossings (a line becomes two); one undo step "Trim" each; pieces of an edge still cut', async () => {
    const doc0 = newDoc(4);
    addEntities(doc0, dxfLine(20, 30, 220, 30), dxfLine(80, 10, 80, 50), dxfLine(160, 10, 160, 50));
    await openGrips(writeDxf(doc0), 'trim.dxf');
    assert.equal(await entCount(), 3);
    await page.locator('[data-tool=trim]').click();
    assert.equal(await t('tool-chip').textContent(), 'Tool: Trim');
    assert.match(await prompt(), /Select cutting edges.*Enter = all/);
    await page.keyboard.press('Enter');
    assert.match(await prompt(), /Click the part to cut away/);
    const mid = await at(120, 30);
    await page.mouse.move(mid.x, mid.y); await frames();
    assert.equal(await t('mod-preview').count(), 2, 'the two pieces that stay show before the click');
    await click(120, 30);
    assert.equal(await entCount(), 4);
    let doc = await savedDoc();
    const horiz = doc.entities.filter((e) => e.type === 'LINE' && fieldOf(e, 21) === 30 && fieldOf(e, 20) === 30).map((e) => [fieldOf(e, 10), fieldOf(e, 11)].sort((a, b) => a - b));
    assert.deepEqual(horiz.sort((a, b) => a[0] - b[0]), [[20, 80], [160, 220]]);
    await click(80, 45);                                       // the upper part of the left vertical (the piece of the line now ends on it)
    assert.equal(await entCount(), 4, 'a line trimmed to one piece');
    doc = await savedDoc();
    const v = doc.entities.find((e) => e.type === 'LINE' && fieldOf(e, 10) === 80 && fieldOf(e, 11) === 80);
    assert.deepEqual([fieldOf(v, 20), fieldOf(v, 21)].sort((a, b) => a - b), [10, 30]);
    const labels = await histLabels();
    assert.deepEqual(labels.slice(-2), ['Trim', 'Trim']);
    const away = await at(120, 45);
    await page.mouse.click(away.x, away.y);
    await frames();
    assert.match(await histLine(), /nothing there/i);
    await page.keyboard.press('Escape');
    assert.equal(await t('tool-chip').textContent(), 'Tool: Select', 'Esc ends Trim');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    assert.equal(await entCount(), 3);
  });

  await step('Trim with picked cutting edges: click toggles an edge; a line nothing crosses says so; a circle between two lines leaves an arc', async () => {
    const doc0 = newDoc(4);
    addEntities(doc0, dxfLine(20, 30, 220, 30), dxfLine(80, 10, 80, 50), dxfLine(160, 10, 160, 50), dxfCircle(120, 100, 20), dxfLine(90, 90, 150, 90), dxfLine(90, 110, 150, 110));
    await openGrips(writeDxf(doc0), 'trim2.dxf');
    await page.locator('[data-tool=trim]').click();
    await click(160, 40);
    assert.match(await histLine(), /Cutting edges: 1/);
    const hov = await at(160, 40);
    await page.mouse.move(hov.x, hov.y); await frames();
    assert.equal(await t('trim-edge').count(), 1, 'the edge is marked');
    await page.keyboard.press('Enter');
    await click(100, 30);                                      // only the line at x = 160 cuts: the click is left of it, so the part up to it goes
    let doc = await savedDoc();
    const first = doc.entities.find((e) => e.type === 'LINE' && fieldOf(e, 21) === 30 && fieldOf(e, 20) === 30);
    assert.deepEqual([fieldOf(first, 10), fieldOf(first, 11)].sort((a, b) => a - b), [160, 220]);
    await click(80, 40);                                        // the other vertical: the one cutting edge (x = 160) does not cross it
    assert.match(await histLine(), /Nothing crosses it here/);
    await page.keyboard.press('Escape');
    await page.locator('[data-tool=trim]').click();
    await click(90, 91); await click(150, 109);                // two cutting lines for the circle
    await page.keyboard.press('Enter');
    const before = await entCount();
    await click(140, 100);                                      // the right-hand side of the circle, between the two lines
    doc = await savedDoc();
    assert.equal(await entCount(), before, 'the circle becomes one arc');
    assert.equal(doc.entities.filter((e) => e.type === 'ARC').length, 1);
    assert.equal(doc.entities.filter((e) => e.type === 'CIRCLE').length, 0);
    await shotBoth('trim', async () => { await page.keyboard.press('Escape'); await page.locator('[data-tool=trim]').click(); await page.keyboard.press('Enter'); const p = await at(120, 30); await page.mouse.move(p.x, p.y); await frames(); }, async () => { await page.keyboard.press('Escape'); });
    await page.locator('[data-tool=select]').click();
  });

  await step('Mirror: the selection (or the objects picked, then Enter), two points, Erase Yes / No (default No); text keeps reading the same way; one undo step "Mirror"', async () => {
    const doc0 = newDoc(4);
    addEntities(doc0, dxfLine(20, 30, 60, 50, { layer: 'Cut' }), dxfCircle(100, 80, 10, { layer: 'Cut' }), dxfText(30, 10, 5, 'ABC', { layer: 'Cut' }));
    await openGrips(writeDxf(doc0), 'mirror.dxf');
    await page.keyboard.press('Control+a');
    assert.match(await selCount(), /3/);
    await page.locator('[data-tool=mirror]').click();
    assert.match(await prompt(), /Specify first point of mirror line/, 'the selection is taken');
    await click(150, 0);
    assert.match(await prompt(), /Specify second point of mirror line/);
    const p2 = await at(150, 100); await page.mouse.move(p2.x, p2.y); await frames();
    assert.ok(await t('mod-preview').count() >= 2, 'the mirrored copies show before the click');
    await shotBoth('mirror', async () => { const q = await at(150, 100); await page.mouse.move(q.x, q.y); await frames(); }, async () => {});
    await click(150, 100);
    assert.match(await prompt(), /Erase source objects\? \[Yes \/ No\] <No>/);
    assert.equal(await t('mirror-yes').isVisible(), true); assert.equal(await t('mirror-no').isVisible(), true);
    await page.keyboard.press('Enter');                         // default: No
    assert.equal(await entCount(), 6);
    assert.equal(await t('tool-chip').textContent(), 'Tool: Select');
    assert.match(await selCount(), /3/, 'the copies are selected');
    let doc = await savedDoc();
    const ln = doc.entities.filter((e) => e.type === 'LINE'), tx = doc.entities.filter((e) => e.type === 'TEXT');
    assert.deepEqual(ln.map((e) => [10, 20, 11, 21].map((c) => Math.round(fieldOf(e, c) / 2) * 2)).sort((a, b) => a[0] - b[0]), [[20, 30, 60, 50], [280, 30, 240, 50]]); // the mirror line is a click, so a pixel off
    assert.equal(tx.length, 2); assert.equal(tx.filter((e) => e.r.v[e.r.c.indexOf(1)] === 'ABC').length, 2, 'the words are not reversed');
    assert.ok(tx.some((e) => Math.abs(fieldOf(e, 10) - 270) < 2), 'the text moved to the other side');
    assert.equal((await histLabels()).at(-1), 'Mirror');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Control+z');
    assert.equal(await entCount(), 3, 'one undo step');
    // Yes: the sources go
    await page.keyboard.press('Control+a');
    await page.locator('[data-tool=mirror]').click();
    await click(150, 0); await click(150, 100);
    await typeCmd('y');
    assert.equal(await entCount(), 3);
    doc = await savedDoc();
    assert.deepEqual(doc.entities.filter((e) => e.type === 'LINE').map((e) => [10, 20, 11, 21].map((c) => Math.round(fieldOf(e, c) / 2) * 2)), [[280, 30, 240, 50]]);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Control+z');
    // nothing selected: pick, Enter, then the buttons
    await page.keyboard.press('Escape');
    await page.locator('[data-tool=mirror]').click();
    assert.match(await prompt(), /Select objects/);
    await page.keyboard.press('Enter');
    assert.match(await histLine(), /pick at least one/i);
    await click(100, 90);                                       // the circle
    await page.keyboard.press('Enter');
    await click(0, 50); await click(10, 50);                    // a horizontal mirror line: the circle goes below
    await t('mirror-no').click();
    assert.equal(await entCount(), 4);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Control+z');
    await page.locator('[data-tool=mirror]').click();
    await page.keyboard.press('Escape');
    assert.equal(await t('tool-chip').textContent(), 'Tool: Select', 'Esc with nothing selected ends Mirror');
  });

  await step('Trim: Ctrl+Z after trimming a cutting edge gives the edge back, so the same edge set still cuts', async () => {
    const doc0 = newDoc(4);
    addEntities(doc0, dxfLine(80, 10, 80, 50), dxfLine(20, 30, 220, 30));
    await openGrips(writeDxf(doc0), 'trim3.dxf');
    await page.locator('[data-tool=trim]').click();
    await click(80, 15); await click(200, 30);
    assert.match(await histLine(), /Cutting edges: 2/);
    await page.keyboard.press('Enter');
    await click(80, 45);                                       // the vertical (an edge) is cut by the horizontal (an edge)
    assert.equal((await histLabels()).at(-1), 'Trim');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Control+z');
    assert.equal(await entCount(), 2);
    await click(150, 30);                                      // trim the horizontal by the vertical: needs the vertical back as an edge
    assert.equal((await histLabels()).at(-1), 'Trim', 'the same edge set still cuts: ' + await histLine());
    const doc = await savedDoc();
    const h = doc.entities.find((e) => e.type === 'LINE' && fieldOf(e, 20) === 30 && fieldOf(e, 21) === 30);
    assert.deepEqual([fieldOf(h, 10), fieldOf(h, 11)].sort((a, b) => a - b), [20, 80]);
    await page.keyboard.press('Escape');
  });

  // ---- Next sessions 6: Auto-nest (nest.js packs, nestdlg.js is the dialog, option B of mock-up R10) ----
  const nestPieces = () => page.locator('[data-testid=nest-svg] [data-testid=nest-piece]').count();
  const nestShot = async (name) => {                     // the dialog covers the menus, so the theme is switched on the page
    for (const th of ['light', 'dark']) { await page.evaluate((x) => { document.documentElement.dataset.theme = x; }, th); await page.waitForTimeout(250); await page.screenshot({ path: `${shotDir}/r10-${name}-${th}.png` }); }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  };
  const nestDone = () => page.waitForFunction(() => document.querySelector('[data-testid=nest-dialog]').dataset.state === 'done', null, { timeout: 30000 });
  const nestRun = async () => { await t('nest-run').or(t('nest-again')).first().click(); await nestDone(); };
  const nestSetCount = async (i, n) => { await t('nest-count-' + i).fill(String(n)); await t('nest-count-' + i).press('Tab'); };
  const sheetParts = () => page.locator('.part-hit').count();
  const nestLayout = async () => {                       // a fresh layout with Plate A and Dial in it, no grid
    await closeTabs(/./);
    await t('new-layout').click();
    await t('panel-library').click();
    await libCard('Plate A').locator('[data-testid=lib-add]').click();
    await libCard('Dial').locator('[data-testid=lib-add]').click();
    await t('panel-main').click();
    await t('part').selectOption({ index: 0 });
  };
  await step('Auto-nest: the button and the n command open the dialog on a layout tab only; the dialog lists the parts with counts, the rotations (default Every 90°), the gap, and nothing is placed until Apply', async () => {
    await closeTabs(/./);
    await openGrips(modDoc(), 'mod.dxf');
    await page.locator('[data-tool=nest]').click();
    assert.match(await prompt(), /^Auto-nest is on a layout tab/);
    assert.equal(await page.locator('[data-testid=nest-dialog]').count(), 0);
    await nestLayout();
    const before = await sheetParts();
    await t('nest').click();
    const dlg = page.locator('[data-testid=nest-dialog]');
    assert.equal(await dlg.getAttribute('role'), 'dialog'); assert.equal(await dlg.getAttribute('aria-label'), 'Auto-nest'); assert.equal(await dlg.getAttribute('data-state'), 'idle');
    assert.match(await t('nest-sub').textContent(), /^Layout \d+ · sheet 1000 × 700 mm · gripper 30 mm · gap 5 mm$/);
    assert.equal(await t('nest-gap').textContent(), '5 mm');
    assert.deepEqual(await page.locator('[data-testid^=nest-rot-]').allTextContents(), ['0° only', '0° + 180°', 'Every 90°']);
    assert.equal(await t('nest-rot-all').getAttribute('aria-pressed'), 'true');
    assert.match(await t('nest-row-0').textContent(), /Plate A/);
    assert.equal(await t('nest-count-0').inputValue(), '1'); assert.equal(await t('nest-count-1').inputValue(), '1');
    assert.match(await t('nest-totals').textContent(), /^2 pieces from 2 parts$/);
    assert.equal(await t('nest-prelabel').textContent(), 'Preview · not applied yet');
    assert.equal(await nestPieces(), 0);
    await t('nest-plus-0').click(); await t('nest-plus-0').click(); await t('nest-minus-0').click();
    assert.equal(await t('nest-count-0').inputValue(), '2');
    assert.equal(await sheetParts(), before, 'the dialog does not touch the sheet');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-testid=nest-dialog]').count(), 0, 'Esc closes it');
    await cmdLine().fill('nest'); await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-testid=nest-dialog]').count(), 1, 'the nest command opens it');
    await t('nest-cancel').click();
  });

  await step('Auto-nest: Run packs a preview (not on the sheet), Cancel leaves the sheet as it was, Apply puts the parts on as one undo step, Ctrl+Z takes them off', async () => {
    const before = await sheetParts();
    await t('nest').click();
    await nestSetCount(0, 6); await nestSetCount(1, 4);
    assert.match(await t('nest-totals').textContent(), /^10 pieces from 2 parts$/);
    await nestRun();
    assert.equal(await t('nest-placed').textContent(), '10 of 10 placed');
    assert.match(await t('nest-pct').textContent(), /^\d+ % of the sheet used$/);
    assert.match(await t('nest-left').textContent(), /Everything fits on this sheet/);
    assert.equal(await t('nest-next').count(), 0, 'no left-overs, no next sheet');
    assert.equal(await nestPieces(), 10);
    assert.equal(await t('nest-prelabel').textContent(), 'Preview · not applied yet');
    assert.equal(await sheetParts(), before, 'the preview is not on the sheet');
    await nestShot('nest');
    await t('nest-cancel').click();
    assert.equal(await sheetParts(), before, 'Cancel leaves the sheet as it was');
    await t('nest').click();
    await nestSetCount(0, 6); await nestSetCount(1, 4);
    await nestRun();
    await t('nest-again').click();                                  // Run again: the sheet is still untouched
    await nestDone();
    assert.equal(await sheetParts(), before);
    await t('nest-apply').click();
    assert.equal(await page.locator('[data-testid=nest-dialog]').count(), 0);
    assert.equal(await sheetParts(), before + 10);
    assert.match(await prompt(), /Auto-nest: 10 parts placed, \d+ % of the usable sheet used\. Ctrl\+Z takes them off again/);
    await page.keyboard.press('Control+z');
    assert.equal(await sheetParts(), before, 'one undo step takes all ten off');
    await page.keyboard.press('Control+Shift+z');
    assert.equal(await sheetParts(), before + 10, 'redo puts them back');
    await page.keyboard.press('Control+z');
  });

  await step('Auto-nest: too many for the sheet → left-overs listed ("N × name"); a rotations setting changes the run; the next sheet gets a layout tab with them', async () => {
    const tabsBefore = (await tabs()).length;
    await t('nest').click();
    await nestSetCount(0, 200); await nestSetCount(1, 0);
    await nestRun();
    const placed = Number((await t('nest-placed').textContent()).match(/^(\d+) of 200 placed$/)[1]);
    assert.ok(placed > 20 && placed < 200, 'placed ' + placed);
    assert.equal(await t('nest-left').textContent(), `Left over (${200 - placed}): ${200 - placed} × Plate A. They do not fit this sheet.`);
    assert.equal(await nestPieces(), placed);
    await t('nest-rot-none').click();
    await t('nest-again').click(); await nestDone();
    assert.ok(Number((await t('nest-placed').textContent()).match(/^(\d+) of 200/)[1]) > 20, 'rotations: 0° only still packs');
    await t('nest-rot-all').click();
    await t('nest-again').click(); await nestDone();
    await nestShot('nest-leftovers');
    await t('nest-next').click();
    await page.waitForFunction((n) => document.querySelectorAll('.tabs .dtab:not([aria-label])').length > n, tabsBefore);
    assert.equal((await tabs()).length, tabsBefore + 1, 'a new layout tab');
    assert.equal(await page.locator('[data-testid=nest-dialog]').count(), 1, 'the dialog opens on it');
    assert.match(await t('nest-totals').textContent(), /^\d+ pieces from 1 part$/);
    await nestDone();
    assert.match(await t('nest-placed').textContent(), /of \d+ placed$/);
    await t('nest-cancel').click();
  });

  await step('Auto-nest: Stop keeps what was placed so far; a run of 50 parts stays well under 10 s', async () => {
    await nestLayout();
    await t('nest').click();
    await nestSetCount(0, 30); await nestSetCount(1, 20);
    const t0 = Date.now();
    await t('nest-run').click(); await nestDone();
    assert.ok(Date.now() - t0 < 10000, 'took ' + (Date.now() - t0) + ' ms');
    await nestSetCount(0, 1000);
    await t('nest-again').click();
    assert.equal(await page.locator('[data-testid=nest-dialog]').getAttribute('data-state'), 'run');
    assert.equal(await t('nest-prelabel').textContent(), 'Preview · placing…');
    assert.equal(await t('nest-apply').isDisabled(), true, 'Apply waits for the run');
    assert.match(await t('nest-status').textContent(), /^Placing \d+ of 1020…/);
    assert.equal(await page.locator('[role=progressbar]').count(), 1);
    await t('nest-stop').click(); await nestDone();
    assert.match(await t('nest-placed').textContent(), /^\d+ of 1020 placed( \(stopped\))?$/);
    await t('nest-cancel').click();
  });

  await step("Closing with unsaved tabs: the exe's close request asks Save / Don't save / Cancel; a browser unload is warned; F5 and Ctrl+R are off in the exe", async () => {
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const p2 = await ctx2.newPage();
    await p2.addInitScript(() => {                                   // a stand-in for the window API of the exe: the close handler is kept, destroy() is counted
      window.__destroyed = 0;
      window.__TAURI__ = { window: { getCurrentWindow: () => ({ onCloseRequested: (fn) => { window.__onClose = fn; }, destroy: async () => { window.__destroyed++; } }) } };
    });
    const errs2 = [];
    p2.on('pageerror', (e) => errs2.push(String(e)));
    await p2.goto(URL_);
    const close = () => p2.evaluate(() => { window.__prevented = false; return window.__onClose({ preventDefault() { window.__prevented = true; } }).then(() => window.__prevented); });
    const dlg = p2.locator('[data-testid=close-dialog]'), destroyed = () => p2.evaluate(() => window.__destroyed);
    assert.equal(await close(), true, 'the exe window is always held until the answer is in');
    assert.equal(await destroyed(), 1, 'nothing unsaved: it closes without a question');
    assert.equal(await p2.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), false, 'a browser unload is not warned when nothing is unsaved');
    await p2.locator('[data-testid=layer-add]').click();             // a change: the tab gets its dot
    assert.equal(await p2.locator('.tabs .dtab.on .dot').count(), 1);
    assert.equal(await p2.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), true, 'a browser unload is warned');
    // Cancel keeps the window
    const pending = p2.evaluate(() => window.__onClose({ preventDefault() {} }));
    await dlg.waitFor();
    assert.equal(await p2.locator('[data-testid=close-dialog] strong').textContent(), 'Save changes to "Drawing 1"?');
    for (const th of ['light', 'dark']) { await p2.evaluate((x) => { document.documentElement.dataset.theme = x; }, th); await p2.screenshot({ path: `${shotDir}/s16-closeprompt-${th}.png` }); }
    await p2.locator('[data-testid=close-cancel]').click(); await pending;
    assert.equal(await destroyed(), 1, 'Cancel: still open'); assert.equal(await p2.locator('.tabs .dtab[data-kind]').count(), 1);
    // Esc is Cancel too
    const pending2 = p2.evaluate(() => window.__onClose({ preventDefault() {} }));
    await dlg.waitFor(); await p2.keyboard.press('Escape'); await pending2;
    assert.equal(await destroyed(), 1);
    // F5 / Ctrl+R in the exe
    for (const [key, ctrl] of [['F5', false], ['r', true], ['R', true]]) {
      assert.equal(await p2.evaluate(([k, c]) => { const e = new KeyboardEvent('keydown', { key: k, ctrlKey: c, cancelable: true, bubbles: true }); document.dispatchEvent(e); return e.defaultPrevented; }, [key, ctrl]), true, key);
    }
    assert.match(await p2.locator('[data-testid=cmd-prompt]').textContent(), /Reload is off/);
    // Don't save closes at once
    const pending3 = p2.evaluate(() => window.__onClose({ preventDefault() {} }));
    await dlg.waitFor(); await p2.locator('[data-testid=close-discard]').click(); await pending3;
    assert.equal(await destroyed(), 2);
    // Save goes through the usual Save (here a download), and then the window closes
    const [dl] = await Promise.all([p2.waitForEvent('download'), (async () => {
      const pending4 = p2.evaluate(() => window.__onClose({ preventDefault() {} }));
      await dlg.waitFor(); await p2.locator('[data-testid=close-save]').click(); await pending4;
    })()]);
    assert.match(dl.suggestedFilename(), /.dxf$/);
    assert.equal(await destroyed(), 3);
    assert.equal(await p2.locator('.tabs .dtab.on .dot').count(), 0, 'saved: no dot');
    assert.equal(await p2.evaluate(() => { const e = new KeyboardEvent('keydown', { key: 'F5', cancelable: true, bubbles: true }); document.dispatchEvent(e); return e.defaultPrevented; }), false, 'nothing unsaved: F5 is left alone');
    assert.deepEqual(errs2, []);
    await ctx2.close();
  });

  await step("Audit 1: close → Don't save (or Save) deletes the recovery copies, so a reload offers nothing", async () => {
    const c3 = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const p3 = await c3.newPage();
    await p3.addInitScript(() => {
      window.__TAURI__ = { window: { getCurrentWindow: () => ({ onCloseRequested: (fn) => { window.__onClose = fn; }, destroy: async () => {} }) } };
    });
    const copyCount = () => p3.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('project-d-recovery', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('copies', { keyPath: 'id' });
      r.onsuccess = () => { const q = r.result.transaction('copies').objectStore('copies').count(); q.onsuccess = () => { r.result.close(); res(q.result); }; };
    }));
    const waitCopy = async () => { for (let i = 0; i < 60; i++) { if (await copyCount() === 1) return; await p3.waitForTimeout(150); } throw new Error('no copy appeared'); };
    const u3 = URL_ + '?autosave=300';
    for (const answer of ['close-discard', 'close-save']) {
      await p3.goto(u3);
      await p3.waitForSelector('[data-testid=count]', { state: 'attached' });
      await p3.locator('[data-testid=layer-add]').click();
      await waitCopy();
      const pending = p3.evaluate(() => window.__onClose({ preventDefault() {} }));
      await p3.locator('[data-testid=close-dialog]').waitFor();
      await p3.locator(`[data-testid=${answer}]`).click(); await pending;
      assert.equal(await copyCount(), 0, answer + ': the copy is gone before the window closes');
      await p3.reload(); await p3.waitForSelector('[data-testid=count]', { state: 'attached' }); await p3.waitForTimeout(500);
      assert.equal(await p3.locator('[data-testid=recover-dialog]').count(), 0, answer + ': nothing to recover');
    }
    await c3.close();
  });

  await step("Audit 4: autosave also copies a change that touches only the layers (a new layer after the first copy)", async () => {
    const c4 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p4 = await c4.newPage();
    const dxfs = () => p4.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('project-d-recovery', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('copies', { keyPath: 'id' });
      r.onsuccess = () => { const q = r.result.transaction('copies').objectStore('copies').getAll(); q.onsuccess = () => { r.result.close(); res(q.result.map((x) => x.dxf)); }; };
    }));
    await p4.goto(URL_ + '?autosave=300');
    await p4.waitForSelector('[data-testid=count]', { state: 'attached' });
    await p4.locator('[data-testid=picker]').setInputFiles('fixtures/outline.dxf');
    await p4.waitForFunction(() => document.querySelector('[data-testid=gap-count]') && document.querySelector('[data-testid=gap-count]').textContent === '2');
    await p4.locator('[data-testid=gap-join]').click();
    for (let i = 0; i < 60 && (await dxfs()).length < 1; i++) await p4.waitForTimeout(150);
    assert.equal((await dxfs()).length, 1, 'the first copy');
    assert.ok(!/\nLayer1\r?\n/.test((await dxfs())[0]));
    await p4.locator('[data-testid=layer-add]').click();
    let has = false;
    for (let i = 0; i < 60 && !has; i++) { has = /\nLayer1\r?\n/.test((await dxfs())[0]); if (!has) await p4.waitForTimeout(150); }
    assert.ok(has, 'the copy has the new layer');
    await c4.close();
  });

  await step("Audit 6: a second window does not offer (or discard) the first window's recovery copies; once the first is gone, a restart does", async () => {
    const c5 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const a = await c5.newPage();
    const count = () => a.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('project-d-recovery', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('copies', { keyPath: 'id' });
      r.onsuccess = () => { const q = r.result.transaction('copies').objectStore('copies').count(); q.onsuccess = () => { r.result.close(); res(q.result); }; };
    }));
    await a.goto(URL_ + '?autosave=300');
    await a.waitForSelector('[data-testid=count]', { state: 'attached' });
    await a.locator('[data-testid=picker]').setInputFiles('fixtures/outline.dxf');
    await a.waitForFunction(() => document.querySelector('[data-testid=gap-count]') && document.querySelector('[data-testid=gap-count]').textContent === '2');
    await a.locator('[data-testid=gap-join]').click();
    for (let i = 0; i < 60 && await count() < 1; i++) await a.waitForTimeout(150);
    assert.equal(await count(), 1);
    const b = await c5.newPage();                                    // the exe started a second time
    await b.goto(URL_);
    await b.waitForSelector('[data-testid=count]', { state: 'attached' });
    await b.waitForTimeout(800);
    assert.equal(await b.locator('[data-testid=recover-dialog]').count(), 0, 'the first window still owns its copies');
    assert.equal(await count(), 1);
    await a.close();
    await b.reload();
    await b.locator('[data-testid=recover-dialog]').waitFor();
    await c5.close();
  });

  // ---- TODO 39: the Objects tab (objects.js; mock-up R11a, Option A) ----
  const objDoc = () => {
    const doc = newDoc(4);
    addLayer(doc, 'Cut', { aci: 7 }); addLayer(doc, 'Engrave', { aci: 5 });
    addEntities(doc, dxfPoly([[20, 30], [120, 30], [120, 90], [20, 90]], { layer: 'Cut', closed: true }), dxfCircle(170, 100, 20, { layer: 'Cut' }), dxfLine(20, 150, 120, 150, { layer: 'Cut' }), dxfText(60, 120, 5, 'REV A', { layer: 'Engrave' }));
    return writeDxf(doc);
  };
  const oRow = (txt) => page.locator('[data-testid=obj-tree] .or.obj', { hasText: txt });
  const oLayer = (name) => page.locator(`[data-testid=obj-tree] .or.layer[data-layer="${name}"]`);
  const oRows = () => page.locator('[data-testid=obj-tree] .or.obj .onm').allTextContents();
  const oLayers = () => page.locator('[data-testid=obj-tree] .or.layer .onm').allTextContents();
  const isDim = (loc) => loc.evaluate((e) => e.classList.contains('dim'));
  const openObjects = async () => { await openGrips(objDoc(), 'objects.dxf'); await t('ptab-objects').click(); await t('objects-panel').waitFor(); };

  await step('Objects tab: two tabs on the right panel; Objects lists the layers and, for the open one, its objects with short labels; the footer counts', async () => {
    await openGrips(objDoc(), 'objects.dxf');
    assert.equal(await t('objects-panel').isVisible(), false, 'Drawing is the tab at first');
    assert.equal(await page.locator('.layers-rows').isVisible(), true);
    await t('ptab-objects').click(); await t('objects-panel').waitFor();
    assert.equal(await t('ptab-objects').getAttribute('aria-selected'), 'true'); assert.equal(await t('ptab-drawing').getAttribute('aria-selected'), 'false');
    assert.equal(await page.locator('.layers-rows').isVisible(), false, 'the Drawing sections are not shown');
    assert.deepEqual(await oLayers(), ['Cut', 'Engrave']);
    assert.deepEqual(await oRows(), ['Rectangle 100.0 × 60.0', 'Circle Ø40', 'Line 100.0'], 'the first layer is open; Engrave is closed');
    assert.equal(await oLayer('Engrave').getAttribute('aria-expanded'), 'false');
    assert.match(await t('obj-count').textContent(), /^4 objects · 2 layers$/);
    assert.equal(await t('obj-selected').textContent(), '0 selected');
    await oLayer('Engrave').click();
    assert.deepEqual(await oRows(), ['Rectangle 100.0 × 60.0', 'Circle Ø40', 'Line 100.0', "Text 'REV A'"]);
    await oLayer('Engrave').click();
    assert.equal((await oRows()).length, 3, 'a click on a layer closes it again');
    await oLayer('Engrave').dblclick();         // the first click rebuilds the rows, so the browser sends no dblclick: the second click (detail 2) does it
    assert.equal(await page.locator('[data-testid=obj-tree] .or.layer.cur').getAttribute('data-layer'), 'Engrave', 'a double-click makes the layer current');
    assert.equal(await page.locator('.layer.current .nm').textContent(), 'Engrave', 'the Layers panel agrees');
    assert.equal((await oRows()).length, 3, 'and the layer is left as it was, closed');
    await oLayer('Cut').dblclick();
    assert.equal(await page.locator('[data-testid=obj-tree] .or.layer.cur').getAttribute('data-layer'), 'Cut');
    await t('ptab-drawing').click();
    assert.equal(await page.locator('.layers-rows').isVisible(), true);
  });

  await step('Counts agree: sample.dxf has the same layer counts in the Layers panel and the Objects tab, and the same total in the status bar and the footer', async () => {
    await t('picker').setInputFiles('fixtures/sample.dxf');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').textContent.startsWith('sample.dxf'));
    await t('ptab-objects').click();
    const objN = Object.fromEntries(await page.locator('[data-testid=obj-tree] .or.layer').evaluateAll((rs) => rs.map((r) => [r.dataset.layer, r.querySelector('.ocnt').textContent])));
    await t('ptab-drawing').click();
    const layN = Object.fromEntries(await page.locator('.layer[data-file-layer]').evaluateAll((rs) => rs.map((r) => [r.querySelector('.nm').textContent, r.querySelector('.lbl').textContent])));
    assert.equal(layN.NOTES, '7', 'the IMAGE draws nothing but is an entity of the file');
    for (const [name, n] of Object.entries(objN)) assert.equal(layN[name], n, name);
    await t('ptab-objects').click();
    assert.match(await t('obj-count').textContent(), /^20 objects/);
    assert.equal(await t('entities').textContent(), 'Entities 20');
    await t('ptab-drawing').click();
    await closeTabs(/sample/);                                                  // back to the objects.dxf tab for the steps below
  });

  await step('TODO 61: counts and layer eye / lock still work after the 400,000-piece draw limit', async () => {
    const doc = newDoc(4);
    addLayer(doc, 'First', { aci: 7 }); addLayer(doc, 'Later', { aci: 5 });
    doc.blocks.Many = { base: [0, 0], entities: Array.from({ length: 41 }, (_, i) => dxfLine(i, 0, i, 1)) };
    addEntities(doc, dxfInsert('Many', 0, 0, { layer: 'First', rows: 100, cols: 100 }),
      dxfLine(50, 0, 51, 1, { layer: 'Later' }), dxfLine(51, 1, 52, 2, { layer: 'Later' }));
    await t('picker').setInputFiles({ name: 'draw-limit.dxf', mimeType: 'text/plain', buffer: Buffer.from(writeDxf(doc, { extents: [0, 0, 52, 2] }), 'latin1') });
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'draw-limit.dxf');
    await t('ptab-drawing').click();
    const later = page.locator('.layer[data-file-layer]', { hasText: 'Later' });
    assert.equal(await later.locator('.lbl').textContent(), '2');
    assert.equal(await t('entities').textContent(), 'Entities 3');
    await t('ptab-objects').click();
    assert.match(await t('obj-count').textContent(), /^3 objects/);
    assert.equal(await oLayer('Later').locator('.ocnt').textContent(), '2');
    await oLayer('Later').locator('[data-act=vis]').click();
    assert.equal(await isDim(oLayer('Later')), true);
    assert.match(await t('obj-filter-hidden').textContent(), /Hidden 2/);
    assert.equal(await later.evaluate((e) => e.classList.contains('hidden-layer')), true);
    await oLayer('Later').locator('[data-act=vis]').click();
    assert.equal(await isDim(oLayer('Later')), false);
    await oLayer('Later').locator('[data-act=lock]').click();
    assert.match(await t('obj-filter-locked').textContent(), /Locked 2/);
    await oLayer('Later').click();
    assert.equal(await oLayer('Later').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('[data-testid=obj-tree] .or.obj .chp.w').count(), 2);
    await oLayer('Later').locator('[data-act=lock]').click();
    assert.match(await t('obj-filter-locked').textContent(), /Locked 0/);
    await t('ptab-drawing').click();
    await closeTabs(/draw-limit/);
  });

  await step('Objects tab: a click on a row selects that object on the sheet; a pick on the sheet lights its row (its layer opens)', async () => {
    await t('ptab-objects').click();
    await oRow('Circle Ø40').click();
    await waitSel('1 selected');
    assert.deepEqual(await page.locator('.or.obj.sel .onm').allTextContents(), ['Circle Ø40']);
    assert.equal(await t('obj-selected').textContent(), '1 selected');
    await oRow('Line 100.0').click({ modifiers: ['Shift'] });
    await waitSel('2 selected');
    await oRow('Line 100.0').click({ modifiers: ['Shift'] });
    await waitSel('1 selected');
    await click(70, 150);                                                       // the line, on the sheet
    await waitSel('1 selected');
    assert.deepEqual(await page.locator('.or.obj.sel .onm').allTextContents(), ['Line 100.0']);
    await click(66, 122);                                                       // the text, on another layer that is closed
    await waitSel('1 selected');
    assert.deepEqual(await page.locator('.or.obj.sel .onm').allTextContents(), ["Text 'REV A'"]);
    assert.equal(await oLayer('Engrave').getAttribute('aria-expanded'), 'true');
    await click(70, 60); await waitSel('0 selected');
    assert.equal(await page.locator('.or.obj.sel').count(), 0);
  });

  await step('Objects tab: the eye on an object hides it for this session (not picked, filter Hidden n, Show all hidden); the eye on a layer hides the layer; rows of a hidden layer can still be selected', async () => {
    await oRow('Circle Ø40').locator('[data-act=vis]').click();
    assert.equal(await isDim(oRow('Circle Ø40')), true);
    assert.match(await t('obj-filter-hidden').textContent(), /Hidden 1/);
    await frames();
    await click(190, 100); await frames();
    assert.equal(await selCount(), '0 selected', 'a hidden object cannot be picked on the sheet');
    await t('obj-filter-hidden').click();
    assert.deepEqual(await oRows(), ['Circle Ø40'], 'the Hidden filter lists only what is hidden');
    assert.equal(await t('obj-filter-hidden').getAttribute('aria-pressed'), 'true');
    await t('obj-filter-all').click();
    await oRow('Circle Ø40').locator('[data-act=vis]').click();
    assert.equal(await isDim(oRow('Circle Ø40')), false);
    await click(190, 100); await waitSel('1 selected');
    // a layer
    await oLayer('Cut').locator('[data-act=vis]').click();
    assert.equal(await isDim(oLayer('Cut')), true);
    assert.equal(await page.locator('.layers-rows .layer.hidden-layer', { hasText: 'Cut' }).count(), 1, 'the Layers section shows it hidden too');
    assert.match(await t('obj-filter-hidden').textContent(), /Hidden 3/);
    await oRow('Line 100.0').click();
    await waitSel('1 selected');
    assert.deepEqual(await page.locator('.or.obj.sel .onm').allTextContents(), ['Line 100.0'], 'a row on a hidden layer can be selected');
    await oLayer('Cut').locator('[data-act=vis]').click();
    assert.equal(await isDim(oLayer('Cut')), false);
    // Show all hidden
    await oRow('Circle Ø40').locator('[data-act=vis]').click();
    await oRow('Circle Ø40').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Show all hidden' }).click();
    assert.equal(await page.locator('.or.dim').count(), 0);
    assert.match(await t('obj-filter-hidden').textContent(), /Hidden 0/);
  });

  await step('Objects tab: Lock is per layer: its objects cannot be picked on the sheet or from the tree, until unlocked', async () => {
    await click(70, 60); await waitSel('0 selected');
    await oLayer('Cut').locator('[data-act=lock]').click();
    assert.equal(await page.locator('.or.obj .chp.w').count(), 3, 'a "locked" chip on each object of the layer');
    assert.match(await t('obj-filter-locked').textContent(), /Locked 3/);
    await click(70, 150); await frames();
    assert.equal(await selCount(), '0 selected');
    await oRow('Line 100.0').click();
    assert.equal(await selCount(), '0 selected');
    assert.match(await prompt(), /locked/);
    await t('obj-filter-locked').click();
    assert.deepEqual(await oLayers(), ['Cut']);
    await t('obj-filter-all').click();
    await oLayer('Cut').locator('[data-act=lock]').click();
    await oRow('Line 100.0').click(); await waitSel('1 selected');
    await click(70, 60); await waitSel('0 selected');
  });

  await step('Objects tab: the search box filters the rows by label; clearing it brings the tree back', async () => {
    await t('obj-search').fill('circ');
    assert.deepEqual(await oLayers(), ['Cut']);
    assert.deepEqual(await oRows(), ['Circle Ø40']);
    await t('obj-search').fill('rev');
    assert.deepEqual(await oLayers(), ['Engrave']);
    assert.deepEqual(await oRows(), ["Text 'REV A'"], 'found in a closed layer');
    await t('obj-search').fill('zzz');
    assert.equal(await page.locator('.omempty').textContent(), 'Nothing matches.');
    await t('obj-search').fill('');
    assert.deepEqual(await oLayers(), ['Cut', 'Engrave']);
    assert.equal((await oRows()).length, 4, 'Cut and Engrave are both open now');
  });

  await step('Objects tab: right-click a row: Select, Zoom to, Hide, Lock layer, Move to layer…, Show all hidden; right-click a layer: Rename…', async () => {
    await oRow('Circle Ø40').click({ button: 'right' });
    assert.deepEqual(await ctxItems(), ['Select', 'Zoom to', 'Hide', 'Lock layer Cut', 'Move to layer…', 'Show all hidden']);
    assert.equal(await selCount(), '1 selected', 'the row is selected first');
    await page.getByRole('menuitem', { name: 'Zoom to' }).click();
    assert.ok(parseInt(await t('zoom').textContent(), 10) > 150, 'zoomed in on the circle: ' + await t('zoom').textContent());
    await oRow('Circle Ø40').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move to layer…' }).click();
    assert.deepEqual(await ctxItems(), ['0', 'Cut', 'Engrave']);
    await page.getByRole('menuitem', { name: 'Engrave', exact: true }).click();
    assert.equal(await oLayer('Cut').locator('.ocnt').textContent(), '2'); assert.equal(await oLayer('Engrave').locator('.ocnt').textContent(), '2');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => document.querySelector('.or.layer[data-layer="Cut"] .ocnt').textContent === '3');
    await oLayer('Cut').click({ button: 'right' });
    assert.deepEqual(await ctxItems(), ['Select', 'Zoom to', 'Hide', 'Lock', 'Rename…', 'Show all hidden']);
    await page.getByRole('menuitem', { name: 'Select', exact: true }).click();
    await waitSel('3 selected');
    await oLayer('Cut').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename…' }).click();
    await t('name-input').fill('Outline'); await t('name-ok').click();
    await page.waitForFunction(() => document.querySelector('.or.layer .onm').textContent === 'Outline');
    assert.deepEqual(await oLayers(), ['Outline', 'Engrave']);
    assert.equal(await page.locator('.layers-rows .layer', { hasText: 'Outline' }).count(), 1, 'the Layers section follows');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => document.querySelector('.or.layer .onm').textContent === 'Cut');
  });

  await step('Objects tab: a layer with hundreds of objects lists the first 500 and "Show … more"', async () => {
    const doc = newDoc(4);
    addEntities(doc, ...Array.from({ length: 620 }, (_, i) => dxfLine(0, i % 300, 10 + (i % 7), i % 300, { layer: 'Cut' })));
    await openGrips(writeDxf(doc), 'many.dxf');
    await t('ptab-objects').click();
    assert.equal(await page.locator('[data-testid=obj-tree] .or.obj').count(), 500);
    assert.match(await t('obj-count').textContent(), /^620 objects · 1 layer$/);
    await page.locator('.or.more').click();
    assert.equal(await page.locator('[data-testid=obj-tree] .or.obj').count(), 620);
    assert.equal(await page.locator('.or.more').count(), 0);
  });

  await step('Objects tab: a layout tab shows its parts; the eye hides a part on the sheet, and a place can be picked from the list', async () => {
    await t('ptab-drawing').click();
    await nestLayout();
    await t('ptab-objects').click();
    const parts = page.locator('[data-testid=obj-tree] .or.layer[data-part]');
    assert.deepEqual(await parts.locator('.onm').allTextContents(), ['Plate A', 'Dial']);
    assert.equal(await page.locator('[data-testid=obj-filter-locked]').isVisible(), false);
    await parts.first().click();
    assert.equal(await page.locator('[data-testid=obj-tree] .or.obj').count(), 1, 'its places are listed');
    await page.locator('[data-testid=obj-tree] .or.obj').first().click();
    await page.waitForFunction(() => document.querySelector('.or.obj.sel'));
    await parts.first().locator('[data-act=vis]').click();
    assert.equal(await isDim(parts.first()), true);
    await frames();
    await parts.first().locator('[data-act=vis]').click();
    assert.equal(await isDim(parts.first()), false);
    await t('ptab-drawing').click();
  });

  await step('Objects tab: a part hidden on a layout is left out of the PDF (fewer drawing operators), and comes back when shown; Save is not affected', async () => {
    await t('ptab-drawing').click();
    await nestLayout();
    const ops = async () => { await openPdf(); const txt = pdfText(await downloaded(() => t('pdf-go').click())); return (txt.match(/ m\n/g) || []).length; };
    const all = await ops();
    await t('ptab-objects').click();
    const eye = page.locator('[data-testid=obj-tree] .or.layer[data-part]').first().locator('[data-act=vis]');
    await eye.click();
    const fewer = await ops();
    assert.ok(fewer > 0 && fewer < all, `${fewer} operators with Plate A hidden, ${all} with everything`);
    await eye.click();
    assert.equal(await ops(), all, 'shown again: the same PDF');
    await t('ptab-drawing').click();
  });

  await step('Objects tab: screenshots, light and dark', async () => {
    await openObjects();
    await oRow('Circle Ø40').click();
    await oLayer('Engrave').click();
    const show = async () => { await oRow('Circle Ø40').click({ button: 'right' }); await page.waitForSelector('[data-testid=ctx-menu]'); };
    await show(); await page.waitForTimeout(250); await page.screenshot({ path: `${shotDir}/s8-objects-light.png` }); await page.keyboard.press('Escape');
    await menuItem('View', 'Theme: dark'); await show(); await page.waitForTimeout(300); await page.screenshot({ path: `${shotDir}/s8-objects-dark.png` }); await page.keyboard.press('Escape');
    await menuItem('View', 'Theme: light'); await t('ptab-drawing').click();
    await closeTabs(/./);
  });

  // ---- session 8 review fixes ----
  await step('Objects tab on a layout: a hidden part is not clickable, boxed or taken by Ctrl+A, and comes back when shown', async () => {
    await nestLayout();
    assert.equal(await sheetParts(), 2);
    await t('ptab-objects').click();
    const eye = page.locator('[data-testid=obj-tree] .or.layer[data-part]').first().locator('[data-act=vis]');
    await eye.click();
    assert.equal(await sheetParts(), 1, 'the hidden part has no hit shape');
    await page.keyboard.press('Control+a');
    assert.match(await prompt(), /^1 part selected/);
    await eye.click();
    assert.equal(await sheetParts(), 2);
    await t('ptab-drawing').click();
  });

  await step('Layout tabs: a selection of several parts stays on its own tab; Esc during a drag keeps a saved tab clean; Ctrl+Z takes back a typed setting', async () => {
    await nestLayout();
    await page.keyboard.press('Control+a');
    assert.equal(await page.locator('[data-testid=members] li').count(), 2, 'both parts are selected on layout A');
    await t('new-layout').click();
    await t('panel-library').click();
    await libCard('Plate A').locator('[data-testid=lib-add]').click();
    await libCard('Dial').locator('[data-testid=lib-add]').click();
    await t('panel-main').click();
    assert.equal(await t('members').isVisible(), false, 'layout B does not inherit the selection of A');
    await closeTabs(/./);
    await nestLayout();
    await downloaded(() => page.keyboard.press('Control+s'));
    assert.equal((await tabs()).some((x) => x.includes('•')), false, 'saved: no dot');
    const p00 = await pos(), from = [p00[0] + 20, p00[1] + 10];
    await click(...from);                                            // the part under the point is the one that moves
    const p0 = await pos();
    await dragMm(from, [from[0] + 50, from[1] + 30], [], async () => { await page.keyboard.press('Escape'); });
    assert.deepEqual(await pos(), p0, 'the part is back');
    assert.equal((await tabs()).some((x) => x.includes('•')), false, 'Esc on a drag leaves the saved tab clean');
    const gap = page.locator('[data-key=gapX]');
    await gap.fill('9'); await gap.evaluate((e) => e.blur());
    assert.equal(await gap.inputValue(), '9');
    await page.keyboard.press('Control+z');
    assert.equal(await gap.inputValue(), '5', 'a typed setting is an undo step');
    await page.keyboard.press('Control+y');
    assert.equal(await gap.inputValue(), '9');
  });

  await step('Drawing: Ctrl+A skips a locked layer (Ctrl+A then Delete cannot reach it); Match properties cannot change its objects; hidden objects stay out of the PDF', async () => {
    await openObjects();
    await oLayer('Cut').locator('[data-act=lock]').click();
    await page.keyboard.press('Control+a');
    await waitSel('1 selected');
    await page.keyboard.press('Delete');
    assert.match(await t('obj-count').textContent(), /^3 objects/, 'only the text on the open layer went');
    await page.keyboard.press('Control+z');
    assert.match(await t('obj-count').textContent(), /^4 objects/);
    if ((await oLayer('Engrave').getAttribute('aria-expanded')) !== 'true') await oLayer('Engrave').click();
    await oRow("Text 'REV A'").click(); await waitSel('1 selected');
    await t('ptab-drawing').click();
    if (!(await t('prop-match').isVisible())) await page.keyboard.press('Control+1');       // the Properties section
    await t('prop-match').click();
    await click(190, 100); await frames();                           // the circle, on the locked layer
    assert.match(await t('cmd-hist').textContent(), /nothing there/);
    await page.keyboard.press('Escape');
    // hidden one by one: left out of the PDF
    await t('ptab-objects').click();
    await oLayer('Cut').locator('[data-act=lock]').click();
    const ops = async () => { await openPdf(); const txt = pdfText(await downloaded(() => t('pdf-go').click())); return (txt.match(/ m\n/g) || []).length; };
    const all = await ops();
    await oRow('Circle Ø40').locator('[data-act=vis]').click();
    const fewer = await ops();
    assert.ok(fewer > 0 && fewer < all, `${fewer} operators with the circle hidden, ${all} with everything`);
    await oRow('Circle Ø40').locator('[data-act=vis]').click();
    assert.equal(await ops(), all, 'shown again: the same PDF');
    await t('ptab-drawing').click();
  });

  await step('TODO 63 / 102: Save As and PDF suggest each source folder; a new drawing keeps the last-used folder', async () => {
    await closeTabs(/./);
    await page.evaluate((bytes) => {
      window.__log = { dlg: [], wrote: [] }; window.__next = null;
      window.__TAURI__ = {
        dialog: {
          open: async () => window.__open,
          save: async (o) => { window.__log.dlg.push(o.defaultPath); return window.__next; },
          ask: async () => true,
        },
        fs: {
          readFile: async () => new Uint8Array(bytes), exists: async () => false,
          writeFile: async () => {},
          writeTextFile: async (p) => { window.__log.wrote.push(p); },
        },
      };
    }, [...readFileSync('fixtures/overlay.dxf')]);
    const suggestion = async (action, want) => {
      const n = await page.evaluate(() => window.__log.dlg.length);
      await action();
      await page.waitForFunction((n) => window.__log.dlg.length === n + 1, n);
      assert.equal(await page.evaluate(() => window.__log.dlg.at(-1)), want);
    };
    try {
      for (const source of ['C:\\work\\a.dxf', 'C:/drawings/panel $&.dxf']) {
        await page.evaluate((p) => { window.__open = p; window.__next = null; }, source);
        await menuItem('File', 'Open…');
        const name = source.split(/[\\/]/).pop();
        await page.waitForFunction((name) => document.querySelector('.tabs .dtab.on .tname').textContent === name, name);
        await openPdf();
        await suggestion(() => t('pdf-go').click(), source.replace(/[^\\/]*$/, () => name.replace(/\.dxf$/, '.pdf')));
        await t('pdf-cancel').click();
        const want = source.slice(0, -4) + '-edited.dxf';
        await suggestion(() => page.keyboard.press('Control+s'), want);
        await suggestion(() => menuItem('File', 'Save As…'), want);
        assert.deepEqual(await page.evaluate(() => window.__log.wrote), [], 'cancelled: no file written');
        await page.evaluate((p) => { window.__next = p; }, source);
        await suggestion(() => page.keyboard.press('Control+Shift+s'), want);
        await page.waitForFunction(() => document.querySelector('[data-testid=cmd-prompt]').textContent.includes('Pick another name: that is the opened file'));
        assert.deepEqual(await page.evaluate(() => window.__log.wrote), [], 'Save As refuses the opened file');
        await page.evaluate(() => { window.__next = 'C:\\elsewhere\\chosen.dxf'; });
        await suggestion(() => menuItem('File', 'Save As…'), want);
        await page.waitForFunction(() => window.__log.wrote.length === 1);
        await page.keyboard.press('Control+s');
        await page.waitForFunction(() => window.__log.wrote.length === 2);
        assert.deepEqual(await page.evaluate(() => window.__log.wrote), ['C:\\elsewhere\\chosen.dxf', 'C:\\elsewhere\\chosen.dxf']);
        await page.evaluate(() => { window.__next = null; });
        await suggestion(() => menuItem('File', 'Save As…'), want);
        await openPdf();
        await suggestion(() => t('pdf-print').click(), 'C:\\elsewhere\\chosen.pdf');            // after Save As elsewhere the PDF starts where the drawing now lives
        await t('pdf-cancel').click();
        await closeTabs(/./);
        await page.evaluate(() => { window.__log.wrote.length = 0; });
      }
      await page.locator('[data-tool=line]').click();
      await typeCmd('20,20'); await typeCmd('120,20'); await page.keyboard.press('Escape');
      await page.locator('[data-tool=select]').click();
      await suggestion(() => menuItem('File', 'Save As…'), 'Drawing 1.dxf');
      assert.deepEqual(await page.evaluate(() => window.__log.wrote), []);
      await closeTabs(/./);
    } finally {
      await page.evaluate(() => { delete window.__TAURI__; delete window.__log; delete window.__next; delete window.__open; localStorage.removeItem('pd-recent'); });
    }
  });

  await step('TODO 82: exact balloon sidecar grants: missing is silent, open/save need no second dialog, real write errors stay dirty', async () => {
    await closeTabs(/./);
    await page.evaluate(async (bytes) => {
      const { sidecarPath } = await import('./balloons.js');
      const log = window.__sidecarLog = { dialogs: [], wrote: [], checked: [], grants: [] };
      const allowed = new Set(), files = new Map();
      const grant = (path) => { allowed.add(path); return path; };
      const check = (path) => { if (!allowed.has(path)) throw new Error('forbidden path: ' + path); };
      window.__balloonWriteFails = true;
      window.__TAURI__ = {
        core: { invoke: async (command, { path }) => {
          if (command !== 'grant_balloon_sidecar') throw new Error('unexpected command: ' + command);
          check(path);
          await new Promise((resolve) => setTimeout(resolve, 10));
          allowed.add(sidecarPath(path)); log.grants.push(path);
        } },
        dialog: {
          open: async () => grant('C:/jobs/plate.dxf'),
          save: async (o) => { log.dialogs.push(o.defaultPath); return grant('D:/output/plate-edited.dxf'); },
          ask: async () => true,
        },
        fs: {
          readFile: async (p) => { check(p); return new Uint8Array(bytes); },
          exists: async (p) => { check(p); log.checked.push(p); return files.has(p); },
          readTextFile: async (p) => { check(p); return files.get(p); },
          writeTextFile: async (p, text) => {
            check(p);
            if (/\.json$/.test(p) && window.__balloonWriteFails) throw new Error('disk is read-only');
            log.wrote.push(p); files.set(p, text);
          },
        },
      };
    }, [...readFileSync('fixtures/outline.dxf')]);
    try {
      for (const native of [true, false]) {
        await closeTabs(/./);
        await page.evaluate(() => { window.__sidecarLog.dialogs.length = 0; window.__sidecarLog.wrote.length = 0; window.__balloonWriteFails = true; });
        if (native) await menuItem('File', 'Open…');
        else await t('picker').setInputFiles('fixtures/outline.dxf');
        await page.waitForFunction(() => /^Opened /.test(document.querySelector('[data-testid=cmd-prompt]').textContent));
        assert.doesNotMatch(await prompt(), /could not be read|forbidden path/);
        if (native) {
          await page.waitForFunction(() => window.__sidecarLog.checked.includes('C:/jobs/plate.pdballoons.json'));
          assert.deepEqual(await page.evaluate(() => window.__sidecarLog.checked), ['C:/jobs/plate.pdballoons.json']);
        }
        await typeCmd('b'); await page.waitForTimeout(200); await frames();
        await balPlace([20, 20], [50, 50]);
        await page.keyboard.press('Escape'); await page.locator('[data-tool=select]').click();
        assert.deepEqual(await balNums(), ['1']);
        await page.keyboard.press('Control+s');
        await page.waitForFunction(() => /Saving the balloons failed: disk is read-only/.test(document.querySelector('[data-testid=cmd-prompt]').textContent));
        assert.equal(await page.locator('.tabs .dtab.on .dot').count(), 1, 'a real error keeps the tab dirty');
        assert.match(await prompt(), /^Saved plate-edited.dxf\./, 'the warning confirms the DXF was saved');
        assert.deepEqual(await page.evaluate(() => window.__sidecarLog.wrote), ['D:/output/plate-edited.dxf'], 'a sidecar failure never blocks the DXF');
        assert.equal((await page.evaluate(() => window.__sidecarLog.dialogs)).length, 1);
        await menuItem('File', 'Save As…');
        await page.waitForFunction(() => window.__sidecarLog.wrote.length === 2 && /Saving the balloons failed/.test(document.querySelector('[data-testid=cmd-prompt]').textContent));
        assert.equal(await page.locator('.tabs .dtab.on .dot').count(), 1);
        await page.evaluate(() => { window.__balloonWriteFails = false; });
        await page.keyboard.press('Control+s');
        await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'plate-edited.dxf' && !document.querySelector('.tabs .dtab.on .dot'));
        const log = await page.evaluate(() => window.__sidecarLog);
        assert.equal(log.dialogs.length, 2, 'only the two drawing Save As dialogs were shown: ' + JSON.stringify(log));
        assert.ok(log.grants.includes('D:/output/plate-edited.dxf'), 'the Save picker grant is extended by an awaited command');
        if (native) assert.ok(log.grants.includes('C:/jobs/plate.dxf'), 'Open extends the grant before checking the sidecar');
        assert.ok(log.wrote.includes(native ? 'C:/jobs/plate.pdballoons.json' : 'D:/output/plate-edited.pdballoons.json'));
        assert.ok(log.wrote.includes('D:/output/plate-edited.dxf'));
        assert.ok(!log.wrote.includes('C:/jobs/plate.dxf'), 'source drawing is protected');
      }
      await closeTabs(/./);
    } finally {
      await page.evaluate(() => { delete window.__TAURI__; delete window.__sidecarLog; delete window.__balloonWriteFails; localStorage.removeItem('pd-recent'); });
    }
  });

  await step('Save in the exe: the opened file is never written; a name without .dxf that exists asks first; a balloons file that could not be read is not written over', async () => {
    const insp = [...balPdf()], sample = [...readFileSync('fixtures/sample.dxf')];
    await page.evaluate(([insp, sample]) => {
      const log = window.__log = { wrote: [], ask: [], dlg: [] };
      window.__answer = false; window.__next = null; window.__open = null;
      window.__exists = new Set(['C:\\work\\insp.pdballoons.json', 'C:\\work\\insp-x.dxf']);
      window.__TAURI__ = {
        dialog: {
          open: async () => window.__open,
          save: async (o) => { log.dlg.push(o.defaultPath); return /\.json$/.test(o.defaultPath) ? 'C:\\work\\keep.pdballoons.json' : window.__next; },
          ask: async (m) => { if (/not saved/.test(m)) return true; log.ask.push(m); return window.__answer; },       // closing a changed tab is always allowed here
        },
        fs: {
          readFile: async (p) => new Uint8Array(/\.pdf$/.test(p) ? insp : sample),
          exists: async (p) => window.__exists.has(p),
          readTextFile: async () => '{ not json',
          writeFile: async (p) => { log.wrote.push(p); },
          writeTextFile: async (p) => { log.wrote.push(p); },
        },
      };
    }, [insp, sample]);
    try {
      await closeTabs(/./);
      await page.evaluate(() => { window.__open = 'C:\\work\\insp.pdf'; });
      await menuItem('File', 'Open…');
      await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').textContent.startsWith('insp.dxf'), null, { timeout: 60000 });
      await page.waitForFunction(() => document.querySelector('[data-testid=gap-count]') && document.querySelector('[data-testid=gap-count]').textContent !== '…');
      assert.match(await prompt(), /pdballoons\.json/, 'the unreadable balloons file is said');
      await page.locator('[data-tool=select]').click();
      await typeCmd('b'); await page.waitForTimeout(200); await frames();
      await balPlace([101, 62], [130, 80]);
      await page.keyboard.press('Escape'); await page.locator('[data-tool=select]').click();
      assert.equal(await t('bal-count').textContent(), '1');
      // Save: the dialog returns a name without .dxf, and that .dxf exists: Cancel in the question writes nothing
      await openPdf(); await t('pdf-go').click();
      await page.waitForFunction(() => window.__log.dlg.at(-1) === 'C:\\work\\insp.pdf');
      await t('pdf-cancel').click();
      await t('bal-csv').click(); await t('bal-excel').click();
      assert.deepEqual(await page.evaluate(() => window.__log.dlg.slice(-2)), ['C:\\work\\insp-balloons.csv', 'C:\\work\\insp-balloons-excel.csv'], 'both tables suggest the source folder');
      assert.deepEqual(await page.evaluate(() => window.__log.wrote), [], 'cancelled table exports write nothing');
      await page.evaluate(() => { window.__next = 'C:\\work\\insp-x'; });
      await page.keyboard.press('Control+s');
      await page.waitForFunction(() => window.__log.ask.length === 1).catch(async (e) => { throw new Error(e.message + ' | prompt: ' + (await prompt()) + ' | log: ' + (await page.evaluate(() => JSON.stringify(window.__log)))); });
      assert.match(await page.evaluate(() => window.__log.ask[0]), /insp-x\.dxf already exists/);
      assert.deepEqual(await page.evaluate(() => window.__log.wrote), []);
      // Replace: the DXF is written; the balloons file that could not be read is not written to, the dialog is asked
      await page.evaluate(() => { window.__answer = true; });
      await page.keyboard.press('Control+s');
      await page.waitForFunction(() => window.__log.wrote.length === 2);
      assert.deepEqual(await page.evaluate(() => window.__log.wrote), ['C:\\work\\insp-x.dxf', 'C:\\work\\keep.pdballoons.json']);
      assert.ok((await page.evaluate(() => window.__log.dlg)).includes('C:\\work\\insp.pdballoons.json'), 'balloon Save As suggests the source folder');
      // the opened .dxf: Save refuses it, even in another case
      await closeTabs(/./);
      await page.evaluate(() => { window.__log.wrote.length = 0; window.__open = 'C:\\work\\a.dxf'; window.__exists = new Set(); window.__next = 'C:\\work\\A.DXF'; });
      await menuItem('File', 'Open…');
      await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').textContent.startsWith('a.dxf'));
      await page.keyboard.press('Control+s');
      await page.waitForFunction(() => window.__log.dlg.length >= 3);
      assert.match(await prompt(), /Pick another name: that is the opened file/);
      assert.deepEqual(await page.evaluate(() => window.__log.wrote), [], 'the opened file was not written');
      await page.evaluate(() => { window.__next = 'C:\\work\\a-edited.dxf'; });
      await page.keyboard.press('Control+s');
      await page.waitForFunction(() => window.__log.wrote.length === 1);
      assert.deepEqual(await page.evaluate(() => window.__log.wrote), ['C:\\work\\a-edited.dxf']);
    } finally {
      await page.evaluate(() => { delete window.__TAURI__; delete window.__log; localStorage.removeItem('pd-recent'); });
    }
  });

  await step('Save in the exe: a cancelled balloons Save dialog writes nothing', async () => {
    await closeTabs(/./);
    page.once('dialog', (dlg) => dlg.accept());
    await t('picker').setInputFiles('fixtures/text-only.pdf');
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on').textContent.startsWith('text-only.pdf'), null, { timeout: 60000 });
    await page.locator('[data-tool=balloon]').click();
    const b = await page.locator('rect.sheet').boundingBox(), sc = b.height / Number(await page.locator('[data-key=sheetH]').inputValue());
    for (const [x, y] of [[50, 50], [90, 80]]) await page.mouse.click(b.x + x * sc, b.y + b.height - y * sc);
    assert.deepEqual(await balNums(), ['1']);
    await page.evaluate(() => {
      const log = window.__log = { wrote: [], dlg: [] };
      window.__TAURI__ = { dialog: { save: async (o) => { log.dlg.push(o.defaultPath); return null; } }, fs: { writeTextFile: async (p) => { log.wrote.push(p); }, writeFile: async (p) => { log.wrote.push(p); } } };
    });
    try {
      const dls = await downloadsUtf8(() => page.keyboard.press('Control+s'), 1);
      assert.deepEqual(await page.evaluate(() => window.__log.dlg), ['text-only.pdballoons.json'], 'it asked where to put the balloons');
      assert.deepEqual(await page.evaluate(() => window.__log.wrote), [], 'cancelled: nothing written');
      assert.deepEqual(dls, [], 'and nothing downloaded instead');
    } finally {
      await page.evaluate(() => { delete window.__TAURI__; delete window.__log; });
    }
  });

  await step('TODO 34 Shortcuts: aliases + keys, capture, clashes, Swap, persistence and native PGP round trip', async () => {
    const scCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    const p = await scCtx.newPage();
    p.on('pageerror', (err) => errors.push(String(err)));
    const dialog = p.getByRole('dialog', { name: 'Shortcuts', exact: true });
    const alias = (name) => dialog.getByRole('textbox', { name: name + ' aliases', exact: true });
    const key = (name) => dialog.getByRole('button', { name: name + ' key', exact: true });
    const save = () => dialog.getByRole('button', { name: 'Save', exact: true }).click();
    const command = async (word, accept = 'Enter') => {
      await p.locator('[data-testid=cmd-echo]').click();
      await p.locator('[data-testid=cmd-input]').fill(word); await p.locator('[data-testid=cmd-input]').press(accept);
    };
    const open = async () => {
      await p.locator('[data-menu=Tools]').click(); await p.getByRole('menuitem', { name: 'Shortcuts…' }).click(); await dialog.waitFor();
    };
    const shot = async (state) => {
      for (const theme of ['light', 'dark']) {
        await p.evaluate((th) => { document.documentElement.dataset.theme = th; }, theme);
        await p.screenshot({ path: `${shotDir}/R12-built-${state}-${theme}.png` });
      }
      await p.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    };
    try {
      await p.goto(URL_); await p.waitForSelector('[data-testid=count]', { state: 'attached' });
      await p.locator('[data-testid=picker]').setInputFiles('fixtures/outline.dxf');
      await p.waitForFunction(() => document.querySelector('.tabs').textContent.includes('outline.dxf'));
      await open();
      assert.equal(await dialog.locator('tr[data-command]').count(), COMMANDS.length);
      assert.equal(await dialog.locator('.sc-count').textContent(), COMMANDS.length + ' commands');
      await dialog.getByRole('searchbox').fill('contour'); assert.equal(await dialog.locator('.sc-count').textContent(), '1 commands');
      await dialog.getByRole('searchbox').fill(''); await dialog.getByLabel('Category', { exact: true }).selectOption('File');
      assert.equal(await dialog.locator('tr[data-command]:visible').count(), COMMANDS.filter((c) => c.cat === 'File').length);
      await dialog.getByLabel('Category', { exact: true }).selectOption('');
      await alias('Contour').fill('co, ww');
      await key('Contour').click(); await p.keyboard.press('Control+Alt+w');
      assert.equal(await key('Contour').textContent(), 'Ctrl+Alt+W');
      await key('Contour').click(); await p.keyboard.press('Escape');
      assert.equal(await key('Contour').textContent(), 'Ctrl+Alt+W', 'capture Esc keeps old key and leaves dialog open');
      assert.equal(await dialog.locator('.sc-edited').count(), 1);
      await shot('A');
      await alias('Contour').fill('co, mi'); await key('Contour').click(); await p.keyboard.press('Control+g');
      assert.match(await dialog.textContent(), /Alias “mi” is used by Mirror/);
      assert.match(await dialog.textContent(), /Key “Ctrl\+G” is used by Group/);
      assert.equal(await dialog.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
      await key('Contour').click(); await p.keyboard.press('Control+s');
      assert.match(await dialog.locator('.sc-status').textContent(), /Reserved for Save/);
      assert.equal(await key('Contour').textContent(), 'Ctrl+G');
      await shot('C');
      await dialog.getByRole('button', { name: 'Swap alias clash' }).click();
      assert.equal(await alias('Contour').inputValue(), 'mi'); assert.equal(await alias('Mirror').inputValue(), 'co, ww');
      await dialog.getByRole('button', { name: 'Swap key clash' }).click();
      assert.equal(await key('Contour').textContent(), 'Ctrl+G'); assert.equal(await key('Group').textContent(), 'Ctrl+Alt+W');
      assert.equal(await dialog.getByRole('button', { name: 'Save', exact: true }).isDisabled(), false);
      await dialog.getByRole('button', { name: 'Reset Mirror', exact: true }).click();
      await dialog.getByRole('button', { name: 'Cancel alias clash' }).click();
      assert.equal(await alias('Mirror').inputValue(), 'co, ww', 'Cancel undoes a row reset that clashes with another own alias');
      await dialog.getByRole('button', { name: 'Reset Group', exact: true }).click();
      await dialog.getByRole('button', { name: 'Cancel key clash' }).click();
      assert.equal(await key('Group').textContent(), 'Ctrl+Alt+W', 'Cancel restores the reset key, keeping the other command alone');
      await dialog.getByRole('button', { name: 'Reset all', exact: true }).click();
      await alias('Contour').fill('co, ww'); await key('Contour').click(); await p.keyboard.press('Control+Alt+w');
      await alias('Contour').fill('co, mi'); await dialog.getByRole('button', { name: 'Cancel alias clash' }).click();
      assert.equal(await alias('Contour').inputValue(), 'co, ww', 'Cancel restores previous alias cell');
      await key('Contour').click(); await p.keyboard.press('w');
      assert.match(await dialog.locator('.sc-status').textContent(), /typing and drawing/);
      assert.equal(await key('Contour').textContent(), 'Ctrl+Alt+W');
      // A failed storage write keeps the dialog and does not activate its draft.
      await p.evaluate(() => {
        window.__scTx = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (...args) { if (args[1] === 'readwrite' && this.name === 'project-d-shortcuts') throw new Error('disk full'); return window.__scTx.apply(this, args); };
      });
      await save(); await dialog.getByRole('status').filter({ hasText: 'Save failed: disk full' }).waitFor();
      await p.evaluate(() => { IDBDatabase.prototype.transaction = window.__scTx; delete window.__scTx; });
      await save(); await dialog.waitFor({ state: 'hidden' });
      await command('ww', 'Space');
      assert.equal((await p.locator('[data-testid=tool-chip]').textContent()).trim(), 'Tool: Contour');
      await command('select'); await p.keyboard.press('Control+Alt+w');
      assert.equal((await p.locator('[data-testid=tool-chip]').textContent()).trim(), 'Tool: Contour');
      await command('shortcuts'); await dialog.waitFor();
      await p.evaluate(() => {
        window.__scFiles = { text: '', writes: 0, save: [], open: [] };
        window.__TAURI__ = {
          dialog: { save: async (o) => { window.__scFiles.save.push(o); return 'C:/shortcuts'; }, open: async (o) => { window.__scFiles.open.push(o); return 'C:/shortcuts.pgp'; } },
          fs: { exists: async () => false, writeTextFile: async (path, text) => { window.__scFiles.path = path; window.__scFiles.text = text; window.__scFiles.writes++; }, readFile: async () => new TextEncoder().encode(window.__scFiles.text + '\nXX, *UNKNOWN\n;KEY UNKNOWN, F6\n; ignored comment') },
        };
      });
      await dialog.getByRole('button', { name: 'Export .pgp', exact: true }).click();
      await p.waitForFunction(() => window.__scFiles.writes === 1);
      const exported = await p.evaluate(() => window.__scFiles);
      assert.equal(exported.path, 'C:/shortcuts.pgp'); assert.equal(exported.save[0].defaultPath, 'shortcuts.pgp');
      assert.match(exported.text, /WW,        \*CONTOUR/); assert.match(exported.text, /;KEY CONTOUR, Ctrl\+Alt\+W/);
      await dialog.getByRole('button', { name: 'Reset all', exact: true }).click();
      await dialog.getByRole('button', { name: 'Import .pgp', exact: true }).click();
      await dialog.getByRole('status').filter({ hasText: '2 lines skipped' }).waitFor();
      assert.equal(await alias('Contour').inputValue(), 'co, ww'); assert.equal(await key('Contour').textContent(), 'Ctrl+Alt+W');
      assert.deepEqual(await p.evaluate(() => window.__scFiles.open[0].filters[0].extensions), ['pgp']);
      await save(); await dialog.waitFor({ state: 'hidden' });
      await p.reload(); await p.waitForSelector('[data-testid=count]', { state: 'attached' });
      await open(); assert.equal(await alias('Contour').inputValue(), 'co, ww'); assert.equal(await key('Contour').textContent(), 'Ctrl+Alt+W');
      const stored = await p.evaluate(async () => {
        const { idbStore } = await import('./idbstore.js'); return idbStore('project-d-shortcuts', 'settings', 'test').all();
      });
      assert.deepEqual(stored, [{ id: 'own', overrides: { contour: { alias: ['co', 'ww'], key: 'Ctrl+Alt+W' } } }]);
      await dialog.getByRole('button', { name: 'Reset all', exact: true }).click();
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await open(); assert.equal(await alias('Contour').inputValue(), 'co, ww', 'Cancel leaves saved settings alone');
      await dialog.getByRole('button', { name: 'Reset all', exact: true }).click(); await save(); await dialog.waitFor({ state: 'hidden' });
      await p.reload(); await p.waitForSelector('[data-testid=count]', { state: 'attached' }); await open();
      assert.equal(await alias('Contour').inputValue(), 'co'); assert.equal(await key('Contour').textContent(), 'Press keys…');
    } finally { await scCtx.close(); }
  });

  await step('TODO 52: File → Export for cutter… asks for the tolerance (bad values refused), cancels cleanly, then writes lines / arcs / polylines only; screenshots light and dark', async () => {
    await closeTabs(/./);
    const d = newDoc(4); addEntities(d, [dxfPoly([[0, 0], [100, 0], [100, 60], [0, 60]], { closed: true }), dxfCircle(50, 30, 15), dxfText(10, 10, 5, 'HELLO')]);
    await t('picker').setInputFiles({ name: 'cut-plate.dxf', mimeType: 'application/dxf', buffer: Buffer.from(writeDxf(d)) });
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'cut-plate.dxf');
    const dlg = t('cutter-dialog');
    const shot = async (n) => { await dlg.waitFor(); await page.waitForTimeout(250); await page.screenshot({ path: `${shotDir}/s11-52-${n}.png` }); };
    await menuItem('File', 'Export for cutter…'); await dlg.waitFor();
    assert.equal(await t('cutter-name').textContent(), 'cut-plate-cutter.dxf');
    assert.equal(await t('cutter-tol').inputValue(), '0.01');
    assert.match(await dlg.textContent(), /Line widths are not written \(cutters ignore them\)\./);
    assert.equal(await t('cutter-left').textContent(), '1 text / fill object left out');
    for (const bad of ['abc', '0', '-1']) {
      await t('cutter-tol').fill(bad);
      assert.equal(await t('cutter-err').isVisible(), true, bad + ' is refused');
      assert.match(await t('cutter-err').textContent(), /tolerance must be a number above 0/);
      assert.match(await t('cutter-tol').getAttribute('class'), /invalid/);
    }
    await t('cutter-go').click();
    assert.equal(await dlg.isVisible(), true, 'a bad tolerance keeps the dialog open');
    assert.match(await prompt(), /tolerance must be a number above 0/);
    await t('cutter-tol').fill('0.05');
    assert.equal(await t('cutter-err').isVisible(), false);
    await shot('light');
    await t('cutter-cancel').click(); await dlg.waitFor({ state: 'detached' });
    await menuItem('View', 'Theme: dark');
    await menuItem('File', 'Export for cutter…'); await shot('dark');
    await page.keyboard.press('Escape'); await dlg.waitFor({ state: 'detached' });
    await menuItem('View', 'Theme: light');
    assert.deepEqual(await tabNames(), ['cut-plate.dxf']); assert.equal(await page.locator('.tabs .dtab.on .dirty').count(), 0, 'cancelled: the tab is untouched');

    await page.evaluate(() => {
      window.__cut = { dlg: [], wrote: [] };
      window.__TAURI__ = { dialog: { save: async (o) => { window.__cut.dlg.push(o.defaultPath); return 'C:\\out\\plate-cutter.dxf'; }, ask: async () => true },
        fs: { exists: async () => false, writeTextFile: async (p, text) => { window.__cut.wrote.push([p, text]); } } };
    });
    try {
      await menuItem('File', 'Export for cutter…'); await dlg.waitFor();
      await t('cutter-tol').fill('0.05'); await t('cutter-go').click();
      await page.waitForFunction(() => window.__cut.wrote.length === 1);
      const { dlg: asked, wrote } = await page.evaluate(() => window.__cut);
      assert.deepEqual(asked, ['cut-plate-cutter.dxf']); assert.equal(wrote[0][0], 'C:\\out\\plate-cutter.dxf');
      const back = readDxf(wrote[0][1]);
      assert.deepEqual([...new Set(back.entities.map((e) => e.type))].sort(), ['ARC', 'LWPOLYLINE']);
      assert.match(await prompt(), /Exported plate-cutter\.dxf for the cutter, curves flattened to 0\.05 mm \(1 text \/ fill object left out\)/);
      assert.deepEqual(await tabNames(), ['cut-plate.dxf'], 'the tab keeps its own name and file');
    } finally { await page.evaluate(() => { delete window.__TAURI__; delete window.__cut; }); }
    await closeTabs(/./);

  });

  await step('Export for cutter: app converts default and edited mm tolerances on an inch drawing', async () => {
    await closeTabs(/./);
    const inch = newDoc(1); addEntities(inch, dxfEllipse(0, 0, 4, 0, .4));
    await openGrips(writeDxf(inch), 'cutter-inches.dxf');
    for (const mm of [.01, .05]) {
      await menuItem('File', 'Export for cutter…'); await t('cutter-dialog').waitFor();
      if (mm !== .01) await t('cutter-tol').fill(String(mm));
      const back = readDxf((await downloaded(() => t('cutter-go').click())).text);
      assert.equal(back.header.$INSUNITS, '1', 'export keeps inch units');
      assert.deepEqual(back.entities.map((e) => e.type), ['LWPOLYLINE']);
      const r = back.entities[0].r, pts = [];
      r.c.forEach((code, i) => { if (code === 10) pts.push([+r.v[i] * 25.4, +r.v[i + 1] * 25.4]); });
      let worst = 0;
      for (let i = 0; i < 4096; i++) {
        const angle = i * 2 * Math.PI / 4096, x = 4 * 25.4 * Math.cos(angle), y = 1.6 * 25.4 * Math.sin(angle);
        let best = Infinity;
        pts.forEach((a, j) => {
          const b = pts[(j + 1) % pts.length], dx = b[0] - a[0], dy = b[1] - a[1];
          const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
          best = Math.min(best, Math.hypot(x - a[0] - u * dx, y - a[1] - u * dy));
        });
        worst = Math.max(worst, best);
      }
      assert.ok(worst <= mm + .0001, `inch export deviation ${worst} mm exceeds ${mm} mm (plus DXF rounding)`);
    }
    await closeTabs(/./);
  });

  await step('TODO 54 Wireframe: menu, chip and F9; fills, pictures, selection, snaps, persistence, all tabs; PDF and DXF unchanged', async () => {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    const p = await c.newPage(), q = (id) => p.locator(`[data-testid=${id}]`);
    p.on('pageerror', (e) => errors.push(String(e)));
    const frame = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const menu = async (item) => { await p.locator('[data-menu=View]').click(); await p.getByRole(item.startsWith('Theme:') ? 'menuitemcheckbox' : 'menuitem', { name: item.startsWith('Theme:') ? new RegExp(item + '$') : item, exact: true }).click(); await frame(); };
    const download = async (act) => { const [dl] = await Promise.all([p.waitForEvent('download'), act()]); return readFileSync(await dl.path()); };
    const pdf = async () => {
      await q('pdf-open').click(); await q('pdf-dialog').waitFor(); await frame();
      const preview = await q('pdf-preview').evaluate((el) => el.toDataURL());
      const bytes = await download(() => q('pdf-go').click());
      await q('pdf-dialog').waitFor({ state: 'detached' });
      return { preview, bytes };
    };
    const pixelCount = () => q('drawing').evaluate((el) => {
      const pixels = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
      let n = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) n++;
      return n;
    });
    const clickPoint = async (x, y) => {
      const pt = await p.evaluate(([x, y]) => {
        const svg = document.querySelector('[data-testid=canvas] > svg'), v = svg.viewBox.baseVal, b = svg.getBoundingClientRect();
        const h = +document.querySelector('[data-key=sheetH]').value;
        return { x: b.x + (x - v.x) * b.width / v.width, y: b.y + (h - y - v.y) * b.height / v.height };
      }, [x, y]);
      await p.mouse.click(pt.x, pt.y);
    };
    try {
      await p.goto(URL_); await q('wireframe').waitFor();
      await menu('Theme: light');
      await q('picker').setInputFiles('fixtures/wireframe.dxf');
      await p.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'wireframe.dxf');
      await q('bg-picker').setInputFiles('fixtures/bg.png');
      await p.waitForFunction(() => document.querySelector('[data-testid=bg-name]').textContent === 'bg.png');
      const saved = await download(() => p.keyboard.press('Control+s'));
      const drawingName = await p.locator('.tabs .dtab.on .tname').textContent();
      const normalPdf = await pdf();
      for (const theme of ['light', 'dark']) {
        await menu('Theme: ' + theme);
        const beforePdf = await pdf();
        const normal = await pixelCount();
        await p.screenshot({ path: `${shotDir}/wire-${theme}-normal.png` });
        await p.locator('[data-menu=View]').click();
        const item = p.getByRole('menuitemcheckbox', { name: /Wireframe/ });
        assert.equal(await item.getAttribute('aria-checked'), 'false');
        assert.equal(await item.getAttribute('aria-keyshortcuts'), 'F9');
        await item.click(); await frame();
        assert.equal(await q('wireframe').getAttribute('aria-pressed'), 'true');
        assert.ok(await pixelCount() < normal / 3, 'fills and picture are gone');
        assert.equal(await p.locator('.tabs .dtab.on .dot').count(), 0, 'a view toggle does not dirty the drawing');
        await p.screenshot({ path: `${shotDir}/wire-${theme}-wireframe.png` });
        const afterPdf = await pdf();
        assert.deepEqual(afterPdf.bytes, normalPdf.bytes, 'PDF bytes keep fills, colours and widths in either theme');
        assert.ok(afterPdf.preview === beforePdf.preview, 'PDF preview keeps fills, colours and widths');
        assert.deepEqual(await download(() => p.keyboard.press('Control+s')), saved, 'DXF is unchanged');
        await q('wireframe').click(); await frame();
        assert.equal(await q('wireframe').getAttribute('aria-pressed'), 'false');
        assert.equal(await pixelCount(), normal, 'turning off restores the picture and fills');
      }
      await p.keyboard.press('F9'); await frame();
      await clickPoint(8, 55);
      await p.waitForFunction(() => document.querySelectorAll('[data-testid=grip]').length === 3);
      await p.keyboard.press('Escape');
      await p.locator('[data-tool=measure]').click();
      await clickPoint(5.3, 55.2); await clickPoint(234.7, 55.2);
      assert.match(await q('cmd-prompt').textContent(), /Distance 230 mm.*ΔX 230.*ΔY 0/);
      await p.keyboard.press('Escape'); await p.locator('[data-tool=select]').click();
      // tints survive Wireframe: Compare's two colours, and a part off the sheet in the mark colour
      const tinted = (test) => q('drawing').evaluate((el, src) => {
        const t = new Function('r', 'g', 'b', 'return ' + src), d = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
        let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 60 && t(d[i], d[i + 1], d[i + 2])) n++;
        return n;
      }, test);
      const waitTinted = async (test, what) => {
        let n = await tinted(test);
        for (let i = 0; i < 40 && n < 10; i++) { await p.waitForTimeout(50); n = await tinted(test); }
        assert.ok(n >= 10, what + ': ' + n);
      };
      await q('picker').setInputFiles('fixtures/outline.dxf');
      await p.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'outline.dxf');
      await clickPoint(50, 0);
      await p.waitForFunction(() => !document.querySelector('[data-testid=bar-extract]').disabled);
      await q('bar-extract').click();
      await q('name-input').fill('Plate A'); await p.keyboard.press('Enter');
      await q('name-dialog').waitFor({ state: 'detached' });
      await p.locator('[data-menu=File]').click(); await p.getByRole('menuitem', { name: 'Compare drawings…', exact: true }).click();
      await p.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'Compare');
      assert.equal(await q('wireframe').getAttribute('aria-pressed'), 'true');
      // hue tests in the dark theme (red #ff7b7b, blue #6db0ff, mark #fb923c); light has its own shades
      await menu('Theme: dark');
      await waitTinted('r > 150 && r - g > 60 && Math.abs(g - b) < 20', 'Compare keeps drawing 1 in red in Wireframe');
      await waitTinted('b > 150 && b - r > 60 && b - g > 40', 'Compare keeps drawing 2 in blue in Wireframe');
      await q('new-layout').click();
      await q('panel-library').click();
      await p.locator('[data-testid=lib-list] .card[data-name="Plate A"] [data-testid=lib-add]').click();
      await q('panel-main').click();
      await q('px').fill('950'); await q('px').press('Enter');
      await waitTinted('r > 150 && r - g > 40 && g - b > 40', 'a part off the sheet keeps the mark colour in Wireframe');
      await q('new-tab').click();
      assert.equal(await q('wireframe').getAttribute('aria-pressed'), 'true');
      await q('new-layout').click();
      assert.equal(await q('wireframe').getAttribute('aria-pressed'), 'true', 'layout tabs share the setting');
      await p.locator('.tabs .dtab', { hasText: drawingName }).click();
      await p.reload(); await q('wireframe').waitFor();
      assert.equal(await q('wireframe').getAttribute('aria-pressed'), 'true', 'remembered after restart');
      await p.locator('[data-menu=View]').click();
      assert.equal(await p.getByRole('menuitemcheckbox', { name: /Wireframe/ }).getAttribute('aria-checked'), 'true');
      await p.keyboard.press('Escape'); await q('wireframe').click();
      await p.waitForFunction(async () => {
        const { idbStore } = await import('./idbstore.js');
        return (await idbStore('project-d-view', 'settings', 'test').all()).some((r) => r.id === 'wireframe' && r.on === false);
      });
      await p.reload(); await q('wireframe').waitFor();
      assert.equal(await q('wireframe').getAttribute('aria-pressed'), 'false', 'off is remembered too');
    } finally { await c.close(); }
  });

  await step('TODO 53: Text to outlines (Modify menu, TXO): closed polylines in the text\'s place and size, one undo; the Windows font file when it can be read, the bundled Liberation Sans (named in the message) when not; "Select text" prompt', async () => {
    const txoDone = async (which) => { try { await page.waitForFunction(() => /→/.test(document.querySelector('[data-testid=cmd-prompt]').textContent), null, { timeout: 15000 }); } catch (e) { throw new Error('run ' + which + ': no result; the prompt says: ' + (await prompt()) + ' / console: ' + errors.join(' | ')); } };
    const theme = async (name) => { await menuItem('View', 'Theme: ' + name); await page.waitForTimeout(150); };
    await closeTabs(/./); await t('new-tab').click();
    await page.locator('[data-tool=text]').click();
    await t('text-height').fill('12'); await t('text-height').press('Enter'); await t('text-font').selectOption('Standard');
    await click(30, 100); await t('text-editor').waitFor(); await page.keyboard.type('BOB'); await page.keyboard.press('Enter');
    assert.equal(await entCount(), 1);
    await page.screenshot({ path: shotDir + '/txo-before-light.png' });
    await theme('dark'); await page.screenshot({ path: shotDir + '/txo-before-dark.png' }); await theme('light');
    // the Modify menu lists it, with its alias
    await page.locator('[data-menu=Modify]').click();
    assert.deepEqual(await page.getByRole('menuitem').allTextContents().then((a) => a.filter((x) => /outlines/.test(x))).then((a) => a.map((x) => x.replace(/\s+/g, ' ').trim())), ['Text to outlinesTXO']);
    await page.screenshot({ path: shotDir + '/txo-menu-light.png' });
    await theme('dark'); await page.locator('[data-menu=Modify]').click(); await page.screenshot({ path: shotDir + '/txo-menu-dark.png' }); await page.keyboard.press('Escape'); await theme('light');
    await page.locator('[data-tool=select]').click(); await page.keyboard.press('Control+a');                  // Esc let go of the text: select it again
    const t0 = (await savedDoc()).entities[0], ax = fieldOf(t0, 10), ay = fieldOf(t0, 20);       // where the text is, as saved
    // the app: C:\Windows\Fonts is read through Tauri's fs (here a stub that has only the Segoe UI file)
    await page.evaluate(async () => {
      const b = new Uint8Array(await (await fetch('vendor/fonts/LiberationSans-Regular.ttf')).arrayBuffer());
      window.__fontReads = [];
      window.__fontDenied = true;
      window.__TAURI__ = { fs: { readFile: async (p) => { window.__fontReads.push(p); if (!window.__fontDenied && /segoeui\.ttf$/.test(p)) return b; throw new Error('forbidden path: ' + p); } } };
    });
    await menuItem('Modify', 'Text to outlines');
    await txoDone('83 bundled');
    assert.equal(await prompt(), '1 text → 8 outlines. Font file not found, used the fallback font (Segoe UI → Liberation Sans). Ctrl+Z takes them back', 'TODO 83: a denied Windows read still loads the embedded font');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+a');
    await page.evaluate(() => { window.__fontDenied = false; window.__fontReads.length = 0; });
    await menuItem('Modify', 'Text to outlines');
    await txoDone(1);
    assert.equal(await prompt(), '1 text → 8 outlines. Ctrl+Z takes them back', 'B has two counters, O one: three letters, eight outlines; no fallback named');
    assert.deepEqual(await page.evaluate(() => window.__fontReads), ['C:/Windows/Fonts/segoeui.ttf']);
    await page.evaluate(() => { delete window.__TAURI__; delete window.__fontReads; delete window.__fontDenied; });
    await page.screenshot({ path: shotDir + '/txo-after-light.png' });
    await theme('dark'); await page.screenshot({ path: shotDir + '/txo-after-dark.png' }); await theme('light');
    let doc = await savedDoc();
    assert.equal(doc.entities.length, 8); assert.ok(doc.entities.every((e) => e.type === 'LWPOLYLINE' && e.layer === '0' && e.r.v[e.r.c.indexOf(70)] === '1'), 'closed polylines, no TEXT left');
    const xs = doc.entities.flatMap((e) => e.r.c.flatMap((c, k) => (c === 10 ? [+e.r.v[k]] : []))), ys = doc.entities.flatMap((e) => e.r.c.flatMap((c, k) => (c === 20 ? [+e.r.v[k]] : [])));
    assert.ok(Math.abs(Math.min(...ys) - ay) < 0.6, 'on the baseline of the text: ' + Math.min(...ys));
    assert.ok(Math.max(...ys) - Math.min(...ys) > 11 && Math.max(...ys) - Math.min(...ys) < 14, 'the 12 mm text height');
    assert.ok(Math.min(...xs) > ax - 1 && Math.min(...xs) < ax + 3 && Math.max(...xs) - Math.min(...xs) > 20, 'starts at the text');
    assert.equal(await t('selbar').isVisible() || await t('textbar').isVisible(), true);
    assert.deepEqual((await histLabels()).slice(-1), ['Text to outlines × 1']);
    await page.keyboard.press('Control+z');
    assert.equal(await entCount(), 1, 'one undo brings the text back');
    doc = await savedDoc();
    assert.equal(doc.entities[0].type, 'TEXT');
    // a second text in Arial-like; no Tauri here, so the bundled font stands in and the message says which
    await page.locator('[data-tool=text]').click(); await t('text-font').selectOption('Arial');
    await page.mouse.click(500, 700); await t('text-editor').waitFor(); await page.keyboard.type('AB'); await page.keyboard.press('Enter');      // an empty spot: the text tool edits a text it is clicked on, and BOB is right there
    assert.equal(await entCount(), 2, 'AB is a new text, not typed into BOB');
    await page.locator('[data-tool=select]').click();                                       // the text tool's own prompt would cover the message
    await menuItem('Modify', 'Text to outlines');
    await txoDone(2);
    assert.equal(await prompt(), '1 text → 5 outlines. Font file not found, used the fallback font (Arial → Liberation Sans). Ctrl+Z takes them back');
    await page.keyboard.press('Control+z');
    // nothing selected: the command asks for text, Enter runs it on what was picked
    await page.locator('[data-tool=select]').click();
    await click(150, 20);
    await typeCmd('txo');
    assert.equal(await prompt(), 'Text to outlines: select the texts (click or drag a box), then press Enter');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Enter');                                                      // on the drawing, as the prompt says
    await txoDone(3);
    assert.match(await prompt(), /^2 texts → 13 outlines/);
    await page.keyboard.press('Control+z');
    assert.equal(await entCount(), 2);
    await closeTabs(/./);
  });

  await step('TODO 91 / T10: Explode menu, X / EXPLODE, new pieces selected and one Undo restores the polyline', async () => {
    await closeTabs(/./);
    const doc = newDoc();
    addEntities(doc, roundRect(100, 100, 100, 70, 15), dxfLine(250, 100, 300, 100));
    await t('picker').setInputFiles({ name: 'explode.dxf', mimeType: 'text/plain', buffer: Buffer.from(writeDxf(doc)) });
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'explode.dxf');
    const theme = async (name) => { await menuItem('View', 'Theme: ' + name); await page.waitForTimeout(150); };
    const historyBefore = await histLabels();
    await typeCmd('x');
    assert.match(await prompt(), /^Explode: nothing explodable \(0 exploded\)/);
    assert.deepEqual(await histLabels(), historyBefore, 'empty selection adds no Undo step');
    await click(140, 100); await waitSel('1 selected');
    for (const name of ['light', 'dark']) {
      await theme(name); await page.locator('[data-menu=Modify]').click();
      const item = page.getByRole('menuitem', { name: /^Explode/ });
      await item.waitFor(); assert.equal(await item.getAttribute('aria-disabled'), null);
      await page.screenshot({ path: shotDir + '/knight-91-menu-' + name + '.png' });
      await page.locator('[data-menu=Modify]').click();
    }
    await theme('light'); await typeCmd('X');
    assert.equal(await entCount(), 9, 'one polyline became four lines and four arcs; the other line stays');
    await waitSel('8 selected');
    assert.match(await prompt(), /^Explode: 1 exploded → 8 pieces/);
    const saved = await savedDoc();
    assert.deepEqual(saved.entities.map((e) => e.type), ['LINE', 'ARC', 'LINE', 'ARC', 'LINE', 'ARC', 'LINE', 'ARC', 'LINE']);
    assert.deepEqual((await histLabels()).slice(-1), ['Explode']);
    for (const name of ['light', 'dark']) {
      await theme(name);
      await page.screenshot({ path: shotDir + '/knight-91-result-' + name + '.png' });
    }
    await theme('light'); await page.keyboard.press('Control+z');
    assert.equal(await entCount(), 2, 'one Undo restores the polyline and leaves the other line');
    assert.deepEqual((await savedDoc()).entities.map((e) => e.type), ['LWPOLYLINE', 'LINE']);
    await click(140, 100); await menuItem('Modify', 'Explode');
    assert.equal(await entCount(), 9, 'the menu action also explodes');
    await page.keyboard.press('Control+z');
    await click(250, 100); await waitSel('1 selected');
    const beforeLine = await histLabels();
    await typeCmd('EXPLODE');
    assert.match(await prompt(), /^Explode: nothing explodable/);
    assert.equal(await entCount(), 2); assert.deepEqual(await histLabels(), beforeLine, 'a LINE adds no Undo step');
    await closeTabs(/./);
    const block = newDoc();
    addLayer(block, 'Cut', { aci: 3 });
    addBlock(block, 'Inner', [dxfLine(0, 0, 20, 0, { aci: 0 })]);
    addBlock(block, 'Outer', [dxfInsert('Inner', 20, 20, { aci: 0 }), dxfLine(0, 0, 0, 30)]);
    addEntities(block, dxfInsert('Outer', 100, 100, { layer: 'Cut', rot: 90, sx: -2, sy: 3, aci: 1 }));
    await t('picker').setInputFiles({ name: 'explode-block.dxf', mimeType: 'text/plain', buffer: Buffer.from(writeDxf(block)) });
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'explode-block.dxf');
    await page.keyboard.press('Control+a'); await typeCmd('EXPLODE');
    assert.equal(await entCount(), 2); await waitSel('2 selected');
    const oneLevel = await savedDoc();
    assert.deepEqual(oneLevel.entities.map((e) => e.type), ['INSERT', 'LINE']);
    assert.equal(oneLevel.entities[0].layer, 'Cut'); assert.equal(oneLevel.entities[0].aci, 1);
    await typeCmd('x');
    assert.deepEqual((await savedDoc()).entities.map((e) => e.type), ['LINE', 'LINE']);
    await page.keyboard.press('Control+z'); assert.deepEqual((await savedDoc()).entities.map((e) => e.type), ['INSERT', 'LINE']);
    await closeTabs(/./);
  });

  await step('TODO 122a: Shaping (Modify menu, WELD / SHAPETRIM / INTERSECT): two squares, each operation gives the exact area in one undo step; Trim cuts the last picked one and keeps the cutter; open outlines and too few outlines say so', async () => {
    const theme = async (name) => { await menuItem('View', 'Theme: ' + name); await page.waitForTimeout(150); };
    await closeTabs(/./);
    const doc = newDoc();
    addEntities(doc, dxfPoly([[100, 100], [160, 100], [160, 160], [100, 160]], { closed: true }), dxfPoly([[130, 130], [190, 130], [190, 190], [130, 190]], { closed: true }), dxfPoly([[300, 100], [350, 100], [350, 150]]));
    await t('picker').setInputFiles({ name: 'shaping.dxf', mimeType: 'text/plain', buffer: Buffer.from(writeDxf(doc)) });
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'shaping.dxf');
    assert.equal(await entCount(), 3);
    // the Modify menu lists all seven after the existing items
    await page.locator('[data-menu=Modify]').click();
    assert.deepEqual(await page.getByRole('menuitem').allTextContents().then((a) => a.filter((x) => /^Shaping/.test(x)).map((x) => x.trim())), ['Shaping: Weld', 'Shaping: Trim', 'Shaping: Intersect', 'Shaping: Simplify', 'Shaping: Front minus back', 'Shaping: Back minus front', 'Shaping: Create boundary']);
    await page.screenshot({ path: shotDir + '/shaping-menu-light.png' });
    await theme('dark'); await page.locator('[data-menu=Modify]').click(); await page.screenshot({ path: shotDir + '/shaping-menu-dark.png' }); await page.keyboard.press('Escape'); await theme('light');
    // one outline picked: too few
    await click(100, 130); await waitSel('1 selected');
    await menuItem('Modify', 'Shaping: Weld');
    assert.match(await prompt(), /^Weld: select at least 2 closed outlines/);
    assert.equal(await entCount(), 3);
    // two clicked squares (the second one last), and the open polyline picked too
    await click(190, 160, { shift: true }); await click(300, 100, { shift: true });
    await menuItem('Modify', 'Shaping: Weld');
    assert.equal(await prompt(), 'Weld: 2 outlines → 1 outline, area 6300.00 mm²; 1 open outline skipped. Ctrl+Z puts the originals back');
    assert.equal(await entCount(), 2, 'both squares are gone, one outline and the open polyline are there');
    await page.screenshot({ path: shotDir + '/shaping-weld-light.png' });
    await theme('dark'); await page.screenshot({ path: shotDir + '/shaping-weld-dark.png' }); await theme('light');
    let saved = await savedDoc();
    const lw = saved.entities.filter((e) => e.type === 'LWPOLYLINE' && e.r.v[e.r.c.indexOf(70)] === '1');
    assert.equal(lw.length, 1); assert.equal(lw[0].layer, '0'); assert.equal(lw[0].r.c.filter((c) => c === 10).length, 8, 'an L-shaped union: eight corners');
    assert.deepEqual((await histLabels()).slice(-1), ['Weld']);
    await page.keyboard.press('Control+z');
    assert.equal(await entCount(), 3, 'one undo brings both squares back');
    // Intersect from the command bar
    await click(100, 130); await click(190, 160, { shift: true }); await waitSel('2 selected');
    await typeCmd('intersect');
    assert.equal(await prompt(), 'Intersect: 2 outlines → 1 outline, area 900.00 mm². Ctrl+Z puts the originals back');
    assert.equal(await entCount(), 2);
    await page.keyboard.press('Control+z');
    // Trim from the command bar: the square clicked last is the target, the other stays
    await click(100, 130); await click(190, 160, { shift: true });
    await typeCmd('shapetrim');
    assert.equal(await prompt(), 'Trim: 2 outlines → 1 outline, area 2700.00 mm². The cutters stay. Ctrl+Z puts the originals back');
    saved = await savedDoc();
    assert.equal(saved.entities.length, 3); assert.equal(saved.entities.filter((e) => e.type === 'LWPOLYLINE' && e.r.v[e.r.c.indexOf(70)] === '1').length, 2, 'the first square stays whole beside the trimmed second');
    await page.keyboard.press('Control+z');
    // the other way round: the first square is the target now
    await click(190, 160); await click(100, 130, { shift: true });
    await typeCmd('shapetrim');
    assert.match(await prompt(), /^Trim: 2 outlines → 1 outline, area 2700\.00 mm²/);
    await page.keyboard.press('Control+z');
    // Ctrl+A has no last pick, so the largest outline is the target
    await page.keyboard.press('Control+a');
    await typeCmd('weld');
    assert.match(await prompt(), /^Weld: 2 outlines → 1 outline, area 6300\.00 mm²; 1 open outline skipped/);
    await page.keyboard.press('Control+z');
    // squares that do not overlap: Intersect changes nothing and says so
    await closeTabs(/./);
    const far = newDoc();
    addEntities(far, dxfPoly([[100, 100], [140, 100], [140, 140], [100, 140]], { closed: true }), dxfPoly([[200, 100], [240, 100], [240, 140], [200, 140]], { closed: true }));
    await t('picker').setInputFiles({ name: 'shaping-far.dxf', mimeType: 'text/plain', buffer: Buffer.from(writeDxf(far)) });
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'shaping-far.dxf');
    await page.keyboard.press('Control+a');
    await typeCmd('intersect');
    assert.equal(await prompt(), 'Intersect: the outlines do not overlap, nothing changed');
    assert.equal(await entCount(), 2);
    await closeTabs(/./);
  });

  await step('TODO 122b: all four operations from Modify and command bar, drawing order, source layers, boundary keeps originals, area/count and one Undo', async () => {
    await closeTabs(/./);
    const doc = newDoc();
    addLayer(doc, 'Back'); addLayer(doc, 'Front');
    addEntities(doc, dxfPoly([[100, 100], [160, 100], [160, 160], [100, 160]], { closed: true, layer: 'Back', aci: 1 }),
      dxfPoly([[130, 130], [190, 130], [190, 190], [130, 190]], { closed: true, layer: 'Front', aci: 3 }), dxfPoly([[300, 100], [350, 100], [350, 150]]));
    await t('picker').setInputFiles({ name: 'shaping-122b.dxf', mimeType: 'text/plain', buffer: Buffer.from(writeDxf(doc)) });
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'shaping-122b.dxf');
    // Saving renumbers DXF handles when entities are removed; compare all geometry and attributes without those handles.
    const withoutHandles = (ents) => ents.map((e) => ({ ...e, r: { c: e.r.c.filter((c) => c !== 5), v: e.r.v.filter((_, i) => e.r.c[i] !== 5) } }));
    const original = withoutHandles((await savedDoc()).entities);
    for (let i = 0; i < 12; i++) assert.deepEqual(withoutHandles((await savedDoc()).entities), original, 'rapid save snapshots all download');
    for (const [cmd, label, count, area, layers] of [
      ['simplify', 'Simplify', 2, '6300.00', ['Back', 'Front']],
      ['frontminus', 'Front minus back', 1, '2700.00', ['Front']],
      ['backminus', 'Back minus front', 1, '2700.00', ['Back']],
      ['boundary', 'Create boundary', 1, '6300.00', ['0']],
    ]) for (const via of ['menu', 'command']) {
      // Pick the front first for the menu, back first for the command: last pick must not determine stacking.
      const picks = via === 'menu' ? [[190, 160], [100, 130]] : [[100, 130], [190, 160]];
      await click(...picks[0]); await click(...picks[1], { shift: true }); await click(300, 100, { shift: true });
      await waitSel('3 selected');
      if (via === 'menu') await menuItem('Modify', 'Shaping: ' + label); else await typeCmd(cmd);
      const tail = cmd === 'boundary' ? '. The originals stay. Ctrl+Z removes the boundary' : '. Ctrl+Z puts the originals back';
      assert.equal(await prompt(), `${label}: 2 outlines → ${count} outline${count === 1 ? '' : 's'}, area ${area} mm²; 1 open outline skipped` + tail);
      assert.equal(await entCount(), cmd === 'boundary' ? 4 : count + 1);
      const saved = withoutHandles((await savedDoc()).entities);
      if (cmd === 'simplify') assert.deepEqual(saved.map((e) => e.layer), ['Front', '0', 'Back']);      // the front outline nothing overlaps keeps its entity; the back one is replaced by its trimmed copy
      else assert.deepEqual(saved.slice(-count).map((e) => e.layer), layers);
      if (cmd === 'boundary') assert.deepEqual(saved.slice(0, 3), original, 'boundary leaves every original whole');
      else assert.deepEqual(saved[cmd === 'simplify' ? 1 : 0], original[2], 'the open outline stays whole');
      if (cmd === 'simplify') { assert.deepEqual(saved[0], original[1], 'the front outline stays whole'); assert.equal(saved.at(-1).aci, 1, 'the trimmed back keeps its colour'); }
      if (cmd === 'frontminus' || cmd === 'backminus') {
        assert.equal(Math.min(...saved.at(-1).r.v.filter((_, i) => saved.at(-1).r.c[i] === 10).map(Number)), cmd === 'frontminus' ? 130 : 100);
      }
      assert.equal((await histLabels()).at(-1), label);
      await page.keyboard.press('Control+z');
      assert.equal(await entCount(), 3);
      assert.deepEqual(withoutHandles((await savedDoc()).entities), original, 'one Undo restores the entire drawing');
    }
    await closeTabs(/./);
    const same = newDoc();
    const square = dxfPoly([[100, 100], [160, 100], [160, 160], [100, 160]], { closed: true });
    addEntities(same, square, square);
    await t('picker').setInputFiles({ name: 'shaping-covered.dxf', mimeType: 'text/plain', buffer: Buffer.from(writeDxf(same)) });
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'shaping-covered.dxf');
    for (const [cmd, label, count, area] of [['simplify', 'Simplify', 1, '3600.00'], ['frontminus', 'Front minus back', 0, '0.00'], ['backminus', 'Back minus front', 0, '0.00']]) {
      await page.keyboard.press('Control+a'); await typeCmd(cmd);
      assert.equal(await prompt(), `${label}: 2 outlines → ${count} outline${count === 1 ? '' : 's'}, area ${area} mm². Ctrl+Z puts the originals back`);
      assert.equal(await entCount(), count);
      await page.keyboard.press('Control+z'); assert.equal(await entCount(), 2);
    }
    await closeTabs(/./);
  });

  await step('TODO 122a fix: Shaping leaves a block (INSERT) alone and says so, keeps open lines, and a locked layer is not welded', async () => {
    await closeTabs(/./);
    const doc = newDoc();
    addLayer(doc, 'Cut');
    addBlock(doc, 'B', [dxfPoly([[0, 0], [20, 0], [20, 20], [0, 20]], { closed: true }), dxfPoly([[30, 0], [50, 0], [50, 20]])]);
    addEntities(doc, dxfPoly([[100, 100], [160, 100], [160, 160], [100, 160]], { closed: true }), dxfPoly([[130, 130], [190, 130], [190, 190], [130, 190]], { closed: true }), dxfInsert('B', 300, 100));
    await t('picker').setInputFiles({ name: 'shaping-block.dxf', mimeType: 'text/plain', buffer: Buffer.from(writeDxf(doc)) });
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'shaping-block.dxf');
    await page.keyboard.press('Control+a');
    await typeCmd('weld');
    assert.equal(await prompt(), 'Weld: 2 outlines → 1 outline, area 6300.00 mm²; 1 block skipped: explode it first. Ctrl+Z puts the originals back');
    assert.equal(await entCount(), 2, 'the welded outline and the block, whole');
    await page.keyboard.press('Control+z');
    await closeTabs(/./);
    // two overlapping squares, one on a layer that is locked: Ctrl+A skips it, so there is nothing to weld
    const lk = newDoc();
    addLayer(lk, 'Cut');
    addEntities(lk, dxfPoly([[100, 100], [160, 100], [160, 160], [100, 160]], { closed: true }), dxfPoly([[130, 130], [190, 130], [190, 190], [130, 190]], { closed: true, layer: 'Cut' }));
    await t('picker').setInputFiles({ name: 'shaping-lock.dxf', mimeType: 'text/plain', buffer: Buffer.from(writeDxf(lk)) });
    await page.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'shaping-lock.dxf');
    await t('ptab-objects').click(); await t('objects-panel').waitFor();
    await page.locator('[data-testid=obj-tree] .or.layer[data-layer="Cut"] [data-act=lock]').click();
    await page.keyboard.press('Control+a');
    await typeCmd('weld');
    assert.match(await prompt(), /^Weld: select at least 2 closed outlines/);
    assert.equal(await entCount(), 2, 'nothing was welded');
    await t('ptab-drawing').click();
    // clicking the locked outline does not pick it (so Weld never gets it), and says why
    await click(190, 170);
    assert.equal(await prompt(), 'Layer Cut is locked: unlock it in the Objects tab to pick this');
    await click(110, 100);
    await waitSel('1 selected');
    await typeCmd('weld');
    assert.match(await prompt(), /^Weld: select at least 2 closed outlines/);
    assert.equal(await entCount(), 2, 'nothing was welded');
    await closeTabs(/./);
  });

  await step('TODO 84: menu and tooltip command hints match COMMANDS, light then dark', async () => {
    await closeTabs(/./); await t('new-tab').click();
    const names = { rect: 'rectangle', 'Rounded rectangle': 'rrect', 'Text to outlines': 'textoutlines', 'Fit to window': 'fit', 'Save As…': 'saveas', 'Select all': 'selectall' };
    const dimNames = { Linear: 'dimlinear', Radius: 'dimradius', Diameter: 'dimdiameter', Angle: 'dimangular' };
    for (const th of ['light', 'dark']) {
      await page.evaluate((x) => { document.documentElement.dataset.theme = x; }, th);
      for (const menu of ['File', 'Edit', 'View', 'Draw', 'Modify', 'Format', 'Layout', 'Tools']) {
        await page.locator(`[data-menu=${menu}]`).click();
        const items = await page.locator('.dropdown [role^=menuitem]').evaluateAll((els) => els.map((e) => ({ label: e.firstChild.textContent.trim().replace(/^[✓\s]+/, ''), hint: e.querySelector('.hint')?.textContent })));
        for (const { label, hint } of items) {
          if (!hint || ['Drawing checks', 'Aliases + keys', 'Ctrl+D'].includes(hint)) continue;
          const cmd = COMMANDS.find((c) => c.name === (names[label] || label.toLowerCase()));
          assert.ok(cmd, label);
          assert.ok(cmd.alias.includes(hint.toLowerCase()) || cmd.key.split(' / ').includes(hint) || (cmd.name === 'delete' && hint === 'Del'), label + ': ' + hint);
        }
        if (menu === 'Draw') {
          assert.equal(await page.getByRole('menuitem', { name: 'Ellipse', exact: true }).locator('.hint').textContent(), 'EL');
          await page.screenshot({ path: `${shotDir}/s15-84-${th}.png` });
        }
        await page.keyboard.press('Escape');
      }
      const tools = await page.locator('[data-tool][title]').evaluateAll((els) => els.map((e) => ({ id: e.dataset.tool, dimension: /^Dimension · (\w+)/.exec(e.title)?.[1], hint: /\(([A-Z]+)\)$/.exec(e.title)?.[1] })));
      for (const { id, dimension, hint } of tools) if (hint) assert.ok(COMMANDS.find((c) => c.name === (dimNames[dimension] || names[id] || id))?.alias.includes(hint.toLowerCase()), id + ': ' + hint);
    }
    await closeTabs(/./);
  });

  await step('TODO 85: Preflight follows its drawing tab, Escape closes it, Close stays above Balloons, light then dark', async () => {
    for (const th of ['light', 'dark']) {
      await page.evaluate((x) => { document.documentElement.dataset.theme = x; }, th);
      await openGrips(cleanupDrawing(), 'preflight-owner.dxf');
      const owner = page.locator('.tabs .dtab', { hasText: 'preflight-owner.dxf' });
      await menuItem('Tools', 'Preflight…');
      const count = await t('preflight-text-count').textContent();
      await t('new-tab').click();
      assert.equal(await t('preflight').isVisible(), false, 'hidden on another drawing');
      const otherDoc = newDoc(4); addEntities(otherDoc, dxfLine(0, 0, 10, 0));
      const other = 'preflight-other.dxf';
      await t('picker').setInputFiles({ name: other, mimeType: 'text/plain', buffer: Buffer.from(writeDxf(otherDoc), 'latin1') });
      await page.waitForFunction((n) => document.querySelector('.tabs .dtab.on .tname').textContent === n, other);
      await menuItem('Tools', 'Preflight…');
      assert.equal(await t('preflight-text-count').textContent(), '0');
      await owner.click();
      assert.equal(await t('preflight').isVisible(), true, 'back on its owner');
      assert.equal(await t('preflight-text-count').textContent(), count, 'checks belong to this drawing');
      await menuItem('File', 'New layout');
      assert.equal(await t('preflight').isVisible(), false, 'hidden on a layout');
      await owner.click();
      await page.locator('[data-tool=select]').focus(); await page.keyboard.press('Escape');
      assert.equal(await t('preflight').isVisible(), false, 'Escape from outside the panel');
      await page.locator('.tabs .dtab', { hasText: other }).click();
      assert.equal(await t('preflight').isVisible(), true, 'the other drawing kept its panel');
      await owner.click();
      assert.equal(await t('preflight').isVisible(), false, 'Escape persists after a round trip');
      await menuItem('Tools', 'Preflight…');
      await t('preflight-recheck').focus(); await page.keyboard.press('Escape');
      assert.equal(await t('preflight').isVisible(), false, 'Escape inside the panel');
      await page.setViewportSize({ width: 1024, height: 768 });
      await page.locator('[data-tool=balloon]').click();
      if (await t('bal-collapse').getAttribute('aria-label') === 'Expand') await t('bal-collapse').click();
      const dockHeight = (await t('bal-dock').boundingBox()).height;
      const handle = await t('bal-drag').boundingBox();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2, 100); await page.mouse.up();
      await menuItem('Tools', 'Preflight…');
      await frames();
      assert.equal(await t('bal-dock').isVisible(), true);
      assert.equal(await t('preflight-close').evaluate((el) => {
        const r = el.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!top && el.contains(top);
      }), true, 'Close is reachable without scrolling the panel');
      await page.screenshot({ path: `${shotDir}/s15-85-${th}.png` });
      await t('preflight-close').click();
      assert.equal(await t('preflight').isVisible(), false);
      await page.locator('.tabs .dtab', { hasText: other }).click(); await owner.click();
      assert.equal(await t('preflight').isVisible(), false, 'Close persists after a round trip');
      await page.locator('[data-tool=balloon]').click();
      const resizedHandle = await t('bal-drag').boundingBox(), resizedHeight = (await t('bal-dock').boundingBox()).height;
      await page.mouse.move(resizedHandle.x + resizedHandle.width / 2, resizedHandle.y + resizedHandle.height / 2); await page.mouse.down();
      await page.mouse.move(resizedHandle.x + resizedHandle.width / 2, resizedHandle.y + resizedHandle.height / 2 + resizedHeight - dockHeight); await page.mouse.up();
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator('[data-tool=select]').click();
      await closeTabs(/./);
    }
  });

  await step('Preflight Esc: fields and the command bar take priority; cancel a running command before closing Preflight', async () => {
    await openGrips();
    await click(70, 30); await propsOnNow();
    await menuItem('Tools', 'Preflight…');
    await t('prop-layer').focus(); await page.keyboard.press('Escape');
    assert.equal(await t('preflight').isVisible(), true, 'Escape in Properties leaves Preflight open');
    await cmdLine().fill('line'); await page.keyboard.press('Escape');
    assert.equal(await t('cmd-bar').isVisible(), false, 'Escape closes an idle command bar');
    assert.equal(await t('preflight').isVisible(), true);
    for (const barOpen of [false, true]) {
      await typeCmd('line');
      assert.match(await page.locator('[data-tool=line]').getAttribute('class'), /\bon\b/);
      if (barOpen) await cmdLine().fill('');
      await page.keyboard.press('Escape');
      assert.match(await page.locator('[data-tool=select]').getAttribute('class'), /\bon\b/, 'first Escape cancels Line');
      assert.equal(await t('cmd-bar').isVisible(), false);
      assert.equal(await t('preflight').isVisible(), true, 'first Escape keeps Preflight open');
      await page.keyboard.press('Escape');
      assert.equal(await t('preflight').isVisible(), false, 'second Escape closes Preflight');
      if (!barOpen) await menuItem('Tools', 'Preflight…');
    }
    await closeTabs(/./);
  });

  await step('TODO 79: the immediate Text to outlines selection has no grips; selecting it again uses both caps, light and dark', async () => {
    await closeTabs(/./); await t('new-tab').click();
    await page.locator('[data-tool=text]').click();
    await t('text-height').fill('12'); await t('text-height').press('Enter'); await t('text-font').selectOption('Standard');
    await click(30, 100); await t('text-editor').waitFor(); await page.keyboard.type('BOBOBOBO'); await page.keyboard.press('Enter');
    await page.locator('[data-tool=select]').click(); await page.keyboard.press('Control+a');
    await menuItem('Modify', 'Text to outlines');
    await page.waitForFunction(() => /→/.test(document.querySelector('[data-testid=cmd-prompt]').textContent), null, { timeout: 15000 });
    const outlines = (await savedDoc()).entities, vertices = outlines.reduce((n, e) => n + e.r.c.filter((c) => c === 10).length, 0);
    assert.ok(vertices > GR.MAX_SELECTED && vertices <= GR.MAX_GRIPS && outlines.length < GR.MAX_SELECTED, 'many vertices on a few outlines, within the handle cap');
    await frames();
    assert.equal(await t('sel-count').textContent(), `${outlines.length} selected`, 'the TXO result is selected before checking its hidden grips');
    assert.equal(await page.locator('[data-testid=grip], [data-testid=grip-hot]').count(), 0, 'the immediate TXO result keeps the letters readable');
    for (const th of ['light', 'dark']) {
      await page.evaluate((x) => { document.documentElement.dataset.theme = x; }, th); await page.waitForTimeout(150);
      await page.screenshot({ path: `${shotDir}/s13-grips-${th}.png` });
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await page.keyboard.press('Control+a');
    await gripWhen(vertices);
    await closeTabs(/./);
  });

  await step('TODO 80: with the Text tool on, every open menu is above the tool hint, down to its bottom edge, light and dark', async () => {
    await closeTabs(/./); await t('new-tab').click();
    const menus = await page.locator('[data-menu]:not(.off)').evaluateAll((els) => els.map((e) => e.getAttribute('data-menu')));
    assert.ok(menus.includes('Modify'));
    for (const th of ['light', 'dark']) {
      await page.evaluate((x) => { document.documentElement.dataset.theme = x; }, th);
      for (const m of menus) {
        await page.locator('[data-tool=text]').click();
        assert.equal(await t('text-hint').isVisible(), true);
        await page.locator(`[data-menu=${m}]`).click();
        assert.equal(await page.evaluate(() => {
          const dd = [...document.querySelectorAll('.dropdown')].find((d) => !d.hidden), r = dd.getBoundingClientRect();
          const el = document.elementFromPoint(r.left + 10, r.bottom - 2);                // the menu's bottom edge, where the hint's top used to show through
          return !!el && dd.contains(el);
        }), true, m + ' menu: its bottom edge is on top of the hint');
        if (m === 'Modify') await page.screenshot({ path: `${shotDir}/s13-menuhint-${th}.png`, clip: { x: 0, y: 0, width: 700, height: 260 } });
        await page.keyboard.press('Escape');
      }
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await closeTabs(/./);
  });

  await step('TODO 53c: a turned, mirrored, widened, centred text (layer CUT), an SHX text and MTEXT become outlines; save and reopen give the same outlines', async () => {
    await closeTabs(/./);
    await t('picker').setInputFiles('fixtures/txo.dxf');
    await page.waitForFunction(() => document.querySelector('.tabs').textContent.includes('txo.dxf'));
    await page.locator('[data-tool=select]').click(); await page.keyboard.press('Control+a');
    await menuItem('Modify', 'Text to outlines');
    await page.waitForFunction(() => /→/.test(document.querySelector('[data-testid=cmd-prompt]').textContent), null, { timeout: 15000 });
    const msg = await prompt();
    assert.match(msg, /^2 texts \+ 1 MTEXT → \d+ outlines\. Fonts: simplex\.shx → Arial/);
    const dl = await downloaded(() => page.keyboard.press('Control+s'));
    const doc = readDxf(dl.text), polys = doc.entities.filter((e) => e.type === 'LWPOLYLINE'), cut = polys.filter((e) => e.layer === 'CUT');
    assert.deepEqual(doc.entities.filter((e) => e.type === 'MTEXT').length, 0, 'MTEXT replaced too');
    assert.equal(doc.entities.filter((e) => e.type === 'TEXT').length, 0);
    assert.ok(cut.length >= 5 && cut.length < polys.length, 'HELLO is on its layer: ' + cut.length + ' of ' + polys.length);
    assert.ok(polys.every((e) => e.r.v[e.r.c.indexOf(70)] === '1'), 'all closed');
    const pts = (es, code) => es.flatMap((e) => e.r.c.flatMap((c, k) => (c === code ? [+e.r.v[k]] : [])));
    const bx = pts(cut, 10), by = pts(cut, 20), w = Math.max(...bx) - Math.min(...bx), hh = Math.max(...by) - Math.min(...by);
    assert.ok(Math.abs((Math.min(...bx) + Math.max(...bx)) / 2 - 100) < 12 && Math.abs((Math.min(...by) + Math.max(...by)) / 2 - 50) < 12, 'centred on its anchor');
    assert.ok(w > 10 && hh > 10 && w < 45 && hh < 45, 'turned 30 degrees: both extents are real: ' + w.toFixed(1) + ' x ' + hh.toFixed(1));
    // reopen the saved file: the same outlines, and a second run asks for text
    await closeTabs(/./);
    await t('picker').setInputFiles({ name: 'txo2.dxf', mimeType: 'text/plain', buffer: Buffer.from(dl.text, 'latin1') });
    await page.waitForFunction(() => document.querySelector('.tabs').textContent.includes('txo2.dxf'));
    const again = readDxf((await downloaded(() => page.keyboard.press('Control+s'))).text);
    assert.equal(again.entities.length, doc.entities.length);
    assert.deepEqual(pts(again.entities.filter((e) => e.layer === 'CUT' && e.type === 'LWPOLYLINE'), 10), bx, 'the same points after reopening');
    await page.locator('[data-tool=select]').click(); await page.keyboard.press('Control+a');
    await menuItem('Modify', 'Text to outlines');
    assert.equal(await prompt(), 'Text to outlines: select the texts (click or drag a box), then press Enter');
    await page.keyboard.press('Escape');
    await closeTabs(/./);
  });

  await step('TODO 53b: TXO accented/composite TEXT keeps closed outlines and holes; missing glyphs are named without .notdef boxes', async () => {
    await closeTabs(/./);
    const source = newDoc(4);
    addLayer(source, 'Accents', { aci: 7 }); addLayer(source, 'Missing', { aci: 3 });
    addEntities(source, dxfText(20, 60, 12, 'Åé°ñ Ø25', { layer: 'Accents' }), dxfText(20, 30, 12, 'A🦄V', { layer: 'Missing' }));
    await t('picker').setInputFiles({ name: 's13-53b-accents.dxf', mimeType: 'text/plain', buffer: Buffer.from(writeDxf(source, { escapeUnicode: true }), 'ascii') });
    await page.waitForFunction(() => document.querySelector('.tabs').textContent.includes('s13-53b-accents.dxf'));
    await page.locator('[data-tool=select]').click(); await page.keyboard.press('Control+a');
    await typeCmd('txo');
    await page.waitForFunction(() => /Missing glyphs skipped/.test(document.querySelector('[data-testid=cmd-prompt]').textContent), null, { timeout: 15000 });
    assert.match(await prompt(), /^2 texts → 19 outlines\./);
    assert.match(await prompt(), /Missing glyphs skipped \(advance kept\): 🦄 \(U\+1F984\)/);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    for (const theme of ['light', 'dark']) {
      await menuItem('View', 'Theme: ' + theme); await page.waitForTimeout(150);
      await page.screenshot({ path: `${shotDir}/s13-53b-outlines-${theme}.png` });
    }
    await menuItem('View', 'Theme: light');
    const doc = await savedDoc(), accents = doc.entities.filter((e) => e.layer === 'Accents'), missing = doc.entities.filter((e) => e.layer === 'Missing');
    assert.equal(accents.length, 16); assert.equal(missing.length, 3, 'A and V only; no missing-glyph box');
    assert.ok(doc.entities.every((e) => e.type === 'LWPOLYLINE' && fieldOf(e, 70) === 1), 'every outline is closed, TEXT replaced');
    const polys = accents.map((e) => e.r.c.flatMap((c, i) => c === 10 ? [[+e.r.v[i], +e.r.v[i + 1]]] : []));
    const inside = (p, poly) => { let yes = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i][1] > p[1]) !== (poly[j][1] > p[1]) && p[0] < (poly[j][0] - poly[i][0]) * (p[1] - poly[i][1]) / (poly[j][1] - poly[i][1]) + poly[i][0]) yes = !yes; return yes; };
    assert.ok(polys.filter((p, i) => polys.some((q, j) => j !== i && inside(p[0], q))).length >= 4, 'A, ring, e, degree and slashed O keep counters');
    assert.ok(polys.flat().every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && x >= 19 && y > 59 && y < 77), 'same baseline and accent height');
    await page.keyboard.press('Control+z');
    assert.equal((await savedDoc()).entities.filter((e) => e.type === 'TEXT').length, 2, 'one undo restores both texts');
    await closeTabs(/./);
    const absent = newDoc(4); addEntities(absent, dxfText(20, 30, 12, '🦄'));
    await t('picker').setInputFiles({ name: 's13-53b-missing.dxf', mimeType: 'text/plain', buffer: Buffer.from(writeDxf(absent, { escapeUnicode: true }), 'ascii') });
    await page.waitForFunction(() => document.querySelector('.tabs').textContent.includes('s13-53b-missing.dxf'));
    await page.locator('[data-tool=select]').click(); await page.keyboard.press('Control+a'); await typeCmd('txo');
    await page.waitForFunction(() => /no letters to outline.*U\+1F984/.test(document.querySelector('[data-testid=cmd-prompt]').textContent), null, { timeout: 15000 });
    assert.equal((await savedDoc()).entities[0].type, 'TEXT', 'entirely missing text stays for correction');
    await closeTabs(/./);
  });

  await step('TODO 53d: MTEXT with two paragraphs, a bold run and word wrap becomes closed outlines on three lines; one undo restores the original', async () => {
    await closeTabs(/./);
    const source = newDoc(4), content = String.raw`HH {\fArial|b1|i0;HH} HH\PHH HH`;
    addLayer(source, 'Notes', { aci: 3 });
    addEntities(source, entity('MTEXT', [[10, 20], [20, 100], [40, 10], [41, 52], [44, 1.2], [71, 1], [1, content]], { layer: 'Notes', aci: 3 }));
    await t('picker').setInputFiles({ name: 's13-53d-mtext.dxf', mimeType: 'text/plain', buffer: Buffer.from(writeDxf(source), 'ascii') });
    await page.waitForFunction(() => document.querySelector('.tabs').textContent.includes('s13-53d-mtext.dxf'));
    const original = (await savedDoc()).entities[0];
    await page.locator('[data-tool=select]').click(); await page.keyboard.press('Control+a'); await typeCmd('txo');
    await page.waitForFunction(() => /^1 MTEXT →/.test(document.querySelector('[data-testid=cmd-prompt]').textContent), null, { timeout: 15000 });
    assert.match(await prompt(), /^1 MTEXT → 10 outlines\./);
    await page.waitForFunction(() => /1 MTEXT → 10 outlines/.test(document.querySelector('[data-testid=cmd-fade]').textContent));
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    for (const theme of ['light', 'dark']) {
      await menuItem('View', 'Theme: ' + theme); await page.waitForTimeout(150);
      await page.screenshot({ path: `${shotDir}/s13-53d-outlines-${theme}.png` });
    }
    await menuItem('View', 'Theme: light');
    assert.deepEqual(await histLabels(), ['Start', 'Text to outlines × 1']);
    const converted = await savedDoc(), polys = converted.entities;
    assert.equal(polys.length, 10, 'ten H glyphs, including the bold pair');
    assert.ok(polys.every((e) => e.type === 'LWPOLYLINE' && fieldOf(e, 70) === 1 && e.layer === 'Notes' && e.aci === 3), 'closed outlines keep the entity layer and colour');
    const ys = polys.map((e) => Math.min(...e.r.c.flatMap((c, i) => c === 20 ? [+e.r.v[i]] : [])));
    const baselines = [...new Set(ys.map((y) => Math.round(y * 1000) / 1000))].sort((a, b) => a - b);
    assert.deepEqual(baselines, [50, 70, 90], 'three lines: width wraps paragraph one, paragraph two starts a line; spacing factor 1.2 kept');
    const widthOf = (e) => { const xs = e.r.c.flatMap((c, i) => c === 10 ? [+e.r.v[i]] : []); return Math.max(...xs) - Math.min(...xs); };
    assert.ok(widthOf(polys[2]) > widthOf(polys[0]), 'the bold pair uses the bold glyph outlines');
    await page.keyboard.press('Control+z');
    const restored = (await savedDoc()).entities;
    assert.equal(restored.length, 1); assert.deepEqual(restored[0], original, 'one undo restores the original MTEXT, codes, insertion, attachment, height and width');
    await closeTabs(/./);
  });

  await step('TODO 96: independent work area, cycle and checked menu, ACI 7, feedback, persistence and unchanged paper / PDF', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    const p = await context.newPage(), q = (id) => p.locator(`[data-testid=${id}]`);
    p.on('pageerror', (e) => errors.push(String(e)));
    const frame = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const theme = async (name) => { await p.locator('[data-menu=View]').click(); await p.getByRole('menuitemcheckbox', { name: new RegExp('Theme: ' + name + '$') }).click(); await frame(); };
    const work = async (name) => {
      await p.locator('[data-menu=View]').click();
      await p.getByRole('menuitemcheckbox', { name: new RegExp('Work area: ' + name + '$') }).click(); await frame();
    };
    const doc = newDoc(4);
    addEntities(doc, dxfLine(20, 30, 120, 30, { aci: 7 }), dxfLine(20, 60, 120, 60, { tc: 0 }),
      dxfLine(20, 90, 70, 90, { tc: 0xffffff }), dxfLine(70.005, 90, 120, 90, { aci: 7 }));
    const open = async () => {
      await q('picker').setInputFiles({ name: 'work-area.dxf', mimeType: 'text/plain', buffer: Buffer.from(writeDxf(doc), 'latin1') });
      await p.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'work-area.dxf');
      await frame();
    };
    const pixels = (hex) => q('drawing').evaluate((el, hex) => {
      const rgb = hex.match(/\w\w/g).map((v) => parseInt(v, 16));
      const data = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 150 && rgb.every((v, j) => Math.abs(data[i + j] - v) < 12)) n++;
      return n;
    }, hex);
    const pdf = async () => {
      await q('pdf-open').click(); await q('pdf-dialog').waitFor(); await frame();
      await q('pdf-negative').uncheck(); await q('pdf-strip').uncheck();
      const preview = await q('pdf-preview').evaluate((el) => el.toDataURL());
      const [dl] = await Promise.all([p.waitForEvent('download'), q('pdf-go').click()]);
      await q('pdf-dialog').waitFor({ state: 'detached' });
      return { preview, bytes: readFileSync(await dl.path()) };
    };
    try {
      await p.goto(URL_); await q('work-area').waitFor(); await theme('light'); await open();
      assert.equal(await q('work-area').getAttribute('aria-label'), 'Work area: Follow app');
      for (const name of ['Light', 'Dark', 'Follow app']) {
        await q('work-area').click(); await frame();
        assert.equal(await q('work-area').getAttribute('aria-label'), 'Work area: ' + name);
        assert.equal(await q('work-area').getAttribute('title'), 'Work area: ' + name);
      }
      for (const [app, area, background, ink, selection, mark] of [
        ['light', 'Dark', 'rgb(0, 0, 0)', 'e8e8ec', '60a5fa', 'fb923c'],
        ['dark', 'Light', 'rgb(255, 255, 255)', '1b1d22', '4f46e5', 'c2410c'],
      ]) {
        await theme(app); const originalPdf = await pdf();
        const appBg = await p.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor);
        await work(area);
        assert.equal(await q('canvas').evaluate((el) => getComputedStyle(el).backgroundColor), background);
        assert.equal(await p.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor), appBg);
        const swatch = await p.locator('.layer[data-file-layer] .swatch').first().evaluate((el) => getComputedStyle(el).backgroundColor.match(/\d+/g).slice(0, 3).map(Number));
        assert.equal(Math.max(...swatch) > 128, app === 'dark', 'layer "0" swatch contrasts with the app-themed panel, not the work area');
        assert.ok(await pixels(ink) > 400, 'ACI 7 and black / white drawing lines contrast with the work area');
        assert.ok(await pixels(area === 'Dark' ? 'ffffff' : '000000') > 400, 'both white / ACI 7 and black lines remain visible');
        if (await q('gap-show').getAttribute('aria-pressed') === 'false') { await q('gap-show').click(); await frame(); } // TODO 92: rings start off per drawing
        assert.ok(await pixels(mark) > 30, 'tiny-gap rings follow the work area');
        assert.deepEqual(await pdf(), originalPdf, 'PDF preview and bytes are unchanged by the work area');
        await p.locator('[data-menu=View]').click();
        assert.deepEqual(await p.getByRole('menuitemcheckbox', { name: /Work area:/ }).evaluateAll((els) => els.map((el) => el.getAttribute('aria-checked'))),
          area === 'Dark' ? ['false', 'false', 'true'] : ['false', 'true', 'false']);
        await p.keyboard.press('Escape');
        await p.locator('[data-tool=select]').click(); await p.keyboard.press('Control+a'); await frame();
        assert.ok(await pixels(selection) > 400, 'selected lines follow the work area');
        const grip = q('grip').first(); await grip.waitFor();
        assert.equal(await grip.evaluate((el) => getComputedStyle(el).fill), area === 'Dark' ? 'rgb(96, 165, 250)' : 'rgb(79, 70, 229)');
        const hover = await p.evaluate(() => {
          const svg = document.querySelector('.ovl svg'), edge = document.createElementNS(svg.namespaceURI, 'path');
          edge.setAttribute('class', 'dr-edge'); svg.append(edge);
          const cs = getComputedStyle(edge), result = [cs.stroke, cs.strokeOpacity]; edge.remove(); return result;
        });
        assert.deepEqual(hover, area === 'Dark' ? ['rgb(96, 165, 250)', '0.8'] : ['rgb(79, 70, 229)', '0.35']);
        await p.screenshot({ path: `${shotDir}/s15-96-app-${app}-work-${area.toLowerCase()}.png` });
        const endpoint = await grip.boundingBox();
        await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
        await p.locator('[data-tool=line]').click();
        await p.mouse.move(endpoint.x + endpoint.width / 2, endpoint.y + endpoint.height / 2); await frame();
        assert.ok(await pixels(selection) > 10, 'snap marker follows the work area');
        await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
        await q('new-layout').click(); await frame();
        assert.equal(await q('canvas').evaluate((el) => el.dataset.workArea), undefined, 'layout tabs follow the app theme entirely');
        assert.equal(await p.locator('rect.sheet').evaluate((el) => getComputedStyle(el).fill), app === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)', 'sheet paper keeps its app appearance');
        await p.reload(); await q('work-area').waitFor(); await frame();
        assert.equal(await q('work-area').getAttribute('aria-label'), 'Work area: ' + area, 'remembered after reload');
        await open();
        assert.equal(await q('canvas').evaluate((el) => getComputedStyle(el).backgroundColor), background);
        assert.ok(await pixels(ink) > 400, 'ACI 7 remains visible after reload');
        await work('Follow app');
      }
      await p.emulateMedia({ colorScheme: 'dark' }); await theme('follow system');
      assert.equal(await q('canvas').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 0)');
      await p.emulateMedia({ colorScheme: 'light' }); await frame();
      assert.equal(await q('canvas').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
    } finally { await context.close(); }
  });

  await step('TODO 90: black dark drawing area, contrasting selection / hover / grips / snaps, light and PDF unchanged', async () => {
    const doc = newDoc(4);
    addEntities(doc, dxfLine(20, 30, 120, 30), dxfLine(20, 60, 120, 60));
    await openGrips(writeDxf(doc), 'black-canvas.dxf');
    await click(70, 30); await gripWhen(3);
    const colours = () => page.evaluate(() => {
      const root = getComputedStyle(document.documentElement), token = (n) => root.getPropertyValue(n).trim();
      const canvas = document.querySelector('[data-testid=canvas]');
      return { background: getComputedStyle(canvas).backgroundColor, surround: token('--canvas'), sheet: token('--sheet'), part: token('--part'),
        selection: token('--selection'), accent: token('--accent'), panel: token('--panel'), paper: token('--pdpaper'),
        hot: token('--hot'), mark: token('--mark'), muted: token('--muted'), guide: token('--guide'),
        grip: getComputedStyle(document.querySelector('[data-testid=grip]')).fill };
    });
    // WCAG relative luminance against #000, including translucent feedback composited on black.
    const contrast = (hex, opacity = 1) => {
      const rgb = hex.match(/[a-f\d]{2}/gi).map((c) => parseInt(c, 16) / 255 * opacity);
      const linear = rgb.map((c) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
      return (linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722 + .05) / .05;
    };
    let lightPdf;
    for (const theme of ['light', 'dark']) {
      await menuItem('View', 'Theme: ' + theme); await frames();
      const c = await colours();
      if (theme === 'light') {
        assert.equal(c.background, 'rgb(255, 255, 255)');
        assert.deepEqual([c.surround, c.sheet, c.part, c.selection, c.accent, c.panel, c.paper],
          ['#ececef', '#ffffff', '#ffffff', '#4f46e5', '#4f46e5', '#ffffff', '#ffffff']);
        assert.equal(c.grip, 'rgb(79, 70, 229)');
      } else {
        assert.equal(c.background, 'rgb(0, 0, 0)');
        assert.deepEqual([c.surround, c.sheet, c.part], ['#000000', '#000000', '#000000']);
        assert.deepEqual([c.accent, c.panel, c.paper], ['#8a8fff', '#131316', '#f4f5f6'], 'UI and PDF preview tokens stay as before');
        assert.equal(c.grip, 'rgb(96, 165, 250)');
        for (const name of ['selection', 'hot', 'mark', 'muted', 'guide']) {
          assert.ok(contrast(c[name]) >= 4.5, `${name} ${c[name]} contrasts at least 4.5:1 with black`);
        }
        const hover = await page.evaluate(() => {
          const svg = document.querySelector('.ovl svg'), edge = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          edge.setAttribute('class', 'dr-edge'); svg.append(edge);
          const cs = getComputedStyle(edge), result = { colour: cs.stroke, opacity: +cs.strokeOpacity };
          edge.remove(); return result;
        });
        assert.equal(hover.colour, c.grip, 'hover and grips use the drawing selection colour');
        assert.ok(contrast(c.selection, hover.opacity) >= 4.5, 'translucent hover contrasts at least 4.5:1 on black');
      }
      assert.ok(await accentWhen((n) => n > 100) > 100, 'selected line is painted in the selection token');
      await page.screenshot({ path: `${shotDir}/s14-90-${theme}.png` });
      await openPdf();
      await t('pdf-negative').uncheck(); await t('pdf-strip').uncheck();
      const pdf = pdfText(await downloaded(() => t('pdf-go').click()));
      const paperPixel = await page.evaluate(async (text) => {
        const { renderPdfPage } = await import('./pdf-read.js');
        const { canvas } = await renderPdfPage(Uint8Array.from(text, (c) => c.charCodeAt(0)), { dpi: 36 });
        return [...canvas.getContext('2d').getImageData(5, 5, 1, 1).data];
      }, pdf);
      assert.deepEqual(paperPixel, [255, 255, 255, 255], 'exported PDF renders on white paper');
      if (theme === 'light') lightPdf = pdf;
      else assert.equal(pdf, lightPdf, 'exported PDF is identical in light and dark themes');
    }
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => { delete document.documentElement.dataset.theme; }); await frames();
    assert.equal((await colours()).background, 'rgb(0, 0, 0)', 'Windows dark theme also uses black');
    assert.equal((await colours()).selection, '#60a5fa');
    await menuItem('View', 'Theme: dark');
    await t('new-layout').click(); await frames();
    assert.equal(await t('canvas').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 0)', 'layout surround is black too');
    assert.equal(await page.locator('rect.sheet').evaluate((el) => getComputedStyle(el).fill), 'rgb(0, 0, 0)', 'layout sheet is black too');
    await menuItem('View', 'Theme: light'); await frames();
    assert.equal(await t('canvas').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(236, 236, 239)');
    assert.equal(await page.locator('rect.sheet').evaluate((el) => getComputedStyle(el).fill), 'rgb(255, 255, 255)');
    await page.emulateMedia({ colorScheme: 'light' });
    await closeTabs(/./);
  });

  // ---- TODO 89: the Nearest snap (hourglass) and a snap beats ORTHO; with ORTHO on a Dimension is linear ----
  await step('Nearest snap (89): with ORTHO on, Measure and Dimension land on the arc where it was picked, a free pick is still bent straight, and the dimension is linear (only the X or the Y distance)', async () => {
    await openGrips(dimDoc(), 'dims-89.dxf');
    const arcPt = (r) => [200 + r * Math.cos(Math.PI / 4), 150 + r * Math.sin(Math.PI / 4)];      // 45° on the arc (centre 200, 150, R20), r a bit outside it
    const dx = 200 + 20 * Math.cos(Math.PI / 4) - 60, dy = 150 + 20 * Math.sin(Math.PI / 4) - 20;   // from the line at (60, 20) to that point on the arc
    await t('tog-ortho').click();
    assert.equal(await t('tog-ortho').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-tool=measure]').click();
    await click(60, 20);                                                          // Nearest on the horizontal line (no end, middle or centre there)
    await click(...arcPt(20.4));
    const xy = async () => (await prompt()).match(/ΔX (-?[\d.]+)\s+ΔY (-?[\d.]+)/).slice(1).map(Number);      // (a click lands to the pixel, and a pixel is more than 1 mm here)
    let [mx, my] = await xy();
    assert.ok(Math.abs(mx - dx) < 3 && Math.abs(my - dy) < 3, 'ORTHO did not bend a point that sits on a snap: ' + await prompt());
    await page.keyboard.press('Escape');
    await click(60, 20); await click(120, 60);
    [mx, my] = await xy();
    assert.ok(Math.abs(mx - 60) < 3 && my === 0, 'a free pick is still kept straight: ' + await prompt());
    await page.keyboard.press('Escape'); await page.locator('[data-tool=select]').click();
    await page.locator('[data-tool=dimension]').click();
    await typeCmd('d');
    await click(60, 20);
    const hov = await at(...arcPt(20.4)); await page.mouse.move(hov.x, hov.y); await page.waitForTimeout(150);
    await page.screenshot({ path: shotDir + '/s14-89-nearest-hover-light.png' });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.mouse.move(hov.x + 1, hov.y); await page.mouse.move(hov.x, hov.y); await page.waitForTimeout(250);
    await page.screenshot({ path: shotDir + '/s14-89-nearest-hover-dark.png' });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; }); await page.waitForTimeout(150);
    await click(...arcPt(20.4));
    assert.match(await prompt(), /Dimension: move the line up or down and click to place it/);
    await click(140, 5);                                                          // the line below both points (on screen, as the Linear step's): horizontal
    const placed = async () => { const m = (await prompt()).match(/Dimension placed: ([\d.]+)("| mm)/); if (!m) throw new Error('no dimension placed, the prompt says: ' + await prompt()); return Number(m[1]) * (m[2] === '"' ? 25.4 : 1); };       // (an earlier step may have left the Inch style on)
    const startD = async () => { await page.keyboard.press('Escape'); await page.locator('[data-tool=select]').click(); await page.locator('[data-tool=dimension]').click(); await typeCmd('d'); };
    assert.ok(Math.abs(await placed() - dx) < 3, 'the X distance only: ' + await prompt());
    const onArc = (p) => Math.abs(Math.hypot(p.b[0] - 200, p.b[1] - 150) - 20) < 0.01 && Math.abs(p.a[1] - 20) < 1e-6 && p.b[1] > 150;       // the 2nd point on the arc, the 1st on the line
    const d1 = (await dimBlocks()).PD_DIM_1;
    assert.deepEqual([d1.kind, d1.params.axis], ['linear', 'h'], 'kept as a linear dimension: ' + JSON.stringify(d1));
    assert.ok(onArc(d1.params), 'the 2nd point is on the arc, the 1st on the line: ' + JSON.stringify(d1.params));
    await page.screenshot({ path: shotDir + '/s14-89-linear-light.png' });
    await page.keyboard.press('Escape'); await page.locator('[data-tool=select]').click(); await page.keyboard.press('Control+z');          // (its extension lines would snap the next picks)
    await startD(); await click(60, 20); await click(...arcPt(20.4)); await click(35, 90);       // the line to the left (the right-hand corner of the canvas holds the zoom box): vertical
    assert.ok(Math.abs(await placed() - dy) < 3, 'the Y distance only: ' + await prompt());
    const d2 = (await dimBlocks()).PD_DIM_1;
    assert.deepEqual([d2.kind, d2.params.axis], ['linear', 'v']);
    assert.ok(onArc(d2.params), JSON.stringify(d2.params));
    await menuItem('View', 'Theme: dark'); await page.waitForTimeout(150);
    await page.mouse.move(hov.x, hov.y); await page.waitForTimeout(150);
    await page.screenshot({ path: shotDir + '/s14-89-linear-dark.png' });
    await menuItem('View', 'Theme: light');
    await page.keyboard.press('Escape'); await page.locator('[data-tool=select]').click();
    await page.keyboard.press('Control+z');
    await t('tog-ortho').click();
    await startD(); await click(60, 20); await click(...arcPt(20.4)); await click(140, 5);        // without ORTHO it stays aligned
    assert.ok(Math.abs(await placed() - Math.hypot(dx, dy)) < 4, 'aligned: the true distance ' + await prompt());
    await page.keyboard.press('Escape'); await page.locator('[data-tool=select]').click();
    await closeTabs(/./);
  });

  const fitFixture = async (name, placed = true) => {
    await closeTabs(/./);
    const lay = newLayout(name), doc = newDoc(4);
    addEntities(doc, roundRect(0, 0, 100, 100, 0));
    lay.parts.fit = makePart('fit', 'Fit plate', doc);
    Object.assign(lay.s, { sheetW: 400, sheetH: 300, gripBottom: 0, gapX: 0, gapY: 0, align: 'topleft', gridPart: 'fit' });
    if (placed) lay.placed.push({ partId: 'fit', x: 0, y: 200, rot: 0, mirrorX: false, mirrorY: false });
    await t('picker').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(writeDxf(layoutRaw(lay)), 'latin1') });
    await page.waitForFunction((n) => document.querySelector('.tabs .dtab.on .tname').textContent === n, name);
    await t('panel-main').click();
  };
  await step('TODO 86: Fit skips placed parts, reports skipped cells, and Apply keeps them clear (light then dark)', async () => {
    for (const theme of ['light', 'dark']) {
      await menuItem('View', 'Theme: ' + theme);
      await fitFixture('fit-skip.dxf');
      assert.equal(await t('count').textContent(), '11');
      assert.equal(await t('grid').textContent(), 'fit · 11 copies');
      assert.match(await prompt(), /^11 fit copies,/);
      assert.equal(await t('step-hint').textContent(), '1 cell skipped: overlap with placed parts.');
      assert.equal(await sheetParts(), 12);
      await page.screenshot({ path: shotDir + `/s15-86-fit-${theme}.png` });
      await t('apply').click();
      assert.match(await prompt(), /11 copies.*1 cell skipped/);
      const meta = readMeta(await savedDoc());
      assert.equal(meta.s.gridPart, null); assert.equal(meta.placed.length, 12);
      assert.equal(new Set(meta.placed.map((p) => `${p.x},${p.y}`)).size, 12, 'no cell overlaps the original');
      await t('part').selectOption('fit');
      assert.equal(await t('count').textContent(), '0');
      assert.match(await t('step-hint').textContent(), /^12 cells skipped/);
      assert.equal(await t('apply').isDisabled(), true);
    }
    await closeTabs(/./);
  });

  await step('TODO 87: Auto-nest ignores the grid preview, keeps placed obstacles, Cancel preserves it and Apply replaces it in one undo (light then dark)', async () => {
    for (const theme of ['light', 'dark']) {
      await menuItem('View', 'Theme: ' + theme);
      await fitFixture('nest-preview.dxf');
      const runTen = async () => {
        await t('nest').click();
        for (const input of await page.locator('[data-testid^=nest-count-]').all()) { await input.fill('0'); await input.press('Tab'); }
        await nestSetCount(0, 10); await t('nest-rot-none').click(); await nestRun();
        assert.equal(await t('nest-placed').textContent(), '10 of 10 placed');
        assert.equal(await page.locator('[data-testid=nest-svg] polygon:not([data-testid])').count(), 1, 'only the placed part is fixed');
      };
      await runTen();
      await page.screenshot({ path: shotDir + `/s15-87-nest-${theme}.png` });
      await t('nest-cancel').click();
      assert.equal(await t('count').textContent(), '11', 'Cancel preserves the grid preview');
      assert.equal(await sheetParts(), 12);
      await runTen(); await t('nest-apply').click();
      assert.match(await prompt(), /Auto-nest: 10 parts placed.*Step and repeat preview cleared/);
      assert.equal(await t('part').inputValue(), ''); assert.equal(await sheetParts(), 11);
      const meta = readMeta(await savedDoc());
      assert.equal(meta.s.gridPart, null); assert.equal(meta.placed.length, 11);
      assert.deepEqual([meta.placed[0].x, meta.placed[0].y], [0, 200], 'original part stays put');
      await page.keyboard.press('Control+z');
      assert.equal(await t('part').inputValue(), 'fit'); assert.equal(await t('count').textContent(), '11');
      assert.equal(await sheetParts(), 12, 'one undo restores the preview and original part');
      await page.keyboard.press('Control+Shift+z');
      assert.equal(await t('part').inputValue(), ''); assert.equal(await sheetParts(), 11);
    }
    await closeTabs(/./);
  });

  await step('TODO 88: compact remembered Balloons dock and faster toasts at 1024x768 (light then dark)', async () => {
    const small = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const p = await small.newPage(), q = (id) => p.locator('[data-testid=' + id + ']');
    try {
      await p.goto(URL_); await q('picker').setInputFiles('fixtures/outline.dxf');
      await p.waitForFunction(() => document.querySelector('[data-testid=gap-count]').textContent === '2');
      for (const theme of ['light', 'dark']) {
        await q('picker').setInputFiles('fixtures/outline.dxf');
        await p.waitForFunction(() => document.querySelector('[data-testid=gap-count]').textContent === '2');
        await p.locator('[data-menu=View]').click(); await p.getByRole('menuitemcheckbox', { name: new RegExp('Theme: ' + theme + '$') }).click();
        await p.locator('[data-tool=balloon]').click();
        assert.equal((await q('bal-dock').boundingBox()).height, 140);
        assert.ok((await q('canvas').boundingBox()).height > 350, 'canvas keeps room at 1024?768');
        await p.waitForTimeout(400);
        await p.screenshot({ path: shotDir + '/s15-88-' + theme + '.png' });
        await q('cmd-fade').filter({ has: p.locator('.cb-fade-rows') }).waitFor();
        await p.waitForFunction(() => document.querySelector('[data-testid=cmd-fade]').classList.contains('idle'), null, { timeout: 4000 });
        await p.waitForTimeout(650);
        assert.equal(await q('cmd-fade').locator('.cb-fade-rows').evaluate(e => getComputedStyle(e).opacity), '0');
        const drag = await q('bal-drag').boundingBox();
        await p.mouse.move(drag.x + 30, drag.y + drag.height / 2); await p.mouse.down(); await p.mouse.move(drag.x + 30, drag.y + drag.height / 2 - 40); await p.mouse.up();
        assert.equal((await q('bal-dock').boundingBox()).height, 180);
        await q('bal-collapse').click(); assert.ok((await q('bal-dock').boundingBox()).height < 60);
        await q('bal-collapse').click(); assert.equal((await q('bal-dock').boundingBox()).height, 180);
        await p.reload(); await q('picker').setInputFiles('fixtures/outline.dxf');
        await p.waitForFunction(() => document.querySelector('[data-testid=gap-count]').textContent === '2');
        await p.locator('[data-tool=balloon]').click();
        assert.equal((await q('bal-dock').boundingBox()).height, 180, 'own height survives reload');
        await p.evaluate(() => localStorage.removeItem('pd-baldock-height')); await p.reload(); await q('new-tab').waitFor();
      }
    } finally { await small.close(); }
  });

  await step('TODO 92: tiny gaps skip annotations, require Show per drawing and cap rings at 50 (light then dark)', async () => {
    const isolated = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await isolated.newPage(), q = (id) => p.locator('[data-testid=' + id + ']');
    await p.addInitScript(() => {
      const proto = CanvasRenderingContext2D.prototype, clear = proto.clearRect, arc = proto.arc;
      proto.clearRect = function (...args) { if (this.canvas.dataset.testid === 'drawing') window.__gapRings = 0; return clear.apply(this, args); };
      proto.arc = function (...args) { if (this.canvas.dataset.testid === 'drawing' && Math.abs(args[2] - 9 * devicePixelRatio) < 1e-6) window.__gapRings++; return arc.apply(this, args); };
    });
    const fixture = (n) => {
      const raw = newDoc();
      for (const layer of ['Cut', 'Text', 'Dimensions', 'A-ANNO', 'Hatch', 'Leaders', 'Scale_Marks', 'Arrows']) {
        addLayer(raw, layer);
        const row = layer === 'Cut' ? 0 : 120 + Object.keys(raw.layers).length * 15;
        for (let i = 0; i < (layer === 'Cut' ? n : 4); i++) {
          const x = (i % 10) * 25, y = row + Math.floor(i / 10) * 15;
          if (layer === 'Cut') addEntities(raw, dxfLine(x, y, x + 10, y, { layer }), dxfLine(x + 10.004, y, x + 20, y, { layer }));
          else addEntities(raw, dxfText(x, y, 3, 'note', { layer }));       // TODO 99: annotations are skipped by entity type, not layer name
        }
      }
      addEntities(raw, dxfText(0, 280, 5, 'Letters and arrows stay unmarked'));
      return Buffer.from(writeDxf(raw));
    };
    const open = async (n) => {
      await q('picker').setInputFiles({ name: 'gaps-' + n + '.dxf', mimeType: 'application/dxf', buffer: fixture(n) });
      await p.waitForFunction((n) => document.querySelector('.tabs .dtab.on .tname').textContent === 'gaps-' + n + '.dxf' && document.querySelector('[data-testid=gap-count]').textContent === (n > 50 ? n + ' (count only)' : String(n)), n);
      await p.waitForTimeout(150);
    };
    try {
      await p.goto(URL_); await q('new-tab').waitFor();
      for (const theme of ['light', 'dark']) {
        await p.locator('[data-menu=View]').click(); await p.getByRole('menuitemcheckbox', { name: new RegExp('Theme: ' + theme + '$') }).click();
        await open(50);
        assert.equal(await q('gap-show').getAttribute('aria-pressed'), 'false');
        assert.equal(await p.evaluate(() => window.__gapRings), 0, 'import does not mark gaps');
        await q('gap-show').click();
        await p.waitForFunction(() => window.__gapRings === 50);
        await p.screenshot({ path: shotDir + '/s15-92-rings-' + theme + '.png' });
        await q('gap-show').click(); await p.waitForFunction(() => window.__gapRings === 0);
        await q('gap-show').click(); await p.waitForFunction(() => window.__gapRings === 50);
        await open(51);
        assert.equal(await q('gap-show').getAttribute('aria-pressed'), 'false', 'each imported drawing starts off');
        assert.equal(await q('gap-show').isDisabled(), true);
        assert.equal(await p.evaluate(() => window.__gapRings), 0, 'over the cap draws no rings');
        await p.screenshot({ path: shotDir + '/s15-92-summary-' + theme + '.png' });
        await p.locator('[data-menu=Tools]').click(); await p.getByRole('menuitem', { name: 'Preflight', exact: false }).click();
        assert.equal(await q('preflight-gaps-count').textContent(), '51', 'Preflight uses the same annotation filter');
        await p.getByRole('button', { name: 'Close', exact: true }).click();
        await q('gap-join').click();
        await p.waitForFunction(() => document.querySelector('[data-testid=gap-count]').textContent === '0');
        await p.keyboard.press('Control+z');
        await p.waitForFunction(() => document.querySelector('[data-testid=gap-count]').textContent === '51 (count only)');
        assert.equal(await p.evaluate(() => window.__gapRings), 0);
        p.once('dialog', d => d.accept()); await p.locator('.tabs .dtab.on .x').click();
        await p.waitForFunction(() => window.__gapRings === 50);
      }
    } finally { await isolated.close(); }
  });

  await step('TODO 103: 1000 px/mm and back; widths, text, arrows, grips, snaps, background and precise panning', async () => {
    const isolated = await browser.newContext({ viewport: { width: 1440, height: 900 } }), p = await isolated.newPage();
    const q = (id) => p.locator(`[data-testid="${id}"]`), faults = [];
    p.on('pageerror', (e) => faults.push(String(e)));
    p.on('console', (m) => { if (m.type() === 'error') faults.push(m.text()); });
    await p.addInitScript(() => {
      const proto = CanvasRenderingContext2D.prototype;
      for (const method of ['clearRect', 'stroke', 'fill', 'fillText', 'rect']) {
        const original = proto[method];
        proto[method] = function (...args) {
          if (this.canvas.dataset.testid === 'drawing') {
            if (method === 'clearRect') window.__zoomPaint = { widths: [], texts: [], fills: 0, rects: [] };
            const log = window.__zoomPaint;
            if (method === 'stroke') log.widths.push(this.lineWidth * Math.hypot(this.getTransform().a, this.getTransform().b));
            if (method === 'fill') log.fills++;
            if (method === 'fillText') log.texts.push(args[0]);
            if (method === 'rect' && this.getTransform().a === 1) log.rects.push(args.slice(2));
          }
          return original.apply(this, args);
        };
      }
    });
    try {
      await p.goto(URL_); await q('new-tab').waitFor();
      const X = 10000.123456, Y = 20000.234567, raw = newDoc(4);
      addEntities(raw, dxfLine(X, Y, X + .6, Y, { lw: 5 }), dxfText(X + .1, Y + .2, .08, 'Fine'));
      const { makeDimension, addDimension } = await import('./web/edit.js');
      Object.assign(raw, addDimension(raw, makeDimension([X, Y], [X + .6, Y], 1, raw.blocks, 2, { offset: -.2, textH: .06, arrow: .04, gap: .02 })));
      await q('picker').setInputFiles({ name: 'zoom-detail.dxf', mimeType: 'application/dxf', buffer: Buffer.from(writeDxf(raw)) });
      await p.waitForFunction(() => document.querySelector('.tabs .dtab.on .tname').textContent === 'zoom-detail.dxf');
      const svg = p.locator('.canvas > svg').first();
      const viewNow = async () => (await svg.getAttribute('viewBox')).split(' ').map(Number);
      const atPoint = async (x, y) => {
        const b = await q('canvas').boundingBox(), v = await viewNow(), H = Number(await p.locator('rect.sheet').getAttribute('height'));
        return { x: b.x + (x - v[0]) * b.width / v[2], y: b.y + (H - y - v[1]) * b.height / v[3] };
      };
      const anchor = await atPoint(X + .3, Y), initialZoom = await q('zoom').textContent();
      await q('canvas').dispatchEvent('wheel', { deltaY: -10000, clientX: anchor.x, clientY: anchor.y });
      await p.waitForFunction(() => document.querySelector('[data-testid=zoom]').textContent === '26458%');
      const b = await q('canvas').boundingBox(), v = await viewNow();
      assert.ok(Math.abs(b.width / v[2] - 1000) < 1e-8, 'cap is 1000 px/mm');
      await q('canvas').dispatchEvent('wheel', { deltaY: -1000, clientX: anchor.x, clientY: anchor.y });
      assert.deepEqual(await viewNow(), v, 'zooming past the cap stays anchored');
      await p.waitForFunction(() => window.__zoomPaint?.texts.includes('Fine'));
      const ink = await p.evaluate(() => window.__zoomPaint);
      assert.ok(ink.widths.some((w) => Math.abs(w - 50) < .01), '0.05 mm Hairline is 50 pixels');
      assert.ok(ink.texts.includes('0.60'), 'dimension text is painted');
      assert.ok(ink.fills >= 2, 'dimension arrows are painted');
      await p.keyboard.press('Control+a'); await q('grip').first().waitFor();
      const grip = p.locator('[data-grip="0:m"]'), start = await grip.boundingBox();
      assert.ok(Math.abs(start.width - 11.2) < .02, 'ten-pixel grips plus their 1.2-pixel stroke stay precise');
      await p.mouse.move(anchor.x, anchor.y + 60); await p.mouse.down({ button: 'middle' });
      for (let dx = 1; dx <= 4; dx++) {
        await p.mouse.move(anchor.x + dx, anchor.y + 60 + dx);
        await p.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.ok(Math.abs((await grip.boundingBox()).x - start.x - dx) < .2, 'pan advances one screen pixel without rounding jitter');
        assert.ok(Math.abs((await grip.boundingBox()).y - start.y - dx) < .2, 'vertical pan also advances one screen pixel');
      }
      await p.mouse.move(anchor.x, anchor.y + 60); await p.mouse.up({ button: 'middle' });
      assert.ok(Math.abs((await viewNow())[0] - v[0]) < 1e-9, 'round-trip pan has no drift');
      assert.ok(Math.abs((await viewNow())[1] - v[1]) < 1e-9, 'vertical round-trip pan has no drift');
      await p.keyboard.press('Escape'); await p.locator('[data-tool=line]').click();
      const end = await atPoint(X + .6, Y); await p.mouse.move(end.x + 3, end.y + 2);
      await p.waitForFunction(() => window.__zoomPaint?.texts.includes('end'));
      assert.ok((await p.evaluate(() => window.__zoomPaint.rects)).some(([w, h]) => w === 10 && h === 10), 'endpoint marker stays ten pixels');
      await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
      await p.keyboard.press('Control+a'); await q('grip').first().waitFor();
      for (const theme of ['light', 'dark']) {
        await p.locator('[data-menu=View]').click(); await p.getByRole('menuitemcheckbox', { name: new RegExp('Theme: ' + theme + '$') }).click();
        await p.screenshot({ path: shotDir + '/s16-103-zoom-' + theme + '.png' });
      }
      const background = await p.evaluate(async () => {
        const { paintDrawing } = await import('./render.js');
        const { flatten } = await import('./drawing.js');
        const { newDoc, line } = await import('./dxf-write.js');
        const bitmap = document.createElement('canvas'); bitmap.width = bitmap.height = 2;
        bitmap.getContext('2d').fillRect(0, 0, 2, 2);
        const c = document.createElement('canvas'); c.width = c.height = 200;
        paintDrawing(c, { fl: null, sheetH: 1, ox: 10000, oy: -20000, scale: 1000, w: 200, h: 200, dpr: 1,
          bg: { visible: true, bitmap, x: 10000, y: 20000.8, w: 2, h: 2, mm: .1 } });
        const context = c.getContext('2d'), alpha = context.getImageData(100, 100, 1, 1).data[3];
        c.width = 600; c.height = 300;
        const X = 10000.123456, Y = 20000.234567, raw = newDoc(4);
        raw.entities = [line(X, Y, X + .4, Y, { lw: 5 })];
        const options = { fl: flatten(raw), off: new Set(), factor: 1, sheetH: 700, ox: X - .1, oy: 700 - Y - .1, scale: 1000, w: 600, h: 300, dpr: 1 };
        paintDrawing(c, options);
        const before = context.getImageData(0, 0, 600, 300).data;
        paintDrawing(c, { ...options, ox: options.ox - .001, oy: options.oy - .001 });
        const after = context.getImageData(0, 0, 600, 300).data;
        let differences = 0, ink = 0;
        for (let y = 2; y < 298; y++) for (let x = 2; x < 598; x++) {
          const old = ((y - 1) * 600 + x - 1) * 4, next = (y * 600 + x) * 4;
          if (before[old + 3] > 200) ink++;
          for (let channel = 0; channel < 4; channel++) if (Math.abs(before[old + channel] - after[next + channel]) > 1) differences++;
        }
        return { alpha, differences, ink };
      });
      assert.ok(background.alpha > 90, 'background picture paints at the cap with large offsets');
      assert.ok(background.ink > 1000, 'raster pan fixture rendered');
      assert.equal(background.differences, 0, 'the actual raster moves exactly one pixel in both axes');
      await q('canvas').dispatchEvent('wheel', { deltaY: 100000, clientX: anchor.x, clientY: anchor.y });
      assert.ok(Math.abs(b.width / (await viewNow())[2] - .05) < 1e-10, 'zoom-out cap is unchanged');
      await p.keyboard.press('Control+0'); assert.equal(await q('zoom').textContent(), initialZoom);
      assert.deepEqual(faults, []);
    } finally { await isolated.close(); }
  });

  await step('Usage site: remembered TODO sub-steps, counts and ticks, role data, fresh Knight forecast, tabs, tag filters, token chart, safe refresh errors; phone and desktop, light and dark', async () => {
    const result = spawnSync(process.execPath, ['--test', 'tools/usage-site.browser.test.mjs'], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
  await step('T22a: padlock resizes a selected rectangle to 26.5 x 10, anchors its bottom-left, and undoes each edit', async () => {
    await closeTabs(/./);
    await page.locator('[data-tool=rect]').click(); await typeCmd('20,20'); await typeCmd('20,20');
    await page.keyboard.press('Escape'); await page.locator('[data-tool=select]').click();
    await click(30, 20); await waitSel('1 selected');
    assert.equal(await t('size-padlock').getAttribute('aria-pressed'), 'true');
    await t('size-padlock').click();
    assert.equal(await t('panel-size-padlock').getAttribute('aria-pressed'), 'false');
    await t('sel-w').fill('26.5'); await t('sel-w').press('Enter');
    await t('sel-h').fill('10'); await t('sel-h').press('Enter');
    assert.deepEqual([await t('sel-w').inputValue(), await t('sel-h').inputValue()], ['26.50', '10.00']);
    assert.deepEqual(await sizeNow(), ['26.5', '10']);
    const saved = await downloaded(() => page.keyboard.press('Control+s'));
    assert.deepEqual(flatten(readDxf(saved.text)).boxes.model, [20, 20, 46.5, 30]);
    for (const theme of ['light', 'dark']) {
      await menuItem('View', 'Theme: ' + theme); await page.waitForTimeout(150);
      await page.screenshot({path: shotDir + '/t22a-padlock-' + theme + '.png'});
    }
    await menuItem('View', 'Theme: light');
    await t('undo').click(); assert.deepEqual(await sizeNow(), ['26.5', '20']);
    await t('undo').click(); assert.deepEqual(await sizeNow(), ['20', '20']);
    await click(30, 20); await waitSel('1 selected');
    await t('panel-size-padlock').click();
    await t('sel-w').fill('40'); await t('sel-w').press('Tab');
    assert.equal(await t('sel-h').evaluate((e) => e === document.activeElement), true);
    assert.equal(await t('sel-h').inputValue(), '40.00', 'Tab shows the newly scaled height');
    await t('sel-h').fill('37.25');
    await t('panel-size-padlock').dispatchEvent('click');
    assert.equal(await t('sel-h').inputValue(), '37.25', 'a render preserves the field being typed');
    await t('panel-size-padlock').dispatchEvent('click');
    await t('sel-h').fill('40'); await t('sel-h').press('Enter');
    assert.deepEqual(await sizeNow(), ['40', '40']);
    await t('undo').click(); assert.deepEqual(await sizeNow(), ['20', '20']);
    await t('dw').fill('40'); await t('dw').press('Tab');
    assert.equal(await t('dh').inputValue(), '40', 'panel Tab also shows the updated height');
    await t('undo').click(); assert.deepEqual(await sizeNow(), ['20', '20']);
    await page.keyboard.press('Escape');
    await t('size-padlock').click();
    await t('dw').fill('26.5'); await t('dw').press('Enter'); assert.deepEqual(await sizeNow(), ['26.5', '20']);
    await t('size-padlock').click();
    await closeTabs(/./);
  });

  await step('T22b: rectangle edge drag snaps, updates selection and panel W / H, Shift keeps proportions, one Undo', async () => {
    const doc = newDoc(4);
    addEntities(doc, dxfPoly([[20, 20], [120, 20], [120, 80], [20, 80]], { closed: true }), dxfLine(150, 50, 170, 50));
    await openGrips(writeDxf(doc), 'rectangle-edges.dxf');
    await click(70, 20); await gripWhen(8);
    const size = async (w, h) => {
      assert.deepEqual([await t('sel-w').inputValue(), await t('sel-h').inputValue()], [w.toFixed(2), h.toFixed(2)]);
      assert.deepEqual(await sizeNow(), [String(w), String(h)]);
    };
    if (await t('tog-snap').getAttribute('aria-pressed') !== 'true') await t('tog-snap').click();
    await dragGripTo('0:e1', 149.8, 50.2); await frames();
    await size(130, 60);
    const changed = await savedDoc();
    assert.deepEqual(GR.lwVertices(changed.entities[0].r).map((v) => [v.x, v.y]), [[20, 20], [150, 20], [150, 80], [20, 80]], 'only the right side moves');
    assert.deepEqual(GR.shapeOf(changed.entities[1]), GR.shapeOf(doc.entities[1]), 'the snap target stays put');
    for (const theme of ['light', 'dark']) {
      await menuItem('View', 'Theme: ' + theme); await frames();
      await page.screenshot({ path: shotDir + '/t22b-edge-' + theme + '.png' });
    }
    await menuItem('View', 'Theme: light');
    await undoAndPick(70, 20, 8); await size(100, 60);
    await gripWhen(8);
    await t('tog-snap').click();
    await dragGripTo('0:e1', 149.8, 50.2); await frames();
    const freeW = Number(await t('sel-w').inputValue());
    assert.ok(Math.abs(freeW - 129.8) < .8 && freeW !== 130, 'SNAP off leaves the pick on the free grid, within one screen pixel');
    await size(freeW, 60);
    await undoAndPick(70, 20, 8); await size(100, 60);
    await t('tog-snap').click();
    await page.keyboard.down('Shift');
    await dragGripTo('0:e1', 170, 50);
    await page.keyboard.up('Shift'); await frames(); await size(150, 90);
    await undoAndPick(70, 20, 8); await size(100, 60);
    await closeTabs(/./);
  });

  await step('big file (TODO 55): 20k entities open, views cull what is off screen, pan / zoom stay smooth, the full picture returns when the view settles', async () => {
    const N = 20000, frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const drawn = async () => Number(await t('drawing').getAttribute('data-drawn'));
    await t('picker').setInputFiles({ name: 'big.dxf', mimeType: 'text/plain', buffer: Buffer.from(writeDxf(bigDoc(N))) });
    await page.waitForFunction((n) => document.body.textContent.includes('Entities ' + n), N, { timeout: 60000 });
    await page.getByRole('button', { name: 'Fit', exact: true }).click(); await frame();
    const all = await drawn();
    assert.ok(all > N * 0.8, `fitted, nearly everything draws: ${all}`);
    const box = await t('canvas').boundingBox(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;      // Fit centres the drawing
    await page.mouse.move(cx, cy);
    const t0 = Date.now();
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -200);
    await frame();
    assert.equal(await t('drawing').getAttribute('data-snap'), '1', 'while the view moves, the last picture is reused');
    await page.waitForFunction(() => document.querySelector('[data-testid=drawing]').dataset.snap === '', null, { timeout: 5000 });
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -200);
    await page.waitForFunction(() => document.querySelector('[data-testid=drawing]').dataset.snap === '', null, { timeout: 5000 });
    const some = await drawn();
    assert.ok(some > 0 && some < all / 10, `zoomed in on the middle: entities in view draw (${some}), the rest are skipped (of ${all})`);
    assert.ok(Date.now() - t0 < 5000, 'a burst of wheel zooms is not slow');
    await page.evaluate(() => { window.__frames = 0; const tick = () => { window.__frames++; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    await page.locator('[data-tool=pan]').click();
    await page.mouse.move(cx, cy); await page.mouse.down();
    const f0 = await page.evaluate(() => window.__frames), t1 = Date.now();
    for (let i = 0; i < 40; i++) await page.mouse.move(cx + i * 4, cy - i * 3);
    await frame();
    const fps = ((await page.evaluate(() => window.__frames)) - f0) / ((Date.now() - t1) / 1000);
    await page.mouse.up();
    assert.ok(fps > 10, `panning keeps frames coming (${fps.toFixed(1)} fps; generous bound, machine dependent)`);
    await page.waitForFunction(() => document.querySelector('[data-testid=drawing]').dataset.snap === '', null, { timeout: 5000 });
    assert.ok(await drawn() > 0, 'after the pan, what is in view is drawn in full again');
    await page.getByRole('button', { name: 'Fit', exact: true }).click(); await frame();
    assert.equal(await drawn(), all, 'Fit draws the same set as before');
    await closeTabs(/big/);
  });

  await step('no console errors', async () => { assert.deepEqual(errors, []); });
} catch (e) {
  failed++;
  console.log('FAIL', e.stack || e);
} finally {
  if (browser) await browser.close();
  stop();
}
if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all browser steps passed');
process.exit(0);
