[CmdletBinding()]
param(
    [string]$ServiceName = "OnlyBackupServer",
    [string]$ServiceBinaryDirectory = "",
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Assert-Administrator {
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).
        IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

    if (-not $isAdmin) {
        throw "Questo script richiede privilegi di amministratore."
    }
}

Assert-Administrator

if ($ServiceName -ne "OnlyBackupServer") {
    throw "Il wrapper integrato supporta il nome servizio fisso OnlyBackupServer."
}

if (-not $ServiceBinaryDirectory) {
    $ServiceBinaryDirectory = Join-Path $repoRoot "output\server-service"
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($service -and $service.Status -ne "Stopped") {
    Stop-Service -Name $ServiceName -Force:$Force
    $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
}

$serviceExecutable = Join-Path $ServiceBinaryDirectory "OnlyBackupServerService.exe"
if (Test-Path $serviceExecutable) {
    & $serviceExecutable /uninstall
    if ($LASTEXITCODE -ne 0) {
        throw "Disinstallazione servizio fallita con exit code $LASTEXITCODE"
    }
}
elseif ($service) {
    & sc.exe delete $ServiceName | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "sc.exe delete ha restituito exit code $LASTEXITCODE"
    }
}
else {
    Write-Host "Servizio $ServiceName non presente." -ForegroundColor Yellow
    exit 0
}

Write-Host "Servizio $ServiceName rimosso." -ForegroundColor Green
