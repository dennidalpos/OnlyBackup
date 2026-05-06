[CmdletBinding()]
param(
    [Parameter()]
    [string]$OutputDirectory = "",

    [Parameter()]
    [string]$PackageName = "OnlyBackupServerSetup",

    [Parameter()]
    [string]$NodePath = "node",

    [Parameter()]
    [string]$NpmPath = "npm",

    [Parameter()]
    [string]$MsBuildPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$scriptsRoot = Join-Path $repoRoot "scripts"
$serverSourceDir = Join-Path $repoRoot "server"
$agentSourceDir = Join-Path $repoRoot "agent"
$toolsWixDir = Join-Path $repoRoot "tools\wix314-binaries"
$configSourcePath = Join-Path $repoRoot "config.json"
$licenseSourcePath = Join-Path $repoRoot "LICENSE"
$buildServiceScript = Join-Path $PSScriptRoot "Build-OnlyBackupServerService.ps1"
$buildAgentMsiScript = Join-Path $scriptsRoot "Build-AgentMsi.ps1"
$requiredNodeVersion = [version]"20.19.0"
$dotNetRuntimePayload = Join-Path $scriptsRoot "support\wix\payload\NDP462-KB3151800-x86-x64-AllOS-ENU.exe"
$dotNetRuntimeUrl = "https://go.microsoft.com/fwlink/?linkid=780600"
$dotNetRuntimeSha256 = "b4cbb4bc9a3983ec3be9f80447e0d619d15256a9ce66ff414ae6e3856705e237"

if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $repoRoot "output\server-setup"
}

$OutputDirectory = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDirectory)
$packageRoot = Join-Path $OutputDirectory $PackageName
$serverPackageDir = Join-Path $packageRoot "server"
$agentPackageDir = Join-Path $packageRoot "agent"
$toolsPackageDir = Join-Path $packageRoot "tools"
$servicePackageDir = Join-Path $packageRoot "service"
$scriptsPackageDir = Join-Path $packageRoot "scripts"
$supportScriptsPackageDir = Join-Path $scriptsPackageDir "support"
$assetsPackageDir = Join-Path $packageRoot "assets\brand"
$agentAssetsPackageDir = Join-Path $packageRoot "assets\agent"
$prerequisitesPackageDir = Join-Path $packageRoot "prerequisites"
$zipPath = Join-Path $OutputDirectory "$PackageName.zip"

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

    if (Test-Path $Name) {
        return (Resolve-Path $Name).Path
    }

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
Motivo: serve per installare le dipendenze server nel pacchetto self-contained.
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

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLowerInvariant()
}

function Ensure-DotNetRuntimePayload {
    $payloadDir = Split-Path -Parent $dotNetRuntimePayload
    if (-not (Test-Path $payloadDir)) {
        New-Item -ItemType Directory -Path $payloadDir -Force | Out-Null
    }

    if (Test-Path $dotNetRuntimePayload) {
        $currentHash = Get-Sha256 -Path $dotNetRuntimePayload
        if ($currentHash -eq $dotNetRuntimeSha256) {
            return
        }

        Remove-Item -LiteralPath $dotNetRuntimePayload -Force
    }

    Write-Host "Download prerequisito .NET Framework 4.6.2 offline..." -ForegroundColor Cyan
    $securityProtocols = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls
    if ([Enum]::IsDefined([Net.SecurityProtocolType], "Tls13")) {
        $securityProtocols = $securityProtocols -bor [Net.SecurityProtocolType]::Tls13
    }
    [Net.ServicePointManager]::SecurityProtocol = $securityProtocols

    Invoke-WebRequest -Uri $dotNetRuntimeUrl -OutFile $dotNetRuntimePayload -TimeoutSec 300
    $downloadHash = Get-Sha256 -Path $dotNetRuntimePayload
    if ($downloadHash -ne $dotNetRuntimeSha256) {
        Remove-Item -LiteralPath $dotNetRuntimePayload -Force -ErrorAction SilentlyContinue
        throw "Checksum non valido per .NET Framework 4.6.2 offline installer. Atteso: $dotNetRuntimeSha256. Trovato: $downloadHash"
    }
}

