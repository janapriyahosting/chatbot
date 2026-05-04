import type { RefObject } from "react";

function wrapSelection(
  el: HTMLTextAreaElement | HTMLInputElement | null,
  before: string,
  after: string,
  placeholder = "",
) {
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const selected = el.value.substring(start, end) || placeholder;
  const next = el.value.substring(0, start) + before + selected + after + el.value.substring(end);
  el.value = next;
  el.focus();
  // Place cursor inside the wrap, highlighting the content
  el.setSelectionRange(start + before.length, start + before.length + selected.length);
  // Fire input so the debounced commit picks up the change
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function insertPrefix(
  el: HTMLTextAreaElement | HTMLInputElement | null,
  prefix: string,
) {
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  // Walk back to the start of the current line
  const lineStart = el.value.lastIndexOf("\n", start - 1) + 1;
  const next = el.value.substring(0, lineStart) + prefix + el.value.substring(lineStart);
  el.value = next;
  el.focus();
  el.setSelectionRange(start + prefix.length, start + prefix.length);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const BTN: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 4,
  padding: "3px 8px",
  fontSize: 12,
  cursor: "pointer",
  color: "#374151",
};

export function FormattingBar({
  targetRef,
}: {
  targetRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
}) {
  const el = () => targetRef.current;
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
      <button
        type="button"
        title="Bold (**text**)"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => wrapSelection(el(), "**", "**", "bold")}
        style={{ ...BTN, fontWeight: 700 }}
      >B</button>
      <button
        type="button"
        title="Italic (*text*)"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => wrapSelection(el(), "*", "*", "italic")}
        style={{ ...BTN, fontStyle: "italic" }}
      >I</button>
      <button
        type="button"
        title="Inline code (`text`)"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => wrapSelection(el(), "`", "`", "code")}
        style={{ ...BTN, fontFamily: "ui-monospace" }}
      >{"</>"}</button>
      <button
        type="button"
        title="Link [text](url)"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const e_ = el();
          if (!e_) return;
          const url = window.prompt("Link URL (https://…)");
          if (!url) return;
          const start = e_.selectionStart ?? e_.value.length;
          const end = e_.selectionEnd ?? e_.value.length;
          const text = e_.value.substring(start, end) || "link text";
          const snippet = `[${text}](${url})`;
          const next = e_.value.substring(0, start) + snippet + e_.value.substring(end);
          e_.value = next;
          e_.focus();
          e_.setSelectionRange(start + snippet.length, start + snippet.length);
          e_.dispatchEvent(new Event("input", { bubbles: true }));
        }}
        style={BTN}
      >🔗 Link</button>
      <button
        type="button"
        title="Bulleted list"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => insertPrefix(el(), "- ")}
        style={BTN}
      >• List</button>
      <button
        type="button"
        title="New line"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => wrapSelection(el(), "\n", "")}
        style={BTN}
      >↵</button>
    </div>
  );
}
