// Server Settings JavaScript

// Variabili globali per gestione email
let emailTemplates = null;
let currentSettings = null;

// Inizializzazione
document.addEventListener('DOMContentLoaded', async () => {
    await loadEmailSettings();
    await loadLogRetention();
    handleOAuthCallback();
    setupTemplateCopy();
});

// Gestione tab
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        switchTab(tab);
    });
});

function switchTab(tabName) {
    // Aggiorna bottoni
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Aggiorna contenuti
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    const targetTab = document.getElementById(`${tabName}Tab`);
    if (targetTab) {
        targetTab.classList.add('active');
    }
}

// Elimina tutti i log
async function deleteAllLogs() {
    if (!confirm('Sei sicuro di voler eliminare TUTTI i log di TUTTI i PC?\n\nQuesta operazione è IRREVERSIBILE.\n\nI job non verranno eliminati, solo lo storico delle esecuzioni.')) {
        return;
    }

    const secondConfirm = confirm('ULTIMA CONFERMA: Eliminare tutti i log?\n\nVerranno eliminati tutti i record di backup eseguiti.\nLa configurazione dei job rimarrà intatta.');
    if (!secondConfirm) {
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
            showMessage('success', `✅ Eliminati ${data.deletedCount} log`);
        } else {
            showMessage('error', '❌ Errore eliminazione log: ' + (data.error || 'Errore sconosciuto'));
        }
    } catch (error) {
        console.error('Errore eliminazione log:', error);
        showMessage('error', '❌ Errore di rete');
    }
}

// Elimina storico alert
async function deleteAlertHistory() {
    if (!confirm('Sei sicuro di voler cancellare lo storico degli alert?\n\nQuesta operazione rimuove sia gli alert risolti che quelli ancora attivi.')) {
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
            showMessage('success', `✅ Storico alert cancellato (${data.deletedCount})`);
        } else {
            showMessage('error', '❌ Errore cancellazione storico alert: ' + (data.error || 'Errore sconosciuto'));
        }
    } catch (error) {
        console.error('Errore cancellazione storico alert:', error);
        showMessage('error', '❌ Errore di rete');
    }
}

// Carica retention log
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
        if (retentionSelect) {
            const retentionValue = String(Number(data.retentionDays || 0));
            const optionExists = Array.from(retentionSelect.options).some(option => option.value === retentionValue);
            retentionSelect.value = optionExists ? retentionValue : '0';
        }
    } catch (error) {
        console.error('Errore caricamento retention log:', error);
        showMessage('error', 'Impossibile caricare la ritenzione log');
    }
}

// Salva retention log
async function saveLogRetention() {
    const retentionSelect = document.getElementById('logRetentionDays');
    if (!retentionSelect) {
        return;
    }

    const retentionDays = Number(retentionSelect.value);

    try {
        const response = await fetch('/api/logs/retention', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ retentionDays })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showMessage('success', '✅ Ritenzione log aggiornata');
        } else {
            showMessage('error', '❌ Errore aggiornamento ritenzione log: ' + (data.error || 'Errore sconosciuto'));
        }
    } catch (error) {
        console.error('Errore aggiornamento ritenzione log:', error);
        showMessage('error', '❌ Errore di rete');
    }
}

