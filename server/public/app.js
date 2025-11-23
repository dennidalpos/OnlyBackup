const apiBase = '';

let selectedAgentId = null;
let adminCreds = null;
let wsDashboard = null;
let selectedSources = [];
let currentBrowsePath = '';
let agentsCache = [];
let lastBackupStatusPerAgent = {};
let fsBrowserActive = false;

function isAdminLogged() {
  return !!adminCreds;
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error('HTTP ' + res.status + ': ' + txt);
  }
  return res.json();
}

function formatTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  const pad = n => (n < 10 ? '0' + n : '' + n);
  return (
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    ' ' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes()) +
    ':' +
    pad(d.getSeconds())
  );
}

function formatBytesHuman(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return b.toFixed(2) + ' B';
  if (b < 1048576) return (b / 1024).toFixed(2) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(2) + ' MB';
  if (b < 1099511627776) return (b / 1073741824).toFixed(2) + ' GB';
  return (b / 1099511627776).toFixed(2) + ' TB';
}

function deriveBackupStatus(agent) {
  const fromMap = lastBackupStatusPerAgent[agent.agentId];
  const raw = (fromMap || agent.lastBackupStatus || agent.lastJobStatus || agent.lastJobResult || '').toLowerCase();
  if (raw === 'success' || raw === 'ok' || raw === 'completed') return 'success';
  if (raw === 'failed' || raw === 'error') return 'failed';
  if (!raw) return 'never';
  return raw;
}

function updateTopbarSummary(allAgents) {
  const failedEl = document.getElementById('top-backup-failed');
  if (!failedEl) return;
  const okEl = document.getElementById('top-backup-ok');
  const offEl = document.getElementById('top-endpoints-offline');
  const onEl = document.getElementById('top-endpoints-online');
  let backupFailed = 0;
  let backupOk = 0;
  let endpointsOnline = 0;
  let endpointsOffline = 0;
  allAgents.forEach(a => {
    const status = (a.status || '').toLowerCase();
    if (status === 'online') endpointsOnline++;
    else endpointsOffline++;
    const backupStatus = deriveBackupStatus(a);
    if (backupStatus === 'success') backupOk++;
    else if (backupStatus === 'failed') backupFailed++;
  });
  failedEl.textContent = backupFailed;
  okEl.textContent = backupOk;
  offEl.textContent = endpointsOffline;
  onEl.textContent = endpointsOnline;
}

function renderAgents(agents) {
  const tbody = document.getElementById('agents-body');
  tbody.innerHTML = '';
  agents.forEach(agent => {
    const tr = document.createElement('tr');
    tr.dataset.agentId = agent.agentId;
    if (agent.agentId === selectedAgentId) {
      tr.classList.add('agent-selected');
    }

    const epStatus = (agent.status || '').toLowerCase();
    const backupStatus = deriveBackupStatus(agent);

    const endpointTd = document.createElement('td');
    const endpointWrapper = document.createElement('div');
    endpointWrapper.classList.add('status-cell');
    const endpointLabel = document.createElement('div');
    endpointLabel.classList.add('status-cell-label');
    endpointLabel.textContent = epStatus === 'online' ? 'Online' : 'Offline';
    const endpointDot = document.createElement('span');
    endpointDot.classList.add('status-dot');
    if (epStatus === 'online') endpointDot.classList.add('status-online');
    else endpointDot.classList.add('status-offline');
    endpointWrapper.appendChild(endpointLabel);
    endpointWrapper.appendChild(endpointDot);
    endpointTd.appendChild(endpointWrapper);

    const backupTd = document.createElement('td');
    const backupWrapper = document.createElement('div');
    backupWrapper.classList.add('status-cell');
    const backupLabel = document.createElement('div');
    backupLabel.classList.add('status-cell-label');
    let backupText;
    if (backupStatus === 'success') backupText = 'OK';
    else if (backupStatus === 'failed') backupText = 'Fallito';
    else backupText = 'Mai';
    backupLabel.textContent = backupText;
    const backupDot = document.createElement('span');
    backupDot.classList.add('status-dot');
    if (backupStatus === 'success') backupDot.classList.add('status-online');
    else if (backupStatus === 'failed') backupDot.classList.add('status-offline');
    else backupDot.classList.add('status-warning');
    backupWrapper.appendChild(backupLabel);
    backupWrapper.appendChild(backupDot);
    backupTd.appendChild(backupWrapper);

    const hostTd = document.createElement('td');
    hostTd.textContent = agent.hostname || agent.agentId;

    const ipTd = document.createElement('td');
    ipTd.textContent = (agent.ipAddresses || []).join(', ');

    const osTd = document.createElement('td');
    osTd.textContent = agent.osVersion || '';

    const lastTd = document.createElement('td');
    lastTd.textContent = formatTimestamp(agent.lastSeen);

    tr.appendChild(endpointTd);
    tr.appendChild(backupTd);
    tr.appendChild(hostTd);
    tr.appendChild(ipTd);
    tr.appendChild(osTd);
    tr.appendChild(lastTd);

    tr.addEventListener('click', () => {
      selectedAgentId = agent.agentId;
      try {
        localStorage.setItem('sbSelectedAgentId', selectedAgentId);
      } catch { }
      highlightSelectedAgent();
      loadAgentDetails();
    });

    tbody.appendChild(tr);
  });
  highlightSelectedAgent();
}

