const serverSettingsState = {
    statusTimeoutId: null,
    activeModal: null,
    lastFocusedElement: null,
    agentPackagePollId: null,
    agentPackageArtifactExists: false
};

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text ?? '';
    return div.innerHTML;
}

function escapeAttribute(text) {
    return escapeHtml(text).replace(/"/g, '&quot;');
}

function showMessage(type, message, { persist = false } = {}) {
    const statusDiv = document.getElementById('statusMessage');
    const messageClass = type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'error';
    statusDiv.innerHTML = `<div class="status-message ${messageClass}" role="${messageClass === 'error' ? 'alert' : 'status'}">${escapeHtml(message)}</div>`;

    if (serverSettingsState.statusTimeoutId) {
        clearTimeout(serverSettingsState.statusTimeoutId);
        serverSettingsState.statusTimeoutId = null;
    }

    if (!persist) {
        serverSettingsState.statusTimeoutId = setTimeout(() => {
            statusDiv.innerHTML = '';
            serverSettingsState.statusTimeoutId = null;
        }, 5000);
    }
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach((button) => {
        const selected = button.dataset.tab === tabName;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-selected', selected ? 'true' : 'false');
        button.tabIndex = selected ? 0 : -1;
    });

    document.querySelectorAll('.tab-content').forEach((content) => {
        content.classList.remove('active');
        content.hidden = true;
    });

    const targetTab = document.getElementById(`${tabName}Tab`);
    if (targetTab) {
        targetTab.classList.add('active');
        targetTab.hidden = false;
    }
}

function openDialog(modal) {
    serverSettingsState.lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    serverSettingsState.activeModal = modal;
    document.body.appendChild(modal);
    const focusTarget = modal.querySelector('button, input, select, textarea, [tabindex]:not([tabindex="-1"]), .modal-content');
    if (focusTarget) {
        focusTarget.focus();
    }
}

function closeDialog(modal, resolve, value) {
    if (modal.parentElement) {
        document.body.removeChild(modal);
    }
    if (serverSettingsState.activeModal === modal) {
        serverSettingsState.activeModal = null;
    }
    if (serverSettingsState.lastFocusedElement && document.contains(serverSettingsState.lastFocusedElement)) {
        serverSettingsState.lastFocusedElement.focus();
    }
    serverSettingsState.lastFocusedElement = null;
    resolve(value);
}

function showStrongConfirm({ title, message, expectedText, confirmLabel = 'Conferma' }) {
    return new Promise((resolve) => {
        const expected = String(expectedText || '');
        const html = `
            <div class="dialog-panel">
                <h3 id="strongSettingsDialogTitle">${escapeHtml(title || 'Conferma operazione')}</h3>
                <div class="dialog-message danger-message">
                    <p>${escapeHtml(message || '')}</p>
                </div>
                <div class="form-group">
                    <label for="strongSettingsConfirmInput">Digita <strong>${escapeHtml(expected)}</strong> per confermare</label>
                    <input type="text" id="strongSettingsConfirmInput" autocomplete="off">
                </div>
                <div class="modal-actions">
                    <button class="btn-cancel btn btn-outline btn-small">Annulla</button>
                    <button class="btn-confirm btn btn-danger btn-small" disabled>${escapeHtml(confirmLabel)}</button>
                </div>
            </div>
        `;

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `<div class="modal-backdrop"></div><div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="strongSettingsDialogTitle" tabindex="-1">${html}</div>`;
        openDialog(modal);

        const input = modal.querySelector('#strongSettingsConfirmInput');
        const confirm = modal.querySelector('.btn-confirm');
        const cancel = () => closeDialog(modal, resolve, false);

        input.addEventListener('input', () => {
            confirm.disabled = input.value !== expected;
        });
        modal.querySelector('.btn-cancel').onclick = cancel;
        modal.querySelector('.modal-backdrop').onclick = cancel;
        confirm.onclick = () => closeDialog(modal, resolve, true);
    });
}

async function deleteAllLogs() {
    const confirmed = await showStrongConfirm({
        title: 'Elimina tutti i log',
        message: 'Elimina tutti i record di backup eseguiti. I job e la configurazione rimangono intatti.',
        expectedText: 'ELIMINA LOG',
        confirmLabel: 'Elimina log'
    });
    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch('/api/runs/all', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        const data = await response.json();

        if (response.ok && data.success) {
            showMessage('success', `Eliminati ${data.deletedCount} log`);
        } else {
            showMessage('error', data.error || 'Errore eliminazione log');
        }
    } catch (error) {
        console.error('Errore eliminazione log:', error);
        showMessage('error', 'Errore di rete');
    }
}

async function deleteAlertHistory() {
    const confirmed = await showStrongConfirm({
        title: 'Cancella storico alert',
        message: 'Rimuove sia gli alert risolti sia quelli ancora attivi.',
        expectedText: 'CANCELLA ALERT',
        confirmLabel: 'Cancella alert'
    });
    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch('/api/alerts/history', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        const data = await response.json();

        if (response.ok && data.success) {
            showMessage('success', `Storico alert cancellato (${data.deletedCount})`);
        } else {
            showMessage('error', data.error || 'Errore cancellazione storico alert');
        }
    } catch (error) {
        console.error('Errore cancellazione storico alert:', error);
        showMessage('error', 'Errore di rete');
    }
}

async function loadLogRetention() {
    try {
        const response = await fetch('/api/logs/retention', {
            credentials: 'include'
        });

        if (!response.ok) {
            if (response.status === 401) {
                window.location.href = '/';
                return;
            }
            throw new Error('Errore caricamento retention log');
        }

        const data = await response.json();
        const retentionSelect = document.getElementById('logRetentionDays');
        if (!retentionSelect) {
            return;
        }

        const retentionValue = String(Number(data.retentionDays || 0));
        const optionExists = Array.from(retentionSelect.options).some((option) => option.value === retentionValue);
        retentionSelect.value = optionExists ? retentionValue : '0';
    } catch (error) {
        console.error('Errore caricamento retention log:', error);
        showMessage('error', 'Impossibile caricare la ritenzione log');
    }
}

async function saveLogRetention() {
    const retentionSelect = document.getElementById('logRetentionDays');
    if (!retentionSelect) {
        return;
    }

    try {
        const response = await fetch('/api/logs/retention', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ retentionDays: Number(retentionSelect.value) })
        });
        const data = await response.json();

        if (response.ok && data.success) {
            showMessage('success', 'Ritenzione log aggiornata');
        } else {
            showMessage('error', data.error || 'Errore aggiornamento ritenzione log');
        }
    } catch (error) {
        console.error('Errore aggiornamento ritenzione log:', error);
        showMessage('error', 'Errore di rete');
    }
}

