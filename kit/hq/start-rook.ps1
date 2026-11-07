# Starts Rook at logon (Startup shortcut "Rook.lnk", made by `node tools/rook.mjs hq-install`) or at a handover. Reads rook-next.txt, written by each Rook session:
# line 1 session uuid, line 2 display name, line 3 resume file. Transcript in Rook HQ's project -> resume it there; one from before HQ (session < runsFrom) -> resume it in the old folder; else start fresh in HQ.
# --add-dir comes before --session-id / --resume: it takes several values, so the prompt must follow a flag that takes one.
foreach ($v in 'CLAUDE_CODE_CHILD_SESSION','CLAUDE_CODE_SESSION_ID','CLAUDE_CODE_BRIDGE_SESSION_ID','CLAUDE_CODE_MESSAGING_SOCKET','CLAUDE_CODE_MESSAGING_TOKEN') {
  Remove-Item "Env:$v" -ErrorAction SilentlyContinue
}
$env:CLAUDE_CODE_FORCE_SESSION_PERSISTENCE = '1'
$env:COLORTERM = 'truecolor'
$env:FORCE_COLOR = '3'
$hq = '{{HQ}}'
$next = Get-Content "$hq\rook-next.txt"
$id = $next[0].Trim(); $name = $next[1].Trim(); $resume = $next[2].Trim()
$claude = "$env:USERPROFILE\.local\bin\claude.exe"
$projects = "$env:USERPROFILE\.claude\projects"
if (Test-Path "$projects\{{HQ_SLUG}}\$id.jsonl") {
  Set-Location $hq
  & $claude --rc --model opus --name $name {{ADD_DIRS}} --resume $id
} elseif (Test-Path "$projects\{{OLD_SLUG}}\$id.jsonl") {
  Set-Location '{{OLD_CWD}}'
  & $claude --rc --model opus --name $name --resume $id
} else {
  Set-Location $hq
  & $claude --rc --model opus --name $name {{ADD_DIRS}} --session-id $id "Read $resume and follow it."
}
