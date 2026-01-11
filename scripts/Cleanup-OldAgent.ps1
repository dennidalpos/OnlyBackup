
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

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-ErrorMessage "Questo script richiede privilegi di amministratore."
    Write-Info "Esegui PowerShell come Amministratore e riprova."
    exit 1
}

function Get-OnlyBackupProductCodes {
    $productCodes = @()

    $registryPaths = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
    )

    foreach ($regPath in $registryPaths) {
        if (-not (Test-Path $regPath)) { continue }

        Get-ChildItem -Path $regPath -ErrorAction SilentlyContinue | ForEach-Object {
            $keyPath = $_.PSPath
            $keyName = $_.PSChildName

            try {
                $props = Get-ItemProperty -Path $keyPath -ErrorAction Stop
                $displayName = if ($props.PSObject.Properties['DisplayName']) { $props.PSObject.Properties['DisplayName'].Value } else { $null }

                if ($displayName -like "*OnlyBackup*") {
                    if ($keyName -match "^\{[0-9A-Fa-f-]+\}$") {
                        $productCodes += @{
                            ProductCode = $keyName
                            DisplayName = $displayName
                            RegistryPath = $keyPath
                        }
                    }
                }
            }
            catch {
                # Ignora chiavi senza permessi
            }
        }
    }

    # Forza ritorno come array anche con un solo elemento
    return ,@($productCodes)
}

Write-Header "OnlyBackup Agent - Cleanup Script"

Write-Header "Rilevamento Installazioni OnlyBackup"

$installedProducts = Get-OnlyBackupProductCodes

if ($installedProducts.Count -eq 0) {
    Write-Info "Nessuna installazione MSI OnlyBackup trovata nel registro."
    Write-Info "Procedo comunque con cleanup file e servizi residui."
}
else {
    Write-Info "Trovate $($installedProducts.Count) installazioni MSI:"
    foreach ($product in $installedProducts) {
        Write-Info "  - $($product.DisplayName) [$($product.ProductCode)]"
    }
}

Write-Host ""
$confirmation = Read-Host "Procedere con la rimozione completa? (S/N)"
if ($confirmation -ne 'S' -and $confirmation -ne 's') {
    Write-Info "Cleanup annullato dall'utente."
    exit 0
}

Write-Header "Avvio Cleanup"

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

Write-Info "Ricerca voci MSI OnlyBackup nel registro..."

function Stop-OnlyBackupProcesses {
    Write-Info "Tentativo di stop servizi/processi OnlyBackup..."
    $serviceNames = @("OnlyBackupAgent", "OnlyBackupServer")
    foreach ($serviceName in $serviceNames) {
        try {
            $svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
            if ($svc -and $svc.Status -eq "Running") {
                Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
                Write-Info "Servizio fermato: $serviceName"
            }
        } catch {
            Write-ErrorMessage "Errore fermando servizio ${serviceName}: $_"
        }
    }

    $processNames = @("OnlyBackupAgent", "node")
    foreach ($processName in $processNames) {
        try {
            $procs = Get-Process -Name $processName -ErrorAction SilentlyContinue
            foreach ($proc in $procs) {
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                Write-Info "Processo terminato: $processName (PID $($proc.Id))"
            }
        } catch {
            Write-ErrorMessage "Errore fermando processo ${processName}: $_"
        }
    }
}

function Test-PendingReboot {
    $rebootKeys = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending",
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired",
        "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\PendingFileRenameOperations"
    )

    foreach ($key in $rebootKeys) {
        if (Test-Path $key) {
            return $true
        }
    }

    return $false
}

function Test-WindowsInstallerBusy {
    $installerService = Get-Service -Name "msiserver" -ErrorAction SilentlyContinue
    if ($installerService -and $installerService.Status -eq "Running") {
        $msiProcesses = Get-Process -Name "msiexec" -ErrorAction SilentlyContinue
        if ($msiProcesses) {
            return $true
        }
    }

    return $false
}

