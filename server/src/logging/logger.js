const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

class Logger {
  constructor(config) {
    this.config = config;
    this.logger = null;
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
