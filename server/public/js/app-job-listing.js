OnlyBackupApp.prototype.renderJobsList = function() {
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
};

OnlyBackupApp.prototype.formatSchedule = function(schedule) {
        if (!schedule) return 'Non pianificato';
        if (schedule.type === 'daily') {
            const dayNames = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
            const days = Array.isArray(schedule.days) ? schedule.days.map(d => dayNames[d]).join(', ') : '';
            const times = Array.isArray(schedule.times) ? schedule.times.join(', ') : '';
            return days ? `${days} @ ${times}` : times;
        }
        return schedule.type;
};

OnlyBackupApp.prototype.showCreateJobForm = function() {
        if (!this.selectedClient) {
            this.showToast('warning', 'Attenzione', 'Seleziona prima un client');
            return;
        }
        this.showTab('jobs');
        this.startNewJob();
};

OnlyBackupApp.prototype.startNewJob = function() {
        if (!this.selectedClient) return;

        this.isNewJob = true;
        this.editingJob = this.createEmptyJob();
        this.renderJobEditor();
        this.renderJobsList();
};

OnlyBackupApp.prototype.cancelEditJob = function() {
        if (this.isNewJob) {
            this.editingJob = null;
            this.isNewJob = false;
            this.renderJobEditor();
            this.renderJobsList();
            if (this.jobs.length > 0) {
                this.editJob(this.jobs[0].job_id);
            }
        }
};

OnlyBackupApp.prototype.createEmptyJob = function() {
        return {
            job_id: `BACKUP-${Date.now()}`,
            client_hostname: this.selectedClient,
            enabled: true,
            mode_default: 'copy',
            schedule: { type: 'daily', days: [1, 2, 3, 4, 5], times: ['02:00'] },
            mappings: [this.createEmptyMapping()]
        };
};

OnlyBackupApp.prototype.createEmptyMapping = function() {
        return {
            label: '',
            source_path: '',
            destination_path: '',
            mode: 'copy',
            retention: { max_backups: 5 },
            credentials: { type: 'nas', username: '', password: '', domain: '' }
        };
};

OnlyBackupApp.prototype.editJob = function(jobId) {
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
};

OnlyBackupApp.prototype.openLogViewer = async function(mappingIndex = null) {
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
};

OnlyBackupApp.prototype.loadLogViewerPage = async function(reset = false) {
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
};

OnlyBackupApp.prototype.buildLogViewerSection = function(run, mappingIndex) {
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
                        <div class="log-run-meta">${this.escapeHtml(runTime)}${destination ? ` Â· ${destination}` : ''}</div>
                    </div>
                    <div class="log-run-status ${statusClass || 'unknown'}">${this.statusLabelFor(statusClass)}</div>
                </div>
                <div class="log-run-meta">${this.escapeHtml(mapping.label || `Mappatura ${(Number(mapping.index) || 0) + 1}`)} Â· ${this.escapeHtml((mapping.mode || 'copy').toUpperCase())}</div>
                ${entries}
            </div>
        `;
};

OnlyBackupApp.prototype.openBackupsList = async function() {
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
};

OnlyBackupApp.prototype.renderBackupsModal = function(data) {
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
};

OnlyBackupApp.prototype.loadBackupsForMapping = async function(mappingIndex) {
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
};

OnlyBackupApp.prototype.renderBackupCard = function(mapping, mappingIndex) {
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
};

OnlyBackupApp.prototype.closeBackupsModal = function() {
        const modal = document.getElementById('backupsModal');
        if (modal) {
            modal.classList.add('hidden');
        }
};

OnlyBackupApp.prototype.deleteBackup = async function(path, { skipConfirm = false, skipReload = false, silent = false, mappingIndex = null } = {}) {
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
};

OnlyBackupApp.prototype.toggleSelectAllBackups = function(mappingIndex, checked) {
        const container = document.getElementById(`backup-card-${mappingIndex}`);
        if (!container) return;

        container.querySelectorAll('input.backup-checkbox').forEach(cb => {
            cb.checked = checked;
        });
};

OnlyBackupApp.prototype.deleteSelectedBackups = async function(mappingIndex) {
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
};

OnlyBackupApp.prototype.renderHeaderBackupStatus = function(statuses = []) {
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
};

OnlyBackupApp.prototype.updateFooterStatus = function({ healthy = null, message = null } = {}) {
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
};

OnlyBackupApp.prototype.buildLogEntriesFromRuns = function(runs = []) {
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
};

OnlyBackupApp.prototype.closeLogViewer = function() {
        const modal = document.getElementById('logViewerModal');
        if (modal) {
            modal.classList.add('hidden');
        }
};
