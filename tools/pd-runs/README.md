# pd-runs

A Claude Code mod: a side pane that shows what jobs are running while you use the terminal. It opens by itself at session start, `/runs` reopens it, and it refreshes every 30 s. It only reads files on disk and never calls the model (0 tokens). Times are IST.

```
Rook    5h  23%   week  73%
Bishop  5h   4%   week  42%
Knight  5h  91%   week  14%
cache 2m ago

Rook
started 02:50  Wait for the build  (4m)
done  Run tests  (02:10-02:14)

Bishop / Knight (runs17)
Bishop  104fix        running   quiet 1m
Knight  104           done      26m ago
```

- **Usage**: `limits.csv` (written by `tools/rook.mjs usage`); the pane only reads it. Over 15 min old it says `usage stale`.
- **Rook**: this session's background Bash calls (`run_in_background`), with description and start time. A notice that the task ended turns the row to `done` / `failed` / `killed`; until then it says `started HH:MM`. A script that prints `waiting N s for 04:17` shows as `queued for 04:17`.
- **Bishop / Knight**: the highest `runs<N>` folder in the extras folder. A `*.jsonl` with no `"type":"result"` line changed in the last 3 min = Bishop running; `r<name>.log` with no later `r<name>.txt` = Knight running. Quiet longer than 3 min without a result = `cut off`. Finished rows stay 2 h; at most 10, running first.

## Install (no admin)

Copy the folder to `~/.claude/dev-mods/<session>/pd-runs/` (hot-loaded) or run `claude --plugin-dir "<this folder>"`. Paths are in `/config`: "Extras folder" and "Usage cache".

## Test

`claude plugin validate <folder>` and `claude plugin test <folder>` (the folder parsing in `hooks/runs.mjs`).
