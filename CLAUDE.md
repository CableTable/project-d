# Project D: working context

Claude Code reads this at the start of every session. **The spec is `Project-D-scope.md`**: a
Windows desktop app for 2D engineering drawings (DXF, DWG, PDF) plus a 3D viewer, for Rakshith
alone. This file is what's true now and the house rules. **HISTORY.md** gets a dated paragraph when
something important happens, **TODO.md** holds ideas agreed but not built, and **DECISIONS.md**
holds every decision (what he picked, and why).

Started 2026-10-16. Unrelated to Projects B, P, R and WF in the parent folder, but run by
**Project R's house rules** (his call, 2026-10-17), adapted below.

## Status

Session 1 (2026-10-17): repo **CableTable/project-d** (private), the decisions, the mock-ups
(artifact "Project D Mockups"), screen A built (drawing-first main screen, live step and repeat), and
CI that builds `ProjectD.exe` on `windows-latest` and publishes it to Releases on a merge to main.
Session 2 (2026-10-17): a DXF opens (File → Open, the Open button, drag and drop) in its own tab and
is drawn at true size on the sheet, 0,0 at the sheet's bottom-left; the Layers panel lists the
file's layers; Save, Apply, PDF / Print. PR #5: Part | Layout views (keep only the outline, 1:1, Measure, dimensions,
background pictures, vector PDF opens as a drawing, part PDF), a gripper per side, extra gaps.
Session 3 (2026-10-17, PR #6): layout tabs (L1) with a Parts library, extract and name parts, step and repeat per
layout (fit or typed rows / columns), a saved layout reopens with its settings; the Dimension tool (AutoCAD way);
decimals picker; Save never overwrites the opened file; Shift = straight picks. **Next: TODO.md "Rakshith's list"**,
the unticked items in his order of value: Build B = placing parts (2, 9–13, 16; mock-up board R3d), then 36–38
(align, group / lock, rulers), contour (35), then the rest. Push after every finished item and tick it in TODO.md
(his rule, 2026-10-17).
Session 13 (2026-10-21, PR #8): Text to outlines done (53a–d), grips off on big selections, PC-test TODO 82–88. **Next: TODO 83** (TXO font in the exe), then 82, then 84–88 and the rest of "Rakshith's list".
Sessions 4–6 (2026-10-18/19): drawing tools, Text, Grips, Properties, Compare, theme "Modern SaaS", Offset / Trim /
Mirror, Auto-nest (release v0.1.16, PR #1). Session 7 (2026-10-19, PR #2): the 4 bugs from the v0.1.16 test (close
prompt for unsaved tabs, Layers + Add, invalid-number messages, PDF / Print asks where to save). Session 8
(2026-10-19/20, PR #3): Objects tab (39), floating command bar (47), three review rounds and a whole-repo audit
(recovery, No plot, big PDFs, one storage helper), and the Rook / Bishop / Knight / Pawn workflow. See HISTORY.md.

## The app

- **Tauri 2**: web UI (vanilla JS, no build step, as Project R) in a native window, with a small
  Rust core for file dialogs and disk.
- **Portable, no admin**: one `ProjectD.exe`, double-click to run, no installer. Nothing may ever
  need admin rights (his rule, 2026-10-16), not to run, update or open files.
- **Local files only**: no accounts, no cloud, nothing that costs money.
- GitHub Actions (`windows-latest`) builds the exe on a merge to main and publishes it to
  **Releases**. He downloads it from there.

## Verification: nothing ships without it

Set up in session 1, the same shape as Project R:
- `npm test`: eslint (no-undef) and the pure modules' tests (drawing, geom, layout and doc).
- `npm run test:browser`: the UI in Chromium (Playwright) against the web code served locally.
- The Tauri build in CI (`cargo tauri build`), and the exe started once.
- **A UI change also gets looked at**: screenshots, light and dark.

## 1. How changes ship

- **Plan first, with options**, before any big build; wait for the go-ahead.
- **No mock-up unless he asks for one** for a feature (his call, 2026-10-20): Rook decides the UI, records it
  in DECISIONS.md, and the PR body says what was chosen. When he does ask, the mock-up comes first and he picks.
  The **As built** boards stay: every UI build gets one (mockups/R<n>_AB_*.html, local), drawn from the screenshots.
- **The build matches its mock-up**, when there is one (from Project R):
  1. Build from the mock-up's file, never from memory: read its artboard first and list what's on
     it (buttons, labels, colours, order). That list is the spec.
  2. Before calling a screen done, screenshot the real one beside its mock-up and tick the list;
     the PR body says per screen "matches mock-up" or names each difference.
  3. Once screens are built, an **"As built"** round in the mock-ups artifact is the truth. Any
     change to a live screen, even one asked for without a mock-up, updates it in the same PR.
  4. A difference on purpose is a decision: say it, change the mock-up, add it to DECISIONS.md.
- Work on a branch → pull request → CI runs the tests and the build.
- **One PR per session, merged once.** All of a session's changes go on ONE branch, a commit per
  change, in ONE pull request, with the PR body's list of changes kept up to date. Merge only when
  he says so (or at session end with his OK), on a green run for the head commit
  (`gh pr merge <n> --merge --match-head-commit <sha>`). When he asks for **auto-merge**: label the
  PR `automerge`, then push; the CI run's `merge` job merges once the tests and the build pass
  (as in Project R; GitHub's own auto-merge needs a paid plan). Never merge on red; revert rather than patch forward. Every failed
  run emails him, so get each push right.
- Releases go through GitHub, never by hand: a merge to main builds the exe and publishes it.
- **Still Rakshith's, not Claude's:** keys, passwords, code-signing certificates, billing
  (Actions minutes, a certificate), and anything installed on his PC.

## 2. Decisions → DECISIONS.md

Search DECISIONS.md for the screen or behaviour a change touches before building (read only those
rows), and add a row for a new one. Where it and `Project-D-scope.md` disagree, DECISIONS.md wins.

## 3. House rules

- Terms: GLOSSARY.md (use its words; add new ones there).
- **Text from a file never reaches HTML unescaped**: layer names, block names and text from a
  DXF, DWG or .cdr are built into the DOM with `textContent` / an `h()` helper (Project R's
  `dom.js`), never `innerHTML`.
- **Nothing ships unverified**: unit tests, the browser test (a new flow gets its steps in it),
  the exe build, and a UI change looked at (screenshots, light and dark).
- Never put a password or key in a file.
- **No admin, ever** (see The app).
- Logic that can be pure (the DXF reader and writer, geometry, snaps, Measure, PDF scaling)
  is pure and has its own tests.
- **DWG uses LibreDWG (GPL-3)**: fine for his own use. It lives in its own module so it can be
  swapped if the app is ever given away (scope §4).
- Times for Rakshith are in **IST** (UTC+5:30).
- Say when a Windows menu path is a guess. Keep answers short, because he often reads from his phone.
- Windows: PowerShell 5.1 has no `<` redirect and blocks `.ps1` shims, so use `npm.cmd` there.
- **How a session runs: WORKFLOW.md** (the roles, the exact commands, the loop, the budgets). In short:
  **Rook** is the lead (Opus, main account, this session): plans, writes briefs, reads short reports,
  merges, and writes no code: review findings, however small, go to Knight (his call, 2026-10-20). **Bishop** is everything on the 2nd account
  (`claude2`): Bishop-build (Sonnet high, a FRESH session per build or fix round, capped with
  `--max-budget-usd`), Bishop-review (Opus medium, `--agent reviewer`, in its own throwaway worktree, every
  build gets one), Bishop-look (Haiku), Bishop-test (the exe on his PC). **Knight** (Codex, his ChatGPT Go
  plan) builds (it commits, Rook pushes) and does web research, never reviews. **No default builder** (his call,
  2026-10-22): each build goes to whichever of Knight and Bishop-build has the lower weekly usage; Bishop also takes
  mock-ups and screenshots. **Pawn** (Antigravity) only quick lookups.
  Bishop never merges or force-pushes; a Stop hook keeps a builder from finishing on red tests.
  **Bishop's budget:** at most 14% of its weekly limit per day (above only with his OK). No usage report after a merge: the band and the usage page show it (his call, 2026-10-21).
  A new worktree folder needs trusting once on account 2.
- **Keep the context lean**: screenshot checks and broad searches go to a helper agent that reports
  back in a few lines. Never print whole logs, diffs or files. Edit CLAUDE.md at most once a
  session, near the end. After a PR merges, suggest `/compact` or a new session.
- When something important happens, add a dated paragraph to HISTORY.md, and keep this file to
  what's true now.
