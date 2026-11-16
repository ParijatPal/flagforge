import { Cache } from "./cache.js";
import { startStream } from "./stream.js";

export class FlagForge {
  constructor({
    baseUrl = "http://localhost:4000",
    env = "dev",
    ttlMs = 30000,
    timeoutMs = 3000,
    stream = true,
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.env = env;
    this.timeoutMs = timeoutMs;
    this.cache = new Cache(ttlMs);
    this.useStream = stream;
    this.stop = null;
  }

  init() {
    if (this.useStream && !this.stop) {
      this.stop = startStream({
        url: `${this.baseUrl}/api/v1/stream?env=${this.env}`,
        onMessage: (m) => this.cache.invalidateFlag(m.key),
        onReconnect: () => this.cache.clear(),
        onError: () => {},
      });
    }
    return this;
  }

  async evaluate(key, attrs = {}) {
    const sorted = Object.fromEntries(Object.entries(attrs).sort());
    const cacheKey = `${key}|${JSON.stringify(sorted)}`;
    const hit = this.cache.get(cacheKey);
    if (hit) return hit;

    const qs = new URLSearchParams({ env: this.env, ...attrs });
    const res = await fetch(
      `${this.baseUrl}/api/v1/evaluate/${encodeURIComponent(key)}?${qs}`,
      { signal: AbortSignal.timeout(this.timeoutMs) }
    );
    if (!res.ok) throw new Error(`evaluate failed: HTTP ${res.status}`);
    const result = await res.json();
    this.cache.set(cacheKey, result);
    return result;
  }

  // Never throws: falls back to defaultValue if the API is down.
  async isEnabled(key, attrs = {}, defaultValue = false) {
    try {
      return (await this.evaluate(key, attrs)).enabled;
    } catch {
      return defaultValue;
    }
  }

  close() {
    this.stop?.();
    this.stop = null;
    this.cache.clear();
  }
}