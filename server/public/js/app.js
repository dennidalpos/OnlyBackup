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
                this.showToast('success', 'Password aggiornata', 'La password Ã¨ stata modificata con successo');
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
                backupIcon = '<span class="backup-status-icon running" title="Backup in corso">â—</span>';
            } else if (client.backup_status === 'partial') {
                backupIcon = '<span class="backup-status-icon partial" title="Backup parziale">â—</span>';
            } else if (client.backup_status === 'completed') {
                backupIcon = '<span class="backup-status-icon success" title="Backup completato">âœ“</span>';
            } else if (client.backup_status === 'failed') {
                backupIcon = '<span class="backup-status-icon failure" title="Backup fallito">âœ—</span>';
            } else if (client.lastBackupRun) {
                if (client.lastBackupRun.status === 'success') {
                    backupIcon = '<span class="backup-status-icon success" title="Ultimo backup riuscito">âœ“</span>';
                } else if (client.lastBackupRun.status === 'failure') {
                    backupIcon = '<span class="backup-status-icon failure" title="Ultimo backup fallito">âœ—</span>';
                } else if (client.lastBackupRun.status === 'partial') {
                    backupIcon = '<span class="backup-status-icon partial" title="Ultimo backup parziale">â—</span>';
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
                                title="Resetta stato backup (non ferma il backup reale)">â¹</button>
                    ` : ''}
                    <button class="btn btn-icon btn-danger btn-small"
                            onclick="event.stopPropagation(); app.showDeregisterDialog('${this.escapeForAttribute(client.hostname)}')"
                            title="Deregistra PC">Ã—</button>
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
        const message = `Sei sicuro di voler deregistrare il PC ${this.escapeHtml(hostname)}? Questa azione eliminerÃ  tutti i job, run, log e dati associati al client.`;
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
                this.showToast('success', 'Client deregistrato', `${hostname} Ã¨ stato deregistrato`);
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
                this.showToast('success', 'Client deregistrato', `${hostname} Ã¨ stato deregistrato`);
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
                this.showToast('success', 'Password aggiornata', 'La password Ã¨ stata modificata con successo');
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
                        âš ï¸ Gli elementi esistenti con lo stesso ID verranno sovrascritti
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
        if (!confirm('Sei sicuro di voler eliminare TUTTI i log di TUTTI i PC?\n\nQuesta operazione Ã¨ IRREVERSIBILE.\n\nI job non verranno eliminati, solo lo storico delle esecuzioni.')) {
            return;
        }

        const secondConfirm = confirm('ULTIMA CONFERMA: Eliminare tutti i log di tutti i PC?\n\nVerranno eliminati tutti i record di backup eseguiti.\nLa configurazione dei job rimarrÃ  intatta.');
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

window.OnlyBackupApp = OnlyBackupApp;
