[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$MsiPath
)

if (-not (Test-Path $MsiPath)) {
    Write-Host "[ERROR] MSI non trovato: $MsiPath" -ForegroundColor Red
    exit 1
}

Write-Host "=== VERIFICA VERSIONE MSI ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "File: $MsiPath" -ForegroundColor Yellow
Write-Host ""

try {
    $windowsInstaller = New-Object -ComObject WindowsInstaller.Installer
    $database = $windowsInstaller.GetType().InvokeMember("OpenDatabase", "InvokeMethod", $null, $windowsInstaller, @($MsiPath, 0))

    # Query Property table
    $query = "SELECT Property, Value FROM Property WHERE Property='ProductVersion' OR Property='ProductCode' OR Property='ProductName' OR Property='UpgradeCode'"
    $view = $database.GetType().InvokeMember("OpenView", "InvokeMethod", $null, $database, ($query))
    $view.GetType().InvokeMember("Execute", "InvokeMethod", $null, $view, $null)

    $properties = @{}
    while ($true) {
        $record = $view.GetType().InvokeMember("Fetch", "InvokeMethod", $null, $view, $null)
        if ($record -eq $null) { break }

        $property = $record.GetType().InvokeMember("StringData", "GetProperty", $null, $record, 1)
        $value = $record.GetType().InvokeMember("StringData", "GetProperty", $null, $record, 2)
        $properties[$property] = $value
    }

    Write-Host "[INFO] Proprietà MSI:" -ForegroundColor Yellow
    Write-Host "  ProductName: $($properties['ProductName'])" -ForegroundColor Cyan
    Write-Host "  ProductVersion: $($properties['ProductVersion'])" -ForegroundColor Cyan
    Write-Host "  ProductCode: $($properties['ProductCode'])" -ForegroundColor Cyan
    Write-Host "  UpgradeCode: $($properties['UpgradeCode'])" -ForegroundColor Cyan

    $view.GetType().InvokeMember("Close", "InvokeMethod", $null, $view, $null)
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($database) | Out-Null
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($windowsInstaller) | Out-Null
    [System.GC]::Collect()

    Write-Host ""
    $fileInfo = Get-Item $MsiPath
    Write-Host "[INFO] File Info:" -ForegroundColor Yellow
    Write-Host "  Dimensione: $([math]::Round($fileInfo.Length / 1MB, 2)) MB" -ForegroundColor Cyan
    Write-Host "  Ultima Modifica: $($fileInfo.LastWriteTime)" -ForegroundColor Cyan

} catch {
    Write-Host "[ERROR] Errore lettura MSI: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
