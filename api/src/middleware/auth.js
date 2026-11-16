const crypto = require("crypto");

// Hash both sides first so the compare is constant-time
// and works even when the lengths differ.
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function requireApiKey(req, res, next) {
  const expected = process.env.API_KEY;

  // fail closed: no key configured means nobody gets in
  if (!expected) {
    return res.status(500).json({ error: "server has no API_KEY configured" });
  }

  const given = req.get("x-api-key");
  if (!given || !safeEqual(given, expected)) {
    return res.status(401).json({ error: "invalid or missing API key" });
  }
  next();
}

module.exports = { requireApiKey };