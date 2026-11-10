[CmdletBinding()]
param(
    [string]$ServiceName = "OnlyBackupServer",
    [string]$NodePath = "",
    [string]$ConfigPath = "",
    [string]$AppDirectory = "",
    [string]$ServiceBinaryDirectory = "",
    [switch]$SkipBuild,
    [switch]$StartService
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$requiredNodeVersion = [version]"20.19.0"

function Test-DotNet462OrNewerInstalled {
    foreach ($keyPath in @(
        "HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\NET Framework Setup\NDP\v4\Full"
    )) {
        try {
            $release = (Get-ItemProperty -LiteralPath $keyPath -Name Release -ErrorAction Stop).Release
            if ($release -ge 394802) {
                return $true
            }
        }
        catch {
        }
    }

    return $false
}

function Assert-DotNetRuntime {
    if (Test-DotNet462OrNewerInstalled) {
        return
    }

    throw @"
Prerequisito mancante/non compatibile: .NET Framework runtime
Versione minima/supportata: >= 4.6.2
Motivo: OnlyBackupServerService.exe richiede .NET Framework 4.6.2 o superiore per installarsi e avviare il server come servizio Windows.
Azione richiesta: installa .NET Framework 4.6.2 o superiore dal sito ufficiale Microsoft, oppure usa il package/installer server che include il payload offline .NET verificato.
Verifica: Test-Path 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319'
"@
}

function Assert-Administrator {
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).
        IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

    if (-not $isAdmin) {
        throw "Questo script richiede privilegi di amministratore."
    }
}

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
Azione richiesta: esegui powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1 prima di installare il servizio.
Verifica: Test-Path .\server\node_modules
"@
    }

    if (-not (Test-Path $usersFilePath)) {
        throw @"
Prerequisito di setup mancante: dati iniziali OnlyBackup
Versione minima/supportata: struttura data\ creata dallo script Setup-OnlyBackupServer.ps1
Motivo: al primo avvio il servizio deve trovare utente admin e directory dati gia inizializzati.
Azione richiesta: esegui powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1 -InitialAdminPassword "ChangeMe123!" prima di installare il servizio.
Verifica: Test-Path .\data\users\users.json
"@
    }
}

function Set-AppSetting {
    param(
        [xml]$ConfigXml,
        [string]$Key,
        [string]$Value
    )

    $node = $ConfigXml.configuration.appSettings.add | Where-Object { $_.key -eq $Key } | Select-Object -First 1
    if ($node) {
        $node.value = $Value
        return
    }

    $newNode = $ConfigXml.CreateElement("add")
    $newNode.SetAttribute("key", $Key)
    $newNode.SetAttribute("value", $Value)
    [void]$ConfigXml.configuration.appSettings.AppendChild($newNode)
}

Assert-Administrator
Assert-DotNetRuntime

if ($ServiceName -ne "OnlyBackupServer") {
    throw "Il wrapper integrato supporta il nome servizio fisso OnlyBackupServer."
}

if (-not $AppDirectory) {
    $AppDirectory = Join-Path $repoRoot "server"
}

if (-not $ServiceBinaryDirectory) {
    $ServiceBinaryDirectory = Join-Path $repoRoot "output\server-service"
}

if (-not (Test-Path $AppDirectory)) {
    throw "Directory server non trovata: $AppDirectory"
}

$nodeExecutable = if ($NodePath) { $NodePath } else { "node" }
$nodeExecutable = Resolve-ExecutablePath -Executable $nodeExecutable -FallbackLabel "node"
Assert-NodeVersion -Executable $nodeExecutable

$serverEntry = Join-Path $AppDirectory "src\server.js"
if (-not (Test-Path $serverEntry)) {
    throw "Entry server non trovata: $serverEntry"
}

if ($ConfigPath -and -not (Test-Path $ConfigPath)) {
    throw "CONFIG_PATH non trovato: $ConfigPath"
}

Assert-ServerSetupCompleted -ServerDirectory $AppDirectory

if (-not $SkipBuild) {
    & (Join-Path $PSScriptRoot "support\Build-OnlyBackupServerService.ps1") -OutputDirectory $ServiceBinaryDirectory
    if ($LASTEXITCODE -ne 0) {
        throw "Build servizio server fallita con exit code $LASTEXITCODE"
    }
}

$serviceExecutable = Join-Path $ServiceBinaryDirectory "OnlyBackupServerService.exe"
$serviceConfig = Join-Path $ServiceBinaryDirectory "OnlyBackupServerService.exe.config"

if (-not (Test-Path $serviceExecutable)) {
    throw "Eseguibile servizio server non trovato: $serviceExecutable"
}

if (-not (Test-Path $serviceConfig)) {
    throw "Config servizio server non trovata: $serviceConfig"
}

[xml]$configXml = Get-Content $serviceConfig
Set-AppSetting -ConfigXml $configXml -Key "NodePath" -Value $nodeExecutable
Set-AppSetting -ConfigXml $configXml -Key "ServerDirectory" -Value (Resolve-Path $AppDirectory).Path
Set-AppSetting -ConfigXml $configXml -Key "ConfigPath" -Value $(if ($ConfigPath) { (Resolve-Path $ConfigPath).Path } else { "" })
$configXml.Save($serviceConfig)

& $serviceExecutable /install
if ($LASTEXITCODE -ne 0) {
    throw "Installazione servizio fallita con exit code $LASTEXITCODE"
}

if ($StartService) {
    Start-Service -Name $ServiceName
}

Write-Host "Servizio $ServiceName installato con strumenti Windows integrati." -ForegroundColor Green
Write-Host "Eseguibile: $serviceExecutable" -ForegroundColor Green
