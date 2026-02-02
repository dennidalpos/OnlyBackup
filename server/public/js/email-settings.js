let emailTemplates = null;
let currentSettings = null;

document.addEventListener('DOMContentLoaded', async () => {
    await loadEmailSettings();
    handleOAuthCallback();
    setupTemplateCopy();
});

function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    if (tabName === 'smtp') {
        document.querySelector('.tab-btn:first-child').classList.add('active');
        document.getElementById('smtpTab').classList.add('active');
    } else if (tabName === 'templates') {
        document.querySelector('.tab-btn:last-child').classList.add('active');
        document.getElementById('templatesTab').classList.add('active');
    }
}

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

function showMessage(type, message) {
    const container = document.getElementById('statusMessage');
    const messageClass = type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'error';

    container.innerHTML = `<div class="status-message ${messageClass}">${escapeHtml(message)}</div>`;
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    setTimeout(() => {
        container.innerHTML = '';
    }, 5000);
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
