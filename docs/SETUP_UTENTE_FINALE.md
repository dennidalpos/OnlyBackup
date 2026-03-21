# Setup Iniziale E Configurazione

Questa guida e pensata per chi deve avviare OnlyBackup per la prima volta su Windows senza entrare nei dettagli di sviluppo.

## Prima Di Iniziare

Ti servono solo:
- Windows;
- Node.js 18 o superiore;
- una finestra PowerShell aperta nella root del repository.

Percorso di esempio:

```powershell
Set-Location D:\GITHUB\OnlyBackup
```

## Avvio Rapido

Esegui questi comandi nell'ordine indicato:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -InitialAdminPassword "ChangeMe123!"
powershell -ExecutionPolicy Bypass -File .\scripts\doctor.ps1
Set-Location .\server
npm start
```

Se tutto e corretto, l'interfaccia web e disponibile qui:

```text
http://localhost:8080/
```

## Cosa Fanno I Comandi

### `bootstrap.ps1`

Prepara il minimo indispensabile per il server:
- installa le dipendenze Node.js con `npm ci`;
- crea le cartelle locali usate dall'applicazione sotto `data\`;
- crea l'utente `admin` se non esiste ancora.

### `doctor.ps1`

Controlla che il setup sia realmente pronto:
- verifica Node.js e npm;
- verifica `config.json`;
- verifica le dipendenze installate;
- verifica la presenza delle directory dati minime;
- segnala anche la disponibilita degli strumenti opzionali per MSI e servizio Windows.

### `npm start`

Avvia il server web di OnlyBackup.

## Accesso Iniziale

Al primo avvio usa:
- utente: `admin`
- password: quella passata a `-InitialAdminPassword`

Se `admin` esiste gia, il bootstrap non modifica l'utente e non cambia la password.

## Configurazione Base

La configurazione principale e nel file:

`config.json`

Esempio dei campi piu importanti:

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 8080,
    "environment": "production"
  },
  "dataRoot": "./data"
}
```

### `server.host`

- Usa `0.0.0.0` per accettare connessioni dalla rete locale.
- Usa `127.0.0.1` o `localhost` se vuoi accesso solo dal PC locale.

### `server.port`

- Porta HTTP del server.
- Il valore predefinito nel repository e `8080`.

### `dataRoot`

- Cartella dove OnlyBackup salva utenti, stato, log applicativi e configurazioni runtime.
- Di default punta a `.\data`.

## Configurazione Consigliata Per Un Primo Test

Per una prova semplice puoi lasciare `config.json` cosi come si trova nel repository e:
1. eseguire il bootstrap;
2. avviare il server;
3. aprire `http://localhost:8080/`;
4. accedere con `admin`;
5. cambiare subito la password iniziale quando richiesto.

## Installazione Come Servizio Windows

Questa parte e opzionale. Serve solo se vuoi lasciare il server attivo automaticamente su Windows.

Prima copia `nssm.exe` in uno di questi percorsi:

```text
tools\nssm\nssm.exe
tools\nssm\win64\nssm.exe
tools\nssm\win32\nssm.exe
```

Poi avvia PowerShell come amministratore ed esegui:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Install-OnlyBackupServerService.ps1
```

## Generare L'Agent Windows

Questa parte serve se vuoi creare il pacchetto MSI dell'agent da installare sui PC client.

### Prerequisiti Per L'Agent

Per generare l'MSI ti servono anche:
- MSBuild compatibile con Visual Studio o Build Tools;
- WiX Toolset 3.14.

Puoi verificare i prerequisiti con:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\doctor.ps1 -RequirePackagingToolchain
```

### Scelta Del Server Da Contattare

Quando generi l'agent devi indicare il nome host o l'IP del server OnlyBackup.

Esempi validi:
- `localhost` per test sullo stesso PC;
- `192.168.1.50` per un server in LAN;
- `backup-server` se il nome host e risolvibile in rete.

Non usare:
- `http://192.168.1.50`
- `192.168.1.50:8080`
- URL completi con percorsi

Lo script di build richiede solo l'host. La porta del server resta configurata separatamente a `8080`, salvo modifica manuale del file di configurazione dell'agent dopo l'installazione.

### Generazione MSI Per Test Locale

