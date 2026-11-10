# First server and agent setup

[Italian source](SETUP_UTENTE_FINALE.it.md) · [Full operations guide](OPERATIONS.md)

This guide is for a first Windows installation using synthetic test data. It does not authorize replacing a production server, removing backups or registering a service during a documentation check.

## Prepare the server

Install Node.js >=20.19.0 with npm. Open PowerShell in the repository root:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1
Set-Location .\server
npm start
~~~

Setup installs dependencies with npm ci, creates initial data directories and creates admin only if it does not already exist. With no InitialAdminPassword it prints a generated password; keep that output private. InitialAdminPassword is supported for controlled installation, but avoid exposing real values in process arguments or shell history.

Open http://localhost:8080 and sign in as admin with the chosen/generated password. Change the password when prompted. Rerunning bootstrap does not reset an existing admin. The server EXE installer's explicit admin reset flow is different.

## Configure the listener and data

The server reads root config.json, or CONFIG_PATH. server.host defaults to 0.0.0.0, server.port to 8080, and dataRoot to ./data. For a local-only trial bind 127.0.0.1 and use a separate synthetic data root. dataRoot stores users, configuration, state and logs; it is not a disposable build directory.

Test-OnlyBackupPrerequisites.ps1 checks Node/npm, configuration/dependencies, runtime folders and robocopy; optional flags require service/MSI tools. Read its missing-prerequisite details rather than ignoring a failed preflight.

## Complete onboarding

The dashboard checklist tracks password change, agent heartbeat, at least one job, verified email configuration and an agent package. Create a job by selecting a client and reviewing schedule/mappings before Save. Manual runs also show preview. Destructive actions require the displayed exact confirmation text and a deliberate operational decision.

Email settings offer SMTP and Google/Microsoft OAuth. The operator first configures its provider app/client credentials locally; the user then signs in through the provider browser flow. Missing provider configuration blocks OAuth. Never place real credentials in tracked files.

## Generate and connect an agent

Build requires MSBuild, .NET Framework 4.6.2 Targeting Pack and WiX 3.14. The build may acquire its checked offline .NET runtime payload.

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Build-AgentMsi.ps1 -UseLocalhost
~~~

Use ServerHost for another host/IP; do not include scheme, port or path. The default MSI is output/agent-msi/artifacts/OnlyBackupAgent.msi. Inspect it with Validate-MsiPackage before an expressly authorized installation.

The agent installs a service without desktop shortcuts. Its configuration declares ServerHost, ServerPort (8080), AgentPort (8081) and HeartbeatInterval (60000 ms). Clients need robocopy and the .NET runtime. Changing the installed configuration and restarting OnlyBackupAgent requires administrator rights.

## Optional server deployment

Setup BuildService compiles the Windows wrapper. BuildPackage creates a distributable folder/ZIP; BuildInstaller adds an Inno Setup EXE. The package includes npm dependencies but still requires the target Node runtime. The wrapper uses Windows/.NET service tools, not NSSM.

Install-OnlyBackupServerService.ps1 with StartService registers/starts the server as an administrator; service removal is a separate operation. Production network/firewall/TLS, real backup/restore and installer lifecycle tests remain separately qualified. See [operations](OPERATIONS.md) for paths, commands, limits and recovery precautions.
