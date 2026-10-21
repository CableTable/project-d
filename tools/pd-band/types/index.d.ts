export type Line = string | null

declare module 'claude-code' {
  interface PluginState {
    'pd-band': { line: Line }
  }
}
