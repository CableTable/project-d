import assert from 'node:assert/strict';
import { test } from 'node:test';
import { briefIds, contextOf, countTicked, gateOps, nextState, queueLine, setLine2, skipIds, tickIds } from './tools/handover-gate.mjs';

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

test('TODO 167e: ticks of tool and fix launches are not counted, unless an item launch has the same id', () => {
  const launches = [{ kind: 'item', ids: ['162'], branch: 'king/162' }, { kind: 'tool', ids: ['164'], branch: 'king/164' }, { kind: 'fix', ids: ['162'], branch: 'king/162fix' }, { kind: 'fix', ids: ['163'], branch: 'king/163-fix' }, { kind: 'tool', ids: [], branch: 'k/tool' }];
  const skip = skipIds({ launches });
  assert.deepEqual([...skip].sort(), ['163', '164']);
  assert.equal(countTicked(BEFORE, AFTER, skip), 4); // 162 stays (its fix does not hide the item), 164 is a tool ticket
  assert.equal(countTicked(BEFORE, AFTER, skipIds({ launches: [{ kind: 'tool', ids: ['155f'], branch: 'king/155f' }] })), 4);
  const g = world();
  g.files['/x/runs30/rook-gate.json'] = JSON.stringify({ uuid: 'uuid-1', startSha: 'head0', launches: [{ kind: 'tool', ids: ['162'], branch: 'king/162' }] });
  const env = { ...g.env, git: (...a) => (a.join(' ') === 'show claude/session30:TODO.md' ? AFTER : g.env.git(...a)) };
  assert.match(gateOps(env).report(), /: 4 ticked, 0 launched/); // 5 ticks, 162 was a tool ticket
});

test('TODO 185a: tick ids exclude single-digit prose; launch ids come from the brief header and Tick lines', () => {
  assert.deepEqual(tickIds('Tick 170, 1 line'), ['170']);
  assert.deepEqual(tickIds('Tick 1, 1 line'), []);
  assert.deepEqual(tickIds('6. Tick TODO 170 and 171, 1 line'), ['170', '171']);
  assert.deepEqual(briefIds('Build: TODO 167b (tools).\r\nTick 167b, 167c and TODO 170, 1 line'), ['167b', '167c', '170']);
  for (const role of ['King fix', 'Knight fix', 'Fix round']) assert.deepEqual(briefIds(`${role}: TODO 167c (fix).`), ['167c']);
  assert.deepEqual(briefIds('Build: TODO 167C.\nTick 167c'), ['167c']);
  assert.deepEqual(briefIds('No ids in this brief.'), []);
});

test('TODO 185a: recorded tool/fix flags skip ticks regardless of branch name, and ids survive brief reuse', () => {
  const w = world();
  const before = '- [ ] 167b. tool\n- [ ] 167c. fix\n- [ ] 170. item\n';
  const after = before.replaceAll('[ ]', '[x]');
  w.env.git = (...a) => ({ 'rev-parse claude/session30': 'head0', 'show head0:TODO.md': before, 'show claude/session30:TODO.md': after })[a.join(' ')];
  const gate = gateOps(w.env);
  for (const [branch, flags, brief] of [
    ['king/s33-tools', { tool: true }, 'Build: TODO 167b (tools).\nTick 167b, 1 line'],
    ['king/167c-fix-2', { fix: true }, 'King fix: TODO 167c (second fix).'],
    ['knight/drawing', {}, 'Build: TODO 170 (drawing).'],
  ]) {
    w.files['b.txt'] = brief;
    gate.record({ ...flags, brief: 'b.txt', branch });
  }
  assert.deepEqual(state(w).launches.map((l) => [l.kind, l.ids]), [['tool', ['167b']], ['fix', ['167c']], ['item', ['170']]]);
  w.files['b.txt'] = 'Build: TODO 999 (reused).';
  assert.equal(gate.report(), 'items since start (Rook S30): 1 ticked, 1 launched / 2, 1 tool');
});

