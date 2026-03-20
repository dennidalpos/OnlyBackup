function registerClientRoutes(router, deps) {
  const {
    requireAuth,
    logger,
    storage,
    scheduler,
    respondFromCache,
    sendCachedResponse,
    CLIENTS_CACHE_TTL_MS,
    buildAgentStatusMap,
    callAgentFilesystem,
    getOnlineAgentInfo
  } = deps;

  router.get('/api/clients/:hostname/fs', requireAuth, async (req, res) => {
    try {
      const hostname = req.params.hostname;
      const requestedPath = req.query.path || '';
      const { agent, error, status } = getOnlineAgentInfo(hostname);
      if (error) {
        logger.error(error, { hostname });
        return res.status(status || 503).json({ error });
      }

      const listing = await callAgentFilesystem(agent.agent_ip, agent.agent_port, requestedPath);
      logger.logApiCall('GET', `/api/clients/${hostname}/fs`, req.username, 200);
      res.json(listing);
    } catch (error) {
      logger.error('Errore browsing filesystem remoto', { error: error.message });
      res.status(500).json({ error: error.message || 'Errore interno' });
    }
  });

  router.get('/api/clients', requireAuth, (req, res) => {
    try {
      const cacheKey = 'clients-list';
      if (respondFromCache(req, res, cacheKey, 'private, max-age=15')) {
        return;
      }

      const jobs = storage.loadAllJobs();
      const runs = storage.loadAllRuns();
      const heartbeats = storage.loadAllAgentHeartbeats();
      const agentStatus = buildAgentStatusMap();
      const clientMap = new Map();

      heartbeats.forEach(hb => {
        if (!clientMap.has(hb.hostname)) {
          clientMap.set(hb.hostname, {
            hostname: hb.hostname,
            jobs: [],
            online: agentStatus.get(hb.hostname)?.online || false,
            lastSeen: hb.timestamp
          });
        }
      });

      jobs.forEach(job => {
        if (!clientMap.has(job.client_hostname)) {
          clientMap.set(job.client_hostname, {
            hostname: job.client_hostname,
            jobs: [],
            online: false,
            lastSeen: null
          });
        }

        clientMap.get(job.client_hostname).jobs.push(job.job_id);
      });

      runs.forEach(run => {
        if (clientMap.has(run.client_hostname)) {
          const client = clientMap.get(run.client_hostname);
          const runDate = new Date(run.start);
          if (!client.lastSeen || runDate > new Date(client.lastSeen)) {
            client.lastSeen = run.start;
          }
          if (!client.lastBackupRun || runDate > new Date(client.lastBackupRun.start)) {
            client.lastBackupRun = {
              start: run.start,
              status: run.status
            };
          }
        }
      });

      const clients = Array.from(clientMap.values());
      clients.forEach(client => {
        const status = agentStatus.get(client.hostname);
        if (status) {
          client.online = status.online;
          client.lastSeen = status.lastSeen;
          client.backup_status = status.backup_status;
          client.backup_job_id = status.backup_job_id;
          client.agent_ip = status.agent_ip;
          client.agent_port = status.agent_port;
          client.backup_status_timestamp = status.backup_status_timestamp;
        }
      });

      logger.logApiCall('GET', '/api/clients', req.username, 200);
      sendCachedResponse(req, res, cacheKey, clients, CLIENTS_CACHE_TTL_MS, 'private, max-age=15');
    } catch (error) {
      logger.error('Errore caricamento clients', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.delete('/api/clients/:hostname/runs', requireAuth, async (req, res) => {
    try {
      const hostname = req.params.hostname;
      const runsDeleted = storage.deleteRunsForClient(hostname);
      logger.logApiCall('DELETE', `/api/clients/${hostname}/runs`, req.username, 200);
      res.json({ success: true, runsDeleted });
    } catch (error) {
      logger.error('Errore eliminazione log client', { hostname: req.params.hostname, error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.delete('/api/clients/:hostname', requireAuth, async (req, res) => {
    try {
      const hostname = req.params.hostname;
      const target = (hostname || '').toLowerCase();
      const hostnamesToDelete = new Set([hostname]);
      const jobs = storage.loadAllJobs();
      const runs = storage.loadAllRuns();
      const heartbeats = storage.loadAllAgentHeartbeats();

      jobs.forEach(job => {
        if (job?.client_hostname && job.client_hostname.toLowerCase() === target) {
          hostnamesToDelete.add(job.client_hostname);
        }
      });

      runs.forEach(run => {
        if (run?.client_hostname && run.client_hostname.toLowerCase() === target) {
          hostnamesToDelete.add(run.client_hostname);
        }
      });

      heartbeats.forEach(hb => {
        if (hb?.hostname && hb.hostname.toLowerCase() === target) {
          hostnamesToDelete.add(hb.hostname);
        }
      });

      const aggregate = {
        jobsDeleted: 0,
        runsDeleted: 0,
        heartbeatDeleted: false
      };

      hostnamesToDelete.forEach(entry => {
        const result = storage.deleteClient(entry);
        aggregate.jobsDeleted += result.jobsDeleted || 0;
        aggregate.runsDeleted += result.runsDeleted || 0;
        aggregate.heartbeatDeleted = aggregate.heartbeatDeleted || result.heartbeatDeleted;
      });

      await scheduler.reloadJobs();
      logger.logApiCall('DELETE', `/api/clients/${hostname}`, req.username, 200);
      res.json({ success: true, result: aggregate });
    } catch (error) {
      logger.error('Errore deregistrazione client', { hostname: req.params.hostname, error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.post('/api/clients/:hostname/reset-backup-status', requireAuth, (req, res) => {
    try {
      const hostname = req.params.hostname;
      const existingHeartbeats = storage.loadAllAgentHeartbeats();
      const existingHeartbeat = existingHeartbeats.find(hb => hb.hostname === hostname);
      if (!existingHeartbeat) {
        return res.status(404).json({ error: 'Client non trovato' });
      }

      const heartbeat = {
        ...existingHeartbeat,
        backup_status: null,
        backup_job_id: null,
        backup_status_timestamp: null
      };

      storage.saveAgentHeartbeat(heartbeat);
      logger.logApiCall('POST', `/api/clients/${hostname}/reset-backup-status`, req.username, 200);
      res.json({ success: true });
    } catch (error) {
      logger.error('Errore reset stato backup', { hostname: req.params.hostname, error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });
}

module.exports = registerClientRoutes;
