# Stato script

Inventario aggiornato dopo il riordino: gli entrypoint operativi sono nella root `scripts\`; helper, asset di packaging e script non destinati all'uso diretto sono in `scripts\support\`.

| Nome script | Percorso | Funzione | Quando usarlo | Invocato da | Dipendenze/prerequisiti | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `Invoke-RepositoryGate.ps1` | `scripts\Invoke-RepositoryGate.ps1` | Gate sequenziale: parsing PowerShell/JSON, preflight, smoke test server, package MSI agent. | Prima di consegnare modifiche o verificare il repo completo. | Uso manuale. | Node.js/npm, dipendenze server, MSBuild, WiX 3.14, .NET Framework 4.6.2 Targeting Pack. | `-SkipPackage` salta solo il packaging MSI quando la toolchain non e disponibile. |
| `Setup-OnlyBackupServer.ps1` | `scripts\Setup-OnlyBackupServer.ps1` | Setup server, inizializzazione dati, preflight, build servizio, package self-contained e installer Inno. | Fresh install server o package end-to-end. | README/docs, uso manuale. | Node.js/npm; per servizio/package anche MSBuild e .NET Framework 4.6.2 Targeting Pack; per installer Inno Setup 6.x. | Entry point unico per setup server. |
| `Build-AgentMsi.ps1` | `scripts\Build-AgentMsi.ps1` | Compila l'agent C# e genera MSI WiX. | Release/package agent Windows. | Gate, README/docs, UI server tramite `agentPackageService`. | MSBuild, WiX 3.14, .NET Framework 4.6.2 Targeting Pack. | Usa `scripts\support\wix\AgentInstaller.wxs` e payload offline .NET. |
| `Clean-Repository.ps1` | `scripts\Clean-Repository.ps1` | Rimuove output generati locali e, con flag, dipendenze npm. | Pulizia workspace. | README/docs, uso manuale. | PowerShell. | Non rimuove `data\` runtime. |
| `Test-OnlyBackupPrerequisites.ps1` | `scripts\Test-OnlyBackupPrerequisites.ps1` | Verifica prerequisiti server, setup dati e toolchain opzionali. | Dopo setup, prima di run/package, nel gate. | Gate, README/docs, uso manuale. | Node.js/npm; con flag richiede MSBuild/WiX/.NET targeting pack. | `-SelfTest` verifica messaggi di errore e percorso positivo. |
| `Install-OnlyBackupServerService.ps1` | `scripts\Install-OnlyBackupServerService.ps1` | Compila/configura wrapper e installa il server come servizio Windows. | Solo installazione servizio server. | README/docs, package server, uso manuale admin. | PowerShell admin, Node.js, MSBuild, .NET Framework 4.6.2 Targeting Pack. | Usa strumenti Windows integrati, senza NSSM. |
| `Uninstall-OnlyBackupServerService.ps1` | `scripts\Uninstall-OnlyBackupServerService.ps1` | Arresta e rimuove il servizio Windows del server. | Disinstallazione servizio server. | Package server, uso manuale admin. | PowerShell admin; exe servizio o `sc.exe`. | Complementare all'installazione servizio. |
| `Validate-MsiPackage.ps1` | `scripts\Validate-MsiPackage.ps1` | Legge metadati MSI e verifica che il pacchetto non sia vuoto. | Dopo generazione MSI o audit artifact. | `Build-AgentMsi.ps1`, uso manuale. | COM `WindowsInstaller.Installer`. | Entry point diretto per MSI esistenti. |
| `Test-AgentMsiUpgrade.ps1` | `scripts\Test-AgentMsiUpgrade.ps1` | Confronta due MSI per coerenza upgrade. | Validazione upgrade agent. | Output informativo di `Build-AgentMsi.ps1`, uso manuale. | Due MSI esistenti; COM `WindowsInstaller.Installer`. | Sostituisce varianti storiche di test upgrade. |
| `Test-OnlyBackupAgentInstall.ps1` | `scripts\Test-OnlyBackupAgentInstall.ps1` | Controlla installazione agent: file, servizio e registry. | Dopo installazione MSI su client Windows. | README/docs, uso manuale. | Windows con agent installato. | Check post-installazione. |
| `Initialize-OnlyBackup.ps1` | `scripts\support\Initialize-OnlyBackup.ps1` | Installa dipendenze server con `npm ci` e inizializza dati locali. | Helper interno setup. | `Setup-OnlyBackupServer.ps1`. | Node.js/npm, `server\package-lock.json`, `config.json`. | Non usare come entrypoint primario. |
| `Initialize-OnlyBackupData.js` | `scripts\support\Initialize-OnlyBackupData.js` | Crea directory dati e utente admin iniziale. | Helper interno setup. | `Initialize-OnlyBackup.ps1`, package server. | Node.js. | Non destinato all'uso diretto. |
| `Test-OnlyBackupServerSmoke.js` | `scripts\support\Test-OnlyBackupServerSmoke.js` | Smoke test end-to-end del server con fake agent. | Test server tramite npm. | `server\package.json` (`npm test`). | Node.js, dipendenze server. | Helper del test npm. |
| `Build-OnlyBackupServerService.ps1` | `scripts\support\Build-OnlyBackupServerService.ps1` | Compila il wrapper Windows Service del server. | Helper interno setup/service/package. | `Setup-OnlyBackupServer.ps1`, `Install-OnlyBackupServerService.ps1`, package server. | MSBuild, .NET Framework 4.6.2 Targeting Pack. | Produce `output\server-service\OnlyBackupServerService.exe` se usato dal repo. |
| `Build-OnlyBackupServerSetup.ps1` | `scripts\support\Build-OnlyBackupServerSetup.ps1` | Genera setup server self-contained e zip distribuibile. | Helper interno package server. | `Setup-OnlyBackupServer.ps1 -BuildPackage` e `-BuildInstaller`. | Node.js/npm, MSBuild, .NET Framework 4.6.2 Targeting Pack. | Include scripts, agent, tool WiX, wrapper servizio, asset e prerequisiti. |
| `Build-OnlyBackupServerInnoSetup.ps1` | `scripts\support\Build-OnlyBackupServerInnoSetup.ps1` | Compila il package server self-contained in installer Inno `.exe`. | Helper interno installer server. | `Setup-OnlyBackupServer.ps1 -BuildInstaller`. | Package server, Inno Setup 6.x. | Usa `scripts\support\inno\OnlyBackupServerSetup.iss`. |
| `Restart-OnlyBackupServerProcess.ps1` | `scripts\support\Restart-OnlyBackupServerProcess.ps1` | Riavvia il processo server Node.js su Windows. | Helper runtime restart. | `server\src\services\serverService.js`. | PowerShell, processo Node.js avviato. | Non destinato all'uso manuale ordinario. |
| `Install-AgentMsiVerbose.ps1` | `scripts\support\Install-AgentMsiVerbose.ps1` | Installa/disinstalla MSI agent con log verboso e diagnostica. | Debug locale installazioni MSI. | Uso manuale admin. | PowerShell admin, `msiexec`. | Utility di supporto non canonica. |
| `AgentInstaller.wxs` | `scripts\support\wix\AgentInstaller.wxs` | Definizione WiX del MSI agent. | Input packaging. | `Build-AgentMsi.ps1`. | WiX 3.14. | Non eseguibile direttamente. |
| `OnlyBackupServerSetup.iss` | `scripts\support\inno\OnlyBackupServerSetup.iss` | Definizione Inno Setup dell'installer server. | Input packaging installer. | `Build-OnlyBackupServerInnoSetup.ps1`. | Inno Setup 6.x. | Non eseguibile direttamente. |

## Script rimossi o consolidati

| Script/percorso storico | Stato |
| --- | --- |
| `scripts\verification\*` | Consolidato: gate e preflight sono ora entrypoint root; smoke test e helper sono in `scripts\support\`. |
| `scripts\setup\*` | Consolidato in `scripts\support\`; l'entrypoint supportato resta `scripts\Setup-OnlyBackupServer.ps1`. |
| `scripts\server\*` | Consolidato: install/uninstall servizio sono entrypoint root, build/restart/Inno sono helper in `scripts\support\`. |
| `scripts\agent\*` | Consolidato: test/validazione agent sono entrypoint root, WiX e install verbose sono support. |
| `scripts\create-job.js` | Rimosso: bypassava API e normalizzazione runtime, non risultava referenziato da catene operative. |
| `scripts\parse-backup-report.js` | Rimosso: non risultava referenziato da server, test, docs o packaging. |
| `scripts\Force-Cleanup.ps1` | Rimosso: recovery distruttiva non collegata a catene supportate. |
