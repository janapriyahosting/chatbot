import { useEffect, useState } from "react";
import { Layout } from "../Layout";
import { api } from "../api";
import { useAuth } from "../store";

type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
const DAYS: Day[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABEL: Record<Day, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday",
  thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday",
};

type DaySchedule = { start: string; end: string };
type Schedule = Partial<Record<Day, DaySchedule>>;

export function Settings() {
  const role = useAuth((s) => s.user?.role);
  const canEdit = role === "admin";

  return (
    <Layout>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Settings</h2>
      </div>
      <WorkingHoursCard canEdit={canEdit} />
      {role === "admin" && <SmtpCard />}
      {role === "admin" && <O365Card />}
    </Layout>
  );
}

function WorkingHoursCard({ canEdit }: { canEdit: boolean }) {
  const [savedSchedule, setSavedSchedule] = useState<Schedule>({});
  const [draft, setDraft] = useState<Schedule>({});
  const [editing, setEditing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    api.getWorkingHours()
      .then((r) => { setSavedSchedule(r.schedule || {}); setLoaded(true); })
      .catch((e) => setErr(e.message));
  };
  useEffect(load, []);

  const startEdit = () => { setDraft(savedSchedule); setMsg(null); setErr(null); setEditing(true); };
  const cancel = () => { setEditing(false); setMsg(null); setErr(null); };

  const setDay = (d: Day, val: DaySchedule | null) => {
    setDraft((s) => {
      const next = { ...s };
      if (val) next[d] = val; else delete next[d];
      return next;
    });
  };
  const applyWeekdays = () => {
    const next: Schedule = { ...draft };
    (["mon", "tue", "wed", "thu", "fri"] as Day[]).forEach((d) => {
      next[d] = { start: "09:00", end: "18:00" };
    });
    delete next.sat; delete next.sun;
    setDraft(next);
  };
  const clearAll = () => setDraft({});

  const save = async () => {
    setBusy(true); setMsg(null); setErr(null);
    try {
      await api.putWorkingHours(draft);
      setSavedSchedule(draft);
      setEditing(false);
      setMsg("Saved.");
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Section
      title="Office working hours"
      subtitle="When the current time (Asia/Kolkata) is outside this window, no chat is auto-assigned. Visitors hitting the handoff node see the out-of-hours message and the chat queues for the next agent online."
      editing={editing}
      canEdit={canEdit}
      onEdit={startEdit}
    >
      {err && <div className="error" style={{ marginBottom: 8 }}>{err}</div>}
      {msg && <div style={{ background: "#d1fae5", color: "#065f46", padding: "6px 10px", borderRadius: 4, marginBottom: 8, fontSize: 12 }}>{msg}</div>}
      {!loaded ? (
        <div style={{ color: "#6b7280" }}>Loading…</div>
      ) : !editing ? (
        <ViewHours schedule={savedSchedule} />
      ) : (
        <>
          {DAYS.map((d) => {
            const v = draft[d];
            const on = !!v;
            return (
              <div key={d} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0", borderBottom: "1px solid #f3f4f6" }}>
                <label style={{ width: 130, fontSize: 14 }}>
                  <input type="checkbox" checked={on}
                    onChange={(e) => setDay(d, e.target.checked ? { start: "09:00", end: "18:00" } : null)} />{" "}
                  {DAY_LABEL[d]}
                </label>
                {on ? (
                  <>
                    <input type="time" value={v!.start}
                      onChange={(e) => setDay(d, { ...v!, start: e.target.value })} style={{ width: 130 }} />
                    <span style={{ color: "#6b7280" }}>to</span>
                    <input type="time" value={v!.end}
                      onChange={(e) => setDay(d, { ...v!, end: e.target.value })} style={{ width: 130 }} />
                  </>
                ) : <span style={{ color: "#9ca3af", fontSize: 13 }}>closed</span>}
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn ghost" onClick={applyWeekdays} disabled={busy}>Mon–Fri 9–18</button>
            <button className="btn ghost" onClick={clearAll} disabled={busy}>Always open (clear)</button>
            <div style={{ flex: 1 }} />
            <button className="btn ghost" onClick={cancel} disabled={busy}>Cancel</button>
            <button className="btn" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </>
      )}
    </Section>
  );
}

function ViewHours({ schedule }: { schedule: Schedule }) {
  const empty = Object.keys(schedule).length === 0;
  if (empty) return <div style={{ color: "#6b7280", fontSize: 13 }}>Always open (no schedule set).</div>;
  return (
    <div>
      {DAYS.map((d) => {
        const v = schedule[d];
        return (
          <div key={d} style={{ display: "flex", padding: "4px 0", borderBottom: "1px solid #f9fafb", fontSize: 13 }}>
            <div style={{ width: 130, color: "#374151" }}>{DAY_LABEL[d]}</div>
            <div style={{ color: v ? "#1f2937" : "#9ca3af" }}>
              {v ? `${v.start} – ${v.end}` : "closed"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Section({
  title, subtitle, children, editing, canEdit, onEdit,
}: {
  title: string; subtitle?: string; children: any;
  editing?: boolean; canEdit?: boolean; onEdit?: () => void;
}) {
  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: "flex", alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
          {subtitle && <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>{subtitle}</div>}
        </div>
        {!editing && canEdit && onEdit && (
          <button className="btn ghost" onClick={onEdit} style={{ flexShrink: 0 }}>Edit</button>
        )}
      </div>
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16, marginTop: 8 }}>
        {children}
      </div>
    </div>
  );
}

function SmtpCard() {
  const [cfg, setCfg] = useState<any>(null);
  const [draft, setDraft] = useState<any>({});
  const [pw, setPw] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => api.getSmtp().then(setCfg).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  if (!cfg) return null;

  const startEdit = () => { setDraft({ ...cfg }); setPw(""); setMsg(null); setErr(null); setEditing(true); };
  const cancel = () => { setEditing(false); setMsg(null); setErr(null); };
  const update = (k: string, v: any) => setDraft({ ...draft, [k]: v });

  const save = async () => {
    setBusy(true); setMsg(null); setErr(null);
    try {
      const body = {
        host: draft.host || "",
        port: Number(draft.port) || 587,
        username: draft.username || "",
        from_addr: draft.from_addr || "",
        use_tls: !!draft.use_tls,
        use_ssl: !!draft.use_ssl,
        password: pw || "",
      };
      await api.putSmtp(body);
      setMsg("Saved.");
      setEditing(false);
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const clearPw = async () => {
    if (!confirm("Clear the saved SMTP password?")) return;
    await api.putSmtp({ ...draft, password: "__clear__" });
    await load();
  };

  return (
    <Section
      title="Email (SMTP)"
      subtitle="Used for assignment notifications. Leave host blank to disable email entirely."
      editing={editing}
      canEdit
      onEdit={startEdit}
    >
      {err && <div className="error" style={{ marginBottom: 8 }}>{err}</div>}
      {msg && <div style={{ background: "#d1fae5", color: "#065f46", padding: "6px 10px", borderRadius: 4, marginBottom: 8, fontSize: 12 }}>{msg}</div>}
      {!editing ? (
        <KV rows={[
          ["Host",     cfg.host || <Empty>not set</Empty>],
          ["Port",     cfg.port || 587],
          ["Username", cfg.username || <Empty>not set</Empty>],
          ["From address", cfg.from_addr || <Empty>(uses username)</Empty>],
          ["Password", cfg.password_set ? <span style={{ color: "#059669" }}>● set</span> : <Empty>not set</Empty>],
          ["Encryption", cfg.use_ssl ? "Implicit TLS (465)" : cfg.use_tls ? "STARTTLS (587)" : "None"],
          ["Status", (cfg.host && cfg.username && cfg.password_set)
            ? <span style={{ color: "#059669" }}>Active</span>
            : <span style={{ color: "#dc2626" }}>Disabled (host/credentials missing)</span>],
        ]} />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label>Host</label>
              <input value={draft.host || ""} onChange={(e) => update("host", e.target.value)} placeholder="smtp.janapriyahomes.com" />
            </div>
            <div>
              <label>Port</label>
              <input type="number" value={draft.port || 587} onChange={(e) => update("port", e.target.value)} />
            </div>
            <div>
              <label>Username</label>
              <input value={draft.username || ""} onChange={(e) => update("username", e.target.value)} placeholder="alerts@janapriyahomes.com" />
            </div>
            <div>
              <label>From address</label>
              <input value={draft.from_addr || ""} onChange={(e) => update("from_addr", e.target.value)} placeholder="alerts@janapriyahomes.com" />
            </div>
            <div style={{ gridColumn: "1 / span 2" }}>
              <label>
                Password
                {cfg.password_set && <span style={{ marginLeft: 8, fontSize: 11, color: "#059669" }}>● set</span>}
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  placeholder={cfg.password_set ? "Leave blank to keep existing" : "Enter password"}
                  style={{ flex: 1 }}
                />
                {cfg.password_set && (
                  <button type="button" className="btn ghost" onClick={clearPw}>Clear</button>
                )}
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={!!draft.use_tls} onChange={(e) => update("use_tls", e.target.checked)} />
              STARTTLS (port 587)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={!!draft.use_ssl} onChange={(e) => update("use_ssl", e.target.checked)} />
              Implicit TLS / SSL (port 465)
            </label>
          </div>
          <div style={{ display: "flex", marginTop: 12 }}>
            <div style={{ flex: 1 }} />
            <button className="btn ghost" onClick={cancel} disabled={busy}>Cancel</button>
            <button className="btn" onClick={save} disabled={busy} style={{ marginLeft: 8 }}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      )}
    </Section>
  );
}

function O365Card() {
  const [cfg, setCfg] = useState<any>(null);
  const [draft, setDraft] = useState<any>({});
  const [secret, setSecret] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => api.getO365().then(setCfg).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  if (!cfg) return null;

  const startEdit = () => { setDraft({ ...cfg }); setSecret(""); setMsg(null); setErr(null); setEditing(true); };
  const cancel = () => { setEditing(false); setMsg(null); setErr(null); };
  const update = (k: string, v: any) => setDraft({ ...draft, [k]: v });

  const save = async () => {
    setBusy(true); setMsg(null); setErr(null);
    try {
      const body = {
        tenant_id: draft.tenant_id || "",
        client_id: draft.client_id || "",
        redirect_path: draft.redirect_path || "/auth/o365/callback",
        client_secret: secret || "",
      };
      await api.putO365(body);
      setMsg("Saved.");
      setEditing(false);
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const clearSecret = async () => {
    if (!confirm("Clear the saved client secret?")) return;
    await api.putO365({ ...draft, client_secret: "__clear__" });
    await load();
  };

  const fullRedirect = (window.location.origin || "https://chatbot.janapriyahomes.com")
    + (cfg.redirect_path || "/auth/o365/callback");

  return (
    <Section
      title="Microsoft 365 sign-in"
      subtitle="Strict allowlist — visitors must already be registered in /admin/users. Set up an Entra app at https://entra.microsoft.com → App registrations."
      editing={editing}
      canEdit
      onEdit={startEdit}
    >
      {err && <div className="error" style={{ marginBottom: 8 }}>{err}</div>}
      {msg && <div style={{ background: "#d1fae5", color: "#065f46", padding: "6px 10px", borderRadius: 4, marginBottom: 8, fontSize: 12 }}>{msg}</div>}
      {!editing ? (
        <KV rows={[
          ["Tenant ID", cfg.tenant_id || <Empty>not set</Empty>],
          ["Client ID", cfg.client_id || <Empty>not set</Empty>],
          ["Client secret", cfg.secret_set ? <span style={{ color: "#059669" }}>● set</span> : <Empty>not set</Empty>],
          ["Redirect URI", <code>{fullRedirect}</code>],
          ["Status", (cfg.tenant_id && cfg.client_id && cfg.secret_set)
            ? <span style={{ color: "#059669" }}>Active</span>
            : <span style={{ color: "#dc2626" }}>Disabled (credentials missing)</span>],
        ]} />
      ) : (
        <>
          <div style={{ display: "grid", gap: 8 }}>
            <div>
              <label>Tenant ID</label>
              <input value={draft.tenant_id || ""} onChange={(e) => update("tenant_id", e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
            </div>
            <div>
              <label>Client (application) ID</label>
              <input value={draft.client_id || ""} onChange={(e) => update("client_id", e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
            </div>
            <div>
              <label>
                Client secret
                {cfg.secret_set && <span style={{ marginLeft: 8, fontSize: 11, color: "#059669" }}>● set</span>}
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={cfg.secret_set ? "Leave blank to keep existing" : "Paste secret value"}
                  style={{ flex: 1 }}
                />
                {cfg.secret_set && (
                  <button type="button" className="btn ghost" onClick={clearSecret}>Clear</button>
                )}
              </div>
            </div>
            <div>
              <label>Redirect path</label>
              <input value={draft.redirect_path || "/auth/o365/callback"} onChange={(e) => update("redirect_path", e.target.value)} />
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                Full redirect URI to register in Entra:{" "}
                <code>{(window.location.origin || "https://chatbot.janapriyahomes.com") + (draft.redirect_path || "/auth/o365/callback")}</code>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", marginTop: 12 }}>
            <div style={{ flex: 1 }} />
            <button className="btn ghost" onClick={cancel} disabled={busy}>Cancel</button>
            <button className="btn" onClick={save} disabled={busy} style={{ marginLeft: 8 }}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      )}
    </Section>
  );
}

function KV({ rows }: { rows: [string, any][] }) {
  return (
    <div>
      {rows.map(([k, v], i) => (
        <div key={i} style={{ display: "flex", padding: "6px 0", borderBottom: i < rows.length - 1 ? "1px solid #f9fafb" : "none", fontSize: 13 }}>
          <div style={{ width: 160, color: "#6b7280" }}>{k}</div>
          <div style={{ flex: 1, color: "#1f2937", overflow: "hidden", textOverflow: "ellipsis" }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function Empty({ children }: { children: any }) {
  return <span style={{ color: "#9ca3af" }}>{children}</span>;
}
