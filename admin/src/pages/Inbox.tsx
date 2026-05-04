import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Layout } from "../Layout";
import { useAuth } from "../store";
import { EmojiPicker } from "../components/EmojiPicker";
import { TemplatePicker } from "../components/TemplatePicker";
import { PolishMenu } from "../components/PolishMenu";

type Conv = {
  id: string; status: string; visitor_id: string; last_body?: string | null;
  last_message_at?: string | null; assigned_to_name?: string | null;
  created_at?: string; closed_at?: string | null;
};

function fmtDateTime(s?: string | null): string {
  if (!s) return "";
  try { return new Date(s).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
  catch { return s; }
}

function relativeTime(s?: string | null): string {
  if (!s) return "";
  const t = new Date(s).getTime();
  if (isNaN(t)) return "";
  const diff = (Date.now() - t) / 1000;
  if (diff < 45) return "just now";
  if (diff < 60 * 60) return `${Math.round(diff / 60)} min ago`;
  if (diff < 60 * 60 * 24) return `${Math.round(diff / 3600)} hr ago`;
  // Older than 24h: show the time on that calendar day
  return new Date(t).toLocaleString([], { hour: "numeric", minute: "2-digit" });
}

const MS_DAY = 24 * 60 * 60 * 1000;
function bucketOf(s?: string | null): string {
  if (!s) return "Older";
  const t = new Date(s).getTime();
  if (isNaN(t)) return "Older";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t >= startOfToday) return "Today";
  if (t >= startOfToday - MS_DAY) return "Yesterday";
  if (t >= startOfToday - 7 * MS_DAY) return "Last 7 days";
  return "Older";
}
const BUCKET_ORDER = ["Today", "Yesterday", "Last 7 days", "Older"];

