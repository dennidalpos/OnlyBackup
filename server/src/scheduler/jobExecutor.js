const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const http = require('http');

const AgentErrorCodes = {
  AGENT_UNREACHABLE: 'AGENT_UNREACHABLE',
  AGENT_TIMEOUT: 'AGENT_TIMEOUT',
  AGENT_INVALID_RESPONSE: 'AGENT_INVALID_RESPONSE',
  UNC_INVALID_FORMAT: 'UNC_INVALID_FORMAT',
  NETWORK_PATH_NOT_FOUND: 'NETWORK_PATH_NOT_FOUND',
  ACCESS_DENIED: 'ACCESS_DENIED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  SOURCE_NOT_FOUND: 'SOURCE_NOT_FOUND',
  DESTINATION_WRITE_ERROR: 'DESTINATION_WRITE_ERROR',
  PATH_TOO_LONG: 'PATH_TOO_LONG',
  SOURCE_EQUALS_DESTINATION: 'SOURCE_EQUALS_DESTINATION',
  PATH_OVERLAP: 'PATH_OVERLAP',
  UNKNOWN_AGENT_ERROR: 'UNKNOWN_AGENT_ERROR'
};

const ErrorMessages = {
  AGENT_UNREACHABLE: 'Agent non raggiungibile (connessione rifiutata o timeout)',
  AGENT_TIMEOUT: 'Timeout comunicazione con agent',
  UNC_INVALID_FORMAT: 'Formato percorso UNC non valido',
  NETWORK_PATH_NOT_FOUND: 'Percorso di rete non raggiungibile o inesistente',
  ACCESS_DENIED: 'Accesso negato al percorso di destinazione',
  INVALID_CREDENTIALS: 'Credenziali non valide per l\'accesso al NAS',
  SOURCE_NOT_FOUND: 'Percorso sorgente non trovato',
  DESTINATION_WRITE_ERROR: 'Impossibile scrivere nella destinazione',
  PATH_TOO_LONG: 'Percorso troppo lungo (supera il limite di 260 caratteri)',
  SOURCE_EQUALS_DESTINATION: 'Sorgente e destinazione sono identiche',
  PATH_OVERLAP: 'Sorgente e destinazione si sovrappongono (una è contenuta nell\'altra)',
  UNKNOWN_AGENT_ERROR: 'Errore sconosciuto dall\'agent'
};

const BACKUP_COMPLETE_MARKER = '.backup_complete';

class JobExecutor {
  constructor(storage, logger, config) {
    this.storage = storage;
    this.logger = logger;
    this.config = config;
    this.runningJobs = new Map();
  }

  isJobRunning(jobId) {
    return this.runningJobs.has(jobId);
  }

  async executeJob(job) {
    if (this.runningJobs.has(job.job_id)) {
      const error = new Error(`Job ${job.job_id} già in esecuzione`);
      error.code = 'JOB_RUNNING';
      throw error;
    }

    const runId = uuidv4();
    this.runningJobs.set(job.job_id, runId);

    const run = {
      run_id: runId,
      job_id: job.job_id,
      client_hostname: job.client_hostname,
      start: new Date().toISOString(),
      end: null,
      status: 'running',
      bytes_processed: 0,
      target_path: null,
      errors: [],
      simulated: false,
      mode_default: job.mode_default || 'copy',
      schedule: job.schedule || null,
      mappings: []
    };

    this.storage.saveRun(run);
    this.logger.logJobStart(job.job_id, runId, job.client_hostname);

    const startTime = Date.now();

    try {
      if (job.mappings && job.mappings.length > 0) {
        const result = await this.executeMappingJob(job, run);
        run.bytes_processed = result.bytesProcessed;
        run.target_path = result.lastTargetPath;
        run.simulated = result.simulated;
      } else {
        throw new Error('Nessuna mappatura disponibile per il job');
      }

      run.status = 'success';
      run.end = new Date().toISOString();

      this.storage.saveRun(run);

      const duration = Date.now() - startTime;
      this.logger.logJobEnd(job.job_id, runId, 'success', run.bytes_processed, duration);

      await this.applyRetentionForJob(job, run);

      return {
        success: true,
        runId,
        bytesProcessed: run.bytes_processed,
        simulated: run.simulated
      };
    } catch (error) {
      run.status = 'failure';
      run.end = new Date().toISOString();
      run.errors.push({
        timestamp: new Date().toISOString(),
        message: error.message,
        stack: error.stack
      });

      this.storage.saveRun(run);
      this.logger.logJobError(job.job_id, runId, error);

      throw error;
    } finally {
      this.runningJobs.delete(job.job_id);
    }
  }

