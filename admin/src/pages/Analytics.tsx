import { useEffect, useState } from "react";
import { Layout } from "../Layout";
import { useAuth } from "../store";

type Data = {
  conversations: { total: number; last_24h: number; last_7d: number; last_30d: number };
  leads: { total: number; last_7d: number; verified: number; verified_pct: number };
  messages_by_sender_30d: Record<string, number>;
  top_utm_sources_30d: { source: string; count: number }[];
  conversations_per_day_14d: { day: string; count: number }[];
  agents: { total: number; available: number };
};

export function Analytics() {
  const { token } = useAuth();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/analytics", { headers: { authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setD).catch((e) => setErr(String(e)));
  }, [token]);

  return (
    <Layout>
      <h2 style={{ marginTop: 0 }}>Analytics</h2>
      {err && <div className="error">{err}</div>}
      {!d && !err && <div>Loading…</div>}
      {d && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
            <Tile label="Conversations (total)" value={d.conversations.total} sub={`${d.conversations.last_7d} in last 7 days`} />
            <Tile label="Conversations (24h)" value={d.conversations.last_24h} />
            <Tile label="Leads (total)" value={d.leads.total} sub={`${d.leads.last_7d} in last 7 days`} />
            <Tile label="Phone verified" value={`${d.leads.verified_pct}%`} sub={`${d.leads.verified} of ${d.leads.total}`} />
            <Tile label="Active agents" value={d.agents.total} sub={`${d.agents.available} available`} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Conversations per day (last 14)</h3>
              <BarChart data={d.conversations_per_day_14d.map((r) => ({ label: r.day.slice(5), value: r.count }))} />
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Top UTM sources (30d)</h3>
              {d.top_utm_sources_30d.length === 0 && <div style={{ color: "#6b7280" }}>No UTM data yet.</div>}
              <BarChart data={d.top_utm_sources_30d.map((r) => ({ label: r.source, value: r.count }))} />
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Messages by sender (30d)</h3>
            <BarChart data={Object.entries(d.messages_by_sender_30d).map(([k, v]) => ({ label: k, value: v }))} />
          </div>
        </>
      )}
    </Layout>
  );
}

function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card">
      <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function BarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {data.map((d) => (
        <div key={d.label} style={{ display: "grid", gridTemplateColumns: "90px 1fr 40px", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 12, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</div>
          <div style={{ height: 14, background: "#eef2ff", borderRadius: 4, position: "relative" }}>
            <div style={{ width: `${(d.value / max) * 100}%`, height: "100%", background: "#2563eb", borderRadius: 4 }} />
          </div>
          <div style={{ fontSize: 12, textAlign: "right", color: "#374151" }}>{d.value}</div>
        </div>
      ))}
      {data.length === 0 && <div style={{ color: "#6b7280" }}>No data.</div>}
    </div>
  );
}
