OnlyBackupApp.prototype.loadClients = async function() {
    this.setPanelState('clientsState', 'loading');
    try {
        const response = await fetch('/api/clients');
        if (response.status === 304) {
            this.setPanelState('clientsState', this.clients.length === 0 ? 'empty' : 'ready');
            return true;
        }
        if (response.ok) {
            const loadedClients = await response.json();
            let selectedStatusChanged = false;

            loadedClients.forEach((client) => {
                const combinedStatus = client.backup_status || client.lastBackupRun?.status || null;
                const statusKey = `${combinedStatus || 'none'}|${client.backup_job_id || 'no-job'}`;

                if (client.hostname === this.selectedClient) {
                    const previousStatus = this.clientStatusCache[client.hostname];
                    if (previousStatus && previousStatus !== statusKey) {
                        selectedStatusChanged = true;
                    }
                }

                this.clientStatusCache[client.hostname] = statusKey;
            });

            this.clients = loadedClients;
            this.renderClientsList();

            if (this.clients.length === 0) {
                this.setPanelState('clientsState', 'empty');
            } else {
                this.setPanelState('clientsState', 'ready');
            }

            if (!this.selectedClient && this.clients.length > 0) {
                this.selectClient(this.clients[0].hostname);
                return true;
            }

            if (this.selectedClient) {
                this.updateClientHeader();
                if (selectedStatusChanged || !this.selectedClientRunsLoaded) {
                    await this.loadClientRuns();
                    this.selectedClientRunsLoaded = true;
                }
                this.updateClientSummary();
            }

            return true;
        }

        if (response.status === 401) {
            this.logout();
        } else {
            this.setPanelState('clientsState', 'error');
        }
    } catch (error) {
        console.error('Errore caricamento clients:', error);
        this.showToast('error', 'Errore', 'Impossibile caricare la lista client');
        this.setPanelState('clientsState', 'error');
    }
    return false;
};

