import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { UploadButton } from "../flow/UploadButton";
import { Layout } from "../Layout";

type Bot = {
  id: string; name: string; channel: string; public_key: string;
  is_active: boolean; auto_assign: boolean;
  persona_name?: string | null; persona_avatar?: string | null;
  widget_footer_text?: string | null; theme_color?: string | null;
};

export function Bots() {
  const nav = useNavigate();
  const [bots, setBots] = useState<Bot[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [sites, setSites] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", channel: "web", site_id: "", newDomain: "" });
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    try {
      setBots(await api.listBots());
      setSites(await api.listSites());
    } catch (e: any) { setErr(e.message); }
  };

  useEffect(() => { reload(); }, []);

  const createBot = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      let siteId = form.site_id || undefined;
      if (form.newDomain) {
        const s = await api.createSite({ name: form.newDomain, domain: form.newDomain });
        siteId = s.id;
      }
      const bot = await api.createBot({ name: form.name, channel: form.channel, site_id: siteId });
      const flow = await api.createFlow(bot.id, {
        name: "Default flow",
        definition: {
          start_node: "start",
          nodes: [
            { id: "start", type: "start", config: {} },
            { id: "greet", type: "text", config: { body: "Hello! 👋" } },
            { id: "end", type: "end", config: {} },
          ],
          edges: [
            { source: "start", target: "greet" },
            { source: "greet", target: "end" },
          ],
        },
      });
      setShowNew(false);
      setForm({ name: "", channel: "web", site_id: "", newDomain: "" });
      nav(`/bots/${bot.id}/flows/${flow.id}`);
    } catch (e: any) {
      setErr(e.message);
    } finally { setBusy(false); }
  };

  return (
    <Layout>
      <div className="row" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Bots</h2>
        <div className="spacer" />
        <button className="btn" onClick={() => setShowNew(true)}>+ New bot</button>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="grid">
        {bots.map((b) => (
          <BotCard key={b.id} bot={b}
            onOpen={(flowId) => nav(`/bots/${b.id}/flows/${flowId}`)}
            onChanged={reload} />
        ))}
        {bots.length === 0 && <div className="card">No bots yet.</div>}
      </div>

      {showNew && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,.4)",
          display: "grid", placeItems: "center", zIndex: 100,
        }}>
          <form className="card" style={{ width: 420 }} onSubmit={createBot}>
            <h3 style={{ marginTop: 0 }}>New bot</h3>
            <label>Name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <label>Channel</label>
            <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
              <option value="web">Web</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="drip">Drip</option>
            </select>
            <label>Site (optional)</label>
            <select value={form.site_id} onChange={(e) => setForm({ ...form, site_id: e.target.value, newDomain: "" })}>
              <option value="">— none —</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.domain}</option>)}
            </select>
            <label>Or add a new site domain</label>
            <input placeholder="example.com" value={form.newDomain}
              onChange={(e) => setForm({ ...form, newDomain: e.target.value, site_id: "" })} />
            <div className="row" style={{ marginTop: 16 }}>
              <button type="button" className="btn ghost" onClick={() => setShowNew(false)}>Cancel</button>
              <div className="spacer" />
              <button className="btn" disabled={busy}>{busy ? "Creating…" : "Create"}</button>
            </div>
          </form>
        </div>
      )}
    </Layout>
  );
}

