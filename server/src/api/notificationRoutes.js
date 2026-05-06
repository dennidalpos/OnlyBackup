function registerNotificationRoutes(router, deps) {
  const {
    requireAuth,
    logger,
    cleanupOauthStates,
    getOAuthConfig,
    buildOAuthAuthorizationUrl,
    buildOAuthRedirect,
    createCodeVerifier,
    createCodeChallenge,
    base64UrlEncode,
    createState,
    exchangeOAuthCode,
    getPublicBaseUrl,
    oauthStateStore
  } = deps;

  const getOAuthProviderCredentials = (req, provider) => {
    const providerConfig = req.app.get('config')?.oauth?.providers?.[provider] || {};
    const envName = String(provider || '').toUpperCase();

    return {
      clientId: providerConfig.clientId || process.env[`ONLYBACKUP_OAUTH_${envName}_CLIENT_ID`] || '',
      clientSecret: providerConfig.clientSecret || process.env[`ONLYBACKUP_OAUTH_${envName}_CLIENT_SECRET`] || ''
    };
  };

  router.get('/api/email/settings', requireAuth, (req, res) => {
    try {
      const emailService = req.app.get('emailService');
      if (!emailService) {
        return res.status(500).json({ error: 'Servizio email non disponibile' });
      }

      const settings = emailService.getSettings();
      logger.logApiCall('GET', '/api/email/settings', req.username, 200);
      res.json(settings);
    } catch (error) {
      logger.error('Errore recupero impostazioni email', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.put('/api/email/settings', requireAuth, (req, res) => {
    try {
      const emailService = req.app.get('emailService');
      if (!emailService) {
        return res.status(500).json({ error: 'Servizio email non disponibile' });
      }

      const result = emailService.updateSettings(req.body);

      if (!result.success) {
        return res.status(400).json({ error: result.error || 'Errore aggiornamento impostazioni' });
      }

      logger.logApiCall('PUT', '/api/email/settings', req.username, 200);
      res.json({ success: true });
    } catch (error) {
      logger.error('Errore aggiornamento impostazioni email', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.get('/api/email/templates', requireAuth, (req, res) => {
    try {
      const emailService = req.app.get('emailService');
      if (!emailService) {
        return res.status(500).json({ error: 'Servizio email non disponibile' });
      }

      const templates = emailService.getTemplates();
      logger.logApiCall('GET', '/api/email/templates', req.username, 200);
      res.json(templates);
    } catch (error) {
      logger.error('Errore recupero template email', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.put('/api/email/templates', requireAuth, (req, res) => {
    try {
      const emailService = req.app.get('emailService');
      if (!emailService) {
        return res.status(500).json({ error: 'Servizio email non disponibile' });
      }

      const result = emailService.updateTemplates(req.body);

      if (!result.success) {
        return res.status(400).json({ error: result.error || 'Errore aggiornamento template' });
      }

      logger.logApiCall('PUT', '/api/email/templates', req.username, 200);
      res.json({ success: true });
    } catch (error) {
      logger.error('Errore aggiornamento template email', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.post('/api/email/oauth/start', requireAuth, async (req, res) => {
    try {
      cleanupOauthStates();
      const { provider, clientId, clientSecret, authUser, returnTo, popup } = req.body || {};
      const config = getOAuthConfig(provider);

      if (!config) {
        return res.status(400).json({ error: 'Provider OAuth non supportato' });
      }

      const emailService = req.app.get('emailService');
      if (!emailService) {
        return res.status(500).json({ error: 'Servizio email non disponibile' });
      }

      const currentSettings = emailService.getRawSettings();
      const providerCredentials = getOAuthProviderCredentials(req, provider);
      const resolvedClientId = providerCredentials.clientId || clientId || currentSettings?.smtp?.oauth2?.clientId;
      const resolvedClientSecret = providerCredentials.clientSecret || clientSecret || currentSettings?.smtp?.oauth2?.clientSecret;
      const resolvedAuthUser = authUser || currentSettings?.smtp?.auth?.user;

      if (!resolvedClientId || !resolvedClientSecret) {
        return res.status(400).json({
          error: `Provider OAuth ${provider} non configurato sul server. Configura l'app OAuth OnlyBackup per il provider selezionato.`
        });
      }

      if (!resolvedAuthUser) {
        return res.status(400).json({ error: 'Email account obbligatoria' });
      }

      const codeVerifier = createCodeVerifier();
      const codeChallenge = createCodeChallenge(codeVerifier);
      const state = createState();
      const redirectUri = `${getPublicBaseUrl(req)}/api/email/oauth/callback`;

      oauthStateStore.set(state, {
        provider,
        clientId: resolvedClientId,
        clientSecret: resolvedClientSecret,
        authUser: resolvedAuthUser,
        codeVerifier,
        redirectUri,
        returnTo,
        popup: popup === true,
        createdAt: Date.now()
      });

      const url = await buildOAuthAuthorizationUrl(provider, {
        clientId: resolvedClientId,
        clientSecret: resolvedClientSecret
      }, {
        redirectUri,
        state,
        authUser: resolvedAuthUser,
        codeChallenge
      });

      res.json({ url });
    } catch (error) {
      logger.error('Errore avvio OAuth email', { error: error.message });
      res.status(500).json({ error: 'Errore avvio OAuth email' });
    }
  });

  router.get('/api/email/oauth/callback', requireAuth, async (req, res) => {
    const { code, state, error, error_description } = req.query || {};

    if (error) {
      const stateData = state ? oauthStateStore.get(state) : null;
      if (stateData) {
        oauthStateStore.delete(state);
      }
      return res.redirect(buildOAuthRedirect(stateData?.returnTo, {
        oauth: 'error',
        message: error_description || error,
        oauthPopup: stateData?.popup ? '1' : undefined
      }));
    }

    if (!code || !state) {
      return res.redirect(buildOAuthRedirect(null, {
        oauth: 'error',
        message: 'Codice OAuth non valido'
      }));
    }

    const stateData = oauthStateStore.get(state);
    if (!stateData) {
      return res.redirect(buildOAuthRedirect(null, {
        oauth: 'error',
        message: 'Sessione OAuth scaduta'
      }));
    }

    oauthStateStore.delete(state);

    try {
      const config = getOAuthConfig(stateData.provider);
      if (!config) {
        return res.redirect(buildOAuthRedirect(stateData.returnTo, {
          oauth: 'error',
          message: 'Provider OAuth non supportato',
          oauthPopup: stateData.popup ? '1' : undefined
        }));
      }

      const tokenData = await exchangeOAuthCode(stateData.provider, {
        clientId: stateData.clientId,
        clientSecret: stateData.clientSecret
      }, {
        code,
        redirectUri: stateData.redirectUri,
        codeVerifier: stateData.codeVerifier
      });

      const emailService = req.app.get('emailService');
      if (!emailService) {
        return res.redirect(buildOAuthRedirect(stateData.returnTo, {
          oauth: 'error',
          message: 'Servizio email non disponibile',
          oauthPopup: stateData.popup ? '1' : undefined
        }));
      }

      const currentSettings = emailService.getRawSettings();
      const fallbackRefreshToken = currentSettings?.smtp?.oauth2?.refreshToken;
      const refreshToken = tokenData.refreshToken || fallbackRefreshToken || '';

      if (stateData.provider === 'google' && !refreshToken) {
        return res.redirect(buildOAuthRedirect(stateData.returnTo, {
          oauth: 'error',
          message: 'Refresh token non ricevuto. Ripetere il consenso.',
          oauthPopup: stateData.popup ? '1' : undefined
        }));
      }

      const updatedSettings = {
        ...currentSettings,
        smtp: {
          ...currentSettings.smtp,
          auth: {
            ...currentSettings.smtp?.auth,
            type: 'oauth2',
            user: stateData.authUser
          },
          oauth2: {
            ...currentSettings.smtp?.oauth2,
            provider: stateData.provider,
            clientId: null,
            clientSecret: null,
            refreshToken,
            accessToken: tokenData.accessToken || currentSettings.smtp?.oauth2?.accessToken || '',
            expiresAt: tokenData.expiresAt || currentSettings.smtp?.oauth2?.expiresAt || null,
            tokenCache: tokenData.tokenCache || currentSettings.smtp?.oauth2?.tokenCache || '',
            account: tokenData.account || currentSettings.smtp?.oauth2?.account || null
          }
        }
      };

      const result = emailService.updateSettings(updatedSettings);
      if (!result.success) {
        return res.redirect(buildOAuthRedirect(stateData.returnTo, {
          oauth: 'error',
          message: result.error || 'Errore salvataggio impostazioni OAuth',
          oauthPopup: stateData.popup ? '1' : undefined
        }));
      }

      return res.redirect(buildOAuthRedirect(stateData.returnTo, {
        oauth: 'success',
        provider: stateData.provider,
        oauthPopup: stateData.popup ? '1' : undefined
      }));
    } catch (err) {
      logger.error('Errore callback OAuth email', { error: err.message });
      return res.redirect(buildOAuthRedirect(stateData?.returnTo, {
        oauth: 'error',
        message: err.message || 'Errore callback OAuth',
        oauthPopup: stateData?.popup ? '1' : undefined
      }));
    }
  });

  router.post('/api/email/test', requireAuth, async (req, res) => {
    try {
      const emailService = req.app.get('emailService');
      if (!emailService) {
        return res.status(500).json({ error: 'Servizio email non disponibile' });
      }

      const { recipient } = req.body;
      if (!recipient) {
        return res.status(400).json({ error: 'Destinatario richiesto' });
      }

      const result = await emailService.sendTestEmail(recipient);

      if (!result.success) {
        return res.status(400).json({ error: result.error || 'Errore invio email di test' });
      }

      logger.logApiCall('POST', '/api/email/test', req.username, 200);
      res.json({ success: true, messageId: result.messageId });
    } catch (error) {
      logger.error('Errore invio email di test', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.get('/api/alerts', requireAuth, (req, res) => {
    try {
      const alertService = req.app.get('alertService');
      if (!alertService) {
        return res.status(500).json({ error: 'Servizio alert non disponibile' });
      }

      const alerts = alertService.getActiveAlerts();
      logger.logApiCall('GET', '/api/alerts', req.username, 200);
      res.json({ alerts });
    } catch (error) {
      logger.error('Errore recupero alerts', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.get('/api/alerts/history', requireAuth, (req, res) => {
    try {
      const alertService = req.app.get('alertService');
      if (!alertService) {
        return res.status(500).json({ error: 'Servizio alert non disponibile' });
      }

      const alerts = alertService.getAllAlerts();
      logger.logApiCall('GET', '/api/alerts/history', req.username, 200);
      res.json({ alerts });
    } catch (error) {
      logger.error('Errore recupero storico alerts', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.delete('/api/alerts/history', requireAuth, (req, res) => {
    try {
      const alertService = req.app.get('alertService');
      if (!alertService) {
        return res.status(500).json({ error: 'Servizio alert non disponibile' });
      }

      const deletedCount = alertService.deleteAllAlerts();
      logger.logApiCall('DELETE', '/api/alerts/history', req.username, 200);
      res.json({ success: true, deletedCount });
    } catch (error) {
      logger.error('Errore eliminazione storico alerts', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.post('/api/alerts/:alertId/resolve', requireAuth, (req, res) => {
    try {
      const alertService = req.app.get('alertService');
      if (!alertService) {
        return res.status(500).json({ error: 'Servizio alert non disponibile' });
      }

      const { alertId } = req.params;
      const result = alertService.resolveAlert(alertId);

      if (!result) {
        return res.status(404).json({ error: 'Alert non trovato' });
      }

      logger.logApiCall('POST', `/api/alerts/${alertId}/resolve`, req.username, 200);
      res.json({ success: true });
    } catch (error) {
      logger.error('Errore risoluzione alert', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.delete('/api/alerts/:alertId', requireAuth, (req, res) => {
    try {
      const alertService = req.app.get('alertService');
      if (!alertService) {
        return res.status(500).json({ error: 'Servizio alert non disponibile' });
      }

      const { alertId } = req.params;
      const result = alertService.deleteAlert(alertId);

      if (!result) {
        return res.status(404).json({ error: 'Alert non trovato' });
      }

      logger.logApiCall('DELETE', `/api/alerts/${alertId}`, req.username, 200);
      res.json({ success: true });
    } catch (error) {
      logger.error('Errore eliminazione alert', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });
}

module.exports = registerNotificationRoutes;
