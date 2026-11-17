const { LocalFlagClient } = require("../src");

const client = new LocalFlagClient({ env: "dev" });
client.on("connected", () => console.log("[stream] connected"));
client.on("disconnected", () => console.log("[stream] disconnected"));
client.on("flag", (m) => console.log("[stream] update:", m));
client.start();

setInterval(async () => {
  try {
    const r = await client.evaluate("new-checkout", { userId: "123", plan: "pro" });
    const stale = client.isStale() ? " (stale snapshot)" : "";
    console.log(new Date().toLocaleTimeString(), r, stale);
  } catch (e) {
    console.log(new Date().toLocaleTimeString(), "error:", e.message);
  }
}, 2000);

process.on("SIGINT", () => {
  client.stop();
  process.exit(0);
});