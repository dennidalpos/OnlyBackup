

[CmdletBinding()]
param(
    [Parameter()]
    [string]$ServerHost,

    [Parameter()]
    [switch]$UseLocalhost,

    [Parameter()]
    [string]$WixPath = "C:\Program Files (x86)\WiX Toolset v3.14\bin",

    [Parameter()]
    [string]$MsBuildPath = "C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe",

    [Parameter()]
    [string]$Configuration = "Release",

    [Parameter()]
    [string]$OutputDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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

Write-Header "OnlyBackup Agent - Build MSI Script"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$AgentDir = Join-Path $RootDir "agent"
$SolutionFile = Join-Path $AgentDir "OnlyBackupAgent.sln"
$ProjectDir = Join-Path $AgentDir "OnlyBackupAgent"
$BuildBinDir = Join-Path $ProjectDir "bin\$Configuration"
$WixDir = Join-Path $ScriptDir "wix"
$PayloadDir = Join-Path $WixDir "payload"
$SourceNetFxInstaller = Join-Path $PayloadDir "NDP462-KB3151800-x86-x64-AllOS-ENU.exe"

if (-not $OutputDir) {
    $OutputDir = Join-Path $RootDir "output"
}

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$OutputDir = (Resolve-Path $OutputDir).Path
$StagingRoot = Join-Path $OutputDir "agent-msi"
$BinDir = Join-Path $StagingRoot "bin"
$ArtifactsDir = Join-Path $StagingRoot "artifacts"
$NetFxInstaller = Join-Path $StagingRoot "NDP462-KB3151800-x86-x64-AllOS-ENU.exe"

if (Test-Path $StagingRoot) {
    Remove-Item -Path $StagingRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
New-Item -ItemType Directory -Path $ArtifactsDir -Force | Out-Null

Write-Info "Root Directory: $RootDir"
Write-Info "Agent Directory: $AgentDir"
Write-Info "Output Directory: $OutputDir"
Write-Info "Staging Directory: $StagingRoot"
Write-Info "Configurazione: $Configuration"

Write-Header "Verifica Prerequisiti"

if (-not (Test-Path $MsBuildPath)) {
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

$CandleExe = Join-Path $WixPath "candle.exe"
$LightExe = Join-Path $WixPath "light.exe"

if (-not (Test-Path $CandleExe) -or -not (Test-Path $LightExe)) {
    Write-ErrorMessage "WiX Toolset 3.14 non trovato in: $WixPath"
    Write-Info "Scarica WiX 3.14 da: https://github.com/wixtoolset/wix3/releases"
    exit 1
}

Write-Success "WiX Toolset 3.14 trovato: $WixPath"

Write-Header ".NET Framework 4.6.2 Offline Installer"

if (-not (Test-Path $PayloadDir)) {
    New-Item -ItemType Directory -Path $PayloadDir -Force | Out-Null
}

$NetFxUrl = "https://go.microsoft.com/fwlink/?linkid=780600"
$NetFxSha256 = "b4cbb4bc9a3983ec3be9f80447e0d619d15256a9ce66ff414ae6e3856705e237"

$securityProtocols = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls
if ([Enum]::IsDefined([Net.SecurityProtocolType], 'Tls13')) {
    $securityProtocols = $securityProtocols -bor [Net.SecurityProtocolType]::Tls13
}
[Net.ServicePointManager]::SecurityProtocol = $securityProtocols

function Get-Sha256 {
    param([string]$Path)
    (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLowerInvariant()
}

if (Test-Path $SourceNetFxInstaller) {
    $currentHash = Get-Sha256 -Path $SourceNetFxInstaller
    if ($currentHash -ne $NetFxSha256) {
        Write-Info "Checksum non valido per .NET Framework (trovato: $currentHash). Riscarico..."
        Remove-Item -Path $SourceNetFxInstaller -Force
    }
    else {
        Write-Info ".NET Framework 4.6.2 già presente con checksum valido: $SourceNetFxInstaller"
    }
}

if (-not (Test-Path $SourceNetFxInstaller)) {
    Write-Info "Download del pacchetto offline .NET Framework 4.6.2..."
    Invoke-WebRequest -Uri $NetFxUrl -OutFile $SourceNetFxInstaller
}

if (-not (Test-Path $SourceNetFxInstaller)) {
    Write-ErrorMessage "Download .NET Framework 4.6.2 non riuscito"
    exit 1
}

$downloadedHash = Get-Sha256 -Path $SourceNetFxInstaller
if ($downloadedHash -ne $NetFxSha256) {
    Write-ErrorMessage "Checksum .NET Framework non valido (atteso: $NetFxSha256, trovato: $downloadedHash)"
    exit 1
}

Copy-Item -Path $SourceNetFxInstaller -Destination $NetFxInstaller -Force

Write-Success "Installer .NET Framework 4.6.2 disponibile e verificato"

Write-Header "Configurazione Server"

$serverHostProvided = $PSBoundParameters.ContainsKey('ServerHost')

if ($UseLocalhost) {
    $ServerHost = "localhost"
    Write-Info "Modalità TEST: usando localhost"
}
elseif ($serverHostProvided) {
    if (-not $ServerHost) {
        Write-ErrorMessage "Parametro -ServerHost vuoto: interruzione build"
        exit 1
    }

    Write-Info "ServerHost impostato manualmente: $ServerHost"
}
else {
    Write-Host "Scegli configurazione server:" -ForegroundColor Yellow
    Write-Host "  1) localhost (test)"
    Write-Host "  2) Hostname/IP personalizzato (produzione)"
    Write-Host ""

    $choice = Read-Host "Scelta (1 o 2) [default: 1]"

    if ($choice -eq "2") {
        $ServerHost = Read-Host "Inserisci hostname o IP del server OnlyBackup"
        Write-Info "Configurazione PRODUZIONE: $ServerHost"
    }
    else {
        $ServerHost = "localhost"
        Write-Info "Configurazione TEST: localhost"
    }
}

if (-not $ServerHost) {
    Write-ErrorMessage "ServerHost non impostato: interruzione build"
    exit 1
}

Write-Success "Server configurato: $ServerHost"

Write-Header "Compilazione OnlyBackup Agent"

Write-Info "Pulizia solution..."
& $MsBuildPath $SolutionFile /t:Clean /p:Configuration=$Configuration /v:minimal /nologo

Write-Info "Build solution..."
& $MsBuildPath $SolutionFile /t:Build /p:Configuration=$Configuration /v:minimal /nologo

if ($LASTEXITCODE -ne 0) {
    Write-ErrorMessage "Errore durante la compilazione dell'agent"
    exit 1
}

Write-Success "Agent compilato con successo"

if (-not (Test-Path $BuildBinDir)) {
    Write-ErrorMessage "Cartella di build non trovata: $BuildBinDir"
    exit 1
}

Write-Info "Copia dei file compilati nella cartella di staging..."
Copy-Item -Path (Join-Path $BuildBinDir '*') -Destination $BinDir -Recurse -Force

if (-not (Test-Path (Join-Path $BinDir "OnlyBackupAgent.exe"))) {
    Write-ErrorMessage "OnlyBackupAgent.exe non trovato in $BinDir"
    exit 1
}

Write-Header "Creazione MSI con WiX 3.14"

$WxsFile = Join-Path $WixDir "AgentInstaller.wxs"
$WixObjFile = Join-Path $ArtifactsDir "AgentInstaller.wixobj"
$MsiFile = Join-Path $ArtifactsDir "OnlyBackupAgent.msi"

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
