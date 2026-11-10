const fs = require('fs');
const path = require('path');
const agentHelpers = require('./jobExecutorAgent');
const runHelpers = require('./jobExecutorRun');
const retentionHelpers = require('./jobExecutorRetention');
const { sanitizePathSegment } = require('../shared/pathSegments');

const {
  AgentErrorCodes,
  ErrorMessages
} = agentHelpers;

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
    return sanitizePathSegment(value, 'unknown');
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

  async executeJob(job) { return runHelpers.executeJob.call(this, job); }

  extractFolderNameFromPath(sourcePath) {
    if (!sourcePath) return 'backup';

    const normalizedPath = sourcePath.replace(/\\/g, '/').replace(/\/+$/, '');
    const parts = normalizedPath.split('/');
    const folderName = parts[parts.length - 1] || 'backup';

    return folderName.replace(/[^a-zA-Z0-9_-]/g, '_');
  }


  async executeMappingJob(job, run) { return runHelpers.executeMappingJob.call(this, job, run); }

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

  scanExistingBackups(destinationPath, jobLabel, mode) { return retentionHelpers.scanExistingBackups.call(this, destinationPath, jobLabel, mode); }

  isBackupComplete(backupPath) { return retentionHelpers.isBackupComplete.call(this, backupPath); }

  markBackupComplete(backupPath, info = {}) { return retentionHelpers.markBackupComplete.call(this, backupPath, info); }

  writeBackupInfoFile(backupPath, info = {}) { return retentionHelpers.writeBackupInfoFile.call(this, backupPath, info); }

  validateMappingBeforeExecution(mapping) { return agentHelpers.validateMappingBeforeExecution.call(this, mapping); }

  parseAgentErrorFromMessage(errorMessage) { return agentHelpers.parseAgentErrorFromMessage.call(this, errorMessage); }

  getAgentInfo(hostname) { return agentHelpers.getAgentInfo.call(this, hostname); }

  buildPathVariants(rawPath) { return retentionHelpers.buildPathVariants.call(this, rawPath); }

  resolveExistingPath(rawPath) { return retentionHelpers.resolveExistingPath.call(this, rawPath); }

  getBackupMtime(candidatePath, fallbackDate = new Date()) { return retentionHelpers.getBackupMtime.call(this, candidatePath, fallbackDate); }

  async applyRetentionForJob(job, completedRun) { return retentionHelpers.applyRetentionForJob.call(this, job, completedRun); }

  async rollbackFailedRun(job, run, error = null) { return retentionHelpers.rollbackFailedRun.call(this, job, run, error); }

  async cleanupBackupsForRetention(backupsToDelete, options = {}) { return retentionHelpers.cleanupBackupsForRetention.call(this, backupsToDelete, options); }

  computeLocalBackupStats(targetPath) { return agentHelpers.computeLocalBackupStats.call(this, targetPath); }

  tryBuildPartialFromDisk(targetPath, mode, mapping, job, runId, errorMessage) { return agentHelpers.tryBuildPartialFromDisk.call(this, targetPath, mode, mapping, job, runId, errorMessage); }

  getHistoricalRetentionBackups(job, mapping) { return retentionHelpers.getHistoricalRetentionBackups.call(this, job, mapping); }

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

  async updateAgentBackupStatus(hostname, status, jobId) { return agentHelpers.updateAgentBackupStatus.call(this, hostname, status, jobId); }

  callAgent(agentUrl, endpoint, data) { return agentHelpers.callAgent.call(this, agentUrl, endpoint, data); }

}

module.exports = JobExecutor;
module.exports.AgentErrorCodes = AgentErrorCodes;
module.exports.ErrorMessages = ErrorMessages;
