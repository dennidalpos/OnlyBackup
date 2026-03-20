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

        this.eventSource.addEventListener('job_created', () => {
            this.loadClients();
        });

        this.eventSource.addEventListener('job_updated', () => {
            this.loadClients();
        });

        this.eventSource.addEventListener('job_deleted', () => {
            this.loadClients();
        });

        this.eventSource.onerror = (err) => {
            console.error('SSE error:', err);
            this.eventSource.close();

            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
                this.reconnectAttempts += 1;
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

        const statusText = data.status === 'completed'
            ? 'completato'
            : data.status === 'failed'
                ? 'fallito'
                : data.status === 'partial'
                    ? 'parziale'
                    : data.status;

        const type = data.status === 'completed'
            ? 'success'
            : data.status === 'failed'
                ? 'error'
                : 'warning';

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
        rows.forEach((row) => {
            const rowState = row.getAttribute('data-state');
            row.classList.toggle('hidden', state !== rowState);
        });

        if (state === 'ready') {
            rows.forEach((row) => row.classList.add('hidden'));
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
                .map((mapping) => this.normalizeRunStatus(mapping.status))
                .filter(Boolean)
            : [];

        if (mappingStatuses.length > 0) {
            if (mappingStatuses.some((status) => status === 'failure' || status === 'failed')) {
                return 'failure';
            }
            if (mappingStatuses.some((status) => status === 'partial')) {
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
        for (const button of buttons) {
            if (button.textContent.trim().includes(text)) {
                return button;
            }
        }
        return null;
    }
}

window.OnlyBackupApp = OnlyBackupApp;
