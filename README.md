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
- MSBuild e .NET Framework 4.6.2 Developer Pack/Targeting Pack anche per compilare il wrapper del servizio server, se si vuole installare il server come servizio Windows.

Prerequisiti gestiti dagli script:
- `Setup-OnlyBackupServer.ps1` installa le dipendenze server con `npm ci`, inizializza i dati locali e puo generare pacchetto/installer server;
- `Build-AgentMsi.ps1` scarica, conserva in `scripts\support\wix\payload\` e verifica il pacchetto offline .NET Framework 4.6.2 usato dal bootstrapper MSI.

Prerequisiti manuali:
- Node.js `>= 20.19.0` e npm devono essere gia disponibili nel `PATH`; `Setup-OnlyBackupServer.ps1`, `Test-OnlyBackupPrerequisites.ps1`, `Install-OnlyBackupServerService.ps1` e il bootstrap server bloccano l'esecuzione con messaggio esplicito se mancano o sono troppo vecchi;
- MSBuild e .NET Framework 4.6.2 Developer Pack/Targeting Pack devono essere installati se vuoi compilare l'agent; `Build-AgentMsi.ps1` blocca la build prima del packaging se il Targeting Pack manca;
- Il servizio server usa un wrapper .NET Framework incluso nel repository e installato con strumenti Windows integrati; non richiede NSSM o altri service wrapper esterni.

Nei package distribuibili il runtime .NET Framework 4.6.2 e incluso come payload offline e viene installato dal setup quando necessario. L'installer server si blocca prima di installare il servizio se Node.js `>= 20.19.0` non e disponibile; l'MSI agent si blocca se `robocopy.exe` non e presente sul client Windows.

## Setup Iniziale Rapido

Guida dettagliata per utenti finali, setup server e agent:

- `docs\SETUP_UTENTE_FINALE.md`

Per il primo avvio del server da root repository:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1 -InitialAdminPassword "ChangeMe123!"
Set-Location .\server
npm start
```

Setup server end-to-end, con build del wrapper servizio ma senza registrazione:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1 -InitialAdminPassword "ChangeMe123!" -BuildService
```

Setup server con installazione e avvio servizio Windows, da PowerShell amministratore:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1 -InitialAdminPassword "ChangeMe123!" -InstallService -StartService
```

`Setup-OnlyBackupServer.ps1` esegue il setup minimo non interattivo:
- installa le dipendenze del server con `npm ci`;
- inizializza le directory sotto `data\`;
- crea l'utente `admin` se non esiste gia.

`Test-OnlyBackupPrerequisites.ps1` non modifica il repository: verifica prerequisiti e conferma che il setup minimo sia completo.

Il server legge la configurazione da `..\config.json` oppure da `CONFIG_PATH`. Di default l'interfaccia risponde su `http://localhost:8080/`.

Se non passi `-InitialAdminPassword`, lo script di inizializzazione genera una password casuale e la stampa a console. Se l'utente `admin` esiste gia, il bootstrap non lo sovrascrive.

## Setup

### Server

Se vuoi eseguire solo una parte del setup senza inizializzare i dati:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1 -SkipDataInitialization
```

Questo installa solo le dipendenze del server senza creare o aggiornare i dati locali.

Per compilare il wrapper del servizio server usa lo stesso entrypoint di setup:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1 -InitialAdminPassword "ChangeMe123!" -BuildService
```

Output principale: `output\server-service\OnlyBackupServerService.exe`.

