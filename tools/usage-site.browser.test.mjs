// Called by browser.test.mjs, after CI installs Chromium; never touches the live account or Hosting.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

// What the agent's parseTodo (kit/usage-agent.mjs) makes of a small TODO.md: written out, so this test reads no kit file.
const todoFixture = {"sections":[{"title":"Whole TODO","items":[{"num":66,"title":"More Modify tools","size":"L","done":false,"text":"(L): Move, copy and rotate.","substeps":[{"num":"66a","done":true,"text":"Move objects with one undo."},{"num":"66b","done":false,"text":"Copy objects; <img src=x onerror=alert(1)> is plain text."},{"num":"66c","done":false,"text":"Rotate about a chosen pivot."}]},{"num":95,"title":"<img src=x>","size":"M","done":false,"text":"(M): Open item (a built, b next)."},{"num":98,"title":"Finished","size":"S","done":true,"text":"(S): Built.","substeps":[{"num":"98a","done":true,"text":"First fix."},{"num":"98b","done":true,"text":"Second fix."}]}]},{"title":"Shipped","items":[{"num":70,"title":"Old win","size":"S","done":true,"text":"(S): Built."}]},{"title":"Planned","items":[{"num":71,"title":"Next up","size":"S","done":false,"text":"(S): Not started."}]}]};

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

