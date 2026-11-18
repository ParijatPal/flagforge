// Two people editing the same flag at the same moment must never lose a write.
process.env.REDIS_URL = process.env.TEST_REDIS_URL || "redis://localhost:6379/15";
process.env.API_KEY = "test-admin-key";

const test = require("node:test");
const assert = require("node:assert");
const request = require("supertest");

const redis = require("../src/db/redisClient");
const app = require("../src/app");

const ENV = "staging";
const admin = { "x-api-key": "test-admin-key", "x-actor": "tester" };
const url = `/api/v1/flags/race?env=${ENV}`;

test.before(() => {
  if (!redis.options.db) {
    console.error("Refusing to run on Redis DB 0. Use a URL ending in /15.");
    process.exit(1);
  }
});

test.beforeEach(async () => {
  await redis.flushdb();
  await request(app)
    .post("/api/v1/flags")
    .set(admin)
    .send({ key: "race", name: "Race", environment: ENV })
    .expect(201);
});

test.after(async () => {
  await redis.flushdb();
  await redis.quit();
});

test("20 simultaneous edits: every one counts, versions never repeat", async () => {
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      request(app).patch(url).set(admin).send({ description: `edit ${i}` })
    )
  );

  assert.ok(
    results.every((r) => r.status === 200),
    "failed edits: " +
      JSON.stringify(
        results
          .filter((r) => r.status !== 200)
          .map((r) => [r.status, r.body])
      )
  );

  const versions = results.map((r) => r.body.version).sort((a, b) => a - b);
  assert.deepEqual(
    versions,
    Array.from({ length: 20 }, (_, i) => i + 2),
    "each edit gets its own version"
  );

  const final = await request(app).get(url).set(admin).expect(200);
  assert.equal(final.body.version, 21);

  const log = await request(app)
    .get(`/api/v1/audit?env=${ENV}&limit=200`)
    .set(admin)
    .expect(200);

  assert.equal(log.body.entries.length, 21, "created + 20 updates all in the audit log");
});

test("an edit racing a delete can't bring the flag back", async () => {
  await Promise.all([
    request(app).delete(url).set(admin),
    ...Array.from({ length: 10 }, (_, i) =>
      request(app).patch(url).set(admin).send({ description: `edit ${i}` })
    ),
  ]);

  await request(app).get(url).set(admin).expect(404);
  assert.equal(await redis.sismember(`flags:${ENV}`, "race"), 0);
});