param(
    [string]$ServiceName = "OnlyBackupServer",
    [string]$NssmPath = "",
    [switch]$Force
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

$nssmExecutable = Resolve-NssmExecutablePath -Executable $NssmPath

$confirm = "confirm"
if ($Force) {
    $confirm = ""
}

Invoke-Nssm -Executable $nssmExecutable -Arguments @("remove", $ServiceName, $confirm)

Write-Host "Servizio $ServiceName rimosso." -ForegroundColor Green