function appendRestartInfo(messageHtml) {
    const statusDiv = document.getElementById('statusMessage');
    const info = document.createElement('div');
    info.className = 'status-message warning';
    info.innerHTML = messageHtml;
    statusDiv.appendChild(info);
    return info;
}

function startCountdown(infoElement, seconds) {
    let countdown = seconds;
    const countdownInterval = setInterval(() => {
        countdown -= 1;
        const countdownElement = infoElement.querySelector('em');
        if (countdownElement) {
            countdownElement.textContent = `Verifica disponibilita tra ${countdown} secondi...`;
        }

        if (countdown <= 0) {
            clearInterval(countdownInterval);
        }
    }, 1000);
}

async function checkServerAvailability() {
    let attempts = 0;
    const maxAttempts = 10;
    const checkInterval = 2000;

    const check = async () => {
        attempts += 1;

        try {
            const response = await fetch('/api/auth/status', {
                method: 'GET',
                cache: 'no-cache'
            });

            if (response.ok) {
                showMessage('success', 'Server online. Ricaricamento pagina...');
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
                return;
            }
        } catch (error) {
            console.log(`Tentativo ${attempts}/${maxAttempts} - Server non ancora disponibile`);
        }

        if (attempts < maxAttempts) {
            setTimeout(check, checkInterval);
        } else {
            showMessage('warning', 'Server non risponde. Ricarica manualmente la pagina.', { persist: true });
        }
    };

    await check();
}

