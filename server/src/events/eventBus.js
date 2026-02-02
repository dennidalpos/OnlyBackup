const EventEmitter = require('events');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100); // Per molti SSE clients
  }

  // Helper methods
  emitClientStatusChanged(hostname, status, timestamp) {
    this.emit('client_status_changed', { hostname, status, timestamp });
  }

  emitBackupStarted(hostname, jobId, runId, startTime) {
    this.emit('backup_started', {
      hostname,
      job_id: jobId,
      run_id: runId,
      start_time: startTime
    });
  }

  emitBackupCompleted(runId, status, stats, duration) {
    this.emit('backup_completed', {
      run_id: runId,
      status,
      stats,
      duration
    });
  }

  emitStatsUpdated(stats) {
    this.emit('stats_updated', stats);
  }

  emitJobCreated(job) {
    this.emit('job_created', job);
  }

  emitJobUpdated(jobId, changes) {
    this.emit('job_updated', { job_id: jobId, changes });
  }

  emitJobDeleted(jobId) {
    this.emit('job_deleted', { job_id: jobId });
  }

  emitAlertCreated(alert) {
    this.emit('alert_created', alert);
  }

  emitAlertResolved(alert) {
    this.emit('alert_resolved', alert);
  }
}

module.exports = new EventBus();
