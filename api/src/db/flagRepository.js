const { randomUUID } = require("crypto");
const redis = require("./redisClient");

const flagKey = (env, key) => `flag:${env}:${key}`;
const setKey = (env) => `flags:${env}`;
const channel = (env) => `flagforge:updates:${env}`;

async function publish(env, key, action, version) {
  await redis.publish(channel(env), JSON.stringify({ key, action, version }));
}

async function create(data) {
  const { environment: env, key } = data;
  const now = new Date().toISOString();
  const flag = { id: randomUUID(), ...data, version: 1, createdAt: now, updatedAt: now };

  // NX = only set if it doesn't exist yet (atomic, no race)
  const ok = await redis.set(flagKey(env, key), JSON.stringify(flag), "NX");
  if (!ok) return null; // already exists

  await redis.sadd(setKey(env), key);
  await publish(env, key, "created", flag.version);
  return flag;
}

async function get(env, key) {
  const raw = await redis.get(flagKey(env, key));
  return raw ? JSON.parse(raw) : null;
}

async function list(env) {
  const keys = await redis.smembers(setKey(env));
  if (keys.length === 0) return [];
  const raws = await redis.mget(keys.map((k) => flagKey(env, k)));
  return raws
    .filter(Boolean)
    .map((r) => JSON.parse(r))
    .sort((a, b) => a.key.localeCompare(b.key));
}

async function update(env, key, changes) {
  const existing = await get(env, key);
  if (!existing) return null;

  const updated = {
    ...existing,
    ...changes,
    version: existing.version + 1, // every write bumps the version
    updatedAt: new Date().toISOString(),
  };
  await redis.set(flagKey(env, key), JSON.stringify(updated));
  await publish(env, key, "updated", updated.version);
  return updated;
}

async function remove(env, key) {
  const existing = await get(env, key);
  if (!existing) return false;

  await redis.del(flagKey(env, key));
  await redis.srem(setKey(env), key);
  await publish(env, key, "deleted", existing.version + 1);
  return true;
}

module.exports = { create, get, list, update, remove };