function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) {
        return '0 B';
    }
    if (value < 1024 * 1024) {
        return `${(value / 1024).toFixed(1)} KB`;
    }
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function renderAgentPackageStatus(data) {
    const statusBox = document.getElementById('agentPackageStatus');
    const downloadButton = document.getElementById('agentPackageDownloadButton');
    if (!statusBox) {
        return;
    }

    const artifact = data?.artifact || data;
    serverSettingsState.agentPackageArtifactExists = Boolean(artifact?.exists);

    if (downloadButton) {
        downloadButton.disabled = !serverSettingsState.agentPackageArtifactExists;
    }

    if (!artifact?.exists) {
        statusBox.innerHTML = '<p>Nessun MSI agent generato.</p>';
        return;
    }

    statusBox.innerHTML = `
        <p>
            Pacchetto disponibile: <strong>${escapeHtml(artifact.filename || 'OnlyBackupAgent.msi')}</strong><br>
            Dimensione: ${escapeHtml(formatBytes(artifact.sizeBytes))}<br>
            Aggiornato: ${escapeHtml(artifact.updatedAt ? new Date(artifact.updatedAt).toLocaleString() : 'N/D')}
        </p>
    `;
}

function renderAgentPackageOptions(data) {
    const hostInput = document.getElementById('agentServerHost');
    const portInput = document.getElementById('agentServerPort');
    const hint = document.getElementById('agentServerHostHint');
    const datalist = document.getElementById('agentServerHostCandidates');

    if (hostInput && !hostInput.value && data.suggestedServerHost) {
        hostInput.value = data.suggestedServerHost;
    }

    if (portInput && data.serverPort) {
        portInput.value = data.serverPort;
    }

    if (datalist) {
        datalist.innerHTML = (data.candidates || []).map((candidate) => (
            `<option value="${escapeAttribute(candidate.host)}">${escapeHtml(candidate.source || '')}</option>`
        )).join('');
    }

    if (hint) {
        const candidates = data.candidates || [];
        hint.textContent = candidates.length > 0
            ? `Suggerito: ${data.suggestedServerHost}. Puoi sostituirlo se i client usano un altro IP.`
            : 'Nessun IP LAN rilevato automaticamente: inserisci l’indirizzo raggiungibile dai client.';
    }

    renderAgentPackageStatus(data);
}

async function loadAgentPackageOptions() {
    try {
        const response = await fetch('/api/agent/package/options', {
            method: 'GET',
            cache: 'no-cache',
            credentials: 'include'
        });
        const data = await response.json();

        if (!response.ok) {
            if (response.status === 401) {
                window.location.href = '/';
                return;
            }
            showMessage('error', data.error || 'Impossibile caricare opzioni agent');
            return;
        }

        renderAgentPackageOptions(data);
    } catch (error) {
        console.error('Errore opzioni agent:', error);
        showMessage('error', 'Errore caricamento opzioni agent');
    }
}

function setAgentPackageBuildLoading(loading) {
    const button = document.getElementById('agentPackageBuildButton');
    if (!button) {
        return;
    }
    button.disabled = loading;
    button.textContent = loading ? 'Generazione in corso...' : 'Genera Agent';
}

function renderAgentBuildStatus(data) {
    const statusBox = document.getElementById('agentPackageStatus');
    if (!statusBox) {
        return;
    }

    const logTail = Array.isArray(data.logTail) && data.logTail.length > 0
        ? `<br><small>${escapeHtml(data.logTail.slice(-3).join(' | '))}</small>`
        : '';

    if (data.status === 'running') {
        statusBox.innerHTML = `<p>Generazione MSI in corso per ${escapeHtml(data.serverHost)}:${escapeHtml(String(data.serverPort))}.${logTail}</p>`;
        return;
    }

    if (data.status === 'completed') {
        localStorage.setItem('onlybackup.agentPackageReady', 'true');
        renderAgentPackageStatus(data);
        showMessage('success', 'Pacchetto agent generato');
        return;
    }

    if (data.status === 'failed') {
        statusBox.innerHTML = `<p>Generazione MSI fallita: ${escapeHtml(data.error || 'errore sconosciuto')}.${logTail}</p>`;
        showMessage('error', data.error || 'Generazione agent fallita', { persist: true });
    }
}