// Riavvia server
async function rebootServer() {
    // Conferma lato client
    if (!confirm('Sei sicuro di voler riavviare il server Node.js?\n\nTutti i backup in esecuzione verranno interrotti.\n\nIl server si riavvierà automaticamente.')) {
        return;
    }

    // Disabilita il pulsante subito
    const btn = event.target;
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'Riavvio in corso...';

    try {
        // POST a endpoint admin dedicato con timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

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
            // Risposta immediata ricevuta
            showMessage('success', `✅ ${data.message}`);

            // Mostra info riavvio
            const statusDiv = document.getElementById('statusMessage');
            const info = document.createElement('div');
            info.className = 'status-message warning';
            info.innerHTML = `
                <strong>Riavvio server in corso</strong><br>
                PID: ${data.pid} | Platform: ${data.platform}<br>
                Downtime stimato: ${data.estimatedDowntime}<br>
                <em>Verifica disponibilità tra 8 secondi...</em>
            `;
            statusDiv.appendChild(info);

            // Reload UI dopo alcuni secondi
            let countdown = 8;
            const countdownInterval = setInterval(() => {
                countdown--;
                const em = info.querySelector('em');
                if (em) {
                    em.textContent = `Verifica disponibilità tra ${countdown} secondi...`;
                }

                if (countdown <= 0) {
                    clearInterval(countdownInterval);
                }
            }, 1000);

            // Tentativo di riconnessione con polling
            setTimeout(() => {
                checkServerAvailability();
            }, 8000);

        } else if (response.status === 403) {
            showMessage('error', '❌ Accesso negato. Solo gli amministratori possono riavviare il server.');
            btn.disabled = false;
            btn.textContent = originalText;
        } else {
            showMessage('error', '❌ Errore: ' + (data.error || 'Errore sconosciuto'));
            btn.disabled = false;
            btn.textContent = originalText;
        }
    } catch (error) {
        // Errore di rete è NORMALE durante il riavvio
        console.log('Richiesta riavvio inviata, server in spegnimento:', error.message);

        // Mostra messaggio positivo
        showMessage('warning', '⚠️ Server in riavvio...');

        // Mostra info riavvio
        const statusDiv = document.getElementById('statusMessage');
        const info = document.createElement('div');
        info.className = 'status-message warning';
        info.innerHTML = `
            <strong>Riavvio server in corso</strong><br>
            Il server sta terminando il processo corrente...<br>
            <em>Verifica disponibilità tra 8 secondi...</em>
        `;
        statusDiv.appendChild(info);

        // Countdown
        let countdown = 8;
        const countdownInterval = setInterval(() => {
            countdown--;
            const em = info.querySelector('em');
            if (em) {
                em.textContent = `Verifica disponibilità tra ${countdown} secondi...`;
            }

            if (countdown <= 0) {
                clearInterval(countdownInterval);
            }
        }, 1000);

        // Polling dopo 8 secondi
        setTimeout(() => {
            checkServerAvailability();
        }, 8000);
    }
}

// Verifica disponibilità server e reload
async function checkServerAvailability() {
    let attempts = 0;
    const maxAttempts = 10;
    const checkInterval = 2000; // 2 secondi

    const check = async () => {
        attempts++;

        try {
            const response = await fetch('/api/auth/status', {
                method: 'GET',
                cache: 'no-cache'
            });

            if (response.ok) {
                // Server disponibile - reload
                showMessage('success', '✅ Server online! Ricaricamento pagina...');
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            } else {
                // Riprova
                if (attempts < maxAttempts) {
                    setTimeout(check, checkInterval);
                } else {
                    showMessage('warning', '⚠️ Server non risponde. Ricarica manualmente la pagina.');
                }
            }
        } catch (error) {
            // Server non ancora disponibile, riprova
            if (attempts < maxAttempts) {
                console.log(`Tentativo ${attempts}/${maxAttempts} - Server non ancora disponibile`);
                setTimeout(check, checkInterval);
            } else {
                showMessage('warning', '⚠️ Server non risponde dopo 20 secondi. Ricarica manualmente la pagina.');
            }
        }
    };

    check();
}

// Mostra messaggio di stato
function showMessage(type, message) {
    const statusDiv = document.getElementById('statusMessage');
    statusDiv.innerHTML = `<div class="status-message ${type}">${message}</div>`;

    // Auto-hide dopo 5 secondi per messaggi di successo
    if (type === 'success') {
        setTimeout(() => {
            statusDiv.innerHTML = '';
        }, 5000);
    }
}

