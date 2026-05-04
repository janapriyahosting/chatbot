import { useRef } from "react";
import type { Node } from "@xyflow/react";
import { EmojiPicker } from "./EmojiPicker";
import { FormattingBar } from "./FormattingBar";
import { UploadButton } from "./UploadButton";
import { VarPicker } from "./VarPicker";

/**
 * Fully DOM-owned input/textarea. React writes the initial value ONCE on mount,
 * then never touches the element again. The only ways the value can change are:
 *   - user typing (onInput → debounced commit to parent state)
 *   - explicit imperative writes from + variable / + emoji buttons
 *   - component remount (key change on the inspector when switching nodes)
 *
 * This sidesteps every possible controlled/uncontrolled race because React's
 * reconciliation simply has no say over this field's value post-mount.
 */
function useDomBound(
  initialValue: string,
  onCommit: (v: string) => void,
  debounceMs = 300,
) {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);

  const setElement = (el: HTMLInputElement | HTMLTextAreaElement | null) => {
    ref.current = el;
    if (el && !mounted.current) {
      el.value = initialValue;
      mounted.current = true;
    }
  };

  const onInput = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (ref.current) onCommit(ref.current.value);
    }, debounceMs);
  };

  const onBlur = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (ref.current) onCommit(ref.current.value);
  };

  return { setElement, onInput, onBlur };
}

function BInput(props: React.InputHTMLAttributes<HTMLInputElement> & {
  value: string; onCommit: (v: string) => void;
}) {
  const { value, onCommit, ...rest } = props;
  const { setElement, onInput, onBlur } = useDomBound(value, onCommit);
  return (
    <input
      {...rest}
      ref={setElement as React.RefCallback<HTMLInputElement>}
      onInput={onInput}
      onBlur={onBlur}
    />
  );
}

function BTextArea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    value: string; onCommit: (v: string) => void;
  } & { innerRef?: React.Ref<HTMLTextAreaElement> },
) {
  const { value, onCommit, innerRef, ...rest } = props;
  const { setElement, onInput, onBlur } = useDomBound(value, onCommit);
  return (
    <textarea
      {...rest}
      ref={(el) => {
        setElement(el);
        if (innerRef) {
          if (typeof innerRef === "function") innerRef(el);
          else (innerRef as any).current = el;
        }
      }}
      onInput={onInput}
      onBlur={onBlur}
    />
  );
}

export const NODE_TYPES = [
  "start", "text", "image", "video", "document", "carousel",
  "buttons", "input", "form", "schedule", "condition", "otp", "api", "ai", "handoff", "end",
] as const;

function insertAtCursor(el: HTMLTextAreaElement | HTMLInputElement | null, token: string, setValue: (v: string) => void, _unused?: string) {
  // Read and write directly to the DOM because React no longer controls the
  // textarea/input value; then push the new value up so the graph state is in
  // sync and conditions/templating can reference it.
  if (!el) return;
  const src = el.value || "";
  const start = el.selectionStart ?? src.length;
  const end = el.selectionEnd ?? src.length;
  const next = src.slice(0, start) + token + src.slice(end);
  el.value = next;
  setValue(next);
  el.focus();
  el.setSelectionRange(start + token.length, start + token.length);
}
export type NodeType = (typeof NODE_TYPES)[number];

type NodeData = { label: string; nodeType: NodeType; config: any };

