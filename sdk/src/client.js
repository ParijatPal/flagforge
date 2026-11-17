const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class FlagForgeClient {
  constructor({ baseUrl = "http://localhost:4000", env = "dev", ttlMs = 30000 } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.env = env;
    this.ttlMs = ttlMs;
    this.cache = new Map(); // flagKey -> Map(attrKey -> { result, expires })
    this.connected = false;
    this.stopped = true;
    this.abort = null;
    this.listeners = {};
  }

  // ---- events: "connected", "disconnected", "flag" ----
  on(event, fn) {
    (this.listeners[event] ??= []).push(fn);
    return this;
  }
  _emit(event, data) {
    for (const fn of this.listeners[event] ?? []) fn(data);
  }

  // ---- lifecycle ----
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this._streamLoop(); // runs in background
  }
  stop() {
    this.stopped = true;
    this.abort?.abort();
  }

  // ---- public API ----
  async isEnabled(key, attributes = {}, fallback = false) {
    try {
      const r = await this.evaluate(key, attributes);
      return r.enabled;
    } catch {
      return fallback; // network down: fail safe
    }
  }

  async evaluate(key, attributes = {}) {
    const attrKey = JSON.stringify(Object.entries(attributes).sort());
    const entry = this.cache.get(key)?.get(attrKey);

    // only trust the cache while the stream is connected,
    // because otherwise we can't know whether it is stale
    if (this.connected && entry && entry.expires > Date.now()) return entry.result;

    const params = new URLSearchParams({ env: this.env, ...attributes });
    const res = await fetch(
      `${this.baseUrl}/api/v1/evaluate/${encodeURIComponent(key)}?${params}`
    );
    if (!res.ok) throw new Error(`evaluate failed: ${res.status}`);
    const result = await res.json();

    if (!this.cache.has(key)) this.cache.set(key, new Map());
    this.cache.get(key).set(attrKey, { result, expires: Date.now() + this.ttlMs });
    return result;
  }

  // ---- stream handling ----
  async _streamLoop() {
    let backoff = 1000;
    while (!this.stopped) {
      try {
        this.abort = new AbortController();
        const res = await fetch(`${this.baseUrl}/api/v1/stream?env=${this.env}`, {
          headers: { Accept: "text/event-stream" },
          signal: this.abort.signal,
        });
        if (!res.ok) throw new Error(`stream status ${res.status}`);

        const decoder = new TextDecoder();
        let buf = "";
        for await (const chunk of res.body) {
          buf += decoder.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) !== -1) {
            this._handleEvent(buf.slice(0, i));
            buf = buf.slice(i + 2);
          }
          backoff = 1000; // got data, so the connection is healthy
        }
      } catch (e) {
        if (this.stopped) return;
      }
      if (this.connected) {
        this.connected = false;
        this._emit("disconnected");
      }
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 15000);
    }
  }

  _handleEvent(raw) {
    let event = "message";
    let data = "";
    for (const line of raw.split("\n")) {
      if (line.startsWith(":")) continue; // heartbeat comment
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data += line.slice(5).trim();
    }

    if (event === "hello") {
      // Pub/Sub is fire-and-forget: we may have missed messages while
      // disconnected, so every (re)connect starts with an empty cache.
      this.cache.clear();
      this.connected = true;
      this._emit("connected");
    } else if (event === "flag") {
      const msg = JSON.parse(data); // { key, action, version }
      const entries = this.cache.get(msg.key);
      if (entries) {
        // skip the invalidation if we already hold a newer version
        for (const [attrKey, e] of entries) {
          if (e.result.version < msg.version) entries.delete(attrKey);
        }
      }
      this._emit("flag", msg);
    }
  }
}

module.exports = { FlagForgeClient };