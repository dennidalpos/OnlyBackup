function registerJobRoutes(router, deps) {
  const {
    requireAuth,
    logger,
    storage,
    scheduler,
    normalizeJobPayload
  } = deps;

  router.get('/api/clients/:hostname/jobs', requireAuth, (req, res) => {
    try {
      const jobs = storage.loadAllJobs().filter(j => j.client_hostname === req.params.hostname);
      logger.logApiCall('GET', `/api/clients/${req.params.hostname}/jobs`, req.username, 200);
      res.json(jobs);
    } catch (error) {
      logger.error('Errore caricamento jobs client', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.get('/api/jobs', requireAuth, (req, res) => {
    try {
      const jobs = storage.loadAllJobs();
      logger.logApiCall('GET', '/api/jobs', req.username, 200);
      res.json(jobs);
    } catch (error) {
      logger.error('Errore caricamento jobs', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.get('/api/jobs/:jobId', requireAuth, (req, res) => {
    try {
      const job = storage.loadJob(req.params.jobId);
      if (!job) {
        return res.status(404).json({ error: 'Job non trovato' });
      }

      logger.logApiCall('GET', `/api/jobs/${req.params.jobId}`, req.username, 200);
      res.json(job);
    } catch (error) {
      logger.error('Errore caricamento job', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.post('/api/clients/:hostname/jobs', requireAuth, async (req, res) => {
    try {
      const normalizedJob = normalizeJobPayload(req.body, req.params.hostname);
      const existingJob = storage.loadJob(normalizedJob.job_id);
      if (existingJob) {
        return res.status(400).json({ error: 'Job già esistente' });
      }

      const saved = storage.saveJob(normalizedJob);
      if (!saved) {
        return res.status(500).json({ error: 'Errore salvataggio job' });
      }

      await scheduler.reloadJobs();
      logger.logApiCall('POST', `/api/clients/${req.params.hostname}/jobs`, req.username, 201);
      res.status(201).json({ success: true, job: normalizedJob });
    } catch (error) {
      logger.error('Errore creazione job', { error: error.message });
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/api/jobs', requireAuth, async (req, res) => {
    try {
      const normalizedJob = normalizeJobPayload(req.body);
      const existingJob = storage.loadJob(normalizedJob.job_id);
      if (existingJob) {
        return res.status(400).json({ error: 'Job già esistente' });
      }

      const saved = storage.saveJob(normalizedJob);
      if (!saved) {
        return res.status(500).json({ error: 'Errore salvataggio job' });
      }

      scheduler.onJobsChanged();
      logger.logApiCall('POST', '/api/jobs', req.username, 201);
      res.status(201).json({ success: true, job: normalizedJob });
    } catch (error) {
      logger.error('Errore creazione job', { error: error.message });
      res.status(400).json({ error: error.message });
    }
  });

  router.put('/api/jobs/:jobId', requireAuth, async (req, res) => {
    try {
      const normalizedJob = normalizeJobPayload({ ...req.body, job_id: req.params.jobId });
      const saved = storage.saveJob(normalizedJob);
      if (!saved) {
        return res.status(500).json({ error: 'Errore salvataggio job' });
      }

      scheduler.onJobsChanged();
      logger.logApiCall('PUT', `/api/jobs/${req.params.jobId}`, req.username, 200);
      res.json({ success: true, job: normalizedJob });
    } catch (error) {
      logger.error('Errore aggiornamento job', { error: error.message });
      res.status(400).json({ error: error.message });
    }
  });

  router.delete('/api/jobs/:jobId', requireAuth, async (req, res) => {
    try {
      const deleted = storage.deleteJob(req.params.jobId);
      if (!deleted) {
        return res.status(500).json({ error: 'Errore eliminazione job' });
      }

      scheduler.onJobsChanged();
      logger.logApiCall('DELETE', `/api/jobs/${req.params.jobId}`, req.username, 200);
      res.json({ success: true });
    } catch (error) {
      logger.error('Errore eliminazione job', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.post('/api/jobs/:jobId/run', requireAuth, async (req, res) => {
    try {
      const result = await scheduler.executeJobManually(req.params.jobId);
      logger.logApiCall('POST', `/api/jobs/${req.params.jobId}/run`, req.username, 200);
      res.json(result);
    } catch (error) {
      logger.error('Errore esecuzione manuale job', {
        jobId: req.params.jobId,
        error: error.message
      });

      if (error.code === 'JOB_NOT_FOUND') {
        return res.status(404).json({ error: error.message });
      }

      if (error.code === 'JOB_RUNNING') {
        return res.status(409).json({ error: error.message });
      }

      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/scheduler/jobs', requireAuth, (req, res) => {
    try {
      const scheduledJobs = scheduler.getScheduledJobs();
      logger.logApiCall('GET', '/api/scheduler/jobs', req.username, 200);
      res.json(scheduledJobs);
    } catch (error) {
      logger.error('Errore caricamento scheduled jobs', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.post('/api/scheduler/reload', requireAuth, async (req, res) => {
    try {
      await scheduler.reloadJobs();
      logger.logApiCall('POST', '/api/scheduler/reload', req.username, 200);
      res.json({ success: true });
    } catch (error) {
      logger.error('Errore ricaricamento scheduler', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });
}

module.exports = registerJobRoutes;
