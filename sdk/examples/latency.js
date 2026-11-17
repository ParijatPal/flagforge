const { FlagForgeClient } = require("../src");

const BASE = "http://localhost:4000";
const KEY = "new-checkout";
const API_KEY = process.env.API_KEY || "dev-secret-key";
const RUNS = Number(process.env.RUNS || 30);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];

async function main() {
  const client = new FlagForgeClient({ baseUrl: BASE, env: "dev" });
  const eventAt = new Map(); // version -> time the stream event arrived
  client.on("flag", (m) => { if (m.key === KEY) eventAt.set(m.version, performance.now()); });

  const ready = new Promise((r) => client.on("connected", r));
  client.start();
  await ready;
  await client.evaluate(KEY, { userId: "123" }); // warm the cache

  const streamMs = [];
  const visibleMs = [];
  let enabled = false;

  for (let i = 0; i < RUNS; i++) {
    enabled = !enabled;
    const t0 = performance.now();
    const res = await fetch(`${BASE}/api/v1/flags/${KEY}?env=dev`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY, "x-actor": "latency-test" },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
    const { version } = await res.json();

    // wait for the stream event for this version
    const deadline = performance.now() + 5000;
    while (!eventAt.has(version) && performance.now() < deadline) await sleep(1);
    if (!eventAt.has(version)) { console.log(`run ${i}: no stream event for v${version}`); continue; }
    streamMs.push(eventAt.get(version) - t0);

    // wait until evaluate() returns the new version (end-to-end)
    let r;
    do { r = await client.evaluate(KEY, { userId: "123" }); } while (r.version < version);
    visibleMs.push(performance.now() - t0);

    await sleep(200);
  }

  const report = (name, a) => {
    a.sort((x, y) => x - y);
    const mean = a.reduce((s, v) => s + v, 0) / a.length;
    console.log(`${name}: n=${a.length} min=${a[0].toFixed(1)} mean=${mean.toFixed(1)} ` +
      `p50=${pct(a, 0.5).toFixed(1)} p95=${pct(a, 0.95).toFixed(1)} max=${a[a.length - 1].toFixed(1)} (ms)`);
  };
  report("PATCH -> stream event     ", streamMs);
  report("PATCH -> SDK sees version ", visibleMs);

  client.stop();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });