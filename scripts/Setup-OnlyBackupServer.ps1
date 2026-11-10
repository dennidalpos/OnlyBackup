[CmdletBinding()]
param(
    [Parameter()]
    [string]$InitialAdminPassword,

    [Parameter()]
    [switch]$SkipDependencyInstall,

    [Parameter()]
    [switch]$SkipDataInitialization,

    [Parameter()]
    [switch]$BuildService,

    [Parameter()]
    [switch]$InstallService,

    [Parameter()]
    [switch]$StartService,

    [Parameter()]
    [switch]$BuildPackage,

    [Parameter()]
    [switch]$BuildInstaller,

    [Parameter()]
    [switch]$SkipPackageBuild,

    [Parameter()]
    [switch]$SkipCompile,

    [Parameter()]
    [string]$OutputDirectory = "",

    [Parameter()]
    [string]$PackageName = "OnlyBackupServerSetup",

    [Parameter()]
    [string]$AppVersion = "1.0.0",

    [Parameter()]
    [string]$InnoCompilerPath = "",

    [Parameter()]
    [string]$MsBuildPath = "",

    [Parameter()]
    [string]$NodePath = "node",

    [Parameter()]
    [string]$NpmPath = "npm"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-LastNativeExitCode {
    param([string]$StepName)

    if ($null -ne $global:LASTEXITCODE -and $global:LASTEXITCODE -ne 0) {
        throw "Setup server fallito durante $StepName con exit code $global:LASTEXITCODE"
    }
}

$initializeArgs = @{}
if ($PSBoundParameters.ContainsKey("InitialAdminPassword")) {
    $initializeArgs.InitialAdminPassword = $InitialAdminPassword
}
if ($SkipDependencyInstall) {
    $initializeArgs.SkipDependencyInstall = $true
}
if ($SkipDataInitialization) {
    $initializeArgs.SkipDataInitialization = $true
}
$initializeArgs.NodePath = $NodePath
$initializeArgs.NpmPath = $NpmPath

& (Join-Path $PSScriptRoot "support\Initialize-OnlyBackup.ps1") @initializeArgs
Assert-LastNativeExitCode -StepName "Initialize-OnlyBackup.ps1"

& (Join-Path $PSScriptRoot "Test-OnlyBackupPrerequisites.ps1") -NodePath $NodePath -NpmPath $NpmPath -RequireServerServiceTooling:$($BuildService -or $InstallService -or $BuildPackage -or $BuildInstaller)
Assert-LastNativeExitCode -StepName "Test-OnlyBackupPrerequisites.ps1"

if ($BuildService -and -not $InstallService) {
    $serviceBuildArgs = @{}
    if ($MsBuildPath) {
        $serviceBuildArgs.MsBuildPath = $MsBuildPath
    }

    & (Join-Path $PSScriptRoot "support\Build-OnlyBackupServerService.ps1") @serviceBuildArgs
    Assert-LastNativeExitCode -StepName "Build-OnlyBackupServerService.ps1"
}

if ($InstallService) {
    & (Join-Path $PSScriptRoot "Install-OnlyBackupServerService.ps1") -StartService:$StartService
    Assert-LastNativeExitCode -StepName "Install-OnlyBackupServerService.ps1"
}

if ($BuildInstaller) {
    $installerBuildArgs = @{
        PackageName = $PackageName
        AppVersion = $AppVersion
        NodePath = $NodePath
        NpmPath = $NpmPath
    }
    if ($OutputDirectory) {
        $installerBuildArgs.OutputDirectory = $OutputDirectory
    }
    if ($InnoCompilerPath) {
        $installerBuildArgs.InnoCompilerPath = $InnoCompilerPath
    }
    if ($MsBuildPath) {
        $installerBuildArgs.MsBuildPath = $MsBuildPath
    }
    if ($SkipPackageBuild) {
        $installerBuildArgs.SkipPackageBuild = $true
    }
    if ($SkipCompile) {
        $installerBuildArgs.SkipCompile = $true
    }

    & (Join-Path $PSScriptRoot "support\Build-OnlyBackupServerInnoSetup.ps1") @installerBuildArgs
    Assert-LastNativeExitCode -StepName "Build-OnlyBackupServerInnoSetup.ps1"
}
elseif ($BuildPackage) {
    $packageBuildArgs = @{
        PackageName = $PackageName
        NodePath = $NodePath
        NpmPath = $NpmPath
    }
    if ($OutputDirectory) {
        $packageBuildArgs.OutputDirectory = $OutputDirectory
    }
    if ($MsBuildPath) {
        $packageBuildArgs.MsBuildPath = $MsBuildPath
    }

    & (Join-Path $PSScriptRoot "support\Build-OnlyBackupServerSetup.ps1") @packageBuildArgs
    Assert-LastNativeExitCode -StepName "Build-OnlyBackupServerSetup.ps1"
}

Write-Host "Setup server completato." -ForegroundColor Green
