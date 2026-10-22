export type Job = {
  id: string
  taskId?: string
  desc: string
  command: string
  startedMs: number
  state: 'running' | 'completed' | 'failed' | 'killed'
  endedMs?: number
}

export type Disk = { at: number; usage: string[]; dir: string | null; rows: { who: string; name: string; state: string; age: number }[] }

declare module 'claude-code' {
  interface PluginState {
    'pd-runs': { jobs: Job[]; disk: Disk | null }
  }
}
