$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Startup = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $Startup "AVMirror Local.lnk"
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = (Get-Command node).Source
$Shortcut.Arguments = "`"$ProjectRoot\scripts\start-local.js`""
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.WindowStyle = 7
$Shortcut.Save()
Write-Output "Atalho criado em $ShortcutPath"

