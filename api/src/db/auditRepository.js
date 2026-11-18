const redis = require("./redisClient");

const auditKey = (env) => `audit:${env}`;
const MAX_ENTRIES = 1000;

// builds the JSON line that gets stored (also used inside the atomic write script)
const buildEntry = (env, entry) => JSON.stringify({ ts: new Date().toISOString(), env, ...entry });

async function record(env, entry) {
  await redis.lpush(auditKey(env), buildEntry(env, entry));
  await redis.ltrim(auditKey(env), 0, MAX_ENTRIES - 1);
}

async function list(env, { limit = 50, key } = {}) {
  const raws = await redis.lrange(auditKey(env), 0, MAX_ENTRIES - 1);
  let entries = raws.map((r) => JSON.parse(r));
  if (key) entries = entries.filter((e) => e.key === key);
  return entries.slice(0, limit);
}

module.exports = { record, list, auditKey, buildEntry, MAX_ENTRIES };