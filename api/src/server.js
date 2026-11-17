require("dotenv").config();
const express = require("express");
const cors = require("cors");
const redis = require("./db/redisClient");
const { requireApiKey } = require("./middleware/auth");

// loud reminder when a real deployment still uses the public dev keys
const DEV_KEYS = ["dev-secret-key", "dev-sdk-key"];
if (
  process.env.NODE_ENV === "production" &&
  [process.env.API_KEY, process.env.SDK_KEY].some((k) => DEV_KEYS.includes(k))
) {
  console.warn("WARNING: running in production with the default dev keys. Set API_KEY and SDK_KEY.");
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/v1/health", async (_req, res) => {
  try {
    await redis.ping();
    res.json({ status: "ok", redis: "up" });
  } catch {
    res.status(503).json({ status: "degraded", redis: "down" });
  }
});

app.use("/api/v1/flags", requireApiKey, require("./routes/flags"));
app.use("/api/v1/evaluate", require("./routes/evaluate"));
app.use("/api/v1/audit", requireApiKey, require("./routes/audit"));
app.use("/api/v1/sdk/flags", require("./routes/sdk"));
app.use("/api/v1/stream", require("./routes/stream"));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "internal server error" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`FlagForge API on :${PORT}`));