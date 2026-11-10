class CacheManager {
  constructor() {
    this.cache = new Map();
    this.ttls = new Map();
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check TTL
    const ttl = this.ttls.get(key);
    if (ttl && Date.now() > ttl) {
      this.cache.delete(key);
      this.ttls.delete(key);
      return null;
    }

    return entry;
  }

  set(key, value, ttlMs = null) {
    this.cache.set(key, value);
    if (ttlMs) {
      this.ttls.set(key, Date.now() + ttlMs);
    } else {
      this.ttls.delete(key); // Nessun TTL = cache indefinito
    }
  }

  invalidate(key) {
    this.cache.delete(key);
    this.ttls.delete(key);
  }

  invalidatePattern(pattern) {
    const regex = new RegExp(pattern);
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        this.ttls.delete(key);
      }
    }
  }

  clear() {
    this.cache.clear();
    this.ttls.clear();
  }

  getStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }

  // Cleanup expired entries
  cleanup() {
    const now = Date.now();
    for (const [key, ttl] of this.ttls.entries()) {
      if (now > ttl) {
        this.cache.delete(key);
        this.ttls.delete(key);
      }
    }
  }
}

module.exports = new CacheManager();
