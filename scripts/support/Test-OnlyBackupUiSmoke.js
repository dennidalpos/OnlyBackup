const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { chromium } = require('../../server/node_modules/playwright');
const OnlyBackupServer = require('../../server/src/server');

const INITIAL_PASSWORD = process.env.ONLYBACKUP_INITIAL_ADMIN_PASSWORD || 'TestOnlyBackup123!';
const NEW_PASSWORD = 'UiSmokePassword123!';
const HOSTNAME = 'TEST-UI-CLIENT';
const JOB_ID = 'TEST-UI-JOB';

function runDataInitialization(configPath, password) {
  const initScript = path.join(__dirname, 'Initialize-OnlyBackupData.js');
  const result = spawnSync(process.execPath, [initScript], {
    cwd: path.join(__dirname, '..', '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      CONFIG_PATH: configPath,
      ONLYBACKUP_INITIAL_ADMIN_PASSWORD: password,
      ONLYBACKUP_RESET_ADMIN_PASSWORD: '1'
    }
  });

  assert.strictEqual(
    result.status,
    0,
    `Inizializzazione dati UI fallita.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
  );
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
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
        const requestedPath = body.path || filesystemRoot;
        const items = fs.existsSync(requestedPath)
          ? fs.readdirSync(requestedPath, { withFileTypes: true }).map(entry => ({
              name: entry.name,
              path: path.join(requestedPath, entry.name),
              type: entry.isFile() ? 'file' : 'directory'
            }))
          : [];
        sendJson(res, 200, { path: requestedPath, items });
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

      if (req.url === '/filesystem/delete') {
        const paths = Array.isArray(body.paths) ? body.paths : [];
        paths.forEach(entry => {
          const targetPath = typeof entry === 'string' ? entry : entry?.path;
          if (targetPath) {
            fs.rmSync(targetPath, { recursive: true, force: true });
          }
        });
        sendJson(res, 200, { success: true });
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
    close: () => new Promise(resolve => server.close(resolve))
  };
}

async function waitForServerPort(server) {
  const address = server.server?.address();
  const port = address && typeof address === 'object' ? address.port : null;
  assert.ok(port, 'Porta HTTP non disponibile dopo avvio server');
  return port;
}

async function api(baseUrl, urlPath, { method = 'GET', json = null } = {}) {
  const headers = {};
  let body;
  if (json !== null) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  const response = await fetch(`${baseUrl}${urlPath}`, { method, headers, body });
  const payload = await response.json().catch(() => null);
  assert.ok(response.ok, `${method} ${urlPath} ha risposto ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function loginAndChangePassword(page, baseUrl) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill(INITIAL_PASSWORD);
  await page.locator('#loginForm button[type="submit"]').click();
  await page.locator('#changePasswordScreen:not(.hidden)').waitFor();

  await page.locator('#oldPassword').fill(INITIAL_PASSWORD);
  await page.locator('#newPassword').fill(NEW_PASSWORD);
  await page.locator('#confirmPassword').fill(NEW_PASSWORD);
  await page.locator('#changePasswordForm button[type="submit"]').click();
  await page.locator('#mainDashboard:not(.hidden)').waitFor();
}

async function assertNoHorizontalOverflow(page, label) {
  const result = await page.evaluate(() => {
    const doc = document.documentElement;
    const overflow = doc.scrollWidth - doc.clientWidth;
    const clipped = Array.from(document.querySelectorAll('button, a, input, select, textarea, [role="tab"], [role="button"]'))
      .filter(element => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0) {
          return false;
        }
        return element.scrollWidth > element.clientWidth + 3 && style.whiteSpace !== 'normal';
      })
      .map(element => ({
        text: (element.innerText || element.value || element.getAttribute('aria-label') || element.id || element.tagName).trim(),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth
      }));

    return { overflow, clipped };
  });

  assert.ok(result.overflow <= 4, `${label}: overflow orizzontale pagina ${result.overflow}px`);
  assert.deepStrictEqual(result.clipped, [], `${label}: controlli con testo tagliato`);
}

