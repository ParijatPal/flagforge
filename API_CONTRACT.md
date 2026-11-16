Auth: all /api/v1/flags routes need header `x-api-key: <API_KEY>`.
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
GET    /api/v1/health

Redis keys: flag:{env}:{key}   flags:{env}
Pub/Sub:    flagforge:updates:{env} -> { key, action, version }