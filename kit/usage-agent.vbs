Option Explicit
Dim shell, files, repo, node, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
' usage-agent.vbs <node> [<repo>]: the repo (the agent's working folder) is the project's checkout, default the folder above this kit.
repo = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
If WScript.Arguments.Count > 1 Then repo = WScript.Arguments(1)
node = WScript.Arguments(0)
shell.CurrentDirectory = repo
command = Chr(34) & node & Chr(34) & " " & Chr(34) & files.BuildPath(files.GetParentFolderName(WScript.ScriptFullName), "usage-agent.mjs") & Chr(34)
shell.Run command, 0, False
