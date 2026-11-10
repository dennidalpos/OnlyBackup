const eventBus = require('../events/eventBus');

function registerAgentRoutes(router, deps) {
  const {
    requireAuth,
    logger,
    storage,
    HEARTBEAT_TTL_MS,
    extractClientIp
  } = deps;

  router.get('/api/agent/package/options', requireAuth, (req, res) => {
    try {
      const agentPackageService = req.app.get('agentPackageService');
      if (!agentPackageService) {
        return res.status(500).json({ error: 'Servizio packaging agent non disponibile' });
      }

      const options = agentPackageService.getPackageOptions(req);
      logger.logApiCall('GET', '/api/agent/package/options', req.username, 200);
      res.json(options);
    } catch (error) {
      logger.error('Errore opzioni packaging agent', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.post('/api/agent/package/build', requireAuth, (req, res) => {
    try {
      const agentPackageService = req.app.get('agentPackageService');
      if (!agentPackageService) {
        return res.status(500).json({ error: 'Servizio packaging agent non disponibile' });
      }

      const build = agentPackageService.startBuild(req.body || {}, req.username);
      logger.logApiCall('POST', '/api/agent/package/build', req.username, 202);
      res.status(202).json(build);
    } catch (error) {
      const statusCode = error.statusCode || 500;
      logger.error('Errore avvio packaging agent', { error: error.message, statusCode });
      res.status(statusCode).json({ error: statusCode === 500 ? 'Errore interno' : error.message });
    }
  });

  router.get('/api/agent/package/build/:buildId', requireAuth, (req, res) => {
    try {
      const agentPackageService = req.app.get('agentPackageService');
      if (!agentPackageService) {
        return res.status(500).json({ error: 'Servizio packaging agent non disponibile' });
      }

      const build = agentPackageService.getBuildStatus(req.params.buildId);
      if (!build) {
        return res.status(404).json({ error: 'Build non trovata' });
      }

      logger.logApiCall('GET', '/api/agent/package/build/:buildId', req.username, 200);
      res.json(build);
    } catch (error) {
      logger.error('Errore stato packaging agent', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.get('/api/agent/package/download', requireAuth, (req, res) => {
    try {
      const agentPackageService = req.app.get('agentPackageService');
      if (!agentPackageService) {
        return res.status(500).json({ error: 'Servizio packaging agent non disponibile' });
      }

      const msiPath = agentPackageService.getArtifactPath();
      if (!msiPath) {
        return res.status(404).json({ error: 'Pacchetto agent non disponibile' });
      }

      logger.logApiCall('GET', '/api/agent/package/download', req.username, 200);
      res.download(msiPath, 'OnlyBackupAgent.msi');
    } catch (error) {
      logger.error('Errore download packaging agent', { error: error.message });
      res.status(500).json({ error: 'Errore download agent' });
    }
  });

  router.post('/api/agent/heartbeat', (req, res) => {
    const { hostname, timestamp, status, agent_ip, agent_port, backup_status, backup_job_id } = req.body || {};
    if (!hostname) {
      return res.status(400).json({ error: 'Hostname richiesto' });
    }

    const resolvedAgentIp = agent_ip || extractClientIp(req);
    const parsedPort = agent_port ? parseInt(agent_port, 10) : null;
    const resolvedAgentPort = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 8081;
    const existingHeartbeats = storage.loadAllAgentHeartbeats();
    const existingHeartbeat = existingHeartbeats.find(hb => hb.hostname === hostname);

    let finalBackupStatus = backup_status || null;
    let finalBackupJobId = backup_job_id || null;

    if (!backup_status && existingHeartbeat && existingHeartbeat.backup_status === 'in_progress') {
      const now = Date.now();
      const lastStatusUpdate = new Date(existingHeartbeat.backup_status_timestamp || existingHeartbeat.timestamp).getTime();
      const elapsed = now - lastStatusUpdate;
      const BACKUP_STATUS_TIMEOUT = 5 * 60 * 1000;
      if (elapsed < BACKUP_STATUS_TIMEOUT) {
        finalBackupStatus = existingHeartbeat.backup_status;
        finalBackupJobId = existingHeartbeat.backup_job_id;
      }
    }

    const wasOffline = existingHeartbeat && (
      existingHeartbeat.status === 'offline' ||
      (Date.now() - new Date(existingHeartbeat.timestamp).getTime() > HEARTBEAT_TTL_MS)
    );

    const heartbeat = {
      hostname,
      timestamp: timestamp || new Date().toISOString(),
      status: status || 'online',
      agent_ip: resolvedAgentIp,
      agent_port: resolvedAgentPort,
      backup_status: finalBackupStatus,
      backup_job_id: finalBackupJobId,
      backup_status_timestamp: backup_status
        ? (timestamp || new Date().toISOString())
        : (existingHeartbeat?.backup_status_timestamp || null)
    };

    const saved = storage.saveAgentHeartbeat(heartbeat);
    if (!saved) {
      return res.status(500).json({ error: 'Impossibile salvare heartbeat' });
    }

    const statusChanged = existingHeartbeat && existingHeartbeat.status !== heartbeat.status;
    if (statusChanged || wasOffline) {
      eventBus.emitClientStatusChanged(hostname, heartbeat.status, heartbeat.timestamp);
    }

    if (backup_status && (!existingHeartbeat || existingHeartbeat.backup_status !== backup_status)) {
      if (backup_status === 'in_progress') {
        eventBus.emitBackupStarted(hostname, backup_job_id, null, heartbeat.timestamp);
      }
    }

    if (wasOffline && heartbeat.status === 'online') {
      const alertService = req.app.get('alertService');
      let shouldNotifyEmail = true;
      if (alertService) {
        const resolved = alertService.resolveAgentOfflineAlert(hostname);
        shouldNotifyEmail = resolved !== false;
      }

      const emailService = req.app.get('emailService');
      if (emailService && shouldNotifyEmail) {
        const jobs = storage.loadAllJobs()
          .filter(job => job.client_hostname === hostname)
          .map(job => job.job_id);

        emailService.notifyAgentStatus(
          hostname,
          'online',
          existingHeartbeat ? existingHeartbeat.timestamp : new Date().toISOString(),
          jobs
        ).catch((err) => {
          logger.warn('Errore invio notifica email agent online', { error: err.message });
        });
      }
    }

    logger.logApiCall('POST', '/api/agent/heartbeat', hostname, 200);
    res.json({ success: true });
  });
}

module.exports = registerAgentRoutes;
