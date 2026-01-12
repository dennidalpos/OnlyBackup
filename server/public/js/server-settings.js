// Server Settings JavaScript

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