function Copy-DirectoryContent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,

        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    if (-not (Test-Path $Source)) {
        throw "Directory sorgente non trovata: $Source"
    }

    if (Test-Path $Destination) {
        Remove-Item -LiteralPath $Destination -Recurse -Force
    }

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
    }
}

function Write-PackageInstallScript {
    param([Parameter(Mandatory = $true)][string]$Path)

    @'
[CmdletBinding()]
param(
    [Parameter()]
    [string]$InitialAdminPassword,

    [Parameter()]
    [string]$InitialAdminPasswordFile,

    [Parameter()]
    [string]$NodePath = "node",

    [Parameter()]
    [switch]$SkipDataInitialization,

    [Parameter()]
    [switch]$StartService
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$packageRoot = $PSScriptRoot
$serverDir = Join-Path $packageRoot "server"
$serviceDir = Join-Path $packageRoot "service"
$configPath = Join-Path $packageRoot "config.json"
$initDataScript = Join-Path $packageRoot "scripts\support\Initialize-OnlyBackupData.js"
$installServiceScript = Join-Path $packageRoot "scripts\Install-OnlyBackupServerService.ps1"
$requiredNodeVersion = [version]"20.19.0"

function Resolve-ExecutablePath {
    param([Parameter(Mandatory = $true)][string]$Executable)

    if (Test-Path $Executable) {
        return (Resolve-Path $Executable).Path
    }

    $command = Get-Command $Executable -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Path
    }

    throw @"
Prerequisito mancante: Node.js
Versione minima/supportata: >= $requiredNodeVersion
Motivo: il pacchetto server self-contained include le dipendenze npm, ma richiede il runtime Node.js per avviare OnlyBackup.
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
Motivo: il servizio OnlyBackup avvia il server tramite Node.js.
Azione richiesta: installa Node.js LTS 20.x o superiore dal sito ufficiale https://nodejs.org/ e riapri PowerShell.
Verifica: node --version
"@
    }
}

foreach ($requiredPath in @(
    $serverDir,
    (Join-Path $serverDir "src\server.js"),
    (Join-Path $serverDir "node_modules"),
    $serviceDir,
    (Join-Path $serviceDir "OnlyBackupServerService.exe"),
    (Join-Path $serviceDir "OnlyBackupServerService.exe.config"),
    $configPath,
    $initDataScript,
    $installServiceScript
)) {
    if (-not (Test-Path $requiredPath)) {
        throw "Pacchetto setup incompleto: manca $requiredPath"
    }
}

$nodeExecutable = Resolve-ExecutablePath -Executable $NodePath
Assert-NodeVersion -Executable $nodeExecutable

$effectiveInitialAdminPassword = $null
if ($PSBoundParameters.ContainsKey("InitialAdminPasswordFile")) {
    if (-not (Test-Path $InitialAdminPasswordFile)) {
        throw "File password admin iniziale non trovato: $InitialAdminPasswordFile"
    }

    $effectiveInitialAdminPassword = (Get-Content -Raw -LiteralPath $InitialAdminPasswordFile).TrimEnd("`r", "`n")
}
elseif ($PSBoundParameters.ContainsKey("InitialAdminPassword")) {
    $effectiveInitialAdminPassword = $InitialAdminPassword
}

if (-not $SkipDataInitialization) {
    $previousPassword = $env:ONLYBACKUP_INITIAL_ADMIN_PASSWORD
    $previousConfigPath = $env:CONFIG_PATH
    try {
        if ($null -ne $effectiveInitialAdminPassword) {
            $env:ONLYBACKUP_INITIAL_ADMIN_PASSWORD = $effectiveInitialAdminPassword
        }

        $env:CONFIG_PATH = $configPath
        Push-Location $packageRoot
        try {
            & $nodeExecutable $initDataScript
            if ($LASTEXITCODE -ne 0) {
                throw "Inizializzazione dati fallita con exit code $LASTEXITCODE"
            }
        }
        finally {
            Pop-Location
        }
    }
    finally {
        if ($null -ne $effectiveInitialAdminPassword) {
            if ($null -ne $previousPassword) {
                $env:ONLYBACKUP_INITIAL_ADMIN_PASSWORD = $previousPassword
            }
            else {
                Remove-Item Env:ONLYBACKUP_INITIAL_ADMIN_PASSWORD -ErrorAction SilentlyContinue
            }
        }

        if ($null -ne $previousConfigPath) {
            $env:CONFIG_PATH = $previousConfigPath
        }
        else {
            Remove-Item Env:CONFIG_PATH -ErrorAction SilentlyContinue
        }
    }
}

