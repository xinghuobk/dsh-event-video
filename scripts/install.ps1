# Windows one-command setup for DSH Event Video.
# Run from the repo root:
#   powershell -ExecutionPolicy Bypass -File scripts/install.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -WithVlm -InstallOllama
param(
    [switch]$WithVlm,
    [string]$VlmModel = "minicpm-v:8b",
    [string]$DataHome = "",
    [switch]$InstallOllama,
    [switch]$DryRun
)
$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..")
$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) {
    $python = (Get-Command python3 -ErrorAction SilentlyContinue).Source
}
if (-not $python) {
    throw "Python 3.10+ is required (install it first, then re-run this script)."
}

if ($WithVlm -and $InstallOllama) {
    $ollama = Get-Command ollama -ErrorAction SilentlyContinue
    if (-not $ollama) {
        Write-Host "Installing Ollama via winget ..."
        winget install -e --id Ollama.Ollama --accept-package-agreements --accept-source-agreements --silent
        Start-Sleep -Seconds 5
    }
}

$setup = Join-Path $repo "scripts\setup_models.py"
$pyArgs = @($setup)
if ($DataHome) { $pyArgs += @("--home", $DataHome) }
if ($WithVlm) { $pyArgs += @("--with-vlm", "--vlm-model", $VlmModel) }
if ($DryRun) { $pyArgs += "--dry-run" }

Write-Host "Running: $python $($pyArgs -join ' ')"
& $python @pyArgs
exit $LASTEXITCODE