function highlightSelectedAgent() {
  const rows = document.querySelectorAll('#agents-body tr');
  rows.forEach(r => {
    if (r.dataset.agentId === selectedAgentId) {
      r.classList.add('agent-selected');
    } else {
      r.classList.remove('agent-selected');
    }
  });
}

function applyAgentFilterAndSummary() {
  const searchInput = document.getElementById('agent-search');
  let filtered = agentsCache || [];
  if (searchInput) {
    const term = searchInput.value.trim().toLowerCase();
    if (term) {
      filtered = agentsCache.filter(a => {
        const host = (a.hostname || '').toLowerCase();
        const id = (a.agentId || '').toLowerCase();
        const ips = (a.ipAddresses || []).join(' ').toLowerCase();
        return host.includes(term) || id.includes(term) || ips.includes(term);
      });
    }
  }
  renderAgents(filtered);
  updateTopbarSummary(agentsCache);
}

async function loadAgents() {
  try {
    const agents = await fetchJson(apiBase + '/api/agents');
    agentsCache = agents;
    applyAgentFilterAndSummary();
  } catch (e) {
    console.error(e);
  }
}

function humanBackupStatus(agent) {
  const status = deriveBackupStatus(agent);
  if (status === 'success') return 'Ultimo backup: OK';
  if (status === 'failed') return 'Ultimo backup: FALLITO';
  if (status === 'never') return 'Backup mai eseguito';
  return 'Stato backup: ' + status;
}

async function loadAgentDetails() {
  if (!selectedAgentId) return;
  try {
    const agent = await fetchJson(apiBase + '/api/agents/' + selectedAgentId);
    const infoDiv = document.getElementById('selected-agent-info');
    const epStatus = (agent.status || '').toLowerCase();
    const backupStatus = deriveBackupStatus(agent);
    const lastBackupAt = agent.lastBackupAt ? formatTimestamp(agent.lastBackupAt) : 'n.d.';
    const backupText = humanBackupStatus(agent) + (agent.lastBackupAt ? ' • ' + lastBackupAt : '');
    infoDiv.innerHTML = `
      <div class="agent-main-line">
        <strong>${agent.hostname || agent.agentId}</strong>
        <span class="agent-os">${agent.osVersion || ''}</span>
      </div>
      <div class="agent-status-line">
        <span class="agent-status-badge ${epStatus === 'online' ? 'agent-status-badge-endpoint-online' : 'agent-status-badge-endpoint-offline'}">
          Endpoint: ${epStatus === 'online' ? 'Online' : 'Offline'}
        </span>
        <span class="agent-status-badge ${backupStatus === 'success'
        ? 'agent-status-badge-backup-ok'
        : backupStatus === 'failed'
          ? 'agent-status-badge-backup-failed'
          : 'agent-status-badge-backup-never'
      }">
          ${backupText}
        </span>
      </div>
    `;
    if (!fsBrowserActive) {
      selectedSources = [];
      const sourcesList = document.getElementById('sources-list');
      if (sourcesList) sourcesList.innerHTML = '';
      currentBrowsePath = '';
      const fsResults = document.getElementById('fs-results');
      if (fsResults) fsResults.innerHTML = '';
    }
    if (isAdminLogged()) {
      await loadJobs();
      await loadHistory();
    } else {
      const jobsDiv = document.getElementById('jobs-list');
      jobsDiv.textContent = 'Effettua login admin per visualizzare e gestire i job';
      const histDiv = document.getElementById('history-list');
      histDiv.textContent = 'Effettua login admin per visualizzare lo storico';
    }
  } catch (e) {
    console.error(e);
  }
}

