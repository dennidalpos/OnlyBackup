param(
    [Parameter(Mandatory = $true)]
    [string]$MsiPath
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $MsiPath)) {
    throw "MSI non trovato: $MsiPath"
}

$resolvedPath = (Resolve-Path $MsiPath).Path
$file = Get-Item $resolvedPath
if ($file.Length -le 0) {
    throw "MSI vuoto: $resolvedPath"
}

$installer = New-Object -ComObject WindowsInstaller.Installer
$database = $installer.GetType().InvokeMember(
    "OpenDatabase",
    [System.Reflection.BindingFlags]::InvokeMethod,
    $null,
    $installer,
    @($resolvedPath, 0)
)

function Get-MsiProperty {
    param(
        [Parameter(Mandatory = $true)]
        $Database,

        [Parameter(Mandatory = $true)]
        [string]$PropertyName
    )

    $query = "SELECT `Value` FROM `Property` WHERE `Property`='$PropertyName'"
    $view = $Database.GetType().InvokeMember(
        "OpenView",
        [System.Reflection.BindingFlags]::InvokeMethod,
        $null,
        $Database,
        @($query)
    )
    $view.GetType().InvokeMember("Execute", [System.Reflection.BindingFlags]::InvokeMethod, $null, $view, $null) | Out-Null
    $record = $view.GetType().InvokeMember("Fetch", [System.Reflection.BindingFlags]::InvokeMethod, $null, $view, $null)
    if (-not $record) {
        return $null
    }

    return $record.GetType().InvokeMember("StringData", [System.Reflection.BindingFlags]::GetProperty, $null, $record, 1)
}

$productName = Get-MsiProperty -Database $database -PropertyName "ProductName"
$productVersion = Get-MsiProperty -Database $database -PropertyName "ProductVersion"
$productCode = Get-MsiProperty -Database $database -PropertyName "ProductCode"
$upgradeCode = Get-MsiProperty -Database $database -PropertyName "UpgradeCode"

if (-not $productName -or -not $productVersion -or -not $productCode) {
    throw "Metadati MSI incompleti in $resolvedPath"
}

Write-Host "MSI valido: $resolvedPath" -ForegroundColor Green
Write-Host "ProductName: $productName"
Write-Host "ProductVersion: $productVersion"
Write-Host "ProductCode: $productCode"
if ($upgradeCode) {
    Write-Host "UpgradeCode: $upgradeCode"
}
