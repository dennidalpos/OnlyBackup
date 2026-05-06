function registerServerManagementRoutes(router, deps) {
  const { requireAuth, logger } = deps;

  router.post('/api/server/reboot', requireAuth, async (req, res) => {
    try {
      if (req.user && req.user.role !== 'admin') {
        logger.logApiCall('POST', '/api/server/reboot', req.username, 403);
        return res.status(403).json({ error: 'Accesso negato. Solo amministratori.' });
      }

      const serverService = req.app.get('serverService');
      if (!serverService) {
        return res.status(500).json({ error: 'Servizio server non disponibile' });
      }

      logger.warn('Riavvio server richiesto', {
        user: req.username,
        ip: req.ip,
        timestamp: new Date().toISOString()
      });

      const result = await serverService.smartRestart();

      logger.logApiCall('POST', '/api/server/reboot', req.username, 200);
      res.json(result);
    } catch (error) {
      logger.error('Errore riavvio server', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.get('/api/server/service', requireAuth, async (req, res) => {
    try {
      if (req.user && req.user.role !== 'admin') {
        logger.logApiCall('GET', '/api/server/service', req.username, 403);
        return res.status(403).json({ error: 'Accesso negato. Solo amministratori.' });
      }

      const serverService = req.app.get('serverService');
      if (!serverService) {
        return res.status(500).json({ error: 'Servizio server non disponibile' });
      }

      const result = await serverService.getWindowsServiceStatus();
      logger.logApiCall('GET', '/api/server/service', req.username, 200);
      res.json(result);
    } catch (error) {
      logger.error('Errore stato servizio server', { error: error.message });
      res.status(500).json({ error: error.message || 'Errore interno' });
    }
  });

  router.post('/api/server/service/:action', requireAuth, async (req, res) => {
    try {
      if (req.user && req.user.role !== 'admin') {
        logger.logApiCall('POST', '/api/server/service/:action', req.username, 403);
        return res.status(403).json({ error: 'Accesso negato. Solo amministratori.' });
      }

      const serverService = req.app.get('serverService');
      if (!serverService) {
        return res.status(500).json({ error: 'Servizio server non disponibile' });
      }

      const result = await serverService.controlWindowsService(req.params.action);
      logger.logApiCall('POST', '/api/server/service/:action', req.username, 200);
      res.json(result);
    } catch (error) {
      logger.error('Errore controllo servizio server', { action: req.params.action, error: error.message });
      res.status(500).json({ error: error.message || 'Errore interno' });
    }
  });
}

module.exports = registerServerManagementRoutes;