async function assertTabOrderVisible(page, label, count = 18) {
  await page.keyboard.press('Home');
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(async () => {
      const element = document.activeElement;
      if (!element || element === document.body) {
        return { ok: true, label: 'body' };
      }
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      await new Promise(resolve => requestAnimationFrame(resolve));
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        ok: style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0,
        label: (element.innerText || element.value || element.getAttribute('aria-label') || element.id || element.tagName).trim(),
        details: {
          display: style.display,
          visibility: style.visibility,
          width: rect.width,
          height: rect.height,
          top: rect.top,
          left: rect.left,
          classes: element.className || ''
        }
      };
    });
    assert.ok(focused.ok, `${label}: focus non visibile al tab ${index + 1} (${focused.label}) ${JSON.stringify(focused.details)}`);
  }
}

async function checkViewport(page, screenshotDir, label) {
  await assertNoHorizontalOverflow(page, label);
  await assertTabOrderVisible(page, label);
  await page.screenshot({ path: path.join(screenshotDir, `${label}.png`), fullPage: true });
}

async function verifyDashboardFilters(page) {
  for (const filter of ['all', 'critical', 'offline', 'failed', 'running', 'no-jobs']) {
    const chip = page.locator(`.filter-chip[data-filter="${filter}"]`);
    await chip.click();
    await page.waitForFunction(value => document.querySelector(`.filter-chip[data-filter="${value}"]`)?.classList.contains('active'), filter);
  }
}

async function selectClient(page) {
  await page.locator('#clientsList').getByText(HOSTNAME, { exact: false }).click();
  await page.locator('#selectedClientName').getByText(HOSTNAME).waitFor();
  await page.locator('#onboardingChecklist').getByText('Password admin cambiata').waitFor();
}

async function createJobThroughUi(page, sourcePath, destinationPath) {
  await page.getByRole('button', { name: /\+ Nuovo Job/ }).click();
  await page.locator('#jobEditorForm:not(.hidden)').waitFor();
  await page.locator('#jobIdField').fill(JOB_ID);

  await page.locator('.job-wizard-step[data-step="schedule"]').click();
  await page.locator('#scheduleTimes').getByText('02:00').waitFor();

  await page.locator('.job-wizard-step[data-step="mappings"]').click();
  await page.locator('input[aria-label="Etichetta mappatura 1"]').fill('UI Smoke');
  await page.locator('input[aria-label="Percorso sorgente mappatura 1"]').fill(sourcePath);
  await page.locator('input[aria-label="Percorso destinazione mappatura 1"]').fill(destinationPath);

  await page.locator('.job-wizard-step[data-step="review"]').click();
  await page.locator('#jobReviewContent').getByText(JOB_ID).waitFor();
  await page.locator('#saveJobButton').click();
  await page.locator('#jobPreviewDialog:not(.hidden)').waitFor();
  await page.locator('#jobPreviewTitle').getByText('Revisione salvataggio job').waitFor();
  await page.locator('#jobPreviewContent').getByText(JOB_ID).waitFor();
  await page.locator('#jobPreviewConfirmButton').click();
  await page.waitForFunction(() => document.querySelector('#jobPreviewDialog')?.classList.contains('hidden'));
  await page.locator('#jobsList').getByText(JOB_ID).waitFor();
}

async function runJobThroughUi(page) {
  await page.locator('button[onclick="app.runEditingJob()"]').click();
  await page.locator('#jobPreviewDialog:not(.hidden)').waitFor();
  await page.locator('#jobPreviewTitle').getByText('Revisione esecuzione manuale').waitFor();
  await Promise.all([
    page.waitForResponse(response => response.url().includes(`/api/jobs/${encodeURIComponent(JOB_ID)}/run`) && response.ok()),
    page.locator('#jobPreviewConfirmButton').click()
  ]);
  await page.waitForFunction(() => document.querySelector('#jobPreviewDialog')?.classList.contains('hidden'));
  await page.locator('#runsList').getByText(JOB_ID).first().waitFor({ timeout: 10000 });
}

