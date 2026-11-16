const { Router } = require("express");
const repo = require("../db/flagRepository");
const { envSchema, createFlagSchema, updateFlagSchema } = require("../models/flagSchema");

const router = Router();

// a label for the audit log, not a security feature (anyone can type any name)
const actorOf = (req) => req.get("x-actor") || "unknown";

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const badRequest = (res, error) =>
  res.status(400).json({
    error: "validation failed",
    issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });

// returns the env, or sends a 400 and returns null
function getEnv(req, res) {
  const parsed = envSchema.safeParse(req.query.env ?? "dev");
  if (!parsed.success) {
    res.status(400).json({ error: "env must be dev, staging or prod" });
    return null;
  }
  return parsed.data;
}

// LIST
router.get("/", wrap(async (req, res) => {
  const env = getEnv(req, res);
  if (!env) return;
  res.json({ flags: await repo.list(env) });
}));

// CREATE
router.post("/", wrap(async (req, res) => {
  const parsed = createFlagSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const flag = await repo.create(parsed.data, actorOf(req));
  if (!flag) return res.status(409).json({ error: "flag already exists in this environment" });
  res.status(201).json(flag);
}));

// GET ONE
router.get("/:key", wrap(async (req, res) => {
  const env = getEnv(req, res);
  if (!env) return;
  const flag = await repo.get(env, req.params.key);
  if (!flag) return res.status(404).json({ error: "flag not found" });
  res.json(flag);
}));

// UPDATE
router.patch("/:key", wrap(async (req, res) => {
  const env = getEnv(req, res);
  if (!env) return;
  const parsed = updateFlagSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);

  const flag = await repo.update(env, req.params.key, parsed.data, actorOf(req));
  if (!flag) return res.status(404).json({ error: "flag not found" });
  res.json(flag);
}));

// DELETE
router.delete("/:key", wrap(async (req, res) => {
  const env = getEnv(req, res);
  if (!env) return;
  const removed = await repo.remove(env, req.params.key, actorOf(req));
  if (!removed) return res.status(404).json({ error: "flag not found" });
  res.status(204).end();
}));

module.exports = router;