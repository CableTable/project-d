Option Explicit
Dim shell, files, repo, node, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
repo = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
node = WScript.Arguments(0)
shell.CurrentDirectory = repo
command = Chr(34) & node & Chr(34) & " " & Chr(34) & files.BuildPath(repo, "tools\usage-agent.mjs") & Chr(34)
shell.Run command, 0, False
