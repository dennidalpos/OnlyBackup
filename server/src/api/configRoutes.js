function registerConfigRoutes(router, deps) {
  const {
    requireAuth,
    logger,
    storage,
    authManager,
    scheduler
  } = deps;

  router.get('/api/config/export', requireAuth, (req, res) => {
    try {
      const sectionsParam = req.query.sections || 'jobs,users,clients,email';
      const sections = sectionsParam.split(',').map(s => s.trim());
      const buildExportPayload = () => ({
        version: '1.0',
        exportDate: new Date().toISOString(),
        sections: []
      });

      const config = {
        ...buildExportPayload()
      };

      if (sections.includes('jobs')) {
        const allJobs = storage.loadAllJobs();
        config.jobs = allJobs;
        config.sections.push('jobs');
      }

      if (sections.includes('users')) {
        const users = authManager.getAllUsers();
        config.users = users;
        config.sections.push('users');
      }

      if (sections.includes('clients')) {
        const heartbeats = storage.loadAllAgentHeartbeats();
        const allJobs = storage.loadAllJobs();
        const clientHostnames = new Set();
        allJobs.forEach(job => clientHostnames.add(job.client_hostname));
        heartbeats.forEach(hb => clientHostnames.add(hb.hostname));
        const heartbeatMap = new Map(heartbeats.map(hb => [hb.hostname, hb]));
        config.clients = Array.from(clientHostnames).map(hostname => ({
          hostname,
          heartbeat: heartbeatMap.get(hostname) || null
        }));
        config.sections.push('clients');
      }

      if (sections.includes('email')) {
        const emailService = req.app.get('emailService');
        if (emailService) {
          config.email = {
            settings: emailService.getRawSettings(),
            templates: emailService.getTemplates()
          };
          config.sections.push('email');
        }
      }

      logger.logApiCall('GET', '/api/config/export', req.username, 200);
      res.json(config);
    } catch (error) {
      logger.error('Errore export configurazione', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.post('/api/config/import', requireAuth, async (req, res) => {
    try {
      const { config, sections } = req.body;
      if (!config || !config.version) {
        return res.status(400).json({ error: 'Configurazione non valida' });
      }

      const sectionsToImport = sections || config.sections || ['jobs', 'users', 'clients', 'email'];
      const imported = { jobs: 0, users: 0, clients: 0, email: 0 };

      if (sectionsToImport.includes('users') && Array.isArray(config.users)) {
        for (const user of config.users) {
          if (user.username && user.passwordHash) {
            const result = await authManager.importUser(user);
            if (result.success) {
              imported.users++;
            }
          }
        }
      }

      if (sectionsToImport.includes('jobs') && Array.isArray(config.jobs)) {
        for (const job of config.jobs) {
          if (job.job_id && job.client_hostname) {
            const result = storage.saveJob(job);
            if (result) {
              imported.jobs++;
            }
          }
        }
      }

      if (sectionsToImport.includes('clients') && Array.isArray(config.clients)) {
        for (const client of config.clients) {
          if (!client || !client.hostname) {
            continue;
          }
          if (client.heartbeat && client.heartbeat.hostname) {
            storage.saveAgentHeartbeat(client.heartbeat);
          }
          imported.clients++;
        }
      }

      if (sectionsToImport.includes('email') && config.email) {
        const emailService = req.app.get('emailService');
        if (emailService) {
          if (config.email.settings) {
            emailService.updateSettings(config.email.settings);
          }
          if (config.email.templates) {
            emailService.updateTemplates(config.email.templates);
          }
          imported.email = 1;
        }
      }

      await scheduler.reloadJobs();
      logger.logApiCall('POST', '/api/config/import', req.username, 200);
      res.json({ success: true, imported, sections: sectionsToImport });
    } catch (error) {
      logger.error('Errore import configurazione', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });
}

module.exports = registerConfigRoutes;
