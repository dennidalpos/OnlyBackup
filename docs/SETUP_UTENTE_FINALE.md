# Setup Iniziale E Configurazione

Questa guida e pensata per chi deve avviare OnlyBackup per la prima volta su Windows senza entrare nei dettagli di sviluppo.

## Prima Di Iniziare

Per avviare solo il server ti servono:
- Windows;
- Node.js 20.19.0 o superiore;
- una finestra PowerShell aperta nella root del repository.

`npm` deve essere disponibile nel `PATH` insieme a Node.js. Le dipendenze applicative vengono installate dal bootstrap con `npm ci`, quindi non serve eseguire comandi npm manuali prima del setup.

Se Node.js, npm o un prerequisito richiesto mancano, gli script di setup si fermano prima di completare l'installazione e mostrano: nome software, versione minima, motivo, azione richiesta e comando di verifica.

Percorso di esempio:

```powershell
Set-Location D:\GITHUB\OnlyBackup
```

## Avvio Rapido

Esegui questi comandi nell'ordine indicato:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1 -InitialAdminPassword "ChangeMe123!"
Set-Location .\server
npm start
```

Se tutto e corretto, l'interfaccia web e disponibile qui:

```text
http://localhost:8080/
```

## Cosa Fanno I Comandi

### `Setup-OnlyBackupServer.ps1`

Prepara il minimo indispensabile per il server:
- installa le dipendenze Node.js con `npm ci`;
- crea le cartelle locali usate dall'applicazione sotto `data\`;
- crea l'utente `admin` se non esiste ancora.

### `Test-OnlyBackupPrerequisites.ps1`

Controlla che il setup sia realmente pronto:
- verifica Node.js e npm;
- blocca Node.js assente o precedente a 20.19.0 con istruzioni di installazione;
- verifica `config.json`;
- verifica le dipendenze installate;
- verifica la presenza delle directory dati minime;
- verifica `robocopy.exe`, incluso nei client Windows 10/11 aggiornati e usato dall'agent per le copie;
- segnala anche la disponibilita degli strumenti opzionali per MSI e servizio Windows.

### `npm start`

Avvia il server web di OnlyBackup.

## Accesso Iniziale

Al primo avvio usa:
- utente: `admin`
- password: quella passata a `-InitialAdminPassword`

Se `admin` esiste gia, lo script di setup non modifica l'utente e non cambia la password.

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
1. eseguire `Setup-OnlyBackupServer.ps1`;
2. avviare il server;
3. aprire `http://localhost:8080/`;
4. accedere con `admin`;
5. cambiare subito la password iniziale quando richiesto.

Setup server completo, inclusa verifica prerequisiti e build del wrapper servizio:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1 -InitialAdminPassword "ChangeMe123!" -BuildService
```

Per creare un pacchetto setup server distribuibile senza dipendere dalla cartella del repository usa lo stesso script di setup:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1 -InitialAdminPassword "ChangeMe123!" -BuildPackage
```

Il pacchetto viene generato in `output\server-setup\OnlyBackupServerSetup\` e lo zip in `output\server-setup\OnlyBackupServerSetup.zip`. Include server, dipendenze npm, wrapper servizio, sorgenti/asset agent, WiX 3.14, payload offline .NET Framework 4.6.2, config, script install/uninstall, prerequisiti e loghi/immagini.

Sul PC target il package non richiede `npm`: le dipendenze sono gia incluse. Richiede invece Node.js `>= 20.19.0` come runtime del server. Se Node.js manca o e troppo vecchio, `Install-OnlyBackupServer.ps1` e l'installer Inno si bloccano prima dell'installazione del servizio con nome software, versione minima, motivo, azione richiesta e comando di verifica. Se .NET Framework 4.6.2 runtime manca, il setup usa il payload offline incluso; se il payload non e presente, si blocca prima di installare il servizio.

La UI admin puo generare l'MSI agent usando i file inclusi nel setup: `agent\`, `scripts\Build-AgentMsi.ps1`, `scripts\support\wix\`, `tools\wix314-binaries\` e `assets\agent\`. Sul server restano da installare manualmente MSBuild e .NET Framework 4.6.2 Developer Pack/Targeting Pack se vuoi generare MSI agent dalla UI.

Per creare anche l'installer `.exe` con Inno Setup:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1 -InitialAdminPassword "ChangeMe123!" -BuildInstaller -InnoCompilerPath "C:\Program Files (x86)\Inno Setup 6"
```

Serve Inno Setup 6.x (`ISCC.exe`), anche passando la cartella `C:\Program Files (x86)\Inno Setup 6` con `-InnoCompilerPath`. Durante l'installazione l'installer verifica Node.js `>= 20.19.0`, mostra la licenza, richiede l'accettazione delle condizioni, chiede la password iniziale dell'utente `admin`, installa .NET Framework 4.6.2 runtime se serve, installa e avvia il servizio server automaticamente, e chiede se creare sul desktop il collegamento alla UI admin.

