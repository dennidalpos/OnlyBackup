OnlyBackupApp.prototype.renderJobEditor = function() {
        const emptyState = document.getElementById('jobEditorEmpty');
        const form = document.getElementById('jobEditorForm');
        const errorDiv = document.getElementById('jobFormError');
        const cancelBtn = document.getElementById('cancelJobBtn');

        if (cancelBtn) {
            cancelBtn.style.display = this.isNewJob ? 'inline-flex' : 'none';
        }

        if (!this.editingJob) {
            form.classList.add('hidden');
            emptyState.classList.remove('hidden');
            if (cancelBtn) cancelBtn.style.display = 'none';
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
            <span class="time-chip">${this.escapeHtml(t)} <button type="button" onclick="app.removeScheduleTime(${idx})">\u00D7</button></span>
        `).join('');

        const mappingsContainer = document.getElementById('mappingsContainer');
        mappingsContainer.innerHTML = this.editingJob.mappings.map((mapping, index) => {
            const isCopy = (mapping.mode || this.editingJob.mode_default || 'copy') === 'copy';
            return `
                    <div class="mapping-card">
                        <div class="mapping-header">
                            <div class="mapping-title">Mappatura ${index + 1}${mapping.label ? ` - ${this.escapeHtml(mapping.label)}` : ''}</div>
                            <button type="button" class="btn btn-icon btn-small" onclick="app.removeMapping(${index})" title="Rimuovi mappatura">\u2715</button>
                        </div>
                        <div class="form-row">
                            <label>Etichetta</label>
                            <input type="text" value="${this.escapeForAttribute(mapping.label || '')}"
                                   oninput="app.updateMappingField(${index}, 'label', this.value)"
                                   placeholder="es. Documenti utente">
                        </div>
                        <div class="form-row">
                            <label>Percorso sorgente</label>
                            <div class="path-input">
                                <input type="text" value="${this.escapeForAttribute(mapping.source_path || '')}"
                                       oninput="app.updateMappingField(${index}, 'source_path', this.value)"
                                       placeholder="es. C:\\Users\\Documents">
                                <button type="button" class="btn btn-outline btn-small" onclick="app.openBrowseModal(${index})">Sfoglia</button>
                            </div>
                        </div>
                        <div class="form-row">
                            <label>Percorso destinazione</label>
                            <input type="text" value="${this.escapeForAttribute(mapping.destination_path || '')}"
                                   oninput="app.updateMappingField(${index}, 'destination_path', this.value)"
                                   placeholder="es. \\NAS\\Backups\\Documents">
                        </div>
                        <div class="form-row">
                            <label>Modalita</label>
                            <select onchange="app.handleMappingModeChange(${index}, this.value)">
                                <option value="copy" ${mapping.mode === 'copy' ? 'selected' : ''}>Copy (versioni multiple)</option>
                                <option value="sync" ${mapping.mode === 'sync' ? 'selected' : ''}>Sync (sovrascrittura)</option>
                            </select>
                        </div>
                        <div class="form-row retention-row ${isCopy ? '' : 'hidden'}">
                            <label>Retention (max versioni)</label>
                            <input type="number" min="1" max="100" value="${mapping.retention?.max_backups || 5}"
                                   oninput="app.updateMappingField(${index}, 'retention', this.value)">
                        </div>
                        <div class="form-row">
                            <label>Credenziali NAS/SMB (opzionale)</label>
                            <div class="credentials-grid">
                                <input type="text" placeholder="Username"
                                       value="${this.escapeForAttribute(mapping.credentials?.username || '')}"
                                       oninput="app.updateMappingCredential(${index}, 'username', this.value)">
                                <input type="password" placeholder="Password"
                                       value="${this.escapeForAttribute(mapping.credentials?.password || '')}"
                                       oninput="app.updateMappingCredential(${index}, 'password', this.value)">
                                <input type="text" placeholder="Dominio"
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
        this.renderJobsList();
};

OnlyBackupApp.prototype.updateMappingCredential = function(index, field, value) {
        if (!this.editingJob?.mappings[index]) return;
        if (!this.editingJob.mappings[index].credentials) {
            this.editingJob.mappings[index].credentials = { type: 'nas', username: '', password: '', domain: '' };
        }
        this.editingJob.mappings[index].credentials[field] = value;
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

        const saveBtn = this.getButtonByText('Salva');
        const errorDiv = document.getElementById('jobFormError');
        const jobId = document.getElementById('jobIdField').value.trim();

        this.setButtonLoading(saveBtn, true);

        if (!jobId) {
            errorDiv.textContent = 'Job ID obbligatorio';
            this.setButtonLoading(saveBtn, false);
            return;
        }

        const selectedDays = Array.from(document.querySelectorAll('#scheduleDays input[type="checkbox"]:checked')).map(cb => parseInt(cb.value));
        const scheduleTimes = this.editingJob.schedule?.times || [];

        if (selectedDays.length === 0) {
            errorDiv.textContent = 'Seleziona almeno un giorno della settimana';
            this.setButtonLoading(saveBtn, false);
            return;
        }

        if (scheduleTimes.length === 0) {
            errorDiv.textContent = 'Aggiungi almeno un orario di esecuzione';
            this.setButtonLoading(saveBtn, false);
            return;
        }

        const mappingsValid = this.editingJob.mappings.every(m => m.source_path && m.destination_path);
        if (!mappingsValid) {
            errorDiv.textContent = 'Compila tutti i percorsi sorgente e destinazione';
            this.setButtonLoading(saveBtn, false);
            return;
        }

        const payload = {
            job_id: jobId,
            client_hostname: this.selectedClient,
            enabled: document.getElementById('jobEnabledToggle').checked,
            mode_default: this.editingJob.mode_default || 'copy',
            schedule: {
                type: 'daily',
                days: selectedDays,
                times: scheduleTimes
            },
            mappings: this.editingJob.mappings.map(m => ({
                label: m.label || '',
                source_path: m.source_path,
                destination_path: m.destination_path,
                mode: m.mode || this.editingJob.mode_default || 'copy',
                retention: (m.mode || this.editingJob.mode_default || 'copy') === 'copy'
                    ? { max_backups: m.retention?.max_backups || 5 }
                    : undefined,
                credentials: m.credentials?.username
                    ? m.credentials
                    : undefined
            }))
        };

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
                this.showToast('success', 'Job salvato', `Il job ${jobId} Ã¨ stato salvato`);
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
