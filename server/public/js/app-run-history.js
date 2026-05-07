OnlyBackupApp.prototype.deleteEditingJob = async function() {
        if (!this.editingJob || this.isNewJob) {
            this.showToast('warning', 'Attenzione', 'Nessun job selezionato da eliminare');
            return;
        }

        const jobId = this.editingJob.job_id;
        const confirmed = await this.showStrongConfirm({
            title: 'Elimina job',
            message: `Elimina il job ${jobId}. Lo storico backup del client non viene rimosso.`,
            expectedText: jobId,
            confirmLabel: 'Elimina job'
        });
        if (!confirmed) {
            return;
        }

        try {
            const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.showToast('success', 'Job eliminato', `Il job ${jobId} e stato eliminato`);
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
};

OnlyBackupApp.prototype.runJob = async function(jobId) {
        const job = this.jobs.find(entry => entry.job_id === jobId) || this.editingJob;
        const confirmed = await this.showJobPreview({
            title: 'Revisione esecuzione manuale',
            actionLabel: 'Esegui job',
            payload: job
        });
        if (!confirmed) {
            return;
        }

        try {
            const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/run`, { method: 'POST' });
            const data = await response.json();

            if (response.ok) {
                this.showToast('info', 'Backup avviato', `Il backup per ${jobId} e stato avviato. Controlla lo storico per il risultato.`);
                await Promise.all([
                    this.loadClientRuns(),
                    this.loadClients(),
                    this.loadHeaderStats()
                ]);
                this.updateClientSummary();
                this.showTab('runs');
                setTimeout(() => {
                    this.loadClients();
                    this.loadHeaderStats();
                }, 2000);
            } else {
                if (data.error?.includes('gia in esecuzione') || response.status === 409) {
                    this.showToast('warning', 'Job in corso', `Il job ${jobId} e gia in esecuzione`);
                } else {
                    this.showToast('error', 'Errore', data.error || 'Impossibile avviare il job');
                }
            }
        } catch (error) {
            console.error('Errore esecuzione job:', error);
            this.showToast('error', 'Errore', 'Errore di connessione al server');
        }
};

OnlyBackupApp.prototype.runEditingJob = function() {
        if (!this.editingJob) {
            this.showToast('warning', 'Attenzione', 'Nessun job selezionato');
            return;
        }
        if (this.isNewJob) {
            this.showToast('warning', 'Attenzione', 'Salva prima il job per poterlo eseguire');
            return;
        }
        this.runJob(this.editingJob.job_id);
};

OnlyBackupApp.prototype.runAllJobsForClient = async function() {
        if (!this.selectedClient) return;

        const enabledJobs = this.jobs.filter(j => j.enabled);
        if (enabledJobs.length === 0) {
            this.showToast('warning', 'Attenzione', 'Nessun job attivo da eseguire');
            return;
        }

        const confirmed = await this.showStrongConfirm({
            title: 'Esegui tutti i job',
            message: `Avvia ${enabledJobs.length} job attivi per ${this.selectedClient}.`,
            expectedText: this.selectedClient,
            confirmLabel: 'Esegui tutti',
            danger: false
        });
        if (!confirmed) {
            return;
        }

        const runAllBtn = document.getElementById('runAllJobsButton');
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
            setTimeout(() => {
                this.loadClients();
                this.loadHeaderStats();
            }, 2000);
        } finally {
            this.setButtonLoading(runAllBtn, false);
        }
};

OnlyBackupApp.prototype.loadClientRuns = async function() {
        if (!this.selectedClient) return;

        try {
            const response = await fetch(`/api/runs?client=${encodeURIComponent(this.selectedClient)}`);
            if (response.ok) {
                const runs = await response.json();
                this.runs = runs
                    .filter(r => r.client_hostname === this.selectedClient)
                    .sort((a, b) => new Date(b.start) - new Date(a.start));
                this.renderRunFilters();
                this.renderRunsList();
                this.updateClientSummary();
                this.selectedClientRunsLoaded = true;
            }
        } catch (error) {
            console.error('Errore caricamento runs:', error);
        }
};

OnlyBackupApp.prototype.renderRunsList = function() {
        const container = document.getElementById('runsList');
        const maxRunsToShow = 10;
        const filteredRuns = this.getFilteredRuns();

        if (this.runs.length === 0) {
            container.innerHTML = '<div class="info-message">Nessuna esecuzione disponibile</div>';
            return;
        }

        if (filteredRuns.length === 0) {
            container.innerHTML = '<div class="info-message">Nessuna esecuzione corrisponde ai filtri selezionati</div>';
            return;
        }

        const limitedNotice = filteredRuns.length > maxRunsToShow
            ? '<div class="info-message">Mostrati ultimi 10 log filtrati. Usa "Log completi" per vedere lo storico completo del job.</div>'
            : '';

        let previousJobId = null;
        container.innerHTML = limitedNotice + filteredRuns.slice(0, maxRunsToShow).map(run => {
            const groupHeader = run.job_id !== previousJobId
                ? `<div class="run-group-header">Job ${this.escapeHtml(run.job_id || 'Sconosciuto')}</div>`
                : '';
            previousJobId = run.job_id;
            const duration = run.end
                ? `${Math.round((new Date(run.end) - new Date(run.start)) / 1000)}s`
                : 'In corso...';

            const normalizedStatus = this.deriveRunStatus(run);
            let statusClass = normalizedStatus;
            let statusLabel = normalizedStatus || 'Sconosciuto';

            if (normalizedStatus === 'success') {
                statusLabel = 'Successo';
                statusClass = 'success';
            } else if (normalizedStatus === 'failure') {
                statusLabel = 'Fallito';
                statusClass = 'failure';
            } else if (normalizedStatus === 'partial') {
                statusLabel = 'Parziale';
                statusClass = 'partial';
            } else if (normalizedStatus === 'running') {
                statusLabel = 'In corso';
            }

            const hasErrors = run.errors && run.errors.length > 0;
            const errorMsg = hasErrors ? run.errors[0].message : '';
            const diagnostic = this.buildRunDiagnostic(run);

            let totalFiles = 0;
            let copiedFiles = 0;
            let skippedFiles = 0;
            let failedFiles = 0;
            let totalSize = run.bytes_processed || 0;
            const skippedFilesList = Array.isArray(run.skipped_files)
                ? run.skipped_files.filter(Boolean)
                : [];

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

            const retentionEntries = [];
            if (run.mappings && run.mappings.length > 0) {
                run.mappings.forEach((m, index) => {
                    const mode = (m.mode || run.mode_default || 'copy');
                    if (mode !== 'copy') return;

                    const hasRetention = m.retention && m.retention.max_backups > 0;
                    if (!hasRetention) return;

                    const label = this.escapeHtml(m.label || m.source_path || m.destination_path || 'Copia');
                    retentionEntries.push(`
                        <div class="run-retention-item">
                            <div class="run-retention-header">${label}</div>
                            <div class="run-retention-meta">Retention configurata: max ${m.retention.max_backups} backup</div>
                            <div class="run-retention-load">
                                <button class="btn-secondary" onclick="app.loadRetentionEvents('${this.escapeHtml(run.job_id)}', '${this.escapeHtml(run.run_id)}', ${index})">
                                    Carica eventi retention
                                </button>
                            </div>
                            <div id="retention-events-${this.escapeHtml(run.run_id)}-${index}" class="run-retention-list" style="display:none;"></div>
                        </div>
                    `);
                });
            }

            if (run.stats) {
                if (totalFiles === 0) totalFiles = run.stats.total_files || 0;
                if (copiedFiles === 0) copiedFiles = run.stats.copied_files || 0;
                if (skippedFiles === 0) skippedFiles = run.stats.skipped_files || 0;
                if (failedFiles === 0) failedFiles = run.stats.failed_files || 0;
            }

            const hasFileStats = (run.stats && typeof run.stats.total_files !== 'undefined') ||
                totalFiles > 0 || copiedFiles > 0 || skippedFiles > 0 || failedFiles > 0;

            const maxSkippedToShow = 5;
            const skippedPreview = skippedFilesList.slice(0, maxSkippedToShow);
            const skippedListHtml = skippedPreview.map(item => {
                const label = typeof item === 'string'
                    ? item
                    : (item.path || item.affected_path || item.message || 'Percorso non disponibile');
                return `<li title="${this.escapeHtml(label)}">${this.escapeHtml(label)}</li>`;
            }).join('');
            const skippedMore = skippedFilesList.length > maxSkippedToShow
                ? `<div class="run-skipped-more">... altri ${skippedFilesList.length - maxSkippedToShow} file</div>`
                : '';
            const skippedSection = skippedFilesList.length > 0 ? `
                <div class="run-skipped">
                    <span class="run-info-label">File non copiati</span>
                    <div>
                        <ul class="run-skipped-list">${skippedListHtml}</ul>
                        ${skippedMore}
                    </div>
                </div>
            ` : '';

            const retentionSection = retentionEntries.length > 0 ? `
                <div class="run-retention">
                    <span class="run-info-label">Retention</span>
                    <div class="run-retention-details">${retentionEntries.join('')}</div>
                </div>
            ` : '';

            const mappingModes = new Set();
            const mappingDetails = Array.isArray(run.mappings) && run.mappings.length > 0
                ? run.mappings.map(m => {
                    const mode = (m.mode || run.mode_default || 'copy').toLowerCase();
                    mappingModes.add(mode.toUpperCase());
                    const status = this.normalizeRunStatus(m.status) || 'unknown';
                    const statusClass = status === 'failure' ? 'failed' : status;
                    const stats = m.stats || {};
                    const statsBits = [];
                    if (Number.isFinite(stats.copied_files)) statsBits.push(`${stats.copied_files} copiati`);
                    if (Number.isFinite(stats.updated_files) && stats.updated_files > 0) statsBits.push(`${stats.updated_files} aggiornati`);
                    if (Number.isFinite(stats.skipped_files) && stats.skipped_files > 0) statsBits.push(`${stats.skipped_files} saltati`);
                    if (Number.isFinite(stats.failed_files) && stats.failed_files > 0) statsBits.push(`${stats.failed_files} falliti`);
                    const pathLabel = [m.source_path, m.target_path || m.destination_path]
                        .filter(Boolean)
                        .map(p => this.escapeHtml(p))
                        .join(' -> ');
                    const firstError = (m.errors || []).find(Boolean);

                    return `
                        <div class="run-mapping">
                            <div class="run-mapping-header">
                                <div class="run-mapping-title">
                                    <span>${this.escapeHtml(m.label || `Mappatura ${m.index + 1 || 1}`)}</span>
                                    <span class="mapping-mode ${mode}">${mode.toUpperCase()}</span>
                                </div>
                                <span class="mapping-status ${statusClass}">${statusLabelFor(statusClass)}</span>
                            </div>
                            ${pathLabel ? `<div class="mapping-path">${pathLabel}</div>` : ''}
                            <div class="mapping-stats">${statsBits.length ? statsBits.join(' | ') : 'Nessuna statistica disponibile'}</div>
                            ${firstError ? `<div class="mapping-errors">${this.escapeHtml(firstError)}</div>` : ''}
                        </div>
                    `;
                }).join('')
                : '';

            const mappingsSection = mappingDetails
                ? `<div class="run-mappings">${mappingDetails}</div>`
                : '';

            const modeLabel = mappingModes.size > 0
                ? Array.from(mappingModes).join(', ')
                : (run.mode_default || 'copy').toUpperCase();

            const destinations = Array.isArray(run.mappings)
                ? run.mappings
                    .map(m => m.target_path || m.destination_path)
                    .filter(Boolean)
                : [];
            const uniqueDestinations = [...new Set(destinations)];
            const destinationHtml = uniqueDestinations.length > 0
                ? uniqueDestinations.map(dest => `<div class="run-destination-entry">${this.escapeHtml(dest)}</div>`).join('')
                : (run.target_path ? `<div class="run-destination-entry">${this.escapeHtml(run.target_path)}</div>` : '');

            return `
                ${groupHeader}
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
                        <span class="run-info-label">Modalita:</span>
                        <span>${this.escapeHtml(modeLabel)}</span>
                        <span class="run-info-label">Dimensione:</span>
                        <span>${this.formatBytes(totalSize)}</span>
                        ${hasFileStats ? `
                            <span class="run-info-label">File:</span>
                            <span>${copiedFiles}/${totalFiles} copiati${skippedFiles > 0 ? `, ${skippedFiles} saltati` : ''}${failedFiles > 0 ? `, ${failedFiles} falliti` : ''}</span>
                        ` : ''}
                        ${destinationHtml ? `
                            <span class="run-info-label">Dest:</span>
                            <span class="run-destinations">${destinationHtml}</span>
                        ` : ''}
                        ${hasErrors ? `
                            <span class="run-info-label">Errore:</span>
                            <span style="color: var(--error-color);">${this.escapeHtml(errorMsg)}</span>
                        ` : ''}
                    </div>
                    ${retentionSection}
                    ${mappingsSection}
                    ${skippedSection}
                    ${diagnostic}
                </div>
            `;
        }).join('');

        function statusLabelFor(state) {
            if (state === 'success') return 'Successo';
            if (state === 'partial') return 'Parziale';
            if (state === 'running') return 'In corso';
            if (state === 'failed') return 'Fallito';
            return state || 'Sconosciuto';
        }
};

OnlyBackupApp.prototype.renderRunFilters = function() {
        const jobFilter = document.getElementById('runJobFilter');
        if (!jobFilter) return;

        const selected = this.runFilters.job || 'all';
        const jobs = [...new Set(this.runs.map(run => run.job_id).filter(Boolean))].sort();
        jobFilter.innerHTML = '<option value="all">Tutti</option>' + jobs
            .map(jobId => `<option value="${this.escapeForAttribute(jobId)}">${this.escapeHtml(jobId)}</option>`)
            .join('');
        jobFilter.value = jobs.includes(selected) ? selected : 'all';
        this.runFilters.job = jobFilter.value;
};

OnlyBackupApp.prototype.setRunFilter = function(key, value) {
        this.runFilters[key] = value || 'all';
        this.renderRunsList();
};

OnlyBackupApp.prototype.getFilteredRuns = function() {
        const now = Date.now();
        const periodMs = {
            '24h': 24 * 60 * 60 * 1000,
            '7d': 7 * 24 * 60 * 60 * 1000,
            '30d': 30 * 24 * 60 * 60 * 1000
        };

        return this.runs.filter((run) => {
            if (this.runFilters.job !== 'all' && run.job_id !== this.runFilters.job) {
                return false;
            }

            const status = this.deriveRunStatus(run);
            if (this.runFilters.status !== 'all' && status !== this.runFilters.status) {
                return false;
            }

            const windowMs = periodMs[this.runFilters.period];
            if (windowMs) {
                const start = new Date(run.start || run.end || 0).getTime();
                if (!Number.isFinite(start) || now - start > windowMs) {
                    return false;
                }
            }

            return true;
        }).sort((a, b) => {
            const byJob = String(a.job_id || '').localeCompare(String(b.job_id || ''));
            if (byJob !== 0) return byJob;
            return new Date(b.start || 0) - new Date(a.start || 0);
        });
};

OnlyBackupApp.prototype.buildRunDiagnostic = function(run) {
        const status = this.deriveRunStatus(run);
        if (!['failure', 'partial'].includes(status)) {
            return '';
        }

        const firstMappingError = Array.isArray(run.mappings)
            ? run.mappings.flatMap(mapping => mapping.errors || []).find(Boolean)
            : null;
        const firstError = (Array.isArray(run.errors) && run.errors.find(Boolean)) || firstMappingError;
        const hasSkipped = Array.isArray(run.skipped_files) && run.skipped_files.length > 0;

        const cause = firstError
            ? (firstError.message || firstError)
            : hasSkipped
                ? 'Uno o piu file non sono stati copiati.'
                : 'Stato non riuscito senza dettaglio errore nel run.';
        const nextAction = hasSkipped
            ? 'Apri i log completi e verifica permessi, file bloccati o path non raggiungibili.'
            : 'Apri i log completi del job e controlla connettivita agent, credenziali UNC e spazio destinazione.';

        return `
            <div class="run-diagnostic">
                <span class="run-info-label">Diagnostica:</span>
                <div>
                    <div>Probabile causa: ${this.escapeHtml(cause)}</div>
                    <div>Prossima azione: ${this.escapeHtml(nextAction)}</div>
                </div>
            </div>
        `;
};

OnlyBackupApp.prototype.loadRetentionEvents = async function(jobId, runId, mappingIndex) {
        try {
            const container = document.getElementById(`retention-events-${runId}-${mappingIndex}`);
            if (!container) return;

            container.innerHTML = '<div class="info-message">Caricamento...</div>';
            container.style.display = 'block';

            const hostname = this.selectedClient?.hostname || this.selectedClient;
            const response = await fetch(`/api/clients/${hostname}/jobs/${jobId}/retention/events?runId=${runId}`);
            const data = await response.json();

            if (!response.ok) {
                container.innerHTML = `<div class="error-message">Errore: ${data.error || 'Impossibile caricare eventi'}</div>`;
                return;
            }

            const events = data.events || [];
            if (events.length === 0) {
                container.innerHTML = '<div class="run-retention-note">Nessun evento di retention per questo run</div>';
                return;
            }

            const eventsList = events.map(e => {
                const timestamp = e.timestamp ? new Date(e.timestamp).toLocaleString('it-IT') : 'N/A';
                const status = e.success ? 'deleted' : 'failed';
                const reason = e.reason === 'slot_rotation' ? '(rotazione slot)' : '';
                return `
                    <li class="run-retention-entry ${status}">
                        <span class="run-retention-path">${this.escapeHtml(e.path || 'Percorso non disponibile')} ${reason}</span>
                        <span class="run-retention-time">${timestamp}</span>
                        ${!e.success && e.error ? `<span class="run-retention-error">Errore: ${this.escapeHtml(e.error)}</span>` : ''}
                    </li>
                `;
            }).join('');

            container.innerHTML = `<ul>${eventsList}</ul>`;
        } catch (error) {
            const container = document.getElementById(`retention-events-${runId}-${mappingIndex}`);
            if (container) {
                container.innerHTML = `<div class="error-message">Errore caricamento: ${error.message}</div>`;
                container.style.display = 'block';
            }
        }
};

OnlyBackupApp.prototype.formatBytes = function(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
