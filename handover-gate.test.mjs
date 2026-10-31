import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countTicked, gateOps, nextState, queueLine, setLine2 } from './tools/handover-gate.mjs';

const BEFORE = [
  '- [ ] 162. **Quick Select**',
  '- [ ] 163. **Grip menus**',
  '    155e. Grip modes as AutoCAD.',
  '      155e1. (open) Mode cycle',
  '      155e2. (open) Options',
  '    155f. (open) Copy displacement',
  '1. ✅ (old) done long ago',
  '1. an old reused number, still open',
].join('\r\n');
// 162 ticked, 155e1 and 155e2 ticked -> the parent 155e ticked too (not counted), 155f ticked, a new row 164 added already ticked; 163 stays open
const AFTER = [
  '- [x] 162. **Quick Select**',
  '- [ ] 163. **Grip menus**',
  '    155e. ✅ Grip modes as AutoCAD.',
  '      155e1. ✅ Mode cycle',
  '      155e2. ✅ Options',
  '    155f. ✅ Copy displacement',
  '- [x] 164. **New and already done**',
  '1. ✅ (old) done long ago',
  '1. an old reused number, still open',
].join('\r\n');

test('ticked counter: leaf rows that turned ticked or arrived ticked; a ticked parent, old ticks and the same text count nothing', () => {
  assert.equal(countTicked(BEFORE, AFTER), 5); // 162, 164, 155e1, 155e2, 155f (not 155e)
  assert.equal(countTicked(AFTER, AFTER), 0);
  assert.equal(countTicked(BEFORE, BEFORE), 0);
  assert.equal(countTicked('', '1. ✅ a\n- [x] 2. b\n3. ❌ c'), 2); // a won't-do row is not a tick
});

test('state: the same Rook keeps its launches, a new uuid starts empty at the current head', () => {
  const old = { uuid: 'a', startSha: 's1', launches: [{ kind: 'item' }] };
  assert.equal(nextState(old, 'a', 's2'), old);
  assert.deepEqual(nextState(old, 'b', 's2'), { uuid: 'b', startSha: 's2', launches: [] });
  assert.deepEqual(nextState(null, 'b', 's2'), { uuid: 'b', startSha: 's2', launches: [] });
});

test('queue line: counts, the limit and HANDOVER DUE; line 2 is replaced or inserted, CRLF kept', () => {
  assert.equal(queueLine('Rook S30', 1, 1), 'items since start (Rook S30): 1 ticked, 1 launched / 2');
  assert.equal(queueLine('Rook S30', 0, 2), 'items since start (Rook S30): 0 ticked, 2 launched / 2 -> HANDOVER DUE');
  assert.match(queueLine('Rook S30', 2, 1), /HANDOVER DUE$/);
  assert.equal(setLine2('title\r\nPUSHED x\r\n', 'L'), 'title\r\nL\r\nPUSHED x\r\n');
  assert.equal(setLine2('title\nitems since start (old): 9 ticked\nPUSHED x', 'L'), 'title\nL\nPUSHED x');
  assert.equal(setLine2('title', 'L'), 'title\nL');
  assert.equal(setLine2('', 'L'), '\nL');
});

// A fake extras folder, repo and TODO.md history for the gate.
function world(uuid = 'uuid-1') {
  const files = { '/x/rook-next.txt': `${uuid}\nRook S30\n/x/runs30/resume-rook.txt\n`, '/x/runs30/queue.txt': 'title\nPUSHED a\n' };
  const git = (...a) => ({ 'rev-parse claude/session30': 'head0', 'show head0:TODO.md': BEFORE, 'show claude/session30:TODO.md': BEFORE })[a.join(' ')] ?? (() => { throw new Error(`git ${a.join(' ')}`); })();
  const env = { extras: '/x', read: (p) => files[p] ?? null, write: (p, t) => { files[p] = t; }, git };
  return { files, env, gate: gateOps(env) };
}
const state = (w) => JSON.parse(w.files['/x/runs30/rook-gate.json']);

