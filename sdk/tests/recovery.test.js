const test = require("node:test");
const assert = require("node:assert/strict");
const { LocalFlagClient } = require("../src");
const { startFake, makeFlag } = require("./helpers/fake-sdk-server");

const waitFor = (client, event) => new Promise((resolve) => client.on(event, resolve));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withClient(opts, initial, fn) {
  const fake = await startFake(initial);
  const client = new LocalFlagClient({ baseUrl: fake.baseUrl, env: "dev", sdkKey: "k", ...opts });
  const connected = waitFor(client, "connected");
  client.start();
  await connected;
  try {
    await fn(fake, client);
  } finally {
    client.stop();
    fake.close();
  }
}

test("a silent change (missed event) is picked up by the periodic re-sync", { timeout: 10000 }, () =>
  withClient({ resyncMs: 200 }, [makeFlag("f", 1)], async (fake, client) => {
    const drift = waitFor(client, "drift");
    fake.setFlag(makeFlag("f", 2, { enabled: false, updatedAt: "t1" })); // no event pushed
    assert.deepEqual(await drift, { key: "f" });
    const r = await client.evaluate("f", { userId: "u1" });
    assert.equal(r.version, 2);
    assert.equal(r.enabled, false);
  })
);

test("with resyncMs=0 a missed event leaves the SDK stale", { timeout: 10000 }, () =>
  withClient({ resyncMs: 0 }, [makeFlag("f", 1)], async (fake, client) => {
    fake.setFlag(makeFlag("f", 2, { updatedAt: "t1" })); // no event pushed
    await sleep(600);
    assert.equal((await client.evaluate("f")).version, 1); // still the old value
  })
);

test("a version that goes backwards is reported, and the server's value is used", { timeout: 10000 }, () =>
  withClient({ resyncMs: 200 }, [makeFlag("f", 5)], async (fake, client) => {
    const reg = waitFor(client, "regression");
    fake.setFlag(makeFlag("f", 2, { enabled: false, updatedAt: "t1" }));
    assert.deepEqual(await reg, { key: "f", held: 5, server: 2 });
    const r = await client.evaluate("f", { userId: "u1" });
    assert.equal(r.version, 2);
    assert.equal(r.enabled, false);
  })
);

test("an event with the same version but different data is ignored until the re-sync", { timeout: 10000 }, () =>
  withClient({ resyncMs: 400 }, [makeFlag("f", 3)], async (fake, client) => {
    const seen = waitFor(client, "flag");
    fake.setFlag(makeFlag("f", 3, { enabled: false, updatedAt: "t1" }));
    fake.push({ key: "f", action: "updated", version: 3 });
    await seen;
    assert.equal((await client.evaluate("f")).enabled, true); // stale: version looks current

    await waitFor(client, "drift"); // the safety net corrects it
    assert.equal((await client.evaluate("f")).enabled, false);
  })
);