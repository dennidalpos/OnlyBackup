[CmdletBinding()]
param(
    [Parameter()]
    [string]$MsBuildPath = "",

    [Parameter()]
    [string]$OutputDirectory = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$projectPath = Join-Path $repoRoot "server\service-wrapper\OnlyBackupServerService.csproj"
$defaultOutputDirectory = Join-Path $repoRoot "output\server-service"
$dotNet462TargetingPackPath = "C:\Program Files (x86)\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.6.2\mscorlib.dll"

if (-not $OutputDirectory) {
    $OutputDirectory = $defaultOutputDirectory
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

        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($command) {
            return $command.Path
        }
    }

    return $null
}

if (-not (Test-Path $projectPath)) {
    throw "Progetto servizio server non trovato: $projectPath"
}

if (-not (Test-Path $dotNet462TargetingPackPath)) {
    throw @"
Prerequisito mancante: .NET Framework 4.6.2 Developer Pack/Targeting Pack
Versione minima/supportata: .NET Framework 4.6.2 Targeting Pack
Motivo: serve a MSBuild per compilare il wrapper Windows Service del server.
Azione richiesta: installa .NET Framework 4.6.2 Developer Pack dal sito ufficiale Microsoft oppure aggiungi il componente targeting pack tramite Visual Studio Build Tools.
Verifica: Test-Path '$dotNet462TargetingPackPath'
"@
}

$msBuild = Get-FirstExistingPath -Candidates @(
    $MsBuildPath,
    "MSBuild.exe",
    "C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe",
    "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe",
    "C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\MSBuild\Current\Bin\MSBuild.exe",
    "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\MSBuild\Current\Bin\MSBuild.exe",
    "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\MSBuild.exe"
)

if (-not $msBuild) {
    throw @"
Prerequisito mancante: MSBuild
Versione minima/supportata: Visual Studio Build Tools 2019/2022 con supporto .NET Framework
Motivo: serve per compilare il wrapper Windows Service del server.
Azione richiesta: installa Visual Studio Build Tools dal sito ufficiale Microsoft selezionando i componenti .NET Framework build tools.
Verifica: Get-Command MSBuild.exe
"@
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

& $msBuild $projectPath /t:Clean,Build /p:Configuration=Release /p:Platform=AnyCPU /p:OutDir="$OutputDirectory\"
if ($LASTEXITCODE -ne 0) {
    throw "Build servizio server fallita con exit code $LASTEXITCODE"
}

$exePath = Join-Path $OutputDirectory "OnlyBackupServerService.exe"
if (-not (Test-Path $exePath)) {
    throw "Output servizio server non prodotto: $exePath"
}

Write-Host "Servizio server compilato: $exePath" -ForegroundColor Green
