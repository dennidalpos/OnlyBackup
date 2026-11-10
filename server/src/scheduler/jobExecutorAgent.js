const fs = require('fs');
const path = require('path');
const http = require('http');

const AgentErrorCodes = {
  AGENT_UNREACHABLE: 'AGENT_UNREACHABLE',
  AGENT_TIMEOUT: 'AGENT_TIMEOUT',
  AGENT_INVALID_RESPONSE: 'AGENT_INVALID_RESPONSE',
  UNC_INVALID_FORMAT: 'UNC_INVALID_FORMAT',
  NETWORK_PATH_NOT_FOUND: 'NETWORK_PATH_NOT_FOUND',
  ACCESS_DENIED: 'ACCESS_DENIED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  SOURCE_NOT_FOUND: 'SOURCE_NOT_FOUND',
  DESTINATION_WRITE_ERROR: 'DESTINATION_WRITE_ERROR',
  PATH_TOO_LONG: 'PATH_TOO_LONG',
  SOURCE_EQUALS_DESTINATION: 'SOURCE_EQUALS_DESTINATION',
  PATH_OVERLAP: 'PATH_OVERLAP',
  UNKNOWN_AGENT_ERROR: 'UNKNOWN_AGENT_ERROR'
};

const ErrorMessages = {
  AGENT_UNREACHABLE: 'Agent non raggiungibile (connessione rifiutata o timeout)',
  AGENT_TIMEOUT: 'Timeout comunicazione con agent',
  UNC_INVALID_FORMAT: 'Formato percorso UNC non valido',
  NETWORK_PATH_NOT_FOUND: 'Percorso di rete non raggiungibile o inesistente',
  ACCESS_DENIED: 'Accesso negato al percorso di destinazione',
  INVALID_CREDENTIALS: 'Credenziali non valide per l\'accesso al NAS',
  SOURCE_NOT_FOUND: 'Percorso sorgente non trovato',
  DESTINATION_WRITE_ERROR: 'Impossibile scrivere nella destinazione',
  PATH_TOO_LONG: 'Percorso troppo lungo (supera il limite di 260 caratteri)',
  SOURCE_EQUALS_DESTINATION: 'Sorgente e destinazione sono identiche',
  PATH_OVERLAP: 'Sorgente e destinazione si sovrappongono (una è contenuta nell\'altra)',
  UNKNOWN_AGENT_ERROR: 'Errore sconosciuto dall\'agent'
};

const BACKUP_COMPLETE_MARKER = '.backup_complete';
const BACKUP_INFO_FILE = 'retention_info.json';

function validateMappingBeforeExecution(mapping) {
  const errors = [];

  if (mapping.destination_path) {
    const uncRegex = /^\\\\[^\\]+\\[^\\]+/;
    if (mapping.destination_path.startsWith('\\\\') && !uncRegex.test(mapping.destination_path)) {
      errors.push({
        code: AgentErrorCodes.UNC_INVALID_FORMAT,
        field: 'destination_path',
        message: 'Formato UNC non valido. Usa: \\\\server\\share\\path'
      });
    }
  }

  if (mapping.credentials) {
    const username = mapping.credentials.username || '';
    const domain = mapping.credentials.domain || '';

    if (username.includes('\\') && domain) {
      errors.push({
        code: 'CREDENTIALS_FORMAT_ERROR',
        field: 'credentials',
        message: 'Username contiene già il dominio, non specificare domain separatamente'
      });
    }
  }

  return errors;
}

