#requires -Version 7.5
<#
.SYNOPSIS
Runs the ready autonomous tracker tasks of THIS repository only, each in a fresh agent session.
.DESCRIPTION
Thin launcher installed by SecondBrain (scripts/install-task-launcher.ps1). It holds no logic: it finds the SecondBrain checkout through the
SECONDBRAIN_HOME environment variable and runs its run-ready-tasks.ps1 for this checkout. Without -Run it only previews.
Progress goes to standard error; standard output carries the final JSON.
Examples:
  pwsh -NoProfile -File .secondbrain/run-tasks.ps1                    # preview
  pwsh -NoProfile -File .secondbrain/run-tasks.ps1 -MaxTasks 1 -Run   # run the next task
#>
[CmdletBinding()]
param([int]$MaxTasks=3,[ValidateRange(1,240)][int]$TimeoutMinutes=30,[switch]$Run)
$ErrorActionPreference='Stop'
$text=if((Get-UICulture).TwoLetterISOLanguageName -eq 'it'){
    @{home='SECONDBRAIN_HOME non impostata: serve il percorso del checkout SecondBrain.';runner='run-ready-tasks.ps1 non trovato in: '}
}else{
    @{home='SECONDBRAIN_HOME is not set: the SecondBrain checkout path is required.';runner='run-ready-tasks.ps1 not found in: '}
}
$sb=[Environment]::GetEnvironmentVariable('SECONDBRAIN_HOME','Process')
if(!$sb){$sb=[Environment]::GetEnvironmentVariable('SECONDBRAIN_HOME','User')}
if(!$sb){[Console]::Error.WriteLine($text.home);exit 2}
$runner=Join-Path $sb 'scripts/run-ready-tasks.ps1'
if(!(Test-Path -LiteralPath $runner)){[Console]::Error.WriteLine($text.runner+$sb);exit 2}
# This repository's root is the parent of the folder holding this launcher.
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$arguments=@('-CheckoutPath',$root,'-MaxTasks',[string]$MaxTasks,'-TimeoutMinutes',[string]$TimeoutMinutes)
if($Run){$arguments+='-Run'}
& pwsh -NoProfile -File $runner @arguments
exit $LASTEXITCODE
