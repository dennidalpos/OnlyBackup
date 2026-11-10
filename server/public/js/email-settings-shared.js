(function initEmailSettingsShared(global) {
    function defaultEscapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text ?? '';
        return div.innerHTML;
    }

    function defaultShowMessage(type, message) {
        const container = document.getElementById('statusMessage');
        if (!container) {
            return;
        }

        const messageClass = type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'error';
        container.innerHTML = `<div class="status-message ${messageClass}" role="${messageClass === 'error' ? 'alert' : 'status'}">${defaultEscapeHtml(message)}</div>`;
    }

    function defaultSwitchTab(tabName) {
        const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
        const useDataset = tabButtons.some((button) => button.dataset.tab);

        tabButtons.forEach((button, index) => {
            if (useDataset) {
                const selected = button.dataset.tab === tabName;
                button.classList.toggle('active', selected);
                button.setAttribute('aria-selected', selected ? 'true' : 'false');
                button.tabIndex = selected ? 0 : -1;
                return;
            }

            const shouldActivate =
                (tabName === 'smtp' && index === 0) ||
                (tabName === 'templates' && index === tabButtons.length - 1);

            button.classList.toggle('active', shouldActivate);
            button.setAttribute('aria-selected', shouldActivate ? 'true' : 'false');
            button.tabIndex = shouldActivate ? 0 : -1;
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

    function createEmailSettingsController(options = {}) {
        const state = {
            emailTemplates: null,
            currentSettings: null
        };

        const showMessage = typeof options.showMessage === 'function' ? options.showMessage : defaultShowMessage;
        const switchTab = typeof options.switchTab === 'function' ? options.switchTab : defaultSwitchTab;
        const onReady = typeof options.onReady === 'function' ? options.onReady : async () => {};
        const onSettingsLoaded = typeof options.onSettingsLoaded === 'function' ? options.onSettingsLoaded : null;
        const escapeHtml = typeof options.escapeHtml === 'function' ? options.escapeHtml : defaultEscapeHtml;
        const oauthPopupName = 'onlybackupEmailOAuth';

        function showInlineConfirm({ title, message, confirmLabel = 'Conferma' }) {
            return new Promise((resolve) => {
                const modal = document.createElement('div');
                modal.className = 'modal';
                modal.innerHTML = `
                    <div class="modal-backdrop"></div>
                    <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="emailConfirmTitle" tabindex="-1">
                        <h3 id="emailConfirmTitle">${escapeHtml(title)}</h3>
                        <div class="dialog-message danger-message"><p>${escapeHtml(message)}</p></div>
                        <div class="modal-actions">
                            <button type="button" class="btn-cancel btn btn-outline btn-small">Annulla</button>
                            <button type="button" class="btn-confirm btn btn-danger btn-small">${escapeHtml(confirmLabel)}</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);

                const close = (value) => {
                    if (modal.parentElement) {
                        document.body.removeChild(modal);
                    }
                    resolve(value);
                };

                modal.querySelector('.btn-cancel').onclick = () => close(false);
                modal.querySelector('.modal-backdrop').onclick = () => close(false);
                modal.querySelector('.btn-confirm').onclick = () => close(true);
                modal.querySelector('.modal-content').focus();
            });
        }

        function showInlineInput({ title, label, type = 'text', confirmLabel = 'Conferma' }) {
            return new Promise((resolve) => {
                const modal = document.createElement('div');
                modal.className = 'modal';
                modal.innerHTML = `
                    <div class="modal-backdrop"></div>
                    <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="emailInputTitle" tabindex="-1">
                        <h3 id="emailInputTitle">${escapeHtml(title)}</h3>
                        <div class="form-group">
                            <label for="emailInputDialogField">${escapeHtml(label)}</label>
                            <input id="emailInputDialogField" type="${escapeHtml(type)}" autocomplete="off">
                        </div>
                        <div class="modal-actions">
                            <button type="button" class="btn-cancel btn btn-outline btn-small">Annulla</button>
                            <button type="button" class="btn-confirm btn btn-primary btn-small">${escapeHtml(confirmLabel)}</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);

                const input = modal.querySelector('#emailInputDialogField');
                const close = (value) => {
                    if (modal.parentElement) {
                        document.body.removeChild(modal);
                    }
                    resolve(value);
                };

                modal.querySelector('.btn-cancel').onclick = () => close(null);
                modal.querySelector('.modal-backdrop').onclick = () => close(null);
                modal.querySelector('.btn-confirm').onclick = () => close(input.value);
                input.focus();
            });
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

                state.currentSettings = await response.json();
                populateEmailSettings(state.currentSettings);

                const templatesResponse = await fetch('/api/email/templates', {
                    credentials: 'include'
                });

                if (templatesResponse.ok) {
                    state.emailTemplates = await templatesResponse.json();
                }

                if (onSettingsLoaded) {
                    await onSettingsLoaded(state.currentSettings);
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

        function openOAuthDialog() {
            document.getElementById('authType').value = 'oauth2';
            toggleAuthType();

            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.style.display = 'flex';
            modal.innerHTML = `
                <div class="modal-backdrop"></div>
                <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="oauthDialogTitle" tabindex="-1">
                    <h3 id="oauthDialogTitle">Registra account email</h3>
                    <div class="dialog-message">
                        <p>Seleziona il provider, poi completa l'accesso e l'MFA nella finestra del provider. OnlyBackup salvera il token necessario per inviare le notifiche.</p>
                    </div>
                    <div class="oauth-provider-dialog" role="radiogroup" aria-label="Provider email">
                        <label class="oauth-provider-option">
                            <input type="radio" name="oauthProvider" value="google" checked>
                            <span>
                                <span class="oauth-provider-title">Google Workspace / Gmail</span>
                                <span class="oauth-provider-meta">Usa l'accesso Google e il consenso SMTP per l'account configurato.</span>
                            </span>
                        </label>
                        <label class="oauth-provider-option">
                            <input type="radio" name="oauthProvider" value="microsoft">
                            <span>
                                <span class="oauth-provider-title">Microsoft 365 / Outlook</span>
                                <span class="oauth-provider-meta">Usa l'accesso Microsoft e il consenso SMTP.Send per l'account configurato.</span>
                            </span>
                        </label>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="btn btn-outline btn-cancel">Annulla</button>
                        <button type="button" class="btn btn-primary btn-confirm">Accedi al provider</button>
                    </div>
                </div>
            `;

            const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            const close = () => {
                document.removeEventListener('keydown', keyHandler);
                if (modal.parentElement) {
                    document.body.removeChild(modal);
                }
                if (previousFocus && document.contains(previousFocus)) {
                    previousFocus.focus();
                }
            };
            const keyHandler = (event) => {
                if (event.key === 'Escape') {
                    close();
                }
            };

            document.body.appendChild(modal);
            modal.querySelector('.modal-backdrop').addEventListener('click', close);
            modal.querySelector('.btn-cancel').addEventListener('click', close);
            modal.querySelector('.btn-confirm').addEventListener('click', async () => {
                const provider = modal.querySelector('input[name="oauthProvider"]:checked')?.value || 'google';
                close();
                await startOAuthLogin(provider);
            });
            document.addEventListener('keydown', keyHandler);
            modal.querySelector('.modal-content').focus();
        }

        async function startOAuthLogin(provider) {
            let popup = null;
            try {
                document.getElementById('authType').value = 'oauth2';
                toggleAuthType();

                const authUser = document.getElementById('oauth2User').value.trim();

                if (!authUser) {
                    showMessage('warning', 'Inserisci l\'email dell\'account da collegare.');
                    return;
                }

                popup = window.open('', oauthPopupName, 'width=720,height=760,menubar=no,toolbar=no,location=yes,status=yes,scrollbars=yes,resizable=yes');

                const response = await fetch('/api/email/oauth/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        provider,
                        authUser,
                        returnTo: window.location.pathname,
                        popup: true
                    })
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || 'Errore avvio OAuth');
                }

                if (!popup) {
                    showMessage('warning', 'Popup bloccato dal browser. Apro il provider in questa finestra.');
                    window.location.href = data.url;
                    return;
                }

                popup.location.href = data.url;
                showMessage('warning', 'Completa l\'accesso nella finestra del provider.');
            } catch (error) {
                if (popup && !popup.closed) {
                    popup.close();
                }
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

            if (params.get('oauthPopup') === '1' && window.opener) {
                window.opener.postMessage({
                    type: 'onlybackup:email-oauth',
                    status,
                    provider: params.get('provider') || '',
                    message: params.get('message') || ''
                }, window.location.origin);
                window.close();
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

        function setupOAuthPopupListener() {
            if (document.body.dataset.oauthPopupListenerBound === 'true') {
                return;
            }

            document.body.dataset.oauthPopupListenerBound = 'true';
            window.addEventListener('message', async (event) => {
                if (event.origin !== window.location.origin || event.data?.type !== 'onlybackup:email-oauth') {
                    return;
                }

                if (event.data.status === 'success') {
                    const provider = event.data.provider || 'OAuth';
                    showMessage('success', `Collegamento ${provider} completato. Account email registrato.`);
                    await loadEmailSettings();
                    return;
                }

                showMessage('error', event.data.message || 'Errore durante il login OAuth.');
            });
        }

        async function saveEmailSettings() {
            try {
                const authType = document.getElementById('authType').value;
                const recipients = document.getElementById('emailRecipients').value
                    .split('\n')
                    .map((entry) => entry.trim())
                    .filter(Boolean);

                const settings = {
                    enabled: document.getElementById('emailEnabled').checked,
                    smtp: {
                        host: document.getElementById('smtpHost').value,
                        port: parseInt(document.getElementById('smtpPort').value, 10) || 587,
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
                        oauth2: {}
                    },
                    from: document.getElementById('emailFrom').value,
                    recipients,
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

                state.currentSettings = settings;
                showMessage('success', 'Impostazioni email salvate con successo');
            } catch (error) {
                console.error('Errore salvataggio impostazioni:', error);
                showMessage('error', error.message || 'Impossibile salvare le impostazioni');
            }
        }

        async function testEmail() {
            const recipient = await showInlineInput({
                title: 'Email di test',
                label: 'Indirizzo email destinatario',
                type: 'email',
                confirmLabel: 'Invia test'
            });
            if (!recipient) {
                return;
            }

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

                localStorage.setItem('onlybackup.emailTested', 'true');
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
                actions.classList.add('hidden');
                return;
            }

            if (!state.emailTemplates) {
                try {
                    const response = await fetch('/api/email/templates', {
                        credentials: 'include'
                    });

                    if (response.ok) {
                        state.emailTemplates = await response.json();
                    }
                } catch (error) {
                    console.error('Errore caricamento template:', error);
                    showMessage('error', 'Impossibile caricare i template');
                    return;
                }
            }

            const template = state.emailTemplates?.[eventType];
            if (template) {
                document.getElementById('templateSubject').value = template.subject || '';
                document.getElementById('templateBody').value = template.body || '';
                editor.classList.remove('hidden');
                actions.classList.remove('hidden');
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
                        subject,
                        body
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

                if (state.emailTemplates) {
                    state.emailTemplates[eventType] = { subject, body };
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

            const confirmed = await showInlineConfirm({
                title: 'Ripristina template',
                message: 'Le modifiche attuali al template selezionato andranno perse.',
                confirmLabel: 'Ripristina'
            });
            if (!confirmed) {
                return;
            }

            try {
                state.emailTemplates = null;

                const response = await fetch('/api/email/templates', {
                    credentials: 'include'
                });

                if (!response.ok) {
                    throw new Error('Errore caricamento template predefinito');
                }

                state.emailTemplates = await response.json();
                await loadTemplate();

                showMessage('warning', 'Template ripristinato. Clicca su "Salva Template" per confermare il ripristino.');
            } catch (error) {
                console.error('Errore reset template:', error);
                showMessage('error', 'Impossibile ripristinare il template');
            }
        }

        function setupTemplateCopy() {
            if (document.body.dataset.templateCopyBound === 'true') {
                return;
            }

            document.body.dataset.templateCopyBound = 'true';

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

        async function initialize() {
            await loadEmailSettings();
            await onReady(api);
            setupOAuthPopupListener();
            handleOAuthCallback();
            setupTemplateCopy();
        }

        const api = {
            escapeHtml,
            getState: () => state,
            handleOAuthCallback,
            initialize,
            loadEmailSettings,
            loadTemplate,
            openOAuthDialog,
            populateEmailSettings,
            resetTemplate,
            saveEmailSettings,
            saveTemplate,
            setupTemplateCopy,
            showMessage,
            startOAuthLogin,
            switchTab,
            testEmail,
            toggleAuthType
        };

        return api;
    }

    global.createEmailSettingsController = createEmailSettingsController;
})(window);
