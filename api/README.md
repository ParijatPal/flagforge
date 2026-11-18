# FlagForge API

The server behind FlagForge. It stores feature flags in Redis, decides whether a flag is on for a given user, records an audit log of every change, and pushes changes to connected apps in real time.

Built with Node.js, Express 5, Redis (ioredis) and zod for validation.

---

## 1. Quick start

You need Node.js 20+ and Docker Desktop (running).

**Step 1. Start Redis.** From the repo root (`flagforge/`):

```
docker compose up -d redis
```

Starts Redis on `localhost:6379`. Data is saved to disk, so it survives restarts.

**Step 2. Create `api/.env`:**

```
PORT=4000
REDIS_URL=redis://localhost:6379
API_KEY=dev-secret-key
SDK_KEY=dev-sdk-key
```

**Step 3. Install and run.** From `flagforge/api`:

```
npm install
```

```
npm run dev
```

You should see `Redis connected` and `FlagForge API on :4000`.

**Step 4. Check it.**

```
curl http://localhost:4000/api/v1/health
```

Expected: `{"status":"ok","redis":"up"}`

> On Windows PowerShell, use `curl.exe` instead of `curl`.

---

## 2. Commands

Run these inside `flagforge/api`.

| Command | What it does |
|---|---|
| `npm install` | Installs dependencies (once, or after `package.json` changes) |
| `npm run dev` | Starts the API with auto-restart on code changes (nodemon). Does **not** reload `.env`, so restart it after editing `.env`. |
| `npm start` | Starts the API normally (what Docker runs) |
| `npm test` | Runs all tests. Needs Redis running. |

---

## 3. How it works

```
 request ─► rate limit ─► key check ─► route ─► repository ─► Redis
                                          │                     │
                                          │                     ├─ flag:{env}:{key}   (the flag, JSON)
                                          │                     ├─ flags:{env}        (set of keys)
                                          │                     ├─ audit:{env}        (history list)
                                          │                     └─ Pub/Sub channel ──► SSE stream ──► SDKs, dashboard
                                          └─ evaluation service (decides on/off for a user)
```

### Folder structure

```
api/
├── Dockerfile                    builds the production image
├── .env / .env.example           settings (.env is never committed)
├── package.json
├── src/
│   ├── server.js                 starts the server (loads .env, warns about dev keys)
│   ├── app.js                    builds the Express app: middleware, routes, error handler
│   ├── db/
│   │   ├── redisClient.js        the Redis connection
│   │   ├── flagRepository.js     create / get / list / update / delete (atomic writes)
│   │   └── auditRepository.js    audit log reads and writes
│   ├── middleware/
│   │   ├── auth.js               checks the admin key (x-api-key)
│   │   └── rateLimit.js          per-IP request limits
│   ├── models/
│   │   └── flagSchema.js         validation rules for flags (zod)
│   ├── routes/
│   │   ├── flags.js              admin: manage flags
│   │   ├── evaluate.js           public: is this flag on for this user?
│   │   ├── audit.js              admin: change history
│   │   ├── sdk.js                SDK key: download all flags
│   │   └── stream.js             public: live change stream (SSE)
│   └── services/
│       └── evaluation.js         the on/off decision logic
└── tests/
    ├── evaluation.test.js        decision logic
    ├── routes.test.js            every endpoint, against real Redis
    ├── concurrency.test.js       simultaneous edits
    ├── ratelimit.test.js         rate limits and stream cap
    └── fixtures/                 sample JSON used by tests and demos
```

### What happens on a change

1. An admin sends `PATCH /flags/new-checkout`.
2. The API validates the body and reads the current flag.
3. It writes the new version to Redis **in one atomic step**. The same step also records the audit entry and publishes a change message.
4. Every connected `/stream` client receives the message instantly, and the SDK downloads the new state.

---

## 4. Configuration

