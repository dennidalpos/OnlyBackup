param(
    [string]$ServiceName = "OnlyBackupServer",
    [string]$NssmPath = "nssm",
    [string]$NodePath = "",
    [string]$ConfigPath = "",
    [string]$AppDirectory = ""
)

$ErrorActionPreference = "Stop"

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

    throw "Impossibile trovare $FallbackLabel: $Executable"
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

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

$nssmExecutable = Resolve-ExecutablePath -Executable $NssmPath -FallbackLabel "nssm"
$nodeExecutable = Resolve-ExecutablePath -Executable $nodeExecutable -FallbackLabel "node"

$serverEntry = Join-Path $AppDirectory "src\server.js"
if (-not (Test-Path $serverEntry)) {
    throw "Entry server non trovata: $serverEntry"
}

$logsDir = Join-Path $repoRoot "logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir | Out-Null
}

& $nssmExecutable install $ServiceName $nodeExecutable $serverEntry | Out-Null
& $nssmExecutable set $ServiceName AppDirectory $AppDirectory | Out-Null

if ($ConfigPath) {
    if (-not (Test-Path $ConfigPath)) {
        throw "CONFIG_PATH non trovato: $ConfigPath"
    }
    & $nssmExecutable set $ServiceName AppEnvironmentExtra "CONFIG_PATH=$ConfigPath" | Out-Null
}

& $nssmExecutable set $ServiceName AppStdout (Join-Path $logsDir "server-stdout.log") | Out-Null
& $nssmExecutable set $ServiceName AppStderr (Join-Path $logsDir "server-stderr.log") | Out-Null
& $nssmExecutable set $ServiceName Start SERVICE_AUTO_START | Out-Null

Write-Host "Servizio $ServiceName installato con successo." -ForegroundColor Green