function Invoke-MsiUninstall {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ProductCode,

        [Parameter(Mandatory = $true)]
        [string]$DisplayName,

        [int]$TimeoutSeconds = 300,
        [int]$MaxRetries = 2
    )

    $safeGuid = $ProductCode.Trim("{}")
    $logDir = "C:\Temp\OnlyBackup_Cleanup"

    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }

    $logPath = Join-Path $logDir "uninstall_${safeGuid}_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"
    $arguments = "/x $ProductCode /qn /norestart /l*v `"$logPath`""

    for ($attempt = 1; $attempt -le $MaxRetries; $attempt++) {
        if ($attempt -gt 1) {
            Write-Info "Tentativo $attempt di $MaxRetries per $DisplayName..."
            Start-Sleep -Seconds 5  # Delay tra retry
        }

        $process = Start-Process -FilePath "msiexec.exe" `
                                  -ArgumentList $arguments `
                                  -Wait `
                                  -PassThru `
                                  -NoNewWindow

        Write-Info "msiexec exit code $($process.ExitCode) per $DisplayName (tentativo $attempt)"

        # Exit codes comuni:
        # 0 = Success
        # 1605 = Product not found (OK, già rimosso)
        # 1614 = Product uninstalled (OK)
        # 3010 = Success, richiede reboot
        if ($process.ExitCode -eq 0 -or $process.ExitCode -eq 1605 -or $process.ExitCode -eq 1614 -or $process.ExitCode -eq 3010) {
            Write-Success "Uninstall completato per $DisplayName"
            return $true
        }

        if ($process.ExitCode -eq 1603) {
            Write-ErrorMessage "Fatal error 1603 per $DisplayName (tentativo $attempt)"

            if ($attempt -eq 1) {
                # Prima retry: stop processi e servizi
                Stop-OnlyBackupProcesses

                if (Test-PendingReboot) {
                    Write-Info "ATTENZIONE: Sistema in pending reboot. Riavviare prima di continuare."
                }

                if (Test-WindowsInstallerBusy) {
                    Write-Info "Windows Installer occupato. Attendere..."
                    Start-Sleep -Seconds 10
                }
            }

            # Log dettaglio errore
            if (Test-Path $logPath) {
                $errorLines = Select-String -Path $logPath -Pattern "Return value 3|Error|Failed" | Select-Object -Last 10
                if ($errorLines) {
                    Write-Info "Ultimi errori dal log MSI:"
                    $errorLines | ForEach-Object { Write-Info "  $($_.Line)" }
                }
            }
        }
        else {
            Write-ErrorMessage "Uninstall fallito con exit code $($process.ExitCode)"
        }
    }

    Write-ErrorMessage "Uninstall fallito dopo $MaxRetries tentativi per $DisplayName"
    Write-Info "Log dettagliato: $logPath"
    return $false
}

function Remove-OnlyBackupUninstallEntries {
    param([string]$RegistryPath)

    if (-not (Test-Path $RegistryPath)) {
        return
    }

    Get-ChildItem -Path $RegistryPath -ErrorAction SilentlyContinue | ForEach-Object {
        $keyPath = $_.PSPath
        $keyName = $_.PSChildName

        try {
            $props = Get-ItemProperty -Path $keyPath -ErrorAction Stop
        } catch {
            return
        }

        $displayName = if ($props.PSObject.Properties['DisplayName']) { $props.PSObject.Properties['DisplayName'].Value } else { $null }
        $uninstallString = if ($props.PSObject.Properties['UninstallString']) { $props.PSObject.Properties['UninstallString'].Value } else { $null }

        if ([string]::IsNullOrWhiteSpace($displayName)) {
            return
        }

        if ($displayName -notlike "*OnlyBackup*") {
            return
        }

        Write-Info "Trovata voce: $displayName ($keyName)"

        $productCode = $null
        if ($keyName -match "^\{[0-9A-Fa-f-]+\}$") {
            $productCode = $keyName
        } elseif ($uninstallString -match "\{[0-9A-Fa-f-]+\}") {
            $productCode = $Matches[0]
        }

        if ($productCode) {
            Invoke-MsiUninstall -ProductCode $productCode -DisplayName $displayName
        } else {
            Write-Info "ProductCode non trovato per $displayName, salto uninstall MSI."
        }

        try {
            Remove-Item -Path $keyPath -Recurse -Force -ErrorAction Stop
            Write-Success "Rimossa voce registro: $displayName"
        } catch {
            Write-ErrorMessage "Errore rimuovendo voce registro ${displayName}: $_"
        }
    }
}

Remove-OnlyBackupUninstallEntries -RegistryPath "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"
Remove-OnlyBackupUninstallEntries -RegistryPath "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"

Write-Header "Cleanup Completato"

# Verifica finale
$remainingProducts = Get-OnlyBackupProductCodes
$serviceExists = Get-Service -Name "OnlyBackupAgent" -ErrorAction SilentlyContinue
$agentFolderExists = Test-Path "C:\Program Files\OnlyBackup\Agent"

$cleanupSuccess = $true

if ($remainingProducts.Count -gt 0) {
    Write-ErrorMessage "ATTENZIONE: $($remainingProducts.Count) voci MSI ancora presenti:"
    foreach ($product in $remainingProducts) {
        Write-Info "  - $($product.DisplayName)"
    }
    $cleanupSuccess = $false
}

if ($serviceExists) {
    Write-ErrorMessage "ATTENZIONE: Servizio OnlyBackupAgent ancora presente"
    $cleanupSuccess = $false
}

if ($agentFolderExists) {
    Write-Info "Cartella agent ancora presente (potrebbe contenere file in uso)"
}

if ($cleanupSuccess) {
    Write-Success "Cleanup completato con successo!"
    Write-Success "Sistema pronto per nuova installazione."
    Write-Host ""
    Write-Info "Per installare il nuovo agent:"
    Write-Host "  msiexec /i OnlyBackupAgent.msi /qn" -ForegroundColor Cyan
}
else {
    Write-ErrorMessage "Cleanup completato con AVVISI (vedere sopra)"
    Write-Info "Azioni raccomandate:"
    Write-Info "  1. Riavviare il sistema"
    Write-Info "  2. Eseguire nuovamente questo script"
    Write-Info "  3. Verificare log in: C:\Temp\OnlyBackup_Cleanup\"
}

Write-Host ""
