const express = require('express');

const registerAgentRoutes = require('./agentRoutes');
const registerAuthRoutes = require('./authRoutes');
const registerBackupRoutes = require('./backupRoutes');
const registerClientRoutes = require('./clientRoutes');
const registerConfigRoutes = require('./configRoutes');
const registerJobRoutes = require('./jobRoutes');
const registerMaintenanceRoutes = require('./maintenanceRoutes');
const registerMonitoringRoutes = require('./monitoringRoutes');
const registerNotificationRoutes = require('./notificationRoutes');
const registerServerManagementRoutes = require('./serverManagementRoutes');
const createRouteSupport = require('./routeSupport');

function setupRoutes(app, authManager, storage, scheduler, logger) {
  const router = express.Router();
  const support = createRouteSupport({ authManager, storage, logger });

  registerAgentRoutes(router, {
    requireAuth: support.requireAuth,
    logger,
    storage,
    HEARTBEAT_TTL_MS: support.HEARTBEAT_TTL_MS,
    extractClientIp: support.extractClientIp
  });

  registerAuthRoutes(router, {
    authManager,
    logger,
    requireAuth: support.requireAuth,
    buildSessionCookieOptions: support.buildSessionCookieOptions
  });

  registerMonitoringRoutes(router, {
    requireAuth: support.requireAuth,
    logger,
    storage,
    respondFromCache: support.respondFromCache,
    sendCachedResponse: support.sendCachedResponse,
    STATS_CACHE_TTL_MS: support.STATS_CACHE_TTL_MS,
    buildAgentStatusMap: support.buildAgentStatusMap,
    readLogFile: support.readLogFile,
    readLogIndexPaths: support.readLogIndexPaths,
    findLatestRunLog: support.findLatestRunLog,
    getOnlineAgentInfo: support.getOnlineAgentInfo,
    callAgentJobBackups: support.callAgentJobBackups,
    callAgentDelete: support.callAgentDelete,
    pathsOverlap: support.pathsOverlap
  });

  registerJobRoutes(router, {
    requireAuth: support.requireAuth,
    logger,
    storage,
    scheduler,
    normalizeJobPayload: support.normalizeJobPayload
  });

  registerClientRoutes(router, {
    requireAuth: support.requireAuth,
    logger,
    storage,
    scheduler,
    respondFromCache: support.respondFromCache,
    sendCachedResponse: support.sendCachedResponse,
    CLIENTS_CACHE_TTL_MS: support.CLIENTS_CACHE_TTL_MS,
    buildAgentStatusMap: support.buildAgentStatusMap,
    callAgentFilesystem: support.callAgentFilesystem,
    getOnlineAgentInfo: support.getOnlineAgentInfo
  });

  registerConfigRoutes(router, {
    requireAuth: support.requireAuth,
    logger,
    storage,
    authManager,
    scheduler
  });

  registerMaintenanceRoutes(router, {
    requireAuth: support.requireAuth,
    logger,
    storage
  });

  registerBackupRoutes(router, {
    requireAuth: support.requireAuth,
    logger,
    storage,
    respondFromCache: support.respondFromCache,
    backupAnalyzeCache: support.backupAnalyzeCache,
    getOnlineAgentInfo: support.getOnlineAgentInfo,
    callAgentJobBackups: support.callAgentJobBackups,
    sendCachedResponse: support.sendCachedResponse,
    BACKUP_ANALYZE_CACHE_TTL_MS: support.BACKUP_ANALYZE_CACHE_TTL_MS
  });

  registerNotificationRoutes(router, {
    requireAuth: support.requireAuth,
    logger,
    cleanupOauthStates: support.cleanupOauthStates,
    getOAuthConfig: support.getOAuthConfig,
    buildOAuthRedirect: support.buildOAuthRedirect,
    createCodeVerifier: support.createCodeVerifier,
    createCodeChallenge: support.createCodeChallenge,
    base64UrlEncode: support.base64UrlEncode,
    createState: support.createState,
    exchangeOAuthCode: support.exchangeOAuthCode,
    getPublicBaseUrl: support.getPublicBaseUrl,
    oauthStateStore: support.oauthStateStore
  });

  registerServerManagementRoutes(router, {
    requireAuth: support.requireAuth,
    logger
  });

  app.use(router);
}

module.exports = setupRoutes;
