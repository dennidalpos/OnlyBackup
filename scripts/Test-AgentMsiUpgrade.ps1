param(
    [Parameter(Mandatory = $true)]
    [string]$OldMsiPath,

    [Parameter(Mandatory = $true)]
    [string]$NewMsiPath
)

$ErrorActionPreference = "Stop"

function Get-MsiMetadata {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        throw "MSI non trovato: $Path"
    }

    $resolvedPath = (Resolve-Path $Path).Path
    $installer = New-Object -ComObject WindowsInstaller.Installer
    $database = $installer.GetType().InvokeMember(
        "OpenDatabase",
        [System.Reflection.BindingFlags]::InvokeMethod,
        $null,
        $installer,
        @($resolvedPath, 0)
    )

    function Read-MsiProperty {
        param($Database, [string]$PropertyName)

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

    return [PSCustomObject]@{
        Path = $resolvedPath
        ProductName = Read-MsiProperty -Database $database -PropertyName "ProductName"
        ProductVersion = Read-MsiProperty -Database $database -PropertyName "ProductVersion"
        ProductCode = Read-MsiProperty -Database $database -PropertyName "ProductCode"
        UpgradeCode = Read-MsiProperty -Database $database -PropertyName "UpgradeCode"
    }
}

$old = Get-MsiMetadata -Path $OldMsiPath
$new = Get-MsiMetadata -Path $NewMsiPath

if (-not $old.UpgradeCode -or -not $new.UpgradeCode) {
    throw "UpgradeCode mancante in almeno uno dei pacchetti MSI"
}

if ($old.UpgradeCode -ne $new.UpgradeCode) {
    throw "UpgradeCode differente: upgrade MSI non coerente"
}

if ($old.ProductCode -eq $new.ProductCode) {
    throw "ProductCode identico: il nuovo MSI non rappresenta un upgrade reale"
}

if ([version]$new.ProductVersion -le [version]$old.ProductVersion) {
    throw "ProductVersion non incrementata: $($old.ProductVersion) -> $($new.ProductVersion)"
}

Write-Host "Upgrade MSI coerente" -ForegroundColor Green
Write-Host "Old: $($old.ProductVersion) [$($old.ProductCode)]"
Write-Host "New: $($new.ProductVersion) [$($new.ProductCode)]"
Write-Host "UpgradeCode: $($new.UpgradeCode)"
