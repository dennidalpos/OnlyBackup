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

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$serverDir = Join-Path $repoRoot "server"
$packageLockPath = Join-Path $serverDir "package-lock.json"
$configPath = Join-Path $repoRoot "config.json"
$initDataScript = Join-Path $PSScriptRoot "Initialize-OnlyBackupData.js"
$requiredNodeVersion = [version]"20.19.0"

function Resolve-RequiredCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$SoftwareName,

        [Parameter(Mandatory = $true)]
        [string]$MinimumVersion,

        [Parameter(Mandatory = $true)]
        [string]$Reason,

        [Parameter(Mandatory = $true)]
        [string]$InstallInstruction,

        [Parameter(Mandatory = $true)]
        [string]$VerificationCommand
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        throw @"
Prerequisito mancante: $SoftwareName
Versione minima/supportata: $MinimumVersion
Motivo: $Reason
Azione richiesta: $InstallInstruction
Verifica: $VerificationCommand
"@
    }

    return $command.Path
}

function Test-NodeVersion {
    param([Parameter(Mandatory = $true)][string]$NodeExecutable)

    $rawVersion = (& $NodeExecutable --version).Trim()
    $versionText = $rawVersion.TrimStart("v")
    $version = $null

    if (-not [version]::TryParse($versionText, [ref]$version)) {
        throw "Prerequisito non verificabile: Node.js ha restituito una versione non interpretabile: $rawVersion. Verifica con: node --version"
    }

    if ($version -lt $requiredNodeVersion) {
        throw @"
Prerequisito non compatibile: Node.js
Versione trovata: $rawVersion
Versione minima/supportata: >= $requiredNodeVersion
Motivo: il server OnlyBackup usa dipendenze npm bloccate da package-lock.json e richiede Node.js moderno.
Azione richiesta: installa Node.js LTS 20.x o superiore dal sito ufficiale https://nodejs.org/ e riapri PowerShell.
Verifica: node --version
"@
    }

    Write-Host "Node.js compatibile: $rawVersion" -ForegroundColor Green
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
    throw "Script setup\Initialize-OnlyBackupData.js non trovato: $initDataScript"
}

$nodeExecutable = Resolve-RequiredCommand `
    -Name "node" `
    -SoftwareName "Node.js" `
    -MinimumVersion ">= $requiredNodeVersion" `
    -Reason "serve per eseguire il server OnlyBackup e lo script di inizializzazione dati" `
    -InstallInstruction "installa Node.js LTS 20.x o superiore dal sito ufficiale https://nodejs.org/ e riapri PowerShell" `
    -VerificationCommand "node --version"

Test-NodeVersion -NodeExecutable $nodeExecutable

$npmExecutable = Resolve-RequiredCommand `
    -Name "npm" `
    -SoftwareName "npm" `
    -MinimumVersion "incluso con Node.js LTS 20.x o superiore" `
    -Reason "serve per installare le dipendenze server con npm ci da package-lock.json" `
    -InstallInstruction "installa Node.js LTS dal sito ufficiale https://nodejs.org/ includendo npm, poi riapri PowerShell" `
    -VerificationCommand "npm --version"

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
Write-Host "Setup iniziale completato." -ForegroundColor Green
Write-Host "Passi successivi consigliati:" -ForegroundColor Green
Write-Host "  1. powershell -ExecutionPolicy Bypass -File .\scripts\Test-OnlyBackupPrerequisites.ps1" -ForegroundColor Green
Write-Host "  2. Set-Location .\server" -ForegroundColor Green
Write-Host "  3. npm start" -ForegroundColor Green
