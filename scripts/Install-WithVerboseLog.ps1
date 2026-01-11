[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$MsiPath,

    [Parameter()]
    [switch]$Uninstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Verifica privilegi amministratore
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[ERROR] Questo script richiede privilegi di amministratore." -ForegroundColor Red
    Write-Host "[INFO] Esegui PowerShell come Amministratore e riprova." -ForegroundColor Yellow
    exit 1
}

# Verifica MSI
if (-not (Test-Path $MsiPath)) {
    Write-Host "[ERROR] MSI non trovato: $MsiPath" -ForegroundColor Red
    exit 1
}

$MsiPath = (Resolve-Path $MsiPath).Path

# Crea directory log
$logDir = "C:\Temp"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"

if ($Uninstall) {
    Write-Host "=== DISINSTALLAZIONE OnlyBackup Agent ===" -ForegroundColor Cyan
    $logPath = Join-Path $logDir "OnlyBackup_Uninstall_$timestamp.log"
    $operation = "/x"
    $operationName = "Disinstallazione"
} else {
    Write-Host "=== INSTALLAZIONE OnlyBackup Agent ===" -ForegroundColor Cyan
    $logPath = Join-Path $logDir "OnlyBackup_Install_$timestamp.log"
    $operation = "/i"
    $operationName = "Installazione"
}

Write-Host ""
Write-Host "[INFO] MSI: $MsiPath" -ForegroundColor Yellow
Write-Host "[INFO] Log: $logPath" -ForegroundColor Yellow
Write-Host "[INFO] Operazione: $operationName" -ForegroundColor Yellow
Write-Host ""
Write-Host "[INFO] Avvio $operationName (attendere)..." -ForegroundColor Yellow
Write-Host ""

# Esegui msiexec con logging verboso completo
# /l*vx = Log tutto in modo super-verboso + extra debug info
# ADDLOCAL=ALL = Installa tutte le features localmente (non advertised)
if (-not $Uninstall) {
    $arguments = "$operation `"$MsiPath`" /qn /norestart ADDLOCAL=ALL /l*vx `"$logPath`""
} else {
    $arguments = "$operation `"$MsiPath`" /qn /norestart /l*vx `"$logPath`""
}

Write-Host "[DEBUG] Comando: msiexec.exe $arguments" -ForegroundColor Gray
Write-Host ""

$process = Start-Process -FilePath "msiexec.exe" `
                         -ArgumentList $arguments `
                         -Wait `
                         -PassThru `
                         -NoNewWindow

Write-Host ""
Write-Host "=== RISULTATO ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "[INFO] Exit Code: $($process.ExitCode)" -ForegroundColor Yellow