& $installServiceScript `
    -NodePath $nodeExecutable `
    -ConfigPath $configPath `
    -AppDirectory $serverDir `
    -ServiceBinaryDirectory $serviceDir `
    -SkipBuild `
    -StartService:$StartService

if ($LASTEXITCODE -ne 0) {
    throw "Installazione servizio server fallita con exit code $LASTEXITCODE"
}

Write-Host "Setup OnlyBackup Server completato." -ForegroundColor Green
'@ | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Write-PackageUninstallScript {
    param([Parameter(Mandatory = $true)][string]$Path)

    @'
[CmdletBinding()]
param(
    [Parameter()]
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$packageRoot = $PSScriptRoot
$uninstallServiceScript = Join-Path $packageRoot "scripts\Uninstall-OnlyBackupServerService.ps1"
$serviceDir = Join-Path $packageRoot "service"

if (-not (Test-Path $uninstallServiceScript)) {
    throw "Pacchetto setup incompleto: manca $uninstallServiceScript"
}

& $uninstallServiceScript -ServiceBinaryDirectory $serviceDir -Force:$Force
if ($LASTEXITCODE -ne 0) {
    throw "Rimozione servizio server fallita con exit code $LASTEXITCODE"
}
'@ | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Write-PackageReadme {
    param([Parameter(Mandatory = $true)][string]$Path)

    @'
# OnlyBackup Server Setup

Questo pacchetto contiene il server OnlyBackup pronto per l'installazione come servizio Windows.

## Contenuto

- `server\`: applicazione Node.js con dipendenze `node_modules` incluse.
- `agent\`: sorgenti e asset dell'agent Windows.
- `service\`: wrapper Windows Service gia compilato.
- `tools\wix314-binaries\`: toolchain WiX 3.14 usata per generare MSI agent.
- `config.json`: configurazione runtime modificabile prima dell'installazione.
- `assets\brand\`: loghi e immagini del prodotto.
- `assets\agent\`: icone e immagini dell'agent.
- `prerequisites\`: payload di prerequisiti incluso quando disponibile.
- `Install-OnlyBackupServer.ps1`: installazione servizio e inizializzazione dati.
- `Uninstall-OnlyBackupServer.ps1`: rimozione servizio.

## Prerequisiti sul PC target

- Windows.
- PowerShell 7+ consigliato.
- Node.js 20.19.0 o superiore disponibile nel PATH oppure passato con `-NodePath`.
- .NET Framework 4.6.2 runtime per eseguire il wrapper servizio.
- PowerShell avviata come amministratore per installare o rimuovere il servizio.
- Per generare MSI agent dalla UI admin: MSBuild e .NET Framework 4.6.2 Developer Pack/Targeting Pack sul server. WiX 3.14 e il payload offline .NET sono inclusi nel package.
- Sui client agent: Windows Installer, .NET Framework 4.6.2 runtime e `robocopy.exe` incluso in Windows.

Se `prerequisites\NDP462-KB3151800-x86-x64-AllOS-ENU.exe` e presente, e il runtime offline .NET Framework 4.6.2 usato dal progetto.

## Installazione

```powershell
pwsh -ExecutionPolicy Bypass -File .\Install-OnlyBackupServer.ps1 -InitialAdminPassword "ChangeMe123!" -StartService
```

## Rimozione servizio

```powershell
pwsh -ExecutionPolicy Bypass -File .\Uninstall-OnlyBackupServer.ps1 -Force
```
'@ | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Write-PrerequisitesManifest {
    param([Parameter(Mandatory = $true)][string]$Path)

    $manifest = [ordered]@{
        package = "OnlyBackup Server"
        generatedAt = (Get-Date).ToString("o")
        target = "Windows"
        selfContained = [ordered]@{
            serverApplication = $true
            npmDependencies = $true
            serviceWrapper = $true
            agentSource = $true
            agentMsiScript = $true
            wixToolset314 = $true
            dotNet462OfflineInstaller = $true
            brandAssets = $true
            agentAssets = $true
            configuration = $true
        }
        includedPrerequisites = @(
            [ordered]@{
                name = "WiX Toolset"
                version = "3.14"
                path = "tools\wix314-binaries"
                reason = "Usato dal server per generare l'MSI agent dalla UI admin."
            },
            [ordered]@{
                name = ".NET Framework offline installer"
                version = "4.6.2"
                path = "prerequisites\NDP462-KB3151800-x86-x64-AllOS-ENU.exe"
                reason = "Usato dall'installer server quando necessario e incluso come payload nell'MSI agent."
            }
        )
        manualPrerequisites = @(
            [ordered]@{
                name = "Node.js"
                version = ">= 20.19.0"
                reason = "Runtime richiesto per avviare il server OnlyBackup."
                verify = "node --version"
                install = "Installa Node.js LTS dal sito ufficiale https://nodejs.org/."
            },
            [ordered]@{
                name = ".NET Framework"
                version = ">= 4.6.2 runtime"
                reason = "Runtime richiesto dal wrapper Windows Service OnlyBackupServerService.exe."
                verify = "Test-Path 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319'"
                install = "Installa .NET Framework 4.6.2 o superiore. Usa il payload in prerequisites se presente."
            },
            [ordered]@{
                name = "PowerShell amministratore"
                version = "PowerShell 7+ consigliato"
                reason = "Necessario per registrare o rimuovere il servizio Windows."
                verify = "([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"
                install = "Apri PowerShell come amministratore."
            },
            [ordered]@{
                name = "MSBuild"
                version = "Visual Studio Build Tools 2019/2022 con supporto .NET Framework"
                reason = "Richiesto sul server per generare MSI agent dalla UI admin."
                verify = "Get-Command MSBuild.exe"
                install = "Installa Visual Studio Build Tools selezionando i componenti .NET Framework build tools."
            },
            [ordered]@{
                name = ".NET Framework 4.6.2 Developer Pack/Targeting Pack"
                version = "4.6.2"
                reason = "Richiesto da MSBuild per compilare l'agent C# prima del packaging MSI."
                verify = "Test-Path 'C:\Program Files (x86)\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.6.2\mscorlib.dll'"
                install = "Installa .NET Framework 4.6.2 Developer Pack o il targeting pack tramite Visual Studio Build Tools."
            },
            [ordered]@{
                name = "Robocopy"
                version = "Incluso in Windows 10/11"
                reason = "Richiesto sui client dove gira l'agent per eseguire copie backup affidabili."
                verify = "Get-Command robocopy.exe"
                install = "Usa un client Windows 10/11 aggiornato o ripara i componenti Windows se robocopy.exe manca da System32."
            }
        )
        includedAssets = @(
            "assets\brand\onlybackup-logo.svg",
            "assets\brand\onlybackup-logo-on-light.svg",
            "assets\brand\onlybackup-logo-320x80.png",
            "assets\brand\onlybackup-icon-192.png",
            "assets\brand\onlybackup-icon-512.png",
            "assets\brand\favicon.ico",
            "assets\agent\OnlyBackupAgent.ico",
            "assets\agent\OnlyBackupAgent.png"
        )
    }

    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Test-PackageContents {
    $requiredPackagePaths = @(
        (Join-Path $packageRoot "Install-OnlyBackupServer.ps1"),
        (Join-Path $packageRoot "Uninstall-OnlyBackupServer.ps1"),
        (Join-Path $packageRoot "INSTALL_SERVER.md"),
        (Join-Path $packageRoot "prerequisites.json"),
        (Join-Path $packageRoot "config.json"),
        (Join-Path $serverPackageDir "src\server.js"),
        (Join-Path $serverPackageDir "package.json"),
        (Join-Path $serverPackageDir "package-lock.json"),
        (Join-Path $serverPackageDir "node_modules\bcryptjs\package.json"),
        (Join-Path $serverPackageDir "public\assets\brand\onlybackup-logo.svg"),
        (Join-Path $agentPackageDir "OnlyBackupAgent.sln"),
        (Join-Path $agentPackageDir "OnlyBackupAgent\OnlyBackupAgent.csproj"),
        (Join-Path $agentPackageDir "OnlyBackupAgent\Assets\OnlyBackupAgent.ico"),
        (Join-Path $scriptsPackageDir "Build-AgentMsi.ps1"),
        (Join-Path $scriptsPackageDir "support\wix\AgentInstaller.wxs"),
        (Join-Path $toolsPackageDir "wix314-binaries\candle.exe"),
        (Join-Path $prerequisitesPackageDir "NDP462-KB3151800-x86-x64-AllOS-ENU.exe"),
        (Join-Path $scriptsPackageDir "support\wix\payload\NDP462-KB3151800-x86-x64-AllOS-ENU.exe"),
        (Join-Path $assetsPackageDir "onlybackup-logo.svg"),
        (Join-Path $agentAssetsPackageDir "OnlyBackupAgent.ico"),
        (Join-Path $servicePackageDir "OnlyBackupServerService.exe"),
        (Join-Path $servicePackageDir "OnlyBackupServerService.exe.config"),
        (Join-Path $scriptsPackageDir "support\Initialize-OnlyBackupData.js"),
        (Join-Path $scriptsPackageDir "Install-OnlyBackupServerService.ps1"),
        (Join-Path $scriptsPackageDir "Uninstall-OnlyBackupServerService.ps1")
    )

    foreach ($path in $requiredPackagePaths) {
        if (-not (Test-Path $path)) {
            throw "Pacchetto server incompleto: manca $path"
        }
    }
}

if (-not (Test-Path $serverSourceDir)) {
    throw "Directory server non trovata: $serverSourceDir"
}

foreach ($requiredSource in @(
    (Join-Path $serverSourceDir "package.json"),
    (Join-Path $serverSourceDir "package-lock.json"),
    (Join-Path $serverSourceDir "src\server.js"),
    (Join-Path $serverSourceDir "public\assets\brand\onlybackup-logo.svg"),
    (Join-Path $agentSourceDir "OnlyBackupAgent.sln"),
    (Join-Path $agentSourceDir "OnlyBackupAgent\OnlyBackupAgent.csproj"),
    (Join-Path $agentSourceDir "OnlyBackupAgent\Assets\OnlyBackupAgent.ico"),
    (Join-Path $scriptsRoot "support\wix\AgentInstaller.wxs"),
    $buildAgentMsiScript,
    (Join-Path $toolsWixDir "candle.exe"),
    (Join-Path $toolsWixDir "light.exe"),
    $configSourcePath,
    $buildServiceScript
)) {
    if (-not (Test-Path $requiredSource)) {
        throw "Sorgente richiesta non trovata: $requiredSource"
    }
}

$nodeExecutable = Resolve-RequiredCommand `
    -Name $NodePath `
    -SoftwareName "Node.js" `
    -MinimumVersion ">= $requiredNodeVersion" `
    -Reason "serve per installare le dipendenze server dentro il pacchetto self-contained" `
    -InstallInstruction "installa Node.js LTS 20.x o superiore dal sito ufficiale https://nodejs.org/ e riapri PowerShell" `
    -VerificationCommand "node --version"

Assert-NodeVersion -Executable $nodeExecutable

$npmExecutable = Resolve-RequiredCommand `
    -Name $NpmPath `
    -SoftwareName "npm" `
    -MinimumVersion "incluso con Node.js LTS 20.x o superiore" `
    -Reason "serve per eseguire npm ci e includere node_modules nel setup server" `
    -InstallInstruction "installa Node.js LTS dal sito ufficiale https://nodejs.org/ includendo npm, poi riapri PowerShell" `
    -VerificationCommand "npm --version"

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
if (Test-Path $packageRoot) {
    $resolvedPackageRoot = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($packageRoot)
    if (-not $resolvedPackageRoot.StartsWith($OutputDirectory, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Percorso package non sicuro per pulizia: $resolvedPackageRoot"
    }

    Remove-Item -LiteralPath $packageRoot -Recurse -Force
}

if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
New-Item -ItemType Directory -Path $serverPackageDir -Force | Out-Null
New-Item -ItemType Directory -Path $agentPackageDir -Force | Out-Null
New-Item -ItemType Directory -Path $toolsPackageDir -Force | Out-Null
New-Item -ItemType Directory -Path $servicePackageDir -Force | Out-Null
New-Item -ItemType Directory -Path $supportScriptsPackageDir -Force | Out-Null
New-Item -ItemType Directory -Path $assetsPackageDir -Force | Out-Null
New-Item -ItemType Directory -Path $agentAssetsPackageDir -Force | Out-Null
New-Item -ItemType Directory -Path $prerequisitesPackageDir -Force | Out-Null

Write-Host "Preparazione applicazione server..." -ForegroundColor Cyan
Copy-Item -LiteralPath (Join-Path $serverSourceDir "package.json") -Destination $serverPackageDir -Force
Copy-Item -LiteralPath (Join-Path $serverSourceDir "package-lock.json") -Destination $serverPackageDir -Force
Copy-DirectoryContent -Source (Join-Path $serverSourceDir "src") -Destination (Join-Path $serverPackageDir "src")
Copy-DirectoryContent -Source (Join-Path $serverSourceDir "public") -Destination (Join-Path $serverPackageDir "public")

Write-Host "Installazione dipendenze npm nel pacchetto..." -ForegroundColor Cyan
Invoke-CheckedCommand -Executable $npmExecutable -Arguments @("ci", "--omit=dev") -WorkingDirectory $serverPackageDir

Write-Host "Preparazione asset e toolchain agent..." -ForegroundColor Cyan
Ensure-DotNetRuntimePayload
Copy-DirectoryContent -Source $agentSourceDir -Destination $agentPackageDir
Copy-DirectoryContent -Source $toolsWixDir -Destination (Join-Path $toolsPackageDir "wix314-binaries")
Copy-DirectoryContent -Source $scriptsRoot -Destination $scriptsPackageDir
Copy-DirectoryContent -Source (Join-Path $agentSourceDir "OnlyBackupAgent\Assets") -Destination $agentAssetsPackageDir

Write-Host "Compilazione wrapper servizio server..." -ForegroundColor Cyan
$serviceBuildArgs = @{
    OutputDirectory = $servicePackageDir
}
if ($MsBuildPath) {
    $serviceBuildArgs.MsBuildPath = $MsBuildPath
}
& $buildServiceScript @serviceBuildArgs
if ($LASTEXITCODE -ne 0) {
    throw "Build servizio server fallita con exit code $LASTEXITCODE"
}

Write-Host "Copia configurazione, script e asset..." -ForegroundColor Cyan
Copy-Item -LiteralPath $configSourcePath -Destination (Join-Path $packageRoot "config.json") -Force
if (Test-Path $licenseSourcePath) {
    Copy-Item -LiteralPath $licenseSourcePath -Destination (Join-Path $packageRoot "LICENSE") -Force
}
Copy-DirectoryContent -Source (Join-Path $serverSourceDir "public\assets\brand") -Destination $assetsPackageDir

if (Test-Path $dotNetRuntimePayload) {
    Copy-Item -LiteralPath $dotNetRuntimePayload -Destination $prerequisitesPackageDir -Force
}

Write-PackageInstallScript -Path (Join-Path $packageRoot "Install-OnlyBackupServer.ps1")
Write-PackageUninstallScript -Path (Join-Path $packageRoot "Uninstall-OnlyBackupServer.ps1")
Write-PackageReadme -Path (Join-Path $packageRoot "INSTALL_SERVER.md")
Write-PrerequisitesManifest -Path (Join-Path $packageRoot "prerequisites.json")

Write-Host "Verifica contenuto pacchetto..." -ForegroundColor Cyan
Test-PackageContents

Write-Host "Creazione archivio zip..." -ForegroundColor Cyan
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($packageRoot, $zipPath)

Write-Host "Setup server self-contained creato:" -ForegroundColor Green
Write-Host "  Cartella: $packageRoot" -ForegroundColor Green
Write-Host "  Zip:      $zipPath" -ForegroundColor Green
