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
- WiX Toolset 3.14 per il packaging MSI dell'agent, installato nel sistema oppure disponibile in `tools\wix314-binaries\`.
- `nssm` se si vuole installare il server come servizio Windows.

## Setup Iniziale Rapido

Guida dettagliata per utenti finali, setup server e agent:

- `docs\SETUP_UTENTE_FINALE.md`

Per il primo avvio del server da root repository:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -InitialAdminPassword "ChangeMe123!"
powershell -ExecutionPolicy Bypass -File .\scripts\doctor.ps1
Set-Location .\server
npm start
```

`bootstrap.ps1` esegue il setup minimo non interattivo:
- installa le dipendenze del server con `npm ci`;
- inizializza le directory sotto `data\`;
- crea l'utente `admin` se non esiste gia.

`doctor.ps1` non modifica il repository: verifica prerequisiti e conferma che il setup minimo sia completo.

Il server legge la configurazione da `..\config.json` oppure da `CONFIG_PATH`. Di default l'interfaccia risponde su `http://localhost:8080/`.

Se non passi `-InitialAdminPassword`, lo script di inizializzazione genera una password casuale e la stampa a console. Se l'utente `admin` esiste gia, il bootstrap non lo sovrascrive.

## Setup

### Server

Se vuoi eseguire solo una parte del setup:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -SkipDataInitialization
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

Il server non richiede una fase di build dedicata: dopo `npm install` puo essere eseguito direttamente con Node.js.

Il repository non espone oggi un entrypoint `compile` o `build` distinto per il server: il flusso operativo principale lato server e `bootstrap -> doctor -> npm start`.

### Agent

Per compilare l'agent e creare il pacchetto MSI:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Build-AgentMsi.ps1 -UseLocalhost
```

Se vuoi usare la toolchain WiX gia presente nel repository senza installazione globale:

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
- `scripts\doctor.ps1` controlla prerequisiti minimi del setup iniziale del server e segnala i componenti opzionali mancanti.
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
|-- AGENTS.md
|-- PROJECT_SPEC.md
|-- PROJECT_STATUS.json
|-- README.md
|-- LICENSE
|-- .gitignore
`-- config.json
```

## Licenza

Il repository e il relativo codice sorgente sono proprietari. Il testo completo della licenza e in `LICENSE`.
