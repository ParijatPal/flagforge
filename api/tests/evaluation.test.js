const test = require("node:test");
const assert = require("node:assert");
const { evaluate, bucketFor } = require("../src/services/evaluation");

const makeFlag = (over = {}) => ({
  key: "f", enabled: true, rolloutPercentage: 100,
  targetingRules: [], defaultVariant: false, ...over,
});

test("disabled flag is always off", () => {
  assert.equal(evaluate(makeFlag({ enabled: false }), { userId: "a" }).enabled, false);
});

test("same user always gets the same bucket", () => {
  assert.equal(bucketFor("user-1", "f"), bucketFor("user-1", "f"));
});

test("30% rollout lands near 30%", () => {
  const flag = makeFlag({ rolloutPercentage: 30 });
  let on = 0;
  for (let i = 0; i < 10000; i++) if (evaluate(flag, { userId: `u${i}` }).enabled) on++;
  assert.ok(on > 2700 && on < 3300, `got ${on}`);
});

test("raising rollout never flips anyone off", () => {
  const low = makeFlag({ rolloutPercentage: 20 });
  const high = makeFlag({ rolloutPercentage: 60 });
  for (let i = 0; i < 2000; i++) {
    const ctx = { userId: `u${i}` };
    if (evaluate(low, ctx).enabled) assert.equal(evaluate(high, ctx).enabled, true);
  }
});

test("rules beat rollout, lowest priority first", () => {
  const flag = makeFlag({
    rolloutPercentage: 0,
    targetingRules: [
      { id: "b", attribute: "plan", operator: "equals", values: ["pro"], serve: false, priority: 2 },
      { id: "a", attribute: "plan", operator: "in", values: ["pro", "team"], serve: true, priority: 1 },
    ],
  });
  const r = evaluate(flag, { userId: "x", plan: "pro" });
  assert.deepEqual(r, { enabled: true, reason: "rule_match:a" });
});