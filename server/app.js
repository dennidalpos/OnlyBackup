// server/app.js
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const bodyParser = require('body-parser');

const HTTP_PORT = 8080;
const WS_PORT = 8081;

const DATA_DIR = path.join(__dirname, 'data');
const AGENTS_DIR = path.join(DATA_DIR, 'agents');
const JOBS_DIR = path.join(DATA_DIR, 'jobs');
const HISTORY_DIR = path.join(DATA_DIR, 'history');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

ensureDir(DATA_DIR);
ensureDir(AGENTS_DIR);
ensureDir(JOBS_DIR);
ensureDir(HISTORY_DIR);

const agents = new Map();
const agentSockets = new Map();
const dashboardSockets = new Set();
const pendingBrowse = new Map();
const pendingValidateDest = new Map();

function loadJsonFile(file, def) {
  if (!fs.existsSync(file)) return def;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return def;
  }
}

function saveJsonFile(file, obj) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

function agentFile(agentId) {
  return path.join(AGENTS_DIR, agentId + '.json');
}

function jobsFile(agentId) {
  return path.join(JOBS_DIR, agentId + '.json');
}

function historyFile(agentId) {
  return path.join(HISTORY_DIR, agentId + '.json');
}

function loadPersistedAgents() {
  ensureDir(AGENTS_DIR);
  const files = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.json'));
  files.forEach(f => {
    const full = path.join(AGENTS_DIR, f);
    const a = loadJsonFile(full, null);
    if (!a || !a.agentId) return;
    if (!a.status) a.status = 'offline';
    agents.set(a.agentId, a);
  });
}

function saveAgent(agent) {
  if (!agent || !agent.agentId) return;
  saveJsonFile(agentFile(agent.agentId), agent);
}

function getAgentsArray() {
  return Array.from(agents.values()).map(a => ({
    agentId: a.agentId,
    hostname: a.hostname || a.agentId,
    osVersion: a.osVersion || '',
    ipAddresses: a.ipAddresses || [],
    lastSeen: a.lastSeen || null,
    status: a.status || 'offline',
    lastBackupStatus: a.lastBackupStatus || null,
    lastBackupAt: a.lastBackupAt || null,
    lastBackupMessage: a.lastBackupMessage || null,
    lastBackupFiles: a.lastBackupFiles || 0,
    lastBackupBytes: a.lastBackupBytes || 0
  }));
}

function broadcastToDashboards(obj) {
  const txt = JSON.stringify(obj);
  for (const ws of dashboardSockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(txt);
    }
  }
}

function broadcastAgentsSnapshot() {
  broadcastToDashboards({
    type: 'agents_snapshot',
    payload: getAgentsArray()
  });
}

function appendHistory(agentId, entry) {
  const file = historyFile(agentId);
  const hist = loadJsonFile(file, { agentId, history: [] });
  hist.history.push(entry);
  saveJsonFile(file, hist);
}

function loadHistory(agentId) {
  const file = historyFile(agentId);
  const hist = loadJsonFile(file, { agentId, history: [] });
  return hist.history || [];
}

function updateAgentBackupStatus(agentId, jobResult) {
  let agent = agents.get(agentId);
  if (!agent) {
    agent = {
      agentId,
      hostname: agentId,
      osVersion: '',
      ipAddresses: [],
      lastSeen: null,
      status: 'offline'
    };
  }
  const statusRaw = (jobResult.status || '').toLowerCase();
  let backupStatus;
  if (statusRaw === 'success' || statusRaw === 'ok' || statusRaw === 'completed') {
    backupStatus = 'success';
  } else if (statusRaw === 'failed' || statusRaw === 'error') {
    backupStatus = 'failed';
  } else {
    backupStatus = statusRaw || 'unknown';
  }
  agent.lastBackupStatus = backupStatus;
  agent.lastBackupAt = jobResult.finishedAt || jobResult.startedAt || new Date().toISOString();
  agent.lastBackupMessage = jobResult.errorMessage || null;
  agent.lastBackupFiles = typeof jobResult.filesCopied === 'number' ? jobResult.filesCopied : 0;
  agent.lastBackupBytes = typeof jobResult.bytesCopied === 'number' ? jobResult.bytesCopied : 0;
  if (!agent.lastSeen) agent.lastSeen = new Date().toISOString();
  if (!agent.status) agent.status = agentSockets.has(agentId) ? 'online' : 'offline';
  agents.set(agentId, agent);
  saveAgent(agent);
}

