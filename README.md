# OnlyBackup

Sistema di backup centralizzato per ambienti Windows con architettura server/agent, orchestrazione HTTP e storage su filesystem. Supporta job con più mappature, modalità COPY e SYNC, retention automatica e logging completo per ogni run.

## Indice
1. Descrizione del progetto
2. Architettura generale
3. Requisiti di sistema
4. Installazione e avvio
5. Configurazione
6. Concetti fondamentali
7. Flusso di backup
8. Modalità COPY
9. Modalità SYNC
10. Logging
11. Dashboard e API
12. Notifiche Email
13. Struttura directory `data/`
14. Sviluppo e manutenzione
15. Troubleshooting

## 1. Descrizione del progetto
- **Scopo:** eseguire e governare backup di percorsi locali o UNC tramite agent Windows gestiti da un server Node.js.
- **Casi d'uso:** protezione file server e workstation, replica verso NAS/UNC, snapshot programmati con retention, sincronizzazione continua di directory.
- **Server vs Agent:**
  - **Server:** dashboard e API REST, scheduler, persistenza configurazioni e log sincronizzati; non esegue retention o cancellazioni sui dati di backup.
  - **Agent:** servizio Windows/console .NET 4.6.2 con engine robocopy; esegue copie, sincronizzazioni, retention e cancellazioni fisiche, gestisce credenziali e log.

## 2. Architettura generale
- **Componenti:**
  - Server Node.js 18+ con Express, scheduler interno, storage JSON su `dataRoot`.
  - Agent Windows (servizio o console) con API HTTP locale e wrapper robocopy.
- **Flusso server ↔ agent:**
  1. Il server distribuisce job e richieste on-demand (esecuzione, log, "backup presenti") via HTTP.
  2. L'agent esegue il backup, applica retention e genera log/events, quindi sincronizza i risultati al server.
  3. Il server persiste run e log ricevuti e li espone alla dashboard senza alterare la logica dell'agent.
- **Persistenza su filesystem:** configurazioni, stato scheduler, utenti e log sono salvati sotto `dataRoot` in formato JSON/flat files.
- **Logging e stato:** log applicativi lato server con rotazione, log per run lato agent sincronizzati su server; heartbeat agent salvati in `state/agents` per monitoraggio online/offline.

## 3. Requisiti di sistema
- **Server:** Windows Server 2012 R2+ (o equivalente), Node.js 18+, >=2 GB RAM, porta HTTP (default 8080) raggiungibile dagli agent.
- **Agent Windows:** Windows 7/8/8.1/10/11 o Windows Server 2008 R2+, .NET Framework 4.6.2, robocopy integrato, porta locale (default 8081) libera, permessi per accedere a sorgenti/destinazioni.
- **Rete e firewall:** consentire traffico server <-> agent sulle porte configurate; opzionale HTTPS/reverse proxy; accesso SMB/UNC verso destinazioni di backup.

## 4. Installazione e avvio
### Server
1. **Setup Node.js e dipendenze**
   ```bash
   cd server
   npm install
   ```
2. **Configurare `config.json`** (vedi §5) nella root del progetto.
3. **Inizializzazione dati (opzionale)**
   ```bash
   node scripts/init-data.js <password-admin>
   ```
   Se `dataRoot` non è definito in `config.json`, lo script inizializza automaticamente `./data` accanto al file di configurazione.
4. **Avvio**
   ```bash
   npm start
   CONFIG_PATH=../config.json node src/server.js
   ```
5. **Accesso dashboard:** `http://<host>:<porta>` (default admin/admin).
6. **Installazione come servizio (NSSM):** usare `nssm install OnlyBackupServer "C:\\Program Files\\nodejs\\node.exe"` con `AppDirectory` impostata su `server` e `CONFIG_PATH` puntato al file di configurazione.
7. **Script helper (PowerShell):**
   - Installazione: `.\scripts\Install-OnlyBackupServerService.ps1 -ConfigPath "<percorso\\config.json>"`
   - Disinstallazione: `.\scripts\Uninstall-OnlyBackupServerService.ps1`
8. **Variabili utili di avvio server:**
   - `CONFIG_PATH` per puntare un file di configurazione alternativo.
   - `NODE_ENV` per cambiare ambiente (`development` o `production`).

### Agent

#### Build MSI
**Requisiti:** WiX Toolset 3.14, .NET Framework 4.6.2 Developer Pack, MSBuild

```powershell
.\scripts\Build-AgentMsi.ps1
# Segui il wizard interattivo per configurare ServerHost (localhost o hostname/IP)
```