test('gate: 2 item launches pass, the 3rd is refused; fix rounds never count; --over passes and is logged', () => {
  const w = world();
  const rec = (o = {}) => w.gate.record({ fix: false, over: false, brief: 'b.txt', ...o });
  for (const b of ['k/1', 'k/2']) { w.gate.check(false, false); rec({ branch: b }); }
  w.gate.check(true, false); // a fix round passes at the limit
  rec({ fix: true, branch: 'k/fix' });
  assert.throws(() => w.gate.check(false, false), /^Error: handover due: 2 new items launched since Rook S30 started \(k\/1, k\/2\)\. Hand over \(WORKFLOW\.md Handover\), or pass --over with his OK\.$/);
  w.gate.check(false, true);
  rec({ over: true, branch: 'k/3' });
  const s = state(w);
  assert.deepEqual(s.launches.map((l) => [l.kind, l.branch, l.over]), [['item', 'k/1', undefined], ['item', 'k/2', undefined], ['fix', 'k/fix', undefined], ['item', 'k/3', true]]);
  assert.deepEqual([s.uuid, s.startSha], ['uuid-1', 'head0']);
  assert.equal(w.files['/x/runs30/queue.txt'], 'title\nitems since start (Rook S30): 0 ticked, 3 launched / 2 -> HANDOVER DUE\nPUSHED a\n');
});

test('gate: a new Rook (other uuid) starts at 0; `gate` writes the queue line without a launch; a failing queue update does not fail the launch', () => {
  const w = world();
  w.gate.record({ fix: false, over: false, brief: 'b', branch: 'k/1' });
  w.files['/x/rook-next.txt'] = 'uuid-2\nRook S30b\n/x/runs30/resume-rook.txt\n';
  assert.equal(w.gate.report(), 'items since start (Rook S30b): 0 ticked, 0 launched / 2');
  assert.equal(state(w).uuid, 'uuid-2');
  assert.equal(w.files['/x/runs30/queue.txt'].split('\n')[1], 'items since start (Rook S30b): 0 ticked, 0 launched / 2');
  const bad = world();
  bad.env.git = (...a) => { if (a[0] === 'show') throw new Error('no TODO.md'); return 'head0'; };
  const err = console.error, seen = [];
  console.error = (m) => seen.push(m);
  try { assert.equal(gateOps(bad.env).record({ fix: false, over: false, brief: 'b', branch: 'k/1' }), undefined); } finally { console.error = err; }
  assert.match(seen[0], /queue line not updated: no TODO\.md/);
  assert.equal(state(bad).launches.length, 1);
});

test('gate: a corrupt state file is named; record never throws, so a --fix launch with rook-next.txt missing only warns', () => {
  const w = world();
  w.files['/x/runs30/rook-gate.json'] = '{oops';
  assert.throws(() => w.gate.check(false, false), /^Error: \/x\/runs30\/rook-gate\.json is corrupt: delete it to reset the count$/);
  const err = console.error, seen = [];
  console.error = (m) => seen.push(m);
  try {
    assert.equal(w.gate.record({ fix: false, over: false, brief: 'b', branch: 'k/1' }), undefined);
    delete w.files['/x/rook-next.txt'];
    w.gate.check(true, false); // --fix skips the check, so the launch starts
    assert.equal(w.gate.record({ fix: true, over: false, brief: 'b', branch: 'k/fix' }), undefined);
  } finally { console.error = err; }
  assert.match(seen[0], /launch not counted: \/x\/runs30\/rook-gate\.json is corrupt/);
  assert.match(seen[1], /launch not counted: rook-next\.txt not found/);
});

test('ticked counter: a row ticked then unticked counts 0', () => {
  assert.equal(countTicked('- [x] 1. a', '- [ ] 1. a'), 0);
});

test('gate: without rook-next.txt or a runs<N> line it stops with a message', () => {
  const w = world();
  w.files['/x/rook-next.txt'] = 'uuid-1\nRook S30\n';
  assert.throws(() => w.gate.check(false, false), /must have the Rook uuid/);
  delete w.files['/x/rook-next.txt'];
  assert.throws(() => w.gate.check(false, false), /rook-next\.txt not found/);
});
