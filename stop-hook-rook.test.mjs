import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rookStop } from './tools/stop-hook-rook.mjs';

const X = 'X:/extras', ME = '11111111-1111-4111-8111-111111111111', NEXT = '22222222-2222-4222-8222-222222222222';
const HEAD = 'abcdef0123456789abcdef0123456789abcdef01';
const TRANSCRIPT = `C:\\Users\\raksh\\.claude\\projects\\E--P\\${ME}.jsonl`;

// files: path -> text; remote: stdout of `git branch -r --contains`; branch: current branch (an Error throws)
function check(input, { files = {}, there = [], branch = 'claude/session35', remote = '' } = {}) {
  const read = (p) => { if (!(p in files)) throw new Error(`ENOENT ${p}`); return files[p]; };
  const git = (...a) => {
    const c = a.join(' ');
    if (c === 'branch --show-current') { if (branch instanceof Error) throw branch; return branch; }
    if (c === 'rev-parse HEAD') return HEAD;
    if (c === `branch -r --contains ${HEAD}`) return remote;
    throw new Error(`unexpected git ${c}`);
  };
  return rookStop(input, { read, exists: (p) => there.includes(p), git, extras: X });
}

const HANDOVER = 'Handover written: start Rook.lnk (node tools/rook.mjs next)';
const next = { [`${X}/rook-next.txt`]: `${NEXT}\r\nRook S35\r\n` };
const input = { session_id: ME, transcript_path: TRANSCRIPT };

test('TODO 190a: rookStop blocks a written handover until the next Rook transcript exists', () => {
  assert.equal(check(input, { files: next }), HANDOVER);
  assert.equal(check(input, { files: next, there: [`C:\\Users\\raksh\\.claude\\projects\\E--P/${NEXT}.jsonl`] }), '');
  assert.equal(check(input, { files: { [`${X}/rook-next.txt`]: `  ${ME}  \n` } }), '', 'line 1 is this very session: the next Rook is not written yet');
  assert.equal(check(input, { files: { [`${X}/rook-next.txt`]: 'not a uuid\n' } }), '');
  assert.equal(check(input, { files: {} }), '', 'rook-next.txt unreadable');
  assert.equal(check({ session_id: ME }, { files: next }), '', 'no transcript path: cannot tell');
});

test('TODO 190a: rookStop blocks "Suite green: push now" only for a local-only head, a green suite log and no running run', () => {
  const dir = `${X}/runs35`, green = { [`${dir}/suite-${HEAD}.log`]: 'tests\nSUITE unit=0 browser=0\n', [`${dir}/queue.txt`]: 'a\nknight x -> y: ended\n' };
  const PUSH = 'Suite green: push now (git push)';
  assert.equal(check({}, { files: green }), PUSH);
  assert.equal(check({}, { files: { ...green, [`${dir}/suite-${HEAD}.log`]: undefined, [`${dir}/suite-${HEAD.slice(0, 7)}.log`]: 'SUITE unit=0 browser=0' } }), PUSH, 'short sha log');
  assert.equal(check({}, { files: { ...green, [`${dir}/suite-${HEAD}.log`]: 'SUITE unit=0 browser=1\n' } }), '', 'browser red');
  assert.equal(check({}, { files: { ...green, [`${dir}/suite-${HEAD}.log`]: 'SUITE unit=1 browser=0\n' } }), '', 'unit red');
  assert.equal(check({}, { files: { ...green, [`${dir}/queue.txt`]: 'a\nbuild b -> c: running\n' } }), '', 'a run going');
  assert.equal(check({}, { files: green, remote: '  origin/claude/session35' }), '', 'already pushed');
  assert.equal(check({}, { files: green, branch: 'king/190a' }), '', 'not a session branch');
  assert.equal(check({}, { files: green, branch: new Error('no git') }), '', 'git fails');
  assert.equal(check({}, { files: { [`${dir}/suite-${HEAD}.log`]: green[`${dir}/suite-${HEAD}.log`] } }), '', 'queue.txt unreadable');
  assert.equal(check({}, { files: { [`${dir}/queue.txt`]: green[`${dir}/queue.txt`] } }), '', 'no suite log');
});

test('TODO 190a: the handover check runs before the suite-green check', () => {
  const dir = `${X}/runs35`;
  const files = { ...next, [`${dir}/suite-${HEAD}.log`]: 'SUITE unit=0 browser=0\n', [`${dir}/queue.txt`]: 'a\n' };
  assert.equal(check(input, { files }), HANDOVER);
});
