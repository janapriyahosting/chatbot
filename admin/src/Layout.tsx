import type { ReactNode } from "react";
import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./store";

const NAV: { to: string; label: string; icon: string; supervisorOnly?: boolean }[] = [
  { to: "/inbox", label: "Live chats", icon: "💬" },
  { to: "/", label: "Bots", icon: "🤖", supervisorOnly: true },
  { to: "/whatsapp", label: "WhatsApp", icon: "🟢", supervisorOnly: true },
  { to: "/leads", label: "Leads", icon: "👥", supervisorOnly: true },
  { to: "/analytics", label: "Analytics", icon: "📈", supervisorOnly: true },
  { to: "/users", label: "Users", icon: "🧑‍💼", supervisorOnly: true },
  { to: "/api-keys", label: "API keys", icon: "🔑", supervisorOnly: true },
  { to: "/templates", label: "Templates", icon: "📋", supervisorOnly: true },
  { to: "/assets", label: "Assets", icon: "🖼️", supervisorOnly: true },
  { to: "/settings", label: "Settings", icon: "⚙️", supervisorOnly: true },
];

export function Layout({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { user, clear, setUser } = useAuth();
  const nav = useNavigate();
  const isSup = user?.role === "admin" || user?.role === "supervisor";
  const isAdmin = user?.role === "admin";
  const isAgent = user?.role === "agent";
  const [busy, setBusy] = useState(false);

  const toggleAvailable = async () => {
    if (!user || busy) return;
    setBusy(true);
    try {
      const next = !user.is_available;
      await api.updateUser(user.id, { is_available: next });
      setUser({ is_available: next });
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside style={{
        width: 220, background: "#273b84", color: "#fff",
        display: "flex", flexDirection: "column", position: "sticky", top: 0, height: "100vh",
      }}>
        <div style={{
          padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,.12)",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <img src="/static/favicon.png" alt="" width={28} height={28} style={{ display: "block" }} />
          <div style={{ lineHeight: 1.15 }}>
            <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: ".2px" }}>Janapriya</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,.7)", letterSpacing: ".4px" }}>UPSCALE</div>
          </div>
        </div>
        <nav style={{ flex: 1, padding: "8px 6px" }}>
          {NAV.filter((n) => !n.supervisorOnly || isSup).filter((n) => n.to !== "/api-keys" || isAdmin).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              style={({ isActive }) => ({
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 12px", margin: "2px 0",
                borderRadius: 6, textDecoration: "none",
                color: isActive ? "#fff" : "rgba(255,255,255,.78)",
                background: isActive ? "#ed2347" : "transparent",
                fontSize: 14, fontWeight: isActive ? 600 : 400,
                transition: "background .12s",
              })}
            >
              <span style={{ fontSize: 16 }}>{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ padding: 12, borderTop: "1px solid rgba(255,255,255,.12)", fontSize: 12 }}>
          <div style={{ fontWeight: 600 }}>{user?.display_name || user?.email}</div>
          <div style={{ color: "#9ca3af", marginBottom: 6 }}>{user?.role}</div>
          {isAgent && (
            <button
              onClick={toggleAvailable}
              disabled={busy}
              style={{
                width: "100%", padding: "6px 8px", fontSize: 12, marginBottom: 6,
                borderRadius: 4, border: "none", cursor: busy ? "default" : "pointer",
                background: user?.is_available ? "#10b981" : "#374151",
                color: "#fff", fontWeight: 600,
              }}
              title="Round-robin only assigns chats to available agents"
            >
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                background: user?.is_available ? "#fff" : "#9ca3af", marginRight: 6,
              }} />
              {user?.is_available ? "Available" : "Unavailable"}
            </button>
          )}
          <button className="btn ghost" style={{ width: "100%", padding: "6px 8px", fontSize: 12 }}
            onClick={() => { clear(); nav("/login"); }}>
            Sign out
          </button>
        </div>
      </aside>
      <main style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
        <div style={{ maxWidth: wide ? "100%" : 1100, margin: wide ? 0 : "0 auto", padding: wide ? 0 : "24px 24px" }}>
          {children}
        </div>
      </main>
    </div>
  );
}
