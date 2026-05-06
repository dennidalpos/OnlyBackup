[CmdletBinding()]
param(
    [Parameter()]
    [switch]$SkipPackage
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$scriptsRoot = Join-Path $repoRoot "scripts"
$serverDir = Join-Path $repoRoot "server"

function Invoke-GateStep {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [scriptblock]$Action
    )

    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan

    try {
        & $Action
        $exitCodeVariable = Get-Variable -Name LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue
        if ($exitCodeVariable -and $null -ne $exitCodeVariable.Value -and $exitCodeVariable.Value -ne 0) {
            throw "Exit code $($exitCodeVariable.Value)"
        }
    }
    catch {
        Write-Host "[ERROR] Gate fallito nello step: $Name" -ForegroundColor Red
        Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }

    Write-Host "[OK] $Name" -ForegroundColor Green
}

function Test-PowerShellScriptsParse {
    $parseErrors = @()
    Get-ChildItem -Path $scriptsRoot -Recurse -Filter "*.ps1" -File | ForEach-Object {
        $errors = $null
        [System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw $_.FullName), [ref]$errors) | Out-Null
        if ($errors) {
            foreach ($error in $errors) {
                $parseErrors += "$($_.FullName): $($error.Message)"
            }
        }
    }

    if ($parseErrors.Count -gt 0) {
        throw ($parseErrors -join [Environment]::NewLine)
    }
}

function Test-JsonFilesParse {
    $nodeCommand = Get-Command "node" -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
        throw "Node.js non trovato nel PATH: impossibile validare i file JSON."
    }

    $jsonFiles = @(
        (Join-Path $repoRoot "PROJECT_STATUS.json"),
        (Join-Path $repoRoot "config.json"),
        (Join-Path $serverDir "package.json"),
        (Join-Path $serverDir "package-lock.json")
    )

    foreach ($jsonFile in $jsonFiles) {
        if (-not (Test-Path $jsonFile)) {
            throw "File JSON richiesto mancante: $jsonFile"
        }

        & $nodeCommand.Path -e "const fs=require('fs'); JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));" $jsonFile
        if ($LASTEXITCODE -ne 0) {
            throw "JSON non valido: $jsonFile"
        }
    }
}

function Invoke-NpmTest {
    Push-Location $serverDir
    try {
        npm test
        if ($LASTEXITCODE -ne 0) {
            throw "npm test ha restituito exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

Invoke-GateStep -Name "Parsing PowerShell scripts" -Action { Test-PowerShellScriptsParse }
Invoke-GateStep -Name "Parsing JSON manifest/config" -Action { Test-JsonFilesParse }
Invoke-GateStep -Name "Preflight repository" -Action {
    & (Join-Path $scriptsRoot "Test-OnlyBackupPrerequisites.ps1") -RequirePackagingToolchain:$(-not $SkipPackage)
}
Invoke-GateStep -Name "Server smoke test" -Action { Invoke-NpmTest }

if (-not $SkipPackage) {
    Invoke-GateStep -Name "Agent MSI package" -Action {
        & (Join-Path $scriptsRoot "Build-AgentMsi.ps1") -UseLocalhost
    }
}
else {
    Write-Host ""
    Write-Host "[INFO] Packaging MSI saltato per parametro -SkipPackage." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Repository gate completato con successo." -ForegroundColor Green
