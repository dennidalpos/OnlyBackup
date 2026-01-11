[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ServerDir,

    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,

    [Parameter(Mandatory = $true)]
    [string]$NssmPath,

    [Parameter()]
    [string]$ServiceName = "OnlyBackupServer"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-NodePath {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $defaultPath = "C:\\Program Files\\nodejs\\node.exe"
    if (Test-Path $defaultPath) {
        return $defaultPath
    }

    return $null
}

function Ensure-FirewallRule {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    $existingRule = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
    if (-not $existingRule) {
        New-NetFirewallRule `
            -DisplayName $Name `
            -Direction Inbound `
            -Action Allow `
            -Protocol TCP `
            -LocalPort $Port `
            -Profile Any | Out-Null
    }
}

if (-not (Test-Path $NssmPath)) {
    Write-Error "nssm.exe non trovato: $NssmPath"
}

$nodePath = Resolve-NodePath
if (-not $nodePath) {
    Write-Error "node.exe non trovato. Installare Node.js 18+ prima di continuare."
}

if (-not (Test-Path $ServerDir)) {
    Write-Error "Directory server non trovata: $ServerDir"
}

if (-not (Test-Path $ConfigPath)) {
    Write-Error "config.json non trovato: $ConfigPath"
}

$serverScript = Join-Path $ServerDir "src\\server.js"
if (-not (Test-Path $serverScript)) {
    Write-Error "Script server non trovato: $serverScript"
}

$stdoutLog = Join-Path $ServerDir "service-stdout.log"
$stderrLog = Join-Path $ServerDir "service-stderr.log"

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($service) {
    & $NssmPath stop $ServiceName | Out-Null
    & $NssmPath remove $ServiceName confirm | Out-Null
}

& $NssmPath install $ServiceName $nodePath $serverScript | Out-Null
& $NssmPath set $ServiceName AppDirectory $ServerDir | Out-Null
& $NssmPath set $ServiceName AppStdout $stdoutLog | Out-Null
& $NssmPath set $ServiceName AppStderr $stderrLog | Out-Null
& $NssmPath set $ServiceName AppEnvironmentExtra "CONFIG_PATH=$ConfigPath" | Out-Null
& $NssmPath set $ServiceName Start SERVICE_AUTO_START | Out-Null
Ensure-FirewallRule -Name "OnlyBackup Server" -Port 8080
& $NssmPath start $ServiceName | Out-Null
