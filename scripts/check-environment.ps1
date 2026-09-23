$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDir

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Node.js was not found.' }
$nodeVersion = & $nodeCommand.Source --version

$pythonBinary = Join-Path $projectDir '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonBinary)) { throw 'The .venv camera environment was not found.' }
$pythonVersion = & $pythonBinary --version
& $pythonBinary -c 'import importlib.metadata, numpy, pypylon; print("numpy", numpy.__version__); print("pypylon", importlib.metadata.version("pypylon"))'

$ffmpegBinary = Get-ChildItem -LiteralPath (Join-Path $projectDir 'work\tools\ffmpeg') -Filter ffmpeg.exe -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $ffmpegBinary) { throw 'FFmpeg was not found. Run scripts\setup-ffmpeg.ps1.' }
$ffmpegVersion = (& $ffmpegBinary.FullName -version | Select-Object -First 1)

Write-Host "Node: $nodeVersion"
Write-Host "Python: $pythonVersion"
Write-Host "FFmpeg: $ffmpegVersion"
Write-Host 'Detected Basler cameras:'
'{"operation":"list"}' | & $pythonBinary scripts/camera_settings.py
