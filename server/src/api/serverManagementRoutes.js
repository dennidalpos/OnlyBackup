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
}

module.exports = registerServerManagementRoutes;
