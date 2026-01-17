const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

class EmailService {
  constructor(storage, logger) {
    this.storage = storage;
    this.logger = logger;
    this.transporter = null;
    this.settings = null;
    this.templates = null;

    this.settingsPath = path.join(storage.dataRoot, 'config', 'email-settings.json');
    this.templatesPath = path.join(storage.dataRoot, 'config', 'email-templates.json');

    this.loadSettings();
    this.loadTemplates();
  }

  loadSettings() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, 'utf8');
        this.settings = JSON.parse(data);
        this.logger.info('Impostazioni email caricate');

        if (this.settings.enabled) {
          this.createTransporter();
        }
      } else {
        this.settings = this.getDefaultSettings();
        this.saveSettings();
      }
    } catch (error) {
      this.logger.error('Errore caricamento impostazioni email', { error: error.message });
      this.settings = this.getDefaultSettings();
    }
  }

  loadTemplates() {
    try {
      if (fs.existsSync(this.templatesPath)) {
        const data = fs.readFileSync(this.templatesPath, 'utf8');
        this.templates = JSON.parse(data);
        this.logger.info('Template email caricati');
      } else {
        this.templates = this.getDefaultTemplates();
        this.saveTemplates();
      }
    } catch (error) {
      this.logger.error('Errore caricamento template email', { error: error.message });
      this.templates = this.getDefaultTemplates();
    }
  }

  getDefaultSettings() {
    return {
      enabled: false,
      smtp: {
        host: '',
        port: 587,
        secure: false,
        auth: {
          type: 'basic',
          user: '',
          pass: ''
        },
        oauth2: {
          clientId: '',
          clientSecret: '',
          refreshToken: '',
          accessToken: ''
        }
      },
      from: '',
      recipients: [],
      events: {
        backup_failed: true,
        backup_partial: true,
        backup_critical: true,
        backup_warning: true,
        agent_offline: true,
        agent_online: false
      }
    };
  }

  getDefaultTemplates() {
    return {
      backup_failed: {
        subject: '[OnlyBackup] Backup fallito - {{hostname}} - {{job_id}}',
        body: `Backup fallito per il client {{hostname}}.

Job ID: {{job_id}}
Run ID: {{run_id}}
Orario: {{timestamp}}
Stato: {{status}}

{{#if errors}}
Errori:
{{#each errors}}
- {{this.message}}
{{/each}}
{{/if}}

{{#if target_path}}
Percorso destinazione: {{target_path}}
{{/if}}

Questo è un messaggio automatico generato da OnlyBackup.`
      },
      backup_partial: {
        subject: '[OnlyBackup] Backup parziale - {{hostname}} - {{job_id}}',
        body: `Backup completato parzialmente per il client {{hostname}}.

Job ID: {{job_id}}
Run ID: {{run_id}}
Orario: {{timestamp}}
Stato: {{status}}

{{#if warnings}}
Avvisi:
{{#each warnings}}
- {{this.message}}
{{/each}}
{{/if}}

{{#if stats}}
Statistiche:
- File totali: {{stats.total_files}}
- File copiati: {{stats.copied_files}}
- File saltati: {{stats.skipped_files}}
- File falliti: {{stats.failed_files}}
{{/if}}

Questo è un messaggio automatico generato da OnlyBackup.`
      },
      backup_critical: {
        subject: '[OnlyBackup] CRITICO - Errore backup - {{hostname}} - {{job_id}}',
        body: `ERRORE CRITICO durante il backup per il client {{hostname}}.

Job ID: {{job_id}}
Run ID: {{run_id}}
Orario: {{timestamp}}

Dettagli errore:
{{error_message}}

Azione richiesta: verificare immediatamente lo stato del client e del job.

Questo è un messaggio automatico generato da OnlyBackup.`
      },
      backup_warning: {
        subject: '[OnlyBackup] Avviso backup - {{hostname}} - {{job_id}}',
        body: `Avviso durante il backup per il client {{hostname}}.

Job ID: {{job_id}}
Run ID: {{run_id}}
Orario: {{timestamp}}

{{#if warnings}}
Avvisi:
{{#each warnings}}
- {{this.message}}
{{/each}}
{{/if}}

Questo è un messaggio automatico generato da OnlyBackup.`
      },
      agent_offline: {
        subject: '[OnlyBackup] Agent offline - {{hostname}}',
        body: `L'agent per il client {{hostname}} è risultato offline.

Ultimo contatto: {{last_seen}}
Durata offline: {{offline_duration}}

{{#if jobs}}
Job interessati:
{{#each jobs}}
- {{this}}
{{/each}}
{{/if}}

Azione richiesta: verificare lo stato del client.

Questo è un messaggio automatico generato da OnlyBackup.`
      },
      agent_online: {
        subject: '[OnlyBackup] Agent tornato online - {{hostname}}',
        body: `L'agent per il client {{hostname}} è tornato online.

Ora online: {{timestamp}}
Durata offline: {{offline_duration}}

Il client è nuovamente disponibile per i backup schedulati.

Questo è un messaggio automatico generato da OnlyBackup.`
      }
    };
  }

  saveSettings() {
    try {
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf8');
      return true;
    } catch (error) {
      this.logger.error('Errore salvataggio impostazioni email', { error: error.message });
      return false;
    }
  }

  saveTemplates() {
    try {
      fs.writeFileSync(this.templatesPath, JSON.stringify(this.templates, null, 2), 'utf8');
      return true;
    } catch (error) {
      this.logger.error('Errore salvataggio template email', { error: error.message });
      return false;
    }
  }

  createTransporter() {
    try {
      if (!this.settings || !this.settings.smtp) {
        return false;
      }

      const transportOptions = {
        host: this.settings.smtp.host,
        port: this.settings.smtp.port,
        secure: this.settings.smtp.secure,
        ignoreTLS: Boolean(this.settings.smtp.ignore_tls)
      };

      const authConfig = this.settings.smtp?.auth || {};
      const authType = authConfig.type || (authConfig.user || authConfig.pass ? 'basic' : 'none');

      if (authType === 'oauth2') {
        transportOptions.auth = {
          type: 'OAuth2',
          user: authConfig.user,
          clientId: this.settings.smtp.oauth2.clientId,
          clientSecret: this.settings.smtp.oauth2.clientSecret,
          refreshToken: this.settings.smtp.oauth2.refreshToken,
          accessToken: this.settings.smtp.oauth2.accessToken
        };
      } else if (authType === 'basic' && authConfig.user && authConfig.pass) {
        transportOptions.auth = {
          user: authConfig.user,
          pass: authConfig.pass
        };
      }

      this.transporter = nodemailer.createTransport(transportOptions);
      this.logger.info('Transporter email creato');
      return true;
    } catch (error) {
      this.logger.error('Errore creazione transporter email', { error: error.message });
      this.transporter = null;
      return false;
    }
  }

  updateSettings(newSettings) {
    try {
      this.settings = { ...this.settings, ...newSettings };
      const saved = this.saveSettings();

      if (saved && this.settings.enabled) {
        this.createTransporter();
      } else if (!this.settings.enabled) {
        this.transporter = null;
      }

      return { success: true };
    } catch (error) {
      this.logger.error('Errore aggiornamento impostazioni email', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  updateTemplates(newTemplates) {
    try {
      this.templates = { ...this.templates, ...newTemplates };
      const saved = this.saveTemplates();
      return { success: saved };
    } catch (error) {
      this.logger.error('Errore aggiornamento template email', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  getSettings() {
    const settings = { ...this.settings };

    if (settings.smtp && settings.smtp.auth) {
      if (settings.smtp.auth.pass) {
        settings.smtp.auth.pass = '********';
      }
      if (settings.smtp.oauth2) {
        if (settings.smtp.oauth2.clientSecret) {
          settings.smtp.oauth2.clientSecret = '********';
        }
        if (settings.smtp.oauth2.refreshToken) {
          settings.smtp.oauth2.refreshToken = '********';
        }
        if (settings.smtp.oauth2.accessToken) {
          settings.smtp.oauth2.accessToken = '********';
        }
      }
    }

    return settings;
  }

  getRawSettings() {
    return JSON.parse(JSON.stringify(this.settings || {}));
  }

  getTemplates() {
    return this.templates;
  }

  replacePlaceholders(template, data) {
    let result = template;

    const ifRegex = /{{#if (\w+)}}([\s\S]*?){{\/if}}/g;
    result = result.replace(ifRegex, (match, condition, content) => {
      return data[condition] ? content : '';
    });

    const eachRegex = /{{#each (\w+)}}([\s\S]*?){{\/each}}/g;
    result = result.replace(eachRegex, (match, arrayName, itemTemplate) => {
      const array = data[arrayName];
      if (!Array.isArray(array)) return '';

      return array.map(item => {
        let itemResult = itemTemplate;
        const thisRegex = /{{this\.(\w+)}}/g;
        itemResult = itemResult.replace(thisRegex, (m, prop) => {
          return item[prop] ?? '';
        });
        itemResult = itemResult.replace(/{{this}}/g, item.toString());
        return itemResult;
      }).join('');
    });

    const getValueByPath = (obj, path) => {
      if (!path) {
        return undefined;
      }
      return path.split('.').reduce((acc, key) => {
        if (acc === null || acc === undefined) {
          return undefined;
        }
        return acc[key];
      }, obj);
    };

    const placeholderRegex = /{{(?!#|\/)([^}]+)}}/g;
    result = result.replace(placeholderRegex, (match, key) => {
      const trimmedKey = key.trim();
      if (trimmedKey === 'this' || trimmedKey.startsWith('this.')) {
        return match;
      }
      const value = getValueByPath(data, trimmedKey);
      if (value === undefined || value === null) {
        return '';
      }
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      return String(value);
    });

    return result;
  }

  async sendEmail(eventType, data) {
    try {
      if (!this.settings || !this.settings.enabled) {
        this.logger.debug('Email non inviate: servizio disabilitato');
        return { success: false, reason: 'Email service disabled' };
      }

      if (!this.settings.events[eventType]) {
        this.logger.debug(`Email non inviate: evento ${eventType} disabilitato`);
        return { success: false, reason: `Event ${eventType} disabled` };
      }

      if (!this.settings.recipients || this.settings.recipients.length === 0) {
        this.logger.warn('Email non inviate: nessun destinatario configurato');
        return { success: false, reason: 'No recipients configured' };
      }

      if (!this.transporter) {
        this.createTransporter();
        if (!this.transporter) {
          this.logger.error('Email non inviate: impossibile creare transporter');
          return { success: false, reason: 'Failed to create transporter' };
        }
      }

      const template = this.templates[eventType];
      if (!template) {
        this.logger.error(`Template non trovato per evento: ${eventType}`);
        return { success: false, reason: 'Template not found' };
      }

      const subject = this.replacePlaceholders(template.subject, data);
      const body = this.replacePlaceholders(template.body, data);

      const mailOptions = {
        from: this.settings.from,
        to: this.settings.recipients.join(', '),
        subject,
        text: body
      };

      const info = await this.transporter.sendMail(mailOptions);

      this.logger.info('Email inviata con successo', {
        eventType,
        messageId: info.messageId,
        recipients: this.settings.recipients
      });

      return { success: true, messageId: info.messageId };
    } catch (error) {
      this.logger.error('Errore invio email', {
        eventType,
        error: error.message,
        stack: error.stack
      });
      return { success: false, error: error.message };
    }
  }

  async sendTestEmail(recipient) {
    try {
      if (!this.settings || !this.settings.enabled) {
        return { success: false, error: 'Servizio email disabilitato' };
      }

      if (!this.transporter) {
        this.createTransporter();
        if (!this.transporter) {
          return { success: false, error: 'Impossibile creare transporter' };
        }
      }

      const mailOptions = {
        from: this.settings.from,
        to: recipient,
        subject: '[OnlyBackup] Test email di configurazione',
        text: `Questo è un messaggio di test da OnlyBackup.

Se ricevi questa email, la configurazione SMTP è corretta.

Timestamp: ${this.formatTimestamp(new Date())}

OnlyBackup Server`
      };

      const info = await this.transporter.sendMail(mailOptions);

      this.logger.info('Email di test inviata', {
        messageId: info.messageId,
        recipient
      });

      return { success: true, messageId: info.messageId };
    } catch (error) {
      const baseMessage = error.message || 'Errore invio email di test';
      const shouldSuggestSystemCa = /self[-\s]?signed certificate/i.test(baseMessage);
      const hint = shouldSuggestSystemCa
        ? ' self-signed certificate; if the root CA is installed locally, try running Node.js with --use-system-ca. Otherwise, install the CA locally or set NODE_EXTRA_CA_CERTS to the CA bundle path.'
        : '';
      const errorMessage = `${baseMessage}${hint}`;
      this.logger.error('Errore invio email di test', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  async notifyBackupStatus(run, job) {
    try {
      let eventType = null;

      switch (run.status) {
        case 'failed':
          eventType = 'backup_failed';
          break;
        case 'partial':
          eventType = 'backup_partial';
          break;
        default:
          return { success: false, reason: 'No notification needed for status: ' + run.status };
      }

      const data = {
        hostname: run.client_hostname || 'unknown',
        job_id: run.job_id || 'unknown',
        run_id: run.run_id || 'unknown',
        timestamp: new Date(run.end || run.start).toLocaleString('it-IT'),
        status: run.status,
        target_path: run.target_path || 'N/A',
        errors: run.errors || [],
        warnings: run.warnings || [],
        stats: run.stats || null
      };

      return await this.sendEmail(eventType, data);
    } catch (error) {
      this.logger.error('Errore notifica stato backup', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  formatTimestamp(date) {
    const pad = value => String(value).padStart(2, '0');
    const day = pad(date.getDate());
    const month = pad(date.getMonth() + 1);
    const year = date.getFullYear();
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    return `${day}-${month}-${year} ${hours}:${minutes}`;
  }

  async notifyAgentStatus(hostname, status, lastSeen, jobs = []) {
    try {
      const eventType = status === 'offline' ? 'agent_offline' : 'agent_online';

      const now = new Date();
      const lastSeenDate = new Date(lastSeen);
      const offlineDuration = Math.floor((now - lastSeenDate) / 1000 / 60);

      const data = {
        hostname,
        timestamp: now.toLocaleString('it-IT'),
        last_seen: lastSeenDate.toLocaleString('it-IT'),
        offline_duration: offlineDuration > 60
          ? `${Math.floor(offlineDuration / 60)} ore e ${offlineDuration % 60} minuti`
          : `${offlineDuration} minuti`,
        jobs
      };

      return await this.sendEmail(eventType, data);
    } catch (error) {
      this.logger.error('Errore notifica stato agent', { error: error.message });
      return { success: false, error: error.message };
    }
  }
}

module.exports = EmailService;
