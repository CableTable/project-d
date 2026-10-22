import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { bandLine, recentJsonl } from './band.mjs'

const line = atom({ plugin: 'pd-band', key: 'line' } as const, null)

// Reads only: never starts a live usage refresh.
async function refresh($: any, runsDir: string, usageFile: string) {
  const now = await $.clock.now()
  let csv: string | null = null
  let csvAge: number | null = null
  try {
    csv = await $.fs.read(usageFile)
    csvAge = now - (await $.fs.stat(usageFile)).mtimeMs
  } catch {}
  let files: { name: string; mtimeMs: number; size?: number }[] = []
  try {
    files = (await $.fs.list(runsDir)).filter((f: any) => f.kind === 'file')
  } catch {}
  const texts: Record<string, string> = {}
  for (const name of recentJsonl(files, now)) {
    // shortcut: a file over 4 MiB is not read, so it counts as still running; upgrade if a finished run that big shows up
    if ((files.find((f) => f.name === name)?.size ?? 0) > 4 * 1024 * 1024) continue
    try { texts[name] = await $.fs.read(`${runsDir}/${name}`) } catch {}
  }
  await update($, line, () => bandLine(csv, csvAge, files, now, texts))
}

export const register: Register = (on, options) => {
  const runsDir = String(options.runsDir || 'E:/Project B/Claude/Project D extras/runs16')
  const usageFile = String(options.usageFile || 'E:/Project B/Claude/Project D/mockups/_design/usage/limits.csv')

  on('session.start', async ($, e, next) => {
    await refresh($, runsDir, usageFile)
    $.clock.every(30_000, () => refresh($, runsDir, usageFile))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const text = await read($, line)
    if (e.props.hasSurvey || text === null) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor>{text}</Text>
      </Box>
    )
  })
}
