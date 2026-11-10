OnlyBackupApp.prototype.renderJobEditor = function() {
        const emptyState = document.getElementById('jobEditorEmpty');
        const form = document.getElementById('jobEditorForm');
        const errorDiv = document.getElementById('jobFormError');
        const cancelBtn = document.getElementById('cancelJobBtn');

        if (cancelBtn) {
            cancelBtn.classList.toggle('hidden', !this.isNewJob);
        }

        if (!this.editingJob) {
            form.classList.add('hidden');
            emptyState.classList.remove('hidden');
            if (cancelBtn) cancelBtn.classList.add('hidden');
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
            <span class="time-chip">${this.escapeHtml(t)} <button type="button" onclick="app.removeScheduleTime(${idx})" aria-label="Rimuovi orario ${this.escapeForAttribute(t)}">\u00D7</button></span>
        `).join('');

        const mappingsContainer = document.getElementById('mappingsContainer');
        mappingsContainer.innerHTML = this.editingJob.mappings.map((mapping, index) => {
            const isCopy = (mapping.mode || this.editingJob.mode_default || 'copy') === 'copy';
            return `
                    <div class="mapping-card">
                        <div class="mapping-header">
                            <div class="mapping-title">Mappatura ${index + 1}${mapping.label ? ` - ${this.escapeHtml(mapping.label)}` : ''}</div>
                            <button type="button" class="btn btn-icon btn-small" onclick="app.removeMapping(${index})" title="Rimuovi mappatura" aria-label="Rimuovi mappatura ${index + 1}">\u2715</button>
                        </div>
                        <div class="form-row">
                            <label>Etichetta</label>
                            <input type="text" value="${this.escapeForAttribute(mapping.label || '')}"
                                   oninput="app.updateMappingField(${index}, 'label', this.value)"
                                   placeholder="es. Documenti utente"
                                   aria-label="Etichetta mappatura ${index + 1}">
                        </div>
                        <div class="form-row">
                            <label>Percorso sorgente</label>
                            <div class="path-input">
                                <input type="text" value="${this.escapeForAttribute(mapping.source_path || '')}"
                                       oninput="app.updateMappingField(${index}, 'source_path', this.value)"
                                       placeholder="es. C:\\Users\\Documents"
                                       aria-label="Percorso sorgente mappatura ${index + 1}">
                                <button type="button" class="btn btn-outline btn-small" onclick="app.openBrowseModal(${index})" aria-label="Sfoglia percorso sorgente mappatura ${index + 1}">Sfoglia</button>
                            </div>
                        </div>
                        <div class="form-row">
                            <label>Percorso destinazione</label>
                            <input type="text" value="${this.escapeForAttribute(mapping.destination_path || '')}"
                                   oninput="app.updateMappingField(${index}, 'destination_path', this.value)"
                                   placeholder="es. \\NAS\\Backups\\Documents"
                                   aria-label="Percorso destinazione mappatura ${index + 1}">
                        </div>
                        <div class="form-row">
                            <label>Modalita</label>
                            <select onchange="app.handleMappingModeChange(${index}, this.value)" aria-label="Modalita mappatura ${index + 1}">
                                <option value="copy" ${mapping.mode === 'copy' ? 'selected' : ''}>Copy (versioni multiple)</option>
                                <option value="sync" ${mapping.mode === 'sync' ? 'selected' : ''}>Sync (sovrascrittura)</option>
                            </select>
                        </div>
                        <div class="form-row retention-row ${isCopy ? '' : 'hidden'}">
                            <label>Retention (max versioni)</label>
                            <input type="number" min="1" max="100" value="${mapping.retention?.max_backups || 5}"
                                   oninput="app.updateMappingField(${index}, 'retention', this.value)"
                                   aria-label="Retention massima mappatura ${index + 1}">
                        </div>
                        <div class="form-row">
                            <label>Credenziali NAS/SMB (opzionale)</label>
                            <div class="credentials-grid">
                                <input type="text" placeholder="Username"
                                       aria-label="Username credenziali mappatura ${index + 1}"
                                       value="${this.escapeForAttribute(mapping.credentials?.username || '')}"
                                       oninput="app.updateMappingCredential(${index}, 'username', this.value)">
                                <input type="password" placeholder="Password"
                                       aria-label="Password credenziali mappatura ${index + 1}"
                                       value="${this.escapeForAttribute(mapping.credentials?.password || '')}"
                                       oninput="app.updateMappingCredential(${index}, 'password', this.value)">
                                <input type="text" placeholder="Dominio"
                                       aria-label="Dominio credenziali mappatura ${index + 1}"
                                       value="${this.escapeForAttribute(mapping.credentials?.domain || '')}"
                                       oninput="app.updateMappingCredential(${index}, 'domain', this.value)">
                            </div>
                        </div>
                        <div class="mapping-actions-row">
                            <button type="button" class="btn btn-outline btn-small" onclick="app.openLogViewer(${index})">Log completi</button>
                        </div>
                    </div>
                `;
        }).join('');

        this.renderJobWizardReview();
        this.setJobWizardStep(this.jobWizardStep || 'client');
};

OnlyBackupApp.prototype.setJobWizardStep = function(step) {
        const steps = ['client', 'schedule', 'mappings', 'review'];
        const nextStep = steps.includes(step) ? step : 'client';
        this.jobWizardStep = nextStep;

        document.querySelectorAll('.job-wizard-step').forEach((button) => {
            const selected = button.dataset.step === nextStep;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-selected', selected ? 'true' : 'false');
        });

        document.querySelectorAll('[data-wizard-step]').forEach((section) => {
            section.hidden = section.getAttribute('data-wizard-step') !== nextStep;
        });

        const prev = document.getElementById('jobWizardPrevButton');
        const next = document.getElementById('jobWizardNextButton');
        if (prev) prev.disabled = nextStep === 'client';
        if (next) {
            next.disabled = nextStep === 'review';
            next.textContent = nextStep === 'mappings' ? 'Revisione' : 'Avanti';
        }

        if (nextStep === 'review') {
            this.renderJobWizardReview();
        }
};

OnlyBackupApp.prototype.nextJobWizardStep = function() {
        const steps = ['client', 'schedule', 'mappings', 'review'];
        const index = steps.indexOf(this.jobWizardStep);
        this.setJobWizardStep(steps[Math.min(index + 1, steps.length - 1)]);
};

OnlyBackupApp.prototype.previousJobWizardStep = function() {
        const steps = ['client', 'schedule', 'mappings', 'review'];
        const index = steps.indexOf(this.jobWizardStep);
        this.setJobWizardStep(steps[Math.max(index - 1, 0)]);
};

OnlyBackupApp.prototype.renderJobWizardReview = function() {
        const container = document.getElementById('jobReviewContent');
        if (!container || !this.editingJob) return;
        const draft = this.buildJobPayloadFromEditor({ validate: false });
        container.innerHTML = this.renderJobPreview(draft || this.editingJob);
};

OnlyBackupApp.prototype.renderJobPreview = function(job) {
        if (!job) {
            return '<div class="info-message">Nessun job selezionato.</div>';
        }

        const mappings = Array.isArray(job.mappings) ? job.mappings : [];
        const days = Array.isArray(job.schedule?.days) ? job.schedule.days : [];
        const times = Array.isArray(job.schedule?.times) ? job.schedule.times : [];
        const dayNames = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
        const schedule = `${days.map(day => dayNames[day]).filter(Boolean).join(', ') || 'Nessun giorno'} @ ${times.join(', ') || 'nessun orario'}`;
        const uncWithCredentials = mappings.filter(mapping =>
            /^\\\\/.test(mapping.destination_path || '') && mapping.credentials?.username
        ).length;

        return `
            <div class="preview-grid">
                <div><span class="preview-label">Job</span><strong>${this.escapeHtml(job.job_id || '')}</strong></div>
                <div><span class="preview-label">Client</span><strong>${this.escapeHtml(job.client_hostname || this.selectedClient || '')}</strong></div>
                <div><span class="preview-label">Stato</span><strong>${job.enabled === false ? 'Disattivo' : 'Attivo'}</strong></div>
                <div><span class="preview-label">Pianificazione</span><strong>${this.escapeHtml(schedule)}</strong></div>
                <div><span class="preview-label">Credenziali UNC</span><strong>${uncWithCredentials > 0 ? `${uncWithCredentials} configurate` : 'Non presenti'}</strong></div>
            </div>
            <div class="preview-mappings">
                ${mappings.map((mapping, index) => `
                    <div class="preview-mapping">
                        <div class="preview-mapping-title">Mappatura ${index + 1}: ${this.escapeHtml(mapping.label || 'Senza etichetta')}</div>
                        <div>${this.escapeHtml(mapping.source_path || 'Sorgente mancante')} -> ${this.escapeHtml(mapping.destination_path || 'Destinazione mancante')}</div>
                        <div>Modalita: ${this.escapeHtml((mapping.mode || job.mode_default || 'copy').toUpperCase())}${(mapping.mode || job.mode_default || 'copy') === 'copy' ? ` | Retention: ${this.escapeHtml(String(mapping.retention?.max_backups || 5))}` : ''}</div>
                    </div>
                `).join('') || '<div class="info-message">Nessuna mappatura configurata.</div>'}
            </div>
        `;
};

OnlyBackupApp.prototype.addScheduleTime = function() {
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
            this.renderJobsList();
        }
};

OnlyBackupApp.prototype.removeScheduleTime = function(index) {
        if (!this.editingJob) return;
        this.editingJob.schedule.times.splice(index, 1);
        this.renderJobEditor();
        this.renderJobsList();
};

OnlyBackupApp.prototype.addMapping = function() {
        if (!this.editingJob) return;
        this.editingJob.mappings.push(this.createEmptyMapping());
        this.renderJobEditor();
        this.renderJobsList();
};

OnlyBackupApp.prototype.removeMapping = function(index) {
        if (!this.editingJob) return;
        this.editingJob.mappings.splice(index, 1);
        if (this.editingJob.mappings.length === 0) {
            this.editingJob.mappings.push(this.createEmptyMapping());
        }
        this.renderJobEditor();
        this.renderJobsList();
};

OnlyBackupApp.prototype.updateMappingField = function(index, field, value) {
        if (!this.editingJob?.mappings[index]) return;
        if (field === 'retention') {
            const parsed = parseInt(value, 10);
            this.editingJob.mappings[index].retention = { max_backups: parsed > 0 ? parsed : 1 };
        } else {
            this.editingJob.mappings[index][field] = value;
        }
        this.renderJobWizardReview();
        this.renderJobsList();
};

OnlyBackupApp.prototype.updateMappingCredential = function(index, field, value) {
        if (!this.editingJob?.mappings[index]) return;
        if (!this.editingJob.mappings[index].credentials) {
            this.editingJob.mappings[index].credentials = { type: 'nas', username: '', password: '', domain: '' };
        }
        this.editingJob.mappings[index].credentials[field] = value;
        this.renderJobWizardReview();
        this.renderJobsList();
};

OnlyBackupApp.prototype.handleMappingModeChange = function(index, mode) {
        if (!this.editingJob?.mappings[index]) return;
        this.editingJob.mappings[index].mode = mode;
        if (mode !== 'copy') {
            delete this.editingJob.mappings[index].retention;
        } else if (!this.editingJob.mappings[index].retention) {
            this.editingJob.mappings[index].retention = { max_backups: 5 };
        }
        this.renderJobEditor();
        this.renderJobsList();
};

OnlyBackupApp.prototype.handleSaveJob = async function() {
        if (!this.editingJob) return;

        const saveBtn = document.getElementById('saveJobButton');
        const errorDiv = document.getElementById('jobFormError');

        this.setButtonLoading(saveBtn, true);

        const validation = this.validateJobDraft();
        if (!validation.valid) {
            errorDiv.textContent = validation.error;
            this.setJobWizardStep(validation.step || 'review');
            this.setButtonLoading(saveBtn, false);
            return;
        }

        const payload = this.buildJobPayloadFromEditor({ validate: true });
        const jobId = payload.job_id;
        const confirmed = await this.showJobPreview({
            title: 'Revisione salvataggio job',
            actionLabel: 'Salva job',
            payload
        });

        if (!confirmed) {
            this.setButtonLoading(saveBtn, false);
            return;
        }

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
                this.showToast('success', 'Job salvato', `Il job ${jobId} e stato salvato`);
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
};

OnlyBackupApp.prototype.buildJobPayloadFromEditor = function() {
        if (!this.editingJob) return null;
        const selectedDays = Array.from(document.querySelectorAll('#scheduleDays input[type="checkbox"]:checked')).map(cb => parseInt(cb.value, 10));
        const scheduleTimes = this.editingJob.schedule?.times || [];
        const jobId = document.getElementById('jobIdField')?.value.trim() || this.editingJob.job_id;

        return {
            job_id: jobId,
            client_hostname: this.selectedClient,
            enabled: document.getElementById('jobEnabledToggle')?.checked ?? true,
            mode_default: this.editingJob.mode_default || 'copy',
            schedule: {
                type: 'daily',
                days: selectedDays,
                times: scheduleTimes
            },
            mappings: (this.editingJob.mappings || []).map(m => {
                const mode = m.mode || this.editingJob.mode_default || 'copy';
                return {
                    label: m.label || '',
                    source_path: (m.source_path || '').trim(),
                    destination_path: (m.destination_path || '').trim(),
                    mode,
                    retention: mode === 'copy'
                        ? { max_backups: m.retention?.max_backups || 5 }
                        : undefined,
                    credentials: m.credentials?.username
                        ? m.credentials
                        : undefined
                };
            })
        };
};

OnlyBackupApp.prototype.validateJobDraft = function() {
        const payload = this.buildJobPayloadFromEditor();
        if (!payload?.job_id) {
            return { valid: false, error: 'Job ID obbligatorio', step: 'client' };
        }
        if (!payload.schedule.days.length) {
            return { valid: false, error: 'Seleziona almeno un giorno della settimana', step: 'schedule' };
        }
        if (!payload.schedule.times.length) {
            return { valid: false, error: 'Aggiungi almeno un orario di esecuzione', step: 'schedule' };
        }
        if (!payload.mappings.length) {
            return { valid: false, error: 'Aggiungi almeno una mappatura', step: 'mappings' };
        }

        for (let index = 0; index < payload.mappings.length; index += 1) {
            const mapping = payload.mappings[index];
            if (!mapping.source_path || !mapping.destination_path) {
                return { valid: false, error: `Compila sorgente e destinazione della mappatura ${index + 1}`, step: 'mappings' };
            }
            if (!['copy', 'sync'].includes((mapping.mode || '').toLowerCase())) {
                return { valid: false, error: `Modalita non valida nella mappatura ${index + 1}`, step: 'mappings' };
            }
            if (this.pathsOverlapInUi(mapping.source_path, mapping.destination_path)) {
                return { valid: false, error: `Sorgente e destinazione si sovrappongono nella mappatura ${index + 1}`, step: 'mappings' };
            }
        }

        return { valid: true };
};

OnlyBackupApp.prototype.pathsOverlapInUi = function(pathA, pathB) {
        const normalize = (value) => String(value || '')
            .trim()
            .replace(/\\/g, '/')
            .replace(/\/+$/g, '')
            .toLowerCase();
        const a = normalize(pathA);
        const b = normalize(pathB);
        if (!a || !b) return false;
        return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
};
