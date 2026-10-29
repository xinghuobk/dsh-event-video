# Start UI-TARS-7B grounding server (llama.cpp, Vulkan GPU).
# Usage: powershell -ExecutionPolicy Bypass -File scripts/start_uitars.ps1
param(
    [string]$ModelDir = "D:\agent\models\ui-tars",
    [int]$Port = 8081,
    [int]$GpuLayers = 99,
    [int]$Ctx = 4096
)
$server = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter "llama-server.exe" -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $server) {
    throw "llama-server.exe not found. Install it with: winget install -e --id ggml.llamacpp"
}
$model = Join-Path $ModelDir "UI-TARS-7B-SFT.Q4_K_M.gguf"
$mmproj = Join-Path $ModelDir "UI-TARS-7B-SFT.mmproj-fp16.gguf"
if (-not (Test-Path $model) -or -not (Test-Path $mmproj)) {
    throw "UI-TARS files missing in $ModelDir (see docs/MODELS.md)"
}
Write-Host "starting $server on 127.0.0.1:$Port (gpu layers: $GpuLayers)"
& $server -m $model --mmproj $mmproj --host 127.0.0.1 --port $Port --alias ui-tars -ngl $GpuLayers -c $Ctx
