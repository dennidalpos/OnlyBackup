<p align="center">
  <img src="server/public/assets/brand/onlybackup-logo-on-light.svg" alt="OnlyBackup" width="320">
</p>

# OnlyBackup

OnlyBackup e un sistema centralizzato di backup e restore per ambienti Windows composto da:
- un server Node.js con API HTTP e dashboard web statica;
- un agent Windows in C# eseguibile come servizio o in modalita console;
- script PowerShell per installazione servizi, packaging MSI e verifiche operative.

## Requisiti

- Windows come ambiente operativo di riferimento.
- Node.js `>= 20.19.0` per il server.
- .NET Framework 4.6.2 per eseguire l'agent; .NET Framework 4.6.2 Developer Pack/Targeting Pack per compilarlo.
- MSBuild compatibile con Visual Studio Build Tools o Visual Studio.
- WiX Toolset 3.14 per il packaging MSI dell'agent, installato nel sistema oppure disponibile in `tools\wix314-binaries\`.
- `nssm` se si vuole installare il server come servizio Windows.

Prerequisiti gestiti dagli script:
- `Initialize-OnlyBackup.ps1` installa le dipendenze server con `npm ci` e inizializza i dati locali;
- `Build-AgentMsi.ps1` scarica, conserva in `scripts\wix\payload\` e verifica il pacchetto offline .NET Framework 4.6.2 usato dal bootstrapper MSI.

Prerequisiti manuali:
- Node.js `>= 20.19.0` e npm devono essere gia disponibili nel `PATH`; `Initialize-OnlyBackup.ps1`, `Test-OnlyBackupPrerequisites.ps1`, `Install-OnlyBackupServerService.ps1` e il bootstrap server bloccano l'esecuzione con messaggio esplicito se mancano o sono troppo vecchi;
- MSBuild e .NET Framework 4.6.2 Developer Pack/Targeting Pack devono essere installati se vuoi compilare l'agent; `Build-AgentMsi.ps1` blocca la build prima del packaging se il Targeting Pack manca;
- `nssm.exe` deve essere copiato manualmente o disponibile nel `PATH` se vuoi installare il server come servizio; lo script servizio si ferma prima della registrazione se manca o se il setup server non e completo.

## Setup Iniziale Rapido

Guida dettagliata per utenti finali, setup server e agent:

- `docs\SETUP_UTENTE_FINALE.md`

Per il primo avvio del server da root repository:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Initialize-OnlyBackup.ps1 -InitialAdminPassword "ChangeMe123!"
powershell -ExecutionPolicy Bypass -File .\scripts\Test-OnlyBackupPrerequisites.ps1
Set-Location .\server
npm start
```

`Initialize-OnlyBackup.ps1` esegue il setup minimo non interattivo:
- installa le dipendenze del server con `npm ci`;
- inizializza le directory sotto `data\`;
- crea l'utente `admin` se non esiste gia.

`Test-OnlyBackupPrerequisites.ps1` non modifica il repository: verifica prerequisiti e conferma che il setup minimo sia completo.

Il server legge la configurazione da `..\config.json` oppure da `CONFIG_PATH`. Di default l'interfaccia risponde su `http://localhost:8080/`.

Se non passi `-InitialAdminPassword`, lo script di inizializzazione genera una password casuale e la stampa a console. Se l'utente `admin` esiste gia, il bootstrap non lo sovrascrive.

## Setup

### Server

Se vuoi eseguire solo una parte del setup:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Initialize-OnlyBackup.ps1 -SkipDataInitialization
```

Questo installa solo le dipendenze del server senza creare o aggiornare i dati locali.

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

Il server non richiede una fase di build dedicata: dopo `npm ci` puo essere eseguito direttamente con Node.js.

Il repository non espone oggi un entrypoint `compile` o `build` distinto per il server: il flusso operativo principale lato server e `Initialize-OnlyBackup.ps1 -> Test-OnlyBackupPrerequisites.ps1 -> npm start`.

### Agent

Per compilare l'agent e creare il pacchetto MSI:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Build-AgentMsi.ps1 -UseLocalhost
```