export function Inbox() {
  const { user } = useAuth();
  const isSup = user?.role === "admin" || user?.role === "supervisor";
  const [scope, setScope] = useState<"mine" | "queue" | "all" | "closed">(isSup ? "all" : "mine");
  const [counts, setCounts] = useState<Record<string, number>>({});
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
      try {
        const [list, cs] = await Promise.all([
          api.listConversations(scope),
          api.conversationCounts(),
        ]);
        setConvs(list);
        setCounts(cs);
      } catch (e: any) { setErr(e.message); }
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const onAttach = async (file: File) => {
    if (!selected) return;
    setUploading(true);
    try {
      const up = await api.uploadFile(file);
      const isImage = /^image\//i.test(file.type);
      await api.postAgentAttachment(selected, {
        url: up.url,
        kind: isImage ? "image" : "document",
        filename: up.filename || file.name,
        caption: text.trim() || undefined,
      });
      setText("");
      setDetail(await api.getConversation(selected));
    } catch (e: any) { setErr(e.message); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const [polishing, setPolishing] = useState(false);
  const polish = async (tone: string) => {
    if (!text.trim() || polishing) return;
    setPolishing(true);
    try {
      const r = await api.polishMessage(text, tone);
      if (r?.text) setText(r.text);
    } catch (e: any) { setErr(e.message); }
    finally { setPolishing(false); }
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
          <div style={{ display: "flex", padding: 6, borderBottom: "1px solid #e5e7eb", gap: 4, fontSize: 12 }}>
            {([
              ["mine", "Mine"],
              ...(isSup ? [["queue", "Queue"], ["all", "All live"]] as const : []),
              ["closed", "Closed"],
            ] as const).map(([key, label]) => (
              <button key={key}
                onClick={() => { setScope(key as any); setSearching(false); setSearchQ(""); }}
                style={{
                  flex: 1, padding: "6px 4px", border: "none", borderRadius: 4,
                  background: scope === key ? "#2563eb" : "transparent",
                  color: scope === key ? "#fff" : "#374151",
                  fontWeight: scope === key ? 600 : 400, cursor: "pointer",
                }}>
                {label} <span style={{ opacity: 0.7 }}>({counts[key] ?? 0})</span>
              </button>
            ))}
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
            {(() => {
              const groups: Record<string, Conv[]> = {};
              const stampOf = (c: Conv) =>
                scope === "closed" ? c.closed_at : (c.last_message_at || c.created_at);
              for (const c of convs) {
                const b = bucketOf(stampOf(c));
                (groups[b] ||= []).push(c);
              }
              return BUCKET_ORDER.filter((b) => groups[b]?.length).map((b) => (
                <div key={b}>
                  <div style={{
                    padding: "8px 12px", fontSize: 11, fontWeight: 600,
                    color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4,
                    background: "#f9fafb", borderBottom: "1px solid #f3f4f6",
                  }}>
                    {b}
                  </div>
                  {groups[b].map((c) => {
                    const stamp = stampOf(c);
                    return (
                      <div key={c.id} onClick={() => setSelected(c.id)}
                        style={{
                          padding: 12, borderBottom: "1px solid #f3f4f6", cursor: "pointer",
                          background: selected === c.id ? "#eff6ff" : "transparent",
                        }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            visitor {c.visitor_id.slice(0, 10)}…
                          </div>
                          <span style={{ fontSize: 10, color: "#9ca3af", flexShrink: 0 }}>
                            {relativeTime(stamp)}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: c.status === "queued" ? "#dc2626" : c.status === "closed" ? "#6b7280" : "#059669" }}>
                          {c.status}
                        </div>
                        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                          {c.last_body ? c.last_body.slice(0, 60) : "(no messages)"}
                        </div>
                        {c.assigned_to_name && <div style={{ fontSize: 11, color: "#6b7280" }}>→ {c.assigned_to_name}</div>}
                      </div>
                    );
                  })}
                </div>
              ));
            })()}
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
                  <div style={{ fontSize: 12, color: "#4b5563", marginTop: 4 }}>
                    🕐 started <strong>{fmtDateTime(detail.created_at)}</strong>
                    {detail.closed_at && <>{" "}· ended <strong>{fmtDateTime(detail.closed_at)}</strong></>}
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
                  <TemplatePicker onPick={(t) => setText(t)} />
                  <EmojiPicker onPick={(e) => setText((t) => t + e)} />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                    style={{ display: "none" }}
                    onChange={(e) => e.target.files?.[0] && onAttach(e.target.files[0])}
                  />
                  <button
                    type="button"
                    className="btn ghost"
                    title="Attach a file"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    style={{ padding: "6px 10px", fontSize: 14 }}
                  >
                    {uploading ? "…" : "📎"}
                  </button>
                  <input placeholder="Type a reply…" value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && send()} />
                  <PolishMenu
                    disabled={!text.trim()}
                    busy={polishing}
                    onPolish={polish}
                  />
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
  const p = m.payload || {};
  const url = p.url || p.config?.url;
  let inner: any;
  if (m.kind === "image" && url) {
    inner = (
      <>
        <img src={url} alt="" style={{ maxWidth: 220, borderRadius: 8, display: "block" }} />
        {(p.caption || m.body) && <div style={{ marginTop: 4 }}>{p.caption || m.body}</div>}
      </>
    );
  } else if (m.kind === "document" && url) {
    const filename = p.filename || p.original_filename || (m.body || "Document");
    inner = (
      <a href={url} target="_blank" rel="noopener" style={{ color, textDecoration: "underline" }}>
        📄 {filename}
      </a>
    );
  } else {
    inner = m.body || JSON.stringify(p?.config || p);
  }
  const stamp = m.created_at;
  return (
    <div style={{ display: "flex", justifyContent: side, margin: "6px 0", flexDirection: "column",
                  alignItems: side === "flex-end" ? "flex-end" : side === "flex-start" ? "flex-start" : "center" }}>
      <div style={{
        maxWidth: "70%", padding: "8px 12px", borderRadius: 14,
        background: bg, color,
        border: m.sender === "visitor" ? "1px solid #e5e7eb" : "none",
        fontSize: m.sender === "system" ? 11 : 14,
        fontStyle: m.sender === "system" ? "italic" : "normal",
        whiteSpace: "pre-wrap",
      }}>
        {inner}
      </div>
      {stamp && m.sender !== "system" && (
        <div style={{ fontSize: 10, color: "#9ca3af", margin: "2px 4px 0" }}>
          {new Date(stamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </div>
      )}
    </div>
  );
}
