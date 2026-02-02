param(
    [string]$ServiceName = "OnlyBackupServer",
    [string]$NssmPath = "nssm",
    [switch]$Force
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

$nssmExecutable = Resolve-ExecutablePath -Executable $NssmPath -FallbackLabel "nssm"

$confirm = "confirm"
if ($Force) {
    $confirm = ""
}

& $nssmExecutable remove $ServiceName $confirm | Out-Null

Write-Host "Servizio $ServiceName rimosso." -ForegroundColor Green
