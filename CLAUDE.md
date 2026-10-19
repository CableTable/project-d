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
Sessions 4–6 (2026-10-18/19): drawing tools, Text, Grips, Properties, Compare, theme "Modern SaaS", Offset / Trim /
Mirror, Auto-nest (release v0.1.16, PR #1). Session 7 (2026-10-19, PR #2): the 4 bugs from the v0.1.16 test (close
prompt for unsaved tabs, Layers + Add, invalid-number messages, PDF / Print asks where to save). See HISTORY.md.

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
- **UI is mocked up first** (an artifact, "Project D Mockups"), then built once he picks,
  unless he says go ahead without one.
- **The build matches its mock-up** (from Project R):
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
- **Subagents for everything** (2026-10-17, his rule for Project D; replaces Project R's "only when they pay"):
  the lead (Opus) is the orchestrator. It plans, writes the briefs, reviews, runs the final checks
  and merges. **Sonnet builds** the big pieces (a feature, a mock-up, a multi-file change); fixes and
  edits under ~20 lines the lead does itself, since a cold-start agent costs more limit than the fix
  (his call, 2026-10-17). **Haiku looks things up** (searches, reading code or logs, screenshot
  checks), each reporting back in a few lines. Subagents work on the session's branch; when two run
  at once they get separate files. The lead says in one line which agents a request uses.
- **The builder is `claude2`** (2026-10-19, his setup): Claude Code on his 2nd account
  (`C:\Users\raksh\.local\bin\claude2.cmd`), so builds don't spend the main account. The lead starts
  it from the shell in the background and keeps the `session_id` from the JSON:
  `claude2 -p "<brief>" --agent builder --model claude-sonnet-5-5 --effort high --permission-mode acceptEdits --disallowedTools "Bash(gh pr merge:*)" "PowerShell(gh pr merge:*)" --allowedTools "Bash(echo:*)" "Bash(tee:*)" "PowerShell(Select-String:*)" "PowerShell(Select-Object:*)" "PowerShell(Write-Output:*)" --output-format json`.
  Fixes go to the same session (`--resume <session_id>`, same flags); he can watch or take over with
  `claude2 --resume <session_id>`. Commands are allowed by `.claude/settings.json`; a refused one
  shows in `permission_denials` and gets added there. The builder never merges or force-pushes.
  A new folder (a worktree) needs trusting once: he runs `claude2` there and accepts.
- **Keep the context lean**: screenshot checks and broad searches go to a helper agent that reports
  back in a few lines. Never print whole logs, diffs or files. Edit CLAUDE.md at most once a
  session, near the end. After a PR merges, suggest `/compact` or a new session.
- When something important happens, add a dated paragraph to HISTORY.md, and keep this file to
  what's true now.
