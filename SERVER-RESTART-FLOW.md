# Server Restart Flow - OnlyBackup

## Panoramica

Sistema di riavvio del processo Node.js del server OnlyBackup con gestione cross-platform, audit logging e auto-reload UI.

---

## Flusso Completo

```
┌─────────────────┐
│   CLIENT UI     │
│ (Browser)       │
└────────┬────────┘
         │
         │ 1. Conferma utente
         │    "Sei sicuro?"
         │
         ▼
┌─────────────────────────────────┐
│ POST /api/server/reboot         │
│ (Admin only)                    │
└────────┬────────────────────────┘
         │
         │ 2. Audit Event
         │    SERVER_RESTART
         │    - user
         │    - ip
         │    - timestamp
         │
         ▼
┌─────────────────────────────────┐
│ ServerService.restartServer()   │
│                                 │
│ - Log diagnostici (PID, OS)     │
│ - Risposta immediata al client  │
│ - Riavvio asincrono (1s delay)  │
└────────┬────────────────────────┘
         │
         │ 3. Risposta immediata
         │    { success, message, pid, platform }
         │
         ▼
┌─────────────────────────────────┐
│   CLIENT: Countdown 8s          │
│                                 │
│ "Riavvio in corso..."           │
│ "Reload automatico tra Xs..."   │
└────────┬────────────────────────┘
         │
         │ 4. Riavvio server
         │    (detached process)
         │
         ├─ Windows: PowerShell
         │  - taskkill -PID
         │  - npm start
         │
         └─ Unix: Bash
            - kill -TERM PID
            - npm start &

         ▼
┌─────────────────────────────────┐
│   CLIENT: Polling check         │
│                                 │
│ GET /api/auth/status (no-cache) │
│ Ogni 2s, max 10 tentativi       │
└────────┬────────────────────────┘
         │
         │ 5. Server risponde OK
         │
         ▼
┌─────────────────────────────────┐
│   window.location.reload()      │
│                                 │
│ "Server online!"                │
└─────────────────────────────────┘
```

---

## Componenti

### 1. ServerService (`server/src/services/serverService.js`)

**Metodo principale: `restartServer()`**

```javascript
async restartServer() {
  // 1. Log diagnostici
  const pid = process.pid;
  const platform = process.platform;

  this.logger.warn('SERVER_RESTART', {
    pid, platform, cwd, timestamp
  });

  // 2. Delay per risposta HTTP
  setTimeout(() => {
    this.performRestart(platform, cwd, nodeArgs);
  }, 1000);

  // 3. Risposta immediata
  return {
    success: true,
    message: 'Riavvio in corso...',
    pid,
    platform,
    estimatedDowntime: '5-10 secondi'
  };
}
```

**Comportamento cross-platform:**

#### Windows (`restartWindows`)
```powershell
Start-Sleep -Seconds 2
Stop-Process -Id $PID -Force
Start-Sleep -Seconds 1
Set-Location "C:\path\to\server"
npm start
```

#### Unix/Linux (`restartUnix`)
```bash
sleep 2
kill -TERM $PID
sleep 1
cd /path/to/server
npm start &
```

**Caratteristiche:**
- ✅ Processo **detached** (`detached: true`)
- ✅ Processo **unref()** (non blocca terminazione parent)
- ✅ stdio: 'ignore' (no pipe inheritance)
- ✅ Log PID parent e child

---

### 2. API Endpoint (`server/src/api/routes.js`)

**`POST /api/server/reboot`**

```javascript
router.post('/api/server/reboot', requireAuth, async (req, res) => {
  // 1. Check permessi admin
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo admin' });
  }

  // 2. Audit log
  logger.warn('Riavvio server richiesto', {
    user: req.username,
    ip: req.ip,
    timestamp: new Date().toISOString()
  });

  // 3. Riavvio asincrono
  const result = await serverService.restartServer();

  // 4. Risposta immediata
  res.json(result);
});
```

**Sicurezza:**
- ✅ `requireAuth` middleware
- ✅ Check `role === 'admin'`
- ✅ Audit logging completo
- ✅ Risposta immediata prima di terminare processo

---

### 3. Client-side (`server/public/js/server-settings.js`)

**Funzione: `rebootServer()`**

