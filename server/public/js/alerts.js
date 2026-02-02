// Alerts JavaScript
let activeAlerts = [];
let historyAlerts = [];
let eventSource = null;

// Inizializzazione
document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    loadActiveAlerts();
    setupSSE();
});

// Setup tabs
function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            switchTab(tab);
        });
    });
}

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

    // Carica dati se necessario
    if (tabName === 'history' && historyAlerts.length === 0) {
        loadHistoryAlerts();
    }
}

// Carica alert attivi
async function loadActiveAlerts() {
    try {
        const response = await fetch('/api/alerts');
        const data = await response.json();

        if (response.ok) {
            activeAlerts = data.alerts || [];
            renderActiveAlerts();
            updateAlertCount();
        } else {
            showMessage('error', 'Errore caricamento alert: ' + (data.error || 'Errore sconosciuto'));
        }
    } catch (error) {
        console.error('Errore caricamento alert:', error);
        showMessage('error', 'Errore di rete');
    }
}

// Carica storico alert
async function loadHistoryAlerts() {
    try {
        const response = await fetch('/api/alerts/history');
        const data = await response.json();

        if (response.ok) {
            historyAlerts = data.alerts || [];
            renderHistoryAlerts();
        } else {
            showMessage('error', 'Errore caricamento storico: ' + (data.error || 'Errore sconosciuto'));
        }
    } catch (error) {
        console.error('Errore caricamento storico:', error);
        showMessage('error', 'Errore di rete');
    }
}

// Render alert attivi
function renderActiveAlerts() {
    const container = document.getElementById('activeAlertsContainer');

    if (activeAlerts.length === 0) {
        container.innerHTML = '<div class="empty-state">✅ Nessun alert attivo</div>';
        return;
    }

    container.innerHTML = activeAlerts.map(alert => createAlertCard(alert, true)).join('');
}

// Render storico alert
function renderHistoryAlerts() {
    const container = document.getElementById('historyAlertsContainer');

    if (historyAlerts.length === 0) {
        container.innerHTML = '<div class="empty-state">📋 Nessun alert nello storico</div>';
        return;
    }

    container.innerHTML = historyAlerts.map(alert => createAlertCard(alert, false)).join('');
}

// Crea card alert
function createAlertCard(alert, isActive) {
    const severityClass = alert.severity === 'error' ? 'alert-error' : 'alert-warning';
    const severityIcon = alert.severity === 'error' ? '🔴' : '⚠️';
    const typeLabel = getAlertTypeLabel(alert.type);
    const timestamp = new Date(alert.timestamp).toLocaleString('it-IT');

    let resolvedInfo = '';
    if (alert.resolved) {
        const resolvedTime = new Date(alert.resolved_timestamp).toLocaleString('it-IT');
        resolvedInfo = `<div class="alert-resolved">✅ Risolto: ${resolvedTime}</div>`;
    }

    const actions = isActive ? `
        <button class="btn-small btn-primary" onclick="resolveAlert('${alert.alert_id}')">
            ✓ Risolvi
        </button>
    ` : '';

    return `
        <div class="alert-card ${severityClass} ${alert.resolved ? 'resolved' : ''}">
            <div class="alert-header">
                <span class="alert-icon">${severityIcon}</span>
                <div class="alert-title-group">
                    <h3>${alert.title}</h3>
                    <span class="alert-type">${typeLabel}</span>
                </div>
            </div>
            <div class="alert-body">
                <p>${alert.message}</p>
                <div class="alert-meta">
                    <span>📅 ${timestamp}</span>
                    ${alert.hostname ? `<span>💻 ${alert.hostname}</span>` : ''}
                    ${alert.job_id ? `<span>📦 Job: ${alert.job_id}</span>` : ''}
                </div>
                ${resolvedInfo}
            </div>
            ${actions ? `<div class="alert-actions">${actions}</div>` : ''}
        </div>
    `;
}

// Ottieni label tipo alert
function getAlertTypeLabel(type) {
    const labels = {
        'backup_failed': 'Backup Fallito',
        'backup_partial': 'Backup Parziale',
        'agent_offline': 'Agent Offline'
    };
    return labels[type] || type;
}

