[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "Medium")]
param(
    [switch]$IncludeDependencies
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

$targets = @(
    (Join-Path $repoRoot "logs"),
    (Join-Path $repoRoot "output"),
    (Join-Path $repoRoot "build"),
    (Join-Path $repoRoot "dist"),
    (Join-Path $repoRoot "publish"),
    (Join-Path $repoRoot "tmp"),
    (Join-Path $repoRoot "server\coverage"),
    (Join-Path $repoRoot "server\.nyc_output"),
    (Join-Path $repoRoot "scripts\wix\payload\NDP462-KB3151800-x86-x64-AllOS-ENU.exe")
)

$agentRoot = Join-Path $repoRoot "agent"
if (Test-Path $agentRoot) {
    $targets += Get-ChildItem -Path $agentRoot -Directory -Recurse -Force |
        Where-Object { $_.Name -in @("bin", "obj") } |
        Select-Object -ExpandProperty FullName
}

if ($IncludeDependencies) {
    $targets += Join-Path $repoRoot "server\node_modules"
}

$removed = New-Object System.Collections.Generic.List[string]
$missing = New-Object System.Collections.Generic.List[string]

foreach ($path in ($targets | Sort-Object -Unique)) {
    if (-not (Test-Path $path)) {
        $missing.Add($path)
        continue
    }

    if ($PSCmdlet.ShouldProcess($path, "Remove generated repository artifact")) {
        Remove-Item -Path $path -Recurse -Force
        $removed.Add($path)
    }
}

Write-Host "Repository root: $repoRoot" -ForegroundColor Cyan
Write-Host "Removed: $($removed.Count)" -ForegroundColor Green
$removed | ForEach-Object { Write-Host "  - $_" -ForegroundColor Green }

Write-Host "Skipped because missing: $($missing.Count)" -ForegroundColor Yellow
$missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
