const { Router } = require("express");
const repo = require("../db/flagRepository");
const { envSchema } = require("../models/flagSchema");
const { evaluate } = require("../services/evaluation");

const router = Router();

router.get("/:key", async (req, res, next) => {
  try {
    const env = envSchema.safeParse(req.query.env ?? "dev");
    if (!env.success) {
      return res.status(400).json({ error: "env must be dev, staging or prod" });
    }

    // every query param except env becomes a user attribute (userId, plan, ...)
    const { env: _ignored, ...context } = req.query;

    const flag = await repo.get(env.data, req.params.key);
    if (!flag) return res.status(404).json({ error: "flag not found" });

    const { enabled, reason } = evaluate(flag, context);
    res.json({ key: flag.key, enabled, reason, version: flag.version });
  } catch (err) {
    next(err);
  }
});

module.exports = router;