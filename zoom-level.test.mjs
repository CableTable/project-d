import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoomScale, zoomLabel } from './web/zoom-level.js';

test('typed zoom levels accept trimmed percentages and decimals at 96 dpi', () => {
  for (const [text, pct] of [['150', 150], [' 150% ', 150], ['37.5', 37.5], ['.5%', .5], ['+100', 100]]) {
    assert.equal(zoomScale(text), Math.min(1000, Math.max(.05, pct / 100 * (96 / 25.4))));
  }
});

test('typed zoom levels clamp both limits, including numbers beyond finite range', () => {
  assert.equal(zoomScale('0.00001'), .05);
  for (const text of ['99999999', '9'.repeat(400)]) assert.equal(zoomScale(text), 1000);
});

test('typed zoom levels clamp to the floor given (TODO 357), the default stays 0.05', () => {
  assert.equal(zoomScale('0.00001', 1e-5), 1e-5);
  assert.equal(zoomScale('0.001%', 1e-6), 0.001 / 100 * (96 / 25.4));
  assert.equal(zoomScale('0.001%'), .05);
});

test('zoom label: whole % from 1%, 2 significant digits below, never 0% (TODO 357)', () => {
  const at = (pct) => zoomLabel(pct / 100 * (96 / 25.4));
  assert.equal(at(100), '100%'); assert.equal(at(1), '1%'); assert.equal(at(1.4), '1%');
  assert.equal(at(0.012), '0.012%'); assert.equal(at(0.5), '0.5%'); assert.equal(at(0.0000123), '0.000012%');
  assert.equal(at(0.9999), '1%'); assert.equal(at(1e-9), '0.000000001%');
  for (const pct of [0.99, 0.05, 0.001, 1e-7]) assert.notEqual(at(pct), '0%');
});

test('typed zoom levels reject empty, partial and non-decimal entries', () => {
  for (const text of ['', ' ', '%', 'abc', 'Fit', '150%%', '1 50', '150 %', '2x', '1e2', '0xff', 'NaN', 'Infinity', '.', '--2', '37,5']) {
    assert.equal(zoomScale(text), null, text);
  }
});