test('TODO 198b: Rook stuck line shown in IST and hidden on recovery or sign-out', async (t) => {
  const shotDir = process.env.SHOTS_DIR || 'shots-198b';
  mkdirSync(shotDir, { recursive: true });
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  t.after(() => browser.close());
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme });
    try {
      await context.addInitScript(() => { window.__docs = {}; });
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === 'usage.test') {
          const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
          assert.ok(['index.html', 'app.js', 'app.css', 'firebase-config.js', 'token-chart.js', 'usage-window.js'].includes(name));
          return route.fulfill({ body: readFileSync(new URL('../usage-site/public/' + name, import.meta.url)), contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript' });
        }
        const body = url.pathname.endsWith('firebase-app.js') ? 'export const initializeApp = () => ({});'
          : url.pathname.endsWith('firebase-auth.js') ? authModule : url.pathname.endsWith('firebase-firestore.js') ? storeModule : '';
        return route.fulfill({ body, contentType: body ? 'text/javascript' : 'text/css' });
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('http://usage.test/');
      await page.locator('#dashboard').waitFor();
      assert.equal(await page.locator('#rook-stuck').count(), 1);
      assert.equal(await page.locator('#rook-stuck').isVisible(), false); // No uploaded rook doc yet.
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => window.__emit('rook', { stuck: true, since: '2026-11-05T18:45:00.000Z' }));
        assert.equal(await page.locator('#rook-stuck').isVisible(), true);
        assert.equal(await page.locator('#rook-stuck').textContent(), 'Rook stuck since 00:15');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: `${shotDir}/rook-stuck-${width}-${colorScheme}.png`, fullPage: true });
        await page.evaluate(() => window.__emit('rook', { stuck: false, since: '2026-11-05T18:45:00.000Z' }));
        assert.equal(await page.locator('#rook-stuck').isVisible(), false);
        assert.equal(await page.locator('#rook-stuck').textContent(), '');
        await page.screenshot({ path: `${shotDir}/rook-clear-${width}-${colorScheme}.png`, fullPage: true });
      }
      await page.evaluate(() => window.__emit('rook', { stuck: true, since: '<img src=x>' }));
      assert.equal(await page.locator('#rook-stuck').isVisible(), false);
      assert.equal(await page.locator('#rook-stuck img').count(), 0);
      await page.evaluate(() => window.__emit('rook', { stuck: true, since: '2026-11-05T18:45:00.000Z' }));
      await page.locator('#signout').click();
      const cleared = await (await page.waitForFunction(() => { const el = document.getElementById('rook-stuck'); return el.hidden ? { text: el.textContent } : null; })).jsonValue();
      assert.equal(cleared.text, '');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test('TODO U1b: Queue tab lists running runs first, then newest first, as plain text, and sign-out empties it', async (t) => {
  const shotDir = process.env.SHOTS_DIR || 'shots-U1b';
  mkdirSync(shotDir, { recursive: true });
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  t.after(() => browser.close());
  // What the agent's parseQueue (kit/usage-agent.mjs) makes of a small queue.txt, in file order.
  const queue = { updated: '2026-11-05T18:45:00.000Z', next: ['<img src=x onerror=alert(1)>'], rows: [
    { kind: 'build', id: 'K1', out: 'runs1/b-K1.txt', state: 'ended', extra: 'ship' },
    { kind: 'build', id: 'K2', out: 'runs1/b-K2.txt', state: 'running' },
    { kind: 'review', id: '<img src=x onerror=alert(1)>', out: 'runs1/rv-K2.txt', state: 'ended', extra: 'denied: 2' },
  ] };
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme });
    try {
      await context.addInitScript((queue) => { window.__docs = { queue }; }, queue);
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === 'usage.test') {
          const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
          assert.ok(['index.html', 'app.js', 'app.css', 'firebase-config.js', 'token-chart.js', 'usage-window.js'].includes(name));
          return route.fulfill({ body: readFileSync(new URL('../usage-site/public/' + name, import.meta.url)), contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript' });
        }
        const body = url.pathname.endsWith('firebase-app.js') ? 'export const initializeApp = () => ({});'
          : url.pathname.endsWith('firebase-auth.js') ? authModule : url.pathname.endsWith('firebase-firestore.js') ? storeModule : '';
        return route.fulfill({ body, contentType: body ? 'text/javascript' : 'text/css' });
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('http://usage.test/');
      await page.locator('#dashboard').waitFor();
      assert.equal(await page.locator('#queue').isVisible(), false);
      await page.locator('[data-tab=queue]').click();
      assert.equal(await page.locator('#queue').isVisible(), true);
      assert.equal(await page.locator('[data-tab=queue]').getAttribute('aria-pressed'), 'true');
      assert.match(await page.locator('#queue-updated').textContent(), /^Updated Fri,? 6 Nov,? 00:15 IST$/);
      const ids = () => page.locator('#queue-list .queue-row strong').allTextContents();
      assert.deepEqual(await ids(), ['building K2', '<img src=x onerror=alert(1)>', 'checked K2', 'built K1']); // Now (running), Next (planned id, shown as text), Done (newest first)
      assert.deepEqual(await page.locator('#queue-list .ud-chip').evaluateAll((chips) => chips.map((c) => c.className + ':' + c.textContent)), ['ud-chip warn:running', 'ud-chip ok:done', 'ud-chip ok:done']);
      assert.equal(await page.locator('#queue img').count(), 0);
      assert.equal(new Set(await page.locator('.page-tabs button').evaluateAll((b) => b.map((x) => x.getBoundingClientRect().top))).size, 1, 'Four tabs share one row on a phone');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `${shotDir}/queue-phone-${colorScheme}.png`, fullPage: true });
      await page.evaluate(() => window.__emit('queue', { rows: [] }));
      assert.equal(await page.locator('#queue-list').textContent(), 'No runs');
      assert.equal(await page.locator('#queue-updated').textContent(), '');
      await page.evaluate(() => window.__emit('queue', { rows: [], next: ['K9'] }));
      assert.deepEqual(await ids(), ['K9']); // empty rows still show the Next line
      assert.match(await page.locator('#queue-list').textContent(), /^No runsNext/);
      await page.evaluate((queue) => window.__emit('queue', queue), queue);
      assert.equal((await ids()).length, 4);
      await page.locator('#signout').click();
      await page.waitForFunction(() => document.getElementById('dashboard').hidden);
      assert.equal(await page.locator('#queue-list .queue-row').count(), 0);
      assert.equal(await page.locator('#queue-updated').textContent(), '');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test('TODO U1d: Queue row reads Who verb item · short title with a running / done chip and no raw line', async (t) => {
  const shotDir = process.env.SHOTS_DIR || 'shots-U1c';
  mkdirSync(shotDir, { recursive: true });
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  t.after(() => browser.close());
  const sha = '855b4951d56364408799500f0997906b99300edc';
  // Rows as the agent's parseQueue makes them, in file order.
  const queue = { updated: '2026-11-05T18:45:00.000Z', rows: [
    { kind: 'review', id: sha, out: 'review-277.jsonl', state: 'ended', extra: '' }, // chained review: out is review-<id>, not rv-<id>
    { kind: 'build', id: 'king/273a', out: 'b-273a.jsonl', state: 'ended', extra: '' }, // sub-id: title of TODO 273
    { kind: 'build', id: 'king/280bfix1', out: 'b-280bfix1.jsonl', state: 'ended', extra: '' },
    { kind: 'review', id: '280abcdf0000000000000000000000000000000', out: 'check.jsonl', state: 'ended', extra: '' }, // a sha that starts with digits is no TODO id
    { kind: 'fresh', id: 'U1c', out: 'fresh-U1c.out', state: 'ended', extra: '' },
    { kind: 'job', id: 'debt47 (bishop, claude-sonnet-5-5)', out: 'debt47.jsonl', state: 'ended', extra: '' },
    { kind: 'suite', id: '0225cb8', out: 'suite-0225cb8.log', state: 'ended', extra: '' },
    { kind: 'review', id: sha, out: 'rv-277.jsonl', state: 'ended', extra: 'autofix · denied: 2' },
    { kind: 'review', id: sha, out: 'check.jsonl', state: 'ended', extra: '' },
    { kind: 'build', id: 'king/999', out: 'b-999.jsonl', state: 'ended', extra: '' },
    { kind: 'build', id: 'king/275', out: 'b-275.jsonl', state: 'running', extra: '' },
  ] };
  const todo = { sections: [{ title: 'Whole TODO', items: [
    { num: 275, title: 'Rotate objects about a chosen pivot point', done: false },
    { num: 273, title: 'Huge files: Hairline on all crashes', done: false },
    { num: 277, title: 'Copy objects with undo', done: true },
    { num: 279, title: 'U1c: plain Queue rows', done: false },
    { num: 280, title: 'U1d: simpler Queue tab with Next and short titles', done: true },
  ] }] };
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme });
    try {
      await context.addInitScript((docs) => { window.__docs = docs; }, { queue, todo });
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === 'usage.test') {
          const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
          assert.ok(['index.html', 'app.js', 'app.css', 'firebase-config.js', 'token-chart.js', 'usage-window.js'].includes(name));
          return route.fulfill({ body: readFileSync(new URL('../usage-site/public/' + name, import.meta.url)), contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript' });
        }
        const body = url.pathname.endsWith('firebase-app.js') ? 'export const initializeApp = () => ({});'
          : url.pathname.endsWith('firebase-auth.js') ? authModule : url.pathname.endsWith('firebase-firestore.js') ? storeModule : '';
        return route.fulfill({ body, contentType: body ? 'text/javascript' : 'text/css' });
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('http://usage.test/');
      await page.locator('#dashboard').waitFor();
      await page.locator('[data-tab=queue]').click();
      await page.getByRole('button', { name: 'Show 5 more' }).click(); // 10 done rows: 5 shown first
      assert.deepEqual(await page.locator('#queue-list .queue-row strong').allTextContents(), [
        'King building 275 · Rotate objects about a chosen pivot point', // running first
        'King built 999', // no TODO 999: no title
        'checked 855b495', // sha only: short sha
        'checked 277 · Copy objects with undo',
        'Full tests 0225cb8',
        'Bishop job debt47',
        'Grill check U1c · plain Queue rows', // letter id: title starts with "U1c:", prefix dropped
        'checked 280abcd',
        'King built 280b fix · simpler Queue tab with Next and short titles',
        'King built 273a · Huge files: Hairline on all crashes',
        'checked 277 · Copy objects with undo',
      ]);
      assert.deepEqual(await page.locator('#queue-list .ud-chip').allTextContents(), ['running', ...Array(10).fill('done')]);
      assert.equal(await page.locator('#queue-list .queue-raw').count(), 0);
      assert.equal(await page.locator('#queue-list table').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `${shotDir}/queue-rows-${colorScheme}.png`, fullPage: true });
      await page.evaluate(() => window.__emit('todo', { sections: [] }));
      assert.equal(await page.locator('#queue-list .queue-row strong').first().textContent(), 'King building 275'); // title left out when the TODO has none
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test('TODO 280b: Queue tab has Now / Next / Done parts, 5 done rows and a Show N more toggle, no long sha, one column on a phone', async (t) => {
  const shotDir = process.env.SHOTS_DIR || 'shots-280b';
  mkdirSync(shotDir, { recursive: true });
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  t.after(() => browser.close());
  const sha = '855b4951d56364408799500f0997906b99300edc';
  const ended = (id, out = id + '.jsonl') => ({ kind: 'build', id: 'king/' + id, out, state: 'ended', extra: '' });
  const queue = { updated: '2026-11-05T18:45:00.000Z', next: ['264', 'U1d', 999], rows: [
    ended('101'), ended('102'), ended('103'), ended('104'), ended('105'),
    { kind: 'review', id: sha, out: 'check.jsonl', state: 'ended', extra: '' },
    { kind: 'suite', id: sha, out: 'suite.log', state: 'ended', extra: '' },
    { kind: 'build', id: 'king/108', out: 'b-108.jsonl', state: 'running', extra: '' },
  ] };
  const todo = { sections: [{ title: 'Whole TODO', items: [
    { num: 264, title: 'Rotate objects about a chosen pivot point with one undo step please', done: false },
    { num: 280, title: 'U1d: simpler Queue tab', done: false },
  ] }] };
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme });
    try {
      await context.addInitScript((docs) => { window.__docs = docs; }, { queue, todo });
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === 'usage.test') {
          const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
          assert.ok(['index.html', 'app.js', 'app.css', 'firebase-config.js', 'token-chart.js', 'usage-window.js'].includes(name));
          return route.fulfill({ body: readFileSync(new URL('../usage-site/public/' + name, import.meta.url)), contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript' });
        }
        const body = url.pathname.endsWith('firebase-app.js') ? 'export const initializeApp = () => ({});'
          : url.pathname.endsWith('firebase-auth.js') ? authModule : url.pathname.endsWith('firebase-firestore.js') ? storeModule : '';
        return route.fulfill({ body, contentType: body ? 'text/javascript' : 'text/css' });
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('http://usage.test/');
      await page.locator('#dashboard').waitFor();
      await page.locator('[data-tab=queue]').click();
      const lines = () => page.locator('#queue-list .queue-row strong').allTextContents();
      assert.deepEqual(await page.locator('#queue-list h3').allTextContents(), ['Now', 'Next', 'Done']);
      assert.deepEqual((await lines()).slice(0, 4), ['King building 108', '264 · Rotate objects about a chosen pivot point with…', 'U1d · simpler Queue tab', '999']); // Next: titles, letter id, none
      assert.equal((await lines()).length, 9, '1 now + 3 next + 5 done');
      assert.deepEqual((await lines()).slice(4, 6), ['Full tests 855b495', 'checked 855b495']); // newest done first, sha cut to 7
      assert.equal(await page.getByRole('button', { name: 'Show 2 more' }).getAttribute('aria-expanded'), 'false');
      assert.doesNotMatch(await page.locator('#queue').innerText(), /[0-9a-f]{8,}/i); // innerText: textContent glues the "done" chip onto the sha
      // One column, chip right of the text, nothing wider than the phone.
      const box = await page.locator('#queue-list').evaluate((list) => ({
        cards: [...list.querySelectorAll('.ud-card')].map((c) => c.getBoundingClientRect()).map((r) => [r.left, r.right]),
        chipRight: [...list.querySelectorAll('.queue-row')].filter((r) => r.querySelector('.ud-chip')).every((r) => r.querySelector('.ud-chip').getBoundingClientRect().left >= r.querySelector('strong').getBoundingClientRect().right - 1),
      }));
      assert.equal(new Set(box.cards.map((c) => c.join())).size, 1, 'Every part is one full-width column');
      assert.equal(box.chipRight, true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `${shotDir}/queue-parts-${colorScheme}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Show 2 more' }).click();
      assert.equal((await lines()).length, 11);
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); // the button sits just under the fixed tab bar until the page is scrolled to its end
      await page.getByRole('button', { name: 'Show fewer' }).click();
      assert.equal((await lines()).length, 9);
      await page.setViewportSize({ width: 1024, height: 800 });
      await page.screenshot({ path: `${shotDir}/queue-parts-1024-${colorScheme}.png`, fullPage: true });
      await page.evaluate(() => window.__emit('queue', { updated: '2026-11-05T18:45:00.000Z', rows: [{ kind: 'build', id: 'king/108', out: 'b-108.jsonl', state: 'ended', extra: '' }] }));
      assert.equal(await page.locator('#queue-list p').allTextContents().then((p) => p.join('|')), 'Now: nothing running|Next: nothing planned'); // no `next` field yet
      assert.equal(await page.getByRole('button', { name: /Show/ }).count(), 0);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test('Usage site: remembered TODO sub-steps, tabs, tickets, forecasts and safe refresh failures on phone and desktop', async (t) => {
  const shotDir = process.env.SHOTS_DIR || 'shots';
  mkdirSync(shotDir, { recursive: true });
  const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const executablePath = process.env.CHROME || (existsSync(local) && !process.env.CI ? local : undefined);
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  t.after(() => browser.close());
  for (const colorScheme of ['light', 'dark']) await t.test(colorScheme, async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme });
    try {
      await context.addInitScript((todo) => {
        const when = new Date().toISOString();
        window.__failure = 'Rook usage probe failed, exit 1';
        window.__docs = {
          limits: { rows: ['Rook', 'Pip', 'King', 'Rowan'].flatMap((agent) => ['5h', 'week'].map((window) => ({ agent, window, role: 'Builder', model: 'Fixture', used_pct: '42', cap_pct: '', starts: '2026-10-01T00:00:00Z', resets: '2027-01-01T00:00:00Z', as_of: when }))) },
          history: { rows: ['Rook', 'Pip', 'King', 'Rowan'].flatMap((agent) => ['2026-10-20T18:29:00Z', '2026-10-21T18:30:00Z'].map((when) => ({ when, agent, window: 'week', used_pct: '42' }))) },
          runs: { rows: [{ id: 'run1', agent: 'Rowan', session: '15', task: '<img src=x onerror=alert(1)>', kind: 'build', model: 'Fixture', new_tokens: '10', total_tokens: '20', verdict: 'OK' }] },
          analysis: { items: [
            { id: 'a1', topic: 'Pip and Rowan', note: '<script>plain text</script>', as_of: '2026-10-21T18:45:00Z' },
            { id: 'a2', topic: '2026-10-21T18:45:00Z', note: 'Timestamp topic' },
            { id: 'a3', topic: 'Invalid date', note: 'Still renders', as_of: '2026-99-99T00:00:00Z' },
          ] },
          todo,
          // 14 IST days of hourly buckets, Oct 8 00:00 IST to Oct 21 23:00 IST. Every agent's weekly resetsAt is 2027-01-01T00:00Z, so its week resets Fridays 00:00Z (Oct 9 and Oct 16 here).
          tokens: { rows: Array.from({ length: 336 }, (_, i) => ({ t: Date.UTC(2026, 9, 7, 18, 30) + i * 3600e3, Rook: 1000, Bishop: 1010, King: 1015, Knight: 1020 })) },
          tickets: { rows: [
            { id: 'T14', status: 'building', size: 'M', type: 'ask', tags: ['feature', 'usage-page', 'mod'], title: '<img src=x onerror=alert(1)>', todo: '95', updated: '2026-10-21', note: '<script>plain note</script>\nSecond line.' },
            { id: 'T17', status: 'checked in exe', size: 'S', type: 'bug', tags: ['bug', 'usage-page'], title: 'Refresh error', todo: '98', updated: '2026-10-21', note: 'Keep last good readings.' },
            { id: 'T20', status: 'Done 2026-11-01', size: 'S', type: 'ask', tags: ['feature'], title: 'Closed feature', todo: '99', updated: '2026-11-01', note: '' },
            { id: 'T21', status: 'open', size: 'S', type: 'bug', tags: ['bug'], title: 'Open bug', todo: '', updated: '2026-11-02', note: '' },
          ] },
          status: { lastUpdate: Date.now() - 60_000, lastError: '', lastErrorAt: 0 },
        };
      }, todoFixture);
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
      assert.deepEqual(await page.locator('#agents h3').allTextContents(), ['Rook', 'Bishop', 'King']); // Knight is retired: no card, though its tokens still chart
      assert.equal(await page.title(), 'Usage');
      assert.equal(await page.locator('#top').textContent(), 'Usage');
      assert.equal(await page.locator('.ud-main').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length), 1, 'One column on a phone');
      // King: its own card with a 5-hour ring, the week bar, a forecast line, and its own colour (not Bishop's or Knight's).
      const king = page.locator('#agents .ud-card').filter({has: page.getByRole('heading', {name: 'King', exact: true})});
      assert.equal(await king.locator('.ud-ring').count(), 1);
      assert.equal(await king.locator('.ud-meter').count(), 1);
      assert.match(await king.textContent(), /42%King.*5 h: resets in.*Week 42%resets .*no cap today(?:~\d+% at reset|too early to tell)$/);
      const fills = await page.locator('#agents .ud-card:not(.ud-empty)').evaluateAll((cards) => cards.map((card) => getComputedStyle(card.querySelector('.ud-fill')).backgroundColor));
      assert.equal(new Set(fills).size, 3);
      assert.equal(fills[2], await page.locator('#token-legend i').nth(2).evaluate((node) => getComputedStyle(node).backgroundColor));
      // The chart's Knight bar and legend show only while the uploaded tokens hold some Knight use; the Queen slot is always there, empty.
      await page.evaluate(() => window.__emit('tokens', { rows: window.__docs.tokens.rows.map((row) => ({ ...row, Knight: 0 })) }));
      assert.deepEqual(await page.locator('#agents h3').allTextContents(), ['Rook', 'Bishop', 'King']);
      assert.deepEqual(await page.locator('#token-legend span').allTextContents(), ['Rook', 'Bishop', 'King']);
      assert.equal(await page.locator('#token-chart .token-bar').count(), 21);
      assert.equal(await page.locator('#agents .ud-empty').textContent(), 'Queenempty slot, no account yet');
      await page.evaluate(() => window.__emit('tokens', window.__docs.tokens));
      // Rows uploaded under the new name Bishop (the old name was Pip) fill the same card.
      await page.evaluate(() => window.__emit('limits', {rows: window.__docs.limits.rows.map((r) => r.agent === 'Pip' ? {...r, agent: 'Bishop'} : r)}));
      assert.deepEqual(await page.locator('#agents h3').allTextContents(), ['Rook', 'Bishop', 'King']);
      await page.evaluate(() => window.__emit('limits', window.__docs.limits));
      const rook = page.locator('#agents .ud-card').filter({has: page.getByRole('heading', {name: 'Rook', exact: true})});
      for (const [used, hours, hits] of [['3', 4, false], ['20', 14, true], ['0', 14, false], ['', 14, false]]) {      // a Claude account gets no forecast until its week has 12 h of data and some use
        await page.evaluate(([used_pct, hours]) => {
          const now = Date.now();
          window.__emit('limits', {rows: window.__docs.limits.rows.map((r) => r.agent === 'Rook' ? {...r, used_pct, starts: new Date(now - hours * 3600e3).toISOString(), resets: new Date(now + (168 - hours) * 3600e3).toISOString(), as_of: new Date(now).toISOString()} : r)});
        }, [used, hours]);
        if (hits) assert.equal(await rook.locator('[data-field=hit_at]').textContent(), 'hits 100% before reset');
        else assert.match(await rook.textContent(), /too early to tell/);
      }
      await page.evaluate(() => window.__emit('limits', window.__docs.limits));
      assert.equal(await page.locator('#token-chart .token-bar').count(), 28);
      assert.equal(await page.locator('#token-chart polyline').count(), 0);
      assert.match(await page.locator('#token-chart svg').getAttribute('aria-label'), /per account per day.*7 days in IST; input \+ output \+ cache creation; cache reads excluded/);
      assert.equal(await page.locator('#tokens h2').textContent(), 'Tokens per day');
      assert.equal(await page.locator('#token-note').textContent(), 'Input + output + cache creation; cache reads excluded.'); // no "Today so far": the newest row is in October
      assert.deepEqual(await page.locator('#token-legend span').allTextContents(), ['Rook', 'Bishop', 'King', 'Knight']);
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
          const { labels, box } = await page.locator(`#${id}`).evaluate((chart, y) => ({
            labels: [...chart.querySelectorAll(`text[y="${y}"]`)].map((node) => {
              const { left, right } = node.getBoundingClientRect(); return { left, right, text: node.textContent };
            }),
            box: chart.getBoundingClientRect().toJSON(),
          }), id === 'token-chart' ? 118 : 234);
          assert.equal(labels.at(-1).text, id === 'token-chart' ? 'Wed' : '22-Oct'); // 21 Oct 2026 is a Wednesday
          if (id === 'chart') assert.deepEqual(labels.map((label) => label.text), ['20-Oct', '21-Oct', '22-Oct']);
          else assert.deepEqual(labels.map((label) => label.text), ['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed']); // 15 to 21 Oct
          assert.ok(labels.length > 1);
          for (const label of labels) {
            assert.match(label.text, id === 'token-chart' ? /^[A-Z][a-z]{2}$/ : /^\d{2}-[A-Z][a-z]{2}$/);
            assert.ok(label.left >= box.x && label.right <= box.x + box.width, `Date labels stay inside ${id}: ${JSON.stringify({ label, box })}`);
          }
          for (let i = 1; i < labels.length; i++) assert.ok(labels[i].left > labels[i - 1].right + 4, 'Date labels must have a readable gap');
        }
      };
      const dayBars = async () => {
        const bars = await page.locator('#token-chart').evaluate((chart) => [...chart.querySelectorAll('.token-bar')].map((node) => ({ h: +node.getAttribute('height'), y: +node.getAttribute('y'), fill: getComputedStyle(node).fill })));
        assert.equal(bars.length, 28);
        // Independent expectation: 24 hourly buckets a day at each agent's rate, on one shared scale (plot 84 px, baseline 100); the biggest day is 24,480, so the axis is 0 / 10K / 20K / 30K.
        const rates = [1000, 1010, 1015, 1020], max = 30000;
        bars.forEach((bar, k) => {
          assert.ok(Math.abs(bar.h - rates[k % 4] * 24 / max * 84) < .001, 'Bar height is that day\'s tokens on the shared scale');
          assert.ok(Math.abs(bar.y + bar.h - 100) < .001, 'Bars stand on the baseline');
        });
        assert.deepEqual(bars.slice(0, 4).map((bar) => bar.fill), await page.locator('#token-legend').evaluate((legend) => [...legend.querySelectorAll('i')].map((node) => getComputedStyle(node).backgroundColor)));
        assert.deepEqual(await page.locator('#token-chart text[text-anchor=end]').allTextContents(), ['0', '10K', '20K', '30K']);
        assert.equal(await page.locator('#token-chart title').last().textContent(), '21-Oct IST · Knight: 24,480 tokens');
        // All-zero totals draw empty bars, not NaN.
        await page.evaluate(() => window.__emit('tokens', { rows: window.__docs.tokens.rows.map((row) => ({ t: row.t, Rook: 0, Bishop: 0, King: 0, Knight: 0 })) }));
        assert.deepEqual(await page.locator('#token-chart .token-bar').evaluateAll((nodes) => [...new Set(nodes.map((node) => node.getAttribute('height')))]), ['0']);
        await page.evaluate(() => window.__emit('tokens', { rows: [] }));
        assert.equal(await page.locator('#token-chart').textContent(), 'No token data uploaded yet.');
        await page.evaluate(() => window.__emit('tokens', window.__docs.tokens));
      };
      await noOverflow();
      await readableDates();
      await dayBars();
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

      // TODO sub-steps have counts and ticks, remember open and closed, and survive a live update.
      await page.locator('[data-tab=todo]').click();
      assert.equal(await page.locator('#usage').isVisible(), false);
      const substeps = page.locator('#todo .ud-substeps').first();
      const checkSubsteps = async (device) => {
        assert.equal(await substeps.locator('summary').textContent(), '1 of 3 done');
        assert.equal(await substeps.evaluate((e) => e.open), false);
        assert.equal(await substeps.locator('li').first().isVisible(), false);
        await substeps.locator('summary').click();
        assert.equal(await substeps.locator('[aria-label=Done]').count(), 1);
        assert.equal(await substeps.locator('[aria-label="Not done"]').count(), 2);
        assert.match(await substeps.locator('li').nth(1).textContent(), /66b\..*<img src=x/);
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('usage-todo-open'))?.length === 1);
        await page.reload(); await substeps.waitFor();
        assert.equal(await page.locator('[data-tab=todo]').getAttribute('aria-pressed'), 'true');
        assert.equal(await substeps.evaluate((e) => e.open), true);
        await page.evaluate(() => window.__emit('todo', window.__docs.todo));
        assert.equal(await substeps.evaluate((e) => e.open), true);
        await noOverflow();
        assert.equal(await page.locator('#todo img').count(), 0);
        await page.screenshot({ path: `${shotDir}/todo107-${device}-${colorScheme}.png`, fullPage: true });
        await substeps.locator('summary').click();
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('usage-todo-open'))?.length === 0);
        await page.reload(); await substeps.waitFor();
        assert.equal(await substeps.evaluate((e) => e.open), false);
        // TODO Open / Closed: Open is the default, shows not-done items and no folded done list; Closed shows done items only.
        const titles = (n) => page.locator('#todo-sections > .ud-card').nth(n).locator(':scope > ul > li > .ud-todo-head strong').allTextContents();
        const empty = (n) => page.locator('#todo-sections > .ud-card').nth(n).locator(':scope > p').textContent();
        const todoPressed = (id) => page.locator(id).getAttribute('aria-pressed');
        assert.equal(await todoPressed('#todo-open'), 'true');
        assert.equal(await todoPressed('#todo-closed'), 'false');
        assert.equal(await page.locator('#todo-sections > .ud-card > details').count(), 0);
        assert.deepEqual(await titles(0), ['More Modify tools', '<img src=x>']); // Section with both kinds.
        assert.equal(await empty(1), 'No open items.'); // Section with only done items.
        assert.deepEqual(await titles(2), ['Next up']);
        await page.locator('#todo-closed').click();
        assert.equal(await todoPressed('#todo-open'), 'false');
        assert.equal(await todoPressed('#todo-closed'), 'true');
        assert.deepEqual(await titles(0), ['Finished']);
        assert.deepEqual(await titles(1), ['Old win']);
        assert.equal(await empty(2), 'No closed items.');
        const finished = page.locator('#todo-sections > .ud-card').first().locator('.ud-substeps');
        assert.equal(await finished.locator('summary').textContent(), '2 of 2 done');
        await finished.locator('summary').click();
        assert.equal(await finished.locator('li').first().isVisible(), true);
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('usage-todo-open'))?.length === 1);
        await page.locator('#todo-open').click();
        await page.locator('#todo-closed').click();
        assert.equal(await finished.evaluate((e) => e.open), true); // Remembered across redraws.
        await noOverflow();
        await page.screenshot({ path: `${shotDir}/todo-closed-${device}-${colorScheme}.png`, fullPage: true });
        await finished.locator('summary').click();
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('usage-todo-open'))?.length === 0);
        await page.locator('#todo-open').click();
        assert.equal(await page.locator('#todo-sections > .ud-card > ul > li').nth(1).locator('details').count(), 0);
      };
      await checkSubsteps('phone');

      // Ticket Open / Closed buttons + Tag dropdown (AND), All tags restores, tapping a ticket opens its plain-text note.
      await page.locator('[data-tab=tickets]').click();
      const ticketIds = () => page.locator('.ticket').evaluateAll((rows) => rows.map((r) => r.dataset.id));
      const tagSelect = page.getByLabel('Tag', { exact: true });
      const pressed = (name) => page.getByRole('button', { name, exact: true }).getAttribute('aria-pressed');
      assert.equal(await pressed('Open'), 'true');
      assert.equal(await pressed('Closed'), 'false');
      assert.deepEqual(await ticketIds(), ['T14', 'T21']);
      assert.deepEqual(await tagSelect.locator('option').allTextContents(), ['All tags', 'bug', 'feature', 'mod', 'usage-page']);
      await tagSelect.selectOption('bug');
      assert.deepEqual(await ticketIds(), ['T21']);
      await page.getByRole('button', { name: 'Closed', exact: true }).click();
      assert.equal(await pressed('Open'), 'false');
      assert.equal(await pressed('Closed'), 'true');
      assert.deepEqual(await ticketIds(), ['T17']);
      await tagSelect.selectOption('mod');
      assert.deepEqual(await ticketIds(), []);
      assert.equal(await page.locator('#ticket-list').textContent(), 'No tickets');
      await tagSelect.selectOption('');
      assert.deepEqual(await ticketIds(), ['T17', 'T20']);
      assert.equal(await page.locator('.ticket[data-id=T17] .ud-chip').getAttribute('class'), 'ud-chip ok');
      assert.equal(await page.locator('.ticket[data-id=T20] .ud-chip').getAttribute('class'), 'ud-chip ok'); // "Done 2026-11-01" is green too.
      await page.getByRole('button', { name: 'Open', exact: true }).click();
      assert.deepEqual(await ticketIds(), ['T14', 'T21']);
      // A ticket with no tags stays listed under All tags and does not throw when a tag is picked.
      await page.evaluate(() => window.__emit('tickets', { rows: [...window.__docs.tickets.rows, { id: 'T22', status: 'open', size: 'S', type: 'bug', title: 'No tags', todo: '', updated: '2026-11-03', note: '' }] }));
      assert.deepEqual(await ticketIds(), ['T14', 'T21', 'T22']);
      await tagSelect.selectOption('bug');
      assert.deepEqual(await ticketIds(), ['T21']);
      await tagSelect.selectOption('');
      await page.evaluate(() => window.__emit('tickets', window.__docs.tickets));
      assert.deepEqual(await ticketIds(), ['T14', 'T21']);
      await page.locator('.ticket[data-id=T14] summary').click();
      assert.equal(await page.locator('.ticket[data-id=T14] .ticket-note').textContent(), '<script>plain note</script>\nSecond line.');
      assert.equal(await page.locator('#dashboard img, #dashboard script').count(), 0);
      await noOverflow();
      await page.screenshot({ path: `${shotDir}/tickets-filter-phone-${colorScheme}.png`, fullPage: true });
      await page.reload();
      await page.locator('.ticket').first().waitFor();
      assert.equal(await page.locator('[data-tab=tickets]').getAttribute('aria-pressed'), 'true');

      // A failed refresh changes only its short status; old readings and charts remain.
      await page.locator('[data-tab=usage]').click();
      const readings = () => page.locator('#agents [data-field]:not([data-field=resets])').allTextContents(); // not the 5-hour "resets in" text: it ticks with the clock
      const before = await readings();
      await page.locator('#refresh').click();
      await page.waitForFunction(() => !document.getElementById('refresh').disabled && document.getElementById('last-error').textContent === 'Rook usage probe failed, exit 1');
      assert.equal(await page.locator('#message').textContent(), '');
      assert.equal(await page.locator('#last-error').textContent(), 'Rook usage probe failed, exit 1');
      assert.deepEqual(await readings(), before);
      assert.equal(await page.locator('#token-chart .token-bar').count(), 28);
      await page.evaluate(() => window.__emit('status', { ...window.__docs.status, lastError: 'stack trace secret hook_started JSON', lastErrorAt: Date.now() }));
      assert.equal(await page.locator('#last-error').textContent(), 'Usage refresh failed; see the local agent log');
      await page.evaluate(() => window.__emit('status', { ...window.__docs.status, lastError: 'Main account: 100%, limit reached', lastErrorAt: Date.now() }));
      assert.equal(await page.locator('#last-error').textContent(), 'Main account: 100%, limit reached');

      await page.setViewportSize({ width: 1280, height: 900 });
      assert.equal(await page.locator('.page-tabs').evaluate((node) => getComputedStyle(node).position), 'static');
      assert.equal(await page.locator('.ud-main').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length), 2);
      assert.ok((await page.locator('#agents').boundingBox()).x < (await page.locator('#work').boundingBox()).x, 'Desktop: accounts left, work right');
      const brand = await page.locator('#top').boundingBox(), tabs = await page.locator('.page-tabs').boundingBox();
      assert.ok(tabs.x > brand.x + brand.width && Math.abs((tabs.y + tabs.height / 2) - (brand.y + brand.height / 2)) < 2, 'Desktop brand and tabs share a row');
      await readableDates();
      await dayBars();
      await page.screenshot({ path: `${shotDir}/s15-usage-fix-desktop-${colorScheme}.png`, fullPage: true });
      await page.locator('[data-tab=todo]').click();
      await checkSubsteps('desktop');
      for (const tab of ['usage', 'todo', 'tickets']) { await page.locator(`[data-tab=${tab}]`).click(); await noOverflow(); }

      // Denied storage still permits all tabs, and signing out clears private ticket DOM.
      await context.addInitScript(() => { Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new Error('Storage blocked'); }; });
      await page.reload(); await page.locator('#agents h3').last().waitFor();
      assert.equal(await page.locator('[data-tab=usage]').getAttribute('aria-pressed'), 'true');
      await page.locator('[data-tab=todo]').click();
      assert.equal(await substeps.evaluate((e) => e.open), false);
      await substeps.locator('summary').click();
      assert.equal(await substeps.locator('li').first().isVisible(), true);
      await page.locator('[data-tab=tickets]').click();
      await page.locator('#signout').click();
      assert.equal(await page.locator('#dashboard').isVisible(), false);
      assert.equal(await page.locator('.page-tabs').isVisible(), false);
      assert.equal(await page.locator('.ticket').count(), 0);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
});

