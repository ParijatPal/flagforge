const { Router } = require("express");
const audit = require("../db/auditRepository");
const { envSchema } = require("../models/flagSchema");

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const env = envSchema.safeParse(req.query.env ?? "dev");
    if (!env.success) {
      return res.status(400).json({ error: "env must be dev, staging or prod" });
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const entries = await audit.list(env.data, { limit, key: req.query.key });
    res.json({ entries });
  } catch (err) {
    next(err);
  }
});

module.exports = router;