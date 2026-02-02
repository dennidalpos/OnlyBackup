const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const Logger = require('./logging/logger');
const Storage = require('./storage/storage');
const AuthManager = require('./auth/auth');
const JobExecutor = require('./scheduler/jobExecutor');
const Scheduler = require('./scheduler/scheduler');
const EmailService = require('./services/emailService');
const AlertService = require('./services/alertService');
const ServerService = require('./services/serverService');
const setupRoutes = require('./api/routes');

class OnlyBackupServer {
  constructor() {
    this.config = null;
    this.logger = null;
    this.storage = null;
    this.authManager = null;
    this.emailService = null;
    this.alertService = null;
    this.serverService = null;
    this.jobExecutor = null;
    this.scheduler = null;
    this.app = null;
    this.server = null;
    this.configPath = null;
  }

  async start() {
    try {
      this.loadConfig();

      this.logger = new Logger(this.config);
      this.logger.logServerStart(this.config);

      this.storage = new Storage(this.config.dataRoot, this.logger);

      this.authManager = new AuthManager(this.storage, this.logger, this.config);

      this.emailService = new EmailService(this.storage, this.logger);

      this.alertService = new AlertService(this.storage, this.logger);

      this.serverService = new ServerService(this.logger);

      this.jobExecutor = new JobExecutor(this.storage, this.logger, this.config, this.emailService, this.alertService);

      this.scheduler = new Scheduler(this.storage, this.logger, this.config, this.jobExecutor);

      this.setupExpress();

      await this.scheduler.start();

      await this.startHttpServer();

      this.printStartupInfo();

      setInterval(() => {
        this.authManager.cleanupExpiredSessions();
      }, 60000);

      setInterval(() => {
        this.checkOfflineAgents();
      }, 5 * 60 * 1000);

      this.setupShutdownHandlers();

    } catch (error) {
      console.error('Errore fatale durante avvio server:', error);
      process.exit(1);
    }
  }

  loadConfig() {
    const possiblePaths = [
      process.env.CONFIG_PATH,
      path.join(process.cwd(), 'config.json'),
      path.join(process.cwd(), '..', 'config.json'),
      path.join(__dirname, '..', '..', 'config.json')
    ].filter(Boolean);

    let configPath = null;
    for (const testPath of possiblePaths) {
      if (fs.existsSync(testPath)) {
        configPath = testPath;
        break;
      }
    }

    if (!configPath) {
      throw new Error(
        `File di configurazione non trovato. Cercato in:\n` +
        possiblePaths.map(p => `  - ${p}`).join('\n')
      );
    }

    this.configPath = configPath;
    const configData = fs.readFileSync(configPath, 'utf8');
    this.config = JSON.parse(configData);

    const configDir = path.dirname(configPath);
    if (this.config.dataRoot && !path.isAbsolute(this.config.dataRoot)) {
      this.config.dataRoot = path.join(configDir, this.config.dataRoot);
    }

    this.config.server = {
      host: '0.0.0.0',
      port: 8080,
      environment: 'production',
      ...(this.config.server || {})
    };

    if (!this.config.dataRoot) {
      this.config.dataRoot = path.join(configDir, 'data');
    }
  }

  setupExpress() {
    this.app = express();

    // Compression middleware (gzip/deflate)
    this.app.use(compression({
      filter: (req, res) => {
        // Non comprimere SSE (text/event-stream)
        if (req.headers.accept && req.headers.accept.includes('text/event-stream')) {
          return false;
        }
        return compression.filter(req, res);
      },
      level: 6, // Balance tra velocità e compressione
      threshold: 1024 // Comprimi solo se > 1KB
    }));

    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(cookieParser());
    this.app.set('trust proxy', true);
    this.app.set('config', this.config);

    this.app.use((err, req, res, next) => {
      if (err instanceof SyntaxError && 'body' in err) {
        this.logger.warn('Payload JSON non valido', { path: req.path });
        return res.status(400).json({ error: 'JSON non valido' });
      }
      return next(err);
    });

    this.app.use(express.static(path.join(__dirname, '../public')));

    this.app.set('emailService', this.emailService);
    this.app.set('alertService', this.alertService);
    this.app.set('serverService', this.serverService);
    this.app.set('configPath', this.configPath);

    setupRoutes(this.app, this.authManager, this.storage, this.scheduler, this.logger);

    this.app.use((req, res, next) => {
      if (!req.path.startsWith('/api/')) {
        return res.sendFile(path.join(__dirname, '../public/index.html'));
      }
      return res.status(404).json({ error: 'Endpoint non trovato' });
    });

    this.app.use((err, req, res, next) => {
      this.logger.error('Errore Express', { error: err.message });
      res.status(500).json({ error: 'Errore interno del server' });
    });
  }

