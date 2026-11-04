import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoomScale } from './web/zoom-level.js';

test('typed zoom levels accept trimmed percentages and decimals at 96 dpi', () => {
  for (const [text, pct] of [['150', 150], [' 150% ', 150], ['37.5', 37.5], ['.5%', .5], ['+100', 100]]) {
    assert.equal(zoomScale(text), Math.min(1000, Math.max(.05, pct / 100 * (96 / 25.4))));
  }
});

test('typed zoom levels clamp both limits, including numbers beyond finite range', () => {
  for (const text of ['0', '-150%', '0.00001']) assert.equal(zoomScale(text), .05);
  for (const text of ['99999999', '9'.repeat(400)]) assert.equal(zoomScale(text), 1000);
});

test('typed zoom levels reject empty, partial and non-decimal entries', () => {
  for (const text of ['', ' ', '%', 'abc', 'Fit', '150%%', '1 50', '150 %', '2x', '1e2', '0xff', 'NaN', 'Infinity', '.', '--2', '37,5']) {
    assert.equal(zoomScale(text), null, text);
  }
});
