// Expiry never renews evidence freshness. Sweep on insertion bounds abandoned keys.
export class BoundedTtlCache extends Map {
  constructor({ maxEntries = 500, ttlMs = 15000, now = Date.now } = {}) {
    super(); this.maxEntries = maxEntries; this.ttlMs = ttlMs; this.now = now;
  }
  prune() {
    const now = this.now();
    for (const [key, value] of this) {
      if (!Number.isFinite(value?.savedAt) || now - value.savedAt > this.ttlMs) super.delete(key);
    }
    while (this.size > this.maxEntries) super.delete(this.keys().next().value);
  }
  set(key, value) { super.delete(key); super.set(key, value); this.prune(); return this; }
  get(key) { this.prune(); return super.get(key); }
}
