# Guida Installazione MSI OnlyBackup Agent

## Informazioni Versione

**Versione Corrente**: 1.0.3.0
**UpgradeCode**: `AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE`
**Data Release**: 2026-01-11

> **IMPORTANTE**: Questa versione (1.0.3.0) rappresenta un punto di partenza pulito con nuovo UpgradeCode.
> Le versioni precedenti con UpgradeCode `12345678-1234-1234-1234-123456789ABC` non sono compatibili per upgrade automatico.

## Caso d'Uso: Installazioni Fantasma da GPO

### Problema Risolto

Durante lo sviluppo è emerso un problema critico con installazioni MSI precedenti:

1. **Installazioni via GPO**: Alcune installazioni erano state distribuite tramite Group Policy Objects
2. **Voci Fantasma**: Le voci MSI rimanevano nel registro Windows anche dopo disinstallazione
3. **WIX_UPGRADE_DETECTED**: Il sistema rilevava vecchie installazioni e tentava upgrade invece di nuova installazione
4. **Action: Null**: Tutti i componenti venivano saltati con `Action: Null` invece di `Action: 3` (install)
5. **REMOVE=ALL**: Windows Installer impostava modalità disinstallazione invece di installazione

### Soluzione Implementata

**Nuovo UpgradeCode**: `AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE`
- Evita conflitti con installazioni precedenti
- Permette installazione pulita anche in presenza di voci fantasma
- Windows Installer non rileva le vecchie versioni

**Parametro ADDLOCAL=ALL**:
- Forza installazione locale di tutte le features
- Previene advertised installations (solo registro senza file)
- Assicura che tutti i componenti vengano installati

## Installazione

### Prerequisiti

- Windows 7/Server 2008 R2 o superiore
- Privilegi di amministratore
- .NET Framework 4.6.2+ (installato automaticamente se mancante)

### Installazione Standard

```powershell
# Installazione con interfaccia minima
msiexec /i OnlyBackupAgent.msi

# Installazione silenziosa
msiexec /i OnlyBackupAgent.msi /qn

# Installazione silenziosa con log
msiexec /i OnlyBackupAgent.msi /qn /l*v C:\Temp\install.log

# Installazione forzando ADDLOCAL (consigliato)
msiexec /i OnlyBackupAgent.msi /qn ADDLOCAL=ALL /l*v C:\Temp\install.log
```

### Parametri MSI Disponibili

- `ADDLOCAL=ALL` - Forza installazione locale di tutte le features (consigliato)
- `SERVERHOST=hostname` - Configura server OnlyBackup (default: configurato durante build)

### Script di Installazione Avanzata

```powershell
# Usa lo script fornito per installazione con validazione
.\scripts\Install-WithVerboseLog.ps1 -MsiPath ".\OnlyBackupAgent.msi"
```

Lo script Include:
- Log verboso automatico in `C:\Temp\OnlyBackup_Install_*.log`
- Verifica stato servizio post-installazione
- Analisi automatica errori
- Report file installati e voci di registro

### Verifica Installazione

```powershell
# Quick check
.\scripts\Quick-Check.ps1

# Output atteso:
# [1] File Installati:
#   [OK] Trovati 2 file in: C:\Program Files (x86)\OnlyBackup\Agent
#     - OnlyBackupAgent.exe
#     - OnlyBackupAgent.exe.config
#
# [2] Servizio Windows:
#   [OK] Servizio trovato
#     Nome: OnlyBackupAgent
#     Status: Running
#     StartType: Automatic
#
# [3] Registro:
#   [OK] Voce registro trovata
#     DisplayName: OnlyBackup Agent
```

## Upgrade

### Da Versioni 1.0.0.x - 1.0.2.x con Vecchio UpgradeCode

Le versioni precedenti NON sono compatibili per upgrade automatico. Procedura:

1. **Disinstallare vecchia versione**:
   ```powershell
   # Cleanup forzato di tutte le vecchie voci
   .\scripts\Force-Cleanup.ps1
   ```

2. **Riavviare il sistema** (se richiesto dallo script)

3. **Installare nuova versione 1.0.3.0**:
   ```powershell
   .\scripts\Install-WithVerboseLog.ps1 -MsiPath ".\OnlyBackupAgent.msi"
   ```

### Da Versioni 1.0.3.0+

Le versioni future con lo stesso UpgradeCode supporteranno upgrade automatico:

```powershell
# Installazione su versione esistente
msiexec /i OnlyBackupAgent_v1.0.4.msi /qn ADDLOCAL=ALL
```

Il MajorUpgrade automaticamente:
- Ferma il servizio
- Rimuove la versione precedente
- Installa la nuova versione
- Riavvia il servizio

## Disinstallazione

### Disinstallazione Standard

```powershell
# Via Pannello di Controllo
# "Programmi e Funzionalità" > "OnlyBackup Agent" > Disinstalla

# Via msiexec con ProductCode
msiexec /x {PRODUCT-CODE-GUID} /qn

# Via MSI originale
msiexec /x OnlyBackupAgent.msi /qn
```

### Disinstallazione con Script

```powershell
# Disinstallazione con log verboso
.\scripts\Install-WithVerboseLog.ps1 -MsiPath ".\OnlyBackupAgent.msi" -Uninstall
```

### Cleanup Forzato

Se la disinstallazione standard fallisce:

```powershell
# Cleanup completo forzato
.\scripts\Force-Cleanup.ps1
```

Questo script rimuove:
- Servizio Windows OnlyBackupAgent
- Tutte le voci di registro OnlyBackup
- File in C:\Program Files\OnlyBackup e C:\Program Files (x86)\OnlyBackup
- Regole firewall OnlyBackup

## Troubleshooting

### Servizio non si installa

**Sintomo**: MSI si installa senza errori ma servizio non appare

**Cause possibili**:
1. Vecchie voci fantasma nel registro
2. Windows Installer in modalità "repair" invece di "install"
3. Componenti con `Action: Null`

**Soluzione**:
```powershell
# 1. Cleanup completo
.\scripts\Force-Cleanup.ps1

# 2. Riavvia sistema (importante!)
Restart-Computer

# 3. Reinstalla con ADDLOCAL=ALL
msiexec /i OnlyBackupAgent.msi /qn ADDLOCAL=ALL /l*v C:\Temp\install.log

# 4. Analizza log se fallisce
.\scripts\Analyze-MsiLog.ps1 -LogPath "C:\Temp\install.log"
```

### File in Program Files (x86) invece di Program Files

**Normale**: Il build è 32-bit, quindi Windows installa in Program Files (x86). Il servizio funziona correttamente in entrambe le posizioni.

### Errore "Una versione più recente è già installata"

```powershell
# Disinstalla versione esistente
.\scripts\Force-Cleanup.ps1

# Reinstalla
msiexec /i OnlyBackupAgent.msi /qn ADDLOCAL=ALL
```

### Analisi Log MSI

```powershell
# Analisi automatica log
.\scripts\Analyze-MsiLog.ps1 -LogPath "C:\Temp\OnlyBackup_Install_*.log"
```

Controlla:
- `[1] TIPO OPERAZIONE`: Deve essere "installazione" non "riconfigurazione"
- `[2] UPGRADE DETECTION`: Deve essere vuoto o con solo il ProductCode corrente
- `[5] COMPONENT SELECTION`: Tutti con `Action: 3` (install)

## Script Utili

### Quick-Check.ps1
Verifica rapida stato installazione (file, servizio, registro)

### Install-WithVerboseLog.ps1
Installazione/disinstallazione con log dettagliato e analisi automatica

### Force-Cleanup.ps1
Rimozione forzata completa di tutte le voci OnlyBackup

### Analyze-MsiLog.ps1
Analisi dettagliata log MSI per troubleshooting

### Check-MsiVersion.ps1
Verifica versione, ProductCode, UpgradeCode di un MSI

### Validate-MsiPackage.ps1
Validazione completa package MSI pre-installazione

## Note di Versione

### v1.0.3.0 (2026-01-11) - BREAKING CHANGE

**IMPORTANTE**: Nuovo UpgradeCode - non compatibile con versioni precedenti

**Modifiche**:
- ✅ Nuovo UpgradeCode: `AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE`
- ✅ Risolto problema installazioni fantasma da GPO
- ✅ MajorUpgrade con Schedule="afterInstallInitialize"
- ✅ ServiceInstall con Vital="yes"
- ✅ Rimosso NSSM (uso ServiceInstall nativo WiX)
- ✅ Rimosso LOGFOLDER property (causava errori)
- ✅ Parametro ADDLOCAL=ALL per prevenire advertised install

**Upgrade da versioni precedenti**:
- Richiede disinstallazione manuale vecchia versione
- Usare Force-Cleanup.ps1 per pulizia completa
- Riavvio sistema consigliato

## Supporto

Per problemi persistenti:

1. Eseguire diagnostica completa:
   ```powershell
   .\scripts\Quick-Check.ps1
   ```

2. Raccogliere log:
   - Log build: `output/agent-msi/logs/build_*.log`
   - Log install: `C:\Temp\OnlyBackup_Install_*.log`
   - Log Windows Installer: `%TEMP%\MSI*.log`

3. Analizzare con:
   ```powershell
   .\scripts\Analyze-MsiLog.ps1 -LogPath "percorso\log.log"
   ```