function renderFsItem(container, item, type) {
  const row = document.createElement('div');
  row.classList.add('fs-item');
  if (type === 'dir') row.classList.add('fs-dir');
  if (type === 'file') row.classList.add('fs-file');
  if (type === 'drive') row.classList.add('fs-dir-root');

  const cbCol = document.createElement('div');
  cbCol.classList.add('fs-col-checkbox');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.dataset.fullPath = item.fullPath;
  cbCol.appendChild(cb);

  const nameCol = document.createElement('div');
  nameCol.classList.add('fs-col-name');
  nameCol.classList.add(type === 'file' ? 'fs-name' : type === 'drive' ? 'fs-drive' : 'fs-name');
  nameCol.textContent = item.name;
  nameCol.addEventListener('click', () => {
    if (type === 'file') {
      cb.checked = !cb.checked;
    } else {
      currentBrowsePath = item.fullPath;
      browseFs();
    }
  });

  const typeCol = document.createElement('div');
  typeCol.classList.add('fs-col-type');
  typeCol.textContent = type === 'file' ? 'File' : 'Cartella';

  const sizeCol = document.createElement('div');
  sizeCol.classList.add('fs-col-size');
  sizeCol.textContent = item.size ? formatBytesHuman(item.size) : '';

  const pathCol = document.createElement('div');
  pathCol.classList.add('fs-col-path');
  pathCol.textContent = item.fullPath;

  row.appendChild(cbCol);
  row.appendChild(nameCol);
  row.appendChild(typeCol);
  row.appendChild(sizeCol);
  row.appendChild(pathCol);

  container.appendChild(row);
}

function openPath(p) {
  currentBrowsePath = p || '';
  browseFs();
}

function goUp() {
  if (!currentBrowsePath) return;
  let p = currentBrowsePath.replace(/[\\\/]+$/, '');
  if (!p) {
    currentBrowsePath = '';
  } else {
    const idx = p.lastIndexOf('\\');
    if (idx <= 2) currentBrowsePath = '';
    else currentBrowsePath = p.substring(0, idx);
  }
  browseFs();
}

async function browseFs() {
  if (!selectedAgentId) {
    alert('Seleziona prima un endpoint');
    return;
  }
  fsBrowserActive = true;
  const browsePath = currentBrowsePath || '';
  const encodedPath = encodeURIComponent(browsePath);
  const container = document.getElementById('fs-results');
  container.textContent = 'Caricamento.';
  try {
    const res = await fetchJson(apiBase + '/api/agents/' + selectedAgentId + '/browse?path=' + encodedPath);
    container.innerHTML = '';

    const upRow = document.createElement('div');
    upRow.classList.add('fs-item', 'fs-up');
    const upSpan = document.createElement('div');
    upSpan.classList.add('fs-col-name');
    upSpan.textContent = '.. (su)';
    upRow.appendChild(document.createElement('div'));
    upRow.appendChild(upSpan);
    upRow.appendChild(document.createElement('div'));
    upRow.appendChild(document.createElement('div'));
    upRow.appendChild(document.createElement('div'));
    upRow.addEventListener('click', () => goUp());
    container.appendChild(upRow);

    const dirs = res.directories || [];
    const files = res.files || [];

    dirs.forEach(d => {
      renderFsItem(container, d, 'dir');
    });
    files.forEach(f => {
      renderFsItem(container, f, 'file');
    });

    const sourcesList = document.getElementById('sources-list');
    sourcesList.innerHTML = '';
    selectedSources.forEach(p => {
      const li = document.createElement('li');
      li.textContent = p;
      const btn = document.createElement('button');
      btn.textContent = 'Rimuovi';
      btn.classList.add('btn-remove-source');
      btn.addEventListener('click', () => {
        selectedSources = selectedSources.filter(x => x !== p);
        li.remove();
      });
      li.appendChild(btn);
      sourcesList.appendChild(li);
    });
  } catch (e) {
    container.textContent = 'Errore caricamento filesystem: ' + e.message;
  }
}

function addDestinationRow(dest) {
  const container = document.getElementById('destinations-list');
  const row = document.createElement('div');
  row.classList.add('destination-row');

  const pathInput = document.createElement('input');
  pathInput.type = 'text';
  pathInput.placeholder = '\\\\server\\share o cartella locale';
  pathInput.classList.add('dest-path-input');
  pathInput.value = dest && dest.path ? dest.path : '';

  const accountInput = document.createElement('input');
  accountInput.type = 'text';
  accountInput.placeholder = 'DOMINIO\\utente o utente';
  accountInput.classList.add('dest-account-input');
  if (dest && dest.credentials) {
    const dom = dest.credentials.domain || '';
    const usr = dest.credentials.username || '';
    accountInput.value = dom ? dom + '\\' + usr : usr;
  }

  const pwdInput = document.createElement('input');
  pwdInput.type = 'password';
  pwdInput.placeholder = 'Password (facoltativa)';
  pwdInput.classList.add('dest-password-input');
  if (dest && dest.credentials && dest.credentials.password) {
    pwdInput.value = dest.credentials.password;
  }

  const btnRemove = document.createElement('button');
  btnRemove.type = 'button';
  btnRemove.textContent = 'Rimuovi';
  btnRemove.classList.add('btn-dest-remove');
  btnRemove.addEventListener('click', () => {
    row.remove();
  });

  row.appendChild(pathInput);
  row.appendChild(accountInput);
  row.appendChild(pwdInput);
  row.appendChild(btnRemove);
  container.appendChild(row);
}

