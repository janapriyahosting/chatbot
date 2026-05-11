import { useEffect, useState } from "react";
import { api } from "../api";
import { Layout } from "../Layout";
import { useAuth } from "../store";

type Lead = {
  id: string;
  created_at: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  phone_verified: boolean;
  bot_id: string;
  conversation_id: string | null;
  fields: Record<string, string>;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  gclid: string | null;
  referrer: string | null;
  landing_url: string | null;
};

export function Leads() {
  const { token } = useAuth();
  const [bots, setBots] = useState<any[]>([]);
  const [botId, setBotId] = useState<string>("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.listBots().then(setBots).catch(() => {}); }, []);
  useEffect(() => {
    const q = botId ? `?bot_id=${botId}` : "";
    fetch(`/api/leads${q}`, { headers: { authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : Promise.reject("fetch failed"))
      .then(setLeads)
      .catch((e) => setErr(String(e)));
  }, [botId, token]);

  const downloadCsv = async () => {
    const q = botId ? `?bot_id=${botId}` : "";
    const res = await fetch(`/api/leads.csv${q}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) { setErr("download failed"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = botId ? `leads-${botId}.csv` : "leads.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Layout>
      <div className="row" style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>Leads</h2>
          <div className="spacer" />
          <select value={botId} onChange={(e) => setBotId(e.target.value)}>
            <option value="">All bots</option>
            {bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button className="btn" onClick={downloadCsv}>Download CSV</button>
        </div>
        {err && <div className="error">{err}</div>}
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f3f4f6", textAlign: "left" }}>
                {["When", "Name", "Phone", "Email", "OTP", "Details", "UTM source", "Campaign", "gclid"].map((c) => (
                  <th key={c} style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "8px 10px" }}>{new Date(l.created_at).toLocaleString()}</td>
                  <td style={{ padding: "8px 10px" }}>{l.name || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{l.phone || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{l.email || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{l.phone_verified ? "✓" : "—"}</td>
                  <td style={{ padding: "8px 10px", fontSize: 12 }}>
                    {(() => {
                      const core = new Set(["name", "phone", "email"]);
                      const entries = Object.entries(l.fields || {}).filter(([k, v]) => !core.has(k) && v != null && String(v).length > 0);
                      if (entries.length === 0) return "—";
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          {entries.map(([k, v]) => (
                            <div key={k}><span style={{ color: "#6b7280" }}>{k}:</span> <span style={{ fontWeight: 500 }}>{String(v)}</span></div>
                          ))}
                        </div>
                      );
                    })()}
                  </td>
                  <td style={{ padding: "8px 10px" }}>{l.utm_source || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{l.utm_campaign || "—"}</td>
                  <td style={{ padding: "8px 10px", fontFamily: "ui-monospace", fontSize: 11 }}>{l.gclid || "—"}</td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr><td colSpan={9} style={{ padding: 20, textAlign: "center", color: "#6b7280" }}>No leads yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
    </Layout>
  );
}
