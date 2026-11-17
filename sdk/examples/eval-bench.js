const { FlagForgeClient, LocalFlagClient } = require("../src");

const BASE = process.env.BASE_URL || "http://localhost:4000";
const KEY = process.env.FLAG_KEY || "new-checkout";
const N = Number(process.env.N || 1000);

async function bench(label, client) {
  const ready = new Promise((r) => client.on("connected", r));
  client.start();
  await ready;
  const lat = [];
  for (let i = 0; i < N; i++) {
    const t = performance.now();
    // a distinct user each time, so the simple client can never hit its cache
    await client.evaluate(KEY, { userId: `${label}-${i}`, plan: "pro" });
    lat.push(performance.now() - t);
  }
  lat.sort((a, b) => a - b);
  const p = (q) => lat[Math.ceil(lat.length * q) - 1].toFixed(3);
  const mean = (lat.reduce((a, v) => a + v, 0) / lat.length).toFixed(3);
  console.log(`${label.padEnd(8)} n=${N} mean=${mean} p50=${p(0.5)} p95=${p(0.95)} p99=${p(0.99)} ms`);
  client.stop();
}

(async () => {
  await bench("simple", new FlagForgeClient({ baseUrl: BASE, env: "dev" }));
  await bench("local", new LocalFlagClient({ baseUrl: BASE, env: "dev" }));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });