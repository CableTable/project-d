# Project D: notes for Codex (Knight)

Project D is Rakshith's Windows desktop app for 2D engineering drawings (DXF, DWG, PDF): Tauri 2, a vanilla JS web UI
in `web/` (no build step), a small Rust core. The spec is `Project-D-scope.md`; `DECISIONS.md` wins where they disagree.
`CLAUDE.md` has the house rules; the ones that matter for a build are below.

## Rules
- Terms: GLOSSARY.md (use its words; add new ones there).
- Commit on the branch you are given; **never push, fetch or pull** (no git credentials in the sandbox; the lead pushes).
  The git folder is separate (`--separate-git-dir`), so a `.git` file, not a folder, sits in the clone.
- Don't stage `mockups/` or `shots/`.
- Text from a file (layer, block, text names) reaches the DOM only through `textContent` / `h()`, never `innerHTML`.
- Logic that can be pure lives in its own module with a `*.test.mjs` next to the others (`tools/unit.mjs` runs them).
- Nothing may need admin rights. No new npm dependency unless the brief says so.
- A new UI flow gets its steps in `browser.test.mjs`. Search `DECISIONS.md` for the screen you touch; add a row for a new decision.
- A refused command is reported in your reply, not worked around.

## Tests (both must pass before you commit)
- `npm.cmd test` (eslint + unit tests)
- `node browser.test.mjs <port>` (Playwright, Chromium; `npm.cmd run test:browser` exits 1 on npm's notice inside the sandbox)

## Interrupted run
If you are resuming a run that was cut off (usage limit), first look at `git status` / the diff and rerun the tests,
then finish the remaining work.