async function openBackupsModal(page) {
  await page.evaluate(jobId => {
    window.app.showTab('jobs');
    window.app.editJob(jobId);
  }, JOB_ID);
  await page.locator('button[onclick="app.openBackupsList()"]').click();
  await page.locator('#backupsModal:not(.hidden)').waitFor();
  await page.getByRole('button', { name: 'Carica backup' }).click();
  await page.locator('.backup-row').first().waitFor();
}

async function assertDashboardStrongConfirmBlocksRequest(page, name, expectedText, requestMatcher, openAction) {
  let requests = 0;
  const listener = request => {
    if (requestMatcher(request)) {
      requests += 1;
    }
  };
  page.on('request', listener);
  try {
    await openAction();
    await page.locator('#strongConfirmDialog:not(.hidden)').waitFor();
    await page.locator('#strongConfirmExpected').getByText(expectedText, { exact: true }).waitFor();
    await page.locator('#strongConfirmInput').fill('__TESTO_ERRATO__');
    await assert.strictEqual(await page.locator('#strongConfirmButton').isDisabled(), true, `${name}: conferma abilitata con testo errato`);
    await assertNoHorizontalOverflow(page, `${name}-modal`);
    await page.locator('#strongConfirmDialog').getByRole('button', { name: 'Annulla' }).click();
    await page.waitForFunction(() => document.querySelector('#strongConfirmDialog')?.classList.contains('hidden'));
    assert.strictEqual(requests, 0, `${name}: richiesta inviata con testo errato`);
  } finally {
    page.off('request', listener);
  }
}

async function assertSettingsStrongConfirmBlocksRequest(page, name, expectedText, requestMatcher, openAction) {
  let requests = 0;
  const listener = request => {
    if (requestMatcher(request)) {
      requests += 1;
    }
  };
  page.on('request', listener);
  try {
    await openAction();
    const modal = page.locator('.modal').filter({ has: page.locator('#strongSettingsConfirmInput') }).last();
    await modal.locator('#strongSettingsConfirmInput').waitFor();
    await modal.locator('label strong').getByText(expectedText, { exact: true }).waitFor();
    await modal.locator('#strongSettingsConfirmInput').fill('__TESTO_ERRATO__');
    await assert.strictEqual(await modal.locator('.btn-confirm').isDisabled(), true, `${name}: conferma abilitata con testo errato`);
    await assertNoHorizontalOverflow(page, `${name}-modal`);
    await modal.locator('.btn-cancel').click();
    await modal.waitFor({ state: 'detached' });
    assert.strictEqual(requests, 0, `${name}: richiesta inviata con testo errato`);
  } finally {
    page.off('request', listener);
  }
}

