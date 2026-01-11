
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

Write-Header "OnlyBackup Agent - Cleanup Script"

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
        [string]$DisplayName
    )

    $safeGuid = $ProductCode.Trim("{}")
    $logPath = "C:\Temp\OnlyBackup_uninstall_$safeGuid.log"
    $arguments = "/x $ProductCode /qn /norestart /l*v `"$logPath`""

    $process = Start-Process -FilePath "msiexec.exe" -ArgumentList $arguments -Wait -PassThru
    Write-Info "msiexec exit code $($process.ExitCode) per $DisplayName"

    if ($process.ExitCode -eq 1603) {
        Write-ErrorMessage "msiexec 1603 per $DisplayName. Log: $logPath"
        Stop-OnlyBackupProcesses

        if (Test-PendingReboot) {
            Write-Info "Pending reboot rilevato. Riavviare il sistema prima di riprovare."
        }

        if (Test-WindowsInstallerBusy) {
            Write-Info "Windows Installer occupato. Attendere la fine di altre installazioni."
        }

        $retryProcess = Start-Process -FilePath "msiexec.exe" -ArgumentList $arguments -Wait -PassThru
        Write-Info "Retry msiexec exit code $($retryProcess.ExitCode) per $DisplayName"

        if ($retryProcess.ExitCode -eq 1603) {
            Write-ErrorMessage "msiexec 1603 persistente per $DisplayName. Verificare il log: $logPath"
            Write-Info "Cercare 'Return value 3' nel log per dettagli."
        }
    }
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

        $displayName = $props.PSObject.Properties['DisplayName']?.Value
        $uninstallString = $props.PSObject.Properties['UninstallString']?.Value

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
Write-Success "Pulizia completata. Ora puoi installare una nuova versione dell'agent."
Write-Info "Per installare il nuovo agent, esegui:"
Write-Host "  msiexec /i OnlyBackupAgent.msi /qn" -ForegroundColor Cyan
Write-Host ""
