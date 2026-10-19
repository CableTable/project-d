# Project D: how a session runs (lead + claude2)

Rakshith's setup, 2026-10-19. The lead is the Claude Code session he opens (Opus, main account).
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

## The loop for one TODO item

1. **Pick:** the next unticked item in TODO.md "Rakshith's list" (Haiku lookup), or what he names.
2. **Mock-up** (any new UI): builder writes 2–3 options as `.dc.html` artboards in `mockups/_design/project/`
   (format spec: `mockups/_design/ref/`; copy the latest R-board). Lead reads them, adds them to
   `canvas.json` (a Round title note + a sticky with pros / cons / open questions per board) and publishes
   to the **"Project D Mockups"** canvas: https://claude.ai/artifact/QgsKW8CrQbt4rURJeY9sSD.
   Mock-ups are never committed. He picks an option; the lead answers open questions with a recommendation.
3. **Build:** a fresh builder session with a brief (spec = the chosen artboard, decisions for DECISIONS.md,
   tests, screenshots light + dark, tick TODO.md, commit + push, don't stage `mockups/`). Keep its `session_id`.
4. **Review:** a reviewer session on the build's commits (ranked findings, "ship as is" / "fix first").
5. **Fix:** findings go back to the builder's session (`--resume <session_id>`), full tests re-run.
6. **As built:** an AB board in the canvas when the build differs from the mock-up.
7. **Ship:** one PR per session; merge on a green run for the head commit (his OK per PR). CI publishes the exe.
8. **PC test** (when he asks, after a merge): PC tester on the released exe; findings become TODO items.

Two claude2 sessions may run at once only on separate files (e.g. a mock-up while a build runs).

## Commands (Git Bash, from the repo folder)

Write the brief to a file and pass it on **stdin** (a quoted `-p "$(cat …)"` arrived empty once).

```bash
C2=/c/Users/raksh/.local/bin/claude2.cmd
ALLOW='--allowedTools Bash(echo:*) Bash(tee:*) Bash(npx.cmd:*) PowerShell(Select-String:*) PowerShell(Select-Object:*) PowerShell(Write-Output:*)'

# Builder (Sonnet, high)
$C2 -p --model claude-sonnet-5-5 --effort high --permission-mode acceptEdits \
  --disallowedTools "Bash(gh pr merge:*)" "PowerShell(gh pr merge:*)" "Agent" $ALLOW \
  --output-format json < brief.txt > run.json

# Follow-up / fixes in the same builder session
$C2 -p --resume <session_id> ...same flags... < fix.txt

# Reviewer (Opus, medium, read-only)
$C2 -p --model claude-opus-5-5 --effort medium --permission-mode acceptEdits \
  --disallowedTools Edit Write NotebookEdit Agent "Bash(git commit:*)" "Bash(git push:*)" "Bash(git add:*)" "Bash(git checkout:*)" "Bash(git stash:*)" \
  --output-format json < review.txt > rev.json

# Lookup (Haiku)
$C2 -p --model claude-haiku-5-5 --permission-mode acceptEdits --output-format text < question.txt
```

Run long ones in the background; print only `result`, `session_id`, `total_cost_usd` and
`permission_denials` from the JSON. He can watch or take over any run: `claude2 --resume <session_id>`.

## Every brief says

- "You ARE the claude2 builder / reviewer: do the work yourself, never launch claude2 or Agent subagents."
  (Without it, claude2 reads CLAUDE.md's builder rule and tries to start claude2 itself.)
- Use ponytail lite; plain commands, no `cd … &&`, no `$?` tricks; a refused command is reported, not worked around.
- Branch name, the spec file, which files it may touch, what not to stage, what to reply (max N lines).
- Builders: tests (`npm.cmd test`, `npm.cmd run test:browser`) must pass; screenshots light + dark into `shots/`.
- Reviewers: verified findings only, "severity · file:line · problem · fix", then "ship as is" or "fix first".

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
