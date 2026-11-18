// Needs no Redis: tests the limiter on its own, plus the stream cap.
process.env.REDIS_URL = process.env.TEST_REDIS_URL || "redis://localhost:6379/15";
process.env.STREAM_MAX_PER_IP = "2";

const test = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const { rateLimit } = require("../src/middleware/rateLimit");

function appWith(limit) {
  const app = express();
  app.get("/", limit, (_req, res) => res.json({ ok: true }));
  return app;
}

test("allows up to max, then returns 429 with Retry-After", async () => {
  const app = appWith(rateLimit({ max: 3 }));
  for (let i = 0; i < 3; i++) await request(app).get("/").expect(200);
  const res = await request(app).get("/").expect(429);
  assert.ok(Number(res.headers["retry-after"]) >= 1);
});

test("window resets after windowMs", async () => {
  const app = appWith(rateLimit({ max: 1, windowMs: 100 }));
  await request(app).get("/").expect(200);
  await request(app).get("/").expect(429);
  await new Promise((r) => setTimeout(r, 150));
  await request(app).get("/").expect(200);
});

test("each IP has its own counter", async () => {
  const app = express();
  app.set("trust proxy", 1);
  app.get("/", rateLimit({ max: 1 }), (_req, res) => res.json({ ok: true }));
  await request(app).get("/").set("X-Forwarded-For", "1.1.1.1").expect(200);
  await request(app).get("/").set("X-Forwarded-For", "1.1.1.1").expect(429);
  await request(app).get("/").set("X-Forwarded-For", "2.2.2.2").expect(200);
});

test("stream: a third open connection from one IP is refused, and a slot frees on close", async () => {
  const redis = require("../src/db/redisClient");
  const app = require("../src/app");
  const { closeStream } = require("../src/routes/stream");
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/api/v1/stream?env=staging`;
  const ctrls = [];
  try {
    for (let i = 0; i < 2; i++) {
      const c = new AbortController();
      ctrls.push(c);
      const res = await fetch(url, { signal: c.signal });
      assert.equal(res.status, 200);
    }
    assert.equal((await fetch(url)).status, 429);

    ctrls[0].abort(); // free one slot
    let status;
    for (let i = 0; i < 40; i++) {
      const c = new AbortController();
      ctrls.push(c);
      status = (await fetch(url, { signal: c.signal })).status;
      if (status === 200) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(status, 200);
  } finally {
    ctrls.forEach((c) => c.abort());
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await closeStream();
    await redis.quit();
  }
});