test('TODO 287a: Latest exe card shows the version, IST date and added list as plain text; no release doc hides it', async (t) => {
  const shotDir = process.env.SHOTS_DIR || 'shots-287a';
  mkdirSync(shotDir, { recursive: true });
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  t.after(() => browser.close());
  // What `gh release view --json tagName,publishedAt,body` gives for a release built by tools/release-notes.mjs.
  const release = { tagName: 'v2026.11.16.2', publishedAt: '2026-11-15T20:00:00Z', body: 'Portable ProjectD.exe (no installer, no admin). Built from abc123.\n\n300 Big drawing opens\n287a <img src=x onerror=alert(1)> is plain text' };
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme });
    try {
      await context.addInitScript(() => { window.__docs = {}; });
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === 'usage.test') {
          const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
          assert.ok(['index.html', 'app.js', 'app.css', 'firebase-config.js', 'token-chart.js', 'usage-window.js'].includes(name));
          return route.fulfill({ body: readFileSync(new URL('../usage-site/public/' + name, import.meta.url)), contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript' });
        }
        const body = url.pathname.endsWith('firebase-app.js') ? 'export const initializeApp = () => ({});'
          : url.pathname.endsWith('firebase-auth.js') ? authModule : url.pathname.endsWith('firebase-firestore.js') ? storeModule : '';
        return route.fulfill({ body, contentType: body ? 'text/javascript' : 'text/css' });
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('http://usage.test/');
      await page.locator('#dashboard').waitFor();
      assert.equal(await page.locator('#release').isVisible(), false); // No uploaded release doc yet.
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((r) => window.__emit('release', r), release);
        assert.equal(await page.locator('#release').isVisible(), true);
        assert.equal(await page.locator('#release h2').textContent(), 'Latest exe');
        assert.equal(await page.locator('#release-card h3').textContent(), 'v2026.11.16.2');
        assert.match(await page.locator('#release-card .ud-muted').textContent(), /^Mon,? 16 Nov,? 01:30 IST$/); // 20:00 UTC is 01:30 IST the next day
        assert.deepEqual(await page.locator('#release-card li').allTextContents(), ['300 Big drawing opens', '287a <img src=x onerror=alert(1)> is plain text']);
        assert.equal(await page.locator('#release img').count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: `${shotDir}/release-${width}-${colorScheme}.png`, fullPage: true });
        await page.evaluate(() => window.__emit('release', { tagName: 'v0.1.360', publishedAt: '2026-11-15T10:00:00Z', body: 'Portable ProjectD.exe (no installer, no admin). Built from def456.' }));
        assert.equal(await page.locator('#release-card li').count(), 0);
        assert.equal(await page.locator('#release-card p').last().textContent(), 'No TODO items listed.');
        await page.evaluate(() => window.__emit('release', {}));
        assert.equal(await page.locator('#release').isVisible(), false);
      }
      await page.evaluate((r) => window.__emit('release', r), release);
      await page.locator('#signout').click();
      await page.locator('#release').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('#release-card').textContent(), '');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test('TODO 353a: status strip, account cards, Now / Next / Done today', async (t) => {
  const shotDir = process.env.SHOTS_DIR || mkdtempSync(join(tmpdir(), 'shots-353a-'));
  mkdirSync(shotDir, { recursive: true });
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  t.after(() => browser.close());
  const ended = (id) => ({ kind: 'build', id: 'king/' + id, out: 'b-' + id + '.jsonl', state: 'ended', ended: '@now', extra: '' }); // '@now' becomes the page's current time
  // Rows in file order (newest last): seven done today, then a Bishop job and a King build running.
  const queue = { updated: '2026-11-05T18:45:00.000Z', next: ['354', '<img src=x onerror=alert(1)>'], rows: [
    ...['101', '102', '103', '104', '105', '106', '107'].map(ended),
    { kind: 'job', id: 'debt47 (bishop, claude-sonnet-5-5)', out: 'debt47.jsonl', state: 'running', extra: '' },
    { kind: 'build', id: 'king/280', out: 'b-280.jsonl', state: 'running', extra: '' },
  ] };
  const todo = { sections: [{ title: 'Whole TODO', items: [
    { num: 280, title: 'U1d: simpler Queue tab', done: false },
    { num: 354, title: 'Usage page build', done: false },
  ] }] };
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme });
    try {
      await context.addInitScript(({ queue, todo }) => {
        const now = Date.now(), H = 3600e3, iso = (ms) => new Date(now + ms).toISOString();
        for (const r of queue.rows) if (r.ended === '@now') r.ended = iso(0);
        // Every week is half gone (84 of 168 h), every 5-hour window 2 h in.
        const row = (agent, window, used_pct, extra = {}) => ({ agent, window, role: 'Builder', model: 'Fixture', used_pct: String(used_pct), cap_pct: '',
          starts: iso(window === 'week' ? -84 * H : -2 * H), resets: iso(window === 'week' ? 84 * H : 3 * H), as_of: iso(0), ...extra });
        window.__docs = {
          limits: { rows: [
            row('Rook', '5h', 85, { resets: iso(108 * 60e3) }), row('Rook', 'week', 94),
            row('Bishop', '5h', 30), row('Bishop', 'week', 48, { cap_pct: '50' }),
            row('King', '5h', 90, { resets: '' }), row('King', 'week', 96),
            row('Rowan', '5h', 10), row('Rowan', 'week', 10),
          ] },
          tokens: { rows: Array.from({ length: 48 }, (_, i) => ({ t: now - (48 - i) * H, Rook: 1000, Bishop: 500, King: 200, Knight: 0 })) },
          queue, todo,
          status: { lastUpdate: now - 60_000, lastError: '', lastErrorAt: 0 },
        };
      }, { queue, todo });
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === 'usage.test') {
          const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
          assert.ok(['index.html', 'app.js', 'app.css', 'firebase-config.js', 'token-chart.js', 'usage-window.js'].includes(name));
          return route.fulfill({ body: readFileSync(new URL('../usage-site/public/' + name, import.meta.url)), contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript' });
        }
        const body = url.pathname.endsWith('firebase-app.js') ? 'export const initializeApp = () => ({});'
          : url.pathname.endsWith('firebase-auth.js') ? authModule : url.pathname.endsWith('firebase-firestore.js') ? storeModule : '';
        return route.fulfill({ body, contentType: body ? 'text/javascript' : 'text/css' });
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('http://usage.test/');
      await page.locator('#agents h3').last().waitFor();
      const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      // Status strip: who builds what (running rows, newest first), then alerts from the usage % alone: week >= 95, 5h >= 85.
      assert.deepEqual(await page.locator('#strip > span').allTextContents(), ['King building 280', 'Bishop job debt47']);
      assert.deepEqual(await page.locator('#strip .ud-chip').evaluateAll((chips) => chips.map((c) => c.className + ':' + c.textContent)),
        ['ud-chip warn:Rook 5h 85%', 'ud-chip bad:King week 96%', 'ud-chip warn:King 5h 90%', 'ud-chip warn:Bishop cap 50%']); // Rook week 94 is below its limit; Bishop has today's cap
      // Top row: "Usage" at 24 px and the yellow Refresh button on one row; the rest of the header is one small muted line.
      const top = await page.locator('#top').boundingBox(), refresh = await page.locator('#refresh').boundingBox();
      assert.ok(Math.abs((top.y + top.height / 2) - (refresh.y + refresh.height / 2)) < 2 && refresh.x > top.x + top.width, 'Usage and Refresh share a row');
      assert.equal(await page.locator('#top').evaluate((node) => getComputedStyle(node).fontSize), '24px');
      assert.equal(await page.locator('#refresh').textContent(), 'Refresh');
      assert.equal((await page.locator('.ud-sub').boundingBox()).height < 40, true, 'Sign out, last update and status fit one or two small lines');
      assert.equal(await page.locator('#asof').count(), 0, 'no intro paragraph');
      // Account cards: Rook, Bishop, King, the empty Queen slot; Knight is retired and has no card.
      assert.deepEqual(await page.locator('#agents h3').allTextContents(), ['Rook', 'Bishop', 'King']);
      assert.equal(await page.locator('#agents .ud-empty').textContent(), 'Queenempty slot, no account yet');
      assert.equal(await page.locator('#agents .ud-empty').evaluate((node) => getComputedStyle(node).borderStyle), 'dashed');
      assert.deepEqual(await page.locator('#agents .ud-ring').allTextContents(), ['85%', '30%', '90%']);
      assert.ok(await page.locator('#agents .ud-ring > span').first().evaluate((node) => { const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect().height < 24; }), 'Ring number and % share one line');
      const foot = page.locator('#agents .ud-card').nth(1).locator('.ud-mrow.ud-muted'); // card footer: two columns, the cap left and the forecast right
      assert.deepEqual(await foot.locator('> span').allTextContents(), ['red tick = today’s cap 50%', '~96% at reset']);
      assert.ok((await foot.locator('> span').nth(1).boundingBox()).x > (await foot.locator('> span').nth(0).boundingBox()).x + 100);
      assert.deepEqual(await page.locator('#agents .ud-card').nth(2).locator('.ud-mrow.ud-muted > span').allTextContents(), ['no cap today', 'hits 100% before reset']);
      assert.equal(await page.locator('#agents .ud-card').nth(2).locator('[data-field=hit_at]').getAttribute('class'), 'ud-hit');
      assert.deepEqual(await page.locator('#agents .ud-fill').evaluateAll((all) => all.map((n) => n.style.background)).then((c) => c.map((x) => x.includes('critical'))), [false, false, false], 'a week bar at 96% keeps its account colour');
      assert.match(await page.locator('#agents .ud-card').nth(0).locator('[data-field=resets]').first().textContent(), /^5 h: resets in 1 h 4[78] m \(\d\d:\d\d\)$/);
      assert.equal(await page.locator('#agents .ud-card').nth(2).locator('[data-field=resets]').first().textContent(), '5 h: window not started');
      assert.deepEqual(await page.locator('#agents .ud-card .ud-agent .ud-chip').evaluateAll((chips) => chips.map((c) => c.className + ':' + c.textContent)),
        ['ud-chip ok:no cap today', 'ud-chip warn:cap 50%', 'ud-chip ok:no cap today']);
      assert.equal(await page.locator('#agents .ud-tick.cap').count(), 1); // Bishop only
      assert.deepEqual(await page.locator('#agents .ud-ghost').evaluateAll((g) => g.map((n) => n.style.left + '/' + n.style.width)), ['94%/6%', '48%/48%', '96%/4%']); // forecast to the reset
      // Now / Next / Done today in ONE Work card on the Usage page: account chip, bold item, TODO title; last 5 done and an "N earlier today" fold.
      assert.equal(await page.locator('#work').evaluate((node) => node.classList.contains('ud-card') && !node.querySelector('.ud-card')), true, 'one card, no card per part');
      assert.deepEqual(await page.locator('#work-list h2').allTextContents(), ['Now', 'Next', 'Done today · 7 jobs']);
      const rows = () => page.locator('#work-list .job').evaluateAll((all) => all.map((row) => [row.children[0].textContent, row.querySelector('strong').textContent, row.querySelector('strong + span')?.textContent.trim() ?? ''].join('|')));
      assert.deepEqual((await rows()).slice(0, 5), ['King|building 280|simpler Queue tab', 'Bishop|job debt47|', 'next|354|Usage page build', 'next|<img src=x onerror=alert(1)>|', 'King|built 107|']);
      assert.equal((await rows()).length, 11, '2 now + 2 next + 7 done (2 folded)');
      assert.equal(await page.locator('#work-list .job:visible').count(), 9, '2 now + 2 next + 5 done');
      assert.equal(await page.locator('#work img').count(), 0);
      const fold = page.locator('#work-list details.ud-fold');
      assert.equal(await fold.locator('summary').textContent(), '2 earlier today');
      assert.equal(await fold.evaluate((node) => node.open), false);
      await fold.locator('summary').click();
      assert.equal(await page.locator('#work-list .job:visible').count(), 11);
      assert.equal(await page.locator('#queue-list button').textContent(), 'Show 2 more', 'the Queue tab keeps its own fold');
      await page.evaluate(() => window.__emit('todo', window.__docs.todo)); // a redraw keeps the fold open
      assert.equal(await fold.evaluate((node) => node.open), true);
      await fold.locator('summary').click();
      assert.equal(await page.locator('#work-list .job:visible').count(), 9);
      // Token chart as the mock: 4 gridlines with round labels, day names under the bars, one caption line below.
      assert.equal(await page.locator('#tokens h2').textContent(), 'Tokens per day');
      assert.equal(await page.locator('#token-chart line').count(), 4);
      assert.match((await page.locator('#token-chart text[text-anchor=end]').allTextContents()).join(' '), /^0 \d+(\.\d)?[KM]? \d+(\.\d)?[KM]? \d+(\.\d)?[KM]?$/);
      const dayNames = await page.locator('#token-chart text[text-anchor=middle]').allTextContents();
      assert.equal(new Set(dayNames).size, 7, 'seven different day names');
      for (const name of dayNames) assert.match(name, /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
      // Accounts first, one column on a phone; nothing wider than the screen.
      assert.equal(await page.locator('.ud-main').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length), 1);
      assert.ok((await page.locator('#strip').boundingBox()).y < (await page.locator('#agents').boundingBox()).y);
      assert.ok((await page.locator('#agents').boundingBox()).y < (await page.locator('#work').boundingBox()).y);
      await noOverflow();
      await page.screenshot({ path: `${shotDir}/usage-390-${colorScheme}.png`, fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      assert.equal(await page.locator('.ud-main').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length), 2);
      assert.ok((await page.locator('#agents').boundingBox()).x < (await page.locator('#work').boundingBox()).x);
      await noOverflow();
      await page.screenshot({ path: `${shotDir}/usage-1280-${colorScheme}.png`, fullPage: true });
      await page.setViewportSize({ width: 1024, height: 800 });
      await noOverflow();
      // Knight's bar and legend return with its tokens (no card: Knight is retired); today's totals go in the caption; an empty queue says why nothing is planned.
      await page.evaluate(() => window.__emit('tokens', { rows: [{ t: Date.now(), Rook: 5.1e6, Bishop: 2.9e6, King: 0, Knight: 5 }] }));
      await page.locator('#token-legend span').nth(3).waitFor();
      assert.deepEqual(await page.locator('#agents h3').allTextContents(), ['Rook', 'Bishop', 'King']);
      assert.equal(await page.locator('#token-note').textContent(), 'Input + output + cache creation; cache reads excluded. Today so far: Rook 5.1M, Bishop 2.9M, Knight 5.');
      assert.equal(await page.locator('#token-chart text[text-anchor=end]').last().textContent(), '6M'); // 5.1M -> axis 0, 2M, 4M, 6M
      await page.evaluate(() => window.__emit('queue', { rows: [] }));
      await page.locator('#work-list p', { hasText: 'Done today: nothing yet' }).waitFor();
      assert.deepEqual(await page.locator('#work-list p').allTextContents(), ['Now: nothing running', 'Next: nothing planned (no next: line in the queue)', 'Done today: nothing yet']);
      assert.deepEqual(await page.locator('#strip > span').allTextContents(), ['Nothing running']);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test('TODO 353b2: break, CI and for-him chips; Done today by end time', async (t) => {
  const shotDir = process.env.SHOTS_DIR || mkdtempSync(join(tmpdir(), 'shots-353b2-'));
  mkdirSync(shotDir, { recursive: true });
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  t.after(() => browser.close());
  const now = Date.now(), H = 3600e3, iso = (ms) => new Date(ms).toISOString();
  const build = (id, state, ended) => ({ kind: 'build', id: 'king/' + id, out: 'b-' + id + '.jsonl', state, ...(ended ? { ended: iso(ended) } : {}), extra: '' });
  // File order, newest last: six done today, one ended yesterday, one done with no end time, one running.
  const queue = { updated: iso(now), rows: [
    ...['101', '102', '103', '104', '105', '106'].map((id) => build(id, 'ended', now)), build('190', 'ended', now - 36 * H), build('191', 'ended'), build('280', 'running'),
  ] };
  const breaks = { rows: [
    { account: 'Bishop', from: iso(now - 10 * 60e3), to: iso(now + 30 * 60e3) },
    { account: '<img src=x onerror=alert(1)>', from: iso(now - 60e3), to: iso(now + 90 * 60e3) },
    { account: 'King', from: iso(now + 60 * 60e3), to: iso(now + 120 * 60e3) }, // upcoming: no chip
    { account: 'Rook', from: iso(now - 3 * H), to: iso(now - 60e3) }, // over: no chip
  ] };
  const docs = { breaks, forhim: { open: 3, ids: [15, 19, 28] }, ci: { status: 'completed', conclusion: 'failure', sha: '1a2b3c4d5e6f', url: 'https://example.test/run', updated: iso(now) } };
  const chips = (page) => page.locator('#strip .ud-chip').evaluateAll((all) => all.map((c) => c.className + ':' + c.textContent));
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme });
    try {
      await context.addInitScript(({ queue, docs, now }) => {
        const iso = (ms) => new Date(ms).toISOString();
        const row = (agent, window, used_pct) => ({ agent, window, role: 'Builder', model: 'Fixture', used_pct: String(used_pct), cap_pct: '',
          starts: iso(now - (window === 'week' ? 84 : 2) * 3600e3), resets: iso(now + (window === 'week' ? 84 : 3) * 3600e3), as_of: iso(now) });
        window.__docs = { limits: { rows: ['Rook', 'Bishop', 'King'].flatMap((a) => [row(a, '5h', 10), row(a, 'week', 10)]) }, queue, ...docs, status: { lastUpdate: now - 60_000, lastError: '', lastErrorAt: 0 } };
      }, { queue, docs, now });
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === 'usage.test') {
          const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
          assert.ok(['index.html', 'app.js', 'app.css', 'firebase-config.js', 'token-chart.js', 'usage-window.js'].includes(name));
          return route.fulfill({ body: readFileSync(new URL('../usage-site/public/' + name, import.meta.url)), contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript' });
        }
        const body = url.pathname.endsWith('firebase-app.js') ? 'export const initializeApp = () => ({});'
          : url.pathname.endsWith('firebase-auth.js') ? authModule : url.pathname.endsWith('firebase-firestore.js') ? storeModule : '';
        return route.fulfill({ body, contentType: body ? 'text/javascript' : 'text/css' });
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('http://usage.test/');
      await page.locator('#agents h3').last().waitFor();
      const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      // Strip: a plain muted "X on break" line per active break (not the upcoming or the over one), then the chips: purple "3 for him", red CI. The card shows the break's end in IST.
      assert.deepEqual(await page.locator('#strip > .ud-muted').allTextContents(), ['Bishop on break', '<img src=x onerror=alert(1)> on break']);
      assert.deepEqual(await chips(page), ['ud-chip info:3 for him', 'ud-chip bad:CI red 1a2b3c4']);
      assert.equal(await page.locator('#strip img').count(), 0);
      const till = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(now + 30 * 60e3)).replace(/,/g, '');
      assert.equal(await page.locator('#agents .ud-card').nth(1).locator('.ud-agent .ud-chip').evaluate((c) => c.className + ':' + c.textContent), 'ud-chip bad:break till ' + till);
      assert.equal(await page.locator('#agents .ud-card').nth(0).locator('.ud-agent .ud-chip').textContent(), 'no cap today');
      // Done today: rows ended today only (6 of the 8 not running); no end time or yesterday is left out here, and stays on the Queue tab.
      assert.deepEqual(await page.locator('#work-list h2').allTextContents(), ['Now', 'Done today · 6 jobs']);
      assert.equal(await page.locator('#work-list .job:visible').count(), 6, '1 now + 5 done');
      assert.doesNotMatch(await page.locator('#work-list').textContent(), /190|191/);
      assert.equal(await page.locator('#work-list details.ud-fold summary').textContent(), '1 earlier today');
      assert.deepEqual(await page.locator('#queue-list h3').allTextContents(), ['Now', 'Done']);
      assert.match(await page.locator('#queue-list').textContent(), /190[\s\S]*Show 3 more/);
      await noOverflow();
      await page.screenshot({ path: `${shotDir}/usage-353b2-390-${colorScheme}.png`, fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await noOverflow();
      await page.screenshot({ path: `${shotDir}/usage-353b2-1280-${colorScheme}.png`, fullPage: true });
      await page.setViewportSize({ width: 1024, height: 800 });
      await noOverflow();
      // CI running shows its age; success, no runs and a closed for-him list show nothing; a missing doc shows no chip.
      await page.evaluate((updated) => window.__emit('ci', { status: 'in_progress', conclusion: '', sha: '1a2b3c4d5e6f', updated }), iso(now - 40 * 60e3));
      await page.locator('#strip .ud-chip.warn').waitFor();
      assert.equal(await page.locator('#strip .ud-chip.warn').textContent(), 'CI running · 40 min ago');
      await page.evaluate(() => window.__emit('ci', { status: 'completed', conclusion: 'cancelled', sha: '9f8e7d6c5b4a' }));
      await page.locator('#strip .ud-chip', { hasText: 'CI cancelled 9f8e7d6' }).waitFor();
      await page.evaluate(() => window.__emit('ci', { status: 'completed', conclusion: 'success', sha: '1a2b3c4d5e6f' }));
      await page.evaluate(() => window.__emit('forhim', { open: 0, ids: [] }));
      await page.locator('#strip .ud-chip.info').waitFor({ state: 'detached' });
      assert.deepEqual(await chips(page), ['ud-chip ok:CI green']); // success is a green chip; no runs and a closed for-him list show nothing
      await page.evaluate(() => { for (const name of ['breaks', 'ci', 'forhim']) window.__emit(name, {}); });
      await page.locator('#strip > .ud-muted', { hasText: 'on break' }).first().waitFor({ state: 'detached' });
      assert.deepEqual(await chips(page), []);
      assert.equal(await page.locator('#agents .ud-card').nth(1).locator('.ud-agent .ud-chip').textContent(), 'no cap today', 'the break chip goes with the break');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});