// Stile CSS aggiuntivo per il pulsante danger
const style = document.createElement('style');
style.textContent = `
    .btn-danger {
        background: var(--error-color);
        color: white;
        padding: 0.6rem 1.2rem;
        font-weight: 600;
    }

    .btn-danger:hover {
        background: #c82333;
    }

    .btn-danger:disabled {
        background: #999;
        cursor: not-allowed;
    }

    .form-section {
        margin-bottom: 32px;
        padding: 24px;
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        background: var(--panel-bg);
    }

    .form-section h4 {
        margin: 0 0 16px 0;
        font-size: 1.1rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .form-section p {
        margin: 0 0 16px 0;
        line-height: 1.6;
    }

    .info-box {
        background: var(--warning-bg);
        border-left: 4px solid var(--warning-color);
        padding: 16px;
        margin-bottom: 20px;
        border-radius: var(--radius-sm);
    }

    .info-box p {
        margin: 0;
        font-size: 0.875rem;
        color: var(--text-secondary);
    }

    .tab-content {
        padding: 30px;
    }

    .settings-content {
        background: var(--panel-bg);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-sm);
        border: 1px solid var(--border-color);
        overflow: hidden;
    }

    .tabs {
        display: flex;
        border-bottom: 1px solid var(--border-color);
        background: var(--panel-header-bg);
    }

    .tab-btn {
        flex: 1;
        padding: 16px 24px;
        border: none;
        background: transparent;
        cursor: pointer;
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--text-muted);
        transition: all 0.2s;
        border-bottom: 2px solid transparent;
    }

    .tab-btn:hover {
        background: var(--surface-hover);
        color: var(--text-secondary);
    }

    .tab-btn.active {
        color: var(--primary-color);
        border-bottom-color: var(--primary-color);
        background: var(--panel-bg);
    }

    .tab-content {
        display: none;
    }

    .tab-content.active {
        display: block;
    }

    .status-message {
        padding: 12px 16px;
        border-radius: var(--radius-sm);
        margin-bottom: 20px;
        font-size: 0.875rem;
    }

    .status-message.success {
        background: var(--success-bg);
        color: var(--success-color);
        border: 1px solid var(--success-color);
    }

    .status-message.error {
        background: var(--error-bg);
        color: var(--error-color);
        border: 1px solid var(--error-color);
    }

    .status-message.warning {
        background: var(--warning-bg);
        color: var(--warning-color);
        border: 1px solid var(--warning-color);
    }
`;
document.head.appendChild(style);

// ===========================
// EMAIL SETTINGS FUNCTIONS
// ===========================

async function loadEmailSettings() {
    try {
        const response = await fetch('/api/email/settings', {
            credentials: 'include'
        });

        if (!response.ok) {
            if (response.status === 401) {
                window.location.href = '/';
                return;
            }
            throw new Error('Errore caricamento impostazioni email');
        }

        currentSettings = await response.json();
        populateEmailSettings(currentSettings);

        const templatesResponse = await fetch('/api/email/templates', {
            credentials: 'include'
        });

        if (templatesResponse.ok) {
            emailTemplates = await templatesResponse.json();
        }
    } catch (error) {
        console.error('Errore caricamento impostazioni:', error);
        showMessage('error', 'Impossibile caricare le impostazioni email');
    }
}

