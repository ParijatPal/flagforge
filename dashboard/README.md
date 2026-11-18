# FlagForge Dashboard

The web interface for FlagForge. Create flags, switch them on and off, set rollout percentages, add targeting rules, and read the audit history. Changes made anywhere (this dashboard, another tab, curl, a script) show up on screen by themselves.

Built with React 18 and Vite, with no extra UI libraries. The look is a soft "neumorphism" theme written in plain CSS.

New here? Read the [User Manual](UserManual.md) for what every button does.

---

## 1. Quick start

You need Node.js 20+ and a **running FlagForge API** (see `api/README.md` or the root README).

**Step 1. Start the API** (from the repo root, `flagforge/`):

```
docker compose -f docker-compose.prod.yml up -d --build
```

Check that it's healthy:

```
curl http://localhost:4000/api/v1/health
```

You should see `{"status":"ok","redis":"up"}`.

**Step 2. Create `dashboard/.env`:**

```
VITE_API_URL=http://localhost:4000
VITE_API_KEY=<your admin key>
VITE_ACTOR=your-name
```

| Setting | Meaning |
|---|---|
| `VITE_API_URL` | Where the API runs |
| `VITE_API_KEY` | The admin key. It must match the API's `API_KEY` exactly (no quotes, no spaces). With the demo setup that's the `API_KEY` in the root `.env`; in dev mode it's the one in `api/.env`. |
| `VITE_ACTOR` | Your name. It is sent with every change and shown in the audit history. |

**Step 3. Install and run.** From `flagforge/dashboard`:

```
npm install
```

```
npm run dev
```

**Step 4. Open http://localhost:5173.**

---

## 2. Commands

Run these inside `flagforge/dashboard`.

| Command | What it does |
|---|---|
| `npm install` | Installs React and Vite (once) |
| `npm run dev` | Starts the dashboard on port 5173 with instant reload when you edit code. Does **not** reload `.env`, so restart it after editing `.env`. |
| `npm run build` | Builds the production files into `dist/` |
| `npm run preview` | Serves the built `dist/` locally to check it |

---

## 3. User manual

### The screen

- **Top right:** a **live** dot and the environment dropdown. Green means the real-time stream is connected. Grey means offline.
- **Create bar:** make a new flag.
- **Flag cards:** one per flag, with its controls.
- **Audit history:** the latest 30 changes at the bottom.

### What you can do

| You want to | Do this |
|---|---|
| Switch environment | Pick `dev`, `staging` or `prod`. Each environment has its own separate flags. |
| Create a flag | Type a **flag-key** (letters, numbers, `-` and `_`, up to 64 characters) and an optional display name, then click **Create in dev**. New flags start **OFF** at 100% rollout. |
| Turn a flag on or off | Click the toggle on its card. It shows **ON** or **OFF**. |
| Set a rollout | Drag the **Rollout** slider and release. The blue fill shows the percentage. At 30%, a stable 30% of users get the feature, and the same user always gets the same answer. |
| Target specific users | Click **Rules (n)**, then fill in an attribute (for example `plan`), an operator, values separated by commas (for example `pro,enterprise`), and choose **serve on** or **serve off**. Click **Add rule**. |
| Remove a rule | Click **remove** next to it |
| Delete a flag | Click **Delete** and confirm |
| See who changed what | Read the **Audit history** panel: time, person, action, flag, version and the exact change |

### How targeting rules are applied

When your app asks whether a flag is on for a user, FlagForge checks in this order and stops at the first match:

1. Flag is **OFF** → off for everyone.
2. **Targeting rules**, lowest priority number first (shown as `#1`, `#2`, ...). New rules go to the end. The first matching rule decides.
3. **Rollout percentage** for everyone else.

Operators: `equals`, `in` (matches any listed value), `contains`.

### Live updates

The dashboard listens to the API's live stream. Open it in two tabs and toggle a flag in one: the other updates by itself within a moment. The same happens when someone changes a flag with curl or a script, and the change appears in the audit history.

---

## 4. How it works

```
 Browser (this app) ── REST calls with x-api-key + x-actor ──► API ──► Redis
          ▲                                                    │
          └──────────── live stream (SSE): "flag changed" ◄────┘
```

### Files

```
dashboard/
├── index.html           page shell
├── package.json
├── vite.config.js       Vite + React plugin, dev port 5173
├── .env                 your settings (never committed)
├── .env.example         template for .env
└── src/
    ├── main.jsx         mounts the app
    ├── api.js           every call to the API (list, create, update, delete, audit, stream URL)
    ├── App.jsx          the whole interface (environment switcher, create form, flag cards, rule editor, audit)
    └── styles.css       the neumorphism theme
```

### What happens when you click

1. A click (for example the toggle) calls `PATCH /flags/<key>` with only the changed field.
2. The API saves it and publishes a change message.
3. The dashboard receives a `flag` event from the stream and reloads the flag list and audit history. Other open dashboards do the same.

If a call fails (wrong key, validation error, API down), a red box at the top shows the API's message, for example `rolloutPercentage Number must be less than or equal to 100`.

---

## 5. Troubleshooting

| What you see | Cause and fix |
|---|---|
| Red box: `invalid or missing API key` | `VITE_API_KEY` doesn't match the API's `API_KEY`. Fix `dashboard/.env`, then stop (`Ctrl+C`) and restart `npm run dev`. |
| Red box: `Failed to fetch`, and the dot says **offline** | The API isn't running on `VITE_API_URL`. Start it and check `/health`. |
| The page is blank or `.env` changes are ignored | Vite reads `.env` only at startup. Restart `npm run dev`, then hard-refresh with `Ctrl+Shift+R`. |
| "No flags in dev yet" | Normal for a fresh database. Create one. The demo setup starts empty. |
| Red box: `too many requests` | A rate limit was hit. Wait a minute. |
| `Missing script: "dev"` | You're not inside `flagforge/dashboard`. |
| Dot is grey but the list works | The live stream is disconnected (a proxy, or the API restarted). The dashboard reconnects on its own. Reload to be sure. |

---

## 6. Deploying (optional)

```
npm run build
```

This creates `dist/`, a static site you can host anywhere. Note that `VITE_API_URL`, `VITE_API_KEY` and `VITE_ACTOR` are **baked into the build** at that moment. To change them, edit `.env` and build again.

---

## 7. Known limits

- **The admin key is visible in the browser.** Anything starting with `VITE_` is public in the built page. That's fine for a local demo, but a public deployment needs a login and a small backend that holds the key.
- Everyone using this dashboard acts as the same `VITE_ACTOR` name, so the audit history can't tell users apart.
- It shows the latest 30 audit entries only.
- Neumorphism uses soft shadows with low contrast. Check it on a projector before a demo.