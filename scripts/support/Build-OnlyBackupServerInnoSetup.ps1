[CmdletBinding()]
param(
    [Parameter()]
    [string]$OutputDirectory = "",

    [Parameter()]
    [string]$PackageName = "OnlyBackupServerSetup",

    [Parameter()]
    [string]$AppVersion = "1.0.0",

    [Parameter()]
    [string]$InnoCompilerPath = "",

    [Parameter()]
    [string]$MsBuildPath = "",

    [Parameter()]
    [string]$NodePath = "node",

    [Parameter()]
    [string]$NpmPath = "npm",

    [Parameter()]
    [switch]$SkipPackageBuild,

    [Parameter()]
    [switch]$SkipCompile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$buildServerSetupScript = Join-Path $PSScriptRoot "Build-OnlyBackupServerSetup.ps1"
$innoScriptPath = Join-Path $PSScriptRoot "inno\OnlyBackupServerSetup.iss"

if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $repoRoot "output\server-setup"
}

$OutputDirectory = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDirectory)
$packageRoot = Join-Path $OutputDirectory $PackageName
$innoOutputDirectory = Join-Path $OutputDirectory "inno"

function Get-FirstExistingPath {
    param([string[]]$Candidates)

    foreach ($candidate in $Candidates) {
        if (-not $candidate) {
            continue
        }

        if (Test-Path $candidate) {
            $resolved = (Resolve-Path $candidate).Path
            if ((Get-Item -LiteralPath $resolved).PSIsContainer) {
                $compilerInDirectory = Join-Path $resolved "ISCC.exe"
                if (Test-Path $compilerInDirectory) {
                    return (Resolve-Path $compilerInDirectory).Path
                }

                continue
            }

            return $resolved
        }

        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($command) {
            return $command.Path
        }
    }

    return $null
}

function Assert-InnoScript {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path $Path)) {
        throw "Script Inno Setup non trovato: $Path"
    }

    $content = Get-Content -Raw -LiteralPath $Path
    if ($content -notmatch 'Name:\s*"desktopadminui"' -or $content -notmatch 'server-settings\.html') {
        throw "Script Inno non valido: manca il task per il collegamento desktop alla UI admin."
    }

    if ($content -notmatch '\{#SourceDir\}\\\*' -or $content -notmatch 'recursesubdirs') {
        throw "Script Inno non valido: non include ricorsivamente il package server self-contained."
    }
}

function Assert-PackageContents {
    $requiredPackagePaths = @(
        (Join-Path $packageRoot "Install-OnlyBackupServer.ps1"),
        (Join-Path $packageRoot "Uninstall-OnlyBackupServer.ps1"),
        (Join-Path $packageRoot "config.json"),
        (Join-Path $packageRoot "server\src\server.js"),
        (Join-Path $packageRoot "server\node_modules\bcryptjs\package.json"),
        (Join-Path $packageRoot "service\OnlyBackupServerService.exe"),
        (Join-Path $packageRoot "assets\brand\favicon.ico"),
        (Join-Path $packageRoot "assets\brand\onlybackup-logo.svg"),
        (Join-Path $packageRoot "prerequisites.json")
    )

    foreach ($path in $requiredPackagePaths) {
        if (-not (Test-Path $path)) {
            throw "Package server richiesto da Inno incompleto: manca $path"
        }
    }
}

if (-not (Test-Path $buildServerSetupScript)) {
    throw "Script build setup server non trovato: $buildServerSetupScript"
}

Assert-InnoScript -Path $innoScriptPath

if (-not $SkipPackageBuild) {
    $packageBuildArgs = @{
        OutputDirectory = $OutputDirectory
        PackageName = $PackageName
        NodePath = $NodePath
        NpmPath = $NpmPath
    }
    if ($MsBuildPath) {
        $packageBuildArgs.MsBuildPath = $MsBuildPath
    }

    & $buildServerSetupScript @packageBuildArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Build setup server self-contained fallita con exit code $LASTEXITCODE"
    }
}

Assert-PackageContents

New-Item -ItemType Directory -Path $innoOutputDirectory -Force | Out-Null

if ($SkipCompile) {
    Write-Host "Verifica Inno completata senza compilazione per parametro -SkipCompile." -ForegroundColor Yellow
    Write-Host "Package sorgente: $packageRoot" -ForegroundColor Green
    Write-Host "Script Inno:      $innoScriptPath" -ForegroundColor Green
    exit 0
}

$isccPath = Get-FirstExistingPath -Candidates @(
    $InnoCompilerPath,
    "ISCC.exe",
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
)

if (-not $isccPath) {
    throw @"
Prerequisito mancante: Inno Setup Compiler
Versione minima/supportata: Inno Setup 6.x
Motivo: serve per compilare lo script .iss in un installer Windows .exe.
Azione richiesta: installa Inno Setup 6 dal sito/progetto ufficiale e riapri PowerShell, oppure passa -InnoCompilerPath con il percorso completo di ISCC.exe.
Verifica: Get-Command ISCC.exe
"@
}

$compilerArgs = @(
    "/DSourceDir=$packageRoot",
    "/DOutputDir=$innoOutputDirectory",
    "/DAppVersion=$AppVersion",
    $innoScriptPath
)

& $isccPath @compilerArgs
if ($LASTEXITCODE -ne 0) {
    throw "Compilazione Inno Setup fallita con exit code $LASTEXITCODE"
}

$installerPath = Join-Path $innoOutputDirectory "OnlyBackupServerSetup.exe"
if (-not (Test-Path $installerPath)) {
    throw "Installer Inno non prodotto: $installerPath"
}

Write-Host "Installer Inno creato: $installerPath" -ForegroundColor Green
