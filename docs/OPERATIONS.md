# OnlyBackup operations

[Italian guide](OPERATIONS.it.md) · [First setup](SETUP_UTENTE_FINALE.md)

OnlyBackup coordinates Windows backup jobs through a Node.js/Express server and browser dashboard. A .NET Framework agent executes filesystem/robocopy jobs as a Windows service or console process. Server state is file-based, not a database service.

## Prerequisites

Use Windows and Node.js >=20.19.0 with npm. The agent and server service wrapper target .NET Framework 4.6.2; building them requires its Developer/Targeting Pack and MSBuild. WiX 3.14 builds the agent MSI; Inno Setup 6.x is optional for the server EXE. Robocopy must exist on agent clients.

Setup installs server dependencies with npm ci and initializes data. Build-AgentMsi may download and verify the offline .NET runtime payload into scripts/support/wix/payload. Package generation is therefore not necessarily offline and its outputs need an explicitly configured operational location.

## Setup and ordinary execution

From the repository root:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1
Set-Location .\server
npm start
~~~

Setup generates and prints a random initial admin password when none is supplied. Treat that console output as sensitive. InitialAdminPassword is also supported, but real values on the command line can be exposed in process/history logs. Bootstrap preserves an existing admin; rerunning the server EXE installer with a new initial password follows its reset flow and forces a subsequent password change.

The dashboard defaults to http://localhost:8080. config.json in the root, or CONFIG_PATH, configures host/port/dataRoot. The default 0.0.0.0 host accepts network connections; use loopback for an isolated trial. Use a separate synthetic dataRoot in tests. Never copy production user/job/token files into fixtures or public reports.

## Dashboard and jobs

After the initial password change, onboarding tracks agent heartbeat, at least one configured job, email verification and generated/downloaded agent package. Client filters show all, critical, offline, failed, active or unconfigured clients.

The new-job wizard selects client, schedule and mappings, then presents review before submission. Manual runs also use preview. Destructive UI actions require the exact displayed confirmation text. Confirm actual client, paths and schedule; the presence of a confirmation dialog does not qualify the underlying backup/storage behavior.

Pages include /alerts.html, /server-settings.html and /email-settings.html. Configuration includes schedules, notifications, agent/service status and runtime maintenance. Service restart/stop affects the running application and is not a read-only diagnostic.

## Email/OAuth

SMTP and Google/Microsoft OAuth need operator-owned provider configuration. Users choose the provider and finish its browser sign-in; they do not manually paste tokens. The server still requires provider clientId/clientSecret under oauth.providers in local config or the corresponding ONLYBACKUP_OAUTH_GOOGLE_CLIENT_* / ONLYBACKUP_OAUTH_MICROSOFT_CLIENT_* environment variables.

A missing provider configuration stops the sign-in flow before consent. Real provider access and delivery require separate qualification. Never save real secrets in tracked config.json or attach them to issues.

## Server service and packages

Setup supports BuildService to compile the included service wrapper, BuildPackage for a distributable server folder/ZIP, and BuildInstaller for the optional Inno EXE. InstallService and StartService change Windows service state and need administrator rights.

The included wrapper uses Windows/.NET service installation, not NSSM. Install-OnlyBackupServerService.ps1 compiles/configures the wrapper and registers OnlyBackupServer; Uninstall-OnlyBackupServerService.ps1 removes it after a separately reviewed request.

Default repository outputs are under output/server-service and output/server-setup, including OnlyBackupServerSetup, its ZIP and inno/OnlyBackupServerSetup.exe. A package contains server dependencies, wrapper, scripts, agent sources/assets, WiX and the .NET runtime payload. It still requires Node on the target and must not be described as a bundled Node runtime. Building agent MSI from its admin UI also requires MSBuild and the targeting pack on the server.

The server EXE setup presents license/terms and initial admin configuration, can install the .NET runtime when needed, registers/starts the server service, and offers an optional dashboard shortcut. These installer paths are implemented but require real installation/upgrade/uninstall evidence for qualification.

## Agent MSI and connection

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Build-AgentMsi.ps1 -UseLocalhost
~~~

For another server use ServerHost with only a hostname/IP, not a URL, port or path. WixPath can point to WiX 3.14; the local tools/wix314-binaries copy is detected where present. Default MSI is output/agent-msi/artifacts/OnlyBackupAgent.msi, with logs under output/agent-msi/logs.

The MSI installs the OnlyBackupAgent service, .NET runtime if necessary and checks for robocopy. It does not create an agent desktop shortcut. Default settings are ServerPort=8080, AgentPort=8081 and HeartbeatInterval=60000 milliseconds. ServerHost is set during package generation; edit the installed OnlyBackupAgent.exe.config as administrator and restart the service only when an authorized connection change is intended.

Console mode uses OnlyBackupAgent.exe /console. Manual /install and MSI installation change system state. Test-OnlyBackupAgentInstall.ps1 inspects installed files, service and registry.

## Verification

| Check | Coverage |
|---|---|
| Test-OnlyBackupPrerequisites.ps1 | Runtime/setup prerequisites |
| Prerequisites SelfTest | Controlled positive/negative prerequisite diagnostics |
| RequireServerServiceTooling / RequirePackagingToolchain | Optional build toolchains |
| server: npm test | Isolated server smoke with a fake agent |
| server: npm run test:ui | Playwright smoke, temporary server/fake agent and desktop/mobile viewport |
| Invoke-RepositoryGate.ps1 | Script/JSON parsing, prerequisites, server smoke and MSI packaging |
| Validate-MsiPackage.ps1 | MSI metadata/inventory checks |
| Test-AgentMsiUpgrade.ps1 | Comparison of two supplied MSI packages |
| Test-OnlyBackupAgentInstall.ps1 | Installed-client inspection |

There is no application compile step for the Node server and no lint/typecheck command in its manifest. Source parsing and fake-agent smoke do not prove real robocopy data restoration, service permissions, live OAuth/SMTP or installer lifecycle.

The agent code uses robocopy outcomes and logs. Do not infer per-backup SHA-256 content verification or Volume Shadow Copy support from the checksum checks used to download installer payloads. Those claims require distinct implementation and restore evidence.

## Retention, cleanup and licensing

Runtime state/data and backup destinations are operational assets. Clean-Repository.ps1 removes configured generated directories and optionally server dependencies, preserving data by default. It is destructive and must not run merely to tidy a working tree; preserve build/test evidence and review exact scope first.

Do not remove the tracked InstallUtil log or rewrite Git history without explicit authorization. The REP10 report proposes index treatment separately.

The product is proprietary; LICENSE and CREDITS remain authoritative. For non-sensitive issues use repository forms; for vulnerabilities follow SECURITY.md. Script inventory: [scripts/script.md](../scripts/script.md). Asset details: [ASSETS.md](ASSETS.md).
