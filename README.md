# FlagForge

A self-hosted, real-time feature flag service. Turn features on or off, roll them out to a percentage of users, or target specific users, **without redeploying your app**. Changes reach connected apps in milliseconds, and apps keep working from a local copy if the server goes down.

## Features

- **Flags per environment:** `dev`, `staging` and `prod` each have their own flags, with versioning.
- **Gradual rollout:** "50%" means a stable half of your users. The same user always gets the same answer, and raising the percentage never switches anyone off.
- **Targeting rules:** serve a flag on or off to specific users, for example `plan in [pro, enterprise]`.
- **Real-time updates:** changes are pushed over Server-Sent Events (SSE) and arrive in milliseconds.
- **SDK with local evaluation:** the SDK downloads all flags once and answers from memory, so there is no network call per check. If the API goes down, the SDK keeps answering from its last snapshot and reconnects by itself.
- **Audit history:** every change records who made it, when, and exactly what changed.
- **Dashboard:** a web UI for all of the above.
- **Safe by design:** atomic concurrent edits, rate limits, an open-stream cap, constant-time key checks, and servers that refuse to run without configured keys.
- **Tested:** CI runs the API and SDK tests on every pull request.

## How it fits together

```
 Dashboard ──x-api-key──► API (Express) ──► Redis (flags, audit log, Pub/Sub)
 curl / scripts ─────────►   │  ▲
                SSE stream   │  │ x-sdk-key snapshot
                (public)     ▼  │
                          Your app + SDK (local evaluation)
```

| Folder | What it is | Docs |
|---|---|---|
| `api/` | Express API: flag CRUD, audit log, evaluate, SSE stream, SDK snapshot | [api/README.md](api/README.md) |
| `sdk/` | Node SDK with two clients (`FlagForgeClient`, `LocalFlagClient`) | [sdk/README.md](sdk/README.md) |
| `dashboard/` | Admin UI (React + Vite) | [dashboard/README.md](dashboard/README.md) |
| `docker-compose.yml` | Development: Redis (and optionally the API) | |
| `docker-compose.prod.yml` | Demo / production-like: private Redis, required keys | |
| `.github/workflows/ci.yml` | Runs the API and SDK tests on every PR | |
| `API_CONTRACT.md` | Full endpoint reference | [API_CONTRACT.md](API_CONTRACT.md) |

**Tech:** Node.js 20, Express 5, Redis 7 (ioredis), zod, React 18, Vite, Docker Compose, GitHub Actions.

---

# User Manual

## 1. What you need installed

| Tool | Why | Check it |
|---|---|---|
| Node.js 20+ | Runs the API, SDK and dashboard | `node -v` |
| Docker Desktop | Runs Redis and the API. It must be **running**. | `docker -v` |
| Git | Gets the code | `git --version` |

## 2. Get the code

```
git clone https://github.com/ParijatPal/flagforge.git
cd flagforge
```

## 3. Choose how to run it

| | Option A: Demo mode | Option B: Development mode |
|---|---|---|
| Use it for | Showing the project, trying it out | Changing the API code |
| API runs | In Docker | From source with auto-restart |
| Keys come from | Root `.env` (required) | `api/.env` |
| Redis | Private to Docker | On `localhost:6379` |

Use one option at a time. Both use port 4000.

---

## Option A: Demo mode

**Step 1. Create the keys file.** In the repo root (`flagforge/`), create `.env`:

```
API_KEY=demo-admin-key
SDK_KEY=demo-sdk-key
```

- `API_KEY` is the admin key (the dashboard and scripts use it to manage flags).
- `SDK_KEY` is a read-only key (apps use it to download flags).
- For anything beyond a local demo, use long random values. In PowerShell, `[guid]::NewGuid().ToString("N")` generates one.
- Never commit this file. It is already ignored by git.

**Step 2. Start Redis and the API:**

```
docker compose -f docker-compose.prod.yml up -d --build
```

This builds the API image and starts Redis (data is saved to disk and survives restarts) and the API on port 4000. Redis has no published port, so it can't be reached from outside Docker. Compose refuses to start if either key is missing.

**Step 3. Check it is healthy:**

```
curl http://localhost:4000/api/v1/health
```

Expected: `{"status":"ok","redis":"up"}`

> On Windows PowerShell, use `curl.exe` instead of `curl`.

**Step 4. Start the dashboard.** Create `dashboard/.env`:

```
VITE_API_URL=http://localhost:4000
VITE_API_KEY=demo-admin-key
VITE_ACTOR=your-name
```

`VITE_API_KEY` must match `API_KEY` exactly, with no quotes and no spaces. Then, from `flagforge/dashboard`:

```
npm install
```

```
npm run dev
```

Open **http://localhost:5173**. You should see a green **live** dot.

## Option B: Development mode

**Step 1. Create `api/.env`:**

```
PORT=4000
REDIS_URL=redis://localhost:6379
API_KEY=dev-secret-key
SDK_KEY=dev-sdk-key
```

**Step 2. Start Redis** (from `flagforge/`):

```
docker compose up -d redis
```

**Step 3. Start the API** (from `flagforge/api`):

```
npm install
```

```
npm run dev
```

The API restarts when you edit code. It does not reload `.env`, so restart it after editing that file.

**Step 4. Start the dashboard** as in Option A, Step 4, but use `VITE_API_KEY=dev-secret-key`.

---

## 4. Use the dashboard

Open **http://localhost:5173**.

| You want to | Do this |
|---|---|
| Switch environment | Use the `dev / staging / prod` dropdown. Each environment has separate flags. |
| Create a flag | Type a key (letters, numbers, `-`, `_`; up to 64 characters), optionally a display name, then click **Create in dev**. New flags start OFF. |
| Turn a flag on or off | Click the toggle on its card. |
| Set a rollout | Drag the **Rollout** slider and release. |
| Target specific users | Click **Rules**, enter an attribute (for example `plan`), an operator, values separated by commas, choose serve on or off, then **Add rule**. |
| Remove a rule | Click **remove** next to it. |
| Delete a flag | Click **Delete** and confirm. |
| See history | Read the **Audit history** panel: who changed what, and when. |
| Check the connection | A green **live** dot means the real-time stream is connected. |

More detail: [dashboard/README.md](dashboard/README.md).

## 5. How a flag decision is made

When an app asks whether a flag is on for a user, FlagForge checks in this order and stops at the first match:

1. **Flag is OFF** → off for everyone.
2. **Targeting rules**, lowest priority number first. The first matching rule decides.
3. **Percentage rollout.** The user's `userId` and the flag key are hashed into a stable bucket from 0 to 99. Users whose bucket is below the percentage get the feature.
4. **No `userId`** on a percentage rollout → the flag's default value is used.

The server and the SDK use identical logic, so they always agree. Rule operators: `equals`, `in`, `contains`.

## 6. Check a flag from your app

**Quick test with curl.** No key is needed:

```
curl "http://localhost:4000/api/v1/evaluate/new-checkout?env=dev&userId=user-42&plan=pro"
```

The reply is `{ "key": "new-checkout", "enabled": true, "reason": "...", "version": 3 }`. Every query parameter except `env` becomes a user attribute that rules can match on.

**Using the SDK (recommended for real apps).** The SDK downloads all flags once, listens for changes, and answers from memory:

- Each check is instant and makes no network call.
- Changes arrive live over the stream, and a periodic re-sync is the safety net.
- If the API goes down, it keeps answering from its last snapshot and reconnects automatically.
- Use the SDK key on **servers only**. It returns every flag with its rules, so never ship it to a browser.

For code examples and options, see [sdk/README.md](sdk/README.md).

## 7. Try the full live demo

This shows the whole product working together. Keep the dashboard open in a browser.

**Step 1. Create and enable a flag:**

```
curl -X POST http://localhost:4000/api/v1/flags -H "Content-Type: application/json" -H "x-api-key: demo-admin-key" -d @api/tests/fixtures/flag.json
```

```
curl -X PATCH "http://localhost:4000/api/v1/flags/new-checkout?env=dev" -H "Content-Type: application/json" -H "x-api-key: demo-admin-key" -d "{\"enabled\":true,\"rolloutPercentage\":100}"
```

(You can also do this in the dashboard.)

**Step 2. Run the SDK demo.** In a second terminal, from `flagforge/sdk`:

```
node examples/demo-local.js
```

**Step 3. Toggle the flag** in the dashboard. The demo terminal updates within milliseconds, and the change appears in the audit history.

**Step 4. Break the API on purpose.** From `flagforge/`:

```
docker compose -f docker-compose.prod.yml stop api
```

The dashboard shows **offline**, but the SDK keeps answering from its snapshot (`stale snapshot`).

**Step 5. Bring it back:**

```
docker compose -f docker-compose.prod.yml start api
```

The SDK reconnects by itself and the dashboard goes live again.

## 8. Manage flags with curl (optional)

Admin routes need the admin key in `x-api-key`. `x-actor` is an optional name for the audit log.

```
curl "http://localhost:4000/api/v1/flags?env=dev" -H "x-api-key: demo-admin-key" -H "x-actor: your-name"
```

Every endpoint, with request and response examples, is documented in [api/README.md](api/README.md) and [API_CONTRACT.md](API_CONTRACT.md).

## 9. Stop and restart

| Goal | Command (from `flagforge/`) |
|---|---|
| Stop everything, keep your data | `docker compose -f docker-compose.prod.yml down` |
| Start again | `docker compose -f docker-compose.prod.yml up -d` |
| Stop only the API | `docker compose -f docker-compose.prod.yml stop api` |
| Follow the API logs | `docker compose -f docker-compose.prod.yml logs -f api` |
| Stop the dashboard | `Ctrl+C` in its terminal |

> **Warning:** `docker compose down -v` also deletes the saved data (all flags and history).