export function NodeInspector({
  node, onChange, onDelete, onMakeStart, isStart, allNodes = [],
}: {
  node: Node;
  onChange: (patch: Partial<NodeData>) => void;
  onDelete: () => void;
  onMakeStart: () => void;
  isStart: boolean;
  allNodes?: Node[];
}) {
  const data = node.data as NodeData;
  const cfg = data.config || {};
  const set = (k: string, v: any) => onChange({ config: { ...cfg, [k]: v } });

  return (
    <div>
      <div className="row">
        <div style={{ fontWeight: 600 }}>{data.nodeType}</div>
        <div className="spacer" />
        {!isStart && (
          <button className="btn ghost" style={{ padding: "4px 8px", fontSize: 12 }} onClick={onMakeStart}>
            Make start
          </button>
        )}
        <button className="btn danger" style={{ padding: "4px 8px", fontSize: 12 }} onClick={onDelete}>
          Delete
        </button>
      </div>
      <label>Name (shown on the canvas)</label>
      <BInput
        value={data.label || ""}
        onCommit={(v) => onChange({ label: v || `${data.nodeType} · ${node.id}` })}
        placeholder={`${data.nodeType} · ${node.id}`}
      />
      <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>
        Internal id: <code>{node.id}</code> (used by edges, not editable)
      </div>

      {data.nodeType === "text" && <TextPanel cfg={cfg} set={set} />}

      {data.nodeType === "image" && (
        <>
          <label>Image URL</label>
          <BInput value={cfg.url || ""} onCommit={(v) => set("url", v)} />
          <UploadButton accept="image/*" label="Upload image" onUploaded={(url) => set("url", url)} />
          {cfg.url && <img src={cfg.url} alt="" style={{ maxWidth: "100%", marginTop: 8, borderRadius: 4 }} />}
          <label>Caption</label>
          <BInput value={cfg.caption || ""} onCommit={(v) => set("caption", v)} />
        </>
      )}

      {data.nodeType === "video" && (
        <>
          <label>Video URL (mp4/webm)</label>
          <BInput value={cfg.url || ""} onCommit={(v) => set("url", v)} />
          <UploadButton accept="video/*" label="Upload video" onUploaded={(url) => set("url", url)} />
          <label>Caption</label>
          <BInput value={cfg.caption || ""} onCommit={(v) => set("caption", v)} />
        </>
      )}

      {data.nodeType === "document" && (
        <>
          <label>Document URL (PDF, DOCX, XLSX, PPT, ZIP, ...)</label>
          <BInput value={cfg.url || ""} onCommit={(v) => set("url", v)} />
          <UploadButton
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rtf,.odt,.ods,application/pdf"
            label="Upload document"
            onUploaded={(url, info) => {
              set("url", url);
              if (info) {
                if (info.original_filename && !cfg.title) set("title", info.original_filename.replace(/\.[^.]+$/, ""));
                if (info.original_filename) set("original_filename", info.original_filename);
                if (info.size) set("size", info.size);
                if (info.content_type) set("content_type", info.content_type);
              }
            }}
          />
          {cfg.url && (
            <div style={{ marginTop: 8, padding: 8, background: "#f4f6fb", borderRadius: 6, fontSize: 12 }}>
              <a href={cfg.url} target="_blank" rel="noopener" style={{ color: "#273b84", wordBreak: "break-all" }}>
                {cfg.original_filename || cfg.url}
              </a>
              {cfg.size ? <div style={{ color: "#6b7280", marginTop: 2 }}>{(cfg.size / 1024 / 1024).toFixed(2)} MB</div> : null}
            </div>
          )}
          <label>Title (shown to customer)</label>
          <BInput value={cfg.title || ""} onCommit={(v) => set("title", v)} placeholder="e.g., Janapriya Upscale Brochure" />
          <label>Description (optional)</label>
          <BInput value={cfg.description || ""} onCommit={(v) => set("description", v)} placeholder="e.g., Master plan, pricing, amenities" />
          <label>Caption (optional, shown below card)</label>
          <BInput value={cfg.caption || ""} onCommit={(v) => set("caption", v)} />
        </>
      )}

      {data.nodeType === "carousel" && (
        <CarouselEditor cards={cfg.cards || []} setCards={(c) => set("cards", c)} />
      )}

      {data.nodeType === "buttons" && (
        <ButtonsEditor
          body={cfg.body || ""}
          options={cfg.options || []}
          setBody={(v) => set("body", v)}
          setOptions={(v) => set("options", v)}
        />
      )}

      {data.nodeType === "form" && (
        <FormEditor
          intro={cfg.intro || ""}
          fields={cfg.fields || []}
          submit={cfg.submit_label || ""}
          setIntro={(v) => set("intro", v)}
          setFields={(v) => set("fields", v)}
          setSubmit={(v) => set("submit_label", v)}
        />
      )}

      {data.nodeType === "schedule" && (
        <>
          <label>Title (shown as a bot message)</label>
          <BInput value={cfg.title || ""} onCommit={(v) => set("title", v)} placeholder="When would you like to visit?" />
          <label>Description (optional)</label>
          <BInput value={cfg.description || ""} onCommit={(v) => set("description", v)} placeholder="e.g., Our team will confirm on WhatsApp" />
          <label>Save as (variable name)</label>
          <BInput value={cfg.field || ""} onCommit={(v) => set("field", v)} placeholder="site_visit" />
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
            Available later as <code>{"{{answers." + (cfg.field || "site_visit") + "}}"}</code>.
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <div style={{ flex: 1 }}>
              <label>Earliest (days from today)</label>
              <BInput value={String(cfg.min_days ?? "0")} onCommit={(v) => set("min_days", v)} />
            </div>
            <div style={{ flex: 1 }}>
              <label>Latest (days from today)</label>
              <BInput value={String(cfg.max_days ?? "30")} onCommit={(v) => set("max_days", v)} />
            </div>
          </div>
          <label>Time slots (comma-separated, optional)</label>
          <BInput
            value={(cfg.time_slots || []).join(", ")}
            onCommit={(v) => set("time_slots", v ? v.split(",").map((s: string) => s.trim()).filter(Boolean) : [])}
            placeholder="10:00 AM, 12:00 PM, 4:00 PM, 6:00 PM"
          />
          <label>Confirm button label</label>
          <BInput value={cfg.submit_label || ""} onCommit={(v) => set("submit_label", v)} placeholder="Confirm" />
        </>
      )}

      {data.nodeType === "input" && <InputPanel cfg={cfg} set={set} />}

      {data.nodeType === "condition" && (
        <ConditionEditor
          rules={cfg.rules || []}
          logic={cfg.logic || "and"}
          setRules={(r) => set("rules", r)}
          setLogic={(l) => set("logic", l)}
          allNodes={allNodes}
        />
      )}

      {data.nodeType === "otp" && (
        <>
          <label>Phone field (from form)</label>
          <BInput value={cfg.phone_field || "phone"} onCommit={(v) => set("phone_field", v)} />
          <label>Prompt</label>
          <BTextArea value={cfg.body || ""} onCommit={(v) => set("body", v)}
            placeholder="We'll send an OTP to your phone." />
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
            Reads phone from <code>answers.form.&lt;phone_field&gt;</code>.
            Verification goes through the janapriyaupscale OTP service.
            Geofenced to India (configurable).
          </div>
        </>
      )}

      {data.nodeType === "handoff" && (
        <>
          <label>Handoff message</label>
          <BTextArea value={cfg.body || ""} onCommit={(v) => set("body", v)}
            placeholder="Connecting you to our team…" />
          <label style={{ marginTop: 12 }}>
            <input
              type="checkbox"
              checked={!!cfg.ai_fallback}
              onChange={(e) => set("ai_fallback", e.target.checked)}
            />{" "}AI fallback if no agent is available
          </label>
          {cfg.ai_fallback && (
            <>
              <label>AI system prompt</label>
              <BTextArea value={cfg.ai_system_prompt || ""} onCommit={(v) => set("ai_system_prompt", v)}
                placeholder="You are a friendly Janapriya Upscale assistant. Answer buying questions briefly." />
            </>
          )}
          <label style={{ marginTop: 12 }}>Out-of-hours / no-agent message</label>
          <BTextArea value={cfg.unavailable_message || ""} onCommit={(v) => set("unavailable_message", v)}
            placeholder="Our team is offline right now. Drop your question and we'll reply when we're back." />
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 8 }}>
            When reached: auto-assigns to an in-hours available agent. If nobody is
            available, the visitor sees the out-of-hours message and the chat is
            queued so the next agent online picks it up.
          </div>
        </>
      )}

      {data.nodeType === "ai" && (
        <>
          <label>Intro message (optional)</label>
          <BTextArea value={cfg.body || ""} onCommit={(v) => set("body", v)}
            placeholder="I'm here to help. Ask me anything!" />
          <label>System prompt</label>
          <BTextArea value={cfg.system_prompt || ""} onCommit={(v) => set("system_prompt", v)}
            placeholder="You are a friendly Janapriya Upscale assistant. Answer in 1-3 sentences." />
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
            Enters AI mode. The visitor chats freely with the AI (Groq for
            short turns, Gemini for reasoning). Conversation auto-closes when
            the visitor leaves.
          </div>
        </>
      )}

      {data.nodeType === "api" && <ApiEditor cfg={cfg} set={set} />}

      {(data.nodeType === "start" || data.nodeType === "end") && (
        <div style={{ color: "#6b7280", fontSize: 12, marginTop: 8 }}>
          No configuration needed.
        </div>
      )}
    </div>
  );
}

