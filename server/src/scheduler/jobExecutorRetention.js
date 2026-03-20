const fs = require('fs');
const path = require('path');

const BACKUP_COMPLETE_MARKER = '.backup_complete';
const BACKUP_INFO_FILE = 'retention_info.json';

function scanExistingBackups(destinationPath, jobLabel, mode) {
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
        for (let idx = 0; idx < patterns.length; idx += 1) {
          const pattern = patterns[idx];
          if (pattern.test(item)) {
            const match = item.match(pattern);
            existingBackups.push({
              path: fullPath,
              name: item,
              retention_index: parseInt(match[1], 10),
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

function isBackupComplete(backupPath) {
  return fs.existsSync(path.join(backupPath, BACKUP_COMPLETE_MARKER));
}

function markBackupComplete(backupPath, info = {}) {
  try {
    fs.writeFileSync(path.join(backupPath, BACKUP_COMPLETE_MARKER), new Date().toISOString(), 'utf8');
    this.writeBackupInfoFile(backupPath, info);
  } catch (err) {
    this.logger.warn('Impossibile creare marker completamento', { path: backupPath, error: err.message });
  }
}

function writeBackupInfoFile(backupPath, info = {}) {
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

    fs.writeFileSync(path.join(backupPath, BACKUP_INFO_FILE), JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    this.logger.warn('Impossibile creare file info retention', { path: backupPath, error: err.message });
  }
}

function buildPathVariants(rawPath) {
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
  variants.add(forward.replace(/\/+$/, ''));

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

function resolveExistingPath(rawPath) {
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

function getBackupMtime(candidatePath, fallbackDate = new Date()) {
  try {
    if (!candidatePath) {
      return fallbackDate;
    }

    const resolved = this.resolveExistingPath(candidatePath) || candidatePath;
    return fs.statSync(resolved).mtime;
  } catch (err) {
    return fallbackDate;
  }
}

async function applyRetentionForJob(job, completedRun) {
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

    const runMapping = (completedRun.mappings || []).find((candidate) =>
      candidate.mode === 'copy' &&
      candidate.source_path === mapping.source_path &&
      candidate.destination_path === mapping.destination_path
    );

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

async function rollbackFailedRun(job, run, error = null) {
  const agentInfo = this.getAgentInfo(job.client_hostname);
  const targetPaths = new Set();

  (run.mappings || []).forEach((mapping) => {
    if (mapping.mode === 'copy' && mapping.target_path) {
      targetPaths.add(mapping.target_path);
    }
  });

  if (error?.attemptedTargetPath) {
    targetPaths.add(error.attemptedTargetPath);
  }

  const paths = Array.from(targetPaths)
    .map((entry) => this.resolveExistingPath(entry) || entry)
    .filter(Boolean);

  if (paths.length === 0 || !agentInfo) {
    if (paths.length > 0) {
      this.logger?.warn('Rollback non eseguito: agent non disponibile', { jobId: job.job_id, paths });
    }
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

async function cleanupBackupsForRetention(backupsToDelete, options = {}) {
  const { agentInfo = null } = options;

  if (!backupsToDelete.length) {
    return [];
  }

  if (!agentInfo) {
    this.logger?.warn('Impossibile applicare retention: agent non disponibile per il client');
    return backupsToDelete.map((backup) => ({
      path: backup.path,
      status: 'skipped_agent_unavailable',
      complete: backup.complete ?? backup.isComplete ?? null
    }));
  }

  try {
    const agentUrl = `http://${agentInfo.agent_ip}:${agentInfo.agent_port || 8081}`;
    const paths = backupsToDelete.map((backup) => this.resolveExistingPath(backup.path) || backup.path);
    const response = await this.callAgent(agentUrl, '/filesystem/delete', { paths });

    if (response && Array.isArray(response.results)) {
      return response.results.map((result, index) => {
        const backup = backupsToDelete[index] || {};
        const resolvedPath = this.resolveExistingPath(backup.path) || result.path || backup.path;
        let status = result.status || (result.success ? 'deleted' : 'error');
        let warning = result.warning || null;
        let error = result.error || null;

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
          path: backup.path || result.path,
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

  return backupsToDelete.map((backup) => ({
    path: backup.path,
    status: 'skipped_agent_error',
    complete: backup.complete ?? backup.isComplete ?? null
  }));
}

function getHistoricalRetentionBackups(job, mapping) {
  const runs = this.storage.loadRunsForJob(job.job_id) || [];
  const results = [];

  runs
    .filter(
      (run) =>
        run &&
        (run.status === 'success' ||
         run.status === 'partial' ||
         ((run.mappings || []).some((runMapping) => runMapping.mode === 'copy' && runMapping.target_path)))
    )
    .forEach((run) => {
      (run.mappings || []).forEach((runMapping) => {
        if (
          runMapping.mode === 'copy' &&
          runMapping.source_path === mapping.source_path &&
          runMapping.destination_path === mapping.destination_path &&
          runMapping.target_path &&
          Number.isFinite(runMapping.retention_index)
        ) {
          try {
            const stats = fs.statSync(runMapping.target_path);
            if (stats.isDirectory()) {
              results.push({
                path: runMapping.target_path,
                name: path.basename(runMapping.target_path),
                retention_index: runMapping.retention_index,
                mtime: stats.mtime
              });
            }
          } catch (err) {
            const fallbackMtime = run?.start ? new Date(run.start) : new Date();

            this.logger?.debug('Retention - backup storico mancante, uso fallback', {
              path: runMapping.target_path,
              error: err.message,
              fallbackMtime
            });

            results.push({
              path: runMapping.target_path,
              name: path.basename(runMapping.target_path),
              retention_index: runMapping.retention_index,
              mtime: fallbackMtime
            });
          }
        }
      });
    });

  return results;
}

module.exports = {
  applyRetentionForJob,
  buildPathVariants,
  cleanupBackupsForRetention,
  getBackupMtime,
  getHistoricalRetentionBackups,
  isBackupComplete,
  markBackupComplete,
  resolveExistingPath,
  rollbackFailedRun,
  scanExistingBackups,
  writeBackupInfoFile
};
