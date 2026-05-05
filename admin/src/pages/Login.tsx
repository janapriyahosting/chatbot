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
          setErr(e.message || "login failed");
        }
      })();
    } else if (errMsg) {
      history.replaceState({}, "", "/login");
      setErr(errMsg);
    }
  }, [setAuth, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api.login(email, password);
      setAuth(r.access_token, r.user);
      nav("/");
    } catch (e: any) {
      setErr(e.message || "login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.page}>
      {/* Left: brand panel — collapses on mobile (handled via CSS class below) */}
      <div className="login-brand" style={styles.brand}>
        <div style={styles.brandInner}>
          <img src="/static/favicon.png" alt="" width={72} height={72} style={{ display: "block" }} />
          <div style={styles.brandTitle}>
            Janapriya <span style={{ color: "rgba(255,255,255,.78)", fontWeight: 500 }}>UPSCALE</span>
          </div>
          <div style={styles.brandTagline}>Ask More of Life</div>
          <div style={styles.brandDivider} />
          <div style={styles.brandSubtitle}>Chatbot administration console</div>
        </div>
        <div style={styles.brandFooter}>© Janapriya Upscale</div>
      </div>

      {/* Right: form */}
      <div style={styles.formPanel}>
        <div style={styles.formCard}>
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
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
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
  },
  formCard: {
    width: "100%",
    maxWidth: 380,
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
