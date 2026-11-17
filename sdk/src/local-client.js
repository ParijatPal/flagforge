const { FlagForgeClient } = require("./client");
const { evaluate: evaluateFlag } = require("./evaluation");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Holds a full snapshot of the env's flags and evaluates them in-process.
// The SSE stream says "something changed"; the snapshot is then re-fetched.
// Events: connected, disconnected, flag, drift { key }, regression { key, held, server }
class LocalFlagClient extends FlagForgeClient {
  constructor({ sdkKey = "dev-sdk-key", resyncMs = 30000, ...opts } = {}) {
    super(opts);
    this.sdkKey = sdkKey;
    this.resyncMs = resyncMs; // 0 turns the safety-net re-sync off
    this.resyncTimer = null;
    this.flags = new Map();
    this.loaded = false;
    this.syncSeq = 0;
  }

  // true while the stream is down: answers come from the last snapshot
  isStale() {
    return !this.connected;
  }

  stop() {
    this._stopResync();
    super.stop();
  }

  async evaluate(key, attributes = {}) {
    if (!this.loaded) throw new Error("flags not loaded yet");
    const flag = this.flags.get(key);
    if (!flag) throw new Error("evaluate failed: 404");
    // the server receives query strings, so attributes are strings there
    const ctx = Object.fromEntries(
      Object.entries(attributes).map(([k, v]) => [k, String(v)])
    );
    const { enabled, reason } = evaluateFlag(flag, ctx);
    return { key, enabled, reason, version: flag.version };
  }

  // Fetches the snapshot. Returns the keys whose data differs from what we held.
  async _sync() {
    const seq = ++this.syncSeq;
    const res = await fetch(`${this.baseUrl}/api/v1/sdk/flags?env=${this.env}`, {
      headers: { "x-sdk-key": this.sdkKey },
    });
    if (!res.ok) throw new Error(`sdk/flags failed: ${res.status}`);
    const body = await res.json();
    if (seq !== this.syncSeq) return []; // a newer sync started, let it win

    const next = new Map(body.flags.map((f) => [f.key, f]));
    const changed = [];
    for (const [key, flag] of next) {
      const held = this.flags.get(key);
      if (!held) continue;
      if (flag.version < held.version) {
        // the server is the source of truth, but a backwards version is worth reporting
        this._emit("regression", { key, held: held.version, server: flag.version });
      }
      if (JSON.stringify(held) !== JSON.stringify(flag)) changed.push(key);
    }
    for (const key of this.flags.keys()) if (!next.has(key)) changed.push(key);

    this.flags = next;
    this.loaded = true;
    return changed;
  }

  async _syncUntilOk() {
    let delay = 500;
    while (!this.stopped && this.connected) {
      try {
        await this._sync();
        return true;
      } catch {
        await sleep(delay);
        delay = Math.min(delay * 2, 5000);
      }
    }
    return false;
  }

  // safety net: re-fetch on a timer, in case an event was missed
  _startResync() {
    this._stopResync();
    if (!this.resyncMs) return;
    this.resyncTimer = setInterval(async () => {
      if (!this.connected || this.stopped) return;
      try {
        for (const key of await this._sync()) this._emit("drift", { key });
      } catch {
        /* the next tick retries */
      }
    }, this.resyncMs);
    this.resyncTimer.unref?.();
  }

  _stopResync() {
    clearInterval(this.resyncTimer);
    this.resyncTimer = null;
  }

  _onHello() {
    this.connected = true;
    // missed messages are possible while disconnected, so always re-sync
    this._syncUntilOk().then((ok) => {
      if (!ok) return;
      this._startResync();
      this._emit("connected");
    });
  }

  _onFlag(msg) {
    const local = this.flags.get(msg.key);
    if (local && local.version >= msg.version) return this._emit("flag", msg);
    // a delete publishes version + 1, and the re-sync drops the flag
    this._syncUntilOk().then(() => this._emit("flag", msg));
  }
}

module.exports = { LocalFlagClient };