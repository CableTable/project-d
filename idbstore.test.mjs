// idbstore.js — a write is done when its transaction commits.   node idbstore.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** A stand-in for indexedDB: one store, a transaction that completes or (disk full) aborts after the request has succeeded. */
function fakeIndexedDB(failCommit) {
  const rows = new Map();
  const db = { transaction: () => {
    const t = { oncomplete: null, onabort: null, onerror: null, error: null };
    t.objectStore = () => {
      const req = (f) => { const r = {}; queueMicrotask(() => { r.result = f(); r.onsuccess && r.onsuccess(); }); return r; };
      return {
        put: (rec) => { const r = req(() => { if (!failCommit) rows.set(rec.id, rec); }); queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => {
          if (failCommit) { t.error = new Error('disk full'); t.onabort && t.onabort(); } else t.oncomplete && t.oncomplete(); }))); return r; },
        getAll: () => req(() => [...rows.values()]),
      };
    };
    return t;
  } };
  return { open: () => { const r = {}; queueMicrotask(() => { r.result = db; r.onsuccess && r.onsuccess(); }); return r; } };
}

test('a write that the disk refuses at commit rejects (the request alone succeeding is not "saved")', async () => {
  const { idbStore } = await import('./web/idbstore.js');
  globalThis.indexedDB = fakeIndexedDB(true);
  await assert.rejects(idbStore('d', 's', 'the test store').put({ id: 'a' }), /disk full/);
  globalThis.indexedDB = fakeIndexedDB(false);
  const ok = idbStore('d', 's', 'the test store');
  await ok.put({ id: 'a' });
  assert.deepEqual(await ok.all(), [{ id: 'a' }]);
});
