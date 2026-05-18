import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../store";

const BRAND_BLUE = "#273b84";
const BRAND_RED = "#ed2347";

export function Login() {
  const nav = useNavigate();
  const setAuth = useAuth((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [o365Enabled, setO365Enabled] = useState(false);

  useEffect(() => {
    fetch("/auth/o365/status")
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => setO365Enabled(!!d.enabled))
      .catch(() => {});
  }, []);

  // Handle the OAuth callback fragment that arrives at /login#token=… or /login#error=…
  useEffect(() => {
    const hash = window.location.hash || "";
    if (!hash) return;
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const token = params.get("token");
    const errMsg = params.get("error");
    if (token) {
      history.replaceState({}, "", "/login");
      (async () => {
        try {
          const me = await fetch("/auth/me", {
            headers: { authorization: `Bearer ${token}` },
          }).then((r) => (r.ok ? r.json() : Promise.reject(new Error("auth/me failed"))));
          setAuth(token, me);
          nav("/");
        } catch (e: any) {
          setErr(friendlyLoginError(e));
        }
      })();
    } else if (errMsg) {
      history.replaceState({}, "", "/login");
      setErr(friendlyLoginError({ message: errMsg }));
    }
  }, [setAuth, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setErr("Please enter your email and password.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api.login(trimmedEmail, password);
      setAuth(r.access_token, r.user);
      nav("/");
    } catch (e: any) {
      setErr(friendlyLoginError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.page}>
      {/* Left: brand panel — collapses on mobile (handled via CSS class below) */}
      <div className="login-brand" style={styles.brand}>
        <Sparkles cluster={BRAND_SPARKLES} />
        <div style={styles.brandInner}>
          <img
            src="/static/brand/janapriya-upscale-light.png"
            alt="Janapriya Upscale"
            style={{ width: "min(380px, 80%)", height: "auto", display: "block" }}
          />
          <div style={styles.brandDivider} />
          <div style={styles.brandSubtitle}>Chatbot administration console</div>
        </div>
        <div style={styles.brandFooter}>© Janapriya Upscale</div>
      </div>

      {/* Right: form */}
      <div style={styles.formPanel}>
        <Sparkles cluster={FORM_SPARKLES} />
        <div style={styles.formCard}>
          <img
            src="/static/brand/janapriya-upscale-dark.png"
            alt="Janapriya Upscale"
            style={{ width: 200, height: "auto", display: "block", marginBottom: 28 }}
          />
          <div style={{ marginBottom: 24 }}>
            <h1 style={styles.formTitle}>Welcome back</h1>
            <p style={styles.formSubtitle}>Sign in to continue to your dashboard</p>
          </div>

          <form onSubmit={submit} noValidate>
            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@janapriyaupscale.com"
                autoFocus
                style={styles.input}
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={styles.input}
              />
            </Field>

            {err && <div style={styles.error}>{err}</div>}

            <button type="submit" disabled={busy} style={busy ? styles.btnPrimaryBusy : styles.btnPrimary}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          {o365Enabled && (
            <>
              <div style={styles.divider}>
                <span style={styles.dividerLine} />
                <span style={styles.dividerText}>or</span>
                <span style={styles.dividerLine} />
              </div>
              <a href="/auth/o365/login" style={styles.btnMicrosoft}>
                <svg width="18" height="18" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                  <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                  <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                  <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
                </svg>
                Sign in with Microsoft
              </a>
            </>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 820px) {
          .login-brand { display: none !important; }
        }
        input:focus { outline: none; border-color: ${BRAND_BLUE} !important;
                      box-shadow: 0 0 0 3px rgba(39,59,132,.15) !important; }
        a.login-ms:hover { background: #f9fafb !important; }
      `}</style>
    </div>
  );
}

type Sparkle = {
  size: number;
  // Anchor: any subset of top/right/bottom/left in % or px strings.
  top?: string; right?: string; bottom?: string; left?: string;
  opacity: number;
  rotate?: number;
};

// Larger emblems anchor the eye; smaller ones trail off like sparkles.
// Coordinates are anchored to corners/edges, never overlapping the
// centered content (logo + headings).
const BRAND_SPARKLES: Sparkle[] = [
  { size: 520, top: "50%",  left: "50%", opacity: 0.07, rotate: -12 }, // hero center
  { size: 140, top: "8%",   left: "6%",  opacity: 0.14, rotate: 14 },
  { size: 90,  top: "18%",  right: "10%", opacity: 0.12, rotate: -8 },
  { size: 60,  top: "40%",  right: "6%",  opacity: 0.16, rotate: 22 },
  { size: 110, bottom: "12%", left: "8%", opacity: 0.13, rotate: -20 },
  { size: 50,  bottom: "26%", right: "14%", opacity: 0.18, rotate: 10 },
  { size: 40,  bottom: "8%", right: "32%", opacity: 0.20, rotate: -6 },
];

const FORM_SPARKLES: Sparkle[] = [
  { size: 160, bottom: "24px", right: "24px", opacity: 0.07, rotate: -10 },
  { size: 80,  top: "8%",   right: "8%",   opacity: 0.06, rotate: 12 },
  { size: 50,  top: "32%",  left: "6%",    opacity: 0.07, rotate: -18 },
  { size: 36,  bottom: "20%", left: "12%", opacity: 0.08, rotate: 8 },
  { size: 28,  top: "60%",  right: "16%",  opacity: 0.09, rotate: -4 },
];

function Sparkles({ cluster }: { cluster: Sparkle[] }) {
  return (
    <>
      {cluster.map((s, i) => {
        // When anchored by a center-style 50% with no explicit translate, we
        // shift the image by -50% so it actually centers on that anchor.
        const isCentered = s.top === "50%" && s.left === "50%";
        const transform = `${isCentered ? "translate(-50%, -50%) " : ""}rotate(${s.rotate ?? 0}deg)`;
        return (
          <img
            key={i}
            src="/static/brand/janapriya-ramus.png"
            alt=""
            aria-hidden="true"
            style={{
              position: "absolute",
              width: s.size,
              height: s.size,
              top: s.top, right: s.right, bottom: s.bottom, left: s.left,
              opacity: s.opacity,
              transform,
              pointerEvents: "none",
              userSelect: "none",
              zIndex: 0,
            }}
          />
        );
      })}
    </>
  );
}

function friendlyLoginError(e: any): string {
  const raw = (e?.message || "").toString().trim().toLowerCase();
  if (!raw) return "Sign-in failed. Please try again.";
  if (raw === "unauthorized" || raw === "invalid credentials") {
    return "Incorrect email or password.";
  }
  if (raw.includes("failed to fetch") || raw.includes("networkerror") || raw.includes("load failed")) {
    return "Can't reach the server. Check your connection and try again.";
  }
  if (raw.includes("email")) return "Please enter a valid email address.";
  // Already-humanised messages from api.ts get shown with sentence case.
  return e.message.charAt(0).toUpperCase() + e.message.slice(1);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={styles.fieldWrap}>
      <span style={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: "flex",
    minHeight: "100vh",
    width: "100%",
    background: "#f9fafb",
    fontFamily: "'Lato', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  brand: {
    flex: "0 0 44%",
    background: `linear-gradient(135deg, ${BRAND_BLUE} 0%, #1a285c 100%)`,
    color: "#fff",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    padding: 48,
    position: "relative",
    overflow: "hidden",
  },
  brandInner: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 14,
    zIndex: 1,
  },
  brandTitle: {
    fontSize: 32,
    fontWeight: 700,
    letterSpacing: ".5px",
    marginTop: 8,
  },
  brandTagline: {
    fontSize: 15,
    color: "rgba(255,255,255,.78)",
    fontStyle: "italic",
  },
  brandDivider: {
    width: 56,
    height: 3,
    background: BRAND_RED,
    borderRadius: 2,
    margin: "8px 0 4px",
  },
  brandSubtitle: {
    fontSize: 13,
    color: "rgba(255,255,255,.65)",
    textAlign: "center",
    maxWidth: 280,
    lineHeight: 1.5,
  },
  brandFooter: {
    position: "absolute",
    bottom: 24,
    fontSize: 11,
    color: "rgba(255,255,255,.45)",
    letterSpacing: ".5px",
  },
  formPanel: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    position: "relative",
    overflow: "hidden",
  },
  formCard: {
    width: "100%",
    maxWidth: 380,
    position: "relative",
    zIndex: 1,
  },
  formTitle: {
    margin: 0,
    fontSize: 26,
    fontWeight: 700,
    color: "#111827",
  },
  formSubtitle: {
    margin: "6px 0 0",
    fontSize: 14,
    color: "#6b7280",
  },
  fieldWrap: {
    display: "block",
    marginBottom: 16,
  },
  fieldLabel: {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "#374151",
    marginBottom: 6,
  },
  input: {
    width: "100%",
    padding: "11px 14px",
    fontSize: 14,
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    background: "#fff",
    boxSizing: "border-box",
    transition: "border-color .15s, box-shadow .15s",
  },
  error: {
    background: "#fef2f2",
    color: "#991b1b",
    border: "1px solid #fecaca",
    padding: "10px 12px",
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 14,
  },
  btnPrimary: {
    width: "100%",
    padding: "12px 16px",
    fontSize: 14,
    fontWeight: 600,
    color: "#fff",
    background: BRAND_BLUE,
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    marginTop: 4,
    transition: "background .15s, transform .05s",
  },
  btnPrimaryBusy: {
    width: "100%",
    padding: "12px 16px",
    fontSize: 14,
    fontWeight: 600,
    color: "#fff",
    background: "#6b7280",
    border: "none",
    borderRadius: 8,
    cursor: "default",
    marginTop: 4,
  },
  divider: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    margin: "20px 0 16px",
    color: "#9ca3af",
    fontSize: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    background: "#e5e7eb",
  },
  dividerText: {
    textTransform: "uppercase",
    letterSpacing: ".5px",
  },
  btnMicrosoft: {
    width: "100%",
    padding: "11px 14px",
    fontSize: 14,
    fontWeight: 500,
    color: "#1f2937",
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    cursor: "pointer",
    textDecoration: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    boxSizing: "border-box",
    transition: "background .15s",
  },
};
