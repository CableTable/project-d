// Called by browser.test.mjs, after CI installs Chromium; never touches the live account or Hosting.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const authModule = `
export const getAuth = () => ({currentUser: {uid: 'owner'}});
export class GoogleAuthProvider {}
export const signInWithPopup = async () => {};
export const signInWithRedirect = async () => {};
export const getRedirectResult = async () => {};
export const signOut = async () => window.__auth(null);
export function onAuthStateChanged(auth, fn) { window.__auth = fn; queueMicrotask(() => fn({uid: 'owner'})); }
`;
const storeModule = `
export const getFirestore = () => ({});
export const doc = (db, collection, name) => ({name});
export const serverTimestamp = () => 0;
const listeners = new Map();
const stamp = (n) => ({toMillis: () => n});
function snapshot(name, value) {
  if (name === 'status') value = {...value, lastUpdate: stamp(value.lastUpdate), agentHeartbeat: stamp(Date.now()), lastErrorAt: stamp(value.lastErrorAt)};
  return {metadata: {fromCache: false}, data: () => value};
}
window.__emit = (name, value) => listeners.get(name)?.(snapshot(name, value));
export function onSnapshot(ref, options, fn) {
  listeners.set(ref.name, fn); fn(snapshot(ref.name, window.__docs[ref.name] || {}));
  return () => listeners.delete(ref.name);
}
export async function setDoc() {
  window.__requestedAt = Date.now();
  window.__emit('status', {...window.__docs.status, lastError: window.__failure, lastErrorAt: Date.now() + 1});
}
export const getDocFromServer = async () => ({data: () => ({requestedAt: stamp(window.__requestedAt)})});
`;

test('Usage site: tabs, tickets, token chart and safe refresh failures on phone and desktop', async (t) => {
  const shotDir = process.env.SHOTS_DIR || 'shots';
  mkdirSync(shotDir, { recursive: true });
  const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const executablePath = process.env.CHROME || (existsSync(local) && !process.env.CI ? local : undefined);
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  t.after(() => browser.close());
  for (const colorScheme of ['light', 'dark']) await t.test(colorScheme, async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme });
    try {
      await context.addInitScript(() => {
        const when = new Date().toISOString();
        window.__failure = 'Rook usage probe failed, exit 1';
        window.__docs = {
          limits: { rows: ['Rook', 'Pip', 'Rowan'].flatMap((agent) => ['5h', 'week'].map((window) => ({ agent, window, role: 'Builder', model: 'Fixture', used_pct: '42', cap_pct: '', starts: '2026-10-01T00:00:00Z', resets: '2027-01-01T00:00:00Z', as_of: when }))) },
          history: { rows: ['Rook', 'Pip', 'Rowan'].flatMap((agent) => ['2026-10-20T18:29:00Z', '2026-10-21T18:30:00Z'].map((when) => ({ when, agent, window: 'week', used_pct: '42' }))) },
          runs: { rows: [{ id: 'run1', agent: 'Rowan', session: '15', task: '<img src=x onerror=alert(1)>', kind: 'build', model: 'Fixture', new_tokens: '10', total_tokens: '20', verdict: 'OK' }] },
          analysis: { items: [
            { id: 'a1', topic: 'Pip and Rowan', note: '<script>plain text</script>', as_of: '2026-10-21T18:45:00Z' },
            { id: 'a2', topic: '2026-10-21T18:45:00Z', note: 'Timestamp topic' },
            { id: 'a3', topic: 'Invalid date', note: 'Still renders', as_of: '2026-99-99T00:00:00Z' },
          ] },
          todo: { sections: [{ title: 'Whole TODO', items: [{ num: 95, title: '<img src=x>', size: 'M', done: false, text: 'Open item' }, { num: 98, title: 'Finished', done: true, text: 'Built' }] }] },
          // 14 IST days of hourly buckets, Oct 8 00:00 IST to Oct 21 23:00 IST. Every agent's weekly resetsAt is 2027-01-01T00:00Z, so its week resets Fridays 00:00Z (Oct 9 and Oct 16 here).
          tokens: { rows: Array.from({ length: 336 }, (_, i) => ({ t: Date.UTC(2026, 9, 7, 18, 30) + i * 3600e3, Rook: 1000, Bishop: 1010, Knight: 1020 })) },
          tickets: { rows: [
            { id: 'T14', status: 'building', size: 'M', type: 'ask', tags: ['feature', 'usage-page', 'mod'], title: '<img src=x onerror=alert(1)>', todo: '95', updated: '2026-10-21', note: '<script>plain note</script>\nSecond line.' },
            { id: 'T17', status: 'checked in exe', size: 'S', type: 'bug', tags: ['bug', 'usage-page'], title: 'Refresh error', todo: '98', updated: '2026-10-21', note: 'Keep last good readings.' },
          ] },
          status: { lastUpdate: Date.now() - 60_000, lastError: '', lastErrorAt: 0 },
        };
      });
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === 'usage.test') {
          const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
          assert.ok(['index.html', 'app.js', 'app.css', 'firebase-config.js', 'token-chart.js', 'usage-window.js'].includes(name));
          return route.fulfill({ body: readFileSync(new URL('../usage-site/public/' + name, import.meta.url)), contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript' });
        }
        if (url.pathname.endsWith('firebase-app.js')) return route.fulfill({ body: 'export const initializeApp = () => ({});', contentType: 'text/javascript' });
        if (url.pathname.endsWith('firebase-auth.js')) return route.fulfill({ body: authModule, contentType: 'text/javascript' });
        if (url.pathname.endsWith('firebase-firestore.js')) return route.fulfill({ body: storeModule, contentType: 'text/javascript' });
        return route.fulfill({ body: '', contentType: 'text/css' }); // Fonts are independent of these flows.
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('http://usage.test/');
      await page.locator('#agents h3').last().waitFor();
      assert.deepEqual(await page.locator('#agents h3').allTextContents(), ['Rook', 'Bishop', 'Knight']);
      const knight = page.locator('#agents .ud-card').filter({has: page.getByRole('heading', {name: 'Knight', exact: true})});
      assert.equal(await knight.locator('.ud-agent p').textContent(), 'Builder and web research (Codex)');
      for (const resets of ['2020-01-01T00:00:00Z', '']) {
        await page.evaluate((resets) => window.__emit('limits', {rows: window.__docs.limits.rows.map((r) => r.agent === 'Rowan' ? {...r, used_pct: '100', resets} : r)}), resets);
        assert.deepEqual(await knight.locator('[data-field=used_pct]').allTextContents(), ['0', '0']);
        assert.deepEqual(await knight.locator('[data-field=resets]').allTextContents(), ['Reset', 'Reset']);
      }
      await page.evaluate(() => window.__emit('limits', window.__docs.limits));
      assert.equal(await page.locator('#token-chart rect').count(), 0);
      assert.equal(await page.locator('#token-chart polyline').count(), 3);
      assert.match(await page.locator('#token-chart svg').getAttribute('aria-label'), /running total.*14 days in IST, back to 0 at each weekly reset; input \+ output \+ cache creation; cache reads excluded/);
      assert.equal(await page.locator('#token-chart').locator('..').locator('h3').textContent(), 'Tokens used, running total');
      assert.equal(await page.locator('#token-chart').locator('..').locator('p').textContent(), 'Running total since each agent\'s weekly reset. Last 14 days in IST. Input + output + cache creation; cache reads excluded.');
      assert.deepEqual(await page.locator('#token-legend span').allTextContents(), ['Rook', 'Bishop', 'Knight']);
      assert.match(await page.locator('#notes tr[data-key=a1] td').first().textContent(), /^Bishop and KnightThu,? 22 Oct, 00:15 IST$/);
      assert.match(await page.locator('#notes tr[data-key=a2] td').first().textContent(), /^Thu,? 22 Oct, 00:15 IST$/);
      assert.equal(await page.locator('#notes tr[data-key=a3] .ud-muted').textContent(), '2026-99-99T00:00:00Z');
      const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const readableDates = async () => {
        // Wait for the ResizeObserver to redraw at the current viewport width.
        await page.waitForFunction(() => {
          return ['token-chart', 'chart'].every((id) => {
            const box = document.getElementById(id);
            return +box.querySelector('svg').getAttribute('viewBox').split(' ')[2] === Math.max(260, box.clientWidth);
          });
        });
        for (const id of ['token-chart', 'chart']) {
          const { labels, box } = await page.locator(`#${id}`).evaluate((chart) => ({
            labels: [...chart.querySelectorAll('text[y="234"]')].map((node) => {
              const { left, right } = node.getBoundingClientRect(); return { left, right, text: node.textContent };
            }),
            box: chart.getBoundingClientRect().toJSON(),
          }));
          assert.equal(labels.at(-1).text, id === 'token-chart' ? '21-Oct' : '22-Oct');
          if (id === 'chart') assert.deepEqual(labels.map((label) => label.text), ['20-Oct', '21-Oct', '22-Oct']);
          assert.ok(labels.length > 1);
          for (const label of labels) {
            assert.match(label.text, /^\d{2}-[A-Z][a-z]{2}$/);
            assert.ok(label.left >= box.x && label.right <= box.x + box.width, `Date labels stay inside ${id}: ${JSON.stringify({ label, box })}`);
          }
          for (let i = 1; i < labels.length; i++) assert.ok(labels[i].left > labels[i - 1].right + 4, 'Date labels must have a readable gap');
        }
      };
      const endLabels = async () => {
        const { labels, box } = await page.locator('#token-chart').evaluate((chart) => ({
          labels: [...chart.querySelectorAll('.token-end')].map((node) => {
            const { left, right, top, bottom } = node.getBoundingClientRect(); return { left, right, top, bottom };
          }),
          box: chart.getBoundingClientRect().toJSON(),
        }));
        assert.equal(labels.length, 3);
        for (const label of labels) {
          assert.ok(label.left >= box.x && label.right <= box.x + box.width, 'End values stay inside the chart');
          assert.ok(label.top >= box.y && label.bottom < box.y + 224, 'End values stay above the dates');
        }
        for (let i = 1; i < labels.length; i++) assert.ok(labels[i].top > labels[i - 1].bottom + 2, 'Close end values have a readable gap');
      };
      const runningChart = async () => {
        const lines = await page.locator('#token-chart').evaluate((chart) => [...chart.querySelectorAll('polyline')].map((node) => ({
          points: [...node.points].map(({ x, y }) => ({ x, y })), color: getComputedStyle(node).stroke,
        })));
        assert.equal(lines.length, 3);
        // Independent expectation: hourly rate per agent, back to 0 in the buckets holding the Oct 9 and Oct 16 00:00Z resets (rows 29 and 197), drawn as a vertical drop.
        const resetRows = [29, 197], rates = [1000, 1010, 1020], max = 168 * 1020;
        for (let a = 0; a < lines.length; a++) {
          const expected = []; let total = 0;
          for (let i = 0; i < 336; i++) {
            if (resetRows.includes(i)) { expected.push({ i, total }); total = 0; }
            expected.push({ i, total: (total += rates[a]) });
          }
          assert.equal(lines[a].points.length, 338);
          expected.forEach((point, k) => {
            assert.ok(Math.abs(lines[a].points[k].y - (212 - point.total / max * 190)) < .001, 'Line plots the running total on the shared scale');
            if (k) assert.ok(lines[a].points[k].x >= lines[a].points[k - 1].x);
          });
          for (const row of resetRows) {
            const k = expected.findIndex((point) => point.i === row);
            assert.equal(lines[a].points[k].x, lines[a].points[k + 1].x, 'A reset is a vertical drop');
            assert.ok(lines[a].points[k + 1].y > lines[a].points[k].y);
          }
        }
        assert.deepEqual(await page.locator('#token-chart .token-end').allTextContents(), ['141.8K', '140.4K', '139K']);
        assert.deepEqual(await page.locator('#token-chart text[text-anchor=end]').allTextContents(), ['0', '85.7K', '171.4K']);
        assert.deepEqual(lines.map((line) => line.color), await page.locator('#token-legend').evaluate((legend) => [...legend.querySelectorAll('i')].map((node) => getComputedStyle(node).backgroundColor)));
        assert.deepEqual(await page.locator('#token-chart').evaluate((chart) => [...chart.querySelectorAll('.token-end')].map((node) => getComputedStyle(node).fill)), lines.map((line) => line.color).reverse());
        assert.equal(await page.locator('#token-chart title').last().textContent(), '21-Oct IST · Knight: 141,780 tokens, running total');
        await endLabels();
        // An extra drop in a stored week % (a manual reset; Knight is stored as Rowan) restarts that line only.
        await page.evaluate(() => window.__emit('history', { rows: [...window.__docs.history.rows, { when: '2026-10-20T08:00:00Z', agent: 'Rowan', window: 'week', used_pct: '60' }, { when: '2026-10-20T09:00:00Z', agent: 'Rowan', window: 'week', used_pct: '2' }] }));
        assert.deepEqual(await page.locator('#token-chart .token-end').allTextContents(), ['140.4K', '139K', '34.7K']);
        assert.equal(await page.locator('#token-chart polyline').nth(2).evaluate((node) => node.points.length), 339);
        await page.evaluate(() => window.__emit('history', window.__docs.history));
        // All-zero totals and two zero agents keep labels inside the lower edge too.
        for (const rook of [0, 1000000]) {
          await page.evaluate((Rook) => window.__emit('tokens', { rows: window.__docs.tokens.rows.map((row) => ({ t: row.t, Rook, Bishop: 0, Knight: 0 })) }), rook);
          await endLabels();
        }
        await page.evaluate(() => window.__emit('tokens', { rows: [] }));
        assert.equal(await page.locator('#token-chart').textContent(), 'No token data uploaded yet.');
        await page.evaluate(() => window.__emit('tokens', window.__docs.tokens));
      };
      await noOverflow();
      await readableDates();
      await runningChart();
      assert.match(await page.locator('#token-chart title').last().textContent(), /^21-Oct IST/);
      assert.match(await page.locator('#chart title').last().textContent(), /22-Oct 00:00 IST$/);
      for (const [when, date] of [['2026-10-31T18:30:00Z', '01-Nov'], ['2026-08-31T18:30:00Z', '01-Sep']]) {
        await page.evaluate((when) => window.__emit('history', { rows: [{ when, agent: 'Rook', window: 'week', used_pct: '42' }] }), when);
        assert.deepEqual(await page.locator('#chart text[y="234"]').allTextContents(), [date]);
      }
      await page.evaluate(() => window.__emit('history', window.__docs.history));
      const task = await page.locator('#runrows td').nth(2).boundingBox();
      const tokens = await page.locator('#runrows td').nth(3).boundingBox();
      assert.ok(task.width > 280 && tokens.width > 280 && tokens.y > task.y, 'Phone runs stack full-width task and new tokens');
      assert.equal(await page.locator('#runrows .bar').isVisible(), true);
      assert.equal(await page.locator('#runrows td').nth(4).isVisible(), false);
      assert.equal(await page.locator('.page-tabs').evaluate((node) => getComputedStyle(node).position), 'fixed');
      await page.screenshot({ path: `${shotDir}/s15-usage-fix-phone-${colorScheme}.png`, fullPage: true });

      // TODO is complete, and completed entries still expand.
      await page.locator('[data-tab=todo]').click();
      assert.equal(await page.locator('#usage').isVisible(), false);
      await page.locator('#todo details summary').click();
      assert.equal(await page.locator('#todo li').count(), 2);
      await noOverflow();

      // Ticket tags filter, All restores, tapping a ticket opens its plain-text note.
      await page.locator('[data-tab=tickets]').click();
      assert.equal(await page.locator('.ticket').count(), 2);
      await page.getByRole('button', { name: 'bug', exact: true }).click();
      assert.deepEqual(await page.locator('.ticket').getAttribute('data-id'), 'T17');
      await page.getByRole('button', { name: 'All', exact: true }).click();
      await page.locator('.ticket[data-id=T14] summary').click();
      assert.equal(await page.locator('.ticket[data-id=T14] .ticket-note').textContent(), '<script>plain note</script>\nSecond line.');
      assert.equal(await page.locator('.ticket[data-id=T17] .ud-chip').getAttribute('class'), 'ud-chip ok');
      assert.equal(await page.locator('#dashboard img, #dashboard script').count(), 0);
      await noOverflow();
      await page.reload();
      await page.locator('.ticket').first().waitFor();
      assert.equal(await page.locator('[data-tab=tickets]').getAttribute('aria-pressed'), 'true');

      // A failed refresh changes only its short status; old readings and charts remain.
      await page.locator('[data-tab=usage]').click();
      const before = await page.locator('#agents').textContent();
      await page.locator('#refresh').click();
      await page.waitForFunction(() => !document.getElementById('refresh').disabled && document.getElementById('last-error').textContent === 'Rook usage probe failed, exit 1');
      assert.equal(await page.locator('#message').textContent(), '');
      assert.equal(await page.locator('#last-error').textContent(), 'Rook usage probe failed, exit 1');
      assert.equal(await page.locator('#agents').textContent(), before);
      assert.equal(await page.locator('#token-chart polyline').count(), 3);
      await page.evaluate(() => window.__emit('status', { ...window.__docs.status, lastError: 'stack trace secret hook_started JSON', lastErrorAt: Date.now() }));
      assert.equal(await page.locator('#last-error').textContent(), 'Usage refresh failed; see the local agent log');
      await page.evaluate(() => window.__emit('status', { ...window.__docs.status, lastError: 'Main account: 100%, limit reached', lastErrorAt: Date.now() }));
      assert.equal(await page.locator('#last-error').textContent(), 'Main account: 100%, limit reached');

      await page.setViewportSize({ width: 1280, height: 900 });
      assert.equal(await page.locator('.page-tabs').evaluate((node) => getComputedStyle(node).position), 'static');
      assert.equal(await page.locator('.charts').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length), 2);
      const brand = await page.locator('#top').boundingBox(), tabs = await page.locator('.page-tabs').boundingBox();
      assert.ok(tabs.x > brand.x + brand.width && Math.abs((tabs.y + tabs.height / 2) - (brand.y + brand.height / 2)) < 2, 'Desktop brand and tabs share a row');
      await readableDates();
      await runningChart();
      await page.screenshot({ path: `${shotDir}/s15-usage-fix-desktop-${colorScheme}.png`, fullPage: true });
      for (const tab of ['usage', 'todo', 'tickets']) { await page.locator(`[data-tab=${tab}]`).click(); await noOverflow(); }

      // Denied storage still permits all tabs, and signing out clears private ticket DOM.
      await context.addInitScript(() => { Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new Error('Storage blocked'); }; });
      await page.reload(); await page.locator('#agents h3').last().waitFor();
      assert.equal(await page.locator('[data-tab=usage]').getAttribute('aria-pressed'), 'true');
      await page.locator('[data-tab=tickets]').click();
      await page.locator('#signout').click();
      assert.equal(await page.locator('#dashboard').isVisible(), false);
      assert.equal(await page.locator('.page-tabs').isVisible(), false);
      assert.equal(await page.locator('.ticket').count(), 0);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
});