Per creare un MSI che punta al server locale:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Build-AgentMsi.ps1 -UseLocalhost -WixPath .\tools\wix314-binaries
```

### Generazione MSI Per Un Server Reale

Per creare un MSI che punta a un server specifico:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Build-AgentMsi.ps1 -ServerHost "192.168.1.50" -WixPath .\tools\wix314-binaries
```

Se usi una installazione globale di WiX 3.14 puoi omettere `-WixPath`.

### Dove Trovi Il Pacchetto Generato

Al termine della build trovi:
- MSI finale in `output\agent-msi\artifacts\OnlyBackupAgent.msi`;
- log di build in `output\agent-msi\logs\`.

## Installare E Configurare L'Agent

Sul PC client installa il pacchetto MSI generato.

Installazione standard:

```powershell
msiexec /i .\output\agent-msi\artifacts\OnlyBackupAgent.msi
```

Installazione silenziosa:

```powershell
msiexec /i .\output\agent-msi\artifacts\OnlyBackupAgent.msi /qn
```

Dopo l'installazione:
- il servizio Windows `OnlyBackupAgent` viene installato;
- il servizio prova ad avviarsi automaticamente;
- l'agent ascolta di default sulla porta `8081`.

## Configurazione Del Collegamento Al Server

Il file principale dell'agent installato e in genere:

`C:\Program Files\OnlyBackup\Agent\OnlyBackupAgent.exe.config`

I parametri principali sono:

```xml
<add key="ServerHost" value="localhost" />
<add key="ServerPort" value="8080" />
<add key="AgentPort" value="8081" />
<add key="HeartbeatInterval" value="60000" />
```

### `ServerHost`

- Viene impostato automaticamente durante la generazione dell'MSI.
- Deve contenere solo hostname o IP del server.

### `ServerPort`

- Porta HTTP del server OnlyBackup.
- Valore predefinito: `8080`.
- Cambiala solo se il server e configurato su una porta diversa.

### `AgentPort`

- Porta su cui il client espone le API locali usate dal server.
- Valore predefinito: `8081`.

### `HeartbeatInterval`

- Intervallo in millisecondi con cui l'agent notifica al server che e online.
- Valore predefinito: `60000`.

## Cambiare Server Dopo L'Installazione

Se devi puntare l'agent a un altro server:
1. apri `OnlyBackupAgent.exe.config` come amministratore;
2. aggiorna `ServerHost`;
3. se necessario aggiorna `ServerPort`;
4. salva il file;
5. riavvia il servizio.

Comando utile:

```powershell
Restart-Service OnlyBackupAgent
```

## Verifica Rapida Dell'Agent

Per controllare che l'agent sia installato correttamente:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Quick-Check.ps1
```

La verifica controlla:
- presenza dei file installati;
- presenza del servizio Windows;
- voce di installazione nel registro.

## Comandi Utili

Verificare il setup:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\doctor.ps1
```

Pulire le dipendenze e gli output locali:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Clean-Repository.ps1 -IncludeDependencies
```

Reinstallare solo le dipendenze senza toccare i dati:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1 -SkipDataInitialization
```

## Problemi Comuni

### `doctor.ps1` segnala dipendenze mancanti

Riesegui:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1
```

### La porta 8080 e occupata

Modifica `config.json` e cambia `server.port`, per esempio:

```json
"port": 8081
```

Poi riavvia il server.

### Vuoi cambiare il percorso dei dati

Modifica `dataRoot` in `config.json` prima di eseguire il bootstrap.

Esempio:

```json
"dataRoot": "D:\\OnlyBackupData"
```

### L'agent non raggiunge il server

Controlla questi punti:
- `ServerHost` nell'agent deve essere hostname o IP corretto;
- `ServerPort` deve corrispondere alla porta del server;
- il server deve essere raggiungibile dal client via rete;
- la porta `8081` del client deve essere disponibile per le chiamate del server.

Se modifichi `OnlyBackupAgent.exe.config`, riavvia il servizio:

```powershell
Restart-Service OnlyBackupAgent
```

## Note Importanti

- `doctor.ps1` non modifica il repository.
- `Clean-Repository.ps1` non rimuove automaticamente `data\`.
- Gli strumenti per build MSI e agent Windows non servono per il primo avvio del solo server.
- Lo script `Build-AgentMsi.ps1` e non interattivo solo se usi `-UseLocalhost` oppure `-ServerHost`.
