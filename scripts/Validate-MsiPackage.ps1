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

function Test-MsiTableContains {
    param(
        [Parameter(Mandatory = $true)]
        $Database,

        [Parameter(Mandatory = $true)]
        [string]$TableName,

        [Parameter(Mandatory = $true)]
        [string]$ColumnName,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedValue
    )

    $query = "SELECT ``$ColumnName`` FROM ``$TableName``"
    $view = $Database.GetType().InvokeMember(
        "OpenView",
        [System.Reflection.BindingFlags]::InvokeMethod,
        $null,
        $Database,
        @($query)
    )
    $view.GetType().InvokeMember("Execute", [System.Reflection.BindingFlags]::InvokeMethod, $null, $view, $null) | Out-Null

    while ($true) {
        $record = $view.GetType().InvokeMember("Fetch", [System.Reflection.BindingFlags]::InvokeMethod, $null, $view, $null)
        if (-not $record) {
            return $false
        }

        $value = $record.GetType().InvokeMember("StringData", [System.Reflection.BindingFlags]::GetProperty, $null, $record, 1)
        if ($value -eq $ExpectedValue) {
            return $true
        }
    }
}

$productName = Get-MsiProperty -Database $database -PropertyName "ProductName"
$productVersion = Get-MsiProperty -Database $database -PropertyName "ProductVersion"
$productCode = Get-MsiProperty -Database $database -PropertyName "ProductCode"
$upgradeCode = Get-MsiProperty -Database $database -PropertyName "UpgradeCode"

if (-not $productName -or -not $productVersion -or -not $productCode) {
    throw "Metadati MSI incompleti in $resolvedPath"
}

if ($productName -eq "OnlyBackup Agent") {
    if (-not (Test-MsiTableContains -Database $database -TableName "AppSearch" -ColumnName "Property" -ExpectedValue "ROBOCOPYEXE")) {
        throw "Launch condition MSI incompleta: manca AppSearch per ROBOCOPYEXE."
    }

    if (-not (Test-MsiTableContains -Database $database -TableName "LaunchCondition" -ColumnName "Condition" -ExpectedValue "Installed OR ROBOCOPYEXE")) {
        throw "Launch condition MSI incompleta: manca blocco esplicito su robocopy.exe."
    }

    if (-not (Test-MsiTableContains -Database $database -TableName "Feature" -ColumnName "Feature" -ExpectedValue "DesktopShortcutFeature")) {
        throw "Feature MSI incompleta: manca DesktopShortcutFeature."
    }

    if (-not (Test-MsiTableContains -Database $database -TableName "Condition" -ColumnName "Condition" -ExpectedValue 'CREATE_DESKTOP_SHORTCUT <> "1"')) {
        throw "Feature MSI incompleta: manca condizione di opt-out CREATE_DESKTOP_SHORTCUT."
    }

    if (-not (Test-MsiTableContains -Database $database -TableName "Shortcut" -ColumnName "Shortcut" -ExpectedValue "OnlyBackupAgentDesktopShortcut")) {
        throw "Feature MSI incompleta: manca shortcut desktop opzionale."
    }

    if (-not (Test-MsiTableContains -Database $database -TableName "Dialog" -ColumnName "Dialog" -ExpectedValue "DesktopShortcutDlg")) {
        throw "UI MSI incompleta: manca dialog per opzione collegamento desktop."
    }

    if (-not (Test-MsiTableContains -Database $database -TableName "ControlEvent" -ColumnName "Argument" -ExpectedValue "DesktopShortcutDlg")) {
        throw "UI MSI incompleta: il dialog collegamento desktop non e raggiungibile dal flusso installazione."
    }
}

Write-Host "MSI valido: $resolvedPath" -ForegroundColor Green
Write-Host "ProductName: $productName"
Write-Host "ProductVersion: $productVersion"
Write-Host "ProductCode: $productCode"
if ($upgradeCode) {
    Write-Host "UpgradeCode: $upgradeCode"
}
