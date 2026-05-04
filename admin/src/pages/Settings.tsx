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

  const [schedule, setSchedule] = useState<Schedule>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.getWorkingHours()
      .then((r) => { setSchedule(r.schedule || {}); setLoaded(true); })
      .catch((e) => setErr(e.message));
  }, []);

  const setDay = (d: Day, val: DaySchedule | null) => {
    setSchedule((s) => {
      const next = { ...s };
      if (val) next[d] = val; else delete next[d];
      return next;
    });
  };

  const save = async () => {
    setBusy(true); setMsg(null); setErr(null);
    try {
      await api.putWorkingHours(schedule);
      setMsg("Saved.");
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const applyWeekdays = () => {
    const next: Schedule = { ...schedule };
    (["mon", "tue", "wed", "thu", "fri"] as Day[]).forEach((d) => {
      next[d] = { start: "09:00", end: "18:00" };
    });
    delete next.sat; delete next.sun;
    setSchedule(next);
  };

  const clearAll = () => setSchedule({});

  return (
    <Layout>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Office working hours</h2>
        <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
          When the current time (Asia/Kolkata) is outside this window, no chat
          is auto-assigned. Visitors hitting the handoff node see the
          out-of-hours message configured on that node and the chat queues for
          the next agent online.
        </div>
      </div>
      {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}
      {msg && <div style={{ background: "#d1fae5", color: "#065f46", padding: "8px 12px", borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{msg}</div>}

      {!loaded ? (
        <div style={{ color: "#6b7280" }}>Loading…</div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
          {DAYS.map((d) => {
            const v = schedule[d];
            const on = !!v;
            return (
              <div key={d} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
                <label style={{ width: 130, fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!canEdit}
                    onChange={(e) => setDay(d, e.target.checked ? { start: "09:00", end: "18:00" } : null)}
                  />{" "}
                  {DAY_LABEL[d]}
                </label>
                {on ? (
                  <>
                    <input
                      type="time"
                      value={v!.start}
                      disabled={!canEdit}
                      onChange={(e) => setDay(d, { ...v!, start: e.target.value })}
                      style={{ width: 130 }}
                    />
                    <span style={{ color: "#6b7280" }}>to</span>
                    <input
                      type="time"
                      value={v!.end}
                      disabled={!canEdit}
                      onChange={(e) => setDay(d, { ...v!, end: e.target.value })}
                      style={{ width: 130 }}
                    />
                  </>
                ) : (
                  <span style={{ color: "#9ca3af", fontSize: 13 }}>closed</span>
                )}
              </div>
            );
          })}
          {canEdit && (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn ghost" onClick={applyWeekdays} disabled={busy}>
                Mon–Fri 9–18
              </button>
              <button className="btn ghost" onClick={clearAll} disabled={busy}>
                Always open (clear)
              </button>
              <div style={{ flex: 1 }} />
              <button className="btn" onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </div>
      )}

      {role === "admin" && <SmtpCard />}
      {role === "admin" && <O365Card />}
    </Layout>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: any }) {
  return (
    <div style={{ marginTop: 28 }}>
      <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
      {subtitle && <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>{subtitle}</div>}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16, marginTop: 8 }}>
        {children}
      </div>
    </div>
  );
}

function SmtpCard() {
  const [cfg, setCfg] = useState<any>(null);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.getSmtp().then(setCfg).catch((e) => setErr(e.message)); }, []);

  if (!cfg) return null;

  const update = (k: string, v: any) => setCfg({ ...cfg, [k]: v });

  const save = async () => {
    setBusy(true); setMsg(null); setErr(null);
    try {
      const body = {
        host: cfg.host || "",
        port: Number(cfg.port) || 587,
        username: cfg.username || "",
        from_addr: cfg.from_addr || "",
        use_tls: !!cfg.use_tls,
        use_ssl: !!cfg.use_ssl,
        password: pw || "",  // empty means "keep existing"
      };
      await api.putSmtp(body);
      setMsg("Saved.");
      setPw("");
      api.getSmtp().then(setCfg);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const clearPw = async () => {
    if (!confirm("Clear the saved SMTP password?")) return;
    await api.putSmtp({ ...cfg, password: "__clear__" });
    api.getSmtp().then(setCfg);
  };

  return (
    <Section
      title="Email (SMTP)"
      subtitle="Used for assignment notifications. Leave host blank to disable email entirely."
    >
      {err && <div className="error" style={{ marginBottom: 8 }}>{err}</div>}
      {msg && <div style={{ background: "#d1fae5", color: "#065f46", padding: "6px 10px", borderRadius: 4, marginBottom: 8, fontSize: 12 }}>{msg}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label>Host</label>
          <input value={cfg.host || ""} onChange={(e) => update("host", e.target.value)} placeholder="smtp.janapriyahomes.com" />
        </div>
        <div>
          <label>Port</label>
          <input type="number" value={cfg.port || 587} onChange={(e) => update("port", e.target.value)} />
        </div>
        <div>
          <label>Username</label>
          <input value={cfg.username || ""} onChange={(e) => update("username", e.target.value)} placeholder="alerts@janapriyahomes.com" />
        </div>
        <div>
          <label>From address</label>
          <input value={cfg.from_addr || ""} onChange={(e) => update("from_addr", e.target.value)} placeholder="alerts@janapriyahomes.com" />
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
          <input type="checkbox" checked={!!cfg.use_tls} onChange={(e) => update("use_tls", e.target.checked)} />
          STARTTLS (port 587)
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={!!cfg.use_ssl} onChange={(e) => update("use_ssl", e.target.checked)} />
          Implicit TLS / SSL (port 465)
        </label>
      </div>
      <div style={{ display: "flex", marginTop: 12 }}>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </Section>
  );
}

function O365Card() {
  const [cfg, setCfg] = useState<any>(null);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.getO365().then(setCfg).catch((e) => setErr(e.message)); }, []);

  if (!cfg) return null;

  const update = (k: string, v: any) => setCfg({ ...cfg, [k]: v });

  const save = async () => {
    setBusy(true); setMsg(null); setErr(null);
    try {
      const body = {
        tenant_id: cfg.tenant_id || "",
        client_id: cfg.client_id || "",
        redirect_path: cfg.redirect_path || "/auth/o365/callback",
        client_secret: secret || "",
      };
      await api.putO365(body);
      setMsg("Saved.");
      setSecret("");
      api.getO365().then(setCfg);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const clearSecret = async () => {
    if (!confirm("Clear the saved client secret?")) return;
    await api.putO365({ ...cfg, client_secret: "__clear__" });
    api.getO365().then(setCfg);
  };

  return (
    <Section
      title="Microsoft 365 sign-in"
      subtitle={
        "Strict allowlist — visitors must already be registered in /admin/users. " +
        "Set up an Entra app at https://entra.microsoft.com → App registrations."
      }
    >
      {err && <div className="error" style={{ marginBottom: 8 }}>{err}</div>}
      {msg && <div style={{ background: "#d1fae5", color: "#065f46", padding: "6px 10px", borderRadius: 4, marginBottom: 8, fontSize: 12 }}>{msg}</div>}
      <div style={{ display: "grid", gap: 8 }}>
        <div>
          <label>Tenant ID</label>
          <input value={cfg.tenant_id || ""} onChange={(e) => update("tenant_id", e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
        </div>
        <div>
          <label>Client (application) ID</label>
          <input value={cfg.client_id || ""} onChange={(e) => update("client_id", e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
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
          <input value={cfg.redirect_path || "/auth/o365/callback"} onChange={(e) => update("redirect_path", e.target.value)} />
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
            Full redirect URI to register in Entra:
            {" "}<code>{(window.location.origin || "https://chatbot.janapriyahomes.com") + (cfg.redirect_path || "/auth/o365/callback")}</code>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", marginTop: 12 }}>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </Section>
  );
}