function JsonField({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <textarea
      defaultValue={text}
      onBlur={(e) => {
        try { onChange(JSON.parse(e.target.value || "{}")); }
        catch { /* leave as-is; user can fix */ }
      }}
      style={{ fontFamily: "ui-monospace", fontSize: 12 }}
    />
  );
}

type Opt = { label: string; value: string };
function ButtonsEditor({ body, options, setBody, setOptions }: {
  body: string; options: Opt[]; setBody: (v: string) => void; setOptions: (v: Opt[]) => void;
}) {
  const add = () => setOptions([...options, { label: "New", value: "new" }]);
  const del = (i: number) => setOptions(options.filter((_: any, j: number) => j !== i));
  const upd = (i: number, k: string, v: string) =>
    setOptions(options.map((o: any, j: number) => (j === i ? { ...o, [k]: v } : o)));
  return (
    <>
      <label>Prompt</label>
      <BTextArea value={body} onCommit={(v) => setBody(v)} />
      <label>Options</label>
      {options.map((o: any, i: number) => (
        <div key={i} className="row" style={{ marginTop: 6 }}>
          <BInput placeholder="label" value={o.label} onCommit={(v) => upd(i, "label", v)} />
          <BInput placeholder="value" value={o.value} onCommit={(v) => upd(i, "value", v)} />
          <button className="btn danger" style={{ padding: "4px 8px" }} onClick={() => del(i)}>×</button>
        </div>
      ))}
      <button className="btn ghost" style={{ marginTop: 8 }} onClick={add}>+ option</button>
    </>
  );
}

