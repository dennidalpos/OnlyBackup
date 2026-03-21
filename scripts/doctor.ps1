[CmdletBinding()]
param(
    [Parameter()]
    [switch]$RequirePackagingToolchain,

    [Parameter()]
    [switch]$RequireServerServiceTooling
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$serverDir = Join-Path $repoRoot "server"
$configPath = Join-Path $repoRoot "config.json"
$nodeModulesPath = Join-Path $serverDir "node_modules"
$usersFilePath = Join-Path $repoRoot "data\users\users.json"

$errors = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

function Add-Error {
    param([string]$Message)
    $errors.Add($Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Add-Warning {
    param([string]$Message)
    $warnings.Add($Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Add-Ok {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Get-CommandPathOrNull {
    param([string]$Name)

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Path
    }

    return $null
}

function Get-FirstExistingPath {
    param([string[]]$Candidates)

    foreach ($candidate in $Candidates) {
        if (-not $candidate) {
            continue
        }

        if (Test-Path $candidate) {
            return (Resolve-Path $candidate).Path
        }
    }

    return $null
}

Write-Host "OnlyBackup doctor" -ForegroundColor Cyan
Write-Host "Repository root: $repoRoot" -ForegroundColor Cyan

if (-not (Test-Path $serverDir)) {
    Add-Error "Directory server non trovata: $serverDir"
}
else {
    Add-Ok "Directory server trovata."
}

if (-not (Test-Path $configPath)) {
    Add-Error "config.json non trovato in root repository."
}
else {
    Add-Ok "config.json disponibile."
}

$nodeCommand = Get-CommandPathOrNull -Name "node"
if (-not $nodeCommand) {
    Add-Error "Node.js non trovato nel PATH."
}
else {
    $nodeVersionRaw = (& $nodeCommand --version).Trim()
    $nodeVersionText = $nodeVersionRaw.TrimStart("v")
    $nodeVersion = $null
    if (-not [version]::TryParse($nodeVersionText, [ref]$nodeVersion)) {
        Add-Error "Versione Node.js non interpretabile: $nodeVersionRaw"
    }
    elseif ($nodeVersion.Major -lt 18) {
        Add-Error "Node.js $nodeVersionRaw trovato, ma e richiesto >= 18."
    }
    else {
        Add-Ok "Node.js compatibile: $nodeVersionRaw"
    }
}

$npmCommand = Get-CommandPathOrNull -Name "npm"
if (-not $npmCommand) {
    Add-Error "npm non trovato nel PATH."
}
else {
    $npmVersion = (& $npmCommand --version).Trim()
    Add-Ok "npm disponibile: $npmVersion"
}

if (-not (Test-Path (Join-Path $serverDir "package.json"))) {
    Add-Error "server\\package.json non trovato."
}
else {
    Add-Ok "server\\package.json disponibile."
}

if (-not (Test-Path $nodeModulesPath)) {
    Add-Error "Dipendenze server mancanti: esegui scripts\\bootstrap.ps1."
}
else {
    Add-Ok "Dipendenze server installate."
}

$requiredDataPaths = @(
    (Join-Path $repoRoot "data"),
    (Join-Path $repoRoot "data\config"),
    (Join-Path $repoRoot "data\state"),
    (Join-Path $repoRoot "data\users")
)

foreach ($path in $requiredDataPaths) {
    if (Test-Path $path) {
        Add-Ok "Percorso dati presente: $path"
    }
    else {
        Add-Error "Percorso dati mancante: $path"
    }
}

if (-not (Test-Path $usersFilePath)) {
    Add-Error "Utente admin bootstrap non inizializzato: manca data\\users\\users.json."
}
else {
    Add-Ok "Archivio utenti inizializzato."
}

$wixPath = Get-FirstExistingPath -Candidates @(
    (Join-Path $repoRoot "tools\wix314-binaries\candle.exe"),
    "C:\Program Files (x86)\WiX Toolset v3.14\bin\candle.exe"
)

if ($wixPath) {
    Add-Ok "WiX 3.14 disponibile per il packaging agent."
}
elseif ($RequirePackagingToolchain) {
    Add-Error "WiX 3.14 non disponibile ma richiesto."
}
else {
    Add-Warning "WiX 3.14 non disponibile: packaging MSI agent non verificabile in questo ambiente."
}

$msBuildPath = Get-FirstExistingPath -Candidates @(
    (Get-CommandPathOrNull -Name "MSBuild.exe"),
    "C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe",
    "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe",
    "C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\MSBuild\Current\Bin\MSBuild.exe",
    "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\MSBuild\Current\Bin\MSBuild.exe",
    "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\MSBuild.exe"
)

if ($msBuildPath) {
    Add-Ok "MSBuild disponibile per la build agent."
}
elseif ($RequirePackagingToolchain) {
    Add-Error "MSBuild non disponibile ma richiesto."
}
else {
    Add-Warning "MSBuild non disponibile: build agent non verificabile in questo ambiente."
}

$nssmPath = Get-FirstExistingPath -Candidates @(
    (Join-Path $repoRoot "tools\nssm\nssm.exe"),
    (Join-Path $repoRoot "tools\nssm\win64\nssm.exe"),
    (Join-Path $repoRoot "tools\nssm\win32\nssm.exe"),
    (Get-CommandPathOrNull -Name "nssm")
)

if ($nssmPath) {
    Add-Ok "nssm disponibile per installazione del server come servizio."
}
elseif ($RequireServerServiceTooling) {
    Add-Error "nssm non disponibile ma richiesto."
}
else {
    Add-Warning "nssm non disponibile: installazione del server come servizio non verificabile in questo ambiente."
}

Write-Host ""
Write-Host "Riepilogo" -ForegroundColor Cyan
Write-Host "  Errori: $($errors.Count)" -ForegroundColor Cyan
Write-Host "  Warning: $($warnings.Count)" -ForegroundColor Cyan

if ($errors.Count -gt 0) {
    exit 1
}

Write-Host "Doctor completato senza errori bloccanti." -ForegroundColor Green
