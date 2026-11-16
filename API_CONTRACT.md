Flag { id, key, name, description, environment, enabled,
       rolloutPercentage, targetingRules[], defaultVariant,
       version, createdAt, updatedAt }

POST   /api/v1/flags
GET    /api/v1/flags?env=prod
GET    /api/v1/flags/:key?env=prod
PATCH  /api/v1/flags/:key
DELETE /api/v1/flags/:key
GET    /api/v1/evaluate/:key?env=prod&userId=123
GET    /api/v1/health

Redis keys: flag:{env}:{key}   flags:{env}
Pub/Sub:    flagforge:updates:{env} -> { key, action, version }