type Field = {
  name: string;
  label?: string;
  type?: string;
  options?: { label: string; value: string }[];
  min?: number;
  max?: number;
  required?: boolean;
};
const FIELD_TYPES = [
  "text", "email", "tel", "number", "url", "date",
  "textarea", "select", "radio", "checkbox", "file",
] as const;

const FIELD_HINTS: Record<string, string> = {
  text: "Single-line text",
  email: "Validated email address",
  tel: "10-digit Indian mobile",
  number: "Numeric (with min/max)",
  url: "http(s):// URL",
  date: "Date picker",
  textarea: "Multi-line text",
  select: "Dropdown (with options)",
  radio: "Radio group (with options)",
  checkbox: "Single yes/no toggle",
  file: "Visitor uploads a file",
};

function FormEditor({ intro, fields, submit, setIntro, setFields, setSubmit }: {
  intro: string; fields: Field[]; submit: string;
  setIntro: (v: string) => void; setFields: (v: Field[]) => void; setSubmit: (v: string) => void;
}) {
  const add = () => setFields([...fields, { name: "field", label: "Field", type: "text" }]);
  const del = (i: number) => setFields(fields.filter((_, j) => j !== i));
  const upd = (i: number, patch: Partial<Field>) =>
    setFields(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <>
      <label>Intro</label>
      <BTextArea value={intro} onCommit={(v) => setIntro(v)} />
      <label>Fields</label>
      {fields.map((f, i) => {
        const t = f.type || "text";
        return (
          <div key={i} className="card" style={{ padding: 10, marginTop: 8, background: "#fafafa" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Field {i + 1}</div>
              <button className="btn danger" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => del(i)}>Remove</button>
            </div>

            <label style={{ marginTop: 6 }}>Type</label>
            <select value={t} onChange={(e) => upd(i, { type: e.target.value })}>
              {FIELD_TYPES.map((ft) => (
                <option key={ft} value={ft}>{ft} — {FIELD_HINTS[ft]}</option>
              ))}
            </select>

            <label>Field name (key in saved data)</label>
            <BInput placeholder="e.g., phone" value={f.name} onCommit={(v) => upd(i, { name: v })} />

            <label>Label (shown to visitor)</label>
            <BInput placeholder="e.g., Your phone" value={f.label || ""} onCommit={(v) => upd(i, { label: v })} />

            {t === "number" && (
              <>
                <label>Min / Max</label>
                <div className="row">
                  <input type="number" placeholder="min" value={f.min ?? ""} onChange={(e) => upd(i, { min: e.target.value === "" ? undefined : Number(e.target.value) })} />
                  <input type="number" placeholder="max" value={f.max ?? ""} onChange={(e) => upd(i, { max: e.target.value === "" ? undefined : Number(e.target.value) })} />
                </div>
              </>
            )}

            {(t === "select" || t === "radio") && (
              <>
                <label>Choices</label>
                <SelectOptionsEditor options={f.options || []} setOptions={(o) => upd(i, { options: o })} />
              </>
            )}

            {t === "file" && (
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                Visitor-side upload is capped at 10 MB and restricted to
                image/video/pdf. Saved as a URL in the submitted form.
              </div>
            )}

            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
              <input type="checkbox" checked={f.required !== false} onChange={(e) => upd(i, { required: e.target.checked })} />
              Required
            </label>
          </div>
        );
      })}
      <button className="btn ghost" style={{ marginTop: 8 }} onClick={add}>+ field</button>
      <label>Submit label</label>
      <BInput placeholder="Submit" value={submit} onCommit={(v) => setSubmit(v)} />
    </>
  );
}

function SelectOptionsEditor({ options, setOptions }: {
  options: { label: string; value: string }[]; setOptions: (o: { label: string; value: string }[]) => void;
}) {
  const add = () => setOptions([...options, { label: "Option", value: "option" }]);
  const del = (i: number) => setOptions(options.filter((_, j) => j !== i));
  const upd = (i: number, k: "label" | "value", v: string) =>
    setOptions(options.map((o, j) => (j === i ? { ...o, [k]: v } : o)));
  return (
    <div style={{ marginTop: 4 }}>
      {options.map((o, i) => (
        <div key={i} className="row" style={{ marginTop: 4 }}>
          <BInput placeholder="label" value={o.label} onCommit={(v) => upd(i, "label", v)} />
          <BInput placeholder="value" value={o.value} onCommit={(v) => upd(i, "value", v)} />
          <button className="btn danger" style={{ padding: "4px 8px" }} onClick={() => del(i)}>×</button>
        </div>
      ))}
      <button className="btn ghost" style={{ padding: "4px 8px", marginTop: 4, fontSize: 12 }} onClick={add}>+ option</button>
    </div>
  );
}

const STATIC_VARS = [
  { label: "utm_source", value: "utm.utm_source" },
  { label: "utm_campaign", value: "utm.utm_campaign" },
  { label: "utm_medium", value: "utm.utm_medium" },
  { label: "gclid", value: "utm.gclid" },
];

function buildVarCatalog(allNodes: Node[]): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  try {
    for (const n of allNodes || []) {
      const d = (n?.data as NodeData) || ({} as NodeData);
      const c = (d.config || {}) as any;
      if (d.nodeType === "input" && c.field) {
        out.push({ label: `${c.field} (from ${n.id})`, value: `answers.${c.field}` });
      } else if (d.nodeType === "form") {
        for (const f of (c.fields || [])) {
          if (f.name) out.push({ label: `form.${f.name} (from ${n.id})`, value: `answers.form.${f.name}` });
        }
      } else if (d.nodeType === "buttons") {
        out.push({ label: `${n.id} (clicked value)`, value: `answers.${n.id}` });
      } else if (d.nodeType === "api" && c.save_as) {
        out.push({ label: `api.${c.save_as}`, value: `api.${c.save_as}` });
      }
    }
  } catch { /* defensive: never break the editor if an odd node shape sneaks in */ }
  const seen = new Set<string>();
  const dedup = out.filter((v) => (seen.has(v.value) ? false : (seen.add(v.value), true)));
  return [...dedup, ...STATIC_VARS];
}
const OPS = [
  { label: "equals", value: "==" },
  { label: "not equals", value: "!=" },
  { label: "greater than", value: ">" },
  { label: "greater than or equal", value: ">=" },
  { label: "less than", value: "<" },
  { label: "less than or equal", value: "<=" },
  { label: "contains", value: "contains" },
  { label: "does not contain", value: "not_contains" },
  { label: "is set", value: "exists" },
  { label: "is empty", value: "not_exists" },
];