async function verifyDestructiveConfirmations(page) {
  const matches = (method, fragment) => request => request.method() === method && request.url().includes(fragment);
  if (!(await page.locator('#backupsModal').evaluate(element => element.classList.contains('hidden')))) {
    await page.locator('#backupsModal').getByRole('button', { name: 'Chiudi' }).click();
    await page.waitForFunction(() => document.querySelector('#backupsModal')?.classList.contains('hidden'));
  }
  await page.evaluate(jobId => {
    window.app.showTab('jobs');
    window.app.editJob(jobId);
  }, JOB_ID);

  await assertDashboardStrongConfirmBlocksRequest(
    page,
    'elimina-job',
    JOB_ID,
    matches('DELETE', `/api/jobs/${encodeURIComponent(JOB_ID)}`),
    () => page.locator('button[onclick="app.deleteEditingJob()"]').click()
  );

  await assertDashboardStrongConfirmBlocksRequest(
    page,
    'elimina-log-client',
    HOSTNAME,
    matches('DELETE', `/api/clients/${encodeURIComponent(HOSTNAME)}/runs`),
    async () => {
      await page.locator('details.danger-menu').evaluate(element => { element.open = true; });
      await page.locator('button[onclick="app.clearClientLogs()"]').click();
    }
  );

  await assertDashboardStrongConfirmBlocksRequest(
    page,
    'deregistra-client',
    HOSTNAME,
    matches('DELETE', `/api/clients/${encodeURIComponent(HOSTNAME)}`),
    async () => {
      await page.locator('details.danger-menu').evaluate(element => { element.open = true; });
      await page.locator('button[onclick="app.deregisterClient()"]').click();
    }
  );

  await assertDashboardStrongConfirmBlocksRequest(
    page,
    'reset-stato-backup',
    HOSTNAME,
    matches('POST', `/api/clients/${encodeURIComponent(HOSTNAME)}/reset-backup-status`),
    () => page.locator('#clientsList').getByRole('button', { name: `Resetta stato backup di ${HOSTNAME}` }).click()
  );

  await openBackupsModal(page);

  await assertDashboardStrongConfirmBlocksRequest(
    page,
    'delete-backup-singolo',
    JOB_ID,
    matches('POST', `/api/clients/${encodeURIComponent(HOSTNAME)}/jobs/${encodeURIComponent(JOB_ID)}/backups/delete`),
    () => page.locator('.backup-row').first().getByRole('button', { name: 'Elimina' }).click()
  );

  await assertDashboardStrongConfirmBlocksRequest(
    page,
    'delete-backup-multiplo',
    JOB_ID,
    matches('POST', `/api/clients/${encodeURIComponent(HOSTNAME)}/jobs/${encodeURIComponent(JOB_ID)}/backups/delete`),
    async () => {
      await page.locator('.backup-checkbox').first().check();
      await page.getByRole('button', { name: 'Elimina selezionati' }).click();
    }
  );

  await page.locator('#backupsModal').getByRole('button', { name: 'Chiudi' }).click();
  await page.waitForFunction(() => document.querySelector('#backupsModal')?.classList.contains('hidden'));
}