function setDestinationsInForm(destinations) {
  const container = document.getElementById('destinations-list');
  if (!container) return;
  container.innerHTML = '';
  let list = destinations && destinations.length ? destinations : [{ path: '', credentials: {} }];
  list.forEach(d => addDestinationRow(d));
}

function parseAccount(value) {
  const text = value || '';
  const idx = text.indexOf('\\');
  if (idx > 0) {
    return {
      domain: text.substring(0, idx),
      username: text.substring(idx + 1)
    };
  }
  return {
    domain: null,
    username: text
  };
}

function getDestinationsFromForm() {
  const container = document.getElementById('destinations-list');
  if (!container) return [];
  const rows = Array.from(container.querySelectorAll('.destination-row'));
  const result = [];
  rows.forEach(row => {
    const pathInput = row.querySelector('.dest-path-input');
    const accInput = row.querySelector('.dest-account-input');
    const pwdInput = row.querySelector('.dest-password-input');
    const path = pathInput ? pathInput.value.trim() : '';
    const account = accInput ? accInput.value.trim() : '';
    const password = pwdInput ? pwdInput.value : '';
    const dest = { path: path, credentials: null };
    if (account || password) {
      const parsed = parseAccount(account);
      dest.credentials = {
        domain: parsed.domain,
        username: parsed.username,
        password: password
      };
    }
    result.push(dest);
  });
  return result;
}

function buildScheduleTimesText(schedule) {
  const s = schedule || {};
  const times = [];
  if (s.time) times.push(s.time);
  if (Array.isArray(s.extraTimes)) {
    s.extraTimes.forEach(t => {
      if (t) times.push(t);
    });
  }
  if (!times.length) return 'n.d.';
  return times.join(', ');
}

async function loadJobs() {
  if (!selectedAgentId) return;
  const listDiv = document.getElementById('jobs-list');
  listDiv.textContent = 'Caricamento.';
  try {
    const data = await fetchJson(apiBase + '/api/jobs/' + selectedAgentId);
    listDiv.innerHTML = '';
    (data.jobs || []).forEach(job => {
      const div = document.createElement('div');
      div.classList.add('job-entry');
      div.dataset.jobId = job.id;

      const title = document.createElement('div');
      title.classList.add('job-entry-title');
      title.textContent = job.name + ' (' + job.id + ')';

      const sections = document.createElement('div');
      sections.classList.add('job-entry-sections');

      const srcSection = document.createElement('div');
      srcSection.classList.add('job-entry-section');
      const srcLabel = document.createElement('div');
      srcLabel.classList.add('job-entry-section-label');
      srcLabel.textContent = 'Sorgenti';
      const srcContent = document.createElement('div');
      srcContent.classList.add('job-entry-section-content');
      srcContent.textContent = (job.sources || []).join(', ') || 'Nessuna sorgente';
      srcSection.appendChild(srcLabel);
      srcSection.appendChild(srcContent);

      const destSection = document.createElement('div');
      destSection.classList.add('job-entry-section');
      const destLabel = document.createElement('div');
      destLabel.classList.add('job-entry-section-label');
      destLabel.textContent = 'Destinazioni';
      const destContent = document.createElement('div');
      destContent.classList.add('job-entry-section-content');
      destContent.textContent = (job.destinations || []).map(d => d.path).join(', ') || 'Nessuna destinazione';
      destSection.appendChild(destLabel);
      destSection.appendChild(destContent);

      const schedSection = document.createElement('div');
      schedSection.classList.add('job-entry-section');
      const schedLabel = document.createElement('div');
      schedLabel.classList.add('job-entry-section-label');
      schedLabel.textContent = 'Pianificazione';
      const schedContent = document.createElement('div');
      schedContent.classList.add('job-entry-section-content');
      const s = job.schedule || {};
      const modeLabel = job.options && job.options.syncMode === 'sync' ? 'Sync' : 'Copia';
      const timesText = buildScheduleTimesText(s);
      let schedText = '';
      if (s.type === 'weekly') {
        const dow = typeof s.dayOfWeek === 'number' ? s.dayOfWeek : null;
        schedText = 'Settimanale';
        if (dow !== null) schedText += ' (giorno ' + dow + ')';
      } else if (s.type === 'monthly') {
        const dom = typeof s.dayOfMonth === 'number' ? s.dayOfMonth : null;
        schedText = 'Mensile';
        if (dom !== null) schedText += ' (giorno ' + dom + ')';
      } else {
        schedText = 'Giornaliero';
      }
      schedText += ' • Orari: ' + timesText + ' • Tipo backup: ' + modeLabel;
      schedContent.textContent = schedText;
      schedSection.appendChild(schedLabel);
      schedSection.appendChild(schedContent);

      sections.appendChild(srcSection);
      sections.appendChild(destSection);
      sections.appendChild(schedSection);

      const actions = document.createElement('div');
      actions.classList.add('job-entry-actions');

      const btnRun = document.createElement('button');
      btnRun.textContent = 'Esegui ora';
      btnRun.disabled = !isAdminLogged();
      btnRun.addEventListener('click', () => runJob(job.id));

      const btnEdit = document.createElement('button');
      btnEdit.textContent = 'Modifica';
      btnEdit.disabled = !isAdminLogged();
      btnEdit.addEventListener('click', () => fillJobForm(job));

      const btnDelete = document.createElement('button');
      btnDelete.textContent = 'Rimuovi';
      btnDelete.disabled = !isAdminLogged();
      btnDelete.classList.add('btn-delete');
      btnDelete.addEventListener('click', () => deleteJob(job.id));

      actions.appendChild(btnRun);
      actions.appendChild(btnEdit);
      actions.appendChild(btnDelete);

      div.appendChild(title);
      div.appendChild(sections);
      div.appendChild(actions);

      listDiv.appendChild(div);
    });
  } catch (e) {
    console.error(e);
    listDiv.textContent = 'Errore caricamento job';
  }
}

