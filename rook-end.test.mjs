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
  assert.deepEqual(w.reviews, [['review', 'def5678', '/rb.txt', '/r.jsonl', '--over']]); // --over: the 150k gate must not refuse it
  assert.equal(w.files['/r.jsonl'], undefined);
  const k = world();
  finish(job({ from: '/clone' }), 0, k.x);
  assert.deepEqual(k.reviews[0].slice(4), ['--from', '/clone', 'br', '--over']); // a Knight build is fetched from its clone
});

test('TODO 167e lows: an error exit reads no git tip; setRunLine pads a short queue.txt so a run line never takes line 1 or 2', () => {
  const w = world();
  let gitCalls = 0;
  const git = w.x.git;
  w.x.git = (...a) => { gitCalls++; return git(...a); };
  finish(job(), 1, w.x);
  assert.equal(gitCalls, 0);
  assert.match(w.files['/r.jsonl'], /error \(exit 1\)/);
  let called = false;
  assert.deepEqual(reviewChain({ base: 'abc1234', tip: () => { called = true; return 'def5678'; }, code: 1 }).why.slice(0, 9), 'the build');
  assert.equal(called, false);
  assert.deepEqual(reviewChain({ base: 'abc1234', tip: () => 'def5678', code: 0 }), { chain: true });
  assert.equal(setRunLine('only one line', 'x -> k: running', 'k'), 'only one line\n\nx -> k: running\n');
  assert.equal(setRunLine('only one line\n\nx -> k: running\n', 'x -> k: ended', 'k'), 'only one line\n\nx -> k: ended\n');
  assert.equal(setRunLine('', 'x -> k: running', 'k'), '\n\nx -> k: running\n');
});

test('TODO 167d: finish writes NO REVIEW and launches nothing for an error exit, no new commit, or a review that will not start', () => {
  for (const [w, code, why] of [[world(), 2, /^NO REVIEW: the build ended in error \(exit 2\)\n$/], [world({ tip: 'abc1234ff' }), 0, /^NO REVIEW: no commit on the branch/], [world({ reviewError: 'Bishop and King busy' }), 0, /^NO REVIEW: review not launched: Bishop and King busy\n$/]]) {
    finish(job(), code, w.x);
    assert.match(w.files['/r.jsonl'], why);
    assert.deepEqual(w.reviews, []);
    assert.match(w.files['q.txt'], /o\.jsonl: ended/);
  }
});

test('TODO 198b Low: the queue line turns ended only after the review launch (and after NO REVIEW is written)', () => {
  const w = world(), order = [], review = w.x.review, write = w.x.write;
  w.x.review = (a) => { order.push('review: ' + w.files['q.txt'].split('\n')[2]); review(a); };
  w.x.write = (p, t) => { order.push('write ' + p); write(p, t); };
  finish(job(), 0, w.x);
  assert.deepEqual(order, ['review: build br -> o.jsonl: running', 'write q.txt']);
  order.length = 0;
  finish(job(), 3, w.x);
  assert.deepEqual(order, ['write o.jsonl', 'write /r.jsonl', 'write q.txt']);
});

test('retro38i: a dead launch (non-zero exit, no result) gets a LAUNCH DIED result so wait ends; a finished one is left alone', () => {
  const dead = world();
  finish({ queue: 'q.txt', key: 'o.jsonl', text: 't' }, 1, dead.x);
  assert.match(dead.files['o.jsonl'], /^\{"type":"result","is_error":true,"result":"LAUNCH DIED"\}\n$/);
  const done = world();
  done.files['o.jsonl'] = '{"type":"result"}\n';
  finish({ queue: 'q.txt', key: 'o.jsonl', text: 't' }, 1, done.x);
  assert.equal(done.files['o.jsonl'], '{"type":"result"}\n');
  const ok = world();
  finish({ queue: 'q.txt', key: 'o.jsonl', text: 't' }, 0, ok.x);
  assert.equal(ok.files['o.jsonl'], undefined);
  const knight = world(); // Knight's report .txt: empty = not done, any text = done
  finish({ queue: 'q.txt', key: 'k.txt', text: 't' }, 1, knight.x);
  assert.match(knight.files['k.txt'], /LAUNCH DIED/);
  const wrote = world();
  wrote.files['k.txt'] = 'report';
  finish({ queue: 'q.txt', key: 'k.txt', text: 't' }, 1, wrote.x);
  assert.equal(wrote.files['k.txt'], 'report');
});

test('retro38i fix: LAUNCH DIED starts on its own line; the job\'s full out path is used', () => {
  const w = world();
  w.files['o.jsonl'] = '{"type":"system"}';
  finish({ queue: 'q.txt', key: 'o.jsonl', text: 't' }, 1, w.x);
  assert.equal(w.files['o.jsonl'], '{"type":"system"}\n{"type":"result","is_error":true,"result":"LAUNCH DIED"}\n');
  const o = world();
  finish({ queue: 'q.txt', key: 'o.jsonl', out: '/elsewhere/o.jsonl', text: 't' }, 1, o.x);
  assert.match(o.files['/elsewhere/o.jsonl'], /LAUNCH DIED/);
  assert.equal(o.files['o.jsonl'], undefined);
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
