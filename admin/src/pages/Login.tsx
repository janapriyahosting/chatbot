import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../store";

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
      .then((r) => r.ok ? r.json() : { enabled: false })
      .then((d) => setO365Enabled(!!d.enabled))
      .catch(() => {});
  }, []);

  // Handle the fragment returned by the O365 callback:
  //   /admin/login#token=<jwt>            on success
  //   /admin/login#error=<message>        on failure
  useEffect(() => {
    const hash = window.location.hash || "";
    if (!hash) return;
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const token = params.get("token");
    const errMsg = params.get("error");
    if (token) {
      // Strip the fragment from the URL so the token doesn't sit in history
      history.replaceState({}, "", "/admin/login");
      (async () => {
        try {
          const me = await fetch("/auth/me", {
            headers: { authorization: `Bearer ${token}` },
          }).then((r) => r.ok ? r.json() : Promise.reject(new Error("auth/me failed")));
          setAuth(token, me);
          nav("/admin");
        } catch (e: any) {
          setErr(e.message || "login failed");
        }
      })();
    } else if (errMsg) {
      history.replaceState({}, "", "/admin/login");
      setErr(errMsg);
    }
  }, [setAuth, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await api.login(email, password);
      setAuth(r.access_token, r.user);
      nav("/admin");
    } catch (e: any) {
      setErr(e.message || "login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <form className="card" style={{ width: 360 }} onSubmit={submit}>
        <h2 style={{ marginTop: 0 }}>ChatBot Admin</h2>
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {err && <div className="error">{err}</div>}
        <button className="btn" style={{ marginTop: 16, width: "100%" }} disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {o365Enabled && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "16px 0",
                          color: "#9ca3af", fontSize: 12 }}>
              <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
              <span>OR</span>
              <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
            </div>
            <a
              href="/auth/o365/login"
              className="btn ghost"
              style={{
                width: "100%", display: "flex", alignItems: "center",
                justifyContent: "center", gap: 8, textDecoration: "none",
                color: "#1f2937", padding: "10px",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
              Sign in with Microsoft
            </a>
          </>
        )}
      </form>
    </div>
  );
}
