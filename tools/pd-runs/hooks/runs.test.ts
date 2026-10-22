import { expect, test } from 'claude-code/testing'

import { findRuns, newestRunsDir, usageRows, barCells, barColor, barParts, todayCap, queueRows, branchOf, parseCi, snapshot, toastsFor, istHM, paneRows, endState, parseProcs, fit } from './runs.mjs'

const NOW = Date.UTC(2026, 9, 22, 21, 30) // 03:00 IST
const min = (m: number) => NOW - m * 60_000
const RESULT = '{"type":"result","subtype":"success","is_error":false}'
const SID = '4075b2cb-70da-4b47-98e2-8abc2b6a2303'
const proc = (pid: number, ppid: number, startMin: number, cmd: string) => ({ pid, ppid, startMs: min(startMin), cmd })
const brief = (rows: { who: string; name: string; state: string }[]) => rows.map(r => `${r.who} ${r.name} ${r.state}`)

test('newest runs<N> folder is the highest N', async () => {
  const dir = (name: string) => ({ name, kind: 'dir' as const })
  expect(newestRunsDir([dir('runs9'), dir('runs17'), dir('runs16'), dir('runsX'), { name: 'runs99', kind: 'file' }])).toBe('runs17')
  expect(newestRunsDir([])).toBe(null)
})

test('files alone (no process listing): running, done, failed, cut off', async () => {
  const files = [
    { name: 'b104fix.jsonl', mtimeMs: min(1) }, // no result, fresh: running
    { name: 'b93.jsonl', mtimeMs: min(30) }, // result: done
    { name: 'b-pdruns.jsonl', mtimeMs: min(20) }, // no result, quiet: cut off
    { name: 'b-bad.jsonl', mtimeMs: min(25) }, // error result: failed
    { name: 'r104.log', mtimeMs: min(2) }, // no r104.txt: running
    { name: 'r93.log', mtimeMs: min(60) },
    { name: 'r93.txt', mtimeMs: min(60) + 500 }, // answer written last: done
    { name: 'rold.log', mtimeMs: min(200) }, // outside 2 h: dropped
    { name: 'brief-104.txt', mtimeMs: min(1) },
  ]
  const texts = {
    'b104fix.jsonl': '{"type":"assistant"}',
    'b93.jsonl': `{"type":"assistant"}\n${RESULT}`,
    'b-pdruns.jsonl': '{"type":"assistant"}',
    'b-bad.jsonl': '{"type":"result","subtype":"error_max_turns","is_error":true}',
  }
  const rows = brief(findRuns(files, NOW, texts, null)).sort()
  expect(rows).toEqual(['Bishop 104fix running', 'Bishop 93 done', 'Bishop bad failed', 'Bishop pdruns cut off', 'Knight 104 running', 'Knight 93 done'])
})

test('b104fix-2: a result line but the claude2 process is alive = running; testing when a browser test runs under it', async () => {
  const files = [
    { name: 'b104fix.jsonl', mtimeMs: min(80) }, // the first run of the same session: finished
    { name: 'b104fix-2.jsonl', mtimeMs: min(11) }, // result line 11 min ago, quiet
  ]
  const text = `{"type":"system","session_id":"${SID}"}\n${RESULT}`
  const texts = { 'b104fix.jsonl': text, 'b104fix-2.jsonl': text }
  const claude = proc(100, 1, 40, `node cli.js -p --resume ${SID} --output-format stream-json --verbose`)
  const wrapper = proc(99, 1, 40, `cmd.exe /c claude2.cmd -p --resume ${SID} --output-format stream-json`)
  expect(brief(findRuns(files, NOW, texts, [wrapper, claude])).sort()).toEqual(['Bishop 104fix done', 'Bishop 104fix-2 running'])
  const test = proc(200, 150, 12, 'node browser.test.mjs')
  const sh = proc(150, 100, 12, 'bash -c npx playwright')
  const rows = findRuns(files, NOW, texts, [wrapper, claude, sh, test])
  expect(rows.find(r => r.name === '104fix-2')).toMatchObject({ state: 'testing', age: 40 * 60_000 })
  // the process ended: the same file is done
  expect(brief(findRuns(files, NOW, texts, [])).sort()).toEqual(['Bishop 104fix done', 'Bishop 104fix-2 done'])
})

test('go-<name>.sh claims the claude under its bash: an old cut-off file does not take it as spare', async () => {
  const files = [
    { name: 'b104.jsonl', mtimeMs: min(30) }, // old, no result: cut off
    { name: 'b105.jsonl', mtimeMs: min(1) },
  ]
  const texts = { 'b104.jsonl': '{"type":"assistant"}', 'b105.jsonl': '{"type":"assistant"}' }
  const bash = proc(10, 1, 5, 'bash go-105.sh')
  const claude = proc(11, 10, 5, 'node cli.js -p --max-budget-usd 8 --output-format stream-json')
  expect(brief(findRuns(files, NOW, texts, [bash, claude])).sort()).toEqual(['Bishop 104 cut off', 'Bishop 105 running'])
})

