# Script inventory

[Italian source](script.it.md) · [Operations](../docs/OPERATIONS.md)

Public entrypoints live directly under scripts; helpers and installer definitions are under scripts/support. Commands that install/remove services, create packages or remove output need the appropriate explicit scope.

| Script | Responsibility and prerequisites |
|---|---|
| Invoke-RepositoryGate.ps1 | PowerShell/JSON parsing, prerequisites, server smoke and MSI package; SkipPackage omits packaging only |
| Setup-OnlyBackupServer.ps1 | npm dependency/data setup; optional wrapper/package/Inno/service flows |
| Test-OnlyBackupPrerequisites.ps1 | Node/npm/config/runtime checks; SelfTest and optional service/package toolchain flags |
| Build-AgentMsi.ps1 | MSBuild/.NET targeting pack/WiX 3.14 build, checked offline runtime payload |
| Install-OnlyBackupServerService.ps1 | Compile/configure/register server service; administrator rights |
| Uninstall-OnlyBackupServerService.ps1 | Stop/remove server service; administrator rights |
| Validate-MsiPackage.ps1 | Inspect existing MSI metadata with WindowsInstaller COM |
| Test-AgentMsiUpgrade.ps1 | Compare two supplied MSI packages; does not install them |
| Test-OnlyBackupAgentInstall.ps1 | Inspect installed files/service/registry |
| Clean-Repository.ps1 | Destructive generated-output cleanup; optional dependencies, preserves data by default |

Internal helpers include Initialize-OnlyBackup.ps1 and Initialize-OnlyBackupData.js for setup; Test-OnlyBackupServerSmoke.js and Test-OnlyBackupUiSmoke.js for controlled synthetic checks; Build-OnlyBackupServerService/Setup/InnoSetup for package internals; Restart-OnlyBackupServerProcess for an authorized runtime restart; and Install-AgentMsiVerbose for installer diagnostics.

WiX uses support/wix/AgentInstaller.wxs and support/wix/payload; Inno uses support/inno/OnlyBackupServerSetup.iss. The default package outputs are under output, but managed operational output must be isolated according to the active repository policy.

The earlier script/layout consolidation is retained in the Italian source as history. Do not restore removed bypass/cleanup helpers or infer a supported workflow from a historical filename. There is no Node application compilation/lint/typecheck command in server/package.json; npm test and test:ui are the declared server checks.

Static parsing, synthetic smoke, MSI metadata inspection and real service/install/restore qualification are different evidence. Preserve logs/fixtures after a check; never run Clean as a test prerequisite merely to hide existing output.