async function runJob(jobId) {
  if (!selectedAgentId) return;
  try {
    await fetchJson(apiBase + '/api/jobs/' + selectedAgentId + '/' + encodeURIComponent(jobId) + '/run', {
      method: 'POST'
    });
    alert('Job avviato');
  } catch (e) {
    alert('Errore avvio job: ' + e.message);
  }
}

async function deleteJob(jobId) {
  if (!selectedAgentId) return;
  if (!confirm('Confermi la rimozione definitiva del job ' + jobId + '?')) return;
  try {
    await fetchJson(apiBase + '/api/jobs/' + selectedAgentId + '/' + encodeURIComponent(jobId), {
      method: 'DELETE'
    });
    if (document.getElementById('job-id').value === jobId) resetJobForm();
    await loadJobs();
  } catch (e) {
    alert('Errore rimozione job: ' + e.message);
  }
}

function setFormMode(isEdit, jobName) {
  const label = document.getElementById('job-form-mode');
  const resetBtn = document.getElementById('btn-reset-job');
  if (isEdit) {
    label.textContent = 'Modalità: modifica job ' + jobName;
    resetBtn.textContent = 'Nuovo job';
  } else {
    label.textContent = 'Modalità: nuovo job';
    resetBtn.textContent = 'Pulisci campi';
  }
}

function fillJobForm(job) {
  document.getElementById('job-id').value = job.id || '';
  document.getElementById('job-name').value = job.name || '';
  document.getElementById('job-sources').value = (job.sources || []).join('\n');
  setDestinationsInForm(job.destinations || []);
  const s = job.schedule || {};
  const type = s.type || 'daily';
  document.getElementById('schedule-type').value = type;
  document.getElementById('schedule-time').value = s.time || '23:00';
  document.getElementById('schedule-extra-times').value = Array.isArray(s.extraTimes) ? s.extraTimes.join(', ') : '';
  if (type === 'weekly') {
    document.getElementById('weekly-options').classList.remove('hidden');
    document.getElementById('monthly-options').classList.add('hidden');
    if (typeof s.dayOfWeek === 'number') {
      document.getElementById('schedule-weekday').value = String(s.dayOfWeek);
    }
  } else if (type === 'monthly') {
    document.getElementById('weekly-options').classList.add('hidden');
    document.getElementById('monthly-options').classList.remove('hidden');
    if (typeof s.dayOfMonth === 'number') {
      document.getElementById('schedule-day-of-month').value = String(s.dayOfMonth);
    }
  } else {
    document.getElementById('weekly-options').classList.add('hidden');
    document.getElementById('monthly-options').classList.add('hidden');
  }
  document.getElementById('sync-mode').value = job.options && job.options.syncMode === 'sync' ? 'sync' : 'copy';
  setFormMode(true, job.name || job.id);
}

function resetJobForm() {
  document.getElementById('job-id').value = '';
  document.getElementById('job-name').value = '';
  document.getElementById('job-sources').value = '';
  setDestinationsInForm([]);
  document.getElementById('schedule-type').value = 'daily';
  document.getElementById('schedule-time').value = '23:00';
  document.getElementById('schedule-extra-times').value = '';
  document.getElementById('schedule-weekday').value = '1';
  document.getElementById('schedule-day-of-month').value = '1';
  document.getElementById('weekly-options').classList.add('hidden');
  document.getElementById('monthly-options').classList.add('hidden');
  document.getElementById('sync-mode').value = 'copy';
  setFormMode(false, null);
}

