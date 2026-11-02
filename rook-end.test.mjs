import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finish, reviewChain, setRunLine } from './tools/rook-end.mjs';

test('TODO 167d: reviewChain chains a clean build with a new commit; not an error exit, not a tip equal to the base (short or full sha)', () => {
  const full = 'abc1234' + 'f'.repeat(33);
  assert.deepEqual(reviewChain({ base: 'abc1234', tip: 'def5678' + '0'.repeat(33), code: 0 }), { chain: true });
  assert.match(reviewChain({ base: 'abc1234', tip: full, code: 0 }).why, /no commit/);
  assert.match(reviewChain({ base: full, tip: full, code: 0 }).why, /no commit/);
  assert.match(reviewChain({ base: 'ABC1234', tip: full, code: 0 }).why, /no commit/);
  assert.match(reviewChain({ base: 'abc1234', tip: 'def5678', code: 1 }).why, /error \(exit 1\)/);
  assert.match(reviewChain({ base: 'abc1234', tip: 'def5678', code: NaN }).why, /error/); // killed: no exit code
  assert.match(reviewChain({ base: 'abc1234', tip: '', code: 0 }).why, /no tip/);
});

test('TODO 167d: setRunLine replaces the line of the same out file, appends a new one, and leaves lines 1-2 alone', () => {
  const t = 'status\r\nitems since start\r\nbuild br -> o.jsonl: running\r\n';
  assert.equal(setRunLine(t, 'build br -> o.jsonl: ended', 'o.jsonl'), 'status\r\nitems since start\r\nbuild br -> o.jsonl: ended\r\n');
  assert.equal(setRunLine(t, 'review abc -> r.jsonl: running', 'r.jsonl'), t + 'review abc -> r.jsonl: running\r\n');
  assert.equal(setRunLine('a\nb', 'x -> k: running', 'k'), 'a\nb\nx -> k: running\n');
  assert.equal(setRunLine('', 'x -> k: running', 'k'), 'x -> k: running\n');
  assert.equal(setRunLine('-> k: in line 1\n-> k: in line 2\n', 'x -> k: running', 'k'), '-> k: in line 1\n-> k: in line 2\nx -> k: running\n'); // lines 1-2 are never matched
  assert.equal(setRunLine('a\nb\nbuild x -> o.jsonl: running\nknight y -> o.jsonl.txt: running\n', 'build x -> o.jsonl: ended', 'o.jsonl'), 'a\nb\nbuild x -> o.jsonl: ended\nknight y -> o.jsonl.txt: running\n');
});

// A recorder: files is a map; git returns `tip`; review records its argv or throws.
function world({ tip = 'def5678', reviewError = '' } = {}) {
  const files = { 'q.txt': 'status\ngate\nbuild br -> o.jsonl: running\n' }, reviews = [];
  return {
    files, reviews,
    x: {
      read: (p) => files[p] ?? '', write: (p, t) => { files[p] = t; },
      git: (dir, ...a) => { assert.deepEqual([dir, ...a], ['/wt', 'rev-parse', 'br']); return tip; },
      review: (a) => { if (reviewError) throw new Error(reviewError); reviews.push(a); },
    },
  };
}
const job = (extra = {}) => ({ queue: 'q.txt', key: 'o.jsonl', text: 'build br -> o.jsonl:', review: { dir: '/wt', branch: 'br', base: 'abc1234', brief: '/rb.txt', out: '/r.jsonl', ...extra } });

test('TODO 167d: finish rewrites the queue line to ended and launches the review of the branch tip', () => {
  const w = world();
  finish(job(), 0, w.x);
  assert.equal(w.files['q.txt'], 'status\ngate\nbuild br -> o.jsonl: ended\n');
  assert.deepEqual(w.reviews, [['review', 'def5678', '/rb.txt', '/r.jsonl']]);
  assert.equal(w.files['/r.jsonl'], undefined);
  const k = world();
  finish(job({ from: '/clone' }), 0, k.x);
  assert.deepEqual(k.reviews[0].slice(4), ['--from', '/clone', 'br']); // a Knight build is fetched from its clone
});

test('TODO 167d: finish writes NO REVIEW and launches nothing for an error exit, no new commit, or a review that will not start', () => {
  for (const [w, code, why] of [[world(), 2, /^NO REVIEW: the build ended in error \(exit 2\)\n$/], [world({ tip: 'abc1234ff' }), 0, /^NO REVIEW: no commit on the branch/], [world({ reviewError: 'Bishop and King busy' }), 0, /^NO REVIEW: review not launched: Bishop and King busy\n$/]]) {
    finish(job(), code, w.x);
    assert.match(w.files['/r.jsonl'], why);
    assert.deepEqual(w.reviews, []);
    assert.match(w.files['q.txt'], /o\.jsonl: ended/);
  }
});

test('TODO 167d: finish without a review job only updates the queue; a queue.txt that cannot be written does not stop the chain', () => {
  const w = world();
  finish({ queue: 'q.txt', key: 'o.jsonl', text: 'build br -> o.jsonl:' }, 0, w.x);
  assert.deepEqual(w.reviews, []);
  assert.equal(w.files['/r.jsonl'], undefined);
  const bad = world();
  const write = bad.x.write;
  bad.x.write = (p, t) => { if (p === 'q.txt') throw new Error('EPERM'); write(p, t); };
  finish(job(), 0, bad.x);
  assert.equal(bad.reviews.length, 1);
});