// Risolvi alert
async function resolveAlert(alertId) {
    try {
        const response = await fetch(`/api/alerts/${alertId}/resolve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('success', '✅ Alert risolto');
            // Rimuovi dalla lista attivi
            activeAlerts = activeAlerts.filter(a => a.alert_id !== alertId);
            renderActiveAlerts();
            updateAlertCount();
        } else {
            showMessage('error', '❌ Errore: ' + (data.error || 'Errore sconosciuto'));
        }
    } catch (error) {
        console.error('Errore risoluzione alert:', error);
        showMessage('error', '❌ Errore di rete');
    }
}

// Aggiorna contatore
function updateAlertCount() {
    const badge = document.getElementById('alertCount');
    const count = activeAlerts.length;

    if (count > 0) {
        badge.textContent = `${count} ${count === 1 ? 'alert' : 'alert'}`;
        badge.className = 'badge badge-error';
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}

// Setup SSE per aggiornamenti real-time
function setupSSE() {
    try {
        eventSource = new EventSource('/api/events');

        eventSource.addEventListener('alert_created', (event) => {
            const alert = JSON.parse(event.data);
            if (!alert.resolved) {
                activeAlerts.unshift(alert);
                renderActiveAlerts();
                updateAlertCount();
            }
        });

        eventSource.addEventListener('alert_resolved', (event) => {
            const alert = JSON.parse(event.data);
            activeAlerts = activeAlerts.filter(a => a.alert_id !== alert.alert_id);
            renderActiveAlerts();
            updateAlertCount();
        });

        eventSource.onerror = (error) => {
            console.error('SSE error:', error);
            eventSource.close();
            // Riprova dopo 5 secondi
            setTimeout(setupSSE, 5000);
        };
    } catch (error) {
        console.error('Errore setup SSE:', error);
    }
}

// Mostra messaggio
function showMessage(type, message) {
    const statusDiv = document.getElementById('statusMessage');
    statusDiv.innerHTML = `<div class="status-message ${type}">${message}</div>`;

    if (type === 'success') {
        setTimeout(() => {
            statusDiv.innerHTML = '';
        }, 3000);
    }
}

// Cleanup on unload
window.addEventListener('beforeunload', () => {
    if (eventSource) {
        eventSource.close();
    }
});

// CSS dinamico
const style = document.createElement('style');
style.textContent = `
    .alert-card {
        background: var(--panel-bg);
        border: 1px solid var(--border-color);
        border-left-width: 4px;
        border-radius: var(--radius-md);
        padding: 20px;
        margin-bottom: 16px;
        transition: all 0.2s;
    }

    .alert-card:hover {
        box-shadow: var(--shadow-md);
    }

    .alert-card.alert-error {
        border-left-color: var(--error-color);
    }

    .alert-card.alert-warning {
        border-left-color: var(--warning-color);
    }

    .alert-card.resolved {
        opacity: 0.6;
    }

    .alert-header {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 12px;
    }

    .alert-icon {
        font-size: 1.5rem;
        line-height: 1;
    }

    .alert-title-group {
        flex: 1;
    }

    .alert-title-group h3 {
        margin: 0 0 4px 0;
        font-size: 1rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .alert-type {
        display: inline-block;
        padding: 2px 8px;
        background: var(--surface-hover);
        border-radius: var(--radius-sm);
        font-size: 0.75rem;
        color: var(--text-muted);
    }

    .alert-body p {
        margin: 0 0 12px 0;
        color: var(--text-secondary);
    }

    .alert-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        font-size: 0.8125rem;
        color: var(--text-muted);
    }

    .alert-resolved {
        margin-top: 12px;
        padding: 8px 12px;
        background: var(--success-bg);
        color: var(--success-color);
        border-radius: var(--radius-sm);
        font-size: 0.8125rem;
    }

    .alert-actions {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid var(--border-color);
        display: flex;
        gap: 8px;
        justify-content: flex-end;
    }

    .btn-small {
        padding: 0.375rem 0.75rem;
        font-size: 0.8125rem;
        border: none;
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: all 0.2s;
    }

    .btn-small.btn-primary {
        background: var(--primary-color);
        color: white;
    }

    .btn-small.btn-primary:hover {
        background: var(--primary-hover);
    }

    .badge {
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 0.75rem;
        font-weight: 600;
    }

    .badge-error {
        background: var(--error-color);
        color: white;
    }

    .empty-state {
        text-align: center;
        padding: 60px 20px;
        color: var(--text-muted);
        font-size: 1.1rem;
    }

    .loading-spinner {
        text-align: center;
        padding: 40px;
        color: var(--text-muted);
    }

    .tab-content {
        padding: 24px;
        min-height: 400px;
    }
`;
document.head.appendChild(style);
