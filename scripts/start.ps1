$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDir

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Node.js 24 or newer is required. Install Node.js, then run this script again.' }

$pythonBinary = Join-Path $projectDir '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonBinary)) { throw 'Camera environment is missing. Run scripts\setup.ps1 first.' }
$env:CAMERA_PYTHON = $pythonBinary

$localFFmpeg = Get-ChildItem -LiteralPath (Join-Path $projectDir 'work\tools\ffmpeg') -Filter ffmpeg.exe -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if ($localFFmpeg) { $env:FFMPEG_PATH = $localFFmpeg.FullName }

Write-Host 'Open http://127.0.0.1:8765 after the server starts.'
Write-Host 'Real studies use free run and do not require TTL pulses.'
& $nodeCommand.Source src/server.mjs
exit $LASTEXITCODE
