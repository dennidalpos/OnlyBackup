
<#
.SYNOPSIS
    Script per pulire installazioni precedenti di OnlyBackup Agent

.DESCRIPTION
    Questo script rimuove:
    - Servizio Windows OnlyBackupAgent
    - Voci di registro orfane
    - File di installazione precedenti

    Utile quando si desidera fare un'installazione pulita dopo problemi di upgrade.

.EXAMPLE
    .\Cleanup-OldAgent.ps1

.EXAMPLE
    .\Cleanup-OldAgent.ps1 -KeepLogs
#>

[CmdletBinding()]
param(
    [Parameter()]
    [switch]$KeepLogs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

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

# Verifica permessi amministratore
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-ErrorMessage "Questo script richiede privilegi di amministratore."
    Write-Info "Esegui PowerShell come Amministratore e riprova."
    exit 1
}

Write-Header "OnlyBackup Agent - Cleanup Script"

# 1. Ferma il servizio
Write-Info "Tentativo di fermare il servizio OnlyBackupAgent..."
try {
    $service = Get-Service -Name "OnlyBackupAgent" -ErrorAction SilentlyContinue
    if ($service) {
        if ($service.Status -eq "Running") {
            Stop-Service -Name "OnlyBackupAgent" -Force -ErrorAction Stop
            Write-Success "Servizio fermato"
        } else {
            Write-Info "Servizio già fermo"
        }
    } else {
        Write-Info "Servizio non trovato"
    }
} catch {
    Write-ErrorMessage "Errore fermando il servizio: $_"
}

# 2. Elimina il servizio
Write-Info "Rimozione servizio Windows..."
try {
    $service = Get-Service -Name "OnlyBackupAgent" -ErrorAction SilentlyContinue
    if ($service) {
        sc.exe delete OnlyBackupAgent | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Servizio rimosso"
        } else {
            Write-ErrorMessage "Errore rimozione servizio (exit code: $LASTEXITCODE)"
        }
    } else {
        Write-Info "Servizio non presente"
    }
} catch {
    Write-ErrorMessage "Errore eliminando il servizio: $_"
}

# 3. Rimuovi voci di registro
Write-Info "Pulizia registro di sistema..."
$registryPaths = @(
    "HKLM:\SOFTWARE\OnlyBackup",
    "HKLM:\SOFTWARE\WOW6432Node\OnlyBackup",
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{9C9E5F2A-88E9-4A79-9E8E-5F1EAF9B64A8}",
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{7DA33E82-31DD-41F8-896C-59BA2C392F84}",
    "HKLM:\SOFTWARE\OnlyBackupInstaller",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\{9C9E5F2A-88E9-4A79-9E8E-5F1EAF9B64A8}",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\{7DA33E82-31DD-41F8-896C-59BA2C392F84}"
)

foreach ($path in $registryPaths) {
    if (Test-Path $path) {
        try {
            Remove-Item -Path $path -Recurse -Force -ErrorAction Stop
            Write-Success "Rimossa chiave: $path"
        } catch {
            Write-ErrorMessage "Errore rimuovendo $path : $_"
        }
    }
}

# 4. Rimuovi file di installazione
Write-Info "Rimozione file di installazione..."
$installPaths = @(
    "C:\Program Files\OnlyBackup\Agent",
    "C:\Program Files (x86)\OnlyBackup\Agent",
    "C:\Program Files\OnlyBackup\Server",
    "C:\Program Files (x86)\OnlyBackup\Server"
)

foreach ($path in $installPaths) {
    if (Test-Path $path) {
        try {
            Remove-Item -Path $path -Recurse -Force -ErrorAction Stop
            Write-Success "Rimossa cartella: $path"
        } catch {
            Write-ErrorMessage "Errore rimuovendo $path : $_"
        }
    }
}

