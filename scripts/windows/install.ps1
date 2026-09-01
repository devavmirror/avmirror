[CmdletBinding()]
param(
  [string]$ArtifactUrl = $env:AVMIRROR_WINDOWS_URL,
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'avmirror'),
  [int]$Port = 7000
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ArtifactUrl)) {
  throw 'Informe AVMIRROR_WINDOWS_URL ou passe -ArtifactUrl com a URL do avmirror-win-x64.exe publicado.'
}
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$exe = Join-Path $InstallDir 'avmirror-win-x64.exe'
Invoke-WebRequest -Uri $ArtifactUrl -OutFile $exe -UseBasicParsing
if (-not (Test-Path $exe) -or (Get-Item $exe).Length -lt 1MB) { throw 'Download do executável inválido ou incompleto.' }

$rule = Get-NetFirewallRule -DisplayName 'AVMirror LAN (TCP 7000)' -ErrorAction SilentlyContinue
if (-not $rule) { New-NetFirewallRule -DisplayName 'AVMirror LAN (TCP 7000)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Private | Out-Null }
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$startup = "cmd.exe /d /c `"set LOCAL_MODE=true&&set BIND_HOST=0.0.0.0&&set PORT=$Port&&start `"`" /min `"$exe`"`""
New-ItemProperty -Path $runKey -Name 'AVMirror' -Value $startup -PropertyType String -Force | Out-Null
$env:LOCAL_MODE = 'true'; $env:BIND_HOST = '0.0.0.0'; $env:PORT = [string]$Port
Start-Process -FilePath $exe -WorkingDirectory $InstallDir -WindowStyle Hidden
Start-Process "http://localhost:$Port/"
Write-Host "AVMirror instalado e iniciado em http://localhost:$Port/"
