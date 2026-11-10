const fs = require('fs');
const path = require('path');
const sseManager = require('../events/sseManager');
const { sanitizePathSegment } = require('../shared/pathSegments');

function registerMaintenanceRoutes(router, deps) {
  const {
    requireAuth,
    logger,
    reqAppConfigAccessor = (req, key) => req.app.get(key),
    storage
  } = deps;

  router.delete('/api/runs/all', requireAuth, async (req, res) => {
    try {
      const deletedCount = storage.deleteAllRuns();

      logger.logApiCall('DELETE', '/api/runs/all', req.username, 200);
      logger.info('Eliminati tutti i log', { count: deletedCount, user: req.username });
      res.json({ success: true, deletedCount });
    } catch (error) {
      logger.error('Errore eliminazione tutti i log', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.get('/api/logs/retention', requireAuth, (req, res) => {
    try {
      const config = reqAppConfigAccessor(req, 'config');
      const retentionDays = Number.isFinite(Number(config?.logging?.retentionDays))
        ? Number(config.logging.retentionDays)
        : 0;

      logger.logApiCall('GET', '/api/logs/retention', req.username, 200);
      res.json({ retentionDays });
    } catch (error) {
      logger.error('Errore recupero retention log', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.put('/api/logs/retention', requireAuth, (req, res) => {
    try {
      const retentionDays = Number(req.body?.retentionDays);
      if (!Number.isFinite(retentionDays) || retentionDays < 0) {
        return res.status(400).json({ error: 'Valore retentionDays non valido' });
      }

      const configPath = reqAppConfigAccessor(req, 'configPath');
      if (!configPath) {
        return res.status(500).json({ error: 'Percorso configurazione non disponibile' });
      }

      const configData = fs.readFileSync(configPath, 'utf8');
      const diskConfig = JSON.parse(configData);
      diskConfig.logging = diskConfig.logging || {};
      diskConfig.logging.retentionDays = retentionDays;
      fs.writeFileSync(configPath, JSON.stringify(diskConfig, null, 2), 'utf8');

      const runtimeConfig = reqAppConfigAccessor(req, 'config');
      if (runtimeConfig) {
        runtimeConfig.logging = runtimeConfig.logging || {};
        runtimeConfig.logging.retentionDays = retentionDays;
      }

      if (logger?.updateLogRetention) {
        logger.updateLogRetention(retentionDays);
      }

      logger.logApiCall('PUT', '/api/logs/retention', req.username, 200);
      res.json({ success: true, retentionDays });
    } catch (error) {
      logger.error('Errore aggiornamento retention log', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.get('/api/events', requireAuth, (req, res) => {
    const clientId = req.username || `user_${Date.now()}`;
    logger.debug('SSE client connesso', { username: req.username });

    sseManager.addClient(clientId, res);

    req.on('close', () => {
      logger.debug('SSE client disconnesso', { username: req.username });
    });
  });

  router.post('/api/logs/upload', (req, res) => {
    try {
      const { hostname, jobId, runId, logContent } = req.body || {};

      if (!hostname || !jobId || !runId || !logContent) {
        return res.status(400).json({ error: 'Parametri mancanti' });
      }

      const safeHost = sanitizePathSegment(hostname);
      const safeJob = sanitizePathSegment(jobId);
      const safeRun = sanitizePathSegment(runId);

      const logDir = path.join(storage.dataRoot, 'logs', safeHost, safeJob);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const logPath = path.join(logDir, `${safeRun}.log`);
      fs.writeFileSync(logPath, logContent, 'utf8');

      logger.logApiCall('POST', '/api/logs/upload', hostname, 200);
      res.json({ success: true, path: logPath });
    } catch (error) {
      logger.error('Errore upload log', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.get('/api/logs', requireAuth, (req, res) => {
    try {
      const { clientId, jobId, runId } = req.query;

      if (!clientId || !jobId) {
        return res.status(400).json({ error: 'clientId e jobId richiesti' });
      }

      const safeHost = sanitizePathSegment(clientId);
      const safeJob = sanitizePathSegment(jobId);
      const logDir = path.join(storage.dataRoot, 'logs', safeHost, safeJob);

      if (!fs.existsSync(logDir)) {
        return res.status(404).json({ error: 'Nessun log disponibile' });
      }

      if (runId) {
        const safeRun = sanitizePathSegment(runId);
        const logPath = path.join(logDir, `${safeRun}.log`);

        if (!fs.existsSync(logPath)) {
          return res.status(404).json({ error: 'Log non trovato' });
        }

        const content = fs.readFileSync(logPath, 'utf8');
        logger.logApiCall('GET', '/api/logs', req.username, 200);
        return res.json({ content, path: logPath, run_id: runId });
      }

      const files = fs.readdirSync(logDir).filter(f => f.endsWith('.log'));
      logger.logApiCall('GET', '/api/logs', req.username, 200);
      res.json({ logs: files.map(f => ({ filename: f, run_id: path.basename(f, '.log') })) });
    } catch (error) {
      logger.error('Errore recupero log', { error: error.message });
      res.status(500).json({ error: 'Errore recupero log dal server' });
    }
  });

  router.get('/api/logs/download', requireAuth, (req, res) => {
    try {
      const { clientId, jobId, runId } = req.query;

      if (!clientId || !jobId || !runId) {
        return res.status(400).json({ error: 'Parametri mancanti' });
      }

      const safeHost = sanitizePathSegment(clientId);
      const safeJob = sanitizePathSegment(jobId);
      const safeRun = sanitizePathSegment(runId);
      const logPath = path.join(storage.dataRoot, 'logs', safeHost, safeJob, `${safeRun}.log`);

      if (!fs.existsSync(logPath)) {
        return res.status(404).json({ error: 'Log non trovato' });
      }

      logger.logApiCall('GET', '/api/logs/download', req.username, 200);
      res.download(logPath, `${safeHost}_${safeJob}_${safeRun}.log`);
    } catch (error) {
      logger.error('Errore download log', { error: error.message });
      res.status(500).json({ error: 'Errore download log' });
    }
  });

  router.get('/api/clients/:hostname/jobs/:jobId/retention/events', requireAuth, (req, res) => {
    try {
      const { hostname, jobId } = req.params;
      const { runId } = req.query;

      if (!runId) {
        return res.status(400).json({ error: 'runId richiesto' });
      }

      const safeHost = sanitizePathSegment(hostname);
      const safeJob = sanitizePathSegment(jobId);
      const eventsDir = path.join(storage.dataRoot, 'logs', safeHost, safeJob);

      if (!fs.existsSync(eventsDir)) {
        return res.json({ events: [] });
      }

      const files = fs.readdirSync(eventsDir).filter(f => f.endsWith('.retention.json'));
      const allEvents = [];

      for (const file of files) {
        try {
          const filePath = path.join(eventsDir, file);
          const content = fs.readFileSync(filePath, 'utf8');
          const data = JSON.parse(content);

          if (data.run_id === runId && Array.isArray(data.events)) {
            allEvents.push(...data.events);
          }
        } catch (err) {
          logger.warn('Errore lettura file eventi retention', { file, error: err.message });
        }
      }

      logger.logApiCall('GET', `/api/clients/${hostname}/jobs/${jobId}/retention/events`, req.username, 200);
      res.json({ run_id: runId, events: allEvents });
    } catch (error) {
      logger.error('Errore recupero eventi retention', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });
}

module.exports = registerMaintenanceRoutes;
