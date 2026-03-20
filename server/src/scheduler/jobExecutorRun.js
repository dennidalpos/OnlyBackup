const { v4: uuidv4 } = require('uuid');

async function executeJob(job) {
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

    const mappingStatuses = Array.isArray(run.mappings) ? run.mappings.map((mapping) => mapping.status) : [];
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

    let shouldNotifyEmail = true;
    if (this.alertService) {
      if (run.status === 'failed') {
        const alert = this.alertService.createBackupFailedAlert(run, job);
        shouldNotifyEmail = alert?.isNew ?? true;
      } else if (run.status === 'partial') {
        const alert = this.alertService.createBackupPartialAlert(run, job);
        shouldNotifyEmail = alert?.isNew ?? true;
      } else if (run.status === 'success') {
        this.alertService.resolveBackupAlert(job.client_hostname, job.job_id);
      }
    }

    if (this.emailService && (run.status === 'failed' || run.status === 'partial') && shouldNotifyEmail) {
      this.emailService.notifyBackupStatus(run, job).catch((err) => {
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

    this.storage.saveRun(run);
    this.logger.logJobError(job.job_id, runId, error);
    this.recordJobIssue(job, runId, 'error', 'Job in errore', { message: error.message });
    await this.updateAgentBackupStatus(job.client_hostname, 'failed', job.job_id);

    run.retention_status = { applied: false, reason: 'Job fallito' };
    this.storage.saveRun(run);
    await this.rollbackFailedRun(job, run, error);

    let shouldNotifyEmail = true;
    if (this.alertService) {
      const alert = this.alertService.createBackupFailedAlert(run, job);
      shouldNotifyEmail = alert?.isNew ?? true;
    }

    if (this.emailService && shouldNotifyEmail) {
      this.emailService.notifyBackupStatus(run, job).catch((err) => {
        this.logger.warn('Errore invio notifica email backup', { error: err.message });
      });
    }

    throw error;
  } finally {
    this.runningJobs.delete(job.job_id);
  }
}

async function executeMappingJob(job, run) {
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

  const summaryWarnings = aggregateStats.warnings.map((message) => ({ timestamp: new Date().toISOString(), message }));
  const summaryErrors = aggregateStats.errors.map((message) => ({ timestamp: new Date().toISOString(), message }));

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

module.exports = {
  executeJob,
  executeMappingJob
};
