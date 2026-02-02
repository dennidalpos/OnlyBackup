# OnlyBackup

OnlyBackup è un sistema di backup/restore centralizzato con un server Node.js e un agent Windows. Il server espone API e dashboard, mentre l’agent gira come servizio Windows o in modalità console per eseguire i backup richiesti.【F:server/package.json†L1-L19】【F:agent/OnlyBackupAgent/Program.cs†L1-L89】

## Componenti principali

### Server (Node.js)
- Applicazione Node.js con entrypoint `server/src/server.js`.
- Avvio tramite script NPM (`npm start`).【F:server/package.json†L1-L12】
- Configurazione tramite `config.json` nella root del repository (host, port, logging, auth, scheduler, ecc.).【F:config.json†L1-L29】

### Agent (Windows)
- Servizio Windows installabile o eseguibile in modalità console.
- Opzioni CLI: `/install`, `/uninstall`, `/console`.【F:agent/OnlyBackupAgent/Program.cs†L1-L89】
- Configurazione di rete e heartbeat in `App.config` (host/port del server, porta agent, intervallo heartbeat).【F:agent/OnlyBackupAgent/App.config†L1-L9】

## Requisiti

### Server
- Node.js `>= 18` (come indicato da `engines`).【F:server/package.json†L27-L29】
- Dipendenze installate in `server/` tramite `npm install`.【F:server/package.json†L1-L25】

### Agent
- .NET Framework 4.6.2 (come indicato in `App.config`).【F:agent/OnlyBackupAgent/App.config†L7-L9】

## Avvio rapido

### Server
1. Configura `config.json` nella root del repository.
2. Installa le dipendenze e avvia:
   ```bash
   cd server
   npm install
   npm start
   ```
   Gli script `start/dev/test` sono definiti nel `package.json`.【F:server/package.json†L1-L12】

### Agent
1. Compila il progetto `agent/OnlyBackupAgent`.
2. Esegui l’exe come servizio o in console:
   - Servizio Windows:
     ```text
     OnlyBackupAgent.exe /install
     ```
   - Modalità console:
     ```text
     OnlyBackupAgent.exe /console
     ```
   (Le opzioni supportate sono definite nel `Program.cs`).【F:agent/OnlyBackupAgent/Program.cs†L1-L89】

## Configurazione

### `config.json` (Server)
Configurazione base disponibile nel repository:
```json
{
  "server": { "host": "0.0.0.0", "port": 8080, "environment": "production" },
  "dataRoot": "./data",
  "logging": { "level": "warn", "console": true, "file": true, "maxFiles": 180, "maxSize": "10m", "retentionDays": 180, "cleanupIntervalHours": 6 },
  "auth": { "sessionTimeout": 3600000, "passwordMinLength": 8, "secureCookies": true },
  "scheduler": { "checkInterval": 60000, "enableFileWatcher": false }
}
```
I campi sopra sono quelli attualmente presenti nel file di esempio incluso in repo.【F:config.json†L1-L29】

### `App.config` (Agent)
Impostazioni principali dell’agent:
- `ServerHost`: host del server OnlyBackup.
- `ServerPort`: porta del server (default 8080).
- `AgentPort`: porta su cui l’agent ascolta.
- `HeartbeatInterval`: intervallo heartbeat in ms.【F:agent/OnlyBackupAgent/App.config†L1-L9】

## Struttura dati (Server)

Il server crea una struttura dati in `dataRoot` con directory predefinite per configurazioni, stato, utenti, log e alert:

```
dataRoot/
  config/
  state/
    jobs/
    runs/
    agents/
    scheduler/
    alerts/
  users/
  logs/
```
Queste directory sono create automaticamente all’avvio del server.【F:server/src/storage/storage.js†L9-L38】

## Note operative

- L’agent è pensato per ambienti Windows e può essere gestito come servizio o in console.【F:agent/OnlyBackupAgent/Program.cs†L1-L89】
- Il server utilizza le impostazioni di logging e scheduler definite in `config.json`.【F:config.json†L1-L29】