  extractFolderNameFromPath(sourcePath) {
    if (!sourcePath) return 'backup';

    const normalizedPath = sourcePath.replace(/\\/g, '/').replace(/\/+$/, '');
    const parts = normalizedPath.split('/');
    const folderName = parts[parts.length - 1] || 'backup';

    return folderName.replace(/[^a-zA-Z0-9_-]/g, '_');
  }


  async executeMappingJob(job, run) {
    let totalBytes = 0;
    let lastTargetPath = null;

    const agentInfo = this.getAgentInfo(job.client_hostname);

    if (!agentInfo) {
      const error = new Error(`Agent non raggiungibile o non configurato per ${job.client_hostname}`);
      error.code = 'AGENT_UNAVAILABLE';
      throw error;
    }

    for (const mapping of job.mappings) {
      const result = await this.executeSingleMapping(job, mapping, agentInfo);
      totalBytes += result.bytesProcessed;
      lastTargetPath = result.targetPath || lastTargetPath;

      const mappingResult = {
        label: mapping.label || '',
        source_path: mapping.source_path,
        destination_path: mapping.destination_path,
        target_path: result.targetPath,
        mode: result.mode,
        bytes_processed: result.bytesProcessed,
        simulated: false,
        credentials_used: mapping.credentials ? {
          type: mapping.credentials.type || 'nas',
          username: mapping.credentials.username || '',
          domain: mapping.credentials.domain || ''
        } : null,
        retention_deleted: [],
        stats: result.stats || null,
        retention_index: result.retention_index || null,
        timestamp: result.timestamp || null
      };

      this.logger.debug('Mapping completato', {
        jobId: job.job_id,
        bytes_processed: result.bytesProcessed,
        has_stats: !!result.stats
      });

      run.mappings.push(mappingResult);
      this.storage.saveRun(run);
    }

    return { bytesProcessed: totalBytes, lastTargetPath, simulated: false };
  }