test('TODO 185a: older launch records use saved briefs and recorded flags, never branch ids', () => {
  const w = world();
  w.files['tool.txt'] = 'Build: TODO 162 (tool).\nTick 162, 164';
  w.files['fix.txt'] = 'King fix: TODO 155f (fix).';
  const launches = [{ kind: 'tool', brief: 'tool.txt', branch: 'king/s33-tools' }, { kind: 'fix', brief: 'fix.txt', branch: 'king/167c-fix-2' }];
  w.files['/x/runs30/rook-gate.json'] = JSON.stringify({ uuid: 'uuid-1', startSha: 'head0', launches });
  const git = w.env.git;
  w.env.git = (...a) => a.join(' ') === 'show claude/session30:TODO.md' ? AFTER : git(...a);
  assert.match(gateOps(w.env).report(), /: 2 ticked, 0 launched/);
  assert.deepEqual([...skipIds({ launches: [{ kind: 'tool', branch: 'king/162', brief: 'missing.txt' }] }, w.env.read)], []);
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

// One assistant line of a Rook transcript with `n` tokens of context (split over the three usage fields).
const turn = (n, extra = {}) => JSON.stringify({ type: 'assistant', ...extra, message: { usage: { input_tokens: 10, cache_read_input_tokens: n - 10 - 5, cache_creation_input_tokens: 5, output_tokens: 99 } } }) + '\n';

// A fake extras folder, repo and TODO.md history for the gate.
function world(uuid = 'uuid-1') {
  const files = { '/x/rook-next.txt': `${uuid}\nRook S30\n/x/runs30/resume-rook.txt\n`, '/x/runs30/queue.txt': 'title\nPUSHED a\n' };
  const git = (...a) => ({ 'rev-parse claude/session30': 'head0', 'show head0:TODO.md': BEFORE, 'show claude/session30:TODO.md': BEFORE })[a.join(' ')] ?? (() => { throw new Error(`git ${a.join(' ')}`); })();
  files[`/c/${uuid}.jsonl`] = turn(40_000);
  const env = { extras: '/x', claudeDir: '/c', read: (p) => files[p] ?? null, write: (p, t) => { files[p] = t; }, git };
  return { files, env, gate: gateOps(env) };
}
const state = (w) => JSON.parse(w.files['/x/runs30/rook-gate.json']);

test('TODO 167c: a tool ticket passes the gate at the limit, is recorded as kind tool and is not an item; the line adds ", <k> tool"', () => {
  assert.equal(queueLine('Rook S30', 0, 1, 1), 'items since start (Rook S30): 0 ticked, 1 launched / 2, 1 tool');
  assert.equal(queueLine('Rook S30', 0, 2, 2), 'items since start (Rook S30): 0 ticked, 2 launched / 2, 2 tool -> HANDOVER DUE');
  const w = world();
  for (const b of ['k/1', 'k/2']) { w.gate.check(false, false); w.gate.record({ fix: false, over: false, brief: 'b.txt', branch: b }); }
  w.gate.check(false, false, true); // at the limit, still passes
  const line = w.gate.record({ fix: false, over: false, tool: true, brief: 'b.txt', branch: 'k/tool' });
  assert.deepEqual(state(w).launches.map((l) => [l.kind, l.over]), [['item', undefined], ['item', undefined], ['tool', undefined]]);
  assert.equal(line, 'items since start (Rook S30): 0 ticked, 2 launched / 2, 1 tool -> HANDOVER DUE');
  assert.throws(() => w.gate.check(false, false), /handover due: 2 new items launched/);
});

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

test('context: the last main-chain message counts, not the peak; sub-agent, zero and half-written lines are skipped', () => {
  assert.equal(contextOf(turn(200_000) + turn(60_000)), 60_000);
  assert.equal(contextOf(turn(60_000) + turn(900_000, { isSidechain: true }) + turn(900_000, { parent_tool_use_id: 't' }) + turn(0) + '{"type":"assis'), 60_000);
  assert.equal(contextOf('{"type":"user"}\n'), null);
});

test('context gate: over 150k refuses every launch (--fix too), --over passes, a missing transcript allows with one warning line', () => {
  const w = world(), log = console.log, seen = [];
  console.log = (m) => seen.push(m);
  try {
    w.gate.check(false, false);
    w.gate.context(false);
    assert.deepEqual(seen, []); // 40k: quiet
    w.files['/c/uuid-1.jsonl'] = turn(300_000) + turn(151_000);
    for (const fix of [false, true]) assert.throws(() => w.gate.check(fix, false), /^Error: HANDOVER: context 151k /);
    assert.throws(() => w.gate.context(false), /^Error: HANDOVER: context 151k /);
    w.gate.check(false, true); // --over passes
    w.gate.context(true);
    w.files['/c/uuid-1.jsonl'] = turn(300_000) + turn(150_000); // exactly 150k is not over
    w.gate.check(true, false);
    w.files['/c/uuid-1.jsonl'] = turn(300_000) + turn(20_000); // a compact lowered it
    w.gate.check(false, false);
    delete w.files['/c/uuid-1.jsonl'];
    w.gate.check(true, false);
    assert.equal(seen.length, 1);
    assert.match(seen[0], /context not checked: no transcript/);
  } finally { console.log = log; }
});

test('gate: without rook-next.txt or a runs<N> line it stops with a message', () => {
  const w = world();
  w.files['/x/rook-next.txt'] = 'uuid-1\nRook S30\n';
  assert.throws(() => w.gate.check(false, false), /must have the Rook uuid/);
  delete w.files['/x/rook-next.txt'];
  assert.throws(() => w.gate.check(false, false), /rook-next\.txt not found/);
});

test('TODO 167d: queueFile is the queue.txt of the runs<N> that rook-next.txt line 3 names; none = a message', () => {
  const w = world();
  assert.equal(w.gate.queueFile(), '/x/runs30/queue.txt');
  w.files['/x/rook-next.txt'] = 'uuid-1\nRook S30\n';
  assert.throws(() => w.gate.queueFile(), /line 3 does not name runs<N>/);
  delete w.files['/x/rook-next.txt'];
  assert.throws(() => w.gate.queueFile(), /line 3 does not name runs<N>/);
});