Set these in `api/.env` (development) or the root `.env` / hosting dashboard (production).

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4000` | Port the API listens on |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `API_KEY` | none | **Required.** Admin key. If unset, admin routes return 500 (they never fail open). |
| `SDK_KEY` | none | **Required.** Read-only SDK key. If unset, `/sdk/flags` returns 500. |
| `TRUST_PROXY` | off | Set to `1` behind a proxy (Render, Railway, nginx) so rate limits see the real client IP |
| `RATE_EVALUATE_PER_MIN` | `600` | Requests per minute per IP on `/evaluate` |
| `RATE_SDK_PER_MIN` | `120` | Requests per minute per IP on `/sdk/flags` |
| `RATE_STREAM_PER_MIN` | `60` | New stream connections per minute per IP |
| `STREAM_MAX_PER_IP` | `50` | Open streams allowed at once per IP |
| `NODE_ENV` | none | In `production`, the API warns if the default dev keys are still in use |
| `TEST_REDIS_URL` | `redis://localhost:6379/15` | Redis used by tests (must end in a database number such as `/15`) |

---

## 5. Authentication

| Who | Header | Can use |
|---|---|---|
| Admin (dashboard, scripts) | `x-api-key: <API_KEY>` | `/flags`, `/audit` |
| SDK (your servers) | `x-sdk-key: <SDK_KEY>` | `/sdk/flags` |
| Anyone | none | `/evaluate`, `/stream`, `/health` |

- The admin key and SDK key are **not interchangeable**.
- Keys are compared in constant time.
- `x-actor: <name>` is an optional header on writes. It labels the audit entry. It is **not** a login, since anyone can type any name.
- The SDK key returns every flag with its rules. Keep it on servers, never in browser code.

---

## 6. Endpoints

Base URL: `http://localhost:4000/api/v1`

`env` is `dev`, `staging` or `prod` (default `dev`). Any other value returns 400.

### Health

`GET /health` returns `{"status":"ok","redis":"up"}`, or 503 `{"status":"degraded","redis":"down"}` if Redis is unreachable.

### Create a flag

`POST /flags`

```
curl -X POST http://localhost:4000/api/v1/flags -H "Content-Type: application/json" -H "x-api-key: dev-secret-key" -H "x-actor: parijat" -d @tests/fixtures/flag.json
```

Body fields:

| Field | Required | Default | Rules |
|---|---|---|---|
| `key` | yes | | Letters, numbers, `-`, `_`; max 64 characters |
| `name` | yes | | Display name, not empty |
| `description` | no | | Text |
| `environment` | no | `dev` | `dev`, `staging`, `prod` |
| `enabled` | no | `false` | On or off |
| `rolloutPercentage` | no | `100` | 0 to 100 |
| `targetingRules` | no | `[]` | See rules below |
| `defaultVariant` | no | `false` | Answer used when no `userId` is given |

Returns **201** with the full flag (version 1). Returns **409** if the key already exists in that environment.

### List flags

`GET /flags?env=dev` returns `{ "flags": [ ... ] }`, sorted by key.

### Get one flag

`GET /flags/new-checkout?env=dev` returns the flag, or 404.

### Update a flag

`PATCH /flags/new-checkout?env=dev`

```
curl -X PATCH "http://localhost:4000/api/v1/flags/new-checkout?env=dev" -H "Content-Type: application/json" -H "x-api-key: dev-secret-key" -d '{"enabled":true,"rolloutPercentage":50}'
```

On Windows cmd, escape the quotes: `-d "{\"enabled\":true,\"rolloutPercentage\":50}"`

- Send only the fields you want to change. The rest stay as they are.
- `key` and `environment` cannot be changed after creation.
- Returns the updated flag with `version` increased by 1. Returns 404 if the flag doesn't exist.

### Delete a flag

`DELETE /flags/new-checkout?env=dev` returns **204** (no body), or 404.

### Check a flag for a user

`GET /evaluate/new-checkout?env=dev&userId=user-42&plan=pro`

No key needed. Every query parameter except `env` becomes a user attribute.

