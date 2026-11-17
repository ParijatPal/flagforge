const http = require("node:http");
const { once } = require("node:events");

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
  updatedAt: "t0",
  ...extra,
});

async function startFake(initial = [makeFlag("f", 1)]) {
  const state = {
    flags: new Map(initial.map((f) => [f.key, f])),
    sdkCalls: 0,
    streams: new Set(),
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://fake");
    if (url.pathname === "/api/v1/stream") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("retry: 2000\n\n");
      res.write("event: hello\ndata: {}\n\n");
      state.streams.add(res);
      req.on("close", () => state.streams.delete(res));
    } else if (url.pathname === "/api/v1/sdk/flags") {
      state.sdkCalls++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ env: "dev", flags: [...state.flags.values()] }));
    } else {
      res.writeHead(404).end();
    }
  });

  server.listen(0);
  await once(server, "listening");

  return {
    state,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    setFlag: (f) => state.flags.set(f.key, f), // silent change: no event is sent
    push: (msg) => {
      for (const s of state.streams) s.write(`event: flag\ndata: ${JSON.stringify(msg)}\n\n`);
    },
    close: () => { server.closeAllConnections(); server.close(); },
  };
}

module.exports = { startFake, makeFlag };