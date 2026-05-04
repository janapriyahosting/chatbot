import { useState } from "react";

const BUILTIN_VARS: { group: string; tokens: { label: string; token: string }[] }[] = [
  {
    group: "Visitor",
    tokens: [
      { label: "Visitor ID", token: "{{visitor_id}}" },
    ],
  },
  {
    group: "UTM / Ad click",
    tokens: [
      { label: "utm_source", token: "{{utm.utm_source}}" },
      { label: "utm_medium", token: "{{utm.utm_medium}}" },
      { label: "utm_campaign", token: "{{utm.utm_campaign}}" },
      { label: "gclid", token: "{{utm.gclid}}" },
      { label: "fbclid", token: "{{utm.fbclid}}" },
    ],
  },
  {
    group: "Form answers",
    tokens: [
      { label: "form.name", token: "{{answers.form.name}}" },
      { label: "form.phone", token: "{{answers.form.phone}}" },
      { label: "form.email", token: "{{answers.form.email}}" },
    ],
  },
  {
    group: "API responses",
    tokens: [
      { label: "api.<save_as>.<field>", token: "{{api.api_response}}" },
    ],
  },
];

export function VarPicker({ onInsert }: { onInsert: (token: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "#eef2ff", color: "#4338ca", border: "1px solid #c7d2fe",
          borderRadius: 4, fontSize: 11, padding: "2px 6px", cursor: "pointer", marginTop: 4,
        }}
      >
        + variable
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, zIndex: 10,
          background: "#fff", border: "1px solid #e5e7eb", borderRadius: 6,
          boxShadow: "0 6px 16px rgba(0,0,0,.1)", padding: 6, minWidth: 220, maxHeight: 260,
          overflowY: "auto",
        }}>
          {BUILTIN_VARS.map((g) => (
            <div key={g.group}>
              <div style={{ fontSize: 10, textTransform: "uppercase", color: "#9ca3af", padding: "4px 6px" }}>
                {g.group}
              </div>
              {g.tokens.map((t) => (
                <div
                  key={t.token}
                  onClick={() => { onInsert(t.token); setOpen(false); }}
                  style={{ padding: "4px 6px", fontSize: 12, cursor: "pointer", borderRadius: 4 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f4f6")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                >
                  <span style={{ fontWeight: 500 }}>{t.label}</span>
                  <code style={{ marginLeft: 6, fontSize: 10, color: "#6b7280" }}>{t.token}</code>
                </div>
              ))}
            </div>
          ))}
          <div style={{ fontSize: 11, color: "#6b7280", padding: 6, borderTop: "1px solid #f3f4f6", marginTop: 4 }}>
            Tip: any <code>{"{{path.to.value}}"}</code> that matches your flow's
            answers / api outputs will also work.
          </div>
        </div>
      )}
    </div>
  );
}
