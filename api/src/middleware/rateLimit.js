// Fixed-window limiter, per client IP, kept in memory (fine for one API instance).
// Over the limit -> 429 with Retry-After.
function rateLimit({ windowMs = 60000, max = 100 } = {}) {
  const hits = new Map(); // ip -> { count, resetAt }

  // drop expired entries so the map can't grow forever
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, h] of hits) if (h.resetAt <= now) hits.delete(ip);
  }, windowMs);
  sweep.unref();

  return (req, res, next) => {
    const now = Date.now();
    let h = hits.get(req.ip);
    if (!h || h.resetAt <= now) {
      h = { count: 0, resetAt: now + windowMs };
      hits.set(req.ip, h);
    }
    h.count++;

    res.set("RateLimit-Limit", String(max));
    res.set("RateLimit-Remaining", String(Math.max(0, max - h.count)));

    if (h.count > max) {
      res.set("Retry-After", String(Math.ceil((h.resetAt - now) / 1000)));
      return res.status(429).json({ error: "too many requests, slow down" });
    }
    next();
  };
}

const num = (name, fallback) => Number(process.env[name]) || fallback;

module.exports = { rateLimit, num };
