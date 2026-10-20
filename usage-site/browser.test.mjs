// Offline Firebase fixture; run with node usage-site/browser.test.mjs.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { parseTodo } from '../tools/usage-agent.mjs';

const todo = parseTodo(readFileSync(new URL('../TODO.md', import.meta.url), 'utf8'));
const payload = '<img src=x onerror="window.injected=true">';
todo.sections.push({ title: payload, items: [{ num: 1, title: payload, size: 'S', done: false, text: payload + 'x'.repeat(200) }] });
const firebase = `
export const initializeApp = () => ({}), getAuth = () => ({}), getFirestore = () => ({});
export class GoogleAuthProvider {}
export const signInWithPopup = async () => {}, signInWithRedirect = async () => {}, getRedirectResult = async () => {}, signOut = async () => {};
export const onAuthStateChanged = (auth, callback) => queueMicrotask(() => callback({ uid: 'fixture' }));
export const doc = (db, collection, name) => name;
export const setDoc = async () => {}, serverTimestamp = () => {}, getDocFromServer = async () => ({});
window.snapshots = {};
export const onSnapshot = (name, options, callback) => {
  window.snapshots[name] = () => callback({ metadata: { fromCache: false }, data: () => name === 'todo' ? ${JSON.stringify(todo)} : {} });
  queueMicrotask(window.snapshots[name]);
  return () => {};
};`;

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://www.gstatic.com/firebasejs/**', (route) => route.fulfill({ contentType: 'text/javascript', body: firebase }));
  await page.route('http://usage.test/**', (route) => {
    const name = new URL(route.request().url()).pathname.slice(1) || 'index.html';
    if (name === 'firebase-config.js') return route.fulfill({ contentType: 'text/javascript', body: 'export const firebaseConfig = {projectId: "fixture"};' });
    if (!['index.html', 'app.js'].includes(name)) return route.fulfill({ status: 404 });
    return route.fulfill({ contentType: name.endsWith('.js') ? 'text/javascript' : 'text/html', body: readFileSync(new URL('./public/' + name, import.meta.url), 'utf8') });
  });
  await page.goto('http://usage.test/');
  const cards = page.locator('#todo-sections > .ud-card');
  await cards.last().waitFor();
  assert.equal(await cards.count(), todo.sections.length);
  assert.deepEqual(await cards.locator('h3').allTextContents(), todo.sections.map((s) => s.title));
  for (let i = 0; i < todo.sections.length; i++) {
    const section = todo.sections[i], card = cards.nth(i);
    assert.equal(await card.locator(':scope > ul > li').count(), section.items.filter((item) => !item.done).length);
    const done = section.items.filter((item) => item.done).length;
    if (done) {
      assert.equal(await card.locator('summary').textContent(), done + ' done');
      assert.equal(await card.locator('details').evaluate((e) => e.open), false);
      assert.equal(await card.locator('details li').count(), done);
    }
  }
  assert.equal(await page.locator('#todo img').count(), 0);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  await cards.first().locator('summary').click();
  await page.evaluate(() => window.snapshots.status());
  assert.equal(await cards.first().locator('details').evaluate((e) => e.open), true);
  await cards.first().locator('summary').click();
  await cards.last().evaluate((e) => e.remove());
  mkdirSync(new URL('../shots/', import.meta.url), { recursive: true });
  for (const width of [320, 1440]) for (const colorScheme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width} ${colorScheme} overflow`);
    await page.screenshot({ path: fileURLToPath(new URL(`../shots/usage-todo-${width}-${colorScheme}.png`, import.meta.url)), fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log('Usage TODO: sections, folds, safe text, phone/desktop and light/dark passed.');
} finally { await browser.close(); }
