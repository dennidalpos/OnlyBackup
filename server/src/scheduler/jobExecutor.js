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
const BACKUP_INFO_FILE = 'retention_info.json';

class JobExecutor {
  constructor(storage, logger, config, emailService = null, alertService = null) {
    this.storage = storage;
    this.logger = logger;
    this.config = config;
    this.emailService = emailService;
    this.alertService = alertService;
    this.runningJobs = new Map();
  }

  getRetentionSnapshotKey(mapping) {
    return [mapping.destination_path || '', mapping.source_path || '', mapping.label || '']
      .map(part => part || '')
      .join('::');
  }

  buildRetentionSnapshots(job) {
    const snapshots = {};

    if (!job?.mappings || job.mappings.length === 0) {
      return snapshots;
    }

    for (const mapping of job.mappings) {
      const mode = (mapping.mode || job.mode_default || 'copy').toLowerCase();
      if (mode !== 'copy') {
        continue;
      }

      const maxBackups = Number(mapping.retention?.max_backups || 0);
      const retentionSlots = maxBackups > 0 ? maxBackups : 5;

      const jobLabel = (mapping.label || job.job_id || 'backup')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .substring(0, 50);

      const existingBackups = this.getHistoricalRetentionBackups(job, mapping);
      existingBackups.sort((a, b) => a.mtime - b.mtime);

      snapshots[this.getRetentionSnapshotKey(mapping)] = {
        slots: retentionSlots,
        jobLabel,
        backups: existingBackups
      };
    }

    return snapshots;
  }

