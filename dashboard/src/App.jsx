import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";

const ENVS = ["dev", "staging", "prod"];

function RuleEditor({ flag, onSave }) {
  const [attribute, setAttribute] = useState("plan");
  const [operator, setOperator] = useState("in");
  const [values, setValues] = useState("pro,enterprise");
  const [serve, setServe] = useState("true");

  const add = () => {
    const rule = {
      id: "r" + Date.now().toString(36),
      attribute: attribute.trim(),
      operator,
      values: values.split(",").map((v) => v.trim()).filter(Boolean),
      serve: serve === "true",
      priority: flag.targetingRules.length + 1,
    };
    onSave([...flag.targetingRules, rule]);
  };
  const remove = (id) => onSave(flag.targetingRules.filter((r) => r.id !== id));

  return (
    <div className="rules">
      <h4>Targeting rules (checked before the rollout, lowest priority first)</h4>
      {flag.targetingRules.length === 0 && <p className="muted">No rules.</p>}
      {[...flag.targetingRules].sort((a, b) => a.priority - b.priority).map((r) => (
        <div className="rule" key={r.id}>
          <span>
            #{r.priority} if <b>{r.attribute}</b> {r.operator} [{r.values.join(", ")}] → <b>{String(r.serve)}</b>
          </span>
          <button className="link" onClick={() => remove(r.id)}>remove</button>
        </div>
      ))}
      <div className="rule-form">
        <input value={attribute} onChange={(e) => setAttribute(e.target.value)} placeholder="attribute" />
        <select value={operator} onChange={(e) => setOperator(e.target.value)}>
          <option value="equals">equals</option>
          <option value="in">in</option>
          <option value="contains">contains</option>
        </select>
        <input value={values} onChange={(e) => setValues(e.target.value)} placeholder="values, comma separated" />
        <select value={serve} onChange={(e) => setServe(e.target.value)}>
          <option value="true">serve on</option>
          <option value="false">serve off</option>
        </select>
        <button onClick={add}>Add rule</button>
      </div>
    </div>
  );
}

function FlagCard({ flag, onChange, onDelete }) {
  const [pct, setPct] = useState(flag.rolloutPercentage);
  const [open, setOpen] = useState(false);
  useEffect(() => setPct(flag.rolloutPercentage), [flag.rolloutPercentage, flag.version]);

  return (
    <div className="card">
      <div className="row">
        <div>
          <b>{flag.key}</b> <span className="muted">v{flag.version}</span>
          <div className="muted">{flag.name}</div>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={flag.enabled}
            onChange={(e) => onChange(flag, { enabled: e.target.checked })}
          />
          <span>{flag.enabled ? "ON" : "OFF"}</span>
        </label>
      </div>

      <div className="row">
        <label className="grow">
          Rollout: <b>{pct}%</b>
          <input
            type="range"
            min="0"
            max="100"
            value={pct}
            style={{ "--p": pct / 100 }}
            onChange={(e) => setPct(Number(e.target.value))}
            onPointerUp={() => pct !== flag.rolloutPercentage && onChange(flag, { rolloutPercentage: pct })}
            onKeyUp={() => pct !== flag.rolloutPercentage && onChange(flag, { rolloutPercentage: pct })}
          />
        </label>
        <button onClick={() => setOpen(!open)}>{open ? "Hide rules" : `Rules (${flag.targetingRules.length})`}</button>
        <button className="danger" onClick={() => onDelete(flag)}>Delete</button>
      </div>

      {open && <RuleEditor flag={flag} onSave={(rules) => onChange(flag, { targetingRules: rules })} />}
    </div>
  );
}

function CreateForm({ env, onCreate }) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");

  const submit = (e) => {
    e.preventDefault();
    onCreate({ key: key.trim(), name: name.trim() || key.trim(), environment: env, enabled: false, rolloutPercentage: 100 });
    setKey("");
    setName("");
  };

  return (
    <form className="card row" onSubmit={submit}>
      <input required value={key} onChange={(e) => setKey(e.target.value)} placeholder="flag-key" />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" />
      <button type="submit">Create in {env}</button>
    </form>
  );
}

export default function App() {
  const [env, setEnv] = useState("dev");
  const [flags, setFlags] = useState([]);
  const [audit, setAudit] = useState([]);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);

  const load = useCallback(async () => {
    try {
      const [f, a] = await Promise.all([api.listFlags(env), api.audit(env)]);
      setFlags(f);
      setAudit(a);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, [env]);

  useEffect(() => {
    load();
  }, [load]);

  // refresh whenever any client (this dashboard, another tab, curl) changes a flag
  useEffect(() => {
    const es = new EventSource(api.streamUrl(env));
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.addEventListener("flag", load);
    return () => es.close();
  }, [env, load]);

  const run = async (fn) => {
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="page">
      <header className="row">
        <h1>FlagForge</h1>
        <div className="row">
          <span className={live ? "dot live" : "dot"} /> {live ? "live" : "offline"}
          <select value={env} onChange={(e) => setEnv(e.target.value)}>
            {ENVS.map((e) => <option key={e}>{e}</option>)}
          </select>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <CreateForm env={env} onCreate={(body) => run(() => api.createFlag(body))} />

      {flags.length === 0 && <p className="muted">No flags in {env} yet.</p>}
      {flags.map((f) => (
        <FlagCard
          key={f.key}
          flag={f}
          onChange={(flag, changes) => run(() => api.updateFlag(env, flag.key, changes))}
          onDelete={(flag) => window.confirm(`Delete ${flag.key}?`) && run(() => api.deleteFlag(env, flag.key))}
        />
      ))}

      <h2>Audit history</h2>
      <div className="card">
        {audit.length === 0 && <p className="muted">No changes yet.</p>}
        {audit.map((a, i) => (
          <div className="audit" key={i}>
            <span className="muted">{new Date(a.ts).toLocaleTimeString()}</span>
            <span><b>{a.actor}</b> {a.action} <b>{a.key}</b> (v{a.version})</span>
            {a.changes && <code>{JSON.stringify(a.changes)}</code>}
          </div>
        ))}
      </div>
    </div>
  );
}