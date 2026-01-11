[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$LogPath
)

if (-not (Test-Path $LogPath)) {
    Write-Host "[ERROR] Log non trovato: $LogPath" -ForegroundColor Red
    exit 1
}

Write-Host "=== ANALISI LOG MSI ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Log: $LogPath" -ForegroundColor Yellow
Write-Host ""

# 1. Tipo di operazione
Write-Host "[1] TIPO OPERAZIONE:" -ForegroundColor Yellow
$installType = Select-String -Path $LogPath -Pattern "(installazione|riconfigurazione|disinstallazione) (del prodotto |)completata" | Select-Object -Last 1
if ($installType) {
    Write-Host "  $($installType.Line.Trim())" -ForegroundColor Cyan
}
Write-Host ""

# 2. Cerca WIX_UPGRADE_DETECTED
Write-Host "[2] UPGRADE DETECTION:" -ForegroundColor Yellow
$upgradeDetected = Select-String -Path $LogPath -Pattern "WIX_UPGRADE_DETECTED|UPGRADINGPRODUCTCODE|Installed"
if ($upgradeDetected) {
    Write-Host "  Trovate $($upgradeDetected.Count) righe (prime 10):" -ForegroundColor Cyan
    $upgradeDetected | Select-Object -First 10 | ForEach-Object {
        Write-Host "    Linea $($_.LineNumber): $($_.Line.Trim())" -ForegroundColor Gray
    }
} else {
    Write-Host "  Nessuna property di upgrade trovata" -ForegroundColor Green
}
Write-Host ""

# 3. Cerca azione InstallFiles
Write-Host "[3] INSTALLFILES ACTION:" -ForegroundColor Yellow
$installFiles = Select-String -Path $LogPath -Pattern "Doing action: InstallFiles|Action start.*InstallFiles|Action ended.*InstallFiles" -Context 0,3
if ($installFiles) {
    $installFiles | ForEach-Object {
        Write-Host "  Linea $($_.LineNumber): $($_.Line.Trim())" -ForegroundColor Cyan
        if ($_.Context.PostContext) {
            $_.Context.PostContext | ForEach-Object {
                Write-Host "    $_" -ForegroundColor Gray
            }
        }
    }
} else {
    Write-Host "  [WARNING] Azione InstallFiles non trovata!" -ForegroundColor Red
}
Write-Host ""

# 4. Feature installation
Write-Host "[4] FEATURE INSTALLATION:" -ForegroundColor Yellow
$features = Select-String -Path $LogPath -Pattern "Feature:.*State|ADDLOCAL|REMOVE" | Select-Object -First 20
if ($features) {
    $features | ForEach-Object {
        Write-Host "  Linea $($_.LineNumber): $($_.Line.Trim())" -ForegroundColor Cyan
    }
}
Write-Host ""

# 5. Component selection
Write-Host "[5] COMPONENT SELECTION:" -ForegroundColor Yellow
$components = Select-String -Path $LogPath -Pattern "Component:.*Action" | Select-Object -First 30
if ($components) {
    Write-Host "  Primi 30 componenti:" -ForegroundColor Cyan
    $components | ForEach-Object {
        $line = $_.Line.Trim()
        if ($line -match "Action = 3") {
            Write-Host "    Linea $($_.LineNumber): $line" -ForegroundColor Green
        } elseif ($line -match "Action = 2") {
            Write-Host "    Linea $($_.LineNumber): $line" -ForegroundColor Yellow
        } else {
            Write-Host "    Linea $($_.LineNumber): $line" -ForegroundColor Gray
        }
    }
} else {
    Write-Host "  [WARNING] Nessun componente trovato!" -ForegroundColor Red
}
Write-Host ""

# 6. ServiceInstall details
Write-Host "[6] SERVICE INSTALL DETAILS:" -ForegroundColor Yellow
$serviceInstall = Select-String -Path $LogPath -Pattern "ServiceInstall|InstallServices.*condition" -Context 2,2
if ($serviceInstall) {
    $serviceInstall | Select-Object -First 10 | ForEach-Object {
        Write-Host "  Linea $($_.LineNumber): $($_.Line.Trim())" -ForegroundColor Cyan
        if ($_.Context.PreContext) {
            $_.Context.PreContext | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        }
        if ($_.Context.PostContext) {
            $_.Context.PostContext | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        }
        Write-Host ""
    }
}
Write-Host ""

# 7. Cerca REINSTALL/REINSTALLMODE
Write-Host "[7] REINSTALL MODE:" -ForegroundColor Yellow
$reinstall = Select-String -Path $LogPath -Pattern "REINSTALL|REINSTALLMODE"
if ($reinstall) {
    Write-Host "  Trovate $($reinstall.Count) righe (prime 15):" -ForegroundColor Cyan
    $reinstall | Select-Object -First 15 | ForEach-Object {
        Write-Host "    Linea $($_.LineNumber): $($_.Line.Trim())" -ForegroundColor Gray
    }
} else {
    Write-Host "  Nessuna property REINSTALL trovata" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== LEGENDA COMPONENT ACTIONS ===" -ForegroundColor Cyan
Write-Host "  Action = 1: No action (component not affected)" -ForegroundColor Gray
Write-Host "  Action = 2: Component is being removed" -ForegroundColor Yellow
Write-Host "  Action = 3: Component is being installed" -ForegroundColor Green
Write-Host "  Action = 4: Component is being reinstalled" -ForegroundColor Cyan
Write-Host ""