function populateEmailSettings(settings) {
    document.getElementById('emailEnabled').checked = settings.enabled || false;
    document.getElementById('smtpHost').value = settings.smtp?.host || '';
    document.getElementById('smtpPort').value = settings.smtp?.port || 587;
    document.getElementById('smtpSecure').checked = settings.smtp?.secure || false;
    document.getElementById('smtpIgnoreTls').checked = settings.smtp?.ignore_tls || false;
    document.getElementById('authType').value = settings.smtp?.auth?.type || 'basic';
    document.getElementById('smtpUser').value = settings.smtp?.auth?.user || '';
    document.getElementById('smtpPass').value = settings.smtp?.auth?.pass === '********' ? '' : settings.smtp?.auth?.pass || '';
    document.getElementById('oauth2User').value = settings.smtp?.auth?.user || '';
    document.getElementById('oauth2ClientId').value = settings.smtp?.oauth2?.clientId || '';
    document.getElementById('oauth2ClientSecret').value = settings.smtp?.oauth2?.clientSecret === '********' ? '' : settings.smtp?.oauth2?.clientSecret || '';
    document.getElementById('oauth2RefreshToken').value = settings.smtp?.oauth2?.refreshToken === '********' ? '' : settings.smtp?.oauth2?.refreshToken || '';
    document.getElementById('emailFrom').value = settings.from || '';
    document.getElementById('emailRecipients').value = (settings.recipients || []).join('\n');

    document.getElementById('eventBackupFailed').checked = settings.events?.backup_failed !== false;
    document.getElementById('eventBackupPartial').checked = settings.events?.backup_partial !== false;
    document.getElementById('eventBackupCritical').checked = settings.events?.backup_critical !== false;
    document.getElementById('eventBackupWarning').checked = settings.events?.backup_warning !== false;
    document.getElementById('eventAgentOffline').checked = settings.events?.agent_offline !== false;
    document.getElementById('eventAgentOnline').checked = settings.events?.agent_online || false;

    toggleAuthType();
}

function toggleAuthType() {
    const authType = document.getElementById('authType').value;
    const basicFields = document.getElementById('basicAuthFields');
    const oauth2Fields = document.getElementById('oauth2Fields');

    if (authType === 'oauth2') {
        basicFields.classList.add('hidden');
        oauth2Fields.classList.remove('hidden');
    } else if (authType === 'none') {
        basicFields.classList.add('hidden');
        oauth2Fields.classList.add('hidden');
    } else {
        basicFields.classList.remove('hidden');
        oauth2Fields.classList.add('hidden');
    }
}

async function startOAuthLogin(provider) {
    try {
        document.getElementById('authType').value = 'oauth2';
        toggleAuthType();

        const clientId = document.getElementById('oauth2ClientId').value.trim();
        const clientSecret = document.getElementById('oauth2ClientSecret').value.trim();
        const authUser = document.getElementById('oauth2User').value.trim();

        if (!clientId || !clientSecret) {
            showMessage('warning', 'Inserisci Client ID e Client Secret per avviare OAuth.');
            return;
        }

        if (!authUser) {
            showMessage('warning', 'Inserisci l’email dell’account da collegare.');
            return;
        }

        const response = await fetch('/api/email/oauth/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                provider,
                clientId,
                clientSecret,
                authUser,
                returnTo: window.location.pathname
            })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Errore avvio OAuth');
        }

        window.location.href = data.url;
    } catch (error) {
        console.error('Errore OAuth start:', error);
        showMessage('error', error.message || 'Impossibile avviare OAuth');
    }
}

function handleOAuthCallback() {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('oauth');

    if (!status) {
        return;
    }

    if (status === 'success') {
        const provider = params.get('provider') || 'OAuth';
        showMessage('success', `Collegamento ${provider} completato. Refresh token salvato.`);
    } else {
        const message = params.get('message') || 'Errore durante il login OAuth.';
        showMessage('error', message);
    }

    window.history.replaceState({}, document.title, window.location.pathname);
}