test('a fresh run (no id in its command line) is claimed by a spare claude -p process; Knight by its answer file name', async () => {
  const files = [
    { name: 'b-new.jsonl', mtimeMs: min(9) },
    { name: 'r104.log', mtimeMs: min(9) },
  ]
  const procs = [proc(5, 1, 30, 'node cli.js -p --max-budget-usd 8 --output-format stream-json'), proc(6, 1, 25, 'codex exec -o /e/x/runs17/r104.txt -')]
  expect(findRuns(files, NOW, { 'b-new.jsonl': '{"type":"assistant"}' }, procs).map(r => `${r.who} ${r.state} ${r.age / 60_000}`).sort()).toEqual(['Bishop running 30', 'Knight running 25'])
  expect(brief(findRuns(files, NOW, { 'b-new.jsonl': '{"type":"assistant"}' }, [])).sort()).toEqual(['Bishop new cut off', 'Knight 104 cut off'])
})

test('process listing parses; a bad line is skipped', async () => {
  const out = '12|3|1760000000000|node a.js | pipe\r\ngarbage\r\n'
  expect(parseProcs(out)).toEqual([{ pid: 12, ppid: 3, startMs: 1760000000000, cmd: 'node a.js | pipe' }])
})

test('Rook jobs: done only when the notice says it ended', async () => {
  expect(endState(undefined)).toBe(null)
  expect(endState('running')).toBe(null)
  expect(endState('completed')).toBe('completed')
  expect(endState('failed')).toBe('failed')
  expect(endState('killed')).toBe('killed')
  const wait = { desc: 'go-0417', command: 'bash go-0417.sh # waiting 600 s for 04:17 IST', startedMs: min(5), state: 'running' as const }
  const ended = { desc: 'tests', command: 'npm test', startedMs: min(20), state: 'completed' as const, endedMs: min(10) }
  const v = paneRows([wait, ended], [{ who: 'Bishop', name: 'x', state: 'testing', age: 3 * 60_000 }], NOW)
  expect(brief(v.running)).toEqual(['Rook go-0417 queued 04:17', 'Bishop x testing'])
  expect(brief(v.recent)).toEqual(['Rook tests done'])
})

test('usage rows, bars, colours, IST', async () => {
  const csv = 'agent,role,model,window,used_pct,cap_pct,starts,resets,as_of\nRook,x,x,5h,23,,a,2026-10-23T05:40:00+05:30,c\nRook,x,x,week,73,,a,2026-10-25T15:30:00+05:30,c\nPip,x,x,5h,4,,a,b,c\nRowan,x,x,week,91,,a,b,c'
  const [rook, bishop, knight] = usageRows(csv, NOW)!
  expect(rook).toEqual({ who: 'Rook', w5: { pct: 23, reset: '05:40' }, wk: { pct: 73, reset: 'Sun 15:30' }, cap: 83 })
  expect(knight!.cap).toBe(null)
  expect(bishop!.w5.pct).toBe(4)
  expect(bishop!.wk.pct).toBe(null)
  expect(knight!.wk.pct).toBe(91)
  expect(usageRows(null, NOW)).toBe(null)
  expect([barColor(69), barColor(70), barColor(89), barColor(90)]).toEqual(['success', 'warning', 'warning', 'error'])
  expect(istHM(NOW)).toBe('03:00')
  expect(fit('a long job name here', 8)).toBe('a long …')
})

const ist = (d: number, h: number, m = 0) => Date.UTC(2026, 9, d, h - 5, m - 30) // Oct <d> <h>:<m> IST

test('today cap: Rook this week fixed, then 14 x k from Sun 15:30; Bishop 14 x k from Mon 15:30; Knight none', async () => {
  expect([todayCap('Rook', ist(23, 12)), todayCap('Rook', ist(24, 12)), todayCap('Rook', ist(25, 15, 29))]).toEqual([83, 94, 98])
  expect([todayCap('Rook', ist(25, 15, 30)), todayCap('Rook', ist(26, 15, 29)), todayCap('Rook', ist(26, 15, 30)), todayCap('Rook', ist(32, 15, 29))]).toEqual([14, 14, 28, 98]) // day 32 = Sun Nov 1, a minute before the next reset
  expect([todayCap('Bishop', ist(23, 12)), todayCap('Bishop', ist(26, 15, 29)), todayCap('Bishop', ist(26, 15, 30)), todayCap('Bishop', ist(27, 15, 30))]).toEqual([56, 98, 14, 28])
  expect(todayCap('Knight', NOW)).toBe(null)
  // the marker sits on the cell holding the cap; no cap, no marker
  expect(barParts(50, 83)).toEqual(['fill', 'fill', 'fill', 'fill', 'fill', 'empty', 'empty', 'empty', 'cap', 'empty'])
  expect(barParts(96, 94)[9]).toBe('cap')
  expect(barParts(null, null)).toEqual(Array(10).fill('empty'))
  expect([barCells(23), barCells(100), barCells(null)]).toEqual([2, 10, 0])
})

