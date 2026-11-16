const redis = require("./redisClient");

const auditKey = (env) => `audit:${env}`;
const MAX_ENTRIES = 1000;

async function record(env, entry) {
  const full = { ts: new Date().toISOString(), env, ...entry };
  await redis.lpush(auditKey(env), JSON.stringify(full));
  await redis.ltrim(auditKey(env), 0, MAX_ENTRIES - 1); // keep newest 1000
}

async function list(env, { limit = 50, key } = {}) {
  const raws = await redis.lrange(auditKey(env), 0, MAX_ENTRIES - 1);
  let entries = raws.map((r) => JSON.parse(r));
  if (key) entries = entries.filter((e) => e.key === key);
  return entries.slice(0, limit);
}

module.exports = { record, list };