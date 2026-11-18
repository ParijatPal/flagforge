# FlagForge Dashboard: User Manual

How to use every part of the dashboard. For installing and starting it, see [README.md](README.md).

Open the dashboard at **http://localhost:5173**.

---

## 1. The screen at a glance

```
┌───────────────────────────────────────────────────────────┐
│ FlagForge                               ● live   [ dev ▾ ] │  ← header
├───────────────────────────────────────────────────────────┤
│ (red message box appears here when something goes wrong)   │
├───────────────────────────────────────────────────────────┤
│ [ flag-key ]  [ Display name ]        [ Create in dev ]    │  ← create bar
├───────────────────────────────────────────────────────────┤
│ new-checkout  v8                                  (●) ON   │
│ New checkout flow                                          │  ← flag card
│ Rollout: 100%                                              │
│ ════════════════●        [ Rules (0) ]  [ Delete ]         │
├───────────────────────────────────────────────────────────┤
│ Audit history                                              │
│ 9:42:03 AM  parijat updated new-checkout (v8) {"enabled"…} │  ← history
└───────────────────────────────────────────────────────────┘
```

---

## 2. Header

### Live indicator

| What you see | Meaning |
|---|---|
| Green glowing dot and **live** | The dashboard is connected to the real-time stream. Changes made anywhere appear on screen by themselves. |
| Grey dot and **offline** | The stream is disconnected (the API stopped or restarted). The dashboard reconnects automatically. Reload the page if it stays grey. |

### Environment dropdown (`dev` / `staging` / `prod`)

- Picks which environment you are looking at and editing.
- Each environment has its **own separate flags and its own audit history**. A flag in `dev` does not exist in `prod` until you create it there.
- Switching reloads the flag list and the history, and connects to that environment's live stream.
- The create button always names the current environment, for example **Create in prod**. Check it before you click.

---

## 3. Create bar

Creates a new flag in the **currently selected environment**.

| Field / button | What it does |
|---|---|
| **flag-key** (required) | The flag's permanent ID. Your app uses this exact text to ask about the flag. Use letters, numbers, `-` and `_` only (no spaces), up to 64 characters. Example: `new-checkout`. It **cannot be changed later**. |
| **Display name** (optional) | A friendly label shown under the key. If left empty, the key is used. |
| **Create in dev** | Creates the flag. |

A new flag always starts **OFF** with a **100%** rollout and no rules. Nothing changes for your users until you turn it ON.

What can go wrong (shown in the red box):

| Message | Fix |
|---|---|
| `flag already exists in this environment` | Pick another key, or use the existing flag |
| `validation failed: key letters, numbers, - and _ only` | Remove spaces and special characters |

The input boxes clear when you click create. If an error appears, type the key again.

---

## 4. Flag cards

Each flag has one card.

### Header of the card

- **Key** in bold, for example `new-checkout`.
- **v8** is the flag's version. It goes up by 1 every time the flag changes. It is useful for checking that a change was received.
- The **display name** appears below the key.

### ON / OFF toggle (top right of the card)

- Click it to turn the flag on or off. It saves **immediately**, with no save button.
- **OFF overrides everything.** An OFF flag is off for every user, including users who match a targeting rule and users inside the rollout percentage.
- **ON** means the flag follows its rules and rollout (see section 6).

### Rollout slider

- Controls what share of users get the feature, from 0% to 100%.
- Drag the handle. The blue fill and the **Rollout: 40%** label update as you move.
- The change is saved when you **release** the handle (or when you release a key, if you use the arrow keys). Releasing at the same value saves nothing.
- It is a *stable* percentage: a user who is in at 30% stays in when you raise it to 50%. Raising the percentage never switches anyone off.

| Rollout | Effect (flag ON, no matching rule) |
|---|---|
| 0% | Nobody gets it |
| 25% | A stable quarter of users get it |
| 100% | Everyone gets it |

Percentage rollouts need the app to send a `userId`. Without one, the flag's default answer (off) is used.

### Rules button

- Shows **Rules (n)** where *n* is the number of rules. Click to open the rule editor (section 5). Click **Hide rules** to close it.

### Delete button

- Asks "Delete *key*?" Click OK to confirm.
- Deleting is **permanent**. Apps connected to the live stream stop seeing the flag immediately, and the deletion appears in the audit history.
- To get it back you must create it again with the same key. Its rules and history of values are not restored.

---

## 5. Targeting rules

Rules let you decide per user, for example "everyone on the pro plan always gets this". They are checked **before** the rollout percentage.

Click **Rules (n)** on a flag card.

### Existing rules

Each rule is shown as one line:

```
#1 if plan in [pro, enterprise] → true                     remove
```

Read it as: "Rule number 1: if the user's `plan` is one of `pro` or `enterprise`, serve **true** (on)."

- `#1`, `#2` ... is the **priority**. Lower numbers are checked first, and the first rule that matches decides.
- **remove** deletes the rule and saves immediately.

### Adding a rule