**Output:** `output/agent-msi/artifacts/OnlyBackupAgent.msi` (versione 1.0.3.0)

#### Installazione

**Versione Corrente: 1.0.3.0** - Punto di partenza pulito con nuovo UpgradeCode

**Installazione Standard:**
```powershell
# Installazione silenziosa con log (CONSIGLIATO)
msiexec /i OnlyBackupAgent.msi /qn ADDLOCAL=ALL /l*v C:\Temp\install.log

# Oppure usa lo script helper
.\scripts\Install-WithVerboseLog.ps1 -MsiPath ".\OnlyBackupAgent.msi"
```

**Verifica Installazione:**
```powershell
.\scripts\Quick-Check.ps1
# Verifica: file installati, servizio Running, voce registro
```

Il servizio `OnlyBackupAgent` viene installato e avviato automaticamente.

**NOTA IMPORTANTE:** La versione 1.0.3.0 usa un nuovo UpgradeCode. Per migrare da versioni precedenti (1.0.0.x - 1.0.2.x):
1. Eseguire cleanup completo: `.\scripts\Force-Cleanup.ps1`
2. Riavviare il sistema se richiesto
3. Installare la nuova versione

Consultare `scripts/MSI-INSTALLATION-GUIDE.md` per troubleshooting e casi d'uso avanzati.

#### Modalità Console (Debug)
```powershell
cd "C:\\Program Files (x86)\\OnlyBackup\\Agent"
.\OnlyBackupAgent.exe /console
```

#### Configurazione
File: `OnlyBackupAgent.exe.config`
- ServerHost: hostname o IP del server OnlyBackup
- ServerPort: porta server (default 8080)
- AgentPort: porta locale agent (default 8081)
- HeartbeatInterval: frequenza heartbeat in ms (default 30000)

Per i dettagli operativi dell’agent (componenti, struttura del progetto, build e troubleshooting), consultare `agent/README.md`.

## 5. Configurazione
- **`config.json` server (estratto):**
  ```json
  {
    "server": {
      "host": "0.0.0.0",
      "port": 8080,
      "environment": "production",
      "publicUrl": "https://backup.example.com"
    },
    "dataRoot": "./data",
    "logging": { "level": "info", "console": true, "file": true, "maxFiles": 180, "maxSize": "10m", "retentionDays": 180, "cleanupIntervalHours": 6 },
    "auth": { "sessionTimeout": 3600000, "passwordMinLength": 8, "secureCookies": false },
    "scheduler": { "checkInterval": 60000, "enableFileWatcher": true }
  }
  ```
- **`dataRoot` predefinito:** se omesso, viene usata la cartella `data` accanto al file di configurazione.
- **Utenti e autenticazione:** credenziali in `data/users/users.json` (ricreare admin/admin eliminando il file con servizio fermo). Sessione basata su cookie; impostare `secureCookies` su `true` con HTTPS.
- **OAuth email (Google/Microsoft):** se il server è pubblicato dietro HTTPS o reverse proxy, impostare `server.publicUrl` con l’URL pubblico (serve per costruire la redirect URI OAuth HTTPS).
- **Sicurezza:** proteggere `dataRoot` con ACL NTFS, usare account servizio dedicati, considerare BitLocker/HTTPS e firewall restrittivi. Le credenziali dei job sono salvate in chiaro nei JSON: limitare l'accesso ai file.
- **Configurazioni avanzate suggerite:**
  - `logging.maxFiles` e `logging.retentionDays` per ridurre lo spazio su disco dei log.
  - `scheduler.checkInterval` per controllare la frequenza di polling dello scheduler.
  - `scheduler.enableFileWatcher` per attivare il watcher delle modifiche di configurazione.

## 6. Concetti fondamentali
- **Job:** unità logica schedulata, con uno o più mapping; definisce credenziali, pianificazione e retention (max backup per COPY).
- **Mappatura:** coppia sorgente/destinazione più modalità (COPY/SYNC); un job può avere mappature multiple anche verso destinazioni diverse o condivise (i backup vengono isolati tramite manifest).
- **Run:** esecuzione di un job (manuale o schedulata) identificata da `runId`, produce log e, in COPY, una cartella timestamp.
- **Destinazione:** percorso locale o UNC con credenziali opzionali; usata per copia o sincronizzazione.
- **Retention:** per modalità COPY mantiene i N snapshot più recenti cancellando gli altri in ordine deterministico; usa le stesse credenziali del job.
- **Modalità COPY:** crea snapshot timestamped `YYYY_MM_DD_HH_mm_ss` per ogni mappatura, soggetti a retention e cleanup automatico.
- **Modalità SYNC:** sincronizza la destinazione in-place (robocopy /MIR) senza timestamp; ideale per allineamenti continui.

