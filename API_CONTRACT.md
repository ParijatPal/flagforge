Auth: all /api/v1/flags and /api/v1/audit routes need header `x-api-key: <API_KEY>`.
/evaluate and /health are public.

Flag { id, key, name, description, environment, enabled,
       rolloutPercentage, targetingRules[], defaultVariant,
       version, createdAt, updatedAt }

PATCH only changes the fields you send. Every write bumps `version` by 1.

POST   /api/v1/flags
GET    /api/v1/flags?env=prod
GET    /api/v1/flags/:key?env=prod
PATCH  /api/v1/flags/:key
DELETE /api/v1/flags/:key
GET    /api/v1/evaluate/:key?env=prod&userId=123&plan=pro
       -> { key, enabled, reason, version }
       (every query param except env is a user attribute)
GET    /api/v1/audit?env=prod&limit=50&key=my-flag
       -> { entries: [{ ts, env, action, key, version, actor, changes }] }
       (newest first, last 1000 kept; optional header x-actor names who made a change)
GET    /api/v1/health

Redis keys: flag:{env}:{key}   flags:{env}   audit:{env}
Pub/Sub:    flagforge:updates:{env} -> { key, action, version }