# Rook HQ: how a session runs (all projects)

Source: `kit/hq/WORKFLOW.md` in the Project D repo, copied to `E:/Project B/Claude/rook-hq/WORKFLOW.md` by `node tools/rook.mjs hq-install` (TODO 219d). After the install Rook edits the HQ copy with Read + Edit like a brief; a code change to the install goes to King in `kit/hq/`.
This file holds what is true for every project. A project's own values are keys of its `rook.config.json` (`name`, `slug`, `extras`, `main`, `support`, `github`, `test`, `browserTest`, `docs.todo|decisions|history|glossary|workflow`, `folders.bishop|king|knight`) and the registry `hq.json` (`projects`, `runs`, `hq`, `runsFrom`); its own rules are in **the project's CLAUDE.md** and its own `docs.workflow` file. Any `node tools/rook.mjs <verb>` takes `--project <D|R|B|P|WF>` (default D). Where the project's file and this one disagree, the project's wins.
Names: **Rook** = the lead (Opus, main account, `claude`), **Bishop** = account 2 (`claude2`), **King** = account 3 (`claude3`), **Knight** = Codex CLI, **Pawn** = Antigravity (`agy`).
One Rook for all projects, one usage budget, one global session number `runs<N>` (from session 41 in `hq.hq`, before in `hq.runs`). Per touched project: one `claude/session<N>` branch and PR.

## Who does what