OnlyBackupApp.prototype.renderClientsList = function() {
    const container = document.getElementById('clientsList');
    this.renderOnboardingChecklist();
    this.updateDashboardFilterButtons();

    if (this.clients.length === 0) {
        container.innerHTML = '<div class="info-message">Nessun client registrato</div>';
        return;
    }

    const sortedClients = [...this.clients].sort((a, b) => {
        if (a.online !== b.online) return b.online ? 1 : -1;
        return a.hostname.localeCompare(b.hostname);
    });

    const visibleClients = sortedClients.filter((client) => this.clientMatchesDashboardFilter(client));

    if (visibleClients.length === 0) {
        container.innerHTML = '<div class="info-message">Nessun client corrisponde ai filtri attivi</div>';
        return;
    }

    container.innerHTML = visibleClients.map((client) => {
        let backupIcon = '';

        if (client.backup_status === 'in_progress') {
            backupIcon = '<span class="backup-status-icon running" title="Backup in corso" role="img" aria-label="Backup in corso">&#9679;</span>';
        } else if (client.backup_status === 'partial') {
            backupIcon = '<span class="backup-status-icon partial" title="Backup parziale" role="img" aria-label="Backup parziale">&#9679;</span>';
        } else if (client.backup_status === 'completed') {
            backupIcon = '<span class="backup-status-icon success" title="Backup completato" role="img" aria-label="Backup completato">&#10003;</span>';
        } else if (client.backup_status === 'failed') {
            backupIcon = '<span class="backup-status-icon failure" title="Backup fallito" role="img" aria-label="Backup fallito">&#10007;</span>';
        } else if (client.lastBackupRun) {
            if (client.lastBackupRun.status === 'success') {
                backupIcon = '<span class="backup-status-icon success" title="Ultimo backup riuscito" role="img" aria-label="Ultimo backup riuscito">&#10003;</span>';
            } else if (client.lastBackupRun.status === 'failure') {
                backupIcon = '<span class="backup-status-icon failure" title="Ultimo backup fallito" role="img" aria-label="Ultimo backup fallito">&#10007;</span>';
            } else if (client.lastBackupRun.status === 'partial') {
                backupIcon = '<span class="backup-status-icon partial" title="Ultimo backup parziale" role="img" aria-label="Ultimo backup parziale">&#9679;</span>';
            }
        }

        const showResetBackup = client.backup_status === 'in_progress';
        const statusDotClass = client.online ? 'online' : 'offline';
        const lastSeen = client.lastSeen ? new Date(client.lastSeen).toLocaleString() : 'Mai';
        const ipInfo = client.agent_ip ? `${client.agent_ip}:${client.agent_port || 8081}` : 'IP non disponibile';
        const lastRunStatus = this.normalizeRunStatus(client.lastBackupRun?.status || client.backup_status || '');
        const healthActions = [];

        if (!client.online || lastRunStatus === 'failure' || lastRunStatus === 'failed' || lastRunStatus === 'partial') {
            healthActions.push(`<a class="client-health-link" href="/alerts.html" onclick="event.stopPropagation()">Alert</a>`);
        }
        if (client.lastBackupRun || client.backup_status === 'in_progress') {
            healthActions.push(`<button type="button" class="client-health-link" onclick="event.stopPropagation(); app.openClientRuns('${this.escapeForAttribute(client.hostname)}')">Storico</button>`);
        }

        return `
            <div class="client-item ${this.selectedClient === client.hostname ? 'active' : ''}"
                 role="button"
                 tabindex="0"
                 aria-pressed="${this.selectedClient === client.hostname ? 'true' : 'false'}"
                 aria-label="Seleziona client ${this.escapeForAttribute(client.hostname)}"
                 onclick="app.selectClient('${this.escapeForAttribute(client.hostname)}')"
                 onkeydown="app.handleKeyboardAction(event, () => app.selectClient('${this.escapeForAttribute(client.hostname)}'))">
                <div class="client-meta-wrapper">
                    <div class="client-name-row">
                        <span class="status-dot ${statusDotClass}" aria-hidden="true"></span>
                        <div class="client-name">${backupIcon}${this.escapeHtml(client.hostname)}</div>
                    </div>
                    <div class="client-meta">
                        <span class="client-ip" title="Indirizzo agent">${this.escapeHtml(ipInfo)}</span>
                        <span class="client-lastseen" title="Ultimo contatto">Ultimo contatto: ${this.escapeHtml(lastSeen)}</span>
                    </div>
                    ${healthActions.length ? `<div class="client-health-actions">${healthActions.join('')}</div>` : ''}
                </div>
                <div class="client-item-actions">
                    ${showResetBackup ? `
                        <button class="btn btn-icon btn-small" style="background: #f39c12; color: white; border-color: #f39c12;"
                                onclick="event.stopPropagation(); app.resetBackupStatus('${this.escapeForAttribute(client.hostname)}')"
                                title="Resetta stato backup (non ferma il backup reale)"
                                aria-label="Resetta stato backup di ${this.escapeForAttribute(client.hostname)}">Reset</button>
                    ` : ''}
                    <button class="btn btn-icon btn-danger btn-small"
                            onclick="event.stopPropagation(); app.showDeregisterDialog('${this.escapeForAttribute(client.hostname)}')"
                            title="Deregistra PC"
                            aria-label="Deregistra PC ${this.escapeForAttribute(client.hostname)}">&times;</button>
                </div>
            </div>
        `;
    }).join('');
};

OnlyBackupApp.prototype.clientMatchesDashboardFilter = function(client) {
    const term = (this.clientSearchTerm || '').toLowerCase().trim();
    const hostname = (client.hostname || '').toLowerCase();
    if (term && !hostname.includes(term)) {
        return false;
    }

    const status = this.normalizeRunStatus(client.lastBackupRun?.status || client.backup_status || '');
    const hasJobs = Array.isArray(client.jobs) && client.jobs.length > 0;

    if (this.dashboardFilter === 'critical') {
        return !client.online || ['failure', 'failed', 'partial'].includes(status);
    }
    if (this.dashboardFilter === 'offline') {
        return !client.online;
    }
    if (this.dashboardFilter === 'failed') {
        return ['failure', 'failed', 'partial'].includes(status);
    }
    if (this.dashboardFilter === 'running') {
        return client.backup_status === 'in_progress' || status === 'running';
    }
    if (this.dashboardFilter === 'no-jobs') {
        return !hasJobs;
    }

    return true;
};

