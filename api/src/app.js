const express = require("express");
const cors = require("cors");
const redis = require("./db/redisClient");
const { requireApiKey } = require("./middleware/auth");
const { rateLimit, num } = require("./middleware/rateLimit");

const app = express();

// Behind a proxy (Railway, Render, nginx) the real client IP is in X-Forwarded-For.
// Set TRUST_PROXY=1 there, otherwise every user looks like the proxy's IP.
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY));

// per-IP limits, per minute. Override with env vars if needed.
const evaluateLimit = rateLimit({ max: num("RATE_EVALUATE_PER_MIN", 600) });
const sdkLimit = rateLimit({ max: num("RATE_SDK_PER_MIN", 120) });
const streamLimit = rateLimit({ max: num("RATE_STREAM_PER_MIN", 60) });

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
app.use("/api/v1/evaluate", evaluateLimit, require("./routes/evaluate"));
app.use("/api/v1/audit", requireApiKey, require("./routes/audit"));
app.use("/api/v1/sdk/flags", sdkLimit, require("./routes/sdk"));
app.use("/api/v1/stream", streamLimit, require("./routes/stream"));

app.use((err, _req, res, _next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "invalid JSON body" });
  }
  console.error(err);
  res.status(500).json({ error: "internal server error" });
});

module.exports = app;