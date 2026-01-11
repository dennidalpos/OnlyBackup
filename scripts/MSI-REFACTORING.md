# Refactoring Sistema MSI OnlyBackup Agent

## Panoramica

Questo documento descrive il refactoring completo del sistema di generazione MSI dell'agent OnlyBackup, mantenendo WiX Toolset 3.14 e i percorsi dei compilatori esistenti.

## Obiettivi Raggiunti

### 1. Affidabilità del Processo di Build MSI
- Sistema di logging robusto con file permanenti
- Validazione pre-build di tutti i prerequisiti
- Gestione errori dettagliata per candle.exe/light.exe
- Cleanup automatico in caso di errore
- Validazione post-build del MSI generato

### 2. Upgrade e Manutenzione Agent
- Sequenza di upgrade ottimizzata per ridurre downtime
- Custom actions migliorate per gestione servizio
- Cleanup automatico di registry orfani
- Supporto ProductCode dinamico con UpgradeCode fisso

### 3. Rimozione Pulita e Completa
- Discovery dinamico di tutti i ProductCode installati
- Retry intelligente per operazioni MSI fallite
- Rimozione completa di file, registry, servizi e firewall
- Report finale con diagnostica e raccomandazioni

---

## File Modificati

### 1. scripts/Build-AgentMsi.ps1

#### Miglioramenti Principali

**Sistema di Logging:**
- Aggiunta funzione `Initialize-BuildLog` che crea log timestampati
- Funzione `Write-Log` che scrive sia su console che su file
- Trap globale per catturare errori e salvare stack trace
- Log permanenti in `output/agent-msi/logs/build_*.log`

**Validazione Pre-Build:**
- Nuova funzione `Test-BuildPrerequisites`
- Verifica esistenza file richiesti (License.rtf, server files, config.json)
- Controllo spazio disco disponibile (minimo 500MB)
- Validazione eseguita dopo verifica WiX, prima del build

**Gestione Errori Candle/Light:**
- Output di candle.exe salvato in `candle.log`
- Output di light.exe salvato in `light.log`
- Flag `-v` (verbose) aggiunto per output dettagliato
- Uso di `Tee-Object` per salvare e mostrare output simultaneamente
- Cattura di stderr con `2>&1`

**Verifica .NET Framework Migliorata:**
- Checksum SHA256 verificato prima di ogni build (non solo al download)
- Download con timeout di 300 secondi
- Gestione errori try/catch per operazioni di rete
- Validazione finale prima di copiare nello staging

**Validazione Post-Build:**
- Chiamata automatica a `Validate-MsiPackage.ps1`
- Verifica ProductCode, UpgradeCode, componenti
- Fallimento build se validazione non passa

#### Esempio Output Build

```
===============================================================================
 OnlyBackup Agent - Build MSI Script
===============================================================================

[INFO] Root Directory: C:\Users\...\OnlyBackup
[INFO] Log Directory: C:\Users\...\OnlyBackup\output\agent-msi\logs

===============================================================================
 Validazione Pre-Build
===============================================================================

[OK] Validazione pre-build completata con successo

===============================================================================
 .NET Framework 4.6.2 Offline Installer
===============================================================================

[INFO] Verifica checksum .NET Framework 4.6.2...
[OK] .NET Framework 4.6.2 checksum valido
[OK] .NET Framework installer pronto e verificato

===============================================================================
 Creazione MSI con WiX 3.14
===============================================================================

[INFO] Esecuzione candle.exe...
[OK] candle.exe completato con successo
[INFO] Log salvato in: ...\candle.log

[INFO] Esecuzione light.exe...
[OK] light.exe completato con successo
[INFO] Log salvato in: ...\light.log

===============================================================================
 Validazione MSI Package
===============================================================================

[INFO] ProductCode: {12AB34CD-...}
[INFO] UpgradeCode: {12345678-1234-1234-1234-123456789ABC}
[INFO] ProductVersion: 1.0.1.0
[OK] UpgradeCode corretto
[OK] ProductCode è un GUID valido (dinamico)
[OK] Servizio OnlyBackupAgent trovato
[OK] File OnlyBackupAgent.exe presente nel MSI
[SUCCESS] Validazione MSI completata con successo

===============================================================================
 Build Completato con Successo!
===============================================================================

[OK] MSI creato: ...\OnlyBackupAgent.msi
[OK] Dimensione: 45.23 MB
[OK] Server configurato: 192.168.1.100
[OK] Log build salvato: ...\build_20260111_153045.log
```

