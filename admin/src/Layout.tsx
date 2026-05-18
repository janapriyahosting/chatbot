import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./store";
import { useIsMobile } from "./utils/useIsMobile";

// Decorative emblem cluster shown faintly across the dashboard. Sizes scale
// from anchor (bottom-right) outward — bigger near the corner, smaller
// "sparkles" trailing toward the center. `pointer-events: none` keeps them
// from intercepting clicks, and we skip them on mobile to avoid clutter on
// small screens.
const DASHBOARD_SPARKLES: {
  size: number;
  top?: string; right?: string; bottom?: string; left?: string;
  opacity: number; rotate?: number;
}[] = [
  { size: 110, bottom: "16px", right: "16px", opacity: 0.10, rotate: -8 },
  { size: 60,  bottom: "140px", right: "60px", opacity: 0.08, rotate: 14 },
  { size: 40,  bottom: "220px", right: "30px", opacity: 0.09, rotate: -22 },
  { size: 70,  top: "80px", right: "40px", opacity: 0.06, rotate: 10 },
  { size: 32,  top: "180px", right: "120px", opacity: 0.08, rotate: -6 },
];

const NAV: { to: string; label: string; icon: string; supervisorOnly?: boolean }[] = [
  { to: "/inbox", label: "Live chats", icon: "💬" },
  { to: "/", label: "Bots", icon: "🤖", supervisorOnly: true },
  { to: "/sites", label: "Sites", icon: "🌐", supervisorOnly: true },
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
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  // Auto-close the drawer on route change so tapping a nav link doesn't leave
  // it hovering over the new page.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

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

  // On mobile the sidebar becomes an off-canvas drawer that slides in over
  // the content. We always render the <aside> so the drawer animation works;
  // CSS positions it correctly per breakpoint.
  const asideStyle: React.CSSProperties = isMobile
    ? {
        width: 240, background: "#273b84", color: "#fff",
        display: "flex", flexDirection: "column",
        position: "fixed", top: 0, left: 0, height: "100vh",
        transform: drawerOpen ? "translateX(0)" : "translateX(-100%)",
        transition: "transform .2s ease-out",
        zIndex: 50,
        boxShadow: drawerOpen ? "2px 0 12px rgba(0,0,0,.25)" : "none",
      }
    : {
        width: 220, background: "#273b84", color: "#fff",
        display: "flex", flexDirection: "column",
        position: "sticky", top: 0, height: "100vh",
      };

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {isMobile && drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,.45)",
            zIndex: 45,
          }}
        />
      )}
      <aside style={asideStyle}>
        <div style={{
          padding: "16px 18px", borderBottom: "1px solid rgba(255,255,255,.12)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <img
            src="/static/brand/janapriya-upscale-light.png"
            alt="Janapriya Upscale"
            style={{ width: "100%", maxWidth: 170, height: "auto", display: "block" }}
          />
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
      <main style={isMobile ? {
        flex: 1, minWidth: 0,
        display: "flex", flexDirection: "column",
        height: "100dvh", overflow: "hidden",
        position: "relative",
      } : {
        flex: 1, minWidth: 0, overflow: "auto",
        position: "relative",
      }}>
        {!isMobile && DASHBOARD_SPARKLES.map((s, i) => (
          <img
            key={i}
            src="/static/brand/janapriya-ramus.png"
            alt=""
            aria-hidden="true"
            style={{
              position: "fixed",
              width: s.size,
              height: s.size,
              top: s.top, right: s.right, bottom: s.bottom, left: s.left,
              opacity: s.opacity,
              transform: `rotate(${s.rotate ?? 0}deg)`,
              pointerEvents: "none",
              userSelect: "none",
              zIndex: 0,
            }}
          />
        ))}
        {isMobile && (
          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "8px 12px", height: 48, flexShrink: 0,
            background: "#273b84", color: "#fff",
            boxSizing: "border-box",
          }}>
            <button
              aria-label="Open menu"
              onClick={() => setDrawerOpen(true)}
              style={{
                width: 36, height: 36, borderRadius: 6, border: "none",
                background: "transparent", color: "#fff", fontSize: 22, lineHeight: 1,
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: 0,
              }}
            >☰</button>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Janapriya Chatbot</div>
          </div>
        )}
        <div style={isMobile ? {
          flex: 1, minHeight: 0, overflow: "auto",
          maxWidth: "100%", padding: wide ? 0 : 16, width: "100%",
        } : {
          maxWidth: wide ? "100%" : 1100,
          margin: wide ? 0 : "0 auto",
          padding: wide ? 0 : "24px 24px",
        }}>
          {children}
        </div>
      </main>
    </div>
  );
}
