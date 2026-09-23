$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDir

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Node.js 24 or newer is required. Install it from https://nodejs.org/ and run setup again.' }
$nodeMajor = [int]((& $nodeCommand.Source --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 24) { throw 'Node.js 24 or newer is required.' }

$venvPython = Join-Path $projectDir '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
    $launcher = Get-Command py -ErrorAction SilentlyContinue
    if ($launcher) {
        & $launcher.Source -3.12 -m venv .venv
    } else {
        $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
        if (-not $pythonCommand) { throw 'Python 3.12 is required. Install it from https://www.python.org/ and run setup again.' }
        & $pythonCommand.Source -m venv .venv
    }
}

& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install --requirement requirements-camera.txt
& (Join-Path $PSScriptRoot 'setup-ffmpeg.ps1')
& (Join-Path $PSScriptRoot 'check-environment.ps1')