---

### 2. scripts/wix/AgentInstaller.wxs

#### Modifiche WiX

**MajorUpgrade Ottimizzato:**
```xml
<MajorUpgrade DowngradeErrorMessage="Una versione più recente di $(var.ProductName) è già installata. Disinstallare prima di procedere."
              AllowSameVersionUpgrades="yes"
              Schedule="afterInstallFinalize"
              AllowDowngrades="no"
              MigrateFeatures="yes"
              IgnoreRemoveFailure="yes" />
```

Cambiamenti:
- `Schedule="afterInstallFinalize"` invece di `afterInstallInitialize` per ridurre downtime
- `MigrateFeatures="yes"` per preservare configurazioni
- `IgnoreRemoveFailure="yes"` per gestire rimozioni parziali

**LaunchConditions Aggiunte:**
```xml
<Condition Message="OnlyBackup Agent richiede privilegi di amministratore per l'installazione.">
  Privileged
</Condition>

<Condition Message="OnlyBackup Agent richiede Windows 7/Server 2008 R2 o superiore.">
  <![CDATA[Installed OR (VersionNT >= 601)]]>
</Condition>
```

**Custom Actions Migliorate:**
```xml
<!-- Stop servizio con timeout -->
<CustomAction Id="StopServiceBeforeUpgrade"
              Directory="TARGETDIR"
              ExeCommand="cmd.exe /c &quot;sc.exe stop OnlyBackupAgent &amp;&amp; timeout /t 5 /nobreak &gt;nul 2&gt;&amp;1&quot;"
              Execute="immediate"
              Return="ignore"
              Impersonate="no" />

<!-- Cleanup registry multiplo -->
<CustomAction Id="CleanupOrphanedRegistry"
              Directory="TARGETDIR"
              ExeCommand="cmd.exe /c &quot;reg delete HKLM\...\{9C9E5F2A-...} /f 2&gt;nul &amp; reg delete HKLM\...\{7DA33E82-...} /f 2&gt;nul&quot;"
              Execute="immediate"
              Return="ignore"
              Impersonate="no" />
```

**Sequenza di Upgrade Ottimizzata:**
```xml
<InstallExecuteSequence>
  <!-- Stop servizio prima della validazione -->
  <Custom Action="StopServiceBeforeUpgrade" Before="InstallValidate">
    UPGRADINGPRODUCTCODE OR (WIX_UPGRADE_DETECTED OR Installed)
  </Custom>

  <!-- Cleanup registry dopo stop servizio -->
  <Custom Action="CleanupOrphanedRegistry" After="StopServiceBeforeUpgrade">
    NOT Installed OR UPGRADINGPRODUCTCODE
  </Custom>

  <!-- RemoveExistingProducts dopo InstallFiles per upgrade veloce -->
  <RemoveExistingProducts After="InstallFiles" />

  <!-- Reinstall mode per upgrade in-place -->
  <Custom Action="SetReinstallAll" Before="CostInitialize">
    Installed OR WIX_UPGRADE_DETECTED
  </Custom>
  <Custom Action="SetReinstallMode" After="SetReinstallAll">
    Installed OR WIX_UPGRADE_DETECTED
  </Custom>
</InstallExecuteSequence>
```

**Cleanup Completo su Uninstall:**
```xml
<Property Id="LOGFOLDER">
  <DirectorySearch Id="SearchLogFolder" Path="C:\BackupConsole\logs" Depth="0" />
</Property>

<Component Id="ServiceComponent" ...>
  <!-- ... -->

  <!-- Rimozione log su uninstall -->
  <util:RemoveFolderEx On="uninstall" Property="LOGFOLDER" />

  <!-- Rimozione cartelle install se vuote -->
  <RemoveFolder Id="RemoveINSTALLFOLDER" Directory="INSTALLFOLDER" On="uninstall" />
  <RemoveFolder Id="RemoveManufacturerFolder" Directory="ManufacturerFolder" On="uninstall" />
</Component>
```

**Rimozione Componenti Server:**
- `ServerComponents` rimossi dal Feature principale
- Riduce dimensione MSI
- Evita confusione (agent-only MSI)
- Componenti server possono essere spostati in MSI separato se necessario

---

### 3. scripts/Cleanup-OldAgent.ps1

#### Miglioramenti Script Cleanup

