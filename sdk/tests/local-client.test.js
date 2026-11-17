const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { LocalFlagClient } = require("../src");

const makeFlag = (key, version, extra = {}) => ({
  id: `id-${key}`,
  key,
  name: key,
  environment: "dev",
  enabled: true,
  rolloutPercentage: 100,
  targetingRules: [],
  defaultVariant: false,
  version,
  ...extra,
});

// ---- fake FlagForge API with a snapshot endpoint ----
async function startFake() {
  const state = {
    flags: new Map([["f", makeFlag("f", 1)]]),
    sdkCalls: 0,
    sdkStatus: 200, // set to 401 to simulate a bad key
    sdkDelay: () => 0, // per-call delay in ms, for out-of-order tests
    streams: new Set(),
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://fake");
    if (url.pathname === "/api/v1/stream") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("retry: 2000\n\n");
      res.write("event: hello\ndata: {}\n\n");
      state.streams.add(res);
      req.on("close", () => state.streams.delete(res));
    } else if (url.pathname === "/api/v1/sdk/flags") {
      state.sdkCalls++;
      const body = JSON.stringify({ env: "dev", flags: [...state.flags.values()] });
      const status = state.sdkStatus;
      await new Promise((r) => setTimeout(r, state.sdkDelay(state.sdkCalls)));
      if (status !== 200) {
        res.writeHead(status, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "invalid sdk key" }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
    } else {
      res.writeHead(404).end();
    }
  });

  server.listen(0);
  await once(server, "listening");

  return {
    state,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    push: (msg) => {
      for (const s of state.streams) s.write(`event: flag\ndata: ${JSON.stringify(msg)}\n\n`);
    },
    dropStreams: () => { for (const s of state.streams) s.destroy(); },
    close: () => { server.closeAllConnections(); server.close(); },
  };
}

const waitFor = (client, event) => new Promise((resolve) => client.on(event, resolve));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withClient(fn) {
  const fake = await startFake();
  const client = new LocalFlagClient({ baseUrl: fake.baseUrl, env: "dev", sdkKey: "k" });
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

// ---- tests ----
test("evaluates locally after the first sync, with no per-call requests", { timeout: 10000 }, () =>
  withClient(async (fake, client) => {
    const before = fake.state.sdkCalls;
    for (let i = 0; i < 50; i++) await client.evaluate("f", { userId: `u${i}` });
    assert.equal(fake.state.sdkCalls, before);
    const r = await client.evaluate("f", { userId: "u1" });
    assert.equal(r.enabled, true);
    assert.equal(r.version, 1);
  })
);

test("a newer flag event triggers a re-sync and updates the answer", { timeout: 10000 }, () =>
  withClient(async (fake, client) => {
    fake.state.flags.set("f", makeFlag("f", 2, { enabled: false }));
    const seen = waitFor(client, "flag");
    fake.push({ key: "f", action: "updated", version: 2 });
    await seen;
    const r = await client.evaluate("f", { userId: "u1" });
    assert.equal(r.version, 2);
    assert.equal(r.enabled, false);
  })
);

test("an event for a version we already hold does not re-sync", { timeout: 10000 }, () =>
  withClient(async (fake, client) => {
    const before = fake.state.sdkCalls;
    const seen = waitFor(client, "flag");
    fake.push({ key: "f", action: "updated", version: 1 });
    await seen;
    assert.equal(fake.state.sdkCalls, before);
  })
);

test("a delete event removes the flag, so evaluate throws 404", { timeout: 10000 }, () =>
  withClient(async (fake, client) => {
    fake.state.flags.delete("f");
    const seen = waitFor(client, "flag");
    fake.push({ key: "f", action: "deleted", version: 2 });
    await seen;
    await assert.rejects(() => client.evaluate("f"), /404/);
  })
);

test("keeps answering from the snapshot while disconnected, and isStale() is true", { timeout: 15000 }, () =>
  withClient(async (fake, client) => {
    assert.equal(client.isStale(), false);
    const down = waitFor(client, "disconnected");
    fake.dropStreams();
    await down;

    assert.equal(client.isStale(), true);
    const r = await client.evaluate("f", { userId: "u1" });
    assert.equal(r.version, 1); // served from the last snapshot, no error
  })
);

test("a reconnect re-syncs and picks up changes missed while disconnected", { timeout: 15000 }, () =>
  withClient(async (fake, client) => {
    const down = waitFor(client, "disconnected");
    fake.dropStreams();
    await down;

    // changed while the SDK was offline: no event could reach it
    fake.state.flags.set("f", makeFlag("f", 7));
    await waitFor(client, "connected"); // SDK reconnects by itself

    assert.equal(client.isStale(), false);
    const r = await client.evaluate("f", { userId: "u1" });
    assert.equal(r.version, 7);
  })
);

test("a slow, older sync cannot overwrite a newer snapshot", { timeout: 10000 }, () =>
  withClient(async (fake, client) => {
    // first re-sync is slow and returns v2; second is fast and returns v3
    fake.state.sdkDelay = (n) => (n === fake.state.sdkCalls && slowCall === n ? 300 : 0);
    const slowCall = fake.state.sdkCalls + 1;

    fake.state.flags.set("f", makeFlag("f", 2));
    fake.push({ key: "f", action: "updated", version: 2 });
    await sleep(50); // the slow request is now in flight

    fake.state.flags.set("f", makeFlag("f", 3));
    fake.push({ key: "f", action: "updated", version: 3 });

    await sleep(600); // let both finish
    const r = await client.evaluate("f", { userId: "u1" });
    assert.equal(r.version, 3);
  })
);

test("a 401 from /sdk/flags is retried and does not crash the client", { timeout: 15000 }, async () => {
  const fake = await startFake();
  fake.state.sdkStatus = 401;
  const client = new LocalFlagClient({ baseUrl: fake.baseUrl, env: "dev", sdkKey: "bad" });
  let connected = false;
  client.on("connected", () => { connected = true; });
  client.start();
  try {
    await sleep(1500);
    assert.equal(connected, false); // never becomes ready with a bad key
    assert.ok(fake.state.sdkCalls >= 2); // but it keeps retrying
    await assert.rejects(() => client.evaluate("f"), /not loaded/);

    fake.state.sdkStatus = 200; // key fixed
    await waitFor(client, "connected");
    assert.equal((await client.evaluate("f")).version, 1);
  } finally {
    client.stop();
    fake.close();
  }
});