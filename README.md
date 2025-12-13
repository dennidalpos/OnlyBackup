# OnlyBackup - Sistema di Backup/Restore Centralizzato

Sistema completo di backup/restore per client Windows con gestione centralizzata tramite server Node.js e dashboard web.

## Indice

- [Panoramica](#panoramica)
- [Architettura](#architettura)
- [Requisiti](#requisiti)
- [Installazione Server](#installazione-server)
- [Installazione Agent](#installazione-agent)
- [Configurazione](#configurazione)
- [Utilizzo Dashboard](#utilizzo-dashboard)
- [API REST](#api-rest)
- [Scheduler](#scheduler)
- [Versioning e Retention](#versioning-e-retention)
- [Modalità TEST/PROD](#modalità-testprod)
- [Gestione Log](#gestione-log)
- [Deregistrazione PC](#deregistrazione-pc)
- [Build e Deploy](#build-e-deploy)
- [Risoluzione Problemi](#risoluzione-problemi)
- [Note per contributori](#note-per-contributori)

---

## Panoramica

OnlyBackup è un sistema di backup/restore centralizzato progettato per ambienti Windows che offre:

- **Server centralizzato** Node.js con API REST e dashboard web
- **Agent Windows** installabile via MSI su tutti i client (compatibile Windows 7-11)
- **Scheduler avanzato** tipo Task Scheduler con pianificazioni complesse
- **Versioning automatico** dei backup con naming intelligente e gestione retention
- **Gestione completa via JSON** senza necessità di database
- **Dashboard web** moderna con autenticazione e visualizzazione real-time
- **Modalità TEST/PROD** per logging verboso o minimizzato
- **Deregistrazione PC** con pulizia automatica di tutti i dati associati

---

## Architettura

### Componenti Principali

```
OnlyBackup/
├── server/                 # Server Node.js
│   ├── src/
│   │   ├── api/           # API REST endpoints
│   │   ├── auth/          # Sistema autenticazione
│   │   ├── scheduler/     # Scheduler e job executor
│   │   ├── storage/       # Gestione file JSON
│   │   ├── logging/       # Sistema logging
│   │   └── server.js      # Entry point
│   ├── public/            # Dashboard web (HTML/CSS/JS)
│   └── package.json
│
├── agent/                 # Agent Windows (.NET 4.6.2)
│   ├── OnlyBackupAgent/
│   │   ├── Service/       # Servizio Windows
│   │   ├── Communication/ # HTTP server e comunicazione
│   │   ├── FileSystem/    # Operazioni filesystem e backup
│   │   └── OnlyBackupAgent.csproj
│   └── OnlyBackupAgent.sln
│
├── scripts/               # Script di build
│   ├── Build-AgentMsi.ps1 # Build MSI con WiX 3.14
│   └── wix/
│       └── AgentInstaller.wxs
│
├── data/                  # Data root (file JSON)
│   ├── config/            # Configurazioni
│   ├── state/
│   │   ├── jobs/          # Job configurati
│   │   ├── runs/          # Storico esecuzioni
│   │   └── scheduler/     # Stato scheduler
│   ├── users/             # Utenti sistema
│   └── logs/              # Log applicativi
│
└── config.json            # Configurazione server
```

### Flusso di Lavoro

1. **Creazione Job**: Definisce sorgenti, destinazione, schedule e opzioni di backup per un client specifico
2. **Scheduler**: Monitora i job e li esegue secondo lo schedule configurato
3. **Esecuzione Backup**:
   - Server contatta Agent via HTTP
   - Agent esegue copia file da sorgenti a destinazione
   - Crea versione backup con naming `nomecartella_copyN_yyyy-mm-dd_hh_mm`
   - Applica retention se configurata
4. **Logging**: Ogni operazione è tracciata nei log strutturati (retention 6 mesi)

---

## Requisiti

### Server OnlyBackup

- **Sistema Operativo**: Windows Server 2016+ o Windows 10/11
- **Node.js**: versione 14.0.0 o superiore
- **RAM**: minimo 2 GB
- **Disco**: dipende da volume backup (se storage locale)
- **Rete**: porta 8080 (HTTP) accessibile da client

### Client con Agent

- **Sistema Operativo**: Windows 7 SP1, 8, 8.1, 10, 11, Server 2008 R2+
- **.NET Framework**: 4.6.2 o superiore
- **Rete**: porta 8081 accessibile dal server
- **Permessi**: account LocalSystem per servizio

### Build Environment (per sviluppatori)

- **Visual Studio** 2019/2022 o Build Tools
- **WiX Toolset** 3.14
- **PowerShell** 5.1 o superiore

---

## Installazione Server

### 1. Installare Node.js

Scaricare e installare Node.js da [nodejs.org](https://nodejs.org/)

### 2. Preparare Directory

```bash
cd OnlyBackup/server
npm ci
```

Inizializzare la struttura dati e l'utente `admin` (opzionale: specificare la password iniziale):

```bash
cd ..\scripts
node .\init-data.js "<password_admin>"
```

### 3. Configurare Server

Modificare `config.json` nella root del progetto:

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 8080,
    "environment": "prod"
  },
  "dataRoot": "./data",
  "logging": {
    "level": "info",
    "console": true,
    "file": true,
    "maxFiles": 180,
    "maxSize": "10m"
  }
}
```

### 4. Avviare Server

**Modalità sviluppo:**
```bash
cd server
npm start
```

**Modalità produzione (Windows Service):**

Utilizzare NSSM (Non-Sucking Service Manager):
```bash
nssm install OnlyBackupServer "C:\Program Files\nodejs\node.exe"
nssm set OnlyBackupServer AppDirectory "C:\OnlyBackup\server"
nssm set OnlyBackupServer AppParameters "src\server.js"
nssm start OnlyBackupServer
```

### 5. Verifica Installazione

Aprire browser: `http://localhost:8080`

Credenziali di default:
- Username: `admin`
- Password: `admin`

**IMPORTANTE**: Cambiare la password al primo accesso!

---

## Installazione Agent

### 1. Build MSI (per amministratori)

```powershell
cd scripts
.\Build-AgentMsi.ps1
```

Lo script chiederà:
- **Test (localhost)**: per ambiente di test
- **Produzione (hostname/IP)**: inserire hostname o IP del server OnlyBackup

MSI generato in: `output/OnlyBackupAgent.msi`

### 2. Distribuzione su Client

**Installazione silenziosa:**
```bash
msiexec /i OnlyBackupAgent.msi /qn
```

**Installazione con UI:**
```bash
msiexec /i OnlyBackupAgent.msi
```

### 3. Verifica Servizio

```bash
sc query OnlyBackupAgent
```

Il servizio dovrebbe essere "RUNNING".

### 4. Configurazione Firewall

Il servizio apre automaticamente la porta 8081. Verificare che il firewall permetta connessioni in ingresso dal server.

---

## Configurazione

### Job di Backup

I job definiscono **cosa**, **dove** e **quando** fare backup per un client specifico.

**File**: `data/state/jobs/<JOB_ID>.json`

**Esempio - Backup Giornaliero:**
```json
{
  "job_id": "JOB001",
  "client_hostname": "CLIENT-PC-01",
  "enabled": true,
  "mappings": [
    {
      "sources": [
        "C:\\Users\\utente\\Documents",
        "C:\\Users\\utente\\Desktop"
      ],
      "destination": "\\\\BACKUP-SERVER\\Backups\\CLIENT-PC-01"
    }
  ],
  "schedule": {
    "type": "daily",
    "start_time": "23:00",
    "every_n_days": 1
  },
  "options": {
    "versioning": true,
    "compression": false,
    "retention": {
      "max_versions": 7,
      "max_total_size_mb": 10240
    }
  },
  "created_at": "2025-01-01T00:00:00Z"
}
```

**Esempio - Backup Settimanale:**
```json
{
  "job_id": "JOB002",
  "client_hostname": "SERVER-01",
  "enabled": true,
  "mappings": [
    {
      "sources": ["D:\\DatabaseBackups"],
      "destination": "D:\\OnlyBackup\\SERVER-01"
    }
  ],
  "schedule": {
    "type": "weekly",
    "start_time": "02:00",
    "days_of_week": [1, 3, 5],
    "every_n_weeks": 1
  },
  "options": {
    "versioning": true,
    "retention": {
      "max_versions": 10
    }
  }
}
```

**Esempio - Backup Mensile:**
```json
{
  "job_id": "JOB003",
  "client_hostname": "SERVER-APP",
  "enabled": true,
  "mappings": [
    {
      "sources": ["D:\\Application"],
      "destination": "\\\\NAS\\Backups\\APP"
    }
  ],
  "schedule": {
    "type": "monthly",
    "start_time": "01:00",
    "days_of_month": [1, 15]
  },
  "options": {
    "versioning": true,
    "compression": true,
    "retention": {
      "max_versions": 12,
      "max_total_size_mb": 102400
    }
  }
}
```

### Tipi di Schedule

#### Once (una sola volta)
```json
{
  "type": "once",
  "start_date": "2025-12-31",
  "start_time": "23:59"
}
```

#### Daily (giornaliero)
```json
{
  "type": "daily",
  "start_time": "23:00",
  "every_n_days": 1
}
```

#### Weekly (settimanale)
```json
{
  "type": "weekly",
  "start_time": "02:00",
  "days_of_week": [1, 3, 5],
  "every_n_weeks": 1
}
```
*days_of_week: 1=Lunedì, 2=Martedì, ..., 7=Domenica*

#### Monthly (mensile)
```json
{
  "type": "monthly",
  "start_time": "01:00",
  "days_of_month": [1, 15]
}
```

---

## Utilizzo Dashboard

### Accesso

1. Aprire browser: `http://<server-ip>:8080`
2. Login con credenziali admin

### Schermata Pubblica (non autenticata)

Visibile senza login:
- Backup OK ultime 24h
- Backup falliti ultime 24h
- Client online/offline

### Dashboard Admin (autenticata)

**Header Dashboard:**
- **⬇ Export**: Esporta configurazione completa (client, job, utenti) in file JSON
- **⬆ Import**: Importa configurazione da file JSON (sovrascrive elementi esistenti)
- **🔑**: Reset password utente corrente
- **Logout**: Esci dalla sessione

**Pannello Sinistro - Lista Client:**
- Tutti i client con agent configurato
- Stato online/offline in tempo reale (aggiornamento ogni 5 secondi)
- **Icone stato backup:**
  - **● Giallo**: Backup in corso
  - **✓ Verde**: Backup completato con successo
  - **✗ Rosso**: Backup fallito
- **Pulsante ⏹ giallo**: Resetta stato backup bloccato (visibile solo durante backup)
  - ⚠️ **ATTENZIONE**: Resetta solo lo stato UI, non ferma il backup reale sull'agent

**Pannello Destro - Dettagli Client:**

**Azioni Client:**
- **Esegui Tutti**: Avvia manualmente tutti i job attivi del client
- **+ Nuovo Job**: Crea un nuovo job di backup
- **Elimina Log**: Rimuove solo lo storico delle esecuzioni (mantiene job e configurazione)
- **Deregistra**: Rimuove il client e tutti i dati associati (job, storico, configurazione)

**Tab "Job":**
- Lista job configurati per client
- Stato abilitato/disabilitato
- Pulsante "Esegui" per avvio manuale di singoli job
- Form per creare/modificare job con mappings sorgenti/destinazione e schedule

**Tab "Storico Run":**
- Cronologia esecuzioni
- Stato (success/failure/running)
- Timestamp, durata, bytes processati
- Path della versione creata
- Eventuali errori

**Tab "Filesystem":**
- Navigazione filesystem remoto del client (in sviluppo)

---

## API REST

Tutte le operazioni sono accessibili via API REST.

### Autenticazione

**Login:**
```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "admin"
}
```

**Logout:**
```http
POST /api/auth/logout
```

**Cambio Password:**
```http
POST /api/auth/change-password
Content-Type: application/json

{
  "oldPassword": "admin",
  "newPassword": "newSecurePassword123"
}
```

**Reset Password (senza password vecchia):**
```http
POST /api/auth/reset-password
Content-Type: application/json

{
  "newPassword": "newSecurePassword123"
}
```

### Job Management

**Lista Job:**
```http
GET /api/jobs
```

**Crea Job:**
```http
POST /api/jobs
Content-Type: application/json

{
  "job_id": "JOB004",
  "client_hostname": "CLIENT-NEW",
  "enabled": true,
  "mappings": [
    {
      "sources": ["C:\\Data"],
      "destination": "D:\\Backup\\CLIENT-NEW"
    }
  ],
  "schedule": {
    "type": "daily",
    "start_time": "23:00",
    "every_n_days": 1
  },
  "options": {
    "versioning": true,
    "retention": {
      "max_versions": 7
    }
  }
}
```

**Esegui Job Manualmente:**
```http
POST /api/jobs/JOB001/run
```

### Run History

**Lista Run:**
```http
GET /api/runs

# Filtra per job specifico
GET /api/runs?jobId=JOB001
```

**Dettaglio Run:**
```http
GET /api/runs/RUN-UUID
```

### Clients

**Lista Client:**
```http
GET /api/clients
```

**Elimina Storico Backup (solo run):**
```http
DELETE /api/clients/:hostname/runs
```

Elimina solo lo storico delle esecuzioni del client, mantenendo job e configurazione.

**Deregistra Client:**
```http
DELETE /api/clients/:hostname
```

Rimuove il client e pulisce tutti i dati associati (job, run history, log).

**Reset Stato Backup:**
```http
POST /api/clients/:hostname/reset-backup-status
```

Resetta lo stato backup del client (in_progress/completed/failed).
⚠️ **ATTENZIONE**: Resetta solo lo stato UI, non ferma il backup reale sull'agent.

### Configurazione

**Export Configurazione:**
```http
GET /api/config/export
```

Esporta la configurazione completa del server in formato JSON:
- Lista hostname client
- Tutti i job configurati
- Tutti gli utenti (con password hash)

**Esempio response:**
```json
{
  "version": "1.0",
  "exportDate": "2025-12-11T10:30:00.000Z",
  "clients": ["CLIENT-01", "CLIENT-02"],
  "jobs": [...],
  "users": [...]
}
```

**Import Configurazione:**
```http
POST /api/config/import
Content-Type: application/json

{
  "version": "1.0",
  "clients": ["CLIENT-01"],
  "jobs": [...],
  "users": [...]
}
```

Importa configurazione da JSON. Gli elementi con stesso ID vengono sovrascritti.

**Response:**
```json
{
  "success": true,
  "imported": {
    "jobs": 5,
    "users": 2
  }
}
```

### Scheduler

**Job Schedulati:**
```http
GET /api/scheduler/jobs
```

**Ricarica Scheduler:**
```http
POST /api/scheduler/reload
```

---

## Scheduler

### Come Funziona

1. All'avvio del server, lo scheduler:
   - Carica tutti i job da `data/state/jobs/`
   - Calcola la prossima esecuzione per ogni job abilitato

2. Controllo periodico (default ogni minuto):
   - Verifica se è ora di eseguire qualche job
   - Esegue i job scaduti

3. File Watcher (se abilitato):
   - Monitora modifiche ai file JSON dei job
   - Ricarica automaticamente lo scheduler

### Calcolo Prossima Esecuzione

Lo scheduler calcola la prossima esecuzione in base al tipo di schedule:

- **Once**: esegue una sola volta alla data/ora specificata
- **Daily**: ogni N giorni all'ora specificata
- **Weekly**: nei giorni della settimana specificati
- **Monthly**: nei giorni del mese specificati

### Esecuzione Manuale

I job possono essere eseguiti manualmente tramite:
- Dashboard: pulsante "Esegui" sul job
- API: `POST /api/jobs/<JOB_ID>/run`

L'esecuzione manuale non influenza lo schedule automatico.

### Esecuzione Backup

Quando un job viene eseguito, il `JobExecutor`:
- Usa i mappings definiti nel job per costruire la richiesta all'agent
- Calcola il percorso di destinazione (inserendo la cartella versione se attivo il versioning)
- Invia il payload all'HTTP endpoint `/backup` dell'agent con `sources`, `destination` e `options`

---

## Versioning e Retention

### Versioning

Se `options.versioning = true`, ogni run di successo crea una cartella dedicata:

**Formato naming:**
```
nomecartella_copyN_yyyy-mm-dd_hh_mm
```

dove:
- `nomecartella`: nome della cartella di destinazione del mapping
- `copyN`: numero progressivo della copia (copy1, copy2, copy3, ...)
- `yyyy-mm-dd_hh_mm`: timestamp dell'esecuzione

**Esempio:**
```
Backups_copy1_2025-12-09_23-00
Backups_copy2_2025-12-10_23-00
Backups_copy3_2025-12-11_23-00
```

**Nota**: I secondi NON sono inclusi nel nome.

### Retention Policy

**max_versions**: Mantiene solo le N versioni più recenti

Esempio con `max_versions: 7`:
- Versione 8 elimina versione 1
- Versione 9 elimina versione 2
- etc.

**max_total_size_mb**: Limita dimensione totale delle versioni

Se la somma delle dimensioni supera il limite:
- Elimina versioni più vecchie fino a rientrare nel limite
- Mantiene sempre almeno `max_versions` (se specificato)

**Esempio configurazione:**
```json
{
  "options": {
    "versioning": true,
    "retention": {
      "max_versions": 7,
      "max_total_size_mb": 10240
    }
  }
}
```

Questa configurazione:
- Mantiene massimo 7 versioni
- Se le 7 versioni superano 10 GB, elimina le più vecchie

---

## Modalità TEST/PROD

OnlyBackup supporta due modalità operative per controllare il livello di logging:

### Modalità TEST (Logging Verboso)

Avvia il server con logging dettagliato per debugging e sviluppo:

```bash
setup_test.bat
```

In questa modalità:
- Variabile ambiente `NODE_ENV=test`
- Log level più verboso (debug)
- Output console dettagliato
- Ideale per troubleshooting e testing

### Modalità PROD (Logging Minimizzato)

Avvia il server con logging minimizzato per produzione:

```bash
setup_prod.bat
```

In questa modalità:
- Variabile ambiente `NODE_ENV=production`
- Log level ridotto (info/warn/error)
- Output console essenziale
- Ottimizzato per performance

### Configurazione Manuale

È possibile impostare manualmente la variabile ambiente:

```bash
set NODE_ENV=test
node src\server.js
```

oppure

```bash
set NODE_ENV=production
node src\server.js
```

---

## Gestione Log

### Retention Period

I log vengono conservati per **6 mesi (180 giorni)**.

Configurazione in `config.json`:
```json
{
  "logging": {
    "maxFiles": 180
  }
}
```

### Rotazione Log

- **Rotazione giornaliera**: Un nuovo file log viene creato ogni giorno
- **Formato file**: `onlybackup-YYYY-MM-DD.log`
- **Dimensione massima**: 10MB per file (configurabile via `maxSize`)
- **Pulizia automatica**: I log più vecchi di 180 giorni vengono eliminati automaticamente

### Posizione Log

- Server: `data/logs/`
- Agent: Event Viewer di Windows (Application log)

### Eliminazione Storico Backup per Client

È possibile eliminare solo lo storico delle esecuzioni di un client specifico senza rimuovere il client stesso:

**Via Dashboard:**
1. Selezionare il client
2. Cliccare su "Elimina Log"
3. Confermare l'operazione

**Via API:**
```http
DELETE /api/clients/:hostname/runs
```

Questa operazione elimina solo le esecuzioni passate (run history), mantenendo:
- I job configurati
- La registrazione del client
- I file di backup già creati

---

## Deregistrazione PC

La deregistrazione rimuove completamente un client dal sistema, eliminando tutti i dati associati.

### Via Dashboard

1. Accedere alla dashboard come admin
2. Selezionare il client da deregistrare
3. Cliccare sul pulsante "Deregistra"
4. Confermare l'operazione nel dialog

La deregistrazione pulisce automaticamente:
- Tutti i job associati al client
- Storico esecuzioni (run history)
- Heartbeat e stato del client
- Dati di configurazione del client

### Via API

```http
DELETE /api/clients/:hostname
```

**Esempio:**
```bash
curl -X DELETE http://server:8080/api/clients/CLIENT-PC-01
```

**Nota**: I file di backup sulla destinazione NON vengono eliminati automaticamente. Devono essere rimossi manualmente se necessario.

### Differenza tra Deregistrazione e Eliminazione Log

- **Elimina Log** (`DELETE /api/clients/:hostname/runs`): Elimina solo lo storico esecuzioni, mantiene job e configurazione client
- **Deregistra** (`DELETE /api/clients/:hostname`): Elimina completamente il client e tutti i dati associati

---

## Build e Deploy

### Build Agent MSI

**Prerequisiti:**
- Visual Studio 2019/2022 o Build Tools
- WiX Toolset 3.14: https://github.com/wixtoolset/wix3/releases
- Il build scarica automaticamente il pacchetto offline di .NET Framework 4.6.2 e lo incorpora nell'MSI per installazioni self contained

**Build:**
```powershell
cd scripts
.\Build-AgentMsi.ps1

# Oppure con parametri
.\Build-AgentMsi.ps1 -ServerHost "backup.company.com"
.\Build-AgentMsi.ps1 -UseLocalhost
```

**Output:**
- `output/OnlyBackupAgent.msi`

### Deploy Server (Produzione)

**Opzione 1: Windows Service con NSSM**

1. Scaricare NSSM: https://nssm.cc/download
2. Installare servizio:
   ```bash
   nssm install OnlyBackupServer "C:\Program Files\nodejs\node.exe"
   nssm set OnlyBackupServer AppDirectory "C:\OnlyBackup\server"
   nssm set OnlyBackupServer AppParameters "src\server.js"
   nssm set OnlyBackupServer DisplayName "OnlyBackup Server"
   nssm set OnlyBackupServer Description "Sistema di backup/restore centralizzato"
   nssm set OnlyBackupServer Start SERVICE_AUTO_START
   nssm start OnlyBackupServer
   ```

**Opzione 2: Esecuzione manuale**
```bash
cd OnlyBackup/server
npm start
```

### Deploy Agent su Client

**Distribuzione MSI:**

**Locale:**
```bash
msiexec /i OnlyBackupAgent.msi /qn
```

**Remoto (via GPO):**
- Copiare MSI su share di rete
- Creare GPO per distribuzione software
- Assegnare MSI ai computer

**Remoto (via PowerShell):**
```powershell
$computers = @("CLIENT-01", "CLIENT-02", "CLIENT-03")

foreach ($computer in $computers) {
    Copy-Item "OnlyBackupAgent.msi" "\\$computer\C$\Temp\"
    Invoke-Command -ComputerName $computer -ScriptBlock {
        msiexec /i "C:\Temp\OnlyBackupAgent.msi" /qn
    }
}
```

---

## Risoluzione Problemi

### Server non si avvia

**Errore: porta già in uso**
- Verificare che porta 8080 sia libera
- Modificare porta in `config.json`

**Errore: modulo non trovato**
- Eseguire `npm install` nella directory `server/`

### Agent non comunica con Server

**Verifica connettività:**
```bash
# Dal client
telnet <server-ip> 8080
```

**Verifica servizio agent:**
```bash
sc query OnlyBackupAgent
```

**Verifica configurazione:**
- File: `C:\Program Files\OnlyBackup\Agent\OnlyBackupAgent.exe.config`
- Verificare che `ServerHost` sia corretto

**Log eventi Windows:**
- Aprire "Visualizzatore eventi"
- Applicazione → OnlyBackupAgent

### Job non si eseguono

**Verifica job abilitato:**
- Dashboard → Client → Job
- Verificare badge "Abilitato"

**Verifica schedule:**
- API: `GET /api/scheduler/jobs`
- Verificare `next_run`

**Log server:**
- `data/logs/onlybackup-YYYY-MM-DD.log`

### Backup fallito

**Controllare run details:**
- Dashboard → Client → Storico Run
- Verificare errori dettagliati

**Errori comuni:**

**"Destinazione non accessibile"**
- Verificare permessi su share di rete
- Verificare credenziali (se UNC path)
- Controllare che il percorso UNC usi esattamente due backslash iniziali (es. `\\\\server\\share\\cartella`) e che la share esista: l'agent effettua il mapping sulla root `\\\\server\\share` prima di creare le sottocartelle del backup

**"Sorgente non trovata"**
- Verificare path sorgente nella policy
- Verificare che esistano sul client

**"Agent non raggiungibile"**
- Verificare agent in esecuzione
- Verificare firewall porta 8081

### Performance e Ottimizzazione

**Server lento con molti client:**
- Aumentare RAM server
- Distribuire esecuzioni job su orari diversi

**Backup lenti:**
- Verificare velocità rete
- Considerare backup incrementali (feature futura)
- Ridurre dimensione sorgenti

---

## Struttura File JSON Completa

### config.json (root)
```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 8080,
    "environment": "dev|test|prod"
  },
  "dataRoot": "./data",
  "logging": {
    "level": "debug|info|warn|error",
    "console": true,
    "file": true,
    "maxFiles": 180,
    "maxSize": "10m"
  },
  "auth": {
    "sessionTimeout": 3600000,
    "passwordMinLength": 8
  },
  "scheduler": {
    "checkInterval": 60000,
    "enableFileWatcher": true
  }
}
```

### Job
```json
{
  "job_id": "string",
  "client_hostname": "string",
  "enabled": true,
  "mappings": [
    {
      "sources": ["path1", "path2"],
      "destination": "path"
    }
  ],
  "schedule": {
    "type": "once|daily|weekly|monthly",
    "start_date": "YYYY-MM-DD",
    "start_time": "HH:MM",
    "every_n_days": 1,
    "days_of_week": [1,2,3,4,5,6,7],
    "every_n_weeks": 1,
    "days_of_month": [1,15,30]
  },
  "options": {
    "versioning": true,
    "compression": false,
    "deduplication": false,
    "retention": {
      "max_versions": 7,
      "max_total_size_mb": 10240
    }
  },
  "created_at": "ISO8601",
  "last_modified": "ISO8601"
}
```

### Run
```json
{
  "run_id": "uuid",
  "job_id": "string",
  "client_hostname": "string",
  "start": "ISO8601",
  "end": "ISO8601",
  "status": "running|success|failure",
  "bytes_processed": 0,
  "target_path": "path",
  "errors": [
    {
      "timestamp": "ISO8601",
      "message": "string",
      "stack": "string"
    }
  ]
}
```

---

## Sicurezza

### Autenticazione

- Password hash con bcryptjs (cost factor 10)
- Sessioni con timeout configurabile
- Cambio password obbligatorio per utente admin di default

### Comunicazione

- HTTP semplice (no HTTPS di default)
- **RACCOMANDAZIONE**: Usare reverse proxy (nginx/IIS) con HTTPS in produzione

### Permessi

- Server: esegue con permessi utente che lo avvia
- Agent: esegue come LocalSystem (permessi elevati)

### Best Practices

1. Cambiare password admin al primo avvio
2. Limitare accesso porta 8080 solo da rete interna
3. Backup destinazioni su share con permessi restrittivi
4. Log retention configurato per audit
5. Firewall configurato correttamente su client

---

## Licenza

MIT License - vedere file LICENSE

## Supporto

Per problemi o domande:
- Issues: GitHub repository
- Email: support@onlybackup.local (esempio)

## Crediti

Sviluppato dal team OnlyBackup

---

## Note per contributori

- Prima di proporre modifiche consulta il file `AGENTS.md` nella root del repository: contiene le convenzioni su commit, documentazione e testing.
- La documentazione deve rimanere in italiano e privilegiare esempi pratici: se aggiungi o modifichi funzionalità aggiorna le sezioni correlate (README o INSTALL).
- Per modifiche al server Node.js esegui i test/lint disponibili e riporta i comandi utilizzati nel report finale.

---

---

## Changelog

### v1.1.0 - 11 Dicembre 2025

**Nuove Funzionalità:**
- Icone stato backup in tempo reale nella lista client (● giallo in corso, ✓ verde completato, ✗ rosso fallito)
- Pulsante reset stato backup per client con backup bloccato
- Reset password utente corrente dall'header UI
- Export/Import configurazione server (client, job, utenti)
- Persistenza stato backup durante heartbeat normali (timeout 5 minuti)

**Miglioramenti:**
- Polling automatico stato client ogni 5 secondi
- Stato backup mantenuto anche con heartbeat senza parametri
- Timeout automatico stato "in_progress" dopo 5 minuti

**API Aggiunte:**
- `POST /api/clients/:hostname/reset-backup-status`
- `POST /api/auth/reset-password`
- `GET /api/config/export`
- `POST /api/config/import`

---

**Versione Documentazione**: 1.1.0
**Data**: Dicembre 2025