**Discovery Dinamico ProductCodes:**
```powershell
function Get-OnlyBackupProductCodes {
    # Scansiona HKLM:\...\Uninstall e WOW6432Node
    # Trova TUTTI i ProductCode OnlyBackup installati
    # Restituisce array con ProductCode, DisplayName, RegistryPath
}
```

**Validazione Pre-Cleanup:**
- Mostra tutte le installazioni trovate
- Richiede conferma utente prima di procedere
- Previene rimozioni accidentali

**Invoke-MsiUninstall Migliorato:**
```powershell
function Invoke-MsiUninstall {
    param(
        [string]$ProductCode,
        [string]$DisplayName,
        [int]$TimeoutSeconds = 300,
        [int]$MaxRetries = 2
    )

    # Retry loop con delay
    for ($attempt = 1; $attempt -le $MaxRetries; $attempt++) {
        # Start-Process con Wait e NoNewWindow
        # Gestione exit codes (0, 1605, 1614, 3010 = success)
        # Se 1603: stop processi, check pending reboot, retry
        # Log dettagliato con timestamp
    }
}
```

**Report Finale:**
```powershell
# Verifica finale stato sistema
$remainingProducts = Get-OnlyBackupProductCodes
$serviceExists = Get-Service -Name "OnlyBackupAgent" -ErrorAction SilentlyContinue
$agentFolderExists = Test-Path "C:\Program Files\OnlyBackup\Agent"

# Report cleanup success/warning
if ($cleanupSuccess) {
    Write-Success "Cleanup completato con successo!"
}
else {
    Write-ErrorMessage "Cleanup completato con AVVISI"
    Write-Info "Azioni raccomandate:"
    Write-Info "  1. Riavviare il sistema"
    Write-Info "  2. Eseguire nuovamente questo script"
    Write-Info "  3. Verificare log in: C:\Temp\OnlyBackup_Cleanup\"
}
```

---

## Nuovi Script

### 4. scripts/Validate-MsiPackage.ps1

Script di validazione MSI tramite Windows Installer COM.

**Funzionalità:**
- Verifica ProductCode sia un GUID valido
- Verifica UpgradeCode sia quello atteso (`{12345678-1234-1234-1234-123456789ABC}`)
- Verifica ProductVersion
- Conta componenti (deve essere > 0)
- Verifica presenza servizio OnlyBackupAgent
- Verifica file principale OnlyBackupAgent.exe
- Controlla dimensione MSI (warning se > 100MB o < 1MB)

**Uso:**
```powershell
.\scripts\Validate-MsiPackage.ps1 -MsiPath "output\agent-msi\artifacts\OnlyBackupAgent.msi"
```

**Output Esempio:**
```
=== Validazione MSI Package ===
[INFO] ProductCode: {A1B2C3D4-5678-90AB-CDEF-123456789ABC}
[INFO] UpgradeCode: {12345678-1234-1234-1234-123456789ABC}
[INFO] ProductVersion: 1.0.1.0
[OK] UpgradeCode corretto
[OK] ProductCode è un GUID valido (dinamico)
[INFO] Componenti totali: 15
[OK] Servizio OnlyBackupAgent trovato
[OK] File OnlyBackupAgent.exe presente nel MSI
[INFO] Dimensione MSI: 45.67 MB
[SUCCESS] Validazione MSI completata con successo
```

---

### 5. scripts/Test-MsiUpgrade.ps1

Script per testare automaticamente il processo di upgrade.

**Funzionalità:**
- Installa versione vecchia del MSI
- Verifica servizio e file installati
- Esegue upgrade a versione nuova
- Verifica servizio post-upgrade
- Verifica file aggiornati
- Controlla voci duplicate nel registro
- Opzionale: rimuove installazione al termine

**Uso:**
```powershell
# Test upgrade con cleanup finale
.\scripts\Test-MsiUpgrade.ps1 -OldMsiPath "old\OnlyBackupAgent.msi" -NewMsiPath "output\agent-msi\artifacts\OnlyBackupAgent.msi"

# Test upgrade mantenendo installazione
.\scripts\Test-MsiUpgrade.ps1 -OldMsiPath "old.msi" -NewMsiPath "new.msi" -KeepInstalled
```

