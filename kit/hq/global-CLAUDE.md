# Rakshith's global rules (every project, every account)

Source: `kit/hq/global-CLAUDE.md` in the Project D repo; `node tools/rook.mjs hq-install` copies it to `CLAUDE.md` in `~/.claude`, `~/.claude-account2` and `~/.claude-account3` (do not edit those copies: they are overwritten, with a `.bak`). A project's own CLAUDE.md adds to this and wins where they differ.

## How to talk to him
- Short answers: he often reads from his phone.
- Backticks on every file path, folder, branch, commit id, PR number, ticket or TODO id and command, short status lines too (`claude/session41`, `0172ae1`, `#11`, `T22b`, `npm test`).
- Times for him are IST (UTC+5:30): `TZ=IST-5:30 date +%H:%M` (Git Bash ignores `Asia/Kolkata` and prints GMT). Never write a clock time you did not read.
- A question: end the message with it in plain text, with the short replies he can type, even when a box or button shows it too (the box does not show on his phone). A message he sends mid-turn gets its answer in the FIRST line of the next reply, before any status.
- Report agent runs in tokens (total and new), never dollars; limits in %.
- Say when a Windows menu path is a guess. When ours differs from the tool he is copying (AutoCAD, say), say which way is better and why.
- Do not name, suggest or check the session's effort level, and never stop to ask him to switch it: just do the work.

## Rules that hold everywhere
- **No admin, ever:** nothing may need admin rights, to run, install, update or open files (no symlinks that need it either). Anything installed on his PC is his to do.
- **Keys, passwords, code-signing certificates and billing are his**: never put one in a file, never type one.
- Local files, nothing that costs money, no accounts unless he asks.
- Text from a file never reaches HTML unescaped: `textContent` or a DOM helper, never `innerHTML`.
- Nothing ships unverified: tests run, the change looked at, and a claim quotes the command line that proves it; what was not run is said ("unchecked").
- Windows: PowerShell 5.1 has no `<` redirect and blocks `.ps1` shims (use `npm.cmd`); `gh ... --jq` runs in Bash (PowerShell strips the inner quotes). Edit files with Read + Edit or Write, never `sed -i`, a heredoc, or PowerShell `Get-Content` / `Set-Content` on UTF-8 files.
- Grilling: before any plan, item or ticket use the `grilling` and `domain-modeling` skills together. Do every fact lookup first, then ask ONE round, never a replacement round; every "reuse X" answer names the file:function you grepped, else it is marked "unverified".

## The setup
- **Rook HQ** is `E:/Project B/Claude/rook-hq`: the generic `WORKFLOW.md` (roles, loop, Rook card, handover, Castle mode, briefs, permissions), `runs<N>` from session 41, and Rook's memory. Rook's launcher is `Rook.lnk` in the Startup folder (cwd `rook-hq`). Projects (D, R, B, P, WF) are listed in `hq.json` with their own `CLAUDE.md` and `rook.config.json`.
- Roles: **Rook** lead (main account), **Bishop** = `claude2`, **King** = `claude3`, **Knight** = Codex, **Pawn** = Antigravity (`agy`). Read `rook-hq/WORKFLOW.md` before launching any of them.
