class OnlyBackupApp {
    constructor() {
        this.authenticated = false;
        this.currentUser = null;
        this.selectedClient = null;
        this.clients = [];
        this.jobs = [];
        this.runs = [];
        this.editingJob = null;
        this.isNewJob = false;
        this.browseMappingIndex = null;
        this.currentFsPath = '';
        this.selectedFsEntry = null;
        this.selectedFsType = null;
        this.statsInterval = null;
        this.clientsPollingInterval = null;
        this.statsPollingMs = 60000;
        this.clientsPollingMs = 30000;
        this.statsPollingTimer = null;
        this.clientsPollingTimer = null;
        this.statsBackoffMs = this.statsPollingMs;
        this.clientsBackoffMs = this.clientsPollingMs;
        this.activeScreen = null;
        this.clientStatusCache = {};
        this.selectedClientRunsLoaded = false;
        this.logViewerOffset = 0;
        this.logViewerLimit = 5;
        this.logViewerTailLines = 200;
        this.logViewerMappingIndex = null;
        this.logViewerHasMore = false;
        this.eventSource = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.sseEnabled = true;
        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.showScreen('loadingScreen');
        await this.checkAuthStatus();
    }

    setupEventListeners() {
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleLogin();
            });
        }

        const changePasswordForm = document.getElementById('changePasswordForm');
        if (changePasswordForm) {
            changePasswordForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleChangePassword();
            });
        }

        const jobEditorForm = document.getElementById('jobEditorForm');
        if (jobEditorForm) {
            jobEditorForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleSaveJob();
            });
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeFilesystemModal();
                this.closeLogViewer();
            }
        });

        document.addEventListener('visibilitychange', () => {
            this.handleVisibilityChange();
        });
    }

    connectSSE() {
        if (!this.sseEnabled || !window.EventSource) {
            console.warn('SSE non supportato o disabilitato, uso polling fallback');
            return;
        }

        if (this.eventSource) {
            this.eventSource.close();
        }

        this.eventSource = new EventSource('/api/events');

        this.eventSource.addEventListener('connected', (e) => {
            console.log('SSE connesso:', e.data);
            this.reconnectAttempts = 0;
        });

        this.eventSource.addEventListener('client_status_changed', (e) => {
            const data = JSON.parse(e.data);
            this.handleClientStatusChanged(data);
        });

        this.eventSource.addEventListener('backup_started', (e) => {
            const data = JSON.parse(e.data);
            this.handleBackupStarted(data);
        });

        this.eventSource.addEventListener('backup_completed', (e) => {
            const data = JSON.parse(e.data);
            this.handleBackupCompleted(data);
        });

        this.eventSource.addEventListener('stats_updated', (e) => {
            const data = JSON.parse(e.data);
            this.updateHeaderStats(data);
        });

        this.eventSource.addEventListener('job_created', (e) => {
            const data = JSON.parse(e.data);
            this.loadClients();
        });

        this.eventSource.addEventListener('job_updated', (e) => {
            const data = JSON.parse(e.data);
            this.loadClients();
        });

        this.eventSource.addEventListener('job_deleted', (e) => {
            const data = JSON.parse(e.data);
            this.loadClients();
        });

        this.eventSource.onerror = (err) => {
            console.error('SSE error:', err);
            this.eventSource.close();

            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
                this.reconnectAttempts++;
                console.log(`Riconnessione SSE in ${delay}ms (tentativo ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
                setTimeout(() => {
                    if (this.authenticated) {
                        this.connectSSE();
                    }
                }, delay);
            } else {
                console.warn('Troppi tentativi di riconnessione SSE, fallback a polling');
                this.sseEnabled = false;
                this.startDashboardPolling();
            }
        };

        window.addEventListener('beforeunload', () => {
            if (this.eventSource) {
                this.eventSource.close();
            }
        });
    }

    disconnectSSE() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
    }

    handleClientStatusChanged(data) {
        console.log('Client status changed:', data);

        const clientRow = document.querySelector(`tr[data-hostname="${data.hostname}"]`);
        if (clientRow) {
            const statusCell = clientRow.querySelector('.client-status');
            if (statusCell) {
                statusCell.textContent = data.status === 'online' ? 'Online' : 'Offline';
                statusCell.className = `client-status status-${data.status}`;
            }
        }

        this.loadHeaderStats();
    }

    handleBackupStarted(data) {
        console.log('Backup started:', data);
        this.showToast('info', 'Backup Avviato', `Backup su ${data.hostname} avviato`);
    }

    handleBackupCompleted(data) {
        console.log('Backup completed:', data);

        const statusText = data.status === 'completed' ? 'completato' :
                          data.status === 'failed' ? 'fallito' :
                          data.status === 'partial' ? 'parziale' : data.status;

        const type = data.status === 'completed' ? 'success' :
                     data.status === 'failed' ? 'error' : 'warning';

        this.showToast(type, 'Backup Completato', `Backup ${statusText}`);

        this.loadHeaderStats();
        this.loadClients();
    }

    updateHeaderStats(data) {
        const onlineEl = document.getElementById('headerClientsOnline');
        const offlineEl = document.getElementById('headerClientsOffline');
        const okEl = document.getElementById('headerBackupsOk');
        const koEl = document.getElementById('headerBackupsFailed');

        if (onlineEl && data.clients_online !== undefined) onlineEl.textContent = data.clients_online;
        if (offlineEl && data.clients_offline !== undefined) offlineEl.textContent = data.clients_offline;
        if (okEl && data.success !== undefined) okEl.textContent = data.success;
        if (koEl && data.failed !== undefined) koEl.textContent = data.failed;
    }

    showToast(type, title, message, duration = 5000) {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const icons = {
            success: '\u2713',
            error: '\u2717',
            warning: '\u26A0',
            info: '\u2139'
        };

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || icons.info}</span>
            <div class="toast-content">
                <div class="toast-title">${this.escapeHtml(title)}</div>
                ${message ? `<div class="toast-message">${this.escapeHtml(message)}</div>` : ''}
            </div>
            <button class="toast-close" onclick="this.parentElement.remove()">\u00D7</button>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            if (toast.parentElement) {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(100%)';
                setTimeout(() => toast.remove(), 200);
            }
        }, duration);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    setButtonLoading(button, loading) {
        if (!button) return;
        if (loading) {
            button.classList.add('loading');
            button.disabled = true;
        } else {
            button.classList.remove('loading');
            button.disabled = false;
        }
    }

    setPanelState(panelId, state) {
        const panel = document.getElementById(panelId);
        if (!panel) return;
        const rows = panel.querySelectorAll('.state-row');
        rows.forEach(row => {
            const rowState = row.getAttribute('data-state');
            row.classList.toggle('hidden', state !== rowState);
        });
        if (state === 'ready') {
            rows.forEach(row => row.classList.add('hidden'));
        }
    }

    normalizeRunStatus(status) {
        if (!status) return '';
        const normalized = status.toLowerCase();
        return normalized === 'failed' ? 'failure' : normalized;
    }

    deriveRunStatus(run) {
        const mappingStatuses = Array.isArray(run?.mappings)
            ? run.mappings
                .map(m => this.normalizeRunStatus(m.status))
                .filter(Boolean)
            : [];

        if (mappingStatuses.length > 0) {
            if (mappingStatuses.some(s => s === 'failure' || s === 'failed')) {
                return 'failure';
            }
            if (mappingStatuses.some(s => s === 'partial')) {
                return 'partial';
            }
            return 'success';
        }

        return this.normalizeRunStatus(run?.status);
    }

    statusLabelFor(state) {
        if (!state) return 'Sconosciuto';
        const normalized = this.normalizeRunStatus(state);
        if (normalized === 'success') return 'Successo';
        if (normalized === 'partial') return 'Parziale';
        if (normalized === 'running') return 'In corso';
        if (normalized === 'failure' || normalized === 'failed') return 'Fallito';
        return normalized;
    }

    getButtonByText(text) {
        const buttons = document.querySelectorAll('.btn');
        for (const btn of buttons) {
            if (btn.textContent.trim().includes(text)) {
                return btn;
            }
        }
        return null;
    }

    async checkAuthStatus() {
        try {
            const response = await fetch('/api/auth/status');

            if (response.ok) {
                const data = await response.json();
                this.authenticated = true;
                this.currentUser = data.username;

                // Connetti SSE se autenticato
                if (this.sseEnabled) {
                    this.connectSSE();
                }

                if (data.mustChangePassword) {
                    this.showScreen('changePasswordScreen');
                } else {
                    this.showDashboard();
                }
            } else {
                this.showLogin();
            }
        } catch (error) {
            console.error('Errore verifica autenticazione:', error);
            this.showLogin();
        }
    }

    async handleLogin() {
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('loginError');

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok) {
                this.authenticated = true;
                this.currentUser = data.username;

                if (data.mustChangePassword) {
                    this.showScreen('changePasswordScreen');
                } else {
                    this.showDashboard();
                    this.showToast('success', 'Accesso effettuato', `Benvenuto, ${data.username}`);
                }
            } else {
                errorDiv.textContent = data.error || 'Credenziali non valide';
            }
        } catch (error) {
            console.error('Errore login:', error);
            errorDiv.textContent = 'Errore di connessione al server';
        }
    }

    async handleChangePassword() {
        const oldPassword = document.getElementById('oldPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const errorDiv = document.getElementById('changePasswordError');

        if (newPassword !== confirmPassword) {
            errorDiv.textContent = 'Le password non coincidono';
            return;
        }

        if (newPassword.length < 8) {
            errorDiv.textContent = 'La password deve essere di almeno 8 caratteri';
            return;
        }

        try {
            const response = await fetch('/api/auth/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldPassword, newPassword })
            });

            const data = await response.json();

            if (response.ok) {
                this.showDashboard();
                this.showToast('success', 'Password aggiornata', 'La password è stata modificata con successo');
            } else {
                errorDiv.textContent = data.error || 'Errore durante il cambio password';
            }
        } catch (error) {
            console.error('Errore cambio password:', error);
            errorDiv.textContent = 'Errore di connessione al server';
        }
    }

    async logout() {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });

            // Disconnetti SSE
            this.disconnectSSE();

            this.authenticated = false;
            this.currentUser = null;
            this.selectedClient = null;
            this.editingJob = null;
            if (this.statsInterval) {
                clearInterval(this.statsInterval);
                this.statsInterval = null;
            }
            if (this.clientsPollingInterval) {
                clearInterval(this.clientsPollingInterval);
                this.clientsPollingInterval = null;
            }
            if (this.statsPollingTimer) {
                clearTimeout(this.statsPollingTimer);
                this.statsPollingTimer = null;
            }
            if (this.clientsPollingTimer) {
                clearTimeout(this.clientsPollingTimer);
                this.clientsPollingTimer = null;
            }
            this.showLogin();
        } catch (error) {
            console.error('Errore logout:', error);
        }
    }

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.add('hidden');
        });
        const screen = document.getElementById(screenId);
        if (screen) {
            screen.classList.remove('hidden');
        }
        this.activeScreen = screenId;
    }

    showLogin() {
        this.showScreen('loginScreen');
    }

    async showPublicStats() {
        this.showScreen('publicStatsScreen');
        await this.loadPublicStats();
        this.startPublicStatsPolling();
    }

    async loadPublicStats() {
        try {
            const response = await fetch('/api/public/stats');
            if (response.status === 304) {
                return true;
            }
            if (response.ok) {
                const data = await response.json();
                document.getElementById('backupsOk').textContent = data.backups_ok_24h;
                document.getElementById('backupsFailed').textContent = data.backups_failed_24h;
                document.getElementById('clientsOnline').textContent = data.clients_online;
                document.getElementById('clientsOffline').textContent = data.clients_offline;
                return true;
            }
        } catch (error) {
            console.error('Errore caricamento stats pubbliche:', error);
        }
        return false;
    }

    async showDashboard() {
        this.showScreen('mainDashboard');
        document.getElementById('currentUser').textContent = this.currentUser;
        await Promise.all([this.loadClients(), this.loadHeaderStats()]);
        this.startDashboardPolling();
    }

    startPublicStatsPolling() {
        if (document.hidden) return;
        this.scheduleStatsPolling(() => this.loadPublicStats());
    }

    startDashboardPolling() {
        if (document.hidden) return;
        this.scheduleStatsPolling(() => this.loadHeaderStats());
        this.scheduleClientsPolling(() => this.loadClients());
    }

    scheduleStatsPolling(action) {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
        }
        if (this.statsPollingTimer) {
            clearTimeout(this.statsPollingTimer);
        }

        const run = async () => {
            const success = await action();
            this.statsBackoffMs = success ? this.statsPollingMs : Math.min(this.statsBackoffMs * 2, this.statsPollingMs * 5);
            this.statsPollingTimer = setTimeout(run, this.statsBackoffMs);
        };

        this.statsBackoffMs = this.statsPollingMs;
        this.statsPollingTimer = setTimeout(run, this.statsBackoffMs);
    }

    scheduleClientsPolling(action) {
        if (this.clientsPollingInterval) {
            clearInterval(this.clientsPollingInterval);
            this.clientsPollingInterval = null;
        }
        if (this.clientsPollingTimer) {
            clearTimeout(this.clientsPollingTimer);
        }

        const run = async () => {
            const success = await action();
            this.clientsBackoffMs = success ? this.clientsPollingMs : Math.min(this.clientsBackoffMs * 2, this.clientsPollingMs * 5);
            this.clientsPollingTimer = setTimeout(run, this.clientsBackoffMs);
        };

        this.clientsBackoffMs = this.clientsPollingMs;
        this.clientsPollingTimer = setTimeout(run, this.clientsBackoffMs);
    }

    handleVisibilityChange() {
        if (document.hidden) {
            if (this.statsInterval) {
                clearInterval(this.statsInterval);
                this.statsInterval = null;
            }
            if (this.clientsPollingInterval) {
                clearInterval(this.clientsPollingInterval);
                this.clientsPollingInterval = null;
            }
            if (this.statsPollingTimer) {
                clearTimeout(this.statsPollingTimer);
                this.statsPollingTimer = null;
            }
            if (this.clientsPollingTimer) {
                clearTimeout(this.clientsPollingTimer);
                this.clientsPollingTimer = null;
            }
            return;
        }

        if (this.activeScreen === 'mainDashboard' && this.authenticated) {
            this.startDashboardPolling();
        } else if (this.activeScreen === 'publicStatsScreen') {
            this.startPublicStatsPolling();
        }
    }

    async loadHeaderStats() {
        try {
            const response = await fetch('/api/public/stats');
            if (response.status === 304) {
                return true;
            }
            if (response.ok) {
                const data = await response.json();
                const onlineEl = document.getElementById('headerClientsOnline');
                const offlineEl = document.getElementById('headerClientsOffline');
                const okEl = document.getElementById('headerBackupsOk');
                const koEl = document.getElementById('headerBackupsFailed');

                if (onlineEl) onlineEl.textContent = data.clients_online;
                if (offlineEl) offlineEl.textContent = data.clients_offline;
                if (okEl) okEl.textContent = data.backups_ok_24h;
                if (koEl) koEl.textContent = data.backups_failed_24h;

                this.renderHeaderBackupStatus(Array.isArray(data.client_statuses) ? data.client_statuses : []);
                this.updateFooterStatus({
                    healthy: true,
                    message: 'Backend online'
                });
                return true;
            }
        } catch (error) {
            console.error('Errore caricamento stats header:', error);
            this.updateFooterStatus({ healthy: false, message: 'Backend non raggiungibile' });
        }
        return false;
    }

    async loadClients() {
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

                loadedClients.forEach(client => {
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
                } else if (this.selectedClient) {
                    this.updateClientHeader();
                    if (selectedStatusChanged || !this.selectedClientRunsLoaded) {
                        await this.loadClientRuns();
                        this.selectedClientRunsLoaded = true;
                    }
                    this.updateClientSummary();
                }
                return true;
            } else if (response.status === 401) {
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
    }

    renderClientsList() {
        const container = document.getElementById('clientsList');

        if (this.clients.length === 0) {
            container.innerHTML = '<div class="info-message">Nessun client registrato</div>';
            return;
        }

        const sortedClients = [...this.clients].sort((a, b) => {
            if (a.online !== b.online) return b.online ? 1 : -1;
            return a.hostname.localeCompare(b.hostname);
        });

        container.innerHTML = sortedClients.map(client => {
            let backupIcon = '';

            if (client.backup_status === 'in_progress') {
                backupIcon = '<span class="backup-status-icon running" title="Backup in corso">●</span>';
            } else if (client.backup_status === 'partial') {
                backupIcon = '<span class="backup-status-icon partial" title="Backup parziale">●</span>';
            } else if (client.backup_status === 'completed') {
                backupIcon = '<span class="backup-status-icon success" title="Backup completato">✓</span>';
            } else if (client.backup_status === 'failed') {
                backupIcon = '<span class="backup-status-icon failure" title="Backup fallito">✗</span>';
            } else if (client.lastBackupRun) {
                if (client.lastBackupRun.status === 'success') {
                    backupIcon = '<span class="backup-status-icon success" title="Ultimo backup riuscito">✓</span>';
                } else if (client.lastBackupRun.status === 'failure') {
                    backupIcon = '<span class="backup-status-icon failure" title="Ultimo backup fallito">✗</span>';
                } else if (client.lastBackupRun.status === 'partial') {
                    backupIcon = '<span class="backup-status-icon partial" title="Ultimo backup parziale">●</span>';
                }
            }

            const showResetBackup = client.backup_status === 'in_progress';
            const statusDotClass = client.online ? 'online' : 'offline';
            const lastSeen = client.lastSeen ? new Date(client.lastSeen).toLocaleString() : 'Mai';
            const ipInfo = client.agent_ip ? `${client.agent_ip}:${client.agent_port || 8081}` : 'IP non disponibile';

            return `
            <div class="client-item ${this.selectedClient === client.hostname ? 'active' : ''}"
                 onclick="app.selectClient('${this.escapeForAttribute(client.hostname)}')">
                <div class="client-meta-wrapper">
                    <div class="client-name-row">
                        <span class="status-dot ${statusDotClass}"></span>
                        <div class="client-name">${backupIcon}${this.escapeHtml(client.hostname)}</div>
                    </div>
                    <div class="client-meta">
                        <span class="client-ip" title="Indirizzo agent">${this.escapeHtml(ipInfo)}</span>
                        <span class="client-lastseen" title="Ultimo contatto">Ultimo contatto: ${this.escapeHtml(lastSeen)}</span>
                    </div>
                </div>
                <div class="client-item-actions">
                    ${showResetBackup ? `
                        <button class="btn btn-icon btn-small" style="background: #f39c12; color: white; border-color: #f39c12;"
                                onclick="event.stopPropagation(); app.resetBackupStatus('${this.escapeForAttribute(client.hostname)}')"
                                title="Resetta stato backup (non ferma il backup reale)">⏹</button>
                    ` : ''}
                    <button class="btn btn-icon btn-danger btn-small"
                            onclick="event.stopPropagation(); app.showDeregisterDialog('${this.escapeForAttribute(client.hostname)}')"
                            title="Deregistra PC">×</button>
                </div>
            </div>
        `;
        }).join('');
    }

    updateClientHeader() {
        const client = this.clients.find(c => c.hostname === this.selectedClient);
        if (!client) return;

        document.getElementById('selectedClientName').textContent = client.hostname;
        const statusEl = document.getElementById('clientHeaderStatus');
        statusEl.textContent = client.online ? 'Online' : 'Offline';
        statusEl.className = 'client-header-status ' + (client.online ? 'online' : 'offline');
    }

    async selectClient(hostname) {
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
    }

    showDeregisterDialog(hostname) {
        this.pendingDeregisterHostname = hostname;
        const message = `Sei sicuro di voler deregistrare il PC ${this.escapeHtml(hostname)}? Questa azione eliminerà tutti i job, run, log e dati associati al client.`;
        document.getElementById('deregisterMessage').textContent = message;
        document.getElementById('deregisterDialog').classList.remove('hidden');
    }

    closeDeregisterDialog() {
        this.pendingDeregisterHostname = null;
        document.getElementById('deregisterDialog').classList.add('hidden');
    }

    async confirmDeregisterClient() {
        const hostname = this.pendingDeregisterHostname;
        if (!hostname) return;

        this.closeDeregisterDialog();
        const wasSelected = this.selectedClient === hostname;

        try {
            const response = await fetch(`/api/clients/${encodeURIComponent(hostname)}`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.showToast('success', 'Client deregistrato', `${hostname} è stato deregistrato`);
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
    }

    async deregisterClient() {
        if (!this.selectedClient) return;

        const hostname = this.selectedClient;
        if (!confirm(`Deregistrare il client "${hostname}" e tutti i dati associati?`)) {
            return;
        }

        try {
            const response = await fetch(`/api/clients/${encodeURIComponent(hostname)}`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.showToast('success', 'Client deregistrato', `${hostname} è stato deregistrato`);
                this.selectedClient = null;
                this.jobs = [];
                this.runs = [];
                this.editingJob = null;
                await this.loadClients();
                await this.loadHeaderStats();
                if (this.clients.length > 0) {
                    this.selectClient(this.clients[0].hostname);
                } else {
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
            this.showToast('error', 'Errore di connessione al server');
        }
    }

    clearClientLogs() {
        if (!this.selectedClient) return;

        const message = `Sei sicuro di voler eliminare tutto lo storico backup del PC ${this.escapeHtml(this.selectedClient)}? I job non verranno eliminati, solo le esecuzioni passate.`;
        document.getElementById('clearLogsMessage').textContent = message;
        document.getElementById('clearLogsDialog').classList.remove('hidden');
    }

    closeClearLogsDialog() {
        document.getElementById('clearLogsDialog').classList.add('hidden');
    }

    async confirmClearClientLogs() {
        if (!this.selectedClient) return;

        this.closeClearLogsDialog();

        try {
            const response = await fetch(`/api/clients/${encodeURIComponent(this.selectedClient)}/runs`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.showToast('success', 'Log eliminati', `Storico backup di ${this.selectedClient} eliminato (${data.runsDeleted} esecuzioni)`);
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
    }

    async loadClientJobs() {
        if (!this.selectedClient) return;

        try {
            const response = await fetch(`/api/clients/${encodeURIComponent(this.selectedClient)}/jobs`);
            if (response.ok) {
                this.jobs = await response.json();
                this.renderJobsList();
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
    }

    renderJobsList() {
        const container = document.getElementById('jobsList');

        if (this.jobs.length === 0) {
            container.innerHTML = '<div class="info-message">Nessun job configurato</div>';
            return;
        }

        container.innerHTML = this.jobs.map(job => {
            const schedule = this.formatSchedule(job.schedule);
            const isActive = this.editingJob?.job_id === job.job_id;

            const jobData = isActive && this.editingJob
                ? { ...job, ...this.editingJob, mappings: this.editingJob.mappings }
                : job;

            const mappings = Array.isArray(jobData.mappings) ? jobData.mappings : [];
            const mappingsCount = mappings.length;

            const uniqueModes = new Set(
                mappings.map(m => (m.mode || jobData.mode_default || 'copy').toLowerCase())
            );

            let modeLabel = (jobData.mode_default || 'copy').toUpperCase();
            if (uniqueModes.size === 1) {
                modeLabel = Array.from(uniqueModes)[0].toUpperCase();
            } else if (uniqueModes.size > 1) {
                modeLabel = 'MIX';
            }

            return `
                <div class="job-card ${isActive ? 'active' : ''}" onclick="app.editJob('${this.escapeForAttribute(job.job_id)}')">
                    <div class="job-header">
                        <div>
                            <div class="job-id">${this.escapeHtml(job.job_id)}</div>
                            <div class="run-date">${schedule}</div>
                        </div>
                        <div class="job-actions">
                            <span class="status-badge ${jobData.enabled ? 'enabled' : 'disabled'}">
                                ${jobData.enabled ? 'Attivo' : 'Disattivo'}
                            </span>
                        </div>
                    </div>
                    <div class="job-info">
                        <span class="job-info-label">Modalita:</span>
                        <span>${this.escapeHtml(modeLabel)}</span>
                        <span class="job-info-label">Mappature:</span>
                        <span>${mappingsCount}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    formatSchedule(schedule) {
        if (!schedule) return 'Non pianificato';
        if (schedule.type === 'daily') {
            const dayNames = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
            const days = Array.isArray(schedule.days) ? schedule.days.map(d => dayNames[d]).join(', ') : '';
            const times = Array.isArray(schedule.times) ? schedule.times.join(', ') : '';
            return days ? `${days} @ ${times}` : times;
        }
        return schedule.type;
    }

    showCreateJobForm() {
        if (!this.selectedClient) {
            this.showToast('warning', 'Attenzione', 'Seleziona prima un client');
            return;
        }
        this.showTab('jobs');
        this.startNewJob();
    }

    startNewJob() {
        if (!this.selectedClient) return;

        this.isNewJob = true;
        this.editingJob = this.createEmptyJob();
        this.renderJobEditor();
        this.renderJobsList();
    }

    cancelEditJob() {
        if (this.isNewJob) {
            this.editingJob = null;
            this.isNewJob = false;
            this.renderJobEditor();
            this.renderJobsList();
            if (this.jobs.length > 0) {
                this.editJob(this.jobs[0].job_id);
            }
        }
    }

    createEmptyJob() {
        return {
            job_id: `BACKUP-${Date.now()}`,
            client_hostname: this.selectedClient,
            enabled: true,
            mode_default: 'copy',
            schedule: { type: 'daily', days: [1, 2, 3, 4, 5], times: ['02:00'] },
            mappings: [this.createEmptyMapping()]
        };
    }

    createEmptyMapping() {
        return {
            label: '',
            source_path: '',
            destination_path: '',
            mode: 'copy',
            retention: { max_backups: 5 },
            credentials: { type: 'nas', username: '', password: '', domain: '' }
        };
    }

    editJob(jobId) {
        const job = this.jobs.find(j => j.job_id === jobId);
        if (!job) return;

        this.isNewJob = false;
        const cloned = JSON.parse(JSON.stringify(job));

        if (!cloned.schedule) {
            cloned.schedule = { type: 'daily', days: [1, 2, 3, 4, 5], times: [] };
        }
        if (cloned.schedule) {
            cloned.schedule.days = cloned.schedule.days || [1, 2, 3, 4, 5];
            cloned.schedule.times = cloned.schedule.times || [];
        }

        cloned.mappings = (cloned.mappings || []).map(m => ({
            label: m.label || '',
            source_path: m.source_path || '',
            destination_path: m.destination_path || '',
            mode: m.mode || cloned.mode_default || 'copy',
            retention: m.retention || { max_backups: 5 },
            credentials: m.credentials || { type: 'nas', username: '', password: '', domain: '' }
        }));

        this.editingJob = cloned;
        this.renderJobEditor();
        this.renderJobsList();
    }

    async openLogViewer(mappingIndex = null) {
        const modal = document.getElementById('logViewerModal');
        const content = document.getElementById('logViewerContent');
        const logConsole = document.getElementById('jobLogConsole');

        if (!modal || !content) return;
        if (!this.selectedClient) {
            this.showToast('warning', 'Attenzione', 'Seleziona un client per visualizzare i log');
            return;
        }

        if (!this.editingJob?.job_id) {
            this.showToast('warning', 'Attenzione', 'Seleziona un job per aprire i log completi');
            return;
        }

        modal.classList.remove('hidden');
        content.innerHTML = `
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line"></div>
        `;

        this.logViewerOffset = 0;
        this.logViewerMappingIndex = Number.isInteger(mappingIndex) ? mappingIndex : null;
        this.logViewerHasMore = false;

        const loaded = await this.loadLogViewerPage(true);
        if (!loaded) {
            const fallback = logConsole?.innerHTML?.trim();
            content.innerHTML = fallback
                ? fallback
                : '<p class="log-empty">Errore nel recupero dei log dal server.</p>';
        }
    }

    async loadLogViewerPage(reset = false) {
        const content = document.getElementById('logViewerContent');
        if (!content || !this.selectedClient || !this.editingJob?.job_id) {
            return false;
        }

        try {
            const hostname = this.selectedClient.hostname || this.selectedClient;
            const mappingIndex = this.logViewerMappingIndex;
            const params = new URLSearchParams();
            if (Number.isInteger(mappingIndex)) {
                params.set('mapping', mappingIndex.toString());
            }
            params.set('limit', this.logViewerLimit.toString());
            params.set('offset', this.logViewerOffset.toString());
            params.set('tailLines', this.logViewerTailLines.toString());

            const response = await fetch(`/api/clients/${encodeURIComponent(hostname)}/jobs/${encodeURIComponent(this.editingJob.job_id)}/logs/full?${params.toString()}`);
            if (!response.ok) {
                const errorPayload = await response.json().catch(() => ({}));
                throw new Error(errorPayload.error || 'Risposta non valida dal server');
            }

            const data = await response.json();
            const runs = Array.isArray(data?.runs) ? data.runs : [];
            const total = data?.pagination?.total || 0;

            if (reset) {
                content.innerHTML = '';
            }

            if (runs.length === 0 && reset) {
                content.innerHTML = '<p class="log-empty">Nessun log disponibile per questa mappatura.</p>';
                return true;
            }

            const sections = runs.map(run => this.buildLogViewerSection(run, mappingIndex)).filter(Boolean).join('');
            content.insertAdjacentHTML('beforeend', sections);

            this.logViewerOffset += runs.length;
            this.logViewerHasMore = this.logViewerOffset < total;

            const existingButton = document.getElementById('logViewerLoadMore');
            if (existingButton) {
                existingButton.remove();
            }

            if (this.logViewerHasMore) {
                content.insertAdjacentHTML('beforeend', `
                    <div class="log-load-more">
                        <button id="logViewerLoadMore" class="btn btn-outline btn-small" onclick="app.loadLogViewerPage()">Carica altri log</button>
                    </div>
                `);
            }

            return true;
        } catch (error) {
            console.error('Errore caricamento log viewer:', error);
            content.innerHTML = '<p class="log-empty">Errore nel recupero dei log dal server.</p>';
            return false;
        }
    }

    buildLogViewerSection(run, mappingIndex) {
        const runMappings = Array.isArray(run.mappings) ? run.mappings : [];
        const mapping = mappingIndex === null
            ? runMappings[0]
            : runMappings.find(m => Number.isInteger(mappingIndex) && Number(m.index) === mappingIndex);

        if (!mapping) {
            return '';
        }

        const logs = Array.isArray(mapping.logs) ? mapping.logs : [];
        const entries = logs.length > 0
            ? logs.map(log => `<pre class="log-block">${this.escapeHtml(log.content || '')}</pre>`).join('')
            : '<p class="log-empty">Nessun log disponibile per questa mappatura.</p>';

        const runTime = run.start
            ? new Date(run.start).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
            : 'Data non disponibile';
        const statusClass = this.normalizeRunStatus(mapping.status || run.status || '');
        const destination = mapping.destination_path ? `<span class="log-run-destination">Dest: ${this.escapeHtml(mapping.destination_path)}</span>` : '';

        return `
            <div class="log-run">
                <div class="log-run-header">
                    <div>
                        <div class="log-run-title">Run ${this.escapeHtml(run.run_id || '')}</div>
                        <div class="log-run-meta">${this.escapeHtml(runTime)}${destination ? ` · ${destination}` : ''}</div>
                    </div>
                    <div class="log-run-status ${statusClass || 'unknown'}">${this.statusLabelFor(statusClass)}</div>
                </div>
                <div class="log-run-meta">${this.escapeHtml(mapping.label || `Mappatura ${(Number(mapping.index) || 0) + 1}`)} · ${this.escapeHtml((mapping.mode || 'copy').toUpperCase())}</div>
                ${entries}
            </div>
        `;
    }

    async openBackupsList() {
        const modal = document.getElementById('backupsModal');
        const content = document.getElementById('backupsModalContent');

        if (!modal || !content) return;
        if (!this.selectedClient) {
            this.showToast('warning', 'Attenzione', 'Seleziona un client per visualizzare i backup');
            return;
        }

        if (!this.editingJob?.job_id) {
            this.showToast('warning', 'Attenzione', 'Seleziona un job per vedere i backup');
            return;
        }

        modal.classList.remove('hidden');
        content.innerHTML = `
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line"></div>
        `;

        const mappings = Array.isArray(this.editingJob?.mappings) ? this.editingJob.mappings : [];
        this.renderBackupsModal({
            hostname: this.selectedClient.hostname || this.selectedClient,
            job_id: this.editingJob.job_id,
            mappings: mappings.map((mapping, index) => ({
                index,
                label: mapping.label,
                destination_path: mapping.destination_path,
                mode: mapping.mode || this.editingJob.mode_default || 'copy'
            }))
        });
    }

    renderBackupsModal(data) {
        const content = document.getElementById('backupsModalContent');
        if (!content) return;

        const mappings = Array.isArray(data?.mappings) ? data.mappings : [];
        if (mappings.length === 0) {
            content.innerHTML = '<p class="info-message">Nessuna mappatura disponibile per questo job.</p>';
            return;
        }

        const sections = mappings.map((mapping, idx) => {
            let body = '';
            const mappingIndex = Number.isFinite(Number(mapping.index)) ? Number(mapping.index) : idx;
            const cardId = `backup-card-${mappingIndex}`;

            if (mapping.error) {
                body = `<p class="error-message">${this.escapeHtml(mapping.error)}</p>`;
            } else if (!Array.isArray(mapping.backups)) {
                body = `
                    <p class="pill-label">Carica i backup per questa mappatura.</p>
                    <button type="button" class="btn btn-outline btn-small" onclick="app.loadBackupsForMapping(${mappingIndex})">
                        Carica backup
                    </button>
                `;
            } else {
                const backups = mapping.backups;
                const toolbar = `
                    <div class="backup-toolbar">
                        <label class="backup-select-all">
                            <input type="checkbox" onchange="app.toggleSelectAllBackups(${mappingIndex}, this.checked)">
                            <span>Seleziona tutti</span>
                        </label>
                        <button type="button" class="btn btn-outline btn-small" onclick="app.deleteSelectedBackups(${mappingIndex})">Elimina selezionati</button>
                    </div>`;

                const rows = backups.map(backup => {
                    const modified = backup.modified
                        ? new Date(backup.modified).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                        : 'Data non disponibile';
                    const targetPath = backup.path || backup.name || '';
                    const legacyBadge = backup.legacy ? '<span class="badge badge-warning" title="Backup senza manifest">Legacy</span>' : '';
                    const sizeLabel = backup.size > 0 ? this.formatBytes(backup.size) : '';
                    const slotLabel = Number.isFinite(backup.retention_index)
                        ? `<span class="badge badge-neutral" title="Indice retention">Slot ${backup.retention_index}</span>`
                        : '';

                    return `
                        <div class="backup-row">
                            <label class="backup-select">
                                <input type="checkbox" class="backup-checkbox" data-path="${this.escapeForAttribute(targetPath)}" data-mapping-index="${mappingIndex}">
                                <span class="checkbox-faux"></span>
                            </label>
                            <div class="backup-main">
                                <div class="backup-name">
                                    ${this.escapeHtml(backup.name || 'Backup')}
                                    ${legacyBadge}
                                    ${slotLabel}
                                </div>
                                <div class="backup-path">${this.escapeHtml(targetPath)}</div>
                                ${sizeLabel ? `<div class="backup-size">${this.escapeHtml(sizeLabel)}</div>` : ''}
                            </div>
                            <div class="backup-actions">
                                <div class="backup-meta">${this.escapeHtml(modified)}</div>
                                <button type="button" class="btn btn-outline btn-small" onclick="app.deleteBackup('${this.escapeForAttribute(targetPath)}')">Elimina</button>
                            </div>
                        </div>
                    `;
                }).join('');

                body = toolbar + rows;
            }

            return `
                <div class="backup-card" id="${cardId}" data-mapping-index="${mappingIndex}">
                    <header>
                        <div>
                            <div class="mapping-title">${this.escapeHtml(mapping.label || `Mappatura ${(mappingIndex ?? idx) + 1}`)}</div>
                            <div class="backup-destination">${this.escapeHtml(mapping.destination_path || 'Destinazione non configurata')}</div>
                        </div>
                        <span class="badge">${this.escapeHtml(mapping.mode || '-')}</span>
                    </header>
                    <div class="backup-list">${body}</div>
                </div>
            `;
        }).join('');

        content.innerHTML = sections;
    }

    async loadBackupsForMapping(mappingIndex) {
        if (!this.selectedClient || !this.editingJob?.job_id) return;
        const card = document.getElementById(`backup-card-${mappingIndex}`);
        if (!card) return;

        const list = card.querySelector('.backup-list');
        if (list) {
            list.innerHTML = `
                <div class="skeleton skeleton-line"></div>
                <div class="skeleton skeleton-line"></div>
            `;
        }

        try {
            const hostname = this.selectedClient.hostname || this.selectedClient;
            const response = await fetch(`/api/clients/${encodeURIComponent(hostname)}/jobs/${encodeURIComponent(this.editingJob.job_id)}/backups/analyze?mapping=${mappingIndex}`, {
                cache: 'no-store'
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Impossibile recuperare i backup');
            }

            const mapping = Array.isArray(data?.mappings) ? data.mappings[0] : null;
            if (!mapping) {
                throw new Error('Mappatura non disponibile');
            }

            const refreshed = {
                index: mappingIndex,
                label: mapping.label,
                destination_path: mapping.destination_path,
                mode: mapping.mode,
                backups: mapping.backups || [],
                error: mapping.error || null
            };

            card.outerHTML = this.renderBackupCard(refreshed, mappingIndex);
        } catch (error) {
            console.error('Errore caricamento backup:', error);
            if (list) {
                list.innerHTML = `<p class="error-message">${this.escapeHtml(error.message || 'Errore nel recupero dei backup')}</p>`;
            }
        }
    }

    renderBackupCard(mapping, mappingIndex) {
        const backups = Array.isArray(mapping.backups) ? mapping.backups : [];
        let body = '';

        if (mapping.error) {
            body = `<p class="error-message">${this.escapeHtml(mapping.error)}</p>`;
        } else if (backups.length === 0) {
            body = '<p class="pill-label">Nessun backup trovato in destinazione.</p>';
        } else {
            const toolbar = `
                <div class="backup-toolbar">
                    <label class="backup-select-all">
                        <input type="checkbox" onchange="app.toggleSelectAllBackups(${mappingIndex}, this.checked)">
                        <span>Seleziona tutti</span>
                    </label>
                    <button type="button" class="btn btn-outline btn-small" onclick="app.deleteSelectedBackups(${mappingIndex})">Elimina selezionati</button>
                </div>`;

            const rows = backups.map(backup => {
                const modified = backup.modified
                    ? new Date(backup.modified).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                    : 'Data non disponibile';
                const targetPath = backup.path || backup.name || '';
                const legacyBadge = backup.legacy ? '<span class="badge badge-warning" title="Backup senza manifest">Legacy</span>' : '';
                const sizeLabel = backup.size > 0 ? this.formatBytes(backup.size) : '';
                const slotLabel = Number.isFinite(backup.retention_index)
                    ? `<span class="badge badge-neutral" title="Indice retention">Slot ${backup.retention_index}</span>`
                    : '';

                return `
                    <div class="backup-row">
                        <label class="backup-select">
                            <input type="checkbox" class="backup-checkbox" data-path="${this.escapeForAttribute(targetPath)}" data-mapping-index="${mappingIndex}">
                            <span class="checkbox-faux"></span>
                        </label>
                        <div class="backup-main">
                            <div class="backup-name">
                                ${this.escapeHtml(backup.name || 'Backup')}
                                ${legacyBadge}
                                ${slotLabel}
                            </div>
                            <div class="backup-path">${this.escapeHtml(targetPath)}</div>
                            ${sizeLabel ? `<div class="backup-size">${this.escapeHtml(sizeLabel)}</div>` : ''}
                        </div>
                        <div class="backup-actions">
                            <div class="backup-meta">${this.escapeHtml(modified)}</div>
                            <button type="button" class="btn btn-outline btn-small" onclick="app.deleteBackup('${this.escapeForAttribute(targetPath)}', { mappingIndex: ${mappingIndex} })">Elimina</button>
                        </div>
                    </div>
                `;
            }).join('');

            body = toolbar + rows;
        }

        return `
            <div class="backup-card" id="backup-card-${mappingIndex}" data-mapping-index="${mappingIndex}">
                <header>
                    <div>
                        <div class="mapping-title">${this.escapeHtml(mapping.label || `Mappatura ${mappingIndex + 1}`)}</div>
                        <div class="backup-destination">${this.escapeHtml(mapping.destination_path || 'Destinazione non configurata')}</div>
                    </div>
                    <span class="badge">${this.escapeHtml(mapping.mode || '-')}</span>
                </header>
                <div class="backup-list">${body}</div>
            </div>
        `;
    }

    closeBackupsModal() {
        const modal = document.getElementById('backupsModal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    async deleteBackup(path, { skipConfirm = false, skipReload = false, silent = false, mappingIndex = null } = {}) {
        if (!path || !this.selectedClient || !this.editingJob?.job_id) return false;

        if (!skipConfirm && !confirm('Eliminare definitivamente questa cartella di backup?')) {
            return false;
        }

        try {
            const hostname = this.selectedClient.hostname || this.selectedClient;
            const response = await fetch(`/api/clients/${encodeURIComponent(hostname)}/jobs/${encodeURIComponent(this.editingJob.job_id)}/backups/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });

            const data = await response.json();

            if (response.ok) {
                if (!silent) {
                    this.showToast('success', 'Backup eliminato', `Cartella rimossa: ${this.escapeHtml(path)}`);
                }
                if (!skipReload) {
                    if (Number.isInteger(mappingIndex)) {
                        await this.loadBackupsForMapping(mappingIndex);
                    } else {
                        await this.openBackupsList();
                    }
                }
                return true;
            }

            if (!silent) {
                this.showToast('error', 'Errore', data.error || 'Impossibile eliminare il backup');
            }
            return false;
        } catch (error) {
            console.error('Errore eliminazione backup:', error);
            if (!silent) {
                this.showToast('error', 'Errore', 'Impossibile eliminare il backup selezionato');
            }
            return false;
        }
    }

    toggleSelectAllBackups(mappingIndex, checked) {
        const container = document.getElementById(`backup-card-${mappingIndex}`);
        if (!container) return;

        container.querySelectorAll('input.backup-checkbox').forEach(cb => {
            cb.checked = checked;
        });
    }

    async deleteSelectedBackups(mappingIndex) {
        const container = document.getElementById(`backup-card-${mappingIndex}`);
        if (!container) return;

        const selected = Array.from(container.querySelectorAll('input.backup-checkbox:checked'))
            .map(cb => cb.getAttribute('data-path'))
            .filter(Boolean);

        if (selected.length === 0) {
            this.showToast('warning', 'Attenzione', 'Seleziona almeno un backup da eliminare');
            return;
        }

        if (!confirm(`Eliminare definitivamente ${selected.length} backup selezionati?`)) {
            return;
        }

        let success = 0;
        for (const path of selected) {
            const deleted = await this.deleteBackup(path, { skipConfirm: true, skipReload: true, silent: true });
            if (deleted) {
                success += 1;
            }
        }

        if (success > 0) {
            this.showToast('success', 'Backup eliminati', `${success} backup rimossi`);
        } else {
            this.showToast('error', 'Errore', 'Nessun backup eliminato');
        }

        try {
            await this.loadBackupsForMapping(mappingIndex);
        } catch (err) {
            console.error('Errore aggiornamento lista backup dopo cancellazione multipla:', err);
        }
    }

    renderHeaderBackupStatus(statuses = []) {
        const container = document.getElementById('headerBackupStatusList');
        if (!container) return;

        if (!Array.isArray(statuses) || statuses.length === 0) {
            container.innerHTML = '<span class="pill-label">Nessun backup registrato</span>';
            return;
        }

        const filteredStatuses = statuses.filter(status => {
            const lastStatus = (status.status || '').toLowerCase();
            if (!status.online) return true;
            return ['success', 'partial', 'failed'].includes(lastStatus);
        });

        const chips = filteredStatuses.map(status => {
            const online = status.online;
            const lastStatus = (status.status || '').toLowerCase();

            let chipClass = 'unknown';
            let label = '';

            if (!online) {
                chipClass = 'offline';
                label = 'Offline';
            } else if (lastStatus === 'success') {
                chipClass = 'success';
                label = 'OK';
            } else if (lastStatus === 'partial') {
                chipClass = 'warning';
                label = 'Parziale';
            } else if (lastStatus === 'failed') {
                chipClass = 'error';
                label = 'Fallito';
            } else {
                return '';
            }

            const title = status.hostname ? `Client: ${status.hostname}` : '';

            return `<span class="status-chip ${chipClass}" title="${this.escapeForAttribute(title)}">${label}</span>`;
        }).filter(Boolean).join('');

        container.innerHTML = chips || '<span class="pill-label">Nessun dato backup</span>';
    }

    updateFooterStatus({ healthy = null, message = null } = {}) {
        const connectionDot = document.getElementById('connectionStatus');
        const connectionText = document.getElementById('connectionStatusText');

        if (healthy !== null && connectionDot && connectionText) {
            connectionDot.classList.remove('error', 'success');
            connectionDot.classList.add(healthy ? 'success' : 'error');
            connectionText.textContent = healthy ? (message || 'Backend online') : (message || 'Backend offline');
        }

        if (message !== null && connectionText) {
            connectionText.textContent = message;
        }
    }

    buildLogEntriesFromRuns(runs = []) {
        const logEntries = [];

        runs.forEach(run => {
            const runTime = new Date(run.start || run.end).toLocaleString('it-IT', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });

            if (run.errors && run.errors.length > 0) {
                run.errors.forEach(error => {
                    logEntries.push({
                        type: 'error',
                        time: runTime,
                        message: error.message || error,
                        path: error.path || error.affected_path || '',
                        job_id: run.job_id,
                        timestamp: new Date(error.timestamp || run.start).getTime()
                    });
                });
            }

            if (run.skipped_files && run.skipped_files.length > 0) {
                run.skipped_files.forEach(skipped => {
                    const skippedPath = typeof skipped === 'string'
                        ? skipped
                        : (skipped.path || skipped.affected_path || '');
                    const skippedMessage = typeof skipped === 'string'
                        ? 'File non copiato'
                        : (skipped.message || 'File saltato');

                    logEntries.push({
                        type: 'warning',
                        time: runTime,
                        message: skippedMessage,
                        path: skippedPath,
                        job_id: run.job_id,
                        timestamp: new Date(run.start).getTime()
                    });
                });
            }

            if (this.normalizeRunStatus(run.status) === 'failure' && (!run.errors || run.errors.length === 0)) {
                logEntries.push({
                    type: 'error',
                    time: runTime,
                    message: run.error_message || 'Backup fallito',
                    path: run.target_path || '',
                    job_id: run.job_id,
                    timestamp: new Date(run.start).getTime()
                });
            }
        });

        logEntries.sort((a, b) => b.timestamp - a.timestamp);
        return logEntries;
    }

    closeLogViewer() {
        const modal = document.getElementById('logViewerModal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    renderJobEditor() {
        const emptyState = document.getElementById('jobEditorEmpty');
        const form = document.getElementById('jobEditorForm');
        const errorDiv = document.getElementById('jobFormError');
        const cancelBtn = document.getElementById('cancelJobBtn');

        if (cancelBtn) {
            cancelBtn.style.display = this.isNewJob ? 'inline-flex' : 'none';
        }

        if (!this.editingJob) {
            form.classList.add('hidden');
            emptyState.classList.remove('hidden');
            if (cancelBtn) cancelBtn.style.display = 'none';
            return;
        }

        emptyState.classList.add('hidden');
        form.classList.remove('hidden');
        errorDiv.textContent = '';

        document.getElementById('jobIdField').value = this.editingJob.job_id;
        document.getElementById('jobIdField').disabled = !this.isNewJob;
        document.getElementById('jobEnabledToggle').checked = this.editingJob.enabled !== false;
        document.getElementById('jobClientName').textContent = this.editingJob.client_hostname || this.selectedClient;

        const scheduleDays = this.editingJob.schedule?.days || [];
        document.querySelectorAll('#scheduleDays input[type="checkbox"]').forEach(cb => {
            cb.checked = scheduleDays.includes(parseInt(cb.value));
        });

        const timesContainer = document.getElementById('scheduleTimes');
        const scheduleTimes = this.editingJob.schedule?.times || [];
        timesContainer.innerHTML = scheduleTimes.map((t, idx) => `
            <span class="time-chip">${this.escapeHtml(t)} <button type="button" onclick="app.removeScheduleTime(${idx})">\u00D7</button></span>
        `).join('');

        const mappingsContainer = document.getElementById('mappingsContainer');
        mappingsContainer.innerHTML = this.editingJob.mappings.map((mapping, index) => {
            const isCopy = (mapping.mode || this.editingJob.mode_default || 'copy') === 'copy';
            return `
                    <div class="mapping-card">
                        <div class="mapping-header">
                            <div class="mapping-title">Mappatura ${index + 1}${mapping.label ? ` - ${this.escapeHtml(mapping.label)}` : ''}</div>
                            <button type="button" class="btn btn-icon btn-small" onclick="app.removeMapping(${index})" title="Rimuovi mappatura">\u2715</button>
                        </div>
                        <div class="form-row">
                            <label>Etichetta</label>
                            <input type="text" value="${this.escapeForAttribute(mapping.label || '')}"
                                   oninput="app.updateMappingField(${index}, 'label', this.value)"
                                   placeholder="es. Documenti utente">
                        </div>
                        <div class="form-row">
                            <label>Percorso sorgente</label>
                            <div class="path-input">
                                <input type="text" value="${this.escapeForAttribute(mapping.source_path || '')}"
                                       oninput="app.updateMappingField(${index}, 'source_path', this.value)"
                                       placeholder="es. C:\\Users\\Documents">
                                <button type="button" class="btn btn-outline btn-small" onclick="app.openBrowseModal(${index})">Sfoglia</button>
                            </div>
                        </div>
                        <div class="form-row">
                            <label>Percorso destinazione</label>
                            <input type="text" value="${this.escapeForAttribute(mapping.destination_path || '')}"
                                   oninput="app.updateMappingField(${index}, 'destination_path', this.value)"
                                   placeholder="es. \\NAS\\Backups\\Documents">
                        </div>
                        <div class="form-row">
                            <label>Modalita</label>
                            <select onchange="app.handleMappingModeChange(${index}, this.value)">
                                <option value="copy" ${mapping.mode === 'copy' ? 'selected' : ''}>Copy (versioni multiple)</option>
                                <option value="sync" ${mapping.mode === 'sync' ? 'selected' : ''}>Sync (sovrascrittura)</option>
                            </select>
                        </div>
                        <div class="form-row retention-row ${isCopy ? '' : 'hidden'}">
                            <label>Retention (max versioni)</label>
                            <input type="number" min="1" max="100" value="${mapping.retention?.max_backups || 5}"
                                   oninput="app.updateMappingField(${index}, 'retention', this.value)">
                        </div>
                        <div class="form-row">
                            <label>Credenziali NAS/SMB (opzionale)</label>
                            <div class="credentials-grid">
                                <input type="text" placeholder="Username"
                                       value="${this.escapeForAttribute(mapping.credentials?.username || '')}"
                                       oninput="app.updateMappingCredential(${index}, 'username', this.value)">
                                <input type="password" placeholder="Password"
                                       value="${this.escapeForAttribute(mapping.credentials?.password || '')}"
                                       oninput="app.updateMappingCredential(${index}, 'password', this.value)">
                                <input type="text" placeholder="Dominio"
                                       value="${this.escapeForAttribute(mapping.credentials?.domain || '')}"
                                       oninput="app.updateMappingCredential(${index}, 'domain', this.value)">
                            </div>
                        </div>
                        <div class="mapping-actions-row">
                            <button type="button" class="btn btn-outline btn-small" onclick="app.openLogViewer(${index})">Log completi</button>
                        </div>
                    </div>
                `;
        }).join('');

    }

    addScheduleTime() {
        if (!this.editingJob) return;
        if (!this.editingJob.schedule) {
            this.editingJob.schedule = { type: 'daily', days: [1, 2, 3, 4, 5], times: [] };
        }

        const timeInput = document.getElementById('newScheduleTime');
        const newTime = timeInput.value;
        const times = this.editingJob.schedule.times || [];

        if (newTime && !times.includes(newTime)) {
            times.push(newTime);
            times.sort();
            this.editingJob.schedule.times = times;
            this.renderJobEditor();
            this.renderJobsList();
        }
    }

    removeScheduleTime(index) {
        if (!this.editingJob) return;
        this.editingJob.schedule.times.splice(index, 1);
        this.renderJobEditor();
        this.renderJobsList();
    }

    addMapping() {
        if (!this.editingJob) return;
        this.editingJob.mappings.push(this.createEmptyMapping());
        this.renderJobEditor();
        this.renderJobsList();
    }

    removeMapping(index) {
        if (!this.editingJob) return;
        this.editingJob.mappings.splice(index, 1);
        if (this.editingJob.mappings.length === 0) {
            this.editingJob.mappings.push(this.createEmptyMapping());
        }
        this.renderJobEditor();
        this.renderJobsList();
    }

    updateMappingField(index, field, value) {
        if (!this.editingJob?.mappings[index]) return;
        if (field === 'retention') {
            const parsed = parseInt(value, 10);
            this.editingJob.mappings[index].retention = { max_backups: parsed > 0 ? parsed : 1 };
        } else {
            this.editingJob.mappings[index][field] = value;
        }
        this.renderJobsList();
    }

    updateMappingCredential(index, field, value) {
        if (!this.editingJob?.mappings[index]) return;
        if (!this.editingJob.mappings[index].credentials) {
            this.editingJob.mappings[index].credentials = { type: 'nas', username: '', password: '', domain: '' };
        }
        this.editingJob.mappings[index].credentials[field] = value;
        this.renderJobsList();
    }

    handleMappingModeChange(index, mode) {
        if (!this.editingJob?.mappings[index]) return;
        this.editingJob.mappings[index].mode = mode;
        if (mode !== 'copy') {
            delete this.editingJob.mappings[index].retention;
        } else if (!this.editingJob.mappings[index].retention) {
            this.editingJob.mappings[index].retention = { max_backups: 5 };
        }
        this.renderJobEditor();
        this.renderJobsList();
    }

    async handleSaveJob() {
        if (!this.editingJob) return;

        const saveBtn = this.getButtonByText('Salva');
        const errorDiv = document.getElementById('jobFormError');
        const jobId = document.getElementById('jobIdField').value.trim();

        this.setButtonLoading(saveBtn, true);

        if (!jobId) {
            errorDiv.textContent = 'Job ID obbligatorio';
            this.setButtonLoading(saveBtn, false);
            return;
        }

        const selectedDays = Array.from(document.querySelectorAll('#scheduleDays input[type="checkbox"]:checked')).map(cb => parseInt(cb.value));
        const scheduleTimes = this.editingJob.schedule?.times || [];

        if (selectedDays.length === 0) {
            errorDiv.textContent = 'Seleziona almeno un giorno della settimana';
            this.setButtonLoading(saveBtn, false);
            return;
        }

        if (scheduleTimes.length === 0) {
            errorDiv.textContent = 'Aggiungi almeno un orario di esecuzione';
            this.setButtonLoading(saveBtn, false);
            return;
        }

        const mappingsValid = this.editingJob.mappings.every(m => m.source_path && m.destination_path);
        if (!mappingsValid) {
            errorDiv.textContent = 'Compila tutti i percorsi sorgente e destinazione';
            this.setButtonLoading(saveBtn, false);
            return;
        }

        const payload = {
            job_id: jobId,
            client_hostname: this.selectedClient,
            enabled: document.getElementById('jobEnabledToggle').checked,
            mode_default: this.editingJob.mode_default || 'copy',
            schedule: {
                type: 'daily',
                days: selectedDays,
                times: scheduleTimes
            },
            mappings: this.editingJob.mappings.map(m => ({
                label: m.label || '',
                source_path: m.source_path,
                destination_path: m.destination_path,
                mode: m.mode || this.editingJob.mode_default || 'copy',
                retention: (m.mode || this.editingJob.mode_default || 'copy') === 'copy'
                    ? { max_backups: m.retention?.max_backups || 5 }
                    : undefined,
                credentials: m.credentials?.username
                    ? m.credentials
                    : undefined
            }))
        };

        const existing = this.jobs.find(j => j.job_id === jobId);
        const method = existing ? 'PUT' : 'POST';
        const url = existing
            ? `/api/jobs/${encodeURIComponent(jobId)}`
            : `/api/clients/${encodeURIComponent(this.selectedClient)}/jobs`;

        try {
            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (response.ok) {
                this.isNewJob = false;
                await this.loadClientJobs();
                this.editJob(jobId);
                this.updateClientSummary();
                errorDiv.textContent = '';
                this.showToast('success', 'Job salvato', `Il job ${jobId} è stato salvato`);
            } else {
                errorDiv.textContent = data.error || 'Errore salvataggio job';
                this.showToast('error', 'Errore', data.error || 'Impossibile salvare il job');
            }
        } catch (error) {
            console.error('Errore salvataggio job:', error);
            errorDiv.textContent = 'Errore di connessione al server';
            this.showToast('error', 'Errore', 'Errore di connessione al server');
        } finally {
            this.setButtonLoading(saveBtn, false);
        }
    }

    async deleteEditingJob() {
        if (!this.editingJob || this.isNewJob) {
            this.showToast('warning', 'Attenzione', 'Nessun job selezionato da eliminare');
            return;
        }

        const jobId = this.editingJob.job_id;
        if (!confirm(`Eliminare il job "${jobId}"?`)) {
            return;
        }

        try {
            const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.showToast('success', 'Job eliminato', `Il job ${jobId} è stato eliminato`);
                this.editingJob = null;
                await this.loadClientJobs();
                this.updateClientSummary();
                this.renderJobEditor();
            } else {
                this.showToast('error', 'Errore', data.error || 'Impossibile eliminare il job');
            }
        } catch (error) {
            console.error('Errore eliminazione job:', error);
            this.showToast('error', 'Errore', 'Errore di connessione al server');
        }
    }

    async runJob(jobId) {
        if (!confirm(`Eseguire il job "${jobId}" adesso?`)) {
            return;
        }

        try {
            const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/run`, { method: 'POST' });
            const data = await response.json();

            if (response.ok) {
                this.showToast('info', 'Backup avviato', `Il backup per ${jobId} è stato avviato. Controlla lo storico per il risultato.`);
                await Promise.all([
                    this.loadClientRuns(),
                    this.loadClients(),
                    this.loadHeaderStats()
                ]);
                this.updateClientSummary();
                this.showTab('runs');
                setTimeout(() => {
                    this.loadClients();
                    this.loadHeaderStats();
                }, 2000);
            } else {
                if (data.error?.includes('già in esecuzione') || response.status === 409) {
                    this.showToast('warning', 'Job in corso', `Il job ${jobId} è già in esecuzione`);
                } else {
                    this.showToast('error', 'Errore', data.error || 'Impossibile avviare il job');
                }
            }
        } catch (error) {
            console.error('Errore esecuzione job:', error);
            this.showToast('error', 'Errore', 'Errore di connessione al server');
        }
    }

    runEditingJob() {
        if (!this.editingJob) {
            this.showToast('warning', 'Attenzione', 'Nessun job selezionato');
            return;
        }
        if (this.isNewJob) {
            this.showToast('warning', 'Attenzione', 'Salva prima il job per poterlo eseguire');
            return;
        }
        this.runJob(this.editingJob.job_id);
    }

    async runAllJobsForClient() {
        if (!this.selectedClient) return;

        const enabledJobs = this.jobs.filter(j => j.enabled);
        if (enabledJobs.length === 0) {
            this.showToast('warning', 'Attenzione', 'Nessun job attivo da eseguire');
            return;
        }

        if (!confirm(`Eseguire tutti i ${enabledJobs.length} job attivi per ${this.selectedClient}?`)) {
            return;
        }

        const runAllBtn = this.getButtonByText('Esegui Tutti');
        this.setButtonLoading(runAllBtn, true);

        let started = 0;
        let failed = 0;

        try {
            for (const job of enabledJobs) {
                try {
                    const response = await fetch(`/api/jobs/${encodeURIComponent(job.job_id)}/run`, { method: 'POST' });
                    if (response.ok) {
                        started++;
                    } else {
                        failed++;
                    }
                } catch (error) {
                    console.error(`Errore esecuzione job ${job.job_id}:`, error);
                    failed++;
                }
            }

            if (failed === 0) {
                this.showToast('info', 'Backup avviati', `${started} backup avviati. Controlla lo storico per i risultati.`);
            } else {
                this.showToast('warning', 'Avvio parziale', `${started} backup avviati, ${failed} non avviati. Controlla lo storico.`);
            }

            await Promise.all([
                this.loadClientRuns(),
                this.loadClients(),
                this.loadHeaderStats()
            ]);
            this.updateClientSummary();
            this.showTab('runs');
            setTimeout(() => {
                this.loadClients();
                this.loadHeaderStats();
            }, 2000);
        } finally {
            this.setButtonLoading(runAllBtn, false);
        }
    }

    async loadClientRuns() {
        if (!this.selectedClient) return;

        try {
            const response = await fetch(`/api/runs?client=${encodeURIComponent(this.selectedClient)}`);
            if (response.ok) {
                const runs = await response.json();
                this.runs = runs
                    .filter(r => r.client_hostname === this.selectedClient)
                    .sort((a, b) => new Date(b.start) - new Date(a.start));
                this.renderRunsList();
                this.updateClientSummary();
                this.selectedClientRunsLoaded = true;
            }
        } catch (error) {
            console.error('Errore caricamento runs:', error);
        }
    }

    renderRunsList() {
        const container = document.getElementById('runsList');
        const maxRunsToShow = 10;

        if (this.runs.length === 0) {
            container.innerHTML = '<div class="info-message">Nessuna esecuzione disponibile</div>';
            return;
        }

        const limitedNotice = this.runs.length > maxRunsToShow
            ? '<div class="info-message">Mostrati ultimi 10 log. Usa "Log completi" per vedere lo storico completo.</div>'
            : '';

        container.innerHTML = limitedNotice + this.runs.slice(0, maxRunsToShow).map(run => {
            const duration = run.end
                ? `${Math.round((new Date(run.end) - new Date(run.start)) / 1000)}s`
                : 'In corso...';

            const normalizedStatus = this.deriveRunStatus(run);
            let statusClass = normalizedStatus;
            let statusLabel = normalizedStatus || 'Sconosciuto';

            if (normalizedStatus === 'success') {
                statusLabel = 'Successo';
                statusClass = 'success';
            } else if (normalizedStatus === 'failure') {
                statusLabel = 'Fallito';
                statusClass = 'failure';
            } else if (normalizedStatus === 'partial') {
                statusLabel = 'Parziale';
                statusClass = 'partial';
            } else if (normalizedStatus === 'running') {
                statusLabel = 'In corso';
            }

            const hasErrors = run.errors && run.errors.length > 0;
            const errorMsg = hasErrors ? run.errors[0].message : '';

            let totalFiles = 0;
            let copiedFiles = 0;
            let skippedFiles = 0;
            let failedFiles = 0;
            let totalSize = run.bytes_processed || 0;
            const skippedFilesList = Array.isArray(run.skipped_files)
                ? run.skipped_files.filter(Boolean)
                : [];

            if (run.mappings && run.mappings.length > 0) {
                run.mappings.forEach(m => {
                    if (m.stats) {
                        totalFiles += m.stats.total_files || 0;
                        copiedFiles += m.stats.copied_files || 0;
                        skippedFiles += m.stats.skipped_files || 0;
                        failedFiles += m.stats.failed_files || 0;
                    }
                });
            }

            const retentionEntries = [];
            if (run.mappings && run.mappings.length > 0) {
                run.mappings.forEach((m, index) => {
                    const mode = (m.mode || run.mode_default || 'copy');
                    if (mode !== 'copy') return;

                    const hasRetention = m.retention && m.retention.max_backups > 0;
                    if (!hasRetention) return;

                    const label = this.escapeHtml(m.label || m.source_path || m.destination_path || 'Copia');
                    retentionEntries.push(`
                        <div class="run-retention-item">
                            <div class="run-retention-header">${label}</div>
                            <div class="run-retention-meta">Retention configurata: max ${m.retention.max_backups} backup</div>
                            <div class="run-retention-load">
                                <button class="btn-secondary" onclick="app.loadRetentionEvents('${this.escapeHtml(run.job_id)}', '${this.escapeHtml(run.run_id)}', ${index})">
                                    Carica eventi retention
                                </button>
                            </div>
                            <div id="retention-events-${this.escapeHtml(run.run_id)}-${index}" class="run-retention-list" style="display:none;"></div>
                        </div>
                    `);
                });
            }

            if (run.stats) {
                if (totalFiles === 0) totalFiles = run.stats.total_files || 0;
                if (copiedFiles === 0) copiedFiles = run.stats.copied_files || 0;
                if (skippedFiles === 0) skippedFiles = run.stats.skipped_files || 0;
                if (failedFiles === 0) failedFiles = run.stats.failed_files || 0;
            }

            const hasFileStats = (run.stats && typeof run.stats.total_files !== 'undefined') ||
                totalFiles > 0 || copiedFiles > 0 || skippedFiles > 0 || failedFiles > 0;

            const maxSkippedToShow = 5;
            const skippedPreview = skippedFilesList.slice(0, maxSkippedToShow);
            const skippedListHtml = skippedPreview.map(item => {
                const label = typeof item === 'string'
                    ? item
                    : (item.path || item.affected_path || item.message || 'Percorso non disponibile');
                return `<li title="${this.escapeHtml(label)}">${this.escapeHtml(label)}</li>`;
            }).join('');
            const skippedMore = skippedFilesList.length > maxSkippedToShow
                ? `<div class="run-skipped-more">... altri ${skippedFilesList.length - maxSkippedToShow} file</div>`
                : '';
            const skippedSection = skippedFilesList.length > 0 ? `
                <div class="run-skipped">
                    <span class="run-info-label">File non copiati</span>
                    <div>
                        <ul class="run-skipped-list">${skippedListHtml}</ul>
                        ${skippedMore}
                    </div>
                </div>
            ` : '';

            const retentionSection = retentionEntries.length > 0 ? `
                <div class="run-retention">
                    <span class="run-info-label">Retention</span>
                    <div class="run-retention-details">${retentionEntries.join('')}</div>
                </div>
            ` : '';

            const mappingModes = new Set();
            const mappingDetails = Array.isArray(run.mappings) && run.mappings.length > 0
                ? run.mappings.map(m => {
                    const mode = (m.mode || run.mode_default || 'copy').toLowerCase();
                    mappingModes.add(mode.toUpperCase());
                    const status = this.normalizeRunStatus(m.status) || 'unknown';
                    const statusClass = status === 'failure' ? 'failed' : status;
                    const stats = m.stats || {};
                    const statsBits = [];
                    if (Number.isFinite(stats.copied_files)) statsBits.push(`${stats.copied_files} copiati`);
                    if (Number.isFinite(stats.updated_files) && stats.updated_files > 0) statsBits.push(`${stats.updated_files} aggiornati`);
                    if (Number.isFinite(stats.skipped_files) && stats.skipped_files > 0) statsBits.push(`${stats.skipped_files} saltati`);
                    if (Number.isFinite(stats.failed_files) && stats.failed_files > 0) statsBits.push(`${stats.failed_files} falliti`);
                    const pathLabel = [m.source_path, m.target_path || m.destination_path]
                        .filter(Boolean)
                        .map(p => this.escapeHtml(p))
                        .join(' → ');
                    const firstError = (m.errors || []).find(Boolean);

                    return `
                        <div class="run-mapping">
                            <div class="run-mapping-header">
                                <div class="run-mapping-title">
                                    <span>${this.escapeHtml(m.label || `Mappatura ${m.index + 1 || 1}`)}</span>
                                    <span class="mapping-mode ${mode}">${mode.toUpperCase()}</span>
                                </div>
                                <span class="mapping-status ${statusClass}">${statusLabelFor(statusClass)}</span>
                            </div>
                            ${pathLabel ? `<div class="mapping-path">${pathLabel}</div>` : ''}
                            <div class="mapping-stats">${statsBits.length ? statsBits.join(' · ') : 'Nessuna statistica disponibile'}</div>
                            ${firstError ? `<div class="mapping-errors">${this.escapeHtml(firstError)}</div>` : ''}
                        </div>
                    `;
                }).join('')
                : '';

            const mappingsSection = mappingDetails
                ? `<div class="run-mappings">${mappingDetails}</div>`
                : '';

            const modeLabel = mappingModes.size > 0
                ? Array.from(mappingModes).join(', ')
                : (run.mode_default || 'copy').toUpperCase();

            const destinations = Array.isArray(run.mappings)
                ? run.mappings
                    .map(m => m.target_path || m.destination_path)
                    .filter(Boolean)
                : [];
            const uniqueDestinations = [...new Set(destinations)];
            const destinationHtml = uniqueDestinations.length > 0
                ? uniqueDestinations.map(dest => `<div class="run-destination-entry">${this.escapeHtml(dest)}</div>`).join('')
                : (run.target_path ? `<div class="run-destination-entry">${this.escapeHtml(run.target_path)}</div>` : '');

            return `
                <div class="run-card">
                    <div class="run-header">
                        <div>
                            <div class="run-id">${this.escapeHtml(run.job_id)}</div>
                            <div class="run-date">${new Date(run.start).toLocaleString('it-IT')}</div>
                        </div>
                        <span class="status-badge ${statusClass}">${statusLabel}</span>
                    </div>
                    <div class="run-info">
                        <span class="run-info-label">Durata:</span>
                        <span>${duration}</span>
                        <span class="run-info-label">Modalità:</span>
                        <span>${this.escapeHtml(modeLabel)}</span>
                        <span class="run-info-label">Dimensione:</span>
                        <span>${this.formatBytes(totalSize)}</span>
                        ${hasFileStats ? `
                            <span class="run-info-label">File:</span>
                            <span>${copiedFiles}/${totalFiles} copiati${skippedFiles > 0 ? `, ${skippedFiles} saltati` : ''}${failedFiles > 0 ? `, ${failedFiles} falliti` : ''}</span>
                        ` : ''}
                        ${destinationHtml ? `
                            <span class="run-info-label">Dest:</span>
                            <span class="run-destinations">${destinationHtml}</span>
                        ` : ''}
                        ${hasErrors ? `
                            <span class="run-info-label">Errore:</span>
                            <span style="color: var(--error-color);">${this.escapeHtml(errorMsg)}</span>
                        ` : ''}
                    </div>
                    ${retentionSection}
                    ${mappingsSection}
                    ${skippedSection}
                </div>
            `;
        }).join('');

        function statusLabelFor(state) {
            if (state === 'success') return 'Successo';
            if (state === 'partial') return 'Parziale';
            if (state === 'running') return 'In corso';
            if (state === 'failed') return 'Fallito';
            return state || 'Sconosciuto';
        }
    }

    async loadRetentionEvents(jobId, runId, mappingIndex) {
        try {
            const container = document.getElementById(`retention-events-${runId}-${mappingIndex}`);
            if (!container) return;

            container.innerHTML = '<div class="info-message">Caricamento...</div>';
            container.style.display = 'block';

            const hostname = this.selectedClient?.hostname || this.selectedClient;
            const response = await fetch(`/api/clients/${hostname}/jobs/${jobId}/retention/events?runId=${runId}`);
            const data = await response.json();

            if (!response.ok) {
                container.innerHTML = `<div class="error-message">Errore: ${data.error || 'Impossibile caricare eventi'}</div>`;
                return;
            }

            const events = data.events || [];
            if (events.length === 0) {
                container.innerHTML = '<div class="run-retention-note">Nessun evento di retention per questo run</div>';
                return;
            }

            const eventsList = events.map(e => {
                const timestamp = e.timestamp ? new Date(e.timestamp).toLocaleString('it-IT') : 'N/A';
                const status = e.success ? 'deleted' : 'failed';
                const reason = e.reason === 'slot_rotation' ? '(rotazione slot)' : '';
                return `
                    <li class="run-retention-entry ${status}">
                        <span class="run-retention-path">${this.escapeHtml(e.path || 'Percorso non disponibile')} ${reason}</span>
                        <span class="run-retention-time">${timestamp}</span>
                        ${!e.success && e.error ? `<span class="run-retention-error">Errore: ${this.escapeHtml(e.error)}</span>` : ''}
                    </li>
                `;
            }).join('');

            container.innerHTML = `<ul>${eventsList}</ul>`;
        } catch (error) {
            const container = document.getElementById(`retention-events-${runId}-${mappingIndex}`);
            if (container) {
                container.innerHTML = `<div class="error-message">Errore caricamento: ${error.message}</div>`;
                container.style.display = 'block';
            }
        }
    }

    formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    showTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach((btn, index) => {
            btn.classList.remove('active');
            if ((tabName === 'jobs' && index === 0) || (tabName === 'runs' && index === 1)) {
                btn.classList.add('active');
            }
        });

        document.getElementById('jobsTab').classList.toggle('hidden', tabName !== 'jobs');
        document.getElementById('runsTab').classList.toggle('hidden', tabName !== 'runs');

        if (tabName === 'runs' && this.runs.length === 0) {
            this.loadClientRuns();
        }
    }

    updateClientSummary() {
        if (!this.selectedClient) return;

        const activeJobs = this.jobs.filter(j => j.enabled).length;
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
            summaryLastBackup.className = 'summary-value ' +
                (lastRun.status === 'success' ? 'success' : 'failure');
        } else {
            summaryLastBackup.textContent = 'Mai';
            summaryLastBackup.className = 'summary-value';
        }

        document.getElementById('summaryTotalRuns').textContent = totalRuns;
    }

    openBrowseModal(mappingIndex) {
        const client = this.clients.find(c => c.hostname === this.selectedClient);
        if (!client?.online) {
            this.showToast('warning', 'Client offline', 'Impossibile sfogliare il filesystem di un client offline');
            return;
        }

        this.browseMappingIndex = mappingIndex;
        this.currentFsPath = '';
        this.selectedFsEntry = null;
        this.selectedFsType = null;
        this.loadFilesystemEntries('');
        document.getElementById('filesystemModal').classList.remove('hidden');
    }

    closeFilesystemModal() {
        document.getElementById('filesystemModal').classList.add('hidden');
        this.browseMappingIndex = null;
    }

    async loadFilesystemEntries(path = '') {
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

            fsEntries.innerHTML = entries.map(entry => {
                const icon = entry.type === 'drive' ? '\uD83D\uDCBD' :
                    entry.type === 'file' ? '\uD83D\uDCC4' : '\uD83D\uDCC1';
                const isSelected = this.selectedFsEntry === entry.path;

                return `
                    <div class="filesystem-entry ${isSelected ? 'selected' : ''}"
                         onclick="app.handleFsEntryClick(event, '${this.escapeForAttribute(entry.path)}', '${entry.type}')">
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
    }

    handleFsEntryClick(event, path, type) {
        this.selectedFsEntry = path;
        this.selectedFsType = type;

        document.querySelectorAll('#fsEntries .filesystem-entry').forEach(el => {
            el.classList.remove('selected');
        });
        event.currentTarget.classList.add('selected');

        const selectBtn = document.getElementById('fsSelectBtn');
        selectBtn.textContent = type === 'file' ? 'Seleziona file' : 'Seleziona cartella';
    }

    navigateFilesystem(path) {
        this.selectedFsEntry = null;
        this.selectedFsType = null;
        this.loadFilesystemEntries(path);
    }

    navigateFilesystemUp() {
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
    }

    selectFilesystemPath(path) {
        if (this.browseMappingIndex === null || !this.editingJob) return;
        this.editingJob.mappings[this.browseMappingIndex].source_path = path;
        this.renderJobEditor();
        this.closeFilesystemModal();
    }

    selectCurrentPath() {
        const path = this.selectedFsEntry || this.currentFsPath;
        if (!path) {
            this.showToast('warning', 'Attenzione', 'Seleziona un elemento o naviga in una cartella');
            return;
        }
        this.selectFilesystemPath(path);
    }

    escapeForAttribute(str) {
        if (!str) return '';
        return str
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/"/g, '&quot;');
    }

    async resetBackupStatus(hostname) {
        if (!confirm(`Resettare lo stato backup di "${hostname}"?\n\nATTENZIONE: Questo pulisce solo lo stato UI, non ferma il backup reale sull'agent.`)) {
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
    }

    async resetPassword() {
        const newPassword = prompt('Inserisci la nuova password (min 8 caratteri):');
        if (!newPassword) return;

        if (newPassword.length < 8) {
            this.showToast('error', 'Errore', 'La password deve essere di almeno 8 caratteri');
            return;
        }

        const confirmPassword = prompt('Conferma la nuova password:');
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
                this.showToast('success', 'Password aggiornata', 'La password è stata modificata con successo');
            } else {
                this.showToast('error', 'Errore', data.error || 'Impossibile resettare la password');
            }
        } catch (error) {
            console.error('Errore reset password:', error);
            this.showToast('error', 'Errore', 'Errore di connessione al server');
        }
    }

    async exportConfig() {
        // Mostra dialog con checkbox per selezionare sezioni
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
    }

    showExportDialog() {
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
                const sections = Array.from(checkboxes).map(cb => cb.value);
                document.body.removeChild(modal);
                resolve(sections);
            };
        });
    }

    async importConfig() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const text = await file.text();
                const config = JSON.parse(text);

                // Mostra dialog con checkbox per selezionare sezioni da importare
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
    }

    showImportDialog(config, availableSections) {
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
                        ⚠️ Gli elementi esistenti con lo stesso ID verranno sovrascritti
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
                const sections = Array.from(checkboxes).map(cb => cb.value);
                document.body.removeChild(modal);
                resolve(sections);
            };
        });
    }

    filterClients(searchTerm) {
        const items = document.querySelectorAll('.client-item');
        const term = searchTerm.toLowerCase().trim();

        items.forEach(item => {
            const hostname = item.querySelector('.client-name')?.textContent.toLowerCase() || '';
            if (hostname.includes(term)) {
                item.style.display = '';
            } else {
                item.style.display = 'none';
            }
        });
    }

    async refreshClients() {
        await Promise.all([this.loadClients(), this.loadHeaderStats()]);
        if (this.selectedClient) {
            await this.loadClientJobs();
            await this.loadClientRuns();
            this.updateClientSummary();
        }
        this.showToast('info', 'Aggiornato', 'Dati aggiornati');
    }

    async deleteAllLogs() {
        if (!confirm('Sei sicuro di voler eliminare TUTTI i log di TUTTI i PC?\n\nQuesta operazione è IRREVERSIBILE.\n\nI job non verranno eliminati, solo lo storico delle esecuzioni.')) {
            return;
        }

        const secondConfirm = confirm('ULTIMA CONFERMA: Eliminare tutti i log di tutti i PC?\n\nVerranno eliminati tutti i record di backup eseguiti.\nLa configurazione dei job rimarrà intatta.');
        if (!secondConfirm) {
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
    }
}

const app = new OnlyBackupApp();
