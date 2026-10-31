# Project D: notes for Codex (Knight)

Project D is Rakshith's Windows desktop app for 2D engineering drawings (DXF, DWG, PDF): Tauri 2, a vanilla JS web UI
in `web/` (no build step), a small Rust core. The spec is `Project-D-scope.md`; `DECISIONS.md` wins where they disagree.
`CLAUDE.md` has the house rules; the ones that matter for a build are below.

## Rules
- Terms: GLOSSARY.md (use its words; add new ones there).
- Commit on the branch you are given; **never push, fetch or pull** (no git credentials in the sandbox; the lead pushes).
  The git folder is separate (`--separate-git-dir`), so a `.git` file, not a folder, sits in the clone.
- Don't stage `mockups/` or `shots/`.
- Full suite in a Knight clone: set `SHOTS_DIR=shots-k<item>-suite` first (the old `shots/` refuses writes there, EPERM; 156b2c2a lost a round to it, 2026-10-29).
- Text from a file (layer, block, text names) reaches the DOM only through `textContent` / `h()`, never `innerHTML`.
- Logic that can be pure lives in its own module with a `*.test.mjs` next to the others (`tools/unit.mjs` runs them).
- Nothing may need admin rights. No new npm dependency unless the brief says so.
- A new UI flow gets its steps in `browser.test.mjs`. Search `DECISIONS.md` for the screen you touch; add a row for a new decision.
- A refused command is reported in your reply, not worked around.
- Claude builders (King): your cwd is the worktree; one bare command per call, no `cd … &&`, no `sed -i`, no python heredocs, no PowerShell script blocks. Find with Grep or `grep -n`, read with Read offset/limit, change with Edit.
- New block / layer names: reuse `Ed.freeName` (web/edit.js); names compare case-insensitively, as in AutoCAD.
- **No mistakes** (his rule, 2026-10-29): before committing, re-read the brief line by line and tick each item against your diff. "Keep X unchanged" means grep every selector / function that styles or drives X, not just the obvious one. Change nothing the brief didn't ask for (no rewritten clicks or assertions). Anything not done or unsure goes in the report's first line.

## Tests (both must pass before you commit)
- `npm.cmd test` (eslint + unit tests)
- Brief paths `runs<N>/...` are under `E:/Project B/Claude/Project D extras/`. Search with `git grep -n` (`rg` is not installed).
- A fix round runs only the brief's filter, not the full suite (Rook runs it; S29 retro: fix rounds took 18-19 min).
- While working: your new / changed steps, `node browser.test.mjs <port> '<step names>'`. Once before committing a new item: the full
  suite, `node tools/browser-parallel.mjs <port>` (`npm.cmd run test:browser` exits 1 on npm's notice inside the sandbox).
- A failing step you didn't touch (filtered or full): rerun it alone on the base; if it fails there too, note it as a
  filter artifact or old failure and go on.
- `browser.test.mjs` starts and stops its own server: start no other, end no process (no taskkill / Stop-Process).
- A new mode or command gets checks for Esc mid-command, one Undo, and an edit to its source after it ran.
- While fixing, filter on your own step only (`'TODO <id>'`); never single-word filters like `Text`.
- Throwaway scripts only read repo files (change files with your edit tool), live in the clone as `tmp-*` (gitignored);
  repo files are CRLF on disk: split on `/\r?\n/`. Unit tests: `web/x.js` -> `x.test.mjs` at the repo root.

## Interrupted run
If you are resuming a run that was cut off (usage limit), first look at `git status` / the diff and rerun the tests,
then finish the remaining work.