function parseAgentErrorFromMessage(errorMessage) {
  const codeMatch = errorMessage.match(/codice (\d+)/);
  const pathMatch = errorMessage.match(/percorso ([^\s(]+)/);

  let errorCode = AgentErrorCodes.UNKNOWN_AGENT_ERROR;
  const windowsCode = codeMatch ? parseInt(codeMatch[1], 10) : null;

  if (windowsCode) {
    if ([53, 64, 67].includes(windowsCode)) {
      errorCode = AgentErrorCodes.NETWORK_PATH_NOT_FOUND;
    } else if (windowsCode === 5) {
      errorCode = AgentErrorCodes.ACCESS_DENIED;
    } else if ([86, 1219, 1326, 2202].includes(windowsCode)) {
      errorCode = AgentErrorCodes.INVALID_CREDENTIALS;
    } else if (windowsCode === 206) {
      errorCode = AgentErrorCodes.PATH_TOO_LONG;
    }
  }

  return {
    windowsCode,
    errorCode,
    affectedPath: pathMatch ? pathMatch[1] : null,
    message: ErrorMessages[errorCode] || errorMessage
  };
}

function getAgentInfo(hostname) {
  try {
    const heartbeat = this.storage.loadAgentHeartbeat(hostname);
    if (!heartbeat) {
      return null;
    }

    const now = Date.now();
    const lastSeen = new Date(heartbeat.timestamp).getTime();
    const HEARTBEAT_TTL_MS = 2 * 60 * 1000;

    if (heartbeat.status === 'offline' || (now - lastSeen) > HEARTBEAT_TTL_MS) {
      return null;
    }

    return {
      agent_ip: heartbeat.agent_ip,
      agent_port: heartbeat.agent_port || 8081
    };
  } catch (error) {
    this.logger.error('Errore caricamento info agent', { hostname, error: error.message });
    return null;
  }
}

async function updateAgentBackupStatus(hostname, status, jobId) {
  try {
    if (!hostname) {
      return;
    }

    const existing = this.storage.loadAgentHeartbeat(hostname) || {};
    const now = new Date().toISOString();

    const heartbeat = {
      hostname,
      status: existing.status || 'online',
      timestamp: now,
      agent_ip: existing.agent_ip || null,
      agent_port: existing.agent_port || null,
      backup_status: status,
      backup_job_id: jobId,
      backup_status_timestamp: now
    };

    this.storage.saveAgentHeartbeat(heartbeat);
  } catch (error) {
    this.logger.error('Impossibile aggiornare stato backup agent', { hostname, error: error.message });
  }
}

function callAgent(agentUrl, endpoint, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, agentUrl);
    const postData = JSON.stringify(data);

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(responseData);
          resolve(result);
        } catch (parseError) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            reject(new Error(`Risposta agent non valida: ${parseError.message}`));
          } else {
            reject(new Error(`Agent ha risposto con status ${res.statusCode}: ${responseData}`));
          }
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Errore comunicazione con agent: ${error.message}`));
    });

    req.write(postData);
    req.end();
  });
}

function computeLocalBackupStats(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return null;
  }

  const queue = [targetPath];
  const summary = {
    total_files: 0,
    copied_files: 0,
    skipped_files: 0,
    failed_files: 0,
    blocked_files_count: 0,
    deleted_files: 0,
    updated_files: 0,
    sync_skipped_files: 0,
    bytes: 0
  };

  while (queue.length > 0) {
    const currentPath = queue.pop();

    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch (err) {
      continue;
    }

    for (const entry of entries) {
      if (entry.name === BACKUP_COMPLETE_MARKER || entry.name === BACKUP_INFO_FILE) {
        continue;
      }

      const fullPath = path.join(currentPath, entry.name);

      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          queue.push(fullPath);
        } else if (stat.isFile()) {
          summary.total_files += 1;
          summary.copied_files += 1;
          summary.bytes += stat.size;
        }
      } catch (err) {
        summary.failed_files += 1;
      }
    }
  }

  return summary.total_files > 0 || summary.bytes > 0 ? summary : null;
}

function tryBuildPartialFromDisk(targetPath, mode, mapping, job, runId, errorMessage) {
  const stats = this.computeLocalBackupStats(targetPath);
  if (!stats) {
    return null;
  }

  const partialMessage = `Backup parziale: ${errorMessage}`;

  this.recordJobIssue(job, runId, 'warn', partialMessage, {
    source: mapping.source_path,
    destination: mapping.destination_path,
    bytesProcessed: stats.bytes,
    totalFiles: stats.total_files
  });

  if (mode === 'copy') {
    const configuredSlots = Number(mapping.retention?.max_backups || 0);
    this.markBackupComplete(targetPath, {
      jobId: job.job_id,
      runId,
      retentionIndex: mapping._computed_retention_index || null,
      retentionSlots: configuredSlots > 0 ? configuredSlots : null,
      source: mapping.source_path,
      destination: mapping.destination_path,
      label: mapping.label || job.job_id,
      timestamp: mapping._computed_timestamp
    });
  }

  return {
    targetPath,
    bytesProcessed: stats.bytes,
    mode,
    simulated: false,
    stats: {
      total_files: stats.total_files,
      copied_files: stats.copied_files,
      skipped_files: stats.skipped_files,
      blocked_files: stats.blocked_files_count,
      deleted_files: stats.deleted_files,
      updated_files: stats.updated_files,
      sync_skipped_files: stats.sync_skipped_files,
      failed_files: stats.failed_files
    },
    retention_index: mapping._computed_retention_index || null,
    timestamp: mapping._computed_timestamp || null,
    warnings: [partialMessage],
    blocked_files: [],
    errors: [partialMessage]
  };
}

module.exports = {
  AgentErrorCodes,
  ErrorMessages,
  computeLocalBackupStats,
  getAgentInfo,
  parseAgentErrorFromMessage,
  tryBuildPartialFromDisk,
  updateAgentBackupStatus,
  validateMappingBeforeExecution,
  callAgent
};
