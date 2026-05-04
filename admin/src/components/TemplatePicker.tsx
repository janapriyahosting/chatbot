import { useEffect, useRef, useState } from "react";
import { api } from "../api";

type Template = { id: string; title: string; body: string };

export function TemplatePicker({ onPick }: { onPick: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || loaded) return;
    api.listTemplates()
      .then((rows) => { setTemplates(rows); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [open, loaded]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="btn ghost"
        onClick={() => setOpen((v) => !v)}
        title="Insert template"
        style={{ padding: "6px 10px", fontSize: 14, lineHeight: 1 }}
      >
        📋
      </button>
      {open && (
        <div
          style={{
            position: "absolute", bottom: "calc(100% + 6px)", left: 0,
            background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8,
            padding: 4, boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            display: "flex", flexDirection: "column", minWidth: 280, zIndex: 50,
          }}
        >
          {!loaded && (
            <div style={{ padding: 10, fontSize: 12, color: "#6b7280" }}>Loading…</div>
          )}
          {loaded && templates.length === 0 && (
            <div style={{ padding: 10, fontSize: 12, color: "#6b7280" }}>
              No templates yet. Add some in /admin/templates.
            </div>
          )}
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { onPick(t.body); setOpen(false); }}
              title={t.body}
              style={{
                textAlign: "left", padding: "8px 10px", border: "none",
                background: "transparent", cursor: "pointer", fontSize: 13,
                borderRadius: 4, color: "#1f2937", display: "flex", flexDirection: "column", gap: 2,
              }}
              onMouseEnter={(ev) => (ev.currentTarget.style.background = "#f3f4f6")}
              onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
            >
              <span style={{ fontWeight: 600, fontSize: 12 }}>{t.title}</span>
              <span style={{ color: "#6b7280", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>
                {t.body}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
