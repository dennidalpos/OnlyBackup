# Script di cleanup forzato per rimuovere TUTTE le voci OnlyBackup fantasma
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[ERROR] Questo script richiede privilegi di amministratore." -ForegroundColor Red
    exit 1
}

Write-Host "=== CLEANUP FORZATO ONLYBACKUP ===" -ForegroundColor Red
Write-Host ""
Write-Host "Questo script rimuoverà TUTTE le voci OnlyBackup dal registro" -ForegroundColor Yellow
Write-Host "senza tentare disinstallazione MSI (che tanto fallisce)." -ForegroundColor Yellow
Write-Host ""

$confirmation = Read-Host "Procedere? (S/N)"
if ($confirmation -ne 'S' -and $confirmation -ne 's') {
    Write-Host "Annullato." -ForegroundColor Yellow
    exit 0
}

Write-Host ""

# Stop e rimuovi servizio
Write-Host "[1] Rimozione servizio..." -ForegroundColor Cyan
$service = Get-Service -Name "OnlyBackupAgent" -ErrorAction SilentlyContinue
if ($service) {
    try {
        if ($service.Status -eq "Running") {
            Stop-Service -Name "OnlyBackupAgent" -Force -ErrorAction Stop
            Write-Host "  [OK] Servizio fermato" -ForegroundColor Green
        }
        sc.exe delete OnlyBackupAgent | Out-Null
        Write-Host "  [OK] Servizio rimosso" -ForegroundColor Green
    } catch {
        Write-Host "  [WARNING] Errore rimozione servizio: $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "  [OK] Servizio non presente" -ForegroundColor Green
}

# Rimuovi tutte le voci di registro OnlyBackup
Write-Host ""
Write-Host "[2] Rimozione voci registro..." -ForegroundColor Cyan

$registryPaths = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
)

$removedCount = 0
foreach ($regPath in $registryPaths) {
    if (-not (Test-Path $regPath)) { continue }

    Get-ChildItem -Path $regPath -ErrorAction SilentlyContinue | ForEach-Object {
        $keyPath = $_.PSPath
        $keyName = $_.PSChildName

        try {
            $props = Get-ItemProperty -Path $keyPath -ErrorAction Stop
            $displayName = if ($props.PSObject.Properties['DisplayName']) { $props.PSObject.Properties['DisplayName'].Value } else { $null }

            if ($displayName -like "*OnlyBackup*") {
                Remove-Item -Path $keyPath -Recurse -Force -ErrorAction Stop
                Write-Host "  [OK] Rimossa: $displayName ($keyName)" -ForegroundColor Green
                $removedCount++
            }
        }
        catch {
            # Ignora errori
        }
    }
}

Write-Host "  [INFO] Rimosse $removedCount voci" -ForegroundColor Yellow

# Rimuovi altre chiavi OnlyBackup
Write-Host ""
Write-Host "[3] Pulizia altre chiavi registro..." -ForegroundColor Cyan

$otherKeys = @(
    "HKLM:\SOFTWARE\OnlyBackup",
    "HKLM:\SOFTWARE\WOW6432Node\OnlyBackup",
    "HKLM:\SOFTWARE\OnlyBackupInstaller"
)

foreach ($key in $otherKeys) {
    if (Test-Path $key) {
        try {
            Remove-Item -Path $key -Recurse -Force -ErrorAction Stop
            Write-Host "  [OK] Rimossa: $key" -ForegroundColor Green
        } catch {
            Write-Host "  [WARNING] Errore rimuovendo $key : $_" -ForegroundColor Yellow
        }
    }
}

# Rimuovi file
Write-Host ""
Write-Host "[4] Rimozione file..." -ForegroundColor Cyan

$filePaths = @(
    "C:\Program Files\OnlyBackup",
    "C:\Program Files (x86)\OnlyBackup"
)

foreach ($path in $filePaths) {
    if (Test-Path $path) {
        try {
            Remove-Item -Path $path -Recurse -Force -ErrorAction Stop
            Write-Host "  [OK] Rimossa: $path" -ForegroundColor Green
        } catch {
            Write-Host "  [WARNING] Errore rimuovendo $path : $_" -ForegroundColor Yellow
        }
    }
}

# Rimuovi regole firewall
Write-Host ""
Write-Host "[5] Rimozione regole firewall..." -ForegroundColor Cyan

try {
    $rules = Get-NetFirewallRule -DisplayName "*OnlyBackup*" -ErrorAction SilentlyContinue
    if ($rules) {
        $rules | ForEach-Object {
            Remove-NetFirewallRule -Name $_.Name -ErrorAction Stop
            Write-Host "  [OK] Rimossa: $($_.DisplayName)" -ForegroundColor Green
        }
    } else {
        Write-Host "  [OK] Nessuna regola firewall trovata" -ForegroundColor Green
    }
} catch {
    Write-Host "  [WARNING] Errore rimuovendo regole firewall: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== VERIFICA FINALE ===" -ForegroundColor Cyan
Write-Host ""

# Verifica finale
$stillPresent = @()

foreach ($regPath in $registryPaths) {
    if (-not (Test-Path $regPath)) { continue }

    Get-ChildItem -Path $regPath -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            $props = Get-ItemProperty -Path $_.PSPath -ErrorAction Stop
            $displayName = if ($props.PSObject.Properties['DisplayName']) { $props.PSObject.Properties['DisplayName'].Value } else { $null }

            if ($displayName -like "*OnlyBackup*") {
                $stillPresent += $displayName
            }
        }
        catch {}
    }
}

if ($stillPresent.Count -gt 0) {
    Write-Host "[WARNING] Ancora presenti $($stillPresent.Count) voci:" -ForegroundColor Yellow
    $stillPresent | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
} else {
    Write-Host "[OK] Nessuna voce OnlyBackup trovata nel registro" -ForegroundColor Green
}

$service = Get-Service -Name "OnlyBackupAgent" -ErrorAction SilentlyContinue
if ($service) {
    Write-Host "[WARNING] Servizio ancora presente (potrebbe richiedere riavvio)" -ForegroundColor Yellow
} else {
    Write-Host "[OK] Servizio non presente" -ForegroundColor Green
}

$agentPath = "C:\Program Files\OnlyBackup\Agent"
if (Test-Path $agentPath) {
    Write-Host "[WARNING] File ancora presenti in $agentPath" -ForegroundColor Yellow
} else {
    Write-Host "[OK] Nessun file presente" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== CLEANUP COMPLETATO ===" -ForegroundColor Green
Write-Host ""
Write-Host "Sistema pronto per nuova installazione." -ForegroundColor Green
Write-Host ""