function hasLocalDestinations(destPaths) {
  const local = [];
  destPaths.forEach(p => {
    const trimmed = (p || '').trim();
    if (!trimmed) return;
    const isUnc = /^\\\\/.test(trimmed);
    if (!isUnc) local.push(trimmed);
  });
  return local;
}

async function saveJob(ev) {
  ev.preventDefault();
  if (!selectedAgentId) {
    alert('Seleziona un endpoint');
    return;
  }
  if (!isAdminLogged()) {
    alert('Effettua login admin');
    return;
  }

  const id = document.getElementById('job-id').value || null;
  const name = document.getElementById('job-name').value;
  const sources = document.getElementById('job-sources').value.split('\n').map(s => s.trim()).filter(s => s);
  const destinationsAll = getDestinationsFromForm();
  const destinations = destinationsAll.filter(d => d.path);
  const scheduleType = document.getElementById('schedule-type').value;
  const scheduleTime = document.getElementById('schedule-time').value || '23:00';
  const extraRaw = document.getElementById('schedule-extra-times').value || '';
  const extraTimes = extraRaw.split(',').map(t => t.trim()).filter(Boolean);
  const syncMode = document.getElementById('sync-mode').value;

  if (!name) {
    alert('Inserisci un nome per il job');
    return;
  }
  if (!sources.length) {
    alert('Seleziona o inserisci almeno una sorgente');
    return;
  }
  if (!destinations.length) {
    alert('Inserisci almeno una destinazione');
    return;
  }

  const destPaths = destinations.map(d => d.path);
  const localDests = hasLocalDestinations(destPaths);
  if (localDests.length) {
    alert(
      'Attenzione: le seguenti destinazioni sono percorsi locali sul client remoto:\n' +
      localDests.join('\n') +
      '\n\nAssicurati che questo sia voluto. Per share di rete usa percorsi UNC come \\\\server\\share.'
    );
  }

  const schedule = { type: scheduleType, time: scheduleTime };
  if (extraTimes.length) {
    schedule.extraTimes = extraTimes;
  }
  if (scheduleType === 'weekly') {
    schedule.dayOfWeek = parseInt(document.getElementById('schedule-weekday').value, 10);
  } else if (scheduleType === 'monthly') {
    schedule.dayOfMonth = parseInt(document.getElementById('schedule-day-of-month').value, 10);
  }

  const job = {
    id: id || undefined,
    name,
    sources,
    destinations,
    schedule,
    options: { syncMode }
  };

  try {
    if (id) {
      await fetchJson(apiBase + '/api/jobs/' + selectedAgentId + '/' + encodeURIComponent(id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job)
      });
    } else {
      await fetchJson(apiBase + '/api/jobs/' + selectedAgentId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job)
      });
    }
    await loadJobs();
    resetJobForm();
  } catch (e) {
    alert('Errore salvataggio job: ' + e.message);
  }
}

async function validateDestinations() {
  if (!selectedAgentId) {
    alert('Seleziona un endpoint');
    return;
  }
  const destinationsAll = getDestinationsFromForm();
  const destinations = destinationsAll.filter(d => d.path);
  if (!destinations.length) {
    alert('Inserisci almeno una destinazione');
    return;
  }
  const destPaths = destinations.map(d => d.path);
  const resultSpan = document.getElementById('dest-validation-result');
  const localDests = hasLocalDestinations(destPaths);
  if (localDests.length) {
    resultSpan.textContent = 'Nota: sono presenti destinazioni locali sul client remoto. ';
    resultSpan.style.color = '#f97316';
  } else {
    resultSpan.textContent = '';
  }
  resultSpan.textContent += 'Verifica in corso.';
  try {
    const res = await fetchJson(apiBase + '/api/jobs/' + selectedAgentId + '/validate-destinations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinations })
    });
    const results = (res.results || res.payload && res.payload.results || []);
    const failed = results.filter(r => !r.ok);
    if (!failed.length) {
      resultSpan.textContent = 'Tutte le destinazioni sono accessibili dal client remoto';
      resultSpan.style.color = 'green';
    } else {
      const first = failed[0];
      resultSpan.textContent = 'Errore accesso a ' + first.path + ': ' + (first.errorMessage || 'errore sconosciuto');
      resultSpan.style.color = 'red';
    }
  } catch (e) {
    resultSpan.textContent = 'Errore validazione: ' + e.message;
    resultSpan.style.color = 'red';
  }
}

function splitPathForValidation(p) {
  const trimmed = p.replace(/[\\\/]+$/, '');
  if (/^[A-Za-z]:$/.test(trimmed)) {
    const root = trimmed + '\\';
    return { parent: root, targetFull: root, isRoot: true };
  }
  if (!trimmed.includes('\\')) return { parent: '', targetFull: trimmed, isRoot: false };
  const idx = trimmed.lastIndexOf('\\');
  let parent = trimmed.substring(0, idx);
  if (/^[A-Za-z]:$/.test(parent)) parent = parent + '\\';
  return { parent, targetFull: trimmed, isRoot: false };
}