function upsertAgentFromRegister(msg) {
  const p = msg.payload || msg;
  const agentId = p.agentId || p.hostname || p.name || ('agent-' + Math.random().toString(16).slice(2));
  const hostname = p.hostname || agentId;
  const osVersion = p.osVersion || p.os || '';
  const ipAddresses = p.ipAddresses || p.ips || [];
  const nowIso = new Date().toISOString();
  const existing = agents.get(agentId) || {};
  const merged = {
    agentId,
    hostname,
    osVersion,
    ipAddresses,
    lastSeen: nowIso,
    status: 'online',
    lastBackupStatus: existing.lastBackupStatus || null,
    lastBackupAt: existing.lastBackupAt || null,
    lastBackupMessage: existing.lastBackupMessage || null,
    lastBackupFiles: existing.lastBackupFiles || 0,
    lastBackupBytes: existing.lastBackupBytes || 0
  };
  agents.set(agentId, merged);
  saveAgent(merged);
  return merged;
}

function touchAgentHeartbeat(agentId, heartbeatPayload) {
  let agent = agents.get(agentId);
  const nowIso = new Date().toISOString();
  if (!agent) {
    agent = {
      agentId,
      hostname: agentId,
      osVersion: '',
      ipAddresses: [],
      lastSeen: nowIso,
      status: 'online',
      lastBackupStatus: null,
      lastBackupAt: null,
      lastBackupMessage: null,
      lastBackupFiles: 0,
      lastBackupBytes: 0
    };
  } else {
    agent.lastSeen = nowIso;
    agent.status = 'online';
  }
  if (heartbeatPayload && heartbeatPayload.osVersion) {
    agent.osVersion = heartbeatPayload.osVersion;
  }
  if (heartbeatPayload && Array.isArray(heartbeatPayload.ipAddresses) && heartbeatPayload.ipAddresses.length) {
    agent.ipAddresses = heartbeatPayload.ipAddresses;
  }
  agents.set(agentId, agent);
  saveAgent(agent);
}

function scheduleOfflineCheck() {
  setInterval(() => {
    const now = Date.now();
    let changed = false;
    agents.forEach(agent => {
      const last = agent.lastSeen ? Date.parse(agent.lastSeen) : 0;
      const hasSocket = agentSockets.has(agent.agentId);
      let newStatus = agent.status || 'offline';
      if (!last) {
        newStatus = hasSocket ? 'online' : 'offline';
      } else {
        if (now - last > 120000) newStatus = 'offline';
        else newStatus = hasSocket ? 'online' : 'offline';
      }
      if (newStatus !== agent.status) {
        agent.status = newStatus;
        agents.set(agent.agentId, agent);
        saveAgent(agent);
        changed = true;
      }
    });
    if (changed) broadcastAgentsSnapshot();
  }, 30000);
}

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/agents', (req, res) => {
  res.json(getAgentsArray());
});

app.get('/api/agents/:id', (req, res) => {
  const id = req.params.id;
  const agent = agents.get(id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  res.json(agent);
});

app.get('/api/agents/:id/browse', (req, res) => {
  const agentId = req.params.id;
  const browsePath = req.query.path || '';
  const ws = agentSockets.get(agentId);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return res.status(504).json({ error: 'Agent offline' });
  }
  const requestId = 'fs_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
  const timer = setTimeout(() => {
    const pending = pendingBrowse.get(requestId);
    if (pending) {
      pendingBrowse.delete(requestId);
      pending.res.status(504).json({ error: 'Timeout filesystem_browse' });
    }
  }, 30000);
  pendingBrowse.set(requestId, { res, timer });
  const msg = {
    type: 'filesystem_browse',
    requestId,
    payload: {
      path: browsePath
    }
  };
  ws.send(JSON.stringify(msg));
});

