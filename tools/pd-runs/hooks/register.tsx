import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Ci, Disk, Job, RunRow, UsageCell } from '../types'
import { findRuns, paneRows, jsonlToRead, newestRunsDir, parseProcs, usageRows, barParts, barColor, endState, fit, ago, queueRows, branchOf, parseCi, snapshot, toastsFor, CI_EVERY_MS, PIECE, WHO_COLOR, PS_ARGV, WIDTH, wrap, ciLines, hiddenIn, goScripts, scriptFiles, reapJobs } from './runs.mjs'

const PANE = 'pd-runs'
const jobs = atom({ plugin: 'pd-runs', key: 'jobs' } as const, [])
const disk = atom({ plugin: 'pd-runs', key: 'disk' } as const, null)
let busy = false
let hidden = false // this session's folder is in hideInDirs: nothing is registered or tracked
let ci: Ci | null = null // last gh result; gh runs at most every CI_EVERY_MS, not every tick
let seen: ReturnType<typeof snapshot> | null = null // the last tick's states; null after a load, so the first tick toasts nothing

// gh failing or missing is "unknown", never an error.
async function pollCi($: any, repoDir: string, now: number): Promise<Ci> {
  try {
    const branch = branchOf(await $.fs.read(`${repoDir}/.git/HEAD`))
    if (!branch) return parseCi('', now)
    const r = await $.process.run(['gh', 'pr', 'view', branch, '--json', 'number,labels,statusCheckRollup'], { cwd: repoDir, timeoutMs: 20_000 })
    return parseCi(r.exitCode === 0 ? r.stdout : '', now)
  } catch {
    return parseCi('', now)
  }
}

