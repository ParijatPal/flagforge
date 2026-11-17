const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { FlagForgeClient } = require("../src");

// ---- fake FlagForge API ----
async function startFake() {
  const state = { version: 1, evalCalls: 0, streams: new Set() };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://fake");
    if (url.pathname === "/api/v1/stream") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("retry: 2000\n\n");
      res.write("event: hello\ndata: {}\n\n");
      state.streams.add(res);
      req.on("close", () => state.streams.delete(res));
    } else if (url.pathname.startsWith("/api/v1/evaluate/")) {
      state.evalCalls++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        key: url.pathname.split("/").pop(),
        enabled: true,
        reason: "test",
        version: state.version,
      }));
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

async function withClient(fn) {
  const fake = await startFake();
  const client = new FlagForgeClient({ baseUrl: fake.baseUrl, env: "dev", ttlMs: 60000 });
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
test("serves repeat calls from cache while the stream is connected", { timeout: 10000 }, () =>
  withClient(async (fake, client) => {
    await client.evaluate("f", { userId: "1" });
    await client.evaluate("f", { userId: "1" });
    assert.equal(fake.state.evalCalls, 1);
  })
);

test("a newer flag event invalidates the cache", { timeout: 10000 }, () =>
  withClient(async (fake, client) => {
    const first = await client.evaluate("f");
    assert.equal(first.version, 1);

    fake.state.version = 2;
    const seen = waitFor(client, "flag");
    fake.push({ key: "f", action: "updated", version: 2 });
    await seen;

    const second = await client.evaluate("f");
    assert.equal(second.version, 2);
    assert.equal(fake.state.evalCalls, 2);
  })
);

test("a stale (older) flag event does not invalidate newer cached data", { timeout: 10000 }, () =>
  withClient(async (fake, client) => {
    fake.state.version = 5;
    await client.evaluate("f");

    const seen = waitFor(client, "flag");
    fake.push({ key: "f", action: "updated", version: 3 });
    await seen;

    await client.evaluate("f");
    assert.equal(fake.state.evalCalls, 1); // still served from cache
  })
);

test("after a disconnect the cache is not trusted, and a reconnect clears it", { timeout: 15000 }, () =>
  withClient(async (fake, client) => {
    await client.evaluate("f");
    assert.equal(fake.state.evalCalls, 1);

    const down = waitFor(client, "disconnected");
    fake.dropStreams();
    await down;

    // disconnected: every call must go to the server
    await client.evaluate("f");
    assert.equal(fake.state.evalCalls, 2);

    // SDK reconnects by itself (about 1s backoff)
    await waitFor(client, "connected");

    // the reconnect cleared the cache, so this hits the server once...
    await client.evaluate("f");
    assert.equal(fake.state.evalCalls, 3);
    // ...and is cached again afterwards
    await client.evaluate("f");
    assert.equal(fake.state.evalCalls, 3);
  })
);

test("isEnabled returns the fallback when the API is unreachable", async () => {
  const client = new FlagForgeClient({ baseUrl: "http://127.0.0.1:1" });
  assert.equal(await client.isEnabled("f", {}, true), true);
  assert.equal(await client.isEnabled("f", {}, false), false);
});