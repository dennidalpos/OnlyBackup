const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

class AgentPackageService {
  constructor(logger, config) {
    this.logger = logger;
    this.config = config;
    this.rootDir = path.resolve(__dirname, '..', '..', '..');
    this.scriptPath = path.join(this.rootDir, 'scripts', 'Build-AgentMsi.ps1');
    this.msiPath = process.env.ONLYBACKUP_AGENT_MSI_PATH
      || path.join(this.rootDir, 'output', 'agent-msi', 'artifacts', 'OnlyBackupAgent.msi');
    this.currentBuild = null;
    this.builds = new Map();
  }

  getPackageOptions(req) {
    const serverPort = Number(this.config?.server?.port || 8080);
    const candidates = this.getServerHostCandidates(req);
    const suggested = candidates.find(candidate => candidate.recommended) || candidates[0] || null;

    return {
      suggestedServerHost: suggested?.host || '',
      serverPort,
      candidates,
      artifact: this.getArtifactStatus()
    };
  }

  getServerHostCandidates(req) {
    const candidates = [];
    const addCandidate = (host, source, recommended = false) => {
      const normalized = this.normalizeCandidateHost(host);
      if (!normalized || this.isLocalOnlyHost(normalized)) {
        return;
      }
      if (candidates.some(candidate => candidate.host.toLowerCase() === normalized.toLowerCase())) {
        return;
      }
      candidates.push({ host: normalized, source, recommended });
    };

    const publicUrl = this.config?.server?.publicUrl;
    if (publicUrl) {
      try {
        addCandidate(new URL(publicUrl).hostname, 'config.server.publicUrl', true);
      } catch (error) {
        this.logger.warn('config.server.publicUrl non valido per generazione agent', { error: error.message });
      }
    }

    const requestHost = req?.get('x-forwarded-host') || req?.get('host');
    if (!candidates.some(candidate => candidate.recommended)) {
      addCandidate(requestHost, 'richiesta HTTP', true);
    } else {
      addCandidate(requestHost, 'richiesta HTTP', false);
    }

    const interfaceHosts = this.getLanIpv4Addresses();
    interfaceHosts.forEach((address, index) => {
      addCandidate(address, 'interfaccia di rete', candidates.length === 0 && index === 0);
    });

    return candidates;
  }

  getLanIpv4Addresses() {
    const interfaces = os.networkInterfaces();
    const addresses = [];

    Object.values(interfaces).forEach((entries) => {
      (entries || []).forEach((entry) => {
        if (entry.family !== 'IPv4' || entry.internal || this.isLocalOnlyHost(entry.address)) {
          return;
        }
        addresses.push(entry.address);
      });
    });

    return addresses;
  }

  normalizeCandidateHost(host) {
    if (!host) {
      return '';
    }

    let normalized = String(host).trim();
    if (!normalized) {
      return '';
    }

    if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
      try {
        normalized = new URL(normalized).hostname;
      } catch {
        return '';
      }
    }

    if (normalized.startsWith('[')) {
      const closingBracket = normalized.indexOf(']');
      normalized = closingBracket >= 0 ? normalized.slice(1, closingBracket) : normalized;
    } else if (normalized.includes(':')) {
      normalized = normalized.split(':')[0];
    }