async function pollAgentPackageBuild(buildId) {
    try {
        const response = await fetch(`/api/agent/package/build/${encodeURIComponent(buildId)}`, {
            cache: 'no-cache',
            credentials: 'include'
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Impossibile leggere stato build');
        }

        renderAgentBuildStatus(data);

        if (data.status !== 'running') {
            clearInterval(serverSettingsState.agentPackagePollId);
            serverSettingsState.agentPackagePollId = null;
            setAgentPackageBuildLoading(false);
            await loadAgentPackageOptions();
        }
    } catch (error) {
        console.error('Errore polling build agent:', error);
        clearInterval(serverSettingsState.agentPackagePollId);
        serverSettingsState.agentPackagePollId = null;
        setAgentPackageBuildLoading(false);
        showMessage('error', error.message || 'Errore stato build agent');
    }
}

async function buildAgentPackage() {
    const hostInput = document.getElementById('agentServerHost');
    const portInput = document.getElementById('agentServerPort');
    const serverHost = hostInput?.value.trim() || '';
    const serverPort = Number(portInput?.value || 8080);

    if (!serverHost) {
        showMessage('error', 'Inserisci l’indirizzo server per l’agent');
        return;
    }

    setAgentPackageBuildLoading(true);

    try {
        const response = await fetch('/api/agent/package/build', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ serverHost, serverPort })
        });
        const data = await response.json();

        if (!response.ok) {
            showMessage('error', data.error || 'Impossibile avviare generazione agent');
            setAgentPackageBuildLoading(false);
            return;
        }

        renderAgentBuildStatus(data);
        if (serverSettingsState.agentPackagePollId) {
            clearInterval(serverSettingsState.agentPackagePollId);
        }
        serverSettingsState.agentPackagePollId = setInterval(() => {
            pollAgentPackageBuild(data.buildId);
        }, 3000);
        showMessage('warning', 'Generazione agent avviata', { persist: true });
    } catch (error) {
        console.error('Errore generazione agent:', error);
        showMessage('error', 'Errore avvio generazione agent');
        setAgentPackageBuildLoading(false);
    }
}

function downloadAgentPackage() {
    if (!serverSettingsState.agentPackageArtifactExists) {
        showMessage('warning', 'Genera prima il pacchetto agent');
        return;
    }
    localStorage.setItem('onlybackup.agentPackageReady', 'true');
    window.location.href = '/api/agent/package/download';
}

function renderServerServiceStatus(data) {
    const statusBox = document.getElementById('serverServiceStatus');
    if (!statusBox) {
        return;
    }

    if (!data || !data.installed) {
        statusBox.innerHTML = '<p>Servizio Windows OnlyBackupServer non installato.</p>';
        return;
    }

    statusBox.innerHTML = `
        <p>
            <strong>${escapeHtml(data.displayName || data.name || 'OnlyBackupServer')}</strong><br>
            Stato: ${escapeHtml(data.status || 'N/D')}<br>
            Avvio: ${escapeHtml(data.startMode || 'N/D')}<br>
            PID: ${escapeHtml(String(data.pid || 'N/D'))}
        </p>
    `;
}

async function loadServerServiceStatus() {
    try {
        const response = await fetch('/api/server/service', {
            method: 'GET',
            cache: 'no-cache'
        });
        const data = await response.json();

        if (!response.ok) {
            showMessage('error', data.error || 'Impossibile leggere lo stato del servizio');
            return;
        }

        renderServerServiceStatus(data);
    } catch (error) {
        console.error('Errore stato servizio:', error);
        showMessage('error', 'Errore lettura stato servizio');
    }
}

