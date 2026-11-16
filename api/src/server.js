require("dotenv").config();
const express = require("express");
const cors = require("cors");
const redis = require("./db/redisClient");

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

app.use("/api/v1/flags", require("./routes/flags"));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "internal server error" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`FlagForge API on :${PORT}`));