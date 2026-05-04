import { useEffect, useState } from "react";
import { api } from "../api";
import { Layout } from "../Layout";
import { useAuth } from "../store";

type Template = { id: string; title: string; body: string; sort_order: number };

export function Templates() {
  const role = useAuth((s) => s.user?.role);
  const canEdit = role === "admin" || role === "supervisor";

  const [rows, setRows] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | null>(null);
  const [draft, setDraft] = useState({ title: "", body: "", sort_order: 0 });
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try { setRows(await api.listTemplates()); } catch (e: any) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  const startCreate = () => {
    setEditing({ id: "", title: "", body: "", sort_order: rows.length });
    setDraft({ title: "", body: "", sort_order: rows.length });
  };
  const startEdit = (t: Template) => {
    setEditing(t);
    setDraft({ title: t.title, body: t.body, sort_order: t.sort_order });
  };
  const cancel = () => { setEditing(null); setErr(null); };

  const save = async () => {
    if (!draft.title.trim() || !draft.body.trim()) {
      setErr("title and body are required"); return;
    }
    try {
      if (editing && editing.id) {
        await api.updateTemplate(editing.id, draft);
      } else {
        await api.createTemplate(draft);
      }
      setEditing(null); setErr(null); await load();
    } catch (e: any) { setErr(e.message); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this template?")) return;
    try { await api.deleteTemplate(id); await load(); }
    catch (e: any) { setErr(e.message); }
  };

  return (
    <Layout>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>Message templates</h2>
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            Canned replies the agent picks from the 📋 menu in live chat.
          </div>
        </div>
        {canEdit && (
          <button className="btn" onClick={startCreate}>+ New template</button>
        )}
      </div>

      {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}

      {editing && (
        <div style={{
          background: "#fff", padding: 16, border: "1px solid #e5e7eb",
          borderRadius: 8, marginBottom: 16,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>
            {editing.id ? "Edit template" : "New template"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              placeholder="Title (shown in the picker)"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <textarea
              placeholder="Body (the message that gets inserted)"
              rows={4}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              style={{ fontFamily: "inherit", fontSize: 14, padding: 8, borderRadius: 4, border: "1px solid #e5e7eb" }}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ fontSize: 12, color: "#6b7280" }}>Sort order:</label>
              <input
                type="number"
                value={draft.sort_order}
                onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })}
                style={{ width: 80 }}
              />
              <div style={{ flex: 1 }} />
              <button className="btn ghost" onClick={cancel}>Cancel</button>
              <button className="btn" onClick={save}>Save</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8 }}>
        {rows.length === 0 && (
          <div style={{ padding: 24, color: "#6b7280", textAlign: "center" }}>
            No templates yet.
          </div>
        )}
        {rows.map((t) => (
          <div key={t.id} style={{
            padding: 12, borderBottom: "1px solid #f3f4f6",
            display: "flex", gap: 12, alignItems: "center",
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{t.title}</div>
              <div style={{ color: "#6b7280", fontSize: 13, marginTop: 2, whiteSpace: "pre-wrap" }}>
                {t.body}
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af", width: 40, textAlign: "right" }}>
              #{t.sort_order}
            </div>
            {canEdit && (
              <>
                <button className="btn ghost" onClick={() => startEdit(t)}>Edit</button>
                <button className="btn danger" onClick={() => remove(t.id)}>Delete</button>
              </>
            )}
          </div>
        ))}
      </div>
    </Layout>
  );
}
