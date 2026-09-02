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
$download = Join-Path $env:TEMP 'avmirror-windows-bundle.zip'
Invoke-WebRequest -Uri $ArtifactUrl -OutFile $download -UseBasicParsing
if (([IO.Path]::GetExtension($ArtifactUrl).ToLowerInvariant()) -eq '.zip') {
  $tempExtract = Join-Path $env:TEMP ('avmirror-extract-' + [guid]::NewGuid())
  Expand-Archive -Path $download -DestinationPath $tempExtract -Force
  $bundle = Get-ChildItem -Path $tempExtract -Directory -Filter 'win-x64' | Select-Object -First 1
  if (-not $bundle) { $bundle = Get-Item $tempExtract }
  Copy-Item -Path (Join-Path $bundle.FullName '*') -Destination $InstallDir -Recurse -Force
} else {
  Copy-Item -Path $download -Destination (Join-Path $InstallDir 'avmirror-windows_26.1.2.exe') -Force
}
$exe = Join-Path $InstallDir 'avmirror-windows_26.1.2.exe'
if (-not (Test-Path $exe) -or (Get-Item $exe).Length -lt 1MB) { throw 'Download do bundle Windows inválido ou incompleto.' }

$rule = Get-NetFirewallRule -DisplayName 'AVMirror LAN (TCP 7000)' -ErrorAction SilentlyContinue
if (-not $rule) { New-NetFirewallRule -DisplayName 'AVMirror LAN (TCP 7000)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Private | Out-Null }
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$startup = "cmd.exe /d /c `"set LOCAL_MODE=true&&set BIND_HOST=0.0.0.0&&set PORT=$Port&&set JABLE_LANGUAGE=en&&set USE_LOCAL_HLS_PROXY=true&&start `"`" /min `"$exe`"`""
New-ItemProperty -Path $runKey -Name 'AVMirror' -Value $startup -PropertyType String -Force | Out-Null
$env:LOCAL_MODE = 'true'; $env:BIND_HOST = '0.0.0.0'; $env:PORT = [string]$Port; $env:JABLE_LANGUAGE = 'en'; $env:USE_LOCAL_HLS_PROXY = 'true'
Start-Process -FilePath $exe -WorkingDirectory $InstallDir -WindowStyle Hidden
Start-Process "http://localhost:$Port/"
Write-Host "AVMirror instalado e iniciado em http://localhost:$Port/"