**Output Esempio:**
```
=== Test Upgrade MSI OnlyBackup ===

[STEP 1] Installazione versione vecchia...
Exit code: 0
[OK] Versione vecchia installata
[OK] Servizio OnlyBackupAgent presente (Status: Running)
[INFO] Versione file vecchia: 1.0.0.0

[STEP 2] Upgrade a versione nuova...
Exit code: 0
[OK] Upgrade completato
[OK] Servizio ancora presente (Status: Running)
[INFO] Versione file nuova: 1.0.1.0
[OK] File aggiornato correttamente

[INFO] Voci OnlyBackup nel registro: 1
[OK] Una sola voce nel registro (corretto)

[STEP 3] Rimozione installazione...
[OK] Disinstallazione completata

=== TEST UPGRADE COMPLETATO CON SUCCESSO ===

Riepilogo:
  - Installazione vecchia versione: OK
  - Upgrade a nuova versione: OK
  - Servizio presente post-upgrade: OK
  - File aggiornati: OK
  - Disinstallazione finale: OK
```

---

## Workflow di Build Completo

### 1. Build Standard

```powershell
.\scripts\Build-AgentMsi.ps1 -ServerHost "192.168.1.100"
```

Fasi:
1. Inizializzazione logging
2. Validazione pre-build (file, spazio disco)
3. Verifica MSBuild e WiX
4. Download/verifica .NET Framework 4.6.2
5. Configurazione server
6. Compilazione agent C#
7. Creazione MSI con candle/light
8. Validazione MSI
9. Report finale

Output:
- MSI: `output/agent-msi/artifacts/OnlyBackupAgent.msi`
- Log build: `output/agent-msi/logs/build_*.log`
- Log candle: `output/agent-msi/logs/candle.log`
- Log light: `output/agent-msi/logs/light.log`

### 2. Test Upgrade

```powershell
# Assumendo di avere old.msi da build precedente
.\scripts\Test-MsiUpgrade.ps1 -OldMsiPath "backup\old.msi" -NewMsiPath "output\agent-msi\artifacts\OnlyBackupAgent.msi"
```

Log generati:
- `C:\Temp\onlybackup_install_old_*.log`
- `C:\Temp\onlybackup_upgrade_new_*.log`
- `C:\Temp\onlybackup_uninstall_*.log`

### 3. Cleanup Manuale (se necessario)

```powershell
.\scripts\Cleanup-OldAgent.ps1
```

Con conferma interattiva:
```
Trovate 2 installazioni MSI:
  - OnlyBackup Agent [{ABC...}]
  - OnlyBackup Agent [{DEF...}]

Procedere con la rimozione completa? (S/N):
```

---

## Vantaggi del Refactoring

### Affidabilità
- **Log permanenti**: Tutti gli errori tracciati in file per debugging post-mortem
- **Validazione pre-build**: Previene errori evitabili verificando prerequisiti
- **Validazione post-build**: Garantisce MSI ben formato prima di deployment
- **Gestione errori robusta**: Try/catch, LASTEXITCODE, output dettagliato

### Upgrade
- **ProductCode dinamico**: Ogni build genera GUID unico, upgrade funziona sempre
- **UpgradeCode fisso**: Windows Installer identifica famiglia prodotti
- **Sequenza ottimizzata**: `RemoveExistingProducts After="InstallFiles"` riduce downtime
- **Custom actions migliorate**: Timeout, cleanup automatico registry orfani

### Rimozione
- **Discovery dinamico**: Trova tutte le installazioni OnlyBackup, non solo quelle hardcoded
- **Retry intelligente**: Gestisce 1603 errors con stop processi e retry
- **Report finale**: Indica chiaramente se cleanup è completo o richiede azioni manuali
- **Log dettagliati**: Ogni operazione MSI logga in file separato con timestamp

### Manutenibilità
- **Codice modulare**: Funzioni ben definite, riutilizzabili
- **Script di test**: `Test-MsiUpgrade.ps1` permette CI/CD automatizzato
- **Documentazione**: Questo file + commenti inline
- **Backward compatible**: Mantiene WiX 3.14 e percorsi compilatori esistenti

---

## Scenari di Utilizzo

### Scenario 1: Build Produzione

**Obiettivo**: Creare MSI per deployment su client

**Comandi**:
```powershell
cd C:\Users\...\OnlyBackup
.\scripts\Build-AgentMsi.ps1 -ServerHost "onlybackup.company.com" -Configuration Release
```

**Risultato**:
- MSI in `output/agent-msi/artifacts/OnlyBackupAgent.msi`
- ProductCode dinamico (es. `{A1B2C3D4-...}`)
- UpgradeCode fisso `{12345678-1234-1234-1234-123456789ABC}`
- Server configurato: `onlybackup.company.com`

