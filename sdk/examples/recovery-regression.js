const { execSync } = require("node:child_process");
const path = require("node:path");
const { LocalFlagClient } = require("../src");

const BASE = process.env.BASE_URL || "http://localhost:4000";
const API_KEY = process.env.API_KEY || "dev-secret-key";
const KEY = "recovery-test";
const ROOT = path.join(__dirname, "..", ".."); // repo root, where docker-compose.yml lives
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = (method, suffix, body) =>
  fetch(`${BASE}/api/v1/flags${suffix}`, {
    method,
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY, "x-actor": "recovery-test" },
    body: body ? JSON.stringify(body) : undefined,
  });

const create = async (enabled) => {
  const res = await admin("POST", "", {
    key: KEY, name: "Recovery test", environment: "dev", enabled, rolloutPercentage: 100,
  });
  if (!res.ok) throw new Error(`create failed ${res.status}: ${await res.text()}`);
  return res.json();
};

async function run(resyncMs) {
  await admin("DELETE", `/${KEY}?env=dev`); // ignore the result: it may not exist

  // build up version 6 (enabled=false)
  await create(true);
  for (const enabled of [false, true, false, true, false]) {
    const res = await admin("PATCH", `/${KEY}?env=dev`, { enabled });
    if (!res.ok) throw new Error(`patch failed ${res.status}`);
  }

  const client = new LocalFlagClient({ baseUrl: BASE, env: "dev", resyncMs });
  const regressions = [];
  client.on("regression", (r) => regressions.push(r));
  const ready = new Promise((r) => client.on("connected", r));
  client.start();
  await ready;

  const before = await client.evaluate(KEY);
  if (before.version !== 6) throw new Error(`expected v6, got v${before.version}`);

  // Redis loses everything, then the flag is recreated (version 1, enabled=true)
  execSync("docker compose exec -T redis redis-cli FLUSHALL", { cwd: ROOT, stdio: "pipe" });
  await sleep(200);
  await create(true);

  const cap = resyncMs ? resyncMs * 2 + 1000 : 8000;
  const t0 = performance.now();
  let converged = null;
  while (performance.now() - t0 < cap) {
    const r = await client.evaluate(KEY);
    if (r.version === 1) { converged = performance.now() - t0; break; }
    await sleep(50);
  }
  const last = await client.evaluate(KEY).catch(() => null);

  client.stop();
  await admin("DELETE", `/${KEY}?env=dev`);
  return { resyncMs, converged, regressions, last };
}

(async () => {
  console.log("A flag at v6 is wiped and recreated at v1. How long does the SDK keep serving v6?\n");
  for (const ms of [0, 2000, 5000]) {
    const r = await run(ms);
    const result = r.converged === null
      ? `NEVER within the cap (still v${r.last?.version})`
      : `converged after ${r.converged.toFixed(0)} ms`;
    console.log(`resyncMs=${String(ms).padEnd(5)} ${result}; regression events: ${JSON.stringify(r.regressions)}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });