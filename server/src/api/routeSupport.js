const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

function createRouteSupport({ authManager, storage, logger }) {
  const HEARTBEAT_TTL_MS = 2 * 60 * 1000;
  const VALID_MODES = ['copy', 'sync'];
  const STATS_CACHE_TTL_MS = 15000;
  const CLIENTS_CACHE_TTL_MS = 15000;
  const BACKUP_ANALYZE_CACHE_TTL_MS = 30000;
  const responseCache = new Map();
  const backupAnalyzeCache = new Map();
  const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
  const oauthStateStore = new Map();

  const base64UrlEncode = (buffer) => buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const createCodeVerifier = () => base64UrlEncode(crypto.randomBytes(32));
  const createCodeChallenge = (verifier) => base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
  const createState = () => base64UrlEncode(crypto.randomBytes(16));

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
    const safeReturnTo = typeof returnTo === 'string' && returnTo.startsWith('/')
      ? returnTo
      : '/email-settings.html';
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
    const n1 = `${normalizeWindowsPath(path1).replace(/\\+$/, '').toLowerCase()}\\`;
    const n2 = `${normalizeWindowsPath(path2).replace(/\\+$/, '').toLowerCase()}\\`;
    return n1.startsWith(n2) || n2.startsWith(n1);
  };

  const validateUncPath = (pathValue, fieldName) => {
    if (!pathValue) {
      return { valid: false, error: `${fieldName} è obbligatorio` };
    }

    if (!pathValue.startsWith('\\\\')) {
      return { valid: true };
    }

    const uncRegex = /^\\\\[a-zA-Z0-9._-]+\\[a-zA-Z0-9$._-]+/;
    if (!uncRegex.test(pathValue)) {
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
          } catch {
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

  const callAgentFilesystem = (agentIp, agentPort, requestedPath) => {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({ path: requestedPath || '' });
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
            const entries = (parsed.items || []).map((item) => ({
              name: item.name,
              path: item.path || item.name,
              type: item.type,
              modified: item.modified || null,
              size: item.size ?? null
            }));
            resolve({ path: parsed.path || requestedPath || '', entries });
          } catch {
            reject(new Error('Risposta agent non valida'));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Impossibile contattare agent: ${error.message}`));
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
          } catch {
            reject(new Error('Risposta agent non valida'));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Errore comunicazione con agent: ${error.message}`));
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
        const lines = content.split(/\r?\n/).filter((line) => line !== '');
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
        payload.operations.forEach((operation) => {
          if (operation?.log_path) {
            candidates.push(operation.log_path);
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
        .filter((run) => run.client_hostname === hostname)
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
        : String(forwarded).split(',').map((ip) => ip.trim()).filter(Boolean);
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
      const normalizedTimes = times.filter((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time));
      if (normalizedTimes.length === 0) {
        throw new Error('Orari giornalieri mancanti o non validi');
      }

      const days = Array.isArray(schedule.days)
        ? schedule.days.filter((day) => day >= 0 && day <= 6)
        : [1, 2, 3, 4, 5];
      if (days.length === 0) {
        throw new Error('Giorni della settimana mancanti o non validi');
      }

      return {
        type: 'daily',
        days,
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

  const computeEtag = (payload) => `"${crypto.createHash('sha1').update(payload).digest('hex')}"`;

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

    const resolvedMode = (mapping.mode || modeDefault || 'copy').toLowerCase();
    const mode = VALID_MODES.includes(resolvedMode) ? resolvedMode : 'copy';
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
      normalized.mappings = mappings.map((mapping) => normalizeMapping(mapping, normalized.mode_default));
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

    heartbeats.forEach((heartbeat) => {
      const lastSeen = new Date(heartbeat.timestamp).getTime();
      const online = heartbeat.status !== 'offline' && (now - lastSeen) <= HEARTBEAT_TTL_MS;
      statusMap.set(heartbeat.hostname, {
        online,
        lastSeen: heartbeat.timestamp,
        backup_status: heartbeat.backup_status || null,
        backup_job_id: heartbeat.backup_job_id || null,
        agent_ip: heartbeat.agent_ip || null,
        agent_port: heartbeat.agent_port || null,
        backup_status_timestamp: heartbeat.backup_status_timestamp || heartbeat.timestamp
      });
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

  return {
    HEARTBEAT_TTL_MS,
    STATS_CACHE_TTL_MS,
    CLIENTS_CACHE_TTL_MS,
    BACKUP_ANALYZE_CACHE_TTL_MS,
    backupAnalyzeCache,
    oauthStateStore,
    base64UrlEncode,
    buildAgentStatusMap,
    buildOAuthRedirect,
    buildSessionCookieOptions,
    callAgentDelete,
    callAgentFilesystem,
    callAgentJobBackups,
    cleanupOauthStates,
    createCodeChallenge,
    createCodeVerifier,
    createState,
    exchangeOAuthCode,
    extractClientIp,
    findLatestRunLog,
    getOAuthConfig,
    getOnlineAgentInfo,
    getPublicBaseUrl,
    normalizeJobPayload,
    pathsOverlap,
    readLogFile,
    readLogIndexPaths,
    requireAuth,
    respondFromCache,
    sendCachedResponse
  };
}

module.exports = createRouteSupport;
