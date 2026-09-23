$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$toolsDir = Join-Path $projectDir 'work\tools'
$expectedHash = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba'
$binary = Join-Path $toolsDir 'ffmpeg\ffmpeg-9.0.2-essentials_build\bin\ffmpeg.exe'
if (Test-Path -LiteralPath $binary) { Write-Host "Already available: $binary"; exit 0 }
New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
$archive = Join-Path $toolsDir 'ffmpeg.zip'
if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $archive
}
$actualHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLower()
if ($actualHash -ne $expectedHash) { throw 'Downloaded archive differs from the tested 9.0.2 build. Preserve it, obtain the pinned build or review a new version; do not execute it automatically.' }
Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $toolsDir 'ffmpeg')
Write-Host "Portable FFmpeg ready: $binary"
