const { LocalFlagClient } = require("../src");

const BASE = process.env.BASE_URL || "http://localhost:4000";
const KEY = process.env.FLAG_KEY || "new-checkout";
const N = Number(process.env.N || 2000);
const plans = ["free", "pro", "enterprise"];

(async () => {
  const client = new LocalFlagClient({ baseUrl: BASE, env: "dev" });
  const ready = new Promise((r) => client.on("connected", r));
  client.start();
  await ready;

  let mismatches = 0;
  for (let i = 0; i < N; i++) {
    const attrs = { userId: `user-${i}`, plan: plans[i % 3] };
    const local = await client.evaluate(KEY, attrs);
    const q = new URLSearchParams({ env: "dev", ...attrs });
    const server = await (await fetch(`${BASE}/api/v1/evaluate/${KEY}?${q}`)).json();
    if (local.enabled !== server.enabled || local.reason !== server.reason) {
      if (mismatches++ < 5) console.log("MISMATCH", attrs, { local, server });
    }
  }
  console.log(`${N} users compared, ${mismatches} mismatches`);
  client.stop();
  process.exit(mismatches ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });