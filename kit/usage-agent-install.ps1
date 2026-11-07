param([switch]$Uninstall, [string]$Repo = (Get-Location).Path) # run from the project's checkout, or pass -Repo: the shortcut starts <Repo>\tools\usage-agent.vbs, the shim that finds the kit
$ErrorActionPreference = 'Stop'
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Project D usage agent.lnk'
if ($Uninstall) {
    if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath }
    Write-Output 'Startup shortcut removed. A running agent stops at sign-out (or stop its Node process).'
    exit
}
$node = (Get-Command node -ErrorAction Stop).Source
$version = (& $node --version).TrimStart('v').Split('.')[0]
if ([int]$version -lt 22) { throw 'Install Node 22 or newer first.' }
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$shortcut.Arguments = '"' + (Join-Path $Repo 'tools\usage-agent.vbs') + '" "' + $node + '"'
$shortcut.WorkingDirectory = $Repo
$shortcut.WindowStyle = 7
$shortcut.Description = 'Project D Firebase usage agent'
$shortcut.Save()
Write-Output "Installed $shortcutPath. Open the shortcut now or sign in to Windows again."
