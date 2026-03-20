# OnlyBackup

OnlyBackup e un sistema centralizzato di backup e restore per ambienti Windows composto da:
- un server Node.js con API HTTP e dashboard web statica;
- un agent Windows in C# eseguibile come servizio o in modalita console;
- script PowerShell per installazione servizi, packaging MSI e verifiche operative.

## Requisiti

- Windows come ambiente operativo di riferimento.
- Node.js `>= 18` per il server.
- .NET Framework 4.6.2 per l'agent.
- MSBuild compatibile con Visual Studio Build Tools o Visual Studio.
- WiX Toolset 3.14 per il packaging MSI dell'agent.
- `nssm` se si vuole installare il server come servizio Windows.

## Setup

### Server

```powershell
Set-Location .\server
npm install
```

Il server legge la configurazione da `..\config.json` oppure da `CONFIG_PATH`.

Al primo avvio, se non esistono utenti, il server crea automaticamente l'account `admin`.
Per rendere deterministica la password iniziale si puo usare `ONLYBACKUP_INITIAL_ADMIN_PASSWORD`.

Se vuoi installare il server come servizio Windows con `nssm`, copia `nssm.exe` in uno di questi percorsi:

```text
tools\nssm\nssm.exe
tools\nssm\win64\nssm.exe
tools\nssm\win32\nssm.exe
```

Il repository mantiene versionata solo la documentazione di questa cartella: i binari copiati restano ignorati da git.

### Agent

Il progetto dell'agent e in `agent\OnlyBackupAgent\OnlyBackupAgent.csproj`.

## Build

### Server

Il server non richiede una fase di build dedicata: dopo `npm install` puo essere eseguito direttamente con Node.js.

### Agent

Per compilare l'agent e creare il pacchetto MSI:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Build-AgentMsi.ps1 -UseLocalhost
```

Output principali:
- staging e log in `output\agent-msi\`;
- MSI finale in `output\agent-msi\artifacts\OnlyBackupAgent.msi`.

## Run

### Server

```powershell
Set-Location .\server
npm start
```

La dashboard principale e disponibile su `/` e le pagine operative dedicate sono:
- `/alerts.html` per alert attivi e storico;
- `/server-settings.html` per impostazioni server e utenti;
- `/email-settings.html` per SMTP, template e OAuth email.

### Agent

Modalita console:

```text
OnlyBackupAgent.exe /console
```

Installazione come servizio Windows:

```text
OnlyBackupAgent.exe /install
```

Per installare il server come servizio Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Install-OnlyBackupServerService.ps1
```

Gli script di installazione e rimozione del servizio richiedono PowerShell avviata come amministratore.
Gli script cercano `nssm` prima in `tools\nssm\` e poi nel `PATH`. In alternativa puoi passare `-NssmPath`.

## Test E Verifica

Verifiche disponibili:
- `npm test` esegue uno smoke test end-to-end del server: bootstrap auth/admin, route alert/email/settings, heartbeat client, CRUD job, esecuzione manuale contro un fake agent, log e backup analyze/delete.
- `scripts\Validate-MsiPackage.ps1` valida metadati e integrita del pacchetto MSI prodotto.
- `scripts\Test-MsiUpgrade.ps1` verifica la coerenza di un upgrade tra due MSI.
- `scripts\Quick-Check.ps1` esegue un controllo rapido di un'installazione Windows dell'agent.

## Publish E Packaging

Il packaging versionato nel repository riguarda l'agent Windows tramite MSI. Il flusso documentato e implementato nello script `scripts\Build-AgentMsi.ps1`.

Il repository non mostra un flusso distinto di publish applicativo per il server oltre all'esecuzione diretta del runtime Node.js o all'installazione come servizio Windows tramite `nssm`.

## Clean

Per riportare il repository a uno stato sorgente-only senza rimuovere file versionati:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Clean-Repository.ps1
```

Per rimuovere anche `server\node_modules`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Clean-Repository.ps1 -IncludeDependencies
```

Lo script rimuove solo directory generate locali come `logs\`, `output\`, `build\`, `dist\`, `publish\`, `tmp\`, `agent\**\bin\`, `agent\**\obj\` e, opzionalmente, `server\node_modules\`.

## Struttura Essenziale

```text
/
|-- agent/
|   |-- OnlyBackupAgent.sln
|   `-- OnlyBackupAgent/
|-- scripts/
|-- tools/
|   `-- nssm/
|-- server/
|   |-- public/
|   `-- src/
|-- AGENTS.md
|-- PROJECT_SPEC.md
|-- PROJECT_STATUS.json
|-- README.md
|-- LICENSE
|-- .gitignore
`-- config.json
```

## Licenza

Il repository e distribuito sotto licenza MIT. Il testo completo e in `LICENSE`.
