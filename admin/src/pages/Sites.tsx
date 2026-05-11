import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Layout } from "../Layout";
import { useAuth } from "../store";

type Site = {
  id: string;
  name: string;
  domain: string;
  allowed_origins: string[];
  created_at: string;
};

type Bot = { id: string; name: string; site_id?: string | null };

// Exact origin = scheme + "://" + host + optional ":port". No path, no trailing slash.
const ORIGIN_RE = /^https?:\/\/[A-Za-z0-9.-]+(?::\d+)?$/;

function defaultOriginsFor(domain: string): string[] {
  const d = domain.trim();
  if (!d) return [];
  return [`https://${d}`, `http://${d}`];
}

export function Sites() {
  const role = useAuth((s) => s.user?.role);
  const canEdit = role === "admin" || role === "supervisor";

  const [sites, setSites] = useState<Site[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const reload = async () => {
    try {
      const [s, b] = await Promise.all([api.listSites(), api.listBots()]);
      setSites(s);
      setBots(b);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const botsBySite = useMemo(() => {
    const m: Record<string, Bot[]> = {};
    for (const b of bots) {
      if (!b.site_id) continue;
      (m[b.site_id] ||= []).push(b);
    }
    return m;
  }, [bots]);

  return (
    <Layout>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>Sites</h2>
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            Each site is a host the widget runs on. The <code>allowed_origins</code> list is
            checked against the browser's <code>Origin</code> header on every widget API call —
            requests from anywhere else are rejected.
          </div>
          <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
            New sites are created from the Bots page when you add a bot.
          </div>
        </div>
      </div>

      {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}

      <div className="grid">
        {sites.length === 0 && <div className="card">No sites yet.</div>}
        {sites.map((s) => (
          <SiteCard
            key={s.id}
            site={s}
            bots={botsBySite[s.id] || []}
            canEdit={canEdit}
            onChanged={reload}
          />
        ))}
      </div>
    </Layout>
  );
}

function SiteCard({
  site, bots, canEdit, onChanged,
}: {
  site: Site;
  bots: Bot[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(site.name);
  const [domain, setDomain] = useState(site.domain);
  const [origins, setOrigins] = useState<string[]>(site.allowed_origins || []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset draft state whenever we re-enter edit mode so cancel really cancels.
  const startEdit = () => {
    setName(site.name);
    setDomain(site.domain);
    setOrigins([...(site.allowed_origins || [])]);
    setErr(null);
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setErr(null);
  };

  const invalidIdx = origins
    .map((o, i) => (o.trim() && !ORIGIN_RE.test(o.trim()) ? i : -1))
    .filter((i) => i >= 0);
  const hasBlanks = origins.some((o) => !o.trim());

  const save = async () => {
    setErr(null);
    if (!domain.trim()) { setErr("domain is required"); return; }
    const cleaned = origins.map((o) => o.trim()).filter(Boolean);
    const bad = cleaned.filter((o) => !ORIGIN_RE.test(o));
    if (bad.length) {
      setErr(`invalid origin(s): ${bad.join(", ")}. Use scheme + host (no path, no trailing slash).`);
      return;
    }
    setBusy(true);
    try {
      await api.updateSite(site.id, {
        name: name.trim(),
        domain: domain.trim(),
        allowed_origins: cleaned,
      });
      setEditing(false);
      onChanged();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const addOrigin = () => setOrigins([...origins, ""]);
  const updateOrigin = (i: number, v: string) => setOrigins(origins.map((o, j) => (j === i ? v : o)));
  const removeOrigin = (i: number) => setOrigins(origins.filter((_, j) => j !== i));
  const resetToDomain = () => setOrigins(defaultOriginsFor(domain));

  return (
    <div className="card">
      <div className="row">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{site.name}</div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            domain <code>{site.domain}</code>
            {" · "}
            {bots.length === 0
              ? <span style={{ color: "#9ca3af" }}>no bots</span>
              : <>used by {bots.length} bot{bots.length === 1 ? "" : "s"}: {bots.map((b) => b.name).join(", ")}</>}
          </div>
        </div>
        <div className="spacer" />
        {canEdit && (
          <button className="btn ghost" onClick={editing ? cancel : startEdit}>
            {editing ? "Close" : "Edit"}
          </button>
        )}
      </div>

      {!editing && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Allowed origins</div>
          {site.allowed_origins.length === 0 ? (
            <div style={{ fontSize: 13, color: "#dc2626" }}>
              ⚠ empty list — widget requests with any Origin header will be rejected.
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {site.allowed_origins.map((o) => (
                <code key={o} style={{
                  background: "#f3f4f6", padding: "2px 8px", borderRadius: 4, fontSize: 12,
                }}>{o}</code>
              ))}
            </div>
          )}
        </div>
      )}

      {editing && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #f3f4f6" }}>
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
          <label>Domain</label>
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />

          <div style={{ display: "flex", alignItems: "center", marginTop: 12 }}>
            <label style={{ margin: 0 }}>Allowed origins</label>
            <div style={{ flex: 1 }} />
            <button type="button" className="btn ghost" style={{ padding: "2px 8px", fontSize: 11 }}
              onClick={resetToDomain}>
              Reset to https/http of domain
            </button>
          </div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
            Exact match against the browser's <code>Origin</code> header. Format:
            {" "}<code>https://host</code> or <code>http://host:port</code>. No path, no trailing slash.
            Empty list = block all cross-origin widget calls for this site.
          </div>

          {origins.map((o, i) => {
            const isInvalid = o.trim() && !ORIGIN_RE.test(o.trim());
            return (
              <div key={i} className="row" style={{ marginTop: 6, gap: 6 }}>
                <input
                  value={o}
                  onChange={(e) => updateOrigin(i, e.target.value)}
                  placeholder="https://www.example.com"
                  style={{
                    flex: 1,
                    borderColor: isInvalid ? "#dc2626" : undefined,
                  }}
                />
                <button className="btn danger" style={{ padding: "4px 8px" }}
                  onClick={() => removeOrigin(i)}>×</button>
              </div>
            );
          })}
          <button className="btn ghost" style={{ marginTop: 8 }} onClick={addOrigin}>
            + origin
          </button>

          {invalidIdx.length > 0 && (
            <div style={{ fontSize: 12, color: "#dc2626", marginTop: 6 }}>
              {invalidIdx.length} invalid origin{invalidIdx.length === 1 ? "" : "s"} (highlighted).
            </div>
          )}
          {hasBlanks && (
            <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
              Blank rows are dropped on save.
            </div>
          )}

          {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}

          <div className="row" style={{ marginTop: 12 }}>
            <div className="spacer" />
            <button className="btn ghost" onClick={cancel} disabled={busy}>Cancel</button>
            <button className="btn" onClick={save} disabled={busy || invalidIdx.length > 0}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