async function saveEmailSettings() {
    try {
        const authType = document.getElementById('authType').value;
        const recipients = document.getElementById('emailRecipients').value
            .split('\n')
            .map(r => r.trim())
            .filter(r => r);

        const settings = {
            enabled: document.getElementById('emailEnabled').checked,
            smtp: {
                host: document.getElementById('smtpHost').value,
                port: parseInt(document.getElementById('smtpPort').value) || 587,
                secure: document.getElementById('smtpSecure').checked,
                ignore_tls: document.getElementById('smtpIgnoreTls').checked,
                auth: {
                    type: authType,
                    user: authType === 'oauth2'
                        ? document.getElementById('oauth2User').value
                        : authType === 'basic'
                            ? document.getElementById('smtpUser').value
                            : '',
                    pass: authType === 'basic' ? document.getElementById('smtpPass').value : ''
                },
                oauth2: authType === 'oauth2' ? {
                    clientId: document.getElementById('oauth2ClientId').value,
                    clientSecret: document.getElementById('oauth2ClientSecret').value,
                    refreshToken: document.getElementById('oauth2RefreshToken').value
                } : {}
            },
            from: document.getElementById('emailFrom').value,
            recipients: recipients,
            events: {
                backup_failed: document.getElementById('eventBackupFailed').checked,
                backup_partial: document.getElementById('eventBackupPartial').checked,
                backup_critical: document.getElementById('eventBackupCritical').checked,
                backup_warning: document.getElementById('eventBackupWarning').checked,
                agent_offline: document.getElementById('eventAgentOffline').checked,
                agent_online: document.getElementById('eventAgentOnline').checked
            }
        };

        const response = await fetch('/api/email/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(settings)
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Errore salvataggio impostazioni');
        }

        showMessage('success', 'Impostazioni email salvate con successo');
        currentSettings = settings;
    } catch (error) {
        console.error('Errore salvataggio impostazioni:', error);
        showMessage('error', error.message || 'Impossibile salvare le impostazioni');
    }
}

async function testEmail() {
    const recipient = prompt('Inserisci l\'indirizzo email di test:');
    if (!recipient) return;

    try {
        const response = await fetch('/api/email/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ recipient })
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Errore invio email di test');
        }

        showMessage('success', 'Email di test inviata con successo. Controlla la casella di posta.');
    } catch (error) {
        console.error('Errore invio email di test:', error);
        showMessage('error', error.message || 'Impossibile inviare email di test');
    }
}

async function loadTemplate() {
    const select = document.getElementById('templateSelect');
    const eventType = select.value;
    const editor = document.getElementById('templateEditor');
    const actions = document.getElementById('templateActions');

    if (!eventType) {
        editor.classList.add('hidden');
        actions.style.display = 'none';
        return;
    }

    if (!emailTemplates) {
        try {
            const response = await fetch('/api/email/templates', {
                credentials: 'include'
            });

            if (response.ok) {
                emailTemplates = await response.json();
            }
        } catch (error) {
            console.error('Errore caricamento template:', error);
            showMessage('error', 'Impossibile caricare i template');
            return;
        }
    }

    const template = emailTemplates[eventType];
    if (template) {
        document.getElementById('templateSubject').value = template.subject || '';
        document.getElementById('templateBody').value = template.body || '';
        editor.classList.remove('hidden');
        actions.style.display = 'flex';
    }
}

async function saveTemplate() {
    const select = document.getElementById('templateSelect');
    const eventType = select.value;

    if (!eventType) {
        showMessage('warning', 'Seleziona un template da salvare');
        return;
    }

    try {
        const subject = document.getElementById('templateSubject').value;
        const body = document.getElementById('templateBody').value;

        const templates = {
            [eventType]: {
                subject: subject,
                body: body
            }
        };

        const response = await fetch('/api/email/templates', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(templates)
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Errore salvataggio template');
        }

        if (emailTemplates) {
            emailTemplates[eventType] = { subject, body };
        }

        showMessage('success', 'Template salvato con successo');
    } catch (error) {
        console.error('Errore salvataggio template:', error);
        showMessage('error', error.message || 'Impossibile salvare il template');
    }
}