async function validateSources() {
  if (!selectedAgentId) {
    alert('Seleziona un endpoint');
    return;
  }
  const sources = document.getElementById('job-sources').value.split('\n').map(s => s.trim()).filter(Boolean);
  const span = document.getElementById('sources-validation-result');
  if (!sources.length) {
    alert('Inserisci almeno una sorgente');
    return;
  }
  span.textContent = 'Verifica in corso.';
  span.style.color = '#0f172a';

  let firstError = null;

  for (const src of sources) {
    try {
      const parts = splitPathForValidation(src);
      if (parts.isRoot) {
        await fetchJson(apiBase + '/api/agents/' + selectedAgentId + '/browse?path=' + encodeURIComponent(parts.parent));
      } else {
        const parent = parts.parent;
        const res = await fetchJson(apiBase + '/api/agents/' + selectedAgentId + '/browse?path=' + encodeURIComponent(parent));
        let found = false;
        const dirs = res.directories || [];
        const files = res.files || [];
        if (dirs.some(d => (d.fullPath || '').toLowerCase() === parts.targetFull.toLowerCase())) found = true;
        if (files.some(f => (f.fullPath || '').toLowerCase() === parts.targetFull.toLowerCase())) found = true;
        if (!found) {
          firstError = 'Sorgente non trovata o non accessibile: ' + src;
          break;
        }
      }
    } catch (e) {
      firstError = 'Errore accesso alla sorgente ' + src + ': ' + e.message;
      break;
    }
  }

  if (!firstError) {
    span.textContent = 'Tutte le sorgenti sono accessibili dal client remoto';
    span.style.color = 'green';
  } else {
    span.textContent = firstError;
    span.style.color = 'red';
  }
}

async function loadHistory() {
  if (!selectedAgentId) return;
  const container = document.getElementById('history-list');
  container.textContent = 'Caricamento.';
  try {
    const data = await fetchJson(apiBase + '/api/history/' + selectedAgentId);
    container.innerHTML = '';
    (data.history || []).slice().reverse().forEach(entry => {
      const div = document.createElement('div');
      div.classList.add('history-entry');
      const status = (entry.status || '').toLowerCase();
      if (status === 'failed' || status === 'error') div.classList.add('history-entry-failed');
      let line =
        '[' +
        formatTimestamp(entry.startedAt) +
        ' -> ' +
        formatTimestamp(entry.finishedAt) +
        '] Job ' +
        entry.jobId +
        ' - ' +
        entry.status +
        ' - Files: ' +
        entry.filesCopied +
        ' - Bytes: ' +
        formatBytesHuman(entry.bytesCopied);
      if ((status === 'failed' || status === 'error') && (entry.errorMessage || entry.error)) {
        const errText = entry.errorMessage || entry.error;
        line += ' - Errore: ' + errText;
      }
      div.textContent = line;
      container.appendChild(div);
    });
  } catch (e) {
    console.error(e);
    container.textContent = 'Errore caricamento storico';
  }
}

function connectDashboardWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = proto + '://' + location.hostname + ':8081';
  wsDashboard = new WebSocket(wsUrl);
  wsDashboard.onopen = () => {
    wsDashboard.send(JSON.stringify({ type: 'dashboard_subscribe' }));
  };
  wsDashboard.onmessage = ev => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'agents_snapshot') {
        agentsCache = msg.payload || [];
        applyAgentFilterAndSummary();
      } else if (msg.type === 'agent_update') {
        loadAgents();
      } else if (msg.type === 'job_result') {
        const p = msg.payload || {};
        if (p.agentId && p.status) lastBackupStatusPerAgent[p.agentId] = p.status;
        updateTopbarSummary(agentsCache);
        if (selectedAgentId === p.agentId) {
          loadHistory();
        }
      }
    } catch (e) {
      console.error(e);
    }
  };
  wsDashboard.onclose = () => {
    setTimeout(connectDashboardWs, 5000);
  };
}

function setLoggedInUi(user) {
  const loginForm = document.getElementById('login-form');
  const loginInfo = document.getElementById('login-info');
  const loginStatus = document.getElementById('login-status');
  const btnSave = document.getElementById('btn-save-job');
  const userLabel = document.getElementById('login-user-label');
  userLabel.textContent = 'Loggato come ' + user;
  loginForm.classList.add('hidden');
  loginInfo.classList.remove('hidden');
  loginStatus.textContent = '';
  btnSave.disabled = false;
  document.getElementById('jobs-section').classList.remove('hidden');
  document.getElementById('history-section').classList.remove('hidden');
  document.getElementById('filesystem-browser').classList.remove('hidden');
  if (selectedAgentId) {
    loadJobs();
    loadHistory();
  }
}

