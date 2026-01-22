const fs = require('fs');
const path = require('path');
const cacheManager = require('./cacheManager');
const eventBus = require('../events/eventBus');

class Storage {
  constructor(dataRoot, logger) {
    this.dataRoot = dataRoot;
    this.logger = logger;
    this.runsIndexPath = path.join(this.dataRoot, 'state', 'runs', 'index.json');
    this.ensureDirectories();
    this.setupCacheInvalidation();
  }

  setupCacheInvalidation() {
    // Invalidate cache on data changes
    eventBus.on('job_created', () => cacheManager.invalidate('all_jobs'));
    eventBus.on('job_updated', () => cacheManager.invalidate('all_jobs'));
    eventBus.on('job_deleted', () => cacheManager.invalidate('all_jobs'));

    eventBus.on('backup_completed', () => {
      cacheManager.invalidate('all_runs');
    });
  }

  ensureDirectories() {
    const dirs = [
      this.dataRoot,
      path.join(this.dataRoot, 'config'),
      path.join(this.dataRoot, 'state'),
      path.join(this.dataRoot, 'state', 'jobs'),
      path.join(this.dataRoot, 'state', 'runs'),
      path.join(this.dataRoot, 'state', 'agents'),
      path.join(this.dataRoot, 'state', 'scheduler'),
      path.join(this.dataRoot, 'state', 'alerts'),
      path.join(this.dataRoot, 'users'),
      path.join(this.dataRoot, 'logs')
    ];

    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  loadJob(jobId) {
    const jobPath = path.join(this.dataRoot, 'state', 'jobs', `${jobId}.json`);
    try {
      if (!fs.existsSync(jobPath)) {
        return null;
      }
      const data = fs.readFileSync(jobPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      this.logger.logInvalidConfig('job', jobPath, error);
      return null;
    }
  }

  saveJob(job) {
    const jobPath = path.join(this.dataRoot, 'state', 'jobs', `${job.job_id}.json`);
    try {
      const isNew = !fs.existsSync(jobPath);
      fs.writeFileSync(jobPath, JSON.stringify(job, null, 2), 'utf8');

      // Invalidate cache
      cacheManager.invalidate('all_jobs');

      // Emit event
      if (isNew) {
        eventBus.emitJobCreated(job);
      } else {
        eventBus.emitJobUpdated(job.job_id, job);
      }

      return true;
    } catch (error) {
      this.logger.error('Errore salvataggio job', { jobId: job.job_id, error: error.message });
      return false;
    }
  }

  deleteJob(jobId) {
    const jobPath = path.join(this.dataRoot, 'state', 'jobs', `${jobId}.json`);
    try {
      if (fs.existsSync(jobPath)) {
        fs.unlinkSync(jobPath);
      }

      // Invalidate cache
      cacheManager.invalidate('all_jobs');

      // Emit event
      eventBus.emitJobDeleted(jobId);

      return true;
    } catch (error) {
      this.logger.error('Errore eliminazione job', { jobId, error: error.message });
      return false;
    }
  }

  loadAllJobs() {
    // Check cache
    const cached = cacheManager.get('all_jobs');
    if (cached) {
      return cached;
    }

    const jobsDir = path.join(this.dataRoot, 'state', 'jobs');
    const jobs = [];

    try {
      if (!fs.existsSync(jobsDir)) {
        return jobs;
      }

      const files = fs.readdirSync(jobsDir);
      for (const file of files) {
        if (path.extname(file) === '.json') {
          const jobId = path.basename(file, '.json');
          const job = this.loadJob(jobId);
          if (job) {
            jobs.push(job);
          }
        }
      }
    } catch (error) {
      this.logger.error('Errore caricamento jobs', { error: error.message });
    }

    // Cache indefinitamente (invalidato on change)
    cacheManager.set('all_jobs', jobs);

    return jobs;
  }

  loadRun(runId) {
    const runPath = path.join(this.dataRoot, 'state', 'runs', `${runId}.json`);
    try {
      if (!fs.existsSync(runPath)) {
        return null;
      }
      const data = fs.readFileSync(runPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      this.logger.logInvalidConfig('run', runPath, error);
      return null;
    }
  }

  saveRun(run) {
    const runPath = path.join(this.dataRoot, 'state', 'runs', `${run.run_id}.json`);
    try {
      fs.writeFileSync(runPath, JSON.stringify(run, null, 2), 'utf8');
      this.updateRunsIndex(run);

      // Invalidate cache
      cacheManager.invalidate('all_runs');

      // Emit event se completato
      if (run.status && run.status !== 'running') {
        const endTime = run.end || run.end_time || null;
        const startTime = run.start || run.start_time || null;
        const duration = endTime && startTime
          ? new Date(endTime).getTime() - new Date(startTime).getTime()
          : null;
        eventBus.emitBackupCompleted(run.run_id, run.status, run.stats, duration);
      }

      return true;
    } catch (error) {
      this.logger.error('Errore salvataggio run', { runId: run.run_id, error: error.message });
      return false;
    }
  }

  loadRunsIndex() {
    try {
      if (!fs.existsSync(this.runsIndexPath)) {
        return { runs: [] };
      }
      const data = fs.readFileSync(this.runsIndexPath, 'utf8');
      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed.runs)) {
        return { runs: [] };
      }
      return parsed;
    } catch (error) {
      this.logger.warn('Indice run non valido, ricostruzione necessaria', { error: error.message });
      return { runs: [] };
    }
  }

  saveRunsIndex(index) {
    try {
      fs.writeFileSync(this.runsIndexPath, JSON.stringify(index, null, 2), 'utf8');
      return true;
    } catch (error) {
      this.logger.error('Errore salvataggio indice run', { error: error.message });
      return false;
    }
  }

  updateRunsIndex(run) {
    if (!run || !run.run_id) {
      return false;
    }

    const index = this.loadRunsIndex();
    const runs = Array.isArray(index.runs) ? index.runs : [];
    const existingIndex = runs.findIndex(r => r.run_id === run.run_id);

    if (existingIndex >= 0) {
      runs[existingIndex] = run;
    } else {
      runs.push(run);
    }

    return this.saveRunsIndex({ runs });
  }

  rebuildRunsIndex() {
    const runsDir = path.join(this.dataRoot, 'state', 'runs');
    const runs = [];

    try {
      if (!fs.existsSync(runsDir)) {
        this.saveRunsIndex({ runs: [] });
        return [];
      }

      const files = fs.readdirSync(runsDir);
      for (const file of files) {
        if (path.extname(file) === '.json' && file !== path.basename(this.runsIndexPath)) {
          const runId = path.basename(file, '.json');
          const run = this.loadRun(runId);
          if (run) {
            runs.push(run);
          }
        }
      }
    } catch (error) {
      this.logger.error('Errore ricostruzione indice run', { error: error.message });
    }

    this.saveRunsIndex({ runs });
    return runs;
  }

  loadAllRuns() {
    // Check cache
    const cached = cacheManager.get('all_runs');
    if (cached) {
      return cached;
    }

    let runs;
    try {
      const index = this.loadRunsIndex();
      if (fs.existsSync(this.runsIndexPath) && Array.isArray(index.runs)) {
        runs = index.runs;
      } else {
        runs = this.rebuildRunsIndex();
      }
    } catch (error) {
      this.logger.error('Errore caricamento runs', { error: error.message });
      runs = this.rebuildRunsIndex();
    }

    // Cache indefinitamente (invalidato on change)
    cacheManager.set('all_runs', runs);

    return runs;
  }

  loadRunsForJob(jobId) {
    return this.loadAllRuns().filter(run => run.job_id === jobId);
  }

  saveAgentHeartbeat(heartbeat) {
    const agentPath = path.join(this.dataRoot, 'state', 'agents', `${heartbeat.hostname}.json`);

    try {
      const normalized = {
        hostname: heartbeat.hostname,
        status: heartbeat.status || 'online',
        timestamp: heartbeat.timestamp || new Date().toISOString(),
        agent_ip: heartbeat.agent_ip || null,
        agent_port: heartbeat.agent_port || null,
        backup_status: heartbeat.backup_status || null,
        backup_job_id: heartbeat.backup_job_id || null,
        backup_status_timestamp: heartbeat.backup_status_timestamp || null
      };

      fs.writeFileSync(agentPath, JSON.stringify(normalized, null, 2), 'utf8');
      return true;
    } catch (error) {
      this.logger.error('Errore salvataggio heartbeat agent', { hostname: heartbeat.hostname, error: error.message });
      return false;
    }
  }

  loadAgentHeartbeat(hostname) {
    const agentPath = path.join(this.dataRoot, 'state', 'agents', `${hostname}.json`);

    try {
      if (!fs.existsSync(agentPath)) {
        return null;
      }

      const data = fs.readFileSync(agentPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      this.logger.error('Errore lettura heartbeat agent', { hostname, error: error.message });
      return null;
    }
  }

  loadAllAgentHeartbeats() {
    const agentsDir = path.join(this.dataRoot, 'state', 'agents');
    const heartbeats = [];

    try {
      if (!fs.existsSync(agentsDir)) {
        return heartbeats;
      }

      const files = fs.readdirSync(agentsDir);
      for (const file of files) {
        if (path.extname(file) === '.json') {
          const hostname = path.basename(file, '.json');
          const heartbeat = this.loadAgentHeartbeat(hostname);
          if (heartbeat) {
            heartbeats.push(heartbeat);
          }
        }
      }
    } catch (error) {
      this.logger.error('Errore caricamento heartbeat agent', { error: error.message });
    }

    return heartbeats;
  }

  deleteAgentHeartbeat(hostname) {
    const agentPath = path.join(this.dataRoot, 'state', 'agents', `${hostname}.json`);

    try {
      if (fs.existsSync(agentPath)) {
        fs.unlinkSync(agentPath);
      }
      return true;
    } catch (error) {
      this.logger.error('Errore eliminazione heartbeat agent', { hostname, error: error.message });
      return false;
    }
  }

  deleteJobsForClient(hostname) {
    const jobsDir = path.join(this.dataRoot, 'state', 'jobs');
    let deleted = 0;

    try {
      if (!fs.existsSync(jobsDir)) {
        return deleted;
      }

      const files = fs.readdirSync(jobsDir);
      for (const file of files) {
        const jobPath = path.join(jobsDir, file);
        if (path.extname(file) !== '.json') {
          continue;
        }

        const job = this.loadJob(path.basename(file, '.json'));
        if (job?.client_hostname === hostname && fs.existsSync(jobPath)) {
          fs.unlinkSync(jobPath);
          deleted += 1;
        }
      }
    } catch (error) {
      this.logger.error('Errore eliminazione job cliente', { hostname, error: error.message });
    }

    return deleted;
  }

  deleteRunsForClient(hostname) {
    const runsDir = path.join(this.dataRoot, 'state', 'runs');
    let deleted = 0;

    try {
      if (!fs.existsSync(runsDir)) {
        return deleted;
      }

      const files = fs.readdirSync(runsDir);
      for (const file of files) {
        const runPath = path.join(runsDir, file);
        if (path.extname(file) !== '.json') {
          continue;
        }

        const run = this.loadRun(path.basename(file, '.json'));
        if (run?.client_hostname === hostname && fs.existsSync(runPath)) {
          fs.unlinkSync(runPath);
          deleted += 1;
        }
      }

      const index = this.loadRunsIndex();
      if (Array.isArray(index.runs) && index.runs.length > 0) {
        const filtered = index.runs.filter(run => run.client_hostname !== hostname);
        this.saveRunsIndex({ runs: filtered });
      }
    } catch (error) {
      this.logger.error('Errore eliminazione run cliente', { hostname, error: error.message });
    }

    return deleted;
  }

  deleteAllRuns() {
    const runsDir = path.join(this.dataRoot, 'state', 'runs');
    let deletedCount = 0;

    try {
      if (fs.existsSync(runsDir)) {
        const files = fs.readdirSync(runsDir);
        for (const file of files) {
          if (file.endsWith('.json') && file !== path.basename(this.runsIndexPath)) {
            fs.unlinkSync(path.join(runsDir, file));
            deletedCount++;
          }
        }
      }
    } catch (error) {
      this.logger.error('Errore eliminazione tutti i run', { error: error.message });
    }

    this.saveRunsIndex({ runs: [] });
    return deletedCount;
  }

  deleteClient(hostname) {
    const jobCount = this.deleteJobsForClient(hostname);
    const runCount = this.deleteRunsForClient(hostname);
    const heartbeatDeleted = this.deleteAgentHeartbeat(hostname);

    const schedulerState = this.loadSchedulerState();
    const filteredJobs = (schedulerState.jobs || []).filter(j => j.client_hostname !== hostname);
    this.saveSchedulerState({ ...schedulerState, jobs: filteredJobs });

    return {
      jobsDeleted: jobCount,
      runsDeleted: runCount,
      heartbeatDeleted
    };
  }

  loadUsers() {
    const usersPath = path.join(this.dataRoot, 'users', 'users.json');
    try {
      if (!fs.existsSync(usersPath)) {
        return [];
      }
      const data = fs.readFileSync(usersPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      this.logger.logInvalidConfig('users', usersPath, error);
      return [];
    }
  }

  saveUsers(users) {
    const usersPath = path.join(this.dataRoot, 'users', 'users.json');
    try {
      fs.writeFileSync(usersPath, JSON.stringify(users, null, 2), 'utf8');
      return true;
    } catch (error) {
      this.logger.error('Errore salvataggio utenti', { error: error.message });
      return false;
    }
  }

  loadSchedulerState() {
    const statePath = path.join(this.dataRoot, 'state', 'scheduler', 'state.json');
    try {
      if (!fs.existsSync(statePath)) {
        return { jobs: [] };
      }
      const data = fs.readFileSync(statePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      this.logger.logInvalidConfig('scheduler_state', statePath, error);
      return { jobs: [] };
    }
  }

  saveSchedulerState(state) {
    const statePath = path.join(this.dataRoot, 'state', 'scheduler', 'state.json');
    try {
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
      return true;
    } catch (error) {
      this.logger.error('Errore salvataggio stato scheduler', { error: error.message });
      return false;
    }
  }

  // Alert Management
  loadAlert(alertId) {
    const alertPath = path.join(this.dataRoot, 'state', 'alerts', `${alertId}.json`);
    try {
      if (!fs.existsSync(alertPath)) {
        return null;
      }
      const data = fs.readFileSync(alertPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      this.logger.error('Errore lettura alert', { alertId, error: error.message });
      return null;
    }
  }

  saveAlert(alert) {
    const alertPath = path.join(this.dataRoot, 'state', 'alerts', `${alert.alert_id}.json`);
    try {
      fs.writeFileSync(alertPath, JSON.stringify(alert, null, 2), 'utf8');

      // Invalidate cache
      cacheManager.invalidate('active_alerts');
      cacheManager.invalidate('all_alerts');

      return true;
    } catch (error) {
      this.logger.error('Errore salvataggio alert', { alertId: alert.alert_id, error: error.message });
      return false;
    }
  }

  loadAllAlerts(onlyActive = false) {
    const cacheKey = onlyActive ? 'active_alerts' : 'all_alerts';

    // Check cache
    const cached = cacheManager.get(cacheKey);
    if (cached) {
      return cached;
    }

    const alertsDir = path.join(this.dataRoot, 'state', 'alerts');
    const alerts = [];

    try {
      if (!fs.existsSync(alertsDir)) {
        return alerts;
      }

      const files = fs.readdirSync(alertsDir);
      for (const file of files) {
        if (path.extname(file) === '.json') {
          const alertId = path.basename(file, '.json');
          const alert = this.loadAlert(alertId);
          if (alert) {
            if (!onlyActive || !alert.resolved) {
              alerts.push(alert);
            }
          }
        }
      }

      // Sort by timestamp descending (newest first)
      alerts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } catch (error) {
      this.logger.error('Errore caricamento alerts', { error: error.message });
    }

    // Cache for 10 seconds
    cacheManager.set(cacheKey, alerts, 10000);

    return alerts;
  }

  resolveAlert(alertId, resolvedTimestamp = null) {
    const alert = this.loadAlert(alertId);
    if (!alert) {
      return false;
    }

    alert.resolved = true;
    alert.resolved_timestamp = resolvedTimestamp || new Date().toISOString();
    return this.saveAlert(alert);
  }

  deleteAlert(alertId) {
    const alertPath = path.join(this.dataRoot, 'state', 'alerts', `${alertId}.json`);
    try {
      if (fs.existsSync(alertPath)) {
        fs.unlinkSync(alertPath);
      }

      // Invalidate cache
      cacheManager.invalidate('active_alerts');
      cacheManager.invalidate('all_alerts');

      return true;
    } catch (error) {
      this.logger.error('Errore eliminazione alert', { alertId, error: error.message });
      return false;
    }
  }

  deleteAllAlerts() {
    const alertsDir = path.join(this.dataRoot, 'state', 'alerts');
    let deletedCount = 0;

    try {
      if (!fs.existsSync(alertsDir)) {
        return deletedCount;
      }

      const files = fs.readdirSync(alertsDir);
      for (const file of files) {
        if (path.extname(file) !== '.json') {
          continue;
        }

        const alertPath = path.join(alertsDir, file);
        try {
          fs.unlinkSync(alertPath);
          deletedCount += 1;
        } catch (error) {
          this.logger.error('Errore eliminazione alert', { alertId: file, error: error.message });
        }
      }

      cacheManager.invalidate('active_alerts');
      cacheManager.invalidate('all_alerts');

      return deletedCount;
    } catch (error) {
      this.logger.error('Errore eliminazione storico alert', { error: error.message });
      return deletedCount;
    }
  }

  findAlertByKey(type, key) {
    const alerts = this.loadAllAlerts(true);
    return alerts.find(alert => alert.type === type && alert.key === key);
  }

  // Session Management
  loadSessions() {
    const sessionsPath = path.join(this.dataRoot, 'state', 'sessions.json');
    try {
      if (!fs.existsSync(sessionsPath)) {
        return {};
      }
      const data = fs.readFileSync(sessionsPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      this.logger.error('Errore lettura sessioni', { error: error.message });
      return {};
    }
  }

  saveSessions(sessions) {
    const sessionsPath = path.join(this.dataRoot, 'state', 'sessions.json');
    try {
      fs.writeFileSync(sessionsPath, JSON.stringify(sessions, null, 2), 'utf8');
      return true;
    } catch (error) {
      this.logger.error('Errore salvataggio sessioni', { error: error.message });
      return false;
    }
  }
}

module.exports = Storage;
