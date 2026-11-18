const { randomUUID } = require("crypto");
const redis = require("./redisClient");
const audit = require("./auditRepository");

const flagKey = (env, key) => `flag:${env}:${key}`;
const setKey = (env) => `flags:${env}`;
const channel = (env) => `flagforge:updates:${env}`;

async function publish(env, key, action, version) {
  await redis.publish(channel(env), JSON.stringify({ key, action, version }));
}

// Compare-and-set, run as ONE step inside Redis so nothing can slip in between:
// only write if the stored version is still the one we read. In the same step it
// also publishes the change and appends the audit entry, so all three happen or none.
// Returns 1 = written, 0 = someone else changed it first, -1 = flag no longer exists.
redis.defineCommand("flagCas", {
  numberOfKeys: 4, // flag, set of keys, pub/sub channel, audit list
  lua: `
    local raw = redis.call('GET', KEYS[1])
    if not raw then return -1 end
    if cjson.decode(raw).version ~= tonumber(ARGV[1]) then return 0 end
    if ARGV[2] == '' then
      redis.call('DEL', KEYS[1])
      redis.call('SREM', KEYS[2], ARGV[5])
    else
      redis.call('SET', KEYS[1], ARGV[2])
    end
    redis.call('PUBLISH', KEYS[3], ARGV[3])
    redis.call('LPUSH', KEYS[4], ARGV[4])
    redis.call('LTRIM', KEYS[4], 0, tonumber(ARGV[6]) - 1)
    return 1
  `,
});

// every round at least one writer wins, so 30 tries covers 30 simultaneous editors
const MAX_TRIES = 30;

// read -> change -> compare-and-set; if someone beat us, re-read and try again
async function casWrite(env, key, actor, build) {
  for (let i = 0; i < MAX_TRIES; i++) {
    const existing = await get(env, key);
    if (!existing) return null;

    const { next, action, version, extra } = build(existing);
    const result = await redis.flagCas(
      flagKey(env, key),
      setKey(env),
      channel(env),
      audit.auditKey(env),
      existing.version,
      next ? JSON.stringify(next) : "",
      JSON.stringify({ key, action, version }),
      audit.buildEntry(env, { action, key, version, actor, ...extra }),
      key,
      audit.MAX_ENTRIES
    );
    if (result === 1) return next ?? true;
    if (result === -1) return null;
    // result === 0: lost the race. Wait a few ms (random, so writers don't collide again), retry.
    await new Promise((r) => setTimeout(r, Math.random() * 5));
  }
  const err = new Error("flag is being changed too often, try again");
  err.code = "CONFLICT";
  throw err;
}

async function create(data, actor = "unknown") {
  const { environment: env, key } = data;
  const now = new Date().toISOString();
  const flag = { id: randomUUID(), ...data, version: 1, createdAt: now, updatedAt: now };
  const ok = await redis.set(flagKey(env, key), JSON.stringify(flag), "NX");
  if (!ok) return null;
  await redis.sadd(setKey(env), key);
  await publish(env, key, "created", flag.version);
  await audit.record(env, { action: "created", key, version: flag.version, actor });
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
  return raws.filter(Boolean).map((r) => JSON.parse(r)).sort((a, b) => a.key.localeCompare(b.key));
}

function update(env, key, changes, actor = "unknown") {
  return casWrite(env, key, actor, (existing) => {
    const next = { ...existing, ...changes, version: existing.version + 1, updatedAt: new Date().toISOString() };
    return { next, action: "updated", version: next.version, extra: { changes } };
  });
}

async function remove(env, key, actor = "unknown") {
  const done = await casWrite(env, key, actor, (existing) => ({
    next: null,
    action: "deleted",
    version: existing.version + 1,
  }));
  return Boolean(done);
}

module.exports = { create, get, list, update, remove };