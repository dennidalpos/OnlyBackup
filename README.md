# SuperBackup - Sistema di Backup Client/Server per Windows

SuperBackup è un sistema centralizzato di gestione backup per ambienti Windows (Windows 7-11). Il sistema è diviso in due parti principali: un **server web** che gestisce l'interfaccia utente e la configurazione, e un **agent** che gira sui client Windows, eseguendo i backup e comunicando con il server tramite WebSocket.

## Architettura del Sistema

1. **Server (WebApp Node.js)**: 
   - Tecnologie: Node.js (Express + WebSocket)
   - Porta Dashboard: `8080` (HTTP)
   - Porta WebSocket: `8081` (WebSocket)
   - File di configurazione: JSON (archiviazione agenti, job, storico esecuzioni)
   
2. **Agent (Servizio Windows)**:
   - Tecnologie: .NET Framework 4.7.2
   - Installazione tramite MSI (WiX Toolset)
   - Comunicazione tramite WebSocket per il monitoraggio in tempo reale e invio configurazioni di backup

## Come Configurare il Sistema

### Parametri da Modificare prima della Produzione

#### **1. Configurazione Server**
Nel file `server/app.js`, modificherai i seguenti parametri essenziali per l’ambiente di produzione:

- **Porta del server HTTP e WebSocket**: Se desideri cambiare le porte predefinite per il server HTTP o WebSocket, modifica le costanti `HTTP_PORT` e `WS_PORT` all'inizio del file.
    ```javascript
    const HTTP_PORT = 8080; // Porta Dashboard HTTP
    const WS_PORT = 8081;   // Porta WebSocket
    ```

- **Percorso di Archiviazione Dati (agents, jobs, history)**: Cambia il percorso in cui vengono salvati i dati degli agenti, i job e la cronologia degli esecuzioni. Modifica le variabili seguenti se necessario:
    ```javascript
    const DATA_DIR = path.join(__dirname, 'data');  // Percorso principale per i dati
    const AGENTS_DIR = path.join(DATA_DIR, 'agents');
    const JOBS_DIR = path.join(DATA_DIR, 'jobs');
    const HISTORY_DIR = path.join(DATA_DIR, 'history');
    ```

- **Persistenza degli Agent**: La persistenza dei dati degli agenti viene gestita tramite il salvataggio in file JSON. Se desideri utilizzare un altro sistema di persistenza, dovrai sostituire la logica di lettura/scrittura dei file con un database.

#### **2. Configurazione Agent**
Nel progetto **Agent** (C#), prima di generare l'MSI, assicurati di configurare i seguenti parametri:

- **Path di Installazione dell'Agent**: Modifica il percorso di destinazione dell'agent, se necessario, nel file `installer/Product.wxs`:
    ```xml
    <Directory Id="ProgramFilesFolder">
        <Directory Id="INSTALLFOLDER" Name="BackupAgent">
            <Component Id="MainExecutable" Guid="YOUR_GUID">
                <File Id="AgentExecutable" Name="BackupAgentService.exe" DiskId="1" Source="path_to_agent_executable\BackupAgentService.exe" />
            </Component>
        </Directory>
    </Directory>
    ```

- **Credenziali di Rete**: Se il tuo sistema di backup ha bisogno di credenziali di rete per accedere alle destinazioni, puoi specificarle nel codice C# utilizzando il formato `DOMINIO\utente`. Modifica la gestione delle credenziali nel codice dell'agent come segue:
    ```csharp
    NetworkConnection netConn = new NetworkConnection(dest.path, dest.credentials);
    ```

#### **3. Modifica dei Parametri di Configurazione dei Job**
Nel **job configuration** gestito tramite l’interfaccia web, è possibile configurare le sorgenti e le destinazioni del backup. I percorsi di backup sono specificati nei job attraverso l'interfaccia web, ma se desideri preconfigurarli o modificarli direttamente, puoi farlo nel file di configurazione `jobs.json`:

- **Sorgenti**: Definisci un array di percorsi delle cartelle o file da includere nei backup. Esempio:
    ```json
    "sources": ["C:\\Data\\Documents", "D:\\Backup"]
    ```

- **Destinazioni**: Definisci l'array delle destinazioni (locali o UNC path). Esempio:
    ```json
    "destinations": [
        {
            "path": "\\\\NAS\\BackupShare",
            "credentials": {
                "domain": "WORKGROUP",
                "username": "user",
                "password": "password123"
            }
        }
    ]
    ```

### Funzionalità

- **Dashboard**:
    - **Monitoraggio in tempo reale**: Visualizza lo stato degli agenti (online/offline) e lo stato dell'ultimo backup (successo/fallito).
    - **Gestione dei Job di Backup**: Crea, modifica ed esegui job di backup manuali. Pianifica backup giornalieri, settimanali o mensili.
    - **Visualizzazione File System Remoto**: Naviga il file system remoto per selezionare file e cartelle da includere nei backup.

- **Agent**:
    - **Registrazione Automatica**: Al primo avvio, l'agent si registra automaticamente con il server.
    - **Backup Pianificati**: Gli agenti eseguono backup secondo la pianificazione definita dal server.
    - **Gestione Credenziali di Rete**: Gestisce le credenziali di rete per l'accesso a condivisioni di rete UNC.
    - **Heartbeat**: Invia segnali periodici al server per indicare che l'agent è attivo.

- **Logs**:
    - **Storico Backup**: Viene mantenuto uno storico di tutte le esecuzioni dei job di backup, con dettagli come la data e l'ora di inizio/fine, i file copiati, le dimensioni, e gli eventuali errori.

### Sicurezza

- **Autenticazione**: Per la protezione dei job e delle configurazioni, è implementata l'autenticazione amministrativa tramite un sistema di login basato su user/password.
- **Connessione Sicura**: Le comunicazioni tra il server e gli agenti sono protette tramite WebSocket (WSS) e il traffico HTTP è disponibile su una porta configurabile.
  
## Come Utilizzare

1. **Avvio Server**:
    - Installa le dipendenze Node.js: `npm install`
    - Avvia il server: `node app.js`
    - Accedi alla dashboard dal browser all'indirizzo `http://localhost:8080`

2. **Configurazione Agent**:
    - Compila l'agent in Visual Studio e crea l'MSI con WiX Toolset.
    - Installa l'agent sui client Windows.
    - Assicurati che gli agenti possano comunicare correttamente con il server tramite WebSocket.

3. **Gestione Job**:
    - Accedi alla dashboard per creare, modificare e monitorare i job di backup.
    - I job possono essere eseguiti manualmente o automaticamente secondo la pianificazione definita.

## Riferimenti

- **WebSocket**: per la comunicazione in tempo reale tra server e agenti.
- **.NET Framework 4.7.2**: per la compatibilità dell'agent sui sistemi Windows.
- **WiX Toolset**: per la creazione del pacchetto MSI per l'installazione dell'agent.
