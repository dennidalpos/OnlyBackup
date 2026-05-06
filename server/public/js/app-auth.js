OnlyBackupApp.prototype.checkAuthStatus = async function() {
    try {
        const response = await fetch('/api/auth/status');

        if (response.ok) {
            const data = await response.json();
            this.authenticated = true;
            this.currentUser = data.username;

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
};

OnlyBackupApp.prototype.handleLogin = async function() {
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
};

OnlyBackupApp.prototype.handleChangePassword = async function() {
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
            this.showToast('success', 'Password aggiornata', 'La password e stata modificata con successo');
        } else {
            errorDiv.textContent = data.error || 'Errore durante il cambio password';
        }
    } catch (error) {
        console.error('Errore cambio password:', error);
        errorDiv.textContent = 'Errore di connessione al server';
    }
};

OnlyBackupApp.prototype.logout = async function() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });

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
};

OnlyBackupApp.prototype.showScreen = function(screenId) {
    document.querySelectorAll('.screen').forEach((screen) => {
        screen.classList.add('hidden');
    });

    const screen = document.getElementById(screenId);
    if (screen) {
        screen.classList.remove('hidden');
    }

    this.activeScreen = screenId;
};

OnlyBackupApp.prototype.showLogin = function() {
    this.showScreen('loginScreen');
};

OnlyBackupApp.prototype.showDashboard = async function() {
    this.showScreen('mainDashboard');
    document.getElementById('currentUser').textContent = this.currentUser;
    await Promise.all([this.loadClients(), this.loadHeaderStats()]);
    this.startDashboardPolling();
};

OnlyBackupApp.prototype.startDashboardPolling = function() {
    if (document.hidden) return;
    this.scheduleStatsPolling(() => this.loadHeaderStats());
    this.scheduleClientsPolling(() => this.loadClients());
};

OnlyBackupApp.prototype.scheduleStatsPolling = function(action) {
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
};

OnlyBackupApp.prototype.scheduleClientsPolling = function(action) {
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
};

OnlyBackupApp.prototype.handleVisibilityChange = function() {
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
    }
};

OnlyBackupApp.prototype.loadHeaderStats = async function() {
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
};