# Interpreta exit codes MSI comuni
switch ($process.ExitCode) {
    0 {
        Write-Host "[OK] $operationName completata con successo" -ForegroundColor Green
    }
    3010 {
        Write-Host "[OK] $operationName completata (richiede riavvio)" -ForegroundColor Green
    }
    1602 {
        Write-Host "[ERROR] $operationName annullata dall'utente" -ForegroundColor Red
    }
    1603 {
        Write-Host "[ERROR] Errore fatale durante $operationName" -ForegroundColor Red
    }
    1605 {
        Write-Host "[WARNING] Prodotto non trovato (già disinstallato?)" -ForegroundColor Yellow
    }
    1618 {
        Write-Host "[ERROR] Altra installazione in corso" -ForegroundColor Red
    }
    1619 {
        Write-Host "[ERROR] Impossibile aprire il package MSI" -ForegroundColor Red
    }
    1625 {
        Write-Host "[ERROR] Installazione proibita da policy" -ForegroundColor Red
    }
    default {
        Write-Host "[ERROR] $operationName fallita con exit code: $($process.ExitCode)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "[INFO] Log completo salvato in:" -ForegroundColor Yellow
Write-Host "  $logPath" -ForegroundColor Cyan
Write-Host ""

# Analisi log per errori critici
if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) {
    Write-Host "=== ANALISI ERRORI DAL LOG ===" -ForegroundColor Red
    Write-Host ""

    if (Test-Path $logPath) {
        # Cerca pattern di errore comuni
        $errorPatterns = @(
            "return value 3",
            "Error \d+\.",
            "Installation failed",
            "Installation success or error status: \d+",
            "ServiceInstall:",
            "InstallServices:",
            "Product: .* -- Installation failed",
            "MainEngineThread is returning \d+"
        )

        foreach ($pattern in $errorPatterns) {
            $matches = Select-String -Path $logPath -Pattern $pattern -Context 2,2
            if ($matches) {
                Write-Host "[TROVATO] Pattern: $pattern" -ForegroundColor Yellow
                $matches | Select-Object -First 5 | ForEach-Object {
                    Write-Host "  Linea $($_.LineNumber): $($_.Line)" -ForegroundColor Gray
                    if ($_.Context.PreContext) {
                        $_.Context.PreContext | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
                    }
                    if ($_.Context.PostContext) {
                        $_.Context.PostContext | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
                    }
                    Write-Host ""
                }
            }
        }
    }
}

Write-Host ""
Write-Host "=== VERIFICA SERVIZIO ===" -ForegroundColor Cyan
Write-Host ""

Start-Sleep -Seconds 2

$service = Get-Service -Name "OnlyBackupAgent" -ErrorAction SilentlyContinue
if ($service) {
    Write-Host "[OK] Servizio trovato!" -ForegroundColor Green
    Write-Host "  Nome: $($service.Name)" -ForegroundColor Yellow
    Write-Host "  DisplayName: $($service.DisplayName)" -ForegroundColor Yellow
    Write-Host "  Status: $($service.Status)" -ForegroundColor Yellow
    Write-Host "  StartType: $($service.StartType)" -ForegroundColor Yellow
} else {
    Write-Host "[ERROR] Servizio OnlyBackupAgent NON trovato" -ForegroundColor Red

    # Cerca nel log informazioni sul servizio
    if (Test-Path $logPath) {
        Write-Host ""
        Write-Host "[INFO] Cerca 'ServiceInstall' nel log..." -ForegroundColor Yellow
        $serviceLines = Select-String -Path $logPath -Pattern "ServiceInstall|OnlyBackupAgent|InstallServices|StartServices" -Context 1,1
        if ($serviceLines) {
            Write-Host "[INFO] Trovate $($serviceLines.Count) righe relative al servizio (prime 20):" -ForegroundColor Yellow
            $serviceLines | Select-Object -First 20 | ForEach-Object {
                Write-Host "  Linea $($_.LineNumber): $($_.Line)" -ForegroundColor Cyan
            }
        }
    }
}

Write-Host ""
Write-Host "=== VERIFICA INSTALLAZIONE ===" -ForegroundColor Cyan
Write-Host ""

$installPath = "C:\Program Files\OnlyBackup\Agent"
if (Test-Path $installPath) {
    Write-Host "[OK] Cartella installazione trovata" -ForegroundColor Green
    $files = Get-ChildItem -Path $installPath -File -ErrorAction SilentlyContinue
    if ($files) {
        Write-Host "[INFO] File installati ($($files.Count)):" -ForegroundColor Yellow
        $files | ForEach-Object {
            Write-Host "  - $($_.Name) ($([math]::Round($_.Length / 1KB, 2)) KB)" -ForegroundColor Cyan
        }
    }
} else {
    Write-Host "[WARNING] Cartella installazione non trovata: $installPath" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== VERIFICA REGISTRO ===" -ForegroundColor Cyan
Write-Host ""

# Cerca nel registro
$uninstallPaths = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
)

$found = $false
foreach ($regPath in $uninstallPaths) {
    if (Test-Path $regPath) {
        Get-ChildItem -Path $regPath -ErrorAction SilentlyContinue | ForEach-Object {
            $props = Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue
            if ($props -and $props.DisplayName -like "*OnlyBackup*") {
                $found = $true
                Write-Host "[OK] Trovata voce registro:" -ForegroundColor Green
                Write-Host "  DisplayName: $($props.DisplayName)" -ForegroundColor Yellow
                Write-Host "  ProductCode: $($_.PSChildName)" -ForegroundColor Yellow
                if ($props.PSObject.Properties['InstallLocation']) {
                    Write-Host "  InstallLocation: $($props.InstallLocation)" -ForegroundColor Yellow
                }
                if ($props.PSObject.Properties['UninstallString']) {
                    Write-Host "  UninstallString: $($props.UninstallString)" -ForegroundColor Yellow
                }
                Write-Host ""
            }
        }
    }
}

if (-not $found) {
    Write-Host "[WARNING] Nessuna voce OnlyBackup trovata nel registro" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== FINE ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Per analizzare il log completo:" -ForegroundColor Yellow
Write-Host "  notepad `"$logPath`"" -ForegroundColor Cyan
Write-Host ""
Write-Host "Per cercare errori specifici:" -ForegroundColor Yellow
Write-Host "  Select-String -Path `"$logPath`" -Pattern `"error|failed|return value 3`" | Select-Object -Last 20" -ForegroundColor Cyan
Write-Host ""
