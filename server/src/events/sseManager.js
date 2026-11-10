const eventBus = require('./eventBus');

class SSEManager {
  constructor() {
    this.clients = new Map(); // Map<clientId, response>
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Ascolta tutti gli eventi e forward a SSE clients
    const events = [
      'client_status_changed',
      'backup_started',
      'backup_completed',
      'stats_updated',
      'job_created',
      'job_updated',
      'job_deleted',
      'alert_created',
      'alert_resolved'
    ];

    events.forEach(eventName => {
      eventBus.on(eventName, (data) => {
        this.broadcast(eventName, data);
      });
    });
  }

  addClient(clientId, res) {
    // Setup SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // Nginx bypass
    });

    // Send initial connection event
    this.sendEvent(res, 'connected', { client_id: clientId, timestamp: new Date() });

    // Store client
    this.clients.set(clientId, res);

    // Cleanup on disconnect
    res.on('close', () => {
      this.clients.delete(clientId);
      console.log(`SSE client disconnected: ${clientId}`);
    });

    // Keep-alive ping every 30s
    const pingInterval = setInterval(() => {
      if (!this.clients.has(clientId)) {
        clearInterval(pingInterval);
        return;
      }
      this.sendEvent(res, 'ping', { timestamp: Date.now() });
    }, 30000);

    console.log(`SSE client connected: ${clientId} (total: ${this.clients.size})`);
  }

  broadcast(eventName, data) {
    this.clients.forEach((res) => {
      this.sendEvent(res, eventName, data);
    });
    console.log(`SSE broadcast: ${eventName} to ${this.clients.size} clients`);
  }

  sendEvent(res, eventName, data) {
    try {
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      console.error(`Error sending SSE event:`, err);
    }
  }

  getClientCount() {
    return this.clients.size;
  }

  getStats() {
    return {
      connected_clients: this.clients.size,
      client_ids: Array.from(this.clients.keys())
    };
  }
}

module.exports = new SSEManager();