async function controlServerService(action) {
    const labels = {
        start: 'avviare',
        stop: 'arrestare',
        restart: 'riavviare'
    };

    const confirmed = await showStrongConfirm({
        title: 'Controllo servizio Windows',
        message: `Confermi di voler ${labels[action] || 'modificare'} il servizio Windows OnlyBackupServer?`,
        expectedText: 'OnlyBackupServer',
        confirmLabel: labels[action] || 'Conferma'
    });
    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch(`/api/server/service/${action}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        const data = await response.json();

        if (response.ok) {
            showMessage('success', data.message || `Azione servizio avviata: ${action}`);
            if (action === 'restart' || action === 'stop') {
                setTimeout(() => {
                    checkServerAvailability();
                }, 8000);
            } else {
                await loadServerServiceStatus();
            }
        } else {
            showMessage('error', data.error || 'Errore controllo servizio');
        }
    } catch (error) {
        console.error('Errore controllo servizio:', error);
        showMessage('warning', 'Richiesta inviata; verifica lo stato tra qualche secondo.');
        setTimeout(() => {
            checkServerAvailability();
        }, 8000);
    }
}

async function rebootServer() {
    const confirmed = await showStrongConfirm({
        title: 'Riavvia server',
        message: 'Interrompe le richieste in corso e puo impattare backup attivi. Il server tentera il riavvio automatico.',
        expectedText: 'RIAVVIA SERVER',
        confirmLabel: 'Riavvia'
    });
    if (!confirmed) {
        return;
    }

    const button = window.event?.target;
    const originalText = button?.textContent || '';
    if (button) {
        button.disabled = true;
        button.textContent = 'Riavvio in corso...';
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch('/api/server/reboot', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        const data = await response.json();

        if (response.ok) {
            showMessage('success', data.message || 'Riavvio avviato');
            const info = appendRestartInfo(`
                <strong>Riavvio server in corso</strong><br>
                PID: ${escapeHtml(String(data.pid || 'N/A'))} | Platform: ${escapeHtml(String(data.platform || 'N/A'))}<br>
                Downtime stimato: ${escapeHtml(String(data.estimatedDowntime || '5-10 secondi'))}<br>
                <em>Verifica disponibilita tra 8 secondi...</em>
            `);
            startCountdown(info, 8);
            setTimeout(() => {
                checkServerAvailability();
            }, 8000);
        } else if (response.status === 403) {
            showMessage('error', 'Accesso negato. Solo gli amministratori possono riavviare il server.');
            if (button) {
                button.disabled = false;
                button.textContent = originalText;
            }
        } else {
            showMessage('error', data.error || 'Errore riavvio server');
            if (button) {
                button.disabled = false;
                button.textContent = originalText;
            }
        }
    } catch (error) {
        console.log('Richiesta riavvio inviata, server in spegnimento:', error.message);
        showMessage('warning', 'Server in riavvio...');
        const info = appendRestartInfo(`
            <strong>Riavvio server in corso</strong><br>
            Il server sta terminando il processo corrente...<br>
            <em>Verifica disponibilita tra 8 secondi...</em>
        `);
        startCountdown(info, 8);
        setTimeout(() => {
            checkServerAvailability();
        }, 8000);
    }
}

async function exportConfig() {
    const sections = await showExportDialog();
    if (!sections || sections.length === 0) {
        return;
    }

    try {
        const response = await fetch(`/api/config/export?sections=${sections.join(',')}`, {
            credentials: 'include'
        });
        const config = await response.json();

        if (!response.ok) {
            showMessage('error', config.error || 'Impossibile esportare la configurazione');
            return;
        }

        const dataStr = JSON.stringify(config, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        const now = new Date();
        const formattedDate = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;

        link.href = url;
        link.download = `OnlyBackup-${formattedDate}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        const details = [
            `${config.jobs?.length || 0} job`,
            `${config.users?.length || 0} utenti`,
            config.email ? 'impostazioni email' : null
        ].filter(Boolean).join(', ');
        showMessage('success', `Export completato: ${sections.join(', ')} (${details})`);
    } catch (error) {
        console.error('Errore export configurazione:', error);
        showMessage('error', 'Errore di connessione al server');
    }
}

function showExportDialog() {
    return new Promise((resolve) => {
        const html = `
            <div class="dialog-panel">
                <h3 id="exportDialogTitle">Seleziona cosa esportare</h3>
                <div class="dialog-check-list">
                    <label class="dialog-check"><input type="checkbox" value="jobs" checked> Job</label>
                    <label class="dialog-check"><input type="checkbox" value="users" checked> Utenti</label>
                    <label class="dialog-check"><input type="checkbox" value="clients" checked> Client</label>
                    <label class="dialog-check"><input type="checkbox" value="email" checked> Email</label>
                </div>
                <div class="modal-actions">
                    <button class="btn-cancel btn btn-outline btn-small">Annulla</button>
                    <button class="btn-confirm btn btn-primary btn-small">Esporta</button>
                </div>
            </div>
        `;

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `<div class="modal-backdrop"></div><div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="exportDialogTitle" tabindex="-1">${html}</div>`;
        openDialog(modal);

        const cancel = () => {
            closeDialog(modal, resolve, null);
        };

        modal.querySelector('.btn-cancel').onclick = cancel;
        modal.querySelector('.modal-backdrop').onclick = cancel;
        modal.querySelector('.btn-confirm').onclick = () => {
            const sections = Array.from(modal.querySelectorAll('input[type="checkbox"]:checked')).map((checkbox) => checkbox.value);
            closeDialog(modal, resolve, sections);
        };
    });
}

