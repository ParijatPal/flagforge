// COPY of api/src/services/evaluation.js. Keep the logic identical.
// After any change to either file, run `npm run parity` in sdk/.
const crypto = require("crypto");

// Permanent "lottery number" in [0, 100). Same user + same flag = same number.
function bucketFor(userId, flagKey) {
  const hash = crypto.createHash("sha256").update(`${flagKey}:${userId}`).digest();
  return (hash.readUInt32BE(0) / 2 ** 32) * 100;
}

function matchesRule(rule, ctx) {
  const actual = ctx[rule.attribute];
  if (actual === undefined || actual === null) return false;
  const v = String(actual);

  switch (rule.operator) {
    case "equals":   return v === rule.values[0];
    case "in":       return rule.values.includes(v);
    case "contains": return rule.values.some((x) => v.includes(x));
    default:         return false;
  }
}

// ctx example: { userId: "u1", plan: "pro", country: "IN" }
function evaluate(flag, ctx = {}) {
  // 1. master kill switch
  if (!flag.enabled) return { enabled: false, reason: "flag_disabled" };

  // 2. targeting rules, lowest priority number first
  const rules = [...flag.targetingRules].sort((a, b) => a.priority - b.priority);
  for (const rule of rules) {
    if (matchesRule(rule, ctx)) {
      return { enabled: rule.serve, reason: `rule_match:${rule.id}` };
    }
  }

  // 3. percentage rollout
  const pct = flag.rolloutPercentage;
  if (pct >= 100) return { enabled: true, reason: "rollout_full" };
  if (pct <= 0) return { enabled: false, reason: "rollout_zero" };

  // can't bucket an anonymous user, so use the fallback
  if (!ctx.userId) return { enabled: flag.defaultVariant, reason: "no_user_id" };

  const inRollout = bucketFor(ctx.userId, flag.key) < pct;
  return { enabled: inRollout, reason: inRollout ? "rollout_in" : "rollout_out" };
}

module.exports = { evaluate, bucketFor, matchesRule };