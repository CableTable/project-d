import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rememberPdfSettings } from './web/export.js';

test('TODO 217: PDF settings persist separately for drawing/layout and Part; unavailable or corrupt storage is harmless', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map();
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value),
    } });
    const drawing = { marginPreset: 'custom', margins: { top: 7, right: 5, bottom: 5, left: 5 } };
    const part = { marginPreset: 'standard', margins: { top: 8, right: 8, bottom: 8, left: 8 } };
    assert.deepEqual(rememberPdfSettings(false), {});
    rememberPdfSettings(false, drawing); rememberPdfSettings(true, part);
    assert.deepEqual(rememberPdfSettings(false), drawing);
    assert.deepEqual(rememberPdfSettings(true), part);
    for (const value of ['broken', 'null', '[]', '42']) {
      data.set('pd-pdf-drawing', value);
      assert.deepEqual(rememberPdfSettings(false), {});
    }
    for (const blocked of ['getItem', 'setItem']) {
      localStorage[blocked] = () => { throw new Error('Storage blocked'); };
      assert.deepEqual(rememberPdfSettings(false, drawing), {});
    }
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('Storage unavailable'); } });
    assert.deepEqual(rememberPdfSettings(false), {});
    assert.deepEqual(rememberPdfSettings(false, drawing), {});
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});
