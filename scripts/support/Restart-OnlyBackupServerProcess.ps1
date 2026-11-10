param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId,

    [Parameter(Mandatory = $true)]
    [string]$WorkingDirectory,

    [Parameter(Mandatory = $true)]
    [string]$NodeExecutable,

    [Parameter(Mandatory = $true)]
    [string]$ServerScript,

    [string]$ArgumentsJson = "[]"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $WorkingDirectory)) {
    throw "WorkingDirectory non trovata: $WorkingDirectory"
}

if (-not (Test-Path $NodeExecutable)) {
    throw "Node executable non trovato: $NodeExecutable"
}

if (-not (Test-Path $ServerScript)) {
    throw "Script server non trovato: $ServerScript"
}

$arguments = @()
if ($ArgumentsJson) {
    $parsedArguments = ConvertFrom-Json -InputObject $ArgumentsJson
    if ($parsedArguments -is [System.Array]) {
        $arguments = @($parsedArguments)
    } elseif ($null -ne $parsedArguments) {
        $arguments = @([string]$parsedArguments)
    }
}

Start-Sleep -Seconds 2

$process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
if ($process) {
    taskkill /PID $ProcessId /T | Out-Null

    for ($i = 0; $i -lt 10; $i++) {
        $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
        if (-not $process) {
            break
        }

        Start-Sleep -Milliseconds 500
    }

    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($process) {
        Stop-Process -Id $ProcessId -Force
    }
}

Start-Sleep -Seconds 1

$startArgs = @($ServerScript) + $arguments
Start-Process -FilePath $NodeExecutable -ArgumentList $startArgs -WorkingDirectory $WorkingDirectory -WindowStyle Hidden
