<#
.SYNOPSIS
  Cleanup old MSI-based installations and optionally remove orphaned registry entries.

.DESCRIPTION
  Enumerates Windows Installer (MSI) entries from registry uninstall keys on Windows 10/11
  and Windows Server 2019-2022. By default the script opens an interactive selection menu.

  Use -Uninstall to remove older MSI entries by DisplayName, keeping the newest version.
  Use -CleanupRegistry to remove obviously orphaned MSI uninstall entries where the cached
  MSI (LocalPackage) is missing and there is no valid UninstallString.

.EXAMPLE
  # Report old MSI versions for "Contoso App"
  .\Cleanup-OldMsi.ps1 -MatchName 'Contoso App'

.EXAMPLE
  # Uninstall older MSI versions, keep newest, run quietly
  .\Cleanup-OldMsi.ps1 -MatchName 'Contoso App' -Uninstall -Quiet

.EXAMPLE
  # Cleanup orphaned MSI uninstall entries only (no uninstall)
  .\Cleanup-OldMsi.ps1 -CleanupRegistry

.EXAMPLE
  # Include MSI assignments deployed via GPO
  .\Cleanup-OldMsi.ps1 -IncludeGpo

.EXAMPLE
  # Interactive selection of MSI entries to uninstall
  .\Cleanup-OldMsi.ps1 -Interactive

.EXAMPLE
  # Report only (disable interactive selection)
  .\Cleanup-OldMsi.ps1 -NonInteractive
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$MatchName,
  [int]$KeepLatest = 1,
  [switch]$Uninstall,
  [switch]$Quiet,
  [switch]$CleanupRegistry,
  [switch]$Include64bitOnly,
  [switch]$IncludeGpo,
  [switch]$Interactive = $true,
  [switch]$NonInteractive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-MsiUninstallEntries {
  $paths = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )

  if ($Include64bitOnly) {
    $paths = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')
  }

  foreach ($path in $paths) {
    if (-not (Test-Path $path)) { continue }

    Get-ChildItem -Path $path | ForEach-Object {
      $props = Get-ItemProperty -Path $_.PSPath
      $windowsInstaller = $props.PSObject.Properties['WindowsInstaller']
      if (-not $windowsInstaller -or $windowsInstaller.Value -ne 1) { return }

      [pscustomobject]@{
        DisplayName      = $props.PSObject.Properties['DisplayName']?.Value
        DisplayVersion   = $props.PSObject.Properties['DisplayVersion']?.Value
        ProductCode      = $props.PSChildName
        InstallLocation  = $props.PSObject.Properties['InstallLocation']?.Value
        UninstallString  = $props.PSObject.Properties['UninstallString']?.Value
        QuietUninstall   = $props.PSObject.Properties['QuietUninstallString']?.Value
        LocalPackage     = $props.PSObject.Properties['LocalPackage']?.Value
        RegistryPath     = $_.PSPath
        Wow6432Node      = $path -like '*WOW6432Node*'
        Source           = 'Registry'
      }
    }
  }
}

function Convert-ToVersion {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
  $version = $null
  if ([version]::TryParse($Value, [ref]$version)) { return $version }
  return $null
}

function Get-GpoMsiEntries {
  $paths = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Group Policy\AppMgmt\Applications',
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Group Policy\AppMgmt\Deployment'
  )

  $guidPattern = '^\{[0-9A-Fa-f-]{36}\}$'

  foreach ($path in $paths) {
    if (-not (Test-Path $path)) { continue }

    Get-ChildItem -Path $path -ErrorAction SilentlyContinue | ForEach-Object {
      $props = Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue

      $productCode = $null
      if ($props.PSObject.Properties.Name -contains 'ProductCode') {
        $productCode = $props.ProductCode
      } elseif ($props.PSObject.Properties.Name -contains 'ProductID') {
        $productCode = $props.ProductID
      } elseif ($_.PSChildName -match $guidPattern) {
        $productCode = $_.PSChildName
      }

      if (-not $productCode) { return }

      $displayName = $null
      foreach ($nameProperty in @('ProductName', 'DisplayName', 'Name')) {
        if ($props.PSObject.Properties.Name -contains $nameProperty) {
          $displayName = $props.$nameProperty
          if ($displayName) { break }
        }
      }

      [pscustomobject]@{
        DisplayName      = $displayName
        DisplayVersion   = $props.PSObject.Properties['DisplayVersion']?.Value
        ProductCode      = $productCode
        InstallLocation  = $props.PSObject.Properties['InstallLocation']?.Value
        UninstallString  = $props.PSObject.Properties['UninstallString']?.Value
        QuietUninstall   = $props.PSObject.Properties['QuietUninstallString']?.Value
        LocalPackage     = $props.PSObject.Properties['LocalPackage']?.Value
        RegistryPath     = $_.PSPath
        Wow6432Node      = $false
        Source           = 'GPO'
      }
    }
  }
}

