# Script Inventory

Stato aggiornato dopo il riordino degli script. Gli script in `scripts\` sono entrypoint operativi; `scripts\support\` contiene helper richiamati da manifest, codice o script primari.

| Script | Percorso | Funzione | Quando usarlo | Invocato da | Prerequisiti | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `Invoke-RepositoryGate.ps1` | `scripts\Invoke-RepositoryGate.ps1` | Gate locale sequenziale: parsing script/JSON, preflight, smoke test server, package MSI. | Prima di consegnare modifiche o verificare repo completo. | Uso manuale. | Node.js/npm, dipendenze server, MSBuild, WiX 3.14. | Usa `-SkipPackage` solo se il packaging MSI non e verificabile nell'ambiente. |
| `Initialize-OnlyBackup.ps1` | `scripts\Initialize-OnlyBackup.ps1` | Installa dipendenze server con `npm ci` e inizializza dati locali. | Fresh install o ripristino setup server. | README/docs; uso manuale. | Node.js/npm, `server\package-lock.json`, `config.json`. | Sostituisce il vecchio `bootstrap.ps1`. |
| `Test-OnlyBackupPrerequisites.ps1` | `scripts\Test-OnlyBackupPrerequisites.ps1` | Verifica prerequisiti server, dati locali e tool opzionali. | Dopo setup, prima di run/package, nel gate. | `Invoke-RepositoryGate.ps1`; README/docs; uso manuale. | Node.js/npm; con flag richiede anche WiX/MSBuild o nssm. | Sostituisce il vecchio `doctor.ps1`. |
| `Build-AgentMsi.ps1` | `scripts\Build-AgentMsi.ps1` | Compila l'agent C# e genera MSI WiX. | Release/package agent Windows. | `Invoke-RepositoryGate.ps1`; README/docs; uso manuale. | MSBuild, WiX 3.14, .NET Framework 4.6.2 Targeting Pack consigliato. | Rileva automaticamente `tools\wix314-binaries\` se presente. |
| `Validate-MsiPackage.ps1` | `scripts\Validate-MsiPackage.ps1` | Legge metadati MSI e verifica che il pacchetto non sia vuoto. | Dopo generazione MSI o per audit artifact. | `Build-AgentMsi.ps1`; uso manuale. | COM `WindowsInstaller.Installer`. | Rimane entrypoint diretto per validare MSI esistenti. |
| `Test-AgentMsiUpgrade.ps1` | `scripts\Test-AgentMsiUpgrade.ps1` | Confronta due MSI per coerenza upgrade. | Quando si valida un upgrade agent. | Output informativo di `Build-AgentMsi.ps1`; uso manuale. | Due MSI esistenti; COM `WindowsInstaller.Installer`. | Sostituisce il vecchio `Test-MsiUpgrade.ps1`. |
| `Test-OnlyBackupAgentInstall.ps1` | `scripts\Test-OnlyBackupAgentInstall.ps1` | Controlla installazione agent: file, servizio, registry. | Dopo installazione MSI su client Windows. | README/docs; uso manuale. | Windows con agent installato. | Sostituisce il vecchio `Quick-Check.ps1`. |
| `Install-OnlyBackupServerService.ps1` | `scripts\Install-OnlyBackupServerService.ps1` | Installa il server Node.js come servizio Windows tramite nssm. | Solo se il server deve girare come servizio. | README/docs; uso manuale admin. | PowerShell admin, nssm, Node.js. | Mantiene nome storico per catena servizio. |
| `Uninstall-OnlyBackupServerService.ps1` | `scripts\Uninstall-OnlyBackupServerService.ps1` | Rimuove il servizio Windows del server tramite nssm. | Disinstallazione servizio server. | Uso manuale admin. | PowerShell admin, nssm. | Complementare allo script di installazione servizio. |
| `Clean-Repository.ps1` | `scripts\Clean-Repository.ps1` | Rimuove output generati locali e opzionalmente dipendenze. | Pulizia workspace. | README/docs; uso manuale. | Nessuno oltre PowerShell. | Non rimuove `data\` runtime. |
| `Initialize-OnlyBackupData.js` | `scripts\support\Initialize-OnlyBackupData.js` | Crea directory dati e utente admin iniziale. | Helper interno del setup. | `Initialize-OnlyBackup.ps1`. | Node.js. | Non destinato all'uso diretto. |
| `Test-OnlyBackupServerSmoke.js` | `scripts\support\Test-OnlyBackupServerSmoke.js` | Smoke test end-to-end del server con fake agent. | Test server tramite npm. | `server\package.json` (`npm test`). | Node.js, dipendenze server installate. | Spostato da `scripts\Test-ServerSmoke.js`. |
| `Restart-OnlyBackupServerProcess.ps1` | `scripts\support\Restart-OnlyBackupServerProcess.ps1` | Riavvio helper del processo server su Windows. | Chiamato dalla route di restart del server. | `server\src\services\serverService.js`. | PowerShell, processo Node.js avviato. | Spostato da `scripts\Restart-OnlyBackupServer.ps1`; non destinato all'uso diretto. |
| `Install-AgentMsiVerbose.ps1` | `scripts\support\Install-AgentMsiVerbose.ps1` | Installa/disinstalla MSI agent con log verboso e diagnostica. | Debug locale di installazioni MSI. | Uso manuale admin. | PowerShell admin, `msiexec`. | Spostato da `Install-WithVerboseLog.ps1`; support utility non canonica. |
| `AgentInstaller.wxs` | `scripts\wix\AgentInstaller.wxs` | Definizione WiX del MSI agent. | Input del packaging. | `Build-AgentMsi.ps1`. | WiX 3.14. | Non eseguibile direttamente. |

## Script rimossi

| Script rimosso | Motivo |
| --- | --- |
| `scripts\create-job.js` | Non referenziato; scriveva direttamente file job bypassando API e normalizzazione runtime. |
| `scripts\parse-backup-report.js` | Non referenziato da server, test, docs o packaging. |
| `scripts\Force-Cleanup.ps1` | Recovery distruttiva non documentata e non collegata a catene operative supportate. |
