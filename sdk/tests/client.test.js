import test from "node:test";
import assert from "node:assert";
import { FlagForge } from "../src/index.js";

test("caches results and falls back on error", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, json: async () => ({ key: "a", enabled: true, reason: "x", version: 1 }) };
  };
  const ff = new FlagForge({ stream: false });
  assert.equal(await ff.isEnabled("a", { userId: "1" }), true);
  assert.equal(await ff.isEnabled("a", { userId: "1" }), true);
  assert.equal(calls, 1);

  globalThis.fetch = async () => { throw new Error("down"); };
  assert.equal(await ff.isEnabled("b", {}, false), false);
});