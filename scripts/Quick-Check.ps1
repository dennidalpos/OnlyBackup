Write-Host "=== Verifica Rapida Installazione OnlyBackup ===" -ForegroundColor Cyan
Write-Host ""

# 1. Verifica file
$installPaths = @(
    "C:\Program Files\OnlyBackup\Agent",
    "C:\Program Files (x86)\OnlyBackup\Agent"
)

Write-Host "[1] File Installati:" -ForegroundColor Yellow
$found = $false
foreach ($installPath in $installPaths) {
    if (Test-Path $installPath) {
        $found = $true
        $files = Get-ChildItem -Path $installPath -Recurse -File -ErrorAction SilentlyContinue
        if ($files) {
            Write-Host "  [OK] Trovati $($files.Count) file in: $installPath" -ForegroundColor Green
            $files | ForEach-Object { Write-Host "    - $($_.Name)" -ForegroundColor Cyan }
        } else {
            Write-Host "  [ERROR] Cartella esiste ma è vuota: $installPath" -ForegroundColor Red
        }
    }
}

if (-not $found) {
    Write-Host "  [ERROR] Cartella non trovata in nessuna posizione" -ForegroundColor Red
}

Write-Host ""

# 2. Verifica servizio
Write-Host "[2] Servizio Windows:" -ForegroundColor Yellow
$service = Get-Service -Name "OnlyBackupAgent" -ErrorAction SilentlyContinue
if ($service) {
    Write-Host "  [OK] Servizio trovato" -ForegroundColor Green
    Write-Host "    Nome: $($service.Name)" -ForegroundColor Cyan
    Write-Host "    Status: $($service.Status)" -ForegroundColor Cyan
    Write-Host "    StartType: $($service.StartType)" -ForegroundColor Cyan
} else {
    Write-Host "  [ERROR] Servizio non trovato" -ForegroundColor Red
}

Write-Host ""

# 3. Verifica registro
Write-Host "[3] Registro:" -ForegroundColor Yellow
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
                Write-Host "  [OK] Voce registro trovata" -ForegroundColor Green
                Write-Host "    DisplayName: $($props.DisplayName)" -ForegroundColor Cyan
                Write-Host "    ProductCode: $($_.PSChildName)" -ForegroundColor Cyan
            }
        }
    }
}

if (-not $found) {
    Write-Host "  [ERROR] Voce registro non trovata" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Fine Verifica ===" -ForegroundColor Cyan