function loadJobs(agentId) {
  const file = jobsFile(agentId);
  const data = loadJsonFile(file, { agentId, jobs: [] });
  return data.jobs || [];
}

function saveJobs(agentId, jobs) {
  saveJsonFile(jobsFile(agentId), { agentId, jobs });
}

function pushJobsToAgent(agentId) {
  const ws = agentSockets.get(agentId);
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const jobs = loadJobs(agentId);
  const msg = {
    type: 'config_update',
    agentId,
    payload: {
      jobs
    }
  };
  ws.send(JSON.stringify(msg));
}

app.get('/api/jobs/:agentId', (req, res) => {
  const agentId = req.params.agentId;
  const jobs = loadJobs(agentId);
  res.json({ agentId, jobs });
});

app.post('/api/jobs/:agentId', (req, res) => {
  const agentId = req.params.agentId;
  const body = req.body || {};
  const jobs = loadJobs(agentId);
  const id = body.id || 'job-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
  const job = {
    id,
    name: body.name || id,
    sources: body.sources || [],
    destinations: body.destinations || [],
    schedule: body.schedule || { type: 'daily', time: '23:00' },
    options: body.options || { syncMode: 'copy' }
  };
  jobs.push(job);
  saveJobs(agentId, jobs);
  pushJobsToAgent(agentId);
  res.json(job);
});

app.put('/api/jobs/:agentId/:jobId', (req, res) => {
  const agentId = req.params.agentId;
  const jobId = req.params.jobId;
  const body = req.body || {};
  const jobs = loadJobs(agentId);
  const idx = jobs.findIndex(j => j.id === jobId);
  if (idx === -1) return res.status(404).json({ error: 'Job not found' });
  jobs[idx] = {
    id: jobId,
    name: body.name || jobId,
    sources: body.sources || [],
    destinations: body.destinations || [],
    schedule: body.schedule || { type: 'daily', time: '23:00' },
    options: body.options || { syncMode: 'copy' }
  };
  saveJobs(agentId, jobs);
  pushJobsToAgent(agentId);
  res.json(jobs[idx]);
});

app.delete('/api/jobs/:agentId/:jobId', (req, res) => {
  const agentId = req.params.agentId;
  const jobId = req.params.jobId;
  const jobs = loadJobs(agentId);
  const idx = jobs.findIndex(j => j.id === jobId);
  if (idx === -1) return res.status(404).json({ error: 'Job not found' });
  jobs.splice(idx, 1);
  saveJobs(agentId, jobs);
  pushJobsToAgent(agentId);
  res.json({ ok: true });
});

app.post('/api/jobs/:agentId/:jobId/run', (req, res) => {
  const agentId = req.params.agentId;
  const jobId = req.params.jobId;
  const ws = agentSockets.get(agentId);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return res.status(504).json({ error: 'Agent offline' });
  }
  const msg = {
    type: 'run_job',
    agentId,
    payload: { jobId }
  };
  ws.send(JSON.stringify(msg));
  res.json({ ok: true });
});

app.post('/api/jobs/:agentId/validate-destinations', (req, res) => {
  const agentId = req.params.agentId;
  const destinations = (req.body && req.body.destinations) || [];
  const ws = agentSockets.get(agentId);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return res.status(504).json({ error: 'Agent offline' });
  }
  const requestId = 'dest_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
  const timer = setTimeout(() => {
    const pending = pendingValidateDest.get(requestId);
    if (pending) {
      pendingValidateDest.delete(requestId);
      pending.res.status(504).json({ error: 'Timeout validate_destinations' });
    }
  }, 30000);
  pendingValidateDest.set(requestId, { res, timer });
  const msg = {
    type: 'validate_destinations',
    requestId,
    payload: {
      destinations
    }
  };
  ws.send(JSON.stringify(msg));
});