async function importConfig() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) {
            return;
        }

        try {
            const config = JSON.parse(await file.text());
            const availableSections = config.sections || ['jobs', 'users', 'clients', 'email'];
            const sections = await showImportDialog(config, availableSections);

            if (!sections || sections.length === 0) {
                return;
            }

            const response = await fetch('/api/config/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ config, sections })
            });
            const data = await response.json();

            if (response.ok && data.success) {
                const emailImported = data.imported.email ? ', impostazioni email' : '';
                showMessage('success', `Import completato: ${data.imported.jobs} job, ${data.imported.users} utenti${emailImported}`);
                setTimeout(() => {
                    window.location.reload();
                }, 2000);
            } else {
                showMessage('error', data.error || 'Impossibile importare la configurazione');
            }
        } catch (error) {
            console.error('Errore import configurazione:', error);
            showMessage('error', 'File non valido o errore di connessione');
        }
    };
    input.click();
}

function showImportDialog(config, availableSections) {
    return new Promise((resolve) => {
        const checkboxes = [];

        if (availableSections.includes('jobs')) {
            checkboxes.push(`<label class="dialog-check"><input type="checkbox" value="jobs" checked> Job (${config.jobs?.length || 0})</label>`);
        }
        if (availableSections.includes('users')) {
            checkboxes.push(`<label class="dialog-check"><input type="checkbox" value="users" checked> Utenti (${config.users?.length || 0})</label>`);
        }
        if (availableSections.includes('clients')) {
            checkboxes.push(`<label class="dialog-check"><input type="checkbox" value="clients" checked> Client (${config.clients?.length || 0})</label>`);
        }
        if (availableSections.includes('email')) {
            checkboxes.push(`<label class="dialog-check"><input type="checkbox" value="email" checked> Email (${config.email ? '1' : '0'})</label>`);
        }

        const html = `
            <div class="dialog-panel">
                <h3 id="importDialogTitle">Seleziona cosa importare</h3>
                <div class="dialog-check-list">
                    ${checkboxes.join('')}
                </div>
                <p class="dialog-note">
                    Gli elementi esistenti con lo stesso ID verranno sovrascritti
                </p>
                <div class="modal-actions">
                    <button class="btn-cancel btn btn-outline btn-small">Annulla</button>
                    <button class="btn-confirm btn btn-primary btn-small">Importa</button>
                </div>
            </div>
        `;

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `<div class="modal-backdrop"></div><div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="importDialogTitle" tabindex="-1">${html}</div>`;
        openDialog(modal);

        const cancel = () => {
            closeDialog(modal, resolve, null);
        };

        modal.querySelector('.btn-cancel').onclick = cancel;
        modal.querySelector('.modal-backdrop').onclick = cancel;
        modal.querySelector('.btn-confirm').onclick = () => {
            const sections = Array.from(modal.querySelectorAll('input[type="checkbox"]:checked')).map((checkbox) => checkbox.value);
            closeDialog(modal, resolve, sections);
        };
    });
}

window.deleteAllLogs = deleteAllLogs;
window.deleteAlertHistory = deleteAlertHistory;
window.saveLogRetention = saveLogRetention;
window.loadAgentPackageOptions = loadAgentPackageOptions;
window.buildAgentPackage = buildAgentPackage;
window.downloadAgentPackage = downloadAgentPackage;
window.loadServerServiceStatus = loadServerServiceStatus;
window.controlServerService = controlServerService;
window.rebootServer = rebootServer;
window.exportConfig = exportConfig;
window.importConfig = importConfig;

document.addEventListener('DOMContentLoaded', async () => {
    document.querySelectorAll('.tab-btn').forEach((button) => {
        button.addEventListener('click', () => {
            switchTab(button.dataset.tab);
        });
        button.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') {
                return;
            }
            event.preventDefault();
            switchTab(button.dataset.tab);
        });
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && serverSettingsState.activeModal) {
            const cancelButton = serverSettingsState.activeModal.querySelector('.btn-cancel');
            if (cancelButton) {
                cancelButton.click();
            }
        }
    });

    await loadLogRetention();
    await loadAgentPackageOptions();
    await loadServerServiceStatus();
});
