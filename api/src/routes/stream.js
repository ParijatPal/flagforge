const { Router } = require("express");
const redis = require("../db/redisClient");
const { envSchema } = require("../models/flagSchema");

const router = Router();

// env -> Set of open responses (one per connected SDK)
const clients = new Map();

// A Redis connection in subscribe mode can't run normal commands,
// so the stream gets its own connection. One is shared by every client.
const sub = redis.duplicate();
sub.on("error", (e) => console.error("Redis subscriber error:", e.message));
sub.psubscribe("flagforge:updates:*").catch((e) => console.error("subscribe failed:", e.message));

sub.on("pmessage", (_pattern, channel, message) => {
  const env = channel.split(":").pop();
  for (const res of clients.get(env) ?? []) {
    res.write(`event: flag\ndata: ${message}\n\n`);
  }
});

// Public like /evaluate: messages only carry { key, action, version }.
router.get("/", (req, res) => {
  const env = envSchema.safeParse(req.query.env ?? "dev");
  if (!env.success) {
    return res.status(400).json({ error: "env must be dev, staging or prod" });
  }

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // stops nginx from buffering the stream
  });
  res.flushHeaders();
  res.write("retry: 2000\n\n");
  res.write("event: hello\ndata: {}\n\n");

  if (!clients.has(env.data)) clients.set(env.data, new Set());
  clients.get(env.data).add(res);

  // a comment line every 25s keeps proxies from closing an idle connection
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    clients.get(env.data)?.delete(res);
  });
});

module.exports = router;