Output principale: `output\server-setup\inno\OnlyBackupServerSetup.exe`.

## Installazione Come Servizio Windows

Questa parte e opzionale. Serve solo se vuoi lasciare il server attivo automaticamente su Windows.

Il repository include un wrapper Windows Service per il server Node.js. Non serve NSSM.

Prerequisiti aggiuntivi per compilare il wrapper:
- MSBuild compatibile con Visual Studio o Build Tools;
- .NET Framework 4.6.2 Developer Pack/Targeting Pack.

Per verificare anche la toolchain servizio server:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Test-OnlyBackupPrerequisites.ps1 -RequireServerServiceTooling
```

Avvia PowerShell come amministratore ed esegui:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Install-OnlyBackupServerService.ps1 -StartService
```

In alternativa puoi fare setup server, installazione e avvio servizio con un solo comando da PowerShell amministratore:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1 -InitialAdminPassword "ChangeMe123!" -InstallService -StartService
```

Lo script compila `server\service-wrapper\OnlyBackupServerService.csproj`, configura `output\server-service\OnlyBackupServerService.exe.config` e registra il servizio `OnlyBackupServer` con l'installer .NET/Service Control Manager integrato in Windows.

Lo script non registra il servizio se Node.js e troppo vecchio, se `server\node_modules` manca, se la toolchain .NET/MSBuild manca o se i dati iniziali non sono stati creati. In quel caso esegui prima:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1 -InitialAdminPassword "ChangeMe123!"
```

Una volta raggiungibile la dashboard, gli amministratori possono aprire `http://localhost:8080/server-settings.html` per leggere stato, avviare, arrestare e riavviare il servizio Windows.

## Generare L'Agent Windows

Questa parte serve se vuoi creare il pacchetto MSI dell'agent da installare sui PC client.

### Prerequisiti Per L'Agent

Per generare l'MSI ti servono anche:
- MSBuild compatibile con Visual Studio o Build Tools;
- .NET Framework 4.6.2 Developer Pack/Targeting Pack per le reference assembly di build;
- WiX Toolset 3.14 installato nel sistema oppure la copia gia presente in `tools\wix314-binaries\`.

Lo script di build scarica e verifica automaticamente l'installer offline .NET Framework 4.6.2 usato dal pacchetto MSI, salvandolo in `scripts\support\wix\payload\`.

Puoi verificare i prerequisiti con:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Test-OnlyBackupPrerequisites.ps1 -RequirePackagingToolchain
```

Se il Targeting Pack .NET Framework 4.6.2 manca, la build MSI viene interrotta prima di MSBuild con un messaggio esplicito. Questo evita build apparentemente riuscite usando assembly non dichiarati della macchina locale.

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

Se `tools\wix314-binaries\` e presente, lo script lo rileva automaticamente e `-WixPath` puo essere omesso.

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

L'MSI dell'agent installa il payload .NET Framework 4.6.2 quando necessario e blocca l'installazione se `robocopy.exe` non e disponibile in Windows, con messaggio esplicito. Su Windows 10/11 aggiornato `robocopy.exe` e incluso in `System32`.

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
powershell -ExecutionPolicy Bypass -File .\scripts\Test-OnlyBackupAgentInstall.ps1
```

La verifica controlla:
- presenza dei file installati;
- presenza del servizio Windows;
- voce di installazione nel registro.

## Comandi Utili

Verificare il setup:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Test-OnlyBackupPrerequisites.ps1
```

Verificare automaticamente messaggio di prerequisito assente e percorso preflight riuscito:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Test-OnlyBackupPrerequisites.ps1 -SelfTest
```

Pulire le dipendenze e gli output locali:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Clean-Repository.ps1 -IncludeDependencies
```

Reinstallare solo le dipendenze senza toccare i dati:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1 -SkipDataInitialization
```

## Problemi Comuni

### `Test-OnlyBackupPrerequisites.ps1` segnala una versione Node.js non compatibile

Installa Node.js 20.19.0 o superiore e riapri PowerShell, poi verifica:

```powershell
node --version
npm --version
```

### `Test-OnlyBackupPrerequisites.ps1` segnala dipendenze mancanti

Riesegui:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Setup-OnlyBackupServer.ps1
```

### La porta 8080 e occupata

Modifica `config.json` e cambia `server.port`, per esempio:

```json
"port": 8081
```

Poi riavvia il server.

### Vuoi cambiare il percorso dei dati

Modifica `dataRoot` in `config.json` prima di eseguire `Setup-OnlyBackupServer.ps1`.

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

- `Test-OnlyBackupPrerequisites.ps1` non modifica il repository.
- `Clean-Repository.ps1` non rimuove automaticamente `data\`.
- Gli strumenti per build MSI e agent Windows non servono per il primo avvio del solo server.
- Lo script `Build-AgentMsi.ps1` e non interattivo solo se usi `-UseLocalhost` oppure `-ServerHost`.
