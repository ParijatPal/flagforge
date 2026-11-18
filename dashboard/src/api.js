const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const KEY = import.meta.env.VITE_API_KEY || "";
const ACTOR = import.meta.env.VITE_ACTOR || "dashboard";

async function call(method, path, body) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-api-key": KEY, "x-actor": ACTOR },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const issues = data.issues ? ": " + data.issues.map((i) => `${i.path} ${i.message}`).join(", ") : "";
    throw new Error((data.error || `HTTP ${res.status}`) + issues);
  }
  return data;
}

const flagPath = (env, key) => `/flags/${encodeURIComponent(key)}?env=${env}`;

export const api = {
  listFlags: (env) => call("GET", `/flags?env=${env}`).then((d) => d.flags),
  createFlag: (body) => call("POST", "/flags", body),
  updateFlag: (env, key, changes) => call("PATCH", flagPath(env, key), changes),
  deleteFlag: (env, key) => call("DELETE", flagPath(env, key)),
  audit: (env) => call("GET", `/audit?env=${env}&limit=30`).then((d) => d.entries),
  streamUrl: (env) => `${BASE}/api/v1/stream?env=${env}`,
};