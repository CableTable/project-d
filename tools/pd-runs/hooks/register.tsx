import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Disk, Job } from '../types'
import { findRuns, jobText, jsonlToRead, newestRunsDir, usageLines, ago, KEEP_MS } from './runs.mjs'

const PANE = 'pd-runs'
const jobs = atom({ plugin: 'pd-runs', key: 'jobs' } as const, [])
const disk = atom({ plugin: 'pd-runs', key: 'disk' } as const, null)

// Reads only: never starts a usage refresh, never calls the model.
async function refresh($: any, extrasDir: string, usageFile: string) {
  const now: number = await $.clock.now()
  let csv: string | null = null
  let csvAge: number | null = null
  try {
    csv = await $.fs.read(usageFile)
    csvAge = now - (await $.fs.stat(usageFile)).mtimeMs
  } catch {}
  let dir: string | null = null
  let files: { name: string; mtimeMs: number; size?: number }[] = []
  try {
    dir = newestRunsDir(await $.fs.list(extrasDir))
    if (dir) files = (await $.fs.list(`${extrasDir}/${dir}`)).filter((f: any) => f.kind === 'file')
  } catch {}
  const texts: Record<string, string> = {}
  for (const name of jsonlToRead(files, now)) {
    try { texts[name] = await $.fs.read(`${extrasDir}/${dir}/${name}`) } catch {}
  }
  const next: Disk = { at: now, usage: usageLines(csv, csvAge), dir, rows: findRuns(files, now, texts) }
  await update($, disk, () => next)
}

export const register: Register = (on, options) => {
  const extrasDir = String(options.extrasDir || 'E:/Project B/Claude/Project D extras')
  const usageFile = String(options.usageFile || 'E:/Project B/Claude/Project D/mockups/_design/usage/limits.csv')

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'runs', description: 'Open the jobs pane (Rook, Bishop, Knight)' })
    await refresh($, extrasDir, usageFile)
    $.clock.every(30_000, () => refresh($, extrasDir, usageFile))
    void $.ui.open({ id: PANE, title: 'Runs' })
    return next(e)
  })

  on('command.run', { command: 'runs' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Runs' })
    return { text: 'Runs pane opened.' }
  })

  // Rook's own background Bash calls.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!e.run_in_background) return next(e)
    const startedMs: number = await $.clock.now()
    const job: Job = { id: e.tool_use_id, desc: e.description || e.command.slice(0, 60), command: e.command, startedMs, state: 'running' }
    await update($, jobs, list => [...list, job].slice(-50))
    const ran = await next(e)
    const taskId = ran.deny === undefined ? (ran.result as { backgroundTaskId?: string } | undefined)?.backgroundTaskId : undefined
    await update($, jobs, list => list.map(j => (j.id === job.id ? (ran.deny !== undefined || ran.isError ? { ...j, state: 'failed' as const, endedMs: startedMs } : { ...j, taskId }) : j)))
    return ran
  }).catch(($, e, next) => next(e)) // a tracking failure must never block the call

  // A background task's notice row says how it ended.
  on('ui.render', { component: 'UserMessage', props: { origin: { kind: 'task-notification' } } }, async ($, e, next) => {
    const task = e.props.task
    const list = await read($, jobs)
    if (task?.id && list.some(j => j.taskId === task.id && j.state === 'running')) {
      const endedMs: number = await $.clock.now()
      const state = task.status === 'failed' || task.status === 'killed' ? task.status : 'completed'
      await update($, jobs, l => l.map(j => (j.taskId === task.id && j.state === 'running' ? { ...j, state, endedMs } : j)))
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const d = await read($, disk)
    const now: number = d?.at ?? (await $.clock.now())
    const mine = (await read($, jobs)).filter(j => j.state === 'running' || now - (j.endedMs ?? j.startedMs) <= KEEP_MS).slice(-5).reverse()

    return (
      <Box flexDirection="column">
        {(d?.usage ?? ['reading...']).map(l => <Text>{l}</Text>)}
        <Text> </Text>
        <Text bold>Rook</Text>
        {mine.length === 0 && <Text dimColor>no background jobs</Text>}
        {mine.map(j => <Text dimColor={j.state !== 'running'}>{jobText(j, now)}</Text>)}
        <Text> </Text>
        <Text bold>Bishop / Knight{d?.dir ? ` (${d.dir})` : ''}</Text>
        {d && d.rows.length === 0 && <Text dimColor>nothing in the last 2h</Text>}
        {d?.rows.map(r => (
          <Text dimColor={r.state !== 'running'}>
            {r.who.padEnd(6)}  {r.name.padEnd(12)}  {r.state.padEnd(8)}  {r.state === 'running' ? `quiet ${ago(r.age)}` : `${ago(r.age)} ago`}
          </Text>
        ))}
      </Box>
    )
  })
}
