[CmdletBinding()]
param(
    [Parameter()]
    [switch]$RequirePackagingToolchain,

    [Parameter()]
    [switch]$RequireServerServiceTooling,

    [Parameter()]
    [string]$NodePath = "node",

    [Parameter()]
    [string]$NpmPath = "npm",

    [Parameter()]
    [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$serverDir = Join-Path $repoRoot "server"
$configPath = Join-Path $repoRoot "config.json"
$nodeModulesPath = Join-Path $serverDir "node_modules"
$usersFilePath = Join-Path $repoRoot "data\users\users.json"
$requiredNodeVersion = [version]"20.19.0"
$dotNet462TargetingPackPath = "C:\Program Files (x86)\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.6.2\mscorlib.dll"

$errors = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

function Add-Error {
    param([string]$Message)
    $errors.Add($Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Add-PrerequisiteError {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$MinimumVersion,
        [Parameter(Mandatory = $true)][string]$Reason,
        [Parameter(Mandatory = $true)][string]$Action,
        [Parameter(Mandatory = $true)][string]$Verification,
        [Parameter()][string]$FoundVersion
    )

    $message = @(
        "Prerequisito mancante/non compatibile: $Name"
        "Versione minima/supportata: $MinimumVersion"
    )

    if ($FoundVersion) {
        $message += "Versione trovata: $FoundVersion"
    }

    $message += @(
        "Motivo: $Reason"
        "Azione richiesta: $Action"
        "Verifica: $Verification"
    )

    Add-Error ($message -join " | ")
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

    if (-not $Name) {
        return $null
    }

    if (Test-Path $Name) {
        return (Resolve-Path $Name).Path
    }

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Path
    }

    return $null
}

function Invoke-SelfTest {
    $scriptPath = $PSCommandPath
    $missingNodeOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath -NodePath "__onlybackup_missing_node__" -NpmPath "__onlybackup_missing_npm__" 2>&1
    $missingNodeExit = $LASTEXITCODE

    if ($missingNodeExit -eq 0) {
        throw "SelfTest fallito: prerequisito Node.js assente non ha prodotto exit code diverso da zero."
    }

    $missingText = ($missingNodeOutput | Out-String)
    if ($missingText -notmatch "Prerequisito mancante/non compatibile: Node.js" -or $missingText -notmatch "Versione minima/supportata: >= 20.19.0" -or $missingText -notmatch "node --version") {
        throw "SelfTest fallito: messaggio Node.js mancante/non compatibile non contiene i dettagli attesi."
    }

    $presentOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath 2>&1
    $presentExit = $LASTEXITCODE

    if ($presentExit -ne 0) {
        throw "SelfTest fallito: percorso prerequisiti presenti ha restituito exit code $presentExit. Output: $($presentOutput | Out-String)"
    }

    Write-Host "[OK] SelfTest prerequisito assente: messaggio atteso verificato." -ForegroundColor Green
    Write-Host "[OK] SelfTest percorso setup riuscito: preflight completato senza errori bloccanti." -ForegroundColor Green
}

if ($SelfTest) {
    Invoke-SelfTest
    exit 0
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

Write-Host "OnlyBackup prerequisites check" -ForegroundColor Cyan
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

$nodeCommand = Get-CommandPathOrNull -Name $NodePath
if (-not $nodeCommand) {
    Add-PrerequisiteError `
        -Name "Node.js" `
        -MinimumVersion ">= $requiredNodeVersion" `
        -Reason "serve per eseguire il server OnlyBackup e gli script di inizializzazione dati" `
        -Action "installa Node.js LTS 20.x o superiore dal sito ufficiale https://nodejs.org/ e riapri PowerShell" `
        -Verification "node --version"
}
else {
    $nodeVersionRaw = (& $nodeCommand --version).Trim()
    $nodeVersionText = $nodeVersionRaw.TrimStart("v")
    $nodeVersion = $null
    if (-not [version]::TryParse($nodeVersionText, [ref]$nodeVersion)) {
        Add-PrerequisiteError `
            -Name "Node.js" `
            -MinimumVersion ">= $requiredNodeVersion" `
            -Reason "la versione restituita non e interpretabile dal preflight" `
            -Action "verifica l'installazione ufficiale Node.js e riapri PowerShell" `
            -Verification "node --version" `
            -FoundVersion $nodeVersionRaw
    }
    elseif ($nodeVersion -lt $requiredNodeVersion) {
        Add-PrerequisiteError `
            -Name "Node.js" `
            -MinimumVersion ">= $requiredNodeVersion" `
            -Reason "le dipendenze npm del server richiedono Node.js moderno" `
            -Action "installa Node.js LTS 20.x o superiore dal sito ufficiale https://nodejs.org/ e riapri PowerShell" `
            -Verification "node --version" `
            -FoundVersion $nodeVersionRaw
    }
    else {
        Add-Ok "Node.js compatibile: $nodeVersionRaw"
    }
}

$npmCommand = Get-CommandPathOrNull -Name $NpmPath
if (-not $npmCommand) {
    Add-PrerequisiteError `
        -Name "npm" `
        -MinimumVersion "incluso con Node.js LTS 20.x o superiore" `
        -Reason "serve per installare le dipendenze server con npm ci da package-lock.json" `
        -Action "installa Node.js LTS dal sito ufficiale https://nodejs.org/ includendo npm, poi riapri PowerShell" `
        -Verification "npm --version"
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
    Add-Error "Dipendenze server mancanti: esegui scripts\\Setup-OnlyBackupServer.ps1."
}
else {
    Add-Ok "Dipendenze server installate."
}

$requiredDataPaths = @(
    (Join-Path $repoRoot "data"),
    (Join-Path $repoRoot "data\config"),
    (Join-Path $repoRoot "data\state"),
    (Join-Path $repoRoot "data\state\alerts"),
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
    Add-PrerequisiteError `
        -Name "WiX Toolset" `
        -MinimumVersion "3.14" `
        -Reason "serve per generare il pacchetto MSI dell'agent" `
        -Action "usa la toolchain versionata in tools\wix314-binaries\ oppure installa WiX Toolset 3.14 dal sito/progetto ufficiale WiX" `
        -Verification "Test-Path .\tools\wix314-binaries\candle.exe"
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
    Add-PrerequisiteError `
        -Name "MSBuild" `
        -MinimumVersion "Visual Studio Build Tools 2019/2022 con supporto .NET Framework" `
        -Reason "serve per compilare l'agent C# prima del packaging MSI" `
        -Action "installa Visual Studio Build Tools dal sito ufficiale Microsoft selezionando i componenti .NET Framework build tools" `
        -Verification "Get-Command MSBuild.exe"
}
else {
    Add-Warning "MSBuild non disponibile: build agent non verificabile in questo ambiente."
}

if (Test-Path $dotNet462TargetingPackPath) {
    Add-Ok ".NET Framework 4.6.2 Targeting Pack disponibile per la build agent."
}
elseif ($RequirePackagingToolchain) {
    Add-PrerequisiteError `
        -Name ".NET Framework 4.6.2 Developer Pack/Targeting Pack" `
        -MinimumVersion ".NET Framework 4.6.2 Targeting Pack" `
        -Reason "serve a MSBuild per compilare l'agent con TargetFrameworkVersion v4.6.2" `
        -Action "installa .NET Framework 4.6.2 Developer Pack dal sito ufficiale Microsoft oppure aggiungi il componente targeting pack tramite Visual Studio Build Tools" `
        -Verification "Test-Path '$dotNet462TargetingPackPath'"
}
else {
    Add-Warning ".NET Framework 4.6.2 Targeting Pack non disponibile: build agent non verificabile in questo ambiente."
}

$robocopyPath = Get-FirstExistingPath -Candidates @(
    (Join-Path $env:SystemRoot "System32\robocopy.exe"),
    (Get-CommandPathOrNull -Name "robocopy.exe")
)

if ($robocopyPath) {
    Add-Ok "Robocopy disponibile sul client Windows."
}
else {
    Add-PrerequisiteError `
        -Name "Robocopy" `
        -MinimumVersion "robocopy.exe incluso in Windows 10/11" `
        -Reason "l'agent usa robocopy.exe per eseguire copie backup affidabili" `
        -Action "usa un client Windows 10/11 aggiornato o ripara i componenti Windows se robocopy.exe manca da System32" `
        -Verification "Get-Command robocopy.exe"
}

$serverServiceProjectPath = Join-Path $repoRoot "server\service-wrapper\OnlyBackupServerService.csproj"
if (Test-Path $serverServiceProjectPath) {
    Add-Ok "Progetto wrapper Windows Service server disponibile."
}
else {
    Add-Error "Progetto wrapper Windows Service server mancante: server\\service-wrapper\\OnlyBackupServerService.csproj"
}

if ($RequireServerServiceTooling) {
    if ($msBuildPath) {
        Add-Ok "MSBuild disponibile per compilare il servizio server."
    }
    else {
        Add-PrerequisiteError `
            -Name "MSBuild" `
            -MinimumVersion "Visual Studio Build Tools 2019/2022 con supporto .NET Framework" `
            -Reason "serve per compilare il wrapper Windows Service del server" `
            -Action "installa Visual Studio Build Tools dal sito ufficiale Microsoft selezionando i componenti .NET Framework build tools" `
            -Verification "Get-Command MSBuild.exe"
    }

    if (Test-Path $dotNet462TargetingPackPath) {
        Add-Ok ".NET Framework 4.6.2 Targeting Pack disponibile per il servizio server."
    }
    else {
        Add-PrerequisiteError `
            -Name ".NET Framework 4.6.2 Developer Pack/Targeting Pack" `
            -MinimumVersion ".NET Framework 4.6.2 Targeting Pack" `
            -Reason "serve a MSBuild per compilare il wrapper Windows Service del server" `
            -Action "installa .NET Framework 4.6.2 Developer Pack dal sito ufficiale Microsoft oppure aggiungi il componente targeting pack tramite Visual Studio Build Tools" `
            -Verification "Test-Path '$dotNet462TargetingPackPath'"
    }
}
else {
    Add-Warning "Toolchain servizio server non richiesta: usa -RequireServerServiceTooling per verificare build e installazione servizio."
}

Write-Host ""
Write-Host "Riepilogo" -ForegroundColor Cyan
Write-Host "  Errori: $($errors.Count)" -ForegroundColor Cyan
Write-Host "  Warning: $($warnings.Count)" -ForegroundColor Cyan

if ($errors.Count -gt 0) {
    exit 1
}

Write-Host "Controllo prerequisiti completato senza errori bloccanti." -ForegroundColor Green
