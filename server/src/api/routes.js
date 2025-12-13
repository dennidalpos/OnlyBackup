const express = require('express');
const http = require('http');

function setupRoutes(app, authManager, storage, scheduler, logger) {
  const router = express.Router();
  const HEARTBEAT_TTL_MS = 2 * 60 * 1000;
  const VALID_MODES = ['copy', 'sync'];

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
              type: item.type
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
        backup_job_id: hb.backup_job_id || null
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
      return res.status(401).json({ error: 'Sessione non valida o scaduta' });
    }

    req.username = validation.username;
    next();
  };

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

      res.cookie('sessionId', result.sessionId, {
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
      });

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
    res.clearCookie('sessionId');
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
      const runs = storage.loadAllRuns();
      const agentStatus = buildAgentStatusMap();
      const now = Date.now();
      const last24h = now - (24 * 60 * 60 * 1000);

      const recentRuns = runs.filter(r => new Date(r.start).getTime() >= last24h);

      const successCount = recentRuns.filter(r => r.status === 'success').length;
      const failureCount = recentRuns.filter(r => r.status === 'failure').length;

      const jobs = storage.loadAllJobs();
      const heartbeats = storage.loadAllAgentHeartbeats();
      const clientHostnames = new Set();

      jobs.forEach(job => clientHostnames.add(job.client_hostname));
      heartbeats.forEach(hb => clientHostnames.add(hb.hostname));

      const onlineClients = [...clientHostnames].filter(h => agentStatus.get(h)?.online).length;
      const offlineClients = Math.max(clientHostnames.size - onlineClients, 0);

      res.json({
        backups_ok_24h: successCount,
        backups_failed_24h: failureCount,
        clients_online: onlineClients,
        clients_offline: offlineClients
      });
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

      await scheduler.reloadJobs();

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

      await scheduler.reloadJobs();

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

      await scheduler.reloadJobs();

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
        }
      });

      logger.logApiCall('GET', '/api/clients', req.username, 200);
      res.json(clients);
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
      const result = storage.deleteClient(hostname);

      await scheduler.reloadJobs();

      logger.logApiCall('DELETE', `/api/clients/${hostname}`, req.username, 200);
      res.json({ success: true, result });
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
      const allJobs = storage.loadAllJobs();
      const users = authManager.getAllUsers();
      const heartbeats = storage.loadAllAgentHeartbeats();

      const clientHostnames = new Set();
      allJobs.forEach(job => clientHostnames.add(job.client_hostname));
      heartbeats.forEach(hb => clientHostnames.add(hb.hostname));

      const config = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        clients: Array.from(clientHostnames),
        jobs: allJobs,
        users: users.map(u => ({
          username: u.username,
          passwordHash: u.passwordHash,
          role: u.role,
          mustChangePassword: u.mustChangePassword
        }))
      };

      logger.logApiCall('GET', '/api/config/export', req.username, 200);
      res.json(config);
    } catch (error) {
      logger.error('Errore export configurazione', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.post('/api/config/import', requireAuth, async (req, res) => {
    try {
      const config = req.body;

      if (!config || !config.version) {
        return res.status(400).json({ error: 'Configurazione non valida' });
      }

      let imported = { jobs: 0, users: 0 };

      if (Array.isArray(config.users)) {
        for (const user of config.users) {
          if (user.username && user.passwordHash) {
            const result = await authManager.importUser(user);
            if (result.success) imported.users++;
          }
        }
      }

      if (Array.isArray(config.jobs)) {
        for (const job of config.jobs) {
          if (job.job_id && job.client_hostname) {
            const result = storage.saveJob(job);
            if (result) imported.jobs++;
          }
        }
      }

      await scheduler.reloadJobs();

      logger.logApiCall('POST', '/api/config/import', req.username, 200);
      res.json({ success: true, imported });
    } catch (error) {
      logger.error('Errore import configurazione', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.delete('/api/runs/all', requireAuth, async (req, res) => {
    try {
      const path = require('path');
      const fs = require('fs');
      const runsDir = path.join(storage.dataRoot, 'state', 'runs');
      let deletedCount = 0;

      if (fs.existsSync(runsDir)) {
        const files = fs.readdirSync(runsDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            fs.unlinkSync(path.join(runsDir, file));
            deletedCount++;
          }
        }
      }

      logger.logApiCall('DELETE', '/api/runs/all', req.username, 200);
      logger.info('Eliminati tutti i log', { count: deletedCount, user: req.username });
      res.json({ success: true, deletedCount });
    } catch (error) {
      logger.error('Errore eliminazione tutti i log', { error: error.message });
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  router.get('/api/events', requireAuth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.write('data: {"type":"connected"}\n\n');

    logger.debug('SSE client connesso', { username: req.username });

    const heartbeatInterval = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': ping\n\n');
      }
    }, 30000);

    req.on('close', () => {
      clearInterval(heartbeatInterval);
      logger.debug('SSE client disconnesso', { username: req.username });
    });
  });

  app.use(router);
}

module.exports = setupRoutes;
