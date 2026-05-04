import { useEffect, useState } from "react";
import { api } from "../api";
import { Layout } from "../Layout";
import { useAuth } from "../store";

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  role: string;
  is_active: boolean;
  is_available: boolean;
};

export function Users() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState({ email: "", display_name: "", role: "agent", password: "" });
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    try { setUsers(await api.listUsers()); } catch (e: any) { setErr(e.message); }
  };
  useEffect(() => { reload(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.createUser(form);
      setForm({ email: "", display_name: "", role: "agent", password: "" });
      setShowNew(false);
      reload();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const toggle = async (u: UserRow, field: "is_active" | "is_available", val: boolean) => {
    try { await api.updateUser(u.id, { [field]: val }); reload(); }
    catch (e: any) { setErr(e.message); }
  };

  const removeUser = async (u: UserRow) => {
    if (!window.confirm(`Delete user "${u.display_name}" (${u.email})?\n\nThis permanently removes the account. Open conversations assigned to them will be unassigned, and their API keys will be orphaned.`))
      return;
    if (!window.confirm(`One more time — really delete "${u.display_name}"?`)) return;
    try { await api.deleteUser(u.id); reload(); }
    catch (e: any) { setErr(e.message); }
  };

  return (
    <Layout>
      <div className="row" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Users</h2>
        <div className="spacer" />
        {user?.role === "admin" && <button className="btn" onClick={() => setShowNew(true)}>+ New user</button>}
      </div>
      {err && <div className="error">{err}</div>}
      <div className="grid">
        {users.map((u) => (
          <div className="card" key={u.id}>
            <div className="row">
              <div>
                <div style={{ fontWeight: 600 }}>{u.display_name}</div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  {u.email} · {u.role}{u.is_active ? "" : " · disabled"}
                </div>
              </div>
              <div className="spacer" />
              {u.role === "agent" && (
                <label style={{ fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={!!u.is_available}
                    onChange={(e) => toggle(u, "is_available", e.target.checked)}
                    disabled={user?.role !== "admin" && user?.email !== u.email}
                  /> available
                </label>
              )}
              {user?.role === "admin" && (
                <button className="btn ghost" onClick={() => setEditing(u)}>Edit</button>
              )}
              {user?.role === "admin" && u.email !== user.email && (
                <>
                  <button className="btn ghost" onClick={() => toggle(u, "is_active", !u.is_active)}>
                    {u.is_active ? "Disable" : "Enable"}
                  </button>
                  <button className="btn danger" onClick={() => removeUser(u)}>Delete</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {showNew && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "grid", placeItems: "center", zIndex: 100 }}>
          <form className="card" style={{ width: 420 }} onSubmit={submit}>
            <h3 style={{ marginTop: 0 }}>New user</h3>
            <label>Email</label><input required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <label>Display name</label><input required value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
            <label>Role</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="agent">Agent</option>
              <option value="supervisor">Supervisor</option>
              <option value="admin">Admin</option>
            </select>
            <label>Password</label><input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <div className="row" style={{ marginTop: 16 }}>
              <button type="button" className="btn ghost" onClick={() => setShowNew(false)}>Cancel</button>
              <div className="spacer" />
              <button className="btn" disabled={busy}>{busy ? "Creating…" : "Create"}</button>
            </div>
          </form>
        </div>
      )}

      {editing && (
        <EditUserModal
          target={editing}
          isSelf={user?.email === editing.email}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
          onError={(m) => setErr(m)}
        />
      )}
    </Layout>
  );
}

function EditUserModal({ target, isSelf, onClose, onSaved, onError }: {
  target: UserRow; isSelf: boolean;
  onClose: () => void; onSaved: () => void; onError: (m: string) => void;
}) {
  const [displayName, setDisplayName] = useState(target.display_name);
  const [role, setRole] = useState(target.role);
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password && password !== confirmPw) { onError("Passwords do not match"); return; }
    if (password && password.length < 6) { onError("Password must be at least 6 characters"); return; }
    setBusy(true);
    try {
      const body: any = { display_name: displayName };
      if (!isSelf) body.role = role;
      if (password) body.password = password;
      await api.updateUser(target.id, body);
      onSaved();
    } catch (e: any) { onError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "grid", placeItems: "center", zIndex: 100 }}>
      <form className="card" style={{ width: 460 }} onSubmit={save}>
        <h3 style={{ marginTop: 0 }}>
          Edit user
          {isSelf && <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 400, marginLeft: 8 }}>(your account)</span>}
        </h3>
        <label>Email</label>
        <input value={target.email} disabled style={{ opacity: 0.7 }} />
        <label>Display name</label>
        <input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <label>Role</label>
        <select value={role} onChange={(e) => setRole(e.target.value)} disabled={isSelf}>
          <option value="agent">Agent</option>
          <option value="supervisor">Supervisor</option>
          <option value="admin">Admin</option>
        </select>
        {isSelf && <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>You can't change your own role.</div>}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
            {isSelf ? "Change password (leave blank to keep current):" : "Reset password (leave blank to keep current):"}
          </div>
          <label>New password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="•••••••" />
          <label>Confirm password</label>
          <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" placeholder="•••••••" />
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <div className="spacer" />
          <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </div>
  );
}
