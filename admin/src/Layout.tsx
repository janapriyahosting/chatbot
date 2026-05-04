import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "./store";

const NAV: { to: string; label: string; icon: string; supervisorOnly?: boolean }[] = [
  { to: "/admin/inbox", label: "Live chats", icon: "💬" },
  { to: "/admin", label: "Bots", icon: "🤖" },
  { to: "/admin/whatsapp", label: "WhatsApp", icon: "🟢" },
  { to: "/admin/leads", label: "Leads", icon: "👥", supervisorOnly: true },
  { to: "/admin/analytics", label: "Analytics", icon: "📈", supervisorOnly: true },
  { to: "/admin/users", label: "Users", icon: "🧑‍💼", supervisorOnly: true },
  { to: "/admin/api-keys", label: "API keys", icon: "🔑", supervisorOnly: true },
];

export function Layout({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { user, clear } = useAuth();
  const nav = useNavigate();
  const isSup = user?.role === "admin" || user?.role === "supervisor";
  const isAdmin = user?.role === "admin";

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside style={{
        width: 220, background: "#111827", color: "#fff",
        display: "flex", flexDirection: "column", position: "sticky", top: 0, height: "100vh",
      }}>
        <div style={{ padding: "16px 18px", fontWeight: 700, fontSize: 16, borderBottom: "1px solid #1f2937" }}>
          ChatBot
        </div>
        <nav style={{ flex: 1, padding: "8px 6px" }}>
          {NAV.filter((n) => !n.supervisorOnly || isSup).filter((n) => n.to !== "/admin/api-keys" || isAdmin).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/admin"}
              style={({ isActive }) => ({
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 12px", margin: "2px 0",
                borderRadius: 6, textDecoration: "none",
                color: isActive ? "#fff" : "#d1d5db",
                background: isActive ? "#2563eb" : "transparent",
                fontSize: 14, fontWeight: isActive ? 600 : 400,
              })}
            >
              <span style={{ fontSize: 16 }}>{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ padding: 12, borderTop: "1px solid #1f2937", fontSize: 12 }}>
          <div style={{ fontWeight: 600 }}>{user?.display_name || user?.email}</div>
          <div style={{ color: "#9ca3af", marginBottom: 6 }}>{user?.role}</div>
          <button className="btn ghost" style={{ width: "100%", padding: "6px 8px", fontSize: 12 }}
            onClick={() => { clear(); nav("/admin/login"); }}>
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
