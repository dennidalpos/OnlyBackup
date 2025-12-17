

[CmdletBinding()]
param(
    [Parameter()]
    [string]$ServerHost,

    [Parameter()]
    [int]$ServerPort = 8080,

    [Parameter()]
    [int]$AgentPort = 8081,

    [Parameter()]
    [string]$AgentApiKey,

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

function Show-Menu {
    param([string]$Title)
    Write-Host ""
    Write-Host "================================================================================" -ForegroundColor Cyan
    Write-Host " $Title" -ForegroundColor Cyan
    Write-Host "================================================================================`n" -ForegroundColor Cyan
}

function Read-ValidatedPort {
    param(
        [string]$Prompt,
        [int]$Default
    )

    while ($true) {
        $input = Read-Host "$Prompt [default: $Default]"

        if ([string]::IsNullOrWhiteSpace($input)) {
            return $Default
        }

        $port = 0
        if ([int]::TryParse($input, [ref]$port)) {
            if ($port -ge 1 -and $port -le 65535) {
                return $port
            }
            else {
                Write-Host "  [!] Porta non valida. Deve essere tra 1 e 65535." -ForegroundColor Red
            }
        }
        else {
            Write-Host "  [!] Input non valido. Inserisci un numero." -ForegroundColor Red
        }
    }
}

function Read-NonEmptyString {
    param(
        [string]$Prompt,
        [string]$ErrorMessage = "Valore richiesto. Riprova."
    )

    while ($true) {
        $input = Read-Host $Prompt

        if (-not [string]::IsNullOrWhiteSpace($input)) {
            return $input.Trim()
        }

        Write-Host "  [!] $ErrorMessage" -ForegroundColor Red
    }
}

function Read-OptionalString {
    param(
        [string]$Prompt,
        [string]$Default = ""
    )

    $input = Read-Host "$Prompt [opzionale, premi INVIO per saltare]"

    if ([string]::IsNullOrWhiteSpace($input)) {
        return $Default
    }

    return $input.Trim()
}

function Show-ConfigurationSummary {
    param(
        [string]$ServerHost,
        [int]$ServerPort,
        [int]$AgentPort,
        [string]$AgentApiKey
    )

    Write-Host ""
    Write-Host "================================================================================" -ForegroundColor Green
    Write-Host " RIEPILOGO CONFIGURAZIONE" -ForegroundColor Green
    Write-Host "================================================================================`n" -ForegroundColor Green

    Write-Host "  Server OnlyBackup:" -ForegroundColor White
    Write-Host "    - Host:     $ServerHost" -ForegroundColor Cyan
    Write-Host "    - Porta:    $ServerPort" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Agent:" -ForegroundColor White
    Write-Host "    - Porta:    $AgentPort" -ForegroundColor Cyan

    if ($AgentApiKey) {
        $maskedKey = $AgentApiKey.Substring(0, [Math]::Min(8, $AgentApiKey.Length)) + "..." + $AgentApiKey.Substring([Math]::Max(0, $AgentApiKey.Length - 4))
        Write-Host "    - API Key:  $maskedKey (configurata)" -ForegroundColor Cyan
    }
    else {
        Write-Host "    - API Key:  Non configurata" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "  Pacchetto MSI configurerà automaticamente:" -ForegroundColor White
    Write-Host "    - File:     C:\Program Files\OnlyBackup\Agent\OnlyBackupAgent.exe.config" -ForegroundColor Gray
    Write-Host "    - Servizio: OnlyBackup Agent (avvio automatico)" -ForegroundColor Gray
    Write-Host "    - Firewall: Regola per porta $AgentPort/TCP" -ForegroundColor Gray
    Write-Host ""
    Write-Host "================================================================================`n" -ForegroundColor Green
}

function Confirm-Proceed {
    param([string]$Message = "Procedere con il build?")

    Write-Host "$Message [S/n]: " -ForegroundColor Yellow -NoNewline
    $response = Read-Host

    return ($response -eq "" -or $response -eq "S" -or $response -eq "s" -or $response -eq "Y" -or $response -eq "y")
}

function Invoke-InteractiveConfiguration {
    Show-Menu "CONFIGURAZIONE INTERATTIVA MSI AGENT"

    Write-Host "Configureremo i seguenti parametri:" -ForegroundColor White
    Write-Host "  1. Hostname/IP del server OnlyBackup"
    Write-Host "  2. Porta del server (default: 8080)"
    Write-Host "  3. Porta dell'agent (default: 8081)"
    Write-Host "  4. API Key per autenticazione (opzionale)"
    Write-Host ""

    # Modalità server
    Write-Host "Modalità build:" -ForegroundColor Yellow
    Write-Host "  [1] Test locale (localhost)"
    Write-Host "  [2] Produzione (hostname/IP personalizzato)"
    Write-Host ""

    $mode = Read-Host "Scegli modalità [1 o 2, default: 1]"
    Write-Host ""

    if ($mode -eq "2") {
        Write-Host "=== CONFIGURAZIONE PRODUZIONE ===" -ForegroundColor Green
        Write-Host ""
        $serverHost = Read-NonEmptyString -Prompt "Hostname o IP del server OnlyBackup" -ErrorMessage "Hostname obbligatorio per configurazione produzione"
    }
    else {
        Write-Host "=== CONFIGURAZIONE TEST ===" -ForegroundColor Yellow
        Write-Host ""
        $serverHost = "localhost"
        Write-Host "Server impostato a: localhost" -ForegroundColor Cyan
    }

    Write-Host ""

    # Porta server
    Write-Host "Configurazione porte:" -ForegroundColor Yellow
    $serverPort = Read-ValidatedPort -Prompt "Porta server OnlyBackup" -Default 8080

    # Porta agent
    $agentPort = Read-ValidatedPort -Prompt "Porta agent (listener)" -Default 8081

    Write-Host ""

    # API Key
    Write-Host "Autenticazione:" -ForegroundColor Yellow
    Write-Host "L'API Key è opzionale ma FORTEMENTE CONSIGLIATA per ambienti di produzione." -ForegroundColor Gray
    Write-Host "Puoi generarla con: [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))" -ForegroundColor Gray
    Write-Host ""

    $agentApiKey = Read-OptionalString -Prompt "API Key per autenticazione"

    # Validazione API Key (se fornita, controlla che abbia una lunghezza minima)
    if ($agentApiKey -and $agentApiKey.Length -lt 16) {
        Write-Host ""
        Write-Host "  [!] ATTENZIONE: API Key molto corta (< 16 caratteri). Non sicura!" -ForegroundColor Red
        Write-Host "      Consigliata lunghezza minima: 32 caratteri" -ForegroundColor Yellow
        Write-Host ""

        if (-not (Confirm-Proceed -Message "Continuare comunque con questa API Key?")) {
            Write-Host ""
            $agentApiKey = Read-OptionalString -Prompt "Inserisci una nuova API Key (o premi INVIO per nessuna API Key)"
        }
    }

    # Mostra riepilogo
    Show-ConfigurationSummary -ServerHost $serverHost -ServerPort $serverPort -AgentPort $agentPort -AgentApiKey $agentApiKey

    # Conferma
    if (-not (Confirm-Proceed)) {
        Write-Host ""
        Write-ErrorMessage "Build annullato dall'utente."
        exit 0
    }

    return @{
        ServerHost = $serverHost
        ServerPort = $serverPort
        AgentPort = $agentPort
        AgentApiKey = $agentApiKey
    }
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

# Determina se i parametri sono stati forniti da riga di comando
$serverHostProvided = $PSBoundParameters.ContainsKey('ServerHost')
$serverPortProvided = $PSBoundParameters.ContainsKey('ServerPort')
$agentPortProvided = $PSBoundParameters.ContainsKey('AgentPort')
$agentApiKeyProvided = $PSBoundParameters.ContainsKey('AgentApiKey')

# Calcola quanti parametri sono stati forniti
$providedParamsCount = @($serverHostProvided, $serverPortProvided, $agentPortProvided, $agentApiKeyProvided) | Where-Object { $_ } | Measure-Object | Select-Object -ExpandProperty Count

# Se UseLocalhost è specificato, configura e salta il menu
if ($UseLocalhost) {
    $ServerHost = "localhost"
    Write-Info "Modalità TEST: usando localhost"
    Write-Info "Porta server: $ServerPort"
    Write-Info "Porta agent: $AgentPort"

    if ($AgentApiKey) {
        $maskedKey = $AgentApiKey.Substring(0, [Math]::Min(8, $AgentApiKey.Length)) + "..." + $AgentApiKey.Substring([Math]::Max(0, $AgentApiKey.Length - 4))
        Write-Info "API Key configurata: $maskedKey"
    } else {
        Write-Info "API Key: non configurata"
    }
}
# Se tutti i parametri essenziali sono forniti, usa quelli (modalità non-interattiva)
elseif ($serverHostProvided) {
    if (-not $ServerHost) {
        Write-ErrorMessage "Parametro -ServerHost vuoto: interruzione build"
        exit 1
    }

    Write-Info "Modalità non-interattiva: parametri da riga di comando"
    Write-Info "ServerHost: $ServerHost"
    Write-Info "ServerPort: $ServerPort"
    Write-Info "AgentPort: $AgentPort"

    if ($AgentApiKey) {
        $maskedKey = $AgentApiKey.Substring(0, [Math]::Min(8, $AgentApiKey.Length)) + "..." + $AgentApiKey.Substring([Math]::Max(0, $AgentApiKey.Length - 4))
        Write-Info "API Key configurata: $maskedKey"
    } else {
        Write-Info "API Key: non configurata"
    }
}
# Nessun parametro fornito o parametri parziali: modalità interattiva
else {
    if ($providedParamsCount -gt 0) {
        Write-Info "Alcuni parametri forniti, ma ServerHost mancante. Avvio modalità interattiva..."
        Write-Host ""
    }

    $config = Invoke-InteractiveConfiguration

    $ServerHost = $config.ServerHost
    $ServerPort = $config.ServerPort
    $AgentPort = $config.AgentPort
    $AgentApiKey = $config.AgentApiKey
}

# Validazione finale
if (-not $ServerHost) {
    Write-ErrorMessage "ServerHost non impostato: interruzione build"
    exit 1
}

Write-Success "Configurazione completata!"

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
    "-dServerPort=$ServerPort",
    "-dAgentPort=$AgentPort",
    "-ext", "WixUtilExtension",
    "-ext", "WixFirewallExtension",
    "-nologo"
)

if ($AgentApiKey) {
    $candleArgs += "-dAgentApiKey=$AgentApiKey"
}

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
Write-Success "Server configurato: $ServerHost`:$ServerPort"
Write-Success "Porta agent: $AgentPort"
if ($AgentApiKey) {
    Write-Success "API Key: configurata nel pacchetto MSI"
} else {
    Write-Info "API Key: non configurata (richiesta durante installazione)"
}
Write-Host ""
Write-Info "Per installare l'agent su un client Windows:"
Write-Host "  msiexec /i OnlyBackupAgent.msi /qn" -ForegroundColor Cyan
Write-Host ""
Write-Info "Parametri usati per questo build:"
Write-Host "  .\Build-AgentMsi.ps1 -ServerHost `"$ServerHost`" -ServerPort $ServerPort -AgentPort $AgentPort" -ForegroundColor Cyan
if ($AgentApiKey) {
    Write-Host "    -AgentApiKey `"<your-api-key>`"" -ForegroundColor Cyan
}
Write-Host ""
