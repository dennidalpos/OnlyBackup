# Backup Control Server & Agent

Sistema composto da:

- **Server di controllo** (Node.js)
- **Agent Windows** (.NET Framework, servizio di sistema)

Permette di:

- visualizzare gli agent registrati (stato, info di base)
- configurare job di backup per ogni agent
- sfogliare il filesystem remoto per scegliere sorgenti/destinazioni
- avviare backup manuali e vedere l’esito delle esecuzioni

---

## Architettura

### Server

- Applicazione Node.js (`app.js`)
- Configurazione in `config.json`:
  - `httpPort`: porta interfaccia web / API
  - `wsPort`: porta WebSocket per agent e dashboard
  - `adminUser` / `adminPassword`: accesso all’interfaccia
  - `dataDir`, `agentsDir`, `jobsDir`, `historyDir`: cartelle dati
  - `useTls`, `tls.keyFile`, `tls.certFile`: eventuale TLS

Funzioni principali:

- espone l’interfaccia web (`index.html`, `styles.css`, `app.js`)
- espone API REST per gestione agent, job e storico
- gestisce un server WebSocket per:
  - ricevere heartbeat e messaggi dagli agent
  - inviare job e richieste (browse, test destinazioni)
  - aggiornare in tempo reale la dashboard

### Agent

- Progetto C# (`BackupAgentService`)
- Installato come **Windows Service**
- Configurazione in `App.config`:
  - `ServerUrl`: URL WebSocket del server (es. `ws://server:8081`)
  - `HeartbeatSeconds`: intervallo heartbeat
  - `LogDirectory`: cartella log

Funzioni principali:

- stabilisce una connessione WebSocket al server
- si registra e invia heartbeat periodici
- riceve job di backup e li esegue:
  - copia file/cartelle locali verso destinazioni (anche share di rete UNC)
  - usa credenziali dedicate per accedere alle share (se previsto)
- restituisce al server l’esito del job (successo/errore, file/byte copiati, messaggi)
- espone operazioni ausiliarie:
  - sfogliare il filesystem (`browse`)
  - validare percorsi e destinazioni (`validate`)

I log vengono scritti in `LogDirectory`, con rotazione oltre una certa dimensione.

---

## Utilizzo di base

1. **Server**
   - configurare `config.json`
   - installare le dipendenze Node.js (`npm install`)
   - avviare il server (`npm start`)
   - accedere alla dashboard via browser sulla porta `httpPort`

2. **Agent**
   - configurare `App.config` con `ServerUrl`, `HeartbeatSeconds`, `LogDirectory`
   - compilare il progetto e/o installare il pacchetto MSI
   - avviare il servizio Windows `BackupAgentService`

3. **Job di backup**
   - dalla dashboard:
     - selezionare un agent
     - definire sorgenti e destinazioni
     - impostare pianificazione (esecuzione periodica) o lanciare il job manualmente
   - monitorare lo stato e lo storico delle esecuzioni dalla stessa interfaccia

---

## Disclaimer

Questo software è fornito **“così com’è”**, senza alcun tipo di garanzia espressa o implicita, incluse ma non limitate alle garanzie di commerciabilità, idoneità per uno scopo particolare e assenza di difetti.  
L’utilizzo è interamente a rischio dell’utente. Gli autori e i manutentori del progetto non sono responsabili per eventuali danni, perdita di dati o altri problemi derivanti dall’uso, dalla configurazione o da malfunzionamenti del software.
