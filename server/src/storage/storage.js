const fs = require('fs');
const path = require('path');

class Storage {
  constructor(dataRoot, logger) {
    this.dataRoot = dataRoot;
    this.logger = logger;
    this.ensureDirectories();
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
      fs.writeFileSync(jobPath, JSON.stringify(job, null, 2), 'utf8');
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
      return true;
    } catch (error) {
      this.logger.error('Errore eliminazione job', { jobId, error: error.message });
      return false;
    }
  }

  loadAllJobs() {
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
      return true;
    } catch (error) {
      this.logger.error('Errore salvataggio run', { runId: run.run_id, error: error.message });
      return false;
    }
  }

  loadAllRuns() {
    const runsDir = path.join(this.dataRoot, 'state', 'runs');
    const runs = [];

    try {
      if (!fs.existsSync(runsDir)) {
        return runs;
      }

      const files = fs.readdirSync(runsDir);
      for (const file of files) {
        if (path.extname(file) === '.json') {
          const runId = path.basename(file, '.json');
          const run = this.loadRun(runId);
          if (run) {
            runs.push(run);
          }
        }
      }
    } catch (error) {
      this.logger.error('Errore caricamento runs', { error: error.message });
    }

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
    } catch (error) {
      this.logger.error('Errore eliminazione run cliente', { hostname, error: error.message });
    }

    return deleted;
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
}

module.exports = Storage;