| Field | What to enter |
|---|---|
| attribute | The name of the user detail your app sends, for example `plan`, `country`, `email`, `beta` |
| operator | **equals**: the attribute equals the value. **in**: the attribute is any one of the listed values. **contains**: the attribute text contains the value. |
| values | One or more values, separated by commas, for example `pro,enterprise`. Spaces around commas are ignored. |
| serve on / serve off | What to answer when the rule matches: **on** gives the feature, **off** blocks it |

Click **Add rule**. The rule is saved immediately and added at the end with the next priority number.

The fields start with the example `plan` / `in` / `pro,enterprise` / `serve on`. Change them to what you need.

### Examples

| Goal | attribute | operator | values | serve |
|---|---|---|---|---|
| Paying customers always get it | `plan` | in | `pro,enterprise` | on |
| Block one country | `country` | equals | `IN` | off |
| Internal testers | `email` | contains | `@mycompany.com` | on |
| Beta group | `beta` | equals | `true` | on |

### Good to know

- Your app must send the same attribute names (for example `plan`) when it checks the flag, or the rule can't match.
- Removing a rule does not renumber the others. Rules are shown in priority order.
- A rule only matters while the flag is **ON**.

---

## 6. How the final answer is decided

For each user, FlagForge goes through these steps and stops at the first one that applies:

1. Flag is **OFF** → **off** for everyone.
2. Rules, lowest priority number first. The first rule that matches the user decides.
3. The **rollout percentage** decides for everyone else.
4. If the app didn't send a `userId` on a percentage rollout → the flag's default answer (**off**) is used.

---

## 7. Audit history

The panel at the bottom lists the **latest 30 changes** in the selected environment, newest first.

```
9:42:03 AM   parijat updated new-checkout (v8)   {"enabled":true}
```

| Part | Meaning |
|---|---|
| Time | When the change happened (your local time) |
| Name in bold | Who made it. For this dashboard it is the `VITE_ACTOR` name from `dashboard/.env`. Changes from curl or scripts without an `x-actor` header show as `unknown`. |
| Action | `created`, `updated` or `deleted` |
| Flag and version | Which flag, and the version it became |
| Grey code | Exactly what was changed, for example `{"enabled":true}` or `{"rolloutPercentage":40}` |

The history updates by itself whenever anything changes, including changes made by other people or scripts.

---

## 8. The red message box

When something fails, a red box appears at the top with the reason. It disappears by itself the next time the dashboard loads successfully.

| Message | Meaning and fix |
|---|---|
| `invalid or missing API key` | The key in `dashboard/.env` is wrong. Fix it and restart `npm run dev`. |
| `Failed to fetch` | The API isn't running or can't be reached. |
| `flag already exists in this environment` | You tried to create a key that is already used. |
| `validation failed: ...` | An input is not allowed, and the message says which one. |
| `too many requests` | Rate limit reached. Wait a minute. |
| `flag not found` | Someone deleted the flag. The list refreshes by itself. |

---

## 9. Real-time behaviour

- You never need to press refresh. When any person, script or tab changes a flag, your dashboard updates within a moment.
- Open the dashboard in two browser tabs: toggle a flag in one and watch the other follow.
- The same live stream is what updates your apps' SDKs, so what you see is what they receive.

---

## 10. Common tasks

### Release a feature gradually

1. Create the flag (starts OFF).
2. Turn it **ON** and set the slider to **5%**. A small group gets it.
3. Watch for problems, then raise it to **25%**, **50%**, **100%**.
4. When it's fully out and stable, delete the flag and remove the check from your code.

### Emergency kill switch

Click the toggle to **OFF**. Every app stops using the feature within moments.

### Let specific people try it first

1. Turn the flag **ON** and set the rollout to **0%**.
2. Add a rule, for example `email contains @mycompany.com` → serve on.
3. Only matching users get it. Later, raise the rollout to open it up.

### Use the same flag in several environments

There is no copy button. Switch the dropdown to the other environment, create a flag with the **same key**, then set it up again. Test in `dev`, then repeat in `staging` and `prod`.

### Find out who changed something

Open **Audit history**, find the flag's name, and read the name in bold and the grey changes.

---

## 11. Things to keep in mind

- **Changes are live.** Toggling or changing a rollout takes effect for real users within moments. In `prod`, double-check the environment dropdown first.
- **There is no undo.** To go back, change the value again (the history shows the previous values).
- **The dashboard doesn't edit** the flag key, the description, or the default answer for users without a `userId`. The key is permanent.
- **Everyone who uses this dashboard** appears under the same actor name, so the audit history can't tell them apart.
- The admin key is stored in the browser app, so this dashboard should only be used locally or on a trusted network. See [README.md](README.md#7-known-limits).

---

## 12. Glossary

| Term | Meaning |
|---|---|
| **Flag** | An on/off switch for a feature, identified by a key |
| **Environment** | A separate set of flags: `dev`, `staging` or `prod` |
| **Rollout** | The percentage of users who get a feature |
| **Targeting rule** | A condition like "plan is pro" that decides for matching users |
| **Priority** | The order rules are checked in. Lower numbers go first. |
| **Version** | A counter that goes up by 1 on every change to a flag |
| **Audit history** | The log of who changed what, and when |
| **SDK** | The library your app uses to check flags and receive live updates |
| **Stream / live** | The real-time connection that pushes changes instantly |