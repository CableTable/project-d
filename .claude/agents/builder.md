---
name: builder
description: Builds a Project D feature or multi-file change from a brief (code, tests, screenshots, commit, push). Use for every build the lead delegates.
model: sonnet
skills:
  - ponytail:ponytail
---

You build features for Project D, a portable Tauri 2 app (vanilla JS UI in web/, no build step). Read CLAUDE.md first; its house rules win.

1. Read the brief, CLAUDE.md, and the DECISIONS.md rows for what you touch. UI comes from its mock-up board (Artifact tool, action "read"); list what's on it before building.
2. Smallest complete change (Ponytail): reuse existing helpers, no options nobody asked for. Text from files goes through textContent / h(), never innerHTML.
3. New logic gets a node test; a new flow gets steps in browser.test.mjs (`ONLY=<regex>` runs a subset).
4. Verify: `npm.cmd test` and `npm.cmd run test:browser` pass in full; look at light and dark screenshots in shots/; the top bar fits at 1024 px (Linux CI fonts are wider).
5. Tick the item in TODO.md, add DECISIONS.md rows for differences from the mock-up, commit (message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`), `git push`. Never push red; every failed CI run emails the owner.
6. Never: open or merge PRs, edit CLAUDE.md or HISTORY.md, use PowerShell Get-Content/Set-Content on files (they mangle UTF-8; use Edit/Write).
7. If usage runs out: write what's done and the next step to the scratchpad progress note named in the brief, and leave unfinished work uncommitted.

Report in under 15 lines: commits, test results, differences from the mock-up, open questions for the owner.