OnlyBackupApp.prototype.setDashboardFilter = function(filterName) {
    this.dashboardFilter = filterName || 'all';
    this.renderClientsList();
};

OnlyBackupApp.prototype.updateDashboardFilterButtons = function() {
    document.querySelectorAll('.dashboard-filter-bar .filter-chip').forEach((button) => {
        const selected = button.dataset.filter === this.dashboardFilter;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
};

OnlyBackupApp.prototype.openClientRuns = async function(hostname) {
    await this.selectClient(hostname);
    this.showTab('runs');
};

OnlyBackupApp.prototype.renderOnboardingChecklist = function() {
    const container = document.getElementById('onboardingChecklist');
    if (!container) return;

    const hasClient = this.clients.length > 0;
    const hasJob = this.clients.some((client) => Array.isArray(client.jobs) && client.jobs.length > 0) || this.jobs.length > 0;
    const emailTested = localStorage.getItem('onlybackup.emailTested') === 'true';
    const agentPackageReady = localStorage.getItem('onlybackup.agentPackageReady') === 'true';
    const items = [
        { label: 'Password admin cambiata', done: !this.mustChangePassword },
        { label: 'Primo agent registrato', done: hasClient },
        { label: 'Primo job creato', done: hasJob },
        { label: 'Email testata', done: emailTested },
        { label: 'Package agent generato/scaricato', done: agentPackageReady }
    ];
    const pending = items.filter((item) => !item.done).length;

    container.innerHTML = `
        <div class="onboarding-title">Primo avvio admin</div>
        <div class="onboarding-items">
            ${items.map((item) => `
                <span class="onboarding-item ${item.done ? 'done' : 'todo'}">
                    <span aria-hidden="true">${item.done ? '\u2713' : '\u25CB'}</span>
                    ${this.escapeHtml(item.label)}
                </span>
            `).join('')}
        </div>
        <div class="onboarding-summary">${pending === 0 ? 'Checklist completata' : `${pending} passaggi aperti`}</div>
    `;
};

OnlyBackupApp.prototype.updateClientHeader = function() {
    const client = this.clients.find((entry) => entry.hostname === this.selectedClient);
    if (!client) return;

    document.getElementById('selectedClientName').textContent = client.hostname;
    const statusEl = document.getElementById('clientHeaderStatus');
    statusEl.textContent = client.online ? 'Online' : 'Offline';
    statusEl.className = `client-header-status ${client.online ? 'online' : 'offline'}`;
};

OnlyBackupApp.prototype.selectClient = async function(hostname) {
    this.selectedClient = hostname;
    this.editingJob = null;
    this.isNewJob = false;
    this.selectedClientRunsLoaded = false;
    this.renderClientsList();
    this.updateClientHeader();

    await Promise.all([this.loadClientJobs(), this.loadClientRuns()]);
    this.updateClientSummary();
    this.showTab('jobs');
    this.renderJobEditor();
};

OnlyBackupApp.prototype.showDeregisterDialog = async function(hostname) {
    const confirmed = await this.showStrongConfirm({
        title: 'Deregistra client',
        message: `Rimuove heartbeat, job, run e log associati al client ${hostname}.`,
        expectedText: hostname,
        confirmLabel: 'Deregistra'
    });
    if (confirmed) {
        await this.deleteClientByHostname(hostname);
    }
};

OnlyBackupApp.prototype.closeDeregisterDialog = function() {
    this.pendingDeregisterHostname = null;
    this.closeModal('deregisterDialog');
};

OnlyBackupApp.prototype.confirmDeregisterClient = async function() {
    const hostname = this.pendingDeregisterHostname;
    if (!hostname) return;

    this.closeDeregisterDialog();
    await this.deleteClientByHostname(hostname);
};

OnlyBackupApp.prototype.deregisterClient = async function() {
    if (!this.selectedClient) return;

    const hostname = this.selectedClient;
    const confirmed = await this.showStrongConfirm({
        title: 'Deregistra client',
        message: `Rimuove heartbeat, job, run e log associati al client ${hostname}.`,
        expectedText: hostname,
        confirmLabel: 'Deregistra'
    });
    if (!confirmed) {
        return;
    }

    await this.deleteClientByHostname(hostname);
};

OnlyBackupApp.prototype.deleteClientByHostname = async function(hostname) {
    const wasSelected = this.selectedClient === hostname;

    try {
        const response = await fetch(`/api/clients/${encodeURIComponent(hostname)}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (response.ok && data.success) {
            this.showToast('success', 'Client deregistrato', `${hostname} e stato deregistrato`);
            if (wasSelected) {
                this.selectedClient = null;
                this.jobs = [];
                this.runs = [];
                this.editingJob = null;
            }
            await this.loadClients();
            await this.loadHeaderStats();
            if (wasSelected && this.clients.length > 0) {
                this.selectClient(this.clients[0].hostname);
            } else if (wasSelected) {
                document.getElementById('selectedClientName').textContent = 'Seleziona un client';
                document.getElementById('clientHeaderStatus').textContent = '';
                document.getElementById('clientHeaderStatus').className = 'client-header-status';
                this.renderJobsList();
                this.renderRunsList();
            }
        } else {
            this.showToast('error', 'Errore', data.error || 'Impossibile deregistrare il client');
        }
    } catch (error) {
        console.error('Errore deregistrazione client:', error);
        this.showToast('error', 'Errore', 'Errore di connessione al server');
    }
};

OnlyBackupApp.prototype.clearClientLogs = async function() {
    if (!this.selectedClient) return;

    await this.confirmClearClientLogs();
};

OnlyBackupApp.prototype.closeClearLogsDialog = function() {
    this.closeModal('clearLogsDialog');
};

OnlyBackupApp.prototype.confirmClearClientLogs = async function() {
    if (!this.selectedClient) return;
    const hostname = this.selectedClient;

    this.closeClearLogsDialog();
    const confirmed = await this.showStrongConfirm({
        title: 'Elimina log client',
        message: `Elimina lo storico backup di ${hostname}. I job rimangono configurati.`,
        expectedText: hostname,
        confirmLabel: 'Elimina log'
    });
    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch(`/api/clients/${encodeURIComponent(hostname)}/runs`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (response.ok && data.success) {
            this.showToast('success', 'Log eliminati', `Storico backup di ${hostname} eliminato (${data.runsDeleted} esecuzioni)`);
            this.runs = [];
            this.renderRunsList();
            this.updateClientSummary();
            await this.loadHeaderStats();
        } else {
            this.showToast('error', 'Errore', data.error || 'Impossibile eliminare lo storico');
        }
    } catch (error) {
        console.error('Errore eliminazione log:', error);
        this.showToast('error', 'Errore', 'Errore di connessione al server');
    }
};

OnlyBackupApp.prototype.loadClientJobs = async function() {
    if (!this.selectedClient) return;

    try {
        const response = await fetch(`/api/clients/${encodeURIComponent(this.selectedClient)}/jobs`);
        if (response.ok) {
            this.jobs = await response.json();
            this.renderJobsList();
            this.renderOnboardingChecklist();
            this.updateFooterStatus({ message: 'Job caricati' });

            if (!this.editingJob && this.jobs.length > 0) {
                this.editJob(this.jobs[0].job_id);
            } else if (this.jobs.length === 0) {
                this.editingJob = null;
                this.renderJobEditor();
            }
        }
    } catch (error) {
        console.error('Errore caricamento jobs:', error);
        this.updateFooterStatus({ message: 'Errore caricamento job' });
    }
};

OnlyBackupApp.prototype.showTab = function(tabName) {
    this.setTabState(tabName);

    if (tabName === 'runs' && this.runs.length === 0) {
        this.loadClientRuns();
    }
};

OnlyBackupApp.prototype.updateClientSummary = function() {
    if (!this.selectedClient) return;

    const activeJobs = this.jobs.filter((job) => job.enabled).length;
    const totalRuns = this.runs.length;

    document.getElementById('summaryActiveJobs').textContent = `${activeJobs}/${this.jobs.length}`;

    const lastRun = this.runs.length > 0 ? this.runs[0] : null;
    const summaryLastBackup = document.getElementById('summaryLastBackup');

    if (lastRun) {
        const lastRunDate = new Date(lastRun.start);
        const now = new Date();
        const diffHours = Math.floor((now - lastRunDate) / (1000 * 60 * 60));
        const status = lastRun.status === 'success' ? '\u2713' : '\u2717';

        summaryLastBackup.textContent = diffHours < 24
            ? `${status} ${diffHours}h fa`
            : `${status} ${lastRunDate.toLocaleDateString('it-IT')}`;
        summaryLastBackup.className = `summary-value ${lastRun.status === 'success' ? 'success' : 'failure'}`;
    } else {
        summaryLastBackup.textContent = 'Mai';
        summaryLastBackup.className = 'summary-value';
    }

    document.getElementById('summaryTotalRuns').textContent = totalRuns;
};

OnlyBackupApp.prototype.openBrowseModal = function(mappingIndex) {
    const client = this.clients.find((entry) => entry.hostname === this.selectedClient);
    if (!client?.online) {
        this.showToast('warning', 'Client offline', 'Impossibile sfogliare il filesystem di un client offline');
        return;
    }

    this.browseMappingIndex = mappingIndex;
    this.currentFsPath = '';
    this.selectedFsEntry = null;
    this.selectedFsType = null;
    this.loadFilesystemEntries('');
    this.openModal('filesystemModal');
};

OnlyBackupApp.prototype.closeFilesystemModal = function() {
    this.closeModal('filesystemModal');
    this.browseMappingIndex = null;
};

OnlyBackupApp.prototype.loadFilesystemEntries = async function(path = '') {
    if (!this.selectedClient) return;

    const fsEntries = document.getElementById('fsEntries');
    fsEntries.innerHTML = '<div class="loading">Caricamento...</div>';

    try {
        const response = await fetch(
            `/api/clients/${encodeURIComponent(this.selectedClient)}/fs?path=${encodeURIComponent(path)}`
        );

        if (!response.ok) {
            const data = await response.json();
            fsEntries.innerHTML = `<div class="info-message">Errore: ${this.escapeHtml(data.error || 'Impossibile caricare')}</div>`;
            return;
        }

        const data = await response.json();
        this.currentFsPath = data.path || '';
        document.getElementById('fsCurrentPath').textContent = data.path || '/';

        const btnUp = document.getElementById('fsBtnUp');
        if (btnUp) {
            btnUp.style.display = this.currentFsPath ? 'inline-flex' : 'none';
        }

        const entries = data.entries || [];

        if (entries.length === 0) {
            fsEntries.innerHTML = '<div class="info-message">Cartella vuota</div>';
            return;
        }

        entries.sort((a, b) => {
            if (a.type === 'file' && b.type !== 'file') return 1;
            if (a.type !== 'file' && b.type === 'file') return -1;
            return a.name.localeCompare(b.name);
        });

        fsEntries.innerHTML = entries.map((entry) => {
            const icon = entry.type === 'drive'
                ? '\uD83D\uDCBD'
                : entry.type === 'file'
                    ? '\uD83D\uDCC4'
                    : '\uD83D\uDCC1';
            const isSelected = this.selectedFsEntry === entry.path;

            return `
                <div class="filesystem-entry ${isSelected ? 'selected' : ''}"
                     role="button"
                     tabindex="0"
                     aria-pressed="${isSelected ? 'true' : 'false'}"
                     aria-label="${entry.type === 'file' ? 'Seleziona file' : 'Seleziona cartella'} ${this.escapeForAttribute(entry.name)}"
                     onclick="app.handleFsEntryClick(event, '${this.escapeForAttribute(entry.path)}', '${entry.type}')"
                     onkeydown="app.handleKeyboardAction(event, () => app.handleFsEntryClick(event, '${this.escapeForAttribute(entry.path)}', '${entry.type}'))">
                    <div class="fs-entry-name">${icon} ${this.escapeHtml(entry.name)}</div>
                    <div class="fs-entry-actions">
                        ${entry.type !== 'file' ? `
                            <button class="btn btn-outline btn-small"
                                    onclick="event.stopPropagation(); app.navigateFilesystem('${this.escapeForAttribute(entry.path)}')">
                                Apri
                            </button>
                        ` : ''}
                        <button class="btn btn-primary btn-small"
                                onclick="event.stopPropagation(); app.selectFilesystemPath('${this.escapeForAttribute(entry.path)}')">
                            Seleziona
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Errore caricamento filesystem:', error);
        fsEntries.innerHTML = '<div class="info-message">Errore di connessione</div>';
    }
};

OnlyBackupApp.prototype.handleFsEntryClick = function(event, path, type) {
    this.selectedFsEntry = path;
    this.selectedFsType = type;

    document.querySelectorAll('#fsEntries .filesystem-entry').forEach((element) => {
        element.classList.remove('selected');
        element.setAttribute('aria-pressed', 'false');
    });
    event.currentTarget.classList.add('selected');
    event.currentTarget.setAttribute('aria-pressed', 'true');

    const selectBtn = document.getElementById('fsSelectBtn');
    selectBtn.textContent = type === 'file' ? 'Seleziona file' : 'Seleziona cartella';
};

OnlyBackupApp.prototype.navigateFilesystem = function(path) {
    this.selectedFsEntry = null;
    this.selectedFsType = null;
    this.loadFilesystemEntries(path);
};

OnlyBackupApp.prototype.navigateFilesystemUp = function() {
    if (!this.currentFsPath) return;

    const rawPath = this.currentFsPath;
    const normalized = rawPath.replace(/\\/g, '/');
    const useBackslash = rawPath.includes('\\');
    const hasLeadingSlash = normalized.startsWith('/');

    const parts = normalized.split('/').filter(Boolean);
    if (parts.length === 0) {
        this.navigateFilesystem('');
        return;
    }

    parts.pop();

    let parentPath = parts.join('/');
    if (hasLeadingSlash && parentPath) {
        parentPath = `/${parentPath}`;
    }

    if (useBackslash) {
        parentPath = parentPath.replace(/\//g, '\\');
        if (/^[A-Za-z]:$/.test(parentPath)) {
            parentPath += '\\';
        }
    }

    this.navigateFilesystem(parentPath);
};

OnlyBackupApp.prototype.selectFilesystemPath = function(path) {
    if (this.browseMappingIndex === null || !this.editingJob) return;
    this.editingJob.mappings[this.browseMappingIndex].source_path = path;
    this.renderJobEditor();
    this.closeFilesystemModal();
};

OnlyBackupApp.prototype.selectCurrentPath = function() {
    const path = this.selectedFsEntry || this.currentFsPath;
    if (!path) {
        this.showToast('warning', 'Attenzione', 'Seleziona un elemento o naviga in una cartella');
        return;
    }
    this.selectFilesystemPath(path);
};

OnlyBackupApp.prototype.escapeForAttribute = function(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
};

OnlyBackupApp.prototype.resetBackupStatus = async function(hostname) {
    const confirmed = await this.showStrongConfirm({
        title: 'Reset stato backup',
        message: `Pulisce solo lo stato UI di ${hostname}; non ferma eventuali processi sull'agent.`,
        expectedText: hostname,
        confirmLabel: 'Reset stato'
    });
    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch(`/api/clients/${encodeURIComponent(hostname)}/reset-backup-status`, {
            method: 'POST'
        });

        const data = await response.json();

        if (response.ok && data.success) {
            this.showToast('success', 'Stato resettato', `Stato backup di ${hostname} resettato`);
            await this.loadClients();
        } else {
            this.showToast('error', 'Errore', data.error || 'Impossibile resettare lo stato');
        }
    } catch (error) {
        console.error('Errore reset stato backup:', error);
        this.showToast('error', 'Errore', 'Errore di connessione al server');
    }
};

OnlyBackupApp.prototype.resetPassword = async function() {
    const values = await this.showInputDialog({
        title: 'Cambia password',
        confirmLabel: 'Aggiorna password',
        fields: [
            { name: 'newPassword', label: 'Nuova password', type: 'password', autocomplete: 'new-password', minLength: 8 },
            { name: 'confirmPassword', label: 'Conferma password', type: 'password', autocomplete: 'new-password', minLength: 8 }
        ]
    });
    if (!values) return;

    const newPassword = values.newPassword;
    const confirmPassword = values.confirmPassword;

    if (newPassword.length < 8) {
        this.showToast('error', 'Errore', 'La password deve essere di almeno 8 caratteri');
        return;
    }

    if (confirmPassword !== newPassword) {
        this.showToast('error', 'Errore', 'Le password non coincidono');
        return;
    }

    try {
        const response = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newPassword })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            this.showToast('success', 'Password aggiornata', 'La password e stata modificata con successo');
        } else {
            this.showToast('error', 'Errore', data.error || 'Impossibile resettare la password');
        }
    } catch (error) {
        console.error('Errore reset password:', error);
        this.showToast('error', 'Errore', 'Errore di connessione al server');
    }
};