  sanitizeSegment(value) {
    return (value || 'unknown').toString().replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  escapeRegExp(value) {
    return (value || '').toString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  saveAgentLog(hostname, jobId, runId, content, mapping = null) {
    if (content === null || content === undefined) {
      return null;
    }

    try {
      const hostDir = path.join(this.storage.dataRoot, 'logs', this.sanitizeSegment(hostname));
      const jobDir = path.join(hostDir, this.sanitizeSegment(jobId));
      fs.mkdirSync(jobDir, { recursive: true });

      const mappingKey = mapping
        ? this.sanitizeSegment(mapping.label || mapping.destination_path || mapping.source_path || `mapping_${Date.now()}`)
        : null;

      const filename = mappingKey ? `${runId || Date.now().toString()}_${mappingKey}.log` : `${runId || Date.now().toString()}.log`;
      const logPath = path.join(jobDir, filename);
      fs.writeFileSync(logPath, content, 'utf8');
      return logPath;
    } catch (error) {
      this.logger?.warn('Salvataggio log agent fallito', { error: error.message, hostname, jobId, runId });
      return null;
    }
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
      warnings: [],
      skipped_files: [],
      simulated: false,
      mode_default: job.mode_default || 'copy',
      schedule: job.schedule || null,
      mappings: [],
      log_path: null,
      run_log_index: null,
      retention_snapshot: null
    };

    this.storage.saveRun(run);
    this.logger.logJobStart(job.job_id, runId, job.client_hostname);

    await this.updateAgentBackupStatus(job.client_hostname, 'in_progress', job.job_id);

    const startTime = Date.now();
    let skipRetentionForCredentials = false;

    try {
      if (job.mappings && job.mappings.length > 0) {
        const result = await this.executeMappingJob(job, run);
        run.bytes_processed = result.bytesProcessed;
        run.target_path = result.lastTargetPath;
        run.simulated = result.simulated;
        run.warnings = result.warnings;
        run.skipped_files = result.skipped_files;
        run.stats = result.stats;
      } else {
        throw new Error('Nessuna mappatura disponibile per il job');
      }

      const mappingStatuses = Array.isArray(run.mappings) ? run.mappings.map(m => m.status) : [];
      const hasFailedMappings = mappingStatuses.includes('failed');
      const hasPartialMappings = mappingStatuses.includes('partial');

      if (mappingStatuses.length > 0) {
        if (hasFailedMappings) {
          run.status = 'failed';
        } else if (hasPartialMappings) {
          run.status = 'partial';
        } else {
          run.status = 'success';
        }
      } else {
        const hasFailures = (run.stats?.failed_files || 0) > 0 || (run.errors?.length || 0) > 0;
        const hasSkippedOrWarnings =
          (run.stats?.skipped_files || 0) > 0 ||
          (run.skipped_files?.length || 0) > 0 ||
          (run.warnings?.length || 0) > 0;
        const hasUpdatesOrCopies =
          (run.stats?.copied_files || 0) > 0 ||
          (run.stats?.updated_files || 0) > 0 ||
          (run.bytes_processed || 0) > 0;

        if (hasFailures) {
          run.status = hasUpdatesOrCopies ? 'partial' : 'failed';
        } else if (hasSkippedOrWarnings && hasUpdatesOrCopies) {
          run.status = 'partial';
        } else {
          run.status = 'success';
        }
      }
      run.end = new Date().toISOString();

      this.storage.saveRun(run);

      const duration = Date.now() - startTime;
      this.logger.logJobEnd(job.job_id, runId, run.status, run.bytes_processed, duration);

      this.recordJobIssue(job, runId, 'info', `Job completato con stato ${run.status}`, {
        stats: run.stats,
        warnings: run.warnings,
        skipped_files: run.skipped_files
      });

      const agentStatus = run.status === 'success' ? 'completed' : run.status === 'partial' ? 'partial' : 'failed';
      await this.updateAgentBackupStatus(job.client_hostname, agentStatus, job.job_id);

      if (['success', 'partial'].includes(run.status)) {
        run.retention_status = { applied: false, reason: 'Gestito dall\'agent' };
      } else {
        run.retention_status = { applied: false, reason: 'Run non riuscito' };
      }

      this.storage.saveRun(run);

      // Gestione alert
      let shouldNotifyEmail = true;
      if (this.alertService) {
        if (run.status === 'failed') {
          const alert = this.alertService.createBackupFailedAlert(run, job);
          shouldNotifyEmail = alert?.isNew ?? true;
        } else if (run.status === 'partial') {
          const alert = this.alertService.createBackupPartialAlert(run, job);
          shouldNotifyEmail = alert?.isNew ?? true;
        } else if (run.status === 'success') {
          // Risolvi eventuali alert precedenti per questo job
          this.alertService.resolveBackupAlert(job.client_hostname, job.job_id);
        }
      }

      if (this.emailService && (run.status === 'failed' || run.status === 'partial') && shouldNotifyEmail) {
        this.emailService.notifyBackupStatus(run, job).catch(err => {
          this.logger.warn('Errore invio notifica email backup', { error: err.message });
        });
      }

      return {
        success: true,
        runId,
        bytesProcessed: run.bytes_processed,
        simulated: run.simulated,
        status: run.status,
        warnings: run.warnings,
        skippedFiles: run.skipped_files
      };
    } catch (error) {
      run.status = 'failed';
      run.end = new Date().toISOString();
      run.errors.push({
        timestamp: new Date().toISOString(),
        message: error.message,
        stack: error.stack
      });

      if (error.code === AgentErrorCodes.ACCESS_DENIED || error.code === AgentErrorCodes.INVALID_CREDENTIALS) {
        skipRetentionForCredentials = true;
      }

      this.storage.saveRun(run);
      this.logger.logJobError(job.job_id, runId, error);

      this.recordJobIssue(job, runId, 'error', 'Job in errore', { message: error.message });
      await this.updateAgentBackupStatus(job.client_hostname, 'failed', job.job_id);

      run.retention_status = { applied: false, reason: 'Job fallito' };
      this.storage.saveRun(run);
      await this.rollbackFailedRun(job, run, error);

      // Crea alert per backup fallito
      let shouldNotifyEmail = true;
      if (this.alertService) {
        const alert = this.alertService.createBackupFailedAlert(run, job);
        shouldNotifyEmail = alert?.isNew ?? true;
      }

      if (this.emailService && shouldNotifyEmail) {
        this.emailService.notifyBackupStatus(run, job).catch(err => {
          this.logger.warn('Errore invio notifica email backup', { error: err.message });
        });
      }

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
    const aggregateStats = {
      total_files: 0,
      copied_files: 0,
      skipped_files: 0,
      failed_files: 0,
      blocked_files_count: 0,
      deleted_files: 0,
      updated_files: 0,
      sync_skipped_files: 0,
      blocked_files: [],
      warnings: [],
      errors: []
    };

    const agentInfo = this.getAgentInfo(job.client_hostname);

    if (!agentInfo) {
      const error = new Error(`Agent non raggiungibile o non configurato per ${job.client_hostname}`);
      error.code = 'AGENT_UNAVAILABLE';
      throw error;
    }

    for (const [index, mapping] of job.mappings.entries()) {
      let result = null;
      let mappingStatus = 'success';

      try {
        result = await this.executeSingleMapping(job, mapping, agentInfo, run, index);
      } catch (error) {
        mappingStatus = 'failed';
        const message = error.message || 'Errore mapping';

        this.recordJobIssue(job, run.run_id, 'error', message, {
          source: mapping.source_path,
          destination: mapping.destination_path,
          errorCode: error.code || 'UNKNOWN'
        });

        result = {
          targetPath: error.attemptedTargetPath || null,
          bytesProcessed: error.bytesProcessed || 0,
          mode: (mapping.mode || job.mode_default || 'copy').toLowerCase(),
          simulated: false,
          stats: {
            total_files: 0,
            copied_files: 0,
            skipped_files: 0,
            blocked_files_count: 0,
            deleted_files: 0,
            updated_files: 0,
            sync_skipped_files: 0,
            failed_files: 1
          },
          log_path: null,
          retention_index: null,
          timestamp: null,
          warnings: [],
          blocked_files: [],
          errors: [message],
          retention_deleted: [],
          retention_cleanup: [],
          retention_summary: null
        };

        run.errors.push({ timestamp: new Date().toISOString(), message });
      }

      totalBytes += result.bytesProcessed;
      lastTargetPath = result.targetPath || lastTargetPath;
      aggregateStats.total_files += result.stats?.total_files || 0;
      aggregateStats.copied_files += result.stats?.copied_files || 0;
      aggregateStats.skipped_files += result.stats?.skipped_files || 0;
      aggregateStats.failed_files += result.stats?.failed_files || 0;
      aggregateStats.blocked_files_count += result.stats?.blocked_files_count || result.stats?.blocked_files || 0;
      aggregateStats.deleted_files += result.stats?.deleted_files || 0;
      aggregateStats.updated_files += result.stats?.updated_files || 0;
      aggregateStats.sync_skipped_files += result.stats?.sync_skipped_files || 0;
      aggregateStats.blocked_files.push(...(result.blocked_files || []));
      aggregateStats.warnings.push(...(result.warnings || []));
      aggregateStats.errors.push(...(result.errors || []));

      const hasMappingErrors = (result.errors?.length || 0) > 0 || (result.stats?.failed_files || 0) > 0;
      const finalStatus = mappingStatus === 'failed' ? 'failed' : hasMappingErrors ? 'partial' : 'success';

      const mappingResult = {
        index,
        label: mapping.label || '',
        source_path: mapping.source_path,
        destination_path: mapping.destination_path,
        target_path: result.targetPath,
        mode: result.mode,
        status: finalStatus,
        bytes_processed: result.bytesProcessed,
        simulated: false,
        warnings: result.warnings || [],
        skipped_files: result.blocked_files || [],
        credentials_used: mapping.credentials ? {
          type: mapping.credentials.type || 'nas',
          username: mapping.credentials.username || '',
          domain: mapping.credentials.domain || ''
        } : null,
        retention_deleted: result.retention_deleted || [],
        stats: result.stats || null,
        retention_index: result.retention_index || null,
        timestamp: result.timestamp || null,
        log_path: result.log_path || run.log_path || null,
        run_log_index: result.run_log_index || run.run_log_index || null,
        errors: result.errors || []
      };

      this.logger.debug('Mapping completato', {
        jobId: job.job_id,
        bytes_processed: result.bytesProcessed,
        has_stats: !!result.stats,
        status: mappingResult.status
      });

      run.mappings.push(mappingResult);
      this.storage.saveRun(run);
    }

    const summaryWarnings = aggregateStats.warnings.map(message => ({ timestamp: new Date().toISOString(), message }));
    const summaryErrors = aggregateStats.errors.map(message => ({ timestamp: new Date().toISOString(), message }));

    run.warnings.push(...summaryWarnings);
    run.errors.push(...summaryErrors);
    run.skipped_files.push(...aggregateStats.blocked_files);

    if (summaryWarnings.length > 0 || aggregateStats.blocked_files.length > 0 || summaryErrors.length > 0) {
      this.recordJobIssue(job, run.run_id, 'warn', 'Job completato con avvisi', {
        warnings: aggregateStats.warnings,
        blocked_files: aggregateStats.blocked_files,
        errors: aggregateStats.errors
      });
    }

    return {
      bytesProcessed: totalBytes,
      lastTargetPath,
      simulated: false,
      warnings: aggregateStats.warnings,
      skipped_files: aggregateStats.blocked_files,
      errors: summaryErrors,
      stats: {
        total_files: aggregateStats.total_files,
        copied_files: aggregateStats.copied_files,
        skipped_files: aggregateStats.skipped_files,
        blocked_files: aggregateStats.blocked_files_count || aggregateStats.blocked_files.length,
        deleted_files: aggregateStats.deleted_files,
        updated_files: aggregateStats.updated_files,
        sync_skipped_files: aggregateStats.sync_skipped_files,
        failed_files: aggregateStats.failed_files
      }
    };
  }

  async executeSingleMapping(job, mapping, agentInfo, run, mappingIndex = null) {
    const mode = (mapping.mode || job.mode_default || 'copy').toLowerCase();

    const runId = run?.run_id || null;

    let targetPath = mapping.destination_path;
    const retentionConfig = {
      max_backups: Number(mapping.retention?.max_backups || 0)
    };

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
      const logPayload = (this.config?.backup?.logPayload || 'tail').toString().toLowerCase();
      const logMaxBytes = Number.isFinite(Number(this.config?.backup?.logTailBytes))
        ? Number(this.config.backup.logTailBytes)
        : Number.isFinite(Number(this.config?.backup?.logMaxBytes))
          ? Number(this.config.backup.logMaxBytes)
          : 131072;

      const backupRequest = {
        job_id: job.job_id,
        sources: [mapping.source_path],
        destination: targetPath,
        options: {
          mode,
          job_id: job.job_id,
          mapping_index: mappingIndex,
          mapping_label: mapping.label || mapping.destination_path || mapping.source_path || '',
          credentials: mapping.credentials || null,
          run_id: run.run_id,
          run_timestamp: run.start,
          retention: retentionConfig,
          max_backups: retentionConfig.max_backups,
          log_payload: logPayload,
          log_max_bytes: logMaxBytes
        }
      };

      const agentUrl = `http://${agentInfo.agent_ip}:${agentInfo.agent_port}`;
      const result = await this.callAgent(agentUrl, '/backup', backupRequest);

      const stats = result?.Stats || result?.stats || null;
      const logContent = result?.LogContent || result?.log_content || null;
      const savedLogPath = this.saveAgentLog(job.client_hostname, job.job_id, run.run_id, logContent, mapping);
      if (savedLogPath && !run.log_path) {
        run.log_path = savedLogPath;
      } else {
        run.log_path = run.log_path || result?.LogPath || result?.log_path || null;
      }
      run.run_log_index = result?.RunLogIndexPath || result?.run_log_index || run.run_log_index;
      const warnings = result?.Warnings || result?.warnings || [];
      const errors = result?.Errors || result?.errors || [];
      const skippedFiles = result?.SkippedFiles || result?.skipped_files || [];
      const blockedFiles =
        result?.BlockedFiles ||
        result?.blocked_files ||
        result?.BlockedFilesPaths ||
        result?.blockedFilesPaths ||
        result?.BlockedItems ||
        result?.blocked_items ||
        skippedFiles ||
        [];
      const statSources = [stats, result];
      const getStatValue = (keys, fallback = 0) => {
        for (const source of statSources) {
          if (!source) continue;
          for (const key of keys) {
            if (source[key] !== undefined) {
              return source[key];
            }
          }
        }
        return fallback;
      };

      const statsSummary = {
        total_files: getStatValue(['TotalFiles', 'total_files'], 0),
        copied_files: getStatValue(['CopiedFiles', 'copied_files'], 0),
        skipped_files: getStatValue(['SkippedFilesCount', 'skipped_files'], blockedFiles?.length || 0),
        blocked_files_count: getStatValue(
          ['BlockedFiles', 'blocked_files', 'BlockedFilesCount', 'blocked_files_count'],
          blockedFiles?.length || 0
        ),
        deleted_files: getStatValue(['DeletedFiles', 'deleted_files', 'SyncDeletedFiles', 'sync_deleted_files'], 0),
        updated_files: getStatValue(['UpdatedFiles', 'updated_files', 'SyncUpdatedFiles', 'sync_updated_files'], 0),
        sync_skipped_files: getStatValue(['SyncSkippedFiles', 'sync_skipped_files'], 0),
        failed_files: getStatValue(['FailedFiles', 'failed_files'], 0)
      };

      statsSummary.blocked_files = statsSummary.blocked_files_count || blockedFiles.length || statsSummary.skipped_files;

      const computedBytes = result?.BytesProcessed || result?.bytesProcessed || result?.bytes_processed || 0;
      const warningMessages = [...(warnings || [])];

      if (statsSummary.skipped_files > 0) {
        warningMessages.push(`File saltati o non copiati: ${statsSummary.skipped_files} da ${mapping.source_path}`);
      }

      if (statsSummary.failed_files > 0) {
        warningMessages.push(`File falliti: ${statsSummary.failed_files} da ${mapping.source_path}`);
      }

      this.logIssuesFromList(job, runId, 'warn', warningMessages, mapping, { mode });

      this.logIssuesFromList(job, runId, 'error', errors, mapping, { mode });

      if (blockedFiles?.length > 0) {
        this.logIssuesFromList(job, runId, 'warn', blockedFiles, mapping, { mode, blocked: true });
      }

      if (result.Success === false || result.success === false) {
        const errorCode = result.ErrorCode || result.errorCode || AgentErrorCodes.UNKNOWN_AGENT_ERROR;
        const errorMessage = result.ErrorMessage || result.errorMessage || result.error || 'Errore sconosciuto';
        const windowsCode = result.WindowsErrorCode || result.windowsErrorCode;
        const affectedPath = result.AffectedPath || result.affectedPath;

        const userMessage = ErrorMessages[errorCode] || errorMessage;
        const detailMessage = windowsCode ? ` (codice Windows: ${windowsCode})` : '';
        const composedMessage = `Backup parziale: ${userMessage}${detailMessage}`;

        this.recordJobIssue(job, run.run_id, 'warn', composedMessage, {
          source: mapping.source_path,
          destination: mapping.destination_path,
          affectedPath,
          errorCode,
          windowsCode,
          stats: statsSummary,
          skippedFilesCount: skippedFiles?.length || 0
        });

        this.logIssuesFromList(job, run.run_id, 'warn', [composedMessage], mapping, { mode, errorCode, windowsCode });

        const partialBytes =
          computedBytes > 0 ||
          statsSummary.copied_files > 0 ||
          statsSummary.updated_files > 0;

        const destinationAccessErrors = [
          AgentErrorCodes.DESTINATION_WRITE_ERROR,
          AgentErrorCodes.ACCESS_DENIED,
          AgentErrorCodes.INVALID_CREDENTIALS,
          AgentErrorCodes.NETWORK_PATH_NOT_FOUND
        ];

        if (destinationAccessErrors.includes(errorCode) && !partialBytes) {
          const accessError = new Error(`Backup fallito: ${userMessage}${detailMessage}`);
          accessError.code = errorCode;
          throw accessError;
        }

        const partialResult = {
          targetPath,
          bytesProcessed: computedBytes,
          mode,
          simulated: false,
          stats: statsSummary,
          log_path: run.log_path,
          retention_index: null,
          timestamp: null,
          warnings: [...warningMessages, composedMessage],
          blocked_files: blockedFiles,
          errors: errors && errors.length > 0 ? errors : [composedMessage],
          retention_deleted: [],
          retention_cleanup: [],
          retention_summary: null
        };

        return partialResult;
      }
      return {
        targetPath,
        bytesProcessed: computedBytes,
        mode,
        simulated: false,
        stats: statsSummary,
        log_path: run.log_path,
        run_log_index: run.run_log_index,
        retention_index: null,
        timestamp: null,
        warnings: warningMessages,
        blocked_files: blockedFiles,
        errors: errors || [],
        retention_deleted: [],
        retention_cleanup: [],
        retention_summary: null
      };
    } catch (error) {
      if (targetPath) {
        error.attemptedTargetPath = targetPath;
      }

      const partialFromDisk = this.tryBuildPartialFromDisk(targetPath, mode, mapping, job, runId, error.message);
      if (partialFromDisk) {
        return partialFromDisk;
      }

      if (error.code === AgentErrorCodes.DESTINATION_WRITE_ERROR ||
          error.code === AgentErrorCodes.ACCESS_DENIED ||
          error.code === AgentErrorCodes.INVALID_CREDENTIALS ||
          error.code === AgentErrorCodes.NETWORK_PATH_NOT_FOUND) {
        error.isAgentError = true;
      }

      if (error.isAgentError) {
        this.logger.error('Errore backup dall\'agent', {
          hostname: job.client_hostname,
          source: mapping.source_path,
          errorCode: error.code,
          message: error.message
        });

        const userMessage = ErrorMessages[error.code] || error.message;
        const detailMessage = error.windowsCode ? ` (codice Windows: ${error.windowsCode})` : '';
        const composedMessage = `Backup fallito: ${userMessage}${detailMessage}`;
        this.recordJobIssue(job, runId, 'error', composedMessage, {
          source: mapping.source_path,
          destination: mapping.destination_path,
          affectedPath: error.affectedPath,
          errorCode: error.code
        });

        if (error.code === AgentErrorCodes.DESTINATION_WRITE_ERROR) {
          const destinationError = new Error('Backup fallito: Impossibile scrivere nella destinazione');
          destinationError.code = error.code;
          throw destinationError;
        }

        const composedError = new Error(composedMessage);
        composedError.code = error.code;
        composedError.windowsCode = error.windowsCode;
        throw composedError;
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

      const unexpectedError = new Error(`Backup fallito per mapping ${mapping.label || mapping.source_path}: ${error.message}`);
      unexpectedError.code = error.code;
      throw unexpectedError;
    }
  }

  scanExistingBackups(destinationPath, jobLabel, mode) {
    const existingBackups = [];
    try {
      const basePath = this.resolveExistingPath(destinationPath);

      if (!basePath) {
        return existingBackups;
      }

      const items = fs.readdirSync(basePath);
      const safeJobLabel = this.escapeRegExp(jobLabel);
      const patterns = [
        new RegExp(`^${safeJobLabel}_.+_s(\\d+)$`),
        new RegExp(`^${safeJobLabel}_.+_s(\\d+)_\\d{4}_\\d{2}_\\d{2}_\\d{2}_\\d{2}_\\d{2}$`),
        new RegExp(`^${safeJobLabel}_.+_v(\\d+)_s(\\d+)_\\d{4}_\\d{2}_\\d{2}_\\d{2}_\\d{2}_\\d{2}$`),
        new RegExp(`^${safeJobLabel}_.+_v(\\d+)_\\d{4}_\\d{2}_\\d{2}_\\d{2}_\\d{2}_\\d{2}$`),
        new RegExp(`^${safeJobLabel}_${mode}_(\\d+)_(.+)$`)
      ];

      for (const item of items) {
        const fullPath = path.join(basePath, item);
        try {
          const stat = fs.statSync(fullPath);
          if (!stat.isDirectory()) {
            continue;
          }

          let matched = false;
          for (let idx = 0; idx < patterns.length; idx++) {
            const pattern = patterns[idx];
            if (pattern.test(item)) {
              const match = item.match(pattern);
              let retentionIndex = null;

              if (idx === 0) {
                retentionIndex = parseInt(match[1]);
              } else if (idx === 1) {
                retentionIndex = parseInt(match[1]);
              } else {
                retentionIndex = parseInt(match[1]);
              }
              existingBackups.push({
                path: fullPath,
                name: item,
                retention_index: retentionIndex,
                mtime: stat.mtime
              });
              matched = true;
              break;
            }
          }

          if (!matched) {
            const infoPath = path.join(fullPath, BACKUP_INFO_FILE);
            if (fs.existsSync(infoPath)) {
              try {
                const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
                if (Number.isFinite(info.retention_index)) {
                  existingBackups.push({
                    path: fullPath,
                    name: item,
                    retention_index: info.retention_index,
                    mtime: stat.mtime
                  });
                }
              } catch (err) {
              }
            }
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

  markBackupComplete(backupPath, info = {}) {
    try {
      const markerPath = path.join(backupPath, BACKUP_COMPLETE_MARKER);
      fs.writeFileSync(markerPath, new Date().toISOString(), 'utf8');
      this.writeBackupInfoFile(backupPath, info);
    } catch (err) {
      this.logger.warn('Impossibile creare marker completamento', { path: backupPath, error: err.message });
    }
  }

  writeBackupInfoFile(backupPath, info = {}) {
    try {
      const payload = {
        created_at: new Date().toISOString(),
        job_id: info.jobId || null,
        run_id: info.runId || null,
        retention_index: info.retentionIndex ?? null,
        retention_slots: info.retentionSlots ?? null,
        source: info.source || null,
        destination: info.destination || null,
        label: info.label || null,
        timestamp: info.timestamp || null
      };

      const infoPath = path.join(backupPath, BACKUP_INFO_FILE);
      fs.writeFileSync(infoPath, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
      this.logger.warn('Impossibile creare file info retention', { path: backupPath, error: err.message });
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

  buildPathVariants(rawPath) {
    const variants = new Set();

    if (!rawPath || typeof rawPath !== 'string') {
      return variants;
    }

    const trimmed = rawPath.trim();
    if (!trimmed) {
      return variants;
    }

    variants.add(trimmed);

    const noTrailing = trimmed.replace(/[\\/]+$/, '');
    if (noTrailing) {
      variants.add(noTrailing);
    }

    const forward = trimmed.replace(/\\/g, '/');
    variants.add(forward);

    const forwardNoTrailing = forward.replace(/\/+$/, '');
    variants.add(forwardNoTrailing);

    if (trimmed.startsWith('\\\\')) {
      const doubleSlash = `//${trimmed.replace(/^\\\\/, '')}`;
      variants.add(doubleSlash);
      variants.add(doubleSlash.replace(/\\/g, '/'));
    }

    try {
      variants.add(path.win32.normalize(trimmed));
      variants.add(path.win32.normalize(forward));
    } catch (err) {
    }

    return variants;
  }

  resolveExistingPath(rawPath) {
    const variants = this.buildPathVariants(rawPath);

    for (const candidate of variants) {
      try {
        if (candidate && fs.existsSync(candidate)) {
          return candidate;
        }
      } catch (err) {
        this.logger.debug('Errore accesso percorso retention', { path: candidate, error: err.message });
      }
    }

    return null;
  }

  getBackupMtime(candidatePath, fallbackDate = new Date()) {
    try {
      if (!candidatePath) {
        return fallbackDate;
      }

      const resolved = this.resolveExistingPath(candidatePath) || candidatePath;
      const stat = fs.statSync(resolved);
      return stat.mtime;
    } catch (err) {
      return fallbackDate;
    }
  }

  async applyRetentionForJob(job, completedRun) {
    if (!completedRun || !['success', 'partial'].includes(completedRun.status)) {
      this.logger.debug('Retention non applicata: run non completato con successo o parziale', {
        jobId: job.job_id,
        status: completedRun ? completedRun.status : 'unknown'
      });
      completedRun.retention_status = { applied: false, reason: 'Run non riuscito' };
      this.storage.saveRun(completedRun);
      return;
    }

    if (!job.mappings || job.mappings.length === 0) {
      return;
    }

    const agentInfo = this.getAgentInfo(job.client_hostname);
    const retentionSnapshots = completedRun.retention_snapshot || this.buildRetentionSnapshots(job);

    for (const mapping of job.mappings) {
      const mode = (mapping.mode || job.mode_default || 'copy').toLowerCase();
      if (mode !== 'copy') {
        continue;
      }

      const snapshotKey = this.getRetentionSnapshotKey(mapping);
      const snapshot = retentionSnapshots?.[snapshotKey] || {};
      const maxBackups = Number(mapping.retention?.max_backups || 0);
      const retentionSlots = snapshot.slots || (maxBackups > 0 ? maxBackups : 5);

      const existingBackups = Array.isArray(snapshot.backups) ? [...snapshot.backups] : [];
      const backupsAtStart = existingBackups.length;

      const runMapping = (completedRun.mappings || []).find(mr =>
        mr.mode === 'copy' &&
        mr.source_path === mapping.source_path &&
        mr.destination_path === mapping.destination_path
      );

      const newBackupEntry = runMapping?.target_path
        ? {
            path: runMapping.target_path,
            mtime: this.getBackupMtime(runMapping.target_path, completedRun.end || new Date()),
            retention_index: runMapping.retention_index || null
          }
        : null;

      if (runMapping) {
        runMapping.retention_deleted = [];
        runMapping.retention_cleanup = [];
        runMapping.retention_summary = {
          slots: retentionSlots,
          found_before_start: backupsAtStart,
          existing_before: 0,
          deleted: 0,
          existing_after: 0,
          backups_before: [],
          backups_after: [],
          skipped_incomplete: 0
        };
      }
    }

    this.storage.saveRun(completedRun);
  }

  async rollbackFailedRun(job, run, error = null) {
    const agentInfo = this.getAgentInfo(job.client_hostname);
    const targetPaths = new Set();

    (run.mappings || []).forEach(m => {
      if (m.mode === 'copy' && m.target_path) {
        targetPaths.add(m.target_path);
      }
    });

    if (error?.attemptedTargetPath) {
      targetPaths.add(error.attemptedTargetPath);
    }

    const paths = Array.from(targetPaths)
      .map(p => this.resolveExistingPath(p) || p)
      .filter(Boolean);

    if (paths.length === 0) {
      return;
    }

    if (!agentInfo) {
      this.logger?.warn('Rollback non eseguito: agent non disponibile', { jobId: job.job_id, paths });
      return;
    }

    try {
      const agentUrl = `http://${agentInfo.agent_ip}:${agentInfo.agent_port || 8081}`;
      await this.callAgent(agentUrl, '/filesystem/delete', { paths });
      this.logger?.info('Rollback completato: cartelle del tentativo fallito rimosse', { jobId: job.job_id, paths });
    } catch (rollbackError) {
      this.logger?.warn('Rollback non riuscito per cartelle del tentativo fallito', {
        jobId: job.job_id,
        error: rollbackError.message,
        paths
      });
    }
  }

  async cleanupBackupsForRetention(backupsToDelete, options = {}) {
    const { agentInfo = null } = options;

    if (!backupsToDelete.length) {
      return [];
    }

    if (!agentInfo) {
      this.logger?.warn('Impossibile applicare retention: agent non disponibile per il client');
      return backupsToDelete.map(backup => ({
        path: backup.path,
        status: 'skipped_agent_unavailable',
        complete: backup.complete ?? backup.isComplete ?? null
      }));
    }

    try {
      const agentUrl = `http://${agentInfo.agent_ip}:${agentInfo.agent_port || 8081}`;
      const paths = backupsToDelete.map(b => this.resolveExistingPath(b.path) || b.path);
      const response = await this.callAgent(agentUrl, '/filesystem/delete', { paths });

      if (response && Array.isArray(response.results)) {
        return response.results.map((r, idx) => {
          const backup = backupsToDelete[idx] || {};
          const resolvedPath = this.resolveExistingPath(backup.path) || r.path || backup.path;

          let status = r.status || (r.success ? 'deleted' : 'error');
          let warning = r.warning || null;
          let error = r.error || null;

          try {
            const existsAfter = resolvedPath ? fs.existsSync(resolvedPath) : false;

            if (status === 'deleted' && existsAfter) {
              status = 'delete_verification_failed';
              warning = warning || 'Percorso ancora presente dopo cancellazione';
            } else if (status !== 'deleted' && !existsAfter) {
              status = 'deleted';
              warning = warning || 'Percorso già assente durante la cancellazione';
            }
          } catch (verifyErr) {
            warning = warning || `Verifica cancellazione non riuscita: ${verifyErr.message}`;
          }

          return {
            path: backup.path || r.path,
            status,
            complete: backup.complete ?? backup.isComplete ?? null,
            warning,
            error
          };
        });
      }

      this.logger?.warn('Risposta non valida dal servizio di cancellazione dell\'agent', { response });
    } catch (error) {
      this.logger?.warn('Pulizia retention via agent fallita', {
        error: error.message
      });
    }

    return backupsToDelete.map(backup => ({
      path: backup.path,
      status: 'skipped_agent_error',
      complete: backup.complete ?? backup.isComplete ?? null
    }));
  }

  computeLocalBackupStats(targetPath) {
    if (!targetPath || !fs.existsSync(targetPath)) {
      return null;
    }

    const queue = [targetPath];
    const summary = {
      total_files: 0,
      copied_files: 0,
      skipped_files: 0,
      failed_files: 0,
      blocked_files_count: 0,
      deleted_files: 0,
      updated_files: 0,
      sync_skipped_files: 0,
      bytes: 0
    };

    while (queue.length > 0) {
      const currentPath = queue.pop();

      let entries = [];
      try {
        entries = fs.readdirSync(currentPath, { withFileTypes: true });
      } catch (err) {
        continue;
      }

      for (const entry of entries) {
        if (entry.name === BACKUP_COMPLETE_MARKER || entry.name === BACKUP_INFO_FILE) {
          continue;
        }

        const fullPath = path.join(currentPath, entry.name);

        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            queue.push(fullPath);
          } else if (stat.isFile()) {
            summary.total_files += 1;
            summary.copied_files += 1;
            summary.bytes += stat.size;
          }
        } catch (err) {
          summary.failed_files += 1;
        }
      }
    }

    return summary.total_files > 0 || summary.bytes > 0 ? summary : null;
  }

  tryBuildPartialFromDisk(targetPath, mode, mapping, job, runId, errorMessage) {
    const stats = this.computeLocalBackupStats(targetPath);
    if (!stats) {
      return null;
    }

    const partialMessage = `Backup parziale: ${errorMessage}`;

    this.recordJobIssue(job, runId, 'warn', partialMessage, {
      source: mapping.source_path,
      destination: mapping.destination_path,
      bytesProcessed: stats.bytes,
      totalFiles: stats.total_files
    });

    if (mode === 'copy') {
      const configuredSlots = Number(mapping.retention?.max_backups || 0);
      this.markBackupComplete(targetPath, {
        jobId: job.job_id,
        runId,
        retentionIndex: mapping._computed_retention_index || null,
        retentionSlots: configuredSlots > 0 ? configuredSlots : null,
        source: mapping.source_path,
        destination: mapping.destination_path,
        label: mapping.label || job.job_id,
        timestamp: mapping._computed_timestamp
      });
    }

    return {
      targetPath,
      bytesProcessed: stats.bytes,
      mode,
      simulated: false,
      stats: {
        total_files: stats.total_files,
        copied_files: stats.copied_files,
        skipped_files: stats.skipped_files,
        blocked_files: stats.blocked_files_count,
        deleted_files: stats.deleted_files,
        updated_files: stats.updated_files,
        sync_skipped_files: stats.sync_skipped_files,
        failed_files: stats.failed_files
      },
      retention_index: mapping._computed_retention_index || null,
      timestamp: mapping._computed_timestamp || null,
      warnings: [partialMessage],
      blocked_files: [],
      errors: [partialMessage]
    };
  }

  getHistoricalRetentionBackups(job, mapping) {
    const runs = this.storage.loadRunsForJob(job.job_id) || [];
    const results = [];

    runs
      .filter(
        r =>
          r &&
          (r.status === 'success' ||
           r.status === 'partial' ||
           ((r.mappings || []).some(mr => mr.mode === 'copy' && mr.target_path)))
      )
      .forEach(r => {
        (r.mappings || []).forEach(mr => {
          if (
            mr.mode === 'copy' &&
            mr.source_path === mapping.source_path &&
            mr.destination_path === mapping.destination_path &&
            mr.target_path &&
            Number.isFinite(mr.retention_index)
          ) {
            try {
              const stats = fs.statSync(mr.target_path);
              if (stats.isDirectory()) {
                results.push({
                  path: mr.target_path,
                  name: path.basename(mr.target_path),
                  retention_index: mr.retention_index,
                  mtime: stats.mtime
                });
              }
            } catch (err) {
              const fallbackMtime = r?.start ? new Date(r.start) : new Date();

              this.logger?.debug('Retention - backup storico mancante, uso fallback', {
                path: mr.target_path,
                error: err.message,
                fallbackMtime
              });

              results.push({
                path: mr.target_path,
                name: path.basename(mr.target_path),
                retention_index: mr.retention_index,
                mtime: fallbackMtime
              });
            }
          }
        });
      });

    return results;
  }

  recordJobIssue(job, runId, level, message, meta = {}) {
    const jobName = job.name || job.label || job.job_id;
    if (this.logger && typeof this.logger.logJobIssue === 'function') {
      this.logger.logJobIssue(job.job_id, jobName, runId, level, message, meta);
    }
  }

  logIssuesFromList(job, runId, level, messages, mapping = null, extraMeta = {}) {
    if (!messages || messages.length === 0) {
      return;
    }

    const cleanMessages = messages.filter(Boolean);

    for (const message of cleanMessages) {
      this.recordJobIssue(job, runId, level, message, {
        source: mapping?.source_path,
        destination: mapping?.destination_path,
        ...extraMeta
      });
    }
  }

  async updateAgentBackupStatus(hostname, status, jobId) {
    try {
      if (!hostname) {
        return;
      }

      const existing = this.storage.loadAgentHeartbeat(hostname) || {};
      const now = new Date().toISOString();

      const heartbeat = {
        hostname,
        status: existing.status || 'online',
        timestamp: now,
        agent_ip: existing.agent_ip || null,
        agent_port: existing.agent_port || null,
        backup_status: status,
        backup_job_id: jobId,
        backup_status_timestamp: now
      };

      this.storage.saveAgentHeartbeat(heartbeat);
    } catch (error) {
      this.logger.error('Impossibile aggiornare stato backup agent', { hostname, error: error.message });
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
