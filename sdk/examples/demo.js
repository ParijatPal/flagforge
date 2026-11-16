import { FlagForge } from "../src/index.js";

const ff = new FlagForge({ env: "dev" }).init();

setInterval(async () => {
  const r = await ff.evaluate("new-checkout", { userId: "123", plan: "pro" });
  console.log(new Date().toLocaleTimeString(), r);
}, 3000);