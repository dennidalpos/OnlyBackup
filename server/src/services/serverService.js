const { spawn } = require('child_process');
const path = require('path');

class ServerService {
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * Riavvia il processo Node.js del server
   * Cross-platform: Windows (taskkill) e Unix/Linux (SIGTERM)
   */
  async restartServer() {
    const pid = process.pid;
    const platform = process.platform;
    const cwd = process.cwd();
    const nodeArgs = process.argv;

    this.logger.warn('Riavvio server richiesto', {
      pid,
      platform,
      cwd,
      nodeVersion: process.version,
      uptime: process.uptime()
    });

    // Audit event
    this.logger.info('SERVER_RESTART', {
      event: 'SERVER_RESTART',
      pid,
      platform,
      timestamp: new Date().toISOString()
    });

    // Delay per permettere risposta HTTP
    setTimeout(() => {
      this.performRestart(platform, cwd, nodeArgs);
    }, 1000);

    return {
      success: true,
      message: 'Riavvio in corso...',
      pid,
      platform,
      estimatedDowntime: '5-10 secondi'
    };
  }

  performRestart(platform, cwd, nodeArgs) {
    try {
      if (platform === 'win32') {
        this.restartWindows(cwd, nodeArgs);
      } else {
        this.restartUnix(cwd, nodeArgs);
      }
    } catch (error) {
      this.logger.error('Errore durante riavvio', {
        error: error.message,
        stack: error.stack
      });
    }
  }

  restartWindows(cwd, nodeArgs) {
    this.logger.info('Riavvio Windows in corso', { cwd });

    // Script PowerShell per riavvio con graceful shutdown
    const psScript = `
      Start-Sleep -Seconds 2
      $processId = ${process.pid}

      # Invia SIGTERM al processo (graceful shutdown)
      # In Windows, usiamo taskkill senza /F per dare tempo al processo
      taskkill /PID $processId /T

      # Attendi che il processo termini (max 5 secondi)
      for ($i = 0; $i -lt 10; $i++) {
        $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if (-not $proc) { break }
        Start-Sleep -Milliseconds 500
      }

      # Se ancora in esecuzione, forza terminazione
      $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
      if ($proc) {
        Stop-Process -Id $processId -Force
      }

      Start-Sleep -Seconds 1
      Set-Location "${cwd.replace(/\\/g, '\\\\')}"
      npm start
    `;

    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command', psScript
    ], {
      detached: true,
      stdio: 'ignore',
      cwd
    });

    child.unref();

    this.logger.info('Processo riavvio Windows avviato', {
      childPid: child.pid,
      parentPid: process.pid
    });

    // Inizia graceful shutdown del server corrente
    // Questo permette di salvare sessioni, chiudere connessioni, etc.
    setTimeout(() => {
      this.logger.info('Graceful shutdown iniziato');
      process.emit('SIGTERM');
    }, 1500);
  }

  restartUnix(cwd, nodeArgs) {
    this.logger.info('Riavvio Unix/Linux in corso', { cwd });

    // Script bash per riavvio
    const bashScript = `
      sleep 2
      kill -TERM ${process.pid}
      sleep 1
      cd "${cwd}"
      npm start &
    `;

    const child = spawn('bash', ['-c', bashScript], {
      detached: true,
      stdio: 'ignore',
      cwd
    });

    child.unref();

    this.logger.info('Processo riavvio Unix avviato', {
      childPid: child.pid,
      parentPid: process.pid
    });
  }

  /**
   * Verifica se il server è in esecuzione con un process manager
   * (pm2, systemd, docker, etc.)
   */
  detectProcessManager() {
    // PM2
    if (process.env.PM2_HOME) {
      return { type: 'pm2', canAutoRestart: true };
    }

    // Systemd
    if (process.env.INVOCATION_ID) {
      return { type: 'systemd', canAutoRestart: true };
    }

    // Docker
    if (process.env.DOCKER_CONTAINER) {
      return { type: 'docker', canAutoRestart: true };
    }

    // Nessun process manager
    return { type: 'manual', canAutoRestart: false };
  }

  /**
   * Riavvio intelligente basato su process manager
   */
  async smartRestart() {
    const pm = this.detectProcessManager();

    this.logger.info('Process Manager rilevato', pm);

    if (pm.type === 'pm2') {
      return this.restartPM2();
    } else if (pm.type === 'systemd') {
      return this.restartSystemd();
    } else {
      return this.restartServer();
    }
  }

  restartPM2() {
    this.logger.info('Riavvio via PM2');

    const child = spawn('pm2', ['restart', 'onlybackup'], {
      detached: true,
      stdio: 'ignore'
    });

    child.unref();

    return {
      success: true,
      message: 'Riavvio PM2 in corso...',
      method: 'pm2'
    };
  }

  restartSystemd() {
    this.logger.info('Riavvio via systemd');

    const child = spawn('systemctl', ['restart', 'onlybackup.service'], {
      detached: true,
      stdio: 'ignore'
    });

    child.unref();

    return {
      success: true,
      message: 'Riavvio systemd in corso...',
      method: 'systemd'
    };
  }
}

module.exports = ServerService;
