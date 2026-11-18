const { Router } = require("express");
const redis = require("../db/redisClient");
const { envSchema } = require("../models/flagSchema");
const { num } = require("../middleware/rateLimit");

const router = Router();

// env -> Set of open responses (one per connected SDK)
const clients = new Map();

// ip -> number of streams currently open (one client can't hold every socket)
const openByIp = new Map();

// A Redis connection in subscribe mode can't run normal commands,
// so the stream gets its own connection, shared by every client.
// It is created on the first request, so importing this file opens nothing.
let sub = null;
let subReady = null;

function ensureSubscriber() {
  if (sub) return subReady;
  sub = redis.duplicate();
  sub.on("error", (e) => console.error("Redis subscriber error:", e.message));
  sub.on("pmessage", (_pattern, channel, message) => {
    const env = channel.split(":").pop();
    for (const res of clients.get(env) ?? []) {
      res.write(`event: flag\ndata: ${message}\n\n`);
    }
  });
  subReady = sub.psubscribe("flagforge:updates:*").catch((e) => {
    console.error("subscribe failed:", e.message);
  });
  return subReady;
}

// closes every open stream and the subscriber connection (used by tests and shutdown)
async function closeStream() {
  for (const set of clients.values()) for (const res of set) res.end();
  clients.clear();
  openByIp.clear();
  if (sub) await sub.quit().catch(() => {});
  sub = null;
  subReady = null;
}

// Public like /evaluate: messages only carry { key, action, version }.
router.get("/", async (req, res) => {
  const env = envSchema.safeParse(req.query.env ?? "dev");
  if (!env.success) {
    return res.status(400).json({ error: "env must be dev, staging or prod" });
  }

  const max = num("STREAM_MAX_PER_IP", 50);
  if ((openByIp.get(req.ip) ?? 0) >= max) {
    return res.status(429).json({ error: "too many open streams for this IP" });
  }
  openByIp.set(req.ip, (openByIp.get(req.ip) ?? 0) + 1);

  const ready = ensureSubscriber();

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // stops nginx from buffering the stream
  });
  res.flushHeaders();
  res.write("retry: 2000\n\n");

  if (!clients.has(env.data)) clients.set(env.data, new Set());
  clients.get(env.data).add(res);

  // a comment line every 25s keeps proxies from closing an idle connection
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => {
    clearInterval(heartbeat);
    clients.get(env.data)?.delete(res);
    const left = (openByIp.get(req.ip) ?? 1) - 1;
    if (left > 0) openByIp.set(req.ip, left);
    else openByIp.delete(req.ip);
  });

  // "hello" means we are really subscribed, so a client can trust it
  await ready;
  res.write("event: hello\ndata: {}\n\n");
});

module.exports = router;
module.exports.closeStream = closeStream;