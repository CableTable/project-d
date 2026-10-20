# Project D: how a session runs (lead + claude2)

Rakshith's setup, 2026-10-19. Names (his ask, so "claude" / "claude2" stop being confusing):
**Rook** is the lead, **Pip** is everything on the 2nd account (`claude2`), **Scout** is the research agent (Antigravity, picked its own name). Use them when talking to him.
The lead (Rook) is the Claude Code session he opens (Opus, main account).
All real work runs on **claude2**: Claude Code on his 2nd account
(`C:\Users\raksh\.local\bin\claude2.cmd`), so the main account's limit is spent only on planning,
briefs, reading short reports and merging.

## Who does what

| Role | Runs on | Model, effort | Does |
|---|---|---|---|
| Lead | main account (this session) | Opus | Plans, picks TODO items, writes briefs, reads reports (never whole diffs, logs or files), publishes mock-ups, merges. |
| Lookup | claude2 | Haiku | Reading TODO / code / logs / CI, quick questions. Replies in a few lines. |
| Builder (**Rowan**, default) | Codex CLI (his ChatGPT Go plan) | gpt-6.1-sol, high | **Default builder** (his call, 2026-10-20, after the 57 / 61 comparison): features and fixes, code, tests, commit. Rook pushes (no git credentials in its sandbox). |
| Builder (Pip) | claude2 | Sonnet, high | Mock-ups and screenshots (light + dark), and builds when Rowan is out of limit or a second build runs at once: code, tests, commit, push. |
| Reviewer | claude2 | **Opus, medium** | Reviews every build's commits, read-only. Findings go back to the builder. |
| PC tester | claude2 | Sonnet, high | Downloads the released exe and drives it (WebView2 debug port + Playwright), reports what broke. |
| Fallback | claude2 | Opus, high | Only when Sonnet has failed at a build. |
| Research (**Rowan**) | Codex CLI (his ChatGPT Go plan) | gpt-6-luna | **Default for web research**, big or small. **Never reviews** (his call, 2026-10-20: in a blind test on TODO 39 it missed both bugs Pip-review found); read-only sandbox, live web search. Runs in `~/codex-research`, never the repo. |
| Quick lookup (**Scout**) | Antigravity CLI (`agy`, his Google account, free) | Gemini 3.8 Flash | Web research (specs, libraries, how other apps do X), so Pip's limits go to builds. Runs in `~/agy-research`, never the repo. |

## The loop for one TODO item

1. **Pick:** the next unticked item in TODO.md "Rakshith's list" (Haiku lookup), or what he names.
2. **Mock-up** (only when he asks for one; otherwise Rook decides the UI and records it in DECISIONS.md, his call 2026-10-20): builder writes 2–3 options as `.dc.html` artboards in `mockups/_design/project/`
   (format spec: `mockups/_design/ref/`; copy the latest R-board). Lead reads them, adds them to
   `canvas.json` (a Round title note + a sticky with pros / cons / open questions per board) and publishes
   to the **"Project D Mockups"** canvas: https://claude.ai/artifact/QgsKW8CrQbt4rURJeY9sSD.
   Mock-ups are never committed. He picks an option; the lead answers open questions with a recommendation.
3. **Build:** a fresh builder session with a brief (spec = the chosen artboard, decisions for DECISIONS.md,
   tests, screenshots light + dark, tick TODO.md, commit + push, don't stage `mockups/`). Keep its `session_id`.
4. **Review:** a Pip-review session on the build's commits (ranked findings, "ship as is" / "fix first").
5. **Fix:** findings go to a fresh builder session (short brief: findings + commit range), full tests re-run.
6. **As built:** every UI build gets an AB board (mockups/R<n>_AB_*.html, local), drawn from the screenshots (his call, 2026-10-20).
7. **Ship:** one PR per session; merge on a green run for the head commit (his OK per PR). CI publishes the exe.
8. **PC test** (when he asks, after a merge): PC tester on the released exe; findings become TODO items.
   Pip-test downloads the release into `shots/exe/`, starts it with `WEBVIEW2_USER_DATA_FOLDER` (an isolated profile:
   never his real library or recovery copies) and `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9233`,
   and drives it with Playwright `connectOverCDP`. Native Windows dialogs (Open, Save As, the close prompt) are driven
   with UI Automation from PowerShell, by window title (never SendKeys: keys go to whatever window has focus): the helper
   is `shots/exe/uia.ps1` (list / fg / front / dialog / close; local, not committed), run as
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File shots/exe/uia.ps1 …` (TODO 60 test, 2026-10-20: all passed).
   His call (2026-10-20): Pip controls these pop-ups itself. He doesn't use the PC during the test and minimizes the
   other windows; before any key press Pip brings the Project D window to the front and checks the foreground window's
   title, and stops if it isn't Project D or its dialog.
   Allow it: `Bash(gh release:*)`, `PowerShell(Stop-Process:*)`, `PowerShell(Get-Process:*)`, `Bash(tasklist:*)`, `Bash(powershell.exe -NoProfile -ExecutionPolicy Bypass -File shots/exe/uia.ps1:*)`.

**One check per real failure** (his call, 2026-10-20, from the AI-coding forums research): when a worker breaks a rule
or a tool fails silently, the fix round also adds ONE small check for exactly that case (a hook, a script line or a
test), and HISTORY.md names it. No big hook collections. First one: the PS 5.1 quote-stripping bug in
usage-agent-install.ps1.
**Usage gate** (his call, 2026-10-20): before every sub-agent launch, read the cached usage
(`node tools/rook.mjs usage --cached`, no prompts; the PC agent refreshes it hourly) and pick the worker with headroom,
wait for a reset, or pause the session.

Two claude2 sessions may run at once only on separate files (e.g. a mock-up while a build runs).

## Commands (Git Bash, from the repo folder)

Write the brief to a file and pass it on **stdin** (a quoted `-p "$(cat …)"` arrived empty once).

```bash
C2=/c/Users/raksh/.local/bin/claude2.cmd
ALLOW='--allowedTools Bash(echo:*) Bash(tee:*) Bash(npx.cmd:*) PowerShell(Select-String:*) PowerShell(Select-Object:*) PowerShell(Write-Output:*)'

# Background runs: stream-json (the file grows as it works; the last line holds result, session_id, cost).
OUT='--output-format stream-json --verbose'

# Builder (Sonnet, high), capped at $8 a run. The Stop hook (tools/stop-hook.mjs) won't let it finish
# with unpushed web/ changes while npm test is red.
$C2 -p --model claude-sonnet-5-5 --effort high --permission-mode acceptEdits --max-budget-usd 8 \
  --disallowedTools "Bash(gh pr merge:*)" "PowerShell(gh pr merge:*)" "Agent" $ALLOW $OUT < brief.txt > run.jsonl

# Fixes: a FRESH builder session with a short brief (the findings + the commit range), not --resume
# (each resume re-sends the whole conversation: one builder reached $22 over 3 resumed jobs, 2026-10-19).
# --resume only to finish a run that was cut off mid-work (usage limit), then start fresh again.

# Reviewer (Opus, medium, read-only): the reviewer agent (.claude/agents/reviewer.md: no Edit / Write tools)
# plus the git denies for Bash, capped at $6. It runs in its OWN throwaway worktree at the commit under review, so it can
# run the tests and time things without touching a builder's folder (2026-10-20, his call). Never add `git -C:*` to the
# allowlist: `git -C … commit/push` would slip past the commit and push denies.
WT="E:/Project B/Claude/ProjectD-review"; git worktree add --detach "$WT" <sha>; cd "$WT"; npm.cmd ci --silent  # once per review
$C2 -p --agent reviewer --model claude-opus-5-5 --effort medium --permission-mode dontAsk --max-budget-usd 6 \
  --disallowedTools Agent "Bash(git commit:*)" "Bash(git push:*)" "Bash(git add:*)" "Bash(git checkout:*)" "Bash(git switch:*)" "Bash(git stash:*)" "Bash(git restore:*)" "Bash(git pull:*)" \
  $OUT < review.txt > rev.jsonl
cd -; git worktree remove --force "$WT"                     # after the review
# A new worktree folder needs trusting once on account 2 (he runs claude2 there and accepts): reuse ProjectD-review.

# Lookup (Haiku)
$C2 -p --model claude-haiku-5-5 --permission-mode acceptEdits --output-format text < question.txt

# Research: Rowan (Codex CLI, ChatGPT Go; set up 2026-10-20 with the non-admin sandbox). Read-only, live web search,
# its own empty folder; never in the repo, never --dangerously-bypass-approvals-and-sandbox. Answer lands in last.txt.
cd ~/codex-research && /c/Users/raksh/AppData/Roaming/npm/codex.cmd exec -p researcher --skip-git-repo-check \
  -o last.txt - < question.txt > run.log 2>&1
# Profiles (2026-10-20, Codex docs review, mockups/_design/codex-workflow.md): ~/.codex/researcher.config.toml
# (gpt-6-luna, read-only, live web search) and ~/.codex/builder.config.toml (gpt-6.1-sol, high, workspace-write,
# network on). The repo's AGENTS.md carries the build rules Codex reads on every run, so briefs skip them.
# Rowan-build (default builder, 2026-10-20): its own clone ProjectD-rowan, git folder ProjectD-rowan-git (Codex blocks any
# folder named .git, so the clone uses --separate-git-dir). Elevated sandbox (his one-time admin setup, 2026-10-20:
# `codex sandbox setup --elevated --current-user`); add the Playwright folder so Chromium starts. Never --dangerously-*.
# Before a build: git -C ../ProjectD-rowan fetch, then switch -c <branch> origin/claude/session<N>. After: Rook pushes.
# If Codex blocks Rowan's commit, Rook commits in ProjectD-rowan itself. Rowan's TODO / DECISIONS / HISTORY edits
# conflict on cherry-pick into the repo: keep both sides.
# Browser test inside the sandbox: `node browser.test.mjs <port>` (npm.cmd run test:browser exits 1 on npm's notice).
codex.cmd exec -p builder -C "E:/Project B/Claude/ProjectD-rowan" \
  --add-dir "E:/Project B/Claude/ProjectD-rowan-git" --add-dir "C:/Users/raksh/AppData/Local/ms-playwright" \
  -o r.txt - < brief.txt > r.log 2>&1
# Cut off by the 5-hour limit: after the reset, `codex.cmd exec resume <session id> -` (id from r.log) with
# "continue: check git status and the diff, rerun the tests, finish". Fresh runs stay the rule for new work and fixes.
# Usage (headless): the newest ~/.codex/sessions/**/*.jsonl has "rate_limits": primary.used_percent over a
# 5-hour window and secondary over the week, resets_at in Unix time. Two S builds = ~6% of 5h, 1% of the week.

# Quick lookup: Scout (Antigravity CLI). Reads https pages only (his settings.json allow rule), no shell,
# writes only in its own folder; never run it in the repo, never with --dangerously-skip-permissions.
cd ~/agy-research && "/c/Users/raksh/AppData/Local/agy/bin/agy.exe" -p "<question; max N lines; cite URLs>" --output-format json --print-timeout 10m
# Every Scout brief says "open https links only, skip http ones": one blocked http page ends a headless run.
# Big research (many sources) goes to Pip (Sonnet + WebSearch) instead; Scout takes quick lookups only.
# (2026-10-19: two multi-page Scout runs died on one blocked action each: a shell command, then a URL.)
# follow-up: --conversation <conversation_id>; its quota: /usage inside agy (interactive only; he pastes it)
# Two weekly pools: Gemini (Flash/Pro; ~1.5% per short question) and Claude/GPT (Sonnet 4.6, Opus 4.6, GPT-OSS).
# Default Gemini 3.8 Flash; hard questions or Gemini under 20%: --model claude-sonnet-4-6 until 2026-11-02.
# From 2026-11-02 Sonnet 4.6, Opus 4.6 and GPT-OSS leave Antigravity (Scout, 2026-10-19); his plan (AI Plus)
# keeps Gemini only, so then: Flash default, a Gemini Pro slug for hard questions. Check `agy models` if a slug fails.
```

**claude2 usage** (`/usage` doesn't work headless; the stream's `rate_limit_event` has it, costs ~nothing on Haiku):

```bash
echo "Reply OK" | $C2 -p --model claude-haiku-5-5 --output-format stream-json --verbose | grep -m1 rate_limit_event
```

`unifiedWindows.five_hour.utilization` / `seven_day.utilization` (0–1) and their `resetsAt` (Unix time; convert to IST).
The same line with `claude` instead of `$C2` gives the main account's usage. Report both.
Check it before starting big work and after each run. **After every merge** (a branch into the session branch, or the PR
into main) report Rook, Pip (5-hour, weekly, resets in IST) and Rowan (month %) as a table, and add a row to
`mockups/_design/usage-log.md` (his rule, 2026-10-20).
**Pip's daily budget** (his rule, 2026-10-20): at most 14% of the weekly limit per day, so the week lasts 7 days. The week
resets Mon 15:30 IST; by the end of day k (reset + k×24 h) Pip's weekly use may be at most 14% × k (unused budget carries
over). Check before each Pip run; a run that would cross today's cap waits. Going above needs his OK, each time. Above ~0.85 of the 5-hour window, don't start a new
Opus run; let running builders finish (a builder cut off mid-work leaves uncommitted changes: resume it after the reset).

**Queuing runs** (2026-10-19: a queued job waited on its own output file and sat idle for hours):
- Jobs that must run one after another go in ONE background script, plainly in order (`run A; run B`), never as
  a second script that waits for the first one's file. Write each script fresh, never by `sed` on another script.
- Any wait loop has a time limit and prints what it waits for. Print the script (`head`) before launching it.
- Within ~2 minutes of a run's planned start, check that its output file exists. A `json` file stays empty until
  the run ends, so a background run uses `--output-format stream-json --verbose` (it grows as it works; the last
  line holds `result`, `session_id` and cost). An output file that doesn't exist is a bug, not progress.

Run long ones in the background; print only `result`, `session_id`, `usage` and
`permission_denials` from the JSON. He can watch or take over any run: `claude2 --resume <session_id>`.
**Report runs to him in tokens, never $** (his rule, 2026-10-20), e.g. "1.9M tokens (79k new)": total = input + cache
read + cache write + output from the final `result.usage`; new = input + cache write + output. Rowan: the
"tokens used" line in its run.log. The `--max-budget-usd` caps stay as a safety stop; limits stay in %.

## Keeping Rook small (his rule, 2026-10-20: Rook was on pace to hit its weekly limit by Friday)

- **Session end (his call, 2026-10-20).** Rook decides when a session is big enough to end, and once CI is green for the
  head commit asks his OK to merge. On his yes: `gh pr merge <n> --merge --match-head-commit <sha>`, check it merged
  (ccd_pr get_status, or the PR's GitHub merge notice), refresh the usage page, then start the next Rook session itself
  (`start_session`, fresh, this same folder, the template below filled in: branch, next items, open questions) instead
  of handing him a prompt. No scheduled or polled CI checks. Every Rook turn re-reads the whole conversation, so a
  long one costs the most.
- **One call per step, short output:** `node tools/rook.mjs usage` (3 lines; refreshes `mockups/_design/usage/`) and
  `node tools/rook.mjs result <run file>` (the reply + tokens). Write a brief and launch it in the same call.
- Rook never opens screenshots or images (Pip-look reports in lines), never runs the test suites (the review does),
  never reads skill or reference docs it has read before in the session.
- While runs go, Rook ends its turn and waits for the notice; no status messages in between.
- The usage page (https://claude.ai/artifact/1Qnf6QF3z3UyvCdcqiaWWf) is refreshed after merges only: upload the files
  in `mockups/_design/usage/`, then one ArtifactData batch with the new urls. In chat: one line plus the link.

## Every brief says

- "You ARE the claude2 builder / reviewer: do the work yourself, never launch claude2 or Agent subagents."
  (Without it, claude2 reads CLAUDE.md's builder rule and tries to start claude2 itself.)
- Use ponytail lite; plain commands, no `cd … &&`, no `$?` tricks; a refused command is reported, not worked around.
- Branch name, the spec file, which files it may touch, what not to stage, what to reply (max N lines).
- Builders: tests (`npm.cmd test`, `npm.cmd run test:browser`) must pass; screenshots light + dark into `shots/`.
- Rowan-build: "commit on the branch, never push", and the browser test as `node browser.test.mjs <port>`. Screenshots go to Pip-look.
- Reviewers: `ponytail:ponytail-review` for a build's commits, `ponytail:ponytail-audit` for a whole-codebase pass; verified findings only, "severity · file:line · problem · fix", then "ship as is" or "fix first".

## Permissions

`.claude/settings.json` allows git, npm, npx, node, gh (view/list/checks), file edits; denies force-push
and `reset --hard`. Merging is blocked for claude2 on its command line. A refused command shows in
`permission_denials`: add it to the allowlist if it's safe. A new folder (a worktree) needs trusting once:
he runs `claude2` there and accepts.

## Starting prompt for a fresh lead session

> Project D session <N>. You are Rook, the lead (Opus, main account): read CLAUDE.md, then WORKFLOW.md, and
> follow them. Keep main-account tokens minimal: Pip (claude2) builds, reviews and looks things up; Rowan
> researches; don't read whole files, diffs or logs yourself. Check Rook / Pip / Rowan usage first and keep Pip
> under its daily budget (14% of the week a day). Make a new branch claude/session<N> from main. First:
> <items, or the next unticked items in TODO.md "Rakshith's list">. Mock up new UI in the Project D Mockups
> canvas first and ask me to pick. Every build gets a Pip-review in its own worktree; fixes go to a fresh
> Pip-build. One PR for the session; merge on green only with my OK, and report usage after every merge.
> Times in IST, keep answers short.