```javascript
async function rebootServer() {
  // 1. Doppia conferma
  if (!confirm('Sei sicuro...')) return;

  // 2. POST al server
  const response = await fetch('/api/server/reboot', {
    method: 'POST'
  });

  const data = await response.json();

  // 3. Mostra countdown
  showCountdown(8); // 8 secondi

  // 4. Polling check server
  setTimeout(() => {
    checkServerAvailability();
  }, 8000);
}
```

**Funzione: `checkServerAvailability()`**

```javascript
async function checkServerAvailability() {
  let attempts = 0;
  const maxAttempts = 10;
  const checkInterval = 2000; // 2s

  const check = async () => {
    attempts++;

    try {
      const response = await fetch('/api/auth/status', {
        cache: 'no-cache'
      });

      if (response.ok) {
        // Server online!
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        // Riprova
        if (attempts < maxAttempts) {
          setTimeout(check, checkInterval);
        }
      }
    } catch (error) {
      // Server offline, riprova
      if (attempts < maxAttempts) {
        setTimeout(check, checkInterval);
      } else {
        // Max tentativi raggiunto
        showMessage('warning', 'Ricarica manualmente');
      }
    }
  };

  check();
}
```

**UX:**
- ✅ Countdown visibile (8s)
- ✅ Polling automatico (2s interval)
- ✅ Max 10 tentativi (20s totali)
- ✅ Auto-reload quando server risponde
- ✅ Fallback manuale se timeout

---

## Process Manager Support

Il servizio rileva automaticamente se è in esecuzione con un process manager:

### PM2
```javascript
if (process.env.PM2_HOME) {
  spawn('pm2', ['restart', 'onlybackup']);
}
```

### Systemd
```javascript
if (process.env.INVOCATION_ID) {
  spawn('systemctl', ['restart', 'onlybackup.service']);
}
```

### Docker
```javascript
if (process.env.DOCKER_CONTAINER) {
  // Container restart managed by Docker
}
```

### Manual (default)
```javascript
// Restart via npm start
spawn('npm', ['start'], { detached: true });
```

---

## Log Audit

Tutti i riavvii sono tracciati nei log:

```json
{
  "level": "warn",
  "message": "SERVER_RESTART",
  "user": "admin",
  "ip": "192.168.1.100",
  "pid": 12345,
  "platform": "win32",
  "cwd": "C:\\path\\to\\server",
  "timestamp": "2026-01-12T10:30:00.000Z"
}
```

---

## Testing

### Test manuale
1. Login come admin
2. Vai su "⚙️ Impostazioni" → Tab "Server"
3. Click "🔄 Riavvia Server"
4. Conferma
5. Verifica countdown e auto-reload

### Test da console
```javascript
// Dev console
fetch('/api/server/reboot', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
})
.then(r => r.json())
.then(console.log);
```

### Log da verificare
```bash
# Unix
tail -f data/logs/app-*.log | grep SERVER_RESTART

# Windows
Get-Content data\logs\app-*.log -Tail 50 | Select-String "SERVER_RESTART"
```

---

## Troubleshooting

### Server non si riavvia
1. **Check permessi**: L'utente Node.js ha permessi per eseguire `npm start`?
2. **Check PATH**: npm è nel PATH del processo?
3. **Check CWD**: Il processo child parte dalla directory corretta?

### UI non si ricarica
1. **Check timeout**: Il server impiega > 20s a riavviarsi?
2. **Check endpoint**: `/api/auth/status` è disponibile?
3. **Check firewall**: La porta è bloccata durante il riavvio?

### Windows specifico
- **Execution Policy**: PowerShell potrebbe bloccare script non firmati
  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Bypass
  ```

### Unix/Linux specifico
- **SIGTERM handler**: Il processo gestisce correttamente SIGTERM?
- **npm disponibile**: `which npm` restituisce un path valido?

---

## Sicurezza

✅ **Solo Admin**: Endpoint protetto con check `role === 'admin'`
✅ **Audit completo**: Tutti i riavvii sono loggati con user, IP, timestamp
✅ **No secrets in logs**: Password/token non vengono loggati
✅ **Rate limiting**: (da implementare) Max 1 riavvio ogni 60s
✅ **Session cleanup**: Le sessioni attive restano valide dopo riavvio

---

## Miglioramenti Futuri

- [ ] Rate limiting (max 1 riavvio/minuto)
- [ ] Notifica email agli admin su riavvio
- [ ] Graceful shutdown (attendere backup in corso)
- [ ] Health check pre-riavvio
- [ ] Rollback automatico se riavvio fallisce
- [ ] Supporto cluster (riavvio rolling)