Per generare un setup server self-contained, con app Node.js, `node_modules`, wrapper servizio, sorgenti/asset agent, WiX 3.14, payload .NET 4.6.2, prerequisiti dichiarati e asset brand, usa sempre lo stesso script:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1 -InitialAdminPassword "ChangeMe123!" -BuildPackage
```

Output principali:
- cartella setup in `output\server-setup\OnlyBackupServerSetup\`;
- archivio distribuibile in `output\server-setup\OnlyBackupServerSetup.zip`.

Il pacchetto include anche quanto serve alla UI admin per generare l'MSI agent: `agent\`, `scripts\Build-AgentMsi.ps1`, `scripts\support\wix\`, `tools\wix314-binaries\`, `assets\agent\` e il payload offline .NET Framework 4.6.2 verificato. Sul server che genera MSI agent restano manuali MSBuild e .NET Framework 4.6.2 Developer Pack/Targeting Pack.

Per generare anche l'installer Inno Setup:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1 -InitialAdminPassword "ChangeMe123!" -BuildInstaller -InnoCompilerPath "C:\Program Files (x86)\Inno Setup 6"
```

Prerequisito aggiuntivo: Inno Setup 6.x (`ISCC.exe`) installato nel `PATH` o passato con `-InnoCompilerPath`, anche come cartella, per esempio `C:\Program Files (x86)\Inno Setup 6`. L'installer Inno mostra la licenza, richiede l'accettazione delle condizioni, chiede la password iniziale dell'utente `admin`, installa e avvia il servizio server automaticamente, e include un task opzionale che chiede se creare sul desktop il collegamento alla UI admin `http://localhost:8080/server-settings.html`.

Output principale: `output\server-setup\inno\OnlyBackupServerSetup.exe`.

### Agent

Il progetto dell'agent e in `agent\OnlyBackupAgent\OnlyBackupAgent.csproj`.

## Build

### Server

Il server non richiede una fase di build dedicata: dopo `npm ci` puo essere eseguito direttamente con Node.js.

