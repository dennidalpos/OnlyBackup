const fs = require('fs');
const path = require('path');
const { sanitizePathSegment } = require('../shared/pathSegments');

function registerMonitoringRoutes(router, deps) {
  const {
    requireAuth,
    logger,
    storage,
    respondFromCache,
    sendCachedResponse,
    STATS_CACHE_TTL_MS,
    buildAgentStatusMap,
    readLogFile,
    readLogIndexPaths,
    findLatestRunLog,
    getOnlineAgentInfo,
    callAgentJobBackups,
    callAgentDelete,
    pathsOverlap
  } = deps;

  router.get('/api/public/stats', (req, res) => {
    try {
      const cacheKey = 'public-stats';
      if (respondFromCache(req, res, cacheKey, 'public, max-age=15')) {
        return;
      }

      const runs = storage.loadAllRuns();
      const agentStatus = buildAgentStatusMap();
      const now = Date.now();
      const last24h = now - (24 * 60 * 60 * 1000);
      const recentRuns = runs.filter(r => new Date(r.start).getTime() >= last24h);
      const successCount = recentRuns.filter(r => r.status === 'success').length;
      const failureCount = recentRuns.filter(r => r.status === 'failed' || r.status === 'partial').length;
      const recentByJob = new Map();
      const latestByHost = new Map();

      runs.forEach(run => {
        const key = `${run.client_hostname || 'unknown'}::${run.job_id || 'job'}`;
        const runTs = new Date(run.start || run.end || 0).getTime();
        if (!recentByJob.has(key) || runTs > new Date(recentByJob.get(key).start || recentByJob.get(key).end || 0).getTime()) {
          recentByJob.set(key, run);
        }

        const hostKey = run.client_hostname || 'unknown';
        const currentHostRun = latestByHost.get(hostKey);
        const currentHostTs = currentHostRun ? new Date(currentHostRun.start || currentHostRun.end || 0).getTime() : 0;
        if (!currentHostRun || runTs > currentHostTs) {
          latestByHost.set(hostKey, run);
        }
      });

      const recentBackups = Array.from(recentByJob.values()).map(run => ({
        hostname: run.client_hostname,
        job_id: run.job_id,
        status: run.status,
        start: run.start,
        end: run.end
      }));

      const jobs = storage.loadAllJobs();
      const heartbeats = storage.loadAllAgentHeartbeats();
      const clientHostnames = new Set();
      jobs.forEach(job => clientHostnames.add(job.client_hostname));
      heartbeats.forEach(hb => clientHostnames.add(hb.hostname));
      const onlineClients = [...clientHostnames].filter(h => agentStatus.get(h)?.online).length;
      const offlineClients = Math.max(clientHostnames.size - onlineClients, 0);
      const clientStatuses = [...clientHostnames].map(hostname => {
        const heartbeat = agentStatus.get(hostname);
        const latestRun = latestByHost.get(hostname);
        return {
          hostname,
          online: heartbeat?.online || false,
          status: latestRun?.status || null
        };
      });

      const payload = {
        backups_ok_24h: successCount,
        backups_failed_24h: failureCount,
        clients_online: onlineClients,
        clients_offline: offlineClients,
        recent_backups: recentBackups,
        client_statuses: clientStatuses
      };

      sendCachedResponse(req, res, cacheKey, payload, STATS_CACHE_TTL_MS, 'public, max-age=15');
    } catch (error) {
      logger.error('Errore stats pubbliche', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.get('/api/runs', requireAuth, (req, res) => {
    try {
      const jobId = req.query.jobId;
      const client = req.query.client;
      let runs = jobId ? storage.loadRunsForJob(jobId) : storage.loadAllRuns();
      if (client) {
        runs = runs.filter(r => r.client_hostname === client);
      }

      logger.logApiCall('GET', '/api/runs', req.username, 200);
      res.json(runs);
    } catch (error) {
      logger.error('Errore caricamento runs', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.get('/api/runs/:runId', requireAuth, (req, res) => {
    try {
      const run = storage.loadRun(req.params.runId);
      if (!run) {
        return res.status(404).json({ error: 'Run non trovato' });
      }

      logger.logApiCall('GET', `/api/runs/${req.params.runId}`, req.username, 200);
      res.json(run);
    } catch (error) {
      logger.error('Errore caricamento run', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.get('/api/clients/:hostname/jobs/:jobId/logs/latest', requireAuth, (req, res) => {
    try {
      const { hostname, jobId } = req.params;
      const safeHost = sanitizePathSegment(hostname);
      const safeJob = sanitizePathSegment(jobId);
      const baseDir = path.join(storage.dataRoot, 'logs', safeHost, safeJob);
      let logPayload = null;

      if (fs.existsSync(baseDir)) {
        const files = fs.readdirSync(baseDir).filter(f => f.endsWith('.log'));
        if (files.length > 0) {
          const sorted = files
            .map(file => ({ file, mtime: fs.statSync(path.join(baseDir, file)).mtime }))
            .sort((a, b) => b.mtime - a.mtime);
          const latest = sorted[0];
          const latestPath = path.join(baseDir, latest.file);
          logPayload = readLogFile(latestPath);
        }
      }

      if (!logPayload) {
        logPayload = findLatestRunLog(hostname, jobId);
      }

      if (!logPayload) {
        return res.status(404).json({ error: 'Nessun log disponibile' });
      }

      logger.logApiCall('GET', `/api/clients/${hostname}/jobs/${jobId}/logs/latest`, req.username, 200);
      res.json(logPayload);
    } catch (error) {
      logger.error('Errore recupero log run', { error: error.message, params: req.params });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.get('/api/clients/:hostname/jobs/:jobId/logs/full', requireAuth, (req, res) => {
    try {
      const { hostname, jobId } = req.params;
      const mappingIndexParam = req.query.mapping;
      const mappingIndex = Number.isFinite(Number(mappingIndexParam)) ? Number(mappingIndexParam) : null;
      const limit = Number.isFinite(Number(req.query.limit)) ? Math.min(Number(req.query.limit), 50) : 5;
      const offset = Number.isFinite(Number(req.query.offset)) ? Math.max(Number(req.query.offset), 0) : 0;
      const tailLines = Number.isFinite(Number(req.query.tailLines)) ? Number(req.query.tailLines) : 200;
      const runs = storage
        .loadRunsForJob(jobId)
        .filter(r => r.client_hostname === hostname)
        .sort((a, b) => new Date(b.start || 0) - new Date(a.start || 0));

      const paginatedRuns = runs.slice(offset, offset + limit);
      const payload = paginatedRuns
        .map(run => {
          const runIndexPaths = new Set(readLogIndexPaths(run.run_log_index));
          const mappings = (run.mappings || [])
            .map((mapping, index) => {
              const normalizedIndex = Number.isFinite(Number(mapping.index)) ? Number(mapping.index) : index;
              const logCandidates = new Set();
              if (mapping.log_path) {
                logCandidates.add(mapping.log_path);
              }
              if (run.log_path) {
                logCandidates.add(run.log_path);
              }
              readLogIndexPaths(mapping.run_log_index).forEach(candidate => logCandidates.add(candidate));
              runIndexPaths.forEach(candidate => logCandidates.add(candidate));
              const logs = Array.from(logCandidates)
                .map(candidate => readLogFile(candidate, run.run_id, { tailLines }))
                .filter(Boolean);

              return {
                index: normalizedIndex,
                label: mapping.label || `Mappatura ${index + 1}`,
                status: mapping.status || run.status,
                mode: mapping.mode || run.mode_default || 'copy',
                destination_path: mapping.destination_path || run.target_path,
                logs
              };
            })
            .filter(mapping => mappingIndex === null || mapping.index === mappingIndex);

          return {
            run_id: run.run_id,
            start: run.start,
            end: run.end,
            status: run.status,
            mappings
          };
        })
        .filter(run => mappingIndex === null || (run.mappings && run.mappings.length > 0));

      logger.logApiCall('GET', `/api/clients/${hostname}/jobs/${jobId}/logs/full`, req.username, 200);
      res.json({
        hostname,
        job_id: jobId,
        runs: payload,
        pagination: {
          total: runs.length,
          limit,
          offset
        }
      });
    } catch (error) {
      logger.error('Errore recupero log completi', { error: error.message, params: req.params });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.get('/api/clients/:hostname/jobs/:jobId/backups', requireAuth, async (req, res) => {
    try {
      const { hostname, jobId } = req.params;
      const job = storage.loadJob(jobId);
      if (!job || job.client_hostname !== hostname) {
        return res.status(404).json({ error: 'Job non trovato per il client indicato' });
      }

      const { agent, error, status } = getOnlineAgentInfo(hostname);
      if (error) {
        return res.status(status || 503).json({ error });
      }

      const jobLabel = sanitizePathSegment(job.job_id);
      const mappings = await callAgentJobBackups(agent.agent_ip, agent.agent_port, jobLabel, job.mappings || []);
      logger.logApiCall('GET', `/api/clients/${hostname}/jobs/${jobId}/backups`, req.username, 200);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.json({ hostname, job_id: jobId, mappings });
    } catch (error) {
      logger.error('Errore recupero lista backup', { error: error.message, params: req.params });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.post('/api/clients/:hostname/jobs/:jobId/backups/delete', requireAuth, async (req, res) => {
    try {
      const { hostname, jobId } = req.params;
      const { path: backupPath } = req.body || {};
      if (!backupPath) {
        return res.status(400).json({ error: 'Percorso backup mancante' });
      }

      const job = storage.loadJob(jobId);
      if (!job || job.client_hostname !== hostname) {
        return res.status(404).json({ error: 'Job non trovato per il client indicato' });
      }

      const allowed = (job.mappings || []).some(mapping =>
        mapping.destination_path && pathsOverlap(backupPath, mapping.destination_path)
      );
      if (!allowed) {
        return res.status(400).json({ error: 'Percorso non appartenente al job selezionato' });
      }

      const normalize = (value) => (value || '').replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
      const targetPath = normalize(backupPath);
      const mapping = (job.mappings || []).find(m => {
        if (!m.destination_path) return false;
        const destination = normalize(m.destination_path);
        return targetPath.startsWith(destination);
      });

      const credentials = mapping ? mapping.credentials : null;
      const { agent, error, status } = getOnlineAgentInfo(hostname);
      if (error) {
        return res.status(status || 503).json({ error });
      }

      const response = await callAgentDelete(agent.agent_ip, agent.agent_port, [{
        path: backupPath,
        credentials
      }]);

      logger.logApiCall('POST', `/api/clients/${hostname}/jobs/${jobId}/backups/delete`, req.username, 200);
      res.json(response);
    } catch (error) {
      logger.error('Errore eliminazione backup', { error: error.message, params: req.params, body: req.body });
      res.status(500).json({ error: 'Errore interno' });
    }
  });
}

module.exports = registerMonitoringRoutes;
