import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { shape, operandsOf } from './web/shaping.js';
import { zoomScale } from './web/zoom-level.js';
import { paneRows } from './tools/pd-runs/hooks/runs.mjs';
import { extendEntity } from './web/extend.js';
import { trimRegion, pathOf } from './web/modify.js';
import { shapeOf, get } from './web/grips.js';
import { ellipse, line } from './web/dxf-write.js';

test('TODO 253e fr 325: a hole inside overlapping holders attaches to an outer operand', () => {
  const box = (x, y, w, h = w) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const loops = [box(0, 0, 20), box(2, 2, 12), box(8, 0, 20, 16), box(9, 3, 2)];
  for (const input of [loops, loops.slice().reverse()]) {
    const operands = operandsOf(input);
    assert.equal(operands.length, 2);
    assert.equal(operands.reduce((n, o) => n + o.loops.length, 0), 4);
    const result = shape('weld', input);
    assert.equal(result.error, undefined);
    assert.equal(result.area, 452);
    assert.ok(result.rings.length > 0);
  }
});

test('TODO 253e fr 329: nonpositive typed zoom is invalid; positive zoom still clamps', () => {
  for (const text of ['0', '0%', '-0', '-50%', ' -0.01% ']) assert.equal(zoomScale(text), null, text);
  assert.equal(zoomScale('0.00001'), .05);
  assert.equal(zoomScale('99999999'), 1000);
});

test('TODO 253e fr 351: malformed URL returns 400 and the next request succeeds', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { serve } from './serve.mjs';
    const server = await serve(0), base = 'http://127.0.0.1:' + server.address().port;
    try {
      for (const path of ['/%', '/%E0%A4%A']) {
        const response = await fetch(base + path);
        assert.equal(response.status, 400);
        await response.text();
      }
      const response = await fetch(base + '/');
      assert.equal(response.status, 200);
      assert.match(await response.text(), /<html/);
      console.log('400 malformed URLs; 200 next request');
    } finally { await new Promise((resolve) => server.close(resolve)); }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /400 malformed URLs; 200 next request/);
});

test('TODO 253e fr 354: shared run files hide only running Rook wrappers', () => {
  const now = 100000;
  for (const who of ['Bishop', 'Knight']) for (const state of ['running', 'testing']) {
    const rows = [{ who, name: 'worker', state, files: ['bx.jsonl'], age: 100 }];
    const jobs = ['failed', 'completed', 'killed', 'queued', 'running'].map((kind) => ({
      desc: kind, state: kind === 'queued' ? 'running' : kind,
      command: kind === 'queued' ? 'waiting for 04:17; bash go-wrapper.sh' : 'bash go-wrapper.sh',
      files: ['bx.jsonl'], startedMs: now - 1000, endedMs: now - 100,
    }));
    const result = paneRows(jobs, rows, now);
    assert.deepEqual(result.running.filter((r) => r.who === 'Rook').map((r) => r.name), ['queued']);
    assert.deepEqual(result.recent.map((r) => r.name), ['failed', 'completed', 'killed']);
    assert.ok(result.running.some((r) => r.who === who));
  }
});

test('TODO 253e rv2-250: elliptical extension handles 300000 hits in one chord', () => {
  const arc = ellipse(0, 0, 10, 0, .5, 0, Math.PI), edge = line(-20, -.01, 20, -.01);
  const expected = extendEntity(arc, [edge], [-10, 0]);
  const result = extendEntity(arc, Array(300000).fill(edge), [-10, 0]);
  assert.ok(result.ent, result.error);
  assert.deepEqual(result, expected);
  assert.ok(Math.abs(get(result.ent.r, 42) - (Math.PI + Math.asin(.002))) < 1e-7);
});

test('TODO 253e rv2-250: trim preview keeps 300000 cut pieces without argument overflow', () => {
  const count = 300000, target = line(0, 0, 2, count), cutter = line(1, -1, 1, count + 1);
  // Supply the existing path seam to isolate preview accumulation from DXF parsing.
  const P = pathOf({ t: 'poly', pts: Array.from({ length: count + 1 }, (_, i) => [i % 2 ? 2 : 0, i]), closed: false });
  const result = trimRegion([target], [cutter], () => true, Infinity, (sh) => sh.a[0] === 0 ? P : pathOf(sh));
  assert.deepEqual(result.changed, [{ i: 0, ents: [] }]);
  assert.equal(result.preview.length, count + 1);
  assert.deepEqual(shapeOf(result.preview[0], 1).pts.map((p) => p.slice(0, 2)), [[0, 0], [1, .5]]);
  assert.deepEqual(shapeOf(result.preview.at(-1), 1).pts.map((p) => p.slice(0, 2)), [[1, count - .5], [0, count]]);
});
