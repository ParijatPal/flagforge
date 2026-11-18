// Route tests: real Express app + real Redis. Uses Redis DB 15 and env "staging"
// so it can never touch your dev data (DB 0).
process.env.REDIS_URL = process.env.TEST_REDIS_URL || "redis://localhost:6379/15";
process.env.API_KEY = "test-admin-key";
process.env.SDK_KEY = "test-sdk-key";

const test = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const Redis = require("ioredis");

const redis = require("../src/db/redisClient");
const app = require("../src/app");
const { closeStream } = require("../src/routes/stream");

const ENV = "staging";
const admin = { "x-api-key": "test-admin-key", "x-actor": "tester" };
const body = (over = {}) => ({ key: "new-checkout", name: "New checkout", environment: ENV, ...over });
const create = (over) => request(app).post("/api/v1/flags").set(admin).send(body(over));

test.before(async () => {
  try {
    await Promise.race([
      redis.ping(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000)),
    ]);
  } catch {
    console.error("\nRedis is not reachable. Start it with: docker compose up -d redis\n");
    process.exit(1);
  }
  if (!redis.options.db) {
    console.error("Refusing to run on Redis DB 0 (your real data). Use a URL ending in /15.");
    process.exit(1);
  }
});

test.beforeEach(() => redis.flushdb());

test.after(async () => {
  await closeStream();
  await redis.flushdb();
  await redis.quit();
});

test("auth", async (t) => {
  await t.test("admin routes reject missing and wrong keys", async () => {
    await request(app).get("/api/v1/flags?env=" + ENV).expect(401);
    await request(app).get("/api/v1/flags?env=" + ENV).set("x-api-key", "nope").expect(401);
    await request(app).get("/api/v1/audit?env=" + ENV).expect(401);
  });

  await t.test("health, evaluate and stream are public", async () => {
    await request(app).get("/api/v1/health").expect(200);
    await create();
    await request(app).get(`/api/v1/evaluate/new-checkout?env=${ENV}`).expect(200);
  });

  await t.test("SDK key and admin key are not interchangeable", async () => {
    await request(app).get("/api/v1/sdk/flags?env=" + ENV).expect(401);
    await request(app).get("/api/v1/sdk/flags?env=" + ENV).set("x-sdk-key", "test-sdk-key").expect(200);
    await request(app).get("/api/v1/sdk/flags?env=" + ENV).set("x-api-key", "test-admin-key").expect(401);
    await request(app).get("/api/v1/flags?env=" + ENV).set("x-sdk-key", "test-sdk-key").expect(401);
  });

  await t.test("SDK route fails closed when SDK_KEY is unset", async () => {
    const saved = process.env.SDK_KEY;
    delete process.env.SDK_KEY;
    try {
      const res = await request(app).get("/api/v1/sdk/flags?env=" + ENV).set("x-sdk-key", "anything");
      assert.equal(res.status, 500);
    } finally {
      process.env.SDK_KEY = saved;
    }
  });
});

test("flags CRUD", async (t) => {
  await t.test("create returns 201 with defaults and version 1", async () => {
    const res = await create().expect(201);
    assert.equal(res.body.enabled, false);
    assert.equal(res.body.rolloutPercentage, 100);
    assert.equal(res.body.version, 1);
  });

  await t.test("duplicate key returns 409", async () => {
    await create().expect(201);
    await create().expect(409);
  });

  await t.test("invalid body returns 400 with issues", async () => {
    const res = await create({ key: "bad key!", rolloutPercentage: 150 }).expect(400);
    assert.ok(res.body.issues.length >= 2);
  });

  await t.test("malformed JSON returns 400, not 500", async () => {
    await request(app)
      .post("/api/v1/flags")
      .set(admin)
      .set("Content-Type", "application/json")
      .send('{"key": ')
      .expect(400);
  });

  await t.test("invalid env returns 400", async () => {
    await request(app).get("/api/v1/flags?env=nope").set(admin).expect(400);
  });

  await t.test("get and list", async () => {
    await create().expect(201);
    const one = await request(app).get(`/api/v1/flags/new-checkout?env=${ENV}`).set(admin).expect(200);
    assert.equal(one.body.key, "new-checkout");
    const list = await request(app).get(`/api/v1/flags?env=${ENV}`).set(admin).expect(200);
    assert.equal(list.body.flags.length, 1);
    await request(app).get(`/api/v1/flags/missing?env=${ENV}`).set(admin).expect(404);
  });

  await t.test("flags are separated by environment", async () => {
    await create().expect(201);
    const res = await request(app).get("/api/v1/flags?env=prod").set(admin).expect(200);
    assert.equal(res.body.flags.length, 0);
  });

  await t.test("PATCH changes only what was sent and bumps version", async () => {
    await create({ rolloutPercentage: 40 }).expect(201);
    const res = await request(app)
      .patch(`/api/v1/flags/new-checkout?env=${ENV}`)
      .set(admin)
      .send({ enabled: true })
      .expect(200);
    assert.equal(res.body.enabled, true);
    assert.equal(res.body.rolloutPercentage, 40, "rollout must not reset");
    assert.equal(res.body.version, 2);
  });

  await t.test("PATCH unknown flag returns 404", async () => {
    await request(app).patch(`/api/v1/flags/missing?env=${ENV}`).set(admin).send({ enabled: true }).expect(404);
  });

  await t.test("DELETE returns 204, then 404", async () => {
    await create().expect(201);
    await request(app).delete(`/api/v1/flags/new-checkout?env=${ENV}`).set(admin).expect(204);
    await request(app).delete(`/api/v1/flags/new-checkout?env=${ENV}`).set(admin).expect(404);
    await request(app).get(`/api/v1/flags/new-checkout?env=${ENV}`).set(admin).expect(404);
  });
});

