function registerAuthRoutes(router, deps) {
  const {
    authManager,
    logger,
    requireAuth,
    buildSessionCookieOptions
  } = deps;

  router.post('/api/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'Username e password richiesti' });
      }

      const result = await authManager.authenticate(username, password);
      if (!result.success) {
        return res.status(401).json({ error: result.reason });
      }

      res.cookie('sessionId', result.sessionId, buildSessionCookieOptions(req));
      logger.logApiCall('POST', '/api/auth/login', username, 200);
      res.json({
        success: true,
        username: result.username,
        role: result.role,
        mustChangePassword: result.mustChangePassword
      });
    } catch (error) {
      logger.error('Errore login', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.post('/api/auth/logout', (req, res) => {
    const sessionId = req.cookies.sessionId;
    if (sessionId) {
      authManager.logout(sessionId);
    }

    res.clearCookie('sessionId', buildSessionCookieOptions(req));
    res.json({ success: true });
  });

  router.post('/api/auth/change-password', requireAuth, (req, res) => {
    try {
      const { oldPassword, newPassword } = req.body;
      if (!oldPassword || !newPassword) {
        return res.status(400).json({ error: 'Vecchia e nuova password richieste' });
      }

      const result = authManager.changePassword(req.username, oldPassword, newPassword);
      if (!result.success) {
        return res.status(400).json({ error: result.reason });
      }

      logger.logApiCall('POST', '/api/auth/change-password', req.username, 200);
      res.json({ success: true });
    } catch (error) {
      logger.error('Errore cambio password', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.get('/api/auth/status', requireAuth, (req, res) => {
    const users = authManager.getUsers();
    const user = users.find(u => u.username === req.username);
    res.json({
      authenticated: true,
      username: req.username,
      mustChangePassword: user?.mustChangePassword || false
    });
  });

  router.post('/api/auth/reset-password', requireAuth, async (req, res) => {
    try {
      const { newPassword } = req.body;
      if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ error: 'La password deve essere di almeno 8 caratteri' });
      }

      const result = await authManager.resetPassword(req.username, newPassword);
      if (!result.success) {
        return res.status(500).json({ error: result.reason || 'Errore durante il reset password' });
      }

      logger.logApiCall('POST', '/api/auth/reset-password', req.username, 200);
      res.json({ success: true });
    } catch (error) {
      logger.error('Errore reset password', { username: req.username, error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });
}

module.exports = registerAuthRoutes;