function BotCard({ bot, onOpen, onChanged }: { bot: Bot; onOpen: (flowId: string) => void; onChanged?: () => void }) {
  const [flows, setFlows] = useState<any[]>([]);
  const [auto, setAuto] = useState(bot.auto_assign);
  const [active, setActive] = useState(bot.is_active);
  const [editing, setEditing] = useState(false);
  const [personaName, setPersonaName] = useState(bot.persona_name || "");
  const [personaAvatar, setPersonaAvatar] = useState(bot.persona_avatar || "");
  const [footerText, setFooterText] = useState(bot.widget_footer_text || "");
  const [themeColor, setThemeColor] = useState(bot.theme_color || "");
  useEffect(() => { api.listFlows(bot.id).then(setFlows).catch(() => {}); }, [bot.id]);
  const flow = flows[0];

  const authHeader = () => ({
    "content-type": "application/json",
    authorization: `Bearer ${localStorage.getItem("cb_admin_token")}`,
  });
  const patch = async (body: any) => {
    await fetch(`/bots/${bot.id}`, { method: "PATCH", headers: authHeader(), body: JSON.stringify(body) });
  };
  const toggleAuto = async (v: boolean) => { setAuto(v); try { await patch({ auto_assign: v }); } catch {} };
  const toggleActive = async (v: boolean) => { setActive(v); try { await patch({ is_active: v }); } catch {} };
  const savePersona = async () => {
    await patch({
      persona_name: personaName || null,
      persona_avatar: personaAvatar || null,
      widget_footer_text: footerText || null,
      theme_color: themeColor || null,
    });
    setEditing(false);
  };
  const del = async () => {
    const ok = window.confirm(
      `Delete bot "${bot.name}"?\n\nThis permanently deletes its flow(s), all conversations, and all captured leads. Cannot be undone.`
    );
    if (!ok) return;
    const ok2 = window.confirm(`One more time — really delete "${bot.name}"?`);
    if (!ok2) return;
    const res = await fetch(`/bots/${bot.id}`, { method: "DELETE", headers: authHeader() });
    if (res.ok && onChanged) onChanged();
    else alert("Delete failed: " + res.status);
  };

  return (
    <div className="card" style={{ opacity: active ? 1 : 0.6 }}>
      <div className="row">
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {bot.persona_avatar && <img src={bot.persona_avatar} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />}
          <div>
            <div style={{ fontWeight: 600 }}>
              {bot.name}
              {!active && <span style={{ marginLeft: 8, fontSize: 11, color: "#dc2626", fontWeight: 500 }}>(inactive)</span>}
            </div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              {bot.channel} · key <code>{bot.public_key}</code>
              {bot.persona_name && <> · persona: <strong>{bot.persona_name}</strong></>}
            </div>
          </div>
        </div>
        <div className="spacer" />
        <label style={{ fontSize: 13 }}>
          <input type="checkbox" checked={active} onChange={(e) => toggleActive(e.target.checked)} /> active
        </label>
        <label style={{ fontSize: 13 }}>
          <input type="checkbox" checked={auto} onChange={(e) => toggleAuto(e.target.checked)} /> round-robin
        </label>
        <button className="btn ghost" onClick={() => setEditing((v) => !v)}>{editing ? "Close" : "Persona"}</button>
        {flow ? (
          <button className="btn" onClick={() => onOpen(flow.id)}>Edit flow</button>
        ) : <span style={{ fontSize: 12, color: "#6b7280" }}>no flow</span>}
        <button className="btn danger" onClick={del}>Delete</button>
      </div>
      {editing && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #f3f4f6" }}>
          <label>Persona name (shown in chat header)</label>
          <input value={personaName} onChange={(e) => setPersonaName(e.target.value)} placeholder="Asha" />
          <label>Avatar</label>
          <div className="row" style={{ gap: 14, alignItems: "center" }}>
            <div style={{
              width: 72, height: 72, borderRadius: "50%",
              border: "2px dashed #d1d5db", display: "grid", placeItems: "center",
              background: "#f9fafb", overflow: "hidden", flexShrink: 0,
            }}>
              {personaAvatar
                ? <img src={personaAvatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <span style={{ color: "#9ca3af", fontSize: 11 }}>no image</span>}
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <UploadButton accept="image/*" label="Choose image file"
                onUploaded={(url) => setPersonaAvatar(url)} />
              <div style={{ fontSize: 11, color: "#9ca3af" }}>or paste a URL:</div>
              <input value={personaAvatar}
                onChange={(e) => setPersonaAvatar(e.target.value)}
                placeholder="https://…/avatar.png" />
              {personaAvatar && (
                <button type="button" className="btn ghost"
                  style={{ padding: "2px 8px", fontSize: 11, alignSelf: "flex-start" }}
                  onClick={() => setPersonaAvatar("")}
                >Clear</button>
              )}
            </div>
          </div>
          <label style={{ marginTop: 12 }}>Footer text (shown at the bottom of the widget)</label>
          <input
            value={footerText}
            onChange={(e) => setFooterText(e.target.value)}
            placeholder="Powered by Janapriya Upscale"
            maxLength={120}
          />
          <label style={{ marginTop: 8 }}>Header color</label>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <input
              type="color"
              value={themeColor || "#2563eb"}
              onChange={(e) => setThemeColor(e.target.value)}
              style={{ width: 44, height: 32, padding: 0, border: "1px solid #d1d5db", borderRadius: 4 }}
            />
            <input
              value={themeColor}
              onChange={(e) => setThemeColor(e.target.value)}
              placeholder="#2563eb (leave blank for default)"
              style={{ flex: 1 }}
            />
            {themeColor && (
              <button type="button" className="btn ghost" style={{ padding: "2px 8px", fontSize: 11 }}
                onClick={() => setThemeColor("")}>Clear</button>
            )}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <div className="spacer" />
            <button className="btn" onClick={savePersona}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
