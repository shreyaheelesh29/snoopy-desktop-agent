$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$packaging = Join-Path $project '.packaging'
$runtime = Join-Path $packaging 'voice-python'
$python = Join-Path $runtime 'python.exe'
$version = '3.13.17'
$archive = Join-Path $packaging "python-$version-embed-amd64.zip"
$pythonUrl = "https://www.python.org/ftp/python/$version/python-$version-embed-amd64.zip"
$getPip = Join-Path $packaging 'get-pip.py'
$readyMarker = Join-Path $packaging 'voice-runtime.ready'

New-Item -ItemType Directory -Force -Path $packaging | Out-Null
if (-not (Test-Path -LiteralPath $python)) {
  Write-Host "Preparing bundled Python $version for offline voice recognition..."
  Invoke-WebRequest -Uri $pythonUrl -OutFile $archive
  Expand-Archive -LiteralPath $archive -DestinationPath $runtime -Force
  Remove-Item -LiteralPath $archive -Force

  $pth = Join-Path $runtime 'python313._pth'
  $lines = @(Get-Content -LiteralPath $pth)
  if ($lines -notcontains 'Lib\site-packages') { $lines += 'Lib\site-packages' }
  $lines = $lines | ForEach-Object { if ($_ -eq '#import site') { 'import site' } else { $_ } }
  Set-Content -LiteralPath $pth -Value $lines -Encoding ascii

}

$sitePackages = Join-Path $runtime 'Lib\site-packages'
if (-not (Test-Path -LiteralPath $readyMarker)) {
  if (-not (Test-Path (Join-Path $sitePackages 'pip'))) {
    Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile $getPip
    & $python $getPip --disable-pip-version-check --no-warn-script-location
    if ($LASTEXITCODE -ne 0) { throw 'Could not prepare pip inside the bundled Python runtime.' }
    Remove-Item -LiteralPath $getPip -Force -ErrorAction SilentlyContinue
  }

  & $python -m pip install --disable-pip-version-check --no-warn-script-location --upgrade --target $sitePackages setuptools wheel
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare build support inside the bundled Python runtime.' }
  & $python -m pip install --disable-pip-version-check --no-warn-script-location --no-build-isolation --upgrade --target $sitePackages 'vosk==0.3.45' 'sounddevice==0.5.6'
  if ($LASTEXITCODE -ne 0) { throw 'Could not install Snoopy offline voice dependencies into the bundled Python runtime.' }

  Get-ChildItem $sitePackages -Directory | Where-Object { $_.Name -match '^(pip|setuptools|wheel)([-.]|$)' } | Remove-Item -Recurse -Force
}
$env:VOSK_LOG_LEVEL = '-1'
$env:SNOOPY_VOSK_MODEL = Join-Path $project 'models\vosk-model-small-en-in-0.4'
& $python -c 'import sounddevice, vosk; print(123)'
if ($LASTEXITCODE -ne 0) { throw 'The bundled Python voice runtime did not pass its import check.' }
New-Item -ItemType File -Force -Path $readyMarker | Out-Null
