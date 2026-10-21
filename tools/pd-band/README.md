# pd-band

A Claude Code mod: one dim line above the prompt in the Code tab, refreshed every 30 s. It costs no model tokens (it only reads two places on disk).

```
Rook 5h 12% wk 40% · Bishop 5h 3% wk 21% · Knight 5h 5% wk 9% · 2m ago  |  Bishop txo-suite 12m · Knight 54 4m
```

- **Usage**: the cache `tools/rook.mjs usage` writes (`mockups/_design/usage/limits.csv`). pd-band only reads it and never starts a live refresh. `2m ago` is the file's age; over 15 min it says `usage stale 20m`; no file says `no usage cache`.
- **Runs**, in the runs folder (default `E:/Project B/Claude/runs12`): a `*.jsonl` changed in the last 3 min with no `"type":"result"` line is a **Bishop** run (name = file name without `pip-`); a `rowan-<name>.log` changed in the last 3 min with no newer `rowan-<name>-r.txt` is a **Knight** run. The number is minutes since the file last changed. `idle` when none.
- A `.jsonl` over 4 MiB cannot be read by a mod, so while it is under 3 min old it counts as running.

## Install (no admin)

The mod is used where it is; nothing is copied or installed. Not installed yet: that is your call.

1. One CLI session: `claude --plugin-dir "E:\Project B\Claude\Project D\tools\pd-band"`.
2. Always on, desktop app too: in the `settings.json` of the account the app uses (`%USERPROFILE%\.claude\settings.json`; a guess for the 2nd account, whose folder is `.claude-account2`), add under `env`: `"CLAUDE_CODE_PLUGIN_DIRS": "E:\\Project B\\Claude\\Project D\\tools\\pd-band"`, then restart the app.
3. The two paths are in `/config` (rows "Runs folder" and "Usage cache") and reload the mod.

## Remove

Delete the `CLAUDE_CODE_PLUGIN_DIRS` entry (or stop passing `--plugin-dir`) and restart. Nothing else was written anywhere.

## Test

`npm.cmd test` runs `pd-band.test.mjs` (the pure logic in `hooks/band.mjs`). `claude plugin validate tools/pd-band` checks the manifest and the hooks module.
