# pd-runs

A Claude Code mod: a 40-column side pane of what jobs are running while you use the terminal. It opens by itself at session start, `/runs` reopens it, and it refreshes every 30 s. It only reads files and the process list and never calls the model (0 tokens). Times are IST.

```
♚ Project D jobs
#11 CI running · automerge on  2m

Usage  cache 2m
♜ Rook   5h ██░░░░░░░░  23% 05:40
         wk ███████░┃░  73% Sun 15:30
         cap 83%
♝ Bishop 5h ░░░░░░░░░░   4% 07:10
         wk ████░┃░░░░  42% Mon 15:30
         cap 56%
♞ Knight 5h █████████░  91% 04:16
         wk █░░░░░░░░░  14% Thu 23:16

Running
● ♝ Bishop  104fix-2     testing  22m
● ♜ Rook    go-0417  queued 04:17  5m

Queue
● 104fix round 3
  next job
✓ 3 done

Recent
✓ ♞ Knight  104          done     44m
! ♝ Bishop  old          cut off  1h19
```

Bars: green under 70 %, amber 70-89, red 90+ (theme colours). Piece, name and dot are Rook cyan, Bishop magenta, King green, Knight yellow. A run is King's when its process line names `claude3`, its file starts `king-`, or its text names `claude3` / `.claude-account3`; any other `.jsonl` is Bishop's.

- **Cap marker** (`┃` on the week bar, "cap N%" under it): Rook 14 % x k from its Sun 15:30 IST reset, but Fri 23 Oct 83 % and Sat 24 Oct 94 %; Bishop 14 % x k from Mon 15:30 IST (k = whole days since the reset + 1); King and Knight none. `todayCap()` in `runs.mjs`.
- **Queue**: `runs<N>/queue.txt` of the newest runs folder, lines `[x]` (counted in "N done"), `[>]` (bold, accent dot), `[ ]` (plain); `#` lines ignored; at most 8 rows. No file, no section.
- **CI line**: the open PR of the branch in `<repo>/.git/HEAD`, via `gh pr view <branch> --json number,labels,statusCheckRollup`, at most every 2 min; the age is the last result's. gh missing or failing shows "CI unknown".
- **Long text wraps** (queue, running, recent, CI line) onto the next line, starting under the text, not under the dot / piece.
- **Rook wrappers**: a Rook background call whose command runs `go-<name>.sh` is not listed once the Bishop / Knight row `<name>` is shown (it is that job's launcher), nor once a row owns a run file the script names (`-o rfix2.txt`, `> b122afix2.jsonl`), whatever the script is called.
- **Hide in folders** (`hideInDirs` in `/config`, default `E:/Project B/Claude/support`, `;` between several, empty = nowhere): a session whose folder is one of them or inside one registers nothing (no pane, poller, toasts, tracking). Compared case-insensitively, `/` = `\`.
- **Toasts** (`$.ui.toast`, silent): a job going running to done / cut off / failed, CI going running to green / red. None on the first tick after a load, and none on a tick whose process listing failed.

## What says a job is running

- **Bishop / Knight**: one process listing (`Get-CimInstance Win32_Process`, ~0.4 s) per 30 s tick. A run is **running** while a process names its session id (`--resume <id>`), its run file, its answer file or its launching `go-<name>.sh`; **testing** when a `browser.test` process runs under it. A `"type":"result"` line only says the model wrote its last message: result + live process = still running. No live process: result = `done` (`failed` if `is_error`), no result = `cut off`. A run with no match whose file moved in the last 3 min, or that a spare `claude -p` process stands for, counts as running too. If the listing fails, the files alone decide.
- **Rook**: this session's background Bash calls (`run_in_background`). A call returns at once; the job is done only when its task notice arrives with an end word (`completed`, `failed`, `killed`). Fallback if the notice never shows: on a tick a running job's process (its `go-<name>.sh`, else its two longest plain words) is missing from the listing, it is `done` (one miss if it was seen before, two if not). `waiting N s for 04:17` in its command shows `queued 04:17`.
- Source folder: the highest `runs<N>` in the extras folder. Finished rows stay 2 h; Recent shows at most 8.

## Install (no admin)

Copy the folder to `~/.claude/dev-mods/<session>/pd-runs/` (hot-loaded) or run `claude --plugin-dir "<this folder>"`. Paths are in `/config`: "Extras folder" and "Usage cache".

## Test

`claude plugin validate <folder>` and `claude plugin test <folder>` (`hooks/runs.mjs`); types: `tsc -p tsconfig.check.json`.