// Reads only: never starts a usage refresh, never calls the model. One process listing per tick, gh every 2 min.
async function refresh($: any, extrasDir: string, usageFile: string, repoDir: string) {
  if (busy) return
  busy = true
  try {
    const now: number = await $.clock.now()
    let csv: string | null = null
    let cacheAge: number | null = null
    try {
      csv = await $.fs.read(usageFile)
      cacheAge = now - (await $.fs.stat(usageFile)).mtimeMs
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
    let procs = null // null: the listing failed, so findRuns falls back to the files alone
    try {
      const r = await $.process.run(PS_ARGV, { timeoutMs: 20_000 })
      if (r.exitCode === 0) procs = parseProcs(r.stdout)
    } catch {}
    let queue = null
    if (dir) try { queue = queueRows(await $.fs.read(`${extrasDir}/${dir}/queue.txt`)) } catch {}
    if (!ci || now - ci.at >= CI_EVERY_MS) ci = await pollCi($, repoDir, now)
    const rows = findRuns(files, now, texts, procs)
    // Rook rows: learn the run files each go-*.sh writes (to match its row), and end the jobs whose process is gone (a notice may never come).
    const base = dir ? `${extrasDir}/${dir}` : extrasDir
    const pending = (await read($, jobs)).filter(j => j.state === 'running' && !j.files && goScripts(j.command, base).length)
    const found: Record<string, string[]> = {}
    for (const j of pending) {
      const names: string[] = []
      let ok = false
      for (const s of goScripts(j.command, base)) {
        try { names.push(...scriptFiles(await $.fs.read(s.path))); ok = true } catch {}
      }
      if (ok) found[j.id] = names
    }
    await update($, jobs, l => reapJobs(l.map(j => (found[j.id] ? { ...j, files: found[j.id] } : j)), procs, now))
    const next: Disk = { at: now, usage: usageRows(csv, now), cacheAge, dir, rows, queue, ci }
    await update($, disk, () => next)
    // A failed process listing makes every live row look finished for a tick: no toasts, and keep the last states.
    if (procs) {
      const cur = snapshot(paneRows(await read($, jobs), rows, now), ci)
      for (const text of toastsFor(seen, cur)) $.ui.toast(text)
      seen = cur
    }
  } finally {
    busy = false
  }
}

export const register: Register = (on, options) => {
  const extrasDir = String(options.extrasDir || 'E:/Project B/Claude/Project D extras')
  const usageFile = String(options.usageFile || 'E:/Project B/Claude/Project D/mockups/_design/usage/limits.csv')
  const repoDir = String(options.repoDir || 'E:/Project B/Claude/Project D')
  const hideInDirs = String(options.hideInDirs ?? 'E:/Project B/Claude/support') // ?? : an emptied option hides nowhere

  on('session.start', async ($, e, next) => {
    hidden = hiddenIn(e.cwd, hideInDirs)
    if (!e.isInteractive || hidden) return next(e) // no pane, no poller in a -p run or a hidden folder
    await $.command.register({ name: 'runs', description: 'Open the jobs pane (Rook, Bishop, Knight)' })
    await refresh($, extrasDir, usageFile, repoDir)
    $.clock.every(30_000, () => refresh($, extrasDir, usageFile, repoDir))
    void $.ui.open({ id: PANE, title: 'Runs', columns: WIDTH })
    return next(e)
  })

  on('command.run', { command: 'runs' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Runs', columns: WIDTH })
    return { text: 'Runs pane opened.' }
  })

  // Rook's own background Bash calls.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (hidden || !e.run_in_background) return next(e)
    const startedMs: number = await $.clock.now()
    const job: Job = { id: e.tool_use_id, desc: e.description || e.command.slice(0, 60), command: e.command, startedMs, state: 'running' }
    await update($, jobs, list => [...list, job].slice(-50))
    const ran = await next(e)
    const taskId = ran.deny === undefined ? (ran.result as { backgroundTaskId?: string } | undefined)?.backgroundTaskId : undefined
    await update($, jobs, list => list.map(j => (j.id === job.id ? (ran.deny !== undefined || ran.isError ? { ...j, state: 'failed' as const, endedMs: startedMs } : { ...j, taskId }) : j)))
    return ran
  }).catch(($, e, next) => next(e)) // a tracking failure must never block the call

  // A background call returns at once; the job is done only when its task notice says it ended (a notice with no end word changes nothing).
  on('ui.render', { component: 'UserMessage', props: { origin: { kind: 'task-notification' } } }, async ($, e, next) => {
    const task = e.props.task
    const state = endState(task?.status)
    if (state && (task?.id || task?.toolUseId)) {
      const endedMs: number = await $.clock.now()
      const mine = (j: Job) => j.state === 'running' && ((!!task.id && j.taskId === task.id) || (!!task.toolUseId && j.id === task.toolUseId))
      await update($, jobs, l => l.map(j => (mine(j) ? { ...j, state, endedMs } : j)))
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const d = await read($, disk)
    const now: number = d?.at ?? (await $.clock.now())
    const view = paneRows(await read($, jobs), d?.rows ?? [], now)
    const col = (who: string): string => (WHO_COLOR as Record<string, string>)[who] ?? 'text'
    const piece = (who: string): string => (PIECE as Record<string, string>)[who] ?? '·'

    const cell = (label: string, c: UsageCell, cap: number | null = null) => (
      <Text>
        <Text dimColor>{label} </Text>
        {barParts(c.pct, cap).map((k, i) => (k === 'cap' ? <Text key={String(i)} bold color="text">┃</Text> : k === 'fill' ? <Text key={String(i)} color={barColor(c.pct)}>█</Text> : <Text key={String(i)} dimColor>░</Text>))}
        <Text color={barColor(c.pct)}>{(c.pct == null ? '?' : `${c.pct}%`).padStart(5)}</Text>
        <Text dimColor> {c.reset}</Text>
      </Text>
    )
    const head = (text: string, color: string) => <Text bold color={color}>{text}</Text>

    const stateColor = (s: string) => (s.startsWith('queued') ? 'warning' : s === 'testing' ? 'suggestion' : 'success')
    const indent = ' '.repeat(11) // the label column: dot / mark, piece, name of the agent
    const liveRow = (r: RunRow, i: number) => {
      const w = Math.max(7, r.state.length)
      const lines = wrap(r.name, WIDTH - 11 - 1 - w - 1 - 4)
      return (
        <Box key={`l${i}`} flexDirection="column">
          <Text>
            <Text bold color={col(r.who)}>● {piece(r.who)} {fit(r.who, 6)} </Text>
            <Text bold color={col(r.who)}>{(lines[0] ?? '').padEnd(WIDTH - 11 - 1 - w - 1 - 4)}</Text>
            <Text color={stateColor(r.state)}> {r.state.padEnd(w)}</Text>
            <Text dimColor> {ago(r.age).padStart(4)}</Text>
          </Text>
          {lines.slice(1).map((l, k) => <Text key={String(k)} bold color={col(r.who)}>{indent}{l}</Text>)}
        </Box>
      )
    }
    const mark = (s: string) => (s === 'done' ? { ch: '✓', color: 'success' } : s === 'failed' ? { ch: '✗', color: 'error' } : { ch: '!', color: 'warning' })
    const recentRow = (r: RunRow, i: number) => {
      const m = mark(r.state)
      const lines = wrap(r.name, WIDTH - 11 - 1 - 7 - 1 - 4)
      return (
        <Box key={`r${i}`} flexDirection="column">
          <Text dimColor>
            <Text color={m.color}>{m.ch} </Text>
            <Text color={col(r.who)}>{piece(r.who)} {fit(r.who, 6)} </Text>
            {(lines[0] ?? '').padEnd(WIDTH - 11 - 1 - 7 - 1 - 4)}
            <Text color={m.color}> {r.state.padEnd(7)}</Text> {ago(r.age).padStart(4)}
          </Text>
          {lines.slice(1).map((l, k) => <Text key={String(k)} dimColor>{indent}{l}</Text>)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold color="claude">♚ Project D jobs</Text>
        {d?.ci && ciLines(d.ci, d.at).map((words, i) => (
          <Text key={`c${i}`}>{words.map((w, k) => <Text key={String(k)} dimColor={w.dim} bold={w.bold} color={w.color}>{k ? ' ' : ''}{w.t}</Text>)}</Text>
        ))}
        <Text> </Text>
        <Text>
          {head('Usage', 'permission')}
          {d?.cacheAge != null && (d.cacheAge > 15 * 60_000 ? <Text color="warning">  stale {ago(d.cacheAge)}</Text> : <Text dimColor>  cache {ago(d.cacheAge)}</Text>)}
        </Text>
        {d && !d.usage && <Text dimColor>no usage cache</Text>}
        {!d && <Text dimColor>reading...</Text>}
        {d?.usage?.map(u => (
          <Box key={u.who} flexDirection="column">
            <Text><Text bold color={col(u.who)}>{piece(u.who)} {fit(u.who, 6)} </Text>{cell('5h', u.w5)}</Text>
            <Text>{'         '}{cell('wk', u.wk, u.cap)}</Text>
            {u.cap != null && <Text dimColor>{'         '}cap {u.cap}%</Text>}
          </Box>
        ))}
        <Text> </Text>
        {head('Running', 'success')}
        {view.running.length === 0 && <Text dimColor>Nothing running</Text>}
        {view.running.map(liveRow)}
        {d?.queue && (
          <Box flexDirection="column">
            <Text> </Text>
            {head('Queue', 'warning')}
            {d.queue.rows.map((q, i) => (
              <Box key={`q${i}`} flexDirection="column">
                {wrap(q.text, WIDTH - 2).map((l, k) => (q.mark === '>' ? (
                  <Text key={String(k)} bold>{k ? <Text>{'  '}</Text> : <Text color="claude">● </Text>}{l}</Text>
                ) : (
                  <Text key={String(k)}>{'  '}{l}</Text>
                )))}
              </Box>
            ))}
            {d.queue.done > 0 && <Text dimColor><Text color="success">✓ </Text>{d.queue.done} done</Text>}
          </Box>
        )}
        <Text> </Text>
        {head('Recent', 'suggestion')}
        {view.recent.length === 0 && <Text dimColor>nothing in the last 2h</Text>}
        {view.recent.map(recentRow)}
      </Box>
    )
  })
}