test('queue: [>] first, then waiting, done collapse to "N done", max 8 rows, # ignored, no file = null', async () => {
  expect(queueRows(null)).toBe(null)
  const text = ['# queue', '[x] a', '[X] b', '[ ] w1', '[>] now', '', '[ ] w2', 'junk', '[>] now2'].join('\r\n')
  expect(queueRows(text)).toEqual({ done: 2, rows: [{ mark: '>', text: 'now' }, { mark: '>', text: 'now2' }, { mark: ' ', text: 'w1' }, { mark: ' ', text: 'w2' }] })
  const many = Array.from({ length: 12 }, (_, i) => `[ ] w${i}`).join('\n')
  expect(queueRows(many)!.rows.length).toBe(8)
  expect(queueRows(`[x] done\n${many}`)!.rows.length).toBe(7) // the "1 done" line takes the 8th row
})

test('CI: branch from HEAD; checks -> running / green / red; label; bad output = unknown', async () => {
  expect(branchOf('ref: refs/heads/claude/session17\n')).toBe('claude/session17')
  expect(branchOf('0172ae1abc\n')).toBe(null)
  const run = (checks: object[], labels: object[] = []) => parseCi(JSON.stringify({ number: 11, labels, statusCheckRollup: checks }), 5)
  const ok = { status: 'COMPLETED', conclusion: 'SUCCESS' }
  expect(run([ok, { status: 'IN_PROGRESS', conclusion: '' }])).toEqual({ at: 5, num: 11, state: 'running', automerge: false })
  expect(run([ok, { status: 'COMPLETED', conclusion: 'SKIPPED' }], [{ name: 'automerge' }])).toEqual({ at: 5, num: 11, state: 'green', automerge: true })
  expect(run([ok, { status: 'COMPLETED', conclusion: 'FAILURE' }, { status: 'QUEUED', conclusion: '' }]).state).toBe('red')
  expect(run([{ state: 'SUCCESS' }]).state).toBe('green')
  expect(run([{ state: 'PENDING' }]).state).toBe('running')
  expect(run([]).state).toBe('running')
  expect(parseCi('', 5)).toEqual({ at: 5, num: null, state: 'unknown', automerge: false })
  expect(parseCi('no pull requests found', 5).state).toBe('unknown')
})

test('toasts: live -> done / cut off / failed, CI running -> green / red; none on the first tick', async () => {
  const row = (who: string, name: string, state: string) => ({ who, name, state, age: 0 })
  const live = (s: string) => /^(running|testing|queued)/.test(s)
  const snap = (rows: ReturnType<typeof row>[], ci: { num: number; state: string } | null = null) =>
    snapshot({ running: rows.filter(r => live(r.state)), recent: rows.filter(r => !live(r.state)) }, ci ? { at: 0, num: ci.num, state: ci.state as 'green', automerge: false } : null)
  const before = snap([row('Bishop', '104fix', 'testing'), row('Knight', '104', 'running'), row('Rook', 'go', 'queued 04:17'), row('Bishop', 'x', 'running')], { num: 11, state: 'running' })
  // first tick after a load: nothing, even when rows are already finished and CI is red
  expect(toastsFor(null, snap([row('Bishop', 'old', 'done')], { num: 11, state: 'red' }))).toEqual([])
  const after = snap([row('Bishop', '104fix', 'done'), row('Knight', '104', 'cut off'), row('Rook', 'go', 'failed'), row('Bishop', 'x', 'testing')], { num: 11, state: 'green' })
  expect(toastsFor(before, after)).toEqual(['♝ Bishop 104fix done', '♞ Knight 104 cut off', '♜ Rook go failed', 'CI #11 green'])
  // still running, running -> testing, finished long ago, CI unknown, another PR, CI green -> red: nothing
  expect(toastsFor(before, snap([row('Bishop', '104fix', 'running'), row('Bishop', 'x', 'testing'), row('Knight', 'old', 'done')], { num: 11, state: 'running' }))).toEqual([])
  expect(toastsFor(snap([row('Bishop', 'old', 'done')], { num: 11, state: 'green' }), snap([row('Bishop', 'old', 'done')], { num: 11, state: 'red' }))).toEqual([])
  expect(toastsFor(before, snap([], { num: 11, state: 'unknown' }))).toEqual([])
  expect(toastsFor(before, snap([], { num: 12, state: 'red' }))).toEqual([])
})