async function resetTemplate() {
    const select = document.getElementById('templateSelect');
    const eventType = select.value;

    if (!eventType) {
        return;
    }

    if (!confirm('Vuoi davvero ripristinare il template di default? Le modifiche attuali andranno perse.')) {
        return;
    }

    try {
        emailTemplates = null;

        const response = await fetch('/api/email/templates', {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('Errore caricamento template default');
        }

        emailTemplates = await response.json();

        await loadTemplate();

        showMessage('warning', 'Template ripristinato. Clicca su "Salva Template" per confermare il ripristino.');
    } catch (error) {
        console.error('Errore reset template:', error);
        showMessage('error', 'Impossibile ripristinare il template');
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function setupTemplateCopy() {
    document.addEventListener('click', async (event) => {
        const target = event.target.closest('[data-copy]');
        if (!target) {
            return;
        }

        const text = target.getAttribute('data-copy');
        if (!text) {
            return;
        }

        const copied = await copyToClipboard(text);
        if (copied) {
            showMessage('success', 'Placeholder copiato negli appunti');
        } else {
            showMessage('warning', 'Impossibile copiare: seleziona e copia manualmente');
        }
    });
}

async function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (error) {
            return false;
        }
    }

    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        return success;
    } catch (error) {
        return false;
    }
}

// ===========================
// IMPORT/EXPORT FUNCTIONS
// ===========================

async function exportConfig() {
    // Mostra dialog con checkbox per selezionare sezioni
    const sections = await showExportDialog();
    if (!sections || sections.length === 0) return;

    try {
        const sectionsParam = sections.join(',');
        const response = await fetch(`/api/config/export?sections=${sectionsParam}`, {
            credentials: 'include'
        });
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
            showMessage('success', `Export completato: ${sections.join(', ')} (${details})`);
        } else {
            showMessage('error', config.error || 'Impossibile esportare la configurazione');
        }
    } catch (error) {
        console.error('Errore export configurazione:', error);
        showMessage('error', 'Errore di connessione al server');
    }
}

function showExportDialog() {
    return new Promise((resolve) => {
        const html = `
            <div style="padding: 20px;">
                <h3 style="margin: 0 0 20px 0;">Seleziona cosa esportare</h3>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                        <input type="checkbox" value="jobs" checked style="width: 18px; height: 18px;"> Job
                    </label>
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                        <input type="checkbox" value="users" checked style="width: 18px; height: 18px;"> Utenti
                    </label>
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                        <input type="checkbox" value="clients" checked style="width: 18px; height: 18px;"> Client
                    </label>
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                        <input type="checkbox" value="email" checked style="width: 18px; height: 18px;"> Email
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

async function importConfig() {
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
            const sections = await showImportDialog(config, availableSections);

            if (!sections || sections.length === 0) return;

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
                // Ricarica la pagina dopo 2 secondi per aggiornare i dati
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
        const jobsCount = config.jobs?.length || 0;
        const usersCount = config.users?.length || 0;
        const clientsCount = config.clients?.length || 0;
        const hasEmail = Boolean(config.email);

        const checkboxes = [];
        if (availableSections.includes('jobs')) {
            checkboxes.push(`<label style="display: flex; align-items: center; gap: 10px; cursor: pointer;"><input type="checkbox" value="jobs" checked style="width: 18px; height: 18px;"> Job (${jobsCount})</label>`);
        }
        if (availableSections.includes('users')) {
            checkboxes.push(`<label style="display: flex; align-items: center; gap: 10px; cursor: pointer;"><input type="checkbox" value="users" checked style="width: 18px; height: 18px;"> Utenti (${usersCount})</label>`);
        }
        if (availableSections.includes('clients')) {
            checkboxes.push(`<label style="display: flex; align-items: center; gap: 10px; cursor: pointer;"><input type="checkbox" value="clients" checked style="width: 18px; height: 18px;"> Client (${clientsCount})</label>`);
        }
        if (availableSections.includes('email')) {
            checkboxes.push(`<label style="display: flex; align-items: center; gap: 10px; cursor: pointer;"><input type="checkbox" value="email" checked style="width: 18px; height: 18px;"> Email (${hasEmail ? '1' : '0'})</label>`);
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
