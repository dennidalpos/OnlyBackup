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
        this.clientsPollingInterval = null;  // Polling per aggiornare stato client
        this.init();
    }

    async init() {
        this.setupEventListeners();
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
            }
        });
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

                if (data.mustChangePassword) {
                    this.showScreen('changePasswordScreen');
                } else {
                    this.showDashboard();
                }
            } else {
                this.showPublicStats();
            }
        } catch (error) {
            console.error('Errore verifica autenticazione:', error);
            this.showPublicStats();
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
            this.showPublicStats();
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
    }

    showLogin() {
        this.showScreen('loginScreen');
    }

    async showPublicStats() {
        this.showScreen('publicStatsScreen');
        await this.loadPublicStats();
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
        }
        this.statsInterval = setInterval(() => this.loadPublicStats(), 30000);
    }

    async loadPublicStats() {
        try {
            const response = await fetch('/api/public/stats');
            if (response.ok) {
                const data = await response.json();
                document.getElementById('backupsOk').textContent = data.backups_ok_24h;
                document.getElementById('backupsFailed').textContent = data.backups_failed_24h;
                document.getElementById('clientsOnline').textContent = data.clients_online;
                document.getElementById('clientsOffline').textContent = data.clients_offline;
            }
        } catch (error) {
            console.error('Errore caricamento stats pubbliche:', error);
        }
    }

    async showDashboard() {
        this.showScreen('mainDashboard');
        document.getElementById('currentUser').textContent = this.currentUser;
        await Promise.all([this.loadClients(), this.loadHeaderStats()]);

        // Avvia polling per aggiornare stats header ogni 30 secondi
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
        }
        this.statsInterval = setInterval(() => this.loadHeaderStats(), 30000);

        // Avvia polling per aggiornare stato client ogni 5 secondi
        if (this.clientsPollingInterval) {
            clearInterval(this.clientsPollingInterval);
        }
        this.clientsPollingInterval = setInterval(() => this.loadClients(), 5000);
    }

    async loadHeaderStats() {
        try {
            const response = await fetch('/api/public/stats');
            if (response.ok) {
                const data = await response.json();
                document.getElementById('headerClientsOnline').textContent = data.clients_online;
                document.getElementById('headerClientsOffline').textContent = data.clients_offline;
                document.getElementById('headerBackupsOk').textContent = data.backups_ok_24h;
                document.getElementById('headerBackupsFailed').textContent = data.backups_failed_24h;
            }
        } catch (error) {
            console.error('Errore caricamento stats header:', error);
        }
    }

    async loadClients() {
        try {
            const response = await fetch('/api/clients');
            if (response.ok) {
                this.clients = await response.json();

                // Debug: mostra tutti i client con backup_status
                console.log('=== CLIENTS LOADED ===');
                this.clients.forEach(c => {
                    if (c.backup_status || c.online) {
                        console.log(`${c.hostname}: online=${c.online}, backup_status=${c.backup_status}, job_id=${c.backup_job_id}`);
                    }
                });

                this.renderClientsList();
                if (!this.selectedClient && this.clients.length > 0) {
                    this.selectClient(this.clients[0].hostname);
                } else if (this.selectedClient) {
                    this.updateClientHeader();
                }
            } else if (response.status === 401) {
                this.logout();
            }
        } catch (error) {
            console.error('Errore caricamento clients:', error);
            this.showToast('error', 'Errore', 'Impossibile caricare la lista client');
        }
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

            // Debug: log dettagliato dello stato backup per ogni client
            console.log(`Rendering ${client.hostname}:`, {
                backup_status: client.backup_status,
                backup_job_id: client.backup_job_id,
                lastBackupRun: client.lastBackupRun?.status
            });

            // Priorità: stato backup corrente > ultimo backup storico
            if (client.backup_status === 'in_progress') {
                backupIcon = '<span class="backup-status-icon running" title="Backup in corso">●</span>';
                console.log(`  → Showing IN_PROGRESS icon for ${client.hostname}`);
            } else if (client.backup_status === 'completed') {
                backupIcon = '<span class="backup-status-icon success" title="Backup completato">✓</span>';
                console.log(`  → Showing COMPLETED icon for ${client.hostname}`);
            } else if (client.backup_status === 'failed') {
                backupIcon = '<span class="backup-status-icon failure" title="Backup fallito">✗</span>';
                console.log(`  → Showing FAILED icon for ${client.hostname}`);
            } else if (client.lastBackupRun) {
                if (client.lastBackupRun.status === 'success') {
                    backupIcon = '<span class="backup-status-icon success" title="Ultimo backup riuscito">✓</span>';
                } else if (client.lastBackupRun.status === 'failure') {
                    backupIcon = '<span class="backup-status-icon failure" title="Ultimo backup fallito">✗</span>';
                }
            }

            const showResetBackup = client.backup_status === 'in_progress';

            return `
            <div class="client-item ${this.selectedClient === client.hostname ? 'active' : ''}"
                 onclick="app.selectClient('${this.escapeForAttribute(client.hostname)}')">
                <div>
                    <div class="client-name">
                        ${backupIcon}${this.escapeHtml(client.hostname)}
                    </div>
                    <div class="client-status ${client.online ? 'online' : ''}">
                        ${client.online ? 'Online' : 'Offline'}
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
        `;}).join('');
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

                if (!this.editingJob && this.jobs.length > 0) {
                    this.editJob(this.jobs[0].job_id);
                } else if (this.jobs.length === 0) {
                    this.editingJob = null;
                    this.renderJobEditor();
                }
            }
        } catch (error) {
            console.error('Errore caricamento jobs:', error);
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
            const mappingsCount = Array.isArray(job.mappings) ? job.mappings.length : 0;
            const isActive = this.editingJob?.job_id === job.job_id;

            return `
                <div class="job-card ${isActive ? 'active' : ''}" onclick="app.editJob('${this.escapeForAttribute(job.job_id)}')">
                    <div class="job-header">
                        <div>
                            <div class="job-id">${this.escapeHtml(job.job_id)}</div>
                            <div class="run-date">${schedule}</div>
                        </div>
                        <div class="job-actions">
                            <span class="status-badge ${job.enabled ? 'enabled' : 'disabled'}">
                                ${job.enabled ? 'Attivo' : 'Disattivo'}
                            </span>
                        </div>
                    </div>
                    <div class="job-info">
                        <span class="job-info-label">Modalita:</span>
                        <span>${(job.mode_default || 'copy').toUpperCase()}</span>
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
            // Se ci sono job, seleziona il primo
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
        this.loadJobLogs(jobId);
    }

    async loadJobLogs(jobId) {
        const logConsole = document.getElementById('jobLogConsole');
        const logSection = document.getElementById('jobLogSection');

        if (!logConsole || !jobId) return;

        // Nascondi la sezione log per i nuovi job
        if (this.isNewJob) {
            if (logSection) logSection.style.display = 'none';
            return;
        }

        if (logSection) logSection.style.display = 'block';

        try {
            const response = await fetch(`/api/runs?jobId=${encodeURIComponent(jobId)}&limit=20`);
            if (!response.ok) {
                logConsole.innerHTML = '<div class="log-empty">Errore caricamento log</div>';
                return;
            }

            const runs = await response.json();
            this.renderJobLogs(runs);
        } catch (error) {
            console.error('Errore caricamento log job:', error);
            logConsole.innerHTML = '<div class="log-empty">Errore caricamento log</div>';
        }
    }

    renderJobLogs(runs) {
        const logConsole = document.getElementById('jobLogConsole');
        if (!logConsole) return;

        // Filtra solo errori e warning, ordina per data più recente
        const logEntries = [];

        for (const run of runs) {
            const runTime = new Date(run.start || run.end).toLocaleString('it-IT', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });

            // Aggiungi errori
            if (run.errors && run.errors.length > 0) {
                for (const error of run.errors) {
                    logEntries.push({
                        type: 'error',
                        time: runTime,
                        message: error.message || error,
                        path: error.path || error.affected_path || '',
                        timestamp: new Date(error.timestamp || run.start).getTime()
                    });
                }
            }

            // Aggiungi warning (file saltati)
            if (run.skipped_files && run.skipped_files.length > 0) {
                for (const skipped of run.skipped_files) {
                    logEntries.push({
                        type: 'warning',
                        time: runTime,
                        message: typeof skipped === 'string' ? skipped : (skipped.message || 'File saltato'),
                        path: typeof skipped === 'object' ? skipped.path : '',
                        timestamp: new Date(run.start).getTime()
                    });
                }
            }

            // Aggiungi stato fallimento run
            if (run.status === 'failure' && (!run.errors || run.errors.length === 0)) {
                logEntries.push({
                    type: 'error',
                    time: runTime,
                    message: run.error_message || 'Backup fallito',
                    path: run.target_path || '',
                    timestamp: new Date(run.start).getTime()
                });
            }
        }

        // Ordina per timestamp decrescente (più recenti prima)
        logEntries.sort((a, b) => b.timestamp - a.timestamp);

        if (logEntries.length === 0) {
            logConsole.innerHTML = '<div class="log-empty">Nessun errore o warning nelle ultime esecuzioni</div>';
            return;
        }

        // Limita a 50 entry
        const limitedEntries = logEntries.slice(0, 50);

        logConsole.innerHTML = limitedEntries.map(entry => `
            <div class="log-entry ${entry.type}">
                <span class="log-time">${this.escapeHtml(entry.time)}</span>
                <span class="log-type">${entry.type === 'error' ? 'ERRORE' : 'WARNING'}</span>
                <div class="log-message">
                    ${this.escapeHtml(entry.message)}
                    ${entry.path ? `<div class="log-path">${this.escapeHtml(entry.path)}</div>` : ''}
                </div>
            </div>
        `).join('');

        // Scroll to top
        logConsole.scrollTop = 0;
    }

    refreshJobLogs() {
        if (this.editingJob && this.editingJob.job_id && !this.isNewJob) {
            this.loadJobLogs(this.editingJob.job_id);
            this.showToast('info', 'Log aggiornati', 'Log delle esecuzioni aggiornati');
        }
    }

    renderJobEditor() {
        const emptyState = document.getElementById('jobEditorEmpty');
        const form = document.getElementById('jobEditorForm');
        const errorDiv = document.getElementById('jobFormError');
        const cancelBtn = document.getElementById('cancelJobBtn');

        // Mostra/nascondi pulsante Annulla in base a isNewJob
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
                                   placeholder="es. \\\\NAS\\Backups\\Documents">
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
        }
    }

    removeScheduleTime(index) {
        if (!this.editingJob) return;
        this.editingJob.schedule.times.splice(index, 1);
        this.renderJobEditor();
    }

    addMapping() {
        if (!this.editingJob) return;
        this.editingJob.mappings.push(this.createEmptyMapping());
        this.renderJobEditor();
    }

    removeMapping(index) {
        if (!this.editingJob) return;
        this.editingJob.mappings.splice(index, 1);
        if (this.editingJob.mappings.length === 0) {
            this.editingJob.mappings.push(this.createEmptyMapping());
        }
        this.renderJobEditor();
    }

    updateMappingField(index, field, value) {
        if (!this.editingJob?.mappings[index]) return;
        if (field === 'retention') {
            const parsed = parseInt(value, 10);
            this.editingJob.mappings[index].retention = { max_backups: parsed > 0 ? parsed : 1 };
        } else {
            this.editingJob.mappings[index][field] = value;
        }
    }

    updateMappingCredential(index, field, value) {
        if (!this.editingJob?.mappings[index]) return;
        if (!this.editingJob.mappings[index].credentials) {
            this.editingJob.mappings[index].credentials = { type: 'nas', username: '', password: '', domain: '' };
        }
        this.editingJob.mappings[index].credentials[field] = value;
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
                // Forza refresh dopo 2 secondi per aggiornare stato backup
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
            // Forza refresh dopo 2 secondi per aggiornare stato backup
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
            }
        } catch (error) {
            console.error('Errore caricamento runs:', error);
        }
    }

    renderRunsList() {
        const container = document.getElementById('runsList');

        if (this.runs.length === 0) {
            container.innerHTML = '<div class="info-message">Nessuna esecuzione disponibile</div>';
            return;
        }

        container.innerHTML = this.runs.slice(0, 50).map(run => {
            const duration = run.end
                ? `${Math.round((new Date(run.end) - new Date(run.start)) / 1000)}s`
                : 'In corso...';

            let statusClass = run.status;
            let statusLabel = run.status;

            if (run.status === 'success') {
                statusLabel = 'Successo';
                statusClass = 'success';
            } else if (run.status === 'failure') {
                statusLabel = 'Fallito';
            } else if (run.status === 'running') {
                statusLabel = 'In corso';
            }

            const hasErrors = run.errors && run.errors.length > 0;
            const errorMsg = hasErrors ? run.errors[0].message : '';

            // Estrai statistiche dai mappings (se disponibili da robocopy)
            let totalFiles = 0;
            let copiedFiles = 0;
            let skippedFiles = 0;
            let failedFiles = 0;
            let totalSize = run.bytes_processed || 0;

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

            const hasFileStats = totalFiles > 0 || copiedFiles > 0;

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
                        <span class="run-info-label">Dimensione:</span>
                        <span>${this.formatBytes(totalSize)}</span>
                        ${hasFileStats ? `
                            <span class="run-info-label">File:</span>
                            <span>${copiedFiles}/${totalFiles} copiati${skippedFiles > 0 ? `, ${skippedFiles} saltati` : ''}${failedFiles > 0 ? `, ${failedFiles} falliti` : ''}</span>
                        ` : ''}
                        ${run.target_path ? `
                            <span class="run-info-label">Dest:</span>
                            <span style="word-break: break-all;">${this.escapeHtml(run.target_path)}</span>
                        ` : ''}
                        ${hasErrors ? `
                            <span class="run-info-label">Errore:</span>
                            <span style="color: var(--error-color);">${this.escapeHtml(errorMsg)}</span>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
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
        this.loadFilesystemEntries(path);
    }

    navigateFilesystemUp() {
        if (!this.currentFsPath) return;

        const parts = this.currentFsPath.replace(/\\/g, '/').split('/').filter(p => p);
        parts.pop();
        const parentPath = parts.length > 0 ? parts.join('/') : '';

        this.selectedFsEntry = null;
        this.loadFilesystemEntries(parentPath);
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
        try {
            const response = await fetch('/api/config/export');
            const config = await response.json();

            if (response.ok) {
                const dataStr = JSON.stringify(config, null, 2);
                const dataBlob = new Blob([dataStr], { type: 'application/json' });
                const url = URL.createObjectURL(dataBlob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `onlybackup-config-${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);

                this.showToast('success', 'Export completato', `Configurazione esportata (${config.jobs.length} job, ${config.users.length} utenti)`);
            } else {
                this.showToast('error', 'Errore', config.error || 'Impossibile esportare la configurazione');
            }
        } catch (error) {
            console.error('Errore export configurazione:', error);
            this.showToast('error', 'Errore', 'Errore di connessione al server');
        }
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

                if (!confirm(`Importare configurazione?\n\n- ${config.jobs?.length || 0} job\n- ${config.users?.length || 0} utenti\n\nATTENZIONE: Gli elementi esistenti con lo stesso ID verranno sovrascritti.`)) {
                    return;
                }

                const response = await fetch('/api/config/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config)
                });

                const data = await response.json();

                if (response.ok && data.success) {
                    this.showToast('success', 'Import completato', `Importati: ${data.imported.jobs} job, ${data.imported.users} utenti`);
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

                // Aggiorna UI
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
