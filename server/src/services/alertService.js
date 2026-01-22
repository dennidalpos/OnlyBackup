const { v4: uuidv4 } = require('uuid');
const eventBus = require('../events/eventBus');

class AlertService {
  constructor(storage, logger) {
    this.storage = storage;
    this.logger = logger;
  }

  createAlert({ type, severity, title, message, hostname, jobId, runId, key }) {
    // Check if alert with same key already exists and is active
    if (key) {
      const existingAlert = this.storage.findAlertByKey(type, key);
      if (existingAlert) {
        this.logger.debug('Alert già esistente', { type, key });
        return { ...existingAlert, isNew: false };
      }
    }

    const alert = {
      alert_id: uuidv4(),
      type,
      severity,
      title,
      message,
      hostname,
      job_id: jobId || null,
      run_id: runId || null,
      key: key || null,
      timestamp: new Date().toISOString(),
      resolved: false,
      resolved_timestamp: null
    };

    this.storage.saveAlert(alert);
    this.logger.info('Alert creato', { alertId: alert.alert_id, type, severity, hostname });

    // Emit event via SSE
    eventBus.emitAlertCreated(alert);

    return { ...alert, isNew: true };
  }

  resolveAlert(alertId) {
    const result = this.storage.resolveAlert(alertId);
    if (result) {
      this.logger.info('Alert risolto', { alertId });
      const alert = this.storage.loadAlert(alertId);
      eventBus.emitAlertResolved(alert);
    }
    return result;
  }

  resolveAlertByKey(type, key) {
    const alert = this.storage.findAlertByKey(type, key);
    if (alert && !alert.resolved) {
      return this.resolveAlert(alert.alert_id);
    }
    return false;
  }

  getActiveAlerts() {
    return this.storage.loadAllAlerts(true);
  }

  getAllAlerts() {
    return this.storage.loadAllAlerts(false);
  }

  getAlertById(alertId) {
    return this.storage.loadAlert(alertId);
  }

  deleteAlert(alertId) {
    const result = this.storage.deleteAlert(alertId);
    if (result) {
      this.logger.info('Alert eliminato', { alertId });
    }
    return result;
  }

  deleteAllAlerts() {
    const deletedCount = this.storage.deleteAllAlerts();
    this.logger.info('Storico alert eliminato', { count: deletedCount });
    return deletedCount;
  }

  // Helper methods for common alert types
  createBackupFailedAlert(run, job) {
    const key = `backup_failed_${job.client_hostname}_${job.job_id}`;
    return this.createAlert({
      type: 'backup_failed',
      severity: 'error',
      title: `Backup fallito: ${job.client_hostname}`,
      message: `Il job "${job.label || job.job_id}" è fallito`,
      hostname: job.client_hostname,
      jobId: job.job_id,
      runId: run.run_id,
      key
    });
  }

  createBackupPartialAlert(run, job) {
    const key = `backup_partial_${job.client_hostname}_${job.job_id}`;
    return this.createAlert({
      type: 'backup_partial',
      severity: 'warning',
      title: `Backup parziale: ${job.client_hostname}`,
      message: `Il job "${job.label || job.job_id}" è stato completato parzialmente`,
      hostname: job.client_hostname,
      jobId: job.job_id,
      runId: run.run_id,
      key
    });
  }

  resolveBackupAlert(hostname, jobId) {
    const failedKey = `backup_failed_${hostname}_${jobId}`;
    const partialKey = `backup_partial_${hostname}_${jobId}`;

    this.resolveAlertByKey('backup_failed', failedKey);
    this.resolveAlertByKey('backup_partial', partialKey);
  }

  createAgentOfflineAlert(hostname, jobs = []) {
    const key = `agent_offline_${hostname}`;
    const jobList = jobs.length > 0 ? ` (${jobs.length} job attivi)` : '';

    return this.createAlert({
      type: 'agent_offline',
      severity: 'error',
      title: `Agent offline: ${hostname}`,
      message: `L'agent non risponde da più di 2 minuti${jobList}`,
      hostname,
      key
    });
  }

  resolveAgentOfflineAlert(hostname) {
    const key = `agent_offline_${hostname}`;
    return this.resolveAlertByKey('agent_offline', key);
  }
}

module.exports = AlertService;
