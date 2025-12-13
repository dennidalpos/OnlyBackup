# Installazione Operativa OnlyBackup (Server + Agent)

## 1) OnlyBackup Server su Windows Server

### Prerequisiti minimi
- **Sistema operativo**: Windows Server 2016 o superiore.
- **Node.js**: v14 LTS o superiore installato a livello di sistema (es. `C:\\Program Files\\nodejs\\node.exe`).
- **Permessi**: account amministrativo per installare servizi e creare directory.

### Preparazione file e dipendenze
1. Copiare l'intera cartella del progetto in `C:\\OnlyBackup` (o altro percorso senza spazi).
2. Aprire un prompt con privilegi elevati e installare le dipendenze server:
   ```powershell
   cd C:\OnlyBackup\server
   npm ci
   ```

### Configurazione iniziale `config.json`
1. Modificare `C:\\OnlyBackup\\config.json` impostando:
   - `server.host`: IP o hostname pubblico (es. `0.0.0.0` per ascoltare su tutte le interfacce).
   - `server.port`: porta HTTP della dashboard/API (default `8080`).
   - `server.environment`: `dev`, `test` o `prod`.
   - `dataRoot`: percorso assoluto o UNC dove salvare i file JSON (es. `C:\\OnlyBackup\\data` o `\\\\NAS\\OnlyBackupData`).
   - `logging`: livelli, rotazione e output file/console secondo le policy interne.
2. Inizializzare automaticamente struttura dati e utente admin eseguendo lo script Node (richiede `npm ci` già eseguito nella cartella `server`):
   ```powershell
   cd C:\OnlyBackup\scripts
   node .\init-data.js "<password_admin>"   # opzionale, default "admin" se non specificato
   ```
   Lo script risolve `dataRoot` dal `config.json`, crea tutte le sottocartelle (`config`, `state`, `users`, `logs`, ecc.), genera `state\scheduler\state.json` e crea `users\users.json` con l'utente `admin` (flag cambio password obbligatorio).

### Registrazione del server come servizio Windows
Usare **NSSM** (oppure `sc.exe` con uno script wrapper) per installare il processo Node.js come servizio resiliente:
```powershell
# Percorsi di esempio
$nssm = "C:\\Tools\\nssm.exe"
$root = "C:\\OnlyBackup"

& $nssm install OnlyBackupServer "C:\\Program Files\\nodejs\\node.exe" "src\\server.js"
& $nssm set OnlyBackupServer AppDirectory "$root\\server"
& $nssm set OnlyBackupServer AppParameters ""
& $nssm set OnlyBackupServer DisplayName "OnlyBackup Server"
& $nssm set OnlyBackupServer Start SERVICE_AUTO_START
& $nssm set OnlyBackupServer AppStdout "$root\\data\\logs\\server.log"
& $nssm set OnlyBackupServer AppStderr "$root\\data\\logs\\server-error.log"
& $nssm set OnlyBackupServer AppRestartDelay 5000
```
Avviare il servizio: `nssm start OnlyBackupServer`. Per usare `sc.exe`, creare un batch che esegua `node src\server.js` con la working directory `C:\\OnlyBackup\\server` e configurare il servizio per il riavvio automatico.

### Avvio e verifica

**Modalità TEST (logging verboso):**
```powershell
cd C:\OnlyBackup
setup_test.bat
```

**Modalità PROD (logging minimizzato):**
```powershell
cd C:\OnlyBackup
setup_prod.bat
```

**Avvio manuale:**
```powershell
cd C:\OnlyBackup\server
node src\server.js
```

In console devono comparire host/IP, porta HTTP, percorso `dataRoot`, ambiente attivo e conteggio job caricati.

Verificare via browser: `http://<host>:<porta>` deve aprire la dashboard. Effettuare login con l'utente `admin` inizializzato e forzare il cambio password.

### Modalità TEST/PROD

**setup_test.bat**: Imposta `NODE_ENV=test` per logging verboso (debug) ideale per troubleshooting

**setup_prod.bat**: Imposta `NODE_ENV=production` per logging minimizzato (info/warn/error) ottimizzato per produzione

Questi script avviano il server con la configurazione appropriata per l'ambiente desiderato.

## 2) OnlyBackup Agent (MSI per client Windows)

### Prerequisiti client
- **Sistema operativo**: Windows 7 SP1 o superiore (incluse edizioni Server 2008 R2+).
- **Runtime**: .NET Framework 4.6.2 (se assente, l'MSI include l'installer offline e lo avvia automaticamente).
- **Permessi**: installazione per-machine e avvio servizi.

### Build dell'MSI
1. Su una macchina di build con **WiX Toolset 3.14** installato (eseguibili in `C:\\Program Files (x86)\\WiX Toolset v3.14\\bin`), aprire PowerShell elevato.
2. Eseguire lo script di build interattivo o parametrizzato:
   ```powershell
   cd C:\OnlyBackup\scripts
   # Opzione test (localhost)
   .\Build-AgentMsi.ps1 -UseLocalhost
   # Oppure specifica hostname/IP produzione
   .\Build-AgentMsi.ps1 -ServerHost "backup.company.local"
   ```
   Lo script aggiorna `App.config` dell'agent con il server scelto, compila la soluzione .NET (target 4.6.2 con `msbuild`) e invoca `candle.exe` + `light.exe` di WiX per generare `output\OnlyBackupAgent.msi`.

### Installazione sui client
- **Modalità silenziosa con server esplicito**:
  ```cmd
  msiexec /i OnlyBackupAgent.msi /qn SERVERHOST="backup.company.local"
  ```
- **Modalità interattiva**:
  ```cmd
  msiexec /i OnlyBackupAgent.msi
  ```
- Verifiche post-installazione:
  - `sc query OnlyBackupAgent` deve risultare `RUNNING`.
  - Il file `C:\\Program Files\\OnlyBackup\\Agent\\OnlyBackupAgent.exe.config` deve contenere il valore `ServerHost` corretto.
  - Confermare che il servizio comunichi verso l'host/porta del server.

## 3) Configurazione iniziale minima post-installazione

### Lato server
1. Creare almeno un job in `$dataRoot\state\jobs\<JOB_ID>.json` con i campi obbligatori:
   - `job_id`: identificativo univoco
   - `client_hostname`: nome del client
   - `enabled`: true
   - `mappings`: array con `sources` e `destination`
   - `schedule`: pianificazione (es. daily con `start_time` e `every_n_days`)
   - `options`: opzioni di backup (versioning, retention, etc.)
2. Riavviare il servizio OnlyBackup Server o attendere il reload automatico per applicare le nuove definizioni.
3. In alternativa, usare la dashboard web per creare i job tramite interfaccia grafica.

### Lato agent
- Confermare che la configurazione locale punti al server corretto (campo `ServerHost` nel file `.config`).
- Verificare che il firewall locale consenta le connessioni in uscita verso la porta HTTP del server.

### Test end-to-end
1. Aprire la dashboard e verificare che il client compaia come registrato/online.
2. Avviare un job di test dalla dashboard e controllare la creazione del primo backup nella destinazione prevista.
