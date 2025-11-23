param(
    [string]$MsBuildPath,
    [string]$WixBinPath
)

$ErrorActionPreference = "Stop"

if (-not $MsBuildPath -or -not (Test-Path $MsBuildPath)) {
    $MsBuildPath = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe"
}

if (-not (Test-Path $MsBuildPath)) {
    $MsBuildPath = Read-Host "Percorso completo di MSBuild.exe"
    if (-not (Test-Path $MsBuildPath)) {
        Write-Error "MSBuild non trovato"
        exit 1
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $scriptDir

$csprojPath = Join-Path $scriptDir "BackupAgentService.csproj"
$packagesPath = Join-Path $scriptDir "packages"
$binPath = Join-Path $scriptDir "bin\Release"

if (-not (Test-Path $packagesPath)) {
    New-Item -ItemType Directory -Path $packagesPath | Out-Null
}

if (-not (Test-Path $binPath)) {
    New-Item -ItemType Directory -Path $binPath | Out-Null
}

$nugetExe = Join-Path $scriptDir "nuget.exe"
if (-not (Test-Path $nugetExe)) {
    Write-Host "Scarico nuget.exe..." -ForegroundColor Cyan
    Invoke-WebRequest "https://dist.nuget.org/win-x86-commandline/latest/nuget.exe" -OutFile $nugetExe
}

function Install-PackageIfMissing {
    param(
        [string]$Id,
        [string]$Version
    )
    $packageFolder = Join-Path $packagesPath "$Id.$Version"
    if (-not (Test-Path $packageFolder)) {
        Write-Host "Installo pacchetto $Id $Version" -ForegroundColor Cyan
        & $nugetExe install $Id -Version $Version -OutputDirectory $packagesPath -NonInteractive -Source "https://api.nuget.org/v3/index.json"
    }
}

Install-PackageIfMissing -Id "Newtonsoft.Json" -Version "13.0.3"
Install-PackageIfMissing -Id "WebSocketSharp" -Version "1.0.3-rc11"

Write-Host "Ripristino pacchetti NuGet..." -ForegroundColor Cyan
& $nugetExe restore $csprojPath -PackagesDirectory $packagesPath -Source "https://api.nuget.org/v3/index.json"

Write-Host "Compilazione progetto BackupAgentService..." -ForegroundColor Cyan
& "$MsBuildPath" $csprojPath /t:Rebuild /p:Configuration=Release /p:TargetFrameworkVersion=v4.7.2 /p:OutputPath="$binPath"

$exePath = Join-Path $binPath "BackupAgentService.exe"
if (-not (Test-Path $exePath)) {
    Write-Host ""
    Write-Host "   ✗ BackupAgentService.exe non trovato in $binPath" -ForegroundColor Red
    exit 1
}

$dllPath1 = Join-Path $binPath "Newtonsoft.Json.dll"
$dllPath2 = Join-Path $binPath "websocket-sharp.dll"
$allOk = $true

if (-not (Test-Path $dllPath1)) {
    Write-Host "   ⚠ Newtonsoft.Json.dll mancante - cerco nei packages..." -ForegroundColor Yellow
    $newtonsoftSrc = Get-ChildItem -Path $packagesPath -Filter "Newtonsoft.Json.dll" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($newtonsoftSrc) {
        Copy-Item $newtonsoftSrc.FullName -Destination $binPath -Force
        Write-Host "   ✓ Copiata da packages" -ForegroundColor Green
    } else {
        $allOk = $false
    }
}

if (-not (Test-Path $dllPath2)) {
    Write-Host "   ⚠ websocket-sharp.dll mancante - cerco nei packages..." -ForegroundColor Yellow
    $wsSrc = Get-ChildItem -Path $packagesPath -Filter "websocket-sharp.dll" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($wsSrc) {
        Copy-Item $wsSrc.FullName -Destination $binPath -Force
        Write-Host "   ✓ Copiata da packages" -ForegroundColor Green
    } else {
        $allOk = $false
    }
}

$cfgPath = Join-Path $binPath "BackupAgentService.exe.config"
if (-not (Test-Path $cfgPath)) {
    $srcCfg = Join-Path $scriptDir "BackupAgentService.exe.config"
    if (Test-Path $srcCfg) {
        Copy-Item $srcCfg $cfgPath -Force
    }
}

if (-not $allOk) {
    Write-Host ""
    Write-Host "   ✗ File necessari mancanti!" -ForegroundColor Red
    exit 1
}

if (-not $WixBinPath -or -not (Test-Path $WixBinPath)) {
    $WixBinPath = "C:\Program Files (x86)\WiX Toolset v3.14\bin"
}

if (-not (Test-Path $WixBinPath)) {
    $WixBinPath = Read-Host "Cartella bin di WiX Toolset (es: C:\Program Files (x86)\WiX Toolset v3.14\bin)"
}

if (-not (Test-Path $WixBinPath)) {
    Write-Error "WiX Toolset non trovato"
    exit 1
}

$candle = Join-Path $WixBinPath "candle.exe"
$light = Join-Path $WixBinPath "light.exe"

if (-not (Test-Path $candle) -or -not (Test-Path $light)) {
    Write-Error "Eseguibili WiX non trovati"
    exit 1
}

$installerDir = Join-Path $scriptDir "installer"
if (-not (Test-Path $installerDir)) {
    New-Item -ItemType Directory -Path $installerDir | Out-Null
}

Set-Location $installerDir

Write-Host "Compilazione WiX (candle)" -ForegroundColor Cyan
& $candle "Product.wxs" -dBinDir="$binPath"

Write-Host "Creazione MSI (light)" -ForegroundColor Cyan
& $light "Product.wixobj" -o "BackupAgent.msi"

Write-Host ""
Write-Host "   ✓ Build completata. MSI: $installerDir\BackupAgent.msi" -ForegroundColor Green
