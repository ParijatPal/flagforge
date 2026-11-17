const { FlagForgeClient } = require("./client");
const { evaluate: evaluateFlag } = require("./evaluation"); // CHECK export name

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Holds a full snapshot of the env's flags and evaluates them in-process.
// The SSE stream only says "something changed"; the snapshot is then re-fetched.
class LocalFlagClient extends FlagForgeClient {
  constructor({ sdkKey = "dev-sdk-key", ...opts } = {}) {
    super(opts);
    this.sdkKey = sdkKey;
    this.flags = new Map();
    this.loaded = false;
    this.syncSeq = 0;
  }

  // true while the stream is down: answers come from the last snapshot
  isStale() {
    return !this.connected;
  }

  async evaluate(key, attributes = {}) {
    if (!this.loaded) throw new Error("flags not loaded yet");
    const flag = this.flags.get(key);
    if (!flag) throw new Error("evaluate failed: 404");
    // the server receives query strings, so attributes are strings there
    const ctx = Object.fromEntries(
      Object.entries(attributes).map(([k, v]) => [k, String(v)])
    );
    const { enabled, reason } = evaluateFlag(flag, ctx); // CHECK signature
    return { key, enabled, reason, version: flag.version };
  }

  async _sync() {
    const seq = ++this.syncSeq;
    const res = await fetch(`${this.baseUrl}/api/v1/sdk/flags?env=${this.env}`, {
      headers: { "x-sdk-key": this.sdkKey },
    });
    if (!res.ok) throw new Error(`sdk/flags failed: ${res.status}`);
    const body = await res.json();
    if (seq !== this.syncSeq) return; // a newer sync started, let it win
    this.flags = new Map(body.flags.map((f) => [f.key, f]));
    this.loaded = true;
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

  _onHello() {
    this.connected = true;
    // missed messages are possible while disconnected, so always re-sync
    this._syncUntilOk().then((ok) => ok && this._emit("connected"));
  }

  _onFlag(msg) {
    const local = this.flags.get(msg.key);
    if (local && local.version >= msg.version) return this._emit("flag", msg);
    // a delete publishes version + 1, and the re-sync drops the flag
    this._syncUntilOk().then(() => this._emit("flag", msg));
  }
}

module.exports = { LocalFlagClient };