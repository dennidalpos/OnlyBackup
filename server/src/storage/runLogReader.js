const fs = require('fs');
const path = require('path');

function createRunLogReader({ storage, logger }) {
  const readLogFile = (filePath, runId = null, { tailLines = null, maxBytes = 262144 } = {}) => {
    if (!filePath) {
      return null;
    }

    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const stat = fs.statSync(filePath);
      const size = stat.size;
      const bytesToRead = Math.min(maxBytes, size);
      let content = '';

      if (bytesToRead > 0) {
        const buffer = Buffer.alloc(bytesToRead);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, buffer, 0, bytesToRead, size - bytesToRead);
        fs.closeSync(fd);
        content = buffer.toString('utf8');
      } else {
        content = fs.readFileSync(filePath, 'utf8');
      }

      if (tailLines && Number.isFinite(tailLines) && tailLines > 0) {
        const lines = content.split(/\r?\n/).filter((line) => line !== '');
        content = lines.slice(-tailLines).join('\n');
      }

      return {
        content,
        path: filePath,
        run_id: runId || path.basename(filePath, path.extname(filePath)),
        updated_at: stat.mtime
      };
    } catch (error) {
      logger.warn('Impossibile leggere file di log', { filePath, error: error.message });
      return null;
    }
  };

  const readLogIndexPaths = (filePath) => {
    if (!filePath) {
      return [];
    }

    try {
      if (!fs.existsSync(filePath)) {
        return [];
      }

      const raw = fs.readFileSync(filePath, 'utf8');
      const payload = JSON.parse(raw);
      const candidates = [];
      if (payload?.log_path) {
        candidates.push(payload.log_path);
      }
      if (Array.isArray(payload?.operations)) {
        payload.operations.forEach((operation) => {
          if (operation?.log_path) {
            candidates.push(operation.log_path);
          }
        });
      }
      return candidates.filter(Boolean);
    } catch (error) {
      logger.warn('Impossibile leggere indice log', { filePath, error: error.message });
      return [];
    }
  };

  const findLatestRunLog = (hostname, jobId) => {
    try {
      const runs = storage
        .loadRunsForJob(jobId)
        .filter((run) => run.client_hostname === hostname)
        .sort((a, b) => new Date(b.end || b.start || 0) - new Date(a.end || a.start || 0));

      for (const run of runs) {
        const candidates = [run.log_path, run.run_log_index].filter(Boolean);
        for (const candidate of candidates) {
          const log = readLogFile(candidate, run.run_id);
          if (log) {
            return log;
          }
        }
      }
    } catch (error) {
      logger.warn('Impossibile recuperare log da run esistenti', { jobId, hostname, error: error.message });
    }

    return null;
  };

  return {
    findLatestRunLog,
    readLogFile,
    readLogIndexPaths
  };
}

module.exports = createRunLogReader;