# 5. Gestione log
if (-not $KeepLogs) {
    Write-Info "Rimozione log dell'agent..."
    $logPath = "C:\BackupConsole\logs"
    if (Test-Path $logPath) {
        try {
            Remove-Item -Path $logPath -Recurse -Force -ErrorAction Stop
            Write-Success "Log rimossi: $logPath"
        } catch {
            Write-ErrorMessage "Errore rimuovendo log: $_"
        }
    }
} else {
    Write-Info "Log conservati (parametro -KeepLogs attivo)"
}

# 6. Rimuovi regola firewall
Write-Info "Rimozione regole firewall..."
try {
    $firewallRule = Get-NetFirewallRule -DisplayName "OnlyBackup Agent" -ErrorAction SilentlyContinue
    if ($firewallRule) {
        Remove-NetFirewallRule -DisplayName "OnlyBackup Agent" -ErrorAction Stop
        Write-Success "Regola firewall rimossa"
    } else {
        Write-Info "Regola firewall non presente"
    }
} catch {
    Write-ErrorMessage "Errore rimuovendo regola firewall agent: $_"
}

try {
    $firewallRule = Get-NetFirewallRule -DisplayName "OnlyBackup Server" -ErrorAction SilentlyContinue
    if ($firewallRule) {
        Remove-NetFirewallRule -DisplayName "OnlyBackup Server" -ErrorAction Stop
        Write-Success "Regola firewall server rimossa"
    } else {
        Write-Info "Regola firewall server non presente"
    }
} catch {
    Write-ErrorMessage "Errore rimuovendo regola firewall server: $_"
}

# 7. Cerca e rimuovi voci MSI orfane da registro
Write-Info "Ricerca voci MSI OnlyBackup nel registro..."

function Remove-OnlyBackupUninstallEntries {
    param([string]$RegistryPath)

    if (-not (Test-Path $RegistryPath)) {
        return
    }

    Get-ChildItem -Path $RegistryPath | ForEach-Object {
        $keyPath = $_.PSPath
        $keyName = $_.PSChildName
        try {
            $props = Get-ItemProperty -Path $keyPath -ErrorAction Stop
        } catch {
            return
        }

        if (-not $props.DisplayName) {
            return
        }

        if ($props.DisplayName -notlike "*OnlyBackup*") {
            return
        }

        Write-Info "Trovata voce: $($props.DisplayName) ($keyName)"

        $productCode = $null
        if ($keyName -match "^\{[0-9A-Fa-f-]+\}$") {
            $productCode = $keyName
        } elseif ($props.UninstallString -match "\{[0-9A-Fa-f-]+\}") {
            $productCode = $Matches[0]
        }

        if ($productCode) {
            try {
                $arguments = "/x $productCode /qn /norestart"
                $process = Start-Process -FilePath "msiexec.exe" -ArgumentList $arguments -Wait -PassThru
                if ($process.ExitCode -eq 0) {
                    Write-Success "Disinstallato via msiexec: $($props.DisplayName)"
                } else {
                    Write-ErrorMessage "msiexec exit code $($process.ExitCode) per $($props.DisplayName)"
                }
            } catch {
                Write-ErrorMessage "Errore disinstallando $($props.DisplayName) via msiexec: $_"
            }
        }

        try {
            Remove-Item -Path $keyPath -Recurse -Force -ErrorAction Stop
            Write-Success "Rimossa voce registro: $($props.DisplayName)"
        } catch {
            Write-ErrorMessage "Errore rimuovendo voce registro $($props.DisplayName): $_"
        }
    }
}

Remove-OnlyBackupUninstallEntries -RegistryPath "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"
Remove-OnlyBackupUninstallEntries -RegistryPath "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"

Write-Header "Cleanup Completato"
Write-Success "Pulizia completata. Ora puoi installare una nuova versione dell'agent."
Write-Info "Per installare il nuovo agent, esegui:"
Write-Host "  msiexec /i OnlyBackupAgent.msi /qn" -ForegroundColor Cyan
Write-Host ""