    return normalized.trim();
  }

  isLocalOnlyHost(host) {
    const normalized = String(host || '').trim().toLowerCase();
    return normalized === 'localhost'
      || normalized === '::1'
      || normalized === '0.0.0.0'
      || normalized.startsWith('127.');
  }

  validateBuildRequest(payload) {
    const serverHost = String(payload?.serverHost || '').trim();
    const serverPort = Number(payload?.serverPort || this.config?.server?.port || 8080);

    if (!serverHost) {
      throw this.createValidationError('Indirizzo server richiesto');
    }

    if (serverHost.startsWith('http://') || serverHost.startsWith('https://') || /[\/\\]/.test(serverHost)) {
      throw this.createValidationError('Inserisci solo hostname o IP, senza protocollo o percorso');
    }

    if (this.isLocalOnlyHost(serverHost)) {
      throw this.createValidationError('Usa un IP o hostname raggiungibile dagli agent, non localhost');
    }

    const hostPattern = /^[a-zA-Z0-9._-]+$/;
    if (!hostPattern.test(serverHost) || serverHost.length > 253) {
      throw this.createValidationError('Hostname/IP server non valido');
    }

    if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) {
      throw this.createValidationError('Porta server non valida');
    }

    return { serverHost, serverPort };
  }

  createValidationError(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  }

  startBuild(payload, username) {
    if (this.currentBuild?.status === 'running') {
      const error = new Error('Build agent gia in corso');
      error.statusCode = 409;
      throw error;
    }

    const { serverHost, serverPort } = this.validateBuildRequest(payload);
    if (!fs.existsSync(this.scriptPath)) {
      const error = new Error('Script build agent non trovato');
      error.statusCode = 500;
      throw error;
    }

    const build = {
      buildId: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
      status: 'running',
      serverHost,
      serverPort,
      requestedBy: username || null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      exitCode: null,
      error: null,
      logTail: []
    };

    this.currentBuild = build;
    this.builds.set(build.buildId, build);
    this.trimBuildHistory();

    const args = [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', this.scriptPath,
      '-ServerHost', serverHost,
      '-ServerPort', String(serverPort)
    ];

    this.logger.info('Build MSI agent avviata', { buildId: build.buildId, serverHost, serverPort, username });

    const child = spawn('powershell.exe', args, {
      cwd: this.rootDir,
      windowsHide: true
    });

    child.stdout.on('data', (chunk) => this.appendBuildLog(build, chunk));
    child.stderr.on('data', (chunk) => this.appendBuildLog(build, chunk));

    child.on('error', (error) => {
      build.status = 'failed';
      build.error = error.message;
      build.completedAt = new Date().toISOString();
      this.currentBuild = null;
      this.logger.error('Errore avvio build MSI agent', { buildId: build.buildId, error: error.message });
    });

    child.on('close', (code) => {
      build.exitCode = code;
      build.completedAt = new Date().toISOString();
      build.status = code === 0 && fs.existsSync(this.msiPath) ? 'completed' : 'failed';
      if (build.status === 'failed' && !build.error) {
        build.error = code === 0 ? 'MSI non trovato dopo la build' : `Build fallita con exit code ${code}`;
      }
      this.currentBuild = null;
      this.logger[build.status === 'completed' ? 'info' : 'error']('Build MSI agent terminata', {
        buildId: build.buildId,
        status: build.status,
        exitCode: code,
        error: build.error
      });
    });

    return this.getBuildStatus(build.buildId);
  }

  appendBuildLog(build, chunk) {
    const lines = String(chunk || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    build.logTail.push(...lines);
    if (build.logTail.length > 80) {
      build.logTail = build.logTail.slice(-80);
    }
  }

  getBuildStatus(buildId) {
    const build = this.builds.get(buildId);
    if (!build) {
      return null;
    }

    return {
      buildId: build.buildId,
      status: build.status,
      serverHost: build.serverHost,
      serverPort: build.serverPort,
      startedAt: build.startedAt,
      completedAt: build.completedAt,
      exitCode: build.exitCode,
      error: build.error,
      logTail: build.logTail,
      artifact: this.getArtifactStatus()
    };
  }

  getArtifactStatus() {
    if (!fs.existsSync(this.msiPath)) {
      return { exists: false };
    }

    const stat = fs.statSync(this.msiPath);
    return {
      exists: true,
      filename: path.basename(this.msiPath),
      sizeBytes: stat.size,
      updatedAt: stat.mtime.toISOString()
    };
  }

  getArtifactPath() {
    return fs.existsSync(this.msiPath) ? this.msiPath : null;
  }

  trimBuildHistory() {
    const entries = Array.from(this.builds.entries());
    if (entries.length <= 20) {
      return;
    }

    entries.slice(0, entries.length - 20).forEach(([buildId]) => {
      if (this.currentBuild?.buildId !== buildId) {
        this.builds.delete(buildId);
      }
    });
  }
}

module.exports = AgentPackageService;
