import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localStore } from './web/idbstore.js';
import { fileKey, settings } from './web/guides.js';

test('per-file guides: path wins, browser names work, records are isolated and cleaned on read', () => {
  const data = new Map(), store = localStore('pd-guides:', {
    getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value),
  });
  const a = fileKey('E:\\parts\\Plate.dxf', 'ignored'), b = fileKey('E:/other/Plate.dxf');
  assert.equal(a, fileKey('e:/PARTS/plate.dxf'));
  assert.notEqual(a, b);
  assert.equal(fileKey(null, 'Plate.dxf'), 'plate.dxf');
  assert.equal(fileKey(null), '', 'untitled drawings have no persistent key');
  const original = { guides: [{ axis: 'x', mm: 12.5 }], guidesShow: false, guidesLock: true };
  store.put(a, original);
  original.guides[0].mm = 99;
  assert.deepEqual(settings(store.get(a)), { guides: [{ axis: 'x', mm: 12.5 }], guidesShow: false, guidesLock: true });
  assert.deepEqual(settings(store.get(b)), settings(null));
  store.put(b, { guides: [null, { axis: 'z', mm: 1 }, { axis: 'y', mm: '2.5' }], guidesLock: 'false' });
  assert.deepEqual(settings(store.get(b)), { guides: [{ axis: 'y', mm: 2.5 }], guidesShow: true, guidesLock: false });
  store.put(a, settings(null));
  assert.deepEqual(settings(store.get(a)).guides, [], 'cleared guides stay cleared');
  assert.equal(settings(store.get(b)).guides.length, 1, 'another file is untouched');
});

test('local storage errors reach the caller that falls back to session guides', () => {
  const store = localStore('pd-guides:', { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('full'); } });
  assert.throws(() => store.get('a'), /blocked/);
  assert.throws(() => store.put('a', {}), /full/);
});
