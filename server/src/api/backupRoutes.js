function registerBackupRoutes(router, deps) {
  const {
    requireAuth,
    logger,
    storage,
    respondFromCache,
    backupAnalyzeCache,
    getOnlineAgentInfo,
    callAgentJobBackups,
    sendCachedResponse,
    BACKUP_ANALYZE_CACHE_TTL_MS
  } = deps;

  router.get('/api/clients/:hostname/jobs/:jobId/backups/analyze', requireAuth, async (req, res) => {
    try {
      const { hostname, jobId } = req.params;
      const mappingIndexParam = req.query.mapping;
      const mappingIndex = Number.isFinite(Number(mappingIndexParam)) ? Number(mappingIndexParam) : null;
      const cacheKey = `${hostname}:${jobId}:${mappingIndex ?? 'all'}`;

      if (respondFromCache(req, res, cacheKey, 'private, max-age=30', backupAnalyzeCache)) {
        return;
      }

      const job = storage.loadJob(jobId);

      if (!job || job.client_hostname !== hostname) {
        return res.status(404).json({ error: 'Job non trovato per il client indicato' });
      }

      if (mappingIndex !== null && (!job.mappings || !job.mappings[mappingIndex])) {
        return res.status(404).json({ error: 'Mappatura non trovata per il job indicato' });
      }

      const { agent, error, status } = getOnlineAgentInfo(hostname);
      if (error) {
        return res.status(status || 503).json({ error });
      }

      const jobLabel = (job.job_id || 'backup').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);

      const targetMappings = mappingIndex === null
        ? (job.mappings || [])
        : [job.mappings[mappingIndex]];

      const mappings = await callAgentJobBackups(agent.agent_ip, agent.agent_port, jobLabel, targetMappings);

      mappings.forEach((mapping, idx) => {
        if (mappingIndex !== null) {
          mapping.index = mappingIndex;
          mapping.label = job.mappings[mappingIndex].label || mapping.label;
          mapping.destination_path = job.mappings[mappingIndex].destination_path || mapping.destination_path;
          mapping.mode = job.mappings[mappingIndex].mode || mapping.mode;
        } else if (!Number.isFinite(Number(mapping.index))) {
          mapping.index = idx;
        }

        if (Array.isArray(mapping.backups)) {
          mapping.backups.sort((a, b) => new Date(b.modified || 0) - new Date(a.modified || 0));
        }
      });

      logger.logApiCall('GET', `/api/clients/${hostname}/jobs/${jobId}/backups/analyze`, req.username, 200);
      const payload = { hostname, job_id: jobId, mappings };
      sendCachedResponse(req, res, cacheKey, payload, BACKUP_ANALYZE_CACHE_TTL_MS, 'private, max-age=30', backupAnalyzeCache);
    } catch (error) {
      logger.error('Errore analisi backup fisici', { error: error.message, params: req.params });
      res.status(500).json({ error: 'Errore interno' });
    }
  });
}

module.exports = registerBackupRoutes;
