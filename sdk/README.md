# flagforge-sdk

```js
const { FlagForgeClient } = require("flagforge-sdk");
const client = new FlagForgeClient({ baseUrl: "http://localhost:4000", env: "dev" });
client.start();
if (await client.isEnabled("new-checkout", { userId: "123", plan: "pro" })) { /* ... */ }
```

Results are cached and invalidated live by the API's SSE stream.
Call `client.stop()` on shutdown.
# flagforge-sdk

Two clients. Both need the API's SSE stream for live updates.

## Simple client (calls /evaluate)

```js
const { FlagForgeClient } = require("flagforge-sdk");
const client = new FlagForgeClient({ baseUrl: "http://localhost:4000", env: "dev" });
client.start();
if (await client.isEnabled("new-checkout", { userId: "123", plan: "pro" })) { /* ... */ }
client.stop();
```

Results are cached while the stream is connected, and cleared on every reconnect.

## Local client (evaluates in-process)

```js
const { LocalFlagClient } = require("flagforge-sdk");
const client = new LocalFlagClient({
  baseUrl: "http://localhost:4000",
  env: "dev",
  sdkKey: process.env.FLAGFORGE_SDK_KEY, // read-only key, server-side code only
  resyncMs: 30000,                       // safety-net re-sync, 0 = off
});
client.on("regression", (r) => console.warn("version went backwards", r));
client.start();
const { enabled } = await client.evaluate("new-checkout", { userId: "123" });
```

- Keeps answering from its last snapshot if the API goes down. `client.isStale()` tells you.
- Events: `connected`, `disconnected`, `flag`, `drift`, `regression`.
- The SDK key returns every flag with its targeting rules. Never ship it to a browser.

## Tests and experiments

`npm test` (no API needed), `npm run parity`, `npm run evalbench`, `npm run latency`,
`npm run recovery:missed`, `npm run recovery:regression` (this one runs FLUSHALL on dev Redis).