import { useEffect, useState } from "react";
import { Layout } from "../Layout";
import { useAuth } from "../store";

type Key = {
  id: string; name: string; prefix: string;
  created_at: string; last_used_at: string | null; revoked_at: string | null;
};

export function ApiKeys() {
  const { token, user } = useAuth();
  const [keys, setKeys] = useState<Key[]>([]);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ key: string; name: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const isAdmin = user?.role === "admin";
  const authH = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  const reload = async () => {
    try {
      const r = await fetch("/api-keys", { headers: authH });
      if (!r.ok) throw new Error(r.statusText);
      setKeys(await r.json());
    } catch (e: any) { setErr(String(e)); }
  };
  useEffect(() => { if (isAdmin) reload(); }, [isAdmin]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const r = await fetch("/api-keys", { method: "POST", headers: authH, body: JSON.stringify({ name }) });
    if (!r.ok) { setErr("create failed"); return; }
    const j = await r.json();
    setCreated({ key: j.key, name: j.name });
    setName("");
    reload();
  };

  const revoke = async (id: string) => {
    if (!confirm("Revoke this API key? Services using it will stop working immediately.")) return;
    await fetch(`/api-keys/${id}/revoke`, { method: "POST", headers: authH });
    reload();
  };

  if (!isAdmin) {
    return <Layout><div className="card">Admin only.</div></Layout>;
  }

  return (
    <Layout>
      <h2 style={{ marginTop: 0 }}>API keys</h2>
      <p style={{ color: "#6b7280", marginTop: 0 }}>
        Use API keys to call the ChatBot API from servers, scripts, or external systems.
        Pass as <code>X-API-Key: ck_live_…</code>. Keys inherit the creator's permissions.
      </p>

      <form className="card" onSubmit={create} style={{ marginBottom: 16 }}>
        <label>Key name (for your reference)</label>
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Chat360 webhook integration" required />
          <button className="btn">Create key</button>
        </div>
      </form>

      {created && (
        <div className="card" style={{ marginBottom: 16, background: "#fffbeb", borderColor: "#fde68a" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>New key: {created.name}</div>
          <div style={{ fontSize: 12, color: "#92400e", marginBottom: 8 }}>
            Copy it now — this is the only time we show the full key.
          </div>
          <code style={{ display: "block", padding: 10, background: "#fff", border: "1px solid #fde68a", wordBreak: "break-all" }}>
            {created.key}
          </code>
          <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => { navigator.clipboard.writeText(created.key); }}>
            Copy
          </button>
          <button className="btn ghost" style={{ marginTop: 8, marginLeft: 8 }} onClick={() => setCreated(null)}>
            I have saved it
          </button>
        </div>
      )}

      {err && <div className="error">{err}</div>}

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f3f4f6", textAlign: "left" }}>
              {["Name", "Prefix", "Created", "Last used", "Status", ""].map((c) => (
                <th key={c} style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "8px 10px" }}>{k.name}</td>
                <td style={{ padding: "8px 10px", fontFamily: "ui-monospace" }}>{k.prefix}…</td>
                <td style={{ padding: "8px 10px" }}>{new Date(k.created_at).toLocaleDateString()}</td>
                <td style={{ padding: "8px 10px" }}>{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "—"}</td>
                <td style={{ padding: "8px 10px" }}>
                  {k.revoked_at ? <span style={{ color: "#dc2626" }}>Revoked</span> : <span style={{ color: "#059669" }}>Active</span>}
                </td>
                <td style={{ padding: "8px 10px", textAlign: "right" }}>
                  {!k.revoked_at && <button className="btn danger" style={{ padding: "4px 8px" }} onClick={() => revoke(k.id)}>Revoke</button>}
                </td>
              </tr>
            ))}
            {keys.length === 0 && <tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: "#6b7280" }}>No API keys yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
