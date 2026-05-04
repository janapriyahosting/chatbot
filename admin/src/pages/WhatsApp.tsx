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
        WhatsApp delivery is powered by Chat360. Create a bot with channel <code>whatsapp</code>,
        author your flow like any other bot, and point Chat360's inbound webhook here.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Inbound webhook URL</h3>
        <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>
          Paste this into Chat360 → Settings → Webhooks. We currently accept
          the default Chat360 inbound JSON shape.
        </div>
        <code style={{ display: "block", padding: 10, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 4 }}>
          {webhookUrl}
        </code>
        <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => navigator.clipboard.writeText(webhookUrl)}>
          Copy
        </button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Chat360 credentials</h3>
        <p style={{ fontSize: 13, color: "#6b7280" }}>
          Set <code>CHAT360_API_KEY</code>, <code>CHAT360_FROM</code>, and
          <code>CHAT360_WEBHOOK_SECRET</code> in your backend <code>.env</code>
          and restart. Runtime per-bot credential storage is on the roadmap.
        </p>
      </div>

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
