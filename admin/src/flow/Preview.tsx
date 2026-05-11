import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { mdToHtml } from "./markdown";

type Out = { kind: string; config: any };

export function Preview({
  botId, definition, onClose,
}: {
  botId: string;
  definition: any;
  onClose: () => void;
}) {
  const [context, setContext] = useState<any>({});
  const [messages, setMessages] = useState<{ side: "bot" | "visitor"; body: any }[]>([]);
  const [awaiting, setAwaiting] = useState<any>(null);
  const [ended, setEnded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const step = async (reply: any) => {
    try {
      const r = await api.previewFlow(botId, definition, reply, context);
      setContext(r.context || {});
      setAwaiting(r.awaiting);
      setEnded(!!r.ended);
      const BUBBLE_KINDS = new Set(["text", "image", "video", "document", "carousel"]);
      for (const o of r.outputs || []) {
        if (!BUBBLE_KINDS.has(o.kind)) continue;
        if (o.kind === "text" && !((o.config?.body || "").trim())) continue;
        setMessages((m) => [...m, { side: "bot", body: o }]);
      }
    } catch (e: any) { setErr(e.message); }
  };

  useEffect(() => { step(null); /* eslint-disable-next-line */ }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length, awaiting]);

  const click = (value: string, label: string) => {
    setMessages((m) => [...m, { side: "visitor", body: { kind: "text", config: { body: label } } }]);
    step({ value });
  };

  const submitForm = (values: Record<string, string>) => {
    const lines = Object.entries(values).map(([k, v]) => `${k}: ${v}`).join("\n");
    setMessages((m) => [...m, { side: "visitor", body: { kind: "text", config: { body: lines } } }]);
    step({ values });
  };

  const submitOtp = (otp: string) => {
    setMessages((m) => [...m, { side: "visitor", body: { kind: "text", config: { body: "•".repeat(otp.length) } } }]);
    step({ value: otp, otp });
  };

  const submitValue = (value: string, display?: string) => {
    const shown = display != null ? display : value;
    setMessages((m) => [...m, { side: "visitor", body: { kind: "text", config: { body: shown } } }]);
    step({ value });
  };

  const inputCfg = awaiting?.type === "input" ? (awaiting.config || {}) : null;
  const inputT = (inputCfg?.type || "text").toLowerCase();
  const TEXT_LIKE = new Set(["text", "email", "tel", "phone", "number", "url", "date", "textarea"]);
  const showBottomBar = inputCfg != null && TEXT_LIKE.has(inputT);
  const barType =
    inputT === "tel" || inputT === "phone" ? "tel" :
    inputT === "email" ? "email" :
    inputT === "number" ? "number" :
    inputT === "url" ? "url" :
    inputT === "date" ? "date" : "text";

  return (
    <div style={{
      position: "fixed", right: 20, bottom: 20, width: 380, height: 560,
      background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10,
      boxShadow: "0 16px 48px rgba(0,0,0,.22)", zIndex: 200,
      display: "flex", flexDirection: "column",
    }}>
      <div style={{ padding: 10, background: "#111827", color: "#fff", display: "flex", alignItems: "center" }}>
        <div style={{ fontWeight: 600 }}>Preview (draft, not saved)</div>
        <div style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onClose} style={{ padding: "4px 10px" }}>Close</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 12, background: "#f9fafb" }}>
        {messages.map((m, i) => <Bubble key={i} side={m.side} out={m.body} />)}
        {awaiting && awaiting.type === "buttons" && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0" }}>
            {(awaiting.config?.options || []).map((o: any, i: number) => (
              <button key={i} className="btn ghost" onClick={() => click(o.value, o.label || o.value)}>
                {o.label || o.value}
              </button>
            ))}
          </div>
        )}
        {awaiting && awaiting.type === "image_buttons" && (
          <div style={{ margin: "6px 0" }}>
            {awaiting.config?.body && (
              <div style={{ marginBottom: 6, fontSize: 14 }}>{awaiting.config.body}</div>
            )}
            <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 6, scrollSnapType: "x mandatory" }}>
              {(awaiting.config?.options || []).map((o: any, i: number) => (
                <button
                  key={i}
                  onClick={() => click(o.value, o.label || o.value)}
                  style={{
                    flex: "0 0 220px", maxWidth: 220, scrollSnapAlign: "start",
                    padding: 0, border: "1px solid #e5e7eb", borderRadius: 14, background: "#fff",
                    cursor: "pointer", overflow: "hidden", display: "flex", flexDirection: "column",
                    fontFamily: "inherit", textAlign: "left",
                    boxShadow: "0 1px 2px rgba(0,0,0,.04)",
                  }}
                >
                  {o.image && (
                    <div style={{ width: "100%", aspectRatio: "4/3", background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <img src={o.image} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                    </div>
                  )}
                  <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                    {(o.label || o.value) && (
                      <div style={{ fontWeight: 700, fontSize: 14, color: "#111827", lineHeight: 1.25 }}>
                        {o.label || o.value}
                      </div>
                    )}
                    {o.description && (
                      <div style={{ fontSize: 12, color: "#4b5563", lineHeight: 1.4, whiteSpace: "pre-wrap" }}>
                        {o.description}
                      </div>
                    )}
                    <span style={{
                      alignSelf: "flex-start", marginTop: 4, padding: "6px 12px",
                      borderRadius: 999, background: "#2563eb", color: "#fff", fontSize: 12, fontWeight: 600,
                    }}>
                      {o.button_label || "Know more"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
        {awaiting && awaiting.type === "form" && <FormRenderer fields={awaiting.config?.fields || []} onSubmit={submitForm} />}
        {awaiting && awaiting.type === "otp" && <OtpRenderer onSubmit={submitOtp} />}
        {awaiting && awaiting.type === "schedule" && (
          <ScheduleRenderer cfg={awaiting.config || {}} onSubmit={(v) => submitValue(v)} />
        )}
        {awaiting && awaiting.type === "input" && !TEXT_LIKE.has(inputT) && (
          <InlineInput cfg={inputCfg} onSubmit={submitValue} />
        )}
        <div ref={endRef} />
        {ended && <div style={{ textAlign: "center", color: "#9ca3af", fontSize: 12, marginTop: 10 }}>— end of preview —</div>}
        {err && <div className="error">{err}</div>}
      </div>

      {showBottomBar && (
        <BottomBar
          key={inputCfg?.field || inputCfg?.prompt || "bar"}
          type={barType}
          multiline={inputT === "textarea"}
          placeholder={"Type your " + (inputCfg?.field || "answer") + "…"}
          onSubmit={submitValue}
        />
      )}
    </div>
  );
}

function Bubble({ side, out }: { side: "bot" | "visitor"; out: Out }) {
  const k = out.kind, c = out.config || {};
  const bg = side === "visitor" ? "#2563eb" : "#fff";
  const color = side === "visitor" ? "#fff" : "#111827";
  const body = (
    <div style={{
      maxWidth: "78%", padding: "8px 12px", borderRadius: 14,
      background: bg, color, border: side === "bot" ? "1px solid #e5e7eb" : "none",
      whiteSpace: "pre-wrap", fontSize: 14,
    }}>
      {k === "text" && <span dangerouslySetInnerHTML={{ __html: mdToHtml(c.body || "") }} />}
      {k === "image" && <img src={c.url} alt="" style={{ maxWidth: "100%", borderRadius: 6 }} />}
      {k === "video" && <video src={c.url} controls style={{ maxWidth: "100%", borderRadius: 6 }} />}
      {k === "document" && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: 10, background: "#fff", border: "1px solid #e5e7eb",
          borderRadius: 8, color: "#111827", maxWidth: 320,
        }}>
          <div style={{
            flexShrink: 0, width: 38, height: 46, borderRadius: 4,
            background: "linear-gradient(135deg,#eef1fb,#dbe3ff)",
            display: "grid", placeItems: "center", fontSize: 18, color: "#273b84",
          }}>📄</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.title || c.original_filename || "Document"}
            </div>
            {(() => {
              const fmt = (c.original_filename || c.url || "").split(".").pop()?.toUpperCase() || "";
              const sizeText = c.size
                ? (c.size < 1024 * 1024 ? Math.round(c.size / 1024) + " KB" : (c.size / 1024 / 1024).toFixed(1) + " MB")
                : "";
              const meta = [fmt, sizeText].filter(Boolean).join(" · ");
              return meta ? <div style={{ fontSize: 11, color: "#9ca3af" }}>{meta}</div> : null;
            })()}
            {c.description && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>{c.description}</div>}
          </div>
          {c.url && (
            <a href={c.url} target="_blank" rel="noopener"
              style={{ flexShrink: 0, padding: "6px 12px", borderRadius: 6, background: "#273b84", color: "#fff", textDecoration: "none", fontSize: 12, fontWeight: 600 }}>
              ↓ Open
            </a>
          )}
        </div>
      )}
      {k === "carousel" && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
          {(c.cards || []).map((card: any, i: number) => (
            <div key={i} style={{ minWidth: 160, border: "1px solid #e5e7eb", borderRadius: 6, background: "#fff", color: "#111" }}>
              {card.image && <img src={card.image} alt="" style={{ width: "100%" }} />}
              <div style={{ padding: 6, fontSize: 12 }}>
                <div style={{ fontWeight: 600 }}>{card.title}</div>
                {card.subtitle && <div>{card.subtitle}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
  return <div style={{ display: "flex", justifyContent: side === "visitor" ? "flex-end" : "flex-start", margin: "6px 0" }}>{body}</div>;
}

function FormRenderer({ fields, onSubmit }: { fields: any[]; onSubmit: (v: Record<string, string>) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <div className="card" style={{ padding: 10, marginTop: 6 }}>
      {fields.map((f) => (
        <div key={f.name}>
          <label>{f.label || f.name}</label>
          <input value={values[f.name] || ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
        </div>
      ))}
      <button className="btn" style={{ marginTop: 8 }} onClick={() => onSubmit(values)}>Submit</button>
    </div>
  );
}

function OtpRenderer({ onSubmit }: { onSubmit: (otp: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="card" style={{ padding: 10, marginTop: 6 }}>
      <label>OTP (dev: 123456)</label>
      <input value={v} onChange={(e) => setV(e.target.value)} style={{ letterSpacing: 4, textAlign: "center" }} />
      <button className="btn" style={{ marginTop: 8 }} disabled={!/^\d{4,8}$/.test(v)} onClick={() => onSubmit(v)}>Verify</button>
    </div>
  );
}

// Bottom input bar — matches the live widget: single-line (or textarea) input + arrow send button,
// Enter-to-submit, no explicit "Send" label.
function BottomBar({ type, multiline, placeholder, onSubmit }: {
  type: string; multiline: boolean; placeholder: string; onSubmit: (v: string) => void;
}) {
  const [v, setV] = useState("");
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  useEffect(() => { setV(""); setTimeout(() => ref.current?.focus(), 50); }, [placeholder, type]);
  const send = () => { const t = v.trim(); if (!t) return; onSubmit(t); setV(""); };
  const keydown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };
  const baseStyle: React.CSSProperties = {
    flex: 1, padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, outline: "none",
  };
  return (
    <div style={{
      padding: 10, borderTop: "1px solid #e5e7eb", background: "#fff",
      display: "flex", gap: 8, alignItems: "center",
    }}>
      {multiline
        ? <textarea ref={(el) => { ref.current = el; }} value={v} onChange={(e) => setV(e.target.value)}
            onKeyDown={keydown} placeholder={placeholder} style={{ ...baseStyle, minHeight: 34, maxHeight: 90, resize: "none" }} />
        : <input ref={(el) => { ref.current = el; }} type={type} value={v} onChange={(e) => setV(e.target.value)}
            onKeyDown={keydown} placeholder={placeholder} style={baseStyle} />}
      <button onClick={send} disabled={!v.trim()}
        style={{
          width: 34, height: 34, borderRadius: "50%", border: "none",
          background: v.trim() ? "#2563eb" : "#cbd5e1", color: "#fff",
          cursor: v.trim() ? "pointer" : "not-allowed", fontSize: 14,
        }}
        aria-label="Send">
        ➤
      </button>
    </div>
  );
}

// Inline card for select/radio/checkbox/file (these are bubbles in the widget too)
function InlineInput({ cfg, onSubmit }: { cfg: any; onSubmit: (value: string, display?: string) => void }) {
  const t = (cfg.type || "text").toLowerCase();
  const [v, setV] = useState("");
  const [checked, setChecked] = useState(false);

  if (t === "select") {
    return (
      <div className="card" style={{ padding: 10, marginTop: 6, display: "flex", gap: 8 }}>
        <select value={v} onChange={(e) => setV(e.target.value)} style={{ flex: 1 }}>
          <option value="">Select…</option>
          {(cfg.options || []).map((o: any, i: number) => (
            <option key={i} value={String(o.value)}>{o.label || o.value}</option>
          ))}
        </select>
        <button className="btn" disabled={!v} onClick={() => {
          const match = (cfg.options || []).find((o: any) => String(o.value) === v);
          onSubmit(v, match?.label || v);
        }}>Send</button>
      </div>
    );
  }
  if (t === "radio") {
    return (
      <div className="card" style={{ padding: 10, marginTop: 6 }}>
        {(cfg.options || []).map((o: any, i: number) => (
          <label key={i} style={{ display: "block", marginBottom: 4 }}>
            <input type="radio" name="preview-radio" value={String(o.value)}
              checked={v === String(o.value)} onChange={() => setV(String(o.value))} />{" "}
            {o.label || o.value}
          </label>
        ))}
        <button className="btn" style={{ marginTop: 6 }} disabled={!v} onClick={() => {
          const match = (cfg.options || []).find((o: any) => String(o.value) === v);
          onSubmit(v, match?.label || v);
        }}>Send</button>
      </div>
    );
  }
  if (t === "checkbox") {
    return (
      <div className="card" style={{ padding: 10, marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
        <label style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          {cfg.label || "Confirm"}
        </label>
        <button className="btn" onClick={() => onSubmit(checked ? "true" : "false", checked ? "✓" : "—")}>Send</button>
      </div>
    );
  }
  if (t === "file") {
    return (
      <div className="card" style={{ padding: 10, marginTop: 6, fontSize: 12, color: "#6b7280" }}>
        (file uploads are tested only in the live widget — preview skipped)
        <button className="btn" style={{ marginLeft: 8 }} onClick={() => onSubmit("/static/uploads/preview-file", "(file)")}>Skip</button>
      </div>
    );
  }
  // Should not reach here — text-like types use BottomBar
  return null;
}


function ScheduleRenderer({ cfg, onSubmit }: { cfg: any; onSubmit: (value: string) => void }) {
  const today = new Date();
  const minDays = parseInt(cfg.min_days ?? "0", 10);
  const maxDays = parseInt(cfg.max_days ?? "30", 10);
  const d = (off: number) => new Date(today.getTime() + off * 86400000).toISOString().slice(0, 10);
  const [date, setDate] = useState(d(minDays));
  const [slot, setSlot] = useState<string>("");
  const slots: string[] = Array.isArray(cfg.time_slots) ? cfg.time_slots : [];

  return (
    <div className="card" style={{ padding: 10, marginTop: 6 }}>
      {cfg.description && <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>{cfg.description}</div>}
      <input type="date" min={d(minDays)} max={d(maxDays)} value={date} onChange={(e) => setDate(e.target.value)}
        style={{ width: "100%" }} />
      {slots.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: "#6b7280", margin: "10px 0 4px" }}>Pick a time:</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {slots.map((s) => (
              <button key={s} type="button" onClick={() => setSlot(s)}
                style={{
                  padding: "6px 10px", border: "1px solid " + (slot === s ? "#2563eb" : "#d1d5db"),
                  borderRadius: 6, background: slot === s ? "#2563eb" : "#fff",
                  color: slot === s ? "#fff" : "#111", fontSize: 13, cursor: "pointer",
                }}>{s}</button>
            ))}
          </div>
        </>
      )}
      <button className="btn" style={{ marginTop: 10 }}
        disabled={!date || (slots.length > 0 && !slot)}
        onClick={() => onSubmit(slot ? `${date} ${slot}` : date)}>
        {cfg.submit_label || "Confirm"}
      </button>
    </div>
  );
}
