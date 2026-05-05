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
    fetch("/api/analytics", { headers: { authorization: `Bearer ${token}` } })
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

          <AgentPerformance />
        </>
      )}
    </Layout>
  );
}

type AgentRow = {
  id: string; email: string; display_name: string;
  is_active: boolean; is_available: boolean;
  chats_handled: number; chats_closed: number; messages_sent: number;
  first_response_p50: number | null; first_response_p90: number | null;
  close_time_p50: number | null; reassigned_away: number;
  csat_count: number; csat_positive: number; csat_pct: number | null;
};

function fmtSec(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

function AgentPerformance() {
  const { token } = useAuth();
  const [days, setDays] = useState(7);
  const [data, setData] = useState<{ rows: AgentRow[]; since: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setData(null); setErr(null);
    fetch(`/api/analytics/agents?days=${days}`, { headers: { authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setData).catch((e) => setErr(String(e)));
  }, [token, days]);

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Agent performance</h3>
        <div style={{ flex: 1 }} />
        <label style={{ fontSize: 12, color: "#6b7280", marginRight: 6 }}>Range:</label>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>Today (24h)</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>
      {err && <div className="error">{err}</div>}
      {!data && !err && <div style={{ color: "#6b7280" }}>Loading…</div>}
      {data && data.rows.length === 0 && (
        <div style={{ color: "#6b7280" }}>No agents yet.</div>
      )}
      {data && data.rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ padding: "8px 6px" }}>Agent</th>
                <th style={{ padding: "8px 6px", textAlign: "right" }} title="Distinct chats assigned">Handled</th>
                <th style={{ padding: "8px 6px", textAlign: "right" }} title="Chats they were the last assignee on at close">Closed</th>
                <th style={{ padding: "8px 6px", textAlign: "right" }} title="Agent messages they wrote">Msgs</th>
                <th style={{ padding: "8px 6px", textAlign: "right" }} title="Median time from assignment → first reply">First-reply (p50)</th>
                <th style={{ padding: "8px 6px", textAlign: "right" }} title="p90 of the same — the slow tail">First-reply (p90)</th>
                <th style={{ padding: "8px 6px", textAlign: "right" }} title="Median time from assignment → conversation closed">Close (p50)</th>
                <th style={{ padding: "8px 6px", textAlign: "right" }} title="Chats taken from them by the idle-reassign loop">Reassigned away</th>
                <th style={{ padding: "8px 6px", textAlign: "right" }} title="Customer satisfaction — % thumbs-up out of all ratings received">CSAT</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid #f3f4f6", opacity: r.is_active ? 1 : 0.55 }}>
                  <td style={{ padding: "8px 6px" }}>
                    <div style={{ fontWeight: 600 }}>{r.display_name}</div>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>
                      {r.email}
                      {!r.is_active && <span style={{ color: "#dc2626" }}> · disabled</span>}
                      {r.is_active && r.is_available && <span style={{ color: "#059669" }}> · available</span>}
                    </div>
                  </td>
                  <td style={{ padding: "8px 6px", textAlign: "right", fontWeight: 600 }}>{r.chats_handled}</td>
                  <td style={{ padding: "8px 6px", textAlign: "right" }}>{r.chats_closed}</td>
                  <td style={{ padding: "8px 6px", textAlign: "right" }}>{r.messages_sent}</td>
                  <td style={{ padding: "8px 6px", textAlign: "right" }}>{fmtSec(r.first_response_p50)}</td>
                  <td style={{ padding: "8px 6px", textAlign: "right" }}>{fmtSec(r.first_response_p90)}</td>
                  <td style={{ padding: "8px 6px", textAlign: "right" }}>{fmtSec(r.close_time_p50)}</td>
                  <td style={{ padding: "8px 6px", textAlign: "right", color: r.reassigned_away ? "#dc2626" : "#374151" }}>{r.reassigned_away}</td>
                  <td style={{ padding: "8px 6px", textAlign: "right" }}>
                    {r.csat_count === 0 ? (
                      <span style={{ color: "#9ca3af" }}>—</span>
                    ) : (
                      <span style={{
                        color: r.csat_pct! >= 80 ? "#059669" : r.csat_pct! >= 50 ? "#d97706" : "#dc2626",
                        fontWeight: 600,
                      }}>
                        {r.csat_pct}%
                        <span style={{ color: "#9ca3af", fontWeight: 400, fontSize: 11, marginLeft: 4 }}>
                          ({r.csat_positive}/{r.csat_count})
                        </span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 8 }}>
            Hover the column headers for definitions. Range starts at {new Date(data.since).toLocaleString()}.
          </div>
        </div>
      )}
    </div>
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
