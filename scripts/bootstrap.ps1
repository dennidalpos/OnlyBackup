[CmdletBinding()]
param(
    [Parameter()]
    [string]$InitialAdminPassword,

    [Parameter()]
    [switch]$SkipDependencyInstall,

    [Parameter()]
    [switch]$SkipDataInitialization
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$serverDir = Join-Path $repoRoot "server"
$packageLockPath = Join-Path $serverDir "package-lock.json"
$configPath = Join-Path $repoRoot "config.json"
$initDataScript = Join-Path $PSScriptRoot "init-data.js"

function Resolve-RequiredCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "Comando richiesto non trovato: $Name"
    }

    return $command.Path
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Executable,

        [Parameter()]
        [string[]]$Arguments = @(),

        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory
    )

    Push-Location $WorkingDirectory
    try {
        & $Executable @Arguments
        if ($LASTEXITCODE -ne 0) {
            $renderedArgs = if ($Arguments.Count -gt 0) { $Arguments -join " " } else { "" }
            throw "Comando fallito con exit code ${LASTEXITCODE}: $Executable $renderedArgs"
        }
    }
    finally {
        Pop-Location
    }
}

if (-not (Test-Path $serverDir)) {
    throw "Directory server non trovata: $serverDir"
}

if (-not (Test-Path $packageLockPath)) {
    throw "package-lock.json non trovato: $packageLockPath"
}

if (-not (Test-Path $configPath)) {
    throw "config.json non trovato: $configPath"
}

if (-not (Test-Path $initDataScript)) {
    throw "Script init-data.js non trovato: $initDataScript"
}

$nodeExecutable = Resolve-RequiredCommand -Name "node"
$npmExecutable = Resolve-RequiredCommand -Name "npm"

Write-Host "Repository root: $repoRoot" -ForegroundColor Cyan
Write-Host "Server directory: $serverDir" -ForegroundColor Cyan

if (-not $SkipDependencyInstall) {
    Write-Host "Installazione dipendenze server con npm ci..." -ForegroundColor Yellow
    Invoke-CheckedCommand -Executable $npmExecutable -Arguments @("ci") -WorkingDirectory $serverDir
}
else {
    Write-Host "Installazione dipendenze saltata per richiesta esplicita." -ForegroundColor Yellow
}

if (-not $SkipDataInitialization) {
    $previousPassword = $env:ONLYBACKUP_INITIAL_ADMIN_PASSWORD

    try {
        if ($PSBoundParameters.ContainsKey("InitialAdminPassword")) {
            $env:ONLYBACKUP_INITIAL_ADMIN_PASSWORD = $InitialAdminPassword
        }

        Write-Host "Inizializzazione dati applicativi..." -ForegroundColor Yellow
        Invoke-CheckedCommand -Executable $nodeExecutable -Arguments @($initDataScript) -WorkingDirectory $repoRoot
    }
    finally {
        if ($PSBoundParameters.ContainsKey("InitialAdminPassword")) {
            if ($null -ne $previousPassword) {
                $env:ONLYBACKUP_INITIAL_ADMIN_PASSWORD = $previousPassword
            }
            else {
                Remove-Item Env:ONLYBACKUP_INITIAL_ADMIN_PASSWORD -ErrorAction SilentlyContinue
            }
        }
    }
}
else {
    Write-Host "Inizializzazione dati saltata per richiesta esplicita." -ForegroundColor Yellow
}

Write-Host "" 
Write-Host "Bootstrap completato." -ForegroundColor Green
Write-Host "Passi successivi consigliati:" -ForegroundColor Green
Write-Host "  1. powershell -ExecutionPolicy Bypass -File .\scripts\doctor.ps1" -ForegroundColor Green
Write-Host "  2. Set-Location .\server" -ForegroundColor Green
Write-Host "  3. npm start" -ForegroundColor Green
