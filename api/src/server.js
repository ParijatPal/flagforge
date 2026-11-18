require("dotenv").config();
const app = require("./app");

// loud reminder when a real deployment still uses the public dev keys
const DEV_KEYS = ["dev-secret-key", "dev-sdk-key"];
if (
  process.env.NODE_ENV === "production" &&
  [process.env.API_KEY, process.env.SDK_KEY].some((k) => DEV_KEYS.includes(k))
) {
  console.warn("WARNING: running in production with the default dev keys. Set API_KEY and SDK_KEY.");
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`FlagForge API on :${PORT}`));