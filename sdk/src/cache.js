export class Cache {
  constructor(ttlMs = 30000) {
    this.ttl = ttlMs;
    this.map = new Map();
  }
  get(k) {
    const e = this.map.get(k);
    if (!e) return undefined;
    if (Date.now() > e.exp) { this.map.delete(k); return undefined; }
    return e.value;
  }
  set(k, value) {
    this.map.set(k, { value, exp: Date.now() + this.ttl });
  }
  invalidateFlag(flagKey) {
    for (const k of [...this.map.keys()]) {
      if (k.startsWith(flagKey + "|")) this.map.delete(k);
    }
  }
  clear() { this.map.clear(); }
}