```
{ "key": "new-checkout", "enabled": true, "reason": "rollout_in", "version": 3 }
```

Returns 404 if the flag doesn't exist.

### Audit history

`GET /audit?env=dev&limit=50&key=new-checkout`

Returns `{ "entries": [ ... ] }`, newest first. `limit` is capped at 200 and `key` is optional.

```
{ "ts": "2026-11-18T04:12:03.000Z", "env": "dev", "action": "updated",
  "key": "new-checkout", "version": 8, "actor": "parijat", "changes": { "enabled": true } }
```

The log keeps the latest 1000 entries per environment.

### SDK snapshot

`GET /sdk/flags?env=dev` with `x-sdk-key` returns `{ "env": "dev", "flags": [ ... ] }`: every flag, with all rules, so the SDK can decide locally.

### Live stream

`GET /stream?env=dev`. See section 8.

---

## 7. Flags and how a decision is made

### The flag object

```
{
  "id": "…", "key": "new-checkout", "name": "New checkout flow",
  "environment": "dev", "enabled": true, "rolloutPercentage": 50,
  "targetingRules": [
    { "id": "pro-users", "attribute": "plan", "operator": "in",
      "values": ["pro", "enterprise"], "serve": true, "priority": 1 }
  ],
  "defaultVariant": false, "version": 3,
  "createdAt": "…", "updatedAt": "…"
}
```

### Decision order

The first step that applies decides the answer:

1. **Flag disabled** → off for everyone (`flag_disabled`).
2. **Targeting rules**, lowest `priority` first. The first rule that matches the user's attributes decides (`rule_match:<id>`), serving on or off as the rule says.
3. **Percentage rollout.** The user's `userId` is hashed together with the flag key (SHA-256) into a stable bucket from 0 to 99. Users whose bucket is below the percentage get the feature (`rollout_in`, otherwise `rollout_out`). `rollout_full` and `rollout_zero` cover 100% and 0%.
4. **No `userId`** on a percentage rollout → the flag's `defaultVariant` is used (`no_user_id`).

Rule operators: `equals`, `in` (matches any listed value), `contains`.

Why the hash matters: the same user always gets the same answer, and raising the percentage from 30 to 50 never switches anyone off.

### Versions

Every write increases `version` by 1. Deleting publishes `version + 1`. SDKs use versions to spot out-of-order or missed updates.

---

## 8. Real-time stream

`GET /stream?env=dev` is a Server-Sent Events connection. It stays open and the server pushes events:

| Event | When | Data |
|---|---|---|
| `retry: 2000` | On connect | Tells browsers to reconnect after 2 seconds |
| `hello` | Once the server is subscribed to changes | `{}` |
| `flag` | A flag was created, updated or deleted | `{"key":"new-checkout","action":"updated","version":4}` |
| `: ping` | Every 25 seconds | A comment line that keeps proxies from closing an idle connection |

`action` is `created`, `updated` or `deleted`. The message says **what** changed. The client then downloads the new state from `/sdk/flags` (or `/flags` for the dashboard).

Watch it yourself:

```
curl -N "http://localhost:4000/api/v1/stream?env=dev"
```

Change a flag in another terminal and watch the `flag` event appear.

---

## 9. Safe concurrent edits

Two people editing the same flag at the same moment never lose a change.

- Update and delete run as one **compare-and-set** inside Redis: the write only happens if the flag's version is still the one that was read.
- If someone else got there first, the API re-reads and retries automatically (up to 30 times, with a tiny random wait).
- The flag write, the audit entry and the change message happen together or not at all.
- An edit racing a delete can never bring a deleted flag back.
- If a flag is being changed too often to settle, the API returns **409** `flag is being changed too often, try again`.

---

## 10. Rate limits

Limits are per client IP, per minute:

| Route | Limit |
|---|---|
| `/evaluate` | 600 |
| `/sdk/flags` | 120 |
| `/stream` (new connections) | 60 |
| `/stream` (open at once) | 50 per IP |

