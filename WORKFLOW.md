# Project D: how a session runs (lead + claude2)

Rakshith's setup, 2026-10-19. Names (his ask, so "claude" / "claude2" stop being confusing):
**Rook** is the lead, **Bishop** is everything on the 2nd account (`claude2`), **Pawn** is the research agent (Antigravity, picked its own name). Use them when talking to him.
The lead (Rook) is the Claude Code session he opens (Opus, main account).
All real work runs on **claude2**: Claude Code on his 2nd account
(`C:\Users\raksh\.local\bin\claude2.cmd`), so the main account's limit is spent only on planning,
briefs, reading short reports and merging.

## Who does what

| Role | Runs on | Model, effort | Does |
|---|---|---|---|
| Lead | main account (this session) | Opus | Plans, picks TODO items, writes briefs, reads reports (never whole diffs, logs or files), publishes mock-ups, merges. |
| Lookup | claude2 | Haiku | Broad surveys across many files. Small lookups (one grep, one file section, one web page) Rook does itself (his OK, 2026-10-24). Replies in a few lines. |
| Builder (**Knight**) | Codex CLI (his ChatGPT Go plan) | gpt-6.1-sol, high | THE builder (his call, 2026-10-26, replaces 2026-10-22's lower-usage rule): features and fixes, code, tests, commit. Rook pushes (no git credentials in its sandbox). |
| Builder (**King**) | claude3 (3rd account, `claude3.cmd`) | Sonnet, high | His call 2026-10-28: builds only (fresh session per build, worktree `Project D extras/ProjectD-king`, same command as Bishop-build with `claude3.cmd`), and leads in Castle mode. A clone of Rook: same CLAUDE.md, WORKFLOW.md, plugins and the **same memory folder** (junctions from `~/.claude-account3/projects/*/memory` to Rook's), so a memory either writes the other reads. Builds go to Knight and King only: King 2 runs at once (folders `ProjectD-king`, `ProjectD-king2`), Knight 1 (his call 2026-10-28); Bishop builds no more. |
| Builder (Bishop) | claude2 | Sonnet, high | Mock-ups and screenshots (light + dark) only. **No builds since 2026-10-28** (his call: King builds instead). |
| Reviewer | claude2 | **Opus, medium** | Reviews every build's commits, read-only. Findings go back to the builder. |
| PC tester | claude2 | Sonnet, high | Downloads the released exe and drives it (WebView2 debug port + Playwright), reports what broke. |
| Fallback | claude2 | Opus, high | Only when Sonnet has failed at a build. |
| Research (**Knight**) | Codex CLI (his ChatGPT Go plan) | gpt-6-luna | **Default for web research**, big or small. **Never reviews** (his call, 2026-10-20: in a blind test on TODO 39 it missed both bugs Bishop-review found); read-only sandbox, live web search. Runs in `~/codex-research`, never the repo. |
| Quick lookup (**Pawn**) | Antigravity CLI (`agy`, his Google account, free) | Gemini 3.8 Flash | Web research (specs, libraries, how other apps do X), so Bishop's limits go to builds. Runs in `~/agy-research`, never the repo. |

## The loop for one TODO item

1. **Pick:** the next unticked item in TODO.md "Rakshith's list" (Haiku lookup), or what he names.
2. **Mock-up** (only when he asks for one; otherwise Rook decides the UI and records it in DECISIONS.md, his call 2026-10-20): builder writes 2–3 options as `.dc.html` artboards in `mockups/_design/project/`
   (format spec: `mockups/_design/ref/`; copy the latest R-board). Lead reads them, adds them to
   `canvas.json` (a Round title note + a sticky with pros / cons / open questions per board) and publishes
   to the **"Project D Mockups"** canvas: https://claude.ai/artifact/QgsKW8CrQbt4rURJeY9sSD.
   Mock-ups are never committed. He picks an option; the lead answers open questions with a recommendation.
3. **Build:** a fresh builder session with a brief (spec = the chosen artboard, decisions for DECISIONS.md,
   tests, screenshots light + dark, tick TODO.md, commit + push, don't stage `mockups/`). Keep its `session_id`.
4. **Review:** a Bishop-review session on the build's commits (ranked findings, "ship as is" / "fix first").
5. **Fix:** findings go to a fresh builder session (short brief: findings + commit range), full tests re-run.
6. **As built:** every UI build gets an AB board (mockups/R<n>_AB_*.html, local), drawn from the screenshots (his call, 2026-10-20).
7. **Ship:** one PR per session; merge on a green run for the head commit (his OK per PR). CI publishes the exe.
8. **PC test** (when he asks, after a merge): PC tester on the released exe; findings become TODO items.
   Bishop-test downloads the release into `shots/exe/`, starts it with `WEBVIEW2_USER_DATA_FOLDER` (an isolated profile:
   never his real library or recovery copies) and `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9233`,
   and drives it with Playwright `connectOverCDP`. Native Windows dialogs (Open, Save As, the close prompt) are driven
   with UI Automation from PowerShell, by window title (never SendKeys: keys go to whatever window has focus): the helper
   is `shots/exe/uia.ps1` (list / fg / front / dialog / close; local, not committed), run as
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File shots/exe/uia.ps1 …` (TODO 60 test, 2026-10-20: all passed).
   His call (2026-10-20): Bishop controls these pop-ups itself. He doesn't use the PC during the test and minimizes the
   other windows; before any key press Bishop brings the Project D window to the front and checks the foreground window's
   title, and stops if it isn't Project D or its dialog.
   Allow it: `Bash(gh release:*)`, `PowerShell(Stop-Process:*)`, `PowerShell(Get-Process:*)`, `Bash(tasklist:*)`, `Bash(powershell.exe -NoProfile -ExecutionPolicy Bypass -File shots/exe/uia.ps1:*)`.

**One check per real failure** (his call, 2026-10-20, from the AI-coding forums research): when a worker breaks a rule
or a tool fails silently, the fix round also adds ONE small check for exactly that case (a hook, a script line or a
test), and HISTORY.md names it. No big hook collections. First one: the PS 5.1 quote-stripping bug in
usage-agent-install.ps1.
**From Matt Pocock's workflow** (his picks 2026-10-20; plugin `mattpocock-skills@mattpocock` v1.3.1 on both accounts):
1. **Grill before building, always on** (his call 2026-10-20; every size since 2026-10-22): before every TODO item and
   ticket (S, M or L), and any plan or design he brings,
   Rook runs `grill-with-docs` the way it is built: the Skill tool for `grilling` (rounds of numbered questions, each with
   Rook's recommended answer, `---` between them, until every choice is settled) and for `domain-modeling` (terms go
   into GLOSSARY.md; decisions go into DECISIONS.md rows, our ADRs). S items too: a short round is fine. Bishop-support grills before adding a ticket. (grill-me / grill-with-docs are
   user-only commands, so Rook calls the two skills they wrap; he can still type /grill-me or /grill-with-docs.)
   **The skill is loaded at session start** (his call, 2026-10-22): Rook's (and Bishop-lead's) first action in a
   session is the Skill tool for `grilling` AND `domain-modeling` (both, always together; his call, 2026-10-24), before
   any other work, and every grill round after that uses them; never questions written without them.
   **Facts first, one round at a time** (his call, 2026-10-24): every code or fact lookup a round needs finishes
   before the round is asked. Never ask a round and then replace it when a lookup comes back: two sets of questions confuse.
   **AutoCAD check** (his call, 2026-10-27): before grilling any AutoCAD-style feature (commands, prompts, keys, snaps,
   selection, dimensions), Pawn reads Autodesk's own help (help.autodesk.com) on how AutoCAD does it, and the round's
   recommendations follow AutoCAD unless he decided otherwise; where ours differs, say which way is better and why (his ask 2026-10-27). Not settled by the docs: a short AutoLISP / script check
   he runs in his AutoCAD (licence allows; he pastes the result), then, if still open, watch it in his installed AutoCAD
   with computer use (Claude desktop app only; from the CLI, ask him to run that step there). Never reverse-engineer
   AutoCAD's binaries (e.g. REA): Autodesk's licence forbids it.
   From the CLI (works, 2026-10-27, AutoCAD 2027 on his PC when it is open): PowerShell COM
   `[Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application')` reads system variables; `Documents.Add()` gives a
   scratch drawing (never his open work); WScript.Shell SendKeys types into it; LOGFILEON / LOGFILEOFF writes the command line
   to `%LOCALAPPDATA%AutodeskAutoCAD 2027R26.0enu<drawing>.log`: read the log, not COM busy states (unreliable).
   Aliases: his `%APPDATA%AutodeskAutoCAD 2027R26.0enuSupportcad.pgp`.
   **Bishop-acad runs these checks, not Rook** (his call 2026-10-28, to save Rook's usage): Rook writes the questions
   (what to try, which prompts / keys / screenshots), then from `Project D extras/runs<N>`:
   `claude2.cmd -p --model claude-sonnet-5-5 --effort high --permission-mode dontAsk --max-budget-usd 4 --output-format text --add-dir "E:/Project B/Claude/Project D extras" --allowedTools PowerShell Read Write Glob Grep "WebFetch(domain:help.autodesk.com)" --disallowedTools Agent < acad<item>.txt > acad<item>.out`.
   The brief always says: one AutoCAD session at a time; only new scratch drawings (`Documents.Add()`), never his open
   drawings, close scratch ones without saving; wrap SendCommand in Start-Job with a timeout (it blocks while a prompt
   waits; Esc via SendKeys frees it); zoom before picking (off-screen picks are ignored); PrintWindow the AutoCAD window
   only (never the whole screen), CopyFromScreen around the cursor only for Dynamic input tooltips; save facts to
   `Project D extras/acad-<topic>.txt` (+ PNGs), add a line to `Project D extras/acad-facts.md` (the index; read it first, never retest a fact in it), and reply in at most 10 lines. Rook reads the reply, not the PNGs.
2. **Reviews per build, sized** (his call 2026-10-21): review A = spec fidelity + bugs (Opus medium); review B = code
   standards (`ponytail:ponytail-review`, Sonnet high). S items: A only. M items: A + B. L items and anything touching
   security (keys, Firebase rules, file access, credentials): A + B, both on Opus. Separate fresh sessions in parallel,
   each in its own folder (ProjectD-review, or ProjectD-fixC when free).
3. **PR body in the `pr` skill's shape**: a summary visual (file tree / call tree / diff), before / after evidence
   (tests, screenshots), and a merge-danger call: one-way or two-way door, plus blast radius.
4. **Retro at session end** (three runs, all on Bishop, his call 2026-10-28): before the merge, a Bishop run of the
   `retro` skill over the session's commits, briefs and run reports; a King retro (`runs<N>/retro<N>king.txt`, same
   skill, over King's `king-*.jsonl` runs: permissions, wasted tokens, navigation, brief gaps); and a Rook retro
   (`runs<N>/retro<N>rook.txt`, over Rook's own transcript: wasted tokens, wrong claims, briefs that caused rework, rules
   broken). Each skips points the earlier ones made. All suggest changes to rules, checks, briefs (not code); he picks.
5. **Tickets sized for one fresh session** (his call 2026-10-20): every M / L TODO item is split into tickets
   (TODO "66a", "66b", …), each a vertical slice that one fresh builder run can finish with its context under
   **150k tokens** (the "smart zone"). A ticket names what it depends on. A run whose peak context passes 150k
   (`rook.mjs result` shows it) means the ticket was too big: split the rest further.
   A ticket is one tool family or one command, plus its save / reopen; a brief listing more than ~5 behaviours is two
   tickets (session 26 retro: every King build peaked 171k-216k). Builders make a WIP commit of each passing slice
   (said in the report's first line), so a cut-off run loses nothing.
**Rook's daily cap** (his call, 2026-10-20): Rook's week must last to the Sun 15:30 reset. This week (49% on Tue 21:45):
by the end of each IST day at most Tue 50, Wed 61, Thu 72, Fri 83, Sat 94 %. From next week: 14% × k by the end of day k
after the reset, like Bishop. At the cap Rook finishes the step it is on, says so in one line, and pauses until the next day.
**Usage gate** (his call, 2026-10-20): before every sub-agent launch, read the cached usage
(`node tools/rook.mjs usage --cached`, no prompts; the PC agent refreshes it hourly) and pick the worker with headroom,
wait for a reset, or pause the session. **Knight builds** (his call, 2026-10-26, replaces 2026-10-22's lower-usage rule): every build or fix
round goes to Knight. King-build (claude3) takes one when Knight is above 85% of its 5-hour limit (his call 2026-10-27, within Bishop's daily cap), at 100% weekly, or he says to
run it on Bishop. Knight busy (2 runs) is not a reason: the build waits in the queue.

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

# In a worktree or Knight's clone the git dir is elsewhere: add --add-dir "<repo>/.git" (or ProjectD-rowan-git) and
# --add-dir for the runs folder holding the brief, or every git commit is refused (2026-10-21, twice).
# Fixes: a FRESH builder session with a short brief (the findings + the commit range), not --resume
# (each resume re-sends the whole conversation: one builder reached $22 over 3 resumed jobs, 2026-10-19).
# --resume only to finish a run that was cut off mid-work (usage limit), then start fresh again.

# King-build (claude3, Sonnet high) in its worktree ProjectD-king (session 25 retro: this block was written nowhere).
# Its cwd is the worktree: one bare command per call, no `cd … &&`. Find code with Grep or `grep -n`, read with Read
# offset/limit, change it with Edit (`replace_all` for repeats); never awk / node -e with braces, sed -i, python
# heredocs or PowerShell script blocks. A throwaway script goes to a file with Write, then `node <file>`.
# Session 26 King retro: a throwaway script only READS repo files (every change goes through Edit); it lives in the
# worktree as tmp-*.mjs (gitignored), never in "Project D extras". Repo files are CRLF on disk: split on /\r?\n/.
# Where tests live: web/x.js -> x.test.mjs at the repo root; a ticket's browser step: grep "step('TODO <id>" in browser.test.mjs.
R="E:/Project B/Claude/Project D extras/runs<N>"; cd "E:/Project B/Claude/Project D extras/ProjectD-king"; unset FORCE_COLOR
/c/Users/raksh/.local/bin/claude3.cmd -p --strict-mcp-config --model claude-sonnet-5-5 --effort high --permission-mode acceptEdits --max-budget-usd 8 \
  --add-dir "E:/Project B/Claude/Project D/.git" --add-dir "E:/Project B/Claude/Project D extras" \
  --disallowedTools "Bash(gh pr merge:*)" "PowerShell(gh pr merge:*)" "Agent" "Bash(git push:*)" "Bash(taskkill:*)" "PowerShell(Stop-Process:*)" \
  --allowedTools "Bash(echo:*)" "Bash(tee:*)" "Bash(npx.cmd:*)" "Bash(npm.cmd:*)" "PowerShell(Select-String:*)" \
    "PowerShell(Select-Object:*)" "PowerShell(Write-Output:*)" "Bash(git add:*)" "Bash(git commit:*)" "Bash(git fetch:*)" \
    "Bash(git checkout:*)" "Bash(git switch:*)" "Bash(git cherry-pick:*)" "Bash(git rebase:*)" "Bash(git apply:*)" \
    "Bash(git check-ignore:*)" \
  --output-format stream-json --verbose < "$R/b<item>.txt" > "$R/king-<item>.jsonl" 2>&1
# The force-push and reset denies in .claude/settings.json stay.

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

# Research: Knight (Codex CLI, ChatGPT Go; set up 2026-10-20 with the non-admin sandbox). Read-only, live web search,
# its own empty folder; never in the repo, never --dangerously-bypass-approvals-and-sandbox. Answer lands in last.txt.
cd ~/codex-research && /c/Users/raksh/AppData/Roaming/npm/codex.cmd exec -p researcher --skip-git-repo-check \
  -o last.txt - < question.txt > run.log 2>&1
# Profiles (2026-10-20, Codex docs review, mockups/_design/codex-workflow.md): ~/.codex/researcher.config.toml
# (gpt-6-luna, read-only, live web search) and ~/.codex/builder.config.toml (gpt-6.1-sol, high, workspace-write,
# network on). The repo's AGENTS.md carries the build rules Codex reads on every run, so briefs skip them.
# Knight-build (2026-10-20): its own clone ProjectD-rowan, git folder ProjectD-rowan-git (Codex blocks any
# folder named .git, so the clone uses --separate-git-dir). Elevated sandbox (his one-time admin setup, 2026-10-20:
# `codex sandbox setup --elevated --current-user`); add the Playwright folder so Chromium starts. Never --dangerously-*.
# Before a build: git -C "../Project D extras/ProjectD-rowan" fetch, then switch -c <branch> <sha> (always a commit id, never
# FETCH_HEAD: it is per worktree and goes stale; session 26 retro). King's worktree shares the repo's objects: no fetch,
# `git switch -c <branch> <sha>`. Rook's full-suite script checks out by sha too. After: Rook pushes.
# Builders never start a server or end a process: browser.test.mjs starts and stops its own (taskkill would kill Rook's suites).
# If package-lock.json changed since its last build, Rook runs `npm.cmd ci` in ProjectD-rowan first (its sandbox cannot
# install: EPERM on the npm cache; session 12 lost a Knight round to a missing imagetracerjs).
# If Codex blocks Knight's commit ("COMMIT_EDITMSG: Permission denied"), the cause is a stale COMMIT_EDITMSG in the
# clone's -git folder with a lost sandbox grant (2026-10-23): Rook commits once, then deletes that file; Knight commits
# again from then on. Knight's TODO / DECISIONS / HISTORY edits
# conflict on cherry-pick into the repo: keep both sides.
# Side folders (2026-10-22): Knight's clones, their -git folders and the runs<N> log folders live in
# "E:/Project B/Claude/Project D extras/". Moving a clone: rewrite its hidden .git file and `core.worktree` in its -git.
# Bishop-build in a Knight clone (2026-10-23): claude2 blocks every node / git call until that folder is trusted
# once on account 2, so Bishop builds stay in ProjectD-s15fix unless he has trusted the clone.
# Parallel Knight builds (2026-10-21): extra clones ProjectD-knight2 (+ -git) and ProjectD-knight3 (+ -git), set up the
# same way. One branch per clone; cherry-pick each into the repo; TODO / DECISIONS conflicts: keep both sides, then drop
# duplicate TODO rows. Run two builds at once (King + Knight) only when their briefs touch different files; otherwise
# base the 2nd build on the 1st's commit (session 25: 69e and 69f both edited web/app.js and the cherry-pick conflicted).
# Every UI ticket touches web/app.js (session 26 retro): parallel builds only when one of them stays out of web/;
# otherwise the 2nd build starts from the 1st's commit, or waits.
# Knight says "Selected model is at capacity": wait 5 min, then a FRESH run with the brief plus the STATE line above
# (not `exec resume`, see above). Knight runs ponytail "full" too (%APPDATA%\ponytail\config.json), like every builder.
# Browser test inside the sandbox: `node browser.test.mjs <port>` (npm.cmd run test:browser exits 1 on npm's notice).
codex.cmd exec -p builder -C "E:/Project B/Claude/Project D extras/ProjectD-rowan" \
  --add-dir "E:/Project B/Claude/Project D extras/ProjectD-rowan-git" --add-dir "C:/Users/raksh/AppData/Local/ms-playwright" \
  -o r.txt - < brief.txt > r.log 2>&1
# Cut off by the 5-hour limit: after the reset, start a FRESH run with the brief plus "STATE: a previous run left
# uncommitted work; read git status and the diff, finish, test, commit". Not `exec resume`: it takes no -p / -C /
# --add-dir, so it cannot commit in a Knight clone (2026-10-24).
# Screenshots: a clone folder made outside Codex (e.g. ProjectD-rowan's old shots/) can lack the sandbox grants and
# refuse writes (EPERM); pass `--shots shots-k*` (a new folder in the clone root, in the clone -git info/exclude).
# Usage (headless): the newest ~/.codex/sessions/**/*.jsonl has "rate_limits": primary.used_percent over a
# 5-hour window and secondary over the week, resets_at in Unix time. Two S builds = ~6% of 5h, 1% of the week.

# Quick lookup: Pawn (Antigravity CLI). Reads https pages only (his settings.json allow rule), no shell,
# writes only in its own folder; never run it in the repo, never with --dangerously-skip-permissions.
cd ~/agy-research && "/c/Users/raksh/AppData/Local/agy/bin/agy.exe" -p "<question; max N lines; cite URLs>" --output-format json --print-timeout 10m
# Every Pawn brief says "open https links only, skip http ones, run no commands": one blocked action ends a headless run.
# Big research (many sources) goes to Bishop (Sonnet + WebSearch) instead; Pawn takes quick lookups only.
# (2026-10-19: two multi-page Pawn runs died on one blocked action each: a shell command, then a URL.)
# follow-up: --conversation <conversation_id>; its quota: /usage inside agy (interactive only; he pastes it)
# Two weekly pools: Gemini (Flash/Pro; ~1.5% per short question) and Claude/GPT (Sonnet 4.6, Opus 4.6, GPT-OSS).
# Default Gemini 3.8 Flash; hard questions or Gemini under 20%: --model claude-sonnet-4-6 until 2026-11-02.
# From 2026-11-02 Sonnet 4.6, Opus 4.6 and GPT-OSS leave Antigravity (Pawn, 2026-10-19); his plan (AI Plus; his "Pro" since 2026-10-20 is a reseller name, same AI quota as Plus)
# keeps Gemini only, so then: Flash default, a Gemini Pro slug for hard questions. Check `agy models` if a slug fails.
```

**claude2 usage** (`/usage` doesn't work headless; the stream's `rate_limit_event` has it, costs ~nothing on Haiku):

```bash
echo "Reply OK" | $C2 -p --model claude-haiku-5-5 --output-format stream-json --verbose | grep -m1 rate_limit_event
```

`unifiedWindows.five_hour.utilization` / `seven_day.utilization` (0–1) and their `resetsAt` (Unix time; convert to IST).
The same line with `claude` instead of `$C2` gives the main account's usage. Report both.
Check it before starting big work and after each run. No usage report after a merge: the pd-band line and the usage page show it (his call, 2026-10-21; replaces the 2026-10-20 rule).
**Bishop's daily budget** (his rule, 2026-10-20): at most 14% of the weekly limit per day, so the week lasts 7 days. The week
resets Mon 15:30 IST; by the end of day k (reset + k×24 h) Bishop's weekly use may be at most 14% × k (unused budget carries
over). Check before each Bishop run; a run that would cross today's cap waits. Going above needs his OK, each time. Above ~0.85 of the 5-hour window, don't start a new
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
read + cache write + output from the final `result.usage`; new = input + cache write + output. Knight: the
"tokens used" line in its run.log. The `--max-budget-usd` caps stay as a safety stop; limits stay in %.

## Keeping Rook small (his rule, 2026-10-20: Rook was on pace to hit its weekly limit by Friday)

- **Session end (his call, 2026-10-20).** Rook decides when a session is big enough to end, runs the **retro** first (rule 4: Bishop, the `retro` skill; he picks which suggestions to apply), and once CI is green for the
  head commit asks his OK to merge. On his yes, and only once `runs<N>/retro.out` exists (session 25 retro): `gh pr merge <n> --merge --match-head-commit <sha>`, check it merged
  (ccd_pr get_status, or the PR's GitHub merge notice), press "Update now" on the usage page if he wants it fresh, then start the next Rook session itself
  (`start_session`, fresh, this same folder, the template below filled in: branch, next items, open questions) instead
  of handing him a prompt. No scheduled or polled CI checks.
  **CI monitor** (his call, 2026-10-21): right after opening the session PR, bind it (ccd_pr `get_status` / `bind_pr`) and turn
  on its CI monitor (`set_monitor`); on green with his merge OK, merge at once; on red, send the failing step to a Bishop fix round. Every Rook turn re-reads the whole conversation, so a
  long one costs the most.
  **Watching a CI run** (2026-10-27): a Monitor with the command `bash tools/ci-watch.sh <sha>` (one per pushed commit, timeout 30 min,
  re-arm on expiry). It prints each finished job and ends with `RUN <id> success|failure`. Never pipe to `jq`: it is not installed
  here, so such a watch stays silent forever (two silent monitors on PR #25); use gh's own `--jq`.
- **Context limit 250k** (his call, 2026-10-21): `autoCompactWindow: 250000` in his ~/.claude/settings.json compacts Rook
  automatically there. If it ever doesn't fire, Rook finishes its step at ~250k and asks him to type `/compact`.
- **Bishop-support** (his call, 2026-10-21): an interactive claude2 (Sonnet) in a Terminal tab answers his questions while he
  uses the app and adds tickets (T1, T2, …) to `E:/Project B/Claude/support/tickets.md` (local, never on GitHub; prompt:
  `support/pip-support-prompt.md`). Rook moves `open` tickets into TODO.md at each session start and keeps each ticket's
  Status current (in TODO → building → built → merged → checked in exe); Bishop-support never edits the repo.
- **One call per step, short output:** `node tools/rook.mjs usage` (3 lines; refreshes `mockups/_design/usage/`) and
  `node tools/rook.mjs result <run file>` (the reply + tokens). Write a brief and launch it in the same call.
- Rook never opens screenshots or images (Bishop-look reports in lines), never runs the test suites (the review does),
  never reads skill or reference docs it has read before in the session.
- While runs go, Rook ends its turn and waits for the notice; no status messages in between.
- The usage page is https://project-d-usage.web.app (Firebase, his Google account only; session 12). The PC agent
  (tools/usage-agent.mjs, Startup shortcut) refreshes it hourly and on its "Update now" button, so Rook uploads nothing.
  Rules / page changes deploy with `GOOGLE_APPLICATION_CREDENTIALS=%APPDATA%\ProjectD\firebase-key.json npx.cmd
  firebase-tools@15.30.2 deploy --only hosting,firestore:rules --project project-d-usage` (usage-site/, his OK per deploy).
  The old claude.ai usage artifact is retired.

## Castle mode (his call, 2026-10-21; King leads since 2026-10-28)

**Since 2026-10-28 King (claude3) is the lead in this mode, not Bishop-lead:** read "Bishop-lead" below as King-lead,
`claude2.cmd` as `claude3.cmd`, and `handover-pip.md` as `handover-king.md`. King shares Rook's memory, so it may take M / L items
too. Bishop still reviews every build.

For when Rook (main account) runs short of usage: Bishop leads and reviews, Knight builds, Rook only helps.

- **Switch on:** when Rook reaches its daily cap or a 5-hour limit is close, or when he says "Castle". Rook writes a
  hand-over (branch, PR, the item in hand, next items, open questions) to `side-session-notes/handover-pip.md`, then
  opens Bishop-lead itself, the way a new Rook session is opened, but on account 2 through the CLI, with Remote Control
  so he can reach it from his phone:
  `start "Bishop-lead" cmd /k "C:\Users\raksh\.local\bin\claude2.cmd" --rc --model opus "<the Bishop-lead prompt below>"`
  (run from the repo folder; he uses claude.ai/code signed in to account 2 to see it).
- **Bishop-lead** (Opus, account 2, interactive): does Rook's job from WORKFLOW.md: plans, briefs, the usage gate, TODO /
  DECISIONS / tickets, CI, the PR body. **Knight builds everything**; no Bishop-build runs in this mode.
- **Reviews:** every Knight build still gets a Bishop-review (headless, own throwaway worktree) launched by Bishop-lead.
- **Merging:** Bishop-lead merges on green with his OK, same rule as Rook:
  `gh pr merge <n> --merge --match-head-commit <sha>`. Builders and reviewers still never merge.
- **Small items only:** Bishop-lead takes only S TODO items and tickets (one Knight build each, grilled first like every item). M / L items and
  plans wait for Rook; if only M / L items are left, Bishop-lead says so and pauses.
- **Bishop's budget:** 20% of the weekly limit per day while the mode is on (14% otherwise).
- **Rook:** only small things: reviewing S items, one-line answers, a CI check. No plans, no builds, no M/L reviews.
- **Switch back:** when he says "hand over back to Rook". Bishop-lead writes `side-session-notes/handover-rook.md` the
  same way and opens Rook through the CLI:
  `start "Rook" cmd /k claude --rc --model opus "<the starting prompt below, plus: read handover-rook.md first>"`
  then stops.

**Bishop-lead prompt:**

> Project D, Castle mode (Rook low on usage). You are Bishop-lead, the lead on account 2 (Opus): read CLAUDE.md, WORKFLOW.md (its
> "Castle mode" part wins over the rest) and side-session-notes/handover-pip.md, and follow them. Your first action:
> load the `grilling` and `domain-modeling` skills (Skill tool) and grill me on every item before its brief. Knight builds
> only S TODO items and tickets (M / L wait for Rook); you brief Knight, launch a Bishop-review (headless claude2, own worktree) for every build, and keep the
> usage gate (Bishop up to 20% of the week a day). Stay on the branch and PR in the hand-over. Merge on green only with
> my OK. Rook (main account) helps only with small reviews or questions. When I say "hand over back to Rook",
> write the hand-over and open Rook as WORKFLOW.md says. Times in IST, keep answers short, repeat any question in
> plain text.

## Every brief says

- **Report shape** (his OK, 2026-10-25): every report (build, fix, review, test, lookup) has the same 4 parts, a few lines each: **Result** (done / not done, commit id), **Tests** (what ran, pass / fail), **Findings** (or "none"), **Not checked**.
- "You ARE the claude2 builder / reviewer: do the work yourself, never launch claude2 or Agent subagents."
  (Without it, claude2 reads CLAUDE.md's builder rule and tries to start claude2 itself.)
- Builders use ponytail full (the default level; his call 2026-10-21, was lite); plain commands, no `cd … &&`, no `$?` tricks; a refused command is reported, not worked around.
- Branch name, the spec file, which files it may touch, what not to stage, what to reply (max N lines).
- Builders: `npm.cmd test`, their own new / changed browser steps while working (`node browser.test.mjs <port> '<step names>'`), then once before commit the full suite `node tools/browser-parallel.mjs <port>` (pass / fail lines only; session 26 retro, his OK). A failing step they didn't touch: rerun it alone on the base; failing there too means it predates the build: note it and go on. Screenshots light + dark through their steps. **Rook still runs the full browser suite** (background script, pass / fail summary only) on the combined branch before every push; reviewers unit only (his call 2026-10-28, after builders' filtered runs missed 2 old steps and CI went red).
  Builders grep `browser.test.mjs` for every UI string they change (prompts, readouts like `R `) and add those steps to their `'<step names>'` filter.
  While fixing, filter on their own step only (`'TODO <id>'`); widen once, before commit, to whole step-name pieces they grepped, never single words like `Text` (session 26 King retro: 5 unrelated slow steps per run).
- **Fix briefs** (session 25 retro): each item names its source, a review finding number or an `acad-grill` item. Anything
  without a source is marked *Rook's idea*, and the brief says which behaviour must still work (e.g. Extension far past the end).
- Rook writes briefs to `runs<N>/b*.txt` with the Write tool, never a heredoc (one hung Rook in session 25).
- Knight-build: "commit on the branch, never push", and the browser test as `node browser.test.mjs <port>`. Screenshots go to Bishop-look.
- **Done when** (session 12 retro, his call 2026-10-21): DECISIONS row for each new decision, TODO ticked, new words in
  GLOSSARY.md, a browser step for a new flow, screenshots light + dark, `npm.cmd test` green, one commit. Review A checks the same list.
  A new mode or command also gets browser checks for Esc mid-command, one Undo, and an edit to its source after it ran
  (session 26 retro: most High / Medium findings were in those paths).
- **Time limits:** the full browser suite runs in the background with a 25-min limit (it takes ~20 min); any run
  stops and reports at 60 min. A WIP commit of untested code says so in the report's first line.
- **Browser steps set their own theme** (light, then dark) at the start; never rely on the step before. Counts that
  grow with features (commands, menu items) are read from their table, not hard-coded.
- **Git access:** a builder outside the main folder gets `--add-dir` for the git dir (see the builder command) and
  `git add` / `git commit` in `--allowedTools`; a run whose first commit is refused stops and reports.
- Reviewers: `ponytail:ponytail-review` for a build's commits, `ponytail:ponytail-audit` for a whole-codebase pass; verified findings only, "severity · file:line · problem · fix", then "ship as is" or "fix first".

## Permissions

`.claude/settings.json` allows git, npm, npx, node, gh (view/list/checks), file edits; denies force-push
and `reset --hard`. Merging is blocked for claude2 on its command line. A refused command shows in
`permission_denials`: add it to the allowlist if it's safe. A new folder (a worktree) needs trusting once:
he runs `claude2` there and accepts.

## Starting prompt for a fresh lead session

> Project D session <N>. You are Rook, the lead (Opus, main account): read CLAUDE.md, then WORKFLOW.md, and
> follow them. Your first action: load the `grilling` and `domain-modeling` skills (Skill tool, mattpocock-skills:grilling and :domain-modeling) and grill me on
> every item before its brief. Keep main-account tokens minimal: Bishop (claude2) builds, reviews and looks things up; Knight
> researches; don't read whole files, diffs or logs yourself. Check Rook / Bishop / Knight usage first and keep Bishop
> under its daily budget (14% of the week a day). Make a new branch claude/session<N> from main. First:
> <items, or the next unticked items in TODO.md "Rakshith's list">. Bugs first. No mock-ups unless I ask: you
> decide the UI and record it in DECISIONS.md. Every build gets a Bishop-review in its own worktree; fixes go to a fresh
> Bishop-build. One PR for the session; merge on green only with my OK.
> Times in IST, keep answers short.
