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
  mkdirSync('shots', { recursive: true });
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
          tokens: { rows: Array.from({ length: 14 }, (_, i) => ({ day: '2026-10-' + String(i + 8).padStart(2, '0'), Rook: i * 10, Bishop: i * 20, Knight: i * 30 })) },
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
          assert.ok(['index.html', 'app.js', 'app.css', 'firebase-config.js'].includes(name));
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
      assert.equal(await page.locator('#token-chart rect').count(), 42);
      assert.match(await page.locator('#token-chart svg').getAttribute('aria-label'), /14 days in IST; cache reads excluded/);
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
          const labels = await page.locator(`#${id} text[y="234"]`).evaluateAll((nodes) => nodes.map((node) => {
            const { left, right } = node.getBoundingClientRect(); return { left, right, text: node.textContent };
          }));
          assert.equal(labels.at(-1).text, id === 'token-chart' ? '21-Oct' : '22-Oct');
          if (id === 'chart') assert.deepEqual(labels.map((label) => label.text), ['20-Oct', '21-Oct', '22-Oct']);
          const box = await page.locator(`#${id}`).boundingBox();
          assert.ok(labels.length > 1);
          for (const label of labels) {
            assert.match(label.text, /^\d{2}-[A-Z][a-z]{2}$/);
            assert.ok(label.left >= box.x && label.right <= box.x + box.width, 'Date labels stay inside the chart');
          }
          for (let i = 1; i < labels.length; i++) assert.ok(labels[i].left > labels[i - 1].right + 4, 'Date labels must have a readable gap');
        }
      };
      await noOverflow();
      await readableDates();
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
      await page.screenshot({ path: `shots/s15-usage-fix-phone-${colorScheme}.png`, fullPage: true });

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
      assert.equal(await page.locator('#token-chart rect').count(), 42);
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
      await page.screenshot({ path: `shots/s15-usage-fix-desktop-${colorScheme}.png`, fullPage: true });
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
