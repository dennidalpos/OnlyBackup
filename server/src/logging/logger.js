const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

class Logger {
  constructor(config) {
    this.config = config;
    this.logger = null;
    this.cappedJobLogs = new Set();
    this.cleanupTimer = null;
    this.init();
  }

  init() {
    const logsDir = path.join(this.config.dataRoot, 'logs');

    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const transports = [];
    const isProduction = this.config.server.environment === 'production';
    const logLevel = process.env.LOG_LEVEL || this.config.logging?.level || (isProduction ? 'warn' : 'info');

    if (this.config.logging.console) {
      transports.push(
        new winston.transports.Console({
          level: logLevel,
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
              if (isProduction) {
                if (level.includes('error') || level.includes('warn')) {
                  let msg = `${timestamp} [${level}] ${message}`;
                  if (Object.keys(meta).length > 0) {
                    msg += ` ${JSON.stringify(meta)}`;
                  }
                  return msg;
                }
                return '';
              }
              let msg = `${timestamp} [${level}] ${message}`;
              if (Object.keys(meta).length > 0) {
                msg += ` ${JSON.stringify(meta)}`;
              }
              return msg;
            })
          )
        })
      );
    }

    if (this.config.logging.file) {
      transports.push(
        new DailyRotateFile({
          dirname: logsDir,
          filename: 'onlybackup-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxSize: this.config.logging.maxSize || '10m',
          maxFiles: this.config.logging.maxFiles || '30d',
          format: winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.json()
          )
        })
      );
    }

    this.logger = winston.createLogger({
      level: logLevel,
      transports
    });

    this.scheduleLogCleanup();
  }

  scheduleLogCleanup() {
    const retentionDays = Number(this.config.logging?.retentionDays || 0);
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (!retentionDays || retentionDays <= 0) {
      return;
    }

    const hours = this.config.logging?.cleanupIntervalHours || 6;
    const intervalMs = Math.max(1, hours) * 60 * 60 * 1000;

    this.cleanupObsoleteLogs(retentionDays);

    this.cleanupTimer = setInterval(() => {
      this.cleanupObsoleteLogs(retentionDays);
    }, intervalMs);
  }

  cleanupObsoleteLogs(retentionDays) {
    const logsDir = path.join(this.config.dataRoot, 'logs');
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    this.removeOldLogFiles(logsDir, cutoff, (file) => file.endsWith('.log') || file.endsWith('.log.gz'));
  }

  removeOldLogFiles(directory, cutoffMs, predicate = null) {
    if (!fs.existsSync(directory)) {
      return;
    }

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);

      try {
        if (entry.isDirectory()) {
          this.removeOldLogFiles(fullPath, cutoffMs, predicate);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        if (predicate && !predicate(entry.name)) {
          continue;
        }

        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs < cutoffMs) {
          fs.unlinkSync(fullPath);
        }
      } catch (error) {
        if (this.logger) {
          this.logger.warn('Impossibile pulire file di log', { path: fullPath, error: error.message });
        }
      }
    }
  }

  updateLogRetention(retentionDays) {
    if (!this.config.logging) {
      this.config.logging = {};
    }

    this.config.logging.retentionDays = retentionDays;
    this.scheduleLogCleanup();
  }

  info(message, meta = {}) {
    this.logger.info(message, meta);
  }

  warn(message, meta = {}) {
    this.logger.warn(message, meta);
  }

  error(message, meta = {}) {
    this.logger.error(message, meta);
  }

  debug(message, meta = {}) {
    this.logger.debug(message, meta);
  }

  logServerStart(config) {
    this.info('OnlyBackup Server avviato', {
      event: 'server_start',
      host: config.server.host,
      port: config.server.port,
      environment: config.server.environment
    });
  }

  logServerStop() {
    this.info('OnlyBackup Server arrestato', { event: 'server_stop' });
  }

  logJobScheduled(jobId, policyId, nextRun) {
    this.debug('Job schedulato', { event: 'job_scheduled', jobId, nextRun });
  }

  logJobStart(jobId, runId, clientHostname) {
    this.info('Job avviato', { event: 'job_start', jobId, runId, clientHostname });
  }

  logJobEnd(jobId, runId, status, bytesProcessed, duration) {
    this.info('Job completato', { event: 'job_end', jobId, runId, status, bytesProcessed, duration });
  }

  logJobError(jobId, runId, error) {
    this.error('Job fallito', { event: 'job_error', jobId, runId, error: error.message });
  }

  logJobIssue(jobId, jobName, runId, level, message, meta = {}) {
    const logsDir = path.join(this.config.dataRoot, 'logs', 'jobs');

    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const normalizedLevel = ['error', 'warn', 'info'].includes(level) ? level : 'info';
    const logLine = {
      timestamp: new Date().toISOString(),
      level: normalizedLevel,
      jobId,
      jobName,
      runId,
      message,
      ...meta
    };

    const jobLogPath = path.join(logsDir, `${jobId}.log`);
    const maxBytes = 20 * 1024 * 1024;

    try {
      const serialized = JSON.stringify(logLine) + '\n';
      const currentSize = fs.existsSync(jobLogPath) ? fs.statSync(jobLogPath).size : 0;

      if (currentSize + Buffer.byteLength(serialized, 'utf8') > maxBytes) {
        if (!this.cappedJobLogs.has(jobId)) {
          this.cappedJobLogs.add(jobId);
          const capNotice = {
            timestamp: new Date().toISOString(),
            level: 'warn',
            jobId,
            jobName,
            runId,
            message: `Log del job ha raggiunto il limite di ${maxBytes} byte: ulteriori eventi saranno scartati`
          };
          fs.appendFileSync(jobLogPath, JSON.stringify(capNotice) + '\n', 'utf8');
        }
        return;
      }

      fs.appendFileSync(jobLogPath, serialized, 'utf8');
    } catch (error) {
      this.logger.error('Impossibile scrivere log job dedicato', { jobId, error: error.message });
    }

    if (typeof this.logger[normalizedLevel] === 'function') {
      this.logger[normalizedLevel](message, { jobId, runId, jobName, ...meta });
    }
  }

  logInvalidConfig(type, path, error) {
    this.error('Configurazione invalida', { event: 'invalid_config', type, path, error: error.message });
  }

  logAuthAttempt(username, success, reason = null) {
    const level = success ? 'info' : 'warn';
    this.logger.log(level, 'Tentativo di autenticazione', { event: 'auth_attempt', username, success, reason });
  }

  logApiCall(method, path, username, statusCode) {
    this.debug('API chiamata', { event: 'api_call', method, path, username, statusCode });
  }
}

module.exports = Logger;