async function verifySettingsConfirmations(page, baseUrl) {
  const matches = (method, fragment) => request => request.method() === method && request.url().includes(fragment);
  await page.goto(`${baseUrl}/server-settings.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.locator('#dataTabButton').click();

  await assertSettingsStrongConfirmBlocksRequest(
    page,
    'cancella-storico-alert',
    'CANCELLA ALERT',
    matches('DELETE', '/api/alerts/history'),
    () => page.getByRole('button', { name: 'Cancella Storico Alert' }).click()
  );

  await assertSettingsStrongConfirmBlocksRequest(
    page,
    'elimina-tutti-log',
    'ELIMINA LOG',
    matches('DELETE', '/api/runs/all'),
    () => page.getByRole('button', { name: 'Elimina Tutti i Log' }).click()
  );

  await page.locator('#serviceTabButton').click();
  await assertSettingsStrongConfirmBlocksRequest(
    page,
    'controllo-servizio',
    'OnlyBackupServer',
    matches('POST', '/api/server/service/start'),
    () => page.getByRole('button', { name: 'Avvia Servizio', exact: true }).click()
  );

  await assertSettingsStrongConfirmBlocksRequest(
    page,
    'riavvio-server',
    'RIAVVIA SERVER',
    matches('POST', '/api/server/reboot'),
    () => page.getByRole('button', { name: 'Riavvia Server' }).click()
  );
}

async function verifyResponsivePages(page, baseUrl, screenshotDir) {
  const viewports = [
    { name: 'desktop', width: 1366, height: 900 },
    { name: 'mobile', width: 390, height: 844 }
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('#mainDashboard:not(.hidden)').waitFor();
    await selectClient(page);
    await checkViewport(page, screenshotDir, `${viewport.name}-dashboard`);

    await page.evaluate(jobId => {
      window.app.showTab('jobs');
      window.app.editJob(jobId);
    }, JOB_ID);
    await page.locator('button[onclick="app.openBackupsList()"]').click();
    await page.locator('#backupsModal:not(.hidden)').waitFor();
    await checkViewport(page, screenshotDir, `${viewport.name}-backup-modal`);
    await page.locator('#backupsModal').getByRole('button', { name: 'Chiudi' }).click();

    await page.goto(`${baseUrl}/alerts.html`, { waitUntil: 'domcontentloaded' });
    await checkViewport(page, screenshotDir, `${viewport.name}-alerts`);

    await page.goto(`${baseUrl}/server-settings.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await checkViewport(page, screenshotDir, `${viewport.name}-server-settings`);

    await page.goto(`${baseUrl}/email-settings.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await checkViewport(page, screenshotDir, `${viewport.name}-email-settings`);
  }
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlybackup-ui-smoke-'));
  const configPath = path.join(tempRoot, 'config.json');
  const dataRoot = path.join(tempRoot, 'data');
  const sourceRoot = path.join(tempRoot, 'source');
  const destinationRoot = path.join(tempRoot, 'destination');
  const screenshotDir = path.join(__dirname, '..', '..', 'output', 'playwright');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(destinationRoot, { recursive: true });
  fs.mkdirSync(screenshotDir, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'file.txt'), 'ui-smoke-test', 'utf8');

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
      retentionDays: 7
    },
    auth: {
      sessionTimeout: 60000,
      passwordMinLength: 8,
      secureCookies: false
    },
    scheduler: {
      checkInterval: 60000,
      enableFileWatcher: false
    },
    oauth: {
      providers: {
        google: { clientId: 'google-config-client-id', clientSecret: 'google-config-client-secret' },
        microsoft: { clientId: 'microsoft-config-client-id', clientSecret: 'microsoft-config-client-secret' }
      }
    }
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  runDataInitialization(configPath, INITIAL_PASSWORD);

  const previousConfigPath = process.env.CONFIG_PATH;
  const previousAgentMsiPath = process.env.ONLYBACKUP_AGENT_MSI_PATH;
  process.env.CONFIG_PATH = configPath;
  process.env.ONLYBACKUP_AGENT_MSI_PATH = path.join(tempRoot, 'missing-agent-package', 'OnlyBackupAgent.msi');

  const server = new OnlyBackupServer();
  let browser;
  try {
    console.log('Smoke UI: avvio server...');
    await server.start();
    const port = await waitForServerPort(server);
    const baseUrl = `http://127.0.0.1:${port}`;

    await api(baseUrl, '/api/agent/heartbeat', {
      method: 'POST',
      json: {
        hostname: HOSTNAME,
        status: 'online',
        agent_ip: '127.0.0.1',
        agent_port: fakeAgent.port,
        backup_status: 'in_progress',
        backup_job_id: JOB_ID
      }
    });
    await api(baseUrl, '/api/agent/heartbeat', {
      method: 'POST',
      json: {
        hostname: 'TEST-UI-OFFLINE',
        status: 'offline',
        agent_ip: '127.0.0.1',
        agent_port: fakeAgent.port,
        backup_status: 'failed'
      }
    });

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const browserErrors = [];
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') {
        if (message.text().includes('401 (Unauthorized)')) {
          return;
        }
        browserErrors.push(message.text());
      }
    });

    console.log('Smoke UI: login e cambio password...');
    await loginAndChangePassword(page, baseUrl);
    await verifyDashboardFilters(page);
    await selectClient(page);

    console.log('Smoke UI: wizard job e preview...');
    await createJobThroughUi(page, path.join(sourceRoot, 'file.txt'), destinationRoot);
    await runJobThroughUi(page);
    await openBackupsModal(page);

    console.log('Smoke UI: conferme forti distruttive...');
    await verifyDestructiveConfirmations(page);
    await verifySettingsConfirmations(page, baseUrl);

    console.log('Smoke UI: responsive e tab order...');
    await verifyResponsivePages(page, baseUrl, screenshotDir);

    assert.deepStrictEqual(browserErrors, [], `Errori console/browser:\n${browserErrors.join('\n')}`);
    console.log('Smoke test UI completato con successo.');
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    await Promise.race([
      server.stop().catch(() => {}),
      new Promise(resolve => setTimeout(resolve, 5000))
    ]);
    await fakeAgent.close().catch(() => {});

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
  }
}

main().catch(error => {
  console.error('Smoke test UI fallito:', error);
  process.exit(1);
});
