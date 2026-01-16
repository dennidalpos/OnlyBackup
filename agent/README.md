# OnlyBackup Agent

Questa cartella contiene il progetto Windows Agent di OnlyBackup (soluzione `.sln` e codice C#). L’agent espone API HTTP locali per eseguire job, sincronizzare log ed effettuare retention.

## Struttura principale
- `OnlyBackupAgent.sln`: soluzione Visual Studio.
- `OnlyBackupAgent/Program.cs`: entry point dell’applicazione.
- `OnlyBackupAgent/Service`: logica del servizio Windows.
- `OnlyBackupAgent/Communication`: API HTTP e comunicazione con il server.
- `OnlyBackupAgent/FileSystem`: logica di copia/sync/retention (robocopy).

## Build
Aprire la soluzione in Visual Studio (target .NET Framework 4.6.2) e compilare in modalità Release.

Per la creazione del pacchetto MSI vedere gli script in `scripts/`:
- `scripts/Build-AgentMsi.ps1`
- `scripts/MSI-INSTALLATION-GUIDE.md`

## Configurazione runtime
Il file `OnlyBackupAgent.exe.config` contiene:
- `ServerHost` e `ServerPort`: destinazione del server OnlyBackup.
- `AgentPort`: porta locale HTTP esposta dall’agent.
- `HeartbeatInterval`: intervallo heartbeat in millisecondi.

## Note operative
- Il servizio Windows si chiama `OnlyBackupAgent`.
- L’agent utilizza `robocopy` per eseguire COPY/SYNC e applicare retention.
- Per troubleshooting consultare i log locali generati dall’agent e la documentazione in `scripts/`.
