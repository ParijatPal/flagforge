const { z } = require("zod");

const envSchema = z.enum(["dev", "staging", "prod"]);

const targetingRuleSchema = z.object({
  id: z.string(),
  attribute: z.string(),
  operator: z.enum(["equals", "in", "contains"]),
  values: z.array(z.string()),
  serve: z.boolean(),
  priority: z.number().int().default(0),
});

const createFlagSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]+$/i, "letters, numbers, - and _ only").max(64),
  name: z.string().min(1),
  description: z.string().optional(),
  environment: envSchema.default("dev"),
  enabled: z.boolean().default(false),
  rolloutPercentage: z.number().min(0).max(100).default(100),
  targetingRules: z.array(targetingRuleSchema).default([]),
  defaultVariant: z.boolean().default(false),
});

// No defaults here: a PATCH must only change what the caller sends.
// key and environment can't change after creation, so they're left out.
const updateFlagSchema = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    enabled: z.boolean(),
    rolloutPercentage: z.number().min(0).max(100),
    targetingRules: z.array(targetingRuleSchema),
    defaultVariant: z.boolean(),
  })
  .partial();

module.exports = { envSchema, createFlagSchema, updateFlagSchema };