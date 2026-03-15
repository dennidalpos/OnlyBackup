# OnlyBackup

OnlyBackup e un sistema di backup/restore centralizzato con un server Node.js e un agent Windows. Il server espone API e dashboard web; l'agent esegue i job richiesti come servizio Windows o in modalita console.

## Setup

### Server
- Richiede Node.js `>= 18`.
- Configurare `config.json` nella root del repository.
- Installare le dipendenze dal progetto server:

```powershell
Set-Location .\server
npm install
```

### Agent
- Richiede .NET Framework 4.6.2.
- Il progetto dell'agent e in `agent\OnlyBackupAgent`.
- Per build, packaging MSI e validazione sono presenti script PowerShell in `scripts\`.

## Run

### Server

```powershell
Set-Location .\server
npm start
```

### Agent
- Servizio Windows:

```text
OnlyBackupAgent.exe /install
```

- Modalita console:

```text
OnlyBackupAgent.exe /console
```

## Stack

- Backend server: Node.js + Express.
- Frontend dashboard: HTML, CSS, JavaScript statici.
- Agent: C# su .NET Framework 4.6.2.
- Automazione operativa primaria: PowerShell.

## Configuration

### `config.json`
- `server.host`, `server.port`, `server.environment`
- `dataRoot`
- `logging`
- `auth`
- `scheduler`

### `agent\OnlyBackupAgent\App.config`
- `ServerHost`
- `ServerPort`
- `AgentPort`
- `HeartbeatInterval`

## Documentation

- `AGENTS.md`
- `PROJECT_SPEC.md`
- `PROJECT_STATUS.json`

## Notes

- La persistenza lato server e file-based sotto `dataRoot`.
- L'ambiente operativo di riferimento del repository e Windows.
- Il riavvio manuale del server lato Windows e supportato tramite `scripts\Restart-OnlyBackupServer.ps1`.
- La dashboard web e i route handler server sono stati suddivisi in file modulari per ridurre la dimensione dei file principali.

