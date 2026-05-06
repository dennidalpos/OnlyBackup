const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const OnlyBackupServer = require('../../server/src/server');
const Storage = require('../../server/src/storage/storage');

const testLogger = {
  error() {},
  warn() {},
  info() {},
  debug() {},
  logInvalidConfig() {}
};

function assertStorageFileNamesAreConfined() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlybackup-storage-paths-'));
  const dataRoot = path.join(tempRoot, 'data');

  try {
    const storage = new Storage(dataRoot, testLogger);
    const outsideJobPath = path.join(dataRoot, 'state', 'escape.json');
    const outsideRunPath = path.join(dataRoot, 'state', 'escape-run.json');

    storage.saveJob({
      job_id: '..\\escape',
      client_hostname: 'CLIENT',
      enabled: true,
      schedule: { type: 'daily', times: ['02:00'] },
      mappings: []
    });
    storage.saveRun({
      run_id: '..\\escape-run',
      job_id: '..\\escape',
      client_hostname: 'CLIENT',
      status: 'success'
    });
    storage.saveAgentHeartbeat({ hostname: '..\\escape-agent' });
    storage.saveAlert({ alert_id: '..\\escape-alert' });

    assert.strictEqual(fs.existsSync(outsideJobPath), false, 'Job scritto fuori dalla directory jobs');
    assert.strictEqual(fs.existsSync(outsideRunPath), false, 'Run scritta fuori dalla directory runs');
    assert.ok(fs.existsSync(path.join(dataRoot, 'state', 'jobs', '_escape.json')));
    assert.ok(fs.existsSync(path.join(dataRoot, 'state', 'runs', '_escape-run.json')));
    assert.ok(fs.existsSync(path.join(dataRoot, 'state', 'agents', '_escape-agent.json')));
    assert.ok(fs.existsSync(path.join(dataRoot, 'state', 'alerts', '_escape-alert.json')));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function assertMinimalConfigDefaults() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlybackup-config-defaults-'));
  const configPath = path.join(tempRoot, 'config.json');
  const previousConfigPath = process.env.CONFIG_PATH;

  try {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        server: {
          host: '127.0.0.1',
          port: 0,
          environment: 'test'
        },
        dataRoot: './data'
      }, null, 2),
      'utf8'
    );

    process.env.CONFIG_PATH = configPath;
    const server = new OnlyBackupServer();
    server.loadConfig();

    assert.strictEqual(server.config.logging.console, true);
    assert.strictEqual(server.config.logging.file, true);
    assert.strictEqual(server.config.scheduler.checkInterval, 60000);
    assert.strictEqual(server.config.scheduler.enableFileWatcher, false);
    assert.strictEqual(server.config.dataRoot, path.join(tempRoot, 'data'));
  } finally {
    if (previousConfigPath) {
      process.env.CONFIG_PATH = previousConfigPath;
    } else {
      delete process.env.CONFIG_PATH;
    }

    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function createFakeAgent(agentRoot) {
  const filesystemRoot = path.join(agentRoot, 'filesystem');
  fs.mkdirSync(filesystemRoot, { recursive: true });

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }

      const body = await readJsonBody(req);

      if (req.url === '/filesystem/list') {
        const requestedPath = body.path || '';
        const items = requestedPath
          ? fs.readdirSync(requestedPath, { withFileTypes: true }).map((entry) => ({
              name: entry.name,
              path: path.join(requestedPath, entry.name),
              type: entry.isFile() ? 'file' : 'directory'
            }))
          : [{
              name: path.basename(filesystemRoot),
              path: filesystemRoot,
              type: 'directory'
            }];

        sendJson(res, 200, { path: requestedPath, items });
        return;
      }

      if (req.url === '/filesystem/delete') {
        const paths = Array.isArray(body.paths) ? body.paths : [];
        const results = paths.map((entry) => {
          const targetPath = typeof entry === 'string' ? entry : entry?.path;
          if (!targetPath) {
            return { path: null, status: 'error', error: 'Percorso mancante' };
          }

          fs.rmSync(targetPath, { recursive: true, force: true });
          return { path: targetPath, status: 'deleted', success: true };
        });

        sendJson(res, 200, { success: true, results });
        return;
      }

      if (req.url === '/backup') {
        const sourcePath = Array.isArray(body.sources) ? body.sources[0] : null;
        const destination = body.destination;
        fs.mkdirSync(destination, { recursive: true });

        const fileName = sourcePath ? path.basename(sourcePath) : 'backup.txt';
        const content = sourcePath && fs.existsSync(sourcePath)
          ? fs.readFileSync(sourcePath)
          : Buffer.from('fake-backup');
        const targetFile = path.join(destination, fileName);
        fs.writeFileSync(targetFile, content);

        sendJson(res, 200, {
          Success: true,
          BytesProcessed: content.length,
          Stats: {
            TotalFiles: 1,
            CopiedFiles: 1,
            SkippedFilesCount: 0,
            BlockedFilesCount: 0,
            DeletedFiles: 0,
            UpdatedFiles: 0,
            SyncSkippedFiles: 0,
            FailedFiles: 0
          },
          LogContent: `Backup completato verso ${destination}`,
          LogPath: targetFile
        });
        return;
      }

      if (req.url === '/backups/job') {
        const mappings = Array.isArray(body.mappings) ? body.mappings : [];
        const payload = mappings.map((mapping, index) => {
          const destination = mapping.destination_path;
          const exists = destination && fs.existsSync(destination);
          return {
            index,
            label: mapping.label || '',
            destination_path: destination,
            mode: mapping.mode || 'copy',
            backups: exists ? [{
              name: path.basename(destination),
              path: destination,
              modified: fs.statSync(destination).mtime.toISOString(),
              size: 0,
              retention_index: 1
            }] : []
          };
        });

        sendJson(res, 200, { mappings: payload });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.on('error', reject);
  });

  return {
    root: filesystemRoot,
    port: server.address().port,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

async function main() {
  assertMinimalConfigDefaults();
  assertStorageFileNamesAreConfined();

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlybackup-smoke-'));
  const configPath = path.join(tempRoot, 'config.json');
  const dataRoot = path.join(tempRoot, 'data');
  const sourceRoot = path.join(tempRoot, 'source');
  const destinationRoot = path.join(tempRoot, 'destination');
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'file.txt'), 'smoke-test', 'utf8');

  const fakeAgent = await createFakeAgent(tempRoot);

  const config = {
    server: {
      host: '127.0.0.1',
      port: 0,
      environment: 'test'
    },
    dataRoot,
    logging: {
      level: 'error',
      console: false,
      file: false,
      maxFiles: 7,
      maxSize: '1m',
      retentionDays: 7,
      cleanupIntervalHours: 6
    },
    auth: {
      sessionTimeout: 60000,
      passwordMinLength: 8,
      secureCookies: false
    },
    scheduler: {
      checkInterval: 60000,
      enableFileWatcher: false
    }
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

  const previousConfigPath = process.env.CONFIG_PATH;
  const previousAgentMsiPath = process.env.ONLYBACKUP_AGENT_MSI_PATH;
  process.env.CONFIG_PATH = configPath;
  process.env.ONLYBACKUP_AGENT_MSI_PATH = path.join(tempRoot, 'missing-agent-package', 'OnlyBackupAgent.msi');

  const server = new OnlyBackupServer();
  let sessionCookie = '';

  const request = async (baseUrl, urlPath, { method = 'GET', json = null } = {}) => {
    const headers = {};
    let body = undefined;

    if (json !== null) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    }
    if (sessionCookie) {
      headers.Cookie = sessionCookie;
    }

    const response = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers,
      body,
      redirect: 'manual'
    });

    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      sessionCookie = setCookie.split(';')[0];
    }

    return response;
  };

  try {
    console.log('Smoke test: avvio server...');
    await server.start();

    const address = server.server?.address();
    const port = address && typeof address === 'object' ? address.port : null;
    if (!port) {
      throw new Error('Porta di ascolto non disponibile dopo l\'avvio');
    }

    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`Smoke test: server in ascolto su ${port}`);

    for (const page of ['/', '/alerts.html', '/server-settings.html', '/email-settings.html']) {
      const response = await request(baseUrl, page);
      assert.strictEqual(response.status, 200, `${page} dovrebbe rispondere 200`);
      const html = await response.text();
      assert.ok(html.includes('OnlyBackup'), `${page} dovrebbe contenere il brand OnlyBackup`);
    }

    const publicStats = await request(baseUrl, '/api/public/stats');
    assert.strictEqual(publicStats.status, 200);
    const publicStatsPayload = await publicStats.json();
    assert.strictEqual(typeof publicStatsPayload.clients_online, 'number');

    const unauthStatus = await request(baseUrl, '/api/auth/status');
    assert.strictEqual(unauthStatus.status, 401);
    assert.strictEqual((await request(baseUrl, '/api/agent/package/options')).status, 401);

    const loginResponse = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      json: { username: 'admin', password: process.env.ONLYBACKUP_INITIAL_ADMIN_PASSWORD }
    });
    assert.strictEqual(loginResponse.status, 200);
    const loginPayload = await loginResponse.json();
    assert.strictEqual(loginPayload.username, 'admin');
    assert.strictEqual(loginPayload.mustChangePassword, true);
    assert.ok(sessionCookie, 'Cookie di sessione mancante dopo il login');

    const changePassword = await request(baseUrl, '/api/auth/change-password', {
      method: 'POST',
      json: { oldPassword: process.env.ONLYBACKUP_INITIAL_ADMIN_PASSWORD, newPassword: 'SmokePassword123!' }
    });
    assert.strictEqual(changePassword.status, 200);

    const authStatus = await request(baseUrl, '/api/auth/status');
    assert.strictEqual(authStatus.status, 200);

    const agentPackageOptions = await request(baseUrl, '/api/agent/package/options');
    assert.strictEqual(agentPackageOptions.status, 200);
    const agentPackageOptionsPayload = await agentPackageOptions.json();
    assert.strictEqual(typeof agentPackageOptionsPayload.serverPort, 'number');
    assert.ok(Array.isArray(agentPackageOptionsPayload.candidates));
    assert.strictEqual(agentPackageOptionsPayload.artifact.exists, false);

    const invalidAgentBuild = await request(baseUrl, '/api/agent/package/build', {
      method: 'POST',
      json: { serverHost: 'localhost', serverPort: 8080 }
    });
    assert.strictEqual(invalidAgentBuild.status, 400);

    const missingAgentDownload = await request(baseUrl, '/api/agent/package/download');
    assert.strictEqual(missingAgentDownload.status, 404);

    assert.strictEqual((await request(baseUrl, '/api/email/settings')).status, 200);
    assert.strictEqual((await request(baseUrl, '/api/email/templates')).status, 200);
    assert.strictEqual((await request(baseUrl, '/api/alerts')).status, 200);
    assert.strictEqual((await request(baseUrl, '/api/alerts/history')).status, 200);

    if (process.platform === 'win32') {
      const serviceStatus = await request(baseUrl, '/api/server/service');
      assert.strictEqual(serviceStatus.status, 200);
      const serviceStatusPayload = await serviceStatus.json();
      assert.strictEqual(typeof serviceStatusPayload.installed, 'boolean');
    }

    const emailOauth = await request(baseUrl, '/api/email/oauth/start', {
      method: 'POST',
      json: { provider: 'google', authUser: 'admin@example.com' }
    });
    assert.strictEqual(emailOauth.status, 400);

    const emailTest = await request(baseUrl, '/api/email/test', {
      method: 'POST',
      json: {}
    });
    assert.strictEqual(emailTest.status, 400);

    const hostname = 'SMOKE-CLIENT';
    const heartbeat = await request(baseUrl, '/api/agent/heartbeat', {
      method: 'POST',
      json: {
        hostname,
        status: 'online',
        agent_ip: '127.0.0.1',
        agent_port: fakeAgent.port
      }
    });
    assert.strictEqual(heartbeat.status, 200);

    const clientsResponse = await request(baseUrl, '/api/clients');
    assert.strictEqual(clientsResponse.status, 200);
    const clients = await clientsResponse.json();
    assert.ok(clients.some((client) => client.hostname === hostname && client.online), 'Client heartbeat non registrato');

    const filesystemResponse = await request(baseUrl, `/api/clients/${encodeURIComponent(hostname)}/fs`);
    assert.strictEqual(filesystemResponse.status, 200);
    const filesystemPayload = await filesystemResponse.json();
    assert.ok(Array.isArray(filesystemPayload.entries));

    const jobPayload = {
      job_id: 'SMOKE-JOB',
      client_hostname: hostname,
      enabled: true,
      mode_default: 'copy',
      schedule: { type: 'daily', days: [1, 2, 3, 4, 5], times: ['02:00'] },
      mappings: [{
        label: 'Smoke Mapping',
        source_path: path.join(sourceRoot, 'file.txt'),
        destination_path: destinationRoot,
        mode: 'copy',
        retention: { max_backups: 3 }
      }]
    };

    const createJob = await request(baseUrl, `/api/clients/${encodeURIComponent(hostname)}/jobs`, {
      method: 'POST',
      json: jobPayload
    });
    assert.strictEqual(createJob.status, 201);

    const updateJob = await request(baseUrl, '/api/jobs/SMOKE-JOB', {
      method: 'PUT',
      json: {
        ...jobPayload,
        mappings: [{
          ...jobPayload.mappings[0],
          label: 'Smoke Mapping Updated'
        }]
      }
    });
    assert.strictEqual(updateJob.status, 200);

    assert.strictEqual((await request(baseUrl, '/api/jobs')).status, 200);
    assert.strictEqual((await request(baseUrl, '/api/jobs/SMOKE-JOB')).status, 200);
    assert.strictEqual((await request(baseUrl, `/api/clients/${encodeURIComponent(hostname)}/jobs`)).status, 200);
    assert.strictEqual((await request(baseUrl, '/api/scheduler/jobs')).status, 200);

    const runJob = await request(baseUrl, '/api/jobs/SMOKE-JOB/run', {
      method: 'POST'
    });
    assert.strictEqual(runJob.status, 200);
    const runJobPayload = await runJob.json();
    assert.strictEqual(runJobPayload.success, true);

    const runsResponse = await request(baseUrl, `/api/runs?client=${encodeURIComponent(hostname)}`);
    assert.strictEqual(runsResponse.status, 200);
    const runs = await runsResponse.json();
    assert.ok(runs.length > 0, 'Nessuna run salvata');
    assert.strictEqual(runs[0].status, 'success');

    assert.strictEqual((await request(baseUrl, `/api/clients/${encodeURIComponent(hostname)}/jobs/SMOKE-JOB/logs/latest`)).status, 200);
    assert.strictEqual((await request(baseUrl, `/api/clients/${encodeURIComponent(hostname)}/jobs/SMOKE-JOB/logs/full?mapping=0`)).status, 200);
    assert.strictEqual((await request(baseUrl, `/api/clients/${encodeURIComponent(hostname)}/jobs/SMOKE-JOB/backups`)).status, 200);

    const analyzeResponse = await request(baseUrl, `/api/clients/${encodeURIComponent(hostname)}/jobs/SMOKE-JOB/backups/analyze?mapping=0`);
    assert.strictEqual(analyzeResponse.status, 200);
    const analyzePayload = await analyzeResponse.json();
    assert.ok(Array.isArray(analyzePayload.mappings));
    assert.ok(analyzePayload.mappings[0].backups.length > 0, 'Nessun backup rilevato dal fake agent');

    const deleteBackup = await request(baseUrl, `/api/clients/${encodeURIComponent(hostname)}/jobs/SMOKE-JOB/backups/delete`, {
      method: 'POST',
      json: { path: analyzePayload.mappings[0].backups[0].path }
    });
    assert.strictEqual(deleteBackup.status, 200);

    assert.strictEqual((await request(baseUrl, '/api/scheduler/reload', { method: 'POST' })).status, 200);
    assert.strictEqual((await request(baseUrl, '/api/alerts/history', { method: 'DELETE' })).status, 200);
    assert.strictEqual((await request(baseUrl, `/api/clients/${encodeURIComponent(hostname)}/runs`, { method: 'DELETE' })).status, 200);
    assert.strictEqual((await request(baseUrl, '/api/jobs/SMOKE-JOB', { method: 'DELETE' })).status, 200);

    const logout = await request(baseUrl, '/api/auth/logout', { method: 'POST' });
    assert.strictEqual(logout.status, 200);
    sessionCookie = '';
    assert.strictEqual((await request(baseUrl, '/api/auth/status')).status, 401);

    console.log('Smoke test server completato con successo.');
  } finally {
    console.log('Smoke test: arresto server...');
    await Promise.race([
      server.stop().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 5000))
    ]);
    await fakeAgent.close().catch(() => {});
    console.log('Smoke test: pulizia file temporanei...');

    if (previousConfigPath) {
      process.env.CONFIG_PATH = previousConfigPath;
    } else {
      delete process.env.CONFIG_PATH;
    }

    if (previousAgentMsiPath) {
      process.env.ONLYBACKUP_AGENT_MSI_PATH = previousAgentMsiPath;
    } else {
      delete process.env.ONLYBACKUP_AGENT_MSI_PATH;
    }

    fs.rmSync(tempRoot, { recursive: true, force: true });
    console.log('Smoke test: completato.');
  }
}

main().catch((error) => {
  console.error('Smoke test server fallito:', error);
  process.exit(1);
});