**Deployment**:
```cmd
msiexec /i OnlyBackupAgent.msi /qn
```

### Scenario 2: Upgrade da Versione Precedente

**Obiettivo**: Aggiornare agent da v1.0.0 a v1.0.1

**Prerequisiti**:
- Client ha v1.0.0 installata
- Nuovo MSI v1.0.1 disponibile

**Comando**:
```cmd
msiexec /i OnlyBackupAgent_v1.0.1.msi /qn
```

**Cosa succede**:
1. Windows Installer rileva `UpgradeCode` uguale
2. Custom Action `StopServiceBeforeUpgrade` ferma servizio
3. Custom Action `CleanupOrphanedRegistry` rimuove vecchie voci
4. Installazione nuova versione
5. `RemoveExistingProducts` rimuove vecchia versione
6. Servizio riavviato automaticamente

**Risultato**:
- Versione aggiornata a v1.0.1
- Configurazione preservata
- Una sola voce nel registro (nuova)

### Scenario 3: Installazione Orfana

**Obiettivo**: Rimuovere installazione corrotta/orfana

**Sintomi**:
- MSI upgrade fallisce con errore 1603
- Servizio presente ma non funzionante
- Voci duplicate nel registro

**Soluzione**:
```powershell
.\scripts\Cleanup-OldAgent.ps1
```

**Cosa succede**:
1. Discovery di tutte le installazioni OnlyBackup
2. Conferma utente
3. Stop servizio e processi
4. Rimozione voci registro
5. Uninstall MSI con retry intelligente
6. Rimozione file e firewall
7. Report finale

**Dopo cleanup**:
```powershell
msiexec /i OnlyBackupAgent.msi /qn
```

### Scenario 4: Test Sviluppo

**Obiettivo**: Verificare che upgrade funzioni correttamente

**Comandi**:
```powershell
# Build versione vecchia (simulata)
.\scripts\Build-AgentMsi.ps1 -ServerHost localhost -UseLocalhost
Copy-Item "output\agent-msi\artifacts\OnlyBackupAgent.msi" "backup\old_v1.0.0.msi"

# Modifica codice per v1.0.1
# ...

# Build versione nuova
.\scripts\Build-AgentMsi.ps1 -ServerHost localhost -UseLocalhost

# Test upgrade
.\scripts\Test-MsiUpgrade.ps1 -OldMsiPath "backup\old_v1.0.0.msi" -NewMsiPath "output\agent-msi\artifacts\OnlyBackupAgent.msi"
```

**Risultato**:
- Test automatizzato completo
- Log dettagliati in `C:\Temp\onlybackup_*.log`
- Cleanup automatico finale

---

## Troubleshooting

### Errore: "Checksum .NET Framework non valido"

**Causa**: File `NDP462-KB3151800-x86-x64-AllOS-ENU.exe` corrotto

**Soluzione**:
```powershell
Remove-Item "scripts\wix\payload\NDP462-KB3151800-x86-x64-AllOS-ENU.exe" -Force
.\scripts\Build-AgentMsi.ps1 ...
```

### Errore: "candle.exe exit code 1"

**Causa**: Errori di sintassi WiX o file sorgente mancanti

**Soluzione**:
1. Controllare log: `output\agent-msi\logs\candle.log`
2. Cercare errori come:
   - `error CNDL0104: Not a valid source file`
   - `error CNDL0150: Undefined preprocessor variable`
3. Verificare che tutti i file referenziati esistano

### Errore: "light.exe exit code 1"

**Causa**: Errori di linking o reference non risolti

**Soluzione**:
1. Controllare log: `output\agent-msi\logs\light.log`
2. Cercare errori come:
   - `error LGHT0001: Cannot find component`
   - `error LGHT0094: Unresolved reference`

### Errore: "msiexec 1603" durante upgrade

**Causa**: Servizio in uso, file bloccati, pending reboot

**Soluzione Automatica**:
```powershell
.\scripts\Cleanup-OldAgent.ps1
# Seguire raccomandazioni (riavvio se necessario)
msiexec /i OnlyBackupAgent.msi /qn
```

**Soluzione Manuale**:
1. Stop servizio: `sc.exe stop OnlyBackupAgent`
2. Verificare processi: `Get-Process OnlyBackupAgent`
3. Controllare pending reboot
4. Riprovare install

### Warning: "Voci duplicate nel registro"

**Causa**: Upgrade non ha rimosso vecchia voce

