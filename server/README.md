````markdown
# Setup iniziale SuperBackup

## 1. Panoramica

Il progetto è composto da due parti:

- **Server di gestione** (Node.js)
  - API REST + WebSocket (`app.js`)  
  - Dashboard web (`index.html`, `styles.css`, `public/app.js`)  
  - Configurazione in `config.json` (porte, admin, cartelle dati).  

- **Agent Windows** (servizio .NET `BackupAgentService`)
  - Servizio `BackupService` che parla via WebSocket col server e pianifica i job.  

---

## 2. Prerequisiti

**Server (macchina centrale)**  
- Node.js 18+ e npm  
- Windows (se vuoi installare il server come servizio con `node-windows`)  
- Porte libere:
  - HTTP: **8080**
  - WebSocket: **8081**   

**Client / Endpoint Windows**  
- .NET Framework adeguato al progetto `BackupAgentService` (csproj)  
- Permesso di creare servizi Windows  
- Raggiungibilità verso il server sulla porta **8081** (WebSocket).

---

## 3. Setup server di gestione

Nella cartella del server (dove ci sono `app.js`, `package.json`, `config.json`):

1. **Configurazione base**

   Apri `config.json` e verifica/adegua:  

   ```json
   {
     "httpPort": 8080,
     "wsPort": 8081,
     "adminUser": "SuperBackup",
     "adminPassword": "Password01!",
     "dataDir": "./data",
     "agentsDir": "./data/agents",
     "jobsDir": "./data/jobs",
     "historyDir": "./data/history",
     "useTls": false
   }
````

2. **Installazione dipendenze**

   ```bash
   npm install
   ```

   (usa le dipendenze da `package.json`: `express`, `ws`, `body-parser`, `cors`, `node-windows`).

3. **Avvio in modalità “console”**

   ```bash
   npm start
   # alias di "node app.js"
   ```

   Questo avvia:

   * server HTTP su `http://<server>:8080`
   * server WebSocket su `ws://<server>:8081`

4. **(Opzionale) Installare il server come servizio Windows**

   ```bash
   node install-service.js
   ```

   Usa `node-windows` per creare il servizio “BackupServer” che esegue `app.js`.

---

## 4. Setup agent Windows

Sulla macchina client:

1. **Configurare App.config**

   In `App.config` (non mostrato qui, ma letto da `BackupService`), imposta:

   * `ServerUrl` → ad es. `ws://<server>:8081`
   * `HeartbeatSeconds` → (opzionale, default 30s)
   * `LogDirectory` → (opzionale, default `C:\ProgramData\BackupAgent\Logs`)

   Se `ServerUrl` è vuoto o mancante, il servizio usa `ws://localhost:8081`.

2. **Build del servizio**

   * Apri la solution/progetto `BackupAgentService.csproj`
   * Compila in modalità Release per ottenere l’eseguibile del servizio.

3. **Installazione servizio**

   Esempio (classico) con `sc` o `InstallUtil`:

   ```bash
   sc create BackupAgentService binPath= "C:\percorso\BackupAgentService.exe"
   sc start BackupAgentService
   ```

   In DEBUG il `Main` permette anche l’esecuzione come console app (per test), mentre in Release gira come vero servizio Windows.

4. **Registrazione sul server**

   All’avvio, l’agent:

   * Recupera info di sistema (hostname, IP, OS)
   * Si connette via WebSocket a `ServerUrl` e invia un messaggio `register` + heartbeat periodici.

   Il server lo memorizza in `data/agents/*.json` e lo mostra in dashboard nella tabella “Endpoint registrati”.

---

## 5. Primo giro end-to-end

1. **Apri la dashboard**

   * Da browser: `http://<server>:8080`
   * Fai login admin con le credenziali configurate in `config.json` (default: `SuperBackup` / `Password01!`, se non modificate).

2. **Verifica l’agent**

   * L’endpoint dovrebbe comparire in “Endpoint registrati”
   * Stato `Online` se il WebSocket è connesso e arrivano heartbeat.

3. **Crea un primo job di backup**

   Dalla sezione “Editor job” della dashboard:

   * Imposta:

     * `Nome job`
     * Sorgenti (una per riga, es. `C:\Dati` o `C:\Users\...\Documents`)
     * Destinazioni (UNC tipo `\\server\share` consigliato per share di rete)
     * Pianificazione (giornaliero / settimanale / mensile)
     * `syncMode` (es. `copy` o `sync`)

   * Puoi usare:

     * **Browser filesystem** per selezionare sorgenti dal client remoto
     * **Validazione sorgenti/destinazioni** (chiama API `/browse` e `validate-destinations` che usano `FileSystemHelper` + `NetworkConnection`).

4. **Esegui il job**

   * Avvia manualmente dalla dashboard (azione “Esegui ora”) → API `POST /api/jobs/:agentId/:jobId/run`.
   * L’agent esegue il job e copia i file verso la destinazione, con retry e conteggio file/byte.
   * A fine job invia un `job_result` al server, che:

     * aggiorna ultimo stato backup dell’endpoint,
     * salva storico in `data/history`.

5. **Controlla risultati**

   * Nella dashboard vedi:

     * Stato endpoint (online/offline)
     * Ultimo esito backup (OK / fallito / mai eseguito)
     * Storico job nella sezione “Storico backup”.
