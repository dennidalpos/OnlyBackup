const http = require('http');

function requestAgentJson(agentIp, agentPort, path, payload, { timeout, parseResponse, emptyBody = '{}' }) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);
    const options = {
      hostname: agentIp,
      port: agentPort,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data || emptyBody);
          parseResponse(parsed, res.statusCode, resolve, reject);
        } catch {
          reject(new Error('Risposta agent non valida'));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Errore comunicazione con agent: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout connessione agent'));
    });

    req.write(postData);
    req.end();
  });
}

function createAgentClient() {
  const callAgentJobBackups = (agentIp, agentPort, jobLabel, mappings = []) => requestAgentJson(
    agentIp,
    agentPort,
    '/backups/job',
    {
      job_label: jobLabel || null,
      mappings: mappings || []
    },
    {
      timeout: 15000,
      parseResponse: (parsed, statusCode, resolve, reject) => {
        if (statusCode >= 200 && statusCode < 300) {
          resolve(parsed.mappings || []);
          return;
        }

        reject(new Error(parsed.error || `Agent ha risposto con status ${statusCode}`));
      }
    }
  ).catch((error) => {
    if (error.message.startsWith('Errore comunicazione con agent:')) {
      throw new Error(`Agent non raggiungibile: ${error.message.replace('Errore comunicazione con agent: ', '')}`);
    }

    if (error.message === 'Timeout connessione agent') {
      throw new Error('Timeout chiamata agent');
    }

    throw error;
  });

  const callAgentFilesystem = (agentIp, agentPort, requestedPath) => requestAgentJson(
    agentIp,
    agentPort,
    '/filesystem/list',
    { path: requestedPath || '' },
    {
      timeout: 10000,
      emptyBody: '',
      parseResponse: (parsed, statusCode, resolve) => {
        const entries = (parsed.items || []).map((item) => ({
          name: item.name,
          path: item.path || item.name,
          type: item.type,
          modified: item.modified || null,
          size: item.size ?? null
        }));
        resolve({ path: parsed.path || requestedPath || '', entries });
      }
    }
  ).catch((error) => {
    if (error.message.startsWith('Errore comunicazione con agent:')) {
      throw new Error(`Impossibile contattare agent: ${error.message.replace('Errore comunicazione con agent: ', '')}`);
    }

    throw error;
  });

  const callAgentDelete = (agentIp, agentPort, items = []) => requestAgentJson(
    agentIp,
    agentPort,
    '/filesystem/delete',
    { paths: items },
    {
      timeout: 10000,
      parseResponse: (parsed, statusCode, resolve, reject) => {
        if (statusCode >= 200 && statusCode < 300) {
          resolve(parsed);
          return;
        }

        reject(new Error(parsed.error || `Agent ha risposto con status ${statusCode}`));
      }
    }
  );

  return {
    callAgentDelete,
    callAgentFilesystem,
    callAgentJobBackups
  };
}

module.exports = createAgentClient;