  startHttpServer() {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(
        this.config.server.port,
        this.config.server.host,
        () => {
          resolve();
        }
      );

      this.server.on('error', (error) => {
        reject(error);
      });
    });
  }

  printStartupInfo() {
    const jobs = this.storage.loadAllJobs().filter(j => j.enabled);
    const scheduledJobs = this.scheduler.getScheduledJobs();

    const host = this.config.server.host === '0.0.0.0' ? '127.0.0.1' : this.config.server.host;
    const dashboardUrl = `http://${host}:${this.config.server.port}/`;

    console.log('');
    console.log('='.repeat(70));
    console.log('  OnlyBackup Server');
    console.log('='.repeat(70));
    console.log('');
    console.log(`  Server HTTP:      ${this.config.server.host}:${this.config.server.port}`);
    console.log(`  Dashboard URL:    ${dashboardUrl}`);
    console.log(`  Ambiente:         ${this.config.server.environment}`);
    console.log('');
    console.log(`  Job abilitati:    ${jobs.length}`);
    console.log(`  Job schedulati:   ${scheduledJobs.length}`);
    console.log('');
    console.log('='.repeat(70));
    console.log('');
  }

  checkOfflineAgents() {
    try {
      const HEARTBEAT_TTL_MS = 2 * 60 * 1000;
      const heartbeats = this.storage.loadAllAgentHeartbeats();
      const now = Date.now();

      heartbeats.forEach(hb => {
        const lastSeen = new Date(hb.timestamp).getTime();
        const isOffline = hb.status === 'offline' || (now - lastSeen) > HEARTBEAT_TTL_MS;

        if (isOffline && hb.status !== 'offline') {
          const jobs = this.storage.loadAllJobs()
            .filter(j => j.client_hostname === hb.hostname);

          // Crea alert per agent offline
          let shouldNotifyEmail = true;
          if (this.alertService) {
            const alert = this.alertService.createAgentOfflineAlert(
              hb.hostname,
              jobs.map(j => j.job_id)
            );
            shouldNotifyEmail = alert?.isNew ?? true;
          }

          if (this.emailService && shouldNotifyEmail) {
            this.emailService.notifyAgentStatus(
              hb.hostname,
              'offline',
              hb.timestamp,
              jobs.map(j => j.job_id)
            ).catch(err => {
              this.logger.warn('Errore invio notifica email agent offline', { error: err.message });
            });
          }

          const updatedHeartbeat = { ...hb, status: 'offline' };
          this.storage.saveAgentHeartbeat(updatedHeartbeat);
        }
      });
    } catch (error) {
      this.logger.error('Errore verifica agent offline', { error: error.message });
    }
  }

  setupShutdownHandlers() {
    const shutdown = async (signal) => {
      console.log('');
      this.logger.info(`Ricevuto segnale ${signal}, arresto in corso...`);

      try {
        if (this.scheduler) {
          this.scheduler.stop();
        }

        if (this.server) {
          await new Promise((resolve) => {
            this.server.close(resolve);
          });
        }

        this.logger.logServerStop();
        process.exit(0);
      } catch (error) {
        console.error('Errore durante shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught Exception', { error: error.message });
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled Rejection', { reason: reason?.message || reason });
    });
  }
}

const server = new OnlyBackupServer();
server.start().catch((error) => {
  console.error('Errore avvio server:', error);
  process.exit(1);
});

module.exports = OnlyBackupServer;