function setLoggedOutUi() {
  const loginForm = document.getElementById('login-form');
  const loginInfo = document.getElementById('login-info');
  const btnSave = document.getElementById('btn-save-job');
  loginForm.classList.remove('hidden');
  loginInfo.classList.add('hidden');
  btnSave.disabled = true;
  document.getElementById('jobs-section').classList.add('hidden');
  document.getElementById('history-section').classList.add('hidden');
  document.getElementById('filesystem-browser').classList.add('hidden');
  resetJobForm();
  const jobsDiv = document.getElementById('jobs-list');
  jobsDiv.textContent = 'Effettua login admin per visualizzare e gestire i job';
  const histDiv = document.getElementById('history-list');
  histDiv.textContent = 'Effettua login admin per visualizzare lo storico';
}

function initLogin() {
  const btnLogin = document.getElementById('btn-login');
  const btnLogout = document.getElementById('btn-logout');

  btnLogin.addEventListener('click', () => {
    const user = document.getElementById('admin-user').value;
    const password = document.getElementById('admin-password').value;
    if (!user || !password) {
      alert('Inserisci user e password');
      return;
    }
    adminCreds = { user, password };
    try {
      localStorage.setItem('sbAdminLogged', '1');
      localStorage.setItem('sbAdminUser', user);
    } catch { }
    document.getElementById('admin-user').value = '';
    document.getElementById('admin-password').value = '';
    setLoggedInUi(user);
  });

  btnLogout.addEventListener('click', () => {
    adminCreds = null;
    try {
      localStorage.removeItem('sbAdminLogged');
      localStorage.removeItem('sbAdminUser');
    } catch { }
    setLoggedOutUi();
  });

  try {
    const savedLogged = localStorage.getItem('sbAdminLogged') === '1';
    if (savedLogged) {
      const savedUser = localStorage.getItem('sbAdminUser') || 'admin';
      adminCreds = { user: savedUser, password: null };
      setLoggedInUi(savedUser);
    } else {
      setLoggedOutUi();
    }
  } catch {
    setLoggedOutUi();
  }
}

function initEvents() {
  const btnBrowse = document.getElementById('btn-browse');
  const btnAddElements = document.getElementById('btn-add-elements');

  if (btnBrowse) {
    btnBrowse.addEventListener('click', () => {
      currentBrowsePath = '';
      browseFs();
    });
  }

  if (btnAddElements) {
    btnAddElements.addEventListener('click', () => {
      const textarea = document.getElementById('job-sources');

      // 👇 NUOVO: prendo i percorsi dei checkbox selezionati
      selectedSources = Array.from(
        document.querySelectorAll('#fs-results input[type="checkbox"]:checked')
      )
        .map(cb => cb.dataset.fullPath)
        .filter(Boolean);

      const existing = textarea.value
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);

      const merged = Array.from(new Set([...existing, ...selectedSources]));

      textarea.value = merged.join('\n');

      // il resto può rimanere uguale
      selectedSources = [];
      currentBrowsePath = '';
      fsBrowserActive = false;

      const fsResults = document.getElementById('fs-results');
      if (fsResults) fsResults.innerHTML = '';

      const sourcesList = document.getElementById('sources-list');
      if (sourcesList) sourcesList.innerHTML = '';
    });
  }

  const btnAddDest = document.getElementById('btn-add-destination');
  if (btnAddDest) btnAddDest.addEventListener('click', () => addDestinationRow());

  document.getElementById('btn-reset-job').addEventListener('click', () => {
    resetJobForm();
  });
  document.getElementById('btn-validate-dest').addEventListener('click', validateDestinations);
  document.getElementById('btn-validate-sources').addEventListener('click', validateSources);
  document.getElementById('job-form').addEventListener('submit', saveJob);

  document.getElementById('schedule-type').addEventListener('change', ev => {
    const val = ev.target.value;
    if (val === 'weekly') {
      document.getElementById('weekly-options').classList.remove('hidden');
      document.getElementById('monthly-options').classList.add('hidden');
    } else if (val === 'monthly') {
      document.getElementById('weekly-options').classList.add('hidden');
      document.getElementById('monthly-options').classList.remove('hidden');
    } else {
      document.getElementById('weekly-options').classList.add('hidden');
      document.getElementById('monthly-options').classList.add('hidden');
    }
  });

  const searchInput = document.getElementById('agent-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      applyAgentFilterAndSummary();
    });
  }
}

window.addEventListener('load', () => {
  let savedAgent = null;
  try {
    savedAgent = localStorage.getItem('sbSelectedAgentId');
  } catch { }
  if (savedAgent) selectedAgentId = savedAgent;

  initLogin();
  initEvents();
  setDestinationsInForm([]);

  (async () => {
    await loadAgents();
    if (selectedAgentId) await loadAgentDetails();
  })();

  connectDashboardWs();
});
