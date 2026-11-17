const fs = require("node:fs");
const path = require("node:path");
const { LocalFlagClient } = require("../src");
const { startFake, makeFlag } = require("../tests/helpers/fake-sdk-server");

const TRIALS = Number(process.env.TRIALS || 15);
const INTERVALS = (process.env.INTERVALS || "0,500,1000,2000").split(",").map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const f = (v) => v.toFixed(0);

async function run(resyncMs) {
  const fake = await startFake([makeFlag("f", 1)]);
  const client = new LocalFlagClient({ baseUrl: fake.baseUrl, env: "dev", sdkKey: "k", resyncMs });
  const ready = new Promise((r) => client.on("connected", r));
  client.start();
  await ready;

  const cap = resyncMs ? resyncMs * 2 + 500 : 1500; // 0 = never, so give up at the cap
  const times = [];
  let missed = 0;
  let version = 1;

  for (let i = 0; i < TRIALS; i++) {
    await sleep(Math.random() * (resyncMs || 200)); // random phase against the timer
    version++;
    const t0 = performance.now();
    fake.setFlag(makeFlag("f", version, { updatedAt: `t${version}` })); // no event
    let ok = false;
    while (performance.now() - t0 < cap) {
      if ((await client.evaluate("f")).version === version) { ok = true; break; }
      await sleep(5);
    }
    if (ok) times.push(performance.now() - t0);
    else {
      missed++;
      // resync the client so the next trial starts clean
      await client._sync();
    }
  }

  client.stop();
  fake.close();
  times.sort((a, b) => a - b);
  const mean = times.length ? times.reduce((a, v) => a + v, 0) / times.length : NaN;
  return { resyncMs, trials: TRIALS, converged: times.length, missed, times, mean };
}

(async () => {
  const rows = ["resync_ms,trials,converged,min_ms,mean_ms,p50_ms,max_ms"];
  console.log("resync_ms  trials  converged   min   mean    p50    max  (ms)");
  for (const ms of INTERVALS) {
    const r = await run(ms);
    const t = r.times;
    const line = t.length
      ? [ms, r.trials, t.length, f(t[0]), f(r.mean), f(t[Math.floor(t.length / 2)]), f(t[t.length - 1])]
      : [ms, r.trials, 0, "-", "-", "-", "-"];
    rows.push(line.join(","));
    console.log(line.map((x) => String(x).padStart(8)).join("  "));
  }
  const dir = path.join(__dirname, "..", "results");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "recovery-missed-event.csv"), rows.join("\n") + "\n");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });