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
| Builder | claude2 | Sonnet, high | Mock-ups, features, fixes (even small ones): code, tests, screenshots, commit, push. |
| Reviewer | claude2 | **Opus, medium** | Reviews every build's commits, read-only. Findings go back to the builder. |
| PC tester | claude2 | Sonnet, high | Downloads the released exe and drives it (WebView2 debug port + Playwright), reports what broke. |
| Fallback | claude2 | Opus, high | Only when Sonnet has failed at a build. |
| Research (**Rowan**) | Codex CLI (his ChatGPT Go plan) | gpt-6-luna | **Default for web research**, big or small. **Research only, never reviews** (his call, 2026-10-20: in a blind test on TODO 39 it missed both bugs Pip-review found); read-only sandbox, live web search. Runs in `~/codex-research`, never the repo. |
| Quick lookup (**Scout**) | Antigravity CLI (`agy`, his Google account, free) | Gemini 3.8 Flash | Web research (specs, libraries, how other apps do X), so Pip's limits go to builds. Runs in `~/agy-research`, never the repo. |

## The loop for one TODO item

1. **Pick:** the next unticked item in TODO.md "Rakshith's list" (Haiku lookup), or what he names.
2. **Mock-up** (any new UI): builder writes 2–3 options as `.dc.html` artboards in `mockups/_design/project/`
   (format spec: `mockups/_design/ref/`; copy the latest R-board). Lead reads them, adds them to
   `canvas.json` (a Round title note + a sticky with pros / cons / open questions per board) and publishes
   to the **"Project D Mockups"** canvas: https://claude.ai/artifact/QgsKW8CrQbt4rURJeY9sSD.
   Mock-ups are never committed. He picks an option; the lead answers open questions with a recommendation.
3. **Build:** a fresh builder session with a brief (spec = the chosen artboard, decisions for DECISIONS.md,
   tests, screenshots light + dark, tick TODO.md, commit + push, don't stage `mockups/`). Keep its `session_id`.
4. **Review:** a Pip-review session on the build's commits (ranked findings, "ship as is" / "fix first").
5. **Fix:** findings go to a fresh builder session (short brief: findings + commit range), full tests re-run.
6. **As built:** an AB board in the canvas when the build differs from the mock-up.
7. **Ship:** one PR per session; merge on a green run for the head commit (his OK per PR). CI publishes the exe.
8. **PC test** (when he asks, after a merge): PC tester on the released exe; findings become TODO items.

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
cd ~/codex-research && /c/Users/raksh/AppData/Roaming/npm/codex.cmd exec -m gpt-6-luna --skip-git-repo-check -s read-only \
  -c web_search=\"live\" -o last.txt - < question.txt > run.log 2>&1
# Usage (headless): the newest ~/.codex/sessions/**/*.jsonl has "rate_limits": primary.used_percent over a
# 30-day window (Go plan), resets_at in Unix time. 2 test runs = 0.0%.

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
**Pip's daily budget** (his rule, 2026-10-20): at most 13% of the weekly limit per day, so the week lasts 7 days. The week
resets Mon 15:30 IST; by the end of day k (reset + k×24 h) Pip's weekly use may be at most 13% × k (unused budget carries
over). Check before each Pip run; a run that would cross today's cap waits. Going above needs his OK, each time. Above ~0.85 of the 5-hour window, don't start a new
Opus run; let running builders finish (a builder cut off mid-work leaves uncommitted changes: resume it after the reset).

**Queuing runs** (2026-10-19: a queued job waited on its own output file and sat idle for hours):
- Jobs that must run one after another go in ONE background script, plainly in order (`run A; run B`), never as
  a second script that waits for the first one's file. Write each script fresh, never by `sed` on another script.
- Any wait loop has a time limit and prints what it waits for. Print the script (`head`) before launching it.
- Within ~2 minutes of a run's planned start, check that its output file exists. A `json` file stays empty until
  the run ends, so a background run uses `--output-format stream-json --verbose` (it grows as it works; the last
  line holds `result`, `session_id` and cost). An output file that doesn't exist is a bug, not progress.

Run long ones in the background; print only `result`, `session_id`, `total_cost_usd` and
`permission_denials` from the JSON. He can watch or take over any run: `claude2 --resume <session_id>`.

## Every brief says

- "You ARE the claude2 builder / reviewer: do the work yourself, never launch claude2 or Agent subagents."
  (Without it, claude2 reads CLAUDE.md's builder rule and tries to start claude2 itself.)
- Use ponytail lite; plain commands, no `cd … &&`, no `$?` tricks; a refused command is reported, not worked around.
- Branch name, the spec file, which files it may touch, what not to stage, what to reply (max N lines).
- Builders: tests (`npm.cmd test`, `npm.cmd run test:browser`) must pass; screenshots light + dark into `shots/`.
- Reviewers: `ponytail:ponytail-review` for a build's commits, `ponytail:ponytail-audit` for a whole-codebase pass; verified findings only, "severity · file:line · problem · fix", then "ship as is" or "fix first".

## Permissions

`.claude/settings.json` allows git, npm, npx, node, gh (view/list/checks), file edits; denies force-push
and `reset --hard`. Merging is blocked for claude2 on its command line. A refused command shows in
`permission_denials`: add it to the allowlist if it's safe. A new folder (a worktree) needs trusting once:
he runs `claude2` there and accepts.

## Starting prompt for a fresh lead session

> Project D session. You are the lead (Opus, main account): read CLAUDE.md, then WORKFLOW.md, and follow
> them. Keep main-account tokens minimal: delegate everything to claude2 (Haiku lookups, Sonnet high
> builds, Opus medium reviews); don't read whole files, diffs or logs yourself. Make a new branch
> claude/session<N> from main. Pick the next unticked items from TODO.md "Rakshith's list" (or: <items>),
> mock up new UI in the Project D Mockups canvas first, and ask me to pick. One PR for the session;
> merge on green only with my OK. Times in IST, keep answers short.
