param(
    [string]$ServiceName = "OnlyBackupServer",
    [string]$NssmPath = "",
    [string]$NodePath = "",
    [string]$ConfigPath = "",
    [string]$AppDirectory = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$requiredNodeVersion = [version]"20.19.0"

function Assert-Administrator {
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).
        IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

    if (-not $isAdmin) {
        throw "Questo script richiede privilegi di amministratore."
    }
}

function Resolve-NssmExecutablePath {
    param([string]$Executable)

    $candidates = @()
    if ($Executable) {
        $candidates += $Executable
    }

    $candidates += @(
        (Join-Path $repoRoot "tools\nssm\nssm.exe"),
        (Join-Path $repoRoot "tools\nssm\win64\nssm.exe"),
        (Join-Path $repoRoot "tools\nssm\win32\nssm.exe"),
        "nssm"
    )

    foreach ($candidate in $candidates | Select-Object -Unique) {
        if (Test-Path $candidate) {
            return (Resolve-Path $candidate).Path
        }

        $resolved = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($resolved) {
            return $resolved.Path
        }
    }

    throw @"
Prerequisito mancante: nssm
Versione minima/supportata: versione stabile corrente di nssm 2.x per Windows
Motivo: serve per registrare OnlyBackup Server come servizio Windows.
Azione richiesta: copia nssm.exe in tools\nssm\, tools\nssm\win64\ o tools\nssm\win32\, oppure passa -NssmPath con il percorso completo.
Verifica: .\tools\nssm\win64\nssm.exe version
"@
}

function Invoke-Nssm {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Executable,

        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw ("nssm ha restituito exit code {0}: {1}" -f $LASTEXITCODE, ($Arguments -join " "))
    }
}

Assert-Administrator

function Resolve-ExecutablePath {
    param(
        [string]$Executable,
        [string]$FallbackLabel
    )

    if (-not $Executable) {
        throw "Percorso $FallbackLabel non specificato."
    }

    if (Test-Path $Executable) {
        return (Resolve-Path $Executable).Path
    }

    $resolved = Get-Command $Executable -ErrorAction SilentlyContinue
    if ($resolved) {
        return $resolved.Path
    }

    throw @"
Prerequisito mancante: $FallbackLabel
Versione minima/supportata: Node.js >= $requiredNodeVersion con npm incluso
Motivo: il servizio Windows avvia il server OnlyBackup tramite Node.js.
Azione richiesta: installa Node.js LTS 20.x o superiore dal sito ufficiale https://nodejs.org/ e riapri PowerShell, oppure passa -NodePath con il percorso completo di node.exe.
Verifica: node --version
"@
}

function Assert-NodeVersion {
    param([Parameter(Mandatory = $true)][string]$Executable)

    $rawVersion = (& $Executable --version).Trim()
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
Motivo: il servizio Windows avvia il server OnlyBackup e le dipendenze npm richiedono Node.js moderno.
Azione richiesta: installa Node.js LTS 20.x o superiore dal sito ufficiale https://nodejs.org/ e riapri PowerShell, oppure passa -NodePath con un node.exe compatibile.
Verifica: node --version
"@
    }
}

function Assert-ServerSetupCompleted {
    param([Parameter(Mandatory = $true)][string]$ServerDirectory)

    $nodeModulesPath = Join-Path $ServerDirectory "node_modules"
    $usersFilePath = Join-Path $repoRoot "data\users\users.json"

    if (-not (Test-Path $nodeModulesPath)) {
        throw @"
Prerequisito di setup mancante: dipendenze npm server
Versione minima/supportata: package-lock.json del repository corrente
Motivo: il servizio Windows avvia il server senza eseguire npm ci automaticamente.
Azione richiesta: esegui powershell -ExecutionPolicy Bypass -File .\scripts\Initialize-OnlyBackup.ps1 prima di installare il servizio.
Verifica: Test-Path .\server\node_modules
"@
    }

    if (-not (Test-Path $usersFilePath)) {
        throw @"
Prerequisito di setup mancante: dati iniziali OnlyBackup
Versione minima/supportata: struttura data\ creata dallo script Initialize-OnlyBackup.ps1
Motivo: al primo avvio il servizio deve trovare utente admin e directory dati gia inizializzati.
Azione richiesta: esegui powershell -ExecutionPolicy Bypass -File .\scripts\Initialize-OnlyBackup.ps1 -InitialAdminPassword "ChangeMe123!" prima di installare il servizio.
Verifica: Test-Path .\data\users\users.json
"@
    }
}
if (-not $AppDirectory) {
    $AppDirectory = Join-Path $repoRoot "server"
}

if (-not (Test-Path $AppDirectory)) {
    throw "Directory server non trovata: $AppDirectory"
}

$nodeExecutable = $NodePath
if (-not $nodeExecutable) {
    $nodeExecutable = "node"
}

$nssmExecutable = Resolve-NssmExecutablePath -Executable $NssmPath
$nodeExecutable = Resolve-ExecutablePath -Executable $nodeExecutable -FallbackLabel "node"
Assert-NodeVersion -Executable $nodeExecutable

$serverEntry = Join-Path $AppDirectory "src\server.js"
if (-not (Test-Path $serverEntry)) {
    throw "Entry server non trovata: $serverEntry"
}

Assert-ServerSetupCompleted -ServerDirectory $AppDirectory

$logsDir = Join-Path $repoRoot "logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir | Out-Null
}

Invoke-Nssm -Executable $nssmExecutable -Arguments @("install", $ServiceName, $nodeExecutable, $serverEntry)
Invoke-Nssm -Executable $nssmExecutable -Arguments @("set", $ServiceName, "AppDirectory", $AppDirectory)

if ($ConfigPath) {
    if (-not (Test-Path $ConfigPath)) {
        throw "CONFIG_PATH non trovato: $ConfigPath"
    }
    Invoke-Nssm -Executable $nssmExecutable -Arguments @("set", $ServiceName, "AppEnvironmentExtra", "CONFIG_PATH=$ConfigPath")
}

Invoke-Nssm -Executable $nssmExecutable -Arguments @("set", $ServiceName, "AppStdout", (Join-Path $logsDir "server-stdout.log"))
Invoke-Nssm -Executable $nssmExecutable -Arguments @("set", $ServiceName, "AppStderr", (Join-Path $logsDir "server-stderr.log"))
Invoke-Nssm -Executable $nssmExecutable -Arguments @("set", $ServiceName, "Start", "SERVICE_AUTO_START")

Write-Host "Servizio $ServiceName installato con successo." -ForegroundColor Green