Going over returns **429** with a `Retry-After` header (seconds). Responses include `RateLimit-Limit` and `RateLimit-Remaining`. Admin routes are protected by the key and are not rate limited.

Behind a proxy, set `TRUST_PROXY=1`. Otherwise every user appears to come from the proxy's IP and they share one limit.

---

## 11. Errors

| Status | Meaning |
|---|---|
| 400 | Invalid input. The body lists each problem: `{ "error": "validation failed", "issues": [ { "path": "rolloutPercentage", "message": "…" } ] }`. Also returned for a bad `env` and for malformed JSON. |
| 401 | Missing or wrong key |
| 404 | Flag not found |
| 409 | Flag already exists, or it is being changed too often |
| 429 | Rate limit or open-stream cap reached |
| 500 | Server error, or the key is not configured on the server |
| 503 | Health check: Redis is unreachable |

---

## 12. Data in Redis

| Key | Type | Holds |
|---|---|---|
| `flag:{env}:{key}` | string (JSON) | One flag |
| `flags:{env}` | set | The keys of all flags in an environment |
| `audit:{env}` | list | The latest 1000 audit entries, newest first |
| `flagforge:updates:{env}` | Pub/Sub channel | Change messages `{ key, action, version }` |

Redis runs with `--appendonly yes`, so writes are saved to disk and survive restarts.

---

## 13. Tests

```
docker compose up -d redis
```

From `flagforge/api`:

```
npm test
```

| Test file | Covers |
|---|---|
| `evaluation.test.js` | Decision logic: disabled, stable buckets, rollout, rule priority |
| `routes.test.js` | Every endpoint: auth, create, update, delete, evaluate, audit, SDK snapshot, stream, bad input |
| `concurrency.test.js` | 20 simultaneous edits, and an edit racing a delete |
| `ratelimit.test.js` | Rate limits and the open-stream cap |

The route tests use Redis database **15** and the `staging` environment, so they never touch your real data in database 0. They refuse to run if pointed at database 0. GitHub Actions runs the same tests on every pull request.

---

## 14. Docker

`api/Dockerfile` builds a small production image: Node 20 on Alpine, production dependencies only, runs as a non-root user, with a built-in health check.

From the repo root:

| Command | What it does |
|---|---|
| `docker compose up -d redis` | Development: Redis only, then run the API with `npm run dev` |
| `docker compose -f docker-compose.prod.yml up -d --build` | Production-like: Redis plus the API. Redis is not exposed outside Docker, and both keys are required. |
| `docker compose -f docker-compose.prod.yml logs -f api` | Follow the API logs |
| `docker compose -f docker-compose.prod.yml stop api` | Stop only the API |
| `docker compose -f docker-compose.prod.yml down` | Stop everything, keep data |

> `down -v` also deletes the saved data.

Don't run `npm run dev` and the Docker API at the same time. Both use port 4000.

---

## 15. Troubleshooting

| Problem | Fix |
|---|---|
| `Missing script: "dev"` | You're not in `flagforge/api`. |
| `ECONNREFUSED 127.0.0.1:6379` | Redis isn't running. Run `docker compose up -d redis` (Docker Desktop must be open). |
| Port 4000 already in use | Another API is running (`npm run dev` or Docker). Stop one. |
| 401 `invalid or missing API key` | The `x-api-key` header doesn't match `API_KEY`. |
| 500 `server has no API_KEY configured` | `API_KEY` is not set. |
| Changed `.env` but nothing changed | Restart `npm run dev`, or recreate the Docker container (`up -d`). |
| Tests say Redis is unreachable | Start Redis first. |

---

## 16. Known limits

- Single API instance: rate limits are kept in memory.
- One shared admin key for all environments, with no user accounts. `x-actor` is only a label.
- CORS is open to all origins.
- Creating a flag is not part of the atomic compare-and-set (a crash between its steps can leave a flag missing from the list). Update and delete are atomic.
- Version numbers alone can't detect data loss; the SDK's periodic re-sync is the safety net.