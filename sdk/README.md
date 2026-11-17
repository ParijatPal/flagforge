# flagforge-sdk

```js
const { FlagForgeClient } = require("flagforge-sdk");
const client = new FlagForgeClient({ baseUrl: "http://localhost:4000", env: "dev" });
client.start();
if (await client.isEnabled("new-checkout", { userId: "123", plan: "pro" })) { /* ... */ }
```

Results are cached and invalidated live by the API's SSE stream.
Call `client.stop()` on shutdown.