app.get('/api/history/:agentId', (req, res) => {
  const agentId = req.params.agentId;
  const history = loadHistory(agentId);
  res.json({ agentId, history });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = http.createServer(app);
server.listen(HTTP_PORT, () => {
  console.log('HTTP server listening on', HTTP_PORT);
});

const wss = new WebSocket.Server({ port: WS_PORT });
console.log('WebSocket server listening on', WS_PORT);

wss.on('connection', ws => {
  ws.isDashboard = false;
  ws.isAgent = false;
  ws.agentId = null;

  ws.on('message', data => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    const type = msg.type;
    if (type === 'dashboard_subscribe') {
      ws.isDashboard = true;
      dashboardSockets.add(ws);
      ws.send(JSON.stringify({ type: 'agents_snapshot', payload: getAgentsArray() }));
      return;
    }
    if (type === 'register') {
      const agent = upsertAgentFromRegister(msg);
      ws.isAgent = true;
      ws.agentId = agent.agentId;
      agentSockets.set(agent.agentId, ws);
      broadcastAgentsSnapshot();
      const jobs = loadJobs(agent.agentId);
      ws.send(JSON.stringify({ type: 'registered', agentId: agent.agentId, payload: { jobs } }));
      return;
    }
    if (type === 'heartbeat') {
      const agentId = msg.agentId || (msg.payload && msg.payload.agentId) || ws.agentId;
      if (!agentId) return;
      ws.isAgent = true;
      ws.agentId = agentId;
      agentSockets.set(agentId, ws);
      touchAgentHeartbeat(agentId, msg.payload || null);
      broadcastAgentsSnapshot();
      return;
    }
    if (type === 'filesystem_response') {
      const requestId = msg.requestId;
      const pending = requestId && pendingBrowse.get(requestId);
      if (!pending) return;
      pendingBrowse.delete(requestId);
      clearTimeout(pending.timer);
      pending.res.json(msg.payload || {});
      return;
    }
    if (type === 'validate_destinations_result') {
      const requestId = msg.requestId;
      const pending = requestId && pendingValidateDest.get(requestId);
      if (!pending) return;
      pendingValidateDest.delete(requestId);
      clearTimeout(pending.timer);
      pending.res.json({
        results: (msg.payload && msg.payload.results) || []
      });
      return;
    }
    if (type === 'job_result') {
      const p = msg.payload || {};
      const agentId = msg.agentId || p.agentId || ws.agentId;
      if (!agentId) return;
      const jr = {
        jobId: p.jobId,
        status: p.status,
        trigger: p.trigger,
        startedAt: p.startedAt,
        finishedAt: p.finishedAt,
        filesCopied: p.filesCopied,
        bytesCopied: p.bytesCopied,
        errorMessage: p.errorMessage
      };
      appendHistory(agentId, jr);
      updateAgentBackupStatus(agentId, jr);
      broadcastToDashboards({
        type: 'job_result',
        payload: {
          agentId,
          jobId: jr.jobId,
          status: jr.status,
          startedAt: jr.startedAt,
          finishedAt: jr.finishedAt,
          filesCopied: jr.filesCopied,
          bytesCopied: jr.bytesCopied,
          errorMessage: jr.errorMessage
        }
      });
      broadcastAgentsSnapshot();
      return;
    }
  });

  ws.on('close', () => {
    if (ws.isDashboard) {
      dashboardSockets.delete(ws);
    }
    if (ws.isAgent && ws.agentId) {
      const current = agentSockets.get(ws.agentId);
      if (current === ws) {
        agentSockets.delete(ws.agentId);
      }
    }
  });
});

loadPersistedAgents();
scheduleOfflineCheck();
broadcastAgentsSnapshot();