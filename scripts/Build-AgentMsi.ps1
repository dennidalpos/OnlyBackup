

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

# Variabile globale per file di log
$script:LogFile = $null

# Trap per gestione errori globali
trap {
    Write-Host "`n=== BUILD FALLITO CON ECCEZIONE ===" -ForegroundColor Red
    Write-Host "Errore: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Stack: $($_.ScriptStackTrace)" -ForegroundColor Yellow

    if ($script:LogFile -and (Test-Path $script:LogFile)) {
        Write-Host "`nLog completo salvato in: $script:LogFile" -ForegroundColor Yellow
    }

    if ($StagingRoot -and (Test-Path $StagingRoot)) {
        Write-Host "Directory di staging conservata per debug: $StagingRoot" -ForegroundColor Yellow
    }

    exit 1
}

function Initialize-BuildLog {
    param([string]$LogDir)

    if (-not (Test-Path $LogDir)) {
        New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    }

    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $script:LogFile = Join-Path $LogDir "build_$timestamp.log"

    "Build Log - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File -FilePath $script:LogFile
    "="*80 | Out-File -FilePath $script:LogFile -Append
    ""  | Out-File -FilePath $script:LogFile -Append
}

function Write-Log {
    param(
        [string]$Message,
        [ValidateSet('INFO', 'SUCCESS', 'WARNING', 'ERROR')]
        [string]$Level = 'INFO'
    )

    $timestamp = Get-Date -Format "HH:mm:ss"
    $logEntry = "[$timestamp] [$Level] $Message"

    if ($script:LogFile) {
        $logEntry | Out-File -FilePath $script:LogFile -Append
    }

    switch ($Level) {
        'SUCCESS' { Write-Host "[OK] $Message" -ForegroundColor Green }
        'ERROR' { Write-Host "[ERROR] $Message" -ForegroundColor Red }
        'WARNING' { Write-Host "[INFO] $Message" -ForegroundColor Yellow }
        default { Write-Host "[INFO] $Message" -ForegroundColor Yellow }
    }
}

function Write-Header {
    param([string]$Message)
    Write-Host "`n================================================================================" -ForegroundColor Cyan
    Write-Host " $Message" -ForegroundColor Cyan
    Write-Host "================================================================================`n" -ForegroundColor Cyan

    if ($script:LogFile) {
        "" | Out-File -FilePath $script:LogFile -Append
        "="*80 | Out-File -FilePath $script:LogFile -Append
        " $Message" | Out-File -FilePath $script:LogFile -Append
        "="*80 | Out-File -FilePath $script:LogFile -Append
        "" | Out-File -FilePath $script:LogFile -Append
    }
}

function Write-Success {
    param([string]$Message)
    Write-Log -Message $Message -Level SUCCESS
}

function Write-Info {
    param([string]$Message)
    Write-Log -Message $Message -Level INFO
}

function Write-ErrorMessage {
    param([string]$Message)
    Write-Log -Message $Message -Level ERROR
}

