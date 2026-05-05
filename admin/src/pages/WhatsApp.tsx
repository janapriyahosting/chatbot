import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Layout } from "../Layout";

export function WhatsApp() {
  const [bots, setBots] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.listBots()
      .then((bs) => setBots(bs.filter((b: any) => b.channel === "whatsapp")))
      .catch((e) => setErr(e.message));
  }, []);

  const webhookUrl = `${window.location.origin}/webhook/whatsapp`;

  return (
    <Layout>
      <h2 style={{ marginTop: 0 }}>WhatsApp</h2>
      <p style={{ color: "#6b7280", marginTop: 0 }}>
        Create a bot with channel <code>whatsapp</code>, author your flow like any other bot,
        and point your WhatsApp provider's inbound webhook here.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Inbound webhook URL</h3>
        <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>
          Paste this into your WhatsApp provider's webhook settings. We currently accept
          a generic inbound JSON shape with common keys (<code>from</code>, <code>text.body</code>, etc.).
        </div>
        <code style={{ display: "block", padding: 10, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 4 }}>
          {webhookUrl}
        </code>
        <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => navigator.clipboard.writeText(webhookUrl)}>
          Copy
        </button>
      </div>

      <CredentialsCard />

      <h3>WhatsApp bots</h3>
      {err && <div className="error">{err}</div>}
      {bots.length === 0 && (
        <div className="card">
          No WhatsApp bots yet. Go to <Link to="/admin">Bots</Link> → <strong>+ New bot</strong>,
          pick channel <strong>WhatsApp</strong>.
        </div>
      )}
      <div className="grid">
        {bots.map((b) => (
          <div key={b.id} className="card">
            <div className="row">
              <div>
                <div style={{ fontWeight: 600 }}>{b.name}</div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  key <code>{b.public_key}</code>
                </div>
              </div>
              <div className="spacer" />
              <Link to="/admin" className="btn ghost">Manage</Link>
            </div>
          </div>
        ))}
      </div>
    </Layout>
  );
}

function CredentialsCard() {
  const [cfg, setCfg] = useState<any>(null);
  const [draft, setDraft] = useState<any>({});
  const [apiKey, setApiKey] = useState("");
  const [secret, setSecret] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => api.getWhatsApp().then(setCfg).catch((e: any) => setErr(e.message));
  useEffect(() => { load(); }, []);

  if (!cfg) return null;

  const startEdit = () => {
    setDraft({ ...cfg });
    setApiKey("");
    setSecret("");
    setMsg(null); setErr(null);
    setEditing(true);
  };
  const cancel = () => { setEditing(false); setMsg(null); setErr(null); };
  const update = (k: string, v: any) => setDraft({ ...draft, [k]: v });

  const save = async () => {
    setBusy(true); setMsg(null); setErr(null);
    try {
      await api.putWhatsApp({
        api_key: apiKey || "",
        from_number: draft.from_number || "",
        webhook_secret: secret || "",
        session_message_url: draft.session_message_url || "",
      });
      setMsg("Saved.");
      setEditing(false);
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const clearApiKey = async () => {
    if (!confirm("Clear the saved API key?")) return;
    await api.putWhatsApp({
      api_key: "__clear__",
      from_number: cfg.from_number || "",
      webhook_secret: "",
      session_message_url: cfg.session_message_url || "",
    });
    await load();
  };

  const clearSecret = async () => {
    if (!confirm("Clear the saved webhook secret?")) return;
    await api.putWhatsApp({
      api_key: "",
      from_number: cfg.from_number || "",
      webhook_secret: "__clear__",
      session_message_url: cfg.session_message_url || "",
    });
    await load();
  };

  const active = cfg.api_key_set && cfg.from_number && cfg.session_message_url;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>WhatsApp provider credentials</h3>
        <div style={{ flex: 1 }} />
        {!editing && (
          <button className="btn ghost" onClick={startEdit}>Edit</button>
        )}
      </div>
      <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>
        Stored values take precedence over backend <code>.env</code>. Changes apply
        on the next inbound message — no restart needed.
      </p>

      {err && <div className="error" style={{ marginBottom: 8 }}>{err}</div>}
      {msg && (
        <div style={{ background: "#d1fae5", color: "#065f46", padding: "6px 10px", borderRadius: 4, marginBottom: 8, fontSize: 12 }}>
          {msg}
        </div>
      )}

      {!editing ? (
        <div style={{ fontSize: 13 }}>
          <Row label="API key">
            {cfg.api_key_set
              ? <span style={{ color: "#059669" }}>● set</span>
              : <span style={{ color: "#9ca3af" }}>not set</span>}
          </Row>
          <Row label="From">{cfg.from_number || <span style={{ color: "#9ca3af" }}>not set</span>}</Row>
          <Row label="Webhook secret">
            {cfg.webhook_secret_set
              ? <span style={{ color: "#059669" }}>● set</span>
              : <span style={{ color: "#9ca3af" }}>not set (open webhook)</span>}
          </Row>
          <Row label="Session URL">
            {cfg.session_message_url
              ? <code style={{ fontSize: 12 }}>{cfg.session_message_url}</code>
              : <span style={{ color: "#9ca3af" }}>not set</span>}
          </Row>
          <Row label="Status">
            {active
              ? <span style={{ color: "#059669" }}>Active</span>
              : <span style={{ color: "#dc2626" }}>Disabled (missing api key, from, or URL)</span>}
          </Row>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ gridColumn: "1 / span 2" }}>
            <label>
              API key
              {cfg.api_key_set && <span style={{ marginLeft: 8, fontSize: 11, color: "#059669" }}>● set</span>}
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={cfg.api_key_set ? "Leave blank to keep existing" : "Enter API key"}
                style={{ flex: 1 }}
              />
              {cfg.api_key_set && (
                <button type="button" className="btn ghost" onClick={clearApiKey}>Clear</button>
              )}
            </div>
          </div>
          <div>
            <label>From (sender phone)</label>
            <input
              value={draft.from_number || ""}
              onChange={(e) => update("from_number", e.target.value)}
              placeholder="e.g. 919999999999"
            />
          </div>
          <div>
            <label>
              Webhook secret
              {cfg.webhook_secret_set && <span style={{ marginLeft: 8, fontSize: 11, color: "#059669" }}>● set</span>}
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={cfg.webhook_secret_set ? "Leave blank to keep existing" : "Optional"}
                style={{ flex: 1 }}
              />
              {cfg.webhook_secret_set && (
                <button type="button" className="btn ghost" onClick={clearSecret}>Clear</button>
              )}
            </div>
          </div>
          <div style={{ gridColumn: "1 / span 2" }}>
            <label>Session message URL</label>
            <input
              value={draft.session_message_url || ""}
              onChange={(e) => update("session_message_url", e.target.value)}
              placeholder="https://provider.example.com/api/whatsapp/session-messages"
            />
          </div>
          <div style={{ gridColumn: "1 / span 2", display: "flex", marginTop: 4 }}>
            <div style={{ flex: 1 }} />
            <button className="btn ghost" onClick={cancel} disabled={busy}>Cancel</button>
            <button className="btn" onClick={save} disabled={busy} style={{ marginLeft: 8 }}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", padding: "4px 0", borderBottom: "1px solid #f3f4f6" }}>
      <div style={{ width: 140, color: "#6b7280" }}>{label}</div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}
