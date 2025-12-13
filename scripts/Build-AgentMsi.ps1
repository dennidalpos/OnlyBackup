<#
.SYNOPSIS
    Build script per OnlyBackup Agent MSI usando WiX 3.14

.DESCRIPTION
    Questo script compila l'agent .NET e crea l'MSI usando WiX Toolset 3.14.
    Supporta configurazione interattiva per ambiente test (localhost) o produzione.

.PARAMETER ServerHost
    Hostname o IP del server OnlyBackup (default: richiede input interattivo)

.PARAMETER UseLocalhost
    Usa localhost come server (ambiente test)

.PARAMETER WixPath
    Path di installazione di WiX 3.14 (default: C:\Program Files (x86)\WiX Toolset v3.14\bin)

.EXAMPLE
    .\Build-AgentMsi.ps1
    Esecuzione interattiva con richiesta configurazione

.EXAMPLE
    .\Build-AgentMsi.ps1 -UseLocalhost
    Build per ambiente test con localhost

.EXAMPLE
    .\Build-AgentMsi.ps1 -ServerHost "backup.company.com"
    Build per produzione con server specificato
#>

[CmdletBinding()]
param(
    [Parameter()]
    [string]$ServerHost,

    [Parameter()]
    [switch]$UseLocalhost,

    [Parameter()]
    [string]$WixPath = "C:\Program Files (x86)\WiX Toolset v3.14\bin",

    [Parameter()]
    [string]$MsBuildPath = "C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Colori output
function Write-Header {
    param([string]$Message)
    Write-Host "`n================================================================================" -ForegroundColor Cyan
    Write-Host " $Message" -ForegroundColor Cyan
    Write-Host "================================================================================`n" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Yellow
}

function Write-ErrorMessage {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

# Banner iniziale
Write-Header "OnlyBackup Agent - Build MSI Script"

# Percorsi
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$AgentDir = Join-Path $RootDir "agent"
$SolutionFile = Join-Path $AgentDir "OnlyBackupAgent.sln"
$ProjectDir = Join-Path $AgentDir "OnlyBackupAgent"
$BinDir = Join-Path $ProjectDir "bin\Release"
$WixDir = Join-Path $ScriptDir "wix"
$PayloadDir = Join-Path $WixDir "payload"
$NetFxInstaller = Join-Path $PayloadDir "NDP462-KB3151800-x86-x64-AllOS-ENU.exe"
$OutputDir = Join-Path $RootDir "output"

Write-Info "Root Directory: $RootDir"
Write-Info "Agent Directory: $AgentDir"
Write-Info "Output Directory: $OutputDir"

# Verifica prerequisiti
Write-Header "Verifica Prerequisiti"

# Verifica MSBuild
if (-not (Test-Path $MsBuildPath)) {
    # Cerca MSBuild in path alternativi
    $AlternativePaths = @(
        "C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\MSBuild\Current\Bin\MSBuild.exe",
        "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\MSBuild\Current\Bin\MSBuild.exe",
        "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\MSBuild.exe"
    )

    $MsBuildFound = $false
    foreach ($path in $AlternativePaths) {
        if (Test-Path $path) {
            $MsBuildPath = $path
            $MsBuildFound = $true
            break
        }
    }

    if (-not $MsBuildFound) {
        Write-ErrorMessage "MSBuild non trovato. Installa Visual Studio o Build Tools."
        exit 1
    }
}

Write-Success "MSBuild trovato: $MsBuildPath"

# Verifica WiX
$CandleExe = Join-Path $WixPath "candle.exe"
$LightExe = Join-Path $WixPath "light.exe"

if (-not (Test-Path $CandleExe) -or -not (Test-Path $LightExe)) {
    Write-ErrorMessage "WiX Toolset 3.14 non trovato in: $WixPath"
    Write-Info "Scarica WiX 3.14 da: https://github.com/wixtoolset/wix3/releases"
    exit 1
}

Write-Success "WiX Toolset 3.14 trovato: $WixPath"

# Prerequisiti .NET Framework 4.6.2 (self contained)
Write-Header ".NET Framework 4.6.2 Offline Installer"

if (-not (Test-Path $PayloadDir)) {
    New-Item -ItemType Directory -Path $PayloadDir -Force | Out-Null
}

$NetFxUrl = "http://go.microsoft.com/fwlink/?linkid=780600"

if (-not (Test-Path $NetFxInstaller)) {
    Write-Info "Download del pacchetto offline .NET Framework 4.6.2..."
    Invoke-WebRequest -Uri $NetFxUrl -OutFile $NetFxInstaller
}
else {
    Write-Info "Pacchetto .NET Framework 4.6.2 già presente: $NetFxInstaller"
}

Write-Success "Installer .NET Framework 4.6.2 disponibile"

# Configurazione Server
Write-Header "Configurazione Server"

if ($UseLocalhost) {
    $ServerHost = "localhost"
    Write-Info "Modalità TEST: usando localhost"
}
elseif (-not $ServerHost) {
    Write-Host "Scegli configurazione server:" -ForegroundColor Yellow
    Write-Host "  1) localhost (test)"
    Write-Host "  2) Hostname/IP personalizzato (produzione)"
    Write-Host ""

    $choice = Read-Host "Scelta (1 o 2)"

    if ($choice -eq "1") {
        $ServerHost = "localhost"
        Write-Info "Configurazione TEST: localhost"
    }
    else {
        $ServerHost = Read-Host "Inserisci hostname o IP del server OnlyBackup"
        Write-Info "Configurazione PRODUZIONE: $ServerHost"
    }
}

Write-Success "Server configurato: $ServerHost"

# Aggiorna App.config con server host
Write-Header "Aggiornamento Configurazione"

$AppConfigPath = Join-Path $ProjectDir "App.config"
[xml]$AppConfig = Get-Content $AppConfigPath

$ServerHostSetting = $AppConfig.configuration.appSettings.add | Where-Object { $_.key -eq "ServerHost" }
if ($ServerHostSetting) {
    $ServerHostSetting.value = $ServerHost
    $AppConfig.Save($AppConfigPath)
    Write-Success "App.config aggiornato con ServerHost: $ServerHost"
}

# Compilazione Agent
Write-Header "Compilazione OnlyBackup Agent"

Write-Info "Pulizia solution..."
& $MsBuildPath $SolutionFile /t:Clean /p:Configuration=Release /v:minimal /nologo

Write-Info "Build solution..."
& $MsBuildPath $SolutionFile /t:Build /p:Configuration=Release /v:minimal /nologo

if ($LASTEXITCODE -ne 0) {
    Write-ErrorMessage "Errore durante la compilazione dell'agent"
    exit 1
}

Write-Success "Agent compilato con successo"

# Verifica output
if (-not (Test-Path (Join-Path $BinDir "OnlyBackupAgent.exe"))) {
    Write-ErrorMessage "OnlyBackupAgent.exe non trovato in $BinDir"
    exit 1
}

# Creazione output directory
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

# Build MSI con WiX
Write-Header "Creazione MSI con WiX 3.14"

$WxsFile = Join-Path $WixDir "AgentInstaller.wxs"
$WixObjFile = Join-Path $OutputDir "AgentInstaller.wixobj"
$MsiFile = Join-Path $OutputDir "OnlyBackupAgent.msi"

# Rimuovi file precedenti
if (Test-Path $WixObjFile) { Remove-Item $WixObjFile -Force }
if (Test-Path $MsiFile) { Remove-Item $MsiFile -Force }

Write-Info "Esecuzione candle.exe..."
$candleArgs = @(
    $WxsFile,
    "-out", $WixObjFile,
    "-dBinDir=$BinDir",
    "-dProjectDir=$ProjectDir",
    "-dNetFxInstaller=$NetFxInstaller",
    "-dServerHost=$ServerHost",
    "-ext", "WixUtilExtension",
    "-ext", "WixFirewallExtension",
    "-nologo"
)

& $CandleExe $candleArgs

if ($LASTEXITCODE -ne 0) {
    Write-ErrorMessage "Errore durante l'esecuzione di candle.exe"
    exit 1
}

Write-Success "candle.exe completato"

Write-Info "Esecuzione light.exe..."
$lightArgs = @(
    $WixObjFile,
    "-out", $MsiFile,
    "-ext", "WixUIExtension",
    "-ext", "WixUtilExtension",
    "-ext", "WixFirewallExtension",
    "-sval",
    "-nologo"
)

& $LightExe $lightArgs

if ($LASTEXITCODE -ne 0) {
    Write-ErrorMessage "Errore durante l'esecuzione di light.exe"
    exit 1
}

Write-Success "light.exe completato"

# Verifica MSI creato
if (-not (Test-Path $MsiFile)) {
    Write-ErrorMessage "MSI non creato"
    exit 1
}

$MsiSize = (Get-Item $MsiFile).Length / 1MB

Write-Header "Build Completato con Successo!"
Write-Success "MSI creato: $MsiFile"
Write-Success "Dimensione: $($MsiSize.ToString('F2')) MB"
Write-Success "Server configurato: $ServerHost"
Write-Host ""
Write-Info "Per installare l'agent su un client Windows:"
Write-Host "  msiexec /i OnlyBackupAgent.msi /qn" -ForegroundColor Cyan
Write-Host ""
