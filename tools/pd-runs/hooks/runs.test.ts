import { expect, test } from 'claude-code/testing'

import { findRuns, newestRunsDir, usageLines, istHM, jobText } from './runs.mjs'

const NOW = Date.UTC(2026, 9, 22, 21, 30) // 03:00 IST
const min = (m: number) => NOW - m * 60_000
const RESULT = '{"type":"result","subtype":"success"}'

test('newest runs<N> folder is the highest N', async () => {
  const dir = (name: string) => ({ name, kind: 'dir' as const })
  expect(newestRunsDir([dir('runs9'), dir('runs17'), dir('runs16'), dir('runsX'), { name: 'runs99', kind: 'file' }])).toBe('runs17')
  expect(newestRunsDir([])).toBe(null)
})

test('Bishop and Knight rows: running, done, cut off', async () => {
  const files = [
    { name: 'b104fix.jsonl', mtimeMs: min(1) }, // no result, fresh: running
    { name: 'b93.jsonl', mtimeMs: min(30) }, // result: done
    { name: 'b-pdruns.jsonl', mtimeMs: min(20) }, // no result, quiet: cut off
    { name: 'r104.log', mtimeMs: min(2) }, // no r104.txt: running
    { name: 'r93.log', mtimeMs: min(60) },
    { name: 'r93.txt', mtimeMs: min(60) + 500 }, // answer written last: done
    { name: 'rold.log', mtimeMs: min(200) }, // outside 2 h: dropped
    { name: 'brief-104.txt', mtimeMs: min(1) },
  ]
  const texts = { 'b104fix.jsonl': '{"type":"assistant"}', 'b93.jsonl': `{"type":"assistant"}\n${RESULT}`, 'b-pdruns.jsonl': '{"type":"assistant"}' }
  const rows = findRuns(files, NOW, texts).map(r => `${r.who} ${r.name} ${r.state}`)
  expect(rows).toEqual(['Bishop 104fix running', 'Knight 104 running', 'Bishop pdruns cut off', 'Bishop 93 done', 'Knight 93 done'])
})

test('usage lines, IST time, queued job', async () => {
  const csv = 'agent,role,model,window,used_pct,cap_pct,starts,resets,as_of\nRook,x,x,5h,23,,a,b,c\nRook,x,x,week,73,,a,b,c\nPip,x,x,5h,4,,a,b,c\nRowan,x,x,week,14,,a,b,c'
  const lines = usageLines(csv, 120_000)
  expect(lines[0]).toContain('Rook')
  expect(lines[0]).toContain('23%')
  expect(lines[1]).toContain('Bishop  5h   4%   week    ?')
  expect(lines[2]).toContain('week  14%')
  expect(lines[3]).toBe('cache 2m ago')
  expect(usageLines(null, null)).toEqual(['no usage cache'])
  expect(istHM(NOW)).toBe('03:00')
  const job = { desc: 'Wait', command: 'echo waiting 600 s for 04:17 IST', startedMs: NOW, state: 'running' as const }
  expect(jobText(job, NOW)).toBe('queued for 04:17  Wait  (started 03:00)')
})
