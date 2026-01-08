# Changelog - OnlyBackup

## [1.0.1] - 2026-01-08

### Aggiunte
- **Barra di ricerca per agent nella dashboard**: Aggiunta una search box nella sidebar per filtrare rapidamente i client per hostname
  - File modificati: `server/public/index.html`, `server/public/js/app.js`, `server/public/css/style.css`

- **Script di pulizia installazioni precedenti**: Nuovo script PowerShell `Cleanup-OldAgent.ps1` per rimuovere manualmente installazioni orfane
  - Rimuove servizio Windows
  - Pulisce voci di registro
  - Elimina file di installazione
  - Rimuove regole firewall
  - Opzione per mantenere i log

### Modifiche

- **Visualizzazione percorsi UNC**: Corretta la visualizzazione dei percorsi UNC nel placeholder della UI
  - Prima: `\\\\NAS\\Backups\\test_backup` (doppio backslash)
  - Ora: `\\NAS\\Backups\\test_backup` (singolo backslash)
  - File modificato: `server/public/js/app.js:1345`

- **Gestione upgrade MSI migliorata**: Risolti problemi di aggiornamento quando il vecchio MSI non è disponibile
  - Cambiato `ProductCode` da fisso a `*` (auto-generato ad ogni build)
  - Incrementata versione prodotto a `1.0.1.0`
  - Aggiunto `Schedule="afterInstallInitialize"` a MajorUpgrade
  - Aggiunte custom action per:
    - Fermare il servizio prima dell'upgrade
    - Pulire voci di registro orfane
  - File modificato: `scripts/wix/AgentInstaller.wxs`

### Correzioni

- **Fix multicast storm**: Risolto problema di broadcast UDP non intenzionale nella funzione `GetLocalIPAddress()`
  - Cambiato da `SocketType.Dgram` (UDP) a `SocketType.Stream` (TCP)
  - Aggiunto fallback su `Dns.GetHostEntry()` se la connessione TCP fallisce
  - Questo previene storm di pacchetti multicast sulla rete
  - File modificato: `agent/OnlyBackupAgent/Communication/ServerCommunication.cs:54-88`

- **Compatibilità Windows per script npm**: Corretti gli script npm che usavano sintassi Unix
  - Prima: `NODE_ENV=development node src/server.js` (non funziona su Windows)
  - Ora: `set NODE_ENV=development&& node src/server.js` (funziona su Windows)
  - File modificato: `server/package.json:8-9`

### Dettagli Tecnici

#### 1. Barra di ricerca agent
```javascript
// Nuova funzione in app.js
filterClients(searchTerm) {
    const items = document.querySelectorAll('.client-item');
    const term = searchTerm.toLowerCase().trim();
    items.forEach(item => {
        const hostname = item.querySelector('.client-name')?.textContent.toLowerCase() || '';
        item.style.display = hostname.includes(term) ? '' : 'none';
    });
}
```

#### 2. Fix multicast storm
**Problema**: L'uso di UDP Datagram Socket senza specificare protocollo causava broadcast sulla rete
```csharp
// PRIMA (problematico)
using (Socket socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, 0))

// DOPO (corretto)
using (Socket socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp))
```

#### 3. MSI Upgrade senza vecchio MSI
**Problema**: Windows Installer richiede il vecchio MSI per fare upgrade/rimozione se ProductCode è fisso

**Soluzione**:
- `ProductCode="*"` genera un GUID unico ad ogni build
- `UpgradeCode` rimane fisso per identificare la famiglia di prodotti
- Custom Actions puliscono automaticamente le voci di registro del vecchio ProductCode fisso
- Script `Cleanup-OldAgent.ps1` per pulizia manuale nei casi più complessi

```xml
<CustomAction Id="CleanupOrphanedRegistry"
              ExeCommand="cmd.exe /c &quot;reg delete HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{9C9E5F2A-88E9-4A79-9E8E-5F1EAF9B64A8} /f 2&gt;nul&quot;"
              Execute="immediate"
              Return="ignore" />
```

### Note di Upgrade

Per aggiornare da versioni precedenti:

1. **Se l'upgrade MSI funziona normalmente**: semplicemente installare il nuovo MSI
   ```cmd
   msiexec /i OnlyBackupAgent.msi /qn
   ```

2. **Se si ricevono errori di conflitto**: utilizzare lo script di pulizia prima
   ```powershell
   .\scripts\Cleanup-OldAgent.ps1
   msiexec /i OnlyBackupAgent.msi /qn
   ```

3. **Per conservare i log durante la pulizia**:
   ```powershell
   .\scripts\Cleanup-OldAgent.ps1 -KeepLogs
   ```

### Testing

Tutte le modifiche sono state testate su:
- Windows Server 2019/2022
- Windows 10/11
- Reti con multiple subnet
- Scenari di upgrade da versioni precedenti

### Ringraziamenti

Grazie per l'utilizzo di OnlyBackup!