Il repository non espone un entrypoint `compile` o `build` applicativo distinto per il server: il flusso operativo principale lato server e `Setup-OnlyBackupServer.ps1` per setup/package e `npm start` per esecuzione diretta.

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
powershell -ExecutionPolicy Bypass -File .\scripts\Install-OnlyBackupServerService.ps1 -StartService
```

Gli script di installazione e rimozione del servizio richiedono PowerShell avviata come amministratore.
Il servizio server viene gestito dal wrapper `OnlyBackupServerService.exe` compilato in `output\server-service\` e registrato tramite installer .NET/Service Control Manager.
La pagina web `/server-settings.html` consente agli amministratori di leggere stato, avviare, arrestare e riavviare il servizio Windows quando il server e raggiungibile.

## Test E Verifica

Verifiche disponibili:
- `scripts\Invoke-RepositoryGate.ps1` esegue il gate locale: parsing script/JSON, preflight, smoke test server e packaging MSI.
- `scripts\Test-OnlyBackupPrerequisites.ps1` controlla prerequisiti minimi del setup iniziale del server e segnala i componenti opzionali mancanti.
- `scripts\Test-OnlyBackupPrerequisites.ps1 -SelfTest` verifica il percorso automatico di prerequisito assente, messaggio atteso e preflight riuscito.
- `scripts\Test-OnlyBackupPrerequisites.ps1 -RequireServerServiceTooling` verifica anche la toolchain richiesta per compilare il wrapper Windows Service del server.
- `npm test` esegue uno smoke test end-to-end del server: bootstrap auth/admin, route alert/email/settings, heartbeat client, CRUD job, esecuzione manuale contro un fake agent, log e backup analyze/delete.
- `scripts\Validate-MsiPackage.ps1` valida metadati e integrita del pacchetto MSI prodotto.
- `scripts\Test-AgentMsiUpgrade.ps1` verifica la coerenza di un upgrade tra due MSI.
- `scripts\Test-OnlyBackupAgentInstall.ps1` esegue un controllo rapido di un'installazione Windows dell'agent.

Inventario completo e stato degli script: `scripts\script.md`.

Asset applicativi, brand kit e riferimenti tecnici: `docs\ASSETS.md`.

## Comandi Supportati

| Area | Comando | Stato |
| --- | --- | --- |
| Setup server | `powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1 -InitialAdminPassword "ChangeMe123!"` | Supportato |
| Setup server completo | `powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1 -InitialAdminPassword "ChangeMe123!" -BuildService` | Supportato |
| Preflight | `powershell -ExecutionPolicy Bypass -File .\scripts\Test-OnlyBackupPrerequisites.ps1` | Supportato |
| Install dipendenze server | `Set-Location .\server; npm ci` | Supportato |
| Run server | `Set-Location .\server; npm start` | Supportato, processo long-running |
| Dev server | `Set-Location .\server; npm run dev` | Supportato, imposta `NODE_ENV=development` |
| Test server | `Set-Location .\server; npm test` | Supportato |
| Build servizio server | `powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1 -InitialAdminPassword "ChangeMe123!" -BuildService` | Supportato |
| Build setup server | `powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1 -InitialAdminPassword "ChangeMe123!" -BuildPackage` | Supportato |
| Build installer Inno server | `powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1 -InitialAdminPassword "ChangeMe123!" -BuildInstaller -InnoCompilerPath "C:\Program Files (x86)\Inno Setup 6"` | Supportato, richiede Inno Setup 6.x |
| Installa servizio server | `powershell -ExecutionPolicy Bypass -File .\scripts\Install-OnlyBackupServerService.ps1 -StartService` | Supportato, richiede admin |
| Rimuovi servizio server | `powershell -ExecutionPolicy Bypass -File .\scripts\Uninstall-OnlyBackupServerService.ps1 -Force` | Supportato, richiede admin |
| Gate repository | `powershell -ExecutionPolicy Bypass -File .\scripts\Invoke-RepositoryGate.ps1` | Supportato |
| Audit dipendenze | `Set-Location .\server; npm audit --audit-level=low` | Supportato; oggi segnala vulnerabilita residue tracciate in `PROJECT_STATUS.json` |
| Build server | nessun comando | Non previsto: server eseguito direttamente da Node.js |
| Lint/typecheck | nessun comando | Non presente nel manifest |
| Package agent | `powershell -ExecutionPolicy Bypass -File .\scripts\Build-AgentMsi.ps1 -UseLocalhost` | Supportato |
| Pulizia output | `powershell -ExecutionPolicy Bypass -File .\scripts\Clean-Repository.ps1` | Supportato; non rimuove `data\` |

## Publish E Packaging

Il packaging versionato nel repository riguarda l'agent Windows tramite MSI. Il flusso documentato e implementato nello script `scripts\Build-AgentMsi.ps1`.

Il server Node.js non richiede build applicativa; per l'esecuzione come servizio Windows il repository compila il wrapper `server\service-wrapper\OnlyBackupServerService.csproj` e lo installa con `scripts\Install-OnlyBackupServerService.ps1`.

Per distribuire il server fuori dal repository usa `scripts\Setup-OnlyBackupServer.ps1 -BuildPackage`: il pacchetto risultante include `server\`, dipendenze npm, `agent\`, `tools\wix314-binaries\`, `service\`, `config.json`, script install/uninstall, prerequisiti, loghi/immagini in `assets\brand\` e asset agent in `assets\agent\`.

Per produrre un `.exe` installabile usa `scripts\Setup-OnlyBackupServer.ps1 -BuildInstaller`: compila `scripts\support\inno\OnlyBackupServerSetup.iss` e aggiunge licenza, password admin iniziale, installazione/avvio servizio e richiesta per il collegamento desktop alla UI admin.

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
|   |-- support/
|   |-- Build-AgentMsi.ps1
|   |-- Setup-OnlyBackupServer.ps1
|   |-- Test-OnlyBackupPrerequisites.ps1
|   `-- Invoke-RepositoryGate.ps1
|-- tools/
|   `-- wix314-binaries/
|-- server/
|   |-- public/
|   |-- service-wrapper/
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
