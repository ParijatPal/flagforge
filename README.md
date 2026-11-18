# FlagForge

A feature-flag service. Admins change flags through an API; SDKs receive changes live
and keep answering from a local snapshot if the API goes down.

```
Dashboard ──x-api-key──> API (Express) ──> Redis (flags, audit, Pub/Sub)
                           │  ▲
        SSE stream (public)│  │ x-sdk-key snapshot
                           ▼  │
                         SDK (local evaluation)
```

| Folder | What it is |
|---|---|
| `api/` | Express API: flag CRUD, audit log, evaluate, SSE stream, SDK snapshot |
| `sdk/` | Node SDK with two clients (`FlagForgeClient`, `LocalFlagClient`) |
| `dashboard/` | Admin UI (in progress) |

## Quick start (demo)

Requires Docker Desktop and Node 18+.

1. Create a `.env` at the repo root:
   ```
   API_KEY=demo-admin-key
   SDK_KEY=demo-sdk-key
   ```
2. Start the API and Redis (Redis is not exposed outside Docker):
   ```
   docker compose -f docker-compose.prod.yml up -d --build
   curl http://localhost:4000/api/v1/health
   ```
3. Create a flag:
   ```
   curl -X POST http://localhost:4000/api/v1/flags -H "Content-Type: application/json" \
     -H "x-api-key: demo-admin-key" -d @api/tests/fixtures/flag.json
   curl -X PATCH "http://localhost:4000/api/v1/flags/new-checkout?env=dev" \
     -H "Content-Type: application/json" -H "x-api-key: demo-admin-key" \
     -d '{"enabled":true,"rolloutPercentage":100}'
   ```
4. Run the SDK demo:
   ```
   cd sdk
   node examples/demo-local.js
   ```
5. Toggle the flag (`{"enabled":false}`) and watch the demo update within milliseconds.
   Then run `docker compose -f docker-compose.prod.yml stop api`: the SDK keeps answering
   from its snapshot (`stale snapshot`) and reconnects after `start`.

On Windows PowerShell use `curl.exe` instead of `curl`.

## Authentication

| Who | Header | Routes |
|---|---|---|
| Dashboard (admin) | `x-api-key` | `/api/v1/flags`, `/api/v1/audit` |
| SDK (server-side only) | `x-sdk-key` | `/api/v1/sdk/flags` |
| Anyone | none | `/api/v1/evaluate`, `/api/v1/stream`, `/api/v1/health` |

The SDK key returns every flag with its targeting rules. Never ship it to a browser.
Send `x-actor: <name>` on writes so the audit log shows who changed what.
Full endpoint list: `API_CONTRACT.md`.

## Development

```
docker compose up -d redis      # Redis on localhost:6379
cd api && npm install && npm run dev
cd api && npm test              # needs Redis, uses DB 15
cd sdk && npm test              # no API needed
```

Behind a proxy (Render, Railway, nginx) set `TRUST_PROXY=1`.
Rate limits are per IP and configurable (`RATE_EVALUATE_PER_MIN`, `RATE_SDK_PER_MIN`,
`RATE_STREAM_PER_MIN`, `STREAM_MAX_PER_IP`).

## What works

- Flag CRUD with versioning, per-environment (`dev`, `staging`, `prod`), audit log
- Rollout percentages and targeting rules, evaluated identically on server and SDK
- Live updates over SSE; safety-net re-sync; regression and drift events in the SDK
- Atomic updates: concurrent edits never lose a write
- Rate limits and open-stream cap
- CI running API and SDK tests on every PR

## Known limits

- Single API instance (rate limits are in memory)
- Version numbers alone can't detect data loss; the periodic re-sync is the safety net
- Prototype: no user accounts, one shared admin key