function Find-OldMsiEntries {
  param([object[]]$Entries)

  $filtered = $Entries
  if ($MatchName) {
    $filtered = $Entries | Where-Object { $_.DisplayName -and $_.DisplayName -like "*$MatchName*" }
  }

  $filtered |
    Group-Object -Property @{ Expression = { if ($_.DisplayName) { $_.DisplayName } else { $_.ProductCode } } } |
    ForEach-Object {
      $group = $_.Group | Sort-Object -Property @{ Expression = {
        $parsed = Convert-ToVersion $_.DisplayVersion
        if ($null -eq $parsed) { [version]'0.0.0.0' } else { $parsed }
      } }, DisplayVersion -Descending

      if ($group.Count -le $KeepLatest) { return }
      $group | Select-Object -Skip $KeepLatest
    }
}

function Select-EntriesForRemoval {
  param([object[]]$Entries)

  if (-not $Entries) { return @() }

  Write-Host ''
  Write-Host 'Interactive selection: choose MSI entries to uninstall.' -ForegroundColor Cyan
  Write-Host 'Enter numbers separated by commas (e.g. 1,3,5) or press Enter to cancel.' -ForegroundColor Cyan
  Write-Host ''

  $index = 1
  $map = @{}
  foreach ($entry in $Entries | Sort-Object DisplayName, DisplayVersion) {
    $label = '{0}. {1} {2} ({3}) [{4}]' -f $index, $entry.DisplayName, $entry.DisplayVersion, $entry.ProductCode, $entry.Source
    Write-Host $label
    $map[$index] = $entry
    $index++
  }

  $raw = Read-Host 'Selection'
  if ([string]::IsNullOrWhiteSpace($raw)) { return @() }

  $choices = $raw -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  $selected = @()
  foreach ($choice in $choices) {
    $num = 0
    if ([int]::TryParse($choice, [ref]$num) -and $map.ContainsKey($num)) {
      $selected += $map[$num]
    } else {
      Write-Warning "Ignoring invalid selection: $choice"
    }
  }

  return $selected
}

function Remove-RegistryEntryIfOrphaned {
  param([pscustomobject]$Entry)

  if ($Entry.Source -and $Entry.Source -ne 'Registry') { return }

  $localPackageMissing = $false
  if ($Entry.LocalPackage) {
    $localPackageMissing = -not (Test-Path -LiteralPath $Entry.LocalPackage)
  }

  $hasValidUninstall = -not [string]::IsNullOrWhiteSpace($Entry.UninstallString)

  if ($localPackageMissing -and -not $hasValidUninstall) {
    if ($script:PSCmdlet.ShouldProcess($Entry.RegistryPath, 'Remove orphaned MSI uninstall entry')) {
      Remove-Item -Path $Entry.RegistryPath -Recurse -Force
    }
  }
}

$entries = Get-MsiUninstallEntries
if ($IncludeGpo) {
  $gpoEntries = Get-GpoMsiEntries
  if ($gpoEntries) {
    $entries = $entries + ($gpoEntries | Where-Object { $_.ProductCode -and ($entries.ProductCode -notcontains $_.ProductCode) })
  }
}

if ($NonInteractive) {
  $Interactive = $false
}

Write-Host "Found $($entries.Count) MSI uninstall entries." -ForegroundColor Cyan

$oldEntries = Find-OldMsiEntries -Entries $entries

if ($oldEntries) {
  Write-Host "Old MSI versions to review: $($oldEntries.Count)" -ForegroundColor Yellow
  $oldEntries | Sort-Object DisplayName, DisplayVersion | Format-Table DisplayName, DisplayVersion, ProductCode, Wow6432Node, Source

  if ($Interactive) {
    $selectedEntries = Select-EntriesForRemoval -Entries $oldEntries
    if (-not $selectedEntries) {
      Write-Host 'No entries selected for uninstall.' -ForegroundColor Green
    } else {
      foreach ($entry in $selectedEntries) {
        $arguments = @('/x', $entry.ProductCode)
        if ($Quiet) { $arguments += '/qn'; $arguments += '/norestart' }

        if ($PSCmdlet.ShouldProcess($entry.DisplayName, "Uninstall MSI $($entry.ProductCode)")) {
          Write-Host "Uninstalling $($entry.DisplayName) $($entry.DisplayVersion) ($($entry.ProductCode))" -ForegroundColor Yellow
          Start-Process -FilePath 'msiexec.exe' -ArgumentList $arguments -Wait -NoNewWindow
        }
      }
    }
  } elseif ($Uninstall) {
    foreach ($entry in $oldEntries) {
      $arguments = @('/x', $entry.ProductCode)
      if ($Quiet) { $arguments += '/qn'; $arguments += '/norestart' }

      if ($PSCmdlet.ShouldProcess($entry.DisplayName, "Uninstall MSI $($entry.ProductCode)")) {
        Write-Host "Uninstalling $($entry.DisplayName) $($entry.DisplayVersion) ($($entry.ProductCode))" -ForegroundColor Yellow
        Start-Process -FilePath 'msiexec.exe' -ArgumentList $arguments -Wait -NoNewWindow
      }
    }
  }
} else {
  Write-Host 'No old MSI versions found with the provided filters.' -ForegroundColor Green
}

if ($CleanupRegistry) {
  Write-Host 'Scanning for orphaned MSI uninstall entries...' -ForegroundColor Cyan
  foreach ($entry in $entries) {
    Remove-RegistryEntryIfOrphaned -Entry $entry
  }
}

Write-Host 'Done.' -ForegroundColor Green