test("evaluate", async (t) => {
  await t.test("disabled flag is off", async () => {
    await create({ enabled: false }).expect(201);
    const res = await request(app).get(`/api/v1/evaluate/new-checkout?env=${ENV}&userId=u1`).expect(200);
    assert.equal(res.body.enabled, false);
    assert.equal(res.body.reason, "flag_disabled");
  });

  await t.test("rollout is stable for the same user", async () => {
    await create({ enabled: true, rolloutPercentage: 50 }).expect(201);
    const url = `/api/v1/evaluate/new-checkout?env=${ENV}&userId=user-42`;
    const first = (await request(app).get(url)).body.enabled;
    for (let i = 0; i < 5; i++) {
      assert.equal((await request(app).get(url)).body.enabled, first);
    }
  });

  await t.test("targeting rule wins over rollout", async () => {
    await create({
      enabled: true,
      rolloutPercentage: 0,
      targetingRules: [{ id: "pro", attribute: "plan", operator: "in", values: ["pro"], serve: true, priority: 1 }],
    }).expect(201);
    const res = await request(app).get(`/api/v1/evaluate/new-checkout?env=${ENV}&userId=u1&plan=pro`).expect(200);
    assert.equal(res.body.enabled, true);
    assert.match(res.body.reason, /^rule_match/);
  });

  await t.test("unknown flag 404, bad env 400", async () => {
    await request(app).get(`/api/v1/evaluate/missing?env=${ENV}`).expect(404);
    await request(app).get("/api/v1/evaluate/x?env=nope").expect(400);
  });
});

test("audit and sdk snapshot", async (t) => {
  await t.test("audit records who changed what", async () => {
    await create().expect(201);
    await request(app).patch(`/api/v1/flags/new-checkout?env=${ENV}`).set(admin).send({ enabled: true }).expect(200);
    const res = await request(app).get(`/api/v1/audit?env=${ENV}`).set(admin).expect(200);
    assert.equal(res.body.entries.length, 2);
    assert.ok(res.body.entries.every((e) => e.actor === "tester"));
  });

  await t.test("sdk/flags returns the full snapshot", async () => {
    await create().expect(201);
    await create({ key: "other" }).expect(201);
    const res = await request(app)
      .get(`/api/v1/sdk/flags?env=${ENV}`)
      .set("x-sdk-key", "test-sdk-key")
      .expect(200);
    assert.equal(res.body.env, ENV);
    assert.equal(res.body.flags.length, 2);
  });
});

test("realtime", async (t) => {
  await t.test("create, update and delete publish on Pub/Sub", async () => {
    const sub = new Redis(process.env.REDIS_URL);
    const got = [];
    sub.on("message", (_c, m) => got.push(JSON.parse(m)));
    await sub.subscribe(`flagforge:updates:${ENV}`);

    await create().expect(201);
    await request(app).patch(`/api/v1/flags/new-checkout?env=${ENV}`).set(admin).send({ enabled: true }).expect(200);
    await request(app).delete(`/api/v1/flags/new-checkout?env=${ENV}`).set(admin).expect(204);

    for (let i = 0; i < 50 && got.length < 3; i++) await new Promise((r) => setTimeout(r, 20));
    await sub.quit();

    assert.deepEqual(
      got.map((m) => [m.key, m.action, m.version]),
      [
        ["new-checkout", "created", 1],
        ["new-checkout", "updated", 2],
        ["new-checkout", "deleted", 3],
      ]
    );
  });

  await t.test("SSE stream sends hello, then a flag event after a change", async () => {
    const server = app.listen(0);
    const port = server.address().port;
    const ctrl = new AbortController();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/stream?env=${ENV}`, { signal: ctrl.signal });
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type"), /text\/event-stream/);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let text = "";
      const readUntil = async (needle) => {
        while (!text.includes(needle)) {
          const { value, done } = await reader.read();
          if (done) throw new Error("stream ended before: " + needle);
          text += dec.decode(value, { stream: true });
        }
      };

      await readUntil("event: hello");
      await create().expect(201);
      await readUntil("event: flag");
      assert.match(text, /"action":"created"/);
    } finally {
      ctrl.abort();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });

  await t.test("stream rejects a bad env", async () => {
    await request(app).get("/api/v1/stream?env=nope").expect(400);
  });
});