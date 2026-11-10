# Project Specification

## Goal
Fornire un sistema centralizzato di backup per client Windows, composto da un server Node.js con dashboard/API e da un agent Windows eseguibile come servizio o in modalita console.

## Scope
- Avvio del server HTTP con dashboard web e API REST.
- Gestione autenticazione, sessioni e configurazione server tramite file.
- Gestione job di backup pianificati e relativa esecuzione lato server.
- Registrazione heartbeat degli agent, rilevamento agent offline e generazione alert.
- Configurazione email, invio notifiche e flusso OAuth per provider supportati.
- Agent Windows per esecuzione backup e comunicazione con il server.
- Script operativi PowerShell per installazione servizi e build MSI dell'agent.

## Non Scope
- Agent Linux o macOS.
- Storage applicativo basato su database relazionale o servizio cloud gestito.
- Build/publish self-contained come default.
- Pipeline CI/CD; non esiste una directory `.github` o un workflow versionato nel repository.

## Architecture
- `server/`: applicazione Node.js basata su Express con entrypoint `server/src/server.js`.
- `server/src/api/routes.js`: punto di composizione delle API HTTP; le aree operative principali sono distribuite in moduli dedicati sotto `server/src/api/`.
- `server/src/storage/`: persistenza file-based sotto `dataRoot`, con directory per config, stato, utenti, log e alert.
- `server/public/`: dashboard HTML/CSS/JS servita come frontend statico, con asset frontend suddivisi in piu file per aree funzionali.
- `server/public/assets/brand/`: logo, mark, favicon, web manifest icons e immagini social di OnlyBackup.
- `agent/OnlyBackupAgent/`: agent .NET Framework 4.6.2 eseguibile come servizio Windows o console, con componenti di comunicazione HTTP e motore backup basato su filesystem/robocopy.
- `server/service-wrapper/`: wrapper .NET Framework 4.6.2 che avvia il server Node.js come servizio Windows, senza NSSM.
- `scripts/`: automazione operativa Windows per setup server, installazione servizio, package server self-contained, installer Inno opzionale, build MSI agent, validazione pacchetti e utilita di supporto.
- `tools/wix314-binaries/`: copia versionata della toolchain WiX 3.14 utilizzabile come alternativa all'installazione globale per il packaging MSI.

## Constraints
- Ambiente operativo di riferimento: Windows.
- Server: Node.js `>= 20.19.0`.
- Agent: .NET Framework 4.6.2.
- Packaging MSI: WiX Toolset 3.14, installato nel sistema oppure referenziato tramite `-WixPath`.
- Configurazione server letta da `config.json` nella root o da `CONFIG_PATH`.
- Persistenza server su filesystem locale; il repository non mostra un database applicativo dedicato.
- La strategia di riavvio operativa versionata nel repository e allineata a script PowerShell per ambiente Windows.