Lo script usa automaticamente la toolchain WiX gia presente in `tools\wix314-binaries\`, se disponibile. Puoi comunque passare un percorso esplicito:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Build-AgentMsi.ps1 -UseLocalhost -WixPath .\tools\wix314-binaries
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
- `scripts\Invoke-RepositoryGate.ps1` esegue il gate locale: parsing script/JSON, preflight, smoke test server e packaging MSI.
- `scripts\Test-OnlyBackupPrerequisites.ps1` controlla prerequisiti minimi del setup iniziale del server e segnala i componenti opzionali mancanti.
- `scripts\Test-OnlyBackupPrerequisites.ps1 -SelfTest` verifica il percorso automatico di prerequisito assente, messaggio atteso e preflight riuscito.
- `npm test` esegue uno smoke test end-to-end del server: bootstrap auth/admin, route alert/email/settings, heartbeat client, CRUD job, esecuzione manuale contro un fake agent, log e backup analyze/delete.
- `scripts\Validate-MsiPackage.ps1` valida metadati e integrita del pacchetto MSI prodotto.
- `scripts\Test-AgentMsiUpgrade.ps1` verifica la coerenza di un upgrade tra due MSI.
- `scripts\Test-OnlyBackupAgentInstall.ps1` esegue un controllo rapido di un'installazione Windows dell'agent.

Inventario completo e stato degli script: `scripts\script.md`.

Asset applicativi, brand kit e riferimenti tecnici: `docs\ASSETS.md`.

## Comandi Supportati

| Area | Comando | Stato |
| --- | --- | --- |
| Setup server | `powershell -ExecutionPolicy Bypass -File .\scripts\Initialize-OnlyBackup.ps1 -InitialAdminPassword "ChangeMe123!"` | Supportato |
| Preflight | `powershell -ExecutionPolicy Bypass -File .\scripts\Test-OnlyBackupPrerequisites.ps1` | Supportato |
| Install dipendenze server | `Set-Location .\server; npm ci` | Supportato |
| Run server | `Set-Location .\server; npm start` | Supportato, processo long-running |
| Dev server | `Set-Location .\server; npm run dev` | Supportato, imposta `NODE_ENV=development` |
| Test server | `Set-Location .\server; npm test` | Supportato |
| Gate repository | `powershell -ExecutionPolicy Bypass -File .\scripts\Invoke-RepositoryGate.ps1` | Supportato |
| Audit dipendenze | `Set-Location .\server; npm audit --audit-level=low` | Supportato; oggi segnala vulnerabilita residue tracciate in `PROJECT_STATUS.json` |
| Build server | nessun comando | Non previsto: server eseguito direttamente da Node.js |
| Lint/typecheck | nessun comando | Non presente nel manifest |
| Package agent | `powershell -ExecutionPolicy Bypass -File .\scripts\Build-AgentMsi.ps1 -UseLocalhost` | Supportato |
| Pulizia output | `powershell -ExecutionPolicy Bypass -File .\scripts\Clean-Repository.ps1` | Supportato; non rimuove `data\` |

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
Lo stato runtime locale sotto `data\` non viene rimosso automaticamente dallo script.

## Struttura Essenziale

```text
/
|-- agent/
|   |-- OnlyBackupAgent.sln
|   `-- OnlyBackupAgent/
|-- data/
|-- scripts/
|-- tools/
|   |-- nssm/
|   `-- wix314-binaries/
|-- server/
|   |-- public/
|   `-- src/
|-- docs/
|   |-- PROJECT_SPEC.md
|   `-- SETUP_UTENTE_FINALE.md
|-- PROJECT_STATUS.json
|-- README.md
|-- LICENSE
|-- .gitignore
`-- config.json
```

## Licenza

Il repository e il relativo codice sorgente sono proprietari. Il testo completo della licenza e in `LICENSE`.