  async executeSingleMapping(job, mapping, agentInfo) {
    const mode = (mapping.mode || job.mode_default || 'copy').toLowerCase();

    let targetPath;
    if (mode === 'copy') {
      const maxBackups = Number(mapping.retention?.max_backups || 0);
      const retentionSlots = maxBackups > 0 ? maxBackups : 5;

      if (retentionSlots < 1) {
        throw new Error('Retention deve essere >= 1');
      }

      const jobLabel = (mapping.label || job.job_id || 'backup')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .substring(0, 50);

      const existingBackups = this.scanExistingBackups(mapping.destination_path, jobLabel, mode);

      existingBackups.sort((a, b) => a.mtime - b.mtime);

      this.logger.debug('Retention - backup trovati', {
        jobId: job.job_id,
        count: existingBackups.length,
        slots: retentionSlots
      });

      let retentionIndex;
      let backupsToDelete = [];

      if (existingBackups.length < retentionSlots) {
        const usedIndices = existingBackups.map(b => b.retention_index);
        retentionIndex = 1;
        while (usedIndices.includes(retentionIndex) && retentionIndex <= retentionSlots) {
          retentionIndex++;
        }
        if (retentionIndex > retentionSlots) {
          retentionIndex = 1;
        }
      } else {
        const toKeep = retentionSlots - 1;
        backupsToDelete = existingBackups.slice(0, existingBackups.length - toKeep);
        retentionIndex = backupsToDelete[0]?.retention_index || 1;

        this.logger.debug('Retention - eliminazione vecchi backup', {
          jobId: job.job_id,
          count: backupsToDelete.length
        });
      }

      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hour = String(now.getHours()).padStart(2, '0');
      const minute = String(now.getMinutes()).padStart(2, '0');
      const timestamp = `${year}-${month}-${day}_${hour}_${minute}`;

      const versionFolder = `${jobLabel}_${mode}_${retentionIndex}_${timestamp}`;
      targetPath = path.win32.join(mapping.destination_path, versionFolder);

      if (backupsToDelete.length > 0) {
        for (const backup of backupsToDelete) {
          if (this.isBackupComplete(backup.path)) {
            this.deletePathIfExists(backup.path);
          } else {
            this.logger.warn('Skip eliminazione backup incompleto', { path: backup.path });
          }
        }
      }

      mapping._computed_retention_index = retentionIndex;
      mapping._computed_timestamp = timestamp;

    } else {
      targetPath = mapping.destination_path;
    }

    if (!agentInfo) {
      const error = new Error(`Agent non raggiungibile o non configurato per ${job.client_hostname}`);
      error.code = AgentErrorCodes.AGENT_UNREACHABLE;
      throw error;
    }

    const validationErrors = this.validateMappingBeforeExecution(mapping);
    if (validationErrors.length > 0) {
      const error = new Error(validationErrors.map(e => e.message).join('; '));
      error.code = validationErrors[0].code;
      error.validationErrors = validationErrors;
      throw error;
    }

    try {
      const backupRequest = {
        job_id: job.job_id,
        sources: [mapping.source_path],
        destination: targetPath,
        options: {
          mode,
          job_id: job.job_id,
          credentials: mapping.credentials || null
        }
      };

      const agentUrl = `http://${agentInfo.agent_ip}:${agentInfo.agent_port}`;
      const result = await this.callAgent(agentUrl, '/backup', backupRequest);

      if (result.Success === false || result.success === false) {
        const errorCode = result.ErrorCode || result.errorCode || AgentErrorCodes.UNKNOWN_AGENT_ERROR;
        const errorMessage = result.ErrorMessage || result.errorMessage || result.error || 'Errore sconosciuto';
        const windowsCode = result.WindowsErrorCode || result.windowsErrorCode;
        const affectedPath = result.AffectedPath || result.affectedPath;

        const error = new Error(errorMessage);
        error.code = errorCode;
        error.windowsCode = windowsCode;
        error.affectedPath = affectedPath;
        error.isAgentError = true;

        throw error;
      }

      if (mode === 'copy') {
        this.markBackupComplete(targetPath);
      }

      const stats = result.Stats || result.stats || null;

      return {
        targetPath,
        bytesProcessed: result.BytesProcessed || result.bytesProcessed || result.bytes_processed || 0,
        mode,
        simulated: false,
        stats: stats ? {
          total_files: stats.TotalFiles || stats.total_files || 0,
          copied_files: stats.CopiedFiles || stats.copied_files || 0,
          skipped_files: stats.SkippedFilesCount || stats.skipped_files || 0,
          failed_files: stats.FailedFiles || stats.failed_files || 0
        } : null,
        retention_index: mapping._computed_retention_index || null,
        timestamp: mapping._computed_timestamp || null
      };
    } catch (error) {
      if (error.isAgentError) {
        this.logger.error('Errore backup dall\'agent', {
          hostname: job.client_hostname,
          source: mapping.source_path,
          errorCode: error.code,
          message: error.message
        });

        const userMessage = ErrorMessages[error.code] || error.message;
        const detailMessage = error.windowsCode ? ` (codice Windows: ${error.windowsCode})` : '';
        throw new Error(`Backup fallito: ${userMessage}${detailMessage}`);
      }

      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
        this.logger.error('Agent non raggiungibile', {
          hostname: job.client_hostname,
          connectionError: error.code
        });

        const connError = new Error(`Agent non raggiungibile: ${error.message}`);
        connError.code = AgentErrorCodes.AGENT_UNREACHABLE;
        throw connError;
      }

      if (error.message && error.message.includes('status 500')) {
        const parsed = this.parseAgentErrorFromMessage(error.message);

        this.logger.error('Errore interno agent', {
          hostname: job.client_hostname,
          parsedError: parsed
        });

        throw new Error(`Errore dall'agent: ${parsed.message}`);
      }

      this.logger.error('Errore imprevisto nel backup', {
        hostname: job.client_hostname,
        error: error.message
      });

      throw new Error(`Backup fallito per mapping ${mapping.label || mapping.source_path}: ${error.message}`);
    }
  }

  scanExistingBackups(destinationPath, jobLabel, mode) {
    const existingBackups = [];
    try {
      if (!fs.existsSync(destinationPath)) {
        return existingBackups;
      }

      const items = fs.readdirSync(destinationPath);
      const pattern = new RegExp(`^${jobLabel}_${mode}_(\\d+)_(.+)$`);

      for (const item of items) {
        const fullPath = path.win32.join(destinationPath, item);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory() && pattern.test(item)) {
            const match = item.match(pattern);
            existingBackups.push({
              path: fullPath,
              name: item,
              retention_index: parseInt(match[1]),
              mtime: stat.mtime
            });
          }
        } catch (err) {
        }
      }
    } catch (err) {
      this.logger.warn('Impossibile leggere destination_path per retention', {
        path: destinationPath,
        error: err.message
      });
    }
    return existingBackups;
  }

  isBackupComplete(backupPath) {
    const markerPath = path.join(backupPath, BACKUP_COMPLETE_MARKER);
    return fs.existsSync(markerPath);
  }

  markBackupComplete(backupPath) {
    try {
      const markerPath = path.join(backupPath, BACKUP_COMPLETE_MARKER);
      fs.writeFileSync(markerPath, new Date().toISOString(), 'utf8');
    } catch (err) {
      this.logger.warn('Impossibile creare marker completamento', { path: backupPath, error: err.message });
    }
  }

  validateMappingBeforeExecution(mapping) {
    const errors = [];

    if (mapping.destination_path) {
      const uncRegex = /^\\\\[^\\]+\\[^\\]+/;
      if (mapping.destination_path.startsWith('\\\\') && !uncRegex.test(mapping.destination_path)) {
        errors.push({
          code: AgentErrorCodes.UNC_INVALID_FORMAT,
          field: 'destination_path',
          message: 'Formato UNC non valido. Usa: \\\\server\\share\\path'
        });
      }
    }

    if (mapping.credentials) {
      const username = mapping.credentials.username || '';
      const domain = mapping.credentials.domain || '';

      if (username.includes('\\') && domain) {
        errors.push({
          code: 'CREDENTIALS_FORMAT_ERROR',
          field: 'credentials',
          message: 'Username contiene già il dominio, non specificare domain separatamente'
        });
      }
    }

    return errors;
  }

  parseAgentErrorFromMessage(errorMessage) {
    const codeMatch = errorMessage.match(/codice (\d+)/);
    const pathMatch = errorMessage.match(/percorso ([^\s(]+)/);

    let errorCode = AgentErrorCodes.UNKNOWN_AGENT_ERROR;
    const windowsCode = codeMatch ? parseInt(codeMatch[1]) : null;

    if (windowsCode) {
      if ([53, 64, 67].includes(windowsCode)) {
        errorCode = AgentErrorCodes.NETWORK_PATH_NOT_FOUND;
      } else if (windowsCode === 5) {
        errorCode = AgentErrorCodes.ACCESS_DENIED;
      } else if ([86, 1219, 1326, 2202].includes(windowsCode)) {
        errorCode = AgentErrorCodes.INVALID_CREDENTIALS;
      } else if (windowsCode === 206) {
        errorCode = AgentErrorCodes.PATH_TOO_LONG;
      }
    }

    return {
      windowsCode,
      errorCode,
      affectedPath: pathMatch ? pathMatch[1] : null,
      message: ErrorMessages[errorCode] || errorMessage
    };
  }

  getAgentInfo(hostname) {
    try {
      const heartbeat = this.storage.loadAgentHeartbeat(hostname);
      if (!heartbeat) {
        return null;
      }

      const now = Date.now();
      const lastSeen = new Date(heartbeat.timestamp).getTime();
      const HEARTBEAT_TTL_MS = 2 * 60 * 1000;

      if (heartbeat.status === 'offline' || (now - lastSeen) > HEARTBEAT_TTL_MS) {
        return null;
      }

      return {
        agent_ip: heartbeat.agent_ip,
        agent_port: heartbeat.agent_port || 8081
      };
    } catch (error) {
      this.logger.error('Errore caricamento info agent', { hostname, error: error.message });
      return null;
    }
  }

  async applyRetentionForJob(job, completedRun) {
    if (!job.mappings || job.mappings.length === 0) {
      return;
    }

    for (const mapping of job.mappings) {
      const mode = (mapping.mode || job.mode_default || 'copy').toLowerCase();
      if (mode !== 'copy') {
        continue;
      }

      const maxBackups = Number(mapping.retention?.max_backups || 0);
      const retentionSlots = maxBackups > 0 ? maxBackups : 5;

      const runs = this.storage.loadRunsForJob(job.job_id).filter(r => r.status === 'success');
      const mappingRuns = [];

      runs.forEach(r => {
        (r.mappings || []).forEach(mr => {
          if (mr.mode === 'copy' &&
              mr.source_path === mapping.source_path &&
              mr.destination_path === mapping.destination_path &&
              mr.target_path) {
            mappingRuns.push({
              run: r,
              target_path: mr.target_path,
              started: new Date(r.start),
              simulated: mr.simulated || false
            });
          }
        });
      });

      mappingRuns.sort((a, b) => a.started - b.started);

      if (mappingRuns.length > retentionSlots) {
        const toDelete = mappingRuns.slice(0, mappingRuns.length - retentionSlots);
        const deletedPaths = [];

        toDelete.forEach(entry => {
          if (entry.target_path && !entry.simulated && this.isBackupComplete(entry.target_path)) {
            this.deletePathIfExists(entry.target_path);
            deletedPaths.push(entry.target_path);
          }
        });

        if (deletedPaths.length > 0) {
          const runMapping = completedRun.mappings.find(mr =>
            mr.mode === 'copy' &&
            mr.source_path === mapping.source_path &&
            mr.destination_path === mapping.destination_path
          );

          if (runMapping) {
            runMapping.retention_deleted = deletedPaths;
          }
        }
      }
    }

    this.storage.saveRun(completedRun);
  }

  deletePathIfExists(targetPath) {
    try {
      if (targetPath && fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
        this.logger.debug('Backup eliminato per retention', { path: targetPath });
      }
    } catch (error) {
      this.logger.error('Errore eliminazione backup', { path: targetPath, error: error.message });
    }
  }

  callAgent(agentUrl, endpoint, data) {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint, agentUrl);

      const postData = JSON.stringify(data);

      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = http.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          try {
            const result = JSON.parse(responseData);
            resolve(result);
          } catch (parseError) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              reject(new Error(`Risposta agent non valida: ${parseError.message}`));
            } else {
              reject(new Error(`Agent ha risposto con status ${res.statusCode}: ${responseData}`));
            }
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Errore comunicazione con agent: ${error.message}`));
      });

      req.write(postData);
      req.end();
    });
  }

}

module.exports = JobExecutor;
module.exports.AgentErrorCodes = AgentErrorCodes;
module.exports.ErrorMessages = ErrorMessages;
