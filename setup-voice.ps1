$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$venvPython = Join-Path $project '.voice-env\Scripts\python.exe'
$modelDir = Join-Path $project 'models\vosk-model-small-en-in-0.4'
$modelRoot = Join-Path $project 'models'
$zipPath = Join-Path $project 'models\vosk-model-small-en-in-0.4.zip'

Write-Host 'Preparing Snoopy offline voice recognition...'
if (-not (Test-Path $venvPython)) {
  python -m venv (Join-Path $project '.voice-env')
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the local Python environment. Install Python 3.10–3.12 and try again.' }
}

& $venvPython -m pip install vosk==0.3.45 sounddevice
if ($LASTEXITCODE -ne 0) { throw 'Could not install the offline voice packages.' }

if (-not (Test-Path $modelDir)) {
  New-Item -ItemType Directory -Force -Path $modelRoot | Out-Null
  Write-Host 'Downloading the 36 MB Indian-English speech model (one time)...'
  Invoke-WebRequest -Uri 'https://alphacephei.com/vosk/models/vosk-model-small-en-in-0.4.zip' -OutFile $zipPath
  Expand-Archive -LiteralPath $zipPath -DestinationPath $modelRoot -Force
  Remove-Item -LiteralPath $zipPath -Force
}

Write-Host 'Snoopy offline voice setup is ready.'
