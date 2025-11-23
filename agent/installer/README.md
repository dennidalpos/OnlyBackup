<!-- agent/installer/README.md -->
# MSI BackupAgent

Richiede:

- WiX Toolset v3.14.x (consigliato)
- BackupAgentService.exe compilato in `..\bin\Release\BackupAgentService.exe`

Build:

```bash
cd agent
.\build-agent-simple.ps1

Output: agent\installer\BackupAgent.msi installa servizio BackupAgentService in Program Files\BackupAgent.


```md
<!-- agent/README.md -->
# Backup Agent

## Requisiti

- Windows 7 SP1 - Windows 11
- .NET Framework 4.7.2
- WiX Toolset v3.14.x per MSI (facoltativo)

## Configurazione

Modifica `App.config`:

- `ServerUrl` = `ws://SERVER:8081` (o `wss://...` dietro reverse proxy)
- `HeartbeatSeconds` = intervallo heartbeat
- `LogDirectory` = es. `C:\ProgramData\BackupAgent\Logs`

## Build + MSI

```powershell
cd agent
.\build-agent-simple.ps1


MSI risultante: agent\installer\BackupAgent.msi.

Installa servizio Windows:

Nome: BackupAgentService

Avvio automatico

Log in C:\ProgramData\BackupAgent\Logs\agent.log