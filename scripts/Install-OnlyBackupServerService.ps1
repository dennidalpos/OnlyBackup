param(
    [string]$ServiceName = "OnlyBackupServer",
    [string]$NssmPath = "",
    [string]$NodePath = "",
    [string]$ConfigPath = "",
    [string]$AppDirectory = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

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

    throw "Impossibile trovare nssm. Copia nssm.exe in tools\nssm\ oppure passa -NssmPath esplicito."
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

    throw ("Impossibile trovare {0}: {1}" -f $FallbackLabel, $Executable)
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

$serverEntry = Join-Path $AppDirectory "src\server.js"
if (-not (Test-Path $serverEntry)) {
    throw "Entry server non trovata: $serverEntry"
}

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