type Rule = { left: string; op: string; right: string; right_is_var?: boolean };

function ConditionEditor({ rules, logic, setRules, setLogic, allNodes = [] }: {
  rules: Rule[]; logic: string;
  setRules: (v: Rule[]) => void;
  setLogic: (v: string) => void;
  allNodes?: Node[];
}) {
  const safe: Rule[] = Array.isArray(rules) ? rules : [];
  const vars = buildVarCatalog(allNodes);
  const first = vars[0]?.value || "answers.input";
  const add = () => {
    setRules([...safe, { left: first, op: "==", right: "" } as Rule]);
    requestAnimationFrame(() => {
      const panel = document.querySelector('[data-cb-inspector]') as HTMLElement | null;
      if (panel) panel.scrollTop = panel.scrollHeight;
    });
  };
  const del = (i: number) => setRules(safe.filter((_, j) => j !== i));
  const upd = (i: number, patch: Partial<Rule>) =>
    setRules(safe.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const hideRight = (op: string) => op === "exists" || op === "not_exists";
  return (
    <>
      <label>If…</label>
      {safe.length === 0 && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>No rules yet — click + rule.</div>}
      {safe.map((r, i) => (
        <div key={i} className="card" style={{ padding: 8, marginTop: 6, borderColor: "#2563eb" }}>
          <label>Variable</label>
          <select value={r.left} onChange={(e) => upd(i, { left: e.target.value })}>
            {vars.length === 0 && <option value="">(add an input/form/api node first)</option>}
            {vars.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
          <label>Operator</label>
          <select value={r.op} onChange={(e) => upd(i, { op: e.target.value })}>
            {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {!hideRight(r.op) && (
            <>
              <label>Value</label>
              <BInput placeholder="e.g. 1" value={r.right} onCommit={(v) => upd(i, { right: v })} />
            </>
          )}
          <div className="row" style={{ marginTop: 6 }}>
            <div className="spacer" />
            <button
              type="button"
              className="btn danger"
              style={{ padding: "4px 8px", fontSize: 12 }}
              onMouseDown={(e) => { e.preventDefault(); }}
              onClick={() => del(i)}
            >
              Remove rule
            </button>
          </div>
        </div>
      ))}
      {safe.length > 1 && (
        <>
          <label>Combine rules with</label>
          <select value={logic} onChange={(e) => setLogic(e.target.value)}>
            <option value="and">AND (all must match)</option>
            <option value="or">OR (any match)</option>
          </select>
        </>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="btn ghost" onClick={add}>+ rule</button>
      </div>
      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>
        Connect two outgoing edges with labels <code>true</code> and <code>false</code>.
      </div>
    </>
  );
}

function ApiEditor({ cfg, set }: { cfg: any; set: (k: string, v: any) => void }) {
  const auth = cfg.auth || { type: "none" };
  const setAuth = (patch: any) => set("auth", { ...auth, ...patch });
  return (
    <>
      <label>Method</label>
      <select value={cfg.method || "POST"} onChange={(e) => set("method", e.target.value)}>
        <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
      </select>
      <label>URL</label>
      <BInput value={cfg.url || ""} onCommit={(v) => set("url", v)} placeholder="https://api.example.com/leads" />

      <label style={{ marginTop: 12, fontWeight: 600 }}>Auth</label>
      <select value={auth.type || "none"} onChange={(e) => setAuth({ type: e.target.value })}>
        <option value="none">None</option>
        <option value="bearer">Bearer token</option>
        <option value="api_key">API key header</option>
      </select>
      {auth.type === "bearer" && (
        <>
          <label>Token</label>
          <BInput type="password" value={auth.token || ""} onCommit={(v) => setAuth({ token: v })} placeholder="sk_live_..." />
        </>
      )}
      {auth.type === "api_key" && (
        <>
          <label>Header name</label>
          <BInput value={auth.header || ""} onCommit={(v) => setAuth({ header: v })} placeholder="X-API-Key" />
          <label>Header value</label>
          <BInput type="password" value={auth.value || ""} onCommit={(v) => setAuth({ value: v })} />
        </>
      )}

      <label style={{ marginTop: 12 }}>Extra headers (JSON)</label>
      <JsonField value={cfg.headers || {}} onChange={(v) => set("headers", v)} />
      <label>Body (JSON, templatable)</label>
      <JsonField value={cfg.body || {}} onChange={(v) => set("body", v)} />
      <label>Save response as</label>
      <BInput value={cfg.save_as || ""} onCommit={(v) => set("save_as", v)} placeholder="api_response" />
      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
        Later nodes can read the response at{" "}
        <code>{`{{api.<save_as>}}`}</code> or reference fields in a condition like{" "}
        <code>api.api_response.ok == "true"</code>.
      </div>
    </>
  );
}

function InputPanel({ cfg, set }: { cfg: any; set: (k: string, v: any) => void }) {
  const t = cfg.type || "text";
  return (
    <>
      <label>Type</label>
      <select value={t} onChange={(e) => set("type", e.target.value)}>
        {FIELD_TYPES.map((ft) => (
          <option key={ft} value={ft}>{ft} — {FIELD_HINTS[ft]}</option>
        ))}
      </select>

      <label>Prompt (shown as a bot message before the input)</label>
      <BTextArea value={cfg.prompt || ""} onCommit={(v) => set("prompt", v)}
        placeholder="e.g., What's your phone number?" />

      <label>Save as (variable name)</label>
      <BInput value={cfg.field || ""} onCommit={(v) => set("field", v)}
        placeholder="phone" />
      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
        The value will be available later as <code>{"{{answers." + (cfg.field || "<name>") + "}}"}</code>
        and usable in conditions.
      </div>

      {t === "number" && (
        <>
          <label>Min / Max</label>
          <div className="row">
            <input type="number" placeholder="min" value={cfg.min ?? ""} onChange={(e) => set("min", e.target.value === "" ? undefined : Number(e.target.value))} />
            <input type="number" placeholder="max" value={cfg.max ?? ""} onChange={(e) => set("max", e.target.value === "" ? undefined : Number(e.target.value))} />
          </div>
        </>
      )}

      {(t === "select" || t === "radio") && (
        <>
          <label>Choices</label>
          <SelectOptionsEditor options={cfg.options || []} setOptions={(o) => set("options", o)} />
        </>
      )}

      {t === "file" && (
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
          Visitor-side upload, 10 MB max. Saved as a URL under{" "}
          <code>{"answers." + (cfg.field || "<name>")}</code>.
        </div>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
        <input type="checkbox" checked={cfg.required !== false} onChange={(e) => set("required", e.target.checked)} />
        Required
      </label>
    </>
  );
}

function TextPanel({ cfg, set }: { cfg: any; set: (k: string, v: any) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <label>Body</label>
      <FormattingBar targetRef={ref} />
      <BTextArea innerRef={ref} value={cfg.body || ""} onCommit={(v) => set("body", v)}
        style={{ minHeight: 120 }} />
      <div className="row" style={{ gap: 4, flexWrap: "wrap", marginTop: 4 }}>
        <VarPicker onInsert={(tok) => insertAtCursor(ref.current, tok, (v) => set("body", v), cfg.body || "")} />
        <EmojiPicker onInsert={(e) => insertAtCursor(ref.current, e, (v) => set("body", v), cfg.body || "")} />
      </div>
      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
        Tip: highlight text first, then click a formatting button to wrap it.
      </div>
    </>
  );
}

type Card = { title?: string; subtitle?: string; image?: string };
function CarouselEditor({ cards, setCards }: {
  cards: Card[]; setCards: (v: Card[]) => void;
}) {
  const add = () => setCards([...cards, { title: "New card", subtitle: "", image: "" }]);
  const del = (i: number) => setCards(cards.filter((_: any, j: number) => j !== i));
  const upd = (i: number, k: string, v: string) =>
    setCards(cards.map((c: any, j: number) => (j === i ? { ...c, [k]: v } : c)));
  return (
    <>
      <label>Cards</label>
      {cards.map((c: any, i: number) => (
        <div key={i} className="card" style={{ padding: 8, marginTop: 6 }}>
          <BInput placeholder="title" value={c.title || ""} onCommit={(v) => upd(i, "title", v)} />
          <BInput placeholder="subtitle" value={c.subtitle || ""} onCommit={(v) => upd(i, "subtitle", v)} style={{ marginTop: 4 }} />
          <BInput placeholder="image url" value={c.image || ""} onCommit={(v) => upd(i, "image", v)} style={{ marginTop: 4 }} />
          <UploadButton accept="image/*" label="Upload" onUploaded={(url) => upd(i, "image", url)} />
          {c.image && <img src={c.image} alt="" style={{ maxWidth: "100%", marginTop: 6, borderRadius: 4 }} />}
          <button className="btn danger" style={{ padding: "4px 8px", marginTop: 6 }} onClick={() => del(i)}>remove</button>
        </div>
      ))}
      <button className="btn ghost" style={{ marginTop: 8 }} onClick={add}>+ card</button>
    </>
  );
}