If you reboot your PC: start Docker Desktop, run the `up -d` command, then `npm run dev` in `dashboard/`.

## 10. Run the tests

The API tests use a real Redis, on database 15, so they never touch your real data.

```
docker compose up -d redis
```

From `flagforge/api`:

```
npm test
```

From `flagforge/sdk`:

```
npm test
```

GitHub Actions runs the same tests on every pull request.

## 11. Troubleshooting

| What you see | Cause and fix |
|---|---|
| Dashboard: `invalid or missing API key` | `VITE_API_KEY` doesn't match `API_KEY`. Fix `dashboard/.env`, then stop and restart `npm run dev` (Vite reads `.env` only at startup). |
| Dashboard: `Failed to fetch`, or **offline** | The API isn't running on port 4000. Run the health check from Option A, Step 3. |
| Port 4000 busy / `port is already allocated` | Two copies of the API are running (dev mode and Docker). Stop one. |
| Docker error mentioning the engine or pipe | Docker Desktop isn't running. Start it. |
| `Missing script: "dev"` or `"test"` | You're in the wrong folder. Run npm commands inside `api/`, `sdk/` or `dashboard/`. |
| `429 too many requests` | A rate limit was reached. Wait a minute. |
| Changed the root `.env`, nothing changed | Docker reads it only when containers are created. Run `docker compose -f docker-compose.prod.yml up -d` again. |
| Empty flag list after starting demo mode | Demo mode starts with a fresh database. Create the flags again. |

---

# Reference

## Authentication

| Who | Header | Routes |
|---|---|---|
| Dashboard / admin | `x-api-key` | `/api/v1/flags`, `/api/v1/audit` |
| SDK (server-side only) | `x-sdk-key` | `/api/v1/sdk/flags` |
| Anyone | none | `/api/v1/evaluate`, `/api/v1/stream`, `/api/v1/health` |

The admin key and SDK key are not interchangeable. Send `x-actor: <name>` on writes so the audit log shows who changed what. It is only a label, not a login.

## Endpoints at a glance

Base URL: `http://localhost:4000/api/v1`

| Method | Path | Key | Purpose |
|---|---|---|---|
| GET | `/health` | none | Is the API and Redis up? |
| GET | `/flags?env=` | admin | List flags |
| POST | `/flags` | admin | Create a flag (409 if it exists) |
| GET | `/flags/:key?env=` | admin | Get one flag |
| PATCH | `/flags/:key?env=` | admin | Change only the fields you send |
| DELETE | `/flags/:key?env=` | admin | Delete a flag |
| GET | `/audit?env=&limit=&key=` | admin | Change history, newest first |
| GET | `/evaluate/:key?env=&userId=...` | none | Is this flag on for this user? |
| GET | `/sdk/flags?env=` | SDK | Download all flags (used by the SDK) |
| GET | `/stream?env=` | none | Live change events (SSE) |

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4000` | API port |
| `REDIS_URL` | `redis://localhost:6379` | Where Redis is |
| `API_KEY` | none (required) | Admin key. Admin routes return 500 if it is unset. |
| `SDK_KEY` | none (required) | SDK key. `/sdk/flags` returns 500 if it is unset. |
| `TRUST_PROXY` | off | Set to `1` behind a proxy (Render, Railway, nginx) so rate limits see real client IPs |
| `RATE_EVALUATE_PER_MIN` | `600` | Per-IP limit on `/evaluate` |
| `RATE_SDK_PER_MIN` | `120` | Per-IP limit on `/sdk/flags` |
| `RATE_STREAM_PER_MIN` | `60` | Per-IP limit on new `/stream` connections |
| `STREAM_MAX_PER_IP` | `50` | Open streams allowed at once per IP |

## Security notes

- Set real, random `API_KEY` and `SDK_KEY` for anything beyond local use. With `NODE_ENV=production`, the API warns at startup if the default dev keys are still in use.
- In the demo/production compose file, Redis has no published port.
- Keys are compared in constant time, and the API refuses requests if a key is not configured (it never fails open).
- Rate limits and an open-stream cap protect the public routes.

## What works

- Flag CRUD with versioning, per environment (`dev`, `staging`, `prod`), with an audit log
- Rollout percentages and targeting rules, evaluated identically on the server and in the SDK
- Live updates over SSE, a safety-net re-sync, and regression and drift events in the SDK
- Atomic updates: concurrent edits never lose a write
- Rate limits and an open-stream cap
- A web dashboard for all of the above
- CI running the API and SDK tests on every pull request

## Known limits

- Single API instance: rate limits are kept in memory.
- The dashboard holds the admin key in the browser bundle. This is fine for a local demo; a public deployment needs a login and a backend that holds the key.
- One shared admin key for all environments, and no user accounts. `x-actor` is only a label.
- CORS is open to all origins.
- Version numbers alone can't detect data loss; the periodic re-sync is the safety net.
- On free hosting tiers that sleep when idle, the live stream drops while the service sleeps.

## License

MIT