## 7. Flusso di backup
1. Creazione job via dashboard/API con mappature e pianificazione (giorni/ore multiple).
2. Lo scheduler server attiva il job o l'utente esegue un trigger manuale.
3. Il server invia la richiesta all'agent target; l'agent esegue le mappature in sequenza applicando modalità e credenziali.
4. In modalità COPY vengono create cartelle timestamp; al termine viene valutata la retention.
5. Log robocopy ed eventi vengono salvati localmente e sincronizzati al server; la dashboard mostra stato finale (success/fail) e log completi.
6. Errori di esecuzione o connessione sono restituiti all'API; in caso di offline l'agent mette in coda log/eventi e li invia al ripristino.

## 8. Modalità COPY
- Crea snapshot per ogni mappatura sotto la destinazione con formato `YYYY_MM_DD_HH_mm_ss` (1:1 con `runId`).
- Supporta più destinazioni per job: ogni mappatura genera il proprio snapshot.
- Retention: mantiene esattamente N snapshot recenti; cancellazioni registrate come eventi `DELETE_EXECUTED`/`DELETE_FAILED`.
- Cleanup automatico gestito dall'agent, nessuna logica server-side.

## 9. Modalità SYNC
- Usa robocopy con semantica `/MIR` per allineare sorgente e destinazione senza cartelle timestamp.
- Destinazione fissa; le modifiche vengono riflesse in-place ad ogni run.
- Nessuna retention di snapshot, ma i log della run sono conservati con la stessa pipeline di logging.

## 10. Logging
- **Server:** livelli `error|warn|info|debug`, rotazione configurabile (`maxSize`, `maxFiles`, `retentionDays`).
- **Run/Job:** per ogni `runId` l'agent produce `run.json` (report strutturato), `robocopy.log` (log completo), `events.json` (eventi retention/cancellazioni).
- **Append & upload:** log append-only lato agent, sincronizzati al server tramite API; le richieste di eliminazione da UI rimuovono anche i file lato agent.
- **Limite 20MB:** l'agent applica retention FIFO ai propri log locali oltre 20 MB preservando i run più recenti; i file rimossi vengono eliminati fisicamente.
- **Rotazione:** il server può ruotare stdout/stderr quando eseguito come servizio (es. via NSSM) e i log applicativi secondo le impostazioni di `config.json`.

## 11. Dashboard e API
- **Autenticazione:** login utente, cookie di sessione; endpoint `/api/auth/login`.
- **Editor job:** creazione/modifica job con mappature multiple, credenziali e pianificazioni.
- **Backup presenti (on-demand):** richiesta UI inoltrata all'agent che esegue scansione live di tutte le destinazioni configurate. I backup vengono filtrati in base al `manifest` per mostrare solo quelli pertinenti alla mappatura specifica, supportando destinazioni condivise.
- **Riconoscimento snapshot legacy:** la scansione considera anche cartelle con manifest oppure con nome timestamp `YYYY_MM_DD_HH_mm_ss` (fallback per vecchi backup).
- **Log completi:** visualizzazione di `run.json`, `robocopy.log` ed eventi sincronizzati; eliminazioni UI propagano la cancellazione al client.
- **Monitoraggio agent:** heartbeat via `/api/agent/heartbeat`, stato agent su `/api/status` (locale), panoramica `clients`/`runs` via API REST.
- **Notifiche email:** sistema integrato per notifiche automatiche su eventi critici (backup falliti/parziali, agent offline/online). Configurazione SMTP completa con supporto OAuth2 per Gmail/Office365, template email personalizzabili per ogni tipo di evento.
- **Endpoint utili per integrazioni:**
  - `/api/jobs` per l'elenco e la modifica dei job.
  - `/api/runs` per lo storico delle esecuzioni e gli stati.
  - `/api/agents` per lo stato di disponibilità degli agent.

## 12. Notifiche Email
Il sistema integra notifiche email automatiche per eventi critici:

### Configurazione SMTP
Dalla dashboard accedere a **📧 Email** nella barra superiore per configurare:
- **Server SMTP:** host, porta, SSL/TLS
- **Autenticazione:** Basic (username/password) o OAuth2 (Gmail/Office365 con MFA)
- **Destinatari:** lista di email che riceveranno le notifiche
- **Eventi notificabili:**
  - Backup falliti (failed)
  - Backup parziali (partial)
  - Errori critici (critical)
  - Avvisi backup (warning)
  - Agent offline
  - Agent tornato online (opzionale)

