import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Layout } from "../Layout";
import { useAuth } from "../store";

type Conv = {
  id: string; status: string; visitor_id: string; last_body?: string | null;
  last_message_at?: string | null; assigned_to_name?: string | null;
};

export function Inbox() {
  const { user } = useAuth();
  const isSup = user?.role === "admin" || user?.role === "supervisor";
  const [scope, setScope] = useState<"mine" | "queue" | "all">(isSup ? "all" : "mine");
  const [convs, setConvs] = useState<Conv[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const msgEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (searching) return; // pause polling while search results are shown
    const tick = async () => {
      try { setConvs(await api.listConversations(scope)); } catch (e: any) { setErr(e.message); }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, [scope, searching]);

  const runSearch = async () => {
    const q = searchQ.trim();
    if (!q) { setSearching(false); return; }
    try {
      setSearching(true);
      setConvs(await api.searchConversations(q));
    } catch (e: any) { setErr(e.message); }
  };

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    const tick = async () => {
      try { setDetail(await api.getConversation(selected)); }
      catch (e: any) { setErr(e.message); }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [selected]);

  useEffect(() => { msgEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [detail?.messages?.length]);

  useEffect(() => {
    if (isSup) api.listUsers().then((us) => setAgents(us.filter((u: any) => u.role === "agent"))).catch(() => {});
  }, [isSup]);

  const send = async () => {
    if (!selected || !text.trim()) return;
    try {
      await api.postAgentMessage(selected, text);
      setText("");
      setDetail(await api.getConversation(selected));
    } catch (e: any) { setErr(e.message); }
  };

  const close = async () => {
    if (!selected) return;
    await api.closeConversation(selected);
    setDetail(await api.getConversation(selected));
  };

  const assign = async (userId: string | null) => {
    if (!selected) return;
    try {
      await api.assignConversation(selected, userId);
      setDetail(await api.getConversation(selected));
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <Layout wide>
      <div style={{ display: "flex", height: "100vh" }}>
        <div style={{ width: 340, borderRight: "1px solid #e5e7eb", background: "#fff", display: "flex", flexDirection: "column" }}>
          <div className="row" style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>
            <select value={scope} onChange={(e) => { setScope(e.target.value as any); setSearching(false); setSearchQ(""); }}>
              <option value="mine">My conversations</option>
              {isSup && <option value="queue">Queue</option>}
              {isSup && <option value="all">All active</option>}
            </select>
          </div>
          {isSup && (
            <div className="row" style={{ padding: 8, borderBottom: "1px solid #e5e7eb", gap: 4 }}>
              <input
                placeholder="Search phone / email / message"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
              />
              <button className="btn ghost" style={{ padding: "6px 8px" }} onClick={runSearch}>Search</button>
              {searching && (
                <button className="btn ghost" style={{ padding: "6px 8px" }} onClick={() => { setSearching(false); setSearchQ(""); }}>✕</button>
              )}
            </div>
          )}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {convs.length === 0 && <div style={{ padding: 16, color: "#6b7280", fontSize: 13 }}>Nothing here.</div>}
            {convs.map((c) => (
              <div key={c.id} onClick={() => setSelected(c.id)}
                style={{
                  padding: 12, borderBottom: "1px solid #f3f4f6", cursor: "pointer",
                  background: selected === c.id ? "#eff6ff" : "transparent",
                }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  visitor {c.visitor_id.slice(0, 10)}…
                  <span style={{ marginLeft: 6, fontSize: 11, color: c.status === "queued" ? "#dc2626" : "#059669" }}>
                    · {c.status}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  {c.last_body ? c.last_body.slice(0, 60) : "(no messages)"}
                </div>
                {c.assigned_to_name && <div style={{ fontSize: 11, color: "#6b7280" }}>→ {c.assigned_to_name}</div>}
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {!detail ? (
            <div style={{ margin: "auto", color: "#6b7280" }}>Select a conversation.</div>
          ) : (
            <>
              <div className="row" style={{ padding: 10, borderBottom: "1px solid #e5e7eb", background: "#fff" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>visitor {detail.visitor_id}</div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    status: {detail.status}{detail.assigned_to_name ? ` · ${detail.assigned_to_name}` : ""}
                  </div>
                </div>
                <div className="spacer" />
                {isSup && detail.status === "queued" && (
                  <select onChange={(e) => { if (e.target.value) assign(e.target.value); }} defaultValue="">
                    <option value="">Assign to…</option>
                    <option value="__rr__" onClick={() => assign(null)}>round-robin</option>
                    {agents.filter((a) => a.is_active).map((a) => (
                      <option key={a.id} value={a.id}>{a.display_name}</option>
                    ))}
                  </select>
                )}
                {detail.status === "assigned" && <button className="btn danger" onClick={close}>Close</button>}
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: 12, background: "#f9fafb" }}>
                {detail.messages.map((m: any) => (
                  <Bubble key={m.id} m={m} />
                ))}
                <div ref={msgEnd} />
              </div>

              {detail.status === "assigned" && detail.assigned_user_id === useAuth.getState().user?.email ? null : null}
              {(detail.status === "assigned" || detail.status === "queued") && (
                <div className="row" style={{ padding: 10, borderTop: "1px solid #e5e7eb", background: "#fff" }}>
                  <input placeholder="Type a reply…" value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && send()} />
                  <button className="btn" onClick={send}>Send</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {err && <div style={{ position: "fixed", bottom: 10, right: 10 }} className="error">{err}</div>}
    </Layout>
  );
}

function Bubble({ m }: { m: any }) {
  const side =
    m.sender === "visitor" ? "flex-start" :
    m.sender === "system" ? "center" :
    "flex-end";
  const bg =
    m.sender === "visitor" ? "#fff" :
    m.sender === "system" ? "transparent" :
    m.sender === "agent" ? "#2563eb" : "#e5e7eb";
  const color = m.sender === "agent" ? "#fff" : "#111827";
  const content = m.body || JSON.stringify(m.payload?.config || m.payload);
  return (
    <div style={{ display: "flex", justifyContent: side, margin: "6px 0" }}>
      <div style={{
        maxWidth: "70%", padding: "8px 12px", borderRadius: 14,
        background: bg, color,
        border: m.sender === "visitor" ? "1px solid #e5e7eb" : "none",
        fontSize: m.sender === "system" ? 11 : 14,
        fontStyle: m.sender === "system" ? "italic" : "normal",
        whiteSpace: "pre-wrap",
      }}>
        {content}
      </div>
    </div>
  );
}