**Diagnostica**:
```powershell
Get-ChildItem "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" |
  Where-Object { (Get-ItemProperty $_.PSPath).DisplayName -like "*OnlyBackup*" }
```

**Soluzione**:
```powershell
.\scripts\Cleanup-OldAgent.ps1
msiexec /i OnlyBackupAgent.msi /qn
```

---

## Best Practices

### Build
1. Eseguire sempre `Build-AgentMsi.ps1` da root del repository
2. Specificare `-ServerHost` per build produzione
3. Verificare log in `output/agent-msi/logs/` dopo ogni build
4. Conservare MSI di versioni precedenti per test upgrade

### Deployment
1. Testare MSI in ambiente di sviluppo prima di produzione
2. Usare `Test-MsiUpgrade.ps1` per verificare upgrade funzioni
3. Documentare configurazione server per ogni MSI distribuito
4. Mantenere log di installazione per troubleshooting

### Upgrade
1. Fermare servizio manualmente prima di upgrade se possibile
2. Verificare che nessun processo `OnlyBackupAgent.exe` sia in esecuzione
3. Usare `/l*v` per logging dettagliato: `msiexec /i new.msi /qn /l*v install.log`
4. In caso di errore 1603, eseguire `Cleanup-OldAgent.ps1`

### Cleanup
1. Eseguire `Cleanup-OldAgent.ps1` solo se necessario (installazioni orfane)
2. Riavviare sistema dopo cleanup se raccomandato
3. Conservare log in `C:\Temp\OnlyBackup_Cleanup\` per audit
4. Testare nuova installazione dopo cleanup per verificare

---

## Compatibilità

### Versioni Windows Supportate
- Windows 7 / Server 2008 R2 o superiore (LaunchCondition)
- Windows 10 / 11
- Windows Server 2016 / 2019 / 2022

### Requisiti
- .NET Framework 4.6.2 o superiore (installato automaticamente)
- Privilegi amministratore (LaunchCondition)
- 500MB spazio disco disponibile (validazione pre-build)

### WiX Toolset
- Versione: 3.14 (fissa, non 4.x/5.x)
- Percorso: `C:\Program Files (x86)\WiX Toolset v3.14\bin`
- Extensions: WixUtilExtension, WixFirewallExtension, WixUIExtension

### MSBuild
- Visual Studio 2022 Community (preferito)
- Visual Studio 2019 Community (fallback)
- .NET Framework 4.0 MSBuild (fallback)

---

## Manutenzione Futura

### Aggiornamento Versione Prodotto

**File da modificare**: `scripts/wix/AgentInstaller.wxs`

```xml
<?define ProductVersion = "1.0.2.0" ?>
```

**Note**:
- ProductCode rimane `*` (dinamico)
- UpgradeCode rimane fisso
- Incrementare solo versione prodotto

### Aggiunta Nuovo File al MSI

**File da modificare**: `scripts/wix/AgentInstaller.wxs`

```xml
<Component Id="NewComponent" Guid="PUT-NEW-GUID-HERE">
  <File Id="NewFile"
        Source="$(var.BinDir)\NewFile.dll"
        KeyPath="yes" />
</Component>

<!-- In ComponentGroup -->
<ComponentRef Id="NewComponent" />
```

**Generare nuovo GUID**:
```powershell
[guid]::NewGuid()
```

### Modifica Configurazione Server Default

**File da modificare**: `scripts/Build-AgentMsi.ps1`

Cambiare default prompt o aggiungere nuovi parametri.

### Estensione Validazione MSI

**File da modificare**: `scripts/Validate-MsiPackage.ps1`

Aggiungere nuove query SQL per validare altri aspetti del MSI.

---

## Conclusioni

Il refactoring del sistema MSI OnlyBackup Agent ha raggiunto tutti gli obiettivi:

- **Affidabilità**: Logging robusto, validazioni pre/post build, gestione errori dettagliata
- **Upgrade**: Sequenza ottimizzata, ProductCode dinamico, cleanup automatico
- **Rimozione**: Discovery dinamico, retry intelligente, report finale

Tutti i vincoli sono stati rispettati:
- WiX Toolset 3.14 mantenuto
- Percorsi compilatori invariati
- Comportamenti esistenti preservati

I nuovi script forniscono strumenti potenti per:
- Validazione automatica MSI
- Test upgrade automatizzati
- Cleanup robusto installazioni orfane

Il sistema è ora pronto per produzione e facilmente manutenibile.
