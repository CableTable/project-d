export type Job = {
  id: string
  taskId?: string
  desc: string
  command: string
  startedMs: number
  state: 'running' | 'completed' | 'failed' | 'killed'
  endedMs?: number
}

export type UsageCell = { pct: number | null; reset: string }
export type UsageRow = { who: string; w5: UsageCell; wk: UsageCell; cap: number | null }
export type RunRow = { who: string; name: string; state: string; age: number }
export type QueueView = { rows: { mark: '>' | ' '; text: string }[]; done: number }
export type Ci = { at: number; num: number | null; state: 'running' | 'green' | 'red' | 'unknown'; automerge: boolean }

export type Disk = { at: number; usage: UsageRow[] | null; cacheAge: number | null; dir: string | null; rows: RunRow[]; queue: QueueView | null; ci: Ci | null }

declare module 'claude-code' {
  interface PluginState {
    'pd-runs': { jobs: Job[]; disk: Disk | null }
  }
}