OnlyBackupApp.prototype.exportConfig = async function() {
    const sections = await this.showExportDialog();
    if (!sections || sections.length === 0) return;

    try {
        const sectionsParam = sections.join(',');
        const response = await fetch(`/api/config/export?sections=${sectionsParam}`);
        const config = await response.json();

        if (response.ok) {
            const dataStr = JSON.stringify(config, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(dataBlob);
            const link = document.createElement('a');
            link.href = url;
            const now = new Date();
            const formattedDate = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
            link.download = `OnlyBackup-${formattedDate}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            const jobsCount = config.jobs?.length || 0;
            const usersCount = config.users?.length || 0;
            const hasEmail = Boolean(config.email);
            const details = [
                `${jobsCount} job`,
                `${usersCount} utenti`,
                hasEmail ? 'impostazioni email' : null
            ].filter(Boolean).join(', ');
            this.showToast('success', 'Export completato', `Esportate sezioni: ${sections.join(', ')} (${details})`);
        } else {
            this.showToast('error', 'Errore', config.error || 'Impossibile esportare la configurazione');
        }
    } catch (error) {
        console.error('Errore export configurazione:', error);
        this.showToast('error', 'Errore', 'Errore di connessione al server');
    }
};

OnlyBackupApp.prototype.showExportDialog = function() {
    return new Promise((resolve) => {
        const html = `
            <div style="padding: 20px;">
                <h3 style="margin: 0 0 20px 0;">Seleziona cosa esportare</h3>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    <label style="display: flex; align-items: center; gap: 10px;">
                        <input type="checkbox" value="jobs" checked> Job
                    </label>
                    <label style="display: flex; align-items: center; gap: 10px;">
                        <input type="checkbox" value="users" checked> Utenti
                    </label>
                    <label style="display: flex; align-items: center; gap: 10px;">
                        <input type="checkbox" value="clients" checked> Client
                    </label>
                    <label style="display: flex; align-items: center; gap: 10px;">
                        <input type="checkbox" value="email" checked> Email
                    </label>
                </div>
                <div style="margin-top: 24px; display: flex; gap: 12px; justify-content: flex-end;">
                    <button class="btn-cancel btn btn-outline btn-small">Annulla</button>
                    <button class="btn-confirm btn btn-primary btn-small">Esporta</button>
                </div>
            </div>
        `;

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex';
        modal.innerHTML = `<div class="modal-backdrop"></div><div class="modal-content">${html}</div>`;
        document.body.appendChild(modal);

        const cancel = () => {
            document.body.removeChild(modal);
            resolve(null);
        };

        modal.querySelector('.btn-cancel').onclick = cancel;
        modal.querySelector('.modal-backdrop').onclick = cancel;

        modal.querySelector('.btn-confirm').onclick = () => {
            const checkboxes = modal.querySelectorAll('input[type="checkbox"]:checked');
            const sections = Array.from(checkboxes).map((checkbox) => checkbox.value);
            document.body.removeChild(modal);
            resolve(sections);
        };
    });
};

OnlyBackupApp.prototype.importConfig = async function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const config = JSON.parse(text);
            const availableSections = config.sections || ['jobs', 'users', 'clients', 'email'];
            const sections = await this.showImportDialog(config, availableSections);

            if (!sections || sections.length === 0) return;

            const response = await fetch('/api/config/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config, sections })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                const emailImported = data.imported.email ? ', impostazioni email' : '';
                this.showToast('success', 'Import completato', `Importati: ${data.imported.jobs} job, ${data.imported.users} utenti${emailImported}`);
                await this.loadClients();
                if (this.selectedClient) {
                    await this.loadClientJobs();
                }
            } else {
                this.showToast('error', 'Errore', data.error || 'Impossibile importare la configurazione');
            }
        } catch (error) {
            console.error('Errore import configurazione:', error);
            this.showToast('error', 'Errore', 'File non valido o errore di connessione');
        }
    };
    input.click();
};

OnlyBackupApp.prototype.showImportDialog = function(config, availableSections) {
    return new Promise((resolve) => {
        const jobsCount = config.jobs?.length || 0;
        const usersCount = config.users?.length || 0;
        const clientsCount = config.clients?.length || 0;
        const hasEmail = Boolean(config.email);

        const checkboxes = [];
        if (availableSections.includes('jobs')) {
            checkboxes.push(`<label><input type="checkbox" value="jobs" checked> Job (${jobsCount})</label>`);
        }
        if (availableSections.includes('users')) {
            checkboxes.push(`<label><input type="checkbox" value="users" checked> Utenti (${usersCount})</label>`);
        }
        if (availableSections.includes('clients')) {
            checkboxes.push(`<label><input type="checkbox" value="clients" checked> Client (${clientsCount})</label>`);
        }
        if (availableSections.includes('email')) {
            checkboxes.push(`<label><input type="checkbox" value="email" checked> Email (${hasEmail ? '1' : '0'})</label>`);
        }

        const html = `
            <div style="padding: 20px;">
                <h3 style="margin: 0 0 20px 0;">Seleziona cosa importare</h3>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    ${checkboxes.join('')}
                </div>
                <p style="margin-top: 16px; color: var(--text-muted); font-size: 0.875rem;">
                    Attenzione: gli elementi esistenti con lo stesso ID verranno sovrascritti.
                </p>
                <div style="margin-top: 24px; display: flex; gap: 12px; justify-content: flex-end;">
                    <button class="btn-cancel btn btn-outline btn-small">Annulla</button>
                    <button class="btn-confirm btn btn-primary btn-small">Importa</button>
                </div>
            </div>
        `;

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex';
        modal.innerHTML = `<div class="modal-backdrop"></div><div class="modal-content">${html}</div>`;
        document.body.appendChild(modal);

        const cancel = () => {
            document.body.removeChild(modal);
            resolve(null);
        };

        modal.querySelector('.btn-cancel').onclick = cancel;
        modal.querySelector('.modal-backdrop').onclick = cancel;

        modal.querySelector('.btn-confirm').onclick = () => {
            const checkboxes = modal.querySelectorAll('input[type="checkbox"]:checked');
            const sections = Array.from(checkboxes).map((checkbox) => checkbox.value);
            document.body.removeChild(modal);
            resolve(sections);
        };
    });
};

OnlyBackupApp.prototype.filterClients = function(searchTerm) {
    this.clientSearchTerm = searchTerm || '';
    this.renderClientsList();
};

OnlyBackupApp.prototype.refreshClients = async function() {
    await Promise.all([this.loadClients(), this.loadHeaderStats()]);
    if (this.selectedClient) {
        await this.loadClientJobs();
        await this.loadClientRuns();
        this.updateClientSummary();
    }
    this.showToast('info', 'Aggiornato', 'Dati aggiornati');
};

OnlyBackupApp.prototype.deleteAllLogs = async function() {
    const confirmed = await this.showStrongConfirm({
        title: 'Elimina tutti i log',
        message: 'Elimina tutti i record di backup di tutti i client. Job e configurazioni restano invariati.',
        expectedText: 'ELIMINA LOG',
        confirmLabel: 'Elimina tutti'
    });
    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch('/api/runs/all', {
            method: 'DELETE'
        });

        const data = await response.json();

        if (response.ok && data.success) {
            this.showToast('success', 'Log eliminati', `Eliminati ${data.deletedCount} log di tutti i PC`);

            this.runs = [];
            this.renderRunsList();
            await Promise.all([this.loadHeaderStats(), this.loadClients()]);
            if (this.selectedClient) {
                await this.loadClientRuns();
                this.updateClientSummary();
            }
        } else {
            this.showToast('error', 'Errore', data.error || 'Impossibile eliminare i log');
        }
    } catch (error) {
        console.error('Errore eliminazione tutti i log:', error);
        this.showToast('error', 'Errore', 'Errore di connessione al server');
    }
};