### Template Email Personalizzabili
Ogni tipo di evento ha un template modificabile (soggetto + corpo) con supporto per:
- **Placeholder principali:** `{{hostname}}`, `{{job_id}}`, `{{run_id}}`, `{{timestamp}}`, `{{status}}`, `{{target_path}}`
- **Placeholder agent:** `{{last_seen}}`, `{{offline_duration}}`
- **Placeholder statistiche:** `{{stats.total_files}}`, `{{stats.copied_files}}`, `{{stats.skipped_files}}`, `{{stats.failed_files}}`
- **Condizioni:** `{{#if variabile}}...{{/if}}` (es. `warnings`, `errors`, `stats`, `jobs`)
- **Iterazioni:** `{{#each array}}{{this.campo}}{{/each}}` (es. `errors`, `warnings`, `jobs`)

Nella sezione Template Email della dashboard è disponibile un elenco ordinato di placeholder/condizioni/liste: cliccando un elemento, il testo viene copiato negli appunti per un inserimento rapido nel corpo dell’email.

### Configurazione Rapida
1. Gmail con App Password:
   - Host: `smtp.gmail.com`, Porta: `587`, Auth: Basic
   - Generare App Password da impostazioni account Google
2. Office 365:
   - Host: `smtp.office365.com`, Porta: `587`, Auth: Basic
   - Usare password account o App Password se MFA attivo

### Test
Pulsante "Invia Email di Test" disponibile per verificare la configurazione prima del salvataggio.

### Persistenza
Le configurazioni sono salvate in `data/config/`:
- `email-settings.json` - Impostazioni SMTP e destinatari
- `email-templates.json` - Template personalizzati

## 13. Struttura directory `data/`
```
data/
├── config/
│   ├── email-settings.json
│   └── email-templates.json
├── state/
│   ├── jobs/
│   ├── runs/
│   ├── agents/
│   └── scheduler/
├── users/
└── logs/
    └── <hostname>/<jobId>/<runId>/
        ├── run.json
        ├── robocopy.log
        └── events.json
```
Note: l'agent applica retention log a 20 MB e le eliminazioni da UI rimuovono anche i file locali. Usare `scripts/init-data.js` solo per inizializzare admin o rigenerare stato scheduler vuoto.

## 14. Sviluppo e manutenzione
- Evitare modifiche invasive allo scheduler senza backup di `dataRoot` (jobs/runs/agents/scheduler).
- Eseguire backup periodici della directory `data/` prima di upgrade di server o agent.
- Garantire compatibilità dello scheduler con il formato `state/scheduler` quando si introducono nuove versioni.
- Aggiornamenti agent: fermare il servizio, opzionale backup di `OnlyBackupAgent.exe.config`, installare nuovo MSI, verificare riavvio del servizio.
- **Ripristino rapido:** conservare copie di `config.json` e `data/` per ricostruire server e dashboard senza perdere storici.
- **Rotazione log lato agent:** verificare periodicamente le cartelle `data/logs` per evitare crescite anomale in caso di problemi di rete.

## 15. Troubleshooting
- **Agent offline:** verificare servizio `OnlyBackupAgent`, configurazione host/porte, firewall outbound, DNS; usare `Get-EventLog` per dettagli.
- **Errori robocopy/accesso negato:** controllare permessi NTFS/UNC su sorgente e destinazione, credenziali job e account servizio; test manuale `robocopy` o `net use`.
- **Permessi UNC / conflitti credenziali (1219):** disconnettere sessioni esistenti (`net use \\server /delete /yes`), riavviare agent; usare credenziali dedicate.
- **Problemi modalità SYNC:** verificare percorsi esistenti e stato connessione SMB; errori 2/53 indicano percorso non trovato.
- **Retention non applicata:** assicurarsi che `retention.max_backups` sia impostato nel job e che le credenziali abbiano permessi di delete sulla destinazione.
- **Log non visualizzati:** controllare presenza file in `data/logs/<hostname>/<jobId>`, verificare upload agent e permessi su `data/logs`.
- **Server non raggiungibile:** verificare porta 8080 (o configurata), processi in ascolto e regole firewall; con NSSM ispezionare `service-stdout/stderr.log`.
- **.NET Framework mancante (agent):** installare .NET 4.6.2 Developer Pack e riavviare; l'installer MSI blocca l'installazione in assenza del prerequisito.
- **Email non inviate:** verificare configurazione SMTP (test email), controllare log server per errori di connessione, verificare credenziali e firewall outbound sulla porta SMTP. Per Gmail/Office365 con MFA usare App Password o OAuth2.
