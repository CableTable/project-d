Option Explicit
' TODO 219c2 shim: the Startup shortcut runs this; it starts the kit's usage-agent.mjs (hq.json "kit", default kit\) through tools\kit.mjs, with this repo as the working folder.
Dim shell, files, repo, node, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
repo = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
node = WScript.Arguments(0)
shell.CurrentDirectory = repo
command = Chr(34) & node & Chr(34) & " " & Chr(34) & files.BuildPath(repo, "tools\kit.mjs") & Chr(34) & " usage-agent.mjs"
shell.Run command, 0, False