| Role | Runs on | Does |
|---|---|---|
| Lead (**Rook**) | main account | Plans, picks items, grills, writes briefs, reads short reports (never whole diffs, logs or files), cherry-picks, merges. Writes no code: new behaviour and review findings, however small, go to a builder. |
| Builder (**Knight**) | Codex, builder profile | Builds new items; commits, never pushes; Rook pushes. Never reviews. A ticket touching `kit/base-check*` goes to King (Knight's sandbox skips that test). |
| Builder (**King**) | `claude3`, Sonnet high | Builds when Knight is above 85% of its 5h limit or at 100% weekly; takes every small fix round; leads in Castle mode. Same CLAUDE.md, plugins and memory folder as Rook. Folders: `folders.king.build`, `folders.king.review`. |
| Reviewer | `claude2` (King when Bishop's folder is locked), Opus medium | Reviews every build's commits, read-only, in its own throwaway worktree (`folders.bishop.review`). |
| Other **Bishop** jobs | `claude2` | Mock-ups and screenshots (Sonnet), lookups (Haiku), retros, the project's tester and Bishop-support. Bishop never builds, merges or force-pushes. |
| Research | Knight (gpt-6-luna, read-only) / Pawn | Web research: big -> Knight, quick -> Pawn (https only, no commands, 3 pages, cite). Never run in a repo. |

Rook's own account runs builder / reviewer Agent subagents too (since 2026-11-04) only below 80% of its 5h limit, in a worktree.

## The loop for one item

1. **Pick** the next open item in `docs.todo` (or what he names). Bugs first.
2. **Grill** (always, every size): the Skill tool for `grilling` AND `domain-modeling` (Rook's first action of every session, both together); rounds of numbered questions each with Rook's recommended answer, `---` between them, written to `runs<N>/grill-<item>.md`. Facts first: finish every lookup, then ask ONE round, never replace one. Full control: Rook takes its recommended answers and goes on; he is told only of major changes (a big behaviour or UI change, a decision reversed, something lost, a merge to main, a blocker). Every "reuse X" answer names the file:function Rook grepped, else "unverified". Terms go to `docs.glossary`, decisions to `docs.decisions`.
3. **Fresh read** (an M / L item, or one resting on an invariant "X never Y"): `node tools/rook.mjs fresh <id> --as king` on the grill file -> `fresh-<id>.out` (max 8 lines); each line is folded into the brief or the grill, `fresh <n> -> Q<x> | brief line <y> | not needed: <why>`.
4. **Build:** a fresh builder session with a brief (below). `node tools/rook.mjs build ...` (King / Bishop) or `knight ...`.
5. **Review:** `--review` on the launch chains it; sized: S = spec + bugs (Opus medium), M = + code standards (`ponytail:ponytail-review`), L or security-touching = both on Opus. Findings go back to a fresh builder.
6. **Fix:** a short brief (findings + commit range), a fresh session, never `--resume` (a cut-off run only). A fix that fixes a High, resolves conflicts or is partly done gets a re-review before the suite; its subject ends "(High)", Rook writes `runs<N>/rereview-<sha7>.txt`. A 2nd fix round that finds a new caller / class stops the chain: re-grill the root cause (`runs<N>/grill-<id>-regrill.md`, one rule that closes the class) before round 3. More than 2 failed rounds: Opus high on King.
7. **Cherry-pick** the builder's commits onto the session branch (no pick while a suite runs), tick the row in `docs.todo` (every row of the ticket), commit, push once per handover. Write "ticked" only after that commit.
8. **Ship:** `node tools/rook.mjs suite <sha>` (HEAD), `wait` on its log; one PR per session number, merged once, on a green run for the head commit.

Tickets: every M / L item is split into vertical slices one fresh run finishes under 150k context (`result` prints the peak); about 5 behaviours at most per ticket; a ticket names what it depends on. Tool tickets (`--tool`) are not counted as items. A tool ticket names at most 10 files. A move of files out of a repo: the grill asks first "who edits them after the move".

## Commands (Git Bash, from the project's repo folder)

### Rook card
- A state claim to him (fixed, ticked, flaky, who ran it, why I hand over) names its proof in the same line: output line, sha or file:line; none in hand: "unchecked". A run report names the account.
- Usage gate (before every launch): `node tools/rook.mjs usage --cached`; pick the worker with headroom, wait for a reset or pause. Rook's own week: 14% x k by the end of IST day k from the Sunday 15:30 reset; at the cap finish the step, say so in one line, pause till the next day. Bishop 14% a day (20% in Castle mode).
- Launch: `node tools/rook.mjs build <brief> <out.jsonl> <branch> <sha> [--as king|bishop] [--no-fresh] [--fix] [--regrilled] [--tool] [--over] [--big] [--review <review brief> <review out.jsonl>]`, `node tools/rook.mjs knight <brief> <report.txt> <branch> <sha> [same flags]`, `node tools/rook.mjs review <sha> <brief> <out.jsonl> [--as king|bishop] [--from <clone> <branch>]`. Branch always new: `king/<id>`, `king/<id>fix`, never `claude/session<N>`. The launch refuses: an existing branch, a path not written `../runs<N>/`, over 5 numbered Do lines, a bare runs path, a handover-due count (below), a missing grill / fresh file.
- Run ended: `node tools/rook.mjs result <run file>` (report, denials, peak context), on the done file only. `node tools/rook.mjs fails <log>` for a red log. `node tools/rook.mjs gate` rewrites queue.txt line 2.
- Wait: `node tools/rook.mjs wait <run file>... [--ci <sha>]` as a Monitor (ToolSearch `select:Monitor,TaskStop` first), never in the foreground; arm it, then end the turn. CI of a push: Monitor `bash tools/ci-watch.sh <sha>` on the head sha, one per push. A CI red step added in this PR is a bug (write the fix brief now); a flake only for a step older than the PR. `gh ... --jq` runs in Bash only. Repo for gh: `node tools/rook.mjs repo`.
- Board / look: `node tools/rook.mjs board <brief> <out>`. Pawn: `node tools/rook.mjs pawn <out.json> "<one question>"`. Acad (the project's own app checks): `node tools/rook.mjs acad <item>`.
- Retro: `node tools/rook.mjs retro` when the session's last item is cherry-picked (by 01:00 IST: Bishop needs 5h room; `--as king` when Bishop is short); at a handover `node tools/rook.mjs retro --handover` first. Read each `retro<N>*.out` whole, once, before any edit; apply what it recommends; write `retro<N>.applied`.
- 05:00 merge (`merge --due`) needs: CI green on the head, `retro<N>.out` not empty, `retro<N>.applied`, `merge-ok-until.txt` >= today. By hand: `node tools/rook.mjs merge <n> <sha>`.
- A turn ends with a waiter running or a question for him; a clear next step with nothing running is done in the same turn. While runs go, no status messages. Run ended, no major change: no text to him.
- Waiting on a reset: do grills and briefs first, start the timer last (a gap over 60 min re-caches the whole context).
- Change any file (brief, queue.txt, a doc) with Read + Edit, never `sed -i` or a heredoc, never a chain with a launch; git and launches go in their own command. Briefs go to a file with the Write tool and in on stdin.

Briefs start from `kit/briefs/<kind>.txt` (build, fix, review, retro, board).

### Every brief says
- **Report shape** (max N lines): Result (done / not done, commit id), Tests (what ran, pass / fail), Findings (or "none"), Not checked.
- "You ARE the builder / reviewer: do the work yourself, never launch claude2 or Agent subagents." Builders use ponytail full; plain commands, no `cd ... &&`; a refused command is reported, not worked around.
- Branch name (new), spec file, files it may touch, what not to stage, the base by commit ("from <sha>, contains <sha>"; never what is on a remote; after a cherry-pick the picked sha), paths into runs as `../runs<N>/`, `Tick`: TODO.md left alone (Rook ticks after the cherry-pick), commit on the branch, never push.
- Git verbs the builder may use: `add`, `commit`, `fetch`, `checkout`, `switch`, `cherry-pick`, `rebase`, `apply`; squash = `cherry-pick -n`.
- Tests: the project's `test` and the item's own new or changed steps; never the full suite (Rook runs it once per push on the combined head, in the background, after every review says ship).
- **Proof before "done":** a report claims only what a command run AFTER the last edit showed; each claim quotes that line; anything not run goes under Not checked. A tool that starts a process, task or window: one real start on a harmless target, quoted.
- **Fix briefs** name their source (a review finding number); anything else is marked *Rook's idea*, with the behaviour that must still work; each finding names its case grid and the fix adds ONE table-driven test over it. A new check (lint, guard, regex) is run over the real files first; the brief names must-refuse and must-pass lines from them. A function gaining a failure result: the brief lists every caller (`grep -n "<fn>("`). A brief asking for "every X" carries the grep Rook ran and its hit list.
- A bug or flake brief: the builder runs `mattpocock-skills:diagnosing-bugs` first and reproduces; the report says "reproduced" or "not reproduced: likely cause".
- Done when: the decision row, new words in the glossary, the tests, one commit; a new test prints FAIL on the base under `node tools/base-check.mjs <base-sha> <test-file>`.
- Time limits: any run stops and reports at 60 min; a WIP commit of untested code says so in the report's first line. A cut-off run: builders WIP-commit each passing slice; after the reset a FRESH run with the brief plus "STATE: a previous run left uncommitted work; read git status and the diff, finish, test, commit".
- Reports to him are in tokens (total and new), never dollars; limits in %.

## Handover and session end

- **Handover** at a clean break once ANY of: 2 items built and reviewed since this Rook started (fixes and tool tickets don't count; the launcher enforces it: the 3rd new item is refused, `--over` with his OK), context ~150k (auto-compact ~218k; limit 250k), he is shutting down, a usage reset is near. A merge alone is no reason.
- Steps: queue.txt current, every run still going named with its next step, the push made. Write `runs<N+1>/resume-rook.txt` from the template below, `node tools/rook.mjs retro --handover` (the handover refuses without it, or `--no-retro`), then `node tools/rook.mjs handover <resume> "Rook S<N>x"` (writes rook-next.txt into `hq.runs` and, from `runsFrom`, `hq.hq`) and `node tools/rook.mjs next` (starts `Rook.lnk`, waits for the new transcript; refused while rook-next.txt names this session). The Stop hook blocks a Rook that has not done it.
- `Rook.lnk` (Startup folder, made by `hq-install`) opens a Windows Terminal tab in `hq.hq` running `start-rook.ps1`, which reads rook-next.txt (line 1 uuid, 2 name, 3 resume file): transcript found -> `--resume`, else a fresh `--session-id` told to read the resume file. Rook's cwd is `hq.hq`, with `--add-dir` for every project in `hq.json` and the old runs folder.
- An older Rook (its uuid is no longer rook-next.txt line 1) that gets an order: tell / stop the current Rook, act, then rewrite the current Rook's resume State line.
- Call a run "building" only after this turn's `result` says so. A resume line naming a command, account or file number was run or grepped this session, or says "unchecked". Give him a handover time only as "after <named run> + CI".
- Tell him "works" only for what ran end to end; otherwise "built, tested with a stub" and name the untested link.

Resume template (keep the required startup and watcher lines; `next` and `handover` refuse without them):
```text
State: <branch, PR, commits, CI sha; each run still going and its next step>
Skills first: mattpocock-skills:grilling and mattpocock-skills:domain-modeling
Commands: `sed -n '/^### Rook card/,/^Briefs start/p' E:/Project B/Claude/rook-hq/WORKFLOW.md`.
Launched --big: <ids or none>
read the last line of <hq.runs>/merge-due.log first
Watchers: ToolSearch select:Monitor,TaskStop first. CI: one ci-watch per push, on its head sha.
Held Lows: runs<N>/lows.txt
```

- **Session end:** Rook decides when a session is big enough, launches the retro first (never inline), and once CI is green for the head asks his OK to merge (or the 05:00 task does within his OK window). `node tools/rook.mjs merge <n> <sha>` checks the retro file, `.applied`, that the sha is the PR head and CI success; prints `MERGED #<n> <sha>`. Every Rook start reads the last line of `merge-due.log`: no line dated today after 05:00 IST, or a refusal: tell him.
- **Retros:** a handover retro (King, outgoing Rook only) at every handover; at session end three (Bishop over commits and reports, King over King's runs, Rook over its transcript), each skipping what an earlier one said; they suggest changes to rules, checks and briefs, not code; a King `--tool` run applies the doc edits. Weekly plugin check: the first Rook session after the Sunday 15:30 reset, if `weekly-check.txt` is 7+ days old, update the mattpocock plugin on all three accounts and refresh the project's retro skill copy.
- **Probes:** a change to CI files, tools or a test helper gets a `workflow_dispatch` probe before the session branch. Until a probe confirms a cause, say "likely cause".
- **Bishop-support** (an interactive `claude2` tab): answers his questions and writes tickets (`T<n>`) to `<support>/tickets.md` with a Tags column D / B / P / R / WF (none = D); asks when the project is unclear and reads that project's CLAUDE.md. Rook order: D bugs and other projects' bugs first, then D non-bug tickets; another project's non-bug ticket only on "take T<n>". Rook moves `open` tickets into the project's `docs.todo` at session start and keeps each Status current.
- **Context:** Rook reads docs by section (`grep -n "^## "` first), never opens screenshots (Bishop-look reports in lines), keeps answers short; `autoCompactWindow: 250000` in settings.json.
- **His new rule:** grep every doc, agent and memory file for the old wording, change every hit, list the files in the reply.

## Castle mode (Rook short of usage)

King leads, Bishop reviews, Knight builds, Rook only small things. Switch on at Rook's daily cap, a close 5h limit, or "Castle": Rook writes `side-session-notes/handover-king.md` (branch, PR, item in hand, next items, open questions) and opens King-lead (`claude3.cmd --rc --model opus`) with a prompt to read the project's CLAUDE.md, this file's Castle part and the handover, grill first (both skills), take S items and tickets only (M / L wait for Rook), launch a review for every build, keep the usage gate, merge on green with his OK. Times in IST, short answers, questions repeated in text. Switch back on "hand over back to Rook": King-lead writes `handover-rook.md` and opens Rook through `Rook.lnk`, then stops.

## Permissions

The project's `.claude/settings.json` allows git, the project's test commands, node, gh (view / list / checks), file edits; denies force-push and `reset --hard`. Merging is blocked for headless runs. A refused command shows in `permission_denials`: add it to the allowlist if safe. Headless `dontAsk` runs cannot edit `.claude/settings.json` or `.claude/`: Rook applies those edits itself in its own commit after the cherry-pick. A new folder (a worktree) needs trusting once: he runs `claude2` / `claude3` there and accepts. Rook cannot register scheduled tasks (the classifier denies it): the grill writes the `!` line for him. Never put a key or password in a file; keys, certificates and billing stay his.
