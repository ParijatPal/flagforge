const { Router } = require("express");
const crypto = require("node:crypto");
const { envSchema } = require("../models/flagSchema");
const repo = require("../db/flagRepository");

const router = Router();

// compare hashes so the check takes the same time for any input
const digest = (s) => crypto.createHash("sha256").update(String(s)).digest();
const keyOk = (given, expected) => crypto.timingSafeEqual(digest(given), digest(expected));

// read-only key: it can only call this route, never the admin /flags routes
router.use((req, res, next) => {
  const expected = process.env.SDK_KEY;

  // fail closed: no key configured means nobody gets in
  if (!expected) {
    return res.status(500).json({ error: "server has no SDK_KEY configured" });
  }
  if (!keyOk(req.get("x-sdk-key") ?? "", expected)) {
    return res.status(401).json({ error: "invalid sdk key" });
  }
  next();
});

router.get("/", async (req, res, next) => {
  try {
    const env = envSchema.safeParse(req.query.env ?? "dev");
    if (!env.success) {
      return res.status(400).json({ error: "env must be dev, staging or prod" });
    }
    const flags = await repo.list(env.data);
    res.json({ env: env.data, flags });
  } catch (e) {
    next(e);
  }
});

module.exports = router;