# OnlyBackup Agent - Build Scripts

Questa directory contiene gli script per compilare e creare il pacchetto MSI dell'OnlyBackup Agent.

## Prerequisiti

1. **Visual Studio 2019/2022** o **Visual Studio Build Tools**
2. **WiX Toolset 3.14** - [Download](https://github.com/wixtoolset/wix3/releases)
3. **.NET Framework 4.6.2 SDK**

## Build-AgentMsi.ps1

Script PowerShell per compilare l'agent e creare il pacchetto MSI di installazione.

### Sintassi

```powershell
.\Build-AgentMsi.ps1 [-ServerHost <hostname>] [-ServerPort <port>] [-AgentPort <port>] [-AgentApiKey <key>] [opzioni]
```

### Parametri

| Parametro | Tipo | Default | Descrizione |
|-----------|------|---------|-------------|
| `-ServerHost` | String | Richiesto* | Hostname o IP del server OnlyBackup |
| `-ServerPort` | Int | 8080 | Porta del server OnlyBackup |
| `-AgentPort` | Int | 8081 | Porta di ascolto dell'agent |
| `-AgentApiKey` | String | - | API Key per autenticazione (opzionale) |
| `-UseLocalhost` | Switch | - | Usa localhost come server (modalità test) |
| `-WixPath` | String | (auto) | Percorso WiX Toolset |
| `-MsBuildPath` | String | (auto) | Percorso MSBuild.exe |
| `-Configuration` | String | Release | Configurazione build (Debug/Release) |
| `-OutputDir` | String | ../output | Directory di output per MSI |

\* Se non specificato, lo script richiederà input interattivo

### Modalità di Utilizzo

Lo script supporta **3 modalità**:

1. **Modalità Interattiva** (predefinita) - Menu guidato passo-passo
2. **Modalità Non-Interattiva** - Parametri da riga di comando
3. **Modalità Test Rapido** - Flag `UseLocalhost` per test locale

---

### Modalità Interattiva (CONSIGLIATA)

Quando eseguito senza parametri, lo script presenta un menu interattivo guidato:

```powershell
cd scripts
.\Build-AgentMsi.ps1
```

Il menu richiederà:
1. ✅ **Modalità build**: Test (localhost) o Produzione (hostname personalizzato)
2. ✅ **Hostname/IP server**: Se modalità produzione
3. ✅ **Porta server**: Default 8080, validato (1-65535)
4. ✅ **Porta agent**: Default 8081, validato (1-65535)
5. ✅ **API Key**: Opzionale, con validazione lunghezza minima
6. ✅ **Riepilogo configurazione**: Conferma prima del build

**Caratteristiche del Menu Interattivo:**
- 🔒 Validazione input in tempo reale (porte, lunghezza API key)
- 📊 Riepilogo visuale della configurazione prima del build
- ⚠️ Avvisi di sicurezza per API key corte (< 16 caratteri)
- ✨ Mascheramento API key nell'output
- 🔄 Possibilità di annullare e riconfigurare
- 💡 Suggerimenti per generare API key sicure

**Esempio di Sessione Interattiva:**

```
================================================================================
 CONFIGURAZIONE INTERATTIVA MSI AGENT
================================================================================

Configureremo i seguenti parametri:
  1. Hostname/IP del server OnlyBackup
  2. Porta del server (default: 8080)
  3. Porta dell'agent (default: 8081)
  4. API Key per autenticazione (opzionale)

Modalità build:
  [1] Test locale (localhost)
  [2] Produzione (hostname/IP personalizzato)

Scegli modalità [1 o 2, default: 1]: 2

=== CONFIGURAZIONE PRODUZIONE ===

Hostname o IP del server OnlyBackup: srv-orc01.biofer1.local

Configurazione porte:
Porta server OnlyBackup [default: 8080]:
Porta agent (listener) [default: 8081]:

Autenticazione:
L'API Key è opzionale ma FORTEMENTE CONSIGLIATA per ambienti di produzione.
Puoi generarla con: [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))

API Key per autenticazione [opzionale, premi INVIO per saltare]: Z7xb0LZ0D3+4DQBdjyv8D4SKBW3ApaWTLp2u/cKpU/4=

================================================================================
 RIEPILOGO CONFIGURAZIONE
================================================================================

  Server OnlyBackup:
    - Host:     srv-orc01.biofer1.local
    - Porta:    8080

  Agent:
    - Porta:    8081
    - API Key:  Z7xb0LZ0...U/4= (configurata)

  Pacchetto MSI configurerà automaticamente:
    - File:     C:\Program Files\OnlyBackup\Agent\OnlyBackupAgent.exe.config
    - Servizio: OnlyBackup Agent (avvio automatico)
    - Firewall: Regola per porta 8081/TCP

================================================================================

Procedere con il build? [S/n]: S
```

---

### Modalità Non-Interattiva (Automazione/CI/CD)

Per script automatizzati o deployment in massa, fornire tutti i parametri da riga di comando:

#### 1. Build Produzione Completo

```powershell
cd scripts
.\Build-AgentMsi.ps1 -ServerHost "srv-orc01.biofer1.local" -ServerPort 8080 -AgentPort 8081 -AgentApiKey "Z7xb0LZ0D3+4DQBdjyv8D4SKBW3ApaWTLp2u/cKpU/4="
```

Questo comando:
- Configura l'agent per connettersi a `srv-orc01.biofer1.local:8080`
- L'agent ascolterà sulla porta `8081`
- Configura l'API Key nel file di configurazione
- Crea regola firewall per la porta 8081

#### 2. Build Solo con Server Host (porta default)

```powershell
.\Build-AgentMsi.ps1 -ServerHost "backup.example.com"
```

Usa le porte di default (8080 per server, 8081 per agent) senza API Key.

#### 3. Build Test Locale

```powershell
.\Build-AgentMsi.ps1 -UseLocalhost
```

Crea un MSI configurato per `localhost:8080` (utile per test).

#### 4. Build con Solo Alcune Porte Personalizzate

```powershell
.\Build-AgentMsi.ps1 -ServerHost "backup.local" -AgentPort 9000
```

Questo usa:
- Server: backup.local:8080 (porta default)
- Agent: 9000 (personalizzata)
- Nessuna API Key

#### 5. Build con Configurazione Completa Personalizzata

```powershell
.\Build-AgentMsi.ps1 `
    -ServerHost "192.168.1.100" `
    -ServerPort 9000 `
    -AgentPort 9001 `
    -AgentApiKey "MyCustomKey123456" `
    -Configuration Debug `
    -OutputDir "C:\Builds\Agent"
```

---

### Modalità Test Rapido

Per test locale rapido senza inserire alcun parametro:

```powershell
.\Build-AgentMsi.ps1 -UseLocalhost
```

Questo equivale a:
- ServerHost: localhost
- ServerPort: 8080
- AgentPort: 8081
- Nessuna API Key

Ideale per testing locale e debugging.

---

## Funzionalità del Menu Interattivo

### Validazione Input

Il menu interattivo include validazione robusta:

#### Validazione Porte
- Range: 1-65535
- Tipo: solo numeri interi
- Ripetizione richiesta se input non valido

**Esempio:**
```
Porta server OnlyBackup [default: 8080]: 99999
  [!] Porta non valida. Deve essere tra 1 e 65535.
Porta server OnlyBackup [default: 8080]: abc
  [!] Input non valido. Inserisci un numero.
Porta server OnlyBackup [default: 8080]: 8080
```

#### Validazione API Key
- Lunghezza minima consigliata: 32 caratteri
- Warning per chiavi < 16 caratteri
- Possibilità di reinserire se troppo corta

**Esempio:**
```
API Key per autenticazione [opzionale, premi INVIO per saltare]: weak

  [!] ATTENZIONE: API Key molto corta (< 16 caratteri). Non sicura!
      Consigliata lunghezza minima: 32 caratteri

Continuare comunque con questa API Key? [S/n]: n

Inserisci una nuova API Key (o premi INVIO per nessuna API Key): <api-key-lunga>
```

#### Validazione Hostname
- Campo obbligatorio in modalità produzione
- Trim automatico degli spazi
- Ripetizione richiesta se vuoto

### Generazione API Key

Il menu mostra automaticamente il comando per generare una API Key sicura:

**PowerShell (Windows):**
```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```

**Output esempio:**
```
wX8KjZ2pL9mN3vR5tQ7yB4fH6gJ8kM1nP0rS9uV2xA==
```

### Riepilogo Pre-Build

Prima di avviare il build, il menu mostra un riepilogo completo:

```
================================================================================
 RIEPILOGO CONFIGURAZIONE
================================================================================

  Server OnlyBackup:
    - Host:     srv-backup.example.com
    - Porta:    8080

  Agent:
    - Porta:    8081
    - API Key:  Z7xb0LZ0...U/4= (configurata)

  Pacchetto MSI configurerà automaticamente:
    - File:     C:\Program Files\OnlyBackup\Agent\OnlyBackupAgent.exe.config
    - Servizio: OnlyBackup Agent (avvio automatico)
    - Firewall: Regola per porta 8081/TCP

================================================================================

Procedere con il build? [S/n]:
```

L'utente può:
- ✅ Confermare premendo `S`, `s`, `Y`, `y` o INVIO
- ❌ Annullare premendo `N` o `n`

Se annullato, lo script termina senza eseguire il build.

### Output

Lo script crea:
```
output/
└── agent-msi/
    ├── bin/                    # File compilati dell'agent
    ├── artifacts/
    │   └── OnlyBackupAgent.msi # Pacchetto MSI finale
    └── NDP462-KB3151800-x86-x64-AllOS-ENU.exe  # Installer .NET Framework
```

Il file MSI finale si trova in: `output/agent-msi/artifacts/OnlyBackupAgent.msi`

### Installazione del Pacchetto MSI

#### Installazione Silenziosa (Consigliata per Deployment)

```cmd
msiexec /i OnlyBackupAgent.msi /qn
```

#### Installazione con UI

```cmd
msiexec /i OnlyBackupAgent.msi
```

#### Disinstallazione

```cmd
msiexec /x OnlyBackupAgent.msi /qn
```

### Generazione API Key

Se non hai un'API Key, puoi generarne una usando:

**Linux/macOS:**
```bash
openssl rand -base64 32
```

**PowerShell (Windows):**
```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```

## Decision Tree: Quale Modalità Usare?

```
Devo buildare l'agent MSI?
│
├─ Conosco tutti i parametri necessari?
│  │
│  ├─ SÌ → Usa modalità non-interattiva
│  │        .\Build-AgentMsi.ps1 -ServerHost "..." -ServerPort ... -AgentPort ... -AgentApiKey "..."
│  │
│  └─ NO  → Usa modalità interattiva
│           .\Build-AgentMsi.ps1
│           (il menu ti guiderà passo-passo)
│
├─ È solo per test locale?
│  │
│  └─ SÌ → Usa modalità test rapido
│           .\Build-AgentMsi.ps1 -UseLocalhost
│
└─ È per CI/CD o deployment automatico?
   │
   └─ SÌ → Usa modalità non-interattiva con tutti i parametri
            Crea script wrapper con parametri hardcoded o da config file
```

---

### Risoluzione Problemi

#### Errore: "The term 'Build-AgentMsi.ps1' is not recognized"

**Soluzione:** Usa il prefisso `.\` per eseguire lo script dalla directory corrente:
```powershell
cd scripts
.\Build-AgentMsi.ps1 -ServerHost "example.com"
```

#### Errore: "MSBuild non trovato"

**Soluzione:** Installa Visual Studio 2019/2022 o Visual Studio Build Tools, oppure specifica il path:
```powershell
.\Build-AgentMsi.ps1 -ServerHost "..." -MsBuildPath "C:\Path\To\MSBuild.exe"
```

#### Errore: "WiX Toolset non trovato"

**Soluzione:**
1. Scarica WiX 3.14 da: https://github.com/wixtoolset/wix3/releases
2. Installa in `C:\Program Files (x86)\WiX Toolset v3.14\`
3. Oppure specifica path personalizzato:
```powershell
.\Build-AgentMsi.ps1 -ServerHost "..." -WixPath "C:\Custom\Path\WiX"
```

#### Errore: "Impossibile eseguire script PowerShell"

**Soluzione:** Abilita l'esecuzione di script PowerShell:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Cosa Fa il Pacchetto MSI

Durante l'installazione, il MSI:

1. ✅ Verifica la presenza di .NET Framework 4.6.2 (installa se mancante)
2. ✅ Copia i file dell'agent in `C:\Program Files\OnlyBackup\Agent\`
3. ✅ Configura il file `OnlyBackupAgent.exe.config` con:
   - ServerHost (hostname del server)
   - ServerPort (porta del server)
   - AgentPort (porta dell'agent)
   - AgentApiKey (se fornita)
4. ✅ Registra "OnlyBackup Agent" come servizio Windows
5. ✅ Configura l'avvio automatico del servizio
6. ✅ Crea regola firewall per la porta dell'agent
7. ✅ Avvia il servizio

### File di Configurazione Post-Installazione

Dopo l'installazione, la configurazione si trova in:
```
C:\Program Files\OnlyBackup\Agent\OnlyBackupAgent.exe.config
```

Puoi modificare manualmente questo file e riavviare il servizio:
```cmd
net stop OnlyBackupAgent
net start OnlyBackupAgent
```

### Variabili d'Ambiente Supportate

Nessuna variabile d'ambiente è necessaria. Tutta la configurazione è gestita tramite:
- Parametri dello script durante il build
- File di configurazione post-installazione

### Struttura Directory

```
scripts/
├── Build-AgentMsi.ps1          # Script principale
├── README.md                    # Questo file
└── wix/
    ├── AgentInstaller.wxs       # File WiX per MSI
    └── payload/                 # .NET Framework installer (scaricato automaticamente)
```

### Note di Sicurezza

- ⚠️ L'API Key viene memorizzata in chiaro nel file di configurazione
- ⚠️ Il servizio viene eseguito come `LocalSystem`
- ⚠️ La regola firewall consente connessioni da qualsiasi IP (`Scope="any"`)

Per ambienti di produzione:
1. Proteggi l'accesso al file di configurazione
2. Valuta l'uso di un account di servizio dedicato
3. Limita le regole firewall a IP specifici se possibile

### Supporto

Per problemi o domande:
- Verifica che tutti i prerequisiti siano installati
- Controlla i log di build per errori specifici
- Consulta la documentazione WiX per problemi relativi al packaging

### Changelog

- **v1.0.0** - Aggiunto supporto per parametri ServerPort, AgentPort e AgentApiKey
- **v1.0.0** - Build script iniziale con supporto ServerHost