function Test-BuildPrerequisites {
    param(
        [string]$ProjectDir,
        [string]$RootDir,
        [string]$OutputDir
    )

    $errors = @()

    # Verifica file richiesti da WiX
    $requiredFiles = @(
        @{Path = (Join-Path $ProjectDir "License.rtf"); Description = "License file"},
        @{Path = (Join-Path $RootDir "server\package.json"); Description = "Server package.json"},
        @{Path = (Join-Path $RootDir "server\src\server.js"); Description = "Server main script"},
        @{Path = (Join-Path $RootDir "config.json"); Description = "Config file"}
    )

    foreach ($file in $requiredFiles) {
        if (-not (Test-Path $file.Path)) {
            $errors += "File richiesto mancante: $($file.Description) in $($file.Path)"
        }
    }

    # Verifica spazio disco disponibile (minimo 500MB)
    $outputDrive = Split-Path -Qualifier $OutputDir
    if ($outputDrive) {
        try {
            $drive = Get-PSDrive -Name $outputDrive.Trim(':') -ErrorAction Stop
            $freeSpaceGB = $drive.Free / 1GB
            if ($freeSpaceGB -lt 0.5) {
                $errors += "Spazio disco insufficiente su $outputDrive (liberi: $($freeSpaceGB.ToString('F2'))GB, richiesti: 0.5GB)"
            }
        }
        catch {
            Write-Log "Impossibile verificare spazio disco su $outputDrive" -Level WARNING
        }
    }

    if ($errors.Count -gt 0) {
        Write-Log "=== ERRORI DI VALIDAZIONE PRE-BUILD ===" -Level ERROR
        foreach ($error in $errors) {
            Write-Log $error -Level ERROR
        }
        return $false
    }

    Write-Log "Validazione pre-build completata con successo" -Level SUCCESS
    return $true
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
$LogDir = Join-Path $StagingRoot "logs"
$NetFxInstaller = Join-Path $StagingRoot "NDP462-KB3151800-x86-x64-AllOS-ENU.exe"

if (Test-Path $StagingRoot) {
    Remove-Item -Path $StagingRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
New-Item -ItemType Directory -Path $ArtifactsDir -Force | Out-Null
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

# Inizializza sistema di logging
Initialize-BuildLog -LogDir $LogDir

Write-Info "Root Directory: $RootDir"
Write-Info "Agent Directory: $AgentDir"
Write-Info "Output Directory: $OutputDir"
Write-Info "Staging Directory: $StagingRoot"
Write-Info "Log Directory: $LogDir"
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

Write-Header "Validazione Pre-Build"

if (-not (Test-BuildPrerequisites -ProjectDir $ProjectDir -RootDir $RootDir -OutputDir $OutputDir)) {
    Write-ErrorMessage "Build interrotta per errori di validazione"
    exit 1
}

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

# Verifica se file esiste e valida checksum
if (Test-Path $SourceNetFxInstaller) {
    Write-Info "Verifica checksum .NET Framework 4.6.2..."
    $currentHash = Get-Sha256 -Path $SourceNetFxInstaller
    if ($currentHash -ne $NetFxSha256) {
        Write-ErrorMessage "Checksum non valido (trovato: $currentHash, atteso: $NetFxSha256)"
        Write-Info "File potrebbe essere corrotto. Rimuovo e riscarico..."
        Remove-Item -Path $SourceNetFxInstaller -Force
    }
    else {
        Write-Success ".NET Framework 4.6.2 checksum valido"
    }
}

# Download se non esiste o era corrotto
if (-not (Test-Path $SourceNetFxInstaller)) {
    Write-Info "Download .NET Framework 4.6.2 offline installer..."
    try {
        Invoke-WebRequest -Uri $NetFxUrl -OutFile $SourceNetFxInstaller -TimeoutSec 300
        Write-Success "Download completato"
    }
    catch {
        Write-ErrorMessage "Errore durante il download: $_"
        exit 1
    }
}

# Verifica file esiste dopo download
if (-not (Test-Path $SourceNetFxInstaller)) {
    Write-ErrorMessage "Download .NET Framework 4.6.2 non riuscito"
    exit 1
}

# Verifica finale checksum prima di copiare nello staging
Write-Info "Verifica finale checksum prima di staging..."
$finalHash = Get-Sha256 -Path $SourceNetFxInstaller
if ($finalHash -ne $NetFxSha256) {
    Write-ErrorMessage "Checksum finale non valido dopo download/verifica"
    Write-ErrorMessage "Atteso: $NetFxSha256"
    Write-ErrorMessage "Trovato: $finalHash"
    exit 1
}

Copy-Item -Path $SourceNetFxInstaller -Destination $NetFxInstaller -Force

Write-Success ".NET Framework installer pronto e verificato"

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

$candleLogFile = Join-Path $LogDir "candle.log"
$candleArgs = @(
    $WxsFile,
    "-out", $WixObjFile,
    "-dBinDir=$BinDir",
    "-dProjectDir=$ProjectDir",
    "-dRootDir=$RootDir",
    "-dPayloadDir=$PayloadDir",
    "-dNetFxInstaller=$NetFxInstaller",
    "-dServerHost=$ServerHost",
    "-ext", "WixUtilExtension",
    "-ext", "WixFirewallExtension",
    "-v"  # Verbose output
)

$candleOutput = & $CandleExe $candleArgs 2>&1 | Tee-Object -FilePath $candleLogFile

if ($LASTEXITCODE -ne 0) {
    Write-ErrorMessage "=== ERRORE CANDLE.EXE (exit code: $LASTEXITCODE) ==="
    Write-ErrorMessage "Log completo salvato in: $candleLogFile"
    $candleOutput | ForEach-Object {
        if ($_ -is [string]) {
            Write-Log $_ -Level ERROR
        }
    }
    exit 1
}

Write-Success "candle.exe completato con successo"
Write-Info "Log salvato in: $candleLogFile"

Write-Info "Esecuzione light.exe..."

$lightLogFile = Join-Path $LogDir "light.log"
$lightArgs = @(
    $WixObjFile,
    "-out", $MsiFile,
    "-ext", "WixUIExtension",
    "-ext", "WixUtilExtension",
    "-ext", "WixFirewallExtension",
    "-sval",
    "-v"  # Verbose output
)

$lightOutput = & $LightExe $lightArgs 2>&1 | Tee-Object -FilePath $lightLogFile

if ($LASTEXITCODE -ne 0) {
    Write-ErrorMessage "=== ERRORE LIGHT.EXE (exit code: $LASTEXITCODE) ==="
    Write-ErrorMessage "Log completo salvato in: $lightLogFile"
    $lightOutput | ForEach-Object {
        if ($_ -is [string]) {
            Write-Log $_ -Level ERROR
        }
    }
    exit 1
}

Write-Success "light.exe completato con successo"
Write-Info "Log salvato in: $lightLogFile"

if (-not (Test-Path $MsiFile)) {
    Write-ErrorMessage "MSI non creato"
    exit 1
}

$MsiSize = (Get-Item $MsiFile).Length / 1MB

Write-Header "Validazione MSI Package"

$validateScript = Join-Path $ScriptDir "Validate-MsiPackage.ps1"
if (Test-Path $validateScript) {
    try {
        & $validateScript -MsiPath $MsiFile
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Validazione MSI completata con successo"
        }
        else {
            Write-ErrorMessage "Validazione MSI fallita"
            exit 1
        }
    }
    catch {
        Write-ErrorMessage "Errore durante validazione MSI: $_"
        exit 1
    }
}
else {
    Write-Info "Script di validazione non trovato, salto validazione"
}

Write-Header "Build Completato con Successo!"
Write-Success "MSI creato: $MsiFile"
Write-Success "Dimensione: $($MsiSize.ToString('F2')) MB"
Write-Success "Server configurato: $ServerHost"

if ($script:LogFile) {
    Write-Success "Log build salvato: $script:LogFile"
}

Write-Host ""
Write-Info "Per installare l'agent su un client Windows:"
Write-Host "  msiexec /i OnlyBackupAgent.msi /qn" -ForegroundColor Cyan
Write-Host ""
Write-Info "Per testare l'upgrade (sviluppatori):"
Write-Host "  .\scripts\Test-MsiUpgrade.ps1 -OldMsiPath <vecchio.msi> -NewMsiPath $MsiFile" -ForegroundColor Cyan
Write-Host ""
