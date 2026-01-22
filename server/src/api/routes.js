const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function setupRoutes(app, authManager, storage, scheduler, logger) {
  const router = express.Router();
  const HEARTBEAT_TTL_MS = 2 * 60 * 1000;
  const VALID_MODES = ['copy', 'sync'];
  const STATS_CACHE_TTL_MS = 15000;
  const CLIENTS_CACHE_TTL_MS = 15000;
  const BACKUP_ANALYZE_CACHE_TTL_MS = 30000;
  const responseCache = new Map();
  const backupAnalyzeCache = new Map();
  const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
  const oauthStateStore = new Map();

  const base64UrlEncode = (buffer) => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const createCodeVerifier = () => base64UrlEncode(crypto.randomBytes(32));

  const createCodeChallenge = (verifier) => base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());

  const cleanupOauthStates = () => {
    const now = Date.now();
    for (const [key, value] of oauthStateStore.entries()) {
      if (!value || now - value.createdAt > OAUTH_STATE_TTL_MS) {
        oauthStateStore.delete(key);
      }
    }
  };

  const getOAuthConfig = (provider) => {
    if (provider === 'google') {
      return {
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        scope: 'https://mail.google.com/ https://www.googleapis.com/auth/userinfo.email'
      };
    }

    if (provider === 'microsoft') {
      return {
        authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        scope: 'offline_access https://outlook.office.com/SMTP.Send'
      };
    }

    return null;
  };

  const buildOAuthRedirect = (returnTo, params) => {
    const safeReturnTo = typeof returnTo === 'string' && returnTo.startsWith('/') ? returnTo : '/email-settings.html';
    const search = new URLSearchParams(params);
    return `${safeReturnTo}?${search.toString()}`;
  };

  const exchangeOAuthCode = async (tokenUrl, payload) => {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      const errorMessage = data.error_description || data.error || 'Errore scambio token';
      throw new Error(errorMessage);
    }

    return data;
  };

  const getPublicBaseUrl = (req) => {
    const config = req.app.get('config');
    const configuredUrl = config?.server?.publicUrl;
    if (configuredUrl) {
      return configuredUrl.replace(/\/$/, '');
    }

    const proto = req.get('x-forwarded-proto') || req.protocol;
    const host = req.get('x-forwarded-host') || req.get('host');
    return `${proto}://${host}`;
  };

  const normalizeWindowsPath = (pathStr) => {
    if (!pathStr) return '';

    let normalized = pathStr.replace(/\//g, '\\');

    normalized = normalized.replace(/\\+$/, '');
    if (normalized.length === 2 && normalized[1] === ':') {
      normalized += '\\';
    }

    if (normalized.startsWith('\\\\')) {
      const uncPart = '\\\\';
      let rest = normalized.substring(2);
      while (rest.includes('\\\\')) {
        rest = rest.replace(/\\\\/g, '\\');
      }
      normalized = uncPart + rest;
    } else {
      while (normalized.includes('\\\\')) {
        normalized = normalized.replace(/\\\\/g, '\\');
      }
    }

    return normalized;
  };

  const pathsAreEqual = (path1, path2) => {
    if (!path1 || !path2) return false;
    const n1 = normalizeWindowsPath(path1).replace(/\\+$/, '').toLowerCase();
    const n2 = normalizeWindowsPath(path2).replace(/\\+$/, '').toLowerCase();
    return n1 === n2;
  };

  const pathsOverlap = (path1, path2) => {
    if (!path1 || !path2) return false;
    const n1 = normalizeWindowsPath(path1).replace(/\\+$/, '').toLowerCase() + '\\';
    const n2 = normalizeWindowsPath(path2).replace(/\\+$/, '').toLowerCase() + '\\';
    return n1.startsWith(n2) || n2.startsWith(n1);
  };

  const validateUncPath = (path, fieldName) => {
    if (!path) {
      return { valid: false, error: `${fieldName} è obbligatorio` };
    }

    if (!path.startsWith('\\\\')) {
      return { valid: true };
    }

    const uncRegex = /^\\\\[a-zA-Z0-9._-]+\\[a-zA-Z0-9$._-]+/;
    if (!uncRegex.test(path)) {
      return {
        valid: false,
        error: `${fieldName}: formato UNC non valido. Usa: \\\\server\\share o \\\\server\\share\\cartella`
      };
    }

    return { valid: true };
  };

  const validateCredentials = (credentials, destinationPath) => {
    const warnings = [];

    if (destinationPath && destinationPath.startsWith('\\\\') && !credentials) {
      warnings.push({
        field: 'credentials',
        message: 'Credenziali consigliate per percorsi UNC'
      });
    }

    if (credentials) {
      const username = credentials.username || '';
      const domain = credentials.domain || '';

      if (!username) {
        return {
          valid: false,
          error: 'Username obbligatorio nelle credenziali'
        };
      }

      if (username.includes('\\') && domain) {
        return {
          valid: false,
          error: 'Username contiene già il dominio, non specificare domain separatamente'
        };
      }

      if (username.includes('@') && domain) {
        return {
          valid: false,
          error: 'Username in formato UPN, non specificare domain separatamente'
        };
      }
    }

    return { valid: true, warnings };
  };

  const callAgentBackupsList = (agentIp, agentPort, destinationPath, jobLabel) => {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        destination_path: destinationPath || '',
        job_label: jobLabel || null
      });

      const options = {
        hostname: agentIp,
        port: agentPort,
        path: '/backups/list',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 15000
      };

      const req = http.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.backups || []);
          } catch (e) {
            reject(new Error('Risposta agent non valida'));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Agent non raggiungibile: ${err.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout chiamata agent'));
      });

      req.write(postData);
      req.end();
    });
  };

  const callAgentJobBackups = (agentIp, agentPort, jobLabel, mappings = []) => {
    return new Promise((resolve, reject) => {
      const payload = {
        job_label: jobLabel || null,
        mappings: mappings || []
      };

      const postData = JSON.stringify(payload);

      const options = {
        hostname: agentIp,
        port: agentPort,
        path: '/backups/job',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 15000
      };

      const req = http.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const parsed = JSON.parse(data || '{}');
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed.mappings || []);
            } else {
              reject(new Error(parsed.error || `Agent ha risposto con status ${res.statusCode}`));
            }
          } catch (e) {
            reject(new Error('Risposta agent non valida'));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Agent non raggiungibile: ${err.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout chiamata agent'));
      });

      req.write(postData);
      req.end();
    });
  };

  const callAgentFilesystem = (agentIp, agentPort, path) => {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({ path: path || '' });

      const options = {
        hostname: agentIp,
        port: agentPort,
        path: '/filesystem/list',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 10000
      };

      const req = http.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const entries = (parsed.items || []).map(item => ({
              name: item.name,
              path: item.path || item.name,
              type: item.type,
              modified: item.modified || null,
              size: item.size ?? null
            }));
            resolve({ path: parsed.path || path || '', entries });
          } catch (e) {
            reject(new Error('Risposta agent non valida'));
          }
        });
      });

      req.on('error', (e) => {
        reject(new Error(`Impossibile contattare agent: ${e.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout connessione agent'));
      });

      req.write(postData);
      req.end();
    });
  };

  const callAgentDelete = (agentIp, agentPort, items = []) => {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({ paths: items });

      const options = {
        hostname: agentIp,
        port: agentPort,
        path: '/filesystem/delete',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 10000
      };

      const req = http.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const parsed = JSON.parse(data || '{}');
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
            } else {
              reject(new Error(parsed.error || `Agent ha risposto con status ${res.statusCode}`));
            }
          } catch (e) {
            reject(new Error('Risposta agent non valida'));
          }
        });
      });

      req.on('error', (e) => {
        reject(new Error(`Errore comunicazione con agent: ${e.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout connessione agent'));
      });

      req.write(postData);
      req.end();
    });
  };

  const getOnlineAgentInfo = (hostname) => {
    const heartbeat = storage.loadAgentHeartbeat(hostname);

    if (!heartbeat || !heartbeat.agent_ip || !heartbeat.agent_port) {
      return { error: 'Agent non raggiungibile o non configurato', status: 503 };
    }

    const now = Date.now();
    const lastSeen = new Date(heartbeat.timestamp).getTime();
    const isOnline = heartbeat.status !== 'offline' && (now - lastSeen) <= HEARTBEAT_TTL_MS;

    if (!isOnline) {
      return { error: 'Agent offline', status: 503 };
    }

    return { agent: heartbeat };
  };

  const readLogFile = (filePath, runId = null, { tailLines = null, maxBytes = 262144 } = {}) => {
    if (!filePath) {
      return null;
    }

    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const stat = fs.statSync(filePath);
      const size = stat.size;
      const bytesToRead = Math.min(maxBytes, size);
      let content = '';

      if (bytesToRead > 0) {
        const buffer = Buffer.alloc(bytesToRead);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, buffer, 0, bytesToRead, size - bytesToRead);
        fs.closeSync(fd);
        content = buffer.toString('utf8');
      } else {
        content = fs.readFileSync(filePath, 'utf8');
      }

      if (tailLines && Number.isFinite(tailLines) && tailLines > 0) {
        const lines = content.split(/\r?\n/).filter(line => line !== '');
        content = lines.slice(-tailLines).join('\n');
      }

      return {
        content,
        path: filePath,
        run_id: runId || path.basename(filePath, path.extname(filePath)),
        updated_at: stat.mtime
      };
    } catch (error) {
      logger.warn('Impossibile leggere file di log', { filePath, error: error.message });
      return null;
    }
  };

  const readLogIndexPaths = (filePath) => {
    if (!filePath) {
      return [];
    }

    try {
      if (!fs.existsSync(filePath)) {
        return [];
      }

      const raw = fs.readFileSync(filePath, 'utf8');
      const payload = JSON.parse(raw);
      const candidates = [];

      if (payload?.log_path) {
        candidates.push(payload.log_path);
      }

      if (Array.isArray(payload?.operations)) {
        payload.operations.forEach(op => {
          if (op?.log_path) {
            candidates.push(op.log_path);
          }
        });
      }

      return candidates.filter(Boolean);
    } catch (error) {
      logger.warn('Impossibile leggere indice log', { filePath, error: error.message });
      return [];
    }
  };

  const findLatestRunLog = (hostname, jobId) => {
    try {
      const runs = storage
        .loadRunsForJob(jobId)
        .filter(r => r.client_hostname === hostname)
        .sort((a, b) => new Date(b.end || b.start || 0) - new Date(a.end || a.start || 0));

      for (const run of runs) {
        const candidates = [run.log_path, run.run_log_index].filter(Boolean);
        for (const candidate of candidates) {
          const log = readLogFile(candidate, run.run_id);
          if (log) {
            return log;
          }
        }
      }
    } catch (error) {
      logger.warn('Impossibile recuperare log da run esistenti', { jobId, hostname, error: error.message });
    }

    return null;
  };

  const extractClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'] || req.headers['x-real-ip'];

    if (forwarded) {
      const forwardedIps = Array.isArray(forwarded)
        ? forwarded
        : String(forwarded).split(',').map(ip => ip.trim()).filter(Boolean);

      if (forwardedIps.length > 0) {
        return forwardedIps[0].replace('::ffff:', '');
      }
    }

    const rawIp = req.ip || req.socket?.remoteAddress || null;
    return rawIp ? rawIp.replace('::ffff:', '') : null;
  };

  const normalizeSchedule = (schedule) => {
    if (!schedule || !schedule.type) {
      throw new Error('Schedule non valida');
    }

    if (schedule.type === 'daily') {
      const times = Array.isArray(schedule.times) ? schedule.times : [];
      const normalizedTimes = times.filter(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t));
      if (normalizedTimes.length === 0) {
        throw new Error('Orari giornalieri mancanti o non validi');
      }

      const days = Array.isArray(schedule.days) ? schedule.days.filter(d => d >= 0 && d <= 6) : [1, 2, 3, 4, 5];
      if (days.length === 0) {
        throw new Error('Giorni della settimana mancanti o non validi');
      }

      return {
        type: 'daily',
        days: days,
        times: normalizedTimes.sort()
      };
    }

    return schedule;
  };

  const ensurePath = (value, fieldName) => {
    const normalized = (value || '').trim();
    if (!normalized) {
      const error = new Error(`${fieldName} non può essere vuoto`);
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    return normalized;
  };

  const buildSessionCookieOptions = (req) => {
    const secureSetting = authManager?.config?.auth?.secureCookies;
    const isHttps = req?.secure || req?.get('x-forwarded-proto') === 'https';
    const secure = typeof secureSetting === 'boolean'
      ? secureSetting && isHttps
      : process.env.NODE_ENV === 'production' && isHttps;

    return {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: 24 * 60 * 60 * 1000
    };
  };

  const computeEtag = (payload) => {
    return `"${crypto.createHash('sha1').update(payload).digest('hex')}"`;
  };

  const getCacheEntry = (cacheKey, cacheMap) => {
    const entry = cacheMap.get(cacheKey);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      cacheMap.delete(cacheKey);
      return null;
    }
    return entry;
  };

  const sendCachedResponse = (req, res, cacheKey, payload, ttlMs, cacheControl, cacheMap = responseCache) => {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const etag = computeEtag(body);
    const lastModified = new Date().toUTCString();

    cacheMap.set(cacheKey, {
      body,
      etag,
      lastModified,
      expiresAt: Date.now() + ttlMs
    });

    const ifNoneMatch = req.headers['if-none-match'];
    const ifModifiedSince = req.headers['if-modified-since'];

    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', lastModified);
    if (cacheControl) {
      res.setHeader('Cache-Control', cacheControl);
    }

    if (ifNoneMatch === etag || (ifModifiedSince && new Date(ifModifiedSince) >= new Date(lastModified))) {
      res.status(304).end();
      return;
    }

    res.setHeader('Content-Type', 'application/json');
    res.send(body);
  };

  const respondFromCache = (req, res, cacheKey, cacheControl, cacheMap = responseCache) => {
    const cached = getCacheEntry(cacheKey, cacheMap);
    if (!cached) return false;

    const ifNoneMatch = req.headers['if-none-match'];
    const ifModifiedSince = req.headers['if-modified-since'];

    res.setHeader('ETag', cached.etag);
    res.setHeader('Last-Modified', cached.lastModified);
    if (cacheControl) {
      res.setHeader('Cache-Control', cacheControl);
    }

    if (ifNoneMatch === cached.etag || (ifModifiedSince && new Date(ifModifiedSince) >= new Date(cached.lastModified))) {
      res.status(304).end();
      return true;
    }

    res.setHeader('Content-Type', 'application/json');
    res.send(cached.body);
    return true;
  };

  const normalizeMapping = (mapping, modeDefault) => {
    const sourcePath = ensurePath(mapping.source_path, 'Percorso sorgente');
    const destinationPath = ensurePath(mapping.destination_path, 'Percorso destinazione');

    const normalizedSource = normalizeWindowsPath(sourcePath);
    const normalizedDest = normalizeWindowsPath(destinationPath);

    if (pathsAreEqual(normalizedSource, normalizedDest)) {
      throw new Error('Sorgente e destinazione non possono essere identiche');
    }

    if (pathsOverlap(normalizedSource, normalizedDest)) {
      throw new Error('Sorgente e destinazione si sovrappongono: una è contenuta nell\'altra');
    }

    const sourceValidation = validateUncPath(sourcePath, 'Percorso sorgente');
    if (!sourceValidation.valid) {
      throw new Error(sourceValidation.error);
    }

    const destValidation = validateUncPath(destinationPath, 'Percorso destinazione');
    if (!destValidation.valid) {
      throw new Error(destValidation.error);
    }

    const credValidation = validateCredentials(mapping.credentials, destinationPath);
    if (!credValidation.valid) {
      throw new Error(credValidation.error);
    }

    const mode = VALID_MODES.includes((mapping.mode || modeDefault || 'copy').toLowerCase())
      ? (mapping.mode || modeDefault || 'copy').toLowerCase()
      : 'copy';

    const normalized = {
      source_path: normalizedSource,
      destination_path: normalizedDest,
      mode,
      label: mapping.label || mapping.description || ''
    };

    if (mode === 'copy') {
      const maxBackups = Number(mapping.retention?.max_backups || 0);
      normalized.retention = { max_backups: maxBackups > 0 ? maxBackups : 5 };
    }

    if (mapping.credentials) {
      normalized.credentials = {
        type: mapping.credentials.type || 'nas',
        username: mapping.credentials.username || '',
        password: mapping.credentials.password || '',
        domain: mapping.credentials.domain || ''
      };
    }

    if (credValidation.warnings && credValidation.warnings.length > 0) {
      normalized.warnings = credValidation.warnings;
    }

    return normalized;
  };

  const normalizeJobPayload = (payload, hostname) => {
    const jobId = (payload.job_id || '').trim();
    const clientHostname = hostname || (payload.client_hostname || '').trim();

    if (!jobId || !clientHostname) {
      throw new Error('Job ID e hostname client sono obbligatori');
    }

    const normalized = {
      job_id: jobId,
      client_hostname: clientHostname,
      enabled: payload.enabled !== false,
      mode_default: VALID_MODES.includes((payload.mode_default || 'copy').toLowerCase())
        ? (payload.mode_default || 'copy').toLowerCase()
        : 'copy'
    };

    if (payload.schedule) {
      normalized.schedule = normalizeSchedule(payload.schedule);
    }

    const mappings = Array.isArray(payload.mappings) ? payload.mappings : [];
    if (mappings.length > 0) {
      normalized.mappings = mappings.map(m => normalizeMapping(m, normalized.mode_default));
    }

    if (!normalized.schedule) {
      throw new Error('Schedule obbligatoria per il job');
    }

    if (!normalized.mappings || normalized.mappings.length === 0) {
      throw new Error('Almeno una mappatura è richiesta');
    }

    return normalized;
  };


  const buildAgentStatusMap = () => {
    const heartbeats = storage.loadAllAgentHeartbeats();
    const now = Date.now();
    const statusMap = new Map();

    heartbeats.forEach(hb => {
      const lastSeen = new Date(hb.timestamp).getTime();
      const online = hb.status !== 'offline' && (now - lastSeen) <= HEARTBEAT_TTL_MS;
      const statusData = {
        online,
        lastSeen: hb.timestamp,
        backup_status: hb.backup_status || null,
        backup_job_id: hb.backup_job_id || null,
        agent_ip: hb.agent_ip || null,
        agent_port: hb.agent_port || null,
        backup_status_timestamp: hb.backup_status_timestamp || hb.timestamp
      };

      statusMap.set(hb.hostname, statusData);
    });

    return statusMap;
  };

  const requireAuth = (req, res, next) => {
    const sessionId = req.cookies.sessionId;

    if (!sessionId) {
      return res.status(401).json({ error: 'Non autenticato' });
    }

    const validation = authManager.validateSession(sessionId);

    if (!validation.valid) {
      res.clearCookie('sessionId', buildSessionCookieOptions(req));
      return res.status(401).json({ error: 'Sessione non valida o scaduta' });
    }

    req.username = validation.username;
    next();
  };

  // Event Bus
  const eventBus = require('../events/eventBus');

  router.post('/api/agent/heartbeat', (req, res) => {
    const { hostname, timestamp, status, agent_ip, agent_port, backup_status, backup_job_id } = req.body || {};

    if (!hostname) {
      return res.status(400).json({ error: 'Hostname richiesto' });
    }

    const resolvedAgentIp = agent_ip || extractClientIp(req);
    const parsedPort = agent_port ? parseInt(agent_port, 10) : null;
    const resolvedAgentPort = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 8081;

    const existingHeartbeats = storage.loadAllAgentHeartbeats();
    const existingHeartbeat = existingHeartbeats.find(hb => hb.hostname === hostname);

    let finalBackupStatus = backup_status || null;
    let finalBackupJobId = backup_job_id || null;

    if (!backup_status && existingHeartbeat && existingHeartbeat.backup_status === 'in_progress') {
      const now = Date.now();
      const lastStatusUpdate = new Date(existingHeartbeat.backup_status_timestamp || existingHeartbeat.timestamp).getTime();
      const elapsed = now - lastStatusUpdate;
      const BACKUP_STATUS_TIMEOUT = 5 * 60 * 1000;

      if (elapsed < BACKUP_STATUS_TIMEOUT) {
        finalBackupStatus = existingHeartbeat.backup_status;
        finalBackupJobId = existingHeartbeat.backup_job_id;
      }
    }

    const wasOffline = existingHeartbeat && (existingHeartbeat.status === 'offline' ||
      (Date.now() - new Date(existingHeartbeat.timestamp).getTime() > HEARTBEAT_TTL_MS));

    const heartbeat = {
      hostname,
      timestamp: timestamp || new Date().toISOString(),
      status: status || 'online',
      agent_ip: resolvedAgentIp,
      agent_port: resolvedAgentPort,
      backup_status: finalBackupStatus,
      backup_job_id: finalBackupJobId,
      backup_status_timestamp: backup_status ? (timestamp || new Date().toISOString()) : (existingHeartbeat?.backup_status_timestamp || null)
    };

    const saved = storage.saveAgentHeartbeat(heartbeat);

    if (!saved) {
      return res.status(500).json({ error: 'Impossibile salvare heartbeat' });
    }

    // Emit SSE event se lo stato è cambiato
    const statusChanged = existingHeartbeat && existingHeartbeat.status !== heartbeat.status;
    if (statusChanged || wasOffline) {
      eventBus.emitClientStatusChanged(hostname, heartbeat.status, heartbeat.timestamp);
    }

    // Emit evento se backup status cambiato
    if (backup_status && (!existingHeartbeat || existingHeartbeat.backup_status !== backup_status)) {
      if (backup_status === 'in_progress') {
        eventBus.emitBackupStarted(hostname, backup_job_id, null, heartbeat.timestamp);
      }
    }

    if (wasOffline && heartbeat.status === 'online') {
      // Agent tornato online - risolvi alert offline
      const alertService = req.app.get('alertService');
      let shouldNotifyEmail = true;
      if (alertService) {
        const resolved = alertService.resolveAgentOfflineAlert(hostname);
        shouldNotifyEmail = resolved !== false;
      }

      const emailService = req.app.get('emailService');
      if (emailService && shouldNotifyEmail) {
        const jobs = storage.loadAllJobs()
          .filter(j => j.client_hostname === hostname)
          .map(j => j.job_id);

        emailService.notifyAgentStatus(
          hostname,
          'online',
          existingHeartbeat ? existingHeartbeat.timestamp : new Date().toISOString(),
          jobs
        ).catch(err => {
          logger.warn('Errore invio notifica email agent online', { error: err.message });
        });
      }
    }

    logger.logApiCall('POST', '/api/agent/heartbeat', hostname, 200);
    res.json({ success: true });
  });

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

      // Notifica scheduler di reschedulare
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

      // Notifica scheduler di reschedulare
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

      // Notifica scheduler di reschedulare
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

  router.get('/api/clients/:hostname/fs', requireAuth, async (req, res) => {
    try {
      const hostname = req.params.hostname;
      const requestedPath = req.query.path || '';

      const heartbeat = storage.loadAgentHeartbeat(hostname);

      if (!heartbeat || !heartbeat.agent_ip || !heartbeat.agent_port) {
        logger.error('Agent non raggiungibile', { hostname });
        return res.status(503).json({ error: 'Agent non raggiungibile o non configurato' });
      }

      const now = Date.now();
      const lastSeen = new Date(heartbeat.timestamp).getTime();
      const isOnline = (now - lastSeen) <= HEARTBEAT_TTL_MS;

      if (!isOnline) {
        logger.error('Agent offline', { hostname });
        return res.status(503).json({ error: 'Agent offline' });
      }

      const listing = await callAgentFilesystem(heartbeat.agent_ip, heartbeat.agent_port, requestedPath);
      logger.logApiCall('GET', `/api/clients/${hostname}/fs`, req.username, 200);
      res.json(listing);
    } catch (error) {
      logger.error('Errore browsing filesystem remoto', { error: error.message });
      res.status(500).json({ error: error.message || 'Errore interno' });
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
      const safeHost = (hostname || '').replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeJob = (jobId || '').replace(/[^a-zA-Z0-9._-]/g, '_');
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

      const jobLabel = (job.job_id || '').replace(/[^a-zA-Z0-9._-]/g, '_');
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

      const normalize = (p) => (p || '').replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
      const targetPath = normalize(backupPath);

      const mapping = (job.mappings || []).find(m => {
        if (!m.destination_path) return false;
        const dest = normalize(m.destination_path);
        return targetPath.startsWith(dest);
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

  router.get('/api/clients', requireAuth, (req, res) => {
    try {
      const cacheKey = 'clients-list';
      if (respondFromCache(req, res, cacheKey, 'private, max-age=15')) {
        return;
      }

      const jobs = storage.loadAllJobs();
      const runs = storage.loadAllRuns();
      const heartbeats = storage.loadAllAgentHeartbeats();
      const agentStatus = buildAgentStatusMap();

      const clientMap = new Map();

      heartbeats.forEach(hb => {
        if (!clientMap.has(hb.hostname)) {
          clientMap.set(hb.hostname, {
            hostname: hb.hostname,
            jobs: [],
            online: agentStatus.get(hb.hostname)?.online || false,
            lastSeen: hb.timestamp
          });
        }
      });

      jobs.forEach(job => {
        if (!clientMap.has(job.client_hostname)) {
          clientMap.set(job.client_hostname, {
            hostname: job.client_hostname,
            jobs: [],
            online: false,
            lastSeen: null
          });
        }
        clientMap.get(job.client_hostname).jobs.push(job.job_id);
      });

      runs.forEach(run => {
        if (clientMap.has(run.client_hostname)) {
          const client = clientMap.get(run.client_hostname);
          const runDate = new Date(run.start);

          if (!client.lastSeen || runDate > new Date(client.lastSeen)) {
            client.lastSeen = run.start;
          }

          if (!client.lastBackupRun || runDate > new Date(client.lastBackupRun.start)) {
            client.lastBackupRun = {
              start: run.start,
              status: run.status
            };
          }
        }
      });

      const clients = Array.from(clientMap.values());

      clients.forEach(client => {
        const status = agentStatus.get(client.hostname);
        if (status) {
          client.online = status.online;
          client.lastSeen = status.lastSeen;
          client.backup_status = status.backup_status;
          client.backup_job_id = status.backup_job_id;
          client.agent_ip = status.agent_ip;
          client.agent_port = status.agent_port;
          client.backup_status_timestamp = status.backup_status_timestamp;
        }
      });

      logger.logApiCall('GET', '/api/clients', req.username, 200);
      sendCachedResponse(req, res, cacheKey, clients, CLIENTS_CACHE_TTL_MS, 'private, max-age=15');
    } catch (error) {
      logger.error('Errore caricamento clients', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.delete('/api/clients/:hostname/runs', requireAuth, async (req, res) => {
    try {
      const hostname = req.params.hostname;
      const runsDeleted = storage.deleteRunsForClient(hostname);

      logger.logApiCall('DELETE', `/api/clients/${hostname}/runs`, req.username, 200);
      res.json({ success: true, runsDeleted });
    } catch (error) {
      logger.error('Errore eliminazione log client', { hostname: req.params.hostname, error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.delete('/api/clients/:hostname', requireAuth, async (req, res) => {
    try {
      const hostname = req.params.hostname;
      const target = (hostname || '').toLowerCase();
      const hostnamesToDelete = new Set([hostname]);

      const jobs = storage.loadAllJobs();
      const runs = storage.loadAllRuns();
      const heartbeats = storage.loadAllAgentHeartbeats();

      jobs.forEach(job => {
        if (job?.client_hostname && job.client_hostname.toLowerCase() === target) {
          hostnamesToDelete.add(job.client_hostname);
        }
      });

      runs.forEach(run => {
        if (run?.client_hostname && run.client_hostname.toLowerCase() === target) {
          hostnamesToDelete.add(run.client_hostname);
        }
      });

      heartbeats.forEach(hb => {
        if (hb?.hostname && hb.hostname.toLowerCase() === target) {
          hostnamesToDelete.add(hb.hostname);
        }
      });

      const aggregate = {
        jobsDeleted: 0,
        runsDeleted: 0,
        heartbeatDeleted: false
      };

      hostnamesToDelete.forEach(entry => {
        const result = storage.deleteClient(entry);
        aggregate.jobsDeleted += result.jobsDeleted || 0;
        aggregate.runsDeleted += result.runsDeleted || 0;
        aggregate.heartbeatDeleted = aggregate.heartbeatDeleted || result.heartbeatDeleted;
      });

      await scheduler.reloadJobs();

      logger.logApiCall('DELETE', `/api/clients/${hostname}`, req.username, 200);
      res.json({ success: true, result: aggregate });
    } catch (error) {
      logger.error('Errore deregistrazione client', { hostname: req.params.hostname, error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.post('/api/clients/:hostname/reset-backup-status', requireAuth, (req, res) => {
    try {
      const hostname = req.params.hostname;
      const existingHeartbeats = storage.loadAllAgentHeartbeats();
      const existingHeartbeat = existingHeartbeats.find(hb => hb.hostname === hostname);

      if (!existingHeartbeat) {
        return res.status(404).json({ error: 'Client non trovato' });
      }

      const heartbeat = {
        ...existingHeartbeat,
        backup_status: null,
        backup_job_id: null,
        backup_status_timestamp: null
      };

      storage.saveAgentHeartbeat(heartbeat);

      logger.logApiCall('POST', `/api/clients/${hostname}/reset-backup-status`, req.username, 200);
      res.json({ success: true });
    } catch (error) {
      logger.error('Errore reset stato backup', { hostname: req.params.hostname, error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
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

  router.get('/api/config/export', requireAuth, (req, res) => {
    try {
      // Sezioni richieste (default: tutte)
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

      // Export jobs
      if (sections.includes('jobs')) {
        const allJobs = storage.loadAllJobs();
        config.jobs = allJobs;
        config.sections.push('jobs');
      }

      // Export users
      if (sections.includes('users')) {
        const users = authManager.getAllUsers();
        config.users = users;
        config.sections.push('users');
      }

      // Export clients (heartbeats)
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

      // Sezioni da importare (default: tutte le presenti nel config)
      const sectionsToImport = sections || config.sections || ['jobs', 'users', 'clients', 'email'];

      let imported = { jobs: 0, users: 0, clients: 0, email: 0 };

      // Import users
      if (sectionsToImport.includes('users') && Array.isArray(config.users)) {
        for (const user of config.users) {
          if (user.username && user.passwordHash) {
            const result = await authManager.importUser(user);
            if (result.success) imported.users++;
          }
        }
      }

      // Import jobs
      if (sectionsToImport.includes('jobs') && Array.isArray(config.jobs)) {
        for (const job of config.jobs) {
          if (job.job_id && job.client_hostname) {
            const result = storage.saveJob(job);
            if (result) imported.jobs++;
          }
        }
      }

      // Import clients (count only)
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
      const config = req.app.get('config');
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

      const configPath = req.app.get('configPath');
      if (!configPath) {
        return res.status(500).json({ error: 'Percorso configurazione non disponibile' });
      }

      const configData = fs.readFileSync(configPath, 'utf8');
      const diskConfig = JSON.parse(configData);
      diskConfig.logging = diskConfig.logging || {};
      diskConfig.logging.retentionDays = retentionDays;
      fs.writeFileSync(configPath, JSON.stringify(diskConfig, null, 2), 'utf8');

      const runtimeConfig = req.app.get('config');
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

  // SSE Manager
  const sseManager = require('../events/sseManager');

  router.get('/api/events', requireAuth, (req, res) => {
    const clientId = req.username || `user_${Date.now()}`;
    logger.debug('SSE client connesso', { username: req.username });

    // Usa SSEManager per gestire la connessione
    sseManager.addClient(clientId, res);

    req.on('close', () => {
      logger.debug('SSE client disconnesso', { username: req.username });
    });
  });

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

  router.post('/api/logs/upload', (req, res) => {
    try {
      const { hostname, jobId, runId, logContent } = req.body || {};

      if (!hostname || !jobId || !runId || !logContent) {
        return res.status(400).json({ error: 'Parametri mancanti' });
      }

      const safeHost = (hostname || '').replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeJob = (jobId || '').replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeRun = (runId || '').replace(/[^a-zA-Z0-9._-]/g, '_');

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

      const safeHost = (clientId || '').replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeJob = (jobId || '').replace(/[^a-zA-Z0-9._-]/g, '_');
      const logDir = path.join(storage.dataRoot, 'logs', safeHost, safeJob);

      if (!fs.existsSync(logDir)) {
        return res.status(404).json({ error: 'Nessun log disponibile' });
      }

      if (runId) {
        const safeRun = (runId || '').replace(/[^a-zA-Z0-9._-]/g, '_');
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

      const safeHost = (clientId || '').replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeJob = (jobId || '').replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeRun = (runId || '').replace(/[^a-zA-Z0-9._-]/g, '_');
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

      const safeHost = (hostname || '').replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeJob = (jobId || '').replace(/[^a-zA-Z0-9._-]/g, '_');
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

  router.post('/api/email/oauth/start', requireAuth, (req, res) => {
    try {
      cleanupOauthStates();
      const { provider, clientId, clientSecret, authUser, returnTo } = req.body || {};
      const config = getOAuthConfig(provider);

      if (!config) {
        return res.status(400).json({ error: 'Provider OAuth non supportato' });
      }

      const emailService = req.app.get('emailService');
      if (!emailService) {
        return res.status(500).json({ error: 'Servizio email non disponibile' });
      }

      const currentSettings = emailService.getRawSettings();
      const resolvedClientId = clientId || currentSettings?.smtp?.oauth2?.clientId;
      const resolvedClientSecret = clientSecret || currentSettings?.smtp?.oauth2?.clientSecret;
      const resolvedAuthUser = authUser || currentSettings?.smtp?.auth?.user;

      if (!resolvedClientId || !resolvedClientSecret) {
        return res.status(400).json({ error: 'Client ID e Client Secret sono obbligatori' });
      }

      if (!resolvedAuthUser) {
        return res.status(400).json({ error: 'Email account obbligatoria' });
      }

      const codeVerifier = createCodeVerifier();
      const codeChallenge = createCodeChallenge(codeVerifier);
      const state = base64UrlEncode(crypto.randomBytes(16));
      const redirectUri = `${getPublicBaseUrl(req)}/api/email/oauth/callback`;

      oauthStateStore.set(state, {
        provider,
        clientId: resolvedClientId,
        clientSecret: resolvedClientSecret,
        authUser: resolvedAuthUser,
        codeVerifier,
        redirectUri,
        returnTo,
        createdAt: Date.now()
      });

      const params = new URLSearchParams({
        client_id: resolvedClientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: config.scope,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      });

      if (provider === 'google') {
        params.set('access_type', 'offline');
        params.set('prompt', 'consent');
        params.set('login_hint', resolvedAuthUser);
      }

      if (provider === 'microsoft') {
        params.set('response_mode', 'query');
        params.set('login_hint', resolvedAuthUser);
      }

      const url = `${config.authorizeUrl}?${params.toString()}`;
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
        message: error_description || error
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
          message: 'Provider OAuth non supportato'
        }));
      }

      const tokenData = await exchangeOAuthCode(config.tokenUrl, {
        client_id: stateData.clientId,
        client_secret: stateData.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: stateData.redirectUri,
        code_verifier: stateData.codeVerifier
      });

      const emailService = req.app.get('emailService');
      if (!emailService) {
        return res.redirect(buildOAuthRedirect(stateData.returnTo, {
          oauth: 'error',
          message: 'Servizio email non disponibile'
        }));
      }

      const currentSettings = emailService.getRawSettings();
      const fallbackRefreshToken = currentSettings?.smtp?.oauth2?.refreshToken;
      const refreshToken = tokenData.refresh_token || fallbackRefreshToken;

      if (!refreshToken) {
        return res.redirect(buildOAuthRedirect(stateData.returnTo, {
          oauth: 'error',
          message: 'Refresh token non ricevuto. Ripetere il consenso.'
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
            clientId: stateData.clientId,
            clientSecret: stateData.clientSecret,
            refreshToken,
            accessToken: tokenData.access_token || currentSettings.smtp?.oauth2?.accessToken || ''
          }
        }
      };

      const result = emailService.updateSettings(updatedSettings);
      if (!result.success) {
        return res.redirect(buildOAuthRedirect(stateData.returnTo, {
          oauth: 'error',
          message: result.error || 'Errore salvataggio impostazioni OAuth'
        }));
      }

      return res.redirect(buildOAuthRedirect(stateData.returnTo, {
        oauth: 'success',
        provider: stateData.provider
      }));
    } catch (err) {
      logger.error('Errore callback OAuth email', { error: err.message });
      return res.redirect(buildOAuthRedirect(stateData?.returnTo, {
        oauth: 'error',
        message: err.message || 'Errore callback OAuth'
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

  // Alerts API
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

  // Server management API
  router.post('/api/server/reboot', requireAuth, async (req, res) => {
    try {
      // Solo admin possono riavviare il server
      if (req.user && req.user.role !== 'admin') {
        logger.logApiCall('POST', '/api/server/reboot', req.username, 403);
        return res.status(403).json({ error: 'Accesso negato. Solo amministratori.' });
      }

      const serverService = req.app.get('serverService');
      if (!serverService) {
        return res.status(500).json({ error: 'Servizio server non disponibile' });
      }

      // Audit event
      logger.warn('Riavvio server richiesto', {
        user: req.username,
        ip: req.ip,
        timestamp: new Date().toISOString()
      });

      // Riavvio asincrono - risposta immediata al client
      const result = await serverService.restartServer();

      logger.logApiCall('POST', '/api/server/reboot', req.username, 200);

      // Risposta immediata
      res.json(result);

    } catch (error) {
      logger.error('Errore riavvio server', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  app.use(router);
}

module.exports = setupRoutes;
