[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$MsiPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "=== Validazione MSI Package ===" -ForegroundColor Cyan

if (-not (Test-Path $MsiPath)) {
    Write-Host "[ERROR] File MSI non trovato: $MsiPath" -ForegroundColor Red
    exit 1
}

# Carica Windows Installer COM Object
$installer = New-Object -ComObject WindowsInstaller.Installer

try {
    # Apri database MSI in modalità read-only (0 = msiOpenDatabaseModeReadOnly)
    $database = $installer.GetType().InvokeMember("OpenDatabase", "InvokeMethod", $null, $installer, @($MsiPath, 0))

    # Query 1: Verifica ProductCode, UpgradeCode e ProductVersion
    $query = "SELECT `Property`, `Value` FROM Property WHERE `Property`='ProductCode' OR `Property`='UpgradeCode' OR `Property`='ProductVersion'"
    $view = $database.GetType().InvokeMember("OpenView", "InvokeMethod", $null, $database, $query)
    $view.GetType().InvokeMember("Execute", "InvokeMethod", $null, $view, $null)

    $properties = @{}
    while ($true) {
        $record = $view.GetType().InvokeMember("Fetch", "InvokeMethod", $null, $view, $null)
        if ($record -eq $null) { break }

        $propName = $record.GetType().InvokeMember("StringData", "GetProperty", $null, $record, 1)
        $propValue = $record.GetType().InvokeMember("StringData", "GetProperty", $null, $record, 2)
        $properties[$propName] = $propValue
    }

    Write-Host "[INFO] ProductCode: $($properties['ProductCode'])" -ForegroundColor Yellow
    Write-Host "[INFO] UpgradeCode: $($properties['UpgradeCode'])" -ForegroundColor Yellow
    Write-Host "[INFO] ProductVersion: $($properties['ProductVersion'])" -ForegroundColor Yellow

    # Validazione UpgradeCode fisso
    $expectedUpgradeCode = "{12345678-1234-1234-1234-123456789ABC}"
    if ($properties['UpgradeCode'] -ne $expectedUpgradeCode) {
        Write-Host "[ERROR] UpgradeCode non corretto!" -ForegroundColor Red
        Write-Host "  Atteso: $expectedUpgradeCode" -ForegroundColor Red
        Write-Host "  Trovato: $($properties['UpgradeCode'])" -ForegroundColor Red
        exit 1
    }

    Write-Host "[OK] UpgradeCode corretto" -ForegroundColor Green

    # Validazione ProductCode dinamico (deve essere un GUID valido)
    if ($properties['ProductCode'] -notmatch '^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$') {
        Write-Host "[ERROR] ProductCode non è un GUID valido!" -ForegroundColor Red
        exit 1
    }

    Write-Host "[OK] ProductCode è un GUID valido (dinamico)" -ForegroundColor Green

    # Query 2: Conta componenti (usando approccio iterativo invece di COUNT)
    $query = "SELECT `Component` FROM Component"
    $view = $database.GetType().InvokeMember("OpenView", "InvokeMethod", $null, $database, $query)
    $view.GetType().InvokeMember("Execute", "InvokeMethod", $null, $view, $null)

    $componentCount = 0
    while ($true) {
        $record = $view.GetType().InvokeMember("Fetch", "InvokeMethod", $null, $view, $null)
        if ($record -eq $null) { break }
        $componentCount++
    }

    Write-Host "[INFO] Componenti totali: $componentCount" -ForegroundColor Yellow

    if ($componentCount -eq 0) {
        Write-Host "[ERROR] Nessun componente trovato nel MSI!" -ForegroundColor Red
        exit 1
    }

    # Query 3: Verifica presenza servizio OnlyBackupAgent
    $query = "SELECT `Name` FROM ServiceInstall WHERE `Name`='OnlyBackupAgent'"
    $view = $database.GetType().InvokeMember("OpenView", "InvokeMethod", $null, $database, $query)
    $view.GetType().InvokeMember("Execute", "InvokeMethod", $null, $view, $null)
    $record = $view.GetType().InvokeMember("Fetch", "InvokeMethod", $null, $view, $null)

    if ($record) {
        Write-Host "[OK] Servizio OnlyBackupAgent trovato" -ForegroundColor Green
    }
    else {
        Write-Host "[ERROR] Servizio OnlyBackupAgent mancante!" -ForegroundColor Red
        exit 1
    }

    # Query 4: Verifica file principale OnlyBackupAgent.exe
    $query = "SELECT `File` FROM File WHERE `File`='ServiceExecutable'"
    $view = $database.GetType().InvokeMember("OpenView", "InvokeMethod", $null, $database, $query)
    $view.GetType().InvokeMember("Execute", "InvokeMethod", $null, $view, $null)
    $record = $view.GetType().InvokeMember("Fetch", "InvokeMethod", $null, $view, $null)

    if ($record) {
        Write-Host "[OK] File OnlyBackupAgent.exe presente nel MSI" -ForegroundColor Green
    }
    else {
        Write-Host "[WARNING] File ServiceExecutable non trovato (potrebbe avere ID diverso)" -ForegroundColor Yellow
    }

    # Dimensione file MSI
    $msiSize = (Get-Item $MsiPath).Length / 1MB
    Write-Host "[INFO] Dimensione MSI: $($msiSize.ToString('F2')) MB" -ForegroundColor Yellow

    if ($msiSize -gt 100) {
        Write-Host "[WARNING] MSI molto grande (>100MB). Verificare che non contenga file non necessari." -ForegroundColor Yellow
    }
    elseif ($msiSize -lt 1) {
        Write-Host "[WARNING] MSI molto piccolo (<1MB). Potrebbe mancare contenuto." -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "[SUCCESS] Validazione MSI completata con successo" -ForegroundColor Green
    exit 0
}
catch {
    Write-Host "[ERROR] Errore durante validazione: $_" -ForegroundColor Red
    Write-Host "Stack trace: $($_.ScriptStackTrace)" -ForegroundColor Yellow
    exit 1
}
finally {
    if ($installer) {
        [System.Runtime.Interopservices.Marshal]::ReleaseComObject($installer) | Out-Null
    }
}
