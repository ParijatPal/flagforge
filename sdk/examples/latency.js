const fs = require("node:fs");
const path = require("node:path");
const { FlagForgeClient } = require("../src");

const BASE = process.env.BASE_URL || "http://localhost:4000";
const KEY = process.env.FLAG_KEY || "new-checkout";
const API_KEY = process.env.API_KEY || "dev-secret-key";
const RUNS = Number(process.env.RUNS || 500);
const WARMUP = Number(process.env.WARMUP || 20);
const CLIENTS = (process.env.CLIENTS || "1,10,100").split(",").map(Number);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const f = (v) => v.toFixed(1);

// Records when each client receives the stream event for a given version.
function makeProbe(client) {
  const at = new Map(); // version -> arrival time
  const waiting = new Map(); // version -> resolver
  client.on("flag", (m) => {
    if (m.key !== KEY) return;
    const t = performance.now();
    at.set(m.version, t);
    waiting.get(m.version)?.(t);
    waiting.delete(m.version);
  });
  return {
    client,
    at,
    wait(version, ms = 5000) {
      if (at.has(version)) return Promise.resolve(at.get(version));
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(version);
          resolve(null);
        }, ms);
        waiting.set(version, (t) => {
          clearTimeout(timer);
          resolve(t);
        });
      });
    },
  };
}

function stats(name, arr) {
  if (!arr.length) return console.log(`${name.padEnd(36)} no data`);
  const s = [...arr].sort((a, b) => a - b);
  const pct = (p) => s[Math.min(s.length - 1, Math.ceil(s.length * p) - 1)];
  const mean = s.reduce((a, v) => a + v, 0) / s.length;
  console.log(
    `${name.padEnd(36)} n=${s.length}  min=${f(s[0])}  mean=${f(mean)}  p50=${f(pct(0.5))}  ` +
      `p95=${f(pct(0.95))}  p99=${f(pct(0.99))}  max=${f(s[s.length - 1])} ms`
  );
}

async function runConfig(n) {
  console.log(`\n=== ${n} connected SDK client(s), ${RUNS} runs (+${WARMUP} warm-up) ===`);

  const probes = [];
  for (let i = 0; i < n; i++) {
    probes.push(makeProbe(new FlagForgeClient({ baseUrl: BASE, env: "dev" })));
  }
  await Promise.all(
    probes.map((p) => {
      const ready = new Promise((r) => p.client.on("connected", r));
      p.client.start();
      return ready;
    })
  );
  await probes[0].client.evaluate(KEY, { userId: "123" }); // warm the cache

  const patchMs = [], afterRespMs = [], firstMs = [], lastMs = [], allClientMs = [], visibleMs = [];
  const rows = ["run,patch_ms,event_first_ms,event_last_ms,event_after_response_ms,visible_ms"];
  let enabled = false;
  let missed = 0;

  for (let i = 0; i < WARMUP + RUNS; i++) {
    enabled = !enabled;
    const t0 = performance.now();
    const res = await fetch(`${BASE}/api/v1/flags/${KEY}?env=dev`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY, "x-actor": "latency-test" },
      body: JSON.stringify({ enabled }),
    });
    const tResp = performance.now();
    if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
    const { version } = await res.json();

    // client 0: time until evaluate() returns the new version
    const visible = (async () => {
      await probes[0].wait(version);
      let r;
      for (let k = 0; k < 50; k++) {
        r = await probes[0].client.evaluate(KEY, { userId: "123" });
        if (r.version >= version) break;
      }
      return performance.now() - t0;
    })();

    const times = await Promise.all(probes.map((p) => p.wait(version)));
    const vis = await visible;
    probes.forEach((p) => p.at.delete(version));

    if (times.includes(null)) {
      missed++;
      continue;
    }
    if (i < WARMUP) {
      await sleep(50);
      continue;
    }

    const first = Math.min(...times) - t0;
    const last = Math.max(...times) - t0;
    patchMs.push(tResp - t0);
    afterRespMs.push(Math.min(...times) - tResp);
    firstMs.push(first);
    lastMs.push(last);
    times.forEach((t) => allClientMs.push(t - t0));
    visibleMs.push(vis);
    rows.push([i - WARMUP, f(tResp - t0), f(first), f(last), f(Math.min(...times) - tResp), f(vis)].join(","));

    await sleep(50);
  }

  console.log(`missed events (timeout): ${missed}`);
  stats("PATCH round trip", patchMs);
  stats("PATCH sent -> first client event", firstMs);
  stats("PATCH sent -> every client event", allClientMs);
  stats("PATCH sent -> last client event", lastMs);
  stats("PATCH response -> first event*", afterRespMs);
  stats("PATCH sent -> client 0 sees version", visibleMs);

  const dir = path.join(__dirname, "..", "results");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `latency-${n}-clients.csv`), rows.join("\n") + "\n");

  probes.forEach((p) => p.client.stop());
  await sleep(300);
}

(async () => {
  for (const n of CLIENTS) await runConfig(n);
  console.log("\n* negative = the event arrived before the PATCH response did");
  console.log("CSV files saved in sdk/results/");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});